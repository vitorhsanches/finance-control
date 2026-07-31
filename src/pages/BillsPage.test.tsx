import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
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

function Harness({ bills = [] }: { bills?: FutureBill[] }) {
  const initial = emptyState();
  initial.settings.selectedMonth = '2026-07';
  initial.bills = bills;
  const [state, setState] = useState<FinanceState>(initial);
  return (
    <>
      <BillsPage state={state} updateState={setState} month="2026-07" />
      <output data-testid="bills-state">{JSON.stringify(state.bills)}</output>
    </>
  );
}

function currentBills() {
  return JSON.parse(screen.getByTestId('bills-state').textContent || '[]') as FutureBill[];
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
