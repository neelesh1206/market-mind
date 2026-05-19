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
