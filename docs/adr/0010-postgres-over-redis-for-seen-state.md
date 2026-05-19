# ADR 0010 — Postgres column over Redis for "seen reveal" state

**Status:** Accepted
**Date:** 2026-05-19

## Context

Result-reveal animations need to know *which resolved bets the user has
already seen* so we don't replay the modal every time they reload the home
page. There were three plausible storage options:

1. **`localStorage`** in the browser — keyed by bet ID.
2. **Redis (Upstash)** — fast key-value, already in the project's MVP
   secrets list (currently unused).
3. **Postgres column** on the existing `predictions` row.

The instinct from "we have a Redis client lying around" is to reach for it
— so the question is when Redis is the right tool and when it isn't.

## Decision

Add a nullable `revealed_at timestamptz` column to `predictions`. Mark via
a `mark_predictions_revealed(p_ids uuid[])` `SECURITY DEFINER` RPC that
updates rows owned by `auth.uid()`.

### Why Postgres, not Redis

This is *durable per-user state*, not a cache. The defining traits:

| Property | Cache layer (Redis fits) | Durable state (DB fits) |
| --- | --- | --- |
| Acceptable loss | Yes — fall back to source of truth | No — would corrupt UX |
| Read pattern | Hot, repeated, latency-sensitive | One read per page load |
| Write pattern | High write rate, ephemeral | Once per bet, ever |
| Query needs | Single-key lookup | Joined / aggregated queries |
| Audit value | None | Useful ("when did the user first see this?") |

"Has the user seen this resolution?" is durable state. Redis as the primary
store would mean:
- **Two sources of truth** for prediction state — drift becomes possible the
  moment Redis evicts a key or restarts.
- **No SQL queryability** — we can't answer "how many users have unreviewed
  reveals?" from Redis without scanning every key.
- **Extra failure mode** — Redis down means the reveal flow either fails or
  re-shows already-seen results.
- **No FK semantics** — the seen-state is conceptually "a fact about a
  prediction row"; it belongs on the row.

The column adds 8 bytes of nullable storage per prediction. Even at 10M
predictions that's 80 MB — cheaper than the operational overhead of a
parallel store.

### What stays the same

- Redis is still on the roadmap, but for the *right* job: **rate limiting**
  (Plan §Security L855). Per-IP and per-user request counters with TTL are
  the canonical Redis use case.
- Session state (e.g. "user dismissed this banner for this session") could
  also reasonably live in Redis later — that's ephemeral, low-value-on-loss.

## Alternatives considered

- **`localStorage`** — simplest, no migration. Rejected because cross-device
  consistency matters: a user betting on desktop and then opening the app on
  mobile should not re-see the reveal. For a portfolio piece, the consistency
  story is worth one column.

- **Redis hash per user** (`reveals:{user_id}` → `{prediction_id: 1}`) —
  works mechanically. Rejected for the reasons above; primary store should
  be Postgres.

- **Separate `prediction_reveals` table** — `(user_id, prediction_id,
  revealed_at)`. Cleaner in theory but adds a join + duplicates the
  user/prediction relationship that already exists. The column on the
  existing row is simpler.

## Consequences

**Easier:**
- One source of truth: a resolved prediction either has `revealed_at` or it
  doesn't. No reconciliation between Redis + Postgres.
- Cheap partial index `(user_id) WHERE resolved AND revealed_at IS NULL`
  lets us answer "what does this user need to see?" in O(log n) regardless
  of total history size.
- Migration is straightforward — `add column if not exists`, no data
  backfill needed (NULL means "not seen yet", which is the correct default
  for all historical rows).

**Harder:**
- Schema migration required to ship the feature (vs `localStorage` which
  needs none). Mitigated: we already have the migration workflow and an
  established cadence for shipping migrations.
- Future "session-level dismissed" semantics would still need a different
  store (cookies, localStorage, or Redis). That's fine — different
  durability requirements, different store.

## Tradeoffs accepted

- Schema migration in exchange for a single source of truth and
  cross-device consistency.
- 8 bytes per prediction row in exchange for SQL queryability and audit
  trail.

## Future evolution

If the reveals feature grows into a "notification inbox" pattern (e.g.
"unread badge earnings", "unread mentions") we'd consolidate into a
proper `notifications` table with `read_at`. This ADR's reasoning still
applies — durable user state in Postgres, Redis for cache/rate-limit only.
