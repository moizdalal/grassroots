import { getSupabaseClient } from "/supabase-loader.js";
import { renderRatingMarkup, fetchRatingFor } from "/rating.js";

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
const ownerActionStatusEl = document.getElementById("eg-owner-action-status");
const reviewPanel = document.getElementById("eg-review-panel");
const reviewForm = document.getElementById("eg-review-form");
const ratingGrid = document.getElementById("eg-rating-grid");
const endorsementInput = document.getElementById("eg-endorsement");
const anonInput = document.getElementById("eg-anon");
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
const ownerSelection = new Set();
const reviewRatings = Object.create(null);
let consultantChosen = null;
let dragState = { active: false, nextValue: false };

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
    .select("id, listing_id, consultant_id, amount_cents, message, status, accepted_at, proposal_due_at")
    .eq("id", bidId)
    .maybeSingle();
  return { data, error };
}

async function loadListing(listingId) {
  const { data, error } = await supabase
    .from("listings")
    .select("id, owner_id, title, status, created_at")
    .eq("id", listingId)
    .maybeSingle();
  return { data, error };
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
    const { data, error } = await supabase
      .from("engagement_schedules")
      .upsert(payload, { onConflict: "bid_id" })
      .select()
      .single();

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

function getSelectedDuration() {
  return Number(durationSelect.value || "60");
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

function updateReviewSubmitState() {
  const ready = RATING_DIMENSIONS.every(([key]) => Number.isInteger(reviewRatings[key]) && reviewRatings[key] >= 1);
  submitReviewBtn.disabled = !ready;
}

function renderRatings() {
  ratingGrid.innerHTML = RATING_DIMENSIONS.map(([key, label]) => {
    const stars = Array.from({ length: 5 }, (_, idx) => {
      const value = idx + 1;
      const active = reviewRatings[key] === value ? "is-active" : "";
      return `<button type="button" class="eg-rating-star ${active}" data-rating-key="${key}" data-rating-value="${value}">${value}</button>`;
    }).join("");
    return `
      <div class="eg-rating-row">
        <div class="eg-rating-label">${label}</div>
        <div class="eg-rating-stars">${stars}</div>
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

function renderOwnerActions() {
  if (viewRole !== "owner") {
    ownerActionsPanel.classList.add("hidden");
    reviewPanel.classList.add("hidden");
    return;
  }
  ownerActionsPanel.classList.remove("hidden");
  const engagementOngoing = scheduleState?.status === "scheduled" || scheduleState?.status === "completed";
  workCompletedBtn.disabled = !engagementOngoing;
  closeListingBtn.disabled = currentListing.status === "closed";

  if (reviewState) {
    workCompletedBtn.textContent = "review submitted";
    workCompletedBtn.disabled = true;
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
  ownerTools.classList.add("hidden");
  meetingStatusEl.textContent = "";
  meetingStatusEl.className = "gr-status";
  consultantChosen = null;

  if (schedule.status === "scheduled" || schedule.status === "completed") {
    panelTitleEl.textContent = "meeting confirmed";
    panelCopyEl.textContent =
      "your kickoff is locked in and the calendar invite is ready for both sides.";
    renderCalendar("scheduled");
    renderMeetingSummary();
    if (schedule.owner_availability?.slots?.length) {
      calendarEl.parentElement.classList.remove("hidden");
    }
    return;
  }

  downloadInviteBtn.classList.add("hidden");
  meetingSummaryEl.classList.add("hidden");

  if (viewRole === "owner") {
    if (schedule.status === "awaiting_owner") {
      panelTitleEl.textContent = "share times that work";
      panelCopyEl.textContent =
        "highlight the time ranges that work for you this week. the consultant will pick one of those options from their inbox.";
      ownerTools.classList.remove("hidden");
      saveAvailabilityBtn.classList.remove("hidden");
      renderCalendar("owner");
      return;
    }

    panelTitleEl.textContent = "waiting on consultant";
    panelCopyEl.textContent =
      "your availability has been shared. the consultant can now choose a time within the ranges you marked.";
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
  durationWrap.classList.remove("hidden");
  confirmTimeBtn.classList.remove("hidden");
  renderCalendar("consultant");
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
    meetingStatusEl.textContent = "highlight at least one time block first.";
    meetingStatusEl.className = "gr-status error";
    return;
  }

  const next = {
    ...(scheduleState || getDefaultSchedule()),
    status: "awaiting_consultant",
    week_start: scheduleState?.week_start || toDateKey(getWeekStartDate()),
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
  meetingStatusEl.textContent = "availability shared. the consultant can now choose a meeting time.";
  meetingStatusEl.className = "gr-status success";
}

async function confirmConsultantTime() {
  const times = selectedMeetingTimes();
  if (!times) {
    meetingStatusEl.textContent = "choose a start time first.";
    meetingStatusEl.className = "gr-status error";
    return;
  }

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
  meetingStatusEl.textContent = "meeting confirmed. the calendar invite is ready.";
  meetingStatusEl.className = "gr-status success";
}

async function closeListing() {
  const { error } = await supabase.from("listings").update({ status: "closed" }).eq("id", currentListing.id);
  if (error) {
    ownerActionStatusEl.textContent = error.message || "could not close listing.";
    ownerActionStatusEl.className = "gr-status error";
    return;
  }
  currentListing.status = "closed";
  listingStatusEl.textContent = "closed";
  closeListingBtn.disabled = true;
  ownerActionStatusEl.textContent = "opportunity closed. you can still manage this engagement here.";
  ownerActionStatusEl.className = "gr-status success";
}

async function submitReview() {
  const ready = RATING_DIMENSIONS.every(([key]) => Number.isInteger(reviewRatings[key]) && reviewRatings[key] >= 1);
  if (!ready) {
    reviewStatusEl.textContent = "rate the consultant on all five dimensions before submitting.";
    reviewStatusEl.className = "gr-status error";
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
    is_anonymous: anonInput.checked,
  };

  await saveReview(payload);
  scheduleState = await saveSchedule({
    ...(scheduleState || getDefaultSchedule()),
    status: "completed",
  });

  // Release escrowed funds to the consultant. Best-effort: review has saved
  // either way; if the transfer fails (consultant hasn't onboarded yet, etc.)
  // the owner sees the reason inline and can retry from the engagement page.
  let releaseMessage = "";
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = { "Content-Type": "application/json" };
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch("/api/stripe/release-funds", {
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

  reviewStatusEl.textContent = `thank you from grassroots. we appreciate the thoughtful review.${releaseMessage}`;
  reviewStatusEl.className = "gr-status success";
  renderOwnerActions();
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
        meetingStatusEl.textContent = "choose a start time that fits inside the highlighted range.";
        meetingStatusEl.className = "gr-status error";
        return;
      }
      consultantChosen = id;
      meetingStatusEl.textContent = "";
      meetingStatusEl.className = "gr-status";
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

  workCompletedBtn.addEventListener("click", () => {
    reviewPanel.classList.remove("hidden");
    reviewStatusEl.textContent = "";
    reviewStatusEl.className = "gr-status";
    reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
    const firstStarBtn = ratingGrid?.querySelector(".eg-rating-star");
    if (firstStarBtn instanceof HTMLElement) firstStarBtn.focus();
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

    if (reviewState) {
      for (const [key] of RATING_DIMENSIONS) {
        reviewRatings[key] = Number(reviewState[key]) || 0;
      }
      endorsementInput.value = reviewState.endorsement || "";
      anonInput.checked = Boolean(reviewState.is_anonymous);
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

durationSelect.addEventListener("change", () => {
  if (viewRole === "consultant" && scheduleState?.status === "awaiting_consultant") {
    const available = new Set(scheduleState?.owner_availability?.slots || []);
    if (consultantChosen && !canFitDuration(consultantChosen, getSelectedDuration(), available)) {
      consultantChosen = null;
    }
    renderCalendar("consultant");
  }
});

closeListingBtn.addEventListener("click", async () => {
  await closeListing();
});

bindCalendarInteractions();
bindReviewInteractions();
init();
