// Branded transactional email layout. Returns { html, text } for one
// message. Top to bottom: lockup, then a card with a glyph, the listing
// title as an eyebrow, an optional hero amount, the heading, an intro line,
// an optional progress stem, label / value facts, the other person's note,
// a closing line and one button. Footer last.
//
// Colors mirror the light and dark-forest tokens in public/field-office.css.
// Inline styles carry the light theme (Gmail strips <head> media queries in
// some views); the prefers-color-scheme block repaints Apple Mail, iOS Mail
// and Outlook.com in dark-forest, border-only like the app's dark cards.
// Images come from public/email/ (built by scripts/build-email-assets.js);
// each has a light and a dark file, swapped by the same media query.

const COLORS = {
  light: { bg: "#f5f1e6", surface: "#ffffff", note: "#faf6ec", text: "#14201a", text2: "#4a5650", muted: "#5f6862", line: "#e4ded0", rule: "#ece6d8", accent: "#2f7a5a", accentText: "#2f7a5a", accentOn: "#ffffff" },
  dark: { bg: "#14201a", text: "#f0ebdf", text2: "#a8b8ad", muted: "#8a9b90", line: "#284036", accentText: "#6dbf8a" },
};

const FONT_DISPLAY = "Fraunces, Georgia, 'Times New Roman', serif";
const FONT_BODY = "Figtree, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

const MAILING_ADDRESS = "Grassroots Marketplace LLC · 7901 4th St N, Ste 300, St. Petersburg, FL 33702";

const STEPS = ["Accepted", "Kickoff", "Delivered", "Paid"];
// Stem name → index of the current step (4 = every step done).
const STEMS = { kickoff: 1, delivered: 2, paid: 4 };

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Same rule as public/initials.js: first + last initial, uppercase.
function initials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (parts[0][0] + last).toUpperCase();
}

// One image in both themes: the light file inline, the dark file hidden
// until the dark media query shows it. Clients without the query get light.
function themedImg(baseUrl, name, { width, height, alt = "", style = "" }) {
  const src = (theme) => `${baseUrl}/email/${name}-${theme}.png`;
  const attrs = `width="${width}" height="${height}" alt="${escapeHtml(alt)}"`;
  return `<img src="${src("light")}" ${attrs} class="em-img-light" style="display:block;border:0;${style}">`
    + `<!--[if !mso]><!--><img src="${src("dark")}" ${attrs} class="em-img-dark" style="display:none;max-height:0;overflow:hidden;border:0;${style}"><!--<![endif]-->`;
}

function stemHtml(baseUrl, stem, gapBelow) {
  const current = STEMS[stem];
  if (current == null) return "";
  const c = COLORS.light;
  const now = current === 4 ? "paid" : STEPS[current].toLowerCase();
  // Columns center the middle labels under the image's nodes (x 182, 353 of 536).
  const widths = [97, 171, 170, 98];
  const aligns = ["left", "center", "center", "right"];
  const labels = STEPS.map((label, i) => {
    const done = i < current;
    const isNow = i === current || (current === 4 && i === 3);
    const cls = isNow ? "em-accent-text" : done ? "em-text" : "em-muted";
    const color = isNow ? c.accentText : done ? c.text : c.muted;
    const weight = done || isNow ? 600 : 400;
    return `<td width="${widths[i]}" align="${aligns[i]}" class="${cls}" style="padding-top:6px;font:${weight} 13px/1.3 ${FONT_BODY};color:${color};">${label}</td>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${gapBelow}px;max-width:536px;">
          <tr><td colspan="4">${themedImg(baseUrl, `stem-${stem}`, { width: 536, height: 28, alt: `Progress: accepted, kickoff, delivered, paid. Now at ${now}.`, style: "width:100%;max-width:536px;height:auto;" })}</td></tr>
          <tr>${labels}</tr>
        </table>`;
}

function factsHtml(facts) {
  if (!facts?.length) return "";
  const c = COLORS.light;
  const rows = facts.map((f) => {
    const labelWeight = f.total ? 600 : 400;
    const valueWeight = f.plain ? 400 : 600;
    const valueClass = f.struck ? "em-text2" : "em-text";
    const valueColor = f.struck ? c.text2 : c.text;
    return `<tr>
            <td class="em-rule ${f.total ? "em-text" : "em-text2"}" style="padding:12px 0;border-bottom:1px solid ${c.rule};font:${labelWeight} 15px/1.4 ${FONT_BODY};color:${f.total ? c.text : c.text2};">${escapeHtml(f.label)}</td>
            <td align="right" class="em-rule ${valueClass}" style="padding:12px 0 12px 16px;border-bottom:1px solid ${c.rule};font:${valueWeight} 15px/1.4 ${FONT_BODY};color:${valueColor};font-variant-numeric:tabular-nums;${f.struck ? "text-decoration:line-through;" : ""}">${escapeHtml(f.value)}</td>
          </tr>`;
  }).join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-rule" style="margin:24px 0;border-top:1px solid ${c.rule};">${rows}</table>`;
}

function noteHtml(note) {
  if (!note?.text) return "";
  const c = COLORS.light;
  const name = note.name || "";
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" class="em-note" style="margin:0 0 24px;background:${c.note};border-radius:12px;">
          <tr>
            <td width="32" valign="top" style="padding:16px 0 16px 16px;">
              <div style="width:32px;height:32px;border-radius:999px;background:${c.accent};color:${c.accentOn};font:600 12px/32px ${FONT_BODY};text-align:center;">${escapeHtml(initials(name))}</div>
            </td>
            <td valign="top" style="padding:16px 16px 16px 12px;">
              ${name ? `<p class="em-text2" style="margin:0 0 2px;font:600 13px/1.3 ${FONT_BODY};color:${c.text2};">${escapeHtml(name)}</p>` : ""}
              <p class="em-text" style="margin:0;font:400 15px/1.5 ${FONT_BODY};color:${c.text};">${escapeHtml(note.text)}</p>
            </td>
          </tr>
        </table>`;
}

/**
 * @param {object} m
 * @param {string} m.subject     Used for <title>.
 * @param {string} m.preheader   Inbox preview line.
 * @param {string} [m.glyph]     offer | counter | accepted | delivered | changes | payment | review | declined
 * @param {string} [m.eyebrow]   Listing title, shown small above the heading.
 * @param {string} [m.hero]      Big amount above the heading (payouts).
 * @param {string} m.heading
 * @param {string} [m.intro]     One line under the heading.
 * @param {string} [m.stem]      kickoff | delivered | paid
 * @param {{label: string, value: string, struck?: boolean, plain?: boolean, total?: boolean}[]} [m.facts]
 * @param {{name?: string, text: string}} [m.note]  The other person's note.
 * @param {string} [m.outro]     One line above the button.
 * @param {{label: string, url: string}} [m.cta]
 * @param {{label: string, url: string}} [m.secondary]  Text link beside the button.
 * @param {string} m.baseUrl     Absolute site origin for links and images.
 * @param {string} [m.reason]    Footer line: why they got this email.
 */
function renderEmail({ subject, preheader, glyph, eyebrow, hero, heading, intro, stem, facts, note, outro, cta, secondary, baseUrl, reason }) {
  const c = COLORS.light;
  const d = COLORS.dark;
  const footerReason = reason || "You're getting this because you have a Grassroots account.";
  const dashboardUrl = `${baseUrl}/dashboard.html`;
  const settingsUrl = `${baseUrl}/settings.html`;
  const para = (text, margin) => `<p class="em-text" style="margin:${margin};font:400 16px/1.55 ${FONT_BODY};color:${c.text};">${escapeHtml(text)}</p>`;

  const glyphHtml = glyph
    ? `<div style="margin:0 0 20px;">${themedImg(baseUrl, `glyph-${glyph}`, { width: 44, height: 44 })}</div>`
    : "";
  const eyebrowHtml = eyebrow
    ? `<p class="em-muted" style="margin:0 0 8px;font:600 11px/1.3 ${FONT_BODY};letter-spacing:0.1em;text-transform:uppercase;color:${c.muted};">${escapeHtml(eyebrow)}</p>`
    : "";
  const heroHtml = hero
    ? `<p class="em-text" style="margin:0 0 4px;font:600 52px/1.05 ${FONT_DISPLAY};letter-spacing:-0.02em;color:${c.text};">${escapeHtml(hero)}</p>`
    : "";
  const headingHtml = hero
    ? `<h1 class="em-accent-text" style="margin:0 0 12px;font:600 22px/1.25 ${FONT_DISPLAY};color:${c.accentText};">${escapeHtml(heading)}</h1>`
    : `<h1 class="em-text" style="margin:0 0 12px;font:600 26px/1.2 ${FONT_DISPLAY};letter-spacing:-0.01em;color:${c.text};">${escapeHtml(heading)}</h1>`;
  const introHtml = intro ? para(intro, stem ? "0 0 24px" : "0") : "";
  const outroHtml = outro ? para(outro, "0 0 20px") : "";

  const button = cta
    ? `<td style="border-radius:999px;background:${c.accent};">
              <a href="${escapeHtml(cta.url)}" style="display:inline-block;padding:14px 24px;border-radius:999px;font:600 15px/1 ${FONT_BODY};color:${c.accentOn};text-decoration:none;">${escapeHtml(cta.label)}</a>
            </td>`
    : "";
  const secondaryLink = secondary
    ? `<td style="padding-left:20px;"><a href="${escapeHtml(secondary.url)}" class="em-accent-text" style="font:600 15px/1 ${FONT_BODY};color:${c.accentText};text-decoration:underline;">${escapeHtml(secondary.label)}</a></td>`
    : "";
  // Without facts, a note or an outro above it, the button needs its own gap.
  const actionsTop = outro || note?.text || facts?.length ? "0" : "24px";
  const actionsHtml = button || secondaryLink
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:${actionsTop} 0 0;"><tr>${button}${secondaryLink}</tr></table>`
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
  a { color: ${c.accentText}; }
  @media (prefers-color-scheme: dark) {
    .em-bg { background: ${d.bg} !important; }
    .em-card { background: transparent !important; border-color: ${d.line} !important; }
    .em-note { background: transparent !important; border: 1px solid ${d.line} !important; }
    .em-rule { border-color: ${d.line} !important; }
    .em-text { color: ${d.text} !important; }
    .em-text2 { color: ${d.text2} !important; }
    .em-muted, .em-muted a { color: ${d.muted} !important; }
    .em-accent-text { color: ${d.accentText} !important; }
    .em-img-light { display: none !important; }
    .em-img-dark { display: block !important; max-height: none !important; }
  }
  [data-ogsc] .em-bg { background: ${d.bg} !important; }
  [data-ogsc] .em-card { background: transparent !important; border-color: ${d.line} !important; }
  [data-ogsc] .em-text { color: ${d.text} !important; }
  [data-ogsc] .em-text2 { color: ${d.text2} !important; }
  [data-ogsc] .em-muted { color: ${d.muted} !important; }
  [data-ogsc] .em-accent-text { color: ${d.accentText} !important; }
</style>
</head>
<body class="em-bg" style="margin:0;padding:0;background:${c.bg};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader || "")}</div>
<table role="presentation" class="em-bg" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${c.bg};">
  <tr><td align="center" style="padding:36px 16px 40px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
      <tr><td style="padding:0 4px 20px;">
        <a href="${escapeHtml(baseUrl)}" style="text-decoration:none;">
          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
            <td valign="middle" style="padding-right:10px;">${themedImg(baseUrl, "mark", { width: 15, height: 26 })}</td>
            <td valign="middle" class="em-text" style="font:600 22px/1 ${FONT_DISPLAY};letter-spacing:-0.01em;color:${c.text};">grassroots</td>
          </tr></table>
        </a>
      </td></tr>
      <tr><td class="em-card" style="background:${c.surface};border:1px solid ${c.line};border-radius:16px;padding:32px;">
        ${glyphHtml}
        ${eyebrowHtml}
        ${heroHtml}
        ${headingHtml}
        ${introHtml}
        ${stemHtml(baseUrl, stem, facts?.length ? 4 : 24)}
        ${factsHtml(facts)}
        ${noteHtml(note)}
        ${outroHtml}
        ${actionsHtml}
      </td></tr>
      <tr><td class="em-muted" style="padding:24px 4px 0;font:400 13px/1.6 ${FONT_BODY};color:${c.muted};">
        <p style="margin:0 0 8px;">${escapeHtml(footerReason)}</p>
        <p style="margin:0 0 8px;"><a href="${escapeHtml(settingsUrl)}" style="color:${c.muted};text-decoration:underline;">Email settings</a> · <a href="${escapeHtml(dashboardUrl)}" style="color:${c.muted};text-decoration:underline;">Open dashboard</a> · Reply with questions</p>
        <p style="margin:0;">${escapeHtml(MAILING_ADDRESS)}</p>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  const text = [
    ...(eyebrow ? [eyebrow, ""] : []),
    hero ? `${hero} ${heading}` : heading,
    "",
    ...(intro ? [intro, ""] : []),
    ...(facts?.length ? [...facts.map((f) => `${f.label}: ${f.value}`), ""] : []),
    ...(note?.text ? [`${note.name ? `${note.name}: ` : ""}"${note.text}"`, ""] : []),
    ...(outro ? [outro, ""] : []),
    ...(cta ? [`${cta.label}: ${cta.url}`] : []),
    ...(secondary ? [`${secondary.label}: ${secondary.url}`] : []),
    ...(cta || secondary ? [""] : []),
    "—",
    footerReason,
    `Email settings: ${settingsUrl}`,
    `Open your dashboard: ${dashboardUrl}`,
    "Questions? Reply to this email.",
    MAILING_ADDRESS,
  ].join("\n");

  return { html, text };
}

module.exports = { renderEmail, escapeHtml };
