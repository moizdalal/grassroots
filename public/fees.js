// Money math for charges and payouts. Keep in sync with lib/fees.js —
// same constants, same rounding, just ES-module shape for the browser.
// The server's numbers are the real ones; this file only estimates.
//
// Model:
//   * The offer is what the consultant and business agree on.
//   * The business pays the offer plus a 10% platform fee. Launch discount:
//     5% on charges created before March 1, 2027 (midnight Eastern).
//   * The consultant gets the offer minus a flat 10% platform fee.
//   * Stripe's card fee is grassroots' cost. It comes out of the two
//     platform fees, never out of the consultant's payout.
//   * Offers are free ($0) or at least $10. Free offers never touch Stripe.
//
// Every fee is a whole number of cents, rounded half up from the offer, and
// stored on the charge when it's created. A held payment never changes when
// the rates do. Retainers are a new charge each period, so each period uses
// the business rate on the day it's billed.

export const STRIPE_FEE_BPS = 290; // 2.9%, estimate only (grassroots pays it)
export const STRIPE_FEE_FLAT_CENTS = 30;
export const CONSULTANT_FEE_BPS = 1000; // 10%, flat, taken from the payout
export const BUSINESS_FEE_BPS = 1000; // 10% list rate, added to the offer
export const LAUNCH_BUSINESS_FEE_BPS = 500; // 5% launch rate for businesses
// 2027-03-01 00:00 in New York. March 1 is still standard time (UTC-5).
export const LAUNCH_ENDS_AT_MS = Date.parse("2027-03-01T05:00:00Z");
export const LAUNCH_ENDS_LABEL = "March 1, 2027";
export const MIN_PAID_OFFER_CENTS = 1000; // offers are $0 or at least $10

function toMs(at) {
  if (at == null) return Date.now();
  const ms = at instanceof Date ? at.getTime() : typeof at === "number" ? at : Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error(`Invalid fee date: ${at}`);
  return ms;
}

function cleanCents(amountCents) {
  return Math.max(0, Math.round(Number(amountCents) || 0));
}

// bps of an amount, in whole cents. Math.round rounds .5 up on positive
// amounts, the same in Node and every browser.
function pctOfCents(amountCents, bps) {
  return Math.round((cleanCents(amountCents) * bps) / 10000);
}

export function estimateStripeFeeCents(amountCents) {
  const n = Number(amountCents);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round((n * STRIPE_FEE_BPS) / 10000) + STRIPE_FEE_FLAT_CENTS;
}

export function isLaunchPricing(at) {
  return toMs(at) < LAUNCH_ENDS_AT_MS;
}

export function businessFeeBps(at) {
  return isLaunchPricing(at) ? LAUNCH_BUSINESS_FEE_BPS : BUSINESS_FEE_BPS;
}

export function businessFeeCents(amountCents, at) {
  return pctOfCents(amountCents, businessFeeBps(at));
}

export function consultantFeeCents(amountCents) {
  return pctOfCents(amountCents, CONSULTANT_FEE_BPS);
}

// What the business is charged for an offer on a given date.
export function businessTotalCents(amountCents, at) {
  return cleanCents(amountCents) + businessFeeCents(amountCents, at);
}

// Valid offer amounts: free, or at least the paid minimum.
export function isValidOfferCents(amountCents) {
  const n = Number(amountCents);
  return Number.isInteger(n) && (n === 0 || n >= MIN_PAID_OFFER_CENTS);
}

// Full breakdown for one offer. `at` is when the charge is created
// (defaults to now).
export function computeFees(amountCents, { at } = {}) {
  const amount = cleanCents(amountCents);
  const ms = toMs(at);
  const bizBps = businessFeeBps(ms);
  const bizFee = pctOfCents(amount, bizBps);
  const bizFeeFull = pctOfCents(amount, BUSINESS_FEE_BPS);
  const businessTotal = amount + bizFee;
  const consultantFee = consultantFeeCents(amount);
  return {
    amountCents: amount,
    // Business side: offer + business fee.
    businessFeeBps: bizBps,
    businessFeeCents: bizFee,
    businessFeeFullCents: bizFeeFull,
    businessFeeDiscounted: bizFee < bizFeeFull,
    businessTotalCents: businessTotal,
    launchEndsAt: new Date(LAUNCH_ENDS_AT_MS).toISOString(),
    // Consultant side: offer - 10%. platformFeeCents is the consultant's fee
    // (the platform_fee_cents column); business_fee_cents is stored apart.
    consultantFeeBps: CONSULTANT_FEE_BPS,
    platformFeeCents: consultantFee,
    consultantPayoutCents: amount - consultantFee,
    // Stripe's card fee on the whole charge. grassroots pays it out of the
    // two fees; kept for reconciliation, never deducted from the payout.
    stripeFeeCents: estimateStripeFeeCents(businessTotal),
  };
}

export function formatUsd(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n / 100);
}

// "10%" or "5%" from basis points.
export function formatBps(bps) {
  return `${Number(bps) / 100}%`;
}
