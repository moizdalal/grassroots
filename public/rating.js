/* ================================================================
   Shared rating helper — renders the .gr-rating component and
   fetches consultant rating aggregates in single or batch mode.
   ================================================================ */

const ratingCache = new Map();
const inflightBatches = new Map();

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render a star-rating chip. Pass null for unrated consultants.
 * @param {{ rating_average: number|null, review_count: number }} rating
 * @param {{ size?: "sm"|"md"|"lg", showCount?: boolean, emptyLabel?: string }} options
 */
export function renderRatingMarkup(rating, options = {}) {
  const { size = "md", showCount = true, emptyLabel = "no ratings yet" } = options;
  const sizeClass = size === "sm" ? "gr-rating--sm" : size === "lg" ? "gr-rating--lg" : "";

  if (!rating || !rating.review_count || rating.rating_average == null) {
    return `<span class="gr-rating gr-rating--empty ${sizeClass}" title="${escapeHtml(emptyLabel)}">
      <span class="gr-rating__stars"><span class="gr-rating__fill" style="width:0%"></span></span>
      ${showCount ? `<span class="gr-rating__count">${escapeHtml(emptyLabel)}</span>` : ""}
    </span>`;
  }

  const avg = Math.max(0, Math.min(5, Number(rating.rating_average) || 0));
  const fillPct = (avg / 5) * 100;
  const count = rating.review_count;
  return `<span class="gr-rating ${sizeClass}" title="${avg.toFixed(2)} average across ${count} review${count === 1 ? "" : "s"}">
    <span class="gr-rating__stars" aria-hidden="true"><span class="gr-rating__fill" style="width:${fillPct.toFixed(1)}%"></span></span>
    <span class="gr-rating__value">${avg.toFixed(1)}</span>
    ${showCount ? `<span class="gr-rating__count">(${count})</span>` : ""}
    <span class="gr-sr-only">${avg.toFixed(2)} stars based on ${count} review${count === 1 ? "" : "s"}</span>
  </span>`;
}

/**
 * Fetch aggregate ratings for many consultants in one request.
 * Returns a Map<consultantId, { rating_average, review_count }>.
 */
export async function fetchRatingsBatch(consultantIds) {
  const ids = Array.from(new Set((consultantIds || []).filter(Boolean)));
  if (!ids.length) return new Map();

  const missing = ids.filter((id) => !ratingCache.has(id));
  if (!missing.length) {
    return new Map(ids.map((id) => [id, ratingCache.get(id)]));
  }

  const cacheKey = missing.slice().sort().join(",");
  let promise = inflightBatches.get(cacheKey);
  if (!promise) {
    promise = fetch(`/api/consultant-ratings?ids=${encodeURIComponent(missing.join(","))}`)
      .then((res) => (res.ok ? res.json() : { ratings: {} }))
      .catch(() => ({ ratings: {} }))
      .finally(() => inflightBatches.delete(cacheKey));
    inflightBatches.set(cacheKey, promise);
  }

  const { ratings } = await promise;
  for (const id of missing) {
    ratingCache.set(id, ratings?.[id] || { rating_average: null, review_count: 0 });
  }
  return new Map(ids.map((id) => [id, ratingCache.get(id)]));
}

/**
 * Fetch one consultant's rating (cached). Use the API helper for the rest of
 * the consultant profile if you need education/portfolio too.
 */
export async function fetchRatingFor(consultantId) {
  if (!consultantId) return null;
  const map = await fetchRatingsBatch([consultantId]);
  return map.get(consultantId) || null;
}

/** Inject ratings into already-rendered DOM nodes that have `data-consultant-rating="<id>"`. */
export async function hydrateRatings(scope = document) {
  const nodes = Array.from(scope.querySelectorAll("[data-consultant-rating]"));
  const ids = nodes.map((n) => n.dataset.consultantRating).filter(Boolean);
  if (!ids.length) return;
  const map = await fetchRatingsBatch(ids);
  for (const node of nodes) {
    const rating = map.get(node.dataset.consultantRating);
    const size = node.dataset.ratingSize || "sm";
    const showCount = node.dataset.ratingCount !== "false";
    node.innerHTML = renderRatingMarkup(rating, { size, showCount });
  }
}
