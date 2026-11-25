import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from './data/sample';

// L1.1 - o mesmo indicador de status oferece retry compacto no erro (cabeçalho mobile).
const mocks = vi.hoisted(() => ({
  loadLocalState: vi.fn(),
  loadUserLocalState: vi.fn(),
  loadUserSyncMetadata: vi.fn(),
  loadPendingDeletes: vi.fn(),
  loadRemoteState: vi.fn(),
  saveRemoteState: vi.fn(),
  getRemoteErrorDetails: vi.fn(),
  loadProfile: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn(),
  signOut: vi.fn()
}));

vi.mock('./lib/storage', () => ({
  isSupabaseConfigured: true,
  loadLocalState: mocks.loadLocalState,
  saveLocalState: vi.fn(),
  loadUserLocalState: mocks.loadUserLocalState,
  loadUserSyncMetadata: mocks.loadUserSyncMetadata,
  loadPendingDeletes: mocks.loadPendingDeletes,
  recordPendingDelete: vi.fn(),
  recordPendingSeriesDelete: vi.fn(),
  cleanupConfirmedSyncMetadataOnLogout: vi.fn(),
  saveUserLocalDirty: vi.fn(),
  saveUserLocalConfirmed: vi.fn(),
  migrateLegacyLocalStateForUser: vi.fn(() => false),
  loadRemoteState: mocks.loadRemoteState,
  saveRemoteState: mocks.saveRemoteState,
  getRemoteErrorDetails: mocks.getRemoteErrorDetails,
  deleteRemoteTransaction: vi.fn(),
  deleteRemoteFutureBill: vi.fn(),
  deleteRemoteFutureBillsFrom: vi.fn(),
  recoverCorruptDeletionJournal: vi.fn(),
  loadProfile: mocks.loadProfile,
  saveProfile: vi.fn(),
  getSession: vi.fn(),
  supabase: { auth: { getSession: mocks.getSession, onAuthStateChange: mocks.onAuthStateChange, signOut: mocks.signOut } }
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

beforeEach(() => {
  const state = emptyState();
  state.settings.selectedMonth = '2026-07';
  mocks.loadLocalState.mockReturnValue(emptyState());
  mocks.loadRemoteState.mockResolvedValue(state);
  mocks.loadProfile.mockResolvedValue({ displayName: 'Ana' });
  mocks.saveRemoteState.mockResolvedValue(undefined);
  mocks.loadUserLocalState.mockReturnValue(null);
  mocks.loadUserSyncMetadata.mockReturnValue(null);
  mocks.loadPendingDeletes.mockReturnValue([]);
  mocks.getRemoteErrorDetails.mockImplementation((error: unknown) => ({ message: error instanceof Error ? error.message : 'Erro remoto desconhecido.' }));
  mocks.getSession.mockResolvedValue({ data: { session: { user } } });
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.signOut.mockResolvedValue({ error: null });
});

describe('sync status in the shell (remote session)', () => {
  it('keeps the syncing state readable while the menu is open and closed', async () => {
    const interaction = userEvent.setup();
    let releaseSave: (() => void) | undefined;
    mocks.loadUserLocalState.mockReturnValue(emptyState());
    mocks.loadUserSyncMetadata.mockReturnValue({ dirty: true, localRevision: 2, confirmedRevision: 1 });
    mocks.saveRemoteState.mockImplementation(() => new Promise<void>((resolve) => { releaseSave = resolve; }));
    render(<App />);
    await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 5000 });
    await waitFor(() => expect(document.querySelector('.sidebar-sync')).toHaveTextContent(/Sincronizando/));

    const status = document.querySelector('.sidebar-sync');
    await interaction.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(document.querySelectorAll('.sidebar-sync')).toHaveLength(1);
    expect(document.querySelector('.sidebar-sync')).toBe(status);
    expect(status).toHaveTextContent(/Sincronizando/);
    await interaction.click(screen.getByRole('button', { name: 'Fechar menu' }));
    expect(status).toHaveTextContent(/Sincronizando/);
    releaseSave?.();
  });
  it('keeps pending changes visible in both mobile menu states', async () => {
    const interaction = userEvent.setup();
    mocks.loadPendingDeletes.mockReturnValue([{ table: 'transactions', id: 'pending-1' }]);
    render(<App />);
    await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 5000 });
    const status = await waitFor(() => {
      const element = document.querySelector('.sidebar-sync');
      expect(element).toHaveTextContent(/pendentes/);
      return element;
    });
    await interaction.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(document.querySelectorAll('.sidebar-sync')).toHaveLength(1);
    expect(document.querySelector('.sidebar-sync')).toBe(status);
    expect(status).toHaveTextContent(/pendentes/);
    await interaction.click(screen.getByRole('button', { name: 'Fechar menu' }));
    expect(status).toHaveTextContent(/pendentes/);
  });

  it('shows Sair and, on a sync error, a compact retry on the same status element', async () => {
    const interaction = userEvent.setup();
    render(<App />);
    expect(await screen.findByRole('heading', { name: 'Dashboard' }, { timeout: 5000 })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTitle('Online Supabase')).toBeInTheDocument());
    expect(document.querySelectorAll('.sidebar-sync')).toHaveLength(1);
    const onlineStatus = document.querySelector('.sidebar-sync');
    await interaction.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(document.querySelectorAll('.sidebar-sync')).toHaveLength(1);
    expect(document.querySelector('.sidebar-sync')).toBe(onlineStatus);
    expect(onlineStatus).toHaveTextContent('Online Supabase');
    await interaction.click(screen.getByRole('button', { name: 'Fechar menu' }));
    expect(screen.getByRole('button', { name: 'Sair' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar sincronizar novamente' })).not.toBeInTheDocument();
    mocks.saveRemoteState.mockClear();
    mocks.saveRemoteState.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    const balance = screen.getByLabelText('Saldo inicial');
    await interaction.clear(balance);
    await interaction.type(balance, '700');
    await interaction.tab();

    const status = await screen.findByTitle(/Erro de sincronização/, {}, { timeout: 2500 });
    expect(document.querySelectorAll('.sidebar-sync')).toHaveLength(1);
    const retry = screen.getByRole('button', { name: 'Tentar sincronizar novamente' });
    expect(status).toContainElement(retry);
    await interaction.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(document.querySelectorAll('.sidebar-sync')).toHaveLength(1);
    expect(status).toContainElement(retry);
    expect(retry).toBeVisible();
    await interaction.click(screen.getByRole('button', { name: 'Fechar menu' }));

    await act(async () => { await interaction.click(retry); });
    await waitFor(() => expect(mocks.saveRemoteState).toHaveBeenCalledTimes(2));
    expect(await screen.findByTitle('Online Supabase')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Tentar sincronizar novamente' })).not.toBeInTheDocument();
  });
});
