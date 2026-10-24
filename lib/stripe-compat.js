/* Stripe helpers shared by app.js.

   API-version compat: stripe-node 22 pins `2026-04-22.dahlia`. Since the
   2025-03-31 (basil) generation, invoices no longer carry top-level
   `subscription`, `payment_intent` or `charge`. The subscription moved to
   `invoice.parent.subscription_details.subscription` and payments moved to
   the `invoice.payments` list (not included unless expanded). Webhook
   payloads are rendered in the API version configured on the endpoint, so
   these helpers read both shapes. */

const crypto = require("crypto");

function idOf(value) {
  if (!value) return null;
  return typeof value === "string" ? value : value.id || null;
}

function invoiceSubscriptionId(invoice) {
  return (
    idOf(invoice?.parent?.subscription_details?.subscription) ||
    idOf(invoice?.subscription) ||
    null
  );
}

// Snapshot of the subscription's metadata at invoice finalization. Lets the
// webhook find the retainer row by bid_id when invoice.paid lands before
// our DB row has the stripe_subscription_id written.
function invoiceSubscriptionMetadata(invoice) {
  return (
    invoice?.parent?.subscription_details?.metadata ||
    invoice?.subscription_details?.metadata ||
    {}
  );
}

/* Resolve { paymentIntentId, chargeId } for a paid invoice across API
   generations. Order: legacy top-level fields → expanded `payments` →
   `invoicePayments.list` → PaymentIntent.latest_charge. */
async function resolveInvoicePayment(stripe, invoice) {
  let paymentIntentId = idOf(invoice?.payment_intent);
  let chargeId = idOf(invoice?.charge);

  let payments = invoice?.payments?.data || null;
  if (!paymentIntentId && !chargeId && !payments && invoice?.id && stripe?.invoicePayments) {
    try {
      const list = await stripe.invoicePayments.list({ invoice: invoice.id, limit: 10 });
      payments = list?.data || [];
    } catch (err) {
      console.warn("[stripe] invoicePayments.list failed:", err.message);
    }
  }
  if (!paymentIntentId && !chargeId && payments) {
    const paid = payments.find((p) => p.status === "paid") || payments[0];
    paymentIntentId = idOf(paid?.payment?.payment_intent);
    chargeId = idOf(paid?.payment?.charge);
  }

  if (!chargeId && paymentIntentId && stripe) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      chargeId = idOf(pi?.latest_charge);
    } catch (err) {
      console.warn("[stripe] charge resolution failed:", err.message);
    }
  }
  return { paymentIntentId, chargeId };
}

// Short stable digest for key parts that can be long (e.g. a list of bid ids).
function stableHash(...parts) {
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
}

/* Idempotency keys. Stripe dedupes a create for 24h per key and rejects a
   reuse with different params, so every key encodes the state the request
   was decided from (row id, prior PI id, amount). */
function idemKey(...parts) {
  return parts.map((p) => String(p ?? "-")).join(":").slice(0, 255);
}

/* Create a PaymentIntent under an idempotency key. A replay returns Stripe's
   cached ORIGINAL response, so a PI we canceled since (e.g. the DB write
   after create failed and we rolled it back) would still look usable and
   hand the owner a dead client_secret. On a replay, re-read the PI and mint
   a fresh one if it's canceled. */
async function createPaymentIntentOnce(stripe, params, key) {
  const intent = await stripe.paymentIntents.create(params, { idempotencyKey: key });
  if (intent.lastResponse?.headers?.["idempotent-replayed"] !== "true") return intent;
  const current = await stripe.paymentIntents.retrieve(intent.id);
  if (current.status !== "canceled") return current;
  return stripe.paymentIntents.create(params, { idempotencyKey: `${key}:${Date.now()}` });
}

/* End of the Nth billing period of a subscription, as a unix timestamp,
   using Stripe's calendar rules: weekly cadences add whole weeks; monthly
   cadences keep the anchor's day-of-month and time, clamped to the last
   day of shorter months (a Jan 31 anchor bills Feb 28, Mar 31, …).
   Setting `cancel_at` to this boundary ends the subscription after N
   invoices without opening invoice N+1. */
function periodEndUnix(anchorUnix, interval, n) {
  const { interval: unit, interval_count: count } = interval;
  if (unit === "week") return anchorUnix + n * count * 7 * 86400;
  const a = new Date(anchorUnix * 1000);
  const months = a.getUTCMonth() + n * count;
  const year = a.getUTCFullYear() + Math.floor(months / 12);
  const month = ((months % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.floor(Date.UTC(
    year, month, Math.min(a.getUTCDate(), lastDay),
    a.getUTCHours(), a.getUTCMinutes(), a.getUTCSeconds()
  ) / 1000);
}

module.exports = {
  periodEndUnix,
  idOf,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  resolveInvoicePayment,
  idemKey,
  stableHash,
  createPaymentIntentOnce,
};
