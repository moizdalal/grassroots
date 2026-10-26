import { getSupabaseClient } from "/supabase-loader.js";
import { wireSchoolAutocomplete, preloadSchools, matchCachedSchoolEmail, primaryDomainFor } from "/school-autocomplete.js";
import { wireAllCityAutocompletes } from "/city-autocomplete.js";
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

  const pos = STEPS.indexOf(idx);
  segments.forEach((seg, i) => {
    seg.classList.remove("is-done", "is-active");
    if (i < pos) seg.classList.add("is-done");
    if (i === pos) seg.classList.add("is-active");
  });

  const stepPos = STEPS.indexOf(idx);
  progressLabel.textContent = STEP_LABELS[stepPos >= 0 ? stepPos : idx] || "";
  backBtn.classList.toggle("hidden", STEPS.indexOf(idx) <= 0);

  const isLast = idx === STEPS[STEPS.length - 1];
  nextBtn.classList.toggle("hidden", isLast);
  submitBtn.classList.toggle("hidden", !isLast);
  // Show the privacy/terms disclosure only on the final step (when the
  // "create account" button is visible) — wired by the .is-final CSS gate.
  const form = document.getElementById("registration-form");
  if (form) form.classList.toggle("is-final", isLast);
  syncStepFieldState();
}

const PW_SPECIAL = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?`~]/;
const PW_UPPER = /[A-Z]/;
const PW_LOWER = /[a-z]/;

function validatePassword() {
  const pw = form.password.value;
  const confirm = form.passwordConfirm.value;

  if (pw.length < 8) {
    form.password.focus();
    statusEl.textContent = "Password must be at least 8 characters.";
    statusEl.className = "gr-status error";
    return false;
  }
  if (!PW_UPPER.test(pw) || !PW_LOWER.test(pw)) {
    form.password.focus();
    statusEl.textContent = "Password must include both uppercase and lowercase letters.";
    statusEl.className = "gr-status error";
    return false;
  }
  if (!PW_SPECIAL.test(pw)) {
    form.password.focus();
    statusEl.textContent = "Password must include at least one special character.";
    statusEl.className = "gr-status error";
    return false;
  }
  if (pw !== confirm) {
    form.passwordConfirm.focus();
    statusEl.textContent = "Passwords do not match.";
    statusEl.className = "gr-status error";
    return false;
  }
  return true;
}

function validateCurrentStep() {
  if (currentStep === 0) {
    const checked = form.querySelector('input[name="role_choice"]:checked');
    if (!checked) {
      statusEl.textContent = "Please choose a role to continue.";
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
    const required = slide.querySelectorAll("[required]");
    for (const input of required) {
      if (!input.value.trim()) {
        input.focus();
        statusEl.textContent = "Please fill in all required fields.";
        statusEl.className = "gr-status error";
        return false;
      }
    }
    if (!validatePassword()) return false;
  }

  if (currentStep === 2) {
    if (inviteMode) applyVerifiedSchool();
    const slide = document.querySelector('[data-reg-slide="2"]');
    const required = slide.querySelectorAll("[required]");
    for (const input of required) {
      if (!input.value.trim()) {
        input.focus();
        statusEl.textContent = "Please fill in all required fields.";
        statusEl.className = "gr-status error";
        return false;
      }
    }
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

  if (!validateCurrentStep()) return;

  // Privacy + terms consent. The checkbox lives outside any slide, only
  // visible on the final step (.is-final), so a normal validateCurrentStep
  // pass won't catch it.
  const consent = document.getElementById("reg-accepted-terms");
  const consentWrap = document.getElementById("reg-consent");
  if (!consent || !consent.checked) {
    if (consentWrap) consentWrap.classList.add("is-invalid");
    if (consent) consent.focus();
    statusEl.textContent =
      "Please agree to the privacy policy and terms of service to continue.";
    statusEl.className = "gr-status error";
    return;
  }
  if (consentWrap) consentWrap.classList.remove("is-invalid");

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

    statusEl.textContent = "Account created — signing you in…";
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

    window.location.href = "/profile.html?welcome=1";
  } catch (err) {
    statusEl.textContent = err.message;
    statusEl.className = "gr-status error";
    submitBtn.disabled = false;
    submitBtn.textContent = "Create account";
  }
});

form.addEventListener(
  "invalid",
  (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
      return;
    }
    statusEl.textContent = field.validationMessage || "Please complete the required fields.";
    statusEl.className = "gr-status error";
  },
  true
);

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
