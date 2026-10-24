-- Free offers + $10 minimum paid offer.
--
-- Offers are either free ($0) or at least $10 (lib/fees.js
-- MIN_PAID_OFFER_CENTS). Free offers skip Stripe entirely: accepting one
-- holds a $0 payment that releases through the normal review flow.
--
--   * amount_cents: was > 0. Now 0 (free) or >= 1000.
--   * counter_offer_cents: counters always carry a price (>= 1000).
--   * proposal_fee_cents: 0 (free) or >= 1000.
--   * service_fee_cents: always paid (>= 1000).
--
-- The minimums are a trigger, not check constraints, so they only apply
-- when a price is set or changed. Existing bids priced under $10 can still
-- be accepted, paid and released.

alter table public.bids drop constraint if exists bids_amount_cents_check;
alter table public.bids
  add constraint bids_amount_cents_check check (amount_cents >= 0);

create or replace function public.enforce_offer_minimums()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT' or new.amount_cents is distinct from old.amount_cents)
     and not (new.amount_cents = 0 or new.amount_cents >= 1000) then
    raise exception 'offers are free or at least $10' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.counter_offer_cents is distinct from old.counter_offer_cents)
     and new.counter_offer_cents is not null and new.counter_offer_cents < 1000 then
    raise exception 'counter offers must be at least $10' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.proposal_fee_cents is distinct from old.proposal_fee_cents)
     and new.proposal_fee_cents is not null
     and not (new.proposal_fee_cents = 0 or new.proposal_fee_cents >= 1000) then
    raise exception 'proposal fees are free or at least $10' using errcode = '23514';
  end if;
  if (tg_op = 'INSERT' or new.service_fee_cents is distinct from old.service_fee_cents)
     and new.service_fee_cents is not null and new.service_fee_cents < 1000 then
    raise exception 'service fees must be at least $10' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists bids_enforce_offer_minimums on public.bids;
create trigger bids_enforce_offer_minimums
  before insert or update of amount_cents, counter_offer_cents, proposal_fee_cents, service_fee_cents
  on public.bids
  for each row execute function public.enforce_offer_minimums();
