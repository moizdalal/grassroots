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
- Voice rule: **sentence case, second person, ~10-word sentences, no exclamation points.** Only the `grassroots` wordmark/logo stays lowercase; in copy it's "Grassroots" / "Grassroots Marketplace". (The all-lowercase rule was retired 2026-10-24.) See brandkit.md for the full breakdown.
- Verify UI changes in the browser preview. Reload, take a screenshot, probe `getBoundingClientRect()` on key elements.

## In-flight state (sensitive to changes)

- **Payments (shipped to main 2026-10-23, PR #21) — not switched on yet.** Code + migration `add_delivery_release` are live. Still needed before money flows: two Stripe webhook endpoints at `https://www.grassroots-marketplace.com/api/webhooks/stripe` (platform events + connected-account events, API version `2026-04-22.dahlia`) and Vercel env `STRIPE_WEBHOOK_SECRET`, `STRIPE_WEBHOOK_SECRET_CONNECT`, `CRON_SECRET`, `PLATFORM_URL`. Until then the webhook answers "webhook secret not configured" and `/api/cron/auto-release` returns 503. Full model and event list: [stripe.md](./stripe.md).
- **Pricing (shipped to main 2026-10-24, PR #30):** all-in — the business pays exactly the offer. Consultant payout = offer − card fee − platform fee on the part above $10 (10% list, 5% launch: `LAUNCH_PLATFORM_FEE_BPS` in `lib/fees.js` + `public/fees.js`). Offers are $0 or ≥ $10. Free ($0) offers are consultant-only: never mention them on business-facing pages, help or marketing. A free accept is a $0 hold with no Stripe, so delivery/review/auto-close reuse the paid flow. Migration `allow_free_offers.sql` is applied to production (grassroots_real): `amount_cents >= 0` plus a trigger enforcing the $10 minimums on new or changed prices only. Legal questions about free work live in `docs/counsel-questions.md`, not on `/terms`.
- **Release rules (final, moiz):** consultant marks delivered → business has 14 days to release / request changes / contact support → auto-release. Retainer periods: window opens at period end. 90-day backstop flags for admin, never auto-releases. Retainers stop billing after `period_count` (Stripe `cancel_at`); the business can change the length. Copy anywhere on the site must match Terms §6.4.
- **Stripe API version gotcha:** stripe-node 22 pins `2026-04-22.dahlia`; invoices no longer have top-level `subscription` / `payment_intent` / `charge`. Use the helpers in `lib/stripe-compat.js`.
- **Money-moving code pattern:** every Stripe create takes an idempotency key; claim the DB row with a compare-and-set (`held → released/refunded`) before calling Stripe and roll back on failure. Don't add a transfer/refund path without both.
- **Legal (shipped 2026-10-24, PR #24/#25):** `/terms` and `/privacy` are live; signup requires the consent checkbox (stamps `profiles.terms_accepted_at`). Entity: grassroots marketplace LLC, a Florida LLC; mailing address is the registered agent (7901 4th St N, Ste 300, St. Petersburg, FL 33702). 22 `[counsel]` placeholders remain (arbitration, DMCA agent, agent-of-payee, etc.) — a lawyer reviews the week of 2026-10-26. Pages stay `noindex` until then. Legal pages use the `lg-` class prefix: `pp-` collides with profile styles in `field-office.css`.
- **US-only:** EU/EEA/UK/CH visitors are redirected at the Vercel edge (`vercel.json` `redirects` on `x-vercel-ip-country`) and by Express for the API. `/terms`, `/privacy`, Stripe webhooks and cron are exempt. Static pages never reach Express on Vercel, so edge rules in `vercel.json` are the real gate.
- **Unmerged work that touches the same files:** `moizdalal/support-screen` (admin held-payments screen, reported-problem outcomes, unapplied migration `add_support_outcomes.sql`) and daiel's home/about redesign PRs #22/#23 — all need rebasing onto main.
- **Landing page (`/home/`) rework planned** — the user is fully reworking this page. Defer landing-related design work until after their rework lands. The audit's old "for businesses / for consultants / how it works" recommendation is partially obsolete — the page has evolved.
- **Marketplace structural changes are sensitive** — the user has reverted prior structural edits there (e.g. the 3-tile `.mkt-stats` grid). They have specific opinions about marketplace shape. Ask before restructuring `index.html` or `marketplace.js`. Layer-only fixes (typography, spacing tokens, color tokens) are still fine without asking.

## Ongoing session memory

Per-session notes live in `.remember/` (recent.md, archive.md, core-memories.md). Those persist across sessions and capture in-flight work, deferred items, and the audit roadmap.
