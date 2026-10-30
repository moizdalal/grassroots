// Small dismissible note telling phone visitors the full product works
// best on a computer. Signup still works on a phone, so this informs and
// never blocks. Renders into the first [data-desktop-hint] mount on the
// page, only on touch screens up to 720px wide, until dismissed once
// (remembered in localStorage across every page that has a mount).
(function () {
  var STORAGE_KEY = "grassroots_desktop_hint_dismissed";

  function safeRead() {
    try {
      return window.localStorage.getItem(STORAGE_KEY);
    } catch (_e) {
      return null;
    }
  }
  function safeWrite(value) {
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (_e) {}
  }

  if (safeRead() === "1") return;
  if (!window.matchMedia("(max-width: 720px) and (pointer: coarse)").matches) return;

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    var mount = document.querySelector("[data-desktop-hint]");
    if (!mount || mount.querySelector(".gr-desktop-hint")) return;

    var hint = document.createElement("div");
    hint.className = "gr-desktop-hint";
    hint.setAttribute("role", "note");
    hint.innerHTML =
      '<svg class="gr-desktop-hint__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
        '<rect x="4" y="5" width="16" height="11" rx="1.5"/><path d="M2 19h20"/>' +
      "</svg>" +
      '<p class="gr-desktop-hint__msg">Grassroots works best on a computer. You can still sign up from your phone.</p>' +
      '<button class="gr-desktop-hint__dismiss" type="button" aria-label="Dismiss">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
      "</button>";

    mount.appendChild(hint);
    hint.querySelector(".gr-desktop-hint__dismiss").addEventListener("click", function () {
      safeWrite("1");
      hint.remove();
    });
  });
})();
