// engagement-stage.js — the pure rules that turn a consultant's offer
// (bid + listing + schedule) into a lifecycle stage, a pending action
// and a status line. No drawing code in here, so the dashboard table
// can use it without loading the flower art; the garden and the flower
// journey share the same rules.

// Map (bid, listing, schedule) → integer stage 1..5. Order matters:
// payout-released takes precedence over schedule signals (a refunded
// engagement should *not* read as paid even if the schedule says
// completed), and schedule signals take precedence over bid-status
// because the schedule moves through its own lifecycle independently.
export function detectFlowerStage(bid, _listing, schedule) {
  if (bid?.payment_status === "released") return 5;
  if (schedule?.status === "completed") return 4;
  if (schedule?.status === "scheduled") return 3;
  if (bid?.status === "accepted") return 2;
  return 1; // pending / submitted / countered — still a seed
}

// An engagement is "premature" if it ended without the consultant
// being paid. We treat any of these as premature:
//   - bid was rejected / withdrawn / declined
//   - payment was refunded
//   - listing was completed or removed while this bid was never
//     accepted (a locked listing can still accept pending offers)
// A bid whose payment_status is "released" is the terminal happy
// path — once paid, it permanently claims its species slot.
export function isPremature(bid, listing, _schedule) {
  if (!bid) return true;
  if (bid.payment_status === "released") return false;
  if (bid.payment_status === "refunded") return true;
  if (["rejected", "withdrawn", "declined"].includes(bid.status)) return true;
  if (["completed", "unlisted"].includes(listing?.status) && bid.status !== "accepted") return true;
  return false;
}

// Detect what's waiting on the consultant. Used for the pulsing
// action dot at the plant apex.
export function detectAction(bid, listing, schedule) {
  // Finished work never nags: once the payout is released (or the
  // listing is completed) a stale schedule row is history, not a to-do.
  if (bid?.payment_status === "released" || listing?.status === "completed") return null;
  // Active owner counter awaiting the consultant's response. Takes
  // priority over kickoff scheduling since the bid hasn't been
  // accepted yet — there's nothing to schedule.
  if (
    bid?.status === "countered" &&
    bid?.counter_offer_cents != null &&
    !bid?.counter_responded_at
  ) {
    return {
      title: "Respond to the business's counter",
      href: `/listing.html?id=${bid.listing_id}`,
    };
  }
  if (schedule?.status === "awaiting_consultant") {
    return { title: "Pick a kickoff time", href: `/engagement.html?bid=${bid.id}` };
  }
  return null;
}

// Short human-readable label for the current lifecycle state — fills
// the tooltip's status line so the user doesn't have to read the
// plant's growth to know what's happening.
export function detectStatus(stage, action, schedule, _listing) {
  if (action) return action.title;
  if (stage === 5) return "Payout received";
  if (stage === 4) return "Work delivered, awaiting payout";
  if (stage === 3) return "Kickoff scheduled";
  if (stage === 2) {
    if (schedule?.status === "awaiting_owner") return "Awaiting business availability";
    return "Offer accepted — kickoff coming soon";
  }
  return "Offer submitted — awaiting business response";
}
