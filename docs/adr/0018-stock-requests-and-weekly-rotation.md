# ADR 0018 — Stock requests + weekly universe rotation

**Status:** Accepted (Phase 1 shipped; Phase 2 pending)
**Date:** 2026-05-20

## Context

MarketMind covers a curated **50-stock universe**. The picks were
hand-selected at project start to span sectors (mega-cap tech +
financials + healthcare + a few retail/meme tickers) but the universe
is **static** — there's no mechanism for users to suggest additions, and
no automated rotation when interest drifts. Two problems become visible
as the user base grows:

1. **Discovery friction**: a user wants to track LLY (Eli Lilly,
   pharma mega-cap) but it's not in the pool. They can't bet on it,
   can't see its verdict, can't add it to their watchlist. The only
   recourse is filing a GitHub issue — which doesn't scale.
2. **Dead weight**: some stocks in the pool aren't being used. If
   nobody has put MCHP on their watchlist and nobody has bet on it
   in months, it's costing pipeline budget for no user value. Static
   universes accumulate dead weight by default.

We want a feedback loop: **user demand decides what's in the universe.**

## Decision

Ship in two phases.

### Phase 1 — Stock-request collection (this commit)

Users can request tickers via a **new tab on `/stocks`** ("Request to be
added"), alongside the existing "Browse available" tab. Same mental
model — manage stock relationships — in one place, rather than a
separate route. (Previously prototyped as a standalone `/requests`
page; refactored to tabs after a UX review during the same session.)
Aggregate vote counts are visible publicly; per-user vote rows are
RLS-protected. Voting is **one vote per (user, ticker)** — idempotent
upsert; re-clicking is a no-op; removing a vote deletes the row.

**Universe of requestable tickers: top ~2000 by market cap.**
Implementation: not a maintained static list (would go stale + adds
operational surface). Instead, **just-in-time validation** at request
submit time:

- Search uses Finnhub `/search?q=` which is already scoped to US-listed
  equities. Output filtered to `type=Common Stock` so ETFs, warrants,
  preferred shares don't pollute the dropdown.
- When the user picks a search result, the server action calls
  Finnhub `/stock/profile2?symbol=X`. If market cap (USD) is below
  `MIN_MARKET_CAP_USD` (default $2B, env-var overrideable), the
  submission is rejected with a copy line that explains the threshold.

$2B threshold corresponds roughly to rank ~1800 in US equities (varies
day-to-day). Keeps junk requests out while comfortably covering anyone
who'd be in a "top 2000" list.

### Phase 2 — Weekly universe rotation (next commit)

The 50-stock universe rotates **once per week on Sunday** based on
demand + activity signals.

**Always exactly 50 stocks.** If we demote N, we promote N. Never
more, never less. The cross-sectional ranking + track-record stability
work we shipped earlier this week depends on a stable universe count;
a floating size would break those.

**Demotion eligibility** (both conditions must hold):
- Zero users have the stock on their watchlist
- Zero user bets placed on the stock in the last 30 days

**Promotion order**: top-requested tickers (by unique-user vote count
desc, latest-request-time desc as a tiebreaker) that pass full
validation — Finnhub `/profile2` resolves, market cap still above
threshold, yfinance returns ≥1 year of price bars (so technical
indicators can be computed).

**Cadence**: Sunday cron, fired by the Cloudflare Worker that already
owns scheduling (ADR 0016). Specifically: **Sunday 12:00 UTC** (which
maps to ~7-8 AM ET depending on DST). Why this time:

- Market is closed (US equities don't trade Sun)
- The Friday-evening pipeline run has already produced Monday's
  insights for the *current* universe
- Sunday morning rotation leaves the rest of the day to fill in
  insights for newly-promoted stocks before Monday's market opens
- After rotation completes, a targeted re-fill pipeline run executes
  ONLY for the newly-promoted stocks (no need to re-fetch the unchanged
  47-48 stocks; they already have Monday insights)

**Bets disabled on Sundays.** This is a new product behavior. Two
reasons:

1. *Race avoidance.* If a user bets on stock X at 11 AM Sunday and the
   12 PM rotation demotes X, their bet sits in DB on an inactive stock.
   Closing the bet window over Sunday eliminates the race entirely.
2. *Universe clarity.* The pool you bet on Monday morning is the pool
   that just got rotated into. Users see the new universe Sunday
   afternoon onwards but can't bet against it until Monday open. Sets
   a clear rhythm.

Implementation: `market-schedule.ts` gains a `weekend-rotation` phase
that overrides bet-window-open to false from Saturday 12:00 AM ET
through Monday 12:00 AM ET. The bet CTA on home / detail pages shows
"Bets reopen Monday — universe rotating."

**Safety floor**: never demote if it would drop the universe below 50.
Concretely: if N stocks meet demotion criteria but only M tickers
pass promotion validation (where M < N), demote only the M
lowest-utility stocks (lowest watchlist+bet count) and leave the rest
in place this week.

## Alternatives considered

- **Maintain a static "top 2000" list** refreshed quarterly via a
  manual script. Simpler at runtime (no per-request Finnhub call), but
  list goes stale, requires recurring human effort, and provides no
  value over runtime validation. Rejected.

- **No market-cap threshold; allow any US-listed common stock.**
  Maximum flexibility. Rejected because the request list would fill up
  with sub-$500M tickers we genuinely can't serve well — Finnhub
  analyst coverage thins out below ~$1B, yfinance volume/RSI calculations
  get noisy below ~$2B daily volume, and the existing FinBERT sentiment
  bucket gets less reliable when news flow is thin.

- **Rotate continuously** (any day a request crosses a threshold,
  promote immediately). Simpler than "weekly batch." Rejected because
  continuous rotation breaks track-record comparability — verdicts for
  a stock that just got promoted Monday lunch can't be compared to
  verdicts from a stock that was in the universe all week. Weekly
  cadence aligns with the natural unit-of-measurement (the trading
  week) and gives users a predictable schedule.

- **Different threshold (10 votes? 20?) before promotion is even
  considered.** Reasonable on a larger user base. At current scale
  (single-digit users), even 3 votes is significant. We start with
  "top-N where N = number of qualifying demotions" and tighten when
  the request volume justifies it.

- **Allow demotion below 50 if the rotation budget is full.** Rejected
  because the cross-sectional ranking, track-record CIs, and conviction
  list all assume a fixed N. Letting N fluctuate would force us to
  reframe a lot of UX ("Top 5 of how many?") for no good reason.

- **Hard cap of N promotions per week.** Considered (max 2-3 swaps to
  avoid wholesale rotation). Rejected because the demotion criteria
  themselves are conservative — a stock with zero watchlists AND zero
  bets in 30 days is genuinely dead weight, and there's no good reason
  to keep it. The cap was a hedge against runaway churn; the criteria
  already prevent that.

## Consequences

**Phase 1 effects:**
- Users can suggest tickers; aggregate counts visible.
- Server-side validation gives precise rejection copy (we tried real
  hard not to surface "Finnhub returned 403" to the user — instead it's
  "couldn't reach our data provider, try again").
- New `stock_requests` table + three new RPCs.
- Doesn't change any model behavior, doesn't affect the pipeline,
  doesn't break any existing test.

**Phase 2 effects (when shipped):**
- The universe is no longer hand-curated — it adapts to actual usage.
- Sunday no-bets is a new product constraint visible in the schedule
  bar. Users on PT timezones will see it span their entire Sunday;
  users on ET see it the same. Acceptable trade for the rotation
  safety property.
- Per-stock track records (for demoted stocks) freeze at the demotion
  moment. Re-promotion picks back up where it left off if/when it
  happens.
- A small operational risk: if Finnhub goes down during the Sunday
  rotation, no promotions can happen that week. Demotions still
  execute (don't need network calls). The universe drops below 50
  for the week. We accept this; it's rare and the next Sunday catches up.

**What this DOESN'T address:**
- Per-stock historical depth: a newly-promoted ticker shows up Monday
  with no `marketmind_predictions` track record. Users see "Building
  track record" until enough days accumulate. By design — there's no
  shortcut.
- Adversarial voting: a coordinated push could promote a ticker for
  brigading reasons. The validation gate (market cap > $2B) limits the
  damage — the worst case is a legitimate $2B stock joins the universe
  earlier than it would have otherwise. No actual data integrity issue.

## Notes

Phase 1 ships with this ADR. Phase 2 (the actual rotation pipeline +
Sunday closure) is the next signal-side commit. The schema + UI shipped
here are designed against the Phase 2 contract; nothing in Phase 1 will
need to change when Phase 2 lands.

---

## 2026-05-20 amendment — pre-loaded universe + 5/week limit + Postgres-backed search

The original Phase 1 implementation called Finnhub `/search` + `/profile2`
per user request (with a 1h/24h Redis cache). It worked, but raised
two concerns:

1. **Shared quota with live prices.** Live prices also use Finnhub
   (60 calls/min free tier). Putting search on the same quota means
   a search burst can starve live prices, or vice versa.
2. **Cold cache + cold start tax.** A new Vercel function instance
   on a fresh Redis cache pays a Finnhub round-trip per keystroke.

The senior-engineering pattern is to **separate the data-acquisition
concern from the data-serving concern.** Acquisition is slow,
external-dependency-heavy, runs on a schedule. Serving is fast,
internal-only, runs per-request. Acquired data lives in your own
storage in between.

### Pre-loaded universe table

New `universe_eligible_stocks` (Postgres) table — the source of truth
for "what can be requested." Schema:

```sql
ticker          text primary key,
company_name    text not null,
exchange        text,
market_cap_usd  bigint not null,
refreshed_at    timestamptz not null default now()
```

Three indexes — primary key on `ticker`, `text_pattern_ops` on ticker
for prefix matching, `text_pattern_ops` on `lower(company_name)` for
case-insensitive substring matching, and a sort-friendly index on
`market_cap_usd desc`. Public-read RLS so anon visitors can search.

### Why Postgres and not Redis

Search is multi-attribute filtering with relevance scoring:

```
WHERE ticker LIKE 'X%' OR company_name ILIKE '%x%'
ORDER BY (exact_match, prefix_match, contains_match), market_cap DESC
LIMIT 15
```

In SQL this is one indexed query, sub-millisecond at 2000 rows. In
Redis it would mean loading a 200KB JSON blob into a Vercel function's
memory and filtering in JS on every search — same wall-clock latency
but harder to evolve (add `sector`, `country` later → app code change)
and impossible to join with other relational data (Phase 2 rotation
needs `stock_requests JOIN universe_eligible_stocks`).

The general principle: **single-key TTL'd lookups → Redis; multi-
attribute filtered queries → Postgres.** Live prices (`mm:price:<TICKER>`)
and rate-limit counters stay in Redis where they belong; this data
moves to Postgres where it belongs.

### Refresh pipeline (seed-driven — revised for 45-min job budget)

`pipeline/refresh_eligible_universe.py` runs weekly. **Key constraint:
GitHub Actions free tier caps individual jobs at 45 min.** The naive
"scan all 12K US tickers" approach (~3h 20m at 60 calls/min Finnhub
limit) doesn't fit, so we use a seed-driven design:

1. Load `data/eligible_universe_seed.json` — a curated, version-
   controlled list of ~200-2000 known eligible US-listed names.
2. For each seed ticker, fetch Finnhub `/stock/profile2` at 1.1s
   pacing (≈55 calls/min, safely under the 60/min limit).
3. Filter to market cap ≥ $2B + valid US listing; collect rows.
4. Bulk upsert into `universe_eligible_stocks` in 200-row chunks.
5. Delete table rows whose ticker isn't in the current run
   (handles seed shrinkage / tickers dropping below threshold).

Runtime: ~37 min for a 2000-ticker seed. Fits in 45 min with margin.
The initial commit ships with ~200 seed tickers (~3.7 min runtime);
expand the seed quarterly via off-CI curation as the request volume
justifies.

**The seed gets re-curated quarterly**, not weekly — IPO/delisting
cadence is slow enough that monthly-or-better is fine for "what's
eligible." The weekly refresh keeps market caps current for the seed.

Schedule: Sunday 04:00 UTC via the Cloudflare Worker cron (ADR 0016).
That's ~midnight Sunday ET — 8 hours before the Phase 2 rotation
pipeline (still pending) needs the data.

### Why a JSON file in repo, not a database table

The seed is "data treated as code": version-controlled, reviewable
via PR, auditable in `git log`, no runtime dependency to refresh.
Storing it as a database table would require its own seed-loading
step on every fresh environment, complicating local dev. JSON is
the right answer for slow-moving, small, structured data — the
canonical "configuration over implementation" trade.

### 5-per-week request limit

Per-user rolling 7-day cap on **unique-ticker** requests. Three
properties matter:

1. **Rolling window, not calendar week.** Calendar resets create
   weird UX ("can I request? oh wait it's Sunday 11:58 PM...").
   Rolling: your oldest in-window request ages out and the budget
   regrows naturally.
2. **Re-vote doesn't count.** Re-clicking "I want this" on a stock
   you've already voted for is idempotent — the upsert is a no-op,
   and the limit only triggers on new (user, ticker) pairs.
3. **Defense in depth.** UI shows "3 of 5 used this week" near the
   search box and disables submit at 5/5. Server action checks the
   count for fast feedback. RPC enforces it as the authoritative
   gate (can't be bypassed via direct DB writes).

### What changes in the user-facing experience

- The "Request to be added" tab on `/stocks` now shows a "3 of 5
  weekly requests used" badge next to the search box.
- Once you hit the limit, the search input is disabled and a small
  amber explanation appears. As your oldest request ages past 7 days,
  the count drops and the input re-enables — automatically, no action
  needed.
- Search itself is now faster (no Finnhub round-trip) and works during
  Finnhub outages.

### What stops working between migration apply and first refresh

The table is empty until the first refresh job populates it. Until
then:
- Search returns no results (UI shows "No matches").
- Submit is blocked by the `ticker_not_eligible` check in the RPC.

**Bootstrap procedure**: apply the migration, then immediately trigger
the `refresh-eligible-universe.yml` workflow via `workflow_dispatch`
on GitHub Actions. The first run takes ~3h 20m. After that, weekly
cron handles it.

### Trade-offs accepted

- **Up to 7 days stale market cap.** A stock that drops from $2.5B
  to $1.8B mid-week stays requestable until Sunday's refresh removes
  it. For "is this a real public company worth tracking" gating,
  this resolution is fine — we're not running a high-frequency
  rebalance.
- **3h 20m bootstrap.** One-time cost. Could be sped up by parallelizing
  the per-ticker `/profile2` calls (we currently serialize for rate
  limit safety), but the marginal benefit isn't worth the rate-limit
  risk.
- **Search returns nothing if the refresh ever fully fails.** The
  table is the source of truth; if we somehow blank it out, no search
  works. The refresh job has a "skip delete if zero current rows"
  guard to prevent the most catastrophic failure mode (Finnhub returns
  nothing → we don't delete everything thinking the universe collapsed).

---

## 2026-05-20 reversal — rolling back the pre-loaded universe

**Status of the 2026-05-20 amendment: REVERSED.** The pre-loaded
`universe_eligible_stocks` table, refresh pipeline, seed file, and
weekly Sunday cron are removed. Search and validation revert to
per-request Finnhub calls with Upstash caching (the original Phase 1
implementation).

### What's kept

- **5-per-rolling-7d request limit** on `submit_stock_request` —
  this is the actual rate-limiter and the reason we can revert
  the table without quota concerns
- **`get_user_weekly_request_count` RPC** — UI uses it for the
  "X of 5 used this week" badge
- **`StockRequestPanel` UI** with the weekly badge + disable-at-limit
  behavior

### What's rolled back

- `universe_eligible_stocks` table (DROP CASCADE in migration 20260520000005)
- `pipeline/refresh_eligible_universe.py` (deleted)
- `.github/workflows/refresh-eligible-universe.yml` (deleted)
- `data/eligible_universe_seed.json` (deleted)
- Sunday 04:00 UTC entry in the Cloudflare Worker cron (removed)
- `src/lib/ticker-search.ts` (reverted to Finnhub-based)
- `submit_stock_request` RPC restored to arg-validated form

### Why the reversal

Concrete math at our actual scale exposed the over-engineering:

- 30 active users × 5 requests/week = 150 submits max/week
- Plus ~7 search queries per session (debounced) = ~1050 search attempts
- Both layers have meaningful cache hit rates (1h on search, 24h on profile2)
- Actual Finnhub additions: ~250-400 calls/week = **~1-2 calls/min average**
- Live prices already use ~10 calls/min worst case
- 60/min Finnhub quota easily absorbs both

The quota-isolation concern that motivated pre-loading was
theoretically correct but practically irrelevant at this scale.
The **5/week request cap** structurally solves the same problem
by capping Finnhub exposure at the user-action layer, with none of
the operational burden of a refresh cron + seed curation + 45-min
job budget management.

### The honest engineering lesson

Pre-loading IS the right architecture at scale — when you have
thousands of active users and the search/validation traffic is a
material fraction of vendor quota. It's the wrong architecture
when:

1. The actual traffic is dominated by other use cases (live prices
   at 10/min vs search at 1/min — the search isn't the bottleneck)
2. You have a structural rate limiter (5/week) that's cheaper to
   implement than the architectural one (refresh cron + seed)
3. The operational cost (curation, cron, monitoring, recovery from
   refresh failures) is disproportionate to the quota you'd save

Knowing when NOT to apply a senior-eng pattern is itself the senior
skill. We documented the pre-loaded design in case it becomes
correct later (say, at 1000+ active users), but reverted because
the trade-off is wrong today.

### When to revisit

Bring this design back if any of these become true:

- Live-price traffic and stock-request traffic together regularly
  approach the 60/min Finnhub quota
- Stock-request volume exceeds ~500 submits/week sustained
- Finnhub introduces a new pricing tier change that affects our
  cost calculus
- We want to do queries the Finnhub API doesn't support (e.g.,
  "show me all eligible biotechs sorted by market cap")

---

## 2026-05-20 — Phase 2 shipped: weekly Sunday rotation

The original Phase 2 design from this ADR is now implemented.

### What ships

- **Migration `20260520000006_stock_rotations.sql`** — new audit table
  with one row per rotation event (action, ticker, votes_at_action,
  reason). Public-read RLS so future "what changed this week" UI
  surfaces can read it.

- **`pipeline/compute_stock_rotation.py`** — the rotation orchestrator.
  Implements the algorithm exactly as designed: demote candidates that
  meet BOTH conditions (zero watchlists + zero bets/30d), promote
  top-voted requests (≥3 unique-user votes) after fresh Finnhub
  validation, maintain the always-50 invariant via `swap_count =
  min(demotion, promotion)`. Idempotent — re-runs on the same day
  produce no further effect.

- **Targeted insights backfill** — after promotion, the orchestrator
  invokes `python -m pipeline.fetch_insights --ticker X` as a
  subprocess for each newly-promoted stock so Monday's data is
  computed before market open. Subprocess instead of inline import
  because (a) we get process isolation and (b) avoids refactoring
  the existing `_process_stock` private API.

- **`.github/workflows/compute-stock-rotation.yml`** — manual +
  cron-triggered workflow. 45-min timeout (covers the validation
  loop + 1-3 subprocess backfills × ~30s FinBERT cold start). Same
  HuggingFace model cache as fetch-insights so backfills are warm.

- **Cloudflare Worker cron entry: `0 12 * * SUN`** — Sunday 12:00 UTC
  (~07:00-08:00 ET DST-dependent). Runs while bets are closed, well
  before the Sunday evening compute-leaderboard run.

- **`market-schedule.ts` Sunday closure** — new `sunday-rotation`
  `CyclePhase`. `betWindowOpen` is forced `false` all day Sunday ET
  even though Friday's pipeline already produced Monday's insights.
  Saturday remains open (existing `weekend` phase). Two new vitest
  test cases lock this in.

- **`MarketScheduleBar` headline** — new "Bets paused · Universe
  rotating today" copy for the sunday-rotation phase, with a
  "Bet window reopens Monday morning" explainer.

### Decisions taken at implementation time

- **Subprocess for backfill** (vs. inline `_process_stock` call) —
  ~30s cold start per new stock, only 1-3 new stocks per week, so
  net cost is acceptable. Subprocess crash doesn't kill the
  rotation; process isolation is a real win.

- **Always-50 floor: skip promotions if not enough validate** — if
  N tickers are demotion-eligible but only M < N pass Finnhub
  validation (e.g., a former mega-cap has dropped below $2B since
  the request was made), demote only M. Universe size stays at 50.

- **`sector` defaults to "Uncategorized" for newly-promoted stocks**
  if Finnhub's `finnhubIndustry` field is missing. Sector is a
  required NOT NULL column on `stocks`; cleanup of stale "Uncategorized"
  is a follow-up sweep, not blocking.

- **Saturday stays open** — only Sunday is the closure window.
  Original intent was to give users the full Saturday to use the
  pre-locked Monday bet window; closure is purely for the rotation
  window itself.

### What stays open for follow-ups

- **Email notification when a requested stock gets promoted** — would
  ping users who voted for the ticker. Requires email infra we don't
  have yet (Resend / SendGrid). Skip until/unless real users ask.
- **Auto-add-to-watchlist on promotion** for users who requested it
  — product decision. Reasonable defaults could go either way.
- **"What changed this week" UI surface** reading from `stock_rotations`
  — would show recently-added / recently-removed stocks. Cheap to
  build; deferred to a polish pass.
- **Sector backfill for "Uncategorized" promoted stocks** — could be
  done via a monthly cleanup job that hits Finnhub's industry-mapping
  endpoint.
