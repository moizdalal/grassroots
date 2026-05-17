-- Counter-offer lifecycle: 24h expiration + permanent "already tried"
-- flag + consultant response trail. Without these the counter flow is
-- one-shot with no resolution path — the consultant has nowhere to
-- accept/decline, and an unresponded counter sits forever.

alter table public.bids
  add column if not exists counter_expires_at timestamptz,
  add column if not exists counter_responded_at timestamptz,
  add column if not exists counter_response_message text,
  add column if not exists counter_attempted boolean not null default false;

-- Back-fill: any bid that currently has a counter on it should be
-- marked attempted so the owner can't double-counter under the new
-- rules (1 counter per bid, permanent).
update public.bids
   set counter_attempted = true
 where counter_offer_cents is not null
   and counter_attempted = false;

create index if not exists bids_counter_expires_idx
  on public.bids (counter_expires_at)
  where counter_expires_at is not null;
