import { useMemo, useState } from "react";
import {
  Area, AreaChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { FinanceState } from "../types";
import {
  budgetRows, expensesByCategory, getInstallmentsForMonth, getMetrics, upcomingBills,
} from "../lib/calculations";
import { addMonths, formatDate, money, toNumber, ym } from "../lib/utils";
import { Empty, MetricCard, Panel, StatusBadge } from "../components/ui";

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
  const [showDashboardDetails, setShowDashboardDetails] = useState(false);
  const {
    metrics,
    categoryData,
    budgetData,
    upcoming,
    evolution,
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
      <div className="dashboard-metrics">
        <section className="dashboard-mobile-summary">
          <div className="dashboard-mobile-summary-head">
            <div>
              <span>Resumo do mês</span>
              <strong>{money(metrics.safeToSpend, state)}</strong>
            </div>

            <span
              className={
                metrics.safeToSpend >= 0
                  ? "dashboard-mobile-status good"
                  : "dashboard-mobile-status bad"
              }
            >
              {metrics.safeToSpend >= 0 ? "Livre" : "Atenção"}
            </span>
          </div>

          <div className="dashboard-mobile-summary-grid">
            <div>
              <span>Receitas</span>
              <strong className="amount-positive">
                {money(metrics.monthIncome, state)}
              </strong>
            </div>

            <div>
              <span>Gastos</span>
              <strong className="amount-negative">
                {money(metrics.monthExpenses, state)}
              </strong>
            </div>

            <div>
              <span>Contas futuras</span>
              <strong>{money(metrics.pendingBillsMonth, state)}</strong>
            </div>

            <div>
              <span>Parcelas</span>
              <strong>{money(metrics.installmentsMonth, state)}</strong>
            </div>
          </div>
        </section>

        <section className="cards-grid dashboard-desktop-metrics">
          <MetricCard
            label="Receitas do mês"
            value={money(metrics.monthIncome, state)}
            tone="good"
          />

          <MetricCard
            label="Gastos lançados"
            value={money(metrics.monthExpenses, state)}
            tone={metrics.monthExpenses > 0 ? "bad" : "neutral"}
          />

          <MetricCard
            label="Contas futuras do mês"
            value={money(metrics.pendingBillsMonth, state)}
            tone={metrics.pendingBillsMonth > 0 ? "warn" : "good"}
          />

          <MetricCard
            label="Parcelas do mês"
            value={money(metrics.installmentsMonth, state)}
            tone={metrics.installmentsMonth > 0 ? "warn" : "good"}
          />

          <MetricCard
            label="Previsão livre do mês"
            value={money(metrics.safeToSpend, state)}
            tone={metrics.safeToSpend >= 0 ? "good" : "bad"}
          />

          <MetricCard
            label="Investimentos"
            value={money(metrics.investments, state)}
            tone="good"
          />

          <MetricCard
            label="Parcelas abertas"
            value={money(metrics.openInstallments, state)}
            tone={metrics.openInstallments > 0 ? "warn" : "good"}
          />

          <MetricCard
            label="Patrimônio líquido"
            value={money(metrics.netWorth, state)}
            tone={metrics.netWorth >= 0 ? "good" : "bad"}
          />
        </section>
      </div>
      

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
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie
                  dataKey="value"
                  data={categoryData}
                  label={({ value }) => money(Number(value), state)}
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
            <AreaChart data={evolution}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="month" />
              <YAxis
                tickFormatter={(value) =>
                  Number(value).toLocaleString("pt-BR", {
                    maximumFractionDigits: 2,
                  })
                }
              />
              <Tooltip formatter={(v) => money(Number(v), state)} />
              <Area dataKey="receitas" />
              <Area dataKey="despesas" />
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

