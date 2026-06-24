export type TransactionType = 'income' | 'expense';
export type PageKey = 'dashboard' | 'transactions' | 'import' | 'installments' | 'bills' | 'investments' | 'budgets' | 'settings';

export interface CardRule {
  cardName: string;
  closingDay: number;
  dueDay: number;
}

export interface Settings {
  currency: string;
  selectedMonth: string;
  startingBalance: number;
  monthlyIncomeEstimate: number;
  monthlySavingGoal: number;
  emergencyContribution: number;
  categories: string[];
  incomeCategories: string[];
  accounts: string[];
  cards: string[];
  paymentMethods: string[];
  cardRules: CardRule[];
}

export interface Transaction {
  id: string;
  date: string;
  description: string;
  type: TransactionType;
  category: string;
  subcategory?: string;
  amount: number;
  paymentMethod: string;
  accountOrCard: string;
  essential: boolean;
  paid: boolean;
  source?: string;
  externalHash?: string;
  notes?: string;
}

export interface Installment {
  id: string;
  purchaseDate: string;
  description: string;
  cardName: string;
  category: string;
  totalAmount: number;
  installments: number;
  firstInstallmentMonth: string;
  paidInstallments: number;
  notes?: string;
}

export interface FutureBill {
  id: string;
  dueDate: string;
  description: string;
  category: string;
  amount: number;
  recurring: boolean;
  frequency: 'Mensal' | 'Anual' | 'Única';
  priority: 'Baixa' | 'Média' | 'Alta';
  paid: boolean;
  notes?: string;
}

export interface Investment {
  id: string;
  type: string;
  institution: string;
  initialAmount: number;
  currentAmount: number;
  liquidity: string;
  goal: string;
  notes?: string;
}

export interface Budget {
  id: string;
  month: string;
  category: string;
  monthlyBudget: number;
}

export interface FinanceState {
  settings: Settings;
  transactions: Transaction[];
  installments: Installment[];
  bills: FutureBill[];
  investments: Investment[];
  budgets: Budget[];
}

export interface IgnoredImportItem {
  fileName: string;
  reason: string;
  raw?: string;
}

export interface ImportResult {
  transactions: Transaction[];
  ignored: IgnoredImportItem[];
  warnings: string[];
}
