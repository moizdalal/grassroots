-- Listing view tracking: every consultant who opens a listing logs an event.
-- Aggregations (unique viewers, view-to-offer conversion, daily histogram)
-- are computed in the app from these rows.
--
-- Privacy:
--   * Inserts are write-your-own only — a consultant can only insert with
--     viewer_id = auth.uid().
--   * Selects are owner-scoped — only the owner of the listing can read its
--     view rows. The viewer can read their own rows.
--   * Owners do NOT see other consultants browsing the marketplace.

create table if not exists public.listing_views (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  viewer_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create index if not exists listing_views_listing_idx on public.listing_views(listing_id);
create index if not exists listing_views_viewer_idx on public.listing_views(viewer_id);
create index if not exists listing_views_created_idx on public.listing_views(created_at);

alter table public.listing_views enable row level security;

drop policy if exists "viewers can log their own views" on public.listing_views;
create policy "viewers can log their own views"
  on public.listing_views
  for insert
  to authenticated
  with check (viewer_id = auth.uid());

drop policy if exists "owners see views on their listings" on public.listing_views;
create policy "owners see views on their listings"
  on public.listing_views
  for select
  to authenticated
  using (
    exists (
      select 1 from public.listings
      where listings.id = listing_views.listing_id
        and listings.owner_id = auth.uid()
    )
  );

drop policy if exists "viewers see their own views" on public.listing_views;
create policy "viewers see their own views"
  on public.listing_views
  for select
  to authenticated
  using (viewer_id = auth.uid());

-- Explicit role grants (supabase removes default grants from `public` on
-- new projects May 30, 2026 and on existing projects Oct 30, 2026).
revoke all on public.listing_views from anon;
revoke all on public.listing_views from authenticated;
grant select, insert on public.listing_views to authenticated;
grant all on public.listing_views to service_role;
