"""
yfinance-backed price + technical indicators fetcher.

Used for: full historical OHLCV (free, unlimited), then computes RSI, MACD,
moving averages, Bollinger bands locally via the `ta` library.

yfinance is unofficial — wrap calls in `asyncio.to_thread` since the library is sync.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

import pandas as pd
import yfinance as yf
from ta.momentum import RSIIndicator
from ta.trend import MACD, SMAIndicator
from ta.volatility import BollingerBands

from .base import AbstractFetcher
from .types import PriceSnapshot

log = logging.getLogger("marketmind.yfinance")


def _classify_macd(macd_line: pd.Series, signal_line: pd.Series) -> str | None:
    """Detect a crossover in the last 3 bars."""
    if len(macd_line) < 3 or len(signal_line) < 3:
        return None
    recent_macd = macd_line.iloc[-3:].values
    recent_sig = signal_line.iloc[-3:].values
    # Was below, now above → bullish
    if recent_macd[-2] <= recent_sig[-2] and recent_macd[-1] > recent_sig[-1]:
        return "bullish_crossover"
    if recent_macd[-2] >= recent_sig[-2] and recent_macd[-1] < recent_sig[-1]:
        return "bearish_crossover"
    return "neutral"


def _classify_bollinger(close: float, upper: float, lower: float) -> str:
    rng = upper - lower
    if rng <= 0:
        return "middle"
    position = (close - lower) / rng
    if position >= 0.8:
        return "upper"
    if position <= 0.2:
        return "lower"
    return "middle"


def _classify_volume_trend(volume: pd.Series) -> str:
    """Compare last 5-day avg volume vs previous 20-day avg."""
    if len(volume) < 25:
        return "neutral"
    recent_avg = volume.tail(5).mean()
    base_avg = volume.tail(25).head(20).mean()
    if base_avg <= 0:
        return "neutral"
    delta = (recent_avg - base_avg) / base_avg
    if delta > 0.15:
        return "increasing"
    if delta < -0.15:
        return "decreasing"
    return "neutral"


class YFinancePriceFetcher(AbstractFetcher[PriceSnapshot]):
    """Pulls 1 year of daily bars and computes technicals."""

    name = "yfinance_price"
    timeout_seconds = 20.0

    async def _fetch_impl(self, ticker: str) -> PriceSnapshot:
        # yfinance is sync — offload to a thread so the orchestrator can parallelize.
        df: pd.DataFrame = await asyncio.to_thread(self._download, ticker)
        if df.empty:
            raise RuntimeError(f"yfinance returned empty frame for {ticker}")
        return self._build_snapshot(ticker, df)

    @staticmethod
    def _download(ticker: str) -> pd.DataFrame:
        return yf.download(
            ticker,
            period="1y",
            interval="1d",
            progress=False,
            auto_adjust=True,
            threads=False,
        )

    @staticmethod
    def _pct(numerator: float, base: float) -> float | None:
        if base == 0 or pd.isna(numerator) or pd.isna(base):
            return None
        return round((numerator - base) / base * 100, 2)

    def _build_snapshot(self, ticker: str, df: pd.DataFrame) -> PriceSnapshot:
        # yfinance returns columns possibly as a MultiIndex when one ticker is passed.
        if isinstance(df.columns, pd.MultiIndex):
            df = df.droplevel(level=1, axis=1)

        close = df["Close"]
        volume = df["Volume"]
        last_close = float(close.iloc[-1])
        prev = float(close.iloc[-2]) if len(close) > 1 else last_close

        sma_20 = SMAIndicator(close=close, window=20).sma_indicator().iloc[-1]
        sma_50 = SMAIndicator(close=close, window=50).sma_indicator().iloc[-1] if len(close) >= 50 else None
        rsi = RSIIndicator(close=close, window=14).rsi().iloc[-1]
        macd = MACD(close=close)
        bb = BollingerBands(close=close, window=20, window_dev=2)

        rsi_value = float(rsi) if pd.notna(rsi) else None
        macd_signal = _classify_macd(macd.macd(), macd.macd_signal())

        upper = bb.bollinger_hband().iloc[-1]
        lower = bb.bollinger_lband().iloc[-1]
        bollinger_position = _classify_bollinger(last_close, float(upper), float(lower)) if pd.notna(upper) and pd.notna(lower) else None

        # Percent changes
        idx_today = len(close) - 1
        # week ≈ 5 trading days back; month ≈ 21
        week_base = float(close.iloc[idx_today - 5]) if idx_today >= 5 else last_close
        month_base = float(close.iloc[idx_today - 21]) if idx_today >= 21 else last_close
        ytd_base = float(close.iloc[0])

        return PriceSnapshot(
            ticker=ticker,
            prev_close=round(last_close, 2),
            day_change_pct=self._pct(last_close, prev),
            week_change_pct=self._pct(last_close, week_base),
            month_change_pct=self._pct(last_close, month_base),
            ytd_change_pct=self._pct(last_close, ytd_base),
            fifty_two_week_high=round(float(close.max()), 2),
            fifty_two_week_low=round(float(close.min()), 2),
            rsi_14=round(rsi_value, 2) if rsi_value is not None else None,
            macd_signal=macd_signal,
            price_vs_20ma="above" if last_close > float(sma_20) else "below" if pd.notna(sma_20) else None,
            price_vs_50ma=(
                ("above" if last_close > float(sma_50) else "below")
                if sma_50 is not None and pd.notna(sma_50)
                else None
            ),
            bollinger_position=bollinger_position,
            volume_trend=_classify_volume_trend(volume),
        )
