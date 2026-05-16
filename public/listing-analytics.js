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
      client
        .from("bids")
        .select("consultant_id")
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

    return {
      totalUniqueViewers: uniqueViewers.size,
      totalUniqueBidders: uniqueBidders.size,
      conversionPct: conversionPct(uniqueViewers, uniqueBidders),
      daily,
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

function pickLabelStride(n) {
  // Keep x-axis labels readable — show 6–8 labels at most regardless of range.
  if (n <= 8) return 1;
  if (n <= 14) return 2;
  if (n <= 30) return 5;
  if (n <= 90) return 14;
  return Math.ceil(n / 8);
}

function renderHistogram(daily) {
  if (!daily?.length) return "";
  const max = Math.max(1, ...daily.map((d) => d.count));
  // Round the max up to a nicer y-axis cap (1, 2, 5, 10, 25, 50, …).
  const niceMax = niceCeil(max);
  const w = 100; // viewBox width — bars + gaps in arbitrary units, SVG scales
  const h = 38;  // viewBox height — bar plot only; labels live outside
  const barGap = 0.18;
  const barW = Math.max(1, (w - barGap * (daily.length - 1)) / daily.length);
  const stride = pickLabelStride(daily.length);

  const bars = daily
    .map((d, i) => {
      const x = i * (barW + barGap);
      const ratio = d.count / niceMax;
      const barH = Math.max(0.6, ratio * h); // floor so 0/1-count bars still register
      const y = h - barH;
      const r = Math.min(barW / 2, 1.4);
      return `<rect class="lv-hist__bar${d.count > 0 ? " lv-hist__bar--has" : ""}"
        x="${x.toFixed(2)}" y="${y.toFixed(2)}"
        width="${barW.toFixed(2)}" height="${barH.toFixed(2)}"
        rx="${r}" ry="${r}"
        data-count="${d.count}" data-date="${d.date}"></rect>`;
    })
    .join("");

  const labels = daily
    .map((d, i) => {
      if (i % stride !== 0 && i !== daily.length - 1) return "";
      const x = i * (barW + barGap) + barW / 2;
      return `<text class="lv-hist__label" x="${x.toFixed(2)}" y="0">${formatLabel(d.date)}</text>`;
    })
    .filter(Boolean)
    .join("");

  return `
    <div class="lv-hist">
      <div class="lv-hist__plot">
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true">
          ${bars}
        </svg>
      </div>
      <div class="lv-hist__axis">
        <svg viewBox="0 0 ${w} 4" preserveAspectRatio="none" aria-hidden="true">
          ${labels}
        </svg>
      </div>
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
  const { title = "performance", subtitle = "" } = opts;

  if (!analytics) {
    container.innerHTML = `
      <div class="lv-panel">
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
      <div class="lv-panel">
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

  const histogram = renderHistogram(analytics.daily);

  container.innerHTML = `
    <div class="lv-panel">
      <div class="lv-panel__head">
        <h2 class="lv-panel__title">${escapeText(title)}</h2>
        ${subtitle ? `<p class="lv-panel__sub">${escapeText(subtitle)}</p>` : ""}
      </div>

      <div class="lv-metrics">
        <div class="lv-metric">
          <p class="lv-metric__value">${analytics.totalUniqueViewers}</p>
          <p class="lv-metric__label">unique viewers</p>
        </div>
        <div class="lv-metric lv-metric--accent">
          <p class="lv-metric__value">${conversion}</p>
          <p class="lv-metric__label">view → offer rate</p>
          <p class="lv-metric__sub">${escapeText(conversionSub)}</p>
        </div>
      </div>

      <div class="lv-section">
        <div class="lv-section__head">
          <p class="lv-section__eyebrow">daily views</p>
          <p class="lv-section__hint">${analytics.daily.length} day${analytics.daily.length === 1 ? "" : "s"} since listed</p>
        </div>
        ${histogram || '<p class="lv-panel__empty">no views yet.</p>'}
      </div>
    </div>
  `;
}
