-- Delivery-anchored release (replaces 30-days-from-charge auto-release).
--
-- Rules (moiz, 2026-10-21):
--   * One-time jobs and phased service fees: the consultant marks the work
--     delivered. The owner has 14 days to release, request changes, or
--     contact support; after that the payment releases automatically.
--     Owner gets an in-app heads-up on day 7.
--   * Retainer periods: the 14-day window opens at the end of each period,
--     or sooner if the consultant marks the period delivered.
--   * Phased proposal fees: released when the owner decides; backstop only.
--   * 90-day backstop: anything still held 90 days after its charge is
--     flagged for admin, never auto-released.
--   * Support hold: admin pauses auto-release; must be cleared within 14
--     days (ops alerted when stale).
--   * Partial refunds: the charge-level refunded amount is mirrored onto
--     every row on that payment; auto-release and owner release refuse
--     while it's non-zero, so a partially refunded payment never releases
--     for the full amount.
--
-- Every new column is server-only. bids: not in the authenticated column
-- UPDATE/INSERT grants from rls_lockdown.sql, and bids_guard_client_update
-- rejects any change outside the negotiable list. bid_phase_payments:
-- authenticated has SELECT only. Writes go through app.js endpoints that
-- check the caller is the consultant / owner / admin.
--
-- Do not apply without moiz's approval. Ships with the matching app.js.

begin;

-- ════════════════════════════════════════════════════════════════
-- 1. Columns
-- ════════════════════════════════════════════════════════════════

-- Same set on both payment tables, so the release job treats a standard
-- bid and a phase row alike.
alter table public.bids
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_note text,
  add column if not exists delivery_link text,
  add column if not exists changes_requested_at timestamptz,
  add column if not exists changes_request_note text,
  add column if not exists review_reminded_at timestamptz,
  add column if not exists support_hold_at timestamptz,
  add column if not exists support_hold_reason text,
  add column if not exists support_hold_by uuid references auth.users(id) on delete set null,
  add column if not exists backstop_flagged_at timestamptz,
  add column if not exists refunded_cents integer not null default 0;

alter table public.bid_phase_payments
  add column if not exists delivered_at timestamptz,
  add column if not exists delivery_note text,
  add column if not exists delivery_link text,
  add column if not exists changes_requested_at timestamptz,
  add column if not exists changes_request_note text,
  add column if not exists review_reminded_at timestamptz,
  add column if not exists support_hold_at timestamptz,
  add column if not exists support_hold_reason text,
  add column if not exists support_hold_by uuid references auth.users(id) on delete set null,
  add column if not exists backstop_flagged_at timestamptz,
  add column if not exists refunded_cents integer not null default 0,
  -- Retainer periods: when this billing period ends (window opens then).
  add column if not exists period_end_at timestamptz;

-- Bounded free text from the consultant / owner / admin.
do $$
declare t text;
begin
  foreach t in array array['bids', 'bid_phase_payments'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_delivery_note_len');
    execute format('alter table public.%I add constraint %I check (delivery_note is null or char_length(delivery_note) <= 1000)', t, t || '_delivery_note_len');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_delivery_link_fmt');
    execute format($c$alter table public.%I add constraint %I check (delivery_link is null or (char_length(delivery_link) <= 500 and delivery_link ~* '^https?://'))$c$, t, t || '_delivery_link_fmt');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_changes_note_len');
    execute format('alter table public.%I add constraint %I check (changes_request_note is null or char_length(changes_request_note) <= 1000)', t, t || '_changes_note_len');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_hold_reason_len');
    execute format('alter table public.%I add constraint %I check (support_hold_reason is null or char_length(support_hold_reason) <= 500)', t, t || '_hold_reason_len');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_refunded_cents_nonneg');
    execute format('alter table public.%I add constraint %I check (refunded_cents >= 0)', t, t || '_refunded_cents_nonneg');
  end loop;
end $$;

-- The daily job scans held rows; partial indexes keep that cheap.
create index if not exists bids_held_paid_at_idx
  on public.bids (paid_at) where payment_status = 'held';
create index if not exists bid_phase_payments_held_paid_at_idx
  on public.bid_phase_payments (paid_at) where status = 'held';

-- ════════════════════════════════════════════════════════════════
-- 2. Grants (explicit ahead of the 2026-10-30 default-grants change)
-- ════════════════════════════════════════════════════════════════

-- bids: re-assert the rls_lockdown.sql grant set so the new columns are
-- readable by participants (RLS still limits rows) but never writable by
-- a browser. Table-level SELECT stays; INSERT / UPDATE stay column-scoped.
revoke all on public.bids from anon;
revoke insert, update, delete, truncate, references, trigger on public.bids from authenticated;
grant select on public.bids to authenticated;
grant insert (listing_id, consultant_id, message, amount_cents, proposal_fee_cents, service_fee_cents)
  on public.bids to authenticated;
grant update (
  status,
  amount_cents,
  counter_offer_cents,
  counter_offer_message,
  counter_expires_at,
  counter_responded_at,
  counter_response_message,
  counter_attempted,
  declined_at
) on public.bids to authenticated;
grant all on public.bids to service_role;

-- bid_phase_payments: read-only for participants, server writes.
revoke all on public.bid_phase_payments from anon;
revoke all on public.bid_phase_payments from authenticated;
grant select on public.bid_phase_payments to authenticated;
grant all on public.bid_phase_payments to service_role;

-- Defense in depth: no browser write can touch a bid_phase_payments row
-- even if a future grant slips in. Mirrors bids_guard_client_update.
create or replace function public.bid_phase_payments_guard_client_write()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_client_role() then
    raise exception 'only the server can change payment rows' using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function public.bid_phase_payments_guard_client_write() from public, anon, authenticated;

drop trigger if exists bid_phase_payments_guard_client_write on public.bid_phase_payments;
create trigger bid_phase_payments_guard_client_write
  before insert or update or delete on public.bid_phase_payments
  for each row execute function public.bid_phase_payments_guard_client_write();

-- ════════════════════════════════════════════════════════════════
-- 3. Stranded-funds report: add delivery / hold / backstop state
-- ════════════════════════════════════════════════════════════════

-- Return type changes, so drop and recreate. Same ACL as before:
-- service_role (server) and postgres (SQL editor) only.
drop function if exists public.stranded_funds_report(integer);
create function public.stranded_funds_report(min_days integer default 7)
returns table (
  kind text,
  payment_id uuid,
  bid_id uuid,
  listing_id uuid,
  owner_id uuid,
  consultant_id uuid,
  amount_cents integer,
  refunded_cents integer,
  paid_at timestamptz,
  days_held integer,
  delivered_at timestamptz,
  support_hold_at timestamptz,
  backstop_flagged_at timestamptz,
  context text
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from (
    select 'bid'::text as kind,
           b.id as payment_id,
           b.id as bid_id,
           b.listing_id,
           l.owner_id,
           b.consultant_id,
           b.payment_amount_cents as amount_cents,
           b.refunded_cents,
           b.paid_at,
           extract(day from now() - b.paid_at)::int as days_held,
           b.delivered_at,
           b.support_hold_at,
           b.backstop_flagged_at,
           coalesce(l.title, 'untitled listing') as context
      from public.bids b
      join public.listings l on l.id = b.listing_id
     where b.payment_status = 'held'
       and b.paid_at is not null
       and extract(day from now() - b.paid_at) >= min_days
    union all
    select 'period'::text,
           bpp.id,
           bpp.bid_id,
           l.id,
           l.owner_id,
           b.consultant_id,
           bpp.amount_cents,
           bpp.refunded_cents,
           bpp.paid_at,
           extract(day from now() - bpp.paid_at)::int,
           bpp.delivered_at,
           bpp.support_hold_at,
           bpp.backstop_flagged_at,
           bpp.phase || coalesce(' #' || bpp.period_index, '')
      from public.bid_phase_payments bpp
      join public.bids b on b.id = bpp.bid_id
      join public.listings l on l.id = b.listing_id
     where bpp.status = 'held'
       and bpp.paid_at is not null
       and extract(day from now() - bpp.paid_at) >= min_days
  ) t
  order by t.backstop_flagged_at is null, t.days_held desc;
$$;
revoke all on function public.stranded_funds_report(integer) from public, anon, authenticated;
grant execute on function public.stranded_funds_report(integer) to service_role;

commit;
