-- User feedback / suggestions submitted from the floating suggestion
-- box. `body` is the typed message; `attachments` stores object paths
-- in the `suggestion-attachments` bucket (one row per submission can
-- carry multiple files). `page_url` + `user_agent` give debugging
-- breadcrumbs when someone reports a UI issue.

create table if not exists public.suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  body text not null check (char_length(body) between 1 and 2000),
  attachments text[] not null default '{}',
  page_url text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists suggestions_created_idx
  on public.suggestions (created_at desc);
create index if not exists suggestions_user_idx
  on public.suggestions (user_id);

alter table public.suggestions enable row level security;

-- Anyone signed in can write their own suggestion (or unauthenticated
-- via service_role — we don't offer anon submissions for now).
drop policy if exists "users can write their own suggestions" on public.suggestions;
create policy "users can write their own suggestions"
  on public.suggestions
  for insert
  to authenticated
  with check (user_id is null or user_id = auth.uid());

-- Reads are admin-only; suggestions aren't surfaced back in the UI.
drop policy if exists "service role reads suggestions" on public.suggestions;
create policy "service role reads suggestions"
  on public.suggestions
  for select
  to service_role
  using (true);

revoke all on public.suggestions from anon;
revoke all on public.suggestions from authenticated;
grant insert on public.suggestions to authenticated;
grant all on public.suggestions to service_role;

-- Storage bucket for files attached to a suggestion. Private (not
-- public-read) — only the service role can list/read objects. The
-- bucket-level file_size_limit caps each individual upload at 10 MB;
-- the app enforces a 25 MB total per submission on top of that.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'suggestion-attachments',
  'suggestion-attachments',
  false,
  10485760, -- 10 MB
  null
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "users can upload suggestion attachments" on storage.objects;
create policy "users can upload suggestion attachments"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'suggestion-attachments' and auth.uid() is not null);
