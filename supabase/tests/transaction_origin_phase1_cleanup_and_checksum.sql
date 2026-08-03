-- Run last. Deletes only the exact deterministic fixtures loaded before migration.
-- Replace both UUID placeholders with the same dedicated test users and compare checksum.

do $cleanup_precheck$
declare
  user_a uuid := '00000000-0000-0000-0000-000000000011';
  user_b uuid := '00000000-0000-0000-0000-000000000022';
begin
  if user_a = user_b then raise exception 'Transaction origin test users must be different.'; end if;
  if not exists (select 1 from auth.users where id = user_a)
     or not exists (select 1 from auth.users where id = user_b) then
    raise exception 'Both explicit transaction origin test users must exist in auth.users.';
  end if;

  if exists (
    select 1
    from public.transactions
    where id in (
      'phase1-origin-validation-a-legacy',
      'phase1-origin-validation-malformed',
      'phase1-origin-validation-unrelated'
    )
      and user_id <> user_a
  ) or exists (
    select 1
    from public.transactions
    where id = 'phase1-origin-validation-b-legacy'
      and user_id <> user_b
  ) then
    raise exception 'Fixture identifiers exist under an unexpected user; cleanup aborted.';
  end if;
end
$cleanup_precheck$;

begin;

delete from public.transactions
where (user_id, id) in (
  ('00000000-0000-0000-0000-000000000011'::uuid, 'phase1-origin-validation-a-legacy'),
  ('00000000-0000-0000-0000-000000000011'::uuid, 'phase1-origin-validation-malformed'),
  ('00000000-0000-0000-0000-000000000011'::uuid, 'phase1-origin-validation-unrelated'),
  ('00000000-0000-0000-0000-000000000022'::uuid, 'phase1-origin-validation-b-legacy')
);

commit;

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
