let root = null;
let templateUrl = "/w9.pdf";

function mountModal() {
  if (root) return;

  root = document.createElement("div");
  root.id = "pf-w9-modal";
  root.className = "pf-w9-modal hidden";
  root.setAttribute("aria-hidden", "true");
  root.innerHTML = `
    <div class="pf-w9-modal__backdrop" data-w9-close></div>
    <div class="pf-w9-modal__dialog pf-w9-modal__dialog--viewer" role="dialog" aria-modal="true" aria-labelledby="pf-w9-title">
      <header class="pf-w9-modal__bar">
        <div>
          <p class="pf-w9-modal__eyebrow">tax form</p>
          <h2 class="pf-w9-modal__title" id="pf-w9-title">official IRS form W-9</h2>
          <p class="pf-w9-modal__hint">edit the real IRS PDF in this viewer, then use the viewer's own download button to save your changes.</p>
        </div>
        <div class="pf-w9-actions">
          <a
            id="pf-w9-template-link"
            class="gr-btn gr-btn--ghost"
            href="/w9.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >open editable W-9 in new tab</a>
          <button type="button" class="pf-w9-modal__close" data-w9-close aria-label="close">&times;</button>
        </div>
      </header>

      <div class="pf-w9-viewer-note">
        edit the real IRS PDF here. if your browser hides the PDF toolbar in the embed, use "open editable W-9 in new tab" and then use that viewer's save or download button.
      </div>

      <div class="pf-w9-preview pf-w9-preview--standalone">
        <div class="pf-w9-preview__frame-wrap">
          <iframe id="pf-w9-preview-frame" class="pf-w9-preview__frame" title="official IRS W-9"></iframe>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(root);

  root.querySelectorAll("[data-w9-close]").forEach((el) => {
    el.addEventListener("click", (event) => {
      event.preventDefault();
      closeModal();
    });
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && root && !root.classList.contains("hidden")) {
      closeModal();
    }
  });
}

function renderViewer() {
  const frame = root?.querySelector("#pf-w9-preview-frame");
  if (!(frame instanceof HTMLIFrameElement)) return;
  frame.src = templateUrl;
}

export function openW9Modal(options = {}) {
  templateUrl = options.templateUrl || "/w9.pdf";
  mountModal();
  renderViewer();
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");
  document.body.classList.add("gr-modal-open");
}

export function closeModal() {
  if (!root) return;
  root.classList.add("hidden");
  root.setAttribute("aria-hidden", "true");
  const frame = root.querySelector("#pf-w9-preview-frame");
  if (frame instanceof HTMLIFrameElement) frame.src = "about:blank";
  document.body.classList.remove("gr-modal-open");
}
