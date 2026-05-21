"""Tests for the Polygon-insights sentiment blend (ADR 0020).

Pure-Python helpers — no FinBERT/HF dependencies — so these run in CI even
when the larger pipeline image isn't installed.
"""
from __future__ import annotations

from datetime import datetime, timezone

import pytest

from pipeline.fetchers.types import NewsArticle
from pipeline.processors.sentiment import _polygon_to_numeric, apply_polygon_blend


# ---------------------------------------------------------------------------
# _polygon_to_numeric
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "raw, expected",
    [
        ("positive", 1.0),
        ("negative", -1.0),
        ("neutral", 0.0),
        # Unrecognised values get rejected — we'd rather have None than
        # invent a number.
        ("Positive", None),   # case-sensitive on purpose; matches API contract
        ("strongly_positive", None),
        ("", None),
        (None, None),
    ],
)
def test_polygon_to_numeric(raw, expected):
    assert _polygon_to_numeric(raw) == expected


# ---------------------------------------------------------------------------
# apply_polygon_blend
# ---------------------------------------------------------------------------


def _article(*, finbert: float | None = None, polygon: str | None = None) -> NewsArticle:
    return NewsArticle(
        headline="h",
        url="u",
        source="s",
        published_at=datetime.now(tz=timezone.utc),
        body=None,
        sentiment=finbert,
        massive_sentiment=polygon,
    )


def test_blend_both_present_simple_average():
    articles = [_article(finbert=0.5, polygon="negative")]  # 0.5 + (-1.0) = -0.5 / 2 = -0.25
    changed = apply_polygon_blend(articles)
    assert articles[0].sentiment == -0.25
    assert changed == 1


def test_blend_neutral_polygon_dilutes_finbert():
    articles = [_article(finbert=0.6, polygon="neutral")]  # 0.6 + 0 = 0.6 / 2 = 0.3
    apply_polygon_blend(articles)
    assert articles[0].sentiment == 0.3


def test_blend_both_agreeing_positive():
    articles = [_article(finbert=0.4, polygon="positive")]  # 0.4 + 1.0 = 1.4 / 2 = 0.7
    apply_polygon_blend(articles)
    assert articles[0].sentiment == 0.7


def test_blend_finbert_only_unchanged():
    # No Polygon insight available — keep FinBERT as-is.
    articles = [_article(finbert=0.42, polygon=None)]
    changed = apply_polygon_blend(articles)
    assert articles[0].sentiment == 0.42
    assert changed == 0


def test_blend_polygon_only_takes_numeric():
    # FinBERT skipped this article (empty body) but Polygon has a read.
    articles = [_article(finbert=None, polygon="positive")]
    changed = apply_polygon_blend(articles)
    assert articles[0].sentiment == 1.0
    assert changed == 1


def test_blend_neither_present_no_change():
    articles = [_article(finbert=None, polygon=None)]
    changed = apply_polygon_blend(articles)
    assert articles[0].sentiment is None
    assert changed == 0


def test_blend_unrecognised_polygon_value_treated_as_missing():
    articles = [_article(finbert=0.42, polygon="strong_buy")]  # type: ignore[arg-type]
    changed = apply_polygon_blend(articles)
    assert articles[0].sentiment == 0.42
    assert changed == 0


def test_blend_no_change_when_identical():
    # FinBERT and polygon-numeric happen to agree exactly → blended == finbert
    # → changed counter should NOT increment.
    articles = [_article(finbert=1.0, polygon="positive")]  # (1.0 + 1.0) / 2 = 1.0
    changed = apply_polygon_blend(articles)
    assert articles[0].sentiment == 1.0
    assert changed == 0


def test_blend_rounds_to_three_decimals():
    # Verify rounding happens — guards against floating-point drift in stored values.
    # (0.123456 + 1.0) / 2 = 0.561728 → round to 0.562
    articles = [_article(finbert=0.123456, polygon="positive")]
    apply_polygon_blend(articles)
    assert articles[0].sentiment == 0.562


def test_blend_handles_multiple_articles_independently():
    arts = [
        _article(finbert=0.5, polygon="positive"),   # → 0.75
        _article(finbert=-0.2, polygon="neutral"),   # → -0.1
        _article(finbert=None, polygon="negative"),  # → -1.0
        _article(finbert=0.1, polygon=None),         # unchanged
    ]
    changed = apply_polygon_blend(arts)
    assert arts[0].sentiment == 0.75
    assert arts[1].sentiment == -0.1
    assert arts[2].sentiment == -1.0
    assert arts[3].sentiment == 0.1
    assert changed == 3  # arts[3] didn't change
