# consultant progression — parked

The "consultant progression" hero card on `/profile.html` was parked
on 2026-05-17 to remove its load-time cost. Live load was paying for:

- `model-viewer` ES module from Google CDN (~200 KB)
- `/assets/seedling.glb` 3D model (5.2 MB) — loaded eager
- An inline IIFE that reaches into `model-viewer`'s internal three.js
  scene to drive every clip on the shared AnimationMixer
- A `renderProgression()` pass on every consultant profile mount

What stayed alive:

- `/assets/seedling.glb` is still on disk (no request unless referenced)
- `plant-animations.css` still loads on `profile.html` (the garden
  section consumes it)
- `profile-seedling.css` is unlinked from `profile.html`, but the file
  still exists — `field-office.css` carries a few `.pf-stage-model`
  theme overrides that reference its class names. Safe to leave alone.

## To restore

1. Move `progression-section.html` back into `public/profile.html`
   in place of the `<!-- consultant progression: parked -->` marker.
2. Re-add the `<link rel="stylesheet" href="/profile-seedling.css" />`
   line in `<head>` (the model-viewer script tag is already inside
   `progression-section.html`).
3. Move `progression-page.js.snippet` contents back into
   `public/profile-page.js`:
   - Add `calculateStageProgress` and `renderProgression` (already in
     the snippet) where they used to live.
   - Re-add `renderProgression(profile, stats);` in `init()`'s
     consultant branch, right after `mountConsultantGarden(...)`.

Search markers in the live files:

| File | Marker |
|---|---|
| `public/profile.html` | `<!-- consultant progression: parked` |
| `public/profile-page.js` | `// consultant progression: parked` |
