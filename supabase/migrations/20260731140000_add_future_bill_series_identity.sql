alter table public.future_bills
  add column if not exists series_id text null,
  add column if not exists occurrence_number integer null;

create index if not exists future_bills_user_series_occurrence_idx
  on public.future_bills (user_id, series_id, occurrence_number);
