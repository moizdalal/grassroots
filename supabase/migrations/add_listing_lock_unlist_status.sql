-- Replace paused/closed with a lock / unlist model.
--
--   open      takes offers, shown in marketplace browsing
--   locked    no new offers, still publicly visible (owner can unlock)
--   completed no new offers, still publicly visible as a past project;
--             set when payouts finish (or by the owner for phased work)
--   unlisted  no new offers, hidden from the public; owner + bidders only
--
-- Listing state never ends an engagement. Guards below stop an owner from
-- unlisting, re-drafting or deleting a listing while accepted work is
-- active, and only allow `completed` once payouts are done.

-- 1. Status constraint. Keep legacy values allowed until rows are migrated.
alter table public.listings drop constraint if exists listings_status_check;
alter table public.listings
  add constraint listings_status_check
  check (status = any (array[
    'draft', 'open', 'locked', 'completed', 'unlisted',
    'paused', 'closed', 'filled'
  ]::text[]));

-- 2. Public read: locked and completed listings stay visible.
drop policy if exists "open listings are readable" on public.listings;
create policy "public listings are readable"
  on public.listings
  for select
  to anon, authenticated
  using (status in ('open', 'locked', 'completed'));

-- Bid inserts already require status = 'open' (policy "Consultants can
-- insert bids on open listings"), so locking blocks new offers in the DB.

-- 3. Helpers. An accepted bid's money can live in three places:
--    bids.payment_status (standard), bid_phase_payments (phased +
--    retainer periods) and retainer_subscriptions (the recurring plan).

-- Money is authorized or held, or a retainer is still running.
create or replace function public.listing_money_in_flight(target_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bids b
    where b.listing_id = target_listing_id
      and b.status = 'accepted'
      and (
        b.payment_status in ('authorizing', 'held')
        or exists (
          select 1 from public.bid_phase_payments p
          where p.bid_id = b.id and p.status in ('authorizing', 'held')
        )
        or exists (
          select 1 from public.retainer_subscriptions r
          where r.bid_id = b.id and r.status in ('offered', 'pending', 'active')
        )
      )
  );
$$;

-- An accepted bid has been paid out at least once.
create or replace function public.listing_has_released_work(target_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.bids b
    where b.listing_id = target_listing_id
      and b.status = 'accepted'
      and (
        b.payment_status = 'released'
        or exists (
          select 1 from public.bid_phase_payments p
          where p.bid_id = b.id and p.status = 'released'
        )
        or exists (
          select 1 from public.retainer_subscriptions r
          where r.bid_id = b.id and r.status = 'completed'
        )
      )
  );
$$;

-- Active work: money in flight, or an accepted bid that hasn't reached
-- any settled outcome yet (no payout, no refund, no ended retainer).
create or replace function public.listing_has_active_engagement(target_listing_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.listing_money_in_flight(target_listing_id)
    or exists (
      select 1
      from public.bids b
      where b.listing_id = target_listing_id
        and b.status = 'accepted'
        and coalesce(b.payment_status, 'unpaid') not in ('released', 'refunded')
        and not exists (
          select 1 from public.bid_phase_payments p
          where p.bid_id = b.id and p.status in ('released', 'refunded')
        )
        and not exists (
          select 1 from public.retainer_subscriptions r
          where r.bid_id = b.id and r.status in ('completed', 'canceled')
        )
    );
$$;

-- 4. Migrate existing rows (needs the helpers above).
--    paused -> locked
--    closed/filled with active work -> locked (stays visible; the owner
--      can remove it after payout)
--    closed/filled with settled payouts -> completed, otherwise -> unlisted
update public.listings set status = 'locked' where status = 'paused';

update public.listings
set status = case
  when public.listing_has_active_engagement(id) then 'locked'
  when public.listing_has_released_work(id) then 'completed'
  else 'unlisted'
end
where status in ('closed', 'filled');

alter table public.listings drop constraint listings_status_check;
alter table public.listings
  add constraint listings_status_check
  check (status = any (array['draft', 'open', 'locked', 'completed', 'unlisted']::text[]));

-- Client-facing summary for the listing owner's controls:
--   'active'   money in flight, or accepted work with nothing settled yet
--   'released' paid out at least once and nothing in flight (completable)
--   'none'     no accepted work
-- A phased bid between phases (proposal paid, service not started) reads
-- 'released', so the owner can mark it completed or keep it locked.
-- Returns null to anyone who isn't the owner.
create or replace function public.listing_engagement_state(target_listing_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case
    when not exists (
      select 1 from public.listings l
      where l.id = target_listing_id and l.owner_id = auth.uid()
    ) then null
    when public.listing_money_in_flight(target_listing_id) then 'active'
    when public.listing_has_released_work(target_listing_id) then 'released'
    when public.listing_has_active_engagement(target_listing_id) then 'active'
    else 'none'
  end;
$$;

revoke execute on function public.listing_money_in_flight(uuid) from public, anon, authenticated;
revoke execute on function public.listing_has_active_engagement(uuid) from public, anon, authenticated;
revoke execute on function public.listing_has_released_work(uuid) from public, anon, authenticated;
revoke execute on function public.listing_engagement_state(uuid) from public, anon;
grant execute on function public.listing_engagement_state(uuid) to authenticated;

-- 5. Guard owner status changes.
create or replace function public.listings_guard_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and coalesce(auth.role(), '') <> 'service_role' then
    if new.status = 'completed'
       and (not public.listing_has_released_work(new.id) or public.listing_money_in_flight(new.id)) then
      raise exception 'You can mark a listing completed once its payments are released.'
        using errcode = 'check_violation';
    end if;

    if new.status = 'unlisted' and public.listing_has_active_engagement(new.id) then
      raise exception 'This listing has active work. Lock it instead, or remove it after payment is released.'
        using errcode = 'check_violation';
    end if;

    if new.status = 'draft' and exists (
      select 1 from public.bids b where b.listing_id = new.id and b.status = 'accepted'
    ) then
      raise exception 'This listing has an accepted offer, so it can''t go back to a draft.'
        using errcode = 'check_violation';
    end if;

    if old.status = 'completed' and new.status in ('open', 'draft') then
      raise exception 'Completed listings can''t be reopened. Post a new listing instead.'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists listings_guard_status_change on public.listings;
create trigger listings_guard_status_change
  before update of status on public.listings
  for each row execute function public.listings_guard_status_change();

-- 6. Guard deletes: an owner can't delete a listing that has accepted work.
create or replace function public.listings_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and exists (select 1 from public.bids b where b.listing_id = old.id and b.status = 'accepted') then
    raise exception 'Listings with accepted work can''t be deleted. Remove it from the marketplace instead.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists listings_guard_delete on public.listings;
create trigger listings_guard_delete
  before delete on public.listings
  for each row execute function public.listings_guard_delete();

-- 7. Keep `completed` in sync with payouts.
--    - Standard bid released, or a retainer reaching its period count,
--      marks an open/locked listing completed once nothing is in flight.
--      Phased contracts have no single "done" signal, so the owner marks
--      those completed from the listing controls.
--    - If a release is rolled back (Stripe failure), a completed listing
--      with no remaining payout goes back to locked.
--    An owner who unlisted the listing keeps it unlisted.
create or replace function public.refresh_listing_completion(target_listing_id uuid, allow_complete boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if allow_complete
     and public.listing_has_released_work(target_listing_id)
     and not public.listing_money_in_flight(target_listing_id) then
    update public.listings
    set status = 'completed'
    where id = target_listing_id and status in ('open', 'locked');
  elsif not public.listing_has_released_work(target_listing_id) then
    update public.listings
    set status = 'locked'
    where id = target_listing_id and status = 'completed';
  end if;
end;
$$;

revoke execute on function public.refresh_listing_completion(uuid, boolean) from public, anon, authenticated;

create or replace function public.bids_sync_listing_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'accepted' and new.payment_status is distinct from old.payment_status then
    perform public.refresh_listing_completion(new.listing_id, new.payment_status = 'released');
  end if;
  return new;
end;
$$;

drop trigger if exists bids_mark_listing_completed on public.bids;
drop trigger if exists bids_sync_listing_completion on public.bids;
create trigger bids_sync_listing_completion
  after update of payment_status on public.bids
  for each row execute function public.bids_sync_listing_completion();

create or replace function public.retainer_sync_listing_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lid uuid;
begin
  if new.status is distinct from old.status and new.status in ('completed', 'canceled') then
    select b.listing_id into lid from public.bids b where b.id = new.bid_id;
    if lid is not null then
      perform public.refresh_listing_completion(lid, true);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists retainer_sync_listing_completion on public.retainer_subscriptions;
create trigger retainer_sync_listing_completion
  after update of status on public.retainer_subscriptions
  for each row execute function public.retainer_sync_listing_completion();

-- Phase rollbacks (released -> held) can undo a completion too.
create or replace function public.phase_sync_listing_completion()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  lid uuid;
begin
  if old.status = 'released' and new.status is distinct from 'released' then
    select b.listing_id into lid from public.bids b where b.id = new.bid_id;
    if lid is not null then
      perform public.refresh_listing_completion(lid, false);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists phase_sync_listing_completion on public.bid_phase_payments;
create trigger phase_sync_listing_completion
  after update of status on public.bid_phase_payments
  for each row execute function public.phase_sync_listing_completion();

notify pgrst, 'reload schema';
