-- email_log — one row per email the server tries to send through Resend.
-- Feeds the admin "Emails" tab so support can watch volume against the
-- Resend plan limits (daily + monthly caps).
--
-- No addresses, subjects or bodies are stored: only what kind of email it
-- was, how it went, and when.
--
-- Write path: lib/email.js → logger registered in app.js (service role).
-- Read path:  GET /api/admin/emails (admin-gated, service role).

CREATE TABLE IF NOT EXISTS public.email_log (
  id BIGSERIAL PRIMARY KEY,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  event TEXT NOT NULL DEFAULT 'other',  -- notification event, or 'other'
  -- sent: Resend accepted it (counts toward the plan quota)
  -- failed: Resend refused it or the request errored (429 = over a limit)
  -- duplicate: same idempotency key within 24 hours, Resend skipped it
  status TEXT NOT NULL CHECK (status IN ('sent', 'failed', 'duplicate')),
  http_status INTEGER,
  environment TEXT,                     -- production | preview | development
  resend_id TEXT,
  error TEXT
);

CREATE INDEX IF NOT EXISTS email_log_sent_at_idx
  ON public.email_log (sent_at DESC);

-- Server-only table: the service role bypasses RLS, browsers get nothing.
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.email_log FROM anon, authenticated;
