-- Holds the raw create-listing form values while a listing is in
-- draft status, so the wizard can be reopened with exact prefill
-- (including partially-filled fields and unsubmitted attachments).
-- Cleared on publish. Only owners can read/write their own rows via
-- the existing listings RLS policy.
alter table public.listings
  add column if not exists draft_form jsonb;
