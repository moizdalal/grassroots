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

  client.from("profiles").select("role").eq("id", session.user.id).single().then(({ data }) => {
    const slot = document.getElementById("page-cta-slot");
    if (slot) slot.innerHTML = "";
    if (data?.role === "business_owner" && slot) {
      const link = document.createElement("a");
      link.href = "/create-listing.html";
      link.className = "gr-page-cta";
      link.textContent = "create opportunity";
      slot.appendChild(link);
    }
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

function renderListings(rows, client) {
  listingGrid.innerHTML = "";

  if (!rows.length) {
    listingGrid.innerHTML =
      '<p class="gr-empty-state">no open opportunities yet. once business owners post needs, they\'ll show up here.</p>';
    return;
  }

  for (const row of rows) {
    const profile = row.profiles;
    const poster = profile?.full_name || "Business";
    const biz = bizMap[row.owner_id];
    const businessName = biz?.business_name || poster;
    const avatarPath = profile?.avatar_path || null;
    const avatarUrl = publicAvatarUrl(client, avatarPath);
    const { budgetRange } = parseDetails(row);
    const initial = escapeHtml((businessName || poster).charAt(0).toUpperCase());

    const categories = row.category
      ? row.category.split(",").map(c => c.trim()).filter(Boolean)
      : [];

    const avatarHtml = avatarUrl
      ? `<img class="gr-listing-logo" src="${escapeHtml(avatarUrl)}" alt="" />`
      : `<div class="gr-listing-logo-placeholder">${initial}</div>`;

    const budgetHtml = budgetRange
      ? `<p class="gr-listing-budget">${escapeHtml(formatBudgetRange(budgetRange))}</p>`
      : "";

    const tagsHtml = categories.length
      ? `<div class="gr-listing-tags">${categories.map(c => `<span class="gr-listing-tag">${escapeHtml(c)}</span>`).join("")}</div>`
      : "";

    const card = document.createElement("a");
    card.className = "gr-listing-card";
    card.href = `/listing.html?id=${row.id}`;
    card.innerHTML = `
      <div class="gr-listing-logo-wrap">
        ${avatarHtml}
      </div>
      <div class="gr-listing-card-body">
        <div class="gr-listing-title-row">
          <h2 class="gr-listing-title">${escapeHtml(row.title)}</h2>
        </div>
        <div class="gr-listing-subs">
          <p class="gr-listing-biz-name">${escapeHtml(businessName)}</p>
          ${budgetHtml}
        </div>
        ${tagsHtml}
        <span class="gr-listing-cta">view details &rarr;</span>
      </div>
    `;
    listingGrid.appendChild(card);
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
    initControlPanel(client);

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
