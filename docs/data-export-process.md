# Data export — manual fulfillment runbook

This document covers the manual steps an admin performs when a user requests an export of their personal data via `/api/account/export-request`. The v1 flow does **not** auto-generate the export; the API captures the request, sets `profiles.export_requested_at`, and notifies us. We assemble the export by hand and send the user a secure download link.

## SLA

Per the privacy policy: export is fulfilled within **30 days** of the request.

## When you get an export request

You'll receive a notification email at `PRIVACY_ADMIN_EMAIL` (defaults to `hello@grassroots.work`) with the user's ID and email. The user also receives a confirmation email saying we'll send a download link within 30 days.

## Pre-export checklist

1. **Verify the request is legitimate.** Confirm the request came from the account owner's verified email. If suspicious, reply asking the user to confirm.
2. **Scope check.** A "data export" includes personal information *we hold about the requester*. It does **not** include other users' messages, the platform's aggregate metrics, or proprietary business data.

## Assembling the export

Run these queries as the service role in the Supabase SQL editor. Replace `<user_id>` with the requesting user's profile UUID.

### Account-level rows

```sql
-- Profile (PII, Stripe linkage, consent timestamps)
select * from public.profiles where id = '<user_id>';

-- Role-specific profile
select * from public.business_profiles where user_id = '<user_id>';
select * from public.consultant_profiles where user_id = '<user_id>';
```

### User-generated content the user wrote

```sql
-- Marketplace
select * from public.marketplace_listings where owner_id = '<user_id>';
select * from public.marketplace_bids where consultant_id = '<user_id>';
select * from public.bids where consultant_id = '<user_id>';

-- Messages they sent (only their side; do NOT include messages from other
-- users — that's the other person's data, not the requester's).
select id, listing_id, recipient_id, body, created_at
  from public.messages
 where sender_id = '<user_id>';

-- Reviews they wrote
select * from public.consultant_reviews
 where owner_id = '<user_id>';

-- Portfolio + suggestions
select * from public.portfolio_items where user_id = '<user_id>';
select id, body, page_url, created_at
  from public.suggestions where user_id = '<user_id>';

-- Engagement schedules they participated in
select * from public.engagement_schedules
 where owner_id = '<user_id>' or consultant_id = '<user_id>';
```

### Payment metadata

```sql
-- Phase payments / retainer subscriptions tied to bids they're a party to.
-- Stripe IDs only — we don't store card numbers.
select bpp.*
  from public.bid_phase_payments bpp
  join public.bids b on b.id = bpp.bid_id
 where b.consultant_id = '<user_id>'
    or b.listing_id in (
      select id from public.marketplace_listings where owner_id = '<user_id>'
    );

select * from public.retainer_subscriptions
 where bid_id in (
   select id from public.bids where consultant_id = '<user_id>'
 );
```

### Storage files

List file paths the user owns:

```sql
select bucket_id, name, created_at
  from storage.objects
 where bucket_id in ('avatars','resumes','portfolio','listing_attachments','proposals')
   and (owner = '<user_id>' or name like '<user_id>/%');
```

Download each file from the Supabase Storage UI or via the Storage API. Bundle them under a `files/` directory in the export ZIP.

## Packaging

Save query results as CSV (one file per query) or JSON, plus the file downloads:

```
grassroots-export-<user_id_first8>-<YYYY-MM-DD>.zip
├── profile.csv
├── business_profile.csv         (if applicable)
├── consultant_profile.csv       (if applicable)
├── marketplace_listings.csv
├── marketplace_bids.csv
├── bids.csv
├── messages_sent.csv
├── reviews.csv
├── portfolio_items.csv
├── suggestions.csv
├── engagement_schedules.csv
├── payment_records.csv
├── retainer_subscriptions.csv
├── README.txt                   (explain each file)
└── files/
    ├── avatars/...
    ├── resumes/...
    └── portfolio/...
```

## Delivering the export

1. Upload the ZIP to a private location (a Supabase Storage bucket with signed-URL access, or a Google Drive folder where you can generate a time-limited share link).
2. Generate a signed URL with a 7-day expiry.
3. Email the user from `hello@grassroots.work`:

> Subject: your grassroots data export is ready
>
> hi,
>
> as you requested, here's a copy of the personal data we have about you on grassroots. the download link below is valid for 7 days — please save the file locally if you want to keep it.
>
> [secure download link]
>
> the file is a zip with one csv per data category, plus a `files/` directory containing any documents you uploaded (resume, portfolio items, listing attachments). there's a README inside explaining what each file contains.
>
> if you have questions, reply to this email and we'll help.
>
> — grassroots

4. After delivery, clear `profiles.export_requested_at` (or leave for audit, but `null`-out if the user wants future requests to look fresh):

```sql
update public.profiles
   set export_requested_at = null
 where id = '<user_id>';
```

## Log the request

Append to the privacy log: user ID, email (for cross-reference), request date, fulfillment date, file size, retention bucket where the export ZIP lives.

## Future work

Automate steps 1-2 (the SQL queries can be a single stored function that returns JSON; the storage file list can be derived from the same function). Step 3 (delivery email) can use the existing `lib/email.js` once a signed-URL bucket is set up.
