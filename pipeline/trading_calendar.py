"""NYSE trading-day helpers using pandas-market-calendars."""
from __future__ import annotations

from datetime import date, datetime, timedelta
from functools import lru_cache

import pandas as pd
import pandas_market_calendars as mcal


@lru_cache(maxsize=1)
def _nyse():
    return mcal.get_calendar("NYSE")


def is_trading_day(d: date) -> bool:
    schedule = _nyse().schedule(start_date=d, end_date=d)
    return not schedule.empty


def next_trading_day(after: date | None = None) -> date:
    """Next trading day strictly after `after` (default: today)."""
    base = after or date.today()
    cursor = base + timedelta(days=1)
    while not is_trading_day(cursor):
        cursor += timedelta(days=1)
    return cursor


def previous_trading_day(before: date | None = None) -> date:
    base = before or date.today()
    cursor = base - timedelta(days=1)
    while not is_trading_day(cursor):
        cursor -= timedelta(days=1)
    return cursor


def trading_days_between(start: date, end: date) -> list[date]:
    """Inclusive list of NYSE trading days between two dates."""
    schedule = _nyse().schedule(start_date=start, end_date=end)
    return [d.date() for d in schedule.index]
