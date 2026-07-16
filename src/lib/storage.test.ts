import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../data/sample';
import { createSupabaseMock } from '../test/supabaseMock';
import type * as StorageModule from './storage';

const mock = createSupabaseMock();
let storage: typeof StorageModule;

beforeAll(async () => {
  vi.doMock('./supabaseClient', () => ({
    isSupabaseConfigured: true,
    supabase: mock.client
  }));
  storage = await import('./storage');
});

beforeEach(() => {
  mock.reset();
  localStorage.clear();
});

describe('local storage', () => {
  it('round-trips normalized state and recovers from invalid JSON', () => {
    const state = emptyState();
    state.settings.startingBalance = 123.45;
    storage.saveLocalState(state);
    expect(storage.loadLocalState().settings.startingBalance).toBe(123.45);

    localStorage.setItem(storage.LOCAL_STORAGE_KEY, '{invalid');
    expect(storage.loadLocalState().transactions.length).toBeGreaterThan(0);
  });
});

describe('remote storage', () => {
  it('loads settings, catalogs, and financial rows into the domain model', async () => {
    const rows: Record<string, any> = {
      app_settings: { currency: 'BRL', selected_month: '2026-07', starting_balance: '500', monthly_income_estimate: '3000', monthly_saving_goal: '400', emergency_contribution: '100' },
      categories: [{ kind: 'expense', name: 'Casa' }, { kind: 'income', name: 'Salário' }],
      accounts: [{ name: 'Conta principal' }],
      cards: [{ name: 'Visa' }],
      payment_methods: [{ name: 'Pix' }],
      card_rules: [{ card_name: 'Visa', closing_day: 20, due_day: 10 }],
      transactions: [{ id: 't1', date: '2026-07-10', description: 'Mercado', type: 'expense', category: 'Casa', amount: '25.50', payment_method: 'Pix', account_or_card: 'Conta principal', essential: true, paid: true }],
      installments: [],
      future_bills: [{ id: 'b1', due_date: '2026-07-20', description: 'Internet', category: 'Casa', amount: '100', recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false }],
      investments: [],
      budgets: []
    };
    mock.setResolver((call) => ({ data: rows[call.table], error: null }));

    const state = await storage.loadRemoteState('user-1');
    expect(state.settings).toMatchObject({ selectedMonth: '2026-07', startingBalance: 500, accounts: ['Conta principal'], cards: ['Visa'] });
    expect(state.transactions[0]).toMatchObject({ id: 't1', amount: 25.5, description: 'Mercado' });
    expect(state.bills[0]).toMatchObject({ id: 'b1', amount: 100 });
  });

  it('propagates remote loading errors', async () => {
    mock.setResolver((call) => call.table === 'app_settings'
      ? { data: null, error: new Error('settings unavailable') }
      : { data: [], error: null });
    await expect(storage.loadRemoteState('user-1')).rejects.toThrow('settings unavailable');
  });

  it('upserts financial rows with the composite key and never deletes them', async () => {
    const state = emptyState();
    state.transactions = [{ id: 't1', date: '2026-07-10', description: 'Mercado', type: 'expense', category: 'Casa', amount: 25, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: true, paid: true }];
    state.installments = [{ id: 'i1', purchaseDate: '2026-07-01', description: 'Notebook', cardName: 'Visa', category: 'Compras', totalAmount: 1200, installments: 12, firstInstallmentMonth: '2026-07', paidInstallments: 0 }];
    state.bills = [{ id: 'b1', dueDate: '2026-07-20', description: 'Internet', category: 'Casa', amount: 100, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false }];
    state.investments = [{ id: 'v1', type: 'CDB', institution: 'Banco', initialAmount: 1000, currentAmount: 1050, liquidity: 'Diária', goal: 'Reserva' }];
    state.budgets = [{ id: 'g1', month: '2026-07', category: 'Casa', monthlyBudget: 500 }];
    mock.setResolver(() => ({ data: [], error: null, count: 0 }));

    await storage.saveRemoteState('user-1', state);
    const financialTables = ['transactions', 'installments', 'future_bills', 'investments', 'budgets'];
    for (const table of financialTables) {
      const call = mock.calls.find((item) => item.table === table && item.operation === 'upsert');
      expect(call?.options).toEqual({ onConflict: 'user_id,id', ignoreDuplicates: false });
      expect(call?.payload).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: 'user-1', id: expect.any(String) })]));
      expect(mock.calls.some((item) => item.table === table && item.operation === 'delete')).toBe(false);
    }
  });

  it('blocks an individually empty financial collection when remote rows exist', async () => {
    const state = emptyState();
    state.transactions = [];
    mock.setResolver((call) => call.table === 'transactions' && call.operation === 'select'
      ? { data: null, error: null, count: 2 }
      : { data: [], error: null, count: 0 });

    await expect(storage.saveRemoteState('user-1', state)).rejects.toThrow('lançamentos');
    expect(mock.calls.some((call) => call.operation === 'upsert')).toBe(false);
  });

  it('propagates upsert failures and allows the save queue to recover', async () => {
    const state = emptyState();
    state.transactions = [{ id: 't1', date: '2026-07-10', description: 'Teste', type: 'expense', category: 'Casa', amount: 1, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: false, paid: true }];
    let shouldFail = true;
    mock.setResolver((call) => {
      if (call.table === 'transactions' && call.operation === 'upsert' && shouldFail) {
        shouldFail = false;
        return { error: new Error('upsert failed') };
      }
      return { data: [], error: null, count: 0 };
    });

    await expect(storage.saveRemoteState('user-1', state)).rejects.toThrow('upsert failed');
    await expect(storage.saveRemoteState('user-1', state)).resolves.toBeUndefined();
  });

  it('deletes only the transaction matching both user_id and id and it stays deleted after reload', async () => {
    const remoteTransactions = [
      { user_id: 'user-1', id: 'shared-id', date: '2026-07-10', description: 'User one', type: 'expense', category: 'Casa', amount: 10, payment_method: 'Pix', account_or_card: 'Conta', essential: false, paid: true },
      { user_id: 'user-2', id: 'shared-id', date: '2026-07-10', description: 'User two', type: 'expense', category: 'Casa', amount: 20, payment_method: 'Pix', account_or_card: 'Conta', essential: false, paid: true },
    ];
    mock.setResolver((call) => {
      if (call.table === 'app_settings') {
        return { data: { currency: 'BRL', selected_month: '2026-07' }, error: null };
      }
      if (call.table === 'transactions' && call.operation === 'delete') {
        const userId = call.filters.find(([column]) => column === 'user_id')?.[1];
        const transactionId = call.filters.find(([column]) => column === 'id')?.[1];
        const index = remoteTransactions.findIndex((row) => row.user_id === userId && row.id === transactionId);
        if (index >= 0) remoteTransactions.splice(index, 1);
        return { data: null, error: null };
      }
      if (call.table === 'transactions') {
        const userId = call.filters.find(([column]) => column === 'user_id')?.[1];
        return { data: remoteTransactions.filter((row) => row.user_id === userId), error: null };
      }
      return { data: [], error: null, count: 0 };
    });

    expect((await storage.loadRemoteState('user-1')).transactions).toHaveLength(1);
    await storage.deleteRemoteTransaction('user-1', 'shared-id');
    expect((await storage.loadRemoteState('user-1')).transactions).toHaveLength(0);
    expect((await storage.loadRemoteState('user-2')).transactions).toHaveLength(1);

    const deleteCall = mock.calls.find((call) => call.table === 'transactions' && call.operation === 'delete');
    expect(deleteCall?.filters).toEqual([['user_id', 'user-1'], ['id', 'shared-id']]);
    expect(mock.calls.filter((call) => call.table === 'transactions' && call.operation === 'delete')).toHaveLength(1);
  });

  it('propagates transaction delete errors without issuing a broad delete', async () => {
    mock.setResolver((call) => call.table === 'transactions' && call.operation === 'delete'
      ? { error: new Error('delete failed') }
      : { data: [], error: null, count: 0 });

    await expect(storage.deleteRemoteTransaction('user-1', 't1')).rejects.toThrow('delete failed');
    const deleteCall = mock.calls.find((call) => call.operation === 'delete');
    expect(deleteCall?.filters).toEqual([['user_id', 'user-1'], ['id', 't1']]);
  });
});
