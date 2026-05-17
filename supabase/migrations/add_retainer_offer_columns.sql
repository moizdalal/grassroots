-- Extend retainer_subscriptions to model an owner-initiated offer before a
-- live subscription is created. Status flow with offers:
--   offered  → consultant hasn't acted yet
--   declined → consultant rejected
--   pending  → consultant accepted; Stripe subscription created but not active
--   active   → invoices billing
--   canceled → ended early
--   completed → reached the agreed period_count

alter table public.retainer_subscriptions
  add column if not exists offered_by uuid references public.profiles(id) on delete set null,
  add column if not exists offered_at timestamptz,
  add column if not exists accepted_at timestamptz,
  add column if not exists declined_at timestamptz,
  add column if not exists offer_message text;

alter table public.retainer_subscriptions
  drop constraint if exists retainer_subscriptions_status_check;
alter table public.retainer_subscriptions
  add constraint retainer_subscriptions_status_check
  check (status in ('offered','pending','active','canceled','completed','declined'));

-- Fee per period — needed to remember the agreed price when an offer is
-- pending (no Stripe price exists yet) and to reflect the price baked into
-- the subscription's recurring Price.
alter table public.retainer_subscriptions
  add column if not exists fee_cents integer
  check (fee_cents is null or fee_cents >= 0);
