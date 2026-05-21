// avatar-cropper.js
// Lightweight square-crop modal for avatar uploads. Consultants and
// business owners both pick a photo in settings.html → personal tab;
// the actual upload only sees a 1:1 image regardless of source aspect.
//
// API:
//   cropToSquare(file, { outputSize = 512 }) → Promise<File | null>
// resolves with a square File (jpeg/png matching source) on confirm,
// or null when the user cancels / closes.
//
// The viewport itself is the crop area (no separate draggable frame)
// because the render target on every avatar surface is also a square
// 1:1 box. Drag pans the image; the slider zooms; bounds keep the
// image edges from exposing the viewport background.

const DEFAULT_OUTPUT = 512;
const VIEWPORT_PX = 300;   // CSS-pixel size of the visible crop square
const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export function cropToSquare(file, opts = {}) {
  const outputSize = opts.outputSize || DEFAULT_OUTPUT;
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = "async";
    img.onload = () => mountModal({ img, url, file, outputSize, done: resolve });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

function mountModal({ img, url, file, outputSize, done }) {
  const SQ = VIEWPORT_PX;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  // baseScale = smallest scale where the image still covers the
  // viewport on both axes. Zoom multiplies on top of this.
  const baseScale = Math.max(SQ / iw, SQ / ih);

  const modal = document.createElement("div");
  modal.className = "gr-photo-crop";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "gr-photo-crop-title");
  modal.innerHTML = `
    <div class="gr-photo-crop__backdrop" data-crop-action="cancel"></div>
    <div class="gr-photo-crop__card" role="document">
      <h2 id="gr-photo-crop-title" class="gr-photo-crop__title">frame your photo</h2>
      <p class="gr-photo-crop__hint">drag to reposition, slide to zoom. the square is what others see.</p>
      <div class="gr-photo-crop__viewport" data-vp>
        <img class="gr-photo-crop__img" alt="" />
        <span class="gr-photo-crop__frame" aria-hidden="true"></span>
      </div>
      <div class="gr-photo-crop__zoom">
        <span class="gr-photo-crop__zoom-icon" aria-hidden="true">−</span>
        <input type="range" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.01" value="1" class="gr-photo-crop__zoom-slider" data-zoom aria-label="zoom" />
        <span class="gr-photo-crop__zoom-icon" aria-hidden="true">+</span>
      </div>
      <div class="gr-photo-crop__actions">
        <button type="button" class="gr-btn gr-btn--ghost" data-crop-action="cancel">cancel</button>
        <button type="button" class="gr-btn gr-btn--primary" data-crop-action="confirm">use this photo</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const previousFocus = document.activeElement;
  const viewport = modal.querySelector("[data-vp]");
  const imgEl = modal.querySelector(".gr-photo-crop__img");
  const zoomSlider = modal.querySelector("[data-zoom]");

  imgEl.src = url;
  imgEl.style.transformOrigin = "0 0";
  imgEl.style.width = iw + "px";
  imgEl.style.height = ih + "px";

  // State + transform helpers. Everything is in CSS pixels in the
  // viewport's local coordinate space; the image draws at
  // translate(tx,ty) scale(scale) from origin (0,0).
  const state = { zoom: 1, tx: 0, ty: 0 };
  const getScale = () => baseScale * state.zoom;

  function clamp() {
    const s = getScale();
    const minTx = SQ - iw * s;
    const minTy = SQ - ih * s;
    if (state.tx > 0) state.tx = 0;
    if (state.tx < minTx) state.tx = minTx;
    if (state.ty > 0) state.ty = 0;
    if (state.ty < minTy) state.ty = minTy;
  }

  function apply() {
    clamp();
    const s = getScale();
    imgEl.style.transform = `translate(${state.tx}px, ${state.ty}px) scale(${s})`;
  }

  function center() {
    const s = getScale();
    state.tx = (SQ - iw * s) / 2;
    state.ty = (SQ - ih * s) / 2;
  }

  center();
  apply();

  // Pan via pointer drag. Pointer capture keeps the drag alive even
  // if the cursor leaves the viewport box.
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  viewport.addEventListener("pointerdown", (e) => {
    dragging = true;
    lastX = e.clientX;
    lastY = e.clientY;
    try { viewport.setPointerCapture(e.pointerId); } catch (_) {}
  });
  viewport.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    state.tx += dx;
    state.ty += dy;
    apply();
  });
  function endDrag(e) {
    dragging = false;
    try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
  }
  viewport.addEventListener("pointerup", endDrag);
  viewport.addEventListener("pointercancel", endDrag);

  // Zoom slider — anchor the zoom around the viewport center so the
  // user's framing stays put as they scale.
  zoomSlider.addEventListener("input", () => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, parseFloat(zoomSlider.value) || 1));
    const oldScale = getScale();
    state.zoom = next;
    const newScale = getScale();
    const cx = SQ / 2;
    const cy = SQ / 2;
    const imgX = (cx - state.tx) / oldScale;
    const imgY = (cy - state.ty) / oldScale;
    state.tx = cx - imgX * newScale;
    state.ty = cy - imgY * newScale;
    apply();
  });

  // Wheel zoom — anchor on the cursor point so trackpad / mouse wheel
  // feels natural. Step is multiplicative for smooth feel.
  viewport.addEventListener("wheel", (e) => {
    e.preventDefault();
    const rect = viewport.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const oldScale = getScale();
    const factor = e.deltaY < 0 ? 1.06 : 1 / 1.06;
    const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom * factor));
    if (nextZoom === state.zoom) return;
    state.zoom = nextZoom;
    const newScale = getScale();
    const imgX = (cx - state.tx) / oldScale;
    const imgY = (cy - state.ty) / oldScale;
    state.tx = cx - imgX * newScale;
    state.ty = cy - imgY * newScale;
    zoomSlider.value = String(state.zoom);
    apply();
  }, { passive: false });

  function cleanup(result) {
    document.removeEventListener("keydown", onKey);
    modal.remove();
    URL.revokeObjectURL(url);
    if (previousFocus && typeof previousFocus.focus === "function") {
      try { previousFocus.focus(); } catch (_) {}
    }
    done(result);
  }

  function exportBlob() {
    const s = getScale();
    // Visible crop area in image coordinates.
    const sx = -state.tx / s;
    const sy = -state.ty / s;
    const sw = SQ / s;
    const sh = SQ / s;

    const canvas = document.createElement("canvas");
    canvas.width = outputSize;
    canvas.height = outputSize;
    const ctx = canvas.getContext("2d");
    // White backstop in case the source has transparency and we end up
    // exporting jpeg — avoids surprise black corners.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, outputSize, outputSize);
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, outputSize, outputSize);

    const isJpeg = file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name || "");
    const outType = isJpeg ? "image/jpeg" : "image/png";
    const ext = isJpeg ? "jpg" : "png";
    const baseName = (file.name || "photo").replace(/\.[^.]+$/, "") || "photo";

    canvas.toBlob(
      (blob) => {
        if (!blob) { cleanup(null); return; }
        cleanup(new File([blob], `${baseName}.${ext}`, { type: outType }));
      },
      outType,
      isJpeg ? 0.92 : undefined
    );
  }

  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); cleanup(null); }
    if (e.key === "Enter") { e.preventDefault(); exportBlob(); }
  }
  document.addEventListener("keydown", onKey);

  modal.addEventListener("click", (e) => {
    const action = e.target.closest("[data-crop-action]")?.dataset.cropAction;
    if (!action) return;
    if (action === "cancel") cleanup(null);
    else if (action === "confirm") exportBlob();
  });

  // Focus the primary action so Enter confirms and the dialog is
  // immediately keyboard-operable.
  requestAnimationFrame(() => {
    const confirmBtn = modal.querySelector('[data-crop-action="confirm"]');
    if (confirmBtn instanceof HTMLElement) confirmBtn.focus();
  });
}
