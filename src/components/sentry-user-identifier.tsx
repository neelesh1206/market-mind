"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/client";

/**
 * Tags Sentry events with the current Supabase user (id + email) once auth
 * resolves on the client. Subscribes to auth state changes so a sign-out
 * clears the user, and a fresh sign-in tags the new identity without a
 * full page reload.
 *
 * Mounted once in the root layout — invisible, no DOM output. No-ops when
 * Sentry isn't configured (DSN unset).
 */
export function SentryUserIdentifier() {
  useEffect(() => {
    // No-op when Sentry isn't initialized — checking the hub avoids importing
    // an unused side-effect bundle.
    if (typeof Sentry.getCurrentScope !== "function") return;

    const supabase = createClient();

    let cancelled = false;

    void (async () => {
      const { data } = await supabase.auth.getUser();
      if (cancelled) return;
      const user = data.user;
      if (user) {
        Sentry.setUser({ id: user.id, email: user.email ?? undefined });
      } else {
        Sentry.setUser(null);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      if (u) {
        Sentry.setUser({ id: u.id, email: u.email ?? undefined });
      } else {
        Sentry.setUser(null);
      }
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}
