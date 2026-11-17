# Account deletion — manual processing runbook

This document covers the manual steps an admin performs when a user requests account deletion via `/api/account/delete-request`. The v1 flow does **not** auto-delete; the API captures the request and notifies us, but we delete by hand to keep the blast radius small while the platform stabilizes.

## SLA

Per the privacy policy: deletion is processed within **14 days** of the request.

## When you get a deletion request

You'll receive a notification email at `PRIVACY_ADMIN_EMAIL` (defaults to `hello@grassroots.work`) with the user's ID and email. The user also receives a confirmation email saying we'll process the request within 14 days.

In the database, `profiles.deletion_requested_at` is set to the request timestamp. The user can still sign in until you process the deletion, but the settings page should display a "deletion requested" state (Phase 5 follow-up — not built yet).

## Pre-deletion checklist

Before running any destructive queries:

1. **Verify the request is legitimate.** Confirm the request came from the account owner's verified email. If the request looks suspicious, reply to the user from `hello@grassroots.work` and ask them to confirm.
2. **Check for open business.** Active engagements, pending payouts, in-flight Stripe payments. If anything is pending, email the user explaining the deletion will pause until the engagement closes.
3. **Snapshot, don't delete.** Take a CSV / JSON export of the user's data first (run the [data export process](./data-export-process.md)) and store it in our internal records bucket for 90 days in case of dispute.

## Deletion steps

Run these in order. The order matters because of foreign-key relationships.

### 1. Stripe — detach customer and disconnect connected account

If the user is a **business owner** with a Stripe Customer ID:

```bash
stripe customers delete <profiles.stripe_customer_id>
```

If the user is a **consultant** with a Stripe Connect account:

```bash
# This rejects the account, returning funds to the platform and preventing
# new payouts. Stripe retains the record for legal/financial-history reasons.
stripe accounts reject <profiles.stripe_account_id> --reason=other
```

Note the Stripe record IDs in the deletion log.

### 2. Storage — delete files

In Supabase Storage:

```sql
-- Get the file paths first so you can confirm they're the user's.
select name from storage.objects
 where bucket_id in ('avatars','resumes','portfolio','listing_attachments','proposals')
   and (owner = '<user_id>' or name like '<user_id>/%');
```

Then delete via the Supabase dashboard or the Storage API. We don't delete files attached to `bid_phase_payments` records that have a non-null `paid_at` — those are retained for the 7-year tax-records window.

### 3. Database — anonymize content, then delete the user

Run this as a transaction so partial failures don't orphan the account:

```sql
begin;

-- Anonymize free-text content the user wrote — keep the rows so the other
-- party's view of the conversation/listing stays coherent, but strip the
-- identity. The "deleted user" string is checked by the UI to render a
-- placeholder badge.
update public.messages
   set body = '[deleted by user]'
 where sender_id = '<user_id>';

update public.consultant_reviews
   set endorsement = '[deleted by user]',
       is_anonymous = true
 where owner_id = '<user_id>' or consultant_id = '<user_id>';

update public.marketplace_bids
   set message = '[deleted by user]'
 where consultant_id = '<user_id>';

update public.suggestions
   set body = '[deleted by user]',
       attachments = null,
       user_agent = null
 where user_id = '<user_id>';

-- For business-owner listings: mark "open" or "locked" listings as
-- unlisted so they stop appearing in the marketplace. Completed listings
-- stay (anonymized). The listings_guard_status_change trigger rejects
-- this while accepted work is active; settle or refund that work first.
update public.listings
   set status = 'unlisted',
       title = '[deleted listing]',
       problem_summary = null,
       details = null
 where owner_id = '<user_id>' and status in ('open','locked');

-- Clear PII on the profile row but keep the row (used by FK references in
-- anonymized messages/reviews above).
update public.profiles
   set full_name = 'deleted user',
       phone_number = null,
       linkedin_url = null,
       resume_path = null,
       avatar_path = null,
       -- Stripe IDs already detached above; null them here too.
       stripe_customer_id = null,
       stripe_account_id = null,
       stripe_payouts_enabled = false,
       stripe_charges_enabled = false
 where id = '<user_id>';

-- Hard-delete the role-specific profile rows (no FK references downstream).
delete from public.business_profiles where user_id = '<user_id>';
delete from public.consultant_profiles where user_id = '<user_id>';
delete from public.portfolio_items where user_id = '<user_id>';

-- Verify counts look reasonable before committing.
commit;
```

If anything looks off mid-transaction, `rollback` and investigate before re-running.

### 4. Auth — remove the Supabase user

This is the final step. Once the user record is deleted, the user can no longer sign in. Their email becomes available to register again (but no data carries over).

In the Supabase dashboard: **Authentication → Users → find by email → delete**.

Or via the admin API:

```js
await supabase.auth.admin.deleteUser('<user_id>');
```

### 5. Confirm to the user

Send a final confirmation email from `hello@grassroots.work`:

> Subject: your grassroots account has been deleted
>
> we've completed the deletion of your grassroots account as you requested. your personal information has been removed from our active systems. some records (transaction history, anonymized messages and reviews) are retained as described in our privacy policy.
>
> if you ever want to come back, you can sign up again with a fresh account.
>
> — grassroots

### 6. Log the deletion

Append a row to your internal deletion log (Google Sheet or similar) with: user ID, email (for cross-reference only — strip before sharing), request date, processed date, processed by, and whether any retained-record exceptions applied.

## What we keep

Documented in the privacy policy under "Data retention." Briefly:

- **Transaction records** (`bid_phase_payments`, Stripe records) — retained 7 years for US tax/financial reporting.
- **Anonymized messages and reviews** — retained while the other party's account is active.
- **Audit log entry** (user ID + dates only) — retained 7 years.

## What to do if the user comes back

If a deleted user signs up again with the same email:

1. The new signup is treated as a fresh account — no data is restored.
2. Anonymized messages/reviews from the deleted account stay anonymized.
3. The Stripe customer/account is **not** reused — Stripe creates fresh records.

## Future work

When request volume warrants it, automate this runbook. The endpoint code already captures the request and sets `deletion_requested_at`; the missing pieces are the Stripe API calls + the anonymize transaction + the user notification.
