// engagement-journey-flowers.js — consultant home-page panel that
// visualises every engagement as a flower growing through the five
// lifecycle stages:
//
//   1. offer submitted    (seed)
//   2. offer accepted     (germinating sprout)
//   3. kickoff scheduled  (young plant)
//   4. work delivered     (budding)
//   5. payout received    (in bloom)
//
// One engagement = one flower. The species is locked to the
// consultant's lifetime "non-premature engagement" index (1st ever =
// tulip, 2nd ever = daisy, …). An engagement that ends before the
// consultant is paid out is considered "premature" — it disappears
// from the panel and does NOT consume a species slot, so the next
// engagement reclaims that species.
//
// Mount surface:
//   mountEngagementJourneyFlowers(container, { client, engagements })
//   where each engagement looks like:
//     { bid, listing, owner, counterpart, schedule, ownerAvatarUrl }
//   The module derives stage + species + premature internally.

import { getInitials } from "/initials.js";
import { showToast } from "/toast.js";
import { FLOWERS, STAGE_META, plantSvg } from "/flower-sketch.js";

/* ============================================================== */
/*                       STAGE + STATE                            */
/* ============================================================== */

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
//   - listing has been closed while the bid never reached the
//     "released" payment state (work never completed for this bid)
// A bid whose payment_status is "released" is the terminal happy
// path — once paid, it permanently claims its species slot.
export function isPremature(bid, listing, _schedule) {
  if (!bid) return true;
  if (bid.payment_status === "released") return false;
  if (bid.payment_status === "refunded") return true;
  if (["rejected", "withdrawn", "declined"].includes(bid.status)) return true;
  if (listing?.status === "closed" && bid.status !== "accepted") return true;
  return false;
}

// Detect what's waiting on the consultant. Used for the pulsing
// action dot at the plant apex.
export function detectAction(bid, _listing, schedule) {
  if (schedule?.status === "awaiting_consultant") {
    return { title: "pick a kickoff time", href: `/engagement.html?bid=${bid.id}` };
  }
  return null;
}

// Short human-readable label for the current lifecycle state — fills
// the tooltip's status line so the user doesn't have to read the
// plant's growth to know what's happening.
export function detectStatus(stage, action, schedule, _listing) {
  if (action) return action.title;
  if (stage === 5) return "payout received";
  if (stage === 4) return "work delivered, awaiting payout";
  if (stage === 3) return "kickoff scheduled";
  if (stage === 2) {
    if (schedule?.status === "awaiting_owner") return "awaiting business availability";
    return "offer accepted — kickoff coming soon";
  }
  return "offer submitted — awaiting business response";
}

/* ============================================================== */
/*                       SPECIES INDEXING                          */
/* ============================================================== */

// Assign each non-premature engagement its species. The lifetime
// index — bids sorted by `created_at` ascending — drives the species
// lookup, so the first engagement the consultant ever opens is a
// tulip and the species progress simple → exotic in chronological
// order. Premature engagements are skipped, freeing the slot for the
// next real engagement.
//
// Beyond FLOWERS.length we wrap back to tulip for now; the user has
// flagged that we'll add more species (or pick a wraparound policy)
// before any consultant hits 17 engagements.
export function assignSpecies(engagements) {
  const lifetime = engagements
    .filter((e) => !e.premature)
    .slice()
    .sort(byBidCreatedAtAsc);
  const speciesByBidId = new Map();
  lifetime.forEach((eng, idx) => {
    const species = FLOWERS[idx % FLOWERS.length];
    speciesByBidId.set(String(eng.bid?.id), species);
  });
  return speciesByBidId;
}

function byBidCreatedAtAsc(a, b) {
  const ta = new Date(a.bid?.created_at || 0).getTime();
  const tb = new Date(b.bid?.created_at || 0).getTime();
  return ta - tb;
}

/* ============================================================== */
/*                      VIEWBOX → ALTITUDE                         */
/* ============================================================== */

// The plant SVG uses viewBox 100×160 with the soil at y=150. Each
// stage's apex sits at a specific y inside that viewBox. We express
// every gridline + axis-row top position as a percentage of the
// plant SVG's rendered height so labels line up exactly with where
// each species places its apex.
const APEX_Y = {
  1: 146, // just above the soil — seed visible at t=0
  2: 122, // sprout-top (H.s2)
  3:  85, // young-plant apex (H.s3)
  4:  50, // closed-bud height (H.s4)
  5:  18, // flower apex (H.s5)
};
const VIEW_H = 160;
function stagePct(stage) {
  return (APEX_Y[stage] / VIEW_H) * 100;
}

/* ============================================================== */
/*                     ORDER PERSISTENCE                           */
/* ============================================================== */

// User-defined plant order is keyed per consultant so different users
// on the same browser don't collide. Stored as a JSON array of bid_ids
// in the order the consultant wants them displayed (left → right).
function orderStorageKey(userId) {
  return userId ? `grassroots_journey_order_${userId}` : null;
}

function loadJourneyOrder(userId) {
  const key = orderStorageKey(userId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : null;
  } catch (_) {
    return null;
  }
}

function saveJourneyOrder(userId, orderedIds) {
  const key = orderStorageKey(userId);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(orderedIds)); } catch (_) {}
}

// Garden persistence — bloomed engagements the consultant has moved
// into the garden box. Stored as `{bid_id: moved_at_timestamp}` so we
// can order by recency on the profile page later. Garden plants are
// excluded from the journey display (they live exclusively in one
// state at a time — see the project memory for the exact rules).
function gardenStorageKey(userId) {
  return userId ? `grassroots_garden_${userId}` : null;
}

export function loadGardenForUser(userId) {
  const key = gardenStorageKey(userId);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

export function saveGardenForUser(userId, garden) {
  const key = gardenStorageKey(userId);
  if (!key) return;
  try { localStorage.setItem(key, JSON.stringify(garden)); } catch (_) {}
}

// Apply the saved user-defined order on top of the default newest-first
// list. Engagements the user has explicitly reordered keep their saved
// slot; engagements that didn't exist at reorder time (new bids since)
// drop in at the front so the most-recent-on-the-left rule still
// applies to fresh activity.
function applyCustomOrder(defaultList, savedOrder) {
  if (!savedOrder?.length) return defaultList;
  const orderSet = new Set(savedOrder);
  const known = defaultList.filter((e) => orderSet.has(e.id));
  const newcomers = defaultList.filter((e) => !orderSet.has(e.id));
  const knownById = new Map(known.map((e) => [e.id, e]));
  const sortedKnown = savedOrder.map((id) => knownById.get(id)).filter(Boolean);
  return [...newcomers, ...sortedKnown];
}

/* ============================================================== */
/*                          MOUNT                                  */
/* ============================================================== */

export function mountEngagementJourneyFlowers(container, { client, engagements, userId, unreadByBid, threadLinkBase }) {
  const unreadMap = unreadByBid instanceof Map ? unreadByBid : new Map();
  const linkBase = threadLinkBase || "#inbox";
  if (!container) return;

  // Enrich every engagement once with stage / premature / action /
  // status / avatar so the renderer doesn't have to recompute.
  const enriched = (engagements || []).map((eng) => {
    const stage = detectFlowerStage(eng.bid, eng.listing, eng.schedule);
    const premature = isPremature(eng.bid, eng.listing, eng.schedule);
    const action = premature ? null : detectAction(eng.bid, eng.listing, eng.schedule);
    const status = detectStatus(stage, action, eng.schedule, eng.listing);
    const id = String(eng.bid?.id || `seed-${Math.random().toString(36).slice(2, 8)}`);
    const ownerAvatarUrl =
      client && eng.owner?.avatar_path
        ? client.storage.from("avatars").getPublicUrl(eng.owner.avatar_path).data?.publicUrl || ""
        : "";
    return { ...eng, stage, premature, action, status, id, ownerAvatarUrl };
  });

  const speciesByBidId = assignSpecies(enriched);
  const hiddenIds = new Set();
  let savedOrder = loadJourneyOrder(userId);
  let gardenIds = loadGardenForUser(userId); // {bid_id: timestamp}
  // Shared drag state so both the shuffle handlers and the garden-tile
  // drop handler can tell what plant (and what lifecycle stage) is
  // being dragged. Updated in dragstart, cleared in dragend.
  const dragState = { bidId: null, stage: null };

  container.classList.add("cdash__journey-flowers");
  container.innerHTML = `
    <div class="cdash__journey-flowers-head">
      <button type="button" class="cdash__journey-flowers-unhide-all" hidden>show hidden (0)</button>
    </div>
    <div class="cdash__journey-flowers-stage" id="cdash-journey-flowers-stage"></div>
    ${renderTooltipMarkup()}
  `;

  container.querySelector(".cdash__journey-flowers-unhide-all")?.addEventListener("click", () => {
    hiddenIds.clear();
    applyFilter();
  });

  function applyFilter() {
    let visible = enriched
      .filter((e) => !e.premature && !hiddenIds.has(e.id) && !gardenIds[e.id])
      .slice()
      .sort((a, b) => {
        const ta = new Date(a.bid?.accepted_at || a.bid?.created_at || 0).getTime();
        const tb = new Date(b.bid?.accepted_at || b.bid?.created_at || 0).getTime();
        return tb - ta;
      });
    visible = applyCustomOrder(visible, savedOrder);

    const stageEl = container.querySelector(".cdash__journey-flowers-stage");
    if (!stageEl) return;
    const gardenCount = Object.keys(gardenIds).length;
    if (!visible.length && gardenCount === 0) {
      stageEl.innerHTML = renderEmpty();
    } else {
      stageEl.innerHTML = renderPanel(visible, speciesByBidId, gardenCount, unreadMap, linkBase);
      if (visible.length) {
        wireInteractions(container, stageEl, visible);
        wireShuffle(stageEl, visible, dragState, onReorder, addToGarden);
      }
    }
    updateUnhideAllHeaderButton();
  }

  // Receives the new left→right ordering of visible plant IDs and
  // persists it. Any IDs not in the saved order (new engagements that
  // arrive later) drop in at the front, see applyCustomOrder.
  function onReorder(orderedIds) {
    savedOrder = orderedIds.slice();
    saveJourneyOrder(userId, savedOrder);
    applyFilter();
  }

  // Move a bloomed plant into the garden. The plant disappears from the
  // journey on the next render and shows up in the profile page's
  // garden section (see /profile-page.js).
  function addToGarden(bidId) {
    gardenIds = { ...gardenIds, [bidId]: Date.now() };
    saveGardenForUser(userId, gardenIds);
    applyFilter();
  }

  function updateUnhideAllHeaderButton() {
    const btn = container.querySelector(".cdash__journey-flowers-unhide-all");
    if (!btn) return;
    if (hiddenIds.size > 0) {
      btn.hidden = false;
      btn.textContent = `show hidden (${hiddenIds.size})`;
    } else {
      btn.hidden = true;
    }
  }

  function hideEngagement(eng) {
    hiddenIds.add(eng.id);
    applyFilter();
    showToast(`hid ${eng.counterpart || "engagement"}`, {
      duration: 2400,
      action: {
        label: "undo",
        onClick: () => {
          hiddenIds.delete(eng.id);
          applyFilter();
        },
      },
    });
  }

  // Expose the hide handler so wireInteractions (defined outside the
  // closure for clarity) can call it without re-implementing the
  // toast/undo dance.
  container.__journeyHide = hideEngagement;

  applyFilter();
}

/* ============================================================== */
/*                          RENDERING                              */
/* ============================================================== */

function renderEmpty() {
  return `<div class="cdash__journey-flowers-empty">
    <p>no engagements yet — submit a bid and your first seed will sprout here.</p>
  </div>`;
}

function renderPanel(visible, speciesByBidId, gardenCount = 0, unreadMap = new Map(), linkBase = "#inbox") {
  const axisRows = [5, 4, 3, 2, 1]
    .map((s) => `
      <div class="cdash__journey-flowers-axis-row" data-stage="${s}"
           style="top: ${stagePct(s).toFixed(2)}%">
        <span class="cdash__journey-flowers-axis-name">${escapeHtml(STAGE_META[s].name)}</span>
      </div>
    `)
    .join("");

  const gridlines = [5, 4, 3, 2, 1]
    .map((s) => `<div class="cdash__journey-flowers-gridline" data-stage="${s}"
                       style="top: ${stagePct(s).toFixed(2)}%"></div>`)
    .join("");

  const plants = visible
    .map((eng, idx) => renderPlantColumn(eng, idx, speciesByBidId, unreadMap, linkBase))
    .join("");

  // Garden tile lives in its OWN grid column on the right so the
  // y-axis gridlines (which fill plants-wrap) don't extend through
  // it, and the tile stays anchored to the panel's right edge even
  // when only a few plants are visible.
  return `
    <div class="cdash__journey-flowers-canvas">
      <aside class="cdash__journey-flowers-axis" aria-hidden="true">${axisRows}</aside>
      <div class="cdash__journey-flowers-plants-wrap">
        <div class="cdash__journey-flowers-gridlines" aria-hidden="true">${gridlines}</div>
        <div class="cdash__journey-flowers-plants">${plants}</div>
      </div>
      ${renderGardenTile(gardenCount)}
    </div>
  `;
}

// "Your garden" drop zone — sits at the right end of the plants row.
// Accepts drops from stage-5 (bloomed) plants only; the actual stage
// check happens in wireGardenDrop's dragover handler. Clicking opens
// the full garden view on the profile page.
function renderGardenTile(gardenCount) {
  const plantLabel = gardenCount === 1 ? "plant" : "plants";
  return `
    <a class="cdash__journey-flowers-garden-tile" href="/profile.html#garden"
       aria-label="your garden — ${gardenCount} ${plantLabel}, click to view">
      <svg class="cdash__journey-flowers-garden-tile-icon" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M4 18h16M5 18l1 -5h12l1 5M10 13c0 -3 -2 -5 -3 -6c2 0 4 1 4 4M14 13c0 -3 2 -5 3 -6c-2 0 -4 1 -4 4M12 13v-7"
              fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span class="cdash__journey-flowers-garden-tile-label">your garden</span>
      <span class="cdash__journey-flowers-garden-tile-count">${gardenCount}</span>
      <span class="cdash__journey-flowers-garden-tile-hint">
        ${gardenCount === 0 ? "drag a bloomed plant here" : `${gardenCount} ${plantLabel} · view`}
      </span>
    </a>
  `;
}

function renderPlantColumn(eng, idx, speciesByBidId, unreadMap = new Map(), linkBase = "#inbox") {
  const species = speciesByBidId.get(eng.id) || FLOWERS[0];
  const stage = eng.stage;
  const plantMarkup = plantSvg(species, stage);
  const avatarMarkup = eng.ownerAvatarUrl
    ? `<img src="${escapeHtml(eng.ownerAvatarUrl)}" alt=""/>`
    : `<span>${escapeHtml(getInitials(eng.counterpart))}</span>`;
  const actionDot = eng.action
    ? `<button type="button" class="cdash__journey-flowers-action-dot" data-eng-index="${idx}"
              style="top: ${stagePct(stage).toFixed(2)}%"
              aria-label="${escapeHtml(eng.action.title)}"
              title="${escapeHtml(eng.action.title)}"></button>`
    : "";
  // Paper-plane indicator when this engagement has unread messages.
  // Clicking deep-links to the inbox view + that specific thread.
  const unread = unreadMap.get(eng.id);
  const unreadBadge = unread
    ? `<a class="cdash__journey-flowers-plant-msg" href="${escapeHtml(linkBase)}?thread=${escapeHtml(unread.threadKey)}"
          title="${unread.unread} unread message${unread.unread === 1 ? "" : "s"}"
          aria-label="${unread.unread} unread message${unread.unread === 1 ? "" : "s"} — open thread">
         <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
           <path d="M2.5 11.6L22 3l-4.7 18.5-5.8-7.4-3.4 3.4v-5.6L2.5 11.6z"/>
         </svg>
         <span class="cdash__journey-flowers-plant-msg-badge">${unread.unread > 9 ? "9+" : unread.unread}</span>
       </a>`
    : "";
  return `
    <div class="cdash__journey-flowers-plant" data-eng-index="${idx}" data-bid-id="${escapeHtml(eng.id)}"
         data-stage="${stage}">
      <button type="button" class="cdash__journey-flowers-plant-hide" data-eng-index="${idx}"
              aria-label="hide this plant" title="hide this plant">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18"/>
          <line x1="18" y1="6" x2="6" y2="18"/>
        </svg>
      </button>
      ${unreadBadge}
      <div class="cdash__journey-flowers-plant-canvas">${plantMarkup}${actionDot}</div>
      <div class="cdash__journey-flowers-plant-meta">
        <span class="cdash__journey-flowers-plant-avatar">${avatarMarkup}</span>
        <div class="cdash__journey-flowers-plant-text">
          <span class="cdash__journey-flowers-plant-biz">${escapeHtml(eng.counterpart || "business")}</span>
          <span class="cdash__journey-flowers-plant-title">${escapeHtml(eng.listing?.title || "engagement")}</span>
        </div>
      </div>
    </div>
  `;
}

function renderTooltipMarkup() {
  // The plant's avatar + biz name already appear below it in the meta
  // row, so the tooltip keeps just the engagement title, amount, and
  // current lifecycle status (plus an action row when something's
  // waiting on the consultant).
  return `
    <div class="cdash__journey-flowers-tooltip" role="tooltip" aria-hidden="true">
      <div class="cdash__journey-flowers-tooltip-main">
        <span class="cdash__journey-flowers-tooltip-title" data-tooltip-title></span>
        <span class="cdash__journey-flowers-tooltip-amount" data-tooltip-amount></span>
      </div>
      <div class="cdash__journey-flowers-tooltip-status">
        <span class="cdash__journey-flowers-tooltip-status-dot" aria-hidden="true"></span>
        <span class="cdash__journey-flowers-tooltip-status-text" data-tooltip-status></span>
      </div>
      <div class="cdash__journey-flowers-tooltip-action" data-tooltip-action hidden>
        <span class="cdash__journey-flowers-tooltip-action-label">action</span>
        <span class="cdash__journey-flowers-tooltip-action-title" data-tooltip-action-title></span>
        <span class="cdash__journey-flowers-tooltip-action-arrow" aria-hidden="true">→</span>
      </div>
    </div>
  `;
}

/* ============================================================== */
/*                       INTERACTIONS                              */
/* ============================================================== */

function wireInteractions(container, stage, visible) {
  const tooltip = container.querySelector(".cdash__journey-flowers-tooltip");
  const titleEl = tooltip?.querySelector("[data-tooltip-title]");
  const amountEl = tooltip?.querySelector("[data-tooltip-amount]");
  const statusEl = tooltip?.querySelector("[data-tooltip-status]");
  const actionRow = tooltip?.querySelector("[data-tooltip-action]");
  const actionTitleEl = tooltip?.querySelector("[data-tooltip-action-title]");

  function showTooltip(eng, evt) {
    if (!tooltip) return;
    // Don't show a hover card while a plant is being shuffled.
    if (container.classList.contains("is-shuffling")) return;
    titleEl.textContent = eng.listing?.title || "engagement";
    amountEl.textContent = fmtUSD(eng.bid?.amount_cents);
    statusEl.textContent = eng.status || "";
    if (eng.action) {
      actionRow.hidden = false;
      actionTitleEl.textContent = eng.action.title;
      tooltip.classList.add("has-action");
    } else {
      actionRow.hidden = true;
      tooltip.classList.remove("has-action");
    }
    const containerRect = container.getBoundingClientRect();
    const x = evt.clientX - containerRect.left;
    const y = evt.clientY - containerRect.top;
    tooltip.style.left = `${x}px`;
    tooltip.style.top = `${y - 12}px`;
    tooltip.classList.add("is-visible");
    tooltip.setAttribute("aria-hidden", "false");
    // Dim non-active plants while one is highlighted.
    stage.querySelectorAll(".cdash__journey-flowers-plant").forEach((p) => {
      p.classList.toggle("is-dimmed", p.dataset.engIndex !== String(visible.indexOf(eng)));
    });
    // Spotlight the matching axis row.
    container.querySelectorAll(".cdash__journey-flowers-axis-row").forEach((row) => {
      const active = row.dataset.stage === String(eng.stage);
      row.classList.toggle("is-active", active);
      row.classList.toggle("is-dimmed", !active);
    });
    container.querySelectorAll(".cdash__journey-flowers-gridline").forEach((line) => {
      line.classList.toggle("is-active", line.dataset.stage === String(eng.stage));
    });
  }

  function hideTooltip() {
    if (!tooltip) return;
    tooltip.classList.remove("is-visible", "has-action");
    tooltip.setAttribute("aria-hidden", "true");
    stage.querySelectorAll(".cdash__journey-flowers-plant").forEach((p) => p.classList.remove("is-dimmed"));
    container.querySelectorAll(".cdash__journey-flowers-axis-row").forEach((row) => {
      row.classList.remove("is-active", "is-dimmed");
    });
    container.querySelectorAll(".cdash__journey-flowers-gridline").forEach((line) => {
      line.classList.remove("is-active");
    });
  }

  // Each plant column: hover→tooltip, click→listing, hide button.
  stage.querySelectorAll(".cdash__journey-flowers-plant").forEach((plantEl) => {
    const idx = Number(plantEl.dataset.engIndex);
    const eng = visible[idx];
    if (!eng) return;
    plantEl.addEventListener("pointerenter", (e) => showTooltip(eng, e));
    plantEl.addEventListener("pointermove", (e) => showTooltip(eng, e));
    plantEl.addEventListener("pointerleave", hideTooltip);
    plantEl.addEventListener("focus", () => {
      const rect = plantEl.getBoundingClientRect();
      showTooltip(eng, { clientX: rect.left + rect.width / 2, clientY: rect.top + 24 });
    }, true);
    plantEl.addEventListener("blur", hideTooltip, true);
    // Click → open listing. Hide-button + action-dot stop propagation
    // so they don't also fire the navigate.
    plantEl.addEventListener("click", (e) => {
      if (e.target.closest(".cdash__journey-flowers-plant-hide")) return;
      if (e.target.closest(".cdash__journey-flowers-action-dot")) return;
      if (!eng.listing?.id) return;
      window.location.href = `/listing.html?id=${eng.listing.id}`;
    });
    plantEl.setAttribute("tabindex", "0");
    plantEl.setAttribute("role", "button");
    plantEl.setAttribute("aria-label",
      `${eng.counterpart || "business"} — ${eng.listing?.title || "engagement"} — ${fmtUSD(eng.bid?.amount_cents)} — stage ${eng.stage} of 5. open listing.`
    );
  });

  // Hide buttons
  stage.querySelectorAll(".cdash__journey-flowers-plant-hide").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const idx = Number(btn.dataset.engIndex);
      const eng = visible[idx];
      if (!eng) return;
      container.__journeyHide?.(eng);
    });
  });

  // Action dots — navigate straight to the engagement page.
  stage.querySelectorAll(".cdash__journey-flowers-action-dot").forEach((dot) => {
    const idx = Number(dot.dataset.engIndex);
    const eng = visible[idx];
    if (!eng?.action) return;
    const navigate = (e) => {
      e?.preventDefault();
      e?.stopPropagation();
      window.location.href = eng.action.href;
    };
    dot.addEventListener("click", navigate);
    dot.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") navigate(e);
    });
  });
}

/* ============================================================== */
/*                            SHUFFLE                              */
/* ============================================================== */

// Pointer-based shuffle of plant columns. Drives BOTH reorder (drop
// onto a new slot within the plants row) and move-to-garden (release
// over the garden tile, stage-5 only). Designed to feel like iOS
// home-screen icon rearrange: the picked-up plant lifts under the
// pointer and the other plants smoothly slide aside via CSS
// transitions to reveal the landing slot.
//
// Movement threshold (5px) distinguishes a drag from a click; below
// the threshold the existing click→listing handler fires normally.
// Above it, we capture the pointer, suppress the trailing `click`
// (otherwise the user would drop a plant and navigate to its listing),
// and run the layout-shift animation.
function wireShuffle(stage, visible, dragState, onReorder, onMoveToGarden) {
  const plantsRow = stage.querySelector(".cdash__journey-flowers-plants");
  const plants = Array.from(stage.querySelectorAll(".cdash__journey-flowers-plant"));
  const gardenTile = stage.querySelector(".cdash__journey-flowers-garden-tile");
  if (!plantsRow || plants.length === 0) return;

  // Sample slot geometry — every plant column is the same width, so
  // one bounding rect plus the row's column-gap is enough to compute
  // any plant's home X.
  const sample = plants[0].getBoundingClientRect();
  const plantW = sample.width;
  const rowStyle = getComputedStyle(plantsRow);
  const gap = parseFloat(rowStyle.columnGap || rowStyle.gap || "0") || 0;
  const slotW = plantW + gap;

  const DRAG_THRESHOLD = 5;
  const SNAP_MS = 220;
  const SNAP_EASE = "cubic-bezier(0.2, 0, 0, 1)";

  let active = null; // current drag session

  plants.forEach((plantEl, plantIndex) => {
    plantEl.addEventListener("pointerdown", (e) => onPointerDown(e, plantEl, plantIndex));
  });

  function onPointerDown(e, plantEl, plantIndex) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target.closest(".cdash__journey-flowers-plant-hide")) return;
    if (e.target.closest(".cdash__journey-flowers-action-dot")) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;

    const onMove = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!started) {
        if (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD) {
          started = true;
          beginDrag(plantEl, plantIndex, ev);
        }
      }
      if (started) updateDrag(ev, dx, dy);
    };
    const onUp = (ev) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (started) {
        // Suppress the synthetic click that follows pointerup so a
        // drag doesn't also navigate to the listing.
        const suppressClick = (clickEvt) => {
          clickEvt.stopPropagation();
          clickEvt.preventDefault();
        };
        plantEl.addEventListener("click", suppressClick, { capture: true, once: true });
        // Belt-and-suspenders: remove the listener if no click arrives.
        setTimeout(() => plantEl.removeEventListener("click", suppressClick, true), 300);
        endDrag(ev);
      }
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }

  function beginDrag(plantEl, plantIndex, e) {
    plantEl.classList.add("is-dragging");
    dragState.bidId = plantEl.dataset.bidId;
    dragState.stage = Number(plantEl.dataset.stage);
    active = {
      plantEl,
      plantIndex,
      insertIdx: plantIndex,
      overGarden: false,
    };
    // Flag the panel as "shuffling" so wireInteractions stops showing
    // hover cards mid-drag, and proactively clear any hover state that
    // was on screen when the drag started.
    const root = container();
    if (root) {
      root.classList.add("is-shuffling");
      root.querySelector(".cdash__journey-flowers-tooltip")?.classList.remove("is-visible", "has-action");
      root.querySelectorAll(".cdash__journey-flowers-plant.is-dimmed").forEach((p) => p.classList.remove("is-dimmed"));
      root.querySelectorAll(".cdash__journey-flowers-axis-row").forEach((r) => r.classList.remove("is-active", "is-dimmed"));
      root.querySelectorAll(".cdash__journey-flowers-gridline.is-active").forEach((g) => g.classList.remove("is-active"));
    }
    // Disable transition on the dragged plant — it should track the
    // pointer exactly without easing.
    plantEl.style.transition = "none";
    plantEl.style.zIndex = "20";
    // Enable transitions on the OTHER plants so they slide smoothly
    // as the insertion slot moves.
    plants.forEach((p, i) => {
      if (i !== plantIndex) p.style.transition = `transform ${SNAP_MS}ms ${SNAP_EASE}`;
    });
    try { plantEl.setPointerCapture(e.pointerId); } catch (_) {}
  }

  // Resolve the .cdash__journey-flowers root (where is-shuffling lives)
  // lazily so it works whether stage is the inner stage or anything else.
  function container() {
    return stage.closest(".cdash__journey-flowers");
  }

  function updateDrag(ev, dx, dy) {
    if (!active) return;
    const { plantEl, plantIndex } = active;
    plantEl.style.transform = `translate(${dx}px, ${dy}px) scale(1.04)`;

    // Garden tile detection (stage-5 only).
    let overGarden = false;
    if (gardenTile && dragState.stage === 5) {
      const r = gardenTile.getBoundingClientRect();
      overGarden =
        ev.clientX >= r.left && ev.clientX <= r.right &&
        ev.clientY >= r.top && ev.clientY <= r.bottom;
    }
    if (gardenTile) gardenTile.classList.toggle("is-drop-target", overGarden);
    active.overGarden = overGarden;
    if (overGarden) {
      // Park the other plants in their home slots while the pointer
      // hovers the garden tile — no reorder is in flight.
      plants.forEach((p, i) => { if (i !== plantIndex) p.style.transform = ""; });
      return;
    }

    // Compute the insertion index from the pointer's X relative to
    // the plants row, then shift the non-dragged plants into their
    // visual slots.
    const insertIdx = computeInsertionIndex(ev.clientX);
    active.insertIdx = insertIdx;
    plants.forEach((p, i) => {
      if (i === plantIndex) return;
      // Visual index after removing the dragged plant and re-inserting
      // it at insertIdx.
      let visualIdx = i > plantIndex ? i - 1 : i;
      if (visualIdx >= insertIdx) visualIdx += 1;
      const deltaX = (visualIdx - i) * slotW;
      p.style.transform = `translateX(${deltaX}px)`;
    });
  }

  function computeInsertionIndex(pointerX) {
    const rect = plantsRow.getBoundingClientRect();
    const rel = pointerX - rect.left;
    const idx = Math.round(rel / slotW);
    return Math.max(0, Math.min(plants.length - 1, idx));
  }

  function endDrag() {
    if (!active) return;
    const { plantEl, plantIndex, insertIdx, overGarden } = active;
    // Clear the shuffle lockout so hover cards work again as soon as
    // the pointer is released, regardless of which drop path we take.
    container()?.classList.remove("is-shuffling");

    if (overGarden) {
      // Snap the plant into the garden tile (translate toward its
      // centre, scale-down + fade), then commit. The re-render fires
      // after the animation so the user sees the morph land.
      if (gardenTile) {
        const gRect = gardenTile.getBoundingClientRect();
        const pRect = plantEl.getBoundingClientRect();
        const tdx = gRect.left + gRect.width / 2 - (pRect.left + pRect.width / 2);
        const tdy = gRect.top + gRect.height / 2 - (pRect.top + pRect.height / 2);
        plantEl.style.transition = `transform ${SNAP_MS}ms ${SNAP_EASE}, opacity ${SNAP_MS}ms ease`;
        plantEl.style.transform = `translate(${tdx}px, ${tdy}px) scale(0.35)`;
        plantEl.style.opacity = "0";
        gardenTile.classList.remove("is-drop-target");
      }
      const bidId = dragState.bidId;
      setTimeout(() => onMoveToGarden(bidId), SNAP_MS);
      active = null;
      dragState.bidId = null;
      dragState.stage = null;
      return;
    }

    // Snap into the destination slot — even when insertIdx === plantIndex
    // (no-op) we still need to animate back from (dx, dy) to (0, 0).
    const deltaX = (insertIdx - plantIndex) * slotW;
    plantEl.style.transition = `transform ${SNAP_MS}ms ${SNAP_EASE}`;
    plantEl.style.transform = `translateX(${deltaX}px)`;

    if (insertIdx === plantIndex) {
      // No order change — let the snap-back animation finish, then
      // clear inline styles so the plant returns to a clean state.
      const plantSnap = plantEl;
      const snapshot = plants.slice();
      const snapshotIdx = plantIndex;
      setTimeout(() => {
        plantSnap.classList.remove("is-dragging");
        plantSnap.style.transition = "";
        plantSnap.style.transform = "";
        plantSnap.style.zIndex = "";
        snapshot.forEach((p, i) => {
          if (i !== snapshotIdx) {
            p.style.transition = "";
            p.style.transform = "";
          }
        });
      }, SNAP_MS);
      dragState.bidId = null;
      dragState.stage = null;
      active = null;
      return;
    }

    // Commit the new order after the snap animation completes. The
    // subsequent re-render rebuilds the DOM with plants in their new
    // positions and resets all inline transforms. `insertIdx` already
    // refers to the dragged plant's slot in the visual layout AFTER
    // removal, so it maps directly to the new-array index — no offset.
    const draggedId = dragState.bidId;
    setTimeout(() => {
      const newOrder = visible.map((v) => v.id);
      const fromIdx = newOrder.indexOf(draggedId);
      if (fromIdx < 0) return;
      newOrder.splice(fromIdx, 1);
      newOrder.splice(insertIdx, 0, draggedId);
      onReorder(newOrder);
    }, SNAP_MS);
    dragState.bidId = null;
    dragState.stage = null;
    active = null;
  }
}

/* ============================================================== */
/*                              UTIL                               */
/* ============================================================== */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtUSD(cents) {
  if (!Number.isFinite(Number(cents))) return "";
  const dollars = Number(cents) / 100;
  return `$${dollars.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}
