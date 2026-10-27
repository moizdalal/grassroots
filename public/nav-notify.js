export async function initNotifBell(client) {
  void client;
}

// Unread notification count for the signed-in user. A head-only count
// query, so no rows come back over the wire. Returns 0 on any error.
export async function loadUnreadNotificationCount(client, userId) {
  if (!client || !userId) return 0;
  try {
    const { count, error } = await client
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId)
      .eq("read", false);
    if (error) return 0;
    return count || 0;
  } catch {
    return 0;
  }
}
