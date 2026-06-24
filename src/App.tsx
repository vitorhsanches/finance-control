import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { AreaChart, Area, BarChart, Bar, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Download, FileUp, LayoutDashboard, ListChecks, LogOut, PiggyBank, Plus, Receipt, Settings, Trash2, WalletCards } from 'lucide-react';
import type { Budget, FinanceState, FutureBill, ImportResult, Installment, Investment, PageKey, Transaction } from './types';
import { emptyState, normalizeState, sampleState } from './data/sample';
import { budgetRows, expensesByCategory, getFirstPaymentMonth, getInstallmentAmount, getInstallmentsForMonth, getMetrics, upcomingBills } from './lib/calculations';
import { loadLocalState, loadRemoteState, saveLocalState, saveRemoteState, supabase, isSupabaseConfigured } from './lib/storage';
import { addMonths, currentMonth, formatDate, money, parseDateToISO, toNumber, todayISO, uid, ym } from './lib/utils';
import { parseFinanceFiles } from './lib/importers';

const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#64748b', '#ec4899'];

const navItems: Array<{ id: PageKey; label: string; icon: JSX.Element }> = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} /> },
  { id: 'transactions', label: 'Lançamentos', icon: <ListChecks size={18} /> },
  { id: 'import', label: 'Importar banco/cartão', icon: <FileUp size={18} /> },
  { id: 'installments', label: 'Cartões e parcelas', icon: <WalletCards size={18} /> },
  { id: 'bills', label: 'Contas futuras', icon: <Receipt size={18} /> },
  { id: 'investments', label: 'Investimentos', icon: <PiggyBank size={18} /> },
  { id: 'budgets', label: 'Metas e orçamento', icon: <WalletCards size={18} /> },
  { id: 'settings', label: 'Configurações', icon: <Settings size={18} /> }
];

export function App() {
  const [state, setState] = useState<FinanceState>(() => loadLocalState());
  const [activePage, setActivePage] = useState<PageKey>('dashboard');
  const [status, setStatus] = useState('Modo local');
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured);
  const saveTimer = useRef<number | null>(null);

  const selectedMonth = state.settings.selectedMonth || currentMonth();

  useEffect(() => {
    async function boot() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session?.user?.id) {
        setRemoteReady(false);
        setStatus('Carregando dados online...');
        const remote = await loadRemoteState(session.user.id);
        setState(remote);
        setUserId(session.user.id);
        setEmail(session.user.email || null);
        setRemoteReady(true);
        setStatus('Dados online sincronizados');
      } else {
        setRemoteReady(false);
        setState(emptyState());
        setStatus('Aguardando login');
      }
      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user?.id) {
          setRemoteReady(false);
          setStatus('Carregando dados online...');
          const remote = await loadRemoteState(session.user.id);
          setState(remote);
          setUserId(session.user.id);
          setEmail(session.user.email || null);
          setRemoteReady(true);
          setStatus('Dados online sincronizados');
        } else {
          setRemoteReady(false);
          setUserId(null);
          setEmail(null);
          setState(emptyState());
          setStatus('Aguardando login');
        }
      });
    }
    boot();
  }, []);

  useEffect(() => {
    saveLocalState(state);
    if (!supabase || !userId || !remoteReady) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      try {
        await saveRemoteState(userId, state);
        setStatus('Salvo online');
      } catch (error) {
        console.error(error);
        setStatus('Erro ao salvar online. Backup local mantido.');
      }
    }, 700);
  }, [state, userId]);

  const updateState = (updater: (prev: FinanceState) => FinanceState) => setState((prev) => normalizeState(updater(prev)));

  const setSelectedMonth = (month: string) => {
    updateState((prev) => ({ ...prev, settings: { ...prev.settings, selectedMonth: month } }));
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `finance-control-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    const text = await file.text();
    setState(normalizeState(JSON.parse(text)));
    setStatus('Backup importado');
  };

  if (isSupabaseConfigured && !userId) {
    return <AuthScreen />;
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">FC</div>
          <div>
            <strong>Finance Control</strong>
            <span>{isSupabaseConfigured ? 'Online' : 'Local'}</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button key={item.id} className={activePage === item.id ? 'nav active' : 'nav'} onClick={() => setActivePage(item.id)}>
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="secondary full" onClick={exportBackup}><Download size={16} /> Exportar backup</button>
          <label className="secondary full file-label">
            <FileUp size={16} /> Importar backup
            <input hidden type="file" accept="application/json,.json" onChange={(e) => e.target.files?.[0] && importBackup(e.target.files[0])} />
          </label>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{navItems.find((item) => item.id === activePage)?.label}</h1>
            <p>{status}{email ? ` · ${email}` : ''}</p>
          </div>
          <div className="topbar-actions">
            <label className="field compact">
              <span>Mês</span>
              <input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} />
            </label>
            {userId && (
              <button className="secondary" onClick={() => supabase?.auth.signOut()}><LogOut size={16} /> Sair</button>
            )}
          </div>
        </header>

        {activePage === 'dashboard' && <Dashboard state={state} month={selectedMonth} />}
        {activePage === 'transactions' && <TransactionsPage state={state} updateState={updateState} month={selectedMonth} />}
        {activePage === 'import' && <ImportPage state={state} updateState={updateState} />}
        {activePage === 'installments' && <InstallmentsPage state={state} updateState={updateState} month={selectedMonth} />}
        {activePage === 'bills' && <BillsPage state={state} updateState={updateState} month={selectedMonth} />}
        {activePage === 'investments' && <InvestmentsPage state={state} updateState={updateState} />}
        {activePage === 'budgets' && <BudgetsPage state={state} updateState={updateState} month={selectedMonth} />}
        {activePage === 'settings' && <SettingsPage state={state} updateState={updateState} />}
      </main>
    </div>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!supabase || loading) return;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanEmail.includes('@')) {
      setMessage('Informe um e-mail válido.');
      return;
    }

    if (cleanPassword.length < 8) {
      setMessage('A senha precisa ter pelo menos 8 caracteres.');
      return;
    }

    try {
      setLoading(true);
      setMessage(mode === 'login' ? 'Entrando...' : 'Criando conta...');

      const result = mode === 'login'
        ? await supabase.auth.signInWithPassword({ email: cleanEmail, password: cleanPassword })
        : await supabase.auth.signUp({
            email: cleanEmail,
            password: cleanPassword,
            options: {
              emailRedirectTo: window.location.origin
            }
          });

      if (result.error) {
        const msg = result.error.message;
        if (msg.toLowerCase().includes('invalid login credentials')) {
          setMessage('E-mail ou senha inválidos. Se ainda não criou conta, clique em Criar uma nova conta.');
        } else if (msg.toLowerCase().includes('email rate limit exceeded')) {
          setMessage('Limite de e-mails do Supabase atingido. Para testes, desative a confirmação de e-mail no Supabase ou configure SMTP.');
        } else {
          setMessage(msg);
        }
        return;
      }

      if (mode === 'signup') {
        if (result.data.session) {
          setMessage('Conta criada. Entrando...');
        } else {
          setMessage('Conta criada. Confirme o e-mail antes de entrar, se a confirmação estiver ativa no Supabase.');
        }
      } else {
        setMessage('Login realizado.');
      }
    } catch (error) {
      console.error(error);
      setMessage('Não foi possível conectar ao Supabase. Verifique URL, chave e conexão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="brand center"><div className="brand-mark">FC</div><strong>Finance Control</strong></div>
        <h1>{mode === 'login' ? 'Entrar' : 'Criar conta'}</h1>
        <p>Seus dados financeiros ficam separados por usuário no Supabase.</p>
        <label className="field"><span>E-mail</span><input value={email} onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
        <label className="field"><span>Senha</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} /></label>
        <button className="primary full" onClick={submit} disabled={loading}>{loading ? 'Aguarde...' : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        <button className="link-button" onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setMessage(''); }}>
          {mode === 'login' ? 'Criar uma nova conta' : 'Já tenho conta'}
        </button>
        {message && <div className="notice">{message}</div>}
      </div>
    </div>
  );
}

function Dashboard({ state, month }: { state: FinanceState; month: string }) {
  const metrics = getMetrics(state, month);
  const categoryData = expensesByCategory(state, month).slice(0, 8);
  const budgetData = budgetRows(state, month);
  const upcoming = upcomingBills(state, 7);
  const evolution = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(month, i - 5);
    const mm = getMetrics(state, m);
    return { month: m.slice(5), receitas: mm.monthIncome, despesas: mm.monthExpenses };
  });

  return (
    <div className="page-stack">
      <section className="cards-grid">
        <MetricCard label="Saldo disponível" value={money(metrics.availableBalance, state)} tone={metrics.availableBalance >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Receitas do mês" value={money(metrics.monthIncome, state)} tone="good" />
        <MetricCard label="Gastos do mês" value={money(metrics.monthExpenses, state)} tone={metrics.monthExpenses > metrics.monthIncome ? 'bad' : 'neutral'} />
        <MetricCard label="Pode gastar no mês" value={money(metrics.safeToSpend, state)} tone={metrics.safeToSpend >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Limite diário" value={money(metrics.dailyLimit, state)} tone={metrics.dailyLimit >= 0 ? 'good' : 'bad'} />
        <MetricCard label="Investimentos" value={money(metrics.investments, state)} tone="good" />
        <MetricCard label="Parcelas abertas" value={money(metrics.openInstallments, state)} tone={metrics.openInstallments > 0 ? 'warn' : 'good'} />
        <MetricCard label="Patrimônio líquido" value={money(metrics.netWorth, state)} tone={metrics.netWorth >= 0 ? 'good' : 'bad'} />
      </section>

      <section className="grid-2">
        <Panel title="Gastos por categoria">
          {categoryData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart><Pie dataKey="value" data={categoryData} label>{categoryData.map((_entry, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip formatter={(v) => money(Number(v), state)} /></PieChart>
            </ResponsiveContainer>
          ) : <Empty message="Sem gastos no mês selecionado." />}
        </Panel>
        <Panel title="Evolução mensal">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={evolution}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="month" /><YAxis /><Tooltip formatter={(v) => money(Number(v), state)} /><Area dataKey="receitas" /><Area dataKey="despesas" /></AreaChart>
          </ResponsiveContainer>
        </Panel>
      </section>

      <section className="grid-2">
        <Panel title="Metas por categoria">
          <div className="table-wrap"><table><thead><tr><th>Categoria</th><th>Limite</th><th>Gasto</th><th>Status</th></tr></thead><tbody>{budgetData.map((b) => <tr key={b.id}><td>{b.category}</td><td>{money(b.monthlyBudget, state)}</td><td>{money(b.spent, state)}</td><td><StatusBadge bad={b.difference < 0}>{b.difference >= 0 ? 'Dentro' : 'Passou'}</StatusBadge></td></tr>)}</tbody></table></div>
        </Panel>
        <Panel title="Vencendo nos próximos 7 dias">
          {upcoming.length ? upcoming.map((bill) => <div className="list-row" key={bill.id}><div><strong>{bill.description}</strong><span>{formatDate(bill.dueDate)} · {bill.category}</span></div><strong>{money(bill.amount, state)}</strong></div>) : <Empty message="Nenhuma conta vencendo nos próximos 7 dias." />}
        </Panel>
      </section>
    </div>
  );
}

function TransactionsPage({ state, updateState, month }: PageProps & { month: string }) {
  const [category, setCategory] = useState('Todos');
  const [type, setType] = useState('Todos');
  const rows = state.transactions.filter((t) => ym(t.date) === month).filter((t) => category === 'Todos' || t.category === category).filter((t) => type === 'Todos' || t.type === type);
  const categories = [...state.settings.incomeCategories, ...state.settings.categories];

  const add = () => updateState((prev) => ({ ...prev, transactions: [{ id: uid('tr'), date: month === currentMonth() ? todayISO() : `${month}-01`, description: 'Novo lançamento', type: 'expense', category: 'Outros', amount: 0, paymentMethod: 'Pix', accountOrCard: prev.settings.accounts[0] || 'Conta', essential: false, paid: true }, ...prev.transactions] }));
  const patch = (id: string, patch: Partial<Transaction>) => updateState((prev) => ({ ...prev, transactions: prev.transactions.map((t) => t.id === id ? { ...t, ...patch } : t) }));
  const remove = (id: string) => updateState((prev) => ({ ...prev, transactions: prev.transactions.filter((t) => t.id !== id) }));

  return (
    <Panel title="Lançamentos" action={<button className="primary" onClick={add}><Plus size={16} /> Adicionar</button>}>
      <div className="filters"><Select label="Tipo" value={type} onChange={setType} options={['Todos', 'income', 'expense']} /><Select label="Categoria" value={category} onChange={setCategory} options={['Todos', ...categories]} /></div>
      <div className="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Categoria</th><th>Valor</th><th>Pagamento</th><th>Conta/cartão</th><th>Pago</th><th></th></tr></thead><tbody>{rows.map((t) => <tr key={t.id}>
        <td><input type="date" value={t.date} onChange={(e) => patch(t.id, { date: e.target.value })} /></td>
        <td><input value={t.description} onChange={(e) => patch(t.id, { description: e.target.value })} /></td>
        <td><select value={t.type} onChange={(e) => patch(t.id, { type: e.target.value as Transaction['type'] })}><option value="expense">Despesa</option><option value="income">Receita</option></select></td>
        <td><select value={t.category} onChange={(e) => patch(t.id, { category: e.target.value })}>{categories.map((c) => <option key={c}>{c}</option>)}</select></td>
        <td><input className="money-input" type="number" value={t.amount} onChange={(e) => patch(t.id, { amount: toNumber(e.target.value) })} /></td>
        <td><select value={t.paymentMethod} onChange={(e) => patch(t.id, { paymentMethod: e.target.value })}>{state.settings.paymentMethods.map((p) => <option key={p}>{p}</option>)}</select></td>
        <td><select value={t.accountOrCard} onChange={(e) => patch(t.id, { accountOrCard: e.target.value })}>{[...state.settings.accounts, ...state.settings.cards].map((a) => <option key={a}>{a}</option>)}</select></td>
        <td><input type="checkbox" checked={t.paid} onChange={(e) => patch(t.id, { paid: e.target.checked })} /></td>
        <td><button className="icon danger" onClick={() => remove(t.id)}><Trash2 size={15} /></button></td>
      </tr>)}</tbody></table></div>
    </Panel>
  );
}

function ImportPage({ state, updateState }: PageProps) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const parse = async (files: FileList | null) => {
    if (!files?.length) return;
    setLoading(true);
    const parsed = await parseFinanceFiles([...files], state);
    setResult(parsed);
    setLoading(false);
  };
  const apply = () => {
    if (!result) return;
    updateState((prev) => ({ ...prev, transactions: [...result.transactions, ...prev.transactions] }));
    setResult(null);
  };

  return (
    <div className="page-stack">
      <Panel title="Importar arquivos do banco/cartão">
        <p className="muted">Selecione CSV da conta Nubank, CSV da fatura Nubank ou PDF do extrato da conta Nubank. O app converte direto para lançamentos e ignora duplicados.</p>
        <label className="dropzone">
          <FileUp />
          <strong>Selecionar arquivos</strong>
          <span>CSV ou PDF · múltiplos arquivos</span>
          <input hidden type="file" multiple accept=".csv,.pdf,text/csv,application/pdf" onChange={(e) => parse(e.target.files)} />
        </label>
        {loading && <div className="notice">Convertendo arquivos...</div>}
      </Panel>
      {result && <Panel title="Prévia da importação" action={<button className="primary" onClick={apply}>Importar {result.transactions.length} lançamentos</button>}>
        {result.warnings.map((w) => <div className="notice warn" key={w}>{w}</div>)}
        <div className="summary-row"><strong>{result.transactions.length}</strong><span>lançamentos prontos</span><strong>{result.ignored.length}</strong><span>linhas ignoradas</span></div>
        <div className="table-wrap"><table><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Categoria</th><th>Valor</th><th>Origem</th></tr></thead><tbody>{result.transactions.slice(0, 80).map((t) => <tr key={t.id}><td>{formatDate(t.date)}</td><td>{t.description}</td><td>{t.type === 'income' ? 'Receita' : 'Despesa'}</td><td>{t.category}</td><td>{money(t.amount, state)}</td><td>{t.source}</td></tr>)}</tbody></table></div>
      </Panel>}
    </div>
  );
}

function InstallmentsPage({ state, updateState, month }: PageProps & { month: string }) {
  const rows = state.installments;
  const projection = getInstallmentsForMonth(state, month);
  const add = () => updateState((prev) => ({ ...prev, installments: [{ id: uid('in'), purchaseDate: todayISO(), description: 'Nova compra parcelada', cardName: prev.settings.cards[0] || 'Cartão', category: 'Compras', totalAmount: 0, installments: 1, firstInstallmentMonth: month, paidInstallments: 0 }, ...prev.installments] }));
  const patch = (id: string, patch: Partial<Installment>) => updateState((prev) => ({ ...prev, installments: prev.installments.map((i) => i.id === id ? { ...i, ...patch } : i) }));
  const remove = (id: string) => updateState((prev) => ({ ...prev, installments: prev.installments.filter((i) => i.id !== id) }));
  return <div className="page-stack"><Panel title="Cartões e parcelas" action={<button className="primary" onClick={add}><Plus size={16} /> Adicionar</button>}>
    <div className="table-wrap"><table><thead><tr><th>Compra</th><th>Descrição</th><th>Cartão</th><th>Categoria</th><th>Total</th><th>Qtd</th><th>Parcela</th><th>1º mês</th><th>Pagas</th><th></th></tr></thead><tbody>{rows.map((i) => <tr key={i.id}>
      <td><input type="date" value={i.purchaseDate} onChange={(e) => patch(i.id, { purchaseDate: e.target.value, firstInstallmentMonth: getFirstPaymentMonth(state, e.target.value, i.cardName) })} /></td>
      <td><input value={i.description} onChange={(e) => patch(i.id, { description: e.target.value })} /></td>
      <td><select value={i.cardName} onChange={(e) => patch(i.id, { cardName: e.target.value, firstInstallmentMonth: getFirstPaymentMonth(state, i.purchaseDate, e.target.value) })}>{state.settings.cards.map((c) => <option key={c}>{c}</option>)}</select></td>
      <td><select value={i.category} onChange={(e) => patch(i.id, { category: e.target.value })}>{state.settings.categories.map((c) => <option key={c}>{c}</option>)}</select></td>
      <td><input type="number" value={i.totalAmount} onChange={(e) => patch(i.id, { totalAmount: toNumber(e.target.value) })} /></td>
      <td><input type="number" value={i.installments} onChange={(e) => patch(i.id, { installments: Math.max(1, toNumber(e.target.value)) })} /></td>
      <td>{money(getInstallmentAmount(i), state)}</td>
      <td><input type="month" value={i.firstInstallmentMonth} onChange={(e) => patch(i.id, { firstInstallmentMonth: e.target.value })} /></td>
      <td><input type="number" value={i.paidInstallments} onChange={(e) => patch(i.id, { paidInstallments: toNumber(e.target.value) })} /></td>
      <td><button className="icon danger" onClick={() => remove(i.id)}><Trash2 size={15} /></button></td>
    </tr>)}</tbody></table></div>
  </Panel><Panel title={`Parcelas previstas em ${month}`}><div className="table-wrap"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Parcela</th><th>Valor</th></tr></thead><tbody>{projection.map((p) => <tr key={`${p.item.id}-${p.installmentNumber}`}><td>{formatDate(p.dueDate)}</td><td>{p.item.description}</td><td>{p.installmentNumber}/{p.item.installments}</td><td>{money(p.amount, state)}</td></tr>)}</tbody></table></div></Panel></div>;
}

function BillsPage({ state, updateState, month }: PageProps & { month: string }) {
  const rows = state.bills.filter((b) => ym(b.dueDate) === month || !b.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const add = () => updateState((prev) => ({ ...prev, bills: [{ id: uid('bill'), dueDate: todayISO(), description: 'Nova conta', category: 'Casa', amount: 0, recurring: true, frequency: 'Mensal', priority: 'Média', paid: false }, ...prev.bills] }));
  const patch = (id: string, patch: Partial<FutureBill>) => updateState((prev) => ({ ...prev, bills: prev.bills.map((b) => b.id === id ? { ...b, ...patch } : b) }));
  const remove = (id: string) => updateState((prev) => ({ ...prev, bills: prev.bills.filter((b) => b.id !== id) }));
  const markPaid = (b: FutureBill) => updateState((prev) => ({ ...prev, bills: prev.bills.map((x) => x.id === b.id ? { ...x, paid: true } : x), transactions: [{ id: uid('tr'), date: b.dueDate, description: b.description, type: 'expense', category: b.category, amount: b.amount, paymentMethod: 'Boleto', accountOrCard: prev.settings.accounts[0] || 'Conta', essential: true, paid: true, source: 'future-bill' }, ...prev.transactions] }));
  return <Panel title="Contas futuras" action={<button className="primary" onClick={add}><Plus size={16} /> Adicionar</button>}><div className="table-wrap"><table><thead><tr><th>Vencimento</th><th>Descrição</th><th>Categoria</th><th>Valor</th><th>Recorrente</th><th>Frequência</th><th>Prioridade</th><th>Pago</th><th></th></tr></thead><tbody>{rows.map((b) => <tr key={b.id}>
    <td><input type="date" value={b.dueDate} onChange={(e) => patch(b.id, { dueDate: e.target.value })} /></td><td><input value={b.description} onChange={(e) => patch(b.id, { description: e.target.value })} /></td><td><select value={b.category} onChange={(e) => patch(b.id, { category: e.target.value })}>{state.settings.categories.map((c) => <option key={c}>{c}</option>)}</select></td><td><input type="number" value={b.amount} onChange={(e) => patch(b.id, { amount: toNumber(e.target.value) })} /></td><td><input type="checkbox" checked={b.recurring} onChange={(e) => patch(b.id, { recurring: e.target.checked })} /></td><td><select value={b.frequency} onChange={(e) => patch(b.id, { frequency: e.target.value as FutureBill['frequency'] })}><option>Mensal</option><option>Anual</option><option>Única</option></select></td><td><select value={b.priority} onChange={(e) => patch(b.id, { priority: e.target.value as FutureBill['priority'] })}><option>Baixa</option><option>Média</option><option>Alta</option></select></td><td><input type="checkbox" checked={b.paid} onChange={(e) => patch(b.id, { paid: e.target.checked })} /></td><td className="actions"><button className="secondary small" onClick={() => markPaid(b)}>Pagar</button><button className="icon danger" onClick={() => remove(b.id)}><Trash2 size={15} /></button></td>
  </tr>)}</tbody></table></div></Panel>;
}

function InvestmentsPage({ state, updateState }: PageProps) {
  const add = () => updateState((prev) => ({ ...prev, investments: [{ id: uid('iv'), type: 'Renda fixa', institution: '', initialAmount: 0, currentAmount: 0, liquidity: '', goal: '' }, ...prev.investments] }));
  const patch = (id: string, patch: Partial<Investment>) => updateState((prev) => ({ ...prev, investments: prev.investments.map((i) => i.id === id ? { ...i, ...patch } : i) }));
  const remove = (id: string) => updateState((prev) => ({ ...prev, investments: prev.investments.filter((i) => i.id !== id) }));
  return <Panel title="Investimentos" action={<button className="primary" onClick={add}><Plus size={16} /> Adicionar</button>}><div className="table-wrap"><table><thead><tr><th>Tipo</th><th>Instituição</th><th>Aplicado</th><th>Atual</th><th>Lucro/prejuízo</th><th>Liquidez</th><th>Objetivo</th><th></th></tr></thead><tbody>{state.investments.map((i) => <tr key={i.id}><td><input value={i.type} onChange={(e) => patch(i.id, { type: e.target.value })} /></td><td><input value={i.institution} onChange={(e) => patch(i.id, { institution: e.target.value })} /></td><td><input type="number" value={i.initialAmount} onChange={(e) => patch(i.id, { initialAmount: toNumber(e.target.value) })} /></td><td><input type="number" value={i.currentAmount} onChange={(e) => patch(i.id, { currentAmount: toNumber(e.target.value) })} /></td><td>{money(i.currentAmount - i.initialAmount, state)}</td><td><input value={i.liquidity} onChange={(e) => patch(i.id, { liquidity: e.target.value })} /></td><td><input value={i.goal} onChange={(e) => patch(i.id, { goal: e.target.value })} /></td><td><button className="icon danger" onClick={() => remove(i.id)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div></Panel>;
}

function BudgetsPage({ state, updateState, month }: PageProps & { month: string }) {
  const rows = budgetRows(state, month);
  const add = () => updateState((prev) => ({ ...prev, budgets: [{ id: uid('bg'), month, category: prev.settings.categories[0] || 'Outros', monthlyBudget: 0 }, ...prev.budgets] }));
  const patch = (id: string, patch: Partial<Budget>) => updateState((prev) => ({ ...prev, budgets: prev.budgets.map((b) => b.id === id ? { ...b, ...patch } : b) }));
  const remove = (id: string) => updateState((prev) => ({ ...prev, budgets: prev.budgets.filter((b) => b.id !== id) }));
  return <Panel title="Metas e orçamento" action={<button className="primary" onClick={add}><Plus size={16} /> Adicionar</button>}><div className="table-wrap"><table><thead><tr><th>Mês</th><th>Categoria</th><th>Limite</th><th>Gasto atual</th><th>Diferença</th><th>Status</th><th></th></tr></thead><tbody>{rows.map((b) => <tr key={b.id}><td><input type="month" value={b.month} onChange={(e) => patch(b.id, { month: e.target.value })} /></td><td><select value={b.category} onChange={(e) => patch(b.id, { category: e.target.value })}>{state.settings.categories.map((c) => <option key={c}>{c}</option>)}</select></td><td><input type="number" value={b.monthlyBudget} onChange={(e) => patch(b.id, { monthlyBudget: toNumber(e.target.value) })} /></td><td>{money(b.spent, state)}</td><td>{money(b.difference, state)}</td><td><StatusBadge bad={b.difference < 0}>{b.difference >= 0 ? 'Dentro' : 'Passou'}</StatusBadge></td><td><button className="icon danger" onClick={() => remove(b.id)}><Trash2 size={15} /></button></td></tr>)}</tbody></table></div></Panel>;
}

function SettingsPage({ state, updateState }: PageProps) {
  const s = state.settings;
  const setSettings = (patch: Partial<FinanceState['settings']>) => updateState((prev) => ({ ...prev, settings: { ...prev.settings, ...patch } }));
  const setList = (key: keyof Pick<FinanceState['settings'], 'categories' | 'incomeCategories' | 'accounts' | 'cards' | 'paymentMethods'>, value: string) => setSettings({ [key]: value.split(',').map((x) => x.trim()).filter(Boolean) } as Partial<FinanceState['settings']>);
  const patchCardRule = (cardName: string, patch: Partial<{ closingDay: number; dueDay: number }>) => setSettings({ cardRules: s.cardRules.map((r) => r.cardName === cardName ? { ...r, ...patch } : r) });
  return <div className="page-stack"><Panel title="Configurações gerais"><div className="form-grid"><NumberField label="Saldo inicial" value={s.startingBalance} onChange={(v) => setSettings({ startingBalance: v })} /><NumberField label="Renda mensal estimada" value={s.monthlyIncomeEstimate} onChange={(v) => setSettings({ monthlyIncomeEstimate: v })} /><NumberField label="Meta mensal de investimento" value={s.monthlySavingGoal} onChange={(v) => setSettings({ monthlySavingGoal: v })} /><NumberField label="Reserva de emergência mensal" value={s.emergencyContribution} onChange={(v) => setSettings({ emergencyContribution: v })} /></div></Panel>
  <Panel title="Listas e categorias"><div className="form-grid single"><TextArea label="Categorias de despesa" value={s.categories.join(', ')} onChange={(v) => setList('categories', v)} /><TextArea label="Categorias de receita" value={s.incomeCategories.join(', ')} onChange={(v) => setList('incomeCategories', v)} /><TextArea label="Contas" value={s.accounts.join(', ')} onChange={(v) => setList('accounts', v)} /><TextArea label="Cartões" value={s.cards.join(', ')} onChange={(v) => setList('cards', v)} /><TextArea label="Formas de pagamento" value={s.paymentMethods.join(', ')} onChange={(v) => setList('paymentMethods', v)} /></div></Panel>
  <Panel title="Fechamento e vencimento dos cartões"><div className="table-wrap"><table><thead><tr><th>Cartão</th><th>Fecha no dia</th><th>Paga no dia</th></tr></thead><tbody>{s.cardRules.map((r) => <tr key={r.cardName}><td>{r.cardName}</td><td><input type="number" value={r.closingDay} onChange={(e) => patchCardRule(r.cardName, { closingDay: toNumber(e.target.value) })} /></td><td><input type="number" value={r.dueDay} onChange={(e) => patchCardRule(r.cardName, { dueDay: toNumber(e.target.value) })} /></td></tr>)}</tbody></table></div></Panel></div>;
}

interface PageProps { state: FinanceState; updateState: (updater: (prev: FinanceState) => FinanceState) => void; }

function MetricCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'bad' | 'warn' | 'neutral' }) { return <div className={`metric ${tone || 'neutral'}`}><span>{label}</span><strong>{value}</strong></div>; }
function Panel({ title, action, children }: { title: string; action?: JSX.Element; children: ReactNode }) { return <section className="panel"><div className="panel-head"><h2>{title}</h2>{action}</div>{children}</section>; }
function Empty({ message }: { message: string }) { return <div className="empty">{message}</div>; }
function StatusBadge({ bad, children }: { bad?: boolean; children: ReactNode }) { return <span className={bad ? 'badge bad' : 'badge good'}>{children}</span>; }
function Select({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: string[] }) { return <label className="field compact"><span>{label}</span><select value={value} onChange={(e) => onChange(e.target.value)}>{options.map((o) => <option key={o} value={o}>{o === 'income' ? 'Receita' : o === 'expense' ? 'Despesa' : o}</option>)}</select></label>; }
function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) { return <label className="field"><span>{label}</span><input type="number" value={value} onChange={(e) => onChange(toNumber(e.target.value))} /></label>; }
function TextArea({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) { return <label className="field"><span>{label}</span><textarea value={value} onChange={(e) => onChange(e.target.value)} rows={3} /></label>; }
