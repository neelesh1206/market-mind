-- ============================================================================
-- Promo-code redemption — ADR 0019.
--
-- Lets users add credits by redeeming campaign codes (e.g. LAUNCH2026). Each
-- code is a shared string anyone can redeem once. Per-user daily cap of
-- 1000 credits/day (calendar ET day) caps abuse.
--
-- Schema:
--   promo_codes              — admin-curated catalog (writes via service role)
--   promo_code_redemptions   — append-only per-(code, user) ledger of redemptions
--
-- Flow:
--   1. Admin creates a code via /admin/codes (server action → service-role insert)
--   2. User enters the code in the credits dialog
--   3. Server action → redeem_promo_code RPC (SECURITY DEFINER) → atomic:
--        - validate code (exists, active, not expired, redeem_count < max)
--        - check user hasn't redeemed it (unique constraint backs this up)
--        - check daily cap (sum of today's redemptions + this code's credits <= 1000)
--        - insert redemption row, bump redeem_count, increment balance, write ledger row
-- ============================================================================

-- ----------------------------------------------------------------------------
-- promo_codes — admin-curated catalog
-- ----------------------------------------------------------------------------
create table public.promo_codes (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null
                  check (code = upper(code) and code ~ '^[A-Z0-9-]{4,32}$'),
  credits         integer not null check (credits > 0 and credits <= 1000),
  description     text,
  max_redemptions integer check (max_redemptions is null or max_redemptions > 0),
  redeem_count    integer not null default 0,
  expires_at      timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  created_by      uuid references auth.users(id) on delete set null
);

create index promo_codes_active_idx on public.promo_codes (code) where is_active;

-- ----------------------------------------------------------------------------
-- promo_code_redemptions — per-(code, user) ledger
-- ----------------------------------------------------------------------------
create table public.promo_code_redemptions (
  id          uuid primary key default gen_random_uuid(),
  code_id     uuid not null references public.promo_codes(id) on delete restrict,
  user_id     uuid not null references auth.users(id) on delete cascade,
  credits     integer not null check (credits > 0),
  redeemed_at timestamptz not null default now(),
  unique (code_id, user_id)
);

-- Powers the daily-cap "sum credits redeemed today" query.
create index promo_redemptions_user_day_idx
  on public.promo_code_redemptions (user_id, redeemed_at desc);

-- ----------------------------------------------------------------------------
-- RLS — deny-all by default; redemption rows are own-read for history display
-- ----------------------------------------------------------------------------
alter table public.promo_codes              enable row level security;
alter table public.promo_code_redemptions   enable row level security;

-- promo_codes: no client-side access. Reads happen via the SECURITY DEFINER
-- RPC; admin writes use the service-role key (bypasses RLS).
-- (Intentionally no policies — deny-all.)

-- promo_code_redemptions: users can read their own redemption history so the
-- credits dialog can show "Recent redemptions". Writes only via RPC.
create policy "promo_redemptions_own_read" on public.promo_code_redemptions
  for select using (user_id = auth.uid());

-- ============================================================================
-- redeem_promo_code RPC — atomic redemption
--
-- Caller passes p_today_date computed in ET (same pattern as claim_daily_bonus)
-- so the daily-cap window is timezone-correct regardless of server locale.
--
-- Errors (errcode P0001 unless noted):
--   not_authenticated     — no auth.uid() (errcode 42501)
--   profile_missing       — user has no user_profiles row
--   not_found             — code doesn't exist
--   inactive              — is_active = false
--   expired               — expires_at < now()
--   exhausted             — redeem_count >= max_redemptions
--   already_redeemed      — user already redeemed this code
--   daily_cap_exceeded    — would push user over 1000/day. Detail includes headroom.
-- ============================================================================

create or replace function public.redeem_promo_code(
  p_code        text,
  p_today_date  date
)
returns table (
  credits_awarded   integer,
  new_balance       integer,
  daily_used        integer,
  daily_remaining   integer
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id        uuid := auth.uid();
  v_code           public.promo_codes;
  v_profile        public.user_profiles;
  v_normalized     text;
  v_already        boolean;
  v_daily_used     integer;
  v_new_balance    integer;
  v_daily_cap      constant integer := 1000;
begin
  if v_user_id is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  v_normalized := upper(trim(p_code));
  if v_normalized !~ '^[A-Z0-9-]{4,32}$' then
    raise exception 'not_found' using errcode = 'P0001';
  end if;

  -- Lock the code row to prevent two redemptions racing redeem_count past max.
  select * into v_code
    from public.promo_codes
   where code = v_normalized
   for update;

  if v_code.id is null then
    raise exception 'not_found' using errcode = 'P0001';
  end if;
  if not v_code.is_active then
    raise exception 'inactive' using errcode = 'P0001';
  end if;
  if v_code.expires_at is not null and v_code.expires_at < now() then
    raise exception 'expired' using errcode = 'P0001';
  end if;
  if v_code.max_redemptions is not null
     and v_code.redeem_count >= v_code.max_redemptions then
    raise exception 'exhausted' using errcode = 'P0001';
  end if;

  -- Has this user already redeemed it? The unique constraint backstops this,
  -- but we check explicitly to return a clean error before the insert.
  select exists(
    select 1 from public.promo_code_redemptions
     where code_id = v_code.id and user_id = v_user_id
  ) into v_already;
  if v_already then
    raise exception 'already_redeemed' using errcode = 'P0001';
  end if;

  -- Daily-cap check. Sum credits redeemed today, in ET. Atomic-or-nothing:
  -- if this code would push the user past the cap, reject — don't partial-grant.
  select coalesce(sum(credits), 0)
    into v_daily_used
    from public.promo_code_redemptions
   where user_id = v_user_id
     and (redeemed_at at time zone 'America/New_York')::date = p_today_date;

  if v_daily_used + v_code.credits > v_daily_cap then
    raise exception 'daily_cap_exceeded' using errcode = 'P0001';
  end if;

  -- Lock the user profile and grant credits.
  select * into v_profile
    from public.user_profiles
   where id = v_user_id
   for update;
  if v_profile.id is null then
    raise exception 'profile_missing' using errcode = 'P0001';
  end if;

  v_new_balance := v_profile.credit_balance + v_code.credits;

  -- Write all four side-effects in one transaction.
  insert into public.promo_code_redemptions (code_id, user_id, credits)
  values (v_code.id, v_user_id, v_code.credits);

  update public.promo_codes
     set redeem_count = redeem_count + 1
   where id = v_code.id;

  update public.user_profiles
     set credit_balance = v_new_balance
   where id = v_user_id;

  insert into public.credit_transactions (
    user_id, amount, type, reference_id, balance_after
  )
  values (
    v_user_id, v_code.credits, 'PROMO_CODE', v_code.id, v_new_balance
  );

  return query
    select v_code.credits,
           v_new_balance,
           v_daily_used + v_code.credits,
           v_daily_cap - (v_daily_used + v_code.credits);
end;
$$;

revoke all on function public.redeem_promo_code(text, date) from public;
grant execute on function public.redeem_promo_code(text, date) to authenticated;

comment on function public.redeem_promo_code(text, date) is
  'Redeem a campaign promo code. Atomic; caps user inflow at 1000 credits per ET calendar day.';
