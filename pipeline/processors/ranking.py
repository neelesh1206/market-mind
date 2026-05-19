"""Cross-sectional ranking — see ADR 0015.

The verdict score in isolation says how strong the signal is for one
stock; the rank says how strong it is *relative to today's universe*.
Top quintile vs bottom quintile is the unit of information that
actually translates to a long-short factor framework.

Pure-math helper kept out of `fetch_insights.py` so tests can import
it without dragging in dotenv / supabase / huggingface deps.
"""
from __future__ import annotations

from typing import Any


def rank_predictions(
    rows: list[dict[str, Any]],
) -> list[tuple[str, int, float, str | None]]:
    """Assign ranks 1..N over `combined_score` (descending).

    Input rows match the shape Supabase returns from a query joining
    `marketmind_predictions` with `stocks(ticker)`:

        {"id": "...", "combined_score": 0.42, "stocks": {"ticker": "NVDA"}}

    Rows with NULL or missing `combined_score` are dropped — they can't
    be ordered against the rest of the universe.

    Output: list of `(row_id, rank, combined_score, ticker)` tuples
    where rank 1 = strongest bullish (highest combined_score).
    Python's sort is stable, so ties resolve by input order — useful
    for deterministic ranks across re-runs against the same data.
    """
    scored = [
        (
            r["id"],
            float(r["combined_score"]),
            ((r.get("stocks") or {}).get("ticker")),
        )
        for r in rows
        if r.get("combined_score") is not None
    ]
    scored.sort(key=lambda t: t[1], reverse=True)
    return [
        (row_id, rank, score, ticker)
        for rank, (row_id, score, ticker) in enumerate(scored, start=1)
    ]
