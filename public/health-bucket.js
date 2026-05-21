// health-bucket.js — shared profile-completion visual.
// Renders an SVG bucket whose water level animates up to the completion %
// every time the panel mounts. Used by both /dashboard.html (owner) and
// /consultant-dashboard.html (consultant) so the two never drift visually.
//
// Coordinate notes for the math nerds:
//   • SVG viewBox: 0 0 140 170
//   • Bucket interior runs y=24 (under rim) → y=156 (rounded base) = 132u tall
//   • Wave paths position their water surface at y=24 in their own group
//     coordinate space, so translateY(0) = full bucket, translateY(132) = empty
//   • Inline --fill-offset is set to the target translateY for the current pct
//   • Keyframe interpolates from translateY(132) (empty) → translateY(--fill-offset)
//     so every mount replays the rise

const FILL_RANGE = 132; // inner-bucket height in viewBox units
const SURFACE_Y = 24;   // y-coordinate of the still-water surface inside the wave group

// Build a wavy path with multiple peaks/troughs alternating along x. The
// path extends well beyond the viewBox (x=-240 to 720) so the wave can
// translate horizontally without ever revealing an edge against the clip.
// Below the wavy top edge, the path fills down to y=240 (well below the
// bucket bottom) so the water reads as a solid column under any wave
// amplitude.
function buildWavePath({ baseY, amplitude, wavelength, startUp = true }) {
  const startX = -240;
  const endX = 720;
  let d = `M ${startX} ${baseY}`;
  // startUp=true → first control point is above the baseline (peak first),
  // false → trough first. SVG y is inverted (smaller = higher), so "up" is
  // baseY - amplitude.
  let dir = startUp ? -1 : 1;
  let x = startX;
  while (x < endX) {
    const nextX = x + wavelength / 2;
    const ctrlX = (x + nextX) / 2;
    const ctrlY = (baseY + dir * amplitude).toFixed(2);
    d += ` Q ${ctrlX.toFixed(1)} ${ctrlY} ${nextX.toFixed(1)} ${baseY}`;
    x = nextX;
    dir *= -1;
  }
  d += ` V 240 H ${startX} Z`;
  return d;
}

// Two wave layers at slightly different wavelengths/amplitudes for
// parallax. Each layer carries multiple peaks across the visible
// bucket width (~95px) so the surface reads as a "water surface" with
// crests + troughs, not a single hill sliding by. The X-drift +
// vertical bob animations in CSS combine with this multi-peak shape
// to make the surface visibly undulate rather than translate flatly.
const WAVE_BACK = buildWavePath({ baseY: SURFACE_Y, amplitude: 3.5, wavelength: 56, startUp: true });
const WAVE_FRONT = buildWavePath({ baseY: SURFACE_Y + 2.5, amplitude: 3, wavelength: 42, startUp: false });

// Forces the bucket's fill animation to restart from empty even when
// the browser dropped the initial frame during a busy mount. Call
// this on whatever element wraps the bucket markup right after the
// innerHTML is in place — the animation property is unset, a reflow
// is forced, then the property is restored, which the browser treats
// as a fresh animation start.
export function kickHealthBucketAnimation(root) {
  const water = root?.querySelector?.(".bza__health-bucket-water");
  if (!water) return;
  requestAnimationFrame(() => {
    water.style.animation = "none";
    // Reading offsetHeight forces a synchronous reflow so the browser
    // commits the "no animation" state before we re-enable it.
    void water.offsetHeight;
    water.style.animation = "";
  });
}

export function renderHealthBucket(health) {
  const pct = Math.max(0, Math.min(100, Math.round(Number(health?.pct) || 0)));
  // translateY(0) = water surface at viewport y=24 (full bucket).
  // translateY(132) = water surface at viewport y=156 (empty bucket).
  // For pct%, surface should be (1 - pct/100) of the way down the interior.
  const fillOffset = (FILL_RANGE * (1 - pct / 100)).toFixed(2);
  const done = Number(health?.done) || 0;
  const total = Number(health?.total) || 0;
  return `
    <div class="bza__health-bucket" role="img" aria-label="${pct}% profile complete">
      <svg viewBox="0 0 140 170" aria-hidden="true">
        <defs>
          <clipPath id="bz-bucket-clip">
            <path d="M 22 24 L 118 24 L 110 147 a 9 9 0 0 1 -9 9 L 39 156 a 9 9 0 0 1 -9 -9 Z" />
          </clipPath>
          <linearGradient id="bz-bucket-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="var(--fo-accent)" stop-opacity="0.78" />
            <stop offset="100%" stop-color="var(--fo-accent)" stop-opacity="0.96" />
          </linearGradient>
        </defs>

        <!-- Interior fill — use the page bg so the empty portion reads
             as a darker void behind the glass-thin outline, with strong
             contrast against the green water sitting in front of it. -->
        <path d="M 22 24 L 118 24 L 110 147 a 9 9 0 0 1 -9 9 L 39 156 a 9 9 0 0 1 -9 -9 Z"
              fill="var(--fo-bg)" />

        <!-- Water column. The outer group translates Y (the fill rise);
             each wave inside drifts horizontally + bobs vertically by a
             tiny amount on independent timing curves so the surface
             reads as undulating water rather than a sliding sheet. -->
        <g clip-path="url(#bz-bucket-clip)">
          <g class="bza__health-bucket-water" style="--fill-offset: ${fillOffset}px">
            <path class="bza__health-bucket-wave bza__health-bucket-wave--back"
                  d="${WAVE_BACK}" fill="url(#bz-bucket-grad)" />
            <path class="bza__health-bucket-wave bza__health-bucket-wave--front"
                  d="${WAVE_FRONT}" fill="var(--fo-accent)" fill-opacity="0.30" />
          </g>
        </g>

        <!-- Outline drawn on top so the rim sits over the water surface. -->
        <path d="M 22 24 L 118 24 L 110 147 a 9 9 0 0 1 -9 9 L 39 156 a 9 9 0 0 1 -9 -9 Z"
              fill="none" stroke="var(--fo-line-strong)" stroke-width="2.2"
              stroke-linejoin="round" stroke-linecap="round" />

        <!-- Reinforced rim cap + bail-attachment rivets — small details
             that read as "object" rather than "shape". -->
        <line x1="22" y1="24" x2="118" y2="24" stroke="var(--fo-line-strong)"
              stroke-width="3" stroke-linecap="round" />
        <circle cx="22" cy="24" r="1.8" fill="var(--fo-line-strong)" />
        <circle cx="118" cy="24" r="1.8" fill="var(--fo-line-strong)" />
      </svg>

      <div class="bza__health-bucket-center">
        <span class="bza__health-bucket-pct">${pct}<small>%</small></span>
        <span class="bza__health-bucket-fraction">${done} of ${total}</span>
      </div>
    </div>
  `;
}
