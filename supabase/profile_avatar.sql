-- Profile photo: path in Storage + public avatars bucket
alter table public.profiles
  add column if not exists avatar_path text;

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

-- Upload / manage only under own user id prefix (same pattern as resumes)
create policy "users can upload own avatars"
  on storage.objects
  for insert
  to authenticated
  with check (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

create policy "users can update own avatars"
  on storage.objects
  for update
  to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

create policy "users can delete own avatars"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'avatars' and split_part(name, '/', 1) = auth.uid()::text);

-- Allow replacing resumes from profile (delete old file after new upload)
create policy "users can delete own resumes"
  on storage.objects
  for delete
  to authenticated
  using (bucket_id = 'resumes' and split_part(name, '/', 1) = auth.uid()::text);
