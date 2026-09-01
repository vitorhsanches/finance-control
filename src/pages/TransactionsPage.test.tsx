import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { emptyState } from "../data/sample";
import type { FinanceState } from "../types";
import { TransactionsPage } from "./TransactionsPage";

function setup(transactions: FinanceState["transactions"]) {
  const state = emptyState();
  state.settings.selectedMonth = "2026-07";
  state.transactions = transactions;
  render(<TransactionsPage state={state} updateState={() => undefined} month="2026-07" onDeleteTransaction={async () => undefined} />);
}

const income = { id: "in", date: "2026-07-01", description: "Salário", type: "income" as const, category: "Salário", amount: 3000, paymentMethod: "Pix", accountOrCard: "Conta", essential: true, paid: true };
const expense = { id: "out", date: "2026-07-02", description: "Mercado", type: "expense" as const, category: "Casa", amount: 250, paymentMethod: "Pix", accountOrCard: "Conta", essential: true, paid: true };

describe("TransactionsPage summary", () => {
  it("renders entries, exits, balance and count from the filtered rows", () => {
    setup([income, expense]);
    const summary = screen.getByLabelText("Resumo dos lançamentos");
    expect(summary).toHaveTextContent("EntradasR$ 3.000");
    expect(summary).toHaveTextContent("SaídasR$ 250");
    expect(summary).toHaveTextContent("SaldoR$ 2.750");
    expect(summary).toHaveTextContent("Lançamentos2");
  });

  it("reacts to category and text filters and can be cleared", () => {
    setup([income, expense]);
    const summary = screen.getByLabelText("Resumo dos lançamentos");
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "Casa" } });
    expect(summary).toHaveTextContent("SaídasR$ 250");
    expect(summary).toHaveTextContent("Lançamentos1");
    fireEvent.change(screen.getByLabelText("Categoria"), { target: { value: "Todos" } });
    fireEvent.change(screen.getByPlaceholderText("Descrição, categoria ou conta"), { target: { value: "Salário" } });
    expect(summary).toHaveTextContent("EntradasR$ 3.000");
    expect(summary).toHaveTextContent("Lançamentos1");
    fireEvent.click(screen.getByRole("button", { name: /limpar/i }));
    expect(summary).toHaveTextContent("Lançamentos2");
  });

  it("shows zeroes for an empty period and excludes other collections", () => {
    setup([]);
    const summary = screen.getByLabelText("Resumo dos lançamentos");
    expect(summary).toHaveTextContent("EntradasR$ 0");
    expect(summary).toHaveTextContent("SaídasR$ 0");
    expect(summary).toHaveTextContent("SaldoR$ 0");
    expect(summary).toHaveTextContent("Lançamentos0");
  });
});
