import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../data/sample';
import { createSupabaseMock } from '../test/supabaseMock';
import type * as Storage from './storage';

const mock = createSupabaseMock();
let storage: typeof Storage;
let activeUser: string | null = 'user-b';

beforeAll(async () => {
  mock.auth.getSession = (async () => ({ data: { session: activeUser ? { user: { id: activeUser } } : null } })) as unknown as typeof mock.auth.getSession;
  vi.doMock('./supabaseClient', () => ({ isSupabaseConfigured: true, supabase: mock.client }));
  storage = await import('./storage');
});

beforeEach(() => {
  localStorage.clear();
  mock.reset();
  activeUser = 'user-b';
  mock.setResolver(() => ({ data: [], count: 0, error: null }));
});

describe('pending financial deletes', () => {
  it('keeps the journal when no authenticated session exists', async () => {
    activeUser = null;
    await expect(storage.deleteRemoteTransaction('user-b', 'txn-1')).rejects.toThrow('Sessão alterada');
    expect(storage.loadPendingDeletes('user-b')).toEqual([{ table: 'transactions', id: 'txn-1' }]);
    expect(mock.calls.some((call) => call.table === 'transactions' && call.operation === 'delete')).toBe(false);
  });

  it('rechecks the session after a delete before confirming the journal', async () => {
    mock.setResolver((call) => {
      if (call.table === 'transactions' && call.operation === 'delete') activeUser = null;
      return { data: [], count: 0, error: null };
    });
    await expect(storage.deleteRemoteTransaction('user-b', 'txn-1')).rejects.toThrow('Sessão alterada');
    expect(storage.loadPendingDeletes('user-b')).toHaveLength(1);
  });

  it('preserves unreadable journal data and blocks further syncing', () => {
    const key = 'finance-control-pending-deletes-v1:user:user-b';
    localStorage.setItem(key, '{broken');
    expect(() => storage.loadPendingDeletes('user-b')).toThrow('corrompido');
    expect(localStorage.getItem(`${key}:corrupt`)).toBe('{broken');
    expect(() => storage.recordPendingDelete('user-b', 'budgets', 'b1')).toThrow('corrompido');
    expect(localStorage.getItem(key)).toBe('{broken');
  });

  it('does not infer a remote deletion from an omitted snapshot id', async () => {
    const rows: Array<Record<string, unknown>> = [];
    mock.setResolver((call) => {
      if (call.table === 'investments' && call.operation === 'upsert') {
        for (const row of call.payload as Array<Record<string, unknown>>) {
          const index = rows.findIndex((saved) => saved.id === row.id);
          if (index >= 0) rows[index] = row;
          else rows.push(row);
        }
      }
      if (call.table === 'investments' && call.operation === 'select') return { data: [...rows], count: rows.length, error: null };
      return { data: [], count: 0, error: null };
    });
    const both = emptyState();
    both.investments = [
      { id: 'v1', type: 'CDB', institution: 'Banco', initialAmount: 1, currentAmount: 1, liquidity: 'Diária', goal: 'Reserva' },
      { id: 'v2', type: 'CDB', institution: 'Banco', initialAmount: 1, currentAmount: 1, liquidity: 'Diária', goal: 'Reserva' },
    ];
    await storage.saveRemoteState('user-b', both);
    await storage.saveRemoteState('user-b', { ...both, investments: [both.investments[1]] });
    expect(rows.map((row) => row.id).sort()).toEqual(['v1', 'v2']);
    expect(mock.calls.some((call) => call.table === 'investments' && call.operation === 'delete')).toBe(false);
  });

  it('persists a newly recreated occurrence after a confirmed series deletion', async () => {
    const rows: Array<Record<string, unknown>> = [
      { user_id: 'user-b', id: 'before', series_id: 'series-1', occurrence_number: 2, due_date: '2026-07-01', description: 'Before', category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
      { user_id: 'user-b', id: 'old-3', series_id: 'series-1', occurrence_number: 3, due_date: '2026-08-01', description: 'Old', category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
    ];
    mock.setResolver((call) => {
      if (call.table === 'future_bills' && call.operation === 'delete') {
        for (let i = rows.length - 1; i >= 0; i -= 1) {
          if (rows[i].series_id === 'series-1' && Number(rows[i].occurrence_number) >= 3) rows.splice(i, 1);
        }
      }
      if (call.table === 'future_bills' && call.operation === 'upsert') {
        for (const row of call.payload as Array<Record<string, unknown>>) {
          const index = rows.findIndex((saved) => saved.id === row.id);
          if (index >= 0) rows[index] = row;
          else rows.push(row);
        }
      }
      if (call.table === 'future_bills' && call.operation === 'select') return { data: [...rows], count: rows.length, error: null };
      if (call.table === 'app_settings' && call.operation === 'maybeSingle') {
        return { data: { user_id: 'user-b', currency: 'BRL', selected_month: '2026-07', starting_balance: 0 }, error: null };
      }
      return { data: [], count: 0, error: null };
    });

    await storage.deleteRemoteFutureBillsFrom('user-b', 'series-1', 3);
    const state = emptyState();
    state.bills = [
      { id: 'before', seriesId: 'series-1', occurrenceNumber: 2, dueDate: '2026-07-01', description: 'Before', category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
      { id: 'new-3', seriesId: 'series-1', occurrenceNumber: 3, dueDate: '2026-08-01', description: 'New', category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
    ];
    await storage.saveRemoteState('user-b', state);
    expect((await storage.loadRemoteState('user-b')).bills.map((bill) => bill.id).sort()).toEqual(['before', 'new-3']);
  });

  it('deletes a future-bill series with one owner-scoped range', async () => {
    activeUser = 'user-a';

    await storage.deleteRemoteFutureBillsFrom('user-a', 'series-1', 2);
    const deletes = mock.calls.filter((call) => call.table === 'future_bills' && call.operation === 'delete');
    expect(deletes.map((call) => call.filters)).toEqual([
      [['user_id', 'user-a'], ['series_id', 'series-1'], ['occurrence_number.gte', 2]],
    ]);
    expect(storage.loadPendingDeletes('user-a')).toEqual([]);
  });

  it('keeps a queued stale snapshot from recreating excluded series occurrences', async () => {
    const stale = emptyState();
    stale.bills = [
      { id: 'before', seriesId: 'series-1', occurrenceNumber: 1, dueDate: '2026-07-01', description: 'Before', category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
      { id: 'removed', seriesId: 'series-1', occurrenceNumber: 2, dueDate: '2026-08-01', description: 'Removed', category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false },
    ];
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    mock.setResolver(async (call) => {
      if (call.table === 'future_bills' && call.operation === 'delete') {
        entered();
        await gate;
      }
      return { data: [], count: 0, error: null };
    });

    const deleting = storage.deleteRemoteFutureBillsFrom('user-b', 'series-1', 2);
    await started;
    const saving = storage.saveRemoteState('user-b', stale);
    storage.saveUserLocalDirty('user-b', stale, 1, 0);
    expect(storage.loadUserLocalState('user-b')?.bills.map((bill) => bill.id)).toEqual(['before']);
    release();
    await Promise.all([deleting, saving]);

    const upserts = mock.calls.filter((call) => call.table === 'future_bills' && call.operation === 'upsert');
    expect(upserts).toHaveLength(1);
    expect((upserts[0].payload as Array<{ id: string }>).map((row) => row.id)).toEqual(['before']);
  });

  it('does not send user A series or item pending deletes in user B session', async () => {
    storage.recordPendingDelete('user-a', 'investments', 'investment-a');
    await expect(storage.deleteRemoteFutureBillsFrom('user-a', 'series-a', 2)).rejects.toThrow('Sessão alterada');
    expect(storage.loadPendingDeletes('user-a')).toHaveLength(2);
    await storage.saveRemoteState('user-b', emptyState());
    expect(mock.calls.some((call) => call.operation === 'delete'
      && (call.table === 'future_bills' || call.table === 'investments'))).toBe(false);
    expect(storage.loadPendingDeletes('user-a')).toHaveLength(2);
  });

  it('filters a stale snapshot after a confirmed delete even before the first save', async () => {
    const stale = emptyState();
    stale.transactions = [{
      id: 'old', date: '2026-07-10', description: 'Old', type: 'expense', category: 'Casa',
      amount: 1, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: false, paid: true,
    }];

    await storage.deleteRemoteTransaction('user-b', 'old');
    await storage.saveRemoteState('user-b', stale);
    expect(mock.calls.some((call) => call.table === 'transactions' && call.operation === 'upsert')).toBe(false);
  });

  it('keeps a failed deletion scoped to its owner and refuses to send it in another session', async () => {
    storage.recordPendingDelete('user-a', 'investments', 'shared-id');
    expect(storage.loadPendingDeletes('user-a')).toEqual([{ table: 'investments', id: 'shared-id' }]);
    expect(storage.loadPendingDeletes('user-b')).toEqual([]);

    await storage.saveRemoteState('user-b', emptyState());
    expect(mock.calls.some((call) => call.operation === 'delete' && call.table === 'investments')).toBe(false);

    await expect(storage.saveRemoteState('user-a', emptyState())).rejects.toThrow('Sessão alterada');
    expect(storage.loadPendingDeletes('user-a')).toHaveLength(1);
  });

  it('rejects an empty collection if any remote id lacks an explicit deletion', async () => {
    storage.recordPendingDelete('user-b', 'investments', 'covered');
    mock.setResolver((call) => call.table === 'investments' && call.operation === 'select'
      ? { data: [{ id: 'covered' }, { id: 'uncovered' }], count: 2, error: null }
      : { data: [], count: 0, error: null });

    await expect(storage.saveRemoteState('user-b', emptyState())).rejects.toThrow('investimentos');
    expect(mock.calls.some((call) => call.table === 'investments' && call.operation === 'delete')).toBe(false);
    expect(storage.loadPendingDeletes('user-b')).toHaveLength(1);
  });

  it('replays a failed series deletion after module reload and clears it only on success', async () => {
    let shouldFail = true;
    const rows = [
      { id: 'bill-2', user_id: 'user-b', series_id: 'series-1', occurrence_number: 2 },
      { id: 'bill-3', user_id: 'user-b', series_id: 'series-1', occurrence_number: 3 },
    ];
    mock.setResolver((call) => {
      if (call.table === 'future_bills' && call.operation === 'delete') {
        if (shouldFail) { shouldFail = false; return { data: null, error: new Error('offline') }; }
        for (let i = rows.length - 1; i >= 0; i -= 1) rows.splice(i, 1);
      }
      if (call.table === 'future_bills' && call.operation === 'select') {
        return { data: [...rows], count: rows.length, error: null };
      }
      return { data: [], count: 0, error: null };
    });

    await expect(storage.deleteRemoteFutureBillsFrom('user-b', 'series-1', 2)).rejects.toThrow('offline');
    expect(storage.loadPendingDeletes('user-b')).toEqual([{
      table: 'future_bills', userId: 'user-b', seriesId: 'series-1', fromOccurrence: 2,
    }]);
    expect(rows).toHaveLength(2);

    vi.resetModules();
    const reloaded = await import('./storage');
    await reloaded.saveRemoteState('user-b', emptyState());
    expect(rows).toEqual([]);
    expect(reloaded.loadPendingDeletes('user-b')).toEqual([]);
    expect(mock.calls.filter((call) => call.table === 'future_bills' && call.operation === 'delete')).toHaveLength(2);
  });

  it('saves another edit even when a pending delete keeps failing, and retries later', async () => {
    const rows = new Map<string, Record<string, unknown>>([
      ['old', { user_id: 'user-b', id: 'old' }],
    ]);
    let deleteFails = true;
    mock.setResolver((call) => {
      if (call.table === 'investments' && call.operation === 'delete') {
        if (deleteFails) return { data: null, error: new Error('network unavailable') };
        rows.delete('old');
      }
      if (call.table === 'investments' && call.operation === 'upsert') {
        for (const row of call.payload as Array<Record<string, unknown>>) rows.set(row.id as string, row);
      }
      if (call.table === 'investments' && call.operation === 'select') {
        return { data: [...rows.values()], count: rows.size, error: null };
      }
      return { data: [], count: 0, error: null };
    });
    storage.recordPendingDelete('user-b', 'investments', 'old');
    const state = emptyState();
    state.investments = [{ id: 'edited', type: 'CDB', institution: 'Banco', initialAmount: 5,
      currentAmount: 6, liquidity: 'Diária', goal: 'Reserva' }];
    storage.saveUserLocalDirty('user-b', state, 2, 1);

    await expect(storage.saveRemoteState('user-b', state)).rejects.toThrow('network unavailable');
    expect(rows.has('edited')).toBe(true);
    expect(rows.has('old')).toBe(true);
    expect(storage.loadPendingDeletes('user-b')).toEqual([{ table: 'investments', id: 'old' }]);
    expect(storage.loadUserSyncMetadata('user-b')?.dirty).toBe(true);

    deleteFails = false;
    await storage.saveRemoteState('user-b', state);
    expect(rows.has('old')).toBe(false);
    expect(rows.has('edited')).toBe(true);
    expect(storage.loadPendingDeletes('user-b')).toEqual([]);
  });

  it('keeps A pending through logout, isolates B, and replays only when A returns', async () => {
    activeUser = 'user-a';
    storage.saveUserLocalConfirmed('user-a', emptyState(), 1);
    storage.recordPendingDelete('user-a', 'transactions', 'a-old');
    storage.cleanupConfirmedSyncMetadataOnLogout('user-a');
    expect(storage.loadUserSyncMetadata('user-a')).not.toBeNull();

    activeUser = 'user-b';
    await storage.saveRemoteState('user-b', emptyState());
    expect(mock.calls.some((call) => call.operation === 'delete' && call.table === 'transactions')).toBe(false);
    expect(storage.loadPendingDeletes('user-b')).toEqual([]);
    expect(storage.loadPendingDeletes('user-a')).toHaveLength(1);

    activeUser = 'user-a';
    await storage.saveRemoteState('user-a', emptyState());
    expect(mock.calls.filter((call) => call.operation === 'delete' && call.table === 'transactions')
      .map((call) => call.filters)).toEqual([[['user_id', 'user-a'], ['id', 'a-old']]]);
    expect(storage.loadPendingDeletes('user-a')).toEqual([]);
    expect(localStorage.getItem('finance-control-pending-deletes-v1:user:user-a')).toBeNull();
    storage.cleanupConfirmedSyncMetadataOnLogout('user-a');
    expect(storage.loadUserSyncMetadata('user-a')).toBeNull();
  });

  it.each([false, true])('guards 1500 remote rows using exact head counts; one uncovered = %s', async (oneUncovered) => {
    const ids = Array.from({ length: 1500 }, (_, index) => `row-${index}`);
    const rows = new Set(ids);
    localStorage.setItem('finance-control-pending-deletes-v1:user:user-b', JSON.stringify(
      ids.slice(0, oneUncovered ? -1 : undefined).map((id) => ({ table: 'investments', id }))));
    mock.setResolver((call) => {
      if (call.table === 'investments' && call.operation === 'delete') {
        const id = call.filters.find(([key]) => key === 'id')?.[1] as string;
        rows.delete(id);
        return { data: null, error: null };
      }
      if (call.table === 'investments' && call.operation === 'select') {
        const subset = [...rows].filter((id) => call.filters.every(([key, value]) => {
          if (key === 'user_id') return value === 'user-b';
          if (key === 'id.in') return (value as string[]).includes(id);
          if (key === 'id.not.in') return !(value as string).includes(`"${id}"`);
          return true;
        }));
        const head = (call.options as { head?: boolean } | undefined)?.head;
        return { data: head ? null : subset.slice(0, 1000).map((id) => ({ id })), count: subset.length, error: null };
      }
      return { data: [], count: 0, error: null };
    });

    if (oneUncovered) {
      await expect(storage.saveRemoteState('user-b', emptyState())).rejects.toThrow('investimentos');
      expect(rows.size).toBe(1500);
    } else {
      await storage.saveRemoteState('user-b', emptyState());
      expect(rows.size).toBe(0);
    }
    expect(mock.calls.filter((call) => call.table === 'investments' && call.operation === 'select')
      .every((call) => (call.options as { head?: boolean } | undefined)?.head)).toBe(true);
  }, 30000);
});
