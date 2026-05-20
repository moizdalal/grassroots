-- The kickoff scheduler writes `duration_minutes` into engagement_schedules
-- on every owner-availability save. The column was never added when the
-- frontend started referencing it, so every save errored out with PGRST204
-- ("could not find the 'duration_minutes' column in the schema cache").
-- engagement.js's isMissing() helper matches that message and silently
-- falls back to local-only storage, so the owner's UI looked fine but the
-- DB row kept its empty owner_availability.slots — and the consultant (or
-- the owner on reload) saw an empty calendar.

alter table public.engagement_schedules
  add column if not exists duration_minutes integer not null default 30;

alter table public.engagement_schedules
  drop constraint if exists engagement_schedules_duration_minutes_check;

alter table public.engagement_schedules
  add constraint engagement_schedules_duration_minutes_check
  check (duration_minutes in (30, 60, 90));

notify pgrst, 'reload schema';
