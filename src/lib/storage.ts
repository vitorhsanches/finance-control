import type { Session } from '@supabase/supabase-js';
import type { Budget, CardRule, FinanceState, FutureBill, Installment, Investment, Settings, Transaction } from '../types';
import { emptyState, normalizeState, sampleState } from '../data/sample';
import { supabase } from './supabaseClient';

export { isSupabaseConfigured, supabase } from './supabaseClient';

export const LOCAL_STORAGE_KEY = 'finance-control-react-v3';
const LEGACY_LOCAL_STORAGE_KEY = 'finance-control-react-v1';
const USER_LOCAL_STORAGE_PREFIX = 'finance-control-react-v3:user:';
const USER_SYNC_METADATA_PREFIX = 'finance-control-sync-v1:user:';
const USER_PENDING_DELETES_PREFIX = 'finance-control-pending-deletes-v1:user:';
const DELETE_SESSION_KEY = 'finance-control-delete-session-v1';
export const LOCAL_SYNC_SCHEMA_VERSION = 1;
let remoteSaveQueue: Promise<void> = Promise.resolve();
class SessionOwnerError extends Error {}
const financialTables = ['transactions', 'installments', 'future_bills', 'investments', 'budgets'] as const;
export type FinancialTable = typeof financialTables[number];
type PendingIdDelete = { table: FinancialTable; id: string };
type PendingSeriesDelete = { table: 'future_bills'; userId: string; seriesId: string; fromOccurrence: number };
type PendingDelete = PendingIdDelete | PendingSeriesDelete;
const confirmedDeletes = new Map<string, Set<string>>();
let deleteSessionToken: string | null = null;

function ensureDeleteSession() {
  let token = localStorage.getItem(DELETE_SESSION_KEY);
  if (!token) {
    token = `${Date.now()}:${Math.random()}`;
    localStorage.setItem(DELETE_SESSION_KEY, token);
  }
  if (deleteSessionToken !== token) {
    confirmedDeletes.clear();
    deleteSessionToken = token;
  }
}

function deletionKey(table: FinancialTable, id: string) { return `${table}:${id}`; }
function pendingKey(userId: string) { return `${USER_PENDING_DELETES_PREFIX}${userStorageSuffix(userId)}`; }
function corruptPendingKey(userId: string) { return `${pendingKey(userId)}:corrupt`; }

export class CorruptDeletionJournalError extends Error {
  constructor() {
    super('Diário de exclusões pendentes corrompido; sincronização bloqueada.');
    this.name = 'CorruptDeletionJournalError';
  }
}

export function recoverCorruptDeletionJournal(userId: string): void {
  try { loadPendingDeletes(userId); }
  catch (error) {
    if (!(error instanceof CorruptDeletionJournalError)) throw error;
    const raw = localStorage.getItem(pendingKey(userId));
    if (raw === null) return;
    // Only release the journal after its exact contents are safely preserved.
    localStorage.setItem(corruptPendingKey(userId), raw);
    localStorage.removeItem(pendingKey(userId));
  }
}

export function loadPendingDeletes(userId: string): PendingDelete[] {
  const raw = localStorage.getItem(pendingKey(userId));
  if (raw === null) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value) || !value.every((entry) => {
      if (typeof entry !== 'object' || entry === null || !financialTables.includes(entry.table)) return false;
      if ('id' in entry) return typeof entry.id === 'string' && entry.id.length > 0;
      return entry.table === 'future_bills' && entry.userId === userId
        && typeof entry.seriesId === 'string' && entry.seriesId.length > 0
        && Number.isSafeInteger(entry.fromOccurrence) && entry.fromOccurrence >= 1;
    })) throw new Error('invalid journal');
    return value as PendingDelete[];
  } catch {
    try { localStorage.setItem(corruptPendingKey(userId), raw); } catch { /* preserve the original key */ }
    throw new CorruptDeletionJournalError();
  }
}

export function recordPendingDelete(userId: string, table: FinancialTable, id: string): void {
  ensureDeleteSession();
  if (!userId.trim() || !id.trim()) throw new Error('Identidade inválida para exclusão.');
  const pending = loadPendingDeletes(userId);
  if (pending.some((entry) => 'id' in entry && entry.table === table && entry.id === id)) return;
  localStorage.setItem(pendingKey(userId), JSON.stringify([...pending, { table, id }]));
}

export function recordPendingSeriesDelete(userId: string, seriesId: string, fromOccurrence: number): PendingSeriesDelete {
  ensureDeleteSession();
  const entry: PendingSeriesDelete = { table: 'future_bills', userId, seriesId, fromOccurrence };
  const pending = loadPendingDeletes(userId);
  if (!pending.some((item) => samePendingDelete(item, entry))) {
    localStorage.setItem(pendingKey(userId), JSON.stringify([...pending, entry]));
  }
  return entry;
}

function samePendingDelete(left: PendingDelete, right: PendingDelete) {
  if ('id' in left && 'id' in right) return left.table === right.table && left.id === right.id;
  if ('seriesId' in left && 'seriesId' in right) {
    return left.userId === right.userId && left.seriesId === right.seriesId
      && left.fromOccurrence === right.fromOccurrence;
  }
  return false;
}

function removePendingDelete(userId: string, entry: PendingDelete) {
  ensureDeleteSession();
  const remaining = loadPendingDeletes(userId).filter((item) => !samePendingDelete(item, entry));
  if (remaining.length) localStorage.setItem(pendingKey(userId), JSON.stringify(remaining));
  else localStorage.removeItem(pendingKey(userId));
  if ('id' in entry) {
    const deleted = confirmedDeletes.get(userId) || new Set<string>();
    deleted.add(deletionKey(entry.table, entry.id));
    confirmedDeletes.set(userId, deleted);
  }
}

function excludedIds(userId: string, table: FinancialTable): Set<string> {
  ensureDeleteSession();
  const ids = new Set(loadPendingDeletes(userId)
    .filter((entry): entry is PendingIdDelete => 'id' in entry && entry.table === table)
    .map((entry) => entry.id));
  for (const key of confirmedDeletes.get(userId) || []) {
    if (key.startsWith(`${table}:`)) ids.add(key.slice(table.length + 1));
  }
  return ids;
}

function excludedSeries(userId: string): PendingSeriesDelete[] {
  ensureDeleteSession();
  return loadPendingDeletes(userId).filter((entry): entry is PendingSeriesDelete => 'seriesId' in entry);
}

function seriesCovers(series: PendingSeriesDelete[], item: { seriesId?: string | null; occurrenceNumber?: number | null }) {
  return series.some((entry) => item.seriesId === entry.seriesId
    && typeof item.occurrenceNumber === 'number' && item.occurrenceNumber >= entry.fromOccurrence);
}

function withoutExcluded(userId: string, state: FinanceState): FinanceState {
  const excluded = Object.fromEntries(financialTables.map((table) => [table, excludedIds(userId, table)])) as Record<FinancialTable, Set<string>>;
  const series = excludedSeries(userId);
  return { ...state,
    transactions: state.transactions.filter((item) => !excluded.transactions.has(item.id)),
    installments: state.installments.filter((item) => !excluded.installments.has(item.id)),
    bills: state.bills.filter((item) => !excluded.future_bills.has(item.id) && !seriesCovers(series, item)),
    investments: state.investments.filter((item) => !excluded.investments.has(item.id)),
    budgets: state.budgets.filter((item) => !excluded.budgets.has(item.id)),
  };
}

export type LocalSyncMetadata = {
  userId: string;
  localRevision: number;
  confirmedRevision: number;
  dirty: boolean;
  updatedAt: string;
  lastConfirmedAt: string | null;
  schemaVersion: number;
};

export type RemoteOperation = 'select' | 'upsert' | 'delete' | 'insert';

export type RemoteErrorDetails = {
  table?: string;
  operation?: RemoteOperation;
  code?: string;
  message: string;
  details?: string;
  hint?: string;
  status?: number;
  timestamp?: string;
};

export class RemoteSaveError extends Error {
  readonly details: RemoteErrorDetails;

  constructor(details: RemoteErrorDetails) {
    super(details.message);
    this.name = 'RemoteSaveError';
    this.details = details;
  }
}

export function getRemoteErrorDetails(error: unknown): RemoteErrorDetails {
  if (error instanceof RemoteSaveError) return error.details;
  if (error instanceof Error) return { message: error.message };
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return { message: error.message };
  }
  return { message: 'Erro remoto desconhecido.' };
}
export function loadLocalState(): FinanceState {
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY) || localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
  if (!raw) return sampleState();
  try {
    return normalizeState(JSON.parse(raw));
  } catch {
    return sampleState();
  }
}

export function saveLocalState(state: FinanceState) {
  localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(state));
}

function userStorageSuffix(userId: string) {
  return encodeURIComponent(userId.trim());
}

export function getUserLocalStateKey(userId: string) {
  return `${USER_LOCAL_STORAGE_PREFIX}${userStorageSuffix(userId)}`;
}

export function getUserSyncMetadataKey(userId: string) {
  return `${USER_SYNC_METADATA_PREFIX}${userStorageSuffix(userId)}`;
}

export function loadUserLocalState(userId: string): FinanceState | null {
  loadPendingDeletes(userId);
  const raw = localStorage.getItem(getUserLocalStateKey(userId));
  if (!raw) return null;
  try {
    return withoutExcluded(userId, normalizeState(JSON.parse(raw)));
  } catch (error) {
    if (error instanceof CorruptDeletionJournalError) throw error;
    return null;
  }
}

export function loadUserSyncMetadata(userId: string): LocalSyncMetadata | null {
  const raw = localStorage.getItem(getUserSyncMetadataKey(userId));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LocalSyncMetadata>;
    if (
      parsed.userId !== userId
      || parsed.schemaVersion !== LOCAL_SYNC_SCHEMA_VERSION
      || typeof parsed.localRevision !== 'number'
      || typeof parsed.confirmedRevision !== 'number'
      || typeof parsed.dirty !== 'boolean'
      || typeof parsed.updatedAt !== 'string'
      || !(typeof parsed.lastConfirmedAt === 'string' || parsed.lastConfirmedAt === null)
    ) return null;

    return {
      userId,
      localRevision: Math.max(0, Math.floor(parsed.localRevision)),
      confirmedRevision: Math.max(0, Math.floor(parsed.confirmedRevision)),
      dirty: parsed.dirty,
      updatedAt: parsed.updatedAt,
      lastConfirmedAt: parsed.lastConfirmedAt,
      schemaVersion: LOCAL_SYNC_SCHEMA_VERSION,
    };
  } catch {
    return null;
  }
}

export function cleanupConfirmedSyncMetadataOnLogout(userId: string): void {
  // Keep dirty recovery metadata, pending deletes, and corrupt journals for the next login.
  try {
    if (loadPendingDeletes(userId).length || loadUserSyncMetadata(userId)?.dirty) return;
  } catch {
    return;
  }
  localStorage.removeItem(getUserSyncMetadataKey(userId));
}

export function saveUserLocalDirty(
  userId: string,
  state: FinanceState,
  localRevision: number,
  confirmedRevision: number,
): LocalSyncMetadata {
  const previous = loadUserSyncMetadata(userId);
  const metadata: LocalSyncMetadata = {
    userId,
    localRevision: Math.max(0, Math.floor(localRevision)),
    confirmedRevision: Math.max(0, Math.floor(confirmedRevision)),
    dirty: true,
    updatedAt: new Date().toISOString(),
    lastConfirmedAt: previous?.lastConfirmedAt || null,
    schemaVersion: LOCAL_SYNC_SCHEMA_VERSION,
  };
  localStorage.setItem(getUserSyncMetadataKey(userId), JSON.stringify(metadata));
  localStorage.setItem(getUserLocalStateKey(userId), JSON.stringify(normalizeState(withoutExcluded(userId, state))));
  return metadata;
}

export function saveUserLocalConfirmed(
  userId: string,
  state: FinanceState,
  revision: number,
): LocalSyncMetadata {
  const now = new Date().toISOString();
  const normalizedRevision = Math.max(0, Math.floor(revision));
  const previous = loadUserSyncMetadata(userId);
  if (previous && previous.localRevision > normalizedRevision) {
    const metadata: LocalSyncMetadata = {
      ...previous,
      confirmedRevision: Math.max(previous.confirmedRevision, normalizedRevision),
      dirty: true,
      lastConfirmedAt: now,
      schemaVersion: LOCAL_SYNC_SCHEMA_VERSION,
    };
    localStorage.setItem(getUserSyncMetadataKey(userId), JSON.stringify(metadata));
    return metadata;
  }

  localStorage.setItem(getUserLocalStateKey(userId), JSON.stringify(normalizeState(withoutExcluded(userId, state))));
  const metadata: LocalSyncMetadata = {
    userId,
    localRevision: normalizedRevision,
    confirmedRevision: normalizedRevision,
    dirty: false,
    updatedAt: now,
    lastConfirmedAt: now,
    schemaVersion: LOCAL_SYNC_SCHEMA_VERSION,
  };
  localStorage.setItem(getUserSyncMetadataKey(userId), JSON.stringify(metadata));
  return metadata;
}

export function migrateLegacyLocalStateForUser(
  userId: string,
  remoteState: FinanceState,
  revision: number,
): boolean {
  if (loadUserLocalState(userId) || loadUserSyncMetadata(userId)) return false;
  const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
  if (!raw) return false;
  try {
    const legacy = normalizeState(JSON.parse(raw));
    const remote = normalizeState(remoteState);
    if (JSON.stringify(legacy) !== JSON.stringify(remote)) return false;
    saveUserLocalConfirmed(userId, legacy, revision);
    return true;
  } catch {
    return false;
  }
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) return null;
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function loadProfile(userId: string): Promise<{ displayName: string }> {
  if (!supabase) return { displayName: '' };

  const { data, error } = await supabase
    .from('profiles')
    .select('display_name')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;

  return {
    displayName: data?.display_name || ''
  };
}

export async function saveProfile(userId: string, displayName: string) {
  if (!supabase) return;

  await throwIfError(
    supabase.from('profiles').upsert({
      user_id: userId,
      display_name: displayName.trim() || null,
      updated_at: new Date().toISOString()
    })
  );
}



export async function loadRemoteState(userId: string): Promise<FinanceState> {
  if (!supabase) return loadLocalState();

  await enqueuePendingDeletes(userId);

  const { data: settingsRow, error: settingsError } = await supabase
    .from('app_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (settingsError) throw settingsError;

  if (!settingsRow) {
    const migrated = await tryLoadLegacyFinanceState(userId);
    const initial = withDefaultCatalogs(migrated || emptyState());
    await saveRemoteState(userId, initial);
    return initial;
  }

  const [
    categoriesRes,
    accountsRes,
    cardsRes,
    paymentMethodsRes,
    cardRulesRes,
    transactionsRes,
    installmentsRes,
    billsRes,
    investmentsRes,
    budgetsRes
  ] = await Promise.all([
    supabase.from('categories').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
    supabase.from('accounts').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
    supabase.from('cards').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
    supabase.from('payment_methods').select('*').eq('user_id', userId).order('sort_order', { ascending: true }),
    supabase.from('card_rules').select('*').eq('user_id', userId).order('card_name', { ascending: true }),
    supabase.from('transactions').select('*').eq('user_id', userId).order('date', { ascending: false }),
    supabase.from('installments').select('*').eq('user_id', userId).order('purchase_date', { ascending: false }),
    supabase.from('future_bills').select('*').eq('user_id', userId).order('due_date', { ascending: true }),
    supabase.from('investments').select('*').eq('user_id', userId).order('created_at', { ascending: true }),
    supabase.from('budgets').select('*').eq('user_id', userId).order('month', { ascending: false })
  ]);

  const errors = [
    categoriesRes.error,
    accountsRes.error,
    cardsRes.error,
    paymentMethodsRes.error,
    cardRulesRes.error,
    transactionsRes.error,
    installmentsRes.error,
    billsRes.error,
    investmentsRes.error,
    budgetsRes.error
  ].filter(Boolean);

  if (errors.length) throw errors[0];

const defaultSettings = sampleState().settings;

const expenseCategories = (categoriesRes.data || [])
  .filter((row) => row.kind === 'expense')
  .map((row) => row.name)
  .filter(Boolean);

const incomeCategories = (categoriesRes.data || [])
  .filter((row) => row.kind === 'income')
  .map((row) => row.name)
  .filter(Boolean);

const accounts = (accountsRes.data || [])
  .map((row) => row.name)
  .filter(Boolean);

const cards = (cardsRes.data || [])
  .map((row) => row.name)
  .filter(Boolean);

const paymentMethods = (paymentMethodsRes.data || [])
  .map((row) => row.name)
  .filter(Boolean);

const cardRules = (cardRulesRes.data || []).map((row): CardRule => ({
  cardName: row.card_name,
  closingDay: Number(row.closing_day || 1),
  dueDay: Number(row.due_day || 1)
}));

  const settings: Settings = {
    currency: settingsRow.currency || 'BRL',
    selectedMonth: settingsRow.selected_month,
    startingBalance: Number(settingsRow.starting_balance || 0),
    monthlyIncomeEstimate: Number(settingsRow.monthly_income_estimate || 0),
    monthlySavingGoal: Number(settingsRow.monthly_saving_goal || 0),
    emergencyContribution: Number(settingsRow.emergency_contribution || 0),

    categories: expenseCategories.length > 0
      ? expenseCategories
      : defaultSettings.categories,

    incomeCategories: incomeCategories.length > 0
      ? incomeCategories
      : defaultSettings.incomeCategories,

    accounts: accounts.length > 0
      ? accounts
      : defaultSettings.accounts,

    cards: cards.length > 0
      ? cards
      : defaultSettings.cards,

    paymentMethods: paymentMethods.length > 0
      ? paymentMethods
      : defaultSettings.paymentMethods,

    cardRules: cardRules.length > 0
      ? cardRules
      : defaultSettings.cardRules,

    importProfiles: defaultSettings.importProfiles || [],
  };

  const remoteState: FinanceState = {
    settings,
    transactions: (transactionsRes.data || []).map(rowToTransaction),
    installments: (installmentsRes.data || []).map(rowToInstallment),
    bills: (billsRes.data || []).map(rowToBill),
    investments: (investmentsRes.data || []).map(rowToInvestment),
    budgets: (budgetsRes.data || []).map(rowToBudget)
  };

  return withDefaultCatalogs(withoutExcluded(userId, remoteState));
}

export function saveRemoteState(userId: string, state: FinanceState): Promise<void> {
  const snapshot = withoutExcluded(userId, normalizeState(JSON.parse(JSON.stringify(state)) as FinanceState));
  ensureDeleteSession();
  const queuedSave = remoteSaveQueue.then(() => persistRemoteState(userId, snapshot));

  remoteSaveQueue = queuedSave.catch(() => undefined);

  return queuedSave;
}

export function deleteRemoteTransaction(userId: string, transactionId: string): Promise<void> {
  if (!supabase) return Promise.resolve();
  recordPendingDelete(userId, 'transactions', transactionId);
  return enqueueExplicitDelete(userId, 'transactions', transactionId);
}

export function deleteRemoteFutureBill(userId: string, billId: string): Promise<void> {
  if (!supabase) return Promise.resolve();
  recordPendingDelete(userId, 'future_bills', billId);
  return enqueueExplicitDelete(userId, 'future_bills', billId);
}

export function deleteRemoteFutureBillsFrom(
  userId: string,
  seriesId: string,
  occurrenceNumber: number,
): Promise<void> {
  const normalizedUserId = userId.trim();
  const normalizedSeriesId = seriesId.trim();
  const normalizedOccurrenceNumber = Math.floor(occurrenceNumber);

  if (!normalizedUserId || !normalizedSeriesId || !Number.isSafeInteger(occurrenceNumber) || normalizedOccurrenceNumber < 1) {
    return Promise.reject(new Error('Identidade de recorrência inválida para exclusão.'));
  }

  if (!supabase) return Promise.resolve();
  const client = supabase;
  const entry = recordPendingSeriesDelete(normalizedUserId, normalizedSeriesId, normalizedOccurrenceNumber);
  const queuedDelete = remoteSaveQueue.then(async () => {
    await assertSessionOwner(client, normalizedUserId);
    await executeRemoteRequest('future_bills', 'delete', client.from('future_bills').delete()
      .eq('user_id', normalizedUserId).eq('series_id', normalizedSeriesId)
      .gte('occurrence_number', normalizedOccurrenceNumber));
    await assertSessionOwner(client, normalizedUserId);
    removePendingDelete(normalizedUserId, entry);
  });
  remoteSaveQueue = queuedDelete.catch(() => undefined);
  return queuedDelete;
}

function enqueuePendingDeletes(userId: string): Promise<void> {
  const queued = remoteSaveQueue.then(() => flushPendingDeletes(userId));
  remoteSaveQueue = queued.catch(() => undefined);
  return queued;
}

function enqueueExplicitDelete(userId: string, table: FinancialTable, id: string): Promise<void> {
  const queued = remoteSaveQueue.then(async () => {
    const client = supabase;
    if (!client) return;
    await assertSessionOwner(client, userId);
    await executeRemoteRequest(table, 'delete', client.from(table).delete().eq('user_id', userId).eq('id', id));
    await assertSessionOwner(client, userId);
    removePendingDelete(userId, { table, id });
  });
  remoteSaveQueue = queued.catch(() => undefined);
  return queued;
}

async function flushPendingDeletes(userId: string): Promise<void> {
  if (!supabase) return;
  const client = supabase;
  const pending = loadPendingDeletes(userId);
  if (!pending.length) return;
  await assertSessionOwner(client, userId);
  let firstDeleteError: unknown;
  for (const entry of pending) {
    try {
      if ('id' in entry) {
        await executeRemoteRequest(entry.table, 'delete', client.from(entry.table).delete()
          .eq('user_id', userId).eq('id', entry.id));
      } else {
        await executeRemoteRequest('future_bills', 'delete', client.from('future_bills').delete()
          .eq('user_id', userId).eq('series_id', entry.seriesId)
          .gte('occurrence_number', entry.fromOccurrence));
      }
      await assertSessionOwner(client, userId);
      removePendingDelete(userId, entry);
    } catch (error) {
      if (error instanceof SessionOwnerError) throw error;
      if (!firstDeleteError) firstDeleteError = error;
    }
  }
  if (firstDeleteError) throw firstDeleteError;
}

async function assertSessionOwner(client: NonNullable<typeof supabase>, userId: string) {
  const { data } = await client.auth.getSession();
  if (data.session?.user?.id !== userId) {
    throw new SessionOwnerError('Sessão alterada antes de concluir exclusões pendentes.');
  }
}

async function persistRemoteState(userId: string, state: FinanceState) {
  if (!supabase) return;
  await assertSessionOwner(supabase, userId);
  const normalized = normalizeState(withoutExcluded(userId, state));

  await preventUnsafeEmptyCollectionOverwrites(userId, normalized);
  let deleteError: unknown;
  try {
    await flushPendingDeletes(userId);
  } catch (error) {
    if (error instanceof SessionOwnerError) throw error;
    deleteError = error;
  }
  await assertSessionOwner(supabase, userId);
  await preventUnsafeCatalogOverwrite(userId, normalized);

  await executeRemoteRequest('profiles', 'upsert', supabase.from('profiles').upsert({ user_id: userId, updated_at: new Date().toISOString() }));

  await executeRemoteRequest('app_settings', 'upsert', supabase.from('app_settings').upsert({
    user_id: userId,
    currency: normalized.settings.currency,
    selected_month: normalized.settings.selectedMonth,
    starting_balance: normalized.settings.startingBalance,
    monthly_income_estimate: normalized.settings.monthlyIncomeEstimate,
    monthly_saving_goal: normalized.settings.monthlySavingGoal,
    emergency_contribution: normalized.settings.emergencyContribution,
    updated_at: new Date().toISOString()
  }));

  async function preventUnsafeEmptyCollectionOverwrites(userId: string, state: FinanceState) {
    if (!supabase) return;

    const collections = [
      { tableName: 'transactions', label: 'lançamentos', localCount: state.transactions.length },
      { tableName: 'installments', label: 'parcelamentos', localCount: state.installments.length },
      { tableName: 'future_bills', label: 'contas futuras', localCount: state.bills.length },
      { tableName: 'investments', label: 'investimentos', localCount: state.investments.length },
      { tableName: 'budgets', label: 'orçamentos', localCount: state.budgets.length }
    ];

    for (const collection of collections) {
      if (collection.localCount > 0) continue;

      const { count: totalCount } = await executeRemoteRequest(
        collection.tableName,
        'select',
        supabase.from(collection.tableName).select('id', { count: 'exact', head: true }).eq('user_id', userId)
      );
      if (totalCount === null || totalCount === undefined) {
        throw new Error(`Salvamento bloqueado: não foi possível contar ${collection.label} remotos.`);
      }
      if (totalCount === 0) continue;
      const covered = excludedIds(userId, collection.tableName as FinancialTable);
      const series = collection.tableName === 'future_bills' ? excludedSeries(userId) : [];
      let uncoveredCount = totalCount;

      if (totalCount <= 1000) {
        // The exact count bounds this compatibility query; a truncated response fails closed.
        const columns = collection.tableName === 'future_bills' ? 'id,series_id,occurrence_number' : 'id';
        const { data } = await executeRemoteRequest(collection.tableName, 'select',
          supabase.from(collection.tableName).select(columns).eq('user_id', userId));
        const rows = Array.isArray(data)
          ? data as unknown as Array<{ id: string; series_id?: string; occurrence_number?: number }>
          : [];
        uncoveredCount = rows.length < totalCount ? 1 : rows.filter((row) => !covered.has(row.id)
          && !seriesCovers(series, { seriesId: row.series_id, occurrenceNumber: row.occurrence_number })).length;
      } else {
        const ids = [...covered];
        const idFilter = `(${ids.map((id) => `"${id.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(',')})`;
        const batches: string[][] = [];
        for (let index = 0; index < ids.length; index += 100) batches.push(ids.slice(index, index + 100));
        if (ids.length <= 100) {
          let query = supabase.from(collection.tableName).select('id', { count: 'exact', head: true }).eq('user_id', userId);
          if (ids.length) query = query.not('id', 'in', idFilter);
          const result = await executeRemoteRequest(collection.tableName, 'select', query);
          if (result.count === null || result.count === undefined) throw new Error('Contagem remota indisponível.');
          uncoveredCount = result.count;
        } else {
          for (const batch of batches) {
            const result = await executeRemoteRequest(collection.tableName, 'select',
              supabase.from(collection.tableName).select('id', { count: 'exact', head: true })
                .eq('user_id', userId).in('id', batch));
            if (result.count === null || result.count === undefined) throw new Error('Contagem remota indisponível.');
            uncoveredCount -= result.count;
          }
        }

        if (series.length) {
          const starts = new Map<string, number>();
          for (const entry of series) starts.set(entry.seriesId,
            Math.min(starts.get(entry.seriesId) ?? entry.fromOccurrence, entry.fromOccurrence));
          for (const [seriesId, fromOccurrence] of starts) {
            let seriesQuery = supabase.from('future_bills').select('id', { count: 'exact', head: true })
              .eq('user_id', userId).eq('series_id', seriesId).gte('occurrence_number', fromOccurrence);
            if (ids.length && ids.length <= 100) seriesQuery = seriesQuery.not('id', 'in', idFilter);
            const result = await executeRemoteRequest(collection.tableName, 'select', seriesQuery);
            if (result.count === null || result.count === undefined) throw new Error('Contagem remota indisponível.');
            let seriesCount = result.count;
            for (const batch of ids.length > 100 ? batches : []) {
              const overlap = await executeRemoteRequest(collection.tableName, 'select',
                supabase.from('future_bills').select('id', { count: 'exact', head: true })
                  .eq('user_id', userId).eq('series_id', seriesId).gte('occurrence_number', fromOccurrence)
                  .in('id', batch));
              if (overlap.count === null || overlap.count === undefined) throw new Error('Contagem remota indisponível.');
              seriesCount -= overlap.count;
            }
            uncoveredCount -= seriesCount;
          }
        }
      }

      if (uncoveredCount > 0) {
        throw new Error(
          `Salvamento bloqueado: a coleção de ${collection.label} está vazia, mas existem registros remotos.`
        );
      }
    }
  }

  async function preventUnsafeCatalogOverwrite(userId: string, state: FinanceState) {
    if (!supabase) return;

    const checks = [
      {
        tableName: 'categories',
        label: 'categorias',
        newCount:
          state.settings.categories.length +
          state.settings.incomeCategories.length
      },
      {
        tableName: 'accounts',
        label: 'contas',
        newCount: state.settings.accounts.length
      },
      {
        tableName: 'cards',
        label: 'cartões',
        newCount: state.settings.cards.length
      },
      {
        tableName: 'payment_methods',
        label: 'métodos de pagamento',
        newCount: state.settings.paymentMethods.length
      },
      {
        tableName: 'card_rules',
        label: 'regras de cartão',
        newCount: state.settings.cardRules.length
      }
    ];

    for (const check of checks) {
      if (check.newCount > 0) continue;

      const { count } = await executeRemoteRequest(
        check.tableName,
        'select',
        supabase.from(check.tableName).select('*', { count: 'exact', head: true }).eq('user_id', userId)
      );

      if ((count || 0) > 0) {
        throw new Error(
          `Salvamento bloqueado: o app tentou salvar ${check.label} vazias sobre dados existentes.`
        );
      }
    }
  }

  // TODO: Catálogos ainda usam substituição total. Tornar a reconciliação não destrutiva em uma fase posterior.
  await replaceRows('categories', userId, [
    ...normalized.settings.categories.map((name, index) => ({ user_id: userId, kind: 'expense', name, sort_order: index })),
    ...normalized.settings.incomeCategories.map((name, index) => ({ user_id: userId, kind: 'income', name, sort_order: index }))
  ]);
  await replaceRows('accounts', userId, normalized.settings.accounts.map((name, index) => ({ user_id: userId, name, sort_order: index })));
  await replaceRows('cards', userId, normalized.settings.cards.map((name, index) => ({ user_id: userId, name, sort_order: index })));
  await replaceRows('payment_methods', userId, normalized.settings.paymentMethods.map((name, index) => ({ user_id: userId, name, sort_order: index })));
  await replaceRows('card_rules', userId, normalized.settings.cardRules.map((rule) => ({
    user_id: userId,
    card_name: rule.cardName,
    closing_day: rule.closingDay,
    due_day: rule.dueDay
  })));

  await upsertRows(
    'transactions',
    normalized.transactions.map((item) => transactionToRow(userId, item))
  );

  await upsertRows(
    'installments',
    normalized.installments.map((item) => installmentToRow(userId, item))
  );

  await upsertRows(
    'future_bills',
    normalized.bills.map((item) => billToRow(userId, item))
  );

  await upsertRows(
    'investments',
    normalized.investments.map((item) => investmentToRow(userId, item))
  );

  await upsertRows(
    'budgets',
    normalized.budgets.map((item) => budgetToRow(userId, item))
  );
  if (deleteError) throw deleteError;
}

async function tryLoadLegacyFinanceState(userId: string): Promise<FinanceState | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from('finance_states')
    .select('data')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    console.warn('Legacy finance_states table not available or inaccessible. Starting empty.', error.message);
    return null;
  }

  if (!data?.data) return null;
  return normalizeState(data.data as Partial<FinanceState>);
}

async function upsertRows(
  tableName: string,
  rows: Array<Record<string, unknown>>
) {
  if (!supabase || rows.length === 0) return;

  await executeRemoteRequest(
    tableName,
    'upsert',
    supabase
      .from(tableName)
      .upsert(rows, {
        onConflict: 'user_id,id',
        ignoreDuplicates: false
      })
  );
}

async function replaceRows(tableName: string, userId: string, rows: Array<Record<string, unknown>>) {
  if (!supabase) return;
  await executeRemoteRequest(tableName, 'delete', supabase.from(tableName).delete().eq('user_id', userId));
  if (rows.length > 0) {
    await executeRemoteRequest(tableName, 'insert', supabase.from(tableName).insert(rows));
  }
}

async function executeRemoteRequest<T extends { error: unknown; status?: number }>(
  table: string,
  operation: RemoteOperation,
  request: PromiseLike<T>
): Promise<T> {
  const result = await request;
  if (!result.error) return result;

  const raw = typeof result.error === 'object' && result.error !== null
    ? result.error as Record<string, unknown>
    : {};
  const details: RemoteErrorDetails = {
    table,
    operation,
    code: typeof raw.code === 'string' ? raw.code : undefined,
    message: typeof raw.message === 'string' ? raw.message : String(result.error),
    details: typeof raw.details === 'string' ? raw.details : undefined,
    hint: typeof raw.hint === 'string' ? raw.hint : undefined,
    status: typeof result.status === 'number'
      ? result.status
      : typeof raw.status === 'number' ? raw.status : undefined,
  };

  if (import.meta.env.DEV) {
    console.error('[FinaSync remote save]', {
      table: details.table,
      operation: details.operation,
      code: details.code,
      message: details.message,
      details: details.details,
      hint: details.hint,
    });
  }

  throw new RemoteSaveError(details);
}

async function throwIfError(request: PromiseLike<{ error: unknown }>) {
  const { error } = await request;
  if (error) throw error;
}

function withDefaultCatalogs(state: FinanceState): FinanceState {
  const normalized = normalizeState(state);
  const defaultSettings = sampleState().settings;

  return normalizeState({
    ...normalized,
    settings: {
      ...normalized.settings,

      categories:
        normalized.settings.categories.length > 0
          ? normalized.settings.categories
          : defaultSettings.categories,

      incomeCategories:
        normalized.settings.incomeCategories.length > 0
          ? normalized.settings.incomeCategories
          : defaultSettings.incomeCategories,

      accounts:
        normalized.settings.accounts.length > 0
          ? normalized.settings.accounts
          : defaultSettings.accounts,

      cards:
        normalized.settings.cards.length > 0
          ? normalized.settings.cards
          : defaultSettings.cards,

      paymentMethods:
        normalized.settings.paymentMethods.length > 0
          ? normalized.settings.paymentMethods
          : defaultSettings.paymentMethods,

      cardRules:
        normalized.settings.cardRules.length > 0
          ? normalized.settings.cardRules
          : defaultSettings.cardRules,
    },
  });
}

function ensureDate(value: unknown): string {
  if (typeof value !== 'string') return new Date().toISOString().slice(0, 10);

  const trimmed = value.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }

  return new Date().toISOString().slice(0, 10);
}

function rowToTransaction(row: any): Transaction {
  return {
    id: row.id,
    date: ensureDate(row.date),
    description: row.description || '',
    type: row.type,
    category: row.category || '',
    subcategory: row.subcategory || '',
    amount: Number(row.amount || 0),
    paymentMethod: row.payment_method || '',
    accountOrCard: row.account_or_card || '',
    essential: Boolean(row.essential),
    paid: Boolean(row.paid),
    source: row.source || '',
    externalHash: row.external_hash || '',
    notes: row.notes || ''
  };
}

function transactionToRow(userId: string, item: Transaction) {
  return {
    user_id: userId,
    id: item.id,
    date: ensureDate(item.date),
    description: item.description || '',
    type: item.type,
    category: item.category || '',
    subcategory: item.subcategory || null,
    amount: item.amount || 0,
    payment_method: item.paymentMethod || '',
    account_or_card: item.accountOrCard || '',
    essential: item.essential,
    paid: item.paid,
    source: item.source || null,
    external_hash: item.externalHash || null,
    notes: item.notes || null,
    updated_at: new Date().toISOString()
  };
}

function rowToInstallment(row: any): Installment {
  return {
    id: row.id,
    purchaseDate: ensureDate(row.purchase_date),
    description: row.description || '',
    cardName: row.card_name || '',
    category: row.category || '',
    totalAmount: Number(row.total_amount || 0),
    installments: Number(row.installments || 1),
    firstInstallmentMonth: row.first_installment_month || '',
    paidInstallments: Number(row.paid_installments || 0),
    notes: row.notes || ''
  };
}

function installmentToRow(userId: string, item: Installment) {
  return {
    user_id: userId,
    id: item.id,
    purchase_date: ensureDate(item.purchaseDate),
    description: item.description || '',
    card_name: item.cardName || '',
    category: item.category || '',
    total_amount: item.totalAmount || 0,
    installments: item.installments || 1,
    first_installment_month: item.firstInstallmentMonth || '',
    paid_installments: item.paidInstallments || 0,
    notes: item.notes || null,
    updated_at: new Date().toISOString()
  };
}

function rowToBill(row: any): FutureBill {
  return {
    id: row.id,
    seriesId: row.series_id || undefined,
    occurrenceNumber: row.occurrence_number == null ? undefined : Number(row.occurrence_number),
    dueDate: ensureDate(row.due_date),
    description: row.description || '',
    category: row.category || '',
    amount: Number(row.amount || 0),
    recurring: Boolean(row.recurring),
    frequency: row.frequency,
    priority: row.priority,
    paid: Boolean(row.paid),
    notes: row.notes || ''
  };
}

function billToRow(userId: string, item: FutureBill) {
  return {
    user_id: userId,
    id: item.id,
    series_id: item.seriesId ?? null,
    occurrence_number: item.occurrenceNumber ?? null,
    due_date: ensureDate(item.dueDate),
    description: item.description || '',
    category: item.category || '',
    amount: item.amount || 0,
    recurring: item.recurring,
    frequency: item.frequency,
    priority: item.priority,
    paid: item.paid,
    notes: item.notes || null,
    updated_at: new Date().toISOString()
  };
}

function rowToInvestment(row: any): Investment {
  const initialAmount = Number(row.initial_amount || 0);
  const rawCurrentAmount = Number(row.current_amount || 0);

  return {
    id: row.id,
    type: row.type || '',
    institution: row.institution || '',
    initialAmount,
    currentAmount:
      initialAmount > 0 && rawCurrentAmount === 0
        ? initialAmount
        : rawCurrentAmount,
    liquidity: row.liquidity || '',
    goal: row.goal || '',
    notes: row.notes || ''
  };
}

function investmentToRow(userId: string, item: Investment) {
  return {
    user_id: userId,
    id: item.id,
    type: item.type || '',
    institution: item.institution || '',
    initial_amount: item.initialAmount || 0,
    current_amount:
    item.initialAmount > 0 && item.currentAmount === 0
      ? item.initialAmount
      : item.currentAmount || 0,
    liquidity: item.liquidity || '',
    goal: item.goal || '',
    notes: item.notes || null,
    updated_at: new Date().toISOString()
  };
}

function rowToBudget(row: any): Budget {
  return {
    id: row.id,
    month: row.month,
    category: row.category || '',
    monthlyBudget: Number(row.monthly_budget || 0)
  };
}

function budgetToRow(userId: string, item: Budget) {
  return {
    user_id: userId,
    id: item.id,
    month: item.month,
    category: item.category || '',
    monthly_budget: item.monthlyBudget || 0,
    updated_at: new Date().toISOString()
  };
}
