import { getSupabaseClient } from "/supabase-loader.js";
import { formatBudgetRange } from "/sim-budget.js";

const form = document.getElementById("listing-form");
const gate = document.getElementById("gate");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("submit-btn");
const nextBtn = document.getElementById("next-btn");
const backBtn = document.getElementById("back-btn");

const slides = [...document.querySelectorAll(".cl-slide")];
const stepDots = [...document.querySelectorAll(".cl-progress__seg")];
const progressLabel = document.getElementById("cl-progress-label");
const STEP_LABELS = ["title", "description", "details"];
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

function getSelectedContractMode() {
  return String(form.elements.contract_type?.value || "standard").trim();
}

function getSelectedContractPhases() {
  return String(form.elements.contract_phases?.value || "proposal,solution")
    .split(",")
    .map((phase) => phase.trim())
    .filter(Boolean);
}

function isAdvancedContractSelected() {
  const mode = getSelectedContractMode();
  return mode === "phased" || mode === "retainer";
}

function isPhasedContractSelected() {
  return getSelectedContractMode() === "phased";
}

function isRetainerContractSelected() {
  return getSelectedContractMode() === "retainer";
}

function retainerTermsValue() {
  const radio = document.querySelector('input[name="retainer_terms"]:checked');
  return radio?.value || "fixed";
}

function hasMaintenancePhase() {
  return getSelectedContractPhases().includes("maintenance");
}

function isValidMaintenanceTerms(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  if (/^per business discretion\.?$/.test(normalized)) return true;
  return /\$\s*\d/.test(normalized) && /\bper\s+(hour|day|week|month)\b/.test(normalized) && /\bfor\b/.test(normalized);
}

function syncContractDetailFields() {
  const proposalWrap = document.getElementById("advanced-proposal-budget-wrap");
  const proposalInput = document.getElementById("proposal-budget");
  const maintenanceWrap = document.getElementById("maintenance-terms-wrap");
  const maintenanceInput = document.getElementById("maintenance-terms");
  const phasedSelected = isPhasedContractSelected();
  const maintenanceSelected = phasedSelected && hasMaintenancePhase();

  if (proposalWrap) proposalWrap.classList.toggle("hidden", !phasedSelected);
  if (proposalInput) {
    proposalInput.toggleAttribute("disabled", !phasedSelected);
    if (!phasedSelected) proposalInput.value = "";
  }

  if (maintenanceWrap) maintenanceWrap.classList.toggle("hidden", !maintenanceSelected);
  if (maintenanceInput) {
    maintenanceInput.toggleAttribute("disabled", !maintenanceSelected);
    if (!maintenanceSelected) maintenanceInput.value = "";
  }

  // Retainer: hide fee/cadence inputs when 'tentative' is picked.
  const retainerFields = document.getElementById("ct-retainer-fields");
  const tentative = retainerTermsValue() === "tentative";
  if (retainerFields) {
    retainerFields.classList.toggle("hidden", tentative);
    retainerFields.querySelectorAll("input, select").forEach((el) => {
      el.toggleAttribute("disabled", tentative);
      if (tentative && el.tagName === "INPUT") el.value = "";
    });
  }
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
    if (!title) throw new Error("please add a title for this opportunity.");
    return;
  }

  if (index === 1) {
    const issueContext = form.elements.issue_context.value.trim();
    const businessProblem = form.elements.business_problem.value.trim();
    const expectedOutput = form.elements.expected_output.value.trim();
    const proposalBudget = String(form.elements.proposal_budget?.value || "").trim();
    const maintenanceTerms = String(form.elements.maintenance_terms?.value || "").trim();
    if (!issueContext) throw new Error("please add the context behind the issue you want to solve.");
    if (!businessProblem) throw new Error("please describe the business problem you want to solve.");
    if (!expectedOutput) throw new Error("please explain the standards of work you expect from the consultant.");
    if (isPhasedContractSelected() && !proposalBudget) {
      throw new Error("please enter the budget per proposal for this advanced contract.");
    }
    if (isPhasedContractSelected() && Number(proposalBudget) < 0) {
      throw new Error("please enter a valid proposal budget.");
    }
    if (isPhasedContractSelected() && hasMaintenancePhase()) {
      if (!maintenanceTerms) {
        throw new Error('please outline the maintenance terms or write "per business discretion."');
      }
      if (!isValidMaintenanceTerms(maintenanceTerms)) {
        throw new Error('maintenance terms should look like "$X per hour/day/week/month for X [amount of time]" or "per business discretion."');
      }
    }
    if (isRetainerContractSelected() && retainerTermsValue() === "fixed") {
      const cadence = String(form.elements.retainer_cadence?.value || "").trim();
      const periods = Number(form.elements.retainer_period_count?.value || 0);
      const fee = Number(form.elements.retainer_fee?.value || 0);
      if (!cadence) throw new Error("please pick a retainer cadence.");
      if (!periods || periods < 1) throw new Error("please enter how many periods the retainer runs.");
      if (!fee || fee < 1) throw new Error("please enter the fee per period.");
    }
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

function buildStructuredListingDetails({
  contractType,
  budgetMin,
  budgetMax,
  issueContext,
  businessProblem,
  expectedOutput,
  proposalBudget,
  maintenanceTerms,
  additionalDetails,
}) {
  return [
    `contract type: ${contractType}`,
    `budget range: $${budgetMin} to $${budgetMax}`,
    ...(proposalBudget ? [`proposal budget: $${proposalBudget}`, ""] : []),
    "",
    "context:",
    issueContext,
    "",
    "business problem:",
    businessProblem,
    "",
    "standards of work:",
    expectedOutput,
    ...(maintenanceTerms ? ["", "maintenance terms:", maintenanceTerms] : []),
    ...(additionalDetails ? ["", "additional details:", additionalDetails] : []),
  ].join("\n");
}

function updatePreview() {
  // title
  const title = form.elements.title?.value.trim();
  pvTitle.textContent = title || "your opportunity title";
  pvTitle.classList.toggle("cl-preview__placeholder", !title);

  // tags: categories
  let chipsHtml = "";
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
    pvBudget.textContent = formatBudgetRange({ min: Number(bMin), max: Number(bMax) });
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
form.addEventListener("input", syncContractDetailFields);

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

/* ── Contract type / chain builder ──────────────────────── */
(function setupContractType() {
  const advancedDetails = document.getElementById("ct-advanced");
  const standardRadio = document.querySelector('input[name="contract_type"][value="standard"]');
  const phasedRadio = document.getElementById("ct-phased-radio");
  const retainerRadio = document.getElementById("ct-retainer-radio");
  const phasesInput = document.getElementById("ct-phases");
  const toggleBtn = document.getElementById("ct-add-maintenance");
  const maintConnector = document.getElementById("ct-chain-connector-maintenance");
  const builderHint = document.getElementById("ct-builder-hint");
  const builderArea = advancedDetails ? advancedDetails.querySelector(".ct-builder") : null;
  const retainerGroup = document.querySelector('.ct-suboption-group[data-mode="retainer"]');

  if (!advancedDetails || !phasedRadio || !retainerRadio || !toggleBtn) return;

  const labelEl = toggleBtn.querySelector(".ct-chain__add-label");
  const hintEl = toggleBtn.querySelector(".ct-chain__add-hint");

  function syncPhases(hasMaintenance) {
    const phases = ["proposal", "solution"];
    if (hasMaintenance) phases.push("maintenance");
    phasesInput.value = phases.join(",");
    syncContractDetailFields();
  }

  function selectPhased() {
    phasedRadio.checked = true;
    if (!advancedDetails.open) advancedDetails.open = true;
    syncContractDetailFields();
  }

  function selectRetainer() {
    retainerRadio.checked = true;
    if (!advancedDetails.open) advancedDetails.open = true;
    syncContractDetailFields();
  }

  function setMaintenance(present) {
    toggleBtn.setAttribute("aria-pressed", present ? "true" : "false");
    if (present) {
      maintConnector.removeAttribute("hidden");
      if (labelEl) labelEl.textContent = "maintenance added";
      if (hintEl) hintEl.textContent = "remove";
      builderHint.innerHTML = "maintenance extends your chain with ongoing support. click again to remove.";
    } else {
      maintConnector.setAttribute("hidden", "");
      if (labelEl) labelEl.textContent = "add maintenance";
      if (hintEl) hintEl.textContent = "optional";
      builderHint.innerHTML = "maintenance is an optional follow-on phase for ongoing support.";
    }
    syncPhases(present);
  }

  toggleBtn.addEventListener("click", () => {
    const currentlyOn = toggleBtn.getAttribute("aria-pressed") === "true";
    setMaintenance(!currentlyOn);
    selectPhased();
  });

  standardRadio.addEventListener("change", () => {
    if (standardRadio.checked) {
      advancedDetails.open = false;
      syncContractDetailFields();
    }
  });

  standardRadio.closest("label").addEventListener("click", () => {
    standardRadio.checked = true;
    syncContractDetailFields();
  });

  // clicking anywhere inside the phased builder selects phased
  if (builderArea) {
    builderArea.addEventListener("click", () => selectPhased());
  }

  // clicking anywhere inside the retainer group selects retainer
  if (retainerGroup) {
    retainerGroup.addEventListener("click", () => selectRetainer());
  }

  // keep details open when a sub-option is chosen via keyboard/label
  phasedRadio.addEventListener("change", () => {
    if (phasedRadio.checked && !advancedDetails.open) advancedDetails.open = true;
    syncContractDetailFields();
  });
  retainerRadio.addEventListener("change", () => {
    if (retainerRadio.checked && !advancedDetails.open) advancedDetails.open = true;
    syncContractDetailFields();
  });

  syncPhases(false);
  syncContractDetailFields();
})();

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
    // Radios emit one of 'standard' | 'phased' | 'retainer'. (The legacy
    // 'advanced' branch below is a no-op; left in so the details summary
    // builder still reads contractType for display.)
    const contractMode = String(fd.get("contract_type") || "standard").trim();
    const contractPhases = String(fd.get("contract_phases") || "proposal,solution").trim();
    const contractType = contractMode === "advanced" ? contractPhases : contractMode;
    const budgetMin = Number(fd.get("budget_min"));
    const budgetMax = Number(fd.get("budget_max"));

    submitBtn.disabled = true;
    submitBtn.textContent = "creating…";

    const issueContext = String(fd.get("issue_context") || "").trim();
    const businessProblem = String(fd.get("business_problem") || "").trim();
    const expectedOutput = String(fd.get("expected_output") || "").trim();
    const proposalBudget = String(fd.get("proposal_budget") || "").trim();
    const maintenanceTerms = String(fd.get("maintenance_terms") || "").trim();
    const additionalDetails = String(fd.get("additional_details") || "").trim();
    const details = buildStructuredListingDetails({
      contractType,
      budgetMin,
      budgetMax,
      issueContext,
      businessProblem,
      expectedOutput,
      proposalBudget,
      maintenanceTerms,
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
      // Structured contract metadata. proposal_budget + maintenance_terms
      // only apply when contract_type='phased'; null otherwise so we don't
      // mislead the offer form.
      contract_type: contractMode,
      proposal_budget: contractMode === "phased" && proposalBudget
        ? parseInt(proposalBudget, 10)
        : null,
      maintenance_terms: contractMode === "phased" && maintenanceTerms ? maintenanceTerms : null,
    };

    // Retainer terms — only when contract_type='retainer'. 'tentative' means
    // cadence/period_count/fee_cents stay null and are negotiated later.
    if (contractMode === "retainer") {
      const retainerTerms = retainerTermsValue();
      payload.retainer_terms = retainerTerms;
      if (retainerTerms === "fixed") {
        payload.retainer_cadence = String(fd.get("retainer_cadence") || "monthly");
        payload.retainer_period_count = parseInt(String(fd.get("retainer_period_count") || "0"), 10) || null;
        const fee = Number(fd.get("retainer_fee"));
        payload.retainer_fee_cents = Number.isFinite(fee) ? Math.round(fee * 100) : null;
      }
    }

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

    // Geocode the listing in the background — non-fatal if it fails.
    // The endpoint reads business_address off the owner's profile and
    // writes lat/lng back to the listing. Result feeds the marketplace
    // "local" bucket on the consultant side. We don't await this; the
    // create flow finishes immediately and geocode completes inline.
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        await fetch(`/api/listings/${encodeURIComponent(data.id)}/geocode`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch (_) { /* non-fatal */ }
    })();

    statusEl.textContent = "opportunity created.";
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
