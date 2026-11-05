// toast.js — app-wide toast notification primitive.
//
// Replaces the per-page inline status paragraphs (`gr-status` text under
// each form/button) with a single floating notification stack pinned to
// the bottom-right of the viewport. Any page can import + call:
//
//   import { showToast, showSuccess, showError } from "/toast.js";
//   showSuccess("availability shared.");
//   showError("could not confirm meeting time.");
//   showToast("vine hidden", { action: { label: "undo", onClick: ... } });
//
// The stack auto-mounts on first call, persists across page lifetime,
// stacks multiple toasts vertically (newest on top), and auto-dismisses
// each on its own timer (default 3.2s; errors get 4.5s; pass duration:0
// for sticky toasts that only dismiss via action click).

let stackEl = null;

// Identical toasts (same kind + text) fired within this window collapse
// into the one already on screen, so a double-fired handler or a retry
// loop doesn't stack copies.
const DEDUPE_MS = 2000;
const recent = new Map(); // `${kind}:${message}` -> { at, handle }

// One-shot toast carried across a navigation (e.g. "Listing posted."
// shown on the listing page after the create form redirects).
const FLASH_KEY = "gr-flash-toast";

function ensureStack() {
  if (stackEl && document.body && document.body.contains(stackEl)) return stackEl;
  stackEl = document.createElement("div");
  stackEl.className = "gr-toast-stack";
  stackEl.setAttribute("aria-live", "polite");
  stackEl.setAttribute("aria-atomic", "false");
  if (document.body) {
    document.body.appendChild(stackEl);
  } else {
    // Document not ready — defer mount until DOMContentLoaded.
    document.addEventListener(
      "DOMContentLoaded",
      () => document.body.appendChild(stackEl),
      { once: true }
    );
  }
  return stackEl;
}

const ICON_SUCCESS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="5 12 10 17 19 7"/></svg>`;
const ICON_ERROR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="7" x2="12" y2="13"/><line x1="12" y1="17" x2="12" y2="17.01"/></svg>`;
const ICON_INFO = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="12" y1="7" x2="12" y2="7.01"/></svg>`;
// CSS rotates this SVG so the loading toast reads as "in progress".
const ICON_LOADING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" opacity="0.25"/><path d="M21 12a9 9 0 0 0-9-9"/></svg>`;

function iconFor(kind) {
  if (kind === "success") return ICON_SUCCESS;
  if (kind === "error") return ICON_ERROR;
  if (kind === "loading") return ICON_LOADING;
  return ICON_INFO;
}

/**
 * Show a toast notification.
 * @param {string} message
 * @param {{ kind?: 'info'|'success'|'error', duration?: number, action?: { label: string, onClick?: () => void } }} [opts]
 * @returns {{ dismiss: () => void }}
 */
export function showToast(message, opts = {}) {
  const { kind = "info", action = null } = opts;
  // Loading toasts persist by default (caller dismisses when the
  // underlying work resolves). Errors stay a beat longer than info /
  // success so they're easy to read.
  const defaultDuration = kind === "loading" ? 0 : kind === "error" ? 4500 : 3200;
  const duration = opts.duration ?? defaultDuration;
  const key = `${kind}:${message}`;
  const prior = recent.get(key);
  if (prior && Date.now() - prior.at < DEDUPE_MS && !prior.handle.isDismissed()) {
    return prior.handle;
  }
  const stack = ensureStack();

  const toast = document.createElement("div");
  toast.className = `gr-toast gr-toast--${kind}`;
  toast.setAttribute("role", kind === "error" ? "alert" : "status");

  const icon = document.createElement("span");
  icon.className = "gr-toast__icon";
  icon.innerHTML = iconFor(kind);
  toast.appendChild(icon);

  const text = document.createElement("span");
  text.className = "gr-toast__text";
  text.textContent = message;
  toast.appendChild(text);

  let dismissed = false;
  let dismissTimer = null;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    clearTimeout(dismissTimer);
    toast.classList.remove("is-visible");
    toast.classList.add("is-leaving");
    // Match the CSS exit transition before removing from DOM.
    setTimeout(() => toast.remove(), 280);
  };

  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "gr-toast__action";
    btn.textContent = action.label;
    btn.addEventListener("click", () => {
      try { action.onClick?.(); } catch (_) {}
      dismiss();
    });
    toast.appendChild(btn);
  }

  // Always-available dismiss "×" so persistent or long-running toasts
  // can be cleared without waiting for the timer.
  const close = document.createElement("button");
  close.type = "button";
  close.className = "gr-toast__close";
  close.setAttribute("aria-label", "dismiss");
  close.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>`;
  close.addEventListener("click", dismiss);
  toast.appendChild(close);

  stack.appendChild(toast);
  // Trigger enter transition on the next frame so the browser applies
  // the resting (transparent + offset) state first.
  requestAnimationFrame(() => toast.classList.add("is-visible"));

  if (duration > 0) {
    dismissTimer = setTimeout(dismiss, duration);
  }

  // Pause the auto-dismiss while the user is hovering the toast — gives
  // them time to read longer messages without us yanking it.
  toast.addEventListener("mouseenter", () => {
    clearTimeout(dismissTimer);
  });
  toast.addEventListener("mouseleave", () => {
    if (duration > 0 && !dismissed) {
      dismissTimer = setTimeout(dismiss, Math.min(1500, duration));
    }
  });

  const handle = { dismiss, isDismissed: () => dismissed };
  recent.set(key, { at: Date.now(), handle });
  return handle;
}

/** Queue a toast to show on the next page load in this tab. */
export function flashToast(message, kind = "success") {
  try {
    window.sessionStorage?.setItem(FLASH_KEY, JSON.stringify({ message, kind }));
  } catch (_) { /* storage blocked — skip the flash */ }
}

try {
  const raw = window.sessionStorage?.getItem(FLASH_KEY);
  if (raw) {
    window.sessionStorage.removeItem(FLASH_KEY);
    const { message, kind } = JSON.parse(raw);
    // Wait for the page loader (loading-overlay.js) to leave, or the toast
    // would play out underneath it.
    const show = () => message && showToast(String(message), { kind: kind || "success" });
    const overlayUp = () => document.querySelector(".gr-loader-overlay");
    if (!overlayUp()) {
      show();
    } else {
      const poll = setInterval(() => {
        if (overlayUp()) return;
        clearInterval(poll);
        show();
      }, 150);
    }
  }
} catch (_) { /* malformed or blocked storage — ignore */ }

export function showSuccess(message, opts = {}) {
  return showToast(message, { ...opts, kind: "success" });
}

export function showError(message, opts = {}) {
  return showToast(message, { ...opts, kind: "error" });
}

export function showLoading(message, opts = {}) {
  return showToast(message, { ...opts, kind: "loading" });
}

export function showInfo(message, opts = {}) {
  return showToast(message, { ...opts, kind: "info" });
}
