# Changelog

All notable changes to MarketMind, in reverse chronological order.

Format: `YYYY-MM-DD · feature-name — one-line summary`

For deeper context on any decision, see corresponding ADR in [docs/adr/](docs/adr/).

---

## 2026-05-18

- **ci-migrations** — Enterprise-grade migration pipeline. Two workflows: `validate-migrations.yml` runs on PR (spins up local Supabase, applies all migrations, verifies seed). `apply-migrations.yml` is manual-only via `workflow_dispatch`, requires typing literal `migrate` confirmation, runs dry-run before apply, verifies post-state. Added `supabase/config.toml` for CLI + ADR 0006 documenting the design. Docs updated in SETUP + RUNBOOK.
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
