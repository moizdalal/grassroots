-- Students review the business after an engagement wraps.
-- One review per bid. Same shape as consultant_reviews: five half-star
-- dimensions, an optional note, no edits after insert.
--
-- Dimensions: scope clarity, communication, approval speed, respect,
-- and would work again. Half steps from 0.5 to 5, matching
-- add_half_star_ratings.sql.
--
-- A student can submit once the work has an ending:
--   * kickoff schedule marked completed (the owner submitted their review), or
--   * the bid payment was released or refunded, or
--   * the phased service fee was released or refunded, or
--   * the proposal was declined and that fee was released or refunded, or
--   * a retainer ended (canceled or completed) after a period was billed,
--     released, or refunded.
-- The check lives in can_review_business so row level security on the
-- payment tables cannot hide an ending the student is allowed to rate.
-- Keep it in sync with engagementWrapped() in public/engagement.js.
--
-- Do not apply without moiz's approval. Clear scope in get_business_badges
-- reads scope_clarity from this table once it exists.

begin;

create table if not exists public.business_reviews (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  bid_id uuid not null references public.bids(id) on delete cascade,
  owner_id uuid not null references public.profiles(id) on delete cascade,
  consultant_id uuid not null references public.profiles(id) on delete cascade,
  scope_clarity numeric(2,1) not null,
  communication numeric(2,1) not null,
  approval_speed numeric(2,1) not null,
  respect numeric(2,1) not null,
  would_work_again numeric(2,1) not null,
  endorsement text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now(),
  unique (bid_id),
  constraint business_reviews_scope_clarity_half_check
    check (scope_clarity in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)),
  constraint business_reviews_communication_half_check
    check (communication in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)),
  constraint business_reviews_approval_speed_half_check
    check (approval_speed in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)),
  constraint business_reviews_respect_half_check
    check (respect in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)),
  constraint business_reviews_would_work_again_half_check
    check (would_work_again in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5))
);

create index if not exists business_reviews_owner_idx
  on public.business_reviews (owner_id, created_at desc);

create index if not exists business_reviews_consultant_idx
  on public.business_reviews (consultant_id, created_at desc);

create or replace function public.can_review_business(
  target_bid_id uuid,
  target_listing_id uuid,
  target_owner_id uuid
) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.bids b
    join public.listings l on l.id = b.listing_id
    where b.id = target_bid_id
      and b.listing_id = target_listing_id
      and b.consultant_id = auth.uid()
      and l.owner_id = target_owner_id
      and (
        b.payment_status in ('released', 'refunded')
        or exists (
          select 1
          from public.engagement_schedules s
          where s.bid_id = b.id
            and s.status = 'completed'
        )
        or exists (
          select 1
          from public.bid_phase_payments p
          where p.bid_id = b.id
            and p.phase = 'service'
            and p.status in ('released', 'refunded')
        )
        or exists (
          select 1
          from public.bid_phase_payments p
          where p.bid_id = b.id
            and p.phase = 'proposal'
            and p.status in ('released', 'refunded')
            and b.move_forward_status = 'declined'
        )
        or exists (
          select 1
          from public.retainer_subscriptions rs
          where rs.bid_id = b.id
            and rs.status in ('canceled', 'completed')
            and (
              rs.periods_billed > 0
              or exists (
                select 1
                from public.bid_phase_payments p
                where p.bid_id = b.id
                  and p.phase = 'retainer_period'
                  and p.status in ('released', 'refunded')
              )
            )
        )
      )
  );
$$;

revoke all on function public.can_review_business(uuid, uuid, uuid) from public;
grant execute on function public.can_review_business(uuid, uuid, uuid) to authenticated;

alter table public.business_reviews enable row level security;

drop policy if exists "students insert reviews for wrapped work" on public.business_reviews;
create policy "students insert reviews for wrapped work"
  on public.business_reviews
  for insert
  to authenticated
  with check (
    consultant_id = auth.uid()
    and public.can_review_business(bid_id, listing_id, owner_id)
  );

drop policy if exists "participants read business reviews" on public.business_reviews;
create policy "participants read business reviews"
  on public.business_reviews
  for select
  to authenticated
  using (owner_id = auth.uid() or consultant_id = auth.uid());

-- One review per bid is enforced by business_reviews_bid_id_key.
-- No update or delete grant: a review stays as posted.
revoke all on public.business_reviews from anon;
revoke all on public.business_reviews from authenticated;
grant select, insert on public.business_reviews to authenticated;
grant all on public.business_reviews to service_role;

commit;
