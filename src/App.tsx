import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Download,
  FileUp,
  LayoutDashboard,
  ListChecks,
  LogOut,
  PiggyBank,
  Plus,
  Receipt,
  Settings,
  Trash2,
  WalletCards,
} from "lucide-react";
import type {
  Budget,
  FinanceState,
  FutureBill,
  ImportResult,
  Installment,
  Investment,
  PageKey,
  Transaction,
} from "./types";
import { emptyState, normalizeState, sampleState } from "./data/sample";
import {
  budgetRows,
  expensesByCategory,
  getFirstPaymentMonth,
  getInstallmentAmount,
  getInstallmentsForMonth,
  getMetrics,
  upcomingBills,
} from "./lib/calculations";
import {
  loadLocalState,
  loadRemoteState,
  saveLocalState,
  saveRemoteState,
  supabase,
  isSupabaseConfigured,
  loadProfile,
  saveProfile,
} from "./lib/storage";
import {
  addMonths,
  currentMonth,
  formatDate,
  money,
  parseDateToISO,
  toNumber,
  todayISO,
  uid,
  ym,
} from "./lib/utils";
import { parseFinanceFiles } from "./lib/importers";

const COLORS = [
  "#2563eb",
  "#16a34a",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#64748b",
  "#ec4899",
];

const navItems: Array<{ id: PageKey; label: string; icon: JSX.Element }> = [
  { id: "dashboard", label: "Dashboard", icon: <LayoutDashboard size={18} /> },
  { id: "transactions", label: "Lançamentos", icon: <ListChecks size={18} /> },
  { id: "import", label: "Importar banco/cartão", icon: <FileUp size={18} /> },
  {
    id: "installments",
    label: "Cartões e parcelas",
    icon: <WalletCards size={18} />,
  },
  { id: "bills", label: "Contas futuras", icon: <Receipt size={18} /> },
  { id: "investments", label: "Investimentos", icon: <PiggyBank size={18} /> },
  {
    id: "budgets",
    label: "Metas e orçamento",
    icon: <WalletCards size={18} />,
  },
  { id: "settings", label: "Configurações", icon: <Settings size={18} /> },
];

export function App() {
  const [state, setState] = useState<FinanceState>(() => loadLocalState());
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [status, setStatus] = useState("Modo local");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
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
        setStatus("Carregando dados online...");
        const remote = await loadRemoteState(session.user.id);
        setLastSavedAt(null);
        setSaveError(null);
        const profile = await loadProfile(session.user.id);
        setDisplayName(profile.displayName);
        setDisplayNameDraft(profile.displayName);
        setSaveError(null);
        setStatus("Online Supabase");
        setState(remote);
        setUserId(session.user.id);
        setEmail(session.user.email || null);
        setRemoteReady(true);
        } else {
          setRemoteReady(false);
          setUserId(null);
          setEmail(null);
          setDisplayName("");
          setDisplayNameDraft("");
          setProfileMessage("");
          setLastSavedAt(null);
          setSaveError(null);
          setState(emptyState());
          setStatus("Aguardando login");
        }
      supabase.auth.onAuthStateChange(async (_event, session) => {
        if (session?.user?.id) {
          setRemoteReady(false);
          setStatus("Carregando dados online...");
          const remote = await loadRemoteState(session.user.id);
          setLastSavedAt(null);
          setSaveError(null);
          const profile = await loadProfile(session.user.id);
          setDisplayName(profile.displayName);
          setDisplayNameDraft(profile.displayName);
          setSaveError(null);
          setStatus("Online Supabase");
          setState(remote);
          setUserId(session.user.id);
          setEmail(session.user.email || null);
          setRemoteReady(true);
          } else {
            setRemoteReady(false);
            setUserId(null);
            setEmail(null);
            setDisplayName("");
            setDisplayNameDraft("");
            setProfileMessage("");
            setLastSavedAt(null);
            setSaveError(null);
            setState(emptyState());
            setStatus("Aguardando login");
          }
      });
    }
    boot();
  }, []);

  useEffect(() => {
    saveLocalState(state);

    if (!supabase || !userId || !remoteReady) return;

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
    }

    const isISODate = (value?: string) =>
      /^\d{4}-\d{2}-\d{2}$/.test(value || "");

    const invalidTransactions = state.transactions.filter(
      (t) => !isISODate(t.date)
    );

    const invalidInstallments = state.installments.filter(
      (i) => !isISODate(i.purchaseDate)
    );

    const invalidBills = state.bills.filter(
      (b) => !isISODate(b.dueDate)
    );

    const invalidDateCount =
      invalidTransactions.length +
      invalidInstallments.length +
      invalidBills.length;

    if (invalidDateCount > 0) {
      setSaveError(
        `Existem ${invalidDateCount} item(ns) sem data válida. Corrija antes de salvar online.`
      );
      setStatus("Erro de validação");
      return;
    }

    saveTimer.current = window.setTimeout(async () => {
      try {
        setStatus("Salvando online...");
        setSaveError(null);

        await saveRemoteState(userId, state);

        setLastSavedAt(formatSaveTime());
        setStatus("Online Supabase");
      } catch (error) {
        console.error(error);
        setSaveError(
          error instanceof Error
            ? error.message
            : "Erro ao salvar online. Backup local mantido neste navegador."
        );
        setStatus("Erro ao salvar online");
      }
    }, 800);

    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [state, userId, remoteReady]);

  const updateState = (updater: (prev: FinanceState) => FinanceState) =>
    setState((prev) => normalizeState(updater(prev)));

  const setSelectedMonth = (month: string) => {
    updateState((prev) => ({
      ...prev,
      settings: { ...prev.settings, selectedMonth: month },
    }));
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `finance-control-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const importBackup = async (file: File) => {
    const text = await file.text();
    setState(normalizeState(JSON.parse(text)));
    setStatus("Backup importado. Salvando online...");
  };

  const withTimeout = async <T,>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> => {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      window.setTimeout(() => reject(new Error(message)), ms),
    ),
  ]);
};

  const handleLogout = async () => {
    if (!supabase || logoutLoading) return;

    setLogoutLoading(true);
    setStatus("Salvando antes de sair...");
    setSaveError(null);

    try {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }

      if (userId && remoteReady) {
        await withTimeout(
          saveRemoteState(userId, state),
          5000,
          "Tempo limite ao salvar antes de sair. Tente novamente.",
        );

        setLastSavedAt(formatSaveTime());
      }

      setStatus("Saindo...");

      await withTimeout(
        supabase.auth.signOut(),
        5000,
        "Tempo limite ao sair. Recarregue a página e tente novamente.",
      );

      setLogoutLoading(false);
      setStatus("Sessão encerrada");
    } catch (error) {
      console.error(error);

      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível sair agora.",
      );

      setStatus("Erro ao sair");
      setLogoutLoading(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!userId) return;

    try {
      await saveProfile(userId, displayNameDraft);
      setDisplayName(displayNameDraft.trim());
      setProfileMessage("Perfil salvo.");
    } catch (error) {
      console.error(error);
      setProfileMessage("Não foi possível salvar o perfil.");
    }
  };

  const syncStatus = saveError
    ? saveError
    : `${status}${email ? ` · ${email}` : ""}${lastSavedAt ? ` · último salvamento: ${lastSavedAt}` : ""}`;
    if (isSupabaseConfigured && !userId) {
      return <AuthScreen />;
    }
      
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img
            className="brand-logo"
            src="/finasync-icon-512.png"
            alt="FinaSync"
          />
          <div>
            <strong>FinaSync</strong>
            <span>{isSupabaseConfigured ? "Online" : "Local"}</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => (
            <button
              key={item.id}
              className={activePage === item.id ? "nav active" : "nav"}
              onClick={() => setActivePage(item.id)}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-actions">
          <button className="secondary full" onClick={exportBackup}>
            <Download size={16} /> Exportar backup
          </button>
          <label className="secondary full file-label">
            <FileUp size={16} /> Importar backup
            <input
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(e) =>
                e.target.files?.[0] && importBackup(e.target.files[0])
              }
            />
          </label>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>{navItems.find((item) => item.id === activePage)?.label}</h1>
            <p>{syncStatus}</p>
          </div>
        <div className="topbar-actions">
          <label className="field compact">
            <span>Mês</span>
            <input
              type="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
            />
          </label>

          {userId && (
            <button
              className="secondary"
              onClick={handleLogout}
              disabled={logoutLoading}
            >
              <LogOut size={16} /> {logoutLoading ? "Saindo..." : "Sair"}
            </button>
          )}
        </div>
        </header>

        {activePage === "dashboard" && (
          <Dashboard
            state={state}
            month={selectedMonth}
            displayName={displayName}
            email={email}
          />
        )}
        {activePage === "transactions" && (
          <TransactionsPage
            state={state}
            updateState={updateState}
            month={selectedMonth}
          />
        )}
        {activePage === "import" && (
          <ImportPage state={state} updateState={updateState} />
        )}
        {activePage === "installments" && (
          <InstallmentsPage
            state={state}
            updateState={updateState}
            month={selectedMonth}
          />
        )}
        {activePage === "bills" && (
          <BillsPage
            state={state}
            updateState={updateState}
            month={selectedMonth}
          />
        )}
        {activePage === "investments" && (
          <InvestmentsPage state={state} updateState={updateState} />
        )}
        {activePage === "budgets" && (
          <BudgetsPage
            state={state}
            updateState={updateState}
            month={selectedMonth}
          />
        )}
        {activePage === "settings" && (
          <SettingsPage
            state={state}
            updateState={updateState}
            email={email}
            displayNameDraft={displayNameDraft}
            setDisplayNameDraft={setDisplayNameDraft}
            onSaveProfile={handleSaveProfile}
            profileMessage={profileMessage}
          />
        )}
      </main>
    </div>
  );
}

function AuthScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!supabase || loading) return;

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    if (!cleanEmail || !cleanEmail.includes("@")) {
      setMessage("Informe um e-mail válido.");
      return;
    }

    if (cleanPassword.length < 8) {
      setMessage("A senha precisa ter pelo menos 8 caracteres.");
      return;
    }

    try {
      setLoading(true);
      setMessage(mode === "login" ? "Entrando..." : "Criando conta...");

      const result =
        mode === "login"
          ? await supabase.auth.signInWithPassword({
              email: cleanEmail,
              password: cleanPassword,
            })
          : await supabase.auth.signUp({
              email: cleanEmail,
              password: cleanPassword,
              options: {
                emailRedirectTo: window.location.origin,
              },
            });

      if (result.error) {
        const msg = result.error.message;
        if (msg.toLowerCase().includes("invalid login credentials")) {
          setMessage(
            "E-mail ou senha inválidos. Se ainda não criou conta, clique em Criar uma nova conta.",
          );
        } else if (msg.toLowerCase().includes("email rate limit exceeded")) {
          setMessage(
            "Limite de e-mails do Supabase atingido. Para testes, desative a confirmação de e-mail no Supabase ou configure SMTP.",
          );
        } else {
          setMessage(msg);
        }
        return;
      }

      if (mode === "signup") {
        if (result.data.session) {
          setMessage("Conta criada. Entrando...");
        } else {
          setMessage(
            "Conta criada. Confirme o e-mail antes de entrar, se a confirmação estiver ativa no Supabase.",
          );
        }
      } else {
        setMessage("Login realizado.");
      }
    } catch (error) {
      console.error(error);
      setMessage(
        "Não foi possível conectar ao Supabase. Verifique URL, chave e conexão.",
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <img
            className="auth-logo"
            src="/finasync-icon-512.png"
            alt="FinaSync"
          />
          <strong>FinaSync</strong>
        </div>

        <h1>{mode === "login" ? "Entrar" : "Criar conta"}</h1>

        <p>Seus dados financeiros ficam separados por usuário no Supabase.</p>

        <label className="field">
          <span>E-mail</span>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
          />
        </label>

        <button className="primary full" onClick={submit} disabled={loading}>
          {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
        </button>

        <button
          className="link-button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login" ? "Criar uma nova conta" : "Já tenho conta"}
        </button>

        {message && <div className="notice">{message}</div>}
      </div>
    </div>
  );
}

function Dashboard({
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
  const metrics = getMetrics(state, month);
  const categoryData = expensesByCategory(state, month).slice(0, 8);
  const budgetData = budgetRows(state, month);
  const upcoming = upcomingBills(state, 7);
  const evolution = Array.from({ length: 6 }, (_, i) => {
    const m = addMonths(month, i - 5);
    const mm = getMetrics(state, m);
    return {
      month: m.slice(5),
      receitas: mm.monthIncome,
      despesas: mm.monthExpenses,
    };
  });

const welcomeName = displayName.trim() || email?.split("@")[0] || "bem-vindo";

  return (
    <div className="page-stack">
      <Panel title={`Olá, ${welcomeName} 👋`}>
        <p className="muted">
          Acompanhe seu mês, seus gastos, contas futuras e investimentos em um só lugar.
        </p>
      </Panel>

      <section className="cards-grid">
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

      <section className="grid-2">
        <Panel title="Gastos por categoria">
          {categoryData.length ? (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie dataKey="value" data={categoryData} label>
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
              <YAxis />
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

function TransactionsPage({
  state,
  updateState,
  month,
}: PageProps & { month: string }) {
  const [category, setCategory] = useState("Todos");
  const [type, setType] = useState("Todos");
  const [pendingDateChanges, setPendingDateChanges] = useState<Record<string, string>>({});
  const rows = state.transactions
    .filter((t) => ym(t.date) === month)
    .filter((t) => category === "Todos" || t.category === category)
    .filter((t) => type === "Todos" || t.type === type);
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

                  <button className="icon danger" onClick={() => remove(t.id)}>
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

function ImportPage({ state, updateState }: PageProps) {
  const [result, setResult] = useState<ImportResult | null>(null);
  const [loading, setLoading] = useState(false);

  const expenseCategories =
    state.settings.categories.length > 0
      ? state.settings.categories
      : ["Outros"];

  const incomeCategories =
    state.settings.incomeCategories.length > 0
      ? state.settings.incomeCategories
      : ["Outros"];

  const accountOptions = Array.from(
    new Set([
      ...state.settings.accounts,
      ...state.settings.cards,
      "Conta digital",
      "Conta Caixa",
      "Nubank",
    ].filter(Boolean))
  );

  const paymentMethodOptions = Array.from(
    new Set([
      ...state.settings.paymentMethods,
      "Pix",
      "Débito",
      "Crédito",
      "Boleto",
      "Transferência",
      "Outros",
    ].filter(Boolean))
  );

  const parse = async (files: FileList | null) => {
    if (!files?.length) return;

    setLoading(true);

    try {
      const parsed = await parseFinanceFiles([...files], state);
      setResult(parsed);
    } catch (error) {
      console.error(error);
      alert(
        error instanceof Error
          ? error.message
          : "Não foi possível importar o arquivo."
      );
    } finally {
      setLoading(false);
    }
  };

  const getSourceLabel = (source?: string) => {
    const key = (source || "").split(":")[0];

    if (key === "caixa-period-pdf") return "Caixa PDF";
    if (key === "nubank-account-pdf") return "Nubank Conta PDF";
    if (key === "nubank-account-csv") return "Nubank Conta CSV";
    if (key === "nubank-card-csv") return "Nubank Fatura CSV";

    return key || "Arquivo";
  };

  const getCategoryOptions = (transaction: Transaction) => {
    const base =
      transaction.type === "income" ? incomeCategories : expenseCategories;

    return Array.from(
      new Set(
        [...base, transaction.category]
          .map((item) => item?.trim())
          .filter(Boolean)
      )
    );
  };

  const getDefaultCategory = (type: Transaction["type"]) => {
    if (type === "income") {
      return incomeCategories[0] || "Outros";
    }

    return expenseCategories[0] || "Outros";
  };

  const patchPreviewTransaction = (
    id: string,
    patch: Partial<Transaction>
  ) => {
    setResult((prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        transactions: prev.transactions.map((transaction) => {
          if (transaction.id !== id) return transaction;

          const nextType = patch.type || transaction.type;
          const categoryOptions =
            nextType === "income" ? incomeCategories : expenseCategories;

          const currentCategory = patch.category ?? transaction.category;

          const nextCategory =
            patch.type && !categoryOptions.includes(currentCategory)
              ? getDefaultCategory(nextType)
              : currentCategory;

          return {
            ...transaction,
            ...patch,
            type: nextType,
            category: nextCategory,
          };
        }),
      };
    });
  };

  const apply = () => {
    if (!result) return;

    const validTransactions = result.transactions.filter((t) =>
      /^\d{4}-\d{2}-\d{2}$/.test(t.date || "")
    );

    if (validTransactions.length !== result.transactions.length) {
      alert(
        "Alguns lançamentos foram ignorados porque estavam sem data válida."
      );
    }

    updateState((prev) => ({
      ...prev,
      transactions: [...validTransactions, ...prev.transactions],
    }));

    setResult(null);
  };

  const clearPreview = () => {
    setResult(null);
  };

  const importSummary = result
    ? {
        total: result.transactions.length,
        incomeCount: result.transactions.filter((t) => t.type === "income")
          .length,
        expenseCount: result.transactions.filter((t) => t.type === "expense")
          .length,
        incomeTotal: result.transactions
          .filter((t) => t.type === "income")
          .reduce((sum, t) => sum + t.amount, 0),
        expenseTotal: result.transactions
          .filter((t) => t.type === "expense")
          .reduce((sum, t) => sum + t.amount, 0),
        ignoredCount: result.ignored.length,
        sources: Array.from(
          new Set(result.transactions.map((t) => getSourceLabel(t.source || "")))
        ),
      }
    : null;

  return (
    <div className="page-stack">
      <Panel title="Importar arquivos do banco/cartão">
        <p className="muted">
          Selecione CSV da conta Nubank, CSV da fatura Nubank, PDF do extrato
          da conta Nubank ou PDF do extrato por período da Caixa. O app converte
          para lançamentos, mostra uma prévia e ignora duplicados.
        </p>

        <label className="dropzone">
          <FileUp />
          <strong>Selecionar arquivos</strong>
          <span>CSV ou PDF · múltiplos arquivos</span>
          <input
            hidden
            type="file"
            multiple
            accept=".csv,.pdf,text/csv,application/pdf"
            onChange={(e) => parse(e.target.files)}
          />
        </label>

        {loading && <div className="notice">Convertendo arquivos...</div>}
      </Panel>

      {result && importSummary && (
        <Panel
          title="Prévia da importação"
          action={
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="secondary" onClick={clearPreview}>
                Cancelar prévia
              </button>

              <button className="primary" onClick={apply}>
                Importar {result.transactions.length} lançamentos
              </button>
            </div>
          }
        >
          {result.warnings.map((w) => (
            <div className="notice warn" key={w}>
              {w}
            </div>
          ))}

          <div className="summary-row">
            <strong>{importSummary.total}</strong>
            <span>lançamentos prontos</span>

            <strong>{importSummary.incomeCount}</strong>
            <span>receitas</span>

            <strong>{importSummary.expenseCount}</strong>
            <span>despesas</span>

            <strong>{importSummary.ignoredCount}</strong>
            <span>linhas ignoradas</span>
          </div>

          <div className="summary-row">
            <strong>{money(importSummary.incomeTotal, state)}</strong>
            <span>total de receitas</span>

            <strong>{money(importSummary.expenseTotal, state)}</strong>
            <span>total de despesas</span>

            <strong>{importSummary.sources.join(", ")}</strong>
            <span>banco/origem detectado</span>
          </div>

          <p className="muted">
            Revise os lançamentos antes de importar. Você pode ajustar tipo,
            categoria, descrição, conta/cartão e forma de pagamento nesta prévia.
          </p>

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
                  <th>Origem</th>
                </tr>
              </thead>

              <tbody>
                {result.transactions.slice(0, 80).map((t) => (
                  <tr key={t.id}>
                    <td>{formatDate(t.date)}</td>

                    <td>
                      <input
                        value={t.description}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            description: e.target.value,
                          })
                        }
                      />
                    </td>

                    <td>
                      <select
                        className={`type-select ${t.type === "income" ? "income" : "expense"}`}
                        value={t.type}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            type: e.target.value as Transaction["type"],
                          })
                        }
                      >
                        <option value="income">Receita</option>
                        <option value="expense">Despesa</option>
                      </select>
                    </td>

                    <td>
                      <select
                        value={t.category}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            category: e.target.value,
                          })
                        }
                      >
                        {getCategoryOptions(t).map((category) => (
                          <option key={category} value={category}>
                            {category}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td className={t.type === "income" ? "amount-positive" : "amount-negative"}>
  {money(t.amount, state)}
</td>

                    <td>
                      <select
                        value={t.paymentMethod || "Outros"}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            paymentMethod: e.target.value,
                          })
                        }
                      >
                        {paymentMethodOptions.map((method) => (
                          <option key={method} value={method}>
                            {method}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>
                      <select
                        value={t.accountOrCard || accountOptions[0] || "Conta"}
                        onChange={(e) =>
                          patchPreviewTransaction(t.id, {
                            accountOrCard: e.target.value,
                          })
                        }
                      >
                        {accountOptions.map((account) => (
                          <option key={account} value={account}>
                            {account}
                          </option>
                        ))}
                      </select>
                    </td>

                    <td>{t.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {result.transactions.length > 80 && (
            <div className="notice">
              Mostrando os primeiros 80 lançamentos na prévia. Todos os{" "}
              {result.transactions.length} lançamentos serão importados ao
              confirmar.
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}

function InstallmentsPage({
  state,
  updateState,
  month,
}: PageProps & { month: string }) {
  const rows = state.installments;
  const projection = getInstallmentsForMonth(state, month);
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
        i.id === id ? { ...i, ...patch } : i,
      ),
    }));
  const remove = (id: string) =>
    updateState((prev) => ({
      ...prev,
      installments: prev.installments.filter((i) => i.id !== id),
    }));
  return (
    <div className="page-stack">
      <Panel
        title="Cartões e parcelas"
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
                <th>Compra</th>
                <th>Descrição</th>
                <th>Cartão</th>
                <th>Categoria</th>
                <th>Total</th>
                <th>Qtd</th>
                <th>Parcela</th>
                <th>1º mês</th>
                <th>Pagas</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id}>
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
                            i.cardName,
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
                            e.target.value,
                          ),
                        })
                      }
                    >
                      {state.settings.cards.map((c) => (
                        <option key={c}>{c}</option>
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
                      {state.settings.categories.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <MoneyInput
                      value={i.totalAmount}
                      onChange={(value) => patch(i.id, { totalAmount: value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={i.installments}
                      onChange={(e) =>
                        patch(i.id, {
                          installments: Math.max(1, toNumber(e.target.value)),
                        })
                      }
                    />
                  </td>
                  <td>{money(getInstallmentAmount(i), state)}</td>
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
                      value={i.paidInstallments}
                      onChange={(e) =>
                        patch(i.id, {
                          paidInstallments: toNumber(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <button
                      className="icon danger"
                      onClick={() => remove(i.id)}
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
      <Panel title={`Parcelas previstas em ${month}`}>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Vencimento</th>
                <th>Descrição</th>
                <th>Parcela</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              {projection.map((p) => (
                <tr key={`${p.item.id}-${p.installmentNumber}`}>
                  <td>{formatDate(p.dueDate)}</td>
                  <td>{p.item.description}</td>
                  <td>
                    {p.installmentNumber}/{p.item.installments}
                  </td>
                  <td>{money(p.amount, state)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

function BillsPage({
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

    updateState((prev) => ({
      ...prev,
      bills: prev.bills.map((item) => {
        if (item.id !== bill.id) return item;

        if (bill.recurring && bill.frequency !== "Única") {
          return {
            ...item,
            paid: false,
            dueDate: getNextBillDueDate(bill),
          };
        }

        return {
          ...item,
          paid: true,
        };
      }),
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
    }));
  };

    const unmarkPaid = (bill: FutureBill) => {
    updateState((prev) => ({
      ...prev,
      bills: prev.bills.map((item) =>
        item.id === bill.id ? { ...item, paid: false } : item
      ),
      transactions: prev.transactions.filter((transaction) => {
        const linkedFutureBill =
          transaction.source === `future-bill:${bill.id}`;

        const legacyFutureBill =
          transaction.source === "future-bill" &&
          transaction.type === "expense" &&
          transaction.date === (bill.dueDate || todayISO()) &&
          transaction.description === bill.description &&
          transaction.category === bill.category &&
          toNumber(transaction.amount) === toNumber(bill.amount);

        return !(linkedFutureBill || legacyFutureBill);
      }),
    }));
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
                        className="icon danger"
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

function InvestmentsPage({ state, updateState }: PageProps) {
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
                        className="icon danger"
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

function BudgetsPage({
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
                  <button className="icon danger" onClick={() => remove(b.id)}>
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

function SettingsPage({
  state,
  updateState,
  email,
  displayNameDraft,
  setDisplayNameDraft,
  onSaveProfile,
  profileMessage,
}: PageProps & {
  email: string | null;
  displayNameDraft: string;
  setDisplayNameDraft: (value: string) => void;
  onSaveProfile: () => void;
  profileMessage: string;
}) {
  const s = state.settings;
  const setSettings = (patch: Partial<FinanceState["settings"]>) =>
    updateState((prev) => ({
      ...prev,
      settings: { ...prev.settings, ...patch },
    }));
  const setList = (
    key: keyof Pick<
      FinanceState["settings"],
      | "categories"
      | "incomeCategories"
      | "accounts"
      | "cards"
      | "paymentMethods"
    >,
    value: string,
  ) =>
    setSettings({
      [key]: value
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean),
    } as Partial<FinanceState["settings"]>);
  const patchCardRule = (
    cardName: string,
    patch: Partial<{ closingDay: number; dueDay: number }>,
  ) =>
    setSettings({
      cardRules: s.cardRules.map((r) =>
        r.cardName === cardName ? { ...r, ...patch } : r,
      ),
    });
return (
  <div className="page-stack">
    <Panel title="Perfil">
      <div className="form-grid">
        <label className="field">
          <span>Nome de exibição</span>
          <input
            value={displayNameDraft}
            onChange={(e) => setDisplayNameDraft(e.target.value)}
            placeholder="Ex: Vitor"
          />
        </label>

        <label className="field">
          <span>E-mail</span>
          <input value={email || ""} disabled />
        </label>
      </div>

      <button
        className="primary"
        style={{ marginTop: 12 }}
        onClick={onSaveProfile}
      >
        Salvar perfil
      </button>

      {profileMessage && <div className="notice">{profileMessage}</div>}
    </Panel>

    <Panel title="Configurações gerais">
        <div className="form-grid">
          <NumberField
            label="Saldo inicial"
            value={s.startingBalance}
            onChange={(v) => setSettings({ startingBalance: v })}
          />
          <NumberField
            label="Renda mensal estimada"
            value={s.monthlyIncomeEstimate}
            onChange={(v) => setSettings({ monthlyIncomeEstimate: v })}
          />
          <NumberField
            label="Meta mensal de investimento"
            value={s.monthlySavingGoal}
            onChange={(v) => setSettings({ monthlySavingGoal: v })}
          />
          <NumberField
            label="Reserva de emergência mensal"
            value={s.emergencyContribution}
            onChange={(v) => setSettings({ emergencyContribution: v })}
          />
        </div>
      </Panel>
      <Panel title="Listas e categorias">
        <div className="form-grid single">
          <TextArea
            label="Categorias de despesa"
            value={s.categories.join(", ")}
            onChange={(v) => setList("categories", v)}
          />
          <TextArea
            label="Categorias de receita"
            value={s.incomeCategories.join(", ")}
            onChange={(v) => setList("incomeCategories", v)}
          />
          <TextArea
            label="Contas"
            value={s.accounts.join(", ")}
            onChange={(v) => setList("accounts", v)}
          />
          <TextArea
            label="Cartões"
            value={s.cards.join(", ")}
            onChange={(v) => setList("cards", v)}
          />
          <TextArea
            label="Formas de pagamento"
            value={s.paymentMethods.join(", ")}
            onChange={(v) => setList("paymentMethods", v)}
          />
        </div>
      </Panel>
      <Panel title="Fechamento e vencimento dos cartões">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cartão</th>
                <th>Fecha no dia</th>
                <th>Paga no dia</th>
              </tr>
            </thead>
            <tbody>
              {s.cardRules.map((r) => (
                <tr key={r.cardName}>
                  <td>{r.cardName}</td>
                  <td>
                    <input
                      type="number"
                      value={r.closingDay}
                      onChange={(e) =>
                        patchCardRule(r.cardName, {
                          closingDay: toNumber(e.target.value),
                        })
                      }
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={r.dueDay}
                      onChange={(e) =>
                        patchCardRule(r.cardName, {
                          dueDay: toNumber(e.target.value),
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

interface PageProps {
  state: FinanceState;
  updateState: (updater: (prev: FinanceState) => FinanceState) => void;
}

function MoneyInput({
  value,
  onChange,
  className,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
}) {
  const [draft, setDraft] = useState(
    value ? String(value).replace(".", ",") : "",
  );
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!focused) {
      setDraft(value ? String(value).replace(".", ",") : "");
    }
  }, [value, focused]);

  const commit = () => {
    const parsed = toNumber(draft);
    onChange(parsed);
    setDraft(parsed ? String(parsed).replace(".", ",") : "");
    setFocused(false);
  };

  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      value={draft}
      onFocus={() => setFocused(true)}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);

        if (!raw.endsWith(".") && !raw.endsWith(",")) {
          onChange(toNumber(raw));
        }
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.currentTarget.blur();
        }
      }}
    />
  );
}
function MetricCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "good" | "bad" | "warn" | "neutral";
}) {
  return (
    <div className={`metric ${tone || "neutral"}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
function Panel({
  title,
  action,
  children,
}: {
  title: string;
  action?: JSX.Element;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}
function Empty({ message }: { message: string }) {
  return <div className="empty">{message}</div>;
}
function StatusBadge({
  bad,
  children,
}: {
  bad?: boolean;
  children: ReactNode;
}) {
  return <span className={bad ? "badge bad" : "badge good"}>{children}</span>;
}
function Select({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="field compact">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((o) => (
          <option key={o} value={o}>
            {o === "income" ? "Receita" : o === "expense" ? "Despesa" : o}
          </option>
        ))}
      </select>
    </label>
  );
}
function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <MoneyInput value={value} onChange={onChange} />
    </label>
  );
}
function TextArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
      />
    </label>
  );
}
function formatSaveTime(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}