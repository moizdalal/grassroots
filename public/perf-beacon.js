// perf-beacon.js — captures Core Web Vitals from real users and posts
// one row per pageview to /api/metrics/page-load. Loaded with `defer`
// from every HTML page so it never blocks render.
//
// Why visibilitychange / pagehide instead of "load"?
//   • LCP keeps moving until the user interacts.
//   • CLS keeps accumulating throughout the page's life.
//   • INP requires the user to actually interact at least once.
// Snapshotting on hide gives us the *final* settled values.
//
// Why navigator.sendBeacon?
//   • A regular fetch initiated during unload often gets aborted.
//   • sendBeacon queues the POST to a separate browser process that
//     completes even if the tab is gone. Falls back to keepalive fetch
//     on browsers that lack it.

(function () {
  if (window.__grPerfBeacon) return;
  window.__grPerfBeacon = true;

  // Skip iframes (Stripe checkout, etc.) — we only want top-level navs.
  if (window.top !== window) return;

  // Prerender frames get rolled into the eventual navigation; defer the
  // measurement so we record the user's actual visit, not the prerender.
  if (document.prerendering) {
    document.addEventListener("prerenderingchange", start, { once: true });
  } else {
    start();
  }

  function start() {
    var sample = {
      pathname: location.pathname,
      device_class: deviceClass(),
      connection_type: connectionType(),
      lcp_ms: null,
      inp_ms: null,
      cls_x1000: null,
      ttfb_ms: null,
      fcp_ms: null,
      load_event_ms: null,
    };

    // TTFB + load event from the Navigation Timing entry.
    try {
      var nav = performance.getEntriesByType("navigation")[0];
      if (nav) {
        sample.ttfb_ms = Math.round(nav.responseStart);
        if (nav.loadEventEnd > 0) {
          sample.load_event_ms = Math.round(nav.loadEventEnd);
        }
      }
    } catch (_) {}

    // Listen for the load event in case it hasn't fired yet (script defers
    // run before DOMContentLoaded but after parsing — load might still be
    // pending if subresources are still streaming).
    window.addEventListener("load", function () {
      try {
        var nav = performance.getEntriesByType("navigation")[0];
        if (nav && nav.loadEventEnd > 0) {
          sample.load_event_ms = Math.round(nav.loadEventEnd);
        }
      } catch (_) {}
    }, { once: true });

    // FCP
    safeObserve({ type: "paint", buffered: true }, function (entries) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].name === "first-contentful-paint") {
          sample.fcp_ms = Math.round(entries[i].startTime);
        }
      }
    });

    // LCP — keep updating; the last observation before hide wins.
    var lcpValue = 0;
    safeObserve({ type: "largest-contentful-paint", buffered: true }, function (entries) {
      var last = entries[entries.length - 1];
      if (last) lcpValue = last.startTime;
    });

    // CLS — sum every shift that wasn't caused by user input.
    var clsValue = 0;
    safeObserve({ type: "layout-shift", buffered: true }, function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (!e.hadRecentInput) clsValue += e.value;
      }
    });

    // INP — the worst (slowest) qualifying interaction wins. We only
    // care about durations above the perceptible threshold (~40ms).
    var inpValue = 0;
    safeObserve({ type: "event", buffered: true, durationThreshold: 40 }, function (entries) {
      for (var i = 0; i < entries.length; i++) {
        var e = entries[i];
        if (e.interactionId && e.duration > inpValue) inpValue = e.duration;
      }
    });

    var sent = false;
    function flush() {
      if (sent) return;
      sent = true;
      if (lcpValue > 0) sample.lcp_ms = Math.round(lcpValue);
      sample.cls_x1000 = Math.round(clsValue * 1000);
      if (inpValue > 0) sample.inp_ms = Math.round(inpValue);

      // Drop the sample if we have no useful signal at all (e.g. the
      // user navigated away before first paint).
      if (sample.lcp_ms == null && sample.fcp_ms == null && sample.ttfb_ms == null) {
        return;
      }

      var body = JSON.stringify(sample);
      var url = "/api/metrics/page-load";
      try {
        if (navigator.sendBeacon) {
          var blob = new Blob([body], { type: "application/json" });
          if (navigator.sendBeacon(url, blob)) return;
        }
      } catch (_) {}
      try {
        fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: body,
          keepalive: true,
        }).catch(function () {});
      } catch (_) {}
    }

    // visibilitychange fires when the user backgrounds the tab, switches
    // apps, or navigates away. pagehide is a belt-and-suspenders for
    // iOS Safari, which can skip visibilitychange on close.
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") flush();
    });
    window.addEventListener("pagehide", flush);
  }

  function safeObserve(opts, cb) {
    try {
      var po = new PerformanceObserver(function (list) { cb(list.getEntries()); });
      po.observe(opts);
    } catch (_) {
      // Browser doesn't support this entry type — skip silently.
    }
  }

  function deviceClass() {
    var w = window.innerWidth;
    if (w <= 600) return "mobile";
    if (w <= 1024) return "tablet";
    return "desktop";
  }

  function connectionType() {
    try {
      var c = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
      return c && c.effectiveType ? c.effectiveType : "unknown";
    } catch (_) {
      return "unknown";
    }
  }
})();
