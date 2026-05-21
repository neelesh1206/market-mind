/**
 * Admin gating via the ADMIN_EMAILS env var.
 *
 * Single-tenant by design — set ADMIN_EMAILS to a comma-separated list of
 * the founder's / admin's emails. Layout guards and server actions both
 * route through `isAdminEmail` before exposing admin functionality.
 *
 * Why env-var instead of a DB role column:
 *   - At one-admin scale, a role column is over-engineering — it adds a
 *     migration, role-management UI, and a SECURITY DEFINER is_admin() RPC
 *     to use from RLS. None of those earn their keep yet.
 *   - The allowlist lives in Vercel env + GH Actions secrets, so changes
 *     are auditable via your secret-management workflow.
 *   - When we eventually have multiple admins or need per-permission
 *     scoping, the migration to a role column is a 30-min job.
 *
 * Email comparison is case-insensitive and whitespace-trimmed; Supabase
 * normalizes emails to lowercase on signup so practical lookups always
 * match, but we defensively lowercase here too.
 */

function adminEmails(): Set<string> {
  const raw = process.env.ADMIN_EMAILS ?? "";
  return new Set(
    raw
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().has(email.trim().toLowerCase());
}
