-- add_messaging_read_state.sql
-- Adds read state tracking for the messaging inbox:
--  - messages.read_at: per-message timestamp set when the recipient opens it
--  - message_reads:    per-thread last-read timestamp per user (for unread counts)
--  - profiles.read_receipts_enabled: per-user toggle for read receipts visibility
-- Also enables realtime on messages so the inbox can subscribe.

alter table public.messages
  add column if not exists read_at timestamptz;

create table if not exists public.message_reads (
  user_id        uuid not null references public.profiles(id) on delete cascade,
  listing_id     uuid not null references public.listings(id) on delete cascade,
  other_user_id  uuid not null references public.profiles(id) on delete cascade,
  last_read_at   timestamptz not null default now(),
  primary key (user_id, listing_id, other_user_id)
);

create index if not exists message_reads_user_idx
  on public.message_reads (user_id, last_read_at desc);

alter table public.message_reads enable row level security;

drop policy if exists "message_reads_select_own" on public.message_reads;
create policy "message_reads_select_own"
  on public.message_reads for select
  using (auth.uid() = user_id);

drop policy if exists "message_reads_upsert_own" on public.message_reads;
create policy "message_reads_upsert_own"
  on public.message_reads for insert
  with check (auth.uid() = user_id);

drop policy if exists "message_reads_update_own" on public.message_reads;
create policy "message_reads_update_own"
  on public.message_reads for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Explicit role grants (supabase removes default grants from `public` on
-- new projects May 30, 2026 and on existing projects Oct 30, 2026).
-- No delete privilege — the upsert flow never deletes rows.
revoke all on public.message_reads from anon;
revoke all on public.message_reads from authenticated;
grant select, insert, update on public.message_reads to authenticated;
grant all on public.message_reads to service_role;

alter table public.profiles
  add column if not exists read_receipts_enabled boolean not null default false;

drop policy if exists "messages_recipient_update_read_at" on public.messages;
create policy "messages_recipient_update_read_at"
  on public.messages for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

alter publication supabase_realtime add table public.messages;
