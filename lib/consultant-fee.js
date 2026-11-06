// Works out a consultant's platform fee rate on the server. Charges and the
// fee shown to the consultant both come from here, so they always agree.
//
// Errors are thrown, never swallowed: charging a guessed fee is worse than a
// failed request that can be retried.

const fees = require("./fees");

// Only paid work counts, or free jobs could be used to earn a lower fee. A
// bid is paid once it has released money, directly or through a released
// phase or retainer period.
async function countGoodPaidReviews(supabase, consultantId) {
  const { data: reviews, error: reviewsErr } = await supabase
    .from("consultant_reviews")
    .select("bid_id, work_product_quality, communication, timeliness, professionalism, cost_value")
    .eq("consultant_id", consultantId);
  if (reviewsErr) throw new Error(`Could not read reviews: ${reviewsErr.message}`);

  const goodBidIds = (reviews || []).filter(fees.isGoodReview).map((r) => r.bid_id);
  if (!goodBidIds.length) return 0;

  const { data: bids, error: bidsErr } = await supabase
    .from("bids")
    .select("id, payment_status, payment_amount_cents")
    .in("id", goodBidIds);
  if (bidsErr) throw new Error(`Could not read bids: ${bidsErr.message}`);

  const { data: phases, error: phasesErr } = await supabase
    .from("bid_phase_payments")
    .select("bid_id, amount_cents, status")
    .in("bid_id", goodBidIds);
  if (phasesErr) throw new Error(`Could not read phase payments: ${phasesErr.message}`);

  const paidBidIds = new Set();
  for (const b of bids || []) {
    if (b.payment_status === "released" && Number(b.payment_amount_cents) > 0) paidBidIds.add(b.id);
  }
  for (const p of phases || []) {
    if (p.status === "released" && Number(p.amount_cents) > 0) paidBidIds.add(p.bid_id);
  }
  return goodBidIds.filter((id) => paidBidIds.has(id)).length;
}

async function getConsultantFeeRate(supabase, consultantId) {
  if (!consultantId) throw new Error("A consultant is required to work out the platform fee.");

  const { data: fixed, error: fixedErr } = await supabase
    .from("consultant_fee_rates")
    .select("platform_fee_bps")
    .eq("consultant_id", consultantId)
    .maybeSingle();
  if (fixedErr) throw new Error(`Could not read the fee rate: ${fixedErr.message}`);

  const goodReviews = await countGoodPaidReviews(supabase, consultantId);
  const ladderBps = fees.platformFeeBpsForGoodReviews(goodReviews);
  // A fixed rate can only help: whichever is lower wins.
  const platformFeeBps = fixed ? Math.min(Number(fixed.platform_fee_bps), ladderBps) : ladderBps;

  return {
    platformFeeBps,
    goodReviews,
    reviewsToNextDrop: fixed ? 0 : fees.goodReviewsToNextDrop(goodReviews),
    isFixedRate: Boolean(fixed),
  };
}

// The fee breakdown for one payment to one consultant.
async function feesForConsultant(supabase, consultantId, amountCents) {
  const { platformFeeBps } = await getConsultantFeeRate(supabase, consultantId);
  return fees.computeFees(amountCents, platformFeeBps);
}

module.exports = { countGoodPaidReviews, getConsultantFeeRate, feesForConsultant };
