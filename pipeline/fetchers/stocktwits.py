"""
StockTwits sentiment fetcher.

StockTwits exposes a public endpoint per-ticker that returns recent
messages along with each user's bullish/bearish tag. No auth required
for read-only access. We aggregate the most-recent 30 messages.

Endpoint: https://api.stocktwits.com/api/2/streams/symbol/{TICKER}.json
"""
from __future__ import annotations

import logging

import httpx

from .base import AbstractFetcher, RateLimitError

log = logging.getLogger("marketmind.stocktwits")

BASE_URL = "https://api.stocktwits.com/api/2/streams/symbol/{ticker}.json"


class StockTwitsFetcher(AbstractFetcher[dict]):
    """Returns {bullish_pct: float, message_count: int} — None if no data."""

    name = "stocktwits"
    timeout_seconds = 10.0

    async def _fetch_impl(self, ticker: str) -> dict:
        url = BASE_URL.format(ticker=ticker.upper())
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            r = await client.get(url, headers={"User-Agent": "MarketMind/0.1"})
            if r.status_code == 429:
                raise RateLimitError("stocktwits 429")
            r.raise_for_status()
            payload = r.json()

        messages = payload.get("messages") or []
        if not messages:
            return {"bullish_pct": None, "message_count": 0}

        bullish = 0
        bearish = 0
        for m in messages:
            sentiment = (m.get("entities") or {}).get("sentiment")
            if not sentiment:
                continue
            basic = (sentiment.get("basic") or "").lower()
            if basic == "bullish":
                bullish += 1
            elif basic == "bearish":
                bearish += 1

        total_tagged = bullish + bearish
        bullish_pct = (bullish / total_tagged * 100) if total_tagged else None

        return {
            "bullish_pct": round(bullish_pct, 1) if bullish_pct is not None else None,
            "message_count": len(messages),
        }
