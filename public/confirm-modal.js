// confirm-modal.js
// Small body-level confirmation dialog. Resolves a Promise with the
// user's choice. Used by:
//   • dashboard.js  — draft delete
//   • create-listing.js — publish-to-marketplace confirm
//
// API:
//   confirmDialog({ title, body, confirmLabel, cancelLabel, kind })
//     → Promise<boolean>
//
// `kind` controls the confirm button variant:
//   "danger"  — destructive (red); used for delete flows
//   "primary" — default green; used for normal "yes proceed" flows
//
// One dialog at a time. Calling while another is open closes the
// previous instance first; subsequent calls aren't queued.

const MODAL_ID = "gr-confirm-modal";

export function confirmDialog({
  title,
  body,
  confirmLabel = "confirm",
  cancelLabel = "cancel",
  kind = "primary",
} = {}) {
  return new Promise((resolve) => {
    // Tear down any leftover instance — don't stack modals.
    const existing = document.getElementById(MODAL_ID);
    if (existing) existing.remove();

    const previousFocus = document.activeElement;
    const confirmCls = kind === "danger" ? "gr-btn--danger" : "gr-btn--primary";

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.className = "gr-confirm-modal";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-labelledby", `${MODAL_ID}-title`);
    modal.innerHTML = `
      <div class="gr-confirm-modal__backdrop" data-confirm-action="cancel"></div>
      <div class="gr-confirm-modal__card" role="document">
        <h2 id="${MODAL_ID}-title" class="gr-confirm-modal__title">${escapeHtml(title || "")}</h2>
        <p class="gr-confirm-modal__body">${escapeHtml(body || "")}</p>
        <div class="gr-confirm-modal__actions">
          <button type="button" class="gr-btn gr-btn--ghost" data-confirm-action="cancel">${escapeHtml(cancelLabel)}</button>
          <button type="button" class="gr-btn ${confirmCls}" data-confirm-action="confirm">${escapeHtml(confirmLabel)}</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
    document.body.classList.add("gr-confirm-modal-open");

    const confirmBtn = modal.querySelector('[data-confirm-action="confirm"]');

    function cleanup(result) {
      document.removeEventListener("keydown", onKey);
      modal.remove();
      document.body.classList.remove("gr-confirm-modal-open");
      if (previousFocus && typeof previousFocus.focus === "function") {
        try { previousFocus.focus(); } catch (_) {}
      }
      resolve(Boolean(result));
    }

    function onKey(e) {
      if (e.key === "Escape") { e.preventDefault(); cleanup(false); }
      if (e.key === "Enter") {
        // Enter confirms — but only if the focus is on the confirm
        // button (so Enter on the cancel button still cancels).
        if (document.activeElement === confirmBtn) {
          e.preventDefault();
          cleanup(true);
        }
      }
    }

    modal.addEventListener("click", (e) => {
      const action = e.target.closest("[data-confirm-action]")?.dataset.confirmAction;
      if (!action) return;
      cleanup(action === "confirm");
    });

    document.addEventListener("keydown", onKey);

    requestAnimationFrame(() => {
      try { confirmBtn.focus(); } catch (_) {}
    });
  });
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
