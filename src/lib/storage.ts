import type { Session } from '@supabase/supabase-js';
import type { Budget, CardRule, FinanceState, FutureBill, Installment, Investment, Settings, Transaction } from '../types';
import { emptyState, normalizeState, sampleState } from '../data/sample';
import { isSupabaseConfigured, supabase } from './supabaseClient';

export { isSupabaseConfigured, supabase } from './supabaseClient';

export const LOCAL_STORAGE_KEY = 'finance-control-react-v3';
const LEGACY_LOCAL_STORAGE_KEY = 'finance-control-react-v1';
let remoteSaveQueue: Promise<void> = Promise.resolve();
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

  return withDefaultCatalogs(remoteState);
}

export function saveRemoteState(userId: string, state: FinanceState): Promise<void> {
  const snapshot = normalizeState(JSON.parse(JSON.stringify(state)) as FinanceState);
  const queuedSave = remoteSaveQueue.then(() => persistRemoteState(userId, snapshot));

  remoteSaveQueue = queuedSave.catch(() => undefined);

  return queuedSave;
}

async function persistRemoteState(userId: string, state: FinanceState) {
  if (!supabase) return;
  const normalized = normalizeState(state);

  await preventUnsafeEmptyCollectionOverwrites(userId, normalized);
  await preventUnsafeCatalogOverwrite(userId, normalized);

  await throwIfError(supabase.from('profiles').upsert({ user_id: userId, updated_at: new Date().toISOString() }));

  await throwIfError(supabase.from('app_settings').upsert({
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

      const { count, error } = await supabase
        .from(collection.tableName)
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (error) throw error;

      if ((count || 0) > 0) {
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

      const { count, error } = await supabase
        .from(check.tableName)
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);

      if (error) throw error;

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

  await throwIfError(
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
  await throwIfError(supabase.from(tableName).delete().eq('user_id', userId));
  if (rows.length > 0) {
    await throwIfError(supabase.from(tableName).insert(rows));
  }
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
