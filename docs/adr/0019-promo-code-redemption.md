# ADR 0019 — Promo-code redemption

**Status**: Accepted
**Date**: 2026-05-20

## Context

Before this change, the only ways for a user's credit balance to grow
were (a) the signup bonus, (b) the daily-login bonus, and (c) winning
bets. There was no path to grant credits out-of-band: no way to ship a
launch promo, run an influencer campaign, send a make-good after a
production incident, or reward beta testers.

The founder wanted a redemption surface in the existing credit chip —
click the chip, see balance + redeem-a-code, with a 1,000-credit-per-day
ceiling on inflow per user so a leaked code can't drain the credit
budget on a single account.

## Decision

Build a **campaign-code redemption system**: shared codes
(`LAUNCH2026`-style strings), each redeemable once per account, with
per-user daily inflow capped at 1,000 credits / ET calendar day.

### Scope (v1)

Implements:
- User-facing: enter a code in the credits dialog, get credited atomically
- Admin-facing: `/admin/codes` page (gated by `ADMIN_EMAILS` env var) to
  create, list, and deactivate codes
- Daily-cap enforcement in the redemption RPC (atomic-or-nothing)
- Per-code limits (`max_redemptions`, `expires_at`, `is_active`)
- Full ledger via existing `credit_transactions` (`type='PROMO_CODE'`)

Explicitly out of scope:
- Per-recipient personal codes (would require generation + delivery)
- Referral codes with attribution
- Stripe-style coupon stacking
- Email notifications when codes are about to expire

## Architecture

### Schema

Two new tables in `20260521000001_promo_codes.sql`:

| Table | Role | RLS |
|---|---|---|
| `promo_codes` | Admin-curated catalog. `(code, credits, max_redemptions, expires_at, is_active)`. | Deny-all. Writes via service-role; reads via SECURITY DEFINER RPC. |
| `promo_code_redemptions` | Per-(code, user) ledger. `unique(code_id, user_id)` enforces idempotency. | Own-read for history; writes only via RPC. |

The unique constraint on `(code_id, user_id)` is the load-bearing piece —
it's what makes "one redemption per account" a database invariant rather
than a code-path check that could race. The RPC checks
`already_redeemed` explicitly so the error is clean, but if that check
were ever skipped, the unique constraint would still backstop it with a
`23505` violation.

### Redemption flow

`redeem_promo_code(p_code text, p_today_date date)` — SECURITY DEFINER,
all of the following in one transaction:

1. `auth.uid()` check
2. Normalize the code (`UPPER(TRIM)`), pattern-validate
3. `SELECT … FOR UPDATE` the `promo_codes` row (locks vs. concurrent
   redemptions racing `redeem_count` past `max_redemptions`)
4. Validate code state: active, not expired, not exhausted
5. Validate per-user: not previously redeemed
6. **Daily-cap check**: `SUM(credits)` of today's redemptions
   `(redeemed_at at time zone 'America/New_York')::date = p_today_date`
   plus `this_code.credits` — if it would exceed 1,000, reject as
   `daily_cap_exceeded`
7. Lock user profile, insert redemption row, bump `redeem_count`,
   credit `user_profiles.credit_balance`, write `credit_transactions`
   ledger row with `type='PROMO_CODE'`, `reference_id = code_id`

The `p_today_date` is computed in TypeScript from the same
`etCalendarDate()` helper used by `claim_daily_bonus`, so the ET-day
boundary is consistent regardless of the server's local timezone.

### Atomic-or-nothing

If a 600-credit code would push the user from 500 used → 1,100 used,
the RPC rejects rather than partial-granting. Reasons:
- Partial-grant means the code is consumed (one-per-account) but the
  user only got part of its face value — confusing UX
- Atomic-reject means the user can come back tomorrow and redeem the
  full amount
- Implementation is simpler — one cap check, one outcome

### Admin gating: `ADMIN_EMAILS` env var

Single-tenant by design. `ADMIN_EMAILS` is a comma-separated allowlist
(e.g. `ADMIN_EMAILS=neelesh1206@gmail.com`). The `isAdminEmail()`
helper is called in:
- `app/admin/layout.tsx` (page-level guard, redirects non-admins)
- Each admin server action (`createPromoCode`, `deactivatePromoCode`)
  (defense-in-depth in case the layout guard is bypassed somehow)

Why not a `role` column on `user_profiles`?
- At one-admin scale, a role column adds a migration, role-management UI,
  and a SECURITY DEFINER `is_admin()` RPC for use in RLS
- The allowlist lives in Vercel env + GH Actions secrets — changes go
  through secret-management, which is auditable
- Migration to a role column is a 30-min job if we ever have multiple
  admins

### Service-role client for admin writes

Admin writes go through `createAdminClient()` (new `src/lib/supabase/service.ts`)
which uses `SUPABASE_SERVICE_KEY` (same env var the Python pipeline
already reads — single source of truth for the Supabase service-role
secret) and bypasses RLS. Pattern:
- Server action authenticates the user with the regular client
- Checks `isAdminEmail(user.email)`
- Then uses the admin client for the actual table write

This is the only place in the codebase that uses service-role from
Next.js. Adding `import "server-only"` would harden against accidental
client-component imports, but the package isn't in the dep tree and the
lack of `NEXT_PUBLIC_` prefix already keeps the key out of the browser
bundle.

## UI

### Redeem path

Existing inline credit-chip markup (`<div … credits>`) was duplicated
across 6 pages. Extracted to `<CreditsChip credits={credits} />` — a
client component that:

1. Renders the chip (same visual as before, now wrapped in a
   `SheetTrigger`)
2. Opens a right-side `Sheet` on click
3. Lazily fetches the user's daily-cap usage + recent redemptions via
   `getCreditsDialogData()` server action (so pages don't have to fetch
   for the chip render)
4. Submits the redeem form via `redeemPromoCode()` server action, maps
   errors via `REDEEM_ERROR_COPY` to user-facing toast strings

Error copy is deliberately vague for `not_found` / `inactive` /
`invalid_format` — all three surface as "That code isn't valid." so a
brute-forcer can't tell whether a code exists.

### Admin path

`/admin/codes` (gated by layout). Server component renders the page
with a fresh `fetchAllPromoCodes()` (service-role read), passes to a
client `<CodesAdminPanel>` that handles:

- Create form (code / credits / max_redemptions / expires_at /
  description) → `createPromoCode()` server action → optimistic prepend
- Table of all codes with derived status (`active` / `inactive` /
  `expired` / `exhausted`) and a Deactivate button for active rows
  → `deactivatePromoCode()` server action → optimistic flip

## Anti-abuse considerations

| Surface | Mitigation |
|---|---|
| Brute-force valid codes | Vague error copy + 5/min rate limit on `redeemCode` |
| One user farming a leaked code | `unique(code_id, user_id)` — one per account |
| Sybil accounts farming a leaked code | Email confirmation on signup limits this; not fully solved. Daily cap caps damage per account. |
| Admin abuse | Single-admin allowlist; rate limit on `createPromoCode` (20/min) |
| Concurrent redemption racing past `max_redemptions` | `SELECT … FOR UPDATE` on the promo_codes row |
| Code creation collision | Unique constraint on `code`; server action surfaces 23505 as "already exists" |
| Stale ledger from in-flight bug | Append-only `credit_transactions`; every redeem writes a `PROMO_CODE` row with `reference_id = code_id` for audit |

## Configuration

| Env var | Default | Where set |
|---|---|---|
| `ADMIN_EMAILS` | (unset → no admins) | Vercel + GH Actions |
| `SUPABASE_SERVICE_KEY` | required for admin | Vercel + GH Actions (shared with pipeline) |
| `DAILY_PROMO_CAP` (constant in code) | 1000 | `src/lib/promo-codes.ts` + RPC `v_daily_cap` |

## Files

```
supabase/migrations/20260521000001_promo_codes.sql
src/lib/admin.ts                              (new)
src/lib/promo-codes.ts                        (new)
src/lib/supabase/service.ts                   (new)
src/lib/rate-limit.ts                         (added redeemCode + createPromoCode limiters)
src/app/actions/promo-codes.ts                (new)
src/app/admin/layout.tsx                      (new)
src/app/admin/codes/page.tsx                  (new)
src/components/credits-chip.tsx               (new — replaces inline chip on 6 pages)
src/components/codes-admin-panel.tsx          (new)
src/app/{page,bets/page,leaderboard/page,profile/page,stocks/page,stock/[ticker]/page}.tsx
                                              (chip swap)
```

## Open follow-ups

- **Display partial-credit info** — when a redemption is rejected with
  `daily_cap_exceeded`, show "You have N credits of headroom left
  today" so the user knows exactly what would fit. RPC already returns
  `daily_remaining`; UI just needs to surface it via the error.
- **Email notification when a redeemed code is on its last redemption**
  — useful for admin awareness of campaign performance. Needs email
  infrastructure we don't have yet.
- **Code copy-to-clipboard in admin table** — small UX nicety.
- **Audit trail in admin table** — currently no "who deactivated this
  code, when." Could add `deactivated_at` and `deactivated_by` columns.
