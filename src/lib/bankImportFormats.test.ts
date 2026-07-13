import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyState } from '../data/sample';
import {
  caixaStatementPdfText,
  nubankAccountCsv,
  nubankAccountPdfText,
  nubankCardCsv,
  unrecognizedPdfText
} from '../test/fixtures/bankImports';

const pdfMock = vi.hoisted(() => ({ texts: [] as string[] }));

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => {
    const text = pdfMock.texts.shift() || '';
    return {
      promise: Promise.resolve({
        numPages: 1,
        getPage: async () => ({
          getTextContent: async () => ({ items: text.split('\n').map((str) => ({ str })) })
        })
      })
    };
  })
}));

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: 'mock-worker.js' }));

import { parseFinanceFiles } from './importers';

function file(contents: string, name: string, type: string) {
  return new File([contents], name, { type });
}

beforeEach(() => {
  pdfMock.texts.length = 0;
});

describe('Nubank account CSV', () => {
  it('parses supported dates, signs, categories, malformed rows, and batch duplicates', async () => {
    const result = await parseFinanceFiles(
      [file(nubankAccountCsv, 'nubank-account.csv', 'text/csv')],
      emptyState()
    );

    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      date: '2026-07-01',
      description: 'Supermercado Bairro',
      type: 'expense',
      amount: 125.9,
      category: 'Mercado',
      accountOrCard: 'Conta digital',
      source: 'nubank-account-csv:nubank-account.csv'
    });
    expect(result.transactions[1]).toMatchObject({
      date: '2026-07-02',
      type: 'income',
      amount: 800,
      category: 'Salário'
    });
    expect(result.ignored.map((item) => item.reason)).toEqual(
      expect.arrayContaining(['Valor zerado ou inválido.', 'Duplicado ignorado.'])
    );
  });

  it('detects a transaction already present in application state', async () => {
    const first = await parseFinanceFiles(
      [file('Data,Valor,Descrição\n2026-07-01,"-125,90",Supermercado Bairro', 'first.csv', 'text/csv')],
      emptyState()
    );
    const state = emptyState();
    state.transactions = [first.transactions[0]];
    const duplicate = await parseFinanceFiles(
      [file('Data,Valor,Descrição\n2026-07-01,"-125,90",Supermercado Bairro', 'again.csv', 'text/csv')],
      state
    );
    expect(duplicate.transactions).toHaveLength(0);
    expect(duplicate.ignored[0].reason).toBe('Duplicado ignorado.');
  });
});

describe('Nubank card CSV', () => {
  it('infers purchases, refunds, installment descriptions, cards, and categories', async () => {
    const result = await parseFinanceFiles(
      [file(nubankCardCsv, 'nubank-card.csv', 'text/csv')],
      emptyState()
    );

    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      date: '2026-07-04',
      description: 'Amazon Parcela 2/10',
      type: 'expense',
      amount: 199.99,
      paymentMethod: 'Crédito',
      accountOrCard: 'Nubank',
      category: 'Compras'
    });
    expect(result.transactions[1]).toMatchObject({
      date: '2026-07-05',
      type: 'income',
      amount: 50,
      category: 'Reembolso'
    });
    expect(result.ignored[0].reason).toContain('Pagamento recebido');
  });
});

describe('Nubank account PDF', () => {
  it('extracts realistic PDF text and parses valid, ignored, and malformed blocks', async () => {
    pdfMock.texts.push(nubankAccountPdfText);
    const result = await parseFinanceFiles(
      [file('pdf', 'nubank-account.pdf', 'application/pdf')],
      emptyState()
    );

    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      date: '2026-07-10',
      description: 'Supermercado Bairro',
      type: 'expense',
      amount: 125.9,
      category: 'Mercado',
      accountOrCard: 'Conta digital'
    });
    expect(result.transactions[1]).toMatchObject({
      date: '2026-07-10',
      description: 'Honorários projeto',
      type: 'income',
      amount: 800
    });
    expect(result.ignored.map((item) => item.reason).join(' ')).toContain('Pagamento de fatura');
    expect(result.ignored.map((item) => item.reason)).toContain('Não encontrei valor no lançamento do PDF.');
  });
});

describe('Caixa statement PDF', () => {
  it('parses header and short dates, positive and negative amounts, account, and malformed blocks', async () => {
    pdfMock.texts.push(caixaStatementPdfText);
    const state = emptyState();
    state.settings.accounts = ['Conta Caixa'];
    const result = await parseFinanceFiles(
      [file('pdf', 'caixa.pdf', 'application/pdf')],
      state
    );

    expect(result.warnings).toEqual([]);
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({
      date: '2026-07-10',
      description: 'Pix Enviado Padaria Central',
      type: 'expense',
      amount: 25.5,
      paymentMethod: 'Pix',
      accountOrCard: 'Conta Caixa',
      source: 'caixa-period-pdf:caixa.pdf'
    });
    expect(result.transactions[1]).toMatchObject({
      date: '2026-07-11',
      description: 'Pix Recebido Cliente teste',
      type: 'income',
      amount: 500
    });
    expect(result.ignored[0].reason).toBe('Não encontrei valor no lançamento Caixa.');
  });

  it('returns a warning for an unsupported PDF structure', async () => {
    pdfMock.texts.push(unrecognizedPdfText);
    const result = await parseFinanceFiles(
      [file('pdf', 'unknown.pdf', 'application/pdf')],
      emptyState()
    );
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings[0]).toContain('PDF não reconhecido');
  });
});
