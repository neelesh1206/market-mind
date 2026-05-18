"""
Article summarizer via Llama-3 on HuggingFace Inference.

Produces THREE fields per article for the trust UI:
  - tldr             : one sentence (≤ 140 chars) — for the card glance
  - summary          : 2-3 sentences (≤ 380 chars) — for the stock detail page
  - signal_influence : one sentence — how this article affects the bullish/
                       bearish framing (e.g., "Bullish — analyst upgraded
                       NVDA ahead of next-week's earnings")

Why a single prompt with delimiters (not JSON mode, not 3 separate calls):
  - JSON mode requires provider-specific tooling we don't want to lock to
  - 3 separate calls triple latency and token cost
  - Llama-3-8B-Instruct follows simple "LABEL: text" templates very reliably
  - Parsing is a one-line regex split — robust and free of JSON-escaping bugs

If parsing fails we still salvage whatever fields we can extract (tldr is
the priority since it's what surfaces on the home feed). The article still
gets inserted with whatever fields succeeded — never blocks the row.
"""
from __future__ import annotations

import asyncio
import logging
import re

from huggingface_hub import InferenceClient
from huggingface_hub.errors import HfHubHTTPError

from ..fetchers.types import NewsArticle

log = logging.getLogger("marketmind.summarizer")

MODEL = "meta-llama/Meta-Llama-3-8B-Instruct"

PROMPT_TEMPLATE = """You are a financial news analyst summarizing one article about {ticker} stock.

Output EXACTLY three labeled lines in this format — no preamble, no extra text:

TLDR: <one sentence, max 15 words, the single most important fact>
SUMMARY: <two or three sentences, max 60 words, neutral tone, what happened and key context>
INFLUENCE: <one sentence, max 20 words, framed as Bullish/Bearish/Neutral and why; e.g. "Bullish — analyst upgrade ahead of earnings">

If the article is unrelated to {ticker} or has no signal value, write "Neutral — no direct signal" for INFLUENCE.

Article headline: {headline}
Article body: {body}

Begin output:
"""

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
        self._client = InferenceClient(model=MODEL, token=api_key, timeout=45)
        self.max_body_chars = max_body_chars

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
            raw = self._client.text_generation(
                prompt,
                max_new_tokens=200,
                temperature=0.3,
                return_full_text=False,
            )
        except HfHubHTTPError as e:
            status = e.response.status_code if e.response else "?"
            log.warning("llama_http url=%s status=%s", article.url, status)
            return
        except Exception as e:  # noqa: BLE001
            log.warning("llama_failed url=%s err=%s", article.url, e)
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
