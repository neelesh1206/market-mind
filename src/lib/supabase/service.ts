import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./env";

/**
 * Service-role Supabase client — bypasses RLS. SERVER-ONLY.
 *
 * Use sparingly. Two legitimate cases in this codebase:
 *   1. Admin operations that need to write to RLS-locked-down tables
 *      (e.g. `promo_codes` has no client-side write policy; admin creates
 *      go through this client).
 *   2. Reading tables that have no read policy for the caller's role
 *      (e.g. admin listing all promo codes including inactive ones).
 *
 * SUPABASE_SERVICE_KEY must be set in the server environment. (Variable
 * name matches the existing convention used by the Python pipeline — same
 * underlying Supabase service-role secret.) Because it has no
 * NEXT_PUBLIC_ prefix, Next.js will refuse to inline it into the browser
 * bundle — a client component that imports this module would crash at
 * runtime when reaching process.env (which becomes undefined). Still,
 * only call createAdminClient() from "use server" modules or server
 * components.
 */
export function createAdminClient() {
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!key) {
    throw new Error(
      "Missing SUPABASE_SERVICE_KEY in server env. " +
        "Admin operations require the Supabase service-role key.",
    );
  }
  return createSupabaseClient(SUPABASE_URL, key, {
    auth: {
      // Service-role clients never need session persistence — they're
      // ephemeral per-request and have no user context.
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
