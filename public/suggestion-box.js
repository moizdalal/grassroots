// suggestion-box.js — floating "send us feedback" button + popup.
// Persists submissions to public.suggestions and uploads attached files
// to the suggestion-attachments storage bucket.
//
// The button + overlay markup is injected on first run (used to live
// inline in ~10 page templates). The marketing home page ships its
// own self-contained copy so we leave its DOM alone — `getElementById`
// finding an existing `gr-suggest-btn` is the skip signal.
//
// Limits — kept generous but bounded so storage doesn't run wild:
//   - up to 5 files per submission
//   - up to 10 MB per file (also enforced by the bucket)
//   - up to 25 MB total per submission
//   - any mime type (screenshots, short videos, pdfs, logs)

function ensureSuggestionBoxMarkup() {
  if (document.getElementById("gr-suggest-btn")) return;
  const tpl = document.createElement("template");
  tpl.innerHTML = `
    <button class="gr-suggest-btn" id="gr-suggest-btn" type="button" aria-label="suggestion box">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/><line x1="9" y1="9" x2="15" y2="9"/><line x1="9" y1="13" x2="13" y2="13"/></svg>
    </button>
    <div class="gr-suggest-overlay" id="gr-suggest-overlay">
      <div class="gr-suggest-popup">
        <button class="gr-suggest-popup__close" id="gr-suggest-close" type="button" aria-label="close">
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="6" x2="18" y2="18"/><line x1="6" y1="18" x2="18" y2="6"/></svg>
        </button>
        <div id="gr-suggest-form">
          <p class="gr-suggest-popup__title">grassroots values and takes your feedback seriously&mdash;how can we improve?</p>
          <textarea class="gr-suggest-popup__textarea" id="gr-suggest-input" placeholder="your suggestion…" maxlength="1000"></textarea>
          <button class="gr-suggest-popup__submit" id="gr-suggest-submit" type="button">submit</button>
        </div>
        <div id="gr-suggest-thanks" hidden>
          <p class="gr-suggest-popup__thanks">thanks for the note. we read all of these.</p>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(tpl.content);
}

function initSuggestionBox() {
  ensureSuggestionBoxMarkup();
  const btn = document.getElementById("gr-suggest-btn");
  const overlay = document.getElementById("gr-suggest-overlay");
  const submit = document.getElementById("gr-suggest-submit");
  const input = document.getElementById("gr-suggest-input");
  const form = document.getElementById("gr-suggest-form");
  const thanks = document.getElementById("gr-suggest-thanks");
  const closeBtn = document.getElementById("gr-suggest-close");

  if (!btn || !overlay || !submit || !input || !form || !thanks) return;

  const MAX_FILES = 5;
  const MAX_PER_FILE = 10 * 1024 * 1024; // 10 MB
  const MAX_TOTAL = 25 * 1024 * 1024;    // 25 MB
  const selectedFiles = [];

  // Inject the attachments UI just above the submit button so the
  // popup picks them up without each page's HTML being touched.
  const fileWrap = document.createElement("div");
  fileWrap.className = "gr-suggest-popup__attachments";
  fileWrap.innerHTML = `
    <label class="gr-suggest-popup__attach-btn" tabindex="0">
      <span class="gr-suggest-popup__attach-icon" aria-hidden="true">+</span>
      <span>attach files</span>
      <input type="file" id="gr-suggest-files" multiple hidden />
    </label>
    <span class="gr-suggest-popup__attach-hint" id="gr-suggest-attach-hint">up to ${MAX_FILES} files · 10 MB each · 25 MB total</span>
    <ul class="gr-suggest-popup__attach-list" id="gr-suggest-attach-list"></ul>
    <p class="gr-suggest-popup__attach-error" id="gr-suggest-attach-error" hidden></p>
  `;
  form.insertBefore(fileWrap, submit);

  const fileInput = document.getElementById("gr-suggest-files");
  const fileList = document.getElementById("gr-suggest-attach-list");
  const errEl = document.getElementById("gr-suggest-attach-error");

  function fmtSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function showError(msg) {
    if (!msg) {
      errEl.hidden = true;
      errEl.textContent = "";
      return;
    }
    errEl.hidden = false;
    errEl.textContent = msg;
  }

  function renderFiles() {
    fileList.innerHTML = selectedFiles
      .map(
        (f, i) =>
          `<li class="gr-suggest-popup__attach-item">
            <span class="gr-suggest-popup__attach-name">${escapeHtml(f.name)}</span>
            <span class="gr-suggest-popup__attach-size">${fmtSize(f.size)}</span>
            <button type="button" class="gr-suggest-popup__attach-remove" data-i="${i}" aria-label="remove ${escapeHtml(f.name)}">&times;</button>
          </li>`
      )
      .join("");
  }

  fileWrap.addEventListener("click", (e) => {
    const rm = e.target.closest(".gr-suggest-popup__attach-remove");
    if (!rm) return;
    e.preventDefault();
    const i = parseInt(rm.dataset.i, 10);
    selectedFiles.splice(i, 1);
    renderFiles();
    syncSubmitState();
    showError("");
  });

  fileInput.addEventListener("change", () => {
    showError("");
    const incoming = [...fileInput.files];
    fileInput.value = ""; // reset so re-selecting the same file fires change
    for (const f of incoming) {
      if (selectedFiles.length >= MAX_FILES) {
        showError(`max ${MAX_FILES} files per submission.`);
        break;
      }
      if (f.size > MAX_PER_FILE) {
        showError(`"${f.name}" is over the 10 MB per-file limit.`);
        continue;
      }
      const total = selectedFiles.reduce((a, x) => a + x.size, 0) + f.size;
      if (total > MAX_TOTAL) {
        showError("that batch is over the 25 MB total limit.");
        break;
      }
      selectedFiles.push(f);
    }
    renderFiles();
    syncSubmitState();
  });

  function syncSubmitState() {
    submit.disabled = !input.value.trim();
  }

  function open() {
    overlay.classList.add("is-open");
    document.body.classList.add("gr-modal-open");
    syncSubmitState();
    window.requestAnimationFrame(() => input.focus());
  }

  function close({ restoreFocus = true } = {}) {
    overlay.classList.remove("is-open");
    document.body.classList.remove("gr-modal-open");
    if (restoreFocus) btn.focus();
  }

  btn.addEventListener("click", open);

  overlay.addEventListener("click", (event) => {
    if (event.target === overlay) close();
  });

  if (closeBtn) closeBtn.addEventListener("click", () => close());

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay.classList.contains("is-open")) {
      close();
    }
  });

  input.addEventListener("input", syncSubmitState);

  submit.addEventListener("click", async () => {
    const body = input.value.trim();
    if (!body) return;

    submit.disabled = true;
    const originalLabel = submit.textContent;
    submit.textContent = "sending…";
    showError("");

    try {
      const { getSupabaseClient } = await import("/supabase-loader.js");
      const client = await getSupabaseClient();
      const { data: { session } } = await client.auth.getSession();
      const userId = session?.user?.id || null;

      // Upload attachments first so the suggestion row can reference
      // the storage paths in its `attachments` column. Files are
      // namespaced under <userId or "anon">/<timestamp>/<filename>
      // so different users don't collide and a single submission's
      // files stay grouped on disk.
      const storedPaths = [];
      if (selectedFiles.length) {
        const prefix = `${userId || "anon"}/${Date.now()}`;
        for (const f of selectedFiles) {
          const safeName = f.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
          const path = `${prefix}/${safeName}`;
          const { error: upErr } = await client.storage
            .from("suggestion-attachments")
            .upload(path, f, { upsert: false, contentType: f.type || undefined });
          if (upErr) throw new Error(`upload failed: ${upErr.message}`);
          storedPaths.push(path);
        }
      }

      const { error } = await client.from("suggestions").insert({
        user_id: userId,
        body,
        attachments: storedPaths,
        page_url: window.location.pathname + window.location.search,
        user_agent: navigator.userAgent.slice(0, 500),
      });
      if (error) throw error;

      form.hidden = true;
      thanks.hidden = false;

      window.setTimeout(() => {
        close({ restoreFocus: false });
        window.setTimeout(() => {
          form.hidden = false;
          thanks.hidden = true;
          input.value = "";
          selectedFiles.length = 0;
          renderFiles();
          showError("");
          syncSubmitState();
          submit.textContent = originalLabel;
        }, 350);
      }, 1400);
    } catch (err) {
      showError(err?.message || "couldn't send. try again?");
      submit.disabled = false;
      submit.textContent = originalLabel;
    }
  });

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  syncSubmitState();
}

// Wait for <body> to exist before injecting markup. The script is
// loaded with defer, so by the time it runs the parser has reached the
// closing </body> tag for pages that don't include the markup inline.
// Pages that still ship their own markup hit the early-return in
// ensureSuggestionBoxMarkup() and behave exactly as before.
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initSuggestionBox, { once: true });
} else {
  initSuggestionBox();
}
