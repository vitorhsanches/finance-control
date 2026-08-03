-- Run after applying 20260803150312_add_transaction_origin_identity.sql.
-- Replace both UUID placeholders with the same dedicated test users.

do $structural_validation$
declare
  user_a uuid := '00000000-0000-0000-0000-000000000011';
  user_b uuid := '00000000-0000-0000-0000-000000000022';
begin
  if user_a = user_b then raise exception 'Transaction origin test users must be different.'; end if;
  if not exists (select 1 from auth.users where id = user_a)
     or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'Both explicit transaction origin test users must exist in auth.users.';
  end if;

  if (
    select count(*)
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'transactions'
      and column_name in ('origin_type', 'origin_id', 'import_id')
      and is_nullable = 'YES'
  ) <> 3 then
    raise exception 'Structured origin columns are missing or not nullable.';
  end if;

  if (
    select count(*)
    from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname in (
        'transactions_origin_type_check',
        'transactions_origin_consistency_check',
        'transactions_import_origin_check'
      )
  ) <> 3 then
    raise exception 'One or more transaction origin constraints are missing.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.transactions'::regclass
      and tgname = 'sync_transaction_origin_compatibility_trigger'
      and not tgisinternal
  ) then
    raise exception 'Transaction origin compatibility trigger is missing.';
  end if;

  if to_regprocedure('public.sync_transaction_origin_compatibility()') is null then
    raise exception 'Transaction origin compatibility function is missing.';
  end if;

  if (select prosecdef from pg_proc where oid = 'public.sync_transaction_origin_compatibility()'::regprocedure) then
    raise exception 'Compatibility trigger function must be SECURITY INVOKER.';
  end if;

  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public'
      and tablename = 'transactions'
      and indexname = 'transactions_user_origin_unique_idx'
      and indexdef like 'CREATE UNIQUE INDEX%user_id, origin_type, origin_id%'
  ) then
    raise exception 'Structured transaction origin unique index is missing or malformed.';
  end if;

  if not exists (
    select 1 from public.transactions
    where user_id = user_a
      and id = 'phase1-origin-validation-a-legacy'
      and origin_type = 'future_bill_payment'
      and origin_id = 'phase1-origin-validation-shared-bill'
      and source = 'future-bill:phase1-origin-validation-shared-bill'
  ) then
    raise exception 'User A exact legacy source was not backfilled correctly.';
  end if;

  if not exists (
    select 1 from public.transactions
    where user_id = user_b
      and id = 'phase1-origin-validation-b-legacy'
      and origin_type = 'future_bill_payment'
      and origin_id = 'phase1-origin-validation-shared-bill'
      and source = 'future-bill:phase1-origin-validation-shared-bill'
  ) then
    raise exception 'Same origin was not preserved independently for user B.';
  end if;

  if not exists (
    select 1 from public.transactions
    where user_id = user_a
      and id = 'phase1-origin-validation-malformed'
      and origin_type is null
      and origin_id is null
      and source = 'future-bill:phase1-origin-validation:malformed'
  ) then
    raise exception 'Malformed source was interpreted or changed.';
  end if;

  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and contype = 'f'
      and pg_get_constraintdef(oid) ilike '%origin_id%'
  ) then
    raise exception 'A polymorphic foreign key was created for origin_id.';
  end if;
end
$structural_validation$;

select origin_type, count(*)
from public.transactions
where user_id in (
  '00000000-0000-0000-0000-000000000011'::uuid,
  '00000000-0000-0000-0000-000000000022'::uuid
)
  and id like 'phase1-origin-validation-%'
group by origin_type
order by origin_type nulls first;
