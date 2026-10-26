// Placeholder content: blocks with made-up stats, quotes, or names that wait for real data.
// They're marked `hidden data-placeholder="what real data it needs"` so visitors never see them.
// To review them, open a page on localhost with ?placeholders in the URL
// (e.g. http://localhost:3000/?placeholders). On the live site this script does nothing.
// To ship one for real: replace the made-up content, then delete `hidden` and `data-placeholder`.
(function () {
  var local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if (!local || !/[?&]placeholders(=|&|$)/.test(location.search)) return;

  // Page scripts that build placeholder content (e.g. the home hero cards) check this flag.
  window.GR_SHOW_PLACEHOLDERS = true;

  var style = document.createElement("style");
  style.textContent =
    // margin-top leaves room for the label so it never covers the content above.
    "[data-placeholder].gr-ph{outline:2px dashed #e0a33a;outline-offset:6px;position:relative;margin-top:40px}" +
    "[data-placeholder].gr-ph::before{content:'placeholder \\00b7  ' attr(data-placeholder);position:absolute;top:-30px;left:0;z-index:20;" +
    "font:600 11px/1 system-ui,sans-serif;letter-spacing:.02em;text-transform:none;background:#e0a33a;color:#1a1206;" +
    "padding:5px 8px;border-radius:4px;white-space:nowrap;pointer-events:none}" +
    ".gr-ph-inline{outline:1px dashed #e0a33a;outline-offset:2px}";
  document.head.appendChild(style);

  function reveal() {
    document.querySelectorAll("[data-placeholder]").forEach(function (el) {
      el.hidden = false;
      el.classList.add("gr-ph");
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", reveal);
  else reveal();
})();
