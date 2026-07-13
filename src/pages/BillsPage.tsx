import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { FutureBill } from "../types";
import { addMonths, formatDate, money, toNumber, todayISO, uid, ym } from "../lib/utils";
import { MetricCard, MoneyInput, Panel } from "../components/ui";
import type { PageProps } from "./types";

export function BillsPage({
  state,
  updateState,
  month,
}: PageProps & { month: string }) {
  type BillStatus = "pending" | "today" | "overdue" | "paid";

  const [billSearch, setBillSearch] = useState("");
  const [billStatusFilter, setBillStatusFilter] = useState<"Todos" | BillStatus>(
    "Todos"
  );
  const [billCategoryFilter, setBillCategoryFilter] = useState("Todas");

  const today = todayISO();
  const monthStart = `${month}-01`;

  const getBillStatus = (bill: FutureBill): BillStatus => {
    if (bill.paid) return "paid";
    if ((bill.dueDate || today) < today) return "overdue";
    if ((bill.dueDate || today) === today) return "today";
    return "pending";
  };

  const getBillStatusLabel = (status: BillStatus) => {
    if (status === "paid") return "Paga";
    if (status === "today") return "Vence hoje";
    if (status === "overdue") return "Vencida";
    return "Pendente";
  };

  const getBillStatusTone = (status: BillStatus) => {
    if (status === "paid") return "good";
    if (status === "today") return "warn";
    if (status === "overdue") return "bad";
    return "neutral";
  };

  const monthRows = state.bills
    .filter((bill) => {
      const dueDate = bill.dueDate || today;

      const isFromSelectedMonth = ym(dueDate) === month;
      const isPreviousOverdue = !bill.paid && dueDate < monthStart;

      return isFromSelectedMonth || isPreviousOverdue;
    })
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""));

  const billCategoryOptions = Array.from(
    new Set(
      [
        ...state.settings.categories,
        ...state.bills.map((bill) => bill.category),
      ]
        .map((category) => category?.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const displayedBills = monthRows
    .filter((bill) => {
      const query = billSearch.trim().toLowerCase();

      if (!query) return true;

      const searchableText = [
        bill.description,
        bill.category,
        bill.frequency,
        bill.priority,
        bill.notes,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    })
    .filter((bill) => {
      if (billStatusFilter === "Todos") return true;

      return getBillStatus(bill) === billStatusFilter;
    })
    .filter((bill) => {
      if (billCategoryFilter === "Todas") return true;

      return bill.category === billCategoryFilter;
    });

  const totalPredicted = monthRows.reduce(
    (sum, bill) => sum + (bill.amount || 0),
    0
  );

  const totalPending = monthRows
    .filter((bill) => !bill.paid)
    .reduce((sum, bill) => sum + (bill.amount || 0), 0);

  const totalOverdue = monthRows
    .filter((bill) => getBillStatus(bill) === "overdue")
    .reduce((sum, bill) => sum + (bill.amount || 0), 0);

  const totalPaid = monthRows
    .filter((bill) => bill.paid)
    .reduce((sum, bill) => sum + (bill.amount || 0), 0);

  const nextBill = [...state.bills]
    .filter((bill) => !bill.paid && (bill.dueDate || today) >= today)
    .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))[0];

  const clearBillFilters = () => {
    setBillSearch("");
    setBillStatusFilter("Todos");
    setBillCategoryFilter("Todas");
  };

  const add = () =>
    updateState((prev) => ({
      ...prev,
      bills: [
        {
          id: uid("bill"),
          dueDate: todayISO(),
          description: "Nova conta",
          category: "Casa",
          amount: 0,
          recurring: true,
          frequency: "Mensal",
          priority: "Média",
          paid: false,
        },
        ...prev.bills,
      ],
    }));

  const patch = (id: string, patch: Partial<FutureBill>) =>
    updateState((prev) => ({
      ...prev,
      bills: prev.bills.map((b) =>
        b.id === id ? { ...b, ...patch } : b
      ),
    }));

  const remove = (id: string) =>
    updateState((prev) => ({
      ...prev,
      bills: prev.bills.filter((b) => b.id !== id),
    }));

  const getNextBillDueDate = (bill: FutureBill) => {
    const dueDate = bill.dueDate || todayISO();

    if (!bill.recurring || bill.frequency === "Única") {
      return dueDate;
    }

    if (bill.frequency === "Mensal") {
      return addMonths(ym(dueDate), 1) + dueDate.slice(7);
    }

    if (bill.frequency === "Anual") {
      const date = new Date(`${dueDate}T00:00:00`);
      date.setFullYear(date.getFullYear() + 1);
      return date.toISOString().slice(0, 10);
    }

    return dueDate;
  };

  const markPaid = (bill: FutureBill) => {
    if (bill.paid) return;

    const isRecurringBill = bill.recurring && bill.frequency !== "Única";
    const nextDueDate = getNextBillDueDate(bill);

    updateState((prev) => {
      const nextRecurringBillExists = prev.bills.some(
        (item) =>
          item.id !== bill.id &&
          item.recurring &&
          !item.paid &&
          item.description === bill.description &&
          item.category === bill.category &&
          toNumber(item.amount) === toNumber(bill.amount) &&
          item.frequency === bill.frequency &&
          item.dueDate === nextDueDate
      );

      return {
        ...prev,
        bills: [
          ...prev.bills.map((item) =>
            item.id === bill.id
              ? {
                  ...item,
                  paid: true,
                }
              : item
          ),

          ...(isRecurringBill && !nextRecurringBillExists
            ? [
                {
                  ...bill,
                  id: uid("bill"),
                  dueDate: nextDueDate,
                  paid: false,
                },
              ]
            : []),
        ],
        transactions: [
          {
            id: uid("tr"),
            date: bill.dueDate || todayISO(),
            description: bill.description,
            type: "expense",
            category: bill.category,
            amount: bill.amount,
            paymentMethod: "Boleto",
            accountOrCard: prev.settings.accounts[0] || "Conta",
            essential: true,
            paid: true,
            source: `future-bill:${bill.id}`,
          },
          ...prev.transactions,
        ],
      };
    });
  };

  const unmarkPaid = (bill: FutureBill) => {
    updateState((prev) => {
      const nextRecurringBill = prev.bills
        .filter(
          (item) =>
            item.id !== bill.id &&
            item.recurring &&
            !item.paid &&
            item.description === bill.description &&
            item.category === bill.category &&
            toNumber(item.amount) === toNumber(bill.amount) &&
            item.frequency === bill.frequency &&
            (item.dueDate || "") > (bill.dueDate || "")
        )
        .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || ""))[0];

      const shouldRemoveNextRecurringBill =
        bill.recurring &&
        bill.frequency !== "Única" &&
        Boolean(nextRecurringBill);

      return {
        ...prev,
        bills: prev.bills
          .filter((item) =>
            shouldRemoveNextRecurringBill
              ? item.id !== nextRecurringBill.id
              : true
          )
          .map((item) =>
            item.id === bill.id
              ? {
                  ...item,
                  paid: false,
                }
              : item
          ),
        transactions: prev.transactions.filter((transaction) => {
          const linkedFutureBill =
            transaction.source === `future-bill:${bill.id}`;

          const generatedFutureBillByData =
            (transaction.source || "").startsWith("future-bill") &&
            transaction.type === "expense" &&
            transaction.date === (bill.dueDate || todayISO()) &&
            transaction.description === bill.description &&
            transaction.category === bill.category &&
            toNumber(transaction.amount) === toNumber(bill.amount);

          return !(linkedFutureBill || generatedFutureBillByData);
        }),
      };
    });
  };

  return (
    <div className="page-stack">
      <section className="cards-grid">
        <MetricCard
          label="Total previsto"
          value={money(totalPredicted, state)}
          tone="neutral"
        />

        <MetricCard
          label="Pendente"
          value={money(totalPending, state)}
          tone={totalPending > 0 ? "warn" : "good"}
        />

        <MetricCard
          label="Vencido"
          value={money(totalOverdue, state)}
          tone={totalOverdue > 0 ? "bad" : "good"}
        />

        <MetricCard
          label="Pago"
          value={money(totalPaid, state)}
          tone="good"
        />

        <MetricCard
          label="Próximo vencimento"
          value={
            nextBill
              ? `${nextBill.description || "Conta"} · ${formatDate(
                  nextBill.dueDate || todayISO()
                )}`
              : "Nenhum"
          }
          tone={nextBill ? getBillStatusTone(getBillStatus(nextBill)) : "good"}
        />
      </section>

      <Panel
        title="Contas futuras"
        action={
          <button className="primary" onClick={add}>
            <Plus size={16} /> Adicionar
          </button>
        }
      >
        <div className="bill-controls">
          <label className="field compact bill-search-field">
            <span>Buscar</span>
            <input
              placeholder="Descrição, categoria, prioridade..."
              value={billSearch}
              onChange={(e) => setBillSearch(e.target.value)}
            />
          </label>

          <label className="field compact">
            <span>Status</span>
            <select
              value={billStatusFilter}
              onChange={(e) =>
                setBillStatusFilter(e.target.value as "Todos" | BillStatus)
              }
            >
              <option value="Todos">Todos</option>
              <option value="pending">Pendente</option>
              <option value="today">Vence hoje</option>
              <option value="overdue">Vencida</option>
              <option value="paid">Paga</option>
            </select>
          </label>

          <label className="field compact">
            <span>Categoria</span>
            <select
              value={billCategoryFilter}
              onChange={(e) => setBillCategoryFilter(e.target.value)}
            >
              <option value="Todas">Todas</option>
              {billCategoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <div className="bill-filter-actions">
            <span>
              {displayedBills.length} de {monthRows.length} conta(s)
            </span>

            <button
              className="secondary small"
              type="button"
              onClick={clearBillFilters}
            >
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Status</th>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>Categoria</th>
                <th>Valor</th>
                <th>Recorrente</th>
                <th>Frequência</th>
                <th>Prioridade</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {displayedBills.map((bill) => {
                const status = getBillStatus(bill);
                const statusClass = `bill-status-${status}`;

                return (
                  <tr className={`bill-row ${statusClass}`} key={bill.id}>
                    <td>
                      <span className={`bill-status-badge ${statusClass}`}>
                        {getBillStatusLabel(status)}
                      </span>
                    </td>

                    <td>
                      <input
                        type="date"
                        value={bill.dueDate || todayISO()}
                        onChange={(e) => {
                          const nextDate = e.target.value;
                          if (!nextDate) return;

                          patch(bill.id, { dueDate: nextDate });
                        }}
                      />
                    </td>

                    <td>
                      <input
                        value={bill.description}
                        onChange={(e) =>
                          patch(bill.id, { description: e.target.value })
                        }
                      />
                    </td>

                    <td>
                      <select
                        value={bill.category}
                        onChange={(e) =>
                          patch(bill.id, { category: e.target.value })
                        }
                      >
                        {billCategoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <MoneyInput
                        className="money-input"
                        value={bill.amount}
                        onChange={(value) =>
                          patch(bill.id, { amount: value })
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="checkbox"
                        checked={bill.recurring}
                        onChange={(e) =>
                          patch(bill.id, { recurring: e.target.checked })
                        }
                      />
                    </td>

                    <td>
                      <select
                        value={bill.frequency}
                        onChange={(e) =>
                          patch(bill.id, {
                            frequency: e.target
                              .value as FutureBill["frequency"],
                          })
                        }
                      >
                        <option value="Mensal">Mensal</option>
                        <option value="Anual">Anual</option>
                        <option value="Única">Única</option>
                      </select>
                    </td>

                    <td>
                      <select
                        value={bill.priority}
                        onChange={(e) =>
                          patch(bill.id, {
                            priority: e.target
                              .value as FutureBill["priority"],
                          })
                        }
                      >
                        <option value="Baixa">Baixa</option>
                        <option value="Média">Média</option>
                        <option value="Alta">Alta</option>
                      </select>
                    </td>

                    <td className="actions">
                      {bill.paid ? (
                        <button
                          className="secondary small"
                          type="button"
                          onClick={() => unmarkPaid(bill)}
                        >
                          Desmarcar
                        </button>
                      ) : (
                        <button
                          className="secondary small"
                          type="button"
                          onClick={() => markPaid(bill)}
                        >
                          Pagar
                        </button>
                      )}

                      <button
                        type="button"
                        className="icon danger"
                        aria-label={`Excluir conta futura ${bill.description}`}
                        title="Excluir conta futura"
                        onClick={() => remove(bill.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {displayedBills.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty">
                      {monthRows.length === 0
                        ? "Nenhuma conta futura cadastrada para este mês."
                        : "Nenhuma conta encontrada com os filtros atuais."}
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

