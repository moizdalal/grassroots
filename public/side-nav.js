// side-nav.js — shared application sidebar.
// Wraps the page's <main> in a .bza grid and injects the standard
// sidebar with a brand link to the landing page, nav links pointing
// at dashboard views, and account links to direct pages.
// Skips itself on pages that already render a .bza__side (the
// dashboard injects its own from the loaded data).

import { getInitials } from "/initials.js";
import "/mobile-nav.js";

const COLLAPSE_KEY = "grassroots_dash_sidebar_collapsed";
const ENG_SUBNAV_KEY = "grassroots_side_engagements_open";

const ICONS = {
  home:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10a1 1 0 0 0 1 1h4v-7h4v7h4a1 1 0 0 0 1-1V10"/></svg>',
  listings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/><line x1="7" y1="17" x2="13" y2="17"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>',
  engagements:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="3" y1="13" x2="21" y2="13"/></svg>',
  marketplace:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></svg>',
  payouts:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12V8a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-1"/><path d="M16 12a2 2 0 0 0 0 4h5v-4z"/></svg>',
  training:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2 10 12 5l10 5-10 5z"/><path d="M6 12v5c3 2 9 2 12 0v-5"/></svg>',
  notifications:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  chevron:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  help:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="4"/><line x1="4.93" y1="4.93" x2="9.17" y2="9.17"/><line x1="14.83" y1="14.83" x2="19.07" y2="19.07"/><line x1="14.83" y1="9.17" x2="19.07" y2="4.93"/><line x1="4.93" y1="19.07" x2="9.17" y2="14.83"/></svg>',
  collapse:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="11 17 6 12 11 7"/><polyline points="18 17 13 12 18 7"/></svg>',
};

// Nav items are built per-role so consultants don't see "my listings"
// (they don't have any) and owners don't see "marketplace" duplicated as
// the dashboard. See buildNavItems(). System actions (settings, help,
// dark mode) are rendered separately as a compact icon row pinned to the
// bottom of the sidebar — see renderSidebar().

function buildNavItems(role) {
  if (role === "consultant") {
    // Consultants get "home" (their dashboard), an expandable engagements
    // hub for managing active and past work, plus marketplace, inbox,
    // notifications, and a direct payouts link.
    // Marketplace is positioned second (right after home) so discovery
    // outranks bookkeeping in the consultant flow.
    return [
      { href: "/consultant-dashboard.html", label: "Home", icon: ICONS.home, navId: "home" },
      { href: "/marketplace.html", label: "Marketplace", icon: ICONS.marketplace, navId: "marketplace" },
      { href: "/engagements.html", label: "Engagements", icon: ICONS.engagements, navId: "engagements" },
      { href: "/inbox.html", label: "Inbox", icon: ICONS.inbox, navId: "inbox" },
      { href: "/notifications.html", label: "Notifications", icon: ICONS.notifications, navId: "notifications" },
      { href: "/payouts.html", label: "Payouts", icon: ICONS.payouts, navId: "payouts" },
      { href: "/training.html", label: "Training", icon: ICONS.training, navId: "training" },
    ];
  }
  // Default to the owner layout. This is also what unauthenticated visitors
  // see, but the sidebar's user card / logout will be hidden in that case.
  return [
    { href: "/dashboard.html", label: "Home", icon: ICONS.home, navId: "home" },
    { href: "/dashboard.html#listings", label: "My listings", icon: ICONS.listings, navId: "listings" },
    { href: "/inbox.html", label: "Inbox", icon: ICONS.inbox, navId: "inbox" },
    { href: "/notifications.html", label: "Notifications", icon: ICONS.notifications, navId: "notifications" },
  ];
}

// Secondary nav (account / system). Same vertical layout as the
// primary items, but rendered after a divider so the visual grouping
// reads as "what you do" → hairline → "your account".
const SECONDARY_NAV_ITEMS = [
  { href: "/settings.html", label: "Settings", icon: ICONS.gear, navId: "settings" },
  { href: "/help.html", label: "Help", icon: ICONS.help, navId: "help" },
];

function inferActiveNavId(role) {
  const path = window.location.pathname;
  const hash = window.location.hash.replace("#", "");
  const params = new URLSearchParams(window.location.search);
  if (path === "/dashboard.html" || path === "/dashboard") return hash || "home";
  if (path === "/consultant-dashboard.html") return hash || "home";
  if (path === "/marketplace.html") return role === "consultant" ? "marketplace" : null;
  if (path === "/engagements.html") return "engagements";
  if (path === "/payouts.html") return role === "consultant" ? "payouts" : null;
  if (path === "/training.html") return role === "consultant" ? "training" : null;
  if (path === "/notifications.html") return "notifications";
  if (path === "/inbox.html") return "inbox";
  if (path === "/settings.html") return "settings";
  if (path === "/help.html" || path.startsWith("/help/")) return "help";
  return null;
}

const ICON_MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const ICON_LOGOUT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

function renderNavItem(item, activeNavId) {
  const childActive = (item.sub || []).some((s) => s.navId === activeNavId);
  const active = activeNavId === item.navId || childActive ? " active" : "";
  if (!item.sub) {
    // Notifications carries an unread badge (same markup as the dashboards'
    // own sidebars); filled in by wireNotifBadge() once the count loads.
    const badge = item.navId === "notifications"
      ? '<span class="bza__nav-badge" id="gr-side-notif-badge" hidden></span>'
      : "";
    return `<a href="${item.href}" class="bza__nav-item${active}" data-nav-id="${item.navId}" title="${item.label}">
      <span class="bza__nav-icon" aria-hidden="true">${item.icon}</span>
      <span class="bza__nav-label">${item.label}</span>
      ${badge}
    </a>`;
  }
  // Item has a sub-nav. The main link still navigates to the parent
  // page; the chevron toggles the sub list. Default open state honours
  // the active child (if any) so it doesn't slam shut on navigation.
  let initialOpen = childActive;
  try {
    if (!initialOpen) initialOpen = window.localStorage.getItem(ENG_SUBNAV_KEY) === "1";
  } catch {}
  const subItems = item.sub
    .map((s) => {
      const sActive = activeNavId === s.navId ? " active" : "";
      return `<a href="${s.href}" class="bza__nav-subitem${sActive}" data-nav-id="${s.navId}">
        <span class="bza__nav-subitem-dot" aria-hidden="true"></span>
        <span class="bza__nav-subitem-label">${s.label}</span>
      </a>`;
    })
    .join("");
  return `<div class="bza__nav-group${initialOpen ? " is-open" : ""}" data-nav-group="${item.navId}">
      <div class="bza__nav-row">
        <a href="${item.href}" class="bza__nav-item bza__nav-item--has-sub${active}" data-nav-id="${item.navId}" title="${item.label}">
          <span class="bza__nav-icon" aria-hidden="true">${item.icon}</span>
          <span class="bza__nav-label">${item.label}</span>
        </a>
        <button type="button" class="bza__nav-toggle" aria-expanded="${initialOpen}" aria-controls="bza-sub-${item.navId}" title="Toggle ${item.label}">
          <span class="bza__nav-toggle-icon" aria-hidden="true">${ICONS.chevron}</span>
        </button>
      </div>
      <div class="bza__nav-subnav" id="bza-sub-${item.navId}" role="group">
        ${subItems}
      </div>
    </div>`;
}

function renderSidebar({ role, activeNavId }) {
  const navItems = buildNavItems(role);
  const primary = navItems.map((it) => renderNavItem(it, activeNavId)).join("");
  const secondary = SECONDARY_NAV_ITEMS.map((it) => renderNavItem(it, activeNavId)).join("");
  // Owners get a "post a listing" CTA pinned to the bottom of the
  // sidebar, sitting just above the dark-mode toggle. `margin-top: auto`
  // on `.bza__post` (set in CSS) anchors it + everything below to the
  // bottom of the flex column.
  const postCta =
    role === "consultant"
      ? ""
      : `
      <a href="/create-listing.html" class="bza__post" id="gr-side-post" title="Post a listing">
        <span class="bza__nav-icon" aria-hidden="true">${ICONS.plus}</span>
        <span class="bza__nav-label">Post a listing</span>
      </a>`;
  return `
    <aside class="bza__side" id="gr-side">
      <div class="bza__side-edge" id="gr-side-edge" aria-hidden="true" title="Double-click to toggle"></div>
      <div class="bza__side-head">
        <a class="bza__brand" href="/" title="Grassroots — home">
          <img class="bza__brand-mark" src="/home/assets/grassroots-icon-syne.svg" width="20" height="34" alt="" />
          <span class="bza__brand-text">grassroots</span>
        </a>
        <button type="button" class="bza__side-toggle" id="gr-side-toggle" aria-label="Collapse sidebar" aria-expanded="true" title="Collapse sidebar">
          ${ICONS.collapse}
        </button>
      </div>
      <div class="bza__nav" role="navigation" aria-label="Primary">
        ${primary}
        <hr class="bza__nav-divider" aria-hidden="true" />
        ${secondary}
      </div>${postCta}
      <label class="bza__darkmode-row" title="Dark mode">
        <span class="bza__nav-icon" aria-hidden="true">${ICON_MOON}</span>
        <span class="bza__nav-label">Dark mode</span>
        <input type="checkbox" id="gr-side-darkmode" class="bza__darkmode-input" />
        <span class="bza__darkmode-switch" aria-hidden="true"></span>
      </label>
      <div class="bza__side-foot">
        <a class="bza__user" id="gr-side-user" href="/profile.html" title="Open your profile">
          <span class="bza__user-avatar" id="gr-side-user-avatar"></span>
          <span class="bza__user-meta">
            <span class="bza__user-name" id="gr-side-user-name">Your account</span>
            <span class="bza__user-role" id="gr-side-user-role"></span>
          </span>
        </a>
        <button type="button" class="bza__logout" id="gr-side-logout">
          <span class="bza__nav-icon" aria-hidden="true">${ICON_LOGOUT}</span>
          <span class="bza__nav-label">Log out</span>
        </button>
      </div>
    </aside>
  `;
}

async function loadProfile() {
  try {
    const { getSupabaseClient } = await import("/supabase-loader.js");
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) return { client, profile: null };
    const { data: profile } = await client
      .from("profiles")
      .select("id, full_name, role, avatar_path")
      .eq("id", session.user.id)
      .single();
    return { client, profile: profile || null };
  } catch {
    return { client: null, profile: null };
  }
}

function applyUserCard(client, profile) {
  const nameEl = document.getElementById("gr-side-user-name");
  const roleEl = document.getElementById("gr-side-user-role");
  const avEl = document.getElementById("gr-side-user-avatar");
  if (nameEl) nameEl.textContent = profile?.full_name || "Your account";
  if (roleEl) roleEl.textContent = profile?.role === "consultant" ? "Consultant" : "Business owner";
  if (avEl) {
    const avatarUrl = client && profile?.avatar_path
      ? client.storage.from("avatars").getPublicUrl(profile.avatar_path).data?.publicUrl || ""
      : "";
    const initial = getInitials(profile?.full_name);
    avEl.innerHTML = avatarUrl ? `<img src="${avatarUrl}" alt="" />` : initial;
  }
}

async function init() {
  // Skip if a page already renders its own .bza__side (e.g. the owner
  // dashboard / consultant dashboard build their sidebar inline so they
  // can wire data-driven badges directly).
  if (document.querySelector("aside.bza__side")) return;

  // Guest mode: the dashboard sidebar links (home, inbox, engagements,
  // notifications, payouts) all lead to pages a guest can't access.
  // guest-nav.js renders a slim top bar instead; we just bail out
  // here so no side nav is injected at all.
  try {
    const { isGuest } = await import("/guest-mode.js");
    if (isGuest()) return;
  } catch (_) {
    // If the import fails for any reason fall through to the normal
    // render — a missing guest module shouldn't break the side nav.
  }

  const main = document.querySelector("body > main");
  if (!main) return;

  const wrap = document.createElement("div");
  wrap.className = "bza gr-bza-shell";
  main.parentNode.insertBefore(wrap, main);
  wrap.appendChild(main);
  if (!main.classList.contains("bza__main")) main.classList.add("bza__main");
  document.body.classList.add("gr-has-side-nav");

  // Resolve the user's role before rendering so the nav items match it
  // on first paint. Previously we rendered the owner layout synchronously
  // and mutated it for consultants, which caused both "marketplace" and
  // "my listings" to flash active for consultants on the marketplace page.
  const { client, profile } = await loadProfile();
  const role = profile?.role || null;
  const activeNavId = inferActiveNavId(role);
  wrap.insertAdjacentHTML("afterbegin", renderSidebar({ role, activeNavId }));

  applyUserCard(client, profile);
  wireToggle();
  wireDarkMode();
  wireLogout();
  wireSubnavToggles();
  wireNotifBadge(client, profile);
}

function setNotifBadge(count) {
  const badge = document.getElementById("gr-side-notif-badge");
  if (!badge) return;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.hidden = count === 0;
  badge.setAttribute("aria-label", `${count} unread`);
}

async function wireNotifBadge(client, profile) {
  if (!client || !profile?.id) return;
  const { loadUnreadNotificationCount } = await import("/nav-notify.js");
  const refresh = async () => setNotifBadge(await loadUnreadNotificationCount(client, profile.id));
  refresh();
  // notifications.js fires this after mark-read / dismiss so the badge
  // drops without a reload.
  window.addEventListener("gr:notifications-changed", refresh);
}

function wireDarkMode() {
  const input = document.getElementById("gr-side-darkmode");
  if (!input || !window.GrassrootsTheme) return;
  const isDark = (t) => t === "dark-forest" || t === "dark" || t === "forest-soft";
  input.checked = isDark(window.GrassrootsTheme.get());
  input.addEventListener("change", () => {
    window.GrassrootsTheme.set(input.checked ? "dark" : "light");
  });
  window.addEventListener("grassroots:themechange", (e) => {
    input.checked = isDark(e.detail || window.GrassrootsTheme.get());
  });
}

function wireLogout() {
  const btn = document.getElementById("gr-side-logout");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    try {
      const { getSupabaseClient } = await import("/supabase-loader.js");
      const client = await getSupabaseClient();
      await client.auth.signOut();
    } catch (err) {
      console.warn("logout failed", err);
    }
    window.location.replace("/signin.html");
  });
}

function wireSubnavToggles() {
  document.querySelectorAll(".bza__nav-toggle").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      const group = btn.closest(".bza__nav-group");
      if (!group) return;
      const open = !group.classList.contains("is-open");
      group.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", String(open));
      try {
        window.localStorage.setItem(ENG_SUBNAV_KEY, open ? "1" : "0");
      } catch {}
    });
  });
}

function wireToggle() {
  const toggle = document.getElementById("gr-side-toggle");
  const wrap = document.querySelector(".bza");
  const edge = document.getElementById("gr-side-edge");
  if (!wrap) return;

  function setCollapsed(collapsed) {
    wrap.classList.toggle("bza--collapsed", collapsed);
    if (toggle) {
      toggle.setAttribute("aria-expanded", String(!collapsed));
      toggle.setAttribute("aria-label", collapsed ? "Expand sidebar" : "Collapse sidebar");
      toggle.setAttribute("title", collapsed ? "Expand sidebar" : "Collapse sidebar");
    }
    try {
      window.localStorage.setItem(COLLAPSE_KEY, collapsed ? "1" : "0");
    } catch {}
  }

  let collapsed = false;
  try {
    collapsed = window.localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {}
  setCollapsed(collapsed);

  function toggleCollapsed() {
    setCollapsed(!wrap.classList.contains("bza--collapsed"));
  }
  toggle?.addEventListener("click", toggleCollapsed);
  edge?.addEventListener("dblclick", toggleCollapsed);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
