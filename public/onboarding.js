// onboarding.js — new-user guided walkthrough.
// Dims the page with a soft spotlight overlay, cuts a rounded hole
// around one element at a time, and shows a movable card that says
// what to do there. The overlay never takes pointer events, so the
// highlighted element (and anything else on the page: file pickers,
// dropdowns, modals, the avatar cropper) stays fully usable.
// State lives in localStorage for fast cross-page resume; final
// completion (or ending the tour) is stamped on `profiles.onboarded_at`
// so the user isn't re-shown the walkthrough.
//
// Triggers:
//   • ?welcome=1 in URL  → first run after register
//   • ?tutorial=1 in URL → forced replay (no DB read needed)
//   • localStorage active flag → resume mid-flow on the next page
//   • imported by settings.html for the "replay" button
//
// Public surface (window.grassrootsOnboarding):
//   start()       — kick off from step 1, clears any seen-state
//   resume()      — resume from the persisted step
//   replay()      — alias for start, used by settings replay button
//   A "grassroots:onboarding-step" CustomEvent fires on window each
//   time a step renders.

import { getSupabaseClient } from "/supabase-loader.js";
import { showToast } from "/toast.js";
import { ListingOperationError } from "/listing-operations.js";

const STORAGE_KEY = "grassroots_onboarding";
// Where the user parked the card. Session-scoped: it follows them
// across pages in this tab and resets on the next visit.
const CARD_POS_KEY = "grassroots_onboarding_card";
const TOOLTIP_ID = "gr-onboarding-tooltip";
const OVERLAY_ID = "gr-onboarding-overlay";

/* ============================================================== */
/*                        STEP DEFINITIONS                         */
/* ============================================================== */

// Each step:
//   id            — stable identifier persisted in storage. listing.js
//                   writes "c-garden-intro" directly, so keep that id.
//   label         — short text shown on dot-nav hover
//   path          — pathname this step lives on. null = render on
//                   whatever page the user is on.
//   hash / query  — optional URL hash (settings tabs) / query string
//                   (fixture modes such as listing.html?tutorial=1)
//   targetSelector — CSS selector for the spotlight (string, or an
//                   array tried in order; the first *visible* match
//                   wins). null = centered card on a fully dimmed page.
//   also          — extra selectors folded into the spotlight cutout
//                   when visible (a dropdown, a file list, an "add"
//                   button that sits just outside the target).
//   ready         — selector that must be visible (or a function that
//                   must return true) before the page counts as loaded. Lets a step whose target never
//                   shows up be skipped quickly instead of hanging.
//   placement     — preferred card side relative to the target
//   mode          — what the step asks of the user:
//                     "do"   — make a change in the highlighted area.
//                              The card shows "Your turn" until `done`
//                              is true, then "Done".
//                     "go"   — click the highlighted control; that
//                              click moves the tour along.
//                     "look" — read only, nothing to do.
//   optional      — "do" steps the form does not require
//   done          — for "do" steps: a function (target) => boolean
//                   that reads the page, or "touch" (default) which
//                   counts any click / change inside the spotlight.
//   title / body  — card copy. Sentence case, second person, full
//                   sentences, no exclamation points.
//
// The card's main button is always available. It reads "Next" once the
// step is done (or needs nothing), and "Skip for now" while a "do"
// step is still waiting, so nobody is ever stuck.
//
// Two flows live in this file:
//   • BUSINESS_STEPS — the owner walkthrough of the project form.
//   • CONSULTANT_STEPS — profile setup → payouts → dashboard → a
//     practice project and offer → a sample table → the profile garden.
// `STEPS` / `CHAPTERS` are `let`-bound and swapped to whichever flow
// matches the current user's role before the walkthrough mounts.

const filled = (sel) => !!document.querySelector(sel)?.value?.trim();
const shown = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
};

// The form's primary buttons. The card never sits on top of these.
const FORM_PRIMARY_BUTTONS = ["#next-btn", "#back-btn", "#save-draft-btn", "#submit-btn"];
const CL_READY = "#cl-split:not(.hidden)";

// Owner tour: the project form only. New owners arrive here from
// /business-basics.html (/create-listing.html?welcome=1). Copy matches
// the visible field labels. No fee or payout statements here, and
// nothing about free offers (those are consultant-only).
const BUSINESS_STEPS = [
  {
    id: "lw-title",
    label: "Title",
    path: "/create-listing.html",
    slide: 0,
    targetSelector: ['label:has(> input[name="title"])', 'input[name="title"]'],
    placement: "bottom",
    mode: "do",
    done: () => filled('input[name="title"]'),
    title: "Give your project a name",
    body: "Go ahead and type a title in the highlighted box. Something short and specific works best, because students skim a lot of titles before they open one.",
  },
  {
    id: "lw-preview",
    label: "Preview",
    path: "/create-listing.html",
    slide: 0,
    targetSelector: "#cl-preview",
    placement: "left",
    mode: "look",
    title: "Here's your live preview",
    body: "This panel shows your project the way students will see it in the marketplace. It fills in as you type, so you can glance over here any time to check how things look.",
  },
  {
    id: "lw-contract",
    label: "Payment",
    path: "/create-listing.html",
    slide: 0,
    targetSelector: ".ct-options",
    placement: "right",
    mode: "do",
    optional: true,
    done: "touch",
    title: "Choose how you'd like to pay",
    body: "One project, one payment is already selected, and it suits most first projects. If your work is bigger or ongoing, open Other ways to pay and pick the option that fits. It's fine to leave this as it is.",
  },
  {
    id: "lw-context",
    label: "Background",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'label:has(textarea[name="issue_context"])',
    placement: "right",
    mode: "do",
    optional: true,
    done: () => filled('textarea[name="issue_context"]'),
    title: "Share a little background",
    body: "If you'd like, tell students what's going on at your business right now. It's optional, but a couple of sentences of background usually leads to better offers.",
  },
  {
    id: "lw-problem",
    label: "The work",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'label:has(textarea[name="business_problem"])',
    placement: "right",
    mode: "do",
    done: () => filled('textarea[name="business_problem"]'),
    title: "Describe what you need done",
    body: "Type out the work you'd like help with in a few plain sentences. The form needs this one before you can continue, so it helps to be specific about the one thing you want finished.",
  },
  {
    id: "lw-output",
    label: "End result",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'label:has(textarea[name="expected_output"])',
    placement: "right",
    mode: "do",
    optional: true,
    done: () => filled('textarea[name="expected_output"]'),
    title: "Say what you'd like to end up with",
    body: "This one is optional. If you already know the files or formats you want at the end, list them here so students know exactly what to hand over.",
  },
  {
    id: "lw-details",
    label: "Extras",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'label:has(textarea[name="additional_details"])',
    placement: "right",
    mode: "do",
    optional: true,
    done: () => filled('textarea[name="additional_details"]'),
    title: "Add anything else that would help",
    body: "Use this box for anything that didn't fit above, such as your brand colors, things you've already tried, or who your customers are. Feel free to leave it blank.",
  },
  {
    id: "lw-attachments",
    label: "Files",
    path: "/create-listing.html",
    slide: 1,
    // `:has()` picks the whole <label> wrapping the file input so the
    // cutout covers the heading, button, and hint as one block.
    targetSelector: 'label:has(#listing-attachments)',
    also: ["#cl-file-list:not(.hidden)"],
    placement: "right",
    mode: "do",
    optional: true,
    done: () => shown("#cl-file-list"),
    title: "Attach files if you have them",
    body: "You can add photos, old menus, or examples you like by choosing files here. It takes up to 3 files at 5 MB each, 12 MB in total. If you have nothing to share yet, skip this one.",
  },
  {
    id: "lw-categories",
    label: "Categories",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#cat-multiselect",
    also: ["#cat-tags", "#cat-dropdown:not(.hidden)"],
    placement: "right",
    mode: "do",
    done: () => !!document.querySelector("#cat-tags")?.children.length,
    title: "Pick a category or two",
    body: "Start typing in the search box and choose the categories that match your project. You need at least one, and one or two focused picks help the right students find you.",
  },
  {
    id: "lw-budget",
    label: "Budget",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: ".gr-money-range",
    placement: "right",
    mode: "do",
    done: () => filled('input[name="budget_min"]') && filled('input[name="budget_max"]'),
    title: "Set your budget range",
    body: "Enter the lowest and highest amounts you'd be comfortable paying. Students use this range to size their offers, so a realistic range tends to bring in more of them.",
  },
  {
    id: "lw-turnaround",
    label: "Timing",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: 'input[name="turnaround_days"]',
    placement: "right",
    mode: "do",
    done: () => filled('input[name="turnaround_days"]'),
    title: "Tell students how long they have",
    body: "Type the number of days a student has to finish the work, counted from the day you accept their offer. It helps to leave a little room for revisions.",
  },
  {
    id: "lw-quals",
    label: "Skills",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#qual-list",
    also: ["#add-qual-btn"],
    placement: "right",
    mode: "do",
    optional: true,
    done: () => [...document.querySelectorAll("#qual-list .cl-qual-input")].some((i) => i.value.trim()),
    title: "List any skills you're looking for",
    body: "This is optional. If certain skills or tools matter for this project, add two or three so students can tell whether they're a good fit.",
  },
  {
    id: "lw-publish",
    label: "Post",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#submit-btn",
    placement: "top",
    mode: "go",
    title: "Post it when you're ready",
    body: "Take one more look at the preview, then select Post project. We'll ask you to confirm before it goes live. If you'd rather finish later, Save as draft keeps everything you've entered.",
  },
  // No closing "you're set" card: after posting, listing.html shows
  // its own "Your project is live" panel, and the publish handler below
  // ends the tour. Clicking "Finish tour" here ends it too.
].map((s) => ({ ready: CL_READY, ...s }));

/* ============================================================== */
/*                  CONSULTANT FLOW — STEPS                         */
/* ============================================================== */

// Profile setup → payouts → dashboard → a practice project where they
// make a pretend offer → a sample engagements table → the garden on
// the profile page. The practice-project and
// garden steps hit /listing.html?tutorial=1 and
// /consultant-dashboard.html?tutorial=garden; those URLs put the host
// pages in a fixture-only mode that never writes to the database.
//
// Steps on the dashboard and the garden resolve their targets
// defensively: if the element isn't on the page (the dashboard layout
// is changing), the step is skipped instead of stalling the tour.
// Settings unhides the consultant-only sections once the profile has
// loaded. Those sections sit in tab panels that may not be showing, so
// this checks the class, not on-screen visibility.
const SETTINGS_READY = () =>
  !!document.querySelector("#pf-preview-bar:not(.hidden), #consultant-education-section:not(.hidden)");
const CDASH_READY = "#cdash-shell:not([hidden])";
const CONSULTANT_STEPS = [
  // ── chapter 1: profile setup ──
  {
    id: "c-edit-profile",
    label: "Profile",
    path: "/profile.html",
    targetSelector: '.pp-header__actions a[href*="settings"]',
    placement: "left",
    mode: "go",
    title: "Let's start with your profile",
    body: "Businesses read your profile before they accept an offer, so it's worth a few minutes now. Select Edit profile and we'll fill it in together.",
  },
  {
    id: "c-upload-photo",
    label: "Photo",
    path: "/settings.html",
    hash: "#personal",
    ready: SETTINGS_READY,
    targetSelector: [".settings-section__body--avatar", "#pf-avatar-upload-label:not(.hidden)", "#pf-avatar-change-btn"],
    placement: "right",
    mode: "do",
    optional: true,
    done: () => {
      const img = document.getElementById("avatar-preview");
      return !!img && !img.hidden && !!img.getAttribute("src");
    },
    title: "Add a profile photo",
    body: "Choose Upload photo and pick a clear picture of yourself. You'll get a chance to crop it before it's saved. A friendly headshot helps a business feel like they know who they're hiring.",
  },
  {
    id: "c-nav-general",
    label: "General",
    path: "/settings.html",
    ready: SETTINGS_READY,
    targetSelector: '.settings-tab[data-tab="general"]',
    placement: "bottom",
    mode: "go",
    title: "Next, choose how Grassroots looks",
    body: "Select the General tab. That's where you'll find the themes.",
  },
  {
    id: "c-themes",
    label: "Themes",
    path: "/settings.html",
    hash: "#general",
    ready: SETTINGS_READY,
    targetSelector: "#theme-grid",
    placement: "bottom",
    mode: "do",
    optional: true,
    done: "touch",
    title: "Pick a theme you like",
    body: "Try any of these by selecting it, and the whole site changes right away. Keep whichever one feels easiest on your eyes. You can always change it again later.",
  },
  {
    id: "c-nav-professional",
    label: "Professional",
    path: "/settings.html",
    ready: SETTINGS_READY,
    targetSelector: '.settings-tab[data-tab="professional"]',
    placement: "bottom",
    mode: "go",
    title: "Now for your professional details",
    body: "Select the Professional tab. This is the part of your profile that businesses look at most closely.",
  },
  {
    id: "c-education",
    label: "Education",
    path: "/settings.html",
    hash: "#professional",
    ready: SETTINGS_READY,
    targetSelector: "#consultant-education-section",
    placement: "right",
    mode: "do",
    done: () => filled("#field-major") && filled("#field-school"),
    title: "Tell businesses where you study",
    body: "Go ahead and fill in your major and your school, plus a minor if you have one. When you're finished, select Save changes at the bottom of the page so it's stored.",
  },
  {
    id: "c-resume",
    label: "Resume",
    path: "/settings.html",
    hash: "#professional",
    ready: SETTINGS_READY,
    targetSelector: "#consultant-section",
    placement: "right",
    mode: "do",
    optional: true,
    done: () => shown("#resume-current"),
    title: "Upload your resume",
    body: "Choose a PDF of your resume here so businesses can review your experience. Once it's uploaded, you decide whether it's public, and you can switch that any time.",
  },
  {
    id: "c-portfolio",
    label: "Past work",
    path: "/settings.html",
    hash: "#professional",
    ready: SETTINGS_READY,
    targetSelector: "#consultant-portfolio-section",
    placement: "right",
    mode: "do",
    optional: true,
    done: () => !!document.querySelector("#portfolio-list .pf-portfolio-item"),
    title: "Add some of your past work",
    body: "If you have work samples, add one here. Choose a file, write a line about what it is, then select Upload. Documents, images, videos, and decks all work.",
  },
  {
    id: "c-preview-as-business",
    label: "Preview",
    path: "/settings.html",
    hash: "#professional",
    ready: SETTINGS_READY,
    targetSelector: "#pf-preview-bar",
    placement: "bottom",
    mode: "do",
    optional: true,
    done: "touch",
    title: "See your profile the way a business does",
    body: "Select Preview how businesses see you to open the same view a business gets when they read your offer. Close it when you're done, then adjust anything that doesn't look right.",
  },

  // ── chapter 2: stripe payouts ──
  {
    id: "c-payouts-intro",
    label: "Payouts",
    path: "/settings.html",
    targetSelector: null,
    placement: "center",
    mode: "look",
    title: "Next, set up payouts",
    body: "To get paid on Grassroots, you'll verify your identity and add a bank account. It all happens here on our site, in a secure form provided by Stripe, and it needs to be finished before you can submit a paid offer. We'll open the payouts page next.",
  },
  {
    id: "c-nav-payouts",
    label: "Stripe",
    path: "/payouts.html",
    // The page shows either its shell (form or status) or, when payout
    // setup can't start, an error line in #po-gate. Both count as loaded.
    ready: "#po-gate.error, #po-shell:not([hidden])",
    targetSelector: [
      "#po-onboarding-section:not([hidden])",
      "#po-status-card:not([hidden])",
      "#po-shell:not([hidden])",
      "#po-gate.error",
    ],
    placement: "right",
    mode: "do",
    optional: true,
    done: () => shown("#po-active-section"),
    // Nothing for the user to do while the page is showing its error.
    infoWhen: () => shown("#po-gate.error"),
    title: "Set up your payouts",
    body: () => (shown("#po-gate.error")
      ? "Payout setup isn't loading at the moment, and that's nothing you did. Please carry on with the tour for now, then come back to this page a little later to verify your identity and add a bank account."
      : shown("#po-active-section")
        ? "Your payouts are already set up, so there's nothing more to do here. This is the page to visit whenever you want to check your balance or update your bank details."
        : "The form on this page asks you to verify your identity and add a bank account. Take your time with it. If you'd rather finish later, you can come back to this page whenever you like."),
  },

  // ── chapter 3: dashboard ──
  {
    id: "c-dashboard-intro",
    label: "Home",
    path: "/consultant-dashboard.html",
    ready: CDASH_READY,
    targetSelector: "#cdash-welcome",
    placement: "bottom",
    mode: "look",
    title: "This is your dashboard",
    body: "Everything you're working on shows up here, so it's a good place to start each time you sign in. We'll point out a couple of things before moving on.",
  },
  {
    id: "c-journey-panel",
    label: "Projects",
    path: "/consultant-dashboard.html",
    ready: CDASH_READY,
    targetSelector: "#cdash-engagements-panel",
    placement: "top",
    mode: "look",
    title: "Your projects live here",
    body: "Every offer you send shows up in this table, so you can follow each one from the offer through to finished work. The tabs along the top sort them into offers sent, work in progress, and past work.",
  },
  {
    id: "c-health",
    label: "Completion",
    path: "/consultant-dashboard.html",
    ready: CDASH_READY,
    targetSelector: "#cdash-health",
    placement: "left",
    mode: "look",
    title: "Keep an eye on your profile completion",
    body: "This card shows how complete your profile is and points to whatever is still missing. Businesses tend to pass over incomplete profiles, so it's worth clearing these when you have a minute.",
  },

  // ── chapter 4: practice project + offer ──
  {
    id: "c-mock-intro",
    label: "Practice",
    path: null,
    targetSelector: null,
    placement: "center",
    mode: "look",
    title: "Let's look at a practice project together",
    body: "Next we'll open a sample project so you can see how offers work. It isn't real, so nothing you do there reaches a business or charges anyone.",
  },
  {
    id: "c-listing-bio",
    label: "Business",
    path: "/listing.html",
    query: "tutorial=1",
    ready: "#ld-bio",
    targetSelector: "#ld-bio",
    placement: "right",
    mode: "look",
    title: "Start with who's posting",
    body: "This panel tells you about the business behind the project. It's worth reading first, because a good fit matters as much as the price.",
  },
  {
    id: "c-listing-context",
    label: "Context",
    path: "/listing.html",
    query: "tutorial=1",
    ready: "#ld-bio",
    targetSelector: "#ld-context-section",
    placement: "right",
    mode: "look",
    title: "Read the background",
    body: "Context explains what's going on at the business right now. It helps you understand why they're asking for this work.",
  },
  {
    id: "c-listing-problem",
    label: "Problem",
    path: "/listing.html",
    query: "tutorial=1",
    ready: "#ld-bio",
    targetSelector: ["details:has(> #ld-summary)", "#ld-summary"],
    placement: "right",
    mode: "look",
    title: "This is what they need done",
    body: "Business problem describes the result the business is hoping for. A strong offer speaks directly to it.",
  },
  {
    id: "c-listing-output",
    label: "Standards",
    path: "/listing.html",
    query: "tutorial=1",
    ready: "#ld-bio",
    targetSelector: "#ld-output-section",
    placement: "right",
    mode: "look",
    title: "See what they expect at the end",
    body: "Standards of work describes what the finished work should look like, such as the format and how they plan to use it. Keep it in mind when you decide on your price.",
  },
  {
    id: "c-listing-question",
    label: "Question",
    path: "/listing.html",
    query: "tutorial=1",
    ready: "#ld-bio",
    targetSelector: "#ld-question-btn",
    placement: "right",
    mode: "do",
    optional: true,
    done: "touch",
    title: "You can ask before you offer",
    body: "If something isn't clear, the Have a question button lets you message the business before you commit to a number. Try it now if you like. In this practice project it only shows a short note.",
  },
  {
    id: "c-make-offer",
    label: "Offer",
    path: "/listing.html",
    query: "tutorial=1",
    ready: "#ld-bio",
    targetSelector: "#ld-offer-panel",
    placement: "left",
    mode: "do",
    done: () => Number(document.getElementById("ld-bid-amount")?.value) > 0,
    title: "Try making an offer",
    body: "Go ahead and type an amount in the offer box. As soon as you do, a breakdown appears underneath showing what you'd take home after fees. This is only practice, so use any number you like.",
  },
  {
    id: "c-submit-offer",
    label: "Submit",
    path: "/listing.html",
    query: "tutorial=1",
    ready: "#ld-bio",
    targetSelector: "#ld-bid-submit",
    placement: "left",
    mode: "go",
    goLabel: "Skip this one",
    title: "Send your practice offer",
    body: "When you're happy with the amount, select Submit offer. Nothing leaves this walkthrough, so no business will see it.",
  },

  // ── chapter 5: a fuller table, then the garden on the profile ──
  // listing.js sends the user to "c-garden-intro" after the practice
  // offer, so that id stays even though the step now shows the table.
  {
    id: "c-garden-intro",
    label: "Preview",
    path: "/consultant-dashboard.html",
    query: "tutorial=garden",
    ready: CDASH_READY,
    targetSelector: "#cdash-engagements-panel",
    placement: "top",
    mode: "look",
    title: "Here's what a busy stretch looks like",
    body: "We've filled the table with sample projects at different stages, so you can see how your work will look once things get going. None of these are real.",
  },
  {
    id: "c-garden-profile",
    label: "Garden",
    path: "/profile.html",
    hash: "#pp-garden-section",
    ready: ".pp-header__actions",
    targetSelector: ["#pp-garden-section", "#pp-garden"],
    placement: "top",
    mode: "look",
    title: "Finished work grows in your garden",
    body: "Your garden lives here on your profile. Each time a project is completed and the payout is released, a flower is planted for you automatically, and we'll send you a notification when that happens.",
  },

  {
    id: "c-complete",
    label: "Done",
    path: null,
    targetSelector: null,
    placement: "center",
    mode: "look",
    title: "You're all set",
    body: "That's the whole tour. You can replay it any time from Settings, under General. Good luck with your first offer.",
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
    label: "Profile",
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
    stepIds: ["c-dashboard-intro", "c-journey-panel", "c-health"],
  },
  {
    id: "c-first-offer",
    label: "Practice",
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
    stepIds: ["c-garden-intro", "c-garden-profile"],
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
  if (typeof value === "function") {
    try { return value(); } catch (_) { return null; }
  }
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
  [TOOLTIP_ID, OVERLAY_ID].forEach((id) => {
    const n = document.getElementById(id);
    if (n) n.remove();
  });
  document.body.classList.remove("gr-onboarding-active");
  renderedStepId = null;
  waitToken += 1;
  if (resizeObserver) resizeObserver.disconnect();
}


/* ============================================================== */
/*                       RENDERING                                 */
/* ============================================================== */

let renderedStepId = null;
let resizeObserver = null;
let trackLoopActive = false;
// True after the user has dragged the card during the current step.
// While true, position() leaves the card alone (the cutout still
// tracks its target).
let userDraggedBubble = false;
// One-off helper line under the body, e.g. when the form refused to
// move on because a required field is empty. { id, text }.
let stepNote = null;
// Which way the user is travelling (1 forward, -1 back) so a step
// whose target is missing is skipped in the same direction.
let lastDirection = 1;
let skipChain = 0;
// Set while we ask the project form to change slide ourselves, so the
// cl:slide-changed listener doesn't also move the tour.
let aligningSlide = false;
let waitToken = 0;

const reducedMotion = () =>
  !!window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function isVisible(el) {
  if (!el) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function currentStep() {
  return renderedStepId ? STEPS[stepIndexById(renderedStepId)] : null;
}

// Every element the spotlight should include for a step: the target
// plus any visible `also` extras.
function spotlightEls(step, target) {
  const els = target ? [target] : [];
  (step?.also || []).forEach((sel) => {
    document.querySelectorAll(sel).forEach((el) => {
      if (isVisible(el)) els.push(el);
    });
  });
  return els;
}

function unionRect(els) {
  let box = null;
  els.forEach((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width && !r.height) return;
    if (!box) box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    else {
      box.left = Math.min(box.left, r.left);
      box.top = Math.min(box.top, r.top);
      box.right = Math.max(box.right, r.right);
      box.bottom = Math.max(box.bottom, r.bottom);
    }
  });
  if (!box) return null;
  box.width = box.right - box.left;
  box.height = box.bottom - box.top;
  return box;
}

/* ───────────── project form: keep the slide in step ───────────── */

function activeWizardSlide() {
  const el = document.querySelector(".cl-slide--active");
  const n = Number(el?.dataset?.slide);
  return Number.isFinite(n) ? n : null;
}

// The step that owns the field the form just flagged as invalid.
function stepForInvalidField(slide) {
  const invalid = document.querySelector('#listing-form [aria-invalid="true"]');
  if (!invalid) return null;
  return STEPS.find((s) => {
    if (s.slide !== slide || !s.targetSelector) return false;
    const t = resolveTarget(s);
    return !!t && (t === invalid || t.contains(invalid));
  }) || null;
}

const FORM_NEEDS_THIS = "The form needs this one before it can move on.";
const FORM_NEEDS_SOMETHING = "The form still needs something on this page. Look for the field it has marked.";

// Send the tour to wherever the form is actually stuck.
function bounceToFormBlocker(fromStep) {
  const slide = activeWizardSlide();
  const blocker = stepForInvalidField(slide);
  const fallback = blocker
    || (fromStep?.slide === slide ? fromStep : STEPS.find((s) => s.slide === slide));
  if (!fallback) return false;
  stepNote = { id: fallback.id, text: blocker ? FORM_NEEDS_THIS : FORM_NEEDS_SOMETHING };
  const prev = readState() || {};
  writeState({ ...prev, active: true, stepId: fallback.id });
  renderStep(fallback.id, { skipAlign: true });
  return true;
}

// Ask the project form to show this step's slide. Forward jumps run
// the form's own validation, so the form may refuse (for example after
// a reload wiped the fields). Returns true when the tour was sent to a
// different step instead.
function alignWizardSlide(step) {
  if (step.slide === undefined || window.location.pathname !== "/create-listing.html") return false;
  const before = activeWizardSlide();
  if (before === null || before === step.slide) return false;
  aligningSlide = true;
  try {
    window.dispatchEvent(new CustomEvent("cl:request-slide", { detail: { slide: step.slide } }));
  } finally {
    aligningSlide = false;
  }
  if (activeWizardSlide() === step.slide) return false;
  return bounceToFormBlocker(null);
}

function renderStep(stepId, opts = {}) {
  const step = STEPS[stepIndexById(stepId)];
  if (!step) return;

  if (!opts.skipAlign && alignWizardSlide(step)) return;

  // First mount = pop-in animation. Step change = the card slides.
  const existing = document.getElementById(TOOLTIP_ID);
  const tooltipExisted = !!existing;
  const hadFocus = !!existing && existing.contains(document.activeElement);
  userDraggedBubble = false;
  renderedStepId = stepId;
  skipChain = 0;
  if (stepNote && stepNote.id !== stepId) stepNote = null;
  document.body.classList.add("gr-onboarding-active");

  const target = resolveTarget(step);

  // Overlay: a pointer-events:none layer holding the spotlight hole.
  // The hole's huge box-shadow is what dims the rest of the page, so
  // nothing here can ever swallow a click.
  const overlay = ensureNode(OVERLAY_ID);
  if (!overlay.classList.contains("gr-onb-overlay")) overlay.className = "gr-onb-overlay";
  overlay.setAttribute("aria-hidden", "true");
  let spot = overlay.querySelector(".gr-onb-spot");
  if (!spot) {
    spot = document.createElement("div");
    spot.className = "gr-onb-spot";
    overlay.appendChild(spot);
  }
  // Glide the hole to its new home on a step change only. While the
  // user scrolls, it must stick to the target with no easing lag.
  if (tooltipExisted && !reducedMotion()) {
    spot.classList.add("gr-onb-spot--gliding");
    setTimeout(() => {
      if (renderedStepId === stepId) spot.classList.remove("gr-onb-spot--gliding");
    }, 420);
  }

  // Card — replace its markup but keep the element so the CSS
  // top/left transition can interpolate the position.
  const tooltip = ensureNode(TOOLTIP_ID);
  const wasSettled = tooltip.classList.contains("gr-onb-tooltip--settled");
  tooltip.className =
    `gr-onb-tooltip gr-onb-tooltip--${step.placement || "right"}` +
    (wasSettled ? " gr-onb-tooltip--settled" : "");
  tooltip.setAttribute("role", "region");
  tooltip.setAttribute("aria-label", "Guided walkthrough");
  tooltip.innerHTML = buildTooltipMarkup(step);
  attachTooltipHandlers(tooltip);
  attachDragHandlers(tooltip);
  refreshStatus(true);
  if (hadFocus) {
    const focusTo = tooltip.querySelector(".gr-onb-btn--primary, .gr-onb-btn");
    try { focusTo?.focus({ preventScroll: true }); } catch (_) {}
  }

  if (!tooltipExisted) {
    tooltip.addEventListener(
      "animationend",
      () => tooltip.classList.add("gr-onb-tooltip--settled"),
      { once: true },
    );
    // Reduced motion has no entrance animation, so no animationend.
    setTimeout(() => tooltip.classList.add("gr-onb-tooltip--settled"), 500);
  }

  position(step, target);
  setupAdvanceClick(step, target);

  // Bring the target into view when it isn't fully on screen.
  if (target && step.placement !== "center") {
    const r = target.getBoundingClientRect();
    const vh = window.innerHeight;
    const fullyVisible = r.top >= 8 && r.bottom <= vh - 8;
    // If the card can't sit beside, above or below the target without
    // covering it, but would fit underneath once the target is at the
    // top of the screen, scroll the target up there.
    const cardH = tooltip.offsetHeight || 300;
    const cardW = tooltip.offsetWidth || 440;
    const need = cardH + BUBBLE_GAP + VIEW_MARGIN;
    const vw = window.innerWidth;
    const fitsSomewhere =
      vh - r.bottom >= need || r.top >= need ||
      vw - r.right >= cardW + BUBBLE_GAP + VIEW_MARGIN ||
      r.left >= cardW + BUBBLE_GAP + VIEW_MARGIN;
    const wouldFitBelow = r.height + need + 32 <= vh;
    if (!fullyVisible || (!fitsSomewhere && wouldFitBelow)) {
      const toTop = r.height > vh * 0.8 || (!fitsSomewhere && wouldFitBelow);
      const behavior = reducedMotion() ? "auto" : "smooth";
      try {
        if (toTop) scrollTargetNearTop(target, r, behavior);
        else target.scrollIntoView({ behavior, block: "center", inline: "nearest" });
      } catch (_) {
        target.scrollIntoView();
      }
    }
  }

  // The page may still be laying out (settings panels swap, images
  // load, fonts settle). Re-run position a few times so the spotlight
  // and card follow the target into place.
  [120, 350, 800, 1600].forEach((ms) => {
    setTimeout(() => {
      if (renderedStepId !== step.id) return;
      position(step, resolveTarget(step) || target);
    }, ms);
  });

  if (resizeObserver) resizeObserver.disconnect();
  if (target && "ResizeObserver" in window) {
    resizeObserver = new ResizeObserver(() => onScrollReposition());
    resizeObserver.observe(document.documentElement);
    resizeObserver.observe(target);
  }
  window.addEventListener("scroll", onScrollReposition, { passive: true, capture: true });
  window.addEventListener("resize", onResizeReposition);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", onResizeReposition);
    window.visualViewport.addEventListener("scroll", onScrollReposition);
  }

  // Continuous check: catches layout shifts and browser zoom that fire
  // no event, and keeps the "Your turn / Done" marker current.
  startTrackLoop();

  window.dispatchEvent(new CustomEvent("grassroots:onboarding-step", { detail: { step } }));
}

// Scroll so the target sits a little below the top edge, in whichever
// container actually scrolls it (the window on most pages).
function scrollTargetNearTop(target, r, behavior) {
  const delta = r.top - 28;
  let el = target.parentElement;
  while (el && el !== document.body && el !== document.documentElement) {
    const oy = getComputedStyle(el).overflowY;
    if ((oy === "auto" || oy === "scroll") && el.scrollHeight > el.clientHeight + 1) {
      el.scrollBy({ top: delta, behavior });
      return;
    }
    el = el.parentElement;
  }
  window.scrollBy({ top: delta, behavior });
}

function onScrollReposition() {
  const step = currentStep();
  if (!step) return;
  position(step, resolveTarget(step));
}
function onResizeReposition() {
  onScrollReposition();
}

// Layers the page opens on top of itself (photo cropper, profile
// preview, confirm dialogs). While one is open the dim steps aside so
// the layer reads normally; the spotlight comes back when it closes.
const FOREIGN_LAYERS = [
  ".gr-photo-crop",
  "#welcome-overlay:not(.hidden)",
  "#pf-preview-modal:not(.hidden)",
  "#pf-resume-viewer:not(.hidden)",
  "dialog[open]",
  '[aria-modal="true"]',
  ".gr-confirm-modal",
  ".gr-modal:not(.hidden)",
];
function foreignLayerOpen() {
  return FOREIGN_LAYERS.some((sel) => {
    try {
      return [...document.querySelectorAll(sel)].some(
        (el) => !el.closest(`#${TOOLTIP_ID}`) && isVisible(el),
      );
    } catch (_) {
      return false;
    }
  });
}

function startTrackLoop() {
  if (trackLoopActive) return;
  trackLoopActive = true;
  let lastSig = "";
  function tick() {
    const step = currentStep();
    if (!step) {
      trackLoopActive = false;
      return;
    }
    const target = resolveTarget(step);
    const vv = window.visualViewport;
    const scale = vv?.scale ?? 1;
    const box = target ? unionRect(spotlightEls(step, target)) : null;
    const layer = foreignLayerOpen();
    const sig = box
      ? `${box.left.toFixed(1)},${box.top.toFixed(1)},${box.width.toFixed(1)},${box.height.toFixed(1)},${scale.toFixed(3)},${innerWidth},${innerHeight},${layer}`
      : `center,${scale.toFixed(3)},${innerWidth},${innerHeight},${layer}`;
    if (sig !== lastSig) {
      position(step, target);
      lastSig = sig;
    }
    refreshStatus();
    setTimeout(tick, 120);
  }
  setTimeout(tick, 120);
}

// Margin the card keeps from every viewport edge, at all widths.
const VIEW_MARGIN = 16;
const BUBBLE_GAP = 28;
// Breathing room between the target and the edge of the cutout.
const SPOT_PAD = 8;

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

function readCardPos() {
  try {
    const p = JSON.parse(sessionStorage.getItem(CARD_POS_KEY) || "null");
    return p && typeof p === "object" ? p : null;
  } catch (_) {
    return null;
  }
}
function writeCardPos(p) {
  try { sessionStorage.setItem(CARD_POS_KEY, JSON.stringify(p)); } catch (_) {}
}

// Pick a card position that (1) stays inside the viewport with a
// margin, (2) never covers the spotlight, and (3) never covers the
// form's primary buttons. Tries the step's preferred side first, then
// the other sides, then the four viewport corners, and keeps the first
// candidate with no overlap. If every candidate overlaps something
// (small screens), the one covering the least wins, weighted so the
// target counts most.
function chooseBubblePosition(step, r, w, h, vw, vh) {
  const targetBox = spotBoxFor(r, vw, vh);
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
    { x: vw - w - VIEW_MARGIN, y: vh - h - VIEW_MARGIN },
    { x: VIEW_MARGIN, y: vh - h - VIEW_MARGIN },
    { x: vw - w - VIEW_MARGIN, y: VIEW_MARGIN },
    { x: VIEW_MARGIN, y: VIEW_MARGIN },
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

// The cutout box for a target rect, clipped to the viewport.
function spotBoxFor(r, vw, vh) {
  return {
    left: Math.max(0, r.left - SPOT_PAD),
    top: Math.max(0, r.top - SPOT_PAD),
    right: Math.min(vw, r.right + SPOT_PAD),
    bottom: Math.min(vh, r.bottom + SPOT_PAD),
  };
}

function position(step, target) {
  const overlay = document.getElementById(OVERLAY_ID);
  const tooltip = document.getElementById(TOOLTIP_ID);
  if (!overlay || !tooltip) return;
  const spot = overlay.querySelector(".gr-onb-spot");

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // While the page has a modal, preview or cropper open, the dim steps
  // aside and the card shrinks into the bottom-left corner so it isn't
  // sitting on top of what the user just opened.
  const layerOpen = foreignLayerOpen();
  overlay.classList.toggle("gr-onb-overlay--suspended", layerOpen);
  const wasTucked = tooltip.classList.contains("gr-onb-tooltip--tucked");
  tooltip.classList.toggle("gr-onb-tooltip--tucked", layerOpen);
  if (layerOpen) {
    if (!wasTucked) {
      tooltip.style.transform = "";
      tooltip.style.left = `${VIEW_MARGIN}px`;
      tooltip.style.top = `${Math.max(VIEW_MARGIN, vh - tooltip.offsetHeight - VIEW_MARGIN)}px`;
    }
    return;
  }

  const r = target ? unionRect(spotlightEls(step, target)) : null;

  if (!r || step.placement === "center") {
    // No target: dim the whole page and center the card.
    overlay.classList.add("gr-onb-overlay--solid");
    overlay.classList.remove("gr-onb-overlay--spot");
    if (!userDraggedBubble) {
      tooltip.style.left = `50%`;
      tooltip.style.top = `50%`;
      tooltip.style.transform = `translate(-50%, -50%)`;
    }
    return;
  }

  // Target step: the hole sits on the target and its shadow dims the
  // rest. Position is unclipped so the hole scrolls off with the target.
  overlay.classList.remove("gr-onb-overlay--solid");
  overlay.classList.add("gr-onb-overlay--spot");
  if (spot) {
    spot.style.left = `${r.left - SPOT_PAD}px`;
    spot.style.top = `${r.top - SPOT_PAD}px`;
    spot.style.width = `${r.width + SPOT_PAD * 2}px`;
    spot.style.height = `${r.height + SPOT_PAD * 2}px`;
  }

  // Once the user has dragged the card on this step, leave it where
  // they parked it.
  if (userDraggedBubble) return;

  const w = tooltip.offsetWidth || 320;
  const h = tooltip.offsetHeight || 200;

  // A position parked on an earlier step carries over, unless it would
  // sit on top of this step's spotlight.
  const saved = readCardPos();
  let p = null;
  if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const c = clampBubble(saved.x, saved.y, w, h, vw, vh);
    const box = { left: c.x, top: c.y, right: c.x + w, bottom: c.y + h };
    if (overlapArea(box, spotBoxFor(r, vw, vh)) === 0) p = c;
  }
  if (!p) p = chooseBubblePosition(step, r, w, h, vw, vh);
  tooltip.style.left = `${p.x}px`;
  tooltip.style.top = `${p.y}px`;
  tooltip.style.transform = "";
}

/* ============================================================== */
/*                  "YOUR TURN" / "DONE" STATUS                    */
/* ============================================================== */

function stepIsDone(step) {
  if (!step || step.mode !== "do") return false;
  if (typeof step.done === "function") {
    try { return !!step.done(resolveTarget(step)); } catch (_) { return false; }
  }
  return !!readState()?.touched?.[step.id];
}

// What the status marker and the main button should say right now.
function statusFor(step) {
  const isLast = stepIndexById(step.id) === STEPS.length - 1;
  const centered = !step.targetSelector;
  let infoNow = false;
  try { infoNow = !!step.infoWhen?.(); } catch (_) {}
  if (step.mode === "do" && !infoNow) {
    if (stepIsDone(step)) {
      return { state: "done", chip: "Done", btn: isLast ? "Finish tour" : "Next", ghost: false };
    }
    return {
      state: "todo",
      chip: step.optional ? "Your turn · optional" : "Your turn",
      btn: isLast ? "Finish tour" : "Skip for now",
      ghost: true,
    };
  }
  if (step.mode === "go" && !infoNow) {
    return {
      state: "todo",
      chip: "Your turn",
      btn: isLast ? "Finish tour" : (step.goLabel || "Take me there"),
      ghost: true,
    };
  }
  return {
    state: "info",
    chip: centered ? "" : "Just a look",
    btn: isLast ? "Finish tour" : "Next",
    ghost: false,
  };
}

const CHECK_SVG = "<svg viewBox='0 0 16 16' aria-hidden='true'><path d='M3 8.5 L6.5 12 L13 4.5' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/></svg>";

// Update the marker and main button in place (no re-render, so focus
// and any text the user is typing elsewhere are left alone).
function refreshStatus(initial = false) {
  const step = currentStep();
  const tooltip = document.getElementById(TOOLTIP_ID);
  if (!step || !tooltip) return;
  const s = statusFor(step);
  const chip = tooltip.querySelector(".gr-onb-status");
  if (chip && (chip.dataset.state !== s.state || chip.dataset.text !== s.chip)) {
    const becameDone = !initial && s.state === "done" && chip.dataset.state === "todo";
    chip.dataset.state = s.state;
    chip.dataset.text = s.chip;
    chip.hidden = !s.chip;
    chip.innerHTML =
      (s.state === "done" ? CHECK_SVG : "<span class='gr-onb-status__dot' aria-hidden='true'></span>") +
      `<span>${escapeHtml(s.chip)}</span>`;
    chip.classList.toggle("gr-onb-status--pop", becameDone);
  }
  const btn = tooltip.querySelector("[data-onb-primary]");
  if (btn && btn.dataset.label !== s.btn) {
    btn.dataset.label = s.btn;
    btn.textContent = s.btn;
  }
  if (btn) {
    btn.classList.toggle("gr-onb-btn--primary", !s.ghost);
    btn.classList.toggle("gr-onb-btn--ghost", s.ghost);
  }
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.dataset.state = s.state;
}

// "touch" steps count as done once the user clicks or changes anything
// inside the spotlight. Remembered in state so a reload keeps it.
function onPageInteraction(e) {
  const step = currentStep();
  if (!step) return;
  if (step.mode === "do" && typeof step.done !== "function") {
    const target = resolveTarget(step);
    const hit = spotlightEls(step, target).some((el) => el === e.target || el.contains(e.target));
    if (hit) {
      const state = readState();
      if (state?.active && !state.touched?.[step.id]) {
        writeState({ ...state, touched: { ...(state.touched || {}), [step.id]: true } });
      }
    }
  }
  // Let the page's own handlers run first, then re-read the page.
  setTimeout(refreshStatus, 0);
}
["click", "input", "change"].forEach((type) => {
  document.addEventListener(type, onPageInteraction, true);
});

/* ============================================================== */
/*                         CARD MARKUP                             */
/* ============================================================== */

const GRIP_SVG = "<svg class='gr-onb-grip__dots' viewBox='0 0 10 16' aria-hidden='true'><circle cx='2' cy='2' r='1.5'/><circle cx='8' cy='2' r='1.5'/><circle cx='2' cy='8' r='1.5'/><circle cx='8' cy='8' r='1.5'/><circle cx='2' cy='14' r='1.5'/><circle cx='8' cy='14' r='1.5'/></svg>";

function buildTooltipMarkup(step) {
  const currentIdx = stepIndexById(step.id);
  const lastIdx = STEPS.length - 1;
  const dots = buildChapterNav(step.id, currentIdx);

  const isFirst = currentIdx === 0;

  // Choice steps render inline decision buttons inside the card
  // instead of pointing at a page element.
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

  const isLast = currentIdx === lastIdx;
  const primaryBtn = step.kind === "choice"
    ? ""
    : `<button type='button' class='gr-onb-btn gr-onb-btn--primary' data-onb-primary data-onb-action='${isLast ? "complete" : "advance"}'>Next</button>`;

  // The "Drag to move" words show until the user has moved the card
  // once this session; after that the grip dots (and tooltip) remain.
  const moved = !!readCardPos();
  const note = stepNote && stepNote.id === step.id
    ? `<p class='gr-onb-note' role='status'>${escapeHtml(stepNote.text)}</p>`
    : "";

  return `
    <div class='gr-onb-head'>
      <button type='button' class='gr-onb-grip${moved ? " gr-onb-grip--quiet" : ""}' data-onb-grip
              title='Drag to move'
              aria-label='Move this card. Drag it, or use the arrow keys.'>
        ${GRIP_SVG}
        <span class='gr-onb-grip__hint'>Drag to move</span>
      </button>
      <span class='gr-onb-count'>Step ${currentIdx + 1} of ${STEPS.length}</span>
      <button type='button' class='gr-onb-close' data-onb-action='close' aria-label='End the tour' title='End the tour'>×</button>
    </div>
    <nav class='gr-onb-dotnav' aria-label='Tour steps'>${dots}</nav>
    <p class='gr-onb-status' role='status' aria-live='polite' hidden></p>
    <h2 class='gr-onb-title'>${escapeHtml(resolveStepTitle(step))}</h2>
    <p class='gr-onb-body'>${escapeHtml(resolveStepBody(step))}</p>
    <p class='gr-onb-tucked-hint'>The tour picks up again once you close what you just opened.</p>
    ${note}
    ${choicesHtml}
    <div class='gr-onb-actions'>
      ${isFirst ? "" : `<button type='button' class='gr-onb-skip gr-onb-skip--back' data-onb-action='back'>← Back</button>`}
      <button type='button' class='gr-onb-skip gr-onb-skip--end' data-onb-action='close'>End tour</button>
      ${primaryBtn}
    </div>
  `;
}

// Make the card movable three ways: drag the grip (mouse, touch or
// pen), drag any empty part of the card with a mouse, or focus the
// grip and use the arrow keys. Where the user leaves it is remembered
// for the rest of the session.
function moveCardTo(tooltip, x, y) {
  const p = clampBubble(x, y, tooltip.offsetWidth, tooltip.offsetHeight, window.innerWidth, window.innerHeight);
  tooltip.style.left = `${p.x}px`;
  tooltip.style.top = `${p.y}px`;
  tooltip.style.transform = "";
  return p;
}

function markCardMoved(tooltip, p) {
  userDraggedBubble = true;
  writeCardPos({ x: Math.round(p.x), y: Math.round(p.y) });
  tooltip.querySelector(".gr-onb-grip")?.classList.add("gr-onb-grip--quiet");
}

function attachDragHandlers(tooltip) {
  // The card element outlives step changes; bind its listeners once.
  if (!tooltip.dataset.dragBound) {
    tooltip.dataset.dragBound = "1";
    let dragStart = null;
    let bubbleStart = null;
    let lastPos = null;
    let moved = false;

    const onPointerMove = (e) => {
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x;
      const dy = e.clientY - dragStart.y;
      if (!moved && Math.hypot(dx, dy) < 3) return;
      moved = true;
      lastPos = moveCardTo(tooltip, bubbleStart.x + dx, bubbleStart.y + dy);
    };
    const onPointerUp = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      document.removeEventListener("pointercancel", onPointerUp);
      tooltip.classList.remove("gr-onb-tooltip--dragging");
      if (dragStart && moved && lastPos) markCardMoved(tooltip, lastPos);
      dragStart = null;
      bubbleStart = null;
    };

    tooltip.addEventListener("pointerdown", (e) => {
      const onGrip = !!e.target.closest("[data-onb-grip]");
      // Buttons and links keep their own behavior; only the grip, or an
      // empty part of the card under a mouse, starts a drag.
      if (!onGrip && e.target.closest("button, a, [data-onb-action]")) return;
      if (!onGrip && e.pointerType && e.pointerType !== "mouse") return;
      if (e.button !== undefined && e.button !== 0) return;
      const rect = tooltip.getBoundingClientRect();
      dragStart = { x: e.clientX, y: e.clientY };
      bubbleStart = { x: rect.left, y: rect.top };
      lastPos = null;
      moved = false;
      tooltip.classList.add("gr-onb-tooltip--dragging");
      document.addEventListener("pointermove", onPointerMove);
      document.addEventListener("pointerup", onPointerUp);
      document.addEventListener("pointercancel", onPointerUp);
      if (!onGrip) e.preventDefault();
    });
  }

  // The grip is re-created with each step's markup.
  const grip = tooltip.querySelector("[data-onb-grip]");
  if (grip) {
    grip.addEventListener("keydown", (e) => {
      const stepPx = e.shiftKey ? 64 : 16;
      const delta = {
        ArrowLeft: [-stepPx, 0],
        ArrowRight: [stepPx, 0],
        ArrowUp: [0, -stepPx],
        ArrowDown: [0, stepPx],
      }[e.key];
      if (!delta) return;
      e.preventDefault();
      const rect = tooltip.getBoundingClientRect();
      tooltip.classList.add("gr-onb-tooltip--dragging");
      const p = moveCardTo(tooltip, rect.left + delta[0], rect.top + delta[1]);
      markCardMoved(tooltip, p);
      requestAnimationFrame(() => tooltip.classList.remove("gr-onb-tooltip--dragging"));
    });
  }
}

function attachTooltipHandlers(tooltip) {
  tooltip.querySelectorAll("[data-onb-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const action = btn.dataset.onbAction;
      e.preventDefault();
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
//   • href   — navigate to that URL.
//   • action — call a registered async handler.
//   • neither — pure transition to the next step.
// No current step uses this; kept for flows that need a fork.
async function handleChoice(btn) {
  const choiceId = btn.dataset.choiceId || "";
  const href = btn.dataset.choiceHref || "";
  const actionName = btn.dataset.choiceAction || "";
  const state = readState() || { active: true, stepId: STEPS[0].id };
  const idx = stepIndexById(state.stepId);
  const nextIdx = Math.min(STEPS.length - 1, idx + 1);
  const next = STEPS[nextIdx];

  if (actionName && CHOICE_ACTIONS[actionName]) {
    btn.disabled = true;
    const previousLabel = btn.textContent;
    btn.textContent = "Working…";
    try {
      const result = await CHOICE_ACTIONS[actionName](state);
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

  writeState({ ...state, active: true, stepId: next.id, choice: choiceId });
  if (href) {
    window.location.href = href;
    return;
  }
  transitionTo(next);
}

// Registry of async actions a choice button can invoke. Empty today.
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
  if (activeAdvanceHandler) {
    activeAdvanceEls.forEach((el) => el.removeEventListener("click", activeAdvanceHandler, true));
  }
  activeAdvanceEls = [];
  activeAdvanceHandler = null;
  // Only "go" steps advance when the highlighted control is clicked
  // (the click also takes the user somewhere, and the tour follows).
  // On "do" steps the target just does its normal job. The last step
  // has nowhere to advance to; the page's own handlers end the tour.
  if (step.kind === "choice") return;
  if (step.mode !== "go") return;
  if (!target) return;
  if (stepIndexById(step.id) === STEPS.length - 1) return;

  activeAdvanceHandler = () => { advance(); };
  target.addEventListener("click", activeAdvanceHandler, true);
  activeAdvanceEls = [target];
}

/* ============================================================== */
/*                       STATE TRANSITIONS                         */
/* ============================================================== */

// Build a full URL for a step, including the optional ?query string.
function stepUrl(step) {
  const q = step.query ? (step.query.startsWith("?") ? step.query : `?${step.query}`) : "";
  return (step.path || "") + q + (step.hash || "");
}

// True when the destination needs a real navigation (different path,
// or the same path with a query the host page reads at load).
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

// Does the destination page load the tour at all? A page without the
// loader would swallow the walkthrough (the card would never come
// back), so steps on such a page are skipped. Answers are cached for
// the session; any doubt counts as "yes".
const PAGE_CHECK_KEY = "grassroots_onboarding_pages";
async function pageHasTour(path) {
  if (!path) return true;
  let cache = {};
  try { cache = JSON.parse(sessionStorage.getItem(PAGE_CHECK_KEY) || "{}") || {}; } catch (_) {}
  if (typeof cache[path] === "boolean") return cache[path];
  let ok = true;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(path, { credentials: "same-origin", signal: ctrl.signal });
    clearTimeout(timer);
    if (res.ok) {
      const html = await res.text();
      ok = /onboarding(-shim)?\.js/.test(html);
    }
  } catch (_) {
    ok = true;
  }
  cache[path] = ok;
  try { sessionStorage.setItem(PAGE_CHECK_KEY, JSON.stringify(cache)); } catch (_) {}
  return ok;
}

// Shared transition helper. Writes state, then either does a full
// navigation (cross-page), a hash swap (tab switch on settings.html),
// or an in-place re-render.
function transitionTo(step) {
  const prev = readState() || {};
  writeState({ ...prev, active: true, stepId: step.id });
  if (needsCrossPageNav(step)) {
    const token = ++waitToken;
    pageHasTour(step.path).then((ok) => {
      if (token !== waitToken) return;
      if (readState()?.stepId !== step.id) return;
      if (ok) window.location.href = stepUrl(step);
      else skipMissingStep(step);
    });
    return;
  }
  // Same page, different hash → trigger the settings tab switch, then
  // wait for the panel swap before rendering.
  if (step.hash && step.hash !== window.location.hash) {
    window.location.hash = step.hash;
    setTimeout(() => waitForTargetThenRender(step, { grace: 900 }), 60);
    return;
  }
  waitForTargetThenRender(step, { grace: 600 });
}

// The step's target isn't on this page (or the page doesn't carry the
// tour). Move on to the next step in the direction of travel rather
// than leaving the user with no card.
function skipMissingStep(step) {
  skipChain += 1;
  if (skipChain > STEPS.length) {
    complete();
    return;
  }
  const idx = stepIndexById(step.id);
  let nextIdx = idx + (lastDirection < 0 ? -1 : 1);
  if (nextIdx < 0) {
    lastDirection = 1;
    nextIdx = idx + 1;
  }
  if (nextIdx > STEPS.length - 1) {
    complete();
    return;
  }
  const keep = skipChain;
  transitionTo(STEPS[nextIdx]);
  // renderStep resets the chain when a step actually shows.
  if (renderedStepId !== STEPS[nextIdx].id) skipChain = keep;
}

function advance() {
  lastDirection = 1;
  const state = readState() || { active: true, stepId: STEPS[0].id };
  const idx = stepIndexById(state.stepId);
  const currentStepDef = STEPS[idx];

  const overrideStep = currentStepDef?.nextStepId
    ? STEPS.find((s) => s.id === currentStepDef.nextStepId)
    : null;
  const nextStep = overrideStep || STEPS[idx + 1];

  // Moving to a step on the next slide of the project form: press the
  // form's own Continue so the form moves with the tour. The
  // cl:slide-changed listener below then lands the card on the first
  // step of the new slide. If the form refuses (a required field is
  // empty), take the user to the field it wants.
  if (
    currentStepDef?.slide !== undefined &&
    nextStep?.slide !== undefined &&
    nextStep.slide > currentStepDef.slide
  ) {
    const formNext = document.getElementById("next-btn");
    if (formNext && !formNext.classList.contains("hidden")) {
      formNext.click();
      if (readState()?.stepId === currentStepDef.id) bounceToFormBlocker(currentStepDef);
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
  lastDirection = -1;
  const state = readState() || { active: true, stepId: STEPS[0].id };
  const idx = stepIndexById(state.stepId);
  const currentStepDef = STEPS[idx];
  const prevStep = STEPS[idx - 1];

  // Stepping back across a slide boundary: press the form's Back.
  // cl:slide-changed then lands the card on the last step of that slide.
  if (
    currentStepDef?.slide !== undefined &&
    prevStep?.slide !== undefined &&
    prevStep.slide < currentStepDef.slide
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
  const clamped = Math.max(0, Math.min(STEPS.length - 1, idx));
  const from = stepIndexById(readState()?.stepId);
  lastDirection = clamped < from ? -1 : 1;
  transitionTo(STEPS[clamped]);
}

function skip() {
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
  showToast(
    "Tour closed. You can replay it any time from Settings, under General.",
    { kind: "info", duration: 4500 }
  );
}

function complete() {
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
  showToast(
    "You're all set. You can replay the tour any time from Settings, under General.",
    { kind: "success", duration: 4500 }
  );
}

/* ============================================================== */
/*                      AUTO START / RESUME                        */
/* ============================================================== */

function startForRole(role) {
  setFlowByRole(role);
  lastDirection = 1;
  writeState({ active: true, stepId: STEPS[0].id, role });
  const first = STEPS[0];
  if (needsCrossPageNav(first)) {
    window.location.href = stepUrl(first);
    return;
  }
  // setTimeout (not rAF) so the kickoff runs in a background tab too.
  setTimeout(() => waitForTargetThenRender(first), 0);
}

// Public start — used by the settings replay button.
async function start() {
  const role = await fetchCurrentUserRole();
  startForRole(role);
}

// Render a step once its target is on the page and visible. Pages load
// their data async, so the target can take a while to appear. If the
// page has finished loading and the target still isn't there, the step
// is skipped. `grace` is how long to keep waiting after the page looks
// ready (short for an in-page move, longer right after a page load).
function stepPageReady(step) {
  if (!step.ready) return true;
  try {
    return typeof step.ready === "function"
      ? !!step.ready()
      : isVisible(document.querySelector(step.ready));
  } catch (_) {
    return false;
  }
}

function waitForTargetThenRender(step, opts = {}) {
  const token = ++waitToken;
  if (!step.targetSelector) {
    renderStep(step.id);
    return;
  }
  const grace = opts.grace ?? 4000;
  const hardCap = opts.grace != null ? Math.max(grace, 1500) : 15000;
  const started = performance.now();
  let readyAt = null;
  let aligned = false;
  const pageReady = () =>
    document.readyState === "complete" && stepPageReady(step);

  (function poll() {
    if (token !== waitToken) return;
    const state = readState();
    if (!state?.active || state.stepId !== step.id) return;
    const target = resolveTarget(step);
    const ready = pageReady();
    // Once the page is up, make sure the project form is on this
    // step's slide (it may send the tour to a different step).
    if (!aligned && (ready || !step.ready)) {
      aligned = true;
      if (alignWizardSlide(step)) return;
    }
    if (target && isVisible(target) && (ready || !step.ready)) {
      renderStep(step.id);
      return;
    }
    const now = performance.now();
    if (ready && readyAt === null) readyAt = now;
    const waitedAfterReady = readyAt !== null && now - readyAt > grace;
    if ((step.ready && waitedAfterReady) || now - started > hardCap) {
      skipMissingStep(step);
      return;
    }
    setTimeout(poll, 80);
  })();
}

function resume() {
  const state = readState();
  if (!state?.active) return false;
  if (state.role) setFlowByRole(state.role);
  const step = STEPS[stepIndexById(state.stepId)];
  if (!step) {
    // Stale state from an older tour. Drop it so it doesn't linger.
    writeState(null);
    return false;
  }
  if (step.path && step.path !== window.location.pathname) {
    // The user is on a different page than the saved step. Don't
    // redirect; the next visit to that page picks the tour back up.
    return false;
  }
  if (step.hash && step.hash !== window.location.hash) {
    window.location.hash = step.hash;
    setTimeout(() => waitForTargetThenRender(step), 60);
    return true;
  }
  setTimeout(() => waitForTargetThenRender(step), 0);
  return true;
}

let autoStarted = false;
async function maybeAutoStart() {
  if (autoStarted) return;
  autoStarted = true;
  const params = new URLSearchParams(window.location.search);
  // A reload (or back/forward) in the middle of the tour should pick up
  // where the user was, even though the URL still carries the trigger.
  let navType = "navigate";
  try { navType = performance.getEntriesByType("navigation")[0]?.type || "navigate"; } catch (_) {}
  if (navType !== "navigate" && readState()?.active) {
    resume();
    return;
  }
  // ?tutorial=1 restarts the tour. (listing.html?tutorial=1 is the
  // practice project, a step inside the tour, so it must not restart.)
  if (params.get("tutorial") === "1" && window.location.pathname !== "/listing.html") {
    writeState(null);
    await clearOnboardedInDb();
    const role = await fetchCurrentUserRole();
    startForRole(role);
    return;
  }
  if (params.get("welcome") === "1") {
    // Fresh from register. Only auto-start if they haven't already
    // been marked onboarded.
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
/*               PROJECT FORM SYNC                                 */
/* ============================================================== */

// When the user moves the project form themselves (its own Continue /
// Back buttons or progress dots), bring the tour along. Going forward
// lands on the first step of the new slide; going back lands on the
// last, so the user picks up where they left off.
window.addEventListener("cl:slide-changed", (e) => {
  if (aligningSlide) return;
  const state = readState();
  if (!state?.active) return;
  const current = STEPS[stepIndexById(state.stepId)];
  if (!current || current.slide === undefined) return;
  const targetSlide = Number(e.detail?.slide);
  if (!Number.isFinite(targetSlide) || targetSlide === current.slide) return;
  const stepsOnTarget = STEPS.filter((s) => s.slide === targetSlide);
  if (!stepsOnTarget.length) return;
  const goingForward = targetSlide > current.slide;
  lastDirection = goingForward ? 1 : -1;
  const next = goingForward
    ? stepsOnTarget[0]
    : stepsOnTarget[stepsOnTarget.length - 1];
  writeState({ ...state, active: true, stepId: next.id });
  // The slide only becomes visible after this event returns.
  setTimeout(() => {
    if (readState()?.stepId === next.id) waitForTargetThenRender(next, { grace: 600 });
  }, 0);
});

// Successful publish ends the owner tour. The next page
// (/listing.html?posted=1) shows its own "Your project is live" panel.
window.addEventListener("cl:listing-published", () => {
  const state = readState();
  if (!state?.active) return;
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
});

// Save-as-draft ends the owner tour too: the draft is real work in
// progress and the dashboard has no tour steps.
window.addEventListener("cl:listing-saved-as-draft", () => {
  const state = readState();
  if (!state?.active) return;
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
});

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => maybeAutoStart(), { once: true });
} else {
  maybeAutoStart();
}
