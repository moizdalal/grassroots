import { getSupabaseClient } from "/supabase-loader.js";
import { formatBudgetRange, parseBudgetRange } from "/sim-budget.js";
import { renderRatingMarkup, hydrateRatings } from "/rating.js";
// payment-modal pulls Stripe.js on demand and is only needed when the
// owner clicks accept/pay. Defer the fetch until a click happens.
let _paymentModalPromise = null;
function loadPaymentModal() {
  if (!_paymentModalPromise) _paymentModalPromise = import("/payment-modal.js");
  return _paymentModalPromise;
}
async function payAndAcceptBid(...args) {
  const m = await loadPaymentModal();
  return m.payAndAcceptBid(...args);
}
async function payAndAcceptProposals(...args) {
  const m = await loadPaymentModal();
  return m.payAndAcceptProposals(...args);
}
import { computeFees, formatUsd, isValidOfferCents, MIN_PAID_OFFER_CENTS, LAUNCH_PLATFORM_FEE_BPS, PLATFORM_FEE_BPS } from "/fees.js";
import { getInitials } from "/initials.js";
import {
  trackListingView,
  loadListingAnalytics,
  renderAnalyticsPanel,
} from "/listing-analytics.js";
import { showToast, showSuccess, showError, showLoading, flashToast } from "/toast.js";
import { confirmDialog } from "/confirm-modal.js";
import { isGuest, setGuestMode, clearGuestModeIfSignedIn } from "/guest-mode.js";
import { loadBusinessBadges, renderBadgeBlock } from "/business-badges.js";

const gate = document.getElementById("listing-gate");
const detail = document.getElementById("listing-detail");
const layout = document.querySelector(".ld-layout");
const ownerSidebar = document.getElementById("ld-sidebar");
const offerRail = document.getElementById("ld-offer-rail");
const ownerActionsPanel = document.getElementById("ld-owner-actions");
const ownerActionsCopy = document.getElementById("ld-owner-actions-copy");
const pauseListingBtn = document.getElementById("ld-pause-listing-btn");
const closeListingBtn = document.getElementById("ld-close-listing-btn");
const statusForm = document.getElementById("ld-status-form");
const statusFormTitle = document.getElementById("ld-status-form-title");
const statusOtherWrap = document.getElementById("ld-status-other-wrap");
const statusOtherInput = document.getElementById("ld-status-other-input");
const statusSubmitBtn = document.getElementById("ld-status-submit-btn");
const statusCancelBtn = document.getElementById("ld-status-cancel-btn");
const ownerActionStatus = document.getElementById("ld-owner-action-status");
const statusFormIntro = document.getElementById("ld-status-form-intro");
const statusOffersFieldset = document.getElementById("ld-status-offers");
const workCompletedOption = document.getElementById("ld-status-option-work-completed");

const STATUS_REASON_LABELS = {
  work_completed: "Work completed",
  found_solution_elsewhere: "Found a solution elsewhere",
  didnt_find_good_offer: "Didn't find a good offer",
  other: "Other",
};

// Bid statuses that still represent an offer the owner could decline.
// Accepted bids belong to a live engagement — leaving them alone is the
// only safe behavior when the listing is being closed.
const PENDING_BID_STATUSES = new Set(["pending", "submitted", "countered"]);

let pendingListingStatusAction = null;
// Cached on the owner side once bids load (see loadOwnerBids call site)
// so the close-form can read pending + accepted counts without a refetch.
let cachedOwnerBids = [];

/* ================================================================
   Utility helpers
   ================================================================ */

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} b`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function engagementLink(bidId) {
  return `/engagement.html?bid=${bidId}`;
}

function relativeDate(iso) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff < 1) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 30) return `${diff} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isMissing(error) {
  if (!error) return false;
  const m = (error.message || "").toLowerCase();
  return m.includes("schema cache") || m.includes("does not exist") || m.includes("could not find");
}

function publicAvatarUrl(client, path) {
  if (!path) return null;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

const PITCH_MAX_CHARS = 1000;
const PITCH_MAX_FILES = 3;
const PITCH_MAX_FILE_BYTES = 10 * 1024 * 1024;

function getListingId() {
  return new URLSearchParams(window.location.search).get("id");
}

/* ================================================================
   Manage-link label resolver. After a bid is accepted, the "manage
   ongoing work" button used to be a vague catch-all that ferried
   both parties to /engagement.html no matter what state the
   engagement was actually in. This helper queries the schedule for
   the bid and returns an explicit label tied to the next step:
     • no schedule yet     → "share kickoff availability" (owner)
                             "schedule the kickoff" (consultant)
     • awaiting_owner       → owner: "share kickoff availability"
                              consultant: "view kickoff status"
     • awaiting_consultant  → owner: "view kickoff status"
                              consultant: "pick your kickoff time"
     • scheduled            → "view engagement"
     • completed            → "view engagement"
   ================================================================ */
async function resolveManageLinkLabel(client, bidId, viewerRole) {
  let scheduleStatus = null;
  try {
    const { data } = await client
      .from("engagement_schedules")
      .select("status")
      .eq("bid_id", bidId)
      .maybeSingle();
    scheduleStatus = data?.status || null;
  } catch (_) {}
  // Owner-side defaults vs consultant-side defaults — both follow the
  // same schedule states but read them from opposite seats. `hide: true`
  // means the engagement page has nothing actionable for this viewer
  // yet — the call site drops the CTA entirely so it doesn't look
  // like it leads somewhere useful.
  const isOwner = viewerRole === "owner";
  if (!scheduleStatus || scheduleStatus === "awaiting_owner") {
    if (isOwner) return { label: "Share kickoff availability" };
    // Consultant: nothing for them to act on until the owner shares
    // availability. Hide the CTA so it doesn't dead-end, and surface a
    // notice via `awaiting` so the call site can explain the wait.
    return { hide: true, awaiting: "owner" };
  }
  if (scheduleStatus === "awaiting_consultant") {
    if (isOwner) {
      // Owner already shared availability — the ball is in the
      // consultant's court. Drop the primary-CTA pressure and surface
      // a quieter "manage" link instead. `quiet: true` tells the
      // caller to render the link as a ghost button (no fill).
      return { label: "Manage", quiet: true, awaiting: "consultant" };
    }
    return { label: "Pick your kickoff time" };
  }
  return { label: "View engagement" };
}

/* ================================================================
   Consultant-side counter response panel. Renders inside the
   `.ld-offer-panel` when the consultant's bid sits in `countered`
   status with an active counter. Three actions:
     - accept counter   → bid.amount_cents updates to counter price,
                          status → pending, counter cleared (the owner
                          now sees a normal pending bid at the new
                          price they can accept).
     - decline counter  → counter cleared, status → pending, original
                          amount stays. Same effect as 24h expiry.
     - optional message → stored in counter_response_message and
                          included in the owner-facing notification.
   ================================================================ */
function fmtCounterDeadline(iso) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "Expired";
  const hours = Math.round(ms / 3600000);
  if (hours >= 24) return `${hours} hours left`;
  if (hours >= 1) return `${hours} ${hours === 1 ? "hour" : "hours"} left`;
  const minutes = Math.max(1, Math.round(ms / 60000));
  return `${minutes} ${minutes === 1 ? "minute" : "minutes"} left`;
}

function renderConsultantCounterPanel(client, listing, bid) {
  const root = document.getElementById("ld-counter-response");
  if (!root) return;
  const counter = bid.counter_offer_cents;
  const counterMsg = bid.counter_offer_message;
  const deadline = fmtCounterDeadline(bid.counter_expires_at);
  root.hidden = false;
  root.innerHTML = `
    <p class="ld-counter-response__eyebrow">Counter from the business</p>
    <p class="ld-counter-response__amount">
      <strong>${formatUsd(counter)}</strong>
      <span class="ld-counter-response__delta">was ${formatUsd(bid.amount_cents)}</span>
    </p>
    ${counterMsg ? `<p class="ld-counter-response__msg">"${escapeHtml(counterMsg)}"</p>` : ""}
    <p class="ld-counter-response__deadline">${escapeHtml(deadline)} to respond</p>
    <label class="gr-label full-width">
      <span>Your reply (optional)</span>
      <textarea class="ld-counter-response__textarea" rows="2" maxlength="500" placeholder="Add a note for the business…"></textarea>
    </label>
    <div class="ld-counter-response__actions">
      <button type="button" class="gr-btn gr-btn--ghost gr-btn--sm ld-counter-response__decline" data-counter-action="decline">Decline counter</button>
      <button type="button" class="gr-btn gr-btn--primary gr-btn--sm" data-counter-action="accept">Accept counter</button>
    </div>
    <p class="gr-status ld-counter-response__status" aria-live="polite"></p>
  `;
  const statusEl = root.querySelector(".ld-counter-response__status");
  const textarea = root.querySelector(".ld-counter-response__textarea");

  async function respond(action) {
    // Decline has two paths: "keep" the original offer on the table
    // (the safe / common case), or "rescind" the bid entirely so the
    // business can't accept anything. Confirm modal makes the choice
    // explicit before anything writes.
    if (action === "decline") {
      const choice = await openConfirmModal({
        title: "Decline this counter?",
        body: [
          "You have two options for what happens to your original offer.",
        ],
        actions: [
          { label: "Cancel", kind: "ghost", value: "cancel" },
          { label: "Rescind offer", kind: "danger", value: "rescind" },
          { label: `Keep at ${formatUsd(bid.amount_cents)}`, kind: "primary", value: "keep" },
        ],
      });
      if (choice === "cancel" || !choice || choice === "confirm") return;
      action = choice; // "keep" or "rescind"
    }

    const buttons = root.querySelectorAll("button[data-counter-action]");
    buttons.forEach((b) => (b.disabled = true));
    const responseMsg = textarea.value.trim() || null;
    const now = new Date().toISOString();
    const loadingCopy =
      action === "accept" ? "Accepting counter…" :
      action === "rescind" ? "Rescinding offer…" :
      "Declining counter…";
    const loader = showLoading(loadingCopy);
    try {
      if (action === "accept") {
        // The counter becomes the new agreed-upon price. amount_cents
        // updates so the owner — when they finally hit accept — pays
        // the countered amount (and our handleAcceptBid always reads
        // amount_cents). Status returns to pending so the owner sees
        // a normal acceptable bid.
        const { error } = await client
          .from("bids")
          .update({
            status: "pending",
            amount_cents: counter,
            counter_offer_cents: null,
            counter_offer_message: null,
            counter_expires_at: null,
            counter_responded_at: now,
            counter_response_message: responseMsg,
          })
          .eq("id", bid.id);
        if (error) throw error;
        await client.from("notifications").insert({
          user_id: listing.owner_id,
          type: "counter_accepted",
          title: "Counter accepted",
          body: `The consultant accepted your ${formatUsd(counter)} counter on "${listing.title}". You can finalize the deal now.`,
          link: `/listing.html?id=${listing.id}`,
        });
        statusEl.textContent = "Accepted. The business can now finalize.";
        statusEl.className = "gr-status ld-counter-response__status success";
      } else if (action === "rescind") {
        // Consultant withdraws their bid entirely. Status flips to
        // 'declined' (same end state as an owner-decline — bid is
        // out of the negotiation) with declined_at + counter response
        // captured so the owner can see what happened.
        const { error } = await client
          .from("bids")
          .update({
            status: "declined",
            declined_at: now,
            counter_offer_cents: null,
            counter_offer_message: null,
            counter_expires_at: null,
            counter_responded_at: now,
            counter_response_message: responseMsg,
          })
          .eq("id", bid.id);
        if (error) throw error;
        await client.from("notifications").insert({
          user_id: listing.owner_id,
          type: "bid_withdrawn",
          title: "Consultant rescinded their offer",
          body: `The consultant withdrew their offer on "${listing.title}" after your counter.`,
          link: `/listing.html?id=${listing.id}`,
        });
        statusEl.textContent = "Offer rescinded.";
        statusEl.className = "gr-status ld-counter-response__status success";
      } else {
        // "keep" — drop the counter, keep the original offer on the table.
        const { error } = await client
          .from("bids")
          .update({
            status: "pending",
            counter_offer_cents: null,
            counter_offer_message: null,
            counter_expires_at: null,
            counter_responded_at: now,
            counter_response_message: responseMsg,
          })
          .eq("id", bid.id);
        if (error) throw error;
        await client.from("notifications").insert({
          user_id: listing.owner_id,
          type: "counter_declined",
          title: "Counter declined",
          body: `The consultant declined your counter on "${listing.title}". Their original ${formatUsd(bid.amount_cents)} offer is back on the table.`,
          link: `/listing.html?id=${listing.id}`,
        });
        statusEl.textContent = "Counter declined. Your original offer is back on the table.";
        statusEl.className = "gr-status ld-counter-response__status success";
      }
      // Replace the persistent yellow loader with a green confirmation
      // toast and update the offer card in place (no full reload, so
      // the page-loader overlay never reappears).
      loader.dismiss();
      const successCopy =
        action === "accept" ? "Counter accepted — the business can finalize now." :
        action === "rescind" ? "Offer rescinded." :
        "Counter declined. Your original offer is back on the table.";
      showSuccess(successCopy);
      // Re-render the panel based on the new bid state. The simplest
      // path is to hide the counter response and update the existing-
      // offer copy + state badge. Reload as a last-resort fallback if
      // the DOM nodes are gone.
      try {
        root.hidden = true;
        const existingEl = document.getElementById("ld-bid-existing");
        if (existingEl) {
          if (action === "rescind") {
            // Bid is now declined — the offer-submitted card no longer
            // applies. Drop the right-rail offer panel entirely.
            const offerPanel = document.getElementById("ld-offer-panel");
            if (offerPanel) offerPanel.hidden = true;
          } else {
            // Mirror the update locally. The pre-counter price is known
            // here even before add_bid_original_amount.sql is applied.
            if (bid.original_amount_cents == null) bid.original_amount_cents = bid.amount_cents;
            if (action === "accept") bid.amount_cents = counter;
            bid.status = "pending";
            bid.counter_offer_cents = null;
            bid.counter_responded_at = now;
            existingEl.innerHTML = offerSummaryHtml(bid, listing);
          }
        }
      } catch (_) {
        // Fall back to a reload if in-place mutation throws — the
        // toast will be lost, but the data state still reflects truth.
        setTimeout(() => window.location.reload(), 900);
      }
    } catch (err) {
      loader.dismiss();
      showError(err?.message || "Could not send response.");
      statusEl.textContent = err?.message || "Could not send response.";
      statusEl.className = "gr-status ld-counter-response__status error";
      buttons.forEach((b) => (b.disabled = false));
    }
  }

  root.querySelectorAll("button[data-counter-action]").forEach((btn) => {
    btn.addEventListener("click", () => respond(btn.dataset.counterAction));
  });
}

/* ================================================================
   Confirm modal — shared helper. Resolves with:
     "confirm"   → primary button clicked
     "secondary" → optional alt button clicked (e.g. "counter instead")
     "cancel"    → backdrop / esc / cancel button
   `actions` is an ordered list of {label, kind, value}. `kind` is one
   of "primary" | "secondary" | "ghost" | "danger" and maps to the
   shared button classes.
   ================================================================ */
function openConfirmModal({ title, body, actions = [] }) {
  return new Promise((resolve) => {
    const root = document.getElementById("ld-modal");
    if (!root) { resolve("cancel"); return; }
    const titleEl = document.getElementById("ld-modal-title");
    const bodyEl = document.getElementById("ld-modal-body");
    const actionsEl = document.getElementById("ld-modal-actions");
    titleEl.textContent = title || "";
    if (Array.isArray(body)) {
      bodyEl.innerHTML = body
        .map((line) => `<span class="ld-modal__line">${escapeHtml(line)}</span>`)
        .join("");
    } else {
      bodyEl.textContent = body || "";
    }
    actionsEl.innerHTML = "";
    actions.forEach((a) => {
      const btn = document.createElement("button");
      const kind = a.kind || "primary";
      btn.type = "button";
      btn.className = `gr-btn gr-btn--${kind} gr-btn--sm ld-modal__btn`;
      btn.textContent = a.label;
      btn.addEventListener("click", () => close(a.value || "confirm"));
      actionsEl.appendChild(btn);
    });

    function close(value) {
      root.hidden = true;
      root.setAttribute("aria-hidden", "true");
      document.body.classList.remove("ld-modal-open");
      document.removeEventListener("keydown", onKey);
      root.querySelector(".ld-modal__backdrop")?.removeEventListener("click", onBackdrop);
      resolve(value);
    }
    function onKey(e) { if (e.key === "Escape") close("cancel"); }
    function onBackdrop() { close("cancel"); }

    root.hidden = false;
    root.setAttribute("aria-hidden", "false");
    document.body.classList.add("ld-modal-open");
    document.addEventListener("keydown", onKey);
    root.querySelector(".ld-modal__backdrop")?.addEventListener("click", onBackdrop);
  });
}

/* ================================================================
   Counter-offer 24h expiration sweep. Runs once per page load —
   any bid where the counter has elapsed gets reverted client-side:
   status returns to 'pending', counter fields cleared,
   counter_attempted stays true so the owner can't counter again.
   Also fires a notification to the owner. Mutates each affected
   bid object in place so the calling render sees the new state.
   ================================================================ */
async function sweepExpiredCounters(client, bids, listing) {
  if (!Array.isArray(bids) || !bids.length) return;
  const now = Date.now();
  const expired = bids.filter(
    (b) =>
      b.status === "countered" &&
      b.counter_expires_at &&
      new Date(b.counter_expires_at).getTime() < now
  );
  if (!expired.length) return;
  await Promise.all(
    expired.map(async (b) => {
      const { error } = await client
        .from("bids")
        .update({
          status: "pending",
          counter_offer_cents: null,
          counter_offer_message: null,
          counter_expires_at: null,
          // counter_attempted intentionally LEFT true so the owner
          // can't try again on this bid.
        })
        .eq("id", b.id);
      if (error) return;
      // Mirror in-place so the calling render sees the revert without
      // a second fetch.
      b.status = "pending";
      b.counter_offer_cents = null;
      b.counter_offer_message = null;
      b.counter_expires_at = null;
      try {
        await client.from("notifications").insert({
          user_id: listing.owner_id,
          type: "counter_expired",
          title: "Counter expired",
          body: `Your counter on "${listing.title}" expired without a response — the offer is back to the original price.`,
          link: `/listing.html?id=${listing.id}`,
        });
      } catch (_) {}
    })
  );
}

/* ================================================================
   Data loaders
   ================================================================ */

async function loadListing(client, id) {
  // `*` instead of a column list: optional columns (attachments,
  // status_reason, …) come back when their migration is applied and are
  // simply absent when it isn't, so one request covers both schemas.
  const { data, error } = await client
    .from("listings")
    .select("*, profiles!listings_owner_id_fkey ( id, full_name, linkedin_url, avatar_path )")
    .eq("id", id)
    .maybeSingle();

  if (error) return { listing: null, error };

  // Attachments live in the private listing_attachments bucket; storage
  // RLS lets anyone who can read the listing sign a URL for them.
  const attachmentPaths = getListingAttachments(data)
    .map((item) => String(item?.path || ""))
    .filter(Boolean);
  if (attachmentPaths.length) {
    const { data: signed } = await client.storage
      .from("listing_attachments")
      .createSignedUrls(attachmentPaths, 60 * 60);
    const urlByPath = new Map((signed || []).map((row) => [row.path, row.signedUrl]));
    data.attachments.forEach((item) => {
      const url = urlByPath.get(item?.path);
      if (url) item.signed_url = url;
    });
  }

  if (data?.profiles) {
    const { data: bizData } = await client
      .from("business_profiles")
      .select(
        "business_name, website_url, business_details, social_links, current_efforts, instagram_url, facebook_url, company_linkedin_url"
      )
      .eq("user_id", data.owner_id)
      .maybeSingle();
    if (bizData) data._business = bizData;
  }

  return { listing: data, error: null };
}

async function loadSessionRole(client, userId) {
  const { data } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role ?? null;
}

async function loadMyBid(client, listingId, userId) {
  // Without an explicit consultant filter this would lean on RLS to scope
  // the row to the viewer — and any policy gap (or a consultant who's
  // technically allowed to read another bid for legit reasons) would
  // leak somebody else's `accepted` bid into this consultant's offer
  // panel, lighting up the "accepted" banner for an offer they never made.
  if (!userId) return { bid: null, available: true };
  const { data, error } = await client
    .from("bids")
    // `*` so optional columns (timeline_days, original_amount_cents) come
    // through when their migrations are applied without erroring before.
    .select("*")
    .eq("listing_id", listingId)
    .eq("consultant_id", userId)
    .maybeSingle();

  if (error && isMissing(error)) return { bid: null, available: false };
  return { bid: data, available: true };
}

async function loadOwnerBids(client, listingId) {
  const {
    data: { session },
  } = await client.auth.getSession();
  const headers = {};
  if (session?.access_token) {
    headers.Authorization = `Bearer ${session.access_token}`;
  }

  if (headers.Authorization) {
    try {
      const res = await fetch(`/api/listings/${encodeURIComponent(listingId)}/owner-bids`, {
        headers,
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.bids)) {
        return { bids: data.bids, available: true };
      }
      console.warn("owner bids api:", data.error || res.statusText);
    } catch (error) {
      console.warn("owner bids api:", error);
    }
  }

  const { data, error } = await client
    .from("bids")
    .select(
      `id, listing_id, consultant_id, amount_cents, proposal_fee_cents, service_fee_cents, move_forward_status, message, status,
       counter_offer_cents, counter_offer_message, counter_expires_at, counter_responded_at, counter_response_message, counter_attempted,
       accepted_at, proposal_due_at, proposal_path, created_at,
       profiles!bids_consultant_id_fkey ( id, full_name, linkedin_url, avatar_path )`
    )
    .eq("listing_id", listingId)
    .order("created_at", { ascending: true });

  if (error && isMissing(error)) return { bids: [], available: false };
  if (error) { console.warn(error); return { bids: [], available: true }; }
  return { bids: data || [], available: true };
}

async function loadConsultantEducationMap(client, consultantIds) {
  const ids = [...new Set((consultantIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await client
    .from("consultant_profiles")
    .select("user_id, major, minor, school, educations")
    .in("user_id", ids);

  if (error && isMissing(error)) return new Map();
  if (error) {
    console.warn("consultant education load:", error);
    return new Map();
  }

  return new Map((data || []).map((row) => [row.user_id, row]));
}

async function loadMessages(client, listingId, otherUserId) {
  const { data, error } = await client
    .from("messages")
    .select("id, sender_id, recipient_id, body, created_at")
    .eq("listing_id", listingId)
    .or(`and(sender_id.eq.${otherUserId}),and(recipient_id.eq.${otherUserId})`)
    .order("created_at", { ascending: true });

  if (error && isMissing(error)) return [];
  if (error) { console.warn("messages load:", error); return []; }
  return data || [];
}

/* ================================================================
   Populate listing header & info
   ================================================================ */

/* Social platform SVG icons */
function socialSvg(platform) {
  const icons = {
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.2"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
  };
  return icons[platform] || icons.linkedin;
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("instagram")) return "instagram";
  if (u.includes("facebook") || u.includes("fb.com")) return "facebook";
  if (u.includes("linkedin")) return "linkedin";
  return "linkedin";
}


function parseStructuredListingDetails(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const sectionLabels = [
    { key: "issueContext", labels: ["context:", "issue context:"] },
    { key: "businessProblem", labels: ["business problem:"] },
    { key: "expectedOutput", labels: ["standards of work:", "expected output:"] },
    { key: "additionalDetails", labels: ["additional details:"] },
  ];

  const lines = raw.split("\n");
  const normalized = lines.map((line) => line.trim().toLowerCase());
  const indexes = sectionLabels
    .map((section) => ({
      ...section,
      index: normalized.findIndex((line) => section.labels.includes(line)),
    }))
    .filter((section) => section.index >= 0)
    .sort((a, b) => a.index - b.index);

  const parsed = {
    issueContext: "",
    businessProblem: "",
    expectedOutput: "",
    additionalDetails: "",
    legacyDetails: raw
      .replace(/^budget range:\s*.+$/im, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };

  indexes.forEach((section, idx) => {
    const nextIndex = indexes[idx + 1]?.index ?? lines.length;
    parsed[section.key] = lines
      .slice(section.index + 1, nextIndex)
      .join("\n")
      .trim();
  });

  return parsed;
}

function getListingStatusLabel(status) {
  const normalized = String(status || "open").toLowerCase();
  if (normalized === "paused") return "paused";
  if (normalized === "closed") return "closed";
  if (normalized === "filled") return "filled";
  return "open";
}

function getListingReasonLabel(reason) {
  return STATUS_REASON_LABELS[String(reason || "").trim()] || "";
}

function getListingReasonText(listing) {
  const reason = String(listing?.status_reason || "").trim();
  if (!reason) return "";
  if (reason === "other") {
    const other = String(listing?.status_reason_other || "").trim();
    return other || "other";
  }
  return getListingReasonLabel(reason);
}

function getListingAttachments(listing) {
  return Array.isArray(listing?.attachments) ? listing.attachments.filter(Boolean) : [];
}

function syncLayoutRail() {
  if (!layout) return;
  const showRail = Boolean(!ownerSidebar?.hidden || !offerRail?.hidden);
  layout.classList.toggle("ld-layout--with-rail", showRail);
}

function setOwnerSidebarVisible(visible) {
  if (!ownerSidebar) return;
  ownerSidebar.hidden = !visible;
  syncLayoutRail();
}

function setOfferRailVisible(visible) {
  if (!offerRail) return;
  offerRail.hidden = !visible;
  syncLayoutRail();
}

/* Render the guest conversion card into the right rail. Guests have
   no way to bid (consultant accounts are application-only, business
   accounts are full-fledged), so we don't pretend the offer form
   exists for them — instead we show two paths forward and a quiet
   sign-in link for anyone who already has an account. The default
   pitch leans toward the business side because that's the dominant
   guest persona (and the side we're actively trying to grow). */
function renderGuestRail() {
  const rail = document.getElementById("ld-guest-rail");
  if (!rail) return;
  rail.innerHTML = `
    <section class="ld-guest-rail__card" aria-label="Join Grassroots">
      <span class="ld-guest-rail__eyebrow">Guest preview</span>
      <h2 class="ld-guest-rail__title">Like what you see?</h2>
      <p class="ld-guest-rail__body">
        Join Grassroots to post your own project and get matched with
        local student consultants — or apply to bid on work like this.
      </p>
      <div class="ld-guest-rail__actions">
        <a class="gr-btn gr-btn--primary" href="/register.html?role=owner">Post a project</a>
        <a class="gr-btn gr-btn--ghost" href="/home/for-students.html">Apply as a consultant</a>
      </div>
      <div class="ld-guest-rail__divider" aria-hidden="true">Or</div>
      <div class="ld-guest-rail__secondary">
        <p>Already on Grassroots?</p>
        <a class="ld-guest-rail__signin" href="/signin.html">Sign in →</a>
      </div>
    </section>
  `;
  rail.hidden = false;
  // syncLayoutRail() reads ownerSidebar / offerRail; the guest rail
  // isn't in that check by design — we add the layout class directly
  // here so the two-column grid kicks in for guests too.
  if (layout) layout.classList.add("ld-layout--with-rail");
}

function renderListingAttachments(listing) {
  const attachmentsWrap = document.getElementById("ld-attachments");
  if (!attachmentsWrap) return;

  const attachments = getListingAttachments(listing);
  if (!attachments.length) {
    attachmentsWrap.innerHTML = "";
    attachmentsWrap.hidden = true;
    return;
  }

  attachmentsWrap.innerHTML = attachments
    .map((item) => {
      const url = String(item?.signed_url || item?.public_url || "").trim();
      const name = String(item?.name || "attachment").trim();
      const detailBits = [
        String(item?.kind || "").trim(),
        formatFileSize(item?.size),
      ].filter(Boolean);
      const detail = detailBits.join(" · ");
      const isImage = String(item?.content_type || "").toLowerCase().startsWith("image/");

      return `
        <article class="ld-attachment-card">
          ${isImage && url ? `<a class="ld-attachment-card__thumb" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeAttr(url)}" alt="${escapeAttr(name)}" /></a>` : `<div class="ld-attachment-card__icon" aria-hidden="true">${escapeHtml((String(item?.kind || "file").trim() || "file").slice(0, 1).toUpperCase())}</div>`}
          <div class="ld-attachment-card__body">
            <p class="ld-attachment-card__name">${escapeHtml(name)}</p>
            ${detail ? `<p class="ld-attachment-card__detail">${escapeHtml(detail)}</p>` : ""}
            ${url ? `<a class="ld-attachment-card__link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Open file</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  attachmentsWrap.hidden = false;
}

// Drive open/close of <details class="ld-section"> via the Web
// Animations API. Native [open]-removal can flip content-visibility
// to hidden before the CSS height/opacity transitions get a chance
// to play — the open direction transitioned reliably but the close
// direction snapped in practice. Doing it in JS guarantees a real
// fade in *and* fade out, with full control over both directions.
function attachLdSectionAnimation(details) {
  const summary = details.querySelector(":scope > summary");
  if (!summary) return;
  if (details.dataset.animatedToggle === "true") return;
  details.dataset.animatedToggle = "true";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DURATION = reducedMotion ? 0 : 380;
  const EASING = "ease-in-out";
  let current = null;

  summary.addEventListener("click", (event) => {
    event.preventDefault();
    if (current) {
      current.cancel();
      current = null;
    }

    const opening = !details.open;
    const body = Array.from(details.children).filter((el) => el !== summary);
    const summaryHeight = summary.offsetHeight;

    if (opening) {
      // Set [open] first so the pseudo-content lays out; measure full
      // height, then collapse inline to summary height before painting
      // so the animation has a real start frame.
      details.open = true;
      const fullHeight = details.scrollHeight;
      details.style.overflow = "hidden";
      details.style.height = summaryHeight + "px";
      // Force reflow so the animation runs from the constrained height.
      void details.offsetHeight;

      const heightAnim = details.animate(
        [{ height: summaryHeight + "px" }, { height: fullHeight + "px" }],
        { duration: DURATION, easing: EASING, fill: "forwards" },
      );
      const opacityAnims = body.map((el) =>
        el.animate(
          [{ opacity: 0 }, { opacity: 1 }],
          { duration: DURATION, easing: EASING, fill: "forwards" },
        ),
      );

      current = heightAnim;
      heightAnim.onfinish = () => {
        heightAnim.cancel();
        opacityAnims.forEach((a) => a.cancel());
        details.style.height = "";
        details.style.overflow = "";
        current = null;
      };
    } else {
      const startHeight = details.offsetHeight;
      details.style.overflow = "hidden";
      details.style.height = startHeight + "px";
      void details.offsetHeight;

      const heightAnim = details.animate(
        [{ height: startHeight + "px" }, { height: summaryHeight + "px" }],
        { duration: DURATION, easing: EASING, fill: "forwards" },
      );
      const opacityAnims = body.map((el) =>
        el.animate(
          [{ opacity: 1 }, { opacity: 0 }],
          { duration: DURATION, easing: EASING, fill: "forwards" },
        ),
      );

      current = heightAnim;
      heightAnim.onfinish = () => {
        details.open = false;
        heightAnim.cancel();
        opacityAnims.forEach((a) => a.cancel());
        details.style.height = "";
        details.style.overflow = "";
        current = null;
      };
    }
  });
}

/* Trust badges under the owner name. Fire-and-forget: the bio renders
   first and the block fills in once the RPC answers. */
async function populateBusinessBadges(client, ownerId) {
  const host = document.getElementById("ld-biz-badges");
  if (!host || !ownerId) return;
  const map = await loadBusinessBadges(client, [ownerId]);
  if (!map) return;
  const html = renderBadgeBlock(map.get(ownerId));
  if (!html) return;
  host.innerHTML = html;
  host.hidden = false;
}

function populateListing(listing) {
  const profile = listing.profiles;
  const biz = listing._business || null;

  document.title = `grassroots — ${listing.title}`;

  /* --- Business bio --- */
  const ownerName = profile?.full_name || listing.business_display_name || "Business owner";
  document.getElementById("ld-biz-owner").textContent = ownerName;

  const bizName = biz?.business_name || listing.business_display_name || ownerName;
  // Two name slots: the inline one in the toggle row shows when the
  // bio is collapsed; the body heading shows when expanded. CSS hides
  // whichever isn't relevant to the current state.
  const nameInlineEl = document.getElementById("ld-biz-name-inline");
  if (nameInlineEl) nameInlineEl.textContent = bizName;
  const nameEl = document.getElementById("ld-biz-name");
  if (nameEl) nameEl.textContent = bizName;

  const bizDetails = biz?.business_details || listing.business_summary;
  if (bizDetails) { const el = document.getElementById("ld-biz-details"); el.textContent = bizDetails; el.hidden = false; }

  const websiteUrl = biz?.website_url || listing.listing_website_url;
  if (websiteUrl) { const el = document.getElementById("ld-biz-website"); el.href = websiteUrl; el.textContent = new URL(websiteUrl).hostname.replace("www.", ""); el.hidden = false; }

  /* Social icons — business bio shows the *business's* socials only.
     Owner's personal linkedin (profile.linkedin_url) belongs on their
     consultant/owner profile, not on the listing's business card. */
  const fromExplicit = [biz?.instagram_url, biz?.facebook_url, biz?.company_linkedin_url].filter(
    (u) => u && String(u).trim()
  );
  const fromLegacy = biz?.social_links || listing.listing_social_links || [];
  const merged = [...fromExplicit, ...(Array.isArray(fromLegacy) ? fromLegacy : [])];
  const socialLinks = [...new Set(merged.map((u) => String(u).trim()))].filter(Boolean);
  if (socialLinks.length) {
    const wrap = document.getElementById("ld-biz-socials");
    wrap.innerHTML = socialLinks.map((url) => {
      try {
        const platform = detectPlatform(url);
        return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="ld-bio__social-link" title="${platform}">${socialSvg(platform)}</a>`;
      } catch { return ""; }
    }).filter(Boolean).join("");
    wrap.hidden = false;
  }

  /* --- Collapsible toggle --- */
  const bioToggle = document.getElementById("ld-bio-toggle");
  const bioBody = document.getElementById("ld-bio-body");
  bioToggle.addEventListener("click", () => {
    const isExpanded = bioToggle.getAttribute("aria-expanded") === "true";
    bioToggle.setAttribute("aria-expanded", String(!isExpanded));
    bioBody.classList.toggle("is-collapsed", isExpanded);
  });

  // JS-driven open/close for every <details class="ld-section"> on the
  // page so both directions get a real fade. See attachLdSectionAnimation
  // for the why.
  document.querySelectorAll(".ld-section").forEach(attachLdSectionAnimation);

  /* --- Opportunity header --- */
  document.getElementById("ld-title").textContent = listing.title;
  document.getElementById("ld-date").textContent = `Posted ${relativeDate(listing.created_at)}`;

  if (listing.turnaround_days) {
    const el = document.getElementById("ld-turnaround");
    el.textContent = `${listing.turnaround_days} day${listing.turnaround_days === 1 ? "" : "s"} turnaround`;
    el.hidden = false;
  }

  /* --- Parse structured fields from details --- */
  const detailsStr = listing.details || "";
  const parsedDetails = parseStructuredListingDetails(detailsStr);
  const budgetRange = parseBudgetRange(detailsStr);
  const contextEl = document.getElementById("ld-context");
  const contextSectionEl = document.getElementById("ld-context-section");
  const summaryEl = document.getElementById("ld-summary");
  const summaryHeadingEl = document.getElementById("ld-summary-heading");
  const outputEl = document.getElementById("ld-output");
  const outputSectionEl = document.getElementById("ld-output-section");
  const detailsEl = document.getElementById("ld-details");
  const detailsHeadingEl = document.getElementById("ld-details-heading");
  const detailsSectionEl = document.getElementById("ld-details-section");
  const attachments = getListingAttachments(listing);

  /* --- Budget subheader --- */
  if (budgetRange) {
    const budgetEl = document.getElementById("ld-budget");
    budgetEl.textContent = formatBudgetRange(budgetRange);
    budgetEl.hidden = false;
  }

  /* --- Tags (categories) --- */
  const tagsEl = document.getElementById("ld-header-tags");
  let tagsHtml = "";

  if (listing.category) {
    listing.category.split(",").map((c) => c.trim()).filter(Boolean).forEach((cat) => {
      tagsHtml += `<span class="ld-tag">${escapeHtml(capFirst(cat))}</span>`;
    });
  }
  tagsEl.innerHTML = tagsHtml;

  /* --- Structured content sections --- */
  if (parsedDetails.issueContext) {
    contextEl.textContent = parsedDetails.issueContext;
    contextSectionEl.hidden = false;
  }

  summaryHeadingEl.textContent = parsedDetails.businessProblem ? "Business problem" : "The challenge";
  summaryEl.textContent = parsedDetails.businessProblem || listing.problem_summary || "No summary provided.";

  if (parsedDetails.expectedOutput) {
    outputEl.textContent = parsedDetails.expectedOutput;
    outputSectionEl.hidden = false;
  }

  const detailsBody =
    parsedDetails.additionalDetails ||
    (!parsedDetails.issueContext && !parsedDetails.businessProblem && !parsedDetails.expectedOutput
      ? parsedDetails.legacyDetails
      : "");

  if (detailsBody) {
    detailsHeadingEl.textContent = parsedDetails.additionalDetails ? "Additional details" : "Details";
    detailsEl.textContent = detailsBody;
    detailsEl.hidden = false;
  } else {
    detailsEl.textContent = "";
    detailsEl.hidden = true;
  }
  renderListingAttachments(listing);
  detailsSectionEl.hidden = !detailsBody && attachments.length === 0;

  /* --- Qualifications (bullet points) --- */
  if (listing.qualifications_required) {
    const qualsEl = document.getElementById("ld-quals");
    const quals = listing.qualifications_required.split("\n").map(q => q.trim()).filter(Boolean);
    qualsEl.innerHTML = quals.map(q => `<li>${escapeHtml(q)}</li>`).join("");
    document.getElementById("ld-quals-section").hidden = false;
  }

  return { profile, biz };
}

function populateAvatarIfAvailable(client, profile) {
  const url = publicAvatarUrl(client, profile?.avatar_path);
  if (url) {
    document.getElementById("ld-biz-avatar").src = url;
    document.getElementById("ld-biz-avatar-wrap").hidden = false;
  }
}

function formatConsultantEducationLine(education) {
  // Prefer the structured educations array (chunk 3+); fall back to the
  // legacy flat columns for rows that haven't been migrated to the new
  // schema yet.
  const primary = Array.isArray(education?.educations) && education.educations[0]
    ? education.educations[0]
    : education || {};
  const degree = (primary.degree || "").trim();
  const major = (primary.major || "").trim();
  const school = (primary.school || "").trim();
  // Format priority: "Bachelor's in marketing @ University of Florida".
  const head = degree && major
    ? `${degree} in ${major}`
    : major || degree || "";
  if (head && school) return `${head} @ ${school}`;
  return head || school || "";
}

function renderEducationEntriesList(education) {
  // Build a structured display of every entry in the educations array. If
  // the array is empty/missing, return a single-line fallback from legacy
  // flat fields.
  const entries = Array.isArray(education?.educations) && education.educations.length
    ? education.educations
    : (education?.major || education?.school
      ? [{ degree: null, major: education.major, minor: education.minor, school: education.school }]
      : []);
  if (!entries.length) return "";
  return entries
    .map((e) => {
      const parts = [];
      if (e.degree) parts.push(escapeHtml(e.degree));
      if (e.major) parts.push(escapeHtml(`in ${e.major}`));
      if (e.minor) parts.push(escapeHtml(`(minor: ${e.minor})`));
      const head = parts.join(" ");
      const school = e.school ? escapeHtml(e.school) : "";
      if (head && school) return `<p class="pf-bv__detail">${head} · ${school}</p>`;
      return `<p class="pf-bv__detail">${head || school}</p>`;
    })
    .join("");
}

function resetOwnerStatusForm() {
  if (!statusForm || !statusOtherWrap || !statusOtherInput || !statusFormTitle) return;
  pendingListingStatusAction = null;
  statusForm.reset();
  statusForm.classList.add("hidden");
  statusOtherWrap.classList.add("hidden");
  statusOtherInput.value = "";
  statusSubmitBtn.textContent = "Confirm";
  statusFormTitle.textContent = "";
}

function syncOwnerStatusOtherField() {
  if (!statusOtherWrap || !statusOtherInput) return;
  const selected = document.querySelector('input[name="listingStatusReason"]:checked')?.value || "";
  const showOther = selected === "other";
  statusOtherWrap.classList.toggle("hidden", !showOther);
  if (!showOther) statusOtherInput.value = "";
}

function openOwnerStatusForm(action) {
  if (!statusForm || !statusFormTitle || !ownerActionStatus) return;
  pendingListingStatusAction = action;
  ownerActionStatus.textContent = "";
  ownerActionStatus.className = "gr-status";
  statusFormTitle.textContent =
    action === "paused" ? "Why are you pausing this listing?" : "Why are you closing this listing?";
  statusSubmitBtn.textContent = action === "paused" ? "Pause listing" : "Close listing";

  // Action-specific intro — explains the consequence in plain language
  // so the owner knows what closing vs pausing actually does.
  if (statusFormIntro) {
    if (action === "closed") {
      statusFormIntro.textContent =
        "Closing stops new offers, but consultants who already submitted can still see this listing. You can decide what happens to their offers below.";
      statusFormIntro.hidden = false;
    } else if (action === "paused") {
      statusFormIntro.textContent =
        "Pausing hides this listing from marketplace browsing. Existing offers stay in place and you can resume any time.";
      statusFormIntro.hidden = false;
    } else {
      statusFormIntro.hidden = true;
      statusFormIntro.textContent = "";
    }
  }

  // Work-completed reason only makes sense when an offer has been
  // accepted and the engagement is in flight. Mark the radio disabled
  // (visually + functionally) when no accepted bid exists; a click on
  // the label still fires and surfaces a toast explaining the gate.
  const hasAccepted = cachedOwnerBids.some((b) => b.status === "accepted");
  if (workCompletedOption) {
    const input = workCompletedOption.querySelector('input[type="radio"]');
    if (!hasAccepted) {
      workCompletedOption.classList.add("is-disabled");
      workCompletedOption.setAttribute("aria-disabled", "true");
      if (input) {
        input.disabled = true;
        input.checked = false;
      }
    } else {
      workCompletedOption.classList.remove("is-disabled");
      workCompletedOption.removeAttribute("aria-disabled");
      if (input) input.disabled = false;
    }
  }

  // Pending-offers disposition only applies when closing AND there are
  // outstanding offers to disposition. Default radio (`keep`) stays
  // checked so submitting without changing anything matches today's
  // behavior — leaves offers pending.
  const pendingCount = cachedOwnerBids.filter((b) => PENDING_BID_STATUSES.has(b.status)).length;
  if (statusOffersFieldset) {
    if (action === "closed" && pendingCount > 0) {
      statusOffersFieldset.hidden = false;
      const keepRadio = statusOffersFieldset.querySelector('input[value="keep"]');
      if (keepRadio) keepRadio.checked = true;
    } else {
      statusOffersFieldset.hidden = true;
    }
  }

  statusForm.classList.remove("hidden");
  syncOwnerStatusOtherField();
}

function renderOwnerActionSummary(listing) {
  if (!ownerActionsCopy || !pauseListingBtn || !closeListingBtn) return;
  const status = getListingStatusLabel(listing?.status);
  const reasonText = getListingReasonText(listing);
  const buttonsWrap = pauseListingBtn.closest(".ld-owner-actions__buttons");

  // The intro copy element starts present-but-empty; make sure it's
  // visible whenever we set text on it. (Earlier HTML carried `hidden`
  // which kept the closed-state explanation from ever rendering.)
  const showCopy = (text) => {
    ownerActionsCopy.textContent = text;
    ownerActionsCopy.hidden = false;
  };

  if (status === "paused") {
    showCopy(reasonText
      ? `This listing is paused because of "${reasonText}". Resume it any time or close it permanently.`
      : "This listing is paused. Existing offers stay in place while it stays out of marketplace browsing.");
    if (buttonsWrap) buttonsWrap.hidden = false;
    pauseListingBtn.textContent = "Resume listing";
    pauseListingBtn.disabled = false;
    closeListingBtn.textContent = "Close listing";
    closeListingBtn.disabled = false;
    return;
  }

  if (status === "closed") {
    // Closed is terminal — drop the action buttons entirely so the panel
    // reads as a status note rather than a disabled control surface.
    showCopy(reasonText
      ? `This listing is already closed (reason: "${reasonText}"). Existing participants can still refer back to it here.`
      : "This listing is already closed. Existing participants can still refer back to it here.");
    if (buttonsWrap) buttonsWrap.hidden = true;
    resetOwnerStatusForm();
    return;
  }

  // Default ("open" / actionable) state: the explainer copy lives in the
  // `?` tooltip next to the heading now, so suppress the inline paragraph
  // and let the buttons speak for themselves. paused / closed branches
  // still set status copy above (those describe current state).
  ownerActionsCopy.textContent = "";
  ownerActionsCopy.hidden = true;
  if (buttonsWrap) buttonsWrap.hidden = false;
  pauseListingBtn.textContent = "Pause listing";
  closeListingBtn.textContent = "Close listing";
  pauseListingBtn.disabled = false;
  closeListingBtn.disabled = false;
}

function showOwnerActionFeedback(message, kind = "success") {
  // Owner actions (pause / resume / cancel listing) now route through
  // the app-wide toast stack instead of an inline `gr-status` line.
  if (kind === "error") showError(message);
  else showSuccess(message);
}

async function persistListingStatus(client, listing, nextStatus, reason = null, otherReason = null) {
  const payload = {
    status: nextStatus,
    status_reason: reason,
    status_reason_other: reason === "other" ? otherReason : null,
  };

  const { error } = await client.from("listings").update(payload).eq("id", listing.id);
  if (error) throw error;

  listing.status = payload.status;
  listing.status_reason = payload.status_reason;
  listing.status_reason_other = payload.status_reason_other;
}

function setupOwnerListingActions(client, listing) {
  if (
    !ownerSidebar ||
    !ownerActionsPanel ||
    !pauseListingBtn ||
    !closeListingBtn ||
    !statusForm ||
    !statusCancelBtn ||
    !statusSubmitBtn
  ) {
    return;
  }

  setOwnerSidebarVisible(true);
  ownerActionsPanel.hidden = false;
  renderOwnerActionSummary(listing);

  if (!ownerActionsPanel.dataset.bound) {
    pauseListingBtn.addEventListener("click", async () => {
      if (getListingStatusLabel(listing.status) === "paused") {
        ownerActionStatus.textContent = "";
        ownerActionStatus.className = "gr-status";
        pauseListingBtn.disabled = true;
        try {
          await persistListingStatus(client, listing, "open", null, null);
          renderOwnerActionSummary(listing);
          resetOwnerStatusForm();
          showOwnerActionFeedback("Listing resumed. It is visible in marketplace browsing again.");
        } catch (error) {
          showOwnerActionFeedback(error.message || "Could not resume listing.", "error");
        } finally {
          renderOwnerActionSummary(listing);
        }
        return;
      }

      resetOwnerStatusForm();
      openOwnerStatusForm("paused");
    });

    closeListingBtn.addEventListener("click", () => {
      resetOwnerStatusForm();
      openOwnerStatusForm("closed");
    });

    // Work-completed reason is gated on an accepted bid existing. Clicks
    // on the label fire even when the wrapped <input disabled> rejects
    // them, so this is the right place to surface the "why not" toast.
    if (workCompletedOption) {
      workCompletedOption.addEventListener("click", (event) => {
        if (workCompletedOption.classList.contains("is-disabled")) {
          event.preventDefault();
          showToast(
            "This reason applies once you've accepted a consultant's offer. Close the engagement from the engagement page instead.",
            { kind: "info", duration: 5000 }
          );
        }
      });
    }

    statusCancelBtn.addEventListener("click", () => {
      resetOwnerStatusForm();
      ownerActionStatus.textContent = "";
      ownerActionStatus.className = "gr-status";
    });

    statusForm.addEventListener("change", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.name === "listingStatusReason") {
        syncOwnerStatusOtherField();
      }
    });

    statusForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = pendingListingStatusAction;
      if (!action) return;

      const reason = document.querySelector('input[name="listingStatusReason"]:checked')?.value || "";
      if (!reason) {
        showOwnerActionFeedback("Choose a reason before continuing.", "error");
        return;
      }

      const otherReason = reason === "other" ? statusOtherInput?.value.trim() || "" : "";
      if (reason === "other" && !otherReason) {
        showOwnerActionFeedback("Add a short note when you choose other.", "error");
        return;
      }

      // Pending-offers disposition only applies when closing. The
      // fieldset stays hidden in the paused flow so the radio value is
      // ignored there even if it somehow got selected.
      const offersDisposition =
        action === "closed"
          ? document.querySelector('input[name="listingOffersDisposition"]:checked')?.value || "keep"
          : "keep";

      statusSubmitBtn.disabled = true;
      ownerActionStatus.textContent = "";
      ownerActionStatus.className = "gr-status";

      try {
        // Bulk-decline FIRST so we don't leave a half-closed listing
        // with pending bids if the listing update succeeds and the
        // bulk-decline then errors. A successful decline followed by
        // a failed status update still leaves the bids in a sensible
        // declined state and the listing technically still open.
        let declinedCount = 0;
        if (action === "closed" && offersDisposition === "decline_all") {
          const targets = cachedOwnerBids.filter((b) => PENDING_BID_STATUSES.has(b.status));
          if (targets.length > 0) {
            const { error: declineErr } = await client
              .from("bids")
              .update({ status: "declined", declined_at: new Date().toISOString() })
              .in("id", targets.map((b) => b.id));
            if (declineErr) throw declineErr;
            targets.forEach((b) => {
              b.status = "declined";
              b.declined_at = new Date().toISOString();
            });
            declinedCount = targets.length;
          }
        }

        await persistListingStatus(client, listing, action, reason, otherReason || null);
        renderOwnerActionSummary(listing);
        resetOwnerStatusForm();
        const closedCopy = declinedCount > 0
          ? `Listing closed. ${declinedCount} outstanding offer${declinedCount === 1 ? " was" : "s were"} declined.`
          : "Listing closed. Existing offers remain on file. Consultants who already submitted can still see this listing.";
        showOwnerActionFeedback(
          action === "paused"
            ? "Listing paused. It is now hidden from marketplace browsing, but current offers remain in place."
            : closedCopy
        );
      } catch (error) {
        showOwnerActionFeedback(error.message || "Could not update listing status.", "error");
      } finally {
        statusSubmitBtn.disabled = false;
      }
    });

    ownerActionsPanel.dataset.bound = "1";
  }
}

/* ================================================================
   Message thread renderer
   ================================================================ */

function renderMsgThread(container, messages, myId) {
  if (!messages.length) {
    container.innerHTML = '<p class="ld-msg-empty">No messages yet.</p>';
    return;
  }
  container.innerHTML = messages.map((m) => {
    const mine = m.sender_id === myId;
    const time = new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<div class="ld-msg-bubble ${mine ? "ld-msg-bubble--mine" : "ld-msg-bubble--theirs"}">
      <p class="ld-msg-text">${escapeHtml(m.body)}</p>
      <span class="ld-msg-time">${time}</span>
    </div>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

/* ================================================================
   Consultant view: offer panel (sidebar) + chat drawer
   ================================================================ */

// Consultant-side take-home breakdown. Pricing is all-in: the offer is
// what the business pays, and the platform fee (10% struck through to the
// launch rate) plus Stripe processing come out of it.
function offerBreakdownHtml(f, opts = {}) {
  // Consultant-only copy. Businesses never see the free option mentioned.
  if (f.amountCents === 0) {
    return opts.allowFree
      ? `<p class="ld-offer-breakdown__note">${opts.freeNote || "Free offer. Doing a job free can help build your reputation."}</p>`
      : `<p class="ld-offer-breakdown__note">This amount must be at least $10.</p>`;
  }
  if (f.amountCents < MIN_PAID_OFFER_CENTS) {
    return `<p class="ld-offer-breakdown__note">${opts.allowFree ? "Offers are free or at least $10." : "This amount must be at least $10."}</p>`;
  }
  const bizLabel = opts.bizLabel || "Business pays";
  const takeHomeLabel = opts.takeHomeLabel || "You take home";
  const launchPct = LAUNCH_PLATFORM_FEE_BPS / 100;
  // Show what a flat 10% of the whole offer would cost, struck through,
  // next to what they actually pay after the launch rate and free first $10.
  const undiscountedCents = Math.round((f.amountCents * PLATFORM_FEE_BPS) / 10000);
  const platformValue = undiscountedCents > f.platformFeeCents
    ? `<span class="ld-offer-breakdown__strike">−${formatUsd(undiscountedCents)}</span> −${formatUsd(f.platformFeeCents)}`
    : `−${formatUsd(f.platformFeeCents)}`;
  const platformLabel = f.platformFeeDiscounted
    ? `Platform fee <span class="ld-offer-breakdown__strike">10%</span> ${launchPct}%
       <span class="ld-offer-breakdown__hint">Launch rate · none on the first $10</span>`
    : `Platform fee (10%)
       <span class="ld-offer-breakdown__hint">None on the first $10</span>`;
  return `
    <div class="ld-offer-breakdown__line ld-offer-breakdown__line--biz">
      <span>${bizLabel}</span>
      <span class="ld-offer-breakdown__value">${formatUsd(f.businessTotalCents)}</span>
    </div>
    <div class="ld-offer-breakdown__line ld-offer-breakdown__line--sub">
      <span>${platformLabel}</span>
      <span class="ld-offer-breakdown__value">${platformValue}</span>
    </div>
    <div class="ld-offer-breakdown__line ld-offer-breakdown__line--sub">
      <span>Card processing</span>
      <span class="ld-offer-breakdown__value">−${formatUsd(f.stripeFeeCents)}</span>
    </div>
    <div class="ld-offer-breakdown__line ld-offer-breakdown__line--total">
      <span>${takeHomeLabel}</span>
      <span class="ld-offer-breakdown__value">${formatUsd(f.consultantPayoutCents)}</span>
    </div>
  `;
}

// The consultant's read-only offer card: amount, counter history, status,
// timeline, take-home and pitch. Used on load and after answering a counter.
function offerSummaryHtml(bid, listing) {
  const isPhased = listing.contract_type === "phased";
  const isRetainer = listing.contract_type === "retainer";
  const isAccepted = bid.status === "accepted";
  const isCountered = bid.status === "countered" && bid.counter_offer_cents != null;
  const stateBadge = isAccepted
    ? `<span class="ld-accepted-badge">Accepted</span>`
    : isCountered
    ? `<span class="ld-accepted-badge ld-accepted-badge--countered">Countered</span>`
    : "";
  const messageHtml = bid.message
    ? `<span class="ld-bid-existing__message">${escapeHtml(bid.message)}</span>`
    : "";
  const amountHtml = isPhased && bid.proposal_fee_cents != null
    ? `<span class="ld-bid-existing__amount">Offer submitted:
         <strong>${formatUsd(bid.proposal_fee_cents)}</strong> proposal +
         <strong>${formatUsd(bid.service_fee_cents || 0)}</strong> full job</span>`
    : `<span class="ld-bid-existing__amount">Offer submitted: <strong>${formatUsd(bid.amount_cents)}</strong></span>`;

  // Counter history. original_amount_cents (add_bid_original_amount.sql)
  // is the price the consultant first sent; without it we can't tell an
  // accepted counter from a kept price, so the line is skipped.
  const originalCents = Number(bid.original_amount_cents);
  const counterAccepted =
    bid.counter_responded_at &&
    Number.isFinite(originalCents) &&
    originalCents !== Number(bid.amount_cents);
  const historyHtml = counterAccepted
    ? `<span class="ld-bid-existing__line">Countered from ${formatUsd(originalCents)} to ${formatUsd(bid.amount_cents)}, accepted</span>`
    : "";

  const statusLine = isAccepted
    ? "Accepted. Head to the engagement for next steps."
    : isCountered
    ? "The business sent a counter. Respond below."
    : bid.status === "declined"
    ? "This offer is closed."
    : "Waiting on the business. You'll get a notification when they respond.";
  const timelineHtml = bid.timeline_days
    ? `<span class="ld-bid-existing__line">Timeline: ${escapeHtml(formatTimelineDays(bid.timeline_days))}</span>`
    : "";

  // Take-home for a single-price offer (standard or per retainer period).
  // Phased offers show two prices, so the per-fee breakdown stays on the
  // form only.
  const takeHomeHtml = !isPhased && Number(bid.amount_cents) > 0
    ? `<div class="ld-offer-breakdown ld-bid-existing__breakdown">${offerBreakdownHtml(
        computeFees(Number(bid.amount_cents)),
        isRetainer
          ? { bizLabel: "Business pays per period", takeHomeLabel: "You take home per period" }
          : {}
      )}</div>`
    : "";

  return `
    <span class="ld-bid-existing__header">${amountHtml}${stateBadge}</span>
    ${historyHtml}
    <span class="ld-bid-existing__line ld-bid-existing__status">${escapeHtml(statusLine)}</span>
    ${timelineHtml}
    ${takeHomeHtml}
    ${messageHtml}`;
}

async function showConsultantView(client, session, listing, existingBid) {
  const panel = document.getElementById("ld-offer-panel");
  setOfferRailVisible(true);
  panel.hidden = false;

  const amountInput = document.getElementById("ld-bid-amount");
  const proposalFeeInput = document.getElementById("ld-bid-proposal-fee");
  const serviceFeeInput = document.getElementById("ld-bid-service-fee");

  // Live breakdown beneath each offer-amount input — same shape for
  // standard, retainer (per period), phased proposal, and phased service
  // inputs. Hidden on empty / zero input so the form doesn't render a
  // bogus "$0.30 in fees" on a blank field.
  function renderBreakdownInto(container, dollars, opts = {}) {
    if (!container) return;
    if (!Number.isFinite(dollars) || dollars < 0) {
      container.hidden = true;
      container.innerHTML = "";
      return;
    }
    const f = computeFees(Math.round(dollars * 100));
    container.innerHTML = offerBreakdownHtml(f, opts);
    container.hidden = false;
  }

  function wireBreakdown(input, containerId, opts) {
    const container = document.getElementById(containerId);
    if (!input || !container) return;
    const sync = () => renderBreakdownInto(container, parseFloat(input.value), opts);
    input.addEventListener("input", sync);
    sync();
  }

  const isRetainerListing = listing?.contract_type === "retainer";
  wireBreakdown(amountInput, "ld-offer-breakdown", isRetainerListing
    ? { offerLabel: "Fee per period", bizLabel: "Business pays per period", takeHomeLabel: "You take home per period" }
    : { allowFree: true });
  wireBreakdown(proposalFeeInput, "ld-offer-proposal-breakdown", {
    allowFree: true,
    freeNote: "No proposal fee.",
    offerLabel: "Proposal fee",
    bizLabel: "Business pays for proposal",
    takeHomeLabel: "You take home (proposal)",
  });
  wireBreakdown(serviceFeeInput, "ld-offer-service-breakdown", {
    offerLabel: "Service fee",
    bizLabel: "Business pays for service",
    takeHomeLabel: "You take home (service)",
  });

  // The "?" tooltip bubble is portaled to document.body and rendered
  // `position: fixed`. Two reasons it can't live next to the button:
  //   1. `.ld-detail` has a fade-in animation that ends with
  //      `transform: translateY(0)` and `animation-fill-mode: both`,
  //      which makes it the containing block for any fixed descendant.
  //   2. `.ld-offer-panel` has `overflow-y: auto` and would clip
  //      anything that tried to spill past its border.
  // With the bubble appended to <body>, it sits in the viewport
  // coordinate space and can spill past the section edges freely.
  // Click does nothing — the button is hover/focus-only.
  panel.querySelectorAll(".ld-offer-info").forEach((info) => {
    const tipId = info.getAttribute("aria-describedby");
    const bubble = tipId
      ? document.getElementById(tipId)
      : info.querySelector(".ld-offer-info__bubble");
    if (!bubble) return;
    if (bubble.parentElement !== document.body) {
      document.body.appendChild(bubble);
    }
    const positionBubble = () => {
      const r = info.getBoundingClientRect();
      bubble.style.left = "0px";
      bubble.style.top = "0px";
      const bw = bubble.offsetWidth;
      const bh = bubble.offsetHeight;
      const margin = 8;
      let left = r.left + r.width / 2 - bw / 2;
      left = Math.max(margin, Math.min(window.innerWidth - bw - margin, left));
      const top = r.top - bh - 8;
      bubble.style.left = `${left}px`;
      bubble.style.top = `${top}px`;
      bubble.style.setProperty(
        "--bubble-tail-x",
        `${r.left + r.width / 2 - left}px`
      );
    };
    const show = () => {
      positionBubble();
      bubble.classList.add("is-visible");
    };
    const hide = () => {
      bubble.classList.remove("is-visible");
    };
    info.addEventListener("mouseenter", show);
    info.addEventListener("mouseleave", hide);
    info.addEventListener("focus", show);
    info.addEventListener("blur", hide);
    info.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
  });
  const standardRow = document.getElementById("ld-offer-standard-row");
  const phasedRow = document.getElementById("ld-offer-phased-row");
  const proposalBudgetHint = document.getElementById("ld-bid-proposal-budget-hint");
  const msgInput = document.getElementById("ld-bid-message");
  const timelineInput = document.getElementById("ld-bid-timeline");
  const filesInput = document.getElementById("ld-bid-files");
  const filesList = document.getElementById("ld-offer-files-list");
  let pitchFiles = [];
  const renderPitchFiles = () => {
    if (!filesList) return;
    filesList.innerHTML = pitchFiles.map((f, i) => `
      <li class="ld-offer-files__item">
        <span class="ld-offer-files__name">${escapeHtml(f.name)}</span>
        <span class="ld-offer-files__size">${escapeHtml(formatFileSize(f.size))}</span>
        <button type="button" class="ld-offer-msg-remove" data-file-remove="${i}" aria-label="Remove ${escapeAttr(f.name)}">&times;</button>
      </li>
    `).join("");
  };
  filesInput?.addEventListener("change", () => {
    const incoming = Array.from(filesInput.files || []);
    for (const f of incoming) {
      if (pitchFiles.length >= PITCH_MAX_FILES) { showError(`You can attach up to ${PITCH_MAX_FILES} files.`); break; }
      if (f.size > PITCH_MAX_FILE_BYTES) { showError(`${f.name} is over 10 MB.`); continue; }
      pitchFiles.push(f);
    }
    filesInput.value = "";
    renderPitchFiles();
  });
  filesList?.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-file-remove]");
    if (!btn) return;
    pitchFiles.splice(Number(btn.getAttribute("data-file-remove")), 1);
    renderPitchFiles();
  });
  const msgToggleBtn = document.getElementById("ld-offer-msg-toggle");
  const msgWrap = document.getElementById("ld-offer-msg-wrap");
  const msgRemoveBtn = document.getElementById("ld-offer-msg-remove");
  const charCount = document.getElementById("ld-offer-char-count");
  const submitBtn = document.getElementById("ld-bid-submit");
  const statusEl = document.getElementById("ld-bid-status");
  const formWrap = document.getElementById("ld-offer-form-wrap");
  const listingId = listing.id;
  const ownerId = listing.owner_id;
  const myId = session.user.id;
  const listingStatus = getListingStatusLabel(listing.status);
  const listingAcceptingOffers = listingStatus === "open";
  const isPhased = listing.contract_type === "phased";
  const isRetainer = listing.contract_type === "retainer";

  /* --- Toggle the right form shape based on the listing's contract type. --- */
  if (isPhased) {
    standardRow.hidden = true;
    phasedRow.hidden = false;
    if (listing.proposal_budget != null && proposalBudgetHint) {
      proposalBudgetHint.textContent = `Business set a budget of ${formatUsd(Number(listing.proposal_budget) * 100)}`;
    }
  } else {
    standardRow.hidden = false;
    phasedRow.hidden = true;
  }

  // Retainer: reuse the standard single-input row, but reframe the label
  // and prefill the per-period fee if the business locked it in.
  if (isRetainer) {
    const label = standardRow?.querySelector(".ld-offer-amount-label");
    if (label) label.textContent = "Fee per period";
    const fixed = listing.retainer_terms === "fixed";
    if (fixed && listing.retainer_fee_cents != null && amountInput) {
      amountInput.value = (Number(listing.retainer_fee_cents) / 100).toFixed(2);
    }
  }

  /* --- Populate existing bid (read-only — offers cannot be edited once submitted) --- */
  if (existingBid) {
    // Lazy-expire: if the consultant lands on the page after their
    // 24h response window closed, revert client-side before rendering.
    if (
      existingBid.status === "countered" &&
      existingBid.counter_expires_at &&
      new Date(existingBid.counter_expires_at).getTime() < Date.now()
    ) {
      await client
        .from("bids")
        .update({
          status: "pending",
          counter_offer_cents: null,
          counter_offer_message: null,
          counter_expires_at: null,
        })
        .eq("id", existingBid.id);
      existingBid.status = "pending";
      existingBid.counter_offer_cents = null;
      existingBid.counter_offer_message = null;
      existingBid.counter_expires_at = null;
    }

    const heading = document.querySelector(".ld-offer-panel__heading");
    if (heading) heading.textContent = "Your offer";
    const el = document.getElementById("ld-bid-existing");
    const isCountered = existingBid.status === "countered" && existingBid.counter_offer_cents != null;
    el.innerHTML = offerSummaryHtml(existingBid, listing);
    el.hidden = false;
    formWrap.hidden = true;

    // Counter-response panel: only when the owner has an active
    // counter awaiting this consultant's decision.
    if (isCountered) {
      renderConsultantCounterPanel(client, listing, existingBid);
    }
  }

  /* --- Hard-block bid submission until Stripe payouts are fully active.
     The button stays clickable but renders as `aria-disabled` — a click
     in that state fires a toast pointing the consultant at /payouts.html
     instead of submitting. Once Stripe says active we drop the gate.
     If the local `stripe_account_status` column says non-active we
     proactively call `/api/stripe/account-status` to re-sync from
     Stripe before locking the gate — handles the lag where the
     account.updated webhook hasn't fired yet. */
  let payoutsBlocked = true;
  // New consultants must pass training before any offer, free ones
  // included (consultants with earlier offers are exempt). The real gate
  // is the bids_require_training trigger; this just explains it before
  // they fill in the form. Starts open so a slow or failed check never
  // blocks someone who is cleared.
  let trainingBlocked = false;
  // A free standard offer never pays out, so it doesn't need payouts set up.
  const isFreeOffer = () => !isPhased && !isRetainer && amountInput.value.trim() !== "" && Number(amountInput.value) === 0;
  const syncSubmitDisabled = () => {
    if (trainingBlocked || (payoutsBlocked && !isFreeOffer())) submitBtn.setAttribute("aria-disabled", "true");
    else submitBtn.removeAttribute("aria-disabled");
  };
  const showTrainingToast = () =>
    showToast("Pass consultant training before you send an offer. It takes about 25 minutes.", {
      kind: "error",
      duration: 6000,
      action: {
        label: "Start training",
        onClick: () => {
          window.location.href = "/training.html";
        },
      },
    });
  (async () => {
    const { data: cleared, error } = await client.rpc("my_training_cleared");
    // No function yet (migration not applied) means no trigger either.
    if (error) return;
    trainingBlocked = cleared === false;
    syncSubmitDisabled();
  })();
  const setPayoutsBlocked = (blocked) => {
    payoutsBlocked = blocked;
    syncSubmitDisabled();
  };
  setPayoutsBlocked(true);
  amountInput?.addEventListener("input", syncSubmitDisabled);
  (async () => {
    const readProfileStatus = async () => {
      const { data: prof, error } = await client
        .from("profiles")
        .select("stripe_account_status")
        .eq("id", myId)
        .maybeSingle();
      if (error) throw error;
      return prof?.stripe_account_status || null;
    };
    const refreshFromStripe = async () => {
      // `/api/stripe/account-status` retrieves the latest from Stripe
      // and writes `active`/`pending` back into the profiles column
      // (see app.js). We don't get the status string in the response —
      // it returns `onboarded` (true === all three Stripe flags green),
      // which is the same predicate our column uses for "active".
      try {
        const { data: { session: s } } = await client.auth.getSession();
        const headers = new Headers();
        if (s?.access_token) headers.set("Authorization", `Bearer ${s.access_token}`);
        const res = await fetch("/api/stripe/account-status", { headers });
        if (!res.ok) return null;
        const data = await res.json();
        return data?.onboarded ? "active" : "pending";
      } catch (_) {
        return null;
      }
    };
    try {
      let status = await readProfileStatus();
      if (status !== "active") {
        const refreshed = await refreshFromStripe();
        if (refreshed) status = refreshed;
      }
      // Non-active accounts stay payoutsBlocked. The disabled submit
      // + click-time toast covers the prompt — no separate banner.
      if (status === "active") setPayoutsBlocked(false);
    } catch (_) {
      // If we can't read the column (older schema), keep the gate up —
      // better the user sees the toast than ships a bid that can't be
      // paid out.
    }
  })();

  /* --- Message toggle --- */
  msgToggleBtn.addEventListener("click", () => {
    msgWrap.classList.remove("hidden");
    msgToggleBtn.classList.add("hidden");
    msgInput.focus();
  });

  msgRemoveBtn.addEventListener("click", () => {
    msgWrap.classList.add("hidden");
    msgToggleBtn.classList.remove("hidden");
    msgInput.value = "";
    charCount.textContent = `${PITCH_MAX_CHARS} characters left`;
  });

  msgInput.addEventListener("input", () => {
    const remaining = PITCH_MAX_CHARS - msgInput.value.length;
    charCount.textContent = `${remaining} character${remaining === 1 ? "" : "s"} left`;
    charCount.classList.toggle("ld-offer-char-count--low", remaining < 40);
  });

  /* --- Accepted: badge sits inline in the "your offer" element; the
         standalone manage-link sits below it as the CTA. The label
         resolves against the current schedule state so the consultant
         knows exactly what they're being sent to (kickoff scheduling,
         vs viewing kickoff status, vs the general engagement page). --- */
  if (existingBid?.status === "accepted") {
    const manageLink = document.getElementById("ld-bid-manage-link");
    const awaitingNotice = document.getElementById("ld-bid-awaiting-notice");
    if (manageLink) {
      try {
        const { label, hide, awaiting } = await resolveManageLinkLabel(client, existingBid.id, "consultant");
        if (hide) {
          // No actionable destination yet — keep the link hidden so
          // the consultant doesn't tap into a dead-end page. When the
          // wait is on the owner (awaiting kickoff availability), show
          // a small notice so the consultant knows what's next instead
          // of a silent gap below the offer card.
          manageLink.hidden = true;
          if (awaitingNotice) {
            if (awaiting === "owner") {
              awaitingNotice.textContent = "Waiting on the business to share kickoff availability.";
              awaitingNotice.hidden = false;
            } else {
              awaitingNotice.hidden = true;
              awaitingNotice.textContent = "";
            }
          }
        } else {
          manageLink.href = engagementLink(existingBid.id);
          manageLink.hidden = false;
          manageLink.innerHTML = `${escapeHtml(label)}<span class="ld-bid-manage-link__arrow" aria-hidden="true">→</span>`;
          if (awaitingNotice) {
            awaitingNotice.hidden = true;
            awaitingNotice.textContent = "";
          }
        }
      } catch (_) {
        manageLink.hidden = true;
        if (awaitingNotice) {
          awaitingNotice.hidden = true;
          awaitingNotice.textContent = "";
        }
      }
    }
    formWrap.hidden = true;
  }

  if (!listingAcceptingOffers) {
    formWrap.hidden = true;
    statusEl.textContent = existingBid
      ? `This listing is ${listingStatus}. Your existing offer stays visible here.`
      : `This listing is ${listingStatus} and is not accepting new offers right now.`;
    statusEl.className = "gr-status";
  }

  /* --- Submit offer --- */
  submitBtn.addEventListener("click", async () => {
    if (trainingBlocked) {
      showTrainingToast();
      return;
    }
    if (payoutsBlocked && !isFreeOffer()) {
      showToast(
        "Set up payouts before you can submit an offer. Grassroots can't pay you until your Stripe account is verified.",
        {
          kind: "error",
          duration: 6000,
          action: {
            label: "Set up payouts",
            onClick: () => {
              window.location.href = "/payouts.html";
            },
          },
        }
      );
      return;
    }
    if (!listingAcceptingOffers) {
      showError(`This listing is ${listingStatus} and cannot accept offer changes right now.`);
      return;
    }

    const timelineDays = parseInt(timelineInput?.value, 10);
    if (!Number.isFinite(timelineDays) || timelineDays < 1 || timelineDays > 365) {
      showError("Enter how many days you need to deliver.");
      timelineInput?.focus();
      return;
    }

    const payload = {
      listing_id: listingId,
      consultant_id: myId,
      message: msgInput.value.trim() || null,
      timeline_days: timelineDays,
    };

    if (isPhased) {
      // Parse with a fallback to 0 so a blank or non-numeric proposal-
      // fee input is treated as "skipped" rather than failing the bid.
      const proposalRaw = parseFloat(proposalFeeInput.value);
      const proposalCents = Number.isFinite(proposalRaw) ? Math.round(proposalRaw * 100) : 0;
      const serviceCents = Math.round(parseFloat(serviceFeeInput.value) * 100);
      if (!isValidOfferCents(proposalCents)) {
        showError("The proposal fee must be $0 or at least $10.");
        return;
      }
      if (!Number.isFinite(serviceCents) || serviceCents < MIN_PAID_OFFER_CENTS) {
        showError("The offer amount must be at least $10.");
        return;
      }
      // proposal_budget on the listing is a soft ceiling — enforce only if set.
      if (listing.proposal_budget != null && proposalCents > Number(listing.proposal_budget) * 100) {
        showError(`Proposal fee can't exceed the business's budget of ${formatUsd(Number(listing.proposal_budget) * 100)}.`);
        return;
      }
      payload.proposal_fee_cents = proposalCents;
      payload.service_fee_cents = serviceCents;
      // Mirror the headline cost into amount_cents (NOT NULL) so legacy
      // surfaces (dashboards, search) still show a sensible number. The
      // phased payment flow reads proposal_fee_cents + service_fee_cents
      // explicitly.
      payload.amount_cents = serviceCents;
    } else {
      const cents = Math.round(parseFloat(amountInput.value) * 100);
      if (!Number.isFinite(cents)) {
        showError("Enter a valid amount.");
        return;
      }
      if (isRetainer ? cents < MIN_PAID_OFFER_CENTS : !isValidOfferCents(cents)) {
        showError(isRetainer ? "The fee per period must be at least $10." : "Offers are free or at least $10.");
        return;
      }
      payload.amount_cents = cents;
    }

    submitBtn.disabled = true;
    submitBtn.classList.add("is-loading");
    // Upload pitch files first so the bid row only ever references files
    // that exist. First path segment is the uploader's id (storage policy).
    if (pitchFiles.length) {
      const uploaded = [];
      for (const f of pitchFiles) {
        const path = `${myId}/${listingId}/${Date.now()}-${f.name.replace(/[^\w.\-]+/g, "_")}`;
        const { error: upErr } = await client.storage.from("bid-files").upload(path, f, { upsert: false });
        if (upErr) {
          showError(`Could not upload ${f.name}: ${upErr.message}`);
          submitBtn.disabled = false;
          submitBtn.classList.remove("is-loading");
          return;
        }
        uploaded.push({ path, name: f.name, size: f.size });
      }
      payload.pitch_files = uploaded;
    }

    // Insert-only: offers can't be edited once submitted (enforced in the DB).
    const { error } = await client.from("bids").insert(payload);
    if (error) {
      if (error.hint === "training_required") {
        trainingBlocked = true;
        syncSubmitDisabled();
        showTrainingToast();
      } else {
        showError(error.code === "23505" ? "You already sent an offer on this listing." : error.message);
      }
      submitBtn.disabled = false;
      submitBtn.classList.remove("is-loading");
      return;
    }
    // Tell the business. notif_caller_can_send_to lets a bidder notify
    // the listing owner. Best-effort: the offer is in either way.
    try {
      const { data: me } = await client.from("profiles").select("full_name").eq("id", myId).maybeSingle();
      const who = String(me?.full_name || "").trim() || "A consultant";
      // Free offers are consultant-only copy: never name a $0 price to
      // the business.
      const what = isPhased
        ? (payload.proposal_fee_cents > 0
          ? `${formatUsd(payload.proposal_fee_cents)} for a proposal and ${formatUsd(payload.service_fee_cents)} for the job`
          : `${formatUsd(payload.service_fee_cents)} for the job`)
        : isRetainer
        ? `${formatUsd(payload.amount_cents)} per period`
        : payload.amount_cents > 0 ? formatUsd(payload.amount_cents) : "";
      await client.from("notifications").insert({
        user_id: listing.owner_id,
        type: "bid_received",
        title: `New offer on ${listing.title}`,
        body: what ? `${who} offered ${what}.` : `${who} sent you an offer.`,
        link: `/listing.html?id=${listing.id}`,
      });
    } catch (notifyErr) {
      console.warn("new offer notification failed:", notifyErr);
    }
    // Offers are immutable once submitted — reload so the form is replaced
    // by the read-only summary on next render. The toast is carried across
    // the reload; keep the spinner up until navigation kicks in.
    flashToast("Offer submitted. The business has been notified.");
    window.location.reload();
  });

  /* --- "have a question?" button + chat drawer --- */
  setupChatDrawer(client, listing, myId, ownerId);
}

async function setupChatDrawer(client, listing, myId, ownerId) {
  /* Reveal the button */
  const questionWrap = document.getElementById("ld-question-wrap");
  questionWrap.hidden = false;

  // Drawer markup lives in a <template> — we only clone it into the DOM the
  // first time the consultant clicks "have a question?". Until then, none of
  // the chat panel / backdrop / inputs exist in the document at all.
  let drawer = null;
  let backdrop = null;
  let closeBtn = null;
  let thread = null;
  let input = null;
  let sendBtn = null;
  let chatCharCount = null;
  let contextBanner = null;
  let contextTitle = null;
  let inboxLink = null;
  let drawerLoaded = false;
  let messages = [];

  // Drive open/close purely off aria-hidden so the CSS transitions on
  // .ld-chat-drawer__panel (transform) and .ld-chat-drawer__backdrop
  // (opacity) actually play. The drawer is appended in its closed state
  // (aria-hidden="true"), so we wait two animation frames before flipping
  // it open — that lets the browser register the initial off-screen state
  // before transitioning to the on-screen one.
  function openDrawer() {
    if (!drawer) return;
    document.body.style.overflow = "hidden";
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        drawer.setAttribute("aria-hidden", "false");
        input?.focus();
      });
    });
  }

  function closeDrawer() {
    if (!drawer) return;
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  // Lazily clone the drawer template into the body and wire its listeners.
  // Called the first time the question button is clicked.
  function mountDrawer() {
    if (drawerLoaded) return;
    const tpl = document.getElementById("ld-chat-drawer-template");
    if (!tpl) return;
    const fragment = tpl.content.cloneNode(true);
    document.body.appendChild(fragment);

    drawer = document.getElementById("ld-chat-drawer");
    backdrop = document.getElementById("ld-chat-backdrop");
    closeBtn = document.getElementById("ld-chat-close");
    thread = document.getElementById("ld-chat-thread");
    input = document.getElementById("ld-chat-input");
    sendBtn = document.getElementById("ld-chat-send");
    chatCharCount = document.getElementById("ld-chat-char-count");
    contextBanner = document.getElementById("ld-chat-context");
    contextTitle = document.getElementById("ld-chat-context-title");
    inboxLink = document.getElementById("ld-chat-inbox-link");

    if (inboxLink && listing?.id && ownerId && myId && ownerId !== myId) {
      inboxLink.href = `/inbox.html#thread=${encodeURIComponent(listing.id)}:${encodeURIComponent(ownerId)}`;
    }

    closeBtn.addEventListener("click", closeDrawer);
    backdrop.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && drawer.getAttribute("aria-hidden") === "false") closeDrawer();
    });

    input.addEventListener("input", () => {
      if (!contextBanner.hidden) {
        const remaining = 200 - input.value.length;
        chatCharCount.textContent = remaining;
        chatCharCount.classList.toggle("ld-chat-char-count--low", remaining < 40);
      }
    });

    sendBtn.addEventListener("click", handleSend);
    drawerLoaded = true;
  }

  document.getElementById("ld-question-btn").addEventListener("click", async () => {
    mountDrawer();
    if (!messages.length && !drawer.dataset.threadLoaded) {
      messages = await loadMessages(client, listing.id, ownerId);
      renderChatThread(thread, messages, myId);
      drawer.dataset.threadLoaded = "1";

      /* Show locked context header only if this will be the first message */
      if (!messages.length) {
        contextTitle.textContent = listing.title;
        contextBanner.hidden = false;
        input.maxLength = 200;
        chatCharCount.textContent = "200";
      } else {
        input.maxLength = 2000;
        chatCharCount.hidden = true;
      }
    }
    openDrawer();
  });

  async function handleSend() {
    const body = input.value.trim();
    if (!body) return;

    /* First message: prepend the listing context as a stored prefix */
    const isFirst = !messages.length;
    const fullBody = isFirst
      ? `re: ${listing.title}\u001F${body}`   /* \u001F = unit separator — used as our delimiter */
      : body;

    sendBtn.disabled = true;
    const { data, error } = await client.from("messages").insert({
      listing_id: listing.id,
      sender_id: myId,
      recipient_id: ownerId,
      body: fullBody,
    }).select().single();

    if (error) { console.error(error); sendBtn.disabled = false; return; }

    messages.push(data);
    input.value = "";
    appendChatBubble(thread, { ...data, body: fullBody }, myId);
    thread.scrollTop = thread.scrollHeight;
    sendBtn.disabled = false;

    /* After first send, hide context banner + switch to regular compose */
    if (isFirst) {
      contextBanner.hidden = true;
      input.maxLength = 2000;
      chatCharCount.hidden = true;
    }
  }
}

/* Render the full thread inside the chat drawer */
function renderChatThread(container, messages, myId) {
  if (!messages.length) {
    container.innerHTML = '<p class="ld-msg-empty">No messages yet.</p>';
    return;
  }
  container.innerHTML = "";
  messages.forEach((m) => appendChatBubble(container, m, myId));
  container.scrollTop = container.scrollHeight;
}

function appendChatBubble(container, m, myId) {
  container.querySelector(".ld-msg-empty")?.remove();
  const mine = m.sender_id === myId;
  const time = new Date(m.created_at || Date.now()).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  /* Detect context-prefixed first messages */
  const SEP = "\u001F";
  const hasContext = m.body.includes(SEP);
  let contextPart = null;
  let bodyPart = m.body;
  if (hasContext) {
    const idx = m.body.indexOf(SEP);
    contextPart = m.body.slice(0, idx).replace(/^re:\s*/i, "").trim();
    bodyPart = m.body.slice(idx + 1).trim();
  }

  const bubble = document.createElement("div");
  bubble.className = `ld-msg-bubble ${mine ? "ld-msg-bubble--mine" : "ld-msg-bubble--theirs"}`;

  bubble.innerHTML = `
    ${hasContext ? `<div class="ld-msg-context-tag"><span class="ld-msg-context-tag__re">Re:</span> ${escapeHtml(contextPart)}</div>` : ""}
    <p class="ld-msg-text">${escapeHtml(bodyPart)}</p>
    <span class="ld-msg-time">${time}</span>
  `;
  container.appendChild(bubble);
}

/* ================================================================
   Owner view: bids list with accept, counter-offer, messaging
   ================================================================ */

/* ================================================================
   Consultant profile slideshow viewer (owner-only, listing.html)
   ================================================================ */

const consultantViewerState = {
  client: null,
  bids: [],
  index: 0,
  cache: new Map(),
  resumeCache: new Map(),
  engagementsCache: new Map(),
  wired: false,
  activeTab: "pitch",
  // Element that had focus before the viewer opened — used to restore
  // focus when the viewer closes (a11y best practice for modals).
  returnFocusEl: null,
};

function setupConsultantViewer(client, bids) {
  consultantViewerState.client = client;
  consultantViewerState.bids = bids;
  if (consultantViewerState.wired) return;
  consultantViewerState.wired = true;

  // Open the viewer when any bid card's name button is clicked.
  document.addEventListener("click", (event) => {
    const opener = event.target.closest("[data-cv-open]");
    if (opener instanceof HTMLElement) {
      event.preventDefault();
      const bidId = opener.getAttribute("data-cv-bid-id");
      const idx = consultantViewerState.bids.findIndex((b) => b.id === bidId);
      if (idx >= 0) openConsultantViewer(idx);
      return;
    }
    const closer = event.target.closest("[data-cv-close]");
    if (closer instanceof HTMLElement) {
      event.preventDefault();
      closeConsultantViewer();
    }
  });

  document.getElementById("ld-cv-prev")?.addEventListener("click", () => {
    if (!consultantViewerState.bids.length) return;
    const total = consultantViewerState.bids.length;
    openConsultantViewer((consultantViewerState.index - 1 + total) % total);
  });
  document.getElementById("ld-cv-next")?.addEventListener("click", () => {
    if (!consultantViewerState.bids.length) return;
    const total = consultantViewerState.bids.length;
    openConsultantViewer((consultantViewerState.index + 1) % total);
  });

  document.addEventListener("keydown", (event) => {
    const viewer = document.getElementById("ld-cv");
    if (!viewer || viewer.classList.contains("hidden")) return;
    if (event.key === "Escape") closeConsultantViewer();
    else if (event.key === "ArrowLeft") document.getElementById("ld-cv-prev")?.click();
    else if (event.key === "ArrowRight") document.getElementById("ld-cv-next")?.click();
  });

  document.querySelectorAll(".ld-cv__tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const which = tab.dataset.cvTab;
      if (which) selectConsultantViewerTab(which);
    });
  });
}

function selectConsultantViewerTab(which) {
  consultantViewerState.activeTab = which;
  document.querySelectorAll(".ld-cv__tab").forEach((tab) => {
    const active = tab.dataset.cvTab === which;
    tab.classList.toggle("is-active", active);
    tab.setAttribute("aria-selected", active ? "true" : "false");
  });
  document.querySelectorAll(".ld-cv__panel").forEach((panel) => {
    const active = panel.dataset.cvPanel === which;
    if (active) {
      // Show first, force reflow so the closed-state CSS commits, then
      // add .is-active so the opacity/transform transition actually runs.
      panel.hidden = false;
      panel.classList.remove("is-active");
      void panel.offsetWidth;
      panel.classList.add("is-active");
    } else {
      panel.classList.remove("is-active");
      panel.hidden = true;
    }
  });
  if (which === "resume") {
    const bid = consultantViewerState.bids[consultantViewerState.index];
    if (bid) loadResumePanel(bid.consultant_id);
  }
}

function openConsultantViewer(index) {
  const viewer = document.getElementById("ld-cv");
  const { bids } = consultantViewerState;
  const bid = bids[index];
  if (!viewer || !bid) return;
  // Remember what had focus so we can return there on close. Only remember
  // on the first open, not when navigating between consultants.
  if (viewer.classList.contains("hidden")) {
    consultantViewerState.returnFocusEl = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
  }
  consultantViewerState.index = index;
  viewer.classList.remove("hidden");
  viewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("gr-modal-open");
  // Pull keyboard focus into the modal so screen readers and keyboard
  // users land inside it. Defer to the next frame so visibility flips
  // before the focus call.
  requestAnimationFrame(() => {
    const closeBtn = viewer.querySelector("[data-cv-close]");
    if (closeBtn instanceof HTMLElement) closeBtn.focus();
  });

  const total = bids.length;
  const indexEl = document.getElementById("ld-cv-index");
  const totalEl = document.getElementById("ld-cv-total");
  if (indexEl) indexEl.textContent = String(index + 1);
  if (totalEl) totalEl.textContent = String(total);

  const prevBtn = document.getElementById("ld-cv-prev");
  const nextBtn = document.getElementById("ld-cv-next");
  if (prevBtn) prevBtn.hidden = total <= 1;
  if (nextBtn) nextBtn.hidden = total <= 1;

  const titleEl = document.getElementById("ld-cv-title");
  const consultantName = bid.profiles?.full_name || "consultant";
  if (titleEl) titleEl.textContent = consultantName;
  const amountEl = document.getElementById("ld-cv-amount");
  const timelineEl = document.getElementById("ld-cv-timeline");
  if (amountEl) amountEl.textContent = formatUsd(bid.amount_cents);
  if (timelineEl) timelineEl.textContent = formatTimelineDays(bid.timeline_days);
  renderPitchPanel(bid);

  const statusEl = document.getElementById("ld-cv-status");
  const contentEl = document.getElementById("ld-cv-content");
  const resumePanel = document.getElementById("ld-cv-panel-resume");
  const workPanel = document.getElementById("ld-cv-panel-work");
  if (statusEl) {
    statusEl.textContent = "Loading…";
    statusEl.className = "gr-status";
    statusEl.hidden = false;
  }
  if (contentEl) contentEl.innerHTML = "";
  if (resumePanel) resumePanel.innerHTML = "";
  if (workPanel) workPanel.innerHTML = "";

  selectConsultantViewerTab("pitch");

  loadConsultantProfile(bid.consultant_id)
    .then((data) => {
      if (consultantViewerState.bids[consultantViewerState.index]?.id !== bid.id) return; // user navigated away
      const titleEl = document.getElementById("ld-cv-title");
      if (titleEl) {
        titleEl.innerHTML = `${escapeHtml(data.profile?.full_name || "consultant")} ${renderRatingMarkup(data.rating, { size: "md" })}`;
      }
      renderConsultantViewerContent(data);
      renderConsultantPastWorkPanel(bid.consultant_id, data);
      if (statusEl) statusEl.hidden = true;
    })
    .catch((err) => {
      if (consultantViewerState.bids[consultantViewerState.index]?.id !== bid.id) return;
      if (statusEl) {
        statusEl.textContent = err?.message || "Could not load consultant profile.";
        statusEl.className = "gr-status error";
      }
    });
}

function closeConsultantViewer() {
  const viewer = document.getElementById("ld-cv");
  if (!viewer) return;
  viewer.classList.add("hidden");
  viewer.setAttribute("aria-hidden", "true");
  document.body.classList.remove("gr-modal-open");
  // Return focus to whatever opened the viewer, so keyboard users don't
  // get stranded at the top of the page.
  const returnTo = consultantViewerState.returnFocusEl;
  consultantViewerState.returnFocusEl = null;
  if (returnTo && document.contains(returnTo)) {
    requestAnimationFrame(() => returnTo.focus());
  }
}

async function loadConsultantProfile(consultantId) {
  if (!consultantId) throw new Error("Missing consultant ID");
  if (consultantViewerState.cache.has(consultantId)) {
    return consultantViewerState.cache.get(consultantId);
  }
  const client = consultantViewerState.client;
  const { data: { session } } = await client.auth.getSession();
  const headers = {};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(`/api/consultant-profile/${encodeURIComponent(consultantId)}`, { headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.profile) {
    throw new Error(data.error || "Consultant profile not found.");
  }
  consultantViewerState.cache.set(consultantId, data);
  return data;
}

function formatTimelineDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return "Not set";
  return `${n} day${n === 1 ? "" : "s"}`;
}

// Pitch = the consultant's message + any files they attached to the offer.
// Amount and timeline live in the header block, so this panel is prose only.
function renderPitchPanel(bid) {
  const panel = document.getElementById("ld-cv-panel-pitch");
  if (!panel) return;
  const files = Array.isArray(bid.pitch_files) ? bid.pitch_files : [];
  const messageHtml = bid.message
    ? `<div class="ld-cv__pitch-body">${escapeHtml(bid.message).replace(/\n/g, "<br />")}</div>`
    : `<p class="ld-cv__panel-empty">This consultant didn't include a pitch with their offer.</p>`;
  const filesHtml = files.length
    ? `
      <div class="ld-cv__work-section">
        <p class="ld-cv__work-section-title">Supporting files</p>
        <div class="ld-cv__work-list">
          ${files.map((f) => `
            <a class="ld-cv__file" href="${escapeAttr(f.url || "#")}" target="_blank" rel="noopener noreferrer">
              <span class="ld-cv__file-name">${escapeHtml(f.name || "file")}</span>
              ${f.size ? `<span class="ld-cv__file-size">${escapeHtml(formatFileSize(f.size))}</span>` : ""}
              <span class="ld-cv__file-open" aria-hidden="true">Open ↗</span>
            </a>
          `).join("")}
        </div>
      </div>
    `
    : "";
  panel.innerHTML = `${messageHtml}${filesHtml}`;
}

function renderConsultantViewerContent({ profile, education, rating }) {
  const contentEl = document.getElementById("ld-cv-content");
  if (!contentEl) return;
  const edu = education || {};

  const avatarHtml = profile.avatar_url
    ? `<img class="pf-bv__avatar" src="${escapeAttr(profile.avatar_url)}" alt="" />`
    : `<div class="pf-bv__avatar-placeholder" aria-hidden="true">${escapeHtml(getInitials(profile.full_name))}</div>`;

  const dims = [
    ["Work product", rating?.work_product_quality_avg],
    ["Communication", rating?.communication_avg],
    ["Timeliness", rating?.timeliness_avg],
    ["Professionalism", rating?.professionalism_avg],
    ["Cost value", rating?.cost_value_avg],
  ];
  const ratingBreakdown = rating?.review_count
    ? `
      <div class="pf-bv__section">
        <p class="pf-bv__section-title">Ratings · ${rating.review_count} review${rating.review_count === 1 ? "" : "s"}</p>
        <div class="ld-cv__rating-grid">
          ${dims.map(([label, val]) => `
            <div class="ld-cv__rating-row">
              <span class="ld-cv__rating-row__label">${label}</span>
              ${renderRatingMarkup({ rating_average: val, review_count: 1 }, { size: "sm", showCount: false })}
            </div>
          `).join("")}
        </div>
      </div>
    `
    : "";

  // Header: name, primary degree line, then a compact meta row (location,
  // tenure, LinkedIn as a short link). Education detail sits directly under
  // the header; ratings close out the panel.
  const headerLine = formatConsultantEducationLine(edu);
  const eduEntriesHtml = renderEducationEntriesList(edu);
  const metaBits = [];
  if (profile.city) metaBits.push(`<span>${escapeHtml(profile.city)}</span>`);
  if (profile.completed_count) {
    metaBits.push(`<span>${profile.completed_count} completed project${profile.completed_count === 1 ? "" : "s"}</span>`);
  }
  if (profile.member_since) {
    const since = new Date(profile.member_since).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    metaBits.push(`<span>Joined ${escapeHtml(since)}</span>`);
  }
  if (profile.linkedin_url) {
    metaBits.push(`<a class="pf-bv__link" href="${escapeAttr(profile.linkedin_url)}" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>`);
  }
  const metaRow = metaBits.length
    ? `<p class="pf-bv__meta-row">${metaBits.join('<span class="pf-bv__dot" aria-hidden="true">·</span>')}</p>`
    : "";

  contentEl.innerHTML = `
    <div class="pf-bv">
      <div class="pf-bv__header">
        ${avatarHtml}
        <div>
          <h2 class="pf-bv__name">${escapeHtml(profile.full_name)}</h2>
          ${headerLine ? `<p class="pf-bv__meta">${escapeHtml(headerLine)}</p>` : ""}
          ${metaRow}
        </div>
      </div>
      ${eduEntriesHtml ? `
        <div class="pf-bv__section">
          <p class="pf-bv__section-title">Education</p>
          ${eduEntriesHtml}
        </div>
      ` : ""}
      ${ratingBreakdown}
      ${(!profile.linkedin_url && !eduEntriesHtml && !ratingBreakdown) ? `
        <p class="pf-bv__empty">This consultant hasn't shared any public bio details yet.</p>
      ` : ""}
    </div>
  `;
}

async function renderConsultantPastWorkPanel(consultantId, data) {
  const panel = document.getElementById("ld-cv-panel-work");
  if (!panel) return;
  const portfolio = Array.isArray(data?.portfolio) ? data.portfolio : [];
  panel.innerHTML = `<p class="gr-status" data-cv-loading>Loading past work…</p>`;

  const engagements = await loadConsultantEngagements(consultantId).catch(() => []);

  if (consultantViewerState.bids[consultantViewerState.index]?.consultant_id !== consultantId) return;

  const sections = [];
  if (engagements.length) {
    sections.push(`
      <div class="ld-cv__work-section">
        <p class="ld-cv__work-section-title">Past engagements</p>
        <div class="ld-cv__work-list">
          ${engagements.map((eng) => {
            const title = eng.listings?.title || "engagement";
            const scope = eng.listings?.description || "";
            const amount = eng.amount_cents != null ? formatUsd(eng.amount_cents) : "";
            return `
              <div class="ld-cv__work-row">
                <div>
                  <p class="ld-cv__work-row__title">${escapeHtml(title)}</p>
                  ${scope ? `<p class="ld-cv__work-row__scope">${escapeHtml(truncateScope(scope))}</p>` : ""}
                </div>
                ${amount ? `<span class="ld-cv__work-row__amount">${escapeHtml(amount)}</span>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `);
  }

  if (portfolio.length) {
    sections.push(`
      <div class="ld-cv__work-section">
        <p class="ld-cv__work-section-title">Shared files</p>
        <div class="ld-cv__work-list">
          ${portfolio.map((item) => {
            const fileName = (item.file_path || "").split("/").pop() || "file";
            const url = item.url || "#";
            return `
              <div class="ld-cv__work-row">
                <div>
                  <p class="ld-cv__work-row__title">${escapeHtml(fileName)}</p>
                  ${item.description ? `<p class="ld-cv__work-row__scope">${escapeHtml(item.description)}</p>` : ""}
                  <a class="ld-cv__work-row__file" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Open file ↗</a>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `);
  }

  panel.innerHTML = sections.length
    ? sections.join("")
    : `<p class="ld-cv__panel-empty">No past engagements or shared files yet.</p>`;
}

async function loadConsultantEngagements(consultantId) {
  if (consultantViewerState.engagementsCache.has(consultantId)) {
    return consultantViewerState.engagementsCache.get(consultantId);
  }
  const client = consultantViewerState.client;
  if (!client) return [];
  const { data, error } = await client
    .from("bids")
    .select("id, amount_cents, accepted_at, listings!inner(id, title, description, status)")
    .eq("consultant_id", consultantId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(20);
  if (error) return [];
  const list = data || [];
  consultantViewerState.engagementsCache.set(consultantId, list);
  return list;
}

function truncateScope(text, max = 180) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

async function loadResumePanel(consultantId) {
  const panel = document.getElementById("ld-cv-panel-resume");
  if (!panel) return;

  if (consultantViewerState.resumeCache.has(consultantId)) {
    panel.innerHTML = consultantViewerState.resumeCache.get(consultantId);
    return;
  }

  const data = consultantViewerState.cache.get(consultantId);
  const profile = data?.profile;

  if (!profile?.resume_on_file) {
    const html = `<p class="ld-cv__panel-empty">This consultant has not made a resume publicly visible.</p>`;
    panel.innerHTML = html;
    consultantViewerState.resumeCache.set(consultantId, html);
    return;
  }
  if (!profile?.resume_available) {
    const html = `<p class="ld-cv__panel-empty">Resume is not available to your account.</p>`;
    panel.innerHTML = html;
    consultantViewerState.resumeCache.set(consultantId, html);
    return;
  }

  panel.innerHTML = `<p class="gr-status">Loading resume…</p>`;

  try {
    const client = consultantViewerState.client;
    const { data: { session } } = await client.auth.getSession();
    const headers = {};
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(`/api/consultant-profile/${encodeURIComponent(consultantId)}/resume`, { headers });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || !body.url) throw new Error(body.error || "Could not open resume.");

    if (consultantViewerState.bids[consultantViewerState.index]?.consultant_id !== consultantId) return;
    if (consultantViewerState.activeTab !== "resume") return;

    const html = `
      <div class="ld-cv__resume-actions">
        <a class="gr-btn gr-btn--ghost gr-btn--sm" href="${escapeAttr(body.url)}" target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>
      </div>
      <iframe class="ld-cv__resume-frame" src="${escapeAttr(body.url)}" title="${escapeAttr((body.file_name || "resume"))}"></iframe>
    `;
    panel.innerHTML = html;
    consultantViewerState.resumeCache.set(consultantId, html);
  } catch (err) {
    panel.innerHTML = `<p class="gr-status error">${escapeHtml(err?.message || "Could not load resume.")}</p>`;
  }
}

function showOwnerBids(client, session, listing, bids, educationMap = new Map()) {
  const section = document.getElementById("ld-bids-owner");
  section.hidden = false;

  // Initialise the consultant slideshow viewer with this run's bids.
  setupConsultantViewer(client, bids);

  const list = document.getElementById("ld-bids-list");
  const budgetEl = document.getElementById("ld-counter-budget");
  // A counter stays "used" after the consultant answers it (the offer
  // fields clear but counter_attempted stays true).
  const totalCounters = bids.filter((b) => b.counter_attempted || b.counter_offer_cents != null).length;
  budgetEl.textContent = `Counter-offers used: ${totalCounters} / 3`;

  if (!bids.length) {
    list.innerHTML = '<p class="ld-bids-empty">No offers yet.</p>';
    return;
  }

  list.innerHTML = "";

  // Phased multi-accept state. The owner ticks one or more pending phased
  // bids → a sticky cta at the bottom of the panel charges all selected
  // proposal fees in a single PaymentIntent.
  const isPhasedListing = listing.contract_type === "phased";
  const selectedBidIds = new Set();
  let proposalCtaEl = null;
  let proposalCtaBtn = null;
  let proposalCtaTotalEl = null;
  let proposalCtaLabelEl = null;

  function renderProposalCta() {
    if (!proposalCtaEl) return;
    const selected = bids.filter((b) => selectedBidIds.has(b.id));
    const total = selected.reduce((sum, b) => sum + Number(b.proposal_fee_cents || 0), 0);
    if (!selected.length) {
      proposalCtaEl.classList.add("hidden");
      return;
    }
    proposalCtaEl.classList.remove("hidden");
    if (proposalCtaLabelEl) {
      proposalCtaLabelEl.textContent = `${selected.length} ${selected.length === 1 ? "proposal" : "proposals"} selected`;
    }
    proposalCtaTotalEl.textContent = formatUsd(total);
    if (total === 0) {
      proposalCtaBtn.textContent = selected.length === 1 ? "Accept proposal" : `Accept ${selected.length} proposals`;
    } else {
      proposalCtaBtn.textContent = selected.length === 1
        ? "Pay proposal fee"
        : `Pay ${selected.length} proposal fees`;
    }
  }

  async function handlePayProposals() {
    const selected = bids.filter((b) => selectedBidIds.has(b.id));
    if (!selected.length) return;
    proposalCtaBtn.disabled = true;
    try {
      const result = await payAndAcceptProposals({ client, bids: selected, listing });
      if (result?.ok) {
        showSuccess(result.free
          ? `${selected.length === 1 ? "Proposal" : "Proposals"} accepted.`
          : `Proposal fees held for ${selected.length} consultant${selected.length === 1 ? "" : "s"}.`);
        window.location.reload();
      }
    } catch (err) {
      showError(err?.message || "Could not start payment.");
    } finally {
      proposalCtaBtn.disabled = false;
    }
  }

  for (const b of bids) {
    const card = document.createElement("div");
    card.className = `ld-bid-card ld-bid-card--${b.status || "pending"}`;
    const p = b.profiles;
    const rawName = p?.full_name || "Consultant";
    const name = escapeHtml(rawName);
    // Rating chip sits on its own row beneath the name so longer names
    // get more horizontal room before they truncate.
    const ratingChip = b.consultant_id
      ? `<span class="ld-bid-card__rating" data-consultant-rating="${escapeAttr(b.consultant_id)}" data-rating-size="sm" data-rating-count="false"></span>`
      : "";
    // Avatar AND name both open the consultant viewer (deeper profile).
    // The bottom-right "view profile →" link below is a third entry
    // point — three obvious affordances so the owner doesn't miss it.
    const cvAttrs = b.consultant_id
      ? ` data-cv-open data-cv-bid-id="${escapeAttr(b.id)}"`
      : "";
    const nameHtml = b.consultant_id
      ? `<button type="button" class="ld-bid-card__name-btn"${cvAttrs} aria-label="View ${name}'s profile">${name}</button>`
      : `<span class="ld-bid-card__name-btn">${name}</span>`;
    const avatar = publicAvatarUrl(client, p?.avatar_path);
    const msg = b.message ? `<p class="ld-bid-card__message">${escapeHtml(b.message)}</p>` : "";
    const avatarInner = avatar
      ? `<img src="${escapeAttr(avatar)}" width="68" height="68" alt="" />`
      : `<span class="ld-bid-card__avatar-fallback" aria-hidden="true">${escapeHtml(getInitials(rawName))}</span>`;
    const avatarHtml = b.consultant_id
      ? `<button type="button" class="ld-bid-card__avatar"${cvAttrs} tabindex="-1" aria-hidden="true">${avatarInner}</button>`
      : `<span class="ld-bid-card__avatar" aria-hidden="true">${avatarInner}</span>`;

    // Bio — "major @ school" under the rating. Inline format on
    // purpose (not formatConsultantEducationLine, which the consultant
    // viewer modal still uses): drops the "bachelor's in" degree
    // prefix and lowercases both parts per the bid-card mockup spec.
    const education = b.education || educationMap.get(b.consultant_id) || null;
    const eduPrimary = Array.isArray(education?.educations) && education.educations[0]
      ? education.educations[0]
      : education || {};
    const eduMajor = (eduPrimary.major || "").trim().toLowerCase();
    const eduSchool = (eduPrimary.school || "").trim().toLowerCase();
    const eduLine = eduMajor && eduSchool
      ? `${eduMajor} @ ${eduSchool}`
      : eduMajor || eduSchool || "";
    const bioHtml = eduLine ? `<p class="ld-bid-card__bio">${escapeHtml(eduLine)}</p>` : "";

    // One status pill — pending shows nothing (default state); accepted/countered/declined get a chip.
    const statusPillMap = {
      accepted: { kind: "accepted", label: "Accepted · ongoing" },
      countered: { kind: "warn", label: "Countered" },
      declined: { kind: "muted", label: "Declined" },
    };
    const pillInfo = statusPillMap[b.status];
    const statusPill = pillInfo
      ? `<span class="gr-pill gr-pill--${pillInfo.kind}">${escapeHtml(pillInfo.label)}</span>`
      : "";

    const counterInfo = b.counter_offer_cents
      ? `<p class="ld-bid-card__counter">Your counter: <strong>${formatUsd(b.counter_offer_cents)}</strong>${b.counter_offer_message ? ` — "${escapeHtml(b.counter_offer_message)}"` : ""}</p>`
      : "";
    // The consultant's note when they answered the counter (accept,
    // keep their price, or withdraw). Saved on the bid; shown here so the
    // business actually sees it.
    const counterReply = !b.counter_offer_cents && b.counter_responded_at && b.counter_response_message
      ? `<p class="ld-bid-card__counter">Their reply to your counter: "${escapeHtml(b.counter_response_message)}"</p>`
      : "";

    // Amount stack — phased shows proposal + full-job rows; standard
    // shows a single value. Both use the same vertical stack so the
    // visual rhythm is consistent across listing types.
    const amountHtml = isPhasedListing && b.proposal_fee_cents != null
      ? `<div class="ld-bid-card__amounts">
           <div class="ld-bid-card__amount-row"><strong class="ld-bid-card__amount-value">${formatUsd(b.proposal_fee_cents)}</strong><span class="ld-bid-card__amount-tag">Proposal</span></div>
           <div class="ld-bid-card__amount-row"><strong class="ld-bid-card__amount-value">${formatUsd(b.service_fee_cents || 0)}</strong><span class="ld-bid-card__amount-tag">Full job</span></div>
         </div>`
      : `<div class="ld-bid-card__amounts">
           <div class="ld-bid-card__amount-row"><strong class="ld-bid-card__amount-value">${formatUsd(b.amount_cents)}</strong><span class="ld-bid-card__amount-tag">Offer${b.timeline_days ? ` · ${escapeHtml(formatTimelineDays(b.timeline_days))}` : ""}</span></div>
         </div>`;

    // "view profile →" link in the bottom-right of the foot. Uses the
    // same data-cv-open hook as the avatar + name so the consultant
    // viewer opens regardless of which affordance the owner clicks.
    const viewProfileLink = b.consultant_id
      ? `<button type="button" class="ld-bid-card__view-profile"${cvAttrs}>View profile <span aria-hidden="true">→</span></button>`
      : "";

    // Message icon sits absolute top-right of the card (per the
    // mockup). Placeholder; the real button is created and wired
    // below so we keep the click handler in JS.
    card.innerHTML = `
      ${statusPill ? `<div class="ld-bid-card__top">${statusPill}</div>` : ""}
      <div class="ld-bid-card__msg-toggle-slot"></div>
      <div class="ld-bid-card__head">
        ${avatarHtml}
        <div class="ld-bid-card__id">
          <span class="ld-bid-card__name">${nameHtml}</span>
          ${ratingChip}
          ${bioHtml}
        </div>
      </div>
      ${amountHtml}
      ${msg}
      ${counterInfo}
      ${counterReply}
      <div class="ld-bid-card__foot">
        <div class="ld-bid-card__actions"></div>
        ${viewProfileLink}
      </div>
      <div class="ld-bid-card__counter-form hidden"></div>
      <div class="ld-bid-card__msg-area hidden"></div>
    `;

    const actionsEl = card.querySelector(".ld-bid-card__actions");
    const counterFormEl = card.querySelector(".ld-bid-card__counter-form");
    const msgAreaEl = card.querySelector(".ld-bid-card__msg-area");

    /* Accept button (standard / retainer) or checkbox (phased multi-accept) */
    if (b.status === "pending" || b.status === "countered") {
      if (isPhasedListing) {
        const cbWrap = document.createElement("label");
        cbWrap.className = "ld-bid-card__select";
        cbWrap.innerHTML = `
          <input type="checkbox" class="ld-bid-card__checkbox" />
          <span>Accept proposal</span>
        `;
        const cb = cbWrap.querySelector("input");
        cb.addEventListener("change", () => {
          if (cb.checked) selectedBidIds.add(b.id);
          else selectedBidIds.delete(b.id);
          renderProposalCta();
        });
        actionsEl.appendChild(cbWrap);
      } else {
        const acceptBtn = document.createElement("button");
        acceptBtn.className = "gr-btn gr-btn--primary gr-btn--sm";
        acceptBtn.textContent = "Accept";
        acceptBtn.addEventListener("click", async () => {
          // If there's an active counter awaiting a consultant
          // response, accepting now MUST charge the consultant's
          // original price — not the owner's counter (which the
          // consultant hasn't agreed to). Warn explicitly and confirm.
          if (b.status === "countered" && b.counter_offer_cents != null) {
            const choice = await openConfirmModal({
              title: "Accept the original offer?",
              body: [
                `${rawName} hasn't decided on your counter yet.`,
                `Accepting now charges their original price of ${formatUsd(b.amount_cents)}, not your counter of ${formatUsd(b.counter_offer_cents)}.`,
              ],
              actions: [
                { label: "Cancel", kind: "ghost", value: "cancel" },
                { label: `Accept at ${formatUsd(b.amount_cents)}`, kind: "primary", value: "confirm" },
              ],
            });
            if (choice !== "confirm") return;
            // Strip the counter so handleAcceptBid sees a plain bid
            // and uses amount_cents (its existing fallback path).
            await client
              .from("bids")
              .update({
                status: "pending",
                counter_offer_cents: null,
                counter_offer_message: null,
                counter_expires_at: null,
                counter_responded_at: new Date().toISOString(),
              })
              .eq("id", b.id);
            b.status = "pending";
            b.counter_offer_cents = null;
            b.counter_offer_message = null;
            b.counter_expires_at = null;
          }
          handleAcceptBid(client, session, listing, b, card);
        });
        actionsEl.appendChild(acceptBtn);
      }
    }

    if (b.status === "accepted") {
      const manageLink = document.createElement("a");
      // Starts as a primary CTA (the share-kickoff prompt). After the
      // schedule lookup resolves, switches to a quieter ghost variant
      // when the owner has already done their part — no need to keep
      // pulling their attention to a page that has nothing for them.
      // `hide: true` removes the link entirely if there's no actionable
      // destination.
      manageLink.className = "gr-btn gr-btn--primary gr-btn--sm";
      manageLink.href = engagementLink(b.id);
      manageLink.textContent = "Manage engagement";
      resolveManageLinkLabel(client, b.id, "owner")
        .then(({ label, hide, quiet }) => {
          if (hide) { manageLink.remove(); return; }
          if (label) manageLink.textContent = label;
          if (quiet) {
            manageLink.className = "gr-btn gr-btn--ghost gr-btn--sm";
          } else {
            manageLink.className = "gr-btn gr-btn--primary gr-btn--sm";
          }
        })
        .catch(() => {});
      actionsEl.appendChild(manageLink);
    }

    /* Decline button — pre-acceptance only (pending/countered). The
       confirmation is a styled modal that (a) makes it clear decline
       is permanent, (b) offers "counter instead" as the alternative
       (when the bid still has a counter slot available), and (c)
       warns if the consultant hasn't yet responded to an outstanding
       counter. No money has moved yet, so the actual decline is a
       simple bids.status flip. */
    if (b.status === "pending" || b.status === "countered") {
      const declineBtn = document.createElement("button");
      declineBtn.type = "button";
      declineBtn.className = "gr-btn gr-btn--danger gr-btn--sm ld-bid-card__decline";
      declineBtn.textContent = "Decline";
      declineBtn.addEventListener("click", async () => {
        const hasOutstandingCounter = b.status === "countered" && b.counter_offer_cents != null;
        const canCounter = !b.counter_attempted && !b.counter_offer_cents && totalCounters < 3 && b.status === "pending";
        const body = [
          `Declining is permanent — ${rawName}'s offer disappears and they'll be notified.`,
        ];
        if (hasOutstandingCounter) {
          body.unshift(`${rawName} hasn't decided on your counter yet.`);
        } else if (canCounter) {
          body.push(`If the price isn't right, you can counter instead.`);
        }
        const actions = [{ label: "Cancel", kind: "ghost", value: "cancel" }];
        if (canCounter) {
          actions.push({ label: "Counter instead", kind: "secondary", value: "secondary" });
        }
        actions.push({ label: "Decline forever", kind: "danger", value: "confirm" });
        const choice = await openConfirmModal({
          title: `Decline this offer?`,
          body,
          actions,
        });
        if (choice === "secondary") {
          counterFormEl.classList.remove("hidden");
          if (!counterFormEl.dataset.init) {
            counterFormEl.dataset.init = "1";
            buildCounterForm(client, listing, b, counterFormEl, card, budgetEl, totalCounters);
          }
          return;
        }
        if (choice !== "confirm") return;
        declineBtn.disabled = true;
        try {
          const { error } = await client
            .from("bids")
            .update({ status: "declined", declined_at: new Date().toISOString() })
            .eq("id", b.id);
          if (error) throw error;
          showSuccess("Offer declined.");
          window.location.reload();
        } catch (err) {
          showError(err?.message || "Could not decline offer.");
          declineBtn.disabled = false;
        }
      });
      actionsEl.appendChild(declineBtn);
    }

    /* Counter button — only if the bid has never been countered (1
       counter per bid, permanent — even after expiry reverts the
       offer), no active counter, and the listing-wide cap (3) isn't
       hit. */
    if (!b.counter_attempted && !b.counter_offer_cents && totalCounters < 3 && (b.status === "pending")) {
      const counterBtn = document.createElement("button");
      counterBtn.className = "gr-btn gr-btn--ghost gr-btn--sm";
      counterBtn.textContent = "Counter";
      counterBtn.addEventListener("click", () => {
        counterFormEl.classList.toggle("hidden");
        if (!counterFormEl.dataset.init) {
          counterFormEl.dataset.init = "1";
          buildCounterForm(client, listing, b, counterFormEl, card, budgetEl, totalCounters);
        }
      });
      actionsEl.appendChild(counterBtn);
    }

    /* Message toggle — icon-only, sits absolute top-right of the
       card per the mockup. Slot is `.ld-bid-card__msg-toggle-slot`
       inserted into the card markup above. */
    const msgBtn = document.createElement("button");
    msgBtn.type = "button";
    msgBtn.className = "ld-bid-card__msg-icon";
    msgBtn.title = "Message";
    msgBtn.setAttribute("aria-label", "message");
    msgBtn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`;
    msgBtn.addEventListener("click", () => {
      msgAreaEl.classList.toggle("hidden");
      if (!msgAreaEl.dataset.init) {
        msgAreaEl.dataset.init = "1";
        buildOwnerMsgThread(client, listing.id, session.user.id, b.consultant_id, msgAreaEl);
      }
    });
    const msgSlot = card.querySelector(".ld-bid-card__msg-toggle-slot");
    if (msgSlot) msgSlot.appendChild(msgBtn);

    list.appendChild(card);
  }

  // Sticky cta for phased multi-accept. Inserted once after all cards.
  // The label updates to reflect the current selection count, and the
  // pill itself sticks to the bottom of the bids panel's scroll
  // viewport — see `.ld-proposal-cta` in grassroots.css.
  if (isPhasedListing) {
    proposalCtaEl = document.createElement("div");
    proposalCtaEl.className = "ld-proposal-cta hidden";
    proposalCtaEl.innerHTML = `
      <div class="ld-proposal-cta__summary">
        <span class="ld-proposal-cta__label">0 proposals selected</span>
        <strong class="ld-proposal-cta__total">$0.00</strong>
      </div>
      <button type="button" class="gr-btn gr-btn--primary gr-btn--sm" id="ld-pay-proposals">Pay proposal fee</button>
    `;
    list.appendChild(proposalCtaEl);
    proposalCtaBtn = proposalCtaEl.querySelector("#ld-pay-proposals");
    proposalCtaTotalEl = proposalCtaEl.querySelector(".ld-proposal-cta__total");
    proposalCtaLabelEl = proposalCtaEl.querySelector(".ld-proposal-cta__label");
    proposalCtaBtn.addEventListener("click", handlePayProposals);
  }

  hydrateRatings(list);
}

async function handleAcceptBid(client, session, listing, bid, card) {
  // Payment must clear before the bid flips to `accepted`. The server's
  // /api/stripe/confirm-acceptance does the status update once Stripe
  // captures the funds into our platform balance (escrow).
  const result = await payAndAcceptBid({ client, bid, listing });
  if (!result?.ok) return;

  // Always charge the consultant's amount_cents — the per-bid record
  // of what THEY agreed to. The owner's counter is just a proposal
  // until the consultant accepts it (at which point amount_cents
  // updates to the counter value). Reading from counter_offer_cents
  // here would let the owner pay their own discount unilaterally.
  const paidAmount = bid.amount_cents;
  const offerLabel = Number(paidAmount) === 0 ? "free offer" : `${formatUsd(paidAmount)} offer`;
  await client.from("notifications").insert({
    user_id: bid.consultant_id,
    type: "bid_accepted",
    title: "Your offer was accepted",
    body: `Your ${offerLabel} on "${listing.title}" was accepted. The business is sharing kickoff times next.`,
    link: engagementLink(bid.id),
  });

  window.location.href = engagementLink(bid.id);
}

function buildCounterForm(client, listing, bid, container, card, budgetEl, currentCount) {
  container.innerHTML = `
    <div class="ld-counter-form-inner">
      <p class="ld-counter-form-notice">
        This is your only counter on this offer. The consultant has 24 hours to accept, decline, or counter back. If they don't respond, the offer reverts to their original price — and you can't counter again.
      </p>
      <label class="gr-label"><span>Counter amount (USD)</span>
        <input type="number" class="ld-counter-amount" min="10" step="0.01" placeholder="0.00" />
      </label>
      <label class="gr-label full-width"><span>Message (optional)</span>
        <textarea class="ld-counter-msg" rows="2" maxlength="500" placeholder="Reason for the counter…"></textarea>
      </label>
      <button type="button" class="gr-btn gr-btn--primary gr-btn--sm ld-counter-send">Send counter</button>
      <p class="gr-status ld-counter-status" aria-live="polite"></p>
    </div>
  `;

  const amtInput = container.querySelector(".ld-counter-amount");
  const msgInput = container.querySelector(".ld-counter-msg");
  const sendBtn = container.querySelector(".ld-counter-send");
  const statusEl = container.querySelector(".ld-counter-status");

  sendBtn.addEventListener("click", async () => {
    const cents = Math.round(parseFloat(amtInput.value) * 100);
    if (!Number.isFinite(cents) || cents < MIN_PAID_OFFER_CENTS) {
      showError("A counter must be at least $10.");
      return;
    }
    // Counters are one-shot, so a typo can't be undone. Warn (don't
    // block) when the counter is at or above their ask, or above the
    // listing's own budget max.
    const askCents = Number(bid.amount_cents) || 0;
    const budgetMaxCents = Number(listing.budget_cents) || 0;
    const overAsk = askCents > 0 && cents >= askCents;
    const overBudget = budgetMaxCents > 0 && cents > budgetMaxCents;
    if (overAsk || overBudget) {
      const reasons = [];
      if (overAsk) reasons.push(`They asked for ${formatUsd(askCents)}. Your counter is ${formatUsd(cents)}.`);
      if (overBudget) reasons.push(`Your budget max for this listing is ${formatUsd(budgetMaxCents)}.`);
      const ok = await confirmDialog({
        title: overAsk ? "That's more than they asked for. Send anyway?" : "That's above your budget. Send anyway?",
        body: `${reasons.join(" ")} You only get one counter on this offer.`,
        confirmLabel: "Send counter",
        cancelLabel: "Go back",
      });
      if (!ok) return;
    }
    sendBtn.disabled = true;

    const loader = showLoading("Sending counter…");
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const { error } = await client.from("bids").update({
      status: "countered",
      counter_offer_cents: cents,
      counter_offer_message: msgInput.value.trim() || null,
      counter_expires_at: expiresAt,
      counter_attempted: true,
    }).eq("id", bid.id);

    if (error) {
      loader.dismiss();
      showError(error.message);
      sendBtn.disabled = false;
      return;
    }

    await client.from("notifications").insert({
      user_id: bid.consultant_id,
      type: "counter_offer",
      title: "You got a counteroffer",
      body: `The business countered your offer on "${listing.title}" with ${formatUsd(cents)}. You have 24 hours to respond.`,
      link: `/listing.html?id=${listing.id}`,
    });

    loader.dismiss();
    showSuccess("Counter offer sent. The consultant has 24 hours to respond.");
    // Refresh the bid list in place so the card reflects the new
    // 'countered' status, the counter button hides, and the counter
    // pill renders — all without bouncing through the page loader.
    try {
      const { bids: refreshed } = await loadOwnerBids(client, listing.id);
      await sweepExpiredCounters(client, refreshed, listing);
      const ownerSession = (await client.auth.getSession()).data?.session;
      showOwnerBids(client, ownerSession, listing, refreshed);
    } catch (_) {
      // Fall back to a full reload only if the in-place refresh
      // throws (e.g. network blip). Doesn't auto-fire otherwise.
      window.location.reload();
    }
  });
}

async function buildOwnerMsgThread(client, listingId, myId, consultantId, container) {
  container.innerHTML = `
    <div class="ld-msg-thread" id="msg-thread-${consultantId}"></div>
    <div class="ld-msg-compose">
      <textarea class="ld-msg-input" rows="2" placeholder="Type a message…" maxlength="2000"></textarea>
      <button type="button" class="gr-btn gr-btn--primary gr-btn--sm ld-msg-send-btn">Send</button>
    </div>
  `;

  const thread = container.querySelector(".ld-msg-thread");
  const input = container.querySelector(".ld-msg-input");
  const sendBtn = container.querySelector(".ld-msg-send-btn");

  const messages = await loadMessages(client, listingId, consultantId);
  renderMsgThread(thread, messages, myId);

  sendBtn.addEventListener("click", async () => {
    const body = input.value.trim();
    if (!body) return;
    sendBtn.disabled = true;

    const { error } = await client.from("messages").insert({
      listing_id: listingId, sender_id: myId, recipient_id: consultantId, body,
    });

    if (error) { console.error(error); sendBtn.disabled = false; return; }
    input.value = "";
    const bubble = document.createElement("div");
    bubble.className = "ld-msg-bubble ld-msg-bubble--mine";
    const time = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    bubble.innerHTML = `<p class="ld-msg-text">${escapeHtml(body)}</p><span class="ld-msg-time">${time}</span>`;
    thread.querySelector(".ld-msg-empty")?.remove();
    thread.appendChild(bubble);
    thread.scrollTop = thread.scrollHeight;
    sendBtn.disabled = false;
  });
}

/* ================================================================
   Init
   ================================================================ */

// ───────────────── tutorial fixture mode ─────────────────
// When the URL carries `?tutorial=1` we boot a fake listing instead of
// hitting Supabase. The consultant onboarding tutorial uses this to
// walk a new user through the listing surfaces (bio, context, problem,
// standards, have-a-question, make-an-offer) without ever creating a
// real bid or paying a real business. The submit handler shows a
// toast and bumps the tutorial to the garden chapter; nothing writes.
function isTutorialMode() {
  return new URLSearchParams(window.location.search).get("tutorial") === "1";
}

const TUTORIAL_FIXTURE_LISTING = {
  id: "tutorial-mock-listing",
  owner_id: "tutorial-mock-owner",
  title: "Weekend farmers market sales push",
  status: "open",
  contract_type: "standard",
  category: "marketing, retail",
  turnaround_days: 14,
  created_at: new Date().toISOString(),
  // populateListing parses structured sections out of `details`. The
  // create-listing form writes the same shape, so the fixture mirrors
  // that contract.
  details: [
    "Budget range: $600–$1,200",
    "",
    "context:",
    "We run a small bakery near campus. Our weekend booth at the farmers market has the highest foot traffic of the week, but sales have plateaued for three months. Menu, pricing, and signage have not changed in that window.",
    "",
    "Business problem:",
    "We want to lift Saturday booth sales by at least twenty percent over four weeks. Budget exists for new menu prints, but staffing is fixed.",
    "",
    "Standards of work:",
    "A written plan with two or three testable tactics, suggested menu and signage tweaks, and a short script the booth staff can use to upsell. We want it as a Google doc or PDF, ready to apply the following Saturday.",
    "",
    "Additional details:",
    "We mostly sell bread, cookies, and coffee. Our regulars are college students and parents with young kids. Our Instagram has 1,200 followers but engagement is low.",
  ].join("\n"),
  qualifications_required: [
    "Comfortable working with a small-team retail business",
    "Examples of similar storefront or market activations",
  ].join("\n"),
  attachments: [],
  profiles: {
    full_name: "Amelia Chen",
    avatar_path: null,
    linkedin_url: "",
  },
  _business: {
    business_name: "Honeycomb Bakery",
    business_details:
      "Neighborhood bakery and coffee shop, two years in. Saturday market booth is our highest-volume day.",
    website_url: "",
    social_links: [],
  },
};

function runTutorialListing() {
  // Render fixture into the existing DOM via populateListing — the
  // function is pure DOM-population and doesn't touch Supabase.
  populateListing(TUTORIAL_FIXTURE_LISTING);
  setOwnerSidebarVisible(false);
  setOfferRailVisible(true);

  // Show the offer panel + wire the inputs to render the live breakdown.
  const panel = document.getElementById("ld-offer-panel");
  if (panel) panel.hidden = false;
  const amountInput = document.getElementById("ld-bid-amount");
  const breakdownEl = document.getElementById("ld-offer-breakdown");
  const renderBreakdown = () => {
    if (!breakdownEl) return;
    const dollars = Number(amountInput?.value);
    if (!Number.isFinite(dollars) || dollars <= 0) {
      breakdownEl.hidden = true;
      breakdownEl.innerHTML = "";
      return;
    }
    const f = computeFees(Math.round(dollars * 100));
    breakdownEl.innerHTML = offerBreakdownHtml(f);
    breakdownEl.hidden = false;
  };
  amountInput?.addEventListener("input", renderBreakdown);

  // "+ attach a message" toggle — re-uses the live page's elements
  // but wires a simpler open/close.
  const msgToggle = document.getElementById("ld-offer-msg-toggle");
  const msgWrap = document.getElementById("ld-offer-msg-wrap");
  msgToggle?.addEventListener("click", () => {
    if (!msgWrap) return;
    msgWrap.classList.toggle("hidden");
  });

  // Stubbed submit — no DB write. Just toasts and advances the
  // onboarding state to the garden chapter so the next "next" lands
  // the user on the simulated garden.
  const submitBtn = document.getElementById("ld-bid-submit");
  submitBtn?.addEventListener("click", () => {
    showSuccess(
      "Submitted (tutorial). Real offers go to the business right away.",
      { duration: 4500 }
    );
    submitBtn.disabled = true;
    submitBtn.textContent = "Submitted";
    // Bump the onboarding state directly so the bubble auto-advances
    // to the garden step on its next render.
    try {
      const raw = localStorage.getItem("grassroots_onboarding");
      const state = raw ? JSON.parse(raw) : null;
      if (state?.active) {
        state.stepId = "c-garden-intro";
        localStorage.setItem("grassroots_onboarding", JSON.stringify(state));
      }
    } catch (_) {}
    // Navigate to the simulated garden after a brief moment so the
    // user sees the success state register before we redirect.
    setTimeout(() => {
      window.location.href = "/consultant-dashboard.html?tutorial=garden";
    }, 1200);
  });

  // "have a question?" — show the button and stub its handler.
  const questionWrap = document.getElementById("ld-question-wrap");
  if (questionWrap) questionWrap.hidden = false;
  const questionBtn = document.getElementById("ld-question-btn");
  questionBtn?.addEventListener("click", () => {
    showToast(
      "In real use this opens a chat with the business. Tutorial mode keeps it simple.",
      { kind: "info", duration: 4500 }
    );
  });

  // Unhide the page chrome and we're done.
  gate.hidden = true;
  detail.hidden = false;
}

async function init() {
  if (isTutorialMode()) {
    try { runTutorialListing(); }
    catch (err) {
      console.warn("[tutorial] listing fixture failed", err);
      gate.textContent = "Tutorial preview unavailable. Ping support.";
      gate.className = "gr-status error";
    }
    return;
  }

  const listingId = getListingId();
  if (!listingId) {
    gate.textContent = "No listing ID provided.";
    gate.className = "gr-status error";
    return;
  }

  // Lock in guest mode early — same idea as the marketplace page,
  // so internal navigation within the tab keeps the flag without
  // requiring every link to carry ?guest=1.
  const guest = isGuest();
  if (guest) setGuestMode();

  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();

    // Real session wins — clear any stale guest flag so this user
    // gets the normal experience on the next navigation too.
    clearGuestModeIfSignedIn(session);

    const { listing, error } = await loadListing(client, listingId);

    if (error) { gate.textContent = error.message; gate.className = "gr-status error"; return; }
    if (!listing) { gate.textContent = "Listing not found."; gate.className = "gr-status error"; return; }

    const uid = session?.user?.id ?? null;
    const isOwner = Boolean(uid && listing.owner_id === uid);
    const listingStatus = getListingStatusLabel(listing.status);
    const viewerRole = uid && !isOwner ? await loadSessionRole(client, uid) : null;
    let existingBid = null;
    let hasExistingBid = false;
    let bidsAvailable = false;

    if (viewerRole === "consultant") {
      const { bid, available } = await loadMyBid(client, listingId, uid);
      existingBid = bid;
      hasExistingBid = Boolean(bid);
      bidsAvailable = available;
      // Log the view event — only consultants count, owners viewing their
      // own listings are excluded inside trackListingView itself.
      trackListingView(client, listingId, uid, listing.owner_id, viewerRole);
    }

    if (listingStatus !== "open" && !isOwner && !hasExistingBid) {
      gate.textContent = "This listing is no longer available from marketplace browsing.";
      gate.className = "gr-status error";
      return;
    }

    const isDraft = listing.status === "draft";

    // Drafts are owner-only. Anyone else gets bounced.
    if (isDraft && !isOwner) {
      gate.textContent = "This listing isn't published yet.";
      gate.className = "gr-status error";
      return;
    }

    const { profile } = populateListing(listing);
    populateAvatarIfAvailable(client, profile);
    populateBusinessBadges(client, listing.owner_id);
    setOwnerSidebarVisible(isOwner);
    if (!isOwner) setOfferRailVisible(false);

    // Owner viewing a draft: show the resume-editing banner, hide
    // the listing-controls panel (irrelevant for an unpublished
    // listing — there's nothing to pause / close yet), and skip the
    // bid + analytics loads since neither applies to a draft.
    const draftBanner = document.getElementById("ld-draft-banner");
    if (isDraft && isOwner && draftBanner) {
      draftBanner.hidden = false;
      const cta = document.getElementById("ld-draft-banner-cta");
      if (cta) cta.href = `/create-listing.html?draft=${encodeURIComponent(listing.id)}`;
      setOwnerSidebarVisible(false);
    }

    if (!uid && guest) {
      // Guest view: render the listing body + business bio (already
      // populated above) and drop in the conversion card where the
      // offer panel would live. We intentionally don't load owner
      // bids, listing analytics, or the question chat — none of
      // those are accessible to a logged-out visitor anyway, and
      // skipping them keeps the network requests honest.
      renderGuestRail();
    } else if (uid && !isOwner) {
      if (viewerRole === "consultant") {
        if (bidsAvailable) {
          showConsultantView(client, session, listing, existingBid);
        } else {
          showHint("Run <code>supabase/setup_v2.sql</code> to enable bidding.");
        }
      } else {
        showHint("Only consultants can bid on listings.");
      }
    } else if (isOwner && !isDraft) {
      setupOwnerListingActions(client, listing);
      const { bids, available } = await loadOwnerBids(client, listingId);
      if (available) {
        // Cache for the owner close-form: lets it decide whether the
        // pending-offers disposition question shows and whether the
        // work-completed radio should be enabled.
        cachedOwnerBids = bids;
        // Auto-revert any counters that hit their 24h expiry without
        // a consultant response. Mutates bids[] in place so the next
        // render sees the new state.
        await sweepExpiredCounters(client, bids, listing);
        const embeddedEducation = bids.some((b) => b.education);
        const educationMap = embeddedEducation
          ? new Map(
              bids
                .filter((b) => b.consultant_id && b.education)
                .map((b) => [b.consultant_id, b.education])
            )
          : await loadConsultantEducationMap(client, bids.map((b) => b.consultant_id));
        showOwnerBids(client, session, listing, bids, educationMap);
      }

      // Owner analytics panel — sits above the listing-controls block in
      // the right sidebar. Loads independently of bids so a slow query on
      // listing_views can't block the bid list from rendering.
      const analyticsHost = document.getElementById("ld-owner-analytics");
      if (analyticsHost) {
        analyticsHost.hidden = false;
        loadListingAnalytics(client, listingId, listing.created_at)
          .then((analytics) =>
            renderAnalyticsPanel(analyticsHost, analytics, {
              title: "Performance",
              subtitle: "What consultants are doing with this listing.",
            })
          );
      }
    } else if (isOwner && isDraft) {
      // Owner is previewing their own draft — the draft banner above
      // already explains the state, no extra hint needed.
    } else {
      // Guest or signed-in non-consultant. Surface a clear conversion
      // CTA that returns to this listing after sign-in.
      const nextUrl = encodeURIComponent(`/listing.html?id=${listingId}`);
      if (uid) {
        showHint('Only consultants can submit a proposal. <a href="/home/for-students.html#apply">Apply as a consultant →</a>');
      } else {
        showHint(`<strong>Sign in to make an offer →</strong> <a href="/signin.html?next=${nextUrl}">sign in</a> · <a href="/home/for-students.html#apply">apply as a consultant</a>`);
        // Hide attachments for guests — the file links may include
        // direct storage URLs the bucket RLS won't gate.
        const attachmentsWrap = document.getElementById("ld-attachments");
        if (attachmentsWrap) attachmentsWrap.hidden = true;
      }
    }

    // SEO surface: canonical + JobPosting JSON-LD. Both reflect the
    // listing we just loaded; injected client-side so the SSR layer
    // doesn't need to render listings.
    injectListingSeo(listing);

    gate.hidden = true;
    detail.hidden = false;
  } catch (err) {
    gate.textContent = err.message || "Could not load listing.";
    gate.className = "gr-status error";
  }
}

function showHint(html) {
  const el = document.getElementById("ld-auth-prompt");
  el.innerHTML = `<p class="gr-listing-hint">${html}</p>`;
  el.hidden = false;
}

// SEO injection — adds <link rel="canonical"> + a Google-recognized
// JobPosting JSON-LD block once the listing data is available. Idempotent.
function injectListingSeo(listing) {
  if (!listing) return;
  const origin = window.location.origin;
  const canonicalHref = `${origin}/listing.html?id=${listing.id}`;

  // Canonical link
  let canonical = document.querySelector('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement("link");
    canonical.rel = "canonical";
    document.head.appendChild(canonical);
  }
  canonical.href = canonicalHref;

  // Description (fallback when the listing has no summary)
  const descBits = [listing.problem_summary, listing.title].filter(Boolean);
  const description = String(descBits[0] || "Consulting project on Grassroots.").slice(0, 200);
  let metaDesc = document.querySelector('meta[name="description"]');
  if (metaDesc) metaDesc.setAttribute("content", description);

  // JobPosting schema
  const budgetMin = listing.budget_cents ? Math.round(listing.budget_cents / 100) : undefined;
  const turnaround = Number(listing.turnaround_days);
  const validThrough = Number.isFinite(turnaround) && turnaround > 0
    ? new Date(Date.now() + turnaround * 24 * 60 * 60 * 1000).toISOString()
    : undefined;

  const jobPosting = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: listing.title || "Consulting project",
    description,
    datePosted: listing.created_at,
    employmentType: "CONTRACTOR",
    hiringOrganization: {
      "@type": "Organization",
      name: "grassroots",
      sameAs: "https://www.grassroots-marketplace.com/",
    },
    jobLocationType: "TELECOMMUTE",
    applicantLocationRequirements: { "@type": "Country", name: "US" },
    url: canonicalHref,
  };
  if (validThrough) jobPosting.validThrough = validThrough;
  if (budgetMin != null) {
    jobPosting.baseSalary = {
      "@type": "MonetaryAmount",
      currency: "USD",
      value: { "@type": "QuantitativeValue", value: budgetMin, unitText: "PROJECT" },
    };
  }

  let existing = document.getElementById("listing-jsonld");
  if (!existing) {
    existing = document.createElement("script");
    existing.type = "application/ld+json";
    existing.id = "listing-jsonld";
    document.head.appendChild(existing);
  }
  existing.textContent = JSON.stringify(jobPosting);
}

init();

// Categories and statuses are stored lowercase; show them in sentence case.
function capFirst(value) {
  const s = String(value || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
