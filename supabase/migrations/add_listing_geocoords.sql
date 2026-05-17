-- Adds lat/lng to listings so the marketplace "local" bucket can filter
-- listings within ~50mi of a consultant's home city (consultant_profiles.city_*).
--
-- Source of coordinates: server-side geocode of `business_address` at
-- listing-create / listing-update time, via the free US Census Geocoder.
-- Stored as plain numerics (no PostGIS dependency — distance is a JS
-- Haversine in renderListings(), which is cheap enough for the row counts
-- we expect on the marketplace page).
--
-- Backfill: not applicable. Existing listings remain with null coords;
-- they participate in the normal category buckets but are skipped by the
-- "local" filter until they're saved again (which re-geocodes them).

alter table public.listings
  add column if not exists lat numeric(8, 5),
  add column if not exists lng numeric(8, 5);

-- Composite index helps any future ST_DWithin queries; for v1 the
-- marketplace filters in JS but the index costs nothing to keep.
create index if not exists listings_coords_idx
  on public.listings (lat, lng)
  where lat is not null and lng is not null;

-- Required for new public-schema columns per the 2026-10-30 grants
-- deadline (see project_supabase_grants_deadline memory).
grant select on public.listings to anon, authenticated;
grant update (lat, lng) on public.listings to service_role;
