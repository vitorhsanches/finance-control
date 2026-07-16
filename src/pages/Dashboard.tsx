import { useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { FinanceState } from "../types";
import {
  budgetRows, expensesByCategory, getInstallmentsForMonth, getMetrics, upcomingBills,
} from "../lib/calculations";
import {
  getFinancialInsights,
  type FinancialInsightFact,
} from "../lib/financialInsights";
import { addMonths, formatDate, money, toNumber, ym } from "../lib/utils";
import { Empty, Panel, StatusBadge } from "../components/ui";

const COLORS = [
  "#2563eb", "#16a34a", "#f59e0b", "#ef4444",
  "#8b5cf6", "#06b6d4", "#64748b", "#ec4899",
];

export function Dashboard({
  state,
  month,
  displayName,
  email,
}: {
  state: FinanceState;
  month: string;
  displayName: string;
  email: string | null;
}) {
  const [showInsights, setShowInsights] = useState(false);
  const [showDashboardDetails, setShowDashboardDetails] = useState(false);
  const {
    metrics,
    categoryData,
    budgetData,
    upcoming,
    evolution,
    insights,
    monthExpenseItems,
    monthFutureBillItems,
    monthInstallmentItems,
  } = useMemo(() => {
    const evolutionRows = Array.from({ length: 6 }, (_, i) => {
      const evolutionMonth = addMonths(month, i - 5);
      const evolutionMetrics = getMetrics(state, evolutionMonth);
      return {
        month: evolutionMonth.slice(5),
        receitas: evolutionMetrics.monthIncome,
        despesas: evolutionMetrics.monthExpenses,
      };
    });

    return {
      metrics: getMetrics(state, month),
      categoryData: expensesByCategory(state, month).slice(0, 8),
      budgetData: budgetRows(state, month),
      upcoming: upcomingBills(state, 7),
      evolution: evolutionRows,
      insights: getFinancialInsights(state, month),
      monthExpenseItems: state.transactions
        .filter(
          (transaction) =>
            transaction.type === "expense" && ym(transaction.date) === month,
        )
        .sort((a, b) => toNumber(b.amount) - toNumber(a.amount)),
      monthFutureBillItems: state.bills
        .filter((bill) => ym(bill.dueDate) === month && !bill.paid)
        .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || "")),
      monthInstallmentItems: getInstallmentsForMonth(state, month).sort(
        (a, b) => a.dueDate.localeCompare(b.dueDate),
      ),
    };
  }, [state, month]);

  const welcomeName = displayName.trim() || email?.split("@")[0] || "bem-vindo";

  return (
    <div className="page-stack">
      <div className="mobile-hidden">
        <Panel title={`Olá, ${welcomeName} 👋`}>
          <p className="muted">
            Acompanhe seu mês, seus gastos, contas futuras e investimentos em um só lugar.
          </p>
        </Panel>
      </div>
      <section className="dashboard-hero" aria-labelledby="dashboard-month-summary">
        <div className="dashboard-hero-primary">
          <span className="dashboard-eyebrow" id="dashboard-month-summary">Disponível no mês</span>
          <strong className={metrics.safeToSpend >= 0 ? "amount-positive" : "amount-negative"}>
            {money(metrics.safeToSpend, state)}
          </strong>
          <span className={`dashboard-hero-status ${metrics.safeToSpend >= 0 ? "good" : "bad"}`}>
            {metrics.safeToSpend >= 0 ? "Dentro do planejado" : "Requer atenção"}
          </span>
        </div>
        <dl className="dashboard-hero-breakdown">
          <div>
            <dt>Receitas</dt>
            <dd className="amount-positive">{money(metrics.monthIncome, state)}</dd>
          </div>
          <div>
            <dt>Gastos</dt>
            <dd className={metrics.monthExpenses > 0 ? "amount-negative" : "amount-neutral"}>{money(metrics.monthExpenses, state)}</dd>
          </div>
          <div>
            <dt>Compromissos futuros</dt>
            <dd className={metrics.pendingBillsMonth > 0 ? "amount-warning" : "amount-neutral"}>{money(metrics.pendingBillsMonth, state)}</dd>
            <small>Parcelas: {money(metrics.installmentsMonth, state)}</small>
          </div>
        </dl>
      </section>

      <section className="dashboard-compact-metrics" aria-label="Métricas financeiras do mês">
        {[
          ["Entradas", metrics.monthIncome, "good"],
          ["Saídas", metrics.monthExpenses, metrics.monthExpenses > 0 ? "bad" : "neutral"],
          ["Saldo disponível", metrics.availableBalance, metrics.availableBalance >= 0 ? "good" : "bad"],
          ["Economia planejada", state.settings.monthlySavingGoal, "neutral"],
        ].map(([label, value, tone]) => (
          <div className={`dashboard-compact-metric ${tone}`} key={String(label)}>
            <span>{label}</span>
            <strong>{money(Number(value), state)}</strong>
          </div>
        ))}
      </section>

      <dl className="dashboard-context-metrics" aria-label="Posição financeira geral">
        <div><dt>Investimentos</dt><dd>{money(metrics.investments, state)}</dd></div>
        <div><dt>Parcelas abertas</dt><dd>{money(metrics.openInstallments, state)}</dd></div>
        <div><dt>Patrimônio líquido</dt><dd className={metrics.netWorth >= 0 ? "amount-positive" : "amount-negative"}>{money(metrics.netWorth, state)}</dd></div>
      </dl>

      <Panel
        title="Insights financeiros"
        action={(
          <button
            className="secondary"
            type="button"
            aria-controls="dashboard-financial-insights"
            aria-expanded={showInsights}
            onClick={() => setShowInsights((current) => !current)}
          >
            {showInsights ? "Ocultar insights" : "Ver insights"}
          </button>
        )}
      >
        {!showInsights && (
          <p className="muted financial-insights-summary">
            {insights.length === 1
              ? "1 insight disponível para este mês."
              : insights.length > 1
                ? `${insights.length} insights disponíveis para este mês.`
                : "Nenhum insight disponível para este mês."}
          </p>
        )}
        <div
          id="dashboard-financial-insights"
          className={`financial-insights-disclosure ${showInsights ? "is-expanded" : ""}`}
          aria-hidden={!showInsights}
        >
          <div className="financial-insights-disclosure-content">
            <p className="muted financial-insights-intro">
              Leituras objetivas calculadas somente com seus lançamentos, contas, parcelas e orçamentos.
            </p>
            {insights.length ? (
              <div className="financial-insights-grid" role="list">
                {insights.map((insight) => (
                  <article
                    className={`financial-insight ${insight.tone}`}
                    key={insight.id}
                    role="listitem"
                  >
                    <div className="financial-insight-copy">
                      <strong>{insight.title}</strong>
                      <p>{insight.explanation}</p>
                    </div>
                    <dl className="financial-insight-facts" aria-label="Dados usados no cálculo">
                      {insight.facts.map((fact) => (
                        <div key={fact.label}>
                          <dt>{fact.label}</dt>
                          <dd>{formatInsightFact(fact, state)}</dd>
                        </div>
                      ))}
                    </dl>
                  </article>
                ))}
              </div>
            ) : (
              <Empty message="Ainda não há dados suficientes para calcular insights deste mês." />
            )}
          </div>
        </div>
      </Panel>

      <div className="dashboard-details-toggle">
        <div>
          <strong>Quer entender os valores do mês?</strong>
          <span>
            Veja quais lançamentos, contas futuras e parcelas formam os números acima.
          </span>
        </div>

        <button
          className="secondary"
          type="button"
          onClick={() => setShowDashboardDetails((current) => !current)}
        >
          {showDashboardDetails ? "Ocultar detalhes" : "Ver detalhes"}
        </button>
      </div>

      {showDashboardDetails && (
        <section className="dashboard-detail-grid">
        <Panel title="Gastos lançados">
          <div className="dashboard-detail-summary">
            <strong>{money(metrics.monthExpenses, state)}</strong>
            <span>{monthExpenseItems.length} lançamento(s)</span>
          </div>

          {monthExpenseItems.length ? (
            <div className="dashboard-detail-list">
              {monthExpenseItems.map((transaction) => (
                <div className="dashboard-detail-item" key={transaction.id}>
                  <div>
                    <strong>{transaction.description}</strong>
                    <span>
                      {formatDate(transaction.date)} · {transaction.category}
                    </span>
                  </div>

                  <strong className="dashboard-detail-value bad">
                    {money(transaction.amount, state)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty message="Nenhum gasto lançado neste mês." />
          )}
        </Panel>

        <Panel title="Contas futuras do mês">
          <div className="dashboard-detail-summary">
            <strong>{money(metrics.pendingBillsMonth, state)}</strong>
            <span>{monthFutureBillItems.length} conta(s) pendente(s)</span>
          </div>

          {monthFutureBillItems.length ? (
            <div className="dashboard-detail-list">
              {monthFutureBillItems.map((bill) => (
                <div className="dashboard-detail-item" key={bill.id}>
                  <div>
                    <strong>{bill.description}</strong>
                    <span>
                      {formatDate(bill.dueDate)} · {bill.category}
                    </span>
                  </div>

                  <strong className="dashboard-detail-value warn">
                    {money(bill.amount, state)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty message="Nenhuma conta futura pendente neste mês." />
          )}
        </Panel>

        <Panel title="Parcelas do mês">
          <div className="dashboard-detail-summary">
            <strong>{money(metrics.installmentsMonth, state)}</strong>
            <span>{monthInstallmentItems.length} parcela(s)</span>
          </div>

          {monthInstallmentItems.length ? (
            <div className="dashboard-detail-list">
              {monthInstallmentItems.map((row) => (
                <div
                  className="dashboard-detail-item"
                  key={`${row.item.id}-${row.installmentNumber}`}
                >
                  <div>
                    <strong>{row.item.description}</strong>
                    <span>
                      Parcela {row.installmentNumber}/{row.item.installments} ·{" "}
                      {formatDate(row.dueDate)} · {row.item.cardName}
                    </span>
                  </div>

                  <strong className="dashboard-detail-value warn">
                    {money(row.amount, state)}
                  </strong>
                </div>
              ))}
            </div>
          ) : (
            <Empty message="Nenhuma parcela prevista neste mês." />
          )}
        </Panel>
      </section>
      )}

      <section className="grid-2">
        <Panel title="Gastos por categoria">
          {categoryData.length ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  dataKey="value"
                  data={categoryData}
                  innerRadius="48%"
                  outerRadius="78%"
                  paddingAngle={2}
                >
                  {categoryData.map((_entry, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(v) => money(Number(v), state)} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <Empty message="Sem gastos no mês selecionado." />
          )}
        </Panel>
        <Panel title="Evolução mensal">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={evolution} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="month" axisLine={false} tickLine={false} />
              <YAxis
                tickFormatter={(value) =>
                  Number(value).toLocaleString("pt-BR", {
                    maximumFractionDigits: 2,
                  })
                }
              />
              <Tooltip formatter={(v) => money(Number(v), state)} />
              <Area name="Receitas" type="monotone" dataKey="receitas" stroke="#059669" fill="#d1fae5" strokeWidth={2.5} />
              <Area name="Despesas" type="monotone" dataKey="despesas" stroke="#dc2626" fill="#fee2e2" strokeWidth={2.5} />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      <section className="grid-2">
        <Panel title="Metas por categoria">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Categoria</th>
                  <th>Limite</th>
                  <th>Gasto</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {budgetData.map((b) => (
                  <tr key={b.id}>
                    <td>{b.category}</td>
                    <td>{money(b.monthlyBudget, state)}</td>
                    <td>{money(b.spent, state)}</td>
                    <td>
                      <StatusBadge bad={b.difference < 0}>
                        {b.difference >= 0 ? "Dentro" : "Passou"}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
        <Panel title="Vencendo nos próximos 7 dias">
          {upcoming.length ? (
            upcoming.map((bill) => (
              <div className="list-row" key={bill.id}>
                <div>
                  <strong>{bill.description}</strong>
                  <span>
                    {formatDate(bill.dueDate)} · {bill.category}
                  </span>
                </div>
                <strong>{money(bill.amount, state)}</strong>
              </div>
            ))
          ) : (
            <Empty message="Nenhuma conta vencendo nos próximos 7 dias." />
          )}
        </Panel>
      </section>
    </div>
  );
}

function formatInsightFact(fact: FinancialInsightFact, state: FinanceState) {
  if (fact.format === "currency") return money(Number(fact.value), state);
  if (fact.format === "percent") {
    const value = Number(fact.value);
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  }
  if (fact.format === "date") return formatDate(String(fact.value));
  return String(fact.value);
}
