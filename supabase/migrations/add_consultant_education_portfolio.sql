-- Add education fields to consultant_profiles
alter table public.consultant_profiles
  add column if not exists major text,
  add column if not exists minor text,
  add column if not exists school text;

-- Add resume_public toggle to profiles
alter table public.profiles
  add column if not exists resume_public boolean not null default false;

-- Portfolio items table
create table if not exists public.portfolio_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  file_path text not null,
  file_type text not null default 'document',
  description text check (char_length(description) <= 300),
  is_public boolean not null default false,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.portfolio_items enable row level security;

create policy "users can view own portfolio items"
  on public.portfolio_items for select to authenticated
  using (auth.uid() = user_id);

create policy "users can insert own portfolio items"
  on public.portfolio_items for insert to authenticated
  with check (auth.uid() = user_id);

create policy "users can update own portfolio items"
  on public.portfolio_items for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "users can delete own portfolio items"
  on public.portfolio_items for delete to authenticated
  using (auth.uid() = user_id);

-- Allow authenticated users to read public portfolio items (for business drill-down)
create policy "anyone can view public portfolio items"
  on public.portfolio_items for select to authenticated
  using (is_public = true);

-- Allow business owners to view consultant profiles (for drill-down)
create policy "business owners can view consultant profiles"
  on public.profiles for select to authenticated
  using (role = 'consultant');

create policy "business owners can view consultant detail profiles"
  on public.consultant_profiles for select to authenticated
  using (true);

-- Portfolio storage bucket
insert into storage.buckets (id, name, public)
values ('portfolio', 'portfolio', true)
on conflict (id) do nothing;

create policy "users can upload own portfolio files"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'portfolio' and split_part(name, '/', 1) = auth.uid()::text);

create policy "anyone can read portfolio files"
  on storage.objects for select to authenticated
  using (bucket_id = 'portfolio');

create policy "users can delete own portfolio files"
  on storage.objects for delete to authenticated
  using (bucket_id = 'portfolio' and split_part(name, '/', 1) = auth.uid()::text);
