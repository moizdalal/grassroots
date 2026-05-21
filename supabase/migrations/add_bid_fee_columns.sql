-- Track the fee split on each bid so the consultant's payout can have
-- the Stripe processing fee + platform fee subtracted at release time,
-- and so the UI can show the same numbers the server will charge.
--
-- All three columns stay NULL on pre-existing bids; release-funds
-- treats NULL as "grandfathered" and keeps doing the full transfer.

ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS stripe_fee_cents integer,
  ADD COLUMN IF NOT EXISTS platform_fee_cents integer,
  ADD COLUMN IF NOT EXISTS consultant_payout_cents integer;

COMMENT ON COLUMN public.bids.stripe_fee_cents IS 'Estimated Stripe processing fee at PI creation. Reconciled with the actual fee from balance_transaction at release.';
COMMENT ON COLUMN public.bids.platform_fee_cents IS 'Platform take in cents. Currently 0 during launch; model is 10% of amount_cents (see lib/fees.js).';
COMMENT ON COLUMN public.bids.consultant_payout_cents IS 'amount_cents - stripe_fee_cents - platform_fee_cents. NULL on legacy bids (grandfathered to full transfer).';
