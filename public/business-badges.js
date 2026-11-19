/* Business trust badges — shared by the marketplace card and listing
   detail. Data comes from the get_business_badges RPC
   (supabase/migrations/add_business_badges.sql); the rules live there.

   Card: every earned icon after the business name, each in its own color.
   Detail: icon + two-word label, plus a short facts line.

   Tapping an icon, pill or "New" opens a small popover that says what
   it means (wireBadgeTips). Phones have no hover, so title alone hid
   the meaning there.

   Preview helper: ?fakebadges=1 swaps in fixture summaries so the UI
   can be checked before any business has released a payment. */

const ICONS = {
  active:
    '<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  quick: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" fill="currentColor"/>',
  shield:
    '<path d="M8 1.6l5 1.9v4c0 3.1-2.1 5.4-5 6.9-2.9-1.5-5-3.8-5-6.9v-4z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M5.6 8l1.7 1.7 3.2-3.4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
  repeat:
    '<path d="M3 6.5a5 5 0 0 1 8.6-2.3M13 9.5a5 5 0 0 1-8.6 2.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12.2 1.8v2.8H9.4M3.8 14.2v-2.8h2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};

// Display order: active client first (the recency signal), then the
// rarer badges.
export const BADGES = [
  { key: "active_client", icon: "active", label: "Active client", meaning: "Paid a student in the last 90 days." },
  { key: "repeat_client", icon: "repeat", label: "Repeat client", meaning: "Has hired more than one student." },
  { key: "quick_approver", icon: "quick", label: "Quick approver", meaning: "Usually approves delivered work in under 3 days." },
  { key: "no_disputes", icon: "shield", label: "No disputes", meaning: "3+ paid projects, none reported or refunded." },
];

const FAKE_SUMMARIES = [
  { students_paid: 3, engagements_paid: 4, median_approval_days: 1.8, active_client: true, quick_approver: true, no_disputes: true, repeat_client: true },
  { students_paid: 1, engagements_paid: 1, median_approval_days: 2.4, active_client: true, quick_approver: false, no_disputes: false, repeat_client: false },
  null,
  { students_paid: 2, engagements_paid: 2, median_approval_days: 6.5, active_client: false, quick_approver: false, no_disputes: false, repeat_client: true },
];

function useFakeBadges() {
  try {
    return new URLSearchParams(window.location.search).get("fakebadges") === "1";
  } catch {
    return false;
  }
}

/* Returns Map<owner_id, summary|null>. A null entry means the business
   has never released a payment ("New"). Returns null when the RPC isn't
   available, so callers render nothing rather than a wrong "New". */
export async function loadBusinessBadges(client, ownerIds) {
  const ids = [...new Set((ownerIds || []).filter(Boolean))];
  if (!ids.length) return new Map();

  if (useFakeBadges()) {
    return new Map(ids.map((id, i) => [id, FAKE_SUMMARIES[i % FAKE_SUMMARIES.length]]));
  }

  const { data, error } = await client.rpc("get_business_badges", { target_owner_ids: ids });
  if (error) {
    console.warn("business badges:", error.message || error);
    return null;
  }
  const map = new Map(ids.map((id) => [id, null]));
  (data || []).forEach((row) => map.set(row.owner_id, row));
  return map;
}

export function earnedBadges(summary) {
  if (!summary) return [];
  return BADGES.filter((b) => summary[b.key]);
}

// Each badge has its own color (--fo-badge-<icon> tokens), set by the
// gr-biz-badge--<icon> modifier.
function iconHtml(badge) {
  return `<span class="gr-biz-badge gr-biz-badge--${badge.icon}" aria-hidden="true"><svg viewBox="0 0 16 16">${ICONS[badge.icon]}</svg></span>`;
}

/* Card slot: every earned icon (four at most), so nothing hides behind
   a "+N". "New" for no history. */
export function renderBadgeIcons(summary) {
  if (summary === undefined) return "";
  if (summary === null) return '<span class="gr-biz-badges__new" data-badge-tip="new">New</span>';
  const earned = earnedBadges(summary);
  if (!earned.length) return "";
  const label = earned.map((b) => b.label).join(", ");
  return `<span class="gr-biz-badges" role="img" aria-label="${label}">${earned
    .map((b) => `<span class="gr-biz-badges__item" title="${b.label}" data-badge-tip="${b.key}">${iconHtml(b)}</span>`)
    .join("")}</span>`;
}

function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/* Detail block: facts line + labeled pills. Empty string when there is
   nothing to say (RPC missing, or history with no current badges and
   no facts worth showing). */
export function renderBadgeBlock(summary) {
  if (summary === undefined) return "";
  if (summary === null) {
    return `<div class="gr-biz-badge-block">
      <p class="gr-biz-badge-block__facts">New to Grassroots. No completed projects yet.</p>
    </div>`;
  }

  const facts = [];
  if (summary.students_paid) facts.push(`${plural(summary.students_paid, "student", "students")} paid`);
  if (summary.median_approval_days != null) {
    const days = Math.max(1, Math.round(Number(summary.median_approval_days)));
    facts.push(`approves in ~${plural(days, "day", "days")}`);
  }

  const earned = earnedBadges(summary);
  const pills = earned
    .map(
      (b) =>
        `<li class="gr-biz-badge-pill gr-biz-badge--${b.icon}" title="${b.meaning}" data-badge-tip="${b.key}">${iconHtml(b)}<span>${b.label}</span></li>`
    )
    .join("");

  if (!facts.length && !pills) return "";
  const factsText = facts.join(" · ");
  return `<div class="gr-biz-badge-block">
    ${factsText ? `<p class="gr-biz-badge-block__facts">${factsText.charAt(0).toUpperCase()}${factsText.slice(1)}</p>` : ""}
    ${pills ? `<ul class="gr-biz-badge-block__pills" aria-label="Badges">${pills}</ul>` : ""}
  </div>`;
}

/* ── Tap-to-explain popover ───────────────────────────────────────
   One delegated listener for the page. Badges sit inside card links,
   so the tap is stopped before the link navigates. A second tap on the
   same badge, a tap anywhere else, scrolling or Escape closes it. */
const NEW_TIP = { label: "New", meaning: "New to Grassroots. No completed projects yet." };
let tipEl = null;
let tipFor = null;

function closeBadgeTip() {
  tipEl?.remove();
  tipEl = null;
  tipFor = null;
}

function openBadgeTip(trigger) {
  const keys = trigger.dataset.badgeTip.split(",");
  const rows = keys
    .map((k) => (k === "new" ? NEW_TIP : BADGES.find((b) => b.key === k)))
    .filter(Boolean);
  if (!rows.length) return;
  closeBadgeTip();
  tipEl = document.createElement("div");
  tipEl.className = "gr-biz-tip";
  tipEl.setAttribute("role", "tooltip");
  tipEl.innerHTML = rows
    .map((b) => `<div class="gr-biz-tip__row">${b.icon ? iconHtml(b) : ""}<div><p class="gr-biz-tip__label">${b.label}</p><p class="gr-biz-tip__text">${b.meaning}</p></div></div>`)
    .join("");
  document.body.appendChild(tipEl);
  tipFor = trigger;

  // Below the badge, flipped above if it would leave the screen, and
  // kept 12px inside the viewport edges.
  const r = trigger.getBoundingClientRect();
  const t = tipEl.getBoundingClientRect();
  const gap = 8;
  let top = r.bottom + gap;
  if (top + t.height > window.innerHeight - 12) top = r.top - gap - t.height;
  const left = Math.min(Math.max(12, r.left + r.width / 2 - t.width / 2), window.innerWidth - t.width - 12);
  tipEl.style.top = `${Math.max(12, top)}px`;
  tipEl.style.left = `${left}px`;
}

export function wireBadgeTips() {
  if (document.__grBadgeTips) return;
  document.__grBadgeTips = true;
  // Capture phase so the card link never sees the tap.
  document.addEventListener("click", (e) => {
    const trigger = e.target.closest?.("[data-badge-tip]");
    if (!trigger) {
      // A tap outside only closes the popover. Swallowing it keeps that
      // tap from also opening the card's listing.
      if (tipEl && !tipEl.contains(e.target)) {
        closeBadgeTip();
        e.preventDefault();
        e.stopPropagation();
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (tipFor === trigger) closeBadgeTip();
    else openBadgeTip(trigger);
  }, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeBadgeTip(); });
  window.addEventListener("scroll", closeBadgeTip, { passive: true, capture: true });
  window.addEventListener("resize", closeBadgeTip);
}
