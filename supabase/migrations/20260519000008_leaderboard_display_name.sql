-- ============================================================================
-- Leaderboard: denormalize display_name at snapshot time.
--
-- Without this, the leaderboard page can't show names: user_profiles is
-- RLS-scoped to own_read, so a logged-in user's auth-context client can't
-- read other users' profile rows. Options were:
--   (a) Extend user_profiles RLS with a public_read on display_name only —
--       complicates the trust boundary on a sensitive table.
--   (b) Read via service-role from a server route — works but pushes name
--       resolution onto every page render.
--   (c) Denormalize at snapshot time — fixes the name at the moment of the
--       snapshot, which is actually correct semantically (last week's
--       leaderboard should reflect last week's names).
--
-- (c) wins on simplicity + correctness. The cron has service-role access
-- and already iterates over users to compute the snapshot; one extra field
-- per insert is free.
-- ============================================================================

alter table public.weekly_leaderboard_snapshots
  add column if not exists display_name text;

comment on column public.weekly_leaderboard_snapshots.display_name is
  'Denormalized at snapshot time so the leaderboard render path doesn''t need to read user_profiles (own_read RLS).';
