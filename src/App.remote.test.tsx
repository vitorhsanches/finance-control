import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from './data/sample';

const mocks = vi.hoisted(() => ({
  loadLocalState: vi.fn(),
  saveLocalState: vi.fn(),
  loadRemoteState: vi.fn(),
  saveRemoteState: vi.fn(),
  loadProfile: vi.fn(),
  signOut: vi.fn(),
  getSession: vi.fn(),
  onAuthStateChange: vi.fn()
}));

vi.mock('./lib/storage', () => ({
  isSupabaseConfigured: true,
  loadLocalState: mocks.loadLocalState,
  saveLocalState: mocks.saveLocalState,
  loadRemoteState: mocks.loadRemoteState,
  saveRemoteState: mocks.saveRemoteState,
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
  mocks.getSession.mockResolvedValue({ data: { session: { user } } });
  mocks.onAuthStateChange.mockReturnValue({ data: { subscription: { unsubscribe: vi.fn() } } });
  mocks.signOut.mockResolvedValue({ error: null });
});

async function renderRemoteApp() {
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  await waitFor(() => expect(mocks.loadRemoteState).toHaveBeenCalledWith('user-1'));
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
    mocks.saveRemoteState.mockRejectedValue(new Error('Falha de sincronização'));

    await interaction.click(screen.getByRole('button', { name: 'Configurações' }));
    await interaction.clear(screen.getByLabelText('Saldo inicial'));
    await interaction.type(screen.getByLabelText('Saldo inicial'), '700');
    await interaction.tab();

    expect(await screen.findByText('Falha de sincronização', {}, { timeout: 2500 })).toBeInTheDocument();
    expect(mocks.saveLocalState).toHaveBeenLastCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 700 }) })
    );
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
    expect(order[order.length - 1]).toBe('signOut');
    expect(order.slice(0, -1)).not.toHaveLength(0);
    expect(order.slice(0, -1).every((step) => step === 'save')).toBe(true);
  });
});
