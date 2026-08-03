-- Run after structural validation. All mutations in this script are rolled back.
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
  account_or_card, essential, paid, source
) values (
  '00000000-0000-0000-0000-000000000011'::uuid,
  'phase1-origin-validation-trigger-legacy', '2026-08-10',
  'Trigger legacy fixture', 'expense', 'Validation', 20, 'Test', 'Test', false, true,
  'future-bill:phase1-origin-validation-trigger-legacy-bill'
);

do $legacy_write_assertion$
begin
  if not exists (
    select 1 from public.transactions
    where user_id = '00000000-0000-0000-0000-000000000011'::uuid
      and id = 'phase1-origin-validation-trigger-legacy'
      and origin_type = 'future_bill_payment'
      and origin_id = 'phase1-origin-validation-trigger-legacy-bill'
  ) then
    raise exception 'Legacy source did not receive structured origin.';
  end if;
end
$legacy_write_assertion$;

insert into public.transactions (
  user_id, id, date, description, type, category, amount, payment_method,
  account_or_card, essential, paid, origin_type, origin_id
) values (
  '00000000-0000-0000-0000-000000000011'::uuid,
  'phase1-origin-validation-trigger-structured', '2026-08-11',
  'Trigger structured fixture', 'expense', 'Validation', 21, 'Test', 'Test', false, true,
  'future_bill_payment', 'phase1-origin-validation-trigger-structured-bill'
);

do $structured_write_assertion$
begin
  if not exists (
    select 1 from public.transactions
    where user_id = '00000000-0000-0000-0000-000000000011'::uuid
      and id = 'phase1-origin-validation-trigger-structured'
      and source = 'future-bill:phase1-origin-validation-trigger-structured-bill'
  ) then
    raise exception 'Structured origin did not receive legacy source.';
  end if;
end
$structured_write_assertion$;

insert into public.transactions (
  user_id, id, date, description, type, category, amount, payment_method,
  account_or_card, essential, paid, source
) values (
  '00000000-0000-0000-0000-000000000011'::uuid,
  'phase1-origin-validation-trigger-unknown', '2026-08-12',
  'Unknown source fixture', 'expense', 'Validation', 22, 'Test', 'Test', false, true,
  'unknown-origin-source'
);

do $unknown_source_assertion$
begin
  if not exists (
    select 1 from public.transactions
    where user_id = '00000000-0000-0000-0000-000000000011'::uuid
      and id = 'phase1-origin-validation-trigger-unknown'
      and origin_type is null
      and origin_id is null
      and source = 'unknown-origin-source'
  ) then
    raise exception 'Unknown source was interpreted or overwritten.';
  end if;
end
$unknown_source_assertion$;

do $conflict_must_fail$
begin
  begin
    insert into public.transactions (
      user_id, id, date, description, type, category, amount, payment_method,
      account_or_card, essential, paid, source, origin_type, origin_id
    ) values (
      '00000000-0000-0000-0000-000000000011'::uuid,
      'phase1-origin-validation-trigger-conflict', '2026-08-13',
      'Conflict fixture', 'expense', 'Validation', 23, 'Test', 'Test', false, true,
      'future-bill:phase1-origin-validation-source-a',
      'future_bill_payment', 'phase1-origin-validation-source-b'
    );
    raise exception 'Conflicting source and origin unexpectedly succeeded.';
  exception
    when raise_exception then
      if sqlerrm <> 'Transaction source conflicts with its structured origin.' then raise; end if;
  end;
end
$conflict_must_fail$;

insert into public.transactions (
  user_id, id, date, description, type, category, amount, payment_method,
  account_or_card, essential, paid, origin_type, origin_id
) values (
  '00000000-0000-0000-0000-000000000011'::uuid,
  'phase1-origin-validation-unique-a', '2026-08-14',
  'Unique index fixture A', 'expense', 'Validation', 24, 'Test', 'Test', false, true,
  'future_bill_payment', 'phase1-origin-validation-unique-bill'
);

do $duplicate_same_user_must_fail$
begin
  begin
    insert into public.transactions (
      user_id, id, date, description, type, category, amount, payment_method,
      account_or_card, essential, paid, origin_type, origin_id
    ) values (
      '00000000-0000-0000-0000-000000000011'::uuid,
      'phase1-origin-validation-unique-duplicate', '2026-08-14',
      'Duplicate fixture', 'expense', 'Validation', 24, 'Test', 'Test', false, true,
      'future_bill_payment', 'phase1-origin-validation-unique-bill'
    );
    raise exception 'Duplicate structured origin unexpectedly succeeded.';
  exception when unique_violation then null;
  end;
end
$duplicate_same_user_must_fail$;

insert into public.transactions (
  user_id, id, date, description, type, category, amount, payment_method,
  account_or_card, essential, paid, origin_type, origin_id
) values (
  '00000000-0000-0000-0000-000000000022'::uuid,
  'phase1-origin-validation-unique-b', '2026-08-14',
  'Unique index fixture B', 'expense', 'Validation', 24, 'Test', 'Test', false, true,
  'future_bill_payment', 'phase1-origin-validation-unique-bill'
);

update public.transactions
set description = 'Updated without touching origin'
where user_id = '00000000-0000-0000-0000-000000000011'::uuid
  and id = 'phase1-origin-validation-trigger-structured';

do $update_assertion$
begin
  if not exists (
    select 1 from public.transactions
    where user_id = '00000000-0000-0000-0000-000000000011'::uuid
      and id = 'phase1-origin-validation-trigger-structured'
      and origin_type = 'future_bill_payment'
      and origin_id = 'phase1-origin-validation-trigger-structured-bill'
      and source = 'future-bill:phase1-origin-validation-trigger-structured-bill'
  ) then
    raise exception 'Unrelated UPDATE changed a valid structured origin.';
  end if;
end
$update_assertion$;

rollback;
