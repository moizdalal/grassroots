-- Core profile tables for consultative marketplace MVP registration flow
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('business_owner', 'consultant')),
  full_name text not null,
  phone_number text,
  employment_status text,
  linkedin_url text,
  resume_path text,
  resume_public boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.business_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  business_name text,
  website_url text,
  social_links text[],
  business_details text,
  current_efforts text,
  created_at timestamptz not null default now()
);

create table if not exists public.consultant_profiles (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.business_profiles enable row level security;
alter table public.consultant_profiles enable row level security;

create policy "users can view own profile"
  on public.profiles
  for select
  to authenticated
  using (auth.uid() = id);

create policy "users can update own profile"
  on public.profiles
  for update
  to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "users can view own business profile"
  on public.business_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can update own business profile"
  on public.business_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users can view own consultant profile"
  on public.consultant_profiles
  for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can update own consultant profile"
  on public.consultant_profiles
  for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

insert into storage.buckets (id, name, public)
values ('resumes', 'resumes', false)
on conflict (id) do nothing;

create policy "users can upload own resumes"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'resumes' and split_part(name, '/', 1) = auth.uid()::text);

create policy "users can read own resumes"
  on storage.objects
  for select
  to authenticated
  using (bucket_id = 'resumes' and split_part(name, '/', 1) = auth.uid()::text);
