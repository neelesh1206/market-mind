"""Tests for verdict computation — particularly the renormalization
behavior introduced when we stopped coercing None bucket scores to 0.

See ADR 0011 — Signal-quality P0 fixes.

The critical invariant: a missing bucket must not silently drag the
weighted sum toward zero. It is *absence of evidence*, not *evidence of
zero*. The fix is to renormalize over the buckets that are actually
present.
"""
from pipeline.processors.verdict import (
    DIRECTION_THRESHOLD,
    WEIGHTS_V1,
    WEIGHTS_VERSION,
    compute_verdict,
)


# ---------------------------------------------------------------------------
# Happy path — all four buckets present
# ---------------------------------------------------------------------------

def test_all_buckets_positive_yields_up():
    v = compute_verdict(technical=0.5, sentiment=0.4, professional=0.6, social=0.3)
    assert v.direction == "UP"
    # Weighted sum: 0.30*0.5 + 0.25*0.4 + 0.30*0.6 + 0.15*0.3 = 0.475
    assert v.confidence == 0.475
    assert v.weights_version == WEIGHTS_VERSION


def test_all_buckets_negative_yields_down():
    v = compute_verdict(technical=-0.5, sentiment=-0.4, professional=-0.6, social=-0.3)
    assert v.direction == "DOWN"
    assert v.confidence == 0.475


def test_near_zero_yields_neutral():
    # Weighted sum below DIRECTION_THRESHOLD (0.15) in absolute value
    v = compute_verdict(technical=0.1, sentiment=0.1, professional=0.1, social=0.1)
    assert v.direction == "NEUTRAL"
    assert v.confidence == 0.1


def test_raw_scores_are_preserved_in_bucket_scores():
    v = compute_verdict(technical=0.5, sentiment=None, professional=-0.2, social=None)
    assert v.bucket_scores == {
        "technical": 0.5,
        "sentiment": None,
        "professional": -0.2,
        "social": None,
    }


# ---------------------------------------------------------------------------
# All buckets missing — must NOT crash, must produce a defined neutral verdict
# ---------------------------------------------------------------------------

def test_all_none_returns_neutral_zero_confidence():
    v = compute_verdict(technical=None, sentiment=None, professional=None, social=None)
    assert v.direction == "NEUTRAL"
    assert v.confidence == 0.0
    assert v.bucket_scores == {
        "technical": None,
        "sentiment": None,
        "professional": None,
        "social": None,
    }


# ---------------------------------------------------------------------------
# The core renormalization invariant — the regression cases that motivated
# the change.
# ---------------------------------------------------------------------------

def test_single_bucket_uses_full_weight():
    """One bucket present should map directly to combined = its value.

    Old behavior (None→0): combined = 0.4 * 0.30 = 0.12 → NEUTRAL.
    New behavior:          combined = 0.4 (renormalized)  → UP.
    """
    v = compute_verdict(technical=0.4, sentiment=None, professional=None, social=None)
    assert v.direction == "UP"
    assert v.confidence == 0.4


def test_single_bucket_negative_uses_full_weight():
    v = compute_verdict(technical=None, sentiment=None, professional=-0.5, social=None)
    assert v.direction == "DOWN"
    assert v.confidence == 0.5


def test_two_buckets_renormalize_correctly():
    """Tech + Pro present (weights 0.30 + 0.30 = 0.60).

    raw  = 0.30*0.5 + 0.30*0.3 = 0.24
    norm = 0.24 / 0.60 = 0.40
    """
    v = compute_verdict(technical=0.5, sentiment=None, professional=0.3, social=None)
    assert v.direction == "UP"
    assert v.confidence == 0.4


def test_three_buckets_renormalize_correctly():
    """Tech + Sent + Pro present (weights 0.30 + 0.25 + 0.30 = 0.85).

    raw  = 0.30*0.5 + 0.25*0.2 + 0.30*0.4 = 0.32
    norm = 0.32 / 0.85 ≈ 0.376
    """
    v = compute_verdict(technical=0.5, sentiment=0.2, professional=0.4, social=None)
    assert v.direction == "UP"
    assert v.confidence == 0.376


# ---------------------------------------------------------------------------
# Threshold / sign-flip boundary
# ---------------------------------------------------------------------------

def test_value_at_threshold_is_neutral():
    """The check is strict > / strict <; sitting exactly on the threshold
    does not produce a directional call."""
    # Single-bucket case so combined == bucket value exactly
    v = compute_verdict(
        technical=DIRECTION_THRESHOLD, sentiment=None, professional=None, social=None
    )
    assert v.direction == "NEUTRAL"


def test_value_just_above_threshold_is_directional():
    v = compute_verdict(
        technical=DIRECTION_THRESHOLD + 0.01,
        sentiment=None,
        professional=None,
        social=None,
    )
    assert v.direction == "UP"


# ---------------------------------------------------------------------------
# Sanity — weights still sum to 1.0 so we don't silently break weighted-sum
# semantics if someone retunes WEIGHTS_V1 later
# ---------------------------------------------------------------------------

def test_weights_sum_to_one():
    assert abs(sum(WEIGHTS_V1.values()) - 1.0) < 1e-9


# ---------------------------------------------------------------------------
# Vol normalization (ADR 0014) — per-stock threshold scaling.
# ---------------------------------------------------------------------------

def test_no_vol_provided_uses_flat_threshold():
    """Omitting realized_vol_20d preserves prior behavior — flat 0.15 threshold."""
    # Score at 0.20 — above the flat threshold of 0.15
    v = compute_verdict(
        technical=0.4, sentiment=0.2, professional=0.2, social=0.0
    )
    # combined = 0.30*0.4 + 0.25*0.2 + 0.30*0.2 + 0.15*0 = 0.23 → UP
    assert v.direction == "UP"
    assert v.vol_factor == 1.0
    assert v.adjusted_threshold == DIRECTION_THRESHOLD


def test_high_vol_stock_needs_stronger_signal_to_flip_directional():
    """A combined score of ~0.20 flips a low-vol stock UP but leaves a
    high-vol stock NEUTRAL (the noise overlay swamps the signal)."""
    # vol = 0.040 (4% daily, NVDA-like) → factor = 2.0 → threshold = 0.30
    v_high = compute_verdict(
        technical=0.4, sentiment=0.2, professional=0.2, social=0.0,
        realized_vol_20d=0.040,
    )
    # combined ≈ 0.23, below the vol-adjusted 0.30 → NEUTRAL
    assert v_high.direction == "NEUTRAL"
    assert v_high.vol_factor == 2.0
    assert v_high.adjusted_threshold == 0.30


def test_low_vol_stock_flips_directional_on_modest_signal():
    """The same 0.10 combined score that would be NEUTRAL on a typical
    stock is UP on a very-quiet (PG-like) name."""
    # vol = 0.008 (0.8% daily, PG-like) → factor = 0.5 (clamped) → threshold = 0.075
    v_low = compute_verdict(
        technical=0.2, sentiment=0.1, professional=0.0, social=0.0,
        realized_vol_20d=0.008,
    )
    # combined = 0.30*0.2 + 0.25*0.1 + 0.30*0 + 0.15*0 = 0.085 → UP @ adjusted 0.075
    assert v_low.direction == "UP"
    assert v_low.vol_factor == 0.5  # clamped min
    assert v_low.adjusted_threshold == 0.075


def test_vol_factor_clamps_at_extremes():
    """Extreme realized vols (freshly-IPO'd, halt-induced spikes, etc.)
    don't produce absurd thresholds."""
    # Crazy high vol → clamped to factor 2.5
    v_extreme_high = compute_verdict(
        technical=0.5, sentiment=0.5, professional=0.5, social=0.5,
        realized_vol_20d=0.20,   # 20% daily — absurd
    )
    assert v_extreme_high.vol_factor == 2.5
    assert v_extreme_high.adjusted_threshold == round(0.15 * 2.5, 4)

    # Crazy low vol → clamped to factor 0.5
    v_extreme_low = compute_verdict(
        technical=0.1, sentiment=0.0, professional=0.0, social=0.0,
        realized_vol_20d=0.0001,
    )
    assert v_extreme_low.vol_factor == 0.5
    assert v_extreme_low.adjusted_threshold == 0.075


def test_zero_or_negative_vol_treated_as_unavailable():
    """Defensive: bad vol values shouldn't crash or distort the threshold."""
    v_zero = compute_verdict(
        technical=0.3, sentiment=0.0, professional=0.0, social=0.0,
        realized_vol_20d=0.0,
    )
    assert v_zero.vol_factor == 1.0
    assert v_zero.adjusted_threshold == DIRECTION_THRESHOLD

    v_neg = compute_verdict(
        technical=0.3, sentiment=0.0, professional=0.0, social=0.0,
        realized_vol_20d=-0.5,  # impossible, but be defensive
    )
    assert v_neg.vol_factor == 1.0


def test_vol_normalization_preserves_renormalization():
    """The two adjustments compose — renormalization happens first
    (over present buckets), then vol scales the threshold."""
    # Only technical present, vol-elevated
    v = compute_verdict(
        technical=0.5, sentiment=None, professional=None, social=None,
        realized_vol_20d=0.04,   # factor 2.0, threshold 0.30
    )
    # Renormalized combined = 0.5 (technical alone, full weight); compare to 0.30
    assert v.direction == "UP"
    assert v.confidence == 0.5
    assert v.vol_factor == 2.0
