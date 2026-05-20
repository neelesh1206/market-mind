"""Supabase client + typed write helpers for the pipeline."""
from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID

from supabase import Client, create_client


def make_client(url: str, service_key: str) -> Client:
    """Service-role client — bypasses RLS. Pipeline-use only, never client-side."""
    return create_client(url, service_key)


def fetch_active_stocks(client: Client) -> list[dict[str, Any]]:
    """Return all active stocks in the pool."""
    res = client.table("stocks").select("*").eq("is_active", True).execute()
    return res.data or []


def upsert_stock_insight(client: Client, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Upsert a single stock_insights row on (stock_id, insight_date).
    Returns the inserted/updated row.
    """
    res = (
        client.table("stock_insights")
        .upsert(payload, on_conflict="stock_id,insight_date")
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise RuntimeError("upsert_stock_insight returned no rows")
    return rows[0]


def insert_articles(client: Client, articles: list[dict[str, Any]]) -> None:
    """Insert top articles for an insight.

    The schema has no natural-key uniqueness on (insight_id, headline) so a
    naive INSERT would create duplicates whenever the pipeline re-runs for
    the same date. To keep this idempotent we DELETE all rows for the
    insight first, then INSERT the fresh batch. Cheap — articles are 1-3
    rows per insight.
    """
    if not articles:
        return
    insight_ids = list({a["insight_id"] for a in articles if a.get("insight_id")})
    if insight_ids:
        client.table("insight_articles").delete().in_("insight_id", insight_ids).execute()
    client.table("insight_articles").insert(articles).execute()


def upsert_marketmind_prediction(client: Client, payload: dict[str, Any]) -> None:
    """Upsert MarketMind's verdict for (stock_id, prediction_date)."""
    client.table("marketmind_predictions").upsert(
        payload, on_conflict="stock_id,prediction_date"
    ).execute()


def fetch_marketmind_rows_for_ranking(
    client: Client, *, prediction_date: str
) -> list[dict[str, Any]]:
    """Pull rows we'll cross-sectionally rank — only the columns we need.

    Filters out rows where `combined_score` is NULL (e.g. all-buckets-missing
    NEUTRAL verdicts) so the rank ordering is well-defined.
    """
    res = (
        client.table("marketmind_predictions")
        .select("id, stock_id, combined_score, stocks(ticker)")
        .eq("prediction_date", prediction_date)
        .not_.is_("combined_score", "null")
        .execute()
    )
    return res.data or []


def update_marketmind_rank(client: Client, *, row_id: str, rank: int) -> None:
    """Set rank_in_universe on one prediction row."""
    client.table("marketmind_predictions").update(
        {"rank_in_universe": rank}
    ).eq("id", row_id).execute()


def record_source(
    client: Client,
    *,
    insight_id: UUID | str,
    source_name: str,
    status: str,
    latency_ms: int | None = None,
    error_detail: str | None = None,
    raw_data: dict[str, Any] | None = None,
) -> None:
    client.table("stock_insight_sources").insert(
        {
            "insight_id": str(insight_id),
            "source_name": source_name,
            "status": status,
            "latency_ms": latency_ms,
            "error_detail": error_detail,
            "raw_data": raw_data,
        }
    ).execute()


def start_pipeline_run(client: Client, *, run_type: str, triggered_by: str = "cron") -> str:
    res = (
        client.table("pipeline_runs")
        .insert({"run_type": run_type, "status": "running", "triggered_by": triggered_by})
        .execute()
    )
    return res.data[0]["id"]


def complete_pipeline_run(
    client: Client,
    *,
    run_id: str,
    status: str,
    stocks_processed: int,
    sources_succeeded: int,
    sources_failed: int,
    error_summary: dict[str, Any] | None = None,
) -> None:
    client.table("pipeline_runs").update(
        {
            "status": status,
            "completed_at": "now()",
            "stocks_processed": stocks_processed,
            "sources_succeeded": sources_succeeded,
            "sources_failed": sources_failed,
            "error_summary": error_summary,
        }
    ).eq("id", run_id).execute()


# =============================================================================
# Weekly universe rotation helpers — Phase 2 of ADR 0018
# =============================================================================


def fetch_demotion_candidates(
    client: Client, *, bet_lookback_days: int = 30
) -> list[dict[str, Any]]:
    """Return active stocks eligible for demotion.

    Eligibility (both must hold):
      - Zero rows in `user_watchlist` reference this stock_id
      - Zero rows in `predictions` reference this stock_id in last N days

    Returns the full stock row (id, ticker, name, sector, sub_sector) so the
    caller can record audit rows + decide ordering. Sorted by ticker for
    deterministic output across runs (tests rely on this).
    """
    # We can't easily express "NOT EXISTS" via the PostgREST builder, so
    # we pull all active stocks + the IDs that ARE referenced, then
    # subtract. At ~50 active stocks + small watchlist/bet tables this is
    # negligible.
    active_res = (
        client.table("stocks")
        .select("id, ticker, name, sector, sub_sector")
        .eq("is_active", True)
        .order("ticker")
        .execute()
    )
    active = active_res.data or []
    if not active:
        return []

    watchlist_res = (
        client.table("user_watchlist").select("stock_id").execute()
    )
    watched_ids = {r["stock_id"] for r in (watchlist_res.data or [])}

    # `predictions` doesn't include resolved/unresolved distinction here —
    # if anyone placed a bet within the window, the stock isn't demotable.
    from datetime import datetime, timedelta, timezone

    since = (datetime.now(timezone.utc) - timedelta(days=bet_lookback_days)).isoformat()
    bets_res = (
        client.table("predictions")
        .select("stock_id")
        .gte("created_at", since)
        .execute()
    )
    recently_bet_ids = {r["stock_id"] for r in (bets_res.data or [])}

    eligible = [
        s for s in active
        if s["id"] not in watched_ids and s["id"] not in recently_bet_ids
    ]
    return eligible


def fetch_promotion_candidates(
    client: Client, *, min_votes: int = 3
) -> list[dict[str, Any]]:
    """Return top stock-request tickers eligible for promotion.

    Reads from the `get_top_stock_requests` RPC (which already excludes
    tickers that are currently in the active universe) and filters to
    those with >= min_votes. Returned sorted by vote count desc.

    The caller must still validate each ticker via Finnhub before
    actually promoting — this just enumerates *candidate* tickers.
    """
    res = client.rpc("get_top_stock_requests", {"p_limit": 200}).execute()
    rows = res.data or []
    eligible = [
        {
            "ticker": r["ticker"],
            "company_name": r.get("company_name"),
            "vote_count": r["vote_count"],
        }
        for r in rows
        if r.get("vote_count", 0) >= min_votes
    ]
    return eligible


def set_stock_active(client: Client, *, stock_id: str, active: bool) -> None:
    """Flip stocks.is_active. Used by rotation to demote/un-demote."""
    client.table("stocks").update({"is_active": active}).eq("id", stock_id).execute()


def insert_promoted_stock(client: Client, *, payload: dict[str, Any]) -> dict[str, Any]:
    """Insert a new stocks row for a promoted ticker.

    Payload expects at minimum: ticker, name, sector. is_active defaults
    to true. Returns the inserted row (with id).

    Sector is required by the existing schema; the rotation pipeline
    passes 'Uncategorized' for tickers we don't have a Finnhub sector
    mapping for yet. We'd refine sector lookup later (Finnhub /stock/profile2
    returns a `finnhubIndustry` field which is close enough).
    """
    res = client.table("stocks").insert(payload).execute()
    rows = res.data or []
    if not rows:
        raise RuntimeError("insert_promoted_stock returned no rows")
    return rows[0]


def record_rotation(
    client: Client,
    *,
    stock_id: str,
    ticker: str,
    action: str,
    votes_at_action: int | None = None,
    reason: str | None = None,
) -> None:
    """Insert a row in stock_rotations for audit. Never raises."""
    try:
        client.table("stock_rotations").insert(
            {
                "stock_id": stock_id,
                "ticker": ticker,
                "action": action,
                "votes_at_action": votes_at_action,
                "reason": reason,
            }
        ).execute()
    except Exception as e:  # noqa: BLE001
        # Audit write failure shouldn't block the rotation. Log via stderr.
        import logging
        logging.getLogger("marketmind.rotation").warning(
            "record_rotation_failed stock_id=%s action=%s err=%s",
            stock_id, action, e,
        )


def delete_stock_requests_for_ticker(client: Client, *, ticker: str) -> int:
    """Clean up stock_requests rows for a ticker that's now in the universe.

    Called immediately after a successful promotion — the requests have
    served their purpose, and `get_top_stock_requests` filters them out
    anyway via the LEFT JOIN. Deleting them keeps the table tidy.

    Returns count of rows deleted (best-effort; some Supabase REST
    configurations return null counts, in which case we return 0).
    """
    res = (
        client.table("stock_requests")
        .delete()
        .eq("ticker", ticker.upper())
        .execute()
    )
    return len(res.data or [])
