# ADR 0006 — Migrations via GitHub Actions (CI validate + gated prod apply)

**Status:** Accepted
**Date:** 2026-05-18

## Context

Database migrations are the highest-risk operation on the codebase: a bad migration can drop data, corrupt referential integrity, or silently expose data by relaxing RLS policies. Yet manual processes (SQL Editor copy-paste, direct `psql` from a developer's machine) are common and easy.

For MarketMind, the goals are:

1. **Reproducibility** — the same migration must apply identically to local dev, ephemeral CI, and production
2. **Audit trail** — every production schema change must be tied to a commit and a workflow run
3. **Pre-merge validation** — bad SQL should fail CI on the PR, not in production
4. **Friction at the dangerous step** — production schema changes should require an explicit, confirmed action; never an automatic side-effect of a merge

Doing this on Day 1 — before any production schema exists — is the lowest-cost moment to set up the right pattern. Adding it later means migrating from a tracked state ("we manually applied X commits ago").

## Decision

Adopt a two-workflow split:

### 1. `validate-migrations.yml` — automatic on PRs
- Triggers when `supabase/migrations/**` or `supabase/seed.sql` change
- Starts a full local Supabase stack (`supabase start`) — provides the `auth.users` schema our migration references
- Runs `supabase db reset` to apply all migrations from scratch against the local stack
- Fails the PR if any migration errors
- Runs `supabase db lint` to catch anti-patterns

### 2. `apply-migrations.yml` — manual `workflow_dispatch` only
- Never triggers automatically — not on merge, not on schedule
- Requires a typed confirmation input (literal string "migrate") to proceed
- Runs `supabase db push --dry-run` first; logs the planned changes
- Applies via `supabase db push` only after dry-run succeeds
- Operates on the single production Supabase project (`marketmind-prod`)
- Logs are retained for audit

### Secrets in GitHub Actions
- `SUPABASE_ACCESS_TOKEN` — personal access token, gives the CLI permission to manage projects
- `SUPABASE_DB_PASSWORD` — the prod DB password set at project creation
- `SUPABASE_PROJECT_REF` — the project ID (currently `cqbdjiphrrdwmbrqoeeh`)

### Local dev
- Developers use `supabase start` (Docker Postgres) for fast iteration
- Migrations are written as files in `supabase/migrations/` and tested locally before opening a PR

## Alternatives considered

- **Manual via SQL Editor**: faster on Day 1, but degrades fast. No audit trail beyond commit history. Schema drift is invisible until something breaks. Rejected.
- **Automatic apply on merge to `main`**: removes the friction that exists for a reason. A bad migration becomes a production incident with no human review checkpoint. Rejected.
- **Prisma Migrate / Drizzle Kit**: would require porting the schema out of raw SQL and adopting an ORM. Adds vendor surface for marginal benefit on a 1-person project. Rejected — Supabase's first-class CLI tooling is sufficient.
- **Supabase Branching**: Pro tier feature ($25/mo). Genuine staging environment per PR. Reconsider when the project graduates to Pro or when the team grows beyond solo.

## Consequences

**Easier:**
- Every prod migration is tied to a workflow run with logs
- PR validation catches errors before merge
- New developers don't need DB credentials to validate their migrations
- Schema is reproducible from a clean checkout via `supabase db reset` locally

**Harder:**
- Initial setup adds ~45 min and a Supabase Personal Access Token to manage
- CI is slower (1-2 min for `supabase start`)
- The first migration must go through the workflow — no "just apply it via SQL Editor for now" shortcut

**Tradeoffs accepted:**
- Slower CI in exchange for catching mistakes before merge — net win
- Friction on prod apply traded for catastrophe avoidance — clearly worth it
- Vendor lock to Supabase CLI (already locked to Supabase per [ADR 0002](0002-supabase-over-neon.md))

## Notes

The first production migration (the initial schema for MarketMind) is applied via this workflow — there is no "manual first apply, automated thereafter" exception. This forces us to validate the pipeline end-to-end before any user data exists.
