"""Tests for the cross-sectional ranking pass — see ADR 0015.

The ranking function is pure math so it's testable without a DB. The
DB-touching `_rank_universe` wrapper is exercised in production runs
and via the orchestrator integration; here we lock down the ordering
math, tie behavior, and defensive filtering.
"""
from pipeline.processors.ranking import rank_predictions


def _row(id: str, score: float, ticker: str = "AAA") -> dict:
    """Shape mirrors what Supabase returns from the ranking query."""
    return {"id": id, "combined_score": score, "stocks": {"ticker": ticker}}


def test_strongest_bullish_gets_rank_1():
    rows = [
        _row("a", -0.10, "AAA"),
        _row("b", +0.42, "BBB"),
        _row("c", +0.05, "CCC"),
    ]
    ranked = rank_predictions(rows)
    assert ranked[0] == ("b", 1, 0.42, "BBB")
    assert ranked[1] == ("c", 2, 0.05, "CCC")
    assert ranked[2] == ("a", 3, -0.10, "AAA")


def test_strongest_bearish_gets_highest_rank_number():
    """Rank N = strongest bearish; convenient for top-5-short queries."""
    rows = [
        _row("a", +0.30),
        _row("b", -0.50),
        _row("c", +0.10),
        _row("d", -0.20),
    ]
    ranked = rank_predictions(rows)
    # Sorted desc: 0.30, 0.10, -0.20, -0.50
    assert [(r[0], r[1]) for r in ranked] == [
        ("a", 1),
        ("c", 2),
        ("d", 3),
        ("b", 4),
    ]


def test_ties_resolve_stably_by_input_order():
    """Two stocks with identical combined_score keep the row-fetch order."""
    rows = [
        _row("first", 0.20),
        _row("second", 0.20),
        _row("third", 0.20),
    ]
    ranked = rank_predictions(rows)
    assert [r[0] for r in ranked] == ["first", "second", "third"]
    assert [r[1] for r in ranked] == [1, 2, 3]


def test_none_or_missing_combined_score_is_dropped():
    rows = [
        _row("a", 0.30),
        {"id": "b", "combined_score": None, "stocks": {"ticker": "BBB"}},
        _row("c", 0.10),
        {"id": "d", "stocks": {"ticker": "DDD"}},  # missing key entirely
    ]
    ranked = rank_predictions(rows)
    ids = [r[0] for r in ranked]
    assert "b" not in ids
    assert "d" not in ids
    assert ids == ["a", "c"]


def test_missing_ticker_falls_back_to_none():
    """The joined stocks(ticker) could come back empty in degenerate cases."""
    rows = [
        {"id": "a", "combined_score": 0.5, "stocks": None},
        {"id": "b", "combined_score": 0.1, "stocks": {"ticker": "BBB"}},
    ]
    ranked = rank_predictions(rows)
    assert ranked[0] == ("a", 1, 0.5, None)
    assert ranked[1] == ("b", 2, 0.1, "BBB")


def test_empty_input_returns_empty_list():
    assert rank_predictions([]) == []


def test_realistic_50_stock_universe_returns_ranks_1_to_n():
    """Smoke test against a realistic-size universe — no off-by-ones at the edges."""
    rows = [_row(f"stock-{i:02d}", (25 - i) * 0.02) for i in range(50)]
    ranked = rank_predictions(rows)
    assert len(ranked) == 50
    assert ranked[0][1] == 1   # first rank
    assert ranked[-1][1] == 50  # last rank
    # Score should be monotonically decreasing across the ranked list
    scores = [r[2] for r in ranked]
    assert scores == sorted(scores, reverse=True)
