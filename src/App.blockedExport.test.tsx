import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { emptyState } from './data/sample';
import { createSupabaseMock } from './test/supabaseMock';

const fake = vi.hoisted(() => ({ client: null as unknown }));
vi.mock('./lib/supabaseClient', () => ({ isSupabaseConfigured: true, get supabase() { return fake.client; } }));
vi.mock('./pages/Dashboard', () => ({ Dashboard: () => <h1>Dashboard</h1> }));

import { App } from './App';
import { getUserLocalStateKey } from './lib/storage';

const mock = createSupabaseMock();
fake.client = mock.client;
const journalKey = 'finance-control-pending-deletes-v1:user:u1';

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear(); mock.reset();
  mock.auth.getSession = (async () => ({ data: { session: { user: { id: 'u1' } } } })) as unknown as typeof mock.auth.getSession;
  localStorage.setItem(journalKey, '{broken');
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
});

async function blobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

it('exports the exact user cache on corrupt boot instead of the empty fallback', async () => {
  const cached = emptyState();
  cached.settings.startingBalance = 4321;
  cached.bills = [{ id: 'kept', description: 'Cached bill', dueDate: '2026-11-01', category: 'Casa', amount: 125, recurring: false, frequency: 'Única', priority: 'Alta', paid: false }];
  const raw = JSON.stringify(cached, null, 4);
  localStorage.setItem(getUserLocalStateKey('u1'), raw);
  const createURL = vi.spyOn(URL, 'createObjectURL');
  render(<App />);
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: 'Exportar backup' }));
  expect(createURL).toHaveBeenCalledTimes(1);
  const exported = await blobText(createURL.mock.calls[0][0] as Blob);
  expect(exported).toBe(raw);
  expect(JSON.parse(exported).bills[0].id).toBe('kept');
  expect(JSON.parse(exported).settings.startingBalance).toBe(4321);
  expect(mock.calls).toHaveLength(0);
  expect(localStorage.getItem(getUserLocalStateKey('u1'))).toBe(raw);
  expect(localStorage.getItem(journalKey)).toBe('{broken');
});

it.each([null, ''])('disables blocked export without a usable cache (%s)', async (raw) => {
  if (raw !== null) localStorage.setItem(getUserLocalStateKey('u1'), raw);
  // Another account's cache must never enable this user's export.
  localStorage.setItem(getUserLocalStateKey('u2'), JSON.stringify(emptyState()));
  const createURL = vi.spyOn(URL, 'createObjectURL');
  render(<App />); await screen.findByRole('alert');
  const button = screen.getByRole('button', { name: 'Exportar backup' });
  expect(button).toBeDisabled();
  expect(screen.getByText(/Não há cache local disponível para exportar/)).toBeInTheDocument();
  fireEvent.click(button);
  expect(createURL).not.toHaveBeenCalled();
  expect(mock.calls).toHaveLength(0);
});
