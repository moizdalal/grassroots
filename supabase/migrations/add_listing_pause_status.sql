-- Add paused listings plus owner-supplied status reasons.
-- Also allow consultants with existing bids to keep reading affected listings.

do $$
declare
  bidder_listing_condition text;
  owner_profile_condition text;
begin
  if to_regclass('public.listings') is not null then
    execute 'alter table public.listings add column if not exists status_reason text';
    execute 'alter table public.listings add column if not exists status_reason_other text';
    execute 'alter table public.listings drop constraint if exists listings_status_check';
    execute $sql$
      alter table public.listings
      add constraint listings_status_check
      check (status in ('open', 'paused', 'closed', 'filled'))
    $sql$;
    execute 'alter table public.listings drop constraint if exists listings_status_reason_check';
    execute $sql$
      alter table public.listings
      add constraint listings_status_reason_check
      check (
        status_reason is null
        or status_reason in ('work_completed', 'found_solution_elsewhere', 'didnt_find_good_offer', 'other')
      )
    $sql$;
    execute 'alter table public.listings enable row level security';
    execute 'drop policy if exists "owners read own listings" on public.listings';
    execute $sql$
      create policy "owners read own listings"
      on public.listings for select to authenticated
      using (owner_id = auth.uid())
    $sql$;
    execute 'drop policy if exists "owners update own listings" on public.listings';
    execute $sql$
      create policy "owners update own listings"
      on public.listings for update to authenticated
      using (owner_id = auth.uid())
      with check (owner_id = auth.uid())
    $sql$;
    if to_regclass('public.bids') is not null then
      execute 'drop policy if exists "consultants with bids can read listings" on public.listings';
      execute $sql$
        create policy "consultants with bids can read listings"
        on public.listings for select to authenticated
        using (
          exists (
            select 1
            from public.bids b
            where b.listing_id = listings.id
              and b.consultant_id = auth.uid()
          )
        )
      $sql$;
    end if;
  end if;

  if to_regclass('public.marketplace_listings') is not null then
    execute 'alter table public.marketplace_listings add column if not exists status_reason text';
    execute 'alter table public.marketplace_listings add column if not exists status_reason_other text';
    execute 'alter table public.marketplace_listings drop constraint if exists marketplace_listings_status_check';
    execute $sql$
      alter table public.marketplace_listings
      add constraint marketplace_listings_status_check
      check (status in ('open', 'paused', 'closed', 'filled'))
    $sql$;
    execute 'alter table public.marketplace_listings drop constraint if exists marketplace_listings_status_reason_check';
    execute $sql$
      alter table public.marketplace_listings
      add constraint marketplace_listings_status_reason_check
      check (
        status_reason is null
        or status_reason in ('work_completed', 'found_solution_elsewhere', 'didnt_find_good_offer', 'other')
      )
    $sql$;
    execute 'alter table public.marketplace_listings enable row level security';
    execute 'drop policy if exists "owners read own listings" on public.marketplace_listings';
    execute $sql$
      create policy "owners read own listings"
      on public.marketplace_listings for select to authenticated
      using (owner_id = auth.uid())
    $sql$;
    execute 'drop policy if exists "owners update own listings" on public.marketplace_listings';
    execute $sql$
      create policy "owners update own listings"
      on public.marketplace_listings for update to authenticated
      using (owner_id = auth.uid())
      with check (owner_id = auth.uid())
    $sql$;

    bidder_listing_condition := null;
    if to_regclass('public.marketplace_bids') is not null then
      bidder_listing_condition := 'exists (
        select 1
        from public.marketplace_bids b
        where b.listing_id = marketplace_listings.id
          and b.consultant_id = auth.uid()
      )';
    end if;
    if to_regclass('public.bids') is not null then
      bidder_listing_condition := concat_ws(
        ' or ',
        bidder_listing_condition,
        'exists (
          select 1
          from public.bids b
          where b.listing_id = marketplace_listings.id
            and b.consultant_id = auth.uid()
        )'
      );
    end if;
    if bidder_listing_condition is not null then
      execute 'drop policy if exists "consultants with bids can read listings" on public.marketplace_listings';
      execute format(
        'create policy "consultants with bids can read listings" on public.marketplace_listings for select to authenticated using (%s)',
        bidder_listing_condition
      );
    end if;
  end if;

  owner_profile_condition := null;
  if to_regclass('public.listings') is not null and to_regclass('public.bids') is not null then
    owner_profile_condition := 'exists (
      select 1
      from public.listings l
      join public.bids b on b.listing_id = l.id
      where l.owner_id = profiles.id
        and b.consultant_id = auth.uid()
    )';
  end if;
  if to_regclass('public.marketplace_listings') is not null and to_regclass('public.marketplace_bids') is not null then
    owner_profile_condition := concat_ws(
      ' or ',
      owner_profile_condition,
      'exists (
        select 1
        from public.marketplace_listings l
        join public.marketplace_bids b on b.listing_id = l.id
        where l.owner_id = profiles.id
          and b.consultant_id = auth.uid()
      )'
    );
  end if;
  if to_regclass('public.marketplace_listings') is not null and to_regclass('public.bids') is not null then
    owner_profile_condition := concat_ws(
      ' or ',
      owner_profile_condition,
      'exists (
        select 1
        from public.marketplace_listings l
        join public.bids b on b.listing_id = l.id
        where l.owner_id = profiles.id
          and b.consultant_id = auth.uid()
      )'
    );
  end if;

  if to_regclass('public.profiles') is not null and owner_profile_condition is not null then
    execute 'drop policy if exists "consultants with bids can read listing owners" on public.profiles';
    execute format(
      'create policy "consultants with bids can read listing owners" on public.profiles for select to authenticated using (%s)',
      owner_profile_condition
    );
  end if;

  if to_regclass('public.business_profiles') is not null and owner_profile_condition is not null then
    execute 'drop policy if exists "consultants with bids can read listing owner business profiles" on public.business_profiles';
    execute format(
      'create policy "consultants with bids can read listing owner business profiles" on public.business_profiles for select to authenticated using (%s)',
      replace(owner_profile_condition, 'profiles.id', 'business_profiles.user_id')
    );
  end if;
end $$;

notify pgrst, 'reload schema';
