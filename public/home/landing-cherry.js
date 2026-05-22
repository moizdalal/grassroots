/* landing-cherry.js — cherry-blossom stage-5 growth choreography
   ported from the spec. each animated element carries a data-anim
   attribute of "start,dur" pairs (one pair per simultaneous keyframe
   animation). landing.js reads these and sets animation-delay on
   scroll so scrolling forward plays the choreography and scrolling
   back reverses it.

   total runtime: ~8.2s — exposed as window.LD_CHERRY.TOTAL. */

(function () {
  "use strict";

  const VIEW_W = 100, VIEW_H = 160, SOIL_Y = 150, STEM_X = 50;
  const H = { s2: 122, s3: 85, s4: 50, s5: 18, s5Stem: 45 };

  // cherry skin
  const S = {
    petal: "#f8c8d6", shade: "#dc94aa", center: "#e8b03c",
    deep: "#8a3a4e", bark: "#5a3d28", seed: "#3a2418",
  };
  const STEM_TOKEN = "var(--fo-accent)";
  const LEAF_TOKEN = "var(--fo-accent)";
  const VEIN = "rgba(0, 0, 0, 0.32)";
  const VEIN_LITE = "rgba(0, 0, 0, 0.2)";

  // timing constants from the spec
  const PRE = 0.3;
  const PHASE = 1.25;
  const FADE = 0.65;
  const EMERGE = 0.95;

  const EASE_EMERGE = "cubic-bezier(0.32, 0.72, 0.32, 1)";
  const EASE_RETRACT = "cubic-bezier(0.6, 0, 0.85, 0.3)";
  const EASE_STEM = "cubic-bezier(0.4, 0.05, 0.55, 0.95)";
  const EASE_FALL = "cubic-bezier(0.42, 0, 0.72, 1)";

  /* ── primitives ───────────────────────────────────────── */

  function defs() {
    return `
      <defs>
        <filter id="ld-cherry-sun" x="-50%" y="-50%" width="200%" height="200%">
          <feDropShadow dx="-1" dy="1.8" stdDeviation="1.2" flood-color="rgba(0, 0, 0, 0.32)"/>
        </filter>
      </defs>`;
  }

  function ground() {
    return `
      <line x1="18" y1="${SOIL_Y}" x2="82" y2="${SOIL_Y}"
            stroke="var(--fo-text-3)" stroke-width="1.1"
            stroke-dasharray="2 3" opacity="0.45"/>
      <circle cx="26" cy="${SOIL_Y + 1.8}" r="0.8" fill="var(--fo-text-3)" opacity="0.5"/>
      <circle cx="38" cy="${SOIL_Y + 1.4}" r="0.65" fill="var(--fo-text-3)" opacity="0.5"/>
      <circle cx="50" cy="${SOIL_Y + 1.9}" r="0.55" fill="var(--fo-text-3)" opacity="0.45"/>
      <circle cx="62" cy="${SOIL_Y + 1.4}" r="0.8" fill="var(--fo-text-3)" opacity="0.5"/>
      <circle cx="74" cy="${SOIL_Y + 1.8}" r="0.65" fill="var(--fo-text-3)" opacity="0.5"/>
    `;
  }

  function leaf({ anchorX = STEM_X, anchorY, rotate = 0, length = 18, width = 6.5, fill = LEAF_TOKEN, opacity = 1, petiole = 2.5 }) {
    const rad = (rotate * Math.PI) / 180;
    const dx = Math.sin(rad) * petiole;
    const dy = -Math.cos(rad) * petiole;
    return `
      <g transform="translate(${anchorX} ${anchorY})">
        <line x1="0" y1="0" x2="${dx}" y2="${dy}"
              stroke="${fill}" stroke-width="1.2" stroke-linecap="round" opacity="${opacity}"/>
        <g transform="translate(${dx} ${dy}) rotate(${rotate})">
          <path d="M 0 0 C ${width} ${-length * 0.25} ${width * 0.45} ${-length * 0.78} 0 ${-length}
                   C ${-width * 0.45} ${-length * 0.78} ${-width} ${-length * 0.25} 0 0 Z"
                fill="${fill}" opacity="${opacity}"/>
          <path d="M 0 0 L 0 ${-length + 1}" stroke="${VEIN}" stroke-width="0.55"
                stroke-linecap="round" opacity="0.65"/>
          <path d="M 0 ${-length * 0.32} Q ${width * 0.35} ${-length * 0.45} ${width * 0.55} ${-length * 0.5}"
                fill="none" stroke="${VEIN_LITE}" stroke-width="0.4"/>
          <path d="M 0 ${-length * 0.32} Q ${-width * 0.35} ${-length * 0.45} ${-width * 0.55} ${-length * 0.5}"
                fill="none" stroke="${VEIN_LITE}" stroke-width="0.4"/>
        </g>
      </g>`;
  }

  function cherryBlossom(cx, cy, scale = 1) {
    let petals = "";
    for (let i = 0; i < 5; i++) {
      petals += `<ellipse cx="0" cy="-2.6" rx="1.7" ry="2.5" fill="${S.petal}"
                          stroke="${S.deep}" stroke-width="0.25" transform="rotate(${72 * i})"/>`;
    }
    return `<g transform="translate(${cx} ${cy}) scale(${scale})">
      ${petals}
      <circle cx="0" cy="0" r="0.85" fill="${S.center}"/>
      <circle cx="-0.5" cy="-0.3" r="0.4" fill="${S.deep}" opacity="0.55"/>
    </g>`;
  }

  function stage1Seed() {
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 4})">
        <ellipse cx="0" cy="0" rx="4" ry="5" fill="${S.seed}"/>
        <ellipse cx="-1.2" cy="-1.4" rx="1.4" ry="2" fill="rgba(255,255,255,0.16)"/>
        <path d="M 0 -5 Q -1 -7 -2 -8" stroke="${S.bark}" stroke-width="1"
              fill="none" stroke-linecap="round"/>
        <ellipse cx="-2" cy="-8" rx="0.8" ry="0.6" fill="${S.shade}"/>
      </g>`;
  }

  /* ── style helpers (paused animations, JS scrubs delay) ── */

  // emerge — element starts at scale(0), ends at scale(1)
  function styleEmerge(pivotX, pivotY, kf = "ldc-el-emerge", dur = EMERGE, ease = EASE_EMERGE) {
    return `transform-origin: ${pivotX}px ${pivotY}px; transform: scale(0); ` +
           `animation: ${kf} ${dur}s ${ease} forwards paused; animation-fill-mode: both;`;
  }

  // retract — element visible at scale(1), animates to scale(0)
  function styleRetract(pivotX, pivotY, dur = FADE, ease = EASE_RETRACT) {
    return `transform-origin: ${pivotX}px ${pivotY}px; ` +
           `animation: ldc-el-retract ${dur}s ${ease} forwards paused; animation-fill-mode: both;`;
  }

  /* ── growth: stage 5 ──────────────────────────────────── */

  function cherryGrowth() {
    const trunkTopY = 70;
    const stemDur = (5 - 1) * PHASE;  // 5.0s
    const stemStartAt = PRE;          // 0.3s

    // map y on the trunk path back to when the draw reaches that y
    const stemReachesAt = (y) => {
      const clamped = Math.max(trunkTopY, Math.min(SOIL_Y, y));
      return stemStartAt + stemDur * ((SOIL_Y - clamped) / (SOIL_Y - trunkTopY));
    };

    const out = [];
    const anims = []; // collected for the JS scrubber

    // helper: register an element with a single animation spec
    const reg = (markup, start, dur) => {
      out.push(markup);
      anims.push({ start, dur, multi: false });
    };
    // helper: register a multi-animation element (cotyledons)
    const regMulti = (markup, pairs) => {
      out.push(markup);
      anims.push({ multi: true, pairs });
    };

    // 1) seed (visible at t=0, retracts at PRE)
    reg(
      `<g class="ld-c-el" data-i="${anims.length}" style="${styleRetract(STEM_X, SOIL_Y)}">${stage1Seed()}</g>`,
      PRE, FADE
    );

    // 2) trunk — draws via stem-draw
    const trunkPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 105 ${STEM_X - 2} ${trunkTopY}`;
    reg(
      `<path class="ld-c-el" data-i="${anims.length}" d="${trunkPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
            fill="none" stroke="${S.bark}" stroke-width="4.2" stroke-linecap="round"
            style="animation: ldc-stem-draw ${stemDur}s ${EASE_STEM} forwards paused; animation-fill-mode: both;"/>`,
      stemStartAt, stemDur
    );

    // 3) cotyledons — nested <g>: outer animates fall, inner animates emerge
    const cotyX = STEM_X + 0.5;
    const cotyY = H.s2;
    const cotyEmergeAt = stemReachesAt(cotyY);
    const cotyFallAt = stemReachesAt(H.s3);
    const cotyFallDur = 1.4;

    // left
    const leftPath = `
      <g transform="translate(${cotyX} ${cotyY})">
        <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF_TOKEN}"/>
        <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
      </g>`;
    regMulti(
      `<g class="ld-c-el" data-i="${anims.length}"
          style="transform-origin: ${cotyX}px ${cotyY}px; animation: ldc-cot-fall-left ${cotyFallDur}s ${EASE_FALL} forwards paused; animation-fill-mode: both;">
        <g class="ld-c-el" data-i="${anims.length + 1}"
            style="transform-origin: ${cotyX}px ${cotyY}px; transform: scale(0); animation: ldc-leaf-emerge ${EMERGE}s ${EASE_EMERGE} forwards paused; animation-fill-mode: both;">
          ${leftPath}
        </g>
      </g>`,
      [{ start: cotyFallAt, dur: cotyFallDur }, { start: cotyEmergeAt, dur: EMERGE }]
    );
    // the regMulti pushed ONE entry but we have TWO nested elements both with data-i. Push the inner entry too.
    anims.push({ start: cotyEmergeAt, dur: EMERGE, multi: false, _inner: true });

    // right (mirror)
    const rightPath = `
      <g transform="translate(${cotyX} ${cotyY})">
        <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF_TOKEN}" opacity="0.93"/>
        <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
      </g>`;
    regMulti(
      `<g class="ld-c-el" data-i="${anims.length}"
          style="transform-origin: ${cotyX}px ${cotyY}px; animation: ldc-cot-fall-right ${cotyFallDur}s ${EASE_FALL} forwards paused; animation-fill-mode: both;">
        <g class="ld-c-el" data-i="${anims.length + 1}"
            style="transform-origin: ${cotyX}px ${cotyY}px; transform: scale(0); animation: ldc-leaf-emerge ${EMERGE}s ${EASE_EMERGE} forwards paused; animation-fill-mode: both;">
          ${rightPath}
        </g>
      </g>`,
      [{ start: cotyFallAt, dur: cotyFallDur }, { start: cotyEmergeAt, dur: EMERGE }]
    );
    anims.push({ start: cotyEmergeAt, dur: EMERGE, multi: false, _inner: true });

    // 4) five branches drawn in sequence
    const branchSpecs = [
      { d: `M ${STEM_X - 1} 100 Q ${STEM_X - 15} 80 ${STEM_X - 24} 55 Q ${STEM_X - 28} 42 ${STEM_X - 29} 30`, w: 2.6, atY: 100 },
      { d: `M ${STEM_X - 1} 80  Q ${STEM_X + 12} 70 ${STEM_X + 20} 50 Q ${STEM_X + 26} 35 ${STEM_X + 28} 22`, w: 2.6, atY: 80  },
      { d: `M ${STEM_X - 2} 90  Q ${STEM_X - 9}  75 ${STEM_X - 11} 58`,                                       w: 1.8, atY: 90  },
      { d: `M ${STEM_X - 2} 70  Q ${STEM_X + 6}  55 ${STEM_X + 10} 40`,                                       w: 1.8, atY: 70  },
      { d: `M ${STEM_X - 2} 70  L ${STEM_X - 2}  45 L ${STEM_X + 2} 28 L ${STEM_X + 4} ${H.s5}`,              w: 2,   atY: 70  },
    ];
    const branchDur = 0.55;
    const branchEnds = [];
    branchSpecs.forEach((b, idx) => {
      const start = stemReachesAt(b.atY) + idx * 0.06;
      reg(
        `<path class="ld-c-el" data-i="${anims.length}" d="${b.d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${S.bark}" stroke-width="${b.w}" stroke-linecap="round"
              style="animation: ldc-stem-draw ${branchDur}s ${EASE_STEM} forwards paused; animation-fill-mode: both;"/>`,
        start, branchDur
      );
      branchEnds.push(start + branchDur);
    });
    const branchesDoneAt = Math.max.apply(null, branchEnds);

    // 5) five small leaves along the branches
    const leafSpec = [
      { ax: STEM_X - 22, ay: 56, rot: -60, len: 8, w: 3.2 },
      { ax: STEM_X + 18, ay: 50, rot: 60,  len: 8, w: 3.2 },
      { ax: STEM_X - 9,  ay: 68, rot: -40, len: 7, w: 3 },
      { ax: STEM_X + 7,  ay: 45, rot: 50,  len: 7, w: 3 },
      { ax: STEM_X - 4,  ay: 35, rot: -30, len: 6, w: 2.8, op: 0.9 },
    ];
    leafSpec.forEach((cfg, idx) => {
      const body = leaf({ anchorX: cfg.ax, anchorY: cfg.ay, rotate: cfg.rot, length: cfg.len, width: cfg.w, opacity: cfg.op == null ? 1 : cfg.op });
      const start = branchesDoneAt + idx * 0.07;
      reg(
        `<g class="ld-c-el" data-i="${anims.length}" style="${styleEmerge(cfg.ax, cfg.ay, "ldc-leaf-emerge")}">${body}</g>`,
        start, EMERGE
      );
    });

    // 6) fifteen blossoms across the branch tips
    const decorBase = branchesDoneAt + leafSpec.length * 0.07 + 0.1;
    const blossoms = [
      [STEM_X - 29, 30, 1],   [STEM_X - 32, 25, 0.85], [STEM_X - 25, 28, 0.9],
      [STEM_X - 27, 36, 0.8], [STEM_X + 28, 22, 1],    [STEM_X + 31, 17, 0.85],
      [STEM_X + 24, 25, 0.9], [STEM_X + 27, 30, 0.8],  [STEM_X - 11, 58, 0.95],
      [STEM_X - 14, 54, 0.8], [STEM_X + 10, 40, 0.95], [STEM_X + 6, 44, 0.8],
      [STEM_X + 4, H.s5, 1],  [STEM_X + 8, H.s5 + 4, 0.85], [STEM_X, 22, 0.8],
    ];
    blossoms.forEach((b, idx) => {
      const [x, y, scale] = b;
      const start = decorBase + idx * 0.05;
      reg(
        `<g class="ld-c-el" data-i="${anims.length}" style="${styleEmerge(x, y, "ldc-leaf-emerge")}">
          <g filter="url(#ld-cherry-sun)">${cherryBlossom(x, y, scale)}</g>
        </g>`,
        start, EMERGE
      );
    });

    // compute total = max end across all anims (account for inner cotyledon entries)
    let total = 0;
    anims.forEach((a) => {
      if (a.multi) {
        a.pairs.forEach((p) => { total = Math.max(total, p.start + p.dur); });
      } else {
        total = Math.max(total, a.start + a.dur);
      }
    });

    return { svgBody: out.join(""), anims, total };
  }

  function renderCherryGrowthAnimated() {
    const built = cherryGrowth();
    const svg = `
      <svg class="ld-cherry__svg" id="ld-cherry-svg" viewBox="0 0 ${VIEW_W} ${VIEW_H}"
           xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        ${defs()}
        ${ground()}
        ${built.svgBody}
      </svg>`;
    return { svg, anims: built.anims, total: built.total };
  }

  window.LD_CHERRY = {
    renderCherryGrowthAnimated,
  };
})();
