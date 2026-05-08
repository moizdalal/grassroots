// theme.js — applies the user's saved theme as early as possible.
// Loaded synchronously in the <head> of every page so the theme is applied
// before the first paint (no flash of the wrong theme).
//
// Themes are CSS variable sets defined in field-office.css under
// `[data-theme="..."]` selectors on <html>.

(function () {
  var KEY = "grassroots_theme";
  var THEMES = ["dark-forest", "forest-soft", "dark", "light"];

  function systemDefault() {
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches) {
        return "dark";
      }
    } catch (e) {}
    return "light";
  }

  function readSaved() {
    try {
      var t = localStorage.getItem(KEY);
      return t && THEMES.indexOf(t) !== -1 ? t : null;
    } catch (e) {
      return null;
    }
  }

  // Apply: explicit user choice wins; otherwise fall back to system.
  var saved = readSaved();
  var theme = saved || systemDefault();
  document.documentElement.setAttribute("data-theme", theme);

  // If the user hasn't picked a theme, follow OS-level changes live.
  try {
    var mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
    if (mq) {
      var handleChange = function () {
        if (readSaved()) return; // user has chosen — don't override.
        var next = systemDefault();
        document.documentElement.setAttribute("data-theme", next);
        window.dispatchEvent(new CustomEvent("grassroots:themechange", { detail: next }));
      };
      if (mq.addEventListener) mq.addEventListener("change", handleChange);
      else if (mq.addListener) mq.addListener(handleChange);
    }
  } catch (e) {}

  // Expose helpers for the settings page.
  window.GrassrootsTheme = {
    THEMES: THEMES,
    KEY: KEY,
    systemDefault: systemDefault,
    get: function () {
      return readSaved() || systemDefault();
    },
    set: function (next) {
      if (THEMES.indexOf(next) === -1) return;
      try {
        localStorage.setItem(KEY, next);
      } catch (e) {}
      document.documentElement.setAttribute("data-theme", next);
      window.dispatchEvent(new CustomEvent("grassroots:themechange", { detail: next }));
    },
  };
  // Backwards-compat: keep DEFAULT as the resolved system fallback.
  window.GrassrootsTheme.DEFAULT = systemDefault();
})();
