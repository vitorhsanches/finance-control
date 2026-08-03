-- Phase 2B.1 validation. Run after applying the migration in local/test only.

-- Replace both UUIDs with the same dedicated test users used by the fixture script.
do $test_users$
declare
  user_a uuid := '00000000-0000-0000-0000-000000000001';
  user_b uuid := '00000000-0000-0000-0000-000000000002';
begin
  if user_a = user_b then raise exception 'Test user UUIDs must be different.'; end if;
  if not exists (select 1 from auth.users where id = user_a)
     or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'Both explicit test user UUIDs must exist in auth.users.';
  end if;
end
$test_users$;
-- Every DO block raises and aborts validation when its invariant is false.

-- Post-migration data integrity.
do $validation$
begin
  if exists (
    select 1 from public.future_bills
    where (series_id is null) <> (occurrence_number is null)
  ) then
    raise exception 'Invalid partial recurrence identity remains.';
  end if;

  if exists (
    select 1 from public.future_bills
    where occurrence_number is not null and occurrence_number < 1
  ) then
    raise exception 'Invalid occurrence_number remains.';
  end if;

  if exists (
    select 1
    from public.future_bills
    where series_id is not null
    group by user_id, series_id, occurrence_number
    having count(*) > 1
  ) then
    raise exception 'Duplicate recurrence occurrence remains.';
  end if;

  if exists (
    select 1
    from public.future_bills as bill
    left join public.future_bill_series as series
      on series.user_id = bill.user_id
     and series.series_id = bill.series_id
    where bill.series_id is not null
      and series.series_id is null
  ) then
    raise exception 'Explicit recurrence identity was not backfilled.';
  end if;

  if exists (
    select 1
    from public.future_bill_series as series
    where (series.status = 'active' and series.stopped_after_occurrence is not null)
       or (series.status = 'stopped' and (series.stopped_after_occurrence is null or series.stopped_after_occurrence < 0))
  ) then
    raise exception 'Series status/cutoff consistency is invalid.';
  end if;
end
$validation$;

do $schema_validation$
declare
  rpc_oid oid;
begin
  if to_regclass('public.future_bill_series') is null then
    raise exception 'future_bill_series table is missing.';
  end if;

  if not coalesce((
    select rowsecurity
    from pg_tables
    where schemaname = 'public' and tablename = 'future_bill_series'
  ), false) then
    raise exception 'RLS is not enabled on future_bill_series.';
  end if;

  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.future_bills'::regclass
      and tgname = 'enforce_future_bill_series_cutoff_trigger'
      and not tgisinternal
  ) then
    raise exception 'Future bill cutoff trigger is missing.';
  end if;

  rpc_oid := to_regprocedure('public.stop_future_bill_series_from(text,integer)');
  if rpc_oid is null then
    raise exception 'stop_future_bill_series_from(text, integer) is missing.';
  end if;

  if (select prosecdef from pg_proc where oid = rpc_oid) then
    raise exception 'stop_future_bill_series_from must be SECURITY INVOKER.';
  end if;

  if not has_function_privilege('authenticated', rpc_oid, 'EXECUTE') then
    raise exception 'authenticated cannot execute stop_future_bill_series_from.';
  end if;

  if has_function_privilege('anon', rpc_oid, 'EXECUTE') then
    raise exception 'anon can execute stop_future_bill_series_from.';
  end if;

  if exists (
    select 1
    from pg_proc as p,
      lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as privilege
    where p.oid = rpc_oid
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) then
    raise exception 'PUBLIC can execute stop_future_bill_series_from.';
  end if;

  if exists (
    select 1
    from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name = 'future_bill_series'
      and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'anon or PUBLIC has table privileges on future_bill_series.';
  end if;
end
$schema_validation$;

-- Schema, RLS, trigger and RPC shape.
select conname, contype, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid in (
  'public.future_bill_series'::regclass,
  'public.future_bills'::regclass
)
and conname in (
  'future_bill_series_pkey',
  'future_bill_series_id_not_blank_check',
  'future_bill_series_status_check',
  'future_bill_series_stop_consistency_check',
  'future_bills_series_identity_pair_check',
  'future_bills_occurrence_number_positive_check',
  'future_bills_series_fkey'
)
order by conname;

select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename = 'future_bill_series';

select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename = 'future_bill_series'
order by policyname;

select trigger_name, event_manipulation, action_timing, action_statement
from information_schema.triggers
where event_object_schema = 'public'
  and event_object_table in ('future_bill_series', 'future_bills')
  and trigger_name in (
    'prevent_future_bill_series_reactivation_trigger',
    'enforce_future_bill_series_cutoff_trigger'
  )
order by trigger_name, event_manipulation;

select
  p.oid::regprocedure as function_signature,
  p.prosecdef as security_definer,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', p.oid, 'EXECUTE') as anon_can_execute,
  exists (
    select 1
    from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) as privilege
    where privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) as public_can_execute
from pg_proc as p
join pg_namespace as n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'stop_future_bill_series_from';

select grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and table_name = 'future_bill_series'
  and grantee in ('authenticated', 'anon', 'PUBLIC')
order by grantee, privilege_type;

-- Counts useful for reconciling the explicit backfill with legacy rows.
select
  count(*) filter (where series_id is null and occurrence_number is null) as legacy_without_series,
  count(*) filter (where series_id is not null and occurrence_number is not null) as explicit_occurrences,
  count(distinct (user_id, series_id)) filter (where series_id is not null) as explicit_series
from public.future_bills;

select
  count(*) as series_rows,
  count(*) filter (where status = 'active') as active_series,
  count(*) filter (where status = 'stopped') as stopped_series
from public.future_bill_series;
