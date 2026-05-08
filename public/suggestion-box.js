(function initSuggestionBox() {
  const btn = document.getElementById("gr-suggest-btn");
  const overlay = document.getElementById("gr-suggest-overlay");
  const submit = document.getElementById("gr-suggest-submit");
  const input = document.getElementById("gr-suggest-input");
  const form = document.getElementById("gr-suggest-form");
  const thanks = document.getElementById("gr-suggest-thanks");
  const closeBtn = document.getElementById("gr-suggest-close");

  if (!btn || !overlay || !submit || !input || !form || !thanks) return;

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

  submit.addEventListener("click", () => {
    if (!input.value.trim()) return;

    form.hidden = true;
    thanks.hidden = false;

    window.setTimeout(() => {
      close({ restoreFocus: false });
      window.setTimeout(() => {
        form.hidden = false;
        thanks.hidden = true;
        input.value = "";
        syncSubmitState();
      }, 350);
    }, 1800);
  });

  syncSubmitState();
})();
