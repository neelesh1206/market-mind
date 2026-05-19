"""
FinBERT sentiment processor via HuggingFace `InferenceClient`.

HuggingFace migrated from the legacy `api-inference.huggingface.co` endpoint
to the new Inference Providers routing (`router.huggingface.co`). The
`huggingface_hub` Python library handles this transparently — we use it
instead of raw HTTP so we don't have to track endpoint changes ourselves.

Free tier is plenty for our scale (~500 inferences/nightly batch). The first
call to a "cold" model can take 10-30s while it loads — subsequent calls
are fast. We swallow individual failures so one bad article doesn't kill
the batch.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from huggingface_hub import InferenceClient
from huggingface_hub.errors import HfHubHTTPError

from ..fetchers.types import NewsArticle

log = logging.getLogger("marketmind.sentiment")

MODEL = "ProsusAI/finbert"


class FinBertSentimentProcessor:
    """Batch-scores articles. Mutates the `NewsArticle.sentiment` field in place."""

    def __init__(self, api_key: str, *, max_chars: int = 800) -> None:
        if not api_key:
            raise ValueError("HUGGINGFACE_API_KEY required")
        # 60s leaves headroom for FinBERT cold starts on hf-inference. The
        # serverless model can take 10-30s to load on first hit per region;
        # subsequent calls are <1s.
        self._client = InferenceClient(model=MODEL, token=api_key, timeout=60)
        self.max_chars = max_chars

    async def score(self, articles: list[NewsArticle]) -> None:
        """Populate `article.sentiment` for each input."""
        if not articles:
            return

        # text_classification is synchronous on the client; offload each call to a thread
        # so we can parallelize. Default thread pool is fine for this volume.
        await asyncio.gather(
            *(asyncio.to_thread(self._score_one, a) for a in articles),
            return_exceptions=True,
        )

    def _score_one(self, article: NewsArticle) -> None:
        text = self._truncate(article.body or article.headline)
        if not text:
            return

        try:
            results = self._client.text_classification(text)
        except HfHubHTTPError as e:
            log.warning("finbert_http url=%s status=%s", article.url, e.response.status_code if e.response else "?")
            return
        except Exception as e:  # noqa: BLE001
            log.warning("finbert_failed url=%s err=%s", article.url, e)
            return

        # InferenceClient returns a list of {label, score} dicts.
        # FinBERT labels: 'positive', 'neutral', 'negative'.
        scores: dict[str, float] = {}
        for entry in results or []:
            label = entry.label.lower() if hasattr(entry, "label") else (entry.get("label") or "").lower()
            score = entry.score if hasattr(entry, "score") else float(entry.get("score", 0.0))
            scores[label] = float(score)

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
