-- Run once in Supabase SQL Editor (after schema.sql).
-- Creates public.marketplace_listings (what the app queries) and read policies.
-- If you previously ran an older version that created public.listings, we rename it.

do $$
begin
  if to_regclass('public.listings') is not null
     and to_regclass('public.marketplace_listings') is null then
    alter table public.listings rename to marketplace_listings;
  end if;
end $$;

drop index if exists public.listings_status_created_at_idx;

create table if not exists public.marketplace_listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  title text not null,
  category text,
  problem_summary text,
  details text,
  attachments jsonb not null default '[]'::jsonb,
  qualifications_required text,
  status text not null default 'open' check (status in ('open', 'closed', 'filled')),
  created_at timestamptz not null default now()
);

create index if not exists marketplace_listings_status_created_at_idx
  on public.marketplace_listings (status, created_at desc);

alter table public.marketplace_listings enable row level security;

drop policy if exists "open listings are readable" on public.marketplace_listings;
drop policy if exists "open marketplace listings readable" on public.marketplace_listings;
create policy "open marketplace listings readable"
  on public.marketplace_listings
  for select
  to anon, authenticated
  using (status = 'open');

drop policy if exists "business owners insert own listings" on public.marketplace_listings;
drop policy if exists "business owners insert marketplace listings" on public.marketplace_listings;
create policy "business owners insert marketplace listings"
  on public.marketplace_listings
  for insert
  to authenticated
  with check (
    auth.uid() = owner_id
    and exists (
      select 1
      from public.profiles p
      where p.id = auth.uid()
        and p.role = 'business_owner'
    )
  );

drop policy if exists "owners update own listings" on public.marketplace_listings;
drop policy if exists "owners update own marketplace listings" on public.marketplace_listings;
create policy "owners update own marketplace listings"
  on public.marketplace_listings
  for update
  to authenticated
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

drop policy if exists "owners delete own listings" on public.marketplace_listings;
drop policy if exists "owners delete own marketplace listings" on public.marketplace_listings;
create policy "owners delete own marketplace listings"
  on public.marketplace_listings
  for delete
  to authenticated
  using (auth.uid() = owner_id);

-- Poster name / business for open listings
drop policy if exists "profiles readable for open listing owners" on public.profiles;
drop policy if exists "profiles readable for open marketplace listing owners" on public.profiles;
create policy "profiles readable for open marketplace listing owners"
  on public.profiles
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.marketplace_listings l
      where l.owner_id = profiles.id
        and l.status = 'open'
    )
  );

drop policy if exists "business profiles readable for open listing owners" on public.business_profiles;
drop policy if exists "business profiles readable for open marketplace listings" on public.business_profiles;
create policy "business profiles readable for open marketplace listings"
  on public.business_profiles
  for select
  to anon, authenticated
  using (
    exists (
      select 1
      from public.marketplace_listings l
      where l.owner_id = business_profiles.user_id
        and l.status = 'open'
    )
  );
