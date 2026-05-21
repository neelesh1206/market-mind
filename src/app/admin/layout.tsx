import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { isAdminEmail } from "@/lib/admin";

export const metadata = {
  title: "Admin",
  // Don't index admin routes.
  robots: { index: false, follow: false },
};

/**
 * Admin layout — gates every route under /admin via the ADMIN_EMAILS
 * env var allowlist. Non-admins are redirected to /; unauthenticated
 * users go to /login.
 *
 * The guard runs server-side on every request to /admin/* because
 * layouts re-render on navigation. Don't add `force-static` here — that
 * would cache the redirect decision.
 */
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/admin/codes");
  }
  if (!isAdminEmail(user.email)) {
    redirect("/");
  }

  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="border-border/60 sticky top-0 z-30 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="text-muted-foreground hover:text-foreground text-sm transition-colors"
            >
              ← Back to app
            </Link>
            <span className="text-muted-foreground/60">/</span>
            <span className="text-foreground text-sm font-semibold">Admin</span>
          </div>
          <span className="border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-md border px-2 py-0.5 text-[10px] font-semibold tracking-wider uppercase">
            Admin
          </span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-8">{children}</main>
    </div>
  );
}
