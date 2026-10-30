// garden-stem.js — owner dashboard "your garden" visual.
//
// Layout:
//   ┌──────────────────────┐
//   │ your garden / title  │  header
//   ├──────────────────────┤
//   │       🌱             │  sky — canonical grassroots sprout
//   │   (sprout svg)       │       (fixed compact size, base on soil)
//   ├──────────────────────┤  soil line
//   │                      │
//   │   (roots svg)        │  earth — flexes to fill panel height.
//   │   ⚇ ⚇ ⚇             │   Roots are simulated as if suspended in
//   │                      │   water: each node has a "home" position
//   │                      │   it drifts around with noise; the branch
//   │                      │   from the seedling anchor to the node is
//   │                      │   a single bezier whose control points
//   │                      │   lag behind the node's velocity, so the
//   │                      │   curve emerges from motion. Users can
//   │                      │   click+drag any node to place it where
//   │                      │   they want; a quick click navigates to
//   │                      │   the listing.
//   ├──────────────────────┤
//   │ empty-state / count  │  footer
//   └──────────────────────┘
//
// The sprout group still mirrors /home/assets/grassroots-icon-syne.svg
// and uses the spring-physics loop in wireSproutPhysics for cursor
// interaction. The root system runs its own physics loop —
// wireRootPhysics — independent of the sprout.

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Roots SVG viewBox.
const ROOTS_VB = { w: 200, h: 240 };
// Anchor point — where every branch starts (the seedling base, at the
// top centre of the roots canvas, flush with the soil line).
const ANCHOR = { x: ROOTS_VB.w / 2, y: 0 };
// Position clamp — keeps the node center inside (or just past) the
// canvas. The halo can extend slightly past the viewBox edge because
// the SVG is rendered with overflow="visible" below; in contexts where
// the parent .gs__earth has overflow:hidden, that parent does the
// final clipping. Tight inset gives users a generous drag area without
// nodes being able to escape into adjacent layout.
const BOUNDS = { minX: 4, maxX: ROOTS_VB.w - 4, minY: 4, maxY: ROOTS_VB.h - 4 };

/**
 * @param {HTMLElement} container - target host (panel content area).
 * @param {{ roots?: Array<{
 *   bidId: string, listingId: string, listingTitle: string,
 *   consultantName: string, amountCents: number, releasedAt: string,
 * }> }} [opts]
 */
export function mountGardenStem(container, { roots = [], interactive = true, navigateOnClick = true } = {}) {
  if (!container) return;
  container.innerHTML = `
    <div class="gs" data-roots="${roots.length}">
      <div class="gs__header">
        <p class="gs__eyebrow">Your garden</p>
        <p class="gs__title">Grow your Grassroots.</p>
      </div>
      <div class="gs__plot">
        <div class="gs__sky">${sproutSvg()}</div>
        ${soilLineSvg()}
        <div class="gs__earth">${rootsSvg(roots)}</div>
        ${roots.length ? hoverCardMarkup() : ""}
      </div>
      <div class="gs__copy">
        ${
          roots.length === 0
            ? `<p class="gs__empty">Complete an engagement to grow your first root.</p>`
            : `<p class="gs__count">${roots.length} root${roots.length === 1 ? "" : "s"} grown.</p>`
        }
      </div>
    </div>
  `;

  if (roots.length) {
    wireRootPhysics(container, roots, { interactive, navigateOnClick });
    wireHoverCard(container, roots);
  }
  wireSproutPhysics(container);
}

/* Sprout — canonical grassroots icon. */
function sproutSvg() {
  return `
    <svg viewBox="0 0 163 275" class="gs__sprout-svg" aria-hidden="true" overflow="visible">
      <g transform="translate(72, 130)" class="gs__sprout-stem-g">
        <path class="gs__sprout-stem"
              d="M19 10.15C19 4.54431 14.7467 0 9.5 0C4.25329 0 0 4.54431 0 10.15C7.91804 91.2467 8.44249 120.691 0 134.85C0 140.456 4.25329 145 9.5 145C14.7467 145 19 140.456 19 134.85C16.2169 71.2734 12.3479 23.288 19 10.15Z"/>
      </g>
      <g transform="translate(0, 65)" class="gs__sprout-leaf gs__sprout-leaf--left">
        <path d="M84 87C21 71.5333 -6.5625 42.5333 1.3125 0C56.4375 3.86667 84 32.8667 84 87Z"/>
      </g>
      <g transform="translate(82, 0)" class="gs__sprout-leaf gs__sprout-leaf--right">
        <path d="M0 147C48.6 116.053 75.6 67.0526 81 0C27 5.1579 0 54.1579 0 147Z"/>
      </g>
    </svg>
  `;
}

/* Roots SVG — one group per completed engagement, each containing a
   branch path, a halo ring (for the emerge effect), and the
   clickable node circle. Positions and the branch `d` attribute are
   driven each frame by the JS physics loop, so the markup we emit
   here is just initial state. */
function rootsSvg(roots) {
  const homes = rootHomes(roots.length);
  const groups = homes
    .map((home, i) => {
      const root = roots[i];
      // Per-root brown derived deterministically from bidId so the
      // colour persists across reloads without needing storage —
      // same bid always hashes to the same shade.
      const color = rootColorFor(root.bidId);
      return `
        <g class="gs__root" data-bid="${escapeAttr(root.bidId)}" data-listing="${escapeAttr(root.listingId)}" data-idx="${i}" style="--gs-root: ${color}">
          <path d="${initialBranchPath(home)}" class="gs__root-branch" pathLength="1"/>
          <circle cx="${home.x.toFixed(1)}" cy="${home.y.toFixed(1)}" r="11" class="gs__root-halo"/>
          <circle cx="${home.x.toFixed(1)}" cy="${home.y.toFixed(1)}" r="4.5" class="gs__root-node"/>
        </g>`;
    })
    .join("");

  return `
    <svg viewBox="0 0 ${ROOTS_VB.w} ${ROOTS_VB.h}" class="gs__roots-svg" aria-hidden="true"
         preserveAspectRatio="xMidYMin meet" overflow="visible">
      ${soilDots()}
      ${groups}
    </svg>
  `;
}

/* Initial home positions — a wide fan across the lower hemisphere,
   distributed with per-index jitter so no two are templated. Every
   home stays inside BOUNDS so all nodes are visible on mount. */
function rootHomes(n) {
  if (n === 0) return [];
  const homes = [];
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    // 30° → 150° (compass), with per-index jitter.
    const baseAngle = 30 + 120 * t;
    const angleJitter = Math.sin(i * 2.71 + 1.1) * 8;
    const angle = ((baseAngle + angleJitter) * Math.PI) / 180;
    // Vary radius for a fuller, less-uniform fan.
    const edgeBias = Math.abs(t - 0.5) * 38;
    const radiusJitter = Math.sin(i * 3.14 + 0.4) * 32;
    const radius = Math.max(70, 100 + edgeBias + radiusJitter);
    let x = ANCHOR.x + Math.cos(angle) * radius;
    let y = ANCHOR.y + Math.sin(angle) * radius;
    // Hard clamp into bounds so everything fits inside the canvas.
    x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, x));
    y = Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, y));
    homes.push({ x, y });
  }
  return homes;
}

/* Initial `d` for a branch at rest — a soft bezier whose control
   points push outward from the line between anchor and node so the
   path reads as a gentle curve, not a straight line. */
function initialBranchPath(end) {
  const dx = end.x - ANCHOR.x;
  const dy = end.y - ANCHOR.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return `M ${ANCHOR.x} ${ANCHOR.y}`;
  const nx = -dy / len;
  const ny = dx / len;
  const bow = len * 0.18;
  const c1x = ANCHOR.x + dx * 0.33 + nx * bow * 0.7;
  const c1y = ANCHOR.y + dy * 0.33 + ny * bow * 0.7;
  const c2x = ANCHOR.x + dx * 0.66 + nx * bow * 1.0;
  const c2y = ANCHOR.y + dy * 0.66 + ny * bow * 1.0;
  return `M ${ANCHOR.x} ${ANCHOR.y} C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${end.x.toFixed(1)} ${end.y.toFixed(1)}`;
}

/* ─── Root physics + drag ──────────────────────────────────────────
   Each node lives in a `nodeStates[i]` object carrying its current
   position, velocity, idle-drift phase, drag flag, and a "home" it
   gravitates toward when idle. The physics loop:
     1. For idle nodes: a tiny noise-driven target near the home
        pulls the node via spring + damping → gentle floating.
     2. For dragged nodes: the position follows the pointer directly.
     3. The node circle, halo, and branch path are updated each
        frame from the new position. The branch curve's control
        points lag behind the node's velocity, so motion creates
        natural curves — fast drags swoop, slow drifts ripple.
   Clamped to BOUNDS so a node can never escape the canvas. */
function wireRootPhysics(container, roots, { interactive = true, navigateOnClick = true } = {}) {
  const svg = container.querySelector(".gs__roots-svg");
  if (!svg) return;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  const groups = [...container.querySelectorAll(".gs__root")];
  if (!groups.length) return;
  const homes = rootHomes(roots.length);

  const nodeStates = groups.map((groupEl, i) => {
    const home = homes[i] || { x: ANCHOR.x, y: 60 };
    // Per-node bow factor — signed multiplier on the resting curve
    // bow so each root settles into its own direction rather than
    // every branch bowing the same way. Index-seeded so renders are
    // stable; combined with sin + cos so adjacent indices don't
    // produce sympathetic curves. Range ~[-1.3, +1.3].
    const bowFactor =
      Math.sin(i * 2.71 + 0.6) * 0.9 + Math.cos(i * 1.31 + 1.7) * 0.5;
    return {
      groupEl,
      branchEl: groupEl.querySelector(".gs__root-branch"),
      haloEl: groupEl.querySelector(".gs__root-halo"),
      nodeEl: groupEl.querySelector(".gs__root-node"),
      home: { x: home.x, y: home.y },
      pos: { x: home.x, y: home.y },
      vel: { x: 0, y: 0 },
      // Each node gets its own noise phase so the underwater drift
      // doesn't sync across the whole panel.
      phaseX: i * 1.37,
      phaseY: i * 2.11 + 0.7,
      bowFactor,
      dragging: false,
    };
  });

  // Click-vs-drag bookkeeping. We track the pointer-down position
  // and only navigate to the listing if the pointer barely moved.
  let activeDrag = null;

  function onPointerDown(e, idx) {
    e.preventDefault();
    e.stopPropagation();
    const node = nodeStates[idx];
    const pt = clientToViewBox(svg, e.clientX, e.clientY);
    activeDrag = {
      idx,
      startClient: { x: e.clientX, y: e.clientY },
      // Offset so the node doesn't jump under the cursor on grab.
      offset: { x: node.pos.x - pt.x, y: node.pos.y - pt.y },
      moved: false,
    };
    node.dragging = true;
    node.groupEl.classList.add("is-dragging");
    // Hide the hover card while dragging — it'd just chase the node.
    const card = container.querySelector(".gs__hover");
    if (card) card.classList.remove("is-visible");
    try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
  }

  function onPointerMove(e) {
    if (!activeDrag) return;
    const node = nodeStates[activeDrag.idx];
    const dxClient = e.clientX - activeDrag.startClient.x;
    const dyClient = e.clientY - activeDrag.startClient.y;
    if (Math.hypot(dxClient, dyClient) > 3) activeDrag.moved = true;
    const pt = clientToViewBox(svg, e.clientX, e.clientY);
    node.pos.x = clampX(pt.x + activeDrag.offset.x);
    node.pos.y = clampY(pt.y + activeDrag.offset.y);
  }

  function onPointerUp(e) {
    if (!activeDrag) return;
    const idx = activeDrag.idx;
    const node = nodeStates[idx];
    node.dragging = false;
    node.groupEl.classList.remove("is-dragging");
    // If the pointer barely moved, treat it as a click → navigate
    // (when enabled). Hero contexts pass navigateOnClick:false so a
    // brief click just dismisses the drag without leaving the page.
    if (!activeDrag.moved) {
      if (navigateOnClick) {
        const listingId = node.groupEl.dataset.listing;
        activeDrag = null;
        if (listingId) {
          window.location.href = `/listing.html?id=${listingId}`;
          return;
        }
      } else {
        activeDrag = null;
        return;
      }
    } else {
      // Adopt the drop point as the new home so the node drifts
      // around where the user placed it.
      node.home.x = node.pos.x;
      node.home.y = node.pos.y;
    }
    activeDrag = null;
  }

  if (interactive) {
    groups.forEach((groupEl, i) => {
      const nodeEl = groupEl.querySelector(".gs__root-node");
      nodeEl.style.cursor = "grab";
      nodeEl.addEventListener("pointerdown", (e) => onPointerDown(e, i));
    });
    // Move + up are bound on the SVG (not document) so we keep events
    // within the panel surface. setPointerCapture above routes events
    // back to the captured element until release.
    svg.addEventListener("pointermove", onPointerMove);
    svg.addEventListener("pointerup", onPointerUp);
    svg.addEventListener("pointercancel", onPointerUp);
  } else {
    // Non-interactive contexts (e.g. the marketing-page hero) still
    // want the physics drift + hover card, but no click → navigate
    // and no drag. Leave the pointerdown wiring off and reset the
    // grab cursor so hover doesn't promise interaction.
    container.querySelectorAll(".gs__root").forEach((el) => {
      el.style.cursor = "default";
    });
    container.querySelectorAll(".gs__root-node").forEach((el) => {
      el.style.cursor = "default";
    });
  }

  if (reducedMotion) {
    // Reduced-motion: render the resting state and skip the loop.
    nodeStates.forEach((n) => updateRender(n, /*paint*/ true));
    return;
  }

  let prevT = performance.now();
  function frame(now) {
    if (!document.body.contains(svg)) return; // host unmounted
    const dtMs = now - prevT;
    prevT = now;
    const t = now * 0.001;

    nodeStates.forEach((node) => {
      const prevX = node.pos.x;
      const prevY = node.pos.y;

      if (!node.dragging) {
        // Idle drift — a slow noise target near the home position
        // plus a soft spring that pulls the node toward that target.
        // Underwater feel: never stops moving, never lurches.
        const driftX = Math.sin(t * 0.45 + node.phaseX) * 7 + Math.cos(t * 0.27 + node.phaseY) * 4;
        const driftY = Math.cos(t * 0.42 + node.phaseY) * 5 + Math.sin(t * 0.31 + node.phaseX) * 3;
        const targetX = node.home.x + driftX;
        const targetY = node.home.y + driftY;
        const fx = (targetX - node.pos.x) * 0.025;
        const fy = (targetY - node.pos.y) * 0.025;
        node.vel.x = (node.vel.x + fx) * 0.92;
        node.vel.y = (node.vel.y + fy) * 0.92;
        node.pos.x += node.vel.x;
        node.pos.y += node.vel.y;
      }

      // Always clamp position to keep nodes on-canvas.
      node.pos.x = clampX(node.pos.x);
      node.pos.y = clampY(node.pos.y);

      // Velocity derived from the actual delta so dragged nodes also
      // get a meaningful vel for the curve generation.
      node.vel.x = node.pos.x - prevX;
      node.vel.y = node.pos.y - prevY;

      updateRender(node);
    });

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

/* Push the current pos to the DOM: node circle, halo circle, and
   branch path. The branch is a single cubic bezier from anchor to
   node; control points sit at 1/3 and 2/3 along the line with a
   perpendicular offset whose magnitude is `base bow + lateral
   velocity * lag`. Result: curves "swim" behind motion. */
function updateRender(node) {
  const { pos, vel, nodeEl, haloEl, branchEl, bowFactor } = node;
  nodeEl.setAttribute("cx", pos.x.toFixed(2));
  nodeEl.setAttribute("cy", pos.y.toFixed(2));
  if (haloEl) {
    haloEl.setAttribute("cx", pos.x.toFixed(2));
    haloEl.setAttribute("cy", pos.y.toFixed(2));
  }
  branchEl.setAttribute("d", branchPath(pos, vel, bowFactor));
}

function branchPath(end, vel, bowFactor = 1) {
  const dx = end.x - ANCHOR.x;
  const dy = end.y - ANCHOR.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return `M ${ANCHOR.x} ${ANCHOR.y}`;
  // Perpendicular unit vector (90° CCW from direction).
  const nx = -dy / len;
  const ny = dx / len;
  // Project the node's velocity onto the perpendicular axis — the
  // lateral speed that drags the branch sideways. Negative coefficient
  // so the curve trails behind motion.
  const lateral = vel.x * nx + vel.y * ny;
  // baseBow direction comes from the per-node bowFactor (signed) so
  // each root settles into its own resting curve direction. The
  // motion contribution stays velocity-driven so dragging still
  // pulls the curve naturally.
  const baseBow = len * 0.12 * bowFactor;
  const motionBow = lateral * -6;
  const bow = baseBow + motionBow;
  // Control points along the line, offset perpendicular by `bow`.
  // C1 sits closer to anchor, C2 closer to the node, with C2
  // taking a slightly larger offset so the curve trails more near
  // the tip — the way a thin underwater filament would.
  const c1x = ANCHOR.x + dx * 0.34 + nx * bow * 0.7;
  const c1y = ANCHOR.y + dy * 0.34 + ny * bow * 0.7;
  const c2x = ANCHOR.x + dx * 0.66 + nx * bow * 1.1;
  const c2y = ANCHOR.y + dy * 0.66 + ny * bow * 1.1;
  return `M ${ANCHOR.x} ${ANCHOR.y} C ${c1x.toFixed(2)} ${c1y.toFixed(2)}, ${c2x.toFixed(2)} ${c2y.toFixed(2)}, ${end.x.toFixed(2)} ${end.y.toFixed(2)}`;
}

function clampX(x) {
  return Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, x));
}
function clampY(y) {
  return Math.max(BOUNDS.minY, Math.min(BOUNDS.maxY, y));
}

/* Convert a clientX/clientY to viewBox coordinates of the given SVG.
   Necessary because the SVG scales to fit its container, so the
   relationship between pixel and viewBox units depends on layout. */
function clientToViewBox(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const ctm = svg.getScreenCTM();
  if (!ctm) return { x: clientX, y: clientY };
  return pt.matrixTransform(ctm.inverse());
}

/* Hover-card overlay — re-used across all nodes; populated and
   shown by wireHoverCard() on mouseenter / hidden on mouseleave. */
function hoverCardMarkup() {
  return `
    <div class="gs__hover" id="gs-hover" role="tooltip" aria-hidden="true">
      <p class="gs__hover-title" data-hover="title"></p>
      <dl class="gs__hover-meta">
        <div class="gs__hover-row">
          <dt>Consultant</dt>
          <dd data-hover="consultant"></dd>
        </div>
        <div class="gs__hover-row">
          <dt>Released</dt>
          <dd data-hover="date"></dd>
        </div>
        <div class="gs__hover-row">
          <dt>Paid</dt>
          <dd data-hover="amount"></dd>
        </div>
      </dl>
    </div>
  `;
}

function wireHoverCard(container, roots) {
  const card = container.querySelector("#gs-hover");
  const plot = container.querySelector(".gs__plot");
  if (!card || !plot) return;
  const byBid = Object.fromEntries(roots.map((r) => [r.bidId, r]));

  const showCard = (rootEl) => {
    // Skip while dragging — the card would chase the node and
    // obstruct the gesture.
    if (rootEl.classList.contains("is-dragging")) return;
    const bid = rootEl.dataset.bid;
    const root = byBid[bid];
    if (!root) return;
    card.querySelector('[data-hover="title"]').textContent = root.listingTitle;
    card.querySelector('[data-hover="consultant"]').textContent = root.consultantName;
    card.querySelector('[data-hover="date"]').textContent = formatDate(root.releasedAt);
    card.querySelector('[data-hover="amount"]').textContent = USD.format((root.amountCents || 0) / 100);

    const circle = rootEl.querySelector(".gs__root-node");
    if (!circle) return;
    const nodeRect = circle.getBoundingClientRect();
    const plotRect = plot.getBoundingClientRect();
    // Snap visibility on so we can measure the card's size.
    card.classList.add("is-visible");
    card.setAttribute("aria-hidden", "false");
    const cardRect = card.getBoundingClientRect();
    const isLeftSide = nodeRect.left + nodeRect.width / 2 < plotRect.left + plotRect.width / 2;
    const margin = 8;
    let left = isLeftSide
      ? nodeRect.right - plotRect.left + margin
      : nodeRect.left - plotRect.left - cardRect.width - margin;
    if (left < margin) left = nodeRect.right - plotRect.left + margin;
    if (left + cardRect.width > plotRect.width - margin) {
      left = nodeRect.left - plotRect.left - cardRect.width - margin;
    }
    // Narrow plots (phones): neither side fits a center node, so keep the
    // card inside the plot even if it covers the node.
    left = Math.max(margin, Math.min(plotRect.width - cardRect.width - margin, left));
    let top = nodeRect.top - plotRect.top + nodeRect.height / 2 - cardRect.height / 2;
    top = Math.max(margin, Math.min(plotRect.height - cardRect.height - margin, top));
    card.style.left = `${left}px`;
    card.style.top = `${top}px`;
  };

  const hideCard = () => {
    card.classList.remove("is-visible");
    card.setAttribute("aria-hidden", "true");
  };

  container.querySelectorAll(".gs__root").forEach((rootEl) => {
    rootEl.addEventListener("mouseenter", () => showCard(rootEl));
    rootEl.addEventListener("focus", () => showCard(rootEl), true);
    rootEl.addEventListener("mouseleave", hideCard);
    rootEl.addEventListener("blur", hideCard, true);
    // Touch has no hover, and Safari's emulated mouseenter misses the
    // drifting nodes. A tap shows the card instead.
    rootEl.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "mouse") showCard(rootEl);
    });
  });
  // ...and a tap anywhere else hides it.
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" && !e.target.closest?.(".gs__root")) hideCard();
  });
}

/* Sparse dirt specks — static positions so the panel paints the same
   every load. ViewBox 200×240. */
const SOIL_DOTS = [
  [22, 14, 0.9], [54, 24, 1.1], [86, 18, 0.7], [118, 28, 1.0],
  [148, 14, 0.8], [180, 26, 1.1], [200, 20, 0.8],
  [40, 48, 0.7], [76, 60, 1.0], [108, 52, 0.9], [144, 62, 0.8],
  [176, 54, 1.0], [206, 66, 0.7],
  [28, 92, 0.7], [96, 96, 0.9], [156, 90, 0.8], [196, 100, 0.6],
  [44, 132, 0.7], [128, 136, 0.9], [180, 142, 0.8],
  [60, 180, 0.6], [108, 188, 0.8], [164, 196, 0.7],
  [32, 218, 0.6], [144, 224, 0.7],
];

function soilDots() {
  return SOIL_DOTS.map(
    ([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" class="gs__soil-dot"/>`,
  ).join("");
}

/* Deterministic brown per root — hashes the bidId to a stable HSL
   value in the "earthy brown" range. Same bid always hashes to the
   same shade, so the colour persists across reloads / sessions
   without needing to store it in the database. Range:
     hue 18–40 (warm orange-brown spectrum)
     sat 26–54%
     light 28–58% (dark earthy to medium-light brown)
   Hue / saturation / lightness use independently prefixed hashes so
   adjacent bidIds (e.g. fake-bid-0, fake-bid-1) decorrelate cleanly
   instead of producing near-identical shades. */
function rootColorFor(bidId) {
  const s = String(bidId || "");
  const hue = 18 + (hashStr("h:" + s) % 22);
  const sat = 26 + (hashStr("s:" + s) % 28);
  const light = 28 + (hashStr("l:" + s) % 30);
  return `hsl(${hue} ${sat}% ${light}%)`;
}

/* FNV-1a + Murmur3 finalizer — strong avalanche so adjacent bidIds
   (e.g. "…-0" vs "…-1") produce uncorrelated hashes. djb2 was
   insufficient: a single-character delta only flipped the LSB of the
   final hash, so root colours all came out within 1% of each other. */
function hashStr(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/* Soil-line SVG — wavy horizon path replacing the old flat 1.5px rule.
   viewBox is 100×6 stretched non-uniformly to fill the panel width
   (preserveAspectRatio="none"), so the bumps in y land at predictable
   pixel heights regardless of panel width. vector-effect on the stroke
   keeps the line a constant ~1.4px after stretching. The path's
   bezier control points are hand-tuned for an irregular wave — bump
   spacing and amplitude vary so the horizon doesn't read as a
   periodic curve. */
function soilLineSvg() {
  // Quadratic-bezier wave with irregular spacing + amplitude. Each Q
  // control point is pushed near the band edges (y≈0.4 or y≈5) so the
  // curve actually visits a noticeable peak between waypoints (~1.2–
  // 1.6px swing once rendered). The x spacing varies (8–14 viewBox
  // units between waypoints) so the bumps don't read as periodic.
  const d =
    "M 0 3 " +
    "Q 7 0.6, 14 3 " +
    "Q 22 5, 30 2.8 " +
    "Q 38 0.4, 46 3.2 " +
    "Q 54 5.4, 62 3 " +
    "Q 70 0.8, 78 3.4 " +
    "Q 86 5, 94 2.8 " +
    "Q 98 2, 100 3";
  return `
    <svg class="gs__soil-line" viewBox="0 0 100 6" preserveAspectRatio="none" aria-hidden="true">
      <path class="gs__soil-horizon" d="${d}"/>
    </svg>
  `;
}

function escapeAttr(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/* ─── Sprout physics (unchanged behaviour) ─────────────────────────
   Per-piece spring/damper so the stem and each leaf react to the
   cursor independently. Subtle dial — sprout breathes with the
   cursor rather than chasing it. */
const PHYS = {
  STIFFNESS: 0.045,
  DAMPING: 0.82,
  LEAF_REACH_PX: 180,
  STEM_REACH_PX: 280,
  CURSOR_FADE_MS: 1400,
  MAX_SWAY: 1.4,
  MAX_STEM: 1.6,
  MAX_LEAF: 8,
};

function wireSproutPhysics(container) {
  const sproutSvg = container.querySelector(".gs__sprout-svg");
  if (!sproutSvg) return;
  const reducedMotion =
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reducedMotion) return;

  const stemG = container.querySelector(".gs__sprout-stem-g");
  const leafL = container.querySelector(".gs__sprout-leaf--left");
  const leafR = container.querySelector(".gs__sprout-leaf--right");
  if (!stemG || !leafL || !leafR) return;

  const springs = {
    sway: { angle: 0, vel: 0 },
    stem: { angle: 0, vel: 0 },
    leafL: { angle: 0, vel: 0 },
    leafR: { angle: 0, vel: 0 },
  };

  let mouseX = -99999;
  let mouseY = -99999;
  let lastMoveT = 0;

  function step(state, target) {
    const force = (target - state.angle) * PHYS.STIFFNESS;
    state.vel = (state.vel + force) * PHYS.DAMPING;
    state.angle += state.vel;
  }

  function pieceInfluence(el, reachPx) {
    const rect = el.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const dx = mouseX - cx;
    const dy = mouseY - cy;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const magnitude = Math.max(0, 1 - dist / reachPx);
    const direction = Math.max(-1, Math.min(1, dx / (reachPx * 0.5)));
    return direction * magnitude;
  }

  const onMove = (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
    lastMoveT = performance.now();
  };
  const onLeave = () => {
    mouseX = -99999;
    mouseY = -99999;
  };

  const panel = container.querySelector(".gs") || container;
  panel.addEventListener("pointermove", onMove);
  panel.addEventListener("pointerleave", onLeave);

  function frame(now) {
    if (!document.body.contains(sproutSvg)) {
      panel.removeEventListener("pointermove", onMove);
      panel.removeEventListener("pointerleave", onLeave);
      return;
    }

    const t = now * 0.001;
    const sinceMove = lastMoveT ? now - lastMoveT : Infinity;
    const cursorWeight = Math.max(0, 1 - sinceMove / PHYS.CURSOR_FADE_MS);

    const swayInf = pieceInfluence(sproutSvg, PHYS.STEM_REACH_PX);
    const stemInf = pieceInfluence(stemG, PHYS.STEM_REACH_PX);
    const leafLInf = pieceInfluence(leafL, PHYS.LEAF_REACH_PX);
    const leafRInf = pieceInfluence(leafR, PHYS.LEAF_REACH_PX);

    const idleSway = Math.sin(t * 0.45) * 0.55;
    const idleStem = Math.sin(t * 0.7) * 0.45;
    const idleLeafL = Math.sin(t * 0.9 + 0.6) * 1.8;
    const idleLeafR = Math.cos(t * 0.85 + 0.2) * 1.8;

    const blend = (cursorInf, idle) =>
      cursorInf * cursorWeight + idle * (1 - cursorWeight) + idle * 0.15;

    const swayTarget = blend(swayInf, idleSway) * PHYS.MAX_SWAY;
    const stemTarget = blend(stemInf, idleStem) * PHYS.MAX_STEM;
    const leafLTarget = blend(leafLInf, idleLeafL / PHYS.MAX_LEAF) * PHYS.MAX_LEAF;
    const leafRTarget = blend(-leafRInf, idleLeafR / PHYS.MAX_LEAF) * PHYS.MAX_LEAF;

    step(springs.sway, swayTarget);
    step(springs.stem, stemTarget);
    step(springs.leafL, leafLTarget);
    step(springs.leafR, leafRTarget);

    sproutSvg.style.transform = `rotate(${springs.sway.angle.toFixed(3)}deg)`;
    stemG.setAttribute(
      "transform",
      `translate(72, 130) rotate(${springs.stem.angle.toFixed(3)} 9.5 145)`,
    );
    leafL.setAttribute(
      "transform",
      `translate(0, 65) rotate(${springs.leafL.angle.toFixed(3)} 84 87)`,
    );
    leafR.setAttribute(
      "transform",
      `translate(82, 0) rotate(${springs.leafR.angle.toFixed(3)} 0 147)`,
    );

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
