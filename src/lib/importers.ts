import * as pdfjsLib from 'pdfjs-dist';
import pdfWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FinanceState, IgnoredImportItem, ImportResult, Transaction } from '../types';
import { parseDateToISO, simpleHash, slug, toNumber, uid } from './utils';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorker;

export type CsvRow = Record<string, string>;

const MONTHS: Record<string, string> = {
  JAN: '01', FEV: '02', MAR: '03', ABR: '04', MAI: '05', JUN: '06', JUL: '07', AGO: '08', SET: '09', OUT: '10', NOV: '11', DEZ: '12'
};

const CAIXA_MONTH_WORDS: Record<string, string> = {
  janeiro: '01',
  fevereiro: '02',
  marco: '03',
  abril: '04',
  maio: '05',
  junho: '06',
  julho: '07',
  agosto: '08',
  setembro: '09',
  outubro: '10',
  novembro: '11',
  dezembro: '12'
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
  if (d.includes('inclusao de pagamento') || d.includes('inclusao pagamento')) return 'Pagamento de cartão ignorado para evitar duplicidade com compras da fatura.';
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

function inferCaixaPeriodType(
  description: string,
  source: string,
  fallback: 'income' | 'expense'
): 'income' | 'expense' {
  if (source !== 'caixa-period-pdf') return fallback;

  const d = slug(description);

  if (
    d.includes('pix enviado') ||
    d.includes('debito prestacao') ||
    d.includes('pagamento de boleto') ||
    d.includes('pagamento de')
  ) {
    return 'expense';
  }

  if (
    d.includes('pix recebido') ||
    d.includes('recebimento ted') ||
    d.includes('recebimento')
  ) {
    return 'income';
  }

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
    [['hotel', 'hoteleira', 'ingresso', 'tickets', 'evento', 'cinema', 'bar'], 'Lazer'],
    [['prestacao hab', 'financiamento habitacional', 'habitacao', 'hab'], 'Casa'],
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
  const fallbackType = params.type || (params.amount >= 0 ? 'income' : 'expense');
  const description = normalizeDescription(params.description);

  const type = inferCaixaPeriodType(
    description,
    params.source,
    fallbackType
  );

  const amount = Math.abs(toNumber(params.amount));
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

  const delimiter = detectCsvDelimiter(lines[0]);
  const header = splitCsvLine(lines[0], delimiter).map((h) => h.trim());

  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    const row: CsvRow = {};
    header.forEach((h, i) => {
      row[h] = values[i] ?? '';
    });
    return row;
  });
}

function detectCsvDelimiter(line: string) {
  const candidates = [',', ';', '\t'];
  let selected = ',';
  let selectedCount = -1;

  candidates.forEach((delimiter) => {
    const count = countDelimiterOutsideQuotes(line, delimiter);

    if (count > selectedCount) {
      selected = delimiter;
      selectedCount = count;
    }
  });

  return selected;
}

function countDelimiterOutsideQuotes(line: string, delimiter: string) {
  let count = 0;
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
      count += 1;
    }
  }

  return count;
}

function splitCsvLine(line: string, delimiter = ',') {
  const out: string[] = [];
  let cur = '';
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];

    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (ch === delimiter && !quoted) {
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
  const first = text.split(/\r?\n/)[0] || '';

  const delimiter = detectCsvDelimiter(first);
  const columns = splitCsvLine(first, delimiter).map((column) =>
    slug(column)
  );

  const hasExact = (value: string) => columns.includes(value);

  if (
    hasExact('data') &&
    hasExact('valor') &&
    (hasExact('descricao') || hasExact('identificador'))
  ) {
    return 'account';
  }

  if (
    hasExact('date') &&
    hasExact('title') &&
    hasExact('amount')
  ) {
    return 'card';
  }

  return 'unknown';
}

export interface GenericCsvPreview {
  fileName: string;
  columns: string[];
  rows: CsvRow[];
  sampleRows: CsvRow[];
}

export interface GenericCsvMapping {
  dateColumn: string;
  descriptionColumn: string;
  amountColumn: string;
  typeColumn: string;
  accountOrCard: string;
  paymentMethod: string;
  incomeTypeValues: string;
  expenseTypeValues: string;
  negativeMeansExpense: boolean;
}

function parseGenericDateToISO(value: string) {
  const raw = String(value || '').trim();

  if (!raw) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const br = raw.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{2}|\d{4})$/);

  if (br) {
    const day = br[1].padStart(2, '0');
    const month = br[2].padStart(2, '0');
    const year = br[3].length === 2 ? `20${br[3]}` : br[3];

    const date = new Date(`${year}-${month}-${day}T00:00:00`);

    if (
      !Number.isNaN(date.getTime()) &&
      date.getFullYear() === Number(year) &&
      date.getMonth() + 1 === Number(month) &&
      date.getDate() === Number(day)
    ) {
      return `${year}-${month}-${day}`;
    }

    return '';
  }

  const loose = new Date(raw);

  if (!Number.isNaN(loose.getTime())) {
    return `${loose.getFullYear()}-${String(loose.getMonth() + 1).padStart(2, '0')}-${String(loose.getDate()).padStart(2, '0')}`;
  }

  return '';
}

export async function getUnknownCsvPreviews(files: File[]): Promise<GenericCsvPreview[]> {
  const previews: GenericCsvPreview[] = [];

  for (const file of files) {
    const lower = file.name.toLowerCase();

    if (!lower.endsWith('.csv')) continue;

    const text = await file.text();

    if (detectCsvKind(text) !== 'unknown') continue;

    const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim());

    if (!lines.length) continue;

    const delimiter = detectCsvDelimiter(lines[0]);
    const columns = splitCsvLine(lines[0], delimiter).map((column) => column.trim()).filter(Boolean);
    const rows = parseCsv(text).filter((row) =>
      Object.values(row).some((value) => String(value || '').trim())
    );

    if (!columns.length || !rows.length) continue;

    previews.push({
      fileName: file.name,
      columns,
      rows,
      sampleRows: rows.slice(0, 8),
    });
  }

  return previews;
}

function splitTypeValues(value: string) {
  return String(value || '')
    .split(',')
    .map((item) => slug(item))
    .filter(Boolean);
}

function inferGenericType(
  rawAmount: number,
  typeText: string,
  mapping: GenericCsvMapping
): 'income' | 'expense' {
  const normalizedType = slug(typeText);
  const incomeValues = splitTypeValues(mapping.incomeTypeValues);
  const expenseValues = splitTypeValues(mapping.expenseTypeValues);

  if (
    normalizedType &&
    incomeValues.some((value) => normalizedType.includes(value))
  ) {
    return 'income';
  }

  if (
    normalizedType &&
    expenseValues.some((value) => normalizedType.includes(value))
  ) {
    return 'expense';
  }

  if (mapping.negativeMeansExpense) {
    return rawAmount >= 0 ? 'income' : 'expense';
  }

  return 'expense';
}

export function parseGenericCsvPreview(
  preview: GenericCsvPreview,
  mapping: GenericCsvMapping,
  state: FinanceState
): ImportResult {
  const transactions: Transaction[] = [];
  const ignored: IgnoredImportItem[] = [];
  const warnings: string[] = [];

  if (!mapping.dateColumn || !mapping.descriptionColumn || !mapping.amountColumn) {
    return {
      transactions,
      ignored,
      warnings: [
        `${preview.fileName}: selecione pelo menos as colunas de data, descrição e valor.`,
      ],
    };
  }

  const existingHashes = new Set(
    state.transactions.map((t) => t.externalHash).filter(Boolean)
  );

  const batchHashes = new Set<string>();

  preview.rows.forEach((row, index) => {
    const rawDate = row[mapping.dateColumn] || '';
    const rawDescription = row[mapping.descriptionColumn] || '';
    const rawAmount = toNumber(row[mapping.amountColumn]);
    const rawType = mapping.typeColumn ? row[mapping.typeColumn] || '' : '';

    const date = parseGenericDateToISO(rawDate);
    const description = normalizeDescription(rawDescription);

    if (!date) {
      ignored.push({
        fileName: preview.fileName,
        reason: `Linha ${index + 2}: data inválida.`,
        raw: JSON.stringify(row),
      });
      return;
    }

    if (!description) {
      ignored.push({
        fileName: preview.fileName,
        reason: `Linha ${index + 2}: descrição vazia.`,
        raw: JSON.stringify(row),
      });
      return;
    }

    if (!Number.isFinite(rawAmount) || rawAmount === 0) {
      ignored.push({
        fileName: preview.fileName,
        reason: `Linha ${index + 2}: valor zerado ou inválido.`,
        raw: JSON.stringify(row),
      });
      return;
    }

    const type = inferGenericType(rawAmount, rawType, mapping);
    const signedAmount =
      type === 'expense' ? -Math.abs(rawAmount) : Math.abs(rawAmount);

    const reason = shouldIgnore(description, signedAmount);

    if (reason) {
      ignored.push({
        fileName: preview.fileName,
        reason,
        raw: JSON.stringify(row),
      });
      return;
    }

    const item = makeTransaction({
      date,
      description,
      amount: signedAmount,
      type,
      source: 'generic-csv',
      paymentMethod: mapping.paymentMethod || inferPaymentMethod(description, 'Outros'),
      accountOrCard:
        mapping.accountOrCard ||
        state.settings.accounts[0] ||
        state.settings.cards[0] ||
        'Conta',
      fileName: preview.fileName,
    });

    const hash =
      item.externalHash ||
      simpleHash([item.date, item.description, item.type, item.amount, item.source]);

    if (existingHashes.has(hash) || batchHashes.has(hash)) {
      ignored.push({
        fileName: preview.fileName,
        reason: 'Duplicado ignorado.',
        raw: item.description,
      });
      return;
    }

    batchHashes.add(hash);
    transactions.push(item);
  });

  return {
    transactions,
    ignored,
    warnings,
  };
}

function isCaixaPeriodPdf(text: string) {
  const d = slug(text);

  return (
    d.includes('extrato por periodo') &&
    d.includes('saldo do dia') &&
    (
      d.includes('pix enviado') ||
      d.includes('pix recebido') ||
      d.includes('recebimento ted') ||
      d.includes('debito prestacao') ||
      d.includes('pagamento de boleto')
    )
  );
}

function isCaixaNegativeAmount(value: string) {
  const normalized = value
    .replace(/\s+/g, "")
    .replace(/[−–—]/g, "-");

  return normalized.startsWith("-R$");
}

function isCaixaExpenseBlock(block: string[], amountIndex: number) {
  const amountLine = block[amountIndex] || "";
  const previousLine = block[amountIndex - 1] || "";
  const combinedAroundAmount = `${previousLine}${amountLine}`;

  if (isCaixaNegativeAmount(amountLine)) return true;
  if (isCaixaNegativeAmount(combinedAroundAmount)) return true;

  const description = slug(block.join(" "));

  return (
    description.includes("pix enviado") ||
    description.includes("debito prestacao") ||
    description.includes("pagamento de boleto") ||
    description.includes("pagamento de")
  );
}

function parseCaixaCurrency(value: string) {
  const normalized = value
    .replace(/[−–—]/g, "-")
    .replace(/\s+/g, "");

  const onlyNumber = normalized
    .replace(/^-?R\$/, "")
    .replace(/\./g, "")
    .replace(",", ".");

  return Number(onlyNumber);
}

function parseCaixaHeaderDate(line: string) {
  const match = line.match(/^(\d{2})\s+de\s+([A-Za-zÀ-ÿ]+)\s+de\s+(\d{4})/i);
  if (!match) return '';

  const day = match[1];
  const monthName = slug(match[2]);
  const year = match[3];
  const month = CAIXA_MONTH_WORDS[monthName];

  if (!month) return '';

  return `${year}-${month}-${day}`;
}

function parseCaixaShortDate(line: string, fallbackYear: string) {
  const match = line.match(/^(\d{2})(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)$/i);
  if (!match) return '';

  const day = match[1];
  const month = MONTHS[match[2].toUpperCase()];
  if (!month) return '';

  return `${fallbackYear}-${month}-${day}`;
}

function isCaixaUiOrSummaryLine(line: string) {
  const d = slug(line);

  return (
    !d ||
    d === 'ordenar' ||
    d === 'compartilhar' ||
    d === 'voltar' ||
    d.startsWith('saldo do dia') ||
    d.startsWith('saldo anterior') ||
    d === 'extrato por periodo'
  );
}

function isCaixaTransactionStart(line: string) {
  return /^(Pix Enviado|Pix Recebido|Recebimento Ted|Recebimento TED|Debito Prestacao|Débito Prestação|Pagamento de|Pagamento de Boleto|TED|DOC|Transferência|Transferencia)/i.test(line);
}

function parseCaixaPeriodPdf(
  fileName: string,
  text: string,
  ignored: IgnoredImportItem[],
  state: FinanceState
) {
  const transactions: Transaction[] = [];

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const amountLineRegex = /^[\-−–—]?\s*R\$\s*\d{1,3}(?:\.\d{3})*,\d{2}$/;
  const shortDateRegex = /^(\d{2})(JAN|FEV|MAR|ABR|MAI|JUN|JUL|AGO|SET|OUT|NOV|DEZ)$/i;

  let currentDate = "";
  let detectedYear =
    text.match(/\bde\s+(\d{4}),/i)?.[1] ||
    new Date().getFullYear().toString();

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    const headerDate = parseCaixaHeaderDate(line);

    if (headerDate) {
      currentDate = headerDate;
      detectedYear = headerDate.slice(0, 4);
      continue;
    }

    if (!isCaixaTransactionStart(line)) continue;

    const block: string[] = [];
    let j = i;

    while (j < lines.length) {
      const currentLine = lines[j];

      const isNextHeader = Boolean(parseCaixaHeaderDate(currentLine));
      const isNextTransaction = j > i && isCaixaTransactionStart(currentLine);
      const isSummary =
        slug(currentLine).startsWith("saldo do dia") ||
        slug(currentLine).startsWith("saldo anterior");

      if (j > i && (isNextHeader || isNextTransaction || isSummary)) {
        break;
      }

      block.push(currentLine);
      j += 1;
    }

    i = j - 1;

    const amountIndex = block.findIndex((item) => amountLineRegex.test(item));
    const amountLine = amountIndex >= 0 ? block[amountIndex] : "";

    if (!amountLine) {
      ignored.push({
        fileName,
        reason: "Não encontrei valor no lançamento Caixa.",
        raw: block.join(" "),
      });
      continue;
    }

  const isExpense = isCaixaExpenseBlock(block, amountIndex);
  const parsedAmount = parseCaixaCurrency(amountLine);

    const amount = isExpense
      ? -Math.abs(parsedAmount)
      : Math.abs(parsedAmount);

    if (!Number.isFinite(amount) || amount === 0) {
      ignored.push({
        fileName,
        reason: "Valor Caixa zerado ou inválido.",
        raw: block.join(" "),
      });
      continue;
    }

    const type: "income" | "expense" = isExpense ? "expense" : "income";

    const shortDateLine = block.find((item) => shortDateRegex.test(item));

    const date = shortDateLine
      ? parseCaixaShortDate(shortDateLine, detectedYear)
      : currentDate;

    if (!date) {
      ignored.push({
        fileName,
        reason: "Não encontrei data no lançamento Caixa.",
        raw: block.join(" "),
      });
      continue;
    }

    const description = block
      .filter((item) => !amountLineRegex.test(item))
      .filter((item) => !shortDateRegex.test(item))
      .filter((item) => !isCaixaUiOrSummaryLine(item))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const reason = shouldIgnore(description, amount);

    if (reason) {
      ignored.push({
        fileName,
        reason,
        raw: block.join(" "),
      });
      continue;
    }

    transactions.push(
      makeTransaction({
        date,
        description,
        amount,
        type,
        source: "caixa-period-pdf",
        paymentMethod: inferPaymentMethod(description),
        accountOrCard: state.settings.accounts[0] || "Conta Caixa",
        fileName,
      })
    );
  }

  return transactions;
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

          if (isCaixaPeriodPdf(text)) {
            parsed = parseCaixaPeriodPdf(file.name, text, ignored, state);
          } else if (slug(text).includes('conta') && slug(text).includes('movimentacoes')) {
            parsed = parseNubankAccountPdf(file.name, text, ignored);
          } else {
            warnings.push(`${file.name}: PDF não reconhecido. PDFs aceitos nesta versão: extrato da conta Nubank e extrato por período da Caixa.`);
          }
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
