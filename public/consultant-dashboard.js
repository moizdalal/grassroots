// consultant-dashboard.js — landing surface for consultants.
// Mirrors the owner dashboard but oriented around their bids: active
// engagements, action items needing a response, a recommended listing
// to browse, an unread-only inbox preview, and profile health.

import { getSupabaseClient } from "/supabase-loader.js";
import { mountDashboardNotifications } from "/dashboard-notifications.js";
import { fetchRatingFor, renderRatingMarkup } from "/rating.js";
import { getInitials } from "/initials.js";

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

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

function fmtUSD(cents) {
  if (!Number.isFinite(Number(cents))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
}

function publicAvatarUrl(client, path) {
  if (!path) return null;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

/* ============================================================== */
/*                          DATA LOADING                          */
/* ============================================================== */

async function loadData(client, userId) {
  const [profileRes, consultantRes] = await Promise.all([
    client
      .from("profiles")
      .select("id, full_name, role, avatar_path, linkedin_url, resume_path")
      .eq("id", userId)
      .single(),
    client
      .from("consultant_profiles")
      .select("user_id, headline, bio, major, school")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);

  if (profileRes.error) {
    const e = new Error(profileRes.error.message || "could not load profile.");
    throw e;
  }
  const profile = profileRes.data;
  const consultant = consultantRes.data;

  // Bids the consultant has placed (status, counter offers, accepted, etc.)
  const { data: bids } = await client
    .from("bids")
    .select(
      "id, listing_id, consultant_id, amount_cents, message, status, counter_offer_cents, counter_offer_message, accepted_at, proposal_due_at, proposal_path, created_at"
    )
    .eq("consultant_id", userId)
    .order("created_at", { ascending: false });

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

  // Owner profile/biz info for engagements
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

  // Recommended: most recent open listing the consultant hasn't bid on
  const myBidListings = new Set(listingIds);
  let recommended = null;
  try {
    const { data } = await client
      .from("listings")
      .select(
        "id, owner_id, title, category, problem_summary, status, budget_cents, created_at, business_display_name"
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(20);
    recommended = (data || []).find((l) => !myBidListings.has(l.id) && l.owner_id !== userId) || null;
    if (recommended && !ownerMap.has(recommended.owner_id)) {
      const [{ data: recProfile }, { data: recBiz }] = await Promise.all([
        client.from("profiles").select("id, full_name, avatar_path").eq("id", recommended.owner_id).maybeSingle(),
        client
          .from("business_profiles")
          .select("user_id, business_name")
          .eq("user_id", recommended.owner_id)
          .maybeSingle(),
      ]);
      if (recProfile) ownerMap.set(recProfile.id, recProfile);
      if (recBiz) ownerBizMap.set(recBiz.user_id, recBiz.business_name);
    }
  } catch (err) {
    console.warn("recommended load failed", err);
  }

  // Inbox: unread messages where consultant is recipient
  let unreadThreads = [];
  let unreadCount = 0;
  try {
    const [{ data: msgs }, { data: reads }] = await Promise.all([
      client
        .from("messages")
        .select("id, listing_id, sender_id, recipient_id, body, created_at")
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(500),
      client
        .from("message_reads")
        .select("listing_id, other_user_id, last_read_at")
        .eq("user_id", userId),
    ]);
    const readMap = new Map();
    for (const r of reads || []) {
      readMap.set(`${r.listing_id}:${r.other_user_id}`, new Date(r.last_read_at).getTime());
    }
    const threads = new Map();
    for (const m of msgs || []) {
      const otherId = m.sender_id === userId ? m.recipient_id : m.sender_id;
      if (!otherId || !m.listing_id) continue;
      const key = `${m.listing_id}:${otherId}`;
      let t = threads.get(key);
      if (!t) {
        t = { key, listingId: m.listing_id, otherId, lastBody: m.body, lastAt: m.created_at, fromMe: m.sender_id === userId, unread: 0 };
        threads.set(key, t);
      }
      if (m.recipient_id === userId) {
        const lastRead = readMap.get(key) || 0;
        if (new Date(m.created_at).getTime() > lastRead) t.unread += 1;
      }
    }
    unreadThreads = [...threads.values()].filter((t) => t.unread > 0).sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));
    unreadCount = unreadThreads.reduce((n, t) => n + t.unread, 0);

    // Hydrate threads with listing+counterpart info
    const threadListingIds = new Set(unreadThreads.slice(0, 5).map((t) => t.listingId));
    const threadOtherIds = new Set(unreadThreads.slice(0, 5).map((t) => t.otherId));
    if (threadListingIds.size) {
      const { data: tListings } = await client
        .from("listings")
        .select("id, title")
        .in("id", [...threadListingIds]);
      const map = new Map((tListings || []).map((l) => [l.id, l]));
      for (const t of unreadThreads) t.listingTitle = map.get(t.listingId)?.title || "";
    }
    if (threadOtherIds.size) {
      const [{ data: tProfiles }, { data: tBiz }] = await Promise.all([
        client.from("profiles").select("id, full_name, role, avatar_path").in("id", [...threadOtherIds]),
        client.from("business_profiles").select("user_id, business_name").in("user_id", [...threadOtherIds]),
      ]);
      const pmap = new Map((tProfiles || []).map((p) => [p.id, p]));
      const bmap = new Map((tBiz || []).map((b) => [b.user_id, b.business_name]));
      for (const t of unreadThreads) {
        const p = pmap.get(t.otherId);
        t.otherName = bmap.get(t.otherId) || p?.full_name || "business";
        t.otherAvatar = p?.avatar_path || null;
      }
    }
  } catch (err) {
    console.warn("inbox preview failed", err);
  }

  return {
    profile,
    consultant,
    bids: bids || [],
    listingMap,
    ownerMap,
    ownerBizMap,
    recommended,
    unreadThreads,
    unreadCount,
  };
}

/* ============================================================== */
/*                         RENDER HELPERS                         */
/* ============================================================== */

function counterpartName(ownerId, ownerMap, ownerBizMap) {
  return ownerBizMap.get(ownerId) || ownerMap.get(ownerId)?.full_name || "business";
}

function activeEngagements(bids, listingMap, ownerMap, ownerBizMap) {
  return bids
    .filter((b) => b.status === "accepted" && (listingMap.get(b.listing_id)?.status !== "closed"))
    .map((bid) => {
      const listing = listingMap.get(bid.listing_id);
      const owner = ownerMap.get(listing?.owner_id);
      const counterpart = counterpartName(listing?.owner_id, ownerMap, ownerBizMap);
      return { bid, listing, owner, counterpart };
    });
}

function renderEngagements(client, engagements) {
  const root = $("cdash-engagements-rows");
  const empty = $("cdash-engagements-empty");
  $("cdash-engagements-count").textContent = String(engagements.length);
  if (!engagements.length) {
    root.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  root.innerHTML = engagements
    .map(({ bid, listing, owner, counterpart }) => {
      const avatarUrl = publicAvatarUrl(client, owner?.avatar_path);
      const avatar = avatarUrl
        ? `<img src="${escape(avatarUrl)}" alt=""/>`
        : escape(getInitials(counterpart));
      const status = bid.proposal_path ? "in progress" : bid.proposal_due_at ? "proposal due" : "kickoff pending";
      return `
        <a class="cdash__eng-row" href="/engagement.html?bid=${escape(bid.id)}">
          <span class="cdash__eng-avatar">${avatar}</span>
          <div class="cdash__eng-meta">
            <span class="cdash__eng-biz">${escape(counterpart)}</span>
            <span class="cdash__eng-title">${escape(listing?.title || "engagement")}</span>
          </div>
          <span class="cdash__eng-status">${escape(status)}</span>
          <span class="cdash__eng-amount">${escape(fmtUSD(bid.amount_cents))}</span>
          <span class="cdash__eng-arrow" aria-hidden="true">→</span>
        </a>
      `;
    })
    .join("");
}

function renderRecommended(client, listing, ownerMap, ownerBizMap) {
  const root = $("cdash-recommended");
  const empty = $("cdash-recommended-empty");
  if (!listing) {
    root.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const counterpart = counterpartName(listing.owner_id, ownerMap, ownerBizMap);
  const owner = ownerMap.get(listing.owner_id);
  const avatarUrl = publicAvatarUrl(client, owner?.avatar_path);
  const avatar = avatarUrl
    ? `<img class="gr-listing-logo" src="${escape(avatarUrl)}" alt=""/>`
    : `<div class="gr-listing-logo-placeholder">${escape(getInitials(counterpart))}</div>`;
  const tags = (listing.category || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 3);
  const summary = listing.problem_summary
    ? String(listing.problem_summary).trim().slice(0, 90).replace(/\s+\S*$/, "") + "…"
    : "";
  root.innerHTML = `
    <a class="gr-listing-card cdash__recommended-card" href="/listing.html?id=${escape(listing.id)}">
      <div class="gr-listing-card-head">
        <div class="gr-listing-logo-wrap">${avatar}</div>
        <div class="gr-listing-card-biz">
          <span class="gr-listing-biz-label">posted by</span>
          <p class="gr-listing-biz-name">${escape(counterpart)}</p>
        </div>
      </div>
      <div class="gr-listing-card-body">
        <h3 class="gr-listing-title">${escape(listing.title)}</h3>
        ${summary ? `<p class="gr-listing-summary">${escape(summary)}</p>` : ""}
      </div>
      <div class="gr-listing-foot">
        ${tags.length ? `<div class="gr-listing-tags">${tags.slice(0, 2).map((t) => `<span class="gr-listing-tag">${escape(t)}</span>`).join("")}</div>` : "<span></span>"}
        <div class="gr-listing-foot-end">
          ${Number.isFinite(Number(listing.budget_cents)) ? `<p class="gr-listing-budget">${escape(fmtUSD(listing.budget_cents))}</p>` : ""}
          <span class="gr-listing-cta-link">view →</span>
        </div>
      </div>
    </a>
  `;
}

function renderInboxPreview(client, threads, unreadCount) {
  const root = $("cdash-inbox-preview");
  const empty = $("cdash-inbox-empty");
  const badge = $("cdash-inbox-badge");
  if (badge) {
    badge.textContent = String(unreadCount);
    badge.hidden = unreadCount === 0;
  }
  if (!threads.length) {
    root.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "you're all caught up.";
    empty.classList.add("dash-inbox-empty--caught-up");
    return;
  }
  empty.hidden = true;
  root.innerHTML = threads
    .slice(0, 3)
    .map((t) => {
      const url = publicAvatarUrl(client, t.otherAvatar);
      const av = url ? `<img src="${escape(url)}" alt=""/>` : escape(getInitials(t.otherName));
      return `
        <a class="bza__inbox-row" href="/consultant-dashboard.html#inbox?thread=${escape(t.listingId)}:${escape(t.otherId)}" style="text-decoration:none">
          <span class="bza__inbox-avatar">${av}</span>
          <div style="flex:1;min-width:0">
            ${t.listingTitle ? `<div class="bza__inbox-listing">re: ${escape(t.listingTitle)}</div>` : ""}
            <div class="bza__inbox-name">${escape(t.otherName || "")}<span class="bza__inbox-unread">${t.unread}</span></div>
            <div class="bza__inbox-msg">${escape(t.lastBody || "")}</div>
          </div>
          <div class="bza__inbox-time">${escape(relTime(t.lastAt))}</div>
        </a>
      `;
    })
    .join("");
}

/* ============================================================== */
/*                         PROFILE HEALTH                         */
/* ============================================================== */

const HEALTH_PALETTE = [
  "var(--fo-accent)",
  "var(--fo-develop)",
  "#a3d099",
  "var(--fo-do)",
  "var(--fo-accent-warm)",
];

function consultantHealth(profile, consultant) {
  const fields = [
    { label: "full name", filled: !!profile?.full_name, href: "/profile.html" },
    { label: "profile photo", filled: !!profile?.avatar_path, href: "/profile.html" },
    { label: "linkedin", filled: !!profile?.linkedin_url, href: "/profile.html" },
    { label: "resume", filled: !!profile?.resume_path, href: "/profile.html" },
    { label: "school", filled: !!consultant?.school, href: "/profile.html" },
    { label: "headline", filled: !!consultant?.headline, href: "/profile.html" },
  ];
  fields.forEach((f, i) => (f.color = HEALTH_PALETTE[i % HEALTH_PALETTE.length]));
  const done = fields.filter((f) => f.filled).length;
  const total = fields.length;
  const pct = Math.round((done / total) * 100);
  const missing = fields.filter((f) => !f.filled);
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
  const filledLen = (health.pct / 100) * circumference;
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

function renderHealth(panel, health, consultantId) {
  const isComplete = health.pct >= 100;
  panel.classList.toggle("is-complete", isComplete);
  panel.classList.toggle("is-incomplete", !isComplete);

  let copy;
  let cta;
  if (isComplete) {
    copy = "your profile is complete. businesses can see exactly who they'd hire.";
    cta = "open profile";
  } else {
    const next = health.missing[0];
    copy = `add your ${next.label} so businesses know more about you.`;
    cta = `add ${next.label}`;
  }

  const tierColor = health.pct >= 67 ? "var(--fo-accent)" : health.pct >= 34 ? "var(--fo-do)" : "var(--fo-plan)";

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
    <a href="/profile.html" class="bza__health-cta">
      <span class="bza__health-cta-text">${escape(cta)}</span>
      <span class="bza__health-cta-arrow" aria-hidden="true">→</span>
    </a>
    <a href="/payouts.html" class="bza__health-rating" data-payouts-row>
      <span class="bza__health-rating__label">payouts</span>
      <span class="bza__health-rating__chip" data-payouts-chip>checking…</span>
      <span class="bza__health-rating__cta" data-payouts-cta>set up →</span>
    </a>
    <a href="/my-reviews.html" class="bza__health-rating" data-rating-host="">
      <span class="bza__health-rating__label">your rating</span>
      <span class="bza__health-rating__chip" data-rating-chip>loading…</span>
      <span class="bza__health-rating__cta">view reviews →</span>
    </a>
  `;

  // Payouts onboarding status — surfaces a clear active/setup-needed pill.
  (async () => {
    const chip = panel.querySelector("[data-payouts-chip]");
    const cta = panel.querySelector("[data-payouts-cta]");
    if (!chip) return;
    try {
      const sb = await getSupabaseClient();
      const { data: { session } } = await sb.auth.getSession();
      const headers = {};
      if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
      const res = await fetch("/api/stripe/account-status", { headers });
      const data = await res.json().catch(() => ({}));
      if (data?.onboarded) {
        chip.textContent = "active";
        chip.className = "gr-pill gr-pill--accepted gr-pill--no-dot";
        if (cta) cta.textContent = "manage →";
      } else if (data?.details_submitted) {
        chip.textContent = "verifying";
        chip.className = "gr-pill gr-pill--warn gr-pill--no-dot";
      } else {
        chip.textContent = "not set up";
        chip.className = "gr-pill gr-pill--muted gr-pill--no-dot";
      }
    } catch (_) {
      chip.textContent = "—";
    }
  })();

  if (consultantId) {
    fetchRatingFor(consultantId).then((rating) => {
      const chip = panel.querySelector("[data-rating-chip]");
      if (chip) chip.outerHTML = renderRatingMarkup(rating, { size: "md" });
    });
  }
}

/* ============================================================== */
/*                      RENDER + INIT                             */
/* ============================================================== */

function renderDashboard(client, data) {
  const { profile, consultant, bids, listingMap, ownerMap, ownerBizMap, recommended, unreadThreads, unreadCount } = data;

  // welcome
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";
  $("cdash-welcome").textContent = `welcome back, ${firstName}.`;

  // header meta
  const engagements = activeEngagements(bids, listingMap, ownerMap, ownerBizMap);
  const headMeta = $("cdash-h-meta");
  const subBits = [];
  if (engagements.length) subBits.push(`${engagements.length} active engagement${engagements.length === 1 ? "" : "s"}`);
  if (unreadCount) subBits.push(`${unreadCount} unread message${unreadCount === 1 ? "" : "s"}`);
  if (headMeta) headMeta.textContent = subBits.join(" · ");

  const sub = $("cdash-page-sub");
  if (sub) sub.textContent = "you're caught up. browse the marketplace to find your next project.";

  // Notifications panel — replaces the old action-items panel.
  const notifList = $("cdash-notifications-list");
  const notifEmpty = $("cdash-notifications-empty");
  const userId = data?.session?.user?.id;
  if (userId && notifList) {
    mountDashboardNotifications({
      client,
      userId,
      listEl: notifList,
      emptyEl: notifEmpty,
    }).then((result) => {
      if (sub && result?.unreadCount) {
        sub.textContent = `${result.unreadCount} new notification${result.unreadCount === 1 ? "" : "s"}.`;
      }
    });
  }

  renderEngagements(client, engagements);
  renderRecommended(client, recommended, ownerMap, ownerBizMap);
  renderInboxPreview(client, unreadThreads, unreadCount);

  // user card (sidebar bottom)
  const avatarUrl = publicAvatarUrl(client, profile?.avatar_path);
  const userAvatar = $("cdash-user-avatar");
  if (userAvatar) {
    const ui = getInitials(profile?.full_name);
    userAvatar.innerHTML = avatarUrl ? `<img src="${escape(avatarUrl)}" alt=""/>` : escape(ui);
  }
  const userName = $("cdash-user-name");
  if (userName) userName.textContent = profile?.full_name || "your account";

  // profile health
  const healthPanel = $("cdash-health-panel");
  if (healthPanel) renderHealth(healthPanel, consultantHealth(profile, consultant), profile?.id);
}

function setupShell() {
  const sidebar = $("cdash-sidebar");
  const shell = $("cdash-shell");
  const COLLAPSE_KEY = "grassroots_dash_sidebar_collapsed";

  function applyCollapsed(collapsed) {
    shell.classList.toggle("bza--collapsed", collapsed);
  }
  let initialCollapsed = false;
  try { initialCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch {}
  applyCollapsed(initialCollapsed);

  function toggleCollapsed() {
    const next = !shell.classList.contains("bza--collapsed");
    applyCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch {}
  }
  $("cdash-side-edge")?.addEventListener("dblclick", toggleCollapsed);

  // dark mode mirror
  const darkInput = $("cdash-darkmode-toggle");
  if (darkInput && window.GrassrootsTheme) {
    const isDark = (t) => t === "dark-forest" || t === "dark" || t === "forest-soft";
    darkInput.checked = isDark(window.GrassrootsTheme.get());
    darkInput.addEventListener("change", () => {
      window.GrassrootsTheme.set(darkInput.checked ? "dark" : "light");
    });
    window.addEventListener("grassroots:themechange", (e) => {
      darkInput.checked = isDark(e.detail || window.GrassrootsTheme.get());
    });
  }

  // logout
  $("cdash-logout")?.addEventListener("click", async () => {
    try {
      const client = await getSupabaseClient();
      await client.auth.signOut();
    } catch {}
    window.location.replace("/");
  });

  // view switcher (dashboard ↔ inbox)
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
  function showView(name) {
    document.querySelectorAll(".dash-view").forEach((v) => {
      v.hidden = v.dataset.view !== name;
    });
    sidebar.querySelectorAll("[data-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });
    if (name === "inbox") lazyInitInbox();
  }
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (el.tagName === "A") e.preventDefault();
      showView(el.dataset.view);
    });
  });

  const initialHash = window.location.hash.replace("#", "").split("?")[0];
  showView(initialHash || "dashboard");
}

async function init() {
  const gate = $("cdash-gate");
  const shell = $("cdash-shell");
  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
      window.location.replace("/signin.html?next=/consultant-dashboard.html");
      return;
    }
    const data = await loadData(client, session.user.id);
    data.session = session;
    if (data.profile?.role === "business_owner") {
      window.location.replace("/dashboard.html");
      return;
    }
    gate.hidden = true;
    shell.hidden = false;
    setupShell();
    renderDashboard(client, data);
  } catch (err) {
    console.error(err);
    gate.textContent = err.message || "could not load dashboard.";
    gate.className = "gr-status error";
  }
}

init();
