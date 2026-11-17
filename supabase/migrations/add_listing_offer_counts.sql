-- Offer counts for the marketplace "Featured" row.
--
-- Featured (moiz, 2026-10-31) shows the open listings with the fewest
-- offers, so new and overlooked projects get seen before the category
-- rows. Consultants and guests can't read other people's bids under
-- rls_lockdown.sql, so the count comes from this SECURITY DEFINER
-- aggregate. It returns a listing id and a number only, never a bid
-- row, amount or consultant id, and only for listings that are open.
--
-- Counted: pending and accepted offers. Declined and withdrawn offers
-- don't count, since the business is still looking.
--
-- Applied to grassroots_real on 2026-10-31 with moiz's approval.

begin;

create or replace function public.get_listing_offer_counts(target_listing_ids uuid[])
returns table (listing_id uuid, offer_count int)
language sql
stable
security definer
set search_path = ''
as $fn$
  select l.id,
         count(b.id) filter (where b.status in ('pending', 'accepted'))::int
  from public.listings l
  left join public.bids b on b.listing_id = l.id
  where l.id = any (target_listing_ids[1:500])
    and l.status = 'open'
  group by l.id;
$fn$;

revoke all on function public.get_listing_offer_counts(uuid[]) from public;
grant execute on function public.get_listing_offer_counts(uuid[]) to anon, authenticated;

commit;
