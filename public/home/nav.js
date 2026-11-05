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

  // Once per frame at most. The page height is measured on load and
  // resize only: reading scrollHeight right after toggling the nav class
  // forced a layout on every scroll event, which made phones lag.
  let maxScroll = 0;
  let queued = false;
  // Read in the scroll event, where layout is clean; reading scrollY in the
  // frame callback after other scripts wrote styles forced a layout.
  let y = window.scrollY;
  function measure() {
    maxScroll = document.documentElement.scrollHeight - window.innerHeight;
  }
  function update() {
    queued = false;
    if (nav) nav.classList.toggle("is-scrolled", y > 8);
    if (navProgress) {
      const p = maxScroll > 0 ? Math.min(1, y / maxScroll) : 0;
      navProgress.style.transform = "scaleX(" + p.toFixed(4) + ")";
    }
  }
  function queue() {
    if (!queued) { queued = true; requestAnimationFrame(update); }
  }

  measure();
  update();
  window.addEventListener("scroll", () => { y = window.scrollY; queue(); }, { passive: true });
  window.addEventListener("resize", () => { measure(); queue(); });
  // Content below the fold (fonts, images, scripted sections) changes the
  // page height after load; re-measure when it does.
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { measure(); queue(); }).observe(document.body);
  }
})();
