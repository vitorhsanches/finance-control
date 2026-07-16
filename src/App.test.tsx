import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  deleteRemoteTransaction: vi.fn(),
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
  it('keeps the topbar focused and groups navigation with utilities in the sidebar', () => {
    render(<App />);

    const navigation = screen.getByRole('navigation', { name: 'Navegação principal' });
    for (const group of ['Visão geral', 'Movimentação', 'Planejamento', 'Sistema']) {
      expect(navigation).toHaveTextContent(group);
    }

    const topbar = screen.getByRole('banner');
    expect(topbar).toHaveTextContent('Dashboard');
    expect(topbar).toHaveTextContent('Mês');
    expect(topbar).not.toHaveTextContent('Modo local');
    expect(screen.getByTitle('Modo local')).toHaveTextContent('Modo local');
    expect(screen.getByRole('button', { name: 'Exportar backup' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Importar backup' })).toBeInTheDocument();
  });

  it('renders and navigates between the main pages', async () => {
    const user = userEvent.setup();
    render(<App />);
    expect(screen.getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    for (const page of ['Lançamentos', 'Importar banco/cartão', 'Cartões e parcelas', 'Contas futuras', 'Investimentos', 'Metas e orçamento', 'Configurações']) {
      await user.click(screen.getByRole('button', { name: page }));
      expect(screen.getByRole('heading', { name: page, level: 1 })).toBeInTheDocument();
    }
  });

  it('filters, clears filters, creates, edits and deletes transactions with confirmation', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Lançamentos' }));

    expect(screen.getByText('Mercado mensal')).toBeInTheDocument();
    expect(screen.queryByText('Mês anterior')).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Categoria'), 'Lazer');
    expect(screen.getByText('Cinema')).toBeInTheDocument();
    expect(screen.queryByText('Mercado mensal')).not.toBeInTheDocument();

    await user.type(screen.getByLabelText('Buscar'), 'inexistente');
    expect(screen.getByText('Nenhum lançamento corresponde aos filtros selecionados.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Limpar' }));
    expect(screen.getByText('Mercado mensal')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    expect(screen.getByDisplayValue('Novo lançamento')).toBeInTheDocument();
    expect(screen.getByText(/Lançamento criado/)).toHaveAttribute('role', 'status');
    await user.clear(screen.getByLabelText('Descrição de Novo lançamento'));
    await user.type(screen.getByLabelText('Descrição de Novo lançamento'), 'Café');
    await user.click(screen.getByRole('button', { name: 'Salvar Novo lançamento' }));
    expect(screen.getByText('Café')).toBeInTheDocument();
    expect(screen.getByText(/Alterações salvas/)).toHaveAttribute('role', 'status');

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    await user.click(screen.getByRole('button', { name: 'Excluir lançamento Café' }));
    expect(screen.getByText('Café')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Excluir lançamento Café' }));
    expect(screen.queryByText('Café')).not.toBeInTheDocument();
    expect(confirmSpy).toHaveBeenCalledTimes(2);
  });

  it('shows an empty state when the selected month has no transactions', async () => {
    const user = userEvent.setup();
    const state = emptyState();
    state.settings.selectedMonth = '2026-07';
    mocks.loadLocalState.mockReturnValue(state);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Lançamentos' }));
    expect(screen.getByText('Nenhum lançamento neste mês. Adicione o primeiro para começar.')).toBeInTheDocument();
    expect(document.querySelector('.transaction-results')).toHaveTextContent('0 de 0 lançamento(s)');
  });

  it('keeps transaction deletion working in local mode', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Lançamentos' }));
    await user.click(screen.getByRole('button', { name: 'Excluir lançamento Mercado mensal' }));
    expect(screen.queryByText('Mercado mensal')).not.toBeInTheDocument();
  });

  it('shows useful empty states on a new account', () => {
    mocks.loadLocalState.mockReturnValue(emptyState());
    render(<App />);
    expect(screen.getByText('Sem gastos no mês selecionado.')).toBeInTheDocument();
    expect(screen.getByText('Nenhuma conta vencendo nos próximos 7 dias.')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Disponível no mês' });
    expect(within(summary).getAllByText(/R\$\s*0/).length).toBeGreaterThan(0);
    expect(within(summary).getByText('Dentro do planejado')).toBeInTheDocument();
  });

  it('shows the primary metrics and updates them when the selected month changes', async () => {
    render(<App />);

    const summary = screen.getByRole('region', { name: 'Disponível no mês' });
    expect(within(summary).getByText('Receitas')).toBeInTheDocument();
    expect(within(summary).getByText('Gastos')).toBeInTheDocument();
    expect(within(summary).getByText('Compromissos futuros')).toBeInTheDocument();
    expect(within(summary).getByText('Gastos').parentElement).toHaveTextContent(/R\$\s*160/);

    fireEvent.change(screen.getByLabelText('Mês'), { target: { value: '2026-06' } });

    expect(within(summary).getByText('Gastos').parentElement).toHaveTextContent(/R\$\s*10/);
  });

  it('keeps financial insights collapsed by default and toggles them open and closed', async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Ver insights' });
    const insights = document.getElementById('dashboard-financial-insights');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'dashboard-financial-insights');
    expect(insights).toHaveAttribute('aria-hidden', 'true');
    expect(screen.getByText(/insights disponíveis para este mês/)).toBeInTheDocument();

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Ocultar insights' })).toHaveAttribute('aria-expanded', 'true');
    expect(insights).toHaveAttribute('aria-hidden', 'false');

    await user.click(screen.getByRole('button', { name: 'Ocultar insights' }));
    expect(screen.getByRole('button', { name: 'Ver insights' })).toHaveAttribute('aria-expanded', 'false');
    expect(insights).toHaveAttribute('aria-hidden', 'true');
  });

  it('supports keyboard interaction for the financial insights disclosure', async () => {
    const user = userEvent.setup();
    render(<App />);

    const toggle = screen.getByRole('button', { name: 'Ver insights' });
    toggle.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByRole('button', { name: 'Ocultar insights' })).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Ocultar insights' })).toHaveAttribute('aria-expanded', 'true');

    await user.keyboard(' ');
    expect(screen.getByRole('button', { name: 'Ver insights' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('summarizes an empty insight set and reveals its existing empty state', async () => {
    const user = userEvent.setup();
    const state = emptyState();
    state.settings.selectedMonth = '2026-07';
    mocks.loadLocalState.mockReturnValue(state);
    render(<App />);

    expect(screen.getByText('Nenhum insight disponível para este mês.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Ver insights' }));
    expect(screen.getByText('Ainda não há dados suficientes para calcular insights deste mês.')).toBeInTheDocument();
  });

  it('opens generic CSV mapping and generates an import preview', async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole('button', { name: 'Importar banco/cartão' }));

    const file = new File(['Quando;Texto;Quantia\n10/07/2026;Padaria;-25,50'], 'custom.csv', { type: 'text/csv' });
    await user.upload(screen.getByLabelText(/Selecionar arquivos/), file);
    expect(await screen.findByRole('heading', { name: /2\. Mapear custom\.csv/ })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Coluna de data/), 'Quando');
    await user.selectOptions(screen.getByLabelText(/Coluna de descrição/), 'Texto');
    await user.selectOptions(screen.getByLabelText(/Coluna de valor/), 'Quantia');
    await user.type(screen.getByLabelText('Nome do perfil'), 'Meu banco');
    await user.click(screen.getByRole('button', { name: 'Salvar perfil' }));
    await user.click(screen.getByRole('button', { name: 'Revisar importação' }));
    expect(await screen.findByRole('heading', { name: '3. Revise antes de importar' })).toBeInTheDocument();
    expect(screen.getByDisplayValue('Padaria')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Voltar ao mapeamento' }));
    expect(screen.getByLabelText(/Coluna de data/)).toHaveValue('Quando');
    await user.click(screen.getByRole('button', { name: 'Revisar importação' }));
    await user.dblClick(screen.getByRole('button', { name: /Confirmar 1 lançamento/ }));
    expect(await screen.findByRole('heading', { name: '4. Importação concluída' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Importar outro arquivo' }));
    await user.upload(screen.getByLabelText(/Selecionar arquivos/), new File(['Quando;Texto;Quantia\n11/07/2026;Mercado;-50,00'], 'again.csv', { type: 'text/csv' }));
    expect(await screen.findByLabelText('Perfil salvo')).toHaveDisplayValue('Meu banco');
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

  it('exports and imports JSON backups through the local state boundary', async () => {
    const user = userEvent.setup();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Exportar backup' }));
    expect(URL.createObjectURL).toHaveBeenCalled();
    expect(clickSpy).toHaveBeenCalled();

    const imported = emptyState();
    imported.settings.startingBalance = 987.65;
    const input = document.querySelector<HTMLInputElement>('input[accept="application/json,.json"]');
    expect(input).not.toBeNull();
    await user.upload(input!, new File([JSON.stringify(imported)], 'backup.json', { type: 'application/json' }));
    await waitFor(() => expect(mocks.saveLocalState).toHaveBeenLastCalledWith(
      expect.objectContaining({ settings: expect.objectContaining({ startingBalance: 987.65 }) })
    ));
  });
});
