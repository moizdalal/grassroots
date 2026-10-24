// Money math for charges and payouts. Keep in sync with lib/fees.js —
// same constants, same rounding, just ES-module shape for the browser.
//
// Model (all-in pricing):
//   * The offer is the whole price. The business pays exactly the offer —
//     no fee lines at checkout, so a $60 budget means $60 out the door.
//   * Offers are free ($0) or at least $10. Free offers never touch Stripe.
//   * Stripe processing (~2.9% + 30¢) comes out of the consultant payout.
//   * The platform fee (10%, discounted to 5% during launch) applies only to
//     the part of the offer above $10, so a $10 offer just covers the card
//     cost and offering more always means taking home more (no cliff).
//
// Ending the launch discount only changes LAUNCH_PLATFORM_FEE_BPS; business
// prices never move.

export const STRIPE_FEE_BPS = 290; // 2.9%
export const STRIPE_FEE_FLAT_CENTS = 30;
export const PLATFORM_FEE_BPS = 1000; // 10% list rate
export const LAUNCH_PLATFORM_FEE_BPS = 500; // 5% during launch; set to null to charge the list rate
export const MIN_PAID_OFFER_CENTS = 1000; // offers are $0 or at least $10
export const PLATFORM_FEE_EXEMPT_CENTS = 1000; // no platform fee on the first $10

export function estimateStripeFeeCents(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n * STRIPE_FEE_BPS) / 10000) + STRIPE_FEE_FLAT_CENTS;
}

// Platform fee at a given rate, charged only on the part above the
// exempt first $10.
function feeAboveExempt(amountCents, bps) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || n <= PLATFORM_FEE_EXEMPT_CENTS) return 0;
  return Math.round(((n - PLATFORM_FEE_EXEMPT_CENTS) * bps) / 10000);
}

export function platformFeeFullCents(amountCents) {
  return feeAboveExempt(amountCents, PLATFORM_FEE_BPS);
}

export function platformFeeCents(amountCents) {
  return feeAboveExempt(amountCents, LAUNCH_PLATFORM_FEE_BPS ?? PLATFORM_FEE_BPS);
}

// Valid offer amounts: free, or at least the paid minimum.
export function isValidOfferCents(amountCents) {
  const n = Number(amountCents);
  return Number.isInteger(n) && (n === 0 || n >= MIN_PAID_OFFER_CENTS);
}

export function computeFees(amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  const stripeFee = estimateStripeFeeCents(amount);
  const platformFee = platformFeeCents(amount);
  const platformFeeFull = platformFeeFullCents(amount);
  return {
    amountCents: amount,
    // All-in: the business is charged the offer, nothing on top.
    businessTotalCents: amount,
    // Stripe + platform fees broken out for the consultant's take-home view.
    stripeFeeCents: stripeFee,
    platformFeeCents: platformFee,
    platformFeeFullCents: platformFeeFull,
    platformFeeDiscounted: LAUNCH_PLATFORM_FEE_BPS != null && LAUNCH_PLATFORM_FEE_BPS < PLATFORM_FEE_BPS,
    // Consultant nets the offer minus both fees.
    consultantPayoutCents: Math.max(0, amount - stripeFee - platformFee),
  };
}

export function formatUsd(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
}
