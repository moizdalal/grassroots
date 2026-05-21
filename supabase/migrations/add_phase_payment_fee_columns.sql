-- Mirror the bid fee-split columns onto bid_phase_payments. Every
-- phase payment (proposal, service, retainer_period) now carries the
-- same breakdown so phased and retainer release paths can transfer
-- the consultant payout instead of the gross amount.
--
-- NULL on existing rows = grandfathered to the old full-transfer path.

ALTER TABLE public.bid_phase_payments
  ADD COLUMN IF NOT EXISTS stripe_fee_cents integer,
  ADD COLUMN IF NOT EXISTS platform_fee_cents integer,
  ADD COLUMN IF NOT EXISTS consultant_payout_cents integer;

COMMENT ON COLUMN public.bid_phase_payments.stripe_fee_cents IS 'Estimated Stripe processing fee on the offer portion of this phase payment.';
COMMENT ON COLUMN public.bid_phase_payments.platform_fee_cents IS 'Platform take in cents for this phase payment. Currently 0 (waived).';
COMMENT ON COLUMN public.bid_phase_payments.consultant_payout_cents IS 'offer - stripe_fee. NULL on legacy rows (grandfathered to full transfer).';
