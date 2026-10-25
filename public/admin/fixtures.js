// fixtures.js — seeded synthetic data for the admin page. Everything
// derives from one PRNG seed so reloads stay stable. When this page is
// wired to real data (Supabase), each named export here gets swapped
// for a query that returns the same shape.

const SEED = 42;

// Mulberry32: tiny deterministic PRNG. Good enough for fixture data.
function makeRng(seed) {
  let s = seed >>> 0;
  return function rng() {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = makeRng(SEED);

function pick(arr) { return arr[Math.floor(rng() * arr.length)]; }
function rint(min, max) { return Math.floor(rng() * (max - min + 1)) + min; }
function chance(p) { return rng() < p; }

function pickN(arr, n) {
  const copy = arr.slice();
  const out = [];
  for (let i = 0; i < n && copy.length; i++) {
    out.push(copy.splice(Math.floor(rng() * copy.length), 1)[0]);
  }
  return out;
}

const FIRST_NAMES = [
  "Avery", "Jordan", "Sage", "Rowan", "Kai", "Mira", "Elena", "Darius", "Noor",
  "Ines", "Leo", "Amaya", "Tariq", "June", "Jules", "Rhea", "Kenji", "Isla",
  "Marco", "Ruth", "Ezra", "Lila", "Owen", "Talia", "Max", "Harper", "Kira",
  "Wren", "Asher", "Imani", "Soren", "Naya", "Rin", "Milo", "Selah", "Blake",
  "River", "Shea", "Yara", "Phoebe", "Tobi", "Linnea", "Ada", "Cyrus", "Miles",
];

const LAST_NAMES = [
  "Chen", "Patel", "Garcia", "Okafor", "Nguyen", "Kim", "Ramirez", "Ahmed",
  "Santos", "Iversen", "Delacroix", "Rao", "Ben-Ami", "Moreau", "Park",
  "Huang", "Silva", "Torres", "Khan", "Rossi", "Becker", "Ito", "Mendez",
  "Abebe", "Petrova", "Fischer", "Oduya", "Bauer", "Kapoor", "Wallace",
];

const SCHOOLS = [
  "University of Florida", "Florida State University",
  "University of Central Florida", "University of South Florida",
  "Florida International University", "Miami Dade College", "Stetson University",
];

const MAJORS = [
  "Marketing", "Finance", "Computer science", "Business administration",
  "Graphic design", "Supply chain", "Data analytics", "Communications",
  "Operations management", "Industrial engineering", "Psychology",
];

const BUSINESS_TYPES = [
  "bakery", "florist", "coffee shop", "yoga studio", "boutique",
  "pet groomer", "tutoring service", "law firm", "auto detail",
  "physical therapy clinic", "vintage record store", "food truck",
  "wedding photographer", "co-working space", "non-profit",
];

const CITIES = [
  "Gainesville, FL", "Tampa, FL", "Orlando, FL", "Miami, FL", "Jacksonville, FL",
  "Tallahassee, FL", "Fort Lauderdale, FL", "St. Petersburg, FL",
];

const CATEGORIES = [
  "Marketing", "Design", "Operations", "Research", "Engineering",
  "Finance", "Legal", "Content",
];

const LISTING_TITLES = [
  "Weekend foot-traffic push for east-side bakery",
  "Rebrand identity for vintage record store",
  "Instagram audit + 90-day content plan",
  "Wholesale pricing model for a small florist",
  "Menu redesign for a campus coffee shop",
  "Google business + maps optimization",
  "Loyalty program design for a yoga studio",
  "Operations playbook for a food truck launch",
  "Year-end donor email campaign",
  "Supply chain audit for a boutique",
  "UX pass on a clinic booking flow",
  "Ad creative refresh for Facebook + meta",
  "Spreadsheet → dashboard for monthly KPIs",
  "Trademark + DBA filing checklist",
  "Pricing tiers for a tutoring service",
  "Brand voice doc + tone guidelines",
  "SEO content map for a wedding photographer",
  "Vendor contract review for a co-working space",
  "Newsletter relaunch with new template system",
  "Hire-plan + roles draft for a 4-person team",
  "Competitive landscape brief — local florists",
  "Customer survey + interview synthesis",
  "Shopify migration + theme setup",
  "TikTok content sprint — six pieces",
  "Fundraising one-pager for a non-profit",
  "Process map for a pet grooming intake",
  "Weekly content calendar — 4 weeks",
];

const CONTRACT_TYPES = ["standard", "phased", "retainer"];
const LISTING_STATUSES = ["open", "in_progress", "closed", "draft"];

// Time anchor — keep deterministic via SEED so the "today" in the
// fixture world stays stable across reloads. Roughly aligned to today
// but the offset doesn't matter; charts read fixture time anyway.
const NOW = new Date();
NOW.setHours(14, 0, 0, 0);

function daysAgo(d) {
  const x = new Date(NOW);
  x.setDate(x.getDate() - d);
  return x;
}
function daysFromNow(d) {
  const x = new Date(NOW);
  x.setDate(x.getDate() + d);
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

function dollars(min, max) { return rint(min, max); }
function uid(prefix, n) { return `${prefix}_${n.toString(36)}_${(rng() * 1e6 | 0).toString(36)}`; }

function makeName() {
  return `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
}

function avatarHue() {
  return rint(0, 359);
}

/* ============================================================== */
/*                            USERS                                */
/* ============================================================== */

function generateUsers() {
  const consultants = [];
  const owners = [];

  // Consultants
  for (let i = 0; i < 38; i++) {
    const name = makeName();
    const joinedDaysAgo = rint(2, 220);
    consultants.push({
      id: uid("u", i),
      name,
      role: "consultant",
      school: pick(SCHOOLS),
      major: pick(MAJORS),
      city: pick(CITIES),
      joined_at: daysAgo(joinedDaysAgo),
      rating: rng() < 0.6 ? Math.round((3.7 + rng() * 1.3) * 10) / 10 : null,
      hue: avatarHue(),
    });
  }

  // Business owners
  for (let i = 0; i < 22; i++) {
    const ownerName = makeName();
    const bizType = pick(BUSINESS_TYPES);
    const bizName = `${pick(["The", "Small Batch", "Field", "Kindred", "Linden", "Ember"])} ${bizType.replace(/\b\w/g, (c) => c.toUpperCase())}`;
    const joinedDaysAgo = rint(2, 240);
    owners.push({
      id: uid("u", 100 + i),
      name: ownerName,
      role: "business_owner",
      business_name: bizName,
      business_type: bizType,
      city: pick(CITIES),
      joined_at: daysAgo(joinedDaysAgo),
      rating: rng() < 0.5 ? Math.round((4.0 + rng() * 1.0) * 10) / 10 : null,
      hue: avatarHue(),
    });
  }

  return [...consultants, ...owners];
}

/* ============================================================== */
/*                           LISTINGS                              */
/* ============================================================== */

function generateListings(owners) {
  const titles = LISTING_TITLES.slice();
  const list = [];
  for (let i = 0; i < 64; i++) {
    const owner = pick(owners);
    // Use predefined titles first; cycle with a (v2 / round 2) suffix once exhausted.
    const baseIdx = i % LISTING_TITLES.length;
    const title = i < LISTING_TITLES.length
      ? LISTING_TITLES[baseIdx]
      : `${LISTING_TITLES[baseIdx]} · round ${Math.floor(i / LISTING_TITLES.length) + 1}`;
    const created = daysAgo(rint(1, 200));
    const budgetMin = dollars(180, 1800);
    const budgetMax = budgetMin + dollars(200, 2400);
    const turnaround = pick([5, 7, 10, 14, 21, 30]);
    // Status distribution: ~35% open, ~30% in_progress, ~25% closed, ~10% draft.
    const r = rng();
    const status = r < 0.35 ? "open" : r < 0.65 ? "in_progress" : r < 0.90 ? "closed" : "draft";
    list.push({
      id: uid("l", i),
      title,
      owner_id: owner.id,
      owner_name: owner.business_name || owner.name,
      category: pick(CATEGORIES),
      contract_type: pick(CONTRACT_TYPES),
      budget_min_cents: budgetMin * 100,
      budget_max_cents: budgetMax * 100,
      turnaround_days: turnaround,
      status,
      created_at: created,
      city: owner.city,
    });
  }
  return list;
}

/* ============================================================== */
/*                             BIDS                                */
/* ============================================================== */

const BID_STATUSES = ["pending", "countered", "accepted", "rejected", "withdrawn"];
const PAYMENT_STATUSES = ["unfunded", "escrowed", "released", "refunded"];

function generateBids(listings, consultants) {
  const out = [];
  let counter = 0;
  for (const listing of listings) {
    if (listing.status === "draft") continue;
    const bidCount =
      listing.status === "open" ? rint(3, 10)
      : listing.status === "in_progress" ? rint(4, 12)
      : rint(3, 9);

    const bidders = pickN(consultants, Math.min(bidCount, consultants.length));

    // Each non-open listing gets exactly one winning bid; the rest are
    // rejected/countered/withdrawn. Open listings have no winner yet.
    let acceptedIdx = -1;
    if (listing.status !== "open") {
      acceptedIdx = Math.floor(rng() * bidders.length);
    }

    for (let i = 0; i < bidders.length; i++) {
      const bidder = bidders[i];
      const daysSinceListing = Math.max(1, Math.floor((NOW - listing.created_at) / 86400000));
      const submittedDaysAgo = rint(0, daysSinceListing);
      const submitted = daysAgo(submittedDaysAgo);
      const amount = rint(
        Math.round(listing.budget_min_cents / 100 * 0.85),
        Math.round(listing.budget_max_cents / 100 * 1.05),
      ) * 100;

      let status;
      if (i === acceptedIdx) {
        status = "accepted";
      } else {
        const r = rng();
        if (listing.status === "open") {
          status = r < 0.08 ? "withdrawn" : r < 0.22 ? "countered" : "pending";
        } else {
          status = r < 0.08 ? "withdrawn" : r < 0.18 ? "countered" : "rejected";
        }
      }

      let payment_status = "unfunded";
      if (status === "accepted") {
        const pr = rng();
        if (listing.status === "closed") {
          payment_status = pr < 0.78 ? "released" : pr < 0.92 ? "escrowed" : "refunded";
        } else {
          payment_status = pr < 0.45 ? "escrowed" : pr < 0.75 ? "released" : pr < 0.95 ? "unfunded" : "refunded";
        }
      }

      out.push({
        id: uid("b", counter++),
        listing_id: listing.id,
        consultant_id: bidder.id,
        consultant_name: bidder.name,
        amount_cents: amount,
        status,
        payment_status,
        submitted_at: submitted,
      });
    }
  }
  return out;
}

/* ============================================================== */
/*                         ENGAGEMENTS                             */
/* ============================================================== */

const ENGAGEMENT_STAGES = [
  { id: 1, label: "Offer submitted" },
  { id: 2, label: "Offer accepted" },
  { id: 3, label: "Kickoff scheduled" },
  { id: 4, label: "Work delivered" },
  { id: 5, label: "Payout released" },
];

function generateEngagements(bids, listings, users) {
  const accepted = bids.filter((b) => b.status === "accepted");
  const byListing = new Map(listings.map((l) => [l.id, l]));
  const byUser = new Map(users.map((u) => [u.id, u]));

  return accepted.map((bid, i) => {
    const listing = byListing.get(bid.listing_id);
    const owner = byUser.get(listing.owner_id);
    const consultant = byUser.get(bid.consultant_id);

    // Derive a lifecycle stage from payment status.
    let stage;
    if (bid.payment_status === "released") stage = 5;
    else if (bid.payment_status === "escrowed") stage = chance(0.55) ? 4 : 3;
    else stage = chance(0.45) ? 2 : 3;

    // Kickoff date — past for stages 4/5 (already happened); mixed
    // past/future for stage 3 (some are scheduled, some have been held
    // but work isn't delivered yet); future for stage 2 (just accepted,
    // kickoff in the calendar's near horizon).
    let kickoff_at = null;
    if (stage >= 4) {
      kickoff_at = daysAgo(rint(2, 80));
    } else if (stage === 3) {
      // 55% scheduled in the future, 45% recently held.
      kickoff_at = chance(0.55) ? daysFromNow(rint(1, 28)) : daysAgo(rint(1, 14));
    } else if (stage === 2) {
      // Stage 2 = offer accepted; kickoff almost always sits in the
      // future (the consultant just accepted and is picking a time).
      kickoff_at = chance(0.85) ? daysFromNow(rint(2, 35)) : null;
    }
    // Anchor the kickoff time to a realistic business hour (9am–5pm).
    if (kickoff_at) {
      kickoff_at.setHours(rint(9, 17), pick([0, 15, 30, 45]), 0, 0);
    }

    // Spread completed/released dates across the past ~5 months so the
    // year-to-date and 30d/7d charts both have variation. Roughly half
    // of recent releases fall in the last 3 weeks so the short-range
    // charts also have data to draw.
    const completed_at = stage >= 4
      ? (chance(0.5) ? daysAgo(rint(1, 25)) : daysAgo(rint(20, 140)))
      : null;
    const released_at = stage >= 5
      ? (chance(0.5) ? daysAgo(rint(1, 21)) : daysAgo(rint(20, 150)))
      : null;

    return {
      id: uid("e", i),
      bid_id: bid.id,
      listing_id: listing.id,
      listing_title: listing.title,
      listing_category: listing.category,
      contract_type: listing.contract_type,
      consultant_id: consultant.id,
      consultant_name: consultant.name,
      consultant_school: consultant.school,
      owner_id: owner.id,
      owner_name: owner.business_name || owner.name,
      owner_city: owner.city,
      amount_cents: bid.amount_cents,
      stage,
      stage_label: ENGAGEMENT_STAGES[stage - 1].label,
      payment_status: bid.payment_status,
      kickoff_at,
      completed_at,
      released_at,
      created_at: bid.submitted_at,
    };
  });
}

/* ============================================================== */
/*                          BUILD ALL                              */
/* ============================================================== */

const users = generateUsers();
const consultants = users.filter((u) => u.role === "consultant");
const owners = users.filter((u) => u.role === "business_owner");
const listings = generateListings(owners);
const bids = generateBids(listings, consultants);
const engagements = generateEngagements(bids, listings, users);

export const data = {
  now: NOW,
  users,
  consultants,
  owners,
  listings,
  bids,
  engagements,
};

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
  for (const c of CATEGORIES) out.set(c, { listings: 0, bids: 0 });
  for (const l of listings) {
    if (l.status === "draft") continue;
    out.get(l.category).listings += 1;
  }
  for (const b of bids) {
    const listing = listings.find((l) => l.id === b.listing_id);
    if (!listing) continue;
    out.get(listing.category).bids += 1;
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
