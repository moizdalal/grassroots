// guest-nav.js — top bar rendered above /marketplace.html and
// /listing.html when the viewer is in guest mode. Reuses the marketing
// nav (.ld-nav) so the visual language matches the landing page the
// guest just came from.
//
// Loads /home/nav.css on demand (the marketing pages already include
// it; the app pages don't), then injects the nav markup at the top of
// <body> and wires the theme toggle + scroll progress hairline. The
// nav swaps in three guest-only CTAs:
//   • "sign in"               → existing accounts
//   • "for students"          → /home/for-students.html (consultant
//                               application — invite-only, so we point
//                               curious consultants at the apply page
//                               rather than the open register flow)
//   • "post a project"        → /register.html?role=owner (the primary
//                               conversion target — most guests are
//                               assumed to be businesses)

import { isGuest, setGuestMode } from "/guest-mode.js";

const NAV_CSS_HREF = "/home/nav.css";
const GUEST_NAV_CSS_HREF = "/guest-nav.css";

function ensureStylesheet(href) {
  if (document.querySelector(`link[rel="stylesheet"][href="${href}"]`)) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.appendChild(link);
}

function renderNav() {
  const nav = document.createElement("nav");
  nav.className = "ld-nav gr-guest-nav";
  nav.id = "ld-nav";
  nav.setAttribute("aria-label", "Guest navigation");
  nav.innerHTML = `
    <div class="ld-nav__inner">
      <a class="ld-nav__brand" href="/" title="Grassroots — home">
        <span class="ld-nav__brand-mark" aria-hidden="true">
          <svg class="ld-sprout" viewBox="0 0 163 275" fill="currentColor" aria-hidden="true">
            <path transform="translate(72, 130)" d="M19 10.15C19 4.54431 14.7467 0 9.5 0C4.25329 0 0 4.54431 0 10.15C7.91804 91.2467 8.44249 120.691 0 134.85C0 140.456 4.25329 145 9.5 145C14.7467 145 19 140.456 19 134.85C16.2169 71.2734 12.3479 23.288 19 10.15Z"/>
            <path transform="translate(0, 65)" d="M84 87C21 71.5333 -6.5625 42.5333 1.3125 0C56.4375 3.86667 84 32.8667 84 87Z"/>
            <path transform="translate(82, 0)" d="M0 147C48.6 116.053 75.6 67.0526 81 0C27 5.1579 0 54.1579 0 147Z"/>
          </svg>
        </span>
        <span class="ld-nav__brand-text"><span>grassroots</span></span>
      </a>
      <ul class="ld-nav__links">
        <li class="gr-guest-nav__chip" aria-hidden="true">Browsing as guest</li>
        <li><a class="ld-nav__link" href="/signin.html">Sign in</a></li>
        <li class="ld-nav__hide-sm"><a class="ld-nav__link" href="/home/for-students.html">For students</a></li>
        <li>
          <button class="ld-nav__theme" id="ld-nav-theme" type="button" aria-label="Toggle dark mode" title="Toggle dark mode">
            <svg class="ld-nav__theme-sun" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="4.4" stroke="currentColor" stroke-width="1.8"/>
              <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
            </svg>
            <svg class="ld-nav__theme-moon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M20.5 14.5A8.5 8.5 0 1 1 9.5 3.5a7 7 0 0 0 11 11z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/>
            </svg>
          </button>
        </li>
        <li>
          <a class="ld-nav__cta" href="/register.html?role=owner">
            <span>Post a project</span>
            <span class="ld-nav__cta-arrow" aria-hidden="true">
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </span>
          </a>
        </li>
      </ul>
    </div>
    <div class="ld-nav__progress" aria-hidden="true">
      <div class="ld-nav__progress-fill" id="ld-nav-progress"></div>
    </div>
  `;
  document.body.insertBefore(nav, document.body.firstChild);
  return nav;
}

function wireThemeToggle() {
  const btn = document.getElementById("ld-nav-theme");
  if (!btn || !window.GrassrootsTheme) return;
  btn.addEventListener("click", () => {
    const cur = window.GrassrootsTheme.get();
    window.GrassrootsTheme.set(cur === "light" ? "dark-forest" : "light");
  });
}

function wireScrollChrome(nav) {
  const progress = nav.querySelector(".ld-nav__progress-fill");
  function update() {
    nav.classList.toggle("is-scrolled", window.scrollY > 8);
    if (progress) {
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const p = max > 0 ? window.scrollY / max : 0;
      progress.style.width = (p * 100).toFixed(2) + "%";
    }
  }
  update();
  window.addEventListener("scroll", update, { passive: true });
  window.addEventListener("resize", update);
}

function init() {
  if (!isGuest()) return;

  // Persist the flag now so internal links carry it without each page
  // having to re-read ?guest=1 from its own URL.
  setGuestMode();

  // Skip if a guest nav has already been injected (defensive — both
  // marketplace.html and listing.html load this module via <script>,
  // and a stray duplicate include shouldn't double-render the bar).
  if (document.querySelector(".gr-guest-nav")) return;

  ensureStylesheet(NAV_CSS_HREF);
  ensureStylesheet(GUEST_NAV_CSS_HREF);

  document.body.classList.add("gr-guest-body");

  const nav = renderNav();
  wireThemeToggle();
  wireScrollChrome(nav);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
