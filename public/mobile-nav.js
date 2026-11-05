// mobile-nav.js — phone layout for the floating side nav.
// At ≤ 768px the .bza__side sidebar becomes an off-canvas drawer and
// a slim top bar (brand + menu button) takes its place. Works with
// both the injected side-nav.js sidebar and the dashboards' inline
// sidebars, so it waits for aside.bza__side to appear.
// The drawer always shows full labels: the desktop collapsed state is
// lifted while on a phone and restored when the viewport widens.

const MQ = window.matchMedia("(max-width: 768px)");
const COLLAPSE_KEY = "grassroots_dash_sidebar_collapsed";

const ICON_MENU =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
const ICON_CLOSE =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/></svg>';

function setup(side) {
  const shell = side.closest(".bza");
  if (!shell || shell.querySelector(".bza-mbar")) return;
  if (!side.id) side.id = "gr-side";

  const bar = document.createElement("div");
  bar.className = "bza-mbar";
  bar.innerHTML = `
    <a class="bza-mbar__brand" href="/" title="Grassroots — home">
      <img src="/home/assets/grassroots-icon-syne.svg" width="16" height="27" alt="" />
      <span>grassroots</span>
    </a>
    <button type="button" class="bza-mbar__toggle" aria-controls="${side.id}" aria-expanded="false" aria-label="Open menu">${ICON_MENU}</button>`;
  const scrim = document.createElement("div");
  scrim.className = "bza-mbar__scrim";
  scrim.setAttribute("aria-hidden", "true");
  shell.prepend(bar);
  shell.appendChild(scrim);

  const toggle = bar.querySelector(".bza-mbar__toggle");

  function setOpen(open) {
    shell.classList.toggle("bza--nav-open", open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    toggle.innerHTML = open ? ICON_CLOSE : ICON_MENU;
    document.documentElement.classList.toggle("gr-nav-locked", open);
  }

  function applyViewport() {
    if (MQ.matches) {
      shell.classList.remove("bza--collapsed");
    } else {
      setOpen(false);
      let collapsed = false;
      try { collapsed = localStorage.getItem(COLLAPSE_KEY) === "1"; } catch {}
      shell.classList.toggle("bza--collapsed", collapsed);
    }
  }

  toggle.addEventListener("click", () => setOpen(!shell.classList.contains("bza--nav-open")));
  scrim.addEventListener("click", () => setOpen(false));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && shell.classList.contains("bza--nav-open")) {
      setOpen(false);
      toggle.focus();
    }
  });
  // Dashboard nav items are in-page view switches, so close the drawer
  // on any nav click, not just on navigation.
  side.addEventListener("click", (e) => {
    if (MQ.matches && e.target.closest("a[href], .bza__nav-item")) setOpen(false);
  });
  MQ.addEventListener("change", applyViewport);
  // The dashboards apply the stored collapsed class after first render;
  // re-check once that has happened.
  applyViewport();
  requestAnimationFrame(applyViewport);
}

function init() {
  const existing = document.querySelector("aside.bza__side");
  if (existing) {
    setup(existing);
    return;
  }
  const obs = new MutationObserver(() => {
    const side = document.querySelector("aside.bza__side");
    if (side) {
      obs.disconnect();
      setup(side);
    }
  });
  obs.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
