-- Allow half-step ratings (0.5 → 5 in 0.5 increments) on consultant_reviews.
-- Original schema (engagements_and_reviews.sql) used `smallint check between 1
-- and 5`. The engagement review UI now lets owners click half-stars, so each
-- dimension widens to numeric(2,1) and the check constraint is replaced with
-- an explicit half-step set.
--
-- The consultant_review_summary view (from add_consultant_review_summary.sql)
-- references these columns, so it gets dropped before the alter and recreated
-- after with the identical definition. The security-definer aggregate
-- functions don't take a hard dependency on column types, so they don't need
-- to be touched.

drop view if exists public.consultant_review_summary;

do $$
declare
  rec record;
begin
  for rec in
    select conname
    from pg_constraint
    where conrelid = 'public.consultant_reviews'::regclass
      and contype = 'c'
  loop
    execute format('alter table public.consultant_reviews drop constraint %I', rec.conname);
  end loop;
end $$;

alter table public.consultant_reviews
  alter column work_product_quality type numeric(2,1) using work_product_quality::numeric(2,1),
  alter column communication        type numeric(2,1) using communication::numeric(2,1),
  alter column timeliness           type numeric(2,1) using timeliness::numeric(2,1),
  alter column professionalism      type numeric(2,1) using professionalism::numeric(2,1),
  alter column cost_value           type numeric(2,1) using cost_value::numeric(2,1);

alter table public.consultant_reviews
  add constraint consultant_reviews_work_product_quality_half_check
    check (work_product_quality in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)),
  add constraint consultant_reviews_communication_half_check
    check (communication in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)),
  add constraint consultant_reviews_timeliness_half_check
    check (timeliness in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)),
  add constraint consultant_reviews_professionalism_half_check
    check (professionalism in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5)),
  add constraint consultant_reviews_cost_value_half_check
    check (cost_value in (0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5));

-- security_invoker = true so the view runs with the caller's RLS rather
-- than the view owner's (Postgres default for views is SECURITY DEFINER,
-- which the Supabase advisor flags). The app accesses aggregate review
-- data through the SECURITY DEFINER RPCs get_consultant_rating and
-- get_consultant_ratings; this view is just for ad-hoc inspection.
create view public.consultant_review_summary
with (security_invoker = true) as
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
