-- Adds a DELETE row-level policy on public.listings so owners can
-- remove their own listings. Without this, every DELETE hits the
-- default "no policy → deny" outcome and the client call silently
-- drops zero rows. The previous rollback path in create-listing.js
-- relied on this same policy implicitly; it was a latent gap.
--
-- Cascade on related rows (bids, listing_views, messages, schedules,
-- engagement_reviews, messaging_read_state) is already declared at
-- the FK level — deleting a row from `listings` removes everything
-- below it in one transaction. Storage objects (the attachments
-- bucket) do NOT cascade and are cleaned up by the client.

drop policy if exists "owners delete own listings" on public.listings;
create policy "owners delete own listings"
  on public.listings
  for delete
  to authenticated
  using (auth.uid() = owner_id);

notify pgrst, 'reload schema';
