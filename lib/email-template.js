// Branded transactional email layout. Returns { html, text } for one
// message: a heading, short paragraphs, one button, and a footer.
//
// Colors mirror the light and dark-forest tokens in public/field-office.css.
// Inline styles carry the light theme (Gmail strips <head> media queries in
// some views); the prefers-color-scheme block repaints Apple Mail, iOS Mail
// and Outlook.com in dark-forest. Gmail's own dark mode inverts the light
// palette, which stays readable because every pair has strong contrast.

const COLORS = {
  light: { bg: "#f5f1e6", surface: "#ffffff", text: "#14201a", text2: "#4a5650", text3: "#767f78", line: "#e4ded0", accent: "#2f7a5a", accentOn: "#ffffff" },
  dark: { bg: "#14201a", surface: "#1a2a23", text: "#f0ebdf", text2: "#a8b8ad", text3: "#8a9b90", line: "#284036", accent: "#2f7a5a", accentOn: "#ffffff" },
};

const FONT_DISPLAY = "Fraunces, Georgia, 'Times New Roman', serif";
const FONT_BODY = "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const MAILING_ADDRESS = "Grassroots Marketplace LLC · 7901 4th St N, Ste 300, St. Petersburg, FL 33702";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * @param {object} m
 * @param {string} m.subject     Used for <title>.
 * @param {string} m.preheader   Inbox preview line.
 * @param {string} m.heading
 * @param {string[]} m.paragraphs  Plain text; escaped here.
 * @param {string} [m.quote]     Optional quoted note from the other person.
 * @param {{label: string, url: string}} [m.cta]
 * @param {string} m.baseUrl     Absolute site origin for footer links.
 * @param {string} [m.reason]    Footer line: why they got this email.
 */
function renderEmail({ subject, preheader, heading, paragraphs = [], quote, cta, baseUrl, reason }) {
  const c = COLORS.light;
  const d = COLORS.dark;
  const footerReason = reason || "You're getting this because you have a Grassroots account.";
  const accountUrl = `${baseUrl}/dashboard.html`;

  const paras = paragraphs
    .map((p) => `<p class="em-text" style="margin:0 0 14px;font:400 16px/1.55 ${FONT_BODY};color:${c.text};">${escapeHtml(p)}</p>`)
    .join("");

  const quoteHtml = quote
    ? `<p class="em-quote" style="margin:0 0 14px;padding:12px 16px;border-left:3px solid ${c.accent};background:${c.bg};font:400 15px/1.5 ${FONT_BODY};color:${c.text2};">${escapeHtml(quote)}</p>`
    : "";

  const ctaHtml = cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;"><tr><td style="border-radius:999px;background:${c.accent};">
        <a href="${escapeHtml(cta.url)}" class="em-btn" style="display:inline-block;padding:12px 22px;border-radius:999px;font:600 15px/1 ${FONT_BODY};color:${c.accentOn};text-decoration:none;">${escapeHtml(cta.label)}</a>
      </td></tr></table>`
    : "";

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${escapeHtml(subject)}</title>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,600&family=Figtree:wght@400;600&display=swap" rel="stylesheet">
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  a { color: ${c.accent}; }
  @media (prefers-color-scheme: dark) {
    .em-bg { background: ${d.bg} !important; }
    .em-card { background: ${d.surface} !important; border-color: ${d.line} !important; }
    .em-wordmark, .em-heading, .em-text { color: ${d.text} !important; }
    .em-quote { background: ${d.bg} !important; color: ${d.text2} !important; }
    .em-muted, .em-muted a { color: ${d.text3} !important; }
  }
  [data-ogsc] .em-bg { background: ${d.bg} !important; }
  [data-ogsc] .em-card { background: ${d.surface} !important; }
  [data-ogsc] .em-wordmark, [data-ogsc] .em-heading, [data-ogsc] .em-text { color: ${d.text} !important; }
  [data-ogsc] .em-muted { color: ${d.text3} !important; }
</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:${c.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || "")}</div>
<table role="presentation" class="em-bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.bg};">
  <tr><td align="center" style="padding:32px 16px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;">
      <tr><td style="padding:0 4px 18px;">
        <a href="${escapeHtml(baseUrl)}" class="em-wordmark" style="font:600 26px/1 ${FONT_DISPLAY};color:${c.text};text-decoration:none;letter-spacing:-0.01em;">grassroots</a>
      </td></tr>
      <tr><td class="em-card" style="background:${c.surface};border:1px solid ${c.line};border-radius:16px;padding:28px 28px 24px;">
        <h1 class="em-heading" style="margin:0 0 16px;font:600 24px/1.25 ${FONT_DISPLAY};color:${c.text};">${escapeHtml(heading)}</h1>
        ${paras}
        ${quoteHtml}
        ${ctaHtml}
      </td></tr>
      <tr><td class="em-muted" style="padding:18px 4px 0;font:400 13px/1.5 ${FONT_BODY};color:${c.text3};">
        ${escapeHtml(footerReason)} <a href="${escapeHtml(accountUrl)}" style="color:${c.text3};text-decoration:underline;">Open your dashboard</a>.<br>
        Questions? Reply to this email.<br>
        ${escapeHtml(MAILING_ADDRESS)}
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    heading,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(quote ? [`"${quote}"`, ""] : []),
    ...(cta ? [`${cta.label}: ${cta.url}`, ""] : []),
    "—",
    `${footerReason} Open your dashboard: ${accountUrl}`,
    "Questions? Reply to this email.",
    MAILING_ADDRESS,
  ].join("\n");

  return { html, text };
}

module.exports = { renderEmail, escapeHtml };
