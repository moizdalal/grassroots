// nav.js — wires the shared .ld-nav across all marketing pages.
// Handles:
//   • theme button (sun ↔ moon) that cycles through all four themes,
//     backed by window.GrassrootsTheme
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

  // Theme button — each click moves to the next of the four themes.
  const THEMES = [
    { id: "dark-forest", label: "forest" },
    { id: "forest-soft", label: "soft" },
    { id: "dark", label: "dark" },
    { id: "light", label: "light" },
  ];

  if (navTheme && window.GrassrootsTheme) {
    const indexOf = (id) => Math.max(0, THEMES.findIndex((t) => t.id === id));
    const label = () => {
      const cur = THEMES[indexOf(window.GrassrootsTheme.get())];
      const next = THEMES[(indexOf(cur.id) + 1) % THEMES.length];
      const text = "theme: " + cur.label + " (click for " + next.label + ")";
      navTheme.setAttribute("aria-label", text);
      navTheme.setAttribute("title", text);
    };
    navTheme.addEventListener("click", () => {
      const next = THEMES[(indexOf(window.GrassrootsTheme.get()) + 1) % THEMES.length];
      window.GrassrootsTheme.set(next.id);
    });
    window.addEventListener("grassroots:themechange", label);
    label();
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
