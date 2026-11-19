-- Business badges: drop Clear scope, add No disputes (Brady, 2026-11-10).
--
-- Replaces get_business_badges from add_business_badges.sql. Same rules
-- for active_client, quick_approver and repeat_client. Changes:
--   * clear_scope is gone. Student scope ratings (business_reviews) stay;
--     they just no longer earn a badge.
--   * no_disputes — at least 3 released payments, and no payment of this
--     business was ever reported as a problem or refunded, in part or in
--     full.                                                       permanent,
--                                                      until one goes wrong
--
-- "Reported" reads problem_report_count, which never resets.
-- support_hold_at isn't used because support clears it after deciding.
-- Card disputes opened at the bank aren't stored in the database, so
-- they don't count here yet. Until add_support_outcomes.sql is applied
-- the report check is skipped and only refunds count.
--
-- The return type changes, so the old function is dropped first. Ship
-- this with the business-badges.js change that reads no_disputes.
-- Do not apply without moiz's approval.

begin;

drop function if exists public.get_business_badges(uuid[]);

create function public.get_business_badges(target_owner_ids uuid[])
returns table (
  owner_id uuid,
  students_paid int,
  engagements_paid int,
  last_release_at timestamptz,
  median_approval_days numeric,
  active_client boolean,
  quick_approver boolean,
  no_disputes boolean,
  repeat_client boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  -- problem_report_count comes from add_support_outcomes.sql. Without it,
  -- read 0 so refunds alone decide.
  bid_reports text := '0';
  phase_reports text := '0';
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'bids' and column_name = 'problem_report_count') then
    bid_reports := 'coalesce(b.problem_report_count, 0)';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'bid_phase_payments' and column_name = 'problem_report_count') then
    phase_reports := 'coalesce(p.problem_report_count, 0)';
  end if;

  return query execute format($q$
    with owners as (
      -- Cap the batch so the marketplace can't be used to scan every owner.
      select distinct o as owner_id
      from unnest($1[1:200]) as o
    ),
    payments as (
      -- One row per payment (standard bid or phase row), released or not.
      select l.owner_id, b.id as bid_id, b.consultant_id, b.listing_id,
             b.payment_status as status, b.paid_at, b.released_at,
             b.delivered_at, b.refunded_cents, %s as report_count
      from public.bids b
      join public.listings l on l.id = b.listing_id
      join owners o on o.owner_id = l.owner_id
      union all
      select l.owner_id, b.id, b.consultant_id, b.listing_id,
             p.status, p.paid_at, p.released_at,
             p.delivered_at, p.refunded_cents, %s
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
             count(*)::int as payments_released,
             max(released_at) as last_release_at
      from released
      group by owner_id
    ),
    troubled as (
      -- Any payment that was ever reported or refunded, released or not.
      select distinct owner_id
      from payments
      where report_count > 0
         or coalesce(refunded_cents, 0) > 0
         or status = 'refunded'
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
           t.payments_released >= 3
             and not exists (select 1 from troubled tr where tr.owner_id = t.owner_id),
           t.students_paid >= 2
             or exists (select 1 from rehires r where r.owner_id = t.owner_id)
    from totals t
    left join approval a on a.owner_id = t.owner_id
  $q$, bid_reports, phase_reports)
  using target_owner_ids;
end;
$fn$;

revoke all on function public.get_business_badges(uuid[]) from public;
grant execute on function public.get_business_badges(uuid[]) to anon, authenticated;

commit;
