// Payment-flow harness: loads app.js with an in-memory Supabase and a fake
// Stripe (real webhook signing), then drives it over HTTP.
//   node scripts/test-payment-release.js
// No network, no real keys. Covers idempotency, compare-and-set releases,
// disputes, retainer terms, and the delivery-anchored release job.
const WT = require("path").resolve(__dirname, "..");
const Module = require("module");
const assert = require("assert");

// ---------- fake supabase ----------
const db = { profiles: [], listings: [], bids: [], bid_phase_payments: [], retainer_subscriptions: [], consultant_reviews: [], notifications: [] };
// Columns the add_delivery_release migration defaults.
const DEFAULTS = { bids: { refunded_cents: 0 }, bid_phase_payments: { refunded_cents: 0 } };
let nextId = 1;
const uniqueIdx = { bid_phase_payments: (r) => `${r.bid_id}|${r.phase}|${r.period_index ?? -1}` };

function builder(table) {
  const st = { op: "select", filters: [], patch: null, rows: null, wantRows: false };
  const match = (r) => st.filters.every((f) => f({ ...(DEFAULTS[table] || {}), ...r }));
  const exec = () => {
    const t = db[table];
    if (st.op === "insert") {
      for (const row of st.rows) {
        if (uniqueIdx[table] && t.some((x) => uniqueIdx[table](x) === uniqueIdx[table](row))) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
      }
      const inserted = st.rows.map((r) => ({ id: `id${nextId++}`, ...(DEFAULTS[table] || {}), ...r }));
      t.push(...inserted);
      return { data: inserted, error: null };
    }
    if (st.op === "update") {
      const hit = t.filter(match);
      hit.forEach((r) => Object.assign(r, st.patch));
      return { data: st.wantRows ? hit.map((r) => ({ ...r })) : null, error: null };
    }
    return { data: t.filter(match).map((r) => ({ ...r })), error: null };
  };
  const b = {
    select() { if (st.op !== "select") st.wantRows = true; return b; },
    insert(rows) { st.op = "insert"; st.rows = Array.isArray(rows) ? rows : [rows]; return b; },
    update(p) { st.op = "update"; st.patch = p; return b; },
    eq(c, v) { st.filters.push((r) => r[c] === v); return b; },
    neq(c, v) { st.filters.push((r) => r[c] !== v); return b; },
    in(c, vs) { st.filters.push((r) => vs.includes(r[c])); return b; },
    is(c, v) { st.filters.push((r) => (r[c] ?? null) === v); return b; },
    not(c, op, v) {
      if (op === "is") { st.filters.push((r) => (r[c] ?? null) !== v); return b; }
      const vs = v.replace(/[()]/g, "").split(","); st.filters.push((r) => !vs.includes(r[c])); return b;
    },
    order() { return b; },
    lte(c, v) { st.filters.push((r) => r[c] != null && Date.parse(r[c]) <= Date.parse(v)); return b; },
    limit() { return b; },
    match(o) { for (const k in o) b.eq(k, o[k]); return b; },
    async maybeSingle() { const r = exec(); return { data: r.data?.[0] ?? null, error: r.error }; },
    then(res, rej) { return Promise.resolve(exec()).then(res, rej); },
  };
  return b;
}
const fakeSupabase = {
  from: (t) => builder(t),
  auth: {
    admin: { listUsers: async () => ({ data: { users: [{ id: "admin1", email: "moizdalal@ufl.edu" }] } }) },
    getUser: async (tok) => ({ data: { user: tok ? { id: tok, email: tok === "admin1" ? "moizdalal@ufl.edu" : `${tok}@x.test` } : null }, error: tok ? null : { message: "no" } }),
  },
  rpc: async (fn, args) => {
    if (fn !== "stranded_funds_report") return { data: null, error: { message: `no rpc ${fn}` } };
    const minMs = (args?.min_days || 0) * 86400000;
    const old = (r) => r.paid_at && Date.now() - Date.parse(r.paid_at) >= minMs;
    return { data: [
      ...db.bids.filter((b) => b.payment_status === "held" && old(b)).map((b) => ({ kind: "bid", payment_id: b.id, bid_id: b.id, backstop_flagged_at: b.backstop_flagged_at ?? null, support_hold_at: b.support_hold_at ?? null })),
      ...db.bid_phase_payments.filter((r) => r.status === "held" && old(r)).map((r) => ({ kind: "period", payment_id: r.id, bid_id: r.bid_id, backstop_flagged_at: r.backstop_flagged_at ?? null, support_hold_at: r.support_hold_at ?? null })),
    ], error: null };
  },
};

// ---------- fake stripe ----------
const realStripe = require(WT + "/node_modules/stripe")("sk_test_dummy");
const calls = [];
const idem = new Map();
const pis = new Map();
let failTransfers = false;
const disputes = [];
const subs = new Map();
function keyed(kind, opts, make) {
  calls.push({ kind, key: opts?.idempotencyKey });
  if (opts?.idempotencyKey && idem.has(opts.idempotencyKey)) {
    return { ...idem.get(opts.idempotencyKey), lastResponse: { headers: { "idempotent-replayed": "true" } } };
  }
  const obj = make();
  if (opts?.idempotencyKey) idem.set(opts.idempotencyKey, obj);
  return obj;
}
const fakeStripe = {
  webhooks: realStripe.webhooks,
  accounts: { retrieve: async () => ({ payouts_enabled: true, charges_enabled: true, details_submitted: true, business_profile: { mcc: "1", url: "x" } }) },
  customers: { update: async () => ({}) },
  paymentIntents: {
    retrieve: async (id) => ({ ...pis.get(id) }),
    create: async (p, o) => keyed("pi", o, () => { const pi = { id: `pi_${nextId++}`, status: "requires_payment_method", client_secret: "cs", ...p }; pis.set(pi.id, pi); return pi; }),
    cancel: async (id) => { pis.get(id).status = "canceled"; },
  },
  transfers: { create: async (p, o) => { await new Promise((r) => setTimeout(r, 30)); if (failTransfers) throw new Error("stripe down"); return keyed("transfer", o, () => ({ id: `tr_${nextId++}`, ...p })); } },
  refunds: { create: async (p, o) => keyed("refund", o, () => ({ id: `re_${nextId++}`, ...p })) },
  products: { create: async (p, o) => keyed("product", o, () => ({ id: `prod_${nextId++}` })) },
  prices: { create: async (p, o) => keyed("price", o, () => ({ id: `price_${nextId++}` })) },
  subscriptions: {
    create: async (p, o) => keyed("sub", o, () => { const sub = { id: `sub_${nextId++}`, status: "active", start_date: Math.floor(Date.now() / 1000), billing_cycle_anchor: Math.floor(Date.now() / 1000), ...p }; subs.set(sub.id, sub); return sub; }),
    retrieve: async (id) => ({ ...subs.get(id) }),
    update: async (id, p) => { calls.push({ kind: "sub.update", p }); Object.assign(subs.get(id), p); return subs.get(id); },
  },
  disputes: { list: async ({ charge }) => ({ data: disputes.filter((d) => d.charge === charge) }) },
  invoicePayments: { list: async ({ invoice }) => ({ data: [{ status: "paid", payment: { type: "payment_intent", payment_intent: `pi_inv_${invoice}` } }] }) },
};
pis.set = pis.set.bind(pis);

// ---------- module injection ----------
const origLoad = Module._load;
Module._load = function (req, parent, isMain) {
  if (req === "@supabase/supabase-js") return { createClient: () => fakeSupabase };
  if (req === "stripe") return () => fakeStripe;
  if (req === "dotenv") return { config: () => ({}) };
  return origLoad.apply(this, arguments);
};
process.env.SUPABASE_URL = "http://fake"; process.env.SUPABASE_SERVICE_ROLE_KEY = "x"; process.env.SUPABASE_ANON_KEY = "x";
process.env.CRON_SECRET = "cronsecret"; process.env.STRIPE_SECRET_KEY = "sk_test_x"; process.env.STRIPE_WEBHOOK_SECRET = "whsec_harness";
const logs = [];
const origErr = console.error, origWarn = console.warn;
console.error = (...a) => logs.push(a.join(" "));
console.warn = (...a) => logs.push(a.join(" "));
const app = require(WT + "/app.js");

// ---------- helpers ----------
let base;
async function api(path, body, token) {
  const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function apiGet(path, token) {
  const r = await fetch(base + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: r.status, body: await r.json().catch(() => null) };
}
async function hook(type, object, extra = {}) {
  const payload = JSON.stringify({ id: `evt_${nextId++}`, object: "event", type, data: { object }, ...extra });
  const header = realStripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_harness" });
  const r = await fetch(base + "/api/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": header }, body: payload });
  return r.status;
}
const OWNER = "owner1", CONS = "cons1";
function seed() {
  for (const k in db) db[k].length = 0;
  db.profiles.push({ id: OWNER, role: "business", stripe_customer_id: "cus_1", full_name: "o" }, { id: CONS, role: "consultant", stripe_account_id: "acct_1" });
  db.listings.push({ id: "L1", owner_id: OWNER, title: "t", contract_type: "standard" }, { id: "L2", owner_id: OWNER, title: "p", contract_type: "phased" });
  db.bids.push({ id: "B1", listing_id: "L1", consultant_id: CONS, amount_cents: 10000, status: "pending", payment_status: "unpaid", refunded_cents: 0 });
  db.consultant_reviews.push({ id: "R1", bid_id: "B1" });
}
const bid = (id) => db.bids.find((b) => b.id === id);
let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); pass++; origErr("  ✓", msg); };

(async () => {
  const srv = app.listen(0); base = `http://127.0.0.1:${srv.address().port}`;
  try {
    // --- standard: create PI, double-click returns same PI ---
    seed();
    let r1 = await api("/api/stripe/payment-intent", { bid_id: "B1" }, OWNER);
    ok(r1.status === 200, "payment-intent created");
    const piId = bid("B1").payment_intent_id;
    ok(calls.filter((c) => c.kind === "pi")[0].key.startsWith("pi:bid:B1:none:10000"), "PI create carries idempotency key");

    // --- webhook accepts the bid before the browser confirms ---
    pis.get(piId).status = "succeeded"; pis.get(piId).latest_charge = "ch_1"; pis.get(piId).payment_method = "pm_1"; pis.get(piId).customer = "cus_1";
    ok(await hook("payment_intent.succeeded", pis.get(piId)) === 200, "payment_intent.succeeded → 200");
    ok(bid("B1").status === "accepted" && bid("B1").payment_status === "held", "webhook flipped bid to accepted/held");
    const paidAt = bid("B1").paid_at;
    let c = await api("/api/stripe/confirm-acceptance", { bid_id: "B1" }, OWNER);
    ok(c.status === 200 && bid("B1").paid_at === paidAt, "browser confirm after webhook is a no-op (paid_at unchanged)");
    ok(await hook("payment_intent.succeeded", pis.get(piId)) === 200 && bid("B1").paid_at === paidAt, "webhook redelivery is a no-op");

    // --- confirm verifies amount ---
    seed();
    await api("/api/stripe/payment-intent", { bid_id: "B1" }, OWNER);
    const pi2 = bid("B1").payment_intent_id;
    Object.assign(pis.get(pi2), { status: "succeeded", amount: 1 });
    c = await api("/api/stripe/confirm-acceptance", { bid_id: "B1" }, OWNER);
    ok(c.status === 409 && bid("B1").payment_status === "authorizing", "amount mismatch rejected, bid untouched");
    ok(logs.some((l) => l.includes("payment_intent_mismatch")), "mismatch alerted");
    c = await api("/api/stripe/confirm-acceptance", { bid_id: "B1" }, "intruder");
    ok(c.status === 403, "non-owner can't confirm");

    // --- release: two concurrent clicks → one transfer ---
    seed();
    Object.assign(bid("B1"), { payment_status: "held", payment_intent_id: "pi_rel", consultant_payout_cents: 9680, payment_amount_cents: 10000, paid_at: new Date().toISOString() });
    pis.set("pi_rel", { id: "pi_rel", latest_charge: "ch_rel", status: "succeeded" });
    calls.length = 0;
    const [a, b] = await Promise.all([api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER), api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER)]);
    ok([a, b].every((x) => x.status === 200 || x.status === 409) && [a, b].filter((x) => x.body?.transfer_id).length === 1, `concurrent releases: one transfers, other is a no-op (${a.status},${b.status})`);
    ok(calls.filter((x) => x.kind === "transfer").length === 1, "exactly one transfer created");
    ok(bid("B1").payment_status === "released" && bid("B1").transfer_id, "bid released with transfer_id stamped");

    // --- release racing refund: only one succeeds ---
    seed();
    Object.assign(bid("B1"), { payment_status: "held", payment_intent_id: "pi_rel", consultant_payout_cents: 9680, payment_amount_cents: 10000, paid_at: new Date().toISOString() });
    calls.length = 0;
    const [rr, rf] = await Promise.all([api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER), api("/api/stripe/refund-payment", { bid_id: "B1" }, OWNER)]);
    const moved = calls.filter((x) => x.kind === "transfer" || x.kind === "refund").length;
    ok(moved === 1, `release vs refund: exactly one money movement (release ${rr.status}, refund ${rf.status})`);

    // --- transfer failure rolls the claim back ---
    seed();
    Object.assign(bid("B1"), { payment_status: "held", payment_intent_id: "pi_rel", consultant_payout_cents: 9680, payment_amount_cents: 10000 });
    failTransfers = true;
    const f = await api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER);
    failTransfers = false;
    ok(f.status === 500 && bid("B1").payment_status === "held" && !bid("B1").released_at, "failed transfer → bid back to held");

    // --- charge.refunded from dashboard mirrors onto held bid ---
    seed();
    Object.assign(bid("B1"), { payment_status: "held", payment_intent_id: "pi_dash" });
    await hook("charge.refunded", { id: "ch_d", payment_intent: "pi_dash", refunded: true, amount: 10000, amount_refunded: 10000 });
    ok(bid("B1").payment_status === "refunded" && bid("B1").status === "rejected", "dashboard refund mirrored (held → refunded)");
    const rel = await api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER);
    ok(rel.status === 400, "refunded bid can no longer be released");

    // --- retainer invoice.paid: dahlia shape, dedupe, race fallback ---
    seed();
    db.retainer_subscriptions.push({ id: "S1", bid_id: "B1", stripe_subscription_id: null, status: "offered", periods_billed: 0, fee_cents: 50000, auto_release: false });
    const inv = { id: "in_1", object: "invoice", amount_paid: 50000, parent: { type: "subscription_details", subscription_details: { subscription: "sub_1", metadata: { bid_id: "B1" } } } };
    ok(await hook("invoice.paid", inv) === 200, "invoice.paid (dahlia shape, row not yet linked) → 200 via bid_id fallback");
    ok(db.bid_phase_payments.length === 1 && db.bid_phase_payments[0].payment_intent_id === "pi_inv_in_1", "period row recorded with PI from invoicePayments");
    await hook("invoice.payment_succeeded", inv);
    await hook("invoice.paid", inv);
    ok(db.bid_phase_payments.length === 1 && db.retainer_subscriptions[0].periods_billed === 1, "sibling event + redelivery don't create extra periods");
    const inv2 = { ...inv, id: "in_2" };
    db.retainer_subscriptions[0].stripe_subscription_id = "sub_1";
    await hook("invoice.paid", inv2);
    ok(db.bid_phase_payments.length === 2 && db.bid_phase_payments[1].period_index === 1, "next invoice → period 1");
    db.retainer_subscriptions[0].stripe_subscription_id = "sub_other";
    ok(await hook("invoice.paid", { ...inv, id: "in_3", parent: { subscription_details: { subscription: "sub_9", metadata: { bid_id: "B1" } } } }) === 500, "unknown linked sub → 500 so Stripe retries");

    // --- payout.failed notifies consultant ---
    await hook("payout.failed", { id: "po_1", failure_code: "account_closed" }, { account: "acct_1" });
    ok(db.notifications.some((n) => n.user_id === CONS && n.type === "payout_failed"), "payout.failed → consultant notified");

    // --- deauthorized uses event.account ---
    await hook("account.application.deauthorized", { id: "ca_app", object: "application" }, { account: "acct_1" });
    ok(db.profiles.find((p) => p.id === CONS).stripe_account_id === null, "deauthorized clears the connected account");

    // --- disputes: admin notified, release frozen until won ---
    seed();
    Object.assign(bid("B1"), { payment_status: "held", payment_intent_id: "pi_rel", consultant_payout_cents: 9680, payment_amount_cents: 10000 });
    const dsp = { id: "dp_1", object: "dispute", charge: "ch_rel", payment_intent: "pi_rel", amount: 10000, reason: "fraudulent", status: "needs_response", evidence_details: { due_by: 1893456000 } };
    disputes.push(dsp);
    await hook("charge.dispute.created", dsp);
    ok(db.notifications.some((n) => n.user_id === "admin1" && n.type === "dispute_opened" && n.link === "/engagement.html?bid=B1"), "dispute opened → admin notified with engagement link");
    calls.length = 0;
    const fr = await api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER);
    ok(fr.status === 409 && bid("B1").payment_status === "held" && !calls.some((x) => x.kind === "transfer"), "release blocked while disputed, nothing moved");
    dsp.status = "won";
    await hook("charge.dispute.closed", dsp);
    ok(db.notifications.some((n) => n.type === "dispute_closed" && n.title.includes("won")), "dispute won → admin notified");
    ok((await api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER)).status === 200, "release works again after dispute won");
    disputes.length = 0;

    // --- retainer offer: term enforced, owner adjusts length, consultant notified ---
    seed();
    Object.assign(bid("B1"), { payment_status: "released" });
    db.retainer_subscriptions.push({ id: "S2", bid_id: "B1", status: "offered", cadence: "monthly", period_count: 6, fee_cents: 50000, periods_billed: 0, offered_by: OWNER, offered_at: "2026-10-01T00:00:00Z" });
    calls.length = 0;
    const [ac1, ac2] = await Promise.all([api("/api/stripe/retainer/accept-offer", { bid_id: "B1" }, CONS), api("/api/stripe/retainer/accept-offer", { bid_id: "B1" }, CONS)]);
    ok(calls.filter((x) => x.kind === "sub").length === 1, `double-click accept → one subscription (${ac1.status},${ac2.status})`);
    const rs = db.retainer_subscriptions[0];
    const sub6 = subs.get(rs.stripe_subscription_id);
    const days = (sub6.cancel_at - sub6.billing_cycle_anchor) / 86400;
    ok(sub6.proration_behavior === "none" && days > 180 && days < 185 && rs.terminates_at, `stripe cancel_at ≈ 6 months out (${days.toFixed(1)} days)`);
    rs.periods_billed = 2;
    let us = await api("/api/stripe/retainer/update-settings", { bid_id: "B1", period_count: 1 }, OWNER);
    ok(us.status === 400, "can't shorten below periods already paid");
    us = await api("/api/stripe/retainer/update-settings", { bid_id: "B1", period_count: 9 }, OWNER);
    const sub9 = subs.get(rs.stripe_subscription_id);
    ok(us.status === 200 && rs.period_count === 9 && (sub9.cancel_at - sub9.billing_cycle_anchor) / 86400 > 270, "owner lengthened to 9 → stripe cancel_at moved");
    ok(db.notifications.some((n) => n.user_id === CONS && n.type === "retainer_length_changed"), "consultant notified of length change");
    us = await api("/api/stripe/retainer/update-settings", { bid_id: "B1", period_count: 3 }, CONS);
    ok(us.status === 403, "consultant can't change the length");
    rs.periods_billed = 9;
    await hook("customer.subscription.deleted", { id: rs.stripe_subscription_id, object: "subscription" });
    ok(rs.status === "completed", "ran full length → completed (not canceled)");

    // ================= delivery-anchored release =================
    const ago = (d) => new Date(Date.now() - d * 86400000).toISOString();
    const ahead = (d) => new Date(Date.now() + d * 86400000).toISOString();
    const cronGet = (auth) => fetch(base + "/api/cron/auto-release", { headers: auth ? { authorization: auth } : {} });
    const cron = async () => (await cronGet("Bearer cronsecret")).json();
    const notes = (type, user) => db.notifications.filter((n) => n.type === type && (!user || n.user_id === user));
    const heldBid = (extra) => {
      Object.assign(bid("B1"), { status: "accepted", payment_status: "held", payment_intent_id: "pi_rel", consultant_payout_cents: 9680, payment_amount_cents: 10000, paid_at: ago(3), ...extra });
      pis.set("pi_rel", { id: "pi_rel", latest_charge: "ch_rel", status: "succeeded" });
    };
    const transfers = () => calls.filter((x) => x.kind === "transfer").length;
    ok((await cronGet()).status === 401 && (await cronGet("Bearer nope")).status === 401, "cron rejects missing/wrong secret");

    // --- deliver → day 7 notice → day 14 release (one-time job) ---
    seed();
    db.consultant_reviews.length = 0; // auto-release never needs a review
    heldBid();
    calls.length = 0;
    let run = await cron();
    ok(bid("B1").payment_status === "held" && run.released.length === 0, "held but not delivered: never auto-releases (no 30-day clock)");
    ok((await api("/api/engagement/mark-delivered", { bid_id: "B1" }, OWNER)).status === 403, "owner can't mark delivered");
    let md = await api("/api/engagement/mark-delivered", { bid_id: "B1", note: "final deck attached", link: "javascript:alert(1)" }, CONS);
    ok(md.status === 400, "non-http delivery link rejected");
    md = await api("/api/engagement/mark-delivered", { bid_id: "B1", note: "final deck attached", link: "https://docs.example.com/deck" }, CONS);
    const relDays = (Date.parse(md.body?.auto_release_at) - Date.now()) / 86400000;
    ok(md.status === 200 && bid("B1").delivered_at && bid("B1").delivery_link === "https://docs.example.com/deck" && relDays > 13.9 && relDays <= 14, `consultant marks delivered → auto-release in 14 days (${relDays.toFixed(2)})`);
    ok(notes("work_delivered", OWNER).length === 1, "owner notified of delivery");
    ok((await api("/api/engagement/mark-delivered", { bid_id: "B1" }, CONS)).status === 409, "can't mark delivered twice");
    let st = await apiGet("/api/engagement/B1/release-status", OWNER);
    ok(st.status === 200 && st.body.payments[0].kind === "one_time" && st.body.payments[0].can_request_changes && !st.body.payments[0].can_mark_delivered, "status endpoint: owner can request changes");
    ok((await apiGet("/api/engagement/B1/release-status", "stranger")).status === 403, "status endpoint: strangers blocked");
    run = await cron();
    ok(run.noticed.length === 0 && run.released.length === 0, "day 0: no notice, no release");
    bid("B1").delivered_at = ago(7.1);
    run = await cron();
    ok(run.noticed.includes("bid-B1") && notes("review_window_closing", OWNER).length === 1 && bid("B1").review_reminded_at, "day 7: owner gets heads-up");
    await cron();
    ok(notes("review_window_closing").length === 1, "day 7 heads-up sent once");
    bid("B1").delivered_at = ago(13.9);
    run = await cron();
    ok(bid("B1").payment_status === "held", "day 13.9: still held");
    bid("B1").delivered_at = ago(14.05);
    run = await cron();
    ok(bid("B1").payment_status === "released" && bid("B1").transfer_id && transfers() === 1, "day 14: released with one transfer");
    ok(notes("auto_released", OWNER).length === 1 && notes("auto_released", CONS).length === 1, "owner + consultant told about the release");
    await cron();
    ok(transfers() === 1, "rerun: no second transfer");

    // --- request changes resets the window ---
    seed();
    heldBid({ delivered_at: ago(10), review_reminded_at: ago(3) });
    ok((await api("/api/engagement/request-changes", { bid_id: "B1" }, CONS)).status === 403, "consultant can't request changes");
    let rc = await api("/api/engagement/request-changes", { bid_id: "B1", note: "slide 4 numbers are off" }, OWNER);
    ok(rc.status === 200 && bid("B1").delivered_at === null && bid("B1").review_reminded_at === null && bid("B1").changes_request_note === "slide 4 numbers are off", "request changes clears the delivered mark + reminder");
    ok(notes("changes_requested", CONS).length === 1, "consultant told about requested changes");
    ok((await api("/api/engagement/request-changes", { bid_id: "B1" }, OWNER)).status === 409, "can't request changes with nothing delivered");
    calls.length = 0;
    run = await cron();
    ok(bid("B1").payment_status === "held" && transfers() === 0, "after changes requested: nothing releases");
    md = await api("/api/engagement/mark-delivered", { bid_id: "B1" }, CONS);
    ok(md.status === 200 && (Date.parse(md.body.auto_release_at) - Date.now()) / 86400000 > 13.9, "re-delivered → fresh 14-day window");
    bid("B1").delivered_at = ago(7.5);
    await cron();
    ok(notes("review_window_closing").length === 1, "new window gets its own day-7 notice");

    // --- retainer period-end window (no marking) ---
    seed();
    db.listings.push({ id: "L3", owner_id: OWNER, title: "r", contract_type: "retainer", retainer_cadence: "monthly" });
    db.bids.push({ id: "B4", listing_id: "L3", consultant_id: CONS, payment_status: "released", refunded_cents: 0 });
    db.retainer_subscriptions.push({ id: "S4", bid_id: "B4", cadence: "monthly", status: "active", auto_release: false });
    const period = (id, idx, extra) => db.bid_phase_payments.push({ id, bid_id: "B4", phase: "retainer_period", period_index: idx, status: "held", amount_cents: 50000, consultant_payout_cents: 48520, charge_id: `ch_${id}`, refunded_cents: 0, ...extra });
    period("RP1", 0, { paid_at: ago(45), period_end_at: ago(15) });   // window ended day 15 → release
    period("RP2", 1, { paid_at: ago(38), period_end_at: ago(8) });    // day 8 → notice only
    period("RP3", 2, { paid_at: ago(20), period_end_at: ahead(10) }); // period running → nothing
    period("RP4", 3, { paid_at: ago(46) });                           // no period_end_at → paid_at + 1 month
    calls.length = 0;
    run = await cron();
    const rp = (id) => db.bid_phase_payments.find((r) => r.id === id);
    ok(rp("RP1").status === "released", "retainer: period ended 15 days ago → released without any marking");
    ok(rp("RP2").status === "held" && run.noticed.includes("pay-RP2"), "retainer: period ended 8 days ago → owner heads-up only");
    ok(rp("RP3").status === "held" && !run.noticed.includes("pay-RP3"), "retainer: period still running → untouched");
    ok(rp("RP4").status === "released", "retainer: missing period_end falls back to paid_at + cadence");
    st = await apiGet("/api/engagement/B4/release-status", CONS);
    const s3 = st.body.payments.find((x) => x.payment_id === "RP3");
    ok(s3 && s3.can_mark_delivered && s3.review_opens_by === "period_end" && Date.parse(s3.review_opens_at) > Date.now(), "status: running period shows window opening at period end, consultant may mark early");

    // --- early mark on retainer ---
    md = await api("/api/engagement/mark-delivered", { bid_id: "B4", payment_id: "RP3", note: "month done early" }, CONS);
    ok(md.status === 200 && (Date.parse(md.body.auto_release_at) - Date.now()) / 86400000 < 14.01, "early mark opens the window now, not at period end");
    rp("RP3").delivered_at = ago(14.2);
    await cron();
    ok(rp("RP3").status === "released", "early-marked period releases 14 days after the mark, before period end");
    // changes on a period-end window: only a new mark reopens it
    period("RP5", 4, { paid_at: ago(40), period_end_at: ago(9) });
    rc = await api("/api/engagement/request-changes", { bid_id: "B4", payment_id: "RP5", note: "missing report" }, OWNER);
    ok(rc.status === 200, "owner can request changes on a period whose window opened at period end");
    rp("RP5").period_end_at = ago(20);
    await cron();
    ok(rp("RP5").status === "held", "after changes requested, period end no longer opens the window");

    // --- retainer first period (paid on the bid) ---
    db.bids.push({ id: "B5", listing_id: "L3", consultant_id: CONS, payment_status: "held", payment_intent_id: "pi_b5", payment_amount_cents: 50000, consultant_payout_cents: 48520, paid_at: ago(46), refunded_cents: 0 });
    pis.set("pi_b5", { id: "pi_b5", latest_charge: "ch_b5", status: "succeeded" });
    await cron();
    ok(bid("B5").payment_status === "released", "retainer first period: window opens at listing cadence end");

    // --- auto_release toggle still releases at invoice time ---
    db.retainer_subscriptions[0].auto_release = true;
    db.retainer_subscriptions[0].stripe_subscription_id = "sub_ar";
    db.retainer_subscriptions[0].periods_billed = 5;
    db.retainer_subscriptions[0].fee_cents = 50000;
    pis.set("pi_inv_in_ar", { id: "pi_inv_in_ar", latest_charge: "ch_ar", status: "succeeded" });
    await hook("invoice.paid", { id: "in_ar", object: "invoice", amount_paid: 50000, lines: { data: [{ period: { start: 1, end: Math.floor(Date.now() / 1000) + 30 * 86400 } }] }, parent: { subscription_details: { subscription: "sub_ar", metadata: { bid_id: "B4" } } } });
    const ar = db.bid_phase_payments.find((r) => r.payment_intent_id === "pi_inv_in_ar");
    ok(ar && ar.status === "released" && ar.period_end_at, "owner's auto_release toggle releases at invoice.paid (period_end_at recorded)");

    // --- phased: service marks delivered, proposal only via backstop ---
    seed();
    db.bids.push({ id: "B6", listing_id: "L2", consultant_id: CONS, payment_status: "unpaid", move_forward_status: "selected", refunded_cents: 0 });
    db.bid_phase_payments.push({ id: "SV1", bid_id: "B6", phase: "service", status: "held", amount_cents: 80000, consultant_payout_cents: 77650, charge_id: "ch_sv1", paid_at: ago(5), refunded_cents: 0 });
    db.bid_phase_payments.push({ id: "PR1", bid_id: "B6", phase: "proposal", status: "held", amount_cents: 5000, charge_id: "ch_pr1", paid_at: ago(60), refunded_cents: 0 });
    ok((await api("/api/engagement/mark-delivered", { bid_id: "B6" }, CONS)).status === 400, "phased: must name which payment");
    ok((await api("/api/engagement/mark-delivered", { bid_id: "B6", payment_id: "PR1" }, CONS)).status === 400, "proposal fee can't be marked delivered");
    ok((await api("/api/engagement/mark-delivered", { bid_id: "B6", payment_id: "SV1" }, CONS)).status === 200, "service fee marked delivered");
    db.bid_phase_payments.find((r) => r.id === "SV1").delivered_at = ago(15);
    await cron();
    ok(db.bid_phase_payments.find((r) => r.id === "SV1").status === "released", "service fee releases 14 days after delivery");
    ok(db.bid_phase_payments.find((r) => r.id === "PR1").status === "held", "60-day-old proposal fee stays held (owner decides)");

    // --- 90-day backstop flags, never releases ---
    seed();
    heldBid({ paid_at: ago(91), delivered_at: ago(20) });
    db.bid_phase_payments.push({ id: "PR2", bid_id: "B1", phase: "proposal", status: "held", amount_cents: 5000, charge_id: "ch_pr2", paid_at: ago(95), refunded_cents: 0 });
    calls.length = 0; logs.length = 0;
    run = await cron();
    ok(bid("B1").payment_status === "held" && transfers() === 0, "90+ days held: not released even though the window passed");
    ok(bid("B1").backstop_flagged_at && run.flagged.length === 2 && notes("held_payment_backstop", "admin1").length === 2, "backstop: both payments flagged, admin notified");
    ok(logs.filter((l) => l.includes("held_payment_backstop")).length === 2, "backstop: ops alert logged");
    await cron();
    ok(notes("held_payment_backstop").length === 2, "backstop: flagged once, no repeat notifications");
    const held = await apiGet("/api/admin/payments/held", "admin1");
    ok(held.status === 200 && held.body.payments.some((p) => p.bid_id === "B1" && p.backstop_flagged_at), "flagged payment appears in the stranded-funds report");
    ok((await apiGet("/api/admin/payments/held", OWNER)).status === 403, "stranded-funds report is admin-only");

    // --- support hold blocks release; stale alert ---
    seed();
    heldBid({ delivered_at: ago(20) });
    ok((await api("/api/admin/payments/hold", { bid_id: "B1", reason: "x" }, OWNER)).status === 403, "owner can't place a support hold");
    ok((await api("/api/admin/payments/hold", { bid_id: "B1" }, "admin1")).status === 400, "hold needs a reason");
    let h = await api("/api/admin/payments/hold", { bid_id: "B1", reason: "owner says deck never arrived" }, "admin1");
    ok(h.status === 200 && bid("B1").support_hold_at && notes("support_hold", OWNER).length === 1 && notes("support_hold", CONS).length === 1, "admin hold set, both parties told");
    calls.length = 0;
    run = await cron();
    ok(bid("B1").payment_status === "held" && transfers() === 0 && run.skipped.some((x) => x.reason === "support_hold"), "hold blocks auto-release");
    st = await apiGet("/api/engagement/B1/release-status", OWNER);
    ok(st.body.payments[0].on_hold && st.body.payments[0].auto_release_at === null, "status: on hold, no auto-release date");
    bid("B1").support_hold_at = ago(15);
    logs.length = 0;
    run = await cron();
    ok(run.stale_holds.includes("bid-B1") && logs.some((l) => l.includes("support_hold_stale")) && notes("support_hold_stale", "admin1").length === 1, "hold open 14+ days → ops alert + admin notice");
    await cron();
    ok(notes("support_hold_stale").length === 1, "stale-hold admin notice not repeated");
    h = await api("/api/admin/payments/clear-hold", { bid_id: "B1" }, "admin1");
    ok(h.status === 200 && bid("B1").support_hold_at === null, "admin clears hold");
    await cron();
    ok(bid("B1").payment_status === "released", "after hold cleared, the overdue window releases");

    // --- hold placed after the job read the row: claim refuses ---
    seed();
    heldBid({ delivered_at: ago(20) });
    const origRetrieve = fakeStripe.paymentIntents.retrieve;
    fakeStripe.paymentIntents.retrieve = async (id) => { bid("B1").support_hold_at = new Date().toISOString(); return origRetrieve(id); };
    calls.length = 0;
    run = await cron();
    fakeStripe.paymentIntents.retrieve = origRetrieve;
    ok(bid("B1").payment_status === "held" && transfers() === 0 && run.skipped.some((x) => x.reason === "changed"), "hold landing mid-run wins over the release (compare-and-set)");

    // --- dispute blocks release ---
    seed();
    heldBid({ delivered_at: ago(20) });
    disputes.push({ id: "dp_x", charge: "ch_rel", status: "needs_response" });
    calls.length = 0;
    run = await cron();
    ok(bid("B1").payment_status === "held" && transfers() === 0 && run.skipped.some((x) => x.reason === "disputed"), "open dispute blocks auto-release");
    disputes[0].status = "lost";
    await cron();
    ok(bid("B1").payment_status === "held", "lost dispute keeps blocking");
    disputes.length = 0;

    // --- partial refund: never released for the full amount ---
    seed();
    heldBid({ delivered_at: ago(20) });
    db.consultant_reviews.push({ id: "R9", bid_id: "B1" });
    await hook("charge.refunded", { id: "ch_rel", payment_intent: "pi_rel", refunded: false, amount: 10000, amount_refunded: 4000 });
    ok(bid("B1").refunded_cents === 4000 && bid("B1").payment_status === "held", "partial refund mirrored onto the held payment");
    ok(notes("partial_refund", "admin1").length === 1, "partial refund → admin notified");
    calls.length = 0;
    run = await cron();
    ok(bid("B1").payment_status === "held" && transfers() === 0 && run.skipped.some((x) => x.reason === "partial_refund"), "partially refunded payment skipped by the job");
    const pr = await api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER);
    ok(pr.status === 409 && transfers() === 0, "owner release also refused after a partial refund");
    db.bids.push({ id: "B7", listing_id: "L3x", consultant_id: CONS, refunded_cents: 0 });
    db.bid_phase_payments.push({ id: "PB1", bid_id: "B6x", phase: "proposal", status: "held", payment_intent_id: "pi_batch", amount_cents: 5000, charge_id: "ch_b", paid_at: ago(2), refunded_cents: 0 });
    db.bid_phase_payments.push({ id: "PB2", bid_id: "B7", phase: "proposal", status: "held", payment_intent_id: "pi_batch", amount_cents: 5000, charge_id: "ch_b", paid_at: ago(2), refunded_cents: 0 });
    await hook("charge.refunded", { id: "ch_b", payment_intent: "pi_batch", refunded: false, amount: 10000, amount_refunded: 5000 });
    ok(db.bid_phase_payments.filter((r) => r.payment_intent_id === "pi_batch").every((r) => r.refunded_cents === 5000 && r.status === "held"), "batch partial refund freezes every row on that charge");

    // ================= free offers ($0, no Stripe) =================
    seed();
    Object.assign(bid("B1"), { amount_cents: 0 });
    calls.length = 0;
    let fo = await api("/api/stripe/payment-intent", { bid_id: "B1" }, OWNER);
    ok(fo.status === 400 && fo.body.free === true, "free offer can't open a payment");
    fo = await api("/api/engagement/accept-free", { bid_id: "B1" }, "intruder");
    ok(fo.status === 403, "non-owner can't accept a free offer");
    fo = await api("/api/engagement/accept-free", { bid_id: "B1" }, OWNER);
    ok(fo.status === 200 && bid("B1").status === "accepted" && bid("B1").payment_status === "held" && bid("B1").payment_amount_cents === 0 && bid("B1").paid_at, "free offer accepted with a $0 hold");
    ok(calls.length === 0, "accepting a free offer makes no Stripe calls");
    fo = await api("/api/stripe/refund-payment", { bid_id: "B1" }, OWNER);
    ok(fo.status === 409, "free engagement can't be refunded");
    const fst = await apiGet("/api/engagement/B1/release-status", OWNER);
    ok(fst.body.payments?.[0]?.free === true, "release-status marks the job free");
    Object.assign(bid("B1"), { delivered_at: ago(20), paid_at: ago(120) });
    run = await cron();
    ok(bid("B1").payment_status === "released" && calls.length === 0 && !run.flagged.length, "free job closes after review, no transfer, no 90-day flag");
    ok(notes("auto_released", OWNER).some((n) => n.title === "Engagement marked complete"), "free close uses 'marked complete' wording");

    seed();
    fo = await api("/api/engagement/accept-free", { bid_id: "B1" }, OWNER);
    ok(fo.status === 400 && bid("B1").status === "pending", "paid offer can't be accepted as free");
    Object.assign(bid("B1"), { amount_cents: 500 });
    fo = await api("/api/stripe/payment-intent", { bid_id: "B1" }, OWNER);
    ok(fo.status === 400, "offer under $10 can't be paid");

    // --- free phased proposals ---
    seed();
    db.bids.push({ id: "B2", listing_id: "L2", consultant_id: CONS, amount_cents: 2000, proposal_fee_cents: 0, service_fee_cents: 2000, status: "pending", payment_status: "unpaid", refunded_cents: 0 });
    calls.length = 0;
    fo = await api("/api/stripe/phased/accept-proposals", { bid_ids: ["B2"] }, OWNER);
    const fp = db.bid_phase_payments.find((r) => r.bid_id === "B2");
    ok(fo.status === 200 && fo.body.free && bid("B2").status === "accepted" && fp?.status === "held" && fp.amount_cents === 0 && calls.length === 0, "all-free proposal batch accepted without Stripe");
    fo = await api("/api/stripe/phased/proposal-decision", { bid_id: "B2", decision: "selected" }, OWNER);
    ok(fo.status === 200 && fp.status === "released" && bid("B2").move_forward_status === "selected" && calls.length === 0, "free proposal closes on decision, no transfer");

    seed();
    db.bids.push({ id: "B3", listing_id: "L2", consultant_id: CONS, amount_cents: 2000, proposal_fee_cents: 0, service_fee_cents: 2000, status: "pending", payment_status: "unpaid", refunded_cents: 0 });
    db.bids.push({ id: "B4", listing_id: "L2", consultant_id: CONS, amount_cents: 3000, proposal_fee_cents: 1500, service_fee_cents: 3000, status: "pending", payment_status: "unpaid", refunded_cents: 0 });
    fo = await api("/api/stripe/phased/accept-proposals", { bid_ids: ["B3", "B4"] }, OWNER);
    const batchRows = db.bid_phase_payments.filter((r) => ["B3", "B4"].includes(r.bid_id));
    ok(fo.status === 200 && fo.body.amount === 1500 && batchRows.length === 2 && batchRows.every((r) => r.status === "authorizing"), "mixed batch charges only the paid proposal; $0 row rides along");
    fo = await api("/api/stripe/phased/accept-proposals", { bid_ids: ["B3"] }, OWNER);
    ok(fo.status === 409, "free row already in a pending batch can't be accepted twice");

    // --- bad signature / legacy path ---
    const bad = await fetch(base + "/webhooks/stripe", { method: "POST", headers: { "content-type": "application/json", "stripe-signature": "t=1,v1=bad" }, body: "{}" });
    ok(bad.status === 400, "legacy /webhooks/stripe path routed; bad signature → 400");

    origErr(`\n${pass} checks passed`);
  } catch (e) {
    origErr("FAIL:", e.message);
    origErr(logs.slice(-15).join("\n"));
    process.exitCode = 1;
  } finally { srv.close(); }
})();
