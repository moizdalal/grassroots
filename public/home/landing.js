/* landing.js — v2
   adds: vine progress, hero parallax, stat counters, sticky-scrub story,
   escrow scroll-driven flow, review chip stagger, theme sync.
   all motion respects prefers-reduced-motion. */

(function () {
  "use strict";

  const reduced = window.matchMedia &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ── why-cards: rAF-driven entrance + soft scroll parallax.
     IntersectionObserver is unreliable in scaled iframes, so we
     check viewport intersection by scroll position. */
  const whyCards = [...document.querySelectorAll('[data-why]')];
  const whyState = whyCards.map(() => ({ entered: false, enteredAt: 0 }));
  whyCards.forEach((c) => {
    c.style.opacity = "0";
    c.style.transform = "translate3d(0, 28px, 0)";
    c.style.willChange = "transform, opacity";
  });
  function checkWhyEntry(now) {
    if (!whyCards.length) return false;
    const vh = window.innerHeight;
    let any = false;
    whyCards.forEach((card, i) => {
      const st = whyState[i];
      const r = card.getBoundingClientRect();
      if (!st.entered && r.top < vh - vh * 0.12 && r.bottom > 0) {
        st.entered = true;
        st.enteredAt = now + i * 130;
      }
      if (st.entered) {
        const t = Math.max(0, Math.min(1, (now - st.enteredAt) / 700));
        if (t >= 0) {
          const e = 1 - Math.pow(1 - t, 3);
          const y = (1 - e) * 28;
          card.style.opacity = e.toFixed(3);
          card.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
          if (t >= 1) {
            card.style.opacity = "1";
            card.style.transform = "none";
            card.style.willChange = "";
            st.entered = "done";
          } else if (st.entered !== "done") {
            any = true;
          }
        } else {
          any = true;
        }
      }
    });
    return any;
  }
  /* ── reveal on scroll position (rAF-driven, IO-free).
     each .ld-reveal sets inline opacity:0/translateY(14px) on init,
     then animates to (1,0) on the first frame after its top enters
     the viewport bottom. lightweight; no observer required. */
  const reduced2 = reduced;
  const revealEls = [...document.querySelectorAll(".ld-reveal")];
  if (!reduced2 && revealEls.length) {
    revealEls.forEach((el) => {
      el.style.opacity = "0";
      el.style.transform = "translate3d(0, 14px, 0)";
      el.style.willChange = "transform, opacity";
    });
  }
  const revealState = revealEls.map(() => ({ enteredAt: 0 }));
  function checkReveals(now) {
    if (reduced2) return;
    const vh = window.innerHeight;
    let anyActive = false;
    revealEls.forEach((el, i) => {
      const st = revealState[i];
      const r = el.getBoundingClientRect();
      if (!st.enteredAt && r.top < vh - vh * 0.08 && r.bottom > 0) {
        st.enteredAt = now;
      }
      if (st.enteredAt) {
        const t = Math.max(0, Math.min(1, (now - st.enteredAt) / 600));
        const e = 1 - Math.pow(1 - t, 3);
        const y = (1 - e) * 14;
        el.style.opacity = e.toFixed(3);
        el.style.transform = `translate3d(0, ${y.toFixed(2)}px, 0)`;
        if (t >= 1) {
          // settle: leave inline styles cleared so we don't keep painting
          el.style.opacity = "1";
          el.style.transform = "none";
          el.style.willChange = "";
          st.enteredAt = -1;
        } else {
          anyActive = true;
        }
      }
    });
    return anyActive;
  }
  const nav = document.getElementById("ld-nav");
  const navProgress = document.getElementById("ld-nav-progress");
  // The theme toggle is wired once in /home/nav.js. A second click handler here
  // made each click flip the theme twice, so it never changed on the home page.
  function updateNav() {
    if (nav) nav.classList.toggle("is-scrolled", window.scrollY > 8);
    if (navProgress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      navProgress.style.width = (p * 100).toFixed(2) + "%";
    }
  }
  updateNav();
  window.addEventListener("scroll", updateNav, { passive: true });

  /* ── vine progress — removed ───────────────────────────── */

  /* ── hero card parallax ─────────────────────────────────── */
  const heroCards = document.querySelectorAll(".ld-hero-card");
  function updateHeroParallax() {
    if (reduced) return;
    const y = window.scrollY;
    heroCards.forEach((c) => {
      const px = parseFloat(c.dataset.px || "0.1");
      c.style.setProperty("--py", (-y * px).toFixed(1) + "px");
    });
  }

  /* ── stat counters: scroll-position triggered ──────────── */
  const counters = [...document.querySelectorAll("[data-counter]")];
  function animateCount(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = "1";
    const target = parseInt(el.dataset.counter, 10);
    if (Number.isNaN(target)) return;
    if (reduced) { el.textContent = target; return; }
    const start = performance.now();
    const duration = 1200;
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      const val = Math.round(target * eased);
      el.textContent = val;
      if (t < 1) requestAnimationFrame(frame);
      else el.textContent = target;
    }
    requestAnimationFrame(frame);
  }
  function checkCounters() {
    const vh = window.innerHeight;
    counters.forEach((el) => {
      if (el.dataset.counted) return;
      const r = el.getBoundingClientRect();
      if (r.top < vh * 0.85 && r.bottom > 0) animateCount(el);
    });
  }

  /* ── how-it-works sticky scrub story ───────────────────── */
  // inject the cherry growth tree + collect per-element animation specs
  const cherryEl = document.getElementById("ld-cherry");
  const cherryCounter = document.getElementById("ld-cherry-counter");
  let cherryAnimEls = [];
  let cherryAnims = [];
  let cherryTotal = 1;
  if (cherryEl && window.LD_CHERRY && typeof window.LD_CHERRY.renderCherryGrowthAnimated === "function") {
    const built = window.LD_CHERRY.renderCherryGrowthAnimated();
    cherryEl.insertAdjacentHTML("beforeend", built.svg);
    cherryAnims = built.anims;
    cherryTotal = built.total || 1;
    // map data-i → DOM element for fast lookup
    cherryAnimEls = Array.from(cherryEl.querySelectorAll(".ld-c-el"));
  }

  const scrub = document.getElementById("ld-story-scrub");
  const progressFill = document.getElementById("ld-story-progress");
  const ticks = document.getElementById("ld-story-ticks");
  const storyCards = document.querySelectorAll(".ld-story-card");
  const STORY_STEPS = 4;

  // Scrub each cherry animation: animation-delay = -elementTime keeps
  // the (paused) animation at the right frame. Multi-animation
  // elements (cotyledons) get a comma-separated list.
  function scrubCherry(globalT) {
    for (const el of cherryAnimEls) {
      const i = parseInt(el.getAttribute("data-i"), 10);
      const a = cherryAnims[i];
      if (!a) continue;
      if (a.multi) {
        // multi never used for now (we registered cotyledons as separate entries)
        const delays = a.pairs.map((p) => {
          const t = Math.max(0, Math.min(p.dur, globalT - p.start));
          return `${(-t).toFixed(3)}s`;
        }).join(", ");
        el.style.animationDelay = delays;
      } else {
        const t = Math.max(0, Math.min(a.dur, globalT - a.start));
        el.style.animationDelay = `${(-t).toFixed(3)}s`;
      }
    }
  }

  function updateStory() {
    if (!scrub) return;
    const rect = scrub.getBoundingClientRect();
    const vh = window.innerHeight;
    const total = rect.height - vh;
    if (total <= 0) return;
    const scrolled = Math.max(0, Math.min(total, -rect.top));
    const p = scrolled / total;
    const stepFloat = p * STORY_STEPS;
    const stepIdx = Math.max(1, Math.min(STORY_STEPS, Math.ceil(stepFloat + 0.001)));

    // scrub cherry growth — p ∈ [0,1] → globalT ∈ [0, cherryTotal]
    scrubCherry(p * cherryTotal);

    if (cherryCounter && cherryCounter.dataset.step !== String(stepIdx)) {
      cherryCounter.dataset.step = String(stepIdx);
    }

    storyCards.forEach((card) => {
      const s = parseInt(card.dataset.step, 10);
      card.classList.toggle("is-active", s === stepIdx);
    });

    if (progressFill) progressFill.style.width = (p * 100).toFixed(1) + "%";
    if (ticks) {
      const tickEls = ticks.querySelectorAll(".ld-story__progress-tick");
      tickEls.forEach((t, i) => t.classList.toggle("is-passed", i < stepIdx));
    }
  }

  /* ── escrow scroll-driven scene (sticky pinned).
     simpler choreography: a single $420 note travels biz → vault →
     student. an arc-ring around the vault fills as money enters
     the vault, drains as it leaves. lock icon highlights when held,
     tilts open when released. support-review badge floats in
     mid-scene. parties + steps light up in phase. */
  const escrowScrub  = document.getElementById("ld-escrow-scrub");
  const escrowStage  = document.getElementById("ld-escrow-stage");
  const escrowNote   = document.getElementById("ld-escrow-note");
  const escrowArc    = document.getElementById("ld-escrow-arc");
  const escrowAmount = document.getElementById("ld-escrow-amount");
  const escrowState  = document.getElementById("ld-escrow-state");
  const escrowReview = document.getElementById("ld-escrow-review");
  const escrowProgress = document.getElementById("ld-escrow-progress");
  const escrowBizIcon  = document.getElementById("ld-escrow-icon-biz");
  const escrowStuIcon  = document.getElementById("ld-escrow-icon-student");
  const escrowVaultEl  = document.getElementById("ld-escrow-vault-el");
  const escrowBizBalance = document.getElementById("ld-escrow-biz-balance");
  const escrowStuBalance = document.getElementById("ld-escrow-student-balance");
  const escrowSteps  = escrowScrub ? [...escrowScrub.querySelectorAll(".ld-escrow__step")] : [];
  const escrowParties = escrowScrub ? [...escrowScrub.querySelectorAll(".ld-escrow__party")] : [];

  const easeOutCubicEs = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOutEs    = (t) => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;

  let escrowGeom = null;
  function recomputeEscrowGeom() {
    if (!escrowStage || !escrowBizIcon || !escrowStuIcon || !escrowVaultEl) return;
    const stage = escrowStage.getBoundingClientRect();
    const biz   = escrowBizIcon.getBoundingClientRect();
    const stu   = escrowStuIcon.getBoundingClientRect();
    const vault = escrowVaultEl.getBoundingClientRect();
    escrowGeom = {
      bizCx:   biz.left + biz.width / 2 - stage.left,
      bizCy:   biz.top + biz.height / 2 - stage.top,
      stuCx:   stu.left + stu.width / 2 - stage.left,
      stuCy:   stu.top + stu.height / 2 - stage.top,
      vaultCx: vault.left + vault.width / 2 - stage.left,
      vaultCy: vault.top + vault.height / 2 - stage.top,
    };
  }
  window.addEventListener("resize", recomputeEscrowGeom);

  function setActiveStep(idx) {
    escrowSteps.forEach((el, i) => {
      el.classList.toggle("is-active", i === idx);
      el.classList.toggle("is-passed", i < idx);
    });
  }

  function updateEscrow() {
    if (!escrowScrub || !escrowStage) return;
    if (!escrowGeom) recomputeEscrowGeom();
    if (!escrowGeom) return;

    const r = escrowScrub.getBoundingClientRect();
    const total = r.height - window.innerHeight;
    const scrolled = -r.top;
    const p = Math.max(0, Math.min(1, total > 0 ? scrolled / total : 0));

    /* phase ranges:
       0.00 → 0.10  intro (biz ready)
       0.10 → 0.38  note travels biz → vault
       0.38 → 0.60  held in escrow (arc full, lock highlighted)
       0.55 → 0.75  support-review badge visible
       0.75 → 1.00  note travels vault → student (arc drains, lock opens) */
    const FLY_IN_A  = 0.10, FLY_IN_B  = 0.38;
    const HELD_A    = 0.38, HELD_B    = 0.75;
    const REVIEW_A  = 0.55, REVIEW_B  = 0.75;
    const FLY_OUT_A = 0.75, FLY_OUT_B = 1.00;

    /* ── note position ─────────────────────────────────────── */
    let noteX = escrowGeom.bizCx;
    let noteY = escrowGeom.bizCy;
    let noteOp = 0;
    let noteScale = 1;

    if (p >= 0 && p < FLY_IN_A) {
      // sitting at biz, fading in
      noteX = escrowGeom.bizCx;
      noteY = escrowGeom.bizCy;
      noteOp = p / FLY_IN_A;
    } else if (p >= FLY_IN_A && p < FLY_IN_B) {
      const sub = (p - FLY_IN_A) / (FLY_IN_B - FLY_IN_A);
      const t = easeInOutEs(sub);
      noteX = escrowGeom.bizCx + (escrowGeom.vaultCx - escrowGeom.bizCx) * t;
      // gentle arc — peak above midpoint
      const peakY = Math.min(escrowGeom.bizCy, escrowGeom.vaultCy) - 50;
      noteY = (1 - t) * (1 - t) * escrowGeom.bizCy
            + 2 * (1 - t) * t * peakY
            + t * t * escrowGeom.vaultCy;
      noteOp = sub > 0.88 ? 1 - (sub - 0.88) / 0.12 : 1;
      noteScale = 1 - sub * 0.2; // shrinks as it enters vault
    } else if (p >= FLY_IN_B && p < FLY_OUT_A) {
      // inside vault — invisible
      noteOp = 0;
      noteX = escrowGeom.vaultCx;
      noteY = escrowGeom.vaultCy;
    } else if (p >= FLY_OUT_A && p < FLY_OUT_B) {
      const sub = (p - FLY_OUT_A) / (FLY_OUT_B - FLY_OUT_A);
      const t = easeInOutEs(sub);
      noteX = escrowGeom.vaultCx + (escrowGeom.stuCx - escrowGeom.vaultCx) * t;
      const peakY = Math.min(escrowGeom.vaultCy, escrowGeom.stuCy) - 50;
      noteY = (1 - t) * (1 - t) * escrowGeom.vaultCy
            + 2 * (1 - t) * t * peakY
            + t * t * escrowGeom.stuCy;
      noteOp = sub < 0.12 ? sub / 0.12 : (sub > 0.88 ? 1 - (sub - 0.88) / 0.12 : 1);
      noteScale = 0.8 + sub * 0.2;
    }
    if (escrowNote) {
      escrowNote.style.opacity = noteOp.toFixed(3);
      escrowNote.style.transform =
        `translate(${noteX.toFixed(1)}px, ${noteY.toFixed(1)}px) translate(-50%, -50%) scale(${noteScale.toFixed(3)})`;
    }

    /* ── vault arc fill ───────────────────────────────────── */
    let arcFrac = 0;
    if (p < FLY_IN_A) arcFrac = 0;
    else if (p < FLY_IN_B) {
      // fills from end of FLY_IN
      arcFrac = Math.max(0, (p - FLY_IN_A) / (FLY_IN_B - FLY_IN_A));
    } else if (p < FLY_OUT_A) arcFrac = 1;
    else if (p < FLY_OUT_B) arcFrac = 1 - (p - FLY_OUT_A) / (FLY_OUT_B - FLY_OUT_A);
    if (escrowArc) escrowArc.style.strokeDashoffset = (1 - arcFrac).toFixed(3);

    /* ── vault state classes (border + lock + shadow) ───── */
    let vaultMode = "empty";
    if (p >= FLY_IN_B && p < FLY_OUT_A + 0.04) vaultMode = "holding";
    else if (p >= FLY_OUT_A + 0.04) vaultMode = "released";
    if (escrowVaultEl) {
      escrowVaultEl.classList.toggle("is-holding",  vaultMode === "holding");
      escrowVaultEl.classList.toggle("is-released", vaultMode === "released");
    }

    /* ── amount + state text ───────────────────────────── */
    let amt = 0;
    if (p >= FLY_IN_A && p < FLY_IN_B) {
      const sub = (p - FLY_IN_A) / (FLY_IN_B - FLY_IN_A);
      amt = Math.round(420 * easeOutCubicEs(sub));
    } else if (p >= FLY_IN_B && p < FLY_OUT_A) {
      amt = 420;
    } else if (p >= FLY_OUT_A && p < FLY_OUT_B) {
      const sub = (p - FLY_OUT_A) / (FLY_OUT_B - FLY_OUT_A);
      amt = Math.round(420 * (1 - easeOutCubicEs(sub)));
    }
    if (escrowAmount) {
      escrowAmount.textContent = `$${amt}`;
      escrowAmount.classList.toggle("is-visible", p > 0.04);
    }
    let stateText = "empty";
    if (p >= FLY_IN_A && p < FLY_IN_B)     stateText = "funding";
    else if (p >= FLY_IN_B && p < REVIEW_A) stateText = "Held safely";
    else if (p >= REVIEW_A && p < REVIEW_B) stateText = "shipped";
    else if (p >= FLY_OUT_A && p < FLY_OUT_B) stateText = "releasing";
    else if (p >= FLY_OUT_B - 0.02) stateText = "delivered";
    if (escrowState) escrowState.textContent = stateText;

    /* ── biz / student balances ─────────────────────────── */
    if (escrowBizBalance) {
      const remain = Math.max(0, 420 - amt - (p >= FLY_IN_B ? 420 - amt : 0));
      // simpler: counts down from 420 to 0 as note exits biz
      let bizRemain = 420;
      if (p >= FLY_IN_A) {
        const sub = Math.min(1, (p - FLY_IN_A) / (FLY_IN_B - FLY_IN_A));
        bizRemain = Math.round(420 * (1 - easeOutCubicEs(sub)));
      }
      escrowBizBalance.textContent = `$${bizRemain} ready`;
      escrowBizBalance.classList.toggle("is-visible", p > 0.04);
    }
    if (escrowStuBalance) {
      let stuRecv = 0;
      if (p >= FLY_OUT_A) {
        const sub = Math.min(1, (p - FLY_OUT_A) / (FLY_OUT_B - FLY_OUT_A));
        stuRecv = Math.round(420 * easeOutCubicEs(sub));
      }
      escrowStuBalance.textContent = `$${stuRecv} received`;
      escrowStuBalance.classList.toggle("is-visible", p > FLY_OUT_A - 0.08);
    }

    /* ── party highlight ──────────────────────────────── */
    escrowParties.forEach((el) => {
      const role = el.dataset.party;
      const active =
        (role === "biz" && p < FLY_IN_B) ||
        (role === "student" && p >= FLY_OUT_A);
      el.classList.toggle("is-active", active);
    });

    /* ── support-review badge ───────────────────────────── */
    if (escrowReview) {
      escrowReview.classList.toggle("is-visible", p > REVIEW_A && p < REVIEW_B);
    }

    /* ── step indicators ──────────────────────────────── */
    let stepIdx = -1;
    if (p >= FLY_IN_A)  stepIdx = 0; // funded
    if (p >= FLY_IN_B)  stepIdx = 1; // held
    if (p >= REVIEW_A)  stepIdx = 2; // reviewed
    if (p >= FLY_OUT_B - 0.04) stepIdx = 3; // released
    setActiveStep(stepIdx);

    /* ── progress hairline ─────────────────────────────── */
    if (escrowProgress) escrowProgress.style.width = `${(p * 100).toFixed(1)}%`;
  }

  /* ── review block reveal — scroll-position triggered ────── */
  const reviewBlock = document.getElementById("ld-review");
  function checkReview() {
    if (!reviewBlock || reviewBlock.classList.contains("is-in")) return;
    const r = reviewBlock.getBoundingClientRect();
    if (r.top < window.innerHeight * 0.65 && r.bottom > 0) {
      reviewBlock.classList.add("is-in");
    }
  }

  /* ── marketplace peek: build cards + duplicate ─────────── */
  const peekTrack = document.getElementById("ld-peek-track");
  const peekDataEl = document.getElementById("ld-peek-data");
  if (peekTrack && peekDataEl) {
    let listings = [];
    try { listings = JSON.parse(peekDataEl.textContent); } catch (e) {}
    const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
    const cardHTML = (l) => `
      <a class="ld-peek-card" href="/marketplace" aria-label="${escapeHtml(l.title)}, ${escapeHtml(l.biz)}">
        <span class="ld-peek-card__eyebrow">${escapeHtml(l.eyebrow)}</span>
        <h3 class="ld-peek-card__title">${escapeHtml(l.title)}</h3>
        <div class="ld-peek-card__row">
          <span class="ld-peek-card__logo" aria-hidden="true">${escapeHtml(l.logo)}</span>
          <div>
            <div class="ld-peek-card__biz">${escapeHtml(l.biz)}</div>
            <div class="ld-peek-card__budget">${escapeHtml(l.budget)}</div>
            <div class="ld-peek-card__contract">${escapeHtml(l.contract)}</div>
          </div>
        </div>
        <div class="ld-peek-card__tags">
          ${l.tags.map((t) => `<span class="ld-peek-card__tag">${escapeHtml(t)}</span>`).join("")}
        </div>
      </a>
    `;
    peekTrack.innerHTML = listings.map(cardHTML).join("") +
                          listings.map(cardHTML).join("");
  }

  /* ── theme pill: sync with GrassrootsTheme and persist ── */
  const themeEl = document.getElementById("ld-theme");
  if (themeEl && window.GrassrootsTheme) {
    const buttons = themeEl.querySelectorAll("[data-theme-set]");
    const sync = () => {
      const current = window.GrassrootsTheme.get();
      buttons.forEach((b) => {
        const matches = b.getAttribute("data-theme-set") === current;
        b.setAttribute("aria-pressed", matches ? "true" : "false");
      });
    };
    buttons.forEach((b) => {
      b.addEventListener("click", () => {
        const next = b.getAttribute("data-theme-set");
        window.GrassrootsTheme.set(next);
        sync();
      });
    });
    sync();
    window.addEventListener("grassroots:themechange", sync);
  }

  /* ── unified scroll tick (rAF-throttled) ───────────────── */
  let ticking = false;
  function onScrollFrame() {
    const now = performance.now();
    updateNav();
    updateHeroParallax();
    updateStory();
    updateEscrow();
    checkReveals(now);
    checkWhyEntry(now);
    checkCounters();
    checkReview();
    ticking = false;
  }

  /* ── continuous rAF loop for entrance animations.
     scroll alone fires the scroll handler only during scroll
     events; entrances need to keep stepping until they finish. */
  let entranceRaf;
  function entranceTick(now) {
    const a = checkReveals(now);
    const b = checkWhyEntry(now);
    if (a || b) {
      entranceRaf = requestAnimationFrame(entranceTick);
    } else {
      entranceRaf = null;
    }
  }
  function kickEntrance() {
    if (!entranceRaf) entranceRaf = requestAnimationFrame(entranceTick);
  }
  // periodically check if any entrance work is pending
  setInterval(kickEntrance, 200);
  function onScroll() {
    if (!ticking) {
      requestAnimationFrame(onScrollFrame);
      ticking = true;
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", () => {
    requestAnimationFrame(onScrollFrame);
  });
  // initial paint
  requestAnimationFrame(() => {
    setTimeout(() => {
      onScrollFrame();
    }, 60);
  });
})();
