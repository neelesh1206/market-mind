"""Sentry init + structured logging helpers."""
from __future__ import annotations

import logging
import sys
from typing import Any

import sentry_sdk


def init_sentry(dsn: str | None) -> None:
    if not dsn:
        return
    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=0.0,         # pipeline isn't latency-sensitive
        send_default_pii=False,
        environment="pipeline",
    )


def init_logging(level: str = "INFO") -> logging.Logger:
    log = logging.getLogger("marketmind")
    if log.handlers:
        return log
    handler = logging.StreamHandler(sys.stdout)
    fmt = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    handler.setFormatter(fmt)
    log.addHandler(handler)
    log.setLevel(level)
    return log


def capture_error(exc: BaseException, **context: Any) -> None:
    """Send to Sentry with optional context. Safe if Sentry isn't initialized."""
    if context:
        with sentry_sdk.push_scope() as scope:
            for k, v in context.items():
                scope.set_tag(k, str(v)[:200])
            sentry_sdk.capture_exception(exc)
    else:
        sentry_sdk.capture_exception(exc)
