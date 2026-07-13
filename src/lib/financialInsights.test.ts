import { describe, expect, it } from "vitest";
import { emptyState } from "../data/sample";
import type { FinanceState, Transaction } from "../types";
import { getFinancialInsights } from "./financialInsights";

const expense = (id: string, date: string, amount: number, category = "Mercado", description = "Compra"): Transaction => ({
  id, date, amount, category, description, type: "expense", paymentMethod: "Pix",
  accountOrCard: "Conta", essential: false, paid: true,
});

function state(): FinanceState {
  const value = emptyState();
  value.settings.selectedMonth = "2026-07";
  return value;
}

describe("financial insights", () => {
  it("explains normal month-over-month spending and category growth", () => {
    const value = state();
    value.transactions = [
      expense("old-market", "2026-06-10", 100),
      expense("old-leisure", "2026-06-11", 200, "Lazer"),
      expense("market", "2026-07-10", 180),
      expense("leisure", "2026-07-11", 210, "Lazer"),
    ];

    const insights = getFinancialInsights(value, "2026-07");
    expect(insights.find((item) => item.id === "spending-change")?.facts).toContainEqual(
      expect.objectContaining({ label: "Variação", value: 30 }),
    );
    expect(insights.find((item) => item.id === "category-growth")?.title).toContain("Mercado");
  });

  it("returns no unsupported claims for a fully empty state", () => {
    expect(getFinancialInsights(state(), "2026-07")).toEqual([]);
  });

  it("omits comparisons when previous history is insufficient", () => {
    const value = state();
    value.transactions = [expense("current", "2026-07-10", 200)];
    const ids = getFinancialInsights(value, "2026-07").map((item) => item.id);
    expect(ids).not.toContain("spending-change");
    expect(ids).not.toContain("category-growth");
    expect(ids).not.toContain("unusual-expense");
  });

  it("handles zero baselines without infinite percentages", () => {
    const value = state();
    value.transactions = [expense("zero", "2026-06-10", 0), expense("current", "2026-07-10", 100)];
    const insights = getFinancialInsights(value, "2026-07");
    expect(insights.some((item) => item.id === "spending-change")).toBe(false);
    insights.flatMap((item) => item.facts).forEach((fact) => {
      if (typeof fact.value === "number") expect(Number.isFinite(fact.value)).toBe(true);
    });
  });

  it("detects an unusual transaction against three prior months", () => {
    const value = state();
    value.transactions = [
      expense("apr", "2026-04-10", 100), expense("may", "2026-05-10", 120),
      expense("jun", "2026-06-10", 80), expense("jul", "2026-07-10", 400, "Casa", "Conserto"),
    ];
    const insight = getFinancialInsights(value, "2026-07").find((item) => item.id === "unusual-expense");
    expect(insight?.title).toContain("Conserto");
    expect(insight?.facts).toContainEqual(expect.objectContaining({ label: "Média recente", value: 100 }));
  });

  it("calculates the projected balance and significant bill impact", () => {
    const value = state();
    value.settings.startingBalance = 1000;
    value.settings.monthlyIncomeEstimate = 2000;
    value.transactions = [
      { ...expense("income", "2026-07-01", 1200, "Salário", "Salário"), type: "income" },
      expense("expense", "2026-07-02", 300),
    ];
    value.bills = [{ id: "rent", dueDate: "2026-07-20", description: "Aluguel", category: "Casa", amount: 700, recurring: true, frequency: "Mensal", priority: "Alta", paid: false }];
    const insights = getFinancialInsights(value, "2026-07");
    expect(insights.find((item) => item.id === "expected-balance")?.facts).toContainEqual(
      expect.objectContaining({ label: "Saldo projetado", value: 2000 }),
    );
    expect(insights.find((item) => item.id === "significant-bill")?.title).toContain("Aluguel");
  });

  it("flags budgets at 80 percent and above the limit, but not below the threshold", () => {
    const value = state();
    value.budgets = [
      { id: "close", month: "2026-07", category: "Mercado", monthlyBudget: 100 },
      { id: "over", month: "2026-07", category: "Lazer", monthlyBudget: 100 },
      { id: "safe", month: "2026-07", category: "Casa", monthlyBudget: 100 },
    ];
    value.transactions = [
      expense("close", "2026-07-01", 80, "Mercado"),
      expense("over", "2026-07-02", 120, "Lazer"),
      expense("safe", "2026-07-03", 79, "Casa"),
    ];
    const budgetInsights = getFinancialInsights(value, "2026-07").filter((item) => item.id.startsWith("budget-"));
    expect(budgetInsights.map((item) => item.id)).toEqual(["budget-over", "budget-close"]);
    expect(budgetInsights[0].tone).toBe("bad");
    expect(budgetInsights[1].tone).toBe("warn");
  });

  it("recognizes repeated descriptions only across multiple months", () => {
    const value = state();
    value.transactions = [
      expense("may", "2026-05-05", 50, "Casa", "Internet"),
      expense("jun", "2026-06-05", 50, "Casa", "internet"),
      expense("jul", "2026-07-05", 50, "Casa", " Internet "),
    ];
    const insight = getFinancialInsights(value, "2026-07").find((item) => item.id === "recurring-expense");
    expect(insight?.facts).toContainEqual(expect.objectContaining({ label: "Ocorrências", value: 3 }));
    expect(insight?.facts).toContainEqual(expect.objectContaining({ label: "Meses", value: 3 }));
  });
});
