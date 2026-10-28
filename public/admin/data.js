// data.js — live marketplace data for the admin page. loadAdminData()
// pulls every user, listing, bid and engagement from
// /api/admin/marketplace (admin-gated server-side), then the aggregate
// exports below derive the KPIs, charts and tables from those rows.

import { getSupabaseClient } from "/supabase-loader.js";

const STAGE_LABELS = {
  1: "Offer submitted",
  2: "Offer accepted",
  3: "Kickoff scheduled",
  4: "Work delivered",
  5: "Payout released",
};

let NOW = new Date();
let users = [];
let listings = [];
let bids = [];
let engagements = [];

export const data = {
  now: NOW,
  users,
  consultants: [],
  owners: [],
  listings,
  bids,
  engagements,
};

function daysAgo(d) {
  const x = new Date(NOW);
  x.setDate(x.getDate() - d);
  return x;
}
function hoursAgo(h) {
  const x = new Date(NOW);
  x.setHours(x.getHours() - h);
  return x;
}
function startOfYear() {
  return new Date(NOW.getFullYear(), 0, 1);
}

const toDate = (v) => (v ? new Date(v) : null);

// Free-text categories ("marketing", "Marketing", null) fold into one
// sentence-cased label per category.
function categoryLabel(raw) {
  const s = String(raw || "").trim().toLowerCase();
  if (!s) return "Uncategorized";
  return s[0].toUpperCase() + s.slice(1);
}

export async function loadAdminData() {
  const client = await getSupabaseClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token) throw new Error("Not signed in");

  const res = await fetch("/api/admin/marketplace", {
    headers: { Authorization: `Bearer ${session.access_token}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);

  NOW = new Date(body.now || Date.now());
  users = (body.users || []).map((u) => ({ ...u, joined_at: toDate(u.joined_at) }));
  listings = (body.listings || []).map((l) => ({
    ...l,
    category: categoryLabel(l.category),
    created_at: toDate(l.created_at),
  }));
  bids = (body.bids || []).map((b) => ({ ...b, submitted_at: toDate(b.submitted_at) }));
  engagements = (body.engagements || []).map((e) => ({
    ...e,
    listing_category: categoryLabel(e.listing_category),
    stage_label: STAGE_LABELS[e.stage] || "—",
    kickoff_at: toDate(e.kickoff_at),
    completed_at: toDate(e.completed_at),
    released_at: toDate(e.released_at),
    created_at: toDate(e.created_at),
  }));

  Object.assign(data, {
    now: NOW,
    users,
    consultants: users.filter((u) => u.role === "consultant"),
    owners: users.filter((u) => u.role === "business_owner"),
    listings,
    bids,
    engagements,
  });
}

/* ============================================================== */
/*                       DERIVED / AGGREGATES                      */
/* ============================================================== */

export function totalUsers() { return users.length; }
export function totalListings() { return listings.length; }
export function totalEngagements() { return engagements.length; }
export function activeEngagements() { return engagements.filter((e) => e.stage >= 2 && e.stage < 5).length; }
export function totalBids() { return bids.length; }
export function openListings() { return listings.filter((l) => l.status === "open").length; }

export function totalVolumeCents(rangeDays = null) {
  const cutoff = rangeDays == null ? null : daysAgo(rangeDays);
  return engagements
    .filter((e) => e.payment_status === "released")
    .filter((e) => !cutoff || (e.released_at && e.released_at >= cutoff))
    .reduce((s, e) => s + e.amount_cents, 0);
}

export function bidAcceptanceRate() {
  const considered = bids.filter((b) => b.status !== "withdrawn" && b.status !== "pending");
  if (!considered.length) return 0;
  return considered.filter((b) => b.status === "accepted").length / considered.length;
}

export function avgEngagementValueCents() {
  if (!engagements.length) return 0;
  return Math.round(engagements.reduce((s, e) => s + e.amount_cents, 0) / engagements.length);
}

export function kickoffsThisWeek() {
  const start = new Date(NOW); start.setHours(0, 0, 0, 0); start.setDate(start.getDate() - start.getDay());
  const end = new Date(start); end.setDate(end.getDate() + 7);
  return engagements.filter((e) => e.kickoff_at && e.kickoff_at >= start && e.kickoff_at < end);
}

// Money-moved time series. Each point = total $ released in that bucket.
// range: 'day' (24 hourly buckets), 'week' (7 daily), 'month' (30 daily),
// 'ytd' (one bucket per month from Jan → current month).
export function moneyMovedSeries(range) {
  const series = [];
  if (range === "day") {
    for (let h = 23; h >= 0; h--) {
      const start = hoursAgo(h + 1);
      const end = hoursAgo(h);
      const sum = engagements
        .filter((e) => e.released_at && e.released_at >= start && e.released_at < end)
        .reduce((s, e) => s + e.amount_cents, 0);
      series.push({ label: `${(NOW.getHours() - h + 24) % 24}:00`, value_cents: sum });
    }
  } else if (range === "week" || range === "month") {
    const days = range === "week" ? 7 : 30;
    for (let d = days - 1; d >= 0; d--) {
      const start = daysAgo(d + 1); start.setHours(0, 0, 0, 0);
      const end = daysAgo(d); end.setHours(0, 0, 0, 0);
      const sum = engagements
        .filter((e) => e.released_at && e.released_at >= start && e.released_at < end)
        .reduce((s, e) => s + e.amount_cents, 0);
      const labelDate = daysAgo(d);
      series.push({
        label: labelDate.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
        value_cents: sum,
      });
    }
  } else if (range === "ytd") {
    const yearStart = startOfYear();
    const months = NOW.getMonth() + 1;
    for (let m = 0; m < months; m++) {
      const start = new Date(yearStart); start.setMonth(m);
      const end = new Date(yearStart); end.setMonth(m + 1);
      const sum = engagements
        .filter((e) => e.released_at && e.released_at >= start && e.released_at < end)
        .reduce((s, e) => s + e.amount_cents, 0);
      series.push({
        label: start.toLocaleDateString(undefined, { month: "short" }),
        value_cents: sum,
      });
    }
  }
  return series;
}

// Funnel data — counts at each step. Each step is gross of the next.
export function funnelData() {
  const listingsPosted = listings.filter((l) => l.status !== "draft").length;
  const totalBidsCount = bids.length;
  const acceptedCount = bids.filter((b) => b.status === "accepted").length;
  const kickedOffCount = engagements.filter((e) => e.stage >= 3).length;
  const completedCount = engagements.filter((e) => e.stage >= 4).length;
  const paidCount = engagements.filter((e) => e.stage === 5).length;
  return [
    { label: "Listings posted", value: listingsPosted },
    { label: "Offers submitted", value: totalBidsCount },
    { label: "Offers accepted", value: acceptedCount },
    { label: "Kickoffs scheduled", value: kickedOffCount },
    { label: "Work delivered", value: completedCount },
    { label: "Payout released", value: paidCount },
  ];
}

// Status breakdown — for donut.
export function engagementStatusBreakdown() {
  const counts = new Map();
  for (const e of engagements) {
    counts.set(e.stage_label, (counts.get(e.stage_label) || 0) + 1);
  }
  return Array.from(counts.entries()).map(([label, value]) => ({ label, value }));
}

// Offer-rate-by-category: avg offers per listing in each category.
export function offersByCategory() {
  const out = new Map();
  const byId = new Map(listings.map((l) => [l.id, l]));
  const row = (c) => {
    if (!out.has(c)) out.set(c, { listings: 0, bids: 0 });
    return out.get(c);
  };
  for (const l of listings) {
    if (l.status === "draft") continue;
    row(l.category).listings += 1;
  }
  for (const b of bids) {
    const listing = byId.get(b.listing_id);
    if (!listing) continue;
    row(listing.category).bids += 1;
  }
  return Array.from(out.entries()).map(([category, v]) => ({
    category,
    listings: v.listings,
    bids: v.bids,
    avg_per_listing: v.listings ? v.bids / v.listings : 0,
  }));
}

// Top performers by total released volume.
export function topConsultants(n = 8) {
  const totals = new Map();
  for (const e of engagements) {
    if (e.payment_status !== "released") continue;
    totals.set(e.consultant_id, (totals.get(e.consultant_id) || 0) + e.amount_cents);
  }
  return Array.from(totals.entries())
    .map(([id, cents]) => ({
      user: users.find((u) => u.id === id),
      cents,
    }))
    .filter((row) => row.user)
    .sort((a, b) => b.cents - a.cents)
    .slice(0, n);
}

// Recent activity feed — last N events across listings, bids, engagements.
export function recentActivity(n = 12) {
  const events = [];
  for (const l of listings) {
    events.push({
      kind: "listing_posted",
      at: l.created_at,
      label: `${l.owner_name} posted "${l.title}"`,
      icon: "listing",
    });
  }
  for (const b of bids.slice(0, 80)) {
    events.push({
      kind: "bid_submitted",
      at: b.submitted_at,
      label: `${b.consultant_name} submitted a $${(b.amount_cents / 100).toFixed(0)} offer`,
      icon: "bid",
    });
  }
  for (const e of engagements) {
    if (e.released_at) {
      events.push({
        kind: "payout_released",
        at: e.released_at,
        label: `${e.consultant_name} was paid $${(e.amount_cents / 100).toFixed(0)} for "${e.listing_title}"`,
        icon: "payout",
      });
    } else if (e.kickoff_at && e.kickoff_at < NOW) {
      events.push({
        kind: "kickoff_held",
        at: e.kickoff_at,
        label: `kickoff: ${e.consultant_name} × ${e.owner_name}`,
        icon: "kickoff",
      });
    }
  }
  return events
    .sort((a, b) => b.at - a.at)
    .slice(0, n);
}

// Upcoming kickoffs for the calendar view + the dashboard tile.
export function upcomingKickoffs() {
  return engagements
    .filter((e) => e.kickoff_at && e.kickoff_at >= NOW)
    .sort((a, b) => a.kickoff_at - b.kickoff_at);
}

// All kickoffs (past + future), used by the calendar.
export function allKickoffs() {
  return engagements
    .filter((e) => e.kickoff_at)
    .sort((a, b) => a.kickoff_at - b.kickoff_at);
}

// Per-user engagement counts and totals — used in the users table.
export function userStats(userId) {
  const e = engagements.filter((x) => x.consultant_id === userId || x.owner_id === userId);
  const released = e.filter((x) => x.payment_status === "released");
  return {
    count: e.length,
    total_cents: released.reduce((s, x) => s + x.amount_cents, 0),
  };
}

// 4-week new-user growth (consultants vs owners).
export function userGrowthByWeek(weeks = 12) {
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const start = daysAgo((w + 1) * 7);
    const end = daysAgo(w * 7);
    out.push({
      label: end.toLocaleDateString(undefined, { month: "short", day: "numeric" }),
      consultants: users.filter((u) => u.role === "consultant" && u.joined_at >= start && u.joined_at < end).length,
      owners: users.filter((u) => u.role === "business_owner" && u.joined_at >= start && u.joined_at < end).length,
    });
  }
  return out;
}
