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

  it('stores dirty snapshots and metadata separately for each user', () => {
    const stateA = emptyState();
    stateA.settings.startingBalance = 111;
    const stateB = emptyState();
    stateB.settings.startingBalance = 222;

    storage.saveUserLocalDirty('user-a', stateA, 3, 2);
    storage.saveUserLocalConfirmed('user-b', stateB, 7);

    expect(storage.loadUserLocalState('user-a')?.settings.startingBalance).toBe(111);
    expect(storage.loadUserLocalState('user-b')?.settings.startingBalance).toBe(222);
    expect(storage.loadUserSyncMetadata('user-a')).toMatchObject({
      userId: 'user-a', localRevision: 3, confirmedRevision: 2, dirty: true, schemaVersion: 1,
    });
    expect(storage.loadUserSyncMetadata('user-b')).toMatchObject({
      userId: 'user-b', localRevision: 7, confirmedRevision: 7, dirty: false, schemaVersion: 1,
    });
  });

  it('marks dirty false only after a confirmed snapshot is recorded', () => {
    const state = emptyState();
    storage.saveUserLocalDirty('user-a', state, 4, 3);
    expect(storage.loadUserSyncMetadata('user-a')?.dirty).toBe(true);

    const confirmed = storage.saveUserLocalConfirmed('user-a', state, 4);
    expect(confirmed).toMatchObject({ localRevision: 4, confirmedRevision: 4, dirty: false });
    expect(confirmed.lastConfirmedAt).toEqual(expect.any(String));
  });

  it('does not let an older confirmation overwrite a newer dirty snapshot', () => {
    const older = emptyState();
    older.settings.startingBalance = 100;
    const newer = emptyState();
    newer.settings.startingBalance = 200;
    storage.saveUserLocalDirty('user-a', newer, 5, 3);

    const metadata = storage.saveUserLocalConfirmed('user-a', older, 4);

    expect(storage.loadUserLocalState('user-a')?.settings.startingBalance).toBe(200);
    expect(metadata).toMatchObject({ localRevision: 5, confirmedRevision: 4, dirty: true });
  });

  it('stores no session, token, credentials, headers, or financial state in sync metadata', () => {
    storage.saveUserLocalDirty('user-a', emptyState(), 2, 1);
    const raw = localStorage.getItem(storage.getUserSyncMetadataKey('user-a')) || '';
    const metadata = JSON.parse(raw);

    expect(Object.keys(metadata).sort()).toEqual([
      'confirmedRevision', 'dirty', 'lastConfirmedAt', 'localRevision', 'schemaVersion', 'updatedAt', 'userId',
    ]);
    expect(raw).not.toMatch(/jwt|token|session|authorization|header|credential|transactions|settings/i);
  });

  it('migrates an equivalent v3 backup safely and idempotently without deleting it', () => {
    const legacy = emptyState();
    legacy.settings.startingBalance = 321;
    storage.saveLocalState(legacy);
    const original = localStorage.getItem(storage.LOCAL_STORAGE_KEY);

    expect(storage.migrateLegacyLocalStateForUser('user-a', legacy, 1)).toBe(true);
    expect(storage.loadUserLocalState('user-a')?.settings.startingBalance).toBe(321);
    expect(storage.loadUserSyncMetadata('user-a')).toMatchObject({ dirty: false, localRevision: 1, confirmedRevision: 1 });
    expect(localStorage.getItem(storage.LOCAL_STORAGE_KEY)).toBe(original);
    expect(storage.migrateLegacyLocalStateForUser('user-a', legacy, 2)).toBe(false);
    expect(storage.loadUserSyncMetadata('user-a')?.localRevision).toBe(1);
  });

  it('does not associate a different legacy v3 backup with an authenticated user', () => {
    const legacy = emptyState();
    legacy.settings.startingBalance = 111;
    const remote = emptyState();
    remote.settings.startingBalance = 222;
    storage.saveLocalState(legacy);

    expect(storage.migrateLegacyLocalStateForUser('user-b', remote, 1)).toBe(false);
    expect(storage.loadUserLocalState('user-b')).toBeNull();
    expect(storage.loadUserSyncMetadata('user-b')).toBeNull();
    expect(storage.loadLocalState().settings.startingBalance).toBe(111);
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
      future_bills: [
        { id: 'b1', series_id: 'series-1', occurrence_number: 2, due_date: '2026-07-20', description: 'Internet', category: 'Casa', amount: '100', recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
        { id: 'legacy', series_id: null, occurrence_number: null, due_date: '2026-07-21', description: 'Legada', category: 'Casa', amount: '50', recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
      ],
      investments: [],
      budgets: []
    };
    mock.setResolver((call) => ({ data: rows[call.table], error: null }));

    const state = await storage.loadRemoteState('user-1');
    expect(state.settings).toMatchObject({ selectedMonth: '2026-07', startingBalance: 500, accounts: ['Conta principal'], cards: ['Visa'] });
    expect(state.transactions[0]).toMatchObject({ id: 't1', amount: 25.5, description: 'Mercado' });
    expect(state.bills[0]).toMatchObject({ id: 'b1', amount: 100, seriesId: 'series-1', occurrenceNumber: 2 });
    expect(state.bills[1]).toMatchObject({ id: 'legacy' });
    expect(state.bills[1].seriesId).toBeUndefined();
    expect(state.bills[1].occurrenceNumber).toBeUndefined();
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
    state.bills = [{ id: 'b1', seriesId: 'series-1', occurrenceNumber: 1, dueDate: '2026-07-20', description: 'Internet', category: 'Casa', amount: 100, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false }];
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
    expect(mock.calls.find((item) => item.table === 'future_bills' && item.operation === 'upsert')?.payload)
      .toEqual(expect.arrayContaining([expect.objectContaining({ series_id: 'series-1', occurrence_number: 1 })]));
  });

  it('keeps recurrence identities isolated by user during remote saves', async () => {
    const state = emptyState();
    state.bills = [{ id: 'same-id', seriesId: 'same-series', occurrenceNumber: 1, dueDate: '2026-07-20', description: 'Internet', category: 'Casa', amount: 100, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false }];
    mock.setResolver(() => ({ data: [], error: null, count: 0 }));

    await storage.saveRemoteState('user-1', state);
    await storage.saveRemoteState('user-2', state);
    const upserts = mock.calls.filter((item) => item.table === 'future_bills' && item.operation === 'upsert');
    expect(upserts).toHaveLength(2);
    expect(upserts[0].payload).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: 'user-1', series_id: 'same-series' })]));
    expect(upserts[1].payload).toEqual(expect.arrayContaining([expect.objectContaining({ user_id: 'user-2', series_id: 'same-series' })]));
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

  it('classifies Failed to fetch at the transactions upsert and keeps the queue usable', async () => {
    const state = emptyState();
    state.transactions = [{ id: 't1', date: '2026-07-10', description: 'Teste', type: 'expense', category: 'Casa', amount: 1, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: false, paid: true }];
    let shouldFail = true;
    mock.setResolver((call) => {
      if (call.table === 'transactions' && call.operation === 'upsert' && shouldFail) {
        shouldFail = false;
        return { error: new TypeError('Failed to fetch') };
      }
      return { data: [], error: null, count: 0 };
    });
    storage.saveLocalState(state);
    const localBackup = localStorage.getItem(storage.LOCAL_STORAGE_KEY);

    const firstSave = storage.saveRemoteState('user-1', state);
    await expect(firstSave).rejects.toThrow('Failed to fetch');
    await firstSave.catch((error: unknown) => {
      expect(storage.getRemoteErrorDetails(error)).toMatchObject({
        table: 'transactions',
        operation: 'upsert',
        message: 'Failed to fetch',
      });
      expect(storage.getRemoteErrorDetails(error).code).toBeUndefined();
    });
    expect(localStorage.getItem(storage.LOCAL_STORAGE_KEY)).toBe(localBackup);
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

  it('deletes common and recurring future bills by both owner and id', async () => {
    const remoteBills = [
      { user_id: 'user-1', id: 'shared-id', due_date: '2026-07-20', description: 'Comum', category: 'Casa', amount: 10, recurring: false, frequency: 'Única', priority: 'Alta', paid: false },
      { user_id: 'user-1', id: 'recurring-id', due_date: '2026-07-20', description: 'Recorrente', category: 'Casa', amount: 20, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
      { user_id: 'user-2', id: 'shared-id', due_date: '2026-07-20', description: 'Outro usuário', category: 'Casa', amount: 30, recurring: false, frequency: 'Única', priority: 'Alta', paid: false },
    ];
    mock.setResolver((call) => {
      if (call.table === 'app_settings') {
        return { data: { currency: 'BRL', selected_month: '2026-07' }, error: null };
      }
      if (call.table === 'future_bills' && call.operation === 'delete') {
        const userId = call.filters.find(([column]) => column === 'user_id')?.[1];
        const billId = call.filters.find(([column]) => column === 'id')?.[1];
        for (let index = remoteBills.length - 1; index >= 0; index -= 1) {
          if (remoteBills[index].user_id === userId && remoteBills[index].id === billId) remoteBills.splice(index, 1);
        }
        return { data: null, error: null };
      }
      if (call.table === 'future_bills') {
        const userId = call.filters.find(([column]) => column === 'user_id')?.[1];
        return { data: remoteBills.filter((bill) => bill.user_id === userId), error: null };
      }
      return { data: [], error: null, count: 0 };
    });

    await storage.deleteRemoteFutureBill('user-1', 'shared-id');
    await storage.deleteRemoteFutureBill('user-1', 'recurring-id');
    expect((await storage.loadRemoteState('user-1')).bills).toHaveLength(0);
    expect((await storage.loadRemoteState('user-2')).bills).toHaveLength(1);
    const deletes = mock.calls.filter((call) => call.table === 'future_bills' && call.operation === 'delete');
    expect(deletes).toHaveLength(2);
    expect(deletes.every((call) => call.filters.some(([column, value]) => column === 'user_id' && value === 'user-1') && call.filters.some(([column, value]) => column === 'id' && value !== undefined))).toBe(true);
    expect(deletes.some((call) => call.filters.length === 1 && call.filters[0][0] === 'user_id')).toBe(false);
  });

  it('propagates future bill delete errors without a broad delete', async () => {
    mock.setResolver((call) => call.table === 'future_bills' && call.operation === 'delete'
      ? { error: new Error('bill delete failed') }
      : { data: [], error: null, count: 0 });

    await expect(storage.deleteRemoteFutureBill('user-1', 'bill-1')).rejects.toThrow('bill delete failed');
    const deleteCall = mock.calls.find((call) => call.table === 'future_bills' && call.operation === 'delete');
    expect(deleteCall?.filters).toEqual([['user_id', 'user-1'], ['id', 'bill-1']]);
  });

  it('deletes only the current and later occurrences for the owner and explicit series', async () => {
    const remoteBills = [
      { user_id: 'user-1', id: 'previous', series_id: 'series-a', occurrence_number: 1 },
      { user_id: 'user-1', id: 'current', series_id: 'series-a', occurrence_number: 2 },
      { user_id: 'user-1', id: 'next', series_id: 'series-a', occurrence_number: 3 },
      { user_id: 'user-1', id: 'identical-other-series', series_id: 'series-b', occurrence_number: 2 },
      { user_id: 'user-2', id: 'other-user', series_id: 'series-a', occurrence_number: 2 },
    ];
    mock.setResolver((call) => {
      if (call.table === 'future_bills' && call.operation === 'delete') {
        const userId = call.filters.find(([column]) => column === 'user_id')?.[1];
        const seriesId = call.filters.find(([column]) => column === 'series_id')?.[1];
        const occurrence = call.filters.find(([column]) => column === 'occurrence_number.gte')?.[1] as number;
        for (let index = remoteBills.length - 1; index >= 0; index -= 1) {
          const row = remoteBills[index];
          if (row.user_id === userId && row.series_id === seriesId && row.occurrence_number >= occurrence) remoteBills.splice(index, 1);
        }
      }
      if (call.table === 'future_bills' && call.operation !== 'delete') {
        const userId = call.filters.find(([column]) => column === 'user_id')?.[1];
        return { data: remoteBills.filter((bill) => bill.user_id === userId), error: null };
      }
      return { data: [], error: null, count: 0 };
    });

    await storage.deleteRemoteFutureBillsFrom('user-1', 'series-a', 2);
    expect(remoteBills.map((bill) => bill.id)).toEqual(['previous', 'identical-other-series', 'other-user']);
    expect((await storage.loadRemoteState('user-1')).bills.map((bill) => bill.id)).toEqual(['previous', 'identical-other-series']);
    expect((await storage.loadRemoteState('user-2')).bills.map((bill) => bill.id)).toEqual(['other-user']);
    const deleteCall = mock.calls.find((call) => call.table === 'future_bills' && call.operation === 'delete');
    expect(deleteCall?.filters).toEqual([
      ['user_id', 'user-1'],
      ['series_id', 'series-a'],
      ['occurrence_number.gte', 2],
    ]);
  });

  it('rejects a ranged delete without an explicit safe identity before contacting Supabase', async () => {
    await expect(storage.deleteRemoteFutureBillsFrom('user-1', '', 2)).rejects.toThrow('Identidade');
    await expect(storage.deleteRemoteFutureBillsFrom('', 'series-a', 2)).rejects.toThrow('Identidade');
    await expect(storage.deleteRemoteFutureBillsFrom('user-1', 'series-a', 0)).rejects.toThrow('Identidade');
    expect(mock.calls.filter((call) => call.table === 'future_bills' && call.operation === 'delete')).toHaveLength(0);
  });

  it('propagates ranged delete errors and keeps the serialized queue usable', async () => {
    let shouldFail = true;
    mock.setResolver((call) => {
      if (call.table === 'future_bills' && call.operation === 'delete' && shouldFail) {
        shouldFail = false;
        return { error: new Error('range delete failed') };
      }
      return { data: null, error: null };
    });

    await expect(storage.deleteRemoteFutureBillsFrom('user-1', 'series-a', 1)).rejects.toThrow('range delete failed');
    await expect(storage.deleteRemoteFutureBillsFrom('user-1', 'series-a', 1)).resolves.toBeUndefined();
    expect(mock.calls.filter((call) => call.operation === 'delete')).toHaveLength(2);
  });
});
