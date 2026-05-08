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

function categorize(type) {
  const t = String(type || "").toLowerCase();
  if (t.startsWith("bid") || t.startsWith("offer") || t.startsWith("counter")) return "bids";
  if (t.startsWith("message") || t.startsWith("msg")) return "messages";
  if (t.startsWith("meeting") || t.startsWith("kickoff") || t.startsWith("schedule")) return "meetings";
  if (t.startsWith("review") || t.startsWith("rating")) return "reviews";
  return "updates";
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
  const badge = !n.read ? '<span class="gr-notification-card__badge">new</span>' : "";
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
 *   limit: max cards (default 6)
 */
export async function mountDashboardNotifications({ client, userId, listEl, emptyEl, limit = 6 }) {
  if (!listEl) return { unreadCount: 0, total: 0 };
  let notifs = [];
  try {
    const { data, error } = await client
      .from("notifications")
      .select("id, type, title, body, link, read, created_at")
      .eq("user_id", userId)
      .order("read", { ascending: true })
      .order("created_at", { ascending: false })
      .limit(limit);
    if (!error && Array.isArray(data)) notifs = data;
  } catch (_) {}

  const unreadCount = notifs.filter((n) => !n.read).length;

  if (!notifs.length) {
    listEl.innerHTML = "";
    if (emptyEl) emptyEl.hidden = false;
    return { unreadCount, total: 0 };
  }
  if (emptyEl) emptyEl.hidden = true;

  listEl.innerHTML = notifs.map(renderCardHtml).join("");

  // Optimistic mark-read on click of unread cards (mirrors notifications page).
  listEl.querySelectorAll(".gr-notification-card").forEach((card) => {
    card.addEventListener("click", () => {
      const id = card.dataset.id;
      const notif = notifs.find((n) => n.id === id);
      if (!notif || notif.read) return;
      notif.read = true;
      card.classList.remove("gr-notification-card--unread");
      const badge = card.querySelector(".gr-notification-card__badge");
      if (badge) badge.remove();
      client.from("notifications").update({ read: true }).eq("id", id).then(() => {});
    });
  });

  return { unreadCount, total: notifs.length };
}
