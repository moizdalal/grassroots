/* Business trust badges — shared by the marketplace card and listing
   detail. Data comes from the get_business_badges RPC
   (supabase/migrations/add_business_badges.sql); the rules live there.

   Card: icons only after the business name, max 2 then "+N".
   Detail: icon + two-word label, plus a short facts line.

   Preview helper: ?fakebadges=1 swaps in fixture summaries so the UI
   can be checked before any business has released a payment. */

const ICONS = {
  active:
    '<path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  quick: '<path d="M9 1.5L3.5 9H8l-1 5.5L12.5 7H8z" fill="currentColor"/>',
  scope:
    '<circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="8" cy="8" r="2" fill="currentColor"/>',
  repeat:
    '<path d="M3 6.5a5 5 0 0 1 8.6-2.3M13 9.5a5 5 0 0 1-8.6 2.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M12.2 1.8v2.8H9.4M3.8 14.2v-2.8h2.8" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>',
};

// Display order: active client first (the recency signal), then the
// rarest badge earned, so a card's two slots carry the most information.
export const BADGES = [
  { key: "active_client", icon: "active", label: "Active client", meaning: "Paid a student in the last 90 days." },
  { key: "repeat_client", icon: "repeat", label: "Repeat client", meaning: "Has hired more than one student." },
  { key: "quick_approver", icon: "quick", label: "Quick approver", meaning: "Usually approves delivered work in under 3 days." },
  { key: "clear_scope", icon: "scope", label: "Clear scope", meaning: "Recent students rated the scope as clear." },
];

const FAKE_SUMMARIES = [
  { students_paid: 3, engagements_paid: 4, median_approval_days: 1.8, active_client: true, quick_approver: true, clear_scope: true, repeat_client: true },
  { students_paid: 1, engagements_paid: 1, median_approval_days: 2.4, active_client: true, quick_approver: false, clear_scope: false, repeat_client: false },
  null,
  { students_paid: 2, engagements_paid: 2, median_approval_days: 6.5, active_client: false, quick_approver: false, clear_scope: false, repeat_client: true },
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

function iconHtml(badge, extraClass = "") {
  return `<span class="gr-biz-badge${extraClass}" aria-hidden="true"><svg viewBox="0 0 16 16">${ICONS[badge.icon]}</svg></span>`;
}

/* Card slot: up to `max` icons, then "+N". "New" for no history. */
export function renderBadgeIcons(summary, { max = 2 } = {}) {
  if (summary === undefined) return "";
  if (summary === null) return '<span class="gr-biz-badges__new">New</span>';
  const earned = earnedBadges(summary);
  if (!earned.length) return "";
  const shown = earned.slice(0, max);
  const rest = earned.slice(max);
  const label = earned.map((b) => b.label).join(", ");
  return `<span class="gr-biz-badges" role="img" aria-label="${label}">${shown
    .map((b) => `<span class="gr-biz-badges__item" title="${b.label}">${iconHtml(b)}</span>`)
    .join("")}${
    rest.length
      ? `<span class="gr-biz-badges__more" title="${rest.map((b) => b.label).join(", ")}">+${rest.length}</span>`
      : ""
  }</span>`;
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
        `<li class="gr-biz-badge-pill" title="${b.meaning}">${iconHtml(b)}<span>${b.label}</span></li>`
    )
    .join("");

  if (!facts.length && !pills) return "";
  const factsText = facts.join(" · ");
  return `<div class="gr-biz-badge-block">
    ${factsText ? `<p class="gr-biz-badge-block__facts">${factsText.charAt(0).toUpperCase()}${factsText.slice(1)}</p>` : ""}
    ${pills ? `<ul class="gr-biz-badge-block__pills" aria-label="Badges">${pills}</ul>` : ""}
  </div>`;
}
