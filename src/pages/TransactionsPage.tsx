import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Transaction } from "../types";
import { currentMonth, todayISO, uid, ym } from "../lib/utils";
import { MoneyInput, Panel, Select } from "../components/ui";
import type { PageProps } from "./types";

export function TransactionsPage({
  state,
  updateState,
  month,
}: PageProps & { month: string }) {
  const [category, setCategory] = useState("Todos");
  const [type, setType] = useState("Todos");
  const [pendingDateChanges, setPendingDateChanges] = useState<Record<string, string>>({});
  const rows = useMemo(
    () =>
      state.transactions
        .filter((t) => ym(t.date) === month)
        .filter((t) => category === "Todos" || t.category === category)
        .filter((t) => type === "Todos" || t.type === type),
    [state.transactions, month, category, type],
  );
  const fallbackExpenseCategories = [
    "Alimentação",
    "Transporte",
    "Casa",
    "Compras",
    "Saúde",
    "Educação",
    "Lazer",
    "Outros",
  ];

  const fallbackIncomeCategories = [
    "Salário",
    "Freelance",
    "Investimentos",
    "Outras receitas",
  ];

  const expenseCategories =
    state.settings.categories.length > 0
      ? state.settings.categories
      : fallbackExpenseCategories;

  const incomeCategories =
    state.settings.incomeCategories.length > 0
      ? state.settings.incomeCategories
      : fallbackIncomeCategories;

  const categories = [
    ...incomeCategories,
    ...expenseCategories,
  ];

  const getTransactionCategoryOptions = (transaction: Transaction) => {
    const baseOptions =
      transaction.type === "income" ? incomeCategories : expenseCategories;

    return Array.from(
      new Set(
        [...baseOptions, transaction.category]
          .map((item) => item?.trim())
          .filter(Boolean),
      ),
    );
  };

  const add = () =>
    updateState((prev) => ({
      ...prev,
      transactions: [
        {
          id: uid("tr"),
          date: month === currentMonth() ? todayISO() : `${month}-01`,
          description: "Novo lançamento",
          type: "expense",
          category: prev.settings.categories[0] || "Outros",
          amount: 0,
          paymentMethod: "Pix",
          accountOrCard: prev.settings.accounts[0] || "Conta",
          essential: false,
          paid: true,
        },
        ...prev.transactions,
      ],
    }));

  const patch = (id: string, patch: Partial<Transaction>) =>
    updateState((prev) => ({
      ...prev,
      transactions: prev.transactions.map((t) =>
        t.id === id ? { ...t, ...patch } : t,
      ),
    }));

  const changeDate = (transaction: Transaction, nextDate: string) => {
    if (!nextDate) return;

    const currentDate = transaction.date || todayISO();
    const currentTransactionMonth = ym(currentDate);
    const nextTransactionMonth = ym(nextDate);

    if (nextTransactionMonth !== currentTransactionMonth) {
      setPendingDateChanges((prev) => ({
        ...prev,
        [transaction.id]: nextDate,
      }));
      return;
    }

  setPendingDateChanges((prev) => {
    const copy = { ...prev };
    delete copy[transaction.id];
    return copy;
  });

  patch(transaction.id, { date: nextDate });
};

  const confirmDateChange = (transactionId: string) => {
    const nextDate = pendingDateChanges[transactionId];
    if (!nextDate) return;

    patch(transactionId, { date: nextDate });

    setPendingDateChanges((prev) => {
      const copy = { ...prev };
      delete copy[transactionId];
      return copy;
    });
  };

  const cancelDateChange = (transactionId: string) => {
    setPendingDateChanges((prev) => {
      const copy = { ...prev };
      delete copy[transactionId];
      return copy;
    });
  };

  const remove = (id: string) =>
    updateState((prev) => ({
      ...prev,
      transactions: prev.transactions.filter((t) => t.id !== id),
    }));

  return (
    <Panel
      title="Lançamentos"
      action={
        <button className="primary" onClick={add}>
          <Plus size={16} /> Adicionar
        </button>
      }
    >
      <div className="filters">
        <Select
          label="Tipo"
          value={type}
          onChange={setType}
          options={["Todos", "income", "expense"]}
        />
        <Select
          label="Categoria"
          value={category}
          onChange={setCategory}
          options={["Todos", ...categories]}
        />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Data</th>
              <th>Descrição</th>
              <th>Tipo</th>
              <th>Categoria</th>
              <th>Valor</th>
              <th>Pagamento</th>
              <th>Conta/cartão</th>
              <th>Pago</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <input
                    type="date"
                    required
                    value={pendingDateChanges[t.id] || t.date || todayISO()}
                    onChange={(e) => changeDate(t, e.target.value)}
                  />

                  {pendingDateChanges[t.id] && (
                    <div className="muted pending-date-box">
                      Mudança de mês pendente
                    </div>
                  )}
                </td>
                <td>
                  <input
                    value={t.description}
                    onChange={(e) =>
                      patch(t.id, { description: e.target.value })
                    }
                  />
                </td>
                <td>
                  <select
                    className={`type-select ${t.type === "income" ? "income" : "expense"}`}
                    value={t.type}
                    onChange={(e) =>
                      patch(t.id, {
                        type: e.target.value as Transaction["type"],
                      })
                    }
                  >
                    <option value="expense">Despesa</option>
                    <option value="income">Receita</option>
                  </select>
                </td>
                <td>
                  <select
                    value={t.category}
                    onChange={(e) => patch(t.id, { category: e.target.value })}
                  >
                    {getTransactionCategoryOptions(t).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <td>
                    <MoneyInput
                      className={`money-input ${
                        t.type === "income" ? "money-positive" : "money-negative"
                      }`}
                      value={t.amount}
                      onChange={(value) => patch(t.id, { amount: value })}
                    />
                  </td>
                </td>
                <td>
                  <select
                    value={t.paymentMethod}
                    onChange={(e) =>
                      patch(t.id, { paymentMethod: e.target.value })
                    }
                  >
                    {state.settings.paymentMethods.map((p) => (
                      <option key={p}>{p}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    value={t.accountOrCard}
                    onChange={(e) =>
                      patch(t.id, { accountOrCard: e.target.value })
                    }
                  >
                    {[...state.settings.accounts, ...state.settings.cards].map(
                      (a) => (
                        <option key={a}>{a}</option>
                      ),
                    )}
                  </select>
                </td>
                <td>
                  <input
                    type="checkbox"
                    checked={t.paid}
                    onChange={(e) => patch(t.id, { paid: e.target.checked })}
                  />
                </td>
                <td>
                  {pendingDateChanges[t.id] && (
                    <div className="inline-button-group">
                      <button
                        className="secondary small"
                        onClick={() => confirmDateChange(t.id)}
                      >
                        Confirmar
                      </button>

                      <button
                        className="secondary small"
                        onClick={() => cancelDateChange(t.id)}
                      >
                        Cancelar
                      </button>
                    </div>
                  )}

                  <button
                    type="button"
                    className="icon danger"
                    aria-label={`Excluir lançamento ${t.description}`}
                    title="Excluir lançamento"
                    onClick={() => remove(t.id)}
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

