import type { HrEmployee } from '@/types/domain';
import { getGlobalCurrencySymbol, getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';

export type ReportType = 'all' | 'employees' | 'attendance' | 'leaves' | 'loans' | 'payroll' | 'assets' | 'alerts';

export const reportTypeOptions: Array<{ value: ReportType; label: string }> = [
  { value: 'all', label: 'الكل' },
  { value: 'employees', label: 'الموظفون' },
  { value: 'attendance', label: 'الحضور' },
  { value: 'leaves', label: 'الإجازات' },
  { value: 'loans', label: 'السلف' },
  { value: 'payroll', label: 'المرتبات' },
  { value: 'assets', label: 'العُهد' },
  { value: 'alerts', label: 'التنبيهات' },
];

export function money(value: unknown) {
  const amount = Number(value || 0);
  // INV-FE3-FRONTEND-BOOK-DIGITS: this formats money in the tenant's
  // currency, so it shows book digits (see employee-profile.helpers).
  if (!Number.isFinite(amount)) return 'غير متاح';
  return `${amount.toFixed(currencyMoneyDigits(getGlobalSystemCurrency()))} ${getGlobalCurrencySymbol()}`;
}

export function countText(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return 'غير متاح';
  return String(amount);
}

export function text(value: unknown) {
  return String(value || '').trim() || '—';
}

export function normalize(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

export function monthStartDate() {
  return `${todayDate().slice(0, 7)}-01`;
}

export function employeeMatches(employee: HrEmployee, search: string, department: string) {
  const searchTerm = normalize(search);
  const departmentName = normalize(employee.departmentName);

  if (department !== 'all' && departmentName !== department) return false;

  if (!searchTerm) return true;
  const haystack = [
    employee.displayName,
    employee.firstName,
    employee.lastName,
    employee.employeeNo,
    employee.nationalId,
    employee.departmentName,
    employee.jobTitleName,
  ].map((value) => normalize(value)).join(' ');

  return haystack.includes(searchTerm);
}
