// dashboard.js — business owner dashboard. Aggregates the user's listings,
// offers received, message threads, and profile completeness. Owner-side
// listing detail (offer review + accept/counter/reject) lives on
// /listing.html?id=X and is reached by clicking any listing row.

import { getSupabaseClient } from "/supabase-loader.js";

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const STATE_LABELS = {
  open: "live",
  hired: "in progress",
  paused: "paused",
  closed: "closed",
  draft: "draft",
};

const isMissing = (err) =>
  !!err && /(does not exist|not found|relation .* does not exist|column .* does not exist)/i.test(err.message || "");

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtBudget(min, max) {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `$${min}–$${max}`;
  return `$${min ?? max}`;
}

function parseBudgetRangeFromDetails(details) {
  if (!details) return null;
  const m = /budget range:\s*\$?(\d[\d,]*)\s*to\s*\$?(\d[\d,]*)/i.exec(details);
  if (!m) return null;
  return {
    min: parseInt(m[1].replace(/,/g, ""), 10),
    max: parseInt(m[2].replace(/,/g, ""), 10),
  };
}

function listingState(row) {
  // Map listing.status to a display state. Open = live; if any bid is accepted, that's "hired".
  if (row.__hired) return "hired";
  const s = (row.status || "").toLowerCase();
  if (s === "open") return "open";
  if (s === "paused") return "paused";
  if (s === "closed") return "closed";
  if (s === "draft") return "draft";
  return s || "open";
}

const HEALTH_PALETTE = [
  "var(--fo-accent)",
  "var(--fo-develop)",
  "#a3d099",
  "var(--fo-do)",
  "var(--fo-accent-warm)",
  "#c8a96a",
];

function profileCompleteness(profile, biz) {
  const fields = [
    { label: "full name", filled: !!profile?.full_name },
    { label: "profile photo", filled: !!profile?.avatar_path },
    { label: "business name", filled: !!biz?.business_name },
    { label: "business bio", filled: !!biz?.business_details },
    { label: "address", filled: !!biz?.business_address },
    {
      label: "website or social",
      filled: !!biz?.website_url || !!biz?.instagram_url || !!biz?.facebook_url,
    },
  ];
  fields.forEach((f, i) => (f.color = HEALTH_PALETTE[i % HEALTH_PALETTE.length]));
  const done = fields.filter((f) => f.filled).length;
  const total = fields.length;
  const pct = Math.round((done / total) * 100);
  const missing = fields.filter((f) => !f.filled).map((f) => f.label);
  let tierName;
  if (pct >= 100) tierName = "complete";
  else if (pct >= 67) tierName = "almost there";
  else if (pct >= 34) tierName = "needs attention";
  else tierName = "needs love";
  return { pct, done, total, fields, missing, tierName };
}

function renderHealthDonut(health) {
  const size = 132;
  const stroke = 12;
  const radius = (size - stroke) / 2 - 1;
  const center = size / 2;
  const circumference = 2 * Math.PI * radius;
  const filledLen = (Math.max(0, Math.min(100, health.pct)) / 100) * circumference;
  return `
    <div class="bza__health-donut" role="img" aria-label="${health.pct}% profile complete">
      <svg viewBox="0 0 ${size} ${size}" aria-hidden="true">
        <g transform="rotate(-90 ${center} ${center})">
          <circle cx="${center}" cy="${center}" r="${radius}" fill="none"
                  stroke="var(--fo-surface-3)" stroke-width="${stroke}" />
          <circle cx="${center}" cy="${center}" r="${radius}" fill="none"
                  stroke="var(--fo-accent)" stroke-width="${stroke}" stroke-linecap="round"
                  class="bza__health-slice is-filled"
                  stroke-dasharray="${filledLen} ${circumference - filledLen}" />
        </g>
      </svg>
      <div class="bza__health-center">
        <span class="bza__health-pct">${health.pct}<small>%</small></span>
        <span class="bza__health-fraction">${health.done} of ${health.total}</span>
      </div>
    </div>
  `;
}

function renderHealthChips(health) {
  return `
    <ul class="bza__health-chips">
      ${health.fields
        .map(
          (f) => `<li class="bza__health-chip${f.filled ? " is-filled" : " is-missing"}" style="--chip-color:${f.color}">
        <span class="bza__health-chip-dot" aria-hidden="true"></span>
        <span class="bza__health-chip-label">${escape(f.label)}</span>
      </li>`
        )
        .join("")}
    </ul>
  `;
}

/* ============================================================== */

async function loadData(client, userId) {
  // Fetch in parallel
  const [profileRes, bizRes, listingsRes] = await Promise.all([
    client.from("profiles").select("id, full_name, role, avatar_path").eq("id", userId).single(),
    client
      .from("business_profiles")
      .select("user_id, business_name, business_details, website_url, instagram_url, facebook_url, business_address")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("listings")
      .select("id, title, category, problem_summary, details, budget_cents, status, status_reason, turnaround_days, created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (profileRes.error) {
    const e = new Error(profileRes.error.message || "could not load profile.");
    e.kind = "profile";
    throw e;
  }

  const profile = profileRes.data;
  const biz = bizRes.data;
  const listings = listingsRes.data || [];

  // Bids per listing
  let bidsByListing = {};
  if (listings.length) {
    const ids = listings.map((l) => l.id);
    const { data: bids, error: bidsErr } = await client
      .from("bids")
      .select(
        "id, listing_id, consultant_id, amount_cents, message, status, created_at, profiles!bids_consultant_id_fkey ( full_name, avatar_path )"
      )
      .in("listing_id", ids)
      .order("created_at", { ascending: false });
    if (!bidsErr || isMissing(bidsErr)) {
      for (const b of bids || []) {
        (bidsByListing[b.listing_id] ||= []).push(b);
      }
    }
  }

  // Mark hired listings
  for (const l of listings) {
    const bids = bidsByListing[l.id] || [];
    if (bids.some((b) => b.status === "accepted")) l.__hired = true;
    l.__bidCount = bids.length;
    l.__bids = bids;
  }

  // Messages where owner is recipient or sender, scoped to their listings.
  // Unread = messages I received whose created_at > my last_read_at for the
  // (listing, other_user) thread, sourced from public.message_reads.
  let threadsByListing = {};
  let unreadCount = 0;
  if (listings.length) {
    const ids = listings.map((l) => l.id);
    const [{ data: msgs, error: msgErr }, { data: reads }] = await Promise.all([
      client
        .from("messages")
        .select("id, listing_id, sender_id, recipient_id, body, created_at")
        .in("listing_id", ids)
        .order("created_at", { ascending: false }),
      client
        .from("message_reads")
        .select("listing_id, other_user_id, last_read_at")
        .eq("user_id", userId),
    ]);

    const readMap = new Map();
    for (const r of reads || []) {
      readMap.set(`${r.listing_id}:${r.other_user_id}`, new Date(r.last_read_at).getTime());
    }

    if (!msgErr || isMissing(msgErr)) {
      for (const m of msgs || []) {
        const otherId = m.sender_id === userId ? m.recipient_id : m.sender_id;
        (threadsByListing[m.listing_id] ||= {});
        const t = threadsByListing[m.listing_id];
        if (!t[otherId]) {
          t[otherId] = {
            listingId: m.listing_id,
            consultantId: otherId,
            lastBody: m.body,
            lastAt: m.created_at,
            lastFromMe: m.sender_id === userId,
            unread: 0,
          };
        }
        if (m.recipient_id === userId) {
          const tt = t[otherId];
          const lastRead = readMap.get(`${m.listing_id}:${otherId}`) || 0;
          if (new Date(m.created_at).getTime() > lastRead) {
            tt.unread += 1;
            unreadCount += 1;
          }
        }
      }
    }
  }

  // Look up consultant profile names for the threads
  const consultantIds = new Set();
  for (const tmap of Object.values(threadsByListing)) {
    for (const cid of Object.keys(tmap)) consultantIds.add(cid);
  }
  let consultants = {};
  if (consultantIds.size) {
    const { data, error } = await client
      .from("profiles")
      .select("id, full_name, avatar_path")
      .in("id", [...consultantIds]);
    if (!error || isMissing(error)) {
      for (const p of data || []) consultants[p.id] = p;
    }
  }

  return { profile, biz, listings, bidsByListing, threadsByListing, consultants, unreadCount };
}

/* ============================================================== */

function avatarHtml(client, path, initial, klass = "bza__inbox-avatar") {
  if (path) {
    const url = client.storage.from("avatars").getPublicUrl(path).data?.publicUrl;
    if (url) return `<div class="${klass}"><img src="${escape(url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/></div>`;
  }
  return `<div class="${klass}">${escape(initial || "?")}</div>`;
}

function listingRowHtml(l) {
  const state = listingState(l);
  const stateLabel = STATE_LABELS[state] || state;
  const budgetRange = parseBudgetRangeFromDetails(l.details);
  const cents = l.budget_cents;
  const budgetText = budgetRange
    ? `$${budgetRange.min}–$${budgetRange.max}`
    : cents != null
    ? `$${Math.round(cents / 100)}`
    : "—";

  let metric = "";
  if (state === "open") {
    metric = `<span class="bza__row-metric bza__row-metric--accent">${l.__bidCount}</span><span class="bza__row-metric-sub">offers</span>`;
  } else if (state === "hired") {
    const accepted = (l.__bids || []).find((b) => b.status === "accepted");
    const name = accepted?.profiles?.full_name?.split(" ")[0] || "hired";
    metric = `<span class="bza__row-metric">${escape(name)}</span><span class="bza__row-metric-sub">hired</span>`;
  } else if (state === "closed") {
    metric = `<span class="bza__row-metric">${l.__bidCount}</span><span class="bza__row-metric-sub">offers received</span>`;
  } else if (state === "paused") {
    metric = `<span class="bza__row-metric">${l.__bidCount}</span><span class="bza__row-metric-sub">offers</span>`;
  } else {
    metric = `<span class="bza__row-metric-sub" style="font-style:italic">${escape(stateLabel)}</span>`;
  }

  return `
    <a class="bza__row" href="/listing.html?id=${escape(l.id)}">
      <span class="bza__row-state bza__row-state--${state}"></span>
      <div class="bza__row-main">
        <h3 class="bza__row-title">${escape(l.title || "untitled")}</h3>
        <div class="bza__row-meta">
          <span class="bza__row-state-label bza__row-state-label--${state}">${escape(stateLabel)}</span>
          <span>·</span>
          <span>${escape(relTime(l.created_at))}</span>
          ${l.category ? `<span>·</span><span>${escape(l.category.split(",")[0].trim())}</span>` : ""}
        </div>
      </div>
      <div class="bza__row-budget">${escape(budgetText)}</div>
      <div class="bza__row-metric-block">${metric}</div>
      <div class="bza__row-chev">›</div>
    </a>
  `;
}

function inboxRowHtml(client, t, consultants, listingTitle) {
  const c = consultants[t.consultantId];
  const name = c?.full_name || "consultant";
  const initial = name.charAt(0).toUpperCase();
  const unread = t.unread > 0
    ? `<span class="bza__inbox-unread">${t.unread}</span>`
    : "";
  return `
    <a href="/listing.html?id=${escape(t.listingId)}" class="bza__inbox-row" style="text-decoration:none">
      ${avatarHtml(client, c?.avatar_path, initial)}
      <div style="min-width:0">
        ${listingTitle ? `<div class="bza__inbox-listing">re: ${escape(listingTitle)}</div>` : ""}
        <div class="bza__inbox-name">${escape(name)}${unread}</div>
        <div class="bza__inbox-msg">${t.lastFromMe ? "you: " : ""}${escape(t.lastBody)}</div>
      </div>
      <div class="bza__inbox-time">${escape(relTime(t.lastAt))}</div>
    </a>
  `;
}

/* ============================================================== */

function renderDashboard(client, data) {
  const { profile, biz, listings, threadsByListing, consultants, unreadCount } = data;

  const avatarUrl = profile?.avatar_path
    ? client.storage.from("avatars").getPublicUrl(profile.avatar_path).data?.publicUrl || ""
    : "";

  // sidebar user card (bottom — links to /profile.html)
  const userAvatar = $("dash-user-avatar");
  if (userAvatar) {
    const ui = (profile?.full_name || "?").charAt(0).toUpperCase() || "?";
    userAvatar.innerHTML = avatarUrl ? `<img src="${escape(avatarUrl)}" alt=""/>` : escape(ui);
  }
  const userName = $("dash-user-name");
  if (userName) userName.textContent = profile?.full_name || "your account";
  const userRole = $("dash-user-role");
  if (userRole) {
    userRole.textContent = profile?.role === "consultant" ? "consultant" : "business owner";
  }

  // sidebar badges
  const liveCount = listings.filter((l) => listingState(l) === "open").length;
  const inProgressCount = listings.filter((l) => listingState(l) === "hired").length;
  const listingsBadge = $("dash-listings-badge");
  if (liveCount > 0) {
    listingsBadge.textContent = String(liveCount);
    listingsBadge.hidden = false;
  }
  const inboxBadge = $("dash-inbox-badge");
  if (unreadCount > 0) {
    inboxBadge.textContent = String(unreadCount);
    inboxBadge.hidden = false;
  }
  const engageBadge = $("dash-engage-badge");
  if (engageBadge && inProgressCount > 0) {
    engageBadge.textContent = String(inProgressCount);
    engageBadge.hidden = false;
  }

  // welcome
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";
  $("dash-welcome").textContent = `welcome back, ${firstName}.`;

  const newOffers = listings.reduce(
    (acc, l) => acc + (l.__bids || []).filter((b) => b.status === "submitted" || b.status === "pending").length,
    0
  );

  let metaBits = [];
  if (liveCount) metaBits.push(`${liveCount} live · ${listings.reduce((a, l) => a + (l.__bidCount || 0), 0)} total offers`);
  if (unreadCount) metaBits.push(`${unreadCount} unread`);
  $("dash-h-meta").textContent = metaBits.join(" · ");

  let subBits = [];
  if (newOffers) subBits.push(`${newOffers} ${newOffers === 1 ? "offer needs" : "offers need"} review`);
  if (unreadCount) subBits.push(`${unreadCount} ${unreadCount === 1 ? "message" : "messages"} waiting`);
  if (!subBits.length) subBits.push("everything's quiet — post a listing or check your profile.");
  $("dash-page-sub").textContent = subBits.join(" · ") + ".";

  // listings count + tabs
  const counts = { all: listings.length, open: 0, hired: 0, paused: 0, closed: 0, draft: 0 };
  for (const l of listings) {
    counts[listingState(l)] = (counts[listingState(l)] || 0) + 1;
  }
  $("dash-listings-count").textContent = String(listings.length);
  document.querySelectorAll("[data-count]").forEach((el) => {
    const k = el.dataset.count;
    el.textContent = String(counts[k] || 0);
  });

  // listings rows (dashboard view — show top 5)
  const listingsRows = $("dash-listings-rows");
  const listingsRowsFull = $("dash-listings-rows-full");
  const listingsEmpty = $("dash-listings-empty");
  if (!listings.length) {
    listingsEmpty.hidden = false;
    listingsRows.innerHTML = "";
    listingsRowsFull.innerHTML = "";
  } else {
    listingsEmpty.hidden = true;
    listingsRows.innerHTML = listings.slice(0, 5).map(listingRowHtml).join("");
    listingsRowsFull.innerHTML = listings.map(listingRowHtml).join("");
  }

  // tab filtering on the dashboard listings panel
  const tabsHost = $("dash-listings-tabs");
  if (tabsHost && !tabsHost.dataset.bound) {
    tabsHost.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-state]");
      if (!btn) return;
      tabsHost.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const state = btn.dataset.state;
      const filtered = state === "all" ? listings : listings.filter((l) => listingState(l) === state);
      listingsRows.innerHTML = filtered.length ? filtered.map(listingRowHtml).join("") : `<p class="gr-empty-state" style="padding:1rem">no listings in this state.</p>`;
    });
    tabsHost.dataset.bound = "1";
  }

  // inbox preview — show only threads with unread messages. When there are
  // none, show a "you're all caught up!" state instead of the full inbox.
  const allThreads = [];
  for (const [listingId, threads] of Object.entries(threadsByListing)) {
    const listing = listings.find((l) => l.id === listingId);
    for (const t of Object.values(threads)) {
      allThreads.push({ ...t, listingTitle: listing?.title || "" });
    }
  }
  const unreadThreads = allThreads
    .filter((t) => t.unread > 0)
    .sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));
  const inboxPreview = $("dash-inbox-preview");
  const inboxEmpty = $("dash-inbox-empty");
  if (!unreadThreads.length) {
    if (inboxEmpty) {
      inboxEmpty.hidden = false;
      inboxEmpty.textContent = "you're all caught up!";
      inboxEmpty.classList.add("dash-inbox-empty--caught-up");
    }
    if (inboxPreview) inboxPreview.innerHTML = "";
  } else {
    if (inboxEmpty) {
      inboxEmpty.hidden = true;
      inboxEmpty.classList.remove("dash-inbox-empty--caught-up");
    }
    if (inboxPreview) {
      inboxPreview.innerHTML = unreadThreads
        .slice(0, 3)
        .map((t) => inboxRowHtml(client, t, consultants, t.listingTitle))
        .join("");
    }
  }

  // (the full inbox view is now rendered by inbox.js — no-op here)

  // engagements (hired listings)
  const engageRows = $("dash-engagements-rows");
  const engageEmpty = $("dash-engagements-empty");
  const inProgress = listings.filter((l) => listingState(l) === "hired");
  if (!inProgress.length) {
    engageEmpty.hidden = false;
    engageRows.innerHTML = "";
  } else {
    engageEmpty.hidden = true;
    engageRows.innerHTML = inProgress.map(listingRowHtml).join("");
  }

  // archive (closed)
  const archiveRows = $("dash-archive-rows");
  const archiveEmpty = $("dash-archive-empty");
  const archive = listings.filter((l) => listingState(l) === "closed");
  if (!archive.length) {
    archiveEmpty.hidden = false;
    archiveRows.innerHTML = "";
  } else {
    archiveEmpty.hidden = true;
    archiveRows.innerHTML = archive.map(listingRowHtml).join("");
  }

  // profile health
  const health = profileCompleteness(profile, biz);
  const acceptedCount = listings.reduce(
    (acc, l) => acc + (l.__bids || []).filter((b) => b.status === "accepted").length,
    0
  );
  const offersLifetime = listings.reduce((a, l) => a + (l.__bidCount || 0), 0);

  const panel = $("dash-profile-health");
  if (panel) {
    const isComplete = health.pct >= 100;
    panel.classList.toggle("is-complete", isComplete);
    panel.classList.toggle("is-incomplete", !isComplete);

    let copy;
    if (isComplete) copy = "your profile is complete. consultants can see exactly who they'd work with.";
    else if (health.missing.length === 1) copy = `add your ${health.missing[0]} to finish your profile.`;
    else copy = `still missing: ${health.missing.slice(0, 3).join(", ")}${health.missing.length > 3 ? `, +${health.missing.length - 3} more` : ""}.`;

    let ctaText;
    if (isComplete) ctaText = "profile is complete ✓";
    else if (health.missing.length === 1) ctaText = `add your ${health.missing[0]}`;
    else ctaText = `complete your profile · ${health.missing.length} left`;

    const tierColor =
      health.pct >= 67 ? "var(--fo-accent)" : health.pct >= 34 ? "var(--fo-do)" : "var(--fo-plan)";

    panel.innerHTML = `
      <div class="bza__panel-h">
        <span class="bza__panel-h-title"><strong>profile health</strong></span>
      </div>

      <div class="bza__health-top">
        ${renderHealthDonut(health)}
        <div class="bza__health-summary">
          <span class="bza__health-tier" style="color:${tierColor}">
            <span class="bza__health-tier-mark" aria-hidden="true"></span>
            ${escape(health.tierName)}
          </span>
          <p class="bza__health-name">${health.pct}% complete</p>
          <p class="bza__health-eyebrow">${escape(copy)}</p>
        </div>
      </div>

      <a href="/profile.html" class="bza__health-cta${isComplete ? "" : " is-pulsing"}">
        <span class="bza__health-cta-text">${escape(ctaText)}</span>
        <span class="bza__health-cta-arrow" aria-hidden="true">→</span>
      </a>
    `;
  }
}

/* ============================================================== */

function setupViewSwitcher() {
  const sidebar = $("dash-sidebar");
  const shell = $("dash-shell");
  const views = document.querySelectorAll(".dash-view");

  function showView(name) {
    views.forEach((v) => {
      v.hidden = v.dataset.view !== name;
    });
    sidebar.querySelectorAll(".bza__nav-item[data-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });
    const currentHash = window.location.hash.replace("#", "").split("?")[0];
    if (currentHash !== name) {
      window.history.replaceState(null, "", `#${name}`);
    }
    if (name === "inbox") lazyInitInbox();
  }

  let inboxLoaded = false;
  async function lazyInitInbox() {
    if (inboxLoaded) return;
    inboxLoaded = true;
    try {
      const mod = await import("/inbox.js");
      await mod.initInbox();
    } catch (err) {
      console.warn("inbox load failed", err);
      inboxLoaded = false;
    }
  }

  // sidebar buttons
  sidebar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn) return;
    showView(btn.dataset.view);
  });

  // also wire any other element with data-view (e.g. "view all →" button in dashboard)
  document.querySelectorAll("[data-view]:not(.dash-view)").forEach((el) => {
    if (el.closest("aside")) return;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      showView(el.dataset.view);
    });
  });

  // collapse toggle
  const COLLAPSE_KEY = "grassroots_dash_sidebar_collapsed";
  const toggleBtn = $("dash-side-toggle");
  function applyCollapsed(collapsed) {
    shell.classList.toggle("bza--collapsed", collapsed);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", String(!collapsed));
      toggleBtn.setAttribute("aria-label", collapsed ? "expand sidebar" : "collapse sidebar");
    }
  }
  let initialCollapsed = false;
  try {
    initialCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {}
  applyCollapsed(initialCollapsed);
  function toggleCollapsed() {
    const next = !shell.classList.contains("bza--collapsed");
    applyCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {}
  }
  toggleBtn?.addEventListener("click", toggleCollapsed);
  $("dash-side-edge")?.addEventListener("dblclick", toggleCollapsed);

  // dark mode toggle in sidebar (mirrors GrassrootsTheme)
  const darkInput = $("dash-darkmode-toggle");
  if (darkInput && window.GrassrootsTheme) {
    const isDark = (t) => t === "dark-forest" || t === "dark" || t === "forest-soft";
    darkInput.checked = isDark(window.GrassrootsTheme.get());
    darkInput.addEventListener("change", () => {
      window.GrassrootsTheme.set(darkInput.checked ? "dark-forest" : "light");
    });
    window.addEventListener("grassroots:themechange", (e) => {
      darkInput.checked = isDark(e.detail || window.GrassrootsTheme.get());
    });
  }

  // log out
  const logoutBtn = $("dash-logout");
  logoutBtn?.addEventListener("click", async () => {
    try {
      const client = await getSupabaseClient();
      await client.auth.signOut();
    } catch (err) {
      console.warn("logout failed", err);
    }
    window.location.replace("/");
  });

  // initial
  const rawHash = window.location.hash.replace("#", "");
  const initial = rawHash.split("?")[0] || "dashboard";
  showView(initial);
}

/* ============================================================== */

async function init() {
  const gate = $("dash-gate");
  const shell = $("dash-shell");
  try {
    const client = await getSupabaseClient();
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      window.location.replace("/signin.html?next=/dashboard.html");
      return;
    }

    const data = await loadData(client, session.user.id);

    // Only redirect a confirmed consultant. A null/missing profile or an
    // unrecognized role means something went wrong — don't bounce the user
    // because that would loop with the marketplace's own role redirect.
    if (data.profile && data.profile.role === "consultant") {
      window.location.replace("/consultant-dashboard.html");
      return;
    }

    gate.hidden = true;
    shell.hidden = false;
    renderDashboard(client, data);
    setupViewSwitcher();
  } catch (err) {
    console.error(err);
    gate.textContent = err.message || "could not load dashboard.";
    gate.className = "gr-status error";
  }
}

init();
