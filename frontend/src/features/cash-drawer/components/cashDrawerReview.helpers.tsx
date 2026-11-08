import i18n from '@/lib/i18n';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';

export type ComparisonRow = {
  key: string;
  label: string;
  systemAmount: number;
  declaredAmount: number;
  amountDiff: number;
  systemCount: number | null;
  declaredCount: number | null;
  countDiff: number | null;
};

// INV-FE1-FRONTEND-BOOK-DIGITS: drawer review money rounds at the
// tenant's book digits, passed in by the dialog (global system
// currency). The old hardcoded 2dp truncated 3dp tenants.
export function toMoney(value: unknown, digits: MoneyDigits): number {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return roundMoneyValue(parsed, digits);
}

export function toCount(value: unknown): number {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.trunc(parsed));
}

export function formatMoney(value: number, digits: MoneyDigits): string {
  const amount = toMoney(value, digits);
  return `${new Intl.NumberFormat('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount)} ${getGlobalCurrencySymbol()}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(toCount(value));
}

export function formatInteger(value: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(Math.trunc(value));
}

export function formatSignedCount(value: number): string {
  if (value > 0) return `+${formatInteger(value)}`;
  return formatInteger(value);
}

export function differenceLabel(value: number, digits: MoneyDigits): string {
  const isEn = i18n.language === 'en';
  const money = formatMoney(Math.abs(value), digits);
  // A difference smaller than one minor unit counts as matched.
  if (Math.abs(value) < 10 ** -digits) return isEn ? `${formatMoney(0, digits)} (Matched)` : `${formatMoney(0, digits)} (مطابق)`;
  if (value < 0) return `-${money}`;
  return `+${money}`;
}

function parseIso(value?: string): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

export function formatDateOnly(value?: string): string {
  const parsed = parseIso(value);
  if (!parsed) return '—';
  return new Intl.DateTimeFormat('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
}

export function formatTimeOnly(value?: string): string {
  const parsed = parseIso(value);
  if (!parsed) return '—';
  return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false }).format(parsed);
}

export function formatDuration(startIso?: string, endIso?: string): string {
  const isEn = i18n.language === 'en';
  const start = parseIso(startIso);
  const end = parseIso(endIso);
  if (!start || !end || end <= start) return '—';
  const totalMinutes = Math.floor((end.getTime() - start.getTime()) / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return isEn
    ? `${formatCount(hours)} hrs & ${formatCount(minutes)} mins`
    : `${formatCount(hours)} ساعات و ${formatCount(minutes)} دقيقة`;
}

export function toDisplayCount(value?: number | null): string {
  if (value == null) return '—';
  return formatCount(Number(value || 0));
}
