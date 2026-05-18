# ADR 0002 — Supabase over Neon for the database

**Status:** Accepted
**Date:** 2026-05-18

## Context

I already use Neon (serverless Postgres) on my personal portfolio website. Consistency would say to use Neon here too. However, MarketMind has fundamentally different requirements than the portfolio:

- Multi-tenant user data (bets, credits, predictions) where users must never see each other's data
- Auth integration tied to database queries (RLS using `auth.uid()`)
- Small Day-1 time budget (~10 hours for foundation work)
- TypeScript-end-to-end with generated DB types

These needs push toward an opinionated, integrated platform rather than raw Postgres + composed services.

## Decision

Use **Supabase** for MarketMind's database, auth, and RLS.

The portfolio site stays on Neon — different use cases, different right answers.

## Alternatives considered

- **Neon + Clerk + Auth.js + manual RLS**: more flexible, best-of-breed at each layer. But: requires 3-4 extra hours of plumbing on Day 1, app-layer RLS is one missing `WHERE user_id = ?` away from a data leak, and Clerk adds $25/mo at production scale.
- **Neon + raw SQL RLS**: would require setting up PostgREST or building the RLS layer manually. Same security risks as above.
- **Firebase**: NoSQL is the wrong fit for relational financial data with audit requirements.
- **PlanetScale**: MySQL doesn't support RLS the way Postgres does. Would need to build isolation at the app layer.

## Consequences

**Easier:**
- Auth + DB share the same JWT trust boundary — RLS policies use `auth.uid()` directly
- TypeScript types auto-generated from schema via `supabase gen types`
- Row-Level Security is declarative, database-enforced — no app-layer leak risk
- Built-in Postgres extensions (pgvector, pg_cron) available if needed later

**Harder:**
- Two database vendors across portfolio + MarketMind
- Supabase is more opinionated than raw Postgres — less escape hatch
- Free tier limits (500 MB DB, 50K MAU) will require Pro ($25) eventually

**Tradeoffs accepted:**
- Vendor opinion over flexibility — chosen because the opinions are good for this product shape
- "Using two stacks across projects" is fine when each is right for its job (this is itself a case-study point)
