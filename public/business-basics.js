// business-basics.js — owner sign-up, step 2 of 2.
//
// Right after an owner creates an account, register-flow.js sends them
// here. One short form: business name + city, both required. Saves to
// the same business_profiles columns the Settings > Professional tab
// writes (business_name, business_address). The city label ("City, ST")
// goes in business_address: the listing geocoder reads that column to
// place projects for nearby students. Then straight to the project brief
// with the listing-form tour (?welcome=1).

import { getSupabaseClient } from "/supabase-loader.js";
import { wireAllCityAutocompletes } from "/city-autocomplete.js";
import { clearGuestMode } from "/guest-mode.js";

const NEXT_URL = "/create-listing.html?welcome=1";

const form = document.getElementById("bb-form");
const statusEl = document.getElementById("status");
const submitBtn = document.getElementById("bb-submit");
const nameInput = document.getElementById("bb-name");
const citySearch = document.getElementById("bb-city-search");
const cityHidden = document.getElementById("bb-city");

wireAllCityAutocompletes();

function setStatus(text, kind = "") {
  statusEl.textContent = text;
  statusEl.className = kind ? `gr-status ${kind}` : "gr-status";
}

function setFieldError(input, message) {
  const wrap = input.closest(".gr-label");
  let err = wrap.querySelector(":scope > .reg-field-error");
  if (!err) {
    err = document.createElement("p");
    err.className = "reg-field-error";
    err.id = `${input.id}-error`;
    wrap.appendChild(err);
  }
  err.textContent = message;
  err.hidden = false;
  input.setAttribute("aria-invalid", "true");
  const ids = (input.getAttribute("aria-describedby") || "").split(/\s+/).filter(Boolean);
  if (!ids.includes(err.id)) input.setAttribute("aria-describedby", [err.id, ...ids].join(" "));
}

function clearFieldError(input) {
  const err = input.closest(".gr-label")?.querySelector(":scope > .reg-field-error");
  if (err) {
    err.hidden = true;
    err.textContent = "";
  }
  input.removeAttribute("aria-invalid");
}

nameInput.addEventListener("input", () => clearFieldError(nameInput));
cityHidden.addEventListener("change", () => {
  if (cityHidden.value) clearFieldError(citySearch);
});

function validate() {
  clearFieldError(nameInput);
  clearFieldError(citySearch);
  const errors = [];
  if (!nameInput.value.trim()) {
    errors.push([nameInput, "Enter your business name."]);
  }
  if (!cityHidden.value.trim()) {
    errors.push([
      citySearch,
      citySearch.value.trim() ? "Pick your city from the list." : "Enter your city.",
    ]);
  }
  errors.forEach(([input, msg]) => setFieldError(input, msg));
  if (errors.length) errors[0][0].focus();
  return errors.length === 0;
}

let supabase = null;
let userId = null;

async function boot() {
  try {
    supabase = await getSupabaseClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      window.location.replace(`/signin.html?next=${encodeURIComponent("/business-basics.html")}`);
      return;
    }
    clearGuestMode();
    userId = session.user.id;

    const { data: profile } = await supabase
      .from("profiles")
      .select("role, business_profiles ( business_name, business_address )")
      .eq("id", userId)
      .maybeSingle();

    if (profile?.role !== "business_owner") {
      window.location.replace(profile?.role === "consultant" ? "/consultant-dashboard.html" : "/");
      return;
    }

    const bp = Array.isArray(profile.business_profiles)
      ? profile.business_profiles[0]
      : profile.business_profiles;
    // Already done (e.g. back button after finishing): move on.
    if (bp?.business_name && bp?.business_address) {
      window.location.replace(NEXT_URL);
      return;
    }
    if (bp?.business_name) nameInput.value = bp.business_name;

    form.hidden = false;
    setStatus("");
    nameInput.focus();
  } catch (err) {
    setStatus("We couldn't load your account. Refresh to try again.", "error");
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setStatus("");
  if (!validate() || !supabase || !userId) return;

  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";
  try {
    const { error } = await supabase
      .from("business_profiles")
      .update({
        business_name: nameInput.value.trim(),
        business_address: cityHidden.value.trim(),
      })
      .eq("user_id", userId);
    if (error) throw error;
    window.location.href = NEXT_URL;
  } catch (err) {
    setStatus("We couldn't save that. Try again in a moment.", "error");
    submitBtn.disabled = false;
    submitBtn.textContent = "Continue to your project";
  }
});

boot();
