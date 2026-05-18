"""
Signal aggregator. Turns raw fetcher outputs into the 4 bucket scores
displayed on each stock card (technical / sentiment / professional / social).

Scoring formulas are documented in IMPLEMENTATION_PLAN.md → Signal Engine.
Each bucket lives in [-1, 1]. We DELIBERATELY DO NOT combine these into a
single verdict (see ADR 0003).
"""
from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from ..fetchers.types import (
    AnalystSnapshot,
    EarningsSnapshot,
    InsiderSnapshot,
    MacroSnapshot,
    NewsArticle,
    PriceSnapshot,
    SocialSnapshot,
)


@dataclass
class BucketScores:
    technical: float | None
    sentiment: float | None
    professional: float | None
    social: float | None
    breakdown: dict[str, Any]


def _clamp(x: float, lo: float = -1.0, hi: float = 1.0) -> float:
    return max(lo, min(hi, x))


def technical_score(p: PriceSnapshot | None) -> tuple[float | None, dict[str, Any]]:
    if p is None:
        return (None, {})
    s = 0.0
    components: dict[str, Any] = {}

    if p.rsi_14 is not None:
        if p.rsi_14 < 30:
            s += 1.0
            components["rsi"] = "oversold"
        elif p.rsi_14 > 70:
            s -= 1.0
            components["rsi"] = "overbought"
        elif p.rsi_14 < 45:
            s += 0.3
            components["rsi"] = "leaning_bullish"
        elif p.rsi_14 > 55:
            s -= 0.3
            components["rsi"] = "leaning_bearish"
        else:
            components["rsi"] = "neutral"

    if p.macd_signal == "bullish_crossover":
        s += 0.8
        components["macd"] = "bullish_crossover"
    elif p.macd_signal == "bearish_crossover":
        s -= 0.8
        components["macd"] = "bearish_crossover"

    if p.price_vs_20ma == "above":
        s += 0.4
        components["ma20"] = "above"
    elif p.price_vs_20ma == "below":
        s -= 0.4
        components["ma20"] = "below"

    if p.price_vs_50ma == "above":
        s += 0.3
        components["ma50"] = "above"
    elif p.price_vs_50ma == "below":
        s -= 0.3
        components["ma50"] = "below"

    if p.volume_trend == "increasing":
        s *= 1.2
        components["volume"] = "increasing"
    elif p.volume_trend == "decreasing":
        s *= 0.85
        components["volume"] = "decreasing"

    # Normalize: max raw is roughly +/- 3, divide by 3
    normalized = _clamp(s / 3.0)
    return (normalized, components)


def professional_score(
    analyst: AnalystSnapshot | None,
    insider: InsiderSnapshot | None,
    earnings: EarningsSnapshot | None,
) -> tuple[float | None, dict[str, Any]]:
    components: dict[str, Any] = {}
    if analyst is None and insider is None:
        return (None, components)

    s = 0.0

    if analyst:
        if analyst.analyst_count:
            buy = analyst.analyst_buy or 0
            sell = analyst.analyst_sell or 0
            s += (buy - sell) / analyst.analyst_count
            components["analyst_split"] = {
                "buy": buy,
                "hold": analyst.analyst_hold or 0,
                "sell": sell,
                "total": analyst.analyst_count,
            }
        if analyst.rating_change == "upgrade":
            s += 0.4
            components["rating_change"] = "upgrade"
        elif analyst.rating_change == "downgrade":
            s -= 0.4
            components["rating_change"] = "downgrade"

    if insider:
        if insider.activity == "buying":
            s += 0.6
            components["insider"] = "buying"
        elif insider.activity == "selling":
            s -= 0.3   # selling has many benign reasons (tax planning, diversification)
            components["insider"] = "selling"
        else:
            components["insider"] = "neutral"
        if insider.detail:
            components["insider_detail"] = insider.detail
        if insider.has_recent_8k:
            components["recent_8k"] = True

    # Amplify near earnings (more uncertainty → existing signal matters more)
    if earnings and earnings.days_until is not None and earnings.days_until <= 3:
        s *= 1.3
        components["earnings_in_days"] = earnings.days_until

    return (_clamp(s), components)


def social_score(s: SocialSnapshot | None) -> tuple[float | None, dict[str, Any]]:
    if s is None:
        return (None, {})

    components: dict[str, Any] = {}
    score = 0.0

    if s.reddit_mention_delta is not None:
        components["reddit_delta_pct"] = s.reddit_mention_delta
        if s.reddit_mention_delta > 200:
            score += 0.5
        elif s.reddit_mention_delta < -50:
            score -= 0.3

    if s.apewisdom_rank is not None and s.apewisdom_rank <= 10:
        score += 0.3
        components["apewisdom_rank"] = s.apewisdom_rank

    if s.stocktwits_bullish is not None:
        normalized = (s.stocktwits_bullish - 50) / 100  # -0.5..0.5
        score += normalized
        components["stocktwits_bullish_pct"] = s.stocktwits_bullish

    return (_clamp(score), components)


def aggregate(
    *,
    price: PriceSnapshot | None,
    articles: list[NewsArticle],
    sentiment_score: float | None,
    sentiment_article_count: int,
    sources_agree: int,
    sources_total: int,
    analyst: AnalystSnapshot | None,
    insider: InsiderSnapshot | None,
    earnings: EarningsSnapshot | None,
    social: SocialSnapshot | None,
    macro: MacroSnapshot | None,
) -> BucketScores:
    tech_value, tech_components = technical_score(price)
    prof_value, prof_components = professional_score(analyst, insider, earnings)
    soc_value, soc_components = social_score(social)

    sentiment_components: dict[str, Any] = {}
    if sentiment_score is not None:
        sentiment_components = {
            "score": sentiment_score,
            "article_count": sentiment_article_count,
            "sources_agree": sources_agree,
            "sources_total": sources_total,
            "top_articles": [
                {"headline": a.headline, "source": a.source, "url": a.url, "sentiment": a.sentiment}
                for a in articles[:3]
            ],
        }

    breakdown = {
        "technical": tech_components,
        "sentiment": sentiment_components,
        "professional": prof_components,
        "social": soc_components,
        "macro": asdict(macro) if macro else {},
    }

    return BucketScores(
        technical=tech_value,
        sentiment=sentiment_score,
        professional=prof_value,
        social=soc_value,
        breakdown=breakdown,
    )
