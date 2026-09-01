import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from './data/sample';

const mocks = vi.hoisted(() => ({
  loadLocalState: vi.fn(),
  saveLocalState: vi.fn(),
  loadUserLocalState: vi.fn(),
  loadUserSyncMetadata: vi.fn(),
  saveUserLocalDirty: vi.fn(),
  saveUserLocalConfirmed: vi.fn(),
  migrateLegacyLocalStateForUser: vi.fn(),
  loadRemoteState: vi.fn(),
  saveRemoteState: vi.fn(),
  getRemoteErrorDetails: vi.fn(),
  deleteRemoteTransaction: vi.fn(),
  deleteRemoteFutureBill: vi.fn(),
  deleteRemoteFutureBillsFrom: vi.fn(),
  loadProfile: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn()
}));

vi.mock('./lib/storage', () => ({
  isSupabaseConfigured: true,
  loadLocalState: mocks.loadLocalState,
  saveLocalState: mocks.saveLocalState,
  loadUserLocalState: mocks.loadUserLocalState,
  loadUserSyncMetadata: mocks.loadUserSyncMetadata,
  saveUserLocalDirty: mocks.saveUserLocalDirty,
  saveUserLocalConfirmed: mocks.saveUserLocalConfirmed,
  migrateLegacyLocalStateForUser: mocks.migrateLegacyLocalStateForUser,
  loadRemoteState: mocks.loadRemoteState,
  saveRemoteState: mocks.saveRemoteState,
  getRemoteErrorDetails: mocks.getRemoteErrorDetails,
  deleteRemoteTransaction: mocks.deleteRemoteTransaction,
  deleteRemoteFutureBill: mocks.deleteRemoteFutureBill,
  deleteRemoteFutureBillsFrom: mocks.deleteRemoteFutureBillsFrom,
  loadProfile: mocks.loadProfile,
  saveProfile: vi.fn(),
  getSession: vi.fn(),
  supabase: {
    auth: {
      getSession: mocks.getSession,
      onAuthStateChange: mocks.onAuthStateChange,
      signOut: mocks.signOut
    }
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

const user = { id: 'user-1', email: 'user@example.com' };

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  const state = emptyState();
  state.settings.selectedMonth = '2026-07';
  state.settings.startingBalance = 123;
  mocks.loadLocalState.mockReturnValue(emptyState());
  mocks.loadRemoteState.mockResolvedValue(state);
  mocks.loadProfile.mockResolvedValue({ displayName: 'Ana' });
  mocks.saveRemoteState.mockResolvedValue(undefined);
  mocks.loadUserLocalState.mockReturnValue(null);
  mocks.loadUserSyncMetadata.mockReturnValue(null);
  mocks.saveUserLocalDirty.mockImplementation(() => undefined);
  mocks.saveUserLocalConfirmed.mockImplementation(() => undefined);
  mocks.migrateLegacyLocalStateForUser.mockReturnValue(false);
  mocks.getRemoteErrorDetails.mockImplementation((error: unknown) => ({ message: error instanceof Error ? error.message : 'Erro remoto desconhecido.' }));
  mocks.deleteRemoteTransaction.mockResolvedValue(undefined);
  mocks.deleteRemoteFutureBill.mockResolvedValue(undefined);
  mocks.deleteRemoteFutureBillsFrom.mockResolvedValue(undefined);
  mocks.getSession.mockResolvedValue({ data: { session: { user } } });
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.signOut.mockResolvedValue({ error: null });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

async function renderRemoteApp() {
  const result = render(<App />);
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  await waitFor(() => expect(mocks.loadRemoteState).toHaveBeenCalledWith('user-1'));
  await waitFor(() => expect(mocks.saveUserLocalConfirmed).toHaveBeenCalledWith(
    'user-1',
    expect.objectContaining({ settings: expect.objectContaining({ selectedMonth: '2026-07' }) }),
    expect.any(Number),
  ));
  return result;
}

describe('remote application lifecycle', () => {
  it('loads remote data and persists settings changes through autosave', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '2500');
    await interaction.tab();

    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 2500 }) })
    ), { timeout: 2500 });
    expect(screen.getByTitle(/Online Supabase/)).toBeInTheDocument();
  });

  it('shows autosave failures while preserving the edited local state', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState.mockRejectedValue(new TypeError('Failed to fetch'));

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    await interaction.clear(screen.getByLabelText('Saldo inicial'));
    await interaction.type(screen.getByLabelText('Saldo inicial'), '700');
    await interaction.tab();

    expect(await screen.findByText('Erro de sincronização', {}, { timeout: 2500 })).toBeInTheDocument();
    expect(mocks.saveUserLocalDirty).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 700 }) }),
      expect.any(Number),
      expect.any(Number),
    );
    await interaction.click(screen.getByRole('button', { name: 'Ver detalhes de sincronização' }));
    expect(screen.getAllByText('Failed to fetch').length).toBeGreaterThan(0);
  });

  it('returns to the online status after an autosave succeeds following a failure', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState.mockRejectedValueOnce(new Error('Falha de sincronização'));

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '700');
    await interaction.tab();
    expect(await screen.findByText('Erro de sincronização', {}, { timeout: 2500 })).toBeInTheDocument();

    await interaction.clear(balance);
    await interaction.type(balance, '701');
    await interaction.tab();

    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(2), { timeout: 2500 });
  });

  it('coalesces changes during an active save and confirms only the newest revision', async () => {
    const interaction = userEvent.setup();
    const firstSave = deferred();
    const latestSave = deferred();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => latestSave.promise);

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '700');
    await interaction.tab();
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(1), { timeout: 2500 });

    await interaction.clear(balance);
    await interaction.type(balance, '701');
    await interaction.clear(balance);
    await interaction.type(balance, '702');
    await interaction.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 900));
    expect(mocks.saveRemoteState).toHaveBeenCalledTimes(1);

    await act(async () => firstSave.resolve());
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(2));
    expect(mocks.saveRemoteState).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 702 }) }),
    );
    expect(screen.queryByText('Online Supabase')).not.toBeInTheDocument();

    await act(async () => latestSave.resolve());
    expect(await screen.findByText('Online Supabase')).toBeInTheDocument();
  });

  it('continues with the newest pending snapshot after the active save fails', async () => {
    const interaction = userEvent.setup();
    const firstSave = deferred();
    const latestSave = deferred();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => latestSave.promise);

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '800');
    await interaction.tab();
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(1), { timeout: 2500 });
    await interaction.clear(balance);
    await interaction.type(balance, '801');
    await interaction.tab();
    await new Promise((resolve) => window.setTimeout(resolve, 900));

    await act(async () => firstSave.reject(new TypeError('Failed to fetch')));
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(2));
    expect(mocks.saveRemoteState).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 801 }) }),
    );
    expect(mocks.saveUserLocalDirty).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 801 }) }),
      expect.any(Number),
      expect.any(Number),
    );

    await act(async () => latestSave.resolve());
    expect(await screen.findByText('Online Supabase')).toBeInTheDocument();
    expect(screen.queryByText('Erro de sincronização')).not.toBeInTheDocument();
  });

  it('manual retry uses the latest state and repeated clicks do not create concurrent saves', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '900');
    await interaction.tab();
    expect(await screen.findByText('Erro de sincronização', {}, { timeout: 2500 })).toBeInTheDocument();

    const retrySave = deferred();
    mocks.saveRemoteState.mockImplementationOnce(() => retrySave.promise);
    await interaction.clear(balance);
    await interaction.type(balance, '901');
    await interaction.click(screen.getByRole('button', { name: 'Ver detalhes de sincronização' }));
    const retryButton = screen.getByRole('button', { name: 'Tentar novamente' });
    await interaction.click(retryButton);
    await interaction.click(retryButton);
    await interaction.click(retryButton);

    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(2));
    expect(mocks.saveRemoteState).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 901 }) }),
    );
    await act(async () => retrySave.resolve());
    expect(await screen.findByText('Online Supabase')).toBeInTheDocument();
  });

  it('retries the latest unconfirmed state when the browser reports online', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '950');
    await interaction.tab();
    expect(await screen.findByText('Erro de sincronização', {}, { timeout: 2500 })).toBeInTheDocument();

    mocks.saveRemoteState.mockResolvedValueOnce(undefined);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(2));
    expect(mocks.saveRemoteState).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 950 }) }),
    );
    expect(await screen.findByText('Online Supabase')).toBeInTheDocument();
  });

  it('preserves a dirty user snapshot at boot and confirms it instead of loading older remote data', async () => {
    const interaction = userEvent.setup();
    const local = emptyState();
    local.settings.selectedMonth = '2026-07';
    local.settings.startingBalance = 777;
    const reconciliation = deferred();
    mocks.loadUserLocalState.mockReturnValue(local);
    mocks.loadUserSyncMetadata.mockReturnValue({
      userId: 'user-1', localRevision: 5, confirmedRevision: 4, dirty: true,
      updatedAt: '2026-09-01T10:00:00.000Z', lastConfirmedAt: '2026-09-01T09:00:00.000Z', schemaVersion: 1,
    });
    mocks.saveRemoteState.mockImplementation(() => reconciliation.promise);

    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    expect(screen.getByLabelText('Saldo inicial')).toHaveValue('777');
    expect(mocks.loadRemoteState).not.toHaveBeenCalled();
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledWith('user-1', local));
    expect(screen.queryByText('Online Supabase')).not.toBeInTheDocument();

    await act(async () => reconciliation.resolve());
    expect(await screen.findByText('Online Supabase')).toBeInTheDocument();
    expect(mocks.saveUserLocalConfirmed).toHaveBeenLastCalledWith('user-1', local, 5);
  });

  it('keeps dirty state after reconciliation failure and retries it on window online', async () => {
    const local = emptyState();
    local.settings.selectedMonth = '2026-07';
    local.settings.startingBalance = 778;
    mocks.loadUserLocalState.mockReturnValue(local);
    mocks.loadUserSyncMetadata.mockReturnValue({
      userId: 'user-1', localRevision: 6, confirmedRevision: 5, dirty: true,
      updatedAt: '2026-09-01T10:00:00.000Z', lastConfirmedAt: '2026-09-01T09:00:00.000Z', schemaVersion: 1,
    });
    mocks.saveRemoteState.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    render(<App />);
    expect(await screen.findByText('Erro de sincronização', {}, { timeout: 2500 })).toBeInTheDocument();
    expect(mocks.saveUserLocalDirty).toHaveBeenCalledWith('user-1', local, 6, 5);
    expect(mocks.saveUserLocalConfirmed).not.toHaveBeenCalledWith('user-1', local, 6);

    mocks.saveRemoteState.mockResolvedValueOnce(undefined);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Online Supabase')).toBeInTheDocument();
    expect(mocks.saveUserLocalConfirmed).toHaveBeenLastCalledWith('user-1', local, 6);
  });

  it('uses a clean per-user backup while remote is unavailable and reloads remote on online', async () => {
    const interaction = userEvent.setup();
    const local = emptyState();
    local.settings.selectedMonth = '2026-07';
    local.settings.startingBalance = 410;
    const remote = emptyState();
    remote.settings.selectedMonth = '2026-07';
    remote.settings.startingBalance = 420;
    mocks.loadUserLocalState.mockReturnValue(local);
    mocks.loadUserSyncMetadata.mockReturnValue({
      userId: 'user-1', localRevision: 2, confirmedRevision: 2, dirty: false,
      updatedAt: '2026-09-01T10:00:00.000Z', lastConfirmedAt: '2026-09-01T10:00:00.000Z', schemaVersion: 1,
    });
    mocks.loadRemoteState
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(remote);

    render(<App />);
    expect(await screen.findByText('Erro de sincronização')).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    expect(screen.getByLabelText('Saldo inicial')).toHaveValue('410');
    expect(mocks.saveRemoteState).not.toHaveBeenCalled();

    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(screen.getByLabelText('Saldo inicial')).toHaveValue('420'));
    expect(await screen.findByText('Online Supabase')).toBeInTheDocument();
  });

  it('preserves a failed edit across an authenticated reload and retries the local snapshot', async () => {
    const interaction = userEvent.setup();
    const states = new Map<string, ReturnType<typeof emptyState>>();
    const metadata = new Map<string, { userId: string; localRevision: number; confirmedRevision: number; dirty: boolean; updatedAt: string; lastConfirmedAt: string | null; schemaVersion: number }>();
    mocks.loadUserLocalState.mockImplementation((id: string) => states.get(id) || null);
    mocks.loadUserSyncMetadata.mockImplementation((id: string) => metadata.get(id) || null);
    mocks.saveUserLocalDirty.mockImplementation((id: string, savedState: ReturnType<typeof emptyState>, localRevision: number, confirmedRevision: number) => {
      states.set(id, savedState);
      metadata.set(id, { userId: id, localRevision, confirmedRevision, dirty: true, updatedAt: new Date().toISOString(), lastConfirmedAt: null, schemaVersion: 1 });
    });
    mocks.saveUserLocalConfirmed.mockImplementation((id: string, savedState: ReturnType<typeof emptyState>, revision: number) => {
      states.set(id, savedState);
      metadata.set(id, { userId: id, localRevision: revision, confirmedRevision: revision, dirty: false, updatedAt: new Date().toISOString(), lastConfirmedAt: new Date().toISOString(), schemaVersion: 1 });
    });

    const firstRender = render(<App />);
    await waitFor(() => expect(mocks.saveUserLocalConfirmed).toHaveBeenCalled());
    mocks.saveRemoteState.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '779');
    await interaction.tab();
    expect(await screen.findByText('Erro de sincronização', {}, { timeout: 2500 })).toBeInTheDocument();
    expect(metadata.get('user-1')?.dirty).toBe(true);
    firstRender.unmount();

    mocks.saveRemoteState.mockResolvedValueOnce(undefined);
    const remoteLoadsBeforeReload = mocks.loadRemoteState.mock.calls.length;
    render(<App />);
    await interaction.click(await screen.findByRole('button', { name: 'Configurações' }));
    expect(screen.getByLabelText('Saldo inicial')).toHaveValue('779');
    expect(mocks.loadRemoteState.mock.calls.length).toBe(remoteLoadsBeforeReload);
    await waitFor(() => expect(metadata.get('user-1')?.dirty).toBe(false));
  });

  it('isolates dirty snapshots across users and restores user A when they return', async () => {
    const interaction = userEvent.setup();
    const stateA = emptyState();
    stateA.settings.selectedMonth = '2026-07';
    stateA.settings.startingBalance = 111;
    const stateB = emptyState();
    stateB.settings.selectedMonth = '2026-07';
    stateB.settings.startingBalance = 222;
    const dirtyMetadata = {
      userId: 'user-1', localRevision: 3, confirmedRevision: 2, dirty: true,
      updatedAt: '2026-09-01T10:00:00.000Z', lastConfirmedAt: null, schemaVersion: 1,
    };
    let authCallback!: (_event: string, session: { user: { id: string; email?: string } } | null) => void;
    mocks.onAuthStateChange.mockImplementation((callback: typeof authCallback) => {
      authCallback = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    });
    mocks.loadUserLocalState.mockImplementation((id: string) => id === 'user-1' ? stateA : null);
    mocks.loadUserSyncMetadata.mockImplementation((id: string) => id === 'user-1' ? dirtyMetadata : null);
    mocks.loadRemoteState.mockImplementation(async (id: string) => id === 'user-2' ? stateB : emptyState());
    mocks.saveRemoteState.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<App />);
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledWith('user-1', stateA));
    await act(async () => authCallback('SIGNED_IN', { user: { id: 'user-2', email: 'b@example.com' } }));
    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    await waitFor(() => expect(screen.getByLabelText('Saldo inicial')).toHaveValue('222'));
    expect(mocks.saveRemoteState).not.toHaveBeenCalledWith('user-2', stateA);

    await act(async () => authCallback('SIGNED_IN', { user: { id: 'user-1', email: 'a@example.com' } }));
    await waitFor(() => expect(screen.getByLabelText('Saldo inicial')).toHaveValue('111'));
  });

  it('does not clear a dirty per-user backup during logout', async () => {
    const interaction = userEvent.setup();
    const local = emptyState();
    local.settings.selectedMonth = '2026-07';
    local.settings.startingBalance = 880;
    mocks.loadUserLocalState.mockReturnValue(local);
    mocks.loadUserSyncMetadata.mockReturnValue({
      userId: 'user-1', localRevision: 8, confirmedRevision: 7, dirty: true,
      updatedAt: '2026-09-01T10:00:00.000Z', lastConfirmedAt: null, schemaVersion: 1,
    });
    mocks.saveRemoteState.mockRejectedValue(new TypeError('Failed to fetch'));

    render(<App />);
    expect(await screen.findByText('Erro de sincronização')).toBeInTheDocument();
    mocks.saveUserLocalConfirmed.mockClear();
    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    await interaction.click(logoutButtons[logoutButtons.length - 1]);

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(mocks.saveUserLocalDirty).toHaveBeenCalledWith('user-1', local, 8, 7);
    expect(mocks.saveUserLocalConfirmed).not.toHaveBeenCalledWith('user-1', local, 8);
  });

  it('waits for a final save before logging out', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    const order: string[] = [];
    mocks.saveRemoteState.mockImplementation(async () => { order.push('save'); });
    mocks.signOut.mockImplementation(async () => { order.push('signOut'); return { error: null }; });

    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    await interaction.click(logoutButtons[logoutButtons.length - 1]);
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' });
    expect(order[order.length - 1]).toBe('signOut');
    expect(order.slice(0, -1)).not.toHaveLength(0);
    expect(order.slice(0, -1).every((step) => step === 'save')).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  });

  it('flushes the newest pending snapshot before logging out', async () => {
    const interaction = userEvent.setup();
    const firstSave = deferred();
    const latestSave = deferred();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState
      .mockImplementationOnce(() => firstSave.promise)
      .mockImplementationOnce(() => latestSave.promise);

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '1000');
    await interaction.tab();
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(1), { timeout: 2500 });
    await interaction.clear(balance);
    await interaction.type(balance, '1001');

    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    await interaction.click(logoutButtons[logoutButtons.length - 1]);
    expect(mocks.signOut).not.toHaveBeenCalled();
    await act(async () => firstSave.resolve());
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(2));
    expect(mocks.saveRemoteState).toHaveBeenLastCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 1001 }) }),
    );
    expect(mocks.signOut).not.toHaveBeenCalled();

    await act(async () => latestSave.resolve());
    await waitFor(() => expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' }));
  });

  it('does not block logout indefinitely when the remote save never settles', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState.mockImplementation(() => new Promise(() => undefined));

    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    await interaction.click(logoutButtons[logoutButtons.length - 1]);

    await waitFor(
      () => expect(mocks.signOut).toHaveBeenCalledWith({ scope: 'local' }),
      { timeout: 6500 },
    );
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
  }, 8000);

  it('logs out even when the final remote save fails and keeps the local backup', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveUserLocalConfirmed.mockClear();
    mocks.saveRemoteState.mockRejectedValue(new Error('save unavailable'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    await interaction.click(logoutButtons[logoutButtons.length - 1]);

    await waitFor(() => expect(mocks.signOut).toHaveBeenCalled());
    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(mocks.saveUserLocalConfirmed).not.toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 0 }) }),
      expect.any(Number),
    );
    errorSpy.mockRestore();
  });

  it('clears local authentication when the remote session has already expired', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveUserLocalConfirmed.mockClear();
    mocks.signOut.mockResolvedValue({
      error: Object.assign(new Error('Auth session missing!'), { name: 'AuthSessionMissingError' })
    });
    const warningSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    await interaction.click(logoutButtons[logoutButtons.length - 1]);

    expect(await screen.findByRole('heading', { name: 'Entrar' })).toBeInTheDocument();
    expect(mocks.saveUserLocalConfirmed).not.toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 0 }) }),
      expect.any(Number),
    );
    warningSpy.mockRestore();
  });

  it('keeps the local backup and reports a real sign-out failure', async () => {
    const interaction = userEvent.setup();
    await renderRemoteApp();
    mocks.saveUserLocalConfirmed.mockClear();
    mocks.signOut.mockResolvedValue({ error: new Error('Logout service unavailable') });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const logoutButtons = screen.getAllByRole('button', { name: 'Sair' });
    await interaction.click(logoutButtons[logoutButtons.length - 1]);

    expect(await screen.findByText('Erro de sincronização')).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Ver detalhes de sincronização' }));
    expect(screen.getAllByText(/Logout service unavailable/).length).toBeGreaterThan(0);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(mocks.saveUserLocalConfirmed).not.toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 0 }) }),
      expect.any(Number),
    );
    errorSpy.mockRestore();
  });

  it('deletes a remote transaction before removing it locally and it stays absent after reload', async () => {
    const interaction = userEvent.setup();
    const remoteState = emptyState();
    remoteState.settings.selectedMonth = '2026-07';
    remoteState.transactions = [{ id: 't1', date: '2026-07-10', description: 'Mercado remoto', type: 'expense', category: 'Casa', amount: 25, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: true, paid: true }];
    mocks.loadRemoteState.mockResolvedValue(remoteState);

    const firstRender = await renderRemoteApp();
    await interaction.click(screen.getByRole('button', { name: 'Lançamentos' }));
    expect(screen.getByText('Mercado remoto')).toBeInTheDocument();
    await interaction.click(screen.getByRole('button', { name: 'Excluir lançamento Mercado remoto' }));

    await waitFor(() => expect(mocks.deleteRemoteTransaction).toHaveBeenCalledWith('user-1', 't1'));
    await waitFor(() => expect(screen.queryByText('Mercado remoto')).not.toBeInTheDocument());

    firstRender.unmount();
    const reloadedState = emptyState();
    reloadedState.settings.selectedMonth = '2026-07';
    mocks.loadRemoteState.mockResolvedValue(reloadedState);
    await renderRemoteApp();
    await interaction.click(screen.getByRole('button', { name: 'Lançamentos' }));
    expect(screen.queryByText('Mercado remoto')).not.toBeInTheDocument();
  });

  it('keeps a transaction visible when its remote delete fails', async () => {
    const interaction = userEvent.setup();
    const remoteState = emptyState();
    remoteState.settings.selectedMonth = '2026-07';
    remoteState.transactions = [{ id: 't1', date: '2026-07-10', description: 'Não apagar', type: 'expense', category: 'Casa', amount: 25, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: true, paid: true }];
    mocks.loadRemoteState.mockResolvedValue(remoteState);
    mocks.deleteRemoteTransaction.mockRejectedValue(new Error('delete unavailable'));

    await renderRemoteApp();
    await interaction.click(screen.getByRole('button', { name: 'Lançamentos' }));
    await interaction.click(screen.getByRole('button', { name: 'Excluir lançamento Não apagar' }));

    expect(await screen.findByText(/delete unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Não apagar')).toBeInTheDocument();
  });

});
