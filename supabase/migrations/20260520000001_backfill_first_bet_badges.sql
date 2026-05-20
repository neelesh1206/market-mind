-- Backfill FIRST_BET badges for users who placed their first bet before
-- the badges migration (20260519000007_badges.sql) landed in production.
--
-- Why this is needed:
--   `place_bet()` awards FIRST_BET only on the insert where
--   `v_total_after = 1` — i.e. the user's very first prediction. That's
--   correct logic going forward, but any user whose first bet pre-dates
--   the badges migration has no way to earn this badge retroactively
--   through normal play (their next bet has v_total_after >= 2). The
--   badges migration was add-only and didn't include a backfill, so
--   "early-tester" users sit there forever with predictions but no
--   FIRST_BET. This patches that gap.
--
-- Idempotent: `on conflict (user_id, badge_type) do nothing` short-circuits
-- when a user already has the badge — so running this migration twice (or
-- after future users also pre-existed somehow) is safe.
--
-- One-time data fix; no schema change, no rollback needed.

insert into public.user_badges (user_id, badge_type, metadata)
select
  p.user_id,
  'FIRST_BET',
  jsonb_build_object(
    'prediction_id', (
      -- Stamp the badge with the actual first prediction so the metadata
      -- mirrors what a non-backfilled FIRST_BET row would carry.
      select id from public.predictions
      where user_id = p.user_id
      order by created_at asc
      limit 1
    ),
    'backfilled_at', now(),
    'reason', 'placed first bet before badges migration applied'
  )
from public.predictions p
group by p.user_id
on conflict (user_id, badge_type) do nothing;
