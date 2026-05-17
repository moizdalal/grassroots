// listing-analytics.js
// Shared helpers for listing-view analytics.
//
// Two surfaces consume this:
//   1. listing.js — per-listing analytics panel (owner only)
//   2. dashboard.js — cumulative analytics across all owner's listings
//
// One write path:
//   - trackListingView(): insert a row on every consultant page-load.
//
// Three read paths:
//   - loadListingAnalytics(listingId, listingCreatedAt)
//   - loadOwnerAnalytics(ownerId)
//   - renderAnalyticsPanel(container, analytics)

/* ============================================================== */
/*                        WRITE: TRACK VIEW                       */
/* ============================================================== */

// Skip-list keyed by listing id so refreshes within a session don't
// flood the table with redundant rows. The DB still gets one row per
// fresh session, which is granular enough for daily-bucket aggregation.
const trackedInSession = new Set();

export async function trackListingView(client, listingId, viewerId, ownerId, viewerRole) {
  if (!client || !listingId || !viewerId) return;
  if (viewerId === ownerId) return;             // owners viewing own listings don't count
  if (viewerRole !== "consultant") return;      // only consultant views matter
  if (trackedInSession.has(listingId)) return;  // dedupe per page session
  trackedInSession.add(listingId);

  try {
    const { error } = await client
      .from("listing_views")
      .insert({ listing_id: listingId, viewer_id: viewerId });
    if (error) {
      // Stay silent on schema-not-deployed errors — analytics is a soft feature.
      if (/relation .* does not exist|schema cache/i.test(error.message || "")) return;
      console.warn("[listing-views] insert failed:", error.message);
    }
  } catch (err) {
    console.warn("[listing-views] insert threw:", err);
  }
}

/* ============================================================== */
/*                       READ: ANALYTICS                          */
/* ============================================================== */

function toLocalDayKey(iso) {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function daysBetween(startIso, endDate) {
  const start = new Date(startIso);
  const end = endDate || new Date();
  const startKey = toLocalDayKey(start.toISOString());
  const endKey = toLocalDayKey(end.toISOString());
  const out = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const stop = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= stop) {
    out.push(toLocalDayKey(cursor.toISOString()));
    cursor.setDate(cursor.getDate() + 1);
    if (out.length > 365) break; // sanity guard
  }
  if (!out.length) out.push(startKey); // single-day fallback
  return out;
}

function aggregateViews(rows, dateRange) {
  const uniqueViewers = new Set();
  // (date, viewer) → 1, used so a single consultant counts once per day in
  // the histogram. Matches the "unique" framing we expose to owners.
  const dailyUniqueKeys = new Set();
  for (const v of rows || []) {
    uniqueViewers.add(v.viewer_id);
    const day = toLocalDayKey(v.created_at);
    dailyUniqueKeys.add(`${day}|${v.viewer_id}`);
  }
  const perDay = new Map(dateRange.map((d) => [d, 0]));
  for (const key of dailyUniqueKeys) {
    const day = key.split("|")[0];
    if (perDay.has(day)) perDay.set(day, perDay.get(day) + 1);
  }
  const daily = dateRange.map((d) => ({ date: d, count: perDay.get(d) || 0 }));
  return { uniqueViewers, daily };
}

function conversionPct(viewers, bidders) {
  if (!viewers.size) return null;
  return Math.round((bidders.size / viewers.size) * 100);
}

export async function loadListingAnalytics(client, listingId, listingCreatedAt) {
  if (!client || !listingId) return null;
  try {
    const [viewsRes, bidsRes] = await Promise.all([
      client
        .from("listing_views")
        .select("viewer_id, created_at")
        .eq("listing_id", listingId),
      // Also pull bid created_at so the histogram can flag days that
      // received an offer in the hover tooltip.
      client
        .from("bids")
        .select("consultant_id, created_at")
        .eq("listing_id", listingId),
    ]);

    if (viewsRes.error && /relation .* does not exist|schema cache/i.test(viewsRes.error.message || "")) {
      return { unavailable: true };
    }

    const views = viewsRes.data || [];
    const bids = bidsRes.data || [];
    const range = daysBetween(listingCreatedAt);
    const { uniqueViewers, daily } = aggregateViews(views, range);
    const uniqueBidders = new Set(bids.map((b) => b.consultant_id).filter(Boolean));

    // Tag each day with its bid count so the chart can render an
    // offer indicator on hover. Per-day bid map: { "2026-05-17": 2 }.
    const offersPerDay = new Map();
    for (const b of bids) {
      if (!b.created_at) continue;
      const day = toLocalDayKey(b.created_at);
      offersPerDay.set(day, (offersPerDay.get(day) || 0) + 1);
    }
    const dailyWithOffers = daily.map((d) => ({
      ...d,
      offers: offersPerDay.get(d.date) || 0,
    }));

    return {
      totalUniqueViewers: uniqueViewers.size,
      totalUniqueBidders: uniqueBidders.size,
      conversionPct: conversionPct(uniqueViewers, uniqueBidders),
      daily: dailyWithOffers,
      rangeDays: range.length,
    };
  } catch (err) {
    console.warn("[listing-analytics] load failed:", err);
    return null;
  }
}

export async function loadOwnerAnalytics(client, ownerId) {
  if (!client || !ownerId) return null;
  try {
    const { data: listings, error: listingsErr } = await client
      .from("listings")
      .select("id, created_at")
      .eq("owner_id", ownerId);
    if (listingsErr) return null;
    if (!listings?.length) {
      return {
        totalUniqueViewers: 0,
        totalUniqueBidders: 0,
        conversionPct: null,
        daily: [],
        listingCount: 0,
      };
    }

    const ids = listings.map((l) => l.id);
    const earliestCreated = listings.reduce(
      (min, l) => (new Date(l.created_at) < new Date(min) ? l.created_at : min),
      listings[0].created_at
    );

    const [viewsRes, bidsRes] = await Promise.all([
      client
        .from("listing_views")
        .select("viewer_id, created_at, listing_id")
        .in("listing_id", ids),
      client
        .from("bids")
        .select("consultant_id, listing_id")
        .in("listing_id", ids),
    ]);

    if (viewsRes.error && /relation .* does not exist|schema cache/i.test(viewsRes.error.message || "")) {
      return { unavailable: true, listingCount: listings.length };
    }

    const views = viewsRes.data || [];
    const bids = bidsRes.data || [];
    const range = daysBetween(earliestCreated);
    const { uniqueViewers, daily } = aggregateViews(views, range);
    const uniqueBidders = new Set(bids.map((b) => b.consultant_id).filter(Boolean));

    return {
      totalUniqueViewers: uniqueViewers.size,
      totalUniqueBidders: uniqueBidders.size,
      conversionPct: conversionPct(uniqueViewers, uniqueBidders),
      daily,
      rangeDays: range.length,
      listingCount: listings.length,
    };
  } catch (err) {
    console.warn("[listing-analytics] owner load failed:", err);
    return null;
  }
}

/* ============================================================== */
/*                      RENDER: PANEL + CHART                     */
/* ============================================================== */

function formatLabel(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// Daily-views chart layout rules:
//   * Always render at least 3 day slots. If the listing is younger
//     than that, pad with "ghost" future days that render lighter
//     and don't accept hover. Up to 7 fit on one page.
//   * Beyond 7 days, paginate into 7-day pages (oldest → newest,
//     ordered left-to-right within a page). The most-recent page
//     is active by default; dot pagination jumps between pages.
//   * Each visible bar has a y-axis scale on its left (0 / mid /
//     max) and a hover tooltip showing the date, view count, and
//     whether an offer was submitted that day.
const MIN_DAYS = 3;
const PAGE_SIZE = 7;
const TOOLTIP_FORMAT = { weekday: "short", month: "short", day: "numeric" };

function padToMinDays(daily, min = MIN_DAYS) {
  if (!daily.length) return [];
  if (daily.length >= min) return daily;
  const out = daily.slice();
  const last = new Date(out[out.length - 1].date + "T00:00:00");
  while (out.length < min) {
    last.setDate(last.getDate() + 1);
    out.push({
      date: toLocalDayKey(last.toISOString()),
      count: 0,
      offers: 0,
      ghost: true,
    });
  }
  return out;
}

function chunkPages(daily, pageSize = PAGE_SIZE) {
  if (daily.length <= pageSize) return [daily];
  const pages = [];
  for (let i = 0; i < daily.length; i += pageSize) {
    pages.push(daily.slice(i, i + pageSize));
  }
  // If the final page has fewer than pageSize slots, pad with ghost
  // future days so every page renders with the same column count.
  const last = pages[pages.length - 1];
  if (last.length < pageSize) {
    pages[pages.length - 1] = padToMinDays(last, pageSize);
  }
  return pages;
}

function buildYAxis(niceMax) {
  // Three ticks: 0, midpoint, max. Midpoint is omitted if max ≤ 2.
  const ticks = niceMax <= 2 ? [0, niceMax] : [0, Math.round(niceMax / 2), niceMax];
  return ticks
    .slice()
    .reverse()
    .map(
      (n, i) =>
        `<span class="lv-hist__y-tick"${i === 0 ? ' data-top="1"' : ""}>${n}</span>`
    )
    .join("");
}

function buildLine(pageDaily, niceMax) {
  // SVG viewBox is (100×38) and uses preserveAspectRatio="none" so
  // the polyline stretches to fill the container width — same x
  // mapping the bar version used. `vector-effect="non-scaling-stroke"`
  // keeps the line weight visually constant under that distortion.
  // The dots are rendered separately as HTML circles (see below),
  // so they stay perfectly round regardless of SVG aspect.
  const w = 100;
  const h = 38;
  const padX = 4;             // breathing room so endpoint dots don't clip
  const padTop = 6;
  const padBottom = 4;
  const usableW = w - padX * 2;
  const usableH = h - padTop - padBottom;
  const step = pageDaily.length > 1 ? usableW / (pageDaily.length - 1) : 0;

  const points = pageDaily.map((d, i) => {
    const x = padX + step * i;
    const ratio = niceMax > 0 ? d.count / niceMax : 0;
    const y = padTop + (1 - ratio) * usableH;
    const leftPct = (x / w) * 100;
    const bottomPct = ((h - y) / h) * 100;
    return { d, i, x, y, leftPct, bottomPct };
  });

  // Line — one polyline per contiguous run of real (non-ghost) days
  // so the trend doesn't drape into future placeholders.
  const runs = [];
  let cur = [];
  for (const p of points) {
    if (p.d.ghost) {
      if (cur.length) runs.push(cur);
      cur = [];
    } else {
      cur.push(p);
    }
  }
  if (cur.length) runs.push(cur);
  const lineSvg = runs
    .filter((r) => r.length >= 2)
    .map(
      (r) =>
        `<polyline class="lv-hist__line" vector-effect="non-scaling-stroke" points="${r
          .map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)
          .join(" ")}"></polyline>`
    )
    .join("");

  // Dots as HTML buttons: a fixed-pixel circle inside a larger
  // transparent hit area. The wrapper is positioned by percentage
  // so it stays aligned with the SVG line underneath, while the
  // visible mark stays perfectly round at any container width.
  const dots = points
    .map(({ d, leftPct, bottomPct }) => {
      const baseCls = ["lv-hist__dot"];
      if (d.ghost) baseCls.push("lv-hist__dot--ghost");
      else if (d.offers > 0) baseCls.push("lv-hist__dot--offer");
      const tabAttr = d.ghost ? 'tabindex="-1" disabled' : 'tabindex="0"';
      return `
        <button type="button" class="${baseCls.join(" ")}" ${tabAttr}
          style="left:${leftPct.toFixed(2)}%;bottom:${bottomPct.toFixed(2)}%"
          data-count="${d.count}" data-offers="${d.offers || 0}"
          data-date="${d.date}" data-ghost="${d.ghost ? 1 : 0}"
          aria-label="${formatLabel(d.date)}: ${d.count} view${d.count === 1 ? "" : "s"}">
          <span class="lv-hist__dot-mark" aria-hidden="true"></span>
        </button>
      `;
    })
    .join("");

  // X-axis labels — anchor the first label to the left edge and the
  // last to the right edge so they don't overflow the chart. Middle
  // labels stay centered under their dot.
  const lastIdx = pageDaily.length - 1;
  const labels = pageDaily
    .map((d, i) => {
      const leftPct = ((padX + step * i) / w) * 100;
      let style = `left:${leftPct.toFixed(2)}%`;
      let extra = "";
      if (i === 0) extra = " lv-hist__label--first";
      else if (i === lastIdx) extra = " lv-hist__label--last";
      return `<span class="lv-hist__label${d.ghost ? " lv-hist__label--ghost" : ""}${extra}" style="${style}">${formatLabel(d.date)}</span>`;
    })
    .join("");

  return { svgInner: lineSvg, dots, labels, w, h };
}

function buildPageContent(pageDaily, niceMax, pageIndex) {
  const { svgInner, dots, labels, w, h } = buildLine(pageDaily, niceMax);
  return `
    <div class="lv-hist__page" data-page="${pageIndex}">
      <div class="lv-hist__plot">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
          ${svgInner}
        </svg>
        <div class="lv-hist__dots-layer">${dots}</div>
      </div>
      <div class="lv-hist__axis">${labels}</div>
    </div>
  `;
}

function renderHistogram(daily) {
  if (!daily?.length) return "";
  const padded = padToMinDays(daily, MIN_DAYS);
  const max = Math.max(1, ...padded.map((d) => d.count));
  const niceMax = niceCeil(max);
  const pages = chunkPages(padded, PAGE_SIZE);
  const lastIdx = pages.length - 1;

  const yAxis = buildYAxis(niceMax);
  const pagesHtml = pages.map((p, i) => buildPageContent(p, niceMax, i)).join("");
  const dotsHtml =
    pages.length > 1
      ? `<div class="lv-hist__dots" role="tablist" aria-label="daily views pages">
          ${pages
            .map(
              (_, i) =>
                `<button type="button" role="tab" class="lv-hist__dot${i === lastIdx ? " is-active" : ""}" data-target-page="${i}" aria-label="page ${i + 1} of ${pages.length}"></button>`
            )
            .join("")}
        </div>`
      : "";

  // The tooltip is a single shared element inside the chart — JS
  // moves it to the hovered bar's x position and rewrites its
  // contents. Hidden by default; offers row stays hidden unless the
  // hovered day has an offer count > 0.
  const tooltip = `
    <div class="lv-hist__tooltip" id="lv-hist-tooltip" hidden>
      <span class="lv-hist__tooltip-date" data-tooltip="date"></span>
      <span class="lv-hist__tooltip-views" data-tooltip="views">0 views</span>
      <span class="lv-hist__tooltip-offers" data-tooltip="offers" hidden></span>
    </div>
  `;

  return `
    <div class="lv-hist" data-page-count="${pages.length}" data-active-page="${lastIdx}">
      <div class="lv-hist__body">
        <div class="lv-hist__y-axis" aria-hidden="true">${yAxis}</div>
        <div class="lv-hist__pages">
          ${pagesHtml}
          ${tooltip}
        </div>
      </div>
      ${dotsHtml}
    </div>
  `;
}

function niceCeil(n) {
  if (n <= 1) return 1;
  if (n <= 2) return 2;
  if (n <= 5) return 5;
  if (n <= 10) return 10;
  const order = Math.pow(10, Math.floor(Math.log10(n)));
  const m = n / order;
  if (m <= 1) return order;
  if (m <= 2) return 2 * order;
  if (m <= 5) return 5 * order;
  return 10 * order;
}

function escapeText(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderAnalyticsPanel(container, analytics, opts = {}) {
  if (!container) return;
  // `compact: true` drops the daily-views histogram + the subtitle and
  // stacks the metrics vertically. Used on the no-scroll owner home
  // where the panel sits in a narrow right rail.
  const { title = "performance", subtitle = "", compact = false } = opts;

  if (!analytics) {
    container.innerHTML = `
      <div class="lv-panel${compact ? " lv-panel--compact" : ""}">
        <div class="lv-panel__head">
          <h2 class="lv-panel__title">${escapeText(title)}</h2>
        </div>
        <p class="lv-panel__empty">couldn't load analytics. try refreshing.</p>
      </div>
    `;
    return;
  }

  if (analytics.unavailable) {
    container.innerHTML = `
      <div class="lv-panel${compact ? " lv-panel--compact" : ""}">
        <div class="lv-panel__head">
          <h2 class="lv-panel__title">${escapeText(title)}</h2>
        </div>
        <p class="lv-panel__empty">analytics will appear here once the supabase migration is applied (see <code>supabase/migrations/add_listing_views.sql</code>).</p>
      </div>
    `;
    return;
  }

  const conversion = analytics.conversionPct == null ? "—" : `${analytics.conversionPct}%`;
  const conversionSub =
    analytics.conversionPct == null
      ? "no views yet"
      : `${analytics.totalUniqueBidders} of ${analytics.totalUniqueViewers} viewer${analytics.totalUniqueViewers === 1 ? "" : "s"} submitted an offer`;

  const histogram = compact ? "" : renderHistogram(analytics.daily);

  container.innerHTML = `
    <div class="lv-panel${compact ? " lv-panel--compact" : ""}">
      <div class="lv-panel__head">
        <h2 class="lv-panel__title">${escapeText(title)}</h2>
        ${!compact && subtitle ? `<p class="lv-panel__sub">${escapeText(subtitle)}</p>` : ""}
      </div>

      <div class="lv-metrics">
        <div class="lv-metric">
          <p class="lv-metric__value">${analytics.totalUniqueViewers}</p>
          <p class="lv-metric__label">unique viewers</p>
        </div>
        <div class="lv-metric lv-metric--accent">
          <p class="lv-metric__value">${conversion}</p>
          <p class="lv-metric__label">
            view → offer rate
            <button type="button" class="lv-metric__info" aria-expanded="false" aria-controls="lv-conversion-sub" aria-label="show conversion details">?</button>
            <span class="lv-metric__sub" id="lv-conversion-sub" hidden>${escapeText(conversionSub)}</span>
          </p>
        </div>
      </div>

      ${compact ? "" : `
      <div class="lv-section">
        <div class="lv-section__head">
          <p class="lv-section__eyebrow">daily views</p>
          <p class="lv-section__hint">${analytics.daily.length} day${analytics.daily.length === 1 ? "" : "s"} since listed</p>
        </div>
        ${histogram || '<p class="lv-panel__empty">no views yet.</p>'}
      </div>
      `}
    </div>
  `;

  // Hist interactions only apply when the chart is rendered (not in
  // compact mode). The conversion "?" toggle ships on both surfaces.
  if (!compact) wireHistogramInteractions(container);
  wireConversionInfoToggle(container);
}

// "?" affordance next to the view→offer rate label. Click flips the
// hidden subtext on/off (the "N of M viewers submitted an offer" copy).
function wireConversionInfoToggle(root) {
  const btn = root.querySelector(".lv-metric__info");
  const sub = root.querySelector("#lv-conversion-sub");
  if (!btn || !sub) return;
  btn.addEventListener("click", () => {
    const open = btn.getAttribute("aria-expanded") === "true";
    btn.setAttribute("aria-expanded", String(!open));
    sub.hidden = open;
  });
}

// Slide-paging via dot nav + hover tooltip for the daily-views chart.
// Idempotent: safe to call after every render of the panel.
function wireHistogramInteractions(root) {
  const hist = root.querySelector(".lv-hist");
  if (!hist) return;

  const pagesWrap = hist.querySelector(".lv-hist__pages");
  const pageCount = parseInt(hist.dataset.pageCount || "1", 10);
  const dots = [...hist.querySelectorAll(".lv-hist__dot")];

  function setActivePage(i) {
    const clamped = Math.max(0, Math.min(pageCount - 1, i));
    hist.dataset.activePage = String(clamped);
    pagesWrap.style.setProperty("--page-offset", `-${clamped * 100}%`);
    dots.forEach((d, idx) => d.classList.toggle("is-active", idx === clamped));
    // Hide any lingering tooltip when jumping pages.
    const tip = hist.querySelector(".lv-hist__tooltip");
    if (tip) tip.hidden = true;
  }

  // Apply initial offset based on the active page set in markup.
  setActivePage(parseInt(hist.dataset.activePage || "0", 10));

  dots.forEach((dot) => {
    dot.addEventListener("click", () => {
      setActivePage(parseInt(dot.dataset.targetPage || "0", 10));
    });
  });

  const tooltip = hist.querySelector(".lv-hist__tooltip");
  if (!tooltip) return;
  const dateEl = tooltip.querySelector('[data-tooltip="date"]');
  const viewsEl = tooltip.querySelector('[data-tooltip="views"]');
  const offersEl = tooltip.querySelector('[data-tooltip="offers"]');

  function showTooltipForDot(dot) {
    const ghost = dot.dataset.ghost === "1";
    if (ghost) {
      tooltip.hidden = true;
      return;
    }
    const count = parseInt(dot.dataset.count || "0", 10);
    const offers = parseInt(dot.dataset.offers || "0", 10);
    const date = dot.dataset.date;
    if (!date) return;
    const [y, m, d] = date.split("-").map(Number);
    const dateObj = new Date(y, m - 1, d);
    dateEl.textContent = dateObj.toLocaleDateString("en-US", TOOLTIP_FORMAT);
    viewsEl.textContent = `${count} ${count === 1 ? "view" : "views"}`;
    if (offers > 0) {
      offersEl.textContent = `${offers} ${offers === 1 ? "offer" : "offers"} submitted`;
      offersEl.hidden = false;
    } else {
      offersEl.hidden = true;
    }
    // Show the tooltip first so we can measure it, then clamp its
    // left position so the bubble never overflows the pages wrapper.
    tooltip.hidden = false;
    const histRect = pagesWrap.getBoundingClientRect();
    const dotRect = dot.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const centerX = dotRect.left + dotRect.width / 2 - histRect.left;
    const half = tipRect.width / 2;
    const margin = 6;
    const clamped = Math.max(
      half + margin,
      Math.min(histRect.width - half - margin, centerX)
    );
    const leftPct = (clamped / histRect.width) * 100;
    tooltip.style.left = `${leftPct.toFixed(2)}%`;
  }

  function clearTooltipForLeave(target) {
    // Only hide if the cursor actually left the dot, not when it
    // moved into the visible circle inside it.
    if (!target?.closest(".lv-hist__dot")) tooltip.hidden = true;
  }

  pagesWrap.addEventListener("mouseover", (e) => {
    const dot = e.target.closest(".lv-hist__dot");
    if (!dot) return;
    showTooltipForDot(dot);
  });
  pagesWrap.addEventListener("focusin", (e) => {
    const dot = e.target.closest(".lv-hist__dot");
    if (!dot) return;
    showTooltipForDot(dot);
  });
  pagesWrap.addEventListener("mouseleave", () => {
    tooltip.hidden = true;
  });
  pagesWrap.addEventListener("focusout", (e) => {
    clearTooltipForLeave(e.relatedTarget);
  });
}
