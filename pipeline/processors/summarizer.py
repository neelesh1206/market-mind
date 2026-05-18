"""
Article TL;DR generator via Llama-3 on HuggingFace Inference.

Generates a single sentence summary per article — used in stock cards
(under the top headline) to give users immediate context without forcing
them to open the article.

We use a small Instruct model (`meta-llama/Meta-Llama-3-8B-Instruct`) via
the HF Inference Providers routing — same client as the FinBERT path.

Cost: ~30 tokens out × 10 articles × 50 stocks = 15k tokens/day. Well
within the HF free tier; Pro just speeds things up.
"""
from __future__ import annotations

import asyncio
import logging

from huggingface_hub import InferenceClient
from huggingface_hub.errors import HfHubHTTPError

from ..fetchers.types import NewsArticle

log = logging.getLogger("marketmind.summarizer")

MODEL = "meta-llama/Meta-Llama-3-8B-Instruct"

PROMPT_TEMPLATE = (
    "Summarize this financial news headline in one short sentence "
    "(maximum 15 words). Output only the summary, no preamble.\n\n"
    "Headline: {headline}\n"
    "Body: {body}\n\n"
    "Summary:"
)


class LlamaSummarizer:
    """Generates 1-sentence TL;DR for each article. Mutates `article.tldr` in place."""

    def __init__(self, api_key: str, *, max_chars: int = 600) -> None:
        if not api_key:
            raise ValueError("HUGGINGFACE_API_KEY required")
        self._client = InferenceClient(model=MODEL, token=api_key, timeout=30)
        self.max_chars = max_chars

    async def summarize(self, articles: list[NewsArticle]) -> None:
        if not articles:
            return
        await asyncio.gather(
            *(asyncio.to_thread(self._summarize_one, a) for a in articles),
            return_exceptions=True,
        )

    def _summarize_one(self, article: NewsArticle) -> None:
        body = (article.body or "")[: self.max_chars]
        if not body and not article.headline:
            return

        prompt = PROMPT_TEMPLATE.format(headline=article.headline, body=body)

        try:
            result = self._client.text_generation(
                prompt,
                max_new_tokens=40,
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

        if not result:
            return
        cleaned = result.strip().split("\n")[0].strip().rstrip(".")
        if cleaned:
            # Keep it punchy — truncate at 140 chars regardless of model output
            article.tldr = (cleaned[:140] + "…") if len(cleaned) > 140 else cleaned
