import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { createSupabaseMock } from './test/supabaseMock';
import type { PageProps } from './pages/types';

const fake = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('./lib/supabaseClient', () => ({ isSupabaseConfigured: true, get supabase() { return fake.client; } }));
vi.mock('./pages/Dashboard', () => ({ Dashboard: () => <h1>Dashboard</h1> }));
vi.mock('./pages/BillsPage', () => ({ BillsPage: ({ updateState, onDeleteFutureBillsFrom }: PageProps) => <>
  <h1>Contas futuras</h1>
  <button onClick={() => updateState((s) => ({ ...s, settings: { ...s.settings, startingBalance: s.settings.startingBalance + 1 } }))}>Edit</button>
  <button onClick={() => { void onDeleteFutureBillsFrom?.('s1', 2).catch(() => undefined); }}>Delete series</button>
  <button onClick={() => updateState((s) => ({ ...s, bills: [...s.bills, { id: 'new', seriesId: 's1', occurrenceNumber: 2, dueDate: '2026-07-01', description: 'New', category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false }] }))}>Recreate</button>
</> }));

import { App } from './App';
import { CorruptDeletionJournalError, getUserLocalStateKey, loadPendingDeletes, loadUserLocalState, recoverCorruptDeletionJournal } from './lib/storage';

const mock = createSupabaseMock();
fake.client = mock.client;
const key = 'finance-control-pending-deletes-v1:user:u1';
let rows: Array<Record<string, unknown>>;
let failDelete = false;

beforeEach(() => {
  localStorage.clear(); mock.reset(); failDelete = false;
  rows = [1, 2, 3, 4].map((n) => ({ user_id: 'u1', id: `x${n}`, series_id: 's1', occurrence_number: n, due_date: '2026-07-01', description: `Bill ${n}`, category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false }));
  mock.auth.getSession = (async () => {
    return { data: { session: { user: { id: 'u1' } } } };
  }) as unknown as typeof mock.auth.getSession;
  mock.setResolver((call) => {
    if (call.table === 'future_bills') {
      if (call.operation === 'delete') {
        if (failDelete) return { data: null, error: new Error('offline') };
        const protectedFilter = call.filters.find(([key]) => key === 'id.not.in')?.[1];
        const protectedIds = protectedFilter ? JSON.parse('[' + String(protectedFilter).slice(1, -1) + ']') as string[] : [];
        rows = rows.filter((r) => !(r.series_id === 's1' && Number(r.occurrence_number) >= 2 && !protectedIds.includes(String(r.id))));
      }
      if (call.operation === 'upsert') for (const row of call.payload as typeof rows) {
        const i = rows.findIndex((r) => r.id === row.id);
        if (i < 0) rows.push(row); else rows[i] = row;
      }
      return { data: [...rows], count: rows.length, error: null };
    }
    if (call.table === 'app_settings' && call.operation === 'maybeSingle') return { data: { user_id: 'u1', selected_month: '2026-07', starting_balance: 0, currency: 'BRL' }, error: null };
    return { data: [], count: 0, error: null };
  });
});

function backupKeys() {
  return Object.keys(localStorage).filter((k) => k.includes(':pre-recovery:'));
}

it('A: preserves a recreation across failed series delete, retry, reload and another sync', async () => {
  const view = render(<App />);
  await screen.findByTitle('Online Supabase');
  fireEvent.click(screen.getByRole('button', { name: 'Contas futuras' }));
  failDelete = true;
  fireEvent.click(await screen.findByText('Delete series'));
  await screen.findByTitle(/Erro de sincronização/);
  fireEvent.click(screen.getByText('Recreate'));
  await waitFor(() => expect(JSON.parse(localStorage.getItem(getUserLocalStateKey('u1'))!).bills.map((b: { id: string }) => b.id)).toContain('new'));
  // A recreated occurrence has already reached the server before retry.
  rows.push({ ...rows[1], id: 'new' });
  failDelete = false;
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByTitle('Online Supabase');
  expect(rows.map((r) => r.id).sort()).toEqual(['new', 'x1']);
  expect(mock.calls.some((c) => c.table === 'future_bills' && c.operation === 'delete'
    && c.filters.some(([k, v]) => k === 'id.not.in' && String(v).includes('new')))).toBe(true);
  view.unmount();
  render(<App />); await screen.findByTitle('Online Supabase');
  expect(loadUserLocalState('u1')?.bills.map((b) => b.id).sort()).toEqual(['new', 'x1']);
  fireEvent.click(screen.getByRole('button', { name: 'Contas futuras' }));
  fireEvent.click(await screen.findByText('Edit'));
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByTitle('Online Supabase');
  expect(rows.map((r) => r.id).sort()).toEqual(['new', 'x1']);
});

it('B: backs up the in-memory unsynced edit, raw cache, dirty metadata and journal before recovery', async () => {
  render(<App />); await screen.findByTitle('Online Supabase');
  const cache = localStorage.getItem(getUserLocalStateKey('u1'));
  fireEvent.click(screen.getByRole('button', { name: 'Contas futuras' }));
  await screen.findByText('Edit');
  localStorage.setItem(key, '{broken');
  fireEvent.click(screen.getByText('Edit'));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('edições locais não sincronizadas');
  expect(screen.getByRole('button', { name: 'Exportar backup' })).toBeInTheDocument();
  fireEvent.click(screen.getByText('Preservar diário e recuperar dados online'));
  await screen.findByTitle('Online Supabase');
  expect(backupKeys()).toHaveLength(1);
  const backup = JSON.parse(localStorage.getItem(backupKeys()[0])!);
  expect(backup.cache).toBe(cache);
  expect(backup.state.settings.startingBalance).toBe(1);
  expect(JSON.parse(backup.metadata).dirty).toBe(true);
  expect(backup.journal).toBe('{broken');
});

it('A: keeps recreation and its delete exclusion through reload while still offline', async () => {
  const view = render(<App />); await screen.findByTitle('Online Supabase');
  fireEvent.click(screen.getByRole('button', { name: 'Contas futuras' }));
  failDelete = true;
  fireEvent.click(await screen.findByText('Delete series'));
  await screen.findByTitle(/Erro de sincronização/);
  fireEvent.click(screen.getByText('Recreate'));
  await waitFor(() => expect(loadUserLocalState('u1')?.bills.map((b) => b.id)).toEqual(['x1', 'new']));
  view.unmount();
  render(<App />);
  await screen.findByTitle(/Erro de sincronização/);
  expect(loadUserLocalState('u1')?.bills.map((b) => b.id)).toEqual(['x1', 'new']);
  // The recreated row reaches the server from an earlier attempt before retry.
  if (!rows.some((r) => r.id === 'new')) rows.push({ ...rows[1], id: 'new' });
  failDelete = false;
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByTitle('Online Supabase');
  expect(rows.map((r) => r.id).sort()).toEqual(['new', 'x1']);
});

it('A: an explicit second deletion includes the recreated occurrence in the target set', async () => {
  render(<App />); await screen.findByTitle('Online Supabase');
  fireEvent.click(screen.getByRole('button', { name: 'Contas futuras' }));
  failDelete = true;
  fireEvent.click(await screen.findByText('Delete series'));
  await screen.findByTitle(/Erro de sincronização/);
  fireEvent.click(screen.getByText('Recreate'));
  await waitFor(() => expect(loadUserLocalState('u1')?.bills.map((b) => b.id)).toContain('new'));
  rows.push({ ...rows[1], id: 'new' });
  fireEvent.click(screen.getByText('Delete series'));
  await waitFor(() => expect(loadUserLocalState('u1')?.bills.map((b) => b.id)).toEqual(['x1']));
  failDelete = false;
  act(() => window.dispatchEvent(new Event('online')));
  await screen.findByTitle('Online Supabase');
  expect(rows.map((r) => r.id)).toEqual(['x1']);
});

it('B: keeps recovery blocked if the pre-recovery backup fails', async () => {
  localStorage.setItem(key, '{broken');
  render(<App />); await screen.findByRole('alert');
  const original = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) {
    if (k.includes(':pre-recovery:')) throw new Error('quota');
    original.call(this, k, v);
  });
  try {
    fireEvent.click(screen.getByText('Preservar diário e recuperar dados online'));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('quota'));
    expect(mock.calls).toHaveLength(0);
    expect(localStorage.getItem(key)).toBe('{broken');
  } finally { spy.mockRestore(); }
});

it('B: preserves two recovery backups and two corrupt journals even with identical timestamps', () => {
  vi.spyOn(Date, 'now').mockReturnValue(123456789);
  try {
    localStorage.setItem(key, '{first');
    recoverCorruptDeletionJournal('u1');
    const firstKeys = backupKeys();
    expect(firstKeys).toHaveLength(1);
    const firstBackup = localStorage.getItem(firstKeys[0]);
    localStorage.setItem(key, '{second');
    expect(() => loadPendingDeletes('u1')).toThrow(CorruptDeletionJournalError);
    expect(localStorage.getItem(`${key}:corrupt`)).toBe('{first');
    recoverCorruptDeletionJournal('u1');
    expect(backupKeys()).toHaveLength(2);
    expect(localStorage.getItem(firstKeys[0])).toBe(firstBackup);
    const preserved = Object.keys(localStorage).filter((k) => k.startsWith(`${key}:corrupt`));
    expect(preserved.map((k) => localStorage.getItem(k)).sort()).toEqual(['{first', '{second']);
  } finally { vi.restoreAllMocks(); }
});

