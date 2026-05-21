import { getSupabaseClient } from "/supabase-loader.js";
import { initNotifBell } from "/nav-notify.js";
import { formatBudgetRange, parseBudgetRange } from "/sim-budget.js";
import { getInitials } from "/initials.js";

const sessionSlot = document.getElementById("session-slot");
const listingGrid = document.getElementById("listing-grid");
const listingsStatus = document.getElementById("listings-status");

const LISTING_SELECT =
  "id, owner_id, title, category, problem_summary, details, budget_cents, contract_type, lat, lng, created_at, profiles!listings_owner_id_fkey ( full_name, role, avatar_path )";

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

function redirectGuestsToSignin() {
  window.location.replace(
    "/signin.html?next=" + encodeURIComponent("/marketplace.html"),
  );
}

function renderSession(client, session) {
  // Marketplace is signed-in only. init() guards against guests on
  // first load; this branch catches the user signing out mid-session
  // via the auth-state-change listener.
  if (!session?.user) {
    redirectGuestsToSignin();
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

async function fetchOpenListings(client) {
  const { data, error } = await client
    .from("listings")
    .select(LISTING_SELECT)
    .eq("status", "open")
    .order("created_at", { ascending: false });

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
    host.textContent = `showing ${filteredCount} of ${totalCount}`;
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
  if (diffMs < 0) return { label: "today", stale: false };
  const days = Math.floor(diffMs / (24 * 60 * 60 * 1000));
  if (days === 0) return { label: "today", stale: false };
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
          .map((c) => `<span class="gr-listing-tag">${escapeHtml(c)}</span>`)
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
    ? `<p class="gr-listing-contract">${escapeHtml(contractType)}</p>`
    : "";

  const recency = formatRecency(row.created_at);
  const recencyHtml = recency
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
  card.href = `/listing.html?id=${row.id}`;
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
      <span class="gr-listing-cta-link">view →</span>
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
      <h2 class="gr-marketplace-section__title">${escapeHtml(title)}</h2>
      ${subtitle ? `<p class="gr-marketplace-section__sub">${escapeHtml(subtitle)}</p>` : ""}
    </div>
    <span class="gr-marketplace-section__count">${rows.length}</span>
  `;
  section.appendChild(head);

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "gr-marketplace-section__empty";
    empty.textContent = emptyText || "nothing here yet.";
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
      '<p class="gr-empty-state">no open opportunities yet. once business owners post needs, they\'ll show up here.</p>';
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
          title: "local",
          subtitle: `within ${LOCAL_RADIUS_MILES} miles of where you're based`,
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
        emptyText: `no open ${tag} listings right now.`,
        client,
      })
    );
  }
  if (untagged.length) {
    listingGrid.appendChild(
      renderSection({
        title: "other",
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
  dropdown.innerHTML = '<option value="">all categories</option>';
  for (const c of sorted) {
    const opt = document.createElement("option");
    opt.value = c;
    opt.textContent = c;
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

  renderResultCount(filtered.length, allRows.length);
  renderListings(filtered, _client);
}

function setupFilterListeners() {
  const ids = ["filter-search", "filter-type", "filter-category", "filter-budget-min", "filter-budget-max"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    const event = el.tagName === "SELECT" ? "change" : "input";
    el.addEventListener(event, applyFilters);
  }
}

async function refreshListings(client) {
  listingsStatus.textContent = "loading…";
  listingsStatus.className = "gr-status";

  const { data: rows, error } = await fetchOpenListings(client);

  if (error) {
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
  listingsStatus.textContent = "loading…";

  try {
    const client = await getSupabaseClient();
    _client = client;
    const {
      data: { session },
    } = await client.auth.getSession();

    // Authoritative guest gate (the inline pre-check in marketplace.html
    // catches definite guests pre-paint; this catches expired-token
    // cases where getSession() couldn't refresh).
    if (!session?.user) {
      redirectGuestsToSignin();
      return;
    }

    renderSession(client, session);
    initNotifBell(client);

    // Load the consultant's home-city coords once. Powers the "local"
    // bucket in renderListings. Null → bucket simply doesn't render.
    consultantCity = await loadConsultantCity(client, session);

    client.auth.onAuthStateChange(async (_event, nextSession) => {
      if (!nextSession?.user) {
        redirectGuestsToSignin();
        return;
      }
      renderSession(client, nextSession);
      consultantCity = await loadConsultantCity(client, nextSession);
    });

    await refreshListings(client);
  } catch (error) {
    listingsStatus.textContent = error.message || "could not initialize marketplace.";
    listingsStatus.className = "gr-status error";
  }
}

init();
