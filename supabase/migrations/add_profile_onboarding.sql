-- One nullable timestamp on profiles. Set when the user either
-- finishes or skips the onboarding tutorial. Null means "hasn't gone
-- through it yet" (or has hit the replay button to redo it). The
-- tutorial UI reads this on auth-callback / profile load to decide
-- whether to auto-start, and writes it on skip + complete.

alter table public.profiles
  add column if not exists onboarded_at timestamptz null;
