import { getSupabaseClient } from "/supabase-loader.js";

const $ = (id) => document.getElementById(id);
let pollInterval = null;
let stripeConnect = null;
let mountedComponents = { onboarding: false, management: false, payouts: false, documents: false };

// Read a theme token off the root, with a fallback for safety.
function tk(name, fallback = "") {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

// Build a fresh Stripe appearance object from the current theme tokens.
// Called on init and again on `grassroots:themechange` so the embedded
// iframe stays in sync with the four themes (dark-forest, forest-soft,
// dark, light).
//
// Flat-on-page treatment: we use the *page* background (--fo-bg) for
// Stripe's surface so its internal section cards visually merge with
// the page. Borders are kept faint so form inputs still have edges.
function buildStripeAppearance() {
  const bg = tk("--fo-bg", "#ffffff");
  return {
    overlays: "dialog",
    variables: {
      // Type
      fontFamily: "Figtree, system-ui, sans-serif",
      fontSizeBase: "15px",
      // Surfaces — match the page bg so the iframe blends in.
      colorBackground: bg,
      // Text
      colorText: tk("--fo-text", "#0f1f1a"),
      colorSecondaryText: tk("--fo-text-2", "#6b7a72"),
      // Borders — faint enough for inputs/sections to almost disappear.
      colorBorder: tk("--fo-line", "rgba(45,106,79,0.08)"),
      borderRadius: "12px",
      formAccentColor: tk("--fo-accent", "#2d6a4f"),
      // Accents (links, primary buttons, focus rings)
      colorPrimary: tk("--fo-accent", "#2d6a4f"),
      actionPrimaryColorText: tk("--fo-accent", "#2d6a4f"),
      actionSecondaryColorText: tk("--fo-text-2", "#6b7a72"),
      // Primary button
      buttonPrimaryColorBackground: tk("--fo-accent", "#2d6a4f"),
      buttonPrimaryColorText: tk("--fo-accent-on", "#ffffff"),
      buttonPrimaryColorBorder: tk("--fo-accent", "#2d6a4f"),
      // Secondary button — flat on the page bg, faint border.
      buttonSecondaryColorBackground: bg,
      buttonSecondaryColorText: tk("--fo-text", "#0f1f1a"),
      buttonSecondaryColorBorder: tk("--fo-line", "rgba(45,106,79,0.08)"),
      // Destructive (matches our `--fo-plan` coral)
      colorDanger: tk("--fo-plan", "#d97757"),
      colorDangerText: tk("--fo-plan", "#d97757"),
    },
  };
}

// Friendlier labels for Stripe's machine-readable requirements_due strings.
// We don't translate everything — anything we miss falls back to a humanized
// version of the original key.
const REQUIREMENT_LABELS = {
  "individual.id_number": "Social security number (SSN) or ITIN",
  "individual.ssn_last_4": "Last 4 digits of your SSN",
  "individual.first_name": "First name",
  "individual.last_name": "Last name",
  "individual.dob.day": "Date of birth",
  "individual.dob.month": "Date of birth",
  "individual.dob.year": "Date of birth",
  "individual.address.line1": "Home address",
  "individual.address.city": "Home address (city)",
  "individual.address.state": "Home address (state)",
  "individual.address.postal_code": "Home address (zip)",
  "individual.email": "Email address",
  "individual.phone": "Phone number",
  "individual.verification.document": "Government-issued ID photo",
  "individual.verification.additional_document": "Additional ID document",
  "external_account": "Bank account for payouts",
  "tos_acceptance.date": "Accept Stripe's terms of service",
  "business_profile.url": "Website URL",
  "business_profile.product_description": "What kind of work you offer",
  "business_profile.mcc": "Industry / category",
};

function humanizeRequirement(key) {
  if (REQUIREMENT_LABELS[key]) return REQUIREMENT_LABELS[key];
  // Fallback: turn `individual.foo_bar.baz` into "individual foo bar baz"
  return String(key).replace(/[._]/g, " ");
}

function dedupeRequirements(list) {
  const seen = new Set();
  const out = [];
  for (const key of list) {
    const label = humanizeRequirement(key);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

async function authedFetch(client, url, options = {}) {
  const build = async () => {
    const { data: { session } } = await client.auth.getSession();
    const headers = new Headers(options.headers || {});
    if (session?.access_token) headers.set("Authorization", `Bearer ${session.access_token}`);
    if (options.body && !(options.body instanceof FormData)) headers.set("Content-Type", "application/json");
    return headers;
  };
  let res = await fetch(url, { ...options, headers: await build() });
  // Supabase access tokens expire after ~1 hour. If the server rejects
  // a stale token, force a refresh and retry once before bubbling the
  // 401 up to the page (which would otherwise show "sign in required.").
  if (res.status === 401) {
    try { await client.auth.refreshSession(); } catch (_) {}
    res = await fetch(url, { ...options, headers: await build() });
    if (res.status === 401) {
      window.location.replace("/signin.html?next=" + encodeURIComponent(window.location.pathname));
      return res;
    }
  }
  return res;
}

// Number → "$1,234.56" (or "—" when the value isn't a finite cents int).
function formatUsd(cents) {
  if (!Number.isFinite(Number(cents))) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(Number(cents) / 100);
}
// Stripe payout `arrival_date` is a unix-seconds int. We format as
// "may 16" — short month + day, lowercase per voice, no year unless
// the payout is from a previous calendar year.
function formatPayoutDate(arrivalDate) {
  if (!arrivalDate) return null;
  const d = new Date(Number(arrivalDate) * 1000);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const sameYear = d.getUTCFullYear() === now.getUTCFullYear();
  return d.toLocaleDateString("en-US", sameYear
    ? { month: "short", day: "numeric" }
    : { month: "short", day: "numeric", year: "numeric" });
}
async function refreshBalanceSummary(client) {
  const card = $("po-balance");
  if (!card) return;
  try {
    const res = await authedFetch(client, "/api/stripe/balance-summary");
    if (!res.ok) { card.hidden = true; return; }
    const data = await res.json();
    if (!data?.onboarded) { card.hidden = true; return; }
    card.hidden = false;
    $("po-balance-available").textContent = formatUsd(data.available_cents);
    $("po-balance-pending").textContent = formatUsd(data.pending_cents);
    if (data.last_payout) {
      const when = formatPayoutDate(data.last_payout.arrival_date);
      $("po-balance-last").textContent = when
        ? `${formatUsd(data.last_payout.amount_cents)} · ${when}`
        : formatUsd(data.last_payout.amount_cents);
    } else {
      $("po-balance-last").textContent = "No payouts yet";
    }
  } catch (_) {
    // A transient stripe blip shouldn't leave a half-broken card up.
    card.hidden = true;
  }
}

async function refreshStatus(client) {
  try {
    const res = await authedFetch(client, "/api/stripe/account-status");
    const data = await res.json();
    const card = $("po-status-card");
    const dot = $("po-status-dot");
    const label = $("po-status-label");
    const detail = $("po-status-detail");
    const requirements = $("po-status-requirements");
    const reqCollapsible = $("po-requirements-collapsible");
    card.hidden = false;
    if (data.onboarded) {
      dot.dataset.state = "active";
      label.textContent = "Payouts active — you're all set.";
      // Active accounts don't need the "stripe still needs"
      // collapsible at all — hide the whole element.
      if (reqCollapsible) reqCollapsible.hidden = true;
      requirements.innerHTML = "";
      // Flip the page H1 + subtitle out of onboarding voice once the
      // account is active — same page handles both states.
      const pageTitle = $("po-page-title");
      const pageSub = $("po-page-subtitle");
      if (pageTitle) pageTitle.innerHTML = 'Your <span class="fo-title-italic">payouts</span>';
      if (pageSub) pageSub.textContent = "Manage your bank, tax info, and recent transfers. Funds release to your account when engagements complete.";
      document.title = "Grassroots — your payouts";
      $("po-onboarding-section").hidden = true;
      $("po-active-section").hidden = false;
      refreshBalanceSummary(client);
      mountAccountManagement();
      mountPayouts();
      mountDocuments();
      stopPolling();
    } else {
      dot.dataset.state = data.details_submitted ? "review" : "pending";
      label.textContent = data.details_submitted
        ? "Verification in progress"
        : "Finish setting up your account";
      const due = dedupeRequirements(data.requirements_due || []);
      if (due.length) {
        detail.textContent = "Stripe still needs:";
        requirements.innerHTML = due.map((d) => `<li>${escapeHtml(d)}</li>`).join("");
        if (reqCollapsible) reqCollapsible.hidden = false;
      } else if (data.details_submitted) {
        detail.textContent = "Stripe is reviewing your submission. This can take a moment.";
        requirements.innerHTML = "";
        if (reqCollapsible) reqCollapsible.hidden = false;
      } else {
        // No specific requirements to list and no submission
        // yet — the onboarding card above already explains the
        // next step, so hide the collapsible entirely.
        detail.textContent = "";
        requirements.innerHTML = "";
        if (reqCollapsible) reqCollapsible.hidden = true;
      }
      $("po-onboarding-section").hidden = false;
      $("po-active-section").hidden = true;
    }
    return data;
  } catch (_) {
    return null;
  }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Collapsible sections — each .po-collapsible has a data-section-key
// (e.g. "account-info", "payouts-history") that we use as the
// localStorage record. Default state is expanded; we only persist the
// *collapsed* set so a fresh user lands with everything open without
// any seed data. Listeners attach once on init and survive any
// refreshStatus() re-renders because we never touch the head buttons.
const COLLAPSE_STORAGE_KEY = "grassroots_payouts_collapsed";
function readCollapsedSet() {
  try {
    const raw = localStorage.getItem(COLLAPSE_STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch { return new Set(); }
}
function writeCollapsedSet(set) {
  try {
    localStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify([...set]));
  } catch {}
}
function setupCollapsibles() {
  const collapsed = readCollapsedSet();
  document.querySelectorAll(".po-collapsible").forEach((section) => {
    const key = section.dataset.sectionKey;
    const head = section.querySelector(".po-collapsible__head");
    if (!key || !head) return;
    const isCollapsed = collapsed.has(key);
    section.classList.toggle("is-collapsed", isCollapsed);
    head.setAttribute("aria-expanded", String(!isCollapsed));
    head.addEventListener("click", () => {
      const nowCollapsed = !section.classList.contains("is-collapsed");
      section.classList.toggle("is-collapsed", nowCollapsed);
      head.setAttribute("aria-expanded", String(!nowCollapsed));
      const set = readCollapsedSet();
      if (nowCollapsed) set.add(key); else set.delete(key);
      writeCollapsedSet(set);
    });
  });
}

function startPolling(client) {
  if (pollInterval) return;
  pollInterval = setInterval(() => refreshStatus(client), 8000);
}
function stopPolling() {
  if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
}

function mountAccountManagement() {
  if (mountedComponents.management || !stripeConnect) return;
  const mgmt = stripeConnect.create("account-management");
  $("po-management").appendChild(mgmt);
  mountedComponents.management = true;
}

function mountPayouts() {
  if (mountedComponents.payouts || !stripeConnect) return;
  const payouts = stripeConnect.create("payouts");
  $("po-payouts").appendChild(payouts);
  mountedComponents.payouts = true;
}

function mountDocuments() {
  if (mountedComponents.documents || !stripeConnect) return;
  const documents = stripeConnect.create("documents");
  $("po-documents").appendChild(documents);
  mountedComponents.documents = true;
}

// US-person attestation. The server refuses an account session until one
// is on file, so this is the only way into the Stripe flow. Resolves once
// the server has saved it.
function showAttestation(client, version) {
  const section = $("po-attest");
  const checkbox = $("po-attest-checkbox");
  const submit = $("po-attest-submit");
  const error = $("po-attest-error");
  $("po-gate").hidden = true;
  section.hidden = false;
  checkbox.addEventListener("change", () => { submit.disabled = !checkbox.checked; });
  return new Promise((resolve) => {
    submit.addEventListener("click", async () => {
      if (!checkbox.checked) return;
      submit.disabled = true;
      error.hidden = true;
      try {
        const res = await authedFetch(client, "/api/stripe/us-person-attestation", {
          method: "POST",
          body: JSON.stringify({ us_person: true, version }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || "Could not save your confirmation.");
        section.hidden = true;
        $("po-gate").hidden = false;
        resolve();
      } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
        submit.disabled = !checkbox.checked;
      }
    });
  });
}

async function requestAccountSession(client) {
  const res = await authedFetch(client, "/api/stripe/account-session", { method: "POST" });
  const data = await res.json().catch(() => ({}));
  return { res, data };
}

async function init() {
  const gate = $("po-gate");
  try {
    const client = await getSupabaseClient();
    const { data: { session } } = await client.auth.getSession();
    if (!session?.user) {
      window.location.replace("/signin.html?next=" + encodeURIComponent("/payouts.html"));
      return;
    }
    const { data: profile } = await client.from("profiles").select("role").eq("id", session.user.id).maybeSingle();
    if (profile?.role && profile.role !== "consultant") {
      gate.textContent = "Payouts setup is for consultants only.";
      gate.className = "gr-status";
      return;
    }

    let { res: sessionRes, data: sessionData } = await requestAccountSession(client);
    if (sessionRes.status === 403 && sessionData.code === "attestation_required") {
      await showAttestation(client, sessionData.attestation_version);
      ({ res: sessionRes, data: sessionData } = await requestAccountSession(client));
    }
    if (!sessionRes.ok) throw new Error(sessionData.error || "Could not start onboarding.");

    // The v1.0 script-tag SDK exposes `StripeConnect.init(...)` (sync,
    // returns the instance directly). The async `loadConnectAndInitialize`
    // belongs to the npm `@stripe/connect-js` package — different surface.
    stripeConnect = StripeConnect.init({
      publishableKey: sessionData.publishable_key,
      fetchClientSecret: async () => sessionData.client_secret,
      // Inject Figtree into the iframe so Stripe's UI uses our type
      // family (the iframe is cross-origin — it can't reach the parent
      // page's loaded fonts, so we have to declare them here too).
      fonts: [{
        cssSrc: "https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap",
      }],
      appearance: buildStripeAppearance(),
    });

    // Re-apply appearance whenever the theme changes so the embedded
    // component tracks dark-forest / forest-soft / dark / light.
    window.addEventListener("grassroots:themechange", () => {
      try {
        stripeConnect?.update({ appearance: buildStripeAppearance() });
      } catch (err) {
        console.warn("[payouts] could not push theme update to Stripe:", err);
      }
    });

    const onboarding = stripeConnect.create("account-onboarding");
    // Collect eventually_due fields now (full SSN/ITIN, not just the last
    // 4) so the IRS TIN match runs at setup instead of blocking a payout
    // mid-engagement once the consultant nears the 1099-K threshold.
    onboarding.setCollectionOptions({ fields: "eventually_due", futureRequirements: "include" });
    onboarding.setOnExit(() => refreshStatus(client));
    $("po-onboarding").appendChild(onboarding);
    mountedComponents.onboarding = true;

    gate.hidden = true;
    $("po-shell").hidden = false;
    setupCollapsibles();
    const status = await refreshStatus(client);

    // Auto-poll while pending so the UI flips to active when Stripe finishes
    // verifying. Polling is cheap (one supabase round-trip + one Stripe API
    // call), and the webhook is what really drives DB state — this is just
    // for the open tab.
    if (!status?.onboarded) startPolling(client);
  } catch (err) {
    console.error(err);
    gate.textContent = err.message || "Could not load payouts setup.";
    gate.className = "gr-status error";
  }
}

window.addEventListener("beforeunload", stopPolling);

// Stripe Connect.js exposes itself as `StripeConnect` on window.
const waitForStripe = () => new Promise((resolve) => {
  if (window.StripeConnect) return resolve();
  const id = setInterval(() => {
    if (window.StripeConnect) { clearInterval(id); resolve(); }
  }, 50);
});

waitForStripe().then(init);
