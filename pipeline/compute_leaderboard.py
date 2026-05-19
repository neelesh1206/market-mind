"""
Weekly leaderboard snapshot job.

Computes the leaderboard for a given week (Mon-Sun) and upserts into
`weekly_leaderboard_snapshots`. Designed to run via GitHub Actions cron on
Sunday evening UTC — by then all of Mon-Fri resolutions have completed
(resolution job runs 4:15 PM ET / 21:15 UTC daily).

Eligibility: a user must have at least 5 *decisive* bets (WIN or LOSS)
that resolved in the week. Voids (flat-tape) don't count toward the
denominator — they're not "wrong" calls, they're unresolvable ones.

Ranking: accuracy desc, decisive count desc as tiebreaker. tier:
  rank 1     → "diamond"
  rank 2-3   → "platinum"
  rank 4-10  → "gold"
  rank 11+   → null

Idempotent — uses (week_start, user_id) upsert so re-runs overwrite.

CLI:
    python -m pipeline.compute_leaderboard                        # last completed week
    python -m pipeline.compute_leaderboard --week-start 2026-05-12
    python -m pipeline.compute_leaderboard --dry-run
"""
from __future__ import annotations

import argparse
import logging
import sys
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .config import load_config
from .observability import init_logging, init_sentry
from .supabase_client import make_client, start_pipeline_run, complete_pipeline_run

log = logging.getLogger("leaderboard")

MIN_DECISIVE_BETS = 5


def previous_monday(today: date) -> date:
    """The Monday of the most recently completed week.

    Sunday → return Monday of this week (which just ended).
    Mon-Sat → return Monday of *last* week (this week isn't done yet).
    """
    # weekday(): Mon=0, Sun=6
    if today.weekday() == 6:  # Sunday
        return today - timedelta(days=6)
    # Any other day: go to last Sunday, then back 6 more.
    days_since_sunday = (today.weekday() + 1) % 7
    last_sunday = today - timedelta(days=days_since_sunday)
    return last_sunday - timedelta(days=6)


def tier_for_rank(rank: int) -> str | None:
    if rank == 1:
        return "diamond"
    if rank <= 3:
        return "platinum"
    if rank <= 10:
        return "gold"
    return None


def compute(args: argparse.Namespace) -> int:
    cfg = load_config()
    init_sentry(cfg.sentry_dsn)
    supabase = make_client(cfg.supabase_url, cfg.supabase_service_key)

    if args.week_start:
        week_start = date.fromisoformat(args.week_start)
    else:
        week_start = previous_monday(date.today())
    week_end = week_start + timedelta(days=6)

    log.info("computing leaderboard week_start=%s week_end=%s", week_start, week_end)

    run_id = start_pipeline_run(supabase, run_type="leaderboard")

    try:
        rows = _query_predictions(supabase, week_start, week_end)
        per_user = _aggregate(rows)
        eligible = [u for u in per_user if u["decisive"] >= MIN_DECISIVE_BETS]
        eligible.sort(key=lambda u: (-u["accuracy"], -u["decisive"]))

        # Denormalize display_name at snapshot time — leaderboard read path
        # is auth-context (own_read on user_profiles), so it can't join.
        name_by_user = _fetch_display_names(
            supabase, [u["user_id"] for u in eligible]
        )

        snapshots = []
        for rank, u in enumerate(eligible, start=1):
            snapshots.append({
                "week_start": week_start.isoformat(),
                "user_id": u["user_id"],
                "rank": rank,
                "credits_won": u["credits_won"],
                "accuracy": round(u["accuracy"] * 100, 2),
                "predictions": u["decisive"],
                "tier": tier_for_rank(rank),
                "display_name": name_by_user.get(u["user_id"]),
            })

        log.info(
            "leaderboard computed: %d users with bets, %d eligible (≥%d decisive)",
            len(per_user),
            len(eligible),
            MIN_DECISIVE_BETS,
        )

        if args.dry_run:
            log.info("dry-run: would upsert %d snapshot rows", len(snapshots))
            for s in snapshots[:10]:
                log.info("  rank=%d user=%s accuracy=%.2f%% decisive=%d tier=%s",
                         s["rank"], s["user_id"], s["accuracy"], s["predictions"], s["tier"])
        elif snapshots:
            # First clear any stale rows for this week (e.g. if a user dropped
            # below the threshold on re-run), then upsert fresh.
            supabase.table("weekly_leaderboard_snapshots").delete().eq(
                "week_start", week_start.isoformat()
            ).execute()
            supabase.table("weekly_leaderboard_snapshots").insert(snapshots).execute()
            log.info("upserted %d snapshot rows", len(snapshots))
        else:
            # Still clear stale rows even if no one qualifies this week.
            supabase.table("weekly_leaderboard_snapshots").delete().eq(
                "week_start", week_start.isoformat()
            ).execute()
            log.info("no eligible users this week — cleared any stale snapshots")

        complete_pipeline_run(
            supabase,
            run_id=run_id,
            status="success",
            stocks_processed=0,
            sources_succeeded=len(eligible),
            sources_failed=0,
            error_summary={
                "week_start": week_start.isoformat(),
                "eligible_count": len(eligible),
                "total_users_with_bets": len(per_user),
            },
        )
        return 0
    except Exception as e:
        log.exception("leaderboard run failed")
        complete_pipeline_run(
            supabase,
            run_id=run_id,
            status="failed",
            stocks_processed=0,
            sources_succeeded=0,
            sources_failed=1,
            error_summary={"error": str(e), "week_start": week_start.isoformat()},
        )
        return 1


def _fetch_display_names(supabase, user_ids: list[str]) -> dict[str, str | None]:
    """Service-role bulk fetch — bypasses RLS to read all eligible users' names."""
    if not user_ids:
        return {}
    res = (
        supabase.table("user_profiles")
        .select("id, display_name")
        .in_("id", user_ids)
        .execute()
    )
    return {row["id"]: row.get("display_name") for row in (res.data or [])}


def _query_predictions(supabase, week_start: date, week_end: date) -> list[dict[str, Any]]:
    """Pull all resolved predictions in the [week_start, week_end] window."""
    res = (
        supabase.table("predictions")
        .select("user_id, outcome, credits_wagered, payout")
        .eq("resolved", True)
        .gte("prediction_date", week_start.isoformat())
        .lte("prediction_date", week_end.isoformat())
        .execute()
    )
    return res.data or []


def _aggregate(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Group by user and compute per-user stats."""
    by_user: dict[str, dict[str, Any]] = defaultdict(
        lambda: {"wins": 0, "losses": 0, "voids": 0, "credits_won": 0}
    )
    for r in rows:
        uid = r["user_id"]
        outcome = r["outcome"]
        payout = r.get("payout") or 0
        wagered = r.get("credits_wagered") or 0
        if outcome == "WIN":
            by_user[uid]["wins"] += 1
            by_user[uid]["credits_won"] += payout - wagered  # net profit
        elif outcome == "LOSS":
            by_user[uid]["losses"] += 1
            by_user[uid]["credits_won"] -= wagered
        elif outcome == "VOID":
            by_user[uid]["voids"] += 1
            # VOID is a wash — payout == wagered, net 0.

    out = []
    for uid, agg in by_user.items():
        decisive = agg["wins"] + agg["losses"]
        accuracy = agg["wins"] / decisive if decisive > 0 else 0.0
        out.append({
            "user_id": uid,
            "wins": agg["wins"],
            "losses": agg["losses"],
            "voids": agg["voids"],
            "decisive": decisive,
            "accuracy": accuracy,
            "credits_won": agg["credits_won"],
        })
    return out


def main() -> int:
    parser = argparse.ArgumentParser(description="Compute weekly leaderboard snapshot.")
    parser.add_argument("--week-start", help="Monday of target week (YYYY-MM-DD). Default: most recently completed week.")
    parser.add_argument("--dry-run", action="store_true", help="Compute + log; don't write.")
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()
    init_logging(args.log_level)
    return compute(args)


if __name__ == "__main__":
    sys.exit(main())
