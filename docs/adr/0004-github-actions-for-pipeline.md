# ADR 0004 — GitHub Actions over a Python service for the data pipeline

**Status:** Accepted
**Date:** 2026-05-18

## Context

The insights pipeline ingests data from 10+ sources, runs NLP processing (FinBERT sentiment + Llama-3 summarization), aggregates signals, and writes to the database. The natural Python-developer instinct is to stand this up as a FastAPI service on Fly.io or Modal.

However, the pipeline has a critical property: it runs **once a day for ~15 minutes**, not continuously. The resolution job runs once at 4:15 PM ET. That's it.

An always-on service for a daily batch job is operational waste — you're paying for 24-hour uptime for 15 minutes of work.

## Decision

Use **GitHub Actions** to run the Python pipeline on a cron schedule. Two workflows:

- `.github/workflows/fetch-insights.yml` — cron `0 0 * * 2-6` (8 PM ET, Mon-Fri night)
- `.github/workflows/resolve-predictions.yml` — cron `15 20 * * 1-5` (4:15 PM ET, Mon-Fri)

Both are also triggerable via `workflow_dispatch` for manual runs and testing.

## Alternatives considered

- **FastAPI on Fly.io**: an always-on Python service. Adds $5-10/mo, separate deployment pipeline, separate secrets, separate logs. Justified only if we need a long-running service (we don't).
- **Modal.com**: serverless Python with native cron support. Genuinely good option — would also work. Chose GitHub Actions because secrets and version control are already in GitHub.
- **AWS Lambda + EventBridge**: 15-minute execution limit means chunking the pipeline. More complexity for no gain.
- **Vercel Cron + serverless functions**: 10-second timeout (Hobby) makes Python NLP infeasible. Pro tier still has limits.
- **Supabase Edge Functions**: Deno runtime — would require porting FinBERT to JS (no), or calling HF inference from TS. Doable but loses Python's NLP ecosystem.

## Consequences

**Easier:**
- Zero always-on infrastructure to monitor
- Pipeline runs are version-controlled (workflow YAML in repo)
- Secrets managed in GitHub (same place as the code)
- Logs are visible in the GitHub UI per run
- Free up to 2,000 minutes/month — we use maybe 600

**Harder:**
- GitHub Actions cron has minute-level granularity but is best-effort (can lag by 5-15 min during peak load)
- 6-hour max job timeout — fine for us, but worth knowing
- Iteration loop is slower than local: push → wait for runner → check logs (mitigated by extensive local testing first)

**Tradeoffs accepted:**
- Cron timing not exact (acceptable — we have a 45-min window between resolution and "results ready" notification)
- Pipeline can't easily expose an HTTP endpoint (mitigated by direct DB writes — pipeline → Supabase, Next.js reads from there)
