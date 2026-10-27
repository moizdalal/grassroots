const express = require("express");
const path = require("path");
const multer = require("multer");
const compression = require("compression");
const helmet = require("helmet");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const fees = require("./lib/fees");
const {
  periodEndUnix,
  idOf,
  invoiceSubscriptionId,
  invoiceSubscriptionMetadata,
  resolveInvoicePayment,
  idemKey,
  stableHash,
  createPaymentIntentOnce,
} = require("./lib/stripe-compat");
const { sendEmail } = require("./lib/email");
const { buildNotificationEmail } = require("./lib/notification-emails");
const { schoolMatchesEmail } = require("./lib/schools");
const {
  normalizeEmail,
  createInvite,
  lookupInvite,
  claimInvite,
  releaseInvite,
  attachInviteUser,
} = require("./lib/consultant-invites");
const crypto = require("crypto");

// Admin contact that receives operational notifications (deletion requests,
// data-export requests, suggestion submissions). Overridable per-env so we
// don't accidentally hit a real inbox from staging.
const PRIVACY_ADMIN_EMAIL = (process.env.PRIVACY_ADMIN_EMAIL || "moiz@grassroots-marketplace.com").trim();

const app = express();

// Security headers. CSP is left off for now because tightening it
// requires an allowlist for every external host the pages load
// (js.stripe.com, connect-js.stripe.com, esm.sh, fonts.googleapis,
// cdn.jsdelivr, unpkg/leaflet) — a follow-up. The other defaults
// (HSTS, X-Content-Type-Options, X-Frame-Options, Referrer-Policy,
// cross-origin policies) are pure wins.
app.use(
  helmet({
    contentSecurityPolicy: false,
    // Browsers can still honor explicit <link rel="preconnect"> tags
    // either way, but flipping this to "on" matches the perf intent
    // of those hints on every page.
    dnsPrefetchControl: { allow: true },
  })
);

app.use(compression());

// EU/EEA/UK geo-block. Grassroots is US-only at launch; we redirect EU
// traffic to a static "not available in your region" page to defer GDPR
// scope. On Vercel, static pages never reach Express — vercel.json's
// `redirects` rule does the blocking there (same country list). This
// middleware covers the API and local/Express-served pages. Vercel injects the request's ISO country code into the
// `x-vercel-ip-country` header on every forwarded request — when the
// header is absent (localhost dev, direct origin hits) we allow the
// request through unchanged.
//
// We allow /privacy from any country because legal access to the privacy
// policy is required even where service isn't offered, and we allow static
// assets through so the block page itself loads correctly. The block page
// is served with HTTP 451 (Unavailable For Legal Reasons) so crawlers
// don't index it as the canonical content of every URL.
const EU_BLOCK_COUNTRIES = new Set([
  // EU member states
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE",
  "IT","LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
  // United Kingdom
  "GB",
  // EFTA / EEA non-EU
  "IS","LI","NO","CH",
]);
const REGION_BLOCK_ALLOW_PATHS = new Set([
  "/privacy",
  "/privacy.html",
  "/terms",
  "/terms.html",
  // Machine callers, not visitors: Stripe webhooks, Vercel Cron, CSP reports.
  "/webhooks/stripe",
  "/api/webhooks/stripe",
  "/api/cron/auto-release",
  "/api/csp-report",
  "/region-unavailable.html",
  "/region-unavailable",
  "/favicon.svg",
  "/apple-touch-icon.png",
  "/robots.txt",
]);
const REGION_BLOCK_STATIC_EXTS = new Set([
  ".css", ".js", ".mjs", ".map",
  ".svg", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".ico",
  ".woff", ".woff2", ".ttf",
]);
app.use((req, res, next) => {
  const country = (req.headers["x-vercel-ip-country"] || "").toUpperCase();
  if (!country) return next();
  if (!EU_BLOCK_COUNTRIES.has(country)) return next();

  if (REGION_BLOCK_ALLOW_PATHS.has(req.path)) return next();
  const ext = path.extname(req.path).toLowerCase();
  if (REGION_BLOCK_STATIC_EXTS.has(ext)) return next();

  res
    .status(451)
    .sendFile("region-unavailable.html", { root: path.join(__dirname, "public") });
});

function envTrim(name, fallback = "") {
  const v = process.env[name];
  return typeof v === "string" ? v.trim() : fallback;
}

const SUPABASE_URL = envTrim("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = envTrim("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY =
  envTrim("SUPABASE_ANON_KEY") || envTrim("SUPABASE_PUBLISHABLE_KEY");

const STRIPE_SECRET_KEY = envTrim("STRIPE_SECRET_KEY");
const STRIPE_PUBLISHABLE_KEY = envTrim("STRIPE_PUBLISHABLE_KEY");
const STRIPE_WEBHOOK_SECRET = envTrim("STRIPE_WEBHOOK_SECRET");
// Stripe signs platform events and connected-account events (account.updated,
// payout.failed, …) from separate endpoints, each with its own secret.
const STRIPE_WEBHOOK_SECRET_CONNECT = envTrim("STRIPE_WEBHOOK_SECRET_CONNECT");
const stripe = STRIPE_SECRET_KEY ? require("stripe")(STRIPE_SECRET_KEY) : null;
if (!stripe) console.warn("[stripe] STRIPE_SECRET_KEY missing — payment endpoints will 503.");
if (stripe && !STRIPE_WEBHOOK_SECRET) console.warn("[stripe] STRIPE_WEBHOOK_SECRET missing — webhook endpoint will reject events.");

const SUPABASE_ADMIN_CONFIG_ERROR =
  "Server missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Add them as environment variables (.env locally, Vercel Project Settings in production).";
const SUPABASE_BROWSER_CONFIG_ERROR =
  "Server missing SUPABASE_URL or SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY). Add them as environment variables (.env locally, Vercel Project Settings in production).";
const hasSupabaseAdminConfig = Boolean(
  SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY
);

if (!hasSupabaseAdminConfig) {
  console.error(SUPABASE_ADMIN_CONFIG_ERROR);
}

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn(
    "SUPABASE_URL and SUPABASE_ANON_KEY (or SUPABASE_PUBLISHABLE_KEY) are required for browser sign-in and marketplace client calls."
  );
}

const supabase = hasSupabaseAdminConfig
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

const { syncInstagramProfileAvatar } = require("./lib/instagram-profile-pic");

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
});

/* Stripe webhook endpoint — MUST be registered before the global
   express.json() so the raw body is preserved for signature verification.
   Public route (no auth gate) — Stripe is the caller.

   Served at both /webhooks/stripe (vercel.json rewrites it to the Express
   function) and /api/webhooks/stripe (covered by the existing /api/*
   rewrite). Register the /api/ path in the Stripe dashboard. */
async function stripeWebhookHandler(req, res) {
  if (!stripe) return res.status(503).json({ error: "Stripe not configured" });
  if (!STRIPE_WEBHOOK_SECRET) {
    console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET missing — refusing event.");
    return res.status(500).json({ error: "Webhook secret not configured" });
  }
  // Signature verification needs the exact bytes Stripe sent. If a host
  // layer already parsed the body into an object, verification can't work.
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : typeof req.body === "string" ? Buffer.from(req.body) : null;
  if (!rawBody) {
    console.error("[stripe webhook] body was not raw — signature cannot be verified.");
    return res.status(400).send("Webhook Error: raw body unavailable");
  }
  const sig = req.headers["stripe-signature"];
  let event = null;
  for (const secret of [STRIPE_WEBHOOK_SECRET, STRIPE_WEBHOOK_SECRET_CONNECT].filter(Boolean)) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, secret);
      break;
    } catch (_) { /* try the next endpoint's secret */ }
  }
  if (!event) {
    console.warn("[stripe webhook] signature verification failed");
    return res.status(400).send("Webhook Error: invalid signature");
  }

  try {
    await handleStripeEvent(event);
  } catch (err) {
    // 500 so Stripe retries this event (it backs off for up to 3 days).
    // Every handler is idempotent, and a failing event doesn't hold up
    // delivery of other events.
    console.error(`[stripe webhook] ${event.type} ${event.id} handler failed:`, err);
    return res.status(500).json({ error: "Handler failed" });
  }
  res.json({ received: true, type: event.type });
}
app.post("/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookHandler);
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookHandler);

async function handleStripeEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case "account.updated":
      await onConnectAccountUpdated(obj);
      break;
    case "account.application.deauthorized":
      // For Connect events the deauthorized account is `event.account`;
      // `data.object` is the Application.
      await onConnectAccountDeauthorized({ id: event.account || obj?.id });
      break;
    case "invoice.paid":
    case "invoice.payment_succeeded":
      await onRetainerInvoicePaid(obj);
      break;
    case "invoice.payment_failed":
      await onRetainerInvoiceFailed(obj);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(obj);
      break;
    case "customer.subscription.updated":
      await onSubscriptionUpdated(obj);
      break;
    case "payment_intent.succeeded":
      await onPaymentIntentSucceeded(obj);
      break;
    case "charge.refunded":
      await onChargeRefunded(obj);
      break;
    case "transfer.reversed":
      await onTransferReversed(obj);
      break;
    case "payout.failed":
      await onPayoutFailed(obj, event.account);
      break;
    case "charge.dispute.created":
      await onDisputeCreated(obj);
      break;
    case "charge.dispute.closed":
      await onDisputeClosed(obj);
      break;
  }
}

/* Ops alerts. Logged with a fixed tag so a Vercel log alert / drain can
   match on it. Not user-facing. */
function alertOps(kind, details) {
  console.error(`[stripe-ops] ${kind}`, JSON.stringify(details));
}

// Server-side notification insert (service role). Never throws.
// Pass `email: { event, data, key }` to also email the user (see emailUser).
async function notifyUser(userId, { type, title, body, link, email }) {
  if (!userId || !supabase) return;
  try {
    const { error } = await supabase
      .from("notifications")
      .insert({ user_id: userId, type, title, body, link: link || null });
    if (error) console.warn("[notify] insert failed:", error.message);
  } catch (err) {
    console.warn("[notify] insert failed:", err.message);
  }
  if (email) await emailUser(userId, email.event, { link, ...email.data }, { key: email.key });
}

function emailBaseUrl() {
  return (envTrim("APP_URL") || PLATFORM_URL).replace(/\/$/, "");
}

/* Email one user about an engagement event. The server builds the subject
   and body from lib/notification-emails.js; `key` makes the send
   idempotent for 24h at Resend (retries and double clicks send once).
   Never throws. */
async function emailUser(userId, event, data, { key, keyEvent } = {}) {
  if (!userId || !supabase) return;
  try {
    const { data: found, error } = await supabase.auth.admin.getUserById(userId);
    const to = found?.user?.email;
    if (error || !to) {
      console.warn("[email] no address for user", userId, error?.message || "");
      return;
    }
    const msg = buildNotificationEmail(event, data, emailBaseUrl());
    if (!msg) return;
    await sendEmail({
      to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
      idempotencyKey: key ? `${keyEvent || event}:${key}` : undefined,
      tags: [{ name: "event", value: event }],
    });
  } catch (err) {
    console.warn("[email] emailUser failed", event, err?.message || err);
  }
}

// To the consultant once their offer is accepted (and paid, if it has a price).
async function emailOfferAccepted(bidId, amountCents) {
  const ctx = await releaseContext(bidId);
  if (!ctx) return;
  await emailUser(ctx.consultantId, "offer_accepted", {
    title: ctx.title, bidId, amountCents,
  }, { key: bidId });
}

// To both sides once held money moves to the consultant. Skips $0 holds.
async function emailPaymentReleased(bidId, { grossCents, payoutCents, key, link, auto = false }) {
  if (!(Number(grossCents) > 0)) return;
  const ctx = await releaseContext(bidId);
  if (!ctx) return;
  const data = { title: ctx.title, bidId, link, amountCents: grossCents, payoutCents: payoutCents ?? grossCents, auto };
  await emailUser(ctx.ownerId, "payment_released_business", data, { key });
  await emailUser(ctx.consultantId, "payment_released_consultant", data, { key });
}

async function onConnectAccountUpdated(account) {
  if (!account?.id || !supabase) return;
  const charges = !!account.charges_enabled;
  const payouts = !!account.payouts_enabled;
  const submitted = !!account.details_submitted;
  const fullyOnboarded = charges && payouts && submitted;
  const status = fullyOnboarded ? "active" : "pending";

  const { error } = await supabase
    .from("profiles")
    .update({ stripe_account_status: status })
    .eq("stripe_account_id", account.id);
  if (error) {
    console.warn("[stripe webhook] account.updated → profile update failed:", error.message);
  }
}

async function onConnectAccountDeauthorized(account) {
  if (!account?.id || !supabase) return;
  await supabase
    .from("profiles")
    .update({ stripe_account_id: null, stripe_account_status: null })
    .eq("stripe_account_id", account.id);
}

/* Compare-and-set update: applies `updates` only while `statusField` still
   equals `expected`. Returns the updated row, or null if another request
   already moved it. Throws on DB error. This is the lock that keeps two
   concurrent release/refund clicks from both reaching Stripe. */
async function casUpdate(table, id, expected, updates, statusField = "status", extraEq = {}) {
  let query = supabase
    .from(table)
    .update(updates)
    .eq("id", id)
    .eq(statusField, expected);
  for (const [col, val] of Object.entries(extraEq)) query = val === null ? query.is(col, null) : query.eq(col, val);
  const { data, error } = await query.select("id");
  if (error) throw new Error(`${table} update failed: ${error.message}`);
  return data?.[0] || null;
}

/* Claim a held phase row (status held → released), create the transfer,
   then stamp transfer_id. If Stripe fails, the claim is rolled back to
   held so the owner can retry. The transfer's idempotency key is the row
   id, so a retry after a lost response returns the same transfer instead
   of paying twice. */
async function releasePhaseRow(phaseRow, { destination, metadata, claimEq = {}, payoutCents = null }) {
  if (await chargeDisputeHold(phaseRow.charge_id)) {
    return { ok: false, disputed: true, error: DISPUTE_HOLD_ERROR };
  }
  const releasedAt = new Date().toISOString();
  // refunded_cents = 0 in the claim: a partially refunded payment is never
  // released for its full amount, even if the refund lands mid-release.
  // Support settling a remainder passes its own refunded_cents + payout.
  const claimed = await casUpdate("bid_phase_payments", phaseRow.id, "held", {
    status: "released",
    released_at: releasedAt,
  }, "status", { refunded_cents: 0, ...claimEq });
  if (!claimed) {
    const { data: now } = await supabase
      .from("bid_phase_payments").select("status, refunded_cents").eq("id", phaseRow.id).maybeSingle();
    if (now?.status === "held" && Number(now.refunded_cents) > 0) {
      return { ok: false, partialRefund: true, error: PARTIAL_REFUND_ERROR };
    }
    return { ok: false, conflict: true, error: "Payment is no longer held." };
  }

  // Stored consultant payout (offer - Stripe fee - platform fee); legacy rows
  // with NULL grandfather to a full-amount transfer.
  const payoutAmount = payoutCents ?? phaseRow.consultant_payout_cents ?? phaseRow.amount_cents;
  let transfer;
  try {
    transfer = await stripe.transfers.create(
      {
        amount: payoutAmount,
        currency: "usd",
        destination,
        source_transaction: phaseRow.charge_id,
        metadata,
      },
      { idempotencyKey: idemKey("transfer", "phase", phaseRow.id) }
    );
  } catch (err) {
    const { error: revertErr } = await supabase
      .from("bid_phase_payments")
      .update({ status: "held", released_at: null })
      .eq("id", phaseRow.id)
      .eq("status", "released")
      .is("transfer_id", null);
    if (revertErr) alertOps("phase_release_revert_failed", { phase_id: phaseRow.id, error: revertErr.message });
    throw err;
  }

  const { error: stampErr } = await supabase
    .from("bid_phase_payments")
    .update({ transfer_id: transfer.id })
    .eq("id", phaseRow.id);
  if (stampErr) {
    // Money moved and the row already says released, so nothing can pay
    // twice — but the transfer id is missing from our books.
    alertOps("phase_transfer_id_not_saved", { phase_id: phaseRow.id, transfer_id: transfer.id, error: stampErr.message });
  }
  return { ok: true, transfer_id: transfer.id, payout_cents: payoutAmount };
}

/* Inline transfer logic shared between the manual release-period endpoint
   and the auto-release webhook branch. Returns { ok, transfer_id, error }. */
async function transferRetainerPeriodFunds({ bidId, periodIndex }) {
  if (!stripe || !supabase) return { ok: false, error: "Stripe or DB not configured" };

  const { data: phase } = await supabase
    .from("bid_phase_payments")
    .select("id, bid_id, charge_id, amount_cents, status, transfer_id, consultant_payout_cents")
    .eq("bid_id", bidId)
    .eq("phase", "retainer_period")
    .eq("period_index", periodIndex)
    .maybeSingle();
  if (!phase) return { ok: false, error: "Period row not found" };
  if (phase.status === "released") return { ok: true, transfer_id: phase.transfer_id, alreadyReleased: true };
  if (phase.status !== "held") return { ok: false, error: `cannot release (status=${phase.status})` };
  if (!phase.charge_id) return { ok: false, error: "Missing charge_id — cannot pin transfer" };

  const { data: bid } = await supabase
    .from("bids")
    .select("consultant_id")
    .eq("id", bidId)
    .maybeSingle();
  if (!bid) return { ok: false, error: "Bid not found" };

  const { data: consultant } = await supabase
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", bid.consultant_id)
    .maybeSingle();
  if (!consultant?.stripe_account_id) {
    return { ok: false, error: "Consultant has no Stripe Connect account" };
  }
  const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
  if (!account.payouts_enabled) return { ok: false, error: "Consultant payouts not enabled" };

  try {
    const result = await releasePhaseRow(phase, {
      destination: consultant.stripe_account_id,
      metadata: { bid_id: bidId, phase: "retainer_period", period_index: String(periodIndex) },
    });
    if (result.conflict) return { ok: true, alreadyReleased: true };
    return result;
  } catch (err) {
    return { ok: false, error: err.message || "Transfer failed" };
  }
}

// Retainer subscription invoice paid (recurring period billed successfully).
// Records the period in `bid_phase_payments` with status='held' so the owner
// can release it after the consultant delivers that period's work. If
// `auto_release` is on, fire the transfer inline so the owner doesn't have to
// click each period.
//
// Idempotent across redeliveries and across invoice.paid +
// invoice.payment_succeeded (both fire for the same invoice): a period is
// keyed by its PaymentIntent, so a second delivery finds the existing row
// and doesn't bump periods_billed again.
async function onRetainerInvoicePaid(invoice) {
  if (!supabase) return;
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId) return; // not a subscription invoice
  if (!invoice.amount_paid) return; // $0 invoice (proration/credit) — nothing escrowed

  const subCols = "id, bid_id, periods_billed, status, auto_release, fee_cents, stripe_subscription_id";
  let { data: subRow, error: subErr } = await supabase
    .from("retainer_subscriptions")
    .select(subCols)
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();
  if (subErr) throw new Error(`invoice.paid sub lookup failed: ${subErr.message}`);

  if (!subRow) {
    // The first invoice is paid inside subscriptions.create, so this event
    // can beat the endpoint's DB write. Fall back to the bid_id we stamp on
    // the subscription metadata.
    const bidId = invoiceSubscriptionMetadata(invoice).bid_id;
    if (!bidId) return; // not one of ours
    const { data: byBid } = await supabase
      .from("retainer_subscriptions")
      .select(subCols)
      .eq("bid_id", bidId)
      .maybeSingle();
    if (byBid && (!byBid.stripe_subscription_id || byBid.stripe_subscription_id === subscriptionId)) {
      subRow = byBid;
    } else {
      // Throw → 500 → Stripe redelivers in a few minutes, by which point
      // the endpoint has linked the row.
      throw new Error(`invoice.paid for unlinked subscription ${subscriptionId} (bid ${bidId})`);
    }
  }

  const { chargeId, paymentIntentId } = await resolveInvoicePayment(stripe, invoice);
  if (!paymentIntentId) throw new Error(`Invoice ${invoice.id}: could not resolve payment intent`);

  // Redelivery / sibling event: the period for this PI already exists.
  const { data: existing } = await supabase
    .from("bid_phase_payments")
    .select("id, period_index, charge_id")
    .eq("bid_id", subRow.bid_id)
    .eq("phase", "retainer_period")
    .eq("payment_intent_id", paymentIntentId)
    .maybeSingle();
  if (existing) {
    if (!existing.charge_id && chargeId) {
      await supabase.from("bid_phase_payments").update({ charge_id: chargeId }).eq("id", existing.id);
    }
    return;
  }

  const periodIndex = subRow.periods_billed; // 0-based; first period is 0.

  // Per-period fee breakdown: the offer is fee_cents, which is also what
  // the business pays (all-in). Stripe processing and the platform fee
  // both come out of the consultant's payout.
  const offerCents = Number(subRow.fee_cents) || invoice.amount_paid;
  const breakdown = fees.computeFees(offerCents);

  const { error: insertErr } = await supabase.from("bid_phase_payments").insert({
    bid_id: subRow.bid_id,
    phase: "retainer_period",
    period_index: periodIndex,
    amount_cents: offerCents,
    payment_intent_id: paymentIntentId,
    charge_id: chargeId,
    status: "held",
    paid_at: new Date().toISOString(),
    // The 14-day review window opens when this period ends.
    period_end_at: invoicePeriodEnd(invoice),
    stripe_fee_cents: breakdown.stripeFeeCents,
    platform_fee_cents: breakdown.platformFeeCents,
    consultant_payout_cents: breakdown.consultantPayoutCents,
  });
  if (insertErr) {
    // 23505 = a concurrent delivery of the same invoice inserted this
    // period first. Anything else is real — let Stripe retry.
    if (insertErr.code === "23505") return;
    throw new Error(`invoice.paid period insert failed: ${insertErr.message}`);
  }

  const { error: bumpErr } = await supabase
    .from("retainer_subscriptions")
    .update({
      periods_billed: periodIndex + 1,
      status: subRow.status === "pending" ? "active" : subRow.status,
    })
    .eq("id", subRow.id)
    .eq("periods_billed", periodIndex);
  if (bumpErr) alertOps("retainer_periods_billed_not_bumped", { sub_id: subRow.id, period_index: periodIndex, error: bumpErr.message });

  // Auto-release path: owner has opted in to release each period as it
  // bills. A failure (e.g. consultant payouts disabled) leaves the row
  // "held" and the owner can release manually later.
  if (subRow.auto_release && chargeId) {
    const result = await transferRetainerPeriodFunds({ bidId: subRow.bid_id, periodIndex });
    if (!result.ok) {
      console.warn("[stripe webhook] auto-release failed:", result.error);
    }
  }
}

// End of the service period an invoice paid for (the subscription line's
// period), or null if Stripe didn't send it — the release job then falls
// back to paid_at + one cadence.
function invoicePeriodEnd(invoice) {
  const lines = invoice?.lines?.data || [];
  const end = lines.map((l) => Number(l?.period?.end) || 0).reduce((a, b) => Math.max(a, b), 0);
  return end ? new Date(end * 1000).toISOString() : null;
}

async function onRetainerInvoiceFailed(invoice) {
  const subscriptionId = invoiceSubscriptionId(invoice);
  if (!subscriptionId || !supabase) return;
  // Don't flip status — Stripe handles its own retry schedule and will fire
  // customer.subscription.updated as the status drifts (past_due → unpaid →
  // canceled). Log so we can surface a "payment failed" notification later.
  console.warn(
    "[stripe webhook] retainer invoice failed",
    subscriptionId,
    invoice.id,
    invoice.last_finalization_error?.message || ""
  );
}

async function onSubscriptionDeleted(subscription) {
  if (!subscription?.id || !supabase) return;
  const { data: row } = await supabase
    .from("retainer_subscriptions")
    .select("id, period_count, periods_billed")
    .eq("stripe_subscription_id", subscription.id)
    .maybeSingle();
  if (!row) return;
  // Ran its full agreed length → completed; anything earlier → canceled.
  const finished = row.period_count && Number(row.periods_billed) >= Number(row.period_count);
  const { error } = await supabase
    .from("retainer_subscriptions")
    .update({
      status: finished ? "completed" : "canceled",
      canceled_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .neq("status", "completed");
  if (error) throw new Error(`subscription.deleted update failed: ${error.message}`);
}

async function onSubscriptionUpdated(subscription) {
  if (!subscription?.id || !supabase) return;
  // Map Stripe's status to ours. We only care about transitions out of
  // 'pending' once the first invoice clears.
  let ourStatus = null;
  if (subscription.status === "active" || subscription.status === "trialing") ourStatus = "active";
  else if (subscription.status === "canceled") ourStatus = "canceled";
  // 'past_due' / 'unpaid' / 'incomplete' don't get a status flip — we keep
  // showing 'active' so the engagement panel doesn't whiplash on a single
  // failed retry; if Stripe escalates to canceled we pick it up above.
  if (!ourStatus) return;

  await supabase
    .from("retainer_subscriptions")
    .update({ status: ourStatus, ...(ourStatus === "canceled" ? { canceled_at: new Date().toISOString() } : {}) })
    .eq("stripe_subscription_id", subscription.id)
    .neq("status", "completed");
}

/* ================================================================
   Payment confirmation — shared by the browser-called confirm endpoints
   and the payment_intent.succeeded webhook, so acceptance no longer
   depends on the owner's tab surviving until confirm. Whichever arrives
   first wins; the other sees the row already held and returns ok.

   Each confirm verifies the PaymentIntent against our own rows before
   flipping anything: right bid(s), right owner, right amount, USD. A
   mismatch returns { ok:false, mismatch:true } and is alerted, never
   applied.
   ================================================================ */

const CONFIRMABLE_PAYMENT_STATUSES = ["unpaid", "authorizing", "failed"];

function intentMismatch(intent, reason, extra = {}) {
  alertOps("payment_intent_mismatch", { payment_intent: intent.id, reason, ...extra });
  return { ok: false, mismatch: true, error: "This payment doesn't match the engagement. Contact support." };
}

async function confirmStandardBidPayment(intent, { awaitDefaultPm = false } = {}) {
  if (intent.status !== "succeeded") {
    return { ok: false, error: `Payment not yet captured (status: ${intent.status}).` };
  }
  const bidId = intent.metadata?.bid_id;
  if (!bidId) return intentMismatch(intent, "No bid_id metadata");

  const { data: bid, error: bidErr } = await supabase
    .from("bids")
    .select("id, listing_id, payment_intent_id, payment_status, payment_amount_cents")
    .eq("id", bidId)
    .maybeSingle();
  if (bidErr) throw new Error(`Bid lookup failed: ${bidErr.message}`);
  if (!bid) return intentMismatch(intent, "Bid not found", { bid_id: bidId });

  const { data: listing } = await supabase
    .from("listings")
    .select("owner_id")
    .eq("id", bid.listing_id)
    .maybeSingle();

  if (bid.payment_intent_id !== intent.id) {
    // The owner paid a PaymentIntent that is no longer the bid's current
    // one (e.g. two tabs). Money was captured for it — a human needs to
    // refund one of them.
    return intentMismatch(intent, "Not the bid's current payment intent", { bid_id: bidId, current: bid.payment_intent_id });
  }
  if (listing?.owner_id !== intent.metadata?.owner_id) {
    return intentMismatch(intent, "Owner mismatch", { bid_id: bidId });
  }
  if (intent.currency !== "usd" || intent.amount !== bid.payment_amount_cents) {
    return intentMismatch(intent, "Amount mismatch", { bid_id: bidId, intent_amount: intent.amount, expected: bid.payment_amount_cents });
  }

  if (["held", "released", "refunded"].includes(bid.payment_status)) {
    return { ok: true, alreadyConfirmed: true, bidId };
  }

  const now = new Date().toISOString();
  const { data: flipped, error: updErr } = await supabase
    .from("bids")
    .update({
      status: "accepted",
      accepted_at: now,
      payment_status: "held",
      paid_at: now,
    })
    .eq("id", bidId)
    .eq("payment_intent_id", intent.id)
    .in("payment_status", CONFIRMABLE_PAYMENT_STATUSES)
    .select("id");
  if (updErr) throw new Error(`Bid confirm failed: ${updErr.message}`);
  if (!flipped?.length) return { ok: true, alreadyConfirmed: true, bidId };
  await emailOfferAccepted(bidId, bid.payment_amount_cents);

  // Promote the just-used payment method to the customer's default so any
  // future subscription (e.g., retainer continuation) can bill it without
  // re-prompting. The browser path doesn't wait on it — a stripe-side
  // delay here was adding ~1.5s to acceptance latency. Failure is logged,
  // not fatal.
  // TODO(P4): only do this once the owner has ticked the saved-card
  // consent in the payment modal, and store that consent (timestamp +
  // terms version). Copy depends on the Terms of Service draft.
  const paymentMethodId = idOf(intent.payment_method);
  const customerId = idOf(intent.customer);
  if (paymentMethodId && customerId) {
    const pmUpdate = stripe.customers
      .update(customerId, { invoice_settings: { default_payment_method: paymentMethodId } })
      .catch((err) => console.warn("[confirm] could not set default pm:", err.message));
    if (awaitDefaultPm) await pmUpdate;
  }

  return { ok: true, bidId };
}

// Gross the business was charged for a phase row. All-in pricing: the
// offer is the charge, and the platform fee comes out of it. Rows from the
// old offer-plus-fee model all have platform_fee_cents = 0 (it was waived),
// so this holds for them too.
function phaseRowGross(row) {
  return Number(row.amount_cents || 0);
}

async function confirmProposalBatchPayment(intent) {
  if (intent.status !== "succeeded") {
    return { ok: false, error: `Payment not yet captured (status: ${intent.status}).` };
  }
  const ownerId = intent.metadata?.owner_id;
  const { data: rows, error: rowsErr } = await supabase
    .from("bid_phase_payments")
    .select("id, bid_id, status, amount_cents, platform_fee_cents")
    .eq("payment_intent_id", intent.id)
    .eq("phase", "proposal");
  if (rowsErr) throw new Error(`Proposal rows lookup failed: ${rowsErr.message}`);
  if (!rows?.length) return intentMismatch(intent, "No proposal rows");

  const bidIds = rows.map((r) => r.bid_id);
  const metaIds = String(intent.metadata?.bid_ids || "").split(",").filter(Boolean);
  if (metaIds.length !== bidIds.length || !metaIds.every((id) => bidIds.includes(id))) {
    return intentMismatch(intent, "bid_ids mismatch", { metadata: metaIds, rows: bidIds });
  }
  const expected = rows.reduce((sum, r) => sum + phaseRowGross(r), 0);
  if (intent.currency !== "usd" || intent.amount !== expected) {
    return intentMismatch(intent, "Amount mismatch", { intent_amount: intent.amount, expected });
  }
  const { data: bids } = await supabase.from("bids").select("id, listing_id").in("id", bidIds);
  const listingIds = [...new Set((bids || []).map((b) => b.listing_id))];
  const { data: listings } = await supabase.from("listings").select("id, owner_id").in("id", listingIds);
  if (!ownerId || (listings || []).length !== listingIds.length || listings.some((l) => l.owner_id !== ownerId)) {
    return intentMismatch(intent, "Owner mismatch");
  }

  const now = new Date().toISOString();
  const { error: phaseUpdErr } = await supabase
    .from("bid_phase_payments")
    .update({ status: "held", paid_at: now, charge_id: idOf(intent.latest_charge) })
    .eq("payment_intent_id", intent.id)
    .eq("phase", "proposal")
    .in("status", CONFIRMABLE_PAYMENT_STATUSES);
  if (phaseUpdErr) throw new Error(`Proposal rows confirm failed: ${phaseUpdErr.message}`);

  const { data: acceptedBids, error: bidUpdErr } = await supabase
    .from("bids")
    .update({ status: "accepted", accepted_at: now })
    .in("id", bidIds)
    .neq("status", "accepted")
    .select("id");
  if (bidUpdErr) throw new Error(`Proposal bids accept failed: ${bidUpdErr.message}`);
  for (const { id } of acceptedBids || []) {
    await emailOfferAccepted(id, rows.find((r) => r.bid_id === id)?.amount_cents);
  }

  return { ok: true, bidIds };
}

async function confirmServicePayment(intent) {
  if (intent.status !== "succeeded") {
    return { ok: false, error: `Payment not yet captured (status: ${intent.status}).` };
  }
  const { data: row, error: rowErr } = await supabase
    .from("bid_phase_payments")
    .select("id, bid_id, status, amount_cents, platform_fee_cents")
    .eq("payment_intent_id", intent.id)
    .eq("phase", "service")
    .maybeSingle();
  if (rowErr) throw new Error(`Service row lookup failed: ${rowErr.message}`);
  if (!row) return intentMismatch(intent, "No service row");
  if (intent.metadata?.bid_id !== row.bid_id) return intentMismatch(intent, "Bid mismatch", { row_bid: row.bid_id });

  const { data: bid } = await supabase.from("bids").select("listing_id").eq("id", row.bid_id).maybeSingle();
  const { data: listing } = bid
    ? await supabase.from("listings").select("owner_id").eq("id", bid.listing_id).maybeSingle()
    : { data: null };
  if (!listing || listing.owner_id !== intent.metadata?.owner_id) return intentMismatch(intent, "Owner mismatch");
  const expected = phaseRowGross(row);
  if (intent.currency !== "usd" || intent.amount !== expected) {
    return intentMismatch(intent, "Amount mismatch", { intent_amount: intent.amount, expected });
  }

  const { error: updErr } = await supabase
    .from("bid_phase_payments")
    .update({ status: "held", paid_at: new Date().toISOString(), charge_id: idOf(intent.latest_charge) })
    .eq("id", row.id)
    .in("status", CONFIRMABLE_PAYMENT_STATUSES);
  if (updErr) throw new Error(`Service confirm failed: ${updErr.message}`);
  return { ok: true, bidId: row.bid_id };
}

async function onPaymentIntentSucceeded(intent) {
  if (!supabase || !intent?.id) return;
  const phase = intent.metadata?.phase;
  let result;
  if (phase === "proposal_batch") result = await confirmProposalBatchPayment(intent);
  else if (phase === "service") result = await confirmServicePayment(intent);
  else if (intent.metadata?.bid_id) result = await confirmStandardBidPayment(intent, { awaitDefaultPm: true });
  else return; // subscription invoice PIs etc. — handled by invoice.paid
  if (!result.ok && !result.mismatch) console.warn("[stripe webhook] payment_intent.succeeded:", result.error);
}

/* ================================================================
   Disputes (chargebacks) — handled manually by an admin.

   Stripe stays the source of truth: release endpoints ask Stripe whether
   the charge has an open or lost dispute and refuse to transfer if so
   (no schema change needed). Webhooks only tell admins; nothing moves
   money automatically. Respond with evidence in the Stripe dashboard
   (Payments → Disputes) before the deadline in the notification.
   ================================================================ */

// Returns the blocking dispute on a charge (anything not won), or null.
async function chargeDisputeHold(chargeId) {
  if (!chargeId || !stripe) return null;
  const list = await stripe.disputes.list({ charge: chargeId, limit: 10 });
  return (list?.data || []).find((d) => !["won", "warning_closed"].includes(d.status)) || null;
}

const DISPUTE_HOLD_ERROR = "This payment is under a card dispute, so it can't be released yet. Contact support.";
const PARTIAL_REFUND_ERROR = "Part of this payment was refunded, so support needs to settle the rest. Contact support.";

let adminIdsCache = null;
async function adminUserIds() {
  if (adminIdsCache) return adminIdsCache;
  try {
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    adminIdsCache = (data?.users || [])
      .filter((u) => ADMIN_EMAILS.has(String(u.email || "").toLowerCase()))
      .map((u) => u.id);
  } catch (err) {
    console.warn("[admin lookup] failed:", err.message);
    return [];
  }
  return adminIdsCache;
}

async function notifyAdmins(payload) {
  for (const id of await adminUserIds()) await notifyUser(id, payload);
}

// Which engagement a dispute belongs to (standard bid or phase row).
async function disputeContext(dispute) {
  const paymentIntentId = idOf(dispute?.payment_intent);
  if (!paymentIntentId || !supabase) return { bidId: null };
  const { data: bid } = await supabase
    .from("bids").select("id, payment_status").eq("payment_intent_id", paymentIntentId).maybeSingle();
  if (bid) return { bidId: bid.id, status: bid.payment_status };
  const { data: rows } = await supabase
    .from("bid_phase_payments").select("bid_id, phase, status").eq("payment_intent_id", paymentIntentId);
  const row = rows?.[0];
  return row ? { bidId: row.bid_id, status: `${row.phase}:${row.status}` } : { bidId: null };
}

function dollars(cents) {
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
}

async function onDisputeCreated(dispute) {
  const ctx = await disputeContext(dispute);
  const dueBy = dispute?.evidence_details?.due_by
    ? new Date(dispute.evidence_details.due_by * 1000).toISOString().slice(0, 10)
    : "See Stripe";
  alertOps("dispute_created", { dispute: dispute?.id, amount: dispute?.amount, reason: dispute?.reason, due_by: dueBy, ...ctx });
  await notifyAdmins({
    type: "dispute_opened",
    title: `Card dispute opened · ${dollars(dispute?.amount)}`,
    body: `Reason: ${dispute?.reason || "unknown"}. Funds state: ${ctx.status || "not matched"}. Respond in Stripe by ${dueBy}.`,
    link: ctx.bidId ? `/engagement.html?bid=${ctx.bidId}` : null,
  });
}

async function onDisputeClosed(dispute) {
  const ctx = await disputeContext(dispute);
  alertOps("dispute_closed", { dispute: dispute?.id, outcome: dispute?.status, amount: dispute?.amount, ...ctx });
  await notifyAdmins({
    type: "dispute_closed",
    title: `Card dispute ${dispute?.status === "won" ? "won" : "closed: " + (dispute?.status || "unknown")} · ${dollars(dispute?.amount)}`,
    body: dispute?.status === "won"
      ? "The funds are back on the platform and can be released again."
      : "The funds were returned to the cardholder. Decide whether to recover from the consultant.",
    link: ctx.bidId ? `/engagement.html?bid=${ctx.bidId}` : null,
  });
}

/* charge.refunded — mirrors refunds issued anywhere (our endpoint, the
   Stripe dashboard by support, Stripe itself) onto our rows so held
   money that left the platform can't later be "released". */
async function onChargeRefunded(charge) {
  if (!supabase) return;
  const paymentIntentId = idOf(charge?.payment_intent);
  if (!paymentIntentId) return;
  const full = charge.refunded === true || charge.amount_refunded >= charge.amount;
  const now = new Date().toISOString();

  const { data: bid } = await supabase
    .from("bids")
    .select("id, payment_status, refunded_cents")
    .eq("payment_intent_id", paymentIntentId)
    .maybeSingle();
  const { data: phaseRows } = await supabase
    .from("bid_phase_payments")
    .select("id, bid_id, status, refunded_cents")
    .eq("payment_intent_id", paymentIntentId);

  if (!bid && !phaseRows?.length) return;

  // Refunds grassroots issued itself (support outcomes, give-backs) are
  // already on the refunded rows. Only the rest is unexplained.
  // Refunded rows and released rows support split both carry the amount
  // that was refunded on purpose.
  const knownRefunded = [bid, ...(phaseRows || [])]
    .filter((r) => r && ["refunded", "released"].includes(r.payment_status || r.status))
    .reduce((sum, r) => sum + Number(r.refunded_cents || 0), 0);
  if (!full && Number(charge.amount_refunded || 0) <= knownRefunded) return;

  if (!full) {
    // Partial refunds (e.g. one consultant's share of a proposal batch)
    // can't be mapped to a payout automatically. Stamp the charge-level
    // refunded amount on every row of this payment: the release claim
    // requires refunded_cents = 0, so nothing on it can be released (by
    // the owner or the daily job) for the full amount. Support settles
    // the remainder by hand.
    const refunded = (Number(charge.amount_refunded) || 0) - knownRefunded;
    if (bid && bid.payment_status === "held") {
      const { error } = await supabase.from("bids").update({ refunded_cents: refunded }).eq("id", bid.id).eq("payment_status", "held");
      if (error) throw new Error(`Bid partial refund mirror failed: ${error.message}`);
    }
    for (const row of phaseRows || []) {
      if (row.status !== "held") continue;
      const { error } = await supabase.from("bid_phase_payments").update({ refunded_cents: refunded }).eq("id", row.id).eq("status", "held");
      if (error) throw new Error(`Phase partial refund mirror failed: ${error.message}`);
    }
    const bidId = bid?.id || phaseRows?.[0]?.bid_id || null;
    const released = (bid?.payment_status === "released") || (phaseRows || []).some((r) => r.status === "released");
    alertOps("partial_refund_needs_review", { payment_intent: paymentIntentId, bid_id: bidId, amount_refunded: refunded, amount: charge.amount, already_released: released });
    await notifyAdmins({
      type: "partial_refund",
      title: `Partial refund · ${dollars(refunded)} of ${dollars(charge.amount)}`,
      body: released
        ? "This payment was already released. Decide whether to reverse part of the transfer."
        : "The rest is frozen. It won't release automatically. Settle it in Stripe, then release or refund it.",
      link: bidId ? `/engagement.html?bid=${bidId}` : null,
    });
    return;
  }

  if (bid) {
    if (bid.payment_status === "released") {
      alertOps("refund_after_release", { bid_id: bid.id, payment_intent: paymentIntentId });
    } else if (bid.payment_status !== "refunded") {
      const { error } = await supabase
        .from("bids")
        .update({ payment_status: "refunded", status: "rejected", refunded_cents: Number(charge.amount_refunded) || 0 })
        .eq("id", bid.id)
        .neq("payment_status", "released");
      if (error) throw new Error(`Bid refund mirror failed: ${error.message}`);
    }
  }
  for (const row of phaseRows || []) {
    if (row.status === "released") {
      alertOps("refund_after_release", { bid_id: row.bid_id, phase_id: row.id, payment_intent: paymentIntentId });
    } else if (row.status !== "refunded") {
      const { error } = await supabase
        .from("bid_phase_payments")
        .update({ status: "refunded", refunded_at: now, refunded_cents: Number(charge.amount_refunded) || 0 })
        .eq("id", row.id)
        .neq("status", "released");
      if (error) throw new Error(`Phase refund mirror failed: ${error.message}`);
    }
  }
}

/* transfer.reversed — money we paid a consultant was pulled back (by us
   or support in the dashboard). Our rows keep "released" since the
   engagement did complete; ops needs to know the books changed. */
async function onTransferReversed(transfer) {
  alertOps("transfer_reversed", {
    transfer: transfer?.id,
    amount_reversed: transfer?.amount_reversed,
    destination: idOf(transfer?.destination),
    bid_id: transfer?.metadata?.bid_id || null,
  });
}

/* payout.failed — fires on the consultant's connected account (Connect
   endpoint) when their bank rejects a payout. Stripe returns the money to
   their Stripe balance; they need to fix their bank details. */
async function onPayoutFailed(payout, accountId) {
  if (!supabase || !accountId) return;
  const { data: profile } = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_account_id", accountId)
    .maybeSingle();
  alertOps("payout_failed", { account: accountId, payout: payout?.id, code: payout?.failure_code || null, user_id: profile?.id || null });
  if (!profile?.id) return;
  await notifyUser(profile.id, {
    type: "payout_failed",
    title: "Your payout didn't go through",
    body: "Your bank returned the payout. Update your bank details in the payout tab and Stripe will retry.",
    link: "/settings.html#payout",
  });
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const sanitizeFileName = (name) => name.replace(/[^a-zA-Z0-9._-]/g, "_");
const getBearerToken = (req) => {
  const authHeader = req.headers.authorization;
  return typeof authHeader === "string" && authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : "";
};
const getStorageFileName = (filePath) => String(filePath || "").split("/").pop() || "resume";

async function getViewerFromRequest(req) {
  const token = getBearerToken(req);
  if (!token) return null;

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) return null;

  const viewerId = userData.user.id;
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", viewerId)
    .maybeSingle();

  return {
    id: viewerId,
    role: profile?.role || null,
  };
}

async function createResumeSignedUrl(resumePath, expiresInSeconds = 60 * 30) {
  if (!resumePath) return null;
  const { data, error } = await supabase.storage
    .from("resumes")
    .createSignedUrl(resumePath, expiresInSeconds);
  if (error) {
    console.warn("[resume-signed-url]", error.message || error);
    return null;
  }
  return data?.signedUrl || null;
}

// Mirrors public.can_view_consultant(): a business owner sees a consultant
// only after the consultant sent an offer on one of their listings or a
// message to them.
async function viewerCanSeeConsultant(viewer, consultantId) {
  if (!viewer?.id) return false;
  if (viewer.id === consultantId) return true;
  const [bidRes, msgRes] = await Promise.all([
    supabase
      .from("bids")
      .select("id, listings!inner(owner_id)")
      .eq("consultant_id", consultantId)
      .eq("listings.owner_id", viewer.id)
      .limit(1),
    supabase
      .from("messages")
      .select("id")
      .eq("sender_id", consultantId)
      .eq("recipient_id", viewer.id)
      .limit(1),
  ]);
  return Boolean(bidRes.data?.length || msgRes.data?.length);
}

function canViewerAccessResume(viewer, consultantId, profile) {
  return Boolean(
    profile?.resume_path &&
    (
      viewer?.id === consultantId ||
      profile?.resume_public
    )
  );
}

// CSP violation reports from the Report-Only policy in vercel.json. Logged
// so the allowlist can be checked against real traffic before enforcing.
app.post(
  "/api/csp-report",
  express.json({ type: ["application/csp-report", "application/reports+json", "application/json"], limit: "16kb" }),
  (req, res) => {
    const r = req.body?.["csp-report"] || req.body?.[0]?.body || req.body || {};
    console.warn("[csp-report]", JSON.stringify({
      page: r["document-uri"] || r.documentURL,
      directive: r["violated-directive"] || r.effectiveDirective,
      blocked: r["blocked-uri"] || r.blockedURL,
    }));
    res.status(204).end();
  }
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, supabaseConfigured: hasSupabaseAdminConfig });
});

app.get("/api/public-config", (_req, res) => {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    return res.status(503).json({
      error: SUPABASE_BROWSER_CONFIG_ERROR,
    });
  }
  res.json({
    supabaseUrl: SUPABASE_URL,
    supabaseAnonKey: SUPABASE_ANON_KEY,
    stripePublishableKey: STRIPE_PUBLISHABLE_KEY || null,
  });
});

app.use("/api", (req, res, next) => {
  if (req.path === "/public-config") {
    return next();
  }

  if (!supabase) {
    return res.status(503).json({
      error: SUPABASE_ADMIN_CONFIG_ERROR,
    });
  }

  next();
});

/**
 * Business owners only: resolve Instagram profile picture via Instagram's public
 * web_profile_info endpoint and store it as profiles.avatar_path. Fails softly (JSON ok: false).
 */
app.post("/api/profile/instagram-avatar", express.json(), async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing token" });
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ ok: false, error: "Invalid session" });
  }

  const userId = userData.user.id;
  const instagramUrl =
    typeof req.body?.instagramUrl === "string" ? req.body.instagramUrl.trim() : "";
  if (!instagramUrl) {
    return res.status(400).json({ ok: false, error: "instagramUrl required" });
  }

  const { data: profile, error: profErr } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .maybeSingle();
  if (profErr || profile?.role !== "business_owner") {
    return res.status(403).json({ ok: false, error: "Business owners only" });
  }

  try {
    const result = await syncInstagramProfileAvatar({ supabase, userId, instagramUrl });
    if (!result.ok) {
      return res.json({ ok: false, skipped: true });
    }
    return res.json({
      ok: true,
      avatarPath: result.avatarPath,
      publicUrl: result.publicUrl,
    });
  } catch (err) {
    console.warn("[instagram-avatar]", err?.message || err);
    return res.json({ ok: false, skipped: true });
  }
});

/* Listing geocoder — looks up the listing's owner business_address,
   geocodes via the free US Census Geocoder (no API key required, US
   addresses only), and writes the result back to listings.lat/lng.
   Called by the client after a listing is inserted/updated; failures
   are non-fatal (the listing exists without coords and just won't
   appear in the marketplace "local" bucket). */
async function geocodeAddress(address) {
  const trimmed = String(address || "").trim();
  if (!trimmed) return null;
  const url =
    "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress" +
    `?address=${encodeURIComponent(trimmed)}` +
    "&benchmark=Public_AR_Current&format=json";
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(url, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return null;
    const body = await res.json().catch(() => null);
    const match = body?.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;
    const { x, y } = match.coordinates; // x = lng, y = lat
    if (typeof x !== "number" || typeof y !== "number") return null;
    return { lat: y, lng: x };
  } catch (_) {
    return null;
  }
}

app.post("/api/listings/:id/geocode", express.json(), async (req, res) => {
  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ ok: false, error: "Missing token" });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ ok: false, error: "Invalid session" });
  }
  const userId = userData.user.id;
  const listingId = String(req.params.id || "");
  if (!listingId) return res.status(400).json({ ok: false, error: "Missing listing ID" });

  const { data: listing, error: listingErr } = await supabase
    .from("listings")
    .select("id, owner_id")
    .eq("id", listingId)
    .maybeSingle();
  if (listingErr || !listing) {
    return res.status(404).json({ ok: false, error: "Listing not found" });
  }
  if (listing.owner_id !== userId) {
    return res.status(403).json({ ok: false, error: "Not your listing" });
  }

  const { data: bp } = await supabase
    .from("business_profiles")
    .select("business_address")
    .eq("user_id", userId)
    .maybeSingle();
  const coords = await geocodeAddress(bp?.business_address);
  if (!coords) {
    return res.json({ ok: true, geocoded: false });
  }
  await supabase
    .from("listings")
    .update({ lat: coords.lat, lng: coords.lng })
    .eq("id", listingId);
  return res.json({ ok: true, geocoded: true, lat: coords.lat, lng: coords.lng });
});

/* Account-deletion request — stub for the v1 security tab.
   Logs the request so we have a trail; real teardown (Stripe Connect
   detach, FK cascade sweep, supabase admin.deleteUser) happens in a
   later milestone. Returns 200 + a `pending: true` flag so the UI can
   surface the right messaging. */
app.post("/api/account/delete-request", express.json(), async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing token" });
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ ok: false, error: "Invalid session" });
  }
  const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim().toLowerCase() : "";
  if (confirm !== "delete my account") {
    return res.status(400).json({ ok: false, error: "Missing confirmation phrase" });
  }

  const userId = userData.user.id;
  const userEmail = userData.user.email || "";
  const requestedAt = new Date().toISOString();

  // Idempotent: only stamp deletion_requested_at the first time. Re-sending
  // emails on repeat clicks is annoying. We still return ok so the UI is
  // consistent.
  const { data: existing } = await supabase
    .from("profiles")
    .select("deletion_requested_at")
    .eq("id", userId)
    .maybeSingle();

  const alreadyRequested = Boolean(existing?.deletion_requested_at);

  if (!alreadyRequested) {
    await supabase
      .from("profiles")
      .update({ deletion_requested_at: requestedAt })
      .eq("id", userId);

    // Best-effort: send the admin notification + the user confirmation.
    // sendEmail no-ops cleanly when RESEND_API_KEY isn't configured.
    sendEmail({
      to: PRIVACY_ADMIN_EMAIL,
      subject: `[grassroots] account deletion request — ${userEmail || userId}`,
      replyTo: userEmail || undefined,
      text:
        `A user has requested deletion of their account.\n\n` +
        `User ID: ${userId}\n` +
        `Email:   ${userEmail}\n` +
        `Requested at: ${requestedAt}\n\n` +
        `Process per docs/account-deletion-process.md within 14 days.`,
    }).catch((e) => console.warn("[delete-request] admin email failed", e?.message));
    // In-app too, so the request is seen even before email is configured.
    notifyAdmins({
      type: "account_deletion_requested",
      title: "Account deletion requested",
      body: `${userEmail || userId} asked to delete their account. Process within 14 days.`,
      link: null,
    }).catch(() => {});

    if (userEmail) {
      sendEmail({
        to: userEmail,
        subject: "We received your deletion request",
        text:
          `hi,\n\n` +
          `We received your request to delete your Grassroots account. ` +
          `We'll process it within 14 days and email you again to confirm when it's done. ` +
          `If you didn't make this request, reply to this email immediately and we'll cancel it.\n\n` +
          `— grassroots`,
      }).catch((e) => console.warn("[delete-request] user email failed", e?.message));
    }
  }

  console.log(
    "[account-delete-request]",
    JSON.stringify({
      userId,
      email: userEmail,
      at: requestedAt,
      alreadyRequested,
    })
  );

  return res.json({
    ok: true,
    pending: true,
    requested_at: existing?.deletion_requested_at || requestedAt,
    already_requested: alreadyRequested,
  });
});

// Data export request — same shape as delete-request. Logs + emails admin;
// admin runs the export script and sends the user a download link. Manual
// for v1 (see docs/data-export-process.md).
app.post("/api/account/export-request", express.json(), async (req, res) => {
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ ok: false, error: "Missing token" });
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ ok: false, error: "Invalid session" });
  }
  const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim().toLowerCase() : "";
  if (confirm !== "export my data") {
    return res.status(400).json({ ok: false, error: "Missing confirmation phrase" });
  }

  const userId = userData.user.id;
  const userEmail = userData.user.email || "";
  const requestedAt = new Date().toISOString();

  await supabase
    .from("profiles")
    .update({ export_requested_at: requestedAt })
    .eq("id", userId);

  sendEmail({
    to: PRIVACY_ADMIN_EMAIL,
    subject: `[grassroots] data export request — ${userEmail || userId}`,
    replyTo: userEmail || undefined,
    text:
      `A user has requested a copy of their personal data.\n\n` +
      `User ID: ${userId}\n` +
      `Email:   ${userEmail}\n` +
      `Requested at: ${requestedAt}\n\n` +
      `Fulfill per docs/data-export-process.md within 30 days.`,
  }).catch((e) => console.warn("[export-request] admin email failed", e?.message));
  notifyAdmins({
    type: "data_export_requested",
    title: "Data export requested",
    body: `${userEmail || userId} asked for a copy of their data. Fulfil within 30 days.`,
    link: null,
  }).catch(() => {});

  if (userEmail) {
    sendEmail({
      to: userEmail,
      subject: "We received your data export request",
      text:
        `hi,\n\n` +
        `We received your request for a copy of your Grassroots data. ` +
        `We'll email you a secure download link within 30 days. ` +
        `If you didn't make this request, reply to this email and we'll cancel it.\n\n` +
        `— grassroots`,
    }).catch((e) => console.warn("[export-request] user email failed", e?.message));
  }

  console.log(
    "[account-export-request]",
    JSON.stringify({ userId, email: userEmail, at: requestedAt })
  );

  return res.json({ ok: true, pending: true, requested_at: requestedAt });
});


function appOrigin(req) {
  const configured = envTrim("APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  const proto = req.get("x-forwarded-proto") || req.protocol || "http";
  const host = req.get("x-forwarded-host") || req.get("host");
  return `${proto}://${host}`;
}

function inviteAdminAuthorized(req) {
  const secret = envTrim("CONSULTANT_INVITE_SECRET");
  if (!secret) return false;
  const header = String(req.get("x-invite-admin-secret") || "");
  const presented = header || getBearerToken(req);
  const a = Buffer.from(presented);
  const b = Buffer.from(secret);
  if (!presented || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseEducations(raw, verifiedSchool) {
  let list = [];
  if (raw && String(raw).trim()) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) list = parsed;
    } catch (_) {
      list = [];
    }
  }
  list = list.slice(0, 6).map((entry) => ({
    degree: typeof entry?.degree === "string" ? entry.degree.slice(0, 40) : null,
    major: typeof entry?.major === "string" ? entry.major.trim().slice(0, 120) || null : null,
    minor: typeof entry?.minor === "string" ? entry.minor.trim().slice(0, 120) || null : null,
    school: typeof entry?.school === "string" ? entry.school.trim().slice(0, 200) || null : null,
  }));
  if (!list.length) {
    list = [{ degree: null, major: null, minor: null, school: verifiedSchool }];
  }
  list[0].school = verifiedSchool;
  return list;
}

app.get("/api/consultant-invite", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: SUPABASE_ADMIN_CONFIG_ERROR });
  }
  res.set("Cache-Control", "no-store");
  const invite = await lookupInvite(supabase, String(req.query.token || ""));
  if (!invite) {
    return res.status(404).json({ error: "This invite link is no longer valid." });
  }
  return res.json({ email: invite.email });
});

app.post("/api/admin/consultant-invites", async (req, res) => {
  if (!supabase) {
    return res.status(503).json({ error: SUPABASE_ADMIN_CONFIG_ERROR });
  }
  if (!envTrim("CONSULTANT_INVITE_SECRET")) {
    return res.status(503).json({ error: "Invite admin is not configured." });
  }
  if (!inviteAdminAuthorized(req)) {
    return res.status(401).json({ error: "Not allowed." });
  }
  try {
    const invite = await createInvite(supabase, {
      email: req.body?.email,
      expiresInDays: req.body?.expiresInDays,
      appUrl: appOrigin(req),
    });
    return res.status(201).json(invite);
  } catch (error) {
    return res.status(error.status || 500).json({ error: error.message || "Could not create invite." });
  }
});

app.post("/api/register", upload.single("resume"), async (req, res) => {
  const {
    email,
    password,
    role,
    fullName,
    phoneNumber,
    linkedinUrl,
    businessName,
    websiteUrl,
    socialLinks,
    businessDetails,
    currentEfforts,
    accepted_terms,
    inviteToken,
    verifiedSchool,
    educations: educationsRaw,
  } = req.body;

  if (!email || !password || !role || !fullName || !String(phoneNumber || "").trim()) {
    return res.status(400).json({ error: "Email, password, role, full name, and phone number are required." });
  }

  if (!["business_owner", "consultant"].includes(role)) {
    return res.status(400).json({ error: "Invalid role selection." });
  }

  // Privacy + terms consent. The client-side gate blocks submission without
  // it, but enforce server-side too so the column reliably reflects
  // affirmative consent (and so a hand-crafted request can't bypass).
  const acceptedTerms =
    accepted_terms === "1" ||
    accepted_terms === true ||
    accepted_terms === "true" ||
    accepted_terms === "on";
  if (!acceptedTerms) {
    return res.status(400).json({
      error: "You must agree to the privacy policy and terms of service to create an account.",
    });
  }
  const termsAcceptedAt = new Date().toISOString();

  let parsedSocialLinks = null;
  if (socialLinks && socialLinks.trim()) {
    parsedSocialLinks = socialLinks
      .split(",")
      .map((link) => link.trim())
      .filter(Boolean);
  }

  let accountEmail = String(email).trim();
  let inviteId = null;
  let userId = null;
  let consultantEducations = [];
  const schoolName = String(verifiedSchool || "").trim();

  try {
    if (role === "consultant") {
      accountEmail = normalizeEmail(email);
      const match = schoolMatchesEmail(schoolName, accountEmail);
      if (!match.ok) {
        return res.status(400).json({ error: match.error });
      }
      const claim = await claimInvite(supabase, inviteToken, accountEmail);
      if (!claim.ok) {
        return res.status(400).json({ error: claim.error });
      }
      inviteId = claim.id;
      consultantEducations = parseEducations(educationsRaw, schoolName);
    }

    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email: accountEmail,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
      },
    });

    if (userError || !userData?.user) {
      if (inviteId) await releaseInvite(supabase, inviteId);
      return res.status(400).json({ error: userError?.message || "Unable to create user." });
    }

    userId = userData.user.id;
    let resumePath = null;

    if (req.file) {
      const safeName = sanitizeFileName(req.file.originalname);
      const lowerName = safeName.toLowerCase();
      const isPdf =
        req.file.mimetype === "application/pdf" || lowerName.endsWith(".pdf");
      if (!isPdf) {
        await supabase.auth.admin.deleteUser(userId);
        if (inviteId) await releaseInvite(supabase, inviteId);
        return res.status(400).json({ error: "Resume must be a PDF." });
      }

      resumePath = `${userId}/${Date.now()}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("resumes")
        .upload(resumePath, req.file.buffer, {
          contentType: req.file.mimetype || "application/octet-stream",
          upsert: false,
        });

      if (uploadError) {
        await supabase.auth.admin.deleteUser(userId);
        if (inviteId) await releaseInvite(supabase, inviteId);
        return res.status(400).json({ error: `Resume upload failed: ${uploadError.message}` });
      }
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      role,
      full_name: fullName,
      phone_number: String(phoneNumber || "").trim(),
      linkedin_url: linkedinUrl || null,
      resume_path: resumePath,
      terms_accepted_at: termsAcceptedAt,
    });

    if (profileError) {
      await supabase.auth.admin.deleteUser(userId);
      if (inviteId) await releaseInvite(supabase, inviteId);
      return res.status(400).json({ error: `Profile creation failed: ${profileError.message}` });
    }

    if (role === "business_owner") {
      const { error: businessError } = await supabase.from("business_profiles").insert({
        user_id: userId,
        business_name: businessName || null,
        website_url: websiteUrl || null,
        social_links: parsedSocialLinks,
        business_details: businessDetails || null,
        current_efforts: currentEfforts || null,
      });

      if (businessError) {
        await supabase.from("profiles").delete().eq("id", userId);
        await supabase.auth.admin.deleteUser(userId);
        return res.status(400).json({ error: `Business profile failed: ${businessError.message}` });
      }
    }

    if (role === "consultant") {
      const primary = consultantEducations[0] || {};
      const { error: consultantError } = await supabase.from("consultant_profiles").insert({
        user_id: userId,
        school: schoolName,
        major: primary.major || null,
        minor: primary.minor || null,
        educations: consultantEducations,
      });

      if (consultantError) {
        await supabase.from("profiles").delete().eq("id", userId);
        await supabase.auth.admin.deleteUser(userId);
        await releaseInvite(supabase, inviteId);
        return res.status(400).json({ error: `Consultant profile failed: ${consultantError.message}` });
      }
      await attachInviteUser(supabase, inviteId, userId);
    }

    return res.status(201).json({
      message: "Registration complete.",
      userId,
      role,
    });
  } catch (error) {
    if (userId) {
      await supabase.from("profiles").delete().eq("id", userId);
      await supabase.auth.admin.deleteUser(userId);
    }
    if (inviteId) await releaseInvite(supabase, inviteId, { force: true });
    return res.status(500).json({ error: error.message || "Unexpected server error." });
  }
});

// OAuth-complete endpoint. The client-side trigger in register-flow.js
// has been removed while OAuth is paused; the endpoint stays intact for
// when providers are re-wired and /oauth.js + /register-flow.js add the
// post-OAuth branches back.
app.post("/api/oauth-complete", express.json(), async (req, res) => {
  const { userId, role, fullName, phoneNumber } = req.body;

  if (!userId || !role || !fullName || !String(phoneNumber || "").trim()) {
    return res.status(400).json({ error: "userId, role, fullName, and phoneNumber are required." });
  }

  if (!["business_owner", "consultant"].includes(role)) {
    return res.status(400).json({ error: "Invalid role selection." });
  }

  // Verify the caller is the user they claim to be. Without this an
  // attacker who knows a victim's UUID (e.g. from a public consultant
  // profile URL) could pre-create a profile for them before they finish
  // OAuth, locking in attacker-chosen role/name/phone.
  const token = getBearerToken(req);
  if (!token) {
    return res.status(401).json({ error: "Missing access token." });
  }
  const { data: authData, error: authErr } = await supabase.auth.getUser(token);
  if (authErr || !authData?.user?.id) {
    return res.status(401).json({ error: "Invalid access token." });
  }
  if (authData.user.id !== userId) {
    return res.status(403).json({ error: "Token does not match userId." });
  }

  try {
    const { data: existing } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (existing) {
      return res.status(200).json({ message: "Profile already exists.", userId, role });
    }

    if (role === "consultant") {
      return res.status(403).json({ error: "Consultant accounts need an invite link." });
    }

    const { error: profileError } = await supabase.from("profiles").insert({
      id: userId,
      role,
      full_name: fullName,
      phone_number: String(phoneNumber || "").trim(),
    });

    if (profileError) {
      return res.status(400).json({ error: `Profile creation failed: ${profileError.message}` });
    }

    if (role === "business_owner") {
      await supabase.from("business_profiles").insert({ user_id: userId });
    }

    await supabase.auth.admin.updateUserById(userId, {
      user_metadata: { full_name: fullName, role },
    });

    return res.status(201).json({ message: "Profile created.", userId, role });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected server error." });
  }
});

app.get("/api/listings/:id/owner-bids", async (req, res) => {
  const listingId = req.params.id;
  if (!listingId) {
    return res.status(400).json({ error: "Missing listing ID." });
  }

  try {
    const viewer = await getViewerFromRequest(req);
    if (!viewer?.id || viewer.role !== "business_owner") {
      return res.status(403).json({ error: "Business owners only." });
    }

    const { data: listing, error: listingError } = await supabase
      .from("listings")
      .select("id, owner_id")
      .eq("id", listingId)
      .maybeSingle();

    if (listingError || !listing) {
      return res.status(404).json({ error: "Listing not found." });
    }

    if (listing.owner_id !== viewer.id) {
      return res.status(403).json({ error: "You do not have access to these proposals." });
    }

    const bidCols = `id, listing_id, consultant_id, amount_cents, proposal_fee_cents, service_fee_cents, move_forward_status, message, status,
         counter_offer_cents, counter_offer_message, counter_expires_at, counter_responded_at, counter_response_message, counter_attempted, accepted_at, proposal_due_at, proposal_path, created_at,
         profiles!bids_consultant_id_fkey ( id, full_name, linkedin_url, avatar_path )`;
    const loadBids = (cols) => supabase
      .from("bids")
      .select(cols)
      .eq("listing_id", listingId)
      .order("created_at", { ascending: true });
    // Pitch columns come from add_bid_pitch_timeline_files.sql; fall back
    // to the base set until that migration is applied.
    let { data: bids, error: bidsError } = await loadBids(`${bidCols}, timeline_days, pitch_files`);
    if (bidsError?.code === "42703") {
      ({ data: bids, error: bidsError } = await loadBids(bidCols));
    }

    if (bidsError) {
      return res.status(500).json({ error: bidsError.message || "Could not load proposals." });
    }

    const consultantIds = [...new Set((bids || []).map((bid) => bid.consultant_id).filter(Boolean))];
    let educationMap = new Map();

    if (consultantIds.length) {
      const { data: educationRows, error: educationError } = await supabase
        .from("consultant_profiles")
        .select("user_id, major, minor, school, educations")
        .in("user_id", consultantIds);

      if (!educationError && Array.isArray(educationRows)) {
        educationMap = new Map(educationRows.map((row) => [row.user_id, row]));
      }
    }

    // Sign pitch files for the owner. Only paths under this bid's own
    // consultant/listing folder are signed — pitch_files is consultant-
    // written, so a path pointing anywhere else is dropped.
    const signedPitchFiles = new Map();
    const pitchPaths = [];
    for (const bid of bids || []) {
      const prefix = `${bid.consultant_id}/${bid.listing_id}/`;
      const files = (Array.isArray(bid.pitch_files) ? bid.pitch_files : [])
        .filter((f) => typeof f?.path === "string" && f.path.startsWith(prefix) && !f.path.includes(".."));
      signedPitchFiles.set(bid.id, files);
      pitchPaths.push(...files.map((f) => f.path));
    }
    const urlByPath = new Map();
    if (pitchPaths.length) {
      const { data: signed } = await supabase.storage.from("bid-files").createSignedUrls(pitchPaths, 60 * 60);
      for (const row of signed || []) {
        if (row?.path && row.signedUrl) urlByPath.set(row.path, row.signedUrl);
      }
    }

    return res.json({
      bids: (bids || []).map((bid) => ({
        ...bid,
        pitch_files: (signedPitchFiles.get(bid.id) || []).map((f) => ({
          name: f.name || getStorageFileName(f.path),
          size: Number(f.size) || null,
          url: urlByPath.get(f.path) || null,
        })),
        education: educationMap.get(bid.consultant_id) || null,
      })),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error." });
  }
});

app.get("/api/consultant-profile/:id", async (req, res) => {
  const consultantId = req.params.id;
  if (!consultantId) {
    return res.status(400).json({ error: "Missing consultant ID." });
  }

  try {
    const viewer = await getViewerFromRequest(req);
    if (!(await viewerCanSeeConsultant(viewer, consultantId))) {
      return res.status(404).json({ error: "Consultant profile not found." });
    }

    // Try with resume_public column first; fall back if column doesn't exist yet
    let profile = null;
    {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, linkedin_url, avatar_path, resume_path, resume_public, created_at")
        .eq("id", consultantId)
        .eq("role", "consultant")
        .maybeSingle();
      if (!error) {
        profile = data;
      } else {
        // Column likely missing — retry without resume_public
        const { data: fallback, error: fbErr } = await supabase
          .from("profiles")
          .select("id, full_name, linkedin_url, avatar_path, resume_path, created_at")
          .eq("id", consultantId)
          .eq("role", "consultant")
          .maybeSingle();
        if (fbErr || !fallback) {
          return res.status(404).json({ error: "Consultant profile not found." });
        }
        profile = { ...fallback, resume_public: false };
      }
    }

    if (!profile) {
      return res.status(404).json({ error: "Consultant profile not found." });
    }

    let consultantProfile = null;
    try {
      const { data, error } = await supabase
        .from("consultant_profiles")
        .select("major, minor, school, educations")
        .eq("user_id", consultantId)
        .maybeSingle();
      if (!error) consultantProfile = data;
    } catch (_) {}

    // Bio meta row: city lives on consultant_profiles (own query so a
    // missing column can't take education down with it); completed count
    // is delivered standard bids.
    let city = null;
    try {
      const { data, error } = await supabase
        .from("consultant_profiles")
        .select("city")
        .eq("user_id", consultantId)
        .maybeSingle();
      if (!error) city = data?.city || null;
    } catch (_) {}

    let completedCount = 0;
    try {
      const { count, error } = await supabase
        .from("bids")
        .select("id", { count: "exact", head: true })
        .eq("consultant_id", consultantId)
        .eq("status", "accepted")
        .not("delivered_at", "is", null);
      if (!error) completedCount = count || 0;
    } catch (_) {}

    let portfolioItems = [];
    try {
      const { data, error } = await supabase
        .from("portfolio_items")
        .select("id, file_path, file_type, description")
        .eq("user_id", consultantId)
        .eq("is_public", true)
        .order("sort_order", { ascending: true });
      if (!error) portfolioItems = data || [];
    } catch (_) {}

    // Build public avatar URL
    let avatarUrl = null;
    if (profile.avatar_path) {
      const { data: pub } = supabase.storage.from("avatars").getPublicUrl(profile.avatar_path);
      avatarUrl = pub?.publicUrl || null;
    }

    // Build portfolio file URLs
    const portfolioWithUrls = portfolioItems.map((item) => {
      const { data: pub } = supabase.storage.from("portfolio").getPublicUrl(item.file_path);
      return { ...item, url: pub?.publicUrl || null };
    });

    const canViewResume = canViewerAccessResume(viewer, consultantId, profile);

    let rating = null;
    try {
      const { data, error } = await supabase.rpc("get_consultant_rating", { target_consultant_id: consultantId });
      if (!error && Array.isArray(data) && data[0]) {
        rating = {
          review_count: Number(data[0].review_count) || 0,
          rating_average: data[0].rating_average == null ? null : Number(data[0].rating_average),
          work_product_quality_avg: data[0].work_product_quality_avg == null ? null : Number(data[0].work_product_quality_avg),
          communication_avg: data[0].communication_avg == null ? null : Number(data[0].communication_avg),
          timeliness_avg: data[0].timeliness_avg == null ? null : Number(data[0].timeliness_avg),
          professionalism_avg: data[0].professionalism_avg == null ? null : Number(data[0].professionalism_avg),
          cost_value_avg: data[0].cost_value_avg == null ? null : Number(data[0].cost_value_avg),
        };
      }
    } catch (_) {}

    return res.json({
      profile: {
        id: profile.id,
        full_name: profile.full_name,
        linkedin_url: profile.linkedin_url,
        avatar_url: avatarUrl,
        resume_on_file: profile.resume_public && Boolean(profile.resume_path),
        resume_available: canViewResume,
        resume_file_name: profile.resume_path ? getStorageFileName(profile.resume_path) : null,
        city,
        member_since: profile.created_at || null,
        completed_count: completedCount,
      },
      education: consultantProfile || {},
      portfolio: portfolioWithUrls,
      rating,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error." });
  }
});

app.get("/api/consultant-ratings", async (req, res) => {
  const idsParam = String(req.query.ids || "").trim();
  if (!idsParam) return res.json({ ratings: {} });
  const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length) return res.json({ ratings: {} });
  try {
    const { data, error } = await supabase.rpc("get_consultant_ratings", { target_consultant_ids: ids });
    // If the RPC isn't deployed yet, return empty ratings rather than 500ing
    // every consumer page. Apply the migration to surface real aggregates.
    if (error) {
      const msg = String(error.message || "").toLowerCase();
      if (msg.includes("could not find") || msg.includes("does not exist") || msg.includes("schema cache")) {
        return res.json({ ratings: {} });
      }
      return res.status(500).json({ error: error.message });
    }
    const ratings = {};
    for (const row of data || []) {
      ratings[row.consultant_id] = {
        review_count: Number(row.review_count) || 0,
        rating_average: row.rating_average == null ? null : Number(row.rating_average),
      };
    }
    return res.json({ ratings });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error." });
  }
});

app.get("/api/consultant-profile/:id/resume", async (req, res) => {
  const consultantId = req.params.id;
  if (!consultantId) {
    return res.status(400).json({ error: "Missing consultant ID." });
  }

  try {
    const { data: profile, error } = await supabase
      .from("profiles")
      .select("id, role, resume_path, resume_public")
      .eq("id", consultantId)
      .eq("role", "consultant")
      .maybeSingle();

    if (error || !profile?.resume_path) {
      return res.status(404).json({ error: "Resume not found." });
    }

    const viewer = await getViewerFromRequest(req);
    if (!(await viewerCanSeeConsultant(viewer, consultantId)) || !canViewerAccessResume(viewer, consultantId, profile)) {
      return res.status(403).json({ error: "Resume is not available to this viewer." });
    }

    const resumeUrl = await createResumeSignedUrl(profile.resume_path);
    if (!resumeUrl) {
      return res.status(500).json({ error: "Could not generate resume access." });
    }

    return res.json({
      url: resumeUrl,
      file_name: getStorageFileName(profile.resume_path),
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Server error." });
  }
});

/* ================================================================
   Stripe Connect (Custom) — escrow-style payments.
   Test mode only: requires STRIPE_SECRET_KEY=sk_test_… in .env.
   ================================================================ */

function requireStripe(res) {
  if (!stripe) {
    res.status(503).json({ error: "Stripe is not configured on this server." });
    return false;
  }
  return true;
}

/* Platform-level defaults for the Stripe `business_profile`. We pre-fill
   these on every consultant's Connect account so they don't see the
   "Business details / Industry / Your website" screens during onboarding —
   those fields are network-level requirements, but Stripe accepts the
   platform's URL + MCC for individuals operating through a marketplace.
   - 7392: "Management, Consulting, and Public Relations Services" — broad
     enough to cover any consulting work on grassroots.
   - PLATFORM_URL: defaults to the deployed grassroots URL; override via env
     for previews / sandbox. */
const PLATFORM_URL = envTrim("PLATFORM_URL") || "https://www.grassroots-marketplace.com";
const CONSULTANT_BUSINESS_PROFILE = {
  mcc: "7392",
  url: PLATFORM_URL,
  product_description:
    "Independent consulting services arranged through the Grassroots Marketplace.",
};

async function ensureConsultantStripeAccount(viewerId) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, stripe_account_id, stripe_account_status")
    .eq("id", viewerId)
    .maybeSingle();
  if (error) {
    if (/stripe_account_id|stripe_account_status|column .* does not exist/i.test(error.message || "")) {
      throw new Error("Payments schema not deployed yet — run supabase/migrations/add_stripe_fields.sql.");
    }
    throw new Error(error.message);
  }
  if (!profile) throw new Error("Profile not found.");
  if (profile.role !== "consultant") throw new Error("Only consultants can set up payouts.");

  if (profile.stripe_account_id) {
    // Account already exists — backfill business_profile if Stripe still
    // shows it as missing (covers accounts created before this change).
    try {
      const acct = await stripe.accounts.retrieve(profile.stripe_account_id);
      const bp = acct.business_profile || {};
      if (!bp.mcc || !bp.url) {
        await stripe.accounts.update(profile.stripe_account_id, {
          business_profile: CONSULTANT_BUSINESS_PROFILE,
        });
      }
    } catch (_) { /* non-fatal — onboarding will still work */ }
    return profile;
  }

  const account = await stripe.accounts.create({
    type: "custom",
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    business_type: "individual",
    business_profile: CONSULTANT_BUSINESS_PROFILE,
    metadata: { grassroots_user_id: viewerId },
  }, { idempotencyKey: idemKey("account", viewerId) });

  await supabase
    .from("profiles")
    .update({ stripe_account_id: account.id, stripe_account_status: "pending" })
    .eq("id", viewerId);

  return { ...profile, stripe_account_id: account.id, stripe_account_status: "pending" };
}

async function ensureOwnerStripeCustomer(viewerId) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, full_name, stripe_customer_id")
    .eq("id", viewerId)
    .maybeSingle();
  if (error) {
    if (/stripe_customer_id|column .* does not exist/i.test(error.message || "")) {
      throw new Error("Payments schema not deployed yet — run supabase/migrations/add_stripe_fields.sql.");
    }
    throw new Error(error.message);
  }
  if (!profile) throw new Error("Profile not found.");
  if (profile.stripe_customer_id) return profile;

  const customer = await stripe.customers.create({
    name: profile.full_name || undefined,
    metadata: { grassroots_user_id: viewerId },
  }, { idempotencyKey: idemKey("customer", viewerId) });
  await supabase
    .from("profiles")
    .update({ stripe_customer_id: customer.id })
    .eq("id", viewerId);
  return { ...profile, stripe_customer_id: customer.id };
}

// Consultant: open the embedded onboarding component in our own UI.
app.post("/api/stripe/account-session", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  try {
    const profile = await ensureConsultantStripeAccount(viewer.id);
    const accountSession = await stripe.accountSessions.create({
      account: profile.stripe_account_id,
      components: {
        account_onboarding: { enabled: true },
        account_management: { enabled: true },
        payouts: { enabled: true },
      },
    });
    return res.json({
      client_secret: accountSession.client_secret,
      publishable_key: STRIPE_PUBLISHABLE_KEY,
      account_id: profile.stripe_account_id,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not create account session." });
  }
});

// Consultant: poll onboarding status (charges_enabled / payouts_enabled).
app.get("/api/stripe/account-status", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_account_status")
      .eq("id", viewer.id)
      .maybeSingle();
    if (!profile?.stripe_account_id) {
      return res.json({ onboarded: false, charges_enabled: false, payouts_enabled: false });
    }
    const account = await stripe.accounts.retrieve(profile.stripe_account_id);
    const charges = !!account.charges_enabled;
    const payouts = !!account.payouts_enabled;
    const fullyOnboarded = charges && payouts && account.details_submitted;
    const status = fullyOnboarded ? "active" : "pending";
    if (status !== profile.stripe_account_status) {
      await supabase
        .from("profiles")
        .update({ stripe_account_status: status })
        .eq("id", viewer.id);
    }
    return res.json({
      onboarded: fullyOnboarded,
      charges_enabled: charges,
      payouts_enabled: payouts,
      details_submitted: !!account.details_submitted,
      requirements_due: account.requirements?.currently_due || [],
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load account status." });
  }
});

// Consultant payouts summary — at-a-glance numbers shown above the
// embedded Stripe iframes. Returns USD-only totals from the Balance
// API (available + pending in the platform's eyes on this connected
// account) and the arrival_date + amount of the most recent payout.
//
// Stripe Balance and Payouts are per-account: every call passes
// `stripeAccount: <acct_id>` so we're reading the consultant's own
// view, not the platform's. We deliberately ignore non-USD entries
// — the marketplace is USD-only today, and surfacing zero foreign-
// currency lines would just be noise.
app.get("/api/stripe/balance-summary", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  try {
    const { data: profile } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_account_status")
      .eq("id", viewer.id)
      .maybeSingle();
    if (!profile?.stripe_account_id) {
      return res.json({ onboarded: false, available_cents: 0, pending_cents: 0, last_payout: null });
    }
    const onboarded = profile.stripe_account_status === "active";
    const sumUsd = (entries) => (entries || [])
      .filter((e) => String(e.currency || "").toLowerCase() === "usd")
      .reduce((sum, e) => sum + Number(e.amount || 0), 0);
    // Stripe SDK takes (params, options) — `stripeAccount` is a request
    // option, not a params field. Passing it as params (the previous
    // shape) tripped a 500 with "Received unknown parameter: stripeAccount".
    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve(undefined, { stripeAccount: profile.stripe_account_id }),
      stripe.payouts.list({ limit: 1 }, { stripeAccount: profile.stripe_account_id }),
    ]);
    const lastPayout = payouts.data?.[0]
      ? {
          amount_cents: Number(payouts.data[0].amount || 0),
          currency: payouts.data[0].currency || "usd",
          arrival_date: payouts.data[0].arrival_date || null,
          status: payouts.data[0].status || null,
        }
      : null;
    return res.json({
      onboarded,
      available_cents: sumUsd(balance.available),
      pending_cents: sumUsd(balance.pending),
      last_payout: lastPayout,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load balance summary." });
  }
});

// Owner: create a PaymentIntent for accepting a bid.
//
// Escrow model (separate_charges_and_transfers): the charge captures into the
// platform's connect balance — no `transfer_data.destination` and no
// `on_behalf_of`, so the consultant gets nothing at capture. Funds only reach
// the consultant when `/api/stripe/release-funds` creates a Transfer after
// the owner marks work complete. Refunds before release are clean
// `stripe.refunds.create` calls because the money is still on the platform.
app.post("/api/stripe/payment-intent", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, amount_cents, counter_offer_cents, status, payment_intent_id, payment_status")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr) {
      const msg = bidErr.message || "";
      if (/payment_intent_id|payment_status|column .* does not exist/i.test(msg)) {
        return res.status(503).json({ error: "Payments schema not deployed yet — run supabase/migrations/add_stripe_fields.sql." });
      }
      return res.status(500).json({ error: msg });
    }
    if (!bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, owner_id, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listingErr || !listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.owner_id !== viewer.id) return res.status(403).json({ error: "Only the listing owner can pay." });
    if (bid.payment_status === "held" || bid.payment_status === "released") {
      return res.status(409).json({ error: "This bid is already paid." });
    }

    const offerAmount = Number(bid.counter_offer_cents || bid.amount_cents);
    if (offerAmount === 0) {
      return res.status(400).json({ error: "This offer is free, so there's nothing to pay. Accept it instead.", free: true });
    }
    if (!Number.isFinite(offerAmount) || offerAmount < fees.MIN_PAID_OFFER_CENTS) {
      return res.status(400).json({ error: "Bid amount is invalid for payment." });
    }

    // All-in pricing: the business is charged the offer. The platform
    // and Stripe fees come out of the consultant payout.
    const feeBreakdown = fees.computeFees(offerAmount);
    const amount = feeBreakdown.businessTotalCents;

    // Gate acceptance on the consultant being fully onboarded at Stripe.
    // Funds don't move to them until release, but if they never finish
    // onboarding we'd have to refund the owner — better to block here than
    // to leave the owner mid-engagement with no payout path.
    const { data: consultantProfile } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_account_status")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultantProfile?.stripe_account_id) {
      return res.status(409).json({ error: "This consultant hasn't set up payouts yet — they need to finish onboarding before their offer can be accepted." });
    }
    try {
      const acct = await stripe.accounts.retrieve(consultantProfile.stripe_account_id);
      if (!acct.charges_enabled || !acct.payouts_enabled || !acct.details_submitted) {
        // Backfill our DB to keep status honest with Stripe.
        await supabase
          .from("profiles")
          .update({ stripe_account_status: "pending" })
          .eq("id", bid.consultant_id);
        return res.status(409).json({ error: "This consultant's payout setup isn't fully verified yet. They'll need to finish Stripe onboarding before you can accept their offer." });
      }
    } catch (err) {
      return res.status(502).json({ error: "Could not verify consultant's payout account: " + (err.message || "Stripe error") });
    }

    const owner = await ensureOwnerStripeCustomer(viewer.id);

    // Reuse an existing PaymentIntent if we already created one for this bid
    // (e.g., the owner closed the modal before confirming). Otherwise create.
    let intent;
    if (bid.payment_intent_id) {
      try {
        intent = await stripe.paymentIntents.retrieve(bid.payment_intent_id);
      } catch (_) { intent = null; }
    }
    if (intent?.status === "succeeded") {
      // Already paid — the confirm step just never landed. Finish it
      // instead of minting a second PaymentIntent (a double charge).
      await confirmStandardBidPayment(intent);
      return res.status(409).json({ error: "This bid is already paid." });
    }
    if (intent && ["processing", "requires_capture"].includes(intent.status)) {
      return res.status(409).json({ error: "A payment for this bid is already processing." });
    }
    if (intent && intent.status !== "canceled" && intent.amount !== amount) {
      // The offer changed (e.g. a counter was accepted) since this PI was
      // created. Retire it so the owner can't pay the stale amount.
      try { await stripe.paymentIntents.cancel(intent.id); } catch (_) {}
      intent = null;
    } else if (intent?.status === "canceled") {
      intent = null;
    }
    // Fee breakdown was computed above off the offer amount and used to
    // derive what we charge the business. release-funds re-uses the
    // stored consultant payout figure (offer - stripe fee) as the
    // authoritative number to transfer.

    if (!intent) {
      // Escrow: no `transfer_data.destination` and no `on_behalf_of`, so the
      // charge captures into the platform's connect balance. Funds stay there
      // until `/api/stripe/release-funds` creates a Transfer to the consultant
      // (using `source_transaction: charge_id` so we don't depend on the
      // platform's available balance, which is often $0 in test mode).
      intent = await createPaymentIntentOnce(stripe, {
        amount,
        currency: "usd",
        customer: owner.stripe_customer_id,
        // Card only: bank debits sit in `processing` for days, and the
        // confirm step needs `succeeded`.
        payment_method_types: ["card"],
        // Save the card to the customer so retainer subscriptions (and any
        // future PI on this customer) can charge off-session without
        // re-prompting for card details.
        setup_future_usage: "off_session",
        metadata: {
          bid_id: bidId,
          listing_id: bid.listing_id,
          owner_id: viewer.id,
          consultant_id: bid.consultant_id,
        },
        // "pi-card", not "pi": keys used before the card-only switch were
        // sent with other params, and Stripe rejects a changed request.
      }, idemKey("pi-card", "bid", bidId, bid.payment_intent_id || "none", amount));
      const { error: linkErr } = await supabase
        .from("bids")
        .update({
          payment_intent_id: intent.id,
          payment_status: "authorizing",
          payment_amount_cents: amount,
          stripe_fee_cents: feeBreakdown.stripeFeeCents,
          platform_fee_cents: feeBreakdown.platformFeeCents,
          consultant_payout_cents: feeBreakdown.consultantPayoutCents,
        })
        .eq("id", bidId)
        .not("payment_status", "in", "(held,released,refunded)");
      if (linkErr) {
        // Without the link, confirm can't find this PI — don't let the
        // owner pay it.
        try { await stripe.paymentIntents.cancel(intent.id); } catch (_) {}
        return res.status(500).json({ error: "Could not start payment. Try again." });
      }
    }

    return res.json({
      client_secret: intent.client_secret,
      amount,
      currency: "usd",
      title: bid.listings?.title || "engagement",
      fee_breakdown: feeBreakdown,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not start payment." });
  }
});

// Owner: confirm the bid was paid. Server re-validates the PaymentIntent
// directly with Stripe, then flips the bid to `accepted` atomically.
// Owner: accept a free ($0) offer on a standard listing. No Stripe at all —
// the bid goes straight to accepted with a $0 hold, so delivery, review
// and the 14-day automatic close work exactly like a paid job.
app.post("/api/engagement/accept-free", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, amount_cents, counter_offer_cents, status, payment_status")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "Bid not found." });
    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id, contract_type")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) return res.status(403).json({ error: "Only the listing owner can accept." });
    if ((listing.contract_type || "standard") !== "standard") {
      return res.status(400).json({ error: "This offer needs to be accepted through payment." });
    }
    if (bid.counter_offer_cents != null || Number(bid.amount_cents) !== 0) {
      return res.status(400).json({ error: "This offer has a price, so it needs payment." });
    }
    if (["held", "released", "refunded"].includes(bid.payment_status)) {
      return res.json({ ok: true, alreadyAccepted: true });
    }

    const now = new Date().toISOString();
    const { data: flipped, error: updErr } = await supabase
      .from("bids")
      .update({
        status: "accepted",
        accepted_at: now,
        payment_status: "held",
        paid_at: now,
        payment_amount_cents: 0,
        stripe_fee_cents: 0,
        platform_fee_cents: 0,
        consultant_payout_cents: 0,
      })
      .eq("id", bidId)
      .eq("amount_cents", 0)
      .is("counter_offer_cents", null)
      .in("payment_status", CONFIRMABLE_PAYMENT_STATUSES)
      .select("id");
    if (updErr) return res.status(500).json({ error: updErr.message });
    if (!flipped?.length) return res.status(409).json({ error: "This offer changed. Reload and try again." });
    await emailOfferAccepted(bidId, 0);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not accept the offer." });
  }
});

app.post("/api/stripe/confirm-acceptance", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, payment_intent_id, listing_id")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "Bid not found." });
    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) return res.status(403).json({ error: "Only the listing owner can confirm." });
    if (!bid.payment_intent_id) return res.status(400).json({ error: "No payment intent on this bid." });

    const intent = await stripe.paymentIntents.retrieve(bid.payment_intent_id);
    if (intent.metadata?.bid_id !== bidId || intent.metadata?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "This payment doesn't belong to this engagement." });
    }
    // Same path the payment_intent.succeeded webhook runs; verifies amount
    // and flips authorizing → held exactly once.
    const result = await confirmStandardBidPayment(intent);
    if (!result.ok) return res.status(result.mismatch ? 409 : 400).json({ error: result.error });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not confirm payment." });
  }
});

/* Release a held standard bid to the consultant: claim held → released,
   transfer pinned to the original charge, stamp transfer_id. Shared by the
   owner's release button and the daily review-window release job. The caller does
   authorization (and the review requirement for the manual path).
   Returns { ok, transfer_id, fundsRouted, payout_cents } or
   { ok: false, status, error }. */
async function releaseStandardBid(bid, { claimEq = {}, payoutCents = null } = {}) {
  const bidId = bid.id;
  let transferId = null;
  let fundsRouted = "no-payment-intent";
  let payoutAmount = bid.payment_amount_cents;

  // Validate everything that can fail without side effects first, then
  // claim the bid (held → released) before calling Stripe. The claim is
  // the lock: a concurrent release or refund sees the bid is no longer
  // held and stops. If the transfer fails, the claim rolls back to held.
  let intent = null;
  let consultant = null;
  if (bid.payment_intent_id) {
    intent = await stripe.paymentIntents.retrieve(bid.payment_intent_id);
    if (!intent.transfer_data?.destination) {
      // Escrow path. Re-verify the consultant is still payout-eligible —
      // Stripe can restrict an account between charge time and release.
      ({ data: consultant } = await supabase
        .from("profiles")
        .select("stripe_account_id")
        .eq("id", bid.consultant_id)
        .maybeSingle());
      if (!consultant?.stripe_account_id) {
        return { ok: false, status: 400, error: "Consultant hasn't set up payouts yet — they need to finish onboarding before funds can be released." };
      }
      const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
      if (!account.payouts_enabled) {
        return { ok: false, status: 400, error: "Consultant's payout setup is incomplete — they need to finish onboarding first." };
      }
    }
  }

  if (intent && await chargeDisputeHold(idOf(intent.latest_charge))) {
    return { ok: false, status: 409, disputed: true, error: DISPUTE_HOLD_ERROR };
  }

  const claimed = await casUpdate("bids", bidId, "held", {
    payment_status: "released",
    released_at: new Date().toISOString(),
  }, "payment_status", { refunded_cents: 0, ...claimEq });
  if (!claimed) {
    const { data: now } = await supabase
      .from("bids").select("payment_status, refunded_cents").eq("id", bidId).maybeSingle();
    if (now?.payment_status === "held" && Number(now.refunded_cents) > 0) {
      return { ok: false, status: 409, partialRefund: true, error: PARTIAL_REFUND_ERROR };
    }
    return { ok: false, status: 409, conflict: true, error: "This payment changed while you were releasing it. Reload and try again." };
  }

  if (intent) {
    const wasDestinationCharge = Boolean(intent.transfer_data?.destination);

    if (wasDestinationCharge) {
      // Pre-escrow bid: funds already routed at capture. Bookkeeping flip.
      fundsRouted = "At-capture (pre-escrow)";
    } else {
      // Grandfathering: bids paid before the fee-split rollout have
      // consultant_payout_cents NULL. Keep transferring the full
      // payment amount for those — consultants accepted under the old
      // "you get 100%" promise. New bids transfer the pre-computed
      // payout (offer - estimated Stripe fee - platform fee) so the consultant takes
      // home exactly the number we showed them in the UI; the platform
      // absorbs any difference between estimated and actual Stripe fee.
      const hasFeeBreakdown = bid.consultant_payout_cents != null;
      if (hasFeeBreakdown) {
        payoutAmount = bid.consultant_payout_cents;
      }
      if (payoutCents != null) payoutAmount = payoutCents;

      let transfer;
      try {
        transfer = await stripe.transfers.create(
          {
            amount: payoutAmount,
            currency: "usd",
            destination: consultant.stripe_account_id,
            // `source_transaction` pins this transfer to the specific charge so
            // Stripe draws from that charge — bypasses the platform's available
            // balance, which is often $0 in test mode.
            source_transaction: idOf(intent.latest_charge),
            metadata: { bid_id: bidId },
          },
          { idempotencyKey: idemKey("transfer", "bid", bidId, intent.id) }
        );
      } catch (err) {
        const { error: revertErr } = await supabase
          .from("bids")
          .update({ payment_status: "held", released_at: null })
          .eq("id", bidId)
          .eq("payment_status", "released")
          .is("transfer_id", null);
        if (revertErr) alertOps("bid_release_revert_failed", { bid_id: bidId, error: revertErr.message });
        throw err;
      }
      transferId = transfer.id;
      fundsRouted = hasFeeBreakdown ? "On-release (fee-split)" : "On-release (grandfathered)";

      const { error: stampErr } = await supabase
        .from("bids")
        .update({ transfer_id: transferId })
        .eq("id", bidId);
      if (stampErr) {
        // The bid already reads released, so nothing can pay or refund
        // twice; only the transfer id is missing from our books.
        alertOps("bid_transfer_id_not_saved", { bid_id: bidId, transfer_id: transferId, error: stampErr.message });
      }
    }
  }

  return { ok: true, transfer_id: transferId, fundsRouted, payout_cents: payoutAmount };
}

/* Tell the consultant an owner-initiated release went through. Same copy
   as the review-window release job. Never throws. */
async function notifyPaymentReleased({ bidId, consultantId, listingId, payoutCents, free = false }) {
  const { data: listing } = await supabase
    .from("listings").select("title").eq("id", listingId).maybeSingle();
  const title = listing?.title || "your engagement";
  await notifyUser(consultantId, free
    ? { type: "payment_released", title: "Engagement marked complete", body: `The business marked "${title}" complete.`, link: `/engagement.html?bid=${bidId}` }
    : { type: "payment_released", title: "Payment released", body: `${dollars(payoutCents)} from "${title}" is on its way to your Stripe balance.`, link: `/engagement.html?bid=${bidId}` });
}

// Owner: release escrowed funds to the consultant after marking work
// complete + reviewing.
//
// Escrow model: the original PaymentIntent captured into the platform
// balance with no destination, so the consultant has received nothing yet.
// On release, we create a Transfer pinned to the original charge via
// `source_transaction` (lets Stripe draw from that specific charge instead
// of the platform's available balance — crucial in test mode where the
// platform balance is often $0).
//
// Backward-compat: bids paid before the escrow migration used
// `transfer_data.destination`, so funds already moved at capture. For those
// rows we skip the Transfer and just flip the bid to released.
app.post("/api/stripe/release-funds", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, payment_amount_cents, payment_status, payment_intent_id, transfer_id, stripe_fee_cents, platform_fee_cents, consultant_payout_cents")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "Bid not found." });
    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) return res.status(403).json({ error: "Only the listing owner can release funds." });
    if (bid.payment_status === "released") return res.json({ ok: true, alreadyReleased: true });
    if (bid.payment_status !== "held") return res.status(400).json({ error: `Cannot release: status is ${bid.payment_status}.` });

    // Require the review to be in before flipping to released.
    const { data: review } = await supabase
      .from("consultant_reviews")
      .select("id")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!review?.id) return res.status(400).json({ error: "Submit your review before releasing payment." });

    const result = await releaseStandardBid(bid);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await emailPaymentReleased(bidId, { grossCents: bid.payment_amount_cents, payoutCents: result.payout_cents, key: `bid-${bidId}` });
    await notifyPaymentReleased({
      bidId, consultantId: bid.consultant_id, listingId: bid.listing_id,
      payoutCents: result.payout_cents, free: Number(bid.payment_amount_cents) === 0,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not release funds." });
  }
});

// Owner: refund an escrowed payment.
//
// Three states matter:
//   * 'held' within 24h of `paid_at` — self-serve refund. funds are still on
//     the platform; clean stripe.refunds.create on the PI.
//   * 'held' past 24h — refund is no longer self-serve. the owner must
//     contact support, who can still refund (funds remain on the platform
//     until release). this endpoint returns 403 with windowExpired=true.
//   * 'released' — funds are with the consultant. NO refund is available,
//     even through support. once work was marked complete and the review
//     submitted, the engagement is final.
//
// Legacy destination-charged PIs (pre-escrow data) use `reverse_transfer`
// to claw back from the consultant. New PIs never need that since funds
// haven't moved yet.
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
const DELIVERED_REFUND_ERROR = "The consultant already delivered the work, so you can't refund it yourself. Request changes, report a problem, or contact support instead.";

app.post("/api/stripe/refund-payment", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, payment_intent_id, payment_status, paid_at, payment_amount_cents, delivered_at")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "Only the listing owner can request a refund." });
    }

    if (bid.payment_status === "refunded") {
      return res.json({ ok: true, alreadyRefunded: true });
    }
    if (bid.payment_status === "released") {
      return res.status(409).json({
        error: "Funds have already been released to the consultant. Once the work was marked complete and the review submitted, the engagement is final — refunds are not available.",
      });
    }
    if (bid.payment_status !== "held") {
      return res.status(409).json({ error: `Cannot refund: payment status is ${bid.payment_status}.` });
    }
    if (Number(bid.payment_amount_cents) === 0) {
      return res.status(409).json({ error: "There's no payment on this engagement to refund." });
    }
    if (!bid.payment_intent_id) {
      return res.status(400).json({ error: "No payment intent on this bid." });
    }
    if (!bid.paid_at) {
      return res.status(400).json({ error: "No paid_at timestamp — contact support." });
    }

    // Once the work is delivered, the business reviews it instead (Terms
    // §6.4): release, request changes, or report a problem to support.
    if (bid.delivered_at) {
      return res.status(409).json({ error: DELIVERED_REFUND_ERROR, delivered: true });
    }

    const elapsed = Date.now() - new Date(bid.paid_at).getTime();
    if (elapsed > REFUND_WINDOW_MS) {
      return res.status(403).json({
        error: "The 24-hour self-serve refund window has passed. Contact support to request a refund.",
        windowExpired: true,
      });
    }

    const intent = await stripe.paymentIntents.retrieve(bid.payment_intent_id);
    const wasDestinationCharge = Boolean(intent.transfer_data?.destination);

    // Claim held → refunded before calling Stripe, so a release racing
    // this refund can't also go through. Rolled back if Stripe fails.
    // delivered_at null in the claim: a delivery landing mid-refund wins.
    const claimed = await casUpdate("bids", bidId, "held", { payment_status: "refunded" }, "payment_status", { delivered_at: null });
    if (!claimed) {
      return res.status(409).json({ error: "This payment changed while you were refunding it. Reload and try again." });
    }

    let refund;
    try {
      refund = await stripe.refunds.create(
        {
          payment_intent: bid.payment_intent_id,
          // Pre-escrow PIs already routed funds to the consultant. `reverse_transfer`
          // pulls that money back from the consultant's connect balance so the
          // refund nets to zero across the platform + consultant.
          ...(wasDestinationCharge ? { reverse_transfer: true } : {}),
          metadata: { bid_id: bidId, reason: "owner_self_serve_24h" },
        },
        { idempotencyKey: idemKey("refund", "bid", bidId, bid.payment_intent_id) }
      );
    } catch (err) {
      const { error: revertErr } = await supabase
        .from("bids")
        .update({ payment_status: "held" })
        .eq("id", bidId)
        .eq("payment_status", "refunded");
      if (revertErr) alertOps("bid_refund_revert_failed", { bid_id: bidId, error: revertErr.message });
      throw err;
    }

    const { error: updErr } = await supabase
      .from("bids")
      .update({ status: "rejected" })
      .eq("id", bidId);
    if (updErr) alertOps("bid_refund_status_not_saved", { bid_id: bidId, refund_id: refund.id, error: updErr.message });

    return res.json({ ok: true, refund_id: refund.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not refund payment." });
  }
});

/* ================================================================
   Phased contracts — proposal phase acceptance (1..N bids in one charge).
   ================================================================ */

// Owner: accept proposal fees for one or more phased bids in a single
// PaymentIntent.
//
// Design: ONE PI for the sum of proposal fees, into platform escrow. Per-bid
// state is tracked in `bid_phase_payments` (phase='proposal'). On release
// (after the consultant delivers their proposal), we create a Transfer per
// bid using `source_transaction = charge_id` so partial transfers draw from
// the original charge without depending on the platform's available balance.
app.post("/api/stripe/phased/accept-proposals", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidIds = Array.isArray(req.body?.bid_ids)
    ? req.body.bid_ids.map((id) => String(id || "").trim()).filter(Boolean)
    : [];
  if (!bidIds.length) return res.status(400).json({ error: "bid_ids required." });

  try {
    const { data: bids, error: bidsErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, proposal_fee_cents, service_fee_cents, status, move_forward_status")
      .in("id", bidIds);
    if (bidsErr) return res.status(500).json({ error: bidsErr.message });
    if (!bids?.length) return res.status(404).json({ error: "Bids not found." });
    if (bids.length !== bidIds.length) {
      return res.status(404).json({ error: "One or more bids not found." });
    }

    // All bids must belong to listings the viewer owns, and all those
    // listings must be phased.
    const listingIds = [...new Set(bids.map((b) => b.listing_id))];
    const { data: listings, error: listingsErr } = await supabase
      .from("listings")
      .select("id, owner_id, contract_type, title")
      .in("id", listingIds);
    if (listingsErr) return res.status(500).json({ error: listingsErr.message });

    for (const l of listings || []) {
      if (l.owner_id !== viewer.id) {
        return res.status(403).json({ error: "You don't own one of these listings." });
      }
      if (l.contract_type !== "phased") {
        return res.status(400).json({ error: `Listing "${l.title}" is not a phased contract.` });
      }
    }

    // No prior proposal payment may already exist for these bids.
    const { data: existingPhases, error: existingErr } = await supabase
      .from("bid_phase_payments")
      .select("bid_id, status")
      .in("bid_id", bidIds)
      .eq("phase", "proposal");
    if (existingErr) return res.status(500).json({ error: existingErr.message });

    for (const row of existingPhases || []) {
      if (["held", "released", "authorizing"].includes(row.status)) {
        return res.status(409).json({
          error: `Proposal fee for one of these bids has already been processed (status: ${row.status}).`,
        });
      }
    }

    // Validate fees + compute the per-bid breakdown so each row stores
    // its own (offer, stripe fee estimate, platform fee, consultant
    // payout). The batch charge is the sum of business totals (= the sum
    // of offers, since pricing is all-in).
    let totalCents = 0;
    const bidBreakdowns = new Map();
    for (const b of bids) {
      const fee = Number(b.proposal_fee_cents);
      if (!fees.isValidOfferCents(fee)) {
        return res.status(400).json({ error: "One of the bids has an invalid proposal fee." });
      }
      const breakdown = fees.computeFees(fee);
      bidBreakdowns.set(b.id, breakdown);
      totalCents += breakdown.businessTotalCents;
    }

    // Free proposals ($0) never touch Stripe. If every selected proposal
    // is free, accept them now with $0 rows held — they release like any
    // other proposal fee when the business decides. A mixed batch goes
    // through the normal charge; the $0 rows ride along on the same
    // PaymentIntent and add nothing to it.
    if (totalCents === 0) {
      const now = new Date().toISOString();
      const { error: freeRowsErr } = await supabase.from("bid_phase_payments").insert(bids.map((b) => ({
        bid_id: b.id,
        phase: "proposal",
        amount_cents: 0,
        status: "held",
        paid_at: now,
        stripe_fee_cents: 0,
        platform_fee_cents: 0,
        consultant_payout_cents: 0,
      })));
      if (freeRowsErr) return res.status(500).json({ error: freeRowsErr.message });
      const { data: freeAccepted, error: freeBidsErr } = await supabase
        .from("bids")
        .update({ status: "accepted", accepted_at: now })
        .in("id", bidIds)
        .neq("status", "accepted")
        .select("id");
      if (freeBidsErr) return res.status(500).json({ error: freeBidsErr.message });
      for (const { id } of freeAccepted || []) await emailOfferAccepted(id, 0);
      return res.json({ ok: true, free: true, bid_ids: bidIds });
    }

    // Re-verify each paid consultant is fully onboarded — same gate as
    // standard. Free proposals don't need payouts set up.
    const consultantIds = [...new Set(bids.filter((b) => Number(b.proposal_fee_cents) > 0).map((b) => b.consultant_id))];
    const { data: consultantProfiles } = await supabase
      .from("profiles")
      .select("id, stripe_account_id, stripe_account_status")
      .in("id", consultantIds);
    const consultantById = new Map((consultantProfiles || []).map((p) => [p.id, p]));
    for (const b of bids) {
      if (Number(b.proposal_fee_cents) === 0) continue;
      const c = consultantById.get(b.consultant_id);
      if (!c?.stripe_account_id) {
        return res.status(409).json({
          error: "One of these consultants hasn't set up payouts yet — they need to finish onboarding before you can accept.",
        });
      }
      try {
        const acct = await stripe.accounts.retrieve(c.stripe_account_id);
        if (!acct.charges_enabled || !acct.payouts_enabled || !acct.details_submitted) {
          await supabase
            .from("profiles")
            .update({ stripe_account_status: "pending" })
            .eq("id", b.consultant_id);
          return res.status(409).json({
            error: "One of these consultants' payout setup isn't fully verified yet.",
          });
        }
      } catch (err) {
        return res.status(502).json({
          error: "Could not verify a consultant's payout account: " + (err.message || "Stripe error"),
        });
      }
    }

    const owner = await ensureOwnerStripeCustomer(viewer.id);

    // Key on the batch + its prior attempts so a double-click returns the
    // same PI, while a retry after a failed attempt gets a fresh one.
    const batchKey = stableHash(
      [...bidIds].sort().join(","),
      (existingPhases || []).map((r) => `${r.bid_id}=${r.status}`).sort().join(",")
    );
    const intent = await createPaymentIntentOnce(stripe, {
      amount: totalCents,
      currency: "usd",
      customer: owner.stripe_customer_id,
      // Card only: bank debits sit in `processing` for days, and the
      // confirm step needs `succeeded`.
      payment_method_types: ["card"],
      metadata: {
        phase: "proposal_batch",
        owner_id: viewer.id,
        bid_ids: bidIds.join(","),
      },
    }, idemKey("pi-card", "proposals", batchKey, totalCents));

    // Pre-create the per-bid phase payment rows so the confirm step has
    // something to flip to 'held'. amount_cents stays the offer (proposal
    // fee); the fee columns record the breakdown so release-time can
    // transfer just the consultant payout. If the owner abandons mid-flow,
    // the rows stay 'authorizing' — a future cleanup webhook on
    // `payment_intent.canceled` can drop them, but for now manual review
    // is fine.
    const phaseRows = bids.map((b) => {
      const f = bidBreakdowns.get(b.id);
      return {
        bid_id: b.id,
        phase: "proposal",
        amount_cents: b.proposal_fee_cents,
        payment_intent_id: intent.id,
        status: "authorizing",
        stripe_fee_cents: f.stripeFeeCents,
        platform_fee_cents: f.platformFeeCents,
        consultant_payout_cents: f.consultantPayoutCents,
      };
    });
    const { error: insertErr } = await supabase
      .from("bid_phase_payments")
      .insert(phaseRows);
    if (insertErr) {
      // Roll back the PI so the owner isn't charged for a half-set up batch.
      try { await stripe.paymentIntents.cancel(intent.id); } catch (_) {}
      return res.status(500).json({ error: insertErr.message });
    }

    // Aggregate fee figures across the batch so the frontend can render
    // a single combined breakdown (sum of offers, sum of platform fees).
    let aggOffer = 0;
    let aggPlatform = 0;
    let aggPlatformFull = 0;
    let aggStripe = 0;
    let aggPayout = 0;
    for (const f of bidBreakdowns.values()) {
      aggOffer += f.amountCents;
      aggPlatform += f.platformFeeCents;
      aggPlatformFull += f.platformFeeFullCents;
      aggStripe += f.stripeFeeCents;
      aggPayout += f.consultantPayoutCents;
    }

    return res.json({
      client_secret: intent.client_secret,
      amount: totalCents,
      currency: "usd",
      payment_intent_id: intent.id,
      bid_ids: bidIds,
      fee_breakdown: {
        amountCents: aggOffer,
        businessTotalCents: totalCents,
        stripeFeeCents: aggStripe,
        platformFeeCents: aggPlatform,
        platformFeeFullCents: aggPlatformFull,
        platformFeeDiscounted: aggPlatform < aggPlatformFull,
        consultantPayoutCents: aggPayout,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not start proposal payment." });
  }
});

/* ================================================================
   Retainer contracts — continue/cancel decision + subscription start.
   ================================================================ */

// Stripe interval mapping for our cadence enum.
const CADENCE_INTERVAL = {
  weekly: { interval: "week", interval_count: 1 },
  biweekly: { interval: "week", interval_count: 2 },
  monthly: { interval: "month", interval_count: 1 },
  quarterly: { interval: "month", interval_count: 3 },
};

/* cancel_at for a retainer that should bill exactly `periodCount` times.
   One minute before the boundary of period N so Stripe can't open
   invoice N+1 (callers pass proration_behavior: "none", so ending a minute
   early never credits or refunds). Null when there's no term. */
function retainerCancelAt(anchorUnix, cadence, periodCount) {
  const n = Number(periodCount);
  if (!CADENCE_INTERVAL[cadence] || !Number.isInteger(n) || n < 1) return null;
  return periodEndUnix(Math.floor(anchorUnix), CADENCE_INTERVAL[cadence], n) - 60;
}

// Owner: continue the engagement as a recurring retainer after the first
// period has been released. Creates a Stripe Subscription (no transfer_data
// — invoices land on the platform balance so each period can be escrowed +
// released the same way standard is).
//
// For 'tentative' listings the owner posts cadence/period_count/fee_cents in
// the request body. For 'fixed' listings those come from the listing row.
app.post("/api/stripe/retainer/start-subscription", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, amount_cents, payment_status")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("id, owner_id, contract_type, retainer_terms, retainer_cadence, retainer_period_count, retainer_fee_cents, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (!listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.owner_id !== viewer.id) {
      return res.status(403).json({ error: "Only the listing owner can start a retainer." });
    }
    if (listing.contract_type !== "retainer") {
      return res.status(400).json({ error: "This isn't a retainer listing." });
    }
    if (bid.payment_status !== "released") {
      return res.status(400).json({ error: "Release the first-period payment before continuing as a retainer." });
    }

    // Block if a subscription is already running for this bid.
    const { data: existing } = await supabase
      .from("retainer_subscriptions")
      .select("id, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (existing && ["pending", "active"].includes(existing.status)) {
      return res.status(409).json({ error: `Retainer already ${existing.status} for this engagement.` });
    }

    // Resolve cadence + fee. 'fixed' uses listing values; 'tentative'
    // requires the owner to send them in this request.
    // period_count is the agreed term: Stripe stops billing after that
    // many periods (cancel_at). Null means open-ended until either party
    // ends it.
    let cadence = listing.retainer_cadence;
    let periodCount = listing.retainer_period_count;
    let feeCents = listing.retainer_fee_cents;

    if (listing.retainer_terms === "tentative" || !cadence || !feeCents) {
      const body = req.body || {};
      cadence = String(body.cadence || cadence || "").trim();
      if (body.period_count != null) periodCount = Number(body.period_count) || null;
      const feeDollars = Number(body.fee);
      if (Number.isFinite(feeDollars) && feeDollars > 0) {
        feeCents = Math.round(feeDollars * 100);
      } else if (body.fee_cents != null) {
        feeCents = Number(body.fee_cents);
      }
    }

    if (!CADENCE_INTERVAL[cadence]) {
      return res.status(400).json({ error: "Cadence must be weekly, biweekly, monthly, or quarterly." });
    }
    if (!Number.isFinite(feeCents) || feeCents < fees.MIN_PAID_OFFER_CENTS) {
      return res.status(400).json({ error: "Fee per period must be at least $10." });
    }

    const { data: consultantProfile } = await supabase
      .from("profiles")
      .select("stripe_account_id, full_name")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultantProfile?.stripe_account_id) {
      return res.status(409).json({ error: "Consultant hasn't set up payouts yet." });
    }

    const owner = await ensureOwnerStripeCustomer(viewer.id);

    // Optional retainer settings the owner may set up front:
    //   auto_release   — release each period to the consultant on
    //                    invoice.paid without a manual click.
    //   terminates_at  — schedule a cancellation moment; mirrored to
    //                    Stripe via `cancel_at` so the subscription
    //                    auto-cancels there (no further invoices).
    const autoRelease = req.body?.auto_release === true || req.body?.auto_release === "true";
    const terminatesAtRaw = req.body?.terminates_at || null;
    const terminatesAtDate = terminatesAtRaw ? new Date(terminatesAtRaw) : null;
    if (terminatesAtRaw && (!terminatesAtDate || Number.isNaN(terminatesAtDate.getTime()))) {
      return res.status(400).json({ error: "terminates_at must be an ISO date string." });
    }
    // An explicit termination date wins; otherwise the agreed period count
    // sets the end. Anchored to the current minute so a double-click sends
    // identical params under the same idempotency key.
    const cancelAtUnix = terminatesAtDate
      ? Math.floor(terminatesAtDate.getTime() / 1000)
      : retainerCancelAt(Math.floor(Date.now() / 60000) * 60, cadence, periodCount);

    // Create a Product + recurring Price tagged to this engagement so the
    // subscription has a clear lineage in the Stripe dashboard. Each
    // period bills the offer (all-in; fees come out of the payout).
    const perPeriodBreakdown = fees.computeFees(feeCents);
    // One key per (bid, prior retainer row state, terms) so a double-click
    // replays the same Product/Price/Subscription instead of billing twice.
    const startKey = idemKey(
      "retainer-start-card", bidId, existing?.id || "new", existing?.status || "-",
      cadence, feeCents, cancelAtUnix || "open"
    );
    const product = await stripe.products.create({
      name: `retainer · ${listing.title}`,
      metadata: { bid_id: bidId, listing_id: listing.id },
    }, { idempotencyKey: `${startKey}:product` });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: perPeriodBreakdown.businessTotalCents,
      recurring: CADENCE_INTERVAL[cadence],
      metadata: { bid_id: bidId, offer_cents: String(feeCents) },
    }, { idempotencyKey: `${startKey}:price` });

    // No `transfer_data` — invoices capture into the platform balance,
    // then each period is released via `release-period` (manual) or via
    // the webhook's auto-release branch when `auto_release` is on.
    // Billing stops at `cancel_at` (from terminates_at or period_count),
    // or earlier via the cancel-subscription endpoint (either party).
    const subscription = await stripe.subscriptions.create({
      customer: owner.stripe_customer_id,
      items: [{ price: price.id }],
      collection_method: "charge_automatically",
      payment_settings: { payment_method_types: ["card"] },
      ...(cancelAtUnix ? { cancel_at: cancelAtUnix, proration_behavior: "none" } : {}),
      metadata: {
        bid_id: bidId,
        listing_id: listing.id,
        owner_id: viewer.id,
        consultant_id: bid.consultant_id,
      },
    }, { idempotencyKey: `${startKey}:subscription` });

    const phaseRow = {
      bid_id: bidId,
      stripe_subscription_id: subscription.id,
      cadence,
      period_count: periodCount || null, // enforced via cancel_at above
      fee_cents: feeCents,
      periods_billed: 0,
      status: subscription.status === "active" || subscription.status === "trialing" ? "active" : "pending",
      started_at: new Date(subscription.start_date * 1000).toISOString(),
      auto_release: autoRelease,
      terminates_at: cancelAtUnix ? new Date(cancelAtUnix * 1000).toISOString() : null,
    };

    let writeErr;
    if (existing?.id) {
      const { error } = await supabase
        .from("retainer_subscriptions")
        .update(phaseRow)
        .eq("id", existing.id);
      writeErr = error;
    } else {
      const { error } = await supabase
        .from("retainer_subscriptions")
        .insert(phaseRow);
      writeErr = error;
    }
    if (writeErr) {
      try { await stripe.subscriptions.cancel(subscription.id); } catch (_) {}
      return res.status(500).json({ error: writeErr.message });
    }

    return res.json({
      ok: true,
      subscription_id: subscription.id,
      cadence,
      fee_cents: feeCents,
      auto_release: autoRelease,
      terminates_at: phaseRow.terminates_at,
      status: phaseRow.status,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not start retainer." });
  }
});

// Owner: offer a consultant an ongoing retainer at the end of any engagement
// (standard, phased post-service, or a one-off retainer first-period). Stores
// the proposed terms on `retainer_subscriptions` with status='offered' — no
// Stripe subscription is created until the consultant accepts.
app.post("/api/stripe/retainer/offer", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  const cadence = String(req.body?.cadence || "").trim();
  const periodCount = Number(req.body?.period_count);
  let feeCents = Number(req.body?.fee_cents);
  if (!Number.isFinite(feeCents)) {
    const feeDollars = Number(req.body?.fee);
    if (Number.isFinite(feeDollars)) feeCents = Math.round(feeDollars * 100);
  }
  const message = String(req.body?.message || "").trim() || null;

  if (!CADENCE_INTERVAL[cadence]) {
    return res.status(400).json({ error: "Cadence must be weekly, biweekly, monthly, or quarterly." });
  }
  if (!Number.isFinite(periodCount) || periodCount < 1) {
    return res.status(400).json({ error: "period_count must be at least 1." });
  }
  if (!Number.isFinite(feeCents) || feeCents < fees.MIN_PAID_OFFER_CENTS) {
    return res.status(400).json({ error: "Fee per period must be at least $10." });
  }

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, payment_status")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "Only the listing owner can offer a retainer." });
    }
    if (bid.payment_status !== "released") {
      return res.status(400).json({ error: "The engagement isn't released yet — retainer offers happen after first delivery." });
    }

    const { data: existing } = await supabase
      .from("retainer_subscriptions")
      .select("id, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (existing && ["offered", "pending", "active"].includes(existing.status)) {
      return res.status(409).json({ error: `A retainer is already ${existing.status} on this engagement.` });
    }

    const row = {
      bid_id: bidId,
      cadence,
      period_count: periodCount,
      fee_cents: feeCents,
      periods_billed: 0,
      status: "offered",
      offered_by: viewer.id,
      offered_at: new Date().toISOString(),
      offer_message: message,
    };

    let writeErr;
    if (existing?.id) {
      const { error } = await supabase
        .from("retainer_subscriptions")
        .update({ ...row, declined_at: null, accepted_at: null, stripe_subscription_id: null, canceled_at: null })
        .eq("id", existing.id);
      writeErr = error;
    } else {
      const { error } = await supabase
        .from("retainer_subscriptions")
        .insert(row);
      writeErr = error;
    }
    if (writeErr) return res.status(500).json({ error: writeErr.message });

    return res.json({ ok: true, fee_cents: feeCents, cadence, period_count: periodCount });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not create offer." });
  }
});

// Consultant: accept a pending retainer offer. Creates the Stripe Product +
// recurring Price + Subscription on the owner's customer (using the owner's
// saved default payment method) and flips the row to status='active'.
app.post("/api/stripe/retainer/accept-offer", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "Bid not found." });
    if (bid.consultant_id !== viewer.id) {
      return res.status(403).json({ error: "Only the consultant on this bid can accept." });
    }

    const { data: offerRow } = await supabase
      .from("retainer_subscriptions")
      .select("id, status, cadence, period_count, fee_cents, offered_by, offered_at")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!offerRow) return res.status(404).json({ error: "No retainer offer on this engagement." });
    if (offerRow.status !== "offered") {
      return res.status(409).json({ error: `Offer is ${offerRow.status} — can't accept.` });
    }
    if (!CADENCE_INTERVAL[offerRow.cadence]) {
      return res.status(500).json({ error: "Stored cadence is invalid." });
    }
    if (!offerRow.fee_cents || offerRow.fee_cents < 50) {
      return res.status(500).json({ error: "Stored fee is invalid." });
    }

    const { data: listing } = await supabase
      .from("listings")
      .select("id, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (!listing) return res.status(404).json({ error: "Listing not found." });

    // Resolve the owner's customer (proposed_by) — needed to attach the
    // subscription to the right customer with the saved default PM.
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", offerRow.offered_by)
      .maybeSingle();
    if (!ownerProfile?.stripe_customer_id) {
      return res.status(400).json({ error: "The business doesn't have a payment method on file yet." });
    }

    // Re-verify consultant payout is still active so the eventual transfers
    // (per-period release) won't fail.
    const { data: consultantProfile } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", viewer.id)
      .maybeSingle();
    if (!consultantProfile?.stripe_account_id) {
      return res.status(409).json({ error: "Finish payout setup before accepting a retainer." });
    }

    // Claim the offer (offered → pending) before any Stripe call so a
    // double-click can't start two subscriptions. Rolled back if Stripe fails.
    const acceptedAt = new Date().toISOString();
    const claimed = await casUpdate("retainer_subscriptions", offerRow.id, "offered", {
      status: "pending",
      accepted_at: acceptedAt,
    });
    if (!claimed) return res.status(409).json({ error: "This offer was already accepted." });

    // The agreed term: Stripe stops after `period_count` invoices. The
    // business can lengthen or shorten it later via update-settings.
    const cancelAtUnix = retainerCancelAt(Date.parse(acceptedAt) / 1000, offerRow.cadence, offerRow.period_count);

    // Each invoice bills the offer (all-in; fees come out of the payout).
    const perPeriodBreakdown = fees.computeFees(offerRow.fee_cents);
    // accepted_at is fresh per claim, so a retry after a rollback gets new keys.
    const offerKey = idemKey("retainer-offer", offerRow.id, acceptedAt);
    let subscription;
    try {
      const product = await stripe.products.create({
        name: `retainer · ${listing.title}`,
        metadata: { bid_id: bidId, listing_id: listing.id, source: "offer" },
      }, { idempotencyKey: `${offerKey}:product` });
      const price = await stripe.prices.create({
        product: product.id,
        currency: "usd",
        unit_amount: perPeriodBreakdown.businessTotalCents,
        recurring: CADENCE_INTERVAL[offerRow.cadence],
        metadata: { bid_id: bidId, offer_cents: String(offerRow.fee_cents) },
      }, { idempotencyKey: `${offerKey}:price` });

      subscription = await stripe.subscriptions.create({
        customer: ownerProfile.stripe_customer_id,
        items: [{ price: price.id }],
        collection_method: "charge_automatically",
        payment_settings: { payment_method_types: ["card"] },
        ...(cancelAtUnix ? { cancel_at: cancelAtUnix, proration_behavior: "none" } : {}),
        metadata: {
          bid_id: bidId,
          listing_id: listing.id,
          owner_id: offerRow.offered_by,
          consultant_id: viewer.id,
          period_count: String(offerRow.period_count),
          source: "offer",
        },
      }, { idempotencyKey: `${offerKey}:subscription` });
    } catch (err) {
      await supabase
        .from("retainer_subscriptions")
        .update({ status: "offered", accepted_at: null })
        .eq("id", offerRow.id)
        .eq("status", "pending")
        .is("stripe_subscription_id", null);
      throw err;
    }

    const newStatus = subscription.status === "active" || subscription.status === "trialing"
      ? "active"
      : "pending";
    const { error: updErr } = await supabase
      .from("retainer_subscriptions")
      .update({
        stripe_subscription_id: subscription.id,
        status: newStatus,
        started_at: new Date(subscription.start_date * 1000).toISOString(),
        terminates_at: cancelAtUnix ? new Date(cancelAtUnix * 1000).toISOString() : null,
      })
      .eq("id", offerRow.id);
    if (updErr) {
      // The first period is already charged; invoice.paid links the row by
      // bid_id. Don't cancel — flag it for a human instead.
      alertOps("retainer_accept_link_failed", { bid_id: bidId, subscription: subscription.id, error: updErr.message });
    }

    return res.json({ ok: true, subscription_id: subscription.id, status: newStatus });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not accept offer." });
  }
});

// Consultant: decline a pending retainer offer.
app.post("/api/stripe/retainer/decline-offer", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "Bid not found." });
    if (bid.consultant_id !== viewer.id) {
      return res.status(403).json({ error: "Only the consultant on this bid can decline." });
    }

    const { data: offerRow } = await supabase
      .from("retainer_subscriptions")
      .select("id, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!offerRow) return res.status(404).json({ error: "No retainer offer on this engagement." });
    if (offerRow.status !== "offered") {
      return res.status(409).json({ error: `Offer is ${offerRow.status} — can't decline.` });
    }

    const { error: updErr } = await supabase
      .from("retainer_subscriptions")
      .update({ status: "declined", declined_at: new Date().toISOString() })
      .eq("id", offerRow.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not decline offer." });
  }
});

// Either party (owner or consultant) ends a retainer after the current
// period. Uses Stripe's `cancel_at_period_end: true` so the currently-billed
// period plays out normally — work continues, the owner releases (or
// auto-releases) at end of period, and no further invoices fire after.
// `immediate=true` is reserved for "kill it right now" (owner-only) which
// also stops the current period's work. Default is graceful.
app.post("/api/stripe/retainer/cancel-subscription", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  const immediate = req.body?.immediate === true || req.body?.immediate === "true";

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();

    const isOwner = listing?.owner_id === viewer.id;
    const isConsultant = bid.consultant_id === viewer.id;
    if (!isOwner && !isConsultant) {
      return res.status(403).json({ error: "Only the listing owner or the consultant can end this retainer." });
    }
    if (immediate && !isOwner) {
      return res.status(403).json({ error: "Only the owner can end a retainer mid-period." });
    }

    const { data: subRow } = await supabase
      .from("retainer_subscriptions")
      .select("id, stripe_subscription_id, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!subRow) return res.status(404).json({ error: "No retainer on this engagement." });
    if (subRow.status === "canceled") return res.json({ ok: true, alreadyCanceled: true });

    if (subRow.stripe_subscription_id) {
      try {
        if (immediate) {
          await stripe.subscriptions.cancel(subRow.stripe_subscription_id);
        } else {
          // Graceful: subscription stays "active" through the current
          // period, no future invoices. Stripe fires `subscription.deleted`
          // when the period ends; our `onSubscriptionDeleted` handler
          // marks the row canceled at that point.
          await stripe.subscriptions.update(subRow.stripe_subscription_id, {
            cancel_at_period_end: true,
          });
        }
      } catch (err) {
        // Don't mark the row canceled while Stripe would keep billing —
        // unless Stripe says it's already gone.
        console.warn("[retainer cancel]", err.message);
        const alreadyGone = err.code === "resource_missing" || /canceled subscription/i.test(err.message || "");
        if (!alreadyGone) {
          return res.status(502).json({ error: "Could not end the retainer with our payment processor. Try again." });
        }
      }
    }

    if (immediate) {
      const { error: updErr } = await supabase
        .from("retainer_subscriptions")
        .update({ status: "canceled", canceled_at: new Date().toISOString() })
        .eq("id", subRow.id);
      if (updErr) return res.status(500).json({ error: updErr.message });
    } else {
      // Graceful: only mark the intent; actual `canceled_at` lands when
      // the period ends and `subscription.deleted` fires.
      const { error: updErr } = await supabase
        .from("retainer_subscriptions")
        .update({ status: "ending" })
        .eq("id", subRow.id);
      if (updErr && !/violates|invalid/i.test(updErr.message || "")) {
        // If the `status` check constraint rejects 'ending', fall back to
        // leaving status='active' and rely on Stripe's webhook to flip
        // to canceled at period end. This preserves graceful UX without
        // requiring a schema migration today.
      }
    }

    return res.json({ ok: true, mode: immediate ? "immediate" : "end-of-period" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not cancel retainer." });
  }
});

// Owner: update auto_release toggle and/or terminates_at on a live retainer.
// `auto_release=true` flips the webhook into the inline-transfer path on
// future `invoice.paid` events. If any periods are currently held when the
// toggle flips on, they're released immediately.
// `terminates_at` is mirrored to Stripe as `cancel_at`; passing null clears it.
app.post("/api/stripe/retainer/update-settings", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "Bid not found." });
    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "Only the listing owner can update retainer settings." });
    }

    const { data: subRow } = await supabase
      .from("retainer_subscriptions")
      .select("id, stripe_subscription_id, auto_release, terminates_at, status, cadence, period_count, periods_billed")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!subRow) return res.status(404).json({ error: "No retainer on this engagement." });
    if (["canceled", "completed"].includes(subRow.status)) {
      return res.status(400).json({ error: "Retainer is no longer active." });
    }

    const updates = {};

    // auto_release: explicit boolean only. Omitting leaves it unchanged.
    let autoReleaseChangedOn = false;
    if (req.body?.auto_release !== undefined) {
      const next = req.body.auto_release === true || req.body.auto_release === "true";
      updates.auto_release = next;
      autoReleaseChangedOn = next && !subRow.auto_release;
    }

    // terminates_at: null clears, undefined leaves alone, otherwise must parse.
    // period_count (the retainer length) takes precedence when both are sent:
    // the business can lengthen or shorten the term at any point, down to
    // the period already paid for (= end after the current period).
    let nextTerminatesAt = subRow.terminates_at; // unchanged
    let lengthChanged = false;
    if (req.body?.period_count !== undefined && req.body?.period_count !== null && req.body?.period_count !== "") {
      const n = Number(req.body.period_count);
      const paid = Number(subRow.periods_billed) || 0;
      if (!Number.isInteger(n) || n < Math.max(1, paid) || n > 120) {
        return res.status(400).json({
          error: `Length must be a whole number of periods, at least ${Math.max(1, paid)} (periods already paid).`,
        });
      }
      if (!subRow.stripe_subscription_id) {
        return res.status(409).json({ error: "The retainer hasn't started billing yet. Try again in a moment." });
      }
      let sub;
      try {
        sub = await stripe.subscriptions.retrieve(subRow.stripe_subscription_id);
      } catch (err) {
        return res.status(502).json({ error: "Could not reach the payment processor. Try again." });
      }
      if (sub.cancel_at_period_end) {
        return res.status(409).json({ error: "This retainer is already set to end after the current period." });
      }
      const cancelAt = retainerCancelAt(sub.billing_cycle_anchor, subRow.cadence, n);
      if (!cancelAt || cancelAt * 1000 <= Date.now()) {
        return res.status(400).json({ error: "That length has already passed." });
      }
      updates.period_count = n;
      updates.terminates_at = new Date(cancelAt * 1000).toISOString();
      nextTerminatesAt = updates.terminates_at;
      lengthChanged = n !== subRow.period_count;
    } else if (req.body?.terminates_at === null) {
      updates.terminates_at = null;
      nextTerminatesAt = null;
    } else if (req.body?.terminates_at !== undefined) {
      const dt = new Date(req.body.terminates_at);
      if (Number.isNaN(dt.getTime())) {
        return res.status(400).json({ error: "terminates_at must be an ISO date string or null." });
      }
      if (dt.getTime() <= Date.now()) {
        return res.status(400).json({ error: "terminates_at must be in the future." });
      }
      updates.terminates_at = dt.toISOString();
      nextTerminatesAt = updates.terminates_at;
    }

    // Mirror terminates_at change to Stripe so the subscription actually
    // auto-cancels there. Passing null clears the prior cancel_at. No
    // prorations: the period in progress is already paid in full.
    if ("terminates_at" in updates && subRow.stripe_subscription_id) {
      try {
        await stripe.subscriptions.update(subRow.stripe_subscription_id, {
          cancel_at: nextTerminatesAt ? Math.floor(new Date(nextTerminatesAt).getTime() / 1000) : "",
          proration_behavior: "none",
        });
      } catch (err) {
        return res.status(502).json({ error: `Stripe update failed: ${err.message}` });
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.json({ ok: true, noChange: true });
    }

    const { error: updErr } = await supabase
      .from("retainer_subscriptions")
      .update(updates)
      .eq("id", subRow.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    if (lengthChanged) {
      const n = updates.period_count;
      await notifyUser(bid.consultant_id, {
        type: "retainer_length_changed",
        title: "Retainer length updated",
        body: `The business set "${listing.title || "Your retainer"}" to ${n} period${n === 1 ? "" : "s"}. Billing stops after ${updates.terminates_at.slice(0, 10)}.`,
        link: `/engagement.html?bid=${bidId}`,
      });
    }

    // Catch-up: if auto_release flipped on, release any periods currently
    // held. Sequential (not parallel) so a per-period failure doesn't fan
    // out to retries across the whole batch.
    const released = [];
    if (autoReleaseChangedOn) {
      const { data: heldRows } = await supabase
        .from("bid_phase_payments")
        .select("period_index")
        .eq("bid_id", bidId)
        .eq("phase", "retainer_period")
        .eq("status", "held")
        .order("period_index", { ascending: true });
      for (const row of heldRows || []) {
        const result = await transferRetainerPeriodFunds({ bidId, periodIndex: row.period_index });
        released.push({ period_index: row.period_index, ok: result.ok, error: result.error });
      }
    }

    return res.json({
      ok: true,
      auto_release: updates.auto_release ?? subRow.auto_release,
      terminates_at: "terminates_at" in updates ? updates.terminates_at : subRow.terminates_at,
      period_count: updates.period_count ?? subRow.period_count ?? null,
      catch_up_released: released,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not update retainer settings." });
  }
});

// Owner: release a single retainer period's escrow to the consultant.
// Mirrors release-service: transfer from the period's charge_id, flip
// the phase row to released.
app.post("/api/stripe/retainer/release-period", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  const periodIndex = Number(req.body?.period_index);
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  if (!Number.isFinite(periodIndex) || periodIndex < 0) {
    return res.status(400).json({ error: "period_index required." });
  }

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "Only the listing owner can release periods." });
    }

    const { data: phaseRow, error: phaseErr } = await supabase
      .from("bid_phase_payments")
      .select("id, status, amount_cents, charge_id, consultant_payout_cents")
      .eq("bid_id", bidId)
      .eq("phase", "retainer_period")
      .eq("period_index", periodIndex)
      .maybeSingle();
    if (phaseErr) return res.status(500).json({ error: phaseErr.message });
    if (!phaseRow) return res.status(404).json({ error: "No retainer period at that index." });
    if (phaseRow.status === "released") return res.json({ ok: true, alreadyReleased: true });
    if (phaseRow.status !== "held") {
      return res.status(400).json({ error: `Cannot release: status is ${phaseRow.status}.` });
    }
    if (!phaseRow.charge_id) {
      return res.status(400).json({ error: "No charge ID on period — contact support." });
    }

    const { data: consultant } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultant?.stripe_account_id) {
      return res.status(400).json({ error: "Consultant hasn't set up payouts yet." });
    }
    const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
    if (!account.payouts_enabled) {
      return res.status(400).json({ error: "Consultant's payout setup is incomplete." });
    }

    const result = await releasePhaseRow(phaseRow, {
      destination: consultant.stripe_account_id,
      metadata: { bid_id: bidId, phase: "retainer_period", period_index: String(periodIndex) },
    });
    if (result.conflict) return res.status(409).json({ error: "This period changed while you were releasing it. Reload and try again." });
    if (!result.ok) return res.status(409).json({ error: result.error });
    await emailPaymentReleased(bidId, { grossCents: phaseRow.amount_cents, payoutCents: result.payout_cents, key: `pay-${phaseRow.id}`, link: `/engagement.html?bid=${bidId}#pay-${phaseRow.id}` });

    await notifyPaymentReleased({ bidId, consultantId: bid.consultant_id, listingId: bid.listing_id, payoutCents: result.payout_cents });
    return res.json({ ok: true, transfer_id: result.transfer_id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not release period." });
  }
});

// Owner: start the service phase for a single bid. Owner must have already
// chosen 'selected' on the proposal decision. Creates a PaymentIntent for
// the service fee (escrow into platform balance) and a `bid_phase_payments`
// row with phase='service', status='authorizing'.
app.post("/api/stripe/phased/start-service", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, service_fee_cents, move_forward_status")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("id, owner_id, contract_type, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (!listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.owner_id !== viewer.id) {
      return res.status(403).json({ error: "Only the listing owner can start the service phase." });
    }
    if (listing.contract_type !== "phased") {
      return res.status(400).json({ error: "Service phase only applies to phased contracts." });
    }
    if (bid.move_forward_status !== "selected") {
      return res.status(409).json({ error: "You haven't decided to move forward with this consultant yet." });
    }

    const fee = Number(bid.service_fee_cents);
    if (!Number.isFinite(fee) || fee < fees.MIN_PAID_OFFER_CENTS) {
      return res.status(400).json({ error: "Service fee is missing or too small." });
    }
    const feeBreakdown = fees.computeFees(fee);

    const { data: existing } = await supabase
      .from("bid_phase_payments")
      .select("id, status, payment_intent_id")
      .eq("bid_id", bidId)
      .eq("phase", "service")
      .maybeSingle();
    if (existing && ["held", "released", "authorizing"].includes(existing.status)) {
      return res.status(409).json({
        error: `Service fee already ${existing.status === "authorizing" ? "in progress" : existing.status}.`,
      });
    }

    // Re-verify consultant is fully onboarded — same gate as standard.
    const { data: consultantProfile } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultantProfile?.stripe_account_id) {
      return res.status(409).json({ error: "Consultant hasn't set up payouts yet." });
    }
    try {
      const acct = await stripe.accounts.retrieve(consultantProfile.stripe_account_id);
      if (!acct.charges_enabled || !acct.payouts_enabled || !acct.details_submitted) {
        await supabase
          .from("profiles")
          .update({ stripe_account_status: "pending" })
          .eq("id", bid.consultant_id);
        return res.status(409).json({ error: "Consultant's payout setup isn't fully verified yet." });
      }
    } catch (err) {
      return res.status(502).json({ error: "Could not verify consultant's payout account: " + (err.message || "Stripe error") });
    }

    const owner = await ensureOwnerStripeCustomer(viewer.id);

    const intent = await createPaymentIntentOnce(stripe, {
      amount: feeBreakdown.businessTotalCents,
      currency: "usd",
      customer: owner.stripe_customer_id,
      // Card only: bank debits sit in `processing` for days, and the
      // confirm step needs `succeeded`.
      payment_method_types: ["card"],
      metadata: {
        phase: "service",
        owner_id: viewer.id,
        bid_id: bidId,
        consultant_id: bid.consultant_id,
        listing_id: bid.listing_id,
      },
    }, idemKey("pi-card", "service", bidId, existing?.payment_intent_id || "none", feeBreakdown.businessTotalCents));

    // Upsert the phase row so a previously-failed attempt can be retried.
    // amount_cents stays the offer (service fee); the fee columns record
    // the breakdown so release-time transfers just the consultant payout.
    const phaseRow = {
      bid_id: bidId,
      phase: "service",
      amount_cents: fee,
      payment_intent_id: intent.id,
      status: "authorizing",
      stripe_fee_cents: feeBreakdown.stripeFeeCents,
      platform_fee_cents: feeBreakdown.platformFeeCents,
      consultant_payout_cents: feeBreakdown.consultantPayoutCents,
    };
    let writeErr;
    if (existing?.id) {
      const { error } = await supabase
        .from("bid_phase_payments")
        .update(phaseRow)
        .eq("id", existing.id);
      writeErr = error;
    } else {
      const { error } = await supabase
        .from("bid_phase_payments")
        .insert(phaseRow);
      writeErr = error;
    }
    if (writeErr) {
      try { await stripe.paymentIntents.cancel(intent.id); } catch (_) {}
      return res.status(500).json({ error: writeErr.message });
    }

    return res.json({
      client_secret: intent.client_secret,
      amount: feeBreakdown.businessTotalCents,
      currency: "usd",
      payment_intent_id: intent.id,
      bid_id: bidId,
      fee_breakdown: feeBreakdown,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not start service payment." });
  }
});

// Owner: confirm the service-phase PaymentIntent after Stripe captures.
app.post("/api/stripe/phased/confirm-service", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const paymentIntentId = String(req.body?.payment_intent_id || "").trim();
  if (!paymentIntentId) return res.status(400).json({ error: "payment_intent_id required." });

  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.metadata?.owner_id !== viewer.id || intent.metadata?.phase !== "service") {
      return res.status(403).json({ error: "This payment doesn't belong to you." });
    }
    const result = await confirmServicePayment(intent);
    if (!result.ok) return res.status(result.mismatch ? 409 : 400).json({ error: result.error });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not confirm service payment." });
  }
});

// Owner: release the service-phase escrow to the consultant after they
// submit a review (mirrors standard's /release-funds, but operates on a
// `bid_phase_payments` row instead of the bid's payment_intent_id column).
app.post("/api/stripe/phased/release-service", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id, contract_type")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "Only the listing owner can release funds." });
    }
    if (listing.contract_type !== "phased") {
      return res.status(400).json({ error: "This endpoint is for phased contracts." });
    }

    const { data: phaseRow, error: phaseErr } = await supabase
      .from("bid_phase_payments")
      .select("id, status, amount_cents, charge_id, transfer_id, consultant_payout_cents")
      .eq("bid_id", bidId)
      .eq("phase", "service")
      .maybeSingle();
    if (phaseErr) return res.status(500).json({ error: phaseErr.message });
    if (!phaseRow) return res.status(400).json({ error: "No service payment on file for this bid." });
    if (phaseRow.status === "released") return res.json({ ok: true, alreadyReleased: true });
    if (phaseRow.status !== "held") {
      return res.status(400).json({ error: `Cannot release: status is ${phaseRow.status}.` });
    }
    if (!phaseRow.charge_id) {
      return res.status(400).json({ error: "No charge ID on service payment — contact support." });
    }

    const { data: review } = await supabase
      .from("consultant_reviews")
      .select("id")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!review?.id) {
      return res.status(400).json({ error: "Submit your review before releasing payment." });
    }

    const { data: consultant } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultant?.stripe_account_id) {
      return res.status(400).json({ error: "Consultant hasn't set up payouts yet." });
    }
    const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
    if (!account.payouts_enabled) {
      return res.status(400).json({ error: "Consultant's payout setup is incomplete." });
    }

    // Same fee-split-or-grandfather pattern as proposal release (inside
    // releasePhaseRow): stored consultant payout, else the gross amount.
    const result = await releasePhaseRow(phaseRow, {
      destination: consultant.stripe_account_id,
      metadata: { bid_id: bidId, phase: "service" },
    });
    if (result.conflict) return res.status(409).json({ error: "This payment changed while you were releasing it. Reload and try again." });
    if (!result.ok) return res.status(409).json({ error: result.error });
    await emailPaymentReleased(bidId, { grossCents: phaseRow.amount_cents, payoutCents: result.payout_cents, key: `pay-${phaseRow.id}`, link: `/engagement.html?bid=${bidId}#pay-${phaseRow.id}` });

    await notifyPaymentReleased({ bidId, consultantId: bid.consultant_id, listingId: bid.listing_id, payoutCents: result.payout_cents });
    return res.json({ ok: true, transfer_id: result.transfer_id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not release service funds." });
  }
});

// Owner: decide whether to move forward with a single consultant after
// their proposal phase finishes (the meeting / kickoff has occurred).
//
// Either decision releases the proposal-fee escrow to the consultant — they
// did the proposal work and earned it. The difference is what happens next:
//   * 'selected'  → service-fee charge will follow in chunk 5.
//   * 'declined'  → engagement effectively ends at the proposal phase.
//
// Transfer pattern mirrors release-funds: `source_transaction = charge_id`
// pulls from the original proposal-batch charge, so this transfer is for the
// single bid's proposal_fee_cents (the charge can fan out into multiple
// transfers across all the bids it covered).
app.post("/api/stripe/phased/proposal-decision", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  const decision = String(req.body?.decision || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  if (!["selected", "declined"].includes(decision)) {
    return res.status(400).json({ error: "Decision must be 'selected' or 'declined'." });
  }

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, move_forward_status, status")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "Bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("id, owner_id, contract_type, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (!listing) return res.status(404).json({ error: "Listing not found." });
    if (listing.owner_id !== viewer.id) {
      return res.status(403).json({ error: "Only the listing owner can make this decision." });
    }
    if (listing.contract_type !== "phased") {
      return res.status(400).json({ error: "This decision only applies to phased contracts." });
    }
    if (bid.move_forward_status && bid.move_forward_status !== "pending") {
      return res.status(409).json({ error: `Decision already recorded as '${bid.move_forward_status}'.` });
    }

    const { data: phaseRow, error: phaseErr } = await supabase
      .from("bid_phase_payments")
      .select("id, amount_cents, status, charge_id, payment_intent_id, consultant_payout_cents")
      .eq("bid_id", bidId)
      .eq("phase", "proposal")
      .maybeSingle();
    if (phaseErr) return res.status(500).json({ error: phaseErr.message });
    if (!phaseRow) return res.status(400).json({ error: "No proposal payment on file for this bid." });
    if (phaseRow.status === "released") {
      // Idempotent: already released. Just record the decision and exit.
      const { error: idempotentErr } = await supabase
        .from("bids")
        .update({
          move_forward_status: decision,
          move_forward_decided_at: new Date().toISOString(),
        })
        .eq("id", bidId);
      if (idempotentErr) return res.status(500).json({ error: idempotentErr.message });
      return res.json({ ok: true, alreadyReleased: true });
    }
    if (phaseRow.status !== "held") {
      return res.status(400).json({ error: `Cannot release: proposal payment is ${phaseRow.status}.` });
    }
    if (Number(phaseRow.amount_cents) === 0) {
      // Free proposal: nothing to transfer, just close it out.
      const claimed = await casUpdate("bid_phase_payments", phaseRow.id, "held", {
        status: "released",
        released_at: new Date().toISOString(),
      });
      if (!claimed) return res.status(409).json({ error: "This proposal changed while you were deciding. Reload and try again." });
      const { error: freeDecisionErr } = await supabase
        .from("bids")
        .update({ move_forward_status: decision, move_forward_decided_at: new Date().toISOString() })
        .eq("id", bidId);
      if (freeDecisionErr) return res.status(500).json({ error: freeDecisionErr.message });
      return res.json({ ok: true, free: true, decision });
    }
    if (!phaseRow.charge_id) {
      return res.status(400).json({ error: "No charge ID on proposal payment — contact support." });
    }

    const { data: consultant } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_account_status")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultant?.stripe_account_id) {
      return res.status(400).json({ error: "Consultant hasn't set up payouts yet." });
    }
    try {
      const acct = await stripe.accounts.retrieve(consultant.stripe_account_id);
      if (!acct.payouts_enabled) {
        return res.status(400).json({ error: "Consultant's payout setup is incomplete." });
      }
    } catch (err) {
      return res.status(502).json({ error: "Could not verify consultant's payout account: " + (err.message || "Stripe error") });
    }

    // Transfer the stored consultant payout (offer - estimated Stripe
    // fee) so the take-home matches what the consultant was shown. Bids
    // paid before the fee-split rollout have NULL consultant_payout_cents
    // — those grandfather to the full-amount transfer.
    const result = await releasePhaseRow(phaseRow, {
      destination: consultant.stripe_account_id,
      metadata: { bid_id: bidId, phase: "proposal", decision },
    });
    if (result.conflict) return res.status(409).json({ error: "This payment changed while you were deciding. Reload and try again." });
    if (!result.ok) return res.status(409).json({ error: result.error });
    const transfer = { id: result.transfer_id };

    const decidedAt = new Date().toISOString();
    const { error: updBidErr } = await supabase
      .from("bids")
      .update({
        move_forward_status: decision,
        move_forward_decided_at: decidedAt,
      })
      .eq("id", bidId);
    if (updBidErr) return res.status(500).json({ error: updBidErr.message });

    await notifyPaymentReleased({ bidId, consultantId: bid.consultant_id, listingId: bid.listing_id, payoutCents: result.payout_cents });
    return res.json({ ok: true, transfer_id: transfer.id, decision });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not record decision." });
  }
});

// Owner: confirm a proposal batch after Stripe captures. Flips each bid
// to `accepted` and each bid_phase_payments row to `held`.
app.post("/api/stripe/phased/confirm-proposals", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });

  const paymentIntentId = String(req.body?.payment_intent_id || "").trim();
  if (!paymentIntentId) return res.status(400).json({ error: "payment_intent_id required." });

  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.metadata?.owner_id !== viewer.id || intent.metadata?.phase !== "proposal_batch") {
      return res.status(403).json({ error: "This payment doesn't belong to you." });
    }
    const result = await confirmProposalBatchPayment(intent);
    if (!result.ok) return res.status(result.mismatch ? 409 : 400).json({ error: result.error });

    return res.json({ ok: true, bid_ids: result.bidIds });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not confirm proposal payment." });
  }
});

/* ================================================================
   Delivery-anchored release (Terms §6.4). Replaces the old
   30-days-from-charge auto-release. Runs daily via Vercel Cron.

   - One-time jobs (standard bids) and phased service fees: the
     consultant marks the work delivered. The owner has 14 days to
     release (mark complete + review), request changes, or contact
     support. Then the payment releases automatically. The owner gets a
     heads-up on day 7. Request changes clears the delivered mark; the
     window restarts when the consultant marks delivered again.
   - Retainer periods (and a retainer listing's first period, paid on
     the bid): the window opens when the period ends, or sooner if the
     consultant marks it delivered. Once the owner requests changes on a
     period, only a new delivered mark reopens it. The owner's
     auto_release toggle still releases each period at invoice time.
   - Phased proposal fees: released by the owner's decision only.
   - Backstop: anything still held 90 days after its charge is flagged
     for admin (notification + ops alert) and never auto-released.
   - Support hold (admin): pauses auto-release. Alerted once stale (14
     days). Open/lost disputes and partial refunds also block release.
   ================================================================ */
const REVIEW_WINDOW_DAYS = 14;
const REVIEW_NOTICE_DAYS = 7;
const BACKSTOP_DAYS = 90;
const SUPPORT_HOLD_STALE_DAYS = 14;
const RELEASE_SCAN_LIMIT = 1000;
const DAY_MS = 86400000;

const DELIVERY_COLS = "delivered_at, delivery_note, delivery_link, changes_requested_at, changes_request_note, review_reminded_at, support_hold_at, support_hold_reason, backstop_flagged_at, refunded_cents, stripe_fee_cents, platform_fee_cents, " +
  // add_support_outcomes.sql: reported problems + support outcomes A/B/C.
  "problem_reported_at, problem_report_note, problem_report_link, problem_report_count, support_outcome, support_outcome_at, redo_offered_at, redo_deadline_at, redo_reminded_at, redo_used, consultant_choice, consultant_choice_at, response_due_at, consultant_response_at";
const BID_RELEASE_COLS = `id, listing_id, consultant_id, payment_amount_cents, payment_status, payment_intent_id, transfer_id, consultant_payout_cents, paid_at, released_at, ${DELIVERY_COLS}`;
const PHASE_RELEASE_COLS = `id, bid_id, phase, period_index, status, amount_cents, payment_intent_id, charge_id, transfer_id, consultant_payout_cents, paid_at, released_at, refunded_at, period_end_at, ${DELIVERY_COLS}`;

// What the consultant can mark delivered and what auto-releases.
const DELIVERABLE_KINDS = new Set(["one_time", "retainer_first", "service", "retainer_period"]);
// What the owner releases by submitting their review.
const APPROVABLE_KINDS = new Set(["one_time", "retainer_first", "service"]);

function addCadence(ms, cadence) {
  if (cadence === "weekly") return ms + 7 * DAY_MS;
  if (cadence === "biweekly") return ms + 14 * DAY_MS;
  const months = cadence === "monthly" ? 1 : cadence === "quarterly" ? 3 : 0;
  if (!months) return null;
  const d = new Date(ms);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}

// Listing + retainer terms for one engagement. `cache` is per job run.
async function releaseContext(bidId, cache) {
  if (cache?.has(bidId)) return cache.get(bidId);
  const { data: bid } = await supabase
    .from("bids").select("id, listing_id, consultant_id").eq("id", bidId).maybeSingle();
  let ctx = null;
  if (bid) {
    const { data: listing } = await supabase
      .from("listings").select("owner_id, title, contract_type, retainer_cadence").eq("id", bid.listing_id).maybeSingle();
    const { data: sub } = await supabase
      .from("retainer_subscriptions").select("cadence").eq("bid_id", bidId).maybeSingle();
    ctx = {
      bidId,
      ownerId: listing?.owner_id || null,
      consultantId: bid.consultant_id,
      title: listing?.title || "Your engagement",
      contractType: listing?.contract_type || "standard",
      listingCadence: listing?.retainer_cadence || null,
      subCadence: sub?.cadence || null,
    };
  }
  cache?.set(bidId, ctx);
  return ctx;
}

// one_time | retainer_first | proposal | service | retainer_period | maintenance
function paymentKind(item, ctx) {
  if (item.kind === "bid") return ctx?.contractType === "retainer" ? "retainer_first" : "one_time";
  return item.row.phase;
}

function paymentLabel(kind, row) {
  // Same numbering as the engagement page's period list.
  if (kind === "retainer_period") return `Period ${Number(row.period_index) + 1}`;
  if (kind === "retainer_first") return "First period";
  if (kind === "service") return "Service fee";
  if (kind === "proposal") return "Proposal fee";
  return "Payment";
}

function periodEndMs(item, kind, ctx) {
  const paid = Date.parse(item.row.paid_at);
  if (kind === "retainer_period") {
    return item.row.period_end_at ? Date.parse(item.row.period_end_at) : addCadence(paid, ctx?.subCadence);
  }
  if (kind === "retainer_first") return addCadence(paid, ctx?.listingCadence);
  return null;
}

/* When the 14-day review window opens, or null if it hasn't been
   triggered (nothing delivered, or a kind that never auto-releases).
   For retainers it may be in the future (the period hasn't ended). */
function reviewWindow(item, kind, ctx) {
  if (!DELIVERABLE_KINDS.has(kind)) return null;
  const row = item.row;
  const delivered = row.delivered_at ? Date.parse(row.delivered_at) : null;
  // After the owner asks for changes, only a new delivered mark counts.
  const periodEnd = row.changes_requested_at ? null : periodEndMs(item, kind, ctx);
  const opens = [delivered, periodEnd].filter((v) => Number.isFinite(v));
  if (!opens.length) return null;
  const opensAt = Math.min(...opens);
  return {
    opensAt,
    opensBy: opensAt === delivered ? "delivered" : "period_end",
    noticeAt: opensAt + REVIEW_NOTICE_DAYS * DAY_MS,
    releaseAt: opensAt + REVIEW_WINDOW_DAYS * DAY_MS,
  };
}

function backstopAt(item) {
  return Date.parse(item.row.paid_at) + BACKSTOP_DAYS * DAY_MS;
}

function releaseTable(item) {
  return item.kind === "bid" ? "bids" : "bid_phase_payments";
}

function heldStatusField(item) {
  return item.kind === "bid" ? "payment_status" : "status";
}

// Server-side gate for "nothing changed since the job read this row":
// the release claim only wins if delivery / hold state is what we saw.
function unchangedGuard(row) {
  return {
    delivered_at: row.delivered_at ?? null,
    changes_requested_at: row.changes_requested_at ?? null,
    support_hold_at: null,
  };
}

// Release a held phase row on the consultant's behalf (no owner click).
async function autoReleasePhaseRow(row, claimEq, { source = "auto_release_review_window", payoutCents = null } = {}) {
  const { data: bid } = await supabase
    .from("bids").select("consultant_id").eq("id", row.bid_id).maybeSingle();
  const { data: consultant } = bid
    ? await supabase.from("profiles").select("stripe_account_id").eq("id", bid.consultant_id).maybeSingle()
    : { data: null };
  if (!consultant?.stripe_account_id) return { ok: false, error: "Consultant has no payout account" };
  const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
  if (!account.payouts_enabled) return { ok: false, error: "Consultant payouts not enabled" };
  if (!row.charge_id) return { ok: false, error: "missing charge_id" };
  return releasePhaseRow(row, {
    destination: consultant.stripe_account_id,
    metadata: {
      bid_id: row.bid_id,
      phase: row.phase,
      ...(row.period_index != null ? { period_index: String(row.period_index) } : {}),
      source,
    },
    claimEq,
    payoutCents,
  });
}

function shortDate(ms) {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

// One notification per (user, type, link) — the link carries the payment key.
async function notifyOnce(userId, payload) {
  if (!userId) return;
  const { data: prior } = await supabase
    .from("notifications").select("id")
    .eq("user_id", userId).eq("type", payload.type).eq("link", payload.link)
    .limit(1);
  if (prior?.length) return;
  await notifyUser(userId, payload);
}

// Stamp a one-shot column (null → now). True only for the caller that won.
async function stampOnce(item, column, nowIso) {
  const { data, error } = await supabase
    .from(releaseTable(item))
    .update({ [column]: nowIso })
    .eq("id", item.row.id)
    .eq(heldStatusField(item), "held")
    .is(column, null)
    .select("id");
  if (error) throw new Error(`${column} stamp failed: ${error.message}`);
  return Boolean(data?.length);
}

async function scanHeld(nowMs) {
  const { data: bids, error: bidsErr } = await supabase
    .from("bids")
    .select(BID_RELEASE_COLS)
    .eq("payment_status", "held")
    .order("paid_at", { ascending: true })
    .limit(RELEASE_SCAN_LIMIT);
  if (bidsErr) throw new Error(`Release bid scan failed: ${bidsErr.message}`);
  const { data: rows, error: rowsErr } = await supabase
    .from("bid_phase_payments")
    .select(PHASE_RELEASE_COLS)
    .eq("status", "held")
    .order("paid_at", { ascending: true })
    .limit(RELEASE_SCAN_LIMIT);
  if (rowsErr) throw new Error(`Release phase scan failed: ${rowsErr.message}`);
  if ((bids || []).length >= RELEASE_SCAN_LIMIT || (rows || []).length >= RELEASE_SCAN_LIMIT) {
    alertOps("release_scan_truncated", { bids: bids.length, rows: rows.length, at: new Date(nowMs).toISOString() });
  }
  return [
    ...(bids || []).filter((b) => b.paid_at).map((b) => ({
      kind: "bid", key: `bid-${b.id}`, bidId: b.id, row: b,
      cents: b.payment_amount_cents, payoutCents: b.consultant_payout_cents ?? b.payment_amount_cents,
    })),
    ...(rows || []).filter((r) => r.paid_at).map((r) => ({
      kind: "phase", key: `pay-${r.id}`, bidId: r.bid_id, row: r,
      cents: r.amount_cents, payoutCents: r.consultant_payout_cents ?? r.amount_cents,
    })),
  ];
}

async function runReleaseJob(nowMs = Date.now()) {
  const nowIso = new Date(nowMs).toISOString();
  const summary = { released: [], noticed: [], flagged: [], skipped: [], failed: [], stale_holds: [], returned: [], redo_reminders: [] };
  const cache = new Map();

  for (const item of await scanHeld(nowMs)) {
    const ctx = await releaseContext(item.bidId, cache);
    if (!ctx) continue;
    const row = item.row;
    const kind = paymentKind(item, ctx);
    const label = paymentLabel(kind, row);
    const link = `/engagement.html?bid=${item.bidId}#${item.key}`;
    // Free jobs ($0 hold): no money to protect, so no backstop or support
    // alerts. The review window still runs and closes the job out.
    const free = Number(item.cents) === 0;

    // Outcome B: waiting on the consultant's redo / give-back choice.
    // Nothing else applies until they choose or the 5 days run out.
    if (!free && row.support_outcome === "fixable" && !row.consultant_choice) {
      await runRedoClock(item, ctx, nowMs, summary);
      continue;
    }

    // Report or hold with no support decision yet: alert every run once
    // it's 14 days old (support aims to decide within 14 days).
    if (!free && row.support_hold_at && !row.support_outcome && nowMs - Date.parse(row.support_hold_at) >= SUPPORT_HOLD_STALE_DAYS * DAY_MS) {
      const reported = Boolean(row.problem_reported_at);
      const kind = reported ? "problem_report_stale" : "support_hold_stale";
      summary.stale_holds.push(item.key);
      alertOps(kind, { item: item.key, bid_id: item.bidId, hold_since: row.support_hold_at, reason: row.support_hold_reason || null });
      for (const adminId of await adminUserIds()) {
        await notifyOnce(adminId, {
          type: kind,
          title: reported ? `Problem report open ${SUPPORT_HOLD_STALE_DAYS}+ days` : `Support hold open ${SUPPORT_HOLD_STALE_DAYS}+ days`,
          body: `"${ctx.title}" (${label}, ${dollars(item.cents)}) has been waiting since ${shortDate(Date.parse(row.support_hold_at))}. Pick an outcome on the admin payments tab.`,
          link: `/admin/?tab=payments#${item.key}-hold-${row.support_hold_at}`,
        });
      }
    }

    // 90-day backstop: flag once, never auto-release.
    if (!free && nowMs >= backstopAt(item)) {
      if (!row.backstop_flagged_at && await stampOnce(item, "backstop_flagged_at", nowIso)) {
        summary.flagged.push(item.key);
        alertOps("held_payment_backstop", { item: item.key, bid_id: item.bidId, kind, amount_cents: item.cents, paid_at: row.paid_at, delivered_at: row.delivered_at || null, on_hold: Boolean(row.support_hold_at) });
        await notifyAdmins({
          type: "held_payment_backstop",
          title: `Payment held 90+ days · ${dollars(item.cents)}`,
          body: `"${ctx.title}" (${label}) has been held since ${shortDate(Date.parse(row.paid_at))}. It won't release on its own. Release, refund, or follow up with both sides.`,
          link,
        });
      }
      continue;
    }

    if (row.support_hold_at) { summary.skipped.push({ key: item.key, reason: "support_hold" }); continue; }
    if (Number(row.refunded_cents) > 0) { summary.skipped.push({ key: item.key, reason: "partial_refund" }); continue; }

    const win = reviewWindow(item, kind, ctx);
    if (!win || nowMs < win.opensAt) continue;

    if (nowMs >= win.releaseAt) {
      let result;
      try {
        result = item.kind === "bid"
          ? await releaseStandardBid(row, { claimEq: unchangedGuard(row) })
          : await autoReleasePhaseRow(row, unchangedGuard(row));
      } catch (err) {
        result = { ok: false, error: err.message };
      }
      if (result.ok && free) {
        summary.released.push(item.key);
        await notifyOnce(ctx.ownerId, {
          type: "auto_released",
          title: "Engagement marked complete",
          body: `Your 14-day review window for "${ctx.title}" ended, so Grassroots marked the work complete.`,
          link,
        });
        await notifyOnce(ctx.consultantId, {
          type: "auto_released",
          title: "Engagement marked complete",
          body: `The business's review window for "${ctx.title}" ended, so it's marked complete.`,
          link,
        });
      } else if (result.ok) {
        summary.released.push(item.key);
        await notifyOnce(ctx.ownerId, {
          type: "auto_released",
          title: "Payment released to your consultant",
          body: `Your 14-day review window for "${ctx.title}" ended, so Grassroots released ${dollars(item.cents)} to the consultant.`,
          link,
        });
        await notifyOnce(ctx.consultantId, {
          type: "auto_released",
          title: "Payment released",
          body: `${dollars(item.payoutCents)} from "${ctx.title}" is on its way to your Stripe balance.`,
          link,
        });
        await emailPaymentReleased(item.bidId, { grossCents: item.cents, payoutCents: item.payoutCents, key: item.key, link, auto: true });
      } else if (result.disputed || result.conflict || result.partialRefund) {
        summary.skipped.push({ key: item.key, reason: result.disputed ? "disputed" : result.partialRefund ? "partial_refund" : "changed" });
      } else {
        summary.failed.push({ key: item.key, error: result.error });
        alertOps("auto_release_failed", { item: item.key, bid_id: item.bidId, error: result.error });
      }
      continue;
    }

    // Day 7 of the window: heads-up to the business, once per window.
    if (nowMs >= win.noticeAt && !row.review_reminded_at && await stampOnce(item, "review_reminded_at", nowIso)) {
      summary.noticed.push(item.key);
      await notifyUser(ctx.ownerId, {
        type: "review_window_closing",
        title: `Review closes ${shortDate(win.releaseAt)}`,
        body: free
          ? `Review "${ctx.title}" by ${shortDate(win.releaseAt)}. Mark it complete or request changes. After that it's marked complete for you.`
          : `Grassroots is holding ${dollars(item.cents)} for "${ctx.title}" (${label}). Release it, request changes, or contact support by ${shortDate(win.releaseAt)}. After that it releases to the consultant.`,
        link,
      });
    }
  }
  return summary;
}

// Vercel Cron calls this daily with `Authorization: Bearer $CRON_SECRET`.
app.get("/api/cron/auto-release", async (req, res) => {
  const secret = envTrim("CRON_SECRET");
  if (!secret) return res.status(503).json({ error: "CRON_SECRET not configured" });
  if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: "unauthorized" });
  if (!requireStripe(res)) return;
  try {
    const summary = await runReleaseJob();
    console.log("[auto-release]", JSON.stringify(summary));
    return res.json({ ok: true, ...summary });
  } catch (err) {
    console.error("[auto-release] run failed:", err);
    return res.status(500).json({ error: "Auto-release run failed" });
  }
});

/* ── delivery + review endpoints ─────────────────────────────── */

// The held payment a delivery action targets: the bid itself (one-time
// job, retainer first period) or one of its phase rows (`payment_id`).
async function loadReleaseTarget(bidId, paymentId) {
  const ctx = await releaseContext(bidId);
  if (!ctx) return { error: "Engagement not found.", status: 404 };
  let item;
  if (paymentId) {
    const { data: row } = await supabase
      .from("bid_phase_payments").select(PHASE_RELEASE_COLS).eq("id", paymentId).eq("bid_id", bidId).maybeSingle();
    if (!row) return { error: "Payment not found.", status: 404 };
    item = { kind: "phase", key: `pay-${row.id}`, bidId, row, cents: row.amount_cents };
  } else {
    const { data: row } = await supabase
      .from("bids").select(BID_RELEASE_COLS).eq("id", bidId).maybeSingle();
    if (!row) return { error: "Engagement not found.", status: 404 };
    if (ctx.contractType === "phased") return { error: "Pick which payment you mean.", status: 400 };
    item = { kind: "bid", key: `bid-${row.id}`, bidId, row, cents: row.payment_amount_cents };
  }
  const kind = paymentKind(item, ctx);
  const held = item.row[heldStatusField(item)] === "held";
  return { ctx, item, kind, held };
}

function cleanText(value, max) {
  const text = String(value ?? "").trim();
  return text ? text.slice(0, max) : null;
}

// Consultant: mark the work (or a retainer period) delivered. Starts the
// owner's 14-day review window.
app.post("/api/engagement/mark-delivered", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  const paymentId = String(req.body?.payment_id || "").trim() || null;
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  const note = cleanText(req.body?.note, 1000);
  const link = cleanText(req.body?.link, 500);
  if (link && !/^https?:\/\/\S+$/i.test(link)) {
    return res.status(400).json({ error: "The link needs to start with https://." });
  }

  try {
    const t = await loadReleaseTarget(bidId, paymentId);
    if (t.error) return res.status(t.status).json({ error: t.error });
    if (t.ctx.consultantId !== viewer.id) return res.status(403).json({ error: "Only the consultant can mark this delivered." });
    if (!DELIVERABLE_KINDS.has(t.kind)) return res.status(400).json({ error: "This payment releases when the business decides, not on delivery." });
    if (!t.held) return res.status(409).json({ error: "This payment isn't being held anymore." });
    if (t.item.row.delivered_at) return res.status(409).json({ error: "You already marked this delivered." });

    const deliveredAt = new Date().toISOString();
    const { data: won, error } = await supabase
      .from(releaseTable(t.item))
      .update({ delivered_at: deliveredAt, delivery_note: note, delivery_link: link, review_reminded_at: null })
      .eq("id", t.item.row.id)
      .eq(heldStatusField(t.item), "held")
      .is("delivered_at", null)
      .select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (!won?.length) return res.status(409).json({ error: "This payment changed. Reload and try again." });

    const win = reviewWindow({ ...t.item, row: { ...t.item.row, delivered_at: deliveredAt } }, t.kind, t.ctx);
    const label = paymentLabel(t.kind, t.item.row);
    await notifyUser(t.ctx.ownerId, {
      type: "work_delivered",
      title: `${label === "Payment" ? "Work" : label} marked delivered`,
      body: `The consultant marked "${t.ctx.title}" delivered. Review it by ${shortDate(win.releaseAt)}. After that, Grassroots releases the payment to them.`,
      link: `/engagement.html?bid=${bidId}#${t.item.key}`,
      email: {
        event: "work_delivered",
        data: { title: t.ctx.title, bidId, label, reviewByMs: win.releaseAt, free: !(Number(t.item.cents) > 0), note },
        key: `${t.item.key}:${deliveredAt}`,
      },
    });
    return res.json({ ok: true, delivered_at: deliveredAt, auto_release_at: new Date(win.releaseAt).toISOString() });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not mark delivered." });
  }
});

// Owner: ask for changes. Clears the delivered mark and stops the review
// window until the consultant marks delivered again.
app.post("/api/engagement/request-changes", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  const paymentId = String(req.body?.payment_id || "").trim() || null;
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  const note = cleanText(req.body?.note, 1000);

  try {
    const t = await loadReleaseTarget(bidId, paymentId);
    if (t.error) return res.status(t.status).json({ error: t.error });
    if (t.ctx.ownerId !== viewer.id) return res.status(403).json({ error: "Only the business can request changes." });
    if (!t.held) return res.status(409).json({ error: "This payment isn't being held anymore." });
    if (t.item.row.support_hold_at) return res.status(409).json({ error: "Support is reviewing this payment, so changes go through them." });
    const win = reviewWindow(t.item, t.kind, t.ctx);
    if (!win || win.opensAt > Date.now()) {
      return res.status(409).json({ error: "There's nothing delivered to review yet." });
    }

    const requestedAt = new Date().toISOString();
    let query = supabase
      .from(releaseTable(t.item))
      .update({ delivered_at: null, review_reminded_at: null, changes_requested_at: requestedAt, changes_request_note: note })
      .eq("id", t.item.row.id)
      .eq(heldStatusField(t.item), "held");
    query = t.item.row.delivered_at ? query.eq("delivered_at", t.item.row.delivered_at) : query.is("delivered_at", null);
    const { data: won, error } = await query.select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (!won?.length) return res.status(409).json({ error: "This payment changed. Reload and try again." });

    await notifyUser(t.ctx.consultantId, {
      type: "changes_requested",
      title: "The business asked for changes",
      body: `${note ? `"${note.slice(0, 160)}" ` : ""}update "${t.ctx.title}", then mark it delivered again to restart the 14-day review.`,
      link: `/engagement.html?bid=${bidId}#${t.item.key}`,
      email: {
        event: "changes_requested",
        data: { title: t.ctx.title, bidId, note },
        key: `${t.item.key}:${requestedAt}`,
      },
    });
    return res.json({ ok: true, changes_requested_at: requestedAt });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not request changes." });
  }
});

/* Email for events the browser writes straight to Supabase (offers,
   counters, reviews). The caller only names the event and the bid; the
   server checks they're the right participant, that the bid really is in
   that state (and changed recently), then builds the email itself. The
   idempotency key ties each send to the state change, so repeat calls
   send once. */
const CLIENT_EVENT_FRESH_MS = 15 * 60 * 1000;

app.post("/api/notify/event", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const event = String(req.body?.event || "").trim();
  const bidId = String(req.body?.bid_id || "").trim();
  const listingId = String(req.body?.listing_id || "").trim();
  if (!bidId && !(event === "offer_received" && listingId)) {
    return res.status(400).json({ error: "bid_id required." });
  }

  try {
    const cols = "id, listing_id, consultant_id, status, amount_cents, counter_offer_cents, counter_offer_message, counter_expires_at, counter_responded_at, counter_response_message, created_at";
    let query = supabase.from("bids").select(cols);
    query = bidId ? query.eq("id", bidId) : query.eq("listing_id", listingId).eq("consultant_id", viewer.id);
    const { data: bid } = await query.maybeSingle();
    if (!bid) return res.status(404).json({ error: "Offer not found." });
    const { data: listing } = await supabase
      .from("listings").select("id, owner_id, title").eq("id", bid.listing_id).maybeSingle();
    if (!listing) return res.status(404).json({ error: "Listing not found." });

    const isOwner = viewer.id === listing.owner_id;
    const isConsultant = viewer.id === bid.consultant_id;
    const fresh = (iso) => Boolean(iso) && Date.now() - Date.parse(iso) < CLIENT_EVENT_FRESH_MS;
    const base = { title: listing.title || "your listing", listingId: listing.id, bidId: bid.id };
    let to = null;
    let data = base;
    let key = null;

    if (event === "offer_received") {
      if (!isConsultant || !fresh(bid.created_at)) return res.status(409).json({ error: "Nothing to send." });
      to = listing.owner_id;
      data = { ...base, amountCents: bid.amount_cents };
      key = bid.id;
    } else if (event === "counter_received") {
      if (!isOwner || bid.status !== "countered" || bid.counter_offer_cents == null) {
        return res.status(409).json({ error: "Nothing to send." });
      }
      to = bid.consultant_id;
      data = { ...base, counterCents: bid.counter_offer_cents, expiresAt: bid.counter_expires_at, note: bid.counter_offer_message };
      key = `${bid.id}:${bid.counter_expires_at}`;
    } else if (["counter_accepted", "counter_declined", "counter_rescinded"].includes(event)) {
      // Accepting and keeping the original both leave the bid pending, so
      // the state can't tell them apart; the shared key caps it at one email.
      const wantStatus = event === "counter_rescinded" ? "declined" : "pending";
      if (!isConsultant || bid.status !== wantStatus || !fresh(bid.counter_responded_at)) {
        return res.status(409).json({ error: "Nothing to send." });
      }
      to = listing.owner_id;
      data = { ...base, amountCents: bid.amount_cents, note: bid.counter_response_message };
      key = `${bid.id}:${bid.counter_responded_at}`;
    } else if (event === "consultant_review" || event === "business_review") {
      const table = event === "consultant_review" ? "consultant_reviews" : "business_reviews";
      const reviewer = event === "consultant_review" ? isOwner : isConsultant;
      const { data: review } = await supabase.from(table).select("id, created_at").eq("bid_id", bid.id).maybeSingle();
      if (!reviewer || !review || !fresh(review.created_at)) return res.status(409).json({ error: "Nothing to send." });
      to = event === "consultant_review" ? bid.consultant_id : listing.owner_id;
      key = review.id;
    } else {
      return res.status(400).json({ error: "Unknown event." });
    }

    const keyEvent = event.startsWith("counter_") && event !== "counter_received" ? "counter_response" : event;
    await emailUser(to, event, data, { key, keyEvent });
    return res.json({ ok: true });
  } catch (err) {
    console.warn("[notify/event] failed", event, err?.message || err);
    return res.status(500).json({ error: "Could not send the notification." });
  }
});

// Either party: where each held payment stands in the review cycle.
app.get("/api/engagement/:bidId/release-status", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.params.bidId || "").trim();
  try {
    const ctx = await releaseContext(bidId);
    if (!ctx) return res.status(404).json({ error: "Engagement not found." });
    const role = viewer.id === ctx.ownerId ? "owner" : viewer.id === ctx.consultantId ? "consultant" : null;
    if (!role) return res.status(403).json({ error: "Not your engagement." });

    const { data: bid } = await supabase.from("bids").select(BID_RELEASE_COLS).eq("id", bidId).maybeSingle();
    const { data: rows } = await supabase.from("bid_phase_payments").select(PHASE_RELEASE_COLS).eq("bid_id", bidId);
    // Held and released payments, plus finished ones support decided, so
    // both sides keep a settled record on the page.
    const shown = (row, status) => row.paid_at && (status === "held" || status === "released" || Boolean(row.support_outcome) || /^give_back/.test(row.consultant_choice || ""));
    const items = [
      ...(bid && shown(bid, bid.payment_status) ? [{ kind: "bid", key: `bid-${bid.id}`, bidId, row: bid, cents: bid.payment_amount_cents }] : []),
      ...(rows || []).filter((r) => shown(r, r.status)).map((r) => ({ kind: "phase", key: `pay-${r.id}`, bidId, row: r, cents: r.amount_cents })),
    ];
    const nowMs = Date.now();
    const iso = (ms) => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);
    const payments = await Promise.all(items.map(async (item) => {
      const kind = paymentKind(item, ctx);
      const row = item.row;
      const win = reviewWindow(item, kind, ctx);
      const backstop = backstopAt(item);
      const status = row[heldStatusField(item)];
      const held = status === "held";
      const onHold = Boolean(row.support_hold_at);
      const partiallyRefunded = held && Number(row.refunded_cents) > 0;
      const autoReleaseAt = held && win && !onHold && !partiallyRefunded && win.releaseAt < backstop ? win.releaseAt : null;
      const money = paymentMoney(item);
      const waiting = held && waitingOnConsultant(row);
      return {
        key: item.key,
        payment_id: item.kind === "phase" ? row.id : null,
        kind,
        label: paymentLabel(kind, row),
        amount_cents: item.cents,
        paid_at: row.paid_at,
        delivered_at: row.delivered_at,
        delivery_note: row.delivery_note,
        delivery_link: row.delivery_link,
        changes_requested_at: row.changes_requested_at,
        changes_request_note: row.changes_request_note,
        review_opens_at: iso(win?.opensAt),
        review_opens_by: win?.opensBy || null,
        auto_release_at: iso(autoReleaseAt),
        backstop_at: iso(backstop),
        on_hold: onHold,
        partially_refunded: partiallyRefunded,
        free: Number(item.cents) === 0,
        can_mark_delivered: held && role === "consultant" && DELIVERABLE_KINDS.has(kind) && !row.delivered_at,
        can_request_changes: held && role === "owner" && Boolean(win) && win.opensAt <= nowMs && !onHold,
        // Released by review on the engagement page (release-funds or
        // release-service). Allowed during a report: the business can still
        // release it itself.
        can_approve: held && role === "owner" && APPROVABLE_KINDS.has(kind) && Boolean(win) && win.opensAt <= nowMs && !partiallyRefunded && !waiting,
        // Reported problem + support outcome (Terms §7.1).
        status,
        released_at: row.released_at || null,
        refunded_cents: Number(row.refunded_cents || 0),
        reported: Boolean(row.problem_reported_at),
        hold_reason: onHold && !row.problem_reported_at ? row.support_hold_reason : null,
        response_due_at: held && row.support_hold_at && !row.support_outcome ? row.response_due_at : null,
        responded_at: held ? row.consultant_response_at : null,
        // Only the consultant sees their own response text.
        ...(role === "consultant" && held && row.consultant_response_at
          ? await latestResponse(item).then((r) => ({ consultant_response_note: r?.note || null, consultant_response_link: r?.link || null }))
          : { consultant_response_note: null, consultant_response_link: null }),
        can_respond: held && role === "consultant" && onHold && !row.support_outcome && Boolean(row.response_due_at) && nowMs < Date.parse(row.response_due_at),
        problem_reported_at: row.problem_reported_at,
        problem_report_note: row.problem_report_note,
        problem_report_link: row.problem_report_link,
        support_outcome: row.support_outcome,
        redo_used: Boolean(row.redo_used),
        consultant_choice: row.consultant_choice,
        redo_deadline_at: waiting ? row.redo_deadline_at : null,
        waiting_on_consultant: waiting,
        can_report_problem: held && Number(item.cents) > 0 && role === "owner" && DELIVERABLE_KINDS.has(kind) && Boolean(win) && win.opensAt <= nowMs && nowMs < win.releaseAt && !onHold,
        can_choose: waiting && role === "consultant" && nowMs < Date.parse(row.redo_deadline_at),
        money: {
          gross_cents: money.gross_cents,
          give_back_cents: money.give_back_cents,
          payout_cents: money.payout_cents,
          // What the consultant got. Legacy rows with no stored payout
          // transferred the full amount.
          ...(status === "released" ? { released_payout_cents: Number(row.consultant_payout_cents ?? item.cents) } : {}),
          // Custom split: what went where (refunded_cents is the business's part).
          ...(row.support_outcome === "split" ? { split_refund_cents: Number(row.refunded_cents || 0), split_transfer_cents: Number(row.consultant_payout_cents || 0) } : {}),
        },
      };
    }));
    return res.json({ role, payments });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load payment status." });
  }
});

/* ── reported problems + support outcomes ─────────────────────
   Terms §6.4, §7.1, §21 (moiz, 2026-10-23).
   - During its 14-day review the business can report a problem. That
     locks the payment (support hold): no auto-release, but the business
     can still release it itself.
   - Support picks one outcome on the admin payments tab:
       meets_scope    (A) → release to the consultant.
       fixable        (B) → the consultant has 5 days to redo the work
                            (once per payment) or give the payment back
                            (full refund). No answer = give back.
       scope_breached (C) → full refund; consultant gets nothing.
       split              → support divides what's left on the charge;
                            the consultant's part is capped at their
                            full-release payout.
     Every support refund is in full: the business gets back exactly what
     it paid (all-in pricing) and grassroots absorbs the card fee.
     After a redo, a second report allows only A, C or split.
   - There is no plain "clear hold": a hold ends by release, refund, or
     the consultant choosing to redo.
   - Partly refunded payments: support releases or refunds the rest.
   - Every support / outcome action writes a payment_audit row.
   ================================================================ */
const REDO_CHOICE_DAYS = 5;
const REDO_REMINDER_DAYS = 3;
// The consultant's window to tell support their side, from the hold.
const RESPONSE_WINDOW_MS = 48 * 60 * 60 * 1000;
const SUPPORT_OUTCOMES = new Set(["meets_scope", "fixable", "scope_breached", "split"]);
const SYSTEM_ACTOR = { id: null, email: "system:auto-release" };
const WAITING_ERROR = "This payment is waiting on the consultant's choice.";

// Money on one held payment. gross = what the business was charged.
function paymentMoney(item) {
  const row = item.row;
  const platformFee = Number(row.platform_fee_cents || 0);
  // All-in pricing: the business paid exactly the offer. The card fee and
  // the platform fee come out of the consultant's payout.
  const gross = item.kind === "bid" ? Number(row.payment_amount_cents || 0) : phaseRowGross(row);
  const cardFee = row.stripe_fee_cents != null ? Number(row.stripe_fee_cents) : fees.estimateStripeFeeCents(gross);
  const refunded = Number(row.refunded_cents || 0);
  const remaining = Math.max(0, gross - refunded);
  const payout = Number(row.consultant_payout_cents ?? fees.computeFees(gross).consultantPayoutCents);
  return {
    gross_cents: gross,
    platform_fee_cents: platformFee,
    card_fee_cents: cardFee,
    refunded_cents: refunded,
    remaining_cents: remaining,
    payout_cents: payout,
    // Outcome B (ii): everything still on the charge. Every support-driven
    // refund is in full; grassroots absorbs Stripe's card fee (moiz,
    // 2026-10-24).
    give_back_cents: remaining,
    // Outcome C: everything still on the charge.
    full_refund_cents: remaining,
    // Partly refunded payment: what the consultant gets for the rest.
    remainder_payout_cents: Math.max(0, Math.min(payout, remaining - cardFee - platformFee)),
  };
}

// The charge behind a held payment (bids keep only the PaymentIntent).
async function chargeIdFor(item) {
  if (item.kind === "phase") return item.row.charge_id || null;
  if (!item.row.payment_intent_id) return null;
  const intent = await stripe.paymentIntents.retrieve(item.row.payment_intent_id);
  return idOf(intent.latest_charge);
}

/* Stripe's actual card-processing fee on this payment — what grassroots
   absorbs when support refunds it. Internal record only (audit rows, admin
   screen); never deducted from a refund and never shown to either party.
   Standard US pricing is 2.9% + 30¢ of the charge; `note` says why when
   Stripe charged something else. A phase row on a combined charge
   (proposal batch) takes its share. Falls back to the checkout estimate. */
async function cardFeeFor(item) {
  const money = paymentMoney(item);
  const estimate = { card_fee_cents: money.card_fee_cents, standard_fee_cents: money.card_fee_cents, source: "estimate", note: null };
  try {
    const chargeId = await chargeIdFor(item);
    if (!chargeId) throw new Error("no charge on this payment");
    const charge = await stripe.charges.retrieve(chargeId, { expand: ["balance_transaction"] });
    const bt = charge?.balance_transaction;
    if (!bt || typeof bt !== "object") throw new Error("Stripe hasn't settled this charge's fee yet");
    const stripeFees = (bt.fee_details || []).filter((f) => f.type === "stripe_fee");
    const totalFee = stripeFees.length ? stripeFees.reduce((sum, f) => sum + Number(f.amount || 0), 0) : Number(bt.fee);
    if (!Number.isFinite(totalFee)) throw new Error("no fee on the balance transaction");
    const chargeAmount = Number(charge.amount) || money.gross_cents;
    const share = chargeAmount > 0 ? Math.min(1, money.gross_cents / chargeAmount) : 1;
    const fee = Math.round(totalFee * share);
    const standard = Math.round(fees.estimateStripeFeeCents(chargeAmount) * share);

    let note = null;
    if (Math.abs(fee - standard) > 1) {
      const card = charge.payment_method_details?.card || {};
      const why = [];
      if (card.country && card.country !== "US") why.push(`An international card (issued in ${card.country})`);
      if ((charge.currency && charge.currency !== "usd") || bt.exchange_rate) why.push("paid in another currency");
      const usual = `${dollars(standard)} (2.9% + 30¢)`;
      note = why.length
        ? `The card fee was ${dollars(fee)}, ${fee > standard ? "more than" : "not"} the usual ${usual}, because this was ${why.join(" and ")}.`
        : `Stripe charged ${dollars(fee)} to process this card, not the usual ${usual}.`;
      if (share < 1) note += " This payment's share of a combined charge.";
    }
    return { card_fee_cents: fee, standard_fee_cents: standard, source: "stripe", note };
  } catch {
    return estimate;
  }
}

// Fields that open a fresh 48-hour response window (report or hold).
function responseWindowFields(nowMs) {
  return {
    response_due_at: new Date(nowMs + RESPONSE_WINDOW_MS).toISOString(),
    consultant_response_at: null,
  };
}

// The consultant's latest response for the current hold. The text is kept
// in payment_audit (server-only), never on the payment row the business
// can read.
async function latestResponse(item) {
  const row = item.row;
  if (!row.consultant_response_at || !row.support_hold_at) return null;
  const { data } = await supabase
    .from("payment_audit")
    .select("created_at, details")
    .eq("payment_id", row.id)
    .in("action", ["consultant_response", "consultant_response_updated"])
    .order("created_at", { ascending: false })
    .limit(20);
  const since = Date.parse(row.support_hold_at);
  const hit = (data || [])
    .filter((a) => Date.parse(a.created_at) >= since)
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  return hit ? { note: hit.details?.note || null, link: hit.details?.link || null, at: hit.created_at } : null;
}

// Still inside the consultant's 48 hours and they haven't responded.
function responsePending(row, nowMs = Date.now()) {
  return Boolean(row.response_due_at) && !row.consultant_response_at && nowMs < Date.parse(row.response_due_at);
}

function longDate(ms) {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/New_York", timeZoneName: "short" }).toLowerCase();
}

// Could the business report this itself right now? Then support doesn't
// place the hold for them — it points them to "report a problem".
function businessCanReport(t, nowMs = Date.now()) {
  if (!DELIVERABLE_KINDS.has(t.kind) || t.item.row.support_hold_at) return false;
  const win = reviewWindow(t.item, t.kind, t.ctx);
  return Boolean(win) && win.opensAt <= nowMs && nowMs < win.releaseAt;
}

function waitingOnConsultant(row) {
  return row.support_outcome === "fixable" && !row.consultant_choice;
}

function paymentLink(item) {
  return `/engagement.html?bid=${item.bidId}#${item.key}`;
}

// Never throws: a missing audit row must not undo a money movement.
async function writeAudit(item, action, actor, { amountCents = null, stripeId = null, details = {} } = {}) {
  try {
    const { error } = await supabase.from("payment_audit").insert({
      payment_table: releaseTable(item),
      payment_id: item.row.id,
      bid_id: item.bidId,
      action,
      actor_id: actor?.id || null,
      actor_email: actor?.email || null,
      amount_cents: amountCents,
      stripe_object_id: stripeId,
      details,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    alertOps("payment_audit_failed", { item: item.key, action, error: err.message });
  }
}

async function viewerEmail(viewer) {
  try {
    const { data } = await supabase.auth.admin.getUserById?.(viewer.id) || {};
    return data?.user?.email || null;
  } catch {
    return null;
  }
}

/* Refund part or all of a held payment. Claims held → refunded first
   (compare-and-set on refunded_cents, plus `claimEq`), then calls Stripe
   with an idempotency key; rolls the claim back if Stripe fails. */
async function refundHeldPayment(item, amountCents, { updates = {}, claimEq = {}, reason }) {
  const row = item.row;
  const table = releaseTable(item);
  const field = heldStatusField(item);
  if (!(amountCents > 0)) return { ok: false, status: 400, error: "There's nothing left to refund." };

  let chargeId = row.charge_id || null;
  const paymentIntentId = row.payment_intent_id || null;
  if (item.kind === "bid") {
    if (!paymentIntentId) return { ok: false, status: 400, error: "No payment on this bid." };
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.transfer_data?.destination) {
      return { ok: false, status: 409, error: "This payment went to the consultant at checkout. Refund it in Stripe with a transfer reversal." };
    }
    chargeId = idOf(intent.latest_charge);
  }
  if (!chargeId && !paymentIntentId) return { ok: false, status: 400, error: "No charge on this payment." };
  if (await chargeDisputeHold(chargeId)) {
    return { ok: false, status: 409, disputed: true, error: "This payment is under a card dispute. Settle the dispute in Stripe first." };
  }

  const nowIso = new Date().toISOString();
  const before = Number(row.refunded_cents || 0);
  const claim = {
    [field]: "refunded",
    refunded_cents: before + amountCents,
    ...(item.kind === "phase" ? { refunded_at: nowIso } : {}),
    ...updates,
  };
  const claimed = await casUpdate(table, row.id, "held", claim, field, { refunded_cents: before, ...claimEq });
  if (!claimed) return { ok: false, status: 409, conflict: true, error: "This payment changed. Reload and try again." };

  let refund;
  try {
    refund = await stripe.refunds.create(
      {
        ...(chargeId ? { charge: chargeId } : { payment_intent: paymentIntentId }),
        amount: amountCents,
        metadata: { bid_id: item.bidId, payment_table: table, payment_id: row.id, reason },
      },
      { idempotencyKey: idemKey("refund", "support", table, row.id, reason, amountCents) }
    );
  } catch (err) {
    const revert = { [field]: "held", refunded_cents: before, ...(item.kind === "phase" ? { refunded_at: null } : {}) };
    for (const key of Object.keys(updates)) revert[key] = row[key] ?? null;
    const { error: revertErr } = await supabase.from(table).update(revert).eq("id", row.id).eq(field, "refunded");
    if (revertErr) alertOps("support_refund_revert_failed", { item: item.key, error: revertErr.message });
    throw err;
  }
  return { ok: true, refund_id: refund.id, amount_cents: amountCents };
}

// Release a held payment on support's decision (dispute check inside).
async function releaseHeldPayment(item, { claimEq = {}, payoutCents = null, source }) {
  const result = item.kind === "bid"
    ? await releaseStandardBid(item.row, { claimEq, payoutCents })
    : await autoReleasePhaseRow(item.row, claimEq, { source, payoutCents });
  if (!result.ok && !result.status) result.status = result.disputed || result.conflict || result.partialRefund ? 409 : 400;
  return result;
}

async function stampOutcome(item, updates) {
  const { error } = await supabase.from(releaseTable(item)).update(updates).eq("id", item.row.id);
  if (error) alertOps("support_outcome_not_saved", { item: item.key, updates, error: error.message });
}

async function notifyBoth(ctx, owner, consultant, link) {
  await notifyUser(ctx.ownerId, { ...owner, link });
  await notifyUser(ctx.consultantId, { ...consultant, link });
}

// Outcome B (ii), by the consultant's choice or after 5 days with none.
async function giveBackPayment(item, ctx, choice, actor) {
  const money = paymentMoney(item);
  const nowIso = new Date().toISOString();
  const result = await refundHeldPayment(item, money.give_back_cents, {
    updates: { consultant_choice: choice, consultant_choice_at: nowIso },
    claimEq: { support_outcome: "fixable", consultant_choice: null },
    reason: choice,
  });
  if (!result.ok) return result;
  const fee = await cardFeeFor(item);
  await writeAudit(item, choice === "give_back" ? "consultant_give_back" : "give_back_timeout", actor, {
    amountCents: result.amount_cents,
    stripeId: result.refund_id,
    details: { gross_cents: money.gross_cents, ...absorbedDetails(fee) },
  });
  const timedOut = choice === "give_back_timeout";
  await notifyBoth(ctx, {
    type: "payment_returned",
    title: `You were refunded ${dollars(result.amount_cents)} in full`,
    body: `${timedOut ? `The consultant didn't choose within ${REDO_CHOICE_DAYS} days, so the payment for "${ctx.title}" went back to you.` : `The consultant gave the payment back for "${ctx.title}".`} Cards can take 5–10 business days to show it.`,
  }, {
    type: "payment_returned",
    title: timedOut ? "The payment went back to the business" : "You gave the payment back",
    body: `${timedOut ? `You didn't choose within ${REDO_CHOICE_DAYS} days, so the business` : "The business"} was refunded for "${ctx.title}". You won't be paid for this payment.`,
  }, paymentLink(item));
  return { ...result, money };
}

// Audit fields for the card fee grassroots absorbs on a support refund.
function absorbedDetails(fee) {
  return { card_fee_absorbed_cents: fee.card_fee_cents, fee_source: fee.source, ...(fee.note ? { fee_note: fee.note } : {}) };
}

// The consultant's connected account, if it can take a payout now.
async function consultantDestination(consultantId) {
  const { data: profile } = await supabase.from("profiles").select("stripe_account_id").eq("id", consultantId).maybeSingle();
  if (!profile?.stripe_account_id) return { error: "The consultant hasn't set up payouts yet." };
  const account = await stripe.accounts.retrieve(profile.stripe_account_id);
  if (!account.payouts_enabled) return { error: "The consultant's payout setup is incomplete." };
  return { destination: profile.stripe_account_id };
}

// The consultant's part of a split. Idempotent per row + amount, so a
// retry after a lost response returns the same transfer.
async function transferSplit(item, chargeId, destination, amountCents) {
  const table = releaseTable(item);
  try {
    const transfer = await stripe.transfers.create(
      {
        amount: amountCents,
        currency: "usd",
        destination,
        source_transaction: chargeId,
        metadata: { bid_id: item.bidId, payment_table: table, payment_id: item.row.id, source: "support_split" },
      },
      { idempotencyKey: idemKey("transfer", "split", table, item.row.id, amountCents) }
    );
    const { error } = await supabase.from(table).update({ transfer_id: transfer.id }).eq("id", item.row.id);
    if (error) alertOps("split_transfer_id_not_saved", { item: item.key, transfer_id: transfer.id, error: error.message });
    return { transfer_id: transfer.id };
  } catch (err) {
    alertOps("split_transfer_failed", { item: item.key, bid_id: item.bidId, amount_cents: amountCents, error: err.message });
    return { error: err.message };
  }
}

/* Custom split (support): part refunded to the business, the rest (up to
   what's left on the charge) transferred to the consultant; grassroots
   absorbs the card fee. Claims held → released first (compare-and-set on
   refunded_cents + `claimEq`), then refunds, then transfers, each with an
   idempotency key. A failed refund rolls the claim back. A failed transfer
   after the refund went through leaves the row released with no
   transfer_id; ops is alerted and support retries from the admin screen. */
async function splitHeldPayment(item, ctx, refundCents, transferCents, { claimEq = {} } = {}) {
  const row = item.row;
  const table = releaseTable(item);
  const field = heldStatusField(item);
  const money = paymentMoney(item);
  if (!Number.isInteger(refundCents) || !Number.isInteger(transferCents) || refundCents <= 0 || transferCents <= 0) {
    return { ok: false, status: 400, error: "A split needs a refund and a payout above $0. Use meets scope or scope breached for all or nothing." };
  }
  if (refundCents + transferCents > money.remaining_cents) {
    return { ok: false, status: 400, error: `The refund and payout can't add up to more than the ${dollars(money.remaining_cents)} left on this payment.` };
  }
  // All-in pricing: the consultant's part is capped at what a full release
  // would pay them (the offer minus the card and platform fees).
  if (transferCents > money.remainder_payout_cents) {
    return { ok: false, status: 400, error: `The consultant's part can't be more than their ${dollars(money.remainder_payout_cents)} payout on a full release.` };
  }
  let chargeId = row.charge_id || null;
  if (item.kind === "bid") {
    if (!row.payment_intent_id) return { ok: false, status: 400, error: "No payment on this bid." };
    const intent = await stripe.paymentIntents.retrieve(row.payment_intent_id);
    if (intent.transfer_data?.destination) {
      return { ok: false, status: 409, error: "This payment went to the consultant at checkout. Split it in Stripe with a partial transfer reversal." };
    }
    chargeId = idOf(intent.latest_charge);
  }
  if (!chargeId) return { ok: false, status: 400, error: "No charge on this payment." };
  const dest = await consultantDestination(ctx.consultantId);
  if (dest.error) return { ok: false, status: 400, error: dest.error };
  if (await chargeDisputeHold(chargeId)) {
    return { ok: false, status: 409, disputed: true, error: "This payment is under a card dispute. Settle the dispute in Stripe first." };
  }

  const nowIso = new Date().toISOString();
  const before = Number(row.refunded_cents || 0);
  const claimed = await casUpdate(table, row.id, "held", {
    [field]: "released",
    released_at: nowIso,
    refunded_cents: before + refundCents,
    consultant_payout_cents: transferCents,
    support_outcome: "split",
    support_outcome_at: nowIso,
    ...(item.kind === "phase" ? { refunded_at: nowIso } : {}),
  }, field, { refunded_cents: before, ...claimEq });
  if (!claimed) return { ok: false, status: 409, conflict: true, error: "This payment changed. Reload and try again." };

  let refund;
  try {
    refund = await stripe.refunds.create(
      { charge: chargeId, amount: refundCents, metadata: { bid_id: item.bidId, payment_table: table, payment_id: row.id, reason: "split" } },
      { idempotencyKey: idemKey("refund", "split", table, row.id, refundCents) }
    );
  } catch (err) {
    const revert = {
      [field]: "held",
      released_at: null,
      refunded_cents: before,
      consultant_payout_cents: row.consultant_payout_cents ?? null,
      support_outcome: null,
      support_outcome_at: null,
      ...(item.kind === "phase" ? { refunded_at: row.refunded_at ?? null } : {}),
    };
    const { error: revertErr } = await supabase.from(table).update(revert).eq("id", row.id).eq(field, "released").is("transfer_id", null);
    if (revertErr) alertOps("split_revert_failed", { item: item.key, error: revertErr.message });
    throw err;
  }
  const transfer = await transferSplit(item, chargeId, dest.destination, transferCents);
  return { ok: true, refund_id: refund.id, transfer_id: transfer.transfer_id || null, transfer_error: transfer.error || null };
}

// Daily job, outcome B: 5-day deadline and the day-3 reminder.
async function runRedoClock(item, ctx, nowMs, summary) {
  const row = item.row;
  const deadline = Date.parse(row.redo_deadline_at);
  if (Number.isFinite(deadline) && nowMs >= deadline) {
    let result;
    try {
      result = await giveBackPayment(item, ctx, "give_back_timeout", SYSTEM_ACTOR);
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    if (result.ok) summary.returned.push(item.key);
    else if (result.conflict || result.disputed) summary.skipped.push({ key: item.key, reason: result.disputed ? "disputed" : "changed" });
    else {
      summary.failed.push({ key: item.key, error: result.error });
      alertOps("give_back_timeout_failed", { item: item.key, bid_id: item.bidId, error: result.error });
    }
    return;
  }
  const remindAt = Date.parse(row.redo_offered_at) + REDO_REMINDER_DAYS * DAY_MS;
  if (nowMs >= remindAt && !row.redo_reminded_at && await stampOnce(item, "redo_reminded_at", new Date(nowMs).toISOString())) {
    summary.redo_reminders.push(item.key);
    const daysLeft = Math.max(1, Math.ceil((deadline - nowMs) / DAY_MS));
    await notifyUser(ctx.consultantId, {
      type: "redo_choice_reminder",
      title: `${daysLeft} day${daysLeft === 1 ? "" : "s"} left to choose`,
      body: `Redo the work for "${ctx.title}" or give the payment back by ${shortDate(deadline)}. If you don't choose, the payment goes back to the business.`,
      link: paymentLink(item),
    });
  }
}

// Business: report a problem during the 14-day review. Locks the payment.
app.post("/api/engagement/report-problem", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  const paymentId = String(req.body?.payment_id || "").trim() || null;
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  const note = cleanText(req.body?.note, 1000);
  const link = cleanText(req.body?.link, 500);
  if (!note) return res.status(400).json({ error: "Tell support what's wrong." });
  if (link && !/^https?:\/\/\S+$/i.test(link)) return res.status(400).json({ error: "The link needs to start with https://." });

  try {
    const t = await loadReleaseTarget(bidId, paymentId);
    if (t.error) return res.status(t.status).json({ error: t.error });
    if (t.ctx.ownerId !== viewer.id) return res.status(403).json({ error: "Only the business can report a problem." });
    if (!t.held) return res.status(409).json({ error: "This payment isn't being held anymore." });
    if (!DELIVERABLE_KINDS.has(t.kind)) return res.status(400).json({ error: "This payment releases when you decide. Contact support if something's wrong." });
    if (Number(t.item.cents) === 0) return res.status(409).json({ error: "There's no payment to report here. Contact support if something's wrong." });
    const row = t.item.row;
    if (row.support_hold_at) return res.status(409).json({ error: "Support is already reviewing this payment." });
    const win = reviewWindow(t.item, t.kind, t.ctx);
    const nowMs = Date.now();
    if (!win || win.opensAt > nowMs) return res.status(409).json({ error: "There's nothing delivered to review yet." });
    if (nowMs >= win.releaseAt) return res.status(409).json({ error: "The 14-day review for this payment has ended." });

    const nowIso = new Date(nowMs).toISOString();
    const priorCount = Number(row.problem_report_count || 0);
    const { data: won, error } = await supabase
      .from(releaseTable(t.item))
      .update({
        support_hold_at: nowIso,
        support_hold_reason: "The business reported a problem",
        support_hold_by: viewer.id,
        problem_reported_at: nowIso,
        problem_report_note: note,
        problem_report_link: link,
        problem_report_count: priorCount + 1,
        support_outcome: null,
        support_outcome_at: null,
        ...responseWindowFields(nowMs),
      })
      .eq("id", row.id)
      .eq(heldStatusField(t.item), "held")
      .is("support_hold_at", null)
      .eq("problem_report_count", priorCount)
      .select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (!won?.length) return res.status(409).json({ error: "This payment changed. Reload and try again." });

    const afterRedo = Boolean(row.redo_used);
    await writeAudit(t.item, "problem_reported", { id: viewer.id, email: await viewerEmail(viewer) }, { details: { note, link, report_count: priorCount + 1, after_redo: afterRedo } });
    const label = paymentLabel(t.kind, row);
    const money = paymentMoney(t.item);
    await notifyBoth(t.ctx, {
      type: "problem_reported",
      title: "You reported a problem",
      body: `Support is reviewing "${t.ctx.title}". The payment won't release on its own. You can still release it yourself.`,
    }, {
      type: "problem_reported",
      title: "The business reported a problem",
      body: `"${note.slice(0, 160)}" Tell support your side by ${longDate(nowMs + RESPONSE_WINDOW_MS)}. The payment stays held until support decides.`,
    }, paymentLink(t.item));
    await notifyAdmins({
      type: "problem_reported",
      title: `Problem reported · ${dollars(money.gross_cents)}`,
      body: `"${t.ctx.title}" (${label}).${afterRedo ? " Reported again after a redo: meets scope or scope breached only." : ""} Aim to decide by ${shortDate(nowMs + SUPPORT_HOLD_STALE_DAYS * DAY_MS)}.`,
      link: `/admin/?tab=payments#${t.item.key}`,
    });
    return res.json({ ok: true, problem_reported_at: nowIso });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not report the problem." });
  }
});

// Consultant, after outcome B: redo the work (once) or give the payment back.
app.post("/api/engagement/redo-choice", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  const paymentId = String(req.body?.payment_id || "").trim() || null;
  const choice = String(req.body?.choice || "");
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  if (!["redo", "give_back"].includes(choice)) return res.status(400).json({ error: "Choose redo or give_back." });

  try {
    const t = await loadReleaseTarget(bidId, paymentId);
    if (t.error) return res.status(t.status).json({ error: t.error });
    if (t.ctx.consultantId !== viewer.id) return res.status(403).json({ error: "Only the consultant can make this choice." });
    if (!t.held) return res.status(409).json({ error: "This payment isn't being held anymore." });
    const row = t.item.row;
    if (!waitingOnConsultant(row)) return res.status(409).json({ error: "There's no choice to make on this payment." });
    if (Date.now() >= Date.parse(row.redo_deadline_at)) {
      return res.status(409).json({ error: `The ${REDO_CHOICE_DAYS} days to choose have passed, so the payment goes back to the business.` });
    }
    const actor = { id: viewer.id, email: await viewerEmail(viewer) };

    if (choice === "give_back") {
      const result = await giveBackPayment(t.item, t.ctx, "give_back", actor);
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      return res.json({ ok: true, choice, refunded_cents: result.amount_cents });
    }

    // Redo: back to "changes requested" so only a new delivered mark opens
    // a fresh 14-day review (also for retainer periods). The lock lifts.
    const nowIso = new Date().toISOString();
    const { data: won, error } = await supabase
      .from(releaseTable(t.item))
      .update({
        consultant_choice: "redo",
        consultant_choice_at: nowIso,
        redo_used: true,
        support_outcome: null,
        delivered_at: null,
        review_reminded_at: null,
        changes_requested_at: nowIso,
        changes_request_note: row.problem_report_note,
        support_hold_at: null,
        support_hold_reason: null,
        support_hold_by: null,
        problem_reported_at: null,
      })
      .eq("id", row.id)
      .eq(heldStatusField(t.item), "held")
      .eq("support_outcome", "fixable")
      .is("consultant_choice", null)
      .select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (!won?.length) return res.status(409).json({ error: "This payment changed. Reload and try again." });

    await writeAudit(t.item, "consultant_redo", actor);
    await notifyBoth(t.ctx, {
      type: "redo_choice",
      title: "The consultant is redoing the work",
      body: `You'll get a new 14-day review for "${t.ctx.title}" when they deliver again. This is the last redo for this payment.`,
    }, {
      type: "redo_choice",
      title: "You chose to redo the work",
      body: `Mark "${t.ctx.title}" delivered when it's ready. The business gets a new 14-day review. This is your one redo for this payment.`,
    }, paymentLink(t.item));
    return res.json({ ok: true, choice });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not save your choice." });
  }
});

// Consultant: tell support their side of a report or hold. 48 hours from
// the hold; they can update it until then. Support sees it on the admin
// screen; the business only sees that a response was sent.
app.post("/api/engagement/respond-to-report", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "Sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  const paymentId = String(req.body?.payment_id || "").trim() || null;
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  const note = cleanText(req.body?.note, 2000);
  const link = cleanText(req.body?.link, 500);
  if (!note) return res.status(400).json({ error: "Tell support what happened." });
  if (link && !/^https?:\/\/\S+$/i.test(link)) return res.status(400).json({ error: "The link needs to start with https://." });

  try {
    const t = await loadReleaseTarget(bidId, paymentId);
    if (t.error) return res.status(t.status).json({ error: t.error });
    if (t.ctx.consultantId !== viewer.id) return res.status(403).json({ error: "Only the consultant can respond." });
    if (!t.held) return res.status(409).json({ error: "This payment isn't being held anymore." });
    const row = t.item.row;
    if (!row.support_hold_at || row.support_outcome || !row.response_due_at) {
      return res.status(409).json({ error: "There's nothing to respond to on this payment." });
    }
    if (Date.now() >= Date.parse(row.response_due_at)) {
      return res.status(409).json({ error: "The 48 hours to respond have passed. Support will decide from the engagement record." });
    }
    const nowIso = new Date().toISOString();
    const first = !row.consultant_response_at;
    const { data: won, error } = await supabase
      .from(releaseTable(t.item))
      .update({ consultant_response_at: nowIso })
      .eq("id", row.id)
      .eq(heldStatusField(t.item), "held")
      .eq("support_hold_at", row.support_hold_at)
      .is("support_outcome", null)
      .select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (!won?.length) return res.status(409).json({ error: "This payment changed. Reload and try again." });

    await writeAudit(t.item, first ? "consultant_response" : "consultant_response_updated", { id: viewer.id, email: await viewerEmail(viewer) }, { details: { note, link } });
    await notifyAdmins({
      type: "consultant_response",
      title: first ? "The consultant responded to a report" : "The consultant updated their response",
      body: `"${t.ctx.title}" (${paymentLabel(t.kind, row)}): "${note.slice(0, 160)}"`,
      link: `/admin/?tab=payments#${t.item.key}`,
    });
    if (first) {
      await notifyUser(t.ctx.ownerId, {
        type: "consultant_response",
        title: "The consultant responded",
        body: `The consultant sent support their side of "${t.ctx.title}". Support will decide and let you both know.`,
        link: paymentLink(t.item),
      });
    }
    return res.json({ ok: true, consultant_response_at: nowIso });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not send your response." });
  }
});

/* ── admin: support actions ──────────────────────────────────── */

// Load + admin-check a support action's target. Returns { admin, t } or sends.
async function adminTarget(req, res) {
  const admin = await requireAdmin(req);
  if (!admin) { res.status(403).json({ error: "Admin only." }); return null; }
  if (!requireStripe(res)) return null;
  const bidId = String(req.body?.bid_id || "").trim();
  const paymentId = String(req.body?.payment_id || "").trim() || null;
  if (!bidId) { res.status(400).json({ error: "bid_id required." }); return null; }
  const t = await loadReleaseTarget(bidId, paymentId);
  if (t.error) { res.status(t.status).json({ error: t.error }); return null; }
  if (!t.held) { res.status(409).json({ error: "This payment isn't being held anymore." }); return null; }
  // Free jobs are $0 holds with no Stripe charge: nothing to hold, refund,
  // split or transfer.
  if (Number(t.item.cents) === 0) { res.status(409).json({ error: "This is a free job. There's no money to hold, refund or release." }); return null; }
  return { admin, t };
}

// Admin: put a payment on hold on support's own initiative (e.g. the
// business emailed support). Ends only with an outcome, not a clear.
app.post("/api/admin/payments/hold", async (req, res) => {
  const reason = cleanText(req.body?.reason, 500);
  try {
    const got = await adminTarget(req, res);
    if (!got) return;
    if (!reason) return res.status(400).json({ error: "Add a short reason for the hold. Both sides will see it." });
    const { admin, t } = got;
    if (businessCanReport(t)) {
      return res.status(409).json({ error: "The business can report this themselves. Point them to \"Report a problem\" on the engagement page." });
    }
    const nowMs = Date.now();
    const nowIso = new Date(nowMs).toISOString();
    const { data: won, error } = await supabase
      .from(releaseTable(t.item))
      .update({ support_hold_at: nowIso, support_hold_reason: reason, support_hold_by: admin.id, ...responseWindowFields(nowMs) })
      .eq("id", t.item.row.id)
      .eq(heldStatusField(t.item), "held")
      .is("support_hold_at", null)
      .select("id");
    if (error) return res.status(500).json({ error: error.message });
    if (!won?.length) return res.json({ ok: true, unchanged: true });

    alertOps("support_hold_set", { item: t.item.key, bid_id: t.item.bidId, by: admin.email, reason });
    await writeAudit(t.item, "support_hold", admin, { details: { reason } });
    await notifyBoth(t.ctx, {
      type: "support_hold",
      title: "Support put a payment on hold",
      body: `"${reason.slice(0, 160)}" Grassroots won't release "${t.ctx.title}" until support decides.`,
    }, {
      type: "support_hold",
      title: "Support put your payment on hold",
      body: `"${reason.slice(0, 160)}" tell support your side of "${t.ctx.title}" by ${longDate(nowMs + RESPONSE_WINDOW_MS)}.`,
    }, paymentLink(t.item));
    return res.json({ ok: true, support_hold_at: nowIso });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not place the hold." });
  }
});

// Admin: outcome A / B / C for a held payment (Terms §7.1).
app.post("/api/admin/payments/outcome", async (req, res) => {
  const outcome = String(req.body?.outcome || "");
  const note = cleanText(req.body?.note, 500);
  try {
    if (!SUPPORT_OUTCOMES.has(outcome)) {
      if (!(await requireAdmin(req))) return res.status(403).json({ error: "Admin only." });
      return res.status(400).json({ error: "Pick an outcome: meets_scope, fixable, scope_breached, or split." });
    }
    const got = await adminTarget(req, res);
    if (!got) return;
    const { admin, t } = got;
    const item = t.item;
    const row = item.row;
    const ctx = t.ctx;
    if (waitingOnConsultant(row)) return res.status(409).json({ error: WAITING_ERROR });
    const early = responsePending(row);
    if (early && req.body?.decide_early !== true) {
      return res.status(409).json({ error: `The consultant has until ${longDate(Date.parse(row.response_due_at))} to tell you their side. Confirm to decide now.`, response_window_open: true, response_due_at: row.response_due_at });
    }
    const money = paymentMoney(item);
    const nowIso = new Date().toISOString();
    const link = paymentLink(item);

    if (outcome === "split") {
      const reason = cleanText(req.body?.reason ?? note, 500);
      if (!reason) return res.status(400).json({ error: "Add a reason for the split. It's kept in the record." });
      if (money.refunded_cents > 0) return res.status(409).json({ error: "Part of this payment was already refunded. Settle the rest instead." });
      const refundCents = Math.round(Number(req.body?.refund_cents));
      const transferCents = Math.round(Number(req.body?.transfer_cents));
      const result = await splitHeldPayment(item, ctx, refundCents, transferCents, { claimEq: { support_outcome: null } });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      await writeAudit(item, "outcome_split", admin, {
        amountCents: refundCents + transferCents,
        stripeId: result.refund_id,
        details: { reason, early, refund_cents: refundCents, transfer_cents: transferCents, transfer_id: result.transfer_id, transfer_error: result.transfer_error, ...absorbedDetails(await cardFeeFor(item)) },
      });
      await notifyBoth(ctx, {
        type: "support_outcome",
        title: `Support split the payment · ${dollars(refundCents)} back to you`,
        body: `Support reviewed "${ctx.title}" and split the payment: ${dollars(refundCents)} refunded to you, ${dollars(transferCents)} to the consultant. Cards can take 5–10 business days to show the refund.`,
      }, {
        type: "support_outcome",
        title: `Support split the payment · ${dollars(transferCents)} to you`,
        body: `Support reviewed "${ctx.title}" and split the payment: ${dollars(transferCents)} to you, ${dollars(refundCents)} refunded to the business.${result.transfer_error ? " Your part is delayed. Support is on it." : ""}`,
      }, link);
      return res.json({ ok: true, outcome, refund_id: result.refund_id, transfer_id: result.transfer_id, transfer_error: result.transfer_error });
    }

    if (outcome === "fixable") {
      if (!DELIVERABLE_KINDS.has(t.kind)) return res.status(400).json({ error: "There's no delivery to redo on this payment. Pick meets scope or scope breached." });
      if (row.redo_used) return res.status(409).json({ error: "The consultant already used their one redo. Pick meets scope or scope breached." });
      if (money.refunded_cents > 0) return res.status(409).json({ error: "Part of this payment was already refunded. Settle the rest instead." });
      const deadlineMs = Date.now() + REDO_CHOICE_DAYS * DAY_MS;
      const updates = {
        support_outcome: "fixable",
        support_outcome_at: nowIso,
        redo_offered_at: nowIso,
        redo_deadline_at: new Date(deadlineMs).toISOString(),
        redo_reminded_at: null,
        consultant_choice: null,
        consultant_choice_at: null,
      };
      // Keep it locked while the consultant decides.
      if (!row.support_hold_at) Object.assign(updates, { support_hold_at: nowIso, support_hold_reason: "Support offered a redo", support_hold_by: admin.id });
      const { data: won, error } = await supabase
        .from(releaseTable(item))
        .update(updates)
        .eq("id", row.id)
        .eq(heldStatusField(item), "held")
        .is("support_outcome", null)
        .eq("redo_used", false)
        .select("id");
      if (error) return res.status(500).json({ error: error.message });
      if (!won?.length) return res.status(409).json({ error: "This payment changed. Reload and try again." });
      await writeAudit(item, "outcome_fixable", admin, { details: { note, early, redo_deadline_at: updates.redo_deadline_at } });
      await notifyBoth(ctx, {
        type: "support_outcome",
        title: "Waiting on the consultant",
        body: `Support found the work for "${ctx.title}" can be fixed. The consultant has until ${shortDate(deadlineMs)} to redo it or give the payment back.`,
      }, {
        type: "support_outcome",
        title: "Choose: redo the work or give the payment back",
        body: `Support found the work for "${ctx.title}" falls short but can be fixed. Choose by ${shortDate(deadlineMs)}. If you don't choose, the payment goes back to the business.`,
      }, link);
      return res.json({ ok: true, outcome, redo_deadline_at: updates.redo_deadline_at });
    }

    if (outcome === "meets_scope") {
      if (money.refunded_cents > 0) return res.status(409).json({ error: "Part of this payment was already refunded. Settle the rest instead." });
      const result = await releaseHeldPayment(item, { claimEq: { support_outcome: null }, source: "support_meets_scope" });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      await stampOutcome(item, { support_outcome: "meets_scope", support_outcome_at: nowIso });
      await writeAudit(item, "outcome_meets_scope", admin, { amountCents: result.payout_cents, stripeId: result.transfer_id, details: { note, early } });
      await notifyBoth(ctx, {
        type: "support_outcome",
        title: "Support released the payment",
        body: `Support found the work for "${ctx.title}" meets the agreed scope. Grassroots released ${dollars(money.gross_cents)} to the consultant.`,
      }, {
        type: "support_outcome",
        title: "Support released your payment",
        body: `Support found your work for "${ctx.title}" meets the agreed scope. ${dollars(result.payout_cents)} is on its way to your Stripe balance.`,
      }, link);
      return res.json({ ok: true, outcome, transfer_id: result.transfer_id });
    }

    // scope_breached: full refund, consultant gets nothing.
    const result = await refundHeldPayment(item, money.full_refund_cents, {
      updates: { support_outcome: "scope_breached", support_outcome_at: nowIso },
      claimEq: { support_outcome: null },
      reason: "scope_breached",
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await writeAudit(item, "outcome_scope_breached", admin, { amountCents: result.amount_cents, stripeId: result.refund_id, details: { note, early, ...absorbedDetails(await cardFeeFor(item)) } });
    await notifyBoth(ctx, {
      type: "support_outcome",
      title: `You were refunded ${dollars(result.amount_cents)} in full`,
      body: `Support found the agreed scope for "${ctx.title}" was breached. Grassroots refunded everything you paid. Cards can take 5–10 business days to show it.`,
    }, {
      type: "support_outcome",
      title: "The payment went back to the business",
      body: `Support found the agreed scope for "${ctx.title}" was breached. The business was refunded in full, so you won't be paid for this payment.`,
    }, link);
    return res.json({ ok: true, outcome, refund_id: result.refund_id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not apply the outcome." });
  }
});

// Admin: settle a partly refunded payment — release or refund the rest.
app.post("/api/admin/payments/settle-remainder", async (req, res) => {
  const action = String(req.body?.action || "");
  try {
    const got = await adminTarget(req, res);
    if (!got) return;
    if (!["release", "refund"].includes(action)) return res.status(400).json({ error: "Choose release or refund." });
    const { admin, t } = got;
    const item = t.item;
    const ctx = t.ctx;
    if (waitingOnConsultant(item.row)) return res.status(409).json({ error: WAITING_ERROR });
    const money = paymentMoney(item);
    if (money.refunded_cents <= 0) return res.status(409).json({ error: "Nothing was refunded on this payment. Pick an outcome instead." });
    if (responsePending(item.row) && req.body?.decide_early !== true) {
      return res.status(409).json({ error: `The consultant has until ${longDate(Date.parse(item.row.response_due_at))} to tell you their side. Confirm to decide now.`, response_window_open: true, response_due_at: item.row.response_due_at });
    }
    const nowIso = new Date().toISOString();
    const link = paymentLink(item);

    if (action === "release") {
      if (money.remainder_payout_cents <= 0) return res.status(409).json({ error: "Nothing is left to pay out. Refund the rest instead." });
      const result = await releaseHeldPayment(item, {
        claimEq: { refunded_cents: money.refunded_cents },
        payoutCents: money.remainder_payout_cents,
        source: "support_release_remainder",
      });
      if (!result.ok) return res.status(result.status).json({ error: result.error });
      await stampOutcome(item, { support_outcome: "release_remainder", support_outcome_at: nowIso });
      await writeAudit(item, "release_remainder", admin, { amountCents: result.payout_cents, stripeId: result.transfer_id, details: money });
      await notifyBoth(ctx, {
        type: "support_outcome",
        title: "Support released the rest of the payment",
        body: `Part of the payment for "${ctx.title}" was refunded earlier. Support released the rest to the consultant.`,
      }, {
        type: "support_outcome",
        title: "Support released your payment",
        body: `${dollars(result.payout_cents)} from "${ctx.title}" is on its way to your Stripe balance. Part of this payment was refunded to the business earlier.`,
      }, link);
      return res.json({ ok: true, action, transfer_id: result.transfer_id, payout_cents: result.payout_cents });
    }

    const result = await refundHeldPayment(item, money.remaining_cents, {
      updates: { support_outcome: "refund_remainder", support_outcome_at: nowIso },
      reason: "refund_remainder",
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    await writeAudit(item, "refund_remainder", admin, { amountCents: result.amount_cents, stripeId: result.refund_id, details: { ...money, ...absorbedDetails(await cardFeeFor(item)) } });
    await notifyBoth(ctx, {
      type: "support_outcome",
      title: `You were refunded the rest · ${dollars(result.amount_cents)}`,
      body: `Support refunded the rest of the payment for "${ctx.title}". Cards can take 5–10 business days to show it.`,
    }, {
      type: "support_outcome",
      title: "The rest went back to the business",
      body: `Support refunded the rest of the payment for "${ctx.title}" to the business. You won't be paid for this payment.`,
    }, link);
    return res.json({ ok: true, action, refund_id: result.refund_id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not settle the payment." });
  }
});

// Admin: retry the consultant's part of a split whose transfer failed
// after the refund went through. Same idempotency key, same amount.
app.post("/api/admin/payments/retry-split-transfer", async (req, res) => {
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin only." });
  if (!requireStripe(res)) return;
  const bidId = String(req.body?.bid_id || "").trim();
  const paymentId = String(req.body?.payment_id || "").trim() || null;
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  try {
    const t = await loadReleaseTarget(bidId, paymentId);
    if (t.error) return res.status(t.status).json({ error: t.error });
    const row = t.item.row;
    if (row.support_outcome !== "split" || row[heldStatusField(t.item)] !== "released" || row.transfer_id) {
      return res.status(409).json({ error: "There's no split payout to retry on this payment." });
    }
    const chargeId = await chargeIdFor(t.item);
    const dest = await consultantDestination(t.ctx.consultantId);
    if (dest.error) return res.status(400).json({ error: dest.error });
    const result = await transferSplit(t.item, chargeId, dest.destination, Number(row.consultant_payout_cents));
    if (result.error) return res.status(502).json({ error: result.error });
    await writeAudit(t.item, "split_transfer_retry", admin, { amountCents: Number(row.consultant_payout_cents), stripeId: result.transfer_id });
    await notifyUser(t.ctx.consultantId, {
      type: "support_outcome",
      title: "Your part of the split is on its way",
      body: `${dollars(row.consultant_payout_cents)} from "${t.ctx.title}" is on its way to your Stripe balance.`,
      link: paymentLink(t.item),
    });
    return res.json({ ok: true, transfer_id: result.transfer_id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not retry the payout." });
  }
});

// Released splits whose consultant transfer still needs a retry.
async function stuckSplits() {
  const [{ data: bids }, { data: rows }] = await Promise.all([
    supabase.from("bids").select(BID_RELEASE_COLS).eq("payment_status", "released").eq("support_outcome", "split").is("transfer_id", null),
    supabase.from("bid_phase_payments").select(PHASE_RELEASE_COLS).eq("status", "released").eq("support_outcome", "split").is("transfer_id", null),
  ]);
  return [
    ...(bids || []).map((b) => ({ kind: "bid", key: `bid-${b.id}`, bidId: b.id, row: b, cents: b.payment_amount_cents })),
    ...(rows || []).map((r) => ({ kind: "phase", key: `pay-${r.id}`, bidId: r.bid_id, row: r, cents: r.amount_cents })),
  ];
}

// Open or lost card dispute on a payment, or null.
async function paymentDispute(item) {
  if (!stripe) return null;
  const params = item.kind === "bid" ? { payment_intent: item.row.payment_intent_id } : { charge: item.row.charge_id };
  if (!params.payment_intent && !params.charge) return null;
  try {
    const list = await stripe.disputes.list({ ...params, limit: 10 });
    const d = (list?.data || []).find((x) => !["won", "warning_closed"].includes(x.status));
    if (!d) return null;
    return {
      id: d.id,
      status: d.status,
      reason: d.reason || null,
      amount_cents: d.amount ?? null,
      due_by: d.evidence_details?.due_by ? new Date(d.evidence_details.due_by * 1000).toISOString() : null,
    };
  } catch (err) {
    return { status: "unknown", error: err.message };
  }
}

// Admin: held payments that need a person, with what support can do.
// ?all=1 also lists held payments on their normal schedule.
app.get("/api/admin/payments/held", async (req, res) => {
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin only." });
  try {
    const nowMs = Date.now();
    const cache = new Map();
    const names = new Map();
    const nameOf = async (id) => {
      if (!id) return null;
      if (!names.has(id)) {
        const { data } = await supabase.from("profiles").select("full_name").eq("id", id).maybeSingle();
        names.set(id, data?.full_name || null);
      }
      return names.get(id);
    };
    const payments = [];
    for (const item of [...await scanHeld(nowMs), ...await stuckSplits()]) {
      const ctx = await releaseContext(item.bidId, cache);
      if (!ctx) continue;
      const row = item.row;
      const stuckSplit = row[heldStatusField(item)] === "released";
      const kind = paymentKind(item, ctx);
      const money = paymentMoney(item);
      const dispute = await paymentDispute(item);
      const waiting = waitingOnConsultant(row);
      const flags = {
        on_hold: Boolean(row.support_hold_at),
        reported: Boolean(row.problem_reported_at),
        waiting_on_consultant: waiting,
        partly_refunded: money.refunded_cents > 0,
        backstop: Boolean(row.backstop_flagged_at) || nowMs >= backstopAt(item),
        disputed: Boolean(dispute),
        stale: Boolean(row.support_hold_at) && !row.support_outcome && nowMs - Date.parse(row.support_hold_at) >= SUPPORT_HOLD_STALE_DAYS * DAY_MS,
        awaiting_response: responsePending(row, nowMs) && !row.support_outcome,
        split_transfer_failed: stuckSplit,
      };
      if (!stuckSplit && !flags.on_hold && !flags.partly_refunded && !flags.backstop && !flags.disputed && req.query.all !== "1") continue;

      // What the screen offers. The endpoints re-check all of this.
      const actions = [];
      const free = Number(item.cents) === 0;
      if (free && req.query.all !== "1") continue;
      if (!free && !waiting && !flags.disputed) {
        if (flags.partly_refunded) actions.push("release_remainder", "refund_remainder");
        else {
          actions.push("meets_scope");
          if (DELIVERABLE_KINDS.has(kind) && !row.redo_used) actions.push("fixable");
          actions.push("scope_breached", "split");
        }
      }
      if (!free && !flags.on_hold && !waiting && !stuckSplit && !businessCanReport({ item, kind, ctx }, nowMs)) actions.push("hold");
      if (stuckSplit) actions.splice(0, actions.length, "retry_split_transfer");

      // Stripe's actual card fee: what grassroots absorbs on a support
      // refund or split. Internal to the admin screen.
      if (actions.some((a) => ["fixable", "scope_breached", "refund_remainder", "split"].includes(a)) || waiting) {
        const fee = await cardFeeFor(item);
        Object.assign(money, { card_fee_absorbed_cents: fee.card_fee_cents, card_fee_source: fee.source, card_fee_note: fee.note });
      }
      const win = reviewWindow(item, kind, ctx);
      payments.push({
        key: item.key,
        table: releaseTable(item),
        bid_id: item.bidId,
        payment_id: item.kind === "phase" ? row.id : null,
        kind,
        label: paymentLabel(kind, row),
        title: ctx.title,
        engagement_link: paymentLink(item),
        owner: { id: ctx.ownerId, name: await nameOf(ctx.ownerId) },
        consultant: { id: ctx.consultantId, name: await nameOf(ctx.consultantId) },
        amount_cents: money.gross_cents,
        refunded_cents: money.refunded_cents,
        paid_at: row.paid_at,
        days_held: Math.floor((nowMs - Date.parse(row.paid_at)) / DAY_MS),
        delivered_at: row.delivered_at,
        delivery_note: row.delivery_note,
        delivery_link: row.delivery_link,
        review_ends_at: win ? new Date(win.releaseAt).toISOString() : null,
        support_hold_at: row.support_hold_at,
        support_hold_reason: row.support_hold_reason,
        decide_by: row.support_hold_at ? new Date(Date.parse(row.support_hold_at) + SUPPORT_HOLD_STALE_DAYS * DAY_MS).toISOString() : null,
        problem_reported_at: row.problem_reported_at,
        problem_report_note: row.problem_report_note,
        problem_report_link: row.problem_report_link,
        problem_report_count: Number(row.problem_report_count || 0),
        response_due_at: row.response_due_at,
        ...(await latestResponse(item).then((r) => ({ consultant_response_note: r?.note || null, consultant_response_link: r?.link || null }))),
        consultant_response_at: row.consultant_response_at,
        support_outcome: row.support_outcome,
        redo_offered_at: row.redo_offered_at,
        redo_deadline_at: row.redo_deadline_at,
        redo_used: Boolean(row.redo_used),
        consultant_choice: row.consultant_choice,
        backstop_flagged_at: row.backstop_flagged_at,
        dispute,
        flags,
        money,
        actions,
      });
    }
    payments.sort((a, b) => Number(b.flags.stale) - Number(a.flags.stale) || Date.parse(a.paid_at) - Date.parse(b.paid_at));
    return res.json({ payments });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Could not load held payments." });
  }
});

// Admin: audit trail for one payment, newest first.
app.get("/api/admin/payments/audit", async (req, res) => {
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin only." });
  const paymentId = String(req.query.payment_id || "").trim();
  if (!paymentId) return res.status(400).json({ error: "payment_id required." });
  const { data, error } = await supabase
    .from("payment_audit")
    .select("created_at, action, actor_email, amount_cents, stripe_object_id, details")
    .eq("payment_id", paymentId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return res.status(500).json({ error: error.message });
  return res.json({ entries: data || [] });
});

/* ──────────────────────────────────────────────────────────────
   HEALTH TAB — real-user perf ingest + admin read endpoints.
   The browser beacon at /perf-beacon.js POSTs one row per page
   view to /api/metrics/page-load. The admin "health" tab queries
   /api/admin/health-summary for aggregated perf + business KPIs.
   ────────────────────────────────────────────────────────────── */

// Allow-list mirrored from public/admin/admin.js. When that page
// migrates to a `profiles.is_admin` flag, swap both checks together.
const ADMIN_EMAILS = new Set([
  "moizdalal@ufl.edu",
]);

async function requireAdmin(req) {
  const token = getBearerToken(req);
  if (!token || !supabase) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user?.id) return null;
  const email = (data.user.email || "").toLowerCase();
  if (!ADMIN_EMAILS.has(email)) return null;
  return { id: data.user.id, email };
}

// Coerce a value to a bounded integer, returning null when out of range.
// Keeps the ingest endpoint resilient against malformed payloads (a bot
// posting NaN, a buggy browser reporting -1, an attacker sending
// 999999999999, etc.) without complaining loudly.
function asInt(value, max) {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0 || n > max) return null;
  return Math.round(n);
}

// Insert a perf-beacon sample. No auth: anyone hitting a page should be
// able to report timings. Service-role insert bypasses RLS.
app.post("/api/metrics/page-load", express.json({ limit: "4kb" }), async (req, res) => {
  if (!supabase) return res.status(204).end();
  const b = req.body || {};
  const pathname = typeof b.pathname === "string" ? b.pathname.slice(0, 200) : null;
  if (!pathname || !pathname.startsWith("/")) return res.status(204).end();

  const deviceClass = ["mobile", "tablet", "desktop"].includes(b.device_class)
    ? b.device_class
    : null;
  const connectionType = typeof b.connection_type === "string"
    ? b.connection_type.slice(0, 16)
    : null;

  const row = {
    pathname,
    device_class: deviceClass,
    connection_type: connectionType,
    lcp_ms: asInt(b.lcp_ms, 60000),
    inp_ms: asInt(b.inp_ms, 30000),
    cls_x1000: asInt(b.cls_x1000, 100000),
    ttfb_ms: asInt(b.ttfb_ms, 60000),
    fcp_ms: asInt(b.fcp_ms, 60000),
    load_event_ms: asInt(b.load_event_ms, 120000),
  };

  // Fire-and-forget. Don't make the browser wait for the insert and don't
  // leak DB state on failure — analytics is a soft feature.
  supabase.from("page_metrics").insert(row).then(({ error }) => {
    if (error && !/relation .* does not exist|schema cache/i.test(error.message || "")) {
      console.warn("[page_metrics] insert failed:", error.message);
    }
  });
  res.status(204).end();
});

// Combined admin read: returns perf rollups + business KPIs in one round
// trip so the health tab can render with a single fetch.
app.post("/api/admin/health-summary", express.json({ limit: "2kb" }), async (req, res) => {
  const admin = await requireAdmin(req);
  if (!admin) return res.status(403).json({ error: "Admin required." });
  if (!supabase) return res.status(503).json({ error: "DB not configured." });

  const days = Math.max(1, Math.min(90, Number(req.body?.days) || 7));

  try {
    const [overallRes, byRouteRes, trendRes, slowestRes] = await Promise.all([
      supabase.rpc("page_metrics_overall", { days_back: days }),
      supabase.rpc("page_metrics_by_route", { days_back: days, max_routes: 50 }),
      supabase.rpc("page_metrics_daily_trend", { days_back: days }),
      supabase.rpc("page_metrics_slowest", { days_back: days, max_rows: 20 }),
    ]);

    const business = await loadBusinessKpis(days);

    return res.json({
      window_days: days,
      perf: {
        overall: overallRes.data?.[0] || null,
        by_route: byRouteRes.data || [],
        daily_trend: trendRes.data || [],
        slowest: slowestRes.data || [],
      },
      business,
    });
  } catch (err) {
    console.warn("[health-summary]", err.message || err);
    return res.status(500).json({ error: "Could not load summary." });
  }
});

async function loadBusinessKpis(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();

  // Fetch in parallel — none depend on each other.
  const [
    profilesRes,
    listingsRes,
    bidsRes,
    phaseHeldRes,
    schedulesRes,
  ] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, role, created_at"),
    supabase
      .from("listings")
      .select("id, owner_id, status, created_at"),
    supabase
      .from("bids")
      .select("id, listing_id, consultant_id, status, created_at, accepted_at"),
    supabase
      .from("bid_phase_payments")
      .select("id, amount_cents, status, paid_at, released_at"),
    supabase
      .from("engagement_schedules")
      .select("bid_id, status, selected_start"),
  ]);

  const profiles = profilesRes.data || [];
  const listings = listingsRes.data || [];
  const bids = bidsRes.data || [];
  const phasePayments = phaseHeldRes.data || [];
  const schedules = schedulesRes.data || [];

  const sinceMs = Date.now() - days * 86400000;
  const inWindow = (iso) => iso && new Date(iso).getTime() >= sinceMs;

  // Funnel
  const owners = profiles.filter((p) => p.role === "business_owner");
  const consultants = profiles.filter((p) => p.role === "consultant");
  const newOwners = owners.filter((p) => inWindow(p.created_at)).length;
  const newConsultants = consultants.filter((p) => inWindow(p.created_at)).length;
  const newListings = listings.filter((l) => inWindow(l.created_at)).length;
  const newBids = bids.filter((b) => inWindow(b.created_at)).length;

  // Conversion: of owners who signed up in the window, what % posted a listing?
  const ownerIdsInWindow = new Set(
    owners.filter((p) => inWindow(p.created_at)).map((p) => p.id),
  );
  const ownersWhoListed = new Set();
  for (const l of listings) {
    if (ownerIdsInWindow.has(l.owner_id)) ownersWhoListed.add(l.owner_id);
  }

  // Conversion: of consultants who signed up in the window, what % bid?
  const consultantIdsInWindow = new Set(
    consultants.filter((p) => inWindow(p.created_at)).map((p) => p.id),
  );
  const consultantsWhoBid = new Set();
  for (const b of bids) {
    if (consultantIdsInWindow.has(b.consultant_id)) consultantsWhoBid.add(b.consultant_id);
  }

  // Conversion: of listings posted in the window, what % got a bid?
  const listingIdsInWindow = new Set(
    listings.filter((l) => inWindow(l.created_at)).map((l) => l.id),
  );
  const listingsWithBid = new Set();
  for (const b of bids) {
    if (listingIdsInWindow.has(b.listing_id)) listingsWithBid.add(b.listing_id);
  }

  // Conversion: of bids submitted in the window, what % were accepted?
  const bidsInWindow = bids.filter((b) => inWindow(b.created_at));
  const acceptedInWindow = bidsInWindow.filter((b) => b.status === "accepted").length;

  // Activity
  const activeListings = listings.filter((l) => l.status === "open").length;
  const inProgressEngagements = schedules.filter((s) => s.status === "scheduled" || s.status === "in_progress").length;
  const completedInWindow = schedules.filter((s) => s.status === "completed" && inWindow(s.selected_start)).length;

  // Money flow
  const escrowHeldCents = phasePayments
    .filter((p) => p.status === "held")
    .reduce((a, p) => a + Number(p.amount_cents || 0), 0);
  const releasedInWindowCents = phasePayments
    .filter((p) => p.status === "released" && inWindow(p.released_at))
    .reduce((a, p) => a + Number(p.amount_cents || 0), 0);

  // Time-to-first-bid: median time between listing.created_at and the
  // first bid on that listing (only counting listings posted in the window).
  const firstBidByListing = new Map();
  for (const b of bids) {
    const cur = firstBidByListing.get(b.listing_id);
    if (!cur || new Date(b.created_at) < new Date(cur)) firstBidByListing.set(b.listing_id, b.created_at);
  }
  const ttfbMs = [];
  for (const l of listings) {
    if (!inWindow(l.created_at)) continue;
    const first = firstBidByListing.get(l.id);
    if (!first) continue;
    ttfbMs.push(new Date(first).getTime() - new Date(l.created_at).getTime());
  }
  ttfbMs.sort((a, b) => a - b);
  const medianTtfbMs = ttfbMs.length ? ttfbMs[Math.floor(ttfbMs.length / 2)] : null;

  return {
    window_days: days,
    signups: {
      owners: newOwners,
      consultants: newConsultants,
      total: newOwners + newConsultants,
    },
    activity: {
      new_listings: newListings,
      new_bids: newBids,
      active_listings: activeListings,
      in_progress_engagements: inProgressEngagements,
      completed_in_window: completedInWindow,
      median_time_to_first_bid_ms: medianTtfbMs,
    },
    conversion: {
      owner_signup_to_first_listing_pct: ownerIdsInWindow.size
        ? (ownersWhoListed.size / ownerIdsInWindow.size) * 100
        : null,
      consultant_signup_to_first_bid_pct: consultantIdsInWindow.size
        ? (consultantsWhoBid.size / consultantIdsInWindow.size) * 100
        : null,
      listing_to_first_bid_pct: listingIdsInWindow.size
        ? (listingsWithBid.size / listingIdsInWindow.size) * 100
        : null,
      bid_acceptance_pct: bidsInWindow.length
        ? (acceptedInWindow / bidsInWindow.length) * 100
        : null,
    },
    money: {
      escrow_held_cents: escrowHeldCents,
      released_in_window_cents: releasedInWindowCents,
    },
  };
}

// Dynamic sitemap — replaces the static public/sitemap.xml so newly
// posted open listings show up for crawlers without a manual rebuild.
// Falls through to the static file if the admin client isn't configured.
app.get("/sitemap.xml", async (_req, res) => {
  const origin = "https://www.grassroots-marketplace.com";
  const STATIC_URLS = [
    { loc: `${origin}/`, changefreq: "weekly", priority: "1.0" },
    { loc: `${origin}/marketplace.html`, changefreq: "daily", priority: "0.9" },
    { loc: `${origin}/home/about.html`, changefreq: "monthly", priority: "0.7" },
    { loc: `${origin}/home/for-students.html`, changefreq: "monthly", priority: "0.7" },
    { loc: `${origin}/help.html`, changefreq: "monthly", priority: "0.6" },
    { loc: `${origin}/privacy`, changefreq: "yearly", priority: "0.3" },
    { loc: `${origin}/terms`, changefreq: "yearly", priority: "0.3" },
  ];
  let listingUrls = [];
  if (supabase) {
    try {
      const { data, error } = await supabase
        .from("listings")
        .select("id, created_at")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(5000);
      if (!error && Array.isArray(data)) {
        listingUrls = data.map((l) => ({
          loc: `${origin}/listing.html?id=${l.id}`,
          lastmod: l.created_at ? new Date(l.created_at).toISOString() : undefined,
          changefreq: "daily",
          priority: "0.6",
        }));
      }
    } catch (err) {
      console.warn("[sitemap] listing fetch failed", err.message || err);
    }
  }
  const all = [...STATIC_URLS, ...listingUrls];
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...all.map((u) => [
      "  <url>",
      `    <loc>${u.loc}</loc>`,
      u.lastmod ? `    <lastmod>${u.lastmod}</lastmod>` : null,
      u.changefreq ? `    <changefreq>${u.changefreq}</changefreq>` : null,
      u.priority ? `    <priority>${u.priority}</priority>` : null,
      "  </url>",
    ].filter(Boolean).join("\n")),
    "</urlset>",
  ].join("\n");
  res.set("Content-Type", "application/xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=600");
  res.send(body);
});


// "/" is the landing page (public/home/index.html). The marketplace was
// previously at "/" and now lives at "/marketplace.html" — Express's static
// middleware below serves that file directly.
app.get("/", (_req, res) => {
  res.sendFile("index.html", { root: path.join(__dirname, "public", "home") });
});

// Extension-less alias for the privacy policy so footer links to "/privacy"
// resolve. Express's static middleware below doesn't auto-resolve .html, so
// any policy/legal pages referenced without extension need an explicit route.
app.get("/privacy", (_req, res) => {
  res.sendFile("privacy.html", { root: path.join(__dirname, "public") });
});
app.get("/terms", (_req, res) => {
  res.sendFile("terms.html", { root: path.join(__dirname, "public") });
});

app.use(
  express.static(path.join(__dirname, "public"), {
    etag: true,
    lastModified: true,
    setHeaders: (res, filePath) => {
      const ext = path.extname(filePath).toLowerCase();
      // HTML: revalidate on every request so deploys are picked up immediately.
      if (ext === ".html") {
        res.setHeader("Cache-Control", "no-cache");
        return;
      }
      // CSS / JS: 1 hour cache + must-revalidate. Unhashed filenames so we
      // can't go further without risking stale assets across deploys.
      if (ext === ".css" || ext === ".js" || ext === ".mjs") {
        res.setHeader("Cache-Control", "public, max-age=3600, must-revalidate");
        return;
      }
      // Fonts / images / svgs / icons / videos — content-addressable enough
      // that a long cache is safe; if they change we'll typically rename.
      if (
        ext === ".svg" ||
        ext === ".png" ||
        ext === ".jpg" ||
        ext === ".jpeg" ||
        ext === ".gif" ||
        ext === ".webp" ||
        ext === ".avif" ||
        ext === ".ico" ||
        ext === ".woff" ||
        ext === ".woff2" ||
        ext === ".ttf" ||
        ext === ".mp4" ||
        ext === ".webm"
      ) {
        res.setHeader("Cache-Control", "public, max-age=604800, immutable");
        return;
      }
      // Anything else: brief cache + revalidate.
      res.setHeader("Cache-Control", "public, max-age=300, must-revalidate");
    },
  })
);

module.exports = app;
