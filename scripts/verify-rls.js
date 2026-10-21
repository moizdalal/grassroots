#!/usr/bin/env node
//
// RLS smoke test against a real Supabase project, run AFTER
// supabase/migrations/rls_lockdown.sql is applied. Signs in as the test
// business owner and test consultant and replays the 2026-10-20 audit
// attacks (S1–S4, S13). Every attack should come back as a permission
// error or zero rows.
//
// Safe to run against production: write probes target a nonexistent row
// and only check that postgres refuses the column. Negotiation rules that
// live in the bids trigger are covered by scripts/test-rls-lockdown.mjs.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_ANON_KEY=... \
//   RLS_OWNER_EMAIL=... RLS_OWNER_PASSWORD=... \
//   RLS_CONSULTANT_EMAIL=... RLS_CONSULTANT_PASSWORD=... \
//   node scripts/verify-rls.js
//
// Exit codes: 0 all pass · 1 at least one leak · 2 config error

const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const { createClient } = require("@supabase/supabase-js");

const env = (k) => (process.env[k] || "").trim();
const SUPABASE_URL = env("SUPABASE_URL");
const ANON_KEY = env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
const OWNER = { email: env("RLS_OWNER_EMAIL"), password: env("RLS_OWNER_PASSWORD") };
const CONSULTANT = { email: env("RLS_CONSULTANT_EMAIL"), password: env("RLS_CONSULTANT_PASSWORD") };

if (!SUPABASE_URL || !ANON_KEY || !OWNER.email || !OWNER.password || !CONSULTANT.email || !CONSULTANT.password) {
  console.error("Need SUPABASE_URL, SUPABASE_ANON_KEY, RLS_OWNER_EMAIL/PASSWORD, RLS_CONSULTANT_EMAIL/PASSWORD.");
  process.exit(2);
}

const newClient = () =>
  createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

async function signIn({ email, password }) {
  const client = newClient();
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    console.error(`sign-in failed for ${email}: ${error.message}`);
    process.exit(2);
  }
  return { client, id: data.user.id };
}

let failures = 0;
function report(name, blocked, detail) {
  if (!blocked) failures += 1;
  console.log(`${blocked ? "PASS" : "LEAK"}  ${name}${detail ? `  (${detail})` : ""}`);
}

// Writes target a row that doesn't exist (NIL), so nothing can change even
// if a check fails open. Column/table privileges are checked before any
// row is matched, so a locked column still raises "permission denied" —
// and a missing error means the grant is open.
const NIL = "00000000-0000-0000-0000-000000000000";
async function expectDenied(name, query) {
  const { error } = await query;
  report(name, /permission denied/i.test(error?.message || ""), error ? error.message : "no error — grant is open");
}

// A read is blocked when it errors or returns zero rows.
async function expectBlocked(name, query) {
  const { data, error } = await query;
  const rows = Array.isArray(data) ? data.length : data ? 1 : 0;
  report(name, Boolean(error) || rows === 0, error ? error.message : `${rows} rows`);
}

(async () => {
  const anon = newClient();
  const owner = await signIn(OWNER);
  const consultant = await signIn(CONSULTANT);

  // ── S3: private profile columns ──────────────────────────────
  for (const col of ["phone_number", "stripe_customer_id", "stripe_account_id", "resume_path"]) {
    await expectBlocked(`anon reads profiles.${col}`, anon.from("profiles").select(col).limit(5));
    await expectBlocked(`owner reads others' profiles.${col}`,
      owner.client.from("profiles").select(col).neq("id", owner.id).limit(5));
    await expectBlocked(`consultant reads others' profiles.${col}`,
      consultant.client.from("profiles").select(col).neq("id", consultant.id).limit(5));
  }
  await expectBlocked("consultant reads other consultants' profiles",
    consultant.client.from("profiles").select("id").eq("role", "consultant").neq("id", consultant.id));
  await expectBlocked("consultant reads other consultant_profiles rows",
    consultant.client.from("consultant_profiles").select("user_id").neq("user_id", consultant.id));
  await expectBlocked("anon reads consultant_profiles", anon.from("consultant_profiles").select("user_id").limit(5));

  // Display reads must still work.
  const { error: displayErr } = await anon.from("profiles").select("id, full_name, avatar_path").limit(1);
  report("anon can still read display columns", !displayErr, displayErr?.message);
  const { data: priv, error: privErr } = await owner.client.rpc("get_my_private_profile").maybeSingle();
  report("owner can read own private profile via rpc", !privErr && priv, privErr?.message);

  // ── S2: privileged profile columns ───────────────────────────
  for (const col of ["role", "stripe_customer_id", "stripe_account_id", "terms_accepted_at", "deletion_requested_at"]) {
    await expectDenied(`user writes own profiles.${col}`,
      owner.client.from("profiles").update({ [col]: null }).eq("id", NIL));
  }

  // ── S1: bid payment / lifecycle columns ──────────────────────
  for (const col of ["payment_status", "payment_intent_id", "paid_at", "released_at", "transfer_id",
    "payment_amount_cents", "consultant_payout_cents", "platform_fee_cents", "accepted_at"]) {
    await expectDenied(`owner writes bids.${col}`, owner.client.from("bids").update({ [col]: null }).eq("id", NIL));
    await expectDenied(`consultant writes bids.${col}`, consultant.client.from("bids").update({ [col]: null }).eq("id", NIL));
  }
  await expectDenied("consultant deletes a bid", consultant.client.from("bids").delete().eq("id", NIL));
  await expectDenied("consultant inserts a pre-paid bid",
    consultant.client.from("bids").insert({ listing_id: NIL, consultant_id: consultant.id, amount_cents: 1, payment_status: "held" }));

  // ── S4: reviews ──────────────────────────────────────────────
  // UPDATE has no grant, so this errors before matching any row.
  await expectDenied("owner edits a review", owner.client.from("consultant_reviews").update({ endorsement: null }).eq("id", NIL));
  await expectDenied("recipient rewrites a message body", owner.client.from("messages").update({ body: "x" }).eq("id", NIL));
  // The "review needs a matching bid" policy is covered by
  // scripts/test-rls-lockdown.mjs — probing it here would insert a fake
  // review if the policy ever failed open.

  // ── S13: anon writes ─────────────────────────────────────────
  await expectDenied("anon inserts a listing", anon.from("listings").insert({ title: "rls probe" }));
  await expectDenied("anon updates profiles", anon.from("profiles").update({ full_name: "x" }).eq("id", NIL));

  console.log(failures ? `\n${failures} leak(s)` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
