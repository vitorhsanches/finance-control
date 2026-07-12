import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from './data/sample';
import type { FinanceState } from './types';

const mocks = vi.hoisted(() => ({
  loadLocalState: vi.fn<() => FinanceState>(),
  saveLocalState: vi.fn(),
  parseFinanceFiles: vi.fn(),
  actualParseFinanceFiles: undefined as undefined | typeof import('./lib/importers')['parseFinanceFiles']
}));

vi.mock('./lib/storage', () => ({
  loadLocalState: mocks.loadLocalState,
  saveLocalState: mocks.saveLocalState,
  loadRemoteState: vi.fn(),
  saveRemoteState: vi.fn(),
  loadProfile: vi.fn(),
  saveProfile: vi.fn(),
  getSession: vi.fn(),
  isSupabaseConfigured: false,
  supabase: null
}));

vi.mock('./lib/importers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./lib/importers')>();
  mocks.actualParseFinanceFiles = actual.parseFinanceFiles;
  mocks.parseFinanceFiles.mockImplementation(actual.parseFinanceFiles);
  return { ...actual, parseFinanceFiles: mocks.parseFinanceFiles };
});

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

function appState() {
  const state = emptyState();
  state.settings.selectedMonth = '2026-07';
  state.transactions = [
    { id: 'market', date: '2026-07-05', description: 'Mercado mensal', type: 'expense', category: 'Mercado', amount: 120, paymentMethod: 'Débito', accountOrCard: 'Conta', essential: true, paid: true },
    { id: 'cinema', date: '2026-07-06', description: 'Cinema', type: 'expense', category: 'Lazer', amount: 40, paymentMethod: 'Crédito', accountOrCard: 'Cartão', essential: false, paid: true },
    { id: 'old', date: '2026-06-01', description: 'Mês anterior', type: 'expense', category: 'Outros', amount: 10, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: false, paid: true }
  ];
  return state;
}

beforeEach(() => {
  mocks.loadLocalState.mockReturnValue(appState());
  mocks.parseFinanceFiles.mockReset();
  mocks.parseFinanceFiles.mockImplementation(mocks.actualParseFinanceFiles!);
});

describe('application flows', () => {
  it('renders and navigates between the main pages', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    for (const page of ['Lançamentos', 'Importar banco/cartão', 'Cartões e parcelas', 'Contas futuras', 'Investimentos', 'Metas e orçamento', 'Configurações']) {
      await user.click(screen.getByRole('button', { name: page }));
      expect(screen.getByRole('heading', { name: page, level: 1 })).toBeInTheDocument();
    }
  });

  it('filters transactions and supports adding a transaction', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Lançamentos' }));

    expect(screen.getByDisplayValue('Mercado mensal')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Mês anterior')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Categoria'), 'Lazer');
    expect(screen.getByDisplayValue('Cinema')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Mercado mensal')).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Categoria'), 'Todos');
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(screen.getByDisplayValue('Novo lançamento')).toBeInTheDocument();
  });

  it('shows useful empty states on a new account', () => {
    mocks.loadLocalState.mockReturnValue(emptyState());
    render(<App />);
    expect(screen.getByText('Sem gastos no mês selecionado.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma conta vencendo nos próximos 7 dias.')).toBeInTheDocument();
  });

  it('opens generic CSV mapping and generates an import preview', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Importar banco/cartão' }));

    const file = new File(['Quando;Texto;Quantia\n10/07/2026;Padaria;-25,50'], 'custom.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText(/Selecionar arquivos/), file);
    expect(await screen.findByRole('heading', { name: /Mapear CSV desconhecido/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Coluna de data'), 'Quando');
    await user.selectOptions(screen.getByLabelText('Coluna de descrição'), 'Texto');
    await user.selectOptions(screen.getByLabelText('Coluna de valor'), 'Quantia');
    await user.click(screen.getByRole('button', { name: 'Gerar prévia' }));
    expect(await screen.findByRole('heading', { name: 'Prévia da importação' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Padaria')).toBeInTheDocument();
  });

  it('announces import loading and reports importer errors', async () => {
    const user = userEvent.setup();
    let rejectImport!: (error: Error) => void;
    mocks.parseFinanceFiles.mockImplementation(() => new Promise((_, reject) => { rejectImport = reject; }));
    const alertSpy = vi.spyOn(window, 'alert').mockImplementation(() => undefined);
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Importar banco/cartão' }));
    await user.upload(screen.getByLabelText(/Selecionar arquivos/), new File(['x'], 'broken.csv', { type: 'text/csv' }));

    expect(screen.getByText('Convertendo arquivos...')).toHaveAttribute('role', 'status');
    rejectImport(new Error('Arquivo inválido'));
    await waitFor(() => expect(alertSpy).toHaveBeenCalledWith('Arquivo inválido'));
    await waitFor(() => expect(screen.queryByText('Convertendo arquivos...')).not.toBeInTheDocument());
  });
});
