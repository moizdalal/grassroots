-- User reports: anyone signed in can report a profile, a listing, or a
-- message sent to them. Reports land in the admin Reports tab.
--
--   * target_type / target_id   what was reported (profile id, listing id
--                               or message id)
--   * target_user_id            whose it is, resolved by the server, so
--                               admin can see repeat reports per person
--   * status                    open → actioned (we did something) or
--                               dismissed (nothing to do)
--
-- One open report per person per target: reporting twice is a no-op.
-- Browsers have no access. POST /api/reports writes, the admin endpoints
-- read and decide, all with the service role.
-- Do not apply without moiz's approval.

begin;

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles(id) on delete set null,
  target_type text not null,
  target_id uuid not null,
  target_user_id uuid references public.profiles(id) on delete set null,
  reason text not null,
  details text,
  status text not null default 'open',
  admin_note text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  constraint reports_target_type_check
    check (target_type in ('profile', 'listing', 'message')),
  constraint reports_reason_check
    check (reason in ('scam', 'off_platform', 'harassment', 'inappropriate', 'fake', 'other')),
  constraint reports_status_check
    check (status in ('open', 'actioned', 'dismissed')),
  constraint reports_details_length check (char_length(coalesce(details, '')) <= 1000),
  constraint reports_note_length check (char_length(coalesce(admin_note, '')) <= 1000),
  constraint reports_reviewed_check
    check ((status = 'open') = (reviewed_at is null))
);

create unique index if not exists reports_one_open_per_target
  on public.reports (reporter_id, target_type, target_id)
  where status = 'open';
create index if not exists reports_status_idx
  on public.reports (status, created_at desc);
create index if not exists reports_target_user_idx
  on public.reports (target_user_id);
create index if not exists reports_reporter_idx
  on public.reports (reporter_id, created_at desc);

alter table public.reports enable row level security;
revoke all on public.reports from anon, authenticated;
grant all on public.reports to service_role;
-- No policies: browsers go through the API.

commit;
