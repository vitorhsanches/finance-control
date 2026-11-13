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
  <button onClick={() => { void onDeleteFutureBillsFrom?.('s1', 2); }}>Delete series</button>
  <button onClick={() => updateState((s) => ({ ...s, bills: [...s.bills, { id: 'new', seriesId: 's1', occurrenceNumber: 2, dueDate: '2026-07-01', description: 'New', category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false }] }))}>Recreate</button>
</> }));

import { App } from './App';
import { CorruptDeletionJournalError, getUserLocalStateKey, loadPendingDeletes, loadUserLocalState, recoverCorruptDeletionJournal } from './lib/storage';

const mock = createSupabaseMock();
fake.client = mock.client;
const key = 'finance-control-pending-deletes-v1:user:u1';
let rows: Array<Record<string, unknown>>;
let holdSession = false;
let release: () => void;
let entered = false;

beforeEach(() => {
  localStorage.clear(); mock.reset(); holdSession = false; entered = false;
  rows = [1, 2, 3, 4].map((n) => ({ user_id: 'u1', id: `x${n}`, series_id: 's1', occurrence_number: n, due_date: '2026-07-01', description: `Bill ${n}`, category: 'Casa', amount: 1, recurring: true, frequency: 'Mensal', priority: 'Alta', paid: false }));
  mock.auth.getSession = (async () => {
    if (holdSession) { holdSession = false; entered = true; await new Promise<void>((r) => { release = r; }); }
    return { data: { session: { user: { id: 'u1' } } } };
  }) as unknown as typeof mock.auth.getSession;
  mock.setResolver((call) => {
    if (call.table === 'future_bills') {
      if (call.operation === 'delete') rows = rows.filter((r) => !(r.series_id === 's1' && Number(r.occurrence_number) >= 2));
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

it('filters S1 in the App slot before P0 confirms the series delete; a later recreation persists', async () => {
  render(<App />);
  await screen.findByTitle('Online Supabase');
  fireEvent.click(screen.getByRole('button', { name: 'Contas futuras' }));
  await screen.findByText('Edit');
  holdSession = true;
  fireEvent.click(await screen.findByText('Edit'));
  act(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(entered).toBe(true));
  fireEvent.click(screen.getByText('Edit'));
  act(() => window.dispatchEvent(new Event('online'))); // S1 waits in pendingSaveRef, not storage's queue.
  fireEvent.click(screen.getByText('Delete series'));
  await act(async () => { release(); });
  await waitFor(() => expect(screen.getByTitle('Online Supabase')).toBeInTheDocument());
  expect(loadPendingDeletes('u1')).toEqual([]);
  expect(rows.map((r) => r.id)).toEqual(['x1']);
  const upserts = mock.calls.filter((c) => c.table === 'future_bills' && c.operation === 'upsert');
  expect(upserts.length).toBeGreaterThanOrEqual(2);
  for (const call of upserts) expect((call.payload as typeof rows).map((r) => r.id)).toEqual(['x1']);
  fireEvent.click(screen.getByText('Recreate'));
  act(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(rows.map((r) => r.id)).toEqual(['x1', 'new']));
});

it('blocks corrupt boot with cache, preserves the journal and resumes saving after explicit recovery', async () => {
  const cache = '{"bills":[]}';
  localStorage.setItem(getUserLocalStateKey('u1'), cache);
  localStorage.setItem(key, '{broken');
  expect(() => loadUserLocalState('u1')).toThrow(CorruptDeletionJournalError);
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Diário de exclusões corrompido' })).toBeInTheDocument();
  expect(mock.calls).toHaveLength(0);
  expect(localStorage.getItem(getUserLocalStateKey('u1'))).toBe(cache);
  fireEvent.click(screen.getByText('Preservar diário e recuperar dados online'));
  await screen.findByTitle('Online Supabase');
  expect(localStorage.getItem(`${key}:corrupt`)).toBe('{broken');
  expect(localStorage.getItem(key)).toBeNull();
  expect(rows).toHaveLength(4);
  fireEvent.click(screen.getByRole('button', { name: 'Contas futuras' }));
  fireEvent.click(await screen.findByText('Edit'));
  act(() => window.dispatchEvent(new Event('online')));
  await waitFor(() => expect(mock.calls.some((c) => c.table === 'app_settings' && c.operation === 'upsert')).toBe(true));
});

it('catches journal corruption during autosave without unmounting the UI', async () => {
  render(<App />); await screen.findByTitle('Online Supabase');
  fireEvent.click(screen.getByRole('button', { name: 'Contas futuras' }));
  localStorage.setItem(key, '{broken');
  fireEvent.click(await screen.findByText('Edit'));
  expect(await screen.findByRole('alert')).toHaveTextContent('Diário de exclusões corrompido');
  expect(rows).toHaveLength(4);
});

it('does not release a corrupt journal when its preservation fails', () => {
  localStorage.setItem(key, '{broken');
  const original = Storage.prototype.setItem;
  const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, value) {
    if (k === `${key}:corrupt`) throw new Error('quota');
    original.call(this, k, value);
  });
  try {
    expect(() => recoverCorruptDeletionJournal('u1')).toThrow('quota');
    expect(localStorage.getItem(key)).toBe('{broken');
  } finally { spy.mockRestore(); }
});
