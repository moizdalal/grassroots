// consultant-dashboard.js — landing surface for consultants.
// Mirrors the owner dashboard but oriented around their bids: active
// engagements, action items needing a response, a recommended listing
// to browse, an unread-only inbox preview, and profile health.

import { getSupabaseClient } from "/supabase-loader.js";
import { fetchRatingFor, renderRatingMarkup } from "/rating.js";
import { getInitials } from "/initials.js";
import { renderHealthBucket } from "/health-bucket.js";
import { mountEngagementJourneyFlowers } from "/engagement-journey-flowers.js";
import { mountDashboardNotifications } from "/dashboard-notifications.js";

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const isMissing = (err) =>
  !!err && /(does not exist|not found|relation .* does not exist|column .* does not exist)/i.test(err.message || "");

function relTime(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.round(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtUSD(cents) {
  if (!Number.isFinite(Number(cents))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
}

function publicAvatarUrl(client, path) {
  if (!path) return null;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

/* ============================================================== */
/*                          DATA LOADING                          */
/* ============================================================== */

async function loadData(client, userId) {
  const [profileRes, consultantRes, portfolioRes] = await Promise.all([
    client
      .from("profiles")
      .select("id, full_name, role, avatar_path, linkedin_url, resume_path, stripe_account_status")
      .eq("id", userId)
      .single(),
    client
      .from("consultant_profiles")
      .select("user_id, headline, bio, major, minor, school")
      .eq("user_id", userId)
      .maybeSingle(),
    // Count of portfolio items — feeds the profile-health "past work" check.
    // We only need the count, not the rows; supabase's `head: true` returns it
    // in a header without payload.
    client
      .from("portfolio_items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  if (profileRes.error) {
    const e = new Error(profileRes.error.message || "could not load profile.");
    throw e;
  }
  const profile = profileRes.data;
  const consultant = consultantRes.data;
  const portfolioCount = portfolioRes.count || 0;

  // Bids the consultant has placed. The flower journey wants every
  // status (pending → accepted → completed → released) so a freshly
  // submitted bid can render as a seed; `payment_status` distinguishes
  // stage 4 (work delivered, awaiting payout) from stage 5 (paid out).
  const { data: bids } = await client
    .from("bids")
    .select(
      "id, listing_id, consultant_id, amount_cents, message, status, payment_status, paid_at, released_at, counter_offer_cents, counter_offer_message, counter_expires_at, counter_responded_at, counter_response_message, counter_attempted, accepted_at, proposal_due_at, proposal_path, created_at"
    )
    .eq("consultant_id", userId)
    .order("created_at", { ascending: false });

  const listingIds = [...new Set((bids || []).map((b) => b.listing_id).filter(Boolean))];
  let listings = [];
  if (listingIds.length) {
    const { data } = await client
      .from("listings")
      .select("id, owner_id, title, status, business_display_name")
      .in("id", listingIds);
    listings = data || [];
  }
  const listingMap = new Map(listings.map((l) => [l.id, l]));

  // Owner profile/biz info for engagements
  const ownerIds = [...new Set(listings.map((l) => l.owner_id).filter(Boolean))];
  const ownerMap = new Map();
  const ownerBizMap = new Map();
  if (ownerIds.length) {
    const [{ data: ownerProfiles }, { data: ownerBiz }] = await Promise.all([
      client.from("profiles").select("id, full_name, avatar_path").in("id", ownerIds),
      client.from("business_profiles").select("user_id, business_name").in("user_id", ownerIds),
    ]);
    for (const p of ownerProfiles || []) ownerMap.set(p.id, p);
    for (const b of ownerBiz || []) ownerBizMap.set(b.user_id, b.business_name);
  }

  // Engagement schedules — keyed by bid id so the journey panel can derive
  // each engagement's lifecycle stage. Stage 3 (kickoff scheduled) and
  // stage 4 (work delivered) are both read off `engagement_schedules.status`;
  // stage 5 (payout received) is read off `bids.payment_status`. We try the
  // database first, then fall back to localStorage for any bid that didn't
  // return a row.
  // engagement.js writes a copy under `grassroots_engagement_schedule_<bid>`
  // when the supabase table is missing or the user is mid-flow without a
  // round-trip; reading from there means the action-dot still fires for
  // engagements only persisted client-side.
  const acceptedBidIds = (bids || [])
    .filter((b) => b.status === "accepted")
    .map((b) => b.id);
  const scheduleMap = new Map();
  if (acceptedBidIds.length) {
    try {
      // The journey only needs `bid_id` + `status` to derive the stage
      // and the action item. Earlier we also selected `selected_start`,
      // `selected_end` and `duration_minutes`, but `duration_minutes`
      // doesn't exist in the production schema and the whole query
      // failed silently as a result — every engagement loaded with a
      // `null` schedule and stage detection fell through to the
      // listing-based fallback (so a completed engagement read as
      // stage 3 / "work delivered" instead of stage 4 / "completed",
      // and its filtering behaviour was wrong on the current/all toggle).
      // Keep the select narrow + tied to fields the journey actually uses.
      const { data: schedules, error } = await client
        .from("engagement_schedules")
        .select("bid_id, status")
        .in("bid_id", acceptedBidIds);
      if (error) console.warn("schedule fetch error", error);
      for (const s of schedules || []) scheduleMap.set(s.bid_id, s);
    } catch (err) {
      console.warn("schedule load failed", err);
    }
    // localStorage fallback for any bid that didn't come back from the DB
    for (const bidId of acceptedBidIds) {
      if (scheduleMap.has(bidId)) continue;
      try {
        const raw = localStorage.getItem(`grassroots_engagement_schedule_${bidId}`);
        if (!raw) continue;
        const local = JSON.parse(raw);
        if (local && typeof local === "object") {
          scheduleMap.set(bidId, local);
        }
      } catch (_) {}
    }
  }

  // Recommended: most recent open listing the consultant hasn't bid on
  const myBidListings = new Set(listingIds);
  let recommended = null;
  try {
    const { data } = await client
      .from("listings")
      .select(
        "id, owner_id, title, category, problem_summary, status, budget_cents, created_at, business_display_name"
      )
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(20);
    recommended = (data || []).find((l) => !myBidListings.has(l.id) && l.owner_id !== userId) || null;
    if (recommended && !ownerMap.has(recommended.owner_id)) {
      const [{ data: recProfile }, { data: recBiz }] = await Promise.all([
        client.from("profiles").select("id, full_name, avatar_path").eq("id", recommended.owner_id).maybeSingle(),
        client
          .from("business_profiles")
          .select("user_id, business_name")
          .eq("user_id", recommended.owner_id)
          .maybeSingle(),
      ]);
      if (recProfile) ownerMap.set(recProfile.id, recProfile);
      if (recBiz) ownerBizMap.set(recBiz.user_id, recBiz.business_name);
    }
  } catch (err) {
    console.warn("recommended load failed", err);
  }

  // Inbox: unread messages where consultant is recipient
  let unreadThreads = [];
  let unreadCount = 0;
  try {
    const [{ data: msgs }, { data: reads }] = await Promise.all([
      client
        .from("messages")
        .select("id, listing_id, sender_id, recipient_id, body, created_at")
        .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
        .order("created_at", { ascending: false })
        .limit(500),
      client
        .from("message_reads")
        .select("listing_id, other_user_id, last_read_at")
        .eq("user_id", userId),
    ]);
    const readMap = new Map();
    for (const r of reads || []) {
      readMap.set(`${r.listing_id}:${r.other_user_id}`, new Date(r.last_read_at).getTime());
    }
    const threads = new Map();
    for (const m of msgs || []) {
      const otherId = m.sender_id === userId ? m.recipient_id : m.sender_id;
      if (!otherId || !m.listing_id) continue;
      const key = `${m.listing_id}:${otherId}`;
      let t = threads.get(key);
      if (!t) {
        t = { key, listingId: m.listing_id, otherId, lastBody: m.body, lastAt: m.created_at, fromMe: m.sender_id === userId, unread: 0 };
        threads.set(key, t);
      }
      if (m.recipient_id === userId) {
        const lastRead = readMap.get(key) || 0;
        if (new Date(m.created_at).getTime() > lastRead) t.unread += 1;
      }
    }
    unreadThreads = [...threads.values()].filter((t) => t.unread > 0).sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));
    unreadCount = unreadThreads.reduce((n, t) => n + t.unread, 0);

    // Hydrate threads with listing+counterpart info
    const threadListingIds = new Set(unreadThreads.slice(0, 5).map((t) => t.listingId));
    const threadOtherIds = new Set(unreadThreads.slice(0, 5).map((t) => t.otherId));
    if (threadListingIds.size) {
      const { data: tListings } = await client
        .from("listings")
        .select("id, title")
        .in("id", [...threadListingIds]);
      const map = new Map((tListings || []).map((l) => [l.id, l]));
      for (const t of unreadThreads) t.listingTitle = map.get(t.listingId)?.title || "";
    }
    if (threadOtherIds.size) {
      const [{ data: tProfiles }, { data: tBiz }] = await Promise.all([
        client.from("profiles").select("id, full_name, role, avatar_path").in("id", [...threadOtherIds]),
        client.from("business_profiles").select("user_id, business_name").in("user_id", [...threadOtherIds]),
      ]);
      const pmap = new Map((tProfiles || []).map((p) => [p.id, p]));
      const bmap = new Map((tBiz || []).map((b) => [b.user_id, b.business_name]));
      for (const t of unreadThreads) {
        const p = pmap.get(t.otherId);
        t.otherName = bmap.get(t.otherId) || p?.full_name || "business";
        t.otherAvatar = p?.avatar_path || null;
      }
    }
  } catch (err) {
    console.warn("inbox preview failed", err);
  }

  return {
    userId,
    profile,
    consultant,
    portfolioCount,
    bids: bids || [],
    listingMap,
    ownerMap,
    ownerBizMap,
    scheduleMap,
    recommended,
    unreadThreads,
    unreadCount,
  };
}

// Build the engagements list the journey panel consumes. Now returns
// every bid in any status — the flower journey shows pending bids as
// seeds (stage 1), accepted bids as sprouts (stage 2), etc. The panel
// itself filters out premature engagements (those that ended without
// payout). Each entry is joined with its listing, owner, counterpart
// name, and engagement_schedule (when present).
function journeyEngagements(bids, listingMap, ownerMap, ownerBizMap, scheduleMap) {
  return (bids || []).map((bid) => {
    const listing = listingMap.get(bid.listing_id);
    const owner = ownerMap.get(listing?.owner_id);
    const counterpart = counterpartName(listing?.owner_id, ownerMap, ownerBizMap);
    const schedule = scheduleMap?.get(bid.id) || null;
    return { bid, listing, owner, counterpart, schedule };
  });
}

/* ============================================================== */
/*                         RENDER HELPERS                         */
/* ============================================================== */

function counterpartName(ownerId, ownerMap, ownerBizMap) {
  return ownerBizMap.get(ownerId) || ownerMap.get(ownerId)?.full_name || "business";
}

// activeEngagements + renderEngagements were retired when the
// notifications + active engagements panels were replaced by the
// engagement journey. Stage detection + species assignment now live
// in /engagement-journey-flowers.js; we just hand it every bid
// enriched with listing/owner/schedule.

function renderRecommended(client, listing, ownerMap, ownerBizMap) {
  const root = $("cdash-recommended");
  const empty = $("cdash-recommended-empty");
  if (!listing) {
    root.innerHTML = "";
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  const counterpart = counterpartName(listing.owner_id, ownerMap, ownerBizMap);
  const owner = ownerMap.get(listing.owner_id);
  const avatarUrl = publicAvatarUrl(client, owner?.avatar_path);
  const avatar = avatarUrl
    ? `<img class="gr-listing-logo" src="${escape(avatarUrl)}" alt=""/>`
    : `<div class="gr-listing-logo-placeholder">${escape(getInitials(counterpart))}</div>`;
  const tags = (listing.category || "")
    .split(",")
    .map((c) => c.trim())
    .filter(Boolean)
    .slice(0, 3);
  const summary = listing.problem_summary
    ? String(listing.problem_summary).trim().slice(0, 90).replace(/\s+\S*$/, "") + "…"
    : "";
  root.innerHTML = `
    <a class="gr-listing-card cdash__recommended-card" href="/listing.html?id=${escape(listing.id)}">
      <div class="gr-listing-card-head">
        <div class="gr-listing-logo-wrap">${avatar}</div>
        <div class="gr-listing-card-biz">
          <span class="gr-listing-biz-label">posted by</span>
          <p class="gr-listing-biz-name">${escape(counterpart)}</p>
        </div>
      </div>
      <div class="gr-listing-card-body">
        <h3 class="gr-listing-title">${escape(listing.title)}</h3>
        ${summary ? `<p class="gr-listing-summary">${escape(summary)}</p>` : ""}
      </div>
      <div class="gr-listing-foot">
        ${tags.length ? `<div class="gr-listing-tags">${tags.slice(0, 2).map((t) => `<span class="gr-listing-tag">${escape(t)}</span>`).join("")}</div>` : "<span></span>"}
        <div class="gr-listing-foot-end">
          ${Number.isFinite(Number(listing.budget_cents)) ? `<p class="gr-listing-budget">${escape(fmtUSD(listing.budget_cents))}</p>` : ""}
          <span class="gr-listing-cta-link">view →</span>
        </div>
      </div>
    </a>
  `;
}

function renderInboxPreview(client, threads, unreadCount) {
  const root = $("cdash-inbox-preview");
  const empty = $("cdash-inbox-empty");
  const badge = $("cdash-inbox-badge");
  if (badge) {
    badge.textContent = String(unreadCount);
    badge.hidden = unreadCount === 0;
  }
  if (!threads.length) {
    root.innerHTML = "";
    empty.hidden = false;
    empty.textContent = "you're all caught up.";
    empty.classList.add("dash-inbox-empty--caught-up");
    return;
  }
  empty.hidden = true;
  root.innerHTML = threads
    .slice(0, 3)
    .map((t) => {
      const url = publicAvatarUrl(client, t.otherAvatar);
      const av = url ? `<img src="${escape(url)}" alt=""/>` : escape(getInitials(t.otherName));
      return `
        <a class="bza__inbox-row" href="/inbox.html#thread=${escape(t.listingId)}:${escape(t.otherId)}" style="text-decoration:none">
          <span class="bza__inbox-avatar">${av}</span>
          <div style="flex:1;min-width:0">
            ${t.listingTitle ? `<div class="bza__inbox-listing">re: ${escape(t.listingTitle)}</div>` : ""}
            <div class="bza__inbox-name">${escape(t.otherName || "")}<span class="bza__inbox-unread">${t.unread}</span></div>
            <div class="bza__inbox-msg">${escape(t.lastBody || "")}</div>
          </div>
          <div class="bza__inbox-time">${escape(relTime(t.lastAt))}</div>
        </a>
      `;
    })
    .join("");
}

/* ============================================================== */
/*                         PROFILE HEALTH                         */
/* ============================================================== */

const HEALTH_PALETTE = [
  "var(--fo-accent)",
  "var(--fo-develop)",
  "#a3d099",
  "var(--fo-do)",
  "var(--fo-accent-warm)",
];

/* Profile-health fields are weighted by impact on a consultant's ability
   to land work. Stripe payouts is the largest single item — without it,
   they literally can't be paid (and bid submission is gated on it). Resume
   and past-work samples carry the next-highest weight because that's the
   credibility evidence businesses scan first. */
const HEALTH_FIELDS = [
  { key: "payouts",     label: "payouts",       cta: "set up payouts",        weight: 25, href: "/payouts.html" },
  { key: "resume",      label: "resume",        cta: "upload your resume",    weight: 15, href: "/settings.html#professional" },
  { key: "portfolio",   label: "past work",     cta: "add past work samples", weight: 15, href: "/settings.html#professional" },
  { key: "photo",       label: "profile photo", cta: "add a profile photo",   weight: 10, href: "/settings.html#personal" },
  { key: "name",        label: "full name",     cta: "add your full name",    weight: 10, href: "/settings.html#personal" },
  { key: "linkedin",    label: "linkedin",      cta: "link your linkedin",    weight:  8, href: "/settings.html#personal" },
  { key: "school",      label: "school",        cta: "add your school",       weight:  7, href: "/settings.html#professional" },
  { key: "major",       label: "major",         cta: "add your major",        weight:  5, href: "/settings.html#professional" },
  { key: "minor",       label: "minor",         cta: "add your minor",        weight:  5, href: "/settings.html#professional" },
];

function consultantHealth(profile, consultant, portfolioCount) {
  const filledChecks = {
    payouts:   profile?.stripe_account_status === "active",
    resume:    !!profile?.resume_path,
    portfolio: (portfolioCount || 0) > 0,
    photo:     !!profile?.avatar_path,
    name:      !!(profile?.full_name && profile.full_name.trim()),
    linkedin:  !!profile?.linkedin_url,
    school:    !!consultant?.school,
    major:     !!consultant?.major,
    minor:     !!consultant?.minor,
  };

  const fields = HEALTH_FIELDS.map((f, i) => ({
    ...f,
    filled: !!filledChecks[f.key],
    color: HEALTH_PALETTE[i % HEALTH_PALETTE.length],
  }));

  const totalWeight = fields.reduce((sum, f) => sum + f.weight, 0);
  const filledWeight = fields.filter((f) => f.filled).reduce((sum, f) => sum + f.weight, 0);
  const pct = Math.round((filledWeight / totalWeight) * 100);

  const done = fields.filter((f) => f.filled).length;
  const total = fields.length;

  // Sort missing items by weight DESC so the CTA always names the highest-
  // impact gap first. Stable order keeps lower-weight ties predictable.
  const missing = fields
    .filter((f) => !f.filled)
    .sort((a, b) => b.weight - a.weight);

  let tierName;
  if (pct >= 100) tierName = "complete";
  else if (pct >= 67) tierName = "almost there";
  else if (pct >= 34) tierName = "needs attention";
  else tierName = "needs love";

  return { pct, done, total, fields, missing, tierName };
}

function renderHealth(panel, health, consultantId) {
  const isComplete = health.pct >= 100;
  panel.classList.toggle("is-complete", isComplete);
  panel.classList.toggle("is-incomplete", !isComplete);

  let copy;
  let cta;
  let ctaHref;
  if (isComplete) {
    copy = "your profile is complete. businesses can see exactly who they'd hire.";
    cta = "open profile";
    ctaHref = "/profile.html";
  } else {
    // health.missing is sorted by weight DESC, so the first item is always
    // the highest-impact gap (typically payouts, then resume, then portfolio).
    const next = health.missing[0];
    cta = next.cta;
    ctaHref = next.href;
    // Tone copy for the top three weight tiers; everything else gets a
    // generic line so we don't ship dozens of bespoke strings.
    if (next.key === "payouts") {
      copy = "set up payouts so businesses can accept your offers.";
    } else if (next.key === "resume") {
      copy = "upload a resume so businesses can review your experience.";
    } else if (next.key === "portfolio") {
      copy = "add a few past work samples so businesses can see your range.";
    } else {
      copy = `${next.cta} so businesses know more about you.`;
    }
  }

  const tierColor = health.pct >= 67 ? "var(--fo-accent)" : health.pct >= 34 ? "var(--fo-do)" : "var(--fo-plan)";

  panel.innerHTML = `
    <div class="bza__health-top">
      ${renderHealthBucket(health)}
      <div class="bza__health-summary">
        <span class="bza__health-tier" style="color:${tierColor}">
          <span class="bza__health-tier-mark" aria-hidden="true"></span>
          ${escape(health.tierName)}
        </span>
        <p class="bza__health-name">${health.pct}% complete</p>
        <p class="bza__health-eyebrow">${escape(copy)}</p>
      </div>
    </div>
    <a href="${escape(ctaHref)}" class="bza__health-cta">
      <span class="bza__health-cta-text">${escape(cta)}</span>
      <span class="bza__health-cta-arrow" aria-hidden="true">→</span>
    </a>
  `;
}

/* ============================================================== */
/*                      RENDER + INIT                             */
/* ============================================================== */

function renderDashboard(client, data) {
  const { userId, profile, consultant, portfolioCount, bids, listingMap, ownerMap, ownerBizMap, scheduleMap, recommended, unreadThreads, unreadCount } = data;

  // welcome line with a rating chip pinned right after the first name.
  // The chip is a link to /my-reviews.html. We render it as a placeholder
  // first then fill it asynchronously from fetchRatingFor.
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";
  const welcomeEl = $("cdash-welcome");
  if (welcomeEl) {
    welcomeEl.innerHTML = `welcome back, ${escape(firstName)}.`;
  }

  // Build a map of bid_id → unread thread so each plant in the journey
  // can show a paper-plane indicator. The unreadThreads list is keyed by
  // (listing_id, other_user_id); each bid pairs a listing with the
  // listing's owner (the consultant's counterparty), so we match by that.
  const unreadByBid = new Map();
  for (const b of bids || []) {
    const listing = listingMap?.get?.(b.listing_id);
    const ownerId = listing?.owner_id;
    if (!ownerId) continue;
    for (const t of unreadThreads || []) {
      const tListingId = t.listingId || t.listing_id;
      const tOtherId = t.otherId || t.other_user_id;
      if (b.listing_id === tListingId && ownerId === tOtherId) {
        unreadByBid.set(b.id, {
          unread: t.unread,
          threadKey: `${tListingId}:${tOtherId}`,
        });
        break;
      }
    }
  }

  // Engagement journey — one flower per engagement across the five
  // lifecycle stages (seed → bloom). The module computes stage,
  // species, and premature-engagement filtering internally; we just
  // hand it every bid enriched with listing/owner/schedule + the
  // per-bid unread map for the in-plant message indicator.
  const journeyPanel = $("cdash-journey-panel");
  if (journeyPanel) {
    const engagements = journeyEngagements(bids, listingMap, ownerMap, ownerBizMap, scheduleMap);
    mountEngagementJourneyFlowers(journeyPanel, {
      client,
      engagements,
      userId,
      unreadByBid,
      threadLinkBase: "/inbox.html#",
    });
  }

  // user card (sidebar bottom)
  const avatarUrl = publicAvatarUrl(client, profile?.avatar_path);
  const userAvatar = $("cdash-user-avatar");
  if (userAvatar) {
    const ui = getInitials(profile?.full_name);
    userAvatar.innerHTML = avatarUrl ? `<img src="${escape(avatarUrl)}" alt=""/>` : escape(ui);
  }
  const userName = $("cdash-user-name");
  if (userName) userName.textContent = profile?.full_name || "your account";

  // Profile completion → bucket card beneath the journey.
  const healthPanel = $("cdash-health");
  if (healthPanel) renderHealth(healthPanel, consultantHealth(profile, consultant, portfolioCount), userId);

  // Notifications → recent feed (right column of the row beneath the
  // journey). Shared renderer with the owner dashboard; the unread
  // count also drives the sidebar bell badge.
  const notifList = $("cdash-notifications-list");
  const notifEmpty = $("cdash-notifications-empty");
  const notifBadge = $("cdash-notif-badge");
  if (userId && notifList) {
    mountDashboardNotifications({ client, userId, listEl: notifList, emptyEl: notifEmpty }).then((result) => {
      const unread = result?.unreadCount || 0;
      if (notifBadge) {
        notifBadge.textContent = String(unread);
        notifBadge.hidden = unread === 0;
      }
    });
  }
}

function setupShell() {
  const sidebar = $("cdash-sidebar");
  const shell = $("cdash-shell");
  const COLLAPSE_KEY = "grassroots_dash_sidebar_collapsed";

  function applyCollapsed(collapsed) {
    shell.classList.toggle("bza--collapsed", collapsed);
  }
  let initialCollapsed = false;
  try { initialCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch {}
  applyCollapsed(initialCollapsed);

  function toggleCollapsed() {
    const next = !shell.classList.contains("bza--collapsed");
    applyCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch {}
  }
  $("cdash-side-edge")?.addEventListener("dblclick", toggleCollapsed);

  // dark mode mirror
  const darkInput = $("cdash-darkmode-toggle");
  if (darkInput && window.GrassrootsTheme) {
    const isDark = (t) => t === "dark-forest" || t === "dark" || t === "forest-soft";
    darkInput.checked = isDark(window.GrassrootsTheme.get());
    darkInput.addEventListener("change", () => {
      window.GrassrootsTheme.set(darkInput.checked ? "dark" : "light");
    });
    window.addEventListener("grassroots:themechange", (e) => {
      darkInput.checked = isDark(e.detail || window.GrassrootsTheme.get());
    });
  }

  // logout
  $("cdash-logout")?.addEventListener("click", async () => {
    try {
      const client = await getSupabaseClient();
      await client.auth.signOut();
    } catch {}
    window.location.replace("/signin.html");
  });

  // view switcher (dashboard ↔ inbox)
  let inboxLoaded = false;
  async function lazyInitInbox() {
    if (inboxLoaded) return;
    inboxLoaded = true;
    try {
      const mod = await import("/inbox.js");
      await mod.initInbox();
    } catch (err) {
      console.warn("inbox load failed", err);
      inboxLoaded = false;
    }
  }
  function showView(name) {
    // Inbox is its own page now — keep the legacy hash working by
    // redirecting before any view-toggling runs.
    if (name === "inbox") {
      window.location.href = "/inbox.html";
      return;
    }
    document.querySelectorAll(".dash-view").forEach((v) => {
      v.hidden = v.dataset.view !== name;
    });
    sidebar.querySelectorAll("[data-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });
  }
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.addEventListener("click", (e) => {
      if (el.tagName === "A") e.preventDefault();
      showView(el.dataset.view);
    });
  });

  const initialHash = window.location.hash.replace("#", "").split("?")[0];
  showView(initialHash || "dashboard");
}

async function init() {
  const gate = $("cdash-gate");
  const shell = $("cdash-shell");
  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
      window.location.replace("/signin.html?next=/consultant-dashboard.html");
      return;
    }
    const data = await loadData(client, session.user.id);
    data.session = session;
    if (data.profile?.role === "business_owner") {
      window.location.replace("/dashboard.html");
      return;
    }
    gate.hidden = true;
    shell.hidden = false;
    setupShell();
    renderDashboard(client, data);
  } catch (err) {
    console.error(err);
    gate.textContent = err.message || "could not load dashboard.";
    gate.className = "gr-status error";
  }
}

init();
