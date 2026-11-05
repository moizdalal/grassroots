-- Consultant training: server-graded quiz, required before sending offers.
--
-- The lesson text lives in public/training-content.js. The question bank
-- and answer key live only here (training_questions), so correct answers
-- never ship to the browser. Seed or edit the bank with
-- seed_training_questions.sql, which is safe to re-run.
--
--   * start_training_quiz()   draws 10 questions (at least 2 per module)
--                             and opens an attempt. No answers returned.
--   * submit_training_quiz()  grades the attempt in the database and
--                             records it. Correct answers come back only
--                             on a pass, for the review screen.
--   * bids_require_training   blocks a consultant's new offers from the
--                             browser until they're cleared: a passing
--                             attempt, or a row in training_exemptions.
--                             Server (service_role) inserts are exempt.
--
-- Rollout: consultants who already have any offer (and so any engagement,
-- since engagements are accepted offers) when this runs are exempted.
-- Only new consultants must pass. Add an exemption by hand with:
--   insert into public.training_exemptions (user_id, reason) values ('<id>', '<why>');

-- ── question bank ──────────────────────────────────────────────
create table if not exists public.training_questions (
  id text primary key,
  module text not null check (module in ('before', 'during', 'after', 'trust')),
  prompt text not null,
  options jsonb not null check (
    jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 6
  ),
  answer int not null,
  why text not null,
  active boolean not null default true,
  constraint training_questions_answer_check
    check (answer >= 0 and answer < jsonb_array_length(options))
);

alter table public.training_questions enable row level security;
revoke all on public.training_questions from anon, authenticated;
grant all on public.training_questions to service_role;
-- No policies: browsers read questions only through start_training_quiz().

-- ── attempts ───────────────────────────────────────────────────
-- A row opens when the quiz starts and is graded on submit. Browsers can
-- read their own rows; every write goes through the functions below.
create table if not exists public.training_quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_ids text[] not null,
  total int not null,
  -- { "<question id>": <chosen option index> }, set on submit
  answers jsonb,
  score int,
  passed boolean,
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  constraint training_quiz_attempts_total_check
    check (total = cardinality(question_ids) and total between 1 and 50),
  constraint training_quiz_attempts_graded_check
    check ((submitted_at is null) = (score is null) and (score is null) = (passed is null)),
  constraint training_quiz_attempts_score_check
    check (score is null or score between 0 and total),
  -- 80% to pass
  constraint training_quiz_attempts_passed_check
    check (passed is null or passed = (score * 10 >= total * 8))
);

create index if not exists training_quiz_attempts_user_idx
  on public.training_quiz_attempts (user_id, created_at desc);
create index if not exists training_quiz_attempts_passed_idx
  on public.training_quiz_attempts (user_id) where passed;

alter table public.training_quiz_attempts enable row level security;
revoke all on public.training_quiz_attempts from anon, authenticated;
grant select on public.training_quiz_attempts to authenticated;
grant all on public.training_quiz_attempts to service_role;

drop policy if exists "consultants read own training attempts" on public.training_quiz_attempts;
create policy "consultants read own training attempts"
  on public.training_quiz_attempts for select to authenticated
  using (auth.uid() = user_id);

-- ── exemptions ─────────────────────────────────────────────────
create table if not exists public.training_exemptions (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  reason text not null,
  created_at timestamptz not null default now()
);

alter table public.training_exemptions enable row level security;
revoke all on public.training_exemptions from anon, authenticated;
grant select on public.training_exemptions to authenticated;
grant all on public.training_exemptions to service_role;

drop policy if exists "users read own training exemption" on public.training_exemptions;
create policy "users read own training exemption"
  on public.training_exemptions for select to authenticated
  using (auth.uid() = user_id);

-- Grandfather everyone who has sent an offer before this runs.
insert into public.training_exemptions (user_id, reason)
select distinct b.consultant_id, 'had offers before training was required'
from public.bids b
on conflict (user_id) do nothing;

-- Cleared to send offers: passed the quiz, or exempt.
create or replace function public.training_cleared(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
      select 1 from public.training_quiz_attempts t
      where t.user_id = p_user and t.passed
    )
    or exists (
      select 1 from public.training_exemptions e
      where e.user_id = p_user
    )
$$;

revoke all on function public.training_cleared(uuid) from public, anon, authenticated;
grant execute on function public.training_cleared(uuid) to service_role;

-- The signed-in user's own status, for the offer form and dashboard.
create or replace function public.my_training_cleared()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.training_cleared(auth.uid())
$$;

revoke all on function public.my_training_cleared() from public, anon;
grant execute on function public.my_training_cleared() to authenticated, service_role;

-- ── start ──────────────────────────────────────────────────────
create or replace function public.start_training_quiz()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_ids text[];
  v_attempt uuid;
begin
  if v_uid is null then
    raise exception 'Sign in to take the quiz.' using errcode = '42501';
  end if;
  if not exists (select 1 from public.profiles p where p.id = v_uid and p.role = 'consultant') then
    raise exception 'Training is for consultants.' using errcode = '42501';
  end if;

  -- Two random questions from each module, then fill to 10 from the rest.
  -- `ranked` is referenced twice, so Postgres materializes it and both
  -- reads see the same random order.
  with ranked as (
    select q.id, row_number() over (partition by q.module order by random()) as rn
    from public.training_questions q
    where q.active
  ),
  base as (
    select id from ranked where rn <= 2
  ),
  extra as (
    select id from ranked where rn > 2
    order by random()
    limit greatest(0, 10 - (select count(*) from base))
  )
  select array_agg(id order by random()) into v_ids
  from (select id from base union all select id from extra) picked;

  if coalesce(cardinality(v_ids), 0) = 0 then
    raise exception 'The question bank is empty.' using errcode = 'P0002';
  end if;

  -- One open attempt at a time.
  delete from public.training_quiz_attempts
  where user_id = v_uid and submitted_at is null;

  insert into public.training_quiz_attempts (user_id, question_ids, total)
  values (v_uid, v_ids, cardinality(v_ids))
  returning id into v_attempt;

  return jsonb_build_object(
    'attempt_id', v_attempt,
    'questions', (
      select jsonb_agg(
        jsonb_build_object('id', q.id, 'module', q.module, 'prompt', q.prompt, 'options', q.options)
        order by array_position(v_ids, q.id)
      )
      from public.training_questions q
      where q.id = any (v_ids)
    )
  );
end;
$$;

-- ── submit ─────────────────────────────────────────────────────
create or replace function public.submit_training_quiz(p_attempt_id uuid, p_answers jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.training_quiz_attempts;
  v_score int;
  v_passed boolean;
  v_answers jsonb;
begin
  select * into v_attempt
  from public.training_quiz_attempts
  where id = p_attempt_id and user_id = auth.uid()
  for update;

  if not found then
    raise exception 'Quiz not found. Start a new one.' using errcode = 'P0002';
  end if;
  if v_attempt.submitted_at is not null then
    raise exception 'This quiz was already submitted. Start a new one.' using errcode = 'P0001';
  end if;
  if p_answers is null or jsonb_typeof(p_answers) <> 'object' then
    raise exception 'Answers are missing.' using errcode = '22023';
  end if;

  -- Keep only answers to this attempt's questions.
  select coalesce(jsonb_object_agg(a.key, a.value), '{}'::jsonb) into v_answers
  from jsonb_each(p_answers) a
  where a.key = any (v_attempt.question_ids);

  select count(*) filter (where (v_answers ->> q.id) = q.answer::text) into v_score
  from public.training_questions q
  where q.id = any (v_attempt.question_ids);

  v_passed := v_score * 10 >= v_attempt.total * 8;

  update public.training_quiz_attempts
  set answers = v_answers, score = v_score, passed = v_passed, submitted_at = now()
  where id = v_attempt.id;

  return jsonb_build_object(
    'score', v_score,
    'total', v_attempt.total,
    'passed', v_passed,
    -- Answers only come back on a pass, so failing can't be used to
    -- harvest the key.
    'results', case when v_passed then (
      select jsonb_agg(
        jsonb_build_object(
          'id', q.id,
          'correct', (v_answers ->> q.id) = q.answer::text,
          'answer', q.answer,
          'why', q.why
        )
        order by array_position(v_attempt.question_ids, q.id)
      )
      from public.training_questions q
      where q.id = any (v_attempt.question_ids)
    ) end
  );
end;
$$;

revoke all on function public.start_training_quiz() from public, anon;
revoke all on function public.submit_training_quiz(uuid, jsonb) from public, anon;
grant execute on function public.start_training_quiz() to authenticated, service_role;
grant execute on function public.submit_training_quiz(uuid, jsonb) to authenticated, service_role;

-- ── offers require a pass ──────────────────────────────────────
create or replace function public.bids_require_training()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_client_role() and not public.training_cleared(new.consultant_id) then
    raise exception 'Pass consultant training before you send offers.'
      using errcode = '42501', hint = 'training_required';
  end if;
  return new;
end;
$$;

revoke all on function public.bids_require_training() from public, anon, authenticated;

drop trigger if exists bids_require_training on public.bids;
create trigger bids_require_training
  before insert on public.bids
  for each row execute function public.bids_require_training();
