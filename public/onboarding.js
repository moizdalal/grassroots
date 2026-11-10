// onboarding.js — new-user tooltip tutorial.
// Highlights one element at a time with a spotlight overlay + a tooltip
// bubble. State lives in localStorage for fast cross-page resume;
// final completion (or skip) is stamped on `profiles.onboarded_at` so
// the user isn't re-shown the tutorial.
//
// Triggers:
//   • ?welcome=1 in URL  → first run after register
//   • ?tutorial=1 in URL → forced replay (no DB read needed)
//   • localStorage active flag → resume mid-flow on the next page
//   • imported by settings.html for the "replay" button + steps 2-4
//
// Public surface (window.grassrootsOnboarding):
//   start()       — kick off from step 1, clears any seen-state
//   resume()      — resume from the persisted step
//   replay()      — alias for start, used by settings replay button
//   onStepChange  — internal; consumers can subscribe via the
//                   "grassroots:onboarding-step" CustomEvent on window

import { getSupabaseClient } from "/supabase-loader.js";
import { showToast } from "/toast.js";
import { ListingOperationError } from "/listing-operations.js";

const STORAGE_KEY = "grassroots_onboarding";
const TOOLTIP_ID = "gr-onboarding-tooltip";
const OVERLAY_ID = "gr-onboarding-overlay";
const VINE_ID = "gr-onboarding-vine";

/* ============================================================== */
/*                        STEP DEFINITIONS                         */
/* ============================================================== */

// Each step:
//   id            — stable identifier persisted in storage
//   label         — short text shown on dot-nav hover
//   path          — pathname this step lives on (router redirects there
//                   when the dot-nav jumps forward)
//   hash          — optional URL hash for tab-based pages (settings)
//   targetSelector — CSS selector for the spotlight. If null the
//                   tooltip renders centered with no spotlight (used
//                   for the end-of-tutorial "you're all set" panel).
//   placement     — preferred bubble side relative to target
//                   ('top' | 'bottom' | 'left' | 'right' | 'center')
//   title         — tooltip h2 copy
//   body          — tooltip paragraph
//   stub          — true while the actual interaction isn't wired yet;
//                   the bubble shows a "wip" note and the spotlight
//                   tracks the closest sensible anchor (or stays
//                   centered if no selector resolves).
// The "next →" button in the bubble is the primary advance trigger.
// `advanceOn` controls whether clicking the spotlight target itself
// also advances:
//   • "target" — nav-style steps (click "edit profile", click a tab)
//     advance when the user clicks the target. Required because the
//     click also navigates the user to a new page/view, and we need
//     the tutorial state to follow.
//   • "next" (default) — in-place steps. Only the next button
//     advances. Clicking the spotlight does its native action (upload
//     a photo, pick a theme, save the form) without moving the
//     tutorial along.
//
// `targetSelector` can be a string or an array tried in order.
// `allowedInteractive` on older consultant steps is now unused (the
// off-scope click guardrail is gone); it is harmless data.
//
// `kind: "choice"` renders decision buttons inside the bubble itself
// instead of pointing at a page element.
//
// Two flows live in this file:
//   • BUSINESS_STEPS — the owner walkthrough of the project form.
//   • CONSULTANT_STEPS — the consultant walkthrough (profile setup
//     incl. preview-as-business → stripe payouts → dashboard journey
//     → mock listing + offer → simulated garden).
// `STEPS` / `CHAPTERS` are `let`-bound and swapped to whichever flow
// matches the current user's role before the tutorial mounts. Storing
// `role` in localStorage state lets resume() restore the right flow
// without a network round-trip.
// Owner tour: the project form only. New owners arrive here from
// /business-basics.html (/create-listing.html?welcome=1). Profile
// photo, theme, and socials are no longer part of onboarding, and the
// dashboard "manage" chapter is gone. Each step names one field on the
// form. Copy matches the visible field labels ("Other ways to pay"
// stays collapsed, so the tour only names the default row).
// The form's primary buttons. The bubble never sits on top of these.
const FORM_PRIMARY_BUTTONS = ["#next-btn", "#back-btn", "#save-draft-btn", "#submit-btn"];
const BUSINESS_STEPS = [
  {
    id: "lw-title",
    label: "Title",
    path: "/create-listing.html",
    slide: 0,
    targetSelector: 'input[name="title"]',
    placement: "bottom",
    advanceOn: "next",
    title: "Name the project",
    body: "Use plain words. Students scan titles fast, so short and concrete works best.",
  },
  {
    id: "lw-preview",
    label: "Preview",
    path: "/create-listing.html",
    slide: 0,
    targetSelector: "#cl-preview",
    placement: "left",
    advanceOn: "next",
    title: "Your live preview",
    body: "This shows what students see in the marketplace. It updates as you type.",
  },
  {
    id: "lw-contract",
    label: "Contract",
    path: "/create-listing.html",
    slide: 0,
    targetSelector: ".ct-options",
    placement: "right",
    advanceOn: "next",
    title: "Pick how you'll pay",
    body: "One project, one payment fits most first projects. Other ways to pay are there if you need them.",
  },
  {
    id: "lw-context",
    label: "Context",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'textarea[name="issue_context"]',
    placement: "right",
    advanceOn: "next",
    title: "Add some context",
    body: "It's optional. A little background on the business helps students write a better offer.",
  },
  {
    id: "lw-problem",
    label: "Problem",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'textarea[name="business_problem"]',
    placement: "right",
    advanceOn: "next",
    title: "Say what you need done",
    body: "Name the one thing you want fixed or moved. A concrete goal beats a vague one.",
  },
  {
    id: "lw-output",
    label: "Output",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'textarea[name="expected_output"]',
    placement: "right",
    advanceOn: "next",
    title: "Say what you should have at the end",
    body: "Name the deliverable, its format, and how you plan to use it. That saves questions later.",
  },
  {
    id: "lw-details",
    label: "Details",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'textarea[name="additional_details"]',
    placement: "right",
    advanceOn: "next",
    title: "Anything else?",
    body: "Constraints, past attempts, audience, brand voice. It's optional, but it helps students scope.",
  },
  {
    id: "lw-attachments",
    label: "Files",
    path: "/create-listing.html",
    slide: 1,
    // `:has()` picks the whole <label> wrapping the file input so the
    // target covers the heading, button, and hint as one block.
    targetSelector: 'label:has(#listing-attachments)',
    placement: "right",
    advanceOn: "next",
    title: "Attach files if you have them",
    body: "Briefs, brand guides, or data help students scope. Up to 3 files, 5 MB each.",
  },
  {
    id: "lw-categories",
    label: "Tags",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#cat-multiselect",
    placement: "right",
    advanceOn: "next",
    title: "Tag the project",
    body: "One or two focused tags help the right students find it.",
  },
  {
    id: "lw-budget",
    label: "Budget",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: ".gr-money-range",
    placement: "right",
    advanceOn: "next",
    title: "Set your budget range",
    body: "Students size their offers to this range. Set it too tight and you get fewer offers.",
  },
  {
    id: "lw-turnaround",
    label: "Time",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: 'input[name="turnaround_days"]',
    placement: "right",
    advanceOn: "next",
    title: "Set the days to finish",
    body: "Count from accepting an offer to delivery. Leave room for revisions.",
  },
  {
    id: "lw-quals",
    label: "Skills",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#qual-list",
    placement: "right",
    advanceOn: "next",
    title: "List the skills you're looking for",
    body: "Two or three concrete skills help students decide if they fit.",
  },
  {
    id: "lw-publish",
    label: "Post",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#submit-btn",
    placement: "top",
    advanceOn: "next",
    title: "Post it when it's ready",
    body: "Read the preview one more time. We ask you to confirm before it goes live. Not ready yet? Save it as a draft.",
  },
  // No closing "you're set" bubble: after posting, listing.html shows
  // its own "Your project is live" panel, and the publish handler below
  // ends the tour. Clicking "Got it" here ends it too.
];

/* ============================================================== */
/*                  CONSULTANT FLOW — STEPS                         */
/* ============================================================== */

// Mirrors the business walkthrough's structure, but tailored to the
// consultant lifecycle: profile setup (with preview-as-business),
// stripe payouts, dashboard journey, then a tutorial-only mock listing
// where they make a fake offer, and finally a simulated garden showing
// the drag-to-garden interaction. The mock-listing and garden steps
// hit /listing.html?tutorial=1 and /consultant-dashboard.html?tutorial=garden;
// those URLs put the host pages in a fixture-only mode that never
// writes to the database.
const CONSULTANT_STEPS = [
  // ── chapter 1: profile setup ──
  {
    id: "c-edit-profile",
    label: "Profile",
    path: "/profile.html",
    targetSelector: '.pp-header__actions a[href*="settings"]',
    placement: "left",
    advanceOn: "target",
    title: "Let's set you up.",
    body: "Tap edit profile. Consultants live or die by their profile — businesses read every word.",
  },
  {
    id: "c-upload-photo",
    label: "Photo",
    path: "/settings.html",
    hash: "#personal",
    targetSelector: ["#pf-avatar-upload-label:not(.hidden)", "#pf-avatar-change-btn"],
    placement: "right",
    advanceOn: "next",
    title: "Show your face.",
    body: "A real photo earns trust. A clean headshot beats a logo every time.",
  },
  {
    id: "c-nav-general",
    label: "General",
    path: "/settings.html",
    targetSelector: '.settings-tab[data-tab="general"]',
    placement: "bottom",
    advanceOn: "target",
    title: "Next stop — themes.",
    body: "Open the general tab to pick how Grassroots looks for you.",
  },
  {
    id: "c-themes",
    label: "Themes",
    path: "/settings.html",
    hash: "#general",
    targetSelector: "#theme-grid",
    allowedInteractive: "#theme-grid .theme-card",
    placement: "bottom",
    advanceOn: "next",
    title: "Choose a theme",
    body: "Click a theme to apply it. Then click next.",
  },
  {
    id: "c-nav-professional",
    label: "Professional",
    path: "/settings.html",
    targetSelector: '.settings-tab[data-tab="professional"]',
    placement: "bottom",
    advanceOn: "target",
    title: "Open the professional tab",
    body: "This is where businesses read about you.",
  },
  {
    id: "c-education",
    label: "Education",
    path: "/settings.html",
    hash: "#professional",
    targetSelector: "#consultant-education-section",
    allowedInteractive: ["#save-btn", "#consultant-education-section input", "#consultant-education-section textarea"],
    placement: "right",
    advanceOn: "next",
    title: "Education.",
    body: "Tell businesses where you study. Major and school carry the most weight.",
  },
  {
    id: "c-resume",
    label: "Resume",
    path: "/settings.html",
    hash: "#professional",
    targetSelector: "#consultant-section",
    allowedInteractive: ["#save-btn", "#resume-input", "#pf-resume-upload-label", "#resume-current"],
    placement: "right",
    advanceOn: "next",
    title: "Drop in a resume.",
    body: "PDF only. You can toggle it public or private any time — start hidden if it's still rough.",
  },
  {
    id: "c-portfolio",
    label: "Work",
    path: "/settings.html",
    hash: "#professional",
    targetSelector: "#consultant-portfolio-section",
    allowedInteractive: ["#save-btn", "#portfolio-input", "#portfolio-desc", "#portfolio-list"],
    placement: "right",
    advanceOn: "next",
    title: "Past work.",
    body: "Add a few samples — decks, docs, images, video. Real artifacts build trust faster than copy.",
  },
  {
    id: "c-preview-as-business",
    label: "Preview",
    path: "/settings.html",
    hash: "#professional",
    targetSelector: "#pf-preview-bar",
    allowedInteractive: ["#pf-preview-trigger", "#pf-preview-modal", "[data-pf-preview-close]"],
    placement: "right",
    advanceOn: "next",
    title: "See yourself like a business does.",
    body: "Tap preview to open the same view businesses see when reading your proposals. Iterate until it looks sharp.",
  },

  // ── chapter 2: stripe payouts ──
  {
    id: "c-payouts-intro",
    label: "Payouts",
    path: "/settings.html",
    targetSelector: null,
    placement: "center",
    advanceOn: "next",
    title: "Set up payouts — about 5 minutes.",
    body: "We'll head to Stripe next. You need this to make offers and get paid — no payout setup, no money in. It's fast: a few identity questions and a bank account.",
  },
  {
    id: "c-nav-payouts",
    label: "Stripe",
    path: "/payouts.html",
    targetSelector: "#po-onboarding-section, #po-status-card",
    allowedInteractive: ["#po-onboarding", "#po-onboarding *", "#po-onboarding-section"],
    placement: "right",
    advanceOn: "next",
    title: "Connect with Stripe.",
    body: "Stripe runs identity + bank info for us. Follow the prompts in the embedded form — when it says active, you're good. Tap next here once you're done (or come back later).",
  },

  // ── chapter 3: dashboard journey ──
  {
    id: "c-dashboard-intro",
    label: "Home",
    path: "/consultant-dashboard.html",
    targetSelector: "#cdash-welcome",
    placement: "bottom",
    advanceOn: "next",
    title: "Welcome to your home.",
    body: "Your dashboard tracks every active opportunity at a glance. Let's walk through it.",
  },
  {
    id: "c-journey-panel",
    label: "Journey",
    path: "/consultant-dashboard.html",
    targetSelector: "#cdash-journey-panel",
    placement: "bottom",
    advanceOn: "next",
    title: "The engagement journey.",
    body: "Every offer you submit shows up here as a plant. It grows across five stages — offer sent, accepted, kickoff scheduled, work delivered, payout received — and blooms when you're paid.",
  },
  {
    id: "c-journey-signals",
    label: "Signals",
    path: "/consultant-dashboard.html",
    targetSelector: "#cdash-journey-panel",
    placement: "bottom",
    advanceOn: "next",
    title: "Reading the signals.",
    body: "Stage tells you where the work stands. A leaf turning amber means a deadline is near. A pulsing badge on a plant means the business sent you a message. Click any plant to jump to that engagement.",
  },
  {
    id: "c-health",
    label: "Health",
    path: "/consultant-dashboard.html",
    targetSelector: "#cdash-health",
    placement: "right",
    advanceOn: "next",
    title: "Keep your profile sharp.",
    body: "This card flags anything missing from your profile. Businesses skip incomplete profiles, so keep this in the green.",
  },

  // ── chapter 4: mock listing + offer ──
  {
    id: "c-mock-intro",
    label: "Marketplace",
    path: "/consultant-dashboard.html",
    targetSelector: null,
    placement: "center",
    advanceOn: "next",
    title: "Let's read a listing together.",
    body: "We'll open a sample opportunity next. The engagement is fake — nothing you do here charges money or notifies a real business.",
  },
  {
    id: "c-listing-bio",
    label: "Business",
    path: "/listing.html",
    query: "tutorial=1",
    targetSelector: "#ld-bio",
    placement: "right",
    advanceOn: "next",
    title: "Who you'd work with.",
    body: "The about-the-business panel shows who's posting. Read this first — fit matters as much as fee.",
  },
  {
    id: "c-listing-context",
    label: "Context",
    path: "/listing.html",
    query: "tutorial=1",
    targetSelector: "#ld-context-section",
    placement: "right",
    advanceOn: "next",
    title: "Context — the back-story.",
    body: "What's going on at the business. Helps you read between the lines of the problem statement.",
  },
  {
    id: "c-listing-problem",
    label: "Problem",
    path: "/listing.html",
    query: "tutorial=1",
    targetSelector: 'details[open] > #ld-summary, #ld-summary',
    placement: "right",
    advanceOn: "next",
    title: "Business problem — the goal.",
    body: "The outcome the business wants. Your offer should speak directly to this.",
  },
  {
    id: "c-listing-output",
    label: "Output",
    path: "/listing.html",
    query: "tutorial=1",
    targetSelector: "#ld-output-section",
    placement: "right",
    advanceOn: "next",
    title: "Standards of work.",
    body: "What good output looks like — format, rigor, how it'll be used. Quote your fee against this bar.",
  },
  {
    id: "c-listing-question",
    label: "Question",
    path: "/listing.html",
    query: "tutorial=1",
    targetSelector: "#ld-question-btn",
    allowedInteractive: ["#ld-question-btn"],
    placement: "right",
    advanceOn: "next",
    title: "Have a question?",
    body: "Use this to message the business before committing to a number. Fewer surprises later.",
  },
  {
    id: "c-make-offer",
    label: "Offer",
    path: "/listing.html",
    query: "tutorial=1",
    targetSelector: "#ld-offer-panel",
    allowedInteractive: ["#ld-bid-amount", "#ld-offer-msg-toggle", "#ld-offer-msg-wrap", "#ld-bid-message", "#ld-offer-breakdown"],
    placement: "left",
    advanceOn: "next",
    title: "Make an offer.",
    body: "Type an amount. The breakdown beneath shows your take-home. The platform fee is a flat 10% of your offer.",
  },
  {
    id: "c-submit-offer",
    label: "Submit",
    path: "/listing.html",
    query: "tutorial=1",
    targetSelector: "#ld-bid-submit",
    allowedInteractive: ["#ld-bid-submit", "#ld-bid-amount", "#ld-bid-message"],
    placement: "left",
    advanceOn: "target",
    title: "Submit when you're ready.",
    body: "This one's a dry run — go ahead and submit. Nothing leaves the tutorial.",
  },

  // ── chapter 5: simulated garden ──
  {
    id: "c-garden-intro",
    label: "Garden",
    path: "/consultant-dashboard.html",
    query: "tutorial=garden",
    targetSelector: "#cdash-journey-panel",
    placement: "bottom",
    advanceOn: "next",
    title: "Your future garden.",
    body: "Every engagement you finish becomes a flower. We filled in a sample garden so you can see what a healthy quarter looks like.",
  },
  {
    id: "c-garden-drop",
    label: "Drag",
    path: "/consultant-dashboard.html",
    query: "tutorial=garden",
    targetSelector: ".ejf-garden-tile, [data-garden-tile], .ejf__garden",
    placement: "left",
    advanceOn: "next",
    title: "Drag to garden.",
    body: "When an engagement blooms — stage five, payment received — drag the plant into your garden tile. It preserves the work as part of your resume.",
  },

  {
    id: "c-complete",
    label: "Done",
    path: null,
    targetSelector: null,
    placement: "center",
    advanceOn: "next",
    title: "You're set.",
    body: "Your tutorial replay lives in Settings → General. Now go win some work.",
  },
];

/* ============================================================== */
/*                        CHAPTERS                                  */
/* ============================================================== */

// Top-level grouping shown in the tooltip nav. The active chapter
// expands into its individual step dots; inactive chapters collapse
// into a single chip the user can click to jump in. `complete` is
// intentionally outside any chapter — it's the celebratory tail, not
// part of any teaching arc, so the nav doesn't show a dot for it.
const BUSINESS_CHAPTERS = [
  {
    id: "create-listing",
    label: "Post a project",
    stepIds: [
      "lw-title", "lw-preview", "lw-contract",
      "lw-context", "lw-problem", "lw-output", "lw-details", "lw-attachments",
      "lw-categories", "lw-budget", "lw-turnaround", "lw-quals",
      "lw-publish",
    ],
  },
];

const CONSULTANT_CHAPTERS = [
  {
    id: "c-profile-setup",
    label: "Profile setup",
    stepIds: [
      "c-edit-profile",
      "c-upload-photo",
      "c-nav-general",
      "c-themes",
      "c-nav-professional",
      "c-education",
      "c-resume",
      "c-portfolio",
      "c-preview-as-business",
    ],
  },
  {
    id: "c-payouts",
    label: "Payouts",
    stepIds: ["c-payouts-intro", "c-nav-payouts"],
  },
  {
    id: "c-dashboard",
    label: "Dashboard",
    stepIds: ["c-dashboard-intro", "c-journey-panel", "c-journey-signals", "c-health"],
  },
  {
    id: "c-first-offer",
    label: "First offer",
    stepIds: [
      "c-mock-intro",
      "c-listing-bio",
      "c-listing-context",
      "c-listing-problem",
      "c-listing-output",
      "c-listing-question",
      "c-make-offer",
      "c-submit-offer",
    ],
  },
  {
    id: "c-garden",
    label: "Garden",
    stepIds: ["c-garden-intro", "c-garden-drop"],
  },
];

// Active flow — swapped by setFlowByRole() before the tutorial renders.
// Default to the business arc so resume() on legacy state keeps working.
let STEPS = BUSINESS_STEPS;
let CHAPTERS = BUSINESS_CHAPTERS;

function setFlowByRole(role) {
  const consultant = role === "consultant";
  STEPS = consultant ? CONSULTANT_STEPS : BUSINESS_STEPS;
  CHAPTERS = consultant ? CONSULTANT_CHAPTERS : BUSINESS_CHAPTERS;
}

// Fetch current user's role from supabase. Defaults to "owner" on
// failure — the business flow is the safer fallback since the legacy
// surface assumes an owner.
async function fetchCurrentUserRole() {
  try {
    const client = await getSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return "owner";
    const { data } = await client
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    return data?.role === "consultant" ? "consultant" : "owner";
  } catch (_) {
    return "owner";
  }
}

function chapterOfStep(stepId) {
  return CHAPTERS.find((c) => c.stepIds.includes(stepId)) || null;
}

// Tooltip nav, two rows:
//   1. Chapter chips — one per chapter. Visited chips show a check;
//      the active chapter chip carries an accent border; future chips
//      are muted outlines. Clicking any chip jumps to that chapter's
//      first step.
//   2. Active chapter dots — one dot per step in the currently-active
//      chapter, centered under the chips row. Only the active chapter
//      reveals its dots; every other chapter's steps "collapse into"
//      its chip.
// Keeping it to two rows means the longest chapter (create-listing,
// 11 dots) still fits in the bubble width without horizontal scroll.
function buildChapterNav(currentStepId, currentIdx) {
  const currentChapter = chapterOfStep(currentStepId);

  // ── chapter chips row ──
  const chips = CHAPTERS.map((chapter) => {
    const stepIndices = chapter.stepIds
      .map((id) => stepIndexById(id))
      .filter((i) => i >= 0);
    if (!stepIndices.length) return null;

    const firstIdx = stepIndices[0];
    const lastChapIdx = stepIndices[stepIndices.length - 1];
    const isCurrent = chapter.id === currentChapter?.id;
    const isVisited = !isCurrent && lastChapIdx < currentIdx;
    const stateCls = isCurrent ? "is-current" : isVisited ? "is-visited" : "is-future";
    const stepCount = stepIndices.length;
    const aria = isCurrent
      ? `${chapter.label} (active, ${stepCount} step${stepCount === 1 ? "" : "s"})`
      : `Jump to ${chapter.label} (${stepCount} step${stepCount === 1 ? "" : "s"})`;
    const checkSvg = isVisited
      ? `<svg class='gr-onb-chapter-chip__check' viewBox='0 0 16 16' aria-hidden='true'><path d='M3 8.5 L6.5 12 L13 4.5' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/></svg>`
      : "";
    return `<button type='button' class='gr-onb-chapter-chip ${stateCls}' data-chapter-id='${escapeHtml(chapter.id)}' data-jump-step-idx='${firstIdx}' aria-label='${escapeHtml(aria)}' aria-current='${isCurrent ? "step" : "false"}' title='${escapeHtml(chapter.label)}'>
      ${checkSvg}
      <span class='gr-onb-chapter-chip__label'>${escapeHtml(chapter.label)}</span>
    </button>`;
  }).filter(Boolean);

  // A single-chapter flow (the owner tour) skips the chips row; the
  // dots alone show progress.
  const chipsRow = CHAPTERS.length > 1
    ? `<div class='gr-onb-chapnav__chips'>${chips.join('<span class="gr-onb-chap-line" aria-hidden="true"></span>')}</div>`
    : "";

  // ── active chapter's dots row ──
  let dotsRow = "";
  if (currentChapter) {
    const stepIndices = currentChapter.stepIds
      .map((id) => stepIndexById(id))
      .filter((i) => i >= 0);
    const dots = stepIndices
      .map((idx) => {
        const s = STEPS[idx];
        const cls =
          idx < currentIdx ? "is-visited" :
          idx === currentIdx ? "is-current" :
          "is-future";
        return `<button type='button' class='gr-onb-dot ${cls}' data-step-idx='${idx}' aria-label='Go to ${escapeHtml(s.label)}' title='${escapeHtml(s.label)}'>
          <span class='gr-onb-dot__hit'></span>
          <span class='gr-onb-dot__label'>${escapeHtml(s.label)}</span>
        </button>`;
      })
      .join('<span class="gr-onb-dot-line" aria-hidden="true"></span>');
    dotsRow = `<div class='gr-onb-chapnav__steps'>${dots}</div>`;
  }

  return chipsRow + dotsRow;
}

/* ============================================================== */
/*                      PERSISTENT STATE                           */
/* ============================================================== */

function readState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function writeState(state) {
  if (!state) {
    localStorage.removeItem(STORAGE_KEY);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (_) {}
}

function stepIndexById(id) {
  return STEPS.findIndex((s) => s.id === id);
}

// Resolve a step's targetSelector, which can be either a single CSS
// selector string or an array of selectors tried in order. An array
// member wins only if its match is a *visible* element (offsetParent
// !== null), which lets a step list mutually-exclusive states like
// "upload-label-when-no-avatar" and "change-button-when-avatar-set"
// and have the right one pick up automatically.
// Resolve a step's body text. Most steps carry a plain string; the
// listing-walkthrough steps carry { own, example } so the same step
// can read differently depending on which path the user picked at
// the listing-choice step (persisted in state.choice). Falls through
// to whichever variant exists if the chosen one isn't defined.
// Pick the right variant for a step field that can carry either a
// plain value or an { own, example } object keyed by listing-choice.
// Falls through to whichever variant is defined if the picked one
// isn't — so steps can declare partial variants safely.
function resolveStepVariant(value) {
  if (value == null) return null;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value;
  if (typeof value !== "object") return value;
  const choice = readState()?.choice;
  return value[choice] || value.own || value.example || null;
}

function resolveStepBody(step) {
  return resolveStepVariant(step?.body) || "";
}

function resolveStepTitle(step) {
  return resolveStepVariant(step?.title) || "";
}

// When the user picked "show me an example" at the listing-choice
// step, each walkthrough tooltip with an `example` payload fills its
// target field as it renders — so the form fills in incrementally
// rather than all-at-once. Also fills any prior walkthrough steps'
// examples to handle reload mid-flow (the create-listing handler is
// idempotent, so re-firing for already-filled fields is a no-op).
function maybeApplyStepExample(step) {
  if (readState()?.choice !== "example") return;
  const currentIdx = stepIndexById(step.id);
  STEPS.slice(0, currentIdx + 1).forEach((s) => {
    if (!s.example) return;
    window.dispatchEvent(new CustomEvent("cl:fill-example-field", { detail: s.example }));
  });
}

function resolveTarget(step) {
  if (!step?.targetSelector) return null;
  // Step can declare a per-variant targetSelector via { own, example }
  // — same pattern as body/title — so the lw-publish step can point
  // at #submit-btn for own users and #save-draft-btn for example
  // users. resolveStepVariant returns a string or an array.
  const resolved = resolveStepVariant(step.targetSelector);
  if (!resolved) return null;
  const selectors = Array.isArray(resolved) ? resolved : [resolved];
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el && el.offsetParent !== null) return el;
  }
  // Fall through to first match even if not visible — lets the polling
  // loop see "something exists" so it doesn't immediately bail. The
  // visibility check above only filters when there are multiple
  // candidates.
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    if (el) return el;
  }
  return null;
}

/* ============================================================== */
/*                          DB WRITE                               */
/* ============================================================== */

// Stamp profiles.onboarded_at so the tutorial doesn't re-auto-trigger.
// Best-effort: a failure here is non-fatal — the local state still
// clears so the user isn't re-prompted on this device.
async function markOnboardedInDb() {
  try {
    const client = await getSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    await client
      .from("profiles")
      .update({ onboarded_at: new Date().toISOString() })
      .eq("id", user.id);
  } catch (_) {}
}

// Inverse — used by the settings "replay" button so the next auto-start
// path actually triggers again. Fire-and-forget.
async function clearOnboardedInDb() {
  try {
    const client = await getSupabaseClient();
    const { data: { user } } = await client.auth.getUser();
    if (!user) return;
    await client
      .from("profiles")
      .update({ onboarded_at: null })
      .eq("id", user.id);
  } catch (_) {}
}

/* ============================================================== */
/*                      DOM HELPERS                                */
/* ============================================================== */

function ensureNode(id, tag = "div", parent = document.body) {
  let n = document.getElementById(id);
  if (!n) {
    n = document.createElement(tag);
    n.id = id;
    parent.appendChild(n);
  }
  return n;
}

function clearTutorialDom() {
  [TOOLTIP_ID, OVERLAY_ID, VINE_ID].forEach((id) => {
    const n = document.getElementById(id);
    if (n) n.remove();
  });
  document.body.classList.remove("gr-onboarding-active");
  stopVineSim();
}

// No spotlight dim during target steps — the page stays fully visible
// and the vine + bubble direct attention by themselves. Page-wide dim
// is reserved for the no-target ("center") steps (choice / complete),
// handled directly in position() via the .gr-onb-overlay--solid class.

/* ============================================================== */
/*                     VINE PHYSICS SIMULATION                     */
/* ============================================================== */

// A loose vine hangs from the middle of the tooltip bubble down to
// the spotlight target's center. Endpoints are pinned; the middle
// points fall under gravity and are pulled back via distance
// constraints so the chain holds together. Run at ~60 Hz via
// setTimeout (rAF gets throttled in background tabs / the preview
// harness; setTimeout stays consistent).

const VINE_SEGMENTS = 18;
const VINE_GRAVITY = 900; // px/s² in screen space
const VINE_DAMPING = 0.97;
const VINE_SLACK = 1.12; // segment length multiplier; kept low so the sag stays out of nearby text
// The vine only spans a short, empty gap. When the bubble had to dock
// far from its target, a long rope would cross form copy, so skip it.
const VINE_MAX_SPAN = 200;
// Per-leaf pendulum constants. Gravity stronger than the rope's so
// leaves swing more decisively + settle straight down. Damping is
// the air-resistance proxy — higher = leaves stop sooner.
const LEAF_GRAVITY = 1400;
const LEAF_DAMPING = 0.93;
const LEAF_LENGTH = 12; // distance from pivot to leaf tip (matches body height)
const VINE_CONSTRAINT_ITERS = 8;
// Five leaves spread evenly along the chain. Index fractions are
// computed from these so the leaves sit on actual verlet points
// (lets us read the tangent directly from neighbouring points).
const VINE_LEAF_COUNT = 5;

function ensureVineEl() {
  let svg = document.getElementById(VINE_ID);
  if (svg) return svg;
  const NS = "http://www.w3.org/2000/svg";
  svg = document.createElementNS(NS, "svg");
  svg.id = VINE_ID;
  svg.setAttribute("aria-hidden", "true");
  svg.classList.add("gr-onb-vine");
  svg.setAttribute("width", String(window.innerWidth));
  svg.setAttribute("height", String(window.innerHeight));
  svg.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);

  // Two stacked path strokes give the rope a bit of dimension —
  // darker shadow stroke beneath, lighter main stroke on top. The
  // shared `d` is set each tick by vineTick.
  const shadow = document.createElementNS(NS, "path");
  shadow.id = "gr-onb-vine-shadow";
  shadow.setAttribute("fill", "none");
  shadow.setAttribute("stroke", "rgba(15, 32, 24, 0.9)");
  shadow.setAttribute("stroke-width", "5");
  shadow.setAttribute("stroke-linecap", "round");
  shadow.setAttribute("stroke-linejoin", "round");
  svg.appendChild(shadow);

  const path = document.createElementNS(NS, "path");
  path.id = "gr-onb-vine-path";
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "3");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
  svg.appendChild(path);

  // Leaf shape — a single almond outline with an inner highlight that
  // suggests a midrib. Each leaf is its own <g> so we can transform
  // independently (position + rotation per tick).
  for (let i = 0; i < VINE_LEAF_COUNT; i++) {
    const leaf = document.createElementNS(NS, "g");
    leaf.setAttribute("id", `gr-onb-vine-leaf-${i}`);
    leaf.setAttribute("class", "gr-onb-vine-leaf");
    // Small leaf — ~14×16 in local coords. Big enough to read as
    // foliage, small enough to feel like a decoration on the rope
    // rather than competing with the bubble for attention.
    const stem = document.createElementNS(NS, "path");
    stem.setAttribute("d", "M 0 0 L 0 -2");
    stem.setAttribute("stroke", "rgba(15, 32, 24, 0.85)");
    stem.setAttribute("stroke-width", "1.1");
    stem.setAttribute("stroke-linecap", "round");
    leaf.appendChild(stem);
    const body = document.createElementNS(NS, "path");
    body.setAttribute("d", "M 0 -2 C 6 -3 7 -11 0 -16 C -7 -11 -6 -3 0 -2 Z");
    body.setAttribute("fill", "currentColor");
    body.setAttribute("stroke", "rgba(15, 32, 24, 0.7)");
    body.setAttribute("stroke-width", "0.8");
    body.setAttribute("stroke-linejoin", "round");
    leaf.appendChild(body);
    const midrib = document.createElementNS(NS, "path");
    midrib.setAttribute("d", "M 0 -3 L 0 -14");
    midrib.setAttribute("stroke", "rgba(15, 32, 24, 0.55)");
    midrib.setAttribute("stroke-width", "0.7");
    midrib.setAttribute("stroke-linecap", "round");
    leaf.appendChild(midrib);
    const veins = document.createElementNS(NS, "path");
    veins.setAttribute(
      "d",
      "M 0 -7 L 3 -10 M 0 -7 L -3 -10 M 0 -11 L 2.5 -13 M 0 -11 L -2.5 -13",
    );
    veins.setAttribute("stroke", "rgba(15, 32, 24, 0.4)");
    veins.setAttribute("stroke-width", "0.55");
    veins.setAttribute("stroke-linecap", "round");
    veins.setAttribute("fill", "none");
    leaf.appendChild(veins);
    svg.appendChild(leaf);
  }

  document.body.appendChild(svg);
  return svg;
}

function initVineState(startPt, endPt) {
  const points = [];
  for (let i = 0; i <= VINE_SEGMENTS; i++) {
    const t = i / VINE_SEGMENTS;
    const x = startPt.x + (endPt.x - startPt.x) * t;
    const y = startPt.y + (endPt.y - startPt.y) * t;
    points.push({ x, y, ox: x, oy: y });
  }
  const totalLen = Math.hypot(endPt.x - startPt.x, endPt.y - startPt.y) || 1;
  const restLength = (totalLen * VINE_SLACK) / VINE_SEGMENTS;
  return { points, restLength, lastT: performance.now() };
}

// Find where the line from `start` (outside `rect`) enters `rect`.
// Used to terminate the vine at the spotlight cutout's perimeter
// rather than at the target's center — so the rope visually attaches
// to the edge of the highlighted region and never covers its copy.
function rayRectEntry(start, end, rect) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return end;
  // Parametric line P(t) = start + t * (end - start), t in [0, 1].
  // For each edge we'd cross going outside-in, compute t; take the
  // smallest valid one. If start is already inside the rect (or no
  // edge is crossed), fall back to the end (target center).
  let tMin = 1;
  if (start.y < rect.top && dy > 0) {
    const t = (rect.top - start.y) / dy;
    const x = start.x + t * dx;
    if (t > 0 && t < tMin && x >= rect.left && x <= rect.right) tMin = t;
  }
  if (start.y > rect.bottom && dy < 0) {
    const t = (rect.bottom - start.y) / dy;
    const x = start.x + t * dx;
    if (t > 0 && t < tMin && x >= rect.left && x <= rect.right) tMin = t;
  }
  if (start.x < rect.left && dx > 0) {
    const t = (rect.left - start.x) / dx;
    const y = start.y + t * dy;
    if (t > 0 && t < tMin && y >= rect.top && y <= rect.bottom) tMin = t;
  }
  if (start.x > rect.right && dx < 0) {
    const t = (rect.right - start.x) / dx;
    const y = start.y + t * dy;
    if (t > 0 && t < tMin && y >= rect.top && y <= rect.bottom) tMin = t;
  }
  return { x: start.x + tMin * dx, y: start.y + tMin * dy };
}

function getVineAnchors() {
  const tooltip = document.getElementById(TOOLTIP_ID);
  if (!tooltip || !renderedStepId) return null;
  const step = STEPS[stepIndexById(renderedStepId)];
  if (!step) return null;
  // No vine on the choice / complete / no-target steps.
  if (!step.targetSelector || step.placement === "center" || step.kind === "choice") return null;
  const target = resolveTarget(step);
  if (!target) return null;
  const tr = tooltip.getBoundingClientRect();
  const targetR = target.getBoundingClientRect();
  const bubbleCenter = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
  const targetCenter = { x: targetR.left + targetR.width / 2, y: targetR.top + targetR.height / 2 };
  // Expand the target rect by the same pad as the spotlight cutout
  // and terminate the vine where the bubble→target line crosses that
  // expanded perimeter. This keeps the rope's end (and the leaves
  // near it) off of the button's copy.
  const pad = 14;
  const expanded = {
    left: targetR.left - pad,
    top: targetR.top - pad,
    right: targetR.right + pad,
    bottom: targetR.bottom + pad,
  };
  const endpoint = rayRectEntry(bubbleCenter, targetCenter, expanded);
  // Start at the bubble's edge rather than its center so the measured
  // span is the visible gap.
  const bubbleBox = { left: tr.left, top: tr.top, right: tr.right, bottom: tr.bottom };
  const start = rayRectEntry(targetCenter, bubbleCenter, bubbleBox);
  if (targetR.width === 0 && targetR.height === 0) return null;
  if (Math.hypot(endpoint.x - start.x, endpoint.y - start.y) > VINE_MAX_SPAN) return null;
  // Never draw across the bubble's own target or the gap's far side.
  if (overlapArea(bubbleBox, expanded) > 0) return null;
  return { start, end: endpoint, avoid: expanded };
}

// Push a rope point that sagged into the target's box back out to the
// nearest edge, so the vine and its leaves stay off the target's text.
function pushOutOfRect(p, rect) {
  if (!rect) return;
  if (p.x <= rect.left || p.x >= rect.right || p.y <= rect.top || p.y >= rect.bottom) return;
  const dl = p.x - rect.left;
  const dr = rect.right - p.x;
  const dt = p.y - rect.top;
  const db = rect.bottom - p.y;
  const m = Math.min(dl, dr, dt, db);
  if (m === dl) p.x = rect.left;
  else if (m === dr) p.x = rect.right;
  else if (m === dt) p.y = rect.top;
  else p.y = rect.bottom;
}

function vineTick() {
  if (!renderedStepId) {
    stopVineSim();
    return;
  }
  const anchors = getVineAnchors();
  const svg = document.getElementById(VINE_ID);
  const path = document.getElementById("gr-onb-vine-path");
  if (!anchors || !svg || !path) {
    if (svg) svg.classList.add("gr-onb-vine--hidden");
    vineTimer = setTimeout(vineTick, 32);
    return;
  }
  svg.classList.remove("gr-onb-vine--hidden");
  // Re-size SVG to current viewport every tick — cheap and keeps the
  // viewBox aligned with screen pixels at any zoom/resize.
  if (svg.getAttribute("width") !== String(window.innerWidth) ||
      svg.getAttribute("height") !== String(window.innerHeight)) {
    svg.setAttribute("width", String(window.innerWidth));
    svg.setAttribute("height", String(window.innerHeight));
    svg.setAttribute("viewBox", `0 0 ${window.innerWidth} ${window.innerHeight}`);
  }

  if (!vineState) {
    vineState = initVineState(anchors.start, anchors.end);
  }

  const now = performance.now();
  let dt = Math.min(0.05, (now - vineState.lastT) / 1000);
  if (dt <= 0) dt = 1 / 60;
  vineState.lastT = now;

  const pts = vineState.points;
  // Pin endpoints to current anchors. Setting both .x/.y and .ox/.oy
  // keeps the velocity at the anchors near zero — they shouldn't
  // contribute force into the chain just from being moved.
  pts[0].x = anchors.start.x;
  pts[0].y = anchors.start.y;
  pts[0].ox = anchors.start.x;
  pts[0].oy = anchors.start.y;
  const last = pts.length - 1;
  pts[last].x = anchors.end.x;
  pts[last].y = anchors.end.y;
  pts[last].ox = anchors.end.x;
  pts[last].oy = anchors.end.y;

  // Verlet integration for middle points: velocity = current − previous,
  // damp it, apply gravity, then commit.
  for (let i = 1; i < last; i++) {
    const p = pts[i];
    const vx = (p.x - p.ox) * VINE_DAMPING;
    const vy = (p.y - p.oy) * VINE_DAMPING;
    p.ox = p.x;
    p.oy = p.y;
    p.x += vx;
    p.y += vy + VINE_GRAVITY * dt * dt;
  }

  // Relax distance constraints. Multiple iterations keep the chain
  // tight without exploding under large endpoint moves (drag).
  for (let iter = 0; iter < VINE_CONSTRAINT_ITERS; iter++) {
    for (let i = 0; i < last; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.hypot(dx, dy) || 1;
      const diff = (dist - vineState.restLength) / dist;
      const ax = dx * diff * 0.5;
      const ay = dy * diff * 0.5;
      if (i !== 0) {
        a.x += ax;
        a.y += ay;
      }
      if (i + 1 !== last) {
        b.x -= ax;
        b.y -= ay;
      }
    }
    for (let i = 1; i < last; i++) pushOutOfRect(pts[i], anchors.avoid);
  }

  // Build a smooth path through the points (Catmull-Rom → cubic
  // Bezier conversion). Sufficiently smooth for the rope look.
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < last; i++) {
    const p0 = pts[i === 0 ? 0 : i - 1];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2 > last ? last : i + 2];
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d +=
      ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)},` +
      ` ${c2x.toFixed(1)} ${c2y.toFixed(1)},` +
      ` ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  path.setAttribute("d", d);
  const shadow = document.getElementById("gr-onb-vine-shadow");
  if (shadow) shadow.setAttribute("d", d);

  // Each leaf is its own tiny pendulum. The pivot point on the rope
  // moves every frame; the leaf's tip is a free verlet point pulled
  // by gravity and tethered to the pivot by a fixed-length
  // constraint. The leaf's rotation tracks the pivot→tip direction,
  // so the leaf swings naturally when the rope shifts and settles
  // pointing straight down at rest. `LEAF_DAMPING` is the
  // air-resistance proxy — it bleeds velocity each frame so the
  // swings settle instead of oscillating forever.
  if (!leafStates) {
    leafStates = [];
    for (let i = 0; i < VINE_LEAF_COUNT; i++) {
      leafStates.push({
        // Per-leaf length variation so they don't all swing in
        // perfect lockstep. ±2px around the base.
        length: LEAF_LENGTH + ((i * 13) % 5) - 2,
        tip: { x: 0, y: 0, ox: 0, oy: 0 },
        initialized: false,
      });
    }
  }

  for (let i = 0; i < VINE_LEAF_COUNT; i++) {
    const ratio = (i + 1) / (VINE_LEAF_COUNT + 1);
    const idx = Math.max(1, Math.min(last - 1, Math.round(ratio * last)));
    const pivot = pts[idx];
    const ls = leafStates[i];

    if (!ls.initialized) {
      // Start hanging straight down at the pivot — looks natural on
      // first paint, no big swing to settle from.
      ls.tip.x = pivot.x;
      ls.tip.y = pivot.y + ls.length;
      ls.tip.ox = ls.tip.x;
      ls.tip.oy = ls.tip.y;
      ls.initialized = true;
    }

    // Verlet step on the tip.
    const vx = (ls.tip.x - ls.tip.ox) * LEAF_DAMPING;
    const vy = (ls.tip.y - ls.tip.oy) * LEAF_DAMPING;
    ls.tip.ox = ls.tip.x;
    ls.tip.oy = ls.tip.y;
    ls.tip.x += vx;
    ls.tip.y += vy + LEAF_GRAVITY * dt * dt;

    // Distance constraint to the pivot — keeps the leaf at fixed
    // length from its anchor point on the rope.
    const dx = ls.tip.x - pivot.x;
    const dy = ls.tip.y - pivot.y;
    const dist = Math.hypot(dx, dy) || 1;
    const factor = (dist - ls.length) / dist;
    ls.tip.x -= dx * factor;
    ls.tip.y -= dy * factor;

    // Rotation: angle from pivot to tip. Local leaf geometry points
    // straight up (body extends to negative y), so adding 90° aligns
    // local "up" with the world pivot→tip direction.
    const a = Math.atan2(ls.tip.y - pivot.y, ls.tip.x - pivot.x) * (180 / Math.PI);
    const rotation = a + 90;

    const leafEl = document.getElementById(`gr-onb-vine-leaf-${i}`);
    if (leafEl) {
      leafEl.setAttribute(
        "transform",
        `translate(${pivot.x.toFixed(1)},${pivot.y.toFixed(1)}) rotate(${rotation.toFixed(1)})`,
      );
    }
  }

  vineTimer = setTimeout(vineTick, 16);
}

function startVineSim() {
  if (vineTimer) return;
  ensureVineEl();
  // First tick on a slight delay so the bubble + target have settled
  // into their initial positions.
  vineTimer = setTimeout(vineTick, 50);
}

function stopVineSim() {
  if (vineTimer) {
    clearTimeout(vineTimer);
    vineTimer = null;
  }
  vineState = null;
  leafStates = null;
}

// Restart the simulation on step transition so the rope re-seeds at
// the new endpoints instead of swinging wildly across the page.
function restartVineForStep() {
  vineState = null;
  // Force leaves to re-hang straight down at the new step's
  // pivots instead of carrying velocity from the previous step.
  leafStates = null;
  if (!vineTimer) startVineSim();
}

/* ============================================================== */
/*                       RENDERING                                 */
/* ============================================================== */

let renderedStepId = null;
let resizeObserver = null;
let trackLoopActive = false;
// Vine physics state — verlet-integrated rope hanging between the
// bubble center and the target center. Initialized lazily; null when
// no tutorial is active.
let vineState = null;
let vineTimer = null;
// Each leaf has its own pendulum: a free "tip" point connected to
// its attachment point on the rope by a fixed-length constraint.
// Gravity pulls the tip down; verlet damping = air resistance.
// Mounted lazily alongside the rope.
let leafStates = null;
// True after the user has dragged the bubble for the current step.
// While true, position() leaves the bubble alone (the cutout still
// updates). Resets on every step transition so the next step's
// natural placement comes back.
let userDraggedBubble = false;

function renderStep(stepId) {
  const step = STEPS[stepIndexById(stepId)];
  if (!step) return;
  // Track whether this is the very first render of a session (no
  // tooltip in DOM yet) vs a step transition (tooltip stays alive
  // across steps). First mount = pop-in animation, no slide. Step
  // transition = slide via the --settled class.
  const tooltipExisted = !!document.getElementById(TOOLTIP_ID);
  // Reset the drag flag so each new step gets its natural placement
  // back. The user's drag persists only within the current step.
  userDraggedBubble = false;
  renderedStepId = stepId;
  document.body.classList.add("gr-onboarding-active");

  // Ask the create-listing wizard to align to this step's slide. Safe
  // on every page — only the wizard listens, and the wizard no-ops if
  // the slide is already correct. Covers both transitionTo and the
  // post-navigation resume path so a dot-jump from any starting page
  // lands the wizard on the right slide.
  if (step.slide !== undefined && window.location.pathname === "/create-listing.html") {
    window.dispatchEvent(new CustomEvent("cl:request-slide", { detail: { slide: step.slide } }));
  }

  const target = resolveTarget(step);

  // Overlay — sits below the bubble, masks everything except a hole
  // around the target. Uses inline style for the mask coords so it
  // tracks any target movement (scroll, layout shift, etc.).
  const overlay = ensureNode(OVERLAY_ID);
  overlay.className = "gr-onb-overlay";
  overlay.innerHTML = "";

  // Tooltip bubble — we replace its markup but keep the element so the
  // CSS top/left transition can interpolate the position. The settled
  // class survives across step transitions; on first mount it's added
  // once the entrance animation completes (animationend listener).
  const tooltip = ensureNode(TOOLTIP_ID);
  const wasSettled = tooltip.classList.contains("gr-onb-tooltip--settled");
  tooltip.className =
    `gr-onb-tooltip gr-onb-tooltip--${step.placement || "right"}` +
    (wasSettled ? " gr-onb-tooltip--settled" : "");
  tooltip.innerHTML = buildTooltipMarkup(step);
  attachTooltipHandlers(tooltip);
  attachDragHandlers(tooltip);

  // Example-mode tutorial: fill this step's target field (and any
  // earlier walkthrough fields, for resume safety) before we resolve
  // placement so the input event fires and the right-rail preview is
  // up to date when the bubble settles.
  maybeApplyStepExample(step);

  if (!tooltipExisted) {
    // Listen once for the entrance to wrap up, then flip on the slide
    // transition so subsequent step changes interpolate.
    tooltip.addEventListener(
      "animationend",
      () => tooltip.classList.add("gr-onb-tooltip--settled"),
      { once: true },
    );
  }

  // The CSS transition on the hole element handles smooth movement
  // between steps — no rAF interpolation needed. The first paint
  // skips the transition (handled inside position() via holeMounted).
  position(step, target);
  setupAdvanceClick(step, target);

  // If the spotlight target sits outside the current scroll viewport
  // (e.g. user dot-jumped to a panel further down the dashboard),
  // bring it into view. Skip for center-placement steps since they
  // don't have a meaningful target. nearest-block keeps the page
  // from jerking when the target is already partly visible.
  if (target && step.placement !== "center") {
    const r = target.getBoundingClientRect();
    const offTop = r.bottom < 0;
    const offBottom = r.top > window.innerHeight;
    if (offTop || offBottom) {
      try {
        target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
      } catch (_) {
        target.scrollIntoView();
      }
    }
  }

  // The page may still be laying out (settings panels swap, image
  // loads, fonts settle). Re-run position a few times over the next
  // ~2s so the spotlight + bubble follow the target into place even
  // when only the *position* changes (ResizeObserver only fires on
  // size changes, so it doesn't catch a pure layout shift).
  [120, 350, 800, 1600].forEach((ms) => {
    setTimeout(() => {
      if (renderedStepId !== step.id) return;
      const fresh = resolveTarget(step);
      position(step, fresh || target);
    }, ms);
  });

  // Reposition on viewport changes.
  if (resizeObserver) resizeObserver.disconnect();
  if (target && "ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(() => position(step, target));
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(target);
  }
  window.addEventListener("scroll", onScrollReposition, { passive: true, capture: true });
  window.addEventListener("resize", onResizeReposition);
  // visualViewport fires for pinch-zoom + browser zoom (Ctrl+/-)
  // where the plain `resize` event may not. Without these the
  // spotlight + arrow drift away from the target when the user
  // changes zoom mid-tutorial.
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onResizeReposition);
    window.visualViewport.addEventListener("scroll", onScrollReposition);
  }

  // Defensive continuous reposition. Browser zoom and certain
  // layout shifts don't always fire resize / ResizeObserver, and the
  // spotlight drifting out of alignment is the most visible failure
  // mode. Diffing the rect signature each tick keeps the work cheap
  // — position() only runs when the target actually moves.
  startTrackLoop();
  // Re-seed the vine each step so it starts from the line between
  // the new bubble + new target rather than swinging across the page.
  restartVineForStep();

  // Notify other modules that a step changed (used for analytics
  // / external hooks — currently a no-op consumer).
  window.dispatchEvent(new CustomEvent("grassroots:onboarding-step", { detail: { step } }));
}

// No off-scope click guardrail: clicking empty page space (to close a
// dropdown, say) used to pop an "are you leaving?" modal. Only the
// bubble's close and skip controls end the tour now.

function onScrollReposition() {
  if (!renderedStepId) return;
  const step = STEPS[stepIndexById(renderedStepId)];
  const target = resolveTarget(step);
  position(step, target);
}
function onResizeReposition() {
  onScrollReposition();
}

// Continuous track loop. Runs ~10x/sec while the tutorial is active,
// diffing the target's rect signature so we only call position() when
// the target actually moved. Catches the cases where neither resize,
// scroll, ResizeObserver, nor visualViewport.resize fire — most
// notably Ctrl+/- browser zoom in some engines.
function startTrackLoop() {
  if (trackLoopActive) return;
  trackLoopActive = true;
  let lastSig = "";
  function tick() {
    if (!renderedStepId) {
      trackLoopActive = false;
      return;
    }
    const step = STEPS[stepIndexById(renderedStepId)];
    const target = step ? resolveTarget(step) : null;
    const vv = window.visualViewport;
    const scale = vv?.scale ?? 1;
    if (target) {
      const r = target.getBoundingClientRect();
      const sig = `${r.left.toFixed(1)},${r.top.toFixed(1)},${r.width.toFixed(1)},${r.height.toFixed(1)},${scale.toFixed(3)},${innerWidth},${innerHeight}`;
      if (sig !== lastSig) {
        position(step, target);
        lastSig = sig;
      }
    } else {
      // Even with no target (center placement), re-check viewport
      // dimensions in case zoom changed them.
      const sig = `center,${scale.toFixed(3)},${innerWidth},${innerHeight}`;
      if (sig !== lastSig) {
        position(step, null);
        lastSig = sig;
      }
    }
    setTimeout(tick, 100);
  }
  setTimeout(tick, 100);
}

// Margin the bubble keeps from every viewport edge, at all widths.
const VIEW_MARGIN = 16;
const BUBBLE_GAP = 40;

function overlapArea(a, b) {
  const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
  const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
  return w > 0 && h > 0 ? w * h : 0;
}

function visibleRects(selectors) {
  const out = [];
  selectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (el.offsetParent === null) return;
      const r = el.getBoundingClientRect();
      if (r.width && r.height) out.push(r);
    });
  });
  return out;
}

function clampBubble(x, y, w, h, vw, vh) {
  return {
    x: Math.max(VIEW_MARGIN, Math.min(vw - w - VIEW_MARGIN, x)),
    y: Math.max(VIEW_MARGIN, Math.min(vh - h - VIEW_MARGIN, y)),
  };
}

// Pick a bubble position that (1) stays inside the viewport with a
// margin, (2) never covers its own target, and (3) never covers the
// form's primary buttons. Tries the step's preferred side first, then
// the other sides, then the four viewport corners, and keeps the first
// candidate with no overlap. If every candidate overlaps something
// (tiny screens), the one covering the least wins, weighted so the
// target counts most.
function chooseBubblePosition(step, r, w, h, vw, vh) {
  const pad = 8;
  const targetBox = {
    left: Math.max(0, r.left) - pad,
    top: Math.max(0, r.top) - pad,
    right: Math.min(vw, r.right) + pad,
    bottom: Math.min(vh, r.bottom) + pad,
  };
  const avoid = visibleRects(FORM_PRIMARY_BUTTONS);
  const sides = {
    left: () => ({ x: r.left - w - BUBBLE_GAP, y: r.top + r.height / 2 - h / 2 }),
    right: () => ({ x: r.right + BUBBLE_GAP, y: r.top + r.height / 2 - h / 2 }),
    top: () => ({ x: r.left + r.width / 2 - w / 2, y: r.top - h - BUBBLE_GAP }),
    bottom: () => ({ x: r.left + r.width / 2 - w / 2, y: r.bottom + BUBBLE_GAP }),
  };
  const preferred = sides[step.placement] ? step.placement : "bottom";
  const order = [preferred, ...["right", "left", "bottom", "top"].filter((k) => k !== preferred)];
  const candidates = order.map((k) => sides[k]());
  candidates.push(
    { x: vw - w - VIEW_MARGIN, y: VIEW_MARGIN },
    { x: VIEW_MARGIN, y: VIEW_MARGIN },
    { x: vw - w - VIEW_MARGIN, y: vh - h - VIEW_MARGIN },
    { x: VIEW_MARGIN, y: vh - h - VIEW_MARGIN },
  );
  let best = null;
  for (const c of candidates) {
    const p = clampBubble(c.x, c.y, w, h, vw, vh);
    const box = { left: p.x, top: p.y, right: p.x + w, bottom: p.y + h };
    const score =
      overlapArea(box, targetBox) * 4 +
      avoid.reduce((sum, a) => sum + overlapArea(box, a) * 2, 0);
    if (score === 0) return p;
    if (!best || score < best.score) best = { ...p, score };
  }
  return best;
}

function position(step, target /*, options */) {
  const overlay = document.getElementById(OVERLAY_ID);
  const tooltip = document.getElementById(TOOLTIP_ID);
  if (!overlay || !tooltip) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // A target that exists but isn't rendered (e.g. the preview rail on
  // a narrow screen) has a zero rect. Center the bubble without dim so
  // the step still reads instead of pinning to the top-left corner.
  const r = target ? target.getBoundingClientRect() : null;
  const targetHidden = !!r && r.width === 0 && r.height === 0;

  if (!target || step.placement === "center" || targetHidden) {
    // No-target step (choice / complete) — by default the overlay
    // goes solid so the centered bubble has focus. Steps that need
    // the page to stay interactive can opt out via step.noDim.
    if (step.noDim || targetHidden) {
      overlay.classList.remove("gr-onb-overlay--solid");
    } else {
      overlay.classList.add("gr-onb-overlay--solid");
    }
    if (!userDraggedBubble) {
      tooltip.style.left = `50%`;
      tooltip.style.top = `50%`;
      tooltip.style.transform = `translate(-50%, -50%)`;
    }
    return;
  }

  // Target steps — no dim. The vine + tooltip bubble guide the user.
  // Skipping the dim entirely sidesteps every zoom failure mode we
  // hit with mask/clip-path/box-shadow/4-rect overlays: there's
  // nothing positioned against the viewport that can desync.
  overlay.classList.remove("gr-onb-overlay--solid");

  // Once the user has dragged the bubble for this step, leave it
  // wherever they parked it.
  if (userDraggedBubble) return;

  // Measure the real rendered size. The old code assumed 320px while
  // the CSS draws 440px, so the clamp let the bubble run past the right
  // edge and clip the next button.
  const w = tooltip.offsetWidth || 320;
  const h = tooltip.offsetHeight || 200;
  const p = chooseBubblePosition(step, r, w, h, vw, vh);
  tooltip.style.left = `${p.x}px`;
  tooltip.style.top = `${p.y}px`;
  tooltip.style.transform = "";
}

/* ============================================================== */
/*                       TOOLTIP MARKUP                            */
/* ============================================================== */

function buildTooltipMarkup(step) {
  const currentIdx = stepIndexById(step.id);
  const lastIdx = STEPS.length - 1;
  const dots = buildChapterNav(step.id, currentIdx);

  const isLast = currentIdx === lastIdx;
  const isFirst = currentIdx === 0;

  // Choice steps render inline decision buttons inside the bubble
  // instead of pointing at a page element. Each choice carries an
  // optional href so the click can navigate the user (e.g. to
  // /create-listing.html with or without an `example=1` flag).
  const choicesHtml = step.kind === "choice" && Array.isArray(step.choices)
    ? `<div class='gr-onb-choices'>
        ${step.choices.map((c) => `
          <button type='button'
                  class='gr-onb-choice${c.primary ? " gr-onb-choice--primary" : ""}'
                  data-onb-action='choice'
                  data-choice-id='${escapeHtml(c.id)}'
                  data-choice-href='${escapeHtml(c.href || "")}'
                  data-choice-action='${escapeHtml(c.action || "")}'>
            ${escapeHtml(c.label)}
          </button>
        `).join("")}
       </div>`
    : "";

  // Choice steps own their advance via the inline cards — no
  // page-side "next" button. Same on the final "complete" step which
  // gets a "got it" close instead.
  const hasInlineAdvance = step.kind === "choice" || isLast;
  const primaryBtn = isLast
    ? `<button type='button' class='gr-onb-btn gr-onb-btn--primary' data-onb-action='complete'>Got it</button>`
    : (hasInlineAdvance
        ? ""
        : `<button type='button' class='gr-onb-btn gr-onb-btn--primary' data-onb-action='advance'>Next →</button>`);

  return `
    <button type='button' class='gr-onb-close' data-onb-action='close' aria-label='Close tutorial'>×</button>
    <nav class='gr-onb-dotnav' aria-label='Tutorial steps'>${dots}</nav>
    <h2 class='gr-onb-title'>${escapeHtml(resolveStepTitle(step))}</h2>
    <p class='gr-onb-body'>${escapeHtml(resolveStepBody(step))}</p>
    ${choicesHtml}
    <div class='gr-onb-actions'>
      ${isFirst ? "" : `<button type='button' class='gr-onb-skip gr-onb-skip--back' data-onb-action='back'>← Back</button>`}
      ${primaryBtn}
      <button type='button' class='gr-onb-skip gr-onb-skip--end' data-onb-action='close'>Skip</button>
    </div>
  `;
}

// Make the bubble draggable. Mousedown anywhere on the bubble that
// isn't an interactive control starts a drag; the bubble follows the
// cursor until mouseup. Sets `userDraggedBubble` so position() skips
// auto-placement for the rest of this step — letting the user park
// the bubble out of the way while they read or interact.
function attachDragHandlers(tooltip) {
  let dragStart = null;
  let bubbleStart = null;

  function onPointerDown(e) {
    // Don't start a drag from a button/link click — those keep their
    // native behavior (advance, close, dot-nav jump, etc.).
    if (e.target.closest("button, a, [data-onb-action]")) return;
    // Primary mouse / touch only.
    if (e.button !== undefined && e.button !== 0) return;
    const rect = tooltip.getBoundingClientRect();
    dragStart = { x: e.clientX, y: e.clientY };
    bubbleStart = { x: rect.left, y: rect.top };
    tooltip.classList.add("gr-onb-tooltip--dragging");
    // Capture so the move/up events still fire if the cursor leaves
    // the bubble while dragging.
    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp, { once: true });
    e.preventDefault();
  }

  function onPointerMove(e) {
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    const w = tooltip.offsetWidth;
    const h = tooltip.offsetHeight;
    let nx = bubbleStart.x + dx;
    let ny = bubbleStart.y + dy;
    // Keep at least a 12px margin so the bubble doesn't get parked
    // entirely off-screen and become unreachable.
    nx = Math.max(VIEW_MARGIN, Math.min(window.innerWidth - w - VIEW_MARGIN, nx));
    ny = Math.max(VIEW_MARGIN, Math.min(window.innerHeight - h - VIEW_MARGIN, ny));
    tooltip.style.left = `${nx}px`;
    tooltip.style.top = `${ny}px`;
    tooltip.style.transform = "";
  }

  function onPointerUp() {
    document.removeEventListener("pointermove", onPointerMove);
    tooltip.classList.remove("gr-onb-tooltip--dragging");
    if (dragStart) userDraggedBubble = true;
    dragStart = null;
    bubbleStart = null;
  }

  tooltip.addEventListener("pointerdown", onPointerDown);
}

function attachTooltipHandlers(tooltip) {
  tooltip.querySelectorAll("[data-onb-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = btn.dataset.onbAction;
      e.preventDefault();
      // "advance" — inline "skip" link reads as "skip this step / move
      // on" rather than "exit the tutorial". The × close button is the
      // global exit. "skip" is still routed (legacy / programmatic) to
      // the full-exit path.
      if (action === "advance") advance();
      else if (action === "close" || action === "skip") skip();
      else if (action === "back") retreat();
      else if (action === "complete") complete();
      else if (action === "choice") handleChoice(btn);
    });
  });
  tooltip.querySelectorAll(".gr-onb-dot").forEach((dot) => {
    dot.addEventListener("click", () => {
      const idx = Number(dot.dataset.stepIdx);
      if (!Number.isFinite(idx)) return;
      goToIndex(idx);
    });
  });
  // Collapsed chapter chips jump to that chapter's first step.
  tooltip.querySelectorAll(".gr-onb-chapter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const idx = Number(chip.dataset.jumpStepIdx);
      if (!Number.isFinite(idx)) return;
      goToIndex(idx);
    });
  });
}

// User picked an option on a "choice" step. The choice can carry:
//   • href   — navigate to that URL (legacy listing-choice flow).
//   • action — call a registered async handler (cleanup coda flow).
//   • neither — pure transition to the next step.
// All three paths persist the chosen variant so downstream tutorial
// steps can read it from state (e.g. the listing walkthrough reads
// state.choice to pick own/example body copy).
async function handleChoice(btn) {
  const choiceId = btn.dataset.choiceId || "";
  const href = btn.dataset.choiceHref || "";
  const actionName = btn.dataset.choiceAction || "";
  const state = readState() || { active: true, stepId: STEPS[0].id };
  const idx = stepIndexById(state.stepId);
  const nextIdx = Math.min(STEPS.length - 1, idx + 1);
  const next = STEPS[nextIdx];

  if (actionName && CHOICE_ACTIONS[actionName]) {
    // Lock the bubble while the action runs so a double-click can't
    // queue the destroy twice. Restore on failure so the user can
    // retry; success cases redirect or transition past this bubble.
    btn.disabled = true;
    const previousLabel = btn.textContent;
    btn.textContent = "Working…";
    try {
      const result = await CHOICE_ACTIONS[actionName](state);
      // Action handler can override the natural "next step in array"
      // jump. Cleanup coda actions point to `complete` so the example
      // path matches the own path (both skip lm-placeholder).
      const targetStepId = result?.nextStepId || next.id;
      const targetStep = STEPS.find((s) => s.id === targetStepId) || next;
      writeState({ ...state, stepId: targetStep.id, choice: state.choice || choiceId });
      if (result?.redirectTo) {
        window.location.href = result.redirectTo;
        return;
      }
      transitionTo(targetStep);
    } catch (err) {
      btn.disabled = false;
      btn.textContent = previousLabel;
      const msg = err instanceof ListingOperationError
        ? err.message
        : err?.message || "Something went wrong.";
      showToast(msg, { kind: "error", duration: 5000 });
    }
    return;
  }

  // Stash the chosen variant so downstream tutorial steps + the
  // create-listing page can read it (e.g. to pre-fill an example).
  writeState({ active: true, stepId: next.id, choice: choiceId });
  if (href) {
    window.location.href = href;
    return;
  }
  transitionTo(next);
}

// Look up the listing this coda is operating on. Preferred source is
// the tutorial state (set when `cl:listing-published` fires), but
// state can be stale if the bubble was reached via the dot-nav or
// after a refresh. As a fallback read `?id=` from the URL — the
// example-cleanup bubble lands on /listing.html?id=X, so the id is
// right there in the address bar.
function resolveCodaListingId(state) {
  if (state?.lastListingId) return state.lastListingId;
  try {
    const params = new URLSearchParams(window.location.search);
    const idFromUrl = params.get("id");
    if (idFromUrl) return idFromUrl;
  } catch (_) {}
  return null;
}

// Registry of async actions a choice button can invoke. Each returns
// either undefined (normal transition) or { redirectTo, nextStepId }.
// Empty since the owner example coda was retired with the shorter tour.
const CHOICE_ACTIONS = {};

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/* ============================================================== */
/*                  TARGET CLICK ADVANCE                           */
/* ============================================================== */

let activeAdvanceHandler = null;
let activeAdvanceEls = [];

function setupAdvanceClick(step, target) {
  // Tear down any previous binding so we don't fire stale advances.
  if (activeAdvanceHandler) {
    activeAdvanceEls.forEach((el) => el.removeEventListener("click", activeAdvanceHandler, true));
  }
  activeAdvanceEls = [];
  activeAdvanceHandler = null;
  // Choice steps drive their own advance via inline buttons in the
  // bubble. In-place steps advance only via the "next" button; the
  // spotlight target's click does its native action (open file
  // picker, apply theme, save the form) without moving the tutorial.
  // Only nav-style steps wire a target-click to advance.
  if (step.kind === "choice") return;
  if (step.advanceOn !== "target") return;
  if (!target) return;

  activeAdvanceHandler = () => { advance(); };
  target.addEventListener("click", activeAdvanceHandler, true);
  activeAdvanceEls = [target];
}

/* ============================================================== */
/*                       STATE TRANSITIONS                         */
/* ============================================================== */

// Build a full URL for a step, including the optional ?query string
// (used by consultant tutorial steps that boot the host page in
// fixture-only mode, e.g. listing.html?tutorial=1).
function stepUrl(step) {
  const q = step.query ? (step.query.startsWith("?") ? step.query : `?${step.query}`) : "";
  return (step.path || "") + q + (step.hash || "");
}

// True when the destination URL would actually require navigation
// (path mismatch OR query-string mismatch — same path with a new
// `?tutorial=1` still needs to reload so the host page picks up
// fixture mode).
function needsCrossPageNav(step) {
  if (step.path && step.path !== window.location.pathname) return true;
  if (step.query) {
    const want = new URLSearchParams(step.query.startsWith("?") ? step.query.slice(1) : step.query);
    const have = new URLSearchParams(window.location.search);
    for (const [k, v] of want) {
      if (have.get(k) !== v) return true;
    }
  }
  return false;
}

// Shared transition helper. Writes state, then either does a full
// navigation (cross-page), a hash swap (tab switch on settings.html),
// or an in-place re-render — whichever matches the next step's path
// and hash relative to the current URL.
function transitionTo(step) {
  // Preserve incidental state fields (like `choice` from the listing
  // path selection) so they survive every step transition.
  const prev = readState() || {};
  writeState({ ...prev, active: true, stepId: step.id });
  // Cross-page: full navigation. The destination page's onboarding.js
  // will pick up the persisted state and resume.
  if (needsCrossPageNav(step)) {
    window.location.href = stepUrl(step);
    return;
  }
  // Same page, different hash → trigger the settings tab switch and
  // wait one tick for the panel swap before re-rendering so the new
  // target is in the DOM + visible.
  if (step.hash && step.hash !== window.location.hash) {
    window.location.hash = step.hash;
    setTimeout(() => waitForTargetThenRender(step), 60);
    return;
  }
  renderStep(step.id);
}

function advance() {
  const state = readState() || { active: true, stepId: STEPS[0].id };
  const idx = stepIndexById(state.stepId);
  const currentStep = STEPS[idx];

  // Optional explicit jump — a step can declare `nextStepId` to break
  // out of the array-order flow. Used by coda steps that should leap
  // past an unfinished chapter (e.g. example-saved-draft → complete,
  // skipping lm-placeholder).
  const overrideStep = currentStep?.nextStepId
    ? STEPS.find((s) => s.id === currentStep.nextStepId)
    : null;
  const nextStep = overrideStep || STEPS[idx + 1];

  // Cross-slide jump — drive the wizard's "continue" so the form
  // moves with the tutorial. The cl:slide-changed listener below
  // will then sync the tooltip to the first step on the new slide.
  // Same-slide advances are pure tooltip moves (just transitionTo).
  if (
    currentStep?.slide !== undefined &&
    nextStep?.slide !== undefined &&
    nextStep.slide > currentStep.slide
  ) {
    const formNext = document.getElementById("next-btn");
    if (formNext && !formNext.classList.contains("hidden")) {
      formNext.click();
      return;
    }
  }

  if (overrideStep) {
    transitionTo(overrideStep);
    return;
  }
  const nextIdx = Math.min(STEPS.length - 1, idx + 1);
  transitionTo(STEPS[nextIdx]);
}

function retreat() {
  const state = readState() || { active: true, stepId: STEPS[0].id };
  const idx = stepIndexById(state.stepId);
  const currentStep = STEPS[idx];
  const prevStep = STEPS[idx - 1];

  // Cross-slide retreat — drive the wizard's "back" so the form
  // moves with the tutorial. cl:slide-changed will then land the
  // tooltip on the LAST step of the previous slide (so the user
  // doesn't lose their position).
  if (
    currentStep?.slide !== undefined &&
    prevStep?.slide !== undefined &&
    prevStep.slide < currentStep.slide
  ) {
    const formBack = document.getElementById("back-btn");
    if (formBack && !formBack.classList.contains("hidden")) {
      formBack.click();
      return;
    }
  }

  const prevIdx = Math.max(0, idx - 1);
  transitionTo(STEPS[prevIdx]);
}

function goToIndex(idx) {
  transitionTo(STEPS[Math.max(0, Math.min(STEPS.length - 1, idx))]);
}

function skip() {
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
  showToast(
    "Tour closed. Replay it any time from Settings → General.",
    { kind: "info", duration: 4500 }
  );
}

function complete() {
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
  showToast(
    "You're set. Replay the tour any time from Settings → General.",
    { kind: "success", duration: 4500 }
  );
}

/* ============================================================== */
/*                      AUTO START / RESUME                        */
/* ============================================================== */

// Internal: kick off a tutorial flow with a specific role already
// resolved. The public `start` wraps this with role detection.
function startForRole(role) {
  setFlowByRole(role);
  writeState({ active: true, stepId: STEPS[0].id, role });
  const first = STEPS[0];
  if (needsCrossPageNav(first)) {
    window.location.href = stepUrl(first);
    return;
  }
  // Defer one tick so the host page has time to paint its initial DOM
  // before we try to query for the target element.
  // Use setTimeout 0 (not requestAnimationFrame) so the kickoff runs
  // even when the tab is backgrounded — rAF gets throttled to 1Hz or
  // worse outside the foreground, which silently breaks auto-start.
  setTimeout(() => waitForTargetThenRender(first), 0);
}

// Public start — used by the settings replay button. Detects the
// current user's role before kicking off so consultants get the
// consultant arc and owners get the owner arc.
async function start() {
  const role = await fetchCurrentUserRole();
  startForRole(role);
}

function waitForTargetThenRender(step, attempt = 0) {
  if (!step.targetSelector) {
    renderStep(step.id);
    return;
  }
  const target = resolveTarget(step);
  if (target) {
    renderStep(step.id);
    return;
  }
  // Up to ~15 seconds of polling — profile + settings load auth +
  // data async and the target element only appears after several
  // network roundtrips. We also attach a MutationObserver below as a
  // fallback so we don't sit waiting if a slow page exceeds the cap.
  if (attempt > 300) return;
  if (attempt === 0) {
    // First miss — kick off a MutationObserver so we render the
    // moment the target appears, not 50ms after.
    const mo = new MutationObserver(() => {
      const el = resolveTarget(step);
      if (el) {
        mo.disconnect();
        renderStep(step.id);
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    // Tear down the observer after the polling window closes so it
    // doesn't leak on pages that never produce the target.
    setTimeout(() => mo.disconnect(), 16000);
  }
  setTimeout(() => waitForTargetThenRender(step, attempt + 1), 50);
}

function resume() {
  const state = readState();
  if (!state?.active) return false;
  // Restore the flow that was active when this state was written. Lets
  // a consultant who landed mid-tutorial on a different page (e.g.
  // settings.html navigation, then back to dashboard) pick up the
  // consultant arc rather than defaulting to the business arc.
  if (state.role) setFlowByRole(state.role);
  const step = STEPS[stepIndexById(state.stepId)];
  if (!step) {
    // Stale state from an older tour (e.g. the removed owner profile
    // chapter). Drop it so it doesn't linger.
    writeState(null);
    return false;
  }
  if (step.path && step.path !== window.location.pathname) {
    // The user is on a different page than the persisted step — don't
    // auto-redirect, just leave the state in place so the next visit
    // to that page picks it up. Avoids surprising redirects.
    return false;
  }
  // Align hash if the step expects a specific view/tab and the URL is
  // somewhere else (e.g. the dashboard landed at #listings after the
  // save-draft redirect but the resuming step lives on the home view).
  // The settings + dashboard pages both react to hashchange, so this
  // is enough to swap the visible panel before we render.
  if (step.hash && step.hash !== window.location.hash) {
    window.location.hash = step.hash;
    setTimeout(() => waitForTargetThenRender(step), 60);
    return true;
  }
  setTimeout(() => waitForTargetThenRender(step), 0);
  return true;
}

async function maybeAutoStart() {
  const params = new URLSearchParams(window.location.search);
  if (params.get("tutorial") === "1") {
    // Hard restart — clear any state and run from the top.
    writeState(null);
    await clearOnboardedInDb();
    const role = await fetchCurrentUserRole();
    startForRole(role);
    return;
  }
  if (params.get("welcome") === "1") {
    // Fresh from register. Only auto-start if they haven't already been
    // marked onboarded (defensive — a previous run might have stamped
    // them even though they didn't actually finish).
    try {
      const client = await getSupabaseClient();
      const { data: { user } } = await client.auth.getUser();
      if (!user) {
        const role = await fetchCurrentUserRole();
        startForRole(role);
        return;
      }
      const { data } = await client
        .from("profiles")
        .select("onboarded_at, role")
        .eq("id", user.id)
        .maybeSingle();
      if (!data?.onboarded_at) {
        startForRole(data?.role === "consultant" ? "consultant" : "owner");
        return;
      }
    } catch (_) {
      const role = await fetchCurrentUserRole();
      startForRole(role);
      return;
    }
  }
  // Resume mid-flow if the user is mid-tutorial and lands on the right
  // page (e.g. they clicked edit profile and arrived at settings).
  resume();
}

/* ============================================================== */
/*                        PUBLIC SURFACE                           */
/* ============================================================== */

window.grassrootsOnboarding = {
  start,
  replay: start,
  resume,
  skip,
  complete,
  goToIndex,
};

/* ============================================================== */
/*               LISTING WALKTHROUGH SYNC                          */
/* ============================================================== */

// When the create-listing wizard changes slide, snap the tutorial to
// a walkthrough step that targets that slide. Multiple tooltip steps
// share a slide now (one per field) — going forward lands on the
// FIRST field of the new slide; going back lands on the LAST so the
// user resumes where they left off.
window.addEventListener("cl:slide-changed", (e) => {
  const state = readState();
  if (!state?.active) return;
  const current = STEPS[stepIndexById(state.stepId)];
  if (!current || current.slide === undefined) return;
  const targetSlide = Number(e.detail?.slide);
  if (!Number.isFinite(targetSlide) || targetSlide === current.slide) return;
  const stepsOnTarget = STEPS.filter((s) => s.slide === targetSlide);
  if (!stepsOnTarget.length) return;
  const goingForward = targetSlide > current.slide;
  const next = goingForward
    ? stepsOnTarget[0]
    : stepsOnTarget[stepsOnTarget.length - 1];
  transitionTo(next);
});

// Successful publish ends the owner tour. The next page
// (/listing.html?posted=1) shows its own "Your project is live" panel,
// so a closing bubble there would repeat it.
window.addEventListener("cl:listing-published", () => {
  const state = readState();
  if (!state?.active) return;
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
});

// Save-as-draft ends the owner tour. The draft is real work in
// progress, and the dashboard has no tour steps anymore, so leaving
// state active would only resurrect the bubble on a later visit.
window.addEventListener("cl:listing-saved-as-draft", () => {
  const state = readState();
  if (!state?.active) return;
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
});

document.addEventListener("DOMContentLoaded", () => {
  maybeAutoStart();
});
// In case DOMContentLoaded already fired (script loaded late), also run
// immediately. maybeAutoStart is idempotent — it reads URL + DB state.
if (document.readyState === "complete" || document.readyState === "interactive") {
  maybeAutoStart();
}
