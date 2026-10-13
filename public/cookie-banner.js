// Light dismissible cookie/storage notice. Renders once per visitor as a
// bottom pill until they dismiss it; the dismissal is remembered in
// localStorage. No opt-in/out controls — we don't load analytics or
// advertising cookies, so a one-time disclosure is what we owe users.
//
// Loaded defer on every page that imports theme.js. Renders nothing on
// /region-unavailable.html (where the user can't act on the notice anyway)
// or if localStorage isn't available.
(function () {
  var STORAGE_KEY = "grassroots_cookies_acknowledged";

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

  // Skip on the region-unavailable page — it's a static no-account block
  // page and the cookie notice would be noise.
  if (/region-unavailable/.test(window.location.pathname)) return;

  // Already dismissed.
  if (safeRead() === "1") return;

  // Don't render twice if the script gets loaded more than once.
  if (document.getElementById("gr-cookie-banner")) return;

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  ready(function () {
    var banner = document.createElement("div");
    banner.className = "gr-cookie-banner";
    banner.id = "gr-cookie-banner";
    banner.setAttribute("role", "region");
    banner.setAttribute("aria-label", "cookie notice");

    banner.innerHTML =
      '<p class="gr-cookie-banner__msg">' +
        "we use cookies to keep you signed in and to process payments. " +
        '<a class="gr-cookie-banner__link" href="/privacy#cookies">learn more</a>' +
      "</p>" +
      '<button class="gr-cookie-banner__dismiss" type="button" aria-label="dismiss cookie notice">' +
        "got it" +
      "</button>";

    document.body.appendChild(banner);

    // Slide-in on next frame so the CSS transition runs.
    requestAnimationFrame(function () {
      banner.classList.add("is-visible");
    });

    var dismissBtn = banner.querySelector(".gr-cookie-banner__dismiss");
    dismissBtn.addEventListener("click", function () {
      safeWrite("1");
      banner.classList.remove("is-visible");
      banner.classList.add("is-leaving");
      setTimeout(function () {
        if (banner.parentNode) banner.parentNode.removeChild(banner);
      }, 280);
    });
  });
})();
