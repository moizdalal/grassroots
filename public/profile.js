import { getSupabaseClient } from "/supabase-loader.js";
import { formatBudgetRange, parseBudgetRange } from "/sim-budget.js";
import { getInitials } from "/initials.js";

const form = document.getElementById("profile-form");
const gateEl = document.getElementById("profile-gate");
const statusEl = document.getElementById("status");
const avatarPreview = document.getElementById("avatar-preview");
const avatarInput = document.getElementById("avatar-input");
const resumeInput = document.getElementById("resume-input");
const resumeCurrent = document.getElementById("resume-current");
const resumePublicToggle = document.getElementById("resume-public-toggle");
const businessSection = document.getElementById("business-section");
const consultantSection = document.getElementById("consultant-section");
const consultantEducationSection = document.getElementById("consultant-education-section");
const profileTabButtons = [...document.querySelectorAll("[data-profile-tab]")];
const profilePanels = [...document.querySelectorAll("[data-profile-panel]")];
const portfolioList = document.getElementById("portfolio-list");
const portfolioInput = document.getElementById("portfolio-input");
const portfolioDesc = document.getElementById("portfolio-desc");
const portfolioPublicToggle = document.getElementById("portfolio-public-toggle");
const portfolioUploadBtn = document.getElementById("portfolio-upload-btn");
const previewBar = document.getElementById("pf-preview-bar");
const previewToggle = document.getElementById("pf-preview-toggle");
const businessView = document.getElementById("pf-business-view");
const resumeViewer = document.getElementById("pf-resume-viewer");
const resumeViewerFrame = document.getElementById("pf-resume-viewer-frame");
const resumeViewerTitle = document.getElementById("pf-resume-viewer-title");
const resumeViewerDownload = document.getElementById("pf-resume-viewer-download");
const saveBtn = document.getElementById("save-btn");
const linkedinFieldWrap = document.getElementById("field-linkedin-wrap");
const levelCard = document.getElementById("pf-level-card");
const ownerCard = document.getElementById("pf-owner-card");
const ownerCurrentList = document.getElementById("pf-owner-current-list");
const ownerPastList = document.getElementById("pf-owner-past-list");
const ownerHistoryToggle = document.getElementById("pf-owner-history-toggle");
const ownerHistory = document.getElementById("pf-owner-history");
const levelTitle = document.getElementById("pf-level-title");
const levelName = document.getElementById("pf-level-name");
const levelRating = document.getElementById("pf-level-rating");
const levelEngagements = document.getElementById("pf-level-engagements");
const stageModel = document.getElementById("pf-stage-model");
const stageModelLabel = document.getElementById("pf-stage-model-label");
const levelProgressFill = document.getElementById("pf-level-progress-fill");
const levelProgressLabel = document.getElementById("pf-level-progress-label");
const levelProgressCopy = document.getElementById("pf-level-progress-copy");

const welcomeOverlay = document.getElementById("welcome-overlay");
const welcomeDismiss = document.getElementById("welcome-dismiss");

const PLACEHOLDER =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120"><rect fill="#e8f0ec" width="120" height="120"/><text x="50%" y="52%" dominant-baseline="middle" text-anchor="middle" fill="#7a8b82" font-family="system-ui,sans-serif" font-size="13">no photo</text></svg>`
  );

let supabase;
let userId;
let role;
let currentAvatarPath = null;
let currentResumePath = null;
let pendingAvatarFile = null;
/** Last saved business Instagram URL (for change detection). */
let loadedInstagramUrl = null;
let businessAddressSupported = true;
let portfolioItems = [];
let availableProfileTabs = ["personal"];
let activeProfileTab = "personal";

function buildBizSocialLinksArray(instagramUrl, facebookUrl, companyLinkedinUrl) {
  const out = [instagramUrl, facebookUrl, companyLinkedinUrl]
    .map((s) => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  return out.length ? out : null;
}

/** Match server `normalizeInstagramProfileUrl` enough for compare + DB writes. */
function normalizeBusinessInstagramUrl(input) {
  if (!input || typeof input !== "string") return null;
  const t = input.trim();
  const pathMatch = t.match(/(?:https?:\/\/)?(?:www\.)?instagram\.com\/([A-Za-z0-9._]+)/i);
  if (pathMatch) return `https://www.instagram.com/${pathMatch[1]}/`;
  const bare = t.replace(/^@/, "");
  if (/^[a-zA-Z0-9._]+$/.test(bare)) return `https://www.instagram.com/${bare}/`;
  return null;
}

function wireInstagramFieldAutoCheck() {
  const input = document.getElementById("field-biz-instagram");
  const cb = document.getElementById("biz-social-instagram-on");
  const wrap = document.getElementById("biz-social-instagram-field");
  if (!input || !cb || !wrap) return;
  const openIfValue = () => {
    if (!input.value.trim()) return;
    cb.checked = true;
    wrap.classList.remove("hidden");
  };
  input.addEventListener("input", openIfValue);
  input.addEventListener("blur", openIfValue);
  input.addEventListener("paste", () => queueMicrotask(openIfValue));
}

function wireBizSocialToggles() {
  const pairs = [
    ["biz-social-instagram-on", "biz-social-instagram-field"],
    ["biz-social-facebook-on", "biz-social-facebook-field"],
    ["biz-social-linkedin-on", "biz-social-linkedin-field"],
  ];
  for (const [cbId, wrapId] of pairs) {
    const cb = document.getElementById(cbId);
    const wrap = document.getElementById(wrapId);
    if (!cb || !wrap) continue;
    cb.addEventListener("change", () => {
      if (cb.checked) {
        wrap.classList.remove("hidden");
        const input = wrap.querySelector("input");
        input?.focus();
      } else {
        wrap.classList.add("hidden");
        const input = wrap.querySelector("input");
        if (input) input.value = "";
      }
    });
  }
}

function applyBizSocialFromRow(b) {
  if (!b) {
    ["field-biz-instagram", "field-biz-facebook", "field-biz-company-linkedin"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.value = "";
    });
    ["biz-social-instagram-on", "biz-social-facebook-on", "biz-social-linkedin-on"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.checked = false;
    });
    ["biz-social-instagram-field", "biz-social-facebook-field", "biz-social-linkedin-field"].forEach(
      (id) => {
        document.getElementById(id)?.classList.add("hidden");
      }
    );
    return;
  }
  const ig = (b.instagram_url || "").trim();
  const fb = (b.facebook_url || "").trim();
  const li = (b.company_linkedin_url || "").trim();
  const igCb = document.getElementById("biz-social-instagram-on");
  const igWrap = document.getElementById("biz-social-instagram-field");
  const igIn = document.getElementById("field-biz-instagram");
  if (igCb && igWrap && igIn) {
    igCb.checked = Boolean(ig);
    igIn.value = ig;
    igWrap.classList.toggle("hidden", !ig);
  }
  const fbCb = document.getElementById("biz-social-facebook-on");
  const fbWrap = document.getElementById("biz-social-facebook-field");
  const fbIn = document.getElementById("field-biz-facebook");
  if (fbCb && fbWrap && fbIn) {
    fbCb.checked = Boolean(fb);
    fbIn.value = fb;
    fbWrap.classList.toggle("hidden", !fb);
  }
  const liCb = document.getElementById("biz-social-linkedin-on");
  const liWrap = document.getElementById("biz-social-linkedin-field");
  const liIn = document.getElementById("field-biz-company-linkedin");
  if (liCb && liWrap && liIn) {
    liCb.checked = Boolean(li);
    liIn.value = li;
    liWrap.classList.toggle("hidden", !li);
  }
}

function sanitizeFileName(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function getRelatedRow(value) {
  return Array.isArray(value) ? value[0] || null : value || null;
}

function isMissingResumePublic(error) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("resume_public") && msg.includes("schema cache");
}

function isMissingBusinessAddress(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("business_address") &&
    (msg.includes("schema cache") || msg.includes("does not exist") || msg.includes("could not find"))
  );
}

function getFirstName(fullName) {
  const trimmed = String(fullName || "").trim();
  return trimmed ? trimmed.split(/\s+/)[0] : "consultant";
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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function formatUsd(cents) {
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return "";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount / 100);
}

function isSchemaLookupError(error) {
  const msg = String(error?.message || "").toLowerCase();
  return (
    msg.includes("schema cache") ||
    msg.includes("does not exist") ||
    msg.includes("could not find") ||
    msg.includes("column")
  );
}

function setActiveProfileTab(tabName) {
  const nextTab = availableProfileTabs.includes(tabName) ? tabName : availableProfileTabs[0] || "personal";
  activeProfileTab = nextTab;

  profileTabButtons.forEach((button) => {
    const isActive = button.dataset.profileTab === nextTab;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", String(isActive));
    button.tabIndex = isActive ? 0 : -1;
  });

  profilePanels.forEach((panel) => {
    const panelTab = panel.dataset.profilePanel;
    const isVisible = availableProfileTabs.includes(panelTab) && panelTab === nextTab;
    panel.classList.toggle("pf-form-panel--active", isVisible);
    panel.hidden = !isVisible;
  });
}

function syncProfileTabsForRole(currentRole) {
  availableProfileTabs =
    currentRole === "business_owner"
      ? ["personal", "business"]
      : currentRole === "consultant"
        ? ["personal", "credibility"]
        : ["personal"];

  profileTabButtons.forEach((button) => {
    button.classList.toggle("hidden", !availableProfileTabs.includes(button.dataset.profileTab));
  });

  if (businessSection) {
    businessSection.classList.toggle("hidden", currentRole !== "business_owner");
  }

  if (linkedinFieldWrap) {
    linkedinFieldWrap.classList.toggle("hidden", currentRole === "business_owner");
  }

  if (consultantSection) {
    consultantSection.classList.toggle("hidden", currentRole !== "consultant");
  }

  if (consultantEducationSection) {
    consultantEducationSection.classList.toggle("hidden", currentRole !== "consultant");
  }

  setActiveProfileTab("personal");
}

function calculateStageProgress(engagementsCompleted, avgRating) {
  const stages = [
    {
      index: 0,
      name: "seedling",
      modelLabel: "seedling stage placeholder",
      nextCopy: "complete 1 free engagement and earn an average rating of at least 4.0 stars.",
      targetEngagements: 1,
      targetRating: 4,
      strictRating: false,
    },
    {
      index: 1,
      name: "sprout",
      modelLabel: "sprout stage placeholder",
      nextCopy: "maintain a 4.0+ rating and complete 2 engagements to reach stage 2.",
      targetEngagements: 2,
      targetRating: 4,
      strictRating: false,
    },
    {
      index: 2,
      name: "small tree",
      modelLabel: "small tree stage placeholder",
      nextCopy: "complete 10+ engagements and keep your rating above 4.0 to unlock giant sequoia status.",
      targetEngagements: 10,
      targetRating: 4.1,
      strictRating: true,
    },
    {
      index: 3,
      name: "giant sequoia",
      modelLabel: "giant sequoia stage placeholder",
      nextCopy: "you've reached the highest stage. keep delivering strong work to hold sequoia status.",
      targetEngagements: 10,
      targetRating: 4.1,
      strictRating: true,
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

async function loadConsultantProgressStats(row) {
  const consultantProfile = getRelatedRow(row?.consultant_profiles);
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

  try {
    const { data, error } = await supabase
      .from("bids")
      .select("status, accepted_at")
      .eq("consultant_id", userId);

    if (!error && Array.isArray(data) && engagementsCompleted === 0) {
      engagementsCompleted = data.filter((bid) => bid?.status === "accepted" || Boolean(bid?.accepted_at)).length;
    }
  } catch (_) {
    // Leave consultant progress on safe fallbacks when newer bid tables or policies are unavailable.
  }

  return {
    engagementsCompleted,
    avgRating: Number.isFinite(avgRating) ? avgRating : null,
  };
}

function renderConsultantLevelSidebar(row, stats) {
  if (
    !levelCard ||
    !ownerCard ||
    !levelTitle ||
    !levelName ||
    !levelRating ||
    !levelEngagements ||
    !stageModel ||
    !stageModelLabel ||
    !levelProgressFill ||
    !levelProgressLabel ||
    !levelProgressCopy
  ) {
    return;
  }

  const firstName = getFirstName(row?.full_name);
  const avgRating = stats?.avgRating ?? null;
  const engagementsCompleted = stats?.engagementsCompleted ?? 0;
  const stage = calculateStageProgress(engagementsCompleted, avgRating);

  ownerCard.classList.add("hidden");
  levelCard.classList.remove("hidden");
  levelTitle.textContent = `stage ${stage.index}: ${stage.name}`;
  levelName.textContent = firstName;
  levelRating.textContent =
    avgRating == null ? "rating not available yet" : `${avgRating.toFixed(1)} average rating`;
  levelEngagements.textContent = `${engagementsCompleted} ${
    engagementsCompleted === 1 ? "engagement" : "engagements"
  } completed`;
  stageModel.dataset.stage = String(stage.index);
  stageModelLabel.textContent = stage.modelLabel;
  levelProgressFill.style.width = `${stage.progressPercent}%`;
  levelProgressLabel.textContent = `${stage.progressPercent}%`;
  levelProgressCopy.textContent = stage.nextCopy;
}

function renderOwnerSidebar() {
  if (!levelCard || !ownerCard) return;
  levelCard.classList.add("hidden");
  ownerCard.classList.remove("hidden");
}

profileTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveProfileTab(button.dataset.profileTab || "personal");
  });
});

function formatOwnerListingState(listing, acceptedBid) {
  const rawStatus = String(listing?.status || "").toLowerCase();
  if (rawStatus === "closed") return "closed";
  if (rawStatus === "paused") return "paused";
  if (acceptedBid) return "accepted";
  return "active";
}

function renderOwnerListingItems(container, items, emptyMessage, mode) {
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<p class="pf-owner-empty">${escapeHtml(emptyMessage)}</p>`;
    return;
  }

  container.innerHTML = items
    .map((item) => {
      const metaText =
        mode === "past"
          ? item.acceptedDisplay
            ? `accepted for ${escapeHtml(item.acceptedDisplay)}`
            : "accepted amount not available"
          : escapeHtml(item.budgetDisplay || "budget not available");

      return `
        <a class="pf-owner-item" href="/listing.html?id=${escapeAttr(item.id)}">
          <div class="pf-owner-item__head">
            <span class="pf-owner-item__title">${escapeHtml(item.title || "untitled listing")}</span>
            <span class="pf-owner-item__state pf-owner-item__state--${escapeAttr(item.state)}">${escapeHtml(item.state)}</span>
          </div>
          <span class="pf-owner-item__meta">${metaText}</span>
        </a>
      `;
    })
    .join("");
}

async function loadOwnerListingSummary() {
  if (!supabase || !userId) return { current: [], past: [] };

  try {
    let listingRows = [];
    let listingLoaded = false;
    let lastListingError = null;
    const listingAttempts = [
      { table: "listings", select: "id, title, status, budget_cents, details, created_at" },
      { table: "marketplace_listings", select: "id, title, status, budget_cents, details, created_at" },
      { table: "marketplace_listings", select: "id, title, status, details, created_at" },
    ];

    for (const attempt of listingAttempts) {
      const { data, error } = await supabase
        .from(attempt.table)
        .select(attempt.select)
        .eq("owner_id", userId)
        .order("created_at", { ascending: false })
        .limit(60);

      if (!error) {
        listingRows = data || [];
        listingLoaded = true;
        break;
      }

      lastListingError = error;
      if (!isSchemaLookupError(error)) throw error;
    }

    if (!listingLoaded && lastListingError) throw lastListingError;
    if (!listingRows.length) return { current: [], past: [] };

    const listingIds = listingRows.map((row) => row.id).filter(Boolean);
    const acceptedBidByListing = new Map();
    try {
      const { data: bids, error: bidError } = await supabase
        .from("bids")
        .select("listing_id, amount_cents, status, accepted_at")
        .in("listing_id", listingIds)
        .order("accepted_at", { ascending: false, nullsFirst: false });

      if (bidError) throw bidError;

      (bids || []).forEach((bid) => {
        const isAccepted = bid?.status === "accepted" || Boolean(bid?.accepted_at);
        if (!isAccepted || acceptedBidByListing.has(bid.listing_id)) return;
        acceptedBidByListing.set(bid.listing_id, bid);
      });
    } catch (error) {
      console.warn("owner listing accepted-bid lookup failed", error);
    }

    const mapped = listingRows.map((listing) => {
      const acceptedBid = acceptedBidByListing.get(listing.id) || null;
      const budgetRange = parseBudgetRange(listing.details || "");
      const budgetDisplay = budgetRange
        ? formatBudgetRange(budgetRange)
        : Number.isFinite(Number(listing.budget_cents))
          ? formatUsd(Number(listing.budget_cents))
          : "";

      return {
        id: listing.id,
        title: listing.title,
        state: formatOwnerListingState(listing, acceptedBid),
        budgetDisplay,
        acceptedDisplay: acceptedBid ? formatUsd(acceptedBid.amount_cents) : "",
        createdAt: listing.created_at,
      };
    });

    return {
      current: mapped.filter((item) => item.state !== "closed"),
      past: mapped.filter((item) => item.state === "closed"),
    };
  } catch (error) {
    console.warn("owner listing summary load failed", error);
    return { current: [], past: [] };
  }
}

async function renderOwnerListingSidebar() {
  renderOwnerSidebar();
  if (!ownerCurrentList || !ownerPastList) return;

  const { current, past } = await loadOwnerListingSummary();
  renderOwnerListingItems(ownerCurrentList, current, "no current listings yet.", "current");
  renderOwnerListingItems(ownerPastList, past, "no past listings yet.", "past");

  if (ownerHistoryToggle && ownerHistory) {
    const hasPast = past.length > 0;
    ownerHistoryToggle.hidden = !hasPast;
    ownerHistory.classList.toggle("hidden", true);
    ownerHistoryToggle.setAttribute("aria-expanded", "false");

    if (!ownerHistoryToggle.dataset.bound) {
      ownerHistoryToggle.addEventListener("click", () => {
        const expanded = ownerHistoryToggle.getAttribute("aria-expanded") === "true";
        ownerHistoryToggle.setAttribute("aria-expanded", String(!expanded));
        ownerHistory.classList.toggle("hidden", expanded);
      });
      ownerHistoryToggle.dataset.bound = "1";
    }
  }
}

function setAvatarPreview(src) {
  if (src) {
    avatarPreview.src = src;
    avatarPreview.alt = "profile photo";
  } else {
    avatarPreview.src = PLACEHOLDER;
    avatarPreview.alt = "";
  }
}

/* ================================================================
   Portfolio management
   ================================================================ */

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeAttr(s) {
  return String(s ?? "").replace(/"/g, "&quot;");
}

function getStorageFileName(filePath) {
  return String(filePath || "").split("/").pop() || "resume";
}

function getResumeActionMarkup(fileName, options = {}) {
  const {
    previewLabel = "preview resume",
    source = "self",
    consultantId = "",
    manage = false,
  } = options;
  const safeFileName = fileName || "resume";
  const manageMarkup = manage
    ? `
      <button
        type="button"
        class="pf-bv__resume-btn pf-bv__resume-btn--manage"
        data-resume-action="replace"
      >replace</button>
      <button
        type="button"
        class="pf-bv__resume-btn pf-bv__resume-btn--danger"
        data-resume-action="remove"
      >remove</button>
    `
    : "";
  return `
    <span class="pf-bv__resume-actions">
      <button
        type="button"
        class="pf-bv__resume-btn"
        data-resume-action="preview"
        data-resume-source="${escapeAttr(source)}"
        ${consultantId ? `data-resume-consultant-id="${escapeAttr(consultantId)}"` : ""}
        data-resume-file-name="${escapeAttr(safeFileName)}"
      >${escapeHtml(previewLabel)}</button>
      <button
        type="button"
        class="pf-bv__resume-download"
        data-resume-action="download"
        data-resume-source="${escapeAttr(source)}"
        ${consultantId ? `data-resume-consultant-id="${escapeAttr(consultantId)}"` : ""}
        data-resume-file-name="${escapeAttr(safeFileName)}"
        aria-label="download resume"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 4v10"></path>
          <path d="m8 10 4 4 4-4"></path>
          <path d="M5 19h14"></path>
        </svg>
      </button>
      ${manageMarkup}
    </span>
  `;
}

function openResumeViewer(url, fileName = "resume") {
  if (!resumeViewer || !resumeViewerFrame || !resumeViewerTitle || !resumeViewerDownload || !url) return;
  resumeViewerTitle.textContent = fileName;
  resumeViewerFrame.src = url;
  resumeViewerDownload.href = url;
  resumeViewerDownload.setAttribute("download", fileName);
  resumeViewer.classList.remove("hidden");
  resumeViewer.setAttribute("aria-hidden", "false");
  document.body.classList.add("gr-modal-open");
}

function closeResumeViewer() {
  if (!resumeViewer || !resumeViewerFrame) return;
  resumeViewer.classList.add("hidden");
  resumeViewer.setAttribute("aria-hidden", "true");
  resumeViewerFrame.src = "about:blank";
  document.body.classList.remove("gr-modal-open");
}

function triggerResumeDownload(url, fileName = "resume") {
  const link = document.createElement("a");
  link.href = url;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

async function getOwnResumeSignedUrl(resumePath) {
  if (!supabase || !resumePath) return null;
  try {
    const { data, error } = await supabase.storage
      .from("resumes")
      .createSignedUrl(resumePath, 60 * 30);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (_) {
    return null;
  }
}

function getResumeUploadLabel() {
  return document.getElementById("pf-resume-upload-label");
}

async function renderResumeCurrentLabel(messagePrefix = "") {
  if (!resumeCurrent) return;
  const uploadLabel = getResumeUploadLabel();

  if (!currentResumePath) {
    resumeCurrent.classList.add("hidden");
    resumeCurrent.innerHTML = "";
    if (uploadLabel) uploadLabel.classList.remove("hidden");
    return;
  }

  if (uploadLabel) uploadLabel.classList.add("hidden");
  resumeCurrent.classList.remove("hidden");

  const resumeUrl = await getOwnResumeSignedUrl(currentResumePath);
  const prefix = messagePrefix ? `${escapeHtml(messagePrefix)} ` : "";
  const fileName = getStorageFileName(currentResumePath);

  if (resumeUrl) {
    resumeCurrent.innerHTML = `
      <p class="pf-resume-current__name">${prefix}${escapeHtml(fileName)}</p>
      ${getResumeActionMarkup(fileName, { previewLabel: "preview", source: "self", manage: true })}
    `;
    return;
  }

  resumeCurrent.innerHTML = `<p class="pf-resume-current__name">${escapeHtml(messagePrefix || "current resume on file.")}</p>`;
}

async function uploadResumeFile(file) {
  const fileName = String(file?.name || "").toLowerCase();
  const isPdf = (file?.type === "application/pdf") || fileName.endsWith(".pdf");
  if (!isPdf) throw new Error("resume must be a pdf.");
  if (file.size > 5 * 1024 * 1024) throw new Error("resume must be 5 mb or smaller.");

  const safe = sanitizeFileName(file.name);
  const rpath = `${userId}/${Date.now()}-${safe}`;
  const { error: rErr } = await supabase.storage.from("resumes").upload(rpath, file, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (rErr) throw rErr;

  const previousPath = currentResumePath;
  if (previousPath && previousPath !== rpath) {
    try { await supabase.storage.from("resumes").remove([previousPath]); } catch (_) { /* best-effort */ }
  }

  const { error: prErr } = await supabase
    .from("profiles")
    .update({ resume_path: rpath })
    .eq("id", userId);
  if (prErr) throw prErr;

  currentResumePath = rpath;
  if (resumeInput) resumeInput.value = "";
}

async function removeResume() {
  if (!currentResumePath) return;
  if (!window.confirm("remove your resume? you can upload a new one any time.")) return;

  const removeBtn = resumeCurrent?.querySelector('[data-resume-action="remove"]');
  if (removeBtn instanceof HTMLButtonElement) removeBtn.disabled = true;
  statusEl.textContent = "";
  statusEl.className = "gr-status";

  try {
    const oldPath = currentResumePath;
    try { await supabase.storage.from("resumes").remove([oldPath]); } catch (_) { /* best-effort */ }

    const { error } = await supabase
      .from("profiles")
      .update({ resume_path: null })
      .eq("id", userId);
    if (error) throw error;

    currentResumePath = null;
    if (resumeInput) resumeInput.value = "";
    await renderResumeCurrentLabel();
    statusEl.textContent = "resume removed.";
    statusEl.className = "gr-status success";

    if (role === "consultant" && previewToggle?.checked) {
      await renderBusinessPreview();
    }
  } catch (err) {
    statusEl.textContent = err.message || "could not remove resume.";
    statusEl.className = "gr-status error";
    if (removeBtn instanceof HTMLButtonElement) removeBtn.disabled = false;
  }
}

async function loadPortfolioItems() {
  try {
    const { data, error } = await supabase
      .from("portfolio_items")
      .select("*")
      .eq("user_id", userId)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    portfolioItems = data || [];
  } catch (_) {
    portfolioItems = [];
  }
}

function renderPortfolioList() {
  if (!portfolioList) return;
  if (!portfolioItems.length) {
    portfolioList.innerHTML = '<p class="gr-profile-hint">no work samples uploaded yet.</p>';
    return;
  }
  portfolioList.innerHTML = portfolioItems.map((item) => {
    const fileName = (item.file_path || "").split("/").pop() || "file";
    return `
      <div class="pf-portfolio-item" data-id="${escapeHtml(item.id)}">
        <div class="pf-portfolio-item__info">
          <span class="pf-portfolio-item__name">${escapeHtml(fileName)}</span>
          ${item.description ? `<span class="pf-portfolio-item__desc">${escapeHtml(item.description)}</span>` : ""}
        </div>
        <label class="pf-toggle-label">
          <input type="checkbox" class="pf-portfolio-public-cb" data-id="${escapeHtml(item.id)}" ${item.is_public ? "checked" : ""} />
          <span class="pf-toggle-switch"></span>
          <span>public</span>
        </label>
        <button type="button" class="pf-portfolio-item__delete" data-id="${escapeHtml(item.id)}">remove</button>
      </div>
    `;
  }).join("");

  // Wire toggle handlers
  portfolioList.querySelectorAll(".pf-portfolio-public-cb").forEach((cb) => {
    cb.addEventListener("change", async () => {
      try {
        await supabase.from("portfolio_items").update({ is_public: cb.checked }).eq("id", cb.dataset.id);
        const item = portfolioItems.find((i) => i.id === cb.dataset.id);
        if (item) item.is_public = cb.checked;
      } catch (_) {}
    });
  });

  // Wire delete handlers
  portfolioList.querySelectorAll(".pf-portfolio-item__delete").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const item = portfolioItems.find((i) => i.id === btn.dataset.id);
      if (!item) return;
      try {
        await supabase.storage.from("portfolio").remove([item.file_path]);
        await supabase.from("portfolio_items").delete().eq("id", item.id);
        portfolioItems = portfolioItems.filter((i) => i.id !== item.id);
        renderPortfolioList();
      } catch (err) {
        statusEl.textContent = err.message || "could not delete item.";
        statusEl.className = "gr-status error";
      }
    });
  });
}

async function handlePortfolioUpload() {
  const file = portfolioInput?.files?.[0];
  if (!file) {
    statusEl.textContent = "please choose a file first.";
    statusEl.className = "gr-status error";
    return;
  }
  if (file.size > 25 * 1024 * 1024) {
    statusEl.textContent = "file must be 25 mb or smaller.";
    statusEl.className = "gr-status error";
    return;
  }

  portfolioUploadBtn.disabled = true;
  portfolioUploadBtn.textContent = "uploading…";
  statusEl.textContent = "";
  statusEl.className = "gr-status";

  try {
    const safe = sanitizeFileName(file.name);
    const path = `${userId}/${Date.now()}-${safe}`;
    const { error: upErr } = await supabase.storage.from("portfolio").upload(path, file, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
    if (upErr) throw upErr;

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    let fileType = "document";
    if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) fileType = "image";
    else if (["mp4", "mov", "webm"].includes(ext)) fileType = "video";
    else if (["ppt", "pptx"].includes(ext)) fileType = "presentation";

    const { data: inserted, error: dbErr } = await supabase.from("portfolio_items").insert({
      user_id: userId,
      file_path: path,
      file_type: fileType,
      description: portfolioDesc.value.trim() || null,
      is_public: portfolioPublicToggle?.checked || false,
      sort_order: portfolioItems.length,
    }).select().single();
    if (dbErr) throw dbErr;

    portfolioItems.push(inserted);
    renderPortfolioList();
    portfolioInput.value = "";
    portfolioDesc.value = "";
    if (portfolioPublicToggle) portfolioPublicToggle.checked = false;
    statusEl.textContent = "work sample uploaded.";
    statusEl.className = "gr-status success";
  } catch (err) {
    statusEl.textContent = err.message || "upload failed.";
    statusEl.className = "gr-status error";
  } finally {
    portfolioUploadBtn.disabled = false;
    portfolioUploadBtn.textContent = "upload";
  }
}

/* ================================================================
   Business preview of consultant profile
   ================================================================ */

async function renderBusinessPreview() {
  if (!businessView || !profileRow) return;
  const cp = getRelatedRow(profileRow.consultant_profiles);

  const avatarUrl = currentAvatarPath
    ? supabase.storage.from("avatars").getPublicUrl(currentAvatarPath).data?.publicUrl
    : null;
  const name = profileRow.full_name || "consultant";
  const avatarHtml = avatarUrl
    ? `<img class="pf-bv__avatar" src="${escapeHtml(avatarUrl)}" alt="" />`
    : `<div class="pf-bv__avatar-placeholder" aria-hidden="true">${escapeHtml(getInitials(name))}</div>`;
  const linkedin = profileRow.linkedin_url || "";
  const major = cp?.major || "";
  const minor = cp?.minor || "";
  const school = cp?.school || "";
  const resumePublic = resumePublicToggle
    ? resumePublicToggle.checked
    : Boolean(profileRow.resume_public);
  const hasVisibleResume = resumePublic && currentResumePath;
  const resumeFileName = currentResumePath ? getStorageFileName(currentResumePath) : "";

  let eduLine = "";
  if (major || school) {
    const parts = [];
    if (major) parts.push(major);
    if (minor) parts.push(`minor in ${minor}`);
    if (school) parts.push(school);
    eduLine = parts.join(" · ");
  }

  const publicPortfolio = portfolioItems.filter((i) => i.is_public);

  let portfolioHtml = "";
  if (publicPortfolio.length) {
    portfolioHtml = `
      <div class="pf-bv__section">
        <p class="pf-bv__section-title">past experience</p>
        <div class="pf-bv__portfolio-grid">
          ${publicPortfolio.map((item) => {
            const fileName = (item.file_path || "").split("/").pop() || "file";
            const url = supabase.storage.from("portfolio").getPublicUrl(item.file_path).data?.publicUrl || "#";
            return `
              <div class="pf-bv__portfolio-card">
                <span class="pf-bv__portfolio-card__name">${escapeHtml(fileName)}</span>
                ${item.description ? `<span class="pf-bv__portfolio-card__desc">${escapeHtml(item.description)}</span>` : ""}
                <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">view</a>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  }

  businessView.innerHTML = `
    <div class="pf-bv">
      <div class="pf-bv__header">
        ${avatarHtml}
        <div>
          <h2 class="pf-bv__name">${escapeHtml(name)}</h2>
          ${eduLine ? `<p class="pf-bv__meta">${escapeHtml(eduLine)}</p>` : ""}
        </div>
      </div>

      ${eduLine ? `
        <div class="pf-bv__section">
          <p class="pf-bv__section-title">education</p>
          <p class="pf-bv__detail">${escapeHtml(eduLine)}</p>
        </div>
      ` : ""}

      ${linkedin ? `
        <div class="pf-bv__section">
          <p class="pf-bv__section-title">linkedin</p>
          <p class="pf-bv__detail"><a href="${escapeHtml(linkedin)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkedin)}</a></p>
        </div>
      ` : ""}

      ${hasVisibleResume ? `
        <div class="pf-bv__section">
          <p class="pf-bv__section-title">resume</p>
          <div class="pf-bv__resume-row">
            ${resumeFileName ? `<span class="pf-bv__detail">${escapeHtml(resumeFileName)}</span>` : ""}
            ${getResumeActionMarkup(resumeFileName, { source: "self" })}
          </div>
        </div>
      ` : ""}

      ${portfolioHtml}

      ${!linkedin && !publicPortfolio.length && !hasVisibleResume && !eduLine ? `
        <p class="pf-bv__empty">this consultant hasn't shared any public details yet.</p>
      ` : ""}
    </div>
  `;
}

async function persistResumeVisibilityPreference(nextValue) {
  if (!supabase || !userId || role !== "consultant") return false;

  const previousValue = Boolean(profileRow?.resume_public);
  if (resumePublicToggle) {
    resumePublicToggle.disabled = true;
  }

  try {
    const { error } = await supabase
      .from("profiles")
      .update({ resume_public: nextValue })
      .eq("id", userId);

    if (error) {
      if (isMissingResumePublic(error)) {
        throw new Error(
          "resume visibility settings need the latest Supabase migration before they can be stored."
        );
      }
      throw error;
    }

    if (profileRow) {
      profileRow.resume_public = nextValue;
    }
    statusEl.textContent = nextValue
      ? "resume is now visible to businesses."
      : "resume is now hidden from businesses.";
    statusEl.className = "gr-status success";

    if (previewToggle?.checked) {
      await renderBusinessPreview();
    }
    return true;
  } catch (err) {
    if (resumePublicToggle) {
      resumePublicToggle.checked = previousValue;
    }
    statusEl.textContent = err.message || "could not update resume visibility.";
    statusEl.className = "gr-status error";
    return false;
  } finally {
    if (resumePublicToggle) {
      resumePublicToggle.disabled = false;
    }
  }
}

/* ================================================================
   Profile completion calculation
   ================================================================ */

function computeCompletion(profileRow) {
  const commonFields = ["full_name", "avatar_path"];
  const bizFields = [
    "business_name",
    "business_address",
    "business_details",
    "website_url",
    "instagram_url",
    "facebook_url",
    "company_linkedin_url",
  ];
  const consultantFields = ["linkedin_url", "resume_path"];

  let fields = [...commonFields];
  let biz = null;

  if (profileRow.role === "business_owner") {
    fields = [...fields, ...bizFields];
    const bp = profileRow.business_profiles;
    biz = Array.isArray(bp) ? bp[0] : bp;
  } else if (profileRow.role === "consultant") {
    fields = [...fields, ...consultantFields];
  }

  let filled = 0;
  for (const f of fields) {
    let val;
    if (bizFields.includes(f) && biz) {
      val = biz[f];
    } else {
      val = profileRow[f];
    }
    if (val && (typeof val !== "string" || val.trim() !== "")) {
      if (Array.isArray(val) && val.length === 0) continue;
      filled++;
    }
  }

  return Math.round((filled / fields.length) * 100);
}


/* ================================================================
   Welcome popup
   ================================================================ */

function maybeShowWelcome() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("welcome") === "1" && welcomeOverlay) {
    welcomeOverlay.classList.remove("hidden");
    window.history.replaceState({}, "", "/profile.html");
  }
}

if (welcomeDismiss) {
  welcomeDismiss.addEventListener("click", () => {
    welcomeOverlay.classList.add("hidden");
  });
}

/* ================================================================
   Avatar preview
   ================================================================ */

avatarInput.addEventListener("change", () => {
  const file = avatarInput.files?.[0];
  if (!file) {
    pendingAvatarFile = null;
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    statusEl.textContent = "image must be 2 mb or smaller.";
    statusEl.className = "gr-status error";
    avatarInput.value = "";
    pendingAvatarFile = null;
    return;
  }
  pendingAvatarFile = file;
  statusEl.textContent = "";
  statusEl.className = "gr-status";
  setAvatarPreview(URL.createObjectURL(file));
});

/* ================================================================
   Load profile
   ================================================================ */

let profileRow = null;

async function loadProfile() {
  gateEl.textContent = "loading…";

  const {
    data: { session },
  } = await supabase.auth.getSession();

  if (!session?.user) {
    const next = encodeURIComponent("/profile.html");
    window.location.href = `/signin.html?next=${next}`;
    return;
  }

  userId = session.user.id;
  const emailField = document.getElementById("field-email");
  const phoneField = document.getElementById("field-phone");
  emailField.value = session.user.email || "";
  if (phoneField) phoneField.value = "";

  let row = null;
  let error = null;

  ({
    data: row,
    error,
  } = await supabase
    .from("profiles")
    .select(
      "*, consultant_profiles ( * ), business_profiles ( business_name, business_address, website_url, business_details, social_links, instagram_url, facebook_url, company_linkedin_url )"
    )
    .eq("id", userId)
    .single());

  if (error && isMissingBusinessAddress(error)) {
    businessAddressSupported = false;
    ({
      data: row,
      error,
    } = await supabase
      .from("profiles")
      .select(
        "*, consultant_profiles ( * ), business_profiles ( business_name, website_url, business_details, social_links, instagram_url, facebook_url, company_linkedin_url )"
      )
      .eq("id", userId)
      .single());
  } else {
    businessAddressSupported = true;
  }

  if (error) {
    gateEl.textContent =
      error.message ||
      "could not load your profile. run supabase migrations if this is a new column.";
    gateEl.className = "gr-status error";
    return;
  }

  profileRow = row;
  role = row.role;
  currentAvatarPath = row.avatar_path ?? null;
  currentResumePath = row.resume_path || null;
  syncProfileTabsForRole(role);

  document.getElementById("field-full-name").value = row.full_name || "";
  if (phoneField) phoneField.value = row.phone_number || "";
  document.getElementById("field-linkedin").value = row.linkedin_url || "";

  if (currentAvatarPath) {
    const { data: pub } = supabase.storage.from("avatars").getPublicUrl(currentAvatarPath);
    setAvatarPreview(pub.publicUrl);
  } else {
    setAvatarPreview(null);
  }

  if (role === "business_owner") {
    const bp = row.business_profiles;
    const b = Array.isArray(bp) ? bp[0] : bp;
    if (b) {
      document.getElementById("field-biz-name").value = b.business_name || "";
      document.getElementById("field-biz-address").value = b.business_address || "";
      document.getElementById("field-website").value = b.website_url || "";
      applyBizSocialFromRow(b);
      document.getElementById("field-biz-details").value = b.business_details || "";
      const rawIg = (b.instagram_url || "").trim();
      loadedInstagramUrl = rawIg ? normalizeBusinessInstagramUrl(rawIg) || rawIg : null;
    } else {
      document.getElementById("field-biz-address").value = "";
      applyBizSocialFromRow(null);
      loadedInstagramUrl = null;
    }
    await renderOwnerListingSidebar();

    if (!businessAddressSupported) {
      statusEl.textContent =
        "business address is in the UI, but your database still needs `supabase/migrations/add_business_address.sql` before that field can load or save.";
      statusEl.className = "gr-status";
    }
  } else {
    loadedInstagramUrl = null;
  }

  if (role === "consultant") {
    await renderResumeCurrentLabel("current resume on file —");

    // Education fields
    const cp = getRelatedRow(row.consultant_profiles);
    const majorField = document.getElementById("field-major");
    const minorField = document.getElementById("field-minor");
    const schoolField = document.getElementById("field-school");
    if (majorField) majorField.value = cp?.major || "";
    if (minorField) minorField.value = cp?.minor || "";
    if (schoolField) schoolField.value = cp?.school || "";

    // Resume public toggle
    if (resumePublicToggle) resumePublicToggle.checked = row.resume_public || false;

    // Portfolio
    await loadPortfolioItems();
    renderPortfolioList();

    // Preview bar
    if (previewBar) previewBar.classList.remove("hidden");

    const consultantStats = await loadConsultantProgressStats(row);
    renderConsultantLevelSidebar(row, consultantStats);
  }

  gateEl.textContent = "";
  form.classList.remove("hidden");

  maybeShowWelcome();
}

/* ================================================================
   Save form
   ================================================================ */

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const manualAvatarThisSave = Boolean(pendingAvatarFile);
  statusEl.textContent = "";
  statusEl.className = "gr-status";
  saveBtn.disabled = true;
  saveBtn.textContent = "saving…";

  try {
    let avatarPath = currentAvatarPath;
    let instagramAvatarApplied = false;
    const hadAvatarAtSubmitStart = Boolean(currentAvatarPath);

    if (pendingAvatarFile) {
      const safe = sanitizeFileName(pendingAvatarFile.name);
      const path = `${userId}/${Date.now()}-${safe}`;
      const { error: upErr } = await supabase.storage.from("avatars").upload(path, pendingAvatarFile, {
        contentType: pendingAvatarFile.type || "image/jpeg",
        upsert: false,
      });
      if (upErr) throw upErr;
      if (currentAvatarPath && currentAvatarPath !== path) {
        await supabase.storage.from("avatars").remove([currentAvatarPath]);
      }
      avatarPath = path;
    }

    const fullName = document.getElementById("field-full-name").value.trim();
    const linkedinUrl =
      role === "consultant" ? document.getElementById("field-linkedin").value.trim() : "";

    const profileUpdate = {
      full_name: fullName,
    };
    if (role === "consultant") {
      profileUpdate.linkedin_url = linkedinUrl || null;
    }
    if (role === "consultant") {
      profileUpdate.resume_public = resumePublicToggle?.checked || false;
    }
    if (avatarPath !== currentAvatarPath) {
      profileUpdate.avatar_path = avatarPath;
    }

    let profileAvatarMigrationWarning = false;
    let resumePublicMissingWarning = false;
    let businessAddressMissingWarning = false;
    let res = await supabase.from("profiles").update(profileUpdate).eq("id", userId);
    let pErr = res.error;

    if (pErr && isMissingResumePublic(pErr) && "resume_public" in profileUpdate) {
      const { resume_public: _dropResumePublic, ...rest } = profileUpdate;
      res = await supabase.from("profiles").update(rest).eq("id", userId);
      pErr = res.error;
      if (!pErr) {
        resumePublicMissingWarning = true;
      }
    }

    if (
      pErr &&
      /avatar_path|schema cache/i.test(pErr.message || "") &&
      profileUpdate.avatar_path != null
    ) {
      const { avatar_path: _drop, ...rest } = profileUpdate;
      res = await supabase.from("profiles").update(rest).eq("id", userId);
      pErr = res.error;
      if (!pErr) {
        profileAvatarMigrationWarning = true;
        if (avatarPath !== currentAvatarPath) {
          await supabase.storage.from("avatars").remove([avatarPath]);
        }
        statusEl.textContent =
          "saved your details. to store a profile photo, add column profiles.avatar_path in Supabase (run supabase/profile_avatar.sql), then upload again.";
        statusEl.className = "gr-status error";
      }
    }
    if (pErr) throw pErr;

    await supabase.auth.updateUser({
      data: { full_name: fullName },
    });

    if (role === "business_owner") {
      const igOn = document.getElementById("biz-social-instagram-on")?.checked;
      const fbOn = document.getElementById("biz-social-facebook-on")?.checked;
      const liOn = document.getElementById("biz-social-linkedin-on")?.checked;
      const igRaw = igOn ? document.getElementById("field-biz-instagram").value.trim() || null : null;
      const instagramUrl = igRaw ? normalizeBusinessInstagramUrl(igRaw) || igRaw : null;
      const facebookUrl = fbOn
        ? document.getElementById("field-biz-facebook").value.trim() || null
        : null;
      const companyLinkedinUrl = liOn
        ? document.getElementById("field-biz-company-linkedin").value.trim() || null
        : null;
      const socialLinks = buildBizSocialLinksArray(instagramUrl, facebookUrl, companyLinkedinUrl);
      const previousInstagramUrl = loadedInstagramUrl;

      const businessProfileUpdate = {
        business_name: document.getElementById("field-biz-name").value.trim() || null,
        business_address: document.getElementById("field-biz-address").value.trim() || null,
        website_url: document.getElementById("field-website").value.trim() || null,
        instagram_url: instagramUrl,
        facebook_url: facebookUrl,
        company_linkedin_url: companyLinkedinUrl,
        social_links: socialLinks,
        business_details: document.getElementById("field-biz-details").value.trim() || null,
      };

      let { error: bErr } = await supabase
        .from("business_profiles")
        .update(businessProfileUpdate)
        .eq("user_id", userId);

      if (bErr && isMissingBusinessAddress(bErr)) {
        businessAddressSupported = false;
        businessAddressMissingWarning = true;
        const { business_address: _dropBusinessAddress, ...fallbackBusinessProfileUpdate } =
          businessProfileUpdate;
        ({ error: bErr } = await supabase
          .from("business_profiles")
          .update(fallbackBusinessProfileUpdate)
          .eq("user_id", userId));
      } else if (!bErr) {
        businessAddressSupported = true;
      }

      if (bErr) throw bErr;

      if (instagramUrl && igRaw && instagramUrl !== igRaw) {
        const igInput = document.getElementById("field-biz-instagram");
        if (igInput) igInput.value = instagramUrl;
      }

      loadedInstagramUrl = instagramUrl || null;

      const prevNorm = previousInstagramUrl
        ? normalizeBusinessInstagramUrl(previousInstagramUrl) || previousInstagramUrl
        : "";
      const igUrlChanged = (instagramUrl || "") !== prevNorm;
      const shouldTryInstagramAvatar =
        !profileAvatarMigrationWarning &&
        instagramUrl &&
        !manualAvatarThisSave &&
        (igUrlChanged || !hadAvatarAtSubmitStart);

      if (shouldTryInstagramAvatar) {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        const accessToken = session?.access_token;
        if (accessToken) {
          const ir = await fetch("/api/profile/instagram-avatar", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${accessToken}`,
            },
            body: JSON.stringify({ instagramUrl }),
          });
          const payload = await ir.json().catch(() => ({}));
          if (payload?.ok && payload.avatarPath) {
            currentAvatarPath = payload.avatarPath;
            if (payload.publicUrl) setAvatarPreview(payload.publicUrl);
            instagramAvatarApplied = true;
          }
        }
      }
    }

    if (role === "consultant") {
      const majorVal = document.getElementById("field-major")?.value.trim() || null;
      const minorVal = document.getElementById("field-minor")?.value.trim() || null;
      const schoolVal = document.getElementById("field-school")?.value.trim() || null;
      try {
        await supabase.from("consultant_profiles").update({
          major: majorVal,
          minor: minorVal,
          school: schoolVal,
        }).eq("user_id", userId);
      } catch (_) { /* columns may not exist yet */ }
    }

    if (role === "consultant" && resumeInput.files?.[0]) {
      await uploadResumeFile(resumeInput.files[0]);
      await renderResumeCurrentLabel("current resume on file —");
    }

    if (!profileAvatarMigrationWarning) {
      if (!instagramAvatarApplied) {
        currentAvatarPath = avatarPath;
      }
    }
    pendingAvatarFile = null;
    avatarInput.value = "";

    if (!profileAvatarMigrationWarning) {
      if (resumePublicMissingWarning) {
        statusEl.textContent =
          "saved. resume visibility settings need the latest Supabase migration before they can be stored.";
        statusEl.className = "gr-status";
      } else if (businessAddressMissingWarning) {
        statusEl.textContent =
          "saved, but business address could not be stored yet. run `supabase/migrations/add_business_address.sql` in Supabase, then save again.";
        statusEl.className = "gr-status";
      } else {
        statusEl.textContent = instagramAvatarApplied
          ? "saved. profile photo updated from instagram."
          : "saved.";
        statusEl.className = "gr-status success";
      }
    }

    /* Recompute completion after save */
    const freshRow = {
      ...profileRow,
      full_name: fullName,
      linkedin_url: role === "consultant" ? linkedinUrl || null : profileRow?.linkedin_url || null,
      avatar_path: currentAvatarPath,
      resume_path: currentResumePath,
      resume_public: resumePublicToggle?.checked || false,
    };
    if (role === "business_owner") {
      const igOn = document.getElementById("biz-social-instagram-on")?.checked;
      const fbOn = document.getElementById("biz-social-facebook-on")?.checked;
      const liOn = document.getElementById("biz-social-linkedin-on")?.checked;
      const igRawFresh = igOn ? document.getElementById("field-biz-instagram").value.trim() || null : null;
      const instagramUrl = igRawFresh ? normalizeBusinessInstagramUrl(igRawFresh) || igRawFresh : null;
      const facebookUrl = fbOn
        ? document.getElementById("field-biz-facebook").value.trim() || null
        : null;
      const companyLinkedinUrl = liOn
        ? document.getElementById("field-biz-company-linkedin").value.trim() || null
        : null;
      freshRow.business_profiles = {
        business_name: document.getElementById("field-biz-name").value.trim() || null,
        business_address:
          businessAddressMissingWarning || !businessAddressSupported
            ? null
            : document.getElementById("field-biz-address").value.trim() || null,
        website_url: document.getElementById("field-website").value.trim() || null,
        instagram_url: instagramUrl,
        facebook_url: facebookUrl,
        company_linkedin_url: companyLinkedinUrl,
        social_links: buildBizSocialLinksArray(instagramUrl, facebookUrl, companyLinkedinUrl),
        business_details: document.getElementById("field-biz-details").value.trim() || null,
      };
    }
    profileRow = freshRow;
    if (role === "consultant") {
      const consultantStats = await loadConsultantProgressStats(freshRow);
      renderConsultantLevelSidebar(freshRow, consultantStats);
      if (previewToggle?.checked) {
        await renderBusinessPreview();
      }
    } else {
      await renderOwnerListingSidebar();
    }
  } catch (err) {
    statusEl.textContent = err.message || "save failed.";
    statusEl.className = "gr-status error";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "save changes";
  }
});

/* ================================================================
   Boot
   ================================================================ */

/* ================================================================
   Preview toggle
   ================================================================ */

if (previewToggle) {
  previewToggle.addEventListener("change", async () => {
    if (previewToggle.checked) {
      await renderBusinessPreview();
      businessView.classList.remove("hidden");
      form.classList.add("hidden");
    } else {
      businessView.classList.add("hidden");
      form.classList.remove("hidden");
    }
  });
}

if (resumePublicToggle) {
  resumePublicToggle.addEventListener("change", async () => {
    await persistResumeVisibilityPreference(resumePublicToggle.checked);
  });
}

if (resumeInput) {
  resumeInput.addEventListener("change", async () => {
    const file = resumeInput.files?.[0];
    if (!file) return;
    if (!currentResumePath) return;

    statusEl.textContent = "uploading resume…";
    statusEl.className = "gr-status";
    try {
      await uploadResumeFile(file);
      await renderResumeCurrentLabel("current resume on file —");
      statusEl.textContent = "resume replaced.";
      statusEl.className = "gr-status success";
      if (role === "consultant" && previewToggle?.checked) {
        await renderBusinessPreview();
      }
    } catch (err) {
      resumeInput.value = "";
      statusEl.textContent = err.message || "could not upload resume.";
      statusEl.className = "gr-status error";
    }
  });
}

document.addEventListener("click", async (event) => {
  const resumeAction = event.target.closest("[data-resume-action]");
  if (resumeAction instanceof HTMLElement) {
    event.preventDefault();
    const action = resumeAction.getAttribute("data-resume-action") || "preview";

    if (action === "replace") {
      if (resumeInput) resumeInput.click();
      return;
    }
    if (action === "remove") {
      await removeResume();
      return;
    }

    const source = resumeAction.getAttribute("data-resume-source") || "self";
    const fileName = resumeAction.getAttribute("data-resume-file-name") || "resume";
    if (source === "self" && currentResumePath) {
      const resumeUrl = await getOwnResumeSignedUrl(currentResumePath);
      if (!resumeUrl) return;
      if (action === "download") {
        triggerResumeDownload(resumeUrl, fileName);
      } else {
        openResumeViewer(resumeUrl, fileName);
      }
    }
    return;
  }

  const closeTrigger = event.target.closest("[data-resume-viewer-close]");
  if (closeTrigger instanceof HTMLElement) {
    event.preventDefault();
    closeResumeViewer();
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && resumeViewer && !resumeViewer.classList.contains("hidden")) {
    closeResumeViewer();
  }
});

/* ================================================================
   Portfolio upload wiring
   ================================================================ */

if (portfolioUploadBtn) {
  portfolioUploadBtn.addEventListener("click", (e) => {
    e.preventDefault();
    handlePortfolioUpload();
  });
}

/* ================================================================
   Boot
   ================================================================ */

async function boot() {
  try {
    wireBizSocialToggles();
    wireInstagramFieldAutoCheck();
    supabase = await getSupabaseClient();
    await loadProfile();
  } catch (err) {
    gateEl.textContent = err.message || "could not connect.";
    gateEl.className = "gr-status error";
  }
}

boot();
