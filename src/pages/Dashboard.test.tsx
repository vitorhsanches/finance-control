import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { emptyState } from '../data/sample';
import { Dashboard } from './Dashboard';

vi.mock('recharts', () => ({
  Area: () => null,
  AreaChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Bar: ({ name, stackId }: { name: string; stackId?: string }) => (
    <div data-testid={`bar-${name}`} data-stack-id={stackId || ''} />
  ),
  BarChart: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => null,
  Legend: () => null,
  ResponsiveContainer: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));

describe('Dashboard commitments chart', () => {
  it('keeps commitment states grouped and separate without a shared stack', () => {
    const state = emptyState();
    state.settings.selectedMonth = '2026-07';
    state.transactions = [{
      id: 'realized', date: '2026-07-08', description: 'Pago', type: 'expense',
      category: 'Casa', amount: 100, paymentMethod: 'Pix', accountOrCard: 'Conta',
      essential: true, paid: true,
    }];
    state.bills = [{
      id: 'bill', dueDate: '2026-07-20', description: 'Conta', category: 'Casa',
      amount: 80, recurring: false, frequency: 'Única', priority: 'Alta', paid: false,
    }];
    state.installments = [{
      id: 'installment', purchaseDate: '2026-06-01', description: 'Compra', cardName: 'Visa',
      category: 'Casa', totalAmount: 600, installments: 6,
      firstInstallmentMonth: '2026-07', paidInstallments: 0,
    }];

    render(<Dashboard state={state} month="2026-07" displayName="Teste" email={null} />);

    expect(screen.getByTestId('bar-Realizado')).toHaveAttribute('data-stack-id', '');
    expect(screen.getByTestId('bar-Contas futuras')).toHaveAttribute('data-stack-id', '');
    expect(screen.getByTestId('bar-Parcelas')).toHaveAttribute('data-stack-id', '');
    expect(screen.getByText(/são estados diferentes e podem conter itens ainda não reconciliados/i)).toBeInTheDocument();
  });
});

describe('Dashboard 2.0 layout', () => {
  it('uses approved labels, removes duplicate hero rows, and reads reserves from settings', () => {
    const state = emptyState();
    state.settings.monthlySavingGoal = 725;
    state.settings.emergencyContribution = 125;
    render(<Dashboard state={state} month="2026-07" displayName="Teste" email={null} />);

    expect(screen.getByText('Disponível previsto ao fim do mês')).toBeInTheDocument();
    expect(screen.getByText('Saldo acumulado')).toBeInTheDocument();
    expect(screen.getByText('Entradas')).toBeInTheDocument();
    expect(screen.getByText('Saídas')).toBeInTheDocument();
    expect(screen.getByText('Economia planejada')).toBeInTheDocument();
    expect(screen.getByText('Reserva de emergência')).toBeInTheDocument();
    const summary = screen.getByRole('region', { name: 'Resumo do mês' });
    const primary = summary.querySelector('.dash-primary');
    expect(primary).not.toHaveTextContent('Receitas');
    expect(primary).not.toHaveTextContent('Gastos');
    expect(primary).toHaveTextContent(/R\$\s*725/);
    expect(primary).toHaveTextContent(/R\$\s*125/);
  });

  it('renders an accessible budget progress image and a negative status', () => {
    const state = emptyState();
    state.settings.selectedMonth = '2026-07';
    state.budgets = [{ id: 'food-budget', month: '2026-07', category: 'Alimentação', monthlyBudget: 100 }];
    state.transactions = [{
      id: 'food-expense', date: '2026-07-08', description: 'Compra', type: 'expense', category: 'Alimentação',
      amount: 125, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: true, paid: true,
    }];
    render(<Dashboard state={state} month="2026-07" displayName="Teste" email={null} />);

    expect(screen.getAllByText('Passou')).toHaveLength(2);
    expect(screen.getAllByRole('img', { name: /Alimentação: R\$\s*125 gastos de R\$\s*100 de limite/ })).toHaveLength(2);
  });
});

describe('Dashboard personalized greeting', () => {
  it.each([
    { displayName: 'Ana Teste', email: 'ana@exemplo.test', greeting: 'Olá, Ana Teste 👋' },
    { displayName: '   ', email: 'bruno@exemplo.test', greeting: 'Olá, bruno 👋' },
    { displayName: '', email: null, greeting: 'Olá, bem-vindo 👋' },
  ])('renders "$greeting" from the available fictional profile fields', ({ displayName, email, greeting }) => {
    render(<Dashboard state={emptyState()} month="2026-07" displayName={displayName} email={email} />);

    const welcome = screen.getByText(greeting);
    expect(welcome).toBeInTheDocument();
    expect(welcome.closest('.mobile-hidden')).not.toBeNull();
  });
});
