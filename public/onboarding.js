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

const STORAGE_KEY = "grassroots_onboarding";
const TOOLTIP_ID = "gr-onboarding-tooltip";
const OVERLAY_ID = "gr-onboarding-overlay";
const VINE_ID = "gr-onboarding-vine";
const CONFIRM_ID = "gr-onboarding-confirm";

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
// `allowedInteractive` lists extra selectors the user is allowed to
// click without tripping the off-scope guardrail — used when the
// user must click something outside the spotlight to complete the
// step (e.g. the save button below the business form).
//
// `kind: "choice"` renders decision buttons inside the bubble itself
// instead of pointing at a page element.
const STEPS = [
  {
    id: "edit-profile",
    label: "profile",
    path: "/profile.html",
    targetSelector: '.pp-header__actions a[href*="settings"]',
    placement: "left",
    advanceOn: "target",
    title: "let's set you up.",
    body: "first thing — tap edit profile. we'll fill in the rest from there.",
  },
  {
    id: "upload-photo",
    label: "photo",
    path: "/settings.html",
    hash: "#personal",
    // First selector covers the no-avatar state (upload label visible).
    // Second covers the has-avatar state (change/remove buttons visible).
    targetSelector: ["#pf-avatar-upload-label:not(.hidden)", "#pf-avatar-change-btn"],
    placement: "right",
    advanceOn: "next",
    title: "show your face.",
    body: "drop in a profile photo, then tap next when you're ready.",
  },
  {
    id: "nav-general",
    label: "general",
    path: "/settings.html",
    targetSelector: '.settings-tab[data-tab="general"]',
    placement: "bottom",
    advanceOn: "target",
    title: "next stop — themes.",
    body: "head over to the general tab to pick how grassroots looks for you.",
  },
  {
    id: "themes",
    label: "themes",
    path: "/settings.html",
    hash: "#general",
    targetSelector: "#theme-grid",
    // Any theme card click is allowed — it applies the theme but
    // doesn't advance the tutorial; the user moves on via the next
    // button when they're done.
    allowedInteractive: "#theme-grid .theme-card",
    placement: "bottom",
    advanceOn: "next",
    title: "pick a vibe.",
    body: "try the themes — tap one to apply it. hit next when you've settled.",
  },
  {
    id: "nav-professional",
    label: "professional",
    path: "/settings.html",
    targetSelector: '.settings-tab[data-tab="professional"]',
    placement: "bottom",
    advanceOn: "target",
    title: "now the important one.",
    body: "click the professional tab — this is where your business identity lives.",
  },
  {
    id: "business-info",
    label: "business",
    path: "/settings.html",
    hash: "#professional",
    targetSelector: "#business-section",
    // Save sits outside the highlighted section but is the natural
    // close to the step — list it as an allowed interaction so the
    // guardrail doesn't pop while the user saves their form.
    allowedInteractive: "#save-btn",
    placement: "right",
    advanceOn: "next",
    title: "the big one.",
    body: "tell consultants about your business, save below, then tap next.",
  },
  {
    id: "listing-choice",
    label: "listing",
    path: "/settings.html",
    targetSelector: null,
    placement: "center",
    kind: "choice",
    advanceOn: "next",
    title: "now post your first listing.",
    body: "you can bring your own idea or follow an example. we'll walk you through it either way.",
    choices: [
      { id: "own", label: "i've got an idea", primary: true, href: "/create-listing.html" },
      { id: "example", label: "show me an example", href: "/create-listing.html?example=1" },
    ],
  },
  // Listing walkthrough — one tooltip per field so the user learns what
  // each box is for. Each step carries a `slide` index (for the
  // cl:slide-changed sync) and `body` is split into `own` (write your
  // own copy) vs `example` (we pre-fill this field as the tooltip
  // arrives) variants. Steps with an `example` payload trigger
  // `cl:fill-example-field` on render — the create-listing page
  // listens and fills the matching field idempotently.
  {
    id: "lw-title",
    label: "title",
    path: "/create-listing.html",
    slide: 0,
    targetSelector: 'input[name="title"]',
    placement: "bottom",
    advanceOn: "next",
    allowedInteractive: [
      "#next-btn", "#back-btn", "#save-draft-btn",
      'input[name="title"]',
    ],
    title: "title — name the work.",
    body: {
      own: "name the work in plain language. short and concrete reads best — consultants scan this list quickly.",
      example: "we filled in a sample title. notice it names the work and the audience in eight words. short and concrete is best.",
    },
    example: {
      type: "value",
      field: "title",
      value: "weekend farmers market sales push",
    },
  },
  {
    id: "lw-contract",
    label: "contract",
    path: "/create-listing.html",
    slide: 0,
    targetSelector: ".ct-options",
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#next-btn", "#back-btn", "#save-draft-btn",
      ".ct-options",
      "#ct-advanced", "#ct-advanced summary",
      "#ct-phased-radio", "#ct-retainer-radio", "#ct-add-maintenance",
      'input[name="contract_type"]', 'input[name="retainer_terms"]',
      "#ct-retainer-cadence", "#ct-retainer-periods", "#ct-retainer-fee",
    ],
    title: "contract type — how you'll work together.",
    body: {
      own: "standard is one delivery for one fee. phased adds proposal → solution → optional maintenance. retainer is a recurring engagement.",
      example: "we'll stick with standard — one well-scoped delivery. open 'advanced contracts' later when an engagement needs phases or a recurring cadence.",
    },
    // No fill — contract_type defaults to "standard" already.
  },
  {
    id: "lw-context",
    label: "context",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'textarea[name="issue_context"]',
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#next-btn", "#back-btn", "#save-draft-btn",
      'textarea[name="issue_context"]',
    ],
    title: "context — the back-story.",
    body: {
      own: "what is happening in the business right now? give a consultant enough background to read in.",
      example: "context anchors the work. without it, a consultant has to guess what's already been tried or why the work matters.",
    },
    example: {
      type: "value",
      field: "issue_context",
      value: "we run a small bakery near campus. our weekend booth at the farmers market has the highest foot traffic of the week, but sales have plateaued for three months. menu, pricing, and signage have not changed in that window.",
    },
  },
  {
    id: "lw-problem",
    label: "problem",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'textarea[name="business_problem"]',
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#next-btn", "#back-btn", "#save-draft-btn",
      'textarea[name="business_problem"]',
    ],
    title: "business problem — the goal.",
    body: {
      own: "name the specific thing you want to fix or move. one concrete outcome beats a vague description.",
      example: "this is the goal in one sentence. notice the example pins a specific number — 'twenty percent' — and a window — 'four weeks'.",
    },
    example: {
      type: "value",
      field: "business_problem",
      value: "we want to lift saturday booth sales by at least twenty percent over four weeks. budget exists for new menu prints, but staffing is fixed.",
    },
  },
  {
    id: "lw-output",
    label: "output",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'textarea[name="expected_output"]',
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#next-btn", "#back-btn", "#save-draft-btn",
      'textarea[name="expected_output"]',
    ],
    title: "standards of work — what good looks like.",
    body: {
      own: "what does good output look like? say the format, the rigor, and how you plan to use it.",
      example: "this sets the bar. naming a format — google doc, pdf — and a quality threshold saves a back-and-forth later.",
    },
    example: {
      type: "value",
      field: "expected_output",
      value: "a written plan with two or three testable tactics, suggested menu and signage tweaks, and a short script the booth staff can use to upsell. we want it as a google doc or pdf, ready to apply the following saturday.",
    },
  },
  {
    id: "lw-details",
    label: "details",
    path: "/create-listing.html",
    slide: 1,
    targetSelector: 'textarea[name="additional_details"]',
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#next-btn", "#back-btn", "#save-draft-btn",
      'textarea[name="additional_details"]',
    ],
    title: "additional details — anything else.",
    body: {
      own: "constraints, previous attempts, audience notes, brand voice. optional, but it helps a consultant scope better.",
      example: "this is for context that didn't fit above — past attempts, audience details, brand voice.",
    },
    example: {
      type: "value",
      field: "additional_details",
      value: "we mostly sell bread, cookies, and coffee. our regulars are college students and parents with young kids. our instagram has 1,200 followers but engagement is low.",
    },
  },
  {
    id: "lw-attachments",
    label: "files",
    path: "/create-listing.html",
    slide: 1,
    // `:has()` picks the whole <label> wrapping the file input so the
    // spotlight covers the heading, button, and hint as one block —
    // not just the small "choose files" control.
    targetSelector: 'label:has(#listing-attachments)',
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#next-btn", "#back-btn", "#save-draft-btn",
      "#listing-attachments",
    ],
    title: "supporting files — optional context.",
    body: {
      own: "attach files that help a consultant scope — briefs, designs, brand guides, csv data. up to 3 files, 5mb each.",
      example: "file uploads are optional. we're skipping them in this sample — add them later when you have something to share.",
    },
    // No `example` payload — file inputs can't be programmatically
    // populated, and the sample doesn't ship with real attachments.
  },
  {
    id: "lw-categories",
    label: "tags",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#cat-multiselect",
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#submit-btn", "#back-btn", "#save-draft-btn",
      "#cat-multiselect", "#cat-search", ".ms-option", "[data-remove-cat]",
    ],
    title: "categories — tag the work.",
    body: {
      own: "tag the work so the right consultants find it. one or two focused tags beat a long list of broad ones.",
      example: "we tagged sales and marketing. specific tags help students filter the marketplace and self-select.",
    },
    example: {
      type: "categories",
      values: ["sales", "marketing"],
    },
  },
  {
    id: "lw-budget",
    label: "budget",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: ".gr-money-range",
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#submit-btn", "#back-btn", "#save-draft-btn",
      'input[name="budget_min"]', 'input[name="budget_max"]',
    ],
    title: "budget range — the scope you can fund.",
    body: {
      own: "set the floor and ceiling. consultants size their proposals against this — too tight and you'll get few bids.",
      example: "$200–$450 reads as 'small project, room to negotiate'. the range gives consultants space to scope honestly.",
    },
    example: {
      type: "value-multi",
      fields: { budget_min: "200", budget_max: "450" },
    },
  },
  {
    id: "lw-turnaround",
    label: "time",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: 'input[name="turnaround_days"]',
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#submit-btn", "#back-btn", "#save-draft-btn",
      'input[name="turnaround_days"]',
    ],
    title: "turnaround — days from accept to delivery.",
    body: {
      own: "how many days do you actually need? include some buffer for revisions.",
      example: "ten days is realistic for this scope. too short kills good bids; too long invites scope creep.",
    },
    example: {
      type: "value",
      field: "turnaround_days",
      value: "10",
    },
  },
  {
    id: "lw-quals",
    label: "skills",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#qual-list",
    placement: "right",
    advanceOn: "next",
    allowedInteractive: [
      "#submit-btn", "#back-btn", "#save-draft-btn",
      "#qual-list", ".cl-qual-input", "#add-qual-btn",
    ],
    title: "qualifications — skills you'd want.",
    body: {
      own: "two or three concrete skills, not generic 'experience in marketing'. specific helps students decide if they're a fit.",
      example: "two qualifications is enough. notice both name a concrete skill — that's what students can actually evaluate.",
    },
    example: {
      type: "quals",
      values: [
        "familiarity with local food businesses",
        "experience writing short-form sales scripts",
      ],
    },
  },
  {
    id: "lw-publish",
    label: "publish",
    path: "/create-listing.html",
    slide: 2,
    targetSelector: "#submit-btn",
    placement: "left",
    advanceOn: "next",
    allowedInteractive: ["#submit-btn", "#back-btn", "#save-draft-btn"],
    title: "publish — go live.",
    body: {
      own: "review the right-rail preview. tap create opportunity to publish. you can edit or unpublish anytime.",
      example: "give the right-rail preview a final read. when it looks right, tap create opportunity to publish this sample.",
    },
  },
  // Listing management — placeholder chapter. Once a listing is live,
  // the business owner manages it from the dashboard: review bids,
  // counter-offer, fund escrow, kick off the engagement, release
  // funds, leave reviews. None of that walkthrough is built yet, so
  // this step is a single "coming soon" landing pad — its real value
  // is keeping a chapter chip in the nav so the user knows there's
  // more after publish.
  {
    id: "lm-placeholder",
    label: "soon",
    path: null,
    targetSelector: null,
    placement: "center",
    advanceOn: "next",
    title: "listing management — coming soon.",
    body: "we're building the next stretch of this tutorial — reviewing bids, funding escrow, kicking off engagements, and releasing payment. for now this chapter is a placeholder.",
  },
  {
    id: "complete",
    label: "done",
    path: null,
    targetSelector: null,
    placement: "center",
    advanceOn: "next",
    title: "you're set.",
    body: "find this tutorial any time in settings → general if you want a refresh.",
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
const CHAPTERS = [
  {
    id: "profile-setup",
    label: "profile setup",
    stepIds: [
      "edit-profile",
      "upload-photo",
      "nav-general",
      "themes",
      "nav-professional",
      "business-info",
      "listing-choice",
    ],
  },
  {
    id: "create-listing",
    label: "create listing",
    stepIds: [
      "lw-title", "lw-contract",
      "lw-context", "lw-problem", "lw-output", "lw-details", "lw-attachments",
      "lw-categories", "lw-budget", "lw-turnaround", "lw-quals",
      "lw-publish",
    ],
  },
  {
    id: "listing-management",
    // Short label so the chip fits next to "profile setup" and
    // "create listing" without overflowing the bubble.
    label: "manage",
    stepIds: ["lm-placeholder"],
  },
];

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
      : `jump to ${chapter.label} (${stepCount} step${stepCount === 1 ? "" : "s"})`;
    const checkSvg = isVisited
      ? `<svg class='gr-onb-chapter-chip__check' viewBox='0 0 16 16' aria-hidden='true'><path d='M3 8.5 L6.5 12 L13 4.5' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'/></svg>`
      : "";
    return `<button type='button' class='gr-onb-chapter-chip ${stateCls}' data-chapter-id='${escapeHtml(chapter.id)}' data-jump-step-idx='${firstIdx}' aria-label='${escapeHtml(aria)}' aria-current='${isCurrent ? "step" : "false"}' title='${escapeHtml(chapter.label)}'>
      ${checkSvg}
      <span class='gr-onb-chapter-chip__label'>${escapeHtml(chapter.label)}</span>
    </button>`;
  }).filter(Boolean);

  const chipsRow = `<div class='gr-onb-chapnav__chips'>${chips.join('<span class="gr-onb-chap-line" aria-hidden="true"></span>')}</div>`;

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
        return `<button type='button' class='gr-onb-dot ${cls}' data-step-idx='${idx}' aria-label='go to ${escapeHtml(s.label)}' title='${escapeHtml(s.label)}'>
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
function resolveStepBody(step) {
  const body = step?.body;
  if (typeof body === "string" || body == null) return body || "";
  const choice = readState()?.choice;
  return body[choice] || body.own || body.example || "";
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
  const selectors = Array.isArray(step.targetSelector)
    ? step.targetSelector
    : [step.targetSelector];
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
  [TOOLTIP_ID, OVERLAY_ID, VINE_ID, CONFIRM_ID].forEach((id) => {
    const n = document.getElementById(id);
    if (n) n.remove();
  });
  document.body.classList.remove("gr-onboarding-active");
  teardownGuardrail();
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
const VINE_SLACK = 1.45; // segment length multiplier — looser = deeper sag
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
  return { start: bubbleCenter, end: endpoint };
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
  installGuardrail();
  // Re-seed the vine each step so it starts from the line between
  // the new bubble + new target rather than swinging across the page.
  restartVineForStep();

  // Notify other modules that a step changed (used for analytics
  // / external hooks — currently a no-op consumer).
  window.dispatchEvent(new CustomEvent("grassroots:onboarding-step", { detail: { step } }));
}

/* ============================================================== */
/*                  OFF-SCOPE CLICK GUARDRAIL                      */
/* ============================================================== */

// Captures every click on the document while the tutorial is active.
// Clicks on the bubble itself, on the current step's spotlight target
// (or its descendants), or on any of the step's `allowedInteractive`
// selectors pass through. Clicks anywhere else get intercepted: the
// underlying action is blocked and a confirm modal asks the user
// whether to exit the tutorial or resume where they left off.
let guardrailInstalled = false;

function installGuardrail() {
  if (guardrailInstalled) return;
  document.addEventListener("click", guardrailClickHandler, true);
  document.addEventListener("mousedown", guardrailMousedownHandler, true);
  guardrailInstalled = true;
}

function teardownGuardrail() {
  if (!guardrailInstalled) return;
  document.removeEventListener("click", guardrailClickHandler, true);
  document.removeEventListener("mousedown", guardrailMousedownHandler, true);
  guardrailInstalled = false;
}

function isClickWithinScope(eventTarget) {
  if (!renderedStepId) return true;
  const step = STEPS[stepIndexById(renderedStepId)];
  if (!step) return true;
  // Tutorial UI is always in scope.
  if (eventTarget.closest && (
    eventTarget.closest(`#${TOOLTIP_ID}`) ||
    eventTarget.closest(`#${CONFIRM_ID}`) ||
    eventTarget.closest("[data-onb-action]")
  )) return true;
  // The spotlight target itself + its descendants are in scope.
  const target = resolveTarget(step);
  if (target && (target === eventTarget || target.contains(eventTarget))) return true;
  // Per-step extras (e.g. save button for the business-info step).
  const allowed = step.allowedInteractive
    ? (Array.isArray(step.allowedInteractive) ? step.allowedInteractive : [step.allowedInteractive])
    : [];
  for (const sel of allowed) {
    if (eventTarget.closest && eventTarget.closest(sel)) return true;
  }
  return false;
}

function guardrailClickHandler(e) {
  if (!renderedStepId) return;
  // The confirm modal is already open — let its own clicks through.
  if (document.getElementById(CONFIRM_ID)) return;
  if (isClickWithinScope(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
  openConfirmModal();
}

// Also block mousedown so the page doesn't visually respond (focus
// rings, button press states) before the click gets cancelled. Same
// scope check as the click handler.
function guardrailMousedownHandler(e) {
  if (!renderedStepId) return;
  if (document.getElementById(CONFIRM_ID)) return;
  if (isClickWithinScope(e.target)) return;
  e.preventDefault();
  e.stopPropagation();
}

function openConfirmModal() {
  if (document.getElementById(CONFIRM_ID)) return;
  const modal = document.createElement("div");
  modal.id = CONFIRM_ID;
  modal.className = "gr-onb-confirm";
  modal.innerHTML = `
    <div class="gr-onb-confirm__backdrop" data-onb-confirm-action="resume"></div>
    <div class="gr-onb-confirm__card" role="dialog" aria-modal="true" aria-labelledby="gr-onb-confirm-title">
      <h3 id="gr-onb-confirm-title" class="gr-onb-confirm__title">heading off?</h3>
      <p class="gr-onb-confirm__body">looks like you're wandering. want to wrap the tutorial here, or pick it back up?</p>
      <div class="gr-onb-confirm__actions">
        <button type="button" class="gr-onb-skip" data-onb-confirm-action="exit">exit tutorial</button>
        <button type="button" class="gr-onb-btn gr-onb-btn--primary" data-onb-confirm-action="resume">resume</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
  modal.addEventListener("click", (e) => {
    const action = e.target.closest("[data-onb-confirm-action]")?.dataset.onbConfirmAction;
    if (!action) return;
    if (action === "exit") {
      modal.remove();
      skip();
    } else if (action === "resume") {
      modal.remove();
    }
  });
}

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

function position(step, target /*, options */) {
  const overlay = document.getElementById(OVERLAY_ID);
  const tooltip = document.getElementById(TOOLTIP_ID);
  if (!overlay || !tooltip) return;

  const vw = window.innerWidth;
  const vh = window.innerHeight;

  if (!target || step.placement === "center") {
    // No-target step (choice / complete) — full-viewport solid dim so
    // the centered bubble has focus. The overlay element is a single
    // fixed-inset div with a transparent → dim toggle, which is
    // robust across zoom modes (no positioning math involved).
    overlay.classList.add("gr-onb-overlay--solid");
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

  const r = target.getBoundingClientRect();

  // Once the user has dragged the bubble for this step, leave it
  // wherever they parked it — the cutout still tracks the target.
  if (userDraggedBubble) return;

  // Place the bubble. Prefer the requested placement but flip if it
  // would clip off the viewport edge. Bubble has a fixed natural width
  // (~320px) — we use that to bound the position math.
  const bubbleW = 320;
  const bubbleH = tooltip.offsetHeight || 200;
  const gap = 56;
  let bx, by;
  switch (step.placement) {
    case "left":
      bx = r.left - bubbleW - gap;
      by = r.top + r.height / 2 - bubbleH / 2;
      break;
    case "right":
      bx = r.right + gap;
      by = r.top + r.height / 2 - bubbleH / 2;
      break;
    case "top":
      bx = r.left + r.width / 2 - bubbleW / 2;
      by = r.top - bubbleH - gap;
      break;
    case "bottom":
    default:
      bx = r.left + r.width / 2 - bubbleW / 2;
      by = r.bottom + gap;
      break;
  }
  // Clamp to viewport with 16px margins.
  bx = Math.max(16, Math.min(vw - bubbleW - 16, bx));
  by = Math.max(16, Math.min(vh - bubbleH - 16, by));
  tooltip.style.left = `${bx}px`;
  tooltip.style.top = `${by}px`;
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
                  data-choice-href='${escapeHtml(c.href || "")}'>
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
    ? `<button type='button' class='gr-onb-btn gr-onb-btn--primary' data-onb-action='complete'>got it</button>`
    : (hasInlineAdvance
        ? ""
        : `<button type='button' class='gr-onb-btn gr-onb-btn--primary' data-onb-action='advance'>next →</button>`);

  return `
    <button type='button' class='gr-onb-close' data-onb-action='close' aria-label='close tutorial'>×</button>
    <nav class='gr-onb-dotnav' aria-label='tutorial steps'>${dots}</nav>
    <h2 class='gr-onb-title'>${escapeHtml(step.title)}</h2>
    <p class='gr-onb-body'>${escapeHtml(resolveStepBody(step))}</p>
    ${choicesHtml}
    <div class='gr-onb-actions'>
      ${isFirst ? "" : `<button type='button' class='gr-onb-skip gr-onb-skip--back' data-onb-action='back'>← back</button>`}
      ${primaryBtn}
      <button type='button' class='gr-onb-skip gr-onb-skip--end' data-onb-action='close'>skip</button>
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
    nx = Math.max(12, Math.min(window.innerWidth - w - 12, nx));
    ny = Math.max(12, Math.min(window.innerHeight - h - 12, ny));
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

// User picked an option on a "choice" step. The choice carries an
// optional href so we can persist any flag (e.g. ?example=1) into
// the next page's URL. Advance writes state then transitions to the
// next step normally — if the choice has an href the destination
// page resolves to the same step but with the URL param set.
function handleChoice(btn) {
  const choiceId = btn.dataset.choiceId || "";
  const href = btn.dataset.choiceHref || "";
  const state = readState() || { active: true, stepId: STEPS[0].id };
  const idx = stepIndexById(state.stepId);
  const nextIdx = Math.min(STEPS.length - 1, idx + 1);
  const next = STEPS[nextIdx];
  // Stash the chosen variant so downstream tutorial steps + the
  // create-listing page can read it (e.g. to pre-fill an example).
  writeState({ active: true, stepId: next.id, choice: choiceId });
  if (href) {
    window.location.href = href;
    return;
  }
  transitionTo(next);
}

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
  if (step.path && step.path !== window.location.pathname) {
    window.location.href = step.path + (step.hash || "");
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
  const nextStep = STEPS[idx + 1];

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
    "no sweat — replay this any time from settings → general.",
    { kind: "info", duration: 4500 }
  );
}

function complete() {
  clearTutorialDom();
  writeState(null);
  markOnboardedInDb();
  showToast(
    "you're all set. find this tutorial in settings → general if you want a refresh.",
    { kind: "success", duration: 4500 }
  );
}

/* ============================================================== */
/*                      AUTO START / RESUME                        */
/* ============================================================== */

function start() {
  writeState({ active: true, stepId: STEPS[0].id });
  const first = STEPS[0];
  if (first.path && first.path !== window.location.pathname) {
    window.location.href = first.path + (first.hash || "");
    return;
  }
  // Defer one tick so the host page has time to paint its initial DOM
  // before we try to query for the target element.
  // Use setTimeout 0 (not requestAnimationFrame) so the kickoff runs
  // even when the tab is backgrounded — rAF gets throttled to 1Hz or
  // worse outside the foreground, which silently breaks auto-start.
  setTimeout(() => waitForTargetThenRender(first), 0);
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
  const step = STEPS[stepIndexById(state.stepId)];
  if (!step) return false;
  if (step.path && step.path !== window.location.pathname) {
    // The user is on a different page than the persisted step — don't
    // auto-redirect, just leave the state in place so the next visit
    // to that page picks it up. Avoids surprising redirects.
    return false;
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
    start();
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
        start();
        return;
      }
      const { data } = await client
        .from("profiles")
        .select("onboarded_at")
        .eq("id", user.id)
        .maybeSingle();
      if (!data?.onboarded_at) {
        start();
        return;
      }
    } catch (_) {
      start();
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

// Successful publish — jump straight to the "you're all set" step so
// the bubble lands on the listing detail page after redirect.
window.addEventListener("cl:listing-published", () => {
  const state = readState();
  if (!state?.active) return;
  const completeStep = STEPS.find((s) => s.id === "complete");
  if (completeStep) writeState({ ...state, stepId: completeStep.id });
});

document.addEventListener("DOMContentLoaded", () => {
  maybeAutoStart();
});
// In case DOMContentLoaded already fired (script loaded late), also run
// immediately. maybeAutoStart is idempotent — it reads URL + DB state.
if (document.readyState === "complete" || document.readyState === "interactive") {
  maybeAutoStart();
}
