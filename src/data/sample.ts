import type { FinanceState } from '../types';
import { addMonths, currentMonth, uid } from '../lib/utils';

export function sampleState(): FinanceState {
  const month = currentMonth();
  const next = addMonths(month, 1);
  return {
    settings: {
      currency: 'BRL',
      selectedMonth: month,
      startingBalance: 3200,
      monthlyIncomeEstimate: 6500,
      monthlySavingGoal: 1000,
      emergencyContribution: 300,
      categories: ['Alimentação', 'Transporte', 'Mercado', 'Lazer', 'Compras', 'Casa', 'Carro', 'Saúde', 'Educação', 'Assinaturas', 'Investimentos', 'Outros'],
      incomeCategories: ['Salário', 'Reembolso', 'Freelance', 'Rendimentos', 'Outros'],
      accounts: ['Conta corrente', 'Carteira', 'Conta digital'],
      cards: ['Nubank', 'Itaú', 'Inter'],
      paymentMethods: ['Pix', 'Débito', 'Crédito', 'Dinheiro', 'Boleto', 'Transferência'],
      cardRules: [
        { cardName: 'Nubank', closingDay: 20, dueDay: 27 },
        { cardName: 'Itaú', closingDay: 25, dueDay: 5 },
        { cardName: 'Inter', closingDay: 15, dueDay: 22 }
      ],
      importProfiles: []
    },
    transactions: [
      {
        id: uid('tr'),
        date: `${month}-05`,
        description: 'Salário',
        type: 'income',
        category: 'Salário',
        amount: 6500,
        paymentMethod: 'Transferência',
        accountOrCard: 'Conta corrente',
        essential: true,
        paid: true,
        source: 'sample'
      },
      {
        id: uid('tr'),
        date: `${month}-07`,
        description: 'Mercado',
        type: 'expense',
        category: 'Mercado',
        amount: 420,
        paymentMethod: 'Débito',
        accountOrCard: 'Conta corrente',
        essential: true,
        paid: true,
        source: 'sample'
      },
      {
        id: uid('tr'),
        date: `${month}-10`,
        description: 'Restaurante',
        type: 'expense',
        category: 'Alimentação',
        amount: 85,
        paymentMethod: 'Crédito',
        accountOrCard: 'Nubank',
        essential: false,
        paid: true,
        source: 'sample'
      }
    ],
    installments: [
      {
        id: uid('in'),
        purchaseDate: `${month}-12`,
        description: 'Curso online',
        cardName: 'Nubank',
        category: 'Educação',
        totalAmount: 600,
        installments: 6,
        firstInstallmentMonth: month,
        paidInstallments: 1
      }
    ],
    bills: [
      {
        id: uid('bill'),
        dueDate: `${month}-15`,
        description: 'Internet',
        category: 'Casa',
        amount: 120,
        recurring: true,
        frequency: 'Mensal',
        priority: 'Alta',
        paid: false
      },
      {
        id: uid('bill'),
        dueDate: `${next}-10`,
        description: 'Seguro do carro',
        category: 'Carro',
        amount: 240,
        recurring: true,
        frequency: 'Mensal',
        priority: 'Média',
        paid: false
      }
    ],
    investments: [
      {
        id: uid('iv'),
        type: 'Reserva de emergência',
        institution: 'Nubank',
        initialAmount: 3000,
        currentAmount: 3400,
        liquidity: 'Diária',
        goal: 'Emergência'
      }
    ],
    budgets: [
      { id: uid('bg'), month, category: 'Alimentação', monthlyBudget: 800 },
      { id: uid('bg'), month, category: 'Mercado', monthlyBudget: 700 },
      { id: uid('bg'), month, category: 'Lazer', monthlyBudget: 350 },
      { id: uid('bg'), month, category: 'Compras', monthlyBudget: 400 }
    ]
  };
}


export function emptyState(): FinanceState {
  const base = sampleState();
  return {
    settings: {
      ...base.settings,
      selectedMonth: currentMonth(),
      startingBalance: 0,
      monthlyIncomeEstimate: 0,
      monthlySavingGoal: 0,
      emergencyContribution: 0
    },
    transactions: [],
    installments: [],
    bills: [],
    investments: [],
    budgets: []
  };
}

export function normalizeState(data: Partial<FinanceState> | null | undefined): FinanceState {
  const sample = sampleState();
  const state = data || {};
  const settings = { ...sample.settings, ...(state.settings || {}) };
  const cards = Array.isArray(settings.cards) ? settings.cards : sample.settings.cards;
  const existingRules = Array.isArray(settings.cardRules) ? settings.cardRules : [];
  settings.cardRules = cards.map((card) => existingRules.find((r) => r.cardName === card) || { cardName: card, closingDay: 20, dueDay: 10 });
  settings.importProfiles = Array.isArray(settings.importProfiles)
  ? settings.importProfiles
  : [];

  return {
    settings,
    transactions: Array.isArray(state.transactions) ? state.transactions : sample.transactions,
    installments: Array.isArray(state.installments) ? state.installments : sample.installments,
    bills: Array.isArray(state.bills) ? state.bills : sample.bills,
    investments: Array.isArray(state.investments) ? state.investments : sample.investments,
    budgets: Array.isArray(state.budgets) ? state.budgets : sample.budgets
  };
}
