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
