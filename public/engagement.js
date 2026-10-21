import { getSupabaseClient } from "/supabase-loader.js";
import { renderRatingMarkup, fetchRatingFor } from "/rating.js";
import { showSuccess, showError, showInfo } from "/toast.js";
// payment-modal is only needed when the owner taps "pay service fee".
// Lazy-load on demand so engagement.html stays light on first paint.
let _paymentModalPromise = null;
async function payAndStartService(...args) {
  if (!_paymentModalPromise) _paymentModalPromise = import("/payment-modal.js");
  const m = await _paymentModalPromise;
  return m.payAndStartService(...args);
}

const gate = document.getElementById("eg-gate");
const detail = document.getElementById("eg-detail");
const titleEl = document.getElementById("eg-title");
const statusPill = document.getElementById("eg-status-pill");
const ownerNameEl = document.getElementById("eg-owner-name");
const consultantNameEl = document.getElementById("eg-consultant-name");
const amountEl = document.getElementById("eg-amount");
const listingStatusEl = document.getElementById("eg-listing-status");
const panelTitleEl = document.getElementById("eg-panel-title");
const panelCopyEl = document.getElementById("eg-panel-copy");
const durationWrap = document.getElementById("eg-duration-wrap");
const durationSelect = document.getElementById("eg-duration-select");
const durationReadonly = document.getElementById("eg-duration-readonly");
const durationReadonlyValue = document.getElementById("eg-duration-readonly-value");
const ownerTools = document.getElementById("eg-owner-tools");
const clearAvailabilityBtn = document.getElementById("eg-clear-availability");
const calendarEl = document.getElementById("eg-calendar");
const saveAvailabilityBtn = document.getElementById("eg-save-availability");
const confirmTimeBtn = document.getElementById("eg-confirm-time");
const downloadInviteBtn = document.getElementById("eg-download-invite");
const meetingStatusEl = document.getElementById("eg-meeting-status");
const meetingSummaryEl = document.getElementById("eg-meeting-summary");
const meetingTimeEl = document.getElementById("eg-meeting-time");
const meetingBodyEl = document.getElementById("eg-meeting-body");
const ownerActionsPanel = document.getElementById("eg-owner-actions-panel");
const reviewOffersLink = document.getElementById("eg-review-offers-link");
const closeListingBtn = document.getElementById("eg-close-listing-btn");
const workCompletedBtn = document.getElementById("eg-work-completed-btn");
const refundBtn = document.getElementById("eg-refund-btn");
const refundRequestBtn = document.getElementById("eg-refund-request-btn");

// Owner-action buttons that are "unavailable for a reason" use
// aria-disabled instead of the native disabled attribute — disabled
// swallows clicks, but we want the click to land so we can toast why
// the action isn't available. The delegated listener at the bottom
// of this file picks the data-disabled-reason off the clicked button.
function setBtnUnavailable(btn, unavailable, reason = "") {
  if (!btn) return;
  if (unavailable) {
    btn.setAttribute("aria-disabled", "true");
    if (reason) btn.dataset.disabledReason = reason;
  } else {
    btn.removeAttribute("aria-disabled");
    delete btn.dataset.disabledReason;
  }
}
const refundHelper = document.getElementById("eg-refund-helper");
const ownerActionStatusEl = document.getElementById("eg-owner-action-status");
const proposalDecisionPanel = document.getElementById("eg-proposal-decision-panel");
const proposalStatusPill = document.getElementById("eg-proposal-status-pill");
const proposalBodyEl = document.getElementById("eg-proposal-body");
const proposalActionsEl = document.getElementById("eg-proposal-actions");
const proposalSelectBtn = document.getElementById("eg-proposal-select-btn");
const proposalDeclineBtn = document.getElementById("eg-proposal-decline-btn");
const proposalStatusEl = document.getElementById("eg-proposal-status");
const servicePhasePanel = document.getElementById("eg-service-phase-panel");
const serviceTitleEl = document.getElementById("eg-service-title");
const serviceStatusPill = document.getElementById("eg-service-status-pill");
const serviceBodyEl = document.getElementById("eg-service-body");
const serviceActionsEl = document.getElementById("eg-service-actions");
const servicePayBtn = document.getElementById("eg-service-pay-btn");
const serviceStatusEl = document.getElementById("eg-service-status");
const retainerPeriodsPanel = document.getElementById("eg-retainer-periods-panel");
const periodListEl = document.getElementById("eg-period-list");
const periodStatusEl = document.getElementById("eg-period-status");
const retainerOfferPanel = document.getElementById("eg-retainer-offer-panel");
const offerTitleEl = document.getElementById("eg-offer-title");
const offerStatusPill = document.getElementById("eg-offer-status-pill");
const offerBodyEl = document.getElementById("eg-offer-body");
const offerFormEl = document.getElementById("eg-offer-form");
const offerActionsEl = document.getElementById("eg-offer-actions");
const offerPrimaryBtn = document.getElementById("eg-offer-primary-btn");
const offerDeclineBtn = document.getElementById("eg-offer-decline-btn");
const offerStatusEl = document.getElementById("eg-offer-status");
const offerCadenceInput = document.getElementById("eg-offer-cadence");
const offerPeriodsInput = document.getElementById("eg-offer-periods");
const offerFeeInput = document.getElementById("eg-offer-fee");
const offerMessageInput = document.getElementById("eg-offer-message");
let offerFormVisible = false;
const retainerDecisionPanel = document.getElementById("eg-retainer-decision-panel");
const retainerTitleEl = document.getElementById("eg-retainer-title");
const retainerStatusPill = document.getElementById("eg-retainer-status-pill");
const retainerBodyEl = document.getElementById("eg-retainer-body");
const retainerActionsEl = document.getElementById("eg-retainer-actions");
const retainerContinueBtn = document.getElementById("eg-retainer-continue-btn");
const retainerOneoffBtn = document.getElementById("eg-retainer-oneoff-btn");
const retainerStatusEl = document.getElementById("eg-retainer-status");
const retainerTermsForm = document.getElementById("eg-retainer-terms-form");
const retainerCadenceInput = document.getElementById("eg-retainer-cadence-input");
const retainerPeriodsInput = document.getElementById("eg-retainer-periods-input");
const retainerFeeInput = document.getElementById("eg-retainer-fee-input");
const reviewPanel = document.getElementById("eg-review-panel");
const reviewForm = document.getElementById("eg-review-form");
const ratingGrid = document.getElementById("eg-rating-grid");
const endorsementInput = document.getElementById("eg-endorsement");
const submitReviewBtn = document.getElementById("eg-submit-review");
const reviewStatusEl = document.getElementById("eg-review-status");

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOT_MINUTES = 30;
const START_HOUR = 8;
const END_HOUR = 20;
const SLOT_COUNT = ((END_HOUR - START_HOUR) * 60) / SLOT_MINUTES;
const RATING_DIMENSIONS = [
  ["work_product_quality", "work product quality"],
  ["communication", "communication"],
  ["timeliness", "timeliness"],
  ["professionalism", "professionalism"],
  ["cost_value", "cost value"],
];

let supabase;
let sessionUserId = null;
let viewRole = null;
let currentBid = null;
let currentListing = null;
let ownerProfile = null;
let consultantProfile = null;
let scheduleStore = "remote";
let reviewStore = "remote";
let scheduleState = null;
let reviewState = null;
let proposalPhase = null; // bid_phase_payments row for phase='proposal'
let servicePhase = null;  // bid_phase_payments row for phase='service'
let retainerSub = null;   // retainer_subscriptions row
let retainerDeclined = false; // owner clicked "close as one-off"
let retainerPeriods = []; // bid_phase_payments rows for phase='retainer_period'
const ownerSelection = new Set();
const reviewRatings = Object.create(null);
let consultantChosen = null;
let dragState = { active: false, nextValue: false };

// Out-of-window refund modal. Lightweight; reuses the .gr-confirm-modal
// classes so the visual matches the rest of the dialog system. Resolves
// nothing — opens a mailto with the textarea content + engagement id
// pre-filled when the user submits.
function openRefundRequestModal({ engagementId, listingTitle } = {}) {
  const MODAL_ID = "eg-refund-modal";
  const existing = document.getElementById(MODAL_ID);
  if (existing) existing.remove();

  const previousFocus = document.activeElement;
  const modal = document.createElement("div");
  modal.id = MODAL_ID;
  modal.className = "gr-confirm-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", `${MODAL_ID}-title`);
  modal.innerHTML = `
    <div class="gr-confirm-modal__backdrop" data-refund-action="cancel"></div>
    <div class="gr-confirm-modal__card" role="document">
      <h2 id="${MODAL_ID}-title" class="gr-confirm-modal__title">request a refund</h2>
      <p class="gr-confirm-modal__body">tell us what happened. we'll review and follow up by email within 2 business days.</p>
      <label class="gr-label full-width" style="margin-top:0.85rem">
        <span>what happened? <span class="gr-optional">required</span></span>
        <textarea id="eg-refund-reason" rows="4" maxlength="1500" placeholder="describe the issue. include any specifics that'll help us review faster." required></textarea>
      </label>
      <div class="gr-confirm-modal__actions">
        <button type="button" class="gr-btn gr-btn--ghost" data-refund-action="cancel">cancel</button>
        <button type="button" class="gr-btn gr-btn--primary" data-refund-action="submit">send request</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  document.body.classList.add("gr-confirm-modal-open");

  const textarea = modal.querySelector("#eg-refund-reason");
  const submitBtn = modal.querySelector('[data-refund-action="submit"]');

  function cleanup() {
    document.removeEventListener("keydown", onKey);
    modal.remove();
    document.body.classList.remove("gr-confirm-modal-open");
    if (previousFocus && typeof previousFocus.focus === "function") {
      try { previousFocus.focus(); } catch (_) {}
    }
  }

  function submit() {
    const reason = String(textarea?.value || "").trim();
    if (!reason) {
      textarea?.focus();
      return;
    }
    // Pre-fill mailto with engagement context so the support inbox has
    // everything it needs to triage without round-tripping.
    const subject = `refund request — engagement ${engagementId || "unknown"}`;
    const bodyLines = [
      `engagement id: ${engagementId || "(unavailable)"}`,
      `listing: ${listingTitle || "(unavailable)"}`,
      "",
      "what happened:",
      reason,
    ];
    const href = `mailto:support@grassroots.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`;
    window.location.href = href;
    cleanup();
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); cleanup(); }
  }

  modal.addEventListener("click", (e) => {
    const action = e.target.closest("[data-refund-action]")?.dataset.refundAction;
    if (!action) return;
    if (action === "cancel") cleanup();
    if (action === "submit") submit();
  });

  document.addEventListener("keydown", onKey);

  requestAnimationFrame(() => {
    try { textarea.focus(); } catch (_) {}
  });
}

function formatUsd(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n / 100);
}

function isMissing(error) {
  if (!error) return false;
  const msg = String(error.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("schema cache") || msg.includes("could not find");
}

function getBidId() {
  return new URLSearchParams(window.location.search).get("bid");
}

function scheduleStorageKey(bidId) {
  return `grassroots_engagement_schedule_${bidId}`;
}

function reviewStorageKey(bidId) {
  return `grassroots_consultant_review_${bidId}`;
}

function toDateKey(date) {
  const y = date.getFullYear();
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(dateKey) {
  const [y, m, d] = String(dateKey || "").split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);
}

function getWeekStartDate() {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  const jsDay = start.getDay();
  const offset = jsDay === 0 ? -6 : 1 - jsDay;
  start.setDate(start.getDate() + offset);
  return start;
}

function slotId(dayIndex, slotIndex) {
  return `${dayIndex}-${slotIndex}`;
}

function slotIdParts(id) {
  const [dayIndex, slotIndex] = String(id).split("-").map(Number);
  return { dayIndex, slotIndex };
}

function slotLabel(slotIndex) {
  const minutes = START_HOUR * 60 + slotIndex * SLOT_MINUTES;
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour12 = ((hour24 + 11) % 12) + 1;
  return `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function slotToDate(weekStart, dayIndex, slotIndex) {
  const base = parseDateKey(weekStart);
  base.setDate(base.getDate() + dayIndex);
  base.setHours(START_HOUR + Math.floor((slotIndex * SLOT_MINUTES) / 60), (slotIndex * SLOT_MINUTES) % 60, 0, 0);
  return base;
}

function addMinutes(date, mins) {
  return new Date(date.getTime() + mins * 60000);
}

function formatDateTimeRange(startIso, endIso) {
  if (!startIso || !endIso) return "";
  const start = new Date(startIso);
  const end = new Date(endIso);
  const day = start.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const startTime = start.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  const endTime = end.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${day} · ${startTime} to ${endTime}`;
}

function toIcsDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function escapeIcs(value) {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function buildInviteHref() {
  if (!scheduleState?.selected_start || !scheduleState?.selected_end || !currentListing) return "#";
  const start = new Date(scheduleState.selected_start);
  const end = new Date(scheduleState.selected_end);
  const ownerName = ownerProfile?.full_name || "business owner";
  const consultantName = consultantProfile?.full_name || "Consultant";
  const body = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//grassroots//engagement//EN",
    "BEGIN:VEVENT",
    `UID:grassroots-${currentBid.id}@grassroots.local`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcs(`Grassroots kickoff: ${currentListing.title}`)}`,
    `DESCRIPTION:${escapeIcs(`Kickoff meeting for "${currentListing.title}" between ${ownerName} and ${consultantName}.`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(body)}`;
}

function setStatusPill(status) {
  statusPill.dataset.status = status;
  const labels = {
    awaiting_owner: "awaiting availability",
    awaiting_consultant: "awaiting consultant",
    scheduled: "scheduled",
    completed: "completed",
  };
  // Map engagement status → universal gr-pill kind so the pill picks up
  // the shared color tokens instead of bespoke CSS.
  const kindMap = {
    awaiting_owner: "warn",
    awaiting_consultant: "warn",
    scheduled: "accepted",
    completed: "muted",
  };
  statusPill.textContent = labels[status] || status;
  statusPill.className = `gr-pill gr-pill--${kindMap[status] || "muted"}`;
}

function getDefaultSchedule() {
  return {
    listing_id: currentListing.id,
    bid_id: currentBid.id,
    owner_id: currentListing.owner_id,
    consultant_id: currentBid.consultant_id,
    week_start: toDateKey(getWeekStartDate()),
    owner_availability: { slots: [] },
    selected_start: null,
    selected_end: null,
    status: "awaiting_owner",
  };
}

function readLocalJson(key) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeLocalJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

async function insertNotification(userId, title, body, link, type) {
  try {
    await supabase.from("notifications").insert({
      user_id: userId,
      type,
      title,
      body,
      link,
    });
  } catch (err) {
    console.warn("notification insert failed", err);
  }
}

async function loadBid(bidId) {
  const { data, error } = await supabase
    .from("bids")
    .select("id, listing_id, consultant_id, amount_cents, proposal_fee_cents, service_fee_cents, move_forward_status, move_forward_decided_at, message, status, accepted_at, proposal_due_at, payment_status, payment_amount_cents, paid_at")
    .eq("id", bidId)
    .maybeSingle();
  return { data, error };
}

async function loadListing(listingId) {
  const { data, error } = await supabase
    .from("listings")
    .select("id, owner_id, title, status, created_at, contract_type, proposal_budget, retainer_terms, retainer_cadence, retainer_period_count, retainer_fee_cents")
    .eq("id", listingId)
    .maybeSingle();
  return { data, error };
}

async function loadProposalPhase(bidId) {
  const { data, error } = await supabase
    .from("bid_phase_payments")
    .select("id, status, amount_cents, paid_at, released_at, transfer_id, charge_id, payment_intent_id")
    .eq("bid_id", bidId)
    .eq("phase", "proposal")
    .maybeSingle();
  if (error) {
    console.warn("loadProposalPhase:", error.message);
    return null;
  }
  return data;
}

async function loadServicePhase(bidId) {
  const { data, error } = await supabase
    .from("bid_phase_payments")
    .select("id, status, amount_cents, paid_at, released_at, transfer_id, charge_id, payment_intent_id")
    .eq("bid_id", bidId)
    .eq("phase", "service")
    .maybeSingle();
  if (error) {
    console.warn("loadServicePhase:", error.message);
    return null;
  }
  return data;
}

async function loadRetainerPeriods(bidId) {
  const { data, error } = await supabase
    .from("bid_phase_payments")
    .select("id, period_index, amount_cents, status, paid_at, released_at, transfer_id, charge_id")
    .eq("bid_id", bidId)
    .eq("phase", "retainer_period")
    .order("period_index", { ascending: true });
  if (error) {
    console.warn("loadRetainerPeriods:", error.message);
    return [];
  }
  return data || [];
}

async function loadRetainerSubscription(bidId) {
  const { data, error } = await supabase
    .from("retainer_subscriptions")
    .select("id, stripe_subscription_id, cadence, period_count, periods_billed, fee_cents, status, started_at, ends_at, canceled_at, offered_by, offered_at, accepted_at, declined_at, offer_message, auto_release, terminates_at")
    .eq("bid_id", bidId)
    .maybeSingle();
  if (error) {
    console.warn("loadRetainerSubscription:", error.message);
    return null;
  }
  return data;
}

async function loadProfile(userId) {
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role")
    .eq("id", userId)
    .maybeSingle();
  return { data, error };
}

async function loadSchedule(bidId) {
  const local = readLocalJson(scheduleStorageKey(bidId));
  const { data, error } = await supabase
    .from("engagement_schedules")
    .select("*")
    .eq("bid_id", bidId)
    .maybeSingle();

  if (error && isMissing(error)) {
    scheduleStore = "local";
    return local;
  }
  if (error) throw error;
  if (data) {
    scheduleStore = "remote";
    writeLocalJson(scheduleStorageKey(bidId), data);
    return data;
  }
  if (local) {
    scheduleStore = "local";
    return local;
  }
  return null;
}

async function saveSchedule(nextSchedule) {
  const payload = {
    ...nextSchedule,
    owner_availability: nextSchedule.owner_availability || { slots: [] },
  };
  if (scheduleStore === "remote") {
    // RLS: only owners have an INSERT policy on engagement_schedules;
    // consultants only have UPDATE. `upsert` evaluates both policies up
    // front, so consultants would fail the INSERT check on an existing
    // row. Branch on payload.id so the consultant's "confirm this time"
    // flow does a pure UPDATE, while the owner's first availability
    // share still falls through to upsert for the INSERT.
    let data;
    let error;
    if (payload.id) {
      ({ data, error } = await supabase
        .from("engagement_schedules")
        .update(payload)
        .eq("id", payload.id)
        .select()
        .single());
    } else {
      ({ data, error } = await supabase
        .from("engagement_schedules")
        .upsert(payload, { onConflict: "bid_id" })
        .select()
        .single());
    }

    if (error && isMissing(error)) {
      scheduleStore = "local";
    } else if (error) {
      throw error;
    } else {
      writeLocalJson(scheduleStorageKey(payload.bid_id), data);
      scheduleState = data;
      return data;
    }
  }

  writeLocalJson(scheduleStorageKey(payload.bid_id), payload);
  scheduleState = payload;
  return payload;
}

async function loadReview(bidId) {
  const local = readLocalJson(reviewStorageKey(bidId));
  const { data, error } = await supabase
    .from("consultant_reviews")
    .select("*")
    .eq("bid_id", bidId)
    .maybeSingle();

  if (error && isMissing(error)) {
    reviewStore = "local";
    return local;
  }
  if (error) throw error;
  if (data) {
    reviewStore = "remote";
    writeLocalJson(reviewStorageKey(bidId), data);
    return data;
  }
  if (local) {
    reviewStore = "local";
    return local;
  }
  return null;
}

async function saveReview(payload) {
  if (reviewStore === "remote") {
    const { data, error } = await supabase
      .from("consultant_reviews")
      .upsert(payload, { onConflict: "bid_id" })
      .select()
      .single();

    if (error && isMissing(error)) {
      reviewStore = "local";
    } else if (error) {
      throw error;
    } else {
      writeLocalJson(reviewStorageKey(payload.bid_id), data);
      reviewState = data;
      return data;
    }
  }

  writeLocalJson(reviewStorageKey(payload.bid_id), payload);
  reviewState = payload;
  return payload;
}

/* Duration source of truth:
   - If the owner has already saved a duration into the schedule state, use that
     for both views (consultant must accept the predetermined length).
   - Otherwise (owner hasn't saved yet), read from the dropdown — owner is
     actively picking. Default falls back to 30 minutes. */
function getSelectedDuration() {
  const stateDuration = Number(scheduleState?.duration_minutes);
  if (Number.isFinite(stateDuration) && stateDuration > 0) return stateDuration;
  return Number(durationSelect.value || "30");
}

function canFitDuration(slotKey, durationMinutes, availableSet) {
  const { dayIndex, slotIndex } = slotIdParts(slotKey);
  const slotsNeeded = durationMinutes / SLOT_MINUTES;
  if (!Number.isFinite(slotsNeeded) || slotsNeeded < 1) return false;
  for (let i = 0; i < slotsNeeded; i += 1) {
    if (!availableSet.has(slotId(dayIndex, slotIndex + i))) return false;
  }
  return true;
}

function chosenSlotRange() {
  if (!consultantChosen) return [];
  const duration = getSelectedDuration();
  const { dayIndex, slotIndex } = slotIdParts(consultantChosen);
  const slotsNeeded = duration / SLOT_MINUTES;
  const out = [];
  for (let i = 0; i < slotsNeeded; i += 1) {
    out.push(slotId(dayIndex, slotIndex + i));
  }
  return out;
}

function renderCalendar(mode) {
  const weekStart = scheduleState?.week_start || toDateKey(getWeekStartDate());
  const selectedSlots = new Set(
    mode === "owner"
      ? [...ownerSelection]
      : scheduleState?.owner_availability?.slots || []
  );
  const consultantChoice = new Set(mode === "consultant" ? chosenSlotRange() : []);

  const parts = ['<div class="eg-calendar__corner"></div>'];
  for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
    const date = parseDateKey(weekStart);
    date.setDate(date.getDate() + dayIndex);
    parts.push(`
      <div class="eg-calendar__dayhead">
        <span class="eg-calendar__dayname">${DAYS[dayIndex]}</span>
        <span class="eg-calendar__daydate">${date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
      </div>
    `);
  }

  for (let slotIndex = 0; slotIndex < SLOT_COUNT; slotIndex += 1) {
    parts.push(`<div class="eg-calendar__time">${slotLabel(slotIndex)}</div>`);
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const id = slotId(dayIndex, slotIndex);
      const isSelected = selectedSlots.has(id);
      const isChoice = consultantChoice.has(id);
      const isAvailable = selectedSlots.has(id);
      const consultantDisabled = mode === "consultant" && (!isAvailable || !canFitDuration(id, getSelectedDuration(), selectedSlots));
      const cls = [
        "eg-calendar__slot",
        isSelected && mode === "owner" ? "is-selected" : "",
        isAvailable && mode !== "owner" ? "is-available" : "",
        isChoice ? "is-choice" : "",
      ].filter(Boolean).join(" ");
      parts.push(`
        <button
          type="button"
          class="${cls}"
          data-slot-id="${id}"
          ${mode === "scheduled" ? "disabled" : ""}
          ${consultantDisabled ? "disabled" : ""}
          aria-label="${DAYS[dayIndex]} ${slotLabel(slotIndex)}"
        ></button>
      `);
    }
  }
  calendarEl.innerHTML = parts.join("");
}

function refreshInviteLink() {
  if (scheduleState?.selected_start && scheduleState?.selected_end) {
    downloadInviteBtn.href = buildInviteHref();
    downloadInviteBtn.classList.remove("hidden");
  } else {
    downloadInviteBtn.classList.add("hidden");
  }
}

function renderMeetingSummary() {
  if (scheduleState?.selected_start && scheduleState?.selected_end) {
    meetingSummaryEl.classList.remove("hidden");
    meetingTimeEl.textContent = formatDateTimeRange(scheduleState.selected_start, scheduleState.selected_end);
    meetingBodyEl.textContent =
      "grassroots wishes you both the best of luck on this engagement. we're excited to hear back.";
  } else {
    meetingSummaryEl.classList.add("hidden");
  }
  refreshInviteLink();
}

function isValidRating(v) {
  return typeof v === "number" && v >= 0.5 && v <= 5 && (v * 2) % 1 === 0;
}

function updateReviewSubmitState() {
  const ready = RATING_DIMENSIONS.every(([key]) => isValidRating(reviewRatings[key]));
  submitReviewBtn.disabled = !ready;
}

function renderRatings() {
  // 5 stars, each with a left-half + right-half hit target so the user
  // can choose any 0.5-step value from 0.5 → 5. Visual fill is a
  // single .eg-stars__fill width track, matching the .gr-rating
  // component's pattern.
  ratingGrid.innerHTML = RATING_DIMENSIONS.map(([key, label]) => {
    const value = Number(reviewRatings[key]) || 0;
    const fillPct = Math.max(0, Math.min(5, value)) / 5 * 100;
    const valueLabel = value ? `${value} of 5` : "not yet rated";
    const hits = Array.from({ length: 10 }, (_, i) => {
      const v = (i + 1) / 2;
      const star = v === 1 ? "star" : "stars";
      return `<button type="button" class="eg-stars__hit" data-rating-key="${key}" data-rating-value="${v}" aria-label="rate ${v} ${star}"></button>`;
    }).join("");
    return `
      <div class="eg-rating-row">
        <div class="eg-rating-label">${label}</div>
        <div class="eg-stars" data-value="${value}" role="img" aria-label="${valueLabel}">
          <span class="eg-stars__track" aria-hidden="true">
            <span class="eg-stars__bg">★★★★★</span>
            <span class="eg-stars__fill" style="width: ${fillPct.toFixed(2)}%">★★★★★</span>
          </span>
          <span class="eg-stars__hits">${hits}</span>
        </div>
      </div>
    `;
  }).join("");
  updateReviewSubmitState();
}

function hydrateSummary() {
  titleEl.textContent = currentListing.title;
  ownerNameEl.textContent = ownerProfile?.full_name || "business owner";
  const consultantName = consultantProfile?.full_name || "Consultant";
  consultantNameEl.textContent = consultantName;
  amountEl.textContent = formatUsd(currentBid.amount_cents);
  listingStatusEl.textContent = currentListing.status || "open";
  reviewOffersLink.href = `/listing.html?id=${currentListing.id}`;

  // Inbox shortcut — drops the user into the right thread in /inbox.html.
  // Thread key format expected by inbox.js:maybeOpenFromHash is
  // `<listingId>:<otherUserId>`.
  const threadLink = document.getElementById("eg-thread-link");
  if (threadLink && currentListing?.id) {
    const otherId = viewRole === "owner"
      ? currentBid?.consultant_id
      : currentListing.owner_id;
    if (otherId) {
      threadLink.href = `/inbox.html#inbox?thread=${currentListing.id}:${otherId}`;
      threadLink.hidden = false;
    }
  }

  if (currentBid?.consultant_id) {
    fetchRatingFor(currentBid.consultant_id).then((rating) => {
      consultantNameEl.innerHTML = `${escapeHtml(consultantName)} ${renderRatingMarkup(rating, { size: "sm" })}`;
    });
  }
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;

function renderRetainerPeriodsPanel() {
  if (!retainerPeriodsPanel || !periodListEl) return;

  // Show the panel as soon as there's a subscription on file — even
  // before the first invoice fires — so the owner can configure
  // auto-release / termination date / cancel from day one.
  const hasSub = retainerSub && ["active", "pending", "canceled", "completed"].includes(retainerSub.status);
  if (!hasSub) {
    retainerPeriodsPanel.classList.add("hidden");
    return;
  }
  retainerPeriodsPanel.classList.remove("hidden");

  periodListEl.innerHTML = "";
  if (retainerPeriods.length === 0) {
    const empty = document.createElement("li");
    empty.className = "eg-period eg-period--empty";
    empty.innerHTML = `<span class="eg-period__label">no periods billed yet — the first invoice fires at the start of the next billing cycle.</span>`;
    periodListEl.appendChild(empty);
  }
  for (const p of retainerPeriods) {
    const li = document.createElement("li");
    li.className = `eg-period eg-period--${p.status}`;
    const pillKind = p.status === "released" ? "accepted" : p.status === "held" ? "warn" : "muted";
    li.innerHTML = `
      <div class="eg-period__head">
        <span class="eg-period__label">period ${p.period_index + 1}</span>
        <span class="gr-pill gr-pill--${pillKind} gr-pill--no-dot">${p.status}</span>
      </div>
      <div class="eg-period__row">
        <span class="eg-period__amount">${formatUsd(p.amount_cents)}</span>
        <span class="eg-period__actions"></span>
      </div>
    `;
    const actionsSlot = li.querySelector(".eg-period__actions");
    if (p.status === "held" && viewRole === "owner") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "gr-btn gr-btn--primary gr-btn--sm";
      btn.textContent = "release";
      btn.addEventListener("click", () => releaseRetainerPeriod(p.period_index, btn));
      actionsSlot.appendChild(btn);
    }
    periodListEl.appendChild(li);
  }

  // Settings + cancel controls. Owner sees the full settings (auto-release
  // toggle + termination date). Either party gets the "end after current
  // period" button. Both panels stay hidden once the sub is canceled or
  // completed — nothing left to control.
  renderRetainerControls();
}

function renderRetainerControls() {
  const host = document.getElementById("eg-retainer-controls");
  if (!host) return;
  const active = retainerSub && (retainerSub.status === "active" || retainerSub.status === "pending");
  if (!active) {
    host.innerHTML = "";
    host.classList.add("hidden");
    return;
  }
  host.classList.remove("hidden");
  const isOwner = viewRole === "owner";
  const auto = !!retainerSub.auto_release;
  const paid = Number(retainerSub.periods_billed) || 0;
  const minLength = Math.max(1, paid);
  const length = retainerSub.period_count || "";
  const endsOn = retainerSub.terminates_at
    ? new Date(retainerSub.terminates_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
    : "";
  const lengthHint = length && endsOn
    ? `billing stops after period ${length}, on ${endsOn}. you can go as low as ${minLength}.`
    : "no end set. billing continues until you or the consultant end it.";

  const settingsBlock = isOwner ? `
    <div class="eg-retainer-controls__settings">
      <p class="eg-retainer-controls__title">retainer settings</p>
      <label class="settings-toggle eg-retainer-controls__toggle">
        <span class="settings-toggle-copy">
          <span class="settings-toggle-title">auto-release each period</span>
          <span class="settings-toggle-sub">funds release to the consultant the moment each invoice is paid. you can toggle this off any time.</span>
        </span>
        <input type="checkbox" id="eg-retainer-auto-release" ${auto ? "checked" : ""} />
        <span class="settings-toggle-switch" aria-hidden="true"></span>
      </label>
      <label class="gr-label eg-retainer-controls__length">
        <span>retainer length (periods)</span>
        <input type="number" id="eg-retainer-period-count" min="${minLength}" max="120" step="1" inputmode="numeric" value="${length}" />
        <span class="eg-retainer-controls__hint">${lengthHint}</span>
      </label>
      <div class="eg-retainer-controls__actions">
        <p id="eg-retainer-controls-status" class="gr-status" aria-live="polite"></p>
        <button type="button" class="gr-btn gr-btn--secondary gr-btn--sm" id="eg-retainer-save-settings">save settings</button>
      </div>
    </div>
  ` : "";

  const cancelBlock = `
    <div class="eg-retainer-controls__cancel">
      <p class="eg-retainer-controls__cancel-copy">${isOwner
        ? "ending the retainer after the current period keeps this month's work and payment in place. no future invoices."
        : "you can end your end of the retainer after the current period. your current period's work and pay stay in place."}</p>
      <button type="button" class="gr-btn gr-btn--danger gr-btn--sm" id="eg-retainer-cancel-btn">end after current period</button>
    </div>
  `;

  host.innerHTML = settingsBlock + cancelBlock;

  // Wire handlers.
  document.getElementById("eg-retainer-save-settings")?.addEventListener("click", saveRetainerSettings);
  document.getElementById("eg-retainer-cancel-btn")?.addEventListener("click", endRetainerAfterPeriod);
}

async function saveRetainerSettings() {
  const status = document.getElementById("eg-retainer-controls-status");
  const btn = document.getElementById("eg-retainer-save-settings");
  if (!currentBid?.id) return;
  if (btn) btn.disabled = true;
  if (status) { status.textContent = "saving…"; status.className = "gr-status"; }
  try {
    const autoEl = document.getElementById("eg-retainer-auto-release");
    const lengthEl = document.getElementById("eg-retainer-period-count");
    const body = { bid_id: currentBid.id };
    if (autoEl) body.auto_release = !!autoEl.checked;
    if (lengthEl?.value && Number(lengthEl.value) !== Number(retainerSub.period_count)) {
      body.period_count = Number(lengthEl.value);
    }
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch("/api/stripe/retainer/update-settings", {
      method: "POST", headers, body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (status) { status.textContent = data.error || "could not save."; status.className = "gr-status error"; }
      if (btn) btn.disabled = false;
      return;
    }
    retainerSub = {
      ...retainerSub,
      ...(data.auto_release !== undefined ? { auto_release: data.auto_release } : {}),
      terminates_at: data.terminates_at,
      period_count: data.period_count ?? retainerSub.period_count,
    };
    // Catch-up releases (auto_release flipped on) may have changed period rows.
    retainerPeriods = await loadRetainerPeriods(currentBid.id);
    renderRetainerPeriodsPanel();
    // Re-render so the length hint shows the new end date; that replaces
    // the status node, so write the message to the fresh one.
    renderRetainerControls();
    const catchUp = (data.catch_up_released || []).filter((r) => r.ok).length;
    const msg = catchUp > 0
      ? `saved. released ${catchUp} held period${catchUp === 1 ? "" : "s"}.`
      : "saved.";
    const freshStatus = document.getElementById("eg-retainer-controls-status");
    if (freshStatus) { freshStatus.textContent = msg; freshStatus.className = "gr-status success"; }
  } catch (err) {
    if (status) { status.textContent = err.message || "could not reach the payment server."; status.className = "gr-status error"; }
    if (btn) btn.disabled = false;
  }
}

async function endRetainerAfterPeriod() {
  if (!currentBid?.id) return;
  const confirmCopy = viewRole === "owner"
    ? "end this retainer after the current period? this month's work and payment continue normally, then no further invoices."
    : "stop your end of this retainer after the current period? you'll finish out this month's work and payment.";
  if (!window.confirm(confirmCopy)) return;
  const status = document.getElementById("eg-retainer-controls-status");
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch("/api/stripe/retainer/cancel-subscription", {
      method: "POST", headers, body: JSON.stringify({ bid_id: currentBid.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      showError(data.error || "could not end retainer.");
      return;
    }
    showSuccess("retainer will end at the end of the current period.", { duration: 5000 });
    // The DB row stays 'active' (intent recorded on Stripe); periods continue
    // until the webhook flips us to canceled. Re-render to surface state.
    retainerPeriods = await loadRetainerPeriods(currentBid.id);
    renderRetainerPeriodsPanel();
  } catch (err) {
    showError(err.message || "could not reach the payment server.");
  }
}

async function releaseRetainerPeriod(periodIndex, btnEl) {
  if (!currentBid?.id) return;
  if (!window.confirm(`release period ${periodIndex + 1}'s escrow to the consultant?`)) return;
  if (btnEl) btnEl.disabled = true;
  periodStatusEl.textContent = "";
  periodStatusEl.className = "gr-status";
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch("/api/stripe/retainer/release-period", {
      method: "POST",
      headers,
      body: JSON.stringify({ bid_id: currentBid.id, period_index: periodIndex }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      periodStatusEl.textContent = data.error || "could not release period.";
      periodStatusEl.className = "gr-status error";
      if (btnEl) btnEl.disabled = false;
      return;
    }
    retainerPeriods = await loadRetainerPeriods(currentBid.id);
    showSuccess(`period ${periodIndex + 1} released.`);
    renderRetainerPeriodsPanel();
  } catch (err) {
    periodStatusEl.textContent = err.message || "could not reach the payment server.";
    periodStatusEl.className = "gr-status error";
    if (btnEl) btnEl.disabled = false;
  }
}

function renderRetainerOfferPanel() {
  if (!retainerOfferPanel) return;

  // Offer flow only applies to non-retainer-contract engagements that are
  // past the release moment. Retainer-contract engagements have their own
  // continue / cancel decision in renderRetainerDecisionPanel.
  const isRetainerContract = currentListing?.contract_type === "retainer";
  const released = currentBid?.payment_status === "released";
  if (isRetainerContract || !released) {
    retainerOfferPanel.classList.add("hidden");
    return;
  }

  const status = retainerSub?.status || null;

  // No offer yet.
  if (!status) {
    retainerOfferPanel.classList.remove("hidden");
    if (viewRole === "owner") {
      offerTitleEl.textContent = "keep this consultant on retainer?";
      offerStatusPill.textContent = "no offer yet";
      offerStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
      offerBodyEl.textContent = "you can offer this consultant ongoing retainer work for repeatable tasks. they'll bill on a cadence you set, and you can cancel any time.";
      offerActionsEl.classList.remove("hidden");
      offerDeclineBtn.classList.add("hidden");
      offerPrimaryBtn.classList.remove("hidden");
      offerPrimaryBtn.textContent = offerFormVisible ? "send offer" : "offer retainer";
      offerFormEl.classList.toggle("hidden", !offerFormVisible);
    } else {
      // No offer for the consultant to see yet.
      retainerOfferPanel.classList.add("hidden");
    }
    return;
  }

  // Offered, awaiting consultant response.
  if (status === "offered") {
    retainerOfferPanel.classList.remove("hidden");
    offerFormEl.classList.add("hidden");
    offerStatusPill.textContent = "offer pending";
    offerStatusPill.className = "gr-pill gr-pill--warn gr-pill--no-dot";
    const feeLabel = retainerSub.fee_cents ? formatUsd(Number(retainerSub.fee_cents)) : "—";
    const summary = `${feeLabel} every ${cadenceLabel(retainerSub.cadence)} for ${retainerSub.period_count} period${retainerSub.period_count === 1 ? "" : "s"}`;
    if (viewRole === "owner") {
      offerTitleEl.textContent = "offer sent";
      offerBodyEl.textContent = `waiting for the consultant to accept or decline: ${summary}.`;
      offerActionsEl.classList.add("hidden");
    } else {
      offerTitleEl.textContent = "retainer offer";
      const note = retainerSub.offer_message
        ? ` they wrote: "${retainerSub.offer_message}"`
        : "";
      offerBodyEl.textContent = `the business is offering ${summary}.${note}`;
      offerActionsEl.classList.remove("hidden");
      offerDeclineBtn.classList.remove("hidden");
      offerPrimaryBtn.classList.remove("hidden");
      offerPrimaryBtn.textContent = "accept retainer";
    }
    return;
  }

  // Accepted → live subscription.
  if (status === "active" || status === "pending") {
    retainerOfferPanel.classList.remove("hidden");
    offerFormEl.classList.add("hidden");
    offerStatusPill.textContent = status === "pending" ? "starting…" : "active";
    offerStatusPill.className = "gr-pill gr-pill--accepted gr-pill--no-dot";
    offerTitleEl.textContent = "retainer is live";
    const feeLabel = retainerSub.fee_cents ? formatUsd(Number(retainerSub.fee_cents)) : "—";
    offerBodyEl.textContent = `billing ${feeLabel} every ${cadenceLabel(retainerSub.cadence)} — period ${retainerSub.periods_billed} of ${retainerSub.period_count}. each period escrows on payment and releases after the work is marked delivered.`;
    if (viewRole === "owner") {
      offerActionsEl.classList.remove("hidden");
      offerDeclineBtn.classList.add("hidden");
      offerPrimaryBtn.classList.remove("hidden");
      offerPrimaryBtn.textContent = "cancel retainer";
    } else {
      offerActionsEl.classList.add("hidden");
    }
    return;
  }

  // Declined.
  if (status === "declined") {
    retainerOfferPanel.classList.remove("hidden");
    offerFormEl.classList.add("hidden");
    offerStatusPill.textContent = "declined";
    offerStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
    offerTitleEl.textContent = "offer declined";
    offerBodyEl.textContent = viewRole === "owner"
      ? "the consultant declined the retainer offer."
      : "you declined this retainer offer.";
    offerActionsEl.classList.add("hidden");
    return;
  }

  // Canceled / completed → show summary, no further actions.
  if (status === "canceled" || status === "completed") {
    retainerOfferPanel.classList.remove("hidden");
    offerFormEl.classList.add("hidden");
    offerStatusPill.textContent = status;
    offerStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
    offerTitleEl.textContent = "retainer ended";
    offerBodyEl.textContent = `the retainer ran for ${retainerSub.periods_billed} period${retainerSub.periods_billed === 1 ? "" : "s"} and is now closed.`;
    offerActionsEl.classList.add("hidden");
    return;
  }

  retainerOfferPanel.classList.add("hidden");
}

function renderRetainerDecisionPanel() {
  if (!retainerDecisionPanel) return;
  const isRetainer = currentListing?.contract_type === "retainer";
  // Only relevant after the first period is released. Standard flow tracks
  // first-period state on the bid (payment_status='released').
  const firstReleased = currentBid?.payment_status === "released";
  if (!isRetainer || !firstReleased) {
    retainerDecisionPanel.classList.add("hidden");
    return;
  }
  retainerDecisionPanel.classList.remove("hidden");

  if (retainerSub?.status === "active" || retainerSub?.status === "pending") {
    retainerTitleEl.textContent = "retainer is live";
    retainerStatusPill.textContent = retainerSub.status === "pending" ? "starting…" : "active";
    retainerStatusPill.className = "gr-pill gr-pill--accepted gr-pill--no-dot";
    // Billing stops after `period_count` periods (the business can change
    // the length in the controls panel below), or earlier if either party
    // ends it after the current period.
    const billed = retainerSub.periods_billed || 0;
    const periodsLine = retainerSub.period_count
      ? `period ${billed} of ${retainerSub.period_count} billed.`
      : billed
        ? `${billed} period${billed === 1 ? "" : "s"} billed so far.`
        : "first period bills at the start of the next cycle.";
    retainerBodyEl.textContent = `billing every ${cadenceLabel(retainerSub.cadence)}. ${periodsLine} each period escrows on payment and releases after you mark the work delivered.`;
    retainerTermsForm.classList.add("hidden");
    // The cancel control moved to the retainer-controls panel under the
    // period list (handles both owner + consultant). Suppress the old
    // action buttons in this status panel to avoid two cancel paths.
    retainerActionsEl.classList.add("hidden");
    return;
  }
  if (retainerSub?.status === "canceled") {
    retainerTitleEl.textContent = "retainer ended";
    retainerStatusPill.textContent = "canceled";
    retainerStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
    retainerBodyEl.textContent = `the retainer ran for ${retainerSub.periods_billed} period${retainerSub.periods_billed === 1 ? "" : "s"} and is now closed. the consultant keeps whatever was paid out.`;
    retainerActionsEl.classList.add("hidden");
    retainerTermsForm.classList.add("hidden");
    return;
  }
  if (retainerDeclined) {
    retainerTitleEl.textContent = "closed as one-off";
    retainerStatusPill.textContent = "one-off";
    retainerStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
    retainerBodyEl.textContent = "you chose not to continue. this engagement closes here, with just the first period paid out.";
    retainerActionsEl.classList.add("hidden");
    retainerTermsForm.classList.add("hidden");
    return;
  }

  // No subscription yet. Owner sees the decision; consultant sees status only.
  if (viewRole !== "owner") {
    retainerTitleEl.textContent = "first period delivered";
    retainerStatusPill.textContent = "owner deciding";
    retainerStatusPill.className = "gr-pill gr-pill--warn gr-pill--no-dot";
    retainerBodyEl.textContent = "the business is deciding whether to continue billing on a retainer cadence or close out as a one-off.";
    retainerActionsEl.classList.add("hidden");
    retainerTermsForm.classList.add("hidden");
    return;
  }

  retainerTitleEl.textContent = "continue as a retainer?";
  retainerStatusPill.textContent = "decision pending";
  retainerStatusPill.className = "gr-pill gr-pill--warn gr-pill--no-dot";
  retainerActionsEl.classList.remove("hidden");
  retainerContinueBtn.classList.remove("hidden");
  retainerOneoffBtn.textContent = "close as one-off";
  retainerOneoffBtn.classList.remove("hidden");

  const fixed = currentListing.retainer_terms !== "tentative"
    && currentListing.retainer_cadence
    && currentListing.retainer_period_count
    && currentListing.retainer_fee_cents;

  if (fixed) {
    const feeLabel = formatUsd(Number(currentListing.retainer_fee_cents));
    retainerBodyEl.textContent = `continue billing ${feeLabel} every ${cadenceLabel(currentListing.retainer_cadence)} for ${currentListing.retainer_period_count} period${currentListing.retainer_period_count === 1 ? "" : "s"}, or close as a one-off.`;
    retainerTermsForm.classList.add("hidden");
    retainerContinueBtn.textContent = "continue retainer";
  } else {
    retainerBodyEl.textContent = "no terms were locked in at listing. fill them in below to start the retainer, or close as a one-off.";
    retainerTermsForm.classList.remove("hidden");
    retainerContinueBtn.textContent = "start retainer";
  }
}

function cadenceLabel(c) {
  if (c === "weekly") return "week";
  if (c === "biweekly") return "two weeks";
  if (c === "monthly") return "month";
  if (c === "quarterly") return "quarter";
  return c;
}

function renderServicePhasePanel() {
  if (!servicePhasePanel) return;
  const isPhased = currentListing?.contract_type === "phased";
  const selected = currentBid?.move_forward_status === "selected";
  if (!isPhased || !selected) {
    servicePhasePanel.classList.add("hidden");
    return;
  }
  servicePhasePanel.classList.remove("hidden");

  const status = servicePhase?.status || null;

  if (status === "released") {
    serviceTitleEl.textContent = "service fee released";
    serviceStatusPill.textContent = "released";
    serviceStatusPill.className = "gr-pill gr-pill--accepted gr-pill--no-dot";
    serviceBodyEl.textContent = "the service fee was paid out to the consultant. engagement complete.";
    serviceActionsEl.classList.add("hidden");
    return;
  }
  if (status === "held") {
    serviceTitleEl.textContent = "service fee in escrow";
    serviceStatusPill.textContent = "in escrow";
    serviceStatusPill.className = "gr-pill gr-pill--warn gr-pill--no-dot";
    serviceBodyEl.textContent = viewRole === "owner"
      ? "the service fee is locked in. mark the work complete and submit your review below to release it to the consultant."
      : "the service fee is in escrow. it releases to you once the business marks the work complete and submits their review.";
    serviceActionsEl.classList.add("hidden");
    return;
  }
  if (status === "authorizing") {
    serviceTitleEl.textContent = "service fee — payment in flight";
    serviceStatusPill.textContent = "authorizing";
    serviceStatusPill.className = "gr-pill gr-pill--warn gr-pill--no-dot";
    serviceBodyEl.textContent = "a payment is in progress. if it doesn't complete, the owner can retry from here.";
    serviceActionsEl.classList.toggle("hidden", viewRole !== "owner");
    return;
  }

  // No service phase row yet → owner sees the cta, consultant sees waiting copy.
  if (viewRole === "owner") {
    serviceTitleEl.textContent = "collect the service fee";
    serviceStatusPill.textContent = "pending";
    serviceStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
    const fee = Number(currentBid?.service_fee_cents);
    const feeLabel = Number.isFinite(fee) ? formatUsd(fee) : "the service fee";
    serviceBodyEl.textContent = `you moved forward with this consultant. ${Number.isFinite(fee) ? `${feeLabel} ` : ""}goes into escrow and releases once you submit your review.`;
    servicePayBtn.textContent = Number.isFinite(fee) ? `pay ${feeLabel}` : "pay service fee";
    serviceActionsEl.classList.remove("hidden");
  } else {
    serviceTitleEl.textContent = "service phase";
    serviceStatusPill.textContent = "awaiting payment";
    serviceStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
    serviceBodyEl.textContent = "the business is moving forward with you. they'll collect the service fee next, then the work begins.";
    serviceActionsEl.classList.add("hidden");
  }
}

function renderProposalDecisionPanel() {
  if (!proposalDecisionPanel) return;
  const isPhased = currentListing?.contract_type === "phased";
  if (!isPhased || !proposalPhase) {
    proposalDecisionPanel.classList.add("hidden");
    return;
  }
  proposalDecisionPanel.classList.remove("hidden");

  const decided = currentBid?.move_forward_status && currentBid.move_forward_status !== "pending";
  const phaseStatus = proposalPhase.status;

  // Render the status pill based on where we are in the lifecycle.
  if (phaseStatus === "released") {
    proposalStatusPill.textContent = "released";
    proposalStatusPill.className = "gr-pill gr-pill--accepted gr-pill--no-dot";
  } else if (phaseStatus === "held") {
    proposalStatusPill.textContent = "in escrow";
    proposalStatusPill.className = "gr-pill gr-pill--warn gr-pill--no-dot";
  } else if (phaseStatus === "refunded") {
    proposalStatusPill.textContent = "refunded";
    proposalStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
  } else {
    proposalStatusPill.textContent = phaseStatus || "pending";
    proposalStatusPill.className = "gr-pill gr-pill--muted gr-pill--no-dot";
  }

  // Body copy + actions visibility depend on viewer role and decision state.
  if (decided) {
    proposalActionsEl.classList.add("hidden");
    if (currentBid.move_forward_status === "selected") {
      proposalBodyEl.textContent = "you moved forward with this consultant. the proposal payment was released — service phase is up next.";
    } else {
      proposalBodyEl.textContent = "you closed out at the proposal phase. the consultant was paid for their proposal work. no further charges.";
    }
    return;
  }

  if (viewRole !== "owner") {
    proposalActionsEl.classList.add("hidden");
    proposalBodyEl.textContent = "your proposal fee is in escrow. the business will release it once they've met with you and decided whether to move forward with the full job.";
    return;
  }

  // Owner, pending decision.
  proposalActionsEl.classList.remove("hidden");
  proposalBodyEl.textContent = "this consultant's proposal fee is in escrow. once you've met, decide whether to continue with the full job. either way, the proposal fee releases to the consultant now — they earned it.";
}

function renderRefundCta() {
  if (!refundBtn || !refundHelper) return;
  const paymentStatus = currentBid?.payment_status;
  const paidAt = currentBid?.paid_at ? new Date(currentBid.paid_at).getTime() : null;
  const inWindow = paidAt && Date.now() - paidAt < REFUND_WINDOW_MS;

  if (paymentStatus === "held" && inWindow) {
    refundBtn.classList.remove("hidden");
    refundHelper.classList.add("hidden");
  } else if (paymentStatus === "held") {
    refundBtn.classList.add("hidden");
    refundHelper.classList.remove("hidden");
  } else {
    refundBtn.classList.add("hidden");
    refundHelper.classList.add("hidden");
  }
}

function renderOwnerActions() {
  // The phased + retainer panels render for both roles (owner sees actions,
  // consultant sees status) so they live outside the owner-only gate.
  renderProposalDecisionPanel();
  renderServicePhasePanel();
  renderRetainerDecisionPanel();
  renderRetainerOfferPanel();
  renderRetainerPeriodsPanel();

  if (viewRole !== "owner") {
    ownerActionsPanel.classList.add("hidden");
    reviewPanel.classList.add("hidden");
    return;
  }
  ownerActionsPanel.classList.remove("hidden");
  const engagementOngoing = scheduleState?.status === "scheduled" || scheduleState?.status === "completed";
  setBtnUnavailable(
    workCompletedBtn,
    !engagementOngoing,
    "you'll be able to mark work completed once a kickoff time is locked in.",
  );
  setBtnUnavailable(
    closeListingBtn,
    currentListing.status === "closed",
    "this listing is already closed.",
  );
  renderRefundCta();

  if (reviewState) {
    workCompletedBtn.textContent = "review submitted";
    setBtnUnavailable(
      workCompletedBtn,
      true,
      "you've already submitted a review for this engagement.",
    );
    reviewPanel.classList.remove("hidden");
    reviewForm.classList.add("hidden");
    reviewStatusEl.textContent = "thank you from grassroots. your review has been saved.";
    reviewStatusEl.className = "gr-status success";
  } else if (engagementOngoing) {
    // Engagement is in flight — review is required to mark it complete.
    workCompletedBtn.textContent = "submit review to complete";
    reviewPanel.classList.remove("hidden");
    reviewForm.classList.remove("hidden");
    reviewStatusEl.textContent = "";
    reviewStatusEl.className = "gr-status";
  } else {
    workCompletedBtn.textContent = "work completed";
    reviewPanel.classList.add("hidden");
    reviewForm.classList.remove("hidden");
    reviewStatusEl.textContent = "";
    reviewStatusEl.className = "gr-status";
  }
}

function renderByState() {
  hydrateSummary();
  renderOwnerActions();

  const schedule = scheduleState || getDefaultSchedule();
  scheduleState = schedule;
  setStatusPill(schedule.status);
  ownerSelection.clear();
  (schedule.owner_availability?.slots || []).forEach((slot) => ownerSelection.add(slot));

  saveAvailabilityBtn.classList.add("hidden");
  confirmTimeBtn.classList.add("hidden");
  durationWrap.classList.add("hidden");
  durationReadonly?.classList.add("hidden");
  ownerTools.classList.add("hidden");
  meetingStatusEl.textContent = "";
  meetingStatusEl.className = "gr-status";
  consultantChosen = null;

  if (schedule.status === "scheduled" || schedule.status === "completed") {
    panelTitleEl.textContent = "meeting confirmed";
    panelCopyEl.textContent =
      "your kickoff is locked in and the calendar invite is ready for both sides.";
    // Calendar grid stays collapsed once the meeting is on the books —
    // the meeting summary below (date + time) is all that's needed.
    // Owner can still see the meeting length via the read-only label.
    calendarEl.parentElement.classList.add("hidden");
    showDurationReadonly();
    renderMeetingSummary();
    return;
  }

  downloadInviteBtn.classList.add("hidden");
  meetingSummaryEl.classList.add("hidden");

  if (viewRole === "owner") {
    if (schedule.status === "awaiting_owner") {
      panelTitleEl.textContent = "share times that work";
      panelCopyEl.textContent =
        "pick how long the kickoff should be, then highlight the time ranges that work for you this week. the consultant will pick one of those options from their inbox.";
      ownerTools.classList.remove("hidden");
      // Owner picks the duration on first run. Pre-select whatever's
      // already persisted (in case they revisit this step).
      durationWrap.classList.remove("hidden");
      if (schedule.duration_minutes) {
        durationSelect.value = String(schedule.duration_minutes);
      }
      saveAvailabilityBtn.classList.remove("hidden");
      renderCalendar("owner");
      return;
    }

    panelTitleEl.textContent = "waiting on consultant";
    panelCopyEl.textContent =
      "your availability has been shared. the consultant can now choose a time within the ranges you marked.";
    // Show the duration the owner locked in (read-only) so they can see it.
    showDurationReadonly();
    renderCalendar("scheduled");
    return;
  }

  if (schedule.status === "awaiting_owner") {
    panelTitleEl.textContent = "waiting on business availability";
    panelCopyEl.textContent =
      "the business has accepted your offer and will share times that work for them here next.";
    renderCalendar("scheduled");
    return;
  }

  panelTitleEl.textContent = "pick your kickoff time";
  panelCopyEl.textContent =
    "choose one meeting time inside the availability the business highlighted, then submit it to generate the calendar invite.";
  // Consultant doesn't pick a duration — the business owner locked it in
  // when they shared availability. Show it as a read-only line instead.
  showDurationReadonly();
  confirmTimeBtn.classList.remove("hidden");
  renderCalendar("consultant");
}

function showDurationReadonly() {
  if (!durationReadonly || !durationReadonlyValue) return;
  const minutes = getSelectedDuration();
  durationReadonlyValue.textContent = `${minutes} min`;
  durationReadonly.classList.remove("hidden");
}

function selectedMeetingTimes() {
  if (!consultantChosen || !scheduleState) return null;
  const { dayIndex, slotIndex } = slotIdParts(consultantChosen);
  const start = slotToDate(scheduleState.week_start, dayIndex, slotIndex);
  const end = addMinutes(start, getSelectedDuration());
  return { start, end };
}

async function saveOwnerAvailability() {
  if (!ownerSelection.size) {
    showError("highlight at least one time block first.");
    return;
  }

  const next = {
    ...(scheduleState || getDefaultSchedule()),
    status: "awaiting_consultant",
    week_start: scheduleState?.week_start || toDateKey(getWeekStartDate()),
    duration_minutes: Number(durationSelect.value || "30"),
    owner_availability: {
      slots: [...ownerSelection].sort(),
    },
    selected_start: null,
    selected_end: null,
  };

  await saveSchedule(next);
  await insertNotification(
    currentBid.consultant_id,
    "pick a kickoff time",
    `your offer for "${currentListing.title}" was accepted. choose a meeting time within the business's availability.`,
    `/engagement.html?bid=${currentBid.id}`,
    "meeting_availability"
  );

  renderByState();
  showSuccess("availability shared. the consultant can now choose a meeting time.");
}

async function confirmConsultantTime() {
  const times = selectedMeetingTimes();
  if (!times) {
    showError("choose a start time first.");
    return;
  }

  // Disable the button while the request is in flight so the click
  // never feels dead. Success/failure surfaces via toast.
  confirmTimeBtn.disabled = true;

  try {
    const next = {
      ...scheduleState,
      status: "scheduled",
      selected_start: times.start.toISOString(),
      selected_end: times.end.toISOString(),
    };

    await saveSchedule(next);

    const when = formatDateTimeRange(next.selected_start, next.selected_end);
    const body = `${when}. grassroots wishes you both the best of luck, and we're excited to hear back.`;
    await Promise.all([
      insertNotification(
        currentListing.owner_id,
        "kickoff meeting confirmed",
        body,
        `/engagement.html?bid=${currentBid.id}`,
        "meeting_scheduled"
      ),
      insertNotification(
        currentBid.consultant_id,
        "kickoff meeting confirmed",
        body,
        `/engagement.html?bid=${currentBid.id}`,
        "meeting_scheduled"
      ),
    ]);

    renderByState();
    showSuccess("meeting confirmed. the calendar invite is ready.");
  } catch (err) {
    console.error("confirmConsultantTime failed", err);
    showError(err?.message || "could not confirm meeting time. try again in a moment.");
  } finally {
    confirmTimeBtn.disabled = false;
  }
}

async function closeListing() {
  const { error } = await supabase.from("listings").update({ status: "closed" }).eq("id", currentListing.id);
  if (error) {
    showError(error.message || "could not close listing.");
    return;
  }
  currentListing.status = "closed";
  listingStatusEl.textContent = "closed";
  setBtnUnavailable(closeListingBtn, true, "this listing is already closed.");
  showSuccess("opportunity closed. you can still manage this engagement here.");
}

async function submitReview() {
  const ready = RATING_DIMENSIONS.every(([key]) => isValidRating(reviewRatings[key]));
  if (!ready) {
    showError("rate the consultant on all five dimensions before submitting.");
    return;
  }

  const endorsement = endorsementInput.value.trim();

  const payload = {
    listing_id: currentListing.id,
    bid_id: currentBid.id,
    owner_id: currentListing.owner_id,
    consultant_id: currentBid.consultant_id,
    work_product_quality: reviewRatings.work_product_quality,
    communication: reviewRatings.communication,
    timeliness: reviewRatings.timeliness,
    professionalism: reviewRatings.professionalism,
    cost_value: reviewRatings.cost_value,
    endorsement: endorsement || null,
  };

  await saveReview(payload);
  scheduleState = await saveSchedule({
    ...(scheduleState || getDefaultSchedule()),
    status: "completed",
  });

  // Release escrowed funds to the consultant. Best-effort: review has saved
  // either way; if the transfer fails (consultant hasn't onboarded yet, etc.)
  // the owner sees the reason inline and can retry from the engagement page.
  //
  // Phased contracts use the per-phase endpoint (release-service), which
  // operates on `bid_phase_payments` instead of the bid's
  // `payment_intent_id` column (which is null for phased bids).
  const isPhased = currentListing?.contract_type === "phased";
  const releaseEndpoint = isPhased
    ? "/api/stripe/phased/release-service"
    : "/api/stripe/release-funds";
  let releaseMessage = "";
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(releaseEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ bid_id: currentBid.id }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      releaseMessage = ` payout pending: ${data.error || "could not release escrow yet."}`;
    } else {
      releaseMessage = " escrow released to the consultant.";
    }
  } catch (err) {
    releaseMessage = " escrow release will retry — couldn't reach the payment server.";
  }

  showSuccess(`thank you for the thoughtful review.${releaseMessage}`, { duration: 5000 });
  renderOwnerActions();
  // renderOwnerActions resets reviewStatusEl to the generic post-review
  // message. Append the release outcome so the in-page status surfaces it
  // too — toast disappears in 5s, the status row sticks around.
  if (reviewStatusEl && releaseMessage) {
    reviewStatusEl.textContent = `thank you from grassroots. your review has been saved.${releaseMessage}`;
    reviewStatusEl.className = releaseMessage.includes("released to the consultant")
      ? "gr-status success"
      : "gr-status";
  }
  setStatusPill(scheduleState.status);
}

function bindCalendarInteractions() {
  calendarEl.addEventListener("pointerdown", (event) => {
    const cell = event.target.closest("[data-slot-id]");
    if (!(cell instanceof HTMLButtonElement)) return;
    if (viewRole !== "owner" || scheduleState?.status !== "awaiting_owner") return;
    event.preventDefault();
    // Release implicit pointer capture so subsequent pointer events route to
    // whichever cell is under the cursor (otherwise the original cell keeps
    // capture and drag-to-select stops at the first slot).
    if (typeof cell.releasePointerCapture === "function" && cell.hasPointerCapture?.(event.pointerId)) {
      cell.releasePointerCapture(event.pointerId);
    }
    const id = cell.dataset.slotId;
    const isSelected = ownerSelection.has(id);
    dragState = { active: true, nextValue: !isSelected };
    if (dragState.nextValue) ownerSelection.add(id);
    else ownerSelection.delete(id);
    renderCalendar("owner");
  });

  // Track the last hovered cell during a drag so we don't repeatedly
  // toggle the same slot when the pointer stays within one cell.
  let dragLastSlotId = null;

  function handleDragOver(clientX, clientY) {
    if (!dragState.active || viewRole !== "owner" || scheduleState?.status !== "awaiting_owner") return;
    const target = document.elementFromPoint(clientX, clientY);
    if (!target) return;
    const cell = target.closest("[data-slot-id]");
    if (!(cell instanceof HTMLButtonElement)) return;
    if (!calendarEl.contains(cell)) return;
    const id = cell.dataset.slotId;
    if (id === dragLastSlotId) return;
    dragLastSlotId = id;
    if (dragState.nextValue) ownerSelection.add(id);
    else ownerSelection.delete(id);
    renderCalendar("owner");
  }

  calendarEl.addEventListener("pointermove", (event) => {
    handleDragOver(event.clientX, event.clientY);
  });

  // Fallback for environments where pointermove on the grid does not fire
  // every cell (e.g. when pointer is captured): listen at document level too.
  document.addEventListener("pointermove", (event) => {
    if (!dragState.active) return;
    handleDragOver(event.clientX, event.clientY);
  });

  calendarEl.addEventListener("click", (event) => {
    const cell = event.target.closest("[data-slot-id]");
    if (!(cell instanceof HTMLButtonElement)) return;
    const id = cell.dataset.slotId;
    if (viewRole === "consultant" && scheduleState?.status === "awaiting_consultant") {
      const available = new Set(scheduleState?.owner_availability?.slots || []);
      if (!canFitDuration(id, getSelectedDuration(), available)) {
        showError("choose a start time that fits inside the highlighted range.");
        return;
      }
      consultantChosen = id;
      renderCalendar("consultant");
    }
  });

  document.addEventListener("pointerup", () => {
    dragState = { active: false, nextValue: false };
    dragLastSlotId = null;
  });
  document.addEventListener("pointercancel", () => {
    dragState = { active: false, nextValue: false };
    dragLastSlotId = null;
  });
}

function bindReviewInteractions() {
  ratingGrid.addEventListener("click", (event) => {
    const btn = event.target.closest("[data-rating-key]");
    if (!(btn instanceof HTMLButtonElement)) return;
    reviewRatings[btn.dataset.ratingKey] = Number(btn.dataset.ratingValue);
    renderRatings();
  });

  // Hover preview — fill snaps to the value under the cursor while hovering,
  // then snaps back to the committed value on widget exit. Uses mouseover /
  // mouseout (which bubble) and a relatedTarget check so moving between
  // sibling halves inside the same widget doesn't flicker through the
  // committed value mid-traversal.
  function previewFill(hit, value) {
    const fill = hit.closest(".eg-stars")?.querySelector(".eg-stars__fill");
    if (!fill) return;
    fill.style.width = `${(Math.max(0, Math.min(5, value)) / 5) * 100}%`;
  }
  ratingGrid.addEventListener("mouseover", (event) => {
    const hit = event.target.closest(".eg-stars__hit");
    if (!hit) return;
    previewFill(hit, Number(hit.dataset.ratingValue));
  });
  ratingGrid.addEventListener("mouseout", (event) => {
    const hit = event.target.closest(".eg-stars__hit");
    if (!hit) return;
    const widget = hit.closest(".eg-stars");
    if (event.relatedTarget && widget?.contains(event.relatedTarget)) return;
    const committed = Number(reviewRatings[hit.dataset.ratingKey]) || 0;
    previewFill(hit, committed);
  });

  workCompletedBtn.addEventListener("click", () => {
    reviewPanel.classList.remove("hidden");
    reviewStatusEl.textContent = "";
    reviewStatusEl.className = "gr-status";
    reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    // Accent ring flash — drops the class first and forces reflow so
    // a second click re-fires the animation instead of being ignored
    // because the class was already there.
    reviewPanel.classList.remove("eg-panel--flash");
    void reviewPanel.offsetWidth;
    reviewPanel.classList.add("eg-panel--flash");
    reviewPanel.addEventListener(
      "animationend",
      () => reviewPanel.classList.remove("eg-panel--flash"),
      { once: true }
    );
    const firstStarBtn = ratingGrid?.querySelector(".eg-stars__hit");
    if (firstStarBtn instanceof HTMLElement) firstStarBtn.focus();
  });

  async function submitProposalDecision(decision) {
    if (!currentBid?.id) return;
    proposalSelectBtn.disabled = true;
    proposalDeclineBtn.disabled = true;
    proposalStatusEl.textContent = "";
    proposalStatusEl.className = "gr-status";
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/stripe/phased/proposal-decision", {
        method: "POST",
        headers,
        body: JSON.stringify({ bid_id: currentBid.id, decision }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        proposalStatusEl.textContent = data.error || "could not record decision.";
        proposalStatusEl.className = "gr-status error";
        proposalSelectBtn.disabled = false;
        proposalDeclineBtn.disabled = false;
        return;
      }
      // Refresh local state and re-render. Re-load the bid to surface the
      // service-fee phase row that the server creates on 'selected', so the
      // "pay service fee" panel appears without forcing the user to reload.
      currentBid.move_forward_status = decision;
      currentBid.move_forward_decided_at = new Date().toISOString();
      proposalPhase = await loadProposalPhase(currentBid.id);
      if (decision === "selected") {
        servicePhase = await loadServicePhase(currentBid.id);
      }
      const verbed = decision === "selected" ? "moving forward" : "closing out at proposal phase";
      showSuccess(`decision saved — ${verbed}. proposal payment released.`, { duration: 5000 });
      renderProposalDecisionPanel();
      renderServicePhasePanel();
    } catch (err) {
      proposalStatusEl.textContent = err.message || "could not reach the payment server.";
      proposalStatusEl.className = "gr-status error";
      proposalSelectBtn.disabled = false;
      proposalDeclineBtn.disabled = false;
    }
  }

  proposalSelectBtn?.addEventListener("click", () => submitProposalDecision("selected"));

  async function refreshRetainerAndRender() {
    retainerSub = await loadRetainerSubscription(currentBid.id);
    renderRetainerOfferPanel();
    renderRetainerDecisionPanel();
  }

  offerPrimaryBtn?.addEventListener("click", async () => {
    if (!currentBid?.id) return;

    // Click 1 (owner, no offer yet): expand the form. Click 2: submit.
    if (viewRole === "owner" && !retainerSub) {
      if (!offerFormVisible) {
        offerFormVisible = true;
        renderRetainerOfferPanel();
        return;
      }
      const cadence = offerCadenceInput?.value || "";
      const periods = Number(offerPeriodsInput?.value);
      const fee = Number(offerFeeInput?.value);
      const message = offerMessageInput?.value?.trim() || null;
      if (!cadence) {
        offerStatusEl.textContent = "pick a cadence.";
        offerStatusEl.className = "gr-status error";
        return;
      }
      if (!Number.isFinite(periods) || periods < 1) {
        offerStatusEl.textContent = "enter how many periods.";
        offerStatusEl.className = "gr-status error";
        return;
      }
      if (!Number.isFinite(fee) || fee < 1) {
        offerStatusEl.textContent = "enter the fee per period.";
        offerStatusEl.className = "gr-status error";
        return;
      }
      offerPrimaryBtn.disabled = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const res = await fetch("/api/stripe/retainer/offer", {
          method: "POST",
          headers,
          body: JSON.stringify({
            bid_id: currentBid.id,
            cadence,
            period_count: periods,
            fee,
            message,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          offerStatusEl.textContent = data.error || "could not send offer.";
          offerStatusEl.className = "gr-status error";
          return;
        }
        offerFormVisible = false;
        showSuccess("offer sent — waiting on the consultant.");
        await refreshRetainerAndRender();
      } catch (err) {
        offerStatusEl.textContent = err.message || "could not reach the server.";
        offerStatusEl.className = "gr-status error";
      } finally {
        offerPrimaryBtn.disabled = false;
      }
      return;
    }

    // Consultant accepting offer.
    if (viewRole === "consultant" && retainerSub?.status === "offered") {
      offerPrimaryBtn.disabled = true;
      offerDeclineBtn.disabled = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const res = await fetch("/api/stripe/retainer/accept-offer", {
          method: "POST",
          headers,
          body: JSON.stringify({ bid_id: currentBid.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          offerStatusEl.textContent = data.error || "could not accept.";
          offerStatusEl.className = "gr-status error";
          return;
        }
        showSuccess("retainer accepted — billing starts now.");
        await refreshRetainerAndRender();
      } catch (err) {
        offerStatusEl.textContent = err.message || "could not reach the server.";
        offerStatusEl.className = "gr-status error";
      } finally {
        offerPrimaryBtn.disabled = false;
        offerDeclineBtn.disabled = false;
      }
      return;
    }

    // Owner cancelling an active subscription.
    if (viewRole === "owner" && (retainerSub?.status === "active" || retainerSub?.status === "pending")) {
      const confirmed = window.confirm("cancel this retainer? no further periods will be billed.");
      if (!confirmed) return;
      offerPrimaryBtn.disabled = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const res = await fetch("/api/stripe/retainer/cancel-subscription", {
          method: "POST",
          headers,
          body: JSON.stringify({ bid_id: currentBid.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          offerStatusEl.textContent = data.error || "could not cancel.";
          offerStatusEl.className = "gr-status error";
          return;
        }
        showSuccess("retainer canceled.");
        await refreshRetainerAndRender();
      } catch (err) {
        offerStatusEl.textContent = err.message || "could not reach the server.";
        offerStatusEl.className = "gr-status error";
      } finally {
        offerPrimaryBtn.disabled = false;
      }
    }
  });

  offerDeclineBtn?.addEventListener("click", async () => {
    if (!currentBid?.id || retainerSub?.status !== "offered") return;
    offerPrimaryBtn.disabled = true;
    offerDeclineBtn.disabled = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/stripe/retainer/decline-offer", {
        method: "POST",
        headers,
        body: JSON.stringify({ bid_id: currentBid.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        offerStatusEl.textContent = data.error || "could not decline.";
        offerStatusEl.className = "gr-status error";
        return;
      }
      await refreshRetainerAndRender();
    } catch (err) {
      offerStatusEl.textContent = err.message || "could not reach the server.";
      offerStatusEl.className = "gr-status error";
    } finally {
      offerPrimaryBtn.disabled = false;
      offerDeclineBtn.disabled = false;
    }
  });

  retainerContinueBtn?.addEventListener("click", async () => {
    if (!currentBid?.id) return;
    retainerStatusEl.textContent = "";
    retainerStatusEl.className = "gr-status";
    retainerContinueBtn.disabled = true;
    retainerOneoffBtn.disabled = true;

    const tentative = currentListing.retainer_terms === "tentative"
      || !currentListing.retainer_cadence
      || !currentListing.retainer_period_count
      || !currentListing.retainer_fee_cents;

    const body = { bid_id: currentBid.id };
    if (tentative) {
      const cadence = retainerCadenceInput?.value || "";
      const periods = Number(retainerPeriodsInput?.value);
      const fee = Number(retainerFeeInput?.value);
      if (!cadence) {
        retainerStatusEl.textContent = "pick a cadence.";
        retainerStatusEl.className = "gr-status error";
        retainerContinueBtn.disabled = false;
        retainerOneoffBtn.disabled = false;
        return;
      }
      if (!Number.isFinite(periods) || periods < 1) {
        retainerStatusEl.textContent = "enter how many periods.";
        retainerStatusEl.className = "gr-status error";
        retainerContinueBtn.disabled = false;
        retainerOneoffBtn.disabled = false;
        return;
      }
      if (!Number.isFinite(fee) || fee < 1) {
        retainerStatusEl.textContent = "enter the fee per period.";
        retainerStatusEl.className = "gr-status error";
        retainerContinueBtn.disabled = false;
        retainerOneoffBtn.disabled = false;
        return;
      }
      body.cadence = cadence;
      body.period_count = periods;
      body.fee = fee;
    }

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/stripe/retainer/start-subscription", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        retainerStatusEl.textContent = data.error || "could not start retainer.";
        retainerStatusEl.className = "gr-status error";
        retainerContinueBtn.disabled = false;
        retainerOneoffBtn.disabled = false;
        return;
      }
      retainerSub = await loadRetainerSubscription(currentBid.id);
      showSuccess(`retainer started — ${data.cadence} × ${data.period_count}.`);
      renderRetainerDecisionPanel();
    } catch (err) {
      retainerStatusEl.textContent = err.message || "could not reach the payment server.";
      retainerStatusEl.className = "gr-status error";
      retainerContinueBtn.disabled = false;
      retainerOneoffBtn.disabled = false;
    }
  });

  retainerOneoffBtn?.addEventListener("click", async () => {
    if (!currentBid?.id) return;
    // Branch: if there's already an active subscription, cancel it.
    // Otherwise the owner is choosing "close as one-off" before any
    // subscription was started — no server call needed, just record locally
    // and re-render. (Persisted state is implicit: no retainer_subscriptions
    // row means the engagement is a one-off.)
    if (retainerSub?.status === "active" || retainerSub?.status === "pending") {
      const confirmed = window.confirm("cancel this retainer? no further periods will be billed. periods already paid will remain with the consultant.");
      if (!confirmed) return;
      retainerContinueBtn.disabled = true;
      retainerOneoffBtn.disabled = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const headers = { "Content-Type": "application/json" };
        if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
        const res = await fetch("/api/stripe/retainer/cancel-subscription", {
          method: "POST",
          headers,
          body: JSON.stringify({ bid_id: currentBid.id }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          retainerStatusEl.textContent = data.error || "could not cancel.";
          retainerStatusEl.className = "gr-status error";
          retainerContinueBtn.disabled = false;
          retainerOneoffBtn.disabled = false;
          return;
        }
        retainerSub = await loadRetainerSubscription(currentBid.id);
        showSuccess("retainer canceled.");
        renderRetainerDecisionPanel();
      } catch (err) {
        retainerStatusEl.textContent = err.message || "could not reach the payment server.";
        retainerStatusEl.className = "gr-status error";
        retainerContinueBtn.disabled = false;
        retainerOneoffBtn.disabled = false;
      }
      return;
    }

    // No subscription yet — record "one-off" locally and re-render.
    retainerDeclined = true;
    renderRetainerDecisionPanel();
  });

  servicePayBtn?.addEventListener("click", async () => {
    if (!currentBid?.id) return;
    servicePayBtn.disabled = true;
    try {
      const result = await payAndStartService({ client: supabase, bid: currentBid, listing: currentListing });
      if (result?.ok) {
        showSuccess("service fee in escrow. reloading…");
        window.location.reload();
      }
    } catch (err) {
      showError(err?.message || "could not start payment.");
    } finally {
      servicePayBtn.disabled = false;
    }
  });

  proposalDeclineBtn?.addEventListener("click", () => {
    const confirmed = window.confirm(
      "stay at proposal only? the consultant will be paid for their proposal work and the engagement closes here. you won't be charged the full service fee."
    );
    if (!confirmed) return;
    submitProposalDecision("declined");
  });

  // Out-of-window refund — opens a small modal so the owner can write
  // up what happened, then drops them into a mailto with the engagement
  // id + reason pre-filled. A proper refund-requests table + admin queue
  // is on the roadmap; this is the minimum UX upgrade over the bare
  // mailto link the audit flagged.
  refundRequestBtn?.addEventListener("click", () => {
    openRefundRequestModal({
      engagementId: currentBid?.id,
      listingTitle: currentListing?.title || "",
    });
  });

  refundBtn?.addEventListener("click", async () => {
    const confirmed = window.confirm(
      "refund this engagement? the funds will return to your payment method and the consultant will be notified. this cannot be undone."
    );
    if (!confirmed) return;
    refundBtn.disabled = true;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const headers = { "Content-Type": "application/json" };
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/stripe/refund-payment", {
        method: "POST",
        headers,
        body: JSON.stringify({ bid_id: currentBid.id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.windowExpired) {
          showError(data.error || "refund window expired.");
          currentBid.payment_status = currentBid.payment_status; // no-op; re-render so helper shows
          renderRefundCta();
        } else {
          showError(data.error || "could not process refund.");
        }
        return;
      }
      currentBid.payment_status = "refunded";
      showSuccess("refund issued. funds will return within a few days.", { duration: 5000 });
      renderOwnerActions();
    } catch (err) {
      showError("could not reach the payment server.");
    } finally {
      refundBtn.disabled = false;
    }
  });

  reviewForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitReview();
  });
}

async function init() {
  const bidId = getBidId();
  if (!bidId) {
    gate.textContent = "no accepted bid was provided.";
    gate.className = "gr-status error";
    return;
  }

  try {
    supabase = await getSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      window.location.href = `/signin.html?next=${encodeURIComponent(`/engagement.html?bid=${bidId}`)}`;
      return;
    }

    sessionUserId = session.user.id;

    const { data: bid, error: bidError } = await loadBid(bidId);
    if (bidError) throw bidError;
    if (!bid) throw new Error("accepted offer not found.");
    currentBid = bid;

    const { data: listing, error: listingError } = await loadListing(bid.listing_id);
    if (listingError) throw listingError;
    if (!listing) throw new Error("listing not found.");
    currentListing = listing;
    document.title = `grassroots — ongoing work for ${listing.title}`;

    const [{ data: owner }, { data: consultant }] = await Promise.all([
      loadProfile(listing.owner_id),
      loadProfile(bid.consultant_id),
    ]);
    ownerProfile = owner;
    consultantProfile = consultant;

    if (sessionUserId === listing.owner_id) viewRole = "owner";
    else if (sessionUserId === bid.consultant_id) viewRole = "consultant";
    else throw new Error("you do not have access to this engagement.");

    scheduleState = (await loadSchedule(bidId)) || getDefaultSchedule();
    reviewState = await loadReview(bidId);

    if (currentListing.contract_type === "phased") {
      proposalPhase = await loadProposalPhase(bidId);
      servicePhase = await loadServicePhase(bidId);
    }
    // Always load the retainer_subscriptions row so the convert-to-retainer
    // offer flow (non-retainer engagements) can render an offer pending /
    // accepted / declined state.
    retainerSub = await loadRetainerSubscription(bidId);
    retainerPeriods = await loadRetainerPeriods(bidId);

    if (reviewState) {
      for (const [key] of RATING_DIMENSIONS) {
        reviewRatings[key] = Number(reviewState[key]) || 0;
      }
      endorsementInput.value = reviewState.endorsement || "";
    }

    renderRatings();
    renderByState();

    gate.hidden = true;
    detail.hidden = false;
  } catch (err) {
    gate.textContent = err.message || "could not load ongoing work.";
    gate.className = "gr-status error";
  }
}

clearAvailabilityBtn.addEventListener("click", () => {
  ownerSelection.clear();
  renderCalendar("owner");
});

saveAvailabilityBtn.addEventListener("click", async () => {
  await saveOwnerAvailability();
});

confirmTimeBtn.addEventListener("click", async () => {
  await confirmConsultantTime();
});

// Duration is owner-controlled. The dropdown only shows during the
// `awaiting_owner` step (before they share availability), so a change here
// just updates the working value used by saveOwnerAvailability — no
// re-render needed.

closeListingBtn.addEventListener("click", async () => {
  await closeListing();
});

// Capture-phase delegate that intercepts clicks on any owner-action
// button currently flagged aria-disabled. Surfaces the
// data-disabled-reason as an info toast and stops propagation so the
// button's own click handler doesn't run.
ownerActionsPanel?.addEventListener(
  "click",
  (e) => {
    const btn = e.target.closest('.gr-btn[aria-disabled="true"]');
    if (!btn || !ownerActionsPanel.contains(btn)) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    e.stopPropagation();
    const reason = btn.dataset.disabledReason || "this action isn't available right now.";
    showInfo(reason, { duration: 4500 });
  },
  true,
);

bindCalendarInteractions();
bindReviewInteractions();
init();
