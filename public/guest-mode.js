// guest-mode.js — shared module that gates the "browse without an
// account" experience on /marketplace.html and /listing.html.
//
// Activated by ?guest=1 on the URL (the "see what's live" CTA on the
// landing page sets this) and persisted in sessionStorage so internal
// links — marketplace card → listing detail, listing → back to grid —
// don't have to rewrite every href to carry the flag. The flag clears
// when the tab closes (sessionStorage scope) or the moment a real auth
// session takes over (see clearGuestModeIfSignedIn below).
//
// We deliberately keep this synchronous and tiny so the inline
// pre-paint scripts in marketplace.html can call isGuest() before the
// page draws to decide whether to redirect or not.

const FLAG_KEY = "grassroots_guest_mode";

export function isGuest() {
  try {
    // URL param wins — entry from the landing CTA always activates
    // guest mode even if the tab was previously in a non-guest state.
    const params = new URLSearchParams(window.location.search);
    if (params.get("guest") === "1") return true;
    return window.sessionStorage?.getItem(FLAG_KEY) === "1";
  } catch (_) {
    return false;
  }
}

export function setGuestMode() {
  try {
    window.sessionStorage?.setItem(FLAG_KEY, "1");
  } catch (_) {}
}

export function clearGuestMode() {
  try {
    window.sessionStorage?.removeItem(FLAG_KEY);
  } catch (_) {}
}

// Append ?guest=1 to a same-origin URL if guest mode is active. Used
// by marketplace.js when wiring listing card hrefs so that even if a
// guest opens a card in a new tab (which would otherwise lose the
// sessionStorage flag) the destination still recognises them.
export function withGuestParam(href) {
  if (!isGuest()) return href;
  try {
    const url = new URL(href, window.location.origin);
    if (url.origin !== window.location.origin) return href;
    if (!url.searchParams.has("guest")) url.searchParams.set("guest", "1");
    return url.pathname + url.search + url.hash;
  } catch (_) {
    return href;
  }
}

// If a real Supabase session is present, guest mode is meaningless —
// drop the flag so the user gets the normal signed-in experience on
// subsequent navigations. Callers pass an awaited session; we don't
// import the client here to keep this module sync-friendly.
export function clearGuestModeIfSignedIn(session) {
  if (session?.user) clearGuestMode();
}

// Synchronous helper used by inline <script> blocks before the JS
// module graph loads. Mirrors isGuest() exactly. Inlined into the
// pre-paint script via a <script> tag in marketplace.html — kept here
// only for reference; the inline copy is the source of truth on those
// pages.
export function _readGuestFlagSync() {
  return isGuest();
}
