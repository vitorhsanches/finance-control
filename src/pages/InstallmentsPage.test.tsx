import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { emptyState } from "../data/sample";
import { InstallmentsPage } from "./InstallmentsPage";

describe("InstallmentsPage overview", () => {
  it("keeps all overview metrics and their current data sources", () => {
    const state = emptyState();
    state.settings.selectedMonth = "2026-07";
    state.installments = [{
      id: "phone",
      purchaseDate: "2026-06-01",
      description: "Celular",
      cardName: "Visa",
      category: "Compras",
      totalAmount: 600,
      installments: 6,
      firstInstallmentMonth: "2026-06",
      paidInstallments: 1,
    }];

    render(<InstallmentsPage state={state} updateState={() => undefined} month="2026-07" />);

    const overview = screen.getByLabelText("Resumo de cartões e parcelas");
    expect(overview).toHaveTextContent("Fatura em parcelas");
    expect(overview).toHaveTextContent("Parcelas no mês");
    expect(overview).toHaveTextContent("Maior cartão do mês");
    expect(overview).toHaveTextContent("Total em aberto");
    expect(overview).toHaveTextContent("R$ 100");
    expect(overview).toHaveTextContent("R$ 500");
    expect(screen.getByText("Fatura por cartão")).toBeInTheDocument();
    expect(screen.getByText("Maiores parcelas do mês")).toBeInTheDocument();
  });
});
