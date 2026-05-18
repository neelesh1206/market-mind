"""
ApeWisdom — aggregated WallStreetBets mention counts.

Free public API at https://apewisdom.io/api/v1.0/filter/all-stocks/
Returns a paginated list of top-mentioned tickers across r/wallstreetbets,
r/stocks, r/investing, etc. with mention counts and rank.

We fetch once per pipeline run (not per ticker) and look up each stock
from the cached list — much more efficient than per-ticker calls.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from .base import AbstractFetcher, RateLimitError

log = logging.getLogger("marketmind.apewisdom")

BASE_URL = "https://apewisdom.io/api/v1.0/filter/all-stocks/{page}"


class ApeWisdomFetcher(AbstractFetcher[dict]):
    """
    Per-ticker lookup against a cached page of top stocks.

    The fetcher pre-loads pages 1..N once per process (covers ~500 top
    tickers — more than enough for our 50-stock pool).
    """

    name = "apewisdom"
    timeout_seconds = 15.0

    def __init__(self, *, max_pages: int = 2) -> None:
        super().__init__()
        self.max_pages = max_pages
        self._cache: dict[str, dict[str, Any]] | None = None

    async def _ensure_cache(self, client: httpx.AsyncClient) -> dict[str, dict[str, Any]]:
        if self._cache is not None:
            return self._cache

        cache: dict[str, dict[str, Any]] = {}
        for page in range(1, self.max_pages + 1):
            r = await client.get(BASE_URL.format(page=page))
            if r.status_code == 429:
                raise RateLimitError("apewisdom 429")
            r.raise_for_status()
            payload = r.json()
            for entry in payload.get("results") or []:
                ticker = (entry.get("ticker") or "").upper()
                if not ticker:
                    continue
                cache[ticker] = entry
            if not payload.get("results"):
                break

        log.info("apewisdom_cache_loaded count=%s", len(cache))
        self._cache = cache
        return cache

    async def _fetch_impl(self, ticker: str) -> dict:
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            cache = await self._ensure_cache(client)

        entry = cache.get(ticker.upper())
        if not entry:
            return {"rank": None, "mentions": 0, "mentions_24h_ago": None, "delta_pct": None}

        mentions = int(entry.get("mentions") or 0)
        prev = entry.get("mentions_24h_ago")
        delta_pct = None
        if prev is not None and int(prev) > 0:
            delta_pct = round((mentions - int(prev)) / int(prev) * 100, 1)

        return {
            "rank": int(entry.get("rank")) if entry.get("rank") is not None else None,
            "mentions": mentions,
            "mentions_24h_ago": int(prev) if prev is not None else None,
            "delta_pct": delta_pct,
        }
