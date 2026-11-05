-- Keep the price a consultant first offered. Accepting a counter rewrites
-- bids.amount_cents to the counter, so after that the offer summary had
-- no way to say "Countered from $100 to $150, accepted" (QA M6,
-- 2026-10-26).
--
--   original_amount_cents — amount_cents at insert time. Set by trigger;
--                           clients can't write it (not in the bids insert
--                           or update grant lists).
--
-- Existing rows are backfilled from amount_cents. For bids whose counter
-- was already accepted that's the counter price, so their history line
-- simply doesn't show (original = current).
--
-- Do NOT apply to production without the owner's go-ahead. listing.js
-- selects `*` and skips the history line when the column is missing.

alter table public.bids
  add column if not exists original_amount_cents integer;

update public.bids
  set original_amount_cents = amount_cents
  where original_amount_cents is null;

create or replace function public.bids_set_original_amount()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.original_amount_cents := new.amount_cents;
  return new;
end;
$$;
revoke all on function public.bids_set_original_amount() from public, anon, authenticated;

drop trigger if exists bids_set_original_amount on public.bids;
create trigger bids_set_original_amount
  before insert on public.bids
  for each row execute function public.bids_set_original_amount();

notify pgrst, 'reload schema';
