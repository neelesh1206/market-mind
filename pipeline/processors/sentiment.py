"""
FinBERT sentiment processor — runs the model LOCALLY (CPU) on the
pipeline runner, not via HuggingFace's Inference API.

Why local
---------
The HF Inference Providers router rate-limits (429s) and times out (cold
starts) frequently enough that running ~500 article classifications per
nightly batch through the network reliably blows our 45-min GH Actions
budget. FinBERT is ~440 MB and runs on CPU in well under a second per
article when batched — well within the runner's resources. Running it
locally removes the largest source of HF round-trips from the critical
path, eliminates the cold-start tax entirely, and is free.

Architecture
------------
- Model + tokenizer are loaded lazily on first `score()` call; subsequent
  pipeline runs reuse the HuggingFace on-disk cache (~/.cache/huggingface).
- We process all articles for a stock in a single batched forward pass —
  much faster than the previous batches-of-3 pattern that existed to
  avoid saturating the HF router.
- The function is sync at its core; we wrap it in `asyncio.to_thread`
  so the orchestrator's event loop stays responsive while the CPU works.

The constructor still accepts an `api_key` argument for backwards
compatibility with the orchestrator's `if cfg.huggingface_api_key:` gate,
but the value is no longer used by the sentiment path.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from ..fetchers.types import NewsArticle

log = logging.getLogger("marketmind.sentiment")

MODEL = "ProsusAI/finbert"
# Cap per-article token count. FinBERT was trained on financial sentences
# (max ~256 tokens); longer inputs get truncated. We also pre-truncate
# the character stream so the tokenizer doesn't waste cycles on the tail.
MAX_TOKENS = 256
MAX_BATCH = 16


class FinBertSentimentProcessor:
    """Local FinBERT — runs on the pipeline runner. No HF round-trips."""

    def __init__(self, api_key: str | None = None, *, max_chars: int = 800) -> None:
        # api_key kept for orchestrator compatibility; not used by local path.
        del api_key
        self.max_chars = max_chars
        self._tokenizer = None
        self._model = None
        self._id2label: dict[int, str] = {}
        self._torch = None  # imported lazily to avoid 800 MB module load when sentiment is disabled

    def _ensure_loaded(self) -> None:
        if self._model is not None:
            return
        log.info("finbert_loading model=%s", MODEL)
        # Lazy imports — heavyweight, only paid when sentiment actually runs.
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self._torch = torch
        self._tokenizer = AutoTokenizer.from_pretrained(MODEL)
        self._model = AutoModelForSequenceClassification.from_pretrained(MODEL)
        self._model.eval()  # inference mode — disables dropout, saves memory
        self._id2label = {
            int(k): v.lower() for k, v in self._model.config.id2label.items()
        }
        log.info("finbert_loaded id2label=%s", self._id2label)

    async def score(self, articles: list[NewsArticle]) -> None:
        """Populate `article.sentiment` for each input in place."""
        if not articles:
            return
        # CPU work runs in a thread so the orchestrator's gather() over
        # fetchers + processors stays responsive.
        await asyncio.to_thread(self._score_batch, articles)

    def _score_batch(self, articles: list[NewsArticle]) -> None:
        self._ensure_loaded()
        assert self._tokenizer is not None and self._model is not None
        assert self._torch is not None

        # Collect (article_index, text) pairs for articles that have text.
        indexed = [
            (i, self._truncate(a.body or a.headline)) for i, a in enumerate(articles)
        ]
        indexed = [(i, t) for i, t in indexed if t]
        if not indexed:
            return

        # FinBERT on CPU handles 16+ items per forward pass comfortably;
        # cap batch size as a defensive memory guard for runs with many articles.
        for start in range(0, len(indexed), MAX_BATCH):
            chunk = indexed[start : start + MAX_BATCH]
            idxs = [i for i, _ in chunk]
            texts = [t for _, t in chunk]

            inputs = self._tokenizer(
                texts,
                padding=True,
                truncation=True,
                max_length=MAX_TOKENS,
                return_tensors="pt",
            )
            with self._torch.no_grad():
                logits = self._model(**inputs).logits
            probs = self._torch.nn.functional.softmax(logits, dim=-1)

            for article_idx, prob_row in zip(idxs, probs, strict=True):
                scores = {
                    self._id2label[i]: float(p) for i, p in enumerate(prob_row.tolist())
                }
                positive = scores.get("positive", 0.0)
                negative = scores.get("negative", 0.0)
                articles[article_idx].sentiment = round(positive - negative, 3)

    def _truncate(self, text: str | None) -> str:
        if not text:
            return ""
        return text[: self.max_chars]


# ---------------------------------------------------------------------------
# Aggregation helpers — unchanged from the API-based implementation.
# ---------------------------------------------------------------------------


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
            published = (
                a.published_at
                if a.published_at.tzinfo
                else a.published_at.replace(tzinfo=timezone.utc)
            )
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
