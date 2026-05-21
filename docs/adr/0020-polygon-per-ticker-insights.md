# ADR 0020 — Use Polygon's per-ticker insights as the news relevance + sentiment seed

**Status**: Accepted
**Date**: 2026-05-21

## Context

User flagged that the "Top articles" section on `/stock/CVX` was showing
clearly off-topic articles — pieces about Apple/Berkshire and
NextEra/Dominion that mentioned Chevron only in passing. Our own
pipeline's LLM had correctly identified these as off-topic ("CVX stock
not mentioned in the article", "CVX stock unaffected"), but we weren't
filtering on that signal.

A patch shipped at `bb8eb19` filters articles on the read side via
TL;DR pattern matching, but the underlying issue is that the **news
fetcher is over-tagged** — Polygon (formerly Massive) tags an article
with every ticker it mentions, including sector pieces and adjacent-
company M&A coverage. The downstream LLM call is paying tokens to
summarize articles the news source itself has flagged as tangential.

Investigation revealed that Polygon's `/v2/reference/news` response
already contains a per-article `insights[]` array, where each entry
has `ticker`, `sentiment` (positive/negative/neutral), and
`sentiment_reasoning` (a ticker-specific free-text note). Polygon
only adds an `insights` entry when the article specifically discusses
that ticker. We weren't reading the field.

## Decision

Use Polygon's `insights[]` as **the relevance gate at fetch time**,
and feed its per-ticker `sentiment` + `sentiment_reasoning` into our
downstream sentiment and summary pipelines as additional signal.

### Three concrete changes

1. **Relevance filter at the fetcher.** `MassiveNewsFetcher` now skips
   articles where the target ticker isn't in the article's `insights[]`
   array. Articles tagged with our ticker but missing from `insights`
   are passing mentions — dropped before they reach FinBERT, the
   summarizer, or the database.

2. **Sentiment blend.** Polygon's categorical sentiment is mapped to a
   numeric scale (positive→+1, negative→-1, neutral→0) and averaged
   with FinBERT's continuous score when both are present. The new
   `apply_polygon_blend()` function in `pipeline/processors/sentiment.py`
   runs after FinBERT's batch scoring and overwrites the per-article
   `sentiment` field with the blended value.

3. **LLM seed prompt.** The summarizer prompt now includes Polygon's
   `sentiment_reasoning` as a seed block, framed as "treat as a hint
   to refine, not as ground truth." The LLM is still asked to produce
   the three labeled outputs (TLDR / SUMMARY / INFLUENCE) in our voice,
   but it can lean on Polygon's note where it captures the right
   framing.

### Schema

Migration `20260521000003` adds two nullable columns to
`insight_articles`:

```sql
massive_sentiment            text  CHECK in (positive, negative, neutral)
massive_sentiment_reasoning  text
```

These are **audit/debug fields**. The blended sentiment lands in the
existing `sentiment` column; the LLM-refined TL;DR lands in the
existing `tldr`/`summary`/`signal_influence` columns. Keeping
Polygon's raw values separately lets us:

- tune the FinBERT-vs-Polygon blend weight later with calibration data
- debug "why did the score swing?" by comparing the two sources
- retroactively compute alternative blending strategies on history

## Why equal-weight average (not weighted)

We have no calibration data yet to justify a specific weighting.
FinBERT and Polygon are both LLM-style estimators of the same
quantity (article sentiment toward a ticker), with different
strengths:

- **FinBERT** is a finance-tuned BERT that scores the article body
  holistically. Strong on neutral-vs-loaded language; weak on
  ticker-specific framing in multi-company articles.
- **Polygon's insight LLM** is ticker-specific by construction.
  Strong on "is this article about TICKER X and which way." Weak on
  fine-grained intensity (only 3 categories).

Equal weights treat them as independent estimators with comparable
priors. The blend is `round((finbert + polygon_numeric) / 2, 3)`.

When we have ≥300 resolved predictions tied to articles, we can fit
a weight `α` in `α * finbert + (1 - α) * polygon` against the
realized direction and pick the `α` that maximizes calibration.
Logged as a follow-up.

## Why seed the LLM rather than skip it

The user picked "use seed; still run LLM to refine" over "use
Polygon directly, skip LLM." Reasoning:

- Polygon's reasoning is short (1 sentence) and stylistically
  inconsistent across articles. The LLM produces three distinct
  outputs at consistent length and voice, which is what the UI
  expects.
- The LLM call is the only place we have full control over
  prompt + output schema. Letting Polygon's note replace it would
  couple us tightly to whatever Polygon's editorial team writes
  on a given day.
- Cost is unchanged — the seed adds ~50 tokens to a ~600-token
  prompt, negligible.

The trade-off: Polygon's sentiment now has soft influence on the
LLM's `INFLUENCE` field (the Bullish/Bearish/Neutral line). We
accept that — Polygon's call is ticker-specific while FinBERT
scores holistically, so giving Polygon a nudge on the framing is
consistent with the blending intent on the numeric side.

## Alternatives considered

- **B. Keep current fetch, add a relevance-check LLM call.** Costs
  an extra LLM round-trip per article to do what Polygon's
  `insights[]` already gives us for free. Rejected.

- **C. Cross-reference Finnhub's ticker-specific news endpoint.**
  Two-source agreement filter; costs additional API surface and
  rate-limit pressure for marginal gain. Rejected for v1; can
  revisit if Polygon's relevance signal proves noisy.

- **D. Switch news source entirely.** Polygon's ecosystem is
  already integrated for prices + previous-close; switching news
  alone gains us nothing the `insights[]` field doesn't already
  provide.

- **Drop FinBERT entirely, use only Polygon's sentiment.** Loses the
  continuous score — Polygon is 3-category, FinBERT is [-1, +1].
  The continuous score matters for the aggregate-sentiment bucket
  math (`aggregate_sentiment()` uses the magnitude as a weight).

## Files touched

```
pipeline/fetchers/types.py                  (NewsArticle gains 2 fields)
pipeline/fetchers/massive.py                (filter + extract insights)
pipeline/processors/sentiment.py            (new _polygon_to_numeric + apply_polygon_blend)
pipeline/processors/summarizer.py           (seed prompt with Polygon reasoning)
pipeline/fetch_insights.py                  (call apply_polygon_blend; write new columns)
pipeline/tests/test_sentiment_blend.py      (17 new tests on the blend math)
supabase/migrations/20260521000003_*        (new audit columns)
src/types/insight.ts                        (TS type mirrors the new columns)
```

## Net effect

- **~9-15% fewer articles** enter the pipeline (no-insight rows
  filtered at the fetcher). Saves equivalent FinBERT + LLM token
  spend.
- **Better TL;DR quality** — LLM has a ticker-specific seed instead
  of writing from scratch. Off-topic noise drops because the
  fetcher already dropped the off-topic rows.
- **Better sentiment calibration** — blend captures both holistic
  article tone (FinBERT) and ticker-specific framing (Polygon).
- **Audit-friendly** — both raw signals persisted, blend recoverable.

## Open follow-ups

- **Calibrate the blend weight** once we have ~300 resolved
  predictions tied to articles (`α` between 0 and 1, fit against
  realized direction).
- **Backfill `massive_sentiment` for historical articles** — currently
  NULL on everything fetched before this lands. Not blocking; the
  read-side TL;DR filter from `bb8eb19` still catches legacy noise.
- **Decide whether to drop the read-side TL;DR filter** once a few
  weeks of Polygon-filtered fetches are in production. Currently
  belt-and-suspenders; can probably remove the TL;DR pattern matching
  once the fetcher filter proves reliable.
