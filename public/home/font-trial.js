// SENTENCE-CASE PREVIEW FOR REVIEW — not the final implementation.
// Fonts now live in the stylesheets (--font-display / --font-body in
// grassroots.css); this file only capitalizes the lowercase copy at runtime
// so the home page reads in sentence case. Delete it once the copy itself
// is rewritten in sentence case.
(function () {
  var LOGO = ".ld-nav__brand-text, .ld-nav__brand-text *, .ld-foot__brand, .ld-foot__brand *";

  // ---- Sentence-case trial: capitalize where grammar needs it. ----
  // The brand rule (brandkit.md) is "lowercase always", so this is preview-only.
  var CAPS = true;
  var PROPER = {
    "grassroots": "Grassroots", "gainesville": "Gainesville", "florida": "Florida",
    "tallahassee": "Tallahassee", "athens": "Athens", "charleston": "Charleston",
    "chapel hill": "Chapel Hill", "santa fe": "Santa Fe", "uf": "UF", "usa": "USA",
    "stripe": "Stripe", "shopify": "Shopify", "instagram": "Instagram", "linkedin": "LinkedIn",
    "google": "Google", "doordash": "DoorDash", "etsy": "Etsy", "tiktok": "TikTok", "venmo": "Venmo"
  };
  var properRe = new RegExp("(^|[^@.\\w])(" + Object.keys(PROPER).join("|") + ")(?![.@\\w])", "gi");
  var SKIP = "script, style, svg, textarea, select, code, " + LOGO;
  var NAMES = ".ld-hero-card__name, .ld-peek-card__biz, [class*='__biz'], [class*='biz-name'], [class*='__author']";

  function blockOf(node) {
    var el = node.parentElement;
    while (el && el !== document.body) {
      var d = getComputedStyle(el).display;
      // Word-by-word animations wrap each word in an inline-block <span>; those stay
      // part of the sentence. Buttons/links that are inline-block still start fresh.
      var wordWrap = el.tagName === "SPAN" && d.indexOf("inline") === 0;
      if (d !== "inline" && d !== "contents" && !wordWrap) return el;
      el = el.parentElement;
    }
    return document.body;
  }
  function capsPass() {
    // Undo the stylesheet's forced lowercase so real capitals can show.
    document.querySelectorAll("body *").forEach(function (el) {
      if (getComputedStyle(el).textTransform === "lowercase") el.style.textTransform = "none";
    });
    var state = new Map();
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var node;
    while ((node = walker.nextNode())) {
      var parent = node.parentElement;
      if (!parent || !node.data.trim() || parent.closest(SKIP)) continue;
      if (getComputedStyle(parent).textTransform === "uppercase") continue;
      var block = blockOf(node);
      var whole = block.textContent.trim();
      // Leave emails/domains and short initials ("hh", "ma") alone.
      if (whole.indexOf("@") !== -1 || /^[a-z]{1,3}$/.test(whole)) continue;
      var capNext = state.has(block) ? state.get(block) : true;
      var out = "";
      for (var i = 0; i < node.data.length; i++) {
        var ch = node.data[i];
        if (capNext && /[a-z]/.test(ch)) { ch = ch.toUpperCase(); capNext = false; }
        else if (/[A-Za-z0-9]/.test(ch)) capNext = false;
        out += ch;
        if (/[.?!]/.test(ch) && /\s/.test(node.data[i + 1] || " ")) capNext = true;
      }
      state.set(block, capNext);
      // Business and person names are proper nouns: capitalize every word.
      if (parent.closest(NAMES)) out = out.replace(/(^|[\s/&(-])([a-z])/g, function (m, pre, c) { return pre + c.toUpperCase(); });
      // "· columbia, sc" -> "· Columbia, SC"
      out = out.replace(/(^|·\s*)([a-z][a-z .'-]*), ([a-z]{2})\s*$/i, function (m, pre, city, st) {
        return pre + city.replace(/(^|\s)([a-z])/g, function (x, s, c) { return s + c.toUpperCase(); }) + ", " + st.toUpperCase();
      });
      out = out
        .replace(/(^|[^\w'])i(?=['’]|\s|[.,!?]|$)/g, function (m, pre) { return pre + "I"; })
        .replace(properRe, function (m, pre, word) { return pre + PROPER[word.toLowerCase()]; });
      if (out !== node.data) node.data = out;
    }
  }

  // Re-run when the page adds content after load (e.g. the home page's listing cards).
  // Both passes are safe to repeat: swapped/capitalized text no longer changes.
  var queued = false;
  function runAll() {
    if (CAPS) capsPass();
  }
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(function () { queued = false; runAll(); });
  }
  function start() {
    runAll();
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("load", schedule);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
