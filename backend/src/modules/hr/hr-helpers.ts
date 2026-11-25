import { createHash } from 'node:crypto';
import { Kysely, sql } from '../../database/kysely';
import { AppError } from '../../common/errors/app-error';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../database/database.types';
import { addLoanInstallmentMonths } from './payroll-loan-allocation.engine';
import { MoneyDigits, currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';

/**
 * hr-helpers.ts — shared free functions + types for the HR split.
 * Pure move of the 21 free functions + 8 type aliases + masterConfig /
 * attendanceStatuses (L67-286 of hr.service.ts, base 366532f47), created
 * with the H0 merge. Method bodies are byte-identical — only the
 * `export` keyword is added to each top-level declaration so the facade
 * and the slices can import them. The facade and every slice import from
 * here ('./hr-helpers' from the facade, '../hr-helpers' from services/).
 * The money / tenantBookDigits / tenantCurrencyCode trio carries
 * INV-HR-PAYROLL-BOOK-PRECISION semantics (tenant currency is the single
 * source of book precision; missing currency fails closed) — moved
 * byte-identical, the INV is preserved.
 */

export type MasterKind = 'departments' | 'job-titles' | 'positions';
export type MasterConfig = {
  table: 'hr_departments' | 'hr_job_titles' | 'hr_positions';
  auditName: string;
};

export const masterConfig: Record<MasterKind, MasterConfig> = {
  departments: { table: 'hr_departments', auditName: 'HR department' },
  'job-titles': { table: 'hr_job_titles', auditName: 'HR job title' },
  positions: { table: 'hr_positions', auditName: 'HR position' },
};

export function toId(value: unknown): number | null {
  const id = Number(value || 0);
  return id > 0 ? id : null;
}

export function clean(value: unknown): string {
  return String(value || '').trim();
}

export function normalizeEmployeeNo(value: unknown): string {
  const raw = clean(value);
  if (!raw) return '';
  const withoutLegacyPrefix = raw.replace(/^EMP-?/i, '');
  if (!/^\d+$/.test(withoutLegacyPrefix)) return '';
  const numeric = Number(withoutLegacyPrefix);
  if (!Number.isSafeInteger(numeric) || numeric <= 0) return '';
  return String(numeric).padStart(3, '0');
}

export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; constraint?: unknown; detail?: unknown; message?: unknown };
  return (
    String(candidate.code || '') === '23505' &&
    (String(candidate.constraint || '').includes('hr_employees_employee_no') ||
      String(candidate.detail || '').includes('employee_no') ||
      String(candidate.message || '').includes('idx_hr_employees_employee_no_unique'))
  );
}

export function normalizeDateOnly(value: unknown): string | null {
  const text = clean(value);
  // Accept a strict date or a genuine ISO timestamp only. The old /T.*/
  // pattern silently accepted malformed strings like 2026-02-01Tgarbage.
  const isoMatch = text.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/,
  );
  if (isoMatch) {
    const result = `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    const dt = new Date(result + 'T00:00:00Z');
    if (!Number.isFinite(dt.getTime()) || dt.toISOString().slice(0, 10) !== result) return null;
    if (isoMatch[4] !== undefined && !Number.isFinite(Date.parse(text))) return null;
    return result;
  }
  const usMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (usMatch) {
    const month = Number(usMatch[1]);
    const day = Number(usMatch[2]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return normalizeDateOnly(`${usMatch[3]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
    }
  }
  return null;
}

export function nextMonthDate(value?: string | null): string {
  const normalized = normalizeDateOnly(value);
  if (normalized) return addMonths(normalized, 1);
  const now = new Date();
  return addMonths(
    `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`,
    1,
  );
}

export function addMonths(value: string, months: number): string {
  const normalized = normalizeDateOnly(value);
  if (!normalized) return nextMonthDate();
  return addLoanInstallmentMonths(normalized, months);
}

export function normalizePayrollMonth(value: unknown): string {
  const text = clean(value);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(text)) return '';
  return text;
}

export function monthRange(periodMonth: string): { from: string; to: string } {
  const [year, month] = periodMonth.split('-').map(Number);
  return {
    from: `${periodMonth}-01`,
    to: new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10),
  };
}

export function money(value: unknown, minorUnits: MoneyDigits): number {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return roundMoney(amount, minorUnits);
}

/**
 * INV-HR-PAYROLL-BOOK-PRECISION: payroll gates and rounding need the
 * tenant's book precision. Settings currency is the single source; a
 * missing or malformed currency fails closed instead of defaulting to 2.
 */
export async function tenantBookDigits(db: Kysely<Database>, tenantId: string): Promise<MoneyDigits> {
  const currency = await tenantCurrencyCode(db, tenantId);
  return currencyMoneyDigits(currency);
}

export async function tenantCurrencyCode(db: Kysely<Database>, tenantId: string): Promise<string> {
  const setting = await sql<{ value: string }>`
    SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'currency' LIMIT 1
  `.execute(db);
  const currency = clean(setting.rows[0]?.value).replace(/^"|"$/g, '').toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new AppError('حدد عملة منشأتك قبل حساب المرتبات', 'HR_TENANT_CURRENCY_REQUIRED', 400);
  }
  return currency;
}

export function combineNotes(...notes: Array<string | null | undefined>): string {
  const unique: string[] = [];
  for (const note of notes) {
    for (const part of clean(note).split('|')) {
      const value = part.trim();
      if (value && !unique.includes(value)) unique.push(value);
    }
  }
  return unique.join(' | ');
}

export function canViewSalary(auth: AuthContext): boolean {
  return (
    auth.role === 'super_admin' ||
    auth.permissions.includes('*') ||
    auth.permissions.includes('hrSalaryView') ||
    auth.permissions.includes('hrSalaryManage')
  );
}

export function hasHrPermission(auth: AuthContext, permission: string): boolean {
  return auth.role === 'super_admin' || auth.permissions.includes('*') || auth.permissions.includes(permission);
}

export const attendanceStatuses = ['present', 'absent', 'late', 'half_day', 'leave', 'excused', 'early_leave'] as const;
export type AttendanceStatus = (typeof attendanceStatuses)[number];
export type PayrollOperationalReview = {
  attendanceAbsentDays: number;
  attendanceLateDays: number;
  attendanceHalfDays: number;
  attendanceEarlyLeaveDays: number;
  approvedLeaveDays: number;
  unpaidLeaveDays: number;
  suggestedAttendanceDeductionAmount: number;
  suggestedLeaveDeductionAmount: number;
  payrollReviewNotes: string;
  approvedOvertimeMinutes: number;
  pendingOvertimeMinutes: number;
};
export type AttendanceExceptionStatus = 'pending' | 'approved' | 'skipped' | 'auto_calculated' | 'needs_review';
export type AttendanceExceptionType =
  | 'early_check_in'
  | 'late_check_in'
  | 'early_check_out'
  | 'late_check_out'
  | 'missing_check_in'
  | 'missing_check_out'
  | 'short_hours'
  | 'extra_hours'
  | 'unscheduled_time';
export type CompensationType = 'monthly' | 'hourly';
export type OvertimePolicy = 'review_only' | 'disabled' | 'auto_approved';

export function normalizeAttendanceStatus(value: unknown): AttendanceStatus | 'unmarked' {
  const status = clean(value);
  if (!status) return 'unmarked';
  return attendanceStatuses.includes(status as AttendanceStatus) ? (status as AttendanceStatus) : 'unmarked';
}

export function normalizeAttendanceSource(value: unknown): 'manual' | 'import' | 'mobile_gps' {
  const c = clean(value);
  if (c === 'import') return 'import';
  if (c === 'mobile_gps') return 'mobile_gps';
  return 'manual';
}

// Deterministic audit key for one saved attendance day: the same payload
// replayed (double-click, row-save + save-all racing on the same POST)
// hashes to the same key and writes one audit row; a genuine correction
// (any field different) hashes differently and still logs. Rows are
// sorted by employee so row order cannot change the key.
export function buildAttendanceDayAuditKey(
  tenantId: string,
  workDate: string,
  rows: Array<{
    employeeId?: unknown;
    status?: unknown;
    checkInAt?: unknown;
    checkOutAt?: unknown;
    source?: unknown;
    notes?: unknown;
  }>,
): string {
  const canonical = [...rows]
    .map((row) => ({
      employeeId: toId(row.employeeId),
      status: normalizeAttendanceStatus(row.status),
      checkInAt: row.checkInAt ? new Date(String(row.checkInAt)).toISOString() : null,
      checkOutAt: row.checkOutAt ? new Date(String(row.checkOutAt)).toISOString() : null,
      source: normalizeAttendanceSource(row.source),
      notes: clean(row.notes) || null,
    }))
    .sort((a, b) => Number(a.employeeId || 0) - Number(b.employeeId || 0));
  const digest = createHash('sha256')
    .update(JSON.stringify({ tenantId, workDate, rows: canonical }))
    .digest('hex');
  return `hr-attendance-day:${tenantId}:${workDate}:${digest}`;
}

export function normalizeTimeOnly(value: unknown): string | null {
  const text = clean(value);
  const matched = text.match(/^(\d{1,2}):(\d{1,2})/);
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function timeToMinutes(value: string): number {
  const [hh, mm] = value.split(':').map(Number);
  return hh * 60 + mm;
}

export function inclusiveDaysBetween(from: string, to: string): number {
  const fromDate = new Date(`${from}T00:00:00Z`);
  const toDate = new Date(`${to}T00:00:00Z`);
  const diffMs = toDate.getTime() - fromDate.getTime();
  return Math.floor(diffMs / (24 * 60 * 60 * 1000)) + 1;
}
