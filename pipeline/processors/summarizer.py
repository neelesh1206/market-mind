"""
Article summarizer via HuggingFace Inference (chat_completion API).

Produces THREE fields per article for the trust UI:
  - tldr             : one sentence (≤ 140 chars) — for the card glance
  - summary          : 2-3 sentences (≤ 380 chars) — for the stock detail page
  - signal_influence : one sentence — how this article affects the bullish/
                       bearish framing (e.g., "Bullish — analyst upgraded
                       NVDA ahead of next-week's earnings")

Model + API notes:
  - We use `chat_completion` (not `text_generation`) — it's the newer
    OpenAI-compatible interface that routes cleanly across HF's Inference
    Providers. `text_generation` against gated/Pro models tends to return
    HfHubHTTPError with no response body, which is impossible to debug.
  - Default model is Mistral-7B-Instruct-v0.3 — reliably available on the
    free `hf-inference` provider. Llama-3 models are gated and often Pro-only.
  - The model is configurable via `HUGGINGFACE_SUMMARY_MODEL` env var so we
    can A/B without code changes.

Output format:
  Single labeled-line response (TLDR / SUMMARY / INFLUENCE). Parsing tolerates
  mixed case, quotes, trailing punctuation, and partial output — if any one
  field fails the others still land.
"""
from __future__ import annotations

import asyncio
import logging
import os
import re

from huggingface_hub import InferenceClient
from huggingface_hub.errors import HfHubHTTPError

from ..fetchers.types import NewsArticle

log = logging.getLogger("marketmind.summarizer")

DEFAULT_MODEL = "mistralai/Mistral-7B-Instruct-v0.3"

PROMPT_TEMPLATE = """You are a financial news analyst summarizing one article about {ticker} stock.

Output EXACTLY three labeled lines in this format — no preamble, no extra text:

TLDR: <one sentence, max 15 words, the single most important fact>
SUMMARY: <two or three sentences, max 60 words, neutral tone, what happened and key context>
INFLUENCE: <one sentence, max 20 words, framed as Bullish/Bearish/Neutral and why; e.g. "Bullish — analyst upgrade ahead of earnings">

If the article is unrelated to {ticker} or has no signal value, write "Neutral — no direct signal" for INFLUENCE.

Article headline: {headline}
Article body: {body}"""

LABEL_PATTERN = re.compile(
    r"^\s*(TLDR|SUMMARY|INFLUENCE)\s*:\s*(.+?)\s*$",
    re.IGNORECASE,
)

MAX_TLDR_CHARS = 140
MAX_SUMMARY_CHARS = 380
MAX_INFLUENCE_CHARS = 160


class LlamaSummarizer:
    """Generates structured per-article summary. Mutates NewsArticle in place."""

    def __init__(self, api_key: str, *, max_body_chars: int = 1200) -> None:
        if not api_key:
            raise ValueError("HUGGINGFACE_API_KEY required")
        self.model = os.getenv("HUGGINGFACE_SUMMARY_MODEL", DEFAULT_MODEL)

        # Provider routing:
        # - Llama-3 / Llama-4 / etc. are gated and only served by paid providers
        #   (Together, Nebius, Fireworks, etc.) — `hf-inference` rejects them
        #   with "Model not supported by provider hf-inference".
        # - HF Pro includes credits for the paid providers, so `auto` routing
        #   works for Pro users.
        # - For free-tier users on the default Mistral model, `auto` still
        #   lands on `hf-inference` so nothing changes.
        # An explicit override is available for advanced users.
        provider = os.getenv("HUGGINGFACE_PROVIDER", "auto")
        client_kwargs: dict[str, object] = {
            "model": self.model,
            "token": api_key,
            "timeout": 45,
        }
        if provider != "auto":
            client_kwargs["provider"] = provider

        self._client = InferenceClient(**client_kwargs)  # type: ignore[arg-type]
        self.max_body_chars = max_body_chars
        log.info("summarizer_init model=%s provider=%s", self.model, provider)

    async def summarize(self, articles: list[NewsArticle], *, ticker: str) -> None:
        if not articles:
            return
        await asyncio.gather(
            *(asyncio.to_thread(self._summarize_one, a, ticker) for a in articles),
            return_exceptions=True,
        )

    def _summarize_one(self, article: NewsArticle, ticker: str) -> None:
        body = (article.body or "")[: self.max_body_chars]
        if not body and not article.headline:
            return

        prompt = PROMPT_TEMPLATE.format(
            ticker=ticker,
            headline=article.headline,
            body=body or "(no body — use headline)",
        )

        try:
            response = self._client.chat_completion(
                messages=[{"role": "user", "content": prompt}],
                max_tokens=220,
                temperature=0.3,
            )
        except HfHubHTTPError as e:
            # Log everything we can extract — these errors are the hardest to debug.
            status = e.response.status_code if getattr(e, "response", None) else "?"
            body_repr = ""
            if getattr(e, "response", None):
                try:
                    body_repr = e.response.text[:200]
                except Exception:
                    pass
            log.warning(
                "llama_http url=%s status=%s err=%s body=%r",
                article.url, status, str(e)[:200], body_repr,
            )
            return
        except Exception as e:  # noqa: BLE001
            log.warning(
                "llama_failed url=%s type=%s err=%s",
                article.url, type(e).__name__, str(e)[:300],
            )
            return

        try:
            raw = response.choices[0].message.content
        except (AttributeError, IndexError, KeyError) as e:
            log.warning("llama_bad_response url=%s err=%s", article.url, e)
            return

        if not raw:
            return

        parsed = _parse_labeled_output(raw)
        if not parsed:
            log.warning("llama_unparseable url=%s raw=%r", article.url, raw[:200])
            return

        if (tldr := parsed.get("tldr")):
            article.tldr = _trim(tldr, MAX_TLDR_CHARS)
        if (summary := parsed.get("summary")):
            article.summary = _trim(summary, MAX_SUMMARY_CHARS)
        if (influence := parsed.get("influence")):
            article.signal_influence = _trim(influence, MAX_INFLUENCE_CHARS)


def _parse_labeled_output(raw: str) -> dict[str, str]:
    """
    Extract TLDR/SUMMARY/INFLUENCE fields from a labeled response.

    Handles minor formatting drift:
      - Extra whitespace
      - Mixed case labels (Tldr:, summary:)
      - Trailing periods, newlines, quotes
      - Model echoing the prompt section back
    """
    out: dict[str, str] = {}
    for line in raw.splitlines():
        m = LABEL_PATTERN.match(line)
        if not m:
            continue
        key = m.group(1).lower()
        value = m.group(2).strip().strip('"').strip("'").rstrip(".")
        if value:
            out[key] = value
    return out


def _trim(text: str, max_chars: int) -> str:
    text = text.strip()
    if len(text) <= max_chars:
        return text
    # Trim at a word boundary when possible
    cut = text[: max_chars - 1]
    if " " in cut:
        cut = cut.rsplit(" ", 1)[0]
    return cut.rstrip(",.;:") + "…"
