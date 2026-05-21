// dashboard.js — business owner dashboard. Aggregates the user's listings,
// offers received, message threads, and profile completeness. Owner-side
// listing detail (offer review + accept/counter/reject) lives on
// /listing.html?id=X and is reached by clicking any listing row.

import { getSupabaseClient } from "/supabase-loader.js";
import { hydrateRatings } from "/rating.js";
import { mountDashboardNotifications } from "/dashboard-notifications.js";
import { getInitials } from "/initials.js";
import { loadOwnerAnalytics, renderAnalyticsPanel } from "/listing-analytics.js";
import { mountGardenStem } from "/garden-stem.js";
import { loadCompletedEngagements } from "/garden-data.js";
import { renderHealthBucket, kickHealthBucketAnimation } from "/health-bucket.js";
import { deleteListing, ListingOperationError } from "/listing-operations.js";
import { confirmDialog } from "/confirm-modal.js";
import { showToast } from "/toast.js";

const $ = (id) => document.getElementById(id);
const escape = (s) =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const STATE_LABELS = {
  open: "live",
  hired: "in progress",
  paused: "paused",
  closed: "closed",
  draft: "draft",
};

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

function fmtBudget(min, max) {
  if (min == null && max == null) return "—";
  if (min != null && max != null) return `$${min}–$${max}`;
  return `$${min ?? max}`;
}

function parseBudgetRangeFromDetails(details) {
  if (!details) return null;
  const m = /budget range:\s*\$?(\d[\d,]*)\s*to\s*\$?(\d[\d,]*)/i.exec(details);
  if (!m) return null;
  return {
    min: parseInt(m[1].replace(/,/g, ""), 10),
    max: parseInt(m[2].replace(/,/g, ""), 10),
  };
}

function listingState(row) {
  // Map listing.status to a display state. Open = live; if any bid is accepted, that's "hired".
  if (row.__hired) return "hired";
  const s = (row.status || "").toLowerCase();
  if (s === "open") return "open";
  if (s === "paused") return "paused";
  if (s === "closed") return "closed";
  if (s === "draft") return "draft";
  return s || "open";
}

const HEALTH_PALETTE = [
  "var(--fo-accent)",
  "var(--fo-develop)",
  "#a3d099",
  "var(--fo-do)",
  "var(--fo-accent-warm)",
  "#c8a96a",
];

function profileCompleteness(profile, biz) {
  const fields = [
    { label: "full name", filled: !!profile?.full_name },
    { label: "profile photo", filled: !!profile?.avatar_path },
    { label: "business name", filled: !!biz?.business_name },
    { label: "business bio", filled: !!biz?.business_details },
    { label: "address", filled: !!biz?.business_address },
    {
      label: "website or social",
      filled: !!biz?.website_url || !!biz?.instagram_url || !!biz?.facebook_url,
    },
  ];
  fields.forEach((f, i) => (f.color = HEALTH_PALETTE[i % HEALTH_PALETTE.length]));
  const done = fields.filter((f) => f.filled).length;
  const total = fields.length;
  const pct = Math.round((done / total) * 100);
  const missing = fields.filter((f) => !f.filled).map((f) => f.label);
  let tierName;
  if (pct >= 100) tierName = "complete";
  else if (pct >= 67) tierName = "almost there";
  else if (pct >= 34) tierName = "needs attention";
  else tierName = "needs love";
  return { pct, done, total, fields, missing, tierName };
}

// renderHealthBucket lives in /health-bucket.js so the consultant + owner
// dashboards share one source of truth for the profile-completion viz.

function renderHealthChips(health) {
  return `
    <ul class="bza__health-chips">
      ${health.fields
        .map(
          (f) => `<li class="bza__health-chip${f.filled ? " is-filled" : " is-missing"}" style="--chip-color:${f.color}">
        <span class="bza__health-chip-dot" aria-hidden="true"></span>
        <span class="bza__health-chip-label">${escape(f.label)}</span>
      </li>`
        )
        .join("")}
    </ul>
  `;
}

/* ============================================================== */

async function loadData(client, userId) {
  // Fetch in parallel
  const [profileRes, bizRes, listingsRes] = await Promise.all([
    client.from("profiles").select("id, full_name, role, avatar_path").eq("id", userId).single(),
    client
      .from("business_profiles")
      .select("user_id, business_name, business_details, website_url, instagram_url, facebook_url, business_address")
      .eq("user_id", userId)
      .maybeSingle(),
    client
      .from("listings")
      .select("id, title, category, problem_summary, details, budget_cents, status, status_reason, turnaround_days, created_at")
      .eq("owner_id", userId)
      .order("created_at", { ascending: false }),
  ]);

  if (profileRes.error) {
    const e = new Error(profileRes.error.message || "could not load profile.");
    e.kind = "profile";
    throw e;
  }

  const profile = profileRes.data;
  const biz = bizRes.data;
  const listings = listingsRes.data || [];

  // Bids per listing
  let bidsByListing = {};
  if (listings.length) {
    const ids = listings.map((l) => l.id);
    const { data: bids, error: bidsErr } = await client
      .from("bids")
      .select(
        "id, listing_id, consultant_id, amount_cents, message, status, created_at, proposal_due_at, accepted_at, profiles!bids_consultant_id_fkey ( full_name, avatar_path )"
      )
      .in("listing_id", ids)
      .order("created_at", { ascending: false });
    if (!bidsErr || isMissing(bidsErr)) {
      for (const b of bids || []) {
        (bidsByListing[b.listing_id] ||= []).push(b);
      }
    }
  }

  // Mark hired listings
  for (const l of listings) {
    const bids = bidsByListing[l.id] || [];
    if (bids.some((b) => b.status === "accepted")) l.__hired = true;
    l.__bidCount = bids.length;
    l.__bids = bids;
  }

  // Messages where owner is recipient or sender, scoped to their listings.
  // Unread = messages I received whose created_at > my last_read_at for the
  // (listing, other_user) thread, sourced from public.message_reads.
  let threadsByListing = {};
  let unreadCount = 0;
  if (listings.length) {
    const ids = listings.map((l) => l.id);
    const [{ data: msgs, error: msgErr }, { data: reads }] = await Promise.all([
      client
        .from("messages")
        .select("id, listing_id, sender_id, recipient_id, body, created_at")
        .in("listing_id", ids)
        .order("created_at", { ascending: false }),
      client
        .from("message_reads")
        .select("listing_id, other_user_id, last_read_at")
        .eq("user_id", userId),
    ]);

    const readMap = new Map();
    for (const r of reads || []) {
      readMap.set(`${r.listing_id}:${r.other_user_id}`, new Date(r.last_read_at).getTime());
    }

    if (!msgErr || isMissing(msgErr)) {
      for (const m of msgs || []) {
        const otherId = m.sender_id === userId ? m.recipient_id : m.sender_id;
        (threadsByListing[m.listing_id] ||= {});
        const t = threadsByListing[m.listing_id];
        if (!t[otherId]) {
          t[otherId] = {
            listingId: m.listing_id,
            consultantId: otherId,
            lastBody: m.body,
            lastAt: m.created_at,
            lastFromMe: m.sender_id === userId,
            unread: 0,
          };
        }
        if (m.recipient_id === userId) {
          const tt = t[otherId];
          const lastRead = readMap.get(`${m.listing_id}:${otherId}`) || 0;
          if (new Date(m.created_at).getTime() > lastRead) {
            tt.unread += 1;
            unreadCount += 1;
          }
        }
      }
    }
  }

  // Look up consultant profile names for the threads
  const consultantIds = new Set();
  for (const tmap of Object.values(threadsByListing)) {
    for (const cid of Object.keys(tmap)) consultantIds.add(cid);
  }
  let consultants = {};
  if (consultantIds.size) {
    const { data, error } = await client
      .from("profiles")
      .select("id, full_name, avatar_path")
      .in("id", [...consultantIds]);
    if (!error || isMissing(error)) {
      for (const p of data || []) consultants[p.id] = p;
    }
  }

  // Engagement schedules for accepted bids — drives the action items panel.
  const acceptedBidIds = [];
  for (const l of listings) {
    for (const b of l.__bids || []) {
      if (b.status === "accepted") acceptedBidIds.push(b.id);
    }
  }
  const schedulesByBidId = {};
  if (acceptedBidIds.length) {
    const { data: schedules, error: schedErr } = await client
      .from("engagement_schedules")
      .select("bid_id, listing_id, owner_id, consultant_id, status, selected_start, selected_end, updated_at")
      .in("bid_id", acceptedBidIds);
    if (!schedErr || isMissing(schedErr)) {
      for (const s of schedules || []) schedulesByBidId[s.bid_id] = s;
    }
  }

  // Look up consultant names for accepted bids that aren't already in the
  // threads consultant map (action items reference their counterpart by name).
  const acceptedConsultantIds = new Set();
  for (const l of listings) {
    for (const b of l.__bids || []) {
      if (b.status === "accepted" && b.consultant_id && !consultants[b.consultant_id]) {
        acceptedConsultantIds.add(b.consultant_id);
      }
    }
  }
  if (acceptedConsultantIds.size) {
    const { data, error } = await client
      .from("profiles")
      .select("id, full_name, avatar_path")
      .in("id", [...acceptedConsultantIds]);
    if (!error || isMissing(error)) {
      for (const p of data || []) consultants[p.id] = p;
    }
  }

  return { profile, biz, listings, bidsByListing, threadsByListing, consultants, unreadCount, schedulesByBidId };
}

/* ============================================================== */

function avatarHtml(client, path, initial, klass = "bza__inbox-avatar") {
  if (path) {
    const url = client.storage.from("avatars").getPublicUrl(path).data?.publicUrl;
    if (url) return `<div class="${klass}"><img src="${escape(url)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:inherit"/></div>`;
  }
  return `<div class="${klass}">${escape(initial || "?")}</div>`;
}

function daysOpenLabel(createdAt) {
  if (!createdAt) return "";
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return "open today";
  if (days === 1) return "1 day open";
  if (days < 30) return `${days} days open`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1 month open" : `${months} months open`;
}

// Compact recency for my-listings cards: today, 1d, 6d, 1w, 4w, 1m, 12m.
// Brackets:
//   0 days        → "today"
//   1–6 days      → "Xd"
//   7–29 days     → "Xw"  (Math.round, so 7 = 1w, 10 = 1w, 11 = 2w)
//   30+ days      → "Xm"  (Math.round)
function shortRecency(createdAt) {
  if (!createdAt) return "";
  const ms = Date.now() - new Date(createdAt).getTime();
  const days = Math.floor(ms / 86400000);
  if (days <= 0) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.round(days / 7)}w`;
  return `${Math.round(days / 30)}m`;
}

// State → status dot.
//
// Two intentional bypasses of brandkit tokens for legibility — both
// commented per brandkit's "If you find yourself bypassing tokens for
// a quick fix — leave a comment" rule:
//
//   1) NEUTRAL_GREY_DOT for "live" / "draft" — --fo-text-3 is green-
//      tinted in both light (#767f78) and dark-forest (#6e8378), so
//      it washed into the moss --fo-accent dot beside it.
//   2) CLOSED_RED_DOT for "closed" / "cancelled" — --fo-plan is the
//      system's destructive token (warm coral) but in the light theme
//      it resolves to #c46f44, the EXACT same value as --fo-accent-warm.
//      So the "paused" and "closed" dots became indistinguishable, and
//      both read as orange instead of one orange + one red. The dot
//      uses a deeper brick-red hex so the status is unmistakably
//      "closed" and not "paused".
const NEUTRAL_GREY_DOT = "#9aa3aa";
const CLOSED_RED_DOT = "#a83232";
const STATE_DOT_COLORS = {
  open: NEUTRAL_GREY_DOT,            // live — neutral, awaiting offers
  hired: "var(--fo-accent)",         // in progress — work happening
  paused: "var(--fo-accent-warm)",   // paused — warn-orange
  closed: CLOSED_RED_DOT,            // closed — deep brick red
  cancelled: CLOSED_RED_DOT,         // cancelled — same red
  draft: "var(--fo-draft)",          // draft — soft violet, owner-only
};

function listingPrimaryAction(l, schedulesByBidId) {
  const bids = l.__bids || [];
  const accepted = bids.find((b) => b.status === "accepted");
  const state = listingState(l);

  if (accepted) {
    const sched = schedulesByBidId?.[accepted.id];
    const status = sched?.status || "awaiting_owner";
    if (!sched || status === "awaiting_owner") {
      return { label: "share availability", kind: "schedule", href: `/engagement.html?bid=${accepted.id}` };
    }
    if (status === "scheduled") {
      return { label: "mark complete", kind: "complete", href: `/engagement.html?bid=${accepted.id}` };
    }
    if (status === "awaiting_consultant") {
      // Owner shared availability — ball's in the consultant's court.
      // Drop the prompt and surface a quiet "manage" link so the row
      // still has a way into the engagement page without reading as
      // an action item. `quiet: true` keeps `needsAction` false so
      // the listing isn't sorted to the top or tagged "needs you".
      return {
        label: "manage",
        kind: "manage",
        quiet: true,
        href: `/engagement.html?bid=${accepted.id}`,
      };
    }
  }

  if (state === "open") {
    const pending = bids.filter((b) => b.status === "pending" || b.status === "submitted").length;
    if (pending > 0) {
      return { label: pending === 1 ? "review offer" : "review offers", kind: "offers", href: `/listing.html?id=${l.id}` };
    }
  }

  return null;
}

function listingRowHtml(l, schedulesByBidId) {
  const state = listingState(l);
  const stateLabel = STATE_LABELS[state] || state;
  const budgetRange = parseBudgetRangeFromDetails(l.details);
  const cents = l.budget_cents;
  const budgetText = budgetRange
    ? `$${budgetRange.min}–$${budgetRange.max}`
    : cents != null
    ? `$${Math.round(cents / 100)}`
    : "—";

  const offerCount = l.__bidCount || 0;
  const offerLabel = offerCount === 1 ? "1 offer" : `${offerCount} offers`;
  const openLabel = daysOpenLabel(l.created_at);

  // Dashboard rows stay slim — state pill, days open, offer count,
  // budget on the right. Category + turnaround moved to the full
  // my-listings card view so the home row stays scannable.
  const metaBits = [
    `<span class="bza__row-state-label bza__row-state-label--${state}">${escape(stateLabel)}</span>`,
    openLabel ? `<span class="bza__row-meta-sep">·</span><span>${escape(openLabel)}</span>` : "",
    `<span class="bza__row-meta-sep">·</span><span class="bza__row-meta-strong">${escape(offerLabel)}</span>`,
  ]
    .filter(Boolean)
    .join("");

  const action = listingPrimaryAction(l, schedulesByBidId);
  // Draft rows get a paired CTA: "finish & publish" links to the
  // wizard, and a quiet "delete" affordance lets the owner clear out
  // stale or example drafts without leaving the dashboard.
  const ctaHtml = action
    ? `<a class="bza__row-cta bza__row-cta--${escape(action.kind)}" href="${escape(action.href)}">${escape(action.label)} →</a>`
    : state === "draft"
    ? `<div class="bza__row-cta-group">
         <a class="bza__row-cta bza__row-cta--draft" href="/create-listing.html?draft=${escape(l.id)}">finish &amp; publish →</a>
         <button type="button" class="bza__row-draft-delete" data-draft-delete-id="${escape(l.id)}" data-draft-title="${escape(l.title || "untitled")}" aria-label="delete draft">delete</button>
       </div>`
    : "";

  // Persistent "needs you" pill on draft rows — sits in the title row
  // so the prompt to finish the listing reads at the same glance as
  // the title itself. Stays until the draft is published.
  const needsYouPill = state === "draft"
    ? `<span class="bza__row-needs-you" title="this draft hasn't been published yet">needs you</span>`
    : "";

  // Pulse the state dot whenever the owner has something to do here —
  // any of the listingPrimaryAction CTAs, or the implicit draft
  // finish-and-publish action. Quiet actions (e.g. "manage" while
  // waiting on the consultant) don't pulse — the dot should read as
  // calm when nothing is actually pending.
  const ownerActionPending = (!!action && !action.quiet) || state === "draft";
  const stateDotClass = `bza__row-state bza__row-state--${state}${ownerActionPending ? " bza__row-state--pulse" : ""}`;

  return `
    <div class="bza__row">
      <a class="bza__row-link" href="/listing.html?id=${escape(l.id)}">
        <span class="${stateDotClass}"></span>
        <div class="bza__row-main">
          <h3 class="bza__row-title">${escape(l.title || "untitled")}${needsYouPill}</h3>
          <div class="bza__row-meta">${metaBits}</div>
        </div>
        <div class="bza__row-budget">${escape(budgetText)}</div>
        <span class="bza__row-chev">›</span>
      </a>
      ${ctaHtml}
    </div>
  `;
}

/* ============================================================== */
/*                      MY LISTINGS — CARD VIEW                    */
/* ============================================================== */

// Marketplace-style card for an owner's own listing. Same .gr-listing-
// card shell so the visual rhythm matches /marketplace.html; content
// is swapped for owner-relevant signals (state pill in the eyebrow,
// offers + days open in the meta column, the primary action as the
// foot CTA instead of "view →").
function ownerListingCardHtml(l, schedulesByBidId) {
  const state = listingState(l);
  const stateLabel = STATE_LABELS[state] || state;
  const offerCount = l.__bidCount || 0;
  const offerLabel = offerCount === 1 ? "1 offer" : `${offerCount} offers`;
  const recencyLabel = shortRecency(l.created_at);
  const dotColor = STATE_DOT_COLORS[state] || "var(--fo-text-3)";

  const budgetRange = parseBudgetRangeFromDetails(l.details);
  const cents = l.budget_cents;
  const budgetText = budgetRange
    ? `$${budgetRange.min}–$${budgetRange.max}`
    : cents != null
    ? `$${Math.round(cents / 100)}`
    : "—";

  // `Number(null) === 0` is finite, which would render "nulld turnaround"
  // — guard against the SQL NULL case explicitly and reject 0.
  const td = Number(l.turnaround_days);
  const turnaround = Number.isFinite(td) && td > 0 ? `${td}d turnaround` : "";

  const categories = l.category
    ? l.category.split(",").map((c) => c.trim()).filter(Boolean)
    : [];
  const visibleTags = categories.slice(0, 2);
  const overflow = categories.length - visibleTags.length;
  const tagsHtml = categories.length
    ? `<div class="gr-listing-tags">${
        visibleTags
          .map((c) => `<span class="gr-listing-tag">${escape(c)}</span>`)
          .join("")
      }${
        overflow > 0
          ? `<span class="gr-listing-tag gr-listing-tag--more">+${overflow}</span>`
          : ""
      }</div>`
    : "";

  const action = listingPrimaryAction(l, schedulesByBidId);
  // Drafts always need the owner's attention: surface the same
  // "needs you" pill the other action-required cards use, but point
  // the CTA at the create-listing wizard (?draft=…) instead of the
  // listing detail page. Stays until the draft flips to 'open'.
  // Quiet actions (e.g. "manage" once the owner has shared
  // availability) render a link but don't count as action-needing —
  // they shouldn't pull focus or tag the card "needs you".
  const isDraft = state === "draft";
  const ctaText = action ? action.label : isDraft ? "finish & publish" : "open listing";
  const ctaHref = action ? action.href : isDraft ? `/create-listing.html?draft=${l.id}` : `/listing.html?id=${l.id}`;
  const needsAction = (!!action && !action.quiet) || isDraft;

  // Drafts get a small overlay delete button so the owner can clear
  // them out from the card grid. Other states don't offer delete —
  // close/pause from the listing page is the path once a listing is
  // live. Wrapping in a container lets the button live as a sibling
  // of the anchor (nested interactives aren't valid HTML).
  const deleteBadge = isDraft
    ? `<button type="button" class="ml-card__delete" data-draft-delete-id="${escape(l.id)}" data-draft-title="${escape(l.title || "untitled")}" aria-label="delete draft">delete</button>`
    : "";

  return `
    <div class="ml-card-wrap ml-card-wrap--${escape(state)}">
      <a class="gr-listing-card ml-card ml-card--${escape(state)}${needsAction ? " ml-card--needs-action" : ""}" href="${escape(ctaHref)}">
        <span class="ml-card__dot" style="background:${dotColor}" aria-label="${escape(stateLabel)}" title="${escape(stateLabel)}"></span>
        <div class="gr-listing-card-eyebrow">
          ${needsAction ? `<span class="ml-card__action-tag">needs you</span>` : ""}
          ${recencyLabel ? `<span class="ml-card__recency">${escape(recencyLabel)}</span>` : ""}
        </div>
        <h2 class="gr-listing-title">${escape(l.title || "untitled")}</h2>
        <div class="gr-listing-card-head ml-card__head">
          <div class="gr-listing-card-meta ml-card__meta">
            <p class="gr-listing-biz-name ml-card__offers">${escape(offerLabel)}</p>
            <p class="gr-listing-budget">${escape(budgetText)}</p>
            ${turnaround ? `<p class="gr-listing-contract">${escape(turnaround)}</p>` : ""}
          </div>
        </div>
        <div class="gr-listing-foot">
          ${tagsHtml || '<div></div>'}
          <span class="gr-listing-cta-link">${escape(ctaText)} →</span>
        </div>
      </a>
      ${deleteBadge}
    </div>
  `;
}

// Mount the my-listings card grid + search/sort toolbar + filterable
// status legend. Re-renders in place whenever the search query, sort
// option, or legend filter toggles.
//
// Filter pipeline (intersection, applied in order):
//   1) search query against title
//   2) state filter from the legend (empty set = show all)
//   3) sort
function mountMyListingsView(listings, schedulesByBidId) {
  const host = $("dash-listings-cards");
  const empty = $("ml-empty");
  const countEl = $("ml-result-count");
  const searchEl = $("ml-search");
  const sortEl = $("ml-sort");
  const legendEl = $("ml-legend");
  if (!host) return;

  // Cards needing the owner's attention always float to the top —
  // regardless of which sort the owner picked — so opening the view
  // visually leads them to what's blocked on them. The chosen sort
  // applies as a secondary ordering within the two groups.
  const hasPendingAction = (l) => {
    const a = listingPrimaryAction(l, schedulesByBidId);
    return !!a && !a.quiet;
  };
  const withActionFirst = (inner) => (a, b) => {
    const ap = hasPendingAction(a) ? 0 : 1;
    const bp = hasPendingAction(b) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return inner(a, b);
  };

  const SORTERS = {
    newest: withActionFirst((a, b) => new Date(b.created_at) - new Date(a.created_at)),
    oldest: withActionFirst((a, b) => new Date(a.created_at) - new Date(b.created_at)),
    offers: withActionFirst((a, b) => (b.__bidCount || 0) - (a.__bidCount || 0)),
    budget: withActionFirst((a, b) => ownerBudgetSortValue(b) - ownerBudgetSortValue(a)),
  };

  // `closed` chip filters both 'closed' and 'cancelled' states so the
  // legend label matches what an owner thinks of as "closed."
  const STATE_GROUPS = { closed: ["closed", "cancelled"] };
  const groupStatesFor = (s) => STATE_GROUPS[s] || [s];

  const activeStates = new Set();

  const render = () => {
    const q = (searchEl?.value || "").trim().toLowerCase();
    const sortKey = sortEl?.value || "newest";
    const sorter = SORTERS[sortKey] || SORTERS.newest;

    // Expand grouped chips (e.g. "closed" → ["closed", "cancelled"]).
    const stateMatch = activeStates.size
      ? new Set([...activeStates].flatMap(groupStatesFor))
      : null;

    const filtered = listings
      .filter((l) => !q || String(l.title || "").toLowerCase().includes(q))
      .filter((l) => !stateMatch || stateMatch.has(listingState(l)))
      .slice()
      .sort(sorter);

    if (countEl) {
      const total = listings.length;
      countEl.textContent = filtered.length === total
        ? `${total} listing${total === 1 ? "" : "s"}`
        : `${filtered.length} of ${total}`;
    }
    if (!filtered.length) {
      host.innerHTML = "";
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    host.innerHTML = filtered
      .map((l) => ownerListingCardHtml(l, schedulesByBidId))
      .join("");
  };

  // Bind listeners once — re-render on every keystroke / change /
  // legend toggle. dataset.bound guards against re-binding when
  // mountMyListingsView is called more than once.
  if (searchEl && !searchEl.dataset.bound) {
    searchEl.addEventListener("input", render);
    searchEl.dataset.bound = "1";
  }
  if (sortEl && !sortEl.dataset.bound) {
    sortEl.addEventListener("change", render);
    sortEl.dataset.bound = "1";
  }
  if (legendEl && !legendEl.dataset.bound) {
    legendEl.addEventListener("click", (e) => {
      const chip = e.target.closest(".ml-legend-chip[data-state]");
      if (!chip) return;
      const state = chip.dataset.state;
      if (activeStates.has(state)) activeStates.delete(state);
      else activeStates.add(state);
      chip.setAttribute("aria-pressed", activeStates.has(state) ? "true" : "false");
      chip.classList.toggle("is-active", activeStates.has(state));
      legendEl.classList.toggle("has-active", activeStates.size > 0);
      render();
    });
    legendEl.dataset.bound = "1";
  }

  render();
}

// "Highest budget" sort — uses the range max if a range is present,
// otherwise the cents value, otherwise sinks the row.
function ownerBudgetSortValue(l) {
  const range = parseBudgetRangeFromDetails(l.details);
  if (range && Number.isFinite(range.max)) return range.max;
  if (Number.isFinite(Number(l.budget_cents))) return Number(l.budget_cents) / 100;
  return -1;
}

function inboxRowHtml(client, t, consultants, listingTitle) {
  const c = consultants[t.consultantId];
  const name = c?.full_name || "consultant";
  const initial = getInitials(name);
  const unread = t.unread > 0
    ? `<span class="bza__inbox-unread">${t.unread}</span>`
    : "";
  const ratingChip = t.consultantId
    ? `<span data-consultant-rating="${escape(t.consultantId)}" data-rating-size="sm" data-rating-count="false"></span>`
    : "";
  return `
    <a href="/listing.html?id=${escape(t.listingId)}" class="bza__inbox-row" style="text-decoration:none">
      ${avatarHtml(client, c?.avatar_path, initial)}
      <div style="min-width:0">
        ${listingTitle ? `<div class="bza__inbox-listing">re: ${escape(listingTitle)}</div>` : ""}
        <div class="bza__inbox-name">${escape(name)} ${ratingChip}${unread}</div>
        <div class="bza__inbox-msg">${t.lastFromMe ? "you: " : ""}${escape(t.lastBody)}</div>
      </div>
      <div class="bza__inbox-time">${escape(relTime(t.lastAt))}</div>
    </a>
  `;
}

/* ============================================================== */

/* ============================================================== *
 * 3-DAY AGENDA — meetings, proposal due dates, listing closings   *
 * ============================================================== */

const AGENDA_ICONS = {
  meeting: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15.5 14"/></svg>',
  proposal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  closing: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function buildAgendaEvents(listings, bidsByListing, schedulesByBidId, consultants) {
  const events = [];
  const today = startOfDay(new Date());
  const horizon = new Date(today);
  horizon.setDate(horizon.getDate() + 3); // exclusive — covers today + next 2 days

  const consultantName = (id) => consultants?.[id]?.full_name || "consultant";

  for (const l of listings) {
    const listingTitle = l.title || "your listing";
    const bids = l.__bids || [];
    const accepted = bids.find((b) => b.status === "accepted");

    // 1) Scheduled kickoff meeting
    if (accepted) {
      const sched = schedulesByBidId?.[accepted.id];
      const start = sched?.selected_start ? new Date(sched.selected_start) : null;
      if (start && start >= today && start < horizon) {
        events.push({
          kind: "meeting",
          when: start,
          title: `kickoff with ${consultantName(accepted.consultant_id)}`,
          consultantId: accepted.consultant_id,
          subtitle: listingTitle,
          href: `/engagement.html?bid=${accepted.id}`,
        });
      }

      // 2) Proposal due date
      const due = accepted.proposal_due_at ? new Date(accepted.proposal_due_at) : null;
      if (due && due >= today && due < horizon) {
        events.push({
          kind: "proposal",
          when: due,
          title: `proposal due — ${consultantName(accepted.consultant_id)}`,
          consultantId: accepted.consultant_id,
          subtitle: listingTitle,
          href: `/engagement.html?bid=${accepted.id}`,
        });
      }
    }

    // 3) Listing closing (created_at + turnaround_days, while still open)
    if ((l.status || "").toLowerCase() === "open" && Number.isFinite(Number(l.turnaround_days)) && l.created_at) {
      const close = new Date(l.created_at);
      close.setDate(close.getDate() + Number(l.turnaround_days));
      if (close >= today && close < horizon) {
        events.push({
          kind: "closing",
          when: close,
          title: `"${listingTitle}" closes`,
          subtitle: "marketplace listing window ends",
          href: `/listing.html?id=${l.id}`,
        });
      }
    }
  }

  events.sort((a, b) => a.when - b.when);
  return events;
}

function formatAgendaTime(date) {
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase();
}

function renderOwnerAgenda(events) {
  const root = $("dash-agenda-days");
  if (!root) return;
  const today = startOfDay(new Date());
  const days = [];
  for (let i = 0; i < 3; i += 1) {
    const d = new Date(today);
    d.setDate(d.getDate() + i);
    const label = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    const rel = i === 0 ? "today" : i === 1 ? "tomorrow" : "";
    const dayEvents = events.filter((e) => sameDay(e.when, d));
    days.push({ d, label, rel, events: dayEvents });
  }

  root.innerHTML = days
    .map((day) => {
      const eventsHtml = day.events.length
        ? day.events
            .map(
              (e) => `
              <a class="dash-agenda-event dash-agenda-event--${escape(e.kind)}" href="${escape(e.href)}">
                <span class="dash-agenda-event__icon" aria-hidden="true">${AGENDA_ICONS[e.kind] || AGENDA_ICONS.meeting}</span>
                <span class="dash-agenda-event__body">
                  <span class="dash-agenda-event__title">${escape(e.title)}${e.consultantId ? ` <span data-consultant-rating="${escape(e.consultantId)}" data-rating-size="sm" data-rating-count="false"></span>` : ""}</span>
                  <span class="dash-agenda-event__sub">${escape(formatAgendaTime(e.when))} · ${escape(e.subtitle)}</span>
                </span>
              </a>
            `
            )
            .join("")
        : '<p class="dash-agenda-empty">nothing scheduled</p>';
      return `
        <div class="dash-agenda-day${day.rel === "today" ? " is-today" : ""}">
          <div class="dash-agenda-day__h">
            <span class="dash-agenda-day__date">${escape(day.label)}</span>
            ${day.rel ? `<span class="dash-agenda-day__rel">${escape(day.rel)}</span>` : ""}
          </div>
          ${eventsHtml}
        </div>
      `;
    })
    .join("");
  hydrateRatings(root);
}

function renderDashboard(client, data) {
  const { profile, biz, listings, threadsByListing, consultants, unreadCount, schedulesByBidId } = data;

  const avatarUrl = profile?.avatar_path
    ? client.storage.from("avatars").getPublicUrl(profile.avatar_path).data?.publicUrl || ""
    : "";

  // sidebar user card (bottom — links to /profile.html)
  const userAvatar = $("dash-user-avatar");
  if (userAvatar) {
    const ui = getInitials(profile?.full_name);
    userAvatar.innerHTML = avatarUrl ? `<img src="${escape(avatarUrl)}" alt=""/>` : escape(ui);
  }
  const userName = $("dash-user-name");
  if (userName) userName.textContent = profile?.full_name || "your account";
  const userRole = $("dash-user-role");
  if (userRole) {
    userRole.textContent = profile?.role === "consultant" ? "consultant" : "business owner";
  }

  // sidebar badges
  const inProgressCount = listings.filter((l) => listingState(l) === "hired").length;
  const draftCount = listings.filter((l) => listingState(l) === "draft").length;
  // The "my listings" badge reflects actions the owner needs to take —
  // pending offers to review, kickoffs to schedule, work to mark
  // complete, AND any unpublished drafts that need finishing. Quiet
  // actions (e.g. "manage" while waiting on the consultant) are not
  // owner-action-needed and don't count toward the badge.
  const actionsNeededCount = listings.filter((l) => {
    if (listingState(l) === "draft") return true;
    const a = listingPrimaryAction(l, schedulesByBidId);
    return !!a && !a.quiet;
  }).length;
  const listingsBadge = $("dash-listings-badge");
  if (actionsNeededCount > 0) {
    listingsBadge.textContent = String(actionsNeededCount);
    listingsBadge.hidden = false;
    listingsBadge.title = `${actionsNeededCount} listing${actionsNeededCount === 1 ? "" : "s"} need${actionsNeededCount === 1 ? "s" : ""} your attention`;
  }
  const inboxBadge = $("dash-inbox-badge");
  if (unreadCount > 0) {
    inboxBadge.textContent = String(unreadCount);
    inboxBadge.hidden = false;
  }
  const engageBadge = $("dash-engage-badge");
  if (engageBadge && inProgressCount > 0) {
    engageBadge.textContent = String(inProgressCount);
    engageBadge.hidden = false;
  }

  // welcome
  const firstName = (profile?.full_name || "").split(" ")[0] || "there";
  $("dash-welcome").textContent = `welcome back, ${firstName}.`;

  // Today's date — adds a small dynamic anchor to the header.
  const dateEl = $("dash-page-date");
  if (dateEl) {
    dateEl.textContent = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
  }

  let metaBits = [];
  // Re-derive live count locally — the badge logic above now tracks
  // pending actions instead, so liveCount is no longer in scope here.
  const liveCountForMeta = listings.filter((l) => listingState(l) === "open").length;
  if (liveCountForMeta) metaBits.push(`${liveCountForMeta} live · ${listings.reduce((a, l) => a + (l.__bidCount || 0), 0)} total offers`);
  if (unreadCount) metaBits.push(`${unreadCount} unread`);
  $("dash-h-meta").textContent = metaBits.join(" · ");

  // Notifications panel — pulls recent rows from the notifications
  // table and surfaces them with category icons. The unread count
  // also drives the sidebar bell badge.
  const notifList = $("dash-notifications-list");
  const notifEmpty = $("dash-notifications-empty");
  if (data.session?.user?.id && notifList) {
    mountDashboardNotifications({
      client,
      userId: data.session.user.id,
      listEl: notifList,
      emptyEl: notifEmpty,
    }).then((result) => {
      const unread = result?.unreadCount || 0;
      const notifBadge = $("dash-notif-badge");
      if (notifBadge) {
        notifBadge.textContent = String(unread);
        notifBadge.hidden = unread === 0;
      }
    });
  }

  // 3-day agenda (meetings, proposal deadlines, listing closings)
  const agendaEvents = buildAgendaEvents(listings, data.bidsByListing, schedulesByBidId, consultants);
  renderOwnerAgenda(agendaEvents);

  // listings count + tabs
  const counts = { all: listings.length, open: 0, hired: 0, paused: 0, closed: 0, draft: 0 };
  for (const l of listings) {
    counts[listingState(l)] = (counts[listingState(l)] || 0) + 1;
  }
  $("dash-listings-count").textContent = String(listings.length);
  document.querySelectorAll("[data-count]").forEach((el) => {
    const k = el.dataset.count;
    el.textContent = String(counts[k] || 0);
  });

  // listings rows (dashboard view — show top 5)
  const listingsRows = $("dash-listings-rows");
  const listingsEmpty = $("dash-listings-empty");
  const renderRow = (l) => listingRowHtml(l, schedulesByBidId);
  if (!listings.length) {
    listingsEmpty.hidden = false;
    listingsRows.innerHTML = "";
  } else {
    listingsEmpty.hidden = true;
    listingsRows.innerHTML = listings.slice(0, 5).map(renderRow).join("");
  }

  // my-listings card grid + search/sort toolbar. Independent of the
  // dashboard row list; uses marketplace-style cards so the view
  // reads as its own surface.
  mountMyListingsView(listings, schedulesByBidId);

  // tab filtering on the dashboard listings panel
  const tabsHost = $("dash-listings-tabs");
  if (tabsHost && !tabsHost.dataset.bound) {
    tabsHost.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-state]");
      if (!btn) return;
      tabsHost.querySelectorAll("button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const state = btn.dataset.state;
      const filtered = state === "all" ? listings : listings.filter((l) => listingState(l) === state);
      listingsRows.innerHTML = filtered.length ? filtered.map(renderRow).join("") : `<p class="gr-empty-state" style="padding:1rem">no listings in this state.</p>`;
    });
    tabsHost.dataset.bound = "1";
  }

  // inbox preview — show only threads with unread messages. When there are
  // none, show a "you're all caught up." state instead of the full inbox.
  const allThreads = [];
  for (const [listingId, threads] of Object.entries(threadsByListing)) {
    const listing = listings.find((l) => l.id === listingId);
    for (const t of Object.values(threads)) {
      allThreads.push({ ...t, listingTitle: listing?.title || "" });
    }
  }
  const unreadThreads = allThreads
    .filter((t) => t.unread > 0)
    .sort((a, b) => +new Date(b.lastAt) - +new Date(a.lastAt));
  const inboxPreview = $("dash-inbox-preview");
  const inboxEmpty = $("dash-inbox-empty");
  if (!unreadThreads.length) {
    if (inboxEmpty) {
      inboxEmpty.hidden = false;
      inboxEmpty.textContent = "you're all caught up.";
      inboxEmpty.classList.add("dash-inbox-empty--caught-up");
    }
    if (inboxPreview) inboxPreview.innerHTML = "";
  } else {
    if (inboxEmpty) {
      inboxEmpty.hidden = true;
      inboxEmpty.classList.remove("dash-inbox-empty--caught-up");
    }
    if (inboxPreview) {
      inboxPreview.innerHTML = unreadThreads
        .slice(0, 3)
        .map((t) => inboxRowHtml(client, t, consultants, t.listingTitle))
        .join("");
      hydrateRatings(inboxPreview);
    }
  }

  // (the full inbox view is now rendered by inbox.js — no-op here)

  // engagements (hired listings)
  const engageRows = $("dash-engagements-rows");
  const engageEmpty = $("dash-engagements-empty");
  const inProgress = listings.filter((l) => listingState(l) === "hired");
  if (!inProgress.length) {
    engageEmpty.hidden = false;
    engageRows.innerHTML = "";
  } else {
    engageEmpty.hidden = true;
    engageRows.innerHTML = inProgress.map(renderRow).join("");
  }

  // archive (closed)
  const archiveRows = $("dash-archive-rows");
  const archiveEmpty = $("dash-archive-empty");
  const archive = listings.filter((l) => listingState(l) === "closed");
  if (!archive.length) {
    archiveEmpty.hidden = false;
    archiveRows.innerHTML = "";
  } else {
    archiveEmpty.hidden = true;
    archiveRows.innerHTML = archive.map(renderRow).join("");
  }

  // profile health
  const health = profileCompleteness(profile, biz);
  const acceptedCount = listings.reduce(
    (acc, l) => acc + (l.__bids || []).filter((b) => b.status === "accepted").length,
    0
  );
  const offersLifetime = listings.reduce((a, l) => a + (l.__bidCount || 0), 0);

  const panel = $("dash-profile-health");
  if (panel) {
    const isComplete = health.pct >= 100;
    panel.classList.toggle("is-complete", isComplete);
    panel.classList.toggle("is-incomplete", !isComplete);

    let copy;
    if (isComplete) copy = "your profile is complete. consultants can see exactly who they'd work with.";
    else if (health.missing.length === 1) copy = `add your ${health.missing[0]} to finish your profile.`;
    else copy = `still missing: ${health.missing.slice(0, 3).join(", ")}${health.missing.length > 3 ? `, +${health.missing.length - 3} more` : ""}.`;

    let ctaText;
    if (isComplete) ctaText = "profile is complete ✓";
    else if (health.missing.length === 1) ctaText = `add your ${health.missing[0]}`;
    else ctaText = `complete your profile · ${health.missing.length} left`;

    const tierColor =
      health.pct >= 67 ? "var(--fo-accent)" : health.pct >= 34 ? "var(--fo-do)" : "var(--fo-plan)";

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

      <a href="/profile.html" class="bza__health-cta${isComplete ? "" : " is-pulsing"}">
        <span class="bza__health-cta-text">${escape(ctaText)}</span>
        <span class="bza__health-cta-arrow" aria-hidden="true">→</span>
      </a>
    `;
    // Guarantee the fill animation runs — innerHTML during the busy
    // initial dashboard mount sometimes drops the first frame and
    // leaves the bucket stuck at empty even when pct > 0.
    kickHealthBucketAnimation(panel);
  }

  // Cumulative analytics across all the owner's listings — loads
  // independently so a slow query on listing_views can't block the
  // rest of the dashboard render. Hidden when the owner has no listings
  // yet; shows a "migration needed" message if the listing_views table
  // hasn't been created in supabase.
  const analyticsHost = $("dash-analytics");
  if (analyticsHost) {
    loadOwnerAnalytics(client, data.session?.user?.id).then((analytics) => {
      if (!analytics || (analytics.listingCount === 0 && !analytics.unavailable)) {
        analyticsHost.hidden = true;
        return;
      }
      renderAnalyticsPanel(analyticsHost, analytics, {
        title: "performance",
        compact: true,
      });
    });
  }

  // Garden visual — one root node per completed engagement (released
  // funds + submitted consultant review). Loads in parallel with the
  // rest of the dashboard render; renders with the empty-state copy
  // until the fetch resolves, then re-renders with real nodes.
  const gardenHost = $("dash-garden");
  if (gardenHost) {
    // ─── TEMP: fake roots via `?fakeroots=N` ─────────────────────
    // Lets the owner preview the roots layout without needing real
    // completed engagements in the DB. Drop this whole block (down
    // to the matching `// ─── end TEMP` line) once real engagements
    // exist or once the design is signed off.
    const fakeRootCount = Number(
      new URL(window.location.href).searchParams.get("fakeroots") || 0,
    );
    if (Number.isFinite(fakeRootCount) && fakeRootCount > 0) {
      mountGardenStem(gardenHost, { roots: FAKE_ROOTS.slice(0, fakeRootCount) });
      return; // skip the real data fetch — we're previewing.
    }
    // ─── end TEMP ────────────────────────────────────────────────

    mountGardenStem(gardenHost, { roots: [] });
    loadCompletedEngagements(client, data.session?.user?.id)
      .then((roots) => {
        if (roots.length) mountGardenStem(gardenHost, { roots });
      })
      .catch((err) => console.warn("[garden] load completed engagements failed:", err));
  }
}

/* TEMP fake-root seed data — paired with the `?fakeroots=N` query
   param above. Delete with that block. */
const FAKE_ROOTS = [
  { bidId: "fake-1", listingId: "fake-listing-1",
    listingTitle: "weekend bakery sales push",
    consultantName: "jordan kim", amountCents: 32000,
    releasedAt: "2026-04-12T15:30:00Z" },
  { bidId: "fake-2", listingId: "fake-listing-2",
    listingTitle: "instagram content refresh",
    consultantName: "sam chen", amountCents: 18000,
    releasedAt: "2026-03-22T10:00:00Z" },
  { bidId: "fake-3", listingId: "fake-listing-3",
    listingTitle: "logo + brand mark redesign",
    consultantName: "morgan vasquez", amountCents: 55000,
    releasedAt: "2026-02-14T18:00:00Z" },
  { bidId: "fake-4", listingId: "fake-listing-4",
    listingTitle: "square POS migration help",
    consultantName: "alex park", amountCents: 22000,
    releasedAt: "2026-01-30T09:15:00Z" },
  { bidId: "fake-5", listingId: "fake-listing-5",
    listingTitle: "press release for grand reopening",
    consultantName: "priya rao", amountCents: 12500,
    releasedAt: "2025-12-20T13:45:00Z" },
  { bidId: "fake-6", listingId: "fake-listing-6",
    listingTitle: "monthly bookkeeping setup in quickbooks",
    consultantName: "casey navarro", amountCents: 28000,
    releasedAt: "2025-11-08T16:00:00Z" },
  { bidId: "fake-7", listingId: "fake-listing-7",
    listingTitle: "google business profile + seo cleanup",
    consultantName: "riley alves", amountCents: 16000,
    releasedAt: "2025-10-15T11:20:00Z" },
  { bidId: "fake-8", listingId: "fake-listing-8",
    listingTitle: "saturday market booth signage",
    consultantName: "taylor brooks", amountCents: 9500,
    releasedAt: "2025-09-04T14:45:00Z" },
];

/* ============================================================== */

function setupViewSwitcher() {
  const sidebar = $("dash-sidebar");
  const shell = $("dash-shell");
  const views = document.querySelectorAll(".dash-view");

  function showView(name) {
    // Inbox lives at /inbox.html now — legacy `#inbox` hash on the
    // dashboard redirects there instead of trying to render an
    // in-page section (which was removed).
    if (name === "inbox") {
      window.location.href = "/inbox.html";
      return;
    }
    views.forEach((v) => {
      v.hidden = v.dataset.view !== name;
    });
    sidebar.querySelectorAll(".bza__nav-item[data-view]").forEach((b) => {
      b.classList.toggle("active", b.dataset.view === name);
    });
    const currentHash = window.location.hash.replace("#", "").split("?")[0];
    if (currentHash !== name) {
      window.history.replaceState(null, "", `#${name}`);
    }
  }

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

  // sidebar buttons
  sidebar.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-view]");
    if (!btn) return;
    showView(btn.dataset.view);
  });

  // also wire any other element with data-view (e.g. "view all →" button in dashboard)
  document.querySelectorAll("[data-view]:not(.dash-view)").forEach((el) => {
    if (el.closest("aside")) return;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      showView(el.dataset.view);
    });
  });

  // collapse toggle
  const COLLAPSE_KEY = "grassroots_dash_sidebar_collapsed";
  const toggleBtn = $("dash-side-toggle");
  function applyCollapsed(collapsed) {
    shell.classList.toggle("bza--collapsed", collapsed);
    if (toggleBtn) {
      toggleBtn.setAttribute("aria-expanded", String(!collapsed));
      toggleBtn.setAttribute("aria-label", collapsed ? "expand sidebar" : "collapse sidebar");
    }
  }
  let initialCollapsed = false;
  try {
    initialCollapsed = localStorage.getItem(COLLAPSE_KEY) === "1";
  } catch {}
  applyCollapsed(initialCollapsed);
  function toggleCollapsed() {
    const next = !shell.classList.contains("bza--collapsed");
    applyCollapsed(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
    } catch {}
  }
  toggleBtn?.addEventListener("click", toggleCollapsed);
  $("dash-side-edge")?.addEventListener("dblclick", toggleCollapsed);

  // dark mode toggle in sidebar (mirrors GrassrootsTheme)
  const darkInput = $("dash-darkmode-toggle");
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

  // log out
  const logoutBtn = $("dash-logout");
  logoutBtn?.addEventListener("click", async () => {
    try {
      const client = await getSupabaseClient();
      await client.auth.signOut();
    } catch (err) {
      console.warn("logout failed", err);
    }
    window.location.replace("/signin.html");
  });

  // initial
  const rawHash = window.location.hash.replace("#", "");
  const initial = rawHash.split("?")[0] || "dashboard";
  showView(initial);

  // External hash changes (e.g. the onboarding tutorial dot-nav
  // jumping to a step on a different view) should also switch the
  // visible panel. The sidebar click path already updates the hash
  // via history.replaceState — skip if the new hash matches the
  // already-visible view to avoid an unnecessary render.
  window.addEventListener("hashchange", () => {
    const name = window.location.hash.replace("#", "").split("?")[0] || "dashboard";
    const visible = document.querySelector(".dash-view:not([hidden])");
    if (visible && visible.dataset.view === name) return;
    showView(name);
  });
}

/* ============================================================== */

async function init() {
  const gate = $("dash-gate");
  const shell = $("dash-shell");
  try {
    const client = await getSupabaseClient();
    const {
      data: { session },
    } = await client.auth.getSession();
    if (!session?.user) {
      window.location.replace("/signin.html?next=/dashboard.html");
      return;
    }

    const data = await loadData(client, session.user.id);
    data.session = session;

    // Only redirect a confirmed consultant. A null/missing profile or an
    // unrecognized role means something went wrong — don't bounce the user
    // because that would loop with the marketplace's own role redirect.
    if (data.profile && data.profile.role === "consultant") {
      window.location.replace("/consultant-dashboard.html");
      return;
    }

    gate.hidden = true;
    shell.hidden = false;
    renderDashboard(client, data);
    setupViewSwitcher();
  } catch (err) {
    console.error(err);
    gate.textContent = err.message || "could not load dashboard.";
    gate.className = "gr-status error";
  }
}

init();

// Delegated handler for the draft-delete affordances rendered into
// the activity feed rows and the my-listings cards. Re-rendering on
// success would mean stitching together every counter and tab on the
// page; a full reload is heavy but reliably honest. Sourcing the
// listing id from the button's dataset keeps the row markup small.
document.addEventListener("click", async (event) => {
  const btn = event.target instanceof HTMLElement
    ? event.target.closest("[data-draft-delete-id]")
    : null;
  if (!btn) return;
  event.preventDefault();
  event.stopPropagation();

  const listingId = btn.getAttribute("data-draft-delete-id");
  const title = btn.getAttribute("data-draft-title") || "this draft";
  if (!listingId) return;

  const ok = await confirmDialog({
    title: "delete this draft?",
    body: `"${title}" hasn't been published — deleting it can't be undone. you'll need to start over if you want to recreate it.`,
    confirmLabel: "delete draft",
    cancelLabel: "keep it",
    kind: "danger",
  });
  if (!ok) return;

  btn.disabled = true;
  const originalLabel = btn.textContent;
  btn.textContent = "deleting…";
  try {
    const client = await getSupabaseClient();
    await deleteListing(client, listingId);
    showToast("draft deleted.", { kind: "success", duration: 3500 });
    // Sync dispatch so the onboarding listener can advance tutorial
    // state (writes to localStorage) BEFORE the reload reads it back.
    window.dispatchEvent(new CustomEvent("gr:draft-deleted", { detail: { listingId } }));
    window.location.reload();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = originalLabel;
    const msg = err instanceof ListingOperationError
      ? err.message
      : err?.message || "could not delete the draft.";
    showToast(msg, { kind: "error", duration: 5000 });
  }
});
