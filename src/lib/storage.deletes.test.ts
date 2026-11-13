import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../data/sample';
import { createSupabaseMock, type SupabaseCall, type SupabaseResult } from '../test/supabaseMock';
import type { Budget, FinanceState, FutureBill, Installment, Investment, Transaction } from '../types';
import type * as StorageModule from './storage';

// Reprodução de defeitos de exclusão persistente. Testes marcados como FALHA
// descrevem o comportamento exigido e devem falhar antes da correção.

type Row = Record<string, any>;
type Match = (call: SupabaseCall) => boolean;

// Banco Supabase falso em memória: upsert por (user_id, id), delete/select com filtros reais.
class FakeRemote {
  private readonly tables = new Map<string, Row[]>();
  private holds: Array<{ match: Match; gate: Promise<void> }> = [];
  private failures: Array<{ match: Match; error: Error }> = [];

  seed(table: string, rows: Row[]) {
    this.tables.set(table, rows.map((row) => ({ ...row })));
  }

  rows(table: string): Row[] {
    return this.tables.get(table) ?? [];
  }

  hold(match: Match): () => void {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.holds.push({ match, gate });
    return release;
  }

  failNext(match: Match, error: Error) {
    this.failures.push({ match, error });
  }

  async resolve(call: SupabaseCall): Promise<SupabaseResult> {
    for (const hold of this.holds) {
      if (hold.match(call)) await hold.gate;
    }

    const failureIndex = this.failures.findIndex((failure) => failure.match(call));
    if (failureIndex >= 0) {
      const [failure] = this.failures.splice(failureIndex, 1);
      return { data: null, error: failure.error };
    }

    const rows = this.tables.get(call.table) ?? [];
    this.tables.set(call.table, rows);

    if (call.operation === 'upsert') {
      const payloads = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
      const keys = call.options ? ['user_id', 'id'] : ['user_id'];
      for (const incoming of payloads) {
        const index = rows.findIndex((row) => keys.every((key) => row[key] === incoming[key]));
        if (index >= 0) rows[index] = { ...incoming };
        else rows.push({ ...incoming });
      }
      return { data: null, error: null };
    }

    if (call.operation === 'insert') {
      const payloads = (Array.isArray(call.payload) ? call.payload : [call.payload]) as Row[];
      rows.push(...payloads.map((row) => ({ ...row })));
      return { data: null, error: null };
    }

    if (call.operation === 'delete') {
      for (let index = rows.length - 1; index >= 0; index -= 1) {
        if (matches(rows[index], call.filters)) rows.splice(index, 1);
      }
      return { data: null, error: null };
    }

    const matched = rows.filter((row) => matches(row, call.filters)).map((row) => ({ ...row }));
    if ((call.options as { head?: boolean } | undefined)?.head) {
      return { data: null, error: null, count: matched.length };
    }
    if (call.operation === 'maybeSingle') {
      return { data: matched[0] ?? null, error: null };
    }
    return { data: matched, error: null, count: matched.length };
  }
}

function matches(row: Row, filters: Array<[string, unknown]>) {
  return filters.every(([column, value]) => {
    if (column.endsWith('.gte')) return Number(row[column.slice(0, -4)]) >= Number(value);
    return row[column] === value;
  });
}

const USER = 'user-1';
const OTHER_USER = 'user-2';

let storage: typeof StorageModule;
const mock = createSupabaseMock();
let remote: FakeRemote;

beforeAll(async () => {
  vi.doMock('./supabaseClient', () => ({
    isSupabaseConfigured: true,
    supabase: mock.client
  }));
  storage = await import('./storage');
});

beforeEach(() => {
  mock.reset();
  localStorage.clear();
  mock.auth.getSession = (async () => ({ data: { session: { user: { id: USER } } } })) as unknown as typeof mock.auth.getSession;
  remote = new FakeRemote();
  remote.seed('app_settings', [settingsRow(USER), settingsRow(OTHER_USER)]);
  mock.setResolver((call) => remote.resolve(call));
});

function settingsRow(userId: string): Row {
  return {
    user_id: userId,
    currency: 'BRL',
    selected_month: '2026-07',
    starting_balance: 0,
    monthly_income_estimate: 0,
    monthly_saving_goal: 0,
    emergency_contribution: 0
  };
}

function transaction(id: string): Transaction {
  return { id, date: '2026-07-10', description: `Lançamento ${id}`, type: 'expense', category: 'Casa', amount: 25, paymentMethod: 'Pix', accountOrCard: 'Conta', essential: true, paid: true };
}

function transactionRow(userId: string, id: string): Row {
  return { user_id: userId, id, date: '2026-07-10', description: `Lançamento ${id}`, type: 'expense', category: 'Casa', amount: 25, payment_method: 'Pix', account_or_card: 'Conta', essential: true, paid: true };
}

function installment(id: string): Installment {
  return { id, purchaseDate: '2026-07-01', description: `Parcela ${id}`, cardName: 'Visa', category: 'Compras', totalAmount: 1200, installments: 12, firstInstallmentMonth: '2026-07', paidInstallments: 0 };
}

function investment(id: string): Investment {
  return { id, type: 'CDB', institution: 'Banco', initialAmount: 1000, currentAmount: 1050, liquidity: 'Diária', goal: 'Reserva' };
}

function budget(id: string): Budget {
  return { id, month: '2026-07', category: 'Casa', monthlyBudget: 500 };
}

function bill(id: string, seriesId?: string, occurrenceNumber?: number): FutureBill {
  return { id, seriesId, occurrenceNumber, dueDate: '2026-07-20', description: `Conta ${id}`, category: 'Casa', amount: 100, recurring: seriesId !== undefined, frequency: seriesId ? 'Mensal' : 'Única', priority: 'Alta', paid: false };
}

function stateWith(patch: Partial<FinanceState>): FinanceState {
  return { ...emptyState(), ...patch };
}

function ids(table: string, userId = USER): string[] {
  return remote.rows(table).filter((row) => row.user_id === userId).map((row) => row.id).sort();
}

function deleteCalls(table: string) {
  return mock.calls.filter((call) => call.table === table && call.operation === 'delete');
}

describe('persistent deletes: financial collections that never reach the remote delete', () => {
  it('C01 parcela removida localmente não volta após salvar e recarregar (FALHA esperada)', async () => {
    await storage.saveRemoteState(USER, stateWith({ installments: [installment('i1'), installment('i2')] }));
    storage.recordPendingDelete(USER, 'installments', 'i1');
    await storage.saveRemoteState(USER, stateWith({ installments: [installment('i2')] }));

    const reloaded = await storage.loadRemoteState(USER);
    expect(reloaded.installments.map((item) => item.id)).toEqual(['i2']);
  });

  it('C02 investimento removido localmente não volta após salvar e recarregar (FALHA esperada)', async () => {
    await storage.saveRemoteState(USER, stateWith({ investments: [investment('v1'), investment('v2')] }));
    storage.recordPendingDelete(USER, 'investments', 'v1');
    await storage.saveRemoteState(USER, stateWith({ investments: [investment('v2')] }));

    const reloaded = await storage.loadRemoteState(USER);
    expect(reloaded.investments.map((item) => item.id)).toEqual(['v2']);
  });

  it('C03 orçamento removido localmente não volta após salvar e recarregar (FALHA esperada)', async () => {
    await storage.saveRemoteState(USER, stateWith({ budgets: [budget('g1'), budget('g2')] }));
    storage.recordPendingDelete(USER, 'budgets', 'g1');
    await storage.saveRemoteState(USER, stateWith({ budgets: [budget('g2')] }));

    const reloaded = await storage.loadRemoteState(USER);
    expect(reloaded.budgets.map((item) => item.id)).toEqual(['g2']);
  });
});

describe('persistent deletes: transactions and future bills with remote delete', () => {
  it('C04a lançamento excluído remotamente continua excluído após recarregar e salvar o estado local (PASSA)', async () => {
    const both = stateWith({ transactions: [transaction('t1'), transaction('t2')] });
    await storage.saveRemoteState(USER, both);
    await storage.deleteRemoteTransaction(USER, 't1');
    await storage.saveRemoteState(USER, stateWith({ transactions: [transaction('t2')] }));

    expect((await storage.loadRemoteState(USER)).transactions.map((item) => item.id)).toEqual(['t2']);
  });

  it('C04b conta futura excluída remotamente continua excluída após recarregar (PASSA)', async () => {
    await storage.saveRemoteState(USER, stateWith({ bills: [bill('b1'), bill('b2')] }));
    await storage.deleteRemoteFutureBill(USER, 'b1');

    expect((await storage.loadRemoteState(USER)).bills.map((item) => item.id)).toEqual(['b2']);
  });
});

describe('persistent deletes: races between queued saves and deletes', () => {
  it('C05a exclusão chega enquanto um salvamento de snapshot com o registro está em andamento (PASSA)', async () => {
    const both = stateWith({ transactions: [transaction('t1'), transaction('t2')] });
    const release = remote.hold((call) => call.table === 'transactions' && call.operation === 'upsert');

    const saving = storage.saveRemoteState(USER, both);
    await vi.waitFor(() => expect(mock.calls.some((call) => call.table === 'transactions' && call.operation === 'upsert')).toBe(true));
    const deleting = storage.deleteRemoteTransaction(USER, 't1');
    release();
    await Promise.all([saving, deleting]);

    expect((await storage.loadRemoteState(USER)).transactions.map((item) => item.id)).toEqual(['t2']);
  });

  it('C05b snapshot antigo, enfileirado depois da exclusão, não ressuscita o registro excluído (FALHA esperada)', async () => {
    const both = stateWith({ transactions: [transaction('t1'), transaction('t2')] });
    await storage.saveRemoteState(USER, both);

    const release = remote.hold((call) => call.table === 'transactions' && call.operation === 'delete');
    const deleting = storage.deleteRemoteTransaction(USER, 't1');
    await vi.waitFor(() => expect(deleteCalls('transactions')).toHaveLength(1));
    // Snapshot ainda contendo t1 (ex.: timer de autosave disparado antes da atualização local).
    const staleSave = storage.saveRemoteState(USER, both);
    release();
    await Promise.all([deleting, staleSave]);

    expect((await storage.loadRemoteState(USER)).transactions.map((item) => item.id)).toEqual(['t2']);
  });
});

describe('persistent deletes: failures, retries and repeated deletes', () => {
  it('C06a exclusão com rede indisponível rejeita e não altera a linha remota (PASSA)', async () => {
    await storage.saveRemoteState(USER, stateWith({ transactions: [transaction('t1'), transaction('t2')] }));
    remote.failNext((call) => call.table === 'transactions' && call.operation === 'delete', new Error('Failed to fetch'));

    await expect(storage.deleteRemoteTransaction(USER, 't1')).rejects.toThrow('Failed to fetch');
    expect(ids('transactions')).toEqual(['t1', 't2']);
  });

  it('C06b exclusão que falhou é reenviada no próximo salvamento sem o registro (FALHA esperada)', async () => {
    await storage.saveRemoteState(USER, stateWith({ transactions: [transaction('t1'), transaction('t2')] }));
    remote.failNext((call) => call.table === 'transactions' && call.operation === 'delete', new Error('Failed to fetch'));
    await expect(storage.deleteRemoteTransaction(USER, 't1')).rejects.toThrow('Failed to fetch');

    // Próximo autosave, depois de um reinício, com o estado local já sem t1.
    await storage.saveRemoteState(USER, stateWith({ transactions: [transaction('t2')] }));

    expect(ids('transactions')).toEqual(['t2']);
  });

  it('C08 nova tentativa manual após falha remota exclui o registro (PASSA)', async () => {
    await storage.saveRemoteState(USER, stateWith({ transactions: [transaction('t1'), transaction('t2')] }));
    remote.failNext((call) => call.table === 'transactions' && call.operation === 'delete', new Error('Failed to fetch'));
    await expect(storage.deleteRemoteTransaction(USER, 't1')).rejects.toThrow();

    await storage.deleteRemoteTransaction(USER, 't1');

    expect(ids('transactions')).toEqual(['t2']);
  });

  it('C09 excluir o mesmo registro mais de uma vez não falha e sempre filtra por usuário e id (PASSA)', async () => {
    await storage.saveRemoteState(USER, stateWith({ transactions: [transaction('t1'), transaction('t2')] }));

    await Promise.all([
      storage.deleteRemoteTransaction(USER, 't1'),
      storage.deleteRemoteTransaction(USER, 't1')
    ]);
    await storage.deleteRemoteTransaction(USER, 't1');

    expect(ids('transactions')).toEqual(['t2']);
    const calls = deleteCalls('transactions');
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.filters).toEqual([['user_id', USER], ['id', 't1']]);
    }
  });
});

describe('persistent deletes: user scoping', () => {
  it('C10 toda exclusão remota envia o user_id do usuário solicitante e não toca outra conta (PASSA)', async () => {
    remote.seed('transactions', [transactionRow(USER, 'shared'), transactionRow(OTHER_USER, 'shared')]);
    remote.seed('future_bills', [{ ...bill('shared-bill'), user_id: USER, due_date: '2026-07-20', series_id: null, occurrence_number: null }, { ...bill('shared-bill'), user_id: OTHER_USER, due_date: '2026-07-20', series_id: null, occurrence_number: null }]);

    await storage.deleteRemoteTransaction(USER, 'shared');
    await storage.deleteRemoteFutureBill(USER, 'shared-bill');
    await storage.deleteRemoteFutureBillsFrom(USER, 'series-x', 1);

    expect(ids('transactions', OTHER_USER)).toEqual(['shared']);
    expect(ids('future_bills', OTHER_USER)).toEqual(['shared-bill']);
    const allDeletes = mock.calls.filter((call) => call.operation === 'delete' && call.table !== 'categories' && call.table !== 'accounts' && call.table !== 'cards' && call.table !== 'payment_methods' && call.table !== 'card_rules');
    expect(allDeletes).toHaveLength(3);
    for (const call of allDeletes) {
      expect(call.filters).toContainEqual(['user_id', USER]);
    }
  });
});

describe('persistent deletes: last item of a collection', () => {
  it('C11a excluir o último lançamento e salvar o estado vazio não é bloqueado (PASSA)', async () => {
    await storage.saveRemoteState(USER, stateWith({ transactions: [transaction('t1')] }));
    await storage.deleteRemoteTransaction(USER, 't1');
    await storage.saveRemoteState(USER, stateWith({ transactions: [] }));

    expect((await storage.loadRemoteState(USER)).transactions).toEqual([]);
  });

  it('C11b excluir a última conta futura e salvar o estado vazio não é bloqueado (PASSA)', async () => {
    await storage.saveRemoteState(USER, stateWith({ bills: [bill('b1')] }));
    await storage.deleteRemoteFutureBill(USER, 'b1');
    await storage.saveRemoteState(USER, stateWith({ bills: [] }));

    expect((await storage.loadRemoteState(USER)).bills).toEqual([]);
  });

  it('C11c excluir a última parcela não bloqueia o salvamento e a remove do remoto (FALHA esperada)', async () => {
    await storage.saveRemoteState(USER, stateWith({ installments: [installment('i1')] }));
    storage.recordPendingDelete(USER, 'installments', 'i1');
    await storage.saveRemoteState(USER, stateWith({ installments: [] }));

    expect((await storage.loadRemoteState(USER)).installments).toEqual([]);
  });

  it('C11d excluir o último investimento não bloqueia o salvamento e o remove do remoto (FALHA esperada)', async () => {
    await storage.saveRemoteState(USER, stateWith({ investments: [investment('v1')] }));
    storage.recordPendingDelete(USER, 'investments', 'v1');
    await storage.saveRemoteState(USER, stateWith({ investments: [] }));

    expect((await storage.loadRemoteState(USER)).investments).toEqual([]);
  });

  it('C11e excluir o último orçamento não bloqueia o salvamento e o remove do remoto (FALHA esperada)', async () => {
    await storage.saveRemoteState(USER, stateWith({ budgets: [budget('g1')] }));
    storage.recordPendingDelete(USER, 'budgets', 'g1');
    await storage.saveRemoteState(USER, stateWith({ budgets: [] }));

    expect((await storage.loadRemoteState(USER)).budgets).toEqual([]);
  });

  it('C11f depois de excluir o último investimento, uma edição de saldo continua salvando (FALHA esperada)', async () => {
    await storage.saveRemoteState(USER, stateWith({ investments: [investment('v1')] }));
    storage.recordPendingDelete(USER, 'investments', 'v1');

    const edited = stateWith({ investments: [] });
    edited.settings.startingBalance = 999;
    await storage.saveRemoteState(USER, edited);

    const row = remote.rows('app_settings').find((item) => item.user_id === USER);
    expect(row?.starting_balance).toBe(999);
  });
});
