// side-nav.js — shared application sidebar.
// Wraps the page's <main> in a .bza grid and injects the standard
// sidebar with a brand link to the landing page, work links pointing
// at dashboard views, and account links to direct pages.
// Skips itself on pages that already render a .bza__side (the
// dashboard injects its own from the loaded data).

const COLLAPSE_KEY = "grassroots_dash_sidebar_collapsed";

const ICONS = {
  dashboard:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/></svg>',
  listings:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><line x1="7" y1="9" x2="17" y2="9"/><line x1="7" y1="13" x2="17" y2="13"/><line x1="7" y1="17" x2="13" y2="17"/></svg>',
  inbox:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11Z"/></svg>',
  engagements:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  archive:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v11a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8"/><line x1="10" y1="13" x2="14" y2="13"/></svg>',
  profile:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l1.5-5h15L21 9"/><path d="M4 9v11a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V9"/><path d="M3 9a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0"/></svg>',
  bell:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  hamburger:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>',
};

const WORK_ITEMS = [
  { view: "dashboard", label: "dashboard", icon: ICONS.dashboard },
  { view: "listings", label: "my listings", icon: ICONS.listings },
  { view: "inbox", label: "inbox", icon: ICONS.inbox },
];

const SYSTEM_ITEMS = [
  { href: "/settings.html", label: "settings", icon: ICONS.gear },
];

const ICON_MOON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>';
const ICON_LOGOUT =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>';

function renderSidebar({ activeView, activeRoute }) {
  const work = WORK_ITEMS.map((it) => {
    const active = activeView === it.view ? " active" : "";
    return `<a href="/dashboard.html#${it.view}" class="bza__nav-item${active}" data-view="${it.view}" data-nav-id="${it.view}" title="${it.label}">
      <span class="bza__nav-icon" aria-hidden="true">${it.icon}</span>
      <span class="bza__nav-label">${it.label}</span>
    </a>`;
  }).join("");
  const renderItem = (it) => {
    const active = activeRoute === it.href ? " active" : "";
    return `<a href="${it.href}" class="bza__nav-item${active}" title="${it.label}">
      <span class="bza__nav-icon" aria-hidden="true">${it.icon}</span>
      <span class="bza__nav-label">${it.label}</span>
    </a>`;
  };
  const system = SYSTEM_ITEMS.map(renderItem).join("");
  return `
    <aside class="bza__side" id="gr-side">
      <div class="bza__side-edge" id="gr-side-edge" aria-hidden="true" title="double-click to toggle"></div>
      <div class="bza__side-head">
        <a class="bza__brand" href="/home/" title="grassroots — home">
          <img class="bza__brand-mark" src="/home/assets/grassroots-icon-syne.svg" width="20" height="34" alt="" />
          <span class="bza__brand-text">grassroots</span>
        </a>
      </div>
      <div class="bza__nav-section">work</div>
      ${work}
      <div class="bza__nav-section">system</div>
      ${system}
      <label class="bza__nav-item bza__darkmode" title="dark mode">
        <span class="bza__nav-icon" aria-hidden="true">${ICON_MOON}</span>
        <span class="bza__nav-label">dark mode</span>
        <input type="checkbox" id="gr-side-darkmode" class="bza__darkmode-input" />
        <span class="bza__darkmode-switch" aria-hidden="true"></span>
      </label>

      <a href="/create-listing.html" class="bza__post" id="gr-side-post" title="post a listing">
        <span class="bza__nav-icon" aria-hidden="true">${ICONS.plus}</span>
        <span class="bza__nav-label">post a listing</span>
      </a>

      <div class="bza__side-foot">
        <a class="bza__user" id="gr-side-user" href="/profile.html" title="open profile settings">
          <span class="bza__user-avatar" id="gr-side-user-avatar"></span>
          <span class="bza__user-meta">
            <span class="bza__user-name" id="gr-side-user-name">your account</span>
            <span class="bza__user-role" id="gr-side-user-role"></span>
          </span>
        </a>
        <button type="button" class="bza__logout" id="gr-side-logout">
          <span class="bza__nav-icon" aria-hidden="true">${ICON_LOGOUT}</span>
          <span class="bza__nav-label">log out</span>
        </button>
      </div>
    </aside>
  `;
}

async function hydrateUser() {
  try {
    const { getSupabaseClient } = await import("/supabase-loader.js");
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) return { client: null };
    const { data: profile } = await client
      .from("profiles")
      .select("id, full_name, role, avatar_path")
      .eq("id", session.user.id)
      .single();
    const avatarUrl = profile?.avatar_path
      ? client.storage.from("avatars").getPublicUrl(profile.avatar_path).data?.publicUrl || ""
      : "";
    const nameEl = document.getElementById("gr-side-user-name");
    const roleEl = document.getElementById("gr-side-user-role");
    const avEl = document.getElementById("gr-side-user-avatar");
    if (nameEl) nameEl.textContent = profile?.full_name || "your account";
    if (roleEl) roleEl.textContent = profile?.role === "consultant" ? "consultant" : "business owner";
    if (avEl) {
      const initial = (profile?.full_name || "?").charAt(0).toUpperCase() || "?";
      avEl.innerHTML = avatarUrl ? `<img src="${avatarUrl}" alt="" />` : initial;
    }

    // Consultant adjustments: no "post a listing" CTA, and the dashboard link
    // becomes a "marketplace" link pointing at "/" since consultants browse
    // and bid on the marketplace rather than running a dashboard.
    if (profile?.role === "consultant") {
      const post = document.getElementById("gr-side-post");
      if (post) post.hidden = true;
      const dash = document.querySelector('[data-nav-id="dashboard"]');
      if (dash) {
        dash.setAttribute("href", "/");
        dash.setAttribute("title", "marketplace");
        const label = dash.querySelector(".bza__nav-label");
        if (label) label.textContent = "marketplace";
        dash.removeAttribute("data-view");
        const path = window.location.pathname;
        dash.classList.toggle("active", path === "/" || path === "/index.html");
      }
    }
    return { client };
  } catch {
    return { client: null };
  }
}

function inferActiveView() {
  const path = window.location.pathname;
  if (path === "/dashboard.html" || path === "/dashboard") {
    const hash = window.location.hash.replace("#", "");
    return hash || "dashboard";
  }
  if (path === "/" || path === "/index.html") return "listings";
  return null;
}

function init() {
  // Skip if a page already renders its own .bza__side (e.g. the dashboard
  // builds its sidebar inline so it can wire data-driven badges directly).
  if (document.querySelector("aside.bza__side")) return;

  const main = document.querySelector("body > main");
  if (!main) return;

  const wrap = document.createElement("div");
  wrap.className = "bza gr-bza-shell";
  main.parentNode.insertBefore(wrap, main);
  const activeView = inferActiveView();
  const activeRoute = window.location.pathname;
  wrap.insertAdjacentHTML("afterbegin", renderSidebar({ activeView, activeRoute }));
  wrap.appendChild(main);
  if (!main.classList.contains("bza__main")) main.classList.add("bza__main");
  document.body.classList.add("gr-has-side-nav");

  wireToggle();
  wireDarkMode();
  wireLogout();
  hydrateUser();
}

function wireDarkMode() {
  const input = document.getElementById("gr-side-darkmode");
  if (!input || !window.GrassrootsTheme) return;
  const isDark = (t) => t === "dark-forest" || t === "dark" || t === "forest-soft";
  input.checked = isDark(window.GrassrootsTheme.get());
  input.addEventListener("change", () => {
    window.GrassrootsTheme.set(input.checked ? "dark-forest" : "light");
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
    window.location.replace("/");
  });
}

function wireToggle() {
  const toggle = document.getElementById("gr-side-toggle");
  const wrap = document.querySelector(".bza");
  const edge = document.getElementById("gr-side-edge");
  if (!toggle || !wrap) return;

  function setCollapsed(collapsed) {
    wrap.classList.toggle("bza--collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
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
  toggle.addEventListener("click", toggleCollapsed);
  edge?.addEventListener("dblclick", toggleCollapsed);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
