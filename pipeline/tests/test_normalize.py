"""Tests for ticker-symbol normalization at the Yahoo / SEC EDGAR boundary."""
from pipeline.fetchers._normalize import to_yahoo_symbol


def test_dotted_class_share_normalizes_to_dash():
    assert to_yahoo_symbol("BRK.B") == "BRK-B"
    assert to_yahoo_symbol("BF.B") == "BF-B"


def test_unaffected_tickers_pass_through_unchanged():
    assert to_yahoo_symbol("AAPL") == "AAPL"
    assert to_yahoo_symbol("NVDA") == "NVDA"
    assert to_yahoo_symbol("GOOGL") == "GOOGL"


def test_idempotent_on_already_normalized_symbols():
    # If something hands us the dash form already, leave it alone
    assert to_yahoo_symbol("BRK-B") == "BRK-B"


def test_handles_multiple_dots():
    # Defensive — no real ticker has this shape but the substitution
    # should still produce something Yahoo can fail-fast on rather than
    # silently corrupt.
    assert to_yahoo_symbol("X.Y.Z") == "X-Y-Z"
