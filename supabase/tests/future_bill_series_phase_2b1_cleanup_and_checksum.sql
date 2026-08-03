-- Run after all Phase 2B.1 runtime tests in the TEST project.
-- This removes only deterministic validation fixtures. Compare the returned
-- count/checksum with the values recorded before fixture insertion.

-- Replace both UUIDs with the dedicated test users used by the fixture script.
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

begin;

delete from public.future_bills
where user_id in (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  )
  and id like 'phase2b1-validation-%';

delete from public.future_bill_series
where user_id in (
    '00000000-0000-0000-0000-000000000001'::uuid,
    '00000000-0000-0000-0000-000000000002'::uuid
  )
  and series_id like 'phase2b1-validation-%';

commit;

select
  count(*) as total_future_bills,
  md5(
    coalesce(
      jsonb_agg(to_jsonb(bill) order by user_id, id),
      '[]'::jsonb
    )::text
  ) as future_bills_checksum
from public.future_bills as bill;
