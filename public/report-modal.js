// report-modal.js
// "Report" link + dialog for profiles, listings and messages. Posts to
// /api/reports; the server works out whose it is and drops duplicates.
// Reports show up in the admin Reports tab (admin/reports.js).
//
// API:
//   reportLinkHtml({ type, id, label })  → small text button markup
//   wireReportLinks(root)                → opens the dialog on click
//   openReportDialog({ type, id, label }) → Promise<boolean> (sent?)
//
// `type` is "profile" | "listing" | "message". `label` names the thing
// in the dialog title ("Report this listing").

import { getSupabaseClient } from "/supabase-loader.js";

const MODAL_ID = "gr-report-modal";

export const REPORT_REASONS = [
  ["scam", "Scam or fraud"],
  ["off_platform", "Asked to pay outside Grassroots"],
  ["harassment", "Harassment or threats"],
  ["inappropriate", "Inappropriate content"],
  ["fake", "Fake profile or listing"],
  ["other", "Something else"],
];

const NOUN = { profile: "profile", listing: "listing", message: "message" };

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const FLAG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/></svg>';

export function reportLinkHtml({ type, id, label } = {}) {
  if (!type || !id) return "";
  const text = label || `Report ${NOUN[type] || ""}`.trim();
  return `<button type="button" class="gr-report-link" data-report-type="${escapeHtml(type)}" data-report-id="${escapeHtml(id)}">${FLAG}<span>${escapeHtml(text)}</span></button>`;
}

export function wireReportLinks(root = document) {
  if (!root || root.__grReportWired) return;
  root.__grReportWired = true;
  root.addEventListener("click", (e) => {
    const btn = e.target.closest?.("[data-report-type]");
    if (!btn) return;
    e.preventDefault();
    openReportDialog({ type: btn.dataset.reportType, id: btn.dataset.reportId });
  });
}

async function sendReport(payload) {
  const client = await getSupabaseClient();
  const { data: { session } } = await client.auth.getSession();
  if (!session?.access_token) throw new Error("Sign in to report something.");
  const res = await fetch("/api/reports", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "We couldn't send that. Try again.");
  return data;
}

export function openReportDialog({ type, id, send = sendReport } = {}) {
  return new Promise((resolve) => {
    document.getElementById(MODAL_ID)?.remove();
    const previousFocus = document.activeElement;
    const noun = NOUN[type] || "this";

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "gr-confirm-modal gr-report-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", `${MODAL_ID}-title`);
    modal.innerHTML = `
      <div class="gr-confirm-modal__backdrop" data-report-action="cancel"></div>
      <form class="gr-confirm-modal__card gr-report-modal__card" novalidate>
        <h2 id="${MODAL_ID}-title" class="gr-confirm-modal__title">Report this ${escapeHtml(noun)}</h2>
        <p class="gr-confirm-modal__body">Only the Grassroots team sees reports. We won't tell them it was you.</p>
        <fieldset class="gr-report-modal__reasons">
          <legend class="gr-sr-only">Reason</legend>
          ${REPORT_REASONS.map(([value, label]) => `
            <label class="gr-report-modal__reason">
              <input type="radio" name="reason" value="${value}" />
              <span>${escapeHtml(label)}</span>
            </label>
          `).join("")}
        </fieldset>
        <label class="gr-label gr-report-modal__details">
          <span>What happened <span class="gr-optional">Optional</span></span>
          <textarea name="details" rows="3" maxlength="1000" placeholder="A sentence or two helps us act faster."></textarea>
        </label>
        <p class="gr-report-modal__error" role="alert" hidden></p>
        <div class="gr-confirm-modal__actions">
          <button type="button" class="gr-btn gr-btn--ghost" data-report-action="cancel">Cancel</button>
          <button type="submit" class="gr-btn gr-btn--primary">Send report</button>
        </div>
      </form>
    `;
    document.body.appendChild(modal);
    document.body.classList.add("gr-confirm-modal-open");

    const form = modal.querySelector("form");
    const errorEl = modal.querySelector(".gr-report-modal__error");
    const submitBtn = form.querySelector('button[type="submit"]');
    const detailsLabel = form.querySelector(".gr-report-modal__details > span");
    const showError = (msg) => {
      errorEl.textContent = msg;
      errorEl.hidden = !msg;
    };

    function cleanup(sent) {
      document.removeEventListener("keydown", onKey);
      modal.remove();
      document.body.classList.remove("gr-confirm-modal-open");
      try { previousFocus?.focus?.(); } catch (_) {}
      resolve(Boolean(sent));
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); cleanup(false); }
    }

    function showSent(duplicate) {
      form.innerHTML = `
        <h2 id="${MODAL_ID}-title" class="gr-confirm-modal__title">${duplicate ? "You already reported this" : "Thanks for telling us"}</h2>
        <p class="gr-confirm-modal__body">${duplicate
          ? "It's still in our queue. We'll look at it soon."
          : "We'll look at it within two business days. If someone's in danger, call 911."}</p>
        <div class="gr-confirm-modal__actions">
          <button type="button" class="gr-btn gr-btn--primary" data-report-action="done">Done</button>
        </div>
      `;
      form.querySelector("[data-report-action='done']").focus();
    }

    // "Something else" needs a sentence; the others don't.
    form.addEventListener("change", () => {
      const other = form.reason.value === "other";
      detailsLabel.innerHTML = other ? "What happened" : 'What happened <span class="gr-optional">Optional</span>';
      showError("");
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const reason = form.reason.value;
      const details = form.details.value.trim();
      if (!reason) return showError("Pick a reason.");
      if (reason === "other" && !details) {
        form.details.focus();
        return showError("Tell us what happened.");
      }
      showError("");
      submitBtn.classList.add("is-loading");
      submitBtn.disabled = true;
      try {
        const result = await send({ targetType: type, targetId: id, reason, details });
        showSent(Boolean(result?.duplicate));
      } catch (err) {
        showError(err.message);
        submitBtn.classList.remove("is-loading");
        submitBtn.disabled = false;
      }
    });

    modal.addEventListener("click", (e) => {
      const action = e.target.closest("[data-report-action]")?.dataset.reportAction;
      if (action === "cancel") cleanup(false);
      if (action === "done") cleanup(true);
    });
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(() => {
      try { form.querySelector('input[name="reason"]').focus(); } catch (_) {}
    });
  });
}
