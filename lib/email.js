// Lightweight email helper. Sends through Resend when configured; otherwise
// logs to stdout. Never throws: every outcome comes back as
// { ok, sent, ... } so request paths can await it safely.
//
// Env vars:
//   RESEND_API_KEY      — bearer key from resend.com. Unset → log only.
//   RESEND_FROM_EMAIL   — verified sender, e.g.
//                         "Grassroots <notifications@grassroots-marketplace.com>".
//                         Defaults to Resend's sandbox sender, which only
//                         delivers to the Resend account owner.
//   RESEND_REPLY_TO     — where replies land (optional).
//   EMAIL_REDIRECT_TO   — send every email here instead of the real
//                         recipient. Required outside Vercel production so
//                         local and preview runs never email real users.

const RESEND_API_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 8000;

function getEnv(name, fallback) {
  const v = process.env[name];
  return typeof v === "string" && v.trim() ? v.trim() : fallback;
}

function isConfigured() {
  return Boolean(getEnv("RESEND_API_KEY"));
}

function isProduction() {
  return process.env.VERCEL_ENV === "production";
}

// Mask an address for logs: "jane@example.com" → "j***@example.com".
function maskEmail(addr) {
  return String(addr).replace(/^(.)[^@]*@/, "$1***@");
}

async function sendEmail({ to, subject, html, text, replyTo, idempotencyKey, tags } = {}) {
  if (!to || !subject || (!html && !text)) {
    console.warn("[email] sendEmail needs { to, subject, html | text }", JSON.stringify({ subject }));
    return { ok: false, sent: false, reason: "invalid_args" };
  }

  const apiKey = getEnv("RESEND_API_KEY");
  const from = getEnv("RESEND_FROM_EMAIL", "onboarding@resend.dev");
  const reply = replyTo || getEnv("RESEND_REPLY_TO");
  const redirect = getEnv("EMAIL_REDIRECT_TO");
  let recipients = Array.isArray(to) ? to : [to];

  if (redirect) {
    subject = `[to ${recipients.join(", ")}] ${subject}`;
    recipients = [redirect];
  } else if (apiKey && !isProduction()) {
    console.log("[email:skip] EMAIL_REDIRECT_TO is required outside production:", JSON.stringify({ subject }));
    return { ok: true, sent: false, reason: "redirect_required" };
  }

  if (!apiKey) {
    console.log(
      "[email:noop] no RESEND_API_KEY configured — would have sent:",
      JSON.stringify({ to: recipients.map(maskEmail), subject, from })
    );
    return { ok: true, sent: false, reason: "not_configured" };
  }

  const headers = {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
  // Resend drops a repeat send with the same key for 24 hours.
  if (idempotencyKey) headers["Idempotency-Key"] = String(idempotencyKey).slice(0, 256);

  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
      body: JSON.stringify({
        from,
        to: recipients,
        subject,
        html: html || undefined,
        text: text || undefined,
        reply_to: reply || undefined,
        tags: tags?.length ? tags : undefined,
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      // Same idempotency key as an earlier send: already sent, not an error.
      if (res.status === 409 && body.includes("idempotent")) {
        console.log("[email:duplicate] skipped repeat send", JSON.stringify({ subject }));
        return { ok: true, sent: false, reason: "duplicate" };
      }
      console.warn("[email:resend] non-2xx", res.status, JSON.stringify({ subject }), body.slice(0, 300));
      return { ok: false, sent: false, status: res.status };
    }

    const data = await res.json().catch(() => ({}));
    return { ok: true, sent: true, id: data?.id || null };
  } catch (err) {
    console.warn("[email:resend] send failed", JSON.stringify({ subject }), err?.message || err);
    return { ok: false, sent: false, error: err?.message || String(err) };
  }
}

module.exports = { sendEmail, isConfigured };
