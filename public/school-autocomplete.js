// Strict school autocomplete backed by /data/universities-us.json.
//
// Each instance wraps a search input, a hidden value input (which holds the
// canonical pick and is what the rest of the form reads), and a dropdown
// panel of matches. The user MUST select from the list — typing without
// picking leaves the hidden input empty so required-validation fails.
//
// Escape hatch: a sticky "school not listed" row at the bottom of the
// dropdown swaps the search input for a free-text input, and the hidden
// input takes whatever they type. Rows entered this way are flagged on
// write via a `school_other: true` field on the education entry (see
// register-flow.js) so we can audit data quality later.

const DATA_URL = "/data/universities-us.json";
const MAX_RESULTS = 10;

let cachedList = null;
let cachedPromise = null;

async function loadSchools() {
  if (cachedList) return cachedList;
  if (!cachedPromise) {
    cachedPromise = fetch(DATA_URL).then((r) => {
      if (!r.ok) throw new Error("could not load school list");
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

function scoreMatch(name, queryTokens) {
  const lower = normalize(name);
  if (!queryTokens.length) return 0;
  let score = 0;
  for (const tok of queryTokens) {
    const idx = lower.indexOf(tok);
    if (idx === -1) return -1;
    // Earlier matches score higher. Start-of-word matches score most.
    score += idx === 0 || lower[idx - 1] === " " ? 5 : 2;
    score -= Math.min(idx, 20) * 0.1;
  }
  return score;
}

function filterSchools(list, query) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  if (!tokens.length) return list.slice(0, MAX_RESULTS);
  const scored = [];
  for (const name of list) {
    const s = scoreMatch(name, tokens);
    if (s >= 0) scored.push([s, name]);
  }
  scored.sort((a, b) => b[0] - a[0] || a[1].localeCompare(b[1]));
  return scored.slice(0, MAX_RESULTS).map(([, n]) => n);
}

export function wireSchoolAutocomplete(root) {
  if (!root || root.dataset.acWired === "1") return;
  root.dataset.acWired = "1";

  const search = root.querySelector(".reg-edu-school-search");
  const hidden = root.querySelector(".reg-edu-school");
  const panel = root.querySelector(".reg-edu-school-ac__panel");
  const list = root.querySelector(".reg-edu-school-ac__list");
  const otherWrap = root.querySelector(".reg-edu-school-other-wrap");
  const otherInput = root.querySelector(".reg-edu-school-other");

  if (!search || !hidden || !panel || !list) return;

  let activeIndex = -1;
  let currentResults = [];

  function setHiddenValue(value, { otherFlag = false } = {}) {
    hidden.value = value || "";
    hidden.dataset.schoolOther = otherFlag ? "1" : "0";
    // Surface a `change` so any listener (validation, etc.) re-evaluates.
    hidden.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function renderList(results) {
    currentResults = results;
    activeIndex = -1;
    list.innerHTML = "";
    if (!results.length) {
      const empty = document.createElement("li");
      empty.className = "reg-edu-school-ac__empty";
      empty.textContent = "no matches.";
      list.appendChild(empty);
    } else {
      results.forEach((name, i) => {
        const li = document.createElement("li");
        li.className = "reg-edu-school-ac__item";
        li.dataset.index = String(i);
        li.textContent = name;
        list.appendChild(li);
      });
    }
    // Sticky "not listed" row.
    const notListed = document.createElement("li");
    notListed.className = "reg-edu-school-ac__item reg-edu-school-ac__item--other";
    notListed.dataset.index = "other";
    notListed.textContent = "my school isn't listed";
    list.appendChild(notListed);
  }

  function highlight(index) {
    list.querySelectorAll(".reg-edu-school-ac__item").forEach((el, i) => {
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

  function pickSchool(name) {
    setHiddenValue(name, { otherFlag: false });
    search.value = name;
    closePanel();
  }

  function pickNotListed() {
    // Swap to free-text mode.
    search.hidden = true;
    search.required = false;
    otherWrap.hidden = false;
    otherInput.focus();
    closePanel();
    setHiddenValue(otherInput.value.trim(), { otherFlag: true });
  }

  async function refresh() {
    const all = await loadSchools().catch(() => []);
    renderList(filterSchools(all, search.value));
    openPanel();
  }

  search.addEventListener("focus", refresh);
  search.addEventListener("input", () => {
    // Typing invalidates any prior pick — clear the hidden until they pick again.
    setHiddenValue("", { otherFlag: false });
    refresh();
  });

  search.addEventListener("keydown", (event) => {
    const items = [...list.querySelectorAll(".reg-edu-school-ac__item")];
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
    const item = event.target.closest(".reg-edu-school-ac__item");
    if (!item) return;
    event.preventDefault(); // keep focus on input
    if (item.dataset.index === "other") {
      pickNotListed();
    } else {
      const idx = Number(item.dataset.index);
      const name = currentResults[idx];
      if (name) pickSchool(name);
    }
  });

  // Close when focus leaves the wrapper.
  document.addEventListener("mousedown", (event) => {
    if (!root.contains(event.target)) closePanel();
  });
  search.addEventListener("blur", () => {
    // Defer so list mousedown can resolve first.
    setTimeout(closePanel, 120);
  });

  // Other (free-text) wiring.
  otherInput?.addEventListener("input", () => {
    setHiddenValue(otherInput.value.trim(), { otherFlag: true });
  });
}
