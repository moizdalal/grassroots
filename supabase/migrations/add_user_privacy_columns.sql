-- Privacy-related tracking columns on profiles.
--
-- terms_accepted_at      — set by /api/register when the signup consent
--                          checkbox is submitted. NULL for users created
--                          before this column existed; the application
--                          treats NULL as "not yet accepted" and may show
--                          a re-consent prompt in the future.
-- deletion_requested_at  — set by /api/account/delete-request when a user
--                          asks to delete their account. The deletion
--                          itself is processed manually for v1 (see
--                          docs/account-deletion-process.md); this column
--                          drives the "deletion requested" status badge
--                          on the settings page.
-- export_requested_at    — set by /api/account/export-request when a user
--                          asks for a portable copy of their data. Also
--                          fulfilled manually for v1 (see
--                          docs/data-export-process.md).

alter table public.profiles
  add column if not exists terms_accepted_at      timestamptz,
  add column if not exists deletion_requested_at  timestamptz,
  add column if not exists export_requested_at    timestamptz;
