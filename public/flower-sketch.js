// flower-sketch.js — draft art for the engagement-journey redesign (v3)
//
// Changes from v2:
//   • palette pushed brighter / more saturated
//   • stage 5 plants are noticeably taller (flower apex y≈18, was y≈30)
//     so the s4 → s5 height jump reads as clearly as s3 → s4
//   • rose s5 redrawn — simpler 4-layer side profile (back bowl,
//     two side petal curls, front whorl, calyx) with no nested chaos
//   • sunflower leaves smaller and fewer (2 per stage, no overlap)
//   • amaranthus calmed down — 3 cascading tassels + 1 topknot
//     (was 5 + 3) and fuzz density halved
//   • azalea middle branch now roots at the soil like the outer two
//   • soft drop-shadow filter applied to flower heads + buds to suggest
//     sunlight from the top right (shadow falls to bottom-left)

// Locked species order — simplest → most exotic. The consultant
// dashboard uses the same array as a lookup table (engagement #1 →
// tulip, #2 → daisy, etc.), so changes here change the species
// assignment for every existing consultant. Add new species at the
// end rather than reordering.
export const FLOWERS = [
  "tulip", "daisy", "sunflower", "hydrangea",
  "azalea", "lily", "amaranthus",
  "cherry", "wisteria", "lotus", "iris",
  "bird", "bamboo", "jacaranda", "dragon",
  "cereus",
];
export const STAGES = [1, 2, 3, 4, 5];
export const STAGE_META = {
  1: { name: "offer submitted",   plant: "seed" },
  2: { name: "offer accepted",    plant: "germinating" },
  3: { name: "kickoff scheduled", plant: "young plant" },
  4: { name: "work delivered",    plant: "budding" },
  5: { name: "payout received",   plant: "in bloom" },
};

const VIEW_W = 100;
const VIEW_H = 160;
const SOIL_Y = 150;
const STEM_X = 50;

// standard apex heights per stage. each stage is roughly +30-35 units
// taller than the one before so the silhouette alone tells you the stage.
const H = {
  s2: 122,
  s3: 85,
  s4: 50,
  s5: 18,     // flower apex
  s5Stem: 45, // stem top (where bloom begins)
};

// vibrant species palette. stems/leaves still use the live --fo-accent
// token so they ground into the page; petal hex is decorative.
const SKIN = {
  tulip:      { petal: "#e35a72", shade: "#a82340", inner: "#f78ea3", deep: "#5e0e22", seed: "#6e482e" },
  daisy:      { petal: "#fbf3dc", shade: "#d8c8a8", center: "#e8b03c", deep: "#a07530", seed: "#2f2218" },
  sunflower:  { petal: "#f0b13a", shade: "#b87718", center: "#3e2410", deep: "#2a1808", seed: "#3a2818" },
  hydrangea:  { petal: "#b48fd1", shade: "#7150a8", center: "#553e7a", deep: "#2d1a52", seed: "#54462e" },
  azalea:     { petal: "#e0598c", shade: "#9c2a5e", bud: "#fbf3dc", budShade: "#d8c8a8", center: "#fde8d0", deep: "#5a1238", seed: "#5d3a22" },
  lily:       { petal: "#fff5db", shade: "#e8d8b0", center: "#e8b03c", deep: "#a07530", seed: "#2a1f15" },
  amaranthus: { petal: "#dd2876", shade: "#8a1248", hi: "#f06aaa", deep: "#4a0826", seed: "#3a1a1a" },
  cherry:     { petal: "#f8c8d6", shade: "#dc94aa", center: "#e8b03c", deep: "#8a3a4e", bark: "#5a3d28", seed: "#3a2418" },
  wisteria:   { petal: "#a98ed8", shade: "#7654a8", inner: "#cdb8e8", deep: "#3a1f6a", seed: "#4a3e2a" },
  lotus:      { petal: "#fde2e8", shade: "#e8a8b8", inner: "#fbf3dc", center: "#d8b048", deep: "#a04a5a", seed: "#3a2a1a" },
  iris:       { petal: "#6a52c8", shade: "#3a2890", inner: "#9c84e0", beard: "#f0b13a", deep: "#1f1050", seed: "#2a2018" },
  bird:       { petal: "#ed7a28", shade: "#a8480c", tongue: "#2f54b0", inner: "#f5a060", spathe: "#5d7530", deep: "#4a1d0a", seed: "#3a2418" },
  bamboo:     { culm: "#bdc862", shade: "#8a9438", node: "#3d4818", leaf: "#7a8f48", highlight: "#dfe680", deep: "#2c3210", seed: "#5a4a2a" },
  jacaranda:  { petal: "#7a6cc8", shade: "#4a3a98", inner: "#b6acdc", bark: "#5a3d28", deep: "#231552", seed: "#3a2a18" },
  dragon:     { canopy: "#6a8a52", canopyShade: "#3e5a2a", bark: "#8a5a3a", barkShade: "#5a3a1c", sap: "#a82828", deep: "#2a1a08", seed: "#3a1c18" },
  cereus:     { body: "#5a8568", shade: "#2f5238", rib: "#1a2e1f", spine: "#e8d8a0", petal: "#fff5e8", cream: "#fde6c2", center: "#f0c050", stamen: "#caa040", deep: "#142010", seed: "#2a2010" },
};

const STEM      = "var(--fo-accent)";
const LEAF      = "var(--fo-accent)";
const STEM_VEIN = "rgba(0, 0, 0, 0.32)";
const VEIN      = "rgba(0, 0, 0, 0.32)";
const VEIN_LITE = "rgba(0, 0, 0, 0.2)";

/* ──────────────────────────────────────────────────────────────
   primitives
   ────────────────────────────────────────────────────────────── */

function defs(flower, stage) {
  // unique filter id per cell so multiple SVGs don't collide.
  const id = `sun-${flower}-${stage}`;
  return `
    <defs>
      <filter id="${id}" x="-50%" y="-50%" width="200%" height="200%">
        <feDropShadow dx="-1" dy="1.8" stdDeviation="1.2"
                      flood-color="rgba(0, 0, 0, 0.32)"/>
      </filter>
      <filter id="${id}-soft" x="-30%" y="-30%" width="160%" height="160%">
        <feDropShadow dx="-0.6" dy="1" stdDeviation="0.8"
                      flood-color="rgba(0, 0, 0, 0.22)"/>
      </filter>
    </defs>
  `;
}

function sunFilter(flower, stage) {
  return `url(#sun-${flower}-${stage})`;
}
function sunFilterSoft(flower, stage) {
  return `url(#sun-${flower}-${stage}-soft)`;
}

/* ──────────────────────────────────────────────────────────────
   wind / idle sway (SMIL animateTransform — composes correctly
   with parent SVG transforms so children stay attached to their
   stems/origin points)
   ────────────────────────────────────────────────────────────── */

const REDUCED_MOTION =
  typeof window !== "undefined" &&
  window.matchMedia &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let _swayCounter = 0;
function resetSway() { _swayCounter = 0; }

// Wrap `content` in a <g> that rotates around (centerX, centerY) in the
// element's local coord space. Motion is biased toward the right
// (positive rotation = clockwise = top moves right) to read as a
// constant light wind blowing left → right. Each element oscillates
// between (wind − gust) and (wind + gust), with desynced periods so
// no two elements move in lockstep.
function swayWrap(content, { centerX = 0, centerY = 0, wind = 1.6, gust = 1.2, dur = 4 } = {}) {
  if (REDUCED_MOTION) return content;
  _swayCounter++;
  const i = _swayCounter;
  const durJitter = (((i * 137) % 100) / 100 - 0.5) * 1.2;     // ±0.6s
  const phaseFrac = ((i * 277) % 100) / 100;                    //  0..1
  const ampJitter = (((i * 211) % 100) / 100 - 0.5) * 0.3;      // ±0.15°
  const windJitter = (((i * 331) % 100) / 100 - 0.5) * 0.4;     // ±0.2° wind bias
  const finalDur = Math.max(2, dur + durJitter).toFixed(2);
  const finalDelay = (-phaseFrac * dur).toFixed(2);
  const windFinal = wind + windJitter;
  const gustFinal = gust + ampJitter;
  const calmAngle = (windFinal - gustFinal).toFixed(2);
  const gustAngle = (windFinal + gustFinal).toFixed(2);
  return `<g>
    <animateTransform attributeName="transform" type="rotate"
       values="${calmAngle} ${centerX} ${centerY}; ${gustAngle} ${centerX} ${centerY}; ${calmAngle} ${centerX} ${centerY}"
       dur="${finalDur}s" begin="${finalDelay}s"
       repeatCount="indefinite" calcMode="spline"
       keyTimes="0;0.5;1" keySplines="0.42 0 0.58 1;0.42 0 0.58 1"/>
    ${content}
  </g>`;
}

function ground() {
  return `
    <line x1="18" y1="${SOIL_Y}" x2="82" y2="${SOIL_Y}"
          stroke="var(--fo-text-3)" stroke-width="1.1"
          stroke-dasharray="2 3" opacity="0.5"/>
    <circle cx="26" cy="${SOIL_Y + 1.8}" r="0.8" fill="var(--fo-text-3)" opacity="0.55"/>
    <circle cx="38" cy="${SOIL_Y + 1.4}" r="0.65" fill="var(--fo-text-3)" opacity="0.55"/>
    <circle cx="50" cy="${SOIL_Y + 1.9}" r="0.55" fill="var(--fo-text-3)" opacity="0.5"/>
    <circle cx="62" cy="${SOIL_Y + 1.4}" r="0.8" fill="var(--fo-text-3)" opacity="0.55"/>
    <circle cx="74" cy="${SOIL_Y + 1.8}" r="0.65" fill="var(--fo-text-3)" opacity="0.55"/>
  `;
}

function stem(topY, { width = 2.4, curveX = 1.6, startX = STEM_X, sway = false } = {}) {
  const midY = (SOIL_Y + topY) / 2;
  const markup = `
    <path d="M ${startX} ${SOIL_Y} Q ${startX - curveX} ${midY} ${startX} ${topY}"
          fill="none" stroke="${STEM}" stroke-width="${width}" stroke-linecap="round"/>
    <path d="M ${startX} ${SOIL_Y - 2} Q ${startX - curveX} ${midY} ${startX} ${topY + 1}"
          fill="none" stroke="${STEM_VEIN}" stroke-width="${width * 0.35}"
          stroke-linecap="round" opacity="0.55"/>
  `;
  return sway ? swayWrap(markup, { centerX: startX, centerY: SOIL_Y, wind: 1.5, gust: 0.8, dur: 6.5 }) : markup;
}

function leaf({
  anchorX = STEM_X, anchorY, rotate = 0,
  length = 18, width = 6.5, fill = LEAF, opacity = 1,
  veins = true, petiole = 2.5, sway = true,
}) {
  const rad = (rotate * Math.PI) / 180;
  const dx = Math.sin(rad) * petiole;
  const dy = -Math.cos(rad) * petiole;
  const veinMarkup = veins
    ? `
      <path d="M 0 0 L 0 ${-length + 1}" stroke="${VEIN}" stroke-width="0.55"
            stroke-linecap="round" opacity="0.65"/>
      <path d="M 0 ${-length * 0.32} Q ${width * 0.35} ${-length * 0.45} ${width * 0.55} ${-length * 0.5}"
            fill="none" stroke="${VEIN_LITE}" stroke-width="0.4"/>
      <path d="M 0 ${-length * 0.32} Q ${-width * 0.35} ${-length * 0.45} ${-width * 0.55} ${-length * 0.5}"
            fill="none" stroke="${VEIN_LITE}" stroke-width="0.4"/>
      <path d="M 0 ${-length * 0.58} Q ${width * 0.28} ${-length * 0.68} ${width * 0.4} ${-length * 0.72}"
            fill="none" stroke="${VEIN_LITE}" stroke-width="0.35"/>
      <path d="M 0 ${-length * 0.58} Q ${-width * 0.28} ${-length * 0.68} ${-width * 0.4} ${-length * 0.72}"
            fill="none" stroke="${VEIN_LITE}" stroke-width="0.35"/>
    `
    : "";
  const markup = `
    <g transform="translate(${anchorX} ${anchorY})">
      <line x1="0" y1="0" x2="${dx}" y2="${dy}"
            stroke="${fill}" stroke-width="1.2" stroke-linecap="round" opacity="${opacity}"/>
      <g transform="translate(${dx} ${dy}) rotate(${rotate})">
        <path d="M 0 0 C ${width} ${-length * 0.25} ${width * 0.45} ${-length * 0.78} 0 ${-length}
                 C ${-width * 0.45} ${-length * 0.78} ${-width} ${-length * 0.25} 0 0 Z"
              fill="${fill}" opacity="${opacity}"/>
        ${veinMarkup}
      </g>
    </g>
  `;
  return sway ? swayWrap(markup, { centerX: anchorX, centerY: anchorY, wind: 2.2, gust: 1.8, dur: 4.6 }) : markup;
}

function blade({
  anchorX = STEM_X, anchorY, rotate = 0,
  length = 34, width = 4, opacity = 1, vein = true, sway = true,
}) {
  const markup = `
    <g transform="translate(${anchorX} ${anchorY}) rotate(${rotate})">
      <path d="M 0 0 Q ${width * 0.5} ${-length * 0.4} 0 ${-length}
               Q ${-width * 0.5} ${-length * 0.4} 0 0 Z"
            fill="${LEAF}" opacity="${opacity}"/>
      ${vein ? `<path d="M 0 -2 L 0 ${-length + 2}" stroke="${VEIN_LITE}" stroke-width="0.5"/>` : ""}
    </g>
  `;
  return sway ? swayWrap(markup, { centerX: anchorX, centerY: anchorY, wind: 2.4, gust: 1.8, dur: 4.4 }) : markup;
}

function heartLeaf({
  anchorX = STEM_X, anchorY, rotate = 0,
  size = 14, fill = LEAF, opacity = 1, petiole = 3, sway = true,
}) {
  const rad = (rotate * Math.PI) / 180;
  const dx = Math.sin(rad) * petiole;
  const dy = -Math.cos(rad) * petiole;
  const markup = `
    <g transform="translate(${anchorX} ${anchorY})">
      <line x1="0" y1="0" x2="${dx}" y2="${dy}"
            stroke="${fill}" stroke-width="1.4" stroke-linecap="round" opacity="${opacity}"/>
      <g transform="translate(${dx} ${dy}) rotate(${rotate})">
        <path d="M 0 0
                 C ${size * 0.5} ${-size * 0.2} ${size} ${-size * 0.4} ${size} ${-size}
                 C ${size * 0.5} ${-size * 1.4} 0 ${-size * 1.2} 0 ${-size * 0.6}
                 C 0 ${-size * 1.2} ${-size * 0.5} ${-size * 1.4} ${-size} ${-size}
                 C ${-size} ${-size * 0.4} ${-size * 0.5} ${-size * 0.2} 0 0 Z"
              fill="${fill}" opacity="${opacity}"/>
        <path d="M 0 0 L 0 ${-size * 1.1}" stroke="${VEIN}" stroke-width="0.55" opacity="0.6"/>
        <path d="M 0 ${-size * 0.45} Q ${size * 0.4} ${-size * 0.65} ${size * 0.78} ${-size * 0.78}"
              fill="none" stroke="${VEIN_LITE}" stroke-width="0.45"/>
        <path d="M 0 ${-size * 0.45} Q ${-size * 0.4} ${-size * 0.65} ${-size * 0.78} ${-size * 0.78}"
              fill="none" stroke="${VEIN_LITE}" stroke-width="0.45"/>
      </g>
    </g>
  `;
  return sway ? swayWrap(markup, { centerX: anchorX, centerY: anchorY, wind: 1.8, gust: 1.6, dur: 5 }) : markup;
}

/* ──────────────────────────────────────────────────────────────
   species-specific flower-head helpers
   (cherry blossom, wisteria raceme, lotus flower, iris flower)
   ────────────────────────────────────────────────────────────── */

function cherryBud(cx, cy) {
  const s = SKIN.cherry;
  return `<g transform="translate(${cx} ${cy})">
    <ellipse cx="0" cy="-1.8" rx="1.7" ry="2.4" fill="${s.shade}"/>
    <ellipse cx="-0.5" cy="-2.2" rx="1" ry="1.4" fill="${s.petal}" opacity="0.85"/>
    <path d="M -1.4 0 Q -2 1 -2.6 2" stroke="${LEAF}" stroke-width="0.7" stroke-linecap="round" fill="none"/>
    <path d="M 1.4 0 Q 2 1 2.6 2" stroke="${LEAF}" stroke-width="0.7" stroke-linecap="round" fill="none"/>
  </g>`;
}

function cherryBlossom(cx, cy, scale = 1) {
  const s = SKIN.cherry;
  const petals = [];
  for (let i = 0; i < 5; i++) {
    petals.push(
      `<ellipse cx="0" cy="-2.6" rx="1.7" ry="2.5" fill="${s.petal}" stroke="${s.deep}" stroke-width="0.25" transform="rotate(${72 * i})"/>`
    );
  }
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
    ${petals.join("")}
    <circle cx="0" cy="0" r="0.85" fill="${s.center}"/>
    <circle cx="-0.5" cy="-0.3" r="0.4" fill="${s.deep}" opacity="0.55"/>
  </g>`;
}

function wisteriaRaceme(cx, cy, length) {
  // Hanging teardrop cluster: small purple flowers stacked vertically,
  // widening at the top and tapering to a point at the bottom.
  const s = SKIN.wisteria;
  const segments = Math.max(6, Math.floor(length / 2.4));
  let parts = "";
  // base attachment nub (green) at the top of the raceme
  parts += `<ellipse cx="${cx}" cy="${cy - 1}" rx="2.4" ry="1.4" fill="${LEAF}"/>`;
  for (let i = 0; i < segments; i++) {
    const t = i / Math.max(segments - 1, 1);
    const y = cy + i * 2.4;
    const w = 1 - t * 0.85;                       // width tapers
    const xJit = Math.sin(i * 1.6) * 2.5 * w;
    const x = cx + xJit;
    const r = (1.5 + w * 0.8).toFixed(2);
    const ry = (Number(r) * 0.85).toFixed(2);
    const opacity = (0.72 + w * 0.28).toFixed(2);
    const fill = i % 3 === 0 ? s.shade : s.petal;
    parts += `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="${r}" ry="${ry}" fill="${fill}" stroke="${s.deep}" stroke-width="0.22" opacity="${opacity}"/>`;
    if (i % 2 === 0 && w > 0.35) {
      parts += `<ellipse cx="${(x - 0.5).toFixed(1)}" cy="${(y - 0.4).toFixed(1)}" rx="${(Number(r) * 0.4).toFixed(2)}" ry="${(Number(r) * 0.3).toFixed(2)}" fill="${s.inner}" opacity="0.7"/>`;
    }
  }
  // tiny bud tip at the bottom point
  parts += `<circle cx="${cx.toFixed(1)}" cy="${(cy + length + 1).toFixed(1)}" r="0.7" fill="${s.shade}"/>`;
  return parts;
}

function lotusFlower(cx, cy, scale = 1) {
  // Open lotus: many pointed petals in two rings + yellow seed-pod center.
  const s = SKIN.lotus;
  const outerN = 8;
  const innerN = 6;
  const outerPetals = [];
  const innerPetals = [];
  for (let i = 0; i < outerN; i++) {
    const a = (360 / outerN) * i;
    outerPetals.push(`
      <g transform="rotate(${a})">
        <path d="M 0 0 C 3 -5 3 -16 0 -22 C -3 -16 -3 -5 0 0 Z"
              fill="${s.petal}" stroke="${s.deep}" stroke-width="0.35"/>
      </g>
    `);
  }
  for (let i = 0; i < innerN; i++) {
    const a = (360 / innerN) * i + 30;
    innerPetals.push(`
      <g transform="rotate(${a})">
        <path d="M 0 0 C 2.2 -4 2.2 -12 0 -16 C -2.2 -12 -2.2 -4 0 0 Z"
              fill="${s.inner}" stroke="${s.deep}" stroke-width="0.3"/>
      </g>
    `);
  }
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
    ${outerPetals.join("")}
    ${innerPetals.join("")}
    <circle cx="0" cy="0" r="3" fill="${s.center}"/>
    <!-- seed pod dots -->
    <circle cx="-1" cy="-0.5" r="0.5" fill="${s.deep}" opacity="0.6"/>
    <circle cx="1" cy="0.5" r="0.5" fill="${s.deep}" opacity="0.6"/>
    <circle cx="0" cy="1.2" r="0.5" fill="${s.deep}" opacity="0.6"/>
    <circle cx="0.8" cy="-1.2" r="0.45" fill="${s.deep}" opacity="0.55"/>
  </g>`;
}

function lotusPad(cx, cy, scale = 1) {
  // Big round lily-pad leaf with a notch and radial veins.
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
    <path d="M 0 0 A 11 9 0 1 1 -1 -0.3 L 0 0 Z" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.3"/>
    <!-- veins fanning out -->
    <path d="M 0 0 L 8 -4 M 0 0 L 9 0 M 0 0 L 7 4 M 0 0 L 2 -7 M 0 0 L -5 -6 M 0 0 L -9 -2 M 0 0 L -8 3 M 0 0 L -3 6"
          stroke="${VEIN_LITE}" stroke-width="0.4" fill="none" opacity="0.6"/>
  </g>`;
}

function irisFlower(cx, cy, scale = 1) {
  // Iris with 3 upright "standards" (top petals) + 3 drooping "falls"
  // (bottom petals with yellow beard).
  const s = SKIN.iris;
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
    <!-- falls (drooping, drawn first / in back) -->
    <path d="M 0 0 C -8 4 -10 14 -7 18 C -3 16 -2 8 0 0 Z"
          fill="${s.petal}" stroke="${s.deep}" stroke-width="0.45"/>
    <path d="M 0 0 C 8 4 10 14 7 18 C 3 16 2 8 0 0 Z"
          fill="${s.petal}" stroke="${s.deep}" stroke-width="0.45"/>
    <path d="M 0 0 C -3 6 -3 16 0 18 C 3 16 3 6 0 0 Z"
          fill="${s.shade}" stroke="${s.deep}" stroke-width="0.45"/>
    <!-- yellow beard on the falls -->
    <ellipse cx="-4" cy="9" rx="1" ry="3.2" fill="${s.beard}" transform="rotate(-22 -4 9)"/>
    <ellipse cx="4" cy="9" rx="1" ry="3.2" fill="${s.beard}" transform="rotate(22 4 9)"/>
    <ellipse cx="0" cy="9" rx="1" ry="3.2" fill="${s.beard}"/>
    <!-- standards (upright top petals) -->
    <path d="M 0 0 C -5 -5 -7 -14 -4 -17 C -1 -16 -1 -8 0 0 Z"
          fill="${s.inner}" stroke="${s.deep}" stroke-width="0.45"/>
    <path d="M 0 0 C 5 -5 7 -14 4 -17 C 1 -16 1 -8 0 0 Z"
          fill="${s.inner}" stroke="${s.deep}" stroke-width="0.45"/>
    <path d="M 0 0 C -2 -6 -1 -16 0 -18 C 1 -16 2 -6 0 0 Z"
          fill="${s.petal}" stroke="${s.deep}" stroke-width="0.4"/>
    <!-- center -->
    <circle cx="0" cy="0" r="1.4" fill="${s.deep}"/>
  </g>`;
}

function birdOfParadiseFlower(cx, cy, scale = 1) {
  // Bird-of-paradise bloom modeled after the reference photo.
  //   • Bloom origin (0,0) sits at the BASE of the spathe — where it
  //     meets the stem coming up from below. Caller positions the
  //     translate so origin coincides with the stem top.
  //   • Spathe is a long pointed pod extending up + to the right.
  //   • Three flame-shaped orange sepals shoot upward from the slit
  //     in the spathe top (the "crest" of the bird).
  //   • A long narrow blue tongue juts forward from the same slit
  //     (the bird's "beak").
  //   • A small dark unopened bud peeks between sepals for naturalism.
  const s = SKIN.bird;
  const rusty = "#9a3a28"; // red-purple underside of the spathe
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
    <!-- ── stem-into-spathe seal: small green collar so the bloom
         doesn't appear to float above the stem ── -->
    <ellipse cx="-1" cy="0.5" rx="3" ry="3.4" fill="${STEM}" opacity="0.9"/>
    <ellipse cx="-1" cy="0.5" rx="3" ry="3.4" fill="${s.deep}" opacity="0.3"/>

    <!-- ── SPATHE: elongated pod, base at left, tip at the right ── -->
    <!-- red-purple underside (draws first, behind) -->
    <path d="M -3 1 Q 0 3 12 5 Q 22 5 28 2 Q 22 4 12 6 Q 0 6 -3 4 Z"
          fill="${rusty}" stroke="${s.deep}" stroke-width="0.45"/>
    <!-- green top of spathe -->
    <path d="M -3 1 Q -2 -3 6 -4 Q 18 -3 26 -1 Q 28 1 28 2 Q 22 1 12 0 Q 0 0 -3 1 Z"
          fill="${s.spathe}" stroke="${s.deep}" stroke-width="0.45"/>
    <!-- spathe pointed tip -->
    <path d="M 26 -1 L 32 2 L 26 4 Z"
          fill="${s.spathe}" stroke="${s.deep}" stroke-width="0.45"/>
    <!-- spathe vein -->
    <path d="M 0 -1 Q 8 -2 22 0" stroke="${s.deep}" stroke-width="0.3" fill="none" opacity="0.6"/>

    <!-- ── BLUE TONGUE: a long narrow stripe sticking forward ── -->
    <!-- (drawn before sepals so the sepals overlap it at the base) -->
    <path d="M 3 -1 Q 12 1 24 4 L 25 5 Q 13 4 4 1 Z"
          fill="${s.tongue}" stroke="${s.deep}" stroke-width="0.45"/>
    <!-- darker center stripe along the tongue -->
    <path d="M 5 0 Q 14 2 23 4"
          stroke="${s.deep}" stroke-width="0.65" opacity="0.65" fill="none"/>
    <!-- subtle highlight along the upper edge -->
    <path d="M 5 -0.6 Q 14 1.3 22 3.6"
          stroke="#5d80dc" stroke-width="0.3" opacity="0.65" fill="none"/>

    <!-- ── ORANGE SEPALS: 3 long flames + 1 small dark bud ── -->
    <!-- back sepal (leans slightly back-left) -->
    <path d="M 0 -3
             Q -3 -12 -2 -22
             Q 0 -26 2 -24
             Q 3 -14 3 -4 Z"
          fill="${s.petal}" stroke="${s.deep}" stroke-width="0.45"/>
    <!-- middle sepal (tallest, central) -->
    <path d="M 4 -3
             Q 5 -14 7 -26
             Q 9 -29 11 -27
             Q 10 -16 8 -4 Z"
          fill="${s.inner}" stroke="${s.deep}" stroke-width="0.45"/>
    <!-- small dark unopened bud nested between -->
    <path d="M 3.4 -3.6 Q 2.6 -10 3.4 -14 Q 4.4 -10 4.4 -3.6 Z"
          fill="${s.deep}" opacity="0.85"/>
    <!-- front sepal (leans forward-right) -->
    <path d="M 9 -2
             Q 11 -12 14 -20
             Q 17 -22 18 -20
             Q 16 -12 13 -3 Z"
          fill="${s.petal}" stroke="${s.deep}" stroke-width="0.45"/>
    <!-- tiny secondary front bud -->
    <path d="M 11 -3 Q 12 -7 13 -10 Q 13 -6 13 -3 Z"
          fill="${s.deep}" opacity="0.7"/>
  </g>`;
}

function bambooStalk(x, baseY, height, segments = 5, thickness = 3) {
  const s = SKIN.bamboo;
  const top = baseY - height;
  const segHeight = height / segments;
  let parts = "";
  // main culm
  parts += `<path d="M ${x} ${baseY} L ${x} ${top}"
                   stroke="${s.culm}" stroke-width="${thickness}" stroke-linecap="round"/>`;
  // inner highlight (yellower stripe down one side)
  parts += `<path d="M ${x - thickness * 0.3} ${baseY - 2} L ${x - thickness * 0.3} ${top + 2}"
                   stroke="${s.highlight}" stroke-width="${thickness * 0.35}" stroke-linecap="round" opacity="0.6"/>`;
  // node rings
  for (let i = 1; i < segments; i++) {
    const ny = baseY - i * segHeight;
    parts += `<ellipse cx="${x}" cy="${ny.toFixed(1)}" rx="${(thickness * 0.85).toFixed(2)}" ry="0.9" fill="${s.node}"/>`;
    parts += `<line x1="${(x - thickness * 0.5).toFixed(1)}" y1="${(ny - 1.2).toFixed(1)}" x2="${(x + thickness * 0.5).toFixed(1)}" y2="${(ny - 1.2).toFixed(1)}" stroke="${s.shade}" stroke-width="0.5"/>`;
  }
  // leaf cluster at top
  parts += `<g transform="translate(${x} ${top + 2})">
    <path d="M 0 0 L -7 -10 L -2 -7 Z" fill="${s.leaf}" stroke="${s.deep}" stroke-width="0.3"/>
    <path d="M 0 0 L 7 -10 L 2 -7 Z" fill="${s.leaf}" stroke="${s.deep}" stroke-width="0.3"/>
    <path d="M 0 0 L -3 -12 L 0 -9 Z" fill="${s.leaf}" stroke="${s.deep}" stroke-width="0.3"/>
    <path d="M 0 0 L 3 -12 L 0 -9 Z" fill="${s.leaf}" stroke="${s.deep}" stroke-width="0.3" opacity="0.92"/>
  </g>`;
  return parts;
}

function jacarandaTrumpet(cx, cy, scale = 1, rot = 0) {
  // Tiny trumpet flower hanging down (campanulate).
  const s = SKIN.jacaranda;
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) rotate(${rot})">
    <path d="M 0 0 C -2.8 -1.5 -3.2 -5 -1.6 -7 L 1.6 -7 C 3.2 -5 2.8 -1.5 0 0 Z"
          fill="${s.petal}" stroke="${s.deep}" stroke-width="0.3"/>
    <path d="M -1.6 -7 Q 0 -8 1.6 -7" fill="${s.inner}" stroke="${s.deep}" stroke-width="0.3"/>
    <ellipse cx="0" cy="-1.2" rx="1.4" ry="0.5" fill="${s.deep}" opacity="0.5"/>
  </g>`;
}

function jacarandaCluster(cx, cy, scale = 1) {
  // Cluster of 4-6 trumpet flowers + a couple buds hanging in a small group.
  const s = SKIN.jacaranda;
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
    ${jacarandaTrumpet(-3, 0, 1, -8)}
    ${jacarandaTrumpet(3, 0, 0.95, 8)}
    ${jacarandaTrumpet(0, -1.6, 1, 0)}
    ${jacarandaTrumpet(-5, -3, 0.85, -16)}
    ${jacarandaTrumpet(5, -3, 0.85, 16)}
    <circle cx="-1" cy="-5" r="0.9" fill="${s.shade}"/>
    <circle cx="2" cy="-5.5" r="0.8" fill="${s.shade}" opacity="0.85"/>
  </g>`;
}

function cereusColumn(cx, baseY, topY, halfW) {
  // Slender ribbed Cereus column with prominent vertical ribs and
  // spine clusters along each rib seam.
  const s = SKIN.cereus;
  const ribCount = 5;
  let parts = "";
  // Main body fill with rounded top
  parts += `<path d="M ${cx - halfW} ${baseY}
                     L ${cx - halfW} ${topY + halfW * 1.2}
                     Q ${cx - halfW} ${topY} ${cx} ${topY}
                     Q ${cx + halfW} ${topY} ${cx + halfW} ${topY + halfW * 1.2}
                     L ${cx + halfW} ${baseY} Z"
                   fill="${s.body}" stroke="${s.deep}" stroke-width="0.55"/>`;
  // Vertical ribs (lighter highlight on right side, darker grooves between)
  const ribSpacing = (halfW * 2) / (ribCount + 1);
  for (let i = 0; i < ribCount; i++) {
    const x = cx - halfW + ribSpacing * (i + 1);
    parts += `<path d="M ${x.toFixed(2)} ${baseY - 2} L ${x.toFixed(2)} ${topY + halfW * 0.4}"
                       stroke="${s.rib}" stroke-width="0.6" opacity="0.78"/>`;
  }
  // Spine clusters along the side ribs (small horizontal hairs)
  const stepY = 6;
  for (let y = baseY - 8; y >= topY + halfW * 1.4; y -= stepY) {
    parts += `<line x1="${cx - halfW - 1}" y1="${y}" x2="${cx - halfW + 0.6}" y2="${y}" stroke="${s.spine}" stroke-width="0.55"/>`;
    parts += `<line x1="${cx + halfW - 0.6}" y1="${y}" x2="${cx + halfW + 1}" y2="${y}" stroke="${s.spine}" stroke-width="0.55"/>`;
    // tiny center spine tufts
    parts += `<circle cx="${cx}" cy="${y}" r="0.32" fill="${s.spine}" opacity="0.7"/>`;
  }
  return parts;
}

function cereusFlower(cx, cy, scale = 1) {
  // Large white night-blooming flower — many narrow pointed petals
  // radiating outward, inner ring of creamier petals, yellow stamens
  // in the center.
  const s = SKIN.cereus;
  const outerN = 14;
  const innerN = 8;
  const outer = [];
  for (let i = 0; i < outerN; i++) {
    const a = (360 / outerN) * i;
    outer.push(`
      <g transform="rotate(${a})">
        <path d="M 0 -2 C 2 -10 2 -20 0 -23 C -2 -20 -2 -10 0 -2 Z"
              fill="${s.petal}" stroke="${s.deep}" stroke-width="0.3" opacity="${i % 2 === 0 ? 1 : 0.93}"/>
        <path d="M 0 -3 L 0 -22" stroke="${s.cream}" stroke-width="0.3" opacity="0.6"/>
      </g>
    `);
  }
  const inner = [];
  for (let i = 0; i < innerN; i++) {
    const a = (360 / innerN) * i + 22;
    inner.push(`
      <g transform="rotate(${a})">
        <path d="M 0 -1 C 1.6 -7 1.6 -15 0 -17 C -1.6 -15 -1.6 -7 0 -1 Z"
              fill="${s.cream}" stroke="${s.deep}" stroke-width="0.3"/>
      </g>
    `);
  }
  // Yellow stamen filaments fanning around the center
  const stamens = [];
  for (let i = 0; i < 14; i++) {
    const a = (360 / 14) * i;
    stamens.push(`<g transform="rotate(${a})">
      <path d="M 0 0 L 0 -6" stroke="${s.stamen}" stroke-width="0.45" stroke-linecap="round"/>
      <circle cx="0" cy="-6" r="0.5" fill="${s.center}"/>
    </g>`);
  }
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">
    ${outer.join("")}
    ${inner.join("")}
    ${stamens.join("")}
    <circle r="2.8" fill="${s.center}"/>
    <circle r="1.6" fill="#fde8a0"/>
    <circle cx="-0.5" cy="-0.5" r="0.6" fill="#fff5d8" opacity="0.6"/>
  </g>`;
}

function sequoiaBoughs(cx, baseY, height, scale = 1) {
  // Smooth conical canopy with serrated edges suggesting layered
  // branches. Reads as a single tall fir/sequoia silhouette rather
  // than a stack of zigzagging triangles.
  const s = SKIN.sequoia;
  const baseW = 22 * scale;
  // 6 horizontal "shelves" stepping in toward the top — each shelf
  // is slightly narrower than the one below, creating the layered
  // cone silhouette.
  const layers = 6;
  let leftSide = "";
  let rightSide = "";
  for (let i = 0; i <= layers; i++) {
    const t = i / layers;
    const y = baseY - t * height;
    const w = (baseW * (1 - t * 0.92)) / 2;
    const dy = height / (layers * 2);
    // step out and back in: creates the saw-tooth branch shelf
    if (i === 0) {
      leftSide += ` M ${(cx - w).toFixed(1)} ${y.toFixed(1)}`;
      rightSide = ` L ${(cx + w).toFixed(1)} ${y.toFixed(1)}` + rightSide;
    } else {
      // small bump out before stepping in
      const stepX = (w + 1.6).toFixed(1);
      const stepY = (y + dy * 0.6).toFixed(1);
      leftSide += ` L ${cx - stepX} ${stepY}`;
      leftSide += ` L ${(cx - w).toFixed(1)} ${y.toFixed(1)}`;
      rightSide = ` L ${(cx + w).toFixed(1)} ${y.toFixed(1)}` + ` L ${cx + stepX} ${stepY}` + rightSide;
    }
  }
  // apex
  const apexX = cx;
  const apexY = (baseY - height).toFixed(1);
  const path = leftSide + ` L ${apexX} ${apexY}` + rightSide + " Z";

  // internal "branch shelf" lines for depth
  let shelves = "";
  for (let i = 1; i < layers; i++) {
    const t = i / layers;
    const y = baseY - t * height;
    const w = (baseW * (1 - t * 0.92)) / 2;
    shelves += `<path d="M ${(cx - w * 0.78).toFixed(1)} ${y.toFixed(1)} Q ${cx} ${(y + 1.2).toFixed(1)} ${(cx + w * 0.78).toFixed(1)} ${y.toFixed(1)}"
                       stroke="${s.deep}" stroke-width="0.4" fill="none" opacity="0.55"/>`;
    shelves += `<path d="M ${(cx - w * 0.55).toFixed(1)} ${(y - 1).toFixed(1)} Q ${cx} ${(y + 0.4).toFixed(1)} ${(cx + w * 0.55).toFixed(1)} ${(y - 1).toFixed(1)}"
                       stroke="${s.needleHi}" stroke-width="0.4" fill="none" opacity="0.55"/>`;
  }

  return `<path d="${path}" fill="${s.needle}" stroke="${s.deep}" stroke-width="0.55"/>${shelves}`;
}

function dragonCanopy(cx, cy, scale = 1) {
  // Distinctive umbrella/parasol — many small branches splaying out from
  // a central crown, each ending in a tuft of spiky leaves. Forms the
  // flat-topped silhouette this species is known for.
  const s = SKIN.dragon;
  let parts = "";
  const tufts = 9;
  for (let i = 0; i < tufts; i++) {
    const t = i / (tufts - 1);
    const angle = -65 + t * 130; // -65° to +65° fan
    const rad = (angle * Math.PI) / 180;
    const len = 14 + Math.sin(i * 1.3) * 3;
    const tipX = Math.sin(rad) * len * scale;
    const tipY = -Math.cos(rad) * len * scale * 0.55; // flatter umbrella
    const dim = 0.8 + Math.cos(i) * 0.2;
    // small branch
    parts += `<path d="M 0 0 L ${tipX.toFixed(1)} ${tipY.toFixed(1)}"
                     stroke="${s.bark}" stroke-width="${(1.5 * scale).toFixed(2)}"
                     stroke-linecap="round"/>`;
    // spiky leaf tuft at the tip
    parts += `<g transform="translate(${tipX.toFixed(1)} ${tipY.toFixed(1)}) rotate(${angle})">
      <path d="M 0 0 L -3.2 -5 M 0 0 L -1.6 -6 M 0 0 L 0 -7 M 0 0 L 1.6 -6 M 0 0 L 3.2 -5"
            stroke="${i % 2 === 0 ? s.canopy : s.canopyShade}" stroke-width="${(1 * dim).toFixed(2)}"
            stroke-linecap="round" fill="none"/>
    </g>`;
  }
  return `<g transform="translate(${cx} ${cy}) scale(${scale})">${parts}</g>`;
}

function growingTip(flower, x, y) {
  const s = SKIN[flower];
  switch (flower) {
    case "tulip":
      return `
        <g transform="translate(${x} ${y - 1})">
          <path d="M 0 0 C -3 -1.5 -3 -7 0 -8 C 3 -7 3 -1.5 0 0 Z"
                fill="${LEAF}" opacity="0.95"/>
          <path d="M 0 -8 L 0 -1" stroke="${STEM_VEIN}" stroke-width="0.4" opacity="0.55"/>
        </g>`;
    case "daisy":
      return `
        <g transform="translate(${x} ${y - 2})">
          <circle cx="0" cy="0" r="2.2" fill="${LEAF}"/>
          <path d="M 0 -2 L 0 2" stroke="${STEM_VEIN}" stroke-width="0.4" opacity="0.5"/>
        </g>`;
    case "sunflower":
      return `
        <g transform="translate(${x} ${y - 2.5})">
          <ellipse cx="0" cy="0" rx="3.4" ry="2.6" fill="${LEAF}"/>
          <path d="M -3 -0.5 Q -4.5 -3 -3 -4 M 3 -0.5 Q 4.5 -3 3 -4 M 0 -2.6 Q 0 -5 -1.2 -5.6 M 0 -2.6 Q 0 -5 1.2 -5.6"
                stroke="${LEAF}" stroke-width="0.9" stroke-linecap="round" fill="none"/>
          <ellipse cx="0" cy="0" rx="2.2" ry="1.6" fill="${STEM_VEIN}" opacity="0.35"/>
        </g>`;
    case "hydrangea":
      return `
        <g transform="translate(${x} ${y - 1})">
          <circle cx="-2.4" cy="-1.4" r="1.6" fill="${LEAF}"/>
          <circle cx="2.4" cy="-1.4" r="1.6" fill="${LEAF}" opacity="0.95"/>
          <circle cx="0" cy="-3.4" r="1.6" fill="${LEAF}"/>
          <circle cx="0" cy="-0.4" r="1.4" fill="${LEAF}" opacity="0.88"/>
          <circle cx="0" cy="-1.8" r="0.6" fill="${STEM_VEIN}" opacity="0.4"/>
        </g>`;
    case "azalea":
      return `
        <g transform="translate(${x} ${y})">
          <circle cx="0" cy="-1.5" r="1.8" fill="${LEAF}"/>
          <path d="M -1.2 -1.5 Q -2 0 -2.4 1.5" stroke="${STEM}" stroke-width="0.7" stroke-linecap="round" fill="none"/>
          <path d="M 1.2 -1.5 Q 2 0 2.4 1.5" stroke="${STEM}" stroke-width="0.7" stroke-linecap="round" fill="none"/>
        </g>`;
    case "lily":
      return `
        <g transform="translate(${x} ${y})">
          <path d="M 0 -7 L -1.6 0 L 1.6 0 Z" fill="${LEAF}"/>
          <path d="M 0 -7 L 0 0" stroke="${STEM_VEIN}" stroke-width="0.4" opacity="0.6"/>
        </g>`;
    case "amaranthus":
      return `
        <g transform="translate(${x} ${y - 2})">
          <ellipse cx="0" cy="0" rx="2.2" ry="2.6" fill="${s.shade}" opacity="0.85"/>
          <ellipse cx="-0.6" cy="-0.6" rx="1.6" ry="2" fill="${s.petal}" opacity="0.85"/>
          <circle cx="-1.2" cy="-1.8" r="0.4" fill="${s.hi}"/>
          <circle cx="1.2" cy="-0.8" r="0.4" fill="${s.hi}"/>
          <circle cx="0" cy="1.4" r="0.4" fill="${s.hi}"/>
        </g>`;
    case "cherry":
      return `
        <g transform="translate(${x} ${y - 1})">
          <circle cx="-1.6" cy="-1.4" r="1.2" fill="${s.shade}"/>
          <circle cx="1.6" cy="-1.4" r="1.2" fill="${s.shade}"/>
          <circle cx="0" cy="-3" r="1.4" fill="${s.shade}"/>
          <circle cx="0" cy="-3" r="0.7" fill="${s.petal}" opacity="0.85"/>
          <circle cx="-1.6" cy="-1.4" r="0.55" fill="${s.petal}" opacity="0.85"/>
          <circle cx="1.6" cy="-1.4" r="0.55" fill="${s.petal}" opacity="0.85"/>
        </g>`;
    case "wisteria":
      return `
        <g transform="translate(${x} ${y - 1})">
          <ellipse cx="0" cy="-2" rx="2" ry="3" fill="${LEAF}"/>
          <ellipse cx="-0.6" cy="-1.2" rx="1.2" ry="1.8" fill="${s.petal}" opacity="0.55"/>
          <circle cx="-1.2" cy="0.6" r="0.5" fill="${s.shade}" opacity="0.7"/>
          <circle cx="1.2" cy="1" r="0.5" fill="${s.shade}" opacity="0.7"/>
        </g>`;
    case "lotus":
      return `
        <g transform="translate(${x} ${y})">
          <path d="M 0 -6 C -2 -4 -2 -1 0 0 C 2 -1 2 -4 0 -6 Z" fill="${LEAF}"/>
          <path d="M 0 -6 L 0 -1" stroke="${STEM_VEIN}" stroke-width="0.4" opacity="0.55"/>
        </g>`;
    case "iris":
      return `
        <g transform="translate(${x} ${y})">
          <path d="M 0 -7 C -1.6 -5 -1.4 -1 0 0 C 1.4 -1 1.6 -5 0 -7 Z" fill="${LEAF}"/>
          <path d="M 0 -7 L 0 -0.5" stroke="${STEM_VEIN}" stroke-width="0.4" opacity="0.55"/>
        </g>`;
    case "bird":
      // horizontal "boat" hint with a tiny orange peek
      return `
        <g transform="translate(${x} ${y})">
          <path d="M -3 -1 Q 0 -3 3 -1 Q 1.5 0.4 -1.5 0.4 Q -3 0 -3 -1 Z" fill="${LEAF}"/>
          <path d="M 0 -1 L -1 -5" stroke="${s.petal}" stroke-width="0.8" stroke-linecap="round"/>
          <path d="M 0 -1 L 1.5 -5" stroke="${s.petal}" stroke-width="0.8" stroke-linecap="round"/>
        </g>`;
    case "bamboo":
      // small leafy crown atop the culm
      return `
        <g transform="translate(${x} ${y})">
          <path d="M 0 -1 L -4 -7 L -1 -7 Z" fill="${SKIN.bamboo.leaf}"/>
          <path d="M 0 -1 L 4 -7 L 1 -7 Z" fill="${SKIN.bamboo.leaf}"/>
          <path d="M 0 -1 L 0 -9 L -1 -7 Z" fill="${SKIN.bamboo.leaf}"/>
        </g>`;
    case "jacaranda":
      // tiny purple bud cluster
      return `
        <g transform="translate(${x} ${y - 1})">
          <circle cx="0" cy="-2" r="1.6" fill="${LEAF}"/>
          <circle cx="-0.4" cy="-2.4" r="1" fill="${s.petal}" opacity="0.65"/>
          <circle cx="0.6" cy="-1.4" r="0.5" fill="${s.shade}"/>
        </g>`;
    case "dragon":
      // small spiky leaf cluster (first dracaena rosette)
      return `
        <g transform="translate(${x} ${y})">
          <path d="M 0 0 L -4 -6 M 0 0 L -2 -7 M 0 0 L 0 -8 M 0 0 L 2 -7 M 0 0 L 4 -6"
                stroke="${SKIN.dragon.canopy}" stroke-width="0.9" stroke-linecap="round" fill="none"/>
        </g>`;
    case "cereus":
      // small ribbed bluish-green sprout column
      return `
        <g transform="translate(${x} ${y - 1})">
          <path d="M -2.4 1 L -2.4 -5 Q -2.4 -7 0 -7 Q 2.4 -7 2.4 -5 L 2.4 1 Z"
                fill="${SKIN.cereus.body}" stroke="${SKIN.cereus.deep}" stroke-width="0.4"/>
          <path d="M -1.2 0 L -1.2 -5 M 1.2 0 L 1.2 -5"
                stroke="${SKIN.cereus.rib}" stroke-width="0.4" opacity="0.7"/>
          <path d="M 0 -7 L 0 -8.5" stroke="${SKIN.cereus.spine}" stroke-width="0.5" stroke-linecap="round"/>
        </g>`;
  }
  return "";
}

/* ──────────────────────────────────────────────────────────────
   stage 1 — seed
   ────────────────────────────────────────────────────────────── */

function stage1(flower) {
  const s = SKIN[flower];
  if (flower === "sunflower") {
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 4}) rotate(22)">
        <ellipse cx="0" cy="0" rx="5" ry="8.4" fill="${s.seed}"/>
        <path d="M 0 -7 L 0 6.5" stroke="#c4a47a" stroke-width="0.7" opacity="0.8"/>
        <path d="M -2.7 -6 L -2.7 5" stroke="#c4a47a" stroke-width="0.6" opacity="0.7"/>
        <path d="M 2.7 -6 L 2.7 5" stroke="#c4a47a" stroke-width="0.6" opacity="0.7"/>
        <path d="M 0 -8.4 L -1.3 -7 M 0 -8.4 L 1.3 -7"
              stroke="${s.seed}" stroke-width="1" stroke-linecap="round"/>
        <ellipse cx="0" cy="0" rx="1.4" ry="3" fill="rgba(0,0,0,0.18)"/>
      </g>`;
  }
  if (flower === "lily") {
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 3})">
        <ellipse cx="0" cy="0" rx="6.5" ry="2.6" fill="${s.seed}"/>
        <ellipse cx="-1.8" cy="-0.6" rx="3.8" ry="1.5" fill="${s.seed}" opacity="0.65"/>
        <path d="M -6 0 L 6 0" stroke="rgba(0,0,0,0.25)" stroke-width="0.5" opacity="0.6"/>
      </g>`;
  }
  if (flower === "amaranthus") {
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 2.5})">
        <circle cx="0" cy="0" r="2" fill="${s.seed}"/>
        <circle cx="-3.8" cy="0.4" r="1.4" fill="${s.seed}" opacity="0.85"/>
        <circle cx="3.8" cy="-0.3" r="1.3" fill="${s.seed}" opacity="0.85"/>
        <circle cx="0" cy="-0.6" r="0.6" fill="rgba(255,255,255,0.18)"/>
      </g>`;
  }
  if (flower === "cherry") {
    // cherry pit — rounded with a small stem nub
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 4})">
        <ellipse cx="0" cy="0" rx="4" ry="5" fill="${s.seed}"/>
        <ellipse cx="-1.2" cy="-1.4" rx="1.4" ry="2" fill="rgba(255,255,255,0.16)"/>
        <path d="M 0 -5 Q -1 -7 -2 -8" stroke="${s.bark}" stroke-width="1" fill="none" stroke-linecap="round"/>
        <ellipse cx="-2" cy="-8" rx="0.8" ry="0.6" fill="${s.shade}"/>
      </g>`;
  }
  if (flower === "lotus") {
    // lotus seed — distinctive elongated pod with flat top
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 3})">
        <ellipse cx="0" cy="0" rx="3.6" ry="5.6" fill="${s.seed}"/>
        <ellipse cx="-1" cy="-1.4" rx="1.2" ry="2.2" fill="rgba(255,255,255,0.16)"/>
        <ellipse cx="0" cy="3" rx="2.6" ry="0.7" fill="${s.deep}" opacity="0.7"/>
        <circle cx="0" cy="0" r="0.6" fill="${s.deep}" opacity="0.55"/>
      </g>`;
  }
  if (flower === "bird") {
    // bird-of-paradise seed — dark with orange aril (signature feature)
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 3.5})">
        <ellipse cx="0" cy="0" rx="3" ry="4.4" fill="${s.seed}" transform="rotate(14)"/>
        <ellipse cx="-0.8" cy="-1.4" rx="1" ry="1.6" fill="rgba(255,255,255,0.15)"/>
        <path d="M 1.4 -2.4 Q 3 -1 2.6 1" fill="${s.petal}" stroke="${s.deep}" stroke-width="0.3"/>
      </g>`;
  }
  if (flower === "bamboo") {
    // bamboo seed — slender pale grain
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 3.5})">
        <ellipse cx="0" cy="0" rx="1.6" ry="4.6" fill="${s.seed}" transform="rotate(12)"/>
        <ellipse cx="-0.4" cy="-1" rx="0.7" ry="2" fill="${s.highlight}" opacity="0.5"/>
        <path d="M 0 -4 L 0 3" stroke="${s.deep}" stroke-width="0.3" opacity="0.55"/>
      </g>`;
  }
  if (flower === "cereus") {
    // small dark cereus seed with a slight greenish peek
    return `
      <g transform="translate(${STEM_X} ${SOIL_Y - 3})">
        <ellipse cx="0" cy="0" rx="3" ry="3.6" fill="${s.seed}"/>
        <ellipse cx="-0.8" cy="-1" rx="1" ry="1.4" fill="rgba(255,255,255,0.15)"/>
        <path d="M -0.4 -3 Q 0.4 -4 1.2 -3.2" stroke="${s.body}" stroke-width="0.6" fill="none" stroke-linecap="round"/>
      </g>`;
  }
  const cfg = {
    tulip:     { rx: 4.0, ry: 6.2, rot: 18 },
    daisy:     { rx: 2.8, ry: 4.6, rot: 26 },
    hydrangea: { rx: 3.0, ry: 4.4, rot: 10 },
    azalea:    { rx: 2.4, ry: 3.6, rot: 14 },
    wisteria:  { rx: 3.0, ry: 4.6, rot: 14 },
    iris:      { rx: 2.6, ry: 4.2, rot: 22 },
    jacaranda: { rx: 3.0, ry: 4.4, rot: 16 },
    dragon:    { rx: 2.6, ry: 3.8, rot: 8 },
  }[flower];
  return `
    <ellipse cx="${STEM_X}" cy="${SOIL_Y - 3.5}" rx="${cfg.rx}" ry="${cfg.ry}"
             fill="${s.seed}" transform="rotate(${cfg.rot} ${STEM_X} ${SOIL_Y - 3.5})"/>
    <ellipse cx="${STEM_X - 0.8}" cy="${SOIL_Y - 4.2}" rx="${cfg.rx * 0.35}" ry="${cfg.ry * 0.4}"
             fill="rgba(255,255,255,0.16)" transform="rotate(${cfg.rot} ${STEM_X} ${SOIL_Y - 3.5})"/>
  `;
}

/* ──────────────────────────────────────────────────────────────
   stage 2 — germinating sprout
   ────────────────────────────────────────────────────────────── */

function stage2(flower) {
  const s = SKIN[flower];
  const husk = `
    <ellipse cx="${STEM_X}" cy="${SOIL_Y - 1}" rx="3" ry="4"
             fill="${s.seed}" opacity="0.6"
             transform="rotate(18 ${STEM_X} ${SOIL_Y - 1})"/>`;
  const stemPath = `
    <path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2}"
          fill="none" stroke="${STEM}" stroke-width="2.4" stroke-linecap="round"/>
    <path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2 + 1}"
          fill="none" stroke="${STEM_VEIN}" stroke-width="0.7" stroke-linecap="round" opacity="0.5"/>`;
  const leftCot = `
    <g transform="translate(${STEM_X + 0.5} ${H.s2})" filter="${sunFilterSoft(flower, 2)}">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z"
            fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>`;
  const rightCot = `
    <g transform="translate(${STEM_X + 0.5} ${H.s2})" filter="${sunFilterSoft(flower, 2)}">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z"
            fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>`;
  return husk + stemPath + leftCot + rightCot;
}

/* ──────────────────────────────────────────────────────────────
   stage 3 — young plant
   ────────────────────────────────────────────────────────────── */

const stage3 = {
  tulip() {
    return [
      stem(H.s3, { width: 2.4, curveX: 1.2 }),
      blade({ anchorX: STEM_X, anchorY: SOIL_Y, rotate: -14, length: 52, width: 5 }),
      blade({ anchorX: STEM_X, anchorY: SOIL_Y, rotate: 16, length: 46, width: 4.6, opacity: 0.92 }),
      blade({ anchorX: STEM_X - 1, anchorY: SOIL_Y - 4, rotate: -32, length: 30, width: 3.4, opacity: 0.85 }),
      `<g filter="${sunFilterSoft("tulip", 3)}">${growingTip("tulip", STEM_X, H.s3)}</g>`,
    ].join("");
  },
  daisy() {
    return [
      stem(H.s3 + 4, { width: 2, curveX: 1 }),
      leaf({ anchorX: STEM_X, anchorY: 140, rotate: -65, length: 16, width: 5.5 }),
      leaf({ anchorX: STEM_X, anchorY: 140, rotate: 65, length: 16, width: 5.5, opacity: 0.92 }),
      leaf({ anchorX: STEM_X, anchorY: 126, rotate: -50, length: 12, width: 4.4, opacity: 0.88 }),
      leaf({ anchorX: STEM_X, anchorY: 126, rotate: 50, length: 11, width: 4.2, opacity: 0.86 }),
      `<g filter="${sunFilterSoft("daisy", 3)}">${growingTip("daisy", STEM_X, H.s3 + 4)}</g>`,
    ].join("");
  },
  sunflower() {
    // smaller leaves, fewer, well-spaced
    return [
      stem(H.s3 - 3, { width: 3.2, curveX: 0.8 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 122, rotate: -32, size: 10 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 100, rotate: 32, size: 9, opacity: 0.93 }),
      `<g filter="${sunFilterSoft("sunflower", 3)}">${growingTip("sunflower", STEM_X, H.s3 - 3)}</g>`,
    ].join("");
  },
  hydrangea() {
    return [
      stem(H.s3 + 1, { width: 2.6, curveX: 1 }),
      `<path d="M ${STEM_X} 110 Q ${STEM_X + 5} 105 ${STEM_X + 9} 100"
              fill="none" stroke="${STEM}" stroke-width="1.8" stroke-linecap="round"/>
       <path d="M ${STEM_X} 109 Q ${STEM_X + 5} 105 ${STEM_X + 9} 101"
              fill="none" stroke="${STEM_VEIN}" stroke-width="0.6" opacity="0.5"/>`,
      heartLeaf({ anchorX: STEM_X, anchorY: 122, rotate: -36, size: 12 }),
      heartLeaf({ anchorX: STEM_X + 9, anchorY: 100, rotate: 42, size: 10, opacity: 0.93 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 132, rotate: 95, size: 10, opacity: 0.88 }),
      `<g filter="${sunFilterSoft("hydrangea", 3)}">${growingTip("hydrangea", STEM_X, H.s3 + 1)}</g>`,
    ].join("");
  },
  azalea() {
    // all 3 branches now root at the soil (50, 150)
    const tipY1 = H.s3;
    const tipY2 = H.s3 + 4;
    const tipY3 = H.s3 - 1;
    return [
      // left branch
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 130 ${STEM_X - 9} 112 Q ${STEM_X - 13} 100 ${STEM_X - 14} ${tipY1}"
              fill="none" stroke="${STEM}" stroke-width="2.2" stroke-linecap="round"/>`,
      // right branch
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1} 130 ${STEM_X + 8} 115 Q ${STEM_X + 13} 104 ${STEM_X + 13} ${tipY2}"
              fill="none" stroke="${STEM}" stroke-width="2.2" stroke-linecap="round"/>`,
      // middle branch — now rooted at soil
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1.5} 125 ${STEM_X + 2.5} 105 Q ${STEM_X + 2} 90 ${STEM_X + 2} ${tipY3}"
              fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1} 130 ${STEM_X - 9} 113"
              fill="none" stroke="${STEM_VEIN}" stroke-width="0.6" opacity="0.5"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X + 1} 130 ${STEM_X + 8} 116"
              fill="none" stroke="${STEM_VEIN}" stroke-width="0.6" opacity="0.5"/>`,
      leaf({ anchorX: STEM_X - 12, anchorY: 105, rotate: -50, length: 10, width: 4 }),
      leaf({ anchorX: STEM_X - 6, anchorY: 122, rotate: -85, length: 9, width: 3.8, opacity: 0.9 }),
      leaf({ anchorX: STEM_X + 11, anchorY: 108, rotate: 55, length: 10, width: 4 }),
      leaf({ anchorX: STEM_X + 5, anchorY: 124, rotate: 90, length: 9, width: 3.8, opacity: 0.9 }),
      leaf({ anchorX: STEM_X + 3, anchorY: 116, rotate: 30, length: 8, width: 3.5, opacity: 0.85 }),
      `<g filter="${sunFilterSoft("azalea", 3)}">${growingTip("azalea", STEM_X - 14, tipY1)}</g>`,
      `<g filter="${sunFilterSoft("azalea", 3)}">${growingTip("azalea", STEM_X + 13, tipY2)}</g>`,
      `<g filter="${sunFilterSoft("azalea", 3)}">${growingTip("azalea", STEM_X + 2, tipY3)}</g>`,
    ].join("");
  },
  lily() {
    return [
      stem(H.s3, { width: 2, curveX: 0.6 }),
      blade({ anchorX: STEM_X, anchorY: 118, rotate: -68, length: 18, width: 2.4 }),
      blade({ anchorX: STEM_X, anchorY: 118, rotate: 68, length: 18, width: 2.4, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 100, rotate: -58, length: 15, width: 2.2 }),
      blade({ anchorX: STEM_X, anchorY: 100, rotate: 58, length: 15, width: 2.2, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 92, rotate: -50, length: 12, width: 2, opacity: 0.88 }),
      blade({ anchorX: STEM_X, anchorY: 92, rotate: 50, length: 12, width: 2, opacity: 0.88 }),
      `<g filter="${sunFilterSoft("lily", 3)}">${growingTip("lily", STEM_X, H.s3)}</g>`,
    ].join("");
  },
  amaranthus() {
    return [
      stem(H.s3, { width: 2.4, curveX: 1.2 }),
      blade({ anchorX: STEM_X, anchorY: 128, rotate: -42, length: 22, width: 5 }),
      blade({ anchorX: STEM_X, anchorY: 116, rotate: 42, length: 19, width: 4.6, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 102, rotate: -52, length: 15, width: 4, opacity: 0.88 }),
      blade({ anchorX: STEM_X, anchorY: 92, rotate: 48, length: 12, width: 3.6, opacity: 0.85 }),
      `<g filter="${sunFilterSoft("amaranthus", 3)}">${growingTip("amaranthus", STEM_X, H.s3)}</g>`,
    ].join("");
  },
  cherry() {
    const s = SKIN.cherry;
    return [
      // young sapling trunk (bark color, slightly thicker than herb stems)
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 120 ${STEM_X} ${H.s3 + 8}"
              fill="none" stroke="${s.bark}" stroke-width="3.4" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.5} 120 ${STEM_X} ${H.s3 + 9}"
              fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="1.1" stroke-linecap="round" opacity="0.5"/>`,
      // single side branch
      `<path d="M ${STEM_X} 112 Q ${STEM_X - 6} 106 ${STEM_X - 10} 98"
              fill="none" stroke="${s.bark}" stroke-width="1.8" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X - 10, anchorY: 98, rotate: -55, length: 10, width: 4 }),
      leaf({ anchorX: STEM_X, anchorY: H.s3 + 12, rotate: 50, length: 9, width: 3.6 }),
      leaf({ anchorX: STEM_X - 4, anchorY: 122, rotate: -70, length: 8, width: 3.4 }),
      `<g filter="${sunFilterSoft("cherry", 3)}">${growingTip("cherry", STEM_X, H.s3 + 8)}</g>`,
    ].join("");
  },
  wisteria() {
    return [
      stem(H.s3, { width: 2, curveX: 1.4 }),
      // compound leaf right side: midrib + 3 leaflets
      `<path d="M ${STEM_X} 112 Q ${STEM_X + 6} 108 ${STEM_X + 13} 104"
              fill="none" stroke="${STEM}" stroke-width="1" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X + 5, anchorY: 111, rotate: 60, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X + 9, anchorY: 107, rotate: 70, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X + 13, anchorY: 104, rotate: 82, length: 6, width: 2.8 }),
      // compound leaf left side
      `<path d="M ${STEM_X} 96 Q ${STEM_X - 6} 92 ${STEM_X - 13} 88"
              fill="none" stroke="${STEM}" stroke-width="1" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X - 5, anchorY: 95, rotate: -60, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X - 9, anchorY: 91, rotate: -70, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X - 13, anchorY: 88, rotate: -82, length: 6, width: 2.8 }),
      `<g filter="${sunFilterSoft("wisteria", 3)}">${growingTip("wisteria", STEM_X, H.s3)}</g>`,
    ].join("");
  },
  lotus() {
    return [
      stem(H.s3, { width: 2.2, curveX: 0.6 }),
      // a single small lily-pad leaf at the base on its own short stalk
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 8} 145 ${STEM_X + 14} 140"
              fill="none" stroke="${STEM}" stroke-width="1.6" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X + 14} 140) scale(0.45)">
        <ellipse cx="0" cy="0" rx="12" ry="9" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4"/>
        <path d="M 0 0 L 9 -4 M 0 0 L 11 0 M 0 0 L 8 4 M 0 0 L -8 -4 M 0 0 L -11 0 M 0 0 L -7 4"
              stroke="${VEIN_LITE}" stroke-width="0.5" fill="none" opacity="0.6"/>
      </g>`,
      `<g filter="${sunFilterSoft("lotus", 3)}">${growingTip("lotus", STEM_X, H.s3)}</g>`,
    ].join("");
  },
  iris() {
    return [
      stem(H.s3, { width: 1.8, curveX: 0.4 }),
      // sword-shaped vertical leaves at base
      blade({ anchorX: STEM_X - 2, anchorY: SOIL_Y, rotate: -8, length: 56, width: 4.6 }),
      blade({ anchorX: STEM_X + 2, anchorY: SOIL_Y, rotate: 10, length: 52, width: 4.4, opacity: 0.92 }),
      blade({ anchorX: STEM_X - 4, anchorY: SOIL_Y, rotate: -22, length: 42, width: 4, opacity: 0.85 }),
      blade({ anchorX: STEM_X + 4, anchorY: SOIL_Y, rotate: 22, length: 40, width: 4, opacity: 0.85 }),
      `<g filter="${sunFilterSoft("iris", 3)}">${growingTip("iris", STEM_X, H.s3)}</g>`,
    ].join("");
  },
  bird() {
    const s = SKIN.bird;
    return [
      stem(H.s3, { width: 2.6, curveX: 1 }),
      // one big banana-shaped leaf on a long stalk
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 4} 125 ${STEM_X - 10} 105"
              fill="none" stroke="${STEM}" stroke-width="1.8" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X - 10} 105)">
        <path d="M 0 0 C -3 -10 -3 -22 4 -28 C 10 -22 10 -10 6 -2 C 2 -1 0 0 0 0 Z"
              fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4"/>
        <path d="M 0 0 C -1 -8 0 -18 4 -26" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.6"/>
      </g>`,
      `<g filter="${sunFilterSoft("bird", 3)}">${growingTip("bird", STEM_X, H.s3)}</g>`,
    ].join("");
  },
  bamboo() {
    // single thin culm with a couple nodes
    return bambooStalk(STEM_X, SOIL_Y, SOIL_Y - H.s3, 3, 2.6)
      + `<g filter="${sunFilterSoft("bamboo", 3)}">${growingTip("bamboo", STEM_X, H.s3 + 2)}</g>`;
  },
  jacaranda() {
    const s = SKIN.jacaranda;
    return [
      // thin bark sapling
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 120 ${STEM_X} ${H.s3 + 6}"
              fill="none" stroke="${s.bark}" stroke-width="2.4" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.5} 120 ${STEM_X} ${H.s3 + 7}"
              fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="0.8" stroke-linecap="round" opacity="0.5"/>`,
      // feathery compound leaf (pinnate) — series of small leaflets on a midrib
      `<path d="M ${STEM_X} 110 Q ${STEM_X + 6} 105 ${STEM_X + 14} 100"
              fill="none" stroke="${STEM}" stroke-width="0.9" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X + 4, anchorY: 109, rotate: 70, length: 5, width: 2 }),
      leaf({ anchorX: STEM_X + 7, anchorY: 106, rotate: 78, length: 5, width: 2 }),
      leaf({ anchorX: STEM_X + 11, anchorY: 102, rotate: 85, length: 4.6, width: 1.8 }),
      leaf({ anchorX: STEM_X + 14, anchorY: 100, rotate: 90, length: 4, width: 1.8 }),
      `<path d="M ${STEM_X} 98 Q ${STEM_X - 6} 93 ${STEM_X - 14} 88"
              fill="none" stroke="${STEM}" stroke-width="0.9" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X - 4, anchorY: 97, rotate: -70, length: 5, width: 2 }),
      leaf({ anchorX: STEM_X - 7, anchorY: 94, rotate: -78, length: 5, width: 2 }),
      leaf({ anchorX: STEM_X - 11, anchorY: 90, rotate: -85, length: 4.6, width: 1.8 }),
      leaf({ anchorX: STEM_X - 14, anchorY: 88, rotate: -90, length: 4, width: 1.8 }),
      `<g filter="${sunFilterSoft("jacaranda", 3)}">${growingTip("jacaranda", STEM_X, H.s3 + 6)}</g>`,
    ].join("");
  },
  dragon() {
    const s = SKIN.dragon;
    return [
      // short stout trunk
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 122 ${STEM_X} ${H.s3 + 10}"
              fill="none" stroke="${s.bark}" stroke-width="3.4" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1} 122 ${STEM_X} ${H.s3 + 11}"
              fill="none" stroke="${s.barkShade}" stroke-width="1.1" stroke-linecap="round" opacity="0.7"/>`,
      // single spiky leaf rosette at the top — early canopy
      `<g transform="translate(${STEM_X} ${H.s3 + 6})">
        <path d="M 0 0 L -8 -8 M 0 0 L -5 -10 M 0 0 L -2 -11 M 0 0 L 2 -11 M 0 0 L 5 -10 M 0 0 L 8 -8"
              stroke="${s.canopy}" stroke-width="1" stroke-linecap="round" fill="none"/>
        <path d="M 0 0 L -10 -4 M 0 0 L 10 -4"
              stroke="${s.canopyShade}" stroke-width="1" stroke-linecap="round" fill="none"/>
      </g>`,
      `<g filter="${sunFilterSoft("dragon", 3)}">${growingTip("dragon", STEM_X, H.s3 + 8)}</g>`,
    ].join("");
  },
  cereus() {
    // small slender ribbed Cereus column — narrower than other cacti,
    // with 5 pronounced ribs already visible at this stage.
    const halfW = 5;
    const top = H.s3 + 10;
    return cereusColumn(STEM_X, SOIL_Y, top, halfW);
  },
};

/* ──────────────────────────────────────────────────────────────
   stage 4 — budding
   ────────────────────────────────────────────────────────────── */

const stage4 = {
  tulip() {
    const s = SKIN.tulip;
    return [
      stem(H.s4, { width: 2.4, curveX: 1.1 }),
      blade({ anchorX: STEM_X, anchorY: SOIL_Y, rotate: -14, length: 60, width: 5.2 }),
      blade({ anchorX: STEM_X, anchorY: SOIL_Y, rotate: 16, length: 56, width: 4.8, opacity: 0.92 }),
      blade({ anchorX: STEM_X - 1, anchorY: SOIL_Y - 4, rotate: -32, length: 36, width: 3.6, opacity: 0.85 }),
      `<g transform="translate(${STEM_X} ${H.s4 + 2})" filter="${sunFilter("tulip", 4)}">
        <path d="M 0 0 C -7 -2 -8 -12 0 -20 C 8 -12 7 -2 0 0 Z" fill="${s.petal}"/>
        <path d="M -3 -3 C -4 -8 -2 -16 0 -19" stroke="${s.shade}" stroke-width="0.7" fill="none" opacity="0.7"/>
        <path d="M 3 -3 C 4 -8 2 -16 0 -19" stroke="${s.deep}" stroke-width="0.6" fill="none" opacity="0.6"/>
        <path d="M 0 -19 L 0 -1" stroke="${s.deep}" stroke-width="0.5" opacity="0.55"/>
        <path d="M -3 -1 Q -5 2 -5 5 M 3 -1 Q 5 2 5 5" stroke="${STEM}" stroke-width="0.8" stroke-linecap="round" fill="none"/>
      </g>`,
    ].join("");
  },
  daisy() {
    return [
      stem(H.s4 + 4, { width: 2, curveX: 1 }),
      leaf({ anchorX: STEM_X, anchorY: 140, rotate: -65, length: 17, width: 5.6 }),
      leaf({ anchorX: STEM_X, anchorY: 140, rotate: 65, length: 17, width: 5.6, opacity: 0.92 }),
      leaf({ anchorX: STEM_X, anchorY: 122, rotate: -50, length: 12, width: 4.5, opacity: 0.88 }),
      leaf({ anchorX: STEM_X, anchorY: 122, rotate: 50, length: 11, width: 4.3, opacity: 0.86 }),
      `<g transform="translate(${STEM_X} ${H.s4 + 4})" filter="${sunFilter("daisy", 4)}">
        <ellipse cx="0" cy="-4" rx="5" ry="5.6" fill="${LEAF}"/>
        <ellipse cx="0" cy="-4" rx="3" ry="3.6" fill="${LEAF}" opacity="0.6" transform="rotate(45)"/>
        <path d="M -5 -2 Q -7 2 -7 5 M 5 -2 Q 7 2 7 5"
              stroke="${STEM}" stroke-width="1" stroke-linecap="round" fill="none"/>
        <path d="M 0 -9 Q 0 -6 0 -3" stroke="${STEM_VEIN}" stroke-width="0.5" opacity="0.55"/>
      </g>`,
    ].join("");
  },
  sunflower() {
    const s = SKIN.sunflower;
    return [
      stem(H.s4, { width: 3.2, curveX: 0.8 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 122, rotate: -32, size: 10 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 100, rotate: 32, size: 9, opacity: 0.93 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 78, rotate: -28, size: 8, opacity: 0.88 }),
      `<g transform="translate(${STEM_X} ${H.s4 + 4})" filter="${sunFilter("sunflower", 4)}">
        <path d="M -8 0 L -11 3 M -6 -4 L -10 -2 M 8 0 L 11 3 M 6 -4 L 10 -2 M 0 -8 L -1 -12 M 0 -8 L 1 -12"
              stroke="${LEAF}" stroke-width="1.4" stroke-linecap="round"/>
        <ellipse cx="0" cy="-9" rx="1.4" ry="3" fill="${s.petal}"/>
        <ellipse cx="-5" cy="-7" rx="1.4" ry="2.6" fill="${s.petal}" transform="rotate(-30)"/>
        <ellipse cx="5" cy="-7" rx="1.4" ry="2.6" fill="${s.petal}" transform="rotate(30)"/>
        <ellipse cx="-7" cy="-3" rx="1.3" ry="2.4" fill="${s.shade}" transform="rotate(-60)"/>
        <ellipse cx="7" cy="-3" rx="1.3" ry="2.4" fill="${s.shade}" transform="rotate(60)"/>
        <ellipse cx="0" cy="-3" rx="6" ry="4.5" fill="${s.center}"/>
        <circle cx="-1.5" cy="-3" r="0.6" fill="${s.deep}" opacity="0.6"/>
        <circle cx="1.5" cy="-2.5" r="0.6" fill="${s.deep}" opacity="0.6"/>
        <circle cx="0" cy="-4.5" r="0.5" fill="${s.deep}" opacity="0.6"/>
      </g>`,
    ].join("");
  },
  hydrangea() {
    return [
      stem(H.s4, { width: 2.6, curveX: 1 }),
      `<path d="M ${STEM_X} 95 Q ${STEM_X + 5} 90 ${STEM_X + 9} 84"
              fill="none" stroke="${STEM}" stroke-width="1.8" stroke-linecap="round"/>`,
      heartLeaf({ anchorX: STEM_X, anchorY: 120, rotate: -36, size: 12 }),
      heartLeaf({ anchorX: STEM_X + 9, anchorY: 84, rotate: 42, size: 10, opacity: 0.93 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 130, rotate: 95, size: 10, opacity: 0.88 }),
      `<g transform="translate(${STEM_X} ${H.s4 + 5})" filter="${sunFilter("hydrangea", 4)}">
        <circle cx="-3" cy="-3" r="3.2" fill="${LEAF}"/>
        <circle cx="3" cy="-3" r="3.2" fill="${LEAF}" opacity="0.92"/>
        <circle cx="0" cy="-8" r="3.2" fill="${LEAF}"/>
        <circle cx="-1.5" cy="-1" r="2.8" fill="${LEAF}" opacity="0.88"/>
        <circle cx="2" cy="-6" r="2.6" fill="${LEAF}" opacity="0.86"/>
        <circle cx="-3" cy="-3" r="1.2" fill="${SKIN.hydrangea.petal}" opacity="0.7"/>
        <circle cx="0" cy="-8" r="1.2" fill="${SKIN.hydrangea.petal}" opacity="0.7"/>
      </g>`,
    ].join("");
  },
  azalea() {
    const s = SKIN.azalea;
    return [
      // all 3 branches root at soil
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 130 ${STEM_X - 9} 110 Q ${STEM_X - 13} 96 ${STEM_X - 14} ${H.s4}"
              fill="none" stroke="${STEM}" stroke-width="2.2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1} 130 ${STEM_X + 8} 112 Q ${STEM_X + 13} 98 ${STEM_X + 13} ${H.s4 + 4}"
              fill="none" stroke="${STEM}" stroke-width="2.2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1.5} 125 ${STEM_X + 2.5} 100 Q ${STEM_X + 2} 75 ${STEM_X + 2} ${H.s4 - 1}"
              fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X - 12, anchorY: 105, rotate: -55, length: 10, width: 4 }),
      leaf({ anchorX: STEM_X - 6, anchorY: 122, rotate: -85, length: 9, width: 3.8, opacity: 0.9 }),
      leaf({ anchorX: STEM_X + 11, anchorY: 108, rotate: 55, length: 10, width: 4 }),
      leaf({ anchorX: STEM_X + 5, anchorY: 124, rotate: 90, length: 9, width: 3.8, opacity: 0.9 }),
      leaf({ anchorX: STEM_X + 3, anchorY: 110, rotate: 30, length: 8, width: 3.5, opacity: 0.85 }),
      `<g transform="translate(${STEM_X - 14} ${H.s4})" filter="${sunFilter("azalea", 4)}">
        <ellipse cx="0" cy="-3" rx="3" ry="3.6" fill="${s.budShade}"/>
        <ellipse cx="-0.4" cy="-3.4" rx="1.8" ry="2.6" fill="${s.bud}"/>
        <path d="M -2 0 Q -3 2 -3 4" stroke="${STEM}" stroke-width="0.8" fill="none" stroke-linecap="round"/>
      </g>`,
      `<g transform="translate(${STEM_X + 13} ${H.s4 + 4})" filter="${sunFilter("azalea", 4)}">
        <ellipse cx="0" cy="-3" rx="3" ry="3.6" fill="${s.budShade}"/>
        <ellipse cx="-0.4" cy="-3.4" rx="1.8" ry="2.6" fill="${s.bud}"/>
        <path d="M 2 0 Q 3 2 3 4" stroke="${STEM}" stroke-width="0.8" fill="none" stroke-linecap="round"/>
      </g>`,
      `<g transform="translate(${STEM_X + 2} ${H.s4 - 1})" filter="${sunFilter("azalea", 4)}">
        <ellipse cx="0" cy="-2" rx="2.4" ry="3" fill="${s.budShade}"/>
        <ellipse cx="-0.3" cy="-2.4" rx="1.4" ry="2" fill="${s.bud}"/>
      </g>`,
    ].join("");
  },
  lily() {
    const s = SKIN.lily;
    return [
      stem(H.s4, { width: 2, curveX: 0.6 }),
      blade({ anchorX: STEM_X, anchorY: 118, rotate: -68, length: 18, width: 2.4 }),
      blade({ anchorX: STEM_X, anchorY: 118, rotate: 68, length: 18, width: 2.4, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 100, rotate: -58, length: 15, width: 2.2 }),
      blade({ anchorX: STEM_X, anchorY: 100, rotate: 58, length: 15, width: 2.2, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 82, rotate: -50, length: 12, width: 2, opacity: 0.88 }),
      blade({ anchorX: STEM_X, anchorY: 82, rotate: 50, length: 12, width: 2, opacity: 0.88 }),
      blade({ anchorX: STEM_X, anchorY: 64, rotate: -42, length: 10, width: 1.8, opacity: 0.85 }),
      blade({ anchorX: STEM_X, anchorY: 64, rotate: 42, length: 10, width: 1.8, opacity: 0.85 }),
      `<g transform="translate(${STEM_X} ${H.s4 + 4})" filter="${sunFilter("lily", 4)}">
        <path d="M 0 0 C -3 -3 -3.5 -14 0 -22 C 3.5 -14 3 -3 0 0 Z" fill="${s.shade}"/>
        <path d="M -1.6 -2 C -2 -8 -1 -18 0 -21" stroke="${s.petal}" stroke-width="0.6" fill="none" opacity="0.7"/>
        <path d="M 1.6 -2 C 2 -8 1 -18 0 -21" stroke="${s.deep}" stroke-width="0.5" fill="none" opacity="0.55"/>
        <path d="M 0 -21 L 0 -1" stroke="${s.deep}" stroke-width="0.4" opacity="0.55"/>
      </g>`,
    ].join("");
  },
  amaranthus() {
    const s = SKIN.amaranthus;
    return [
      stem(H.s4, { width: 2.6, curveX: 1.2 }),
      blade({ anchorX: STEM_X, anchorY: 128, rotate: -42, length: 24, width: 5.2 }),
      blade({ anchorX: STEM_X, anchorY: 114, rotate: 42, length: 21, width: 4.8, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 98, rotate: -52, length: 16, width: 4.2, opacity: 0.88 }),
      blade({ anchorX: STEM_X, anchorY: 82, rotate: 48, length: 13, width: 3.8, opacity: 0.85 }),
      blade({ anchorX: STEM_X, anchorY: 66, rotate: -42, length: 10, width: 3.4, opacity: 0.82 }),
      `<g transform="translate(${STEM_X} ${H.s4})" filter="${sunFilter("amaranthus", 4)}">
        <ellipse cx="0" cy="-3" rx="3.2" ry="3.8" fill="${s.shade}"/>
        <ellipse cx="-0.6" cy="-4" rx="2.2" ry="3" fill="${s.petal}" opacity="0.95"/>
        <path d="M 0 -1 Q 0 6 0 14" fill="none" stroke="${s.petal}" stroke-width="3.4" stroke-linecap="round"/>
        <line x1="-3" y1="4" x2="-1" y2="4.4" stroke="${s.hi}" stroke-width="0.7" stroke-linecap="round"/>
        <line x1="-3" y1="9" x2="-1" y2="9.4" stroke="${s.hi}" stroke-width="0.7" stroke-linecap="round"/>
        <line x1="1" y1="4" x2="3" y2="4.4" stroke="${s.hi}" stroke-width="0.7" stroke-linecap="round"/>
        <line x1="1" y1="9" x2="3" y2="9.4" stroke="${s.hi}" stroke-width="0.7" stroke-linecap="round"/>
        <circle cx="0" cy="14" r="1" fill="${s.hi}"/>
      </g>`,
    ].join("");
  },
  cherry() {
    const s = SKIN.cherry;
    return [
      // taller trunk + spreading branches
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 105 ${STEM_X - 1} ${H.s4 + 6}"
              fill="none" stroke="${s.bark}" stroke-width="3.8" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.5} 105 ${STEM_X - 1} ${H.s4 + 7}"
              fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="1.2" stroke-linecap="round" opacity="0.5"/>`,
      // 3 branches splitting from the trunk at different heights
      `<path d="M ${STEM_X - 1} 110 Q ${STEM_X - 12} 92 ${STEM_X - 18} 75"
              fill="none" stroke="${s.bark}" stroke-width="2.2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X - 1} 90 Q ${STEM_X + 11} 80 ${STEM_X + 17} 65"
              fill="none" stroke="${s.bark}" stroke-width="2.2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X - 1} 70 Q ${STEM_X - 5} 60 ${STEM_X - 8} 52"
              fill="none" stroke="${s.bark}" stroke-width="1.8" stroke-linecap="round"/>`,
      // a few small leaves
      leaf({ anchorX: STEM_X - 15, anchorY: 84, rotate: -60, length: 8, width: 3.4 }),
      leaf({ anchorX: STEM_X + 12, anchorY: 76, rotate: 60, length: 8, width: 3.4 }),
      leaf({ anchorX: STEM_X - 6, anchorY: 62, rotate: -40, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X + 3, anchorY: 80, rotate: 50, length: 7, width: 3, opacity: 0.9 }),
      // closed pink buds at branch tips + scattered along
      `<g filter="${sunFilter("cherry", 4)}">
        ${cherryBud(STEM_X - 18, 75)}
        ${cherryBud(STEM_X + 17, 65)}
        ${cherryBud(STEM_X - 8, 52)}
        ${cherryBud(STEM_X - 1, H.s4 + 6)}
        ${cherryBud(STEM_X - 13, 80)}
        ${cherryBud(STEM_X + 13, 72)}
      </g>`,
    ].join("");
  },
  wisteria() {
    const s = SKIN.wisteria;
    return [
      stem(H.s4, { width: 2.2, curveX: 1.4 }),
      // small horizontal branch where racemes will hang
      `<path d="M ${STEM_X - 8} ${H.s4 + 5} Q ${STEM_X} ${H.s4 + 2} ${STEM_X + 8} ${H.s4 + 5}"
              fill="none" stroke="${STEM}" stroke-width="1.6" stroke-linecap="round"/>`,
      // compound leaves on stem
      `<path d="M ${STEM_X} 110 Q ${STEM_X + 6} 106 ${STEM_X + 13} 102"
              fill="none" stroke="${STEM}" stroke-width="1" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X + 5, anchorY: 109, rotate: 60, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X + 9, anchorY: 105, rotate: 70, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X + 13, anchorY: 102, rotate: 82, length: 6, width: 2.8 }),
      `<path d="M ${STEM_X} 88 Q ${STEM_X - 6} 84 ${STEM_X - 13} 80"
              fill="none" stroke="${STEM}" stroke-width="1" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X - 5, anchorY: 87, rotate: -60, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X - 9, anchorY: 83, rotate: -70, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X - 13, anchorY: 80, rotate: -82, length: 6, width: 2.8 }),
      // short hanging green-purple cluster buds (pre-bloom)
      `<g filter="${sunFilter("wisteria", 4)}">
        <g transform="translate(${STEM_X - 7} ${H.s4 + 8})">
          <ellipse cx="0" cy="0" rx="2.4" ry="1.4" fill="${LEAF}"/>
          <ellipse cx="0" cy="4" rx="2" ry="3" fill="${s.shade}" opacity="0.9"/>
          <ellipse cx="-0.4" cy="3.5" rx="1.4" ry="2.4" fill="${s.petal}" opacity="0.7"/>
          <circle cx="0" cy="8" r="0.8" fill="${s.shade}"/>
        </g>
        <g transform="translate(${STEM_X} ${H.s4 + 6})">
          <ellipse cx="0" cy="0" rx="2.4" ry="1.4" fill="${LEAF}"/>
          <ellipse cx="0" cy="5" rx="2.2" ry="3.4" fill="${s.shade}" opacity="0.9"/>
          <ellipse cx="-0.4" cy="4.5" rx="1.6" ry="2.6" fill="${s.petal}" opacity="0.7"/>
          <circle cx="0" cy="10" r="0.9" fill="${s.shade}"/>
        </g>
        <g transform="translate(${STEM_X + 7} ${H.s4 + 8})">
          <ellipse cx="0" cy="0" rx="2.4" ry="1.4" fill="${LEAF}"/>
          <ellipse cx="0" cy="4" rx="2" ry="3" fill="${s.shade}" opacity="0.9"/>
          <ellipse cx="-0.4" cy="3.5" rx="1.4" ry="2.4" fill="${s.petal}" opacity="0.7"/>
          <circle cx="0" cy="8" r="0.8" fill="${s.shade}"/>
        </g>
      </g>`,
    ].join("");
  },
  lotus() {
    const s = SKIN.lotus;
    return [
      stem(H.s4, { width: 2.2, curveX: 0.6 }),
      // lily-pad leaf at base on its own stalk
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 9} 142 ${STEM_X + 16} 138"
              fill="none" stroke="${STEM}" stroke-width="1.8" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X + 16} 138) scale(0.55)">
        <ellipse cx="0" cy="0" rx="13" ry="10" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.35"/>
        <path d="M 0 0 L 10 -5 M 0 0 L 12 0 M 0 0 L 9 5 M 0 0 L -9 -5 M 0 0 L -12 0 M 0 0 L -8 5 M 0 0 L 2 -8 M 0 0 L -3 7"
              stroke="${VEIN_LITE}" stroke-width="0.5" fill="none" opacity="0.6"/>
      </g>`,
      // closed pointed lotus bud at top — pink-tinted teardrop
      `<g transform="translate(${STEM_X} ${H.s4 + 4})" filter="${sunFilter("lotus", 4)}">
        <path d="M 0 0 C -5 -3 -5 -16 0 -22 C 5 -16 5 -3 0 0 Z" fill="${s.petal}" stroke="${s.deep}" stroke-width="0.4"/>
        <path d="M -2 -2 C -3 -8 -2 -16 0 -20" stroke="${s.shade}" stroke-width="0.5" fill="none" opacity="0.65"/>
        <path d="M 2 -2 C 3 -8 2 -16 0 -20" stroke="${s.shade}" stroke-width="0.5" fill="none" opacity="0.65"/>
        <path d="M 0 -22 L 0 -1" stroke="${s.deep}" stroke-width="0.4" opacity="0.55"/>
        <!-- pale base sepals -->
        <path d="M -3 -1 Q -5 2 -5 4 M 3 -1 Q 5 2 5 4" stroke="${STEM}" stroke-width="0.8" stroke-linecap="round" fill="none"/>
      </g>`,
    ].join("");
  },
  iris() {
    const s = SKIN.iris;
    return [
      stem(H.s4, { width: 1.8, curveX: 0.4 }),
      blade({ anchorX: STEM_X - 2, anchorY: SOIL_Y, rotate: -8, length: 64, width: 4.8 }),
      blade({ anchorX: STEM_X + 2, anchorY: SOIL_Y, rotate: 10, length: 60, width: 4.6, opacity: 0.92 }),
      blade({ anchorX: STEM_X - 4, anchorY: SOIL_Y, rotate: -22, length: 48, width: 4.2, opacity: 0.85 }),
      blade({ anchorX: STEM_X + 4, anchorY: SOIL_Y, rotate: 22, length: 46, width: 4.2, opacity: 0.85 }),
      // closed iris bud — long pointed cone, slightly purple-tinged
      `<g transform="translate(${STEM_X} ${H.s4 + 4})" filter="${sunFilter("iris", 4)}">
        <path d="M 0 0 C -3 -3 -3 -16 0 -22 C 3 -16 3 -3 0 0 Z" fill="${s.shade}" stroke="${s.deep}" stroke-width="0.4"/>
        <path d="M -1.4 -3 C -2 -10 -1 -18 0 -21" stroke="${s.petal}" stroke-width="0.5" fill="none" opacity="0.7"/>
        <path d="M 1.4 -3 C 2 -10 1 -18 0 -21" stroke="${s.inner}" stroke-width="0.5" fill="none" opacity="0.7"/>
        <path d="M 0 -22 L 0 -1" stroke="${s.deep}" stroke-width="0.4" opacity="0.55"/>
      </g>`,
    ].join("");
  },
  bird() {
    const s = SKIN.bird;
    return [
      stem(H.s4, { width: 2.8, curveX: 1 }),
      // two banana leaves on stalks
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 4} 122 ${STEM_X - 12} 100"
              fill="none" stroke="${STEM}" stroke-width="1.8" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X - 12} 100)">
        <path d="M 0 0 C -3 -10 -3 -24 5 -30 C 12 -24 12 -10 7 -2 C 3 -1 0 0 0 0 Z"
              fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4"/>
        <path d="M 0 0 C -1 -10 0 -20 5 -28" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.6"/>
      </g>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X + 4} 118 ${STEM_X + 12} 96"
              fill="none" stroke="${STEM}" stroke-width="1.6" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X + 12} 96)">
        <path d="M 0 0 C 3 -10 3 -22 -4 -28 C -10 -22 -10 -10 -6 -2 C -2 -1 0 0 0 0 Z"
              fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4" opacity="0.95"/>
      </g>`,
      // closed pre-bloom boat at the top (mostly green with tiny orange peek)
      `<g transform="translate(${STEM_X} ${H.s4 + 4})" filter="${sunFilter("bird", 4)}">
        <path d="M -10 0 Q -5 -10 4 -14 Q 8 -10 6 -1 Q -2 4 -10 0 Z"
              fill="${s.spathe}" stroke="${s.deep}" stroke-width="0.45"/>
        <path d="M -1 -6 L -1 -2 M 1 -5 L 1 -1"
              stroke="${s.petal}" stroke-width="0.8" stroke-linecap="round"/>
        <path d="M 4 -8 L 6 -12" stroke="${s.deep}" stroke-width="0.4" fill="none"/>
      </g>`,
    ].join("");
  },
  bamboo() {
    // taller stalk with more segments
    return bambooStalk(STEM_X, SOIL_Y, SOIL_Y - H.s4, 5, 3)
      + bambooStalk(STEM_X + 9, SOIL_Y, (SOIL_Y - H.s4) * 0.75, 4, 2.4);
  },
  jacaranda() {
    const s = SKIN.jacaranda;
    return [
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 105 ${STEM_X - 1} ${H.s4 + 4}"
              fill="none" stroke="${s.bark}" stroke-width="3" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.5} 105 ${STEM_X - 1} ${H.s4 + 5}"
              fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1" stroke-linecap="round" opacity="0.5"/>`,
      // 2 branches
      `<path d="M ${STEM_X - 1} 105 Q ${STEM_X - 10} 90 ${STEM_X - 14} 72"
              fill="none" stroke="${s.bark}" stroke-width="1.8" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X - 1} 85 Q ${STEM_X + 8} 75 ${STEM_X + 14} 62"
              fill="none" stroke="${s.bark}" stroke-width="1.8" stroke-linecap="round"/>`,
      // small compound leaves
      `<path d="M ${STEM_X - 14} 72 L ${STEM_X - 10} 64"
              stroke="${STEM}" stroke-width="0.9"/>`,
      leaf({ anchorX: STEM_X - 13, anchorY: 70, rotate: -60, length: 4.6, width: 1.8 }),
      leaf({ anchorX: STEM_X - 11, anchorY: 67, rotate: -75, length: 4.6, width: 1.8 }),
      leaf({ anchorX: STEM_X + 14, anchorY: 62, rotate: 60, length: 4.6, width: 1.8 }),
      leaf({ anchorX: STEM_X + 11, anchorY: 65, rotate: 75, length: 4.6, width: 1.8 }),
      // small clusters of pre-bloom green-purple buds
      `<g filter="${sunFilter("jacaranda", 4)}">
        <g transform="translate(${STEM_X - 14} 72)">
          <circle cx="0" cy="0" r="1.6" fill="${LEAF}"/>
          <circle cx="-0.4" cy="-0.4" r="1" fill="${s.shade}" opacity="0.55"/>
        </g>
        <g transform="translate(${STEM_X + 14} 62)">
          <circle cx="0" cy="0" r="1.6" fill="${LEAF}"/>
          <circle cx="-0.4" cy="-0.4" r="1" fill="${s.shade}" opacity="0.55"/>
        </g>
        <g transform="translate(${STEM_X - 1} ${H.s4 + 4})">
          <circle cx="0" cy="0" r="1.8" fill="${LEAF}"/>
          <circle cx="-0.4" cy="-0.4" r="1.1" fill="${s.shade}" opacity="0.55"/>
        </g>
      </g>`,
    ].join("");
  },
  cereus() {
    // taller ribbed column with a closed flower bud at the top
    const s = SKIN.cereus;
    const halfW = 6;
    const top = H.s4 + 6;
    return [
      cereusColumn(STEM_X, SOIL_Y, top, halfW),
      // closed cream flower bud at top
      `<g transform="translate(${STEM_X} ${top - 1})" filter="${sunFilter("cereus", 4)}">
        <ellipse cx="0" cy="-3" rx="2.8" ry="3.6" fill="${s.petal}" stroke="${s.deep}" stroke-width="0.4"/>
        <ellipse cx="-0.4" cy="-4" rx="1.6" ry="2.4" fill="${s.cream}" opacity="0.85"/>
        <!-- green calyx at the base of the bud -->
        <path d="M -2.4 0 Q -3.4 2 -3.4 3 M 2.4 0 Q 3.4 2 3.4 3"
              stroke="${s.shade}" stroke-width="0.7" stroke-linecap="round" fill="none"/>
        <path d="M 0 -7 L 0 -1" stroke="${s.deep}" stroke-width="0.4" opacity="0.55"/>
      </g>`,
    ].join("");
  },
  dragon() {
    const s = SKIN.dragon;
    return [
      // thicker trunk
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 110 ${STEM_X} ${H.s4 + 8}"
              fill="none" stroke="${s.bark}" stroke-width="4" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1} 110 ${STEM_X} ${H.s4 + 9}"
              fill="none" stroke="${s.barkShade}" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/>`,
      // trunk begins splitting at top into 3 small upward branches
      `<path d="M ${STEM_X} ${H.s4 + 8} Q ${STEM_X - 4} ${H.s4} ${STEM_X - 8} ${H.s4 - 4}"
              fill="none" stroke="${s.bark}" stroke-width="2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${H.s4 + 8} Q ${STEM_X} ${H.s4 - 2} ${STEM_X} ${H.s4 - 6}"
              fill="none" stroke="${s.bark}" stroke-width="2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${H.s4 + 8} Q ${STEM_X + 4} ${H.s4} ${STEM_X + 8} ${H.s4 - 4}"
              fill="none" stroke="${s.bark}" stroke-width="2" stroke-linecap="round"/>`,
      // small leaf tufts at each branch tip
      `<g filter="${sunFilter("dragon", 4)}">
        <g transform="translate(${STEM_X - 8} ${H.s4 - 4})">
          <path d="M 0 0 L -3 -6 M 0 0 L -1.5 -7 M 0 0 L 0 -8 M 0 0 L 1.5 -7 M 0 0 L 3 -6"
                stroke="${s.canopy}" stroke-width="0.9" stroke-linecap="round" fill="none"/>
        </g>
        <g transform="translate(${STEM_X} ${H.s4 - 6})">
          <path d="M 0 0 L -3 -7 M 0 0 L -1.5 -8 M 0 0 L 0 -9 M 0 0 L 1.5 -8 M 0 0 L 3 -7"
                stroke="${s.canopy}" stroke-width="1" stroke-linecap="round" fill="none"/>
        </g>
        <g transform="translate(${STEM_X + 8} ${H.s4 - 4})">
          <path d="M 0 0 L -3 -6 M 0 0 L -1.5 -7 M 0 0 L 0 -8 M 0 0 L 1.5 -7 M 0 0 L 3 -6"
                stroke="${s.canopyShade}" stroke-width="0.9" stroke-linecap="round" fill="none"/>
        </g>
      </g>`,
    ].join("");
  },
};

/* ──────────────────────────────────────────────────────────────
   stage 5 — in bloom (flower apex y≈18, much taller than s4)
   ────────────────────────────────────────────────────────────── */

const stage5 = {
  tulip() {
    const s = SKIN.tulip;
    return [
      stem(H.s5Stem, { width: 2.4, curveX: 1.1 }),
      blade({ anchorX: STEM_X, anchorY: SOIL_Y, rotate: -14, length: 76, width: 5.6 }),
      blade({ anchorX: STEM_X, anchorY: SOIL_Y, rotate: 16, length: 70, width: 5.2, opacity: 0.92 }),
      blade({ anchorX: STEM_X - 1, anchorY: SOIL_Y - 4, rotate: -32, length: 44, width: 4, opacity: 0.85 }),
      `<g transform="translate(${STEM_X} ${H.s5Stem})" filter="${sunFilter("tulip", 5)}">
        <path d="M 0 0 C -13 -5 -13 -22 0 -30 C 13 -22 13 -5 0 0 Z" fill="${s.shade}"/>
        <path d="M 0 -1 C -10 -7 -12 -22 -5 -29 C -1 -19 0 -12 0 -1 Z" fill="${s.petal}"/>
        <path d="M 0 -1 C 10 -7 12 -22 5 -29 C 1 -19 0 -12 0 -1 Z" fill="${s.petal}" opacity="0.94"/>
        <path d="M -1 -3 C -3 -10 -2 -22 -1 -27" stroke="${s.deep}" stroke-width="0.55" fill="none" opacity="0.55"/>
        <path d="M 1 -3 C 3 -10 2 -22 1 -27" stroke="${s.deep}" stroke-width="0.55" fill="none" opacity="0.55"/>
        <path d="M 0 -2 L 0 -24" stroke="${s.deep}" stroke-width="0.55" opacity="0.5"/>
        <path d="M -4 -1 Q -6 2 -7 5 M 4 -1 Q 6 2 7 5"
              stroke="${STEM}" stroke-width="0.9" stroke-linecap="round" fill="none"/>
      </g>`,
    ].join("");
  },
  daisy() {
    const s = SKIN.daisy;
    const petals = [];
    const N = 12;
    for (let i = 0; i < N; i++) {
      const a = (360 / N) * i;
      petals.push(`
        <g transform="rotate(${a})">
          <ellipse cx="0" cy="-12" rx="3.2" ry="9" fill="${s.petal}" opacity="${i % 2 === 0 ? 1 : 0.93}"/>
          <path d="M 0 -3 L 0 -20" stroke="${s.shade}" stroke-width="0.4" opacity="0.55"/>
        </g>
      `);
    }
    return [
      stem(H.s5Stem + 5, { width: 2, curveX: 1 }),
      leaf({ anchorX: STEM_X, anchorY: 140, rotate: -65, length: 18, width: 5.8 }),
      leaf({ anchorX: STEM_X, anchorY: 140, rotate: 65, length: 18, width: 5.8, opacity: 0.92 }),
      leaf({ anchorX: STEM_X, anchorY: 122, rotate: -50, length: 13, width: 4.6, opacity: 0.88 }),
      leaf({ anchorX: STEM_X, anchorY: 122, rotate: 50, length: 12, width: 4.4, opacity: 0.86 }),
      `<g transform="translate(${STEM_X} ${H.s5Stem - 2})" filter="${sunFilter("daisy", 5)}">
        ${petals.join("")}
        <circle cx="0" cy="0" r="4.6" fill="${s.center}"/>
        <circle cx="-1.4" cy="-1.2" r="1.7" fill="#fff2c8" opacity="0.6"/>
        <circle cx="1.4" cy="-0.6" r="0.5" fill="${s.deep}" opacity="0.55"/>
        <circle cx="0.4" cy="1.8" r="0.5" fill="${s.deep}" opacity="0.55"/>
        <circle cx="-0.6" cy="0.8" r="0.5" fill="${s.deep}" opacity="0.55"/>
        <circle cx="1.4" cy="1.8" r="0.5" fill="${s.deep}" opacity="0.55"/>
      </g>`,
    ].join("");
  },
  sunflower() {
    const s = SKIN.sunflower;
    const petals = [];
    const N = 20;
    for (let i = 0; i < N; i++) {
      const a = (360 / N) * i;
      petals.push(`
        <g transform="rotate(${a})">
          <ellipse cx="0" cy="-16" rx="3.4" ry="10" fill="${s.petal}" opacity="${i % 2 === 0 ? 1 : 0.92}"/>
          <path d="M 0 -8 L 0 -24" stroke="${s.shade}" stroke-width="0.4" opacity="0.55"/>
        </g>
      `);
    }
    return [
      stem(H.s5Stem, { width: 3.2, curveX: 0.8 }),
      // smaller, fewer, well-spaced leaves
      heartLeaf({ anchorX: STEM_X, anchorY: 122, rotate: -32, size: 10 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 96, rotate: 32, size: 9, opacity: 0.92 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 72, rotate: -28, size: 8, opacity: 0.88 }),
      `<g transform="translate(${STEM_X} ${H.s5Stem - 8})" filter="${sunFilter("sunflower", 5)}">
        ${petals.join("")}
        <circle cx="0" cy="0" r="8" fill="${s.center}"/>
        <circle cx="-2.4" cy="-1.2" r="0.65" fill="${s.deep}" opacity="0.7"/>
        <circle cx="2.2" cy="1.2" r="0.65" fill="${s.deep}" opacity="0.7"/>
        <circle cx="0" cy="3.6" r="0.65" fill="${s.deep}" opacity="0.7"/>
        <circle cx="3.8" cy="-2" r="0.65" fill="${s.deep}" opacity="0.7"/>
        <circle cx="-3.6" cy="2.4" r="0.65" fill="${s.deep}" opacity="0.7"/>
        <circle cx="0.8" cy="-3.6" r="0.65" fill="${s.deep}" opacity="0.7"/>
        <circle cx="-1.2" cy="0.4" r="0.5" fill="${s.deep}" opacity="0.65"/>
        <circle cx="1.6" cy="-0.6" r="0.5" fill="${s.deep}" opacity="0.65"/>
      </g>`,
    ].join("");
  },
  hydrangea() {
    const s = SKIN.hydrangea;
    const florets = [];
    const positions = [
      [0, -20], [-8, -16], [8, -16],
      [-12, -8], [12, -8], [0, -6],
      [-6, -2], [6, -2], [0, -12],
      [-3, -18], [3, -18],
    ];
    for (let i = 0; i < positions.length; i++) {
      const [px, py] = positions[i];
      const v = i % 2;
      florets.push(`
        <g transform="translate(${px} ${py})">
          <ellipse cx="0" cy="-2.6" rx="2.6" ry="3.6" fill="${v ? s.shade : s.petal}"/>
          <ellipse cx="-2.6" cy="0" rx="3.6" ry="2.6" fill="${s.petal}" opacity="0.92"/>
          <ellipse cx="2.6" cy="0" rx="3.6" ry="2.6" fill="${s.shade}" opacity="0.92"/>
          <ellipse cx="0" cy="2.6" rx="2.6" ry="3.6" fill="${v ? s.petal : s.shade}" opacity="0.96"/>
          <circle cx="0" cy="0" r="1" fill="${s.center}" opacity="0.9"/>
          <path d="M 0 -2.2 L 0 -3.8 M -2.2 0 L -3.8 0 M 2.2 0 L 3.8 0 M 0 2.2 L 0 3.8"
                stroke="${s.deep}" stroke-width="0.3" opacity="0.5"/>
        </g>
      `);
    }
    return [
      stem(H.s5Stem, { width: 2.6, curveX: 1 }),
      `<path d="M ${STEM_X} 95 Q ${STEM_X + 5} 90 ${STEM_X + 9} 84"
              fill="none" stroke="${STEM}" stroke-width="1.8" stroke-linecap="round"/>`,
      heartLeaf({ anchorX: STEM_X, anchorY: 120, rotate: -36, size: 12 }),
      heartLeaf({ anchorX: STEM_X + 9, anchorY: 84, rotate: 42, size: 10, opacity: 0.93 }),
      heartLeaf({ anchorX: STEM_X, anchorY: 132, rotate: 95, size: 10, opacity: 0.88 }),
      `<g transform="translate(${STEM_X} ${H.s5Stem - 4})" filter="${sunFilter("hydrangea", 5)}">${florets.join("")}</g>`,
    ].join("");
  },
  azalea() {
    const s = SKIN.azalea;
    function funnel(cx, cy, rot, scale = 1) {
      return `
        <g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${scale})">
          <ellipse cx="-5.5" cy="-3" rx="4.6" ry="3.4" fill="${s.petal}"/>
          <ellipse cx="5.5" cy="-3" rx="4.6" ry="3.4" fill="${s.petal}" opacity="0.94"/>
          <ellipse cx="0" cy="-7" rx="4.4" ry="4" fill="${s.petal}"/>
          <ellipse cx="-3.4" cy="0.6" rx="3.6" ry="3" fill="${s.shade}" opacity="0.94"/>
          <ellipse cx="3.4" cy="0.6" rx="3.6" ry="3" fill="${s.shade}" opacity="0.94"/>
          <ellipse cx="0" cy="-2.4" rx="1.8" ry="1.6" fill="${s.center}"/>
          <path d="M 0 -2.4 L -1.6 -9 M 0 -2.4 L 1.6 -9 M 0 -2.4 L 0 -10 M 0 -2.4 L -2.6 -7 M 0 -2.4 L 2.6 -7"
                stroke="${s.deep}" stroke-width="0.5" stroke-linecap="round"/>
          <circle cx="-1.6" cy="-9" r="0.65" fill="${s.deep}"/>
          <circle cx="1.6" cy="-9" r="0.65" fill="${s.deep}"/>
          <circle cx="0" cy="-10" r="0.75" fill="${s.deep}"/>
          <path d="M -7 -4 Q -8 -6 -7 -8" stroke="${s.deep}" stroke-width="0.3" fill="none" opacity="0.5"/>
          <path d="M 7 -4 Q 8 -6 7 -8" stroke="${s.deep}" stroke-width="0.3" fill="none" opacity="0.5"/>
        </g>
      `;
    }
    return [
      // all 3 branches root at soil
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 130 ${STEM_X - 10} 108 Q ${STEM_X - 14} 92 ${STEM_X - 15} ${H.s5Stem - 4}"
              fill="none" stroke="${STEM}" stroke-width="2.2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1} 130 ${STEM_X + 9} 110 Q ${STEM_X + 14} 94 ${STEM_X + 14} ${H.s5Stem - 2}"
              fill="none" stroke="${STEM}" stroke-width="2.2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1.5} 125 ${STEM_X + 2.5} 100 Q ${STEM_X + 2} 80 ${STEM_X + 2} ${H.s5Stem - 6}"
              fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X - 13, anchorY: 108, rotate: -55, length: 11, width: 4.2 }),
      leaf({ anchorX: STEM_X - 6, anchorY: 122, rotate: -85, length: 10, width: 4, opacity: 0.9 }),
      leaf({ anchorX: STEM_X + 12, anchorY: 108, rotate: 55, length: 11, width: 4.2 }),
      leaf({ anchorX: STEM_X + 5, anchorY: 124, rotate: 90, length: 10, width: 4, opacity: 0.9 }),
      leaf({ anchorX: STEM_X + 3, anchorY: 114, rotate: 30, length: 9, width: 3.8, opacity: 0.85 }),
      `<g filter="${sunFilter("azalea", 5)}">${funnel(STEM_X - 15, H.s5Stem - 4, -18, 1.0)}</g>`,
      `<g filter="${sunFilter("azalea", 5)}">${funnel(STEM_X + 14, H.s5Stem - 2, 18, 1.0)}</g>`,
      `<g filter="${sunFilter("azalea", 5)}">${funnel(STEM_X + 2, H.s5Stem - 6, 4, 0.95)}</g>`,
    ].join("");
  },
  lily() {
    const s = SKIN.lily;
    const petals = [];
    for (let i = 0; i < 6; i++) {
      const a = 60 * i;
      petals.push(`
        <g transform="rotate(${a})">
          <path d="M 0 0 C 6 -8 6 -22 0 -27 C -6 -22 -6 -8 0 0 Z" fill="${s.petal}" opacity="${i % 2 === 0 ? 1 : 0.93}"/>
          <path d="M 0 0 L 0 -24" stroke="${s.shade}" stroke-width="0.5" opacity="0.6"/>
          <path d="M -2.4 -12 Q 0 -20 2.4 -12" stroke="${s.deep}" stroke-width="0.4" fill="none" opacity="0.45"/>
        </g>
      `);
    }
    return [
      stem(H.s5Stem, { width: 2, curveX: 0.6 }),
      blade({ anchorX: STEM_X, anchorY: 120, rotate: -68, length: 20, width: 2.6 }),
      blade({ anchorX: STEM_X, anchorY: 120, rotate: 68, length: 20, width: 2.6, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 100, rotate: -58, length: 16, width: 2.4 }),
      blade({ anchorX: STEM_X, anchorY: 100, rotate: 58, length: 16, width: 2.4, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 78, rotate: -50, length: 13, width: 2.2, opacity: 0.88 }),
      blade({ anchorX: STEM_X, anchorY: 78, rotate: 50, length: 13, width: 2.2, opacity: 0.88 }),
      blade({ anchorX: STEM_X, anchorY: 60, rotate: -42, length: 10, width: 2, opacity: 0.85 }),
      blade({ anchorX: STEM_X, anchorY: 60, rotate: 42, length: 10, width: 2, opacity: 0.85 }),
      `<g transform="translate(${STEM_X} ${H.s5Stem - 8})" filter="${sunFilter("lily", 5)}">
        ${petals.join("")}
        <circle cx="0" cy="0" r="3" fill="${s.center}"/>
        <path d="M 0 0 L 0 -6 M -1.6 0 L -3.2 -5.5 M 1.6 0 L 3.2 -5.5 M -2.6 0 L -5.2 -4.5 M 2.6 0 L 5.2 -4.5 M 0 0 L 0 -7"
              stroke="${s.deep}" stroke-width="0.55" stroke-linecap="round" opacity="0.85"/>
        <circle cx="0" cy="-6" r="0.8" fill="${s.deep}"/>
        <circle cx="-3.2" cy="-5.5" r="0.7" fill="${s.deep}"/>
        <circle cx="3.2" cy="-5.5" r="0.7" fill="${s.deep}"/>
        <circle cx="-5.2" cy="-4.5" r="0.7" fill="${s.deep}"/>
        <circle cx="5.2" cy="-4.5" r="0.7" fill="${s.deep}"/>
      </g>`,
    ].join("");
  },
  amaranthus() {
    const s = SKIN.amaranthus;
    function tassel({ startX, startY, endX, endY, thickness = 5, fuzz = 10, opacity = 1 }) {
      const cp1x = startX + (endX - startX) * 0.3;
      const cp1y = startY + (endY - startY) * 0.4;
      const cp2x = startX + (endX - startX) * 0.7;
      const cp2y = startY + (endY - startY) * 0.7;
      const bezier = (t) => {
        const u = 1 - t;
        return [
          u * u * u * startX + 3 * u * u * t * cp1x + 3 * u * t * t * cp2x + t * t * t * endX,
          u * u * u * startY + 3 * u * u * t * cp1y + 3 * u * t * t * cp2y + t * t * t * endY,
        ];
      };
      const tangent = (t) => {
        const u = 1 - t;
        return [
          3 * u * u * (cp1x - startX) + 6 * u * t * (cp2x - cp1x) + 3 * t * t * (endX - cp2x),
          3 * u * u * (cp1y - startY) + 6 * u * t * (cp2y - cp1y) + 3 * t * t * (endY - cp2y),
        ];
      };
      let parts = `
        <path d="M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}"
              fill="none" stroke="${s.petal}" stroke-width="${thickness}"
              stroke-linecap="round" opacity="${opacity}"/>
        <path d="M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}"
              fill="none" stroke="${s.shade}" stroke-width="${thickness * 0.5}"
              stroke-linecap="round" opacity="${opacity * 0.55}"/>
      `;
      // sparser fuzz (was 16-22, now 8-12)
      for (let i = 1; i < fuzz; i++) {
        const t = i / fuzz;
        const [x, y] = bezier(t);
        const [dx, dy] = tangent(t);
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len;
        const py = dx / len;
        const hairLen = thickness * 0.55 + t * thickness * 0.2;
        parts += `
          <line x1="${(x - px * hairLen).toFixed(2)}" y1="${(y - py * hairLen).toFixed(2)}"
                x2="${(x + px * hairLen).toFixed(2)}" y2="${(y + py * hairLen).toFixed(2)}"
                stroke="${s.petal}" stroke-width="${(thickness * 0.4).toFixed(2)}"
                stroke-linecap="round" opacity="${opacity * 0.8}"/>
          <line x1="${(x - px * hairLen).toFixed(2)}" y1="${(y - py * hairLen).toFixed(2)}"
                x2="${(x - px * hairLen * 1.3).toFixed(2)}" y2="${(y - py * hairLen * 1.3).toFixed(2)}"
                stroke="${s.hi}" stroke-width="${(thickness * 0.22).toFixed(2)}"
                stroke-linecap="round" opacity="${opacity * 0.7}"/>
        `;
      }
      parts += `<circle cx="${endX}" cy="${endY}" r="${(thickness * 0.45).toFixed(2)}" fill="${s.hi}" opacity="${opacity * 0.9}"/>`;
      return parts;
    }
    return [
      stem(H.s5Stem, { width: 2.8, curveX: 1.2 }),
      blade({ anchorX: STEM_X, anchorY: 128, rotate: -42, length: 26, width: 5.4 }),
      blade({ anchorX: STEM_X, anchorY: 112, rotate: 42, length: 22, width: 5, opacity: 0.92 }),
      blade({ anchorX: STEM_X, anchorY: 94, rotate: -52, length: 17, width: 4.4, opacity: 0.88 }),
      blade({ anchorX: STEM_X, anchorY: 76, rotate: 48, length: 13, width: 4, opacity: 0.85 }),
      `<ellipse cx="${STEM_X}" cy="${H.s5Stem - 2}" rx="4" ry="2.8" fill="${s.shade}"/>`,
      `<ellipse cx="${STEM_X - 0.8}" cy="${H.s5Stem - 3}" rx="2.2" ry="1.4" fill="${s.petal}" opacity="0.85"/>`,
      // toned down: 3 hanging tassels + 1 short topknot
      `<g filter="${sunFilterSoft("amaranthus", 5)}">
        ${tassel({ startX: STEM_X - 3, startY: H.s5Stem - 1, endX: STEM_X - 9, endY: H.s5Stem + 60, thickness: 4.4, fuzz: 10, opacity: 0.92 })}
        ${tassel({ startX: STEM_X + 3, startY: H.s5Stem - 1, endX: STEM_X + 10, endY: H.s5Stem + 64, thickness: 4.4, fuzz: 10, opacity: 0.92 })}
        ${tassel({ startX: STEM_X, startY: H.s5Stem - 3, endX: STEM_X + 1, endY: H.s5Stem + 78, thickness: 5.2, fuzz: 12, opacity: 1 })}
        ${tassel({ startX: STEM_X, startY: H.s5Stem - 4, endX: STEM_X - 1, endY: H.s5Stem - 22, thickness: 3.4, fuzz: 6, opacity: 0.88 })}
      </g>`,
    ].join("");
  },
  cherry() {
    const s = SKIN.cherry;
    return [
      // main trunk (bark)
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 105 ${STEM_X - 2} 70"
              fill="none" stroke="${s.bark}" stroke-width="4.2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.5} 105 ${STEM_X - 2} 71"
              fill="none" stroke="rgba(0,0,0,0.32)" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/>`,
      // major branches spreading wide
      `<path d="M ${STEM_X - 1} 100 Q ${STEM_X - 15} 80 ${STEM_X - 24} 55 Q ${STEM_X - 28} 42 ${STEM_X - 29} 30"
              fill="none" stroke="${s.bark}" stroke-width="2.6" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X - 1} 80 Q ${STEM_X + 12} 70 ${STEM_X + 20} 50 Q ${STEM_X + 26} 35 ${STEM_X + 28} 22"
              fill="none" stroke="${s.bark}" stroke-width="2.6" stroke-linecap="round"/>`,
      // smaller secondary branches
      `<path d="M ${STEM_X - 2} 90 Q ${STEM_X - 9} 75 ${STEM_X - 11} 58"
              fill="none" stroke="${s.bark}" stroke-width="1.8" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X - 2} 70 Q ${STEM_X + 6} 55 ${STEM_X + 10} 40"
              fill="none" stroke="${s.bark}" stroke-width="1.8" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X - 2} 70 L ${STEM_X - 2} 45 L ${STEM_X + 2} 28 L ${STEM_X + 4} ${H.s5}"
              fill="none" stroke="${s.bark}" stroke-width="2" stroke-linecap="round"/>`,
      // a few small leaves
      leaf({ anchorX: STEM_X - 22, anchorY: 56, rotate: -60, length: 8, width: 3.2 }),
      leaf({ anchorX: STEM_X + 18, anchorY: 50, rotate: 60, length: 8, width: 3.2 }),
      leaf({ anchorX: STEM_X - 9, anchorY: 68, rotate: -40, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X + 7, anchorY: 45, rotate: 50, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X - 4, anchorY: 35, rotate: -30, length: 6, width: 2.8, opacity: 0.9 }),
      // blossom clusters at branch tips + scattered along
      `<g filter="${sunFilter("cherry", 5)}">
        ${cherryBlossom(STEM_X - 29, 30, 1)}
        ${cherryBlossom(STEM_X - 32, 25, 0.85)}
        ${cherryBlossom(STEM_X - 25, 28, 0.9)}
        ${cherryBlossom(STEM_X - 27, 36, 0.8)}
        ${cherryBlossom(STEM_X + 28, 22, 1)}
        ${cherryBlossom(STEM_X + 31, 17, 0.85)}
        ${cherryBlossom(STEM_X + 24, 25, 0.9)}
        ${cherryBlossom(STEM_X + 27, 30, 0.8)}
        ${cherryBlossom(STEM_X - 11, 58, 0.95)}
        ${cherryBlossom(STEM_X - 14, 54, 0.8)}
        ${cherryBlossom(STEM_X + 10, 40, 0.95)}
        ${cherryBlossom(STEM_X + 6, 44, 0.8)}
        ${cherryBlossom(STEM_X + 4, H.s5, 1)}
        ${cherryBlossom(STEM_X + 8, H.s5 + 4, 0.85)}
        ${cherryBlossom(STEM_X, 22, 0.8)}
      </g>`,
    ].join("");
  },
  wisteria() {
    return [
      stem(H.s5Stem, { width: 2.4, curveX: 1.4 }),
      // horizontal arbor branch — where racemes hang from
      `<path d="M ${STEM_X - 16} ${H.s5Stem + 4} Q ${STEM_X} ${H.s5Stem - 1} ${STEM_X + 16} ${H.s5Stem + 4}"
              fill="none" stroke="${STEM}" stroke-width="2.2" stroke-linecap="round"/>`,
      // compound leaves along stem
      `<path d="M ${STEM_X} 110 Q ${STEM_X + 6} 106 ${STEM_X + 13} 102"
              fill="none" stroke="${STEM}" stroke-width="1" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X + 5, anchorY: 109, rotate: 60, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X + 9, anchorY: 105, rotate: 70, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X + 13, anchorY: 102, rotate: 82, length: 6, width: 2.8 }),
      `<path d="M ${STEM_X} 88 Q ${STEM_X - 6} 84 ${STEM_X - 13} 80"
              fill="none" stroke="${STEM}" stroke-width="1" stroke-linecap="round"/>`,
      leaf({ anchorX: STEM_X - 5, anchorY: 87, rotate: -60, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X - 9, anchorY: 83, rotate: -70, length: 7, width: 3 }),
      leaf({ anchorX: STEM_X - 13, anchorY: 80, rotate: -82, length: 6, width: 2.8 }),
      // hanging racemes — 3-4 cones drooping from the arbor branch
      `<g filter="${sunFilter("wisteria", 5)}">
        <g>${wisteriaRaceme(STEM_X - 14, H.s5Stem + 6, 36)}</g>
        <g>${wisteriaRaceme(STEM_X - 5, H.s5Stem + 4, 48)}</g>
        <g>${wisteriaRaceme(STEM_X + 5, H.s5Stem + 4, 44)}</g>
        <g>${wisteriaRaceme(STEM_X + 14, H.s5Stem + 6, 32)}</g>
      </g>`,
    ].join("");
  },
  lotus() {
    return [
      stem(H.s5Stem, { width: 2.2, curveX: 0.6 }),
      // lily pad leaf at base on a long stalk that arcs out to the right
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 10} 142 ${STEM_X + 18} 138"
              fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X + 18} 138) scale(0.65)">
        <ellipse cx="0" cy="0" rx="13" ry="10" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4"/>
        <path d="M 0 0 L 10 -5 M 0 0 L 12 0 M 0 0 L 9 5 M 0 0 L -9 -5 M 0 0 L -12 0 M 0 0 L -8 5 M 0 0 L 2 -8 M 0 0 L -3 7"
              stroke="${VEIN_LITE}" stroke-width="0.5" fill="none" opacity="0.6"/>
      </g>`,
      // second smaller pad on the left at a different height
      `<path d="M ${STEM_X} 135 Q ${STEM_X - 8} 132 ${STEM_X - 14} 128"
              fill="none" stroke="${STEM}" stroke-width="1.6" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X - 14} 128) scale(0.45)">
        <ellipse cx="0" cy="0" rx="12" ry="9" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4" opacity="0.92"/>
        <path d="M 0 0 L 9 -4 M 0 0 L 11 0 M 0 0 L 8 4 M 0 0 L -8 -4 M 0 0 L -11 0 M 0 0 L -7 4"
              stroke="${VEIN_LITE}" stroke-width="0.5" fill="none" opacity="0.6"/>
      </g>`,
      // open lotus at top
      `<g transform="translate(${STEM_X} ${H.s5Stem - 5})" filter="${sunFilter("lotus", 5)}">
        ${lotusFlower(0, 0, 1)}
      </g>`,
    ].join("");
  },
  iris() {
    const s = SKIN.iris;
    return [
      stem(H.s5Stem, { width: 1.8, curveX: 0.4 }),
      // sword-shaped vertical leaves at the base
      blade({ anchorX: STEM_X - 2, anchorY: SOIL_Y, rotate: -8, length: 68, width: 5 }),
      blade({ anchorX: STEM_X + 2, anchorY: SOIL_Y, rotate: 10, length: 64, width: 4.8, opacity: 0.92 }),
      blade({ anchorX: STEM_X - 4, anchorY: SOIL_Y, rotate: -22, length: 50, width: 4.4, opacity: 0.85 }),
      blade({ anchorX: STEM_X + 4, anchorY: SOIL_Y, rotate: 22, length: 48, width: 4.4, opacity: 0.85 }),
      blade({ anchorX: STEM_X - 6, anchorY: SOIL_Y, rotate: -34, length: 36, width: 4, opacity: 0.8 }),
      blade({ anchorX: STEM_X + 6, anchorY: SOIL_Y, rotate: 34, length: 36, width: 4, opacity: 0.8 }),
      // open iris flower at top
      `<g transform="translate(${STEM_X} ${H.s5Stem - 4})" filter="${sunFilter("iris", 5)}">
        ${irisFlower(0, 0, 1)}
      </g>`,
    ].join("");
  },
  bird() {
    return [
      stem(H.s5Stem, { width: 3, curveX: 1 }),
      // three big banana leaves on long stalks
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 5} 118 ${STEM_X - 16} 92"
              fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X - 16} 92)">
        <path d="M 0 0 C -3 -12 -2 -28 6 -36 C 14 -28 12 -10 8 -3 C 4 -1 0 0 0 0 Z"
              fill="${LEAF}" stroke="${VEIN}" stroke-width="0.45"/>
        <path d="M 0 0 C -1 -10 0 -22 6 -32" stroke="${VEIN}" stroke-width="0.55" fill="none" opacity="0.6"/>
      </g>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X + 5} 116 ${STEM_X + 16} 88"
              fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X + 16} 88)">
        <path d="M 0 0 C 3 -12 2 -28 -6 -36 C -14 -28 -12 -10 -8 -3 C -4 -1 0 0 0 0 Z"
              fill="${LEAF}" stroke="${VEIN}" stroke-width="0.45" opacity="0.95"/>
        <path d="M 0 0 C 1 -10 0 -22 -6 -32" stroke="${VEIN}" stroke-width="0.55" fill="none" opacity="0.6"/>
      </g>`,
      `<path d="M ${STEM_X + 1} ${SOIL_Y - 3} Q ${STEM_X - 2} 100 ${STEM_X - 7} 76"
              fill="none" stroke="${STEM}" stroke-width="1.6" stroke-linecap="round"/>`,
      `<g transform="translate(${STEM_X - 7} 76)">
        <path d="M 0 0 C -2 -8 -2 -16 3 -20 C 8 -16 7 -7 4 -2 C 2 -1 0 0 0 0 Z"
              fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4" opacity="0.92"/>
      </g>`,
      // the signature bloom at the top — placed so the spathe base
      // sits exactly at the stem top (bloom origin = stem apex)
      `<g transform="translate(${STEM_X} ${H.s5Stem})" filter="${sunFilter("bird", 5)}">
        ${birdOfParadiseFlower(0, 0, 1)}
      </g>`,
    ].join("");
  },
  bamboo() {
    // bamboo grove — 4 stalks of varying heights and offsets
    return [
      bambooStalk(STEM_X - 16, SOIL_Y, (SOIL_Y - H.s5) * 0.78, 6, 2.6),
      bambooStalk(STEM_X - 6, SOIL_Y, SOIL_Y - H.s5, 7, 3.2),
      bambooStalk(STEM_X + 6, SOIL_Y, (SOIL_Y - H.s5) * 0.94, 7, 3),
      bambooStalk(STEM_X + 16, SOIL_Y, (SOIL_Y - H.s5) * 0.72, 5, 2.6),
    ].join("");
  },
  jacaranda() {
    const s = SKIN.jacaranda;
    return [
      // trunk + branch network similar to cherry but with feathery
      // foliage and blue-purple flower clusters
      `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 100 ${STEM_X - 2} 68"
              fill="none" stroke="${s.bark}" stroke-width="4" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.5} 100 ${STEM_X - 2} 69"
              fill="none" stroke="rgba(0,0,0,0.3)" stroke-width="1.3" stroke-linecap="round" opacity="0.5"/>`,
      `<path d="M ${STEM_X - 1} 96 Q ${STEM_X - 15} 78 ${STEM_X - 22} 52 Q ${STEM_X - 26} 38 ${STEM_X - 28} 28"
              fill="none" stroke="${s.bark}" stroke-width="2.4" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X - 1} 80 Q ${STEM_X + 12} 70 ${STEM_X + 20} 48 Q ${STEM_X + 26} 32 ${STEM_X + 28} ${H.s5 + 4}"
              fill="none" stroke="${s.bark}" stroke-width="2.4" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X - 2} 68 L ${STEM_X - 2} 40 L ${STEM_X + 4} 24 L ${STEM_X + 4} ${H.s5}"
              fill="none" stroke="${s.bark}" stroke-width="2" stroke-linecap="round"/>`,
      // a few small fern-like leaflets
      leaf({ anchorX: STEM_X - 22, anchorY: 50, rotate: -50, length: 6, width: 2.2 }),
      leaf({ anchorX: STEM_X - 24, anchorY: 44, rotate: -65, length: 6, width: 2.2 }),
      leaf({ anchorX: STEM_X + 18, anchorY: 48, rotate: 50, length: 6, width: 2.2 }),
      leaf({ anchorX: STEM_X + 22, anchorY: 42, rotate: 65, length: 6, width: 2.2 }),
      leaf({ anchorX: STEM_X - 3, anchorY: 38, rotate: -30, length: 5, width: 2 }),
      leaf({ anchorX: STEM_X + 4, anchorY: 32, rotate: 35, length: 5, width: 2 }),
      // blue-purple trumpet flower clusters scattered along branches
      `<g filter="${sunFilter("jacaranda", 5)}">
        ${jacarandaCluster(STEM_X - 28, 28, 1)}
        ${jacarandaCluster(STEM_X - 22, 38, 0.9)}
        ${jacarandaCluster(STEM_X - 12, 56, 0.85)}
        ${jacarandaCluster(STEM_X + 28, H.s5 + 4, 1)}
        ${jacarandaCluster(STEM_X + 20, 38, 0.9)}
        ${jacarandaCluster(STEM_X + 10, 50, 0.85)}
        ${jacarandaCluster(STEM_X + 4, H.s5, 1)}
        ${jacarandaCluster(STEM_X - 2, 30, 0.85)}
      </g>`,
    ].join("");
  },
  cereus() {
    // Tall slender ribbed Cereus column with a large white
    // night-blooming flower at the top + a secondary side bud.
    const halfW = 6;
    const top = H.s5 + 12; // column reaches near the top, flower above
    return [
      cereusColumn(STEM_X, SOIL_Y, top, halfW),
      // small lateral side bud on the right side of the column
      `<g transform="translate(${STEM_X + halfW + 1} 80) rotate(20)" filter="${sunFilter("cereus", 5)}">
        <ellipse cx="0" cy="0" rx="2.2" ry="3.4" fill="${SKIN.cereus.petal}" stroke="${SKIN.cereus.deep}" stroke-width="0.35"/>
        <ellipse cx="-0.4" cy="-0.4" rx="1.4" ry="2.4" fill="${SKIN.cereus.cream}" opacity="0.85"/>
        <path d="M -2 1.5 Q -3 2.5 -3.4 4 M 2 1.5 Q 3 2.5 3.4 4"
              stroke="${SKIN.cereus.shade}" stroke-width="0.55" stroke-linecap="round" fill="none"/>
      </g>`,
      // large open white flower at the apex (the Cereus signature bloom)
      `<g transform="translate(${STEM_X} ${top - 2})" filter="${sunFilter("cereus", 5)}">
        ${cereusFlower(0, 0, 1)}
      </g>`,
    ].join("");
  },
  dragon() {
    const s = SKIN.dragon;
    return [
      // very thick trunk
      `<path d="M ${STEM_X - 1.5} ${SOIL_Y} Q ${STEM_X - 1} 100 ${STEM_X} 60"
              fill="none" stroke="${s.bark}" stroke-width="5" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X + 1.5} ${SOIL_Y} Q ${STEM_X + 1} 100 ${STEM_X} 60"
              fill="none" stroke="${s.barkShade}" stroke-width="2.6" stroke-linecap="round" opacity="0.65"/>`,
      // bark grooves
      `<path d="M ${STEM_X - 1.6} 130 L ${STEM_X - 1.6} 105 M ${STEM_X + 1.6} 120 L ${STEM_X + 1.6} 95"
              stroke="${s.barkShade}" stroke-width="0.5" stroke-linecap="round" opacity="0.55"/>`,
      // a few drips of red sap on the trunk (signature feature)
      `<circle cx="${STEM_X - 2}" cy="115" r="0.9" fill="${s.sap}" opacity="0.85"/>`,
      `<circle cx="${STEM_X + 1.6}" cy="135" r="0.7" fill="${s.sap}" opacity="0.75"/>`,
      // primary branches splaying upward and outward into the umbrella canopy
      `<path d="M ${STEM_X} 60 Q ${STEM_X - 6} 50 ${STEM_X - 14} 42"
              fill="none" stroke="${s.bark}" stroke-width="2.6" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} 60 Q ${STEM_X + 6} 50 ${STEM_X + 14} 42"
              fill="none" stroke="${s.bark}" stroke-width="2.6" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} 60 Q ${STEM_X - 2} 48 ${STEM_X - 4} 38"
              fill="none" stroke="${s.bark}" stroke-width="2.2" stroke-linecap="round"/>`,
      `<path d="M ${STEM_X} 60 Q ${STEM_X + 2} 48 ${STEM_X + 4} 38"
              fill="none" stroke="${s.bark}" stroke-width="2.2" stroke-linecap="round"/>`,
      // signature umbrella canopy spreading wide across the top
      `<g transform="translate(${STEM_X} 40)" filter="${sunFilter("dragon", 5)}">
        ${dragonCanopy(0, 0, 1.6)}
      </g>`,
    ].join("");
  },
};

/* ──────────────────────────────────────────────────────────────
   composer + grid
   ────────────────────────────────────────────────────────────── */

// Return raw markup for a single stage (no wrappers).
function stageContent(flower, stageIdx) {
  if (stageIdx === 1) return stage1(flower);
  if (stageIdx === 2) return stage2(flower);
  if (stageIdx === 3) return stage3[flower]?.() ?? "";
  if (stageIdx === 4) return stage4[flower]?.() ?? "";
  if (stageIdx === 5) return stage5[flower]?.() ?? "";
  return "";
}

// =====================================================================
// per-species, per-element growth choreography
// =====================================================================
// Each species opting into growth animation defines a builder that
// emits the full SVG body for a target stage, with element-level CSS
// animations choreographed across phases:
//
//   phase 1: seed → sprout       (seed retracts, stem starts drawing,
//                                 cotyledons emerge at sprout apex)
//   phase 2: sprout → young      (cotyledons retract, stem grows on,
//                                 base leaves emerge, growing tip pops)
//   phase 3: young → bud         (growing tip retracts, closed bud
//                                 swells onto the apex, calyx unfurls)
//   phase 4: bud → bloom         (closed bud retracts, petals unfurl
//                                 from the bud centre — back petal
//                                 rises straight, side petals open
//                                 outward with a rotation)
//
// Stems use stroke-dashoffset to "draw" from soil upward. Leaves,
// petals, and buds use CSS scale animations (transform-origin set
// per-element so each pivots on its own attachment point).
// Persistent elements stay; transient elements retract before the
// next phase's element emerges in the same position.

// Timing constants — chosen so each transition reads as a deliberate
// growth beat rather than a flash.
const PHASE = 1.25;     // seconds per phase boundary
const PRE = 0.3;        // initial breath before any animation
const FADE = 0.65;      // retraction duration
const EMERGE = 0.95;    // emerge duration default

// Easing curves — kept consistent across all elements so the panel
// reads as one coherent piece of motion rather than a mix of styles.
// `cubic-bezier(0.32, 0.72, 0.32, 1)` is a soft ease-out: slow finish,
// natural feel as the element settles into place.
const EASE_EMERGE = "cubic-bezier(0.32, 0.72, 0.32, 1)";
const EASE_RETRACT = "cubic-bezier(0.6, 0, 0.85, 0.3)";
const EASE_STEM = "cubic-bezier(0.4, 0.05, 0.55, 0.95)"; // gentle ease-in-out
const EASE_FALL = "cubic-bezier(0.42, 0, 0.72, 1)";      // gravity ease-in

// Helper: emerge-only animation (final state — stays at scale 1).
function aEmerge(pivotX, pivotY, startAt, dur = EMERGE, kf = "el-emerge") {
  return `transform-origin: ${pivotX}px ${pivotY}px; transform: scale(0); ` +
    `animation: ${kf} ${dur}s ${EASE_EMERGE} ${startAt.toFixed(2)}s forwards;`;
}

// Helper: emerge then retract (transient stage element).
function aEmergeRetract(pivotX, pivotY, startAt, retractAt, emergeDur = EMERGE, kf = "el-emerge") {
  return `transform-origin: ${pivotX}px ${pivotY}px; transform: scale(0); ` +
    `animation: ${kf} ${emergeDur}s ${EASE_EMERGE} ${startAt.toFixed(2)}s forwards, ` +
    `el-retract ${FADE}s ${EASE_RETRACT} ${retractAt.toFixed(2)}s forwards;`;
}

// Helper: visible from t=0 then retracts (the initial seed shape).
function aRetract(pivotX, pivotY, retractAt) {
  return `transform-origin: ${pivotX}px ${pivotY}px; ` +
    `animation: el-retract ${FADE}s ${EASE_RETRACT} ${retractAt.toFixed(2)}s forwards;`;
}

// Helper: emerge, then "fall off" via a directional fall keyframe
// (translate + rotate + fade). Used for cotyledons that the plant
// sheds once true leaves take over.
function aEmergeFall(pivotX, pivotY, emergeAt, fallAt, fallKf, emergeDur = EMERGE, fallDur = 1.4) {
  return `transform-origin: ${pivotX}px ${pivotY}px; transform: scale(0); ` +
    `animation: leaf-emerge ${emergeDur}s ${EASE_EMERGE} ${emergeAt.toFixed(2)}s forwards, ` +
    `${fallKf} ${fallDur}s ${EASE_FALL} ${fallAt.toFixed(2)}s forwards;`;
}

function tulipGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("tulip", targetIdx);
  if (targetIdx === 1) return stage1("tulip");

  const s = SKIN.tulip;

  // === STEM GEOMETRY + STEM-DRIVEN TIMING ===
  // The stem is the source of all growth — every other element only
  // emerges once the stem has visually grown to reach that element's
  // attachment point. We compute `stemReachesAt(y)` which returns the
  // absolute timestamp at which the drawing stem crosses height `y`.
  const stemTop = { 2: H.s2, 3: H.s3, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemRange = SOIL_Y - stemTop;
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.2} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.2} ${stemMidY} ${STEM_X} ${stemTop + 1}`;

  // Linear-approximation of when the stem reaches a given y. The stem
  // uses a near-linear ease so this is accurate to within a few frames.
  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / stemRange);
  };

  let html = "";

  // === SEED — visible from t=0, retracts as the stem starts pushing
  // up. The seed "cracks" so the sprout can emerge — retraction
  // completes before the cotyledons appear on the rising stem tip.
  html += `<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("tulip")}</g>`;

  // === STEM (continuous path, drawn progressively from soil up) ===
  html += `<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="2.4" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
  html += `<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM_VEIN}" stroke-width="0.84" stroke-linecap="round" opacity="0.55"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;

  // === COTYLEDONS — emerge only once the stem reaches sprout height,
  // then drop and fade away when true leaves take over. Each side
  // gets its own directional fall keyframe so the leaves tumble
  // outward rather than collapsing in place. ===
  const cotyX = STEM_X + 0.5;
  const cotyY = H.s2;
  const cotyEmergeAt = stemReachesAt(cotyY);
  // For target >= 3, cotyledons fall off once the stem has matured
  // past them and the apex reaches young-plant height.
  const cotyFallAt = stemReachesAt(H.s3);
  const leftCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-left")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  const rightCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-right")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  // left cotyledon
  html += `<g style="${leftCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;
  // right cotyledon
  html += `<g style="${rightCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;

  if (targetIdx === 2) return html;

  // === BASE BLADE LEAVES — true leaves emerge alongside the pre-bud
  // when the stem reaches young-plant height. Each blade unfurls
  // staggered for natural rhythm. ===
  const bladeEmergeBase = stemReachesAt(H.s3);
  const bladeSpec = {
    3: [
      { rotate: -14, length: 52, width: 5 },
      { rotate: 16, length: 46, width: 4.6, opacity: 0.92 },
      { rotate: -32, length: 30, width: 3.4, opacity: 0.85, yOffset: -4 },
    ],
    4: [
      { rotate: -14, length: 60, width: 5.2 },
      { rotate: 16, length: 56, width: 4.8, opacity: 0.92 },
      { rotate: -32, length: 36, width: 3.6, opacity: 0.85, yOffset: -4 },
    ],
    5: [
      { rotate: -14, length: 64, width: 5.4 },
      { rotate: 16, length: 58, width: 5.2, opacity: 0.92 },
      { rotate: -32, length: 44, width: 4, opacity: 0.85, yOffset: -4 },
    ],
  }[targetIdx];
  bladeSpec.forEach((b, idx) => {
    const ax = STEM_X;
    const ay = SOIL_Y + (b.yOffset || 0);
    const len = b.length;
    const w = b.width;
    const op = b.opacity ?? 1;
    const startAt = bladeEmergeBase + idx * 0.18;
    const bladeBody = `<g transform="translate(${ax} ${ay}) rotate(${b.rotate})">
      <path d="M 0 0 Q ${w * 0.5} ${-len * 0.4} 0 ${-len} Q ${-w * 0.5} ${-len * 0.4} 0 0 Z"
            fill="${LEAF}" opacity="${op}"/>
      <path d="M 0 -2 L 0 ${-len + 2}" stroke="${VEIN_LITE}" stroke-width="0.5"/>
    </g>`;
    html += `<g style="${aEmerge(ax, ay, startAt, EMERGE, "leaf-emerge")}">${bladeBody}</g>`;
  });

  // === GROWING TIP (pre-bud) — emerges when stem reaches young apex.
  // For target stage 3, the pre-bud is the final state. For target
  // >= 4, the pre-bud rides the stem tip upward as the stem keeps
  // growing toward the budding height, then dissolves as the larger
  // closed bud emerges in the same spot (a continuous transform).
  const preBudY = H.s3;
  const preBudEmergeAt = stemReachesAt(preBudY);
  const preBudEmergeDur = 0.6; // small element — quicker emerge
  const preBudBody = `<g transform="translate(${STEM_X} ${preBudY})">
    <ellipse cx="0" cy="-3.5" rx="2.2" ry="3.5" fill="${LEAF}" opacity="0.95"/>
    <path d="M 0 -9 L 0 -2" stroke="${STEM_VEIN}" stroke-width="0.4" opacity="0.55"/>
  </g>`;
  if (targetIdx === 3) {
    html += `<g style="${aEmerge(STEM_X, preBudY, preBudEmergeAt, EMERGE, "bud-swell")}">${preBudBody}</g>`;
    return html;
  }
  // For target >= 4: rise with the stem then fade at the new apex.
  const preBudRiseStart = preBudEmergeAt + preBudEmergeDur;
  const preBudFadeAt = stemReachesAt(H.s4);
  const preBudRiseDur = Math.max(0.3, preBudFadeAt - preBudRiseStart);
  const preBudFadeDur = 0.45;
  const preBudStyle =
    `transform-origin: ${STEM_X}px ${preBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${preBudEmergeDur}s ${EASE_EMERGE} ${preBudEmergeAt.toFixed(2)}s forwards, ` +
    `pre-bud-rise ${preBudRiseDur.toFixed(2)}s linear ${preBudRiseStart.toFixed(2)}s forwards, ` +
    `pre-bud-fade ${preBudFadeDur}s ${EASE_RETRACT} ${preBudFadeAt.toFixed(2)}s forwards;`;
  html += `<g style="${preBudStyle}">${preBudBody}</g>`;

  // === CLOSED BUD — emerges when stem reaches budding height ===
  const budY = H.s4 + 2;
  const budEmergeAt = stemReachesAt(H.s4);
  const closedBudBody = `<g transform="translate(${STEM_X} ${budY})">
    <path d="M 0 0 C -7 -2 -8 -12 0 -20 C 8 -12 7 -2 0 0 Z" fill="${s.petal}"/>
    <path d="M -3 -3 C -4 -8 -2 -16 0 -19" stroke="${s.shade}" stroke-width="0.7" fill="none" opacity="0.7"/>
    <path d="M 3 -3 C 4 -8 2 -16 0 -19" stroke="${s.deep}" stroke-width="0.6" fill="none" opacity="0.6"/>
    <path d="M 0 -19 L 0 -1" stroke="${s.deep}" stroke-width="0.5" opacity="0.55"/>
  </g>`;
  const calyxBody = `<g transform="translate(${STEM_X} ${budY})">
    <path d="M -3 -1 Q -5 2 -5 5 M 3 -1 Q 5 2 5 5"
          stroke="${STEM}" stroke-width="0.8" stroke-linecap="round" fill="none"/>
  </g>`;
  if (targetIdx === 4) {
    html += `<g style="${aEmerge(STEM_X, budY, budEmergeAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`;
    html += `<g style="${aEmerge(STEM_X, budY + 4, budEmergeAt + 0.25, EMERGE * 0.7)}">${calyxBody}</g>`;
    return html;
  }
  // Stage 5: closed bud retracts when stem reaches the bloom apex
  const budRetractAt = stemReachesAt(H.s5Stem);
  html += `<g style="${aEmergeRetract(STEM_X, budY, budEmergeAt, budRetractAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`;
  // calyx persists at stage 5
  html += `<g style="${aEmerge(STEM_X, budY + 4, budEmergeAt + 0.25, EMERGE * 0.7)}">${calyxBody}</g>`;

  // === STAGE 5: OPEN PETALS — bloom when stem reaches the apex ===
  const petalY = H.s5Stem;
  const petalsEmergeAt = stemReachesAt(petalY);
  // Back petal (rises straight from centre)
  const backPetalBody = `<g transform="translate(${STEM_X} ${petalY})">
    <path d="M 0 0 C -13 -5 -13 -22 0 -30 C 13 -22 13 -5 0 0 Z" fill="${s.shade}"/>
    <path d="M 0 -2 L 0 -24" stroke="${s.deep}" stroke-width="0.55" opacity="0.5"/>
  </g>`;
  html += `<g style="${aEmerge(STEM_X, petalY, petalsEmergeAt, 1.0, "petal-back-bloom")}">${backPetalBody}</g>`;
  // Left front petal (opens outward — rotation handled by petal-left-bloom keyframe)
  const leftPetalBody = `<g transform="translate(${STEM_X} ${petalY})">
    <path d="M 0 -1 C -10 -7 -12 -22 -5 -29 C -1 -19 0 -12 0 -1 Z" fill="${s.petal}"/>
    <path d="M -1 -3 C -3 -10 -2 -22 -1 -27" stroke="${s.deep}" stroke-width="0.55" fill="none" opacity="0.55"/>
  </g>`;
  html += `<g style="transform-origin: ${STEM_X}px ${petalY}px; transform: scale(0); animation: petal-left-bloom 1.0s ${EASE_EMERGE} ${(petalsEmergeAt + 0.1).toFixed(2)}s forwards;">${leftPetalBody}</g>`;
  // Right front petal (mirror)
  const rightPetalBody = `<g transform="translate(${STEM_X} ${petalY})">
    <path d="M 0 -1 C 10 -7 12 -22 5 -29 C 1 -19 0 -12 0 -1 Z" fill="${s.petal}" opacity="0.94"/>
    <path d="M 1 -3 C 3 -10 2 -22 1 -27" stroke="${s.deep}" stroke-width="0.55" fill="none" opacity="0.55"/>
  </g>`;
  html += `<g style="transform-origin: ${STEM_X}px ${petalY}px; transform: scale(0); animation: petal-right-bloom 1.0s ${EASE_EMERGE} ${(petalsEmergeAt + 0.18).toFixed(2)}s forwards;">${rightPetalBody}</g>`;

  return html;
}

function daisyGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("daisy", targetIdx);
  if (targetIdx === 1) return stage1("daisy");

  const s = SKIN.daisy;

  // Daisy-specific stem geometry. Daisy stems are slightly shorter
  // and thinner than tulip's; the bloom sits a few units above the
  // final stem top so the flower head reads as resting on the stem.
  const stemTop = { 2: H.s2, 3: H.s3 + 4, 4: H.s4 + 4, 5: H.s5Stem + 5 }[targetIdx];
  const stemRange = SOIL_Y - stemTop;
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.0} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.0} ${stemMidY} ${STEM_X} ${stemTop + 1}`;

  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / stemRange);
  };

  let html = "";

  // === SEED — retracts as the stem starts pushing up ===
  html += `<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("daisy")}</g>`;

  // === STEM (thinner than tulip — width 2) ===
  html += `<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
  html += `<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM_VEIN}" stroke-width="0.7" stroke-linecap="round" opacity="0.55"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;

  // === COTYLEDONS — universal sprout pair, falls off when true
  // leaves emerge (target >= 3) ===
  const cotyX = STEM_X + 0.5;
  const cotyY = H.s2;
  const cotyEmergeAt = stemReachesAt(cotyY);
  const cotyFallAt = stemReachesAt(H.s3);
  const leftCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-left")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  const rightCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-right")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  html += `<g style="${leftCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;
  html += `<g style="${rightCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;

  if (targetIdx === 2) return html;

  // === BASE OVAL LEAVES — attach to the stem at y=140 and y=122.
  // Daisy "true leaves" emerge as a rosette once the plant has
  // matured past the sprout stage. They appear when the stem reaches
  // young-plant height (H.s3) so the order reads as: cotyledons fall
  // → true leaves unfurl. ===
  const leafSpec = {
    3: [
      { y: 140, rotate: -65, length: 16, width: 5.5 },
      { y: 140, rotate: 65, length: 16, width: 5.5, opacity: 0.92 },
      { y: 126, rotate: -50, length: 12, width: 4.4, opacity: 0.88 },
      { y: 126, rotate: 50, length: 11, width: 4.2, opacity: 0.86 },
    ],
    4: [
      { y: 140, rotate: -65, length: 17, width: 5.6 },
      { y: 140, rotate: 65, length: 17, width: 5.6, opacity: 0.92 },
      { y: 122, rotate: -50, length: 12, width: 4.5, opacity: 0.88 },
      { y: 122, rotate: 50, length: 11, width: 4.3, opacity: 0.86 },
    ],
    5: [
      { y: 140, rotate: -65, length: 18, width: 5.8 },
      { y: 140, rotate: 65, length: 18, width: 5.8, opacity: 0.92 },
      { y: 122, rotate: -50, length: 13, width: 4.6, opacity: 0.88 },
      { y: 122, rotate: 50, length: 12, width: 4.4, opacity: 0.86 },
    ],
  }[targetIdx];
  const leafEmergeBase = stemReachesAt(H.s3);
  leafSpec.forEach((cfg, idx) => {
    const leafBody = leaf({
      anchorX: STEM_X,
      anchorY: cfg.y,
      rotate: cfg.rotate,
      length: cfg.length,
      width: cfg.width,
      opacity: cfg.opacity ?? 1,
      sway: false,
    });
    const startAt = leafEmergeBase + idx * 0.18;
    html += `<g style="${aEmerge(STEM_X, cfg.y, startAt, EMERGE, "leaf-emerge")}">${leafBody}</g>`;
  });

  // === GROWING TIP (pre-bud) — small green circle at the apex ===
  const preBudY = H.s3 + 4; // 89
  const preBudEmergeAt = stemReachesAt(preBudY);
  const preBudEmergeDur = 0.6;
  const preBudBody = `<g transform="translate(${STEM_X} ${preBudY})">
    <g transform="translate(0 -2)">
      <circle cx="0" cy="0" r="2.2" fill="${LEAF}"/>
      <path d="M 0 -2 L 0 2" stroke="${STEM_VEIN}" stroke-width="0.4" opacity="0.5"/>
    </g>
  </g>`;
  if (targetIdx === 3) {
    html += `<g style="${aEmerge(STEM_X, preBudY, preBudEmergeAt, EMERGE, "bud-swell")}">${preBudBody}</g>`;
    return html;
  }
  // For target >= 4: pre-bud rises with the stem from y=89 to y=54
  // (about 35 viewBox units up, ~45 CSS px), then dissolves as the
  // larger closed bud emerges in the same spot.
  const preBudRiseStart = preBudEmergeAt + preBudEmergeDur;
  const preBudFadeAt = stemReachesAt(H.s4 + 4);
  const preBudRiseDur = Math.max(0.3, preBudFadeAt - preBudRiseStart);
  const preBudFadeDur = 0.45;
  const preBudStyle =
    `transform-origin: ${STEM_X}px ${preBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${preBudEmergeDur}s ${EASE_EMERGE} ${preBudEmergeAt.toFixed(2)}s forwards, ` +
    `pre-bud-rise ${preBudRiseDur.toFixed(2)}s linear ${preBudRiseStart.toFixed(2)}s forwards, ` +
    `pre-bud-fade ${preBudFadeDur}s ${EASE_RETRACT} ${preBudFadeAt.toFixed(2)}s forwards;`;
  html += `<g style="${preBudStyle}">${preBudBody}</g>`;

  // === CLOSED BUD — green disc with hanging bracts ===
  const closedBudY = H.s4 + 4; // 54
  const closedBudEmergeAt = stemReachesAt(closedBudY);
  const closedBudBody = `<g transform="translate(${STEM_X} ${closedBudY})">
    <ellipse cx="0" cy="-4" rx="5" ry="5.6" fill="${LEAF}"/>
    <ellipse cx="0" cy="-4" rx="3" ry="3.6" fill="${LEAF}" opacity="0.6" transform="rotate(45)"/>
    <path d="M -5 -2 Q -7 2 -7 5 M 5 -2 Q 7 2 7 5"
          stroke="${STEM}" stroke-width="1" stroke-linecap="round" fill="none"/>
    <path d="M 0 -9 Q 0 -6 0 -3" stroke="${STEM_VEIN}" stroke-width="0.5" opacity="0.55"/>
  </g>`;
  if (targetIdx === 4) {
    html += `<g style="${aEmerge(STEM_X, closedBudY, closedBudEmergeAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`;
    return html;
  }
  // Target 5: closed bud retracts when the bloom emerges at the apex.
  const closedBudRetractAt = stemReachesAt(H.s5Stem + 5);
  html += `<g style="${aEmergeRetract(STEM_X, closedBudY, closedBudEmergeAt, closedBudRetractAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`;

  // === BLOOM — yellow center + 12 white petals radiating outward.
  // Petals scale from the bloom centre (transform-origin at the
  // centre coordinate), so each petal "shoots out" radially as it
  // grows. Stagger of 0.04s per petal gives a sweeping unfurl. ===
  const bloomY = H.s5Stem - 2; // 43
  const bloomEmergeAt = stemReachesAt(H.s5Stem + 5);

  const centerBody = `<g transform="translate(${STEM_X} ${bloomY})">
    <circle cx="0" cy="0" r="4.6" fill="${s.center}"/>
    <circle cx="-1.4" cy="-1.2" r="1.7" fill="#fff2c8" opacity="0.6"/>
    <circle cx="1.4" cy="-0.6" r="0.5" fill="${s.deep}" opacity="0.55"/>
    <circle cx="0.4" cy="1.8" r="0.5" fill="${s.deep}" opacity="0.55"/>
    <circle cx="-0.6" cy="0.8" r="0.5" fill="${s.deep}" opacity="0.55"/>
    <circle cx="1.4" cy="1.8" r="0.5" fill="${s.deep}" opacity="0.55"/>
  </g>`;
  html += `<g style="${aEmerge(STEM_X, bloomY, Math.max(0, bloomEmergeAt - 0.05), EMERGE, "bud-swell")}">${centerBody}</g>`;

  const N_PETALS = 12;
  for (let i = 0; i < N_PETALS; i++) {
    const a = (360 / N_PETALS) * i;
    const petalDelay = bloomEmergeAt + i * 0.04;
    const petalOp = i % 2 === 0 ? 1 : 0.93;
    const petalBody = `<g transform="translate(${STEM_X} ${bloomY})">
      <g transform="rotate(${a})">
        <ellipse cx="0" cy="-12" rx="3.2" ry="9" fill="${s.petal}" opacity="${petalOp}"/>
        <path d="M 0 -3 L 0 -20" stroke="${s.shade}" stroke-width="0.4" opacity="0.55"/>
      </g>
    </g>`;
    html += `<g style="transform-origin: ${STEM_X}px ${bloomY}px; transform: scale(0); animation: leaf-emerge 0.75s ${EASE_EMERGE} ${petalDelay.toFixed(2)}s forwards;">${petalBody}</g>`;
  }

  return html;
}

function sunflowerGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("sunflower", targetIdx);
  if (targetIdx === 1) return stage1("sunflower");

  const s = SKIN.sunflower;

  // Sunflower stem is thicker (width 3.2). Heart-shaped leaves
  // emerge at three heights along the stem as the plant matures.
  // Pre-bud sits 3 viewBox units below the standard young-plant
  // apex (H.s3 - 3 = 82) to read as a developing flower head.
  const stemTop = { 2: H.s2, 3: H.s3 - 3, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemRange = SOIL_Y - stemTop;
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 0.8} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 0.8} ${stemMidY} ${STEM_X} ${stemTop + 1}`;

  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / stemRange);
  };

  let html = "";

  // === SEED — the signature striped sunflower seed ===
  html += `<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("sunflower")}</g>`;

  // === STEM (thick — 3.2) ===
  html += `<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="3.2" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
  html += `<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM_VEIN}" stroke-width="1.12" stroke-linecap="round" opacity="0.55"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;

  // === COTYLEDONS — universal pair, falls off at young-plant transition ===
  const cotyX = STEM_X + 0.5;
  const cotyY = H.s2;
  const cotyEmergeAt = stemReachesAt(cotyY);
  const cotyFallAt = stemReachesAt(H.s3);
  const leftCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-left")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  const rightCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-right")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  html += `<g style="${leftCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;
  html += `<g style="${rightCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;

  if (targetIdx === 2) return html;

  // === HEART LEAVES — emerge sequentially as the stem reaches each
  // attachment height. Sunflower true-leaves form along the stem
  // (not as a rosette at the soil like daisy), so each leaf only
  // appears once the stem has visually grown past its position. ===
  const leafSpec = {
    3: [
      { y: 122, rotate: -32, size: 10 },
      { y: 100, rotate: 32, size: 9, opacity: 0.93 },
    ],
    4: [
      { y: 122, rotate: -32, size: 10 },
      { y: 100, rotate: 32, size: 9, opacity: 0.93 },
      { y: 78, rotate: -28, size: 8, opacity: 0.88 },
    ],
    5: [
      { y: 122, rotate: -32, size: 10 },
      { y: 96, rotate: 32, size: 9, opacity: 0.92 },
      { y: 72, rotate: -28, size: 8, opacity: 0.88 },
    ],
  }[targetIdx];
  leafSpec.forEach((cfg) => {
    const leafBody = heartLeaf({
      anchorX: STEM_X,
      anchorY: cfg.y,
      rotate: cfg.rotate,
      size: cfg.size,
      opacity: cfg.opacity ?? 1,
      sway: false,
    });
    const startAt = stemReachesAt(cfg.y) + 0.12;
    html += `<g style="${aEmerge(STEM_X, cfg.y, startAt, EMERGE, "leaf-emerge")}">${leafBody}</g>`;
  });

  // === PRE-BUD (growing tip) — small green disc with bract lines ===
  const preBudY = H.s3 - 3; // 82
  const preBudEmergeAt = stemReachesAt(preBudY);
  const preBudEmergeDur = 0.65;
  const preBudBody = `<g transform="translate(${STEM_X} ${preBudY})">
    <g transform="translate(0 -2.5)">
      <ellipse cx="0" cy="0" rx="3.4" ry="2.6" fill="${LEAF}"/>
      <path d="M -3 -0.5 Q -4.5 -3 -3 -4 M 3 -0.5 Q 4.5 -3 3 -4 M 0 -2.6 Q 0 -5 -1.2 -5.6 M 0 -2.6 Q 0 -5 1.2 -5.6"
            stroke="${LEAF}" stroke-width="0.9" stroke-linecap="round" fill="none"/>
      <ellipse cx="0" cy="0" rx="2.2" ry="1.6" fill="${STEM_VEIN}" opacity="0.35"/>
    </g>
  </g>`;
  if (targetIdx === 3) {
    html += `<g style="${aEmerge(STEM_X, preBudY, preBudEmergeAt, EMERGE, "bud-swell")}">${preBudBody}</g>`;
    return html;
  }
  // For target >= 4: pre-bud rises with stem from y=82 to y=54
  // (28 viewBox units up, ~-36 CSS px — overridden via --rise-y).
  const preBudRiseStart = preBudEmergeAt + preBudEmergeDur;
  const preBudFadeAt = stemReachesAt(H.s4 + 4);
  const preBudRiseDur = Math.max(0.3, preBudFadeAt - preBudRiseStart);
  const preBudFadeDur = 0.45;
  const preBudStyle =
    `--rise-y: -36px; ` +
    `transform-origin: ${STEM_X}px ${preBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${preBudEmergeDur}s ${EASE_EMERGE} ${preBudEmergeAt.toFixed(2)}s forwards, ` +
    `pre-bud-rise ${preBudRiseDur.toFixed(2)}s linear ${preBudRiseStart.toFixed(2)}s forwards, ` +
    `pre-bud-fade ${preBudFadeDur}s ${EASE_RETRACT} ${preBudFadeAt.toFixed(2)}s forwards;`;
  html += `<g style="${preBudStyle}">${preBudBody}</g>`;

  // === CLOSED BUD — split into three layers so the central DISC can
  // persist through to the bloom (continuity), while the bracts and
  // petal nubs retract when the flower opens.
  //   • bracts:    green protective lines radiating outward
  //   • petal nubs: small immature petal hints around the disc
  //   • disc:      the brown receptacle that becomes the bloom centre
  const closedBudY = H.s4 + 4; // 54
  const closedBudEmergeAt = stemReachesAt(closedBudY);
  const bractsBody = `<g transform="translate(${STEM_X} ${closedBudY})">
    <path d="M -8 0 L -11 3 M -6 -4 L -10 -2 M 8 0 L 11 3 M 6 -4 L 10 -2 M 0 -8 L -1 -12 M 0 -8 L 1 -12"
          stroke="${LEAF}" stroke-width="1.4" stroke-linecap="round"/>
  </g>`;
  const petalNubsBody = `<g transform="translate(${STEM_X} ${closedBudY})">
    <ellipse cx="0" cy="-9" rx="1.4" ry="3" fill="${s.petal}"/>
    <ellipse cx="-5" cy="-7" rx="1.4" ry="2.6" fill="${s.petal}" transform="rotate(-30)"/>
    <ellipse cx="5" cy="-7" rx="1.4" ry="2.6" fill="${s.petal}" transform="rotate(30)"/>
    <ellipse cx="-7" cy="-3" rx="1.3" ry="2.4" fill="${s.shade}" transform="rotate(-60)"/>
    <ellipse cx="7" cy="-3" rx="1.3" ry="2.4" fill="${s.shade}" transform="rotate(60)"/>
  </g>`;
  const discBody = `<g transform="translate(${STEM_X} ${closedBudY})">
    <ellipse cx="0" cy="-3" rx="6" ry="4.5" fill="${s.center}"/>
    <circle cx="-1.5" cy="-3" r="0.6" fill="${s.deep}" opacity="0.6"/>
    <circle cx="1.5" cy="-2.5" r="0.6" fill="${s.deep}" opacity="0.6"/>
    <circle cx="0" cy="-4.5" r="0.5" fill="${s.deep}" opacity="0.6"/>
  </g>`;
  if (targetIdx === 4) {
    // Final state for stage 4: all three layers emerge and stay.
    html += `<g style="${aEmerge(STEM_X, closedBudY, closedBudEmergeAt, EMERGE, "bud-swell")}">${bractsBody}</g>`;
    html += `<g style="${aEmerge(STEM_X, closedBudY, closedBudEmergeAt, EMERGE, "bud-swell")}">${petalNubsBody}</g>`;
    html += `<g style="${aEmerge(STEM_X, closedBudY, closedBudEmergeAt, EMERGE, "bud-swell")}">${discBody}</g>`;
    return html;
  }
  // Target 5: bracts + petal nubs retract as the bloom opens. The
  // DISC stays the same SVG element and morphs into the bloom centre
  // via `sunflower-disc-grow` (translate up + non-uniform scale to
  // turn the ellipse into the larger circle). No separate bloom
  // centre is drawn — the disc IS the centre.
  const bloomTransitionAt = stemReachesAt(H.s5Stem);
  html += `<g style="${aEmergeRetract(STEM_X, closedBudY, closedBudEmergeAt, bloomTransitionAt, EMERGE, "bud-swell")}">${bractsBody}</g>`;
  html += `<g style="${aEmergeRetract(STEM_X, closedBudY, closedBudEmergeAt, bloomTransitionAt, EMERGE, "bud-swell")}">${petalNubsBody}</g>`;
  // Disc: emerges with the bud, then transforms (rise + grow) into
  // the bloom centre at the transition moment. Transform-origin is
  // the disc's current centre (50, 51) so the scale pivots cleanly.
  const discPivotX = STEM_X;
  const discPivotY = closedBudY - 3; // 51
  const discTransformDur = EMERGE;
  const discStyle =
    `transform-origin: ${discPivotX}px ${discPivotY}px; transform: scale(0); ` +
    `animation: bud-swell ${EMERGE}s ${EASE_EMERGE} ${closedBudEmergeAt.toFixed(2)}s forwards, ` +
    `sunflower-disc-grow ${discTransformDur.toFixed(2)}s ${EASE_EMERGE} ${bloomTransitionAt.toFixed(2)}s forwards;`;
  html += `<g style="${discStyle}">${discBody}</g>`;

  // === BLOOM — 20 long petals radiating from the (transformed) disc.
  // After the disc transformation, the centre sits at (50, 37) with
  // size matching the static stage-5 bloom centre.
  const bloomY = discPivotY - 14; // 37
  const bloomEmergeAt = bloomTransitionAt + 0.18;

  // Extra speckle pattern that completes the seed-pattern on the
  // grown disc (the original disc carried 3 speckles; the bloom has
  // 8 total — these 5 fade in as the disc finishes growing).
  const extraSpecklesBody = `<g transform="translate(${STEM_X} ${bloomY})">
    <circle cx="3.8" cy="-2" r="0.65" fill="${s.deep}" opacity="0.7"/>
    <circle cx="-3.6" cy="2.4" r="0.65" fill="${s.deep}" opacity="0.7"/>
    <circle cx="0.8" cy="-3.6" r="0.65" fill="${s.deep}" opacity="0.7"/>
    <circle cx="-1.2" cy="0.4" r="0.5" fill="${s.deep}" opacity="0.65"/>
    <circle cx="1.6" cy="-0.6" r="0.5" fill="${s.deep}" opacity="0.65"/>
  </g>`;
  html += `<g style="${aEmerge(STEM_X, bloomY, bloomEmergeAt + 0.35, 0.4, "el-emerge")}">${extraSpecklesBody}</g>`;

  const N_PETALS = 20;
  for (let i = 0; i < N_PETALS; i++) {
    const a = (360 / N_PETALS) * i;
    const petalDelay = bloomEmergeAt + i * 0.03;
    const petalOp = i % 2 === 0 ? 1 : 0.92;
    const petalBody = `<g transform="translate(${STEM_X} ${bloomY})">
      <g transform="rotate(${a})">
        <ellipse cx="0" cy="-16" rx="3.4" ry="10" fill="${s.petal}" opacity="${petalOp}"/>
        <path d="M 0 -8 L 0 -24" stroke="${s.shade}" stroke-width="0.4" opacity="0.55"/>
      </g>
    </g>`;
    html += `<g style="transform-origin: ${STEM_X}px ${bloomY}px; transform: scale(0); animation: leaf-emerge 0.75s ${EASE_EMERGE} ${petalDelay.toFixed(2)}s forwards;">${petalBody}</g>`;
  }

  return html;
}

function hydrangeaGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("hydrangea", targetIdx);
  if (targetIdx === 1) return stage1("hydrangea");

  const s = SKIN.hydrangea;

  // Hydrangea stem geometry. Slightly taller young-plant stem
  // (H.s3+1) to leave space for the side-branch + clustered foliage.
  const stemTop = { 2: H.s2, 3: H.s3 + 1, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemRange = SOIL_Y - stemTop;
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.0} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.0} ${stemMidY} ${STEM_X} ${stemTop + 1}`;

  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / stemRange);
  };

  let html = "";

  // === SEED ===
  html += `<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("hydrangea")}</g>`;

  // === MAIN STEM (width 2.6) ===
  html += `<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="2.6" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
  html += `<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM_VEIN}" stroke-width="0.91" stroke-linecap="round" opacity="0.55"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;

  // === COTYLEDONS ===
  const cotyX = STEM_X + 0.5;
  const cotyY = H.s2;
  const cotyEmergeAt = stemReachesAt(cotyY);
  const cotyFallAt = stemReachesAt(H.s3);
  const leftCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-left")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  const rightCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-right")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  html += `<g style="${leftCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;
  html += `<g style="${rightCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;

  if (targetIdx === 2) return html;

  // === SIDE BRANCH — draws outward from the main stem ===
  const branchSpec = {
    3: { stemY: 110, tipX: STEM_X + 9, tipY: 100 },
    4: { stemY: 95,  tipX: STEM_X + 9, tipY: 84  },
    5: { stemY: 95,  tipX: STEM_X + 9, tipY: 84  },
  }[targetIdx];
  const branchPath = `M ${STEM_X} ${branchSpec.stemY} Q ${STEM_X + 5} ${(branchSpec.stemY + branchSpec.tipY) / 2} ${branchSpec.tipX} ${branchSpec.tipY}`;
  const branchStartAt = stemReachesAt(branchSpec.stemY);
  const branchDur = 0.5;
  html += `<path d="${branchPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="1.8" stroke-linecap="round"
                style="animation: stem-draw ${branchDur.toFixed(2)}s ${EASE_STEM} ${branchStartAt.toFixed(2)}s forwards;"/>`;

  // === HEART LEAVES ===
  // Two leaves on the main stem (upper and lower) + one on the
  // branch tip. Main-stem leaves emerge at the young-plant
  // transition; branch-tip leaf emerges after the branch has drawn.
  const leafSpec = {
    3: [
      { ax: STEM_X,     ay: 122, rotate: -36, size: 12,                onBranch: false },
      { ax: STEM_X + 9, ay: 100, rotate: 42,  size: 10, opacity: 0.93, onBranch: true  },
      { ax: STEM_X,     ay: 132, rotate: 95,  size: 10, opacity: 0.88, onBranch: false },
    ],
    4: [
      { ax: STEM_X,     ay: 120, rotate: -36, size: 12,                onBranch: false },
      { ax: STEM_X + 9, ay: 84,  rotate: 42,  size: 10, opacity: 0.93, onBranch: true  },
      { ax: STEM_X,     ay: 130, rotate: 95,  size: 10, opacity: 0.88, onBranch: false },
    ],
    5: [
      { ax: STEM_X,     ay: 120, rotate: -36, size: 12,                onBranch: false },
      { ax: STEM_X + 9, ay: 84,  rotate: 42,  size: 10, opacity: 0.93, onBranch: true  },
      { ax: STEM_X,     ay: 132, rotate: 95,  size: 10, opacity: 0.88, onBranch: false },
    ],
  }[targetIdx];
  const mainLeafBase = stemReachesAt(H.s3);
  leafSpec.forEach((cfg, idx) => {
    const leafBody = heartLeaf({
      anchorX: cfg.ax,
      anchorY: cfg.ay,
      rotate: cfg.rotate,
      size: cfg.size,
      opacity: cfg.opacity ?? 1,
      sway: false,
    });
    const startAt = cfg.onBranch
      ? branchStartAt + branchDur + 0.05
      : mainLeafBase + idx * 0.18;
    html += `<g style="${aEmerge(cfg.ax, cfg.ay, startAt, EMERGE, "leaf-emerge")}">${leafBody}</g>`;
  });

  // === PRE-BUD — tiny cluster of green nubs at the apex ===
  const preBudY = H.s3 + 1; // 86
  const preBudEmergeAt = stemReachesAt(preBudY);
  const preBudEmergeDur = 0.6;
  const preBudBody = `<g transform="translate(${STEM_X} ${preBudY})">
    <g transform="translate(0 -1)">
      <circle cx="-2.4" cy="-1.4" r="1.6" fill="${LEAF}"/>
      <circle cx="2.4" cy="-1.4" r="1.6" fill="${LEAF}" opacity="0.95"/>
      <circle cx="0" cy="-3.4" r="1.6" fill="${LEAF}"/>
      <circle cx="0" cy="-0.4" r="1.4" fill="${LEAF}" opacity="0.88"/>
      <circle cx="0" cy="-1.8" r="0.6" fill="${STEM_VEIN}" opacity="0.4"/>
    </g>
  </g>`;
  if (targetIdx === 3) {
    html += `<g style="${aEmerge(STEM_X, preBudY, preBudEmergeAt, EMERGE, "bud-swell")}">${preBudBody}</g>`;
    return html;
  }
  // For target >= 4: pre-bud rises with stem from y=86 to y=55 (31
  // viewBox units up — overridden via --rise-y inline).
  const preBudRiseStart = preBudEmergeAt + preBudEmergeDur;
  const preBudFadeAt = stemReachesAt(H.s4 + 5); // 55
  const preBudRiseDur = Math.max(0.3, preBudFadeAt - preBudRiseStart);
  const preBudFadeDur = 0.45;
  const preBudStyle =
    `--rise-y: -31px; ` +
    `transform-origin: ${STEM_X}px ${preBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${preBudEmergeDur}s ${EASE_EMERGE} ${preBudEmergeAt.toFixed(2)}s forwards, ` +
    `pre-bud-rise ${preBudRiseDur.toFixed(2)}s linear ${preBudRiseStart.toFixed(2)}s forwards, ` +
    `pre-bud-fade ${preBudFadeDur}s ${EASE_RETRACT} ${preBudFadeAt.toFixed(2)}s forwards;`;
  html += `<g style="${preBudStyle}">${preBudBody}</g>`;

  // === CLOSED BUD — tight cluster of 5 green nubs + 2 purple tints
  // (the "developing cluster" before the bloom opens) ===
  const closedBudY = H.s4 + 5; // 55
  const closedBudEmergeAt = stemReachesAt(closedBudY);
  const closedBudBody = `<g transform="translate(${STEM_X} ${closedBudY})">
    <circle cx="-3" cy="-3" r="3.2" fill="${LEAF}"/>
    <circle cx="3" cy="-3" r="3.2" fill="${LEAF}" opacity="0.92"/>
    <circle cx="0" cy="-8" r="3.2" fill="${LEAF}"/>
    <circle cx="-1.5" cy="-1" r="2.8" fill="${LEAF}" opacity="0.88"/>
    <circle cx="2" cy="-6" r="2.6" fill="${LEAF}" opacity="0.86"/>
    <circle cx="-3" cy="-3" r="1.2" fill="${s.petal}" opacity="0.7"/>
    <circle cx="0" cy="-8" r="1.2" fill="${s.petal}" opacity="0.7"/>
  </g>`;
  if (targetIdx === 4) {
    html += `<g style="${aEmerge(STEM_X, closedBudY, closedBudEmergeAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`;
    return html;
  }
  // Target 5: closed bud "morphs" — translates up 15 viewBox units
  // (cluster centre rises from y=55 to y=40) while shrinking and
  // fading, so the cluster appears to lift toward the bloom position
  // before disappearing. Bloom emerges at that same position.
  const bloomTransitionAt = stemReachesAt(H.s5Stem);
  const closedBudStyle =
    `transform-origin: ${STEM_X}px ${closedBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${EMERGE}s ${EASE_EMERGE} ${closedBudEmergeAt.toFixed(2)}s forwards, ` +
    `hydrangea-bud-morph 0.85s ${EASE_RETRACT} ${bloomTransitionAt.toFixed(2)}s forwards;`;
  html += `<g style="${closedBudStyle}">${closedBudBody}</g>`;

  // === BLOOM — 11 small 4-petal florets clustered in a globe.
  // Each floret has its own transform-origin at its native position
  // so it grows IN PLACE (like a bud opening) rather than shooting
  // outward from the cluster centre. Staggered emergence sweeps
  // through the cluster for a natural unfurl.
  const bloomY = H.s5Stem - 5; // 40
  const bloomEmergeAt = bloomTransitionAt + 0.2;
  const florets = [
    [0, -20], [-8, -16], [8, -16],
    [-12, -8], [12, -8], [0, -6],
    [-6, -2], [6, -2], [0, -12],
    [-3, -18], [3, -18],
  ];
  for (let i = 0; i < florets.length; i++) {
    const [px, py] = florets[i];
    const v = i % 2;
    const floretCenterX = STEM_X + px;
    const floretCenterY = bloomY + py;
    const floretBody = `<g transform="translate(${floretCenterX} ${floretCenterY})">
      <ellipse cx="0" cy="-2.6" rx="2.6" ry="3.6" fill="${v ? s.shade : s.petal}"/>
      <ellipse cx="-2.6" cy="0" rx="3.6" ry="2.6" fill="${s.petal}" opacity="0.92"/>
      <ellipse cx="2.6" cy="0" rx="3.6" ry="2.6" fill="${s.shade}" opacity="0.92"/>
      <ellipse cx="0" cy="2.6" rx="2.6" ry="3.6" fill="${v ? s.petal : s.shade}" opacity="0.96"/>
      <circle cx="0" cy="0" r="1" fill="${s.center}" opacity="0.9"/>
      <path d="M 0 -2.2 L 0 -3.8 M -2.2 0 L -3.8 0 M 2.2 0 L 3.8 0 M 0 2.2 L 0 3.8"
            stroke="${s.deep}" stroke-width="0.3" opacity="0.5"/>
    </g>`;
    const floretDelay = bloomEmergeAt + i * 0.06;
    html += `<g style="transform-origin: ${floretCenterX}px ${floretCenterY}px; transform: scale(0); animation: leaf-emerge 0.6s ${EASE_EMERGE} ${floretDelay.toFixed(2)}s forwards;">${floretBody}</g>`;
  }

  return html;
}

// Azalea is structurally different — three branches root at the soil
// (no single trunk after stage 2), each branch carries its own
// growing-tip → closed-bud → funnel-bloom chain. For target=2 it
// behaves like the standard single-sprout pattern; from target=3
// onward the three branches draw together and host independent
// per-branch element chains.
function azaleaGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("azalea", targetIdx);
  if (targetIdx === 1) return stage1("azalea");

  const s = SKIN.azalea;

  // === target=2: single sprout (no branches yet) ===
  if (targetIdx === 2) {
    const stemTop = H.s2;
    const stemRange = SOIL_Y - stemTop;
    const stemDuration = PHASE;
    const stemStartAt = PRE;
    const stemReachesAt2 = (y) => {
      const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
      return stemStartAt + stemDuration * ((SOIL_Y - clamped) / stemRange);
    };

    let out = "";
    out += `<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("azalea")}</g>`;
    out += `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2}"
                  pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                  fill="none" stroke="${STEM}" stroke-width="2.4" stroke-linecap="round"
                  style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
    out += `<path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2 + 1}"
                  pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                  fill="none" stroke="${STEM_VEIN}" stroke-width="0.7" stroke-linecap="round" opacity="0.5"
                  style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
    const cotyX2 = STEM_X + 0.5;
    const cotyY2 = H.s2;
    const cotyEmergeAt2 = stemReachesAt2(cotyY2);
    out += `<g style="${aEmerge(cotyX2, cotyY2, cotyEmergeAt2, EMERGE, "leaf-emerge")}">
      <g transform="translate(${cotyX2} ${cotyY2})">
        <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
        <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
      </g>
    </g>`;
    out += `<g style="${aEmerge(cotyX2, cotyY2, cotyEmergeAt2, EMERGE, "leaf-emerge")}">
      <g transform="translate(${cotyX2} ${cotyY2})">
        <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
        <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
      </g>
    </g>`;
    return out;
  }

  // ============ target >= 3: three branches from soil ============
  // Per-target tip positions match the static stage geometry.
  const tips = {
    3: { left: { x: STEM_X - 14, y: H.s3       }, right: { x: STEM_X + 13, y: H.s3 + 4 }, mid: { x: STEM_X + 2, y: H.s3 - 1 } },
    4: { left: { x: STEM_X - 14, y: H.s4       }, right: { x: STEM_X + 13, y: H.s4 + 4 }, mid: { x: STEM_X + 2, y: H.s4 - 1 } },
    5: { left: { x: STEM_X - 15, y: H.s5Stem - 4 }, right: { x: STEM_X + 14, y: H.s5Stem - 2 }, mid: { x: STEM_X + 2, y: H.s5Stem - 6 } },
  }[targetIdx];

  // Use the highest tip (smallest y) as the reference stemTop. All
  // three branches use pathLength="1" so they all finish drawing at
  // the same time; this single timing baseline drives every other
  // element's emerge offset.
  const stemTop = Math.min(tips.left.y, tips.right.y, tips.mid.y);
  const stemRange = SOIL_Y - stemTop;
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / stemRange);
  };

  // Branch paths per target — match the static stage geometry exactly
  // so the end-of-growth pose is indistinguishable from the static.
  const branchPaths = {
    3: {
      left:  `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 130 ${STEM_X - 9} 112 Q ${STEM_X - 13} 100 ${tips.left.x} ${tips.left.y}`,
      right: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1} 130 ${STEM_X + 8} 115 Q ${STEM_X + 13} 104 ${tips.right.x} ${tips.right.y}`,
      mid:   `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1.5} 125 ${STEM_X + 2.5} 105 Q ${STEM_X + 2} 90 ${tips.mid.x} ${tips.mid.y}`,
    },
    4: {
      left:  `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 130 ${STEM_X - 9} 110 Q ${STEM_X - 13} 96 ${tips.left.x} ${tips.left.y}`,
      right: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1} 130 ${STEM_X + 8} 112 Q ${STEM_X + 13} 98 ${tips.right.x} ${tips.right.y}`,
      mid:   `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1.5} 125 ${STEM_X + 2.5} 100 Q ${STEM_X + 2} 75 ${tips.mid.x} ${tips.mid.y}`,
    },
    5: {
      left:  `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 130 ${STEM_X - 10} 108 Q ${STEM_X - 14} 92 ${tips.left.x} ${tips.left.y}`,
      right: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1} 130 ${STEM_X + 9} 110 Q ${STEM_X + 14} 94 ${tips.right.x} ${tips.right.y}`,
      mid:   `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 1.5} 125 ${STEM_X + 2.5} 100 Q ${STEM_X + 2} 80 ${tips.mid.x} ${tips.mid.y}`,
    },
  }[targetIdx];

  let html = "";

  // === SEED ===
  html += `<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("azalea")}</g>`;

  // === THREE BRANCHES draw together from soil ===
  const drawBranch = (d, width) => `<path d="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
        fill="none" stroke="${STEM}" stroke-width="${width}" stroke-linecap="round"
        style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
  html += drawBranch(branchPaths.left,  2.2);
  html += drawBranch(branchPaths.right, 2.2);
  html += drawBranch(branchPaths.mid,   2.0);

  // === COTYLEDONS at sprout height — emerge then fall away once
  // the true leaves take over (a hair before the lowest leaf). ===
  const cotyX = STEM_X + 0.5;
  const cotyY = H.s2;
  const cotyEmergeAt = stemReachesAt(cotyY);
  const cotyFallAt = stemReachesAt(115);
  html += `<g style="${aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-left")}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;
  html += `<g style="${aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-right")}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;

  // === LEAVES along the branches (specs mirror the static stages) ===
  const leafSpec = {
    3: [
      { ax: STEM_X - 12, ay: 105, rotate: -50, length: 10, width: 4 },
      { ax: STEM_X - 6,  ay: 122, rotate: -85, length: 9,  width: 3.8, opacity: 0.9 },
      { ax: STEM_X + 11, ay: 108, rotate: 55,  length: 10, width: 4 },
      { ax: STEM_X + 5,  ay: 124, rotate: 90,  length: 9,  width: 3.8, opacity: 0.9 },
      { ax: STEM_X + 3,  ay: 116, rotate: 30,  length: 8,  width: 3.5, opacity: 0.85 },
    ],
    4: [
      { ax: STEM_X - 12, ay: 105, rotate: -55, length: 10, width: 4 },
      { ax: STEM_X - 6,  ay: 122, rotate: -85, length: 9,  width: 3.8, opacity: 0.9 },
      { ax: STEM_X + 11, ay: 108, rotate: 55,  length: 10, width: 4 },
      { ax: STEM_X + 5,  ay: 124, rotate: 90,  length: 9,  width: 3.8, opacity: 0.9 },
      { ax: STEM_X + 3,  ay: 110, rotate: 30,  length: 8,  width: 3.5, opacity: 0.85 },
    ],
    5: [
      { ax: STEM_X - 13, ay: 108, rotate: -55, length: 11, width: 4.2 },
      { ax: STEM_X - 6,  ay: 122, rotate: -85, length: 10, width: 4,   opacity: 0.9 },
      { ax: STEM_X + 12, ay: 108, rotate: 55,  length: 11, width: 4.2 },
      { ax: STEM_X + 5,  ay: 124, rotate: 90,  length: 10, width: 4,   opacity: 0.9 },
      { ax: STEM_X + 3,  ay: 114, rotate: 30,  length: 9,  width: 3.8, opacity: 0.85 },
    ],
  }[targetIdx];
  leafSpec.forEach((cfg, idx) => {
    const body = leaf({
      anchorX: cfg.ax,
      anchorY: cfg.ay,
      rotate: cfg.rotate,
      length: cfg.length,
      width: cfg.width,
      opacity: cfg.opacity ?? 1,
      sway: false,
    });
    const startAt = stemReachesAt(cfg.ay) + idx * 0.07;
    html += `<g style="${aEmerge(cfg.ax, cfg.ay, startAt, EMERGE, "leaf-emerge")}">${body}</g>`;
  });

  // === GROWING TIPS on each branch at stage-3 apex ===
  const preBudPositions = [
    { x: STEM_X - 14, y: H.s3,     budY: H.s4     },
    { x: STEM_X + 13, y: H.s3 + 4, budY: H.s4 + 4 },
    { x: STEM_X + 2,  y: H.s3 - 1, budY: H.s4 - 1 },
  ];
  const preBudEmergeDur = 0.6;

  if (targetIdx === 3) {
    preBudPositions.forEach((p) => {
      const emergeAt = stemReachesAt(p.y);
      const tipBody = `<g filter="${sunFilterSoft("azalea", 3)}">${growingTip("azalea", p.x, p.y)}</g>`;
      html += `<g style="${aEmerge(p.x, p.y, emergeAt, preBudEmergeDur, "bud-swell")}">${tipBody}</g>`;
    });
    return html;
  }

  // target >= 4: each growing tip rises with its branch and morphs
  // into a closed bud at the stage-4 apex. Per-branch --rise-y is
  // identical (-35 viewBox units) since H.s3 → H.s4 is a uniform jump.
  preBudPositions.forEach((p) => {
    const emergeAt = stemReachesAt(p.y);
    const riseStart = emergeAt + preBudEmergeDur;
    const fadeAt = stemReachesAt(p.budY);
    const riseDur = Math.max(0.3, fadeAt - riseStart);
    const riseY = p.budY - p.y;
    const tipBody = `<g filter="${sunFilterSoft("azalea", 3)}">${growingTip("azalea", p.x, p.y)}</g>`;
    const style =
      `--rise-y: ${riseY}px; ` +
      `transform-origin: ${p.x}px ${p.y}px; transform: scale(0); ` +
      `animation: bud-swell ${preBudEmergeDur}s ${EASE_EMERGE} ${emergeAt.toFixed(2)}s forwards, ` +
      `pre-bud-rise ${riseDur.toFixed(2)}s linear ${riseStart.toFixed(2)}s forwards, ` +
      `pre-bud-fade 0.45s ${EASE_RETRACT} ${fadeAt.toFixed(2)}s forwards;`;
    html += `<g style="${style}">${tipBody}</g>`;
  });

  // === CLOSED BUDS — left/right have a stem-stripe accent, middle
  // is a smaller central bud (matches the static stage-4 azalea). ===
  const closedBuds = [
    {
      x: STEM_X - 14, y: H.s4,
      bloomX: STEM_X - 15, bloomY: H.s5Stem - 4,
      body: `<g transform="translate(${STEM_X - 14} ${H.s4})" filter="${sunFilter("azalea", 4)}">
        <ellipse cx="0" cy="-3" rx="3" ry="3.6" fill="${s.budShade}"/>
        <ellipse cx="-0.4" cy="-3.4" rx="1.8" ry="2.6" fill="${s.bud}"/>
        <path d="M -2 0 Q -3 2 -3 4" stroke="${STEM}" stroke-width="0.8" fill="none" stroke-linecap="round"/>
      </g>`,
    },
    {
      x: STEM_X + 13, y: H.s4 + 4,
      bloomX: STEM_X + 14, bloomY: H.s5Stem - 2,
      body: `<g transform="translate(${STEM_X + 13} ${H.s4 + 4})" filter="${sunFilter("azalea", 4)}">
        <ellipse cx="0" cy="-3" rx="3" ry="3.6" fill="${s.budShade}"/>
        <ellipse cx="-0.4" cy="-3.4" rx="1.8" ry="2.6" fill="${s.bud}"/>
        <path d="M 2 0 Q 3 2 3 4" stroke="${STEM}" stroke-width="0.8" fill="none" stroke-linecap="round"/>
      </g>`,
    },
    {
      x: STEM_X + 2, y: H.s4 - 1,
      bloomX: STEM_X + 2, bloomY: H.s5Stem - 6,
      body: `<g transform="translate(${STEM_X + 2} ${H.s4 - 1})" filter="${sunFilter("azalea", 4)}">
        <ellipse cx="0" cy="-2" rx="2.4" ry="3" fill="${s.budShade}"/>
        <ellipse cx="-0.3" cy="-2.4" rx="1.4" ry="2" fill="${s.bud}"/>
      </g>`,
    },
  ];

  if (targetIdx === 4) {
    closedBuds.forEach((b) => {
      const emergeAt = stemReachesAt(b.y) + 0.05;
      html += `<g style="${aEmerge(b.x, b.y, emergeAt, EMERGE, "bud-swell")}">${b.body}</g>`;
    });
    return html;
  }

  // ============ target=5: funnel blooms unfurl ============
  function funnel(cx, cy, rot, scale = 1) {
    return `
      <g transform="translate(${cx} ${cy}) rotate(${rot}) scale(${scale})">
        <ellipse cx="-5.5" cy="-3" rx="4.6" ry="3.4" fill="${s.petal}"/>
        <ellipse cx="5.5" cy="-3" rx="4.6" ry="3.4" fill="${s.petal}" opacity="0.94"/>
        <ellipse cx="0" cy="-7" rx="4.4" ry="4" fill="${s.petal}"/>
        <ellipse cx="-3.4" cy="0.6" rx="3.6" ry="3" fill="${s.shade}" opacity="0.94"/>
        <ellipse cx="3.4" cy="0.6" rx="3.6" ry="3" fill="${s.shade}" opacity="0.94"/>
        <ellipse cx="0" cy="-2.4" rx="1.8" ry="1.6" fill="${s.center}"/>
        <path d="M 0 -2.4 L -1.6 -9 M 0 -2.4 L 1.6 -9 M 0 -2.4 L 0 -10 M 0 -2.4 L -2.6 -7 M 0 -2.4 L 2.6 -7"
              stroke="${s.deep}" stroke-width="0.5" stroke-linecap="round"/>
        <circle cx="-1.6" cy="-9" r="0.65" fill="${s.deep}"/>
        <circle cx="1.6" cy="-9" r="0.65" fill="${s.deep}"/>
        <circle cx="0" cy="-10" r="0.75" fill="${s.deep}"/>
        <path d="M -7 -4 Q -8 -6 -7 -8" stroke="${s.deep}" stroke-width="0.3" fill="none" opacity="0.5"/>
        <path d="M 7 -4 Q 8 -6 7 -8" stroke="${s.deep}" stroke-width="0.3" fill="none" opacity="0.5"/>
      </g>
    `;
  }

  const blooms = [
    { x: STEM_X - 15, y: H.s5Stem - 4, rot: -18, scale: 1.0,  bud: closedBuds[0] },
    { x: STEM_X + 14, y: H.s5Stem - 2, rot: 18,  scale: 1.0,  bud: closedBuds[1] },
    { x: STEM_X + 2,  y: H.s5Stem - 6, rot: 4,   scale: 0.95, bud: closedBuds[2] },
  ];

  // All three buds morph in sync once the stems finish drawing.
  const bloomTransitionAt = stemReachesAt(stemTop);

  blooms.forEach((bc) => {
    const budEmergeAt = stemReachesAt(bc.bud.y) + 0.05;
    const riseY = bc.y - bc.bud.y;
    const budStyle =
      `--rise-y: ${riseY}px; ` +
      `transform-origin: ${bc.bud.x}px ${bc.bud.y}px; transform: scale(0); ` +
      `animation: bud-swell ${EMERGE}s ${EASE_EMERGE} ${budEmergeAt.toFixed(2)}s forwards, ` +
      `azalea-bud-morph 0.85s ${EASE_RETRACT} ${bloomTransitionAt.toFixed(2)}s forwards;`;
    html += `<g style="${budStyle}">${bc.bud.body}</g>`;

    const bloomEmergeAt = bloomTransitionAt + 0.2;
    const bloomBody = `<g filter="${sunFilter("azalea", 5)}">${funnel(bc.x, bc.y, bc.rot, bc.scale)}</g>`;
    html += `<g style="${aEmerge(bc.x, bc.y, bloomEmergeAt, EMERGE, "el-emerge")}">${bloomBody}</g>`;
  });

  return html;
}

// Lily — single slender stem with paired blade leaves at successive
// heights and an elongated closed bud that opens into a 6-petal
// radial bloom. Follows the standard stem-driven choreography
// (tulip pattern), with the bud → bloom transition handled by a
// cluster-rise morph so the bud lifts the ~17 viewBox units from
// (50, 54) to the bloom centre at (50, 37) before fading.
function lilyGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("lily", targetIdx);
  if (targetIdx === 1) return stage1("lily");

  const s = SKIN.lily;

  // Stem geometry + stem-driven timing.
  const stemTop = { 2: H.s2, 3: H.s3, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemRange = SOIL_Y - stemTop;
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 0.6} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 0.6} ${stemMidY} ${STEM_X} ${stemTop + 1}`;

  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / stemRange);
  };

  let html = "";

  // === SEED ===
  html += `<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("lily")}</g>`;

  // === STEM (slender, width 2) ===
  html += `<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="2" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
  html += `<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM_VEIN}" stroke-width="0.7" stroke-linecap="round" opacity="0.55"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;

  // === COTYLEDONS — emerge at sprout height, fall when blades appear ===
  const cotyX = STEM_X + 0.5;
  const cotyY = H.s2;
  const cotyEmergeAt = stemReachesAt(cotyY);
  const cotyFallAt = stemReachesAt(H.s3);
  const leftCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-left")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  const rightCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-right")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  html += `<g style="${leftCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;
  html += `<g style="${rightCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;

  if (targetIdx === 2) return html;

  // === BLADE LEAVES along the stem (paired left/right per height).
  // Each successive stage adds a higher pair; lower pairs persist
  // unchanged so the foliage stacks naturally with the plant. ===
  const bladeSpec = {
    3: [
      { ay: 118, rotate: -68, length: 18, width: 2.4 },
      { ay: 118, rotate: 68,  length: 18, width: 2.4, opacity: 0.92 },
      { ay: 100, rotate: -58, length: 15, width: 2.2 },
      { ay: 100, rotate: 58,  length: 15, width: 2.2, opacity: 0.92 },
      { ay: 92,  rotate: -50, length: 12, width: 2,   opacity: 0.88 },
      { ay: 92,  rotate: 50,  length: 12, width: 2,   opacity: 0.88 },
    ],
    4: [
      { ay: 118, rotate: -68, length: 18, width: 2.4 },
      { ay: 118, rotate: 68,  length: 18, width: 2.4, opacity: 0.92 },
      { ay: 100, rotate: -58, length: 15, width: 2.2 },
      { ay: 100, rotate: 58,  length: 15, width: 2.2, opacity: 0.92 },
      { ay: 82,  rotate: -50, length: 12, width: 2,   opacity: 0.88 },
      { ay: 82,  rotate: 50,  length: 12, width: 2,   opacity: 0.88 },
      { ay: 64,  rotate: -42, length: 10, width: 1.8, opacity: 0.85 },
      { ay: 64,  rotate: 42,  length: 10, width: 1.8, opacity: 0.85 },
    ],
    5: [
      { ay: 120, rotate: -68, length: 20, width: 2.6 },
      { ay: 120, rotate: 68,  length: 20, width: 2.6, opacity: 0.92 },
      { ay: 100, rotate: -58, length: 16, width: 2.4 },
      { ay: 100, rotate: 58,  length: 16, width: 2.4, opacity: 0.92 },
      { ay: 78,  rotate: -50, length: 13, width: 2.2, opacity: 0.88 },
      { ay: 78,  rotate: 50,  length: 13, width: 2.2, opacity: 0.88 },
      { ay: 60,  rotate: -42, length: 10, width: 2,   opacity: 0.85 },
      { ay: 60,  rotate: 42,  length: 10, width: 2,   opacity: 0.85 },
    ],
  }[targetIdx];
  // Stagger same-height pairs by a hair so they don't unfurl in lockstep.
  bladeSpec.forEach((cfg, idx) => {
    const body = blade({
      anchorX: STEM_X,
      anchorY: cfg.ay,
      rotate: cfg.rotate,
      length: cfg.length,
      width: cfg.width,
      opacity: cfg.opacity ?? 1,
      sway: false,
    });
    const sameHeightOffset = (idx % 2) * 0.08;
    const heightStagger = Math.floor(idx / 2) * 0.04;
    const startAt = stemReachesAt(cfg.ay) + sameHeightOffset + heightStagger;
    html += `<g style="${aEmerge(STEM_X, cfg.ay, startAt, EMERGE, "leaf-emerge")}">${body}</g>`;
  });

  // === PRE-BUD (growing tip) at apex ===
  const preBudY = H.s3;
  const preBudEmergeAt = stemReachesAt(preBudY);
  const preBudEmergeDur = 0.6;
  const preBudBody = `<g filter="${sunFilterSoft("lily", 3)}">${growingTip("lily", STEM_X, preBudY)}</g>`;

  if (targetIdx === 3) {
    html += `<g style="${aEmerge(STEM_X, preBudY, preBudEmergeAt, preBudEmergeDur, "bud-swell")}">${preBudBody}</g>`;
    return html;
  }

  // target >= 4: pre-bud rises with stem and morphs into the closed bud.
  const closedBudY = H.s4 + 4; // anchor y for the elongated bud
  const preBudRiseStart = preBudEmergeAt + preBudEmergeDur;
  const preBudFadeAt = stemReachesAt(closedBudY);
  const preBudRiseDur = Math.max(0.3, preBudFadeAt - preBudRiseStart);
  const riseY = closedBudY - preBudY; // -31 viewBox units
  const preBudStyle =
    `--rise-y: ${riseY}px; ` +
    `transform-origin: ${STEM_X}px ${preBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${preBudEmergeDur}s ${EASE_EMERGE} ${preBudEmergeAt.toFixed(2)}s forwards, ` +
    `pre-bud-rise ${preBudRiseDur.toFixed(2)}s linear ${preBudRiseStart.toFixed(2)}s forwards, ` +
    `pre-bud-fade 0.45s ${EASE_RETRACT} ${preBudFadeAt.toFixed(2)}s forwards;`;
  html += `<g style="${preBudStyle}">${preBudBody}</g>`;

  // === CLOSED BUD — elongated leaf-like shape pointing up. Anchored
  // at (50, 54) with body extending to (50, 32). ===
  const closedBudBody = `<g transform="translate(${STEM_X} ${closedBudY})" filter="${sunFilter("lily", 4)}">
    <path d="M 0 0 C -3 -3 -3.5 -14 0 -22 C 3.5 -14 3 -3 0 0 Z" fill="${s.shade}"/>
    <path d="M -1.6 -2 C -2 -8 -1 -18 0 -21" stroke="${s.petal}" stroke-width="0.6" fill="none" opacity="0.7"/>
    <path d="M 1.6 -2 C 2 -8 1 -18 0 -21" stroke="${s.deep}" stroke-width="0.5" fill="none" opacity="0.55"/>
    <path d="M 0 -21 L 0 -1" stroke="${s.deep}" stroke-width="0.4" opacity="0.55"/>
  </g>`;
  const closedBudEmergeAt = stemReachesAt(closedBudY);

  if (targetIdx === 4) {
    html += `<g style="${aEmerge(STEM_X, closedBudY, closedBudEmergeAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`;
    return html;
  }

  // target = 5: closed bud lifts toward the bloom centre while
  // shrinking and fading; petals fan out radially from the new centre.
  const bloomY = H.s5Stem - 8; // 37
  const bloomTransitionAt = stemReachesAt(bloomY);
  const budRiseY = bloomY - closedBudY; // -17 viewBox units (54 → 37)
  const closedBudStyle =
    `--rise-y: ${budRiseY}px; ` +
    `transform-origin: ${STEM_X}px ${closedBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${EMERGE}s ${EASE_EMERGE} ${closedBudEmergeAt.toFixed(2)}s forwards, ` +
    `azalea-bud-morph 0.85s ${EASE_RETRACT} ${bloomTransitionAt.toFixed(2)}s forwards;`;
  html += `<g style="${closedBudStyle}">${closedBudBody}</g>`;

  // === BLOOM — 6 petals radiating from the bloom centre. Each petal
  // emerges scaling from the centre, staggered by 0.05s. The stamen
  // dots and centre disc follow shortly after to feel like the bloom
  // "completes" once petals are open. ===
  const bloomEmergeAt = bloomTransitionAt + 0.2;
  for (let i = 0; i < 6; i++) {
    const a = 60 * i;
    const petalBody = `<g transform="translate(${STEM_X} ${bloomY}) rotate(${a})">
      <path d="M 0 0 C 6 -8 6 -22 0 -27 C -6 -22 -6 -8 0 0 Z" fill="${s.petal}" opacity="${i % 2 === 0 ? 1 : 0.93}"/>
      <path d="M 0 0 L 0 -24" stroke="${s.shade}" stroke-width="0.5" opacity="0.6"/>
      <path d="M -2.4 -12 Q 0 -20 2.4 -12" stroke="${s.deep}" stroke-width="0.4" fill="none" opacity="0.45"/>
    </g>`;
    const startAt = bloomEmergeAt + i * 0.05;
    html += `<g style="transform-origin: ${STEM_X}px ${bloomY}px; transform: scale(0); animation: leaf-emerge 0.75s ${EASE_EMERGE} ${startAt.toFixed(2)}s forwards;">${petalBody}</g>`;
  }
  // Stamen + centre details (filtered as one group, emerges last).
  const centreEmergeAt = bloomEmergeAt + 0.45;
  const centreBody = `<g transform="translate(${STEM_X} ${bloomY})" filter="${sunFilter("lily", 5)}">
    <circle cx="0" cy="0" r="3" fill="${s.center}"/>
    <path d="M 0 0 L 0 -6 M -1.6 0 L -3.2 -5.5 M 1.6 0 L 3.2 -5.5 M -2.6 0 L -5.2 -4.5 M 2.6 0 L 5.2 -4.5 M 0 0 L 0 -7"
          stroke="${s.deep}" stroke-width="0.55" stroke-linecap="round" opacity="0.85"/>
    <circle cx="0" cy="-6" r="0.8" fill="${s.deep}"/>
    <circle cx="-3.2" cy="-5.5" r="0.7" fill="${s.deep}"/>
    <circle cx="3.2" cy="-5.5" r="0.7" fill="${s.deep}"/>
    <circle cx="-5.2" cy="-4.5" r="0.7" fill="${s.deep}"/>
    <circle cx="5.2" cy="-4.5" r="0.7" fill="${s.deep}"/>
  </g>`;
  html += `<g style="${aEmerge(STEM_X, bloomY, centreEmergeAt, EMERGE, "el-emerge")}">${centreBody}</g>`;

  return html;
}

// Amaranthus — single thick stem with alternating blade leaves, a
// developing inflorescence at the apex (stage 4), and the signature
// hanging tassels at full bloom (stage 5). The bud→bloom transition
// retracts the small bud while four tassels drop outward from the
// apex (three long-hanging + one short topknot).
function amaranthusGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("amaranthus", targetIdx);
  if (targetIdx === 1) return stage1("amaranthus");

  const s = SKIN.amaranthus;

  // Standard single-stem timing.
  const stemTop = { 2: H.s2, 3: H.s3, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemRange = SOIL_Y - stemTop;
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.2} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.2} ${stemMidY} ${STEM_X} ${stemTop + 1}`;
  const stemWidth = targetIdx >= 5 ? 2.8 : (targetIdx >= 4 ? 2.6 : 2.4);

  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / stemRange);
  };

  let html = "";

  // === SEED ===
  html += `<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("amaranthus")}</g>`;

  // === STEM ===
  html += `<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="${stemWidth}" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;
  html += `<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM_VEIN}" stroke-width="${(stemWidth * 0.35).toFixed(2)}" stroke-linecap="round" opacity="0.55"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`;

  // === COTYLEDONS ===
  const cotyX = STEM_X + 0.5;
  const cotyY = H.s2;
  const cotyEmergeAt = stemReachesAt(cotyY);
  const cotyFallAt = stemReachesAt(H.s3);
  const leftCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-left")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  const rightCotyStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-right")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  html += `<g style="${leftCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;
  html += `<g style="${rightCotyStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`;

  if (targetIdx === 2) return html;

  // === BLADE LEAVES — alternating left/right at successive heights.
  // Stage 3/4 stack 4-5 blades; stage 5 leaves the upper slot for
  // the inflorescence, so it has fewer + slightly bigger blades. ===
  const bladeSpec = {
    3: [
      { ay: 128, rotate: -42, length: 22, width: 5 },
      { ay: 116, rotate: 42,  length: 19, width: 4.6, opacity: 0.92 },
      { ay: 102, rotate: -52, length: 15, width: 4,   opacity: 0.88 },
      { ay: 92,  rotate: 48,  length: 12, width: 3.6, opacity: 0.85 },
    ],
    4: [
      { ay: 128, rotate: -42, length: 24, width: 5.2 },
      { ay: 114, rotate: 42,  length: 21, width: 4.8, opacity: 0.92 },
      { ay: 98,  rotate: -52, length: 16, width: 4.2, opacity: 0.88 },
      { ay: 82,  rotate: 48,  length: 13, width: 3.8, opacity: 0.85 },
      { ay: 66,  rotate: -42, length: 10, width: 3.4, opacity: 0.82 },
    ],
    5: [
      { ay: 128, rotate: -42, length: 26, width: 5.4 },
      { ay: 112, rotate: 42,  length: 22, width: 5,   opacity: 0.92 },
      { ay: 94,  rotate: -52, length: 17, width: 4.4, opacity: 0.88 },
      { ay: 76,  rotate: 48,  length: 13, width: 4,   opacity: 0.85 },
    ],
  }[targetIdx];
  bladeSpec.forEach((cfg, idx) => {
    const body = blade({
      anchorX: STEM_X,
      anchorY: cfg.ay,
      rotate: cfg.rotate,
      length: cfg.length,
      width: cfg.width,
      opacity: cfg.opacity ?? 1,
      sway: false,
    });
    const startAt = stemReachesAt(cfg.ay) + idx * 0.05;
    html += `<g style="${aEmerge(STEM_X, cfg.ay, startAt, EMERGE, "leaf-emerge")}">${body}</g>`;
  });

  // === PRE-BUD (growing tip) at apex ===
  const preBudY = H.s3;
  const preBudEmergeAt = stemReachesAt(preBudY);
  const preBudEmergeDur = 0.6;
  const preBudBody = `<g filter="${sunFilterSoft("amaranthus", 3)}">${growingTip("amaranthus", STEM_X, preBudY)}</g>`;

  if (targetIdx === 3) {
    html += `<g style="${aEmerge(STEM_X, preBudY, preBudEmergeAt, preBudEmergeDur, "bud-swell")}">${preBudBody}</g>`;
    return html;
  }

  // target >= 4: pre-bud rises and morphs into the developing
  // inflorescence at the apex.
  const closedBudY = H.s4;
  const riseY = closedBudY - preBudY; // -35
  const preBudRiseStart = preBudEmergeAt + preBudEmergeDur;
  const preBudFadeAt = stemReachesAt(closedBudY);
  const preBudRiseDur = Math.max(0.3, preBudFadeAt - preBudRiseStart);
  const preBudStyle =
    `--rise-y: ${riseY}px; ` +
    `transform-origin: ${STEM_X}px ${preBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${preBudEmergeDur}s ${EASE_EMERGE} ${preBudEmergeAt.toFixed(2)}s forwards, ` +
    `pre-bud-rise ${preBudRiseDur.toFixed(2)}s linear ${preBudRiseStart.toFixed(2)}s forwards, ` +
    `pre-bud-fade 0.45s ${EASE_RETRACT} ${preBudFadeAt.toFixed(2)}s forwards;`;
  html += `<g style="${preBudStyle}">${preBudBody}</g>`;

  // === CLOSED BUD — early inflorescence: small head + the first
  // pink curve starting to droop downward. ===
  const closedBudBody = `<g transform="translate(${STEM_X} ${closedBudY})" filter="${sunFilter("amaranthus", 4)}">
    <ellipse cx="0" cy="-3" rx="3.2" ry="3.8" fill="${s.shade}"/>
    <ellipse cx="-0.6" cy="-4" rx="2.2" ry="3" fill="${s.petal}" opacity="0.95"/>
    <path d="M 0 -1 Q 0 6 0 14" fill="none" stroke="${s.petal}" stroke-width="3.4" stroke-linecap="round"/>
    <line x1="-3" y1="4" x2="-1" y2="4.4" stroke="${s.hi}" stroke-width="0.7" stroke-linecap="round"/>
    <line x1="-3" y1="9" x2="-1" y2="9.4" stroke="${s.hi}" stroke-width="0.7" stroke-linecap="round"/>
    <line x1="1" y1="4" x2="3" y2="4.4" stroke="${s.hi}" stroke-width="0.7" stroke-linecap="round"/>
    <line x1="1" y1="9" x2="3" y2="9.4" stroke="${s.hi}" stroke-width="0.7" stroke-linecap="round"/>
    <circle cx="0" cy="14" r="1" fill="${s.hi}"/>
  </g>`;
  const closedBudEmergeAt = stemReachesAt(closedBudY);

  if (targetIdx === 4) {
    html += `<g style="${aEmerge(STEM_X, closedBudY, closedBudEmergeAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`;
    return html;
  }

  // ============ target=5: tassels ============
  // The closed bud emerges briefly, then retracts as the apex base
  // settles into place and the tassels drop downward.
  const bloomTransitionAt = stemReachesAt(H.s5Stem);
  html += `<g style="${aEmergeRetract(STEM_X, closedBudY, closedBudEmergeAt, bloomTransitionAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`;

  // Apex base — small dark+light ellipse pair where the tassels emerge.
  const apexY = H.s5Stem - 2;
  const apexEmergeAt = bloomTransitionAt;
  const apexBody = `<g>
    <ellipse cx="${STEM_X}" cy="${apexY}" rx="4" ry="2.8" fill="${s.shade}"/>
    <ellipse cx="${STEM_X - 0.8}" cy="${apexY - 1}" rx="2.2" ry="1.4" fill="${s.petal}" opacity="0.85"/>
  </g>`;
  html += `<g style="${aEmerge(STEM_X, apexY, apexEmergeAt, EMERGE * 0.7, "el-emerge")}">${apexBody}</g>`;

  // Tassels — three hanging + one short topknot. Each emerges with
  // its own transform-origin at its anchor point on the apex so the
  // tassel feels like it's pouring out and drooping into place.
  function tassel({ startX, startY, endX, endY, thickness = 5, fuzz = 10, opacity = 1 }) {
    const cp1x = startX + (endX - startX) * 0.3;
    const cp1y = startY + (endY - startY) * 0.4;
    const cp2x = startX + (endX - startX) * 0.7;
    const cp2y = startY + (endY - startY) * 0.7;
    const bezier = (t) => {
      const u = 1 - t;
      return [
        u * u * u * startX + 3 * u * u * t * cp1x + 3 * u * t * t * cp2x + t * t * t * endX,
        u * u * u * startY + 3 * u * u * t * cp1y + 3 * u * t * t * cp2y + t * t * t * endY,
      ];
    };
    const tangent = (t) => {
      const u = 1 - t;
      return [
        3 * u * u * (cp1x - startX) + 6 * u * t * (cp2x - cp1x) + 3 * t * t * (endX - cp2x),
        3 * u * u * (cp1y - startY) + 6 * u * t * (cp2y - cp1y) + 3 * t * t * (endY - cp2y),
      ];
    };
    let parts = `
      <path d="M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}"
            fill="none" stroke="${s.petal}" stroke-width="${thickness}"
            stroke-linecap="round" opacity="${opacity}"/>
      <path d="M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}"
            fill="none" stroke="${s.shade}" stroke-width="${thickness * 0.5}"
            stroke-linecap="round" opacity="${opacity * 0.55}"/>
    `;
    for (let i = 1; i < fuzz; i++) {
      const t = i / fuzz;
      const [x, y] = bezier(t);
      const [dx, dy] = tangent(t);
      const len = Math.hypot(dx, dy) || 1;
      const px = -dy / len;
      const py = dx / len;
      const hairLen = thickness * 0.55 + t * thickness * 0.2;
      parts += `
        <line x1="${(x - px * hairLen).toFixed(2)}" y1="${(y - py * hairLen).toFixed(2)}"
              x2="${(x + px * hairLen).toFixed(2)}" y2="${(y + py * hairLen).toFixed(2)}"
              stroke="${s.petal}" stroke-width="${(thickness * 0.4).toFixed(2)}"
              stroke-linecap="round" opacity="${opacity * 0.8}"/>
        <line x1="${(x - px * hairLen).toFixed(2)}" y1="${(y - py * hairLen).toFixed(2)}"
              x2="${(x - px * hairLen * 1.3).toFixed(2)}" y2="${(y - py * hairLen * 1.3).toFixed(2)}"
              stroke="${s.hi}" stroke-width="${(thickness * 0.22).toFixed(2)}"
              stroke-linecap="round" opacity="${opacity * 0.7}"/>
      `;
    }
    parts += `<circle cx="${endX}" cy="${endY}" r="${(thickness * 0.45).toFixed(2)}" fill="${s.hi}" opacity="${opacity * 0.9}"/>`;
    return parts;
  }

  const tassels = [
    { startX: STEM_X - 3, startY: H.s5Stem - 1, endX: STEM_X - 9, endY: H.s5Stem + 60, thickness: 4.4, fuzz: 10, opacity: 0.92 },
    { startX: STEM_X + 3, startY: H.s5Stem - 1, endX: STEM_X + 10, endY: H.s5Stem + 64, thickness: 4.4, fuzz: 10, opacity: 0.92 },
    { startX: STEM_X,     startY: H.s5Stem - 3, endX: STEM_X + 1,  endY: H.s5Stem + 78, thickness: 5.2, fuzz: 12, opacity: 1 },
    { startX: STEM_X,     startY: H.s5Stem - 4, endX: STEM_X - 1,  endY: H.s5Stem - 22, thickness: 3.4, fuzz: 6,  opacity: 0.88 },
  ];
  const tasselBaseAt = bloomTransitionAt + 0.15;
  tassels.forEach((t, idx) => {
    const body = `<g filter="${sunFilterSoft("amaranthus", 5)}">${tassel(t)}</g>`;
    const startAt = tasselBaseAt + idx * 0.08;
    html += `<g style="${aEmerge(t.startX, t.startY, startAt, EMERGE, "leaf-emerge")}">${body}</g>`;
  });

  return html;
}

// Shared cotyledon helper — every species' target=2 sprout uses the
// same two-leaflet shape at H.s2 with the same emerge/fall behavior.
// For target >= 3 the cotyledons fall away once the stem reaches the
// young-plant height; for target=2 they stay as the final state.
function emitCotyledons(html, stemReachesAt, targetIdx) {
  const cotyX = STEM_X + 0.5;
  const cotyY = H.s2;
  const cotyEmergeAt = stemReachesAt(cotyY);
  const cotyFallAt = stemReachesAt(H.s3);
  const leftStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-left")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  const rightStyle = targetIdx >= 3
    ? aEmergeFall(cotyX, cotyY, cotyEmergeAt, cotyFallAt, "cot-fall-right")
    : aEmerge(cotyX, cotyY, cotyEmergeAt, EMERGE, "leaf-emerge");
  html.push(`<g style="${leftStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C -10 -2 -13 -8 -12 -12 C -5 -12 -1 -6 0 0 Z" fill="${LEAF}"/>
      <path d="M -1 -1 Q -6 -5 -10 -10" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`);
  html.push(`<g style="${rightStyle}">
    <g transform="translate(${cotyX} ${cotyY})">
      <path d="M 0 0 C 6 -5 11 -12 10 -17 C 4 -15 0 -8 0 0 Z" fill="${LEAF}" opacity="0.93"/>
      <path d="M 1 -2 Q 5 -8 8 -14" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.55"/>
    </g>
  </g>`);
}

// Cherry — sapling/tree with bark trunk, splaying branches, scattered
// leaves, pink buds at stage 4 and pink-five-petal blossoms at stage 5.
function cherryGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("cherry", targetIdx);
  if (targetIdx === 1) return stage1("cherry");
  const s = SKIN.cherry;

  // Trunk endpoint per stage matches the static geometry.
  const trunkTop = { 2: H.s2, 3: H.s3 + 8, 4: H.s4 + 6, 5: 70 }[targetIdx];
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemReachesAt = (y) => {
    const clamped = Math.max(trunkTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - trunkTop));
  };

  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("cherry")}</g>`);

  // Trunk path varies per target.
  const trunkPaths = {
    2: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2}`,
    3: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 120 ${STEM_X} ${H.s3 + 8}`,
    4: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 105 ${STEM_X - 1} ${H.s4 + 6}`,
    5: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 105 ${STEM_X - 2} 70`,
  };
  const trunkWidth = { 2: 2.4, 3: 3.4, 4: 3.8, 5: 4.2 }[targetIdx];
  html.push(`<path d="${trunkPaths[targetIdx]}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${targetIdx === 2 ? STEM : s.bark}" stroke-width="${trunkWidth}" stroke-linecap="round"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);

  emitCotyledons(html, stemReachesAt, targetIdx);
  if (targetIdx === 2) return html.join("");

  // Branches (per-stage paths and tip positions).
  const branchSpecs = {
    3: [
      { d: `M ${STEM_X} 112 Q ${STEM_X - 6} 106 ${STEM_X - 10} 98`, width: 1.8, drawAtY: 112, tip: [STEM_X - 10, 98] },
    ],
    4: [
      { d: `M ${STEM_X - 1} 110 Q ${STEM_X - 12} 92 ${STEM_X - 18} 75`, width: 2.2, drawAtY: 110, tip: [STEM_X - 18, 75] },
      { d: `M ${STEM_X - 1} 90 Q ${STEM_X + 11} 80 ${STEM_X + 17} 65`,  width: 2.2, drawAtY: 90,  tip: [STEM_X + 17, 65] },
      { d: `M ${STEM_X - 1} 70 Q ${STEM_X - 5} 60 ${STEM_X - 8} 52`,    width: 1.8, drawAtY: 70,  tip: [STEM_X - 8, 52] },
    ],
    5: [
      { d: `M ${STEM_X - 1} 100 Q ${STEM_X - 15} 80 ${STEM_X - 24} 55 Q ${STEM_X - 28} 42 ${STEM_X - 29} 30`, width: 2.6, drawAtY: 100, tip: [STEM_X - 29, 30] },
      { d: `M ${STEM_X - 1} 80 Q ${STEM_X + 12} 70 ${STEM_X + 20} 50 Q ${STEM_X + 26} 35 ${STEM_X + 28} 22`,   width: 2.6, drawAtY: 80,  tip: [STEM_X + 28, 22] },
      { d: `M ${STEM_X - 2} 90 Q ${STEM_X - 9} 75 ${STEM_X - 11} 58`,    width: 1.8, drawAtY: 90,  tip: [STEM_X - 11, 58] },
      { d: `M ${STEM_X - 2} 70 Q ${STEM_X + 6} 55 ${STEM_X + 10} 40`,    width: 1.8, drawAtY: 70,  tip: [STEM_X + 10, 40] },
      { d: `M ${STEM_X - 2} 70 L ${STEM_X - 2} 45 L ${STEM_X + 2} 28 L ${STEM_X + 4} ${H.s5}`, width: 2, drawAtY: 70, tip: [STEM_X + 4, H.s5] },
    ],
  }[targetIdx] || [];
  const branchDur = 0.55;
  const branchEnds = [];
  branchSpecs.forEach((b, idx) => {
    const startAt = stemReachesAt(b.drawAtY) + idx * 0.06;
    html.push(`<path d="${b.d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${s.bark}" stroke-width="${b.width}" stroke-linecap="round"
              style="animation: stem-draw ${branchDur}s ${EASE_STEM} ${startAt.toFixed(2)}s forwards;"/>`);
    branchEnds.push(startAt + branchDur);
  });
  const branchesDoneAt = branchEnds.length ? Math.max(...branchEnds) : stemStartAt + stemDuration;

  // Leaves.
  const leafSpec = {
    3: [
      { ax: STEM_X - 10, ay: 98,         rotate: -55, length: 10, width: 4 },
      { ax: STEM_X,      ay: H.s3 + 12,  rotate: 50,  length: 9,  width: 3.6 },
      { ax: STEM_X - 4,  ay: 122,        rotate: -70, length: 8,  width: 3.4 },
    ],
    4: [
      { ax: STEM_X - 15, ay: 84, rotate: -60, length: 8, width: 3.4 },
      { ax: STEM_X + 12, ay: 76, rotate: 60,  length: 8, width: 3.4 },
      { ax: STEM_X - 6,  ay: 62, rotate: -40, length: 7, width: 3 },
      { ax: STEM_X + 3,  ay: 80, rotate: 50,  length: 7, width: 3, opacity: 0.9 },
    ],
    5: [
      { ax: STEM_X - 22, ay: 56, rotate: -60, length: 8, width: 3.2 },
      { ax: STEM_X + 18, ay: 50, rotate: 60,  length: 8, width: 3.2 },
      { ax: STEM_X - 9,  ay: 68, rotate: -40, length: 7, width: 3 },
      { ax: STEM_X + 7,  ay: 45, rotate: 50,  length: 7, width: 3 },
      { ax: STEM_X - 4,  ay: 35, rotate: -30, length: 6, width: 2.8, opacity: 0.9 },
    ],
  }[targetIdx] || [];
  leafSpec.forEach((cfg, idx) => {
    const body = leaf({ anchorX: cfg.ax, anchorY: cfg.ay, rotate: cfg.rotate, length: cfg.length, width: cfg.width, opacity: cfg.opacity ?? 1, sway: false });
    const startAt = branchesDoneAt + idx * 0.07;
    html.push(`<g style="${aEmerge(cfg.ax, cfg.ay, startAt, EMERGE, "leaf-emerge")}">${body}</g>`);
  });

  if (targetIdx === 3) {
    // Apex growing tip emerges last.
    const tipAt = branchesDoneAt + leafSpec.length * 0.07 + 0.05;
    html.push(`<g style="${aEmerge(STEM_X, H.s3 + 8, tipAt, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("cherry", 3)}">${growingTip("cherry", STEM_X, H.s3 + 8)}</g>
    </g>`);
    return html.join("");
  }

  // Buds (target=4) or blossoms (target=5).
  const decorBase = branchesDoneAt + leafSpec.length * 0.07 + 0.1;
  if (targetIdx === 4) {
    const buds = [
      [STEM_X - 18, 75], [STEM_X + 17, 65], [STEM_X - 8, 52],
      [STEM_X - 1, H.s4 + 6], [STEM_X - 13, 80], [STEM_X + 13, 72],
    ];
    buds.forEach(([x, y], idx) => {
      const at = decorBase + idx * 0.08;
      html.push(`<g style="${aEmerge(x, y, at, EMERGE, "bud-swell")}">
        <g filter="${sunFilter("cherry", 4)}">${cherryBud(x, y)}</g>
      </g>`);
    });
    return html.join("");
  }

  // target === 5: 15 blossoms scattered across branch tips.
  const blossoms = [
    [STEM_X - 29, 30, 1],   [STEM_X - 32, 25, 0.85], [STEM_X - 25, 28, 0.9],
    [STEM_X - 27, 36, 0.8], [STEM_X + 28, 22, 1],    [STEM_X + 31, 17, 0.85],
    [STEM_X + 24, 25, 0.9], [STEM_X + 27, 30, 0.8],  [STEM_X - 11, 58, 0.95],
    [STEM_X - 14, 54, 0.8], [STEM_X + 10, 40, 0.95], [STEM_X + 6, 44, 0.8],
    [STEM_X + 4, H.s5, 1],  [STEM_X + 8, H.s5 + 4, 0.85], [STEM_X, 22, 0.8],
  ];
  blossoms.forEach(([x, y, scale], idx) => {
    const at = decorBase + idx * 0.05;
    html.push(`<g style="${aEmerge(x, y, at, EMERGE, "leaf-emerge")}">
      <g filter="${sunFilter("cherry", 5)}">${cherryBlossom(x, y, scale)}</g>
    </g>`);
  });
  return html.join("");
}

// Wisteria — single vine stem with compound leaves on alternating
// sides and hanging racemes at stage 5.
function wisteriaGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("wisteria", targetIdx);
  if (targetIdx === 1) return stage1("wisteria");
  const s = SKIN.wisteria;

  const stemTop = { 2: H.s2, 3: H.s3, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - stemTop));
  };
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.4} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1.4} ${stemMidY} ${STEM_X} ${stemTop + 1}`;
  const stemWidth = { 2: 2.4, 3: 2, 4: 2.2, 5: 2.4 }[targetIdx];

  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("wisteria")}</g>`);
  html.push(`<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM}" stroke-width="${stemWidth}" stroke-linecap="round"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  html.push(`<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM_VEIN}" stroke-width="${(stemWidth * 0.35).toFixed(2)}" stroke-linecap="round" opacity="0.55"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  emitCotyledons(html, stemReachesAt, targetIdx);
  if (targetIdx === 2) return html.join("");

  // Two compound leaves (left & right). Each is a midrib + 3 leaflets.
  const compoundLeafSpec = targetIdx === 3
    ? { rightAtY: 112, leftAtY: 96, rightMid: `M ${STEM_X} 112 Q ${STEM_X + 6} 108 ${STEM_X + 13} 104`, leftMid: `M ${STEM_X} 96 Q ${STEM_X - 6} 92 ${STEM_X - 13} 88`,
        rightLeaflets: [[STEM_X + 5, 111, 60], [STEM_X + 9, 107, 70], [STEM_X + 13, 104, 82]],
        leftLeaflets:  [[STEM_X - 5, 95, -60], [STEM_X - 9, 91, -70], [STEM_X - 13, 88, -82]] }
    : { rightAtY: 110, leftAtY: 88, rightMid: `M ${STEM_X} 110 Q ${STEM_X + 6} 106 ${STEM_X + 13} 102`, leftMid: `M ${STEM_X} 88 Q ${STEM_X - 6} 84 ${STEM_X - 13} 80`,
        rightLeaflets: [[STEM_X + 5, 109, 60], [STEM_X + 9, 105, 70], [STEM_X + 13, 102, 82]],
        leftLeaflets:  [[STEM_X - 5, 87, -60], [STEM_X - 9, 83, -70], [STEM_X - 13, 80, -82]] };
  const midDur = 0.4;
  const emitCompound = (midPath, leaflets, midY) => {
    const midStart = stemReachesAt(midY);
    html.push(`<path d="${midPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="1" stroke-linecap="round"
                style="animation: stem-draw ${midDur}s ${EASE_STEM} ${midStart.toFixed(2)}s forwards;"/>`);
    leaflets.forEach(([lx, ly, rot], idx) => {
      const at = midStart + midDur + idx * 0.07;
      const lw = idx === 2 ? 2.8 : 3;
      const ll = idx === 2 ? 6 : 7;
      const body = leaf({ anchorX: lx, anchorY: ly, rotate: rot, length: ll, width: lw, sway: false });
      html.push(`<g style="${aEmerge(lx, ly, at, EMERGE, "leaf-emerge")}">${body}</g>`);
    });
  };
  emitCompound(compoundLeafSpec.rightMid, compoundLeafSpec.rightLeaflets, compoundLeafSpec.rightAtY);
  emitCompound(compoundLeafSpec.leftMid, compoundLeafSpec.leftLeaflets, compoundLeafSpec.leftAtY);

  if (targetIdx === 3) {
    const at = stemReachesAt(H.s3);
    html.push(`<g style="${aEmerge(STEM_X, H.s3, at, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("wisteria", 3)}">${growingTip("wisteria", STEM_X, H.s3)}</g>
    </g>`);
    return html.join("");
  }

  // Stages 4 & 5: a horizontal arbor branch + hanging cluster buds (s4)
  // or hanging racemes (s5).
  const arborSpec = targetIdx === 4
    ? { d: `M ${STEM_X - 8} ${H.s4 + 5} Q ${STEM_X} ${H.s4 + 2} ${STEM_X + 8} ${H.s4 + 5}`, width: 1.6, drawAtY: H.s4 + 2 }
    : { d: `M ${STEM_X - 16} ${H.s5Stem + 4} Q ${STEM_X} ${H.s5Stem - 1} ${STEM_X + 16} ${H.s5Stem + 4}`, width: 2.2, drawAtY: H.s5Stem };
  const arborStart = stemReachesAt(arborSpec.drawAtY);
  const arborDur = 0.55;
  html.push(`<path d="${arborSpec.d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM}" stroke-width="${arborSpec.width}" stroke-linecap="round"
              style="animation: stem-draw ${arborDur}s ${EASE_STEM} ${arborStart.toFixed(2)}s forwards;"/>`);
  const decorBase = arborStart + arborDur + 0.05;

  if (targetIdx === 4) {
    // 3 short hanging pre-bloom cluster buds.
    const clusters = [
      [STEM_X - 7, H.s4 + 8, 0.92],
      [STEM_X,     H.s4 + 6, 1],
      [STEM_X + 7, H.s4 + 8, 0.92],
    ];
    clusters.forEach(([x, y, op], idx) => {
      const at = decorBase + idx * 0.08;
      const ryAd = idx === 1 ? 3.4 : 3;
      const ryIn = idx === 1 ? 2.6 : 2.4;
      html.push(`<g style="${aEmerge(x, y, at, EMERGE, "bud-swell")}">
        <g transform="translate(${x} ${y})" filter="${sunFilter("wisteria", 4)}">
          <ellipse cx="0" cy="0" rx="2.4" ry="1.4" fill="${LEAF}"/>
          <ellipse cx="0" cy="${idx === 1 ? 5 : 4}" rx="${idx === 1 ? 2.2 : 2}" ry="${ryAd}" fill="${s.shade}" opacity="${0.9 * op}"/>
          <ellipse cx="-0.4" cy="${idx === 1 ? 4.5 : 3.5}" rx="${idx === 1 ? 1.6 : 1.4}" ry="${ryIn}" fill="${s.petal}" opacity="${0.7 * op}"/>
          <circle cx="0" cy="${idx === 1 ? 10 : 8}" r="${idx === 1 ? 0.9 : 0.8}" fill="${s.shade}"/>
        </g>
      </g>`);
    });
    return html.join("");
  }

  // target === 5: 4 hanging racemes.
  const racemes = [
    [STEM_X - 14, H.s5Stem + 6, 36],
    [STEM_X - 5,  H.s5Stem + 4, 48],
    [STEM_X + 5,  H.s5Stem + 4, 44],
    [STEM_X + 14, H.s5Stem + 6, 32],
  ];
  racemes.forEach(([x, y, len], idx) => {
    const at = decorBase + idx * 0.1;
    html.push(`<g style="${aEmerge(x, y, at, EMERGE, "leaf-emerge")}">
      <g filter="${sunFilter("wisteria", 5)}">${wisteriaRaceme(x, y, len)}</g>
    </g>`);
  });
  return html.join("");
}

// Lotus — single straight stem with a lily-pad leaf on a side stalk;
// elongated bud at stage 4 morphs into the open lotus at stage 5.
function lotusGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("lotus", targetIdx);
  if (targetIdx === 1) return stage1("lotus");

  const stemTop = { 2: H.s2, 3: H.s3, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - stemTop));
  };
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 0.6} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 0.6} ${stemMidY} ${STEM_X} ${stemTop + 1}`;
  const stemWidth = targetIdx === 2 ? 2.4 : 2.2;

  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("lotus")}</g>`);
  html.push(`<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM}" stroke-width="${stemWidth}" stroke-linecap="round"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  html.push(`<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM_VEIN}" stroke-width="${(stemWidth * 0.35).toFixed(2)}" stroke-linecap="round" opacity="0.55"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  emitCotyledons(html, stemReachesAt, targetIdx);
  if (targetIdx === 2) return html.join("");

  // Pad on side stalk — bigger as stages progress.
  const padSpec = {
    3: { stalkPath: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 8} 145 ${STEM_X + 14} 140`, padX: STEM_X + 14, padY: 140, padScale: 0.45 },
    4: { stalkPath: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 9} 142 ${STEM_X + 16} 138`, padX: STEM_X + 16, padY: 138, padScale: 0.55 },
    5: { stalkPath: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X + 10} 142 ${STEM_X + 18} 138`, padX: STEM_X + 18, padY: 138, padScale: 0.65 },
  }[targetIdx];
  const padStart = stemReachesAt(SOIL_Y - 5);
  const padDur = 0.5;
  html.push(`<path d="${padSpec.stalkPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM}" stroke-width="${targetIdx === 3 ? 1.6 : (targetIdx === 4 ? 1.8 : 2)}" stroke-linecap="round"
              style="animation: stem-draw ${padDur}s ${EASE_STEM} ${padStart.toFixed(2)}s forwards;"/>`);
  const padEmergeAt = padStart + padDur;
  html.push(`<g style="${aEmerge(padSpec.padX, padSpec.padY, padEmergeAt, EMERGE, "leaf-emerge")}">
    <g transform="translate(${padSpec.padX} ${padSpec.padY}) scale(${padSpec.padScale})">
      <ellipse cx="0" cy="0" rx="${targetIdx === 4 ? 13 : 12}" ry="${targetIdx === 4 ? 10 : 9}" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4"/>
      <path d="M 0 0 L 9 -4 M 0 0 L 11 0 M 0 0 L 8 4 M 0 0 L -8 -4 M 0 0 L -11 0 M 0 0 L -7 4"
            stroke="${VEIN_LITE}" stroke-width="0.5" fill="none" opacity="0.6"/>
    </g>
  </g>`);

  // Stage 5 has a second smaller pad on the left.
  if (targetIdx === 5) {
    const stalk2Start = padEmergeAt + 0.15;
    html.push(`<path d="M ${STEM_X} 135 Q ${STEM_X - 8} 132 ${STEM_X - 14} 128"
                pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="1.6" stroke-linecap="round"
                style="animation: stem-draw 0.4s ${EASE_STEM} ${stalk2Start.toFixed(2)}s forwards;"/>`);
    html.push(`<g style="${aEmerge(STEM_X - 14, 128, stalk2Start + 0.4, EMERGE, "leaf-emerge")}">
      <g transform="translate(${STEM_X - 14} 128) scale(0.45)">
        <ellipse cx="0" cy="0" rx="12" ry="9" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4" opacity="0.92"/>
        <path d="M 0 0 L 9 -4 M 0 0 L 11 0 M 0 0 L 8 4 M 0 0 L -8 -4 M 0 0 L -11 0 M 0 0 L -7 4"
              stroke="${VEIN_LITE}" stroke-width="0.5" fill="none" opacity="0.6"/>
      </g>
    </g>`);
  }

  if (targetIdx === 3) {
    const at = stemReachesAt(H.s3);
    html.push(`<g style="${aEmerge(STEM_X, H.s3, at, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("lotus", 3)}">${growingTip("lotus", STEM_X, H.s3)}</g>
    </g>`);
    return html.join("");
  }

  const s = SKIN.lotus;
  const closedBudY = H.s4 + 4;
  const closedBudBody = `<g transform="translate(${STEM_X} ${closedBudY})" filter="${sunFilter("lotus", 4)}">
    <path d="M 0 0 C -5 -3 -5 -16 0 -22 C 5 -16 5 -3 0 0 Z" fill="${s.petal}" stroke="${s.deep}" stroke-width="0.4"/>
    <path d="M -2 -2 C -3 -8 -2 -16 0 -20" stroke="${s.shade}" stroke-width="0.5" fill="none" opacity="0.65"/>
    <path d="M 2 -2 C 3 -8 2 -16 0 -20" stroke="${s.shade}" stroke-width="0.5" fill="none" opacity="0.65"/>
    <path d="M 0 -22 L 0 -1" stroke="${s.deep}" stroke-width="0.4" opacity="0.55"/>
    <path d="M -3 -1 Q -5 2 -5 4 M 3 -1 Q 5 2 5 4" stroke="${STEM}" stroke-width="0.8" stroke-linecap="round" fill="none"/>
  </g>`;
  const budEmergeAt = stemReachesAt(closedBudY);

  if (targetIdx === 4) {
    html.push(`<g style="${aEmerge(STEM_X, closedBudY, budEmergeAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`);
    return html.join("");
  }

  // target === 5: bud retracts as the open lotus emerges.
  const bloomY = H.s5Stem - 5;
  const bloomTransitionAt = stemReachesAt(bloomY);
  const riseY = bloomY - closedBudY;
  const budStyle =
    `--rise-y: ${riseY}px; ` +
    `transform-origin: ${STEM_X}px ${closedBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${EMERGE}s ${EASE_EMERGE} ${budEmergeAt.toFixed(2)}s forwards, ` +
    `azalea-bud-morph 0.85s ${EASE_RETRACT} ${bloomTransitionAt.toFixed(2)}s forwards;`;
  html.push(`<g style="${budStyle}">${closedBudBody}</g>`);
  html.push(`<g style="${aEmerge(STEM_X, bloomY, bloomTransitionAt + 0.2, EMERGE, "leaf-emerge")}">
    <g transform="translate(${STEM_X} ${bloomY})" filter="${sunFilter("lotus", 5)}">${lotusFlower(0, 0, 1)}</g>
  </g>`);
  return html.join("");
}

// Iris — slim stem rising from a fan of sword-shaped blades. Closed
// pointed bud at stage 4 morphs into the open iris flower at stage 5.
function irisGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("iris", targetIdx);
  if (targetIdx === 1) return stage1("iris");

  const stemTop = { 2: H.s2, 3: H.s3, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - stemTop));
  };
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 0.4} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 0.4} ${stemMidY} ${STEM_X} ${stemTop + 1}`;
  const stemWidth = targetIdx === 2 ? 2.4 : 1.8;

  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("iris")}</g>`);
  html.push(`<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM}" stroke-width="${stemWidth}" stroke-linecap="round"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  html.push(`<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM_VEIN}" stroke-width="${(stemWidth * 0.35).toFixed(2)}" stroke-linecap="round" opacity="0.55"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  emitCotyledons(html, stemReachesAt, targetIdx);
  if (targetIdx === 2) return html.join("");

  const bladeSpec = {
    3: [
      { ax: STEM_X - 2, rotate: -8,  length: 56, width: 4.6 },
      { ax: STEM_X + 2, rotate: 10,  length: 52, width: 4.4, opacity: 0.92 },
      { ax: STEM_X - 4, rotate: -22, length: 42, width: 4,   opacity: 0.85 },
      { ax: STEM_X + 4, rotate: 22,  length: 40, width: 4,   opacity: 0.85 },
    ],
    4: [
      { ax: STEM_X - 2, rotate: -8,  length: 64, width: 4.8 },
      { ax: STEM_X + 2, rotate: 10,  length: 60, width: 4.6, opacity: 0.92 },
      { ax: STEM_X - 4, rotate: -22, length: 48, width: 4.2, opacity: 0.85 },
      { ax: STEM_X + 4, rotate: 22,  length: 46, width: 4.2, opacity: 0.85 },
    ],
    5: [
      { ax: STEM_X - 2, rotate: -8,  length: 68, width: 5 },
      { ax: STEM_X + 2, rotate: 10,  length: 64, width: 4.8, opacity: 0.92 },
      { ax: STEM_X - 4, rotate: -22, length: 50, width: 4.4, opacity: 0.85 },
      { ax: STEM_X + 4, rotate: 22,  length: 48, width: 4.4, opacity: 0.85 },
      { ax: STEM_X - 6, rotate: -34, length: 36, width: 4,   opacity: 0.8 },
      { ax: STEM_X + 6, rotate: 34,  length: 36, width: 4,   opacity: 0.8 },
    ],
  }[targetIdx];
  bladeSpec.forEach((cfg, idx) => {
    const body = blade({ anchorX: cfg.ax, anchorY: SOIL_Y, rotate: cfg.rotate, length: cfg.length, width: cfg.width, opacity: cfg.opacity ?? 1, sway: false });
    // Iris blades grow up from the soil — they reach their tip height as the stem also rises.
    const tipY = SOIL_Y - cfg.length;
    const startAt = stemReachesAt(Math.max(stemTop, tipY)) - 0.2 + idx * 0.06;
    html.push(`<g style="${aEmerge(cfg.ax, SOIL_Y, Math.max(stemStartAt, startAt), EMERGE, "leaf-emerge")}">${body}</g>`);
  });

  if (targetIdx === 3) {
    const at = stemReachesAt(H.s3);
    html.push(`<g style="${aEmerge(STEM_X, H.s3, at, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("iris", 3)}">${growingTip("iris", STEM_X, H.s3)}</g>
    </g>`);
    return html.join("");
  }

  const s = SKIN.iris;
  const closedBudY = H.s4 + 4;
  const closedBudBody = `<g transform="translate(${STEM_X} ${closedBudY})" filter="${sunFilter("iris", 4)}">
    <path d="M 0 0 C -3 -3 -3 -16 0 -22 C 3 -16 3 -3 0 0 Z" fill="${s.shade}" stroke="${s.deep}" stroke-width="0.4"/>
    <path d="M -1.4 -3 C -2 -10 -1 -18 0 -21" stroke="${s.petal}" stroke-width="0.5" fill="none" opacity="0.7"/>
    <path d="M 1.4 -3 C 2 -10 1 -18 0 -21" stroke="${s.inner}" stroke-width="0.5" fill="none" opacity="0.7"/>
    <path d="M 0 -22 L 0 -1" stroke="${s.deep}" stroke-width="0.4" opacity="0.55"/>
  </g>`;
  const budEmergeAt = stemReachesAt(closedBudY);

  if (targetIdx === 4) {
    html.push(`<g style="${aEmerge(STEM_X, closedBudY, budEmergeAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`);
    return html.join("");
  }

  const bloomY = H.s5Stem - 4;
  const bloomTransitionAt = stemReachesAt(bloomY);
  const riseY = bloomY - closedBudY;
  const budStyle =
    `--rise-y: ${riseY}px; ` +
    `transform-origin: ${STEM_X}px ${closedBudY}px; transform: scale(0); ` +
    `animation: bud-swell ${EMERGE}s ${EASE_EMERGE} ${budEmergeAt.toFixed(2)}s forwards, ` +
    `azalea-bud-morph 0.85s ${EASE_RETRACT} ${bloomTransitionAt.toFixed(2)}s forwards;`;
  html.push(`<g style="${budStyle}">${closedBudBody}</g>`);
  html.push(`<g style="${aEmerge(STEM_X, bloomY, bloomTransitionAt + 0.2, EMERGE, "leaf-emerge")}">
    <g transform="translate(${STEM_X} ${bloomY})" filter="${sunFilter("iris", 5)}">${irisFlower(0, 0, 1)}</g>
  </g>`);
  return html.join("");
}

// Bird of paradise — thick stem with banana-shaped leaves on long
// stalks. Closed spathe at stage 4 retracts as the signature open
// bloom (orange + blue petals) emerges at stage 5.
function birdGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("bird", targetIdx);
  if (targetIdx === 1) return stage1("bird");

  const stemTop = { 2: H.s2, 3: H.s3, 4: H.s4, 5: H.s5Stem }[targetIdx];
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemMidY = (SOIL_Y + stemTop) / 2;
  const stemReachesAt = (y) => {
    const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - stemTop));
  };
  const stemPath = `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} ${stemMidY} ${STEM_X} ${stemTop}`;
  const veinPath = `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1} ${stemMidY} ${STEM_X} ${stemTop + 1}`;
  const stemWidth = { 2: 2.4, 3: 2.6, 4: 2.8, 5: 3 }[targetIdx];

  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("bird")}</g>`);
  html.push(`<path d="${stemPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM}" stroke-width="${stemWidth}" stroke-linecap="round"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  html.push(`<path d="${veinPath}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${STEM_VEIN}" stroke-width="${(stemWidth * 0.35).toFixed(2)}" stroke-linecap="round" opacity="0.55"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  emitCotyledons(html, stemReachesAt, targetIdx);
  if (targetIdx === 2) return html.join("");

  // Banana-shaped leaves on long curved stalks.
  const leafStalks = {
    3: [
      { stalk: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 4} 125 ${STEM_X - 10} 105`, leafX: STEM_X - 10, leafY: 105, mirror: false, w: 1.8 },
    ],
    4: [
      { stalk: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 4} 122 ${STEM_X - 12} 100`,     leafX: STEM_X - 12, leafY: 100, mirror: false, w: 1.8 },
      { stalk: `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X + 4} 118 ${STEM_X + 12} 96`,   leafX: STEM_X + 12, leafY: 96,  mirror: true,  w: 1.6 },
    ],
    5: [
      { stalk: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 5} 118 ${STEM_X - 16} 92`,       leafX: STEM_X - 16, leafY: 92,  mirror: false, w: 2 },
      { stalk: `M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X + 5} 116 ${STEM_X + 16} 88`,    leafX: STEM_X + 16, leafY: 88,  mirror: true,  w: 2 },
      { stalk: `M ${STEM_X + 1} ${SOIL_Y - 3} Q ${STEM_X - 2} 100 ${STEM_X - 7} 76`, leafX: STEM_X - 7,  leafY: 76,  mirror: false, w: 1.6, small: true },
    ],
  }[targetIdx];
  const stalkDur = 0.55;
  leafStalks.forEach((ls, idx) => {
    const stalkStart = stemReachesAt(ls.leafY + 18) + idx * 0.1;
    html.push(`<path d="${ls.stalk}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="${ls.w}" stroke-linecap="round"
                style="animation: stem-draw ${stalkDur}s ${EASE_STEM} ${stalkStart.toFixed(2)}s forwards;"/>`);
    const leafEmergeAt = stalkStart + stalkDur;
    let leafBody;
    if (ls.small) {
      leafBody = `<g transform="translate(${ls.leafX} ${ls.leafY})">
        <path d="M 0 0 C -2 -8 -2 -16 3 -20 C 8 -16 7 -7 4 -2 C 2 -1 0 0 0 0 Z" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4" opacity="0.92"/>
      </g>`;
    } else if (targetIdx === 5) {
      leafBody = ls.mirror
        ? `<g transform="translate(${ls.leafX} ${ls.leafY})">
            <path d="M 0 0 C 3 -12 2 -28 -6 -36 C -14 -28 -12 -10 -8 -3 C -4 -1 0 0 0 0 Z" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.45" opacity="0.95"/>
            <path d="M 0 0 C 1 -10 0 -22 -6 -32" stroke="${VEIN}" stroke-width="0.55" fill="none" opacity="0.6"/>
          </g>`
        : `<g transform="translate(${ls.leafX} ${ls.leafY})">
            <path d="M 0 0 C -3 -12 -2 -28 6 -36 C 14 -28 12 -10 8 -3 C 4 -1 0 0 0 0 Z" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.45"/>
            <path d="M 0 0 C -1 -10 0 -22 6 -32" stroke="${VEIN}" stroke-width="0.55" fill="none" opacity="0.6"/>
          </g>`;
    } else {
      leafBody = ls.mirror
        ? `<g transform="translate(${ls.leafX} ${ls.leafY})">
            <path d="M 0 0 C 3 -10 3 -22 -4 -28 C -10 -22 -10 -10 -6 -2 C -2 -1 0 0 0 0 Z" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4" opacity="0.95"/>
          </g>`
        : `<g transform="translate(${ls.leafX} ${ls.leafY})">
            <path d="M 0 0 C -3 -10 -3 ${targetIdx === 3 ? -22 : -24} ${targetIdx === 3 ? 4 : 5} ${targetIdx === 3 ? -28 : -30} C ${targetIdx === 3 ? 10 : 12} ${targetIdx === 3 ? -22 : -24} ${targetIdx === 3 ? 10 : 12} -10 ${targetIdx === 3 ? 6 : 7} -2 C ${targetIdx === 3 ? 2 : 3} -1 0 0 0 0 Z" fill="${LEAF}" stroke="${VEIN}" stroke-width="0.4"/>
            <path d="M 0 0 C -1 -8 0 -18 ${targetIdx === 3 ? 4 : 5} ${targetIdx === 3 ? -26 : -28}" stroke="${VEIN}" stroke-width="0.5" fill="none" opacity="0.6"/>
          </g>`;
    }
    html.push(`<g style="${aEmerge(ls.leafX, ls.leafY, leafEmergeAt, EMERGE, "leaf-emerge")}">${leafBody}</g>`);
  });

  if (targetIdx === 3) {
    const at = stemReachesAt(H.s3);
    html.push(`<g style="${aEmerge(STEM_X, H.s3, at, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("bird", 3)}">${growingTip("bird", STEM_X, H.s3)}</g>
    </g>`);
    return html.join("");
  }

  const s = SKIN.bird;
  const closedBudY = H.s4 + 4;
  const closedBudBody = `<g transform="translate(${STEM_X} ${closedBudY})" filter="${sunFilter("bird", 4)}">
    <path d="M -10 0 Q -5 -10 4 -14 Q 8 -10 6 -1 Q -2 4 -10 0 Z" fill="${s.spathe}" stroke="${s.deep}" stroke-width="0.45"/>
    <path d="M -1 -6 L -1 -2 M 1 -5 L 1 -1" stroke="${s.petal}" stroke-width="0.8" stroke-linecap="round"/>
    <path d="M 4 -8 L 6 -12" stroke="${s.deep}" stroke-width="0.4" fill="none"/>
  </g>`;
  const budEmergeAt = stemReachesAt(closedBudY);

  if (targetIdx === 4) {
    html.push(`<g style="${aEmerge(STEM_X, closedBudY, budEmergeAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`);
    return html.join("");
  }

  const bloomY = H.s5Stem;
  const bloomTransitionAt = stemReachesAt(bloomY);
  html.push(`<g style="${aEmergeRetract(STEM_X, closedBudY, budEmergeAt, bloomTransitionAt, EMERGE, "bud-swell")}">${closedBudBody}</g>`);
  html.push(`<g style="${aEmerge(STEM_X, bloomY, bloomTransitionAt + 0.15, EMERGE, "leaf-emerge")}">
    <g transform="translate(${STEM_X} ${bloomY})" filter="${sunFilter("bird", 5)}">${birdOfParadiseFlower(0, 0, 1)}</g>
  </g>`);
  return html.join("");
}

// Bamboo — multiple culms (stalks). Each stage adds another stalk or
// taller versions. No bloom — bamboo's beauty is the grove itself.
function bambooGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("bamboo", targetIdx);
  if (targetIdx === 1) return stage1("bamboo");

  // For target 2 we use the standard sprout pattern (no culms yet).
  if (targetIdx === 2) {
    const stemTop = H.s2;
    const stemDuration = PHASE;
    const stemStartAt = PRE;
    const stemReachesAt = (y) => {
      const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
      return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - stemTop));
    };
    const html = [];
    html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("bamboo")}</g>`);
    html.push(`<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2}"
                pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="2.4" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
    emitCotyledons(html, stemReachesAt, targetIdx);
    return html.join("");
  }

  // For target >= 3, each stalk emerges from the soil scaling up
  // vertically (transform-origin at the base) — staggered so the
  // grove fills in over time.
  const stalks = {
    3: [{ x: STEM_X, h: SOIL_Y - H.s3, seg: 3, thick: 2.6 }],
    4: [
      { x: STEM_X,     h: SOIL_Y - H.s4,           seg: 5, thick: 3 },
      { x: STEM_X + 9, h: (SOIL_Y - H.s4) * 0.75,  seg: 4, thick: 2.4 },
    ],
    5: [
      { x: STEM_X - 16, h: (SOIL_Y - H.s5) * 0.78, seg: 6, thick: 2.6 },
      { x: STEM_X - 6,  h: SOIL_Y - H.s5,          seg: 7, thick: 3.2 },
      { x: STEM_X + 6,  h: (SOIL_Y - H.s5) * 0.94, seg: 7, thick: 3 },
      { x: STEM_X + 16, h: (SOIL_Y - H.s5) * 0.72, seg: 5, thick: 2.6 },
    ],
  }[targetIdx];
  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("bamboo")}</g>`);
  const groveDuration = (targetIdx - 1) * PHASE;
  const stalkBase = PRE;
  const perStalkDur = Math.max(0.6, groveDuration / Math.max(1, stalks.length));
  stalks.forEach((st, idx) => {
    const at = stalkBase + idx * (perStalkDur * 0.55);
    // Use scaleY-only would be nice but our keyframes use uniform
    // scale — leaf-emerge ramps Y then X, which is close enough.
    const body = bambooStalk(st.x, SOIL_Y, st.h, st.seg, st.thick);
    html.push(`<g style="transform-origin: ${st.x}px ${SOIL_Y}px; transform: scale(0); animation: leaf-emerge ${perStalkDur.toFixed(2)}s ${EASE_EMERGE} ${at.toFixed(2)}s forwards;">${body}</g>`);
  });
  if (targetIdx === 3) {
    const totalAt = stalkBase + groveDuration;
    html.push(`<g style="${aEmerge(STEM_X, H.s3 + 2, totalAt, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("bamboo", 3)}">${growingTip("bamboo", STEM_X, H.s3 + 2)}</g>
    </g>`);
  }
  return html.join("");
}

// Jacaranda — thin-bark tree with feathery compound leaves and
// blue-purple trumpet flower clusters at stage 5.
function jacarandaGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("jacaranda", targetIdx);
  if (targetIdx === 1) return stage1("jacaranda");
  const s = SKIN.jacaranda;

  const trunkTop = { 2: H.s2, 3: H.s3 + 6, 4: H.s4 + 4, 5: 68 }[targetIdx];
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemReachesAt = (y) => {
    const clamped = Math.max(trunkTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - trunkTop));
  };
  const trunkPaths = {
    2: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2}`,
    3: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 120 ${STEM_X} ${H.s3 + 6}`,
    4: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 105 ${STEM_X - 1} ${H.s4 + 4}`,
    5: `M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1.5} 100 ${STEM_X - 2} 68`,
  };
  const trunkWidth = { 2: 2.4, 3: 2.4, 4: 3, 5: 4 }[targetIdx];

  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("jacaranda")}</g>`);
  html.push(`<path d="${trunkPaths[targetIdx]}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${targetIdx === 2 ? STEM : s.bark}" stroke-width="${trunkWidth}" stroke-linecap="round"
              style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
  emitCotyledons(html, stemReachesAt, targetIdx);
  if (targetIdx === 2) return html.join("");

  // Branches (some stages have feathery compound leaves on midribs).
  const branchSpec = {
    3: [
      { d: `M ${STEM_X} 110 Q ${STEM_X + 6} 105 ${STEM_X + 14} 100`, w: 0.9, drawAtY: 110 },
      { d: `M ${STEM_X} 98 Q ${STEM_X - 6} 93 ${STEM_X - 14} 88`,    w: 0.9, drawAtY: 98 },
    ],
    4: [
      { d: `M ${STEM_X - 1} 105 Q ${STEM_X - 10} 90 ${STEM_X - 14} 72`, w: 1.8, drawAtY: 105 },
      { d: `M ${STEM_X - 1} 85 Q ${STEM_X + 8} 75 ${STEM_X + 14} 62`,    w: 1.8, drawAtY: 85 },
    ],
    5: [
      { d: `M ${STEM_X - 1} 96 Q ${STEM_X - 15} 78 ${STEM_X - 22} 52 Q ${STEM_X - 26} 38 ${STEM_X - 28} 28`, w: 2.4, drawAtY: 96 },
      { d: `M ${STEM_X - 1} 80 Q ${STEM_X + 12} 70 ${STEM_X + 20} 48 Q ${STEM_X + 26} 32 ${STEM_X + 28} ${H.s5 + 4}`, w: 2.4, drawAtY: 80 },
      { d: `M ${STEM_X - 2} 68 L ${STEM_X - 2} 40 L ${STEM_X + 4} 24 L ${STEM_X + 4} ${H.s5}`, w: 2, drawAtY: 68 },
    ],
  }[targetIdx];
  const branchEnds = [];
  branchSpec.forEach((b, idx) => {
    const start = stemReachesAt(b.drawAtY) + idx * 0.06;
    html.push(`<path d="${b.d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${s.bark}" stroke-width="${b.w}" stroke-linecap="round"
              style="animation: stem-draw 0.5s ${EASE_STEM} ${start.toFixed(2)}s forwards;"/>`);
    branchEnds.push(start + 0.5);
  });
  const branchesDoneAt = Math.max(...branchEnds);

  // Leaflets — small leaves at end of each branch.
  const leafletSpec = {
    3: [
      [STEM_X + 4, 109, 70, 5, 2], [STEM_X + 7, 106, 78, 5, 2],
      [STEM_X + 11, 102, 85, 4.6, 1.8], [STEM_X + 14, 100, 90, 4, 1.8],
      [STEM_X - 4, 97, -70, 5, 2], [STEM_X - 7, 94, -78, 5, 2],
      [STEM_X - 11, 90, -85, 4.6, 1.8], [STEM_X - 14, 88, -90, 4, 1.8],
    ],
    4: [
      [STEM_X - 13, 70, -60, 4.6, 1.8], [STEM_X - 11, 67, -75, 4.6, 1.8],
      [STEM_X + 14, 62, 60, 4.6, 1.8],  [STEM_X + 11, 65, 75, 4.6, 1.8],
    ],
    5: [
      [STEM_X - 22, 50, -50, 6, 2.2], [STEM_X - 24, 44, -65, 6, 2.2],
      [STEM_X + 18, 48, 50, 6, 2.2],  [STEM_X + 22, 42, 65, 6, 2.2],
      [STEM_X - 3, 38, -30, 5, 2],    [STEM_X + 4, 32, 35, 5, 2],
    ],
  }[targetIdx];
  leafletSpec.forEach(([lx, ly, rot, ll, lw], idx) => {
    const body = leaf({ anchorX: lx, anchorY: ly, rotate: rot, length: ll, width: lw, sway: false });
    const at = branchesDoneAt + idx * 0.04;
    html.push(`<g style="${aEmerge(lx, ly, at, EMERGE, "leaf-emerge")}">${body}</g>`);
  });

  if (targetIdx === 3) {
    const tipAt = branchesDoneAt + leafletSpec.length * 0.04 + 0.05;
    html.push(`<g style="${aEmerge(STEM_X, H.s3 + 6, tipAt, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("jacaranda", 3)}">${growingTip("jacaranda", STEM_X, H.s3 + 6)}</g>
    </g>`);
    return html.join("");
  }

  const decorBase = branchesDoneAt + leafletSpec.length * 0.04 + 0.1;
  if (targetIdx === 4) {
    const buds = [[STEM_X - 14, 72], [STEM_X + 14, 62], [STEM_X - 1, H.s4 + 4]];
    buds.forEach(([x, y], idx) => {
      const at = decorBase + idx * 0.08;
      html.push(`<g style="${aEmerge(x, y, at, EMERGE, "bud-swell")}">
        <g transform="translate(${x} ${y})" filter="${sunFilter("jacaranda", 4)}">
          <circle cx="0" cy="0" r="${idx === 2 ? 1.8 : 1.6}" fill="${LEAF}"/>
          <circle cx="-0.4" cy="-0.4" r="${idx === 2 ? 1.1 : 1}" fill="${s.shade}" opacity="0.55"/>
        </g>
      </g>`);
    });
    return html.join("");
  }

  // target === 5: blue-purple flower clusters.
  const clusters = [
    [STEM_X - 28, 28, 1],        [STEM_X - 22, 38, 0.9], [STEM_X - 12, 56, 0.85],
    [STEM_X + 28, H.s5 + 4, 1],  [STEM_X + 20, 38, 0.9], [STEM_X + 10, 50, 0.85],
    [STEM_X + 4, H.s5, 1],       [STEM_X - 2, 30, 0.85],
  ];
  clusters.forEach(([x, y, scale], idx) => {
    const at = decorBase + idx * 0.06;
    html.push(`<g style="${aEmerge(x, y, at, EMERGE, "leaf-emerge")}">
      <g filter="${sunFilter("jacaranda", 5)}">${jacarandaCluster(x, y, scale)}</g>
    </g>`);
  });
  return html.join("");
}

// Dragon (dragon-blood tree) — thick trunk + signature umbrella canopy
// of spiky leaf rosettes at stage 5.
function dragonGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("dragon", targetIdx);
  if (targetIdx === 1) return stage1("dragon");
  const s = SKIN.dragon;

  const trunkTop = { 2: H.s2, 3: H.s3 + 10, 4: H.s4 + 8, 5: 60 }[targetIdx];
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;
  const stemReachesAt = (y) => {
    const clamped = Math.max(trunkTop, Math.min(SOIL_Y, y));
    return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - trunkTop));
  };

  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("dragon")}</g>`);

  if (targetIdx === 2) {
    html.push(`<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2}"
                pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="2.4" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
    emitCotyledons(html, stemReachesAt, targetIdx);
    return html.join("");
  }

  // Trunk per stage — a single thick bark path.
  const trunkBody = {
    3: `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 122 ${STEM_X} ${H.s3 + 10}"
              fill="none" stroke="${s.bark}" stroke-width="3.4" stroke-linecap="round"/>
        <path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1} 122 ${STEM_X} ${H.s3 + 11}"
              fill="none" stroke="${s.barkShade}" stroke-width="1.1" stroke-linecap="round" opacity="0.7"/>`,
    4: `<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 1} 110 ${STEM_X} ${H.s4 + 8}"
              fill="none" stroke="${s.bark}" stroke-width="4" stroke-linecap="round"/>
        <path d="M ${STEM_X} ${SOIL_Y - 2} Q ${STEM_X - 1} 110 ${STEM_X} ${H.s4 + 9}"
              fill="none" stroke="${s.barkShade}" stroke-width="1.4" stroke-linecap="round" opacity="0.65"/>`,
    5: `<path d="M ${STEM_X - 1.5} ${SOIL_Y} Q ${STEM_X - 1} 100 ${STEM_X} 60"
              fill="none" stroke="${s.bark}" stroke-width="5" stroke-linecap="round"/>
        <path d="M ${STEM_X + 1.5} ${SOIL_Y} Q ${STEM_X + 1} 100 ${STEM_X} 60"
              fill="none" stroke="${s.barkShade}" stroke-width="2.6" stroke-linecap="round" opacity="0.65"/>`,
  }[targetIdx];
  // Wrap trunk in a draw that uses stem-draw on the front-bark path.
  const trunkAnim = `style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"`;
  // For simplicity wrap the whole trunk group in a vertical reveal via leaf-emerge
  // anchored at SOIL_Y so the trunk "pushes up" out of the soil.
  html.push(`<g style="transform-origin: ${STEM_X}px ${SOIL_Y}px; transform: scale(0); animation: leaf-emerge ${stemDuration.toFixed(2)}s ${EASE_EMERGE} ${stemStartAt.toFixed(2)}s forwards;">${trunkBody}</g>`);

  // Stage 3: leaf rosette at the trunk top + growing tip.
  if (targetIdx === 3) {
    const rosetteAt = stemStartAt + stemDuration;
    html.push(`<g style="${aEmerge(STEM_X, H.s3 + 6, rosetteAt, EMERGE, "leaf-emerge")}">
      <g transform="translate(${STEM_X} ${H.s3 + 6})">
        <path d="M 0 0 L -8 -8 M 0 0 L -5 -10 M 0 0 L -2 -11 M 0 0 L 2 -11 M 0 0 L 5 -10 M 0 0 L 8 -8"
              stroke="${s.canopy}" stroke-width="1" stroke-linecap="round" fill="none"/>
        <path d="M 0 0 L -10 -4 M 0 0 L 10 -4"
              stroke="${s.canopyShade}" stroke-width="1" stroke-linecap="round" fill="none"/>
      </g>
    </g>`);
    html.push(`<g style="${aEmerge(STEM_X, H.s3 + 8, rosetteAt + 0.2, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("dragon", 3)}">${growingTip("dragon", STEM_X, H.s3 + 8)}</g>
    </g>`);
    return html.join("");
  }

  // Stage 4: 3 upward branches + leaf tufts at each tip.
  if (targetIdx === 4) {
    const branches = [
      `M ${STEM_X} ${H.s4 + 8} Q ${STEM_X - 4} ${H.s4} ${STEM_X - 8} ${H.s4 - 4}`,
      `M ${STEM_X} ${H.s4 + 8} Q ${STEM_X} ${H.s4 - 2} ${STEM_X} ${H.s4 - 6}`,
      `M ${STEM_X} ${H.s4 + 8} Q ${STEM_X + 4} ${H.s4} ${STEM_X + 8} ${H.s4 - 4}`,
    ];
    const tips = [[STEM_X - 8, H.s4 - 4, "canopy"], [STEM_X, H.s4 - 6, "canopy"], [STEM_X + 8, H.s4 - 4, "canopyShade"]];
    const branchStart = stemStartAt + stemDuration;
    branches.forEach((d, idx) => {
      const at = branchStart + idx * 0.08;
      html.push(`<path d="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${s.bark}" stroke-width="2" stroke-linecap="round"
                style="animation: stem-draw 0.5s ${EASE_STEM} ${at.toFixed(2)}s forwards;"/>`);
    });
    tips.forEach(([x, y, colorKey], idx) => {
      const at = branchStart + 0.5 + idx * 0.08;
      const stroke = s[colorKey];
      const sw = idx === 1 ? 1 : 0.9;
      html.push(`<g style="${aEmerge(x, y, at, EMERGE, "leaf-emerge")}">
        <g transform="translate(${x} ${y})" filter="${sunFilter("dragon", 4)}">
          <path d="M 0 0 L -3 ${idx === 1 ? -7 : -6} M 0 0 L -1.5 ${idx === 1 ? -8 : -7} M 0 0 L 0 ${idx === 1 ? -9 : -8} M 0 0 L 1.5 ${idx === 1 ? -8 : -7} M 0 0 L 3 ${idx === 1 ? -7 : -6}"
                stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" fill="none"/>
        </g>
      </g>`);
    });
    return html.join("");
  }

  // Stage 5: trunk + signature umbrella canopy + sap drips + branches.
  // Sap drips (small red circles on the trunk — emerge after trunk).
  const trunkDoneAt = stemStartAt + stemDuration;
  html.push(`<g style="${aEmerge(STEM_X - 2, 115, trunkDoneAt + 0.1, EMERGE * 0.6, "el-emerge")}">
    <circle cx="${STEM_X - 2}" cy="115" r="0.9" fill="${s.sap}" opacity="0.85"/>
  </g>`);
  html.push(`<g style="${aEmerge(STEM_X + 1.6, 135, trunkDoneAt + 0.18, EMERGE * 0.6, "el-emerge")}">
    <circle cx="${STEM_X + 1.6}" cy="135" r="0.7" fill="${s.sap}" opacity="0.75"/>
  </g>`);
  html.push(`<g style="${aEmerge(STEM_X, 120, trunkDoneAt + 0.05, EMERGE, "leaf-emerge")}">
    <path d="M ${STEM_X - 1.6} 130 L ${STEM_X - 1.6} 105 M ${STEM_X + 1.6} 120 L ${STEM_X + 1.6} 95"
          stroke="${s.barkShade}" stroke-width="0.5" stroke-linecap="round" opacity="0.55"/>
  </g>`);

  // Primary canopy branches.
  const canopyBranches = [
    `M ${STEM_X} 60 Q ${STEM_X - 6} 50 ${STEM_X - 14} 42`,
    `M ${STEM_X} 60 Q ${STEM_X + 6} 50 ${STEM_X + 14} 42`,
    `M ${STEM_X} 60 Q ${STEM_X - 2} 48 ${STEM_X - 4} 38`,
    `M ${STEM_X} 60 Q ${STEM_X + 2} 48 ${STEM_X + 4} 38`,
  ];
  canopyBranches.forEach((d, idx) => {
    const at = trunkDoneAt + 0.2 + idx * 0.06;
    const w = idx < 2 ? 2.6 : 2.2;
    html.push(`<path d="${d}" pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
              fill="none" stroke="${s.bark}" stroke-width="${w}" stroke-linecap="round"
              style="animation: stem-draw 0.5s ${EASE_STEM} ${at.toFixed(2)}s forwards;"/>`);
  });
  const canopyStart = trunkDoneAt + 0.2 + canopyBranches.length * 0.06 + 0.5;
  html.push(`<g style="${aEmerge(STEM_X, 40, canopyStart, EMERGE, "leaf-emerge")}">
    <g transform="translate(${STEM_X} 40)" filter="${sunFilter("dragon", 5)}">${dragonCanopy(0, 0, 1.6)}</g>
  </g>`);
  return html.join("");
}

// Cereus cactus — ribbed column rises from the soil. Closed cream
// bud at stage 4 morphs into the signature white night-bloom at
// stage 5 (with a small lateral side bud as well).
function cereusGrowth(targetIdx) {
  if (REDUCED_MOTION) return stageContent("cereus", targetIdx);
  if (targetIdx === 1) return stage1("cereus");
  const s = SKIN.cereus;

  if (targetIdx === 2) {
    const stemTop = H.s2;
    const stemDuration = PHASE;
    const stemStartAt = PRE;
    const stemReachesAt = (y) => {
      const clamped = Math.max(stemTop, Math.min(SOIL_Y, y));
      return stemStartAt + stemDuration * ((SOIL_Y - clamped) / (SOIL_Y - stemTop));
    };
    const html = [];
    html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("cereus")}</g>`);
    html.push(`<path d="M ${STEM_X} ${SOIL_Y} Q ${STEM_X - 2} ${SOIL_Y - 14} ${STEM_X + 0.5} ${H.s2}"
                pathLength="1" stroke-dasharray="1" stroke-dashoffset="1"
                fill="none" stroke="${STEM}" stroke-width="2.4" stroke-linecap="round"
                style="animation: stem-draw ${stemDuration.toFixed(2)}s ${EASE_STEM} ${stemStartAt.toFixed(2)}s forwards;"/>`);
    emitCotyledons(html, stemReachesAt, targetIdx);
    return html.join("");
  }

  const columnTopY = { 3: H.s3 + 10, 4: H.s4 + 6, 5: H.s5 + 12 }[targetIdx];
  const columnHalfW = { 3: 5, 4: 6, 5: 6 }[targetIdx];
  const stemDuration = (targetIdx - 1) * PHASE;
  const stemStartAt = PRE;

  const html = [];
  html.push(`<g style="${aRetract(STEM_X, SOIL_Y, PRE)}">${stage1("cereus")}</g>`);
  // Column emerges scaling up from the soil base — keeps the ribbed
  // geometry intact (vs. trying to draw individual rib paths).
  html.push(`<g style="transform-origin: ${STEM_X}px ${SOIL_Y}px; transform: scale(0); animation: leaf-emerge ${stemDuration.toFixed(2)}s ${EASE_EMERGE} ${stemStartAt.toFixed(2)}s forwards;">
    ${cereusColumn(STEM_X, SOIL_Y, columnTopY, columnHalfW)}
  </g>`);
  const columnDoneAt = stemStartAt + stemDuration;

  if (targetIdx === 3) {
    html.push(`<g style="${aEmerge(STEM_X, columnTopY, columnDoneAt + 0.05, 0.6, "bud-swell")}">
      <g filter="${sunFilterSoft("cereus", 3)}">${growingTip("cereus", STEM_X, columnTopY)}</g>
    </g>`);
    return html.join("");
  }

  if (targetIdx === 4) {
    const budY = columnTopY - 1;
    html.push(`<g style="${aEmerge(STEM_X, budY, columnDoneAt + 0.1, EMERGE, "bud-swell")}">
      <g transform="translate(${STEM_X} ${budY})" filter="${sunFilter("cereus", 4)}">
        <ellipse cx="0" cy="-3" rx="2.8" ry="3.6" fill="${s.petal}" stroke="${s.deep}" stroke-width="0.4"/>
        <ellipse cx="-0.4" cy="-4" rx="1.6" ry="2.4" fill="${s.cream}" opacity="0.85"/>
        <path d="M -2.4 0 Q -3.4 2 -3.4 3 M 2.4 0 Q 3.4 2 3.4 3"
              stroke="${s.shade}" stroke-width="0.7" stroke-linecap="round" fill="none"/>
        <path d="M 0 -7 L 0 -1" stroke="${s.deep}" stroke-width="0.4" opacity="0.55"/>
      </g>
    </g>`);
    return html.join("");
  }

  // target === 5: side bud + signature open flower at apex.
  html.push(`<g style="${aEmerge(STEM_X + columnHalfW + 1, 80, columnDoneAt + 0.1, EMERGE, "bud-swell")}">
    <g transform="translate(${STEM_X + columnHalfW + 1} 80) rotate(20)" filter="${sunFilter("cereus", 5)}">
      <ellipse cx="0" cy="0" rx="2.2" ry="3.4" fill="${s.petal}" stroke="${s.deep}" stroke-width="0.35"/>
      <ellipse cx="-0.4" cy="-0.4" rx="1.4" ry="2.4" fill="${s.cream}" opacity="0.85"/>
      <path d="M -2 1.5 Q -3 2.5 -3.4 4 M 2 1.5 Q 3 2.5 3.4 4"
            stroke="${s.shade}" stroke-width="0.55" stroke-linecap="round" fill="none"/>
    </g>
  </g>`);
  const flowerY = columnTopY - 2;
  html.push(`<g style="${aEmerge(STEM_X, flowerY, columnDoneAt + 0.25, EMERGE * 1.2, "leaf-emerge")}">
    <g transform="translate(${STEM_X} ${flowerY})" filter="${sunFilter("cereus", 5)}">${cereusFlower(0, 0, 1)}</g>
  </g>`);
  return html.join("");
}

// Per-species growth builders. Species not in this map render their
// target stage statically.
const GROWTH_BUILDERS = {
  tulip: tulipGrowth,
  daisy: daisyGrowth,
  sunflower: sunflowerGrowth,
  hydrangea: hydrangeaGrowth,
  azalea: azaleaGrowth,
  lily: lilyGrowth,
  amaranthus: amaranthusGrowth,
  cherry: cherryGrowth,
  wisteria: wisteriaGrowth,
  lotus: lotusGrowth,
  iris: irisGrowth,
  bird: birdGrowth,
  bamboo: bambooGrowth,
  jacaranda: jacarandaGrowth,
  dragon: dragonGrowth,
  cereus: cereusGrowth,
};

export function plantSvg(flower, stageIdx) {
  const builder = GROWTH_BUILDERS[flower];
  const body = builder ? builder(stageIdx) : stageContent(flower, stageIdx);
  // Plant-level sway: a slow gentle rotation from the soil base so the
  // whole plant moves together (stem + bud + leaves stay connected).
  // Individual leaves + petals carry their own additional swayWrap on
  // top, which composes hierarchically via SMIL animateTransform.
  const swayed = swayWrap(body, {
    centerX: STEM_X, centerY: SOIL_Y, wind: 1.0, gust: 0.6, dur: 8,
  });
  return `
    <svg class="fs-plant" viewBox="0 0 ${VIEW_W} ${VIEW_H}" xmlns="http://www.w3.org/2000/svg"
         role="img" aria-label="${flower} — stage ${stageIdx}">
      ${defs(flower, stageIdx)}
      ${ground()}
      ${swayed}
    </svg>
  `;
}

function renderGrid() {
  const grid = document.getElementById("fs-grid");
  if (!grid) return;
  resetSway();
  const cells = [];
  cells.push(`<div class="fs-cell fs-corner">species ↓ &nbsp; stages →</div>`);
  for (const s of STAGES) {
    const meta = STAGE_META[s];
    cells.push(`
      <div class="fs-cell fs-stage-head">
        <span class="stage-key">stage ${s}</span>
        <span class="stage-name">${meta.name}</span>
        <span class="stage-plant">${meta.plant}</span>
      </div>
    `);
  }
  for (const flower of FLOWERS) {
    cells.push(`<div class="fs-cell fs-row-label">${flower}</div>`);
    for (const s of STAGES) {
      const hasGrowth = GROWTH_BUILDERS[flower] && s > 1;
      const playBtn = hasGrowth
        ? `<button class="fs-play" type="button" aria-label="play ${flower} stage ${s}"></button>`
        : "";
      cells.push(`<div class="fs-cell" data-flower="${flower}" data-stage="${s}">${plantSvg(flower, s)}${playBtn}</div>`);
    }
  }
  grid.innerHTML = cells.join("");
  // Pause every cell's growth animations on initial render so the user
  // can play them one at a time. We schedule the pause across two
  // animation frames + a setTimeout fallback because CSS animations
  // declared via inline style="animation:..." aren't always discovered
  // by getAnimations() until the browser has flushed style/layout for
  // the freshly-inserted nodes.
  const pauseTwice = () => {
    pauseAllPlantCells();
    requestAnimationFrame(pauseAllPlantCells);
  };
  requestAnimationFrame(() => requestAnimationFrame(pauseTwice));
  setTimeout(pauseAllPlantCells, 80);
  if (!grid.dataset.playWired) {
    grid.addEventListener("click", (e) => {
      const btn = e.target.closest(".fs-play");
      if (!btn) return;
      const cell = btn.closest(".fs-cell");
      if (cell) playPlantCell(cell);
    });
    grid.dataset.playWired = "1";
  }
}

// Collect every CSS keyframe animation on descendants of `cell`. We
// filter out CSSTransition objects (which getAnimations() also returns)
// so we don't accidentally reset/replay UI transitions like the play
// button's opacity fade alongside the plant growth choreography.
function cellAnimations(cell) {
  const list = [];
  cell.querySelectorAll("*").forEach((el) => {
    el.getAnimations({ subtree: false }).forEach((a) => {
      if (a instanceof CSSAnimation) list.push(a);
    });
  });
  return list;
}

function pauseAllPlantCells() {
  document.querySelectorAll(".fs-cell[data-flower]").forEach((cell) => {
    cellAnimations(cell).forEach((a) => {
      try { a.pause(); a.currentTime = 0; } catch (e) {}
    });
  });
}

function playPlantCell(cell) {
  // Stop any currently-playing cell.
  document.querySelectorAll(".fs-cell.is-playing").forEach((c) => {
    if (c !== cell) c.classList.remove("is-playing");
  });
  cell.classList.add("is-playing");
  const anims = cellAnimations(cell);
  const finishedPromises = [];
  anims.forEach((a) => {
    try { a.currentTime = 0; a.play(); } catch (e) {}
    finishedPromises.push(a.finished.catch(() => {}));
  });
  if (finishedPromises.length === 0) {
    cell.classList.remove("is-playing");
    return;
  }
  Promise.all(finishedPromises).then(() => {
    if (cell.classList.contains("is-playing")) cell.classList.remove("is-playing");
  });
}

function wireThemeButtons() {
  const btns = document.querySelectorAll("[data-theme-btn]");
  btns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.themeBtn;
      document.documentElement.setAttribute("data-theme", theme);
      btns.forEach((b) => b.classList.toggle("is-active", b === btn));
    });
  });
}

renderGrid();
wireThemeButtons();
