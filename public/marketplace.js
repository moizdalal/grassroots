import { getSupabaseClient } from "/supabase-loader.js";
import { initNotifBell } from "/nav-notify.js";
import { formatBudgetRange, parseBudgetRange } from "/sim-budget.js";
import { getInitials } from "/initials.js";
import {
  isGuest,
  setGuestMode,
  clearGuestModeIfSignedIn,
  withGuestParam,
} from "/guest-mode.js";

const sessionSlot = document.getElementById("session-slot");
const listingGrid = document.getElementById("listing-grid");
const listingsStatus = document.getElementById("listings-status");

const LISTING_SELECT =
  "id, owner_id, title, category, problem_summary, details, budget_cents, contract_type, turnaround_days, status, lat, lng, created_at, profiles!listings_owner_id_fkey ( full_name, role, avatar_path )";

const SORT_KEY = "grassroots_marketplace_sort";

// Distance threshold for the "local" marketplace bucket. 50 miles is
// the brief — far enough that a metro counts, tight enough that "local"
// means "could plausibly meet in person." Adjust by changing this one
// constant; everything downstream reads it.
const LOCAL_RADIUS_MILES = 50;

let allRows = [];
let bizMap = {};
let consultantCity = null; // { lat, lng } once the session is resolved.
let _client = null;

/* Great-circle distance between two lat/lng pairs, in miles. Standard
   Haversine — accurate to <0.5% for the radii we care about. */
function haversineMiles(aLat, aLng, bLat, bLng) {
  const R = 3958.7613; // earth radius in miles
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function publicAvatarUrl(client, path) {
  if (!path) return null;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function parseDetails(row) {
  const detailsStr = row.details || "";
  const budgetRange = parseBudgetRange(detailsStr);
  return { budgetRange };
}

/* Render the guest conversion banner above the search bar. Two
   paths: the primary "post a project" CTA (most guests are assumed
   to be small-business owners — that's the side we're actively
   trying to grow) and a quieter consultant-application link for the
   minority of visitors who would join the supply side. Reading the
   user's intent is impossible client-side, so we surface both. */
function renderGuestBanner() {
  const host = document.getElementById("guest-banner-slot");
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `
    <div class="gr-guest-banner" role="region" aria-label="Guest welcome">
      <div class="gr-guest-banner__copy">
        <p class="gr-guest-banner__title">Browsing as a guest</p>
        <p class="gr-guest-banner__sub">
          This is real, live work small businesses are paying students to do. Start by
          <a href="/register.html?role=owner">posting your own project</a>, or
          <a href="/home/for-students.html">apply to join as a student consultant</a>.
        </p>
      </div>
      <div class="gr-guest-banner__actions">
        <a class="gr-btn gr-btn--ghost gr-btn--sm" href="/signin.html">Sign in</a>
        <a class="gr-btn gr-btn--primary gr-btn--sm" href="/register.html?role=owner">Post a project</a>
      </div>
    </div>
  `;
}

function renderSession(client, session) {
  // Marketplace is now open to guests. When no session, render the
  // sign-in nudge instead of redirecting. When a business owner lands
  // here we still send them to their dashboard since they don't
  // submit offers (avoids the marketplace + dashboard loop).
  if (!session?.user) {
    renderGuestBanner();
    return;
  }

  sessionSlot.innerHTML = "";

  // Business owners get routed to their dashboard — they don't browse the marketplace.
  // Only redirect on a confirmed business_owner role; a fetch error or null role
  // leaves them here (avoids a redirect loop with /dashboard.html).
  client.from("profiles").select("role").eq("id", session.user.id).single().then(({ data, error }) => {
    if (!error && data?.role === "business_owner") {
      window.location.replace("/dashboard.html");
      return;
    }
    const slot = document.getElementById("page-cta-slot");
    if (slot) slot.innerHTML = "";
  });
}

/* Load the signed-in consultant's home-city coords. Stored on
   consultant_profiles by the city autocomplete (Settings → Personal).
   When null, the "local" bucket renders nothing — no harm, no error. */
async function loadConsultantCity(client, session) {
  if (!session?.user?.id) return null;
  try {
    const { data, error } = await client
      .from("consultant_profiles")
      .select("city_lat, city_lng")
      .eq("user_id", session.user.id)
      .maybeSingle();
    if (error || !data) return null;
    const lat = Number(data.city_lat);
    const lng = Number(data.city_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  } catch (_) {
    return null;
  }
}

// Open listings plus locked ones (public, no new offers). Locked rows
// sort after open rows so they never crowd out live opportunities.
// Completed listings stay off the feed until a past-projects view exists.
async function fetchOpenListings(client) {
  const { data, error } = await client
    .from("listings")
    .select(LISTING_SELECT)
    .in("status", ["open", "locked"])
    .order("created_at", { ascending: false });

  if (data) data.sort((a, b) => (a.status === "locked") - (b.status === "locked"));
  return { data, error };
}

function renderResultCount(filteredCount, totalCount) {
  const host = document.getElementById("result-count");
  if (!host) return;
  if (!totalCount) {
    host.textContent = "";
    return;
  }
  if (filteredCount === totalCount) {
    host.textContent = `${totalCount} ${totalCount === 1 ? "opportunity" : "opportunities"}`;
  } else {
    host.textContent = `Showing ${filteredCount} of ${totalCount}`;
  }
}

function condenseSummary(text, max = 90) {
  const t = String(text || "").trim();
  if (!t) return "";
  if (t.length <= max) return t;
  // cut on a word boundary, then ellipsize
  const cut = t.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return (space > 40 ? cut.slice(0, space) : cut).trim() + "…";
}

/* Returns a relative-time descriptor for the card eyebrow, or null
   when the listing is older than ~3 months (at that age the badge
   reads anti-marketing and we drop it). `stale: true` flips the
   dot prefix to neutral on the card — anything older than a week is
   stale enough to lose the "fresh" green dot. */
function formatRecency(createdAt) {
  if (!createdAt) return null;
  const then = new Date(createdAt).getTime();
  if (Number.isNaN(then)) return null;
  const diffMs = Date.now() - then;
  if (diffMs < 0) return { label: "Today", stale: false };
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) return { label: "Today", stale: false };
  if (days < 7) return { label: `${days}d ago`, stale: false };
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return { label: `${weeks}w ago`, stale: true };
  const months = Math.floor(days / 30);
  if (months < 3) return { label: `${months}mo ago`, stale: true };
  return null;
}

/* Normalize the DB enum ('standard' | 'phased' | 'retainer') to a
   reader-friendly label on the card. 'standard' is the lump-sum case
   so we surface it as 'one-time' to disambiguate from 'phased' and
   'retainer'. Anything unknown collapses to null so the card omits
   the line. */
function formatContractType(t) {
  const v = String(t || "").toLowerCase();
  if (v === "standard") return "one-time";
  if (v === "phased" || v === "retainer") return v;
  return null;
}

function renderCard(row, client) {
  const profile = row.profiles;
  const poster = profile?.full_name || "Business";
  const biz = bizMap[row.owner_id];
  const businessName = biz?.business_name || poster;
  const avatarUrl = publicAvatarUrl(client, profile?.avatar_path);
  const { budgetRange } = parseDetails(row);
  const initial = escapeHtml(getInitials(businessName || poster));

  const categories = row.category
    ? row.category.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  const avatarHtml = avatarUrl
    ? `<img class="gr-listing-logo" src="${escapeHtml(avatarUrl)}" alt="" />`
    : `<div class="gr-listing-logo-placeholder">${initial}</div>`;

  // Tags: show first 2 inline; collapse anything past 2 into a "+N" chip
  // so a 5-category listing doesn't blow out the head row.
  const visibleTags = categories.slice(0, 2);
  const overflow = categories.length - visibleTags.length;
  const tagsHtml = categories.length
    ? `<div class="gr-listing-tags">${
        visibleTags
          .map((c) => `<span class="gr-listing-tag">${escapeHtml(capFirst(c))}</span>`)
          .join("")
      }${
        overflow > 0
          ? `<span class="gr-listing-tag gr-listing-tag--more">+${overflow}</span>`
          : ""
      }</div>`
    : "";

  const budgetHtml = budgetRange
    ? `<p class="gr-listing-budget">${escapeHtml(formatBudgetRange(budgetRange))}</p>`
    : "";

  const contractType = formatContractType(row.contract_type);
  const contractHtml = contractType
    ? `<p class="gr-listing-contract">${escapeHtml(capFirst(contractType))}</p>`
    : "";

  const recency = formatRecency(row.created_at);
  const recencyHtml = row.status === "locked"
    ? `<span class="gr-listing-recency gr-listing-recency--locked">Locked · not taking offers</span>`
    : recency
    ? `<span class="gr-listing-recency${recency.stale ? " gr-listing-recency--stale" : ""}">${escapeHtml(recency.label)}</span>`
    : "";

  // Summary lives inside the card but renders as a position:fixed
  // popover on hover (desktop only). Wider preview window (180 chars)
  // than the deprecated inline summary (90 chars).
  const summaryText = row.problem_summary
    ? condenseSummary(row.problem_summary, 180)
    : "";
  const summaryHtml = summaryText
    ? `<p class="gr-listing-summary-pop" data-summary>${escapeHtml(summaryText)}</p>`
    : "";

  // v2.1 layout — title hero on top, identity row pairs the avatar
  // tile with a meta stack (biz / budget / contract) on its right,
  // foot carries tags on the left and the view CTA on the right.
  const card = document.createElement("a");
  card.className = "gr-listing-card";
  // withGuestParam appends ?guest=1 when the viewer is in guest mode
  // so the listing detail recognises them even if the link is opened
  // in a new tab (which would otherwise lose the sessionStorage flag).
  // Signed-in members get a clean URL.
  card.href = withGuestParam(`/listing.html?id=${row.id}`);
  card.innerHTML = `
    <div class="gr-listing-card-eyebrow">${recencyHtml}</div>
    <h2 class="gr-listing-title">${escapeHtml(row.title)}</h2>
    <div class="gr-listing-card-head">
      <div class="gr-listing-logo-wrap">${avatarHtml}</div>
      <div class="gr-listing-card-meta">
        <p class="gr-listing-biz-name">${escapeHtml(businessName)}</p>
        ${budgetHtml}
        ${contractHtml}
      </div>
    </div>
    <div class="gr-listing-foot">
      ${tagsHtml || '<div></div>'}
      <span class="gr-listing-cta-link">View →</span>
    </div>
    ${summaryHtml}
  `;
  return card;
}

function renderSection({ title, subtitle, rows, emptyText, client }) {
  const section = document.createElement("section");
  section.className = "gr-marketplace-section";
  const head = document.createElement("div");
  head.className = "gr-marketplace-section__head";
  head.innerHTML = `
    <div>
      <h2 class="gr-marketplace-section__title">${escapeHtml(capFirst(title))}</h2>
      ${subtitle ? `<p class="gr-marketplace-section__sub">${escapeHtml(subtitle)}</p>` : ""}
    </div>
    <span class="gr-marketplace-section__count">${rows.length}</span>
  `;
  section.appendChild(head);

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "gr-marketplace-section__empty";
    empty.textContent = emptyText || "Nothing here yet.";
    section.appendChild(empty);
    return section;
  }

  const track = document.createElement("div");
  track.className = "gr-marketplace-section__track";
  for (const row of rows) {
    track.appendChild(renderCard(row, client));
  }
  section.appendChild(track);
  return section;
}

/* Hover-summary popover ─ one shared element positioned `fixed` so the
   horizontal-scroll track's `overflow-x: auto` (which silently
   upgrades overflow-y to auto) doesn't clip it. Skipped on touch and
   reduced-motion environments. */
const HAS_HOVER = typeof window.matchMedia === "function"
  ? window.matchMedia("(hover: hover)").matches
  : false;

let hoverPop = null;
let hoverTimer = null;

function ensureHoverPop() {
  if (hoverPop) return hoverPop;
  hoverPop = document.createElement("div");
  hoverPop.className = "gr-listing-pop";
  hoverPop.setAttribute("role", "tooltip");
  document.body.appendChild(hoverPop);
  return hoverPop;
}

function showHoverPop(card) {
  const summary = card.querySelector("[data-summary]")?.textContent;
  if (!summary) return;
  const pop = ensureHoverPop();
  pop.textContent = summary;
  // Position once content is set so the popover knows its own width.
  pop.classList.add("is-visible");
  const rect = card.getBoundingClientRect();
  pop.style.left = `${rect.left}px`;
  pop.style.top = `${rect.bottom + 8}px`;
  pop.style.width = `${rect.width}px`;
}

function hideHoverPop() {
  if (!hoverPop) return;
  hoverPop.classList.remove("is-visible");
}

function wireHoverPopover(scope) {
  if (!HAS_HOVER) return;
  scope.querySelectorAll(".gr-listing-card").forEach((card) => {
    card.addEventListener("mouseenter", () => {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => showHoverPop(card), 200);
    });
    card.addEventListener("mouseleave", () => {
      clearTimeout(hoverTimer);
      hideHoverPop();
    });
  });
}

function renderListings(rows, client) {
  listingGrid.innerHTML = "";
  hideHoverPop();

  if (!rows.length) {
    listingGrid.innerHTML =
      '<p class="gr-empty-state">No open opportunities yet. Once business owners post needs, they\'ll show up here.</p>';
    return;
  }

  // "Local" bucket — listings within LOCAL_RADIUS_MILES of the
  // consultant's home city. Only renders when (a) we know the
  // consultant's coords and (b) at least one listing is in range.
  // Listings without their own coords (lat/lng nullable; backfill
  // pending for old listings) are silently skipped.
  if (consultantCity) {
    const localRows = rows.filter((row) => {
      const lat = Number(row.lat);
      const lng = Number(row.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      return haversineMiles(consultantCity.lat, consultantCity.lng, lat, lng)
        <= LOCAL_RADIUS_MILES;
    });
    if (localRows.length) {
      listingGrid.appendChild(
        renderSection({
          title: "Local",
          subtitle: `Within ${LOCAL_RADIUS_MILES} miles of where you're based`,
          rows: localRows,
          client,
        })
      );
    }
  }

  // By tag — bucket every row by each of its categories. A row can
  // appear in multiple tag rows (one per category). Order by bucket size desc.
  const byTag = new Map();
  const untagged = [];
  for (const row of rows) {
    const cats = row.category
      ? row.category.split(",").map((c) => c.trim()).filter(Boolean)
      : [];
    if (!cats.length) {
      untagged.push(row);
      continue;
    }
    for (const c of cats) {
      if (!byTag.has(c)) byTag.set(c, []);
      byTag.get(c).push(row);
    }
  }
  const sorted = [...byTag.entries()].sort((a, b) => b[1].length - a[1].length);
  for (const [tag, list] of sorted) {
    listingGrid.appendChild(
      renderSection({
        title: tag,
        rows: list,
        emptyText: `No open ${tag} listings right now.`,
        client,
      })
    );
  }
  if (untagged.length) {
    listingGrid.appendChild(
      renderSection({
        title: "Other",
        rows: untagged,
        client,
      })
    );
  }

  wireHoverPopover(listingGrid);
}

function populateCategoryDropdown() {
  const dropdown = document.getElementById("filter-category");
  if (!dropdown) return;
  const cats = new Set();
  for (const row of allRows) {
    if (row.category) {
      row.category.split(",").map(c => c.trim()).filter(Boolean).forEach(c => cats.add(c));
    }
  }
  const sorted = [...cats].sort();
  dropdown.innerHTML = '<option value="">All categories</option>';
  for (const c of sorted) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = capFirst(c);
    dropdown.appendChild(opt);
  }
}

function applyFilters() {
  const searchEl = document.getElementById("filter-search");
  const catEl = document.getElementById("filter-category");
  const budgetMinEl = document.getElementById("filter-budget-min");
  const budgetMaxEl = document.getElementById("filter-budget-max");

  const searchTerm = (searchEl?.value || "").toLowerCase();
  const catFilter = (catEl?.value || "");
  const filterBudgetMin = budgetMinEl?.value ? parseInt(budgetMinEl.value, 10) : null;
  const filterBudgetMax = budgetMaxEl?.value ? parseInt(budgetMaxEl.value, 10) : null;

  const filtered = allRows.filter(row => {
    const profile = row.profiles;
    const poster = profile?.full_name || "";
    const biz = bizMap[row.owner_id];
    const businessName = biz?.business_name || poster;
    const { budgetRange } = parseDetails(row);

    // Text search
    if (searchTerm) {
      const haystack = [row.title, row.problem_summary, businessName]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(searchTerm)) return false;
    }

    // Category filter
    if (catFilter) {
      const cats = row.category
        ? row.category.split(",").map(c => c.trim())
        : [];
      if (!cats.includes(catFilter)) return false;
    }

    // Budget range filter
    if (filterBudgetMin !== null || filterBudgetMax !== null) {
      const min = budgetRange?.min ?? null;
      const max = budgetRange?.max ?? null;
      if (min === null && max === null) return false;
      if (filterBudgetMin !== null && max !== null && max < filterBudgetMin) return false;
      if (filterBudgetMax !== null && min !== null && min > filterBudgetMax) return false;
    }

    return true;
  });

  // Sort the filtered set before render. New listings default to "newest";
  // selection is persisted in localStorage so the user's preferred sort
  // sticks across reloads.
  const sortEl = document.getElementById("filter-sort");
  const sortKey = sortEl?.value || "newest";
  const sorted = filtered.slice().sort((a, b) => {
    if (sortKey === "newest") {
      return Date.parse(b.created_at || 0) - Date.parse(a.created_at || 0);
    }
    if (sortKey === "budget-desc" || sortKey === "budget-asc") {
      const budgetTop = (row) => {
        const rangeMax = parseDetails(row).budgetRange?.max;
        if (rangeMax != null) return rangeMax;
        if (row.budget_cents != null) return Math.round(row.budget_cents / 100);
        return 0;
      };
      const aMax = budgetTop(a);
      const bMax = budgetTop(b);
      return sortKey === "budget-desc" ? bMax - aMax : aMax - bMax;
    }
    if (sortKey === "turnaround") {
      // Listings without a turnaround sort last via Infinity.
      const aDays = Number.isFinite(a.turnaround_days) ? a.turnaround_days : Infinity;
      const bDays = Number.isFinite(b.turnaround_days) ? b.turnaround_days : Infinity;
      return aDays - bDays;
    }
    return 0;
  });

  renderResultCount(sorted.length, allRows.length);
  renderListings(sorted, _client);
}

function setupFilterListeners() {
  const ids = ["filter-search", "filter-type", "filter-category", "filter-budget-min", "filter-budget-max", "filter-sort"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const event = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(event, applyFilters);
  }

  // Restore the persisted sort selection on first paint + remember new
  // choices for next visit.
  const sortEl = document.getElementById("filter-sort");
  if (sortEl) {
    try {
      const saved = localStorage.getItem(SORT_KEY);
      if (saved && [...sortEl.options].some((o) => o.value === saved)) {
        sortEl.value = saved;
      }
    } catch (_) {}
    sortEl.addEventListener("change", () => {
      try { localStorage.setItem(SORT_KEY, sortEl.value); } catch (_) {}
    });
  }
}

function renderListingsSkeleton(count = 6) {
  if (!listingGrid) return;
  listingGrid.innerHTML = Array.from({ length: count }, () => `<div class="gr-skeleton gr-skeleton--card"></div>`).join("");
}

async function refreshListings(client) {
  listingsStatus.textContent = "";
  listingsStatus.className = "gr-status";
  renderListingsSkeleton(6);

  const { data: rows, error } = await fetchOpenListings(client);

  if (error) {
    listingGrid.innerHTML = "";
    listingsStatus.textContent = error.message;
    listingsStatus.className = "gr-status error";
    return;
  }

  allRows = rows || [];

  // Fetch business profiles
  const ownerIds = [...new Set(allRows.map(r => r.owner_id))];
  if (ownerIds.length) {
    const { data: bizProfiles } = await client.from("business_profiles").select("user_id, business_name").in("user_id", ownerIds);
    bizMap = {};
    (bizProfiles || []).forEach(b => { bizMap[b.user_id] = b; });
  }

  listingsStatus.textContent = "";
  populateCategoryDropdown();
  renderResultCount(allRows.length, allRows.length);
  renderListings(allRows, client);
  setupFilterListeners();
}

async function init() {
  listingsStatus.textContent = "Loading…";

  // Lock in guest mode (persists across in-tab navigation) so the
  // listing detail page doesn't need ?guest=1 re-passed on every link.
  // We still keep withGuestParam on card hrefs as a belt-and-braces
  // measure for new-tab opens.
  const guest = isGuest();
  if (guest) setGuestMode();

  try {
    const client = await getSupabaseClient();
    _client = client;
    const {
      data: { session },
    } = await client.auth.getSession();

    // A real session always wins. If a signed-in member happens to
    // hit ?guest=1, clear the flag and give them the normal layout.
    clearGuestModeIfSignedIn(session);

    if (!session?.user) {
      // No session, but guest mode is active → render the marketplace
      // in browse-only mode. The guest top bar (guest-nav.js) and
      // banner replace the signed-in chrome; the listing grid itself
      // is unchanged since RLS already allows anonymous reads of
      // open listings (see supabase/migrations/restrict_inactive_listing_visibility.sql).
      if (guest) {
        renderGuestBanner();
        // Hide the "post a project" CTA slot that owners would see —
        // the guest banner above carries that conversion already and
        // we don't want to double up.
        const slot = document.getElementById("page-cta-slot");
        if (slot) slot.innerHTML = "";
        await refreshListings(client);
        // Watch for the guest signing in mid-session (auth state
        // change to a real user); the simplest correct behavior is
        // to reload so they get the proper member layout.
        client.auth.onAuthStateChange((_event, nextSession) => {
          if (nextSession?.user) {
            clearGuestModeIfSignedIn(nextSession);
            window.location.reload();
          }
        });
        return;
      }
      // Authoritative member gate (the inline pre-check in
      // marketplace.html catches definite guests pre-paint; this
      // catches expired-token cases where getSession() couldn't refresh).
      redirectGuestsToSignin();
      return;
    }


    renderSession(client, session);
    if (session?.user) initNotifBell(client);

    // Load the consultant's home-city coords once. Powers the "local"
    // bucket in renderListings. Null for guests + non-consultants.
    consultantCity = await loadConsultantCity(client, session);

    client.auth.onAuthStateChange(async (_event, nextSession) => {
      renderSession(client, nextSession);
      consultantCity = await loadConsultantCity(client, nextSession);
    });

    await refreshListings(client);
  } catch (error) {
    listingsStatus.textContent = error.message || "Could not initialize marketplace.";
    listingsStatus.className = "gr-status error";
  }
}

init();

// Categories and statuses are stored lowercase; show them in sentence case.
function capFirst(value) {
  const s = String(value || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
