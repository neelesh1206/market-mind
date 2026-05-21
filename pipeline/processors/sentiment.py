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
# Pin the FinBERT weights to a specific git commit on HF Hub. Without
# this, `from_pretrained()` defaults to `revision="main"` — meaning a
# cache miss on a different day silently downloads whatever HEAD has
# moved to in the meantime, and our resolved-prediction track record
# starts comparing apples to oranges across that boundary.
#
# This SHA is the HEAD of ProsusAI/finbert as of 2026-05-20 (the repo
# itself hasn't been updated since 2023-05-23 — model is effectively
# frozen weights from the original Prosus paper). To upgrade: bump
# this SHA in a PR, re-run the pipeline against a recent date with
# `--dry-run`, diff the bucket scores against the prior run, and only
# then commit. See ADR 0012.
MODEL_REVISION = "4556d13015211d73dccd3fdd39d39232506f3e43"

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
        log.info("finbert_loading model=%s revision=%s", MODEL, MODEL_REVISION[:8])
        # Lazy imports — heavyweight, only paid when sentiment actually runs.
        import torch
        from transformers import AutoModelForSequenceClassification, AutoTokenizer

        self._torch = torch
        # `revision=` accepts a commit SHA, tag, or branch name. Pinning to
        # a commit SHA gives us full reproducibility — same input, same
        # weights, same output across every pipeline run.
        self._tokenizer = AutoTokenizer.from_pretrained(MODEL, revision=MODEL_REVISION)
        self._model = AutoModelForSequenceClassification.from_pretrained(
            MODEL, revision=MODEL_REVISION
        )
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
# Polygon insights blend — ADR 0020.
# ---------------------------------------------------------------------------


def _polygon_to_numeric(sentiment: str | None) -> float | None:
    """Map Polygon's categorical per-ticker sentiment to a numeric score
    on FinBERT's scale (-1.0 to +1.0). Returns None for unrecognised input."""
    if sentiment == "positive":
        return 1.0
    if sentiment == "negative":
        return -1.0
    if sentiment == "neutral":
        return 0.0
    return None


def apply_polygon_blend(articles: list[NewsArticle]) -> int:
    """Fold Polygon's per-ticker sentiment into each article's sentiment field.

    Runs AFTER `FinBERTSentimentProcessor.score()` (which populates
    `article.sentiment` with FinBERT's standalone read). For each article:

      - If both FinBERT and Polygon sentiments are present → simple
        average (equal weight). FinBERT brings a continuous score that
        captures *how* bullish the article reads; Polygon brings a
        categorical ticker-specific call that captures whether the
        sentiment is genuinely directed at this ticker. Equal weighting
        treats them as independent estimators of the same quantity.
      - If only FinBERT → keep it (Polygon's insight was absent — rare
        post-filter, e.g. malformed sentiment value).
      - If only Polygon → use Polygon's numeric mapping (FinBERT may
        have been skipped if the article has no body/headline text).

    Returns the count of articles whose sentiment changed as a result of
    the blend — useful for instrumentation when tuning the weighting.

    Why equal weights (not weighted): we have no calibration data yet to
    justify a specific weighting. Equal-weight is the right Bayesian-prior
    default; ADR 0020 documents how to revisit with resolved-prediction
    data once we have enough.
    """
    changed = 0
    for article in articles:
        polygon_num = _polygon_to_numeric(article.massive_sentiment)
        finbert = article.sentiment

        if finbert is None and polygon_num is None:
            continue
        if finbert is None:
            article.sentiment = round(polygon_num, 3) if polygon_num is not None else None
            changed += 1
            continue
        if polygon_num is None:
            continue

        blended = round((finbert + polygon_num) / 2, 3)
        if blended != finbert:
            article.sentiment = blended
            changed += 1
    return changed


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
