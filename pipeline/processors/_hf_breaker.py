"""
Shared circuit-breaker for HuggingFace LLM inference calls.

Why
---
Both LlamaSummarizer and VerdictReasoner go to HF's Inference Providers
router. When that backend is rate-limiting (429s) or its routed
providers are timing out (cold starts on free tier), we observed runs
that spent 30-90s timing out for *every* call on *every* remaining
stock — bursting the workflow's 45-min budget for no useful output.

This module tracks consecutive failures across both callers and trips
when the threshold is hit. Once tripped, subsequent calls short-circuit
to the caller's fallback path immediately, so a broken backend stops
costing us minutes per call.

The breaker is self-healing: a successful call resets the counter, so
a transient HF wobble doesn't permanently disable the path within a
single run. State is process-local — each pipeline run starts fresh.
"""
from __future__ import annotations

import logging
import threading

log = logging.getLogger("marketmind.hf_breaker")

# Trip after this many consecutive failures. Picked low enough that one
# bad cold-start chain (~3 timeouts × ~90s = 4.5 min) doesn't kill the
# breaker, but high enough that we don't trip on noise.
TRIP_THRESHOLD = 5

_lock = threading.Lock()
_state = {
    "consecutive_failures": 0,
    "tripped": False,
    "skipped": 0,  # count of short-circuited calls — useful in logs/summary
}


def should_skip() -> bool:
    """Cheap read — call before doing the HF round-trip."""
    return _state["tripped"]


def record_failure(reason: str) -> None:
    with _lock:
        _state["consecutive_failures"] += 1
        if (
            _state["consecutive_failures"] >= TRIP_THRESHOLD
            and not _state["tripped"]
        ):
            _state["tripped"] = True
            log.warning(
                "hf_breaker_tripped reason=%s consecutive_failures=%s — "
                "remaining HF calls in this run will short-circuit to fallback",
                reason,
                _state["consecutive_failures"],
            )


def record_success() -> None:
    with _lock:
        if _state["consecutive_failures"] > 0:
            log.info(
                "hf_breaker_reset prior_failures=%s",
                _state["consecutive_failures"],
            )
        _state["consecutive_failures"] = 0
        _state["tripped"] = False


def record_skip() -> None:
    """Bump the skipped-calls counter for telemetry."""
    with _lock:
        _state["skipped"] += 1


def snapshot() -> dict[str, object]:
    """Read-only view of breaker state — for end-of-run logging."""
    with _lock:
        return dict(_state)
