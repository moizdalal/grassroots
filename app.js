const express = require("express");
const path = require("path");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const fees = require("./lib/fees");

const app = express();

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
   Public route (no auth gate) — Stripe is the caller. */
app.post(
  "/webhooks/stripe",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    if (!stripe) return res.status(503).json({ error: "stripe not configured" });
    if (!STRIPE_WEBHOOK_SECRET) {
      console.error("[stripe webhook] STRIPE_WEBHOOK_SECRET missing — refusing event.");
      return res.status(500).json({ error: "webhook secret not configured" });
    }
    const sig = req.headers["stripe-signature"];
    let event;
    try {
      event = stripe.webhooks.constructEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
    } catch (err) {
      console.warn("[stripe webhook] signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    try {
      await handleStripeEvent(event);
    } catch (err) {
      console.error("[stripe webhook] handler failed:", err);
      // Still 200 — Stripe will retry on 5xx, and we don't want to block
      // unrelated event types because one handler threw.
    }
    res.json({ received: true, type: event.type });
  }
);

async function handleStripeEvent(event) {
  switch (event.type) {
    case "account.updated":
      await onConnectAccountUpdated(event.data.object);
      break;
    case "account.application.deauthorized":
      await onConnectAccountDeauthorized(event.data.object);
      break;
    case "invoice.paid":
    case "invoice.payment_succeeded":
      await onRetainerInvoicePaid(event.data.object);
      break;
    case "invoice.payment_failed":
      await onRetainerInvoiceFailed(event.data.object);
      break;
    case "customer.subscription.deleted":
      await onSubscriptionDeleted(event.data.object);
      break;
    case "customer.subscription.updated":
      await onSubscriptionUpdated(event.data.object);
      break;
    // Future: payment_intent.succeeded, charge.refunded, transfer.created, etc.
  }
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

/* Resolve the charge id off an invoice across Stripe API generations.
   Older versions populated `invoice.charge` at the top level. Current
   API only exposes the charge through `invoice.payments[].payment` →
   PaymentIntent → `latest_charge`. Without resolving this, the held
   row gets `charge_id: null` and `release-period` can't pin the
   Transfer via `source_transaction` — funds fall back to the platform
   balance ($0 in test mode) and the transfer fails silently. */
async function resolveInvoiceCharge(invoice) {
  if (invoice?.charge) return { chargeId: invoice.charge, paymentIntentId: invoice.payment_intent || null };
  let paymentIntentId = invoice?.payment_intent || null;
  if (!paymentIntentId) {
    const payment = invoice?.payments?.data?.[0]?.payment;
    if (payment?.payment_intent) paymentIntentId = payment.payment_intent;
  }
  let chargeId = null;
  if (paymentIntentId && stripe) {
    try {
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      chargeId = pi?.latest_charge || null;
    } catch (err) {
      console.warn("[stripe webhook] charge resolution failed:", err.message);
    }
  }
  return { chargeId, paymentIntentId };
}

/* Inline transfer logic shared between the manual release-period endpoint
   and the auto-release webhook branch. Returns { ok, transfer_id, error }. */
async function transferRetainerPeriodFunds({ bidId, periodIndex }) {
  if (!stripe || !supabase) return { ok: false, error: "stripe or db not configured" };

  const { data: phase } = await supabase
    .from("bid_phase_payments")
    .select("id, bid_id, charge_id, amount_cents, status, transfer_id, consultant_payout_cents")
    .eq("bid_id", bidId)
    .eq("phase", "retainer_period")
    .eq("period_index", periodIndex)
    .maybeSingle();
  if (!phase) return { ok: false, error: "period row not found" };
  if (phase.status === "released") return { ok: true, transfer_id: phase.transfer_id, alreadyReleased: true };
  if (phase.status !== "held") return { ok: false, error: `cannot release (status=${phase.status})` };
  if (!phase.charge_id) return { ok: false, error: "missing charge_id — cannot pin transfer" };

  const { data: bid } = await supabase
    .from("bids")
    .select("consultant_id")
    .eq("id", bidId)
    .maybeSingle();
  if (!bid) return { ok: false, error: "bid not found" };

  const { data: consultant } = await supabase
    .from("profiles")
    .select("stripe_account_id")
    .eq("id", bid.consultant_id)
    .maybeSingle();
  if (!consultant?.stripe_account_id) {
    return { ok: false, error: "consultant has no stripe connect account" };
  }
  const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
  if (!account.payouts_enabled) return { ok: false, error: "consultant payouts not enabled" };

  // Prefer the stored consultant payout (offer - estimated Stripe fee);
  // legacy rows with NULL grandfather to a full-amount transfer.
  const payoutAmount = phase.consultant_payout_cents ?? phase.amount_cents;
  const transfer = await stripe.transfers.create({
    amount: payoutAmount,
    currency: "usd",
    destination: consultant.stripe_account_id,
    source_transaction: phase.charge_id,
    metadata: { bid_id: bidId, period_index: String(periodIndex), source: "retainer_auto_release" },
  });

  await supabase
    .from("bid_phase_payments")
    .update({ status: "released", transfer_id: transfer.id, released_at: new Date().toISOString() })
    .eq("id", phase.id);

  return { ok: true, transfer_id: transfer.id };
}

// Retainer subscription invoice paid (recurring period billed successfully).
// Records the period in `bid_phase_payments` with status='held' so the owner
// can release it after the consultant delivers that period's work. If
// `auto_release` is on, fire the transfer inline so the owner doesn't have to
// click each period. The `period_count` field is no longer enforced — new
// subscriptions are open-ended and end via `terminates_at` (Stripe's
// `cancel_at`) or manual cancellation by either party.
async function onRetainerInvoicePaid(invoice) {
  if (!invoice?.subscription || !supabase) return;
  const subscriptionId = invoice.subscription;

  const { data: subRow, error: subErr } = await supabase
    .from("retainer_subscriptions")
    .select("id, bid_id, periods_billed, status, auto_release, fee_cents")
    .eq("stripe_subscription_id", subscriptionId)
    .maybeSingle();

  if (subErr) {
    console.warn("[stripe webhook] invoice.paid → sub lookup failed:", subErr.message);
    return;
  }
  if (!subRow) {
    // Subscription not yet linked in our db (race between start-subscription
    // and first invoice). Stripe won't retry on 200 — log and move on. If
    // this becomes a real problem, queue retries from a cron.
    console.warn("[stripe webhook] invoice.paid for unknown subscription:", subscriptionId);
    return;
  }

  const periodIndex = subRow.periods_billed; // 0-based; first period is 0.
  const { chargeId, paymentIntentId } = await resolveInvoiceCharge(invoice);

  // Per-period fee breakdown: the offer is fee_cents (what the consultant
  // sees as "their" amount), Stripe processing comes out of their payout,
  // and the platform fee — currently waived — would otherwise be the
  // delta between invoice.amount_paid and fee_cents. We use the OFFER as
  // amount_cents to keep parity with phased rows (where amount_cents
  // stores the offer side, not the gross).
  const offerCents = Number(subRow.fee_cents) || invoice.amount_paid;
  const breakdown = fees.computeFees(offerCents);

  // Idempotency: invoice.paid can re-fire (Stripe retries on non-200). If a
  // row already exists for this (bid, phase, period) just update.
  const phaseRow = {
    bid_id: subRow.bid_id,
    phase: "retainer_period",
    period_index: periodIndex,
    amount_cents: offerCents,
    payment_intent_id: paymentIntentId,
    charge_id: chargeId,
    status: "held",
    paid_at: new Date().toISOString(),
    stripe_fee_cents: breakdown.stripeFeeCents,
    platform_fee_cents: breakdown.platformFeeCents,
    consultant_payout_cents: breakdown.consultantPayoutCents,
  };

  const { data: existing } = await supabase
    .from("bid_phase_payments")
    .select("id")
    .eq("bid_id", subRow.bid_id)
    .eq("phase", "retainer_period")
    .eq("period_index", periodIndex)
    .maybeSingle();

  if (existing?.id) {
    await supabase.from("bid_phase_payments").update(phaseRow).eq("id", existing.id);
  } else {
    await supabase.from("bid_phase_payments").insert(phaseRow);
  }

  await supabase
    .from("retainer_subscriptions")
    .update({
      periods_billed: periodIndex + 1,
      status: subRow.status === "pending" ? "active" : subRow.status,
    })
    .eq("id", subRow.id);

  // Auto-release path: owner has opted in to release each period as it
  // bills. Skip the consultant payouts-enabled gate failure by logging —
  // the row stays "held" and the owner can release manually later.
  if (subRow.auto_release && chargeId) {
    const result = await transferRetainerPeriodFunds({ bidId: subRow.bid_id, periodIndex });
    if (!result.ok) {
      console.warn("[stripe webhook] auto-release failed:", result.error);
    }
  }
}

async function onRetainerInvoiceFailed(invoice) {
  if (!invoice?.subscription || !supabase) return;
  // Don't flip status — Stripe handles its own retry schedule and will fire
  // customer.subscription.updated as the status drifts (past_due → unpaid →
  // canceled). Log so we can surface a "payment failed" notification later.
  console.warn(
    "[stripe webhook] retainer invoice failed",
    invoice.subscription,
    invoice.id,
    invoice.last_payment_error?.message || ""
  );
}

async function onSubscriptionDeleted(subscription) {
  if (!subscription?.id || !supabase) return;
  const { error } = await supabase
    .from("retainer_subscriptions")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
    })
    .eq("stripe_subscription_id", subscription.id)
    // Don't downgrade a row we already marked 'completed' via period_count.
    .neq("status", "completed");
  if (error) console.warn("[stripe webhook] subscription.deleted update failed:", error.message);
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

function canViewerAccessResume(viewer, consultantId, profile) {
  return Boolean(
    profile?.resume_path &&
    (
      viewer?.id === consultantId ||
      profile?.resume_public
    )
  );
}

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
    return res.status(401).json({ ok: false, error: "missing token" });
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ ok: false, error: "invalid session" });
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
    return res.status(403).json({ ok: false, error: "business owners only" });
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
  if (!token) return res.status(401).json({ ok: false, error: "missing token" });
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ ok: false, error: "invalid session" });
  }
  const userId = userData.user.id;
  const listingId = String(req.params.id || "");
  if (!listingId) return res.status(400).json({ ok: false, error: "missing listing id" });

  const { data: listing, error: listingErr } = await supabase
    .from("listings")
    .select("id, owner_id")
    .eq("id", listingId)
    .maybeSingle();
  if (listingErr || !listing) {
    return res.status(404).json({ ok: false, error: "listing not found" });
  }
  if (listing.owner_id !== userId) {
    return res.status(403).json({ ok: false, error: "not your listing" });
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
    return res.status(401).json({ ok: false, error: "missing token" });
  }
  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData?.user?.id) {
    return res.status(401).json({ ok: false, error: "invalid session" });
  }
  const confirm = typeof req.body?.confirm === "string" ? req.body.confirm.trim().toLowerCase() : "";
  if (confirm !== "delete my account") {
    return res.status(400).json({ ok: false, error: "missing confirmation phrase" });
  }
  console.log(
    "[account-delete-request]",
    JSON.stringify({
      userId: userData.user.id,
      email: userData.user.email,
      at: new Date().toISOString(),
    })
  );
  return res.json({ ok: true, pending: true });
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
  } = req.body;

  if (!email || !password || !role || !fullName || !String(phoneNumber || "").trim()) {
    return res.status(400).json({ error: "Email, password, role, full name, and phone number are required." });
  }

  if (!["business_owner", "consultant"].includes(role)) {
    return res.status(400).json({ error: "Invalid role selection." });
  }

  let parsedSocialLinks = null;
  if (socialLinks && socialLinks.trim()) {
    parsedSocialLinks = socialLinks
      .split(",")
      .map((link) => link.trim())
      .filter(Boolean);
  }

  try {
    const { data: userData, error: userError } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        role,
      },
    });

    if (userError || !userData?.user) {
      return res.status(400).json({ error: userError?.message || "Unable to create user." });
    }

    const userId = userData.user.id;
    let resumePath = null;

    if (req.file) {
      const safeName = sanitizeFileName(req.file.originalname);
      const lowerName = safeName.toLowerCase();
      const isPdf =
        req.file.mimetype === "application/pdf" || lowerName.endsWith(".pdf");
      if (!isPdf) {
        await supabase.auth.admin.deleteUser(userId);
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
    });

    if (profileError) {
      await supabase.auth.admin.deleteUser(userId);
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
      const { error: consultantError } = await supabase.from("consultant_profiles").insert({
        user_id: userId,
      });

      if (consultantError) {
        await supabase.from("profiles").delete().eq("id", userId);
        await supabase.auth.admin.deleteUser(userId);
        return res.status(400).json({ error: `Consultant profile failed: ${consultantError.message}` });
      }
    }

    return res.status(201).json({
      message: "Registration complete.",
      userId,
      role,
    });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected server error." });
  }
});

app.post("/api/oauth-complete", express.json(), async (req, res) => {
  const { userId, role, fullName, phoneNumber } = req.body;

  if (!userId || !role || !fullName || !String(phoneNumber || "").trim()) {
    return res.status(400).json({ error: "userId, role, fullName, and phoneNumber are required." });
  }

  if (!["business_owner", "consultant"].includes(role)) {
    return res.status(400).json({ error: "Invalid role selection." });
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

    if (role === "consultant") {
      await supabase.from("consultant_profiles").insert({ user_id: userId });
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

    const { data: bids, error: bidsError } = await supabase
      .from("bids")
      .select(
        `id, listing_id, consultant_id, amount_cents, proposal_fee_cents, service_fee_cents, move_forward_status, message, status,
         counter_offer_cents, counter_offer_message, accepted_at, proposal_due_at, proposal_path, created_at,
         profiles!bids_consultant_id_fkey ( id, full_name, linkedin_url, avatar_path )`
      )
      .eq("listing_id", listingId)
      .order("created_at", { ascending: true });

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

    return res.json({
      bids: (bids || []).map((bid) => ({
        ...bid,
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
    // Try with resume_public column first; fall back if column doesn't exist yet
    let profile = null;
    {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, linkedin_url, avatar_path, resume_path, resume_public")
        .eq("id", consultantId)
        .eq("role", "consultant")
        .maybeSingle();
      if (!error) {
        profile = data;
      } else {
        // Column likely missing — retry without resume_public
        const { data: fallback, error: fbErr } = await supabase
          .from("profiles")
          .select("id, full_name, linkedin_url, avatar_path, resume_path")
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

    const viewer = await getViewerFromRequest(req);
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
    if (!canViewerAccessResume(viewer, consultantId, profile)) {
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
const PLATFORM_URL = envTrim("PLATFORM_URL") || "https://grassroots.com";
const CONSULTANT_BUSINESS_PROFILE = {
  mcc: "7392",
  url: PLATFORM_URL,
  product_description:
    "Independent consulting services arranged through the grassroots marketplace.",
};

async function ensureConsultantStripeAccount(viewerId) {
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, role, full_name, stripe_account_id, stripe_account_status")
    .eq("id", viewerId)
    .maybeSingle();
  if (error) {
    if (/stripe_account_id|stripe_account_status|column .* does not exist/i.test(error.message || "")) {
      throw new Error("payments schema not deployed yet — run supabase/migrations/add_stripe_fields.sql.");
    }
    throw new Error(error.message);
  }
  if (!profile) throw new Error("profile not found.");
  if (profile.role !== "consultant") throw new Error("only consultants can set up payouts.");

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
  });

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
      throw new Error("payments schema not deployed yet — run supabase/migrations/add_stripe_fields.sql.");
    }
    throw new Error(error.message);
  }
  if (!profile) throw new Error("profile not found.");
  if (profile.stripe_customer_id) return profile;

  const customer = await stripe.customers.create({
    name: profile.full_name || undefined,
    metadata: { grassroots_user_id: viewerId },
  });
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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });
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
    return res.status(500).json({ error: err.message || "could not create account session." });
  }
});

// Consultant: poll onboarding status (charges_enabled / payouts_enabled).
app.get("/api/stripe/account-status", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });
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
    return res.status(500).json({ error: err.message || "could not load account status." });
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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });
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
    return res.status(500).json({ error: err.message || "could not load balance summary." });
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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });
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
        return res.status(503).json({ error: "payments schema not deployed yet — run supabase/migrations/add_stripe_fields.sql." });
      }
      return res.status(500).json({ error: msg });
    }
    if (!bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing, error: listingErr } = await supabase
      .from("listings")
      .select("id, owner_id, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listingErr || !listing) return res.status(404).json({ error: "listing not found." });
    if (listing.owner_id !== viewer.id) return res.status(403).json({ error: "only the listing owner can pay." });
    if (bid.payment_status === "held" || bid.payment_status === "released") {
      return res.status(409).json({ error: "this bid is already paid." });
    }

    const offerAmount = Number(bid.counter_offer_cents || bid.amount_cents);
    if (!Number.isFinite(offerAmount) || offerAmount < 50) {
      return res.status(400).json({ error: "bid amount is invalid for payment." });
    }

    // What the business is actually charged = offer + platform fee. The
    // platform fee is $0 while waived during launch, so today this still
    // equals the offer. When the waiver lifts the charge bumps by 10%.
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
      return res.status(409).json({ error: "this consultant hasn't set up payouts yet — they need to finish onboarding before their offer can be accepted." });
    }
    try {
      const acct = await stripe.accounts.retrieve(consultantProfile.stripe_account_id);
      if (!acct.charges_enabled || !acct.payouts_enabled || !acct.details_submitted) {
        // Backfill our DB to keep status honest with Stripe.
        await supabase
          .from("profiles")
          .update({ stripe_account_status: "pending" })
          .eq("id", bid.consultant_id);
        return res.status(409).json({ error: "this consultant's payout setup isn't fully verified yet. they'll need to finish stripe onboarding before you can accept their offer." });
      }
    } catch (err) {
      return res.status(502).json({ error: "could not verify consultant's payout account: " + (err.message || "stripe error") });
    }

    const owner = await ensureOwnerStripeCustomer(viewer.id);

    // Reuse an existing PaymentIntent if we already created one for this bid
    // (e.g., the owner closed the modal before confirming). Otherwise create.
    let intent;
    if (bid.payment_intent_id) {
      try {
        intent = await stripe.paymentIntents.retrieve(bid.payment_intent_id);
        if (["succeeded", "canceled"].includes(intent.status)) intent = null;
      } catch (_) { intent = null; }
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
      intent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        customer: owner.stripe_customer_id,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
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
      });
      await supabase
        .from("bids")
        .update({
          payment_intent_id: intent.id,
          payment_status: "authorizing",
          payment_amount_cents: amount,
          stripe_fee_cents: feeBreakdown.stripeFeeCents,
          platform_fee_cents: feeBreakdown.platformFeeCents,
          consultant_payout_cents: feeBreakdown.consultantPayoutCents,
        })
        .eq("id", bidId);
    }

    return res.json({
      client_secret: intent.client_secret,
      amount,
      currency: "usd",
      title: bid.listings?.title || "engagement",
      fee_breakdown: feeBreakdown,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not start payment." });
  }
});

// Owner: confirm the bid was paid. Server re-validates the PaymentIntent
// directly with Stripe, then flips the bid to `accepted` atomically.
app.post("/api/stripe/confirm-acceptance", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, payment_intent_id, listing_id")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "bid not found." });
    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) return res.status(403).json({ error: "only the listing owner can confirm." });
    if (!bid.payment_intent_id) return res.status(400).json({ error: "no payment intent on this bid." });

    const intent = await stripe.paymentIntents.retrieve(bid.payment_intent_id);
    if (intent.status !== "succeeded") {
      return res.status(400).json({ error: `payment not yet captured (status: ${intent.status}).` });
    }

    const { error: updErr } = await supabase
      .from("bids")
      .update({
        status: "accepted",
        accepted_at: new Date().toISOString(),
        payment_status: "held",
        paid_at: new Date().toISOString(),
      })
      .eq("id", bidId);
    if (updErr) return res.status(500).json({ error: updErr.message });

    // Promote the just-used payment method to the customer's default so any
    // future subscription (e.g., retainer continuation) can bill it without
    // re-prompting. Off the critical path — a stripe-side delay here was
    // adding ~1.5s to acceptance latency. Failure is logged, not fatal.
    if (intent.payment_method && intent.customer) {
      stripe.customers
        .update(intent.customer, {
          invoice_settings: { default_payment_method: intent.payment_method },
        })
        .catch((err) => {
          console.warn("[confirm-acceptance] could not set default pm:", err.message);
        });
    }

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not confirm payment." });
  }
});

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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, payment_amount_cents, payment_status, payment_intent_id, transfer_id, stripe_fee_cents, platform_fee_cents, consultant_payout_cents")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "bid not found." });
    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) return res.status(403).json({ error: "only the listing owner can release funds." });
    if (bid.payment_status === "released") return res.json({ ok: true, alreadyReleased: true });
    if (bid.payment_status !== "held") return res.status(400).json({ error: `cannot release: status is ${bid.payment_status}.` });

    // Require the review to be in before flipping to released.
    const { data: review } = await supabase
      .from("consultant_reviews")
      .select("id")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!review?.id) return res.status(400).json({ error: "submit your review before releasing payment." });

    let transferId = null;
    let fundsRouted = "no-payment-intent";
    let payoutAmount = bid.payment_amount_cents;

    if (bid.payment_intent_id) {
      const intent = await stripe.paymentIntents.retrieve(bid.payment_intent_id);
      const wasDestinationCharge = Boolean(intent.transfer_data?.destination);

      if (wasDestinationCharge) {
        // Pre-escrow bid: funds already routed at capture. Bookkeeping flip.
        fundsRouted = "at-capture (pre-escrow)";
      } else {
        // Escrow path. Re-verify the consultant is still payout-eligible —
        // Stripe can restrict an account between charge time and release.
        const { data: consultant } = await supabase
          .from("profiles")
          .select("stripe_account_id")
          .eq("id", bid.consultant_id)
          .maybeSingle();
        if (!consultant?.stripe_account_id) {
          return res.status(400).json({ error: "consultant hasn't set up payouts yet — they need to finish onboarding before funds can be released." });
        }
        const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
        if (!account.payouts_enabled) {
          return res.status(400).json({ error: "consultant's payout setup is incomplete — they need to finish onboarding first." });
        }

        // Grandfathering: bids paid before the fee-split rollout have
        // consultant_payout_cents NULL. Keep transferring the full
        // payment amount for those — consultants accepted under the old
        // "you get 100%" promise. New bids transfer the pre-computed
        // payout (offer - estimated Stripe fee) so the consultant takes
        // home exactly the number we showed them in the UI; the platform
        // absorbs any difference between estimated and actual Stripe fee.
        const hasFeeBreakdown = bid.consultant_payout_cents != null;
        if (hasFeeBreakdown) {
          payoutAmount = bid.consultant_payout_cents;
        }

        const transfer = await stripe.transfers.create({
          amount: payoutAmount,
          currency: "usd",
          destination: consultant.stripe_account_id,
          // `source_transaction` pins this transfer to the specific charge so
          // Stripe draws from that charge — bypasses the platform's available
          // balance, which is often $0 in test mode.
          source_transaction: intent.latest_charge,
          metadata: { bid_id: bidId },
        });
        transferId = transfer.id;
        fundsRouted = hasFeeBreakdown ? "on-release (fee-split)" : "on-release (grandfathered)";
      }
    }

    await supabase
      .from("bids")
      .update({
        payment_status: "released",
        transfer_id: transferId,
        released_at: new Date().toISOString(),
      })
      .eq("id", bidId);

    return res.json({
      ok: true,
      transfer_id: transferId,
      fundsRouted,
      payout_cents: payoutAmount,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not release funds." });
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

app.post("/api/stripe/refund-payment", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, payment_intent_id, payment_status, paid_at, payment_amount_cents")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "only the listing owner can request a refund." });
    }

    if (bid.payment_status === "refunded") {
      return res.json({ ok: true, alreadyRefunded: true });
    }
    if (bid.payment_status === "released") {
      return res.status(409).json({
        error: "funds have already been released to the consultant. once the work was marked complete and the review submitted, the engagement is final — refunds are not available.",
      });
    }
    if (bid.payment_status !== "held") {
      return res.status(409).json({ error: `cannot refund: payment status is ${bid.payment_status}.` });
    }
    if (!bid.payment_intent_id) {
      return res.status(400).json({ error: "no payment intent on this bid." });
    }
    if (!bid.paid_at) {
      return res.status(400).json({ error: "no paid_at timestamp — contact support." });
    }

    const elapsed = Date.now() - new Date(bid.paid_at).getTime();
    if (elapsed > REFUND_WINDOW_MS) {
      return res.status(403).json({
        error: "the 24-hour self-serve refund window has passed. contact support to request a refund.",
        windowExpired: true,
      });
    }

    const intent = await stripe.paymentIntents.retrieve(bid.payment_intent_id);
    const wasDestinationCharge = Boolean(intent.transfer_data?.destination);

    const refund = await stripe.refunds.create({
      payment_intent: bid.payment_intent_id,
      // Pre-escrow PIs already routed funds to the consultant. `reverse_transfer`
      // pulls that money back from the consultant's connect balance so the
      // refund nets to zero across the platform + consultant.
      ...(wasDestinationCharge ? { reverse_transfer: true } : {}),
      metadata: { bid_id: bidId, reason: "owner_self_serve_24h" },
    });

    const { error: updErr } = await supabase
      .from("bids")
      .update({
        payment_status: "refunded",
        status: "rejected",
      })
      .eq("id", bidId);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ ok: true, refund_id: refund.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not refund payment." });
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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

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
    if (!bids?.length) return res.status(404).json({ error: "bids not found." });
    if (bids.length !== bidIds.length) {
      return res.status(404).json({ error: "one or more bids not found." });
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
        return res.status(403).json({ error: "you don't own one of these listings." });
      }
      if (l.contract_type !== "phased") {
        return res.status(400).json({ error: `listing "${l.title}" is not a phased contract.` });
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
          error: `proposal fee for one of these bids has already been processed (status: ${row.status}).`,
        });
      }
    }

    // Validate fees + compute the per-bid breakdown so each row stores
    // its own (offer, stripe fee estimate, platform fee, consultant
    // payout). The batch charge is the sum of business totals (offer +
    // platform fee per bid).
    let totalCents = 0;
    const bidBreakdowns = new Map();
    for (const b of bids) {
      const fee = Number(b.proposal_fee_cents);
      if (!Number.isFinite(fee) || fee < 50) {
        return res.status(400).json({ error: "one of the bids has an invalid proposal fee." });
      }
      const breakdown = fees.computeFees(fee);
      bidBreakdowns.set(b.id, breakdown);
      totalCents += breakdown.businessTotalCents;
    }

    // Re-verify each consultant is fully onboarded — same gate as standard.
    const consultantIds = [...new Set(bids.map((b) => b.consultant_id))];
    const { data: consultantProfiles } = await supabase
      .from("profiles")
      .select("id, stripe_account_id, stripe_account_status")
      .in("id", consultantIds);
    const consultantById = new Map((consultantProfiles || []).map((p) => [p.id, p]));
    for (const b of bids) {
      const c = consultantById.get(b.consultant_id);
      if (!c?.stripe_account_id) {
        return res.status(409).json({
          error: "one of these consultants hasn't set up payouts yet — they need to finish onboarding before you can accept.",
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
            error: "one of these consultants' payout setup isn't fully verified yet.",
          });
        }
      } catch (err) {
        return res.status(502).json({
          error: "could not verify a consultant's payout account: " + (err.message || "stripe error"),
        });
      }
    }

    const owner = await ensureOwnerStripeCustomer(viewer.id);

    const intent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "usd",
      customer: owner.stripe_customer_id,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        phase: "proposal_batch",
        owner_id: viewer.id,
        bid_ids: bidIds.join(","),
      },
    });

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
        platformFeeWaived: fees.PLATFORM_FEE_WAIVED,
        consultantPayoutCents: aggPayout,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not start proposal payment." });
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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, amount_cents, payment_status")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("id, owner_id, contract_type, retainer_terms, retainer_cadence, retainer_period_count, retainer_fee_cents, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (!listing) return res.status(404).json({ error: "listing not found." });
    if (listing.owner_id !== viewer.id) {
      return res.status(403).json({ error: "only the listing owner can start a retainer." });
    }
    if (listing.contract_type !== "retainer") {
      return res.status(400).json({ error: "this isn't a retainer listing." });
    }
    if (bid.payment_status !== "released") {
      return res.status(400).json({ error: "release the first-period payment before continuing as a retainer." });
    }

    // Block if a subscription is already running for this bid.
    const { data: existing } = await supabase
      .from("retainer_subscriptions")
      .select("id, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (existing && ["pending", "active"].includes(existing.status)) {
      return res.status(409).json({ error: `retainer already ${existing.status} for this engagement.` });
    }

    // Resolve cadence + fee. 'fixed' uses listing values; 'tentative'
    // requires the owner to send them in this request.
    // period_count is preserved as a legacy soft hint (no longer enforced):
    // subscriptions run open-ended and end via `terminates_at` or manual
    // cancel from either party.
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
      return res.status(400).json({ error: "cadence must be weekly, biweekly, monthly, or quarterly." });
    }
    if (!Number.isFinite(feeCents) || feeCents < 50) {
      return res.status(400).json({ error: "fee per period must be at least $0.50." });
    }

    const { data: consultantProfile } = await supabase
      .from("profiles")
      .select("stripe_account_id, full_name")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultantProfile?.stripe_account_id) {
      return res.status(409).json({ error: "consultant hasn't set up payouts yet." });
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
    const cancelAtUnix = terminatesAtDate ? Math.floor(terminatesAtDate.getTime() / 1000) : null;

    // Create a Product + recurring Price tagged to this engagement so the
    // subscription has a clear lineage in the Stripe dashboard. Each
    // period bills the offer + platform fee (= offer today while waived).
    const perPeriodBreakdown = fees.computeFees(feeCents);
    const product = await stripe.products.create({
      name: `retainer · ${listing.title}`,
      metadata: { bid_id: bidId, listing_id: listing.id },
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: perPeriodBreakdown.businessTotalCents,
      recurring: CADENCE_INTERVAL[cadence],
      metadata: { bid_id: bidId, offer_cents: String(feeCents) },
    });

    // No `transfer_data` — invoices capture into the platform balance,
    // then each period is released via `release-period` (manual) or via
    // the webhook's auto-release branch when `auto_release` is on.
    // Subscriptions run open-ended; cancellation happens either via
    // `cancel_at` (terminates_at) or via the cancel-subscription endpoint
    // (either party). `period_count` is kept on the row as a soft hint
    // but no longer enforced as an auto-cancel point.
    const subscription = await stripe.subscriptions.create({
      customer: owner.stripe_customer_id,
      items: [{ price: price.id }],
      collection_method: "charge_automatically",
      ...(cancelAtUnix ? { cancel_at: cancelAtUnix } : {}),
      metadata: {
        bid_id: bidId,
        listing_id: listing.id,
        owner_id: viewer.id,
        consultant_id: bid.consultant_id,
      },
    });

    const phaseRow = {
      bid_id: bidId,
      stripe_subscription_id: subscription.id,
      cadence,
      period_count: periodCount || null, // legacy column; no longer enforced
      fee_cents: feeCents,
      periods_billed: 0,
      status: subscription.status === "active" || subscription.status === "trialing" ? "active" : "pending",
      started_at: new Date(subscription.start_date * 1000).toISOString(),
      auto_release: autoRelease,
      terminates_at: terminatesAtDate ? terminatesAtDate.toISOString() : null,
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
    return res.status(500).json({ error: err.message || "could not start retainer." });
  }
});

// Owner: offer a consultant an ongoing retainer at the end of any engagement
// (standard, phased post-service, or a one-off retainer first-period). Stores
// the proposed terms on `retainer_subscriptions` with status='offered' — no
// Stripe subscription is created until the consultant accepts.
app.post("/api/stripe/retainer/offer", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

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
    return res.status(400).json({ error: "cadence must be weekly, biweekly, monthly, or quarterly." });
  }
  if (!Number.isFinite(periodCount) || periodCount < 1) {
    return res.status(400).json({ error: "period_count must be at least 1." });
  }
  if (!Number.isFinite(feeCents) || feeCents < 50) {
    return res.status(400).json({ error: "fee per period must be at least $0.50." });
  }

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, payment_status")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "only the listing owner can offer a retainer." });
    }
    if (bid.payment_status !== "released") {
      return res.status(400).json({ error: "the engagement isn't released yet — retainer offers happen after first delivery." });
    }

    const { data: existing } = await supabase
      .from("retainer_subscriptions")
      .select("id, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (existing && ["offered", "pending", "active"].includes(existing.status)) {
      return res.status(409).json({ error: `a retainer is already ${existing.status} on this engagement.` });
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
    return res.status(500).json({ error: err.message || "could not create offer." });
  }
});

// Consultant: accept a pending retainer offer. Creates the Stripe Product +
// recurring Price + Subscription on the owner's customer (using the owner's
// saved default payment method) and flips the row to status='active'.
app.post("/api/stripe/retainer/accept-offer", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "bid not found." });
    if (bid.consultant_id !== viewer.id) {
      return res.status(403).json({ error: "only the consultant on this bid can accept." });
    }

    const { data: offerRow } = await supabase
      .from("retainer_subscriptions")
      .select("id, status, cadence, period_count, fee_cents, offered_by")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!offerRow) return res.status(404).json({ error: "no retainer offer on this engagement." });
    if (offerRow.status !== "offered") {
      return res.status(409).json({ error: `offer is ${offerRow.status} — can't accept.` });
    }
    if (!CADENCE_INTERVAL[offerRow.cadence]) {
      return res.status(500).json({ error: "stored cadence is invalid." });
    }
    if (!offerRow.fee_cents || offerRow.fee_cents < 50) {
      return res.status(500).json({ error: "stored fee is invalid." });
    }

    const { data: listing } = await supabase
      .from("listings")
      .select("id, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (!listing) return res.status(404).json({ error: "listing not found." });

    // Resolve the owner's customer (proposed_by) — needed to attach the
    // subscription to the right customer with the saved default PM.
    const { data: ownerProfile } = await supabase
      .from("profiles")
      .select("stripe_customer_id")
      .eq("id", offerRow.offered_by)
      .maybeSingle();
    if (!ownerProfile?.stripe_customer_id) {
      return res.status(400).json({ error: "the business doesn't have a payment method on file yet." });
    }

    // Re-verify consultant payout is still active so the eventual transfers
    // (per-period release) won't fail.
    const { data: consultantProfile } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", viewer.id)
      .maybeSingle();
    if (!consultantProfile?.stripe_account_id) {
      return res.status(409).json({ error: "finish payout setup before accepting a retainer." });
    }

    // Each invoice bills offer + platform fee (= offer today while waived).
    const perPeriodBreakdown = fees.computeFees(offerRow.fee_cents);
    const product = await stripe.products.create({
      name: `retainer · ${listing.title}`,
      metadata: { bid_id: bidId, listing_id: listing.id, source: "offer" },
    });
    const price = await stripe.prices.create({
      product: product.id,
      currency: "usd",
      unit_amount: perPeriodBreakdown.businessTotalCents,
      recurring: CADENCE_INTERVAL[offerRow.cadence],
      metadata: { bid_id: bidId, offer_cents: String(offerRow.fee_cents) },
    });

    const subscription = await stripe.subscriptions.create({
      customer: ownerProfile.stripe_customer_id,
      items: [{ price: price.id }],
      collection_method: "charge_automatically",
      metadata: {
        bid_id: bidId,
        listing_id: listing.id,
        owner_id: offerRow.offered_by,
        consultant_id: viewer.id,
        period_count: String(offerRow.period_count),
        source: "offer",
      },
    });

    const newStatus = subscription.status === "active" || subscription.status === "trialing"
      ? "active"
      : "pending";
    const acceptedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("retainer_subscriptions")
      .update({
        stripe_subscription_id: subscription.id,
        status: newStatus,
        accepted_at: acceptedAt,
        started_at: new Date(subscription.start_date * 1000).toISOString(),
      })
      .eq("id", offerRow.id);
    if (updErr) {
      try { await stripe.subscriptions.cancel(subscription.id); } catch (_) {}
      return res.status(500).json({ error: updErr.message });
    }

    return res.json({ ok: true, subscription_id: subscription.id, status: newStatus });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not accept offer." });
  }
});

// Consultant: decline a pending retainer offer.
app.post("/api/stripe/retainer/decline-offer", async (req, res) => {
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "bid not found." });
    if (bid.consultant_id !== viewer.id) {
      return res.status(403).json({ error: "only the consultant on this bid can decline." });
    }

    const { data: offerRow } = await supabase
      .from("retainer_subscriptions")
      .select("id, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!offerRow) return res.status(404).json({ error: "no retainer offer on this engagement." });
    if (offerRow.status !== "offered") {
      return res.status(409).json({ error: `offer is ${offerRow.status} — can't decline.` });
    }

    const { error: updErr } = await supabase
      .from("retainer_subscriptions")
      .update({ status: "declined", declined_at: new Date().toISOString() })
      .eq("id", offerRow.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not decline offer." });
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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  const immediate = req.body?.immediate === true || req.body?.immediate === "true";

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();

    const isOwner = listing?.owner_id === viewer.id;
    const isConsultant = bid.consultant_id === viewer.id;
    if (!isOwner && !isConsultant) {
      return res.status(403).json({ error: "only the listing owner or the consultant can end this retainer." });
    }
    if (immediate && !isOwner) {
      return res.status(403).json({ error: "only the owner can end a retainer mid-period." });
    }

    const { data: subRow } = await supabase
      .from("retainer_subscriptions")
      .select("id, stripe_subscription_id, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!subRow) return res.status(404).json({ error: "no retainer on this engagement." });
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
        console.warn("[retainer cancel]", err.message);
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
    return res.status(500).json({ error: err.message || "could not cancel retainer." });
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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid } = await supabase
      .from("bids")
      .select("id, listing_id")
      .eq("id", bidId)
      .maybeSingle();
    if (!bid) return res.status(404).json({ error: "bid not found." });
    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "only the listing owner can update retainer settings." });
    }

    const { data: subRow } = await supabase
      .from("retainer_subscriptions")
      .select("id, stripe_subscription_id, auto_release, terminates_at, status")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!subRow) return res.status(404).json({ error: "no retainer on this engagement." });
    if (["canceled", "completed"].includes(subRow.status)) {
      return res.status(400).json({ error: "retainer is no longer active." });
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
    let nextTerminatesAt = subRow.terminates_at; // unchanged
    if (req.body?.terminates_at === null) {
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
    // auto-cancels there. Passing null clears the prior cancel_at.
    if ("terminates_at" in updates && subRow.stripe_subscription_id) {
      try {
        await stripe.subscriptions.update(subRow.stripe_subscription_id, {
          cancel_at: nextTerminatesAt ? Math.floor(new Date(nextTerminatesAt).getTime() / 1000) : null,
        });
      } catch (err) {
        return res.status(502).json({ error: `stripe update failed: ${err.message}` });
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
      catch_up_released: released,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not update retainer settings." });
  }
});

// Owner: release a single retainer period's escrow to the consultant.
// Mirrors release-service: transfer from the period's charge_id, flip
// the phase row to released.
app.post("/api/stripe/retainer/release-period", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

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
    if (!bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "only the listing owner can release periods." });
    }

    const { data: phaseRow, error: phaseErr } = await supabase
      .from("bid_phase_payments")
      .select("id, status, amount_cents, charge_id, consultant_payout_cents")
      .eq("bid_id", bidId)
      .eq("phase", "retainer_period")
      .eq("period_index", periodIndex)
      .maybeSingle();
    if (phaseErr) return res.status(500).json({ error: phaseErr.message });
    if (!phaseRow) return res.status(404).json({ error: "no retainer period at that index." });
    if (phaseRow.status === "released") return res.json({ ok: true, alreadyReleased: true });
    if (phaseRow.status !== "held") {
      return res.status(400).json({ error: `cannot release: status is ${phaseRow.status}.` });
    }
    if (!phaseRow.charge_id) {
      return res.status(400).json({ error: "no charge id on period — contact support." });
    }

    const { data: consultant } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultant?.stripe_account_id) {
      return res.status(400).json({ error: "consultant hasn't set up payouts yet." });
    }
    const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
    if (!account.payouts_enabled) {
      return res.status(400).json({ error: "consultant's payout setup is incomplete." });
    }

    // Stored consultant payout (offer - estimated Stripe fee); legacy
    // rows with NULL grandfather to a full-amount transfer.
    const payoutAmount = phaseRow.consultant_payout_cents ?? phaseRow.amount_cents;
    const transfer = await stripe.transfers.create({
      amount: payoutAmount,
      currency: "usd",
      destination: consultant.stripe_account_id,
      source_transaction: phaseRow.charge_id,
      metadata: { bid_id: bidId, phase: "retainer_period", period_index: String(periodIndex) },
    });

    const { error: updErr } = await supabase
      .from("bid_phase_payments")
      .update({
        status: "released",
        released_at: new Date().toISOString(),
        transfer_id: transfer.id,
      })
      .eq("id", phaseRow.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ ok: true, transfer_id: transfer.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not release period." });
  }
});

// Owner: start the service phase for a single bid. Owner must have already
// chosen 'selected' on the proposal decision. Creates a PaymentIntent for
// the service fee (escrow into platform balance) and a `bid_phase_payments`
// row with phase='service', status='authorizing'.
app.post("/api/stripe/phased/start-service", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, service_fee_cents, move_forward_status")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("id, owner_id, contract_type, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (!listing) return res.status(404).json({ error: "listing not found." });
    if (listing.owner_id !== viewer.id) {
      return res.status(403).json({ error: "only the listing owner can start the service phase." });
    }
    if (listing.contract_type !== "phased") {
      return res.status(400).json({ error: "service phase only applies to phased contracts." });
    }
    if (bid.move_forward_status !== "selected") {
      return res.status(409).json({ error: "you haven't decided to move forward with this consultant yet." });
    }

    const fee = Number(bid.service_fee_cents);
    if (!Number.isFinite(fee) || fee < 50) {
      return res.status(400).json({ error: "service fee is missing or too small." });
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
        error: `service fee already ${existing.status === "authorizing" ? "in progress" : existing.status}.`,
      });
    }

    // Re-verify consultant is fully onboarded — same gate as standard.
    const { data: consultantProfile } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultantProfile?.stripe_account_id) {
      return res.status(409).json({ error: "consultant hasn't set up payouts yet." });
    }
    try {
      const acct = await stripe.accounts.retrieve(consultantProfile.stripe_account_id);
      if (!acct.charges_enabled || !acct.payouts_enabled || !acct.details_submitted) {
        await supabase
          .from("profiles")
          .update({ stripe_account_status: "pending" })
          .eq("id", bid.consultant_id);
        return res.status(409).json({ error: "consultant's payout setup isn't fully verified yet." });
      }
    } catch (err) {
      return res.status(502).json({ error: "could not verify consultant's payout account: " + (err.message || "stripe error") });
    }

    const owner = await ensureOwnerStripeCustomer(viewer.id);

    const intent = await stripe.paymentIntents.create({
      amount: feeBreakdown.businessTotalCents,
      currency: "usd",
      customer: owner.stripe_customer_id,
      automatic_payment_methods: { enabled: true, allow_redirects: "never" },
      metadata: {
        phase: "service",
        owner_id: viewer.id,
        bid_id: bidId,
        consultant_id: bid.consultant_id,
        listing_id: bid.listing_id,
      },
    });

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
    return res.status(500).json({ error: err.message || "could not start service payment." });
  }
});

// Owner: confirm the service-phase PaymentIntent after Stripe captures.
app.post("/api/stripe/phased/confirm-service", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const paymentIntentId = String(req.body?.payment_intent_id || "").trim();
  if (!paymentIntentId) return res.status(400).json({ error: "payment_intent_id required." });

  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded") {
      return res.status(400).json({ error: `payment not yet captured (status: ${intent.status}).` });
    }
    if (intent.metadata?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "this payment doesn't belong to you." });
    }

    const paidAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("bid_phase_payments")
      .update({
        status: "held",
        paid_at: paidAt,
        charge_id: intent.latest_charge,
      })
      .eq("payment_intent_id", paymentIntentId)
      .eq("phase", "service");
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not confirm service payment." });
  }
});

// Owner: release the service-phase escrow to the consultant after they
// submit a review (mirrors standard's /release-funds, but operates on a
// `bid_phase_payments` row instead of the bid's payment_intent_id column).
app.post("/api/stripe/phased/release-service", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("owner_id, contract_type")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (listing?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "only the listing owner can release funds." });
    }
    if (listing.contract_type !== "phased") {
      return res.status(400).json({ error: "this endpoint is for phased contracts." });
    }

    const { data: phaseRow, error: phaseErr } = await supabase
      .from("bid_phase_payments")
      .select("id, status, amount_cents, charge_id, transfer_id, consultant_payout_cents")
      .eq("bid_id", bidId)
      .eq("phase", "service")
      .maybeSingle();
    if (phaseErr) return res.status(500).json({ error: phaseErr.message });
    if (!phaseRow) return res.status(400).json({ error: "no service payment on file for this bid." });
    if (phaseRow.status === "released") return res.json({ ok: true, alreadyReleased: true });
    if (phaseRow.status !== "held") {
      return res.status(400).json({ error: `cannot release: status is ${phaseRow.status}.` });
    }
    if (!phaseRow.charge_id) {
      return res.status(400).json({ error: "no charge id on service payment — contact support." });
    }

    const { data: review } = await supabase
      .from("consultant_reviews")
      .select("id")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!review?.id) {
      return res.status(400).json({ error: "submit your review before releasing payment." });
    }

    const { data: consultant } = await supabase
      .from("profiles")
      .select("stripe_account_id")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultant?.stripe_account_id) {
      return res.status(400).json({ error: "consultant hasn't set up payouts yet." });
    }
    const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
    if (!account.payouts_enabled) {
      return res.status(400).json({ error: "consultant's payout setup is incomplete." });
    }

    // Same fee-split-or-grandfather pattern as proposal release: prefer
    // the stored consultant payout; fall back to the gross amount for
    // legacy rows where the column is NULL.
    const payoutAmount = phaseRow.consultant_payout_cents ?? phaseRow.amount_cents;
    const transfer = await stripe.transfers.create({
      amount: payoutAmount,
      currency: "usd",
      destination: consultant.stripe_account_id,
      source_transaction: phaseRow.charge_id,
      metadata: { bid_id: bidId, phase: "service" },
    });

    const releasedAt = new Date().toISOString();
    const { error: updErr } = await supabase
      .from("bid_phase_payments")
      .update({
        status: "released",
        released_at: releasedAt,
        transfer_id: transfer.id,
      })
      .eq("id", phaseRow.id);
    if (updErr) return res.status(500).json({ error: updErr.message });

    return res.json({ ok: true, transfer_id: transfer.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not release service funds." });
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
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const bidId = String(req.body?.bid_id || "").trim();
  const decision = String(req.body?.decision || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });
  if (!["selected", "declined"].includes(decision)) {
    return res.status(400).json({ error: "decision must be 'selected' or 'declined'." });
  }

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, move_forward_status, status")
      .eq("id", bidId)
      .maybeSingle();
    if (bidErr || !bid) return res.status(404).json({ error: "bid not found." });

    const { data: listing } = await supabase
      .from("listings")
      .select("id, owner_id, contract_type, title")
      .eq("id", bid.listing_id)
      .maybeSingle();
    if (!listing) return res.status(404).json({ error: "listing not found." });
    if (listing.owner_id !== viewer.id) {
      return res.status(403).json({ error: "only the listing owner can make this decision." });
    }
    if (listing.contract_type !== "phased") {
      return res.status(400).json({ error: "this decision only applies to phased contracts." });
    }
    if (bid.move_forward_status && bid.move_forward_status !== "pending") {
      return res.status(409).json({ error: `decision already recorded as '${bid.move_forward_status}'.` });
    }

    const { data: phaseRow, error: phaseErr } = await supabase
      .from("bid_phase_payments")
      .select("id, amount_cents, status, charge_id, payment_intent_id, consultant_payout_cents")
      .eq("bid_id", bidId)
      .eq("phase", "proposal")
      .maybeSingle();
    if (phaseErr) return res.status(500).json({ error: phaseErr.message });
    if (!phaseRow) return res.status(400).json({ error: "no proposal payment on file for this bid." });
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
      return res.status(400).json({ error: `cannot release: proposal payment is ${phaseRow.status}.` });
    }
    if (!phaseRow.charge_id) {
      return res.status(400).json({ error: "no charge id on proposal payment — contact support." });
    }

    const { data: consultant } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_account_status")
      .eq("id", bid.consultant_id)
      .maybeSingle();
    if (!consultant?.stripe_account_id) {
      return res.status(400).json({ error: "consultant hasn't set up payouts yet." });
    }
    try {
      const acct = await stripe.accounts.retrieve(consultant.stripe_account_id);
      if (!acct.payouts_enabled) {
        return res.status(400).json({ error: "consultant's payout setup is incomplete." });
      }
    } catch (err) {
      return res.status(502).json({ error: "could not verify consultant's payout account: " + (err.message || "stripe error") });
    }

    // Transfer the stored consultant payout (offer - estimated Stripe
    // fee) so the take-home matches what the consultant was shown. Bids
    // paid before the fee-split rollout have NULL consultant_payout_cents
    // — those grandfather to the full-amount transfer.
    const payoutAmount = phaseRow.consultant_payout_cents ?? phaseRow.amount_cents;
    const transfer = await stripe.transfers.create({
      amount: payoutAmount,
      currency: "usd",
      destination: consultant.stripe_account_id,
      source_transaction: phaseRow.charge_id,
      metadata: { bid_id: bidId, phase: "proposal", decision },
    });

    const decidedAt = new Date().toISOString();
    const { error: updPhaseErr } = await supabase
      .from("bid_phase_payments")
      .update({
        status: "released",
        released_at: decidedAt,
        transfer_id: transfer.id,
      })
      .eq("id", phaseRow.id);
    if (updPhaseErr) return res.status(500).json({ error: updPhaseErr.message });

    const { error: updBidErr } = await supabase
      .from("bids")
      .update({
        move_forward_status: decision,
        move_forward_decided_at: decidedAt,
      })
      .eq("id", bidId);
    if (updBidErr) return res.status(500).json({ error: updBidErr.message });

    return res.json({ ok: true, transfer_id: transfer.id, decision });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not record decision." });
  }
});

// Owner: confirm a proposal batch after Stripe captures. Flips each bid
// to `accepted` and each bid_phase_payments row to `held`.
app.post("/api/stripe/phased/confirm-proposals", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });

  const paymentIntentId = String(req.body?.payment_intent_id || "").trim();
  if (!paymentIntentId) return res.status(400).json({ error: "payment_intent_id required." });

  try {
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if (intent.status !== "succeeded") {
      return res.status(400).json({ error: `payment not yet captured (status: ${intent.status}).` });
    }
    if (intent.metadata?.owner_id !== viewer.id) {
      return res.status(403).json({ error: "this payment doesn't belong to you." });
    }

    const { data: phaseRows, error: rowsErr } = await supabase
      .from("bid_phase_payments")
      .select("id, bid_id")
      .eq("payment_intent_id", paymentIntentId)
      .eq("phase", "proposal");
    if (rowsErr) return res.status(500).json({ error: rowsErr.message });
    if (!phaseRows?.length) return res.status(404).json({ error: "no proposal rows tied to this payment." });

    const paidAt = new Date().toISOString();
    const { error: phaseUpdErr } = await supabase
      .from("bid_phase_payments")
      .update({
        status: "held",
        paid_at: paidAt,
        charge_id: intent.latest_charge,
      })
      .eq("payment_intent_id", paymentIntentId)
      .eq("phase", "proposal");
    if (phaseUpdErr) return res.status(500).json({ error: phaseUpdErr.message });

    const bidIds = phaseRows.map((r) => r.bid_id);
    const { error: bidUpdErr } = await supabase
      .from("bids")
      .update({
        status: "accepted",
        accepted_at: paidAt,
      })
      .in("id", bidIds);
    if (bidUpdErr) return res.status(500).json({ error: bidUpdErr.message });

    return res.json({ ok: true, bid_ids: bidIds });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not confirm proposal payment." });
  }
});

// "/" is the landing page (public/home/index.html). The marketplace was
// previously at "/" and now lives at "/marketplace.html" — Express's static
// middleware below serves that file directly.
app.get("/", (_req, res) => {
  res.sendFile("index.html", { root: path.join(__dirname, "public", "home") });
});

app.use(express.static(path.join(__dirname, "public")));

module.exports = app;
