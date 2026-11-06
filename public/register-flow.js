import { getSupabaseClient } from "/supabase-loader.js";
import { wireSchoolAutocomplete, preloadSchools, matchCachedSchoolEmail, primaryDomainFor } from "/school-autocomplete.js";
import { wireAllCityAutocompletes } from "/city-autocomplete.js";
import { clearGuestMode } from "/guest-mode.js";
// OAuth is paused until providers are configured in supabase. The
// /oauth.js renderer and the /api/oauth-complete endpoint stay intact;
// re-add the post-OAuth branches here when re-enabling.

const form = document.getElementById("registration-form");
const statusEl = document.getElementById("status");
const backBtn = document.getElementById("reg-back");
const nextBtn = document.getElementById("reg-next");
const submitBtn = document.getElementById("reg-submit");
const progressLabel = document.getElementById("reg-progress-label");
const progressTrack = document.getElementById("reg-progress-track");
const roleField = document.getElementById("field-role");

const inviteToken = new URLSearchParams(window.location.search).get("invite") || "";
let inviteMode = false;

// Steps are dynamic based on role selection; start with base
let STEP_LABELS = ["Pick your path", "Account details"];
let STEPS = [0, 1];

let currentStep = 0;
let selectedRole = "";

const slides = document.querySelectorAll("[data-reg-slide]");
const segments = progressTrack.querySelectorAll(".reg-progress__seg");
const steppedFields = [...form.querySelectorAll("[data-reg-slide] input, [data-reg-slide] select, [data-reg-slide] textarea")];

const DEGREE_OPTIONS = [
  ["associate's", "associate's"],
  ["bachelor's", "bachelor's"],
  ["master's", "master's"],
  ["doctoral", "doctoral"],
  ["certificate", "certificate"],
  ["other", "other"],
];

const eduList = document.getElementById("reg-edu-list");
const eduAddBtn = document.getElementById("reg-add-edu");

function renderEducationEntry(index) {
  const wrap = document.createElement("div");
  wrap.className = "reg-edu-entry";
  wrap.dataset.eduIndex = String(index);
  const removeBtn = index === 0
    ? ""
    : `<button type="button" class="reg-edu-entry__remove" aria-label="Remove degree">&times;</button>`;
  const options = DEGREE_OPTIONS
    .map(([val, label]) => `<option value="${val}">${label}</option>`)
    .join("");
  wrap.innerHTML = `
    <div class="reg-edu-entry__head">
      <span class="reg-edu-entry__num">Degree ${index + 1}</span>
      ${removeBtn}
    </div>
    <div class="gr-field-grid reg-field-grid--2">
      <label class="gr-label">
        <span>Degree</span>
        <select class="reg-edu-degree" data-initial-required="1" required>
          <option value="">Choose…</option>
          ${options}
        </select>
      </label>
      <label class="gr-label">
        <span>Major</span>
        <input type="text" class="reg-edu-major" data-initial-required="1" placeholder="E.g. marketing, computer science" required />
      </label>
      <label class="gr-label">
        <span>Minor <span class="gr-optional">Optional</span></span>
        <input type="text" class="reg-edu-minor" data-initial-required="0" placeholder="E.g. data analytics" />
      </label>
      <label class="gr-label">
        <span>School</span>
        <div class="reg-edu-school-ac">
          <input type="text" class="reg-edu-school-search" data-initial-required="1" autocomplete="off"
                 placeholder="Search your school…" required />
          <input type="hidden" class="reg-edu-school" data-initial-required="1" />
          <div class="reg-edu-school-ac__panel" hidden>
            <ul class="reg-edu-school-ac__list"></ul>
          </div>
          <div class="reg-edu-school-other-wrap" hidden>
            <input type="text" class="reg-edu-school-other" placeholder="Type your school name" />
          </div>
        </div>
      </label>
    </div>
  `;
  wrap.querySelector(".reg-edu-entry__remove")?.addEventListener("click", () => {
    wrap.remove();
    relabelEducationEntries();
  });
  wireSchoolAutocomplete(wrap.querySelector(".reg-edu-school-ac"));
  return wrap;
}

function relabelEducationEntries() {
  [...eduList.querySelectorAll(".reg-edu-entry")].forEach((entry, idx) => {
    entry.dataset.eduIndex = String(idx);
    const numEl = entry.querySelector(".reg-edu-entry__num");
    if (numEl) numEl.textContent = `Degree ${idx + 1}`;
    const removeEl = entry.querySelector(".reg-edu-entry__remove");
    if (idx === 0 && removeEl) removeEl.remove();
  });
}

function collectEducations() {
  const verified = document.getElementById("field-verified-school")?.value?.trim() || "";
  return [...eduList.querySelectorAll(".reg-edu-entry")].map((entry, index) => {
    const schoolInput = entry.querySelector(".reg-edu-school");
    const otherInput = entry.querySelector(".reg-edu-school-other");
    const isOther = schoolInput?.dataset?.schoolOther === "1";
    // Prefer the hidden input's value; if user picked "not listed", the
    // other-text field is authoritative.
    let school = (schoolInput?.value || "").trim();
    if (isOther) {
      school = (otherInput?.value || "").trim();
    }
    if (inviteMode && index === 0 && verified) school = verified;
    return {
      degree: entry.querySelector(".reg-edu-degree")?.value || null,
      major: entry.querySelector(".reg-edu-major")?.value.trim() || null,
      minor: entry.querySelector(".reg-edu-minor")?.value.trim() || null,
      school: school || null,
      school_other: isOther && !(inviteMode && index === 0) ? true : undefined,
    };
  });
}

if (eduList && !eduList.children.length) {
  eduList.appendChild(renderEducationEntry(0));
}

// City autocomplete (consultant step). The wrapping div is static in
// register.html; this just attaches keyboard + click handlers.
wireAllCityAutocompletes();

function collectCity() {
  const label = document.getElementById("reg-city")?.value?.trim() || null;
  const latStr = document.getElementById("reg-city-lat")?.value?.trim() || "";
  const lngStr = document.getElementById("reg-city-lng")?.value?.trim() || "";
  const lat = latStr ? Number(latStr) : null;
  const lng = lngStr ? Number(lngStr) : null;
  if (!label || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { city: label, city_lat: lat, city_lng: lng };
}

eduAddBtn?.addEventListener("click", () => {
  const idx = eduList.children.length;
  eduList.appendChild(renderEducationEntry(idx));
});

steppedFields.forEach((field) => {
  field.dataset.initialRequired = field.required ? "1" : "0";
});

function syncStepFieldState() {
  slides.forEach((slide) => {
    const slideIdx = Number(slide.dataset.regSlide);
    const isIncludedStep = STEPS.includes(slideIdx);
    slide.querySelectorAll("input, select, textarea").forEach((field) => {
      if (field.type === "hidden") return;
      if (field.closest("[data-invite-only]") && !inviteMode) {
        field.disabled = true;
        field.required = false;
        return;
      }
      field.disabled = !isIncludedStep;
      field.required = isIncludedStep && field.dataset.initialRequired === "1";
    });
  });
}

function showSlide(idx) {
  slides.forEach((s) => {
    s.classList.remove("reg-slide--active");
    s.setAttribute("aria-hidden", "true");
  });
  const target = document.querySelector(`[data-reg-slide="${idx}"]`);
  if (target) {
    target.classList.add("reg-slide--active");
    target.removeAttribute("aria-hidden");
  }
  if (idx === 2 && inviteMode) applyVerifiedSchool();

  renderProgress(idx);
  backBtn.classList.toggle("hidden", STEPS.indexOf(idx) <= 0);

  const isLast = idx === STEPS[STEPS.length - 1];
  nextBtn.classList.toggle("hidden", isLast);
  submitBtn.classList.toggle("hidden", !isLast);
  // The consent checkbox only shows on the final step, next to the
  // create account button (the .is-final CSS gate).
  form.classList.toggle("is-final", isLast);
  syncStepFieldState();
}

// Owners: the account is created on the account slide, then one short
// business step (/business-basics.html) runs before the project brief.
// The bar shows those two real steps. The role picker sits before the
// count, so it shows no bar at all. Invite (student) sign-up keeps its
// slide-by-slide bar.
const OWNER_PROGRESS = ["Your account", "Your business"];

function renderProgress(idx) {
  const ownerPath = selectedRole === "business_owner" && !inviteMode;
  if (idx === 0 && !inviteMode) {
    progressTrack.hidden = true;
    progressLabel.textContent = "Pick your path";
    return;
  }
  progressTrack.hidden = false;
  if (ownerPath) {
    segments.forEach((seg, i) => {
      seg.style.display = i < OWNER_PROGRESS.length ? "" : "none";
      seg.classList.remove("is-done", "is-active");
      if (i === 0) seg.classList.add("is-active");
    });
    progressLabel.textContent = `Step 1 of ${OWNER_PROGRESS.length} · ${OWNER_PROGRESS[0]}`;
    return;
  }
  const pos = STEPS.indexOf(idx);
  segments.forEach((seg, i) => {
    seg.classList.remove("is-done", "is-active");
    if (i < pos) seg.classList.add("is-done");
    if (i === pos) seg.classList.add("is-active");
  });
  progressLabel.textContent = STEP_LABELS[pos >= 0 ? pos : idx] || "";
}

/* ── Inline field errors ─────────────────────────────────────────
   Each error renders under its own field, names the field, and is
   tied to the input with aria-describedby + aria-invalid. The first
   invalid field takes focus. */
function fieldWrap(input) {
  return input.closest(".gr-label") || input.parentElement;
}

function setFieldError(input, message) {
  const wrap = fieldWrap(input);
  if (!wrap) return;
  let err = wrap.querySelector(":scope > .reg-field-error");
  if (!err) {
    err = document.createElement("p");
    err.className = "reg-field-error";
    err.id = `${input.id || input.name || "field"}-error`;
    wrap.appendChild(err);
  }
  err.textContent = message;
  err.hidden = false;
  input.setAttribute("aria-invalid", "true");
  const ids = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  if (!ids.includes(err.id)) input.setAttribute("aria-describedby", [err.id, ...ids].join(" "));
}

function clearFieldError(input) {
  const wrap = fieldWrap(input);
  const err = wrap?.querySelector(":scope > .reg-field-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  input.removeAttribute("aria-invalid");
}

function clearStepErrors(slide) {
  slide?.querySelectorAll("[aria-invalid]").forEach(clearFieldError);
}

function errorLabelFor(input) {
  if (input.dataset.errorLabel) return input.dataset.errorLabel;
  const text = fieldWrap(input)?.querySelector(":scope > span")?.textContent?.trim();
  return text ? text.toLowerCase() : "this field";
}

form.addEventListener("input", (event) => {
  const field = event.target;
  if (field?.getAttribute?.("aria-invalid") === "true") clearFieldError(field);
});
form.addEventListener("change", (event) => {
  const field = event.target;
  if (field?.id === "reg-accepted-terms" && field.checked) clearConsentError();
});

function showConsentError() {
  const wrap = document.getElementById("reg-consent");
  const consent = document.getElementById("reg-accepted-terms");
  const err = document.getElementById("reg-consent-error");
  wrap?.classList.add("is-invalid");
  if (err) {
    err.textContent = "Check the box to agree to the privacy policy and terms.";
    err.hidden = false;
  }
  consent?.setAttribute("aria-invalid", "true");
  consent?.setAttribute("aria-describedby", "reg-consent-error");
}

function clearConsentError() {
  document.getElementById("reg-consent")?.classList.remove("is-invalid");
  const err = document.getElementById("reg-consent-error");
  if (err) err.hidden = true;
  const consent = document.getElementById("reg-accepted-terms");
  consent?.removeAttribute("aria-invalid");
}

const PW_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;
const PW_UPPER = /[A-Z]/;
const PW_LOWER = /[a-z]/;

const PW_NUMBER = /\d/;

function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// Returns [{ input, message }] for the password pair. Empty fields are
// reported by the required check, so this only runs on filled values.
function passwordErrors() {
  const errors = [];
  const pw = form.password.value;
  const confirm = form.passwordConfirm.value;
  if (pw) {
    const missing = [];
    if (pw.length < 8) missing.push("8+ characters");
    if (!PW_UPPER.test(pw)) missing.push("an uppercase letter");
    if (!PW_LOWER.test(pw)) missing.push("a lowercase letter");
    if (!PW_NUMBER.test(pw)) missing.push("a number");
    if (!PW_SPECIAL.test(pw)) missing.push("a symbol");
    if (missing.length) {
      errors.push({ input: form.password, message: `Password needs ${joinList(missing)}.` });
    }
  }
  if (pw && confirm && pw !== confirm) {
    errors.push({ input: form.passwordConfirm, message: "Passwords don't match." });
  }
  return errors;
}

// Validate every required field on a slide at once, paint each error
// inline, and focus the first bad field. Returns true when clean.
function validateSlideFields(slide, extraErrors = () => []) {
  clearStepErrors(slide);
  const errors = [];
  slide.querySelectorAll("[required]").forEach((input) => {
    if (input.disabled || input.type === "hidden") return;
    const value = (input.value || "").trim();
    if (!value) {
      errors.push({ input, message: `Enter ${errorLabelFor(input)}.` });
    } else if (input.type === "email" && input.validity?.typeMismatch) {
      errors.push({ input, message: "Enter an email like name@example.com." });
    }
  });
  const flagged = new Set(errors.map((e) => e.input));
  extraErrors().forEach((e) => {
    if (!flagged.has(e.input)) errors.push(e);
  });
  errors.forEach((e) => setFieldError(e.input, e.message));
  if (errors.length) {
    // Focus the first invalid field in document order.
    const first = errors
      .map((e) => e.input)
      .sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))[0];
    first?.focus();
    return false;
  }
  return true;
}

function validateCurrentStep() {
  if (currentStep === 0) {
    const checked = form.querySelector('input[name="role_choice"]:checked');
    if (!checked) {
      statusEl.textContent = "Choose how you're joining to continue.";
      statusEl.className = "gr-status error";
      return false;
    }
    selectedRole = checked.value;
    roleField.value = selectedRole;

    // Dynamically set steps based on role
    if (selectedRole === "consultant") {
      STEP_LABELS = ["Pick your path", "Account details", "Education"];
      STEPS = [0, 1, 2];
    } else {
      STEP_LABELS = ["Pick your path", "Account details"];
      STEPS = [0, 1];
      // Tell owners what comes after this form.
      const subtitle = document.getElementById("reg-subtitle");
      if (subtitle) {
        subtitle.textContent = "Next you add your business name and city, then write your project brief.";
      }
    }
    // Update progress segments visibility
    segments.forEach((seg, i) => {
      seg.style.display = i < STEPS.length ? "" : "none";
    });
    syncStepFieldState();
    return true;
  }

  if (currentStep === 1) {
    if (inviteMode && !validateInviteSchool()) return false;
    const slide = document.querySelector('[data-reg-slide="1"]');
    if (!validateSlideFields(slide, passwordErrors)) return false;
  }

  if (currentStep === 2) {
    if (inviteMode) applyVerifiedSchool();
    const slide = document.querySelector('[data-reg-slide="2"]');
    if (!validateSlideFields(slide, () => [])) return false;
  }

  return true;
}

nextBtn.addEventListener("click", () => {
  statusEl.textContent = "";
  statusEl.className = "gr-status";
  if (!validateCurrentStep()) return;

  const curIdx = STEPS.indexOf(currentStep);
  if (curIdx < STEPS.length - 1) {
    currentStep = STEPS[curIdx + 1];
    showSlide(currentStep);
  }
});

backBtn.addEventListener("click", () => {
  statusEl.textContent = "";
  statusEl.className = "gr-status";
  const curIdx = STEPS.indexOf(currentStep);
  if (curIdx > 0) {
    currentStep = STEPS[curIdx - 1];
    showSlide(currentStep);
  }
});

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  statusEl.textContent = "";
  statusEl.className = "gr-status";

  if (!validateCurrentStep()) {
    // Flag the consent box in the same pass so every problem shows at
    // once; focus stays on the first invalid field.
    if (!document.getElementById("reg-accepted-terms")?.checked) showConsentError();
    return;
  }

  // Privacy + terms consent. The checkbox lives outside any slide, only
  // visible on the final step (.is-final), so a normal validateCurrentStep
  // pass won't catch it.
  const consent = document.getElementById("reg-accepted-terms");
  if (!consent || !consent.checked) {
    showConsentError();
    consent?.focus();
    return;
  }
  clearConsentError();

  submitBtn.disabled = true;
  submitBtn.textContent = "Creating…";
  statusEl.textContent = "Setting up your account…";

  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    const fd = new FormData(form);
    fd.set("fullName", `${fd.get("firstName").trim()} ${fd.get("lastName").trim()}`);
    fd.delete("firstName");
    fd.delete("lastName");
    fd.delete("role_choice");
    fd.delete("passwordConfirm");

    // Education entries are collected from the dynamic slide-2 list, not
    // from FormData. Persisted after the user is signed in (below).
    const educations = selectedRole === "consultant" ? collectEducations() : [];
    const primaryEdu = educations[0] || { major: null, minor: null, school: null };
    if (selectedRole === "consultant") {
      fd.set("educations", JSON.stringify(educations));
      fd.set("inviteToken", inviteToken);
      fd.set("verifiedSchool", document.getElementById("field-verified-school")?.value?.trim() || "");
    }

    const res = await fetch("/api/register", {
      method: "POST",
      body: fd,
    });

    const body = await res.json();

    if (!res.ok) {
      throw new Error(body.error || "Registration failed.");
    }

    statusEl.textContent = "Account created. Signing you in…";
    statusEl.className = "gr-status success";

    const supabase = await getSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      statusEl.innerHTML =
        'Account created. <a href="/signin.html">Sign in</a> to continue.';
      return;
    }

    // A tab that browsed /marketplace.html?guest=1 before signing up
    // still carries the guest flag; drop it now that a real session exists.
    clearGuestMode();

    // Save education + city for consultant. educations jsonb mirrors
    // to legacy flat columns for read-compat; city feeds the marketplace
    // "local" bucket. Both writes are non-blocking.
    if (selectedRole === "consultant") {
      const cityRecord = collectCity();
      try {
        await supabase.from("consultant_profiles").update({
          educations,
          major: primaryEdu.major,
          minor: primaryEdu.minor,
          school: primaryEdu.school,
          ...(cityRecord || { city: null, city_lat: null, city_lng: null }),
        }).eq("user_id", body.userId);
      } catch (_) { /* non-blocking */ }
    }

    // Owners: one short business step, then straight into the project
    // brief. Students keep the profile welcome flow.
    window.location.href = selectedRole === "business_owner"
      ? "/business-basics.html"
      : "/profile.html?welcome=1";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "gr-status error";
    submitBtn.disabled = false;
    submitBtn.textContent = "Create account";
  }
});


function lockEntrySchool(entry, schoolName) {
  const root = entry.querySelector(".reg-edu-school-ac");
  const search = entry.querySelector(".reg-edu-school-search");
  const hidden = entry.querySelector(".reg-edu-school");
  if (root) root.dataset.allowOther = "0";
  if (hidden) {
    hidden.value = schoolName;
    hidden.dataset.schoolOther = "0";
  }
  if (search) {
    search.value = schoolName;
    search.readOnly = true;
    search.dataset.initialRequired = "1";
  }
}

function applyVerifiedSchool() {
  const schoolName = document.getElementById("field-verified-school")?.value?.trim() || "";
  const entry = eduList?.querySelector(".reg-edu-entry");
  if (entry && schoolName) lockEntrySchool(entry, schoolName);
}

function refreshSchoolHint() {
  const hint = document.getElementById("reg-school-domain-hint");
  if (!hint) return;
  const school = document.getElementById("field-verified-school")?.value?.trim() || "";
  const email = document.getElementById("reg-email")?.value?.trim() || "";
  if (!school) {
    hint.textContent = "Pick the school on that email.";
    return;
  }
  const domain = primaryDomainFor(school);
  const result = matchCachedSchoolEmail(school, email);
  hint.textContent = result.ok
    ? `This email matches @${domain}.`
    : `This email has to end in @${domain || "your school's domain"}.`;
}

function validateInviteSchool() {
  const school = document.getElementById("field-verified-school")?.value?.trim() || "";
  const email = document.getElementById("reg-email")?.value?.trim() || "";
  const search = document.querySelector("#reg-verified-school-ac .reg-edu-school-search");
  if (!school) {
    search?.focus();
    statusEl.textContent = "Pick your school from the list.";
    statusEl.className = "gr-status error";
    return false;
  }
  const result = matchCachedSchoolEmail(school, email);
  if (!result.ok) {
    search?.focus();
    statusEl.textContent = result.error;
    statusEl.className = "gr-status error";
    refreshSchoolHint();
    return false;
  }
  statusEl.textContent = "";
  statusEl.className = "gr-status";
  return true;
}

function refreshSegmentVisibility() {
  segments.forEach((seg, i) => {
    seg.style.display = i < STEPS.length ? "" : "none";
  });
}

function enterInviteMode(email) {
  inviteMode = true;
  selectedRole = "consultant";
  roleField.value = "consultant";
  document.getElementById("field-invite-token").value = inviteToken;

  const emailInput = document.getElementById("reg-email");
  emailInput.value = email;
  emailInput.readOnly = true;
  emailInput.setAttribute("aria-readonly", "true");

  const schoolBlock = document.getElementById("reg-invite-school");
  schoolBlock.hidden = false;
  const search = schoolBlock.querySelector(".reg-edu-school-search");
  search.dataset.initialRequired = "1";

  document.getElementById("reg-title").textContent = "Create your consultant account";
  document.getElementById("reg-subtitle").textContent = `This link is for ${email}.`;
  document.getElementById("reg-account-heading").textContent = "School and account";
  document.getElementById("reg-edu-intro").textContent =
    "Your school stays locked to this email. Add another degree if you have one.";

  STEP_LABELS = ["Account details", "Education"];
  STEPS = [1, 2];
  currentStep = 1;
  refreshSegmentVisibility();
  showSlide(1);
  document.documentElement.classList.remove("reg-invite-boot");
  refreshSchoolHint();
}

async function bootRegistration() {
  const schoolAc = document.getElementById("reg-verified-school-ac");
  wireSchoolAutocomplete(schoolAc);
  document.getElementById("field-verified-school")?.addEventListener("change", refreshSchoolHint);

  if (!inviteToken) {
    // "Post a project" links land here with ?role=owner. Students can't
    // self-register, so the role picker is a dead step; start on account.
    const ownerRadio = form.querySelector('input[name="role_choice"][value="business_owner"]');
    if (new URLSearchParams(window.location.search).get("role") === "owner" && ownerRadio) {
      ownerRadio.checked = true;
      validateCurrentStep();
      currentStep = 1;
      showSlide(1);
      return;
    }
    showSlide(0);
    return;
  }

  try {
    try {
      await preloadSchools();
    } catch (_) {
      throw new Error("We couldn't load the school list. Refresh and try again.");
    }
    const res = await fetch(`/api/consultant-invite?token=${encodeURIComponent(inviteToken)}`);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || "This invite link is no longer valid.");
    enterInviteMode(body.email);
  } catch (err) {
    form.hidden = true;
    const fallback = document.getElementById("reg-invite-fallback");
    const fallbackCopy = fallback?.querySelector(".gr-subtitle");
    if (fallbackCopy) fallbackCopy.textContent = err.message;
    if (fallback) fallback.hidden = false;
    statusEl.textContent = "";
    document.documentElement.classList.remove("reg-invite-boot");
  }
}

// Hide the third progress segment initially (only shown for consultant)
if (segments[2]) segments[2].style.display = "none";
progressTrack.hidden = true;
bootRegistration();

// ── Password reveal toggle (shared with signin) ─────────────────
document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-pw-toggle]");
  if (!btn) return;
  const input = document.getElementById(btn.dataset.pwToggle);
  if (!input) return;
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  btn.setAttribute("aria-pressed", String(reveal));
  btn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
  btn.classList.toggle("gr-pw-toggle--shown", reveal);
});

// ── Live password requirements feedback ─────────────────────────
const pwInput = document.getElementById("reg-password");
const pwRules = document.getElementById("reg-pw-rules");
if (pwInput && pwRules) {
  const rules = {
    length: (v) => v.length >= 8,
    uppercase: (v) => /[A-Z]/.test(v),
    lowercase: (v) => /[a-z]/.test(v),
    number: (v) => /\d/.test(v),
    special: (v) => /[^A-Za-z0-9]/.test(v),
  };
  const updateRules = () => {
    const v = pwInput.value;
    pwRules.querySelectorAll("[data-rule]").forEach((li) => {
      const ok = !!rules[li.dataset.rule]?.(v);
      li.classList.toggle("is-met", ok);
    });
  };
  pwInput.addEventListener("input", updateRules);
  updateRules();
}
