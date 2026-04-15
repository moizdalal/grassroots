-- Repair policy set for business-side proposal views.
-- The listing page joins bids -> profiles!bids_consultant_id_fkey on the client,
-- so consultant names/avatars disappear when select access to consultant profiles
-- was never granted in the database.

do $$
begin
  if to_regclass('public.profiles') is not null then
    execute 'alter table public.profiles enable row level security';
    execute 'drop policy if exists "business owners can view consultant profiles" on public.profiles';
    execute $sql$
      create policy "business owners can view consultant profiles"
      on public.profiles
      for select
      to authenticated
      using (role = 'consultant')
    $sql$;
  end if;

  if to_regclass('public.consultant_profiles') is not null then
    execute 'alter table public.consultant_profiles enable row level security';
    execute 'drop policy if exists "business owners can view consultant detail profiles" on public.consultant_profiles';
    execute $sql$
      create policy "business owners can view consultant detail profiles"
      on public.consultant_profiles
      for select
      to authenticated
      using (true)
    $sql$;
  end if;
end $$;

notify pgrst, 'reload schema';
