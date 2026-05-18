# ADR 0001 — Documentation discipline as a project rule

**Status:** Accepted
**Date:** 2026-05-18

## Context

MarketMind is being built as a portfolio project. Beyond shipping the app, the project itself is the artifact — the engineering practices, design choices, and tradeoffs are the story being told to future employers via the linked case study on the personal website.

Without enforced documentation discipline, the project would ship as a working app with no narrative — a missed opportunity. Documentation written *after* shipping tends to be vague, incomplete, and reverse-engineered from code. Documentation written *as you go* captures real reasoning at the moment of decision.

## Decision

Every feature shipped MUST update:
1. **CHANGELOG.md** — one-line entry with date and feature name
2. **README.md** — if setup, env vars, or user-facing capability changed
3. **docs/adr/** — if a non-obvious design choice was made (new ADR file)

Every manual step encountered MUST be documented in:
- **docs/SETUP.md** for one-time setup steps
- **docs/RUNBOOK.md** for recurring operations or incident playbooks

A feature is not "done" until its documentation is updated.

## Alternatives considered

- **Document everything at the end**: produces lower-quality docs because reasoning fades, and creates a daunting "documentation week" that often gets cut from scope.
- **Auto-generate from code comments**: tells *what* the code does, not *why* it was designed that way. ADRs and case studies require human-written narrative.
- **Trust the git history**: commit messages decay in usefulness fast. Future-you will not git-blame to understand why a design choice was made.

## Consequences

**Easier:**
- Future maintenance — every non-obvious choice has a documented reason
- Case study writing — the narrative is already captured ADR by ADR
- Onboarding (even just future-self after a break)
- Portfolio integration — docs are publishable as-is, no retrofitting

**Harder:**
- Every feature takes slightly longer (5-15 min for docs)
- Requires discipline not to skip the doc step "just this once"

**Tradeoffs accepted:**
- Adding ~10% to feature time in exchange for a dramatically more valuable artifact at the end
- ADRs that may turn out wrong are still kept (status: superseded), not deleted — the history matters
