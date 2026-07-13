import type { FinanceState, Transaction } from "../types";
import { budgetRows, getMetrics } from "./calculations";
import { addMonths, toNumber, ym } from "./utils";

export type FinancialInsightTone = "good" | "neutral" | "warn" | "bad";
export type FinancialInsightFactFormat = "currency" | "percent" | "count" | "date" | "text";

export interface FinancialInsightFact {
  label: string;
  value: number | string;
  format: FinancialInsightFactFormat;
}

export interface FinancialInsight {
  id: string;
  tone: FinancialInsightTone;
  title: string;
  explanation: string;
  facts: FinancialInsightFact[];
}

const expenseTotal = (transactions: Transaction[], month: string) =>
  transactions
    .filter((transaction) => transaction.type === "expense" && ym(transaction.date) === month)
    .reduce((sum, transaction) => sum + toNumber(transaction.amount), 0);

export function getFinancialInsights(state: FinanceState, month: string): FinancialInsight[] {
  const insights: FinancialInsight[] = [];
  const previousMonth = addMonths(month, -1);
  const currentExpenses = expenseTotal(state.transactions, month);
  const previousExpenses = expenseTotal(state.transactions, previousMonth);

  if (previousExpenses > 0) {
    const difference = currentExpenses - previousExpenses;
    const percentage = (difference / previousExpenses) * 100;
    insights.push({
      id: "spending-change",
      tone: difference <= 0 ? "good" : "warn",
      title: difference <= 0 ? "Gastos diminuíram no mês" : "Gastos aumentaram no mês",
      explanation: "Comparação entre todas as despesas lançadas no mês selecionado e no mês anterior.",
      facts: [
        { label: "Mês atual", value: currentExpenses, format: "currency" },
        { label: "Mês anterior", value: previousExpenses, format: "currency" },
        { label: "Variação", value: percentage, format: "percent" },
      ],
    });
  }

  const categoryGrowth = largestCategoryGrowth(state, month, previousMonth);
  if (categoryGrowth) {
    insights.push({
      id: "category-growth",
      tone: "warn",
      title: `${categoryGrowth.category} teve a maior alta`,
      explanation: "Categoria com o maior aumento absoluto entre o mês anterior e o selecionado, considerando apenas bases anteriores acima de zero.",
      facts: [
        { label: "Mês atual", value: categoryGrowth.current, format: "currency" },
        { label: "Mês anterior", value: categoryGrowth.previous, format: "currency" },
        { label: "Aumento", value: categoryGrowth.current - categoryGrowth.previous, format: "currency" },
      ],
    });
  }

  const unusual = largestUnusualExpense(state, month);
  if (unusual) {
    insights.push({
      id: "unusual-expense",
      tone: "warn",
      title: `Despesa fora do padrão: ${unusual.transaction.description}`,
      explanation: "O valor é pelo menos duas vezes a média dos lançamentos de despesa dos três meses anteriores.",
      facts: [
        { label: "Despesa", value: unusual.transaction.amount, format: "currency" },
        { label: "Média recente", value: unusual.recentAverage, format: "currency" },
        { label: "Base histórica", value: unusual.historyCount, format: "count" },
      ],
    });
  }

  const metrics = getMetrics(state, month);
  const hasProjectionData =
    metrics.availableBalance !== 0 ||
    metrics.monthIncome !== 0 ||
    metrics.monthExpenses !== 0 ||
    metrics.pendingBillsMonth !== 0 ||
    metrics.installmentsMonth !== 0 ||
    toNumber(state.settings.monthlyIncomeEstimate) !== 0;

  if (hasProjectionData) {
    const remainingExpectedIncome = Math.max(
      0,
      toNumber(state.settings.monthlyIncomeEstimate) - metrics.monthIncome,
    );
    insights.push({
      id: "expected-balance",
      tone: metrics.expectedEndBalance >= 0 ? "neutral" : "bad",
      title: metrics.expectedEndBalance >= 0
        ? "Saldo projetado permanece positivo"
        : "Saldo projetado termina negativo",
      explanation: "Projeção com saldo disponível, renda mensal ainda esperada, contas pendentes e parcelas do mês.",
      facts: [
        { label: "Saldo disponível", value: metrics.availableBalance, format: "currency" },
        { label: "Renda esperada", value: remainingExpectedIncome, format: "currency" },
        { label: "Contas + parcelas", value: metrics.pendingBillsMonth + metrics.installmentsMonth, format: "currency" },
        { label: "Saldo projetado", value: metrics.expectedEndBalance, format: "currency" },
      ],
    });
  }

  const significantBill = largestSignificantBill(state, month, metrics.expectedEndBalance, metrics.pendingBillsMonth);
  if (significantBill) {
    insights.push({
      id: "significant-bill",
      tone: significantBill.balanceBeforeBills - significantBill.bill.amount < 0 ? "bad" : "warn",
      title: `${significantBill.bill.description} tem impacto relevante`,
      explanation: "Maior conta pendente do mês; aparece quando representa ao menos 20% do saldo projetado antes das contas ou quando esse saldo já não é positivo.",
      facts: [
        { label: "Vencimento", value: significantBill.bill.dueDate, format: "date" },
        { label: "Conta", value: significantBill.bill.amount, format: "currency" },
        { label: "Saldo antes das contas", value: significantBill.balanceBeforeBills, format: "currency" },
      ],
    });
  }

  const recurring = mostFrequentExpense(state, month);
  if (recurring) {
    insights.push({
      id: "recurring-expense",
      tone: "neutral",
      title: `Despesa recorrente: ${recurring.description}`,
      explanation: "Descrição repetida pelo menos três vezes, em ao menos dois dos últimos três meses incluindo o selecionado.",
      facts: [
        { label: "Ocorrências", value: recurring.count, format: "count" },
        { label: "Meses", value: recurring.monthCount, format: "count" },
        { label: "Total", value: recurring.total, format: "currency" },
      ],
    });
  }

  budgetRows(state, month)
    .filter((budget) => toNumber(budget.monthlyBudget) > 0)
    .map((budget) => ({
      ...budget,
      usage: (budget.spent / toNumber(budget.monthlyBudget)) * 100,
    }))
    .filter((budget) => budget.usage >= 80)
    .sort((a, b) => b.usage - a.usage)
    .slice(0, 2)
    .forEach((budget) => {
      insights.push({
        id: `budget-${budget.id}`,
        tone: budget.usage > 100 ? "bad" : "warn",
        title: budget.usage > 100
          ? `${budget.category} ultrapassou o limite`
          : `${budget.category} está perto do limite`,
        explanation: "Uso do orçamento da categoria no mês selecionado; o alerta começa em 80% do limite.",
        facts: [
          { label: "Gasto", value: budget.spent, format: "currency" },
          { label: "Limite", value: budget.monthlyBudget, format: "currency" },
          { label: "Uso", value: budget.usage, format: "percent" },
        ],
      });
    });

  return insights;
}

function largestCategoryGrowth(state: FinanceState, month: string, previousMonth: string) {
  const totals = (targetMonth: string) => {
    const result = new Map<string, number>();
    state.transactions
      .filter((transaction) => transaction.type === "expense" && ym(transaction.date) === targetMonth)
      .forEach((transaction) => {
        const category = transaction.category || "Outros";
        result.set(category, (result.get(category) || 0) + toNumber(transaction.amount));
      });
    return result;
  };

  const current = totals(month);
  const previous = totals(previousMonth);
  return [...current.entries()]
    .map(([category, value]) => ({ category, current: value, previous: previous.get(category) || 0 }))
    .filter((row) => row.previous > 0 && row.current > row.previous)
    .sort((a, b) => (b.current - b.previous) - (a.current - a.previous))[0];
}

function largestUnusualExpense(state: FinanceState, month: string) {
  const historyMonths = new Set([addMonths(month, -1), addMonths(month, -2), addMonths(month, -3)]);
  const history = state.transactions.filter(
    (transaction) => transaction.type === "expense" && historyMonths.has(ym(transaction.date)),
  );
  if (history.length < 3) return undefined;

  const recentAverage = history.reduce((sum, transaction) => sum + toNumber(transaction.amount), 0) / history.length;
  if (recentAverage <= 0) return undefined;

  const transaction = state.transactions
    .filter((item) => item.type === "expense" && ym(item.date) === month)
    .filter((item) => toNumber(item.amount) >= recentAverage * 2)
    .sort((a, b) => toNumber(b.amount) - toNumber(a.amount))[0];

  return transaction ? { transaction, recentAverage, historyCount: history.length } : undefined;
}

function largestSignificantBill(
  state: FinanceState,
  month: string,
  expectedEndBalance: number,
  pendingBillsMonth: number,
) {
  const bill = state.bills
    .filter((item) => !item.paid && ym(item.dueDate) === month && toNumber(item.amount) > 0)
    .sort((a, b) => toNumber(b.amount) - toNumber(a.amount))[0];
  if (!bill) return undefined;

  const balanceBeforeBills = expectedEndBalance + pendingBillsMonth;
  if (balanceBeforeBills > 0 && toNumber(bill.amount) < balanceBeforeBills * 0.2) return undefined;
  return { bill, balanceBeforeBills };
}

function mostFrequentExpense(state: FinanceState, month: string) {
  const includedMonths = new Set([month, addMonths(month, -1), addMonths(month, -2)]);
  const groups = new Map<string, { description: string; count: number; total: number; months: Set<string> }>();

  state.transactions
    .filter((transaction) => transaction.type === "expense" && includedMonths.has(ym(transaction.date)))
    .forEach((transaction) => {
      const description = transaction.description.trim();
      const key = description.toLocaleLowerCase("pt-BR").replace(/\s+/g, " ");
      if (!key) return;
      const group = groups.get(key) || { description, count: 0, total: 0, months: new Set<string>() };
      group.count += 1;
      group.total += toNumber(transaction.amount);
      group.months.add(ym(transaction.date));
      groups.set(key, group);
    });

  const match = [...groups.values()]
    .filter((group) => group.count >= 3 && group.months.size >= 2)
    .sort((a, b) => b.count - a.count || b.total - a.total)[0];
  return match ? { ...match, monthCount: match.months.size } : undefined;
}
