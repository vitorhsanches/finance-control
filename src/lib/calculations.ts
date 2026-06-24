import type { FinanceState, Installment } from '../types';
import { addMonths, daysRemainingInMonth, safeDateForMonth, toNumber, ym } from './utils';

export function getCardRule(state: FinanceState, cardName: string) {
  return state.settings.cardRules.find((rule) => rule.cardName === cardName) || { cardName, closingDay: 20, dueDay: 10 };
}

export function getFirstPaymentMonth(state: FinanceState, purchaseDate: string, cardName: string) {
  const purchaseMonth = ym(purchaseDate) || state.settings.selectedMonth;
  const rule = getCardRule(state, cardName);
  const purchaseDay = new Date(`${purchaseDate}T00:00:00`).getDate();
  const closingMonth = purchaseDay <= rule.closingDay ? purchaseMonth : addMonths(purchaseMonth, 1);
  return rule.dueDay > rule.closingDay ? closingMonth : addMonths(closingMonth, 1);
}

export function getInstallmentAmount(item: Installment) {
  const qty = Math.max(1, toNumber(item.installments));
  return toNumber(item.totalAmount) / qty;
}

export function getInstallmentDueDate(state: FinanceState, item: Installment, offset = 0) {
  const rule = getCardRule(state, item.cardName);
  const baseMonth = item.firstInstallmentMonth || getFirstPaymentMonth(state, item.purchaseDate, item.cardName);
  return safeDateForMonth(addMonths(baseMonth, offset), rule.dueDay);
}

export function getInstallmentsForMonth(state: FinanceState, month: string) {
  const rows: Array<{ item: Installment; installmentNumber: number; dueDate: string; amount: number }> = [];
  state.installments.forEach((item) => {
    const total = Math.max(1, toNumber(item.installments));
    const paid = Math.max(0, toNumber(item.paidInstallments));
    for (let i = paid; i < total; i += 1) {
      const dueDate = getInstallmentDueDate(state, item, i);
      if (ym(dueDate) === month) rows.push({ item, installmentNumber: i + 1, dueDate, amount: getInstallmentAmount(item) });
    }
  });
  return rows;
}

export function getMetrics(state: FinanceState, month: string) {
  const monthTransactions = state.transactions.filter((t) => ym(t.date) === month);
  const paidIncome = state.transactions.filter((t) => t.type === 'income' && t.paid).reduce((sum, t) => sum + toNumber(t.amount), 0);
  const paidExpenses = state.transactions.filter((t) => t.type === 'expense' && t.paid).reduce((sum, t) => sum + toNumber(t.amount), 0);
  const monthIncome = monthTransactions.filter((t) => t.type === 'income').reduce((sum, t) => sum + toNumber(t.amount), 0);
  const monthExpenses = monthTransactions.filter((t) => t.type === 'expense').reduce((sum, t) => sum + toNumber(t.amount), 0);
  const pendingBillsMonth = state.bills.filter((b) => ym(b.dueDate) === month && !b.paid).reduce((sum, b) => sum + toNumber(b.amount), 0);
  const installmentsMonth = getInstallmentsForMonth(state, month).reduce((sum, row) => sum + row.amount, 0);
  const investments = state.investments.reduce((sum, inv) => sum + toNumber(inv.currentAmount), 0);
  const openInstallments = state.installments.reduce((sum, item) => {
    const remaining = Math.max(0, toNumber(item.installments) - toNumber(item.paidInstallments));
    return sum + remaining * getInstallmentAmount(item);
  }, 0);
  const availableBalance = toNumber(state.settings.startingBalance) + paidIncome - paidExpenses;
  const expectedIncome = Math.max(0, toNumber(state.settings.monthlyIncomeEstimate) - monthIncome);
  const expectedEndBalance = availableBalance + expectedIncome - pendingBillsMonth - installmentsMonth;
  const safeToSpend = expectedEndBalance - toNumber(state.settings.monthlySavingGoal) - toNumber(state.settings.emergencyContribution);
  const dailyLimit = safeToSpend / daysRemainingInMonth(month);
  const netWorth = availableBalance + investments - openInstallments;

  return {
    availableBalance,
    monthIncome,
    monthExpenses,
    pendingBillsMonth,
    installmentsMonth,
    expectedEndBalance,
    safeToSpend,
    dailyLimit,
    investments,
    openInstallments,
    netWorth
  };
}

export function expensesByCategory(state: FinanceState, month: string) {
  const map = new Map<string, number>();
  state.transactions
    .filter((t) => t.type === 'expense' && ym(t.date) === month)
    .forEach((t) => map.set(t.category || 'Outros', (map.get(t.category || 'Outros') || 0) + toNumber(t.amount)));
  return [...map.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

export function budgetRows(state: FinanceState, month: string) {
  return state.budgets
    .filter((b) => b.month === month)
    .map((b) => {
      const spent = state.transactions
        .filter((t) => t.type === 'expense' && ym(t.date) === month && t.category === b.category)
        .reduce((sum, t) => sum + toNumber(t.amount), 0);
      return { ...b, spent, difference: toNumber(b.monthlyBudget) - spent };
    });
}

export function upcomingBills(state: FinanceState, days = 7) {
  const now = new Date();
  const limit = new Date();
  limit.setDate(limit.getDate() + days);
  return state.bills
    .filter((b) => !b.paid)
    .filter((b) => {
      const d = new Date(`${b.dueDate}T00:00:00`);
      return d >= now && d <= limit;
    })
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}
