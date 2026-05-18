"""
Finnhub free-tier fetcher.

Endpoints used:
- /stock/recommendation     → aggregated analyst Buy/Hold/Sell counts
- /calendar/earnings        → upcoming earnings dates
- /company-news             → recent headlines (supplements Massive news)

API docs: https://finnhub.io/docs/api
Rate limit (free): 60 calls/min, 30 calls/sec.
"""
from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any

import httpx

from .base import AbstractFetcher, RateLimitError
from .types import AnalystSnapshot, EarningsSnapshot

log = logging.getLogger("marketmind.finnhub")

BASE_URL = "https://finnhub.io/api/v1"


class FinnhubAnalystFetcher(AbstractFetcher[AnalystSnapshot]):
    """Aggregated analyst recommendations (latest month vs prior month)."""

    name = "finnhub_analyst"

    def __init__(self, api_key: str) -> None:
        super().__init__()
        if not api_key:
            raise ValueError("FINNHUB_API_KEY required")
        self.api_key = api_key

    async def _fetch_impl(self, ticker: str) -> AnalystSnapshot:
        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            r = await client.get(
                f"{BASE_URL}/stock/recommendation",
                params={"symbol": ticker, "token": self.api_key},
            )
            if r.status_code == 429:
                raise RateLimitError("finnhub_analyst 429")
            r.raise_for_status()
            payload: list[dict[str, Any]] = r.json() or []

        if not payload:
            return AnalystSnapshot(
                analyst_count=None,
                analyst_buy=None,
                analyst_hold=None,
                analyst_sell=None,
                analyst_price_target=None,
                rating_change=None,
            )

        # Most recent period
        latest = payload[0]
        buy = int(latest.get("strongBuy", 0)) + int(latest.get("buy", 0))
        hold = int(latest.get("hold", 0))
        sell = int(latest.get("sell", 0)) + int(latest.get("strongSell", 0))
        total = buy + hold + sell

        rating_change = self._detect_rating_change(payload)

        return AnalystSnapshot(
            analyst_count=total or None,
            analyst_buy=buy or None,
            analyst_hold=hold or None,
            analyst_sell=sell or None,
            analyst_price_target=None,  # not provided by this endpoint
            rating_change=rating_change,
        )

    @staticmethod
    def _detect_rating_change(periods: list[dict[str, Any]]) -> str | None:
        """Compare buy share between the two most recent periods."""
        if len(periods) < 2:
            return None

        def buy_share(p: dict[str, Any]) -> float:
            buy = int(p.get("strongBuy", 0)) + int(p.get("buy", 0))
            hold = int(p.get("hold", 0))
            sell = int(p.get("sell", 0)) + int(p.get("strongSell", 0))
            total = buy + hold + sell
            return buy / total if total else 0.0

        latest = buy_share(periods[0])
        prior = buy_share(periods[1])
        delta = latest - prior
        if delta >= 0.05:
            return "upgrade"
        if delta <= -0.05:
            return "downgrade"
        return None


class FinnhubEarningsFetcher(AbstractFetcher[EarningsSnapshot]):
    """Next earnings date for a ticker, within the next 90 days."""

    name = "finnhub_earnings"

    def __init__(self, api_key: str, *, lookahead_days: int = 90) -> None:
        super().__init__()
        if not api_key:
            raise ValueError("FINNHUB_API_KEY required")
        self.api_key = api_key
        self.lookahead_days = lookahead_days

    async def _fetch_impl(self, ticker: str) -> EarningsSnapshot:
        today = date.today()
        to = today + timedelta(days=self.lookahead_days)

        async with httpx.AsyncClient(timeout=self.timeout_seconds) as client:
            r = await client.get(
                f"{BASE_URL}/calendar/earnings",
                params={
                    "symbol": ticker,
                    "from": today.isoformat(),
                    "to": to.isoformat(),
                    "token": self.api_key,
                },
            )
            if r.status_code == 429:
                raise RateLimitError("finnhub_earnings 429")
            r.raise_for_status()
            payload = r.json()

        rows = (payload.get("earningsCalendar") or []) if isinstance(payload, dict) else []
        if not rows:
            return EarningsSnapshot(earnings_date=None, days_until=None)

        # Use the soonest future date
        future = [r for r in rows if r.get("date")]
        future.sort(key=lambda r: r["date"])
        if not future:
            return EarningsSnapshot(earnings_date=None, days_until=None)

        try:
            ed = datetime.strptime(future[0]["date"], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return EarningsSnapshot(earnings_date=None, days_until=None)

        return EarningsSnapshot(
            earnings_date=ed,
            days_until=max((ed - today).days, 0),
        )
