import { getSupabaseClient } from "/supabase-loader.js";
import { wireSchoolAutocomplete } from "/school-autocomplete.js";
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

// Steps are dynamic based on role selection; start with base
let STEP_LABELS = ["pick your path", "account details"];
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
    : `<button type="button" class="reg-edu-entry__remove" aria-label="remove degree">&times;</button>`;
  const options = DEGREE_OPTIONS
    .map(([val, label]) => `<option value="${val}">${label}</option>`)
    .join("");
  wrap.innerHTML = `
    <div class="reg-edu-entry__head">
      <span class="reg-edu-entry__num">degree ${index + 1}</span>
      ${removeBtn}
    </div>
    <div class="gr-field-grid reg-field-grid--2">
      <label class="gr-label">
        <span>degree</span>
        <select class="reg-edu-degree" data-initial-required="1" required>
          <option value="">choose…</option>
          ${options}
        </select>
      </label>
      <label class="gr-label">
        <span>major</span>
        <input type="text" class="reg-edu-major" data-initial-required="1" placeholder="e.g. marketing, computer science" required />
      </label>
      <label class="gr-label">
        <span>minor <span class="gr-optional">optional</span></span>
        <input type="text" class="reg-edu-minor" data-initial-required="0" placeholder="e.g. data analytics" />
      </label>
      <label class="gr-label">
        <span>school</span>
        <div class="reg-edu-school-ac">
          <input type="text" class="reg-edu-school-search" autocomplete="off"
                 placeholder="search your school…" required />
          <input type="hidden" class="reg-edu-school" data-initial-required="1" />
          <div class="reg-edu-school-ac__panel" hidden>
            <ul class="reg-edu-school-ac__list"></ul>
          </div>
          <div class="reg-edu-school-other-wrap" hidden>
            <input type="text" class="reg-edu-school-other" placeholder="type your school name" />
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
    if (numEl) numEl.textContent = `degree ${idx + 1}`;
    const removeEl = entry.querySelector(".reg-edu-entry__remove");
    if (idx === 0 && removeEl) removeEl.remove();
  });
}

function collectEducations() {
  return [...eduList.querySelectorAll(".reg-edu-entry")].map((entry) => {
    const schoolInput = entry.querySelector(".reg-edu-school");
    const otherInput = entry.querySelector(".reg-edu-school-other");
    const isOther = schoolInput?.dataset?.schoolOther === "1";
    // Prefer the hidden input's value; if user picked "not listed", the
    // other-text field is authoritative.
    let school = (schoolInput?.value || "").trim();
    if (isOther) {
      school = (otherInput?.value || "").trim();
    }
    return {
      degree: entry.querySelector(".reg-edu-degree")?.value || null,
      major: entry.querySelector(".reg-edu-major")?.value.trim() || null,
      minor: entry.querySelector(".reg-edu-minor")?.value.trim() || null,
      school: school || null,
      school_other: isOther || undefined,
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

  const pos = STEPS.indexOf(idx);
  segments.forEach((seg, i) => {
    seg.classList.remove("is-done", "is-active");
    if (i < pos) seg.classList.add("is-done");
    if (i === pos) seg.classList.add("is-active");
  });

  const stepPos = STEPS.indexOf(idx);
  progressLabel.textContent = STEP_LABELS[stepPos >= 0 ? stepPos : idx] || "";
  backBtn.classList.toggle("hidden", idx === 0);

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
    statusEl.textContent = "password must be at least 8 characters.";
    statusEl.className = "gr-status error";
    return false;
  }
  if (!PW_UPPER.test(pw) || !PW_LOWER.test(pw)) {
    form.password.focus();
    statusEl.textContent = "password must include both uppercase and lowercase letters.";
    statusEl.className = "gr-status error";
    return false;
  }
  if (!PW_SPECIAL.test(pw)) {
    form.password.focus();
    statusEl.textContent = "password must include at least one special character.";
    statusEl.className = "gr-status error";
    return false;
  }
  if (pw !== confirm) {
    form.passwordConfirm.focus();
    statusEl.textContent = "passwords do not match.";
    statusEl.className = "gr-status error";
    return false;
  }
  return true;
}

function validateCurrentStep() {
  if (currentStep === 0) {
    const checked = form.querySelector('input[name="role_choice"]:checked');
    if (!checked) {
      statusEl.textContent = "please choose a role to continue.";
      statusEl.className = "gr-status error";
      return false;
    }
    selectedRole = checked.value;
    roleField.value = selectedRole;

    // Dynamically set steps based on role
    if (selectedRole === "consultant") {
      STEP_LABELS = ["pick your path", "account details", "education"];
      STEPS = [0, 1, 2];
    } else {
      STEP_LABELS = ["pick your path", "account details"];
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
    const slide = document.querySelector('[data-reg-slide="1"]');
    const required = slide.querySelectorAll("[required]");
    for (const input of required) {
      if (!input.value.trim()) {
        input.focus();
        statusEl.textContent = "please fill in all required fields.";
        statusEl.className = "gr-status error";
        return false;
      }
    }
    if (!validatePassword()) return false;
  }

  if (currentStep === 2) {
    const slide = document.querySelector('[data-reg-slide="2"]');
    const required = slide.querySelectorAll("[required]");
    for (const input of required) {
      if (!input.value.trim()) {
        input.focus();
        statusEl.textContent = "please fill in all required fields.";
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
      "please agree to the privacy policy and terms of service to continue.";
    statusEl.className = "gr-status error";
    return;
  }
  if (consentWrap) consentWrap.classList.remove("is-invalid");

  submitBtn.disabled = true;
  submitBtn.textContent = "creating…";
  statusEl.textContent = "setting up your account…";

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

    const res = await fetch("/api/register", {
      method: "POST",
      body: fd,
    });

    const body = await res.json();

    if (!res.ok) {
      throw new Error(body.error || "registration failed.");
    }

    statusEl.textContent = "account created — signing you in…";
    statusEl.className = "gr-status success";

    const supabase = await getSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (signInError) {
      statusEl.innerHTML =
        'account created. <a href="/signin.html">sign in</a> to continue.';
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
    submitBtn.textContent = "create account";
  }
});

form.addEventListener(
  "invalid",
  (event) => {
    const field = event.target;
    if (!(field instanceof HTMLInputElement || field instanceof HTMLSelectElement || field instanceof HTMLTextAreaElement)) {
      return;
    }
    statusEl.textContent = field.validationMessage || "please complete the required fields.";
    statusEl.className = "gr-status error";
  },
  true
);

// Hide the third progress segment initially (only shown for consultant)
if (segments[2]) segments[2].style.display = "none";
showSlide(0);

// ── Password reveal toggle (shared with signin) ─────────────────
document.addEventListener("click", (event) => {
  const btn = event.target.closest("[data-pw-toggle]");
  if (!btn) return;
  const input = document.getElementById(btn.dataset.pwToggle);
  if (!input) return;
  const reveal = input.type === "password";
  input.type = reveal ? "text" : "password";
  btn.setAttribute("aria-pressed", String(reveal));
  btn.setAttribute("aria-label", reveal ? "hide password" : "show password");
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
