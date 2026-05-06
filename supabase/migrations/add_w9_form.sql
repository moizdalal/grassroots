alter table public.profiles
  add column if not exists w9_path text,
  add column if not exists w9_submitted_at timestamptz;

insert into storage.buckets (id, name, public)
values ('w9-forms', 'w9-forms', false)
on conflict (id) do nothing;

create policy "consultants can upload own w9"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'w9-forms' and split_part(name, '/', 1) = auth.uid()::text);

create policy "consultants can read own w9"
  on storage.objects for select to authenticated
  using (bucket_id = 'w9-forms' and split_part(name, '/', 1) = auth.uid()::text);

create policy "consultants can update own w9"
  on storage.objects for update to authenticated
  using (bucket_id = 'w9-forms' and split_part(name, '/', 1) = auth.uid()::text)
  with check (bucket_id = 'w9-forms' and split_part(name, '/', 1) = auth.uid()::text);

create policy "consultants can delete own w9"
  on storage.objects for delete to authenticated
  using (bucket_id = 'w9-forms' and split_part(name, '/', 1) = auth.uid()::text);
