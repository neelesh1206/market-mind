"""
Weekly refresh of `universe_eligible_stocks`.

Run weekly via Cloudflare Worker → GH Actions cron (Sunday 04:00 UTC,
see ADR 0018). Bulk-loads the table with US-listed common stocks above
$2B market cap, which is the pool users can request additions from on
the /stocks → Request tab.

Architecture rationale (ADR 0018 amendment, 2026-05-20):
  - search and validation hit this table directly (Postgres only)
  - no Finnhub call on the request-handling path
  - Finnhub's 60/min quota stays isolated for live prices

Run:
  - Bootstrap (first time): ~3h 20m at 60 calls/min for ~12K US tickers
  - Steady-state weekly: ~30-45m (only the ~2000 already-eligible
    tickers + a few hundred candidates near the threshold get refreshed)

CLI:
  python -m pipeline.refresh_eligible_universe              # full run
  python -m pipeline.refresh_eligible_universe --dry-run    # no DB writes
  python -m pipeline.refresh_eligible_universe --limit 100  # smoke test
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import os
import sys
import time
from datetime import datetime, timezone
from typing import Any

import httpx

from .config import load_config
from .observability import capture_error, init_logging, init_sentry
from .supabase_client import (
    complete_pipeline_run,
    make_client,
    start_pipeline_run,
)

log = logging.getLogger("marketmind.refresh_universe")

FINNHUB_BASE = "https://finnhub.io/api/v1"
MIN_MARKET_CAP_USD = int(os.getenv("STOCK_REQUEST_MIN_MARKET_CAP_USD", "2000000000"))

# Finnhub free tier: 60 calls/min, 30 calls/sec. We pace at 1.1 calls/sec
# (= ~65/min) which keeps us well under the burst limit. The 0.1s buffer
# protects against drift on slow days.
PACING_DELAY_SECONDS = 1.1

# Per-call timeout — profile2 is fast (~100-300ms) so a 5s cap catches
# stalls without delaying the run unnecessarily.
FINNHUB_TIMEOUT_SECONDS = 5.0


async def run(args: argparse.Namespace) -> int:
    cfg = load_config()
    init_sentry(cfg.sentry_dsn)
    init_logging(cfg.log_level)

    finnhub_key = os.getenv("FINNHUB_API_KEY") or cfg.finnhub_api_key
    if not finnhub_key:
        log.error("refresh_universe_no_key — FINNHUB_API_KEY not set")
        return 2

    supabase = make_client(cfg.supabase_url, cfg.supabase_service_key)

    run_id: str | None = None
    if not args.dry_run:
        run_id = start_pipeline_run(
            supabase, run_type="refresh_universe", triggered_by="cron"
        )
        log.info("refresh_universe_start run_id=%s", run_id)
    else:
        log.info("refresh_universe_start dry_run=True")

    stats = {
        "candidates_fetched": 0,
        "profiles_fetched": 0,
        "profiles_failed": 0,
        "eligible_count": 0,
        "below_threshold": 0,
        "not_us_listed": 0,
        "upserted": 0,
        "removed": 0,
    }

    try:
        async with httpx.AsyncClient(timeout=FINNHUB_TIMEOUT_SECONDS) as client:
            # Step 1: pull the candidate symbol list. One Finnhub call.
            candidates = await _fetch_us_symbols(client, finnhub_key)
            stats["candidates_fetched"] = len(candidates)
            log.info("refresh_universe_candidates count=%s", len(candidates))

            if args.limit:
                candidates = candidates[: args.limit]
                log.info("refresh_universe_limit applied=%s", args.limit)

            # Step 2: for each candidate, fetch market cap via profile2.
            # We pace at PACING_DELAY_SECONDS to stay under the 60/min quota.
            eligible_rows: list[dict[str, Any]] = []
            start = time.time()
            for idx, symbol in enumerate(candidates):
                if idx > 0:
                    await asyncio.sleep(PACING_DELAY_SECONDS)
                row = await _fetch_eligible_row(client, finnhub_key, symbol)
                stats["profiles_fetched"] += 1
                if row is None:
                    stats["profiles_failed"] += 1
                    continue
                if row["_eligibility"] == "below_threshold":
                    stats["below_threshold"] += 1
                    continue
                if row["_eligibility"] == "not_us_listed":
                    stats["not_us_listed"] += 1
                    continue
                eligible_rows.append({
                    "ticker": row["ticker"],
                    "company_name": row["company_name"],
                    "exchange": row["exchange"],
                    "market_cap_usd": row["market_cap_usd"],
                    "refreshed_at": datetime.now(timezone.utc).isoformat(),
                })
                if (idx + 1) % 100 == 0:
                    elapsed = time.time() - start
                    log.info(
                        "refresh_universe_progress %s/%s elapsed=%.1fs eligible_so_far=%s",
                        idx + 1, len(candidates), elapsed, len(eligible_rows),
                    )

            stats["eligible_count"] = len(eligible_rows)

            # Step 3: bulk upsert the eligible rows. We do this in chunks
            # because Supabase's REST API has a payload-size limit; 200 rows
            # per chunk is comfortable.
            if not args.dry_run:
                stats["upserted"] = _bulk_upsert(supabase, eligible_rows)
                # Remove rows that are no longer eligible (didn't appear in
                # this run). Match by ticker — the eligibility table is
                # `ticker` as PK, so a DELETE WHERE NOT IN cleans up.
                stats["removed"] = _delete_missing(supabase, eligible_rows)

    except Exception as e:  # noqa: BLE001
        capture_error(e)
        log.exception("refresh_universe_failed err=%s", e)
        if run_id:
            complete_pipeline_run(
                supabase,
                run_id=run_id,
                status="failed",
                stocks_processed=stats["profiles_fetched"],
                sources_succeeded=stats["upserted"],
                sources_failed=stats["profiles_failed"],
                error_summary={"error": str(e)[:500]},
            )
        return 1

    if run_id:
        complete_pipeline_run(
            supabase,
            run_id=run_id,
            status="success",
            stocks_processed=stats["profiles_fetched"],
            sources_succeeded=stats["upserted"],
            sources_failed=stats["profiles_failed"],
        )

    log.info("refresh_universe_done %s", stats)
    return 0


async def _fetch_us_symbols(client: httpx.AsyncClient, api_key: str) -> list[str]:
    """One Finnhub call returns ALL US-listed symbols. We filter to common
    stock by `type` to drop ETFs, warrants, etc."""
    url = f"{FINNHUB_BASE}/stock/symbol?exchange=US&token={api_key}"
    resp = await client.get(url)
    resp.raise_for_status()
    data = resp.json()
    # Defensive: not all rows have `type`. We keep the ones explicitly
    # marked Common Stock; "Common Stock" is the canonical Finnhub label.
    common = [
        r["symbol"]
        for r in data
        if r.get("type") == "Common Stock"
        and r.get("symbol")
        # Filter foreign listings: a ticker with a dot is usually an ADR
        # variant ("BRK.B" is fine; "AAPL.DE" is the German listing).
        and (not r["symbol"].count(".") > 1)
    ]
    return sorted(set(common))


async def _fetch_eligible_row(
    client: httpx.AsyncClient,
    api_key: str,
    symbol: str,
) -> dict[str, Any] | None:
    """Fetch /stock/profile2 for one ticker; return the eligibility-evaluated
    row, or None on failure (caller bumps profiles_failed)."""
    url = f"{FINNHUB_BASE}/stock/profile2?symbol={symbol}&token={api_key}"
    try:
        resp = await client.get(url)
        resp.raise_for_status()
    except Exception as e:  # noqa: BLE001
        log.warning("refresh_universe_profile_fail symbol=%s err=%s", symbol, e)
        return None
    profile = resp.json() or {}
    if not profile.get("ticker") or not profile.get("name"):
        # Empty profile = ticker doesn't resolve. Treat as "below threshold"
        # for stats purposes (it'll get removed if it was previously eligible).
        return None

    exchange = profile.get("exchange") or ""
    country = profile.get("country") or ""
    is_us_listed = (
        country == "US"
        or "NASDAQ" in exchange.upper()
        or "NYSE" in exchange.upper()
    )
    if not is_us_listed:
        return {"_eligibility": "not_us_listed"}

    # Finnhub returns market cap in MILLIONS USD. Convert to USD bigint.
    market_cap_mm = profile.get("marketCapitalization") or 0
    market_cap_usd = int(market_cap_mm * 1_000_000)
    if market_cap_usd < MIN_MARKET_CAP_USD:
        return {"_eligibility": "below_threshold"}

    return {
        "_eligibility": "eligible",
        "ticker": profile["ticker"].upper(),
        "company_name": profile["name"],
        "exchange": exchange,
        "market_cap_usd": market_cap_usd,
    }


def _bulk_upsert(supabase: Any, rows: list[dict[str, Any]]) -> int:
    """Upsert in chunks of 200. Returns total successfully upserted."""
    if not rows:
        return 0
    CHUNK = 200
    written = 0
    for start in range(0, len(rows), CHUNK):
        chunk = rows[start : start + CHUNK]
        supabase.table("universe_eligible_stocks").upsert(
            chunk, on_conflict="ticker"
        ).execute()
        written += len(chunk)
    return written


def _delete_missing(supabase: Any, current_rows: list[dict[str, Any]]) -> int:
    """Remove rows from universe_eligible_stocks that aren't in the current run.
    This handles the case of a ticker dropping below the threshold week-over-week."""
    if not current_rows:
        # Defensive: if we somehow got zero eligible rows, do NOT delete
        # everything (likely indicates a Finnhub-side issue, not actual
        # universe collapse). Bail.
        log.warning("refresh_universe_delete_skipped reason=zero_current_rows")
        return 0

    current_tickers = [r["ticker"] for r in current_rows]
    # Supabase Python client doesn't expose NOT IN directly on .delete();
    # we read existing tickers and compute the set difference, then delete
    # by IN. At ~2000 rows this is cheap.
    existing = (
        supabase.table("universe_eligible_stocks")
        .select("ticker")
        .execute()
    )
    existing_tickers = {r["ticker"] for r in (existing.data or [])}
    stale = list(existing_tickers - set(current_tickers))
    if not stale:
        return 0
    # Delete in chunks too (REST URL length limit).
    CHUNK = 200
    deleted = 0
    for i in range(0, len(stale), CHUNK):
        batch = stale[i : i + CHUNK]
        supabase.table("universe_eligible_stocks").delete().in_(
            "ticker", batch
        ).execute()
        deleted += len(batch)
    log.info("refresh_universe_removed stale_count=%s", deleted)
    return deleted


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Refresh universe_eligible_stocks from Finnhub."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Do not write to Supabase."
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Process only first N candidates (smoke testing).",
    )
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
