"""
Abstract base fetcher with retry, timeout, and circuit-breaker semantics.

Every concrete fetcher subclasses this. The orchestrator only calls .fetch() —
all resilience patterns (retry/backoff, circuit breaker, observability) live here.
"""
from __future__ import annotations

import asyncio
import logging
import time
from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Generic, TypeVar

log = logging.getLogger("marketmind.fetcher")

T = TypeVar("T")


@dataclass
class FetchResult(Generic[T]):
    """Uniform result envelope for every fetcher call."""

    source: str
    status: str                         # 'success' | 'failed' | 'skipped'
    data: T | None = None
    latency_ms: int | None = None
    error: str | None = None
    raw: dict[str, Any] | None = None

    @classmethod
    def success(cls, source: str, data: T, latency_ms: int, raw: dict | None = None) -> FetchResult[T]:
        return cls(source=source, status="success", data=data, latency_ms=latency_ms, raw=raw)

    @classmethod
    def failed(cls, source: str, error: str, latency_ms: int | None = None) -> FetchResult[T]:
        return cls(source=source, status="failed", error=error, latency_ms=latency_ms)

    @classmethod
    def skipped(cls, source: str, reason: str) -> FetchResult[T]:
        return cls(source=source, status="skipped", error=reason)


class RateLimitError(Exception):
    """Raised by fetchers when the upstream signals rate limiting."""


class CircuitOpenError(Exception):
    """Raised when the circuit breaker is open for a source."""


@dataclass
class CircuitBreaker:
    """Per-source counter that opens after N consecutive failures."""

    threshold: int = 3
    consecutive_failures: int = 0
    open_until: float = 0.0
    open_duration_seconds: float = 60 * 60   # 1 hour cooldown

    def record_success(self) -> None:
        self.consecutive_failures = 0

    def record_failure(self) -> None:
        self.consecutive_failures += 1
        if self.consecutive_failures >= self.threshold:
            self.open_until = time.time() + self.open_duration_seconds

    def is_open(self) -> bool:
        if self.open_until == 0:
            return False
        if time.time() < self.open_until:
            return True
        # cooldown elapsed — reset
        self.open_until = 0
        self.consecutive_failures = 0
        return False


class AbstractFetcher(ABC, Generic[T]):
    """
    Subclass and implement `_fetch_impl`. The orchestrator calls `fetch()`,
    which handles retries, circuit breaking, latency timing, and error wrapping.
    """

    name: str = "abstract"
    timeout_seconds: float = 10.0
    max_retries: int = 3
    backoff_base: float = 1.5

    def __init__(self) -> None:
        self._breaker = CircuitBreaker()

    @abstractmethod
    async def _fetch_impl(self, ticker: str) -> T:
        """The actual fetch — raise on failure, return data on success."""

    async def fetch(self, ticker: str) -> FetchResult[T]:
        if self._breaker.is_open():
            log.warning("circuit_open source=%s ticker=%s", self.name, ticker)
            return FetchResult.skipped(self.name, "circuit_open")

        last_error: BaseException | None = None
        start = time.time()

        for attempt in range(self.max_retries):
            try:
                data = await asyncio.wait_for(
                    self._fetch_impl(ticker),
                    timeout=self.timeout_seconds,
                )
                latency_ms = int((time.time() - start) * 1000)
                self._breaker.record_success()
                return FetchResult.success(self.name, data, latency_ms)
            except RateLimitError as e:
                last_error = e
                wait = self.backoff_base**attempt
                log.warning(
                    "rate_limited source=%s ticker=%s attempt=%s backoff=%.2fs",
                    self.name, ticker, attempt + 1, wait,
                )
                await asyncio.sleep(wait)
            except asyncio.TimeoutError as e:
                last_error = e
                log.warning("timeout source=%s ticker=%s attempt=%s", self.name, ticker, attempt + 1)
            except Exception as e:  # noqa: BLE001 — final fallback path is intentional
                last_error = e
                log.warning(
                    "error source=%s ticker=%s attempt=%s err=%s",
                    self.name, ticker, attempt + 1, e,
                )

        latency_ms = int((time.time() - start) * 1000)
        self._breaker.record_failure()
        err_repr = repr(last_error) if last_error else "unknown"
        return FetchResult.failed(self.name, err_repr, latency_ms)
