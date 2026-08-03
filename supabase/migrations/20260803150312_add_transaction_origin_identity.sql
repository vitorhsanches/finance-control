alter table public.transactions
  add column if not exists origin_type text,
  add column if not exists origin_id text,
  add column if not exists import_id text;

-- Abort before backfill when a legacy source would map more than one payment
-- transaction to the same future bill for the same user.
do $preflight$
declare
  duplicate_origins bigint;
begin
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
    raise exception
      'Migration blocked: % duplicate future bill payment origin(s) found.',
      duplicate_origins;
  end if;
end
$preflight$;

update public.transactions
set
  origin_type = 'future_bill_payment',
  origin_id = substring(source from '^future-bill:([^:[:space:]]+)$')
where origin_type is null
  and origin_id is null
  and source ~ '^future-bill:[^:[:space:]]+$';

alter table public.transactions
  add constraint transactions_origin_type_check
  check (
    origin_type is null
    or origin_type in (
      'manual',
      'future_bill_payment',
      'installment_payment',
      'bank_import'
    )
  ),
  add constraint transactions_origin_consistency_check
  check (
    (origin_type is null and origin_id is null)
    or (origin_type = 'manual' and origin_id is null)
    or (
      origin_type in (
        'future_bill_payment',
        'installment_payment',
        'bank_import'
      )
      and origin_id is not null
      and btrim(origin_id) <> ''
    )
  ),
  add constraint transactions_import_origin_check
  check (import_id is null or origin_type = 'bank_import');

create or replace function public.sync_transaction_origin_compatibility()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  legacy_future_bill_id text;
begin
  legacy_future_bill_id := substring(
    new.source from '^future-bill:([^:[:space:]]+)$'
  );

  if legacy_future_bill_id is not null then
    if new.origin_type is null and new.origin_id is null then
      new.origin_type := 'future_bill_payment';
      new.origin_id := legacy_future_bill_id;
    elsif new.origin_type is distinct from 'future_bill_payment'
       or new.origin_id is distinct from legacy_future_bill_id then
      raise exception 'Transaction source conflicts with its structured origin.';
    end if;
  elsif new.origin_type = 'future_bill_payment' then
    if new.source is null or btrim(new.source) = '' then
      new.source := 'future-bill:' || new.origin_id;
    else
      raise exception 'Transaction source conflicts with its structured origin.';
    end if;
  end if;

  return new;
end
$function$;

drop trigger if exists sync_transaction_origin_compatibility_trigger
  on public.transactions;
create trigger sync_transaction_origin_compatibility_trigger
before insert or update of source, origin_type, origin_id
on public.transactions
for each row
execute function public.sync_transaction_origin_compatibility();

revoke all on function public.sync_transaction_origin_compatibility() from public;
revoke all on function public.sync_transaction_origin_compatibility() from anon;
revoke all on function public.sync_transaction_origin_compatibility() from authenticated;

create unique index transactions_user_origin_unique_idx
  on public.transactions (user_id, origin_type, origin_id)
  where origin_type is not null
    and origin_type <> 'manual'
    and origin_id is not null
    and btrim(origin_id) <> '';
