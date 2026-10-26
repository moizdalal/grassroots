// admin.js — controller for the admin page. Tabs across overview /
// users / engagements / calendar. Today every renderX() reads from
// fixtures.js (seeded fake data); when the page gets wired to live
// data, each export it imports gets swapped for a supabase query
// that returns the same shape.
//
// Access control: page is signed-in-only AND the user's email must
// be in ADMIN_EMAILS below. For production, replace the allow-list
// with an `is_admin` flag on the profiles table and check it via a
// server-side endpoint instead of in the browser.

import { getSupabaseClient } from "/supabase-loader.js";

import {
  data,
  totalUsers, totalListings, totalEngagements, activeEngagements,
  totalBids, openListings,
  totalVolumeCents, bidAcceptanceRate, avgEngagementValueCents, kickoffsThisWeek,
  moneyMovedSeries, funnelData, engagementStatusBreakdown, offersByCategory,
  topConsultants, recentActivity, upcomingKickoffs, allKickoffs, userStats,
  userGrowthByWeek,
} from "./fixtures.js";

import {
  renderLineChart, renderBarChart, renderDonut, renderFunnel, renderGroupedBars,
} from "./charts.js";

import { mountCalendar } from "./calendar.js";

/* ============================================================== */
/*                          ADMIN AUTH GATE                        */
/* ============================================================== */

// Emails allowed to view the admin page. Add/remove entries here to
// grant or revoke access. Matching is case-insensitive.
const ADMIN_EMAILS = new Set([
  "moizdalal@ufl.edu",
]);

async function gateAdminAccess() {
  const gate = document.getElementById("adm-gate");
  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
      window.location.replace("/signin.html?next=" + encodeURIComponent("/admin/"));
      return false;
    }
    const email = (session.user.email || "").toLowerCase();
    if (!ADMIN_EMAILS.has(email)) {
      if (gate) {
        gate.className = "adm-gate adm-gate--error";
        gate.textContent = "Your account doesn't have admin access.";
      }
      // Hold the message a beat, then route home so the user isn't stranded.
      setTimeout(() => window.location.replace("/"), 1400);
      return false;
    }
    return true;
  } catch (err) {
    if (gate) {
      gate.className = "adm-gate adm-gate--error";
      gate.textContent = "Could not verify admin access: " + (err.message || "Config error");
    }
    return false;
  }
}

// Top-level await halts module evaluation on failure. The throw stops
// the rest of this file (DOM queries, listener wiring, initial render)
// from running before window.location.replace navigates away.
if (!(await gateAdminAccess())) {
  throw new Error("Admin: access denied");
}

document.getElementById("adm-gate").hidden = true;
document.getElementById("adm-shell").hidden = false;

/* ============================================================== */
/*                            UTILITIES                            */
/* ============================================================== */

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoney(cents) {
  if (cents == null) return "—";
  return "$" + Math.round(cents / 100).toLocaleString();
}

function fmtMoneyShort(cents) {
  const d = cents / 100;
  if (d >= 1_000_000) return "$" + (d / 1_000_000).toFixed(1) + "m";
  if (d >= 1_000) return "$" + (d / 1_000).toFixed(1) + "k";
  return "$" + Math.round(d);
}

function fmtPct(n) {
  return Math.round(n * 100) + "%";
}

function fmtDate(d) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function fmtDateTime(d) {
  if (!d) return "—";
  return new Date(d).toLocaleString(undefined, {
    month: "short", day: "numeric",
    hour: "numeric", minute: "2-digit",
  });
}

function fmtRel(d) {
  if (!d) return "—";
  const ms = data.now - d;
  const min = Math.floor(ms / 60000);
  if (min < 1) return "Just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.floor(day / 30);
  return `${mo}mo ago`;
}

function initials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || "?";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarMarkup(user, size = "sm") {
  const hue = user?.hue ?? 200;
  return `
    <span class="adm-avatar adm-avatar--${size}" style="background: hsl(${hue} 30% 38%); color: hsl(${hue} 30% 95%);">
      ${esc(initials(user?.name || ""))}
    </span>
  `;
}

function statusPill(stage) {
  const map = {
    1: { label: "Offer submitted", mod: "pending" },
    2: { label: "Offer accepted", mod: "accepted" },
    3: { label: "Kickoff scheduled", mod: "accepted" },
    4: { label: "Work delivered", mod: "muted" },
    5: { label: "Payout released", mod: "accepted" },
  };
  const m = map[stage] || { label: "—", mod: "muted" };
  return `<span class="adm-pill adm-pill--${m.mod}">${esc(m.label)}</span>`;
}

function rolePill(role) {
  const label = role === "consultant" ? "Consultant" : "Business owner";
  return `<span class="adm-pill adm-pill--${role === "consultant" ? "accepted" : "warn"} adm-pill--soft">${label}</span>`;
}

/* ============================================================== */
/*                              TABS                               */
/* ============================================================== */

const tabs = document.querySelectorAll(".adm-nav__item");
const sections = document.querySelectorAll(".adm-section");

function activateTab(name) {
  tabs.forEach((t) => t.classList.toggle("is-active", t.dataset.tab === name));
  sections.forEach((s) => { s.hidden = s.dataset.section !== name; });
  const url = new URL(location.href);
  url.searchParams.set("tab", name);
  history.replaceState({}, "", url);

  // Lazy render the section on first activation.
  switch (name) {
    case "overview": renderOverview(); break;
    case "users": renderUsersTable(); break;
    case "engagements": renderEngagementsTable(); break;
    case "calendar": renderCalendar(); break;
    case "health": renderHealth(); break;
    case "payments":
      import("./payments.js")
        .then((m) => m.renderPayments())
        .catch((err) => console.warn("payments tab failed to load", err));
      break;
  }
}

tabs.forEach((t) => t.addEventListener("click", () => activateTab(t.dataset.tab)));

const initialTab = new URL(location.href).searchParams.get("tab") || "overview";
activateTab(initialTab);

/* ============================================================== */
/*                            OVERVIEW                             */
/* ============================================================== */

let moneyRange = "month";
let overviewRendered = false;

function renderOverview() {
  renderKpis();
  renderMoneyChart();
  renderFunnelChart();
  renderStatusDonut();
  renderCategoryChart();
  renderGrowthChart();
  renderTopList();
  renderActivityFeed();
  renderUpcomingTile();

  if (overviewRendered) return;
  overviewRendered = true;

  document.querySelectorAll(".adm-range__btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      moneyRange = btn.dataset.range;
      document.querySelectorAll(".adm-range__btn").forEach((b) =>
        b.classList.toggle("is-active", b.dataset.range === moneyRange));
      renderMoneyChart();
    });
  });
}

function renderKpis() {
  const host = document.getElementById("adm-kpis");
  const rangeDays = moneyRange === "day" ? 1
                  : moneyRange === "week" ? 7
                  : moneyRange === "month" ? 30
                  : null; // ytd
  const vol = totalVolumeCents(rangeDays);
  const tiles = [
    { label: "Users", value: totalUsers(), sub: `${data.consultants.length} consultants · ${data.owners.length} owners` },
    { label: "Active engagements", value: activeEngagements(), sub: `${totalEngagements()} total to date` },
    { label: `Volume (${moneyRange === "ytd" ? "YTD" : moneyRange})`, value: fmtMoneyShort(vol), sub: "Released payouts" },
    { label: "Offer acceptance rate", value: fmtPct(bidAcceptanceRate()), sub: `${totalBids()} offers submitted` },
    { label: "Avg engagement value", value: fmtMoneyShort(avgEngagementValueCents()), sub: `${openListings()} listings open now` },
    { label: "Kickoffs this week", value: kickoffsThisWeek().length, sub: `${upcomingKickoffs().length} upcoming overall` },
  ];
  host.innerHTML = tiles.map((t) => `
    <div class="adm-kpi">
      <div class="adm-kpi__label">${esc(t.label)}</div>
      <div class="adm-kpi__value">${esc(String(t.value))}</div>
      <div class="adm-kpi__sub">${esc(t.sub)}</div>
    </div>
  `).join("");
}

function renderMoneyChart() {
  const host = document.getElementById("adm-money-chart");
  renderLineChart(host, moneyMovedSeries(moneyRange), { ariaLabel: "Money moved over time" });
  // KPI tiles depend on the active range too.
  renderKpis();
}

function renderFunnelChart() {
  const host = document.getElementById("adm-funnel");
  renderFunnel(host, funnelData());
}

function renderStatusDonut() {
  const host = document.getElementById("adm-status-donut");
  const segments = engagementStatusBreakdown();
  renderDonut(host, segments, {
    ariaLabel: "Engagements by stage",
    centerLabel: segments.reduce((s, r) => s + r.value, 0),
    centerSub: "engagements",
  });
}

function renderCategoryChart() {
  const host = document.getElementById("adm-category-chart");
  const rows = offersByCategory().sort((a, b) => b.avg_per_listing - a.avg_per_listing);
  renderBarChart(host, rows.map((r) => ({ label: r.category, value: r.avg_per_listing })), {
    ariaLabel: "Average offers per listing by category",
    tickFmt: (v) => v.toFixed(1),
    valFmt: (v) => v.toFixed(1),
  });
}

function renderGrowthChart() {
  const host = document.getElementById("adm-growth-chart");
  renderGroupedBars(host, userGrowthByWeek(10));
}

function renderTopList() {
  const host = document.getElementById("adm-top-list");
  const rows = topConsultants(7);
  if (!rows.length) {
    host.innerHTML = `<p class="adm-muted">No released payouts yet.</p>`;
    return;
  }
  host.innerHTML = rows.map((row, i) => `
    <li class="adm-top-row">
      <span class="adm-top-rank">${i + 1}</span>
      ${avatarMarkup(row.user)}
      <div class="adm-top-meta">
        <span class="adm-top-name">${esc(row.user.name)}</span>
        <span class="adm-top-sub">${esc(row.user.school || row.user.business_type || "")}</span>
      </div>
      <span class="adm-top-value">${fmtMoneyShort(row.cents)}</span>
    </li>
  `).join("");
}

function renderActivityFeed() {
  const host = document.getElementById("adm-activity-feed");
  const items = recentActivity(10);
  host.innerHTML = items.map((it) => `
    <li class="adm-activity-row">
      <span class="adm-activity-icon adm-activity-icon--${it.icon}" aria-hidden="true">${activityIcon(it.icon)}</span>
      <span class="adm-activity-label">${esc(it.label)}</span>
      <span class="adm-activity-time">${esc(fmtRel(it.at))}</span>
    </li>
  `).join("");
}

function activityIcon(kind) {
  if (kind === "listing") return svgIcon("clipboard");
  if (kind === "bid") return svgIcon("hand");
  if (kind === "payout") return svgIcon("dollar");
  if (kind === "kickoff") return svgIcon("calendar");
  return svgIcon("dot");
}

function svgIcon(name) {
  const map = {
    clipboard: '<rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 3h6v3H9z"/>',
    hand: '<path d="M7 11V6a2 2 0 0 1 4 0v5"/><path d="M11 11V4a2 2 0 0 1 4 0v7"/><path d="M15 11V6a2 2 0 0 1 4 0v8a6 6 0 0 1-6 6h-2a4 4 0 0 1-4-4v-3l-3-3"/>',
    dollar: '<line x1="12" y1="2" x2="12" y2="22"/><path d="M17 7H9a3 3 0 0 0 0 6h6a3 3 0 0 1 0 6H7"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="3" x2="8" y2="7"/><line x1="16" y1="3" x2="16" y2="7"/>',
    dot: '<circle cx="12" cy="12" r="4"/>',
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${map[name] || map.dot}</svg>`;
}

function renderUpcomingTile() {
  const host = document.getElementById("adm-upcoming-list");
  const items = upcomingKickoffs().slice(0, 6);
  if (!items.length) {
    host.innerHTML = `<p class="adm-muted">No upcoming kickoffs scheduled.</p>`;
    return;
  }
  host.innerHTML = items.map((e) => `
    <li class="adm-up-row" data-engagement-id="${esc(e.id)}">
      <div class="adm-up-date">
        <span class="adm-up-mo">${new Date(e.kickoff_at).toLocaleDateString(undefined, { month: "short" })}</span>
        <span class="adm-up-day">${new Date(e.kickoff_at).getDate()}</span>
      </div>
      <div class="adm-up-meta">
        <span class="adm-up-title">${esc(e.listing_title)}</span>
        <span class="adm-up-sub">${esc(e.consultant_name)} × ${esc(e.owner_name)} · ${esc(fmtDateTime(e.kickoff_at))}</span>
      </div>
      <span class="adm-up-value">${fmtMoneyShort(e.amount_cents)}</span>
    </li>
  `).join("");
  host.querySelectorAll(".adm-up-row").forEach((row) => {
    row.addEventListener("click", () => openEngagementDrawer(row.dataset.engagementId));
  });
}

/* ============================================================== */
/*                              USERS                              */
/* ============================================================== */

let userFilter = "all";
let userQuery = "";

function renderUsersTable() {
  const host = document.getElementById("adm-users-tbody");
  let rows = data.users.slice();
  if (userFilter !== "all") rows = rows.filter((u) => u.role === userFilter);
  if (userQuery) {
    const q = userQuery.toLowerCase();
    rows = rows.filter((u) =>
      u.name.toLowerCase().includes(q) ||
      (u.business_name || "").toLowerCase().includes(q) ||
      (u.school || "").toLowerCase().includes(q) ||
      (u.city || "").toLowerCase().includes(q),
    );
  }
  rows.sort((a, b) => b.joined_at - a.joined_at);

  document.getElementById("adm-users-count").textContent = `${rows.length} ${rows.length === 1 ? "person" : "people"}`;

  if (!rows.length) {
    host.innerHTML = `<tr><td colspan="6" class="adm-table-empty">No matches.</td></tr>`;
    return;
  }
  host.innerHTML = rows.map((u) => {
    const s = userStats(u.id);
    return `
      <tr class="adm-tr" data-user-id="${esc(u.id)}">
        <td>
          <div class="adm-cell-user">
            ${avatarMarkup(u)}
            <div>
              <div class="adm-cell-name">${esc(u.name)}</div>
              <div class="adm-cell-sub">${esc(u.business_name || u.school || "")}</div>
            </div>
          </div>
        </td>
        <td>${rolePill(u.role)}</td>
        <td>${esc(u.city || "—")}</td>
        <td>${esc(fmtDate(u.joined_at))}</td>
        <td>${s.count}</td>
        <td class="adm-cell-money">${fmtMoneyShort(s.total_cents)}</td>
      </tr>
    `;
  }).join("");
  host.querySelectorAll(".adm-tr").forEach((tr) => {
    tr.addEventListener("click", () => openUserDrawer(tr.dataset.userId));
  });
}

document.getElementById("adm-users-search")?.addEventListener("input", (e) => {
  userQuery = e.target.value.trim();
  renderUsersTable();
});

document.querySelectorAll('[data-role-filter]')?.forEach((btn) => {
  btn.addEventListener("click", () => {
    userFilter = btn.dataset.roleFilter;
    document.querySelectorAll('[data-role-filter]').forEach((b) =>
      b.classList.toggle("is-active", b.dataset.roleFilter === userFilter));
    renderUsersTable();
  });
});

/* ============================================================== */
/*                          ENGAGEMENTS                            */
/* ============================================================== */

let engStageFilter = "all";
let engQuery = "";

function renderEngagementsTable() {
  const host = document.getElementById("adm-eng-tbody");
  let rows = data.engagements.slice();
  if (engStageFilter !== "all") {
    rows = rows.filter((e) => String(e.stage) === engStageFilter);
  }
  if (engQuery) {
    const q = engQuery.toLowerCase();
    rows = rows.filter((e) =>
      e.listing_title.toLowerCase().includes(q) ||
      e.consultant_name.toLowerCase().includes(q) ||
      e.owner_name.toLowerCase().includes(q) ||
      e.listing_category.toLowerCase().includes(q),
    );
  }
  rows.sort((a, b) => b.created_at - a.created_at);

  document.getElementById("adm-eng-count").textContent = `${rows.length} engagement${rows.length === 1 ? "" : "s"}`;

  if (!rows.length) {
    host.innerHTML = `<tr><td colspan="6" class="adm-table-empty">No matches.</td></tr>`;
    return;
  }
  host.innerHTML = rows.map((e) => `
    <tr class="adm-tr" data-engagement-id="${esc(e.id)}">
      <td>
        <div class="adm-cell-listing">
          <div class="adm-cell-name">${esc(e.listing_title)}</div>
          <div class="adm-cell-sub">${esc(e.listing_category)} · ${esc(e.contract_type)}</div>
        </div>
      </td>
      <td>${esc(e.owner_name)}</td>
      <td>${esc(e.consultant_name)}</td>
      <td>${statusPill(e.stage)}</td>
      <td>${esc(fmtDate(e.kickoff_at))}</td>
      <td class="adm-cell-money">${fmtMoneyShort(e.amount_cents)}</td>
    </tr>
  `).join("");
  host.querySelectorAll(".adm-tr").forEach((tr) => {
    tr.addEventListener("click", () => openEngagementDrawer(tr.dataset.engagementId));
  });
}

document.getElementById("adm-eng-search")?.addEventListener("input", (e) => {
  engQuery = e.target.value.trim();
  renderEngagementsTable();
});

document.querySelectorAll('[data-stage-filter]')?.forEach((btn) => {
  btn.addEventListener("click", () => {
    engStageFilter = btn.dataset.stageFilter;
    document.querySelectorAll('[data-stage-filter]').forEach((b) =>
      b.classList.toggle("is-active", b.dataset.stageFilter === engStageFilter));
    renderEngagementsTable();
  });
});

/* ============================================================== */
/*                            CALENDAR                             */
/* ============================================================== */

function renderCalendar() {
  const host = document.getElementById("adm-cal-host");
  const events = allKickoffs().map((e) => ({
    date: e.kickoff_at,
    title: e.listing_title,
    sub: `${e.consultant_name} × ${e.owner_name}`,
    color: e.stage >= 4 ? "var(--fo-text-3)" : e.stage >= 3 ? "var(--fo-accent)" : "var(--fo-accent-warm)",
    payload: e,
  }));
  mountCalendar(host, {
    events,
    today: data.now,
    onSelect: (day, dayEvents) => renderCalSidePanel(day, dayEvents),
  });
  // Default: show today's events on first render.
  renderCalSidePanel(data.now, events.filter((e) =>
    e.date.toDateString() === data.now.toDateString()));
}

function renderCalSidePanel(day, dayEvents) {
  const host = document.getElementById("adm-cal-side");
  const dayLabel = day.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
  if (!dayEvents.length) {
    host.innerHTML = `
      <h3 class="adm-cal-side__title">${esc(dayLabel)}</h3>
      <p class="adm-muted">No kickoffs on this day.</p>
    `;
    return;
  }
  host.innerHTML = `
    <h3 class="adm-cal-side__title">${esc(dayLabel)}</h3>
    <p class="adm-cal-side__count">${dayEvents.length} kickoff${dayEvents.length === 1 ? "" : "s"}</p>
    <ul class="adm-cal-list">
      ${dayEvents.map((ev) => `
        <li class="adm-cal-event" data-engagement-id="${esc(ev.payload.id)}">
          <span class="adm-cal-event__dot" style="background:${ev.color}"></span>
          <div class="adm-cal-event__meta">
            <span class="adm-cal-event__title">${esc(ev.title)}</span>
            <span class="adm-cal-event__sub">${esc(ev.sub)}</span>
            <span class="adm-cal-event__time">${esc(ev.date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }))}</span>
          </div>
        </li>
      `).join("")}
    </ul>
  `;
  host.querySelectorAll(".adm-cal-event").forEach((row) => {
    row.addEventListener("click", () => openEngagementDrawer(row.dataset.engagementId));
  });
}

/* ============================================================== */
/*                            DRAWER                               */
/* ============================================================== */

const drawer = document.getElementById("adm-drawer");
const drawerBody = document.getElementById("adm-drawer-body");
const drawerTitle = document.getElementById("adm-drawer-title");

function openDrawer(title, html) {
  drawerTitle.textContent = title;
  drawerBody.innerHTML = html;
  drawer.classList.add("is-open");
  drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  drawer.classList.remove("is-open");
  drawer.setAttribute("aria-hidden", "true");
}

document.getElementById("adm-drawer-close").addEventListener("click", closeDrawer);
document.getElementById("adm-drawer-backdrop").addEventListener("click", closeDrawer);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawer.classList.contains("is-open")) closeDrawer();
});

function openUserDrawer(userId) {
  const user = data.users.find((u) => u.id === userId);
  if (!user) return;
  const stats = userStats(userId);
  const userEngagements = data.engagements
    .filter((e) => e.consultant_id === userId || e.owner_id === userId)
    .sort((a, b) => b.created_at - a.created_at);
  const userListings = data.listings.filter((l) => l.owner_id === userId);
  const userBids = data.bids.filter((b) => b.consultant_id === userId);

  const html = `
    <div class="adm-drawer-head">
      ${avatarMarkup(user, "lg")}
      <div>
        <div class="adm-drawer-name">${esc(user.name)}</div>
        <div class="adm-drawer-sub">${rolePill(user.role)} · joined ${esc(fmtDate(user.joined_at))}</div>
      </div>
    </div>
    <dl class="adm-defs">
      ${user.business_name ? `<div><dt>Business</dt><dd>${esc(user.business_name)}</dd></div>` : ""}
      ${user.business_type ? `<div><dt>Type</dt><dd>${esc(user.business_type)}</dd></div>` : ""}
      ${user.school ? `<div><dt>School</dt><dd>${esc(user.school)}</dd></div>` : ""}
      ${user.major ? `<div><dt>Major</dt><dd>${esc(user.major)}</dd></div>` : ""}
      ${user.city ? `<div><dt>City</dt><dd>${esc(user.city)}</dd></div>` : ""}
      ${user.rating ? `<div><dt>Rating</dt><dd>${user.rating.toFixed(1)} / 5</dd></div>` : ""}
      <div><dt>Engagements</dt><dd>${stats.count}</dd></div>
      <div><dt>Total released</dt><dd>${fmtMoneyShort(stats.total_cents)}</dd></div>
      ${userListings.length ? `<div><dt>Listings posted</dt><dd>${userListings.length}</dd></div>` : ""}
      ${userBids.length ? `<div><dt>Offers submitted</dt><dd>${userBids.length}</dd></div>` : ""}
    </dl>
    ${userEngagements.length ? `
      <h4 class="adm-drawer-sec">Engagements</h4>
      <ul class="adm-drawer-list">
        ${userEngagements.slice(0, 12).map((e) => `
          <li class="adm-drawer-row" data-engagement-id="${esc(e.id)}">
            <div>
              <div class="adm-drawer-row__title">${esc(e.listing_title)}</div>
              <div class="adm-drawer-row__sub">${esc(e.consultant_name)} × ${esc(e.owner_name)} · ${esc(e.stage_label)}</div>
            </div>
            <span class="adm-drawer-row__money">${fmtMoneyShort(e.amount_cents)}</span>
          </li>
        `).join("")}
      </ul>
    ` : ""}
  `;
  openDrawer(user.name, html);
  drawerBody.querySelectorAll(".adm-drawer-row").forEach((row) => {
    row.addEventListener("click", () => openEngagementDrawer(row.dataset.engagementId));
  });
}

function openEngagementDrawer(engId) {
  const e = data.engagements.find((x) => x.id === engId);
  if (!e) return;
  const listing = data.listings.find((l) => l.id === e.listing_id);
  const consultant = data.users.find((u) => u.id === e.consultant_id);
  const owner = data.users.find((u) => u.id === e.owner_id);
  const competingBids = data.bids.filter((b) => b.listing_id === e.listing_id);

  const html = `
    <div class="adm-drawer-head adm-drawer-head--engagement">
      <div>
        <div class="adm-drawer-name">${esc(e.listing_title)}</div>
        <div class="adm-drawer-sub">${statusPill(e.stage)} · ${esc(e.listing_category)} · ${esc(e.contract_type)}</div>
      </div>
      <div class="adm-drawer-amount">${fmtMoney(e.amount_cents)}</div>
    </div>
    <div class="adm-pair">
      <div class="adm-pair-col">
        <div class="adm-pair-head">Consultant</div>
        <div class="adm-pair-body" data-user-id="${esc(consultant?.id || "")}">
          ${avatarMarkup(consultant, "md")}
          <div>
            <div class="adm-pair-name">${esc(consultant?.name || "—")}</div>
            <div class="adm-pair-sub">${esc(consultant?.school || "")}${consultant?.major ? " · " + esc(consultant.major) : ""}</div>
          </div>
        </div>
      </div>
      <div class="adm-pair-col">
        <div class="adm-pair-head">Business</div>
        <div class="adm-pair-body" data-user-id="${esc(owner?.id || "")}">
          ${avatarMarkup(owner, "md")}
          <div>
            <div class="adm-pair-name">${esc(owner?.business_name || owner?.name || "—")}</div>
            <div class="adm-pair-sub">${esc(owner?.city || "")}</div>
          </div>
        </div>
      </div>
    </div>
    <dl class="adm-defs">
      <div><dt>Created</dt><dd>${esc(fmtDate(e.created_at))}</dd></div>
      <div><dt>Kickoff</dt><dd>${esc(fmtDateTime(e.kickoff_at))}</dd></div>
      <div><dt>Delivered</dt><dd>${esc(fmtDate(e.completed_at))}</dd></div>
      <div><dt>Payout released</dt><dd>${esc(fmtDate(e.released_at))}</dd></div>
      <div><dt>Payment</dt><dd>${esc(capFirst(e.payment_status))}</dd></div>
    </dl>
    <h4 class="adm-drawer-sec">Listing</h4>
    <dl class="adm-defs">
      <div><dt>Posted</dt><dd>${esc(fmtDate(listing?.created_at))}</dd></div>
      <div><dt>Budget range</dt><dd>${fmtMoneyShort(listing?.budget_min_cents)} – ${fmtMoneyShort(listing?.budget_max_cents)}</dd></div>
      <div><dt>Turnaround</dt><dd>${listing?.turnaround_days} days</dd></div>
      <div><dt>Listing status</dt><dd>${esc(capFirst(listing?.status))}</dd></div>
    </dl>
    <h4 class="adm-drawer-sec">Offers on this listing (${competingBids.length})</h4>
    <ul class="adm-drawer-list">
      ${competingBids.map((b) => `
        <li class="adm-drawer-row">
          <div>
            <div class="adm-drawer-row__title">${esc(b.consultant_name)}</div>
            <div class="adm-drawer-row__sub">${esc(b.status)} · ${esc(fmtRel(b.submitted_at))}</div>
          </div>
          <span class="adm-drawer-row__money">${fmtMoneyShort(b.amount_cents)}</span>
        </li>
      `).join("")}
    </ul>
  `;
  openDrawer("engagement", html);
  // Wire the consultant/business pair cards to open user drawers.
  drawerBody.querySelectorAll(".adm-pair-body").forEach((card) => {
    if (!card.dataset.userId) return;
    card.style.cursor = "pointer";
    card.addEventListener("click", () => openUserDrawer(card.dataset.userId));
  });
}

/* ============================================================== */
/*                         HEADER STAMP                            */
/* ============================================================== */

document.getElementById("adm-now-stamp").textContent =
  data.now.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

/* ============================================================== */
/*                            HEALTH                               */
/* ============================================================== */
/* Live perf + business KPIs. Unlike the rest of the admin (which
   reads from fixtures.js), this tab fetches real data from
   /api/admin/health-summary on every activation. The endpoint is
   admin-gated server-side so an unauthorized fetch returns 403.   */

let healthRangeDays = 7;
let healthInFlight = null;

const healthRangeButtons = document.querySelectorAll("[data-health-range]");
healthRangeButtons.forEach((b) => {
  b.addEventListener("click", () => {
    healthRangeDays = Number(b.dataset.healthRange) || 7;
    healthRangeButtons.forEach((x) => x.classList.toggle("is-active", x === b));
    renderHealth(true);
  });
});

async function renderHealth(force) {
  const loading = document.getElementById("adm-health-loading");
  const errorEl = document.getElementById("adm-health-error");
  const body = document.getElementById("adm-health-body");
  if (!loading || !body) return;

  // Avoid clobbering an in-flight fetch (e.g. user double-clicks range).
  if (healthInFlight && !force) return;

  loading.hidden = false;
  errorEl.hidden = true;

  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) throw new Error("Not signed in");

    healthInFlight = fetch("/api/admin/health-summary", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ days: healthRangeDays }),
    });
    const res = await healthInFlight;
    healthInFlight = null;

    if (!res.ok) {
      const msg = res.status === 403 ? "You're not on the admin allow-list." : `Request failed (${res.status}).`;
      throw new Error(msg);
    }
    const summary = await res.json();
    drawHealth(summary);
    loading.hidden = true;
    body.hidden = false;
  } catch (err) {
    healthInFlight = null;
    loading.hidden = true;
    body.hidden = true;
    errorEl.textContent = err.message || "Could not load health.";
    errorEl.hidden = false;
  }
}

function drawHealth(summary) {
  drawBusinessTiles(summary.business);
  drawConversion(summary.business);
  drawMoney(summary.business);
  drawPerfTiles(summary.perf);
  drawTrendChart(summary.perf.daily_trend);
  drawRouteTable(summary.perf.by_route);
  drawSlowestTable(summary.perf.slowest);
  drawPerfSub(summary.perf.overall, summary.window_days);
}

function drawBusinessTiles(b) {
  const host = document.getElementById("adm-health-business-tiles");
  if (!host) return;
  const ttfbHours = b.activity.median_time_to_first_bid_ms
    ? (b.activity.median_time_to_first_bid_ms / 3600000).toFixed(1) + "h"
    : "—";
  const tiles = [
    {
      label: "new sign-ups",
      value: b.signups.total,
      sub: `${b.signups.consultants} consultants · ${b.signups.owners} owners`,
      explain: "Top of the funnel. If this number isn't growing, growth is stalled. Watch the split — too few of one role starves the other side of the marketplace.",
    },
    {
      label: "New listings",
      value: b.activity.new_listings,
      sub: `${b.activity.active_listings} open right now`,
      explain: "Supply side — how much work businesses are putting up. Few new listings means consultants have nothing to bid on.",
    },
    {
      label: "New offers",
      value: b.activity.new_bids,
      sub: `${b.activity.in_progress_engagements} engagements in progress`,
      explain: "demand side — how actively consultants are engaging with what's on the marketplace. lots of listings but few offers = your matching isn't working.",
    },
    {
      label: "Median time to first offer",
      value: ttfbHours,
      sub: "From listing posted → first bid",
      explain: "How fast the marketplace responds when a business posts work. Long waits make owners feel like nobody's home.",
    },
  ];
  host.innerHTML = tiles.map(tileHtml).join("");
}

function drawConversion(b) {
  const host = document.getElementById("adm-health-conversion");
  if (!host) return;
  const rows = [
    {
      label: "Owners who signed up & posted a listing",
      value: b.conversion.owner_signup_to_first_listing_pct,
      sub: "In the window",
      explain: "of business owners who joined this window, how many actually got around to posting work. low % = your onboarding for businesses is leaking — people sign up but never start.",
    },
    {
      label: "Consultants who signed up & submitted a bid",
      value: b.conversion.consultant_signup_to_first_bid_pct,
      sub: "In the window",
      explain: "of consultants who joined this window, how many actually bid on something. low % = they're browsing but not engaging — usually a pricing or qualification clarity issue.",
    },
    {
      label: "Listings posted & got at least one bid",
      value: b.conversion.listing_to_first_bid_pct,
      sub: "In the window",
      explain: "how many of the posted listings attracted any interest at all. low % = pricing too low, scope unclear, or briefs feel scary to consultants.",
    },
    {
      label: "Bids submitted & accepted",
      value: b.conversion.bid_acceptance_pct,
      sub: "Of bids in the window",
      explain: "Of all proposals submitted, how many businesses said yes to. Healthy is 5-15% (means owners have real choice). 100% means consultants aren't competing enough.",
    },
  ];
  host.innerHTML = `
    <ul class="adm-health-funnel">
      ${rows.map((r) => `
        <li class="adm-health-funnel__row">
          <div class="adm-health-funnel__label">
            <strong>
              ${esc(r.label)}
              ${infoBtnHtml(r.explain)}
            </strong>
            <span>${esc(r.sub)}</span>
          </div>
          <div class="adm-health-funnel__value">${formatPct(r.value)}</div>
        </li>
      `).join("")}
    </ul>
  `;
}

function drawMoney(b) {
  const host = document.getElementById("adm-health-money");
  if (!host) return;
  const escrowExplain = "Money sitting in your Stripe escrow account, waiting for businesses to approve their work. You're responsible for it until it's released. This number grows when owners pay and shrinks when consultants get paid out.";
  const releasedExplain = "Money you've actually delivered to consultants this window. Think of this as your 'value delivered' number — work approved, paid, done. It's the most concrete signal that the marketplace is functioning end-to-end.";
  host.innerHTML = `
    <div class="adm-health-money-stack">
      <div>
        <p class="adm-health-money-label">Held in escrow right now ${infoBtnHtml(escrowExplain)}</p>
        <p class="adm-health-money-value">${formatMoneyCents(b.money.escrow_held_cents)}</p>
        <p class="adm-health-money-sub">Funds you're holding on behalf of completed proposals</p>
      </div>
      <div>
        <p class="adm-health-money-label">Released to consultants in window ${infoBtnHtml(releasedExplain)}</p>
        <p class="adm-health-money-value">${formatMoneyCents(b.money.released_in_window_cents)}</p>
        <p class="adm-health-money-sub">Payouts you've moved out of escrow</p>
      </div>
    </div>
  `;
}

function drawPerfTiles(perf) {
  const host = document.getElementById("adm-health-perf-tiles");
  if (!host) return;
  const o = perf.overall || {};
  const samples = Number(o.total_samples || 0);
  if (!samples) {
    host.innerHTML = `<div class="adm-empty">No page-load data in this window yet — visit pages on the site to seed it.</div>`;
    return;
  }
  const tiles = [
    {
      label: "Page load speed (LCP)",
      value: o.lcp_p75 != null ? formatMs(o.lcp_p75) : "—",
      sub: lcpGrade(o.lcp_p75),
      grade: lcpClass(o.lcp_p75),
      explain: "How long the slowest 25% of your visitors wait before they see the main content on screen. Slower than 2.5s and people start leaving before the page is usable — this also affects your Google search ranking.",
    },
    {
      label: "Click responsiveness (INP)",
      value: o.inp_p75 != null ? formatMs(o.inp_p75) : "—",
      sub: inpGrade(o.inp_p75),
      grade: inpClass(o.inp_p75),
      explain: "when someone taps a button, how long until the page actually responds. sluggish responses make the site feel broken or unsure. under 200ms feels instant; over 500ms feels frozen.",
    },
    {
      label: "Layout stability (CLS)",
      value: o.cls_p75 != null ? (o.cls_p75 / 1000).toFixed(2) : "—",
      sub: clsGrade(o.cls_p75),
      grade: clsClass(o.cls_p75),
      explain: "How much content jumps around while the page loads. High values mean visitors tap the wrong thing because the page shifted under their finger — classic example: tapping the wrong button right when an ad loaded in.",
    },
    {
      label: "Server response (TTFB)",
      value: o.ttfb_p75 != null ? formatMs(o.ttfb_p75) : "—",
      sub: `${samples} samples`,
      explain: "How fast your server even starts responding. The starting block — if this is slow, every page feels sluggish no matter how clever the rest of the optimization is. Under 800ms is the bar.",
    },
  ];
  host.innerHTML = tiles.map((t) => `
    <div class="adm-kpi adm-kpi--graded ${t.grade ? `adm-kpi--${t.grade}` : ""}">
      <div class="adm-kpi__label">
        ${esc(t.label)}
        ${infoBtnHtml(t.explain)}
      </div>
      <div class="adm-kpi__value">${esc(String(t.value))}</div>
      <div class="adm-kpi__sub">${esc(t.sub)}</div>
    </div>
  `).join("");
}

function drawPerfSub(overall, days) {
  const el = document.getElementById("adm-health-perf-sub");
  if (!el) return;
  const samples = Number(overall?.total_samples || 0);
  el.textContent = samples
    ? `${samples.toLocaleString()} page loads recorded in the last ${days}d.`
    : `No page-load data recorded in the last ${days}d yet.`;
}

function drawTrendChart(rows) {
  const host = document.getElementById("adm-health-trend-chart");
  if (!host) return;
  if (!rows || !rows.length) {
    host.innerHTML = `<div class="adm-empty">No daily samples yet.</div>`;
    return;
  }
  const points = rows.map((r) => ({
    x: new Date(r.day),
    y: Number(r.lcp_p75) || 0,
    label: `${r.day} · ${r.samples} samples`,
  }));
  renderLineChart(host, points, { ariaLabel: "P75 LCP by day in milliseconds" });
}

function drawRouteTable(rows) {
  const tbody = document.getElementById("adm-health-route-tbody");
  if (!tbody) return;
  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="adm-empty">No per-route data yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => `
    <tr>
      <td class="adm-mono">${esc(r.pathname)}</td>
      <td>${Number(r.samples).toLocaleString()}</td>
      <td>${formatMs(r.lcp_p50)}</td>
      <td class="${lcpCellClass(r.lcp_p75)}">${formatMs(r.lcp_p75)}</td>
      <td>${formatMs(r.lcp_p95)}</td>
      <td>${r.cls_p75 != null ? (r.cls_p75 / 1000).toFixed(2) : "—"}</td>
      <td>${r.inp_p75 != null ? formatMs(r.inp_p75) : "—"}</td>
    </tr>
  `).join("");
}

function drawSlowestTable(rows) {
  const tbody = document.getElementById("adm-health-slowest-tbody");
  if (!tbody) return;
  if (!rows || !rows.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="adm-empty">No slow loads recorded yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((r) => {
    const when = new Date(r.recorded_at);
    return `
      <tr>
        <td>${esc(when.toLocaleString())}</td>
        <td class="adm-mono">${esc(r.pathname)}</td>
        <td>${esc(r.device_class || "—")}</td>
        <td>${esc(r.connection_type || "—")}</td>
        <td class="${lcpCellClass(r.lcp_ms)}">${formatMs(r.lcp_ms)}</td>
        <td>${r.cls_x1000 != null ? (r.cls_x1000 / 1000).toFixed(2) : "—"}</td>
      </tr>
    `;
  }).join("");
}

// ---- helpers ----

function tileHtml(t) {
  return `
    <div class="adm-kpi">
      <div class="adm-kpi__label">
        ${esc(t.label)}
        ${infoBtnHtml(t.explain)}
      </div>
      <div class="adm-kpi__value">${esc(String(t.value))}</div>
      <div class="adm-kpi__sub">${esc(t.sub)}</div>
    </div>
  `;
}

// Tiny "i" circle button shown next to a metric label. Clicking it pops
// a small bubble with the plain-English explainer. The bubble itself
// is created on demand in showInfoPopover() and reused across clicks.
function infoBtnHtml(explain) {
  if (!explain) return "";
  // Escape for both attribute and visible text contexts.
  return `<button type="button" class="adm-info" aria-label="What does this mean" data-info="${esc(explain)}">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <circle cx="8" cy="4.5" r="0.9" fill="currentColor"/>
      <path d="M8 7v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  </button>`;
}

function formatPct(value) {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(1) + "%";
}

function formatMs(ms) {
  if (ms == null || !Number.isFinite(Number(ms))) return "—";
  const n = Number(ms);
  if (n < 1000) return `${n}ms`;
  return `${(n / 1000).toFixed(2)}s`;
}

function formatMoneyCents(cents) {
  const n = Number(cents || 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

// Google's Core Web Vitals thresholds (good / needs-improvement / poor).
function lcpClass(ms) {
  if (ms == null) return "";
  if (ms <= 2500) return "good";
  if (ms <= 4000) return "warn";
  return "poor";
}
function lcpGrade(ms) {
  if (ms == null) return "No data";
  if (ms <= 2500) return "Good (under 2.5s)";
  if (ms <= 4000) return "Needs improvement";
  return "Poor (over 4s)";
}
function inpClass(ms) {
  if (ms == null) return "";
  if (ms <= 200) return "good";
  if (ms <= 500) return "warn";
  return "poor";
}
function inpGrade(ms) {
  if (ms == null) return "No data";
  if (ms <= 200) return "Good (under 200ms)";
  if (ms <= 500) return "Needs improvement";
  return "Poor (over 500ms)";
}
function clsClass(clsX1000) {
  if (clsX1000 == null) return "";
  if (clsX1000 <= 100) return "good";
  if (clsX1000 <= 250) return "warn";
  return "poor";
}
function clsGrade(clsX1000) {
  if (clsX1000 == null) return "No data";
  if (clsX1000 <= 100) return "Good (under 0.1)";
  if (clsX1000 <= 250) return "Needs improvement";
  return "Poor (over 0.25)";
}
function lcpCellClass(ms) {
  const g = lcpClass(ms);
  return g ? `adm-cell--${g}` : "";
}

/* ──────────────────────────────────────────────────────────────
   INFO POPOVERS
   Single delegated handler for all .adm-info buttons in the admin
   page. The bubble is a singleton; we move + retext it on each
   click instead of creating one per tile. Click outside or press
   Escape to dismiss.
   ────────────────────────────────────────────────────────────── */
(function wireInfoPopovers() {
  let bubble = null;
  let anchorBtn = null;

  function ensureBubble() {
    if (bubble) return bubble;
    bubble = document.createElement("div");
    bubble.className = "adm-info-popover";
    bubble.setAttribute("role", "tooltip");
    bubble.hidden = true;
    document.body.appendChild(bubble);
    return bubble;
  }

  function positionBubble(btn) {
    const rect = btn.getBoundingClientRect();
    // Try to place below the button; if that would overflow viewport,
    // place above. Horizontal align to the button, clamped to window.
    const bw = Math.min(280, window.innerWidth - 24);
    bubble.style.width = bw + "px";
    bubble.hidden = false; // need it visible to measure height
    const bh = bubble.offsetHeight;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow >= bh + 12
      ? rect.bottom + window.scrollY + 8
      : rect.top + window.scrollY - bh - 8;
    let left = rect.left + window.scrollX + rect.width / 2 - bw / 2;
    left = Math.max(12, Math.min(left, window.scrollX + window.innerWidth - bw - 12));
    bubble.style.top = top + "px";
    bubble.style.left = left + "px";
  }

  function open(btn) {
    const text = btn.getAttribute("data-info") || "";
    if (!text) return;
    ensureBubble();
    bubble.textContent = text;
    anchorBtn = btn;
    btn.classList.add("is-open");
    positionBubble(btn);
  }

  function close() {
    if (!bubble) return;
    bubble.hidden = true;
    if (anchorBtn) anchorBtn.classList.remove("is-open");
    anchorBtn = null;
  }

  // One global click handler: open on info-btn click, close on outside click.
  document.addEventListener("click", (event) => {
    const btn = event.target.closest(".adm-info");
    if (btn) {
      event.preventDefault();
      // Toggle: same button click closes it.
      if (anchorBtn === btn) {
        close();
      } else {
        open(btn);
      }
      return;
    }
    // Click anywhere else closes the bubble.
    if (anchorBtn && !event.target.closest(".adm-info-popover")) {
      close();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") close();
  });

  // Reposition on resize/scroll so the bubble stays anchored.
  window.addEventListener("resize", () => { if (anchorBtn) positionBubble(anchorBtn); });
  window.addEventListener("scroll", () => { if (anchorBtn) positionBubble(anchorBtn); }, { passive: true });
})();

// Categories and statuses are stored lowercase; show them in sentence case.
function capFirst(value) {
  const s = String(value || "");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
