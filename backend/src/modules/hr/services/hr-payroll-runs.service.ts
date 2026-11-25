import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { CreatePayrollAdjustmentDto, CreatePayrollRunDto, UpsertPayrollItemDto, GenerateWpsDto } from '../dto/hr.dto';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { requireLoanMoney } from '../payroll-loan-allocation.engine';
import { type MoneyDigits, currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { MANUAL_PAYROLL_EXCLUSION_NOTE } from '../engines/hr-payroll-run.engine';
import { type EffectiveSalaryContract } from '../engines/hourly-attendance-pay.engine';
import {
  clean,
  normalizeDateOnly,
  tenantBookDigits,
  normalizePayrollMonth,
  monthRange,
  hasHrPermission,
  money,
  combineNotes,
} from '../hr-helpers';

/**
 * HrPayrollRunsService — slice H7 of the hr split.
 * Pure move of 18 methods from HrService (payroll-run list/get/create,
 * review invalidation, recalculate, review, cancel, WPS export, run-item
 * update, adjustments, and the private run/item mappers). No behavior
 * change: the bodies are byte-identical; the facade keeps thin delegates
 * with the same names and signatures for the 10 public methods.
 * The 3 private invalidators/getters that other slices bind as deps
 * (getPayrollRunStatusForUpdate — H10; invalidateReviewedPayrollForNewHire
 * — H1; invalidatePayrollRunReview — H5/H10) become PUBLIC in the slice
 * only, with NO facade delegate (prep §2.5 public-in-slice rule); the only
 * change to each is dropping the `private ` prefix. The other 5 privates
 * (mapPayrollRun, mapPayrollItem, mapPayrollAdjustment, getPayrollItemRun,
 * recalculatePayrollItemTotals) stay PRIVATE in the slice — called only by
 * this slice's own methods (prep §2.4).
 * The dead getPayrollRunStatus (pristine L2546-2551, 0 call sites) is NOT
 * moved — it stays in the facade on this generation tree; the merge drops
 * it (prep §2.2).
 * Deps: db + tx + audit + bound rebuildPayrollRunItems (H8, public-in-slice
 * — signature (db: Kysely<Database>, runId: number, itemStatus:
 * 'draft' | 'reviewed' | 'approved', scopeTenantId: string) => Promise<void>;
 * the facade passes this.payrollRebuildService.<method>.bind(this); H8
 * merges BEFORE H7, so the field exists at merge) + bound
 * calculatePayrollOperationalReview (H9, public-in-slice — signature (db:
 * Kysely<Database>, range: { from: string; to: string }, employeeIds:
 * number[], baseSalaryByEmployeeId: Map<number, number>, tenantId: string,
 * contractualMonthlySalary?: Map<number, number>, effectiveContracts?:
 * Map<number, EffectiveSalaryContract[]>, minorUnits?: MoneyDigits) =>
 * Promise<Map<number, any>>; the facade passes
 * this.payrollReviewService.<method>.bind(this); H9 merges BEFORE H7).
 * Free helpers (clean, normalizeDateOnly, tenantBookDigits,
 * normalizePayrollMonth, monthRange, hasHrPermission, money, combineNotes)
 * are imported from '../hr-helpers' (created with the H0 merge); they are
 * NOT copied into this slice.
 * Date handling travels verbatim: the UTC-slice key in getPayrollRun
 * (pristine L3599 — `new Date(Date.UTC(Number(periodMonth.split('-')[0]),
 * Number(periodMonth.split('-')[1]), 0)).toISOString().slice(0, 10)`) is
 * byte-identical (no tenant-tz replacement — that is a behavior change for
 * another package, prep §7.1); the single serverTime stamp in
 * listPayrollRuns stays byte-identical. No toFixed2, no inlineRound, no FX
 * in this slice.
 * No spec repoint travels in this patch — prep §7.3 rules all six
 * source-text repoints MERGE-OWNED (business-date-display §9 reads the
 * Date.UTC expression inside getPayrollRun; the merge repoints it to the
 * H7 file; tenant-scoped-reads MT-02 reads getPayrollRun via the facade —
 * multi-file repoint at merge). H7's driving specs (prep §4.2/§6.5):
 * clock-p8-frontend-server-time (listPayrollRuns),
 * payroll-export-requires-accrual + wps-paid-run-export (generatePayrollWps).
 */

export interface HrPayrollRunsDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  rebuildPayrollRunItems: (
    db: Kysely<Database>,
    runId: number,
    itemStatus: 'draft' | 'reviewed' | 'approved',
    scopeTenantId: string,
  ) => Promise<void>;
  calculatePayrollOperationalReview: (
    db: Kysely<Database>,
    range: { from: string; to: string },
    employeeIds: number[],
    baseSalaryByEmployeeId: Map<number, number>,
    tenantId: string,
    contractualMonthlySalary?: Map<number, number>,
    effectiveContracts?: Map<number, EffectiveSalaryContract[]>,
    minorUnits?: MoneyDigits,
  ) => Promise<Map<number, any>>;
}

@Injectable()
export class HrPayrollRunsService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly rebuildPayrollRunItems: (
    db: Kysely<Database>,
    runId: number,
    itemStatus: 'draft' | 'reviewed' | 'approved',
    scopeTenantId: string,
  ) => Promise<void>;
  private readonly calculatePayrollOperationalReview: (
    db: Kysely<Database>,
    range: { from: string; to: string },
    employeeIds: number[],
    baseSalaryByEmployeeId: Map<number, number>,
    tenantId: string,
    contractualMonthlySalary?: Map<number, number>,
    effectiveContracts?: Map<number, EffectiveSalaryContract[]>,
    minorUnits?: MoneyDigits,
  ) => Promise<Map<number, any>>;

  constructor(deps: HrPayrollRunsDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.rebuildPayrollRunItems = deps.rebuildPayrollRunItems;
    this.calculatePayrollOperationalReview = deps.calculatePayrollOperationalReview;
  }

  private mapPayrollRun(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      periodMonth: clean(row.period_month),
      startDate: row.start_date_text ? clean(row.start_date_text) : '',
      endDate: row.end_date_text ? clean(row.end_date_text) : '',
      payFrequency: clean(row.pay_frequency) || 'monthly',
      status: clean(row.status) || 'draft',
      notes: clean(row.notes),
      createdBy: row.created_by ? String(row.created_by) : '',
      reviewedBy: row.reviewed_by ? String(row.reviewed_by) : '',
      approvedBy: row.approved_by ? String(row.approved_by) : '',
      createdAt: clean(row.created_at_text),
      reviewedAt: clean(row.reviewed_at_text),
      approvedAt: clean(row.approved_at_text),
      updatedAt: clean(row.updated_at_text),
      itemCount: Number(row.item_count || 0),
      totalBaseSalary: Number(row.total_base_salary || 0),
      totalAllowanceAmount: Number(row.total_allowance_amount || 0),
      totalDeductionAmount: Number(row.total_deduction_amount || 0),
      totalLoanDeductionAmount: Number(row.total_loan_deduction_amount || 0),
      totalAssetRecoveryDeductionAmount: Number(row.total_asset_recovery_deduction_amount || 0),
      totalEmployeeSocialInsurance: Number(row.total_employee_social_insurance || 0),
      totalEmployerSocialInsurance: Number(row.total_employer_social_insurance || 0),
      totalIncomeTax: Number(row.total_income_tax || 0),
      totalPenaltyDeduction: Number(row.total_penalty_deduction || 0),
      totalCarriedForwardDeduction: Number(row.total_carried_forward_deduction || 0),
      totalGrossPay: Number(row.total_gross_pay || 0),
      totalNetPay: Number(row.total_net_pay || 0),
    };
  }

  private mapPayrollItem(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      runId: String(row.run_id),
      employeeId: String(row.employee_id),
      employeeName: clean(row.employee_name),
      employeeNo: clean(row.employee_no),
      compensationType: clean(row.compensation_type) || 'monthly',
      hourlyRate: row.hourly_rate == null ? null : Number(row.hourly_rate),
      expectedDailyHours: row.expected_daily_hours == null ? null : Number(row.expected_daily_hours),
      contractId: row.contract_id ? String(row.contract_id) : '',
      baseSalary: Number(row.base_salary || 0),
      allowanceAmount: Number(row.allowance_amount || 0),
      deductionAmount: Number(row.deduction_amount || 0),
      loanDeductionAmount: Number(row.loan_deduction_amount || 0),
      assetRecoveryDeductionAmount: Number(row.asset_recovery_deduction_amount || 0),
      employeeSocialInsurance: Number(row.employee_social_insurance || 0),
      employerSocialInsurance: Number(row.employer_social_insurance || 0),
      incomeTax: Number(row.income_tax || 0),
      penaltyDeduction: Number(row.penalty_deduction || 0),
      carriedForwardDeduction: Number(row.carried_forward_deduction || 0),
      grossPay: Number(row.gross_pay || 0),
      netPay: Number(row.net_pay || 0),
      status: clean(row.status) || 'draft',
      notes: clean(row.notes),
      createdAt: clean(row.created_at_text),
      updatedAt: clean(row.updated_at_text),
    };
  }

  private mapPayrollAdjustment(row: Record<string, unknown>): Record<string, unknown> {
    return {
      id: String(row.id),
      payrollItemId: String(row.payroll_item_id),
      adjustmentType: clean(row.adjustment_type),
      label: clean(row.label),
      amount: Number(row.amount || 0),
      notes: clean(row.notes),
      createdAt: clean(row.created_at_text),
    };
  }

  async getPayrollRunStatusForUpdate(db: Kysely<Database>, runId: number, tenantId: string): Promise<string> {
    const result = await sql<{
      status: string;
    }>`SELECT status FROM hr_payroll_runs WHERE id = ${runId} AND tenant_id = ${tenantId} LIMIT 1 FOR UPDATE`.execute(
      db,
    );
    const status = clean(result.rows[0]?.status);
    if (!status) throw new AppError('Payroll run not found', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    return status;
  }

  private async getPayrollItemRun(
    db: Kysely<Database>,
    itemId: number,
    tenantId: string,
  ): Promise<{ runId: number; runStatus: string; itemStatus: string }> {
    const result = await sql<{ run_id: number; run_status: string; item_status: string }>`
      SELECT i.run_id, r.status AS run_status, i.status AS item_status
      FROM hr_payroll_run_items i
      JOIN hr_payroll_runs r ON r.id = i.run_id
      WHERE i.id = ${itemId} AND i.tenant_id = ${tenantId} AND r.tenant_id = ${tenantId}
      LIMIT 1
    `.execute(db);
    const row = result.rows[0];
    if (!row) throw new AppError('Payroll item not found', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
    return { runId: Number(row.run_id), runStatus: clean(row.run_status), itemStatus: clean(row.item_status) };
  }

  /**
   * Payroll manual adjustments must retain calculated overtime, commissions, capped
   * installments and statutory items. Never reconstruct the item from its base salary
   * alone: that discards previously calculated earnings.
   */
  private async recalculatePayrollItemTotals(db: Kysely<Database>, itemId: number, tenantId: string): Promise<void> {
    const item = await sql<{ run_id: number; status: string; run_status: string }>`
      SELECT i.run_id, i.status, r.status AS run_status
      FROM hr_payroll_run_items i
      JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
      WHERE i.id = ${itemId} AND i.tenant_id = ${tenantId}
      LIMIT 1
    `.execute(db);
    if (!item.rows.length) throw new AppError('Payroll item not found', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
    if (item.rows[0].run_status !== 'draft') {
      throw new AppError('Payroll adjustments are allowed for drafts only', 'HR_PAYROLL_ADJUSTMENT_LOCKED', 400);
    }
    await this.rebuildPayrollRunItems(db, Number(item.rows[0].run_id), 'draft', tenantId);
  }

  async listPayrollRuns(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    // P8 (RC-7): the payroll page's month default comes from the server
    // clock — the list response carries it, the HR attendance list precedent.
    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const month = normalizePayrollMonth(query.month);
    // INV-HR-LOANS-PAYROLL-SQL-PAGINATION: the per-run aggregates were
    // already in SQL; the COUNT is taken over the grouped set and the page
    // reads the same grouped query with LIMIT/OFFSET.
    const runsQuery = sql<Record<string, unknown>>`
      SELECT
        r.*,
        to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
        to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text,
        to_char(r.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
        to_char(r.reviewed_at, 'YYYY-MM-DD HH24:MI') AS reviewed_at_text,
        to_char(r.approved_at, 'YYYY-MM-DD HH24:MI') AS approved_at_text,
        to_char(r.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at_text,
        COUNT(i.id) AS item_count,
        COALESCE(SUM(i.base_salary), 0) AS total_base_salary,
        COALESCE(SUM(i.allowance_amount), 0) AS total_allowance_amount,
        COALESCE(SUM(i.deduction_amount), 0) AS total_deduction_amount,
        COALESCE(SUM(i.loan_deduction_amount), 0) AS total_loan_deduction_amount,
        COALESCE(SUM(i.asset_recovery_deduction_amount), 0) AS total_asset_recovery_deduction_amount,
        COALESCE(SUM(i.employee_social_insurance), 0) AS total_employee_social_insurance,
        COALESCE(SUM(i.employer_social_insurance), 0) AS total_employer_social_insurance,
        COALESCE(SUM(i.income_tax), 0) AS total_income_tax,
        COALESCE(SUM(i.penalty_deduction), 0) AS total_penalty_deduction,
        COALESCE(SUM(i.carried_forward_deduction), 0) AS total_carried_forward_deduction,
        COALESCE(SUM(i.gross_pay), 0) AS total_gross_pay,
        COALESCE(SUM(i.net_pay), 0) AS total_net_pay
      FROM hr_payroll_runs r
      LEFT JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id AND i.status <> 'excluded'
      WHERE r.tenant_id = ${auth.tenantId} AND (${month} = '' OR r.period_month = ${month})
      GROUP BY r.id
    `;
    const countResult = await sql<Record<string, unknown>>`
      SELECT COUNT(*)::text AS total FROM (${runsQuery}) s
    `.execute(this.db);
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 25);
    const totalItems = Number(countResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT * FROM (${runsQuery}) s
      ORDER BY s.period_month DESC, s.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);
    const runs = result.rows.map((row) => this.mapPayrollRun(row));
    // P8 (RC-7): the payroll page's month default comes from the server clock.
    return {
      runs,
      pagination: { page: safePage, pageSize, totalItems, totalPages },
      summary: { totalItems },
      serverTime: new Date().toISOString(),
      serverTimezone: tenantTimezone,
    };
  }

  async getPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const runResult = await sql<Record<string, unknown>>`
      SELECT
        r.*,
        to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
        to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text,
        to_char(r.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
        to_char(r.reviewed_at, 'YYYY-MM-DD HH24:MI') AS reviewed_at_text,
        to_char(r.approved_at, 'YYYY-MM-DD HH24:MI') AS approved_at_text,
        to_char(r.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at_text,
        COUNT(i.id) AS item_count,
        COALESCE(SUM(i.base_salary), 0) AS total_base_salary,
        COALESCE(SUM(i.allowance_amount), 0) AS total_allowance_amount,
        COALESCE(SUM(i.deduction_amount), 0) AS total_deduction_amount,
        COALESCE(SUM(i.loan_deduction_amount), 0) AS total_loan_deduction_amount,
        COALESCE(SUM(i.asset_recovery_deduction_amount), 0) AS total_asset_recovery_deduction_amount,
        COALESCE(SUM(i.employee_social_insurance), 0) AS total_employee_social_insurance,
        COALESCE(SUM(i.employer_social_insurance), 0) AS total_employer_social_insurance,
        COALESCE(SUM(i.income_tax), 0) AS total_income_tax,
        COALESCE(SUM(i.penalty_deduction), 0) AS total_penalty_deduction,
        COALESCE(SUM(i.carried_forward_deduction), 0) AS total_carried_forward_deduction,
        COALESCE(SUM(i.gross_pay), 0) AS total_gross_pay,
        COALESCE(SUM(i.net_pay), 0) AS total_net_pay
      FROM hr_payroll_runs r
      LEFT JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id AND i.status <> 'excluded'
      WHERE r.id = ${id} AND r.tenant_id = ${tenantId}
      GROUP BY r.id
      LIMIT 1
    `.execute(this.db);
    const run = runResult.rows[0];
    if (!run) throw new AppError('Payroll run not found', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    const itemResult = await sql<Record<string, unknown>>`
      SELECT
        i.*,
        e.display_name AS employee_name,
        e.employee_no,
        e.compensation_type,
        e.hourly_rate,
        e.expected_daily_hours,
        to_char(i.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
        to_char(i.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at_text
      FROM hr_payroll_run_items i
      JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
      WHERE i.run_id = ${id} AND i.tenant_id = ${tenantId}
      ORDER BY e.display_name ASC, i.id ASC
    `.execute(this.db);
    const periodMonth = clean(run.period_month);
    const employeeIds = itemResult.rows.map((row) => Number(row.employee_id || 0)).filter((value) => value > 0);
    const baseSalaryByEmployeeId = new Map<number, number>();
    for (const row of itemResult.rows) {
      const employeeId = Number(row.employee_id || 0);
      if (!(employeeId > 0)) continue;
      baseSalaryByEmployeeId.set(employeeId, Number(row.base_salary || 0));
    }
    const fromDate = String(run.start_date_text || `${periodMonth}-01`);
    const toDate = String(
      run.end_date_text ||
        new Date(Date.UTC(Number(periodMonth.split('-')[0]), Number(periodMonth.split('-')[1]), 0))
          .toISOString()
          .slice(0, 10),
    );
    const range = { from: fromDate, to: toDate };
    // An approved/paid payslip is an immutable financial snapshot. Its presentation
    // must not be recomputed using current (possibly newer) tax, leave or attendance
    // policies, which can change independently after approval.
    const reviewByEmployeeId = ['approved', 'paid', 'partially_paid'].includes(clean(run.status))
      ? new Map<number, any>()
      : await this.calculatePayrollOperationalReview(this.db, range, employeeIds, baseSalaryByEmployeeId, tenantId);
    const itemIds = itemResult.rows.map((row) => Number(row.id || 0)).filter((itemId) => itemId > 0);
    const adjustmentResult = itemIds.length
      ? await sql<Record<string, unknown>>`
          SELECT a.*, to_char(a.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text
          FROM hr_payroll_item_adjustments a
          WHERE a.payroll_item_id IN (${sql.join(itemIds)}) AND a.tenant_id = ${tenantId}
          ORDER BY a.id ASC
        `.execute(this.db)
      : { rows: [] };
    const adjustmentsByItem = new Map<string, Record<string, unknown>[]>();
    for (const adjustment of adjustmentResult.rows) {
      const key = String(adjustment.payroll_item_id);
      adjustmentsByItem.set(key, [...(adjustmentsByItem.get(key) || []), this.mapPayrollAdjustment(adjustment)]);
    }
    const items = itemResult.rows.map((row) => {
      const employeeId = Number(row.employee_id || 0);
      const review = reviewByEmployeeId.get(employeeId);
      return {
        ...this.mapPayrollItem(row),
        attendanceAbsentDays: review?.attendanceAbsentDays ?? 0,
        attendanceLateDays: review?.attendanceLateDays ?? 0,
        attendanceHalfDays: review?.attendanceHalfDays ?? 0,
        attendanceEarlyLeaveDays: review?.attendanceEarlyLeaveDays ?? 0,
        approvedLeaveDays: review?.approvedLeaveDays ?? 0,
        unpaidLeaveDays: review?.unpaidLeaveDays ?? 0,
        suggestedAttendanceDeductionAmount: review?.suggestedAttendanceDeductionAmount ?? 0,
        suggestedLeaveDeductionAmount: review?.suggestedLeaveDeductionAmount ?? 0,
        payrollReviewNotes: review?.payrollReviewNotes || '',
        unresolvedExceptionsCount: review?.unresolvedExceptionsCount || 0,
        adjustments: adjustmentsByItem.get(String(row.id)) || [],
      };
    });
    return { run: { ...this.mapPayrollRun(run), items } };
  }

  async createPayrollRun(payload: CreatePayrollRunDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const periodMonth = normalizePayrollMonth(payload.periodMonth);
    if (!periodMonth) throw new AppError('Payroll month must use YYYY-MM format', 'HR_PAYROLL_MONTH_INVALID', 400);
    const payFreq = clean(payload.payFrequency) || 'monthly';
    if (!['daily', 'weekly', 'biweekly', 'monthly', 'all'].includes(payFreq)) {
      throw new AppError('دورية صرف المرتب غير صحيحة', 'HR_PAYROLL_FREQUENCY_INVALID', 400);
    }
    const month = monthRange(periodMonth);
    const startDate = payload.startDate ? normalizeDateOnly(payload.startDate) : month.from;
    const endDate = payload.endDate ? normalizeDateOnly(payload.endDate) : month.to;
    const periodLengthDays =
      startDate && endDate
        ? Math.floor((Date.parse(endDate + 'T00:00:00Z') - Date.parse(startDate + 'T00:00:00Z')) / 86400000)
        : NaN;
    if (
      !startDate ||
      !endDate ||
      !Number.isFinite(periodLengthDays) ||
      periodLengthDays < 0 ||
      periodLengthDays > 366
    ) {
      throw new AppError('اختر تاريخ بداية ونهاية صحيحين لفترة القبض', 'HR_PAYROLL_PERIOD_INVALID', 400);
    }

    let runId = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      // The old month-only uniqueness silently reused a WEEKLY run for every
      // subsequent week. Serialize overlapping period checks within tenant/frequency.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const overlapping = await sql<{
        id: number;
        status: string;
        period_month: string;
        pay_frequency: string;
        start_date_text: string;
        end_date_text: string;
      }>`
        SELECT id, status, period_month, pay_frequency,
          to_char(start_date, 'YYYY-MM-DD') AS start_date_text,
          to_char(end_date, 'YYYY-MM-DD') AS end_date_text
        FROM hr_payroll_runs
        WHERE tenant_id = ${tenantId}
          AND status <> 'cancelled'
          AND start_date <= ${endDate}::date
          AND end_date >= ${startDate}::date
          AND (
            pay_frequency = ${payFreq}
            OR pay_frequency = 'all'
            OR ${payFreq} = 'all'
            OR EXISTS (
              SELECT 1 FROM hr_payroll_run_items prior_item
              JOIN hr_employees eligible
                ON eligible.id = prior_item.employee_id AND eligible.tenant_id = prior_item.tenant_id
              WHERE prior_item.run_id = hr_payroll_runs.id
                AND prior_item.tenant_id = hr_payroll_runs.tenant_id
                AND prior_item.status <> 'excluded'
                AND COALESCE(eligible.pay_frequency, 'monthly') = ${payFreq}
            )
          )
        ORDER BY id DESC
        FOR UPDATE
      `.execute(trx);

      if (overlapping.rows.some((row) => row.pay_frequency !== payFreq)) {
        throw new AppError(
          'لا يمكن إنشاء مسير بدورية مختلفة يغطي أيام موظفين موجودين في مسير آخر؛ راجع المسير المتداخل',
          'HR_PAYROLL_CROSS_FREQUENCY_OVERLAP',
          409,
        );
      }
      if (overlapping.rows.some((row) => row.start_date_text !== startDate || row.end_date_text !== endDate)) {
        throw new AppError(
          'يوجد كشف مرتبات آخر يتداخل مع هذه الفترة. اختر فترة غير متداخلة لمنع تكرار الصرف.',
          'HR_PAYROLL_PERIOD_OVERLAP',
          409,
        );
      }
      const existing = overlapping.rows[0];
      if (existing) {
        if (existing.period_month !== periodMonth) {
          throw new AppError('هذه الفترة موجودة بالفعل تحت شهر مرتب مختلف', 'HR_PAYROLL_MONTH_CONFLICT', 409);
        }
        if (existing.status === 'paid') {
          throw new AppError('مسير الرواتب لهذه الفترة تم صرفه وإغلاقه بالفعل', 'HR_PAYROLL_ALREADY_PAID', 400);
        }
        if (existing.status === 'approved') {
          throw new AppError('مسير الرواتب لهذه الفترة معتمد وجاهز للصرف', 'HR_PAYROLL_ALREADY_APPROVED', 400);
        }
        runId = Number(existing.id);
      } else {
        const inserted = await sql<{ id: number }>`
          INSERT INTO hr_payroll_runs (tenant_id, account_id, period_month, start_date, end_date, pay_frequency, status, notes, created_by)
          VALUES (${tenantId}, ${auth.accountId}, ${periodMonth}, ${startDate}::date, ${endDate}::date, ${payFreq}, 'draft', ${clean(payload.notes)}, ${auth.userId})
          RETURNING id
        `.execute(trx);
        runId = Number(inserted.rows[0]?.id || 0);
        await this.rebuildPayrollRunItems(trx, runId, 'draft', auth.tenantId || '');
      }
    });
    await this.audit.log(
      'Create HR payroll run',
      `Payroll ${periodMonth} [${startDate}..${endDate}] prepared by ${auth.username}`,
      auth,
    );
    return this.getPayrollRun(runId, auth);
  }

  /** A late hire inserted after review changes payroll's eligible employee
   * population. Serialize both HR employee writers and payroll review/approve
   * against the tenant payroll advisory lock BEFORE calling this helper.
   */
  async invalidateReviewedPayrollForNewHire(
    db: Kysely<Database>,
    tenantId: string,
    hireDate: string,
    payFrequency: string,
  ): Promise<void> {
    const reviewed = await sql<{ id: number }>`
      SELECT id FROM hr_payroll_runs
      WHERE tenant_id = ${tenantId} AND status = 'reviewed'
        AND start_date <= ${hireDate}::date AND end_date >= ${hireDate}::date
        AND (pay_frequency = 'all' OR pay_frequency = ${payFrequency})
      FOR UPDATE
    `.execute(db);
    for (const run of reviewed.rows) {
      await this.invalidatePayrollRunReview(db, Number(run.id), tenantId);
    }
  }

  /** Financial recalculation invalidates the former review approval.
   * Call only inside the run's locked transaction, AFTER rebuilding its items.
   */
  async invalidatePayrollRunReview(db: Kysely<Database>, runId: number, tenantId: string): Promise<void> {
    await sql`
      UPDATE hr_payroll_run_items SET status = 'draft', updated_at = NOW()
      WHERE run_id = ${runId} AND tenant_id = ${tenantId} AND status = 'reviewed'
    `.execute(db);
    await sql`
      UPDATE hr_payroll_runs
      SET status = 'draft', reviewed_by = NULL, reviewed_at = NULL, updated_at = NOW()
      WHERE id = ${runId} AND tenant_id = ${tenantId} AND status = 'reviewed'
    `.execute(db);
  }

  async recalculatePayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, auth.tenantId || '');
      if (status !== 'draft' && status !== 'reviewed')
        throw new AppError(
          'Only draft or reviewed payroll runs can be recalculated',
          'HR_PAYROLL_RECALCULATE_LOCKED',
          400,
        );
      await this.rebuildPayrollRunItems(trx, id, 'draft', auth.tenantId || '');
      if (status === 'reviewed') {
        await this.invalidatePayrollRunReview(trx, id, auth.tenantId || '');
      }
    });
    await this.audit.log('Recalculate HR payroll run', `Payroll run #${id} recalculated by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async reviewPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, auth.tenantId || '');
      if (status !== 'draft' && status !== 'reviewed') {
        throw new AppError('Only draft or reviewed payroll runs can be reviewed', 'HR_PAYROLL_REVIEW_LOCKED', 400);
      }
      // A reviewed run can be re-reviewed after a statutory rule or attendance
      // correction; all items are recalculated against current approved inputs.
      await this.rebuildPayrollRunItems(trx, id, status, auth.tenantId || '');

      await sql`UPDATE hr_payroll_run_items SET status = 'reviewed', updated_at = NOW() WHERE run_id = ${id} AND status = 'draft' AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
      await sql`UPDATE hr_payroll_runs SET status = 'reviewed', reviewed_by = ${auth.userId}, reviewed_at = NOW(), updated_at = NOW() WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
    });
    await this.audit.log('Review HR payroll run', `Payroll run #${id} reviewed by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async cancelPayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, tenantId);
      if (status === 'cancelled') return; // idempotent; do not release any other run
      if (!['draft', 'reviewed'].includes(status)) {
        throw new AppError('Approved or paid payroll runs cannot be cancelled', 'HR_PAYROLL_CANCEL_LOCKED', 400);
      }
      // Draft/review materialization marks pending employee adjustments as
      // applied. Cancelling without releasing those entries loses legitimate
      // bonuses and deductions from every later payroll.
      await sql`
        UPDATE hr_employee_adjustments
        SET status = 'pending', applied_in_run_id = NULL
        WHERE tenant_id = ${tenantId} AND applied_in_run_id = ${id}
          AND status = 'applied'
      `.execute(trx);
      await sql`
        UPDATE hr_payroll_runs SET status = 'cancelled', updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId} AND status IN ('draft', 'reviewed')
      `.execute(trx);
    });
    await this.audit.log('Cancel HR payroll run', `Payroll run #${id} cancelled by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async generatePayrollWps(id: number, payload: GenerateWpsDto, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    // D5 (INV-WPS-PAID-RUN-EXPORT): exporting bank details (IBANs, national
    // IDs) requires payroll-manage permission, not view-only.
    if (!hasHrPermission(auth, 'hrPayrollManage')) {
      throw new AppError('تصدير البيانات البنكية يتطلب صلاحية إدارة المرتبات', 'HR_PAYROLL_EXPORT_FORBIDDEN', 403);
    }
    const runResult = await sql<Record<string, unknown>>`
      SELECT r.*,
        to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
        to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text
      FROM hr_payroll_runs r
      WHERE r.id = ${id} AND r.tenant_id = ${auth.tenantId}
    `.execute(this.db);
    const run = runResult.rows[0];
    if (!run) throw new AppError('مسير الرواتب غير موجود', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    if (!['approved', 'paid'].includes(clean(run.status))) {
      throw new AppError('لا يمكن تصدير مرتبات بنكية قبل اعتماد الكشف', 'HR_PAYROLL_EXPORT_NOT_APPROVED', 400);
    }

    // INV-PAYROLL-EXPORT-REQUIRES-ACCRUAL: a bank review file may
    // only be exported against a booked accrual. The export must
    // never outrun the ledger — an approved run whose accrual
    // journal is missing (or was reversed) exports nothing.
    // "Active" is the posting service's own definition: status
    // 'posted' with no reversal link.
    const accrualJournals = await sql<{ status: string; reversed_by_entry_id: number | null }>`
      SELECT status, reversed_by_entry_id FROM journal_entries
      WHERE source_type = 'hr_payroll_accrual' AND source_id = ${id} AND tenant_id = ${auth.tenantId}
    `.execute(this.db);
    const hasActiveAccrual = accrualJournals.rows.some(
      (row) => clean(row.status) === 'posted' && !row.reversed_by_entry_id,
    );
    if (!hasActiveAccrual) {
      const wasReversed = accrualJournals.rows.some((row) => !!row.reversed_by_entry_id);
      if (wasReversed) {
        throw new AppError(
          'قيد استحقاق الرواتب لهذا المسير تم عكسه، لا يمكن تصدير ملف بنكي',
          'HR_PAYROLL_EXPORT_ACCRUAL_REVERSED',
          409,
        );
      }
      throw new AppError(
        'لا يوجد قيد استحقاق مرحل لهذا المسير، لا يمكن تصدير ملف بنكي',
        'HR_PAYROLL_EXPORT_ACCRUAL_MISSING',
        409,
      );
    }

    // D5: the review CSV may export paid runs too — the run-status gate
    // allows 'paid', so the items query must select paid items as well.
    // Certified SIF generation stays disabled (sifContent is always '').
    const itemsResult = await sql<Record<string, unknown>>`
      SELECT
        i.*,
        e.employee_no,
        e.national_id,
        e.display_name,
        e.bank_name,
        e.bank_account_number,
        e.iban,
        e.bank_swift_code
      FROM hr_payroll_run_items i
      JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
      WHERE i.run_id = ${id} AND i.status IN ('approved', 'paid') AND i.tenant_id = ${auth.tenantId}
      ORDER BY e.employee_no ASC, e.display_name ASC
    `.execute(this.db);

    if (!itemsResult.rows.length)
      throw new AppError('لا توجد مرتبات معتمدة أو مدفوعة للتصدير', 'HR_PAYROLL_EXPORT_EMPTY', 400);
    const badRow = itemsResult.rows.find((row) => {
      return (
        !clean(row.employee_no) ||
        !clean(row.display_name) ||
        !clean(row.national_id) ||
        !clean(row.bank_name) ||
        (!clean(row.iban) && !clean(row.bank_account_number))
      );
    });
    if (badRow) {
      throw new AppError(
        `استكمل رقم الموظف والهوية والبنك ورقم الحساب/الآيبان للموظف ${clean(badRow.display_name) || String(badRow.employee_id)} قبل تصدير الملف`,
        'HR_PAYROLL_EXPORT_BANK_DETAILS_MISSING',
        400,
      );
    }
    const createDate = todayTenantDate(await getTenantTimezone(this.db, auth.tenantId || ''));
    const periodMonth = clean(run.period_month) || createDate.slice(0, 7);
    const startDate = clean(run.start_date_text) || `${periodMonth}-01`;
    const endDate = clean(run.end_date_text) || `${periodMonth}-28`;

    const settingsRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', auth.tenantId || '')
      .execute();
    const tenantSettings: Record<string, any> = {};
    for (const row of settingsRows) {
      try {
        tenantSettings[row.key] = JSON.parse(row.value);
      } catch {
        tenantSettings[row.key] = row.value;
      }
    }

    const configuredCurrency = clean(tenantSettings.currency).toUpperCase();
    const currency = clean(payload.currency || configuredCurrency).toUpperCase();
    if (!/^[A-Z]{3}$/.test(configuredCurrency) || configuredCurrency !== currency) {
      throw new AppError(
        'عملة كشف التحويل غير مدعومة أو لا تطابق عملة المنشأة',
        'HR_PAYROLL_EXPORT_CURRENCY_MISMATCH',
        409,
      );
    }
    // INV-HR-PAYROLL-BOOK-PRECISION: the review CSV formats stored run
    // amounts at book precision; KWD/OMR runs are no longer blocked here.
    // Certified WPS/SIF generation stays deliberately disabled above.
    const exportDigits = currencyMoneyDigits(currency);

    let totalNetPay = 0;
    let totalBaseSalary = 0;
    let totalAllowances = 0;
    let totalDeductions = 0;

    const mappedRecords = itemsResult.rows.map((row) => {
      const netPay = Number(row.net_pay || 0);
      const baseSalary = Number(row.base_salary || 0);
      const allowances = Number(row.allowance_amount || 0);
      const deductions =
        Number(row.deduction_amount || 0) +
        Number(row.loan_deduction_amount || 0) +
        Number(row.asset_recovery_deduction_amount || 0);

      totalNetPay += netPay;
      totalBaseSalary += baseSalary;
      totalAllowances += allowances;
      totalDeductions += deductions;

      return {
        id: Number(row.id),
        employeeId: Number(row.employee_id),
        employeeNo: clean(row.employee_no),
        displayName: clean(row.display_name),
        nationalId: clean(row.national_id),
        bankName: clean(row.bank_name),
        bankAccountNumber: clean(row.bank_account_number),
        iban: clean(row.iban),
        bankSwiftCode: clean(row.bank_swift_code),
        baseSalary,
        allowances,
        deductions,
        netPay,
      };
    });

    const totalEmployees = mappedRecords.length;

    // Deliberately disabled: a universal SCR/EDR template is NOT a certified
    // WPS format for Egypt, Saudi Arabia, Kuwait, Qatar or Oman. Never generate
    // a pseudo-compliant banking file; only the review CSV is available.
    const sifContent = '';

    // Standard CSV export
    const csvHeaders = [
      'رقم الموظف',
      'اسم الموظف',
      'الهوية / الإقامة',
      'البنك',
      'الآيبان / الحساب',
      'السويفت',
      'الراتب الأساسي',
      'البدلات',
      'الخصومات',
      'صافي الراتب',
    ];
    // Spreadsheet cells can execute formulas even inside quoted CSV fields.
    // Preserve bank identifiers as literal text and escape all quotes and line breaks.
    const csvCell = (value: unknown): string => {
      let s = String(value ?? '')
        .replace(/[\r\n\t]/g, ' ')
        .trim();
      if (/^[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const csvLines = mappedRecords.map((r) =>
      [
        csvCell(r.employeeNo),
        csvCell(r.displayName),
        csvCell(r.nationalId),
        csvCell(r.bankName),
        csvCell(r.iban || r.bankAccountNumber),
        csvCell(r.bankSwiftCode),
        r.baseSalary.toFixed(exportDigits),
        r.allowances.toFixed(exportDigits),
        r.deductions.toFixed(exportDigits),
        r.netPay.toFixed(exportDigits),
      ].join(','),
    );
    const csvContent = [csvHeaders.join(','), ...csvLines].join('\r\n');

    await this.audit.log(
      'Export HR payroll bank review CSV',
      `Payroll run #${id} exported as REVIEW CSV (not certified WPS) by ${auth.username} (${totalEmployees} employees, total: ${totalNetPay})`,
      auth,
    );

    return {
      ok: true,
      runId: id,
      runName: clean(run.name),
      periodMonth,
      startDate,
      endDate,
      summary: {
        totalEmployees,
        totalNetPay,
        totalBaseSalary,
        totalAllowances,
        totalDeductions,
        currency,
        missingIbanCount: mappedRecords.filter((r) => !r.iban && !r.bankAccountNumber).length,
      },
      sifContent,
      csvContent,
      records: mappedRecords,
    };
  }

  async updatePayrollRunItem(
    id: number,
    payload: UpsertPayrollItemDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    let runId = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      // Run lock serializes item exclusion against review/approval and freezes
      // the financial snapshot before either committed status may change.
      const locked = await sql<{ run_id: number; run_status: string; item_status: string }>`
        SELECT r.id AS run_id, r.status AS run_status, i.status AS item_status
        FROM hr_payroll_run_items i
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE i.id = ${id} AND i.tenant_id = ${tenantId}
        FOR UPDATE OF r, i
      `.execute(trx);
      const item = locked.rows[0];
      if (!item) throw new AppError('Payroll item not found', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
      if (item.run_status !== 'draft')
        throw new AppError(
          'Payroll items can only be edited while the run is draft',
          'HR_PAYROLL_ITEM_EDIT_LOCKED',
          400,
        );
      const status = clean(payload.status);
      if (status && !['draft', 'excluded'].includes(status))
        throw new AppError('Payroll item status is invalid', 'HR_PAYROLL_ITEM_STATUS_INVALID', 400);
      runId = Number(item.run_id);
      await sql`
        UPDATE hr_payroll_run_items
        SET status = ${status || item.item_status || 'draft'},
            notes = ${
              status === 'excluded'
                ? combineNotes(clean(payload.notes), MANUAL_PAYROLL_EXCLUSION_NOTE)
                : clean(payload.notes)
            },
            updated_at = NOW()
        WHERE id = ${id} AND run_id = ${runId} AND tenant_id = ${tenantId}
      `.execute(trx);
    });
    await this.audit.log('Update HR payroll item', `Payroll item #${id} updated by ${auth.username}`, auth);
    return this.getPayrollRun(runId, auth);
  }

  async createPayrollAdjustment(
    id: number,
    payload: CreatePayrollAdjustmentDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const item = await this.getPayrollItemRun(this.db, id, auth.tenantId || '');
    if (item.runStatus !== 'draft')
      throw new AppError(
        'Payroll adjustments can only be edited while the run is draft',
        'HR_PAYROLL_ADJUSTMENT_LOCKED',
        400,
      );
    const adjustmentBookDigits = await tenantBookDigits(this.db, auth.tenantId || '');
    try {
      requireLoanMoney(Number(payload.amount), adjustmentBookDigits);
    } catch {
      throw new AppError(
        'مبلغ تعديل المرتب يجب أن يكون موجبًا وبدقة دفاتر المنشأة دون تقريب',
        'HR_PAYROLL_ADJUSTMENT_AMOUNT_INVALID',
        400,
      );
    }
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      // Recheck while holding the same payroll-run row lock as review/approval.
      const locked = await sql<{ status: string }>`
        SELECT r.status FROM hr_payroll_runs r
        JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
        WHERE i.id = ${id} AND i.tenant_id = ${auth.tenantId}
        FOR UPDATE OF r
      `.execute(trx);
      if (locked.rows[0]?.status !== 'draft') {
        throw new AppError(
          'Payroll adjustments can only be edited while the run is draft',
          'HR_PAYROLL_ADJUSTMENT_LOCKED',
          400,
        );
      }
      await sql`
        INSERT INTO hr_payroll_item_adjustments (tenant_id, account_id, payroll_item_id, adjustment_type, label, amount, notes)
        VALUES (${auth.tenantId}, ${auth.accountId}, ${id}, ${clean(payload.adjustmentType)}, ${clean(payload.label)}, ${money(payload.amount, adjustmentBookDigits)}, ${clean(payload.notes)})
      `.execute(trx);
      await this.recalculatePayrollItemTotals(trx, id, requireTenantScope(auth).tenantId);
      await sql`UPDATE hr_payroll_runs SET updated_at = NOW() WHERE id = ${item.runId} AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
    });
    await this.audit.log(
      'Create HR payroll adjustment',
      `Payroll item #${id} adjustment added by ${auth.username}`,
      auth,
    );
    return this.getPayrollRun(item.runId, auth);
  }

  async deletePayrollAdjustment(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    let runId = 0;
    let itemId = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const result = await sql<{ payroll_item_id: number; run_id: number; run_status: string }>`
        SELECT a.payroll_item_id, i.run_id, r.status AS run_status
        FROM hr_payroll_item_adjustments a
        JOIN hr_payroll_run_items i ON i.id = a.payroll_item_id AND i.tenant_id = a.tenant_id
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE a.id = ${id} AND a.tenant_id = ${auth.tenantId}
        FOR UPDATE OF r, i
      `.execute(trx);
      const row = result.rows[0];
      if (!row) throw new AppError('Payroll adjustment not found', 'HR_PAYROLL_ADJUSTMENT_NOT_FOUND', 404);
      if (clean(row.run_status) !== 'draft')
        throw new AppError(
          'Payroll adjustments can only be edited while the run is draft',
          'HR_PAYROLL_ADJUSTMENT_LOCKED',
          400,
        );
      runId = Number(row.run_id || 0);
      itemId = Number(row.payroll_item_id || 0);
      await sql`DELETE FROM hr_payroll_item_adjustments WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(trx);
      await this.recalculatePayrollItemTotals(trx, itemId, requireTenantScope(auth).tenantId);
      await sql`UPDATE hr_payroll_runs SET updated_at = NOW() WHERE id = ${runId} AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
    });
    await this.audit.log('Delete HR payroll adjustment', `Payroll adjustment #${id} deleted by ${auth.username}`, auth);
    return this.getPayrollRun(runId, auth);
  }
}
