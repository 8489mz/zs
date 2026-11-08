import type { HrEmployee, HrEmployeeAsset } from '@/types/domain';
import { getGlobalCurrencySymbol, getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';

export type CustodyTab = 'physical' | 'cash';

export type AssetFormState = {
  employeeId: string;
  assetType: string;
  assetName: string;
  assetCode: string;
  serialNo: string;
  assignedAt: string;
  notes: string;
  cashAmount: string;
};

export type SettlementDraft = {
  spentAmount: string;
  returnedAmount: string;
  notes: string;
};

export type ReviewStatusFilter = 'all' | 'assigned' | 'returned' | 'damaged' | 'lost' | 'needs_review' | 'cancelled';

export const cashCustodyType = 'عهدة نقدية';
export const assetTypeOptions = ['جهاز', 'هاتف', 'حاسوب محمول', 'أدوات', 'مفاتيح', 'زي عمل', 'أخرى'];

export const statusOptions: Array<{ value: ReviewStatusFilter; label: string }> = [
  { value: 'needs_review', label: 'تحتاج مراجعة' },
  { value: 'assigned', label: 'مفتوحة / مسلّمة' },
  { value: 'returned', label: 'مقفولة / مرتجعة' },
  { value: 'damaged', label: 'تالفة' },
  { value: 'lost', label: 'مفقودة' },
  { value: 'cancelled', label: 'ملغاة' },
  { value: 'all', label: 'الكل' },
];

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function normalizeArabicDigits(value: string) {
  return value
    .replace(/[\u0660-\u0669]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[\u06F0-\u06F9]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

export function normalizeNumberText(value: unknown) {
  return normalizeArabicDigits(String(value || '').trim()).replace(/[،,]/g, '.');
}

export function parseAmount(value: unknown) {
  const amount = Number(normalizeNumberText(value));
  // INV-FE3-FRONTEND-BOOK-DIGITS: cash-custody amounts are money; they
  // round at the tenant's book digits, not hardcoded 2dp. This feeds
  // cashAmount/cashDifference/settlementParts and the page's totals.
  return Number.isFinite(amount) && amount > 0 ? roundMoneyValue(amount, currencyMoneyDigits(getGlobalSystemCurrency())) : 0;
}

export function money(value: unknown) {
  // Same book digits as parseAmount: a 3-decimal tenant's 0.125 must
  // display as 0.125, not as a 2dp-rounded 0.13/0.12.
  return `${parseAmount(value).toFixed(currencyMoneyDigits(getGlobalSystemCurrency()))} ${getGlobalCurrencySymbol()}`;
}

export function text(value: unknown) {
  return String(value || '').trim();
}

export function fallbackText(value: unknown) {
  return text(value) || '—';
}

export function normalize(value: unknown) {
  return text(value).toLowerCase();
}

export function employeeDisplay(row: HrEmployee) {
  return text(row.displayName || `${row.firstName || ''} ${row.lastName || ''}`.trim()) || '—';
}

export function isCashCustody(row: HrEmployeeAsset) {
  return text(row.assetType) === cashCustodyType;
}

export function custodyKind(row: HrEmployeeAsset): CustodyTab {
  return isCashCustody(row) ? 'cash' : 'physical';
}

export function statusLabel(status: unknown, tab: CustodyTab) {
  const value = normalize(status);
  if (value === 'assigned') return tab === 'cash' ? 'مفتوحة' : 'مسلّمة';
  if (value === 'returned') return tab === 'cash' ? 'مقفولة' : 'مرتجعة';
  if (value === 'lost') return 'مفقودة';
  if (value === 'damaged') return 'تالفة';
  if (value === 'cancelled') return 'ملغاة';
  return 'غير محدد';
}

export function settlementParts(row: HrEmployeeAsset) {
  const source = `${row.returnNotes || ''} ${row.notes || ''}`;
  const spent = source.match(/مصروف:\s*([0-9.]+)/);
  const returned = source.match(/مرتجع:\s*([0-9.]+)/);
  return { spentAmount: parseAmount(spent?.[1]), returnedAmount: parseAmount(returned?.[1]) };
}

export function cashAmount(row: HrEmployeeAsset) {
  return parseAmount(row.assetCode || row.serialNo || 0);
}

export function cashDifference(row: HrEmployeeAsset) {
  const amount = cashAmount(row);
  const settled = settlementParts(row);
  return roundMoneyValue(amount - settled.spentAmount - settled.returnedAmount, currencyMoneyDigits(getGlobalSystemCurrency()));
}

export function needsReview(row: HrEmployeeAsset) {
  const status = normalize(row.status);
  if (status === 'damaged' || status === 'lost') return true;
  if (status === 'assigned' && !text(row.assignedAt)) return true;
  if (status === 'returned' && !text(row.returnedAt)) return true;
  // INV-FE3-FRONTEND-BOOK-DIGITS: every leg is already rounded at book
  // digits, so any nonzero difference is a real fils-level difference.
  if (isCashCustody(row) && status === 'returned' && Math.abs(cashDifference(row)) > 0) return true;
  return false;
}

export function statusMatches(row: HrEmployeeAsset, filter: ReviewStatusFilter) {
  const status = normalize(row.status);
  if (filter === 'all') return true;
  if (filter === 'needs_review') return needsReview(row);
  return status === filter;
}

export function initialForm(tab: CustodyTab): AssetFormState {
  return {
    employeeId: '',
    assetType: tab === 'cash' ? cashCustodyType : '',
    assetName: '',
    assetCode: '',
    serialNo: '',
    assignedAt: todayDate(),
    notes: '',
    cashAmount: '',
  };
}
