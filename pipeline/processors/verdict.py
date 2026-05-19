"""
MarketMind's daily verdict — combines the 4 bucket scores into a single
UP/DOWN/NEUTRAL prediction with confidence and reasoning.

See ADR 0007 for the design. Weights are versioned so retunes are
attributable; bucket scores are frozen on the prediction row so resolution
accuracy maps back to specific weight cohorts.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Literal

# huggingface_hub is only needed by VerdictReasoner; importing it lazily
# inside that class keeps `compute_verdict` (the pure-math entry point)
# importable in test environments that don't install the ML deps.

from . import _hf_breaker

log = logging.getLogger("marketmind.verdict")

WEIGHTS_V1: dict[str, float] = {
    "technical": 0.30,
    "sentiment": 0.25,
    "professional": 0.30,
    "social": 0.15,
}
WEIGHTS_VERSION = "v1"

# Below this absolute combined score, we call it NEUTRAL.
DIRECTION_THRESHOLD = 0.15

# Vol normalization parameters (ADR 0014).
# REFERENCE_VOL is a fixed prior — the median 20-day realized vol of a
# typical large-cap (~2% daily stddev). Using a fixed prior instead of
# universe-median makes the threshold stable when the universe changes.
REFERENCE_VOL = 0.02
# Clamp vol_factor to prevent extreme over/under-adjustment for outliers
# (e.g. a freshly-IPO'd ticker with three days of history shouldn't get
# a 10× threshold; a stalled penny-stock shouldn't get a 0.01× threshold).
VOL_FACTOR_MIN = 0.5
VOL_FACTOR_MAX = 2.5


Direction = Literal["UP", "DOWN", "NEUTRAL"]


@dataclass
class Verdict:
    direction: Direction
    confidence: float
    reasoning: str | None
    bucket_scores: dict[str, float | None]
    weights_version: str
    # Per-stock direction threshold actually applied (after vol scaling).
    # Frozen here so the resolved-prediction analysis can see exactly
    # which threshold the call was made against.
    adjusted_threshold: float = DIRECTION_THRESHOLD
    vol_factor: float = 1.0
    # The raw weighted-renormalized score before the direction threshold
    # check. Kept on the Verdict so the cross-sectional ranking pass
    # (ADR 0015) can re-rank without recomputing from bucket scores, and
    # so resolved-prediction analysis can stratify by combined-score
    # magnitude independent of the direction call.
    combined_score: float = 0.0


def _vol_factor(realized_vol_20d: float | None) -> float:
    """Map a stock's realized vol to a multiplier on the direction threshold.

    Returns 1.0 (no adjustment) when vol is unavailable. Higher vol →
    higher factor → harder to flip directional. Clamped to
    [VOL_FACTOR_MIN, VOL_FACTOR_MAX].
    """
    if realized_vol_20d is None or realized_vol_20d <= 0:
        return 1.0
    raw = realized_vol_20d / REFERENCE_VOL
    return max(VOL_FACTOR_MIN, min(VOL_FACTOR_MAX, raw))


def compute_verdict(
    *,
    technical: float | None,
    sentiment: float | None,
    professional: float | None,
    social: float | None,
    realized_vol_20d: float | None = None,
) -> Verdict:
    """
    Combine bucket scores into a single weighted verdict.

    Missing buckets (None) are EXCLUDED from the sum; the remaining weights
    are renormalized so present buckets keep their relative importance.
    All-missing → NEUTRAL with confidence 0.

    The directional threshold is **scaled per-stock by realized 20-day
    vol** (ADR 0014). High-vol stocks like NVDA (σ ≈ 3.5% daily) need a
    larger combined score to flip directional than low-vol stocks like
    PG (σ ≈ 0.9%), since the same magnitude signal is less informative
    against louder noise. Vol-unaware callers (omit the kwarg) get the
    flat DIRECTION_THRESHOLD as before.
    """
    raw = {
        "technical": technical,
        "sentiment": sentiment,
        "professional": professional,
        "social": social,
    }
    present = {k: float(v) for k, v in raw.items() if v is not None}

    vol_factor = _vol_factor(realized_vol_20d)
    adjusted_threshold = round(DIRECTION_THRESHOLD * vol_factor, 4)

    if not present:
        return Verdict(
            direction="NEUTRAL",
            confidence=0.0,
            reasoning=None,
            bucket_scores=raw,
            weights_version=WEIGHTS_VERSION,
            adjusted_threshold=adjusted_threshold,
            vol_factor=round(vol_factor, 3),
            combined_score=0.0,
        )

    total_weight = sum(WEIGHTS_V1[k] for k in present)
    combined = sum(present[k] * WEIGHTS_V1[k] for k in present) / total_weight

    if combined > adjusted_threshold:
        direction: Direction = "UP"
    elif combined < -adjusted_threshold:
        direction = "DOWN"
    else:
        direction = "NEUTRAL"

    confidence = min(abs(combined), 1.0)

    return Verdict(
        direction=direction,
        confidence=round(confidence, 3),
        reasoning=None,  # filled below by the reasoning generator
        bucket_scores=raw,
        weights_version=WEIGHTS_VERSION,
        adjusted_threshold=adjusted_threshold,
        vol_factor=round(vol_factor, 3),
        combined_score=round(combined, 3),
    )


# ----------------------------------------------------------------------------
# Reasoning — Llama 1-sentence explanation
# ----------------------------------------------------------------------------

PROMPT = """You are an analyst explaining a stock prediction for {ticker} in ONE short sentence.

The model predicts: {direction} (confidence {confidence_pct}%)

Bucket scores (range -1 bearish to +1 bullish):
- Technical: {tech}
- Sentiment: {sent}
- Professional (analysts + insiders): {prof}
- Social: {soc}

Write ONE sentence (max 25 words) explaining the verdict by naming the 1-2
strongest contributing buckets. Start with "Bullish — ", "Bearish — ", or
"Mixed — " depending on direction. Be concrete; no fluff.

Output only the sentence, no preamble.
"""


class VerdictReasoner:
    """Generates a 1-sentence natural-language reasoning for each verdict."""

    def __init__(self, api_key: str, model: str, provider: str | None = None) -> None:
        if not api_key:
            raise ValueError("HUGGINGFACE_API_KEY required")
        from huggingface_hub import InferenceClient

        # 90s timeout matches the other HF callsites — provider-routed
        # cold starts can take 30-60s on first hit.
        kwargs: dict[str, object] = {"model": model, "token": api_key, "timeout": 90}
        if provider and provider != "auto":
            kwargs["provider"] = provider
        self._client = InferenceClient(**kwargs)  # type: ignore[arg-type]

    def explain(self, *, ticker: str, verdict: Verdict) -> str | None:
        # Circuit-breaker short-circuit: if HF is clearly broken this run,
        # go straight to the rule-based fallback instead of waiting on
        # another 90s timeout.
        if _hf_breaker.should_skip():
            _hf_breaker.record_skip()
            return _fallback_reasoning(verdict)

        scores = verdict.bucket_scores
        prompt = PROMPT.format(
            ticker=ticker,
            direction=verdict.direction,
            confidence_pct=int(round(verdict.confidence * 100)),
            tech=fmt(scores["technical"]),
            sent=fmt(scores["sentiment"]),
            prof=fmt(scores["professional"]),
            soc=fmt(scores["social"]),
        )

        from huggingface_hub.errors import HfHubHTTPError

        try:
            response = self._client.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=80,
                temperature=0.3,
            )
        except HfHubHTTPError as e:
            status = e.response.status_code if getattr(e, "response", None) else "?"
            log.warning("reasoner_http ticker=%s status=%s err=%s", ticker, status, str(e)[:150])
            _hf_breaker.record_failure(f"reasoner_http_{status}")
            return _fallback_reasoning(verdict)
        except Exception as e:  # noqa: BLE001
            log.warning("reasoner_failed ticker=%s err=%s", ticker, str(e)[:150])
            _hf_breaker.record_failure(f"reasoner_{type(e).__name__}")
            return _fallback_reasoning(verdict)

        # Successful round-trip — clear the breaker.
        _hf_breaker.record_success()

        try:
            raw = (response.choices[0].message.content or "").strip()
        except (AttributeError, IndexError):
            return _fallback_reasoning(verdict)

        if not raw:
            return _fallback_reasoning(verdict)

        # Trim to one line
        first_line = raw.split("\n", 1)[0].strip().strip('"').strip("'")
        if len(first_line) > 200:
            first_line = first_line[:197].rstrip(",. ") + "…"
        return first_line


def fmt(v: float | None) -> str:
    if v is None:
        return "n/a"
    return f"{v:+.2f}"


def _fallback_reasoning(verdict: Verdict) -> str:
    """Used when the LLM fails — keeps the row useful even without nice prose."""
    scores = [(k, v) for k, v in verdict.bucket_scores.items() if v is not None]
    if not scores:
        return f"{verdict.direction.title()} — no clear signal across buckets."

    if verdict.direction == "NEUTRAL":
        return "Mixed — buckets point in different directions; no clear read."

    # Pick the top 2 by absolute magnitude in the direction of the verdict
    sign = 1 if verdict.direction == "UP" else -1
    aligned = sorted(
        [(k, v) for k, v in scores if (v * sign) > 0],
        key=lambda kv: abs(kv[1]),
        reverse=True,
    )
    if not aligned:
        prefix = "Bullish" if verdict.direction == "UP" else "Bearish"
        return f"{prefix} — weighted signal slightly above threshold."

    drivers = [k for k, _ in aligned[:2]]
    prefix = "Bullish" if verdict.direction == "UP" else "Bearish"
    return f"{prefix} — driven primarily by {' and '.join(drivers)} signals."
