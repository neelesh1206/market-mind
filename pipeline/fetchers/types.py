"""Shared dataclasses passed between fetchers and aggregator."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Literal


@dataclass
class PriceSnapshot:
    """Output of price/technical fetchers."""
    ticker: str
    prev_close: float
    day_change_pct: float | None
    week_change_pct: float | None
    month_change_pct: float | None
    ytd_change_pct: float | None
    fifty_two_week_high: float | None
    fifty_two_week_low: float | None
    rsi_14: float | None
    macd_signal: Literal["bullish_crossover", "bearish_crossover", "neutral"] | None
    price_vs_20ma: Literal["above", "below"] | None
    price_vs_50ma: Literal["above", "below"] | None
    bollinger_position: Literal["upper", "middle", "lower"] | None
    volume_trend: Literal["increasing", "decreasing", "neutral"] | None


@dataclass
class NewsArticle:
    """Single news item with sentiment + summary populated downstream."""
    headline: str
    url: str
    source: str
    published_at: datetime | None
    body: str | None = None
    sentiment: float | None = None       # set by FinBERT processor
    tldr: str | None = None              # set by Llama-3 processor


@dataclass
class AnalystSnapshot:
    """Output of Finnhub-style analyst data."""
    analyst_count: int | None
    analyst_buy: int | None
    analyst_hold: int | None
    analyst_sell: int | None
    analyst_price_target: float | None
    rating_change: Literal["upgrade", "downgrade", "initiated"] | None


@dataclass
class InsiderSnapshot:
    """Aggregate of recent Form 4 filings."""
    activity: Literal["buying", "selling", "neutral"] | None
    detail: str | None        # e.g. "CEO bought $2M on Mar 15"
    has_recent_8k: bool


@dataclass
class EarningsSnapshot:
    earnings_date: date | None
    days_until: int | None


@dataclass
class SocialSnapshot:
    """StockTwits + Reddit + ApeWisdom aggregate."""
    reddit_mention_count: int | None
    reddit_mention_delta: float | None
    apewisdom_rank: int | None
    stocktwits_bullish: float | None
    stocktwits_messages: int | None
    google_trend_score: int | None


@dataclass
class MacroSnapshot:
    sector_etf_change_pct: float | None
    vix_level: float | None
