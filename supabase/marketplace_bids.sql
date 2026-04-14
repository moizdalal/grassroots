-- Run after schema.sql + listings_and_marketplace.sql (and profile_avatar.sql if you use avatars).
-- Consultants place bids; listing owners see bids with consultant profile fields.

create table if not exists public.marketplace_bids (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.marketplace_listings (id) on delete cascade,
  consultant_id uuid not null references public.profiles (id) on delete cascade,
  amount_cents integer not null check (amount_cents > 0),
  message text,
  created_at timestamptz not null default now(),
  unique (listing_id, consultant_id)
);

create index if not exists marketplace_bids_listing_id_idx on public.marketplace_bids (listing_id);
create index if not exists marketplace_bids_consultant_id_idx on public.marketplace_bids (consultant_id);

alter table public.marketplace_bids enable row level security;

drop policy if exists "listing owners read bids on own listings" on public.marketplace_bids;
create policy "listing owners read bids on own listings"
  on public.marketplace_bids
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.marketplace_listings l
      where l.id = marketplace_bids.listing_id
        and l.owner_id = auth.uid()
    )
  );

drop policy if exists "consultants read own bids" on public.marketplace_bids;
create policy "consultants read own bids"
  on public.marketplace_bids
  for select
  to authenticated
  using (consultant_id = auth.uid());

drop policy if exists "consultants insert bids on open listings" on public.marketplace_bids;
create policy "consultants insert bids on open listings"
  on public.marketplace_bids
  for insert
  to authenticated
  with check (
    consultant_id = auth.uid()
    and exists (
      select 1
      from public.marketplace_listings l
      where l.id = listing_id
        and l.status = 'open'
    )
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'consultant'
    )
  );

drop policy if exists "consultants update own bids on open listings" on public.marketplace_bids;
create policy "consultants update own bids on open listings"
  on public.marketplace_bids
  for update
  to authenticated
  using (consultant_id = auth.uid())
  with check (
    consultant_id = auth.uid()
    and exists (
      select 1
      from public.marketplace_listings l
      where l.id = listing_id
        and l.status = 'open'
    )
  );

drop policy if exists "consultants delete own bids on open listings" on public.marketplace_bids;
create policy "consultants delete own bids on open listings"
  on public.marketplace_bids
  for delete
  to authenticated
  using (
    consultant_id = auth.uid()
    and exists (
      select 1
      from public.marketplace_listings l
      where l.id = listing_id
        and l.status = 'open'
    )
  );

-- Listing owners can read consultant profiles for people who bid on their listings
drop policy if exists "profiles readable to listing owner who received bid" on public.profiles;
create policy "profiles readable to listing owner who received bid"
  on public.profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.marketplace_bids b
      join public.marketplace_listings l on l.id = b.listing_id
      where b.consultant_id = profiles.id
        and l.owner_id = auth.uid()
    )
  );

drop policy if exists "consultant profiles readable to listing owner with bid" on public.consultant_profiles;
create policy "consultant profiles readable to listing owner with bid"
  on public.consultant_profiles
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.marketplace_bids b
      join public.marketplace_listings l on l.id = b.listing_id
      where b.consultant_id = consultant_profiles.user_id
        and l.owner_id = auth.uid()
    )
  );
