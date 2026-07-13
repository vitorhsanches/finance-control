import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Installment } from "../types";
import {
  getFirstPaymentMonth, getInstallmentAmount, getInstallmentsForMonth,
} from "../lib/calculations";
import { formatDate, money, toNumber, todayISO, uid } from "../lib/utils";
import { Empty, MetricCard, MoneyInput, Panel } from "../components/ui";
import type { PageProps } from "./types";

export function InstallmentsPage({
  state,
  updateState,
  month,
}: PageProps & { month: string }) {
  const [installmentSearch, setInstallmentSearch] = useState("");
  const [installmentCardFilter, setInstallmentCardFilter] = useState("Todos");
  const [installmentCategoryFilter, setInstallmentCategoryFilter] =
    useState("Todas");
  const [installmentSort, setInstallmentSort] = useState<
    "purchase-desc" | "total-desc" | "remaining-desc" | "card-asc" | "description-asc"
  >("purchase-desc");

  const rows = state.installments;
  const projection = getInstallmentsForMonth(state, month);

  const cardOptions = Array.from(
    new Set(
      [...state.settings.cards, ...rows.map((item) => item.cardName)]
        .map((card) => card?.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const categoryOptions = Array.from(
    new Set(
      [...state.settings.categories, ...rows.map((item) => item.category)]
        .map((category) => category?.trim())
        .filter(Boolean)
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const getInstallmentTotals = (item: Installment) => {
    const totalInstallments = Math.max(1, Math.floor(toNumber(item.installments)));
    const paidInstallments = Math.min(
      totalInstallments,
      Math.max(0, Math.floor(toNumber(item.paidInstallments)))
    );
    const remainingInstallments = Math.max(0, totalInstallments - paidInstallments);
    const installmentAmount = getInstallmentAmount(item);
    const remainingAmount = remainingInstallments * installmentAmount;

    return {
      totalInstallments,
      paidInstallments,
      remainingInstallments,
      installmentAmount,
      remainingAmount,
    };
  };

  const monthInstallmentsTotal = projection.reduce(
    (sum, row) => sum + row.amount,
    0
  );

  const openInstallmentsTotal = rows.reduce((sum, item) => {
    const totals = getInstallmentTotals(item);
    return sum + totals.remainingAmount;
  }, 0);

  const installmentsByCard = Array.from(
    projection.reduce((map, row) => {
      const cardName = row.item.cardName || "Cartão não informado";
      const current = map.get(cardName) || {
        name: cardName,
        amount: 0,
        count: 0,
      };

      map.set(cardName, {
        ...current,
        amount: current.amount + row.amount,
        count: current.count + 1,
      });

      return map;
    }, new Map<string, { name: string; amount: number; count: number }>())
  )
    .map(([, value]) => value)
    .sort((a, b) => b.amount - a.amount);

  const biggestCard = installmentsByCard[0];

  const topMonthInstallments = [...projection]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5);

  const matchesInstallmentFilters = (item: Installment) => {
    const query = installmentSearch.trim().toLowerCase();

    if (query) {
      const searchableText = [
        item.description,
        item.cardName,
        item.category,
        item.notes,
      ]
        .join(" ")
        .toLowerCase();

      if (!searchableText.includes(query)) return false;
    }

    if (
      installmentCardFilter !== "Todos" &&
      item.cardName !== installmentCardFilter
    ) {
      return false;
    }

    if (
      installmentCategoryFilter !== "Todas" &&
      item.category !== installmentCategoryFilter
    ) {
      return false;
    }

    return true;
  };

  const displayedRows = [...rows]
    .filter(matchesInstallmentFilters)
    .sort((a, b) => {
      if (installmentSort === "total-desc") {
        return toNumber(b.totalAmount) - toNumber(a.totalAmount);
      }

      if (installmentSort === "remaining-desc") {
        return (
          getInstallmentTotals(b).remainingAmount -
          getInstallmentTotals(a).remainingAmount
        );
      }

      if (installmentSort === "card-asc") {
        return (a.cardName || "").localeCompare(b.cardName || "", "pt-BR");
      }

      if (installmentSort === "description-asc") {
        return (a.description || "").localeCompare(
          b.description || "",
          "pt-BR"
        );
      }

      return (b.purchaseDate || "").localeCompare(a.purchaseDate || "");
    });

  const displayedProjection = projection.filter((row) =>
    matchesInstallmentFilters(row.item)
  );

  const clearInstallmentFilters = () => {
    setInstallmentSearch("");
    setInstallmentCardFilter("Todos");
    setInstallmentCategoryFilter("Todas");
    setInstallmentSort("purchase-desc");
  };

  const add = () =>
    updateState((prev) => ({
      ...prev,
      installments: [
        {
          id: uid("in"),
          purchaseDate: todayISO(),
          description: "Nova compra parcelada",
          cardName: prev.settings.cards[0] || "Cartão",
          category: "Compras",
          totalAmount: 0,
          installments: 1,
          firstInstallmentMonth: month,
          paidInstallments: 0,
        },
        ...prev.installments,
      ],
    }));

  const patch = (id: string, patch: Partial<Installment>) =>
    updateState((prev) => ({
      ...prev,
      installments: prev.installments.map((i) =>
        i.id === id ? { ...i, ...patch } : i
      ),
    }));

  const remove = (id: string) =>
    updateState((prev) => ({
      ...prev,
      installments: prev.installments.filter((i) => i.id !== id),
    }));

  return (
    <div className="page-stack">
      <section className="cards-grid">
        <MetricCard
          label="Fatura em parcelas"
          value={money(monthInstallmentsTotal, state)}
          tone={monthInstallmentsTotal > 0 ? "warn" : "good"}
        />

        <MetricCard
          label="Parcelas no mês"
          value={String(projection.length)}
          tone={projection.length > 0 ? "neutral" : "good"}
        />

        <MetricCard
          label="Maior cartão do mês"
          value={
            biggestCard
              ? `${biggestCard.name} · ${money(biggestCard.amount, state)}`
              : "Nenhum"
          }
          tone={biggestCard ? "warn" : "good"}
        />

        <MetricCard
          label="Total em aberto"
          value={money(openInstallmentsTotal, state)}
          tone={openInstallmentsTotal > 0 ? "warn" : "good"}
        />
      </section>

      <section className="grid-2">
        <Panel title="Fatura por cartão">
          {installmentsByCard.length === 0 ? (
            <Empty message="Nenhuma parcela prevista para este mês." />
          ) : (
            <div className="installment-summary-list">
              {installmentsByCard.map((card) => (
                <div className="installment-summary-item" key={card.name}>
                  <div>
                    <strong>{card.name}</strong>
                    <span>{card.count} parcela(s) no mês</span>
                  </div>

                  <strong className="installment-summary-value">
                    {money(card.amount, state)}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Maiores parcelas do mês">
          {topMonthInstallments.length === 0 ? (
            <Empty message="Nenhuma parcela prevista para este mês." />
          ) : (
            <div className="installment-summary-list">
              {topMonthInstallments.map((row) => (
                <div
                  className="installment-summary-item"
                  key={`${row.item.id}-${row.installmentNumber}`}
                >
                  <div>
                    <strong>{row.item.description}</strong>
                    <span>
                      {row.item.cardName} · parcela {row.installmentNumber}/
                      {row.item.installments}
                    </span>
                  </div>

                  <strong className="installment-summary-value">
                    {money(row.amount, state)}
                  </strong>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </section>

      <Panel
        title="Cartões e parcelas"
        action={
          <button className="primary" onClick={add}>
            <Plus size={16} /> Adicionar
          </button>
        }
      >
        <div className="installment-controls">
          <label className="field compact installment-search-field">
            <span>Buscar</span>
            <input
              placeholder="Descrição, cartão, categoria..."
              value={installmentSearch}
              onChange={(e) => setInstallmentSearch(e.target.value)}
            />
          </label>

          <label className="field compact">
            <span>Cartão</span>
            <select
              value={installmentCardFilter}
              onChange={(e) => setInstallmentCardFilter(e.target.value)}
            >
              <option value="Todos">Todos</option>
              {cardOptions.map((card) => (
                <option key={card} value={card}>
                  {card}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact">
            <span>Categoria</span>
            <select
              value={installmentCategoryFilter}
              onChange={(e) => setInstallmentCategoryFilter(e.target.value)}
            >
              <option value="Todas">Todas</option>
              {categoryOptions.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact">
            <span>Ordenar por</span>
            <select
              value={installmentSort}
              onChange={(e) =>
                setInstallmentSort(
                  e.target.value as
                    | "purchase-desc"
                    | "total-desc"
                    | "remaining-desc"
                    | "card-asc"
                    | "description-asc"
                )
              }
            >
              <option value="purchase-desc">Compra mais recente</option>
              <option value="total-desc">Maior valor total</option>
              <option value="remaining-desc">Maior saldo em aberto</option>
              <option value="card-asc">Cartão A-Z</option>
              <option value="description-asc">Descrição A-Z</option>
            </select>
          </label>

          <div className="installment-filter-actions">
            <span>
              {displayedRows.length} de {rows.length} compra(s)
            </span>

            <button
              className="secondary small"
              type="button"
              onClick={clearInstallmentFilters}
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
                <th>Compra</th>
                <th>Descrição</th>
                <th>Cartão</th>
                <th>Categoria</th>
                <th>Total</th>
                <th>Qtd</th>
                <th>Parcela</th>
                <th>1º mês</th>
                <th>Pagas</th>
                <th>Em aberto</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {displayedRows.map((i) => {
                const totals = getInstallmentTotals(i);
                const isPaidOff = totals.remainingInstallments === 0;

                return (
                  <tr key={i.id}>
                    <td>
                      <span
                        className={`installment-status-badge ${
                          isPaidOff
                            ? "installment-status-paid"
                            : "installment-status-open"
                        }`}
                      >
                        {isPaidOff ? "Quitado" : "Em aberto"}
                      </span>
                    </td>

                    <td>
                      <input
                        type="date"
                        value={i.purchaseDate || todayISO()}
                        onChange={(e) => {
                          const nextDate = e.target.value;
                          if (!nextDate) return;

                          patch(i.id, {
                            purchaseDate: nextDate,
                            firstInstallmentMonth: getFirstPaymentMonth(
                              state,
                              nextDate,
                              i.cardName
                            ),
                          });
                        }}
                      />
                    </td>

                    <td>
                      <input
                        value={i.description}
                        onChange={(e) =>
                          patch(i.id, { description: e.target.value })
                        }
                      />
                    </td>

                    <td>
                      <select
                        value={i.cardName}
                        onChange={(e) =>
                          patch(i.id, {
                            cardName: e.target.value,
                            firstInstallmentMonth: getFirstPaymentMonth(
                              state,
                              i.purchaseDate,
                              e.target.value
                            ),
                          })
                        }
                      >
                        {cardOptions.map((card) => (
                          <option key={card} value={card}>
                            {card}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <select
                        value={i.category}
                        onChange={(e) =>
                          patch(i.id, { category: e.target.value })
                        }
                      >
                        {categoryOptions.map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <MoneyInput
                        className="money-input"
                        value={i.totalAmount}
                        onChange={(value) =>
                          patch(i.id, { totalAmount: value })
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        min={1}
                        value={i.installments}
                        onChange={(e) => {
                          const nextInstallments = Math.max(
                            1,
                            Math.floor(toNumber(e.target.value))
                          );

                          patch(i.id, {
                            installments: nextInstallments,
                            paidInstallments: Math.min(
                              i.paidInstallments,
                              nextInstallments
                            ),
                          });
                        }}
                      />
                    </td>

                    <td>{money(totals.installmentAmount, state)}</td>

                    <td>
                      <input
                        type="month"
                        value={i.firstInstallmentMonth}
                        onChange={(e) =>
                          patch(i.id, { firstInstallmentMonth: e.target.value })
                        }
                      />
                    </td>

                    <td>
                      <input
                        type="number"
                        min={0}
                        max={totals.totalInstallments}
                        value={i.paidInstallments}
                        onChange={(e) => {
                          const nextPaid = Math.min(
                            totals.totalInstallments,
                            Math.max(0, Math.floor(toNumber(e.target.value)))
                          );

                          patch(i.id, {
                            paidInstallments: nextPaid,
                          });
                        }}
                      />
                    </td>

                    <td>{money(totals.remainingAmount, state)}</td>

                    <td>
                      <button
                        type="button"
                        className="icon danger"
                        aria-label={`Excluir parcelamento ${i.description}`}
                        title="Excluir parcelamento"
                        onClick={() => remove(i.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {displayedRows.length === 0 && (
                <tr>
                  <td colSpan={12}>
                    <Empty
                      message={
                        rows.length === 0
                          ? "Nenhuma compra parcelada cadastrada."
                          : "Nenhuma compra encontrada com os filtros atuais."
                      }
                    />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel title={`Parcelas previstas em ${month}`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>Cartão</th>
                <th>Categoria</th>
                <th>Parcela</th>
                <th>Valor</th>
              </tr>
            </thead>

            <tbody>
              {displayedProjection.map((p) => (
                <tr key={`${p.item.id}-${p.installmentNumber}`}>
                  <td>{formatDate(p.dueDate)}</td>
                  <td>{p.item.description}</td>
                  <td>{p.item.cardName}</td>
                  <td>{p.item.category}</td>
                  <td>
                    {p.installmentNumber}/{p.item.installments}
                  </td>
                  <td>{money(p.amount, state)}</td>
                </tr>
              ))}

              {displayedProjection.length === 0 && (
                <tr>
                  <td colSpan={6}>
                    <Empty message="Nenhuma parcela prevista com os filtros atuais." />
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
