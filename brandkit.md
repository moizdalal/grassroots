# grassroots brandkit

The single source of truth for how this product looks, sounds, and behaves. New work picks from these tokens and components — don't introduce parallel systems.

---

## Voice

Warm-direct. Lowercase always, second person, ~10-word sentences, no exclamation points.

- "use the email you registered with." — yes
- "Welcome Back! Sign In With The Email From Registration." — no
- "thanks for the note. we read all of these." — yes
- "Thank you for your feedback!" — no

Headers, page titles, button labels, status messages, empty states, placeholders — all lowercase. The only capitals are proper nouns (school names, brand names like "LinkedIn") and inside user-generated content.

---

## Typography

Two fonts, one rhythm:

- **Fraunces** (serif, weights 400/500/600/700/900, plus italic) — display, headings, hero numbers, italic title accents
- **Manrope** (sans, weights 400/500/600/700/800) — body, UI, labels, eyebrows

### Marketing-only exceptions

The marketing surface (`/`, `/home/about.html`, `/home/for-students.html`) is allowed two narrowly-scoped extra fonts. Anything outside these surfaces stays Fraunces + Manrope.

- **Caveat** (handwritten, weights 400/500/600/700) — founder signature on `about.html` only. Never use for headings, body, or any UI affordance.
- **JetBrains Mono** (mono, weights 400/500/600) — monospaced accent labels (e.g. timestamp stamps, "draft" stamps, code-style chips) on the marketing pages. Not for body text.

### Type scale tokens (defined in `:root` in `grassroots.css`)

| Token | Value | Use for |
|---|---|---|
| `--type-display` | `clamp(2rem, 4vw, 2.6rem)` | page H1 (Fraunces 600) |
| `--type-h1` | `clamp(1.5rem, 2.6vw, 1.85rem)` | section H1 |
| `--type-h2` | `clamp(1.15rem, 1.9vw, 1.35rem)` | card / sub-section heading |
| `--type-h3` | `1.05rem` | mini header / panel title strong |
| `--type-body` | `0.92rem` | paragraph |
| `--type-meta` | `0.8rem` | secondary info, captions |
| `--type-eyebrow` | `0.7rem` | uppercase tracker / kicker |

**Rule**: every `font-size` declaration uses one of these tokens. The only exceptions are:
- `em`-relative sizing inside `<code>` blocks (parent-scaled is intended)
- `calc()` expressions tied to other tokens (e.g. avatar font sizing)
- Landing-page hero clamps that exceed display max (kept raw — flagged for a future `--type-hero` token)

When you need to express "uppercase tracker" use `font-size: var(--type-eyebrow)` plus `text-transform: uppercase` and `letter-spacing: 0.08em–0.12em`.

---

## Spacing

| Token | Value |
|---|---|
| `--space-1` | `0.25rem` |
| `--space-2` | `0.5rem` |
| `--space-3` | `0.75rem` |
| `--space-4` | `1rem` |
| `--space-5` | `1.5rem` |
| `--space-6` | `2rem` |
| `--space-7` | `3rem` |

**Rule**: gap, padding, margin should pick from this scale. One-off magic rems are how rhythm drifts.

---

## Color

The product has one palette: moss green on cream/forest surfaces. It is theme-aware, not theme-agnostic — every color comes from a token that swaps per-theme.

### Themes

Set on `<html data-theme="…">` by `theme.js` synchronously in head. Tokens defined per-theme in `field-office.css`.

- `dark-forest` — moss-on-deep-forest (user-selectable)
- `forest-soft` — softer forest variant (user-selectable)
- `dark` — neutral dark (user-selectable; the dark-mode toggle in the side nav resolves *here*, not to `dark-forest`)
- `light` — neutral light (user-selectable)

**Default**: follows the OS `prefers-color-scheme` — `dark` for dark systems, `light` for light, updated live as the OS preference changes. An explicit user choice (saved to `localStorage.grassroots_theme`) always wins and disables the live OS-tracking until cleared.

### Theme tokens

| Token | Use |
|---|---|
| `--fo-bg` | page background |
| `--fo-surface` | card surface |
| `--fo-surface-2`, `--fo-surface-3` | nested surfaces (deeper as you go) |
| `--fo-text` | primary text |
| `--fo-text-2`, `--fo-text-3` | secondary, tertiary text |
| `--fo-line` | hairline border |
| `--fo-line-strong` | emphasized border |
| `--fo-accent` | brand moss green |
| `--fo-accent-on` | text color on top of `--fo-accent` |
| `--fo-accent-soft` | translucent accent fill (hover, soft chips, gradients) |
| `--fo-accent-warm` | warm orange — pending/warn state only |
| `--fo-plan` | warm coral — destructive only |
| `--fo-status-closed` | terminal red for "closed" / "cancelled" status dots — exists because `--fo-plan` collapses into `--fo-accent-warm` in the light theme |

### Banned

- Pure red (#cc0000-ish, `#c0392b`-class) — anywhere
- Random orange that isn't `--fo-accent-warm`
- Any color picked from outside this token set, except for guaranteed-contrast hovers (see below)

### Guaranteed-contrast exception

Primary button hover uses solid hex (`#b8e0c0` bg + `#14201a` text) because translucent token-based hovers blew out legibility in dark themes. If you ever need to bypass theme tokens for contrast, leave a code comment explaining why.

### Scoped illustration palettes

Illustrations that need colors the global token set doesn't carry (e.g. browns for soil/roots/wood) declare a small set of scoped CSS vars on the consuming component selector, with a `[data-theme="..."]` override block for per-theme variation. The vars stay component-local — they do NOT get promoted to `field-office.css`. Add a comment explaining why the brandkit's global tokens couldn't cover the case.

Canonical examples:
- `public/garden-stem.css` → `--gs-root`, `--gs-root-edge`, `--gs-soil-dot-color`
- `public/home/index.css` → `.ld-hero__garden { --ld-soil-line, --ld-soil-fill, --ld-soil-deep, --ld-soil-grain }`

### Card backgrounds — dark mode has none

In all dark themes (`dark`, `dark-forest`, `forest-soft`), card-shaped containers leave `background` unset (or `transparent`). Cards read as floating outlines defined by `--fo-line` borders + spacing, not as filled panels. Adding `var(--fo-surface)` / `--fo-surface-2` fills under cards in dark mode makes them disappear into the page or read as flat slabs — both reduce the visual hierarchy that the card metaphor is supposed to create.

Light theme keeps the fill because page background and card background need contrast to register as separate planes; on dark themes the border already does that work.

Pattern for scoping a card's fill to light theme only:

```css
.your-card {
  background: var(--fo-surface);
  border: 1px solid var(--fo-line);
  border-radius: 14px;
}
:root:not([data-theme="light"]) .your-card {
  background: transparent;
}
```

Applies to any container the team would call a "card", "panel", "callout", or "tile" — including `.bza__panel`, `.eng-list`, `.eng-actions`, `.gr-card`, and any new component you add.

---

## Components

The component primitives live in `grassroots.css`. Compose with their modifier classes — don't restyle from scratch.

### `.gr-pill` — status pill

Single class with kind modifiers, all theme-aware. Built-in dot indicator via `::before`.

| Modifier | When |
|---|---|
| `--accepted` / `--active` / `--live` | green, success state |
| `--pending` / `--warn` | warm orange |
| `--paused` | soft warm |
| `--closed` / `--completed` / `--muted` | grey |
| `--danger` | warm coral |
| `--no-dot` | drop the dot |

### `.gr-avatar` — universal avatar

One container + one img rule + size/shape/tone modifiers.

- Size: `--xs (1.6rem)` / `--sm (2rem)` / `--md (2.5rem)` / `--lg (3.5rem)` / `--xl (4.5rem)`
- Shape: `--round (50%)` / `--tile (12px)` / `--square (6px)`
- Tone: `--accent` (filled) / `--soft` (subtle)

Aliases (`.bza__user-avatar`, `.gr-bid-avatar`, `.pf-bv__avatar`, `.gr-listing-logo`, etc.) inherit from the same base. Don't add new aliases — pick a modifier instead.

**Fallback when no avatar image exists**: render the user/business's initials, **always lowercase**, via `getInitials(name)` from `/initials.js`. Two-word names → first + last initial (`"Moiz Dalal"` → `md`); single-word → first letter (`"Alice"` → `a`); empty/missing → `?`. Never use a person glyph (`👤`) or single uppercase letter — those patterns are deprecated.

### `.gr-btn` — buttons

Three canonical variants + modifiers:

| Variant | Use |
|---|---|
| `--primary` | filled accent — main CTA |
| `--secondary` | soft accent fill — secondary CTA |
| `--ghost` | transparent + line border — tertiary |
| `--danger` | ghost shape; coral on hover |

Modifiers: `--sm`, `--lg`, `--block`, `--pill` (default), `--square`, `--icon`.

Add `is-loading` to show an inline spinner (label hides, width preserved, click disabled). Works on `.gr-btn` and the `.inbox__composer-send` / `.gr-suggest-popup__submit` aliases.

**No pulsing/breathing CTAs.** Persistent prompts (e.g. "add headline", "set up payouts") draw attention through state and shape — dashed accent border, calm fill, accent text — not animation. Reserve motion for state changes (hover, click, on-mount), not idle loops.

### `.gr-empty-state` — empty state

Compact single-row format: small sprout glyph (via mask) + italic copy. Theme-aware via `--fo-text-2`. Respects `[hidden]`.

### `.gr-skeleton` — loading skeleton

Theme-aware shimmer placeholder using `--fo-surface-2` → `--fo-surface-3`. Modifiers: `--row`, `--line`, `--title`, `--avatar` (round 2.25rem), `--card`. Use `.gr-skeleton-stack` (grid wrapper) for composing multiple. Honors `prefers-reduced-motion`.

### Loading hierarchy

| Scope | Tool |
|---|---|
| First paint of a page | `loading-overlay.js` (auto-injected — full-screen frosted overlay with sprout, hides on `#…-gate` clear) |
| Partial load inside a panel | `.gr-skeleton` rows or cards |
| Action in flight on a button | `.is-loading` class on the button |

---

## Page shell

- `.gr-shell` — narrow content (max-width 560px)
- `.gr-shell--wide` — wide content (max-width 960px+)
- `.gr-page-intro` — eyebrow + title + subtitle stack
- `.gr-page-eyebrow` — `--type-eyebrow`, uppercase, accent color
- `.gr-title` — page H1 (Fraunces, sized via `--type-display` in `field-office.css` overrides)
- `.gr-subtitle` — page subtitle (Fraunces or Manrope per page)

Side nav (`.bza__side`) injects via `side-nav.js` unless the page renders its own `<aside class="bza__side">`. Loading overlay (`loading-overlay.js`) auto-injects on every page that imports it.

---

## Stylesheet cascade

Order matters. Always:

1. `grassroots.css` — tokens, components, base
2. `field-office.css` — theme tokens + theme-aware overrides
3. Page-specific (`listing.css`, `engagement.css`, `register-flow.css`, `home/index.css`)

When adding a new component primitive, put it in `grassroots.css`. When the look needs to swap per-theme, add the override in `field-office.css` under the appropriate `[data-theme="…"]` block. Don't duplicate component definitions in page-specific files.

---

## Accessibility

These are non-negotiable for new work.

### Focus rings

Every keyboard-focusable element has a visible focus state. The baseline rule in `grassroots.css` covers `a`, `button`, `summary`, `[role="button"]`, and `[tabindex]:not([tabindex="-1"])` with `outline: 2px solid var(--fo-accent); outline-offset: 2px`. Don't suppress with `outline: none` — if you need a custom focus, use `:focus-visible` and replace the ring, don't remove it.

Inputs/textareas/selects use the existing border-glow pattern (`border-color: var(--fo-accent); box-shadow: 0 0 0 3px var(--input-focus)`) and are intentionally exempt from the baseline rule.

### Hit targets

Minimum 32×32 for stand-alone interactive elements (per WCAG 2.5.5). Inline links inside text flow are exempt.

If a button is small for visual reasons (an icon button, a chip), expand the click area with padding + (optionally) a negative margin to preserve layout — don't shrink the visual.

### Disclosure widgets

Toggles that show/hide content need:
- `aria-expanded="false|true"` on the trigger (kept in sync via JS)
- `aria-controls="<id of the disclosure body>"`
- Native `<details>` is fine — it has built-in ARIA.

Toggle switches (binary on/off) use `aria-pressed` and an `aria-label` that names the action ("show password", "mark as read").

### Modal / overlay focus

When opening a modal (consultant viewer, suggestion box, payment modal, welcome popup), move keyboard focus into it (typically the close button) via `requestAnimationFrame`. On close, restore focus to whatever opened it. Track this with a small piece of state (e.g. `returnFocusEl`) — don't rely on the browser to figure it out.

Esc closes any modal. Arrow keys navigate within a slideshow when open.

### Motion

Respect `prefers-reduced-motion: reduce`. Long shimmer / spin animations should slow down or stop. Heavy transitions on bio collapses, side-nav slides, etc. should be wrapped in a `@media (prefers-reduced-motion: reduce)` override that sets `transition: none`.

---

## Forms

### Required-field asterisk

Native form controls auto-mark themselves: a `.gr-label` containing an `<input>`, `<textarea>`, or `<select>` with the `required` attribute gets a coral `*` (`--fo-plan`) appended to its label via CSS `::after`. Don't write the asterisk in HTML.

For custom controls (multi-select, file picker, anything that isn't a native `[required]` input), add `.gr-label--required` to the label to force the same asterisk:

```html
<div class="gr-label gr-label--required">
  <span>categories</span>
  <!-- custom control here -->
</div>
```

### Optional-field hint

Inside a label, mark optional fields with `<span class="gr-optional">optional</span>` — renders as `(optional)` in italic muted text after the label.

---

## Layout idioms

- **Cards**: `border: 1px solid var(--fo-line)` on `var(--fo-surface)` background, radius `12–16px`. Subtle shadow only when the card is interactive.
- **Inset surfaces**: nested cards/panels go to `--fo-surface-2`, then `--fo-surface-3` for the deepest layer.
- **Status row patterns**: eyebrow (uppercase tracker, --type-eyebrow) → value (Fraunces, --type-body or --type-h3, weight 600). See `.eg-meta__label` / `.eg-meta__value` for the canonical pair.
- **Money breakdown**: a short `<dl>` of label → amount rows, label in `--fo-text-2`, amount right-aligned with `tabular-nums`, last row (the total) weight 600. Negative lines use a real minus (`−$3.20`). See `.eg-delivery__breakdown` (refund after a give-back) and `.adm-pay-kv` on the admin payments drawer.
- **Page H1 + subtitle**: `gr-title` with `gr-subtitle` directly below. Don't add a third level above unless the page has a clear category (use `gr-page-eyebrow` for that).

---

## What to do when you're unsure

1. **First**: read this file. The answer is usually here.
2. **If a component looks like it could fit one of the primitives** (`.gr-pill`, `.gr-avatar`, `.gr-btn`, `.gr-empty-state`, `.gr-skeleton`) — use it. Don't make a parallel system.
3. **If you need a new color** — it doesn't exist. Use the closest theme token, or propose a token addition (with the per-theme overrides) before introducing one.
4. **If you need a font-size that isn't in the scale** — start by trying the nearest token. If you genuinely need something between, the answer is usually "make it the same as a neighbor for rhythm" rather than "add a new size."
5. **If you find yourself bypassing tokens for a quick fix** — leave a comment explaining why. Future you will thank present you.

---

## Known cascade traps

These have all caused real bugs. Check them first when a visual change isn't taking effect:

1. **Duplicate selectors across `grassroots.css` and `field-office.css`.** A few components (`.ms-*` multiselect, `.gr-search-bar*`) used to have stale rules in `grassroots.css` with hardcoded hex colors, while `field-office.css` had the newer theme-aware version. By source order, field-office.css wins at equal specificity — but if a grassroots.css rule has higher specificity it'll override and you'll see hardcoded colors leaking through on dark themes. **Pattern**: keep canonical theme-aware version in `field-office.css`, structural-only in `grassroots.css`. Don't reintroduce parallel definitions.

2. **`body.gr-body * { text-transform: none }` is a universal reset** that silently breaks any element trying to use `text-transform: uppercase`. The selector has specificity (1, 1) which beats single-class rules. To assert uppercase on a tracker (eyebrow, stat label, etc.), bump specificity (e.g. `body.gr-body .your-class`) or use `!important`. Already done for `.gr-section-h`.

3. **`[hidden]` doesn't always hide.** The HTML attribute's default is `display: none`, but rules like `.pf-layout { display: grid }` or `.gr-flex { display: flex }` override it because they have higher specificity than the UA `[hidden]` rule. When a hidden panel is still rendering, look for a `display:` rule on its other classes. Fix with an explicit `.your-class[hidden] { display: none !important }`.

---

## Files to touch carefully

These are the structural files. Edits propagate widely:

- `public/grassroots.css` — tokens, base, all `.gr-*` component primitives
- `public/field-office.css` — theme tokens, theme-aware overrides
- `public/theme.js` — applies `data-theme` synchronously in head
- `public/loading-overlay.js` — auto-injects the first-paint overlay
- `public/side-nav.js` — auto-injects the floating side nav

---

## Changelog discipline

When adding a new token or component, add a row to the relevant table in this file in the same commit. Brandkit drift is the original sin we're trying to prevent.
