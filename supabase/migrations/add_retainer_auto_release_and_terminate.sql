-- Retainer simplification (2026-05-15):
--   * `auto_release` lets the owner opt into Stripe-driven release of each
--     period without a manual click. After invoice.paid lands and the row is
--     written to bid_phase_payments, the webhook fires the same transfer
--     logic the manual `/api/stripe/retainer/release-period` endpoint runs.
--   * `terminates_at` is an owner-set future cancellation moment. Mirrored
--     to Stripe via `subscriptions.update({ cancel_at })`; Stripe auto-cancels
--     the subscription when that timestamp hits.
--
-- `period_count` stays on the table for backward compat with rows created
-- under the old "fixed term" model, but new flows leave it null and treat
-- subscriptions as open-ended. The webhook auto-cancel-at-period_count
-- branch is removed in app.js.

alter table public.retainer_subscriptions
  add column if not exists auto_release boolean not null default false,
  add column if not exists terminates_at timestamptz;

-- Grants per the 2026-10-30 grants deadline note.
grant select, update on public.retainer_subscriptions to authenticated;
