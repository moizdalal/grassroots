import { getSupabaseClient } from "/supabase-loader.js";
import { renderOAuthButtons } from "/oauth.js";

const form = document.getElementById("registration-form");
const statusEl = document.getElementById("status");
const backBtn = document.getElementById("reg-back");
const nextBtn = document.getElementById("reg-next");
const submitBtn = document.getElementById("reg-submit");
const progressLabel = document.getElementById("reg-progress-label");
const progressTrack = document.getElementById("reg-progress-track");
const roleField = document.getElementById("field-role");
const oauthHiddenLabels = [...form.querySelectorAll("[data-oauth-hide=\"true\"]")];

const isOAuth = new URLSearchParams(window.location.search).get("oauth") === "1";

// Steps are dynamic based on role selection; start with base
let STEP_LABELS = isOAuth ? ["pick your path"] : ["pick your path", "account details"];
let STEPS = isOAuth ? [0] : [0, 1];

let currentStep = 0;
let selectedRole = "";

const slides = document.querySelectorAll("[data-reg-slide]");
const segments = progressTrack.querySelectorAll(".reg-progress__seg");
const steppedFields = [...form.querySelectorAll("[data-reg-slide] input, [data-reg-slide] select, [data-reg-slide] textarea")];

steppedFields.forEach((field) => {
  field.dataset.initialRequired = field.required ? "1" : "0";
});

function syncStepFieldState() {
  slides.forEach((slide) => {
    const slideIdx = Number(slide.dataset.regSlide);
    const isIncludedStep = STEPS.includes(slideIdx);
    slide.querySelectorAll("input, select, textarea").forEach((field) => {
      if (field.type === "hidden") return;
      if (isOAuth && field.closest("[data-oauth-hide=\"true\"]")) {
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
    if (selectedRole === "consultant" && !isOAuth) {
      STEP_LABELS = ["pick your path", "account details", "education"];
      STEPS = [0, 1, 2];
    } else if (selectedRole === "consultant" && isOAuth) {
      STEP_LABELS = ["pick your path", "contact details", "education"];
      STEPS = [0, 1, 2];
    } else if (isOAuth) {
      STEP_LABELS = ["pick your path", "contact details"];
      STEPS = [0, 1];
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
    if (!isOAuth && !validatePassword()) return false;
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

  submitBtn.disabled = true;
  submitBtn.textContent = "creating…";
  statusEl.textContent = "setting up your account…";

  if (isOAuth) {
    try {
      const supabase = await getSupabaseClient();
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error("no active session — please sign in again.");

      const user = session.user;
      const meta = user.user_metadata || {};
      const fullName = meta.full_name || meta.name || user.email.split("@")[0];
      const phoneNumber = form.phoneNumber?.value?.trim() || "";
      if (!phoneNumber) throw new Error("phone number is required.");

      const eduMajor = form.major?.value?.trim() || "";
      const eduMinor = form.minor?.value?.trim() || "";
      const eduSchool = form.school?.value?.trim() || "";

      const res = await fetch("/api/oauth-complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          role: selectedRole,
          fullName,
          phoneNumber,
        }),
      });

      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "profile setup failed.");

      // Save education for consultant
      if (selectedRole === "consultant" && (eduMajor || eduSchool)) {
        try {
          await supabase.from("consultant_profiles").update({
            major: eduMajor || null,
            minor: eduMinor || null,
            school: eduSchool || null,
          }).eq("user_id", user.id);
        } catch (_) { /* non-blocking */ }
      }

      statusEl.textContent = "profile created — redirecting…";
      statusEl.className = "gr-status success";
      window.location.href = "/profile.html?welcome=1";
    } catch (err) {
      statusEl.textContent = err.message;
      statusEl.className = "gr-status error";
      submitBtn.disabled = false;
      submitBtn.textContent = "create account";
    }
    return;
  }

  const email = form.email.value.trim();
  const password = form.password.value;

  try {
    const fd = new FormData(form);
    fd.set("fullName", `${fd.get("firstName").trim()} ${fd.get("lastName").trim()}`);
    fd.delete("firstName");
    fd.delete("lastName");
    fd.delete("role_choice");
    fd.delete("passwordConfirm");
    // Education fields sent separately if consultant
    const eduMajor = fd.get("major") || "";
    const eduMinor = fd.get("minor") || "";
    const eduSchool = fd.get("school") || "";

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

    // Save education fields for consultant
    if (selectedRole === "consultant" && (eduMajor || eduSchool)) {
      try {
        await supabase.from("consultant_profiles").update({
          major: eduMajor || null,
          minor: eduMinor || null,
          school: eduSchool || null,
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

if (isOAuth) {
  oauthHiddenLabels.forEach((label) => {
    label.classList.add("hidden");
    label.querySelectorAll("input, select, textarea").forEach((field) => {
      field.disabled = true;
      field.required = false;
    });
  });
  submitBtn.textContent = "finish setup";
} else {
  renderOAuthButtons("oauth-slot");
}

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
