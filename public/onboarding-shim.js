// onboarding-shim.js — lazy-load gate for the new-user tutorial.
//
// The real tutorial (onboarding.js + onboarding.css) is ~110KB of code
// that only matters when one of these is true:
//   • URL has ?tutorial=1 or ?welcome=1 (replay / first-run)
//   • localStorage has an active tutorial state (mid-flow resume)
//   • someone calls window.grassrootsOnboarding.replay() (settings page)
//
// On every other page load — the 99% case — we don't need it at all.
// This shim is a few-hundred bytes that checks those conditions and
// only then injects the real bundle. It also stubs the public surface
// so existing callers (settings replay button) still work; the stubbed
// methods load the real module on first call.
//
// Once the real onboarding.js loads it overwrites window.grassrootsOnboarding,
// so subsequent calls go straight to the real impl.

(function () {
  const STORAGE_KEY = "grassroots_onboarding";

  function hasActiveState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const parsed = JSON.parse(raw);
      return !!(parsed && parsed.active);
    } catch (_) {
      return false;
    }
  }

  function wantsBoot() {
    const params = new URLSearchParams(window.location.search);
    if (params.get("tutorial") === "1") return true;
    if (params.get("welcome") === "1") return true;
    return hasActiveState();
  }

  let loadPromise = null;
  function loadOnboarding() {
    if (loadPromise) return loadPromise;
    // Inject stylesheet first so any class additions from the JS find
    // their rules already parsed.
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/onboarding.css";
    document.head.appendChild(link);
    loadPromise = import("/onboarding.js");
    return loadPromise;
  }

  // Shim the public surface so settings.html's replay button still works.
  // Real onboarding.js will overwrite window.grassrootsOnboarding on load.
  const methods = ["start", "replay", "resume", "skip", "complete", "goToIndex"];
  const stub = {};
  for (const m of methods) {
    stub[m] = async function (...args) {
      await loadOnboarding();
      // After load, window.grassrootsOnboarding is the real one.
      const real = window.grassrootsOnboarding;
      if (real && typeof real[m] === "function" && real[m] !== stub[m]) {
        return real[m].apply(real, args);
      }
    };
  }
  window.grassrootsOnboarding = stub;

  if (wantsBoot()) {
    // Defer the actual import until after the page finishes parsing so
    // it never delays first paint. The tutorial mounts after
    // DOMContentLoaded regardless (see onboarding.js).
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", loadOnboarding, { once: true });
    } else {
      loadOnboarding();
    }
  }
})();
