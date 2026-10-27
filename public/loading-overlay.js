// Frosted loading overlay with a swaying grassroots sprout.
// Loaded synchronously in <head> so the overlay appears before first paint.
// Auto-removes when the page's "loading…" gate is cleared, or after a safety timeout.
(function () {
  if (document.getElementById("gr-loader-overlay")) return;

  var SVG_NS = "http://www.w3.org/2000/svg";
  var overlay = document.createElement("div");
  overlay.className = "gr-loader-overlay";
  overlay.id = "gr-loader-overlay";
  overlay.setAttribute("aria-hidden", "true");
  // Sprout sway only — each leaf hinges from its base and rocks on its
  // own phase. CSS handles all motion (see .gr-loader-overlay*).
  // overflow:visible keeps rotated leaves from clipping at viewBox edges.
  overlay.innerHTML =
    '<svg class="gr-loader-overlay__svg" xmlns="' + SVG_NS + '" viewBox="0 0 163 275" overflow="visible" aria-hidden="true">' +
      '<g transform="translate(72, 130)">' +
        '<g class="gr-loader-overlay__stem">' +
          '<path d="M19 10.15C19 4.54431 14.7467 0 9.5 0C4.25329 0 0 4.54431 0 10.15C7.91804 91.2467 8.44249 120.691 0 134.85C0 140.456 4.25329 145 9.5 145C14.7467 145 19 140.456 19 134.85C16.2169 71.2734 12.3479 23.288 19 10.15Z"/>' +
        '</g>' +
      '</g>' +
      '<g transform="translate(0, 65)">' +
        '<g class="gr-loader-overlay__leaf gr-loader-overlay__leaf--left">' +
          '<path d="M84 87C21 71.5333 -6.5625 42.5333 1.3125 0C56.4375 3.86667 84 32.8667 84 87Z"/>' +
        '</g>' +
      '</g>' +
      '<g transform="translate(82, 0)">' +
        '<g class="gr-loader-overlay__leaf gr-loader-overlay__leaf--right">' +
          '<path d="M0 147C48.6 116.053 75.6 67.0526 81 0C27 5.1579 0 54.1579 0 147Z"/>' +
        '</g>' +
      '</g>' +
    '</svg>';

  function attach() {
    if (document.body) {
      document.body.appendChild(overlay);
    } else {
      document.documentElement.appendChild(overlay);
    }
  }
  attach();

  function isLoadingText(text) {
    return /loading/i.test((text || "").trim());
  }
  function isGateActive(el) {
    if (!el) return false;
    if (el.hidden) return false;
    if (el.classList && el.classList.contains("hidden")) return false;
    // Error paths swap in an error message (`gr-status error`) but leave
    // data-loading="true"; an error gate is done loading, so drop the
    // overlay instead of covering the message until the safety timeout.
    if (el.classList && el.classList.contains("error")) return false;
    // Preferred: explicit data-loading="true" on the gate element. Falls
    // back to text-match on the literal word "loading" for gates that
    // haven't migrated yet — once every gate carries data-loading, the
    // text-match fallback can be deleted.
    if (el.getAttribute("data-loading") === "true") return true;
    if (el.getAttribute("data-loading") === "false") return false;
    return isLoadingText(el.textContent);
  }

  function findGate() {
    var selectors = [
      "#profile-gate",
      "#dash-gate",
      "#cdash-gate",
      "#cw-gate",
      "#cr-gate",
      "#eg-gate",
      "#listing-gate",
      "#gate",
    ];
    for (var i = 0; i < selectors.length; i++) {
      var el = document.querySelector(selectors[i]);
      if (el) return el;
    }
    return null;
  }

  function hide() {
    if (!overlay.parentNode) return;
    overlay.classList.add("gr-loader-overlay--hidden");
    setTimeout(function () {
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    }, 500);
  }

  function ready(fn) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", fn, { once: true });
    } else {
      fn();
    }
  }

  // Safety net: never block the screen for more than 20s.
  var safety = setTimeout(hide, 20000);

  ready(function () {
    // Re-attach to body now that it definitely exists.
    if (overlay.parentNode !== document.body && document.body) {
      document.body.appendChild(overlay);
    }

    var gate = findGate();
    if (!gate) {
      // No gate on this page — hide on window load.
      var fallback = function () {
        clearTimeout(safety);
        hide();
      };
      if (document.readyState === "complete") {
        setTimeout(fallback, 200);
      } else {
        window.addEventListener("load", function () {
          setTimeout(fallback, 200);
        }, { once: true });
      }
      return;
    }

    // If the gate isn't currently in a "loading" state, dismiss after first paint.
    if (!isGateActive(gate)) {
      requestAnimationFrame(function () {
        clearTimeout(safety);
        hide();
      });
      return;
    }

    var observer = new MutationObserver(function () {
      if (!isGateActive(gate)) {
        observer.disconnect();
        clearTimeout(safety);
        hide();
      }
    });
    observer.observe(gate, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["hidden", "class", "style", "data-loading"],
    });
  });
})();
