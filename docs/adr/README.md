# Architecture Decision Records

Lightweight log of architectural decisions made on MarketMind. Each ADR is a single-page document covering: context, decision, alternatives considered, consequences.

Format follows [Michael Nygard's ADR pattern](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

---

## Index

| # | Title | Status |
|---|-------|--------|
| [0001](0001-documentation-as-rule.md) | Documentation discipline as a project rule | Accepted |
| [0002](0002-supabase-over-neon.md) | Supabase over Neon for the database | Accepted |
| [0003](0003-no-aggregate-verdict.md) | No UP/DOWN verdict — show signals only | Superseded by 0007 |
| [0004](0004-github-actions-for-pipeline.md) | GitHub Actions over a Python service for the pipeline | Accepted |
| [0005](0005-massive-as-primary-data-source.md) | Massive (formerly Polygon.io) as primary data source | Accepted |
| [0006](0006-migrations-via-github-actions.md) | Migrations via GitHub Actions | Accepted |
| [0007](0007-verdict-with-track-record.md) | Verdict with published track record (supersedes 0003) | Accepted |
| [0008](0008-bet-window-into-market-hours.md) | Bet window extends into market hours (locks 1 PM ET) | Accepted |
| [0009](0009-bet-placement-atomicity.md) | Bet placement runs as a Postgres RPC (atomic + concurrency-safe) | Accepted |
| [0010](0010-postgres-over-redis-for-seen-state.md) | Postgres column over Redis for "seen reveal" state | Accepted |
| [0011](0011-signal-quality-p0-fixes.md) | Signal-quality P0 fixes (resolution window, PIT filter, weight renormalization) | Accepted |

---

## When to write a new ADR

A new ADR is required when:
- A design choice could reasonably have gone another way
- Future-you (or a reader) might wonder "why did they do this?"
- A constraint or tradeoff was accepted that wouldn't be obvious from reading the code

Examples that warrant an ADR:
- Picking one library/service over another
- Choosing a data model that has user-visible implications
- Skipping a "default" engineering practice for a reason
- Adopting a non-obvious pattern (e.g., RLS at DB layer vs. app layer)

Examples that do *not* warrant an ADR:
- "I picked TypeScript" (obvious default for a Next.js project)
- "I named the variable x" (style, not architecture)
- "I used a `for` loop" (implementation detail)

## How to add one

1. Copy the template below to `00NN-short-kebab-title.md`
2. Fill in each section
3. Add to the index above
4. Reference from relevant code or docs if applicable

## Template

```markdown
# ADR NNNN — Title (verb noun phrase, e.g., "Use X over Y for Z")

**Status:** Proposed | Accepted | Superseded by [NNNN]
**Date:** YYYY-MM-DD

## Context
What's the situation? What forces are in play (technical, business, team)?

## Decision
What did we decide? Be specific and active-voice: "We will use X."

## Alternatives considered
- **A**: why not chosen
- **B**: why not chosen

## Consequences
What becomes easier? What becomes harder? What did we accept as a tradeoff?
```
