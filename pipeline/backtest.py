"""
MarketMind backtest harness.

Goal: empirically validate the **technical** signal bucket by replaying it
against historical OHLCV data and measuring how often it called the next
day's direction correctly.

Approach (technical-only for MVP):
  For each (ticker, trading_day) in the lookback window:
    1. Fetch OHLCV up to (but not including) that day — no lookahead.
    2. Compute technical bucket score using that day's PriceSnapshot.
    3. Compare to *next* trading day's actual open→close direction.
    4. Record: predicted direction (sign of bucket score), actual, magnitude.

Output:
  - CSV: pipeline/backtest_results.csv (one row per evaluation)
  - Stdout summary: accuracy, win rate by bucket score band, hit rate vs
    coin-flip baseline

Sentiment/professional/social backtests would require historical news +
filings + social mentions — that's a Week 2+ effort. The technical
bucket alone is the strongest "boring" baseline to publish.

Usage:
    python -m pipeline.backtest --ticker NVDA --months 12
    python -m pipeline.backtest --tickers NVDA,AAPL,MSFT --months 6
    python -m pipeline.backtest --all --months 12
"""
from __future__ import annotations

import argparse
import csv
import logging
import sys
from dataclasses import dataclass
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

from .fetchers._normalize import to_yahoo_symbol
from .fetchers.yfinance_fetcher import (
    _classify_bollinger,
    _classify_macd,
    _classify_volume_trend,
)
from .observability import init_logging
from .processors.aggregator import technical_score
from .fetchers.types import PriceSnapshot

log = logging.getLogger("marketmind.backtest")

OUTPUT_FILE = Path("pipeline/backtest_results.csv")


@dataclass
class BacktestRow:
    ticker: str
    eval_date: date
    next_date: date
    tech_score: float
    predicted_direction: str   # 'UP' | 'DOWN' | 'NEUTRAL'
    actual_direction: str      # 'UP' | 'DOWN' | 'FLAT'
    actual_pct_change: float
    correct: bool | None       # None if NEUTRAL prediction


def _get_session():
    try:
        from curl_cffi import requests as cffi_requests
        return cffi_requests.Session(impersonate="chrome")
    except ImportError:
        return None


def _download_history(ticker: str, months: int) -> pd.DataFrame:
    """Daily OHLCV for `months` months back plus enough warmup for 50-day MA."""
    start = (date.today() - timedelta(days=int(months * 31) + 90)).isoformat()
    df = yf.download(
        to_yahoo_symbol(ticker),
        start=start,
        interval="1d",
        progress=False,
        auto_adjust=True,
        threads=False,
        session=_get_session(),
    )
    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(level=1, axis=1)
    return df


def _build_snapshot_at(df_through: pd.DataFrame) -> PriceSnapshot | None:
    """
    Build the same PriceSnapshot the live fetcher would, given history up to
    (but excluding) the day we're predicting for.
    """
    if len(df_through) < 50:
        return None  # need enough warmup for 50-day MA / Bollinger

    from ta.momentum import RSIIndicator
    from ta.trend import MACD, SMAIndicator
    from ta.volatility import BollingerBands

    close = df_through["Close"]
    volume = df_through["Volume"]
    last_close = float(close.iloc[-1])

    sma_20 = SMAIndicator(close=close, window=20).sma_indicator().iloc[-1]
    sma_50 = SMAIndicator(close=close, window=50).sma_indicator().iloc[-1]
    rsi = RSIIndicator(close=close, window=14).rsi().iloc[-1]
    macd = MACD(close=close)
    bb = BollingerBands(close=close, window=20, window_dev=2)
    upper = bb.bollinger_hband().iloc[-1]
    lower = bb.bollinger_lband().iloc[-1]

    return PriceSnapshot(
        ticker="(historical)",
        prev_close=last_close,
        day_change_pct=None,
        week_change_pct=None,
        month_change_pct=None,
        ytd_change_pct=None,
        fifty_two_week_high=None,
        fifty_two_week_low=None,
        rsi_14=float(rsi) if pd.notna(rsi) else None,
        macd_signal=_classify_macd(macd.macd(), macd.macd_signal()),
        price_vs_20ma="above" if last_close > float(sma_20) else "below" if pd.notna(sma_20) else None,
        price_vs_50ma="above" if last_close > float(sma_50) else "below" if pd.notna(sma_50) else None,
        bollinger_position=_classify_bollinger(last_close, float(upper), float(lower))
        if pd.notna(upper) and pd.notna(lower) else None,
        volume_trend=_classify_volume_trend(volume),
    )


def backtest_ticker(ticker: str, months: int) -> list[BacktestRow]:
    log.info("backtest_ticker_start ticker=%s months=%s", ticker, months)
    df = _download_history(ticker, months)
    if df.empty:
        log.warning("backtest_no_data ticker=%s", ticker)
        return []

    rows: list[BacktestRow] = []
    # Skip warmup days; we need history for indicators.
    for i in range(60, len(df) - 1):
        history = df.iloc[: i + 1]   # data known at end of day i
        snapshot = _build_snapshot_at(history)
        if snapshot is None:
            continue

        score, _ = technical_score(snapshot)
        if score is None:
            continue

        predicted = "UP" if score > 0.05 else "DOWN" if score < -0.05 else "NEUTRAL"

        # Next trading day's open → close
        next_bar = df.iloc[i + 1]
        actual_pct = (next_bar["Close"] - next_bar["Open"]) / next_bar["Open"] * 100
        if abs(actual_pct) < 0.05:
            actual = "FLAT"
        elif actual_pct > 0:
            actual = "UP"
        else:
            actual = "DOWN"

        correct: bool | None
        if predicted == "NEUTRAL":
            correct = None
        else:
            correct = predicted == actual

        rows.append(
            BacktestRow(
                ticker=ticker,
                eval_date=df.index[i].date(),
                next_date=df.index[i + 1].date(),
                tech_score=round(float(score), 3),
                predicted_direction=predicted,
                actual_direction=actual,
                actual_pct_change=round(float(actual_pct), 3),
                correct=correct,
            )
        )

    return rows


def summarize(rows: list[BacktestRow]) -> None:
    if not rows:
        print("No rows to summarize.")
        return

    decided = [r for r in rows if r.correct is not None]
    total = len(decided)
    correct = sum(1 for r in decided if r.correct)
    neutral_count = len(rows) - total

    print("\n" + "=" * 60)
    print(f" BACKTEST RESULTS")
    print("=" * 60)
    print(f"  Total evaluations:      {len(rows):,}")
    print(f"  Decisive predictions:   {total:,}")
    print(f"  Neutral (no signal):    {neutral_count:,}")
    print(f"  Correct:                {correct:,}")
    print(f"  Accuracy:               {correct / total * 100:.1f}%  (vs 50% coin flip)")
    print()

    # By confidence band
    bands = [
        ("HIGH bullish  (>+0.5)", lambda r: r.tech_score > 0.5),
        ("MED  bullish  (+0.2 to +0.5)", lambda r: 0.2 < r.tech_score <= 0.5),
        ("LOW  bullish  (+0.05 to +0.2)", lambda r: 0.05 < r.tech_score <= 0.2),
        ("LOW  bearish  (-0.2 to -0.05)", lambda r: -0.2 <= r.tech_score < -0.05),
        ("MED  bearish  (-0.5 to -0.2)", lambda r: -0.5 <= r.tech_score < -0.2),
        ("HIGH bearish  (<-0.5)", lambda r: r.tech_score < -0.5),
    ]
    print(f"  {'Band':<32}{'N':>8}{'Accuracy':>12}")
    print(f"  {'-' * 32}{'-' * 8}{'-' * 12}")
    for label, predicate in bands:
        subset = [r for r in decided if predicate(r)]
        if not subset:
            continue
        acc = sum(1 for r in subset if r.correct) / len(subset) * 100
        print(f"  {label:<32}{len(subset):>8}{acc:>11.1f}%")
    print("=" * 60 + "\n")


def write_csv(rows: list[BacktestRow], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        w = csv.writer(f)
        w.writerow(
            [
                "ticker", "eval_date", "next_date", "tech_score",
                "predicted", "actual", "actual_pct", "correct",
            ]
        )
        for r in rows:
            w.writerow([
                r.ticker, r.eval_date.isoformat(), r.next_date.isoformat(),
                r.tech_score, r.predicted_direction, r.actual_direction,
                r.actual_pct_change, "" if r.correct is None else r.correct,
            ])
    log.info("backtest_csv_written path=%s rows=%s", path, len(rows))


def main() -> int:
    parser = argparse.ArgumentParser(description="Backtest the MarketMind technical signal bucket.")
    parser.add_argument("--ticker", help="Single ticker, e.g. NVDA")
    parser.add_argument("--tickers", help="Comma-separated tickers")
    parser.add_argument("--months", type=int, default=12, help="Lookback months (default 12)")
    parser.add_argument("--output", default=str(OUTPUT_FILE), help="CSV output path")
    args = parser.parse_args()

    init_logging("INFO")

    if args.ticker:
        tickers = [args.ticker]
    elif args.tickers:
        tickers = [t.strip() for t in args.tickers.split(",") if t.strip()]
    else:
        # Sensible default: top tech mega-caps
        tickers = ["AAPL", "MSFT", "NVDA", "GOOGL", "META"]

    all_rows: list[BacktestRow] = []
    for ticker in tickers:
        all_rows.extend(backtest_ticker(ticker, args.months))

    write_csv(all_rows, Path(args.output))
    summarize(all_rows)
    return 0


if __name__ == "__main__":
    sys.exit(main())
