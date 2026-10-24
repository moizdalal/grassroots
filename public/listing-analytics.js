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

// Three ticks: 0, midpoint, max. Midpoint is omitted if max ≤ 2.
// Shared by the y-axis labels and the SVG gridlines so both stay in
// lockstep with whatever the chart's niceMax resolves to.
function ticksForMax(niceMax) {
  return niceMax <= 2 ? [0, niceMax] : [0, Math.round(niceMax / 2), niceMax];
}

function buildYAxis(niceMax) {
  const usableYPct = 100 - PLOT_PAD_TOP_PCT - PLOT_PAD_BOTTOM_PCT;
  return ticksForMax(niceMax)
    .map((tick) => {
      const ratio = niceMax > 0 ? tick / niceMax : 0;
      // Project the tick's SVG-relative y position into the y-axis
      // box, which spans the full plot height (including the plot's
      // 0.6rem top/bottom padding). The 100% - 1.2rem term resolves
      // to the SVG content height; padding the result by 0.6rem puts
      // the tick at the same screen-y as a node with the same ratio.
      const yFromTopPct = PLOT_PAD_TOP_PCT + (1 - ratio) * usableYPct;
      const topStyle = `calc(0.6rem + ${yFromTopPct.toFixed(2)} * (100% - 1.2rem) / 100)`;
      return `<span class="lv-hist__y-tick" style="top:${topStyle}">${tick}</span>`;
    })
    .join("");
}

// Plot geometry — percentages mirror the original viewBox 100×38 math
// (padX=4, padTop=6, padBottom=4) so HTML node positions and the SVG
// curve share the same reference grid.
const PLOT_PAD_X_PCT = 4;
const PLOT_PAD_TOP_PCT = (6 / 38) * 100;
const PLOT_PAD_BOTTOM_PCT = (4 / 38) * 100;
const PLOT_INSET_PX = 9.6; // matches .lv-hist__plot padding (0.6rem @ 16px)

function buildCurve(pageDaily, niceMax) {
  // The SVG path is drawn after layout (see drawCurves) so it can use
  // measured screen pixels matched to the container. This function
  // emits the HTML node + label markup plus serialized day data the
  // post-render hook reads off the plot element.
  const stepPct = pageDaily.length > 1
    ? (100 - PLOT_PAD_X_PCT * 2) / (pageDaily.length - 1)
    : 0;
  const usableYPct = 100 - PLOT_PAD_TOP_PCT - PLOT_PAD_BOTTOM_PCT;

  const nodes = pageDaily
    .map((d, i) => {
      const leftPct = pageDaily.length > 1
        ? PLOT_PAD_X_PCT + stepPct * i
        : 50;
      const ratio = niceMax > 0 ? d.count / niceMax : 0;
      const bottomPct = PLOT_PAD_BOTTOM_PCT + ratio * usableYPct;

      const baseCls = ["lv-hist__node"];
      if (d.ghost) baseCls.push("lv-hist__node--ghost");
      else if (d.offers > 0) baseCls.push("lv-hist__node--offer");
      // Plain divs — nodes are visual-only data markers, no click
      // affordance. Tooltip still fires on hover via mouseover.
      return `
        <div class="${baseCls.join(" ")}" role="img"
          style="left:${leftPct.toFixed(2)}%;bottom:${bottomPct.toFixed(2)}%"
          data-count="${d.count}" data-offers="${d.offers || 0}"
          data-date="${d.date}" data-ghost="${d.ghost ? 1 : 0}"
          aria-label="${formatLabel(d.date)}: ${d.count} view${d.count === 1 ? "" : "s"}">
          <span class="lv-hist__node-mark" aria-hidden="true"></span>
        </div>
      `;
    })
    .join("");

  const todayKey = toLocalDayKey(new Date().toISOString());
  const labels = pageDaily
    .map((d, i) => {
      const leftPct = pageDaily.length > 1
        ? PLOT_PAD_X_PCT + stepPct * i
        : 50;
      // Mirror the nodes-layer's coordinate space: nodes-layer is inset
      // 0.6rem inside the plot, so a node at X% sits at
      //   0.6rem + X% * (plot_width - 1.2rem)
      // from the plot's left edge. The axis container has no matching
      // inset, so we project the same screen-x via calc() instead of
      // letting a bare `left: X%` resolve against the wider axis box.
      const labelLeft = `calc(0.6rem + ${leftPct.toFixed(2)} * (100% - 1.2rem) / 100)`;
      const cls = [
        "lv-hist__label",
        d.ghost ? "lv-hist__label--ghost" : null,
        d.date === todayKey ? "lv-hist__label--today" : null,
      ]
        .filter(Boolean)
        .join(" ");
      return `<span class="${cls}" style="left:${labelLeft}">${formatLabel(d.date)}</span>`;
    })
    .join("");

  // Compact, attribute-safe payload for drawCurves.
  const daysJson = JSON.stringify(
    pageDaily.map((d) => ({ c: d.count, g: d.ghost ? 1 : 0 }))
  ).replace(/"/g, "&quot;");

  return { nodes, labels, daysJson, niceMax };
}

function buildPageContent(pageDaily, niceMax, pageIndex) {
  const { nodes, labels, daysJson, niceMax: nm } = buildCurve(
    pageDaily,
    niceMax
  );
  return `
    <div class="lv-hist__page" data-page="${pageIndex}">
      <div class="lv-hist__plot" data-days="${daysJson}" data-nice-max="${nm}">
        <svg class="lv-hist__svg" aria-hidden="true"></svg>
        <div class="lv-hist__nodes-layer">${nodes}</div>
      </div>
      <div class="lv-hist__axis">${labels}</div>
    </div>
  `;
}

// Draw the smooth curve in screen-pixel coordinates so it stays
// aligned with the HTML node centers. One continuous Catmull-Rom path
// per contiguous run of real (non-ghost) days. Called after the panel
// is in the DOM so we can measure plot dimensions.
function drawCurves(container) {
  const plots = container.querySelectorAll(".lv-hist__plot[data-days]");
  plots.forEach((plot) => {
    const svg = plot.querySelector(".lv-hist__svg");
    if (!svg) return;
    let days;
    try {
      days = JSON.parse(plot.dataset.days || "[]");
    } catch {
      return;
    }
    if (!days.length) return;
    const niceMax = parseFloat(plot.dataset.niceMax || "1") || 1;
    const rect = plot.getBoundingClientRect();
    const W = Math.max(1, rect.width - PLOT_INSET_PX * 2);
    const H = Math.max(1, rect.height - PLOT_INSET_PX * 2);

    const padX = (PLOT_PAD_X_PCT / 100) * W;
    const padTop = (PLOT_PAD_TOP_PCT / 100) * H;
    const padBottom = (PLOT_PAD_BOTTOM_PCT / 100) * H;
    const usableW = W - padX * 2;
    const usableH = H - padTop - padBottom;
    const step = days.length > 1 ? usableW / (days.length - 1) : 0;

    const points = days.map((d, i) => {
      const x = days.length > 1 ? padX + step * i : W / 2;
      const ratio = niceMax > 0 ? d.c / niceMax : 0;
      const y = padTop + (1 - ratio) * usableH;
      return { x, y, ghost: !!d.g };
    });

    // Contiguous runs of real (non-ghost) days so the curve doesn't
    // drape into placeholder future days.
    const runs = [];
    let cur = [];
    for (const p of points) {
      if (p.ghost) {
        if (cur.length) runs.push(cur);
        cur = [];
      } else {
        cur.push(p);
      }
    }
    if (cur.length) runs.push(cur);

    // One continuous Catmull-Rom path per run, passing directly through
    // every node center. Control-point y is clamped to each segment's
    // own band so the curve can't overshoot above/below its endpoints
    // — that's what keeps a {high, low, low, high} sequence from
    // dipping below the flat middle.
    let pathStr = "";
    for (const run of runs) {
      if (run.length < 2) continue;
      pathStr += ` M${run[0].x.toFixed(2)},${run[0].y.toFixed(2)}`;
      for (let i = 0; i < run.length - 1; i++) {
        const p0 = run[i - 1] || run[i];
        const p1 = run[i];
        const p2 = run[i + 1];
        const p3 = run[i + 2] || run[i + 1];
        const c1 = {
          x: p1.x + (p2.x - p0.x) / 6,
          y: p1.y + (p2.y - p0.y) / 6,
        };
        const c2 = {
          x: p2.x - (p3.x - p1.x) / 6,
          y: p2.y - (p3.y - p1.y) / 6,
        };
        const yMin = Math.min(p1.y, p2.y);
        const yMax = Math.max(p1.y, p2.y);
        if (c1.y < yMin) c1.y = yMin;
        else if (c1.y > yMax) c1.y = yMax;
        if (c2.y < yMin) c2.y = yMin;
        else if (c2.y > yMax) c2.y = yMax;

        pathStr += ` C${c1.x.toFixed(2)},${c1.y.toFixed(2)} ${c2.x.toFixed(2)},${c2.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
      }
    }

    svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.innerHTML = pathStr
      ? `<path class="lv-hist__curve" vector-effect="non-scaling-stroke" d="${pathStr.trim()}"></path>`
      : "";
  });
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
      ? `<div class="lv-hist__dots" role="tablist" aria-label="Daily views pages">
          ${pages
            .map(
              (_, i) =>
                `<button type="button" role="tab" class="lv-hist__dot${i === lastIdx ? " is-active" : ""}" data-target-page="${i}" aria-label="Page ${i + 1} of ${pages.length}"></button>`
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
        <p class="lv-panel__empty">Couldn't load analytics. Try refreshing.</p>
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
        <p class="lv-panel__empty">Analytics will appear here once the Supabase migration is applied (see <code>supabase/migrations/add_listing_views.sql</code>).</p>
      </div>
    `;
    return;
  }

  const conversion = analytics.conversionPct == null ? "—" : `${analytics.conversionPct}%`;
  const conversionSub =
    analytics.conversionPct == null
      ? "No views yet"
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
          <p class="lv-metric__label">Unique viewers</p>
        </div>
        <div class="lv-metric lv-metric--accent">
          <p class="lv-metric__value">${conversion}</p>
          <p class="lv-metric__label">
            View → offer rate
            <button type="button" class="lv-metric__info" aria-expanded="false" aria-controls="lv-conversion-sub" aria-label="Show conversion details">?</button>
            <span class="lv-metric__sub" id="lv-conversion-sub" hidden>${escapeText(conversionSub)}</span>
          </p>
        </div>
      </div>

      ${compact ? "" : `
      <div class="lv-section">
        <div class="lv-section__head">
          <p class="lv-section__eyebrow">Daily views</p>
          <p class="lv-section__hint">${analytics.daily.length} day${analytics.daily.length === 1 ? "" : "s"} since listed</p>
        </div>
        ${histogram || '<p class="lv-panel__empty">No views yet.</p>'}
      </div>
      `}
    </div>
  `;

  // Hist interactions only apply when the chart is rendered (not in
  // compact mode). The conversion "?" toggle ships on both surfaces.
  if (!compact) {
    wireHistogramInteractions(container);
    setupCurveDrawing(container);
  }
  wireConversionInfoToggle(container);
}

// Draw the curve once the panel is in the DOM, then redraw whenever
// the container's size changes so each segment keeps terminating at
// the node perimeter (HTML nodes are positioned by % and adapt
// automatically, but the SVG path is in measured pixels). Observing
// the container, not the window, also catches layout shifts that
// never fire a window resize: side-nav wrapping the page, the
// sidebar collapse transition, and web fonts swapping in.
function setupCurveDrawing(container) {
  let queued = false;
  const draw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      drawCurves(container);
    });
  };
  draw();
  container.__lvCurveObserver?.disconnect();
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(draw);
    observer.observe(container);
    container.__lvCurveObserver = observer;
  } else {
    const prior = container.__lvCurveHandler;
    if (prior) window.removeEventListener("resize", prior);
    container.__lvCurveHandler = draw;
    window.addEventListener("resize", draw);
  }
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

  function showTooltipForNode(node) {
    const ghost = node.dataset.ghost === "1";
    if (ghost) {
      tooltip.hidden = true;
      return;
    }
    const count = parseInt(node.dataset.count || "0", 10);
    const offers = parseInt(node.dataset.offers || "0", 10);
    const date = node.dataset.date;
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
    const nodeRect = node.getBoundingClientRect();
    const tipRect = tooltip.getBoundingClientRect();
    const centerX = nodeRect.left + nodeRect.width / 2 - histRect.left;
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
    if (!target?.closest(".lv-hist__node")) tooltip.hidden = true;
  }

  pagesWrap.addEventListener("mouseover", (e) => {
    const node = e.target.closest(".lv-hist__node");
    if (!node) return;
    showTooltipForNode(node);
  });
  pagesWrap.addEventListener("focusin", (e) => {
    const node = e.target.closest(".lv-hist__node");
    if (!node) return;
    showTooltipForNode(node);
  });
  pagesWrap.addEventListener("mouseleave", () => {
    tooltip.hidden = true;
  });
  pagesWrap.addEventListener("focusout", (e) => {
    clearTooltipForLeave(e.relatedTarget);
  });
}
