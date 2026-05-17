// profile-page.js — the "your profile" dashboard at /profile.html.
// Pulls together: header (avatar/name/role + edit button), consultant
// progression (moved out of settings), and a reviews & ratings summary
// that links to /my-reviews.html. Owner version is intentionally minimal.

import { getSupabaseClient } from "/supabase-loader.js";
import { getInitials } from "/initials.js";
import { renderRatingMarkup } from "/rating.js";

const $ = (id) => document.getElementById(id);

const DIM_LABELS = [
  ["work_product_quality", "work product"],
  ["communication", "communication"],
  ["timeliness", "timeliness"],
  ["professionalism", "professionalism"],
  ["cost_value", "cost value"],
];

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtUSD(cents) {
  if (!Number.isFinite(Number(cents))) return "$0";
  const dollars = Number(cents) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: dollars >= 1000 ? 0 : 2,
  }).format(dollars);
}

function readNumericCandidate(source, keys) {
  if (!source || typeof source !== "object") return null;
  for (const key of keys) {
    const raw = source[key];
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function getRelatedRow(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

// Mirrors the staging logic that used to live in profile.js. Keep in sync if
// the thresholds change there or in any consultant-facing copy.
function calculateStageProgress(engagementsCompleted, avgRating) {
  const stages = [
    {
      index: 0,
      name: "seedling",
      modelLabel: "stage 0: seedling",
      nextCopy: "complete 1 free engagement and earn an average rating of at least 4.0 stars.",
      targetEngagements: 1,
      targetRating: 4,
    },
    {
      index: 1,
      name: "sprout",
      modelLabel: "sprout stage placeholder",
      nextCopy: "maintain a 4.0+ rating and complete 2 engagements to reach stage 2.",
      targetEngagements: 2,
      targetRating: 4,
    },
    {
      index: 2,
      name: "small tree",
      modelLabel: "small tree stage placeholder",
      nextCopy: "complete 10+ engagements and keep your rating above 4.0 to unlock giant sequoia status.",
      targetEngagements: 10,
      targetRating: 4.1,
    },
    {
      index: 3,
      name: "giant sequoia",
      modelLabel: "giant sequoia stage placeholder",
      nextCopy: "you've reached the highest stage. keep delivering strong work to hold sequoia status.",
      targetEngagements: 10,
      targetRating: 4.1,
    },
  ];

  let stageIndex = 0;
  if (avgRating != null && avgRating > 4 && engagementsCompleted >= 10) {
    stageIndex = 3;
  } else if (avgRating != null && avgRating >= 4 && engagementsCompleted >= 2) {
    stageIndex = 2;
  } else if (avgRating != null && avgRating >= 4 && engagementsCompleted >= 1) {
    stageIndex = 1;
  }

  const stage = stages[stageIndex];
  if (stage.index === stages.length - 1) {
    return { ...stage, progressPercent: 100 };
  }

  const engagementProgress = clamp(engagementsCompleted / stage.targetEngagements, 0, 1);
  const ratingProgress = avgRating == null ? 0 : clamp(avgRating / stage.targetRating, 0, 1);
  const progressPercent = Math.round((engagementProgress * 0.6 + ratingProgress * 0.4) * 100);
  return { ...stage, progressPercent };
}

async function loadConsultantStats(supabase, userId, profileRow) {
  const consultantProfile = getRelatedRow(profileRow?.consultant_profiles);
  let engagementsCompleted =
    readNumericCandidate(consultantProfile, [
      "engagements_completed",
      "completed_engagements",
      "engagement_count",
      "total_engagements",
    ]) ?? 0;
  let avgRating = readNumericCandidate(consultantProfile, [
    "average_rating",
    "avg_rating",
    "rating_average",
    "rating_avg",
    "stars_average",
    "avg_stars",
    "rating",
  ]);
  let totalEarnedCents = 0;

  try {
    const { data, error } = await supabase
      .from("bids")
      .select("status, accepted_at, payment_status, payment_amount_cents")
      .eq("consultant_id", userId);
    if (!error && Array.isArray(data)) {
      if (engagementsCompleted === 0) {
        engagementsCompleted = data.filter((b) => b?.status === "accepted" || Boolean(b?.accepted_at)).length;
      }
      totalEarnedCents = data
        .filter((b) => b?.payment_status === "released")
        .reduce((sum, b) => sum + (Number(b?.payment_amount_cents) || 0), 0);
    }
  } catch (_) {
    // Best-effort — older schemas / RLS may not expose bids.
  }

  return {
    engagementsCompleted,
    avgRating: Number.isFinite(avgRating) ? avgRating : null,
    totalEarnedCents,
  };
}

function renderAvatar(client, avatarPath, fullName) {
  const avEl = $("pp-avatar");
  if (!avEl) return;
  const url = client && avatarPath
    ? client.storage.from("avatars").getPublicUrl(avatarPath).data?.publicUrl || ""
    : "";
  const initial = getInitials(fullName);
  avEl.innerHTML = url ? `<img src="${url}" alt="" />` : escapeHtml(initial);
}

function renderHeader(profile) {
  $("pp-name").textContent = profile?.full_name || "your account";
  const role = profile?.role;
  const roleLabel = role === "consultant" ? "consultant" : role === "business_owner" ? "business owner" : "";
  $("pp-role").textContent = roleLabel;

  // Headline (consultants) — pulled from consultant_profiles when present.
  const cp = getRelatedRow(profile?.consultant_profiles);
  const headline = cp?.headline || cp?.tagline || "";
  if (headline) {
    const bioEl = $("pp-bio");
    bioEl.textContent = headline;
    bioEl.hidden = false;
  }
}

function renderMetrics(stats, rating) {
  const section = $("pp-metrics-section");
  if (!section) return;
  section.classList.remove("hidden");

  const apiRating = Number(rating?.rating_average);
  const reviewCount = Number(rating?.review_count) || 0;
  const ratingValue = Number.isFinite(apiRating) && reviewCount > 0 ? apiRating : stats.avgRating;

  const ratingFill = $("pp-metric-rating-fill");
  const ratingCountEl = $("pp-metric-rating-count");
  if (ratingValue == null || !Number.isFinite(ratingValue)) {
    $("pp-metric-rating").textContent = "—";
    if (ratingFill) ratingFill.style.width = "0%";
    if (ratingCountEl) ratingCountEl.hidden = true;
  } else {
    $("pp-metric-rating").textContent = ratingValue.toFixed(1);
    if (ratingFill) {
      const clamped = Math.max(0, Math.min(5, ratingValue));
      ratingFill.style.width = `${((clamped / 5) * 100).toFixed(1)}%`;
    }
    if (ratingCountEl) {
      // Only surface the count when there are reviews — "(0)" reads
      // like noise for unrated consultants and the empty-stars row
      // already communicates "nobody has rated this yet".
      if (reviewCount > 0) {
        ratingCountEl.textContent = `(${reviewCount})`;
        ratingCountEl.hidden = false;
      } else {
        ratingCountEl.hidden = true;
      }
    }
  }

  $("pp-metric-engagements").textContent = String(stats.engagementsCompleted ?? 0);
  $("pp-metric-earned").textContent = fmtUSD(stats.totalEarnedCents);
}

function renderProgression(profile, stats) {
  const section = $("pp-progression-section");
  if (!section) return;
  section.classList.remove("hidden");

  const firstName = String(profile?.full_name || "").trim().split(/\s+/)[0] || "consultant";
  const stage = calculateStageProgress(stats.engagementsCompleted, stats.avgRating);

  $("pf-level-title").textContent = `stage ${stage.index}: ${stage.name}`;
  $("pf-level-name").textContent = firstName;
  $("pf-stage-model").dataset.stage = String(stage.index);
  $("pf-stage-model-label").textContent = stage.modelLabel;
  $("pf-level-progress-fill").style.width = `${stage.progressPercent}%`;
  $("pf-level-progress-label").textContent = `${stage.progressPercent}%`;
  $("pf-level-progress-copy").textContent = stage.nextCopy;
}

function renderReviews(rating, recentReviews) {
  const section = $("pp-reviews-section");
  if (!section) return;
  section.classList.remove("hidden");

  // The "overall" pill (big number + stars + review count) used to live
  // here, but the metric strip at the top of the page already surfaces
  // the same data ("4.6 ★★★★★ (1)"), so we just render the per-dimension
  // breakdown below.

  // Per-dimension breakdown — same shape as /my-reviews.html
  $("pp-reviews-dims").innerHTML = DIM_LABELS.map(([key, label]) => {
    const apiKey = key === "work_product_quality" ? "work_product_quality_avg" : `${key}_avg`;
    const val = rating?.[apiKey];
    return `
      <div class="pp-reviews-dim">
        <span class="pp-reviews-dim__label">${label}</span>
        <span class="pp-reviews-dim__rating">
          ${renderRatingMarkup(
            { rating_average: val, review_count: val ? 1 : 0 },
            { size: "sm", showCount: false }
          )}
        </span>
        <span class="pp-reviews-dim__value">${Number.isFinite(val) ? Number(val).toFixed(1) : "—"}</span>
      </div>
    `;
  }).join("");

  // Recent endorsements (max 2). Empty endorsements collapse the block.
  const withQuotes = (recentReviews || []).filter((r) => r?.endorsement && r.endorsement.trim());
  const recent = withQuotes.slice(0, 2);

  if (!rating?.review_count) {
    $("pp-reviews-empty").hidden = false;
    return;
  }

  if (!recent.length) return;
  $("pp-reviews-recent").hidden = false;
  $("pp-reviews-recent-list").innerHTML = recent
    .map((r) => {
      const title = r.listings?.title ? `re: ${escapeHtml(r.listings.title)}` : "";
      return `
        <article class="pp-review-card">
          <header class="pp-review-card__head">
            <span class="pp-review-card__date">${escapeHtml(fmtDate(r.created_at))}</span>
            ${title ? `<span class="pp-review-card__listing">${title}</span>` : ""}
          </header>
          <blockquote class="pp-review-card__quote">${escapeHtml(r.endorsement)}</blockquote>
          <p class="pp-review-card__author">${r.is_anonymous ? "anonymous review" : "from the business"}</p>
        </article>
      `;
    })
    .join("");
}

function renderOwnerSection() {
  const section = $("pp-owner-section");
  if (section) section.classList.remove("hidden");
}

async function fetchProfileRow(supabase, userId) {
  // Wildcard the consultant_profiles join — column set varies by env, and
  // the page only reads optional fields (headline, *_rating, *_completed).
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, role, avatar_path, consultant_profiles(*)")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function fetchConsultantRating(session) {
  const headers = {};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  try {
    const resp = await fetch(`/api/consultant-profile/${encodeURIComponent(session.user.id)}`, { headers });
    if (!resp.ok) return null;
    const json = await resp.json().catch(() => ({}));
    return json?.rating || null;
  } catch (_) {
    return null;
  }
}

async function fetchRecentReviews(supabase, userId) {
  try {
    const { data, error } = await supabase
      .from("consultant_reviews")
      .select(
        "id, listing_id, endorsement, is_anonymous, created_at, listings(title)"
      )
      .eq("consultant_id", userId)
      .not("endorsement", "is", null)
      .order("created_at", { ascending: false })
      .limit(5);
    if (error && !/does not exist|schema cache/i.test(error.message || "")) throw error;
    return data || [];
  } catch (_) {
    return [];
  }
}

async function mountConsultantGarden(supabase, userId) {
  const section = $("pp-garden-section");
  const container = $("pp-garden");
  if (!section || !container) return;
  section.classList.remove("hidden");
  try {
    const { mountGarden } = await import("/garden.js");
    await mountGarden(container, { client: supabase, userId });
  } catch (err) {
    console.warn("garden mount failed", err);
    container.innerHTML = `<p class="pp-garden__empty">couldn't load your garden.</p>`;
  }
}

async function init() {
  const gate = $("pp-gate");
  try {
    const supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      window.location.replace("/signin.html?next=" + encodeURIComponent("/profile.html"));
      return;
    }

    const profile = await fetchProfileRow(supabase, session.user.id);
    renderAvatar(supabase, profile?.avatar_path, profile?.full_name);
    renderHeader(profile);

    if (profile?.role === "consultant") {
      const [stats, rating, recent] = await Promise.all([
        loadConsultantStats(supabase, session.user.id, profile),
        fetchConsultantRating(session),
        fetchRecentReviews(supabase, session.user.id),
      ]);
      renderMetrics(stats, rating);
      // Garden section sits between metrics + progression. Mount it
      // before progression so the bloomed engagements land first.
      await mountConsultantGarden(supabase, session.user.id);
      renderProgression(profile, stats);
      renderReviews(rating, recent);
    } else {
      renderOwnerSection();
    }

    gate.hidden = true;
    $("pp-page").hidden = false;
  } catch (err) {
    console.error(err);
    gate.textContent = err?.message || "could not load your profile.";
    gate.className = "gr-status error";
  }
}

init();
