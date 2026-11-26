import { useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import type { FinanceState } from "../types";
import {
  budgetRows, commitmentsByCategory, getInstallmentsForMonth, getMetrics, upcomingBills,
} from "../lib/calculations";
import { getFinancialInsights, type FinancialInsightFact } from "../lib/financialInsights";
import { addMonths, formatDate, money, toNumber, ym } from "../lib/utils";
import { Empty, Panel, StatusBadge } from "../components/ui";

export function Dashboard({
  state, month, displayName, email,
}: {
  state: FinanceState;
  month: string;
  displayName: string;
  email: string | null;
}) {
  const [showInsights, setShowInsights] = useState(false);
  const [showDashboardDetails, setShowDashboardDetails] = useState(false);
  const data = useMemo(() => {
    const evolution = Array.from({ length: 6 }, (_, i) => {
      const evolutionMonth = addMonths(month, i - 5);
      const m = getMetrics(state, evolutionMonth);
      return { month: evolutionMonth.slice(5), receitas: m.monthIncome, despesas: m.monthExpenses };
    });
    return {
      metrics: getMetrics(state, month),
      categoryData: commitmentsByCategory(state, month).slice(0, 8),
      budgetData: budgetRows(state, month),
      upcoming: upcomingBills(state, 7),
      evolution,
      insights: getFinancialInsights(state, month),
      monthExpenseItems: state.transactions.filter((t) => t.type === "expense" && ym(t.date) === month)
        .sort((a, b) => toNumber(b.amount) - toNumber(a.amount)),
      monthFutureBillItems: state.bills.filter((b) => ym(b.dueDate) === month && !b.paid)
        .sort((a, b) => (a.dueDate || "").localeCompare(b.dueDate || "")),
      monthInstallmentItems: getInstallmentsForMonth(state, month)
        .sort((a, b) => a.dueDate.localeCompare(b.dueDate)),
    };
  }, [state, month]);
  const { metrics } = data;
  const welcomeName = displayName.trim() || email?.split("@")[0] || "bem-vindo";
  const goalValue = toNumber(state.settings.monthlySavingGoal);
  const emergencyValue = toNumber(state.settings.emergencyContribution);
  const categoryAxisMax = chartAxisMaximum(data.categoryData.flatMap((row) => [row.realized, row.futureBills, row.installments]));
  const evolutionAxisMax = chartAxisMaximum(data.evolution.flatMap((row) => [row.receitas, row.despesas]));

  return (
    <div className="page-stack dash-page">
      <div className="mobile-hidden dash-welcome">
        <Panel title={`Olá, ${welcomeName} 👋`}>
          <p className="muted">Acompanhe seu mês, seus gastos, contas futuras e investimentos em um só lugar.</p>
        </Panel>
      </div>

      <section className="dash-hero" aria-label="Resumo do mês">
        <div className="dash-primary">
          <span className="dash-eyebrow">Disponível previsto ao fim do mês</span>
          <strong className={metrics.safeToSpend >= 0 ? "amount-positive" : "amount-negative"}>
            {money(metrics.safeToSpend, state)}
          </strong>
          <span className={`dash-status ${metrics.safeToSpend >= 0 ? "good" : "bad"}`}>
            {metrics.safeToSpend >= 0 ? "Dentro do planejado" : "Requer atenção"}
          </span>
          <p className="dash-note">
            Previsão após receitas estimadas, contas futuras, parcelas e as reservas planejadas para o mês.
          </p>
          <div className="dash-reserves">
            <span>Economia planejada <strong>{money(goalValue, state)}</strong></span>
            <span>Reserva de emergência <strong>{money(emergencyValue, state)}</strong></span>
          </div>
        </div>
        <div className="dash-kpis" aria-label="Indicadores financeiros">
          <Metric label="Entradas" value={metrics.monthIncome} state={state} tone="good" note="Receitas lançadas no mês" />
          <Metric label="Saídas" value={metrics.monthExpenses} state={state} tone={metrics.monthExpenses > 0 ? "bad" : "neutral"} note="Gastos lançados no mês" />
          <Metric label="Saldo acumulado" value={metrics.availableBalance} state={state} tone={metrics.availableBalance >= 0 ? "good" : "bad"} note="Saldo inicial + tudo já pago, sem recorte de mês" />
          <Metric label="Compromissos futuros" value={metrics.pendingBillsMonth} state={state} tone="warn" note={`Parcelas do mês: ${money(metrics.installmentsMonth, state)}`} />
        </div>
      </section>

      <dl className="dash-context" aria-label="Posição financeira geral">
        <Context label="Investimentos" value={metrics.investments} state={state} origin="Soma do valor atual dos investimentos" />
        <Context label="Parcelas abertas" value={metrics.openInstallments} state={state} origin="Saldo restante de todos os itens parcelados" />
        <Context label="Patrimônio líquido" value={metrics.netWorth} state={state} origin="Saldo acumulado + investimentos − parcelas abertas" tone={metrics.netWorth >= 0 ? "amount-positive" : "amount-negative"} />
      </dl>

      <Panel title="Insights financeiros" action={(
        <button className="secondary" type="button" aria-controls="dashboard-financial-insights"
          aria-expanded={showInsights} onClick={() => setShowInsights((current) => !current)}>
          {showInsights ? "Ocultar insights" : "Ver insights"}
        </button>
      )}>
        {!showInsights && <p className="muted financial-insights-summary">
          {data.insights.length === 1 ? "1 insight disponível para este mês."
            : data.insights.length > 1 ? `${data.insights.length} insights disponíveis para este mês.`
              : "Nenhum insight disponível para este mês."}
        </p>}
        <div id="dashboard-financial-insights" className={`financial-insights-disclosure ${showInsights ? "is-expanded" : ""}`} aria-hidden={!showInsights}>
          <div className="financial-insights-disclosure-content">
            <p className="muted financial-insights-intro">Leituras objetivas calculadas somente com seus lançamentos, contas, parcelas e orçamentos.</p>
            {data.insights.length ? <div className="financial-insights-grid" role="list">
              {data.insights.map((insight) => <article className={`financial-insight ${insight.tone}`} key={insight.id} role="listitem">
                <div className="financial-insight-copy"><strong>{insight.title}</strong><p>{insight.explanation}</p></div>
                <dl className="financial-insight-facts" aria-label="Dados usados no cálculo">
                  {insight.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{formatInsightFact(fact, state)}</dd></div>)}
                </dl>
              </article>)}
            </div> : <Empty message="Ainda não há dados suficientes para calcular insights deste mês." />}
          </div>
        </div>
      </Panel>

      <div className="dashboard-details-toggle dash-details-toggle">
        <div><strong>Quer entender os valores do mês?</strong><span>Veja quais lançamentos, contas futuras e parcelas formam os números acima.</span></div>
        <button className="secondary" type="button" aria-controls="dashboard-month-details" aria-expanded={showDashboardDetails}
          onClick={() => setShowDashboardDetails((current) => !current)}>
          {showDashboardDetails ? "Ocultar detalhes" : "Ver detalhes"}
        </button>
      </div>
      {showDashboardDetails && <section id="dashboard-month-details" className="dashboard-detail-grid dash-detail-grid">
        <Panel title="Gastos lançados"><div className="dashboard-detail-summary"><strong>{money(metrics.monthExpenses, state)}</strong><span>{data.monthExpenseItems.length} lançamento(s)</span></div>
          {data.monthExpenseItems.length ? <div className="dashboard-detail-list">{data.monthExpenseItems.map((t) => <div className="dashboard-detail-item" key={t.id}><div><strong>{t.description}</strong><span>{formatDate(t.date)} · {t.category}</span></div><strong className="dashboard-detail-value bad">{money(t.amount, state)}</strong></div>)}</div> : <Empty message="Nenhum gasto lançado neste mês." />}
        </Panel>
        <Panel title="Contas futuras do mês"><div className="dashboard-detail-summary"><strong>{money(metrics.pendingBillsMonth, state)}</strong><span>{data.monthFutureBillItems.length} conta(s) pendente(s)</span></div>
          {data.monthFutureBillItems.length ? <div className="dashboard-detail-list">{data.monthFutureBillItems.map((b) => <div className="dashboard-detail-item" key={b.id}><div><strong>{b.description}</strong><span>{formatDate(b.dueDate)} · {b.category}</span></div><strong className="dashboard-detail-value warn">{money(b.amount, state)}</strong></div>)}</div> : <Empty message="Nenhuma conta futura pendente neste mês." />}
        </Panel>
        <Panel title="Parcelas do mês"><div className="dashboard-detail-summary"><strong>{money(metrics.installmentsMonth, state)}</strong><span>{data.monthInstallmentItems.length} parcela(s)</span></div>
          {data.monthInstallmentItems.length ? <div className="dashboard-detail-list">{data.monthInstallmentItems.map((row) => <div className="dashboard-detail-item" key={`${row.item.id}-${row.installmentNumber}`}><div><strong>{row.item.description}</strong><span>Parcela {row.installmentNumber}/{row.item.installments} · {formatDate(row.dueDate)} · {row.item.cardName}</span></div><strong className="dashboard-detail-value warn">{money(row.amount, state)}</strong></div>)}</div> : <Empty message="Nenhuma parcela prevista neste mês." />}
        </Panel>
      </section>}

      <section className="grid-2 dash-charts">
        <Panel title="Compromissos por categoria"><p className="muted">Realizado, Contas futuras e Parcelas são estados diferentes e podem conter itens ainda não reconciliados.</p>
          {data.categoryData.length ? <>
            <div className="dash-chart-desktop"><ResponsiveContainer width="100%" height={360}><BarChart data={data.categoryData} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="name" axisLine={false} tickLine={false} interval={0} angle={-25} textAnchor="end" height={56} tickMargin={8} /><YAxis width={48} domain={[0, categoryAxisMax]} tickFormatter={(v) => Number(v).toLocaleString("pt-BR")} />
              <Tooltip formatter={(v) => money(Number(v), state)} /><Legend verticalAlign="bottom" height={32} wrapperStyle={{ color: "#475569", fontSize: 12 }} /><Bar name="Realizado" dataKey="realized" fill="#2563eb" /><Bar name="Contas futuras" dataKey="futureBills" fill="#f59e0b" /><Bar name="Parcelas" dataKey="installments" fill="#8b5cf6" />
            </BarChart></ResponsiveContainer></div>
            <ul className="dash-chart-list">{data.categoryData.map((row) => <li key={row.name}><strong>{row.name}</strong><span className="dash-chart-values">Realizado {money(row.realized, state)} · Futuras {money(row.futureBills, state)} · Parcelas {money(row.installments, state)}</span></li>)}</ul>
          </> : <Empty message="Sem compromissos no mês selecionado." />}
        </Panel>
        <Panel title="Evolução mensal"><div className="dash-chart-desktop"><ResponsiveContainer width="100%" height={360}><AreaChart data={data.evolution} margin={{ top: 12, right: 16, left: 8, bottom: 8 }}>
          <CartesianGrid stroke="#e2e8f0" strokeDasharray="4 4" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} interval={0} height={56} tickMargin={8} /><YAxis width={52} domain={[0, evolutionAxisMax]} tickFormatter={(v) => Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} />
          <Tooltip formatter={(v) => money(Number(v), state)} /><Legend verticalAlign="bottom" height={32} wrapperStyle={{ color: "#475569", fontSize: 12 }} /><Area name="Receitas" type="monotone" dataKey="receitas" stroke="#059669" fill="#d1fae5" strokeWidth={2.5} /><Area name="Despesas" type="monotone" dataKey="despesas" stroke="#dc2626" fill="#fee2e2" strokeWidth={2.5} />
        </AreaChart></ResponsiveContainer></div>
          <ul className="dash-chart-list">{data.evolution.map((row) => <li key={row.month}><strong>{row.month}</strong><span className="dash-chart-values">Receitas {money(row.receitas, state)} · Despesas {money(row.despesas, state)}</span></li>)}</ul>
        </Panel>
      </section>

      <section className="grid-2 dash-lower-grid">
        <Panel title="Metas por categoria">
          {data.budgetData.length ? <>
            <div className="table-wrap dash-budget-table"><table><thead><tr><th>Categoria</th><th>Limite</th><th>Gasto</th><th>Status</th><th>Progresso</th></tr></thead>
              <tbody>{data.budgetData.map((b) => <tr key={b.id}><td>{b.category}</td><td>{money(b.monthlyBudget, state)}</td><td>{money(b.spent, state)}</td><td><StatusBadge bad={b.difference < 0}>{b.difference >= 0 ? "Dentro" : "Passou"}</StatusBadge></td>
                <td><Progress spent={b.spent} limit={b.monthlyBudget} category={b.category} state={state} /></td></tr>)}</tbody></table></div>
            <ul className="dash-budget-list">{data.budgetData.map((b) => <li key={b.id}><div className="dash-budget-heading"><strong>{b.category}</strong><span>Gasto {money(b.spent, state)} · Limite {money(b.monthlyBudget, state)}</span><StatusBadge bad={b.difference < 0}>{b.difference >= 0 ? "Dentro" : "Passou"}</StatusBadge></div>
              <Progress spent={b.spent} limit={b.monthlyBudget} category={b.category} state={state} /></li>)}</ul>
          </> : <Empty message="Nenhuma meta de categoria para este mês." />}
        </Panel>
        <Panel title="Vencendo nos próximos 7 dias">{data.upcoming.length ? data.upcoming.map((bill) => <div className="list-row" key={bill.id}><div><strong>{bill.description}</strong><span>{formatDate(bill.dueDate)} · {bill.category}</span></div><strong>{money(bill.amount, state)}</strong></div>) : <Empty message="Nenhuma conta vencendo nos próximos 7 dias." />}</Panel>
      </section>
    </div>
  );
}

function Metric({ label, value, state, tone, note }: { label: string; value: number; state: FinanceState; tone: string; note: string }) {
  return <div className={`dash-kpi ${tone}`}><span>{label}</span><strong>{money(value, state)}</strong><small>{note}</small></div>;
}

function Context({ label, value, state, origin, tone = "" }: { label: string; value: number; state: FinanceState; origin: string; tone?: string }) {
  return <div><dt>{label}</dt><dd className={tone}>{money(value, state)}</dd><small>{origin}</small></div>;
}

function Progress({ spent, limit, category, state }: { spent: number; limit: number; category: string; state: FinanceState }) {
  const percentage = limit > 0 ? Math.min(100, Math.max(0, (spent / limit) * 100)) : spent > 0 ? 100 : 0;
  const label = `${category}: ${money(spent, state)} gastos de ${money(limit, state)} de limite`;
  return <span className="dash-progress" role="img" aria-label={label}><span className={spent > limit ? "over" : ""} style={{ width: `${percentage}%` }} /></span>;
}

function chartAxisMaximum(values: number[]) {
  const maximum = Math.max(0, ...values);
  if (maximum === 0) return 1;
  const rawMaximum = maximum * 1.08;
  const magnitude = 10 ** Math.floor(Math.log10(rawMaximum));
  const normalized = rawMaximum / magnitude;
  const steps = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];
  const step = steps.find((candidate) => candidate >= normalized) ?? 10;
  return step * magnitude;
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
