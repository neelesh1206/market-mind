"""
MarketMind insights pipeline — main entry point.

Run for a single stock (testing):
    python -m pipeline.fetch_insights --ticker NVDA --dry-run

Run the full nightly batch (default — used by the GitHub Action):
    python -m pipeline.fetch_insights

Behavior:
1. Load env config; init Sentry + logging
2. Start a `pipeline_runs` record (status='running')
3. Fetch active stocks from Supabase (optionally limited / filtered)
4. Fetch market-wide macro once (FRED VIX)
5. For each stock, run all fetchers in parallel:
   - yfinance: prices + technicals
   - Massive: news headlines
   - Finnhub: analyst ratings + earnings
   - SEC EDGAR: insider Form 4 / 8-K
6. FinBERT-score each article (if HF key present)
7. Aggregate signals into bucket scores
8. Upsert stock_insights row
9. Insert top 3 articles → insight_articles
10. Record per-source audit → stock_insight_sources
11. Mark pipeline_runs as complete with success/partial/failed
"""
from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any

# Defensive PIT (point-in-time) bounds applied to every NewsArticle before
# it reaches FinBERT, the sources_agree counter, or the displayed top-3.
# Future-dated articles signal a publisher timestamp bug and would
# constitute look-ahead if trusted; very-old articles already get zero
# recency weight in aggregate_sentiment but still leak into top_articles
# (sorted by |sentiment|, not recency) and into cross_source_agreement.
PIT_MAX_AGE_DAYS = 7
PIT_FUTURE_TOLERANCE = timedelta(minutes=15)  # clock skew, not actual lookahead

from .config import load_config
from .fetchers.apewisdom import ApeWisdomFetcher
from .fetchers.base import FetchResult
from .fetchers.finnhub import FinnhubAnalystFetcher, FinnhubEarningsFetcher
from .fetchers.fred import FredMacroFetcher
from .fetchers.massive import MassiveNewsFetcher
from .fetchers.sec_edgar import SecInsiderFetcher
from .fetchers.stocktwits import StockTwitsFetcher
from .fetchers.types import (
    AnalystSnapshot,
    EarningsSnapshot,
    InsiderSnapshot,
    MacroSnapshot,
    NewsArticle,
    PriceSnapshot,
    SocialSnapshot,
)
from .fetchers.yfinance_fetcher import YFinancePriceFetcher
from .observability import capture_error, init_logging, init_sentry
from .processors.aggregator import aggregate
from .processors.ranking import rank_predictions
from .processors.sentiment import (
    FinBertSentimentProcessor,
    aggregate_sentiment,
    cross_source_agreement,
)
from .processors.summarizer import LlamaSummarizer
from .processors.verdict import VerdictReasoner, compute_verdict
from .supabase_client import (
    complete_pipeline_run,
    fetch_active_stocks,
    fetch_marketmind_rows_for_ranking,
    insert_articles,
    make_client,
    record_source,
    start_pipeline_run,
    update_marketmind_rank,
    upsert_marketmind_prediction,
    upsert_stock_insight,
)
from .trading_calendar import next_trading_day


@dataclass
class StockRow:
    id: str
    ticker: str
    name: str
    sector: str


def _to_stock_rows(rows: list[dict[str, Any]]) -> list[StockRow]:
    return [
        StockRow(
            id=r["id"],
            ticker=r["ticker"],
            name=r["name"],
            sector=r["sector"],
        )
        for r in rows
    ]


async def run(args: argparse.Namespace) -> int:
    cfg = load_config()
    init_sentry(cfg.sentry_dsn)
    log = init_logging(cfg.log_level)

    log.info(
        "pipeline_start dry_run=%s ticker=%s limit=%s",
        cfg.dry_run or args.dry_run,
        args.ticker,
        args.limit,
    )

    supabase = make_client(cfg.supabase_url, cfg.supabase_service_key)

    stocks_rows = fetch_active_stocks(supabase)
    stocks = _to_stock_rows(stocks_rows)

    if args.ticker:
        stocks = [s for s in stocks if s.ticker.upper() == args.ticker.upper()]
        if not stocks:
            log.error("ticker_not_found ticker=%s", args.ticker)
            return 2
    if args.limit:
        stocks = stocks[: args.limit]

    log.info("processing_stocks count=%s", len(stocks))

    target_date = args.date or next_trading_day().isoformat()

    run_id = None
    if not (cfg.dry_run or args.dry_run):
        run_id = start_pipeline_run(
            supabase,
            run_type="insights",
            triggered_by="manual" if args.ticker else "cron",
        )
        log.info("pipeline_run_id=%s", run_id)

    # Build fetchers (skip ones we don't have keys for)
    price_fetcher = YFinancePriceFetcher()
    news_fetcher = MassiveNewsFetcher(cfg.massive_api_key) if cfg.massive_api_key else None
    analyst_fetcher = FinnhubAnalystFetcher(cfg.finnhub_api_key) if cfg.finnhub_api_key else None
    earnings_fetcher = FinnhubEarningsFetcher(cfg.finnhub_api_key) if cfg.finnhub_api_key else None
    insider_fetcher = SecInsiderFetcher()
    stocktwits_fetcher = StockTwitsFetcher()
    apewisdom_fetcher = ApeWisdomFetcher()
    reddit_fetcher = None
    if cfg.reddit_client_id and cfg.reddit_client_secret:
        # Import lazily — praw transitively pulls in requests; cheap but unnecessary if skipped.
        from .fetchers.reddit import RedditMentionFetcher

        reddit_fetcher = RedditMentionFetcher(
            cfg.reddit_client_id, cfg.reddit_client_secret, cfg.reddit_user_agent
        )

    sentiment_processor = (
        FinBertSentimentProcessor(cfg.huggingface_api_key) if cfg.huggingface_api_key else None
    )
    summarizer = LlamaSummarizer(cfg.huggingface_api_key) if cfg.huggingface_api_key else None

    # Verdict reasoner uses the same model/provider as the summarizer.
    import os as _os

    verdict_reasoner = None
    if cfg.huggingface_api_key:
        verdict_reasoner = VerdictReasoner(
            cfg.huggingface_api_key,
            model=_os.getenv(
                "HUGGINGFACE_SUMMARY_MODEL", "mistralai/Mistral-7B-Instruct-v0.3"
            ),
            provider=_os.getenv("HUGGINGFACE_PROVIDER", "auto"),
        )

    # Market-wide macro: fetch once.
    macro: MacroSnapshot | None = None
    if cfg.fred_api_key:
        fred = FredMacroFetcher(cfg.fred_api_key)
        result = await fred.fetch("MARKET")
        if result.status == "success":
            macro = result.data
        else:
            log.warning("fred_failed err=%s", result.error)

    stats = {"processed": 0, "sources_succeeded": 0, "sources_failed": 0, "errors": []}

    # Inter-stock pacing — Massive's news endpoint throttles when we hammer
    # 50 stocks back-to-back. A 1.2s sleep between stocks keeps us under any
    # plausible per-second cap while still finishing a 50-stock batch in ~3
    # minutes. The first stock has no pre-sleep.
    INTER_STOCK_SLEEP_SECONDS = 1.2

    for idx, stock in enumerate(stocks):
        if idx > 0:
            await asyncio.sleep(INTER_STOCK_SLEEP_SECONDS)
        try:
            await _process_stock(
                stock=stock,
                target_date=target_date,
                supabase=supabase,
                dry_run=cfg.dry_run or args.dry_run,
                price_fetcher=price_fetcher,
                news_fetcher=news_fetcher,
                analyst_fetcher=analyst_fetcher,
                earnings_fetcher=earnings_fetcher,
                insider_fetcher=insider_fetcher,
                stocktwits_fetcher=stocktwits_fetcher,
                apewisdom_fetcher=apewisdom_fetcher,
                reddit_fetcher=reddit_fetcher,
                sentiment_processor=sentiment_processor,
                summarizer=summarizer,
                verdict_reasoner=verdict_reasoner,
                macro=macro,
                stats=stats,
                log=log,
            )
            stats["processed"] += 1
        except Exception as e:  # noqa: BLE001
            capture_error(e, ticker=stock.ticker)
            log.exception("stock_failed ticker=%s", stock.ticker)
            stats["errors"].append({"ticker": stock.ticker, "error": str(e)})

    # Cross-sectional ranking pass (ADR 0015). Runs after all per-stock
    # work is done. Skipped in dry-run since there's nothing in the DB
    # to rank against, and skipped when only a subset of the universe
    # was processed (--ticker / --limit) since the rank would be
    # misleading without the full cross-section.
    full_universe = not (cfg.dry_run or args.dry_run or args.ticker or args.limit)
    if full_universe:
        try:
            _rank_universe(supabase, target_date, log)
        except Exception as e:  # noqa: BLE001
            capture_error(e)
            log.exception("ranking_pass_failed err=%s", e)

    status = "success"
    if stats["sources_failed"] > stats["sources_succeeded"]:
        status = "partial"
    if stats["processed"] == 0:
        status = "failed"

    if run_id:
        complete_pipeline_run(
            supabase,
            run_id=run_id,
            status=status,
            stocks_processed=stats["processed"],
            sources_succeeded=stats["sources_succeeded"],
            sources_failed=stats["sources_failed"],
            error_summary={"errors": stats["errors"][:10]} if stats["errors"] else None,
        )

    from .processors._hf_breaker import snapshot as _hf_snapshot

    hf = _hf_snapshot()
    log.info(
        "pipeline_done status=%s processed=%s ok=%s failed=%s "
        "hf_tripped=%s hf_skipped=%s",
        status,
        stats["processed"],
        stats["sources_succeeded"],
        stats["sources_failed"],
        hf["tripped"],
        hf["skipped"],
    )
    return 0 if status == "success" else 1


async def _process_stock(
    *,
    stock: StockRow,
    target_date: str,
    supabase: Any,
    dry_run: bool,
    price_fetcher: YFinancePriceFetcher,
    news_fetcher: MassiveNewsFetcher | None,
    analyst_fetcher: FinnhubAnalystFetcher | None,
    earnings_fetcher: FinnhubEarningsFetcher | None,
    insider_fetcher: SecInsiderFetcher,
    stocktwits_fetcher: StockTwitsFetcher,
    apewisdom_fetcher: ApeWisdomFetcher,
    reddit_fetcher: Any | None,
    sentiment_processor: FinBertSentimentProcessor | None,
    summarizer: LlamaSummarizer | None,
    verdict_reasoner: VerdictReasoner | None,
    macro: MacroSnapshot | None,
    stats: dict[str, Any],
    log: logging.Logger,
) -> None:
    log.info("stock_start ticker=%s", stock.ticker)

    # Parallel fetch across sources.
    tasks: list[Any] = [price_fetcher.fetch(stock.ticker)]
    labels: list[str] = ["price"]

    if news_fetcher:
        tasks.append(news_fetcher.fetch(stock.ticker))
        labels.append("news")
    if analyst_fetcher:
        tasks.append(analyst_fetcher.fetch(stock.ticker))
        labels.append("analyst")
    if earnings_fetcher:
        tasks.append(earnings_fetcher.fetch(stock.ticker))
        labels.append("earnings")
    tasks.append(insider_fetcher.fetch(stock.ticker))
    labels.append("insider")
    tasks.append(stocktwits_fetcher.fetch(stock.ticker))
    labels.append("stocktwits")
    tasks.append(apewisdom_fetcher.fetch(stock.ticker))
    labels.append("apewisdom")
    if reddit_fetcher:
        tasks.append(reddit_fetcher.fetch(stock.ticker))
        labels.append("reddit")

    raw_results = await asyncio.gather(*tasks, return_exceptions=True)
    results: dict[str, FetchResult[Any]] = {}
    for label, res in zip(labels, raw_results, strict=False):
        if isinstance(res, BaseException):
            log.warning("fetcher_exception label=%s ticker=%s err=%s", label, stock.ticker, res)
            stats["sources_failed"] += 1
            continue
        results[label] = res
        if res.status == "success":
            stats["sources_succeeded"] += 1
        else:
            stats["sources_failed"] += 1

    # Unpack typed results (None if missing/failed).
    price: PriceSnapshot | None = _data(results.get("price"))
    articles: list[NewsArticle] = _data(results.get("news")) or []
    articles = _apply_pit_filter(articles, ticker=stock.ticker, log=log)
    analyst: AnalystSnapshot | None = _data(results.get("analyst"))
    earnings: EarningsSnapshot | None = _data(results.get("earnings"))
    insider: InsiderSnapshot | None = _data(results.get("insider"))
    social: SocialSnapshot | None = _build_social(
        stocktwits=_data(results.get("stocktwits")),
        apewisdom=_data(results.get("apewisdom")),
        reddit=_data(results.get("reddit")),
    )

    # FinBERT-score articles in place.
    if sentiment_processor and articles:
        try:
            await sentiment_processor.score(articles)
        except Exception as e:  # noqa: BLE001
            log.warning("sentiment_failed ticker=%s err=%s", stock.ticker, e)

    # Llama-3 summarization for the top 3 articles by absolute sentiment.
    # We only summarize the ones we'll actually display — keeps inference cost down.
    if summarizer and articles:
        top_for_summary = sorted(
            [a for a in articles if a.sentiment is not None],
            key=lambda a: abs(a.sentiment or 0),
            reverse=True,
        )[:3]
        if top_for_summary:
            try:
                await summarizer.summarize(top_for_summary, ticker=stock.ticker)
            except Exception as e:  # noqa: BLE001
                log.warning("summarizer_failed ticker=%s err=%s", stock.ticker, e)

    sentiment_value, article_count = aggregate_sentiment(articles)
    sources_agree, sources_total = cross_source_agreement(articles)

    buckets = aggregate(
        price=price,
        articles=articles,
        sentiment_score=sentiment_value,
        sentiment_article_count=article_count,
        sources_agree=sources_agree,
        sources_total=sources_total,
        analyst=analyst,
        insider=insider,
        earnings=earnings,
        social=social,
        macro=macro,
    )

    payload = _build_insight_payload(
        stock_id=stock.id,
        target_date=target_date,
        price=price,
        articles=articles,
        sentiment_value=sentiment_value,
        article_count=article_count,
        sources_agree=sources_agree,
        sources_total=sources_total,
        analyst=analyst,
        earnings=earnings,
        insider=insider,
        social=social,
        macro=macro,
        buckets=buckets,
    )

    if dry_run:
        log.info("dry_run_payload ticker=%s scores=%s", stock.ticker, _scores_repr(buckets))
        return

    inserted = upsert_stock_insight(supabase, payload)
    insight_id = inserted["id"]
    log.info("inserted ticker=%s insight_id=%s scores=%s", stock.ticker, insight_id, _scores_repr(buckets))

    # Top-3 articles → insight_articles
    top_articles = sorted(
        [a for a in articles if a.sentiment is not None],
        key=lambda a: abs(a.sentiment or 0),
        reverse=True,
    )[:3]
    if top_articles:
        insert_articles(
            supabase,
            [
                {
                    "insight_id": insight_id,
                    "headline": a.headline[:500],
                    "url": a.url[:1000],
                    "source": a.source[:100],
                    "published_at": a.published_at.isoformat() if a.published_at else None,
                    "sentiment": a.sentiment,
                    "tldr": a.tldr,
                    "summary": a.summary,
                    "signal_influence": a.signal_influence,
                    "display_rank": i + 1,
                }
                for i, a in enumerate(top_articles)
            ],
        )

    # Audit trail per source
    for label, result in results.items():
        record_source(
            supabase,
            insight_id=insight_id,
            source_name=label,
            status=result.status,
            latency_ms=result.latency_ms,
            error_detail=result.error,
        )

    # MarketMind verdict — combines the 4 bucket scores into UP/DOWN/NEUTRAL.
    # See ADR 0007. Stored in marketmind_predictions so the resolution job
    # can score it like a user prediction and build a public track record.
    verdict = compute_verdict(
        technical=buckets.technical,
        sentiment=buckets.sentiment,
        professional=buckets.professional,
        social=buckets.social,
        realized_vol_20d=price.realized_vol_20d if price else None,
    )
    # Attach the aggregator's breakdown so _fallback_reasoning has access
    # to the concrete per-bucket numbers (analyst splits, insider activity,
    # technical classifications) and can produce richer fallback text when
    # the LLM reasoner fails. Not serialized to the DB — already in
    # `stock_insights.signal_breakdown`.
    verdict.breakdown = buckets.breakdown
    reasoning: str | None = None
    if verdict_reasoner:
        try:
            reasoning = await asyncio.to_thread(
                verdict_reasoner.explain, ticker=stock.ticker, verdict=verdict
            )
        except Exception as e:  # noqa: BLE001
            log.warning("verdict_reasoner_failed ticker=%s err=%s", stock.ticker, e)
    if reasoning is None:
        # Fallback to the rule-based explainer baked into verdict.py
        from .processors.verdict import _fallback_reasoning

        reasoning = _fallback_reasoning(verdict)

    upsert_marketmind_prediction(
        supabase,
        {
            "insight_id": insight_id,
            "stock_id": stock.id,
            "prediction_date": target_date,
            "direction": verdict.direction,
            "confidence": verdict.confidence,
            "reasoning": reasoning,
            "bucket_scores": verdict.bucket_scores,
            "weights_version": verdict.weights_version,
            # ADR 0015 — raw score for cross-sectional ranking. The
            # ranking pass at end of run will set rank_in_universe.
            "combined_score": verdict.combined_score,
        },
    )
    log.info(
        "verdict ticker=%s direction=%s confidence=%.2f vol=%s factor=%.2f threshold=%.3f",
        stock.ticker,
        verdict.direction,
        verdict.confidence,
        (
            f"{price.realized_vol_20d:.4f}"
            if (price and price.realized_vol_20d is not None)
            else "n/a"
        ),
        verdict.vol_factor,
        verdict.adjusted_threshold,
    )


def _rank_universe(supabase: Any, target_date: str, log: logging.Logger) -> None:
    """Post-pass: pull today's marketmind_predictions and assign rank_in_universe.

    Skipped on dry-run / single-ticker / limited runs (the caller checks
    `full_universe` before invoking).
    """
    rows = fetch_marketmind_rows_for_ranking(supabase, prediction_date=target_date)
    if not rows:
        log.info("ranking_pass_no_rows date=%s", target_date)
        return

    ranked = rank_predictions(rows)
    log.info("ranking_pass_started count=%s", len(ranked))

    for row_id, rank, _score, _ticker in ranked:
        update_marketmind_rank(supabase, row_id=row_id, rank=rank)

    # Top 5 long / bottom 5 short — the high-conviction surface.
    top = ranked[:5]
    bottom = ranked[-5:][::-1]  # reverse so most-bearish is first

    def _fmt(items: list[tuple[str, int, float, str | None]]) -> str:
        return " ".join(f"{t or '?'}({s:+.2f})" for _id, _r, s, t in items)

    log.info("top_long  %s", _fmt(top))
    log.info("top_short %s", _fmt(bottom))


def _build_social(
    *,
    stocktwits: dict | None,
    apewisdom: dict | None,
    reddit: dict | None,
) -> SocialSnapshot | None:
    """Coalesce raw fetcher outputs into a SocialSnapshot. Returns None if all empty."""
    if not stocktwits and not apewisdom and not reddit:
        return None

    # Prefer Reddit's full-context delta if available; fall back to ApeWisdom's
    # 24h cache delta which is also reliable for WSB-heavy tickers.
    reddit_count = (reddit or {}).get("count_24h")
    reddit_delta = (reddit or {}).get("delta_pct")
    if reddit_delta is None:
        reddit_count = (apewisdom or {}).get("mentions")
        reddit_delta = (apewisdom or {}).get("delta_pct")

    return SocialSnapshot(
        reddit_mention_count=reddit_count,
        reddit_mention_delta=reddit_delta,
        apewisdom_rank=(apewisdom or {}).get("rank"),
        stocktwits_bullish=(stocktwits or {}).get("bullish_pct"),
        stocktwits_messages=(stocktwits or {}).get("message_count"),
        google_trend_score=None,  # not yet wired
    )


def _data(result: FetchResult[Any] | None) -> Any:
    if result is None or result.status != "success":
        return None
    return result.data


def _apply_pit_filter(
    articles: list[NewsArticle], *, ticker: str, log: logging.Logger
) -> list[NewsArticle]:
    """Drop articles that fail point-in-time discipline.

    Two cases:
      - `published_at` is in the future beyond clock-skew tolerance — almost
        always a publisher timestamp bug; trusting it would be look-ahead.
      - `published_at` is older than PIT_MAX_AGE_DAYS — stale enough that
        any sentiment it carries is unrelated to the next session's move.
        These already get 0 recency weight in the aggregator, but they
        still leak into top-3 display (sorted by |sentiment|) and into
        sources_agree counts. Drop them at the source instead.

    Articles with `published_at = None` are kept (we can't classify them).
    """
    if not articles:
        return articles

    now = datetime.now(timezone.utc)
    cutoff_past = now - timedelta(days=PIT_MAX_AGE_DAYS)
    cutoff_future = now + PIT_FUTURE_TOLERANCE

    kept: list[NewsArticle] = []
    dropped_future = 0
    dropped_stale = 0

    for a in articles:
        if a.published_at is None:
            kept.append(a)
            continue
        published = (
            a.published_at
            if a.published_at.tzinfo
            else a.published_at.replace(tzinfo=timezone.utc)
        )
        if published > cutoff_future:
            dropped_future += 1
            continue
        if published < cutoff_past:
            dropped_stale += 1
            continue
        kept.append(a)

    if dropped_future or dropped_stale:
        log.info(
            "pit_filter ticker=%s kept=%s dropped_future=%s dropped_stale=%s",
            ticker,
            len(kept),
            dropped_future,
            dropped_stale,
        )
    return kept


def _scores_repr(buckets: Any) -> str:
    return (
        f"tech={buckets.technical} sent={buckets.sentiment} "
        f"prof={buckets.professional} soc={buckets.social}"
    )


def _build_insight_payload(
    *,
    stock_id: str,
    target_date: str,
    price: PriceSnapshot | None,
    articles: list[NewsArticle],
    sentiment_value: float | None,
    article_count: int,
    sources_agree: int,
    sources_total: int,
    analyst: AnalystSnapshot | None,
    earnings: EarningsSnapshot | None,
    insider: InsiderSnapshot | None,
    social: SocialSnapshot | None,
    macro: MacroSnapshot | None,
    buckets: Any,
) -> dict[str, Any]:
    top = articles[0] if articles else None

    return {
        "stock_id": stock_id,
        "insight_date": target_date,
        # `computed_at` has a `default now()` in the schema, but that only
        # fires on INSERT — when the upsert hits the conflict path and
        # UPDATEs an existing row, the original timestamp is preserved.
        # We set it explicitly here so the UI's "updated N ago" label
        # reflects when the bucket scores were actually last refreshed.
        "computed_at": datetime.now(timezone.utc).isoformat(),
        # Price
        "prev_close": price.prev_close if price else None,
        "day_change_pct": price.day_change_pct if price else None,
        "week_change_pct": price.week_change_pct if price else None,
        "month_change_pct": price.month_change_pct if price else None,
        "ytd_change_pct": price.ytd_change_pct if price else None,
        "fifty_two_week_high": price.fifty_two_week_high if price else None,
        "fifty_two_week_low": price.fifty_two_week_low if price else None,
        # Technical
        "rsi_14": price.rsi_14 if price else None,
        "macd_signal": price.macd_signal if price else None,
        "price_vs_20ma": price.price_vs_20ma if price else None,
        "price_vs_50ma": price.price_vs_50ma if price else None,
        "bollinger_position": price.bollinger_position if price else None,
        "volume_trend": price.volume_trend if price else None,
        "technical_score": buckets.technical,
        # Sentiment
        "news_sentiment_score": sentiment_value,
        "news_article_count": article_count,
        "top_headline": top.headline[:500] if top else None,
        "top_headline_url": top.url[:1000] if top else None,
        "top_headline_source": top.source[:100] if top else None,
        "sources_agree_count": sources_agree,
        "sources_total_count": sources_total,
        "sentiment_score": buckets.sentiment,
        # Professional
        "analyst_count": analyst.analyst_count if analyst else None,
        "analyst_buy": analyst.analyst_buy if analyst else None,
        "analyst_hold": analyst.analyst_hold if analyst else None,
        "analyst_sell": analyst.analyst_sell if analyst else None,
        "analyst_price_target": analyst.analyst_price_target if analyst else None,
        "analyst_rating_change": analyst.rating_change if analyst else None,
        "insider_activity": insider.activity if insider else None,
        "insider_detail": insider.detail if insider else None,
        "earnings_date": earnings.earnings_date.isoformat() if earnings and earnings.earnings_date else None,
        "earnings_in_days": earnings.days_until if earnings else None,
        "has_recent_8k": insider.has_recent_8k if insider else False,
        "professional_score": buckets.professional,
        # Social
        "reddit_mention_count": social.reddit_mention_count if social else None,
        "reddit_mention_delta": social.reddit_mention_delta if social else None,
        "apewisdom_rank": social.apewisdom_rank if social else None,
        "stocktwits_bullish": social.stocktwits_bullish if social else None,
        "stocktwits_messages": social.stocktwits_messages if social else None,
        "google_trend_score": social.google_trend_score if social else None,
        "social_score": buckets.social,
        # Macro
        "sector_etf_change_pct": macro.sector_etf_change_pct if macro else None,
        "vix_level": macro.vix_level if macro else None,
        # Full breakdown payload
        "signal_breakdown": buckets.breakdown,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch and compute MarketMind stock insights.")
    parser.add_argument("--ticker", help="Process a single ticker (testing)")
    parser.add_argument("--limit", type=int, help="Process only N stocks (testing)")
    parser.add_argument("--date", help="Target insight_date (ISO format). Defaults to next trading day.")
    parser.add_argument("--dry-run", action="store_true", help="Do not write to Supabase")
    args = parser.parse_args()
    return asyncio.run(run(args))


if __name__ == "__main__":
    sys.exit(main())
