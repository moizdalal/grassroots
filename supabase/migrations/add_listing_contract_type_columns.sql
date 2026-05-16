-- contract_type + proposal_budget were collected in the create-listing form
-- but never had real columns on listings (only stringified into the `details`
-- text). Promote them to structured columns so the consultant offer form
-- can branch on contract type and the phased payment flow can read the
-- proposal budget ceiling.

alter table public.listings
  add column if not exists contract_type text default 'standard'
    check (contract_type in ('standard','phased','retainer')),
  add column if not exists proposal_budget integer
    check (proposal_budget is null or proposal_budget >= 0),
  add column if not exists maintenance_terms text;

update public.listings set contract_type = 'standard' where contract_type is null;
