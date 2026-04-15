-- Keep paused/closed listings visible only to their owner or consultants who already bid.
-- Open listings remain visible in marketplace browsing.

create or replace function public.user_has_bid_on_listing(target_listing_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  has_bid boolean := false;
begin
  if to_regclass('public.bids') is null then
    return false;
  end if;

  execute
    'select exists (
       select 1
       from public.bids
       where listing_id = $1
         and consultant_id = auth.uid()
     )'
    into has_bid
    using target_listing_id;

  return coalesce(has_bid, false);
end;
$$;

create or replace function public.user_has_marketplace_bid_on_listing(target_listing_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  has_bid boolean := false;
begin
  if to_regclass('public.marketplace_bids') is not null then
    execute
      'select exists (
         select 1
         from public.marketplace_bids
         where listing_id = $1
           and consultant_id = auth.uid()
       )'
      into has_bid
      using target_listing_id;

    if coalesce(has_bid, false) then
      return true;
    end if;
  end if;

  if to_regclass('public.bids') is not null then
    execute
      'select exists (
         select 1
         from public.bids
         where listing_id = $1
           and consultant_id = auth.uid()
       )'
      into has_bid
      using target_listing_id;
  end if;

  return coalesce(has_bid, false);
end;
$$;

grant execute on function public.user_has_bid_on_listing(uuid) to anon, authenticated;
grant execute on function public.user_has_marketplace_bid_on_listing(uuid) to anon, authenticated;

do $$
begin
  if to_regclass('public.listings') is not null then
    execute 'alter table public.listings enable row level security';
    execute 'drop policy if exists "open listings are readable" on public.listings';
    execute 'drop policy if exists "owners read own listings" on public.listings';
    execute 'drop policy if exists "consultants with bids can read listings" on public.listings';

    execute $sql$
      create policy "open listings are readable"
      on public.listings
      for select
      to anon, authenticated
      using (status = 'open')
    $sql$;

    execute $sql$
      create policy "owners read own listings"
      on public.listings
      for select
      to authenticated
      using (owner_id = auth.uid())
    $sql$;

    execute $sql$
      create policy "consultants with bids can read listings"
      on public.listings
      for select
      to authenticated
      using (public.user_has_bid_on_listing(id))
    $sql$;
  end if;

  if to_regclass('public.marketplace_listings') is not null then
    execute 'alter table public.marketplace_listings enable row level security';
    execute 'drop policy if exists "open listings are readable" on public.marketplace_listings';
    execute 'drop policy if exists "open marketplace listings readable" on public.marketplace_listings';
    execute 'drop policy if exists "owners read own listings" on public.marketplace_listings';
    execute 'drop policy if exists "consultants with bids can read listings" on public.marketplace_listings';

    execute $sql$
      create policy "open marketplace listings readable"
      on public.marketplace_listings
      for select
      to anon, authenticated
      using (status = 'open')
    $sql$;

    execute $sql$
      create policy "owners read own listings"
      on public.marketplace_listings
      for select
      to authenticated
      using (owner_id = auth.uid())
    $sql$;

    execute $sql$
      create policy "consultants with bids can read listings"
      on public.marketplace_listings
      for select
      to authenticated
      using (public.user_has_marketplace_bid_on_listing(id))
    $sql$;
  end if;
end $$;

notify pgrst, 'reload schema';
