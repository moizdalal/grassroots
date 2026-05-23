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

// Two consecutive notifications targeting the same listing/engagement
// roll up under a single collapsible group so the feed doesn't flood
// when one thing generates five updates in a row. Returns a stable key
// like "/listing.html?id=ABC" or "/engagement.html?bid=DEF" — anything
// without a recognizable target key gets a unique fallback key so it
// never groups.
function notificationGroupKey(notif, idx) {
  const link = String(notif?.link || "");
  if (!link) return `__loner__${notif.id || idx}`;
  try {
    const url = new URL(link, window.location.origin);
    const key = url.searchParams.get("id") || url.searchParams.get("bid");
    if (key) return `${url.pathname}::${key}`;
    return `__path__${url.pathname}`;
  } catch (_) {
    return `__raw__${link}`;
  }
}

// Walk a (newest-first) array of notifications and produce a list of
// groups. A group with one entry renders as a normal card; multi-entry
// groups render as a collapsible row showing the lead notification
// title + a count, expandable to the full list.
function groupConsecutive(items) {
  const groups = [];
  for (let i = 0; i < items.length; i += 1) {
    const key = notificationGroupKey(items[i], i);
    const prev = groups[groups.length - 1];
    if (prev && prev.key === key) {
      prev.items.push(items[i]);
    } else {
      groups.push({ key, items: [items[i]] });
    }
  }
  return groups;
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

  // Track whether each bucket is the FIRST (top) bucket — its lead
  // group renders expanded. Every other group starts collapsed.
  const orderedKeys = BUCKET_ORDER.filter((k) => buckets.has(k));

  const html = orderedKeys
    .map((k, bucketIdx) => {
      const items = buckets.get(k);
      const groups = groupConsecutive(items);
      const cards = groups
        .map((g, groupIdx) => {
          if (g.items.length === 1) return renderCardHtml(g.items[0]);
          const startOpen = bucketIdx === 0 && groupIdx === 0;
          return renderGroupHtml(g, startOpen);
        })
        .join("");
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
      // Don't mark-read when the click landed on the dismiss button.
      if (e.target.closest(".gr-notif-dismiss")) return;
      const id = card.dataset.id;
      if (!id) return;
      const notif = _notifs.find((n) => n.id === id);
      if (notif && !notif.read) {
        markRead([id]);
      }
      // Don't preventDefault — let the link navigate naturally.
    });
  });

  // Dismiss (delete) — stops propagation so the parent card's click doesn't
  // also fire mark-read on a row we're about to remove.
  list.querySelectorAll(".gr-notif-dismiss").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      dismissNotification(btn.dataset.dismissId);
    });
  });
}

// Collapsed-group renderer. Lead notification's title + body is shown
// inline; the rest unfolds when the user clicks the disclosure.
function renderGroupHtml(group, startOpen) {
  const lead = group.items[0];
  const rest = group.items.slice(1);
  const extra = rest.length;
  const unreadCount = group.items.filter((n) => !n.read).length;
  const groupUnread = unreadCount > 0 ? "gr-notif-group--unread" : "";
  const openAttr = startOpen ? " open" : "";
  const restCards = rest.map(renderCardHtml).join("");
  return `
    <details class="gr-notif-group ${groupUnread}"${openAttr}>
      <summary class="gr-notif-group__summary">
        <div class="gr-notif-group__lead">
          <p class="gr-notif-group__title">${escapeHtml(lead.title)}</p>
          <p class="gr-notif-group__meta">
            <span class="gr-notif-group__count">${group.items.length} updates${unreadCount ? ` · ${unreadCount} unread` : ""}</span>
            <span class="gr-notif-group__time">${fmtTime(lead.created_at)}</span>
          </p>
        </div>
        <span class="gr-notif-group__chevron" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
        </span>
      </summary>
      <div class="gr-notif-group__items">
        ${renderCardHtml(lead)}
        ${restCards}
      </div>
    </details>
    <p class="gr-sr">${extra} more update${extra === 1 ? "" : "s"} about the same item</p>
  `;
}

function renderCardHtml(n) {
  const unread = !n.read ? "gr-notification-card--unread" : "";
  const badge = !n.read ? '<span class="gr-notification-card__badge">new</span>' : "";
  const link = n.link
    ? `<a href="${escapeHtml(n.link)}" class="gr-notification-card__action">open item &rarr;</a>`
    : "";
  return `
    <article class="gr-notification-card ${unread}" data-id="${escapeHtml(n.id)}">
      <button type="button" class="gr-notif-dismiss" data-dismiss-id="${escapeHtml(n.id)}" aria-label="dismiss notification" title="dismiss">
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
      </button>
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

async function dismissNotification(id) {
  if (!id) return;
  // Optimistic — drop from local state and re-render. If the server delete
  // fails (RLS, network), the next page load will resync and the row will
  // reappear; in practice with the delete policy applied that's rare.
  _notifs = _notifs.filter((n) => n.id !== id);
  if (!_notifs.length) {
    list.innerHTML = '<p class="gr-empty-card">no notifications yet. once bids, messages, or meeting updates come in, they will appear here.</p>';
    controls.hidden = true;
  } else {
    renderFilters();
    renderFeed();
    updateMarkAllVisibility();
  }
  try {
    await _client.from("notifications").delete().eq("id", id);
  } catch (_) {
    /* best-effort; next reload resyncs */
  }
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
