# ADR 0009 — Bet placement runs as a Postgres RPC

**Status:** Accepted
**Date:** 2026-05-19

## Context

Placing a bet is three writes that must move together:

1. Insert a row into `predictions` (the bet itself).
2. Decrement `user_profiles.credit_balance` by the stake.
3. Append a row to `credit_transactions` recording the debit
   (`amount = -stake`, `type = 'WAGER'`, `balance_after = new_balance`).

These are not optional. If (1) succeeds and (2) doesn't, the user has a bet
they didn't pay for. If (2) succeeds and (3) doesn't, the ledger no longer
reconciles to the balance — the audit trail breaks. And under concurrent
clicks (double-tap, slow network, accidental form resubmission), two
near-simultaneous attempts can each pass the "balance >= stake" check and
both debit the balance, leaving it negative.

The original sketch in [IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md)
left this as "a server action that does the three writes." That works on a
happy path but fails the moment anything goes sideways.

## Decision

Bet placement runs as a single Postgres function — `place_bet(stock_id,
direction, credits, prediction_date)` — invoked from the
[server action](../../src/app/actions/bets.ts) via `supabase.rpc()`.

The function:

- Takes a `FOR UPDATE` row lock on the caller's `user_profiles` row, so
  the balance check and the debit see each other across concurrent calls.
- Validates inputs server-side (direction, stake range, stake step).
- Inserts the prediction row (the `unique (user_id, stock_id,
  prediction_date)` constraint surfaces double-bet attempts as
  PostgreSQL error `23505`, which the server action maps to "you already
  bet on this stock today").
- Decrements the balance and bumps `total_predictions`.
- Appends the ledger row, computing `balance_after` inline.
- Returns the inserted prediction.

The whole thing runs in one transaction. Any error rolls back all three
writes. The server action layer adds the bet-window gate (re-checking
`MarketSchedule.betWindowOpen` server-side) and translates Postgres errors
into user-facing copy.

`SECURITY DEFINER` is used so the function can write to
`credit_transactions`, whose RLS denies user inserts — the ledger is
deliberately tamper-proof from the client. All writes inside the function
still scope to `auth.uid()`, never a caller-supplied user_id.

### What changes
- New file: `supabase/migrations/20260519000003_place_bet_rpc.sql`
- New file: `src/app/actions/bets.ts` (server action wrapping the RPC)
- `src/lib/bets.ts` exposes `fetchBetsForTradingDay` for read-side queries

### What stays the same
- `predictions` schema (1:1 with original spec, including the unique
  constraint that now does double duty as our concurrency check)
- `credit_transactions` schema and RLS (read-only from clients)
- `resolve_predictions.py` — bets are still written one row at a time,
  resolution still updates `outcome` and appends a `WIN`/`LOSS`/`VOID`
  ledger row using the same shape

## Alternatives considered

- **Three sequential calls from the server action.** Simplest to write,
  but no row locking and no all-or-nothing semantics. A partial failure
  leaves the system inconsistent and requires bespoke cleanup logic
  every time we extend the bet flow. Rejected.

- **Advisory lock + sequential writes.** Use `pg_advisory_xact_lock` keyed
  on `user_id` to serialize concurrent bet attempts, then do the three
  writes in the server action. Solves the race but not the partial-failure
  problem — if the third write fails, we still need cleanup. Net: more
  moving parts than an RPC, same atomicity guarantee. Rejected.

- **Edge function instead of RPC.** A Supabase Edge Function could
  orchestrate the writes inside a single Postgres transaction over a
  pooled connection. Works, but adds a network hop and another runtime to
  monitor. The RPC keeps the transaction inside the DB where it belongs.
  Rejected for v1; reconsider if bet placement ever needs side effects
  outside Postgres (e.g., emitting a webhook to a notification service).

- **Trigger-based debit on `predictions` insert.** A `BEFORE INSERT`
  trigger on `predictions` could read the balance, check it, decrement,
  and write the ledger row. Functionally equivalent, but spreads the bet
  logic across the schema (predictions → trigger → user_profiles →
  ledger) and makes the code harder to read. The RPC keeps everything in
  one named function that a reader can grep for. Rejected.

## Consequences

**Easier:**
- One named function to read, test, and reason about. `grep place_bet`
  finds all of it.
- Concurrency is correct by construction — the row lock plus the unique
  constraint means a user physically cannot place two bets on the same
  stock for the same day, even with parallel requests.
- Errors are categorized via Postgres error codes + named RAISE messages,
  letting the server action map cleanly to user copy without inspecting
  raw error strings.

**Harder:**
- The function lives in SQL, not TypeScript — typecheck doesn't cover the
  contract between server action and RPC. Mitigated by: (a) shared
  validation rules at both layers, (b) the RPC's `returns predictions`
  matches our TS `Prediction` type by column shape, (c) the integration
  fails loud (RPC call returns error) rather than silently producing
  wrong data.
- Adding a new write to bet placement (e.g., a "first bet" achievement)
  requires a migration to extend the RPC, not just an app-layer change.
  This is the right place for that friction — it forces us to think about
  atomicity for every new write.

## Cancellation (added 2026-05-19)

Cancel-before-lock is the symmetric counterpart and follows the same
pattern — a second RPC, `cancel_bet(prediction_id)`, that runs three
writes in one transaction: delete the prediction, refund the balance,
append a `REFUND` row to `credit_transactions`. Migration:
`20260519000004_cancel_bet_rpc.sql`.

### Race against resolution
The interesting race is cancellation vs the 4:15 PM ET resolution job —
both want to write to the same prediction row. We close it the same way
place_bet closes the double-click race: `FOR UPDATE` lock on the
prediction inside the cancel transaction, plus a `resolved=false` check
*after* taking the lock. One of two things happens:
- Cancel gets the lock first → deletes the row → resolution finds no
  unresolved row and moves on.
- Resolution gets the lock first → sets `resolved=true` → cancel's
  post-lock check sees `resolved=true` and raises
  `prediction_already_resolved`, which the server action maps to
  "Already resolved — too late to cancel".

There is no window where both operations succeed.

### Hard delete on predictions, append on the ledger
The predictions row is hard-deleted (no `cancelled_at` column). Rationale:
- The unique `(user, stock, prediction_date)` constraint can stay simple
  — re-betting on the same stock after cancellation just works, no
  partial-index gymnastics required.
- The audit trail lives in `credit_transactions`, not in `predictions`.
  Both the `WAGER` (debit) and `REFUND` (credit) rows survive
  cancellation with `reference_id` pointing at the now-deleted
  prediction's UUID. A reader can reconstruct "this user placed a bet
  and cancelled it" from the ledger alone.
- The `predictions` table now means *live bets only*, which makes every
  consumer of that table (home-feed lookup, resolution job, history
  views) simpler — no need to filter out cancelled rows everywhere.

### Symmetric window gate
The server action re-checks `MarketSchedule.betWindowOpen` before
calling the RPC. If you can place a bet, you can cancel; once the
window locks, both operations refuse client-side and would refuse
server-side too. This matches the user's mental model — the bet window
is a single state, not two.

## Tradeoffs accepted

- Schema-level logic in exchange for atomicity guarantees and concurrency
  safety. The team is small (1) and we're already comfortable in SQL;
  the maintenance cost is low.
- One extra round-trip relative to a stored procedure invoked from a
  trigger, but a saved round-trip relative to N separate writes from the
  app layer. Net wash.

## Future evolution

If we add multi-stock "parlay" bets (one combined bet across N stocks),
this RPC extends to take an array of (stock_id, direction) pairs and
insert N predictions in the same transaction. The credit debit is one
combined row in `credit_transactions` with `reference_id` pointing at a
new `parlays` table. ADR TBD.

If we ever ship crowd-split odds (post-MVP), the payout calculation moves
inside this function — currently fixed at `1.8×`, then determined by the
collective UP/DOWN split at the moment the window locks. The function's
inputs don't change; only the resolution job changes.
