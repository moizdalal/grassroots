// nav.js — wires the shared .ld-nav across all marketing pages.
// Handles:
//   • theme-toggle button (sun ↔ moon) backed by window.GrassrootsTheme
//   • .is-scrolled class on the nav once the page scrolls past 8px
//   • scroll-progress hairline that fills as the page is read
//
// Loaded on landing, about, and for-students. Safe to include even
// if the page doesn't have every element — each lookup is guarded.

(function () {
  "use strict";

  const nav = document.getElementById("ld-nav");
  const navProgress = document.getElementById("ld-nav-progress");
  const navTheme = document.getElementById("ld-nav-theme");

  // Theme toggle — flips between light and dark-forest. The four-button
  // theme strip on the landing footer still handles the other themes
  // (forest-soft, dark); this button is just the convenience toggle.
  if (navTheme && window.GrassrootsTheme) {
    navTheme.addEventListener("click", () => {
      const cur = window.GrassrootsTheme.get();
      window.GrassrootsTheme.set(cur === "light" ? "dark-forest" : "light");
    });
  }

  function update() {
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 8);
    if (navProgress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      navProgress.style.width = (p * 100).toFixed(2) + "%";
    }
  }

  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
})();
