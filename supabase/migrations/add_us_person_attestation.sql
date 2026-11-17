-- US-person attestation for consultants, collected before Stripe payout setup.
--
-- us_person_attested_at           — set by /api/stripe/us-person-attestation
--                                   when a consultant confirms they are a US
--                                   person for tax purposes (citizen, permanent
--                                   resident, or resident alien) and allowed to
--                                   do freelance work in the US. NULL means not
--                                   yet attested; /api/stripe/account-session
--                                   refuses to open Stripe onboarding until set.
-- us_person_attestation_version   — which wording the consultant agreed to, so
--                                   a future copy change can ask again.
--
-- Written by the server with the service role only. No column grant to
-- anon/authenticated (rls_lockdown.sql grants profiles columns explicitly),
-- so clients can neither read nor forge it.

alter table public.profiles
  add column if not exists us_person_attested_at          timestamptz,
  add column if not exists us_person_attestation_version  text;
