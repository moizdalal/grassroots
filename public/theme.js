// theme.js — applies the user's saved theme as early as possible.
// Loaded synchronously in the <head> of every page so the theme is applied
// before the first paint (no flash of the wrong theme).
//
// Themes are CSS variable sets defined in field-office.css under
// `[data-theme="..."]` selectors on <html>.

(function () {
  var KEY = "grassroots_theme";
  var THEMES = ["dark-forest", "forest-soft", "dark", "light"];
  var DEFAULT = "dark-forest";
  var theme = DEFAULT;
  try {
    var saved = localStorage.getItem(KEY);
    if (saved && THEMES.indexOf(saved) !== -1) theme = saved;
  } catch (e) {}
  document.documentElement.setAttribute("data-theme", theme);

  // Expose helpers for the settings page.
  window.GrassrootsTheme = {
    THEMES: THEMES,
    DEFAULT: DEFAULT,
    KEY: KEY,
    get: function () {
      try {
        var t = localStorage.getItem(KEY);
        return t && THEMES.indexOf(t) !== -1 ? t : DEFAULT;
      } catch (e) {
        return DEFAULT;
      }
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
})();
