// Money math for charges and payouts. Keep in sync with public/fees.js —
// same constants, same rounding, just CommonJS for app.js.
//
// Model:
//   * Business pays the offer + platform fee (10%, waived during launch).
//     Strikethrough on the line item telegraphs the eventual cut.
//   * Consultant absorbs the Stripe processing fee out of their payout
//     (~3%, framed as the cost of receiving money — universal across
//     freelance platforms).
//   * Platform retains the platform fee (currently $0 while waived).
//
// Stripe fee is computed on the OFFER amount, not the business total —
// the consultant shouldn't pay Stripe on the platform's cut.

const STRIPE_FEE_BPS = 290; // 2.9%
const STRIPE_FEE_FLAT_CENTS = 30;
const PLATFORM_FEE_BPS = 1000; // 10%
const PLATFORM_FEE_WAIVED = true;

function estimateStripeFeeCents(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n * STRIPE_FEE_BPS) / 10000) + STRIPE_FEE_FLAT_CENTS;
}

function platformFeeFullCents(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n * PLATFORM_FEE_BPS) / 10000);
}

function platformFeeCents(amountCents) {
  return PLATFORM_FEE_WAIVED ? 0 : platformFeeFullCents(amountCents);
}

function computeFees(amountCents) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0));
  const stripeFee = estimateStripeFeeCents(amount);
  const platformFee = platformFeeCents(amount);
  const platformFeeFull = platformFeeFullCents(amount);
  return {
    amountCents: amount,
    // Business is charged offer + platform fee (= offer today while waived).
    businessTotalCents: amount + platformFee,
    // Stripe + platform fees broken out for line-by-line rendering.
    stripeFeeCents: stripeFee,
    platformFeeCents: platformFee,
    platformFeeFullCents: platformFeeFull,
    platformFeeWaived: PLATFORM_FEE_WAIVED,
    // Consultant nets offer minus just the Stripe processing fee. The
    // platform fee never touches their payout in this model.
    consultantPayoutCents: Math.max(0, amount - stripeFee),
  };
}

module.exports = {
  STRIPE_FEE_BPS,
  STRIPE_FEE_FLAT_CENTS,
  PLATFORM_FEE_BPS,
  PLATFORM_FEE_WAIVED,
  estimateStripeFeeCents,
  platformFeeFullCents,
  platformFeeCents,
  computeFees,
};
