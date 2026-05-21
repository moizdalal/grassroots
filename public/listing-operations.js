// listing-operations.js
// Owner-side destructive / state-shifting operations on a listing.
//
// Two flows:
//   deleteListing(client, listingId)       — permanent removal
//   convertListingToDraft(client, listingId) — unpublish + reopen as draft
//
// Both refuse when the listing has an accepted bid; once an engagement
// is locked in, owners must close (not delete / re-draft) the listing
// so the audit trail and the consultant-side state stay coherent.
//
// FK cascade (declared at schema level) handles bids, listing_views,
// messages, schedules, engagement_reviews, messaging_read_state when
// the listing row goes away. Storage objects (attachment bucket) are
// NOT cascade-deleted by Postgres — we sweep them up best-effort.

const ATTACHMENT_BUCKET = "listing-attachments";

class ListingOperationError extends Error {
  constructor(message, { code = "operation_failed" } = {}) {
    super(message);
    this.name = "ListingOperationError";
    this.code = code;
  }
}

async function loadOwnedListing(client, listingId) {
  const { data: userData } = await client.auth.getUser();
  const ownerId = userData?.user?.id;
  if (!ownerId) {
    throw new ListingOperationError("sign in to manage this listing.", { code: "not_signed_in" });
  }

  // Only select columns guaranteed to exist on the listings table.
  // The `attachments` column is feature-flagged behind an unapplied
  // migration, so we don't ask for it here; deleteListing handles
  // storage cleanup separately (best-effort, no-op if absent).
  const { data: listing, error } = await client
    .from("listings")
    .select("id, owner_id, status, draft_form")
    .eq("id", listingId)
    .maybeSingle();

  if (error) throw new ListingOperationError(error.message || "could not load the listing.");
  if (!listing) throw new ListingOperationError("we couldn't find that listing.", { code: "not_found" });
  if (listing.owner_id !== ownerId) {
    throw new ListingOperationError("only the owner can do that.", { code: "forbidden" });
  }
  return { listing, ownerId };
}

async function hasAcceptedBid(client, listingId) {
  const { data, error } = await client
    .from("bids")
    .select("id")
    .eq("listing_id", listingId)
    .eq("status", "accepted")
    .limit(1);
  if (error) return false; // soft fail — RLS prevents owner reading bids they shouldn't see anyway
  return Array.isArray(data) && data.length > 0;
}

async function removeAttachmentsBestEffort(client, listingId) {
  // We don't have a column tracking attachments yet, so the best we
  // can do is sweep storage objects under a path prefixed by the
  // listing id and hope upload paths followed the convention. If the
  // bucket isn't set up or there's nothing to remove, fail silent —
  // a stray object isn't user-visible and shouldn't block the delete.
  if (!listingId) return;
  try {
    const { data: files } = await client.storage
      .from(ATTACHMENT_BUCKET)
      .list(listingId, { limit: 100 });
    const paths = (files || []).map((f) => `${listingId}/${f.name}`);
    if (paths.length) await client.storage.from(ATTACHMENT_BUCKET).remove(paths);
  } catch (_) { /* best-effort */ }
}

/* ============================================================== */
/*                      DELETE                                     */
/* ============================================================== */

// Drafts are the only listings the owner can permanently delete. A
// published listing carries a paper trail (consultant views, offers,
// messages, possibly an accepted engagement) that we don't want
// disappearing under anyone's feet — owners pause or close those
// instead. Restricting delete to drafts also makes the action
// reasoning easy to explain in the UI: "drafts are the only thing
// you can delete."
export async function deleteListing(client, listingId) {
  const { listing } = await loadOwnedListing(client, listingId);

  if (listing.status !== "draft") {
    throw new ListingOperationError(
      "only drafts can be deleted. close this listing from the listing controls if you're done with it.",
      { code: "not_a_draft" }
    );
  }

  await removeAttachmentsBestEffort(client, listingId);

  const { error } = await client.from("listings").delete().eq("id", listingId);
  if (error) {
    // Common cause: missing RLS delete policy. Surface the underlying
    // message so the user sees something actionable instead of a
    // silent "deleted 0 rows".
    throw new ListingOperationError(error.message || "could not delete the draft.");
  }
  return { id: listingId };
}

/* ============================================================== */
/*                  CONVERT TO DRAFT                                */
/* ============================================================== */

// create-listing.js writes a draft_form snapshot at publish time, so
// in the common case we just flip status back to 'draft' and the
// wizard's hydrate path picks up the snapshot exactly as the user
// last filled it in. For legacy listings that were published before
// the snapshot-on-publish change, draft_form will be null and the
// wizard hydrate will start from a blank form — better than refusing
// the action entirely.
export async function convertListingToDraft(client, listingId) {
  const { listing } = await loadOwnedListing(client, listingId);

  if (listing.status === "draft") {
    return { id: listingId, alreadyDraft: true };
  }
  if (await hasAcceptedBid(client, listingId)) {
    throw new ListingOperationError(
      "this listing has an accepted offer — unpublishing it would strand an active engagement.",
      { code: "has_engagement" }
    );
  }

  const { error } = await client
    .from("listings")
    .update({ status: "draft" })
    .eq("id", listingId);
  if (error) {
    throw new ListingOperationError(error.message || "could not unpublish the listing.");
  }
  return { id: listingId };
}

export { ListingOperationError };
