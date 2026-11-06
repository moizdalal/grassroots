// Money math for charges and payouts. Keep in sync with lib/fees.js —
// same constants, same rounding, just ES-module shape for the browser.
//
// Model (all-in pricing):
//   * The offer is the whole price. The business pays exactly the offer —
//     no fee lines at checkout, so a $60 budget means $60 out the door.
//   * Offers are free ($0) or at least $10. Free offers never touch Stripe.
//   * Stripe processing (~2.9% + 30¢) comes out of the consultant payout.
//   * The platform fee applies only to the part of the offer above $10, so a
//     $10 offer just covers the card cost and offering more always means
//     taking home more (no cliff).
//   * The platform fee rate depends on the consultant. It starts at 30% and
//     drops 5 points for every 2 good reviews, down to 5%. Consultants who
//     were here before the ladder keep 5%. Business prices never move.
//
// The rate itself comes from GET /api/consultant/fee-rate, so estimates match charges.

export const STRIPE_FEE_BPS = 290; // 2.9%
export const STRIPE_FEE_FLAT_CENTS = 30;
export const FEE_LADDER_BPS = [3000, 2500, 2000, 1500, 1000, 500]; // 30% down to 5%
export const EXISTING_STUDENT_FEE_BPS = 500; // joined before the ladder
export const GOOD_REVIEWS_PER_STEP = 2; // good reviews for each 5-point drop
export const GOOD_REVIEW_MIN_AVERAGE = 4; // average across the five review scores
export const MIN_PAID_OFFER_CENTS = 1000; // offers are $0 or at least $10
export const PLATFORM_FEE_EXEMPT_CENTS = 1000; // no platform fee on the first $10

export function estimateStripeFeeCents(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n * STRIPE_FEE_BPS) / 10000) + STRIPE_FEE_FLAT_CENTS;
}

// A rate is only ever a step on the ladder. Anything else is a bug, so money
// code throws rather than charging a guessed fee.
export function isValidPlatformFeeBps(bps) {
  return FEE_LADDER_BPS.includes(bps);
}

// A good review averages at least 4.0 across its five scores. Comparing the
// sum avoids floating point trouble with half-star scores.
export function isGoodReview(review) {
  const scores = [
    review?.work_product_quality,
    review?.communication,
    review?.timeliness,
    review?.professionalism,
    review?.cost_value,
  ].map(Number);
  if (!scores.every(Number.isFinite)) return false;
  return scores.reduce((sum, s) => sum + s, 0) >= GOOD_REVIEW_MIN_AVERAGE * scores.length;
}

// Good reviews only ever add up, so a rate never goes back up.
export function platformFeeBpsForGoodReviews(goodReviewCount) {
  const count = Math.max(0, Math.floor(Number(goodReviewCount) || 0));
  const step = Math.min(Math.floor(count / GOOD_REVIEWS_PER_STEP), FEE_LADDER_BPS.length - 1);
  return FEE_LADDER_BPS[step];
}

// How many more good reviews until the next drop, or 0 at the lowest rate.
export function goodReviewsToNextDrop(goodReviewCount) {
  const count = Math.max(0, Math.floor(Number(goodReviewCount) || 0));
  if (platformFeeBpsForGoodReviews(count) === FEE_LADDER_BPS[FEE_LADDER_BPS.length - 1]) return 0;
  return GOOD_REVIEWS_PER_STEP - (count % GOOD_REVIEWS_PER_STEP);
}

// Platform fee at a given rate, charged only on the part above the
// exempt first $10.
export function platformFeeCents(amountCents, platformFeeBps) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || n <= PLATFORM_FEE_EXEMPT_CENTS) return 0;
  return Math.round(((n - PLATFORM_FEE_EXEMPT_CENTS) * platformFeeBps) / 10000);
}

// All-in: the business is charged the offer, nothing on top.
export function businessTotalCents(amountCents) {
  return Math.max(0, Math.round(Number(amountCents) || 0));
}

// Valid offer amounts: free, or at least the paid minimum.
export function isValidOfferCents(amountCents) {
  const n = Number(amountCents);
  return Number.isInteger(n) && (n === 0 || n >= MIN_PAID_OFFER_CENTS);
}

export function computeFees(amountCents, platformFeeBps) {
  if (!isValidPlatformFeeBps(platformFeeBps)) {
    throw new Error(`Invalid platform fee rate: ${platformFeeBps}`);
  }
  const amount = businessTotalCents(amountCents);
  const stripeFee = estimateStripeFeeCents(amount);
  const platformFee = platformFeeCents(amount, platformFeeBps);
  return {
    amountCents: amount,
    businessTotalCents: amount,
    // Stripe + platform fees broken out for the consultant's take-home view.
    stripeFeeCents: stripeFee,
    platformFeeCents: platformFee,
    platformFeeBps,
    // Consultant nets the offer minus both fees.
    consultantPayoutCents: Math.max(0, amount - stripeFee - platformFee),
  };
}

export function formatUsd(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
}
