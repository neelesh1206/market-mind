import { createAdminClient } from "@/lib/supabase/service";
import { fetchAllPromoCodes } from "@/lib/promo-codes";
import { CodesAdminPanel } from "@/components/codes-admin-panel";

export const metadata = {
  title: "Promo codes · Admin",
};

// No caching — the page lists live state (redeem_count, is_active) that
// changes whenever a user redeems or the admin deactivates.
export const dynamic = "force-dynamic";

export default async function AdminCodesPage() {
  const admin = createAdminClient();
  const codes = await fetchAllPromoCodes(admin);

  return (
    <div className="space-y-8">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Promo codes</h1>
        <p className="text-muted-foreground text-sm">
          Create campaign codes for launches, collaborator drops, and incident make-goods. Each
          code is redeemable once per account; per-user inflow is capped at 1,000 credits/day.
        </p>
      </header>

      <CodesAdminPanel initialCodes={codes} />
    </div>
  );
}
