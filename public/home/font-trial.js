// FONT PREVIEW FOR REVIEW — not the final implementation.
// Swaps the page fonts at runtime so the proposed type system can be seen on
// any page that includes this script. If approved, the fonts should move into
// the stylesheets properly and this file should be deleted.
// To undo, delete this file and its <script> tag in each page.
(function () {
  // Pick the trial: "LFG" (Lexend / Figtree / Geist), "A", or "C".
  var OPTION = "LFG";

  var OPTIONS = {
    // Lexend 500 headlines, Figtree body, Geist labels and small caps, Fraunces logo.
    LFG: {
      fonts: "family=Lexend:wght@300..700&family=Figtree:ital,wght@0,300..900;1,300..900&family=Geist:wght@300..700&family=Fraunces:opsz,wght@9..144,600",
      logo: '"Fraunces", Georgia, serif',
      label: '"Geist", system-ui, sans-serif',
      map: {
        fraunces: { to: '"Lexend", system-ui, sans-serif', weight: "500", upright: true },
        manrope: { to: '"Figtree", system-ui, sans-serif' },
        "jetbrains mono": { to: '"Geist", system-ui, sans-serif' },
        caveat: { to: '"Figtree", system-ui, sans-serif' }
      }
    },
    A: {
      fonts: "family=Instrument+Serif:ital@0;1&family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900",
      map: {
        fraunces: { to: '"Instrument Serif", Georgia, serif', weight: "400" },
        manrope: { to: '"Inter", system-ui, sans-serif' }
      }
    },
    C: {
      fonts: "family=Bricolage+Grotesque:opsz,wght@12..96,200..800&family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000",
      map: {
        fraunces: { to: '"Bricolage Grotesque", system-ui, sans-serif', upright: true },
        manrope: { to: '"DM Sans", system-ui, sans-serif' }
      }
    }
  };
  var cfg = OPTIONS[OPTION];

  var link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = "https://fonts.googleapis.com/css2?" + cfg.fonts + "&display=swap";
  document.head.appendChild(link);

  var LOGO = ".ld-nav__brand-text, .ld-nav__brand-text *, .ld-foot__brand, .ld-foot__brand *";
  // Every title (any heading) uses the logo's serif, whatever font it started in.
  var TITLES = "h1, h2, h3, h4, h1 *, h2 *, h3 *, h4 *";

  function apply() {
    // Read every element's original style first, so a parent's swap can't hide its children's.
    var plan = [];
    document.querySelectorAll("body *").forEach(function (el) {
      var cs = getComputedStyle(el);
      if (cfg.logo && el.matches(TITLES) && !el.matches(LOGO) && !el.closest("svg")) {
        plan.push({ el: el, to: cfg.logo, weight: "600", upright: true });
        return;
      }
      var first = cs.fontFamily.split(",")[0].replace(/["']/g, "").trim().toLowerCase();
      var rule = cfg.map[first];
      if (!rule) return;
      var italic = cs.fontStyle === "italic";
      if (cfg.logo && el.matches(LOGO)) {
        plan.push({ el: el, to: cfg.logo });
      } else if (cfg.label && cs.textTransform === "uppercase" && parseFloat(cs.fontSize) <= 14) {
        // Small uppercase text = labels ("chapter i", "posted 2h ago", stat captions).
        plan.push({ el: el, to: cfg.label });
      } else {
        plan.push({ el: el, to: rule.to, weight: rule.weight, upright: rule.upright && italic });
      }
    });
    plan.forEach(function (p) {
      p.el.style.fontFamily = p.to;
      if (p.weight) p.el.style.fontWeight = p.weight;
      // Lexend and Bricolage have no italic; keep emphasis upright instead of a fake slant.
      if (p.upright) p.el.style.fontStyle = "normal";
    });
  }
  // ---- Sentence-case trial: capitalize where grammar needs it. ----
  // The brand rule (brandkit.md) is "lowercase always", so this is preview-only.
  var CAPS = true;
  var PROPER = {
    "grassroots": "Grassroots", "gainesville": "Gainesville", "florida": "Florida",
    "tallahassee": "Tallahassee", "athens": "Athens", "charleston": "Charleston",
    "chapel hill": "Chapel Hill", "santa fe": "Santa Fe", "uf": "UF", "usa": "USA",
    "stripe": "Stripe", "shopify": "Shopify", "instagram": "Instagram", "linkedin": "LinkedIn",
    "google": "Google", "doordash": "DoorDash", "etsy": "Etsy", "tiktok": "TikTok", "venmo": "Venmo",
    "moiz": "Moiz", "dalal": "Dalal"
  };
  // A period right after the word only means a domain ("grassroots.work") when a
  // letter follows it; "...started grassroots." is still the name.
  var properRe = new RegExp("(^|[^@.\\w])(" + Object.keys(PROPER).join("|") + ")(?![@\\w]|\\.\\w)", "gi");
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
      // Chapter numbers on their own ("ii.", "iv.") are roman numerals: all capitals.
      if (/^\s*[ivxlc]+\.\s*$/i.test(node.data)) out = node.data.toUpperCase();
      if (out !== node.data) node.data = out;
    }
  }

  // Re-run when the page adds content after load (e.g. the home page's listing cards).
  // Both passes are safe to repeat: swapped/capitalized text no longer changes.
  var queued = false;
  function runAll() {
    apply();
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
