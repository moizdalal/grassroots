-- Paid offers require a US-person attestation on file.
--
-- Offers are inserted straight from the browser (listing.js), so the
-- offer-form check is only UX. This trigger is the real gate: a bid with
-- any paid amount (amount_cents, proposal_fee_cents, service_fee_cents)
-- is rejected unless the consultant's profiles.us_person_attested_at is
-- set. Free offers stay open. See add_us_person_attestation.sql.
--
-- SECURITY DEFINER because authenticated has no column grant on
-- us_person_attested_at (server-only column). The error message is the
-- stable code listing.js matches on.
--
-- Deploy order: apply AFTER the app code that ships the attestation UI,
-- or consultants without an attestation get a raw error on paid offers.

create or replace function public.bids_require_us_person_attestation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(new.amount_cents, 0) > 0
     or coalesce(new.proposal_fee_cents, 0) > 0
     or coalesce(new.service_fee_cents, 0) > 0 then
    if not exists (
      select 1 from public.profiles p
      where p.id = new.consultant_id
        and p.us_person_attested_at is not null
    ) then
      raise exception 'us_person_attestation_required'
        using errcode = 'P0001',
              hint = 'Confirm your US tax status in payout setup before submitting a paid offer.';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.bids_require_us_person_attestation() from public, anon, authenticated;

drop trigger if exists bids_require_us_person_attestation on public.bids;
create trigger bids_require_us_person_attestation
  before insert on public.bids
  for each row execute function public.bids_require_us_person_attestation();
