/**
 * Wilson score confidence interval for a binomial proportion.
 *
 * Why Wilson rather than the normal-approximation interval (`p ± z·√(p(1-p)/n)`):
 *
 *   - The normal approximation is symmetric around `p`, which breaks badly when
 *     `p` is near 0 or 1 (it produces lower bounds below 0 or upper bounds
 *     above 1).
 *   - It also misbehaves at small `n` — the canonical small-sample failure
 *     mode that confidence intervals are supposed to *fix*.
 *
 * The Wilson interval handles both: it's bounded to [0, 1], it doesn't pull
 * apart at p = 0/1, and it's the default published in stats packages
 * (scipy.stats.binom_test, statsmodels.stats.proportion.proportion_confint
 * method='wilson', R's binom.test).
 *
 * Reference: Wilson, "Probable inference, the law of succession, and
 * statistical inference" (1927). Modern derivation in Brown, Cai &
 * DasGupta, "Interval Estimation for a Binomial Proportion" (2001).
 */

/** z-score for a two-sided 95% confidence interval. */
export const Z_95 = 1.959964; // 1.96 to 6 sig figs

export type WilsonInterval = {
  /** Lower bound, in [0, 1]. */
  lower: number;
  /** Upper bound, in [0, 1]. */
  upper: number;
  /** Wilson-adjusted center (not the raw `correct/total` — this is the
   *  midpoint of the interval, which differs slightly from the point
   *  estimate especially at small N). */
  center: number;
};

/**
 * Wilson score interval for `correct` successes out of `total` trials.
 *
 * Returns lower/upper in [0, 1]. Defaults to a 95% interval (z = 1.96).
 *
 * Edge cases:
 *   - `total = 0`     → returns [0, 1] (no information; could be anything)
 *   - `correct = 0`   → lower bound is 0, upper bound shrinks toward 0 as n grows
 *   - `correct = total` → upper bound is 1, lower bound grows toward 1 as n grows
 */
export function wilsonInterval(
  correct: number,
  total: number,
  z: number = Z_95,
): WilsonInterval {
  if (total <= 0) {
    return { lower: 0, upper: 1, center: 0.5 };
  }
  const p = correct / total;
  const z2 = z * z;
  const denom = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total))) / denom;
  return {
    lower: Math.max(0, center - margin),
    upper: Math.min(1, center + margin),
    center,
  };
}

/**
 * Convenience: human-readable Wilson CI as a string like "47–67%".
 * Returns null when total = 0 (caller should hide the chip in that case).
 */
export function formatWilsonRange(correct: number, total: number): string | null {
  if (total <= 0) return null;
  const { lower, upper } = wilsonInterval(correct, total);
  return `${Math.round(lower * 100)}–${Math.round(upper * 100)}%`;
}
