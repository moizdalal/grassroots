-- Single-use consultant signup invites. The raw token is only in the
-- link we send; the table stores its sha256 hash. The email column is
-- the only address allowed to redeem that link. School matching happens
-- at registration time, not on the invite.

create table if not exists public.consultant_invites (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint consultant_invites_email_chk check (email ~* '^[^@[:space:]]+@[a-z0-9.-]+\.edu$'),
  constraint consultant_invites_token_hash_unique unique (token_hash)
);

create index if not exists consultant_invites_email_idx
  on public.consultant_invites (email);

alter table public.consultant_invites enable row level security;

revoke all on table public.consultant_invites from anon;
revoke all on table public.consultant_invites from authenticated;
grant all on table public.consultant_invites to service_role;

comment on table public.consultant_invites is
  'Single-use consultant signup invites. Token is stored as a sha256 hash. Email is the only address that can redeem the link.';
