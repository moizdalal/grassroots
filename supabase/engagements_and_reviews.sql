-- Run after schema.sql + setup_v2.sql.
-- Adds owner availability scheduling, consultant meeting confirmation,
-- and post-engagement consultant reviews.

create table if not exists public.engagement_schedules (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  bid_id uuid not null references public.bids(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  consultant_id uuid not null references public.profiles(id) on delete cascade,
  week_start date not null,
  owner_availability jsonb not null default '{"slots":[]}'::jsonb,
  selected_start timestamptz,
  selected_end timestamptz,
  status text not null default 'awaiting_owner'
    check (status in ('awaiting_owner', 'awaiting_consultant', 'scheduled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bid_id)
);

create index if not exists engagement_schedules_listing_idx
  on public.engagement_schedules (listing_id);

create index if not exists engagement_schedules_consultant_idx
  on public.engagement_schedules (consultant_id, status);

create or replace function public.set_engagement_schedule_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_engagement_schedules_updated_at on public.engagement_schedules;
create trigger trg_engagement_schedules_updated_at
before update on public.engagement_schedules
for each row
execute function public.set_engagement_schedule_updated_at();

alter table public.engagement_schedules enable row level security;

drop policy if exists "engagement participants can read schedules" on public.engagement_schedules;
create policy "engagement participants can read schedules"
  on public.engagement_schedules
  for select
  to authenticated
  using (owner_id = auth.uid() or consultant_id = auth.uid());

drop policy if exists "owners create schedules for accepted bids" on public.engagement_schedules;
create policy "owners create schedules for accepted bids"
  on public.engagement_schedules
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.listings l
      where l.id = listing_id and l.owner_id = auth.uid()
    )
  );

drop policy if exists "owners update owned schedules" on public.engagement_schedules;
create policy "owners update owned schedules"
  on public.engagement_schedules
  for update
  to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

drop policy if exists "consultants update own schedules" on public.engagement_schedules;
create policy "consultants update own schedules"
  on public.engagement_schedules
  for update
  to authenticated
  using (consultant_id = auth.uid())
  with check (consultant_id = auth.uid());

create table if not exists public.consultant_reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  bid_id uuid not null references public.bids(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  consultant_id uuid not null references public.profiles(id) on delete cascade,
  work_product_quality smallint not null check (work_product_quality between 1 and 5),
  communication smallint not null check (communication between 1 and 5),
  timeliness smallint not null check (timeliness between 1 and 5),
  professionalism smallint not null check (professionalism between 1 and 5),
  cost_value smallint not null check (cost_value between 1 and 5),
  endorsement text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bid_id)
);

create index if not exists consultant_reviews_consultant_idx
  on public.consultant_reviews (consultant_id, created_at desc);

alter table public.consultant_reviews enable row level security;

drop policy if exists "owners insert reviews for own accepted work" on public.consultant_reviews;
create policy "owners insert reviews for own accepted work"
  on public.consultant_reviews
  for insert
  to authenticated
  with check (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.listings l
      where l.id = listing_id and l.owner_id = auth.uid()
    )
  );

drop policy if exists "participants read consultant reviews" on public.consultant_reviews;
create policy "participants read consultant reviews"
  on public.consultant_reviews
  for select
  to authenticated
  using (owner_id = auth.uid() or consultant_id = auth.uid());
