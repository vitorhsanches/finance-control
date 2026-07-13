import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { Investment } from "../types";
import { money, uid } from "../lib/utils";
import { MetricCard, MoneyInput, Panel } from "../components/ui";
import type { PageProps } from "./types";

export function InvestmentsPage({ state, updateState }: PageProps) {
  const getCurrentAmount = (investment: Investment) => {
    if (investment.initialAmount > 0 && investment.currentAmount === 0) {
      return investment.initialAmount;
    }

    return investment.currentAmount || 0;
  };

  const getReturnAmount = (investment: Investment) =>
    getCurrentAmount(investment) - (investment.initialAmount || 0);

  const getReturnPercent = (investment: Investment) => {
    if (!investment.initialAmount || investment.initialAmount <= 0) return 0;

    return (getReturnAmount(investment) / investment.initialAmount) * 100;
  };

  const formatPercent = (value: number) =>
    `${value >= 0 ? "+" : ""}${value.toFixed(2).replace(".", ",")}%`;

  const getReturnTone = (value: number) => {
    if (value > 0) return "good";
    if (value < 0) return "bad";
    return "neutral";
  };

  const totalInitialAmount = state.investments.reduce(
    (sum, investment) => sum + (investment.initialAmount || 0),
    0
  );

  const totalCurrentAmount = state.investments.reduce(
    (sum, investment) => sum + getCurrentAmount(investment),
    0
  );

  const totalReturnAmount = totalCurrentAmount - totalInitialAmount;

  const totalReturnPercent =
    totalInitialAmount > 0
      ? (totalReturnAmount / totalInitialAmount) * 100
      : 0;

  const buildInvestmentGroup = (key: "institution" | "type") => {
    const grouped = new Map<
      string,
      {
        name: string;
        initialAmount: number;
        currentAmount: number;
        count: number;
      }
    >();

    state.investments.forEach((investment) => {
      const name = investment[key]?.trim() || "Não informado";
      const current = getCurrentAmount(investment);
      const initial = investment.initialAmount || 0;

      const existing = grouped.get(name) || {
        name,
        initialAmount: 0,
        currentAmount: 0,
        count: 0,
      };

      grouped.set(name, {
        ...existing,
        initialAmount: existing.initialAmount + initial,
        currentAmount: existing.currentAmount + current,
        count: existing.count + 1,
      });
    });

    return Array.from(grouped.values())
      .map((item) => {
        const returnAmount = item.currentAmount - item.initialAmount;
        const returnPercent =
          item.initialAmount > 0
            ? (returnAmount / item.initialAmount) * 100
            : 0;

        return {
          ...item,
          returnAmount,
          returnPercent,
        };
      })
      .sort((a, b) => b.currentAmount - a.currentAmount);
  };

  const investmentsByInstitution = buildInvestmentGroup("institution");
  const investmentsByType = buildInvestmentGroup("type");

  const topInvestments = [...state.investments]
    .sort((a, b) => getCurrentAmount(b) - getCurrentAmount(a))
    .slice(0, 5);

    const [investmentSearch, setInvestmentSearch] = useState("");
  const [investmentInstitutionFilter, setInvestmentInstitutionFilter] =
    useState("Todas");
  const [investmentTypeFilter, setInvestmentTypeFilter] = useState("Todos");
  const [investmentSort, setInvestmentSort] = useState<
    | "current-desc"
    | "return-desc"
    | "return-percent-desc"
    | "institution-asc"
    | "type-asc"
  >("current-desc");

  const getInvestmentLabel = (value: string) =>
    value.trim() || "Não informado";

  const investmentInstitutions = Array.from(
    new Set(
      state.investments.map((investment) =>
        getInvestmentLabel(investment.institution || "")
      )
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const investmentTypes = Array.from(
    new Set(
      state.investments.map((investment) =>
        getInvestmentLabel(investment.type || "")
      )
    )
  ).sort((a, b) => a.localeCompare(b, "pt-BR"));

  const displayedInvestments = [...state.investments]
    .filter((investment) => {
      const query = investmentSearch.trim().toLowerCase();

      if (!query) return true;

      const searchableText = [
        investment.type,
        investment.institution,
        investment.goal,
        investment.liquidity,
      ]
        .join(" ")
        .toLowerCase();

      return searchableText.includes(query);
    })
    .filter((investment) => {
      if (investmentInstitutionFilter === "Todas") return true;

      return (
        getInvestmentLabel(investment.institution || "") ===
        investmentInstitutionFilter
      );
    })
    .filter((investment) => {
      if (investmentTypeFilter === "Todos") return true;

      return getInvestmentLabel(investment.type || "") === investmentTypeFilter;
    })
    .sort((a, b) => {
      if (investmentSort === "return-desc") {
        return getReturnAmount(b) - getReturnAmount(a);
      }

      if (investmentSort === "return-percent-desc") {
        return getReturnPercent(b) - getReturnPercent(a);
      }

      if (investmentSort === "institution-asc") {
        return getInvestmentLabel(a.institution || "").localeCompare(
          getInvestmentLabel(b.institution || ""),
          "pt-BR"
        );
      }

      if (investmentSort === "type-asc") {
        return getInvestmentLabel(a.type || "").localeCompare(
          getInvestmentLabel(b.type || ""),
          "pt-BR"
        );
      }

      return getCurrentAmount(b) - getCurrentAmount(a);
    });

  const clearInvestmentFilters = () => {
    setInvestmentSearch("");
    setInvestmentInstitutionFilter("Todas");
    setInvestmentTypeFilter("Todos");
    setInvestmentSort("current-desc");
  };

  const add = () =>
    updateState((prev) => ({
      ...prev,
      investments: [
        {
          id: uid("iv"),
          type: "Renda fixa",
          institution: "",
          initialAmount: 0,
          currentAmount: 0,
          liquidity: "",
          goal: "",
        },
        ...prev.investments,
      ],
    }));

  const patch = (id: string, patch: Partial<Investment>) =>
    updateState((prev) => ({
      ...prev,
      investments: prev.investments.map((i) =>
        i.id === id ? { ...i, ...patch } : i,
      ),
    }));

  const remove = (id: string) =>
    updateState((prev) => ({
      ...prev,
      investments: prev.investments.filter((i) => i.id !== id),
    }));

  return (
    <div className="page-stack">
      <section className="cards-grid">
        <MetricCard
          label="Total aplicado"
          value={money(totalInitialAmount, state)}
          tone="neutral"
        />

        <MetricCard
          label="Valor atual"
          value={money(totalCurrentAmount, state)}
          tone="good"
        />

        <MetricCard
          label="Rendimento total"
          value={`${totalReturnAmount >= 0 ? "+" : ""}${money(
            totalReturnAmount,
            state
          )}`}
          tone={getReturnTone(totalReturnAmount)}
        />

        <MetricCard
          label="Rentabilidade total"
          value={formatPercent(totalReturnPercent)}
          tone={getReturnTone(totalReturnAmount)}
        />

        <MetricCard
          label="Investimentos"
          value={String(state.investments.length)}
          tone="neutral"
        />
      </section>
      
      <section className="grid-2">
        <Panel title="Por instituição">
          {investmentsByInstitution.length === 0 ? (
            <div className="empty">Nenhum investimento cadastrado.</div>
          ) : (
            <div className="investment-summary-list">
              {investmentsByInstitution.map((item) => {
                const returnClass =
                  item.returnAmount > 0
                    ? "return-positive"
                    : item.returnAmount < 0
                      ? "return-negative"
                      : "return-neutral";

                return (
                  <div className="investment-summary-item" key={item.name}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.count} investimento(s)</span>
                    </div>

                    <div className="investment-summary-values">
                      <strong>{money(item.currentAmount, state)}</strong>
                      <span className={returnClass}>
                        {item.returnAmount >= 0 ? "+" : ""}
                        {money(item.returnAmount, state)} ·{" "}
                        {formatPercent(item.returnPercent)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>

        <Panel title="Por tipo">
          {investmentsByType.length === 0 ? (
            <div className="empty">Nenhum investimento cadastrado.</div>
          ) : (
            <div className="investment-summary-list">
              {investmentsByType.map((item) => {
                const returnClass =
                  item.returnAmount > 0
                    ? "return-positive"
                    : item.returnAmount < 0
                      ? "return-negative"
                      : "return-neutral";

                return (
                  <div className="investment-summary-item" key={item.name}>
                    <div>
                      <strong>{item.name}</strong>
                      <span>{item.count} investimento(s)</span>
                    </div>

                    <div className="investment-summary-values">
                      <strong>{money(item.currentAmount, state)}</strong>
                      <span className={returnClass}>
                        {item.returnAmount >= 0 ? "+" : ""}
                        {money(item.returnAmount, state)} ·{" "}
                        {formatPercent(item.returnPercent)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </section>

      <Panel title="Maiores posições">
        {topInvestments.length === 0 ? (
          <div className="empty">Nenhum investimento cadastrado.</div>
        ) : (
          <div className="investment-summary-list compact">
            {topInvestments.map((investment) => {
              const currentAmount = getCurrentAmount(investment);
              const returnAmount = getReturnAmount(investment);
              const returnPercent = getReturnPercent(investment);
              const returnClass =
                returnAmount > 0
                  ? "return-positive"
                  : returnAmount < 0
                    ? "return-negative"
                    : "return-neutral";

              return (
                <div className="investment-summary-item" key={investment.id}>
                  <div>
                    <strong>
                      {investment.type || "Tipo não informado"}
                    </strong>
                    <span>
                      {investment.institution || "Instituição não informada"}
                    </span>
                  </div>

                  <div className="investment-summary-values">
                    <strong>{money(currentAmount, state)}</strong>
                    <span className={returnClass}>
                      {returnAmount >= 0 ? "+" : ""}
                      {money(returnAmount, state)} ·{" "}
                      {formatPercent(returnPercent)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Panel>

      <Panel
        title="Investimentos"
        action={
          <button className="primary" onClick={add}>
            <Plus size={16} /> Adicionar
          </button>
        }
      >
        <div className="investment-controls">
          <label className="field compact investment-search-field">
            <span>Buscar</span>
            <input
              placeholder="Tipo, instituição, objetivo..."
              value={investmentSearch}
              onChange={(e) => setInvestmentSearch(e.target.value)}
            />
          </label>

          <label className="field compact">
            <span>Instituição</span>
            <select
              value={investmentInstitutionFilter}
              onChange={(e) => setInvestmentInstitutionFilter(e.target.value)}
            >
              <option value="Todas">Todas</option>
              {investmentInstitutions.map((institution) => (
                <option key={institution} value={institution}>
                  {institution}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact">
            <span>Tipo</span>
            <select
              value={investmentTypeFilter}
              onChange={(e) => setInvestmentTypeFilter(e.target.value)}
            >
              <option value="Todos">Todos</option>
              {investmentTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>

          <label className="field compact">
            <span>Ordenar por</span>
            <select
              value={investmentSort}
              onChange={(e) =>
                setInvestmentSort(
                  e.target.value as
                    | "current-desc"
                    | "return-desc"
                    | "return-percent-desc"
                    | "institution-asc"
                    | "type-asc"
                )
              }
            >
              <option value="current-desc">Maior valor atual</option>
              <option value="return-desc">Maior rendimento R$</option>
              <option value="return-percent-desc">Maior rendimento %</option>
              <option value="institution-asc">Instituição A-Z</option>
              <option value="type-asc">Tipo A-Z</option>
            </select>
          </label>

          <div className="investment-filter-actions">
            <span>
              {displayedInvestments.length} de {state.investments.length} item(ns)
            </span>

            <button
              className="secondary small"
              type="button"
              onClick={clearInvestmentFilters}
            >
              Limpar filtros
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table></table>

          <table>
            <thead>
              <tr>
                <th>Tipo</th>
                <th>Instituição</th>
                <th>Aplicado</th>
                <th>Atual</th>
                <th>Rendimento R$</th>
                <th>Rendimento %</th>
                <th>Liquidez</th>
                <th>Objetivo</th>
                <th></th>
              </tr>
            </thead>

            <tbody>
              {displayedInvestments.map((i) => {
                const currentAmount = getCurrentAmount(i);
                const returnAmount = getReturnAmount(i);
                const returnPercent = getReturnPercent(i);
                const returnClass =
                  returnAmount > 0
                    ? "return-positive"
                    : returnAmount < 0
                      ? "return-negative"
                      : "return-neutral";

                return (
                  <tr key={i.id}>
                    <td>
                      <input
                        value={i.type}
                        onChange={(e) => patch(i.id, { type: e.target.value })}
                      />
                    </td>

                    <td>
                      <input
                        value={i.institution}
                        onChange={(e) =>
                          patch(i.id, { institution: e.target.value })
                        }
                      />
                    </td>

                    <td>
                      <MoneyInput
                        className="money-input"
                        value={i.initialAmount}
                        onChange={(nextInitial) => {
                          patch(i.id, {
                            initialAmount: nextInitial,
                            currentAmount:
                              i.currentAmount === 0 ||
                              i.currentAmount === i.initialAmount
                                ? nextInitial
                                : i.currentAmount,
                          });
                        }}
                      />
                    </td>

                    <td>
                      <MoneyInput
                        className="money-input"
                        value={currentAmount}
                        onChange={(value) =>
                          patch(i.id, { currentAmount: value })
                        }
                      />
                    </td>

                    <td className={returnClass}>
                      {returnAmount >= 0 ? "+" : ""}
                      {money(returnAmount, state)}
                    </td>

                    <td>
                      <span className={`return-badge ${returnClass}`}>
                        {formatPercent(returnPercent)}
                      </span>
                    </td>

                    <td>
                      <input
                        value={i.liquidity}
                        onChange={(e) =>
                          patch(i.id, { liquidity: e.target.value })
                        }
                      />
                    </td>

                    <td>
                      <input
                        value={i.goal}
                        onChange={(e) => patch(i.id, { goal: e.target.value })}
                      />
                    </td>

                    <td>
                      <button
                        type="button"
                        className="icon danger"
                        aria-label={`Excluir investimento ${i.type}`}
                        title="Excluir investimento"
                        onClick={() => remove(i.id)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                );
              })}

              {displayedInvestments.length === 0 && (
                <tr>
                  <td colSpan={9}>
                    <div className="empty">
                      {state.investments.length === 0
                        ? "Nenhum investimento cadastrado ainda."
                        : "Nenhum investimento encontrado com os filtros atuais."}
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

