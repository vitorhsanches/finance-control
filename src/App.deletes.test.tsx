import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseMock, type SupabaseCall, type SupabaseResult } from './test/supabaseMock';

// Reprodução de exclusão persistente pela UI. Usa o storage real e um Supabase falso
// em memória (sem rede e sem credenciais). Testes marcados como FALHA devem falhar antes da correção.

const fake = vi.hoisted(() => ({ client: null as unknown }));

vi.mock('./lib/supabaseClient', () => ({
  isSupabaseConfigured: true,
  get supabase() {
    return fake.client;
  }
}));

vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Bar: () => null,
  Legend: () => null,
  CartesianGrid: () => null,
  Cell: () => null,
  Pie: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  PieChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null
}));

import { App } from './App';

type Row = Record<string, any>;
type Match = (call: SupabaseCall) => boolean;

const user = { id: 'user-1', email: 'user@example.com' };

// Banco Supabase falso em memória: upsert por (user_id, id), delete/select com filtros reais.
class FakeRemote {
  private readonly tables = new Map<string, Row[]>();
  private failures: Array<{ match: Match; error: Error }> = [];

  reset() {
    this.tables.clear();
    this.failures = [];
  }

  seed(table: string, rows: Row[]) {
    this.tables.set(table, rows.map((row) => ({ ...row })));
  }

  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  failNext(match: Match, error: Error) {
    this.failures.push({ match, error });
  }

  async resolve(call: SupabaseCall): Promise<SupabaseResult> {
    const failureIndex = this.failures.findIndex((failure) => failure.match(call));
    if (failureIndex >= 0) {
      const [failure] = this.failures.splice(failureIndex, 1);
      return { data: null, error: failure.error };
    }

    const rows = this.tables.get(call.table) ?? [];
    this.tables.set(call.table, rows);

    if (call.operation === 'upsert') {
      const payloads = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
      const keys = call.options ? ['user_id', 'id'] : ['user_id'];
      for (const incoming of payloads) {
        const index = rows.findIndex((row) => keys.every((key) => row[key] === incoming[key]));
        if (index >= 0) rows[index] = { ...incoming };
        else rows.push({ ...incoming });
      }
      return { data: null, error: null };
    }

    if (call.operation === 'insert') {
      const payloads = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
      rows.push(...payloads.map((row) => ({ ...row })));
      return { data: null, error: null };
    }

    if (call.operation === 'delete') {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], call.filters)) rows.splice(index, 1);
      }
      return { data: null, error: null };
    }

    const matched = rows.filter((row) => matches(row, call.filters)).map((row) => ({ ...row }));
    if ((call.options as { head?: boolean } | undefined)?.head) {
      return { data: null, error: null, count: matched.length };
    }
    if (call.operation === 'maybeSingle') {
      return { data: matched[0] ?? null, error: null };
    }
    return { data: matched, error: null, count: matched.length };
  }
}

function matches(row: Row, filters: Array<[string, unknown]>) {
  return filters.every(([column, value]) => {
    if (column.endsWith('.gte')) return Number(row[column.slice(0, -4)]) >= Number(value);
    return row[column] === value;
  });
}

const remoteDb = new FakeRemote();
const remote = createSupabaseMock();
fake.client = remote.client;

function seedRemote() {
  remoteDb.seed('app_settings', [{
    user_id: 'user-1',
    currency: 'BRL',
    selected_month: '2026-07',
    starting_balance: 0,
    monthly_income_estimate: 0,
    monthly_saving_goal: 0,
    emergency_contribution: 0
  }]);
  remoteDb.seed('transactions', [
    transactionRow('t1', 'Mercado Teste'),
    transactionRow('t2', 'Padaria Teste')
  ]);
  remoteDb.seed('future_bills', [{
    user_id: 'user-1',
    id: 'b1',
    due_date: '2026-07-20',
    description: 'Internet Teste',
    category: 'Casa',
    amount: 100,
    recurring: false,
    frequency: 'Única',
    priority: 'Alta',
    paid: false,
    series_id: null,
    occurrence_number: null
  }]);
}

function transactionRow(id: string, description: string): Row {
  return {
    user_id: 'user-1',
    id,
    date: '2026-07-10',
    description,
    type: 'expense',
    category: 'Casa',
    amount: 25,
    payment_method: 'Pix',
    account_or_card: 'Conta',
    essential: true,
    paid: true
  };
}

function remoteIds(table: string): string[] {
  return remoteDb.rows(table).filter((row) => row.user_id === 'user-1').map((row) => row.id).sort();
}

function isTransactionDelete(call: SupabaseCall) {
  return call.table === 'transactions' && call.operation === 'delete';
}

async function openApp() {
  const view = render(<App />);
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTitle(/Online Supabase/)).toBeInTheDocument(), { timeout: 3000 });
  return view;
}

beforeEach(() => {
  localStorage.clear();
  remote.reset();
  remoteDb.reset();
  seedRemote();
  remote.setResolver((call) => remoteDb.resolve(call));
  remote.auth.getSession = (async () => ({ data: { session: { user } } })) as unknown as typeof remote.auth.getSession;
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

describe('persistent deletes through the app shell', () => {
  it('A01 excluir lançamento pela UI remove do remoto e não volta em um novo carregamento (PASSA)', async () => {
    const interaction = userEvent.setup();
    const view = await openApp();

    await interaction.click(screen.getByRole('button', { name: 'Lançamentos' }));
    await interaction.click(await screen.findByRole('button', { name: 'Excluir lançamento Mercado Teste' }));

    await waitFor(() => expect(remoteIds('transactions')).toEqual(['t2']));
    view.unmount();

    await openApp();
    await interaction.click(screen.getByRole('button', { name: 'Lançamentos' }));
    expect(await screen.findByRole('button', { name: 'Excluir lançamento Padaria Teste' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Excluir lançamento Mercado Teste' })).not.toBeInTheDocument();
  });

  it('A02 excluir conta futura pela UI remove do remoto (PASSA)', async () => {
    const interaction = userEvent.setup();
    await openApp();

    await interaction.click(screen.getByRole('button', { name: 'Contas futuras' }));
    await interaction.click(await screen.findByRole('button', { name: 'Excluir conta futura Internet Teste' }));

    await waitFor(() => expect(remoteIds('future_bills')).toEqual([]));
  });

  it('A03 falha de rede oculta o lançamento e sinaliza a exclusão pendente', async () => {
    const interaction = userEvent.setup();
    await openApp();
    remoteDb.failNext(isTransactionDelete, new TypeError('Failed to fetch'));

    await interaction.click(screen.getByRole('button', { name: 'Lançamentos' }));
    await interaction.click(await screen.findByRole('button', { name: 'Excluir lançamento Mercado Teste' }));

    await waitFor(() => expect(remote.calls.some(isTransactionDelete)).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Excluir lançamento Mercado Teste' })).not.toBeInTheDocument());
    expect(remoteIds('transactions')).toEqual(['t1', 't2']);
  });

  it('A04 nova tentativa da sincronização exclui o lançamento pendente', async () => {
    const interaction = userEvent.setup();
    await openApp();
    remoteDb.failNext(isTransactionDelete, new TypeError('Failed to fetch'));

    await interaction.click(screen.getByRole('button', { name: 'Lançamentos' }));
    await interaction.click(await screen.findByRole('button', { name: 'Excluir lançamento Mercado Teste' }));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Excluir lançamento Mercado Teste' })).not.toBeInTheDocument());
    expect(await screen.findByTitle(/Erro de sincronização · alterações pendentes/i)).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Ver detalhes de sincronização' }));
    await interaction.click(screen.getByRole('button', { name: 'Tentar novamente' }));

    await waitFor(() => expect(remoteIds('transactions')).toEqual(['t2']));
    expect(remote.calls.filter(isTransactionDelete).slice(-1)[0]?.filters).toEqual([['user_id', 'user-1'], ['id', 't1']]);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Excluir lançamento Mercado Teste' })).not.toBeInTheDocument());
  });

  it('A05 exclusão que falhou por rede sobrevive a reinício do app e é reenviada (FALHA esperada)', async () => {
    const interaction = userEvent.setup();
    const view = await openApp();
    remoteDb.failNext(isTransactionDelete, new TypeError('Failed to fetch'));

    await interaction.click(screen.getByRole('button', { name: 'Lançamentos' }));
    await interaction.click(await screen.findByRole('button', { name: 'Excluir lançamento Mercado Teste' }));
    await waitFor(() => expect(remote.calls.some(isTransactionDelete)).toBe(true));
    view.unmount();

    // Reinício do app, agora com a rede disponível (a falha injetada já foi consumida).
    await openApp();

    await vi.waitFor(() => expect(remoteIds('transactions')).toEqual(['t2']), { timeout: 3000 });
  });
});
