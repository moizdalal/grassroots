# To Do — Pre-Launch

Everything that has to happen before the app opens to real users. Code changes from the privacy/compliance pass are done; what's left is operational work in third-party dashboards, content placeholders, and key rotation.

Detailed runbooks live in [`docs/privacy-launch-checklist.md`](./privacy-launch-checklist.md), [`docs/account-deletion-process.md`](./account-deletion-process.md), [`docs/data-export-process.md`](./data-export-process.md), and [`docs/breach-response.md`](./breach-response.md). This file is the at-a-glance checklist.

---

## 1. Privacy policy placeholders

Open `public/privacy.html` and replace every span tagged with the `pp-placeholder` class. Search for these strings:

- [ ] `[Legal Entity Name]` — your registered business name (LLC / Inc / sole proprietor as it appears on tax filings). Appears in §1 "Who we are" and §13 "Contact us".
- [ ] `[Business Address]` — postal address for legal notices. Registered-agent address or PO box is fine. Appears in §1 and §13.
- [ ] `[18 or 13 — confirm in Terms of Service]` — pick an age minimum. 18+ avoids COPPA + most state minor-data complications; 13+ is the lower bound under COPPA. Appears in §9 "Children".
- [ ] Bump `last updated:` at the top of the page if any other section changes.

---

## 2. Data Processing Agreements (DPAs)

One-click in each vendor dashboard. Required because we share personal data with them.

- [ ] **Stripe** — dashboard.stripe.com → Settings → Compliance → Data Processing Agreement → "I agree"
- [ ] **Supabase** — supabase.com/dashboard → Organization → Settings → Compliance → DPA → "Sign DPA"
- [ ] **Vercel** — vercel.com/dashboard → Settings → Privacy → DPA → "Accept DPA" (auto-applies on Pro/Enterprise)
- [ ] **Resend** (if/when installed) — dashboard.resend.com → Settings → Compliance → DPA

If you add a new sub-processor later (analytics, CRM, transactional email), sign their DPA first and add a row to the sub-processor table in `public/privacy.html`.

---

## 3. Geo-block verification on production

The EU geo-block is implemented but only fires when Vercel injects the `x-vercel-ip-country` header — i.e. on a deployed URL, not localhost. After deploy:

- [ ] From a US IP, load `https://www.grassroots-marketplace.com/` — should load normally.
- [ ] VPN to UK / Germany / France, hit the same URL — should return HTTP 451 and serve `region-unavailable.html`.
- [ ] From the VPN, hit `/privacy` — should still load (legal access required).
- [ ] From the VPN, hit `/region-unavailable.html` directly — should load.
- [ ] From the VPN, hit any `/api/*` endpoint — should return 451.

If the block doesn't fire from a VPN, confirm Vercel is forwarding the country header (default on Pro+; can be flaky on Hobby).

---

## 4. Email provider (Resend)

Confirmation emails for deletion/export requests currently log to stdout when `RESEND_API_KEY` isn't set. Without this, users don't receive the "we got your request" confirmation and you have to watch server logs to know a request came in.

- [ ] Install the **Resend** integration from the Vercel Marketplace (auto-provisions `RESEND_API_KEY`).
- [ ] In the Resend dashboard, verify a domain (e.g. `grassroots.work`).
- [ ] Set `RESEND_FROM_EMAIL` env var to a verified sender, e.g. `"Grassroots <hello@grassroots.work>"`.
- [ ] Optionally set `PRIVACY_ADMIN_EMAIL` if the admin inbox should differ from `hello@grassroots.work`.
- [ ] Trigger one deletion request as a test user and confirm both the admin and user emails arrive.

---

## 5. RLS audit

After the privacy migration is applied (already done), run the smoke test once more on the deployed Supabase project:

- [ ] `npm run verify:rls` — every private table should return `[OK]`. Investigate any `[FAIL]` before launch.
- [ ] Sign out and click through the deployed site as an anonymous visitor. Confirm no email, phone number, or address leaks into a marketplace listing, consultant profile, or public page.

---

## 6. Privacy contact inbox

The privacy policy lists `hello@grassroots.work` as the contact for privacy questions, deletion requests, and breach notifications.

- [ ] Confirm someone monitors that inbox daily (or set up a forwarder).
- [ ] Optional: create a dedicated `privacy@grassroots.work` alias for cleaner triage and update the privacy policy + `PRIVACY_ADMIN_EMAIL` env var to match.

---

## 7. Rotate every API key

All keys currently in use across local `.env`, the secondary `.env` at `/Users/moizdalal/Documents/New project/grassroots/.env`, and Vercel project environment variables. Rotate before launch so no developer-era key remains in production. After rotating, update Vercel env vars, then redeploy.

### Supabase

- [ ] **`SUPABASE_ANON_KEY` / `SUPABASE_PUBLISHABLE_KEY`** — supabase.com/dashboard → grassroots_real → Project Settings → API → "Reset anon key". Update in Vercel + local `.env`.
- [ ] **`SUPABASE_SERVICE_ROLE_KEY`** — same screen → "Reset service_role key". **Critical** — this key bypasses RLS. Anyone with it has full DB access. Update in Vercel + local `.env`.
- [ ] After rotating, sign out and back in once locally to confirm the new anon key works on the client side.

### Stripe

These need to move from **test mode** to **live mode** for launch, not just rotated. Per project notes the test keys are intentionally in prod during dev — that has to change.

- [ ] **`STRIPE_SECRET_KEY`** — dashboard.stripe.com → toggle "Live mode" → Developers → API keys → reveal live secret key. Update in Vercel + local `.env`. Test secret stays in dev.
- [ ] **`STRIPE_PUBLISHABLE_KEY`** — same screen, copy the live publishable key. Update in Vercel.
- [ ] **`STRIPE_WEBHOOK_SECRET`** — Developers → Webhooks → create a live-mode endpoint pointing to `https://www.grassroots-marketplace.com/webhooks/stripe` → copy the signing secret. Replace the current placeholder. Without this, the webhook endpoint will reject events.
- [ ] **Stripe Connect** — if you've been using a test platform account, set up the live Connect platform in dashboard.stripe.com → Connect → Settings before launch. Connect-related env vars (if any) follow the same rotation.
- [ ] Run `stripe listen` in test mode locally; verify a charge round-trips end-to-end with the new keys.

### Resend (after Section 4 is done)

- [ ] **`RESEND_API_KEY`** — dashboard.resend.com → API keys → rotate if any key was shared/committed before. The Vercel Marketplace integration provisions a fresh one when first installed, so this is only a rotation if you've been using a manual key.

### Anywhere else

- [ ] Search the repo for hardcoded secrets one more time: `grep -RIn -E "(sk_|pk_|service_role|whsec_)" --exclude-dir={node_modules,.git} .` — any non-env reference is a leak.
- [ ] Delete or rotate the secondary `.env` file at `/Users/moizdalal/Documents/New project/grassroots/.env` so old test keys don't linger on the laptop.
- [ ] Confirm `.env` is in `.gitignore` and that no `.env` file has ever been committed (`git log --all --full-history -- .env`).

---

## 8. Final pre-launch smoke

After everything above is done, run through the golden paths once on production-mode keys against a deployed preview URL:

- [ ] Register as a fresh business owner → confirm `terms_accepted_at` populates in `profiles`.
- [ ] Post a listing → confirm it appears in the marketplace and in the sitemap.
- [ ] Sign in as `test@gmail.com`/`test123test123` (then delete the test users before launch).
- [ ] Submit a deletion request → confirm `deletion_requested_at` populates and emails arrive.
- [ ] Submit a data export request → confirm `export_requested_at` populates and emails arrive.
- [ ] Dismiss the cookie banner once → confirm it stays dismissed across reloads.
- [ ] Trigger a real Stripe charge in live mode (use a real card with a small amount, e.g. $0.50 if your Stripe account allows it; refund immediately). Confirm the webhook fires and updates `bid_phase_payments`.
- [ ] Delete the test accounts created during smoke testing.

---

## Done

Once every box above is checked, you're clear to flip DNS / promote the deployment / announce. After launch, file new TODOs in this doc for follow-up cleanups (automated deletion, real data-export endpoint, etc.).
