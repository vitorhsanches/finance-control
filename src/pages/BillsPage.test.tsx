import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { emptyState } from '../data/sample';
import type { FinanceState, FutureBill } from '../types';
import { BillsPage } from './BillsPage';

function recurringBill(overrides: Partial<FutureBill> = {}): FutureBill {
  return {
    id: 'bill-1',
    dueDate: '2026-07-20',
    description: 'Internet',
    category: 'Casa',
    amount: 100,
    recurring: true,
    frequency: 'Mensal',
    priority: 'Alta',
    paid: false,
    ...overrides,
  };
}

function Harness({
  bills = [],
  transactions = [],
  onDeleteFutureBill,
  onDeleteFutureBillsFrom,
}: {
  bills?: FutureBill[];
  transactions?: FinanceState['transactions'];
  onDeleteFutureBill?: (billId: string) => Promise<void>;
  onDeleteFutureBillsFrom?: (seriesId: string, occurrenceNumber: number) => Promise<void>;
}) {
  const initial = emptyState();
  initial.settings.selectedMonth = '2026-07';
  initial.bills = bills;
  initial.transactions = transactions;
  const [state, setState] = useState<FinanceState>(initial);
  return (
    <>
      <BillsPage
        state={state}
        updateState={setState}
        month="2026-07"
        onDeleteFutureBill={onDeleteFutureBill}
        onDeleteFutureBillsFrom={onDeleteFutureBillsFrom}
      />
      <output data-testid="bills-state">{JSON.stringify(state.bills)}</output>
      <output data-testid="transactions-state">{JSON.stringify(state.transactions)}</output>
    </>
  );
}

function currentBills() {
  return JSON.parse(screen.getByTestId('bills-state').textContent || '[]') as FutureBill[];
}

function currentTransactions() {
  return JSON.parse(screen.getByTestId('transactions-state').textContent || '[]') as FinanceState['transactions'];
}

describe('future bill recurrence identity', () => {
  it('gives every new recurring bill a unique series id and occurrence one', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    await user.click(screen.getByRole('button', { name: 'Adicionar' }));
    const bills = currentBills();
    expect(bills).toHaveLength(2);
    expect(bills[0].seriesId).toBeTruthy();
    expect(bills[1].seriesId).toBeTruthy();
    expect(bills[0].seriesId).not.toBe(bills[1].seriesId);
    expect(bills.map((bill) => bill.occurrenceNumber)).toEqual([1, 1]);
  });

  it('preserves the series id and increments the next occurrence', async () => {
    const user = userEvent.setup();
    render(<Harness bills={[recurringBill({ seriesId: 'series-1', occurrenceNumber: 3 })]} />);
    await user.click(screen.getByRole('button', { name: 'Pagar' }));
    const bills = currentBills();
    expect(bills.find((bill) => bill.id === 'bill-1')).toMatchObject({
      paid: true,
      seriesId: 'series-1',
      occurrenceNumber: 3,
    });
    expect(bills.find((bill) => bill.id !== 'bill-1')).toMatchObject({
      paid: false,
      seriesId: 'series-1',
      occurrenceNumber: 4,
    });
  });

  it('starts a new series only when a legacy recurring bill generates its next occurrence', async () => {
    const user = userEvent.setup();
    render(<Harness bills={[recurringBill()]} />);
    expect(currentBills()[0]).not.toHaveProperty('seriesId');
    await user.click(screen.getByRole('button', { name: 'Pagar' }));
    const bills = currentBills();
    const current = bills.find((bill) => bill.id === 'bill-1');
    const next = bills.find((bill) => bill.id !== 'bill-1');
    expect(current).toMatchObject({ occurrenceNumber: 1 });
    expect(current?.seriesId).toBeTruthy();
    expect(next).toMatchObject({ seriesId: current?.seriesId, occurrenceNumber: 2 });
  });

  it('keeps visually identical recurring series independent', async () => {
    const user = userEvent.setup();
    render(<Harness bills={[
      recurringBill({ id: 'first', seriesId: 'series-a', occurrenceNumber: 1 }),
      recurringBill({ id: 'second', seriesId: 'series-b', occurrenceNumber: 1 }),
    ]} />);
    const payButtons = screen.getAllByRole('button', { name: 'Pagar' });
    await user.click(payButtons[0]);
    const bills = currentBills();
    expect(bills.filter((bill) => bill.seriesId === 'series-a')).toHaveLength(2);
    expect(bills.filter((bill) => bill.seriesId === 'series-b')).toHaveLength(1);
  });

  it('clears recurrence identity when a bill becomes non-recurring', async () => {
    const user = userEvent.setup();
    render(<Harness bills={[recurringBill({ seriesId: 'series-1', occurrenceNumber: 1 })]} />);
    await user.click(screen.getByRole('checkbox'));
    expect(currentBills()[0]).toMatchObject({ recurring: false });
    expect(currentBills()[0]).not.toHaveProperty('seriesId');
    expect(currentBills()[0]).not.toHaveProperty('occurrenceNumber');
  });
});

describe('safe recurring future bill deletion', () => {
  it('deletes a bill without series identity only as an individual occurrence', async () => {
    const user = userEvent.setup();
    const deleteOne = vi.fn().mockResolvedValue(undefined);
    render(<Harness bills={[recurringBill()]} onDeleteFutureBill={deleteOne} />);
    await user.click(screen.getByRole('button', { name: /Excluir conta futura Internet/ }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(deleteOne).toHaveBeenCalledWith('bill-1');
  });

  it('defaults to individual deletion and explains that previous occurrences remain', async () => {
    const user = userEvent.setup();
    const deleteOne = vi.fn().mockResolvedValue(undefined);
    render(<Harness bills={[recurringBill({ seriesId: 'series-a', occurrenceNumber: 1 })]} onDeleteFutureBill={deleteOne} />);
    await user.click(screen.getByRole('button', { name: /Excluir conta futura Internet/ }));
    expect(screen.getByRole('radio', { name: 'Somente esta ocorrência' })).toBeChecked();
    expect(screen.getByText(/Ocorrências anteriores não serão removidas/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(deleteOne).toHaveBeenCalledWith('bill-1');
  });

  it('removes this and later occurrences locally while preserving another identical series', async () => {
    const user = userEvent.setup();
    render(<Harness bills={[
      recurringBill({ id: 'current', seriesId: 'series-a', occurrenceNumber: 1 }),
      recurringBill({ id: 'next', seriesId: 'series-a', occurrenceNumber: 2 }),
      recurringBill({ id: 'other', seriesId: 'series-b', occurrenceNumber: 1 }),
    ]} />);
    await user.click(screen.getAllByRole('button', { name: /Excluir conta futura Internet/ })[0]);
    await user.click(screen.getByRole('radio', { name: 'Esta e as próximas' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(currentBills().map((bill) => bill.id)).toEqual(['other']);
  });

  it('blocks ranged deletion when a previous occurrence could regenerate the series', async () => {
    const user = userEvent.setup();
    render(<Harness bills={[
      recurringBill({ id: 'previous', seriesId: 'series-a', occurrenceNumber: 1 }),
      recurringBill({ id: 'current', seriesId: 'series-a', occurrenceNumber: 2 }),
    ]} />);
    await user.click(screen.getAllByRole('button', { name: /Excluir conta futura Internet/ })[1]);
    expect(screen.getByRole('radio', { name: 'Esta e as próximas' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/ocorrência anterior poderia recriar a série/i);
    expect(currentBills()).toHaveLength(2);
  });

  it('keeps every bill visible when a remote ranged delete fails', async () => {
    const user = userEvent.setup();
    const deleteFrom = vi.fn().mockRejectedValue(new Error('remote failure'));
    render(<Harness
      bills={[
        recurringBill({ id: 'current', seriesId: 'series-a', occurrenceNumber: 1 }),
        recurringBill({ id: 'next', seriesId: 'series-a', occurrenceNumber: 2 }),
      ]}
      onDeleteFutureBillsFrom={deleteFrom}
    />);
    await user.click(screen.getAllByRole('button', { name: /Excluir conta futura Internet/ })[0]);
    await user.click(screen.getByRole('radio', { name: 'Esta e as próximas' }));
    await user.click(screen.getByRole('button', { name: 'Excluir' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    expect(currentBills()).toHaveLength(2);
    expect(deleteFrom).toHaveBeenCalledWith('series-a', 1);
  });
});

describe('future bill payment reversal integrity', () => {
  it('removes only the exact linked payment transaction', async () => {
    const user = userEvent.setup();
    const first = recurringBill({ id: 'first', description: 'Conta igual', dueDate: '2026-07-20', category: 'Casa', amount: 100 });
    const second = recurringBill({ id: 'second', description: 'Conta igual', dueDate: '2026-07-20', category: 'Casa', amount: 100 });
    render(<Harness bills={[first, second]} transactions={[{
      id: 'second-payment', date: second.dueDate, description: second.description,
      type: 'expense', category: second.category, amount: second.amount,
      paymentMethod: 'Boleto', accountOrCard: 'Conta', essential: true, paid: true,
      source: 'future-bill:second'
    }]} />);

    await user.click(screen.getAllByRole('button', { name: 'Pagar' })[0]);
    await user.click(screen.getByRole('button', { name: 'Desmarcar' }));

    expect(currentBills().find((bill) => bill.id === 'first')).toMatchObject({ paid: false });
    expect(currentTransactions()).toHaveLength(1);
    expect(currentTransactions()[0].source).toBe('future-bill:second');
  });

  it('does not remove a similar transaction when the exact linked payment is absent', async () => {
    const user = userEvent.setup();
    const bill = recurringBill({ id: 'first', paid: true, description: 'Conta igual', dueDate: '2026-07-20', category: 'Casa', amount: 100 });
    render(<Harness bills={[bill]} transactions={[{
      id: 'similar-manual', date: bill.dueDate, description: bill.description,
      type: 'expense', category: bill.category, amount: bill.amount,
      paymentMethod: 'Pix', accountOrCard: 'Conta', essential: true, paid: true,
      source: 'manual'
    }]} />);

    await user.click(screen.getByRole('button', { name: 'Desmarcar' }));
    expect(currentBills()[0]).toMatchObject({ paid: false });
    expect(currentTransactions()).toHaveLength(1);
    expect(currentTransactions()[0].source).toBe('manual');
  });
});
