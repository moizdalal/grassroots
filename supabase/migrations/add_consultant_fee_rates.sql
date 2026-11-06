-- Fixed platform fee rates, for consultants who don't pay the 30% to 5%
-- ladder. Everyone with a row here keeps that rate; everyone else is on the
-- ladder, worked out from their reviews in lib/consultant-fee.js.
--
-- This is its own table because consultants can edit their own profile rows,
-- and a fee must never be something a consultant can set. Only the service
-- role can read or write it.
--
-- Apply this BEFORE deploying the code that reads it. Without the table,
-- charges fail rather than guess at a fee.

create table if not exists public.consultant_fee_rates (
  consultant_id uuid primary key references public.profiles(id) on delete cascade,
  platform_fee_bps integer not null check (platform_fee_bps in (500, 1000, 1500, 2000, 2500, 3000)),
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.consultant_fee_rates enable row level security;

revoke all on public.consultant_fee_rates from anon;
revoke all on public.consultant_fee_rates from authenticated;
grant all on public.consultant_fee_rates to service_role;

-- Consultants who joined before the ladder keep 5%, so nobody's fee goes up.
insert into public.consultant_fee_rates (consultant_id, platform_fee_bps, reason)
select id, 500, 'joined before the fee ladder'
from public.profiles
where role = 'consultant'
on conflict (consultant_id) do nothing;
