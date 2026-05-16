# grassroots — full tech stack

A complete audit of every runtime, library, file convention, and external service this codebase touches.

## Runtime & language

- **Node.js** with **CommonJS** modules (`"type": "commonjs"` in package.json)
- Single `app.js` Express application (~41 KB, ~1100 lines) — handles every route, all auth/RBAC, all API integrations
- `server.js` is a thin entry that just calls `app.listen()` on `PORT` (default 3000)
- `api/index.js` is `module.exports = require("../app")` — the same app exposed as a Vercel serverless function

## Web framework

- **Express ^5.2.1** (Express 5 — Promise-aware, generic router)
- Middleware: `express.json()`, `express.urlencoded()`, `express.raw()` (for Stripe webhook signature verification), `express.static("public")`
- `multer ^2.1.1` for multipart uploads (resumes, attachments)
- No framework conventions — plain handler functions, raw SQL/RPC calls through Supabase

## Frontend

- **Static HTML files served from `public/`** — no SPA, no build step for most of it. Each route has its own `*.html` + `*.js` + `*.css`
- **Vanilla ES modules** loaded from the HTML via `<script type="module">`. Modules use `import` directly — no bundler for the main app
- **One React island**: `src/contract-help.tsx` (the contract-type chooser on `contract-help.html`). React 19 + ReactDOM, bundled by **esbuild** to `public/contract-help.js`
- **Page inventory** (`public/`, 60+ files): `register`, `signin`, `auth-callback`, `marketplace`, `listing`, `create-listing`, `engagement`, `engagement-journey`, `engagements`, `dashboard`, `consultant-dashboard`, `consultant-profile`, `consultant-resume`, `consultant-work`, `profile`, `my-reviews`, `payouts`, `notifications`, `inbox`, `help` (multi-page), `settings`, `listing-analytics`, plus `/home/` (landing) and `/help/` (markdown docs)

## Styling

- **CSS, hand-written**, no preprocessor, no Tailwind
- Cascade order: `grassroots.css` → `field-office.css` → page-specific (`listing.css`, `engagement.css`, `register-flow.css`, `home/index.css`, etc.)
- **Theme tokens** defined as CSS variables under `[data-theme="..."]` in `field-office.css`. Themes: `dark-forest` (default), `forest-soft`, `dark`, `light`. `theme.js` applies the saved theme to `<html>` synchronously in `<head>` to avoid flash
- **Brand system** documented in `brandkit.md` (the design source of truth) — typography (`Fraunces` + `Manrope`, Google Fonts), spacing scale, component patterns, voice rules

## Shared JS modules in `public/`

- `supabase-loader.js` — singleton that fetches `/api/public-config`, then creates a Supabase JS client from `https://esm.sh/@supabase/supabase-js@2.49.1` (ESM CDN)
- `theme.js`, `loading-overlay.js` (auto-injected page loader), `side-nav.js` (floating side-nav, auto-injects unless `<aside.bza__side>` exists), `nav-session.js`, `nav-notify.js`, `dashboard-notifications.js`, `toast.js`, `rating.js`, `initials.js`, `oauth.js`, `payment-modal.js`, `sim-budget.js`, `suggestion-box.js`, `health-bucket.js`

## Database & auth

- **Supabase** is the entire backend data layer
- `@supabase/supabase-js ^2.100.0` (server-side, service-role key)
- Browser client uses anon key via `getSupabaseClient()` → `/api/public-config`
- **Auth**: Supabase Auth (email/password + OAuth via Google/Microsoft/Apple in `signin.js`/`oauth.js`)
- **Schema files**: `supabase/schema.sql`, `setup.sql`, `setup_v2.sql`, plus topic-grouped files (`engagements_and_reviews.sql`, `listings_and_marketplace.sql`, `marketplace_bids.sql`, `marketplace_listings.sql`, `business_social_columns.sql`, `profile_avatar.sql`)
- **Migrations** (`supabase/migrations/`):
  - `add_business_address.sql`
  - `add_consultant_education_portfolio.sql`
  - `add_consultant_review_summary.sql`
  - `add_half_star_ratings.sql`
  - `add_listing_attachments.sql`
  - `add_listing_pause_status.sql`
  - `add_listing_views.sql`
  - `add_messaging_read_state.sql`
  - `add_profile_phone_number.sql`
  - `add_stripe_fields.sql`
- Storage buckets used: `avatars` (profile pics), `resumes`, listing attachments

## Payments

- **Stripe `^22.1.1`** (server SDK) + Stripe.js loaded client-side
- **Stripe Connect** — consultants onboard as Connect accounts; payments use destination charges (money goes to consultant at capture, release is bookkeeping, 0% platform fee currently)
- Webhook endpoint: `POST /webhooks/stripe` (raw body for signature verification, registered BEFORE `express.json()`)
- API routes:
  - `POST /api/stripe/account-session` (Connect onboarding)
  - `GET /api/stripe/account-status`
  - `POST /api/stripe/payment-intent`
  - `POST /api/stripe/confirm-acceptance`
  - `POST /api/stripe/release-funds`
- `STRIPE_WEBHOOK_SECRET` required; local dev uses `stripe listen --forward-to localhost:3000/webhooks/stripe`

## Server-side API surface

All routes live in `app.js`:

- `GET /` (root → home), `GET /health`
- `GET /api/public-config` — returns Supabase URL + anon key (and any other browser-safe config)
- `POST /api/register` — multipart form, accepts resume upload
- `POST /api/oauth-complete` — finalizes social sign-in profile
- `POST /api/profile/instagram-avatar` — uses `lib/instagram-profile-pic.js` (`syncInstagramProfileAvatar`)
- `GET /api/consultant-profile/:id`, `/api/consultant-profile/:id/resume`
- `GET /api/consultant-ratings`
- `GET /api/listings/:id/owner-bids`
- All Stripe routes listed above
- `/api/*` has a shared bearer-token middleware that validates the Supabase JWT and attaches the user to `req`

## Build / tooling

- **esbuild ^0.28.0** — only used to bundle `src/contract-help.tsx` into `public/contract-help.js`. Command in `package.json`:
  ```
  esbuild src/contract-help.tsx --bundle --format=esm --jsx=automatic --minify --outfile=public/contract-help.js
  ```
- `npm run dev` and `npm start` both just `node server.js` — no nodemon
- **TypeScript ^6.0.2** + **React ^19.2.5** / ReactDOM ^19.2.5 are devDependencies (used only by the contract-help TSX)
- No tests, no linter, no CI configured in this repo

## Hosting / deploy

- **Vercel** (linked, `.vercel/project.json` → `projectId: prj_UyAWh2WFpwJdsqeAxIKLYi8P2hxq`, `orgId: team_3DUNPsoLWWWDZ7z7Bi1TmZ1E`, name `grassroots`)
- `vercel.json`: `framework: null`, rewrites everything matching `/health`, `/api`, `/api/(.*)` to `api/index.js` (the serverless entry), which re-exports the same Express app. So Vercel runs the Express app as one big serverless function with `maxDuration: 60s`
- Static files served directly by Vercel from `public/`
- Vercel CLI installed locally

## External libraries / CDNs in the browser

- `https://fonts.googleapis.com/...Fraunces...Manrope...` — Google Fonts (Fraunces 400–700 italic+roman, Manrope 400–800)
- `https://esm.sh/@supabase/supabase-js@2.49.1` — browser-side Supabase client
- `https://ajax.googleapis.com/ajax/libs/model-viewer/4.0.0/model-viewer.min.js` — Google's `<model-viewer>` web component, used for the interactive 3D seedling on `/profile.html`
- Stripe.js loaded on payment pages

## Assets

- `public/assets/seedling.glb` — 3D seedling model used by stage 0 of consultant progression
- `public/home/assets/` — landing-page art (`grassroots-logo-syne.svg`, `logo.png`)
- `public/help/` — markdown help docs (`accounts-and-roles`, `bids`, `engagements`, `listings`, `messaging`, `payments-and-payouts`, `policies`, `profile-and-portfolio`, `reviews-and-ratings`, `stage-progression`, `stripe-onboarding`)
- `public/UIUX Context.pdf`, `PROJECT_CODE_MAP.md` (~14 KB code map), `README.md` (~3.5 KB)

## Project-specific / supporting

- **`.remember/`** — session memory (now.md, today-*.md, recent.md, archive.md, core-memories.md)
- **`brandkit.md`** — design system source of truth (must read before any UI change per CLAUDE.md)
- **`CLAUDE.md`** — project memory loaded into every Claude session
- **`PROJECT_CODE_MAP.md`** — codebase navigation aid
- **`.renders/`** — Blender source for the 3D assets (`build_seedling.py`, `seedling.blend`, `build_seed.py`, `seed.blend`)
- **`.env`** committed locally (gitignored), `.env.example` template

## Env vars (from `.env.example`)

```
PORT=3000
SUPABASE_URL=...
SUPABASE_SERVICE_ROLE_KEY=...
SUPABASE_ANON_KEY=...
STRIPE_SECRET_KEY=...
STRIPE_PUBLISHABLE_KEY=...
STRIPE_WEBHOOK_SECRET=...
```

## What's NOT here (worth noting)

- No frontend framework (Next.js / Vite / SvelteKit) — vanilla static + ES modules
- No CSS framework / Tailwind / shadcn
- No ORM — direct Supabase JS calls (`supabase.from().select()...`)
- No tests
- No CI/CD configuration in repo (Vercel handles deploy on push)
- No state-management library — auth state is rebuilt per page from Supabase session
- No analytics / observability tooling configured
- No TypeScript on the server side (only the one TSX file)

## In-flight / sensitive areas (per CLAUDE.md)

- **Stripe Connect (payout tab)** — UI exists; some server endpoints (`/api/stripe/connect/onboard`, `/api/stripe/connect/login-link`) are documented as stubs returning 404, though active Stripe routes exist in `app.js`. Worth verifying current state.
- **Landing page rework** planned — defer landing-related design changes
- **Marketplace structure** is sensitive — confirm before restructuring `marketplace.html` / `marketplace.js`
