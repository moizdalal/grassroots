-- Schema for phase-based and retainer contracts.
--
-- Listings:
--   - retainer_terms: 'fixed' = cadence + period locked in at listing time,
--     'tentative' = business will negotiate with the consultant later.
--   - retainer_cadence / period_count / fee_cents are only required when
--     retainer_terms = 'fixed'. Validation happens at the app layer.
--
-- Bids:
--   - proposal_fee_cents / service_fee_cents apply to phased listings.
--   - move_forward_status drives the post-proposal pick (1:N from a pool of
--     accepted proposals to a smaller set the owner advances to the service
--     phase).
--
-- bid_phase_payments:
--   - One row per actual payment movement on a bid.
--   - For phased contracts: phase ∈ {'proposal','service','maintenance'},
--     period_index null.
--   - For retainer contracts: phase = 'retainer_period', period_index = the
--     cycle number (0-indexed). The first period (period_index=0) is escrowed
--     at acceptance; subsequent periods come from the subscription's
--     invoice.paid webhooks.
--   - Status mirrors bids.payment_status so the per-phase state machine is
--     identical to the standard flow we already trust.
--
-- retainer_subscriptions:
--   - One row per retainer-converted bid (created when the owner picks
--     "continue" after the first delivery, or via convert-to-retainer on a
--     completed engagement).
--   - stripe_subscription_id is unique — at most one active subscription per
--     bid.

-- ─── listings ────────────────────────────────────────────────────────────
alter table public.listings
  add column if not exists retainer_terms text
    check (retainer_terms in ('fixed','tentative')),
  add column if not exists retainer_cadence text
    check (retainer_cadence in ('weekly','biweekly','monthly','quarterly')),
  add column if not exists retainer_period_count integer
    check (retainer_period_count is null or retainer_period_count > 0),
  add column if not exists retainer_fee_cents integer
    check (retainer_fee_cents is null or retainer_fee_cents >= 0);

-- ─── bids ────────────────────────────────────────────────────────────────
alter table public.bids
  add column if not exists proposal_fee_cents integer
    check (proposal_fee_cents is null or proposal_fee_cents >= 0),
  add column if not exists service_fee_cents integer
    check (service_fee_cents is null or service_fee_cents >= 0),
  add column if not exists move_forward_status text default 'pending'
    check (move_forward_status in ('pending','selected','declined')),
  add column if not exists move_forward_decided_at timestamptz;

create index if not exists bids_move_forward_idx
  on public.bids (listing_id, move_forward_status);

-- ─── bid_phase_payments ──────────────────────────────────────────────────
create table if not exists public.bid_phase_payments (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  phase text not null
    check (phase in ('proposal','service','maintenance','retainer_period')),
  period_index integer, -- null for non-retainer phases; 0,1,2… for retainer
  amount_cents integer not null check (amount_cents >= 0),
  payment_intent_id text,
  charge_id text,
  transfer_id text,
  refund_id text,
  status text not null default 'unpaid'
    check (status in ('unpaid','authorizing','held','released','refunded','failed')),
  paid_at timestamptz,
  released_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists bid_phase_payments_bid_idx
  on public.bid_phase_payments (bid_id);
create index if not exists bid_phase_payments_status_idx
  on public.bid_phase_payments (status);
create index if not exists bid_phase_payments_payment_intent_idx
  on public.bid_phase_payments (payment_intent_id);

-- One payment row per (bid, phase, period). Postgres treats NULLs as
-- distinct, so a vanilla unique index would let multiple proposal rows
-- exist per bid. Coalesce period_index to -1 to enforce uniqueness across
-- both phased (null) and retainer (numbered) shapes.
create unique index if not exists bid_phase_payments_unique_idx
  on public.bid_phase_payments (bid_id, phase, coalesce(period_index, -1));

alter table public.bid_phase_payments enable row level security;

drop policy if exists "phase payments readable by participants"
  on public.bid_phase_payments;
create policy "phase payments readable by participants"
  on public.bid_phase_payments
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bids b
      join public.listings l on l.id = b.listing_id
      where b.id = bid_phase_payments.bid_id
        and (auth.uid() = b.consultant_id or auth.uid() = l.owner_id)
    )
  );

-- Explicit role grants (supabase removes default grants from `public` on
-- new projects May 30, 2026 and on existing projects Oct 30, 2026). Writes
-- happen server-side via service_role; frontend reads only.
revoke all on public.bid_phase_payments from anon;
revoke all on public.bid_phase_payments from authenticated;
grant select on public.bid_phase_payments to authenticated;
grant all on public.bid_phase_payments to service_role;

-- ─── retainer_subscriptions ──────────────────────────────────────────────
create table if not exists public.retainer_subscriptions (
  id uuid primary key default gen_random_uuid(),
  bid_id uuid not null references public.bids(id) on delete cascade,
  stripe_subscription_id text unique,
  cadence text check (cadence in ('weekly','biweekly','monthly','quarterly')),
  period_count integer check (period_count is null or period_count > 0),
  periods_billed integer not null default 0,
  status text not null default 'pending'
    check (status in ('pending','active','canceled','completed')),
  started_at timestamptz,
  ends_at timestamptz,
  canceled_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists retainer_subscriptions_bid_idx
  on public.retainer_subscriptions (bid_id);
create index if not exists retainer_subscriptions_status_idx
  on public.retainer_subscriptions (status);

alter table public.retainer_subscriptions enable row level security;

drop policy if exists "retainer subs readable by participants"
  on public.retainer_subscriptions;
create policy "retainer subs readable by participants"
  on public.retainer_subscriptions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.bids b
      join public.listings l on l.id = b.listing_id
      where b.id = retainer_subscriptions.bid_id
        and (auth.uid() = b.consultant_id or auth.uid() = l.owner_id)
    )
  );

-- Explicit role grants (see note on bid_phase_payments above).
revoke all on public.retainer_subscriptions from anon;
revoke all on public.retainer_subscriptions from authenticated;
grant select on public.retainer_subscriptions to authenticated;
grant all on public.retainer_subscriptions to service_role;
