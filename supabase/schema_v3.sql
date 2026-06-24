-- Finance Control v3 - structured database schema
-- Run this file in Supabase SQL Editor before deploying/running v3.
-- It can coexist with the old finance_states table used in v2.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  currency text not null default 'BRL',
  selected_month text not null,
  starting_balance numeric(14,2) not null default 0,
  monthly_income_estimate numeric(14,2) not null default 0,
  monthly_saving_goal numeric(14,2) not null default 0,
  emergency_contribution numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('expense', 'income')),
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, kind, name)
);

create table if not exists public.accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, name)
);

create table if not exists public.card_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_name text not null,
  closing_day int not null default 1 check (closing_day between 1 and 31),
  due_day int not null default 1 check (due_day between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, card_name)
);

create table if not exists public.transactions (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  date date,
  description text not null default '',
  type text not null check (type in ('income', 'expense')),
  category text not null default '',
  subcategory text,
  amount numeric(14,2) not null default 0,
  payment_method text not null default '',
  account_or_card text not null default '',
  essential boolean not null default false,
  paid boolean not null default true,
  source text,
  external_hash text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create unique index if not exists transactions_user_external_hash_idx
  on public.transactions (user_id, external_hash)
  where external_hash is not null and external_hash <> '';

create index if not exists transactions_user_date_idx on public.transactions (user_id, date desc);
create index if not exists transactions_user_category_idx on public.transactions (user_id, category);

create table if not exists public.installments (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  purchase_date date,
  description text not null default '',
  card_name text not null default '',
  category text not null default '',
  total_amount numeric(14,2) not null default 0,
  installments int not null default 1 check (installments >= 1),
  first_installment_month text not null default '',
  paid_installments int not null default 0 check (paid_installments >= 0),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists installments_user_purchase_date_idx on public.installments (user_id, purchase_date desc);

create table if not exists public.future_bills (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  due_date date,
  description text not null default '',
  category text not null default '',
  amount numeric(14,2) not null default 0,
  recurring boolean not null default false,
  frequency text not null default 'Única' check (frequency in ('Mensal', 'Anual', 'Única')),
  priority text not null default 'Média' check (priority in ('Baixa', 'Média', 'Alta')),
  paid boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists future_bills_user_due_date_idx on public.future_bills (user_id, due_date asc);

create table if not exists public.investments (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null default '',
  institution text not null default '',
  initial_amount numeric(14,2) not null default 0,
  current_amount numeric(14,2) not null default 0,
  liquidity text not null default '',
  goal text not null default '',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.budgets (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  month text not null,
  category text not null default '',
  monthly_budget numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create index if not exists budgets_user_month_idx on public.budgets (user_id, month desc);

create table if not exists public.imports (
  id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_names jsonb not null default '[]'::jsonb,
  imported_count int not null default 0,
  ignored_count int not null default 0,
  status text not null default 'completed' check (status in ('draft', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.import_items (
  id uuid primary key default gen_random_uuid(),
  import_id text not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id text,
  external_hash text,
  raw jsonb,
  status text not null default 'imported' check (status in ('pending', 'imported', 'ignored')),
  created_at timestamptz not null default now(),
  foreign key (user_id, import_id) references public.imports(user_id, id) on delete cascade
);

-- RLS
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.categories enable row level security;
alter table public.accounts enable row level security;
alter table public.cards enable row level security;
alter table public.payment_methods enable row level security;
alter table public.card_rules enable row level security;
alter table public.transactions enable row level security;
alter table public.installments enable row level security;
alter table public.future_bills enable row level security;
alter table public.investments enable row level security;
alter table public.budgets enable row level security;
alter table public.imports enable row level security;
alter table public.import_items enable row level security;

-- Policies are written as DO blocks so this file can be safely re-run.
do $$
declare
  t text;
begin
  foreach t in array array[
    'profiles',
    'app_settings',
    'categories',
    'accounts',
    'cards',
    'payment_methods',
    'card_rules',
    'transactions',
    'installments',
    'future_bills',
    'investments',
    'budgets',
    'imports',
    'import_items'
  ]
  loop
    execute format('drop policy if exists "Users can manage own %I" on public.%I', t, t);
    execute format('create policy "Users can manage own %I" on public.%I for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id)', t, t);
  end loop;
end $$;
