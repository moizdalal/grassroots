-- Offer pitch: a required delivery timeline and optional supporting files on
-- each bid. The business sees both in the offer viewer (amount + timeline
-- block up top, pitch message and files beneath).
--
--   timeline_days — consultant's estimate to deliver, in days (1–365).
--                   Nullable so existing bids stay valid; the offer form
--                   requires it for new bids.
--   pitch_files   — jsonb array of { path, name, size }, at most 3 entries.
--                   `path` points into the private `bid-files` bucket as
--                   <consultant_id>/<listing_id>/<timestamp>-<name>.
--
-- Files are private. Consultants upload and delete only under their own
-- folder; nobody reads the bucket directly. The owner-bids API signs short-
-- lived URLs with the service role, and only for paths under the bid's own
-- consultant/listing prefix.
--
-- Apply BEFORE deploying the matching listing.js: the offer form inserts
-- both columns, and the insert grant below is what lets it.

-- ════════════════════════════════════════════════════════════════
-- 1. Columns
-- ════════════════════════════════════════════════════════════════

alter table public.bids
  add column if not exists timeline_days integer,
  add column if not exists pitch_files jsonb not null default '[]'::jsonb;

alter table public.bids drop constraint if exists bids_timeline_days_check;
alter table public.bids add constraint bids_timeline_days_check
  check (timeline_days is null or timeline_days between 1 and 365);

alter table public.bids drop constraint if exists bids_pitch_files_check;
alter table public.bids add constraint bids_pitch_files_check
  check (jsonb_typeof(pitch_files) = 'array' and jsonb_array_length(pitch_files) <= 3);

-- ════════════════════════════════════════════════════════════════
-- 2. Grants (explicit ahead of the 2026-10-30 default-grants change)
-- ════════════════════════════════════════════════════════════════

-- Re-assert the add_delivery_release.sql grant set with the two new
-- insert columns. Both are insert-only: offers are immutable once sent,
-- and bids_guard_client_update already rejects client updates to any
-- non-negotiation column.
revoke all on public.bids from anon;
revoke insert, update, delete, truncate, references, trigger on public.bids from authenticated;
grant select on public.bids to authenticated;
grant insert (
  listing_id, consultant_id, message, amount_cents, proposal_fee_cents, service_fee_cents,
  timeline_days, pitch_files
) on public.bids to authenticated;
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

-- ════════════════════════════════════════════════════════════════
-- 3. Storage: private bid-files bucket
-- ════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bid-files',
  'bid-files',
  false,
  10485760, -- 10 MB, matches the offer form
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/png',
    'image/jpeg'
  ]
)
on conflict (id) do nothing;

drop policy if exists "consultants can upload own bid files" on storage.objects;
create policy "consultants can upload own bid files"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'bid-files'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "consultants can delete own bid files" on storage.objects;
create policy "consultants can delete own bid files"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'bid-files'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- No select policy: reads go through server-signed URLs only.

notify pgrst, 'reload schema';
