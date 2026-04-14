/**
 * Shared notification bell — import from any page to show unread count in the nav.
 * Usage: import { initNotifBell } from "/nav-notify.js"; initNotifBell(supabaseClient);
 */

export async function initNotifBell(client) {
  const { data: { session } } = await client.auth.getSession();
  if (!session?.user) return;

  const profileLink = document.querySelector('.gr-nav__links a[href="/profile.html"]');
  if (!profileLink) return;

  const li = profileLink.closest("li");
  if (!li) return;

  const bellLi = document.createElement("li");
  const bell = document.createElement("a");
  bell.href = "/notifications.html";
  bell.className = "gr-notif-bell";
  bell.setAttribute("aria-label", "notifications");
  bell.innerHTML = "&#x1F514;";
  bellLi.appendChild(bell);
  li.parentNode.insertBefore(bellLi, li);

  try {
    const { count, error } = await client
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .eq("read", false);

    if (!error && count > 0) {
      const badge = document.createElement("span");
      badge.className = "gr-notif-count";
      badge.textContent = count > 9 ? "9+" : String(count);
      bell.appendChild(badge);
    }
  } catch {
    // notifications table may not exist yet
  }
}
