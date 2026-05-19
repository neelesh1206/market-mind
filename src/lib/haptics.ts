/**
 * Tiny haptic-feedback wrapper around `navigator.vibrate`.
 *
 * No-ops when:
 *   - SSR (no `navigator`)
 *   - Browser doesn't expose `vibrate` (iOS Safari, desktop, most non-mobile)
 *   - User prefers reduced motion (a11y guardrail)
 *
 * Patterns are tuned to be felt-but-not-annoying. iOS doesn't support the
 * Vibration API at all (Apple's stance), so this is best-effort polish that
 * only fires for Android users. That's fine — it's a delight beat, not a
 * critical UX path.
 */

export type HapticPattern = "tap" | "success" | "warning" | "double";

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 12, // single short pulse — bet placed, button confirms
  success: [12, 40, 24], // pulse-pause-pulse — win reveal, bonus claim
  warning: [20, 60, 20, 60, 20], // longer triple-pulse — cancel confirm, errors
  double: [10, 30, 10], // soft confirm — toggle, secondary action
};

let warnedReducedMotion = false;

export function haptic(pattern: HapticPattern = "tap"): void {
  if (typeof window === "undefined") return; // SSR
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;

  // Respect prefers-reduced-motion. matchMedia is the source of truth and
  // also covers the case where the user toggles the setting mid-session.
  const reduced =
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  if (reduced) {
    if (!warnedReducedMotion && process.env.NODE_ENV === "development") {
      console.info("[haptics] suppressed by prefers-reduced-motion");
      warnedReducedMotion = true;
    }
    return;
  }

  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Some browsers throw on certain pattern shapes — silently swallow.
    // This is non-critical polish; we never want to surface an error here.
  }
}
