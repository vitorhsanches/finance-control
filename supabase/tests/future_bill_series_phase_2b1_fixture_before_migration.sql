-- Run only in a TEST project, after recording the original checksum and before
-- applying the migration. Replace both UUIDs below with dedicated test users.

do $test_users$
declare
  user_a uuid := '00000000-0000-0000-0000-000000000001';
  user_b uuid := '00000000-0000-0000-0000-000000000002';
begin
  if user_a = user_b then
    raise exception 'Phase 2B.1 test users must be different.';
  end if;
  if not exists (select 1 from auth.users where id = user_a)
     or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'Both explicit Phase 2B.1 test user UUIDs must exist in auth.users.';
  end if;
end
$test_users$;

do $fixture_precheck$
begin
  if to_regclass('public.future_bill_series') is not null then
    raise exception 'future_bill_series already exists; load backfill fixtures before applying the migration.';
  end if;

  if exists (
    select 1
    from public.future_bills
    where id like 'phase2b1-validation-%'
       or series_id like 'phase2b1-validation-%'
  ) then
    raise exception 'Phase 2B.1 fixture identifiers already exist.';
  end if;
end
$fixture_precheck$;

with selected_users as (
  select '00000000-0000-0000-0000-000000000001'::uuid as id, 1 as position
  union all
  select '00000000-0000-0000-0000-000000000002'::uuid, 2
), fixtures as (
  select *
  from (values
    (1, 'phase2b1-validation-a-1', 'phase2b1-validation-series-a', 1, '2026-08-01'::date, 'Série A - anterior'),
    (1, 'phase2b1-validation-a-2', 'phase2b1-validation-series-a', 2, '2026-09-01'::date, 'Série A - corte'),
    (1, 'phase2b1-validation-a-3', 'phase2b1-validation-series-a', 3, '2026-10-01'::date, 'Série A - posterior'),
    (1, 'phase2b1-validation-b-1', 'phase2b1-validation-series-b', 1, '2026-08-02'::date, 'Série B - isolada'),
    (2, 'phase2b1-validation-other-a-1', 'phase2b1-validation-series-a', 1, '2026-08-03'::date, 'Outro usuário - anterior'),
    (2, 'phase2b1-validation-other-a-2', 'phase2b1-validation-series-a', 2, '2026-09-03'::date, 'Outro usuário - corte')
  ) as fixture(user_position, id, series_id, occurrence_number, due_date, description)
)
insert into public.future_bills (
  user_id,
  id,
  series_id,
  occurrence_number,
  due_date,
  description,
  category,
  amount,
  recurring,
  frequency,
  priority,
  paid
)
select
  selected_users.id,
  fixtures.id,
  fixtures.series_id,
  fixtures.occurrence_number,
  fixtures.due_date,
  fixtures.description,
  'Validação',
  10,
  true,
  'Mensal',
  'Média',
  false
from fixtures
join selected_users on selected_users.position = fixtures.user_position;

-- Legacy row: intentionally no series_id and no occurrence_number.
with selected_user as (
  select '00000000-0000-0000-0000-000000000001'::uuid as id
)
insert into public.future_bills (
  user_id,
  id,
  due_date,
  description,
  category,
  amount,
  recurring,
  frequency,
  priority,
  paid
)
select
  id,
  'phase2b1-validation-legacy',
  '2026-08-04'::date,
  'Legado sem identidade',
  'Validação',
  10,
  true,
  'Mensal',
  'Média',
  false
from selected_user;

select user_id, id, series_id, occurrence_number
from public.future_bills
where id like 'phase2b1-validation-%'
order by user_id, id;
