// Lightweight email helper. Sends through Resend when configured; otherwise
// logs to stdout and returns success so callers don't have to branch on env.
//
// Required env vars (when sending is desired):
//   RESEND_API_KEY        — bearer key from resend.com
//   RESEND_FROM_EMAIL     — verified sender address (e.g. "Grassroots <noreply@grassroots.work>")
//                           defaults to "onboarding@resend.dev", which Resend
//                           accepts without domain verification but can only
//                           deliver to the account owner's email.
//
// Add the Resend integration via the Vercel Marketplace to auto-provision the
// API key. Domain verification happens in the Resend dashboard.

const RESEND_API_URL = "https://api.resend.com/emails";

function getEnv(name, fallback) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function isConfigured() {
  return Boolean(getEnv("RESEND_API_KEY"));
}

async function sendEmail({ to, subject, html, text, replyTo }) {
  if (!to || !subject || (!html && !text)) {
    throw new Error("sendEmail requires { to, subject, html | text }");
  }

  const apiKey = getEnv("RESEND_API_KEY");
  const from = getEnv("RESEND_FROM_EMAIL", "onboarding@resend.dev");

  if (!apiKey) {
    console.log(
      "[email:noop] no RESEND_API_KEY configured — would have sent:",
      JSON.stringify({ to, subject, replyTo, from })
    );
    return { ok: true, sent: false, reason: "not_configured" };
  }

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject,
        html: html || undefined,
        text: text || undefined,
        reply_to: replyTo || undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.warn(
        "[email:resend] non-2xx",
        res.status,
        body.slice(0, 200)
      );
      return { ok: false, sent: false, status: res.status, body };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, sent: true, id: data?.id || null };
  } catch (err) {
    console.warn("[email:resend] fetch threw", err?.message || err);
    return { ok: false, sent: false, error: err?.message || String(err) };
  }
}

module.exports = { sendEmail, isConfigured };
