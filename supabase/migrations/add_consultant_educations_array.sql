-- Add a structured `educations` jsonb column on consultant_profiles so a
-- consultant can record multiple degrees (e.g., a BS plus an MBA, often
-- from different schools). Each element of the array is shaped:
--   { degree, major, minor, school }
-- where `degree` is one of:
--   associate's | bachelor's | master's | doctoral | certificate | other
-- Validation lives at the app layer — JSON check constraints are painful
-- to maintain and the write surface is server-controlled.
--
-- Backfill: existing rows get a single-element array constructed from the
-- legacy major/minor/school columns. The `degree` field is null on
-- backfilled entries (we don't have the old data) — the ui can prompt the
-- consultant to fill it in later.
--
-- The legacy major/minor/school columns stay for now. New write paths sync
-- the first array element back to them so any code still reading the flat
-- columns continues to work without changes.

alter table public.consultant_profiles
  add column if not exists educations jsonb not null default '[]'::jsonb;

update public.consultant_profiles
set educations = jsonb_build_array(
  jsonb_build_object(
    'degree', null,
    'major', major,
    'minor', minor,
    'school', school
  )
)
where educations = '[]'::jsonb
  and (
    coalesce(major, '') <> ''
    or coalesce(minor, '') <> ''
    or coalesce(school, '') <> ''
  );
