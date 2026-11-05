// emails.js — the admin "emails" tab. Live data from /api/admin/emails:
// how many emails Resend sent today and this month against the plan caps,
// a daily trend with the daily cap drawn in, which emails go out most, and
// recent failures (a 429 means Resend refused it for a limit).

import { getSupabaseClient } from "/supabase-loader.js";

const EVENT_LABELS = {
  offer_received: "Offer received",
  counter_received: "Counter received",
  counter_accepted: "Counter accepted",
  counter_declined: "Counter declined",
  counter_rescinded: "Offer withdrawn",
  offer_accepted: "Offer accepted",
  work_delivered: "Work delivered",
  changes_requested: "Changes requested",
  payment_released_business: "Payment released (business)",
  payment_released_consultant: "Payment released (consultant)",
  consultant_review: "Review of a consultant",
  business_review: "Review of a business",
  other: "Account and support",
};

let rangeDays = 30;
let loading = null;

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n) => Number(n || 0).toLocaleString();
const shortDay = (date) => new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
const when = (iso) => new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const eventLabel = (e) => EVENT_LABELS[e] || e.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());

function infoBtn(explain) {
  return `<button type="button" class="adm-info" aria-label="What does this mean" data-info="${esc(explain)}">
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" stroke-width="1.4"/>
      <circle cx="8" cy="4.5" r="0.9" fill="currentColor"/>
      <path d="M8 7v5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
    </svg>
  </button>`;
}

// Tile with a meter: green under 70% of the cap, warm at 70% or more.
function meterTile({ label, used, limit, sub, explain }) {
  const pct = limit ? Math.min(100, (used / limit) * 100) : 0;
  const tone = pct >= 70 ? "warn" : "good";
  return `
    <div class="adm-kpi adm-kpi--graded adm-kpi--${tone}">
      <div class="adm-kpi__label">${esc(label)} ${infoBtn(explain)}</div>
      <div class="adm-kpi__value">${num(used)} <span class="adm-email-of">of ${num(limit)}</span></div>
      <div class="adm-email-meter" role="meter" aria-valuemin="0" aria-valuemax="${limit}" aria-valuenow="${used}" aria-label="${esc(label)}">
        <span class="adm-email-meter__fill adm-email-meter__fill--${tone}" style="width:${pct.toFixed(1)}%"></span>
      </div>
      <div class="adm-kpi__sub">${esc(sub)}</div>
    </div>`;
}

function plainTile({ label, value, sub, explain, tone }) {
  return `
    <div class="adm-kpi${tone ? ` adm-kpi--graded adm-kpi--${tone}` : ""}">
      <div class="adm-kpi__label">${esc(label)} ${infoBtn(explain)}</div>
      <div class="adm-kpi__value">${esc(String(value))}</div>
      <div class="adm-kpi__sub">${esc(sub)}</div>
    </div>`;
}

function drawTiles(d) {
  const now = new Date();
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const dayOfMonth = now.getUTCDate();
  const pace = Math.round((d.month / dayOfMonth) * daysInMonth);
  const avg = d.days ? d.sent_in_window / d.days : 0;

  document.getElementById("adm-email-tiles").innerHTML = [
    meterTile({
      label: "Sent today",
      used: d.today,
      limit: d.limits.daily,
      sub: `${num(Math.max(0, d.limits.daily - d.today))} left before the daily cap`,
      explain: "Emails Resend accepted since midnight UTC, when its daily count resets. Past the cap, Resend refuses the rest of the day's emails and they are lost.",
    }),
    meterTile({
      label: "Sent this month",
      used: d.month,
      limit: d.limits.monthly,
      sub: `On pace for about ${num(pace)} this month`,
      explain: "Emails sent since the 1st, against the monthly cap. The pace assumes the rest of the month looks like the days so far. Resend may reset on your billing date instead, so check its dashboard near the cap.",
    }),
    plainTile({
      label: `Daily average · ${d.days}d`,
      value: avg > 0 && avg < 0.1 ? "<0.1" : avg.toFixed(1),
      sub: d.busiest_day ? `Busiest day ${shortDay(d.busiest_day.date)} · ${num(d.busiest_day.sent)}` : "No emails yet",
      explain: "Average emails sent per day over the window. Compare the busiest day with the daily cap to see how much room you have.",
    }),
    plainTile({
      label: `Failed · ${d.days}d`,
      value: num(d.failed_in_window),
      sub: d.limit_hits ? `${num(d.limit_hits)} refused for a limit` : "None refused for a limit",
      tone: d.limit_hits ? "warn" : d.failed_in_window ? "warn" : "good",
      explain: "Emails Resend did not send. A limit refusal (code 429) means you hit the daily cap or sent too fast. Those emails are not retried.",
    }),
  ].join("");
}

// Daily bars with the daily cap as a dashed line. The y scale always shows
// the cap so the gap between usage and the limit is visible.
function drawTrend(d) {
  const host = document.getElementById("adm-email-trend");
  const W = 920, H = 240, L = 44, R = 16, T = 16, B = 34;
  const iw = W - L - R, ih = H - T - B;
  const peak = Math.max(...d.daily.map((x) => x.sent + x.failed), 0);
  const max = Math.max(d.limits.daily, peak) * 1.08;
  const y = (v) => T + ih - (v / max) * ih;
  const slot = iw / d.daily.length;
  const bw = Math.max(3, Math.min(22, slot * 0.7));
  const stride = Math.max(1, Math.ceil(d.daily.length / 8));

  let grid = "";
  for (let i = 0; i <= 4; i++) {
    const v = Math.round((d.limits.daily / 4) * i);
    grid += `<line class="ax-grid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`;
    grid += `<text class="ax-label" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${v}</text>`;
  }

  let bars = "";
  d.daily.forEach((day, i) => {
    const cx = L + slot * (i + 0.5);
    const x = (cx - bw / 2).toFixed(1);
    const title = `<title>${esc(shortDay(day.date))}: ${day.sent} sent${day.failed ? `, ${day.failed} failed` : ""}</title>`;
    if (day.sent) bars += `<rect class="bar" x="${x}" y="${y(day.sent).toFixed(1)}" width="${bw.toFixed(1)}" height="${(ih + T - y(day.sent)).toFixed(1)}" rx="3">${title}</rect>`;
    if (day.failed) bars += `<rect class="adm-email-bar--failed" x="${x}" y="${y(day.sent + day.failed).toFixed(1)}" width="${bw.toFixed(1)}" height="${(y(day.sent) - y(day.sent + day.failed)).toFixed(1)}" rx="3">${title}</rect>`;
    if (i % stride === 0) bars += `<text class="ax-label" x="${cx.toFixed(1)}" y="${H - B + 20}" text-anchor="middle">${esc(shortDay(day.date))}</text>`;
  });

  const cap = y(d.limits.daily).toFixed(1);
  host.innerHTML = `
    <svg class="chart chart--bar" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="Emails sent per day">
      ${grid}
      ${bars}
      <line class="adm-email-cap" x1="${L}" x2="${W - R}" y1="${cap}" y2="${cap}"/>
      <text class="adm-email-cap__label" x="${W - R}" y="${(Number(cap) - 6).toFixed(1)}" text-anchor="end">Daily cap · ${num(d.limits.daily)}</text>
    </svg>`;
}

function drawEvents(d) {
  const host = document.getElementById("adm-email-events");
  if (!d.by_event.length) {
    host.innerHTML = `<p class="adm-cell-sub">No emails sent in this window.</p>`;
    return;
  }
  const top = d.by_event[0].sent;
  host.innerHTML = `<ul class="adm-email-events">${d.by_event.map((e) => `
    <li>
      <div class="adm-email-events__row"><span>${esc(eventLabel(e.event))}</span><span class="adm-email-events__n">${num(e.sent)}</span></div>
      <div class="adm-email-meter"><span class="adm-email-meter__fill adm-email-meter__fill--good" style="width:${((e.sent / top) * 100).toFixed(1)}%"></span></div>
    </li>`).join("")}</ul>`;
}

function drawFailures(d) {
  const tbody = document.getElementById("adm-email-fail-tbody");
  tbody.innerHTML = d.recent_failures.length
    ? d.recent_failures.map((f) => `
      <tr>
        <td>${esc(when(f.sent_at))}</td>
        <td>${esc(eventLabel(f.event))}</td>
        <td>${f.http_status === 429 ? `<span class="adm-pill adm-pill--warn">Limit · 429</span>` : esc(f.http_status ?? "No response")}</td>
        <td>${esc(f.environment || "—")}</td>
        <td class="adm-cell-sub">${esc((f.error || "").slice(0, 140))}</td>
      </tr>`).join("")
    : `<tr><td colspan="5" class="adm-cell-sub">No failed emails. Good.</td></tr>`;
}

export async function renderEmails(force = false) {
  if (loading && !force) return loading;
  const status = document.getElementById("adm-email-status");
  const body = document.getElementById("adm-email-body");
  status.hidden = false;
  status.className = "adm-gate";
  status.textContent = "Loading…";

  loading = (async () => {
    try {
      const client = await getSupabaseClient();
      const { data: { session } } = await client.auth.getSession();
      const res = await fetch(`/api/admin/emails?days=${rangeDays}`, {
        headers: session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {},
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load email stats.");
      status.hidden = true;
      body.hidden = false;
      drawTiles(data);
      drawTrend(data);
      drawEvents(data);
      drawFailures(data);
    } catch (err) {
      status.className = "adm-gate adm-gate--error";
      status.textContent = err.message;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

document.querySelectorAll("[data-email-range]").forEach((b) => {
  b.addEventListener("click", () => {
    rangeDays = Number(b.dataset.emailRange) || 30;
    document.querySelectorAll("[data-email-range]").forEach((x) => x.classList.toggle("is-active", x === b));
    renderEmails(true);
  });
});
