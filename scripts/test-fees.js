// Tests for the platform fee ladder: node scripts/test-fees.js
// Runs without a database or Stripe. The Supabase client is a small fake.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const fees = require("../lib/fees");
const { countGoodPaidReviews, getConsultantFeeRate, feesForConsultant } = require("../lib/consultant-fee");

let pass = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  pass += 1;
  console.log("  ✓", msg);
};

const review = (bidId, score) => ({
  bid_id: bidId,
  work_product_quality: score,
  communication: score,
  timeliness: score,
  professionalism: score,
  cost_value: score,
});

function fakeSupabase(tables, failing = null) {
  const builder = (table) => {
    const filters = [];
    const run = () => {
      if (table === failing) return { data: null, error: { message: "down" } };
      let rows = tables[table] || [];
      for (const keep of filters) rows = rows.filter(keep);
      return { data: rows, error: null };
    };
    const api = {
      select: () => api,
      eq: (col, val) => { filters.push((r) => r[col] === val); return api; },
      in: (col, vals) => { filters.push((r) => vals.includes(r[col])); return api; },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; },
      then: (resolve) => resolve(run()),
    };
    return api;
  };
  return { from: builder };
}

(async () => {
  console.log("the ladder");
  const expected = [
    [0, 3000], [1, 3000], [2, 2500], [3, 2500], [4, 2000], [6, 1500],
    [8, 1000], [9, 1000], [10, 500], [11, 500], [50, 500],
  ];
  for (const [count, bps] of expected) {
    ok(fees.platformFeeBpsForGoodReviews(count) === bps, `${count} good reviews pays ${bps / 100}%`);
  }
  ok(fees.platformFeeBpsForGoodReviews(-3) === 3000, "a bad count stays at the top rate");
  ok(fees.goodReviewsToNextDrop(0) === 2 && fees.goodReviewsToNextDrop(1) === 1, "counts reviews to the next drop");
  ok(fees.goodReviewsToNextDrop(10) === 0, "nothing left to earn at 5%");
  let last = Infinity;
  for (let n = 0; n <= 20; n += 1) {
    const bps = fees.platformFeeBpsForGoodReviews(n);
    assert.ok(bps <= last);
    last = bps;
  }
  ok(true, "the rate never goes back up as reviews are added");

  console.log("the money");
  const first = fees.computeFees(24000, 3000);
  ok(first.platformFeeCents === 6900, "$240 at 30% is $69, with the first $10 exempt");
  ok(first.businessTotalCents === 24000, "the business still pays exactly the offer");
  ok(first.consultantPayoutCents === 24000 - 726 - 6900, "the payout is the offer minus both fees");
  ok(first.platformFeeBps === 3000, "the breakdown records the rate used");
  ok(fees.computeFees(24000, 500).platformFeeCents === 1150, "$240 at 5% is $11.50");
  ok(fees.computeFees(1000, 3000).platformFeeCents === 0, "a $10 offer has no platform fee");
  ok(fees.computeFees(1000, 3000).consultantPayoutCents === 941, "a $10 offer pays out $9.41");
  ok(fees.computeFees(1100, 3000).platformFeeCents === 30, "$11 at 30% is 30 cents, so there's no cliff");
  for (const bad of [undefined, null, 0, 1000.5, 499, 3500, "3000"]) {
    assert.throws(() => fees.computeFees(10000, bad), /Invalid platform fee rate/);
  }
  ok(true, "a missing or made-up rate throws instead of charging");

  console.log("what counts as a good review");
  ok(fees.isGoodReview(review("b", 4)), "exactly 4.0 counts");
  ok(!fees.isGoodReview(review("b", 3.5)), "3.5 doesn't count");
  ok(fees.isGoodReview({ ...review("b", 4), communication: 3, cost_value: 5 }), "it's the average that counts");
  ok(!fees.isGoodReview({ bid_id: "b" }), "a review with no scores doesn't count");

  console.log("counting paid work only");
  const me = "student";
  const paid = (id) => ({ id, payment_status: "released", payment_amount_cents: 5000 });
  const reviews = (rows) => rows.map((r) => ({ ...r, consultant_id: me }));
  let db = fakeSupabase({
    consultant_reviews: reviews([review("b1", 5), review("b2", 4), review("b3", 2), review("free", 5), review("held", 5)]),
    bids: [
      paid("b1"), paid("b2"), paid("b3"),
      { id: "free", payment_status: "released", payment_amount_cents: 0 },
      { id: "held", payment_status: "held", payment_amount_cents: 5000 },
    ],
    bid_phase_payments: [],
  });
  ok(await countGoodPaidReviews(db, me) === 2, "low scores, free jobs and unreleased payments are left out");

  db = fakeSupabase({
    consultant_reviews: reviews([review("retainer", 5), review("phased", 5)]),
    bids: [
      { id: "retainer", payment_status: "unpaid", payment_amount_cents: null },
      { id: "phased", payment_status: "unpaid", payment_amount_cents: null },
    ],
    bid_phase_payments: [
      { bid_id: "retainer", amount_cents: 20000, status: "released" },
      { bid_id: "phased", amount_cents: 20000, status: "held" },
    ],
  });
  ok(await countGoodPaidReviews(db, me) === 1, "a released retainer period counts, a held one doesn't");

  console.log("the rate for a student");
  const empty = { consultant_reviews: [], bids: [], bid_phase_payments: [], consultant_fee_rates: [] };
  let rate = await getConsultantFeeRate(fakeSupabase(empty), me);
  ok(rate.platformFeeBps === 3000 && rate.reviewsToNextDrop === 2, "a new student starts at 30%");

  const earned = {
    ...empty,
    consultant_reviews: reviews([review("a", 5), review("b", 5), review("c", 5)]),
    bids: [paid("a"), paid("b"), paid("c")],
  };
  rate = await getConsultantFeeRate(fakeSupabase(earned), me);
  ok(rate.platformFeeBps === 2500 && rate.goodReviews === 3, "3 good reviews pays 25%");

  const fixed = { ...empty, consultant_fee_rates: [{ consultant_id: me, platform_fee_bps: 500 }] };
  rate = await getConsultantFeeRate(fakeSupabase(fixed), me);
  ok(rate.platformFeeBps === 500 && rate.isFixedRate, "a student from before the ladder keeps 5%");

  const breakdown = await feesForConsultant(fakeSupabase(earned), me, 24000);
  ok(breakdown.platformFeeCents === 5750, "the charge uses the student's own rate");

  for (const table of ["consultant_fee_rates", "consultant_reviews", "bids", "bid_phase_payments"]) {
    await assert.rejects(() => feesForConsultant(fakeSupabase(earned, table), me, 24000));
  }
  ok(true, "a failed lookup stops the charge instead of guessing");
  await assert.rejects(() => getConsultantFeeRate(fakeSupabase(empty), null));
  ok(true, "no consultant means no rate");

  console.log("server and browser stay in sync");
  const strip = (src) => src
    .replace(/^\/\/.*$/gm, "")
    .replace(/^export /gm, "")
    .replace(/module\.exports = \{[\s\S]*?\};/, "")
    .replace(/function formatUsd[\s\S]*?\n\}\n/, "")
    .replace(/\s+/g, " ")
    .trim();
  const server = fs.readFileSync(path.join(__dirname, "../lib/fees.js"), "utf8");
  const browser = fs.readFileSync(path.join(__dirname, "../public/fees.js"), "utf8");
  ok(strip(server) === strip(browser), "lib/fees.js and public/fees.js hold the same math");

  console.log(`\n${pass} checks passed`);
})().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
