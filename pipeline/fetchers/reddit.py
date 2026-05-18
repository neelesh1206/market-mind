"""
Reddit mention counter — counts ticker mentions in r/wallstreetbets,
r/stocks, r/investing over the last 24h vs the prior 7-day average.

Uses PRAW (Python Reddit API Wrapper) → requires a free Reddit "script"
app. If `REDDIT_CLIENT_ID` is absent, the orchestrator skips this fetcher
entirely (graceful degradation).
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timedelta, timezone

import praw

from .base import AbstractFetcher

log = logging.getLogger("marketmind.reddit")

SUBREDDITS = ["wallstreetbets", "stocks", "investing"]
TICKER_PATTERN_TEMPLATE = r"(?:^|\W)\$?{ticker}(?:$|\W)"


class RedditMentionFetcher(AbstractFetcher[dict]):
    """Returns {count_24h, avg_7d, delta_pct}."""

    name = "reddit"
    timeout_seconds = 20.0

    def __init__(self, client_id: str, client_secret: str, user_agent: str) -> None:
        super().__init__()
        if not client_id or not client_secret:
            raise ValueError("Reddit client credentials required")
        self._reddit = praw.Reddit(
            client_id=client_id,
            client_secret=client_secret,
            user_agent=user_agent,
            check_for_async=False,
        )

    async def _fetch_impl(self, ticker: str) -> dict:
        # PRAW is sync; offload to a thread.
        import asyncio

        return await asyncio.to_thread(self._count_mentions, ticker)

    def _count_mentions(self, ticker: str) -> dict:
        pattern = re.compile(TICKER_PATTERN_TEMPLATE.format(ticker=re.escape(ticker)), re.IGNORECASE)

        now = time.time()
        one_day_ago = now - 86400
        seven_days_ago = now - 7 * 86400

        count_24h = 0
        count_7d = 0

        for sub_name in SUBREDDITS:
            sub = self._reddit.subreddit(sub_name)
            # `.new()` returns most-recent submissions; cap at 200 per sub for cost.
            try:
                submissions = list(sub.new(limit=200))
            except Exception as e:  # noqa: BLE001
                log.warning("reddit_subreddit_failed sub=%s err=%s", sub_name, e)
                continue

            for s in submissions:
                if s.created_utc < seven_days_ago:
                    break
                text = f"{s.title}\n{s.selftext or ''}"
                if pattern.search(text):
                    count_7d += 1
                    if s.created_utc >= one_day_ago:
                        count_24h += 1

        avg_per_day_prior_6d = (count_7d - count_24h) / 6 if count_7d > count_24h else 0
        delta_pct = None
        if avg_per_day_prior_6d > 0:
            delta_pct = round((count_24h - avg_per_day_prior_6d) / avg_per_day_prior_6d * 100, 1)

        return {
            "count_24h": count_24h,
            "avg_7d": round((count_7d / 7), 2) if count_7d else 0,
            "delta_pct": delta_pct,
        }
