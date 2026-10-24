# Privacy & compliance — launch checklist

Items to complete before opening grassroots to real users. The application-code changes are done; these are the operational items that require you to act in third-party dashboards or fill in legal placeholders.

## Required before launch

### 1. Apply the Supabase migration

The privacy work added three columns to `profiles`. Until the migration is applied, signup, deletion request, and export request will silently fail to write the timestamps.

- File: `supabase/migrations/add_user_privacy_columns.sql`
- Adds: `terms_accepted_at`, `deletion_requested_at`, `export_requested_at` (all `timestamptz`)
- Apply via Supabase MCP (`apply_migration`) or the Supabase dashboard SQL editor.

After applying, re-run signup locally to confirm `terms_accepted_at` populates.

### 2. Fill in privacy policy placeholders

`public/privacy.html` has placeholders highlighted with the `pp-placeholder` class. Search the file for `[Legal Entity Name]` and `[Business Address]` and replace:

- **Legal entity name** — your registered LLC / Inc / sole-proprietor name as it appears on tax filings.
- **Business address** — a postal mailing address for legal notices. A registered-agent address or PO box is fine.
- **Age threshold** — search for `[18 or 13 — confirm in Terms of Service]` and pick one. 18+ avoids COPPA + most state minor-data complications; 13+ is the lower bound under COPPA.

### 3. Sign DPAs (Data Processing Agreements)

Each sub-processor needs a signed DPA on file. These are one-click in each vendor's dashboard:

| Vendor | Where |
|---|---|
| **Stripe** | dashboard.stripe.com → Settings → Compliance → Data Processing Agreement → "I agree" |
| **Supabase** | supabase.com/dashboard → Organization → Settings → Compliance → DPA → "Sign DPA" |
| **Vercel** | vercel.com/dashboard → Settings → Privacy → DPA → "Accept DPA" (auto-applies on Pro/Enterprise) |

If you add new sub-processors later (Resend, an analytics tool, etc.), sign their DPA before turning them on and add a row to the privacy policy's sub-processor table.

### 4. Verify the geo-block on a deployed environment

The block is implemented in `app.js` reading the `x-vercel-ip-country` header that Vercel injects. Local dev doesn't carry this header so the block is inert there. Once deployed:

- From a US IP: hit `https://www.grassroots-marketplace.com/` — should load normally.
- From a UK / EU IP (VPN): hit the same URL — should return HTTP 451 and serve `region-unavailable.html`.
- From a UK / EU IP: hit `https://www.grassroots-marketplace.com/privacy` — should still load (legal access required).
- From a US IP: hit `https://www.grassroots-marketplace.com/region-unavailable.html` directly — should still load (it's a real page).

If the block doesn't fire from a VPN, double-check that Vercel is forwarding the header (it does by default on Pro+; on Hobby there can be edge cases).

### 5. Set the privacy admin email

Add `PRIVACY_ADMIN_EMAIL=hello@grassroots.work` to your Vercel project environment if you want it explicit; otherwise the code defaults to `hello@grassroots.work`. Verify someone monitors that inbox — deletion and export requests land there.

## Recommended before launch

### 6. Wire Resend for outbound email

Without an email provider, deletion-request and export-request confirmations log to stdout but don't reach the user or the admin inbox. To enable real emails:

- Install the **Resend** integration from the Vercel Marketplace. It auto-provisions `RESEND_API_KEY`.
- In the Resend dashboard, verify a domain (e.g. `grassroots.work`) so you can send from `hello@grassroots.work`.
- Set `RESEND_FROM_EMAIL` to your verified sender, e.g. `"Grassroots <hello@grassroots.work>"`.

Once these env vars are set, `lib/email.js` will start sending real emails on the next deploy.

### 7. Run the RLS verification script

After the migration is applied, run:

```bash
npm run verify:rls
```

This connects to Supabase as the anon role and confirms each private table returns 0 rows (or a permission error). Any `[FAIL]` line is a config gap to fix before launch.

### 8. Audit the public surface

Visit the deployed site signed-out and click through every page. Confirm:

- Nothing exposes a user's email, phone number, or address to anonymous visitors.
- The marketplace listings page shows only what the owner intended to make public (business name, listing details, attachments).
- Consultant profiles only show the parts marked public.

If anything PII-shaped slips through, file a ticket and fix the underlying RLS policy or query.

## Operational items (post-launch)

These can wait until you have your first deletion/export request:

- **Deletion runbook:** `docs/account-deletion-process.md` — the SQL/Stripe steps to manually fulfill a deletion request.
- **Export runbook:** `docs/data-export-process.md` — the queries to assemble a portable data copy.
- **Breach response:** `docs/breach-response.md` — what to do if a security incident occurs. Fill in the contacts table before you need it.

## When you change anything

- New sub-processor (analytics, transactional email, CRM, etc.): add a row to the sub-processor table in `public/privacy.html`, sign their DPA, and update the privacy policy's "last updated" date.
- New PII-collecting field on a form: update the privacy policy's "what we collect" section in the same PR.
- New cookie or localStorage key: add it to the cookie table in `public/privacy.html`.
- Material change to data handling: bump "last updated" + email existing users a heads-up if the change reduces their rights.
