import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * OAuth callback handler. Exchanges the OAuth code for a Supabase session.
 *
 * Supabase redirects here after Google Sign-In with `?code=...`.
 * We complete the PKCE flow, set the session cookie, and forward the user
 * to the original destination (or "/").
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }

  // Auth failed or no code present — bounce back to login with an error flag.
  return NextResponse.redirect(new URL("/login?error=oauth", url.origin));
}
