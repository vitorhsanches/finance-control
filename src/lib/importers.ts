import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FinanceState, IgnoredImportItem, ImportResult, Transaction } from '../types';
import { parseDateToISO, simpleHash, slug, toNumber, uid } from './utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

type CsvRow = Record<string, string>;

const MONTHS: Record<string, string> = {
  JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12'
};

function normalizeDescription(value: string) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .replace(/^(Compra no débito|Transferência recebida pelo Pix|Transferência Recebida|Transferência enviada pelo Pix|Pagamento de boleto efetuado|Débito em conta)\s*-?\s*/i, '')
    .trim();
}

function shouldIgnore(description: string, amount: number) {
  const d = slug(description);
  if (d.includes('pagamento de fatura')) return 'Pagamento de fatura ignorado para evitar duplicidade com compras do cartão.';
  if (d.includes('pagamento recebido')) return 'Pagamento recebido na fatura ignorado para evitar duplicidade.';
  if (d.includes('aplicacao rdb') || d.includes('resgate rdb')) return 'Aplicação/resgate RDB ignorado porque é movimentação de investimento, não consumo.';
  if (d.includes('saldo inicial') || d.includes('saldo final') || d.startsWith('total de ')) return 'Linha de resumo ignorada.';
  if (!Number.isFinite(amount) || amount === 0) return 'Valor zerado ou inválido.';
  return '';
}

function inferPaymentMethod(description: string, fallback = 'Outros') {
  const d = slug(description);
  if (d.includes('pix')) return 'Pix';
  if (d.includes('debito')) return 'Débito';
  if (d.includes('boleto')) return 'Boleto';
  if (d.includes('transferencia')) return 'Transferência';
  return fallback;
}

export function classifyCategory(description: string, type: 'income' | 'expense') {
  const d = slug(description);
  if (type === 'income') {
    if (d.includes('reembolso')) return 'Reembolso';
    if (d.includes('rendimento')) return 'Rendimentos';
    if (d.includes('salario')) return 'Salário';
    return 'Outros';
  }
  const rules: Array<[string[], string]> = [
    [['ifood', 'restaurante', 'burger', 'burgu', 'bobs', 'mcdonald', 'coffee', 'caldo', 'food', 'bar', 'sorvet', 'pizza', 'lanch', 'kombini', 'viva food', 'gran coffee'], 'Alimentação'],
    [['supermercado', 'mercado', 'confianca', 'cobasi'], 'Mercado'],
    [['uber', '99', 'viacao', 'cometa', 'autopass', 'metro', 'onibus', 'estacion', 'pare aqui', 'posto', 'gasolina', 'combustivel', 'leisa'], 'Transporte'],
    [['apple', 'tiktok', 'shop', 'amazon', 'mercadolivre', 'mercado livre', 'shopee'], 'Compras'],
    [['netflix', 'spotify', 'wellhub', 'club', 'assinatura'], 'Assinaturas'],
    [['hospital', 'farmacia', 'drogaria', 'clinica', 'saude'], 'Saúde'],
    [['faculdade', 'educacional', 'curso', 'nove de julho'], 'Educação'],
    [['ipva', 'licenciamento', 'seguro', 'multa', 'dgfin', 'diretoria geral de financas'], 'Carro'],
    [['hotel', 'hoteleira', 'ingresso', 'tickets', 'evento', 'cinema', 'bar'], 'Lazer']
  ];
  for (const [keys, category] of rules) {
    if (keys.some((key) => d.includes(key))) return category;
  }
  return 'Outros';
}

function makeTransaction(params: {
  date: string;
  description: string;
  amount: number;
  type?: 'income' | 'expense';
  source: string;
  paymentMethod?: string;
  accountOrCard?: string;
  fileName: string;
}): Transaction {
  const type = params.type || (params.amount >= 0 ? 'income' : 'expense');
  const amount = Math.abs(toNumber(params.amount));
  const description = normalizeDescription(params.description);
  const category = classifyCategory(description, type);
  const hash = simpleHash([params.date, description, type, amount.toFixed(2), params.source]);
  return {
    id: uid('tr'),
    date: params.date,
    description,
    type,
    category,
    amount,
    paymentMethod: params.paymentMethod || inferPaymentMethod(params.description, type === 'expense' ? 'Débito' : 'Transferência'),
    accountOrCard: params.accountOrCard || (params.source.includes('card') ? 'Nubank' : 'Conta digital'),
    essential: ['Mercado', 'Casa', 'Saúde', 'Educação', 'Transporte', 'Carro'].includes(category),
    paid: true,
    source: `${params.source}:${params.fileName}`,
    externalHash: hash
  };
}

function parseCsv(text: string): CsvRow[] {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());
  if (!lines.length) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: CsvRow = {};
    header.forEach((h, i) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

function splitCsvLine(line: string) {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') { cur += '"'; i += 1; }
      else quoted = !quoted;
    } else if (ch === ',' && !quoted) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((v) => v.trim());
}

function parseNubankAccountCsv(fileName: string, text: string, ignored: IgnoredImportItem[]) {
  const rows = parseCsv(text);
  const transactions: Transaction[] = [];
  rows.forEach((row) => {
    const date = parseDateToISO(row.Data);
    const amount = toNumber(row.Valor);
    const description = row['Descrição'] || row.Descricao || row.Identificador || '';
    const reason = shouldIgnore(description, amount);
    if (reason) {
      ignored.push({ fileName, reason, raw: JSON.stringify(row) });
      return;
    }
    transactions.push(makeTransaction({
      date,
      description,
      amount,
      type: amount >= 0 ? 'income' : 'expense',
      source: 'nubank-account-csv',
      paymentMethod: inferPaymentMethod(description),
      accountOrCard: 'Conta digital',
      fileName
    }));
  });
  return transactions;
}

function parseNubankCardCsv(fileName: string, text: string, ignored: IgnoredImportItem[]) {
  const rows = parseCsv(text);
  const transactions: Transaction[] = [];
  rows.forEach((row) => {
    const date = parseDateToISO(row.date || row.Data);
    const description = row.title || row.Titulo || row.Descrição || row.Descricao || '';
    const rawAmount = toNumber(row.amount || row.Valor);
    const reason = shouldIgnore(description, rawAmount);
    if (reason) {
      ignored.push({ fileName, reason, raw: JSON.stringify(row) });
      return;
    }
    const type = rawAmount < 0 ? 'income' : 'expense';
    transactions.push(makeTransaction({
      date,
      description,
      amount: rawAmount,
      type,
      source: 'nubank-card-csv',
      paymentMethod: 'Crédito',
      accountOrCard: 'Nubank',
      fileName
    }));
  });
  return transactions;
}

async function extractPdfText(file: File) {
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buffer }).promise;
  const pages: string[] = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const text = content.items.map((item) => ('str' in item ? item.str : '')).join('\n');
    pages.push(text);
  }
  return pages.join('\n');
}

function parseNubankAccountPdf(fileName: string, text: string, ignored: IgnoredImportItem[]) {
  const transactions: Transaction[] = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  let currentDate = '';

  const starter = /^(Transferência recebida pelo Pix|Transferência Recebida|Reembolso recebido pelo Pix|Transferência enviada pelo Pix|Compra no débito|Pagamento de boleto efetuado|Débito em conta|Pagamento de fatura|Aplicação RDB|Resgate RDB)/i;
  const dateRegex = /^(\d{2})\s+(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)\s+(\d{4})/i;
  const amountRegex = /(-?\d{1,3}(?:\.\d{3})*,\d{2}|-?\d+,\d{2})$/;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const dateMatch = line.match(dateRegex);
    if (dateMatch) {
      currentDate = `${dateMatch[3]}-${MONTHS[dateMatch[2].toUpperCase()]}-${dateMatch[1]}`;
      continue;
    }
    if (!currentDate || !starter.test(line) || line.startsWith('Total de')) continue;

    let description = line;
    let amountMatch = description.match(amountRegex);
    let guard = 0;
    while (!amountMatch && i + 1 < lines.length && guard < 5) {
      const next = lines[i + 1];
      if (dateRegex.test(next) || next.startsWith('Total de') || starter.test(next) || next.includes('Tem alguma dúvida')) break;
      description += ` ${next}`;
      i += 1;
      amountMatch = description.match(amountRegex);
      guard += 1;
    }

    if (!amountMatch) {
      ignored.push({ fileName, reason: 'Não encontrei valor no lançamento do PDF.', raw: description });
      continue;
    }

    const amountText = amountMatch[1];
    let amount = toNumber(amountText);
    const d = slug(description);
    if (d.includes('transferencia enviada') || d.includes('compra no debito') || d.includes('pagamento') || d.includes('debito em conta') || d.includes('aplicacao rdb')) amount *= -1;
    const reason = shouldIgnore(description, amount);
    if (reason) {
      ignored.push({ fileName, reason, raw: description });
      continue;
    }
    transactions.push(makeTransaction({
      date: currentDate,
      description: description.replace(amountRegex, '').trim(),
      amount,
      type: amount >= 0 ? 'income' : 'expense',
      source: 'nubank-account-pdf',
      paymentMethod: inferPaymentMethod(description),
      accountOrCard: 'Conta digital',
      fileName
    }));
  }
  return transactions;
}

function detectCsvKind(text: string) {
  const first = text.split(/\r?\n/)[0]?.toLowerCase() || '';
  if (first.includes('data') && first.includes('valor') && first.includes('descri')) return 'account';
  if (first.includes('date') && first.includes('title') && first.includes('amount')) return 'card';
  return 'unknown';
}

export async function parseFinanceFiles(files: File[], state: FinanceState): Promise<ImportResult> {
  const transactions: Transaction[] = [];
  const ignored: IgnoredImportItem[] = [];
  const warnings: string[] = [];

  const existingHashes = new Set(state.transactions.map((t) => t.externalHash).filter(Boolean));
  const batchHashes = new Set<string>();

  for (const file of files) {
    const lower = file.name.toLowerCase();
    try {
      let parsed: Transaction[] = [];
      if (lower.endsWith('.csv')) {
        const text = await file.text();
        const kind = detectCsvKind(text);
        if (kind === 'account') parsed = parseNubankAccountCsv(file.name, text, ignored);
        else if (kind === 'card') parsed = parseNubankCardCsv(file.name, text, ignored);
        else warnings.push(`${file.name}: CSV não reconhecido. Por enquanto o importador espera CSV Nubank de conta ou fatura.`);
      } else if (lower.endsWith('.pdf')) {
        const text = await extractPdfText(file);
        if (slug(text).includes('conta') && slug(text).includes('movimentacoes')) parsed = parseNubankAccountPdf(file.name, text, ignored);
        else warnings.push(`${file.name}: PDF não reconhecido. Nesta versão, PDF seguro é o extrato da conta Nubank.`);
      } else {
        warnings.push(`${file.name}: formato ignorado. Use CSV ou PDF.`);
      }

      parsed.forEach((item) => {
        const hash = item.externalHash || simpleHash([item.date, item.description, item.type, item.amount, item.source]);
        if (existingHashes.has(hash) || batchHashes.has(hash)) {
          ignored.push({ fileName: file.name, reason: 'Duplicado ignorado.', raw: item.description });
          return;
        }
        batchHashes.add(hash);
        transactions.push(item);
      });
    } catch (error) {
      warnings.push(`${file.name}: erro ao processar arquivo. ${(error as Error).message}`);
    }
  }

  return { transactions, ignored, warnings };
}
