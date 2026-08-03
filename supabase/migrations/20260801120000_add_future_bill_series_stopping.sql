-- Phase 2B.1: persistent stopping for recurring future-bill series.
-- The preflight block intentionally aborts before any DDL when existing
-- explicit recurrence identities are inconsistent.
do $preflight$
declare
  invalid_series_without_occurrence bigint;
  invalid_occurrence_without_series bigint;
  invalid_occurrence_number bigint;
  duplicate_occurrence bigint;
  blank_series_id bigint;
begin
  select count(*) into invalid_series_without_occurrence
  from public.future_bills
  where series_id is not null
    and occurrence_number is null;

  select count(*) into invalid_occurrence_without_series
  from public.future_bills
  where occurrence_number is not null
    and series_id is null;

  select count(*) into invalid_occurrence_number
  from public.future_bills
  where occurrence_number is not null
    and occurrence_number < 1;

  select count(*) into duplicate_occurrence
  from (
    select user_id, series_id, occurrence_number
    from public.future_bills
    where series_id is not null
      and occurrence_number is not null
    group by user_id, series_id, occurrence_number
    having count(*) > 1
  ) duplicates;

  select count(*) into blank_series_id
  from public.future_bills
  where series_id is not null
    and btrim(series_id) = '';

  if invalid_series_without_occurrence > 0 then
    raise exception 'Migration blocked: % future_bills row(s) have series_id without occurrence_number.', invalid_series_without_occurrence;
  end if;

  if invalid_occurrence_without_series > 0 then
    raise exception 'Migration blocked: % future_bills row(s) have occurrence_number without series_id.', invalid_occurrence_without_series;
  end if;

  if invalid_occurrence_number > 0 then
    raise exception 'Migration blocked: % future_bills row(s) have occurrence_number lower than 1.', invalid_occurrence_number;
  end if;

  if duplicate_occurrence > 0 then
    raise exception 'Migration blocked: % duplicate user_id + series_id + occurrence_number group(s) exist.', duplicate_occurrence;
  end if;

  if blank_series_id > 0 then
    raise exception 'Migration blocked: % future_bills row(s) have a blank series_id.', blank_series_id;
  end if;
end
$preflight$;

create table if not exists public.future_bill_series (
  user_id uuid not null references auth.users(id) on delete cascade,
  series_id text not null,
  status text not null default 'active',
  stopped_after_occurrence integer null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint future_bill_series_pkey primary key (user_id, series_id),
  constraint future_bill_series_id_not_blank_check check (btrim(series_id) <> ''),
  constraint future_bill_series_status_check check (status in ('active', 'stopped')),
  constraint future_bill_series_stop_consistency_check check (
    (status = 'active' and stopped_after_occurrence is null)
    or
    (status = 'stopped' and stopped_after_occurrence is not null and stopped_after_occurrence >= 0)
  )
);

alter table public.future_bill_series enable row level security;

revoke all on table public.future_bill_series from public;
revoke all on table public.future_bill_series from anon;
revoke all on table public.future_bill_series from authenticated;
grant select, insert, update on table public.future_bill_series to authenticated;

drop policy if exists "Users can read own future bill series" on public.future_bill_series;
create policy "Users can read own future bill series"
  on public.future_bill_series
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "Users can create own future bill series" on public.future_bill_series;
create policy "Users can create own future bill series"
  on public.future_bill_series
  for insert
  to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update own future bill series" on public.future_bill_series;
create policy "Users can update own future bill series"
  on public.future_bill_series
  for update
  to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- Only rows with an explicit identity are backfilled. Legacy null identities
-- remain untouched and do not become members of an inferred series.
insert into public.future_bill_series (user_id, series_id, status, stopped_after_occurrence)
select distinct user_id, series_id, 'active', null
from public.future_bills
where series_id is not null
  and occurrence_number is not null
on conflict (user_id, series_id) do nothing;

do $constraints$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.future_bills'::regclass
      and conname = 'future_bills_series_identity_pair_check'
  ) then
    alter table public.future_bills
      add constraint future_bills_series_identity_pair_check
      check (
        (series_id is null and occurrence_number is null)
        or
        (series_id is not null and occurrence_number is not null)
      );
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.future_bills'::regclass
      and conname = 'future_bills_occurrence_number_positive_check'
  ) then
    alter table public.future_bills
      add constraint future_bills_occurrence_number_positive_check
      check (occurrence_number is null or occurrence_number >= 1);
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.future_bills'::regclass
      and conname = 'future_bills_series_fkey'
  ) then
    alter table public.future_bills
      add constraint future_bills_series_fkey
      foreign key (user_id, series_id)
      references public.future_bill_series (user_id, series_id)
      on update restrict
      on delete restrict;
  end if;
end
$constraints$;

create unique index if not exists future_bills_user_series_occurrence_unique_idx
  on public.future_bills (user_id, series_id, occurrence_number)
  where series_id is not null;

create or replace function public.prevent_future_bill_series_reactivation()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
begin
  if old.status = 'stopped' and (
    new.status <> 'stopped'
    or new.stopped_after_occurrence is null
    or new.stopped_after_occurrence > old.stopped_after_occurrence
  ) then
    raise exception 'A stopped future bill series cannot be reactivated or extend its cutoff.'
      using errcode = '23514';
  end if;

  -- UPDATE is required by the SECURITY INVOKER RPC. Keep direct updates safe as
  -- well: lowering the cutoff removes disallowed occurrences in this same
  -- transaction, under the caller's RLS permissions.
  if new.status = 'stopped' and (
    old.status = 'active'
    or new.stopped_after_occurrence < old.stopped_after_occurrence
  ) then
    delete from public.future_bills as bill
    where bill.user_id = new.user_id
      and bill.series_id = new.series_id
      and bill.occurrence_number > new.stopped_after_occurrence;
  end if;

  new.updated_at := now();
  return new;
end
$function$;

drop trigger if exists prevent_future_bill_series_reactivation_trigger
  on public.future_bill_series;
create trigger prevent_future_bill_series_reactivation_trigger
before update on public.future_bill_series
for each row
execute function public.prevent_future_bill_series_reactivation();

create or replace function public.enforce_future_bill_series_cutoff()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  series_status text;
  series_cutoff integer;
begin
  if new.series_id is null then
    return new;
  end if;

  select series.status, series.stopped_after_occurrence
    into series_status, series_cutoff
  from public.future_bill_series as series
  where series.user_id = new.user_id
    and series.series_id = new.series_id
  for key share;

  if not found then
    raise exception 'Future bill series does not exist for this user.'
      using errcode = '23503';
  end if;

  if series_status = 'stopped' and new.occurrence_number > series_cutoff then
    raise exception 'Occurrence % is above the stopped cutoff % for this future bill series.',
      new.occurrence_number,
      series_cutoff
      using errcode = '23514';
  end if;

  return new;
end
$function$;

drop trigger if exists enforce_future_bill_series_cutoff_trigger
  on public.future_bills;
create trigger enforce_future_bill_series_cutoff_trigger
before insert or update of user_id, series_id, occurrence_number
on public.future_bills
for each row
execute function public.enforce_future_bill_series_cutoff();

create or replace function public.stop_future_bill_series_from(
  series_id text,
  occurrence_number integer
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  current_user_id uuid := auth.uid();
  requested_cutoff integer;
  existing_status text;
  existing_cutoff integer;
  effective_cutoff integer;
  deleted_occurrences bigint;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;

  if series_id is null or btrim(series_id) = '' then
    raise exception 'series_id is required.' using errcode = '22023';
  end if;

  if occurrence_number is null or occurrence_number < 1 then
    raise exception 'occurrence_number must be at least 1.' using errcode = '22023';
  end if;

  requested_cutoff := occurrence_number - 1;

  select series.status, series.stopped_after_occurrence
    into existing_status, existing_cutoff
  from public.future_bill_series as series
  where series.user_id = current_user_id
    and series.series_id = stop_future_bill_series_from.series_id
  for update;

  if not found then
    raise exception 'Future bill series was not found for the authenticated user.'
      using errcode = 'P0002';
  end if;

  effective_cutoff := case
    when existing_status = 'active' then requested_cutoff
    else least(existing_cutoff, requested_cutoff)
  end;

  select count(*) into deleted_occurrences
  from public.future_bills as bill
  where bill.user_id = current_user_id
    and bill.series_id = stop_future_bill_series_from.series_id
    and bill.occurrence_number > effective_cutoff;

  update public.future_bill_series as series
  set status = 'stopped',
      stopped_after_occurrence = effective_cutoff,
      updated_at = now()
  where series.user_id = current_user_id
    and series.series_id = stop_future_bill_series_from.series_id
  returning series.stopped_after_occurrence into effective_cutoff;

  delete from public.future_bills as bill
  where bill.user_id = current_user_id
    and bill.series_id = stop_future_bill_series_from.series_id
    and bill.occurrence_number > effective_cutoff;

  return jsonb_build_object(
    'series_id', series_id,
    'status', 'stopped',
    'stopped_after_occurrence', effective_cutoff,
    'deleted_occurrences', deleted_occurrences
  );
end
$function$;

revoke all on function public.stop_future_bill_series_from(text, integer) from public;
revoke all on function public.stop_future_bill_series_from(text, integer) from anon;
grant execute on function public.stop_future_bill_series_from(text, integer) to authenticated;

revoke all on function public.prevent_future_bill_series_reactivation() from public;
revoke all on function public.prevent_future_bill_series_reactivation() from anon;
revoke all on function public.prevent_future_bill_series_reactivation() from authenticated;
revoke all on function public.enforce_future_bill_series_cutoff() from public;
revoke all on function public.enforce_future_bill_series_cutoff() from anon;
revoke all on function public.enforce_future_bill_series_cutoff() from authenticated;
