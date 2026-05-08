-- Stripe Connect (Custom accounts) + escrow tracking on bids.
-- Apply after the base schema + engagements_and_reviews migration.

alter table public.profiles
  add column if not exists stripe_account_id text,           -- consultants: Connect Custom account
  add column if not exists stripe_account_status text,        -- 'pending' | 'active' | null
  add column if not exists stripe_customer_id text;           -- owners: customer for charges

alter table public.bids
  add column if not exists payment_intent_id text,
  add column if not exists payment_status text default 'unpaid'
    check (payment_status in ('unpaid', 'authorizing', 'held', 'released', 'refunded', 'failed')),
  add column if not exists payment_amount_cents integer,
  add column if not exists transfer_id text,
  add column if not exists paid_at timestamptz,
  add column if not exists released_at timestamptz;

create index if not exists bids_payment_status_idx on public.bids (payment_status);
create index if not exists profiles_stripe_account_idx on public.profiles (stripe_account_id);
