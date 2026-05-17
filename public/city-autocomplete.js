// city-autocomplete.js — strict US-city autocomplete backed by
// /data/us-cities.json (Census-derived, 19.5k incorporated places).
//
// Each instance wraps:
//   .reg-city-search  — visible text input
//   .reg-city         — hidden value "City, ST" (what the form submits)
//   .reg-city-lat     — hidden lat (for distance math)
//   .reg-city-lng     — hidden lng
//   .reg-city-ac__panel / .reg-city-ac__list — dropdown
//
// User MUST pick from the list — typing without picking leaves the
// hidden inputs empty so required-validation fails. No "not listed"
// escape hatch (the census set is comprehensive enough that any
// missing city is a data error worth surfacing).

const DATA_URL = "/data/us-cities.json";
const MAX_RESULTS = 10;

let cachedList = null;
let cachedPromise = null;

async function loadCities() {
  if (cachedList) return cachedList;
  if (!cachedPromise) {
    cachedPromise = fetch(DATA_URL).then((r) => {
      if (!r.ok) throw new Error("could not load city list");
      return r.json();
    });
  }
  cachedList = await cachedPromise;
  return cachedList;
}

function normalize(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function scoreMatch(city, queryTokens) {
  // Match against "name state" so users can type "san francisco ca".
  const haystack = `${city.n} ${city.s}`.toLowerCase();
  if (!queryTokens.length) return 0;
  let score = 0;
  for (const tok of queryTokens) {
    const idx = haystack.indexOf(tok);
    if (idx === -1) return -1;
    // Start-of-word > mid-word.
    score += idx === 0 || haystack[idx - 1] === " " ? 5 : 2;
    score -= Math.min(idx, 20) * 0.1;
  }
  return score;
}

function filterCities(list, query) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return list.slice(0, MAX_RESULTS);
  const scored = [];
  for (const city of list) {
    const s = scoreMatch(city, tokens);
    if (s >= 0) scored.push([s, city]);
  }
  scored.sort(
    (a, b) =>
      b[0] - a[0] ||
      a[1].n.localeCompare(b[1].n) ||
      a[1].s.localeCompare(b[1].s)
  );
  return scored.slice(0, MAX_RESULTS).map(([, c]) => c);
}

function formatLabel(city) {
  return `${city.n}, ${city.s}`;
}

export function wireCityAutocomplete(root) {
  if (!root || root.dataset.acWired === "1") return;
  root.dataset.acWired = "1";

  const search = root.querySelector(".reg-city-search");
  const hiddenLabel = root.querySelector(".reg-city");
  const hiddenLat = root.querySelector(".reg-city-lat");
  const hiddenLng = root.querySelector(".reg-city-lng");
  const panel = root.querySelector(".reg-city-ac__panel");
  const list = root.querySelector(".reg-city-ac__list");

  if (!search || !hiddenLabel || !panel || !list) return;

  let activeIndex = -1;
  let currentResults = [];

  function setHidden(city) {
    hiddenLabel.value = city ? formatLabel(city) : "";
    if (hiddenLat) hiddenLat.value = city ? String(city.lat) : "";
    if (hiddenLng) hiddenLng.value = city ? String(city.lng) : "";
    hiddenLabel.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderList(results) {
    currentResults = results;
    activeIndex = -1;
    list.innerHTML = "";
    if (!results.length) {
      const empty = document.createElement("li");
      empty.className = "reg-city-ac__empty";
      empty.textContent = "no matches.";
      list.appendChild(empty);
      return;
    }
    results.forEach((city, i) => {
      const li = document.createElement("li");
      li.className = "reg-city-ac__item";
      li.dataset.index = String(i);
      li.textContent = formatLabel(city);
      list.appendChild(li);
    });
  }

  function highlight(index) {
    list.querySelectorAll(".reg-city-ac__item").forEach((el, i) => {
      el.classList.toggle("is-active", i === index);
    });
  }

  function openPanel() {
    panel.hidden = false;
  }

  function closePanel() {
    panel.hidden = true;
    activeIndex = -1;
  }

  function pickCity(city) {
    setHidden(city);
    search.value = formatLabel(city);
    closePanel();
  }

  async function refresh() {
    const all = await loadCities().catch(() => []);
    renderList(filterCities(all, search.value));
    openPanel();
  }

  search.addEventListener("focus", refresh);
  search.addEventListener("input", () => {
    // Typing invalidates any prior pick — clear hidden until they re-pick.
    setHidden(null);
    refresh();
  });

  search.addEventListener("keydown", (event) => {
    const items = [...list.querySelectorAll(".reg-city-ac__item")];
    if (event.key === "ArrowDown") {
      event.preventDefault();
      activeIndex = Math.min(activeIndex + 1, items.length - 1);
      highlight(activeIndex);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
      highlight(activeIndex);
    } else if (event.key === "Enter") {
      if (activeIndex >= 0 && items[activeIndex]) {
        event.preventDefault();
        items[activeIndex].click();
      }
    } else if (event.key === "Escape") {
      closePanel();
    }
  });

  list.addEventListener("mousedown", (event) => {
    const item = event.target.closest(".reg-city-ac__item");
    if (!item) return;
    event.preventDefault(); // keep focus on input
    const idx = Number(item.dataset.index);
    const city = currentResults[idx];
    if (city) pickCity(city);
  });

  document.addEventListener("mousedown", (event) => {
    if (!root.contains(event.target)) closePanel();
  });
  search.addEventListener("blur", () => {
    setTimeout(closePanel, 120);
  });
}

/* Convenience: wire every `[data-city-autocomplete]` on the page. */
export function wireAllCityAutocompletes() {
  document.querySelectorAll("[data-city-autocomplete]").forEach((el) => {
    wireCityAutocomplete(el);
  });
}
