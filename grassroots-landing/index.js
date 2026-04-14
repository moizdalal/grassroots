const ROTATING_WORDS = [
  { text: "strategy", color: "#9fc7ff", icon: "✧" },
  { text: "finance", color: "#e6c39a", icon: "$" },
  { text: "development", color: "#8fd7b4", icon: "</>" },
  { text: "marketing", color: "#ffb38a", icon: "↗" },
];

const NIGHT_SCENE = {
  moonXNorm: 0.9,
  moonYNorm: 0.18,
  moonGlow: 0.2,
};

/** Matches default sprout fill in assets/grassroots-icon-syne.svg (#6DBF8A) */
const LOGO_MARK_RGB = { r: 109, g: 191, b: 138 };

function waitForMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function typeSentence(el, text, delay = 85) {
  for (const ch of text) {
    await waitForMs(delay);
    el.textContent += ch;
  }
}

async function deleteSentence(el, delay = 52) {
  while (el.textContent.length > 0) {
    await waitForMs(delay);
    el.textContent = el.textContent.slice(0, -1);
  }
}

async function morphIcon(iconEl, icon, color) {
  if (!iconEl) return;
  iconEl.classList.add("is-morphing");
  await waitForMs(110);
  iconEl.style.color = color;
  iconEl.textContent = icon;
  iconEl.classList.remove("is-morphing");
}

async function initWordCycle() {
  const el = document.getElementById("word-cycle-target");
  const iconEl = document.getElementById("word-cycle-icon");
  if (!el) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) {
    el.textContent = ROTATING_WORDS[0].text;
    el.style.color = ROTATING_WORDS[0].color;
    if (iconEl) {
      iconEl.style.color = ROTATING_WORDS[0].color;
      iconEl.textContent = ROTATING_WORDS[0].icon;
    }
    return;
  }

  let idx = 0;
  el.textContent = "";

  while (true) {
    const word = ROTATING_WORDS[idx];
    el.style.color = word.color;
    if (iconEl) {
      await morphIcon(iconEl, word.icon, word.color);
    }
    await typeSentence(el, word.text);
    await waitForMs(1300);
    await deleteSentence(el);
    await waitForMs(360);
    idx = (idx + 1) % ROTATING_WORDS.length;
  }
}

function initStarfield() {
  const canvas = document.getElementById("starfield");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let width = 0;
  let height = 0;
  const cursor = { x: -9999, y: -9999 };

  let stars = [];
  const STAR_COUNT_DESKTOP = 170;
  const STAR_COUNT_MOBILE = 95;
  const CURSOR_EFFECT_RADIUS = 520;

  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function createStars() {
    const count = width < 700 ? STAR_COUNT_MOBILE : STAR_COUNT_DESKTOP;
    stars = Array.from({ length: count }, () => ({
      baseX: Math.random() * width,
      baseY: Math.random() * height,
      r: Math.random() * 1.9 + 0.35,
      twinkleSeed: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.025 + 0.005,
      depth: Math.random() * 0.85 + 0.15,
      swayXSeed: Math.random() * Math.PI * 2,
      swayYSeed: Math.random() * Math.PI * 2,
      swayRange: Math.random() * 8 + 3,
      offsetX: 0,
      offsetY: 0,
      velocityX: 0,
      velocityY: 0,
    }));
  }

  let starfieldRafId = 0;

  function render(nowMs) {
    const t = nowMs * 0.001;
    ctx.clearRect(0, 0, width, height);

    // Moon — upper-right; hover adds outer glow + slow “breath” (scale + halo pulse).
    const moonX = width * 0.9;
    const moonY = height * 0.18;
    const moonR = Math.max(38, Math.min(74, width * 0.052));
    const moonDist = Math.hypot(cursor.x - moonX, cursor.y - moonY);
    const hoverFalloff = moonR * 3.15;
    const moonHover =
      moonDist < hoverFalloff ? Math.max(0, 1 - moonDist / hoverFalloff) : 0;
    const moonShimmer = prefersReduced
      ? moonHover * 0.52
      : moonHover * (0.6 + Math.sin(t * 6.2) * 0.4);
    const breathPhase = prefersReduced ? 1 : 0.82 + 0.18 * Math.sin(t * 1.72);
    const breathScale = prefersReduced ? 1 : 1 + moonHover * 0.038 * Math.sin(t * 2.05);
    const haloScale = prefersReduced ? 1 : breathScale;
    const moonGlow = 0.18 + moonShimmer * 0.18 + moonHover * breathPhase * 0.14;

    NIGHT_SCENE.moonXNorm = moonX / width;
    NIGHT_SCENE.moonYNorm = moonY / height;
    NIGHT_SCENE.moonGlow = moonGlow;

    const cutCx = moonX + moonR * 0.35;
    const cutCy = moonY - moonR * 0.04;
    const cutR = moonR * 0.92;

    // Soft corona behind moon (stronger + breathing while hovered)
    if (moonHover > 0) {
      const haloBoost = prefersReduced ? moonHover * 0.88 : moonHover * breathPhase;
      const rings = [
        { outer: 2.35, inner: 0.92, a: 0.14 },
        { outer: 1.85, inner: 0.88, a: 0.2 },
        { outer: 1.42, inner: 0.85, a: 0.26 },
      ];
      for (const ring of rings) {
        const ro = moonR * ring.outer * haloScale;
        const ri = moonR * ring.inner;
        const g = ctx.createRadialGradient(moonX, moonY, ri, moonX, moonY, ro);
        const peak = ring.a * haloBoost;
        g.addColorStop(0, `rgba(245, 250, 255, ${(peak * 0.45).toFixed(3)})`);
        g.addColorStop(0.35, `rgba(200, 218, 248, ${(peak * 0.55).toFixed(3)})`);
        g.addColorStop(0.65, `rgba(140, 168, 220, ${(peak * 0.35).toFixed(3)})`);
        g.addColorStop(1, "rgba(80, 100, 140, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(moonX, moonY, ro, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    ctx.save();
    ctx.translate(moonX, moonY);
    ctx.scale(breathScale, breathScale);
    ctx.translate(-moonX, -moonY);

    function inLitCrescent(px, py) {
      if (Math.hypot(px - moonX, py - moonY) > moonR * 0.995) return false;
      if (Math.hypot(px - cutCx, py - cutCy) < cutR * 0.985) return false;
      return true;
    }

    function inMoonDisk(px, py) {
      return Math.hypot(px - moonX, py - moonY) <= moonR * 0.998;
    }

    function inNightFace(px, py) {
      return inMoonDisk(px, py) && Math.hypot(px - cutCx, py - cutCy) < cutR * 0.992;
    }

    // Base disc — soft radial lift on sunward side (toward upper-right of disk)
    const limbGx = moonX + moonR * 0.38;
    const limbGy = moonY - moonR * 0.28;
    const baseGrad = ctx.createRadialGradient(limbGx, limbGy, 0, moonX, moonY, moonR * 1.05);
    baseGrad.addColorStop(0, `rgba(252, 254, 255, ${0.98 + moonShimmer * 0.02})`);
    baseGrad.addColorStop(0.45, `rgba(236, 242, 255, ${0.94 + moonShimmer * 0.04})`);
    baseGrad.addColorStop(1, "rgba(214, 222, 238, 0.92)");
    ctx.beginPath();
    ctx.fillStyle = baseGrad;
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.fill();

    // Large maria (flat basins) — cool gray, only on lit crescent
    for (let i = 0; i < 5; i += 1) {
      const ang = 0.55 + i * 1.17 + moonR * 0.002;
      const dist = 0.22 + (i % 3) * 0.14;
      const cx = moonX + Math.cos(ang) * moonR * dist;
      const cy = moonY + Math.sin(ang) * moonR * (dist * 0.88 + 0.06);
      if (!inLitCrescent(cx, cy)) continue;
      const spread = moonR * (0.26 + (i % 4) * 0.05);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, spread);
      g.addColorStop(0, "rgba(120, 132, 162, 0.22)");
      g.addColorStop(0.5, "rgba(160, 172, 198, 0.1)");
      g.addColorStop(1, "rgba(236, 242, 255, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, spread, 0, Math.PI * 2);
      ctx.fill();
    }

    // Medium craters on lit face — bowl + bright rim toward light
    for (let i = 0; i < 16; i += 1) {
      const a = (i * 2.5132741228718345 + moonR * 0.017) % (Math.PI * 2);
      const dist = 0.2 + (i % 6) * 0.11;
      const cx = moonX + Math.cos(a) * moonR * dist;
      const cy = moonY + Math.sin(a) * moonR * (dist * 0.9 + 0.04);
      if (!inLitCrescent(cx, cy)) continue;
      const rad = moonR * (0.035 + (i % 5) * 0.018);
      const bowl = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad);
      bowl.addColorStop(0, "rgba(95, 105, 132, 0.42)");
      bowl.addColorStop(0.45, "rgba(150, 160, 188, 0.18)");
      bowl.addColorStop(1, "rgba(236, 242, 255, 0)");
      ctx.fillStyle = bowl;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
      const toLight = Math.atan2(limbGy - cy, limbGx - cx);
      ctx.strokeStyle = `rgba(255, 255, 255, ${0.14 + moonShimmer * 0.1})`;
      ctx.lineWidth = Math.max(0.65, rad * 0.11);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.88, toLight - 0.82, toLight + 0.82);
      ctx.stroke();
    }

    // Small bowl craters + pit marks
    for (let i = 0; i < 38; i += 1) {
      const u = ((Math.sin(i * 19.9898 + moonR) * 43758.5453) % 1 + 1) % 1;
      const v = ((Math.sin(i * 47.233 + moonR * 1.3) * 28463.3269) % 1 + 1) % 1;
      const ang = u * Math.PI * 2;
      const radDist = 0.12 + (v * 0.78) ** 0.5 * 0.88;
      const cx = moonX + Math.cos(ang) * moonR * radDist;
      const cy = moonY + Math.sin(ang) * moonR * radDist * 0.93;
      if (!inLitCrescent(cx, cy)) continue;
      const rad = moonR * (0.012 + (i % 4) * 0.009);
      const bowl = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 1.8);
      bowl.addColorStop(0, "rgba(88, 96, 118, 0.38)");
      bowl.addColorStop(0.55, "rgba(160, 168, 190, 0.12)");
      bowl.addColorStop(1, "rgba(236, 242, 255, 0)");
      ctx.fillStyle = bowl;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 1.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // Micro roughness / regolith speckle (lit crescent)
    for (let i = 0; i < 72; i += 1) {
      const r1 = Math.sin(i * 12.9898 + moonR * 0.37) * 43758.5453;
      const u = r1 - Math.floor(r1);
      const r2 = Math.sin(i * 78.233 + moonR * 0.91) * 28463.3269;
      const v = r2 - Math.floor(r2);
      const ang = u * Math.PI * 2;
      const rad = Math.sqrt(v) * moonR * 0.91;
      const px = moonX + Math.cos(ang) * rad;
      const py = moonY + Math.sin(ang) * rad;
      if (!inLitCrescent(px, py)) continue;
      const s = 0.35 + (i % 5) * 0.12;
      const a = 0.07 + (i % 7) * 0.018;
      ctx.fillStyle = `rgba(255, 255, 255, ${a.toFixed(3)})`;
      ctx.fillRect(px, py, s, s);
    }

    // Fine darker grains
    for (let i = 0; i < 48; i += 1) {
      const ang = (i * 1.6180339887 * 7 + moonR * 0.03) % (Math.PI * 2);
      const rd = 0.08 + (i % 11) * 0.075;
      const px = moonX + Math.cos(ang) * moonR * rd;
      const py = moonY + Math.sin(ang) * moonR * rd * 0.94;
      if (!inLitCrescent(px, py)) continue;
      ctx.fillStyle = `rgba(72, 82, 108, ${0.06 + (i % 5) * 0.028})`;
      ctx.fillRect(px - 0.5, py - 0.5, 1.1, 1.1);
    }

    // Night face — base shadow, then subtle craters and maria on dark side
    ctx.beginPath();
    ctx.fillStyle = "rgba(28, 31, 38, 0.92)";
    ctx.arc(cutCx, cutCy, cutR, 0, Math.PI * 2);
    ctx.fill();

    for (let i = 0; i < 12; i += 1) {
      const a = (i * 2.1 + moonR * 0.008) % (Math.PI * 2);
      const dist = 0.52 + (i % 4) * 0.09;
      const cx = moonX + Math.cos(a) * moonR * dist;
      const cy = moonY + Math.sin(a) * moonR * dist * 0.9;
      if (!inNightFace(cx, cy)) continue;
      const spread = moonR * (0.18 + (i % 3) * 0.04);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, spread);
      g.addColorStop(0, "rgba(12, 14, 20, 0.45)");
      g.addColorStop(1, "rgba(40, 44, 54, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, spread, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < 22; i += 1) {
      const a = (i * 1.97 + 0.4) % (Math.PI * 2);
      const dist = 0.35 + (i % 8) * 0.07;
      const cx = moonX + Math.cos(a) * moonR * dist;
      const cy = moonY + Math.sin(a) * moonR * dist * 0.91;
      if (!inNightFace(cx, cy)) continue;
      const rad = moonR * (0.028 + (i % 4) * 0.014);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, rad * 1.6);
      g.addColorStop(0, "rgba(8, 9, 14, 0.55)");
      g.addColorStop(0.65, "rgba(48, 52, 64, 0.22)");
      g.addColorStop(1, "rgba(48, 52, 64, 0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 1.6, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(70, 76, 92, 0.35)";
      ctx.lineWidth = Math.max(0.4, rad * 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy, rad * 0.95, a + 1.2, a + 3.6);
      ctx.stroke();
    }

    for (let i = 0; i < 36; i += 1) {
      const r1 = Math.sin(i * 11.17 + moonR) * 43758.5453;
      const u = r1 - Math.floor(r1);
      const r2 = Math.sin(i * 63.2 + moonR * 0.7) * 28463.3269;
      const v = r2 - Math.floor(r2);
      const ang = u * Math.PI * 2;
      const rad = Math.sqrt(v) * moonR * 0.88;
      const px = moonX + Math.cos(ang) * rad;
      const py = moonY + Math.sin(ang) * rad;
      if (!inNightFace(px, py)) continue;
      ctx.fillStyle = `rgba(90, 96, 112, ${0.04 + (i % 6) * 0.022})`;
      ctx.fillRect(px, py, 0.9, 0.9);
    }

    // Soft terminator feather on lit edge (eclipse limb)
    ctx.save();
    ctx.beginPath();
    ctx.arc(moonX, moonY, moonR, 0, Math.PI * 2);
    ctx.clip();
    const termGrad = ctx.createRadialGradient(cutCx, cutCy, cutR * 0.88, cutCx, cutCy, cutR * 1.12);
    termGrad.addColorStop(0, "rgba(0, 0, 0, 0)");
    termGrad.addColorStop(0.55, "rgba(180, 190, 212, 0.08)");
    termGrad.addColorStop(1, "rgba(0, 0, 0, 0)");
    ctx.fillStyle = termGrad;
    ctx.fillRect(moonX - moonR * 1.5, moonY - moonR * 1.5, moonR * 3, moonR * 3);
    ctx.restore();

    ctx.restore();

    for (const star of stars) {
      const twinkle = 0.55 + Math.sin(t * (1.2 + star.speed * 35) + star.twinkleSeed) * 0.32;
      const swayX = Math.sin(t * (0.35 + star.speed * 12) + star.swayXSeed) * star.swayRange;
      const swayY = Math.sin(t * (0.28 + star.speed * 10) + star.swayYSeed) * (star.swayRange * 0.55);

      const swayXDepth = swayX * (0.4 + star.depth * 0.6);
      const swayYDepth = swayY * (0.4 + star.depth * 0.6);

      const anchorX = star.baseX + swayXDepth;
      const anchorY = star.baseY + swayYDepth;

      const dx = anchorX + star.offsetX - cursor.x;
      const dy = anchorY + star.offsetY - cursor.y;
      const dist = Math.hypot(dx, dy);

      let cursorBoost = 0;
      if (!prefersReduced && dist < CURSOR_EFFECT_RADIUS) {
        const factor = 1 - dist / CURSOR_EFFECT_RADIUS;
        cursorBoost = factor * 0.42;
        const repel = factor * factor * 0.45;
        const angle = Math.atan2(dy, dx);
        star.velocityX += Math.cos(angle) * repel;
        star.velocityY += Math.sin(angle) * repel;
      }

      // Keep displacement after cursor push, then gradually settle back.
      star.velocityX += -star.offsetX * 0.006;
      star.velocityY += -star.offsetY * 0.006;
      star.velocityX *= 0.94;
      star.velocityY *= 0.94;
      star.offsetX += star.velocityX;
      star.offsetY += star.velocityY;

      const drawX = anchorX + star.offsetX;
      const drawY = anchorY + star.offsetY;

      const alpha = Math.max(0.15, Math.min(1, twinkle + cursorBoost));
      ctx.beginPath();
      ctx.fillStyle = `rgba(228, 238, 255, ${alpha})`;
      ctx.arc(drawX, drawY, star.r * (1 + cursorBoost * 0.28), 0, Math.PI * 2);
      ctx.fill();
    }

    if (!prefersReduced) {
      starfieldRafId = window.requestAnimationFrame(render);
    }
  }

  function startStarfieldLoop() {
    if (prefersReduced) return;
    if (!starfieldRafId) starfieldRafId = window.requestAnimationFrame(render);
  }

  function stopStarfieldLoop() {
    if (starfieldRafId) {
      window.cancelAnimationFrame(starfieldRafId);
      starfieldRafId = 0;
    }
    ctx.clearRect(0, 0, width, height);
  }

  window.addEventListener("mousemove", (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
  });
  window.addEventListener("mouseleave", () => {
    cursor.x = -9999;
    cursor.y = -9999;
  });

  window.addEventListener("resize", () => {
    sizeCanvas();
    createStars();
    if (prefersReduced) render(performance.now());
    else startStarfieldLoop();
  });

  sizeCanvas();
  createStars();

  if (prefersReduced) {
    render(performance.now());
    return;
  }

  startStarfieldLoop();
}

function initInteractiveGrass() {
  const canvas = document.getElementById("grass-overlay");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let width = 0;
  let height = 0;
  const cursor = { x: -9999, y: -9999 };

  const blades = [];
  const DENSITY = 1.45;
  const INTERACTION_RADIUS = 90;

  function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = Math.min(window.innerHeight * 0.62, 620);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function createBlades() {
    blades.length = 0;
    const count = Math.floor(width * DENSITY);
    for (let i = 0; i < count; i += 1) {
      const x = (i / count) * width + (Math.random() - 0.5) * 10;
      const r = Math.random();
      let h = 50 + Math.random() * 56;
      if (r > 0.68) h = 76 + Math.random() * 52;
      if (r > 0.93) h = 102 + Math.random() * 48;
      const depth = Math.random();
      const shadeOffset = (Math.random() - 0.5) * 32;
      blades.push({
        x,
        baseY: height,
        h,
        width: (0.85 + Math.random() * 1.75) * 2,
        seed: Math.random() * Math.PI * 2,
        swaySpeed: 0.45 + Math.random() * 0.65,
        tilt: (Math.random() - 0.5) * 0.2,
        depth,
        shadeOffset,
        bend: 0,
        bendV: 0,
      });
    }

    blades.sort((a, b) => a.depth - b.depth);
  }

  function drawBlade(x, y, h, w, baseLean, tipBend, alpha, r, gCh, bCh) {
    const tipX = x + tipBend;
    const tipY = y - h;
    const cpLowY = y - h * 0.28;
    const cpHighY = y - h * 0.68;
    const cpLowX = x + baseLean;
    const cpHighX = x + tipBend * 0.62;

    ctx.beginPath();
    ctx.moveTo(x - w, y);
    ctx.bezierCurveTo(
      cpLowX - w * 0.26,
      cpLowY,
      cpHighX - w * 0.2,
      cpHighY,
      tipX,
      tipY
    );
    ctx.bezierCurveTo(
      cpHighX + w * 0.2,
      cpHighY,
      cpLowX + w * 0.26,
      cpLowY,
      x + w,
      y
    );
    ctx.closePath();
    ctx.fillStyle = `rgba(${r}, ${gCh}, ${bCh}, ${alpha})`;
    ctx.fill();
  }

  function render(nowMs) {
    const t = nowMs * 0.001;
    ctx.clearRect(0, 0, width, height);
    const rect = canvas.getBoundingClientRect();
    const localCursorXFrame = cursor.x;
    const localCursorYFrame = cursor.y - rect.top;
    const isCursorNearBed = cursor.y >= rect.top - 10 && cursor.y <= rect.bottom + 10;

    function surfaceYAt() {
      return height;
    }

    function traceSurfacePath(step = 8) {
      ctx.beginPath();
      ctx.moveTo(0, surfaceYAt(0));
      for (let x = step; x <= width; x += step) {
        ctx.lineTo(x, surfaceYAt(x));
      }
    }

    // Solid darker-brown soil mass beneath the grass line.
    traceSurfacePath(8);
    ctx.lineTo(width, height);
    ctx.lineTo(0, height);
    ctx.closePath();

    ctx.save();
    ctx.clip();

    ctx.fillStyle = "#2d241f";
    ctx.fillRect(0, 0, width, height);

    // Root layer under the surface (denser + thicker for visibility).
    const rootsCount = Math.floor(width / 30);
    ctx.lineWidth = 1.8;
    ctx.strokeStyle = "rgba(96, 79, 63, 0.62)";
    for (let i = 0; i < rootsCount; i += 1) {
      const x = (i / Math.max(1, rootsCount - 1)) * width + Math.sin(i * 1.7 + t * 0.22) * 9;
      const y = surfaceYAt() + 4;
      const len = 16 + (i % 6) * 4 + Math.sin(t * 0.35 + i * 0.5) * 2;
      const sway = Math.sin(i * 0.6 + t * 0.32) * 11;

      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.bezierCurveTo(
        x - sway * 0.22,
        y + len * 0.3,
        x + sway * 0.58,
        y + len * 0.7,
        x + sway * 0.34,
        y + len
      );
      ctx.stroke();
    }

    // Small stones of varying size and color.
    const stonesCount = Math.floor(width / 22);
    for (let i = 0; i < stonesCount; i += 1) {
      const x = (i / Math.max(1, stonesCount - 1)) * width + ((i * 13) % 9) - 4;
      const yBase = surfaceYAt() + 16 + ((i * 7) % 36);
      const y = Math.min(height - 8, yBase + ((i * 11) % 52));
      const r = 1 + ((i * 5) % 4) * 0.55;
      const shade = i % 3 === 0 ? "rgba(124, 110, 96, 0.38)" : i % 3 === 1 ? "rgba(86, 74, 64, 0.42)" : "rgba(148, 132, 116, 0.34)";
      ctx.beginPath();
      ctx.fillStyle = shade;
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.restore();

    for (const b of blades) {
      const sway = Math.sin(t * b.swaySpeed + b.seed) * (3.2 + b.depth * 3.8);
      const anchorX = b.x + sway;
      const baseYCurved = surfaceYAt() + b.depth * 6;
      const activeY = baseYCurved - b.h * 0.72;
      const dx = anchorX + b.bend - localCursorXFrame;
      const dy = activeY - localCursorYFrame;
      const dist = Math.hypot(dx, dy);

      if (!prefersReduced && isCursorNearBed && dist < INTERACTION_RADIUS) {
        const factor = 1 - dist / INTERACTION_RADIUS;
        const push = factor * factor * factor * (2.2 + b.depth * 1.15) * 0.9;
        const dir = dx >= 0 ? 1 : -1;
        b.bendV += dir * push;
      }

      // The base stays fixed; only upper blade bends and settles back.
      b.bendV += -b.bend * 0.03;
      b.bendV *= 0.84;
      b.bend += b.bendV;

      const baseLean = b.tilt * 8 + sway * 0.18;
      const tipBend = b.tilt * 18 + sway * 0.48 + b.bend * 3.4;
      const moonX = width * NIGHT_SCENE.moonXNorm;
      const moonY = window.innerHeight * NIGHT_SCENE.moonYNorm;
      const bladeScreenX = anchorX;
      const bladeScreenY = window.innerHeight - (height - baseYCurved + b.h * 0.35);
      const moonDx = moonX - bladeScreenX;
      const moonDy = moonY - bladeScreenY;
      const moonDist = Math.max(1, Math.hypot(moonDx, moonDy));
      const moonDir = moonDx / moonDist;
      const moonInfluence = Math.max(0, 1 - moonDist / (window.innerHeight * 1.25));
      const lightBoost = moonInfluence * (0.14 + NIGHT_SCENE.moonGlow * 0.34);
      const shadowDip = (1 - Math.max(0, moonDir)) * 11;

      const v = 0.45 + b.depth * 0.38 + lightBoost * 0.16;
      const so = b.shadeOffset * 0.28;
      const r = Math.min(
        255,
        Math.max(8, Math.round(LOGO_MARK_RGB.r * v - shadowDip * 0.62 + so * 0.9))
      );
      const gCh = Math.min(
        255,
        Math.max(10, Math.round(LOGO_MARK_RGB.g * v - shadowDip * 0.82 + so * 0.74))
      );
      const bCh = Math.min(
        255,
        Math.max(7, Math.round(LOGO_MARK_RGB.b * v - shadowDip * 0.56 + so * 0.5))
      );
      const alpha = 0.42 + b.depth * 0.32 + lightBoost * 0.08;

      drawBlade(anchorX, baseYCurved, b.h, b.width, baseLean, tipBend, alpha, r, gCh, bCh);
    }

    // Smooth bed line: dark earth brown (no jagged breaks).
    traceSurfacePath(6);
    ctx.lineWidth = 13;
    ctx.strokeStyle = "rgba(52, 42, 35, 0.98)";
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    if (!prefersReduced) requestAnimationFrame(render);
  }

  window.addEventListener("mousemove", (e) => {
    cursor.x = e.clientX;
    cursor.y = e.clientY;
  });
  window.addEventListener("mouseleave", () => {
    cursor.x = -9999;
    cursor.y = -9999;
  });
  window.addEventListener("resize", () => {
    sizeCanvas();
    createBlades();
    if (prefersReduced) render(performance.now());
  });
  sizeCanvas();
  createBlades();
  if (prefersReduced) {
    render(performance.now());
    return;
  }
  requestAnimationFrame(render);
}

function initIntroWipe() {
  const wipe = document.getElementById("intro-wipe");
  if (!wipe) return;

  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const page = document.body;

  function play() {
    page.classList.remove("is-loading");
    page.classList.add("is-loaded");

    if (reduce) {
      wipe.remove();
      return;
    }

    window.setTimeout(() => {
      wipe.remove();
    }, 4300);
  }

  window.setTimeout(play, 1200);
}

function initSignInLinkForLocal() {
  const signIns = document.querySelectorAll('a[href*="signin"]');
  if (!signIns.length) return;

  const h = window.location.hostname;
  const isLocal = h === "" || h === "localhost" || h === "127.0.0.1";
  if (!isLocal) return;

  const host = h === "127.0.0.1" ? "127.0.0.1" : "localhost";
  signIns.forEach((el) => {
    el.href = `http://${host}:3000/signin.html`;
  });
}

function initNavMorph() {
  const body = document.body;
  const menuButton = document.getElementById("site-menu-button");
  const menuPanel = document.getElementById("site-menu-panel");
  if (!body || !menuButton || !menuPanel) return;

  function closeMenu() {
    menuPanel.hidden = true;
    menuButton.setAttribute("aria-expanded", "false");
  }

  function onScroll() {
    const splitOn = window.scrollY > window.innerHeight * 0.3;
    body.classList.toggle("nav-split", splitOn);
    if (!splitOn) closeMenu();
  }

  menuButton.addEventListener("click", () => {
    const isOpen = menuButton.getAttribute("aria-expanded") === "true";
    if (isOpen) {
      closeMenu();
      return;
    }
    menuPanel.hidden = false;
    menuButton.setAttribute("aria-expanded", "true");
  });

  document.addEventListener("click", (e) => {
    const target = e.target;
    if (!(target instanceof Node)) return;
    if (menuPanel.hidden) return;
    if (menuPanel.contains(target) || menuButton.contains(target)) return;
    closeMenu();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function initScrollCue() {
  const cue = document.getElementById("scroll-cue");
  if (!cue) return;

  function onScroll() {
    const shouldHide = window.scrollY > 24;
    cue.hidden = shouldHide;
  }

  cue.addEventListener("click", () => {
    const target =
      document.getElementById("audience-switch") ||
      document.getElementById("mission") ||
      document.getElementById("marketplace-preview");
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    window.scrollTo({ top: window.innerHeight * 0.28, behavior: "smooth" });
  });

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

function initSectionSparkles() {
  const canvas = document.getElementById("section-sparkles");
  if (!canvas) return;
  const section = canvas.closest(".beta-band");
  if (!section) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  let width = 0;
  let height = 0;
  let sparks = [];

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = section.getBoundingClientRect();
    width = Math.max(32, Math.floor(rect.width));
    height = Math.max(32, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const area = width * height;
    const count = Math.min(96, Math.max(28, Math.floor(area / 11000)));
    sparks = Array.from({ length: count }, () => ({
      x: Math.random() * width,
      y: Math.random() * height,
      r: Math.random() * 1.35 + 0.3,
      phase: Math.random() * Math.PI * 2,
      speed: Math.random() * 0.75 + 0.3,
    }));
  }

  function frame(ts) {
    if (prefersReduced) return;
    const t = ts * 0.001;
    ctx.clearRect(0, 0, width, height);
    for (const s of sparks) {
      const tw = 0.4 + 0.6 * Math.sin(t * s.speed + s.phase);
      ctx.fillStyle = `rgba(195, 218, 255, ${0.08 + tw * 0.32})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener("resize", resize, { passive: true });

  let ro;
  if (typeof ResizeObserver !== "undefined") {
    ro = new ResizeObserver(() => resize());
    ro.observe(section);
  }

  if (!prefersReduced) {
    requestAnimationFrame(frame);
  }

  window.addEventListener(
    "pagehide",
    () => {
      if (ro) ro.disconnect();
    },
    { once: true }
  );
}

const AUDIENCE_STORAGE_KEY = "grassroots-beta-audience";

/** set by workflow inits — restart demo when toggling audience */
let rescheduleBizDemo = null;
let rescheduleConDemo = null;
let latestBizWorkflowCtrl = null;
let latestConWorkflowCtrl = null;

function setAudience(mode) {
  if (mode !== "business" && mode !== "consultant") return;
  document.body.dataset.audience = mode;
  if (mode === "consultant") {
    latestBizWorkflowCtrl?.abort();
    document.getElementById("two-bids-wrap")?.classList.remove("is-revealed");
    window.requestAnimationFrame(() => rescheduleConDemo?.(0));
  } else {
    latestConWorkflowCtrl?.abort();
    window.requestAnimationFrame(() => rescheduleBizDemo?.(0));
  }
  try {
    sessionStorage.setItem(AUDIENCE_STORAGE_KEY, mode);
  } catch (_) {
    /* ignore */
  }

  document.querySelectorAll(".audience-toggle__btn").forEach((btn) => {
    const on = btn.dataset.audience === mode;
    btn.classList.toggle("is-selected", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  });

  const flipQ = document.getElementById("audience-flip-question");
  const flipBtn = document.getElementById("audience-flip-button");
  if (flipQ && flipBtn) {
    if (mode === "business") {
      flipQ.textContent = "explore the consultant view?";
      flipBtn.textContent = "switch to student experience";
    } else {
      flipQ.textContent = "explore the business view?";
      flipBtn.textContent = "switch to shop experience";
    }
  }
}

function initAudienceToggle() {
  let stored = null;
  try {
    stored = sessionStorage.getItem(AUDIENCE_STORAGE_KEY);
  } catch (_) {
    stored = null;
  }
  if (stored === "business" || stored === "consultant") {
    setAudience(stored);
  } else {
    setAudience(document.body.dataset.audience || "business");
  }

  document.querySelectorAll(".audience-toggle__btn").forEach((btn) => {
    btn.addEventListener("click", () => setAudience(btn.dataset.audience || "business"));
  });

  document.getElementById("audience-flip-button")?.addEventListener("click", () => {
    const next = document.body.dataset.audience === "business" ? "consultant" : "business";
    setAudience(next);
    (
      document.getElementById("audience-switch") ||
      document.getElementById("value-prop") ||
      document.getElementById("mission")
    )?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}

function initHeroParallax() {
  const title = document.querySelector(".hero__float--title");
  const sub = document.querySelector(".hero__float--sub");
  if (!title && !sub) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (reduce) return;

  function tick() {
    const y = window.scrollY;
    if (title instanceof HTMLElement) {
      title.style.transform = `translate3d(0, ${Math.min(y * 0.055, 42)}px, 0)`;
    }
    if (sub instanceof HTMLElement) {
      sub.style.transform = `translate3d(0, ${Math.min(y * 0.09, 56)}px, 0)`;
    }
  }

  window.addEventListener("scroll", tick, { passive: true });
  tick();
}

const BACKYARD_SIM_OPPORTUNITIES = [
  {
    id: "northside-cafe",
    business: "northside cafe",
    owner: "leah p. · owner",
    title: "spring drink rollout + student lunch promos",
    type: "do",
    budget: "$220-$320",
    categories: ["marketing", "food & beverage"],
    posted: "posted today",
    turnaround: "7 day turnaround",
    summary:
      "Need a simple launch push for seasonal drinks that can work across in-store chalkboards, Instagram, and lunch-hour specials.",
    details:
      "Looking for someone who can keep the scope tight, organize a one-week rollout, and make the cafe feel more consistent online and in person.",
    qualifications: ["content planning", "basic design sense", "comfortable with small-business pacing"],
    about:
      "Neighborhood cafe near campus with a steady lunch crowd, weekend regulars, and a small team that wants a cleaner marketing rhythm.",
    logo: { kind: "icon", icon: "mug", colors: ["#4d7c66", "#9fd4c1"] },
  },
  {
    id: "elm-street-bakery",
    business: "elm street bakery",
    owner: "sofia r. · founder",
    title: "square inventory cleanup + promo calendar",
    type: "develop",
    budget: "$300-$400",
    categories: ["operations", "marketing"],
    posted: "posted today",
    turnaround: "10 day turnaround",
    summary:
      "We need help cleaning up inventory across Square and spreadsheets, then turning that into a simple four-week promotional plan.",
    details:
      "The ideal outcome is one opportunity-sized cleanup: clear SKU naming, slower-moving item notes, and a lightweight promo calendar the team can actually keep up with.",
    qualifications: ["square familiarity", "comfortable in spreadsheets", "can simplify a messy handoff"],
    about:
      "Small bakery doing strong weekend traffic and seasonal specials, but the back office still leans on a mix of Square exports and ad hoc sheets.",
    logo: { kind: "icon", icon: "bread", colors: ["#b56749", "#f0c2a7"] },
  },
  {
    id: "cedar-bike-shop",
    business: "cedar bike shop",
    owner: "matt d. · manager",
    title: "spring tune-up campaign landing page",
    type: "plan",
    budget: "$280-$360",
    categories: ["web", "marketing"],
    posted: "posted yesterday",
    turnaround: "12 day turnaround",
    summary:
      "Want a focused landing page outline and campaign plan for tune-up season without turning it into a full redesign project.",
    details:
      "This is a one-off push around spring service demand. Copy structure, page sections, and a paid-social handoff would be enough.",
    qualifications: ["landing page planning", "copy structure", "marketing basics"],
    about:
      "Independent bike shop with seasonal spikes and a lean team that wants a page they can move on quickly before demand peaks.",
    logo: { kind: "icon", icon: "bike", colors: ["#435f8f", "#9fb7e3"] },
  },
  {
    id: "ridge-legal",
    business: "ridge legal",
    owner: "dana w. · operations",
    title: "client intake automation for new inquiries",
    type: "develop",
    budget: "$320-$420",
    categories: ["systems", "operations"],
    posted: "posted 2 days ago",
    turnaround: "14 day turnaround",
    summary:
      "Looking for someone to simplify the intake flow between our website form, internal spreadsheet, and first-response email process.",
    details:
      "We do not need a full software build. A clean intake handoff, obvious automations, and a documented workflow would be enough.",
    qualifications: ["workflow thinking", "automation basics", "good documentation habits"],
    about:
      "Small legal office with recurring intake tasks that are still being handled manually across forms, email, and spreadsheets.",
    logo: { kind: "icon", icon: "scales", colors: ["#5b4a7e", "#b7a8db"] },
  },
  {
    id: "harbor-ceramics",
    business: "harbor ceramics",
    owner: "maya t. · studio lead",
    title: "weekend workshop pricing refresh",
    type: "plan",
    budget: "$180-$240",
    categories: ["finance", "operations"],
    posted: "posted 3 days ago",
    turnaround: "6 day turnaround",
    summary:
      "Need help pressure-testing pricing for beginner workshops and making the schedule feel profitable without getting complicated.",
    details:
      "This should end in one pricing recommendation, a simple model we can revisit, and guidance for how many seats we need per class.",
    qualifications: ["light modeling", "clear communication", "comfortable with one-off pricing work"],
    about:
      "Community ceramics studio running more workshops than before and trying to price them more intentionally without losing accessibility.",
    logo: { kind: "icon", icon: "vase", colors: ["#a86157", "#e6b5ab"] },
  },
  {
    id: "summit-tutoring",
    business: "summit tutoring",
    owner: "ana k. · director",
    title: "parent follow-up email refresh",
    type: "do",
    budget: "$190-$260",
    categories: ["marketing", "communications"],
    posted: "posted 4 days ago",
    turnaround: "5 day turnaround",
    summary:
      "We want tighter follow-up emails after inquiry calls so parents understand next steps, scheduling, and package options.",
    details:
      "This is not a broad CRM project. We just need a cleaner email sequence and better wording for the handoff after the first conversation.",
    qualifications: ["copywriting", "customer communication", "good with concise systems"],
    about:
      "Small tutoring group with a strong referral base and a lot of one-off parent questions after the first consultation call.",
    logo: { kind: "icon", icon: "book", colors: ["#8e6b34", "#dcc08b"] },
  },
];

function formatSimOffer(amount) {
  const raw = String(amount ?? "").trim().replace(/^\$/, "");
  if (!raw) return "";
  return `$${raw}`;
}

function scaleBackyardBudgetRange(text, maxCap = 150) {
  const match = String(text ?? "").match(/^\$(\d+)\s*[-–]\s*\$(\d+)$/);
  if (!match) return String(text ?? "");

  const min = Number(match[1]);
  const max = Number(match[2]);
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= 0) return String(text ?? "");
  if (max <= maxCap) return `$${min}-$${max}`;

  const ratio = maxCap / max;
  const scaledMin = Math.max(1, Math.round(min * ratio));
  const scaledMax = maxCap;
  const safeMin = Math.min(scaledMin, scaledMax);
  return `$${safeMin}-$${scaledMax}`;
}

function getOpportunityTypeIcon(type) {
  const icons = {
    do: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76Z"/></svg>',
    develop: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>',
    plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="8"/><path d="m9 15 2-6 6-2-2 6-6 2Z"/></svg>',
  };
  return icons[type] || "";
}

function getBusinessLogoInner(logo) {
  const businessIcons = {
    mug: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 8h10v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4Z"/><path d="M15 10h2.2a2.8 2.8 0 1 1 0 5.6H15"/><path d="M8 4v2"/><path d="M11 3v3"/></svg>',
    bread: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 9a4 4 0 0 1 7-2 4 4 0 0 1 6 3v6a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3v-3a4 4 0 0 1 3-4Z"/><path d="M9 12v3"/><path d="M13 12v3"/></svg>',
    bike: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="17" r="3.5"/><circle cx="18" cy="17" r="3.5"/><path d="M8 17h5l-3.4-7H7"/><path d="M12 10h4l2 3"/><path d="M10.4 10 14 17"/></svg>',
    scales: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 4v15"/><path d="M7 7h10"/><path d="M9 7 6 12h6Z"/><path d="m15 7 3 5h-6Z"/><path d="M8 19h8"/></svg>',
    vase: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4h6"/><path d="M10 4v3c0 1.5-2.5 2.4-2.5 5.2V16a4 4 0 0 0 4 4h1a4 4 0 0 0 4-4v-3.8C16.5 9.4 14 8.5 14 7V4"/><path d="M8 13h8"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 6.5A2.5 2.5 0 0 1 7.5 4H19v15H7.5A2.5 2.5 0 0 0 5 21Z"/><path d="M5 6.5V21"/><path d="M9 8h6"/><path d="M9 11h4"/></svg>',
  };
  if (logo.kind === "icon" && logo.icon && businessIcons[logo.icon]) {
    return `<span class="backyard-sim__logo-icon">${businessIcons[logo.icon]}</span>`;
  }
  if (logo.kind === "mark") {
    return '<span class="backyard-sim__logo-mark" aria-hidden="true"></span>';
  }
  return logo.text;
}

function getLogoMarkup(opportunity, extraClass = "") {
  const logo = opportunity.logo || { kind: "initials", text: opportunity.business.slice(0, 2).toUpperCase(), colors: ["#4d7c66", "#9fd4c1"] };
  const style = `style="background: linear-gradient(145deg, ${logo.colors[0]}, ${logo.colors[1]});"`;
  return `<div class="backyard-sim__logo ${extraClass}" ${style}>${getBusinessLogoInner(logo)}</div>`;
}

function applyLogoToSlot(slot, opportunity, extraClass = "") {
  const logo = opportunity.logo || { kind: "initials", text: opportunity.business.slice(0, 2).toUpperCase(), colors: ["#4d7c66", "#9fd4c1"] };
  slot.className = `backyard-sim__logo ${extraClass}`.trim();
  slot.style.background = `linear-gradient(145deg, ${logo.colors[0]}, ${logo.colors[1]})`;
  slot.innerHTML = getBusinessLogoInner(logo);
}

function initBackyardSimulation() {
  const root = document.getElementById("backyard-sim-root");
  if (!root) return;

  const gridStage = document.getElementById("backyard-grid-stage");
  const detailStage = document.getElementById("backyard-detail-stage");
  const grid = document.getElementById("backyard-sim-grid");
  const resetBtn = document.getElementById("backyard-reset-btn");
  const backBtn = document.getElementById("backyard-back-btn");
  const questionBtn = document.getElementById("backyard-question-btn");
  const offerInput = document.getElementById("backyard-offer-input");
  const offerNote = document.getElementById("backyard-offer-note");
  const offerSubmit = document.getElementById("backyard-offer-submit");
  const offerStatus = document.getElementById("backyard-offer-status");
  const chat = document.getElementById("backyard-chat");
  const chatClose = document.getElementById("backyard-chat-close");
  const chatBackdrop = document.getElementById("backyard-chat-backdrop");
  const toast = document.getElementById("backyard-toast");

  if (
    !gridStage ||
    !detailStage ||
    !grid ||
    !resetBtn ||
    !backBtn ||
    !questionBtn ||
    !offerInput ||
    !offerNote ||
    !offerSubmit ||
    !offerStatus ||
    !chat ||
    !chatClose ||
    !chatBackdrop ||
    !toast
  ) {
    return;
  }

  const detailLogo = document.getElementById("backyard-detail-logo");
  const detailBusiness = document.getElementById("backyard-detail-business");
  const detailOwner = document.getElementById("backyard-detail-owner");
  const detailAbout = document.getElementById("backyard-detail-about");
  const detailTitle = document.getElementById("backyard-detail-title");
  const detailBudget = document.getElementById("backyard-detail-budget");
  const detailTags = document.getElementById("backyard-detail-tags");
  const detailPosted = document.getElementById("backyard-detail-posted");
  const detailTurnaround = document.getElementById("backyard-detail-turnaround");
  const detailSummary = document.getElementById("backyard-detail-summary");
  const detailDetails = document.getElementById("backyard-detail-details");
  const detailQuals = document.getElementById("backyard-detail-quals");

  if (
    !detailLogo ||
    !detailBusiness ||
    !detailOwner ||
    !detailAbout ||
    !detailTitle ||
    !detailBudget ||
    !detailTags ||
    !detailPosted ||
    !detailTurnaround ||
    !detailSummary ||
    !detailDetails ||
    !detailQuals
  ) {
    return;
  }

  const featured = BACKYARD_SIM_OPPORTUNITIES[1];
  const state = {
    selectedId: featured.id,
    highlightedId: null,
    view: "grid",
    chatOpen: false,
    toastOpen: false,
  };

  let toastTimeout = 0;

  function getOpportunity(id) {
    return BACKYARD_SIM_OPPORTUNITIES.find((item) => item.id === id) || BACKYARD_SIM_OPPORTUNITIES[0];
  }

  function clearToast() {
    window.clearTimeout(toastTimeout);
    toastTimeout = 0;
    state.toastOpen = false;
    toast.hidden = true;
  }

  function showToast(message) {
    window.clearTimeout(toastTimeout);
    toast.textContent = message;
    state.toastOpen = true;
    toast.hidden = false;
    toastTimeout = window.setTimeout(() => {
      state.toastOpen = false;
      toast.hidden = true;
    }, 1800);
  }

  function renderGrid() {
    grid.innerHTML = BACKYARD_SIM_OPPORTUNITIES.map((item) => {
      const classes = ["backyard-card"];
      const displayBudget = scaleBackyardBudgetRange(item.budget);
      if (state.highlightedId === item.id) classes.push("is-highlighted");
      return `
        <button type="button" class="${classes.join(" ")}" data-open-listing="${item.id}">
          <div class="backyard-card__shell">
            ${getLogoMarkup(item)}
            <div class="backyard-card__content">
              <div class="backyard-card__topline">
                <span class="backyard-card__pill">
                  <span class="backyard-card__type-icon">${getOpportunityTypeIcon(item.type)}</span>
                  ${item.type}
                </span>
              </div>
              <p class="backyard-card__brand">${item.business}</p>
              <h4 class="backyard-card__title">${item.title}</h4>
              <div class="backyard-card__meta">
                <div class="backyard-card__meta-row">
                  <span class="backyard-card__detail-label">budget</span>
                  <span class="backyard-card__budget">${displayBudget}</span>
                </div>
                <div class="backyard-card__meta-row">
                  <span class="backyard-card__detail-label">category</span>
                  <span class="backyard-card__tag">${item.categories[0]}</span>
                </div>
              </div>
              <span class="backyard-card__cta">view opportunity →</span>
            </div>
          </div>
        </button>
      `;
    }).join("");
  }

  function renderDetail() {
    const selected = getOpportunity(state.selectedId);
    const displayBudget = scaleBackyardBudgetRange(selected.budget);

    applyLogoToSlot(detailLogo, selected, "backyard-sim__logo--detail");
    detailBusiness.textContent = selected.business;
    detailOwner.textContent = selected.owner;
    detailAbout.textContent = selected.about;
    detailTitle.textContent = selected.title;
    detailBudget.textContent = displayBudget;
    detailPosted.textContent = selected.posted;
    detailTurnaround.textContent = selected.turnaround;
    detailSummary.textContent = selected.summary;
    detailDetails.textContent = selected.details;
    detailQuals.innerHTML = selected.qualifications.map((item) => `<li>${item}</li>`).join("");
    detailTags.innerHTML = `
      <span class="backyard-sim__tag backyard-sim__tag--type">
        <span class="backyard-sim__tag-icon">${getOpportunityTypeIcon(selected.type)}</span>
        ${selected.type}
      </span>
      ${selected.categories.map((item) => `<span class="backyard-sim__tag backyard-sim__tag--muted">${item}</span>`).join("")}
    `;

    offerInput.value = "";
    offerNote.value = "";
    offerStatus.textContent = "";
  }

  function render() {
    root.dataset.view = state.view;
    gridStage.hidden = state.view !== "grid";
    detailStage.hidden = state.view !== "detail";
    chat.hidden = !state.chatOpen;
    toast.hidden = !state.toastOpen;
    renderGrid();
    if (state.view === "detail") renderDetail();
  }

  function openListing(id, manual = true) {
    state.selectedId = id;
    state.highlightedId = id;
    state.view = "detail";
    state.chatOpen = false;
    clearToast();
    render();
  }

  function submitOffer(manual = true) {
    const amount = offerInput.value.trim();

    if (!amount) {
      offerStatus.textContent = "enter an offer amount to continue.";
      return;
    }

    offerStatus.textContent = `submitted ${formatSimOffer(amount)} for this opportunity in the simulation.`;
    showToast("offer submitted");
    offerInput.value = "";
    offerNote.value = "";
  }

  grid.addEventListener("click", (event) => {
    const card = event.target.closest("[data-open-listing]");
    if (!(card instanceof HTMLElement)) return;
    openListing(card.dataset.openListing || featured.id);
  });

  resetBtn.addEventListener("click", () => {
    state.selectedId = featured.id;
    state.highlightedId = null;
    state.view = "grid";
    state.chatOpen = false;
    clearToast();
    render();
  });

  backBtn.addEventListener("click", () => {
    state.view = "grid";
    state.chatOpen = false;
    clearToast();
    render();
  });

  questionBtn.addEventListener("click", () => {
    state.chatOpen = true;
    render();
  });

  chatClose.addEventListener("click", () => {
    state.chatOpen = false;
    render();
  });

  chatBackdrop.addEventListener("click", () => {
    state.chatOpen = false;
    render();
  });

  offerInput.addEventListener("input", () => {
    offerStatus.textContent = "";
  });

  offerNote.addEventListener("input", () => {
    offerStatus.textContent = "";
  });

  offerSubmit.addEventListener("click", () => {
    submitOffer();
  });

  render();
}

function initCommunityMap() {
  const data = window.UF_CAMPUS_MAP_DATA;
  const Leaflet = window.L;
  const root = document.getElementById("community-map");
  const canvas = document.getElementById("community-map-canvas");
  const resetBtn = document.getElementById("community-map-reset");
  if (!data || !Leaflet || !root || !canvas) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const compactViewport = window.matchMedia?.("(max-width: 760px)").matches;
  const formatTitle = (value) =>
    String(value || "")
      .replace(/_/g, " ")
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

  const campusLatLng = Leaflet.latLng(data.center.lat, data.center.lng);
  const pins = data.pins.map((pin) => ({ ...pin, latLng: Leaflet.latLng(pin.lat, pin.lng) }));
  const mapBounds = Leaflet.latLngBounds(
    Leaflet.latLng(data.bounds.south, data.bounds.west),
    Leaflet.latLng(data.bounds.north, data.bounds.east)
  );
  const latSpan = data.bounds.north - data.bounds.south;
  const lngSpan = data.bounds.east - data.bounds.west;
  const introBounds = Leaflet.latLngBounds(
    [data.center.lat - latSpan * 0.18, data.center.lng - lngSpan * 0.16],
    [data.center.lat + latSpan * 0.18, data.center.lng + lngSpan * 0.16]
  );
  const fullPadding = compactViewport ? [22, 22] : [38, 38];
  const introPadding = compactViewport ? [26, 26] : [44, 44];
  const canvasRenderer = Leaflet.canvas({ padding: 0.35, tolerance: 4 });

  const map = Leaflet.map(canvas, {
    preferCanvas: true,
    zoomControl: true,
    attributionControl: true,
    dragging: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    touchZoom: true,
    boxZoom: false,
    keyboard: true,
    zoomSnap: 0.25,
    zoomDelta: 0.5,
    minZoom: 13,
    maxZoom: 18.5,
  });
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(
    '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  );
  map.setMaxBounds(mapBounds.pad(0.12));
  map.fitBounds(introBounds, { padding: introPadding, animate: false, maxZoom: compactViewport ? 15.25 : 16.1 });
  window.requestAnimationFrame(() => map.invalidateSize());

  [
    ["community-map__pane-land", 320],
    ["community-map__pane-water", 330],
    ["community-map__pane-roads", 360],
    ["community-map__pane-buildings", 380],
  ].forEach(([name, zIndex]) => {
    map.createPane(name);
    map.getPane(name).style.zIndex = String(zIndex);
  });

  const addPolygonLayer = (items, pane, style) => {
    items.forEach((item) => {
      Leaflet.polygon(item.coords, {
        pane,
        renderer: canvasRenderer,
        interactive: false,
        smoothFactor: 1,
        ...style(item),
      }).addTo(map);
    });
  };

  addPolygonLayer(data.greens, "community-map__pane-land", () => ({
    stroke: true,
    color: "#bfd4b6",
    weight: 0.8,
    opacity: 0.9,
    fillColor: "#dfead7",
    fillOpacity: 1,
  }));

  addPolygonLayer(data.waters, "community-map__pane-water", () => ({
    stroke: true,
    color: "#c1d7ec",
    weight: 0.85,
    opacity: 0.95,
    fillColor: "#d9e7f6",
    fillOpacity: 1,
  }));

  data.roads.forEach((road) => {
    const styles = {
      arterial: { color: "#9ba4b1", weight: 4.2, opacity: 0.88 },
      collector: { color: "#aab2bd", weight: 3.1, opacity: 0.82 },
      street: { color: "#bcc3cc", weight: 2.1, opacity: 0.78 },
      service: { color: "#c9cfd6", weight: 1.4, opacity: 0.68 },
      "campus-path": { color: "#d2d7dd", weight: 1.15, opacity: 0.72, dashArray: "3 5" },
    };

    Leaflet.polyline(road.coords, {
      pane: "community-map__pane-roads",
      renderer: canvasRenderer,
      interactive: false,
      smoothFactor: 1.1,
      lineCap: "round",
      lineJoin: "round",
      ...styles[road.style],
    }).addTo(map);
  });

  addPolygonLayer(data.buildings, "community-map__pane-buildings", (building) => ({
    stroke: true,
    color: building.kind === "university" ? "#c4c9cf" : "#cfd4db",
    weight: building.kind === "university" ? 1.05 : 0.9,
    opacity: 0.96,
    fillColor: building.kind === "university" ? "#f3f0ea" : "#f7f5f0",
    fillOpacity: 0.98,
  }));

  Leaflet.circle(campusLatLng, {
    radius: 420,
    color: "#8ab79a",
    weight: 1.1,
    opacity: 0.65,
    fillColor: "#dff0e2",
    fillOpacity: 0.35,
    dashArray: "6 7",
    interactive: false,
  }).addTo(map);

  const youMarker = Leaflet.marker(campusLatLng, {
    icon: Leaflet.divIcon({
      className: "community-map__you-wrap",
      html: [
        '<span class="community-map__you-marker">',
        '<span class="community-map__you-pulse"></span>',
        '<span class="community-map__you-core"></span>',
        "</span>",
      ].join(""),
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    }),
    zIndexOffset: 800,
  }).addTo(map);

  youMarker.bindTooltip("you", {
    permanent: true,
    direction: "top",
    offset: [0, -24],
    className: "community-map__leaflet-tip community-map__leaflet-tip--you",
  });

  pins.forEach((pin) => {
    const marker = Leaflet.marker(pin.latLng, {
      icon: Leaflet.divIcon({
        className: "community-map__pin-wrap",
        html: [
          '<span class="community-map__pin-marker">',
          '<span class="community-map__pin-pulse"></span>',
          '<span class="community-map__pin-core"></span>',
          "</span>",
        ].join(""),
        iconSize: [22, 22],
        iconAnchor: [11, 11],
      }),
      keyboard: false,
    }).addTo(map);

    marker.on("add", () => {
      marker.getElement()?.style.setProperty("--pin-delay", `${pin.delay ?? 0}s`);
    });

    const tooltipLabel = pin.name;
    const popupMarkup = [
      `<strong>${pin.name}</strong>`,
      `<span>${formatTitle(pin.kind)} nearby</span>`,
    ].join("<br />");

    marker.bindTooltip(tooltipLabel, {
      direction: "top",
      offset: [0, -30],
      className: "community-map__leaflet-tip",
      sticky: true,
    });

    marker.bindPopup(popupMarkup, {
      autoPanPadding: [28, 28],
      className: "community-map__popup",
    });
  });

  root.dataset.mapState = "campus";
  root.classList.remove("is-map-expanded");

  const introTimeouts = new Set();
  let tourStarted = false;
  let isProgrammaticMove = false;

  const queueStep = (callback, delay) => {
    const timeoutId = window.setTimeout(() => {
      introTimeouts.delete(timeoutId);
      callback();
    }, delay);
    introTimeouts.add(timeoutId);
    return timeoutId;
  };

  const clearQueuedSteps = () => {
    introTimeouts.forEach((timeoutId) => window.clearTimeout(timeoutId));
    introTimeouts.clear();
  };

  const setExpandedState = () => {
    root.dataset.mapState = "city";
    root.classList.add("is-map-expanded");
  };

  const stopProgrammaticMotion = () => {
    clearQueuedSteps();
    if (!isProgrammaticMove) return;
    map.stop();
    isProgrammaticMove = false;
  };

  const completeCityView = (animated = true) => {
    stopProgrammaticMotion();
    setExpandedState();
    isProgrammaticMove = animated;
    map.flyToBounds(mapBounds.pad(compactViewport ? 0.01 : 0.02), {
      padding: fullPadding,
      duration: animated ? 1.6 : 0,
      easeLinearity: 0.24,
      animate: animated,
    });
    if (animated) {
      queueStep(() => {
        isProgrammaticMove = false;
      }, 1800);
    }
  };

  const handleUserTakeover = () => {
    if (prefersReduced || (!tourStarted && !isProgrammaticMove)) return;
    stopProgrammaticMotion();
    setExpandedState();
  };

  ["pointerdown", "touchstart", "wheel"].forEach((eventName) => {
    canvas.addEventListener(eventName, handleUserTakeover, { passive: true });
  });

  resetBtn?.addEventListener("click", () => {
    completeCityView(true);
  });

  window.addEventListener("resize", () => {
    map.invalidateSize();
  });

  const startIntroTour = () => {
    if (tourStarted) return;
    tourStarted = true;

    if (prefersReduced) {
      completeCityView(false);
      return;
    }

    queueStep(() => {
      root.dataset.mapState = "transition";
      root.classList.add("is-map-expanded");
      isProgrammaticMove = true;
      map.flyToBounds(mapBounds.pad(compactViewport ? 0.01 : 0.02), {
        padding: fullPadding,
        duration: 3.8,
        easeLinearity: 0.18,
      });
    }, 950);

    queueStep(() => {
      isProgrammaticMove = false;
      setExpandedState();
    }, 5000);
  };

  const observer = new IntersectionObserver(
    (entries) => {
      const isVisible = entries.some((entry) => entry.isIntersecting);
      if (!isVisible) return;
      map.invalidateSize();
      startIntroTour();
      observer.disconnect();
    },
    { threshold: 0.45 }
  );

  observer.observe(root);
}

const CON_SIM_STEP_DESCS = [
  "scan tiles and tags until something matches your skills and schedule.",
  "open it: business context, task scope, and pay band in one view.",
  "message the lister with a quick clarifying question if you need it.",
  "submit your floor (min) and your opening number (initial offer).",
  "wait—your bid sits in the queue while the shop reviews and awards.",
];

const BIZ_WORKFLOW_TIMING = {
  dashHold: 2800,
  newListingPulse: 1800,
  formEnter: 1000,
  betweenFields: 760,
  charDelay: 84,
  afterType: 1000,
  publishFlash: 1400,
  listingFade: 1100,
  bidsStagger: 1120,
  afterAllBids: 1500,
  profilePulse: 1300,
  acceptPulse: 1500,
  afterAccept: 1100,
  profileHold: 2400,
  messagePulse: 800,
  chatOpen: 800,
  messageGap: 1040,
  backPulse: 850,
  afterBack: 800,
  loopPause: 5600,
};

function sleepWithSignal(ms, signal) {
  if (!signal) return waitForMs(ms);
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const t = setTimeout(finish, ms);
    function finish() {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }
    function onAbort() {
      clearTimeout(t);
      signal.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    }
    signal.addEventListener("abort", onAbort);
  });
}

async function typeIntoSignal(el, text, delay, signal) {
  if (!el) return;
  el.textContent = "";
  const d = delay || 0;
  for (const ch of text) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (d) await sleepWithSignal(d, signal);
    el.textContent += ch;
  }
}

function initBizWorkflowDemo() {
  const root = document.getElementById("biz-workflow-root");
  if (!root) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const T = BIZ_WORKFLOW_TIMING;

  const legend = document.getElementById("biz-flow-legend");
  const chips = legend ? legend.querySelectorAll(".workflow-chip[data-legend-step]") : [];

  const chat = root.querySelector(".biz-flow__chat");
  const btnNew = root.querySelector(".biz-flow__new-btn");
  const btnPublish = root.querySelector(".biz-flow__publish");
  const btnBack = root.querySelector(".biz-flow__back");
  const btnMsg = root.querySelector(".biz-flow__msg-btn");
  const bidRows = root.querySelectorAll(".biz-flow__bid");
  const pillBuild = root.querySelector('.biz-flow__pill[data-pill="build"]');
  const chatLines = root.querySelectorAll(".biz-flow__chat-line");
  const chatBody = root.querySelector(".biz-flow__chat-body");

  let bidRevealTimeouts = [];
  let bizCtrl = new AbortController();

  function clearBidRevealTimeouts() {
    bidRevealTimeouts.forEach((id) => window.clearTimeout(id));
    bidRevealTimeouts = [];
  }

  function setLegendStep(n) {
    chips.forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.legendStep) === n);
    });
  }

  function showStage(name) {
    root.classList.remove("is-stage-dash", "is-stage-form", "is-stage-listing", "is-stage-profile");
    root.classList.add(`is-stage-${name}`);
  }

  function fillFormStatic() {
    const map = {
      business: "lotus wok & grill",
      build: "instagram campaign for lunch + dinner specials",
      budget: "$300–$400",
      quals: "instagram planning, short-form creative, local ad basics",
    };
    root.querySelectorAll(".biz-flow__value").forEach((el) => {
      const k = el.dataset.field;
      if (k && map[k]) el.textContent = map[k];
    });
    if (pillBuild) pillBuild.classList.add("is-selected");
  }

  function resetBizToStepBegin(step) {
    clearBidRevealTimeouts();
    root.classList.remove(
      "is-new-pulse",
      "is-publish-hit",
      "is-listing-fade",
      "is-chat-open"
    );
    bidRows.forEach((row) =>
      row.classList.remove("is-bid-active", "is-bid-picked", "is-bid-accepted", "is-bid-dimmed", "is-profile-pulse")
    );
    root.querySelectorAll(".biz-flow__accept").forEach((b) => b.classList.remove("is-accept-pulse"));
    root.querySelectorAll(".biz-flow__msg-btn").forEach((b) => b.classList.remove("is-message-pulse"));
    root.querySelectorAll(".biz-flow__back").forEach((b) => b.classList.remove("is-back-pulse"));
    root.querySelectorAll(".biz-flow__pill").forEach((p) => p.classList.remove("is-selected"));
    chatLines.forEach((line) => {
      line.textContent = "";
    });
    if (chatBody) chatBody.scrollTop = 0;

    if (step <= 0) {
      root.querySelectorAll(".biz-flow__value").forEach((el) => {
        el.textContent = "";
      });
      showStage("dash");
    } else if (step === 1) {
      root.querySelectorAll(".biz-flow__value").forEach((el) => {
        el.textContent = "";
      });
      showStage("form");
    } else if (step === 2) {
      showStage("form");
      fillFormStatic();
    } else if (step === 3) {
      showStage("listing");
    } else if (step === 4) {
      showStage("listing");
      bidRows.forEach((row) => row.classList.add("is-bid-active"));
    } else {
      showStage("profile");
    }
  }

  async function playBizStep(step, signal) {
    const delay = prefersReduced ? 0 : T.charDelay;

    if (step === 0) {
      await sleepWithSignal(T.dashHold, signal);
      btnNew?.classList.add("is-pulse");
      root.classList.add("is-new-pulse");
      await sleepWithSignal(T.newListingPulse, signal);
      btnNew?.classList.remove("is-pulse");
      root.classList.remove("is-new-pulse");
      return;
    }

    if (step === 1) {
      showStage("form");
      await sleepWithSignal(T.formEnter, signal);
      if (pillBuild) pillBuild.classList.add("is-selected");
      await sleepWithSignal(T.betweenFields, signal);
      const fields = [
        { sel: '[data-field="business"]', text: "lotus wok & grill" },
        { sel: '[data-field="build"]', text: "instagram campaign for lunch + dinner specials" },
        { sel: '[data-field="budget"]', text: "$300–$400" },
        { sel: '[data-field="quals"]', text: "instagram planning, short-form creative, local ad basics" },
      ];
      for (const f of fields) {
        const el = root.querySelector(f.sel);
        await typeIntoSignal(el, f.text, delay, signal);
        await sleepWithSignal(T.afterType, signal);
      }
      return;
    }

    if (step === 2) {
      fillFormStatic();
      showStage("form");
      await sleepWithSignal(400, signal);
      root.classList.add("is-publish-hit");
      btnPublish?.classList.add("is-armed");
      await sleepWithSignal(T.publishFlash, signal);
      root.classList.remove("is-publish-hit");
      btnPublish?.classList.remove("is-armed");
      root.classList.add("is-listing-fade");
      await sleepWithSignal(T.listingFade, signal);
      root.classList.remove("is-listing-fade");
      showStage("listing");
      return;
    }

    if (step === 3) {
      showStage("listing");
      bidRows.forEach((row, i) => {
        const id = window.setTimeout(() => row.classList.add("is-bid-active"), i * T.bidsStagger);
        bidRevealTimeouts.push(id);
      });
      await sleepWithSignal(T.bidsStagger * bidRows.length + T.afterAllBids, signal);
      return;
    }

    if (step === 4) {
      showStage("listing");
      bidRows.forEach((row) => row.classList.add("is-bid-active"));
      const pick = bidRows[1] || bidRows[0];
      pick?.classList.add("is-profile-pulse");
      await sleepWithSignal(T.profilePulse, signal);
      pick?.classList.remove("is-profile-pulse");
      pick?.classList.add("is-bid-picked");
      bidRows.forEach((row) => {
        if (row !== pick) row.classList.add("is-bid-dimmed");
      });
      await sleepWithSignal(T.afterBack, signal);
      return;
    }

    showStage("profile");
    await sleepWithSignal(T.profileHold, signal);
    btnMsg?.classList.add("is-message-pulse");
    await sleepWithSignal(T.messagePulse, signal);
    btnMsg?.classList.remove("is-message-pulse");
    root.classList.add("is-chat-open");
    await sleepWithSignal(T.chatOpen, signal);
    for (const line of chatLines) {
      const full = line.dataset.full || "";
      await typeIntoSignal(line, full, delay, signal);
      await sleepWithSignal(T.messageGap, signal);
    }
    root.classList.remove("is-chat-open");
    btnBack?.classList.add("is-back-pulse");
    await sleepWithSignal(T.backPulse, signal);
    btnBack?.classList.remove("is-back-pulse");
    showStage("listing");
    bidRows.forEach((row) => row.classList.add("is-bid-active"));
    const pick = bidRows[1] || bidRows[0];
    pick?.classList.add("is-bid-picked");
    bidRows.forEach((row) => {
      if (row !== pick) row.classList.add("is-bid-dimmed");
    });
    const acceptBtn = pick?.querySelector(".biz-flow__accept");
    acceptBtn?.classList.add("is-accept-pulse");
    await sleepWithSignal(T.acceptPulse, signal);
    acceptBtn?.classList.remove("is-accept-pulse");
    pick?.classList.add("is-bid-accepted");
    await sleepWithSignal(T.afterAccept, signal);
  }

  async function runBizSequence(fromStep, signal) {
    for (let s = fromStep; s <= 5; s += 1) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      resetBizToStepBegin(s);
      setLegendStep(s);
      await playBizStep(s, signal);
    }
  }

  function scheduleBiz(fromStep) {
    bizCtrl.abort();
    bizCtrl = new AbortController();
    latestBizWorkflowCtrl = bizCtrl;
    const sig = bizCtrl.signal;
    window.requestAnimationFrame(() => {
      (async () => {
        try {
          if (document.body.dataset.audience !== "business") return;
          if (prefersReduced) {
            resetBizToStepBegin(5);
            fillFormStatic();
            bidRows.forEach((row) => row.classList.add("is-bid-active"));
            const pick = bidRows[1] || bidRows[0];
            pick?.classList.add("is-bid-picked", "is-bid-accepted");
            bidRows.forEach((row) => {
              if (row !== pick) row.classList.add("is-bid-dimmed");
            });
            showStage("listing");
            setLegendStep(5);
            return;
          }
          await runBizSequence(fromStep, sig);
          if (sig.aborted) return;
          await sleepWithSignal(T.loopPause, sig);
          if (sig.aborted) return;
          if (document.body.dataset.audience === "business") scheduleBiz(0);
        } catch (_) {
          /* aborted by chip — new scheduleBiz handles next run */
        }
      })();
    });
  }

  chips.forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.legendStep);
      if (Number.isNaN(n)) return;
      scheduleBiz(n);
    });
  });

  rescheduleBizDemo = scheduleBiz;
  scheduleBiz(0);
}

const CON_WORKFLOW_TIMING = {
  browseHold: 1465,
  rotatePause: 665,
  selectPause: 600,
  detailRead: 935,
  chatOpen: 465,
  charDelay: 51,
  msgGap: 640,
  afterChat: 535,
  bidTypeGap: 600,
  toastShow: 2935,
  loopPause: 3465,
};

function initConsultantWorkflowDemo() {
  const root = document.getElementById("con-workflow-root");
  if (!root) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const T = CON_WORKFLOW_TIMING;

  const legend = document.getElementById("bidding-walk-root");
  const walkDescEl = document.getElementById("bidding-walk-desc");
  const chips = legend ? legend.querySelectorAll(".walk-chip[data-con-step]") : [];
  const track = document.getElementById("con-flow-track");
  const rowArrow = document.getElementById("con-flow-row-arrow");
  const pickCard = root.querySelector(".con-flow__card--pick");
  const msgBtn = document.getElementById("con-flow-msg-btn");
  const bidBtn = document.getElementById("con-flow-bid-btn");
  const chatClose = document.getElementById("con-flow-chat-close");
  const bidSubmit = document.getElementById("con-flow-bid-submit");
  const toast = document.getElementById("con-flow-toast");
  const chatLines = root.querySelectorAll("[data-con-chat]");
  const minEl = root.querySelector('[data-con-field="min"]');
  const offerEl = root.querySelector('[data-con-field="offer"]');

  let conCtrl = new AbortController();

  function setConLegend(n) {
    chips.forEach((btn) => {
      btn.classList.toggle("is-active", Number(btn.dataset.conStep) === n);
    });
    if (walkDescEl && CON_SIM_STEP_DESCS[n]) walkDescEl.textContent = CON_SIM_STEP_DESCS[n];
  }

  function setConStage(name) {
    root.classList.remove("is-con-stage-browse", "is-con-stage-detail", "is-con-stage-bid");
    root.classList.add(`is-con-stage-${name}`);
  }

  function resetConBegin(step) {
    root.classList.remove("is-con-chat-open", "is-con-toast-open");
    if (track) track.removeAttribute("data-con-slot");
    chatLines.forEach((line) => {
      line.textContent = "";
    });
    if (minEl) minEl.textContent = "";
    if (offerEl) offerEl.textContent = "";

    if (step <= 0) {
      setConStage("browse");
    } else if (step === 1) {
      setConStage("detail");
      if (track) track.setAttribute("data-con-slot", "1");
    } else if (step === 2) {
      setConStage("detail");
      if (track) track.setAttribute("data-con-slot", "1");
    } else if (step === 3) {
      setConStage("bid");
      if (track) track.setAttribute("data-con-slot", "1");
    } else if (step === 4) {
      setConStage("bid");
      if (track) track.setAttribute("data-con-slot", "1");
      if (minEl) minEl.textContent = "$240";
      if (offerEl) offerEl.textContent = "$275";
      root.classList.add("is-con-toast-open");
    }
  }

  async function playConStep(step, signal) {
    const delay = prefersReduced ? 0 : T.charDelay;

    if (step === 0) {
      setConStage("browse");
      await sleepWithSignal(T.browseHold, signal);
      rowArrow?.classList.add("is-pulse");
      await sleepWithSignal(T.rotatePause, signal);
      rowArrow?.classList.remove("is-pulse");
      if (track) track.setAttribute("data-con-slot", "1");
      await sleepWithSignal(T.rotatePause, signal);
      pickCard?.classList.add("is-pulse");
      await sleepWithSignal(T.selectPause, signal);
      pickCard?.classList.remove("is-pulse");
      setConStage("detail");
      return;
    }

    if (step === 1) {
      setConStage("detail");
      if (track) track.setAttribute("data-con-slot", "1");
      await sleepWithSignal(T.detailRead, signal);
      return;
    }

    if (step === 2) {
      setConStage("detail");
      if (track) track.setAttribute("data-con-slot", "1");
      root.classList.add("is-con-chat-open");
      await sleepWithSignal(T.chatOpen, signal);
      for (const line of chatLines) {
        const full = line.dataset.full || "";
        await typeIntoSignal(line, full, delay, signal);
        await sleepWithSignal(T.msgGap, signal);
      }
      await sleepWithSignal(T.afterChat, signal);
      root.classList.remove("is-con-chat-open");
      return;
    }

    setConStage("detail");
    if (track) track.setAttribute("data-con-slot", "1");
    await sleepWithSignal(350, signal);
    bidBtn?.classList.add("is-pulse");
    await sleepWithSignal(400, signal);
    bidBtn?.classList.remove("is-pulse");
    setConStage("bid");
    await sleepWithSignal(400, signal);
    await typeIntoSignal(minEl, "$240", delay, signal);
    await sleepWithSignal(T.bidTypeGap, signal);
    await typeIntoSignal(offerEl, "$275", delay, signal);
    await sleepWithSignal(400, signal);
    bidSubmit?.classList.add("is-armed");
    await sleepWithSignal(350, signal);
    bidSubmit?.classList.remove("is-armed");
    root.classList.add("is-con-toast-open");
    await sleepWithSignal(T.toastShow, signal);
    root.classList.remove("is-con-toast-open");
  }

  async function runConSequence(fromStep, signal) {
    if (fromStep === 4) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      resetConBegin(4);
      setConLegend(4);
      await sleepWithSignal(1400, signal);
      return;
    }
    for (let s = fromStep; s <= 3; s += 1) {
      if (signal.aborted) throw new DOMException("Aborted", "AbortError");
      resetConBegin(s);
      setConLegend(s);
      await playConStep(s, signal);
    }
  }

  function scheduleCon(fromStep) {
    conCtrl.abort();
    conCtrl = new AbortController();
    latestConWorkflowCtrl = conCtrl;
    const sig = conCtrl.signal;
    window.requestAnimationFrame(() => {
      (async () => {
        try {
          if (document.body.dataset.audience !== "consultant") return;
          if (prefersReduced) {
            resetConBegin(4);
            setConLegend(4);
            return;
          }
          await runConSequence(fromStep, sig);
          if (sig.aborted) return;
          await sleepWithSignal(T.loopPause, sig);
          if (sig.aborted) return;
          if (document.body.dataset.audience === "consultant") scheduleCon(0);
        } catch (_) {
          /* aborted */
        }
      })();
    });
  }

  chips.forEach((btn) => {
    btn.addEventListener("click", () => {
      const n = Number(btn.dataset.conStep);
      if (Number.isNaN(n)) return;
      scheduleCon(n);
    });
  });

  rescheduleConDemo = scheduleCon;
  scheduleCon(0);
}

function revealTwoBidsSection() {
  document.getElementById("two-bids-wrap")?.classList.add("is-revealed");
}

function openWhyTwoBids() {
  revealTwoBidsSection();
  const el = document.getElementById("why-two-bids");
  if (el instanceof HTMLDetailsElement) {
    el.open = true;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function initReplayableBrushMarks() {
  const brushes = [...document.querySelectorAll(".prop-heading-brand__brush[data-brush-replay]")];
  if (!brushes.length) return;

  const prefersReduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) {
    brushes.forEach((brush) => brush.classList.add("is-drawing"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        const brush = entry.target;
        if (!(brush instanceof SVGElement)) return;

        if (entry.isIntersecting) {
          brush.classList.remove("is-drawing");
          void brush.getBoundingClientRect();
          brush.classList.add("is-drawing");
        } else {
          brush.classList.remove("is-drawing");
        }
      });
    },
    {
      threshold: 0.45,
      rootMargin: "0px 0px -8% 0px",
    }
  );

  brushes.forEach((brush) => observer.observe(brush));
}

function initWhyTwoBidsDeepLink() {
  document.getElementById("why-two-bids-anchor")?.addEventListener("click", (e) => {
    e.preventDefault();
    openWhyTwoBids();
  });

  window.addEventListener("hashchange", () => {
    if (window.location.hash === "#why-two-bids") openWhyTwoBids();
  });

  if (window.location.hash === "#why-two-bids") {
    window.requestAnimationFrame(() => openWhyTwoBids());
  }
}

function boot() {
  initSignInLinkForLocal();
  initNavMorph();
  initScrollCue();
  initIntroWipe();
  initWordCycle();
  initStarfield();
  initInteractiveGrass();
  initSectionSparkles();
  initHeroParallax();
  initBackyardSimulation();
  initCommunityMap();
  initAudienceToggle();
  initReplayableBrushMarks();
  initBizWorkflowDemo();
  initConsultantWorkflowDemo();
  initWhyTwoBidsDeepLink();
}

boot();
