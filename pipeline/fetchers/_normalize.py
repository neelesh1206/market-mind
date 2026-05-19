"""
Ticker symbol normalization for external API calls.

Our DB stores common-sense ticker symbols with dots for class shares
(`BRK.B`, `BF.B`). Yahoo Finance and SEC EDGAR's `company_tickers.json`
canonicalize on the dash form (`BRK-B`, `BF-B`) — passing the dot form
to either of them silently returns empty data:

    yfinance      → YFPricesMissingError "possibly delisted"
    SEC EDGAR     → no CIK found for ticker, fetcher skipped

Finnhub, StockTwits, and Reddit accept the dot form natively, so this
normalization is *only* applied at the call site for the two affected
sources. Keeping the DB ticker stable means display, RLS joins, and
internal references don't need to know about this quirk.

Usage:

    from pipeline.fetchers._normalize import to_yahoo_symbol

    df = yf.download(to_yahoo_symbol(ticker), ...)
"""
from __future__ import annotations


def to_yahoo_symbol(ticker: str) -> str:
    """DB ticker → Yahoo Finance / SEC EDGAR canonical symbol.

    Replaces every `.` with `-`. Idempotent on already-normalized symbols
    (no dot → no change). Returns the input unchanged if it has no dots.
    """
    return ticker.replace(".", "-")
