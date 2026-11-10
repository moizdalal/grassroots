// Tests for the platform fee model: node scripts/test-fees.js
// Runs without a database or Stripe.
//
// Model: the business pays the offer + 10% (5% launch rate on charges
// created before 2027-03-01 00:00 ET). The consultant gets the offer - 10%.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const fees = require("../lib/fees");

let pass = 0;
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  pass += 1;
  console.log("  ✓", msg);
};

const BEFORE = Date.parse("2026-12-01T12:00:00-05:00");
const LAST_MINUTE = Date.parse("2027-02-28T23:59:59-05:00");
const CUTOFF = Date.parse("2027-03-01T00:00:00-05:00");
const AFTER = Date.parse("2027-06-01T12:00:00-04:00");

(async () => {
  console.log("the rates");
  ok(fees.CONSULTANT_FEE_BPS === 1000, "the consultant fee is a flat 10%");
  ok(fees.BUSINESS_FEE_BPS === 1000, "the business list rate is 10%");
  ok(fees.LAUNCH_BUSINESS_FEE_BPS === 500, "the business launch rate is 5%");
  ok(fees.LAUNCH_ENDS_AT_MS === CUTOFF, "the launch rate ends at midnight Eastern on March 1, 2027");
  ok(fees.LAUNCH_ENDS_AT_MS === Date.parse("2027-03-01T05:00:00Z"), "which is 05:00 UTC, since March 1 is standard time");
  ok(fees.businessFeeBps(BEFORE) === 500 && fees.businessFeeBps(LAST_MINUTE) === 500, "charges before the cutoff get 5%");
  ok(fees.businessFeeBps(CUTOFF) === 1000 && fees.businessFeeBps(AFTER) === 1000, "charges on or after the cutoff get 10%");
  ok(fees.businessFeeBps(new Date(BEFORE)) === 500 && fees.businessFeeBps("2027-03-02T00:00:00Z") === 1000, "dates can be a Date, a number or a string");
  assert.throws(() => fees.businessFeeBps("not a date"), /Invalid fee date/);
  ok(true, "a bad date throws instead of guessing a rate");

  console.log("the money, before the cutoff");
  let f = fees.computeFees(10000, { at: BEFORE });
  ok(f.businessFeeCents === 500 && f.businessTotalCents === 10500, "$100 offer: the business pays $105");
  ok(f.platformFeeCents === 1000 && f.consultantPayoutCents === 9000, "$100 offer: the consultant gets $90");
  ok(f.businessFeeFullCents === 1000 && f.businessFeeDiscounted, "the list-rate fee is kept for the strikethrough");
  ok(f.businessFeeBps === 500 && f.consultantFeeBps === 1000, "the breakdown records both rates");
  ok(f.stripeFeeCents === Math.round(10500 * 0.029) + 30, "the card fee estimate is on the whole charge");
  ok(f.consultantPayoutCents === f.amountCents - f.platformFeeCents, "the card fee never comes out of the payout");

  console.log("the money, on and after the cutoff");
  f = fees.computeFees(10000, { at: CUTOFF });
  ok(f.businessFeeCents === 1000 && f.businessTotalCents === 11000, "$100 offer: the business pays $110");
  ok(f.consultantPayoutCents === 9000, "the consultant still gets $90");
  ok(!f.businessFeeDiscounted, "no discount to show");
  ok(fees.computeFees(10000, { at: AFTER }).businessTotalCents === 11000, "and it stays 10% after");

  console.log("rounding");
  // Half a cent rounds up, the same way on both sides.
  f = fees.computeFees(1010, { at: BEFORE });
  ok(f.businessFeeCents === 51 && f.businessTotalCents === 1061, "$10.10 at 5% is 50.5 cents, rounded up to 51");
  ok(f.platformFeeCents === 101 && f.consultantPayoutCents === 909, "$10.10 at 10% is $1.01");
  f = fees.computeFees(1005, { at: AFTER });
  ok(f.businessFeeCents === 101 && f.platformFeeCents === 101 && f.consultantPayoutCents === 904, "$10.05 at 10% is 100.5 cents, rounded up to $1.01");
  f = fees.computeFees(1000, { at: BEFORE });
  ok(f.businessTotalCents === 1050 && f.consultantPayoutCents === 900, "a $10 offer: $10.50 charged, $9 paid out, no fee-free first $10");
  for (let cents = 1000; cents <= 200000; cents += 137) {
    for (const at of [BEFORE, AFTER]) {
      const x = fees.computeFees(cents, { at });
      assert.ok(Number.isInteger(x.businessFeeCents) && Number.isInteger(x.platformFeeCents) && Number.isInteger(x.consultantPayoutCents));
      assert.strictEqual(x.businessTotalCents, cents + x.businessFeeCents);
      assert.strictEqual(x.consultantPayoutCents + x.platformFeeCents, cents);
      // What the business paid covers the payout plus both fees exactly.
      assert.strictEqual(x.businessTotalCents, x.consultantPayoutCents + x.platformFeeCents + x.businessFeeCents);
      assert.ok(x.businessFeeCents + x.platformFeeCents > x.stripeFeeCents, "grassroots' fees cover the card fee");
    }
  }
  ok(true, "every amount is whole cents and the charge splits exactly into payout + both fees");
  ok(true, "both fees together always cover Stripe's card fee from $10 up");

  console.log("free and minimum offers");
  f = fees.computeFees(0, { at: BEFORE });
  ok(f.businessTotalCents === 0 && f.consultantPayoutCents === 0 && f.stripeFeeCents === 0, "a free offer charges nothing");
  ok(fees.isValidOfferCents(0) && fees.isValidOfferCents(1000) && !fees.isValidOfferCents(999) && !fees.isValidOfferCents(1000.5), "offers are $0 or at least $10, in whole cents");
  ok(fees.businessTotalCents(10000, BEFORE) === 10500 && fees.businessTotalCents(10000, AFTER) === 11000, "businessTotalCents uses the charge date");
  ok(fees.consultantFeeCents(24000) === 2400, "$240 offer: a $24 consultant fee");

  console.log("nothing from the old models is left");
  for (const gone of ["FEE_LADDER_BPS", "EXISTING_STUDENT_FEE_BPS", "PLATFORM_FEE_EXEMPT_CENTS", "platformFeeBpsForGoodReviews", "isGoodReview", "PLATFORM_FEE_BPS"]) {
    assert.strictEqual(fees[gone], undefined, gone);
  }
  ok(true, "no ladder, no fee-free first $10, no review-based rates");
  ok(!fs.existsSync(path.join(__dirname, "../lib/consultant-fee.js")), "lib/consultant-fee.js is gone");
  ok(!fs.existsSync(path.join(__dirname, "../supabase/migrations/add_consultant_fee_rates.sql")), "the fixed-rate table migration is gone");

  console.log("server and browser stay in sync");
  const strip = (src) => src
    .replace(/^\/\/.*$/gm, "")
    .replace(/^export /gm, "")
    .replace(/module\.exports = \{[\s\S]*?\};/, "")
    .replace(/function formatUsd[\s\S]*?\n\}\n/, "")
    .replace(/function formatBps[\s\S]*?\n\}\n/, "")
    .replace(/\s+/g, " ")
    .trim();
  const server = fs.readFileSync(path.join(__dirname, "../lib/fees.js"), "utf8");
  const browserSrc = fs.readFileSync(path.join(__dirname, "../public/fees.js"), "utf8");
  ok(strip(server) === strip(browserSrc), "lib/fees.js and public/fees.js hold the same math");

  // public/fees.js is an ES module in a CommonJS package, so load it from
  // its source text.
  const browser = await import(`data:text/javascript,${encodeURIComponent(browserSrc)}`);
  let same = true;
  for (let cents = 0; cents <= 50000; cents += 333) {
    for (const at of [BEFORE, LAST_MINUTE, CUTOFF, AFTER]) {
      const a = fees.computeFees(cents, { at });
      const b = browser.computeFees(cents, { at });
      if (JSON.stringify(a) !== JSON.stringify(b)) same = false;
    }
  }
  ok(same, "server and browser give the same breakdown for every amount and date");
  ok(browser.formatBps(500) === "5%" && browser.formatBps(1000) === "10%", "the browser formats rates as 5% and 10%");

  console.log(`\n${pass} checks passed`);
})().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
