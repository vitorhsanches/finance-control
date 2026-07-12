import { describe, expect, it } from 'vitest';
import { emptyState } from '../data/sample';
import type { GenericCsvMapping, GenericCsvPreview } from './importers';
import { classifyCategory, getUnknownCsvPreviews, parseGenericCsvPreview } from './importers';

const preview: GenericCsvPreview = {
  fileName: 'bank.csv',
  columns: ['Data', 'Descrição', 'Valor', 'Tipo'],
  rows: [
    { Data: '10/07/2026', Descrição: 'Mercado Central', Valor: '-125,90', Tipo: 'Débito' },
    { Data: '11/07/2026', Descrição: 'Pagamento cliente', Valor: '800,00', Tipo: 'Crédito' },
    { Data: 'data inválida', Descrição: 'Ignorar', Valor: '10', Tipo: 'Débito' }
  ],
  sampleRows: []
};

const mapping: GenericCsvMapping = {
  dateColumn: 'Data',
  descriptionColumn: 'Descrição',
  amountColumn: 'Valor',
  typeColumn: 'Tipo',
  accountOrCard: 'Conta',
  paymentMethod: 'Outros',
  incomeTypeValues: 'crédito',
  expenseTypeValues: 'débito',
  negativeMeansExpense: true
};

describe('generic importers', () => {
  it('maps valid rows and reports invalid rows', () => {
    const result = parseGenericCsvPreview(preview, mapping, emptyState());
    expect(result.transactions).toHaveLength(2);
    expect(result.transactions[0]).toMatchObject({ date: '2026-07-10', type: 'expense', amount: 125.9 });
    expect(result.transactions[1]).toMatchObject({ type: 'income', amount: 800 });
    expect(result.ignored[0].reason).toContain('data inválida');
  });

  it('warns when required mappings are missing', () => {
    const result = parseGenericCsvPreview(preview, { ...mapping, dateColumn: '' }, emptyState());
    expect(result.transactions).toHaveLength(0);
    expect(result.warnings[0]).toContain('data, descrição e valor');
  });

  it('detects unknown CSV files and classifies common categories', async () => {
    const file = new File(['Quando;Texto;Quantia\n10/07/2026;Mercado;25'], 'custom.csv', { type: 'text/csv' });
    const previews = await getUnknownCsvPreviews([file]);
    expect(previews[0]).toMatchObject({ fileName: 'custom.csv', columns: ['Quando', 'Texto', 'Quantia'] });
    expect(classifyCategory('Compra no supermercado', 'expense')).toBe('Mercado');
  });
});
