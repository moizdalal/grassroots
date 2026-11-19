-- Student applications from /home/for-students.html. Consultant signup is
-- invite-only: a student applies here, the admin reviews, then sends a
-- consultant invite (consultant_invites) to the same .edu address.
--
-- Write path: POST /api/student-application (service role).
-- dedupe_key is sha256(email + project), so a double click or a resubmit
-- of the same application saves one row.

create table if not exists public.student_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,
  school text not null,
  email text not null,
  city text not null,
  major text not null,
  extras jsonb not null default '[]'::jsonb,  -- [{ type, name }]: second major, minor, etc.
  link text,
  project text not null,
  -- new: waiting for review · invited: sent a consultant invite · declined
  status text not null default 'new' check (status in ('new', 'invited', 'declined')),
  confirmation_sent_at timestamptz,  -- when the "we got your application" email went out
  dedupe_key text not null,
  constraint student_applications_dedupe_key_unique unique (dedupe_key),
  constraint student_applications_email_chk check (email ~* '^[^@[:space:]]+@[a-z0-9.-]+\.edu$')
);

create index if not exists student_applications_created_at_idx
  on public.student_applications (created_at desc);
create index if not exists student_applications_email_idx
  on public.student_applications (email);

-- Server-only table: the service role bypasses RLS, browsers get nothing.
alter table public.student_applications enable row level security;
revoke all on table public.student_applications from anon;
revoke all on table public.student_applications from authenticated;
grant all on table public.student_applications to service_role;

comment on table public.student_applications is
  'Student applications from /for-students. Reviewed by the admin, who replies with a consultant invite.';
