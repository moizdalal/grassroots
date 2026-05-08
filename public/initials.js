/* ================================================================
   Avatar fallback initials. Always lowercase. Used everywhere a user
   or business doesn't have an avatar image: returns 1–2 letters
   derived from their display name.

   Examples:
     "Moiz Dalal"            → "md"
     "Alice"                 → "a"
     "Sequoia Strategies LLC"→ "sl"
     ""  (or null/undefined) → "?"
   ================================================================ */

export function getInitials(name) {
  const parts = String(name || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toLowerCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toLowerCase();
}

// Window-level export so non-module scripts (and inline pages) can use it
// without an import. Modules should still prefer the named export above.
if (typeof window !== "undefined") {
  window.getInitials = getInitials;
}
