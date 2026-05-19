# ADR 0008 — Bet window extends into market hours

**Status:** Accepted
**Date:** 2026-05-19

## Context

The original bet-window design (set at project start, baked into
[IMPLEMENTATION_PLAN.md](../../IMPLEMENTATION_PLAN.md)) was:

```
8 PM ET prev day  → bet window opens (after pipeline computes verdict)
9:15 AM ET        → bet window locks (15 min before market open)
```

The intent: lock predictions *before* anyone could see live price action,
so the bet is a real call into the unknown.

The actual user experience: friction. Most casual users aren't on the app
at 8 PM. They open it during the day — and find the bet window already
closed for today. They can't bet on tomorrow because tomorrow's pipeline
hasn't run yet. **Net result: nobody bets unless they specifically time
their visit to between 8 PM and 9:15 AM the next morning.**

Two months of mental modeling later, we have evidence that this UX kills
the daily ritual. Friends bouncing off the app at 10 AM with nothing to
do are the canary.

## Decision

Extend the bet window into the trading day:

```
Mon 8:00 PM ET  → Pipeline runs            (computes Tuesday's prediction)
Mon 8:00 PM     → BET WINDOW OPENS for Tuesday
Tue 9:30 AM ET  → Market opens             (bet window STILL OPEN)
Tue 1:00 PM ET  → BET WINDOW LOCKS         (10 AM PST cutoff)
Tue 4:00 PM     → Market closes
Tue 4:15 PM     → Resolution job runs      (sign(close - open) per stock)
```

The bet window is now **17 hours** (8 PM previous day → 1 PM trading day),
including **3.5 hours during the morning trading session**.

### What changes
- `BET_LOCK_HOUR_ET` constant in `src/lib/market-schedule.ts`: 9 → 13
- `BET_LOCK_MIN_ET` constant: 15 → 0
- `MarketScheduleBar` automatically reflects the new lock time
- Resolution logic in `pipeline/resolve_predictions.py` unchanged
  (we still compare `open_price → close_price`, sign tells outcome)

### What stays the same
- Nightly 8 PM ET pipeline run (max-data approach preserved)
- 4:15 PM ET resolution job
- The verdict (UP / DOWN / NEUTRAL) is computed once at pipeline time and
  never modified during the trading day
- Per-stock outcome calculation: `open_price → close_price`

## Alternatives considered

- **Morning pipeline (6 AM ET)**. Would let us run pipeline + open window
  on the trading day itself. Rejected because: (a) we lose evening + late
  news; (b) the prediction would be made on fresher data but the window
  to bet is much tighter (3.5 hours vs 17 hours); (c) bigger ops risk —
  a 6 AM pipeline failure can't be retried before market open.

- **Bet window locks at 9:25 AM (original spec).** Rejected because: it
  forces users to come back at 8 PM for the *next* day's bets. The hour
  before market open is the *worst* time for casual users to engage.

- **Bet window open 24/7 with adjusted odds.** Real prediction-market
  pattern (Polymarket, Kalshi) but requires order-book / dynamic odds
  which our fixed-1.8× payout architecture doesn't support. Reconsider
  if we ever ship crowd-split odds.

- **Lock at 11 AM ET (~1.5h after open).** A middle ground. Less
  informational asymmetry but tighter window. Rejected in favor of the
  full 1 PM ET cutoff because the 1.8× fixed payout already discounts
  late-bettor information edge (vs paying out actual probability-priced
  odds).

## Consequences

**Easier (user-facing):**
- Casual users can fit a "morning coffee + place bets" routine into
  their day, even if they sleep through the 8 PM pipeline
- Users see live price action and can decide whether to fade or confirm
  MarketMind's morning call — the prediction becomes a thesis to react
  to, not just a one-shot bet
- The MarketScheduleBar's bet-window state is *usually open* during
  normal waking hours, which feels like a live product instead of a
  cron-driven scheduler

**Harder:**
- Information asymmetry: a user betting at 12:30 PM has more info than
  a user betting at 9 AM. Both get the same fixed 1.8× payout.
  Mitigation: this is a feature for non-monetary play — late bettors
  trade prediction time for confirmation; early bettors trade certainty
  for full prediction credit.
- The "did MarketMind get it right" question now has nuance: if the
  market opened up but reverted by 1 PM (when bets locked), MarketMind's
  call was technically wrong at close but looked right midday. The
  track record metric on `/about` still uses open→close so this nuance
  is hidden in the headline accuracy number — acceptable.
- DST: bet window expressed in ET, so the wall-clock time shifts by 1
  hour twice a year for users in fixed-offset locales. Acceptable for
  MVP (the schedule bar shows the actual time in ET each session).

## Tradeoffs accepted

- Information asymmetry between early and late bettors, in exchange for
  a usable daily ritual.
- Bet window is no longer "purely predictive" — it spans market hours.
  Reconcile by reframing: MarketMind's *call* is purely predictive
  (made overnight on yesterday's data). The *user's bet* can be a fade
  or a confirmation, made with however much information they want to
  have.

## Future evolution

When/if we ship crowd-split odds (post-MVP, ADR TBD), this gets revisited.
Crowd-split naturally prices in late-bettor information via the dynamic
odds — early bettors get bigger payouts for taking the risk before
confirmation, late bettors get smaller payouts but lower variance.
That's the elegant version of what this ADR pragmatically approximates
with a fixed payout + extended window.
