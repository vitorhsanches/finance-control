import type { FinanceState } from '../types';

export function uid(prefix = 'id') {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36).slice(-5)}`;
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value === null || value === undefined || value === '') return 0;

  let text = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace('R$', '')
    .replace(/[^\d,.-]/g, '');

  if (!text) return 0;

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    const lastComma = text.lastIndexOf(',');
    const lastDot = text.lastIndexOf('.');

    if (lastComma > lastDot) {
      // BR: 1.234,56
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      // EN: 1,234.56
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    // BR simples: 10,50
    text = text.replace(',', '.');
  } else {
    // EN simples: 10.50
    text = text;
  }

  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}
export function money(value: number, state?: FinanceState) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: state?.settings.currency || 'BRL',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(toNumber(value));
}

export function formatDate(value: string) {
  if (!value) return '';
  const [y, m, d] = value.split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

export function ym(dateValue: string) {
  return String(dateValue || '').slice(0, 7);
}

export function startOfMonth(month: string) {
  return new Date(`${month}-01T00:00:00`);
}

export function endOfMonth(month: string) {
  const d = startOfMonth(month);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function addMonths(month: string, amount: number) {
  const d = startOfMonth(month);
  d.setMonth(d.getMonth() + amount);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function daysRemainingInMonth(month: string) {
  const now = new Date();
  const selected = startOfMonth(month);
  const end = endOfMonth(month);
  if (selected.getFullYear() !== now.getFullYear() || selected.getMonth() !== now.getMonth()) return Math.max(1, end.getDate());
  return Math.max(1, end.getDate() - now.getDate() + 1);
}

export function clampDay(value: number) {
  const n = Math.floor(toNumber(value));
  return Math.min(31, Math.max(1, n || 1));
}

export function slug(value: string) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function simpleHash(parts: unknown[]) {
  return slug(parts.map((p) => String(p ?? '')).join('|'));
}

export function parseDateToISO(value: string) {
  const raw = String(value || '').trim();
  if (!raw) return todayISO();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const loose = new Date(raw);
  if (!Number.isNaN(loose.getTime())) {
    return `${loose.getFullYear()}-${String(loose.getMonth() + 1).padStart(2, '0')}-${String(loose.getDate()).padStart(2, '0')}`;
  }
  return todayISO();
}

export function safeDateForMonth(month: string, dayValue: number) {
  const last = endOfMonth(month).getDate();
  const day = String(Math.min(clampDay(dayValue), last)).padStart(2, '0');
  return `${month}-${day}`;
}
