import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle, CheckCircle2, Download, FileUp, LayoutDashboard, ListChecks,
  LoaderCircle, LogOut, Menu, PiggyBank, Receipt, Settings, WalletCards, X,
} from "lucide-react";
import type { FinanceState, PageKey } from "./types";
import { emptyState, normalizeState } from "./data/sample";
import {
  isSupabaseConfigured, loadLocalState, loadProfile, loadRemoteState, loadUserLocalState, loadUserSyncMetadata,
  cleanupConfirmedSyncMetadataOnLogout, recoverCorruptDeletionJournal, deleteRemoteFutureBill, deleteRemoteFutureBillsFrom,
  deleteRemoteTransaction, getRemoteErrorDetails,
  loadPendingDeletes, migrateLegacyLocalStateForUser, recordPendingDelete, recordPendingSeriesDelete,
  saveLocalState, saveProfile, saveRemoteState,
  saveUserLocalConfirmed, saveUserLocalDirty, supabase,
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

function isCorruptDeletionJournal(error: unknown) {
  return error instanceof Error && error.name === 'CorruptDeletionJournalError';
}

function hasPendingDeletes(userId: string) {
  return loadPendingDeletes(userId).length > 0;
}

type PendingRemoteSave = {
  userId: string;
  state: FinanceState;
  revision: number;
};

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
  const [journalBlocked, setJournalBlocked] = useState(false);
  const [pendingTransactionLabels, setPendingTransactionLabels] = useState<Record<string, string>>({});
  const saveTimer = useRef<number | null>(null);
  const activeSaveRef = useRef<Promise<boolean> | null>(null);
  const pendingSaveRef = useRef<PendingRemoteSave | null>(null);
  const currentRevisionRef = useRef(0);
  const inFlightRevisionRef = useRef<number | null>(null);
  const confirmedRevisionRef = useRef(0);
  const pendingRevisionRef = useRef<number | null>(null);
  const syncErrorRef = useRef<ReturnType<typeof getRemoteErrorDetails> | null>(null);
  const activeUserIdRef = useRef<string | null>(null);
  const bootStateRef = useRef<FinanceState | null>(null);
  const remoteLoadPendingRef = useRef(false);
  const backupInputRef = useRef<HTMLInputElement | null>(null);

  const selectedMonth = state.settings.selectedMonth || currentMonth();

  const clearAuthenticatedSession = () => {
    activeUserIdRef.current = null;
    remoteLoadPendingRef.current = false;
    currentRevisionRef.current = 0;
    confirmedRevisionRef.current = 0;
    pendingRevisionRef.current = null;
    setRemoteReady(false);
    setJournalBlocked(false);
    setUserId(null);
    setEmail(null);
    setDisplayName("");
    setDisplayNameDraft("");
    setProfileMessage("");
    setLastSavedAt(null);
    setPendingTransactionLabels({});
  };

  const runRemoteSave = useCallback((remoteUserId: string, remoteState: FinanceState, revision: number) => {
    if (
      activeSaveRef.current
      && inFlightRevisionRef.current === revision
      && pendingRevisionRef.current === null
    ) {
      return activeSaveRef.current;
    }

    pendingSaveRef.current = { userId: remoteUserId, state: remoteState, revision };
    pendingRevisionRef.current = revision;

    if (activeSaveRef.current) return activeSaveRef.current;

    const drainPromise = (async () => {
      let latestSaveSucceeded = false;

      while (pendingSaveRef.current) {
        const request = pendingSaveRef.current;
        pendingSaveRef.current = null;
        pendingRevisionRef.current = null;
        inFlightRevisionRef.current = request.revision;
        setSyncState("syncing");
        setStatus("Salvando online...");

        try {
          await saveRemoteState(request.userId, request.state);
          latestSaveSucceeded = true;
          saveUserLocalConfirmed(request.userId, request.state, request.revision);

          if (activeUserIdRef.current === request.userId) {
            confirmedRevisionRef.current = request.revision;
            setLastSavedAt(formatSaveTime());

            if (
              confirmedRevisionRef.current === currentRevisionRef.current
              && !pendingSaveRef.current
              && !hasPendingDeletes(request.userId)
            ) {
              setPendingTransactionLabels({});
              setSyncError(null);
              syncErrorRef.current = null;
              setShowSyncDetails(false);
              setSyncState("online");
              setStatus("Online Supabase");
            } else {
              setSyncState("syncing");
              setStatus("Salvando online...");
            }
          }
        } catch (error) {
          latestSaveSucceeded = false;
          const errorDetails = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
          if (activeUserIdRef.current === request.userId) {
            if (isCorruptDeletionJournal(error)) setJournalBlocked(true);
            syncErrorRef.current = errorDetails;
            setSyncError(errorDetails);
            setSyncState("error");
            setStatus("Erro de sincronização");
          }
        } finally {
          inFlightRevisionRef.current = null;
        }
      }

      activeSaveRef.current = null;
      return latestSaveSucceeded
        && confirmedRevisionRef.current === currentRevisionRef.current;
    })();

    activeSaveRef.current = drainPromise;
    void drainPromise.finally(() => {
      if (activeSaveRef.current === drainPromise) activeSaveRef.current = null;
    });
    return drainPromise;
  }, []);

  const applyBootState = useCallback((
    remoteUserId: string,
    remoteEmail: string | null,
    nextState: FinanceState,
    currentRevision: number,
    confirmedRevision: number,
  ) => {
    activeUserIdRef.current = remoteUserId;
    currentRevisionRef.current = Math.max(currentRevision, confirmedRevision);
    confirmedRevisionRef.current = confirmedRevision;
    bootStateRef.current = nextState;
    setState(nextState);
    setUserId(remoteUserId);
    setEmail(remoteEmail);
    setRemoteReady(true);
  }, []);

  const retryRemoteLoad = useCallback(async (remoteUserId: string) => {
    if (activeUserIdRef.current !== remoteUserId) return false;
    setSyncState("syncing");
    setStatus("Carregando dados online...");
    try {
      const remote = await loadRemoteState(remoteUserId);
      if (activeUserIdRef.current !== remoteUserId) return false;
      const revision = Math.max(currentRevisionRef.current, confirmedRevisionRef.current, 1);
      saveUserLocalConfirmed(remoteUserId, remote, revision);
      currentRevisionRef.current = revision;
      confirmedRevisionRef.current = revision;
      bootStateRef.current = remote;
      remoteLoadPendingRef.current = false;
      setState(remote);
      setRemoteReady(true);
      setSyncError(null);
      syncErrorRef.current = null;
      if (hasPendingDeletes(remoteUserId)) {
        setSyncState('syncing');
        setStatus('Sincronizando exclusões pendentes...');
        void runRemoteSave(remoteUserId, remote, revision);
      } else {
        setSyncState("online");
        setStatus("Online Supabase");
      }
      return true;
    } catch (error) {
      if (activeUserIdRef.current !== remoteUserId) return false;
      if (isCorruptDeletionJournal(error)) setJournalBlocked(true);
      const errorDetails = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
      remoteLoadPendingRef.current = true;
      syncErrorRef.current = errorDetails;
      setSyncError(errorDetails);
      setSyncState("error");
      setStatus("Erro de sincronização");
      return false;
    }
  }, [runRemoteSave]);

  useEffect(() => {
    async function initializeAuthenticatedSession(session: { user: { id: string; email?: string } }) {
      const remoteUserId = session.user.id;
      const remoteEmail = session.user.email || null;
      activeUserIdRef.current = remoteUserId;
      setRemoteReady(false);
      setJournalBlocked(false);
      setStatus("Carregando dados online...");
      setLastSavedAt(null);
      setSaveError(null);

      let local: FinanceState | null;
      try {
        local = loadUserLocalState(remoteUserId);
      } catch (error) {
        applyBootState(remoteUserId, remoteEmail, emptyState(), 1, 0);
        if (isCorruptDeletionJournal(error)) {
          setJournalBlocked(true);
          setRemoteReady(false);
        }
        const details = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
        syncErrorRef.current = details;
        setSyncError(details);
        setSyncState('error');
        setStatus('Erro de sincronização');
        return;
      }
      const metadata = loadUserSyncMetadata(remoteUserId);
      const confirmedRevision = metadata?.confirmedRevision || 0;
      const localRevision = Math.max(metadata?.localRevision || 0, confirmedRevision);

      void loadProfile(remoteUserId).then((profile) => {
        if (activeUserIdRef.current === remoteUserId) {
          setDisplayName(profile.displayName);
          setDisplayNameDraft(profile.displayName);
        }
      }).catch(() => {
        // Profile failure must not replace or discard the financial backup.
      });

      if (local && metadata?.dirty) {
        const dirtyRevision = Math.max(localRevision, confirmedRevision + 1, 1);
        saveUserLocalDirty(remoteUserId, local, dirtyRevision, confirmedRevision);
        remoteLoadPendingRef.current = false;
        applyBootState(remoteUserId, remoteEmail, local, dirtyRevision, confirmedRevision);
        setSyncState("syncing");
        setStatus("Sincronizando alterações pendentes...");
        void runRemoteSave(remoteUserId, local, dirtyRevision);
        return;
      }

      try {
        const remote = await loadRemoteState(remoteUserId);
        if (activeUserIdRef.current !== remoteUserId) return;
        const revision = Math.max(localRevision, confirmedRevision, 1);
        if (!migrateLegacyLocalStateForUser(remoteUserId, remote, revision)) {
          saveUserLocalConfirmed(remoteUserId, remote, revision);
        }
        remoteLoadPendingRef.current = false;
        applyBootState(remoteUserId, remoteEmail, remote, revision, revision);
        setSyncError(null);
        syncErrorRef.current = null;
        if (hasPendingDeletes(remoteUserId)) {
          setSyncState('syncing');
          setStatus('Sincronizando exclusões pendentes...');
          void runRemoteSave(remoteUserId, remote, revision);
        } else {
          setSyncState("online");
          setStatus("Online Supabase");
        }
      } catch (error) {
        if (activeUserIdRef.current !== remoteUserId) return;
        const fallback = local || emptyState();
        const revision = Math.max(localRevision, confirmedRevision, 1);
        let failure = error;
        if (!local) {
          try { saveUserLocalConfirmed(remoteUserId, fallback, revision); }
          catch (backupError) { failure = backupError; }
        }
        applyBootState(remoteUserId, remoteEmail, fallback, revision, revision);
        if (isCorruptDeletionJournal(failure)) {
          setJournalBlocked(true);
          setRemoteReady(false);
        }
        const errorDetails = { ...getRemoteErrorDetails(failure), timestamp: new Date().toISOString() };
        remoteLoadPendingRef.current = true;
        syncErrorRef.current = errorDetails;
        setSyncError(errorDetails);
        setSyncState("error");
        setStatus("Erro de sincronização");
      }
    }

    async function boot() {
      if (!supabase) return;
      const { data } = await supabase.auth.getSession();
      const session = data.session;
      if (session?.user?.id) {
        await initializeAuthenticatedSession(session);
      } else {
        clearAuthenticatedSession();
        setSaveError(null);
        setStatus("Aguardando login");
      }
      const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
        if (session?.user?.id) {
          void initializeAuthenticatedSession(session);
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
  }, [applyBootState, runRemoteSave]);

  useEffect(() => {
    if (!supabase) {
      saveLocalState(state);
      return;
    }

    if (!userId || !remoteReady || journalBlocked) return;

    if (bootStateRef.current) {
      if (bootStateRef.current === state) bootStateRef.current = null;
      return;
    }

    currentRevisionRef.current += 1;
    const revision = currentRevisionRef.current;
    try {
      saveUserLocalDirty(userId, state, revision, confirmedRevisionRef.current);
    } catch (error) {
      if (isCorruptDeletionJournal(error)) setJournalBlocked(true);
      const details = getRemoteErrorDetails(error);
      syncErrorRef.current = details;
      setSyncError(details);
      setSyncState('error');
      setStatus('Erro de sincronização');
      return;
    }
    setSyncState(syncErrorRef.current ? "error" : "syncing");


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
      void runRemoteSave(userId, state, revision);
    }, 800);

    return () => {
      if (saveTimer.current) {
        window.clearTimeout(saveTimer.current);
      }
    };
  }, [state, userId, remoteReady, journalBlocked, runRemoteSave]);

  useEffect(() => {
    const retryWhenOnline = () => {
      if (!userId || !remoteReady || journalBlocked) return;
      if (remoteLoadPendingRef.current) {
        void retryRemoteLoad(userId);
      } else if (confirmedRevisionRef.current !== currentRevisionRef.current || hasPendingDeletes(userId)) {
        void runRemoteSave(userId, state, currentRevisionRef.current);
      }
    };

    window.addEventListener("online", retryWhenOnline);
    return () => window.removeEventListener("online", retryWhenOnline);
  }, [journalBlocked, remoteReady, retryRemoteLoad, runRemoteSave, state, userId]);

  const updateState = useCallback(
    (updater: (prev: FinanceState) => FinanceState) =>
      setState((prev) => normalizeState(updater(prev))),
    [],
  );

  const removeSavedItem = useCallback((table: 'installments' | 'investments' | 'budgets', id: string) => {
    if (supabase && userId) {
      try {
        recordPendingDelete(userId, table, id);
        setSyncState('syncing');
        setStatus('Excluindo online...');
      } catch (error) {
        const details = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
        syncErrorRef.current = details;
        setSyncError(details);
        setSyncState('error');
        setStatus('Erro de sincronização');
        setSaveError(details.message);
        return;
      }
    }
    updateState((previous) => ({
      ...previous,
      [table]: previous[table].filter((item) => item.id !== id),
    }));
  }, [updateState, userId]);

  const removeTransaction = useCallback(async (transactionId: string) => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    try {
      if (supabase && userId) recordPendingDelete(userId, 'transactions', transactionId);
    } catch (error) {
      console.error(error);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir o lançamento online.",
      );
      setStatus("Erro ao excluir lançamento");
      const details = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
      syncErrorRef.current = details;
      setSyncError(details);
      setSyncState('error');
      throw error;
    }
    if (supabase && userId) {
      setSyncState('syncing');
      setStatus('Sincronizando exclusões pendentes...');
      const label = state.transactions.find((item) => item.id === transactionId)?.description;
      if (label) setPendingTransactionLabels((current) => ({ ...current, [transactionId]: label }));
    }
    updateState((previous) => ({
      ...previous,
      transactions: previous.transactions.filter((transaction) => transaction.id !== transactionId),
    }));
    if (supabase && userId && remoteReady) {
      try {
        await deleteRemoteTransaction(userId, transactionId);
        setPendingTransactionLabels((current) => {
          const next = { ...current };
          delete next[transactionId];
          return next;
        });
      } catch (error) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        const details = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
        syncErrorRef.current = details;
        setSyncError(details);
        setSyncState('error');
        setStatus('Erro de sincronização');
        setSaveError(details.message);
        throw error;
      }
    }
  }, [remoteReady, state.transactions, updateState, userId]);

  const removeFutureBill = useCallback(async (billId: string) => {
    if (saveTimer.current) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    try {
      if (supabase && userId) recordPendingDelete(userId, 'future_bills', billId);
    } catch (error) {
      console.error(error);
      setSaveError(
        error instanceof Error
          ? error.message
          : "Não foi possível excluir a conta futura online.",
      );
      setStatus("Erro ao excluir conta futura");
      const details = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
      syncErrorRef.current = details;
      setSyncError(details);
      setSyncState('error');
      throw error;
    }
    if (supabase && userId) {
      setSyncState('syncing');
      setStatus('Sincronizando exclusões pendentes...');
    }
    updateState((previous) => ({
      ...previous,
      bills: previous.bills.filter((bill) => bill.id !== billId),
    }));
    if (supabase && userId && remoteReady) {
      try { await deleteRemoteFutureBill(userId, billId); }
      catch (error) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        const details = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
        syncErrorRef.current = details;
        setSyncError(details);
        setSyncState('error');
        setStatus('Erro de sincronização');
        setSaveError(details.message);
        throw error;
      }
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
      if (supabase && userId) {
        recordPendingSeriesDelete(userId, seriesId.trim(), occurrenceNumber);
        // This slot may predate the delete and outlive its confirmation.
        const pending = pendingSaveRef.current;
        if (pending?.userId === userId) {
          pendingSaveRef.current = { ...pending, state: {
            ...pending.state,
            bills: pending.state.bills.filter((bill) => bill.seriesId !== seriesId.trim()
              || bill.occurrenceNumber === undefined || bill.occurrenceNumber < occurrenceNumber),
          } };
        }
      }
    } catch (error) {
      console.error(error);
      setSaveError(error instanceof Error ? error.message : "Não foi possível excluir as ocorrências online.");
      setStatus("Erro ao excluir contas futuras");
      const details = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
      syncErrorRef.current = details;
      setSyncError(details);
      setSyncState('error');
      throw error;
    }
    if (supabase && userId) {
      setSyncState('syncing');
      setStatus('Sincronizando exclusões pendentes...');
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
      try { await deleteRemoteFutureBillsFrom(userId, seriesId, occurrenceNumber); }
      catch (error) {
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        const details = { ...getRemoteErrorDetails(error), timestamp: new Date().toISOString() };
        syncErrorRef.current = details;
        setSyncError(details);
        setSyncState('error');
        setStatus('Erro de sincronização');
        setSaveError(details.message);
        throw error;
      }
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
        try {
          await withTimeout(
            runRemoteSave(userId, state, currentRevisionRef.current),
            5000,
            "Tempo limite ao salvar antes de sair. Backup local mantido neste navegador.",
          );
        } catch (error) {
          const errorDetails = {
            message: error instanceof Error
              ? error.message
              : "Não foi possível sincronizar antes de sair.",
            timestamp: new Date().toISOString(),
          };
          syncErrorRef.current = errorDetails;
          setSyncError(errorDetails);
          setSyncState("error");
        }
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

      if (userId) cleanupConfirmedSyncMetadataOnLogout(userId);
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

  const pendingSync = userId ? (() => {
    try { return hasPendingDeletes(userId); }
    catch { return true; }
  })() : false;
  const syncLabel = pendingSync && syncState === 'error' ? 'Erro de sincronização · alterações pendentes'
    : pendingSync ? 'Alterações pendentes' : ({
    "local-only": "Salvo localmente",
    syncing: "Sincronizando…",
    online: "Online Supabase",
    error: "Erro de sincronização",
  }[syncState]);
  const syncStatus = syncLabel;
  const syncTone = syncState === "error" ? "error" : syncState === "syncing" ? "syncing" : "ready";
  const SyncIcon = syncState === "error" ? AlertCircle : syncState === "syncing" ? LoaderCircle : CheckCircle2;
  const retrySync = () => {
    if (userId && remoteReady && !journalBlocked) {
      if (remoteLoadPendingRef.current) void retryRemoteLoad(userId);
      else void runRemoteSave(userId, state, currentRevisionRef.current);
    }
  };
    if (isSupabaseConfigured && !userId) {
      return <AuthScreen />;
    }
  if (journalBlocked) {
    return <main className="app-shell"><section role="alert" title="Erro de sincronização">
      <h1>Diário de exclusões corrompido</h1>
      <p>A sincronização está bloqueada. Recupere o diário para carregar os dados online. O conteúdo corrompido será preservado em :corrupt; exclusões não confirmadas precisarão ser revisadas.</p>
      {syncError && <p>{syncError.message}</p>}
      <button type="button" onClick={async () => {
        if (!userId) return;
        try {
          recoverCorruptDeletionJournal(userId);
          pendingSaveRef.current = null;
          if (await retryRemoteLoad(userId)) setJournalBlocked(false);
        } catch (error) {
          setSyncError(getRemoteErrorDetails(error));
        }
      }}>Preservar diário e recuperar dados online</button>
    </section></main>;
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
                {Object.keys(pendingTransactionLabels).length > 0 && (
                  <div aria-label="Lançamentos aguardando exclusão" className="sync-details">
                    <span>Exclusão pendente:</span>
                    {Object.entries(pendingTransactionLabels).map(([id, label]) => <span key={id}>{label}</span>)}
                  </div>
                )}
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
              onDeleteItem={(id) => removeSavedItem('installments', id)}
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
            <InvestmentsPage state={state} updateState={updateState} onDeleteItem={(id) => removeSavedItem('investments', id)} />
          )}
          {activePage === "budgets" && (
            <BudgetsPage
              state={state}
              updateState={updateState}
              month={selectedMonth}
              onDeleteItem={(id) => removeSavedItem('budgets', id)}
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
