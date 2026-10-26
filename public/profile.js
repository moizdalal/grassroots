import { getSupabaseClient } from "/supabase-loader.js";
import { formatBudgetRange, parseBudgetRange } from "/sim-budget.js";
import { getInitials } from "/initials.js";
import { renderRatingMarkup } from "/rating.js";
import { showSuccess, showError, showLoading } from "/toast.js";
import { cropToSquare } from "/avatar-cropper.js";

const form = document.getElementById("profile-form");
const gateEl = document.getElementById("profile-gate");
const statusEl = document.getElementById("status");
const avatarPreview = document.getElementById("avatar-preview");
const avatarInput = document.getElementById("avatar-input");
const avatarStatusEl = document.getElementById("avatar-status");

const AVATAR_MAX_BYTES = 5 * 1024 * 1024;
// Matches the portfolio bucket's file_size_limit (supabase/migrations/rls_lockdown.sql).
const PORTFOLIO_MAX_BYTES = 50 * 1024 * 1024;
// The bucket rejects types a browser would render as a page.
const PORTFOLIO_BLOCKED_EXT = /\.(html?|xhtml|svgz?|js|mjs|xml)$/i;
const AVATAR_ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Avatar upload/remove feedback now routes through the app-wide toast
// stack instead of an inline `.pf-avatar-status` line. The inline
// element still exists in the DOM (collapsed via `:empty { display:
// none }`) so this function clears its content on every call to keep
// it out of the layout. A pending "uploading…" loading toast is held
// in `activeAvatarLoadingToast` so the next setAvatarStatus call can
// dismiss it before showing the resolved success/error toast.
let activeAvatarLoadingToast = null;
function setAvatarStatus(text, kind) {
  if (avatarStatusEl) {
    avatarStatusEl.textContent = "";
    avatarStatusEl.className = "gr-status pf-avatar-status";
  }
  if (activeAvatarLoadingToast) {
    activeAvatarLoadingToast.dismiss();
    activeAvatarLoadingToast = null;
  }
  if (!text) return;
  if (kind === "success") {
    showSuccess(text);
  } else if (kind === "error") {
    showError(text);
  } else {
    // No kind passed → in-flight loading state (e.g. "uploading photo…").
    // Persistent toast; dismissed automatically when the next
    // setAvatarStatus call resolves.
    activeAvatarLoadingToast = showLoading(text);
  }
}

function validateAvatarFile(file) {
  if (!file) return "No file selected.";
  if (file.size > AVATAR_MAX_BYTES) return "Image must be 5 MB or smaller.";
  const ext = String(file.name || "").toLowerCase().split(".").pop();
  const extOk = ["jpg", "jpeg", "png", "webp", "gif"].includes(ext);
  if (!AVATAR_ACCEPTED_TYPES.has(file.type) && !extOk) return "Use a JPG, PNG, WebP, or GIF image.";
  return null;
}
const resumeInput = document.getElementById("resume-input");
const resumeCurrent = document.getElementById("resume-current");
const resumePublicToggle = document.getElementById("resume-public-toggle");
const businessSection = document.getElementById("business-section");
const businessSocialSection = document.getElementById("business-social-section");
const consultantSection = document.getElementById("consultant-section");
const consultantPortfolioSection = document.getElementById("consultant-portfolio-section");
const consultantEducationSection = document.getElementById("consultant-education-section");
const profileTabButtons = [...document.querySelectorAll("[data-profile-tab]")];
const profilePanels = [...document.querySelectorAll("[data-profile-panel]")];
const portfolioList = document.getElementById("portfolio-list");
const portfolioInput = document.getElementById("portfolio-input");
const portfolioDesc = document.getElementById("portfolio-desc");
const portfolioPublicToggle = document.getElementById("portfolio-public-toggle");
const portfolioUploadBtn = document.getElementById("portfolio-upload-btn");
const previewBar = document.getElementById("pf-preview-bar");
const previewTrigger = document.getElementById("pf-preview-trigger");
const previewModal = document.getElementById("pf-preview-modal");
const businessView = document.getElementById("pf-business-view");

function isPreviewOpen() {
  return !!previewModal && !previewModal.classList.contains("hidden");
}
const resumeViewer = document.getElementById("pf-resume-viewer");
const resumeViewerFrame = document.getElementById("pf-resume-viewer-frame");
const resumeViewerTitle = document.getElementById("pf-resume-viewer-title");
const resumeViewerDownload = document.getElementById("pf-resume-viewer-download");
const saveBtn = document.getElementById("save-btn");
const linkedinFieldWrap = document.getElementById("field-linkedin-wrap");
const ownerCard = document.getElementById("pf-owner-card");
const ownerCurrentList = document.getElementById("pf-owner-current-list");
const ownerPastList = document.getElementById("pf-owner-past-list");
const ownerHistoryToggle = document.getElementById("pf-owner-history-toggle");
const ownerHistory = document.getElementById("pf-owner-history");

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

  if (businessSocialSection) {
    businessSocialSection.classList.toggle("hidden", currentRole !== "business_owner");
  }

  if (linkedinFieldWrap) {
    linkedinFieldWrap.classList.toggle("hidden", currentRole === "business_owner");
  }
  // City field is consultant-only — biz owners have a business address instead.
  const cityFieldWrap = document.getElementById("field-city-wrap");
  if (cityFieldWrap) {
    cityFieldWrap.classList.toggle("hidden", currentRole === "business_owner");
  }

  if (consultantSection) {
    consultantSection.classList.toggle("hidden", currentRole !== "consultant");
  }

  if (consultantPortfolioSection) {
    consultantPortfolioSection.classList.toggle("hidden", currentRole !== "consultant");
  }

  if (consultantEducationSection) {
    consultantEducationSection.classList.toggle("hidden", currentRole !== "consultant");
  }

  setActiveProfileTab("personal");
}

function renderOwnerSidebar() {
  if (!ownerCard) return;
  ownerCard.classList.remove("hidden");
}

profileTabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveProfileTab(button.dataset.profileTab || "personal");
  });
});

function formatOwnerListingState(listing, acceptedBid) {
  const rawStatus = String(listing?.status || "").toLowerCase();
  if (rawStatus === "completed") return "completed";
  if (rawStatus === "unlisted") return "unlisted";
  if (acceptedBid) return "accepted";
  if (rawStatus === "locked") return "locked";
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
            ? `Accepted for ${escapeHtml(item.acceptedDisplay)}`
            : "accepted amount not available"
          : escapeHtml(item.budgetDisplay || "Budget not available");

      return `
        <a class="pf-owner-item" href="/listing.html?id=${escapeAttr(item.id)}">
          <div class="pf-owner-item__head">
            <span class="pf-owner-item__title">${escapeHtml(item.title || "Untitled listing")}</span>
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
      current: mapped.filter((item) => item.state !== "completed" && item.state !== "unlisted"),
      past: mapped.filter((item) => item.state === "completed" || item.state === "unlisted"),
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
  renderOwnerListingItems(ownerCurrentList, current, "No current listings yet.", "current");
  renderOwnerListingItems(ownerPastList, past, "No past listings yet.", "past");

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
    avatarPreview.alt = "Profile photo";
  } else {
    avatarPreview.src = PLACEHOLDER;
    avatarPreview.alt = "";
  }
}

function renderAvatarState() {
  const uploadLabel = document.getElementById("pf-avatar-upload-label");
  const actions = document.getElementById("pf-avatar-actions");
  if (!uploadLabel || !actions) return;
  if (currentAvatarPath) {
    uploadLabel.classList.add("hidden");
    actions.classList.remove("hidden");
  } else {
    uploadLabel.classList.remove("hidden");
    actions.classList.add("hidden");
  }
}

async function uploadAvatarFile(file) {
  if (!supabase || !userId) throw new Error("Not signed in.");
  if (file.size > AVATAR_MAX_BYTES) throw new Error("Image must be 5 MB or smaller.");

  const safe = sanitizeFileName(file.name);
  const path = `${userId}/${Date.now()}-${safe}`;
  const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (upErr) throw upErr;

  const previousPath = currentAvatarPath;

  const { error: prErr } = await supabase
    .from("profiles")
    .update({ avatar_path: path })
    .eq("id", userId);
  if (prErr) {
    // Best-effort cleanup of the just-uploaded file if the DB update failed.
    try { await supabase.storage.from("avatars").remove([path]); } catch (_) {}
    throw prErr;
  }

  if (previousPath && previousPath !== path) {
    try { await supabase.storage.from("avatars").remove([previousPath]); } catch (_) {}
  }

  currentAvatarPath = path;
  if (profileRow) profileRow.avatar_path = path;
  if (avatarInput) avatarInput.value = "";

  const { data: pub } = supabase.storage.from("avatars").getPublicUrl(path);
  setAvatarPreview(pub?.publicUrl || PLACEHOLDER);
  renderAvatarState();
}

async function removeAvatarFile() {
  if (!currentAvatarPath) return;
  if (!window.confirm("Remove your profile photo? You can upload a new one any time.")) return;

  const removeBtn = document.getElementById("pf-avatar-remove-btn");
  if (removeBtn instanceof HTMLButtonElement) removeBtn.disabled = true;
  setAvatarStatus("");

  try {
    const oldPath = currentAvatarPath;
    try { await supabase.storage.from("avatars").remove([oldPath]); } catch (_) {}

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_path: null })
      .eq("id", userId);
    if (error) throw error;

    currentAvatarPath = null;
    if (profileRow) profileRow.avatar_path = null;
    if (avatarInput) avatarInput.value = "";
    setAvatarPreview(null);
    renderAvatarState();
    setAvatarStatus("Profile photo removed.", "success");
  } catch (err) {
    setAvatarStatus(err.message || "Could not remove photo.", "error");
  } finally {
    if (removeBtn instanceof HTMLButtonElement) removeBtn.disabled = false;
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
    previewLabel = "Preview resume",
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
      >Replace</button>
      <button
        type="button"
        class="pf-bv__resume-btn pf-bv__resume-btn--danger"
        data-resume-action="remove"
      >Remove</button>
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
        aria-label="Download resume"
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

function getDownloadIconSvg() {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v10"></path><path d="m8 10 4 4 4-4"></path><path d="M5 19h14"></path></svg>`;
}

async function renderResumeCurrentLabel(/* legacy arg ignored */) {
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

  const fileName = getStorageFileName(currentResumePath);
  const isPublic = resumeIsPublicState();

  resumeCurrent.innerHTML = `
    <div class="pf-portfolio-item__info">
      <div class="pf-portfolio-item__name-row">
        <button type="button" class="pf-portfolio-item__name pf-portfolio-item__name--clickable" data-resume-action="preview" data-resume-source="self" data-resume-file-name="${escapeAttr(fileName)}">${escapeHtml(fileName)}</button>
        <button type="button" class="pf-portfolio-item__download" data-resume-action="download" data-resume-source="self" data-resume-file-name="${escapeAttr(fileName)}" aria-label="Download resume">
          ${getDownloadIconSvg()}
        </button>
      </div>
    </div>
    <label class="pf-toggle-label">
      <input type="checkbox" id="resume-public-toggle" ${isPublic ? "checked" : ""} />
      <span class="pf-toggle-switch"></span>
      <span>Visible to businesses you've contacted</span>
    </label>
    <button type="button" class="pf-portfolio-item__delete" data-resume-action="remove">Remove</button>
  `;
}

function resumeIsPublicState() {
  // Read from the current toggle if it exists, otherwise from the loaded
  // profileRow snapshot. This survives re-renders without losing state.
  const cur = document.getElementById("resume-public-toggle");
  if (cur) return cur.checked;
  return Boolean(profileRow?.resume_public);
}

async function uploadResumeFile(file) {
  const fileName = String(file?.name || "").toLowerCase();
  const isPdf = (file?.type === "application/pdf") || fileName.endsWith(".pdf");
  if (!isPdf) throw new Error("Resume must be a PDF.");
  if (file.size > 5 * 1024 * 1024) throw new Error("Resume must be 5 MB or smaller.");

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
  if (!window.confirm("Remove your resume? You can upload a new one any time.")) return;

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
    showSuccess("Resume removed.");

    if (role === "consultant" && isPreviewOpen()) {
      await renderBusinessPreview();
    }
  } catch (err) {
    showError(err.message || "Could not remove resume.");
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
    portfolioList.innerHTML = '<p class="gr-profile-hint">No work samples uploaded yet.</p>';
    return;
  }
  portfolioList.innerHTML = portfolioItems.map((item) => {
    const fileName = (item.file_path || "").split("/").pop() || "file";
    const id = escapeAttr(item.id);
    const safeName = escapeHtml(fileName);
    return `
      <div class="pf-portfolio-item" data-id="${id}">
        <div class="pf-portfolio-item__info">
          <div class="pf-portfolio-item__name-row">
            <button type="button" class="pf-portfolio-item__name pf-portfolio-item__name--clickable" data-portfolio-action="preview" data-id="${id}" data-file-name="${escapeAttr(fileName)}">${safeName}</button>
            <button type="button" class="pf-portfolio-item__download" data-portfolio-action="download" data-id="${id}" data-file-name="${escapeAttr(fileName)}" aria-label="Download work sample">
              ${getDownloadIconSvg()}
            </button>
          </div>
          ${item.description ? `<span class="pf-portfolio-item__desc">${escapeHtml(item.description)}</span>` : ""}
        </div>
        <label class="pf-toggle-label">
          <input type="checkbox" class="pf-portfolio-public-cb" data-id="${id}" ${item.is_public ? "checked" : ""} />
          <span class="pf-toggle-switch"></span>
          <span>Visible to businesses you've contacted</span>
        </label>
        <button type="button" class="pf-portfolio-item__delete" data-id="${id}">Remove</button>
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
        showError(err.message || "Could not delete item.");
      }
    });
  });
}

async function getPortfolioSignedUrl(filePath) {
  if (!supabase || !filePath) return null;
  try {
    const { data, error } = await supabase.storage
      .from("portfolio")
      .createSignedUrl(filePath, 60 * 30);
    if (error) throw error;
    return data?.signedUrl || null;
  } catch (_) {
    return null;
  }
}

async function handlePortfolioUpload() {
  const file = portfolioInput?.files?.[0];
  if (!file) {
    showError("Please choose a file first.");
    return;
  }
  if (file.size > PORTFOLIO_MAX_BYTES) {
    const isDeck = /\.(pptx?|key)$/i.test(file.name);
    showError(
      isDeck
        ? "This deck is over 50 MB. Export it as a PDF (File → Export → PDF) and upload that."
        : "File must be 50 MB or smaller."
    );
    return;
  }
  if (PORTFOLIO_BLOCKED_EXT.test(file.name)) {
    showError("Web pages, SVGs and scripts can't be uploaded. Try a PDF or image instead.");
    return;
  }

  portfolioUploadBtn.disabled = true;
  portfolioUploadBtn.textContent = "Uploading…";

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
    showSuccess("Work sample uploaded.");
  } catch (err) {
    showError(err.message || "Upload failed.");
  } finally {
    portfolioUploadBtn.disabled = false;
    portfolioUploadBtn.textContent = "Upload";
  }
}

/* ================================================================
   Business preview of consultant profile
   ================================================================ */

async function renderBusinessPreview() {
  if (!businessView || !profileRow) return;

  // Mirror the canonical consultant viewer modal that businesses see
  // when they click a bid on their listing (see renderConsultantViewerContent
  // + renderConsultantPastWorkPanel + loadResumePanel in listing.js). The
  // settings preview should look identical: same title bar, same three
  // tabs (bio / resume / past work), same panel content. Drop the
  // proposal index + offer chrome from the bar — those are listing-flow
  // artifacts and don't apply when the consultant is previewing themselves.

  businessView.classList.add("pf-business-view--tabbed");

  const cp = getRelatedRow(profileRow.consultant_profiles);
  const avatarUrl = currentAvatarPath
    ? supabase.storage.from("avatars").getPublicUrl(currentAvatarPath).data?.publicUrl
    : null;
  const name = profileRow.full_name || "consultant";
  const linkedin = profileRow.linkedin_url || "";
  const major = cp?.major || "";
  const minor = cp?.minor || "";
  const school = cp?.school || "";
  const eduParts = [];
  if (major) eduParts.push(major);
  if (minor) eduParts.push(`Minor in ${minor}`);
  if (school) eduParts.push(school);
  const eduLine = eduParts.join(" · ");

  // Pull rating aggregates from the same endpoint /my-reviews + the
  // canonical viewer use, so the bio header chip + per-dim breakdown
  // match exactly. Best-effort — preview still renders if it 4xxs.
  let rating = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const headers = {};
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
    const res = await fetch(`/api/consultant-profile/${encodeURIComponent(userId)}`, { headers });
    if (res.ok) {
      const json = await res.json().catch(() => ({}));
      rating = json?.rating || null;
    }
  } catch (_) { /* best-effort */ }

  const avatarHtml = avatarUrl
    ? `<img class="pf-bv__avatar" src="${escapeHtml(avatarUrl)}" alt="" />`
    : `<div class="pf-bv__avatar-placeholder" aria-hidden="true">${escapeHtml(getInitials(name))}</div>`;

  const dims = [
    ["Work product", rating?.work_product_quality_avg],
    ["communication", rating?.communication_avg],
    ["timeliness", rating?.timeliness_avg],
    ["professionalism", rating?.professionalism_avg],
    ["Cost value", rating?.cost_value_avg],
  ];
  const ratingBreakdown = rating?.review_count
    ? `
      <div class="pf-bv__section">
        <p class="pf-bv__section-title">Ratings · ${rating.review_count} review${rating.review_count === 1 ? "" : "s"}</p>
        <div class="ld-cv__rating-grid">
          ${dims.map(([label, val]) => `
            <div class="ld-cv__rating-row">
              <span class="ld-cv__rating-row__label">${label}</span>
              ${renderRatingMarkup({ rating_average: val, review_count: 1 }, { size: "sm", showCount: false })}
            </div>
          `).join("")}
        </div>
      </div>
    `
    : "";

  const bioPanel = `
    <div class="pf-bv">
      <div class="pf-bv__header">
        ${avatarHtml}
        <div>
          <h2 class="pf-bv__name">${escapeHtml(name)}</h2>
          ${eduLine ? `<p class="pf-bv__meta">${escapeHtml(eduLine)}</p>` : ""}
        </div>
      </div>
      ${ratingBreakdown}
      ${eduLine ? `
        <div class="pf-bv__section">
          <p class="pf-bv__section-title">Education</p>
          <p class="pf-bv__detail">${escapeHtml(eduLine)}</p>
        </div>
      ` : ""}
      ${linkedin ? `
        <div class="pf-bv__section">
          <p class="pf-bv__section-title">LinkedIn</p>
          <p class="pf-bv__detail"><a href="${escapeHtml(linkedin)}" target="_blank" rel="noopener noreferrer">${escapeHtml(linkedin)}</a></p>
        </div>
      ` : ""}
      ${(!linkedin && !eduLine && !ratingBreakdown) ? `
        <p class="pf-bv__empty">This consultant hasn't shared any public bio details yet.</p>
      ` : ""}
    </div>
  `;

  const resumePublicEl = getResumePublicToggle();
  const resumePublic = resumePublicEl ? resumePublicEl.checked : Boolean(profileRow.resume_public);
  const hasVisibleResume = resumePublic && currentResumePath;
  let resumePanelHtml;
  if (hasVisibleResume) {
    const resumeFileName = getStorageFileName(currentResumePath);
    resumePanelHtml = `
      <div class="pf-bv__section">
        <p class="pf-bv__section-title">Resume</p>
        <div class="pf-bv__resume-row">
          ${resumeFileName ? `<span class="pf-bv__detail">${escapeHtml(resumeFileName)}</span>` : ""}
          ${getResumeActionMarkup(resumeFileName, { source: "self" })}
        </div>
      </div>
    `;
  } else {
    const reason = currentResumePath
      ? "Your resume is uploaded but kept private. Flip 'visible to businesses' to share it."
      : "This consultant has not made a resume publicly visible.";
    resumePanelHtml = `<p class="ld-cv__panel-empty">${reason}</p>`;
  }

  const publicPortfolio = portfolioItems.filter((i) => i.is_public);
  let workPanelHtml;
  if (publicPortfolio.length) {
    workPanelHtml = `
      <div class="ld-cv__work-section">
        <p class="ld-cv__work-section-title">Shared files</p>
        <div class="ld-cv__work-list">
          ${publicPortfolio.map((item) => {
            const fileName = (item.file_path || "").split("/").pop() || "file";
            const url = supabase.storage.from("portfolio").getPublicUrl(item.file_path).data?.publicUrl || "#";
            return `
              <div class="ld-cv__work-row">
                <div>
                  <p class="ld-cv__work-row__title">${escapeHtml(fileName)}</p>
                  ${item.description ? `<p class="ld-cv__work-row__scope">${escapeHtml(item.description)}</p>` : ""}
                  <a class="ld-cv__work-row__file" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Open file ↗</a>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `;
  } else {
    workPanelHtml = `<p class="ld-cv__panel-empty">No past engagements or shared files yet.</p>`;
  }

  const titleHtml = `${escapeHtml(name)} ${renderRatingMarkup(rating, { size: "md" })}`;

  businessView.innerHTML = `
    <div class="ld-cv__inner">
      <div class="ld-cv__bar">
        <div class="ld-cv__bar-meta">
          <p class="ld-cv__eyebrow">Preview as business</p>
          <h2 class="ld-cv__title" id="pf-preview-modal-title">${titleHtml}</h2>
        </div>
        <button type="button" class="ld-cv__close" data-pf-preview-close aria-label="Close preview">&times;</button>
      </div>
      <div class="ld-cv__tabs" role="tablist" aria-label="Profile preview sections">
        <button type="button" class="ld-cv__tab is-active" role="tab" data-pf-bv-tab="bio" aria-selected="true">Bio</button>
        <button type="button" class="ld-cv__tab" role="tab" data-pf-bv-tab="resume" aria-selected="false">Resume</button>
        <button type="button" class="ld-cv__tab" role="tab" data-pf-bv-tab="work" aria-selected="false">Past work</button>
      </div>
      <div class="ld-cv__body">
        <div class="ld-cv__panel is-active" role="tabpanel" data-pf-bv-panel="bio">${bioPanel}</div>
        <div class="ld-cv__panel" role="tabpanel" data-pf-bv-panel="resume" hidden>${resumePanelHtml}</div>
        <div class="ld-cv__panel" role="tabpanel" data-pf-bv-panel="work" hidden>${workPanelHtml}</div>
      </div>
    </div>
  `;

  const tabs = businessView.querySelectorAll("[data-pf-bv-tab]");
  const panels = businessView.querySelectorAll("[data-pf-bv-panel]");
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.pfBvTab;
      tabs.forEach((t) => {
        const active = t.dataset.pfBvTab === target;
        t.classList.toggle("is-active", active);
        t.setAttribute("aria-selected", String(active));
      });
      panels.forEach((p) => {
        const active = p.dataset.pfBvPanel === target;
        if (active) {
          // Show, force reflow, then add .is-active so the opacity
          // and translateY transition runs on the incoming panel.
          p.hidden = false;
          p.classList.remove("is-active");
          void p.offsetWidth;
          p.classList.add("is-active");
        } else {
          p.classList.remove("is-active");
          p.hidden = true;
        }
      });
    });
  });
}

function getResumePublicToggle() {
  return document.getElementById("resume-public-toggle");
}

async function persistResumeVisibilityPreference(nextValue) {
  if (!supabase || !userId || role !== "consultant") return false;

  const previousValue = Boolean(profileRow?.resume_public);
  const toggle = getResumePublicToggle();
  if (toggle) toggle.disabled = true;

  try {
    const { error } = await supabase
      .from("profiles")
      .update({ resume_public: nextValue })
      .eq("id", userId);

    if (error) {
      if (isMissingResumePublic(error)) {
        throw new Error(
          "Resume visibility settings need the latest Supabase migration before they can be stored."
        );
      }
      throw error;
    }

    if (profileRow) {
      profileRow.resume_public = nextValue;
    }
    showSuccess(nextValue
      ? "Resume is now visible to businesses."
      : "Resume is now hidden from businesses.");

    if (isPreviewOpen()) {
      await renderBusinessPreview();
    }
    return true;
  } catch (err) {
    const t = getResumePublicToggle();
    if (t) t.checked = previousValue;
    showError(err.message || "Could not update resume visibility.");
    return false;
  } finally {
    const t = getResumePublicToggle();
    if (t) t.disabled = false;
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

avatarInput.addEventListener("change", async () => {
  const file = avatarInput.files?.[0];
  if (!file) return;

  // Pre-validate so a too-big or wrong-type file never flashes into the preview.
  const validationError = validateAvatarFile(file);
  if (validationError) {
    avatarInput.value = "";
    setAvatarStatus(validationError, "error");
    return;
  }

  // Square-crop step. Resolves to null if the user cancels; in that
  // case we silently bail without touching the existing avatar so the
  // photo they have stays put.
  let toUpload;
  try {
    toUpload = await cropToSquare(file);
  } catch (err) {
    avatarInput.value = "";
    setAvatarStatus(err?.message || "Could not open photo editor.", "error");
    return;
  }
  if (!toUpload) {
    avatarInput.value = "";
    return;
  }

  // Optimistic preview using the cropped blob, then auto-upload.
  setAvatarPreview(URL.createObjectURL(toUpload));
  setAvatarStatus("Uploading photo…");

  try {
    await uploadAvatarFile(toUpload);
    setAvatarStatus("Profile photo updated.", "success");
    if (role === "consultant" && isPreviewOpen()) {
      await renderBusinessPreview();
    }
  } catch (err) {
    avatarInput.value = "";
    setAvatarPreview(currentAvatarPath
      ? supabase?.storage.from("avatars").getPublicUrl(currentAvatarPath).data?.publicUrl
      : null);
    setAvatarStatus(err.message || "Could not upload photo.", "error");
  }
});

document.addEventListener("click", (event) => {
  const changeBtn = event.target.closest("#pf-avatar-change-btn");
  if (changeBtn instanceof HTMLElement) {
    event.preventDefault();
    avatarInput?.click();
    return;
  }
  const removeBtn = event.target.closest("#pf-avatar-remove-btn");
  if (removeBtn instanceof HTMLElement) {
    event.preventDefault();
    removeAvatarFile();
  }
});

/* ================================================================
   Load profile
   ================================================================ */

let profileRow = null;

async function loadProfile() {
  gateEl.textContent = "Loading…";

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
      "id, role, full_name, avatar_path, linkedin_url, resume_public, read_receipts_enabled, stripe_account_status, onboarded_at, created_at, consultant_profiles ( * ), business_profiles ( business_name, business_address, website_url, business_details, social_links, instagram_url, facebook_url, company_linkedin_url )"
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
        "id, role, full_name, avatar_path, linkedin_url, resume_public, read_receipts_enabled, stripe_account_status, onboarded_at, created_at, consultant_profiles ( * ), business_profiles ( business_name, website_url, business_details, social_links, instagram_url, facebook_url, company_linkedin_url )"
      )
      .eq("id", userId)
      .single());
  } else {
    businessAddressSupported = true;
  }

  if (error) {
    gateEl.textContent =
      error.message ||
      "Could not load your profile. Run Supabase migrations if this is a new column.";
    gateEl.className = "gr-status error";
    return;
  }

  // Phone, resume path and stripe ids aren't selectable from the table
  // (column grants), so the owner's own copy comes from an RPC.
  const { data: priv } = await supabase.rpc("get_my_private_profile").maybeSingle();
  if (priv) Object.assign(row, priv);

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
  renderAvatarState();

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
        "Business address is in the UI, but your database still needs `supabase/migrations/add_business_address.sql` before that field can load or save.";
      statusEl.className = "gr-status";
    }
  } else {
    loadedInstagramUrl = null;
  }

  if (role === "consultant") {
    await renderResumeCurrentLabel("Current resume on file —");

    // Education fields
    const cp = getRelatedRow(row.consultant_profiles);
    const majorField = document.getElementById("field-major");
    const minorField = document.getElementById("field-minor");
    const schoolField = document.getElementById("field-school");
    if (majorField) majorField.value = cp?.major || "";
    if (minorField) minorField.value = cp?.minor || "";
    if (schoolField) schoolField.value = cp?.school || "";

    // City — display label + hidden lat/lng. The autocomplete component
    // populates these together; we only need to pre-fill them on load.
    const citySearch = document.getElementById("field-city-search");
    const cityHidden = document.getElementById("field-city");
    const cityLat = document.getElementById("field-city-lat");
    const cityLng = document.getElementById("field-city-lng");
    if (citySearch) citySearch.value = cp?.city || "";
    if (cityHidden) cityHidden.value = cp?.city || "";
    if (cityLat) cityLat.value = cp?.city_lat != null ? String(cp.city_lat) : "";
    if (cityLng) cityLng.value = cp?.city_lng != null ? String(cp.city_lng) : "";

    // Resume public toggle
    if (resumePublicToggle) resumePublicToggle.checked = row.resume_public || false;

    // Portfolio
    await loadPortfolioItems();
    renderPortfolioList();

    // Preview bar
    if (previewBar) previewBar.classList.remove("hidden");
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
  saveBtn.textContent = "Saving…";

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

    const phoneField = document.getElementById("field-phone");
    const profileUpdate = {
      full_name: fullName,
    };
    if (phoneField) profileUpdate.phone_number = phoneField.value.trim() || null;
    if (role === "consultant") {
      profileUpdate.linkedin_url = linkedinUrl || null;
    }
    if (role === "consultant") {
      profileUpdate.resume_public = getResumePublicToggle()?.checked || false;
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
        showError(
          "saved your details. to store a profile photo, add column profiles.avatar_path in supabase (run supabase/profile_avatar.sql), then upload again.",
        );
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
      const cityVal = document.getElementById("field-city")?.value.trim() || null;
      const cityLatStr = document.getElementById("field-city-lat")?.value.trim() || "";
      const cityLngStr = document.getElementById("field-city-lng")?.value.trim() || "";
      // Only persist coords when both are present and parse as numbers —
      // a half-filled record would make the local-bucket math nonsense.
      const cityLatNum = cityLatStr ? Number(cityLatStr) : null;
      const cityLngNum = cityLngStr ? Number(cityLngStr) : null;
      const cityCoords =
        cityVal && Number.isFinite(cityLatNum) && Number.isFinite(cityLngNum)
          ? { city_lat: cityLatNum, city_lng: cityLngNum }
          : { city_lat: null, city_lng: null };
      try {
        await supabase.from("consultant_profiles").update({
          major: majorVal,
          minor: minorVal,
          school: schoolVal,
          city: cityVal,
          ...cityCoords,
        }).eq("user_id", userId);
      } catch (_) { /* columns may not exist yet */ }
    }

    if (role === "consultant" && resumeInput.files?.[0]) {
      await uploadResumeFile(resumeInput.files[0]);
      await renderResumeCurrentLabel("Current resume on file —");
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
        showSuccess(
          "Saved. Resume visibility settings need the latest Supabase migration before they can be stored.",
        );
      } else if (businessAddressMissingWarning) {
        showSuccess(
          "Saved, but business address could not be stored yet. Run supabase/migrations/add_business_address.sql, then save again.",
        );
      } else {
        showSuccess(
          instagramAvatarApplied ? "Saved. Profile photo updated from Instagram." : "Saved.",
        );
      }
    }

    /* Recompute completion after save */
    const freshRow = {
      ...profileRow,
      full_name: fullName,
      linkedin_url: role === "consultant" ? linkedinUrl || null : profileRow?.linkedin_url || null,
      avatar_path: currentAvatarPath,
      resume_path: currentResumePath,
      resume_public: getResumePublicToggle()?.checked || false,
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
      if (isPreviewOpen()) {
        await renderBusinessPreview();
      }
    } else {
      await renderOwnerListingSidebar();
    }
  } catch (err) {
    showError(err.message || "Save failed.");
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save changes";
  }
});

/* ================================================================
   Boot
   ================================================================ */

/* ================================================================
   Preview toggle
   ================================================================ */

/* Preview-as-business modal — fullscreen overlay with the same chrome
   as the listing-flow consultant viewer (`.ld-cv`). The form stays
   visible underneath; closing the modal leaves the user where they
   were on the page. Constant outer dimensions whether the consultant
   has content or not — the inner card sizes from a fixed max-width. */
let previewModalReturnFocusEl = null;

async function openPreviewModal() {
  if (!previewModal) return;
  previewModalReturnFocusEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await renderBusinessPreview();
  previewModal.classList.remove("hidden");
  previewModal.setAttribute("aria-hidden", "false");
  // Move focus into the modal so screen readers + keyboard users land
  // on the close button rather than re-reading the trigger label.
  requestAnimationFrame(() => {
    const closeBtn = previewModal.querySelector("[data-pf-preview-close]");
    if (closeBtn instanceof HTMLElement) closeBtn.focus();
  });
}

function closePreviewModal() {
  if (!previewModal) return;
  previewModal.classList.add("hidden");
  previewModal.setAttribute("aria-hidden", "true");
  if (previewModalReturnFocusEl && typeof previewModalReturnFocusEl.focus === "function") {
    previewModalReturnFocusEl.focus();
  }
  previewModalReturnFocusEl = null;
}

if (previewTrigger) {
  previewTrigger.addEventListener("click", () => { openPreviewModal(); });
}

if (previewModal) {
  previewModal.addEventListener("click", (event) => {
    if (event.target instanceof HTMLElement && event.target.closest("[data-pf-preview-close]")) {
      closePreviewModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && isPreviewOpen()) closePreviewModal();
  });
}

/* Delegated change handler — the resume public toggle is JS-rendered
   inside the populated resume row, so a static listener wouldn't survive
   re-renders. */
document.addEventListener("change", async (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement && target.id === "resume-public-toggle") {
    await persistResumeVisibilityPreference(target.checked);
  }
});

if (resumeInput) {
  resumeInput.addEventListener("change", async () => {
    const file = resumeInput.files?.[0];
    if (!file) return;
    if (!currentResumePath) return;

    const loadingToast = showLoading("Uploading resume…");
    try {
      await uploadResumeFile(file);
      await renderResumeCurrentLabel("Current resume on file —");
      loadingToast?.dismiss();
      showSuccess("Resume replaced.");
      if (role === "consultant" && isPreviewOpen()) {
        await renderBusinessPreview();
      }
    } catch (err) {
      resumeInput.value = "";
      loadingToast?.dismiss();
      showError(err.message || "Could not upload resume.");
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

  const portfolioAction = event.target.closest("[data-portfolio-action]");
  if (portfolioAction instanceof HTMLElement) {
    event.preventDefault();
    const action = portfolioAction.getAttribute("data-portfolio-action") || "preview";
    const itemId = portfolioAction.getAttribute("data-id");
    const fileName = portfolioAction.getAttribute("data-file-name") || "file";
    const item = portfolioItems.find((i) => i.id === itemId);
    if (!item) return;
    const url = await getPortfolioSignedUrl(item.file_path);
    if (!url) {
      showError("Could not load this work sample.");
      return;
    }
    if (action === "download") {
      triggerResumeDownload(url, fileName);
    } else {
      openResumeViewer(url, fileName);
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
    gateEl.textContent = err.message || "Could not connect.";
    gateEl.className = "gr-status error";
  }
}

boot();
