do $$
begin
  if to_regclass('public.listings') is not null then
    execute 'alter table public.listings add column if not exists attachments jsonb not null default ''[]''::jsonb';
  end if;

  if to_regclass('public.marketplace_listings') is not null then
    execute 'alter table public.marketplace_listings add column if not exists attachments jsonb not null default ''[]''::jsonb';
  end if;
end $$;

insert into storage.buckets (id, name, public)
values ('listing_attachments', 'listing_attachments', true)
on conflict (id) do nothing;

drop policy if exists "users can upload own listing attachments" on storage.objects;
create policy "users can upload own listing attachments"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'listing_attachments'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "users can delete own listing attachments" on storage.objects;
create policy "users can delete own listing attachments"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'listing_attachments'
    and split_part(name, '/', 1) = auth.uid()::text
  );

notify pgrst, 'reload schema';
