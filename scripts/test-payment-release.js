// Payment-flow harness: loads app.js with an in-memory Supabase and a fake
// Stripe (real webhook signing), then drives it over HTTP.
//   node scripts/test-payment-release.js
// No network, no real keys. Covers idempotency, compare-and-set releases,
// disputes, retainer terms, the delivery-anchored release job, and
// reported problems with support outcomes A / B / C.
const WT = require("path").resolve(__dirname, "..");
const Module = require("module");
const assert = require("assert");

// ---------- fake supabase ----------
const db = { profiles: [], listings: [], bids: [], bid_phase_payments: [], retainer_subscriptions: [], consultant_reviews: [], notifications: [], payment_audit: [] };
// Columns the add_delivery_release / add_support_outcomes migrations default.
const PAY_DEFAULTS = { refunded_cents: 0, problem_report_count: 0, redo_used: false };
const DEFAULTS = { bids: PAY_DEFAULTS, bid_phase_payments: PAY_DEFAULTS };
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
      const inserted = st.rows.map((r) => ({ id: `id${nextId++}`, ...(DEFAULTS[table] || {}), ...(table === "payment_audit" ? { created_at: new Date(Date.now() + nextId).toISOString() } : {}), ...r }));
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
    admin: {
      listUsers: async () => ({ data: { users: [{ id: "admin1", email: "moizdalal@ufl.edu" }] } }),
      getUserById: async (id) => ({ data: { user: { id, email: `${id}@x.test` } } }),
    },
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
const transferLog = [];
// Charges with their settled balance transaction (Stripe's actual fee).
const charges = new Map();
const setCharge = (id, amount, fee, card = { country: "US", brand: "visa" }, extra = {}) =>
  charges.set(id, { id, amount, currency: "usd", payment_method_details: { card }, balance_transaction: { fee, fee_details: [{ type: "stripe_fee", amount: fee }] }, ...extra });
const refundLog = [];
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
  transfers: { create: async (p, o) => { await new Promise((r) => setTimeout(r, 30)); if (failTransfers) throw new Error("stripe down"); transferLog.push(p); return keyed("transfer", o, () => ({ id: `tr_${nextId++}`, ...p })); } },
  refunds: { create: async (p, o) => { refundLog.push(p); return keyed("refund", o, () => ({ id: `re_${nextId++}`, ...p })); } },
  products: { create: async (p, o) => keyed("product", o, () => ({ id: `prod_${nextId++}` })) },
  prices: { create: async (p, o) => keyed("price", o, () => ({ id: `price_${nextId++}` })) },
  subscriptions: {
    create: async (p, o) => keyed("sub", o, () => { const sub = { id: `sub_${nextId++}`, status: "active", start_date: Math.floor(Date.now() / 1000), billing_cycle_anchor: Math.floor(Date.now() / 1000), ...p }; subs.set(sub.id, sub); return sub; }),
    retrieve: async (id) => ({ ...subs.get(id) }),
    update: async (id, p) => { calls.push({ kind: "sub.update", p }); Object.assign(subs.get(id), p); return subs.get(id); },
  },
  charges: { retrieve: async (id) => ({ ...(charges.get(id) || { id, amount: 0, balance_transaction: null }) }) },
  disputes: { list: async ({ charge, payment_intent }) => ({ data: disputes.filter((d) => (charge && d.charge === charge) || (payment_intent && d.payment_intent === payment_intent)) }) },
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
    ok(db.payment_audit.some((a) => a.action === "support_hold" && a.actor_id === "admin1" && a.details.reason), "admin hold writes an audit row");
    h = await api("/api/admin/payments/clear-hold", { bid_id: "B1" }, "admin1");
    ok(h.status === 404 && bid("B1").support_hold_at, "no plain clear-hold: a hold ends only with an outcome");

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

    // ================= reported problems + support outcomes =================
    const audits = (action) => db.payment_audit.filter((a) => a.action === action);
    const report = (who = OWNER, extra = {}) => api("/api/engagement/report-problem", { bid_id: "B1", note: "the deck is missing the pricing section", link: "https://docs.example.com/notes", ...extra }, who);
    const outcome = (o, who = "admin1", extra = {}) => api("/api/admin/payments/outcome", { bid_id: "B1", outcome: o, ...extra }, who);
    const choose = (choice, who = CONS) => api("/api/engagement/redo-choice", { bid_id: "B1", choice }, who);
    // $100 offer + $10 platform fee = $110 charged; $96.80 payout ($3.20
    // checkout estimate). Stripe's actual fee on the $110 charge: $3.49.
    const FEES = { payment_amount_cents: 11000, platform_fee_cents: 1000, stripe_fee_cents: 320, consultant_payout_cents: 9680 };
    const reported = async (extra = {}) => {
      seed();
      heldBid({ delivered_at: ago(2), ...FEES, ...extra });
      setCharge("ch_rel", 11000, 349);
      const r = await report();
      assert.strictEqual(r.status, 200, `report failed: ${JSON.stringify(r.body)}`);
      bid("B1").response_due_at = ago(0.01); // consultant's 48 hours are up
      calls.length = 0; transferLog.length = 0; refundLog.length = 0;
    };

    // --- report window ---
    seed();
    heldBid({ ...FEES });
    ok((await report()).status === 409, "report: nothing delivered yet → refused");
    bid("B1").delivered_at = ago(14.2);
    ok((await report()).status === 409, "report: after the 14-day review ended → refused");
    bid("B1").delivered_at = ago(2);
    ok((await report(CONS)).status === 403, "report: consultant can't report");
    ok((await report(OWNER, { note: "" })).status === 400, "report: needs a note");
    ok((await report(OWNER, { link: "javascript:alert(1)" })).status === 400, "report: non-http link rejected");

    // --- report locks auto-release ---
    let rpt = await report();
    ok(rpt.status === 200 && bid("B1").support_hold_at && bid("B1").problem_reported_at && bid("B1").problem_report_count === 1 && bid("B1").problem_report_link === "https://docs.example.com/notes", "business reports a problem → payment locked");
    ok(notes("problem_reported", OWNER).length === 1 && notes("problem_reported", CONS).length === 1 && notes("problem_reported", "admin1").length === 1, "report: business, consultant and admin notified");
    ok(notes("problem_reported", CONS)[0].body.includes("pricing section"), "report: consultant sees the business's note");
    ok(audits("problem_reported").length === 1 && audits("problem_reported")[0].actor_id === OWNER, "report writes an audit row");
    ok((await report()).status === 409, "can't report the same payment twice");
    ok((await api("/api/engagement/request-changes", { bid_id: "B1", note: "x" }, OWNER)).status === 409, "can't request changes while support is reviewing");
    st = await apiGet("/api/engagement/B1/release-status", OWNER);
    ok(st.body.payments[0].reported && !st.body.payments[0].can_report_problem && st.body.payments[0].auto_release_at === null, "status: reported, no auto-release date");
    bid("B1").delivered_at = ago(14.5);
    calls.length = 0;
    run = await cron();
    ok(bid("B1").payment_status === "held" && transfers() === 0 && run.skipped.some((x) => x.reason === "support_hold"), "reported payment doesn't auto-release after day 14");

    // --- business can still release while locked ---
    const own = await api("/api/stripe/release-funds", { bid_id: "B1" }, OWNER);
    ok(own.status === 200 && bid("B1").payment_status === "released" && transfers() === 1, "business can still release a reported payment itself");

    // --- the consultant's side: 48 hours from the report ---
    seed();
    heldBid({ delivered_at: ago(2), ...FEES });
    setCharge("ch_rel", 11000, 349);
    await report();
    const dueH = (Date.parse(bid("B1").response_due_at) - Date.now()) / 3600000;
    ok(dueH > 47.9 && dueH <= 48, `report opens a 48-hour response window (${dueH.toFixed(2)}h)`);
    ok(/tell support your side by/.test(notes("problem_reported", CONS)[0].body), "consultant told why and by when to respond");
    st = await apiGet("/api/engagement/B1/release-status", CONS);
    ok(st.body.payments[0].can_respond && st.body.payments[0].response_due_at && st.body.payments[0].problem_report_link === "https://docs.example.com/notes", "status: consultant can respond, sees the business's note and link");
    const respond = (who, body) => api("/api/engagement/respond-to-report", { bid_id: "B1", ...body }, who);
    ok((await respond(OWNER, { note: "x" })).status === 403, "respond: business can't respond for the consultant");
    ok((await respond(CONS, { note: "" })).status === 400, "respond: needs a note");
    let early = await outcome("meets_scope");
    ok(early.status === 409 && early.body.response_window_open && bid("B1").payment_status === "held", "deciding inside the 48 hours needs confirmation");
    let rs1 = await respond(CONS, { note: "i sent the deck on oct 20, see the shared folder.", link: "https://drive.example.com/deck" });
    ok(rs1.status === 200 && bid("B1").consultant_response_at && !("consultant_response_note" in bid("B1")) && audits("consultant_response")[0]?.details.link === "https://drive.example.com/deck", "consultant sends their side with a link (text kept server-side only)");
    ok(notes("consultant_response", "admin1").length === 1 && notes("consultant_response", OWNER).length === 1 && !notes("consultant_response", OWNER)[0].body.includes("shared folder"), "support gets the response; business only told one was sent");
    ok(audits("consultant_response").length === 1 && audits("consultant_response")[0].actor_id === CONS, "response writes an audit row");
    ok((await respond(CONS, { note: "also attaching the invoice." })).status === 200 && audits("consultant_response_updated").length === 1 && notes("consultant_response", OWNER).length === 1, "consultant can update it; business not re-notified");
    st = await apiGet("/api/engagement/B1/release-status", OWNER);
    ok(st.body.payments[0].responded_at && st.body.payments[0].consultant_response_note === null, "status: business sees that a response was sent, not its text");
    st = await apiGet("/api/engagement/B1/release-status", CONS);
    ok(st.body.payments[0].consultant_response_note === "also attaching the invoice." && st.body.payments[0].can_respond, "status: consultant sees their latest response and can still edit it");
    let rl = await apiGet("/api/admin/payments/held", "admin1");
    let rlp = rl.body.payments.find((x) => x.key === "bid-B1");
    ok(rlp.consultant_response_note === "also attaching the invoice." && !rlp.flags.awaiting_response, "admin screen shows the consultant's side");
    ok((await outcome("meets_scope")).status === 200, "once they've responded, support decides without confirming");
    // no response: deciding early with confirmation, or after 48 hours
    seed();
    heldBid({ delivered_at: ago(2), ...FEES });
    await report();
    early = await outcome("scope_breached", "admin1", { decide_early: true });
    ok(early.status === 200 && audits("outcome_scope_breached")[0].details.early === true, "support can decide before the 48 hours with confirmation (recorded as early)");
    seed();
    heldBid({ delivered_at: ago(2), ...FEES });
    await report();
    bid("B1").response_due_at = ago(0.01);
    ok((await respond(CONS, { note: "late" })).status === 409, "respond: refused after 48 hours");
    ok((await outcome("meets_scope")).status === 200, "after 48 hours, support decides from the record");

    // --- support hold only where the business can't report ---
    seed();
    heldBid({ delivered_at: ago(2), ...FEES });
    h = await api("/api/admin/payments/hold", { bid_id: "B1", reason: "business called" }, "admin1");
    ok(h.status === 409 && /report a problem/.test(h.body.error) && !bid("B1").support_hold_at, "support hold refused during the review: the business reports it themselves");
    rl = await apiGet("/api/admin/payments/held?all=1", "admin1");
    ok(!rl.body.payments.find((x) => x.key === "bid-B1").actions.includes("hold"), "admin screen doesn't offer a hold the business can place itself");
    seed();
    heldBid({ delivered_at: null, paid_at: ago(30), ...FEES });
    h = await api("/api/admin/payments/hold", { bid_id: "B1", reason: "consultant stopped replying and nothing was delivered" }, "admin1");
    ok(h.status === 200 && bid("B1").response_due_at, "support hold allowed when nothing was delivered; opens the 48-hour window");
    ok(notes("support_hold", CONS)[0].body.includes("stopped replying") && notes("support_hold", OWNER)[0].body.includes("stopped replying"), "both sides see the hold reason");
    st = await apiGet("/api/engagement/B1/release-status", CONS);
    ok(st.body.payments[0].hold_reason.includes("stopped replying") && st.body.payments[0].can_respond, "status: consultant sees the reason and can respond");

    // --- outcome A: meets scope → release ---
    await reported();
    ok((await outcome("meets_scope", OWNER)).status === 403, "only admins pick an outcome");
    ok((await outcome("split")).status === 400, "free-form outcomes refused");
    let oc = await outcome("meets_scope");
    ok(oc.status === 200 && bid("B1").payment_status === "released" && bid("B1").support_outcome === "meets_scope" && transferLog.length === 1 && transferLog[0].amount === 9680, "A: released to the consultant ($96.80)");
    ok(transferLog[0].source_transaction === "ch_rel", "A: transfer pinned to the charge");
    ok(notes("support_outcome", OWNER).length === 1 && notes("support_outcome", CONS).length === 1, "A: both parties notified");
    const aud = audits("outcome_meets_scope")[0];
    ok(aud && aud.actor_email === "moizdalal@ufl.edu" && aud.amount_cents === 9680 && aud.stripe_object_id?.startsWith("tr_"), "A: audit row with who, amount, transfer id");
    st = await apiGet("/api/engagement/B1/release-status", CONS);
    ok(st.body.payments[0].status === "released" && st.body.payments[0].support_outcome === "meets_scope", "status: outcome A shown after release");

    // --- outcome B: redo, then a second report allows only A or C ---
    await reported();
    oc = await outcome("fixable", "admin1", { note: "add the pricing section" });
    const choiceDays = (Date.parse(bid("B1").redo_deadline_at) - Date.now()) / 86400000;
    ok(oc.status === 200 && bid("B1").support_outcome === "fixable" && choiceDays > 4.99 && choiceDays <= 5, `B: consultant has 5 days to choose (${choiceDays.toFixed(2)})`);
    ok(notes("support_outcome", CONS).length === 1 && notes("support_outcome", OWNER).length === 1, "B: both parties notified");
    st = await apiGet("/api/engagement/B1/release-status", CONS);
    let p0 = st.body.payments[0];
    ok(p0.can_choose && p0.waiting_on_consultant && p0.money.give_back_cents === 11000 && !("card_fee_cents" in p0.money) && !p0.can_mark_delivered, "status: consultant gets the choice, full give-back amount shown, no fee");
    ok((await outcome("meets_scope")).status === 409, "B: no other outcome while waiting on the consultant");
    ok((await choose("redo", OWNER)).status === 403, "B: business can't choose for the consultant");
    ok((await choose("maybe")).status === 400, "B: only redo or give_back");
    run = await cron();
    ok(bid("B1").payment_status === "held" && transfers() === 0, "B: nothing releases while waiting on the choice");
    let ch = await choose("redo");
    ok(ch.status === 200 && bid("B1").redo_used && bid("B1").delivered_at === null && bid("B1").support_hold_at === null && bid("B1").consultant_choice === "redo", "B redo: delivered mark cleared, lock lifted, redo used");
    ok(notes("redo_choice", OWNER).length === 1 && notes("redo_choice", OWNER)[0].body.includes("last redo") && notes("redo_choice", CONS).length === 1, "B redo: both notified, business told it's the last redo");
    ok(audits("consultant_redo").length === 1 && audits("consultant_redo")[0].actor_id === CONS, "B redo: audit row");
    ok((await choose("give_back")).status === 409, "B redo: can't choose twice");
    run = await cron();
    ok(bid("B1").payment_status === "held" && transfers() === 0, "after a redo, nothing releases until delivered again");
    md = await api("/api/engagement/mark-delivered", { bid_id: "B1", note: "added pricing" }, CONS);
    ok(md.status === 200 && (Date.parse(md.body.auto_release_at) - Date.now()) / 86400000 > 13.9, "redelivery → new 14-day review");
    st = await apiGet("/api/engagement/B1/release-status", OWNER);
    ok(st.body.payments[0].redo_used && st.body.payments[0].can_report_problem, "status: business can report again, marked as the last redo");
    rpt = await report(OWNER, { note: "pricing is still wrong" });
    ok(rpt.status === 200 && bid("B1").problem_report_count === 2 && bid("B1").response_due_at && !bid("B1").consultant_response_at, "second report after the redo accepted, fresh 48 hours to respond");
    bid("B1").response_due_at = ago(0.01);
    ok(notes("problem_reported", "admin1").some((n) => n.body.includes("after a redo")), "admin told it's a second report: A or C only");
    let list = await apiGet("/api/admin/payments/held", "admin1");
    let lp = list.body.payments.find((x) => x.key === "bid-B1");
    ok(lp && lp.actions.includes("meets_scope") && lp.actions.includes("scope_breached") && !lp.actions.includes("fixable"), "admin screen offers only A or C after a redo");
    ok((await outcome("fixable")).status === 409 && bid("B1").support_outcome === null, "second report after a redo: B refused by the server");

    // --- outcome B: give back, fee math ---
    await reported();
    await outcome("fixable");
    ch = await choose("give_back");
    ok(ch.status === 200 && bid("B1").payment_status === "refunded" && bid("B1").consultant_choice === "give_back", "B give back: payment refunded");
    ok(refundLog.length === 1 && refundLog[0].amount === 11000 && refundLog[0].charge === "ch_rel" && bid("B1").refunded_cents === 11000, "B give back: the full $110 is refunded (incl. platform fee)");
    ok(audits("consultant_give_back")[0]?.details.card_fee_absorbed_cents === 349 && audits("consultant_give_back")[0].details.fee_source === "stripe", "B give back: Stripe's $3.49 fee recorded as absorbed by grassroots");
    ok(transfers() === 0, "B give back: consultant gets nothing");
    const ret = notes("payment_returned", OWNER)[0];
    ok(ret && ret.title.includes("$110.00 in full") && !/fee/.test(ret.body) && notes("payment_returned", CONS).length === 1, "B give back: business told it's a full refund, no fee mentioned; consultant notified");
    ok(audits("consultant_give_back")[0]?.amount_cents === 11000 && audits("consultant_give_back")[0].stripe_object_id?.startsWith("re_"), "B give back: audit row with refund id");
    logs.length = 0;
    await hook("charge.refunded", { id: "ch_rel", payment_intent: "pi_rel", refunded: false, amount: 11000, amount_refunded: 11000 });
    ok(!logs.some((l) => l.includes("partial_refund_needs_review")) && notes("partial_refund", "admin1").length === 0, "webhook for grassroots' own give-back isn't flagged as an unexplained partial refund");
    st = await apiGet("/api/engagement/B1/release-status", OWNER);
    ok(st.body.payments[0]?.status === "refunded" && st.body.payments[0].consultant_choice === "give_back" && st.body.payments[0].refunded_cents === 11000, "status: give-back shown to the business after refund");

    // --- outcome B: day-3 reminder, then 5-day timeout → give back ---
    await reported();
    await outcome("fixable");
    bid("B1").redo_offered_at = ago(3.1);
    bid("B1").redo_deadline_at = ahead(1.9);
    run = await cron();
    ok(run.redo_reminders.includes("bid-B1") && notes("redo_choice_reminder", CONS).length === 1 && notes("redo_choice_reminder", CONS)[0].title === "2 days left to choose", "B: day-3 reminder to the consultant");
    await cron();
    ok(notes("redo_choice_reminder", CONS).length === 1, "B: reminder sent once");
    bid("B1").redo_deadline_at = ago(0.01);
    ok((await choose("redo")).status === 409, "B: can't redo after the 5 days");
    run = await cron();
    ok(run.returned.includes("bid-B1") && bid("B1").payment_status === "refunded" && bid("B1").consultant_choice === "give_back_timeout" && refundLog[0]?.amount === 11000, "B: no answer in 5 days → payment goes back in full");
    ok(audits("give_back_timeout")[0]?.actor_email === "system:auto-release" && notes("payment_returned", OWNER)[0].body.includes("didn't choose within 5 days"), "B timeout: audit row by the system, business told why");
    await cron();
    ok(refundLog.length === 1, "B timeout: rerun doesn't refund twice");

    // --- outcome C: scope breached → full refund ---
    await reported();
    oc = await outcome("scope_breached");
    ok(oc.status === 200 && bid("B1").payment_status === "refunded" && bid("B1").support_outcome === "scope_breached" && refundLog[0].amount === 11000 && transfers() === 0, "C: full $110 refunded incl. platform fee, consultant gets nothing");
    ok(notes("support_outcome", OWNER)[0].title.includes("$110.00 in full") && notes("support_outcome", CONS).length === 1, "C: both notified");
    ok(audits("outcome_scope_breached")[0]?.details.card_fee_absorbed_cents === 349, "C: audit row records Stripe's actual fee, which grassroots absorbs");
    ok((await outcome("meets_scope")).status === 409, "C: refunded payment can't be released afterwards");

    // --- international card: grassroots absorbs the higher fee, recorded internally ---
    await reported();
    setCharge("ch_rel", 11000, 514, { country: "GB", brand: "visa" });
    await outcome("fixable");
    list = await apiGet("/api/admin/payments/held", "admin1");
    lp = list.body.payments.find((x) => x.key === "bid-B1");
    ok(lp.money.card_fee_absorbed_cents === 514 && lp.money.card_fee_source === "stripe" && /international card \(issued in GB\)/.test(lp.money.card_fee_note), "admin screen shows the $5.14 fee grassroots absorbs and why it's above $3.49");
    st = await apiGet("/api/engagement/B1/release-status", CONS);
    ok(st.body.payments[0].money.give_back_cents === 11000 && !JSON.stringify(st.body).includes("international"), "consultant sees a full give-back; fee details stay internal");
    ch = await choose("give_back");
    const intl = audits("consultant_give_back")[0]?.details;
    ok(ch.status === 200 && refundLog[0]?.amount === 11000 && intl.card_fee_absorbed_cents === 514 && intl.fee_note.includes("international"), "international card: full $110 refunded; $5.14 fee and reason in the audit row");
    ok(!notes("payment_returned", OWNER)[0].body.includes("international"), "business isn't shown fee details");
    await reported();
    setCharge("ch_rel", 11000, 679, { country: "MX", brand: "visa" }, { currency: "mxn", balance_transaction: { fee: 679, exchange_rate: 0.054, fee_details: [{ type: "stripe_fee", amount: 679 }] } });
    await outcome("scope_breached");
    ok(/international card \(issued in MX\) and paid in another currency/.test(audits("outcome_scope_breached")[0]?.details.fee_note), "currency conversion named in the audit too");

    // --- fee lookup fails: refund still goes through in full, estimate recorded ---
    await reported();
    charges.delete("ch_rel");
    await outcome("fixable");
    ch = await choose("give_back");
    ok(ch.status === 200 && refundLog[0]?.amount === 11000 && audits("consultant_give_back")[0]?.details.fee_source === "estimate", "no fee from stripe → full refund anyway, audit marks the fee as an estimate");

    // ================= custom split =================
    const split = (refund, transfer, extra = {}) => outcome("split", "admin1", { refund_cents: refund, transfer_cents: transfer, reason: "half the deck was usable", ...extra });
    await reported();
    ok((await split(5500, 5500, { reason: "" })).status === 400, "split: needs a reason");
    ok((await split(0, 11000)).status === 400 && (await split(11000, 0)).status === 400, "split: both parts must be above $0 (all-or-nothing is A or C)");
    ok((await split(6000, 5001)).status === 400 && bid("B1").payment_status === "held" && refundLog.length === 0, "split: refund + payout capped at what's left on the charge ($110)");
    ok((await outcome("split", OWNER, { refund_cents: 5500, transfer_cents: 5500, reason: "x" })).status === 403, "split: admin only");
    let sp = await split(3300, 7700);
    ok(sp.status === 200 && bid("B1").payment_status === "released" && bid("B1").support_outcome === "split" && bid("B1").refunded_cents === 3300 && bid("B1").consultant_payout_cents === 7700, "split 30/70: $33 back to the business, $77 to the consultant");
    ok(refundLog.length === 1 && refundLog[0].amount === 3300 && refundLog[0].charge === "ch_rel" && transferLog.length === 1 && transferLog[0].amount === 7700 && transferLog[0].source_transaction === "ch_rel", "split: one refund + one transfer pinned to the charge");
    ok(calls.some((c) => c.kind === "refund" && c.key?.startsWith("refund:split:bids:B1:3300")) && calls.some((c) => c.kind === "transfer" && c.key?.startsWith("transfer:split:bids:B1:7700")), "split: idempotency keys on the refund and the transfer");
    const sa = audits("outcome_split")[0];
    ok(sa && sa.details.reason === "half the deck was usable" && sa.details.refund_cents === 3300 && sa.details.transfer_cents === 7700 && sa.details.card_fee_absorbed_cents === 349, "split: audit row with reason, both amounts, and the $3.49 fee grassroots absorbs");
    ok(notes("support_outcome", OWNER)[0].body.includes("$33.00 refunded to you") && notes("support_outcome", CONS)[0].body.includes("$77.00 to you"), "split: both sides told the dollar amounts");
    logs.length = 0;
    await hook("charge.refunded", { id: "ch_rel", payment_intent: "pi_rel", refunded: false, amount: 11000, amount_refunded: 3300 });
    ok(!logs.some((l) => l.includes("partial_refund_needs_review")) && notes("partial_refund", "admin1").length === 0, "split refund isn't flagged as an unexplained partial refund");
    st = await apiGet("/api/engagement/B1/release-status", OWNER);
    ok(st.body.payments[0].support_outcome === "split" && st.body.payments[0].money.split_refund_cents === 3300 && st.body.payments[0].money.split_transfer_cents === 7700, "status: split amounts shown on the engagement page");
    ok((await split(1000, 1000)).status === 409 && transferLog.length === 1, "split: can't split twice");
    // split below the full amount: grassroots keeps the difference (e.g. platform fee)
    await reported();
    sp = await split(5000, 5000);
    ok(sp.status === 200 && refundLog[0].amount === 5000 && transferLog[0].amount === 5000, "split 50/50 of $100 out of $110: allowed under the cap");
    // dispute blocks a split
    await reported();
    disputes.push({ id: "dp_split", charge: "ch_rel", payment_intent: "pi_rel", status: "needs_response" });
    sp = await split(5500, 5500);
    ok(sp.status === 409 && bid("B1").payment_status === "held" && refundLog.length === 0 && transferLog.length === 0, "split: blocked by an open dispute, nothing moves");
    disputes.length = 0;
    // refund fails → claim rolls back
    await reported();
    const origRefund = fakeStripe.refunds.create;
    fakeStripe.refunds.create = async () => { throw new Error("stripe down"); };
    sp = await split(5500, 5500);
    fakeStripe.refunds.create = origRefund;
    ok(sp.status === 500 && bid("B1").payment_status === "held" && bid("B1").refunded_cents === 0 && bid("B1").support_outcome == null && transferLog.length === 0, "split: refund fails → payment back to held, nothing moved");
    // transfer fails after the refund → retry from the admin screen
    await reported();
    failTransfers = true;
    sp = await split(5500, 5500);
    failTransfers = false;
    ok(sp.status === 200 && sp.body.transfer_error && bid("B1").payment_status === "released" && !bid("B1").transfer_id && refundLog.length === 1, "split: transfer fails after refund → refund stands, payout pending");
    ok(logs.some((l) => l.includes("split_transfer_failed")) && notes("support_outcome", CONS)[0].body.includes("delayed"), "split: ops alerted, consultant told it's delayed");
    list = await apiGet("/api/admin/payments/held", "admin1");
    lp = list.body.payments.find((x) => x.key === "bid-B1");
    ok(lp && lp.flags.split_transfer_failed && lp.actions.join() === "retry_split_transfer", "admin screen lists the stuck payout with a retry");
    const retry = await api("/api/admin/payments/retry-split-transfer", { bid_id: "B1" }, "admin1");
    ok(retry.status === 200 && bid("B1").transfer_id && transferLog.at(-1).amount === 5500 && audits("split_transfer_retry").length === 1, "retry sends the $55 payout once");
    ok((await api("/api/admin/payments/retry-split-transfer", { bid_id: "B1" }, "admin1")).status === 409, "nothing left to retry");
    // available after a redo and on held proposal fees
    await reported({ redo_used: true, problem_report_count: 1 });
    list = await apiGet("/api/admin/payments/held", "admin1");
    ok(list.body.payments.find((x) => x.key === "bid-B1").actions.includes("split"), "split offered after a redo (with A and C)");

    // --- stale report alert ---
    await reported();
    bid("B1").support_hold_at = ago(15);
    logs.length = 0;
    run = await cron();
    ok(run.stale_holds.includes("bid-B1") && logs.some((l) => l.includes("problem_report_stale")) && notes("problem_report_stale", "admin1").length === 1, "report undecided 14+ days → ops alert + admin notice");
    list = await apiGet("/api/admin/payments/held", "admin1");
    ok(list.body.payments.find((x) => x.key === "bid-B1")?.flags.stale, "admin screen flags the stale report");
    await outcome("fixable");
    logs.length = 0;
    run = await cron();
    ok(!run.stale_holds.includes("bid-B1"), "no stale alert once support decided (waiting on consultant)");

    // --- dispute blocks every outcome that moves money ---
    await reported();
    disputes.push({ id: "dp_s", charge: "ch_rel", payment_intent: "pi_rel", status: "needs_response", reason: "product_not_received" });
    oc = await outcome("meets_scope");
    ok(oc.status === 409 && bid("B1").payment_status === "held" && transfers() === 0, "dispute blocks outcome A (no transfer)");
    oc = await outcome("scope_breached");
    ok(oc.status === 409 && bid("B1").payment_status === "held" && refundLog.length === 0, "dispute blocks outcome C (no refund)");
    list = await apiGet("/api/admin/payments/held", "admin1");
    lp = list.body.payments.find((x) => x.key === "bid-B1");
    ok(lp.flags.disputed && lp.dispute.status === "needs_response" && !lp.actions.includes("meets_scope"), "admin screen shows the dispute and hides release/refund");
    disputes.length = 0;

    // --- partial refund: support settles the rest ---
    seed();
    heldBid({ delivered_at: ago(20), ...FEES });
    await hook("charge.refunded", { id: "ch_rel", payment_intent: "pi_rel", refunded: false, amount: 11000, amount_refunded: 4000 });
    transferLog.length = 0;
    ok((await outcome("meets_scope")).status === 409, "partly refunded: full release refused");
    list = await apiGet("/api/admin/payments/held", "admin1");
    lp = list.body.payments.find((x) => x.key === "bid-B1");
    ok(lp.flags.partly_refunded && lp.actions.join() === "release_remainder,refund_remainder,hold" && lp.money.remainder_payout_cents === 5680, "admin screen: settle the rest ($70 left − $3.20 − $10 = $56.80 payout)");
    let sr = await api("/api/admin/payments/settle-remainder", { bid_id: "B1", action: "release" }, "admin1");
    ok(sr.status === 200 && bid("B1").payment_status === "released" && transferLog[0]?.amount === 5680 && bid("B1").support_outcome === "release_remainder", "release the rest: $56.80 transferred");
    ok(audits("release_remainder").length === 1, "release the rest: audit row");
    seed();
    heldBid({ delivered_at: ago(20), ...FEES });
    await hook("charge.refunded", { id: "ch_rel", payment_intent: "pi_rel", refunded: false, amount: 11000, amount_refunded: 4000 });
    refundLog.length = 0;
    sr = await api("/api/admin/payments/settle-remainder", { bid_id: "B1", action: "refund" }, "admin1");
    ok(sr.status === 200 && bid("B1").payment_status === "refunded" && refundLog[0]?.amount === 7000 && bid("B1").refunded_cents === 11000, "refund the rest: $70 refunded");
    ok(audits("refund_remainder").length === 1 && notes("support_outcome", OWNER).length === 1 && notes("support_outcome", CONS).length === 1, "refund the rest: audit row, both notified");
    ok((await api("/api/admin/payments/settle-remainder", { bid_id: "B1", action: "refund" }, OWNER)).status === 403, "settle is admin-only");

    // --- phase rows: give back on a service fee; shared charge stays clean ---
    seed();
    db.bids.push({ id: "B6", listing_id: "L2", consultant_id: CONS, payment_status: "unpaid", move_forward_status: "selected", refunded_cents: 0 });
    setCharge("ch_sv2", 80000, 2350);
    db.bid_phase_payments.push({ id: "SV2", bid_id: "B6", phase: "service", status: "held", amount_cents: 80000, platform_fee_cents: 0, stripe_fee_cents: 2350, consultant_payout_cents: 77650, payment_intent_id: "pi_sv2", charge_id: "ch_sv2", paid_at: ago(5), delivered_at: ago(2), refunded_cents: 0 });
    rpt = await api("/api/engagement/report-problem", { bid_id: "B6", payment_id: "SV2", note: "no slides" }, OWNER);
    db.bid_phase_payments.find((r) => r.id === "SV2").response_due_at = ago(0.01);
    await api("/api/admin/payments/outcome", { bid_id: "B6", payment_id: "SV2", outcome: "fixable" }, "admin1");
    refundLog.length = 0;
    ch = await api("/api/engagement/redo-choice", { bid_id: "B6", payment_id: "SV2", choice: "give_back" }, CONS);
    const sv2 = db.bid_phase_payments.find((r) => r.id === "SV2");
    ok(rpt.status === 200 && ch.status === 200 && sv2.status === "refunded" && sv2.refunded_at && refundLog[0]?.amount === 80000, "service fee: report → B → give back refunds the full $800");
    db.bid_phase_payments.push({ id: "PB3", bid_id: "B6", phase: "proposal", status: "held", payment_intent_id: "pi_b3", charge_id: "ch_b3", amount_cents: 5000, paid_at: ago(2), refunded_cents: 0 });
    db.bid_phase_payments.push({ id: "PB4", bid_id: "B7x", phase: "proposal", status: "held", payment_intent_id: "pi_b3", charge_id: "ch_b3", amount_cents: 5000, paid_at: ago(2), refunded_cents: 0 });
    ok((await api("/api/admin/payments/outcome", { bid_id: "B6", payment_id: "PB3", outcome: "fixable" }, "admin1")).status === 400, "proposal fee: no redo outcome");
    await api("/api/admin/payments/hold", { bid_id: "B6", payment_id: "PB3", reason: "business emailed support" }, "admin1");
    db.bid_phase_payments.find((r) => r.id === "PB3").response_due_at = ago(0.01);
    oc = await api("/api/admin/payments/outcome", { bid_id: "B6", payment_id: "PB3", outcome: "scope_breached" }, "admin1");
    await hook("charge.refunded", { id: "ch_b3", payment_intent: "pi_b3", refunded: false, amount: 10000, amount_refunded: 5000 });
    const pb4 = db.bid_phase_payments.find((r) => r.id === "PB4");
    ok(oc.status === 200 && pb4.status === "held" && pb4.refunded_cents === 0, "refunding one payment on a shared charge doesn't freeze the other");

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
