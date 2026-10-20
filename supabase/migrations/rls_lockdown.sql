-- RLS lockdown (compliance audit 2026-10-20, findings S1–S4, S7, S13).
--
-- What this closes:
--   S1  owners/consultants could rewrite any bid column, including payment
--       state. Bids now use column-level grants plus a guard trigger that
--       enforces who may move a bid where during negotiation.
--   S2  users could rewrite their own role / stripe ids. Profiles now use
--       column-level UPDATE grants plus a guard trigger.
--   S3  anon and every signed-in user could read full profile rows (phone,
--       stripe ids). Profiles now use column-level SELECT grants, so only
--       display columns are readable by anyone but the owner. The owner
--       reads their own private columns through get_my_private_profile().
--       Consultants (profile, details, public portfolio) are visible only to
--       business owners the consultant has sent an offer or message to.
--   S4  owners could review any consultant. Reviews now require a matching
--       accepted/paid bid, and reviews can't be edited after posting.
--   S7  public portfolio bucket now has a size limit and a type allowlist
--       that excludes anything a browser would render as a web page.
--   S13 anon/authenticated lose TRUNCATE / TRIGGER / REFERENCES and every
--       verb the frontend doesn't use. Grants are explicit ahead of the
--       2026-10-30 supabase default-grants change.
--
-- Why column grants instead of a public view: the frontend embeds profiles
-- through foreign keys (`profiles!listings_owner_id_fkey(...)`,
-- `profiles!bids_consultant_id_fkey(...)`). A view would break those
-- embeds; column grants keep them working while hiding private columns.
--
-- Client-role checks in triggers use auth.role(): 'authenticated' / 'anon'
-- are browser callers, 'service_role' is the server, and NULL is a direct
-- postgres connection (dashboard SQL editor, migrations).

begin;

-- ════════════════════════════════════════════════════════════════
-- 0. Helpers
-- ════════════════════════════════════════════════════════════════

-- SECURITY DEFINER so policies on profiles / consultant_profiles can call
-- it without recursing into their own RLS.
-- A consultant is visible to a business owner only once the consultant
-- has reached out: an offer on one of the owner's listings, or a message
-- the consultant sent the owner. Owner-initiated messages don't count, so
-- an owner can't unlock a profile by messaging a consultant id.
create or replace function public.can_view_consultant(target uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select target = auth.uid()
    or exists (
      select 1
      from public.bids b
      join public.listings l on l.id = b.listing_id
      where b.consultant_id = target and l.owner_id = auth.uid()
    )
    or exists (
      select 1 from public.messages m
      where m.sender_id = target and m.recipient_id = auth.uid()
    )
$$;
revoke all on function public.can_view_consultant(uuid) from public, anon;
grant execute on function public.can_view_consultant(uuid) to authenticated, service_role;

create or replace function public.is_client_role()
returns boolean
language sql
stable
set search_path = ''
as $$
  select coalesce(auth.role(), '') in ('authenticated', 'anon')
$$;

-- ════════════════════════════════════════════════════════════════
-- 1. bids
-- ════════════════════════════════════════════════════════════════

-- Decline / rescind flows write status='declined' + declined_at, but the
-- column didn't exist and the status check only allowed 'rejected', so
-- those writes failed. Add both.
alter table public.bids add column if not exists declined_at timestamptz;

alter table public.bids drop constraint if exists bids_status_check;
alter table public.bids add constraint bids_status_check
  check (status = any (array['pending', 'accepted', 'countered', 'declined', 'rejected']));

revoke all on public.bids from anon;
revoke all on public.bids from authenticated;
grant select on public.bids to authenticated;
-- Consultants submit offers with these columns only. Everything else
-- (status, payment state, fees) takes its default.
grant insert (listing_id, consultant_id, message, amount_cents, proposal_fee_cents, service_fee_cents)
  on public.bids to authenticated;
-- Negotiation columns only. Acceptance, payment, release, fees, payout,
-- move-forward and proposal columns are server-only.
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

-- No frontend path deletes bids, and deleting a paid bid would orphan
-- the payment record.
drop policy if exists "Consultants can delete their own bids" on public.bids;

create or replace function public.bids_guard_client_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  negotiable constant text[] := array[
    'status', 'amount_cents', 'counter_offer_cents', 'counter_offer_message',
    'counter_expires_at', 'counter_responded_at', 'counter_response_message',
    'counter_attempted', 'declined_at'
  ];
  v_uid uuid := auth.uid();
  v_is_consultant boolean;
  v_is_owner boolean;
begin
  if not public.is_client_role() then
    return new;
  end if;

  -- Defense in depth: column grants already block these.
  if (to_jsonb(new) - negotiable) is distinct from (to_jsonb(old) - negotiable) then
    raise exception 'only the server can change payment or lifecycle fields on a bid'
      using errcode = '42501';
  end if;

  -- Once a bid is accepted or money has moved, negotiation is over.
  if old.status = 'accepted'
     or old.accepted_at is not null
     or old.payment_status in ('held', 'released', 'refunded') then
    raise exception 'this offer is locked' using errcode = '42501';
  end if;

  -- Declined bids stay declined.
  if old.status in ('declined', 'rejected') and new.status is distinct from old.status then
    raise exception 'a declined offer can''t be reopened' using errcode = '42501';
  end if;

  if new.status is distinct from old.status
     and new.status not in ('pending', 'countered', 'declined') then
    raise exception 'only the server can set this offer status' using errcode = '42501';
  end if;

  v_is_consultant := old.consultant_id = v_uid;
  v_is_owner := exists (
    select 1 from public.listings l
    where l.id = old.listing_id and l.owner_id = v_uid
  );

  if v_is_owner and not v_is_consultant then
    -- Owners never change the consultant's price or reply.
    if new.amount_cents is distinct from old.amount_cents
       or new.counter_response_message is distinct from old.counter_response_message then
      raise exception 'only the consultant can change their offer' using errcode = '42501';
    end if;
    -- One counter per bid.
    if old.counter_attempted and not new.counter_attempted then
      raise exception 'counter_attempted can''t be reset' using errcode = '42501';
    end if;
    if new.counter_offer_cents is not null
       and new.counter_offer_cents is distinct from old.counter_offer_cents then
      if old.counter_attempted
         or new.status <> 'countered'
         or not new.counter_attempted then
        raise exception 'you can only counter an offer once' using errcode = '42501';
      end if;
    end if;
    if new.status = 'countered' and old.status <> 'countered' and new.counter_offer_cents is null then
      raise exception 'a counter needs an amount' using errcode = '42501';
    end if;
    if new.counter_expires_at is not null
       and new.counter_expires_at is distinct from old.counter_expires_at
       and new.counter_expires_at > now() + interval '25 hours' then
      raise exception 'counter window is 24 hours' using errcode = '42501';
    end if;

  elsif v_is_consultant then
    -- Consultants respond to counters; only owners create them.
    if new.status = 'countered' and old.status <> 'countered' then
      raise exception 'only the business can counter' using errcode = '42501';
    end if;
    if (new.counter_offer_cents is not null and new.counter_offer_cents is distinct from old.counter_offer_cents)
       or (new.counter_offer_message is not null and new.counter_offer_message is distinct from old.counter_offer_message)
       or (new.counter_expires_at is not null and new.counter_expires_at is distinct from old.counter_expires_at)
       or new.counter_attempted is distinct from old.counter_attempted then
      raise exception 'only the business can counter' using errcode = '42501';
    end if;
    -- The only price change a consultant can make is taking the counter.
    if new.amount_cents is distinct from old.amount_cents then
      if old.status <> 'countered' or new.amount_cents is distinct from old.counter_offer_cents then
        raise exception 'offers can''t be edited after you submit them' using errcode = '42501';
      end if;
    end if;

  else
    raise exception 'not a participant on this bid' using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists bids_guard_client_update on public.bids;
create trigger bids_guard_client_update
  before update on public.bids
  for each row execute function public.bids_guard_client_update();

-- ════════════════════════════════════════════════════════════════
-- 2. profiles
-- ════════════════════════════════════════════════════════════════

-- Never written or read by the app; leftover test values only.
alter table public.profiles drop column if exists employment_status;

revoke all on public.profiles from anon;
revoke all on public.profiles from authenticated;

-- Display columns. Row visibility is still decided by the policies below.
grant select (id, role, full_name, avatar_path, linkedin_url)
  on public.profiles to anon;
grant select (
  id, role, full_name, avatar_path, linkedin_url, created_at,
  resume_public, read_receipts_enabled, stripe_account_status, onboarded_at
) on public.profiles to authenticated;

-- Self-edit columns. role, stripe_*, referred_by_code, terms_accepted_at,
-- deletion_requested_at, export_requested_at are server-only.
grant update (
  full_name, phone_number, linkedin_url, avatar_path, resume_path,
  resume_public, read_receipts_enabled, onboarded_at
) on public.profiles to authenticated;
grant all on public.profiles to service_role;

-- The owner's own private columns, which column grants hide from SELECT.
create or replace function public.get_my_private_profile()
returns table (
  phone_number text,
  resume_path text,
  stripe_account_id text,
  referred_by_code text,
  terms_accepted_at timestamptz,
  deletion_requested_at timestamptz,
  export_requested_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select p.phone_number, p.resume_path, p.stripe_account_id, p.referred_by_code,
         p.terms_accepted_at, p.deletion_requested_at, p.export_requested_at
  from public.profiles p
  where p.id = auth.uid()
$$;
revoke all on function public.get_my_private_profile() from public, anon;
grant execute on function public.get_my_private_profile() to authenticated, service_role;

-- Was `role = 'consultant'` for every signed-in user, so anyone could read
-- every consultant. Now only owners the consultant has reached out to.
drop policy if exists "business owners can view consultant profiles" on public.profiles;
create policy "business owners can view consultant profiles"
  on public.profiles for select to authenticated
  using (role = 'consultant' and public.can_view_consultant(id));

create or replace function public.profiles_guard_client_update()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  editable constant text[] := array[
    'full_name', 'phone_number', 'linkedin_url', 'avatar_path', 'resume_path',
    'resume_public', 'read_receipts_enabled', 'onboarded_at'
  ];
begin
  if not public.is_client_role() then
    return new;
  end if;
  if (to_jsonb(new) - editable) is distinct from (to_jsonb(old) - editable) then
    raise exception 'only the server can change this profile field' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_guard_client_update on public.profiles;
create trigger profiles_guard_client_update
  before update on public.profiles
  for each row execute function public.profiles_guard_client_update();

-- ════════════════════════════════════════════════════════════════
-- 3. consultant_profiles / business_profiles
-- ════════════════════════════════════════════════════════════════

drop policy if exists "business owners can view consultant detail profiles" on public.consultant_profiles;
create policy "business owners can view consultant detail profiles"
  on public.consultant_profiles for select to authenticated
  using (public.can_view_consultant(user_id));

-- Public portfolio items were readable by every signed-in user. "Public"
-- now means visible to owners the consultant has reached out to.
drop policy if exists "anyone can view public portfolio items" on public.portfolio_items;
create policy "contacted owners can view public portfolio items"
  on public.portfolio_items for select to authenticated
  using (is_public = true and public.can_view_consultant(user_id));

revoke all on public.consultant_profiles from anon;
revoke all on public.consultant_profiles from authenticated;
grant select, insert, update on public.consultant_profiles to authenticated;
grant all on public.consultant_profiles to service_role;

-- Business details (including business_address) are public by product
-- decision, scoped by the existing open-listing / bid policies.
revoke all on public.business_profiles from anon;
revoke all on public.business_profiles from authenticated;
grant select on public.business_profiles to anon;
grant select, insert, update on public.business_profiles to authenticated;
grant all on public.business_profiles to service_role;

-- ════════════════════════════════════════════════════════════════
-- 4. consultant_reviews
-- ════════════════════════════════════════════════════════════════

drop policy if exists "owners insert reviews for own accepted work" on public.consultant_reviews;
create policy "owners insert reviews for own accepted work"
  on public.consultant_reviews for insert to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.bids b
      join public.listings l on l.id = b.listing_id
      where b.id = consultant_reviews.bid_id
        and b.listing_id = consultant_reviews.listing_id
        and b.consultant_id = consultant_reviews.consultant_id
        and l.owner_id = auth.uid()
        and (b.status = 'accepted' or b.payment_status in ('held', 'released'))
    )
  );

-- One review per bid is enforced by consultant_reviews_bid_id_key.
-- Reviews can't be edited or deleted once posted.
revoke all on public.consultant_reviews from anon;
revoke all on public.consultant_reviews from authenticated;
grant select, insert on public.consultant_reviews to authenticated;
grant all on public.consultant_reviews to service_role;

revoke all on public.consultant_review_summary from anon;
revoke all on public.consultant_review_summary from authenticated;
grant select on public.consultant_review_summary to authenticated;
grant all on public.consultant_review_summary to service_role;

-- ════════════════════════════════════════════════════════════════
-- 5. portfolio bucket
-- ════════════════════════════════════════════════════════════════

-- 50 MB, and any type a browser downloads or previews safely. Excludes
-- text/html, image/svg+xml, javascript and xml, which would run as a page
-- on our storage domain (phishing / stored XSS).
update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/heic', 'image/heif',
    'image/avif', 'image/tiff', 'image/bmp',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.oasis.opendocument.text',
    'application/vnd.oasis.opendocument.presentation',
    'application/vnd.oasis.opendocument.spreadsheet',
    'application/vnd.apple.keynote', 'application/vnd.apple.pages', 'application/vnd.apple.numbers',
    'application/x-iwork-keynote-sffkey', 'application/x-iwork-pages-sffpages',
    'application/x-iwork-numbers-sffnumbers',
    'application/rtf', 'text/plain', 'text/csv', 'text/markdown',
    'application/zip', 'application/x-zip-compressed',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav',
    'application/octet-stream'
  ]
where id = 'portfolio';

-- ════════════════════════════════════════════════════════════════
-- 6. Remaining tables: least-privilege explicit grants
-- ════════════════════════════════════════════════════════════════

-- listings: guests browse open listings; owners create/edit/delete.
revoke all on public.listings from anon;
revoke all on public.listings from authenticated;
grant select on public.listings to anon;
grant select, insert, update, delete on public.listings to authenticated;
grant all on public.listings to service_role;

-- messages: recipients may only stamp read_at (was whole-row, which let
-- a recipient rewrite a message they received).
revoke all on public.messages from anon;
revoke all on public.messages from authenticated;
grant select, insert on public.messages to authenticated;
grant update (read_at) on public.messages to authenticated;
grant all on public.messages to service_role;

-- notifications: users only flip `read` on their own rows.
revoke all on public.notifications from anon;
revoke all on public.notifications from authenticated;
grant select, insert, delete on public.notifications to authenticated;
grant update (read) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- engagement_schedules: upsert needs insert + update.
revoke all on public.engagement_schedules from anon;
revoke all on public.engagement_schedules from authenticated;
grant select, insert, update on public.engagement_schedules to authenticated;
grant all on public.engagement_schedules to service_role;

-- consultant_past_work: unused by the frontend; keep authenticated
-- verbs behind the existing own-row policies.
revoke all on public.consultant_past_work from anon;
revoke all on public.consultant_past_work from authenticated;
grant select, insert, update, delete on public.consultant_past_work to authenticated;
grant all on public.consultant_past_work to service_role;

commit;
