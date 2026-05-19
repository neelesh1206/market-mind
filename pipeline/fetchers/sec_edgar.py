"""
SEC EDGAR fetcher — completely free, official government data.

Used for:
- Form 4: insider transactions (buy/sell signal)
- 8-K:    material events (sudden catalyst signal)

EDGAR best practices (https://www.sec.gov/os/accessing-edgar-data):
- Identify your traffic via a User-Agent string (we use the project name + contact)
- 10 requests/sec hard limit; we naturally stay well under

We use:
- https://www.sec.gov/files/company_tickers.json — ticker → CIK mapping (cached)
- https://data.sec.gov/submissions/CIK{cik}.json — recent filings per company
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from functools import lru_cache
from typing import Any

import httpx

from ._normalize import to_yahoo_symbol
from .base import AbstractFetcher, RateLimitError
from .types import InsiderSnapshot

log = logging.getLogger("marketmind.sec_edgar")

USER_AGENT = "MarketMind-pipeline neelesh1206@gmail.com"
TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK{cik}.json"


@lru_cache(maxsize=1)
def _empty_ticker_map() -> dict[str, str]:
    return {}


# Module-level cache populated lazily on first call.
_TICKER_TO_CIK: dict[str, str] = {}


async def _load_ticker_map(client: httpx.AsyncClient) -> dict[str, str]:
    """Fetch the SEC's ticker→CIK table once per process."""
    global _TICKER_TO_CIK
    if _TICKER_TO_CIK:
        return _TICKER_TO_CIK

    r = await client.get(TICKERS_URL, headers={"User-Agent": USER_AGENT})
    if r.status_code == 429:
        raise RateLimitError("sec_edgar tickers 429")
    r.raise_for_status()

    # Payload is {0: {cik_str, ticker, title}, 1: ...}
    payload = r.json()
    mapping: dict[str, str] = {}
    for entry in payload.values():
        ticker = (entry.get("ticker") or "").upper()
        cik = entry.get("cik_str")
        if ticker and cik is not None:
            mapping[ticker] = str(cik).zfill(10)
    _TICKER_TO_CIK = mapping
    log.info("loaded_sec_tickers count=%s", len(mapping))
    return mapping


class SecInsiderFetcher(AbstractFetcher[InsiderSnapshot]):
    """
    Looks at recent Form 4 and 8-K filings.

    For Form 4 we only count occurrences — full XML parsing for actual share
    volumes is left for a later iteration (the count alone signals attention).

    For 8-K we just check if any filed in the last 24 hours.
    """

    name = "sec_insider"
    timeout_seconds = 15.0

    def __init__(self, *, form4_lookback_days: int = 14, eight_k_lookback_days: int = 1) -> None:
        super().__init__()
        self.form4_lookback_days = form4_lookback_days
        self.eight_k_lookback_days = eight_k_lookback_days

    async def _fetch_impl(self, ticker: str) -> InsiderSnapshot:
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            ticker_map = await _load_ticker_map(client)
            # SEC's company_tickers.json canonicalizes on the dash form for
            # class shares (BRK-B, BF-B), so normalize the lookup key.
            cik = ticker_map.get(to_yahoo_symbol(ticker).upper())
            if not cik:
                log.warning("sec_no_cik ticker=%s", ticker)
                return InsiderSnapshot(activity="neutral", detail=None, has_recent_8k=False)

            r = await client.get(
                SUBMISSIONS_URL.format(cik=cik),
                headers={"User-Agent": USER_AGENT},
            )
            if r.status_code == 429:
                raise RateLimitError("sec_edgar submissions 429")
            r.raise_for_status()
            payload = r.json()

        recent = (payload.get("filings") or {}).get("recent") or {}
        forms: list[str] = recent.get("form") or []
        filing_dates: list[str] = recent.get("filingDate") or []

        today = date.today()
        form4_count = 0
        has_recent_8k = False

        for form_type, filing_date_str in zip(forms, filing_dates, strict=False):
            try:
                filed = datetime.strptime(filing_date_str, "%Y-%m-%d").date()
            except (ValueError, TypeError):
                continue

            days_ago = (today - filed).days
            if days_ago < 0:
                continue

            if form_type == "4" and days_ago <= self.form4_lookback_days:
                form4_count += 1
            if form_type == "8-K" and days_ago <= self.eight_k_lookback_days:
                has_recent_8k = True

        # Heuristic: more than 3 insider filings in 14 days flags activity.
        # Direction (buying/selling) requires Form 4 XML parsing — TODO.
        if form4_count == 0:
            activity = "neutral"
            detail = None
        elif form4_count >= 3:
            activity = "buying"  # placeholder until XML parsing is added
            detail = f"{form4_count} insider filings in last {self.form4_lookback_days} days"
        else:
            activity = "neutral"
            detail = f"{form4_count} insider filing(s) in last {self.form4_lookback_days} days"

        return InsiderSnapshot(activity=activity, detail=detail, has_recent_8k=has_recent_8k)
