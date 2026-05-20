"""
Resolution job — closes out predictions after market close.

For each unresolved prediction whose `prediction_date` is today:
  1. Pull open_price (9:30 AM ET first trade) and close_price (4 PM ET last trade)
     from yfinance.
  2. Choose the reference price (per ADR 0017):
       - Bets created before RESOLUTION_V2_CUTOFF: open_price (grandfathered,
         see ADR 0008 — supersedes the open-vs-close-for-everyone model).
       - Bets created after market open with a recorded price_at_placement:
         use that as the reference (entry vs close).
       - Otherwise: open_price (pre-market bets, or Finnhub was down at
         placement and price_at_placement is NULL).
  3. Determine outcome:
       - If close_price > reference → DIRECTION='UP' wins, 'DOWN' loses
       - If close_price < reference → 'DOWN' wins, 'UP' loses
       - If equal (rare) → VOID (refund)
       - If price data unavailable → VOID (refund)
  4. On WIN: payout = wagered × 1.8 (rounded down to int)
  5. Update predictions row + insert into credit_transactions ledger
  6. Bump user_profiles counters (total/correct + streak)

Idempotent: only touches rows where resolved=false. Re-running after a
partial failure is safe.

CLI:
    python -m pipeline.resolve_predictions               # today
    python -m pipeline.resolve_predictions --date 2026-05-19
    python -m pipeline.resolve_predictions --dry-run
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Any

import pandas as pd
import yfinance as yf

from .config import load_config
from .fetchers._normalize import to_yahoo_symbol
from .observability import init_logging, init_sentry
from .processors.resolution_scoring import (
    RESOLUTION_V2_CUTOFF,  # re-exported for tests/CLI introspection
    _choose_reference_price,
    _evaluate,
)
from .supabase_client import (
    complete_pipeline_run,
    make_client,
    start_pipeline_run,
)

# Keep the legacy import name available for any external caller while we
# transition (none in-tree, but defensive). The constant lives in the
# scoring module now.
__all__ = ["RESOLUTION_V2_CUTOFF"]


async def run(args: argparse.Namespace) -> int:
    cfg = load_config()
    init_sentry(cfg.sentry_dsn)
    log = init_logging(cfg.log_level)

    target_date = args.date or date.today().isoformat()
    log.info("resolve_start date=%s dry_run=%s", target_date, args.dry_run)

    supabase = make_client(cfg.supabase_url, cfg.supabase_service_key)

    # Fetch unresolved predictions for the target date.
    # `created_at` and `price_at_placement` drive the entry-vs-close
    # discriminator in `_choose_reference_price` (ADR 0017).
    try:
        res = (
            supabase.table("predictions")
            .select(
                "id, user_id, stock_id, direction, credits_wagered, "
                "created_at, price_at_placement, stocks(ticker)"
            )
            .eq("prediction_date", target_date)
            .eq("resolved", False)
            .execute()
        )
    except Exception as e:  # noqa: BLE001
        # Graceful migration-pending degradation (ADR 0017 follow-up to #130):
        # if price_at_placement column hasn't been migrated yet on a fresh
        # env, fall back to the legacy SELECT shape and treat all bets as
        # grandfathered (entry-mode requires the column).
        msg = str(e).lower()
        if "price_at_placement" not in msg and "42703" not in msg and "pgrst" not in msg:
            raise
        log.warning("price_at_placement column missing — falling back to open-mode for all bets")
        res = (
            supabase.table("predictions")
            .select("id, user_id, stock_id, direction, credits_wagered, created_at, stocks(ticker)")
            .eq("prediction_date", target_date)
            .eq("resolved", False)
            .execute()
        )
    predictions = res.data or []

    log.info("user_predictions_to_resolve count=%s", len(predictions))

    run_id = None
    if not args.dry_run:
        run_id = start_pipeline_run(
            supabase, run_type="resolution", triggered_by="cron"
        )

    # Group by ticker so we only fetch each stock's day bar once.
    ticker_groups: dict[str, list[dict]] = {}
    for p in predictions:
        ticker = (p.get("stocks") or {}).get("ticker")
        if not ticker:
            log.warning("prediction_no_ticker id=%s", p["id"])
            continue
        ticker_groups.setdefault(ticker, []).append(p)

    stats = {"wins": 0, "losses": 0, "voids": 0, "errors": 0}

    for ticker, group in ticker_groups.items():
        try:
            open_price, close_price = await asyncio.to_thread(_fetch_day_bar, ticker, target_date)
        except Exception as e:  # noqa: BLE001
            log.exception("price_fetch_failed ticker=%s err=%s", ticker, e)
            for p in group:
                _resolve_void(supabase, p, log, dry_run=args.dry_run)
                stats["voids"] += 1
                stats["errors"] += 1
            continue

        if open_price is None or close_price is None:
            log.warning("missing_prices ticker=%s open=%s close=%s", ticker, open_price, close_price)
            for p in group:
                _resolve_void(supabase, p, log, dry_run=args.dry_run)
                stats["voids"] += 1
            continue

        for p in group:
            reference_price, mode = _choose_reference_price(
                bet=p, open_price=open_price, prediction_date=target_date
            )
            outcome, payout = _evaluate(
                direction=p["direction"],
                reference_price=reference_price,
                close_price=close_price,
                wagered=p["credits_wagered"],
            )
            if outcome == "WIN":
                stats["wins"] += 1
            elif outcome == "LOSS":
                stats["losses"] += 1
            else:
                stats["voids"] += 1

            if args.dry_run:
                log.info(
                    "dry_run_resolve id=%s ticker=%s dir=%s mode=%s ref=%.2f close=%.2f outcome=%s payout=%s",
                    p["id"], ticker, p["direction"], mode, reference_price,
                    close_price, outcome, payout,
                )
            else:
                _commit_resolution(
                    supabase=supabase,
                    prediction=p,
                    # `open_price` is still stored on the row (display
                    # fidelity — UI shows the day's open regardless of
                    # which reference resolved the bet).
                    open_price=open_price,
                    close_price=close_price,
                    outcome=outcome,
                    payout=payout,
                    log=log,
                )

    # ------------------------------------------------------------------
    # Resolve MarketMind's own verdicts for the same date.
    # Reuses the same price-fetch logic — independent of user predictions.
    # ------------------------------------------------------------------
    mm_stats = await _resolve_marketmind(
        supabase=supabase,
        target_date=target_date,
        dry_run=args.dry_run,
        log=log,
    )

    if run_id:
        complete_pipeline_run(
            supabase,
            run_id=run_id,
            status="success",
            stocks_processed=len(predictions) + mm_stats["count"],
            sources_succeeded=(
                stats["wins"] + stats["losses"] + stats["voids"]
                + mm_stats["wins"] + mm_stats["losses"] + mm_stats["voids"]
            ),
            sources_failed=stats["errors"] + mm_stats["errors"],
        )

    log.info(
        "resolve_done user_wins=%s user_losses=%s user_voids=%s errors=%s "
        "mm_wins=%s mm_losses=%s mm_voids=%s",
        stats["wins"], stats["losses"], stats["voids"], stats["errors"],
        mm_stats["wins"], mm_stats["losses"], mm_stats["voids"],
    )
    return 0


async def _resolve_marketmind(
    *,
    supabase: Any,
    target_date: str,
    dry_run: bool,
    log: logging.Logger,
) -> dict[str, int]:
    """Resolve MarketMind's own verdicts against the prediction window.

    The verdict is frozen at the 8 PM ET T-1 pipeline run, so the natural
    scoring window is T-1 close → T close (prev_close → close). Earlier
    code scored open → close, which discarded the overnight gap — the
    window where most pre-open news is priced — and effectively measured
    a different prediction than the one the model made.

    User predictions are still scored open → close (see ADR 0008): for
    user bets the window must match the bet-locking time, not the verdict
    time, because users can bet up to 1 PM ET on the trading day.
    """
    res = (
        supabase.table("marketmind_predictions")
        .select("id, stock_id, direction, stocks(ticker)")
        .eq("prediction_date", target_date)
        .eq("resolved", False)
        .neq("direction", "NEUTRAL")  # NEUTRAL = no claim → nothing to score
        .execute()
    )
    rows = res.data or []
    if not rows:
        log.info("no_unresolved_mm_predictions date=%s", target_date)
        return {"count": 0, "wins": 0, "losses": 0, "voids": 0, "errors": 0}

    log.info("mm_predictions_to_resolve count=%s", len(rows))

    # Group by ticker to fetch each day-bar once.
    by_ticker: dict[str, list[dict]] = {}
    for r in rows:
        ticker = (r.get("stocks") or {}).get("ticker")
        if not ticker:
            log.warning("mm_prediction_no_ticker id=%s", r["id"])
            continue
        by_ticker.setdefault(ticker, []).append(r)

    stats = {"count": len(rows), "wins": 0, "losses": 0, "voids": 0, "errors": 0}

    for ticker, group in by_ticker.items():
        try:
            prev_close, open_price, close_price = await asyncio.to_thread(
                _fetch_mm_prices, ticker, target_date
            )
        except Exception as e:  # noqa: BLE001
            log.exception("mm_price_fetch_failed ticker=%s err=%s", ticker, e)
            for r in group:
                _commit_mm_void(supabase, r, log, dry_run=dry_run)
                stats["voids"] += 1
                stats["errors"] += 1
            continue

        if prev_close is None or close_price is None:
            log.warning(
                "mm_missing_prices ticker=%s prev_close=%s close=%s",
                ticker, prev_close, close_price,
            )
            for r in group:
                _commit_mm_void(supabase, r, log, dry_run=dry_run)
                stats["voids"] += 1
            continue

        for r in group:
            outcome = _outcome_against_reference(
                direction=r["direction"],
                reference_price=prev_close,
                close_price=close_price,
            )
            if outcome == "WIN":
                stats["wins"] += 1
            elif outcome == "LOSS":
                stats["losses"] += 1
            else:
                stats["voids"] += 1

            if dry_run:
                log.info(
                    "dry_run_mm_resolve id=%s ticker=%s dir=%s prev_close=%.2f open=%s close=%.2f outcome=%s",
                    r["id"], ticker, r["direction"], prev_close,
                    f"{open_price:.2f}" if open_price is not None else "n/a",
                    close_price, outcome,
                )
            else:
                # `open_price` column on marketmind_predictions stores the
                # actual session open (display fidelity); the *outcome* was
                # computed against prev_close which we surface in the log
                # below. A future schema migration can add a dedicated
                # `reference_price` column for full audit.
                log.info(
                    "mm_resolve_scored id=%s ticker=%s prev_close=%.2f close=%.2f outcome=%s",
                    r["id"], ticker, prev_close, close_price, outcome,
                )
                _commit_mm_resolution(
                    supabase=supabase,
                    prediction_id=r["id"],
                    open_price=open_price,
                    close_price=close_price,
                    outcome=outcome,
                    log=log,
                )

    return stats


def _outcome_against_reference(
    *, direction: str, reference_price: float, close_price: float
) -> str:
    """Score a directional verdict against (reference_price → close_price).

    For MarketMind verdicts the reference is the previous session's close;
    for user predictions (a separate code path) it's the open.
    """
    if reference_price == close_price:
        return "VOID"
    moved_up = close_price > reference_price
    won = (direction == "UP" and moved_up) or (direction == "DOWN" and not moved_up)
    return "WIN" if won else "LOSS"


def _commit_mm_void(
    supabase: Any, row: dict, log: logging.Logger, *, dry_run: bool
) -> None:
    if dry_run:
        log.info("dry_run_mm_void id=%s reason=price_unavailable", row["id"])
        return
    _commit_mm_resolution(
        supabase=supabase,
        prediction_id=row["id"],
        open_price=None,
        close_price=None,
        outcome="VOID",
        log=log,
    )


def _commit_mm_resolution(
    *,
    supabase: Any,
    prediction_id: str,
    open_price: float | None,
    close_price: float | None,
    outcome: str,
    log: logging.Logger,
) -> None:
    supabase.table("marketmind_predictions").update({
        "resolved": True,
        "outcome": outcome,
        "open_price": open_price,
        "close_price": close_price,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", prediction_id).execute()
    log.info("mm_resolved id=%s outcome=%s", prediction_id, outcome)


def _fetch_day_bar(ticker: str, target_date: str) -> tuple[float | None, float | None]:
    """Returns (open, close) for the given trading day."""
    try:
        from curl_cffi import requests as cffi_requests

        session = cffi_requests.Session(impersonate="chrome")
    except ImportError:
        session = None

    df: pd.DataFrame = yf.download(
        to_yahoo_symbol(ticker),
        start=target_date,
        end=_next_day(target_date),
        interval="1d",
        progress=False,
        auto_adjust=False,
        threads=False,
        session=session,
    )

    if df.empty:
        return (None, None)

    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(level=1, axis=1)

    row = df.iloc[0]
    return (float(row["Open"]), float(row["Close"]))


def _fetch_mm_prices(
    ticker: str, target_date: str
) -> tuple[float | None, float | None, float | None]:
    """Returns (prev_close, open, close) for the target trading day.

    `prev_close` is the close of the most recent trading day STRICTLY before
    `target_date`. We grab a 10-calendar-day window so a long weekend or a
    market holiday (up to 3 closed days) still leaves us with a usable
    prior bar; yfinance only returns trading days, so we can rely on the
    last-two-rows pattern.
    """
    try:
        from curl_cffi import requests as cffi_requests

        session = cffi_requests.Session(impersonate="chrome")
    except ImportError:
        session = None

    start = (
        datetime.strptime(target_date, "%Y-%m-%d").date() - timedelta(days=10)
    ).isoformat()

    df: pd.DataFrame = yf.download(
        to_yahoo_symbol(ticker),
        start=start,
        end=_next_day(target_date),
        interval="1d",
        progress=False,
        auto_adjust=False,
        threads=False,
        session=session,
    )

    if df.empty:
        return (None, None, None)

    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(level=1, axis=1)

    # Confirm the last bar is actually `target_date` — guards against
    # market holidays where yfinance returns the prior day as the latest.
    last_idx = df.index[-1].date()
    target = datetime.strptime(target_date, "%Y-%m-%d").date()
    if last_idx != target:
        return (None, None, None)

    if len(df) < 2:
        # Insufficient history for a prev_close — can't score.
        return (None, float(df.iloc[-1]["Open"]), float(df.iloc[-1]["Close"]))

    prev = df.iloc[-2]
    today = df.iloc[-1]
    return (float(prev["Close"]), float(today["Open"]), float(today["Close"]))


def _next_day(iso_date: str) -> str:
    d = datetime.strptime(iso_date, "%Y-%m-%d").date()
    return (d.replace(day=d.day + 1) if d.day < 28 else date.fromordinal(d.toordinal() + 1)).isoformat()


def _resolve_void(supabase: Any, prediction: dict, log: logging.Logger, *, dry_run: bool) -> None:
    if dry_run:
        log.info("dry_run_void id=%s ticker=%s reason=price_unavailable",
                 prediction["id"], (prediction.get("stocks") or {}).get("ticker"))
        return
    _commit_resolution(
        supabase=supabase,
        prediction=prediction,
        open_price=None,
        close_price=None,
        outcome="VOID",
        payout=prediction["credits_wagered"],  # refund stake
        log=log,
    )


def _commit_resolution(
    *,
    supabase: Any,
    prediction: dict,
    open_price: float | None,
    close_price: float | None,
    outcome: str,
    payout: int,
    log: logging.Logger,
) -> None:
    user_id = prediction["user_id"]
    pred_id = prediction["id"]

    # 1. Update the prediction row
    supabase.table("predictions").update({
        "resolved": True,
        "outcome": outcome,
        "open_price": open_price,
        "close_price": close_price,
        "payout": payout,
        "resolved_at": datetime.now(timezone.utc).isoformat(),
    }).eq("id", pred_id).execute()

    # 2. Read current profile so we can derive new totals + balance_after
    profile_res = (
        supabase.table("user_profiles")
        .select("credit_balance, total_predictions, correct_predictions")
        .eq("id", user_id)
        .single()
        .execute()
    )
    profile = profile_res.data or {}
    balance = profile.get("credit_balance", 0)
    total = profile.get("total_predictions", 0)
    correct = profile.get("correct_predictions", 0)

    new_balance = balance + payout
    new_total = total + 1
    new_correct = correct + (1 if outcome == "WIN" else 0)

    # 3. Append to ledger (only when payout is non-zero — LOSS skips the ledger)
    if payout > 0:
        tx_type = "bet_won" if outcome == "WIN" else "refund_void"
        supabase.table("credit_transactions").insert({
            "user_id": user_id,
            "amount": payout,
            "type": tx_type,
            "reference_id": pred_id,
            "balance_after": new_balance,
        }).execute()

    # 4. Bump profile stats
    supabase.table("user_profiles").update({
        "credit_balance": new_balance,
        "total_predictions": new_total,
        "correct_predictions": new_correct,
    }).eq("id", user_id).execute()

    # 5. Badge awards. Idempotent — the RPC is ON CONFLICT DO NOTHING so
    # re-runs after a partial failure are safe. We only fire on the
    # cheap state transitions we can detect locally; streak badges are
    # awarded inside claim_daily_bonus where the streak math lives.
    if outcome == "WIN" and new_correct == 1:
        try:
            supabase.rpc(
                "award_badge",
                {
                    "p_user_id": user_id,
                    "p_badge_type": "FIRST_WIN",
                    "p_metadata": {"prediction_id": pred_id},
                },
            ).execute()
        except Exception as e:
            # Don't fail resolution if badge insert hiccups. Log and move on.
            log.warning("award_badge FIRST_WIN failed: %s", e)

    log.info("resolved id=%s outcome=%s payout=%s", pred_id, outcome, payout)


def main() -> int:
    parser = argparse.ArgumentParser(description="Resolve open MarketMind predictions.")
    parser.add_argument("--date", help="Resolution date (defaults to today, ISO format)")
    parser.add_argument("--dry-run", action="store_true", help="Don't write to DB")
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
