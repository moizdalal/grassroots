-- Business-side platform fee, stored on the charge.
--
-- Fee model (lib/fees.js): the business pays the offer plus a 10% platform
-- fee (5% launch rate on charges created before 2027-03-01 00:00 ET), and
-- the consultant gets the offer minus a flat 10% fee. The business fee is
-- locked in when the charge is created, so a held payment never changes.
--
-- bids already store the full charge in payment_amount_cents. Phase rows
-- (proposal, service, retainer_period) store the offer in amount_cents, so
-- the server needs this column to know what the business actually paid
-- (gross = amount_cents + business_fee_cents) for confirm checks, refunds
-- and splits.
--
-- Existing rows get 0: under all-in pricing the business paid exactly the
-- offer, so gross = amount_cents still holds for them.
--
-- Apply before deploying the code that writes it. Inserts that name this
-- column fail without it, so payments stop rather than charge wrongly.
-- No new grants: authenticated keeps table-level SELECT; only the service
-- role writes fee columns (bids use column-level insert/update grants that
-- don't include it).

ALTER TABLE public.bids
  ADD COLUMN IF NOT EXISTS business_fee_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.bid_phase_payments
  ADD COLUMN IF NOT EXISTS business_fee_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.bids
  DROP CONSTRAINT IF EXISTS bids_business_fee_cents_nonneg;
ALTER TABLE public.bids
  ADD CONSTRAINT bids_business_fee_cents_nonneg CHECK (business_fee_cents >= 0);

ALTER TABLE public.bid_phase_payments
  DROP CONSTRAINT IF EXISTS bid_phase_payments_business_fee_cents_nonneg;
ALTER TABLE public.bid_phase_payments
  ADD CONSTRAINT bid_phase_payments_business_fee_cents_nonneg CHECK (business_fee_cents >= 0);

COMMENT ON COLUMN public.bids.business_fee_cents IS 'Business-side platform fee charged on top of the offer (5% before 2027-03-01 ET, then 10%). payment_amount_cents already includes it.';
COMMENT ON COLUMN public.bid_phase_payments.business_fee_cents IS 'Business-side platform fee charged on top of amount_cents (the offer). Gross charged = amount_cents + business_fee_cents.';

-- Keep the older column comments accurate for the current model.
COMMENT ON COLUMN public.bids.platform_fee_cents IS 'Consultant-side platform fee: 10% of the offer, taken from the payout.';
COMMENT ON COLUMN public.bids.stripe_fee_cents IS 'Estimated Stripe card fee on the whole charge. grassroots pays it; never deducted from the payout on new rows.';
COMMENT ON COLUMN public.bids.consultant_payout_cents IS 'offer - platform_fee_cents (10%). Older all-in rows also deducted stripe_fee_cents. NULL on legacy bids (grandfathered to full transfer).';
COMMENT ON COLUMN public.bid_phase_payments.platform_fee_cents IS 'Consultant-side platform fee: 10% of amount_cents, taken from the payout.';
COMMENT ON COLUMN public.bid_phase_payments.stripe_fee_cents IS 'Estimated Stripe card fee on the whole charge. grassroots pays it; never deducted from the payout on new rows.';
COMMENT ON COLUMN public.bid_phase_payments.consultant_payout_cents IS 'amount_cents - platform_fee_cents (10%). Older all-in rows also deducted stripe_fee_cents. NULL on legacy rows (grandfathered to full transfer).';
