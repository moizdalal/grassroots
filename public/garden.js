// garden.js — bloomed engagements the consultant has dragged into
// their garden from the journey on the dashboard. Lives in its own
// section on /profile.html above the consultant-progression card.
//
// Inside the bed:
//   - Each plant is absolutely positioned and drag-to-slide along x;
//     its position persists per-consultant in localStorage.
//   - A monarch butterfly and a small bee wander the bed at random,
//     occasionally landing on a plant's flower.
//
// State (per consultant):
//   localStorage["grassroots_garden_<userId>"]            (membership)
//   localStorage["grassroots_garden_positions_<userId>"]  (x-positions)

import {
  loadGardenForUser,
  saveGardenForUser,
  assignSpecies,
  isPremature,
} from "/engagement-journey-flowers.js";
import { FLOWERS, plantSvg } from "/flower-sketch.js";
import { getInitials } from "/initials.js";
import { showToast } from "/toast.js";

function positionsKey(userId) {
  return userId ? `grassroots_garden_positions_${userId}` : null;
}
function loadPositions(userId) {
  const key = positionsKey(userId);
  if (!key) return {};
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}
function savePosition(userId, bidId, xPct) {
  const key = positionsKey(userId);
  if (!key) return;
  const positions = loadPositions(userId);
  positions[bidId] = xPct;
  try { localStorage.setItem(key, JSON.stringify(positions)); } catch (_) {}
}

export async function mountGarden(container, { client, userId }) {
  if (!container || !userId || !client) return;

  // Sky lives at the .pp-garden level (not the bed) so stars + moon /
  // sun + clouds span the whole section, drifting behind the header
  // as well as the bed. It's rendered once at mount; the per-render
  // bed update below leaves it alone.
  container.innerHTML = `
    ${skyDom()}
    <div class="pp-garden__head">
      <p class="pf-level-kicker">your garden</p>
      <h2 class="pp-garden__title">bloomed engagements</h2>
      <p class="pp-garden__copy" id="pp-garden-copy"></p>
    </div>
    <div class="pp-garden__bed" id="pp-garden-bed"></div>
  `;
  const gardenEl = container;
  const bedEl = container.querySelector("#pp-garden-bed");
  const copyEl = container.querySelector("#pp-garden-copy");

  let gardenIds = loadGardenForUser(userId);
  let enriched = [];
  let speciesByBidId = new Map();
  // Per-render bed cleanups (pollinators). Star repulsion is wired
  // once at mount and isn't part of this list.
  let bugCleanups = [];

  async function loadEngagementData() {
    const { data: bids } = await client
      .from("bids")
      .select(
        "id, listing_id, consultant_id, amount_cents, message, status, payment_status, paid_at, released_at, accepted_at, created_at"
      )
      .eq("consultant_id", userId);
    if (!Array.isArray(bids) || !bids.length) {
      enriched = [];
      speciesByBidId = new Map();
      return;
    }
    const listingIds = [...new Set(bids.map((b) => b.listing_id).filter(Boolean))];
    let listings = [];
    if (listingIds.length) {
      const { data } = await client
        .from("listings")
        .select("id, owner_id, title, status, business_display_name")
        .in("id", listingIds);
      listings = data || [];
    }
    const listingMap = new Map(listings.map((l) => [l.id, l]));
    const ownerIds = [...new Set(listings.map((l) => l.owner_id).filter(Boolean))];
    let ownerProfiles = [], ownerBiz = [];
    if (ownerIds.length) {
      const [p, b] = await Promise.all([
        client.from("profiles").select("id, full_name, avatar_path").in("id", ownerIds),
        client.from("business_profiles").select("user_id, business_name").in("user_id", ownerIds),
      ]);
      ownerProfiles = p.data || [];
      ownerBiz = b.data || [];
    }
    const ownerMap = new Map(ownerProfiles.map((p) => [p.id, p]));
    const ownerBizMap = new Map(ownerBiz.map((b) => [b.user_id, b.business_name]));

    enriched = bids.map((bid) => {
      const listing = listingMap.get(bid.listing_id);
      const owner = ownerMap.get(listing?.owner_id);
      const counterpart =
        ownerBizMap.get(listing?.owner_id) || owner?.full_name || "business";
      const premature = isPremature(bid, listing, null);
      const id = String(bid.id);
      const ownerAvatarUrl = owner?.avatar_path
        ? client.storage.from("avatars").getPublicUrl(owner.avatar_path).data?.publicUrl || ""
        : "";
      return { bid, listing, owner, counterpart, premature, id, ownerAvatarUrl };
    });
    speciesByBidId = assignSpecies(enriched);
  }

  async function render() {
    // Stop any bugs from the previous render — their timers would
    // otherwise hold stale references to removed DOM nodes.
    bugCleanups.forEach((fn) => { try { fn(); } catch (_) {} });
    bugCleanups = [];

    gardenIds = loadGardenForUser(userId);
    const bidIds = Object.keys(gardenIds);
    const landscapeMarkup = `<div class="pp-garden__landscape">${landscapeSvg()}</div>`;
    if (bidIds.length === 0) {
      bedEl.innerHTML = `${landscapeMarkup}<p class="pp-garden__empty">no bloomed plants here yet — drag a bloomed plant from your engagement journey on the dashboard.</p>`;
      if (copyEl) copyEl.textContent = "";
      spawnBugs();
      return;
    }
    if (!enriched.length) await loadEngagementData();
    const inGarden = bidIds
      .map((id) => enriched.find((e) => e.id === id))
      .filter(Boolean)
      .sort((a, b) => (gardenIds[b.id] || 0) - (gardenIds[a.id] || 0));
    bedEl.innerHTML =
      landscapeMarkup +
      inGarden.map((eng) => renderPlant(eng)).join("");
    if (copyEl) {
      const n = inGarden.length;
      copyEl.textContent = `${n} bloomed engagement${n === 1 ? "" : "s"} in your garden.`;
    }
    applyPositions(inGarden);
    wireInteractions(inGarden);
    spawnBugs();
  }

  // Cursor-driven star repulsion. Stars carry their resting position
  // as `data-base-x` / `data-base-y` percentages relative to the
  // whole .pp-garden (since the sky spans the section, not just the
  // bed). Listener sits on the garden so pointermove anywhere in the
  // section — head text included — feeds the repulsion.
  function wireStarRepulsion() {
    // Anchor stars belong to a constellation polyline and must stay
    // put, otherwise their connecting line would drift off them.
    const stars = Array.from(
      gardenEl.querySelectorAll(
        ".pp-garden__star:not(.pp-garden__star--anchor)"
      )
    );
    if (!stars.length) return null;
    const RADIUS = 90;
    const STRENGTH = 22;
    const onMove = (e) => {
      const gR = gardenEl.getBoundingClientRect();
      if (!gR.width || !gR.height) return;
      const cx = e.clientX - gR.left;
      const cy = e.clientY - gR.top;
      for (const star of stars) {
        const baseX = (parseFloat(star.dataset.baseX) / 100) * gR.width;
        const baseY = (parseFloat(star.dataset.baseY) / 100) * gR.height;
        const dx = baseX - cx;
        const dy = baseY - cy;
        const dist = Math.hypot(dx, dy);
        if (dist < RADIUS && dist > 0) {
          const f = (1 - dist / RADIUS) * STRENGTH;
          star.style.setProperty("--star-dx", `${((dx / dist) * f).toFixed(2)}px`);
          star.style.setProperty("--star-dy", `${((dy / dist) * f).toFixed(2)}px`);
        } else {
          star.style.removeProperty("--star-dx");
          star.style.removeProperty("--star-dy");
        }
      }
    };
    const onLeave = () => {
      for (const star of stars) {
        star.style.removeProperty("--star-dx");
        star.style.removeProperty("--star-dy");
      }
    };
    gardenEl.addEventListener("pointermove", onMove);
    gardenEl.addEventListener("pointerleave", onLeave);
    return () => {
      gardenEl.removeEventListener("pointermove", onMove);
      gardenEl.removeEventListener("pointerleave", onLeave);
    };
  }

  function applyPositions(inGarden) {
    const positions = loadPositions(userId);
    inGarden.forEach((eng, idx) => {
      const el = bedEl.querySelector(`.pp-garden__plant[data-bid-id="${cssId(eng.id)}"]`);
      if (!el) return;
      let x = positions[eng.id];
      if (typeof x !== "number" || !isFinite(x)) {
        // Default layout: evenly spaced across the bed, leaving a small
        // margin at each edge so plants don't touch the borders.
        x = inGarden.length === 1 ? 50 : 6 + (idx * 88) / (inGarden.length - 1);
      }
      el.style.left = `${x}%`;
    });
  }

  function wireInteractions(inGarden) {
    bedEl.querySelectorAll(".pp-garden__plant").forEach((plantEl) => {
      wirePlantDrag(plantEl, inGarden);
      const removeBtn = plantEl.querySelector(".pp-garden__plant-remove");
      if (removeBtn) {
        removeBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          const id = plantEl.dataset.bidId;
          if (!id) return;
          const eng = inGarden.find((x) => x.id === id);
          delete gardenIds[id];
          saveGardenForUser(userId, gardenIds);
          showToast(
            `uprooted ${eng?.counterpart || "plant"} — back in your engagement journey.`,
            { duration: 2400 }
          );
          render();
        });
      }
    });
  }

  // Pointer-based drag-to-position along the x-axis. Plain clicks
  // (no movement above DRAG_THRESHOLD) still open the listing. The
  // trailing synthetic click is suppressed after a real drag so the
  // browser doesn't navigate after the user releases.
  const DRAG_THRESHOLD = 5;
  function wirePlantDrag(plantEl, inGarden) {
    plantEl.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (e.target.closest(".pp-garden__plant-remove")) return;
      const bedRect = bedEl.getBoundingClientRect();
      const plantRect = plantEl.getBoundingClientRect();
      const startX = e.clientX;
      const startLeftPx = plantRect.left - bedRect.left;
      let dragging = false;

      const onMove = (ev) => {
        const dx = ev.clientX - startX;
        if (!dragging) {
          if (Math.abs(dx) > DRAG_THRESHOLD) {
            dragging = true;
            plantEl.classList.add("is-dragging");
            plantEl.style.transition = "none";
            plantEl.style.zIndex = "5";
            try { plantEl.setPointerCapture(e.pointerId); } catch (_) {}
          }
        }
        if (dragging) {
          const maxLeft = bedRect.width - plantRect.width;
          const newLeftPx = Math.max(0, Math.min(maxLeft, startLeftPx + dx));
          const xPct = (newLeftPx / bedRect.width) * 100;
          plantEl.style.left = `${xPct}%`;
        }
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        if (dragging) {
          plantEl.classList.remove("is-dragging");
          plantEl.style.transition = "";
          plantEl.style.zIndex = "";
          const xPct = parseFloat(plantEl.style.left) || 0;
          savePosition(userId, plantEl.dataset.bidId, xPct);
          // Suppress the synthetic click that follows pointerup so a
          // drag doesn't also navigate to the listing.
          const sup = (ce) => { ce.stopPropagation(); ce.preventDefault(); };
          plantEl.addEventListener("click", sup, { capture: true, once: true });
          setTimeout(() => plantEl.removeEventListener("click", sup, true), 250);
        }
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    });

    plantEl.addEventListener("click", (e) => {
      if (e.target.closest(".pp-garden__plant-remove")) return;
      const id = plantEl.dataset.bidId;
      const eng = inGarden.find((x) => x.id === id);
      if (eng?.listing?.id) window.location.href = `/listing.html?id=${eng.listing.id}`;
    });
    plantEl.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && !e.target.closest(".pp-garden__plant-remove")) {
        e.preventDefault();
        const id = plantEl.dataset.bidId;
        const eng = inGarden.find((x) => x.id === id);
        if (eng?.listing?.id) window.location.href = `/listing.html?id=${eng.listing.id}`;
      }
    });
  }

  // Theme-aware bug spawn. Light theme keeps the original bee that
  // buzzes around and lands on plants; dark theme replaces it with
  // a swarm of fireflies that drift slowly and pulse on their own
  // phases. Bugs are cleared and re-spawned on theme change so the
  // user never sees a bee in a starry sky.
  function spawnBugs() {
    const isLight =
      document.documentElement.getAttribute("data-theme") === "light";
    if (isLight) {
      for (let i = 0; i < 2; i++) {
        bugCleanups.push(
          spawnPollinator(bedEl, {
            kind: "bee",
            svg: beeSvg(),
            sizePx: 22,
            flapMs: 70,
            maxSpeed: 14,
            acceleration: 70,
            damping: 0.9,
            jitter: 3.2,
            cadenceRange: [0.45, 1.65],
            cadenceMs: [900, 2600],
            holdMs: [800, 1900],
            landProbability: 0.5,
            arriveAt: 1.6,
          })
        );
      }
    } else {
      // Fireflies: small glowing motes, drift slowly, never land.
      // Each one carries its own pulse phase so the swarm doesn't
      // flash in unison.
      for (let i = 0; i < 5; i++) {
        const pulseDur = (1.4 + Math.random() * 1.6).toFixed(2);
        const pulseDelay = (-(Math.random() * 2.5)).toFixed(2);
        bugCleanups.push(
          spawnPollinator(bedEl, {
            kind: "firefly",
            svg: fireflySvg(),
            sizePx: 14,
            flapMs: 0,
            maxSpeed: 4.2,
            acceleration: 14,
            damping: 0.94,
            jitter: 1.4,
            cadenceRange: [0.35, 1.1],
            cadenceMs: [1100, 2800],
            holdMs: [0, 0],
            landProbability: 0,
            arriveAt: 2,
            cssVars: {
              "--pulse-dur": `${pulseDur}s`,
              "--pulse-delay": `${pulseDelay}s`,
            },
          })
        );
      }
    }
  }

  // Bugs are theme-locked, so a theme switch needs to clear the
  // current ones and respawn the right kind. Plant content is
  // unaffected — only the bug layer churns.
  const onThemeChange = () => {
    bugCleanups.forEach((fn) => { try { fn(); } catch (_) {} });
    bugCleanups = [];
    spawnBugs();
  };
  window.addEventListener("grassroots:themechange", onThemeChange);

  function renderPlant(eng) {
    const species = speciesByBidId.get(eng.id) || FLOWERS[0];
    const plantMarkup = plantSvg(species, 5);
    const avatarMarkup = eng.ownerAvatarUrl
      ? `<img src="${escapeHtml(eng.ownerAvatarUrl)}" alt=""/>`
      : `<span>${escapeHtml(getInitials(eng.counterpart))}</span>`;
    return `
      <div class="pp-garden__plant" data-bid-id="${escapeHtml(eng.id)}"
           role="button" tabindex="0"
           aria-label="${escapeHtml(eng.counterpart)} — ${escapeHtml(eng.listing?.title || "engagement")} — drag to position, click to open listing">
        <button type="button" class="pp-garden__plant-remove" data-bid-id="${escapeHtml(eng.id)}"
                aria-label="move ${escapeHtml(eng.counterpart)} back to your journey"
                title="move back to journey">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
               stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="6" y1="6" x2="18" y2="18"/>
            <line x1="18" y1="6" x2="6" y2="18"/>
          </svg>
        </button>
        <div class="pp-garden__plant-canvas">${plantMarkup}</div>
        <div class="pp-garden__plant-meta">
          <span class="pp-garden__plant-avatar">${avatarMarkup}</span>
          <div class="pp-garden__plant-text">
            <span class="pp-garden__plant-biz">${escapeHtml(eng.counterpart)}</span>
            <span class="pp-garden__plant-title">${escapeHtml(eng.listing?.title || "engagement")}</span>
          </div>
        </div>
      </div>
    `;
  }

  // Star repulsion is wired once at mount — the sky lives on the
  // garden container and persists across plant re-renders.
  wireStarRepulsion();

  await render();
}

/* ============================================================== */
/*                          POLLINATORS                            */
/* ============================================================== */

// One pollinator = one wandering insect driven by a requestAnimation-
// Frame physics loop. Each frame we steer the velocity toward a target
// position (random spot or a plant flower), apply damping + jitter,
// and integrate. When close enough to the target the insect either
// lands on it (pause for `holdMs`) or picks a new target. A periodic
// cadence multiplier (`cadence`) scales the max speed so flight pace
// varies organically. An optional trail records recent positions and
// renders them as fading dots — the bee uses this, the butterfly
// doesn't.
//
// Returns a cleanup function that stops the loop and removes every
// DOM node it created — call before the bed is re-rendered.
function spawnPollinator(bedEl, opts) {
  const {
    kind, svg, sizePx, flapMs,
    maxSpeed, acceleration, damping, jitter,
    cadenceRange, cadenceMs,
    holdMs, landProbability, arriveAt,
    trail: trailOpts,
    cssVars,
  } = opts;

  const el = document.createElement("div");
  el.className = `pp-garden__pollinator pp-garden__pollinator--${kind}`;
  el.style.width = `${sizePx}px`;
  el.style.height = `${sizePx}px`;
  if (flapMs) el.style.setProperty("--flap-ms", `${flapMs}ms`);
  if (cssVars) {
    for (const [name, value] of Object.entries(cssVars)) {
      el.style.setProperty(name, value);
    }
  }
  el.innerHTML = `<div class="pp-garden__pollinator-wobble">${svg}</div>`;
  bedEl.appendChild(el);

  // Pre-allocated trail dots so we don't churn DOM every frame.
  let trailDots = null;
  let trail = null;
  if (trailOpts) {
    trail = [];
    trailDots = [];
    for (let i = 0; i < trailOpts.length; i++) {
      const dot = document.createElement("div");
      dot.className = `pp-garden__pollinator-trail-dot pp-garden__pollinator-trail-dot--${kind}`;
      dot.style.opacity = "0";
      bedEl.appendChild(dot);
      trailDots.push(dot);
    }
  }

  let x = 10 + Math.random() * 80;
  let y = 8 + Math.random() * 30;
  let tx = x, ty = y;
  let vx = 0, vy = 0;
  let cadence = 1;
  let cadenceUntil = 0;
  let lastTrailAt = 0;
  let state = "flying";
  let holdUntil = 0;
  let alive = true;
  let lastFrame = 0;
  let rafId = 0;

  el.style.left = `${x}%`;
  el.style.top = `${y}%`;

  pickTarget();

  function pickTarget() {
    el.classList.remove("is-landed");
    const plants = bedEl.querySelectorAll(".pp-garden__plant");
    const bR = bedEl.getBoundingClientRect();
    if (plants.length && bR.width > 0 && bR.height > 0 && Math.random() < 0.55) {
      const p = plants[Math.floor(Math.random() * plants.length)];
      const pR = p.getBoundingClientRect();
      tx = ((pR.left + pR.width / 2 - bR.left) / bR.width) * 100;
      ty = ((pR.top + pR.height * 0.05 - bR.top) / bR.height) * 100;
    } else {
      tx = 6 + Math.random() * 88;
      ty = 6 + Math.random() * 55;
    }
  }

  function land(now) {
    state = "landed";
    vx = 0; vy = 0;
    holdUntil = now + holdMs[0] + Math.random() * (holdMs[1] - holdMs[0]);
    el.classList.add("is-landed");
  }

  function tick(now) {
    if (!alive) return;
    if (!lastFrame) lastFrame = now;
    // Clamp delta so a long tab-blur pause doesn't teleport the bug.
    const dt = Math.min(0.06, (now - lastFrame) / 1000);
    lastFrame = now;
    const frameScale = dt * 60; // for per-frame coefficients tuned at 60fps

    if (state === "landed") {
      if (now >= holdUntil) {
        state = "flying";
        pickTarget();
      }
    } else {
      if (now >= cadenceUntil) {
        cadence = cadenceRange[0] + Math.random() * (cadenceRange[1] - cadenceRange[0]);
        cadenceUntil = now + cadenceMs[0] + Math.random() * (cadenceMs[1] - cadenceMs[0]);
      }
      const effMax = maxSpeed * cadence;

      const dx = tx - x;
      const dy = ty - y;
      const dist = Math.hypot(dx, dy);
      if (dist < arriveAt) {
        if (Math.random() < landProbability) {
          land(now);
        } else {
          pickTarget();
        }
      } else {
        const inv = 1 / dist;
        vx += dx * inv * acceleration * dt;
        vy += dy * inv * acceleration * dt;
        if (jitter) {
          vx += (Math.random() - 0.5) * jitter * frameScale;
          vy += (Math.random() - 0.5) * jitter * frameScale;
        }
        vx *= Math.pow(damping, frameScale);
        vy *= Math.pow(damping, frameScale);
        const speed = Math.hypot(vx, vy);
        if (speed > effMax) {
          vx = (vx / speed) * effMax;
          vy = (vy / speed) * effMax;
        }
        x += vx * dt;
        y += vy * dt;
        if (x < 2) { x = 2; vx = Math.abs(vx) * 0.5; }
        else if (x > 96) { x = 96; vx = -Math.abs(vx) * 0.5; }
        if (y < 2) { y = 2; vy = Math.abs(vy) * 0.5; }
        else if (y > 92) { y = 92; vy = -Math.abs(vy) * 0.5; }

        if (trail && now - lastTrailAt > trailOpts.dropMs) {
          lastTrailAt = now;
          trail.push({ x, y, t: now });
          if (trail.length > trailOpts.length) trail.shift();
        }
      }
    }

    el.style.left = `${x}%`;
    el.style.top = `${y}%`;
    if (trail) renderTrail(now);

    rafId = requestAnimationFrame(tick);
  }

  function renderTrail(now) {
    for (let i = 0; i < trailOpts.length; i++) {
      const dot = trailDots[i];
      const point = trail[i];
      if (point) {
        const age = (now - point.t) / 1000;
        const alpha = Math.max(0, 1 - age / trailOpts.fadeS);
        if (alpha > 0) {
          dot.style.left = `${point.x}%`;
          dot.style.top = `${point.y}%`;
          dot.style.opacity = alpha.toFixed(2);
        } else {
          dot.style.opacity = "0";
        }
      } else {
        dot.style.opacity = "0";
      }
    }
  }

  rafId = requestAnimationFrame(tick);

  return () => {
    alive = false;
    if (rafId) cancelAnimationFrame(rafId);
    if (trailDots) trailDots.forEach((d) => d.remove());
    el.remove();
  };
}

// A simple garden-landscape backdrop SVG that sits behind plants +
// pollinators in the bed. Three layered hill silhouettes with rising
// opacity establish depth, and the entire SVG is theme-token coloured
// so it adapts to light / dark mode automatically. Celestial elements
// (sun/moon/stars/clouds) live in their own DOM layer — see skyDom().
function landscapeSvg() {
  return `
    <svg class="pp-garden__landscape-svg" viewBox="0 0 600 340"
         preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <defs>
        <linearGradient id="pp-garden-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"  stop-color="var(--fo-bg)" stop-opacity="0"/>
          <stop offset="100%" stop-color="var(--fo-accent)" stop-opacity="0.08"/>
        </linearGradient>
      </defs>
      <rect width="600" height="340" fill="url(#pp-garden-sky)"/>
      <!-- distant hills -->
      <path d="M 0 230 C 120 210 220 222 320 215 C 420 208 520 222 600 215 L 600 340 L 0 340 Z"
            fill="var(--fo-accent)" opacity="0.16"/>
      <!-- middle hills -->
      <path d="M 0 265 C 100 245 220 260 300 254 C 400 248 500 266 600 254 L 600 340 L 0 340 Z"
            fill="var(--fo-accent)" opacity="0.24"/>
      <!-- foreground meadow / soil swell -->
      <path d="M 0 302 C 80 286 180 296 280 290 C 380 284 480 302 600 290 L 600 340 L 0 340 Z"
            fill="var(--fo-accent)" opacity="0.34"/>
    </svg>
  `;
}

// Sky overlay: stars + crescent moon (visible in dark themes) and a
// sun + fluffy clouds (visible in light theme). Both sets are always
// in the DOM so theme switches don't need a re-render — visibility is
// toggled by `[data-theme="…"]` selectors in garden.css. Stars and
// clouds have pointer-events: none so the bed receives pointermove
// for the repulsion effect; moon and sun have pointer-events: auto
// to support hover.
function skyDom() {
  const stars = [];
  for (let i = 0; i < 28; i++) {
    const xPct = Math.random() * 96 + 2;
    const yPct = 3 + Math.random() * 50;
    const sizeBucket = Math.random();
    const cls =
      sizeBucket < 0.18
        ? "pp-garden__star pp-garden__star--lg"
        : sizeBucket < 0.55
        ? "pp-garden__star"
        : "pp-garden__star pp-garden__star--sm";
    const dur = (2.8 + Math.random() * 2.6).toFixed(2);
    const delay = (-(Math.random() * 4)).toFixed(2);
    stars.push(
      `<span class="${cls}" data-base-x="${xPct.toFixed(2)}" data-base-y="${yPct.toFixed(2)}" style="left:${xPct.toFixed(
        2
      )}%;top:${yPct.toFixed(2)}%;--twinkle-dur:${dur}s;--twinkle-delay:${delay}s"></span>`
    );
  }

  // Faint constellations: a few fixed-position star clusters joined by
  // hair-thin lines. Anchor stars get their own class so the cursor
  // repulsion skips them — otherwise the linking lines would float
  // away from their endpoints. Each set is positioned in % of the
  // .pp-garden so the SVG (stretched via preserveAspectRatio="none")
  // and the anchor `<span>`s share the exact same coordinate space.
  const CONSTELLATIONS = [
    // upper-left kite
    { points: [[8, 14], [14, 8], [20, 16], [14, 24]], closed: true },
    // upper-center V
    { points: [[34, 22], [42, 8], [50, 22]], closed: false },
    // upper-mid-right zigzag W
    { points: [[60, 16], [64, 24], [70, 12], [76, 22], [80, 14]], closed: false },
  ];
  const constellationLines = CONSTELLATIONS.map((c) => {
    const pts = c.points.map(([x, y]) => `${x},${y}`).join(" ");
    const full = c.closed
      ? `${pts} ${c.points[0][0]},${c.points[0][1]}`
      : pts;
    return `<polyline points="${full}"/>`;
  }).join("");
  const constellationSvg = `
    <svg class="pp-garden__constellations" viewBox="0 0 100 100"
         preserveAspectRatio="none" aria-hidden="true">
      ${constellationLines}
    </svg>
  `;
  const anchorStars = CONSTELLATIONS.flatMap((c) =>
    c.points.map(([x, y]) => {
      const dur = (3.0 + Math.random() * 2.4).toFixed(2);
      const delay = (-(Math.random() * 4)).toFixed(2);
      return `<span class="pp-garden__star pp-garden__star--anchor" data-base-x="${x.toFixed(
        2
      )}" data-base-y="${y.toFixed(
        2
      )}" style="left:${x.toFixed(2)}%;top:${y.toFixed(
        2
      )}%;--twinkle-dur:${dur}s;--twinkle-delay:${delay}s"></span>`;
    })
  ).join("");

  // Crescent moon: a pale disc with a darker "shadow" circle overlaid
  // and offset to carve the crescent. Shadow uses var(--fo-bg) so it
  // blends with whatever dark theme is active.
  const moon = `
    <button type="button" class="pp-garden__moon" aria-label="moon">
      <svg viewBox="0 0 64 64" width="100%" height="100%" aria-hidden="true">
        <defs>
          <radialGradient id="pp-garden-moon-glow" cx="38%" cy="40%" r="60%">
            <stop offset="0%" stop-color="#fdf6d6"/>
            <stop offset="100%" stop-color="#e6d59f"/>
          </radialGradient>
        </defs>
        <circle cx="30" cy="32" r="22" fill="url(#pp-garden-moon-glow)"/>
        <circle cx="40" cy="29" r="20" fill="var(--fo-bg)"/>
      </svg>
    </button>
  `;

  // Sun: yellow-amber disc with twelve short rays. The rays group has
  // its own class so CSS can spin it on hover without touching the
  // disc's hover transform.
  const rays = Array.from({ length: 12 }, (_, i) => {
    const deg = i * 30;
    return `<rect x="38.5" y="4" width="3" height="9" rx="1.5" transform="rotate(${deg} 40 40)" fill="#f6c457"/>`;
  }).join("");
  const sun = `
    <button type="button" class="pp-garden__sun" aria-label="sun">
      <svg viewBox="0 0 80 80" width="100%" height="100%" aria-hidden="true">
        <defs>
          <radialGradient id="pp-garden-sun-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stop-color="#fff2bc"/>
            <stop offset="60%" stop-color="#f6c457"/>
            <stop offset="100%" stop-color="#e89d3a"/>
          </radialGradient>
        </defs>
        <g class="pp-garden__sun-rays">${rays}</g>
        <circle cx="40" cy="40" r="20" fill="url(#pp-garden-sun-glow)"/>
      </svg>
    </button>
  `;

  // Three cloud clusters drifting at different speeds + heights for
  // parallax. `--cloud-scale` is folded into the keyframe transform
  // so the scale survives the translate animation.
  const cloudData = [
    { top: 18, dur: 56, delay: -6,  scale: 1.0 },
    { top: 54, dur: 84, delay: -28, scale: 0.74 },
    { top: 34, dur: 70, delay: -48, scale: 1.18 },
  ];
  const clouds = cloudData
    .map(
      (c) => `
    <div class="pp-garden__cloud" style="top:${c.top}px;--cloud-scale:${c.scale};--drift-dur:${c.dur}s;--drift-delay:${c.delay}s">
      <svg viewBox="0 0 120 50" width="120" height="50" aria-hidden="true">
        <g fill="#ffffff" opacity="0.95">
          <ellipse cx="34" cy="32" rx="22" ry="14"/>
          <ellipse cx="62" cy="26" rx="26" ry="18"/>
          <ellipse cx="90" cy="32" rx="20" ry="13"/>
          <ellipse cx="50" cy="36" rx="20" ry="11"/>
        </g>
      </svg>
    </div>
  `
    )
    .join("");

  return `
    <div class="pp-garden__sky" aria-hidden="true">
      ${constellationSvg}
      ${anchorStars}
      ${stars.join("")}
      ${moon}
      ${sun}
      ${clouds}
    </div>
  `;
}

function beeSvg() {
  // Small bumble: rounded yellow body with three black stripes, two
  // translucent wings, a stinger nub, and a hint of antennae.
  return `
    <svg viewBox="-15 -10 30 20" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
      <g class="pp-garden__pollinator-wing pp-garden__pollinator-wing--left">
        <ellipse cx="-1.5" cy="-4.5" rx="4.6" ry="2.7"
                 fill="rgba(255,255,255,0.6)" stroke="rgba(0,0,0,0.32)" stroke-width="0.3"/>
      </g>
      <g class="pp-garden__pollinator-wing pp-garden__pollinator-wing--right">
        <ellipse cx="1.5" cy="-4.5" rx="4.6" ry="2.7"
                 fill="rgba(255,255,255,0.6)" stroke="rgba(0,0,0,0.32)" stroke-width="0.3"/>
      </g>
      <ellipse cx="0" cy="0" rx="6.5" ry="3.9" fill="#f5c52a"/>
      <ellipse cx="-3.5" cy="0" rx="1.4" ry="3.7" fill="#1a1a1a"/>
      <ellipse cx="-0.4" cy="0" rx="1.4" ry="3.7" fill="#1a1a1a"/>
      <ellipse cx="2.8"  cy="0" rx="1.4" ry="3.7" fill="#1a1a1a"/>
      <circle cx="-5.5" cy="-0.6" r="0.7" fill="#1a1a1a"/>
      <path d="M -7 -0.4 Q -8 -1.6 -8.4 -3 M -6.6 -0.6 Q -7 -2.2 -7 -3.4"
            stroke="#1a1a1a" stroke-width="0.4" fill="none" stroke-linecap="round"/>
      <path d="M 6.5 0 L 8.2 0" stroke="#1a1a1a" stroke-width="0.55" stroke-linecap="round"/>
    </svg>
  `;
}

// Firefly: a small glowing mote — bright core, soft yellow-green halo.
// The green hue separates it visually from the cream stars overhead.
// Pulse animation lives in CSS on the wobble layer; SVG is the static
// look.
function fireflySvg() {
  return `
    <svg viewBox="-12 -12 24 24" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <circle cx="0" cy="0" r="10" fill="#b8ff90" opacity="0.18"/>
      <circle cx="0" cy="0" r="6"  fill="#b8ff90" opacity="0.55"/>
      <circle cx="0" cy="0" r="2.4" fill="#e8ffd2"/>
    </svg>
  `;
}

/* ============================================================== */
/*                              UTIL                               */
/* ============================================================== */

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Escape an id-like value safely for use in a CSS attribute selector
// (e.g. `[data-bid-id="<id>"]`). Bid IDs are UUIDs in practice but
// we still need to escape quotes and backslashes to be safe.
function cssId(s) {
  return String(s ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
