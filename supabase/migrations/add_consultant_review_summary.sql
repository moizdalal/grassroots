-- Public-readable aggregate of consultant_reviews. The raw `consultant_reviews`
-- table stays restricted (only participants can read individual rows). This
-- view exposes only aggregates (averages + count) so any signed-in user can
-- gauge consultant credibility without seeing review authorship or text.

create or replace view public.consultant_review_summary as
select
  consultant_id,
  count(*)::int as review_count,
  round(avg(
    (work_product_quality + communication + timeliness + professionalism + cost_value)::numeric / 5
  ), 2) as rating_average,
  round(avg(work_product_quality)::numeric, 2) as work_product_quality_avg,
  round(avg(communication)::numeric, 2) as communication_avg,
  round(avg(timeliness)::numeric, 2) as timeliness_avg,
  round(avg(professionalism)::numeric, 2) as professionalism_avg,
  round(avg(cost_value)::numeric, 2) as cost_value_avg
from public.consultant_reviews
group by consultant_id;

-- Views inherit RLS from their base table, but a SECURITY INVOKER view will
-- only return rows the caller can already read. To expose aggregates broadly,
-- explicitly mark this view to bypass RLS by switching ownership / using
-- security definer wrapped in a function. Simpler approach: grant SELECT on
-- the view and add a permissive policy on consultant_reviews for the view's
-- usage by going through a SECURITY DEFINER stable function.

create or replace function public.get_consultant_rating(target_consultant_id uuid)
returns table (
  consultant_id uuid,
  review_count int,
  rating_average numeric,
  work_product_quality_avg numeric,
  communication_avg numeric,
  timeliness_avg numeric,
  professionalism_avg numeric,
  cost_value_avg numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    consultant_id,
    count(*)::int,
    round(avg(
      (work_product_quality + communication + timeliness + professionalism + cost_value)::numeric / 5
    ), 2),
    round(avg(work_product_quality)::numeric, 2),
    round(avg(communication)::numeric, 2),
    round(avg(timeliness)::numeric, 2),
    round(avg(professionalism)::numeric, 2),
    round(avg(cost_value)::numeric, 2)
  from public.consultant_reviews
  where consultant_id = target_consultant_id
  group by consultant_id;
$$;

grant execute on function public.get_consultant_rating(uuid) to anon, authenticated;

create or replace function public.get_consultant_ratings(target_consultant_ids uuid[])
returns table (
  consultant_id uuid,
  review_count int,
  rating_average numeric
)
language sql
security definer
set search_path = public
stable
as $$
  select
    consultant_id,
    count(*)::int,
    round(avg(
      (work_product_quality + communication + timeliness + professionalism + cost_value)::numeric / 5
    ), 2)
  from public.consultant_reviews
  where consultant_id = any(target_consultant_ids)
  group by consultant_id;
$$;

grant execute on function public.get_consultant_ratings(uuid[]) to anon, authenticated;
