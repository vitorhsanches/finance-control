-- Run after preflight and before applying the transaction origin migration.
-- Replace both UUID placeholders with the same dedicated test users.

do $fixture_precheck$
declare
  user_a uuid := '00000000-0000-0000-0000-000000000011';
  user_b uuid := '00000000-0000-0000-0000-000000000022';
begin
  if user_a = user_b then
    raise exception 'Transaction origin test users must be different.';
  end if;

  if not exists (select 1 from auth.users where id = user_a)
     or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'Both explicit transaction origin test users must exist in auth.users.';
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name in ('origin_type', 'origin_id', 'import_id')
  ) then
    raise exception 'Structured origin columns already exist; fixtures must be loaded before migration.';
  end if;

  if exists (
    select 1
    from public.transactions
    where (user_id = user_a or user_id = user_b)
      and (
        id like 'phase1-origin-validation-%'
        or source like 'future-bill:phase1-origin-validation-%'
      )
  ) then
    raise exception 'Deterministic transaction origin fixtures already exist.';
  end if;
end
$fixture_precheck$;

insert into public.transactions (
  user_id, id, date, description, type, category, amount, payment_method,
  account_or_card, essential, paid, source
) values
  (
    '00000000-0000-0000-0000-000000000011'::uuid,
    'phase1-origin-validation-a-legacy', '2026-08-01',
    'Fixture legacy A', 'expense', 'Validation', 10, 'Test', 'Test', false, true,
    'future-bill:phase1-origin-validation-shared-bill'
  ),
  (
    '00000000-0000-0000-0000-000000000022'::uuid,
    'phase1-origin-validation-b-legacy', '2026-08-01',
    'Fixture legacy B', 'expense', 'Validation', 10, 'Test', 'Test', false, true,
    'future-bill:phase1-origin-validation-shared-bill'
  ),
  (
    '00000000-0000-0000-0000-000000000011'::uuid,
    'phase1-origin-validation-malformed', '2026-08-02',
    'Fixture malformed source', 'expense', 'Validation', 11, 'Test', 'Test', false, true,
    'future-bill:phase1-origin-validation:malformed'
  ),
  (
    '00000000-0000-0000-0000-000000000011'::uuid,
    'phase1-origin-validation-unrelated', '2026-08-03',
    'Fixture unrelated source', 'expense', 'Validation', 12, 'Test', 'Test', false, true,
    'manual-validation-source'
  );

select user_id, id, source
from public.transactions
where id like 'phase1-origin-validation-%'
  and user_id in (
    '00000000-0000-0000-0000-000000000011'::uuid,
    '00000000-0000-0000-0000-000000000022'::uuid
  )
order by user_id, id;
