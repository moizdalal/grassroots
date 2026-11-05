-- Listing attachments: the files a business adds on the create-listing form
-- (brief, photos, brand guide). create-listing.js already uploads to the
-- `listing_attachments` bucket and writes `listings.attachments`; neither
-- existed in production, so every post with a file failed (QA C2,
-- 2026-10-26).
--
--   attachments — jsonb array of { name, path, size, content_type, kind },
--                 at most 3 entries (MAX_ATTACHMENT_COUNT). `path` points into the private
--                 `listing_attachments` bucket as
--                 <owner_id>/<listing_id>/<timestamp>-<name>.
--
-- Files are private, like `bid-files`. Owners upload and delete only under
-- their own folder. Reads follow the listing: a signed-in user can read a
-- file when listings RLS lets them read the listing in the path's second
-- segment (open listings for everyone, closed ones for the owner and
-- consultants who bid). listing.js signs short-lived URLs from `path`.
-- Guests never see attachments, so no anon read policy.
--
-- Replaces an earlier, never-applied version of this file that made the
-- bucket public with no read rules. If that version did run somewhere, the
-- upsert and policy drops below bring it in line.
--
-- Do NOT apply to production without the owner's go-ahead. Until it is
-- applied, create-listing.js keeps the listing and shows a single "files
-- didn't upload" toast, and listing.js selects `*` so the missing column
-- doesn't error.

-- ════════════════════════════════════════════════════════════════
-- 1. Column
-- ════════════════════════════════════════════════════════════════

alter table public.listings
  add column if not exists attachments jsonb not null default '[]'::jsonb;

alter table public.listings drop constraint if exists listings_attachments_check;
alter table public.listings add constraint listings_attachments_check
  check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 3);

-- listings grants are table-wide (rls_lockdown.sql: select/insert/update/
-- delete to authenticated), so the new column needs no extra grant.

-- ════════════════════════════════════════════════════════════════
-- 2. Storage: private listing_attachments bucket
-- ════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'listing_attachments',
  'listing_attachments',
  false,
  5242880, -- 5 MB per file, matches MAX_ATTACHMENT_SIZE in create-listing.js
  array[
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'text/plain',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp'
  ]
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users can upload own listing attachments" on storage.objects;
drop policy if exists "users can delete own listing attachments" on storage.objects;

drop policy if exists "owners can upload own listing attachments" on storage.objects;
create policy "owners can upload own listing attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing_attachments'
    and split_part(name, '/', 1) = auth.uid()::text
    and exists (
      select 1 from public.listings l
      where l.id::text = split_part(name, '/', 2)
        and l.owner_id = auth.uid()
    )
  );

drop policy if exists "owners can delete own listing attachments" on storage.objects;
create policy "owners can delete own listing attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing_attachments'
    and split_part(name, '/', 1) = auth.uid()::text
  );

-- The subquery runs under the caller's listings RLS, so read access is
-- exactly "can this user read the listing".
drop policy if exists "listing readers can read listing attachments" on storage.objects;
create policy "listing readers can read listing attachments"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'listing_attachments'
    and exists (
      select 1 from public.listings l
      where l.id::text = split_part(name, '/', 2)
        and l.owner_id::text = split_part(name, '/', 1)
    )
  );

notify pgrst, 'reload schema';
