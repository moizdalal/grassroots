// Shared renderers for the consultant viewer (`.ld-cv`). Businesses see
// these panels when they open an offer on listing.html; consultants see
// the same panels in the "preview as business" modal on settings.html.
// Both pages render from the /api/consultant-profile/:id payload, so
// any change here shows up in both places — keep page-specific chrome
// (proposal index, offer/timeline, pitch) out of this file.

import { renderRatingMarkup } from "/rating.js";
import { getInitials } from "/initials.js";
import { formatUsd } from "/fees.js";

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function escapeAttr(s) { return String(s ?? "").replace(/"/g, "&quot;"); }

export function formatConsultantEducationLine(education) {
  // Prefer the structured educations array (chunk 3+); fall back to the
  // legacy flat columns for rows that haven't been migrated to the new
  // schema yet.
  const primary = Array.isArray(education?.educations) && education.educations[0]
    ? education.educations[0]
    : education || {};
  const degree = (primary.degree || "").trim();
  const major = (primary.major || "").trim();
  const school = (primary.school || "").trim();
  // Format priority: "Bachelor's in marketing @ University of Florida".
  const head = degree && major
    ? `${degree} in ${major}`
    : major || degree || "";
  if (head && school) return `${head} @ ${school}`;
  return head || school || "";
}

export function renderEducationEntriesList(education) {
  // Build a structured display of every entry in the educations array. If
  // the array is empty/missing, return a single-line fallback from legacy
  // flat fields.
  const entries = Array.isArray(education?.educations) && education.educations.length
    ? education.educations
    : (education?.major || education?.school
      ? [{ degree: null, major: education.major, minor: education.minor, school: education.school }]
      : []);
  if (!entries.length) return "";
  return entries
    .map((e) => {
      const parts = [];
      if (e.degree) parts.push(escapeHtml(e.degree));
      if (e.major) parts.push(escapeHtml(`in ${e.major}`));
      if (e.minor) parts.push(escapeHtml(`(minor: ${e.minor})`));
      const head = parts.join(" ");
      const school = e.school ? escapeHtml(e.school) : "";
      if (head && school) return `<p class="pf-bv__detail">${head} · ${school}</p>`;
      return `<p class="pf-bv__detail">${head || school}</p>`;
    })
    .join("");
}

export function renderConsultantBioHtml({ profile, education, rating }) {
  const edu = education || {};

  const avatarHtml = profile.avatar_url
    ? `<img class="pf-bv__avatar" src="${escapeAttr(profile.avatar_url)}" alt="" />`
    : `<div class="pf-bv__avatar-placeholder" aria-hidden="true">${escapeHtml(getInitials(profile.full_name))}</div>`;

  const dims = [
    ["Work product", rating?.work_product_quality_avg],
    ["Communication", rating?.communication_avg],
    ["Timeliness", rating?.timeliness_avg],
    ["Professionalism", rating?.professionalism_avg],
    ["Cost value", rating?.cost_value_avg],
  ];
  const ratingBreakdown = rating?.review_count
    ? `
      <div class="pf-bv__section">
        <p class="pf-bv__section-title">Ratings · ${rating.review_count} review${rating.review_count === 1 ? "" : "s"}</p>
        <div class="ld-cv__rating-grid">
          ${dims.map(([label, val]) => `
            <div class="ld-cv__rating-row">
              <span class="ld-cv__rating-row__label">${label}</span>
              ${renderRatingMarkup({ rating_average: val, review_count: 1 }, { size: "sm", showCount: false })}
            </div>
          `).join("")}
        </div>
      </div>
    `
    : "";

  // Header: name, primary degree line, then a compact meta row (location,
  // tenure, LinkedIn as a short link). Education detail sits directly under
  // the header; ratings close out the panel.
  const headerLine = formatConsultantEducationLine(edu);
  const eduEntriesHtml = renderEducationEntriesList(edu);
  const metaBits = [];
  if (profile.city) metaBits.push(`<span>${escapeHtml(profile.city)}</span>`);
  if (profile.completed_count) {
    metaBits.push(`<span>${profile.completed_count} completed project${profile.completed_count === 1 ? "" : "s"}</span>`);
  }
  if (profile.member_since) {
    const since = new Date(profile.member_since).toLocaleDateString("en-US", { month: "short", year: "numeric" });
    metaBits.push(`<span>Joined ${escapeHtml(since)}</span>`);
  }
  if (profile.linkedin_url) {
    metaBits.push(`<a class="pf-bv__link" href="${escapeAttr(profile.linkedin_url)}" target="_blank" rel="noopener noreferrer">LinkedIn ↗</a>`);
  }
  const metaRow = metaBits.length
    ? `<p class="pf-bv__meta-row">${metaBits.join('<span class="pf-bv__dot" aria-hidden="true">·</span>')}</p>`
    : "";

  return `
    <div class="pf-bv">
      <div class="pf-bv__header">
        ${avatarHtml}
        <div>
          <h2 class="pf-bv__name">${escapeHtml(profile.full_name)}</h2>
          ${headerLine ? `<p class="pf-bv__meta">${escapeHtml(headerLine)}</p>` : ""}
          ${metaRow}
        </div>
      </div>
      ${eduEntriesHtml ? `
        <div class="pf-bv__section">
          <p class="pf-bv__section-title">Education</p>
          ${eduEntriesHtml}
        </div>
      ` : ""}
      ${ratingBreakdown}
      ${(!profile.linkedin_url && !eduEntriesHtml && !ratingBreakdown) ? `
        <p class="pf-bv__empty">This consultant hasn't shared any public bio details yet.</p>
      ` : ""}
    </div>
  `;
}

function truncateScope(text, max = 180) {
  const trimmed = String(text || "").trim();
  if (trimmed.length <= max) return trimmed;
  return trimmed.slice(0, max - 1).trimEnd() + "…";
}

export async function loadConsultantEngagements(client, consultantId) {
  if (!client || !consultantId) return [];
  const { data, error } = await client
    .from("bids")
    .select("id, amount_cents, accepted_at, listings!inner(id, title, problem_summary, status)")
    .eq("consultant_id", consultantId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(20);
  if (error) return [];
  return data || [];
}

export function renderConsultantPastWorkHtml(engagements, portfolio) {
  const sections = [];
  if (engagements?.length) {
    sections.push(`
      <div class="ld-cv__work-section">
        <p class="ld-cv__work-section-title">Past engagements</p>
        <div class="ld-cv__work-list">
          ${engagements.map((eng) => {
            const title = eng.listings?.title || "engagement";
            const scope = eng.listings?.problem_summary || "";
            const amount = eng.amount_cents != null ? formatUsd(eng.amount_cents) : "";
            return `
              <div class="ld-cv__work-row">
                <div>
                  <p class="ld-cv__work-row__title">${escapeHtml(title)}</p>
                  ${scope ? `<p class="ld-cv__work-row__scope">${escapeHtml(truncateScope(scope))}</p>` : ""}
                </div>
                ${amount ? `<span class="ld-cv__work-row__amount">${escapeHtml(amount)}</span>` : ""}
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `);
  }

  if (portfolio?.length) {
    sections.push(`
      <div class="ld-cv__work-section">
        <p class="ld-cv__work-section-title">Shared files</p>
        <div class="ld-cv__work-list">
          ${portfolio.map((item) => {
            const fileName = (item.file_path || "").split("/").pop() || "file";
            const url = item.url || "#";
            return `
              <div class="ld-cv__work-row">
                <div>
                  <p class="ld-cv__work-row__title">${escapeHtml(fileName)}</p>
                  ${item.description ? `<p class="ld-cv__work-row__scope">${escapeHtml(item.description)}</p>` : ""}
                  <a class="ld-cv__work-row__file" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Open file ↗</a>
                </div>
              </div>
            `;
          }).join("")}
        </div>
      </div>
    `);
  }

  return sections.length
    ? sections.join("")
    : `<p class="ld-cv__panel-empty">No past engagements or shared files yet.</p>`;
}

export const RESUME_HIDDEN_HTML = `<p class="ld-cv__panel-empty">This consultant has not made a resume publicly visible.</p>`;

export function renderResumeEmbedHtml(url, fileName) {
  return `
    <div class="ld-cv__resume-actions">
      <a class="gr-btn gr-btn--ghost gr-btn--sm" href="${escapeAttr(url)}" target="_blank" rel="noopener noreferrer">Open in new tab ↗</a>
    </div>
    <iframe class="ld-cv__resume-frame" src="${escapeAttr(url)}" title="${escapeAttr(fileName || "resume")}"></iframe>
  `;
}

// Fetches a signed resume URL from the same endpoint the business view
// uses. Throws with the server's message on failure.
export async function fetchResumeUrl(client, consultantId) {
  const { data: { session } } = await client.auth.getSession();
  const headers = {};
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  const res = await fetch(`/api/consultant-profile/${encodeURIComponent(consultantId)}/resume`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.url) throw new Error(body.error || "Could not open resume.");
  return body;
}
