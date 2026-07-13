import { Plus, Trash2 } from "lucide-react";
import type { Budget } from "../types";
import { budgetRows } from "../lib/calculations";
import { money, uid } from "../lib/utils";
import { MoneyInput, Panel, StatusBadge } from "../components/ui";
import type { PageProps } from "./types";

export function BudgetsPage({
  state,
  updateState,
  month,
}: PageProps & { month: string }) {
  const rows = budgetRows(state, month);
  const add = () =>
    updateState((prev) => ({
      ...prev,
      budgets: [
        {
          id: uid("bg"),
          month,
          category: prev.settings.categories[0] || "Outros",
          monthlyBudget: 0,
        },
        ...prev.budgets,
      ],
    }));
  const patch = (id: string, patch: Partial<Budget>) =>
    updateState((prev) => ({
      ...prev,
      budgets: prev.budgets.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }));
  const remove = (id: string) =>
    updateState((prev) => ({
      ...prev,
      budgets: prev.budgets.filter((b) => b.id !== id),
    }));
  return (
    <Panel
      title="Metas e orçamento"
      action={
        <button className="primary" onClick={add}>
          <Plus size={16} /> Adicionar
        </button>
      }
    >
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Mês</th>
              <th>Categoria</th>
              <th>Limite</th>
              <th>Gasto atual</th>
              <th>Diferença</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b) => (
              <tr key={b.id}>
                <td>
                  <input
                    type="month"
                    value={b.month}
                    onChange={(e) => patch(b.id, { month: e.target.value })}
                  />
                </td>
                <td>
                  <select
                    value={b.category}
                    onChange={(e) => patch(b.id, { category: e.target.value })}
                  >
                    {state.settings.categories.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <MoneyInput
                    value={b.monthlyBudget}
                    onChange={(value) => patch(b.id, { monthlyBudget: value })}
                  />
                </td>
                <td>{money(b.spent, state)}</td>
                <td>{money(b.difference, state)}</td>
                <td>
                  <StatusBadge bad={b.difference < 0}>
                    {b.difference >= 0 ? "Dentro" : "Passou"}
                  </StatusBadge>
                </td>
                <td>
                  <button
                    type="button"
                    className="icon danger"
                    aria-label={`Excluir orçamento de ${b.category}`}
                    title="Excluir orçamento"
                    onClick={() => remove(b.id)}
                  >
                    <Trash2 size={15} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
