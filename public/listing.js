import { getSupabaseClient } from "/supabase-loader.js";
import { initControlPanel } from "/control-panel.js";
import { formatBudgetRange, getSimulatedBudgetRange } from "/sim-budget.js";

const gate = document.getElementById("listing-gate");
const detail = document.getElementById("listing-detail");
const statusBanner = document.getElementById("ld-status-banner");
const statusBannerPill = document.getElementById("ld-status-banner-pill");
const statusBannerCopy = document.getElementById("ld-status-banner-copy");
const statusBannerReason = document.getElementById("ld-status-banner-reason");
const ownerActionsPanel = document.getElementById("ld-owner-actions");
const ownerActionsCopy = document.getElementById("ld-owner-actions-copy");
const pauseListingBtn = document.getElementById("ld-pause-listing-btn");
const closeListingBtn = document.getElementById("ld-close-listing-btn");
const statusForm = document.getElementById("ld-status-form");
const statusFormTitle = document.getElementById("ld-status-form-title");
const statusOtherWrap = document.getElementById("ld-status-other-wrap");
const statusOtherInput = document.getElementById("ld-status-other-input");
const statusSubmitBtn = document.getElementById("ld-status-submit-btn");
const statusCancelBtn = document.getElementById("ld-status-cancel-btn");
const ownerActionStatus = document.getElementById("ld-owner-action-status");

const STATUS_REASON_LABELS = {
  work_completed: "work completed",
  found_solution_elsewhere: "found a solution elsewhere",
  didnt_find_good_offer: "didn't find a good offer",
  other: "other",
};

let pendingListingStatusAction = null;

/* ================================================================
   Utility helpers
   ================================================================ */

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(s) { return String(s).replace(/"/g, "&quot;"); }

function formatUsd(cents) {
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n / 100);
}

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1024) return `${value} b`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kb`;
  return `${(value / (1024 * 1024)).toFixed(1)} mb`;
}

function engagementLink(bidId) {
  return `/engagement.html?bid=${bidId}`;
}

function relativeDate(iso) {
  const d = new Date(iso);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff < 1) return "today";
  if (diff === 1) return "yesterday";
  if (diff < 30) return `${diff} days ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function friendlyDeadline(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const diff = Math.ceil((d - Date.now()) / 86400000);
  const formatted = d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  if (diff < 0) return `overdue (was ${formatted})`;
  if (diff === 0) return `due today (${formatted})`;
  return `${diff} day${diff === 1 ? "" : "s"} left — due ${formatted}`;
}

function isMissing(error) {
  if (!error) return false;
  const m = (error.message || "").toLowerCase();
  return m.includes("schema cache") || m.includes("does not exist") || m.includes("could not find");
}

function publicAvatarUrl(client, path) {
  if (!path) return null;
  const { data } = client.storage.from("avatars").getPublicUrl(path);
  return data?.publicUrl ?? null;
}

function getListingId() {
  return new URLSearchParams(window.location.search).get("id");
}

/* ================================================================
   Data loaders
   ================================================================ */

async function loadListing(client, id) {
  const listingSelectAttempts = [
    `id, owner_id, title, category, problem_summary, details, qualifications_required,
     status, status_reason, status_reason_other, attachments, turnaround_days, created_at,
     business_display_name, business_summary, listing_website_url, listing_social_links,
     profiles!listings_owner_id_fkey ( id, full_name, linkedin_url, avatar_path )`,
    `id, owner_id, title, category, problem_summary, details, qualifications_required,
     status, attachments, turnaround_days, created_at,
     business_display_name, business_summary, listing_website_url, listing_social_links,
     profiles!listings_owner_id_fkey ( id, full_name, linkedin_url, avatar_path )`,
    `id, owner_id, title, category, problem_summary, details, qualifications_required,
     status, turnaround_days, created_at,
     business_display_name, business_summary, listing_website_url, listing_social_links,
     profiles!listings_owner_id_fkey ( id, full_name, linkedin_url, avatar_path )`,
  ];

  let data = null;
  let error = null;
  for (const select of listingSelectAttempts) {
    const result = await client
      .from("listings")
      .select(select)
      .eq("id", id)
      .maybeSingle();

    data = result.data;
    error = result.error;
    if (!error) break;
    if (!isMissing(error)) return { listing: null, error };
  }

  if (error) return { listing: null, error };

  if (data?.profiles) {
    const { data: bizData } = await client
      .from("business_profiles")
      .select(
        "business_name, website_url, business_details, social_links, current_efforts, instagram_url, facebook_url, company_linkedin_url"
      )
      .eq("user_id", data.owner_id)
      .maybeSingle();
    if (bizData) data._business = bizData;
  }

  return { listing: data, error: null };
}

async function loadSessionRole(client, userId) {
  const { data } = await client.from("profiles").select("role").eq("id", userId).maybeSingle();
  return data?.role ?? null;
}

async function loadMyBid(client, listingId) {
  const { data, error } = await client
    .from("bids")
    .select("id, amount_cents, message, status, counter_offer_cents, counter_offer_message, accepted_at, proposal_due_at, proposal_path")
    .eq("listing_id", listingId)
    .maybeSingle();

  if (error && isMissing(error)) return { bid: null, available: false };
  return { bid: data, available: true };
}

async function loadOwnerBids(client, listingId) {
  const { data, error } = await client
    .from("bids")
    .select(
      `id, listing_id, consultant_id, amount_cents, message, status,
       counter_offer_cents, counter_offer_message, accepted_at, proposal_due_at, proposal_path, created_at,
       profiles!bids_consultant_id_fkey ( id, full_name, linkedin_url, avatar_path )`
    )
    .eq("listing_id", listingId)
    .order("created_at", { ascending: true });

  if (error && isMissing(error)) return { bids: [], available: false };
  if (error) { console.warn(error); return { bids: [], available: true }; }
  return { bids: data || [], available: true };
}

async function loadConsultantEducationMap(client, consultantIds) {
  const ids = [...new Set((consultantIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  const { data, error } = await client
    .from("consultant_profiles")
    .select("user_id, major, minor, school")
    .in("user_id", ids);

  if (error && isMissing(error)) return new Map();
  if (error) {
    console.warn("consultant education load:", error);
    return new Map();
  }

  return new Map((data || []).map((row) => [row.user_id, row]));
}

async function loadMessages(client, listingId, otherUserId) {
  const { data, error } = await client
    .from("messages")
    .select("id, sender_id, recipient_id, body, created_at")
    .eq("listing_id", listingId)
    .or(`and(sender_id.eq.${otherUserId}),and(recipient_id.eq.${otherUserId})`)
    .order("created_at", { ascending: true });

  if (error && isMissing(error)) return [];
  if (error) { console.warn("messages load:", error); return []; }
  return data || [];
}

/* ================================================================
   Populate listing header & info
   ================================================================ */

/* Social platform SVG icons */
function socialSvg(platform) {
  const icons = {
    instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.2"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
    linkedin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
  };
  return icons[platform] || icons.linkedin;
}

function detectPlatform(url) {
  const u = url.toLowerCase();
  if (u.includes("instagram")) return "instagram";
  if (u.includes("facebook") || u.includes("fb.com")) return "facebook";
  if (u.includes("linkedin")) return "linkedin";
  return "linkedin";
}

/* Opportunity-type tag icon (small inline) */
function typeTagIcon(type) {
  const icons = {
    do: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>',
    develop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="m9 15 2-6 6-2-2 6-6 2Z"/></svg>',
  };
  return icons[type] || "";
}

function parseStructuredListingDetails(text) {
  const raw = String(text || "").replace(/\r/g, "");
  const sectionLabels = [
    { key: "issueContext", label: "issue context:" },
    { key: "businessProblem", label: "business problem:" },
    { key: "expectedOutput", label: "expected output:" },
    { key: "additionalDetails", label: "additional details:" },
  ];

  const lines = raw.split("\n");
  const normalized = lines.map((line) => line.trim().toLowerCase());
  const indexes = sectionLabels
    .map((section) => ({ ...section, index: normalized.findIndex((line) => line === section.label) }))
    .filter((section) => section.index >= 0)
    .sort((a, b) => a.index - b.index);

  const parsed = {
    opportunityType: (raw.match(/^opportunity type:\s*(.+)$/im) || [])[1]?.trim() || "",
    issueContext: "",
    businessProblem: "",
    expectedOutput: "",
    additionalDetails: "",
    legacyDetails: raw
      .replace(/^opportunity type:\s*.+$/im, "")
      .replace(/^budget range:\s*.+$/im, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };

  indexes.forEach((section, idx) => {
    const nextIndex = indexes[idx + 1]?.index ?? lines.length;
    parsed[section.key] = lines
      .slice(section.index + 1, nextIndex)
      .join("\n")
      .trim();
  });

  return parsed;
}

function getListingStatusLabel(status) {
  const normalized = String(status || "open").toLowerCase();
  if (normalized === "paused") return "paused";
  if (normalized === "closed") return "closed";
  if (normalized === "filled") return "filled";
  return "open";
}

function getListingReasonLabel(reason) {
  return STATUS_REASON_LABELS[String(reason || "").trim()] || "";
}

function getListingReasonText(listing) {
  const reason = String(listing?.status_reason || "").trim();
  if (!reason) return "";
  if (reason === "other") {
    const other = String(listing?.status_reason_other || "").trim();
    return other || "other";
  }
  return getListingReasonLabel(reason);
}

function getListingAttachments(listing) {
  return Array.isArray(listing?.attachments) ? listing.attachments.filter(Boolean) : [];
}

function renderListingAttachments(listing) {
  const attachmentsWrap = document.getElementById("ld-attachments");
  if (!attachmentsWrap) return;

  const attachments = getListingAttachments(listing);
  if (!attachments.length) {
    attachmentsWrap.innerHTML = "";
    attachmentsWrap.hidden = true;
    return;
  }

  attachmentsWrap.innerHTML = attachments
    .map((item) => {
      const url = String(item?.public_url || "").trim();
      const name = String(item?.name || "attachment").trim();
      const detailBits = [
        String(item?.kind || "").trim(),
        formatFileSize(item?.size),
      ].filter(Boolean);
      const detail = detailBits.join(" · ");
      const isImage = String(item?.content_type || "").toLowerCase().startsWith("image/");

      return `
        <article class="ld-attachment-card">
          ${isImage && url ? `<a class="ld-attachment-card__thumb" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeAttr(url)}" alt="${escapeAttr(name)}" /></a>` : `<div class="ld-attachment-card__icon" aria-hidden="true">${escapeHtml((String(item?.kind || "file").trim() || "file").slice(0, 1).toUpperCase())}</div>`}
          <div class="ld-attachment-card__body">
            <p class="ld-attachment-card__name">${escapeHtml(name)}</p>
            ${detail ? `<p class="ld-attachment-card__detail">${escapeHtml(detail)}</p>` : ""}
            ${url ? `<a class="ld-attachment-card__link" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">open file</a>` : ""}
          </div>
        </article>
      `;
    })
    .join("");

  attachmentsWrap.hidden = false;
}

function renderListingStatusBanner(listing, viewer = {}) {
  if (!statusBanner || !statusBannerPill || !statusBannerCopy || !statusBannerReason) return;

  const status = getListingStatusLabel(listing?.status);
  if (status === "open") {
    statusBanner.hidden = true;
    statusBannerReason.hidden = true;
    return;
  }

  const isOwner = Boolean(viewer.isOwner);
  const hasExistingBid = Boolean(viewer.hasExistingBid);
  let copy = "This listing is no longer accepting new offers.";

  if (status === "paused") {
    copy = isOwner
      ? "This listing is hidden from backyard browsing, but your existing proposals stay available below."
      : hasExistingBid
        ? "This listing is paused. Your existing offer stays on file, but new offer activity is turned off."
        : "This listing is paused and no longer appears in backyard browsing.";
  } else if (status === "closed") {
    copy = isOwner
      ? "This listing is closed. It is out of backyard browsing, but you can still review the proposal history here."
      : hasExistingBid
        ? "This listing is closed. Your earlier offer stays visible here for reference."
        : "This listing is closed.";
  } else if (status === "filled") {
    copy = "This listing has already been filled.";
  }

  statusBanner.dataset.status = status;
  statusBannerPill.textContent = status;
  statusBannerCopy.textContent = copy;

  const reasonText = getListingReasonText(listing);
  if (reasonText) {
    statusBannerReason.textContent = `Reason: ${reasonText}.`;
    statusBannerReason.hidden = false;
  } else {
    statusBannerReason.hidden = true;
  }

  statusBanner.hidden = false;
}

function populateListing(listing) {
  const profile = listing.profiles;
  const biz = listing._business || null;

  document.title = `grassroots — ${listing.title}`;

  /* --- Business bio --- */
  const ownerName = profile?.full_name || listing.business_display_name || "Business owner";
  document.getElementById("ld-biz-owner").textContent = ownerName;

  const bizName = biz?.business_name || listing.business_display_name;
  if (bizName) { const el = document.getElementById("ld-biz-name"); el.textContent = bizName; el.hidden = false; }

  const bizDetails = biz?.business_details || listing.business_summary;
  if (bizDetails) { const el = document.getElementById("ld-biz-details"); el.textContent = bizDetails; el.hidden = false; }

  const websiteUrl = biz?.website_url || listing.listing_website_url;
  if (websiteUrl) { const el = document.getElementById("ld-biz-website"); el.href = websiteUrl; el.textContent = new URL(websiteUrl).hostname.replace("www.", ""); el.hidden = false; }

  /* Social icons */
  const fromExplicit = [biz?.instagram_url, biz?.facebook_url, biz?.company_linkedin_url].filter(
    (u) => u && String(u).trim()
  );
  if (profile?.linkedin_url) fromExplicit.push(profile.linkedin_url);
  const fromLegacy = biz?.social_links || listing.listing_social_links || [];
  const merged = [...fromExplicit, ...(Array.isArray(fromLegacy) ? fromLegacy : [])];
  const socialLinks = [...new Set(merged.map((u) => String(u).trim()))].filter(Boolean);
  if (socialLinks.length) {
    const wrap = document.getElementById("ld-biz-socials");
    wrap.innerHTML = socialLinks.map((url) => {
      try {
        const platform = detectPlatform(url);
        return `<a href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer" class="ld-bio__social-link" title="${platform}">${socialSvg(platform)}</a>`;
      } catch { return ""; }
    }).filter(Boolean).join("");
    wrap.hidden = false;
  }

  /* --- Collapsible toggle --- */
  const bioToggle = document.getElementById("ld-bio-toggle");
  const bioBody = document.getElementById("ld-bio-body");
  bioToggle.addEventListener("click", () => {
    const isExpanded = bioToggle.getAttribute("aria-expanded") === "true";
    bioToggle.setAttribute("aria-expanded", String(!isExpanded));
    bioBody.classList.toggle("is-collapsed", isExpanded);
  });

  /* --- Opportunity header --- */
  document.getElementById("ld-title").textContent = listing.title;
  document.getElementById("ld-date").textContent = `posted ${relativeDate(listing.created_at)}`;

  if (listing.turnaround_days) {
    const el = document.getElementById("ld-turnaround");
    el.textContent = `${listing.turnaround_days} day${listing.turnaround_days === 1 ? "" : "s"} turnaround`;
    el.hidden = false;
  }

  /* --- Parse structured fields from details --- */
  const detailsStr = listing.details || "";
  const parsedDetails = parseStructuredListingDetails(detailsStr);
  const budgetRange = getSimulatedBudgetRange(detailsStr);
  const contextEl = document.getElementById("ld-context");
  const contextSectionEl = document.getElementById("ld-context-section");
  const summaryEl = document.getElementById("ld-summary");
  const summaryHeadingEl = document.getElementById("ld-summary-heading");
  const outputEl = document.getElementById("ld-output");
  const outputSectionEl = document.getElementById("ld-output-section");
  const detailsEl = document.getElementById("ld-details");
  const detailsHeadingEl = document.getElementById("ld-details-heading");
  const detailsSectionEl = document.getElementById("ld-details-section");
  const attachments = getListingAttachments(listing);

  /* --- Budget subheader --- */
  if (budgetRange) {
    const budgetEl = document.getElementById("ld-budget");
    budgetEl.textContent = formatBudgetRange(budgetRange);
    budgetEl.hidden = false;
  }

  /* --- Tags (type + categories) --- */
  const tagsEl = document.getElementById("ld-header-tags");
  let tagsHtml = "";

  if (parsedDetails.opportunityType) {
    const typeVal = parsedDetails.opportunityType.trim().toLowerCase();
    const icon = typeTagIcon(typeVal);
    tagsHtml += `<span class="ld-tag ld-tag--type">${icon ? icon + " " : ""}${escapeHtml(typeVal)}</span>`;
  }

  if (listing.category) {
    listing.category.split(",").map((c) => c.trim()).filter(Boolean).forEach((cat) => {
      tagsHtml += `<span class="ld-tag">${escapeHtml(cat)}</span>`;
    });
  }
  tagsEl.innerHTML = tagsHtml;

  /* --- Structured content sections --- */
  if (parsedDetails.issueContext) {
    contextEl.textContent = parsedDetails.issueContext;
    contextSectionEl.hidden = false;
  }

  summaryHeadingEl.textContent = parsedDetails.businessProblem ? "business problem" : "the challenge";
  summaryEl.textContent = parsedDetails.businessProblem || listing.problem_summary || "No summary provided.";

  if (parsedDetails.expectedOutput) {
    outputEl.textContent = parsedDetails.expectedOutput;
    outputSectionEl.hidden = false;
  }

  const detailsBody =
    parsedDetails.additionalDetails ||
    (!parsedDetails.issueContext && !parsedDetails.businessProblem && !parsedDetails.expectedOutput
      ? parsedDetails.legacyDetails
      : "");

  if (detailsBody) {
    detailsHeadingEl.textContent = parsedDetails.additionalDetails ? "additional details" : "details";
    detailsEl.textContent = detailsBody;
    detailsEl.hidden = false;
  } else {
    detailsEl.textContent = "";
    detailsEl.hidden = true;
  }
  renderListingAttachments(listing);
  detailsSectionEl.hidden = !detailsBody && attachments.length === 0;

  /* --- Qualifications (bullet points) --- */
  if (listing.qualifications_required) {
    const qualsEl = document.getElementById("ld-quals");
    const quals = listing.qualifications_required.split("\n").map(q => q.trim()).filter(Boolean);
    qualsEl.innerHTML = quals.map(q => `<li>${escapeHtml(q)}</li>`).join("");
    document.getElementById("ld-quals-section").hidden = false;
  }

  return { profile, biz };
}

function populateAvatarIfAvailable(client, profile) {
  const url = publicAvatarUrl(client, profile?.avatar_path);
  if (url) {
    document.getElementById("ld-biz-avatar").src = url;
    document.getElementById("ld-biz-avatar-wrap").hidden = false;
  }
}

function formatConsultantEducationLine(education) {
  const major = education?.major?.trim?.() || "";
  const school = education?.school?.trim?.() || "";
  if (major && school) return `${major} @ ${school}`;
  return major || school || "";
}

function resetOwnerStatusForm() {
  if (!statusForm || !statusOtherWrap || !statusOtherInput || !statusFormTitle) return;
  pendingListingStatusAction = null;
  statusForm.reset();
  statusForm.classList.add("hidden");
  statusOtherWrap.classList.add("hidden");
  statusOtherInput.value = "";
  statusSubmitBtn.textContent = "confirm";
  statusFormTitle.textContent = "";
}

function syncOwnerStatusOtherField() {
  if (!statusOtherWrap || !statusOtherInput) return;
  const selected = document.querySelector('input[name="listingStatusReason"]:checked')?.value || "";
  const showOther = selected === "other";
  statusOtherWrap.classList.toggle("hidden", !showOther);
  if (!showOther) statusOtherInput.value = "";
}

function openOwnerStatusForm(action) {
  if (!statusForm || !statusFormTitle || !ownerActionStatus) return;
  pendingListingStatusAction = action;
  ownerActionStatus.textContent = "";
  ownerActionStatus.className = "gr-status";
  statusFormTitle.textContent =
    action === "paused" ? "Why are you pausing this listing?" : "Why are you closing this listing?";
  statusSubmitBtn.textContent = action === "paused" ? "pause listing" : "close listing";
  statusForm.classList.remove("hidden");
  syncOwnerStatusOtherField();
}

function renderOwnerActionSummary(listing) {
  if (!ownerActionsCopy || !pauseListingBtn || !closeListingBtn) return;
  const status = getListingStatusLabel(listing?.status);
  const reasonText = getListingReasonText(listing);

  if (status === "paused") {
    ownerActionsCopy.textContent = reasonText
      ? `This listing is paused because of "${reasonText}". Resume it any time or close it permanently.`
      : "This listing is paused. Existing proposals stay in place while it stays out of backyard browsing.";
    pauseListingBtn.textContent = "resume listing";
    pauseListingBtn.disabled = false;
    closeListingBtn.disabled = false;
    return;
  }

  if (status === "closed") {
    ownerActionsCopy.textContent = reasonText
      ? `This listing is closed because of "${reasonText}". Existing participants can still refer back to it here.`
      : "This listing is closed. Existing participants can still refer back to it here.";
    pauseListingBtn.textContent = "pause listing";
    pauseListingBtn.disabled = true;
    closeListingBtn.disabled = true;
    resetOwnerStatusForm();
    return;
  }

  ownerActionsCopy.textContent =
    "Pause this listing to hide it from backyard browsing while keeping current proposals in place, or close it when you're done.";
  pauseListingBtn.textContent = "pause listing";
  pauseListingBtn.disabled = false;
  closeListingBtn.disabled = false;
}

function showOwnerActionFeedback(message, kind = "success") {
  if (!ownerActionStatus) return;
  ownerActionStatus.textContent = message;
  ownerActionStatus.className = kind === "error" ? "gr-status error" : "gr-status success";
}

async function persistListingStatus(client, listing, nextStatus, reason = null, otherReason = null) {
  const payload = {
    status: nextStatus,
    status_reason: reason,
    status_reason_other: reason === "other" ? otherReason : null,
  };

  const { error } = await client.from("listings").update(payload).eq("id", listing.id);
  if (error) throw error;

  listing.status = payload.status;
  listing.status_reason = payload.status_reason;
  listing.status_reason_other = payload.status_reason_other;
}

function setupOwnerListingActions(client, listing) {
  if (
    !ownerActionsPanel ||
    !pauseListingBtn ||
    !closeListingBtn ||
    !statusForm ||
    !statusCancelBtn ||
    !statusSubmitBtn
  ) {
    return;
  }

  ownerActionsPanel.hidden = false;
  renderOwnerActionSummary(listing);

  if (!ownerActionsPanel.dataset.bound) {
    pauseListingBtn.addEventListener("click", async () => {
      if (getListingStatusLabel(listing.status) === "paused") {
        ownerActionStatus.textContent = "";
        ownerActionStatus.className = "gr-status";
        pauseListingBtn.disabled = true;
        try {
          await persistListingStatus(client, listing, "open", null, null);
          renderOwnerActionSummary(listing);
          renderListingStatusBanner(listing, { isOwner: true });
          resetOwnerStatusForm();
          showOwnerActionFeedback("listing resumed. it is visible in backyard browsing again.");
        } catch (error) {
          showOwnerActionFeedback(error.message || "could not resume listing.", "error");
        } finally {
          renderOwnerActionSummary(listing);
        }
        return;
      }

      resetOwnerStatusForm();
      openOwnerStatusForm("paused");
    });

    closeListingBtn.addEventListener("click", () => {
      resetOwnerStatusForm();
      openOwnerStatusForm("closed");
    });

    statusCancelBtn.addEventListener("click", () => {
      resetOwnerStatusForm();
      ownerActionStatus.textContent = "";
      ownerActionStatus.className = "gr-status";
    });

    statusForm.addEventListener("change", (event) => {
      if (event.target instanceof HTMLInputElement && event.target.name === "listingStatusReason") {
        syncOwnerStatusOtherField();
      }
    });

    statusForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = pendingListingStatusAction;
      if (!action) return;

      const reason = document.querySelector('input[name="listingStatusReason"]:checked')?.value || "";
      if (!reason) {
        showOwnerActionFeedback("choose a reason before continuing.", "error");
        return;
      }

      const otherReason = reason === "other" ? statusOtherInput?.value.trim() || "" : "";
      if (reason === "other" && !otherReason) {
        showOwnerActionFeedback("add a short note when you choose other.", "error");
        return;
      }

      statusSubmitBtn.disabled = true;
      ownerActionStatus.textContent = "";
      ownerActionStatus.className = "gr-status";

      try {
        await persistListingStatus(client, listing, action, reason, otherReason || null);
        renderOwnerActionSummary(listing);
        renderListingStatusBanner(listing, { isOwner: true });
        resetOwnerStatusForm();
        showOwnerActionFeedback(
          action === "paused"
            ? "listing paused. it is now hidden from backyard browsing, but current proposals remain in place."
            : "listing closed. it is out of backyard browsing and marked closed for existing participants."
        );
      } catch (error) {
        showOwnerActionFeedback(error.message || "could not update listing status.", "error");
      } finally {
        statusSubmitBtn.disabled = false;
      }
    });

    ownerActionsPanel.dataset.bound = "1";
  }
}

/* ================================================================
   Message thread renderer
   ================================================================ */

function renderMsgThread(container, messages, myId) {
  if (!messages.length) {
    container.innerHTML = '<p class="ld-msg-empty">no messages yet.</p>';
    return;
  }
  container.innerHTML = messages.map((m) => {
    const mine = m.sender_id === myId;
    const time = new Date(m.created_at).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    return `<div class="ld-msg-bubble ${mine ? "ld-msg-bubble--mine" : "ld-msg-bubble--theirs"}">
      <p class="ld-msg-text">${escapeHtml(m.body)}</p>
      <span class="ld-msg-time">${time}</span>
    </div>`;
  }).join("");
  container.scrollTop = container.scrollHeight;
}

/* ================================================================
   Consultant view: offer panel (sidebar) + chat drawer
   ================================================================ */

function showConsultantView(client, session, listing, existingBid) {
  const panel = document.getElementById("ld-offer-panel");
  panel.hidden = false;

  const amountInput = document.getElementById("ld-bid-amount");
  const msgInput = document.getElementById("ld-bid-message");
  const msgToggleBtn = document.getElementById("ld-offer-msg-toggle");
  const msgWrap = document.getElementById("ld-offer-msg-wrap");
  const msgRemoveBtn = document.getElementById("ld-offer-msg-remove");
  const charCount = document.getElementById("ld-offer-char-count");
  const submitBtn = document.getElementById("ld-bid-submit");
  const statusEl = document.getElementById("ld-bid-status");
  const formWrap = document.getElementById("ld-offer-form-wrap");
  const listingId = listing.id;
  const ownerId = listing.owner_id;
  const myId = session.user.id;
  const listingStatus = getListingStatusLabel(listing.status);
  const listingAcceptingOffers = listingStatus === "open";

  /* --- Populate existing bid --- */
  if (existingBid) {
    const el = document.getElementById("ld-bid-existing");
    el.innerHTML = `current offer: <strong>${formatUsd(existingBid.amount_cents)}</strong>`;
    el.hidden = false;
    amountInput.value = (existingBid.amount_cents / 100).toFixed(2);
    if (existingBid.message) {
      msgInput.value = existingBid.message;
      msgWrap.classList.remove("hidden");
      msgToggleBtn.classList.add("hidden");
      charCount.textContent = 250 - existingBid.message.length;
    }
    submitBtn.textContent = "update offer";
  }

  /* --- Message toggle --- */
  msgToggleBtn.addEventListener("click", () => {
    msgWrap.classList.remove("hidden");
    msgToggleBtn.classList.add("hidden");
    msgInput.focus();
  });

  msgRemoveBtn.addEventListener("click", () => {
    msgWrap.classList.add("hidden");
    msgToggleBtn.classList.remove("hidden");
    msgInput.value = "";
    charCount.textContent = "250";
  });

  msgInput.addEventListener("input", () => {
    const remaining = 250 - msgInput.value.length;
    charCount.textContent = remaining;
    charCount.classList.toggle("ld-offer-char-count--low", remaining < 40);
  });

  /* --- Accepted banner --- */
  if (existingBid?.status === "accepted") {
    const bannersEl = document.getElementById("ld-bid-banners");
    bannersEl.hidden = false;
    document.getElementById("ld-bid-accepted-banner").hidden = false;
    document.getElementById("ld-bid-deadline-text").innerHTML =
      `your offer was accepted. check your inbox for scheduling updates, or <a href="${engagementLink(existingBid.id)}">manage ongoing work</a>.`;
    formWrap.hidden = true;
  }

  /* --- Counter-offer banner --- */
  if (existingBid?.status === "countered") {
    const bannersEl = document.getElementById("ld-bid-banners");
    bannersEl.hidden = false;
    document.getElementById("ld-bid-countered-banner").hidden = false;
    document.getElementById("ld-counter-display").innerHTML =
      `the owner countered at <strong>${formatUsd(existingBid.counter_offer_cents)}</strong>` +
      (existingBid.counter_offer_message ? ` — "${escapeHtml(existingBid.counter_offer_message)}"` : "");

    document.getElementById("ld-accept-counter-btn").addEventListener("click", async () => {
      const { error } = await client.from("bids").update({
        amount_cents: existingBid.counter_offer_cents,
        status: "pending",
        counter_offer_cents: null,
        counter_offer_message: null,
      }).eq("id", existingBid.id);
      if (error) { statusEl.textContent = error.message; statusEl.className = "gr-status error"; return; }
      window.location.reload();
    });
  }

  if (!listingAcceptingOffers) {
    formWrap.hidden = true;
    statusEl.textContent = existingBid
      ? `this listing is ${listingStatus}. your existing offer stays visible here, but new edits are turned off for now.`
      : `this listing is ${listingStatus} and is not accepting new offers right now.`;
    statusEl.className = "gr-status";
  }

  /* --- Submit offer --- */
  submitBtn.addEventListener("click", async () => {
    if (!listingAcceptingOffers) {
      statusEl.textContent = `this listing is ${listingStatus} and cannot accept offer changes right now.`;
      statusEl.className = "gr-status error";
      return;
    }
    statusEl.textContent = ""; statusEl.className = "gr-status";
    const cents = Math.round(parseFloat(amountInput.value) * 100);
    if (!Number.isFinite(cents) || cents < 1) {
      statusEl.textContent = "enter a valid amount."; statusEl.className = "gr-status error"; return;
    }
    submitBtn.disabled = true;
    const payload = {
      listing_id: listingId,
      consultant_id: myId,
      amount_cents: cents,
      message: msgInput.value.trim() || null,
    };
    const { error } = await client.from("bids").upsert(payload, { onConflict: "listing_id,consultant_id" });
    if (error) { statusEl.textContent = error.message; statusEl.className = "gr-status error"; submitBtn.disabled = false; return; }
    statusEl.textContent = "offer submitted."; statusEl.className = "gr-status success";
    submitBtn.textContent = "update offer";
    const existingEl = document.getElementById("ld-bid-existing");
    existingEl.innerHTML = `current offer: <strong>${formatUsd(cents)}</strong>`;
    existingEl.hidden = false;
    submitBtn.disabled = false;
  });

  /* --- "have a question?" button + chat drawer --- */
  setupChatDrawer(client, listing, myId, ownerId);
}

async function setupChatDrawer(client, listing, myId, ownerId) {
  /* Reveal the button */
  const questionWrap = document.getElementById("ld-question-wrap");
  questionWrap.hidden = false;

  const drawer = document.getElementById("ld-chat-drawer");
  const backdrop = document.getElementById("ld-chat-backdrop");
  const closeBtn = document.getElementById("ld-chat-close");
  const thread = document.getElementById("ld-chat-thread");
  const input = document.getElementById("ld-chat-input");
  const sendBtn = document.getElementById("ld-chat-send");
  const chatCharCount = document.getElementById("ld-chat-char-count");
  const contextBanner = document.getElementById("ld-chat-context");
  const contextTitle = document.getElementById("ld-chat-context-title");

  let messages = [];
  let drawerLoaded = false;

  function openDrawer() {
    drawer.hidden = false;
    drawer.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    input.focus();
  }

  function closeDrawer() {
    drawer.hidden = true;
    drawer.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  document.getElementById("ld-question-btn").addEventListener("click", async () => {
    if (!drawerLoaded) {
      messages = await loadMessages(client, listing.id, ownerId);
      renderChatThread(thread, messages, myId);
      drawerLoaded = true;

      /* Show locked context header only if this will be the first message */
      if (!messages.length) {
        contextTitle.textContent = listing.title;
        contextBanner.hidden = false;
        input.maxLength = 200;
        chatCharCount.textContent = "200";
      } else {
        input.maxLength = 2000;
        chatCharCount.hidden = true;
      }
    }
    openDrawer();
  });

  closeBtn.addEventListener("click", closeDrawer);
  backdrop.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !drawer.hidden) closeDrawer(); });

  input.addEventListener("input", () => {
    if (!contextBanner.hidden) {
      const remaining = 200 - input.value.length;
      chatCharCount.textContent = remaining;
      chatCharCount.classList.toggle("ld-chat-char-count--low", remaining < 40);
    }
  });

  sendBtn.addEventListener("click", async () => {
    const body = input.value.trim();
    if (!body) return;

    /* First message: prepend the listing context as a stored prefix */
    const isFirst = !messages.length;
    const fullBody = isFirst
      ? `re: ${listing.title}\u001F${body}`   /* \u001F = unit separator — used as our delimiter */
      : body;

    sendBtn.disabled = true;
    const { data, error } = await client.from("messages").insert({
      listing_id: listing.id,
      sender_id: myId,
      recipient_id: ownerId,
      body: fullBody,
    }).select().single();

    if (error) { console.error(error); sendBtn.disabled = false; return; }

    messages.push(data);
    input.value = "";
    appendChatBubble(thread, { ...data, body: fullBody }, myId);
    thread.scrollTop = thread.scrollHeight;
    sendBtn.disabled = false;

    /* After first send, hide context banner + switch to regular compose */
    if (isFirst) {
      contextBanner.hidden = true;
      input.maxLength = 2000;
      chatCharCount.hidden = true;
    }
  });
}

/* Render the full thread inside the chat drawer */
function renderChatThread(container, messages, myId) {
  if (!messages.length) {
    container.innerHTML = '<p class="ld-msg-empty">no messages yet.</p>';
    return;
  }
  container.innerHTML = "";
  messages.forEach((m) => appendChatBubble(container, m, myId));
  container.scrollTop = container.scrollHeight;
}

function appendChatBubble(container, m, myId) {
  container.querySelector(".ld-msg-empty")?.remove();
  const mine = m.sender_id === myId;
  const time = new Date(m.created_at || Date.now()).toLocaleString("en-US", {
    month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
  });

  /* Detect context-prefixed first messages */
  const SEP = "\u001F";
  const hasContext = m.body.includes(SEP);
  let contextPart = null;
  let bodyPart = m.body;
  if (hasContext) {
    const idx = m.body.indexOf(SEP);
    contextPart = m.body.slice(0, idx).replace(/^re:\s*/i, "").trim();
    bodyPart = m.body.slice(idx + 1).trim();
  }

  const bubble = document.createElement("div");
  bubble.className = `ld-msg-bubble ${mine ? "ld-msg-bubble--mine" : "ld-msg-bubble--theirs"}`;

  bubble.innerHTML = `
    ${hasContext ? `<div class="ld-msg-context-tag"><span class="ld-msg-context-tag__re">re:</span> ${escapeHtml(contextPart)}</div>` : ""}
    <p class="ld-msg-text">${escapeHtml(bodyPart)}</p>
    <span class="ld-msg-time">${time}</span>
  `;
  container.appendChild(bubble);
}

/* ================================================================
   Owner view: bids list with accept, counter-offer, messaging
   ================================================================ */

function showOwnerBids(client, session, listing, bids, educationMap = new Map()) {
  const section = document.getElementById("ld-bids-owner");
  section.hidden = false;

  const list = document.getElementById("ld-bids-list");
  const budgetEl = document.getElementById("ld-counter-budget");
  const totalCounters = bids.filter((b) => b.counter_offer_cents != null).length;
  budgetEl.textContent = `counter-offers used: ${totalCounters} / 3`;

  if (!bids.length) {
    list.innerHTML = '<p class="ld-bids-empty">no proposals yet.</p>';
    return;
  }

  list.innerHTML = "";

  for (const b of bids) {
    const card = document.createElement("div");
    card.className = "ld-bid-card";
    const p = b.profiles;
    const education = educationMap.get(b.consultant_id) || null;
    const educationLine = formatConsultantEducationLine(education);
    const minor = education?.minor?.trim?.() || "";
    const rawName = p?.full_name || "Consultant";
    const name = escapeHtml(rawName);
    const profileLink = b.consultant_id ? `/consultant-profile.html?id=${b.consultant_id}` : "";
    const nameHtml = profileLink
      ? `<a href="${escapeAttr(profileLink)}" class="gr-bid-link gr-bid-link--primary">${name}</a>`
      : name;
    const avatar = publicAvatarUrl(client, p?.avatar_path);
    const li = p?.linkedin_url ? `<a href="${escapeAttr(p.linkedin_url)}" target="_blank" rel="noopener noreferrer" class="gr-bid-link">linkedin</a>` : "";
    const msg = b.message ? `<p class="ld-bid-message">${escapeHtml(b.message)}</p>` : "";
    const img = avatar
      ? `<img class="ld-bid-avatar" src="${escapeAttr(avatar)}" width="52" height="52" alt="" />`
      : `<div class="ld-bid-avatar ld-bid-avatar--placeholder" aria-hidden="true"></div>`;
    const date = relativeDate(b.created_at);

    const statusBadge = b.status !== "pending"
      ? `<span class="ld-bid-status-badge ld-bid-status-badge--${b.status}">${b.status}</span>`
      : "";

    let proposalIndicator = "";
    if (b.status === "accepted") {
      proposalIndicator = `<span class="ld-proposal-indicator ld-proposal-indicator--done">accepted — continue in ongoing work</span>`;
    }

    let counterInfo = "";
    if (b.counter_offer_cents) {
      counterInfo = `<div class="ld-bid-counter-info">counter: <strong>${formatUsd(b.counter_offer_cents)}</strong>${b.counter_offer_message ? ` — "${escapeHtml(b.counter_offer_message)}"` : ""}</div>`;
    }

    card.innerHTML = `
      <div class="ld-bid-card__header">
        ${img}
        <div class="ld-bid-card__info">
          <span class="ld-bid-card__name">${nameHtml} ${statusBadge}</span>
          <span class="ld-bid-card__amount">${formatUsd(b.amount_cents)}</span>
          ${educationLine ? `<span class="ld-bid-card__edu">${escapeHtml(educationLine)}</span>` : ""}
          ${minor ? `<span class="ld-bid-card__minor">minor in ${escapeHtml(minor)}</span>` : ""}
        </div>
      </div>
      <div class="ld-bid-card__meta">${li}<span class="ld-bid-card__date">${date}</span></div>
      ${msg}
      ${counterInfo}
      ${proposalIndicator}
      <div class="ld-bid-card__actions"></div>
      <div class="ld-bid-card__counter-form hidden"></div>
      <div class="ld-bid-card__msg-area hidden"></div>
    `;

    const actionsEl = card.querySelector(".ld-bid-card__actions");
    const counterFormEl = card.querySelector(".ld-bid-card__counter-form");
    const msgAreaEl = card.querySelector(".ld-bid-card__msg-area");

    /* Accept button */
    if (b.status === "pending" || b.status === "countered") {
      const acceptBtn = document.createElement("button");
      acceptBtn.className = "gr-btn gr-btn--primary gr-btn--sm";
      acceptBtn.textContent = "accept";
      acceptBtn.addEventListener("click", () => handleAcceptBid(client, session, listing, b, card));
      actionsEl.appendChild(acceptBtn);
    }

    if (b.status === "accepted") {
      const manageLink = document.createElement("a");
      manageLink.className = "gr-btn gr-btn--ghost gr-btn--sm";
      manageLink.href = engagementLink(b.id);
      manageLink.textContent = "manage ongoing work";
      actionsEl.appendChild(manageLink);
    }

    /* Counter button (only if no counter yet and under limit) */
    if (!b.counter_offer_cents && totalCounters < 3 && (b.status === "pending")) {
      const counterBtn = document.createElement("button");
      counterBtn.className = "gr-btn gr-btn--ghost gr-btn--sm";
      counterBtn.textContent = "counter";
      counterBtn.addEventListener("click", () => {
        counterFormEl.classList.toggle("hidden");
        if (!counterFormEl.dataset.init) {
          counterFormEl.dataset.init = "1";
          buildCounterForm(client, listing, b, counterFormEl, card, budgetEl, totalCounters);
        }
      });
      actionsEl.appendChild(counterBtn);
    }

    /* Message toggle */
    const msgBtn = document.createElement("button");
    msgBtn.className = "gr-btn gr-btn--ghost gr-btn--sm";
    msgBtn.textContent = "message";
    msgBtn.addEventListener("click", () => {
      msgAreaEl.classList.toggle("hidden");
      if (!msgAreaEl.dataset.init) {
        msgAreaEl.dataset.init = "1";
        buildOwnerMsgThread(client, listing.id, session.user.id, b.consultant_id, msgAreaEl);
      }
    });
    actionsEl.appendChild(msgBtn);

    list.appendChild(card);
  }
}

async function handleAcceptBid(client, session, listing, bid, card) {
  if (!confirm(`accept this bid of ${formatUsd(bid.amount_cents)}?`)) return;

  const { error } = await client.from("bids").update({
    status: "accepted",
    accepted_at: new Date().toISOString(),
  }).eq("id", bid.id);

  if (error) { alert(error.message); return; }

  await client.from("notifications").insert({
    user_id: bid.consultant_id,
    type: "bid_accepted",
    title: "your bid was accepted!",
    body: `your ${formatUsd(bid.amount_cents)} proposal for "${escapeHtml(listing.title)}" was accepted. the business is setting up kickoff availability now.`,
    link: engagementLink(bid.id),
  });

  window.location.href = engagementLink(bid.id);
}

function buildCounterForm(client, listing, bid, container, card, budgetEl, currentCount) {
  container.innerHTML = `
    <div class="ld-counter-form-inner">
      <label class="gr-label"><span>counter amount (usd)</span>
        <input type="number" class="ld-counter-amount" min="0.01" step="0.01" placeholder="0.00" />
      </label>
      <label class="gr-label full-width"><span>message (optional)</span>
        <textarea class="ld-counter-msg" rows="2" maxlength="500" placeholder="reason for the counter…"></textarea>
      </label>
      <button type="button" class="gr-btn gr-btn--primary gr-btn--sm ld-counter-send">send counter</button>
      <p class="gr-status ld-counter-status" aria-live="polite"></p>
    </div>
  `;

  const amtInput = container.querySelector(".ld-counter-amount");
  const msgInput = container.querySelector(".ld-counter-msg");
  const sendBtn = container.querySelector(".ld-counter-send");
  const statusEl = container.querySelector(".ld-counter-status");

  sendBtn.addEventListener("click", async () => {
    const cents = Math.round(parseFloat(amtInput.value) * 100);
    if (!Number.isFinite(cents) || cents < 1) {
      statusEl.textContent = "enter a valid amount."; statusEl.className = "gr-status error"; return;
    }
    sendBtn.disabled = true;

    const { error } = await client.from("bids").update({
      status: "countered",
      counter_offer_cents: cents,
      counter_offer_message: msgInput.value.trim() || null,
    }).eq("id", bid.id);

    if (error) {
      statusEl.textContent = error.message; statusEl.className = "gr-status error"; sendBtn.disabled = false; return;
    }

    await client.from("notifications").insert({
      user_id: bid.consultant_id,
      type: "counter_offer",
      title: "you received a counter-offer",
      body: `the owner of "${escapeHtml(listing.title)}" countered your bid with ${formatUsd(cents)}.`,
      link: `/listing.html?id=${listing.id}`,
    });

    window.location.reload();
  });
}

async function buildOwnerMsgThread(client, listingId, myId, consultantId, container) {
  container.innerHTML = `
    <div class="ld-msg-thread" id="msg-thread-${consultantId}"></div>
    <div class="ld-msg-compose">
      <textarea class="ld-msg-input" rows="2" placeholder="type a message…" maxlength="2000"></textarea>
      <button type="button" class="gr-btn gr-btn--primary gr-btn--sm ld-msg-send-btn">send</button>
    </div>
  `;

  const thread = container.querySelector(".ld-msg-thread");
  const input = container.querySelector(".ld-msg-input");
  const sendBtn = container.querySelector(".ld-msg-send-btn");

  const messages = await loadMessages(client, listingId, consultantId);
  renderMsgThread(thread, messages, myId);

  sendBtn.addEventListener("click", async () => {
    const body = input.value.trim();
    if (!body) return;
    sendBtn.disabled = true;

    const { error } = await client.from("messages").insert({
      listing_id: listingId, sender_id: myId, recipient_id: consultantId, body,
    });

    if (error) { console.error(error); sendBtn.disabled = false; return; }
    input.value = "";
    const bubble = document.createElement("div");
    bubble.className = "ld-msg-bubble ld-msg-bubble--mine";
    const time = new Date().toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
    bubble.innerHTML = `<p class="ld-msg-text">${escapeHtml(body)}</p><span class="ld-msg-time">${time}</span>`;
    thread.querySelector(".ld-msg-empty")?.remove();
    thread.appendChild(bubble);
    thread.scrollTop = thread.scrollHeight;
    sendBtn.disabled = false;
  });
}

/* ================================================================
   Init
   ================================================================ */

async function init() {
  const listingId = getListingId();
  if (!listingId) {
    gate.textContent = "no listing id provided.";
    gate.className = "gr-status error";
    return;
  }

  try {
    const client = await getSupabaseClient();
    initControlPanel(client);
    const { data: { session } } = await client.auth.getSession();
    const { listing, error } = await loadListing(client, listingId);

    if (error) { gate.textContent = error.message; gate.className = "gr-status error"; return; }
    if (!listing) { gate.textContent = "listing not found."; gate.className = "gr-status error"; return; }

    const { profile } = populateListing(listing);
    populateAvatarIfAvailable(client, profile);

    const uid = session?.user?.id ?? null;
    const isOwner = uid && listing.owner_id === uid;
    let hasExistingBid = false;

    if (uid && !isOwner) {
      const role = await loadSessionRole(client, uid);
      if (role === "consultant") {
        const { bid, available } = await loadMyBid(client, listingId);
        hasExistingBid = Boolean(bid);
        if (available) {
          if (getListingStatusLabel(listing.status) === "open" || bid) {
            showConsultantView(client, session, listing, bid);
          } else {
            showHint(`this listing is ${escapeHtml(getListingStatusLabel(listing.status))} and is not taking new offers right now.`);
          }
        } else {
          showHint("run <code>supabase/setup_v2.sql</code> to enable bidding.");
        }
      } else {
        showHint("only consultants can bid on listings.");
      }
    } else if (isOwner) {
      setupOwnerListingActions(client, listing);
      const { bids, available } = await loadOwnerBids(client, listingId);
      if (available) {
        const educationMap = await loadConsultantEducationMap(client, bids.map((b) => b.consultant_id));
        showOwnerBids(client, session, listing, bids, educationMap);
      }
    } else {
      showHint('<a href="/signin.html">sign in</a> as a consultant to submit a proposal.');
    }

    renderListingStatusBanner(listing, { isOwner, hasExistingBid });

    gate.hidden = true;
    detail.hidden = false;
  } catch (err) {
    gate.textContent = err.message || "could not load listing.";
    gate.className = "gr-status error";
  }
}

function showHint(html) {
  const el = document.getElementById("ld-auth-prompt");
  el.innerHTML = `<p class="gr-listing-hint">${html}</p>`;
  el.hidden = false;
}

init();
