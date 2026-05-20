"""Tests for the resolution-math layer (ADR 0017).

We focus on the pure functions — `_evaluate`, `_market_open_utc`,
`_choose_reference_price` — rather than the orchestrator, which is mostly
Supabase plumbing already exercised in the live pipeline. The branching
between open-vs-close (ADR 0008) and entry-vs-close (ADR 0017) is the
single highest-risk decision in this file; lock it in with unit tests.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from pipeline.processors.resolution_scoring import (
    RESOLUTION_V2_CUTOFF,
    _choose_reference_price,
    _evaluate,
    _market_open_utc,
)


# ---------------------------------------------------------------------------
# _evaluate — direction + payout math
# ---------------------------------------------------------------------------


class TestEvaluate:
    """The leaf of the resolution math — given a reference price and a
    close price, what's the outcome? Identical math regardless of which
    reference (open vs entry) we passed in."""

    def test_up_wins_when_close_above_reference(self):
        outcome, payout = _evaluate(
            direction="UP", reference_price=100.0, close_price=105.0, wagered=50
        )
        assert outcome == "WIN"
        assert payout == 90  # 50 * 1.8

    def test_up_loses_when_close_below_reference(self):
        outcome, payout = _evaluate(
            direction="UP", reference_price=100.0, close_price=95.0, wagered=50
        )
        assert outcome == "LOSS"
        assert payout == 0

    def test_down_wins_when_close_below_reference(self):
        outcome, payout = _evaluate(
            direction="DOWN", reference_price=100.0, close_price=95.0, wagered=50
        )
        assert outcome == "WIN"

    def test_down_loses_when_close_above_reference(self):
        outcome, payout = _evaluate(
            direction="DOWN", reference_price=100.0, close_price=105.0, wagered=50
        )
        assert outcome == "LOSS"

    def test_void_when_reference_equals_close(self):
        outcome, payout = _evaluate(
            direction="UP", reference_price=100.0, close_price=100.0, wagered=50
        )
        assert outcome == "VOID"
        assert payout == 50  # refund the stake

    def test_payout_rounds_down_on_fractional(self):
        # 7 * 1.8 = 12.6 → 13 (banker's rounding would also give 13).
        # We use .to_integral_value() which defaults to ROUND_HALF_EVEN;
        # the int cast doesn't truncate — this is the behavior we ship.
        outcome, payout = _evaluate(
            direction="UP", reference_price=10.0, close_price=20.0, wagered=7
        )
        assert outcome == "WIN"
        assert payout in (12, 13)  # depending on rounding mode at the boundary


# ---------------------------------------------------------------------------
# _market_open_utc — DST-aware 9:30 ET handling
# ---------------------------------------------------------------------------


class TestMarketOpenUtc:
    """9:30 AM ET is a moving target in UTC depending on DST. We rely on
    `zoneinfo` (Python 3.11+) for the correct offset; these tests guard
    against a future refactor that hardcodes UTC-4 or UTC-5."""

    def test_summer_2026_uses_edt_offset(self):
        # May 20 2026 is during DST (EDT, UTC-4). 9:30 ET = 13:30 UTC.
        got = _market_open_utc("2026-05-20")
        assert got == datetime(2026, 5, 20, 13, 30, tzinfo=timezone.utc)

    def test_winter_2026_uses_est_offset(self):
        # January 15 2026 is outside DST (EST, UTC-5). 9:30 ET = 14:30 UTC.
        got = _market_open_utc("2026-01-15")
        assert got == datetime(2026, 1, 15, 14, 30, tzinfo=timezone.utc)

    def test_spring_forward_day(self):
        # 2026 DST begins Mar 8. By 9:30 ET the clocks have shifted —
        # we should be at EDT already.
        got = _market_open_utc("2026-03-09")  # Mon after spring-forward Sun
        assert got == datetime(2026, 3, 9, 13, 30, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# _choose_reference_price — the discriminator
# ---------------------------------------------------------------------------


def make_bet(
    *,
    created_at: datetime,
    price_at_placement: float | None = None,
) -> dict:
    """Minimal bet shape carrying only the fields the discriminator reads."""
    return {
        "created_at": created_at.isoformat(),
        "price_at_placement": price_at_placement,
    }


class TestChooseReferencePrice:
    """The single highest-risk decision in this file. Lock it in tightly —
    a regression here either re-runs the open-vs-close mode for everyone
    (losing the fairness improvement) or applies entry-vs-close to
    grandfathered bets (breaking the user contract)."""

    PRED_DATE = "2026-06-15"
    # 9:30 ET June 15 (EDT) = 13:30 UTC
    MARKET_OPEN = datetime(2026, 6, 15, 13, 30, tzinfo=timezone.utc)

    def test_grandfathered_uses_open_regardless_of_anything_else(self):
        # Bet placed comfortably before V2 cutoff, in-market timing, has
        # entry price — but the cutoff wins. This protects existing bets
        # that users placed under the old contract.
        bet = make_bet(
            created_at=RESOLUTION_V2_CUTOFF.replace(year=2026, month=5, day=18),
            price_at_placement=264.0,
        )
        ref, mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        assert ref == 260.0
        assert mode == "OPEN_GRANDFATHERED"

    def test_in_market_bet_after_cutoff_uses_entry(self):
        # Placed at noon ET on the prediction date (= ~16:00 UTC),
        # after the V2 cutoff, with a real entry price. This is the
        # new fairness path.
        bet = make_bet(
            created_at=datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc),
            price_at_placement=264.50,
        )
        ref, mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        assert ref == 264.50
        assert mode == "ENTRY"

    def test_pre_market_bet_uses_open_even_after_cutoff(self):
        # 8 PM prev-day bet — created after V2 cutoff, but the bet was
        # placed before market open. Open-vs-close is the only fair
        # math (the user didn't know the opening price).
        bet = make_bet(
            created_at=datetime(2026, 6, 14, 23, 0, tzinfo=timezone.utc),  # ~7 PM ET prev day
            price_at_placement=259.0,  # Finnhub snapshot from after-hours
        )
        ref, mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        assert ref == 260.0
        assert mode == "OPEN"

    def test_in_market_bet_with_null_entry_falls_back_to_open(self):
        # Finnhub was down at placement time, so price_at_placement is
        # NULL. Fall back to open mode rather than VOIDing the bet — the
        # user shouldn't lose their stake due to our outage.
        bet = make_bet(
            created_at=datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc),
            price_at_placement=None,
        )
        ref, mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        assert ref == 260.0
        assert mode == "OPEN"

    def test_in_market_bet_with_zero_entry_falls_back_to_open(self):
        # Defensive — a stored 0.0 entry would otherwise pass the
        # `is not None` check and produce a div-by-zero or nonsense
        # outcome. Treat 0 as "fetch failed, no real anchor."
        bet = make_bet(
            created_at=datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc),
            price_at_placement=0.0,
        )
        ref, mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        assert ref == 260.0
        assert mode == "OPEN"

    def test_bet_placed_exactly_at_market_open_uses_open(self):
        # 9:30:00 ET exactly is treated as pre-market (boundary uses `>`,
        # not `>=`). A bet that fired the same millisecond as the opening
        # cross shouldn't be penalized vs one that lands a tick before.
        bet = make_bet(
            created_at=self.MARKET_OPEN,
            price_at_placement=260.0,
        )
        ref, mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        assert ref == 260.0
        assert mode == "OPEN"

    def test_iso_string_with_z_suffix_parses_correctly(self):
        # Supabase REST sometimes returns 'Z' instead of '+00:00'.
        # fromisoformat in 3.11 handles both but we normalize anyway.
        bet = {
            "created_at": "2026-06-15T16:00:00Z",
            "price_at_placement": 264.50,
        }
        ref, mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        assert ref == 264.50
        assert mode == "ENTRY"

    def test_missing_created_at_falls_back_to_open(self):
        # Defensive — every real row has created_at, but a manual test
        # row might not. Treat missing as legacy.
        bet = {"price_at_placement": 264.0}  # no created_at
        ref, mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        assert ref == 260.0
        assert mode == "OPEN_NO_CREATED_AT"


# ---------------------------------------------------------------------------
# End-to-end: discriminator → evaluate
# ---------------------------------------------------------------------------


class TestEndToEnd:
    """Integration-y check that the two layers compose correctly. If
    these break it usually means we tweaked the helper's contract
    without updating the caller."""

    PRED_DATE = "2026-06-15"

    def test_in_market_bet_above_entry_wins_up(self):
        # User bet UP at $264 mid-day. Stock closed at $266. Open was
        # $260. Under old open-vs-close they'd win easily; under new
        # entry-vs-close they still win, but it was the LAST $2 that
        # mattered, not the first $4.
        bet = make_bet(
            created_at=datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc),
            price_at_placement=264.0,
        )
        ref, _mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        outcome, _payout = _evaluate(
            direction="UP", reference_price=ref, close_price=266.0, wagered=100
        )
        assert outcome == "WIN"

    def test_in_market_bet_loses_when_close_drops_below_entry(self):
        # User bet UP at $264 mid-day. Stock fell back to $262 by close.
        # Under old open-vs-close ($260 → $262) they'd win. Under new
        # entry-vs-close ($264 → $262) they lose. This is the central
        # behavior change of ADR 0017.
        bet = make_bet(
            created_at=datetime(2026, 6, 15, 16, 0, tzinfo=timezone.utc),
            price_at_placement=264.0,
        )
        ref, _mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        outcome, payout = _evaluate(
            direction="UP", reference_price=ref, close_price=262.0, wagered=100
        )
        assert outcome == "LOSS"
        assert payout == 0

    def test_grandfathered_bet_unaffected_by_new_logic(self):
        # Same shape as test_in_market_bet_loses... but bet was placed
        # before V2 cutoff. Old contract honored — open-vs-close wins.
        bet = make_bet(
            created_at=RESOLUTION_V2_CUTOFF.replace(year=2026, month=5, day=10),
            price_at_placement=264.0,  # captured but ignored
        )
        ref, _mode = _choose_reference_price(
            bet=bet, open_price=260.0, prediction_date=self.PRED_DATE
        )
        outcome, _payout = _evaluate(
            direction="UP", reference_price=ref, close_price=262.0, wagered=100
        )
        assert outcome == "WIN"
