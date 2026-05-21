/**
 * Pull the Google profile picture URL out of the Supabase Auth JWT claims.
 *
 * Supabase stores OAuth provider data under `user_metadata` on the JWT it
 * issues. Google's userinfo response includes `picture` (their canonical
 * field name); Supabase's auth-helpers also surface the same value under
 * `avatar_url` for convention with other providers. We check both for
 * forward-compat with any future provider migration.
 *
 * Returns `null` when the field isn't present or isn't a usable HTTPS URL —
 * the UI falls back to a single-letter initial in that case.
 */
export function avatarUrlFromClaims(
  claims: Record<string, unknown> | null | undefined,
): string | null {
  if (!claims) return null;
  const meta = (claims as { user_metadata?: Record<string, unknown> }).user_metadata;
  if (!meta || typeof meta !== "object") return null;

  // Prefer Supabase's normalized field; fall back to Google's raw `picture`.
  const raw = meta.avatar_url ?? meta.picture;
  if (typeof raw !== "string" || raw.length === 0) return null;

  // Defense-in-depth: only accept HTTPS URLs. We don't want a malformed
  // claim (or a hypothetical compromised JWT) injecting a `javascript:`
  // or `data:` URL into the avatar `<img src>`.
  if (!raw.startsWith("https://")) return null;
  return raw;
}
