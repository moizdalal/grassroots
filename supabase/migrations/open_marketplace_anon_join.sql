-- Open the marketplace to logged-out visitors.
--
-- The listings table already allows anon SELECT on rows where status='open'
-- (see migrations/restrict_inactive_listing_visibility.sql). What was missing
-- for guest browsing was the per-row anon access to the JOINed profile and
-- business_profile data — the marketplace card needs the owner's display name
-- and business name to render. This migration mirrors the
-- marketplace_listings.sql pattern but for the canonical public.listings table.
--
-- Idempotent: safe to re-apply.

-- Profiles: allow anon to read the row of any user who owns an open listing.
-- We expose full_name, role, and avatar_path through the marketplace card;
-- restricting to specific columns isn't possible at the RLS layer, so we
-- rely on the SELECT clause in the client query to fence the surface.
drop policy if exists "profiles readable for open listing owners" on public.profiles;
create policy "profiles readable for open listing owners"
  on public.profiles
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.listings l
      where l.owner_id = profiles.id
        and l.status = 'open'
    )
  );

-- Business profiles: same pattern. Anon needs business_name to render the
-- card; the rest of the row (website, socials, etc.) is exposed by the same
-- policy. If finer-grained control is later required, rewrite the marketplace
-- query to use a server-side endpoint and drop this policy.
drop policy if exists "business profiles readable for open listings" on public.business_profiles;
create policy "business profiles readable for open listings"
  on public.business_profiles
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.listings l
      where l.owner_id = business_profiles.user_id
        and l.status = 'open'
    )
  );

-- Grants for the underlying SELECT — needed when the table doesn't already
-- carry an anon grant. The migration that added geocoords already granted
-- SELECT on listings to anon; granting profiles / business_profiles SELECT
-- to anon here closes the loop.
grant select on public.profiles to anon;
grant select on public.business_profiles to anon;
