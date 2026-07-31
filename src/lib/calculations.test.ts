import { describe, expect, it } from 'vitest';
import { emptyState } from '../data/sample';
import {
  budgetRows,
  commitmentsByCategory,
  expensesByCategory,
  getFirstPaymentMonth,
  getInstallmentAmount,
  getInstallmentsForMonth,
  getMetrics
} from './calculations';

function financeState() {
  const state = emptyState();
  state.settings.selectedMonth = '2026-07';
  state.settings.startingBalance = 1000;
  state.settings.monthlyIncomeEstimate = 3000;
  state.settings.monthlySavingGoal = 500;
  state.settings.emergencyContribution = 100;
  state.settings.cardRules = [{ cardName: 'Visa', closingDay: 20, dueDay: 10 }];
  state.transactions = [
    { id: 'income', date: '2026-07-05', description: 'Salário', type: 'income', category: 'Salário', amount: 3000, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: true, paid: true },
    { id: 'food', date: '2026-07-08', description: 'Mercado', type: 'expense', category: 'Mercado', amount: 250.45, paymentMethod: 'Débito', accountOrCard: 'Conta', essential: true, paid: true },
    { id: 'fun', date: '2026-07-09', description: 'Cinema', type: 'expense', category: 'Lazer', amount: 50, paymentMethod: 'Crédito', accountOrCard: 'Visa', essential: false, paid: false }
  ];
  state.installments = [{ id: 'phone', purchaseDate: '2026-07-21', description: 'Celular', cardName: 'Visa', category: 'Compras', totalAmount: 1200, installments: 6, firstInstallmentMonth: '2026-09', paidInstallments: 0 }];
  state.budgets = [{ id: 'budget', month: '2026-07', category: 'Mercado', monthlyBudget: 400 }];
  return state;
}

describe('financial calculations', () => {
  it('calculates monthly totals and available balance', () => {
    const metrics = getMetrics(financeState(), '2026-07');
    expect(metrics.monthIncome).toBe(3000);
    expect(metrics.monthExpenses).toBe(300.45);
    expect(metrics.availableBalance).toBeCloseTo(3749.55);
    expect(metrics.openInstallments).toBe(1200);
  });

  it('groups expenses and calculates budget differences', () => {
    expect(expensesByCategory(financeState(), '2026-07')).toEqual([
      { name: 'Mercado', value: 250.45 },
      { name: 'Lazer', value: 50 }
    ]);
    expect(budgetRows(financeState(), '2026-07')[0]).toMatchObject({ spent: 250.45, difference: 149.55 });
  });

  it('handles card closing dates and installment projections', () => {
    const state = financeState();
    expect(getFirstPaymentMonth(state, '2026-07-21', 'Visa')).toBe('2026-09');
    expect(getInstallmentAmount(state.installments[0])).toBe(200);
    expect(getInstallmentsForMonth(state, '2026-09')).toHaveLength(1);
  });
});

describe('category commitments', () => {
  const transaction = (date = '2026-07-08') => ({
    id: 'expense', date, description: 'Mercado', type: 'expense' as const,
    category: 'Casa', amount: 100, paymentMethod: 'Pix', accountOrCard: 'Conta',
    essential: true, paid: true
  });
  const bill = (paid = false) => ({
    id: 'bill', dueDate: '2026-07-20', description: 'Internet', category: 'Casa',
    amount: 80, recurring: false, frequency: 'Única' as const, priority: 'Alta' as const, paid
  });
  const installment = () => ({
    id: 'installment', purchaseDate: '2026-06-01', description: 'Móvel', cardName: 'Visa',
    category: 'Casa', totalAmount: 600, installments: 6, firstInstallmentMonth: '2026-07',
    paidInstallments: 0
  });
  const stateForCommitments = () => {
    const state = emptyState();
    state.settings.cardRules = [{ cardName: 'Visa', closingDay: 20, dueDay: 10 }];
    return state;
  };

  it('groups only expense transactions as realized', () => {
    const state = stateForCommitments();
    state.transactions = [transaction()];
    expect(commitmentsByCategory(state, '2026-07')).toEqual([
      { name: 'Casa', realized: 100, futureBills: 0, installments: 0, total: 100 }
    ]);
  });

  it('groups only unpaid future bills', () => {
    const state = stateForCommitments();
    state.bills = [bill()];
    expect(commitmentsByCategory(state, '2026-07')[0]).toMatchObject({ futureBills: 80, total: 80 });
  });

  it('groups only installments projected for the month', () => {
    const state = stateForCommitments();
    state.installments = [installment()];
    expect(commitmentsByCategory(state, '2026-07')[0]).toMatchObject({ installments: 100, total: 100 });
  });

  it('combines the three sources while keeping them separate', () => {
    const state = stateForCommitments();
    state.transactions = [transaction()];
    state.bills = [bill()];
    state.installments = [installment()];
    expect(commitmentsByCategory(state, '2026-07')[0]).toEqual({
      name: 'Casa', realized: 100, futureBills: 80, installments: 100, total: 280
    });
  });

  it('does not count a paid bill in addition to its generated transaction', () => {
    const state = stateForCommitments();
    state.transactions = [{ ...transaction(), source: 'future-bill:bill' }];
    state.bills = [bill(true)];
    expect(commitmentsByCategory(state, '2026-07')[0]).toMatchObject({
      realized: 100, futureBills: 0, total: 100
    });
  });

  it('recalculates commitments when the selected month changes', () => {
    const state = stateForCommitments();
    state.transactions = [transaction(), { ...transaction('2026-08-08'), id: 'august', amount: 40 }];
    state.bills = [bill()];
    state.installments = [installment()];
    expect(commitmentsByCategory(state, '2026-07')[0].total).toBe(280);
    expect(commitmentsByCategory(state, '2026-08')[0]).toEqual({
      name: 'Casa', realized: 40, futureBills: 0, installments: 100, total: 140
    });
  });
});
