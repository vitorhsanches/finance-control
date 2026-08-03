-- Run first in the SQL Editor of a dedicated TEST project.
-- Replace both UUID placeholders with dedicated test users and record the checksum.

do $test_users$
declare
  user_a uuid := '00000000-0000-0000-0000-000000000011';
  user_b uuid := '00000000-0000-0000-0000-000000000022';
  duplicate_origins bigint;
begin
  if user_a = user_b then
    raise exception 'Transaction origin test users must be different.';
  end if;

  if not exists (select 1 from auth.users where id = user_a)
     or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'Both explicit transaction origin test users must exist in auth.users.';
  end if;

  if exists (
    select 1
    from public.transactions
    where (user_id = user_a or user_id = user_b)
      and id in (
        'phase1-origin-validation-a-legacy',
        'phase1-origin-validation-b-legacy',
        'phase1-origin-validation-malformed',
        'phase1-origin-validation-unrelated'
      )
  ) then
    raise exception 'Deterministic transaction origin fixture identifiers already exist.';
  end if;

  select count(*)
  into duplicate_origins
  from (
    select
      user_id,
      substring(source from '^future-bill:([^:[:space:]]+)$') as future_bill_id
    from public.transactions
    where source ~ '^future-bill:[^:[:space:]]+$'
    group by user_id, substring(source from '^future-bill:([^:[:space:]]+)$')
    having count(*) > 1
  ) as duplicates;

  if duplicate_origins > 0 then
    raise exception 'Preflight blocked: % duplicate future bill payment origin(s) found.', duplicate_origins;
  end if;
end
$test_users$;

select
  count(*) as total_transactions,
  md5(
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'user_id', item.user_id, 'id', item.id, 'date', item.date,
          'description', item.description, 'type', item.type,
          'category', item.category, 'subcategory', item.subcategory,
          'amount', item.amount, 'payment_method', item.payment_method,
          'account_or_card', item.account_or_card, 'essential', item.essential,
          'paid', item.paid, 'source', item.source,
          'external_hash', item.external_hash, 'notes', item.notes,
          'created_at', item.created_at, 'updated_at', item.updated_at
        ) order by item.user_id, item.id
      ),
      '[]'::jsonb
    )::text
  ) as transactions_checksum
from public.transactions as item;
