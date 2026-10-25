// engagements.js — consultant-facing engagement hub.
// Shows every accepted bid the consultant has placed, split into
// current and past, and surfaces pending action items (mostly
// "pick a kickoff time") at the top so they can act without
// clicking into every engagement.

import { getSupabaseClient } from "/supabase-loader.js";
import { getInitials } from "/initials.js";

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

function fmtUSD(cents) {
  if (!Number.isFinite(Number(cents))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDateTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function publicAvatarUrl(client, path) {
  if (!path) return null;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

/* ============================================================== */
/*                          DATA LOADING                          */
/* ============================================================== */

async function loadEngagements(client, userId) {
  // All accepted bids for this consultant — these are the engagements.
  const { data: bids, error: bidsErr } = await client
    .from("bids")
    .select("id, listing_id, consultant_id, amount_cents, status, accepted_at, proposal_due_at, proposal_path, created_at")
    .eq("consultant_id", userId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false });
  if (bidsErr) throw bidsErr;

  const listingIds = [...new Set((bids || []).map((b) => b.listing_id).filter(Boolean))];
  let listings = [];
  if (listingIds.length) {
    const { data } = await client
      .from("listings")
      .select("id, owner_id, title, status, business_display_name")
      .in("id", listingIds);
    listings = data || [];
  }
  const listingMap = new Map(listings.map((l) => [l.id, l]));

  // Owner profile + business display for each unique listing owner.
  const ownerIds = [...new Set(listings.map((l) => l.owner_id).filter(Boolean))];
  const ownerMap = new Map();
  const ownerBizMap = new Map();
  if (ownerIds.length) {
    const [{ data: ownerProfiles }, { data: ownerBiz }] = await Promise.all([
      client.from("profiles").select("id, full_name, avatar_path").in("id", ownerIds),
      client.from("business_profiles").select("user_id, business_name").in("user_id", ownerIds),
    ]);
    for (const p of ownerProfiles || []) ownerMap.set(p.id, p);
    for (const b of ownerBiz || []) ownerBizMap.set(b.user_id, b.business_name);
  }

  // Kickoff schedules — keyed by bid id so we can attach state to each row.
  const bidIds = (bids || []).map((b) => b.id);
  const scheduleMap = new Map();
  if (bidIds.length) {
    const { data: schedules } = await client
      .from("engagement_schedules")
      .select("bid_id, status, selected_start, selected_end, duration_minutes")
      .in("bid_id", bidIds);
    for (const s of schedules || []) scheduleMap.set(s.bid_id, s);
  }

  return (bids || []).map((bid) => {
    const listing = listingMap.get(bid.listing_id);
    const owner = ownerMap.get(listing?.owner_id);
    const counterpart =
      ownerBizMap.get(listing?.owner_id) || owner?.full_name || "business";
    const schedule = scheduleMap.get(bid.id) || null;
    return { bid, listing, owner, counterpart, schedule };
  });
}

/* ============================================================== */
/*                       STATUS + PARTITION                        */
/* ============================================================== */

// Maps the combined (bid + listing + schedule) state to a short
// description, a pill kind, and — when relevant — a pending action
// the consultant can take from this page directly.
function engagementState(eng) {
  const { bid, listing, schedule } = eng;
  const listingClosed = listing?.status === "closed";
  const scheduleStatus = schedule?.status || null;

  // Past: review submitted (schedule completed) OR listing closed. The
  // listing-closed case keeps closed-but-unreviewed work in "past" so it
  // doesn't clutter the current list with stalled engagements.
  if (scheduleStatus === "completed") {
    return {
      bucket: "past",
      label: "Completed",
      pill: "completed",
      action: null,
      summary: schedule?.selected_start
        ? `Kicked off ${fmtDate(schedule.selected_start)}`
        : `Accepted ${fmtDate(bid.accepted_at)}`,
    };
  }
  if (listingClosed) {
    return {
      bucket: "past",
      label: "Closed",
      pill: "muted",
      action: null,
      summary: `Accepted ${fmtDate(bid.accepted_at)}`,
    };
  }

  // Current — branch on the kickoff schedule.
  if (scheduleStatus === "scheduled") {
    return {
      bucket: "current",
      label: "Kickoff scheduled",
      pill: "accepted",
      action: null,
      summary: schedule.selected_start
        ? `Kickoff ${fmtDateTime(schedule.selected_start)}`
        : `Accepted ${fmtDate(bid.accepted_at)}`,
    };
  }
  if (scheduleStatus === "awaiting_consultant") {
    return {
      bucket: "current",
      label: "Your move",
      pill: "warn",
      action: {
        kind: "pick_time",
        title: "Pick a kickoff time",
        copy: "The business shared their availability. Choose a time that works for you.",
        cta: "Pick a time",
        href: `/engagement.html?bid=${bid.id}`,
      },
      summary: `Accepted ${fmtDate(bid.accepted_at)}`,
    };
  }
  if (scheduleStatus === "awaiting_owner") {
    return {
      bucket: "current",
      label: "Waiting on business",
      pill: "pending",
      action: null,
      summary: `Accepted ${fmtDate(bid.accepted_at)}`,
    };
  }
  // No engagement_schedule yet — owner hasn't shared availability.
  return {
    bucket: "current",
    label: "Awaiting kickoff",
    pill: "pending",
    action: null,
    summary: `Accepted ${fmtDate(bid.accepted_at)}`,
  };
}

/* ============================================================== */
/*                            RENDER                              */
/* ============================================================== */

function renderActions(client, actionables) {
  const root = $("eng-actions");
  const list = $("eng-actions-list");
  const count = $("eng-actions-count");
  if (!actionables.length) {
    root.hidden = true;
    list.innerHTML = "";
    return;
  }
  root.hidden = false;
  if (count) count.textContent = String(actionables.length);
  list.innerHTML = actionables
    .map(({ eng, state }) => {
      const avatarUrl = publicAvatarUrl(client, eng.owner?.avatar_path);
      const avatar = avatarUrl
        ? `<img src="${escape(avatarUrl)}" alt=""/>`
        : escape(getInitials(eng.counterpart));
      return `
        <div class="eng-action">
          <span class="eng-action__avatar cdash__eng-avatar gr-avatar">${avatar}</span>
          <div class="eng-action__meta">
            <span class="eng-action__title">${escape(state.action.title)}</span>
            <span class="eng-action__sub">${escape(eng.counterpart)} · ${escape(eng.listing?.title || "engagement")}</span>
            <p class="eng-action__copy">${escape(state.action.copy)}</p>
          </div>
          <a class="gr-btn gr-btn--primary gr-btn--sm eng-action__cta" href="${escape(state.action.href)}">${escape(state.action.cta)} →</a>
        </div>
      `;
    })
    .join("");
}

function renderList(client, rows, view) {
  const root = $("eng-list");
  const empty = $("eng-empty");
  if (!rows.length) {
    root.innerHTML = "";
    empty.hidden = false;
    empty.textContent =
      view === "past"
        ? "No past engagements yet. Once work wraps up, completed engagements will live here."
        : "No active engagements right now. Accepted offers will show up here.";
    return;
  }
  empty.hidden = true;
  root.innerHTML = rows
    .map(({ eng, state }) => {
      const avatarUrl = publicAvatarUrl(client, eng.owner?.avatar_path);
      const avatar = avatarUrl
        ? `<img src="${escape(avatarUrl)}" alt=""/>`
        : escape(getInitials(eng.counterpart));
      return `
        <a class="cdash__eng-row eng-row" data-bucket="${state.bucket}" href="/engagement.html?bid=${escape(eng.bid.id)}">
          <span class="cdash__eng-avatar gr-avatar">${avatar}</span>
          <div class="cdash__eng-meta eng-row__meta">
            <span class="cdash__eng-biz">${escape(eng.counterpart)}</span>
            <span class="cdash__eng-title">${escape(eng.listing?.title || "engagement")}</span>
            <span class="eng-row__sub">${escape(state.summary)}</span>
          </div>
          <span class="gr-pill gr-pill--${escape(state.pill)} gr-pill--no-dot eng-row__pill">${escape(state.label)}</span>
          <span class="cdash__eng-amount">${escape(fmtUSD(eng.bid.amount_cents))}</span>
          <span class="cdash__eng-arrow" aria-hidden="true">→</span>
        </a>
      `;
    })
    .join("");
}

function updateCount(rows, view) {
  const el = $("eng-count");
  if (!el) return;
  const n = rows.length;
  const label = view === "past" ? "past" : "active";
  el.textContent = `${n} ${label} engagement${n === 1 ? "" : "s"}`;
}

/* ============================================================== */
/*                      VIEW / URL HANDLING                       */
/* ============================================================== */

function readViewFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const v = params.get("view");
  return v === "past" ? "past" : "current";
}

function writeViewToUrl(view) {
  const url = new URL(window.location.href);
  if (view === "current") url.searchParams.delete("view");
  else url.searchParams.set("view", view);
  window.history.replaceState(null, "", url);
}

function setActiveTab(view) {
  document.querySelectorAll(".eng-toggle__btn").forEach((btn) => {
    const active = btn.dataset.view === view;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", String(active));
  });
  applyIndicator(view);
}

/* Pre-compute the pill indicator's offset+width for each tab in its
   active state. We snapshot every tab's "what would I look like if
   active right now" geometry during a transition-disabled measurement
   pass so the slide on click can read pre-baked coordinates instead
   of trying to chase a button mid-animation. */
function precomputeToggleMetrics() {
  const toggle = document.querySelector(".eng-toggle");
  if (!toggle) return;
  const buttons = [...toggle.querySelectorAll(".eng-toggle__btn")];
  if (!buttons.length) return;

  const originallyActive = buttons.find((b) => b.classList.contains("is-active"));

  toggle.classList.add("eng-toggle--measuring");

  buttons.forEach((target) => {
    buttons.forEach((b) => b.classList.toggle("is-active", b === target));
    // Force layout so getBoundingClientRect reflects the just-applied state.
    void target.offsetWidth;
    const rect = target.getBoundingClientRect();
    const parentRect = toggle.getBoundingClientRect();
    target.dataset.activeOffset = String(rect.left - parentRect.left);
    target.dataset.activeWidth = String(rect.width);
  });

  // Restore the originally active button so the user-visible state is
  // unchanged — we never paint between switches because all of this runs
  // synchronously inside one task.
  buttons.forEach((b) => b.classList.toggle("is-active", b === originallyActive));
  void toggle.offsetWidth;
  toggle.classList.remove("eng-toggle--measuring");
}

function applyIndicator(view) {
  const toggle = document.querySelector(".eng-toggle");
  const indicator = toggle?.querySelector(".eng-toggle__indicator");
  const target = toggle?.querySelector(`.eng-toggle__btn[data-view="${view}"]`);
  if (!indicator || !target) return;
  const offset = parseFloat(target.dataset.activeOffset || "0");
  const width = parseFloat(target.dataset.activeWidth || "0");
  if (!Number.isFinite(width) || width === 0) return;
  indicator.style.transform = `translate(${offset}px, -50%)`;
  indicator.style.width = `${width}px`;
}

/* ============================================================== */
/*                              INIT                              */
/* ============================================================== */

let cachedRows = null;
let cachedClient = null;

function applyView(view) {
  if (!cachedRows) return;
  setActiveTab(view);
  writeViewToUrl(view);
  const filtered = cachedRows.filter((r) => r.state.bucket === view);
  renderList(cachedClient, filtered, view);
  updateCount(filtered, view);
  // Action items belong to active work; show them only on the current tab.
  if (view === "current") {
    const actionables = cachedRows.filter((r) => r.state.bucket === "current" && r.state.action);
    renderActions(cachedClient, actionables);
  } else {
    renderActions(cachedClient, []);
  }
}

async function init() {
  const gate = $("eng-gate");
  const shell = $("eng-shell");
  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
      window.location.replace(`/signin.html?next=${encodeURIComponent("/engagements.html")}`);
      return;
    }

    const { data: profile } = await client
      .from("profiles")
      .select("id, role")
      .eq("id", session.user.id)
      .single();

    if (profile?.role !== "consultant") {
      // Owners don't have an "engagements" surface in this iteration.
      gate.textContent = "Engagements is a consultant-only view for now.";
      gate.className = "gr-status";
      return;
    }

    cachedClient = client;
    const engagements = await loadEngagements(client, session.user.id);
    cachedRows = engagements.map((eng) => ({ eng, state: engagementState(eng) }));

    gate.hidden = true;
    shell.hidden = false;

    // Measure pill geometry once the toggle is in the layout, then snap
    // the indicator to the initial view. Re-measure on resize so the
    // pill stays aligned if the viewport changes.
    precomputeToggleMetrics();
    applyView(readViewFromUrl());

    document.querySelectorAll(".eng-toggle__btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const view = btn.dataset.view;
        if (view !== "current" && view !== "past") return;
        applyView(view);
      });
    });

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        precomputeToggleMetrics();
        applyIndicator(readViewFromUrl());
      }, 120);
    });

    // Keep the page in sync if the user uses browser back/forward.
    window.addEventListener("popstate", () => applyView(readViewFromUrl()));
  } catch (err) {
    console.error("engagements load failed", err);
    gate.textContent = err?.message || "Could not load engagements.";
    gate.className = "gr-status error";
  }
}

init();
