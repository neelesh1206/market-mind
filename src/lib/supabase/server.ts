import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env";

/**
 * Server-side Supabase client for Server Components, Server Actions, and Route Handlers.
 *
 * In Server Components, cookie writes are no-ops (Next forbids mutating cookies during render).
 * The proxy (`src/proxy.ts`) is responsible for keeping the session fresh across navigations.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Setting cookies from a Server Component is forbidden — safe to swallow.
          // The proxy will refresh the session on the next request.
        }
      },
    },
  });
}
