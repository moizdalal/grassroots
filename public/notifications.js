import { getSupabaseClient } from "/supabase-loader.js";
import { initControlPanel } from "/control-panel.js";

const gate = document.getElementById("gate");
const list = document.getElementById("notif-list");

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function init() {
  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();

    if (!session?.user) {
      window.location.href = "/signin.html?next=" + encodeURIComponent("/notifications.html");
      return;
    }

    initControlPanel(client);

    const { data: notifs, error } = await client
      .from("notifications")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) { gate.textContent = error.message; gate.className = "gr-status error"; return; }

    gate.textContent = "";

    if (!notifs?.length) {
      list.innerHTML = '<p class="gr-empty-card">no notifications yet. once bids, messages, or meeting updates come in, they will appear here.</p>';
      return;
    }

    const unreadIds = notifs.filter((n) => !n.read).map((n) => n.id);

    list.innerHTML = notifs.map((n) => {
      const time = new Date(n.created_at).toLocaleString("en-US", {
        month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
      });
      const unread = !n.read ? "gr-notification-card--unread" : "";
      const badge = !n.read ? '<span class="gr-notification-card__badge">new</span>' : "";
      const link = n.link
        ? `<a href="${escapeHtml(n.link)}" class="gr-notification-card__action">open item &rarr;</a>`
        : "";
      return `
        <article class="gr-notification-card ${unread}">
          <div class="gr-notification-card__top">
            <div class="gr-notification-card__copy">
              <p class="gr-notification-card__title">${escapeHtml(n.title)}</p>
              ${n.body ? `<p class="gr-notification-card__body">${escapeHtml(n.body)}</p>` : ""}
            </div>
            ${badge}
          </div>
          <div class="gr-notification-card__meta">
            ${link}
            <span class="gr-notification-card__time">${time}</span>
          </div>
        </article>`;
    }).join("");

    if (unreadIds.length) {
      await client.from("notifications").update({ read: true }).in("id", unreadIds);
    }
  } catch (err) {
    gate.textContent = err.message || "could not load notifications.";
    gate.className = "gr-status error";
  }
}

init();
