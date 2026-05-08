/* Budget range helpers — used to be a simulator that scaled all
   displayed amounts down to a $110 cap (sandbox guardrail before
   Stripe was wired up). The cap is gone; budgets are shown exactly
   as the listing owner typed them. The filename is kept so the
   four callers (marketplace, listing, profile, create-listing) keep
   working without import-path churn. */

export function parseBudgetRange(detailsText) {
  const text = String(detailsText || "");
  const match = text.match(/^budget range:\s*\$(\d+)\s*to\s*\$(\d+)/im);
  if (!match) return null;

  const min = Number.parseInt(match[1], 10);
  const max = Number.parseInt(match[2], 10);
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;

  return { min, max };
}

export function formatBudgetRange(range) {
  if (!range) return "";
  return `$${range.min}-$${range.max}`;
}
