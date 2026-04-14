import { getSupabaseClient } from "/supabase-loader.js";
import { initControlPanel } from "/control-panel.js";
import { formatBudgetRange, scaleBudgetRange } from "/sim-budget.js";

const form = document.getElementById("listing-form");
const gate = document.getElementById("gate");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submit-btn");
const nextBtn = document.getElementById("next-btn");
const backBtn = document.getElementById("back-btn");

const slides = [...document.querySelectorAll(".cl-slide")];
const stepDots = [...document.querySelectorAll(".cl-progress__seg")];
const progressLabel = document.getElementById("cl-progress-label");
const STEP_LABELS = ["title & type", "description", "details"];
const typeButtons = [...document.querySelectorAll(".op-type-btn")];
const typeHidden = document.getElementById("opportunity-type-hidden");
const typeOtherWrap = document.getElementById("opportunity-other-wrap");
const typeOtherInput = document.getElementById("opportunity-type-other");
const infoToggle = document.getElementById("opportunity-info-toggle");
const infoPanel = document.getElementById("opportunity-info");
const attachmentInput = document.getElementById("listing-attachments");
const attachmentList = document.getElementById("cl-file-list");

const searchEl = document.getElementById("cat-search");
const dropdownEl = document.getElementById("cat-dropdown");
const catTags = document.getElementById("cat-tags");
const selectedCategories = new Set();

const qualList = document.getElementById("qual-list");
const addQualBtn = document.getElementById("add-qual-btn");

const splitEl = document.getElementById("cl-split");

// preview elements
const pvTitle = document.getElementById("pv-title");
const pvMeta = document.getElementById("pv-meta");
const pvChips = document.getElementById("pv-chips");
const pvContext = document.getElementById("pv-context");
const pvContextSection = document.getElementById("pv-context-section");
const pvProblem = document.getElementById("pv-problem");
const pvProblemSection = document.getElementById("pv-problem-section");
const pvOutput = document.getElementById("pv-output");
const pvOutputSection = document.getElementById("pv-output-section");
const pvDetails = document.getElementById("pv-details");
const pvDetailsSection = document.getElementById("pv-details-section");
const pvAttachments = document.getElementById("pv-attachments");
const pvQuals = document.getElementById("pv-quals");
const pvQualsSection = document.getElementById("pv-quals-section");
const pvBudget = document.getElementById("pv-budget");
const pvBudgetSection = document.getElementById("pv-budget-section");
const pvTurnaround = document.getElementById("pv-turnaround");
const pvTurnaroundSection = document.getElementById("pv-turnaround-section");
const pvBizOwner = document.getElementById("pv-biz-owner");
const pvBizName = document.getElementById("pv-biz-name");
const pvBizWebsite = document.getElementById("pv-biz-website");
const pvBizSocials = document.getElementById("pv-biz-socials");
const pvBizAbout = document.getElementById("pv-biz-about");
const pvBizAvatarWrap = document.getElementById("pv-biz-avatar-wrap");
const pvBizAvatar = document.getElementById("pv-biz-avatar");

let supabase;
let userId;
let currentSlide = 0;
let bizProfile = null;
let selectedAttachments = [];

const MAX_ATTACHMENT_COUNT = 3;
const MAX_ATTACHMENT_SIZE = 5 * 1024 * 1024;
const MAX_ATTACHMENT_TOTAL = 12 * 1024 * 1024;

const CATEGORY_OPTIONS = [
  { value: "social media", label: "social media", icon: socialIcon() },
  { value: "finance", label: "finance", icon: financeIcon() },
  { value: "marketing", label: "marketing", icon: megaphoneIcon() },
  { value: "operations", label: "operations", icon: operationsIcon() },
  { value: "website", label: "website", icon: websiteIcon() },
  { value: "branding", label: "branding", icon: sparkIcon() },
  { value: "sales", label: "sales", icon: salesIcon() },
  { value: "customer service", label: "customer service", icon: supportIcon() },
  { value: "human resources", label: "human resources", icon: peopleIcon() },
  { value: "legal", label: "legal", icon: legalIcon() },
  { value: "supply chain", label: "supply chain", icon: supplyIcon() },
  { value: "data analytics", label: "data analytics", icon: analyticsIcon() },
  { value: "product development", label: "product development", icon: productIcon() },
  { value: "public relations", label: "public relations", icon: prIcon() },
  { value: "strategy", label: "strategy", icon: compassIcon() },
];

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sanitizeFileName(name) {
  return String(name || "file").replace(/[^a-zA-Z0-9._-]/g, "_");
}

function formatFileSize(bytes) {
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return "0 b";
  if (value < 1024) return `${value} b`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} kb`;
  return `${(value / (1024 * 1024)).toFixed(1)} mb`;
}

function attachmentKindLabel(file) {
  const type = String(file?.type || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (type === "application/pdf") return "pdf";
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (type.includes("sheet") || type.includes("excel") || type.includes("csv")) return "spreadsheet";
  if (type.includes("presentation") || type.includes("powerpoint")) return "presentation";
  if (type.includes("word") || type.includes("document")) return "document";
  return "file";
}

function validateAttachmentSelection(files) {
  if (files.length > MAX_ATTACHMENT_COUNT) {
    throw new Error(
      `please keep attachments to ${MAX_ATTACHMENT_COUNT} files max. if you have more, combine them into a pdf or add links in the details.`
    );
  }

  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > MAX_ATTACHMENT_TOTAL) {
    throw new Error(
      "attachments are limited to 12 mb total. please use pdfs, compress the files, or include links in the additional details."
    );
  }

  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_SIZE) {
      throw new Error(
        `${file.name} is larger than 5 mb. please use a smaller pdf, compress it, or include a link instead.`
      );
    }
  }
}

function renderAttachmentSelection() {
  if (!attachmentList) return;
  if (!selectedAttachments.length) {
    attachmentList.innerHTML = "";
    attachmentList.classList.add("hidden");
    return;
  }

  attachmentList.innerHTML = selectedAttachments
    .map((file, index) => `
      <div class="cl-file-chip">
        <div class="cl-file-chip__meta">
          <span class="cl-file-chip__name">${escapeHtml(file.name)}</span>
          <span class="cl-file-chip__detail">${escapeHtml(attachmentKindLabel(file))} · ${escapeHtml(formatFileSize(file.size))}</span>
        </div>
        <button type="button" class="cl-file-chip__remove" data-remove-attachment="${index}" aria-label="remove ${escapeHtml(file.name)}">&times;</button>
      </div>
    `)
    .join("");
  attachmentList.classList.remove("hidden");

  attachmentList.querySelectorAll("[data-remove-attachment]").forEach((button) => {
    button.addEventListener("click", () => {
      const index = Number(button.dataset.removeAttachment);
      selectedAttachments = selectedAttachments.filter((_, itemIndex) => itemIndex !== index);
      if (attachmentInput) attachmentInput.value = "";
      renderAttachmentSelection();
      updatePreview();
    });
  });
}

function renderAttachmentPreview() {
  if (!pvAttachments) return;
  if (!selectedAttachments.length) {
    pvAttachments.innerHTML = "";
    pvAttachments.classList.add("hidden");
    return;
  }

  pvAttachments.innerHTML = selectedAttachments
    .map((file) => `
      <div class="cl-preview-attachment">
        <span class="cl-preview-attachment__name">${escapeHtml(file.name)}</span>
        <span class="cl-preview-attachment__detail">${escapeHtml(attachmentKindLabel(file))} · ${escapeHtml(formatFileSize(file.size))}</span>
      </div>
    `)
    .join("");
  pvAttachments.classList.remove("hidden");
}

function getAttachmentMetadataFromFile(file, listingId) {
  const safeName = sanitizeFileName(file.name);
  const path = `${userId}/${listingId}/${Date.now()}-${safeName}`;
  return {
    file,
    name: file.name,
    size: file.size,
    contentType: file.type || "application/octet-stream",
    kind: attachmentKindLabel(file),
    path,
  };
}

async function uploadListingAttachments(listingId) {
  if (!selectedAttachments.length) return [];
  const uploadedPaths = [];

  try {
    const metadataRows = [];
    for (const file of selectedAttachments) {
      const meta = getAttachmentMetadataFromFile(file, listingId);
      const { error } = await supabase.storage.from("listing_attachments").upload(meta.path, meta.file, {
        contentType: meta.contentType,
        upsert: false,
      });
      if (error) throw error;
      uploadedPaths.push(meta.path);
      const { data } = supabase.storage.from("listing_attachments").getPublicUrl(meta.path);
      metadataRows.push({
        name: meta.name,
        path: meta.path,
        size: meta.size,
        content_type: meta.contentType,
        kind: meta.kind,
        public_url: data?.publicUrl || "",
      });
    }
    return metadataRows;
  } catch (error) {
    if (uploadedPaths.length) {
      try {
        await supabase.storage.from("listing_attachments").remove(uploadedPaths);
      } catch (cleanupError) {
        console.warn("listing attachment cleanup failed:", cleanupError);
      }
    }
    throw error;
  }
}

function getCategory(value) {
  return CATEGORY_OPTIONS.find((option) => option.value === value) || null;
}

function renderCategoryDropdown() {
  const query = searchEl.value.trim().toLowerCase();
  const filtered = CATEGORY_OPTIONS.filter((option) => option.label.includes(query));

  if (!filtered.length) {
    dropdownEl.innerHTML = '<div class="ms-empty">no matches</div>';
    dropdownEl.classList.remove("hidden");
    return;
  }

  dropdownEl.innerHTML = filtered
    .map((option) => {
      const selectedClass = selectedCategories.has(option.value) ? " is-selected" : "";
      return `
        <button type="button" class="ms-option${selectedClass}" data-category="${escapeHtml(option.value)}">
          <span class="ms-option__icon" aria-hidden="true">${option.icon}</span>
          <span class="ms-option__label">${escapeHtml(option.label)}</span>
        </button>
      `;
    })
    .join("");

  dropdownEl.querySelectorAll("[data-category]").forEach((button) => {
    button.addEventListener("click", () => {
      toggleCategory(button.dataset.category);
    });
  });

  dropdownEl.classList.remove("hidden");
}

function toggleCategory(value) {
  if (selectedCategories.has(value)) {
    selectedCategories.delete(value);
  } else {
    selectedCategories.add(value);
  }
  renderCategoryTags();
  renderCategoryDropdown();
  updatePreview();
}

function renderCategoryTags() {
  catTags.innerHTML = [...selectedCategories]
    .map((value) => {
      const option = getCategory(value);
      if (!option) return "";
      return `
        <span class="cl-cat-tag">
          <span class="cl-cat-tag__icon" aria-hidden="true">${option.icon}</span>
          ${escapeHtml(option.label)}
          <button type="button" class="cl-cat-tag__remove" data-remove-cat="${escapeHtml(value)}" aria-label="remove ${escapeHtml(option.label)}">&times;</button>
        </span>
      `;
    })
    .join("");

  catTags.querySelectorAll("[data-remove-cat]").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleCategory(btn.dataset.removeCat);
    });
  });
}

function setOpportunityType(value) {
  typeHidden.value = value;
  typeButtons.forEach((button) => {
    button.classList.toggle("is-selected", button.dataset.opportunityType === value);
  });

  const isOther = value === "other";
  typeOtherWrap.classList.toggle("hidden", !isOther);
  typeOtherInput.toggleAttribute("required", isOther);
  if (!isOther) typeOtherInput.value = "";
  updatePreview();
}

function updateWizardUI() {
  slides.forEach((slide, index) => {
    const isActive = index === currentSlide;
    slide.classList.toggle("cl-slide--active", isActive);
    if (!isActive) slide.classList.remove("cl-slide--active");
  });

  stepDots.forEach((seg, index) => {
    seg.classList.toggle("is-done", index < currentSlide);
    seg.classList.toggle("is-active", index === currentSlide);
  });

  progressLabel.textContent = STEP_LABELS[currentSlide] || "";

  backBtn.classList.toggle("hidden", currentSlide === 0);
  nextBtn.classList.toggle("hidden", currentSlide === slides.length - 1);
  submitBtn.classList.toggle("hidden", currentSlide !== slides.length - 1);
}

function validateSlide(index) {
  statusEl.textContent = "";
  statusEl.className = "gr-status";

  if (index === 0) {
    const title = form.elements.title.value.trim();
    const type = typeHidden.value.trim();
    const typeOther = typeOtherInput.value.trim();

    if (!title) throw new Error("please add a title for this opportunity.");
    if (!type) throw new Error("please choose the type of opportunity.");
    if (type === "other" && !typeOther) throw new Error("please describe the opportunity type.");
    return;
  }

  if (index === 1) {
    const issueContext = form.elements.issue_context.value.trim();
    const businessProblem = form.elements.business_problem.value.trim();
    const expectedOutput = form.elements.expected_output.value.trim();
    if (!issueContext) throw new Error("please add the context behind the issue you want to solve.");
    if (!businessProblem) throw new Error("please describe the business problem you want to solve.");
    if (!expectedOutput) throw new Error("please explain what output you expect from the consultant.");
    return;
  }

  if (index === 2) {
    const budgetMin = Number(form.elements.budget_min.value);
    const budgetMax = Number(form.elements.budget_max.value);
    const turnaround = Number(form.elements.turnaround_days.value);

    if (!selectedCategories.size) throw new Error("please choose at least one category.");
    if (!budgetMin || !budgetMax) throw new Error("please enter the full budget range.");
    if (budgetMin > budgetMax) throw new Error("please make sure the budget range goes from low to high.");
    if (!turnaround) throw new Error("please enter the turnaround time.");
  }
}

async function boot() {
  try {
    supabase = await getSupabaseClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.user) {
      window.location.href = "/signin.html?next=" + encodeURIComponent("/create-listing.html");
      return;
    }

    userId = session.user.id;
    initControlPanel(supabase);

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, full_name, avatar_path, business_profiles(business_name, website_url, instagram_url, facebook_url, company_linkedin_url, business_details)")
      .eq("id", userId)
      .single();

    if (profile?.role !== "business_owner") {
      gate.textContent = "only business owners can create listings.";
      gate.className = "gr-status error";
      return;
    }

    bizProfile = {
      ownerName: profile.full_name || "",
      avatarPath: profile.avatar_path || null,
      ...(profile.business_profiles || {}),
    };

    populatePreviewBiz();
    renderAttachmentSelection();
    updatePreview();

    gate.textContent = "";
    splitEl.classList.remove("hidden");
    updateWizardUI();
  } catch (err) {
    gate.textContent = err.message || "could not connect.";
    gate.className = "gr-status error";
  }
}

function populatePreviewBiz() {
  if (!bizProfile) return;

  pvBizOwner.textContent = bizProfile.ownerName || "you";

  if (bizProfile.business_name) {
    pvBizName.textContent = bizProfile.business_name;
    pvBizName.hidden = false;
  }

  if (bizProfile.website_url) {
    pvBizWebsite.href = bizProfile.website_url;
    pvBizWebsite.hidden = false;
  }

  const socials = [
    bizProfile.instagram_url,
    bizProfile.facebook_url,
    bizProfile.company_linkedin_url,
  ].filter(Boolean);

  if (socials.length) {
    const socialSvgs = {
      instagram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="5"/><circle cx="12" cy="12" r="5"/><circle cx="17.5" cy="6.5" r="1.2"/></svg>',
      facebook: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/></svg>',
      linkedin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-4 0v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/></svg>',
    };
    pvBizSocials.innerHTML = socials
      .map((url) => {
        const platform = url.includes("instagram") ? "instagram" : url.includes("facebook") ? "facebook" : "linkedin";
        return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${platform}">${socialSvgs[platform]}</a>`;
      })
      .join("");
    pvBizSocials.hidden = false;
  }

  if (bizProfile.business_details) {
    pvBizAbout.textContent = bizProfile.business_details;
    pvBizAbout.hidden = false;
  }

  if (bizProfile.avatarPath) {
    const { data } = supabase.storage.from("avatars").getPublicUrl(bizProfile.avatarPath);
    if (data?.publicUrl) {
      pvBizAvatar.src = data.publicUrl;
      pvBizAvatarWrap.hidden = false;
    }
  }
}

function typeTagSvg(type) {
  const icons = {
    do: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>',
    develop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="8"/><path d="m9 15 2-6 6-2-2 6-6 2Z"/></svg>',
  };
  return icons[type] || "";
}

function buildStructuredListingDetails({
  opportunityType,
  budgetMin,
  budgetMax,
  issueContext,
  businessProblem,
  expectedOutput,
  additionalDetails,
}) {
  return [
    `opportunity type: ${opportunityType}`,
    `budget range: $${budgetMin} to $${budgetMax}`,
    "",
    "issue context:",
    issueContext,
    "",
    "business problem:",
    businessProblem,
    "",
    "expected output:",
    expectedOutput,
    ...(additionalDetails ? ["", "additional details:", additionalDetails] : []),
  ].join("\n");
}

function updatePreview() {
  // title
  const title = form.elements.title?.value.trim();
  pvTitle.textContent = title || "your opportunity title";
  pvTitle.classList.toggle("cl-preview__placeholder", !title);

  // tags: opportunity type + categories
  let chipsHtml = "";
  const typeVal = typeHidden.value.trim();
  const typeLabel = typeVal === "other" ? typeOtherInput.value.trim() : typeVal;
  if (typeLabel) {
    const icon = typeTagSvg(typeLabel);
    chipsHtml += `<span class="cl-preview__chip cl-preview__chip--type">${icon ? icon + " " : ""}${escapeHtml(typeLabel)}</span>`;
  }
  [...selectedCategories].forEach((c) => {
    chipsHtml += `<span class="cl-preview__chip">${escapeHtml(c)}</span>`;
  });
  pvChips.innerHTML = chipsHtml;

  // turnaround (inline in meta)
  const days = form.elements.turnaround_days?.value;
  if (days) {
    pvTurnaround.textContent = `${days} day${Number(days) === 1 ? "" : "s"} turnaround`;
    pvTurnaround.hidden = false;
  } else {
    pvTurnaround.hidden = true;
  }

  // issue context
  const issueContext = form.elements.issue_context?.value.trim();
  if (issueContext) {
    pvContext.textContent = issueContext;
    pvContextSection.hidden = false;
  } else {
    pvContextSection.hidden = true;
  }

  // business problem
  const businessProblem = form.elements.business_problem?.value.trim();
  if (businessProblem) {
    pvProblem.textContent = businessProblem;
    pvProblemSection.hidden = false;
  } else {
    pvProblemSection.hidden = true;
  }

  // expected output
  const expectedOutput = form.elements.expected_output?.value.trim();
  if (expectedOutput) {
    pvOutput.textContent = expectedOutput;
    pvOutputSection.hidden = false;
  } else {
    pvOutputSection.hidden = true;
  }

  // additional details
  const details = form.elements.additional_details?.value.trim();
  if (details) {
    pvDetails.textContent = details;
    pvDetails.hidden = false;
  } else {
    pvDetails.textContent = "";
    pvDetails.hidden = true;
  }
  renderAttachmentPreview();
  pvDetailsSection.hidden = !details && !selectedAttachments.length;

  // qualifications
  const quals = [...qualList.querySelectorAll("input")]
    .map((i) => i.value.trim())
    .filter(Boolean);
  if (quals.length) {
    pvQuals.innerHTML = quals.map((q) => `<li>${escapeHtml(q)}</li>`).join("");
    pvQualsSection.hidden = false;
  } else {
    pvQualsSection.hidden = true;
  }

  // budget
  const bMin = form.elements.budget_min?.value;
  const bMax = form.elements.budget_max?.value;
  if (bMin && bMax) {
    const simulatedRange = scaleBudgetRange({
      min: Number(bMin),
      max: Number(bMax),
    });
    pvBudget.textContent = formatBudgetRange(simulatedRange);
    pvBudgetSection.hidden = false;
  } else if (bMin || bMax) {
    pvBudget.textContent = bMin ? `from $${Number(bMin).toLocaleString()}` : `up to $${Number(bMax).toLocaleString()}`;
    pvBudgetSection.hidden = false;
  } else {
    pvBudgetSection.hidden = true;
  }
}

// listen for input changes across the form to update preview live
form.addEventListener("input", updatePreview);

if (attachmentInput) {
  attachmentInput.addEventListener("change", () => {
    try {
      const files = [...(attachmentInput.files || [])];
      validateAttachmentSelection(files);
      selectedAttachments = files;
      renderAttachmentSelection();
      updatePreview();
      statusEl.textContent = "";
      statusEl.className = "gr-status";
    } catch (error) {
      attachmentInput.value = "";
      selectedAttachments = [];
      renderAttachmentSelection();
      updatePreview();
      statusEl.textContent = error.message || "could not add those attachments.";
      statusEl.className = "gr-status error";
    }
  });
}

nextBtn.addEventListener("click", () => {
  try {
    validateSlide(currentSlide);
    currentSlide = Math.min(currentSlide + 1, slides.length - 1);
    updateWizardUI();
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "gr-status error";
  }
});

backBtn.addEventListener("click", () => {
  statusEl.textContent = "";
  statusEl.className = "gr-status";
  currentSlide = Math.max(currentSlide - 1, 0);
  updateWizardUI();
});

typeButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setOpportunityType(button.dataset.opportunityType);
  });
});

infoToggle.addEventListener("click", () => {
  const willOpen = infoPanel.classList.contains("hidden");
  infoPanel.classList.toggle("hidden", !willOpen);
  infoToggle.setAttribute("aria-expanded", String(willOpen));
});

addQualBtn.addEventListener("click", () => {
  const row = document.createElement("div");
  row.className = "cl-qual-row";
  row.innerHTML =
    '<input type="text" name="qual[]" maxlength="120" placeholder="e.g. experience with Shopify" class="cl-qual-input" />' +
    '<button type="button" class="cl-qual-remove" aria-label="remove">&times;</button>';
  row.querySelector(".cl-qual-remove").addEventListener("click", () => { row.remove(); updatePreview(); });
  row.querySelector("input").addEventListener("input", updatePreview);
  qualList.appendChild(row);
  row.querySelector("input").focus();
});

searchEl.addEventListener("focus", renderCategoryDropdown);
searchEl.addEventListener("input", renderCategoryDropdown);

document.addEventListener("click", (event) => {
  if (!event.target.closest("#cat-multiselect")) {
    dropdownEl.classList.add("hidden");
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "";
  statusEl.className = "gr-status";

  try {
    validateSlide(0);
    validateSlide(1);
    validateSlide(2);
    validateAttachmentSelection(selectedAttachments);

    const fd = new FormData(form);
    const budgetMin = Number(fd.get("budget_min"));
    const budgetMax = Number(fd.get("budget_max"));
    const opportunityTypeRaw = String(fd.get("opportunity_type") || "").trim();
    const opportunityType =
      opportunityTypeRaw === "other"
        ? String(fd.get("opportunity_type_other") || "").trim()
        : opportunityTypeRaw;

    submitBtn.disabled = true;
    submitBtn.textContent = "creating…";

    const issueContext = String(fd.get("issue_context") || "").trim();
    const businessProblem = String(fd.get("business_problem") || "").trim();
    const expectedOutput = String(fd.get("expected_output") || "").trim();
    const additionalDetails = String(fd.get("additional_details") || "").trim();
    const details = buildStructuredListingDetails({
      opportunityType,
      budgetMin,
      budgetMax,
      issueContext,
      businessProblem,
      expectedOutput,
      additionalDetails,
    });

    const payload = {
      owner_id: userId,
      title: String(fd.get("title") || "").trim(),
      category: [...selectedCategories].join(", ") || null,
      budget_cents: Math.round(budgetMax * 100),
      problem_summary: businessProblem,
      details: details || null,
      qualifications_required: [...qualList.querySelectorAll("input")]
        .map((i) => i.value.trim())
        .filter(Boolean)
        .join("\n") || null,
      turnaround_days: parseInt(String(fd.get("turnaround_days") || "0"), 10),
      status: "open",
    };

    const { data, error } = await supabase.from("listings").insert(payload).select("id").single();
    if (error) throw error;

    try {
      const attachments = await uploadListingAttachments(data.id);
      if (attachments.length) {
        const { error: updateError } = await supabase
          .from("listings")
          .update({ attachments })
          .eq("id", data.id);
        if (updateError) throw updateError;
      }
    } catch (attachmentError) {
      try {
        const { error: deleteError } = await supabase.from("listings").delete().eq("id", data.id);
        if (deleteError) {
          console.warn("listing rollback failed:", deleteError);
        }
      } catch (deleteError) {
        console.warn("listing rollback failed:", deleteError);
      }
      throw attachmentError;
    }

    statusEl.textContent = "opportunity created!";
    statusEl.className = "gr-status success";

    setTimeout(() => {
      window.location.href = `/listing.html?id=${data.id}`;
    }, 800);
  } catch (err) {
    statusEl.textContent = err.message || "could not create opportunity.";
    statusEl.className = "gr-status error";
    submitBtn.disabled = false;
    submitBtn.textContent = "create opportunity";
  }
});

boot();

function svgIcon(paths) {
  return `
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      ${paths}
    </svg>
  `;
}

function socialIcon() {
  return svgIcon('<path d="M6 18V8.5A2.5 2.5 0 0 1 8.5 6H18"/><path d="M14 4h6v6"/><path d="M8 14c1.2-1.8 3.2-3 5.5-3 1.6 0 3 .5 4.5 1.8"/><circle cx="8" cy="16.5" r="1.4"/><circle cx="16.5" cy="13.5" r="1.4"/>');
}

function financeIcon() {
  return svgIcon('<path d="M12 3v18"/><path d="M16 7.5c0-1.7-1.8-3-4-3s-4 1.3-4 3 1.8 3 4 3 4 1.3 4 3-1.8 3-4 3-4-1.3-4-3"/>');
}

function megaphoneIcon() {
  return svgIcon('<path d="M4 13v-2l10-5v12L4 13Z"/><path d="M14 9h3a3 3 0 0 1 0 6h-3"/><path d="m6.5 14 1.8 4.5"/>');
}

function operationsIcon() {
  return svgIcon('<rect x="4" y="5" width="6" height="6" rx="1.5"/><rect x="14" y="5" width="6" height="6" rx="1.5"/><rect x="9" y="13" width="6" height="6" rx="1.5"/><path d="M10 8h4"/><path d="M12 11v2"/>');
}

function websiteIcon() {
  return svgIcon('<rect x="3.5" y="5" width="17" height="14" rx="2"/><path d="M3.5 9h17"/><path d="M8 5v14"/><path d="M12 12h5"/><path d="M12 15h3"/>');
}

function sparkIcon() {
  return svgIcon('<path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z"/><path d="m18.5 14 0.8 2.2 2.2 0.8-2.2 0.8-0.8 2.2-0.8-2.2-2.2-0.8 2.2-0.8 0.8-2.2Z"/>');
}

function salesIcon() {
  return svgIcon('<path d="M5 18V9"/><path d="M10 18V6"/><path d="M15 18v-4"/><path d="M20 18V11"/><path d="m5 7 4-2 5 3 5-3"/>');
}

function supportIcon() {
  return svgIcon('<path d="M5 13a7 7 0 0 1 14 0"/><rect x="4" y="12" width="3" height="6" rx="1.5"/><rect x="17" y="12" width="3" height="6" rx="1.5"/><path d="M12 20h2.5a2 2 0 0 0 2-2"/>');
}

function peopleIcon() {
  return svgIcon('<circle cx="9" cy="9" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M4.5 19a4.5 4.5 0 0 1 9 0"/><path d="M14.5 19a3.5 3.5 0 0 1 5.5-2.8"/>');
}

function legalIcon() {
  return svgIcon('<path d="M12 4v16"/><path d="M7 7h10"/><path d="m8 7-3 5h6l-3-5Z"/><path d="m16 7-3 5h6l-3-5Z"/><path d="M8 20h8"/>');
}

function supplyIcon() {
  return svgIcon('<path d="M4 8.5 12 4l8 4.5v7L12 20l-8-4.5v-7Z"/><path d="M12 20v-7"/><path d="m4.5 8.8 7.5 4.2 7.5-4.2"/>');
}

function analyticsIcon() {
  return svgIcon('<path d="M4 19h16"/><path d="M7 16v-4"/><path d="M12 16V8"/><path d="M17 16v-6"/><path d="m6 8 3-2 3 1 5-3"/>');
}

function productIcon() {
  return svgIcon('<path d="M12 3 5 7v10l7 4 7-4V7l-7-4Z"/><path d="m5 7 7 4 7-4"/><path d="M12 11v10"/>');
}

function prIcon() {
  return svgIcon('<path d="M5 18V6l9 2v8l-9 2Z"/><path d="M14 9h4a2 2 0 0 1 0 4h-4"/><path d="M7 20v-2"/>');
}

function compassIcon() {
  return svgIcon('<circle cx="12" cy="12" r="8"/><path d="m9 15 2-6 6-2-2 6-6 2Z"/><circle cx="12" cy="12" r="1"/>');
}
