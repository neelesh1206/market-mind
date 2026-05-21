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
    # Stddev of the last 20 daily returns, expressed as a decimal (e.g.
    # 0.035 = 3.5% daily vol). Used by compute_verdict to scale the
    # direction threshold per stock so that high-vol names (NVDA, COIN)
    # need a stronger combined signal to flip directional than low-vol
    # names (PG, KO). None if there's insufficient history.
    realized_vol_20d: float | None = None


@dataclass
class NewsArticle:
    """Single news item — sentiment + summary fields populated downstream.

    Fields populated by the fetcher:
      headline, url, source, published_at, body
      massive_sentiment / massive_sentiment_reasoning — Polygon's per-ticker
        insight from /v2/reference/news's insights array. Only attached
        when the article specifically discusses our target ticker;
        articles without a per-ticker insight are dropped at the fetcher
        (see ADR 0020).

    Fields populated by the processor pipeline:
      sentiment — blended FinBERT + Polygon score in [-1, +1]
      tldr / summary / signal_influence — LLM-generated, seeded with
        massive_sentiment_reasoning when available
    """
    headline: str
    url: str
    source: str
    published_at: datetime | None
    body: str | None = None
    sentiment: float | None = None              # blended (FinBERT + Polygon)
    tldr: str | None = None                     # one sentence, < 140 chars, for card glance
    summary: str | None = None                  # 2-3 sentences, paragraph
    signal_influence: str | None = None         # one sentence: how this affects sentiment direction
    massive_sentiment: Literal["positive", "negative", "neutral"] | None = None
    massive_sentiment_reasoning: str | None = None


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
