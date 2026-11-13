import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseCall, type SupabaseResult } from './test/supabaseMock';

const fake = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('./lib/supabaseClient', () => ({
  isSupabaseConfigured: true,
  get supabase() { return fake.client; },
}));
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null, BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null, Legend: () => null, CartesianGrid: () => null, Cell: () => null,
  Pie: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));

import { App } from './App';
import { loadPendingDeletes } from './lib/storage';

type Row = Record<string, unknown>;
const mock = createSupabaseMock();
fake.client = mock.client;
const tables = new Map<string, Row[]>();
let heldTable: string | null = null;
let releaseDelete: (() => void) | null = null;
let deleteGate: Promise<void> | null = null;
let failInvestmentDelete = false;
let activeAuthUser = 'user-1';

function matches(row: Row, filters: Array<[string, unknown]>) {
  return filters.every(([key, value]) => key.endsWith('.gte')
    ? Number(row[key.slice(0, -4)]) >= Number(value)
    : row[key] === value);
}

async function resolve(call: SupabaseCall): Promise<SupabaseResult> {
  if (call.operation === 'delete' && call.table === heldTable && deleteGate) await deleteGate;
  if (call.operation === 'delete' && call.table === 'investments' && failInvestmentDelete
    && call.filters.some(([key, value]) => key === 'id' && value === 'v1')) {
    return { data: null, error: new Error('network unavailable') };
  }
  const rows = tables.get(call.table) || [];
  tables.set(call.table, rows);
  if (call.operation === 'delete') {
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      if (matches(rows[index], call.filters)) rows.splice(index, 1);
    }
    return { data: null, error: null };
  }
  if (call.operation === 'upsert' || call.operation === 'insert') {
    const incoming = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
    for (const row of incoming) {
      const index = rows.findIndex((saved) => saved.user_id === row.user_id
        && (call.options ? saved.id === row.id : true));
      if (call.operation === 'upsert' && index >= 0) rows[index] = { ...row };
      else rows.push({ ...row });
    }
    return { data: null, error: null };
  }
  const selected = rows.filter((row) => matches(row, call.filters)).map((row) => ({ ...row }));
  if (call.operation === 'maybeSingle') return { data: selected[0] || null, error: null };
  return { data: selected, count: selected.length, error: null };
}

beforeEach(() => {
  localStorage.clear();
  mock.reset();
  tables.clear();
  heldTable = null;
  releaseDelete = null;
  deleteGate = null;
  failInvestmentDelete = false;
  activeAuthUser = 'user-1';
  tables.set('app_settings', [{ user_id: 'user-1', currency: 'BRL', selected_month: '2026-07', starting_balance: 0 }]);
  tables.set('installments', [{ user_id: 'user-1', id: 'i1', purchase_date: '2026-07-01', description: 'Notebook', card_name: 'Visa', category: 'Compras', total_amount: 1200, installments: 12, first_installment_month: '2026-07', paid_installments: 0 }]);
  tables.set('investments', [{ user_id: 'user-1', id: 'v1', type: 'CDB', institution: 'Banco', initial_amount: 1000, current_amount: 1050, liquidity: 'Diária', goal: 'Reserva' }]);
  tables.set('budgets', [{ user_id: 'user-1', id: 'g1', month: '2026-07', category: 'Casa', monthly_budget: 500 }]);
  mock.setResolver(resolve);
  mock.auth.getSession = (async () => ({ data: { session: activeAuthUser
    ? { user: { id: activeAuthUser, email: `${activeAuthUser}@example.com` } } : null } })) as unknown as typeof mock.auth.getSession;
  mock.auth.signOut = (async () => {
    activeAuthUser = '';
    return { error: null };
  }) as unknown as typeof mock.auth.signOut;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

async function openApp() {
  const view = render(<App />);
  expect(await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 5000 })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTitle(/Online Supabase/)).toBeInTheDocument(), { timeout: 5000 });
  return view;
}

describe('explicit financial deletes from the UI', () => {
  it('keeps A pending across logout and B login, then flushes when A returns', async () => {
    const interaction = userEvent.setup();
    tables.get('app_settings')?.push({ user_id: 'user-2', currency: 'BRL', selected_month: '2026-07', starting_balance: 0 });
    const first = await openApp();
    failInvestmentDelete = true;
    await interaction.click(screen.getByRole('button', { name: 'Investimentos' }));
    await interaction.click(await screen.findByRole('button', { name: 'Excluir investimento CDB' }, { timeout: 5000 }));
    await screen.findByTitle(/Erro de sincronização · alterações pendentes/i, {}, { timeout: 5000 });
    expect(loadPendingDeletes('user-1')).toHaveLength(1);

    await interaction.click(screen.getByRole('button', { name: 'Sair' }));
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(loadPendingDeletes('user-1')).toHaveLength(1);
    const deletesAfterLogout = mock.calls.filter((call) => call.table === 'investments' && call.operation === 'delete').length;

    first.unmount();
    activeAuthUser = 'user-2';
    const second = render(<App />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle(/Online Supabase/)).toBeInTheDocument());
    expect(loadPendingDeletes('user-2')).toEqual([]);
    expect(loadPendingDeletes('user-1')).toHaveLength(1);
    expect(mock.calls.filter((call) => call.table === 'investments' && call.operation === 'delete')).toHaveLength(deletesAfterLogout);

    failInvestmentDelete = false;
    second.unmount();
    activeAuthUser = 'user-1';
    render(<App />);
    await waitFor(() => expect(loadPendingDeletes('user-1')).toEqual([]), { timeout: 5000 });
    expect(tables.get('investments')?.some((row) => row.id === 'v1')).toBe(false);
  }, 20000);

  it('hides a failed delete through reload and retries on reconnection', async () => {
    const interaction = userEvent.setup();
    const first = await openApp();
    failInvestmentDelete = true;
    await interaction.click(screen.getByRole('button', { name: 'Investimentos' }));
    await interaction.click(await screen.findByRole('button', { name: 'Excluir investimento CDB' }, { timeout: 5000 }));
    expect(screen.queryByRole('button', { name: 'Excluir investimento CDB' })).not.toBeInTheDocument();
    expect(await screen.findByTitle(/Erro de sincronização · alterações pendentes/i, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(loadPendingDeletes('user-1')).toContainEqual({ table: 'investments', id: 'v1' });
    first.unmount();

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Investimentos' }));
    expect(screen.queryByRole('button', { name: 'Excluir investimento CDB' })).not.toBeInTheDocument();
    expect(screen.queryByTitle(/Online Supabase/)).not.toBeInTheDocument();

    failInvestmentDelete = false;
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(loadPendingDeletes('user-1')).toEqual([]), { timeout: 5000 });
    expect(tables.get('investments')?.some((row) => row.id === 'v1')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Excluir investimento CDB' })).not.toBeInTheDocument();
  }, 15000);

  it('shows a sync error when the saved deletion journal is unreadable', async () => {
    const key = 'finance-control-pending-deletes-v1:user:user-1';
    localStorage.setItem(key, '{broken');
    render(<App />);
    expect(await screen.findByTitle(/Erro de sincronização/, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(localStorage.getItem(`${key}:corrupt`)).toBe('{broken');
    expect(localStorage.getItem(key)).toBe('{broken');
  });

  it('keeps an item visible and shows an error when the journal cannot be written', async () => {
    const interaction = userEvent.setup();
    await openApp();
    const original = Storage.prototype.setItem;
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith('finance-control-pending-deletes-v1:')) throw new DOMException('QuotaExceededError', 'QuotaExceededError');
      return original.call(this, key, value);
    });
    try {
      await interaction.click(screen.getByRole('button', { name: 'Investimentos' }));
      await interaction.click(await screen.findByRole('button', { name: 'Excluir investimento CDB' }, { timeout: 5000 }));
      expect(screen.getByRole('button', { name: 'Excluir investimento CDB' })).toBeInTheDocument();
      expect(screen.queryByTitle(/Online Supabase/)).not.toBeInTheDocument();
      expect(screen.getByTitle(/Erro de sincronização/)).toBeInTheDocument();
      expect(mock.calls.some((call) => call.table === 'investments' && call.operation === 'delete')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  }, 15000);

  it.each([
    { table: 'installments', id: 'i1', page: 'Cartões e parcelas', button: 'Excluir parcelamento Notebook' },
    { table: 'investments', id: 'v1', page: 'Investimentos', button: 'Excluir investimento CDB' },
    { table: 'budgets', id: 'g1', page: 'Metas e orçamento', button: 'Excluir orçamento de Casa' },
  ])('deletes $table by owner and id and keeps it absent after reload', async ({ table, id, page, button }) => {
    const interaction = userEvent.setup();
    const view = await openApp();
    heldTable = table;
    deleteGate = new Promise<void>((resolve) => { releaseDelete = resolve; });

    await interaction.click(screen.getByRole('button', { name: page }));
    await interaction.click(await screen.findByRole('button', { name: button }, { timeout: 5000 }));
    expect(loadPendingDeletes('user-1')).toContainEqual({ table, id });
    expect(screen.queryByTitle(/Online Supabase/)).not.toBeInTheDocument();
    await waitFor(() => expect(mock.calls.some((call) => call.table === table && call.operation === 'delete')).toBe(true), { timeout: 5000 });
    expect(screen.queryByTitle(/Online Supabase/)).not.toBeInTheDocument();

    releaseDelete?.();
    await waitFor(() => expect(tables.get(table)?.find((row) => row.id === id)).toBeUndefined(), { timeout: 5000 });
    await waitFor(() => expect(loadPendingDeletes('user-1')).toEqual([]), { timeout: 5000 });
    const deleteCall = mock.calls.find((call) => call.table === table && call.operation === 'delete');
    expect(deleteCall?.filters).toEqual([['user_id', 'user-1'], ['id', id]]);

    view.unmount();
    await openApp();
    await interaction.click(screen.getByRole('button', { name: page }));
    expect(screen.queryByRole('button', { name: button })).not.toBeInTheDocument();
  }, 15000);
});
