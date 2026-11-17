/* ================================================================
   Shared dashboard notifications panel.
   Pulls recent rows from public.notifications, renders them in the
   notification-card format used on /notifications.html, with a
   category-driven icon column. Replaces the per-dashboard "action
   items" panel on both owner and consultant dashboards.
   ================================================================ */

const ICONS = {
  bids: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>',
  messages: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>',
  meetings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>',
  payments: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/><line x1="6" y1="15" x2="10" y2="15"/></svg>',
  engagements: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/></svg>',
  reviews: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>',
  updates: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>',
};

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// One shared mapping from the raw notification.type strings to a small set
// of filter buckets, used by /notifications.html and both dashboards so the
// chips and icons never drift apart. Both roles get the same buckets; only
// the money bucket is worded per role ("Payouts" for consultants,
// "Payments" for businesses). Anything unrecognised lands in "updates" so
// a new server-side type still shows up without a code change here.
export function categorize(type) {
  const t = String(type || "").toLowerCase();
  if (/^(bid|offer|counter)/.test(t)) return "bids";
  if (/^(message|msg)/.test(t)) return "messages";
  if (/^(meeting|kickoff|schedule)/.test(t)) return "meetings";
  // Delivery, review-window, redo, support and garden milestones are all
  // about a piece of work in flight. Checked before reviews so
  // "review_window_closing" is not mistaken for a star review.
  if (/^(work_|changes_requested|review_window|redo_|problem_|consultant_response|support_|delivery|engagement|retainer_|garden|flower|bloom|plant)/.test(t)) return "engagements";
  if (/^(payment|payout|auto_released|partial_refund|refund|held_payment|dispute|transfer)/.test(t)) return "payments";
  if (/^(review|rating)/.test(t) || /_(review|rating)$/.test(t)) return "reviews";
  return "updates";
}

// Display order of the filter chips. "all" is always first.
export const FILTER_ORDER = ["all", "bids", "engagements", "payments", "meetings", "messages", "reviews", "updates"];

// Chips that stay visible even at zero so both roles see the same row.
// Messages and updates only appear when there is something in them.
export const CORE_FILTERS = ["all", "bids", "engagements", "payments", "meetings", "reviews"];

export function filterLabel(key, role) {
  if (key === "payments") return role === "consultant" ? "Payouts" : "Payments";
  return {
    all: "All",
    bids: "Offers",
    engagements: "Projects",
    meetings: "Meetings",
    messages: "Messages",
    reviews: "Reviews",
    updates: "Updates",
  }[key] || "Updates";
}

export function countByFilter(notifs) {
  const counts = Object.fromEntries(FILTER_ORDER.map((k) => [k, 0]));
  counts.all = notifs.length;
  for (const n of notifs) counts[categorize(n.type)] += 1;
  return counts;
}

// Chip row markup shared by the full page and the dashboard panel.
export function renderFilterChipsHtml({ keys, counts, active, role }) {
  return keys.map((k) => {
    const isActive = k === active;
    return `<button type="button" role="tab" class="gr-notif-filter${isActive ? " is-active" : ""}" data-filter="${k}" aria-selected="${isActive}">
      ${escapeHtml(filterLabel(k, role))}<span class="gr-notif-filter__count">${counts[k]}</span>
    </button>`;
  }).join("");
}

// "consultant" or "owner". Used only to word the money chip, so any
// failure quietly falls back to the business wording.
export async function loadNotificationRole(client, userId) {
  try {
    const { data } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
    return data?.role === "consultant" ? "consultant" : "owner";
  } catch (_) {
    return "owner";
  }
}

function fmtTime(iso) {
  const d = new Date(iso);
  const now = new Date();
  const sameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();
  if (sameDay) {
    return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString("en-US", { month: "short", day: "numeric" });
}

function renderCardHtml(n) {
  const cat = categorize(n.type);
  const icon = ICONS[cat] || ICONS.updates;
  const unread = !n.read ? "gr-notification-card--unread" : "";
  const badge = !n.read ? '<span class="gr-notification-card__badge">New</span>' : "";
  const linkOpen = n.link ? `<a href="${escapeHtml(n.link)}" class="gr-notification-card gr-notification-card--linked ${unread}" data-id="${escapeHtml(n.id)}">` : `<article class="gr-notification-card ${unread}" data-id="${escapeHtml(n.id)}">`;
  const linkClose = n.link ? "</a>" : "</article>";
  const sep = n.body ? '<span class="gr-notification-card__sep" aria-hidden="true">|</span>' : "";
  const bodySpan = n.body ? `<span class="gr-notification-card__body-inline">${escapeHtml(n.body)}</span>` : "";
  return `
    ${linkOpen}
      <span class="gr-notification-card__icon gr-notification-card__icon--${cat}" aria-hidden="true">${icon}</span>
      <div class="gr-notification-card__main">
        <p class="gr-notification-card__line">
          <strong class="gr-notification-card__title-inline">${escapeHtml(n.title || "")}</strong>
          ${sep}
          ${bodySpan}
        </p>
        <div class="gr-notification-card__bottom">
          <span class="gr-notification-card__time">${escapeHtml(fmtTime(n.created_at))}</span>
          ${badge}
        </div>
      </div>
    ${linkClose}`;
}

/**
 * Mount the dashboard notifications panel.
 * @param {object} opts
 *   client: Supabase client
 *   userId: signed-in user's id
 *   listEl: DOM node to fill with cards
 *   emptyEl: DOM node to show when there are zero notifications
 *   limit: max cards shown at once (default 6)
 *   role: "consultant" | "owner" (looked up when omitted)
 *
 * The filter chip row is created here and inserted just above listEl, so
 * a dashboard only needs the list container to get filters.
 */
export async function mountDashboardNotifications({ client, userId, listEl, emptyEl, limit = 6, role }) {
  if (!listEl) return { unreadCount: 0, total: 0 };
  let notifs = [];
  try {
    // Dashboard view shows only the last 5 days. Older notifications
    // remain accessible on /notifications.html — this just keeps the
    // dashboard panel feeling current. We pull more rows than we show so
    // a filter chip can still fill the panel.
    const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const [res, resolvedRole] = await Promise.all([
      client
        .from("notifications")
        .select("id, type, title, body, link, read, created_at")
        .eq("user_id", userId)
        .gte("created_at", fiveDaysAgo)
        .order("read", { ascending: true })
        .order("created_at", { ascending: false })
        .limit(Math.max(limit, 40)),
      role ? Promise.resolve(role) : loadNotificationRole(client, userId),
    ]);
    role = resolvedRole;
    if (!res.error && Array.isArray(res.data)) notifs = res.data;
  } catch (_) {}

  const unreadCount = notifs.filter((n) => !n.read).length;

  // Reuse the chip row across re-mounts instead of stacking a new one.
  let filtersEl = listEl.previousElementSibling;
  if (!filtersEl || !filtersEl.classList.contains("dash-notifications-filters")) {
    filtersEl = document.createElement("div");
    filtersEl.className = "gr-notif-filters dash-notifications-filters";
    filtersEl.setAttribute("role", "tablist");
    filtersEl.setAttribute("aria-label", "Filter notifications");
    listEl.parentNode.insertBefore(filtersEl, listEl);
  }

  if (!notifs.length) {
    listEl.innerHTML = "";
    filtersEl.hidden = true;
    filtersEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return { unreadCount, total: 0 };
  }
  if (emptyEl) emptyEl.hidden = true;

  let active = "all";

  function render() {
    // The panel is small, so only chips with something in them are shown.
    const counts = countByFilter(notifs);
    const keys = FILTER_ORDER.filter((k) => k === "all" || counts[k] > 0);
    if (!keys.includes(active)) active = "all";
    filtersEl.hidden = false;
    filtersEl.innerHTML = renderFilterChipsHtml({ keys, counts, active, role });

    const shown = (active === "all" ? notifs : notifs.filter((n) => categorize(n.type) === active)).slice(0, limit);
    listEl.innerHTML = shown.map(renderCardHtml).join("");
    listEl.scrollTop = 0;
  }

  filtersEl.onclick = (e) => {
    const btn = e.target.closest(".gr-notif-filter");
    if (!btn) return;
    active = btn.dataset.filter;
    render();
  };

  // Optimistic mark-read on click of unread cards (mirrors notifications page).
  listEl.onclick = (e) => {
    const card = e.target.closest(".gr-notification-card");
    if (!card) return;
    const id = card.dataset.id;
    const notif = notifs.find((n) => n.id === id);
    if (!notif || notif.read) return;
    notif.read = true;
    card.classList.remove("gr-notification-card--unread");
    const badge = card.querySelector(".gr-notification-card__badge");
    if (badge) badge.remove();
    client.from("notifications").update({ read: true }).eq("id", id).then(() => {});
  };

  render();

  return { unreadCount, total: notifs.length };
}
