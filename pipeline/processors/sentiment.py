"""
FinBERT sentiment processor via HuggingFace Inference API.

Why HF API (not local model):
- No local model weights to manage (~440MB for FinBERT)
- Free tier is plenty for ~500 inferences/day (our scale)
- HF Pro upgrades give better throughput + dedicated inference

Output format from HF text-classification:
[
  [
    {"label": "positive", "score": 0.85},
    {"label": "neutral",  "score": 0.10},
    {"label": "negative", "score": 0.05}
  ]
]

We convert to a single signed score in [-1, 1] (positive - negative).
"""
from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timezone

import httpx

from ..fetchers.types import NewsArticle

log = logging.getLogger("marketmind.sentiment")

MODEL = "ProsusAI/finbert"
HF_URL = f"https://api-inference.huggingface.co/models/{MODEL}"


class FinBertSentimentProcessor:
    """Batch-scores articles. Mutates the `NewsArticle.sentiment` field in place."""

    def __init__(self, api_key: str, *, max_chars: int = 800) -> None:
        if not api_key:
            raise ValueError("HUGGINGFACE_API_KEY required")
        self.api_key = api_key
        self.max_chars = max_chars

    async def score(self, articles: list[NewsArticle]) -> None:
        """Populate `article.sentiment` for each input."""
        if not articles:
            return

        headers = {"Authorization": f"Bearer {self.api_key}"}
        async with httpx.AsyncClient(timeout=30.0, headers=headers) as client:
            # HF API accepts a single string per request; parallelize across articles.
            tasks = [self._score_one(client, a) for a in articles]
            await asyncio.gather(*tasks, return_exceptions=True)

    async def _score_one(self, client: httpx.AsyncClient, article: NewsArticle) -> None:
        text = self._truncate(article.body or article.headline)
        if not text:
            return

        try:
            r = await client.post(HF_URL, json={"inputs": text, "options": {"wait_for_model": True}})
            r.raise_for_status()
            payload = r.json()
        except Exception as e:
            log.warning("finbert_failed url=%s err=%s", article.url, e)
            return

        # Payload: [[{label, score}, ...]]
        if not isinstance(payload, list) or not payload or not isinstance(payload[0], list):
            return

        scores: dict[str, float] = {}
        for entry in payload[0]:
            label = (entry.get("label") or "").lower()
            score = float(entry.get("score", 0.0))
            scores[label] = score

        positive = scores.get("positive", 0.0)
        negative = scores.get("negative", 0.0)
        article.sentiment = round(positive - negative, 3)

    def _truncate(self, text: str | None) -> str:
        if not text:
            return ""
        return text[: self.max_chars]


def aggregate_sentiment(articles: list[NewsArticle]) -> tuple[float | None, int]:
    """
    Combine per-article sentiments into a single signal in [-1, 1].

    Each article's contribution is weighted by recency:
      - 0-12h:  1.0x
      - 12-24h: 0.8x
      - 1-3d:   0.5x
      - 3-7d:   0.25x
      - >7d:    skipped
    """
    now = datetime.now(timezone.utc)
    weighted_sum = 0.0
    weight_sum = 0.0

    for a in articles:
        if a.sentiment is None:
            continue
        if not a.published_at:
            hours_old = 24.0
        else:
            published = a.published_at if a.published_at.tzinfo else a.published_at.replace(tzinfo=timezone.utc)
            hours_old = max((now - published).total_seconds() / 3600, 0)

        weight = _recency_weight(hours_old)
        if weight <= 0:
            continue
        weighted_sum += a.sentiment * weight
        weight_sum += weight

    if weight_sum == 0:
        return (None, 0)
    return (round(weighted_sum / weight_sum, 3), int(round(weight_sum)))


def _recency_weight(hours_old: float) -> float:
    """Step-function recency weight."""
    if hours_old < 0:
        return 0.0
    if hours_old <= 12:
        return 1.0
    if hours_old <= 24:
        return 0.8
    if hours_old <= 72:
        return 0.5
    if hours_old <= 168:
        return 0.25
    return 0.0


def cross_source_agreement(articles: list[NewsArticle]) -> tuple[int, int]:
    """
    Return (sources_agreeing, sources_total) where 'agreeing' means
    same-direction sentiment as the majority. Strong neutral counts neither way.
    """
    scored = [a for a in articles if a.sentiment is not None]
    if not scored:
        return (0, 0)

    bullish = sum(1 for a in scored if a.sentiment > 0.1)
    bearish = sum(1 for a in scored if a.sentiment < -0.1)
    total = len(scored)

    if bullish > bearish:
        return (bullish, total)
    if bearish > bullish:
        return (bearish, total)
    return (max(bullish, bearish), total)
