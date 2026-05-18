# Changelog

All notable changes to MarketMind, in reverse chronological order.

Format: `YYYY-MM-DD · feature-name — one-line summary`

For deeper context on any decision, see corresponding ADR in [docs/adr/](docs/adr/).

---

## 2026-05-18

- **pipeline-day1-runnable** — Wired the full insights pipeline end-to-end. New: `fetchers/finnhub.py` (analyst aggregate + earnings calendar), `fetchers/sec_edgar.py` (Form 4 / 8-K detection with on-demand CIK lookup + 10-req/sec polite UA), `fetchers/fred.py` (VIX macro snapshot, one call shared across all stocks), `processors/sentiment.py` (FinBERT via HF Inference API with recency-weighted aggregation + cross-source agreement counter), `processors/aggregator.py` (the 4 bucket scores per IMPLEMENTATION_PLAN formulas; no aggregate verdict per ADR 0003), and `fetch_insights.py` (the orchestrator — parallel per-stock fetch, FinBERT scoring, insight upsert, top-3 article insert, per-source audit, `pipeline_runs` lifecycle). CLI supports `--ticker NVDA --dry-run` for one-shot smoke tests. Sources gracefully degrade — missing API keys just skip that fetcher.
- **ui-polish-v1** — Fixed the circular `--font-sans` CSS variable in `globals.css` that caused the entire app to render in serif default. Default theme is now dark (better fit for a trading app). Login page rebuilt around a glassmorphism card with proper hero, branded MarketMind logo (gradient + line-chart icon), and a `GoogleSignInButton` matching Google's brand guidelines (white surface, multicolor G logo SVG, "Sign in with Google" copy). Home page now has a sticky header with credit pill, user avatar initial, stat grid (credits + streak + predictions today), and footer disclaimer. Metadata updated from "Create Next App" to proper MarketMind tags.
- **actions-node24** — Bumped `actions/checkout@v4 → @v6` and `supabase/setup-cli@v1 → @v2` in both migration workflows. Clears the Node.js 20 deprecation warning ahead of GitHub's 2026-06-02 cutover; both new major versions run on Node 24.
- **seed-as-migration** — Converted `supabase/seed.sql` into migration `20260518000002_seed_stocks.sql` (idempotent via `ON CONFLICT DO NOTHING`). Removes the failure-prone raw-psql seed step from the apply-migrations workflow; now the whole chain runs via `supabase db push`. Local dev still picks it up automatically through `supabase db reset`.
- **ci-migrations** — Enterprise-grade migration pipeline. Two workflows: `validate-migrations.yml` runs on PR (spins up local Supabase, applies all migrations from scratch). `apply-migrations.yml` is manual-only via `workflow_dispatch`, requires typing literal `migrate` confirmation, runs dry-run before apply. Added `supabase/config.toml` for CLI + ADR 0006 documenting the design. Docs updated in SETUP + RUNBOOK.
- **auth-flow** — Supabase auth integration via `@supabase/ssr`. Browser + server clients (`src/lib/supabase/{client,server}.ts`), session-refresh proxy at `src/proxy.ts` (Next.js 16 file convention — formerly `middleware.ts`), OAuth callback at `src/app/auth/callback/route.ts`, Google Sign-In login page at `/login` with Suspense-wrapped form, auth-gated home at `/` showing email + credit balance + streak. Sign-out button as a client component.
- **next16-pipeline-pattern** — Discovered Next.js 16 renamed `middleware.ts` → `proxy.ts` (the function is `proxy()` not `middleware()`). Documented in code comments; no ADR since it's a forced convention.
- **schema-applied** *(pending user confirmation)* — Initial migration + seed expected to be applied to `marketmind-prod` Supabase project via SQL Editor.
- **deps-supabase** — Installed `@supabase/supabase-js`, `@supabase/ssr`.
- **project-scaffold** — Initialized Next.js 16.2.6 + React 19 + Tailwind v4 + TypeScript strict via `create-next-app`. Source dir is `src/`, App Router enabled, import alias `@/*`.
- **dev-tooling** — Configured TypeScript strict mode with `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `noImplicitOverride`. Added Prettier (with `prettier-plugin-tailwindcss`), Vitest + Testing Library. npm scripts: `lint`, `format`, `format:check`, `test`, `test:run`, `typecheck`.
- **shadcn-init** — Initialized shadcn/ui with neutral base color, CSS variables enabled, base components library. Default Button component generated as a smoke test.
- **first-test** — `cn()` utility smoke test added under `src/lib/__tests__/utils.test.ts`. Vitest green.

Note: We landed on Next.js **16** (not 15 as originally planned) because `create-next-app@latest` defaults to it. Next.js 16 + Tailwind v4 are both recent — when writing route or styling patterns, consult `node_modules/next/dist/docs/` and the Tailwind v4 docs rather than relying on training-data knowledge. ADR not written because this wasn't a deliberate choice — just the install-time default.

---
