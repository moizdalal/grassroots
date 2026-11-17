// Ask the server to email the other side about something this browser just
// wrote to Supabase (an offer, a counter, a review). The server checks the
// bid and builds the email; this only names the event. Never throws.
export async function notifyEvent(client, event, ids) {
  try {
    const { data: { session } } = await client.auth.getSession();
    if (!session?.access_token) return;
    await fetch("/api/notify/event", {
      method: "POST",
      keepalive: true,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ event, ...ids }),
    });
  } catch (err) {
    console.warn("notifyEvent failed", event, err);
  }
}
