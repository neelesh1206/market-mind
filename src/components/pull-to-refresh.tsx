"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/haptics";

const PULL_THRESHOLD = 70; // px the user must drag past before refresh fires
const MAX_INDICATOR_OFFSET = 80; // visual cap for the pull amount
const RESISTANCE = 2.5; // higher = harder pull (matches iOS native feel)

/**
 * Mobile-only pull-to-refresh. Wraps the page content; when the user drags
 * down from `scrollTop === 0`, a small spinner descends from the top. Past
 * the threshold, calling `router.refresh()` re-fetches the server component
 * tree (which on Next 16 re-runs the page's data-fetching).
 *
 * Why a custom hook over a library:
 *   - It's ~60 lines of touch handling
 *   - We need haptic + router.refresh integration, not a generic library
 *   - Avoids another dep + bundle bloat
 *
 * Desktop / non-touch: completely inert. The `pointerType === "touch"`
 * check on the initial pointerdown gates everything else, so mice + trackpads
 * never trigger.
 *
 * a11y: pull-to-refresh has no keyboard equivalent — that's fine because
 * Next.js auto-refreshes via revalidatePath after mutations, and users can
 * always reload the page in the browser. This is purely additive mobile
 * polish.
 */
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef<number | null>(null);
  const armed = useRef(false);
  const hapticFiredAtThreshold = useRef(false);

  useEffect(() => {
    function onPointerDown(e: PointerEvent) {
      // Touch only — mice/pens are excluded.
      if (e.pointerType !== "touch") return;
      // Only arm when scrolled to the top. Mid-page drags must scroll, not refresh.
      if (window.scrollY > 0) return;
      startY.current = e.clientY;
      armed.current = true;
      hapticFiredAtThreshold.current = false;
    }

    function onPointerMove(e: PointerEvent) {
      if (!armed.current || startY.current === null) return;
      const dy = e.clientY - startY.current;
      if (dy <= 0) {
        // Upward drag — disarm so a downward drag mid-pull doesn't re-trigger.
        setPull(0);
        return;
      }
      // Apply resistance + cap. Feels closer to native iOS pull.
      const damped = Math.min(dy / RESISTANCE, MAX_INDICATOR_OFFSET);
      setPull(damped);

      // Single haptic tick when we first cross the threshold — signals
      // "release now to refresh" feedback like iOS does.
      if (damped >= PULL_THRESHOLD && !hapticFiredAtThreshold.current) {
        haptic("tap");
        hapticFiredAtThreshold.current = true;
      } else if (damped < PULL_THRESHOLD && hapticFiredAtThreshold.current) {
        // User pulled back below threshold; re-arm so they get the tick
        // again if they re-cross it.
        hapticFiredAtThreshold.current = false;
      }
    }

    function onPointerEnd() {
      if (!armed.current) return;
      armed.current = false;
      const triggered = pull >= PULL_THRESHOLD;
      startY.current = null;

      if (triggered) {
        setRefreshing(true);
        haptic("success");
        router.refresh();
        // Spinner shows for ~500ms then snaps back; router.refresh streams
        // the new RSC tree but doesn't expose a "done" callback we can await.
        // A short timeout keeps the indicator feeling crisp without lying
        // about how long the refresh took.
        setTimeout(() => {
          setRefreshing(false);
          setPull(0);
        }, 500);
      } else {
        // Below threshold — snap back without doing anything.
        setPull(0);
      }
    }

    window.addEventListener("pointerdown", onPointerDown, { passive: true });
    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("pointerup", onPointerEnd, { passive: true });
    window.addEventListener("pointercancel", onPointerEnd, { passive: true });
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerEnd);
      window.removeEventListener("pointercancel", onPointerEnd);
    };
  }, [pull, router]);

  const visible = pull > 6 || refreshing;
  const offset = refreshing ? PULL_THRESHOLD : pull;
  const progress = Math.min(pull / PULL_THRESHOLD, 1);

  return (
    <>
      {/* Indicator. Fixed-position so it overlays whatever's at the top of
          the viewport without shifting the layout. */}
      <div
        aria-hidden
        className={cn(
          "pointer-events-none fixed top-0 right-0 left-0 z-40 flex justify-center",
          "transition-opacity duration-150",
          visible ? "opacity-100" : "opacity-0",
        )}
        style={{ transform: `translateY(${offset - 50}px)` }}
      >
        <div className="bg-card/90 border-border/60 mt-2 flex h-10 w-10 items-center justify-center rounded-full border shadow-lg backdrop-blur">
          <RefreshCw
            className={cn(
              "h-4 w-4 text-emerald-500 transition-transform",
              refreshing && "animate-spin",
            )}
            style={
              refreshing
                ? undefined
                : { transform: `rotate(${progress * 270}deg)` }
            }
          />
        </div>
      </div>
      {children}
    </>
  );
}
