// theme-default.js — marketing pages (home, about, for students) only show
// two themes: light and dark (charcoal). The web app keeps all four.
//
// A saved app theme still decides which side the visitor lands on: "light"
// stays light, and any dark variant (forest, soft, dark) shows as dark here.
// Visiting a marketing page never rewrites the saved app theme.
//
// Load synchronously right after /theme.js so it applies before first paint,
// and before nav.js / landing.js so their listeners see the mapped theme.
(function () {
  var t = window.GrassrootsTheme;
  if (!t) return;
  var root = document.documentElement;

  function toLanding(theme) {
    return theme === "light" ? "light" : "dark";
  }

  function apply() {
    var cur = root.getAttribute("data-theme");
    var next = toLanding(cur);
    if (cur !== next) root.setAttribute("data-theme", next);
  }

  apply();
  // theme.js follows OS changes by setting dark-forest; remap it here.
  window.addEventListener("grassroots:themechange", apply);

  var get = t.get;
  t.get = function () {
    return toLanding(get());
  };
  t.LANDING_THEMES = ["light", "dark"];
})();
