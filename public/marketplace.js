import { getSupabaseClient } from "/supabase-loader.js";
import { initNotifBell } from "/nav-notify.js";
import { initControlPanel } from "/control-panel.js";
import { formatBudgetRange, getSimulatedBudgetRange } from "/sim-budget.js";

const sessionSlot = document.getElementById("session-slot");
const listingGrid = document.getElementById("listing-grid");
const listingsStatus = document.getElementById("listings-status");

const LISTING_SELECT =
  "id, owner_id, title, category, problem_summary, details, budget_cents, created_at, profiles!listings_owner_id_fkey ( full_name, role, avatar_path )";

let allRows = [];
let bizMap = {};
let _client = null;

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
  const budgetRange = getSimulatedBudgetRange(detailsStr);
  return { budgetRange };
}

function renderSession(client, session) {
  if (!session?.user) {
    sessionSlot.innerHTML =
      'browsing as guest · <a href="/signin.html">sign in</a> · <a href="/register.html">register</a>';
    return;
  }

  const label =
    session.user.user_metadata?.full_name || session.user.email || "Signed in";

  sessionSlot.innerHTML = `
    <span>signed in as ${escapeHtml(label)}</span>
  `;

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

async function fetchOpenListings(client) {
  const { data, error } = await client
    .from("listings")
    .select(LISTING_SELECT)
    .eq("status", "open")
    .order("created_at", { ascending: false });

  return { data, error };
}

function renderCounterStrip(rows) {
  const host = document.getElementById("marketplace-counter");
  if (!host) return;
  if (!rows.length) {
    host.innerHTML = "";
    return;
  }
  const totalBudget = rows.reduce((acc, r) => {
    const { budgetRange } = parseDetails(r);
    if (!budgetRange) return acc;
    const mid = ((budgetRange.min || 0) + (budgetRange.max || 0)) / 2;
    return acc + mid;
  }, 0);
  const cats = new Set();
  for (const r of rows) {
    if (r.category) {
      r.category.split(",").map((c) => c.trim()).filter(Boolean).forEach((c) => cats.add(c));
    }
  }
  host.innerHTML = `
    <span class="fo-counter__item"><strong>${rows.length}</strong>open</span>
    <span class="fo-counter__item"><strong>${cats.size}</strong>categories</span>
    <span class="fo-counter__item"><strong>$${Math.round(totalBudget).toLocaleString()}</strong>combined budget</span>
  `;
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

function renderCard(row, client) {
  const profile = row.profiles;
  const poster = profile?.full_name || "Business";
  const biz = bizMap[row.owner_id];
  const businessName = biz?.business_name || poster;
  const avatarUrl = publicAvatarUrl(client, profile?.avatar_path);
  const { budgetRange } = parseDetails(row);
  const initial = escapeHtml((businessName || poster).charAt(0).toUpperCase());

  const categories = row.category
    ? row.category.split(",").map((c) => c.trim()).filter(Boolean)
    : [];

  const avatarHtml = avatarUrl
    ? `<img class="gr-listing-logo" src="${escapeHtml(avatarUrl)}" alt="" />`
    : `<div class="gr-listing-logo-placeholder">${initial}</div>`;

  const budgetHtml = budgetRange
    ? `<p class="gr-listing-budget">${escapeHtml(formatBudgetRange(budgetRange))}</p>`
    : "";

  const tagsHtml = categories.length
    ? `<div class="gr-listing-tags">${categories.slice(0, 2).map((c) => `<span class="gr-listing-tag">${escapeHtml(c)}</span>`).join("")}</div>`
    : "";

  const summary = row.problem_summary
    ? `<p class="gr-listing-summary">${escapeHtml(condenseSummary(row.problem_summary))}</p>`
    : "";

  const card = document.createElement("a");
  card.className = "gr-listing-card";
  card.href = `/listing.html?id=${row.id}`;
  card.innerHTML = `
    <div class="gr-listing-card-head">
      <div class="gr-listing-logo-wrap">${avatarHtml}</div>
      <div class="gr-listing-card-biz">
        <span class="gr-listing-biz-label">posted by</span>
        <p class="gr-listing-biz-name">${escapeHtml(businessName)}</p>
      </div>
    </div>
    <div class="gr-listing-card-body">
      <h2 class="gr-listing-title">${escapeHtml(row.title)}</h2>
      ${summary}
    </div>
    <div class="gr-listing-foot">
      ${tagsHtml || '<span></span>'}
      <div class="gr-listing-foot-end">
        ${budgetHtml}
        <span class="gr-listing-cta-link">view →</span>
      </div>
    </div>
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

function renderListings(rows, client) {
  listingGrid.innerHTML = "";

  if (!rows.length) {
    listingGrid.innerHTML =
      '<p class="gr-empty-state">no open opportunities yet. once business owners post needs, they\'ll show up here.</p>';
    return;
  }

  // Section 1: Recommended (algorithm placeholder)
  listingGrid.appendChild(
    renderSection({
      title: "recommended for you",
      subtitle: "tuned to your skills and history",
      rows: [],
      emptyText: "personalized picks coming soon — we're learning what you like.",
      client,
    })
  );

  // Section 2: Near you (location placeholder)
  listingGrid.appendChild(
    renderSection({
      title: "near you",
      subtitle: "small businesses in your area",
      rows: [],
      emptyText: "set your location in profile settings to see local opportunities.",
      client,
    })
  );

  // Section 3+: By tag — bucket every row by each of its categories. A row can
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

  renderCounterStrip(filtered);
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
  listingsStatus.textContent = "Loading…";
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
  renderCounterStrip(allRows);
  renderListings(allRows, client);
  setupFilterListeners();
}

async function init() {
  listingsStatus.textContent = "Loading…";

  try {
    const client = await getSupabaseClient();
    _client = client;
    const {
      data: { session },
    } = await client.auth.getSession();

    renderSession(client, session);
    initNotifBell(client);
    // initControlPanel(client); — replaced by /side-nav.js

    client.auth.onAuthStateChange(async (_event, nextSession) => {
      renderSession(client, nextSession);
    });

    await refreshListings(client);
  } catch (error) {
    listingsStatus.textContent = error.message || "Could not initialize marketplace.";
    listingsStatus.className = "gr-status error";
  }
}

init();
