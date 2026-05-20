# 0017 · Entry-vs-close resolution for in-market bets

- **Date:** 2026-05-20
- **Status:** Accepted
- **Supersedes:** [ADR 0008](0008-extend-bet-window.md) — extended bet
  window into market hours, kept open-vs-close for all bets.

## Context

ADR 0008 extended the bet window into market hours (8 PM previous-day →
1 PM ET trading day) while keeping a single resolution rule for everyone:
**today's open → today's close**. At the time we had no source of
intraday prices, so the only equitable reference was the official open.

Since then we shipped a live-quote layer ([Finnhub real-time
quotes](../../src/lib/live-prices.ts), Upstash-cached) and we capture
`price_at_placement` on every bet (#125 / #126). That made the
following inequity surface:

> A user who bets UP at 12:30 PM ET with the stock already up 2% on the
> day only needs the close to stay above the open. They're effectively
> betting on a four-hour hold rather than a full-day directional call.
> Someone who bet UP at 8 PM the night before is held to the same bar.

The new data isn't just an audit field — it's the bar that *fairly*
measures a mid-day bet, because it's the bar that mid-day bettor
actually committed against.

## Decision

Adopt a **two-mode resolution model**:

| Bet placement timestamp (ET)            | Reference price for resolution |
|-----------------------------------------|--------------------------------|
| Before 9:30 AM on the trading day       | Today's open (open → close)    |
| At or after 9:30 AM on the trading day  | Recorded `price_at_placement`  |
|                                         | (entry → close)                |

Both modes share the same scoring math (close > ref → UP wins,
close < ref → DOWN wins, close == ref → VOID). Only the bar shifts.

### Fallbacks

If `price_at_placement` is `NULL` on an in-market bet (Finnhub was
unavailable at placement time), **fall back to open-vs-close**. The
user shouldn't lose their stake because of our outage. We log the
fallback so we can monitor how often it fires.

If `price_at_placement` is recorded but zero (degenerate snapshot),
same fallback — treat as missing data.

### Grandfathering

Bets created **before `RESOLUTION_V2_CUTOFF`** (= `2026-05-20T19:00:00Z`)
stay on the **legacy open-vs-close** model **regardless** of their
placement time. The cutoff is hardcoded in both:
- `pipeline/processors/resolution_scoring.py::RESOLUTION_V2_CUTOFF`
- `src/lib/bets.ts::RESOLUTION_V2_CUTOFF_ISO` (display layer)

Why hardcode and not store per-row? The resolution mode is fully
derivable from `(created_at, price_at_placement, prediction_date)` —
all immutable columns. A new column would just denormalize that
derivation. If we ever need audit-tier persistence (e.g., to detect a
silent drift between resolver and UI), we add `resolution_mode` then;
not before.

Why grandfather? Users who placed bets under the old contract (mostly
the three internal testers) deserve to be resolved under those rules.
The fairness argument is forward-looking; retroactively applying
entry-vs-close to existing bets would punish people who placed in
good faith under the prior model.

## Alternatives considered

### Stake-decay payouts

Bets after 9:30 AM ET pay 1.7× or 1.5× instead of 1.8×, with the
discount scaling by hours into the session. Keeps resolution math
uniform; uses payout to model "later bets have more information."

- **Pro:** simpler code; no two-mode resolver; no grandfathering.
- **Con:** doesn't actually fix the inequity — a 1.7× payout on a
  near-guaranteed win is still better than 1.8× on a 50/50. The math
  has to lean *harder* than the information advantage to recreate
  fairness, and we don't have data to calibrate that.
- **Verdict:** rejected. Fix the bar, not the payout.

### Tighter bet window (close at 9:30 AM ET)

Lock bets at market open so the resolution model never has to branch.

- **Pro:** simplest possible model.
- **Con:** kills the in-market engagement loop, which is the entire
  reason ADR 0008 extended the window. Users check the app during their
  lunch break and place a thoughtful bet — that's the ritual we built.
- **Verdict:** rejected. Reverting to a pre-market-only window is a UX
  regression.

### Use entry-vs-close for every bet

If we have `price_at_placement` for every bet (including pre-market),
just use it always. Drops the open-vs-close path entirely.

- **Pro:** one resolution path; even simpler than two-mode.
- **Con:** pre-market `price_at_placement` is yesterday's close-ish
  (extended-hours quote). Comparing yesterday's after-hours print to
  today's close measures the overnight gap PLUS the next day's session
  — fundamentally different from a directional call on the trading day.
  Inflates noise massively.
- **Verdict:** rejected. The open is the right anchor when the user
  bet before the day started; the entry is the right anchor when the
  user bet during the day.

### Add a `resolution_mode` column to predictions

Store which mode resolved each bet, instead of deriving it.

- **Pro:** explicit audit trail; UI doesn't need to reproduce the
  derivation.
- **Con:** new migration to apply, new write site, new shape to keep
  in sync across resolver + reveal modal + bet history. The derivation
  is from three immutable fields, so it CAN'T silently drift unless
  the constant changes — and the constant is also code, version-controlled,
  one line.
- **Verdict:** rejected for now. If we later need to A/B test cutoff
  timestamps or run a parallel resolver, we revisit.

## Implementation

New module `pipeline/processors/resolution_scoring.py` extracted from
`resolve_predictions.py` so unit tests can import the pure functions
without pulling in pandas + yfinance. Mirrors the layout of
`processors/verdict.py`.

Three exports:

- `RESOLUTION_V2_CUTOFF` — UTC datetime constant; the line in the sand.
- `_evaluate(direction, reference_price, close_price, wagered)` — leaf
  scoring math. Renamed param from `open_price` → `reference_price` since
  it's now generic over open or entry.
- `_choose_reference_price(bet, open_price, prediction_date)` — picks
  the bar. Returns `(price, mode_label)`.

`resolve_predictions.py` now calls `_choose_reference_price` for each
bet in the per-ticker group and passes the chosen reference to
`_evaluate`. Log line includes the mode label for grep-ability:

```
resolve_done mode=ENTRY ref=264.50 close=262.10 outcome=LOSS
```

UI side: `src/lib/bets.ts` exports a mirrored `resolutionReferenceFor(bet)`
helper that the bet-history list calls when rendering the price-action
line. Same constant, same logic. Tests in `src/lib/__tests__/bets.test.ts`
should cover the alignment in a follow-up — for now we rely on the
ADR's single source of truth (this document) plus the comments in both
files pointing at each other.

Test coverage (Python): 20 cases in `pipeline/tests/test_resolve_predictions.py`
cover all branches of the discriminator + the end-to-end interaction
with `_evaluate`. Notable cases:

- Grandfathered bet with all the "should-be-entry-mode" markers gets
  open-mode anyway
- In-market bet with NULL `price_at_placement` falls back to open-mode
- DST boundary: `_market_open_utc` returns 13:30 UTC for a summer date,
  14:30 UTC for a winter date, correct on the day-of-spring-forward
- Bet placed exactly at 9:30 ET (= market_open) treated as pre-market
  (boundary uses `>`, not `>=`)

## Consequences

### Positive

- **Fairness restored** for users who bet in the morning before the
  stock has moved much. They're no longer at an information disadvantage
  vs lunch-break bettors who can ride the day's existing trend.
- **The signal engine stays relevant.** Under the old model, a strong
  pre-market signal could be easily picked off by anyone who waited
  until noon to see if it was already playing out. Now the late
  bettor has to predict the *next* move, not just the first one.
- **Surface area for `price_at_placement` finally pays off.** We've
  been capturing it since #125; now it drives resolution, not just
  display.

### Negative

- **Two resolution paths means two test surfaces.** The discriminator
  and the legacy/new evaluator are both critical paths now.
- **The cutoff is a hardcoded date.** If a future code change
  *accidentally* shifts it, all bets retroactively move to a different
  mode. Mitigated by tests that lock in the cutoff value, and by the
  fact that it's literally the first constant in the scoring module.
- **Mode label is logged but not stored.** If we ever need to audit
  "which mode resolved bet X?", we have to re-derive from
  `(created_at, price_at_placement, prediction_date)`. Acceptable
  given the fields are immutable; revisit if it ever causes a real
  audit pain.

## /about copy follow-up

The methodology page's "How resolution works" section currently
describes open-vs-close. Should update to reflect the two-mode model,
with an explicit example matching the one in this ADR
("If you bet UP at 12:30 with the stock at $264 vs an open of
$260..."). Filed as a follow-up; not blocking for this ship.
