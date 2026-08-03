-- Verifies that a dedicated runtime probe is fully rolled back.
-- Replace both UUID placeholders with the same dedicated test users.

do $test_users$
declare
  user_a uuid := '00000000-0000-0000-0000-000000000011';
  user_b uuid := '00000000-0000-0000-0000-000000000022';
begin
  if user_a = user_b then raise exception 'Transaction origin test users must be different.'; end if;
  if not exists (select 1 from auth.users where id = user_a)
     or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'Both explicit transaction origin test users must exist in auth.users.';
  end if;
end
$test_users$;

begin;

insert into public.transactions (
  user_id, id, date, description, type, category, amount, payment_method,
  account_or_card, essential, paid, origin_type, origin_id
) values (
  '00000000-0000-0000-0000-000000000011'::uuid,
  'phase1-origin-validation-rollback-probe', '2026-08-20',
  'Rollback probe', 'expense', 'Validation', 30, 'Test', 'Test', false, true,
  'future_bill_payment', 'phase1-origin-validation-rollback-probe-bill'
);

rollback;

do $rollback_assertion$
begin
  if exists (
    select 1 from public.transactions
    where user_id = '00000000-0000-0000-0000-000000000011'::uuid
      and id = 'phase1-origin-validation-rollback-probe'
  ) then
    raise exception 'Rollback probe transaction remains after rollback.';
  end if;
end
$rollback_assertion$;
