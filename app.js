const express = require("express");
const path = require("path");
const multer = require("multer");
const { createClient } = require("@supabase/supabase-js");
require("dotenv").config({ path: path.join(__dirname, ".env") });

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
const stripe = STRIPE_SECRET_KEY ? require("stripe")(STRIPE_SECRET_KEY) : null;
if (!stripe) console.warn("[stripe] STRIPE_SECRET_KEY missing — payment endpoints will 503.");

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
        `id, listing_id, consultant_id, amount_cents, message, status,
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
        .select("user_id, major, minor, school")
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
        .select("major, minor, school")
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

  if (profile.stripe_account_id) return profile;

  const account = await stripe.accounts.create({
    type: "custom",
    capabilities: {
      transfers: { requested: true },
      card_payments: { requested: true },
    },
    business_type: "individual",
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

// Owner: create a PaymentIntent for accepting a bid. Funds are captured
// into the platform balance (escrow) — no destination charge here, so the
// consultant doesn't receive money until release-funds runs after the
// owner submits their post-engagement review.
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

    const amount = Number(bid.counter_offer_cents || bid.amount_cents);
    if (!Number.isFinite(amount) || amount < 50) {
      return res.status(400).json({ error: "bid amount is invalid for payment." });
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
    if (!intent) {
      intent = await stripe.paymentIntents.create({
        amount,
        currency: "usd",
        customer: owner.stripe_customer_id,
        automatic_payment_methods: { enabled: true, allow_redirects: "never" },
        transfer_group: `bid_${bidId}`,
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
        })
        .eq("id", bidId);
    }

    return res.json({
      client_secret: intent.client_secret,
      amount,
      currency: "usd",
      title: bid.listings?.title || "engagement",
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

    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not confirm payment." });
  }
});

// Owner: release escrow to consultant after marking work complete + reviewing.
app.post("/api/stripe/release-funds", async (req, res) => {
  if (!requireStripe(res)) return;
  const viewer = await getViewerFromRequest(req);
  if (!viewer?.id) return res.status(401).json({ error: "sign in required." });
  const bidId = String(req.body?.bid_id || "").trim();
  if (!bidId) return res.status(400).json({ error: "bid_id required." });

  try {
    const { data: bid, error: bidErr } = await supabase
      .from("bids")
      .select("id, listing_id, consultant_id, payment_amount_cents, payment_status, transfer_id")
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

    // Verify a review has been submitted for this bid before releasing.
    const { data: review } = await supabase
      .from("consultant_reviews")
      .select("id")
      .eq("bid_id", bidId)
      .maybeSingle();
    if (!review?.id) return res.status(400).json({ error: "submit your review before releasing payment." });

    const { data: consultant } = await supabase
      .from("profiles")
      .select("stripe_account_id, stripe_account_status")
      .eq("id", bid.consultant_id)
      .maybeSingle();

    if (!consultant?.stripe_account_id) {
      return res.status(400).json({ error: "consultant hasn't set up payouts yet — they need to finish onboarding before funds can be released." });
    }

    const account = await stripe.accounts.retrieve(consultant.stripe_account_id);
    if (!account.payouts_enabled) {
      return res.status(400).json({ error: "consultant's payout setup is incomplete — they need to finish onboarding first." });
    }

    const transfer = await stripe.transfers.create({
      amount: bid.payment_amount_cents,
      currency: "usd",
      destination: consultant.stripe_account_id,
      transfer_group: `bid_${bidId}`,
      metadata: { bid_id: bidId },
    });

    await supabase
      .from("bids")
      .update({
        payment_status: "released",
        transfer_id: transfer.id,
        released_at: new Date().toISOString(),
      })
      .eq("id", bidId);

    return res.json({ ok: true, transfer_id: transfer.id });
  } catch (err) {
    return res.status(500).json({ error: err.message || "could not release funds." });
  }
});

app.get("/", (_req, res) => {
  res.sendFile("index.html", { root: path.join(__dirname, "public") });
});

app.use(express.static(path.join(__dirname, "public")));

module.exports = app;
