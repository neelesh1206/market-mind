"""
FRED (Federal Reserve Economic Data) fetcher for macro context.

Free API: https://fred.stlouisfed.org/docs/api/api_key.html
1,000 requests/day — generous for our daily pipeline.

Unlike per-stock fetchers, FRED data is market-wide. We fetch once per
pipeline run and apply the same `MacroSnapshot` to every stock's insight.
"""
from __future__ import annotations

import logging

import httpx

from .base import AbstractFetcher, FetchResult, RateLimitError
from .types import MacroSnapshot

log = logging.getLogger("marketmind.fred")

BASE_URL = "https://api.stlouisfed.org/fred/series/observations"

# Series codes we care about. Easy to extend later.
VIX_SERIES = "VIXCLS"        # CBOE Volatility Index (daily close)
DGS10_SERIES = "DGS10"       # 10-year Treasury yield


class FredMacroFetcher(AbstractFetcher[MacroSnapshot]):
    """
    Fetches a market-wide macro snapshot. The `ticker` arg is ignored —
    same data applies to all stocks.

    Returns the most recent VIX close (most recent non-empty observation).
    """

    name = "fred_macro"

    def __init__(self, api_key: str) -> None:
        super().__init__()
        if not api_key:
            raise ValueError("FRED_API_KEY required for FredMacroFetcher")
        self.api_key = api_key

    async def _fetch_impl(self, ticker: str) -> MacroSnapshot:  # ticker unused
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            vix = await self._latest_value(client, VIX_SERIES)
        return MacroSnapshot(
            sector_etf_change_pct=None,   # filled by a separate sector fetcher if needed
            vix_level=vix,
        )

    async def _latest_value(self, client: httpx.AsyncClient, series_id: str) -> float | None:
        r = await client.get(
            BASE_URL,
            params={
                "series_id": series_id,
                "api_key": self.api_key,
                "file_type": "json",
                "sort_order": "desc",
                "limit": "10",
            },
        )
        if r.status_code == 429:
            raise RateLimitError(f"fred {series_id} 429")
        r.raise_for_status()
        observations = (r.json() or {}).get("observations") or []

        for obs in observations:
            raw = obs.get("value")
            if raw and raw != ".":
                try:
                    return round(float(raw), 2)
                except ValueError:
                    continue
        return None


async def fetch_market_macro(api_key: str) -> FetchResult[MacroSnapshot]:
    """Convenience for the orchestrator — one fetch shared across all stocks."""
    fetcher = FredMacroFetcher(api_key)
    return await fetcher.fetch("MARKET")  # ticker arg ignored
