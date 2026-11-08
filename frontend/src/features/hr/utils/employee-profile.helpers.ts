import type { HrContact, HrEmployee } from '@/types/domain';
import { getGlobalCurrencySymbol, getGlobalSystemCurrency } from '@/lib/currencies';
import { currencyMoneyDigits } from '@/shared/utils/money';

export function fallbackText(value: unknown) {
  return String(value || '').trim() || '—';
}

export function money(value: unknown) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return '—';
  // INV-FE3-FRONTEND-BOOK-DIGITS: this formats money in the tenant's
  // currency, so it shows book digits (a 3-decimal tenant's 0.125 must
  // display as 0.125, not as a 2dp-rounded 0.13/0.12).
  return `${amount.toFixed(currencyMoneyDigits(getGlobalSystemCurrency()))} ${getGlobalCurrencySymbol()}`;
}

export function statusLabel(status: unknown) {
  const value = String(status || '').trim();
  if (value === 'active') return 'نشط';
  if (value === 'inactive') return 'غير نشط';
  if (value === 'deactivated') return 'موقوف';
  if (value === 'terminated') return 'منتهي الخدمة';
  return 'غير محدد';
}

export function maskNationalId(nationalId: unknown) {
  const value = String(nationalId || '').trim();
  if (!/^\d{14}$/.test(value)) return 'غير مسجل';
  return `**********${value.slice(-4)}`;
}

export function pickPrimaryPhone(contacts: HrContact[]) {
  const phone = contacts.find((entry) => String(entry.contactType || '').toLowerCase() === 'phone' && entry.isPrimary)
    || contacts.find((entry) => String(entry.contactType || '').toLowerCase() === 'phone')
    || contacts[0];
  return phone ? fallbackText(phone.value) : 'غير مسجل';
}

export function employeeName(employee?: HrEmployee) {
  if (!employee) return 'ملف الموظف';
  return fallbackText(employee.displayName || `${employee.firstName || ''} ${employee.lastName || ''}`.trim()) || 'ملف الموظف';
}

export function normalizeDateOnly(value: unknown) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : '';
}

export function normalizeText(value: unknown) {
  return String(value || '').trim().toLowerCase();
}

export function documentStatusLabel(expiryDate?: string) {
  const date = normalizeDateOnly(expiryDate);
  if (!date) return 'بدون تاريخ انتهاء';

  const expiry = new Date(`${date}T00:00:00`);
  if (Number.isNaN(expiry.getTime())) return 'بدون تاريخ انتهاء';

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.ceil((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));

  if (diffDays < 0) return 'منتهي';
  if (diffDays <= 30) return 'قريب الانتهاء';
  return 'ساري';
}

export function assetStatusLabel(status: unknown) {
  const value = normalizeText(status);
  if (value === 'assigned') return 'مسلّمة';
  if (value === 'returned') return 'مرتجعة';
  if (value === 'damaged') return 'تالفة';
  if (value === 'lost') return 'مفقودة';
  if (value === 'cancelled') return 'ملغاة';
  return 'غير محدد';
}

export function leaveStatusLabel(status: unknown) {
  const value = normalizeText(status);
  if (value === 'pending') return 'قيد المراجعة';
  if (value === 'approved') return 'معتمدة';
  if (value === 'rejected') return 'مرفوضة';
  if (value === 'cancelled' || value === 'canceled') return 'ملغاة';
  return fallbackText(status);
}

export function loanStatusLabel(status: unknown) {
  const value = normalizeText(status);
  if (value === 'draft') return 'مسودة';
  if (value === 'approved') return 'معتمدة';
  if (value === 'paid' || value === 'disbursed') return 'مصروفة';
  if (value === 'partially_repaid') return 'نشطة';
  if (value === 'repaid') return 'مكتملة';
  if (value === 'cancelled' || value === 'canceled') return 'ملغاة';
  return fallbackText(status);
}

export function loanTypeLabel(loanType: unknown) {
  const value = normalizeText(loanType);
  if (value === 'advance') return 'سلفة';
  if (value === 'loan') return 'قرض';
  return fallbackText(loanType);
}

export function repaymentModeLabel(mode: unknown) {
  const value = normalizeText(mode);
  if (value === 'deduct_next_salary') return 'خصم كامل من الراتب القادم';
  if (value === 'monthly_salary_installment') return 'تقسيط على دفعات';
  if (value === 'manual_cash') return 'سداد يدوي';
  return fallbackText(mode);
}

export function installmentStatusLabel(status: unknown) {
  const value = normalizeText(status);
  if (value === 'pending' || value === 'partial') return 'قسط مستحق';
  if (value === 'paid') return 'مخصوم';
  if (value === 'cancelled' || value === 'canceled') return 'ملغي';
  return 'غير محدد';
}
