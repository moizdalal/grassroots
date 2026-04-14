const SIMULATED_BUDGET_MAX = 110;

export function parseBudgetRange(detailsText) {
  const text = String(detailsText || "");
  const match = text.match(/^budget range:\s*\$(\d+)\s*to\s*\$(\d+)/im);
  if (!match) return null;

  const min = Number.parseInt(match[1], 10);
  const max = Number.parseInt(match[2], 10);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  return { min, max };
}

export function scaleBudgetRange(range, maxTop = SIMULATED_BUDGET_MAX) {
  if (!range) return null;

  const originalMin = Number(range.min);
  const originalMax = Number(range.max);
  if (!Number.isFinite(originalMin) || !Number.isFinite(originalMax)) return null;

  if (originalMax <= maxTop) {
    return {
      originalMin,
      originalMax,
      min: originalMin,
      max: originalMax,
      factor: 1,
    };
  }

  const factor = maxTop / originalMax;
  const scaledMax = maxTop;
  let scaledMin = Math.max(1, Math.round(originalMin * factor));

  if (scaledMin > scaledMax) {
    scaledMin = scaledMax;
  }

  return {
    originalMin,
    originalMax,
    min: scaledMin,
    max: scaledMax,
    factor,
  };
}

export function getSimulatedBudgetRange(detailsText, maxTop = SIMULATED_BUDGET_MAX) {
  return scaleBudgetRange(parseBudgetRange(detailsText), maxTop);
}

export function formatBudgetRange(range) {
  if (!range) return "";
  return `$${range.min}-$${range.max}`;
}

export { SIMULATED_BUDGET_MAX };
