# Changelog

All notable changes to MarketMind, in reverse chronological order.

Format: `YYYY-MM-DD · feature-name — one-line summary`

For deeper context on any decision, see corresponding ADR in [docs/adr/](docs/adr/).

---

## 2026-05-18

- **project-scaffold** — Initialized Next.js 16.2.6 + React 19 + Tailwind v4 + TypeScript strict via `create-next-app`. Source dir is `src/`, App Router enabled, import alias `@/*`.
- **dev-tooling** — Configured TypeScript strict mode with `noUncheckedIndexedAccess`, `noFallthroughCasesInSwitch`, `noImplicitOverride`. Added Prettier (with `prettier-plugin-tailwindcss`), Vitest + Testing Library. npm scripts: `lint`, `format`, `format:check`, `test`, `test:run`, `typecheck`.
- **shadcn-init** — Initialized shadcn/ui with neutral base color, CSS variables enabled, base components library. Default Button component generated as a smoke test.
- **first-test** — `cn()` utility smoke test added under `src/lib/__tests__/utils.test.ts`. Vitest green.

Note: We landed on Next.js **16** (not 15 as originally planned) because `create-next-app@latest` defaults to it. Next.js 16 + Tailwind v4 are both recent — when writing route or styling patterns, consult `node_modules/next/dist/docs/` and the Tailwind v4 docs rather than relying on training-data knowledge. ADR not written because this wasn't a deliberate choice — just the install-time default.

---
