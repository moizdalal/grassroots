-- email_log: record who each email went to and its subject, so the admin
-- Users drawer can list every email a person was sent. Bodies are still
-- not stored. Older rows stay null (sent before this column existed).
--
-- Write path: lib/email.js → logger in app.js (service role).
-- Read path:  GET /api/admin/users/:id (admin-gated, service role).
-- RLS stays on with no browser grants (see add_email_log.sql).

ALTER TABLE public.email_log ADD COLUMN IF NOT EXISTS to_email TEXT;
ALTER TABLE public.email_log ADD COLUMN IF NOT EXISTS subject TEXT;

CREATE INDEX IF NOT EXISTS email_log_to_email_idx
  ON public.email_log (to_email, sent_at DESC);
