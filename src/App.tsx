import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, Download, FileUp, LayoutDashboard, ListChecks,
  LoaderCircle, LogOut, Menu, PiggyBank, Receipt, Settings, WalletCards, X,
} from "lucide-react";
import type { FinanceState, PageKey } from "./types";
import { emptyState, normalizeState } from "./data/sample";
import {
  isSupabaseConfigured, loadLocalState, loadProfile, loadRemoteState,
  deleteRemoteFutureBill, deleteRemoteFutureBillsFrom, deleteRemoteTransaction, getRemoteErrorDetails, saveLocalState, saveProfile, saveRemoteState, supabase,
} from "./lib/storage";
import { currentMonth } from "./lib/utils";
import { BudgetsPage } from "./pages/BudgetsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TransactionsPage } from "./pages/TransactionsPage";

const Dashboard = lazy(() =>
  import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })),
);
const ImportPage = lazy(() =>
  import("./pages/ImportPage").then((module) => ({ default: module.ImportPage })),
);
const InstallmentsPage = lazy(() =>
  import("./pages/InstallmentsPage").then((module) => ({ default: module.InstallmentsPage })),
);
const BillsPage = lazy(() =>
  import("./pages/BillsPage").then((module) => ({ default: module.BillsPage })),
);
const InvestmentsPage = lazy(() =>
  import("./pages/InvestmentsPage").then((module) => ({ default: module.InvestmentsPage })),
);

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

const navGroups: Array<{ label: string; items: PageKey[] }> = [
  { label: "Visão geral", items: ["dashboard"] },
  { label: "Movimentação", items: ["transactions", "import"] },
  { label: "Planejamento", items: ["installments", "bills", "budgets", "investments"] },
  { label: "Sistema", items: ["settings"] },
];

function isMissingSessionError(error: unknown) {
  if (!(error instanceof Error)) return false;

  return error.name === "AuthSessionMissingError"
    || error.message.toLowerCase().includes("auth session missing");
}

type SyncState = "local-only" | "syncing" | "online" | "error";

export function App() {
  const [state, setState] = useState<FinanceState>(() => loadLocalState());
  const [activePage, setActivePage] = useState<PageKey>("dashboard");
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [status, setStatus] = useState("Modo local");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<SyncState>("local-only");
  const [syncError, setSyncError] = useState<ReturnType<typeof getRemoteErrorDetails> | null>(null);
  const [showSyncDetails, setShowSyncDetails] = useState(false);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [displayName, setDisplayName] = useState("");
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const [profileMessage, setProfileMessage] = useState("");
  const [userId, setUserId] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [remoteReady, setRemoteReady] = useState(!isSupabaseConfigured);
  const saveTimer = useRef<number | null>(null);
  const activeSaveRef = useRef<Promise<boolean> | null>(null);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const selectedMonth = state.settings.selectedMonth || currentMonth();

  const clearAuthenticatedSession = () => {
    setRemoteReady(false);
    setUserId(null);
    setEmail(null);
    setDisplayName("");
    setDisplayNameDraft("");
    setProfileMessage("");
    setLastSavedAt(null);
  };

  const runRemoteSave = useCallback((remoteUserId: string, remoteState: FinanceState) => {
    if (activeSaveRef.current) return activeSaveRef.current;

    const savePromise = (async () => {
      setSyncState("syncing");
      setSyncError(null);
      setShowSyncDetails(false);
      setStatus("Salvando online...");

      try {
        await saveRemoteState(remoteUserId, remoteState);
        setLastSavedAt(formatSaveTime());
        setSyncState("online");
        setStatus("Online Supabase");
        return true;
      } catch (error) {
        setSyncError({ ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() });
        setSyncState("error");
        setStatus("Erro de sincronização");
        return false;
      }
    })();

    activeSaveRef.current = savePromise;
    void savePromise.finally(() => {
      if (activeSaveRef.current === savePromise) activeSaveRef.current = null;
    });
    return savePromise;
  }, []);

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
        setSyncState("online");
        setState(remote);
        setUserId(session.user.id);
        setEmail(session.user.email || null);
        setRemoteReady(true);
        } else {
          clearAuthenticatedSession();
          setSaveError(null);
          setStatus("Aguardando login");
        }
      const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
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
          setSyncState("online");
          setState(remote);
          setUserId(session.user.id);
          setEmail(session.user.email || null);
          setRemoteReady(true);
          } else {
            clearAuthenticatedSession();
            setSaveError(null);
            setStatus("Aguardando login");
            setSyncState("local-only");
          }
      });

      return subscription;
    }
    let subscription: { unsubscribe: () => void } | undefined;
    void boot().then((result) => { subscription = result; });

    return () => subscription?.unsubscribe();
  }, []);

  useEffect(() => {
    saveLocalState(state);

    if (!supabase || !userId || !remoteReady) return;

    setSyncState("local-only");

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
      setSyncError({ message: `Existem ${invalidDateCount} item(ns) sem data válida. Corrija antes de salvar online.` });
      setSyncState("error");
      setStatus("Erro de sincronização");
      return;
    }

    saveTimer.current = window.setTimeout(() => {
      void runRemoteSave(userId, state);
    }, 800);

    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [state, userId, remoteReady, runRemoteSave]);

  const updateState = useCallback(
    (updater: (prev: FinanceState) => FinanceState) =>
      setState((prev) => normalizeState(updater(prev))),
    [],
  );

  const removeTransaction = useCallback(async (transactionId: string) => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    try {
      if (supabase && userId && remoteReady) {
        setStatus("Excluindo lançamento...");
        setSaveError(null);
        await deleteRemoteTransaction(userId, transactionId);
      }

      updateState((previous) => ({
        ...previous,
        transactions: previous.transactions.filter(
          (transaction) => transaction.id !== transactionId,
        ),
      }));

      if (supabase && userId && remoteReady) {
        setLastSavedAt(formatSaveTime());
        setStatus("Online Supabase");
      }
    } catch (error) {
      console.error(error);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o lançamento online.",
      );
      setStatus("Erro ao excluir lançamento");
      throw error;
    }
  }, [remoteReady, updateState, userId]);

  const removeFutureBill = useCallback(async (billId: string) => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    try {
      if (supabase && userId && remoteReady) {
        setStatus("Excluindo conta futura...");
        setSaveError(null);
        await deleteRemoteFutureBill(userId, billId);
      }

      updateState((previous) => ({
        ...previous,
        bills: previous.bills.filter((bill) => bill.id !== billId),
      }));

      if (supabase && userId && remoteReady) {
        setLastSavedAt(formatSaveTime());
        setStatus("Online Supabase");
      }
    } catch (error) {
      console.error(error);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir a conta futura online.",
      );
      setStatus("Erro ao excluir conta futura");
      throw error;
    }
  }, [remoteReady, updateState, userId]);

  const removeFutureBillsFrom = useCallback(async (seriesId: string, occurrenceNumber: number) => {
    if (!seriesId.trim() || !Number.isSafeInteger(occurrenceNumber) || occurrenceNumber < 1) {
      throw new Error("Identidade de recorrência inválida para exclusão.");
    }

    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    try {
      if (supabase && userId && remoteReady) {
        setStatus("Excluindo ocorrências futuras...");
        setSaveError(null);
        await deleteRemoteFutureBillsFrom(userId, seriesId, occurrenceNumber);
      }

      updateState((previous) => ({
        ...previous,
        bills: previous.bills.filter((bill) =>
          bill.seriesId !== seriesId ||
          bill.occurrenceNumber === undefined ||
          bill.occurrenceNumber < occurrenceNumber
        ),
      }));

      if (supabase && userId && remoteReady) {
        setLastSavedAt(formatSaveTime());
        setStatus("Online Supabase");
      }
    } catch (error) {
      console.error(error);
      setSaveError(error instanceof Error ? error.message : "Não foi possível excluir as ocorrências online.");
      setStatus("Erro ao excluir contas futuras");
      throw error;
    }
  }, [remoteReady, updateState, userId]);

  const setSelectedMonth = useCallback((month: string) => {
    updateState((prev) => ({
      ...prev,
      settings: { ...prev.settings, selectedMonth: month },
    }));
  }, [updateState]);

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
        await runRemoteSave(userId, state);
      }

      setStatus("Saindo...");

      const { error: signOutError } = await withTimeout(
        supabase.auth.signOut({ scope: "local" }),
        5000,
        "Tempo limite ao sair. Recarregue a página e tente novamente.",
      );

      if (signOutError && !isMissingSessionError(signOutError)) {
        throw signOutError;
      }

      if (signOutError) {
        console.warn("Supabase session was already unavailable during logout.");
      }

      clearAuthenticatedSession();
      setStatus("Sessão encerrada");
    } catch (error) {
      console.error(error);

      setSyncError({ message: error instanceof Error ? error.message : "Não foi possível sair agora." });
      setSyncState("error");

      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível sair agora.",
      );

      setStatus("Erro ao sair");
    } finally {
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

  const syncLabel = {
    "local-only": "Salvo localmente",
    syncing: "Sincronizando…",
    online: "Online Supabase",
    error: "Erro de sincronização",
  }[syncState];
  const syncStatus = syncLabel;
  const syncTone = syncState === "error" ? "error" : syncState === "syncing" ? "syncing" : "ready";
  const SyncIcon = syncState === "error" ? AlertCircle : syncState === "syncing" ? LoaderCircle : CheckCircle2;
  const retrySync = () => {
    if (userId && remoteReady && syncState !== "syncing") void runRemoteSave(userId, state);
  };
    if (isSupabaseConfigured && !userId) {
      return <AuthScreen />;
    }
      
  return (
    <div className="app-shell">
      <aside className={isMobileNavOpen ? "sidebar mobile-open" : "sidebar"}>
        <div className="sidebar-header">
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

          <button
            type="button"
            className="mobile-nav-toggle"
            aria-label={isMobileNavOpen ? "Fechar menu" : "Abrir menu"}
            aria-expanded={isMobileNavOpen}
            onClick={() => setIsMobileNavOpen((current) => !current)}
          >
            {isMobileNavOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        <div className="mobile-nav-content">
          <nav className="sidebar-nav" aria-label="Navegação principal">
            {navGroups.map((group) => (
              <div className="nav-group" key={group.label}>
                <span className="nav-group-label">{group.label}</span>
                {group.items.map((id) => {
                  const item = navItems.find((navItem) => navItem.id === id)!;
                  return (
                    <button
                      type="button"
                      key={item.id}
                      className={activePage === item.id ? "nav active" : "nav"}
                      aria-current={activePage === item.id ? "page" : undefined}
                      onClick={() => {
                        setActivePage(item.id);
                        setIsMobileNavOpen(false);
                      }}
                    >
                      {item.icon}
                      {item.label}
                    </button>
                  );
                })}
              </div>
            ))}
          </nav>

          <div className="sidebar-actions">
            <div className={`sidebar-sync ${syncTone}`} role="status" aria-live="polite" title={syncStatus}>
              <SyncIcon size={15} className={syncState === "syncing" ? "spin" : undefined} />
              <div>
                {status !== syncLabel && <span className="sr-only">{status}</span>}
                <strong>{syncLabel}</strong>
                {lastSavedAt && syncState === "online" && <time>Última sincronização: {lastSavedAt}</time>}
                {syncState === "error" && syncError && (
                  <>
                    <span className="sync-error-summary">{syncError.message}</span>
                    <button
                      type="button"
                      className="sync-details-toggle"
                      aria-label={showSyncDetails ? "Ocultar detalhes de sincronização" : "Ver detalhes de sincronização"}
                      onClick={() => setShowSyncDetails((current) => !current)}
                    >
                      {showSyncDetails ? "Ocultar detalhes" : "Ver detalhes"}
                    </button>
                    {showSyncDetails && (
                      <div className="sync-details">
                        <span>Tabela: {syncError.table || "—"}</span>
                        <span>Operação: {syncError.operation || "—"}</span>
                        <span>Código: {syncError.code || "—"}</span>
                        <span>Horário: {syncError.timestamp ? formatSaveTime(new Date(syncError.timestamp)) : formatSaveTime()}</span>
                        <span>{syncError.message}</span>
                        {syncError.details && <span>Detalhes: {syncError.details}</span>}
                        {syncError.hint && <span>Dica: {syncError.hint}</span>}
                        <button type="button" className="secondary sync-retry" onClick={retrySync}>
                          Tentar novamente
                        </button>
                      </div>
                    )}
                  </>
                )}
                {saveError && syncState !== "error" && <span className="sync-error-summary">{saveError}</span>}
              </div>
            </div>
            <button type="button" className="sidebar-action" onClick={exportBackup}>
              <Download size={16} /> Exportar backup
            </button>

            <button
              type="button"
              className="sidebar-action file-label"
              onClick={() => backupInputRef.current?.click()}
            >
              <FileUp size={16} /> Importar backup
            </button>
            <input
              ref={backupInputRef}
              hidden
              type="file"
              accept="application/json,.json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) importBackup(file);
                e.currentTarget.value = "";
              }}
            />

            {userId && (
              <button
                className="sidebar-action sidebar-logout"
                onClick={handleLogout}
                disabled={logoutLoading}
              >
                <LogOut size={16} /> {logoutLoading ? "Saindo..." : "Sair"}
              </button>
            )}
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="page-heading">
            <h1>{navItems.find((item) => item.id === activePage)?.label}</h1>
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

        </div>
        </header>

        <Suspense fallback={<PageLoading />}>
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
              onDeleteTransaction={removeTransaction}
            />
          )}
          {activePage === "import" && (
            <ImportPage
              state={state}
              updateState={updateState}
              onGoToTransactions={() => setActivePage("transactions")}
            />
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
              onDeleteFutureBill={removeFutureBill}
              onDeleteFutureBillsFrom={removeFutureBillsFrom}
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
        </Suspense>
      </main>
    </div>
  );
}

function PageLoading() {
  return (
    <section className="panel page-loading" role="status" aria-live="polite">
      <LoaderCircle className="spin" size={24} aria-hidden="true" />
      <div>
        <strong>Carregando página...</strong>
        <span>Preparando seus dados financeiros.</span>
      </div>
    </section>
  );
}

export function AuthScreen() {
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
      <form
        className="auth-card"
        aria-busy={loading}
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
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
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            inputMode="email"
            required
          />
        </label>

        <label className="field">
          <span>Senha</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            minLength={8}
            required
          />
        </label>

        <button type="submit" className="primary full" disabled={loading}>
          {loading ? "Aguarde..." : mode === "login" ? "Entrar" : "Criar conta"}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(mode === "login" ? "signup" : "login");
            setMessage("");
          }}
        >
          {mode === "login" ? "Criar uma nova conta" : "Já tenho conta"}
        </button>

        {message && <div className="notice" role="status" aria-live="polite">{message}</div>}
      </form>
    </div>
  );
}


function formatSaveTime(date = new Date()) {
  return date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });
}
