"""
Weekly universe rotation — Phase 2 of ADR 0018.

Runs Sunday at 12:00 UTC (~7-8 AM ET depending on DST). Demotes stocks
that nobody is using; promotes top-voted user requests that validate.
The 50-stock universe size invariant is preserved (promote N = demote N).

Algorithm:
  1. Identify demotion candidates: active stocks with ZERO watchlists AND
     ZERO bets in the last 30 days. Ordered by ticker for determinism.
  2. Identify promotion candidates: stock_requests with >= 3 unique-user
     votes, sorted by vote count desc. (The RPC already excludes tickers
     that are currently active in the universe.)
  3. Validate each promotion candidate via Finnhub /stock/profile2 —
     confirms US listing + market cap >= threshold (defensive, the
     submit_stock_request RPC already checked these at request time,
     but a stock's market cap could have dropped below the threshold
     between request and rotation).
  4. swap_count = min(len(demotion_candidates), len(validated_promotions))
  5. Execute swaps: flip stocks.is_active, insert new rows, delete the
     consumed request rows. Audit each event in stock_rotations.
  6. For each newly-promoted stock, invoke fetch_insights as a subprocess
     to compute Monday's insights so the new stocks aren't empty on Monday.

Idempotent: re-running same-day is safe. Demoted stocks aren't selected
again (is_active=false). Promoted tickers aren't selected again
(present in stocks, request rows deleted).

CLI:
    python -m pipeline.compute_stock_rotation              # full run
    python -m pipeline.compute_stock_rotation --dry-run    # no DB writes
    python -m pipeline.compute_stock_rotation --skip-backfill
        # ↳ run rotation but don't subprocess fetch_insights for new stocks
        #   (useful for smoke testing when you don't want a 30-min wait)

Configurable via env:
    STOCK_REQUEST_MIN_MARKET_CAP_USD — defaults $2B
    STOCK_ROTATION_MIN_VOTES         — defaults 3
"""
from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
from datetime import date
from typing import Any

import httpx

from .config import load_config
from .observability import capture_error, init_logging, init_sentry
from .supabase_client import (
    complete_pipeline_run,
    delete_stock_requests_for_ticker,
    fetch_demotion_candidates,
    fetch_promotion_candidates,
    insert_promoted_stock,
    make_client,
    record_rotation,
    set_stock_active,
    start_pipeline_run,
)

log = logging.getLogger("marketmind.rotation")

FINNHUB_BASE = "https://finnhub.io/api/v1"
MIN_MARKET_CAP_USD = int(os.getenv("STOCK_REQUEST_MIN_MARKET_CAP_USD", "2000000000"))
MIN_VOTES = int(os.getenv("STOCK_ROTATION_MIN_VOTES", "3"))


def run(args: argparse.Namespace) -> int:
    cfg = load_config()
    init_sentry(cfg.sentry_dsn)
    init_logging(cfg.log_level)

    finnhub_key = os.getenv("FINNHUB_API_KEY") or cfg.finnhub_api_key
    if not finnhub_key:
        log.error("rotation_no_finnhub_key — set FINNHUB_API_KEY")
        return 2

    supabase = make_client(cfg.supabase_url, cfg.supabase_service_key)

    run_id: str | None = None
    if not args.dry_run:
        run_id = start_pipeline_run(
            supabase, run_type="rotation", triggered_by="cron"
        )
        log.info("rotation_start run_id=%s", run_id)
    else:
        log.info("rotation_start dry_run=True")

    stats = {
        "demotion_candidates": 0,
        "promotion_candidates": 0,
        "validated_promotions": 0,
        "demoted": 0,
        "promoted": 0,
        "backfilled": 0,
        "backfill_failed": 0,
    }

    try:
        # Step 1 — demotion candidates
        demotion_candidates = fetch_demotion_candidates(supabase)
        stats["demotion_candidates"] = len(demotion_candidates)
        log.info(
            "rotation_demotion_candidates count=%s tickers=%s",
            len(demotion_candidates),
            [s["ticker"] for s in demotion_candidates],
        )

        # Step 2 — promotion candidates (raw, pre-validation)
        promotion_candidates = fetch_promotion_candidates(supabase, min_votes=MIN_VOTES)
        stats["promotion_candidates"] = len(promotion_candidates)
        log.info(
            "rotation_promotion_candidates count=%s min_votes=%s",
            len(promotion_candidates),
            MIN_VOTES,
        )

        # Step 3 — validate each promotion candidate via Finnhub
        validated = _validate_candidates(promotion_candidates, finnhub_key)
        stats["validated_promotions"] = len(validated)
        log.info(
            "rotation_validated_promotions count=%s tickers=%s",
            len(validated),
            [v["ticker"] for v in validated],
        )

        # Step 4 — compute swap count (always-50 invariant)
        swap_count = min(len(demotion_candidates), len(validated))
        log.info(
            "rotation_swap_count count=%s "
            "(demotion_eligible=%s validated_promotions=%s)",
            swap_count,
            len(demotion_candidates),
            len(validated),
        )

        if swap_count == 0:
            log.info(
                "rotation_no_swaps — either no demotion candidates or no validated "
                "promotions this week. Universe unchanged."
            )
            if run_id:
                complete_pipeline_run(
                    supabase, run_id=run_id, status="success",
                    stocks_processed=0, sources_succeeded=0, sources_failed=0,
                )
            return 0

        to_demote = demotion_candidates[:swap_count]
        to_promote = validated[:swap_count]

        # Step 5 — execute swaps
        if args.dry_run:
            for s in to_demote:
                log.info(
                    "dry_run_demote ticker=%s id=%s reason=zero_watchlists_and_no_bets_30d",
                    s["ticker"], s["id"],
                )
            for v in to_promote:
                log.info(
                    "dry_run_promote ticker=%s name=%s votes=%s market_cap=%s",
                    v["ticker"], v["company_name"], v["vote_count"], v["market_cap_usd"],
                )
            log.info("rotation_dry_run_done %s", stats)
            return 0

        newly_promoted_tickers: list[str] = []
        for s in to_demote:
            set_stock_active(supabase, stock_id=s["id"], active=False)
            record_rotation(
                supabase,
                stock_id=s["id"],
                ticker=s["ticker"],
                action="demote",
                reason="zero_watchlists_and_no_bets_30d",
            )
            stats["demoted"] += 1
            log.info("rotation_demoted ticker=%s", s["ticker"])

        for v in to_promote:
            new_row = insert_promoted_stock(
                supabase,
                payload={
                    "ticker": v["ticker"],
                    "name": v["company_name"],
                    "sector": v.get("sector") or "Uncategorized",
                    "is_active": True,
                },
            )
            record_rotation(
                supabase,
                stock_id=new_row["id"],
                ticker=v["ticker"],
                action="promote",
                votes_at_action=v["vote_count"],
                reason="top_votes_validated",
            )
            delete_stock_requests_for_ticker(supabase, ticker=v["ticker"])
            stats["promoted"] += 1
            newly_promoted_tickers.append(v["ticker"])
            log.info(
                "rotation_promoted ticker=%s votes=%s market_cap=%s",
                v["ticker"], v["vote_count"], v["market_cap_usd"],
            )

        # Step 6 — backfill insights for newly-promoted stocks
        if not args.skip_backfill and newly_promoted_tickers:
            _backfill_insights(newly_promoted_tickers, stats=stats)

    except Exception as e:  # noqa: BLE001
        capture_error(e)
        log.exception("rotation_failed err=%s", e)
        if run_id:
            complete_pipeline_run(
                supabase, run_id=run_id, status="failed",
                stocks_processed=stats["demoted"] + stats["promoted"],
                sources_succeeded=stats["promoted"],
                sources_failed=stats["backfill_failed"],
                error_summary={"error": str(e)[:500]},
            )
        return 1

    if run_id:
        complete_pipeline_run(
            supabase, run_id=run_id, status="success",
            stocks_processed=stats["demoted"] + stats["promoted"],
            sources_succeeded=stats["promoted"],
            sources_failed=stats["backfill_failed"],
        )
    log.info("rotation_done %s", stats)
    return 0


def _validate_candidates(
    candidates: list[dict[str, Any]],
    finnhub_key: str,
) -> list[dict[str, Any]]:
    """For each candidate, fetch Finnhub /profile2 and confirm it still
    passes our eligibility gates. Augments each row with company_name (from
    Finnhub, canonical), sector, market_cap_usd.

    Synchronous loop with small pacing — at <=20 candidates this stays
    well under any rate-limit threshold. Failures are logged and skipped.
    """
    out: list[dict[str, Any]] = []
    with httpx.Client(timeout=5.0, follow_redirects=True) as client:
        for c in candidates:
            ticker = c["ticker"]
            try:
                resp = client.get(
                    f"{FINNHUB_BASE}/stock/profile2",
                    params={"symbol": ticker, "token": finnhub_key},
                )
                resp.raise_for_status()
                profile = resp.json() or {}
            except Exception as e:  # noqa: BLE001
                log.warning("validate_failed ticker=%s err=%s", ticker, e)
                continue

            if not profile.get("ticker") or not profile.get("name"):
                log.info("validate_skip ticker=%s reason=empty_profile", ticker)
                continue

            exchange = (profile.get("exchange") or "").upper()
            country = (profile.get("country") or "").upper()
            is_us_listed = (
                country == "US"
                or "NASDAQ" in exchange
                or "NYSE" in exchange
            )
            if not is_us_listed:
                log.info("validate_skip ticker=%s reason=not_us_listed", ticker)
                continue

            market_cap_mm = profile.get("marketCapitalization") or 0
            market_cap_usd = int(market_cap_mm * 1_000_000)
            if market_cap_usd < MIN_MARKET_CAP_USD:
                log.info(
                    "validate_skip ticker=%s reason=market_cap_below_threshold cap=%s",
                    ticker, market_cap_usd,
                )
                continue

            out.append({
                "ticker": ticker.upper(),
                "company_name": profile["name"],
                "sector": profile.get("finnhubIndustry") or "Uncategorized",
                "market_cap_usd": market_cap_usd,
                "vote_count": c["vote_count"],
            })
    return out


def _backfill_insights(tickers: list[str], *, stats: dict[str, Any]) -> None:
    """Compute insights for newly-promoted stocks by invoking the fetch_insights
    orchestrator once per ticker as a subprocess.

    Each subprocess invocation pays a ~30s FinBERT cold-start tax — fine
    for 1-3 new stocks per week. Avoids the cross-orchestrator dependency
    refactor that calling _process_stock directly would require, and gives
    us process isolation (a subprocess crash doesn't kill the rotation).
    """
    target_date = date.today().isoformat()
    for ticker in tickers:
        log.info("rotation_backfill_start ticker=%s target_date=%s", ticker, target_date)
        # Use the SAME Python that's running this script so we don't accidentally
        # invoke a different virtualenv in CI.
        cmd = [
            sys.executable, "-m", "pipeline.fetch_insights",
            "--ticker", ticker,
            "--date", target_date,
        ]
        try:
            result = subprocess.run(cmd, check=False, capture_output=True, text=True, timeout=20 * 60)
            if result.returncode != 0:
                stats["backfill_failed"] += 1
                log.warning(
                    "rotation_backfill_subprocess_failed ticker=%s exit=%s stderr=%s",
                    ticker, result.returncode, (result.stderr or "")[-500:],
                )
                continue
            stats["backfilled"] += 1
            log.info("rotation_backfill_done ticker=%s", ticker)
        except subprocess.TimeoutExpired:
            stats["backfill_failed"] += 1
            log.warning("rotation_backfill_timeout ticker=%s", ticker)
        except Exception as e:  # noqa: BLE001
            stats["backfill_failed"] += 1
            log.warning("rotation_backfill_error ticker=%s err=%s", ticker, e)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Weekly stock universe rotation (Phase 2 of ADR 0018)."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Don't write to DB; just log what would happen."
    )
    parser.add_argument(
        "--skip-backfill",
        action="store_true",
        help="Skip the per-newly-promoted-stock fetch_insights subprocess.",
    )
    args = parser.parse_args()
    return run(args)


if __name__ == "__main__":
    sys.exit(main())
