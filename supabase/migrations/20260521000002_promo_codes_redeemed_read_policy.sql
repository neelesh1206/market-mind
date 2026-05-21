-- ============================================================================
-- Bug fix: dialog's "Recent redemptions" list came back empty even though
-- redemption rows existed in promo_code_redemptions.
--
-- Root cause: the listing query joins promo_codes!inner(code) to get the
-- human-readable code string. `promo_codes` had deny-all RLS (no policies),
-- so the inner join filtered out every row for the authenticated caller.
--
-- Fix: narrow SELECT policy that lets a user read a promo_codes row IFF
-- they have at least one redemption against it. Users still cannot enumerate
-- the catalog (admin-only via service-role); they can only see code text
-- they themselves have already redeemed.
-- ============================================================================

create policy "promo_codes_redeemed_read" on public.promo_codes
  for select
  using (
    exists (
      select 1 from public.promo_code_redemptions
      where code_id = promo_codes.id
        and user_id = auth.uid()
    )
  );
