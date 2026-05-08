# grassroots — project memory

This file is loaded automatically into every Claude Code session in this repo. Keep it short; link out to longer references.

## Read this first

**[brandkit.md](./brandkit.md)** is the source of truth for design system rules — type, color, spacing, components, voice, accessibility, loading states. Any UI change should follow it. If you're adding a new token, component, or color, read brandkit.md before writing code, and update brandkit.md in the same commit.

## Stack snapshot

- Static-ish single-page HTML files in `public/` served by `server.js` (Express).
- JS is mostly vanilla ES modules. Auth and data via Supabase (`/supabase-loader.js`).
- Stylesheets cascade in this order: `grassroots.css` → `field-office.css` → page-specific (`listing.css`, `engagement.css`, `register-flow.css`, `home/index.css`).
- Theme is set on `<html data-theme="…">` by `theme.js` synchronously in head; tokens defined in `field-office.css` per theme. Themes: `dark-forest` (default), `forest-soft`, `dark`, `light`.
- A frosted page-loader overlay (`loading-overlay.js`) auto-injects on every page that imports it.
- A floating side-nav (`side-nav.js`) injects itself unless the page renders its own `aside.bza__side`.

## Test sign-in credentials (local dev)

- **Consultant** → `test@gmail.com` / `test123test123`
- **Business owner** → `testbiz@gmail.com` / `test123test123`

Use these to verify role-specific UI flows (owner-only action items on `dashboard.html`, consultant kickoff selection on `engagement.html`, etc.).

## Working conventions

- The user prefers concrete code changes over vague advice; they review at the end.
- They iterate on the spec ("scale this 5% smaller", "remove this border", "do XYZ instead") — don't over-engineer the first attempt.
- They're sensitive to: contrast issues in dark theme, off-theme colors (any red/orange that isn't `--fo-accent-warm` or `--fo-plan`), redundancy, orphaned spacing.
- Voice rule: **lowercase always, second person, ~10-word sentences, no exclamation points.** See brandkit.md for the full breakdown.
- Verify UI changes in the browser preview. Reload, take a screenshot, probe `getBoundingClientRect()` on key elements.

## In-flight state (sensitive to changes)

- **Stripe Connect (payout tab)** — UI is built and reads `profiles.stripe_account_id`, `stripe_payouts_enabled`, `stripe_charges_enabled`. The server endpoints `/api/stripe/connect/onboard` and `/api/stripe/connect/login-link` are still stubs that 404; the JS gracefully shows "coming soon" until they exist. Profile schema may need those columns added if not already present. Wire endpoints + columns before claiming the payout flow works end-to-end.
- **Landing page (`/home/`) rework planned** — the user is fully reworking this page. Defer landing-related design work until after their rework lands. The audit's old "for businesses / for consultants / how it works" recommendation is partially obsolete — the page has evolved.
- **Marketplace structural changes are sensitive** — the user has reverted prior structural edits there (e.g. the 3-tile `.mkt-stats` grid). They have specific opinions about marketplace shape. Ask before restructuring `index.html` or `marketplace.js`. Layer-only fixes (typography, spacing tokens, color tokens) are still fine without asking.

## Ongoing session memory

Per-session notes live in `.remember/` (recent.md, archive.md, core-memories.md). Those persist across sessions and capture in-flight work, deferred items, and the audit roadmap.
