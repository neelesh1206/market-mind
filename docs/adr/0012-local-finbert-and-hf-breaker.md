# ADR 0012 — Local FinBERT + circuit breaker for the LLM-side HF calls

**Status:** Accepted
**Date:** 2026-05-19

## Context

A production-mode `fetch_insights` run on 2026-05-19 timed out at the
workflow's 45-minute `timeout-minutes` cap with about half the 50-stock
universe still unprocessed. The log was dominated by two HuggingFace
failure modes:

- **FinBERT (sentiment)** — `ReadTimeoutError` on the serverless
  Inference API. FinBERT is a "cold" model on free tier; the first call
  per region takes 10-30s while the model loads. With ~10 articles per
  stock × 50 stocks = ~500 inference calls, even a small failure rate
  burned minutes per stock retrying through the 90s client timeout.
- **Llama / Mistral (summarizer + verdict reasoner)** — `429 Too Many
  Requests` from `router.huggingface.co`. HF's new Inference Providers
  architecture routes our calls to a third-party provider (Together,
  Fireworks, etc.); each provider has its own burst-rate cap that's
  shared across all HF users, so even an HF Pro account doesn't avoid
  the throttling once you fire ~150 LLM calls (50 stocks × 3 articles
  + 50 reasonings) back-to-back.

Both failures are *backend* problems we can't fix from outside. The
fix has to be on our side: stop depending on HF for the hot path.

## Decision

Two changes ship together. They are independent — either one is
useful on its own — but together they make the pipeline complete
reliably within a sane time budget on free infrastructure.

### 1. FinBERT now runs locally on the pipeline runner

`pipeline/processors/sentiment.py` is rewritten to load the FinBERT
model into memory via `transformers` + `torch` (CPU-only build) and
score articles in a single batched forward pass. No network calls
for sentiment scoring at all.

- The constructor's `api_key` parameter is preserved for orchestrator
  compatibility but is no longer used by the sentiment path.
- The async interface is preserved — `score(articles)` still awaits,
  the CPU work runs via `asyncio.to_thread` so the orchestrator's
  parallel-fetcher gather() stays responsive.
- Model + tokenizer are loaded lazily on first call. On a fresh
  GH Actions runner the first call takes ~3 min to download the
  440 MB model; subsequent calls are sub-second per article.

The GitHub Actions workflow gets two supporting changes:

- `pip install --extra-index-url https://download.pytorch.org/whl/cpu …`
  pulls the CPU-only torch wheel (~200 MB) instead of the default
  CUDA-bundled torch (~800 MB). The CUDA wheel is wasted on a CPU
  runner anyway.
- A new `actions/cache@v4` step caches `~/.cache/huggingface` keyed
  on a hash of `pipeline/processors/sentiment.py` + `requirements.txt`,
  so once the model has been downloaded once it persists across runs.
  A model bump invalidates the cache automatically.

The workflow's `timeout-minutes` is bumped from 45 → 60 to leave
headroom for the one-time cold cache fill on first deployment.

### 2. Shared HF circuit breaker for summarizer + verdict reasoner

Llama / Mistral remain on HF's network API — these are 7B-parameter
models, too big to ship to a GH Actions runner. Instead, a shared
breaker in `pipeline/processors/_hf_breaker.py` short-circuits HF
calls once `TRIP_THRESHOLD` (5) consecutive failures accumulate
across both callers in a single run.

- `should_skip()` is read before any HF round-trip.
- `record_failure(reason)` is called from both summarizer and
  reasoner exception handlers (HTTP errors, timeouts, anything).
- `record_success()` resets the counter — the breaker is
  self-healing within a run if HF recovers.
- `record_skip()` increments a counter for end-of-run telemetry.

When tripped, the summarizer simply doesn't write `tldr` / `summary`
fields for that article (they're already nullable in
`insight_articles`), and the verdict reasoner falls back to
`_fallback_reasoning` — the rule-based template that names the top
two contributing buckets in plain English. Numerical signals and
the verdict direction itself are never blocked by an HF outage.

The final `pipeline_done` log line now includes
`hf_tripped=true/false hf_skipped=N` so post-run inspection is
one-line easy.

## Alternatives considered

- **Pay for a dedicated HF Inference Endpoint for FinBERT** (~$45/mo).
  Sub-second warm latency, no shared rate limits, no model download.
  Rejected because local FinBERT achieves the same outcome for free,
  and the GH Actions runner already has the spare CPU and memory.
  Re-evaluate if we ever ship FinBERT scoring on the live request
  path (instead of nightly batch) where latency matters more.

- **Keep FinBERT on HF but throttle the pipeline to stay under burst
  limits.** Cheapest code change. Rejected because the *cold-start*
  tax is independent of throttling — even a single slow call per
  stock still adds up to >30 minutes across the universe, and
  throttling makes the wall-clock total worse, not better.

- **Skip FinBERT entirely; use keyword-based sentiment as a fallback.**
  Could ship today. Rejected because financial language is too
  context-dependent — "raised guidance" is bullish, "raised concerns"
  is bearish, and naive keyword matching can't tell the difference.
  Sentiment is a meaningful 25% of the verdict weight; degrading it
  to keyword matching meaningfully degrades the call.

- **Move the LLM steps off the critical path entirely** (insight +
  verdict insert lands first, summaries/reasoning fill in via a
  follow-up job). Better architecture but requires a status column
  on `insight_articles` and a second cron job. Out of scope for this
  ADR; reconsider if the breaker isn't enough.

## Consequences

**Easier:**
- Sentiment scoring is now deterministic in latency — no 30s
  cold-start lottery on every cold run.
- Free tier (and even Pro tier) HF accounts are no longer the
  bottleneck for sentiment; the only HF dependency left is the
  summarizer + reasoner, which now have a breaker to bound their
  failure cost.
- Pipeline can run reliably within a 60-minute window — previously
  was hitting the 45-min wall on free tier.
- Local execution means we can iterate on the sentiment model
  (e.g. swap FinBERT for a fine-tuned variant) without coordinating
  with HF's hosted offering.

**Harder:**
- The pipeline's dependency footprint grows by ~250 MB of torch
  + transformers. GH Actions runner has plenty of headroom (14 GB
  disk, 7 GB RAM), but local development now needs a venv with
  enough disk; updated SETUP doc note included.
- A first-deployment run after the model cache key changes pays
  the ~3 min download tax. Acceptable infrequent cost; the cache
  is keyed on file hashes that change rarely.
- Two paths now exist for "what to do when an HF call fails" — the
  breaker short-circuits one way, the per-call fallback handles the
  other. Both are tested by the breaker's tripping itself; the
  combined behavior is what we want, but reviewers should keep both
  paths in mind when changing the LLM code.

**Tradeoffs accepted:**
- Sentiment is no longer accessible from environments that can't
  install torch (e.g. lightweight CI containers). We accept the
  install cost because the only environment that *runs* sentiment
  is the pipeline workflow, where torch fits comfortably.
- The breaker is process-local — each pipeline run starts fresh
  with a clean breaker. A persistent breaker (Redis-backed across
  runs) would be more principled but adds a dependency for a
  feature that's only useful during an active outage. Reconsider
  if we see runs land mid-outage where round-N would benefit
  from round-(N−1)'s pessimism.

## Notes

The motivating run is in the conversation log; ADR 0011's analyst
review identified the broader signal-quality work, of which this
ADR fixes the operational reliability piece. The remaining HF
network dependency (summarizer + reasoner) is contained but not
eliminated — a future ADR may move those off the critical path
entirely if the breaker proves insufficient under sustained outages.
