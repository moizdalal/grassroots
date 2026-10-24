// help.js — client-side help-center viewer.
// Fetches markdown from /help/*.md, renders with marked, swaps the article
// pane in place. Updates the URL hash for deep links + back-button support.

const ARTICLES = [
  { slug: "README", title: "Overview", group: "start" },
  { slug: "accounts-and-roles", title: "Accounts & roles", group: "start" },
  { slug: "profile-and-portfolio", title: "Your profile", group: "start" },

  { slug: "listings", title: "Listings", group: "businesses" },
  { slug: "reviews-and-ratings", title: "Reviews & ratings", group: "businesses" },

  { slug: "bids", title: "Bids", group: "consultants" },
  { slug: "stripe-onboarding", title: "Stripe onboarding", group: "consultants" },
  { slug: "stage-progression", title: "Stage progression", group: "consultants" },

  { slug: "engagements", title: "Engagements", group: "shared" },
  { slug: "payments-and-payouts", title: "Payments & payouts", group: "shared" },
  { slug: "messaging", title: "Messaging", group: "shared" },

  { slug: "policies", title: "Policies", group: "reference" },
];

const GROUP_LABELS = {
  start: "Getting started",
  businesses: "For businesses",
  consultants: "For consultants",
  shared: "Shared flows",
  reference: "Reference",
};

const navListEl = document.getElementById("help-nav-list");
const searchEl = document.getElementById("help-search");
const articleEl = document.getElementById("help-body");
const gateEl = document.getElementById("help-gate");

const articleCache = new Map();

function configureMarked() {
  if (typeof window.marked === "undefined") return;
  // Rewrite intra-doc links (e.g., ./reviews-and-ratings.md, payments.md#x)
  // so clicks stay in the SPA-style viewer instead of triggering a full
  // navigation to a raw .md file.
  const renderer = new window.marked.Renderer();
  const origLink = renderer.link.bind(renderer);
  renderer.link = ({ href, title, tokens, text }) => {
    if (!href) return origLink({ href, title, tokens, text });
    // Bare anchor (#section) → keep as-is, scrolls inside article
    if (href.startsWith("#")) return origLink({ href, title, tokens, text });
    // Mailto / external / absolute → keep as-is
    if (/^(mailto:|https?:|\/\/)/i.test(href)) return origLink({ href, title, tokens, text });
    // Internal markdown link like ./foo.md or foo.md#anchor → rewrite to slug
    const match = href.match(/^\.?\/?([\w-]+)(?:\.md)?(#[\w-]+)?$/);
    if (match) {
      const slug = match[1];
      const anchor = match[2] || "";
      return origLink({ href: `#${slug}${anchor}`, title, tokens, text });
    }
    return origLink({ href, title, tokens, text });
  };
  window.marked.use({ renderer, gfm: true, breaks: false });
}

function renderNav(filter = "") {
  const q = filter.trim().toLowerCase();
  const groups = {};
  for (const a of ARTICLES) {
    if (q && !a.title.toLowerCase().includes(q) && !a.slug.toLowerCase().includes(q)) continue;
    (groups[a.group] ||= []).push(a);
  }

  const order = ["start", "businesses", "consultants", "shared", "reference"];
  const active = activeSlug();
  const html = order
    .filter((g) => groups[g]?.length)
    .map((g) => {
      const items = groups[g]
        .map((a) => {
          const isActive = a.slug === active ? " is-active" : "";
          return `<a class="help-nav__item${isActive}" href="#${a.slug}" data-slug="${a.slug}">${escapeHtml(a.title)}</a>`;
        })
        .join("");
      return `<div class="help-nav__group">
        <p class="help-nav__group-label">${escapeHtml(GROUP_LABELS[g] || g)}</p>
        ${items}
      </div>`;
    })
    .join("");

  navListEl.innerHTML = html || `<p class="help-nav__empty">No matches</p>`;
}

function activeSlug() {
  const hash = window.location.hash.replace("#", "");
  const slug = hash.split("#")[0]; // strip nested anchor
  return ARTICLES.some((a) => a.slug === slug) ? slug : "README";
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

async function loadArticle(slug) {
  if (articleCache.has(slug)) return articleCache.get(slug);
  const res = await fetch(`/help/${encodeURIComponent(slug)}.md`, { cache: "no-cache" });
  if (!res.ok) throw new Error(`Couldn't load article: ${res.status}`);
  const md = await res.text();
  articleCache.set(slug, md);
  return md;
}

async function renderArticle(slug) {
  gateEl.hidden = false;
  gateEl.textContent = "Loading…";
  gateEl.className = "gr-status";
  articleEl.hidden = true;

  try {
    const md = await loadArticle(slug);
    if (!window.marked) {
      gateEl.textContent = "Couldn't load markdown renderer. Refresh the page.";
      gateEl.className = "gr-status error";
      return;
    }
    articleEl.innerHTML = window.marked.parse(md);
    articleEl.hidden = false;
    gateEl.hidden = true;
    // Scroll to nested anchor if the hash had one (e.g. #payments#bid-payment-states).
    const nested = window.location.hash.split("#")[2];
    if (nested) {
      const target = articleEl.querySelector(`#${CSS.escape(nested)}`);
      if (target) target.scrollIntoView({ behavior: "instant", block: "start" });
    } else {
      window.scrollTo({ top: 0, behavior: "instant" });
    }
    document.title = `grassroots — ${articleTitle(slug)}`;
    renderNav(searchEl.value);
  } catch (err) {
    gateEl.textContent = err.message || "Couldn't load this article.";
    gateEl.className = "gr-status error";
  }
}

function articleTitle(slug) {
  const a = ARTICLES.find((x) => x.slug === slug);
  return a ? `Help — ${a.title}` : "help";
}

function onHashChange() {
  renderArticle(activeSlug());
}

function bindEvents() {
  // Intercept nav clicks so we route in-page (the href already points at #slug,
  // but we still want to handle same-slug clicks to re-scroll to the top).
  navListEl.addEventListener("click", (e) => {
    const link = e.target.closest("[data-slug]");
    if (!link) return;
    const slug = link.dataset.slug;
    if (!slug) return;
    if (`#${slug}` === window.location.hash) {
      e.preventDefault();
      renderArticle(slug);
    }
  });

  // In-article internal links (we rewrote them to start with #slug in
  // configureMarked, so hashchange handles them). The anchor-only links
  // (#some-heading) scroll inside the current article — let the browser do it.
  articleEl.addEventListener("click", (e) => {
    const link = e.target.closest("a[href]");
    if (!link) return;
    const href = link.getAttribute("href") || "";
    // Open external links in a new tab.
    if (/^https?:\/\//i.test(href)) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  });

  searchEl.addEventListener("input", () => renderNav(searchEl.value));

  window.addEventListener("hashchange", onHashChange);
}

async function init() {
  configureMarked();
  renderNav();
  bindEvents();
  await renderArticle(activeSlug());
}

init();
