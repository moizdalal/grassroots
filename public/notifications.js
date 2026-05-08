import { getSupabaseClient } from "/supabase-loader.js";

const gate = document.getElementById("gate");
const list = document.getElementById("notif-list");
const controls = document.getElementById("notif-controls");
const filtersHost = document.getElementById("notif-filters");
const markAllBtn = document.getElementById("notif-mark-all");

let _client = null;
let _notifs = [];
let _activeFilter = "all";

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Map raw notification.type strings to a small set of filter buckets so we
// don't end up with 12 chips for 12 server-side type variants. Anything we
// don't recognize falls into "updates" so it still gets surfaced.
function categorize(type) {
  const t = String(type || "").toLowerCase();
  if (t.startsWith("bid")) return "bids";
  if (t.startsWith("message") || t.startsWith("msg")) return "messages";
  if (t.startsWith("meeting") || t.startsWith("kickoff")) return "meetings";
  return "updates";
}

const FILTER_LABELS = {
  all: "all",
  bids: "bids",
  messages: "messages",
  meetings: "meetings",
  updates: "updates",
};

function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function bucketFor(notif) {
  const created = new Date(notif.created_at);
  const today = startOfDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  const weekStart = new Date(today);
  weekStart.setDate(today.getDate() - 6);

  const c = startOfDay(created);
  if (c.getTime() === today.getTime()) return "today";
  if (c.getTime() === yesterday.getTime()) return "yesterday";
  if (c >= weekStart) return "earlier this week";
  return "earlier";
}

const BUCKET_ORDER = ["today", "yesterday", "earlier this week", "earlier"];

function fmtTime(iso) {
  const d = new Date(iso);
  const today = startOfDay(new Date());
  const isToday = startOfDay(d).getTime() === today.getTime();
  if (isToday) {
    return d.toLocaleString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function renderFilters() {
  const counts = { all: _notifs.length, bids: 0, messages: 0, meetings: 0, updates: 0 };
  for (const n of _notifs) counts[categorize(n.type)]++;

  // Only show chips that have at least one match (and "all" always).
  const chips = ["all", "bids", "messages", "meetings", "updates"]
    .filter((k) => k === "all" || counts[k] > 0);

  filtersHost.innerHTML = chips.map((k) => {
    const active = k === _activeFilter ? "is-active" : "";
    return `<button type="button" role="tab" class="gr-notif-filter ${active}" data-filter="${k}" aria-selected="${k === _activeFilter}">
      ${FILTER_LABELS[k]}<span class="gr-notif-filter__count">${counts[k]}</span>
    </button>`;
  }).join("");

  filtersHost.querySelectorAll(".gr-notif-filter").forEach((btn) => {
    btn.addEventListener("click", () => {
      _activeFilter = btn.dataset.filter;
      renderFilters();
      renderFeed();
    });
  });
}

function renderFeed() {
  const filtered = _activeFilter === "all"
    ? _notifs
    : _notifs.filter((n) => categorize(n.type) === _activeFilter);

  if (!filtered.length) {
    list.innerHTML = `<p class="gr-empty-state">nothing in ${escapeHtml(_activeFilter)} right now.</p>`;
    return;
  }

  // Bucket the filtered set, preserving original (newest-first) order within each bucket.
  const buckets = new Map();
  for (const n of filtered) {
    const key = bucketFor(n);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(n);
  }

  const html = BUCKET_ORDER
    .filter((k) => buckets.has(k))
    .map((k) => {
      const items = buckets.get(k);
      const cards = items.map(renderCardHtml).join("");
      return `
        <div class="gr-notif-bucket">
          <h2 class="gr-notif-bucket__title">${k}<span class="gr-notif-bucket__count">${items.length}</span></h2>
          <div class="gr-notif-bucket__list">${cards}</div>
        </div>`;
    })
    .join("");

  list.innerHTML = html;

  // Click-to-mark-read: clicking the link (or anywhere on an unread card) marks read.
  list.querySelectorAll(".gr-notification-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      const id = card.dataset.id;
      if (!id) return;
      const notif = _notifs.find((n) => n.id === id);
      if (notif && !notif.read) {
        markRead([id]);
      }
      // Don't preventDefault — let the link navigate naturally.
    });
  });
}

function renderCardHtml(n) {
  const unread = !n.read ? "gr-notification-card--unread" : "";
  const badge = !n.read ? '<span class="gr-notification-card__badge">new</span>' : "";
  const link = n.link
    ? `<a href="${escapeHtml(n.link)}" class="gr-notification-card__action">open item &rarr;</a>`
    : "";
  return `
    <article class="gr-notification-card ${unread}" data-id="${escapeHtml(n.id)}">
      <div class="gr-notification-card__top">
        <div class="gr-notification-card__copy">
          <p class="gr-notification-card__title">${escapeHtml(n.title)}</p>
          ${n.body ? `<p class="gr-notification-card__body">${escapeHtml(n.body)}</p>` : ""}
        </div>
        ${badge}
      </div>
      <div class="gr-notification-card__meta">
        ${link}
        <span class="gr-notification-card__time">${fmtTime(n.created_at)}</span>
      </div>
    </article>`;
}

async function markRead(ids) {
  if (!ids.length) return;
  // Optimistic UI update first.
  for (const n of _notifs) {
    if (ids.includes(n.id)) n.read = true;
  }
  renderFilters();
  renderFeed();
  updateMarkAllVisibility();

  try {
    await _client.from("notifications").update({ read: true }).in("id", ids);
  } catch (err) {
    // If the update fails, the next page load will resync. No need to revert
    // the optimistic state for a notification feed.
  }
}

function updateMarkAllVisibility() {
  const unreadCount = _notifs.filter((n) => !n.read).length;
  markAllBtn.hidden = unreadCount === 0;
}

async function init() {
  try {
    const client = await getSupabaseClient();
    _client = client;
    const { data: { session } } = await client.auth.getSession();

    if (!session?.user) {
      window.location.href = "/signin.html?next=" + encodeURIComponent("/notifications.html");
      return;
    }

    const { data: notifs, error } = await client
      .from("notifications")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(100);

    if (error) {
      gate.textContent = error.message;
      gate.className = "gr-status error";
      return;
    }

    gate.textContent = "";
    _notifs = notifs || [];

    if (!_notifs.length) {
      list.innerHTML = '<p class="gr-empty-card">no notifications yet. once bids, messages, or meeting updates come in, they will appear here.</p>';
      return;
    }

    controls.hidden = false;
    renderFilters();
    renderFeed();
    updateMarkAllVisibility();

    markAllBtn.addEventListener("click", () => {
      const ids = _notifs.filter((n) => !n.read).map((n) => n.id);
      markRead(ids);
    });
  } catch (err) {
    gate.textContent = err.message || "could not load notifications.";
    gate.className = "gr-status error";
  }
}

init();
