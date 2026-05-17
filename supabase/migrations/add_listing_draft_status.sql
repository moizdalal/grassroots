-- Allow 'draft' as a listings.status value. Drafts are owner-only:
-- visible on /dashboard but never to consultants on the marketplace.
-- The app filters `eq("status", "open")` on the marketplace side,
-- so the CHECK constraint is the only thing blocking draft inserts.
alter table public.listings
  drop constraint if exists listings_status_check;

alter table public.listings
  add constraint listings_status_check
  check (status = any (array['draft'::text, 'open'::text, 'paused'::text, 'closed'::text, 'filled'::text]));
