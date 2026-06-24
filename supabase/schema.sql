-- Finance Control - schema inicial
-- Estratégia inicial: salvar o estado financeiro inteiro em JSONB por usuário.
-- Isso acelera o MVP com login. Depois dá para normalizar em tabelas separadas.

create table if not exists public.finance_states (
  user_id uuid primary key references auth.users(id) on delete cascade,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.finance_states enable row level security;

drop policy if exists "Users can read own finance state" on public.finance_states;
create policy "Users can read own finance state"
  on public.finance_states
  for select
  using (auth.uid() = user_id);

drop policy if exists "Users can insert own finance state" on public.finance_states;
create policy "Users can insert own finance state"
  on public.finance_states
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users can update own finance state" on public.finance_states;
create policy "Users can update own finance state"
  on public.finance_states
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "Users can delete own finance state" on public.finance_states;
create policy "Users can delete own finance state"
  on public.finance_states
  for delete
  using (auth.uid() = user_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_finance_states_updated_at on public.finance_states;
create trigger set_finance_states_updated_at
before update on public.finance_states
for each row execute function public.set_updated_at();
