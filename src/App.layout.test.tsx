import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from './data/sample';

// L1.1 - estrutura de apresentação do shell (sem lógica financeira). O CSS responsivo é
// verificado no navegador em tests/e2e/shell-layout-local.spec.ts.
const mocks = vi.hoisted(() => ({ loadLocalState: vi.fn() }));

vi.mock('./lib/storage', () => ({
  loadLocalState: mocks.loadLocalState,
  saveLocalState: vi.fn(),
  loadUserLocalState: vi.fn(),
  loadUserSyncMetadata: vi.fn(),
  saveUserLocalDirty: vi.fn(),
  saveUserLocalConfirmed: vi.fn(),
  migrateLegacyLocalStateForUser: vi.fn(),
  loadRemoteState: vi.fn(),
  saveRemoteState: vi.fn(),
  deleteRemoteTransaction: vi.fn(),
  deleteRemoteFutureBill: vi.fn(),
  deleteRemoteFutureBillsFrom: vi.fn(),
  loadProfile: vi.fn(),
  saveProfile: vi.fn(),
  getSession: vi.fn(),
  isSupabaseConfigured: false,
  supabase: null
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

const DESTINATIONS = [
  'Dashboard', 'Lançamentos', 'Importar banco/cartão', 'Cartões e parcelas',
  'Contas futuras', 'Investimentos', 'Metas e orçamento', 'Configurações'
];

beforeEach(() => {
  mocks.loadLocalState.mockReturnValue(emptyState());
});

describe('shell navigation presentation', () => {
  it('names every destination for icon-only layouts (aria-label and title)', () => {
    render(<App />);
    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    const buttons = within(navigation).getAllByRole('button');
    expect(buttons).toHaveLength(8);
    for (const name of DESTINATIONS) {
      const button = within(navigation).getByRole('button', { name });
      expect(button).toHaveAttribute('aria-label', name);
      expect(button).toHaveAttribute('title', name);
      expect(button.querySelector('svg')).not.toBeNull();
      expect(button.querySelector('.nav-label')).toHaveTextContent(name);
    }
  });

  it('gives each destination a distinct icon so the rail is not ambiguous', () => {
    render(<App />);
    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    const icons = within(navigation).getAllByRole('button').map((button) => button.querySelector('svg')?.getAttribute('class') ?? '');
    expect(new Set(icons).size).toBe(8);
  });

  it('marks exactly the four primary destinations for the mobile bottom bar, with a short Metas label', () => {
    render(<App />);
    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    const primary = within(navigation).getAllByRole('button')
      .filter((button) => button.getAttribute('data-mobile-primary') === 'true')
      .map((button) => button.getAttribute('aria-label'));
    expect(primary).toEqual(['Dashboard', 'Lançamentos', 'Contas futuras', 'Metas e orçamento']);
    expect(within(navigation).getByRole('button', { name: 'Metas e orçamento' })).toHaveAttribute('data-short-label', 'Metas');
    expect(within(navigation).getByRole('button', { name: 'Dashboard' })).not.toHaveAttribute('data-short-label');
  });

  it('keeps import and export in the menu region and shows Sair only with a session', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: 'Exportar backup' })).toHaveAttribute('title', 'Exportar backup');
    expect(screen.getByRole('button', { name: 'Importar backup' })).toHaveAttribute('title', 'Importar backup');
    expect(screen.queryByRole('button', { name: 'Sair' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abrir menu' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('renders a single sync status element and no retry button when there is no error', () => {
    render(<App />);
    const statuses = document.querySelectorAll('.sidebar-sync');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toHaveAttribute('role', 'status');
    expect(statuses[0]).toHaveAttribute('title', 'Salvo localmente');
    expect(statuses[0]).toHaveTextContent('Salvo localmente');
    expect(screen.queryByRole('button', { name: 'Tentar sincronizar novamente' })).not.toBeInTheDocument();
    expect(screen.getByRole('banner')).not.toHaveTextContent('Modo local');
  });

  it('keeps the same local status visible when the mobile menu opens and closes', async () => {
    const { default: userEvent } = await import('@testing-library/user-event');
    const user = userEvent.setup();
    render(<App />);
    const status = document.querySelector('.sidebar-sync');
    expect(status).toHaveTextContent('Salvo localmente');
    await user.click(screen.getByRole('button', { name: 'Abrir menu' }));
    expect(screen.getByRole('button', { name: 'Fechar menu' })).toHaveAttribute('aria-expanded', 'true');
    expect(document.querySelectorAll('.sidebar-sync')).toHaveLength(1);
    expect(document.querySelector('.sidebar-sync')).toBe(status);
    expect(status).toHaveTextContent('Salvo localmente');
    await user.click(screen.getByRole('button', { name: 'Fechar menu' }));
    expect(document.querySelector('.sidebar-sync')).toBe(status);
  });
});
