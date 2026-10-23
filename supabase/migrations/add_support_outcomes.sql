-- Reported problems + support outcomes for held payments (Terms §6.4, §7.1, §21).
--
-- Flow (moiz, 2026-10-23):
--   * During its 14-day review window the business can report a problem.
--     Reporting locks the payment (support_hold_at set, so no auto-release);
--     the business can still release it itself.
--   * Support picks one outcome:
--       A meets scope        → release to the consultant.
--       B fixable            → consultant chooses within 5 days: redo (once
--                              per payment, clears the delivered mark) or
--                              give back (refund = payment − card fee,
--                              platform fee refunded in full). No answer =
--                              give back. After a redo, a second report
--                              allows only A or C.
--       C scope breached     → full refund incl. platform fee; consultant
--                              gets nothing; grassroots absorbs the fee.
--   * Support aims to decide within 14 days of a report (ops alerted after).
--   * Every admin action writes a payment_audit row.
--
-- All new columns are server-only, like add_delivery_release.sql: not in the
-- authenticated column grants on bids, and bid_phase_payments is SELECT-only
-- for authenticated with a trigger blocking browser writes.
--
-- Do not apply without moiz's approval. Ships with the matching app.js.

begin;

do $$
declare t text;
begin
  foreach t in array array['bids', 'bid_phase_payments'] loop
    execute format($c$
      alter table public.%I
        add column if not exists problem_reported_at timestamptz,
        add column if not exists problem_report_note text,
        add column if not exists problem_report_count integer not null default 0,
        add column if not exists support_outcome text,
        add column if not exists support_outcome_at timestamptz,
        add column if not exists redo_offered_at timestamptz,
        add column if not exists redo_deadline_at timestamptz,
        add column if not exists redo_used boolean not null default false,
        add column if not exists consultant_choice text,
        add column if not exists consultant_choice_at timestamptz
    $c$, t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_problem_note_len');
    execute format('alter table public.%I add constraint %I check (problem_report_note is null or char_length(problem_report_note) <= 1000)', t, t || '_problem_note_len');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_support_outcome_vals');
    execute format($c$alter table public.%I add constraint %I check (support_outcome is null or support_outcome in ('meets_scope', 'fixable', 'scope_breached', 'release_remainder', 'refund_remainder'))$c$, t, t || '_support_outcome_vals');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_consultant_choice_vals');
    execute format($c$alter table public.%I add constraint %I check (consultant_choice is null or consultant_choice in ('redo', 'give_back', 'give_back_timeout'))$c$, t, t || '_consultant_choice_vals');
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_report_count_nonneg');
    execute format('alter table public.%I add constraint %I check (problem_report_count >= 0)', t, t || '_report_count_nonneg');
  end loop;
end $$;

-- Audit trail: one row per admin / outcome action. Server-only.
create table if not exists public.payment_audit (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  payment_table text not null check (payment_table in ('bids', 'bid_phase_payments')),
  payment_id uuid not null,
  bid_id uuid,
  action text not null check (char_length(action) <= 64),
  actor_id uuid references auth.users(id) on delete set null,
  actor_email text,
  amount_cents integer,
  stripe_object_id text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists payment_audit_payment_idx on public.payment_audit (payment_id, created_at);
alter table public.payment_audit enable row level security;
-- No policies: browsers can neither read nor write it.
revoke all on public.payment_audit from public, anon, authenticated;
grant all on public.payment_audit to service_role;

-- Re-assert bids grants (unchanged column list from rls_lockdown.sql) so the
-- new columns stay readable to participants and never writable by browsers.
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

revoke all on public.bid_phase_payments from anon;
revoke all on public.bid_phase_payments from authenticated;
grant select on public.bid_phase_payments to authenticated;
grant all on public.bid_phase_payments to service_role;

commit;
