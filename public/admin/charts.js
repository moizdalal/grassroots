// charts.js — small SVG chart helpers (line, bars, donut, funnel,
// stacked-bars). No external libs; everything is `viewBox`-relative
// SVG so the host container controls the rendered size.

function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function fmtMoneyShort(cents) {
  const dollars = cents / 100;
  if (dollars >= 1000000) return "$" + (dollars / 1000000).toFixed(1) + "m";
  if (dollars >= 1000) return "$" + (dollars / 1000).toFixed(1) + "k";
  return "$" + Math.round(dollars);
}

function fmtCount(n) {
  if (n >= 1000) return (n / 1000).toFixed(1) + "k";
  return String(n);
}

/* ============================================================== */
/*                          LINE CHART                             */
/* ============================================================== */

// points: [{ label, value_cents }]
export function renderLineChart(host, points, opts = {}) {
  const W = 920, H = 260;
  const PAD_L = 56, PAD_R = 16, PAD_T = 18, PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;

  const values = points.map((p) => p.value_cents);
  const max = Math.max(1, ...values);
  // Round max up to a clean tick so the top isn't a weird fractional dollar.
  const niceMax = niceCeil(max);

  // X positions evenly spaced.
  const xAt = (i) => PAD_L + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const yAt = (v) => PAD_T + innerH - (v / niceMax) * innerH;

  // Gridlines + Y axis labels (5 ticks).
  const ticks = 5;
  let grid = "";
  for (let i = 0; i <= ticks; i++) {
    const v = (niceMax / ticks) * i;
    const y = yAt(v);
    grid += `<line class="ax-grid" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ax-label" x="${PAD_L - 8}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(fmtMoneyShort(v))}</text>`;
  }

  // X labels — at most ~8 to avoid crowding.
  const stride = Math.max(1, Math.ceil(points.length / 8));
  let xLabels = "";
  for (let i = 0; i < points.length; i += stride) {
    const x = xAt(i);
    xLabels += `<text class="ax-label" x="${x.toFixed(1)}" y="${H - PAD_B + 18}" text-anchor="middle">${esc(points[i].label)}</text>`;
  }

  // Area path (filled) + line path.
  let area = `M ${xAt(0).toFixed(1)} ${yAt(0).toFixed(1)} `;
  let line = "";
  let dots = "";
  for (let i = 0; i < points.length; i++) {
    const x = xAt(i), y = yAt(points[i].value_cents);
    area += `L ${x.toFixed(1)} ${y.toFixed(1)} `;
    line += `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)} `;
    dots += `<circle class="ln-dot" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5">
               <title>${esc(points[i].label)} — ${esc(fmtMoneyShort(points[i].value_cents))}</title>
             </circle>`;
  }
  area += `L ${xAt(points.length - 1).toFixed(1)} ${yAt(0).toFixed(1)} Z`;

  host.innerHTML = `
    <svg class="chart chart--line" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(opts.ariaLabel || "line chart")}">
      <defs>
        <linearGradient id="lnFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--fo-accent)" stop-opacity="0.32"/>
          <stop offset="100%" stop-color="var(--fo-accent)" stop-opacity="0"/>
        </linearGradient>
      </defs>
      ${grid}
      <path d="${area}" fill="url(#lnFill)" />
      <path d="${line}" class="ln-path" fill="none" />
      ${dots}
      ${xLabels}
    </svg>
  `;
}

function niceCeil(n) {
  if (n <= 0) return 100;
  const order = Math.pow(10, Math.floor(Math.log10(n)));
  const norm = n / order;
  const niceNorm = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return niceNorm * order;
}

/* ============================================================== */
/*                       VERTICAL BAR CHART                        */
/* ============================================================== */

// rows: [{ label, value }]
export function renderBarChart(host, rows, opts = {}) {
  const W = 720, H = 240;
  const PAD_L = 36, PAD_R = 16, PAD_T = 18, PAD_B = 56;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...rows.map((r) => r.value));
  const niceMax = niceCeil(max);
  const slot = innerW / rows.length;
  const barW = Math.min(48, slot * 0.66);

  const ticks = 4;
  let grid = "";
  for (let i = 0; i <= ticks; i++) {
    const v = (niceMax / ticks) * i;
    const y = PAD_T + innerH - (v / niceMax) * innerH;
    grid += `<line class="ax-grid" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ax-label" x="${PAD_L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${esc(opts.tickFmt ? opts.tickFmt(v) : v.toFixed(1))}</text>`;
  }

  let bars = "";
  for (let i = 0; i < rows.length; i++) {
    const cx = PAD_L + slot * (i + 0.5);
    const h = (rows[i].value / niceMax) * innerH;
    const y = PAD_T + innerH - h;
    bars += `<rect class="bar" x="${(cx - barW / 2).toFixed(1)}" y="${y.toFixed(1)}" width="${barW.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="4">
               <title>${esc(rows[i].label)} — ${esc(opts.tickFmt ? opts.tickFmt(rows[i].value) : rows[i].value.toFixed(2))}</title>
             </rect>`;
    bars += `<text class="ax-label" x="${cx.toFixed(1)}" y="${H - PAD_B + 18}" text-anchor="middle">${esc(rows[i].label)}</text>`;
    bars += `<text class="bar-val" x="${cx.toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle">${esc(opts.valFmt ? opts.valFmt(rows[i].value) : rows[i].value.toFixed(1))}</text>`;
  }

  host.innerHTML = `
    <svg class="chart chart--bar" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="${esc(opts.ariaLabel || "bar chart")}">
      ${grid}
      ${bars}
    </svg>
  `;
}

/* ============================================================== */
/*                          DONUT CHART                            */
/* ============================================================== */

// segments: [{ label, value }]
const DONUT_COLORS = [
  "var(--fo-accent)",
  "color-mix(in srgb, var(--fo-accent) 60%, var(--fo-accent-warm))",
  "var(--fo-accent-warm)",
  "color-mix(in srgb, var(--fo-accent) 40%, white)",
  "color-mix(in srgb, var(--fo-accent-warm) 60%, white)",
  "color-mix(in srgb, var(--fo-accent) 30%, black)",
];

export function renderDonut(host, segments, opts = {}) {
  const total = segments.reduce((s, r) => s + r.value, 0) || 1;
  const W = 260, H = 220;
  const cx = 120, cy = 110, rOuter = 90, rInner = 56;
  let start = -Math.PI / 2;
  let arcs = "";
  let legend = "";
  segments.forEach((seg, i) => {
    const angle = (seg.value / total) * Math.PI * 2;
    const end = start + angle;
    const large = angle > Math.PI ? 1 : 0;
    const x1 = cx + Math.cos(start) * rOuter;
    const y1 = cy + Math.sin(start) * rOuter;
    const x2 = cx + Math.cos(end) * rOuter;
    const y2 = cy + Math.sin(end) * rOuter;
    const xi1 = cx + Math.cos(end) * rInner;
    const yi1 = cy + Math.sin(end) * rInner;
    const xi2 = cx + Math.cos(start) * rInner;
    const yi2 = cy + Math.sin(start) * rInner;
    const color = DONUT_COLORS[i % DONUT_COLORS.length];
    arcs += `<path d="M ${x1.toFixed(2)} ${y1.toFixed(2)} A ${rOuter} ${rOuter} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} L ${xi1.toFixed(2)} ${yi1.toFixed(2)} A ${rInner} ${rInner} 0 ${large} 0 ${xi2.toFixed(2)} ${yi2.toFixed(2)} Z" fill="${color}">
                <title>${esc(seg.label)} — ${seg.value} (${Math.round((seg.value / total) * 100)}%)</title>
              </path>`;
    legend += `
      <li class="legend-row">
        <span class="legend-swatch" style="background:${color}"></span>
        <span class="legend-label">${esc(seg.label)}</span>
        <span class="legend-val">${seg.value}</span>
      </li>
    `;
    start = end;
  });

  host.innerHTML = `
    <div class="donut-wrap">
      <svg class="chart chart--donut" viewBox="0 0 ${W} ${H}" aria-label="${esc(opts.ariaLabel || "donut chart")}">
        ${arcs}
        <text class="donut-total" x="${cx}" y="${cy - 4}" text-anchor="middle">${esc(opts.centerLabel || total)}</text>
        <text class="donut-sub" x="${cx}" y="${cy + 14}" text-anchor="middle">${esc(opts.centerSub || "total")}</text>
      </svg>
      <ul class="legend">${legend}</ul>
    </div>
  `;
}

/* ============================================================== */
/*                            FUNNEL                               */
/* ============================================================== */

// rows: [{ label, value }] — each step shows count + drop-off vs prev.
export function renderFunnel(host, rows) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  let html = `<ol class="funnel">`;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const pct = (r.value / max) * 100;
    const prev = i > 0 ? rows[i - 1].value : null;
    const dropPct = prev != null && prev > 0 ? Math.round(((prev - r.value) / prev) * 100) : null;
    html += `
      <li class="funnel-row" style="--w:${pct.toFixed(2)}%">
        <div class="funnel-bar"><span class="funnel-bar-fill"></span></div>
        <div class="funnel-meta">
          <span class="funnel-label">${esc(r.label)}</span>
          <span class="funnel-value">${r.value}</span>
          ${dropPct != null ? `<span class="funnel-drop">−${dropPct}%</span>` : ""}
        </div>
      </li>
    `;
  }
  html += `</ol>`;
  host.innerHTML = html;
}

/* ============================================================== */
/*                       GROUPED-BARS GROWTH                       */
/* ============================================================== */

// rows: [{ label, consultants, owners }]
export function renderGroupedBars(host, rows) {
  const W = 720, H = 200;
  const PAD_L = 36, PAD_R = 16, PAD_T = 22, PAD_B = 36;
  const innerW = W - PAD_L - PAD_R;
  const innerH = H - PAD_T - PAD_B;
  const max = Math.max(1, ...rows.map((r) => r.consultants + r.owners));
  const niceMax = niceCeil(max);
  const slot = innerW / rows.length;
  const groupW = slot * 0.72;
  const barW = groupW / 2 - 2;

  const ticks = 4;
  let grid = "";
  for (let i = 0; i <= ticks; i++) {
    const v = (niceMax / ticks) * i;
    const y = PAD_T + innerH - (v / niceMax) * innerH;
    grid += `<line class="ax-grid" x1="${PAD_L}" x2="${W - PAD_R}" y1="${y.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
    grid += `<text class="ax-label" x="${PAD_L - 6}" y="${(y + 4).toFixed(1)}" text-anchor="end">${Math.round(v)}</text>`;
  }

  let bars = "";
  for (let i = 0; i < rows.length; i++) {
    const cx = PAD_L + slot * (i + 0.5);
    const hC = (rows[i].consultants / niceMax) * innerH;
    const hO = (rows[i].owners / niceMax) * innerH;
    bars += `<rect class="bar bar--consultant" x="${(cx - barW - 1).toFixed(1)}" y="${(PAD_T + innerH - hC).toFixed(1)}" width="${barW.toFixed(1)}" height="${hC.toFixed(1)}" rx="3">
               <title>consultants joined — ${rows[i].consultants}</title>
             </rect>`;
    bars += `<rect class="bar bar--owner" x="${(cx + 1).toFixed(1)}" y="${(PAD_T + innerH - hO).toFixed(1)}" width="${barW.toFixed(1)}" height="${hO.toFixed(1)}" rx="3">
               <title>business owners joined — ${rows[i].owners}</title>
             </rect>`;
    bars += `<text class="ax-label" x="${cx.toFixed(1)}" y="${H - PAD_B + 18}" text-anchor="middle">${esc(rows[i].label)}</text>`;
  }

  host.innerHTML = `
    <div class="legend-inline">
      <span class="legend-row"><span class="legend-swatch" style="background:var(--fo-accent)"></span>consultants</span>
      <span class="legend-row"><span class="legend-swatch" style="background:var(--fo-accent-warm)"></span>business owners</span>
    </div>
    <svg class="chart chart--grouped" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="new users per week">
      ${grid}
      ${bars}
    </svg>
  `;
}
