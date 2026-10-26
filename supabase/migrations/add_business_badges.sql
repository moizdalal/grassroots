-- Business trust badges for the marketplace card and listing detail.
--
-- Badges (moiz, 2026-10-25). Each is earned from payment data, never set
-- by hand. Rolling badges look at the last 90 days and lapse on their own.
--   * active_client  — a payment released in the last 90 days.         rolling
--   * quick_approver — median delivered → released under 3 days,
--                      across 2+ engagements in the last 90 days.      rolling
--   * clear_scope    — 2+ engagements released in the last 90 days and
--                      no support hold or refund in that window.       rolling
--                      Switches to the student scope-clarity rating
--                      once business reviews ship.
--   * repeat_client  — paid 2+ different students, or rehired one
--                      student on a second listing.                    permanent
--
-- A business with no row back has never released a payment; the client
-- renders that as "New".
--
-- Read-only aggregate. SECURITY DEFINER because anon and consultants
-- can't read other people's bids or payment rows under rls_lockdown.sql.
-- It returns counts and booleans only, never a payment row, amount or
-- counterparty id.
--
-- Do not apply without moiz's approval.

begin;

create or replace function public.get_business_badges(target_owner_ids uuid[])
returns table (
  owner_id uuid,
  students_paid int,
  engagements_paid int,
  last_release_at timestamptz,
  median_approval_days numeric,
  active_client boolean,
  quick_approver boolean,
  clear_scope boolean,
  repeat_client boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with owners as (
    -- Cap the batch so the marketplace can't be used to scan every owner.
    select distinct o as owner_id
    from unnest(target_owner_ids[1:200]) as o
  ),
  payments as (
    -- One row per payment (standard bid or phase row), released or not.
    select l.owner_id, b.id as bid_id, b.consultant_id, b.listing_id,
           b.payment_status as status, b.paid_at, b.released_at,
           b.delivered_at, b.support_hold_at, b.refunded_cents
    from public.bids b
    join public.listings l on l.id = b.listing_id
    join owners o on o.owner_id = l.owner_id
    union all
    select l.owner_id, b.id, b.consultant_id, b.listing_id,
           p.status, p.paid_at, p.released_at,
           p.delivered_at, p.support_hold_at, p.refunded_cents
    from public.bid_phase_payments p
    join public.bids b on b.id = p.bid_id
    join public.listings l on l.id = b.listing_id
    join owners o on o.owner_id = l.owner_id
  ),
  released as (
    select * from payments
    where status = 'released' and released_at is not null
  ),
  totals as (
    select owner_id,
           count(distinct consultant_id)::int as students_paid,
           count(distinct bid_id)::int as engagements_paid,
           max(released_at) as last_release_at,
           count(distinct bid_id) filter (
             where released_at > now() - interval '90 days'
           )::int as recent_engagements
    from released
    group by owner_id
  ),
  approval as (
    select owner_id,
           round((percentile_cont(0.5) within group (
             order by extract(epoch from (released_at - delivered_at)) / 86400
           ))::numeric, 1) as median_days,
           count(distinct bid_id)::int as samples
    from released
    where delivered_at is not null
      and released_at >= delivered_at
      and released_at > now() - interval '90 days'
    group by owner_id
  ),
  disputes as (
    select owner_id, count(*)::int as n
    from payments
    where support_hold_at > now() - interval '90 days'
       or (refunded_cents > 0 and paid_at > now() - interval '90 days')
    group by owner_id
  ),
  rehires as (
    select owner_id
    from released
    group by owner_id, consultant_id
    having count(distinct listing_id) >= 2
  )
  select t.owner_id,
         t.students_paid,
         t.engagements_paid,
         t.last_release_at,
         a.median_days,
         t.last_release_at > now() - interval '90 days',
         coalesce(a.samples >= 2 and a.median_days < 3, false),
         t.recent_engagements >= 2 and coalesce(d.n, 0) = 0,
         t.students_paid >= 2 or exists (select 1 from rehires r where r.owner_id = t.owner_id)
  from totals t
  left join approval a on a.owner_id = t.owner_id
  left join disputes d on d.owner_id = t.owner_id;
$$;

revoke all on function public.get_business_badges(uuid[]) from public;
grant execute on function public.get_business_badges(uuid[]) to anon, authenticated;

commit;
