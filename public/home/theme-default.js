// theme-default.js — marketing pages (home, about, for students) open in the
// forest green theme instead of charcoal when the visitor's system is in dark
// mode. A theme the visitor picked themselves still wins.
// Load synchronously right after /theme.js so it applies before first paint.
(function () {
  var t = window.GrassrootsTheme;
  if (t && !localStorage.getItem(t.KEY) && t.get() === "dark") {
    document.documentElement.setAttribute("data-theme", "dark-forest");
  }
})();
