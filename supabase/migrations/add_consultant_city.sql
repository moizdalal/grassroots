-- Adds the consultant's home-base city for the marketplace "local" row.
-- Stored as three columns:
--   city      — display label "City, ST" exactly as picked from the autocomplete
--   city_lat  — numeric latitude (~5 decimals = ~1m precision; we only need ~1km)
--   city_lng  — numeric longitude
-- The autocomplete is backed by /data/us-cities.json (Census incorporated
-- places). Validation lives at the app layer.
--
-- Backfill: not applicable. Existing consultants leave the fields null;
-- the marketplace `local` row simply doesn't render for them until they
-- set a city via Settings → Personal.

alter table public.consultant_profiles
  add column if not exists city text,
  add column if not exists city_lat numeric(8, 5),
  add column if not exists city_lng numeric(8, 5);

-- Index on (city_lat, city_lng) helps any future ST_DWithin queries; for v1
-- the marketplace filters in JS but the index costs nothing to keep.
create index if not exists consultant_profiles_city_coords_idx
  on public.consultant_profiles (city_lat, city_lng)
  where city_lat is not null and city_lng is not null;

-- Required for new public-schema columns per the 2026-10-30 grants
-- deadline (see project_supabase_grants_deadline memory).
grant select, update on public.consultant_profiles to authenticated;
