// garden-data.js — fetches completed engagements for the owner's
// "your garden" visual. One root node per completed engagement.
//
// Definition of "completed" (locked in at iter 1): funds have been
// released AND the owner has submitted a consultant review. Both
// signals together so we don't flag engagements where money moved
// but the work was disputed, or where a review came in before the
// money was released.
//
// Returns: Array<{
//   bidId, listingId, listingTitle, consultantName,
//   amountCents, releasedAt
// }> — newest first.

export async function loadCompletedEngagements(client, ownerId) {
  if (!client || !ownerId) return [];

  // Owner's listings — needed to scope the bid query.
  const { data: listings, error: lErr } = await client
    .from("listings")
    .select("id, title")
    .eq("owner_id", ownerId);
  if (lErr || !listings?.length) return [];

  const listingIds = listings.map((l) => l.id);
  const titleByListing = Object.fromEntries(listings.map((l) => [l.id, l.title]));

  // Released bids on those listings. payment_status='released' is the
  // single source of truth for "money moved" across all contract
  // shapes (standard / phased / retainer) — phased + retainer flip
  // the parent bid to released once all sub-payments are out.
  const { data: bids, error: bErr } = await client
    .from("bids")
    .select("id, listing_id, consultant_id, amount_cents, released_at, payment_status")
    .in("listing_id", listingIds)
    .eq("payment_status", "released");
  if (bErr || !bids?.length) return [];

  const bidIds = bids.map((b) => b.id);
  const consultantIds = [...new Set(bids.map((b) => b.consultant_id).filter(Boolean))];

  // Reviews + consultant profiles — fetch in parallel.
  const [reviewsRes, consultantsRes] = await Promise.all([
    client.from("consultant_reviews").select("bid_id").in("bid_id", bidIds),
    consultantIds.length
      ? client.from("profiles").select("id, full_name").in("id", consultantIds)
      : Promise.resolve({ data: [] }),
  ]);

  const reviewedBids = new Set((reviewsRes.data || []).map((r) => r.bid_id));
  const consultantNameById = Object.fromEntries(
    (consultantsRes.data || []).map((p) => [p.id, p.full_name]),
  );

  return bids
    .filter((b) => reviewedBids.has(b.id))
    .map((b) => ({
      bidId: b.id,
      listingId: b.listing_id,
      listingTitle: titleByListing[b.listing_id] || "untitled listing",
      consultantName: consultantNameById[b.consultant_id] || "the consultant",
      amountCents: b.amount_cents || 0,
      releasedAt: b.released_at,
    }))
    .sort((a, b) => new Date(b.releasedAt || 0) - new Date(a.releasedAt || 0));
}
