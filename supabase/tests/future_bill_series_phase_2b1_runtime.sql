-- Run in the SQL Editor of the TEST project after:
--   1. loading future_bill_series_phase_2b1_fixture_before_migration.sql;
--   2. applying the Phase 2B.1 migration;
--   3. running future_bill_series_phase_2b1_validation.sql.
-- All behavioral mutations below are rolled back.

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

-- Backfill and legacy validation.
do $backfill_validation$
declare
  user_a uuid;
  user_b uuid;
begin
    user_a := '00000000-0000-0000-0000-000000000001';
    user_b := '00000000-0000-0000-0000-000000000002';

  if (select count(*) from public.future_bill_series
      where user_id = user_a
        and series_id in ('phase2b1-validation-series-a', 'phase2b1-validation-series-b')
        and status = 'active'
        and stopped_after_occurrence is null) <> 2 then
    raise exception 'Explicit series for user A were not backfilled as active.';
  end if;

  if (select count(*) from public.future_bill_series
      where user_id = user_b
        and series_id = 'phase2b1-validation-series-a'
        and status = 'active'
        and stopped_after_occurrence is null) <> 1 then
    raise exception 'Same series_id for user B was not backfilled independently.';
  end if;

  if not exists (
    select 1 from public.future_bills
    where user_id = user_a
      and id = 'phase2b1-validation-legacy'
      and series_id is null
      and occurrence_number is null
  ) then
    raise exception 'Legacy row without series identity was changed.';
  end if;
end
$backfill_validation$;

-- Rollback validation: a forced DELETE failure occurs after the RPC starts.
begin;

create function public.phase2b1_force_delete_failure()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  raise exception 'Forced Phase 2B.1 rollback validation failure.';
end
$function$;

create trigger phase2b1_force_delete_failure_trigger
before delete on public.future_bills
for each row
when (old.id like 'phase2b1-validation-a-%')
execute function public.phase2b1_force_delete_failure();

select set_config(
  'request.jwt.claim.sub',
    '00000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

do $expected_rpc_failure$
begin
  begin
    perform public.stop_future_bill_series_from('phase2b1-validation-series-a', 2);
    raise exception 'RPC unexpectedly succeeded while the failure trigger was active.';
  exception
    when others then
      if sqlerrm <> 'Forced Phase 2B.1 rollback validation failure.' then
        raise;
      end if;
  end;
end
$expected_rpc_failure$;

reset role;

do $rollback_assertions$
declare
  user_a uuid;
begin
    user_a := '00000000-0000-0000-0000-000000000001';

  if not exists (
    select 1 from public.future_bill_series
    where user_id = user_a
      and series_id = 'phase2b1-validation-series-a'
      and status = 'active'
      and stopped_after_occurrence is null
  ) then
    raise exception 'Rollback failed: the series cutoff/status changed.';
  end if;

  if (select count(*) from public.future_bills
      where user_id = user_a
        and series_id = 'phase2b1-validation-series-a') <> 3 then
    raise exception 'Rollback failed: occurrences were partially deleted.';
  end if;
end
$rollback_assertions$;

rollback;

-- Successful stop, isolation, idempotency and cutoff enforcement.
begin;

select set_config(
  'request.jwt.claim.sub',
  '00000000-0000-0000-0000-000000000001',
  true
);
set local role authenticated;

do $rpc_validation$
declare
  first_result jsonb;
  repeated_result jsonb;
begin
  first_result := public.stop_future_bill_series_from('phase2b1-validation-series-a', 2);
  repeated_result := public.stop_future_bill_series_from('phase2b1-validation-series-a', 2);

  if first_result ->> 'status' <> 'stopped'
     or (first_result ->> 'stopped_after_occurrence')::integer <> 1
     or (first_result ->> 'deleted_occurrences')::integer <> 2 then
    raise exception 'First RPC result is invalid: %', first_result;
  end if;

  if (repeated_result ->> 'stopped_after_occurrence')::integer <> 1
     or (repeated_result ->> 'deleted_occurrences')::integer <> 0 then
    raise exception 'Repeated RPC call is not idempotent: %', repeated_result;
  end if;
end
$rpc_validation$;

do $insert_above_cutoff_must_fail$
begin
  begin
    insert into public.future_bills (
      user_id, id, series_id, occurrence_number, due_date, description,
      category, amount, recurring, frequency, priority, paid
    ) values (
      auth.uid(), 'phase2b1-validation-forbidden-insert',
      'phase2b1-validation-series-a', 4, '2026-11-01',
      'Inserção proibida', 'Validação', 10, true, 'Mensal', 'Média', false
    );
    raise exception 'INSERT above cutoff unexpectedly succeeded.';
  exception
    when check_violation then null;
  end;
end
$insert_above_cutoff_must_fail$;

do $update_above_cutoff_must_fail$
begin
  begin
    update public.future_bills
    set occurrence_number = 4
    where user_id = auth.uid()
      and id = 'phase2b1-validation-a-1';
    raise exception 'UPDATE above cutoff unexpectedly succeeded.';
  exception
    when check_violation then null;
  end;
end
$update_above_cutoff_must_fail$;

-- The other active series must still accept a new occurrence.
insert into public.future_bills (
  user_id, id, series_id, occurrence_number, due_date, description,
  category, amount, recurring, frequency, priority, paid
) values (
  auth.uid(), 'phase2b1-validation-active-insert',
  'phase2b1-validation-series-b', 2, '2026-09-02',
  'Série ativa permitida', 'Validação', 10, true, 'Mensal', 'Média', false
);

reset role;

do $successful_stop_assertions$
declare
  user_a uuid;
  user_b uuid;
begin
    user_a := '00000000-0000-0000-0000-000000000001';
    user_b := '00000000-0000-0000-0000-000000000002';

  if not exists (
    select 1 from public.future_bill_series
    where user_id = user_a
      and series_id = 'phase2b1-validation-series-a'
      and status = 'stopped'
      and stopped_after_occurrence = 1
  ) then
    raise exception 'Series was not stopped at N - 1.';
  end if;

  if not exists (
    select 1 from public.future_bills
    where user_id = user_a
      and id = 'phase2b1-validation-a-1'
      and occurrence_number = 1
  ) then
    raise exception 'Previous occurrence was not preserved.';
  end if;

  if exists (
    select 1 from public.future_bills
    where user_id = user_a
      and series_id = 'phase2b1-validation-series-a'
      and occurrence_number >= 2
  ) then
    raise exception 'Occurrence N or a later occurrence remains.';
  end if;

  if not exists (
    select 1 from public.future_bills
    where user_id = user_a
      and id = 'phase2b1-validation-b-1'
  ) then
    raise exception 'Another series belonging to the same user was changed.';
  end if;

  if (select count(*) from public.future_bills
      where user_id = user_b
        and series_id = 'phase2b1-validation-series-a') <> 2 then
    raise exception 'The same series_id belonging to another user was changed.';
  end if;

  if not exists (
    select 1 from public.future_bills
    where user_id = user_a
      and id = 'phase2b1-validation-active-insert'
  ) then
    raise exception 'An active series did not accept a new occurrence.';
  end if;
end
$successful_stop_assertions$;

rollback;

-- Privilege validation for the RPC.
select
  has_function_privilege('authenticated', 'public.stop_future_bill_series_from(text,integer)', 'EXECUTE') as authenticated_can_execute,
  has_function_privilege('anon', 'public.stop_future_bill_series_from(text,integer)', 'EXECUTE') as anon_can_execute,
  exists (
    select 1
    from pg_proc as function,
      lateral aclexplode(coalesce(function.proacl, acldefault('f', function.proowner))) as privilege
    where function.oid = 'public.stop_future_bill_series_from(text,integer)'::regprocedure
      and privilege.grantee = 0
      and privilege.privilege_type = 'EXECUTE'
  ) as public_can_execute;
