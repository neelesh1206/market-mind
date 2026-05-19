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
