"""
Massive (formerly Polygon.io) Stocks API fetcher.

Provides:
- News headlines (with article URL + publisher)
- Previous close + key price metrics

Uses HTTP REST. Massive Starter tier: 15-min delayed data, unlimited calls.

API docs: https://massive.com/docs/rest/stocks
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

import httpx

from .base import AbstractFetcher, RateLimitError
from .types import NewsArticle

log = logging.getLogger("marketmind.massive")

BASE_URL = "https://api.polygon.io"   # rebrand still uses api.polygon.io for now


class MassiveNewsFetcher(AbstractFetcher[list[NewsArticle]]):
    """Fetches recent news for a ticker."""

    name = "massive_news"
    timeout_seconds = 15.0

    def __init__(self, api_key: str, *, limit: int = 10) -> None:
        super().__init__()
        if not api_key:
            raise ValueError("MASSIVE_API_KEY required for MassiveNewsFetcher")
        self.api_key = api_key
        self.limit = limit

    async def _fetch_impl(self, ticker: str) -> list[NewsArticle]:
        url = f"{BASE_URL}/v2/reference/news"
        params = {
            "ticker": ticker,
            "limit": str(self.limit),
            "order": "desc",
            "sort": "published_utc",
            "apiKey": self.api_key,
        }
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            r = await client.get(url, params=params)
            if r.status_code == 429:
                raise RateLimitError("massive_news 429")
            r.raise_for_status()
            payload = r.json()

        results = payload.get("results") or []
        articles: list[NewsArticle] = []
        skipped_no_insight = 0
        for item in results:
            # Per-ticker relevance gate (ADR 0020): Polygon attaches an
            # `insights` array where each entry corresponds to a ticker
            # the article actually discusses. An article tagged with our
            # ticker but missing it from `insights` is just a passing
            # mention (sector piece, adjacent-company M&A, etc.) — drop it.
            insights = item.get("insights") or []
            my_insight = next(
                (i for i in insights if (i.get("ticker") or "").upper() == ticker.upper()),
                None,
            )
            if my_insight is None:
                skipped_no_insight += 1
                continue

            published = item.get("published_utc")
            published_at = None
            if published:
                try:
                    published_at = datetime.fromisoformat(published.replace("Z", "+00:00"))
                except ValueError:
                    log.warning("bad_timestamp ticker=%s ts=%s", ticker, published)

            sentiment = my_insight.get("sentiment")
            # Only accept the three documented values; anything else gets
            # treated as missing rather than blowing up downstream.
            if sentiment not in ("positive", "negative", "neutral"):
                sentiment = None

            articles.append(
                NewsArticle(
                    headline=item.get("title") or "",
                    url=item.get("article_url") or item.get("amp_url") or "",
                    source=(item.get("publisher") or {}).get("name") or "Unknown",
                    published_at=published_at,
                    body=item.get("description"),
                    massive_sentiment=sentiment,
                    massive_sentiment_reasoning=my_insight.get("sentiment_reasoning"),
                )
            )
        if skipped_no_insight:
            log.info(
                "massive_news_filtered ticker=%s kept=%s skipped_no_insight=%s",
                ticker, len(articles), skipped_no_insight,
            )
        return articles


class MassivePrevCloseFetcher(AbstractFetcher[dict[str, Any]]):
    """
    Previous trading day close for a ticker.
    Endpoint returns OHLCV for the prior day.
    """

    name = "massive_prev_close"
    timeout_seconds = 10.0

    def __init__(self, api_key: str) -> None:
        super().__init__()
        if not api_key:
            raise ValueError("MASSIVE_API_KEY required for MassivePrevCloseFetcher")
        self.api_key = api_key

    async def _fetch_impl(self, ticker: str) -> dict[str, Any]:
        url = f"{BASE_URL}/v2/aggs/ticker/{ticker}/prev"
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            r = await client.get(url, params={"adjusted": "true", "apiKey": self.api_key})
            if r.status_code == 429:
                raise RateLimitError("massive_prev_close 429")
            r.raise_for_status()
            payload = r.json()

        results = payload.get("results") or []
        if not results:
            raise RuntimeError(f"No previous close for {ticker}")
        bar = results[0]
        return {
            "close": bar.get("c"),
            "open": bar.get("o"),
            "high": bar.get("h"),
            "low": bar.get("l"),
            "volume": bar.get("v"),
            "vwap": bar.get("vw"),
            "timestamp": bar.get("t"),
        }
