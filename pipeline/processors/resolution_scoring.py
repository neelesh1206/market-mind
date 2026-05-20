"""Pure-math scoring helpers for the resolution job.

Extracted from `pipeline/resolve_predictions.py` so unit tests can import
just these functions without pulling in pandas, yfinance, or any other
network/IO dependency. This mirrors the layout of `processors/verdict.py`
(pure math) vs `fetch_insights.py` (orchestrator with IO).

Two pieces of math live here:

1. **`_evaluate`** — given a reference price + close price + direction +
   wagered amount, returns (outcome, payout). The reference price is
   either today's open (legacy/grandfathered/pre-market path, ADR 0008)
   or the user's entry price (post-V2-cutoff in-market path, ADR 0017).

2. **`_choose_reference_price`** — picks which bar to score against,
   given the bet's metadata. See ADR 0017 for the decision tree.

Both functions are deterministic — no clock reads, no env reads.
"""
from __future__ import annotations

from datetime import datetime, time, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

PAYOUT_MULTIPLIER = Decimal("1.8")

# Per ADR 0017: bets created at or after this instant use the new
# entry-vs-close resolution model when placed during market hours. Any
# bet from before this instant stays on the original open-vs-close model
# (ADR 0008) so users who placed under the old rules aren't surprised by
# different math at resolution time.
#
# We hardcode the cutoff in code (not a migration / config) because:
#   - it never changes after first deploy
#   - it's the kind of decision that ought to live in version control
#   - audit becomes a single `git blame` on this line
RESOLUTION_V2_CUTOFF = datetime(2026, 5, 20, 19, 0, 0, tzinfo=timezone.utc)

_ET = ZoneInfo("America/New_York")


def _evaluate(
    *, direction: str, reference_price: float, close_price: float, wagered: int
) -> tuple[str, int]:
    """Score a single bet given the chosen reference price.

    `reference_price` is either today's open (pre-market bets or
    grandfathered bets — ADR 0008 model) or the user's price_at_placement
    (in-market bets after RESOLUTION_V2_CUTOFF — ADR 0017 model). The math
    is identical for both, only the bar shifts.
    """
    if reference_price == close_price:
        return ("VOID", wagered)  # refund the stake on a flat day

    moved_up = close_price > reference_price
    won = (direction == "UP" and moved_up) or (direction == "DOWN" and not moved_up)

    if won:
        payout = int((Decimal(wagered) * PAYOUT_MULTIPLIER).to_integral_value())
        return ("WIN", payout)
    return ("LOSS", 0)


def _market_open_utc(target_date: str) -> datetime:
    """Return 9:30 AM ET on `target_date` as a UTC-aware datetime.

    DST-correct via `zoneinfo` — EDT in summer (UTC-4), EST in winter
    (UTC-5). NYSE always opens at 9:30 wall-clock ET regardless of which.
    """
    d = datetime.strptime(target_date, "%Y-%m-%d").date()
    return datetime.combine(d, time(9, 30), tzinfo=_ET).astimezone(timezone.utc)


def _choose_reference_price(
    *, bet: dict, open_price: float, prediction_date: str
) -> tuple[float, str]:
    """Pick the bar that this bet is scored against.

    Returns (price, mode_label). The label is for logging only — the
    schema doesn't yet store which mode resolved each bet, since the
    derivation is deterministic from the (immutable) tuple of
    created_at, price_at_placement, and market_open. If we ever need
    audit-tier persistence we can add a `resolution_mode` column.

    Three branches, in order:
      1. Grandfathered — bet created before the V2 cutoff: open-mode.
      2. In-market with recorded entry: entry-mode.
      3. Anything else (pre-market today, or in-market but Finnhub failed
         at placement so price_at_placement is NULL): open-mode.
    """
    created_at_raw = bet.get("created_at")
    if not created_at_raw:
        # Defensive — predictions table mandates this column, but a manual
        # test row might lack it. Treat as legacy to avoid surprises.
        return open_price, "OPEN_NO_CREATED_AT"

    # Supabase REST returns ISO 8601 with 'Z' or '+00:00'. fromisoformat
    # since Python 3.11 handles both; we still normalize 'Z' just in case.
    created_at = datetime.fromisoformat(created_at_raw.replace("Z", "+00:00"))
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)

    if created_at < RESOLUTION_V2_CUTOFF:
        return open_price, "OPEN_GRANDFATHERED"

    entry = bet.get("price_at_placement")
    market_open = _market_open_utc(prediction_date)
    if (
        created_at > market_open
        and entry is not None
        and float(entry) > 0
    ):
        return float(entry), "ENTRY"

    return open_price, "OPEN"
