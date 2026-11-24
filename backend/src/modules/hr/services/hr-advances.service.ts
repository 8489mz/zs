import { Injectable } from '@nestjs/common';
import { CashDrawerService } from '../../cash-drawer/cash-drawer.service';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { calculateEmployeeWithdrawalBalance, resolveDirectAdvanceCashCap, type EmployeeWithdrawalBalanceResult } from '../engines/employee-withdrawal-balance.engine';
import { verifyPassword } from '../../../core/auth/utils/password-hasher';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { clean, toId, normalizeDateOnly, tenantBookDigits, normalizePayrollMonth, monthRange, tenantCurrencyCode } from '../hr-helpers';

/**
 * HrAdvancesService — slice H5 of the hr split.
 * Pure move of 3 methods from HrService (advances + withdrawal:
 * withdrawals, getEmployeeWithdrawalBalance, createQuickCashAdvance).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures for all 3 methods.
 * Deps: db + tx + audit + accountingPosting, passed through as received
 * (all REQUIRED, no fallback); cashDrawer is OPTIONAL (passed through
 * as received; createQuickCashAdvance guards it with a ternary, L7372).
 * CORRECTION (grounding, hr-h5-ground.log): prep §6 lists treasury as a
 * dep, but the moved text has ZERO this.treasury refs — the slice takes
 * NO treasury field (H9-class overcount). Bound deps: getPayrollPolicies
 * (H0 delegate), rebuildPayrollRunItems (H8 slice), invalidatePayrollRun-
 * Review (H7 slice) — all merge before H5, so their facade fields exist
 * at merge. Free helpers (clean, toId, normalizeDateOnly,
 * tenantBookDigits, normalizePayrollMonth, monthRange, tenantCurrencyCode)
 * are imported from ../hr-helpers — that file is created by the H0 merge
 * and does not exist on this generation tree yet; the import is still
 * correct. Date handling travels verbatim: getTenantTimezone (4x) +
 * todayTenantDate (3x) with their tenant-tz arguments; the month-length
 * Date.UTC site in getEmployeeWithdrawalBalance (L7051) is a day-count
 * computation, NOT the UTC-slice key, and stays byte-identical; the 2
 * .slice(0, 10) sites are pg DATE/text reads (display only). Guard: the
 * 6 toFixed2 sites all live in withdrawals (withdrawal preview amounts);
 * the facade entry drops 11 -> 5 on this generation tree + the H5 entry
 * (6, 0) — at merge H3 has already taken the facade to 6, so the
 * coordinator rebases that hunk to 6 -> 0 (see build script header).
 * tenant-scoped-reads MT-04 reads withdrawals via a section slice — its
 * multi-file repoint is merge-owned (prep §7.3), NOT in this patch.
 */

export interface HrAdvancesDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  cashDrawer?: CashDrawerService;
  getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
  rebuildPayrollRunItems: (
    db: Kysely<Database>,
    runId: number,
    itemStatus: 'draft' | 'reviewed' | 'approved',
    scopeTenantId: string,
  ) => Promise<void>;
  invalidatePayrollRunReview: (db: Kysely<Database>, runId: number, tenantId: string) => Promise<void>;
}

@Injectable()
export class HrAdvancesService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly cashDrawer?: CashDrawerService;
  private readonly getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
  private readonly rebuildPayrollRunItems: (
    db: Kysely<Database>,
    runId: number,
    itemStatus: 'draft' | 'reviewed' | 'approved',
    scopeTenantId: string,
  ) => Promise<void>;
  private readonly invalidatePayrollRunReview: (db: Kysely<Database>, runId: number, tenantId: string) => Promise<void>;

  constructor(deps: HrAdvancesDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.cashDrawer = deps.cashDrawer;
    this.getPayrollPolicies = deps.getPayrollPolicies;
    this.rebuildPayrollRunItems = deps.rebuildPayrollRunItems;
    this.invalidatePayrollRunReview = deps.invalidatePayrollRunReview;
  }

  async withdrawals(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const employeeId = toId(query.employeeId);
    if (!employeeId) throw new AppError('Employee is required', 'HR_WITHDRAWALS_EMPLOYEE_REQUIRED', 400);

    const period = clean(query.period) || 'current_month';
    const requestedMonth = clean(query.month);
    const customFrom = normalizeDateOnly(query.from);
    const customTo = normalizeDateOnly(query.to);

    const employeeResult = await sql<{ hire_date_text: string | null; display_name: string }>`
      SELECT to_char(hire_date, 'YYYY-MM-DD') AS hire_date_text, display_name
      FROM hr_employees
      WHERE id = ${employeeId} AND tenant_id = ${tenantId}
      LIMIT 1
    `.execute(this.db);
    const employee = employeeResult.rows[0];
    if (!employee) throw new AppError('Employee not found', 'HR_EMPLOYEE_NOT_FOUND', 404);

    // Financial date selectors follow the tenant's local calendar, never UTC
    // server midnight (which is a different payroll day in Egypt/GCC).
    const today = todayTenantDate(await getTenantTimezone(this.db, tenantId));
    const currentMonth = today.slice(0, 7);
    if (requestedMonth && !normalizePayrollMonth(requestedMonth)) {
      throw new AppError('الشهر المطلوب غير صحيح', 'HR_WITHDRAWALS_MONTH_INVALID', 400);
    }
    if (period === 'custom' && (
      (query.from && !customFrom) || (query.to && !customTo)
      || (customFrom && customTo && customFrom > customTo)
    )) {
      throw new AppError('نطاق تواريخ المسحوبات غير صحيح', 'HR_WITHDRAWALS_RANGE_INVALID', 400);
    }
    const monthValue = normalizePayrollMonth(requestedMonth) || currentMonth;
    const { from: monthFrom, to: monthTo } = monthRange(monthValue);
    const hireDate = clean(employee.hire_date_text) || '1900-01-01';
    const fromDate = period === 'custom'
      ? customFrom || monthFrom
      : period === 'since_hire'
        ? hireDate
        : period === 'all'
          ? ''
          : monthFrom;
    const toDate = period === 'custom'
      ? customTo || monthTo
      : period === 'since_hire'
        ? today
        : period === 'all'
          ? ''
          : monthTo;

    // INV-HR-WITHDRAWALS-SQL-PAGINATION: the two unbounded queries are
    // merged in SQL (UNION ALL). The movement-date rule, the loan status
    // filter, the period filter and the sort are all pushed to the
    // database; the JS mappers below run only on the page's rows, with
    // byte-identical bodies. The summary sums come from two aggregate
    // queries: the 4 period-filtered sums over the merged set, and the
    // 3 loan-set sums over hr_employee_loans (never period-filtered).
    const loanStatus = sql<string>`COALESCE(NULLIF(btrim(l.status), ''), 'draft')`;
    const merged = sql`
      SELECT
        'loan' AS kind, l.id AS id, ('loan-' || l.id) AS display_id,
        l.employee_id AS employee_id, e.display_name AS employee_name,
        COALESCE(NULLIF(actor.display_name, ''), actor.username, 'النظام') AS recorded_by_name,
        CASE WHEN ${loanStatus} IN ('paid', 'disbursed', 'partially_repaid', 'repaid')
          THEN COALESCE(NULLIF(to_char(l.disbursed_at, 'YYYY-MM-DD HH24:MI'), ''), NULLIF(to_char(l.created_at, 'YYYY-MM-DD HH24:MI'), ''), NULLIF(CASE WHEN l.issue_date IS NULL THEN '' ELSE to_char(l.issue_date, 'YYYY-MM-DD') || ' 00:00' END, ''))
          ELSE COALESCE(NULLIF(CASE WHEN l.issue_date IS NULL THEN '' ELSE to_char(l.issue_date, 'YYYY-MM-DD') || ' 00:00' END, ''), NULLIF(to_char(l.created_at, 'YYYY-MM-DD HH24:MI'), ''))
        END AS movement_at,
        CASE WHEN btrim(COALESCE(l.loan_type, '')) = 'loan' THEN 'loan' ELSE 'advance' END AS row_type,
        COALESCE(l.principal_amount, 0) AS amount,
        ${loanStatus} AS status,
        '' AS repayment_method,
        COALESCE(NULLIF(btrim(l.repayment_mode), ''), 'manual_cash') AS repayment_mode,
        COALESCE(l.remaining_amount, 0) AS remaining_amount,
        NULL::numeric AS balance_after,
        to_char(l.issue_date, 'YYYY-MM-DD') AS issue_date_text, l.issue_date AS issue_date,
        to_char(l.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text, l.created_at AS created_at,
        to_char(l.disbursed_at, 'YYYY-MM-DD HH24:MI') AS disbursed_at_text, l.disbursed_at AS disbursed_at,
        to_char(latest_paid.latest_paid_at, 'YYYY-MM-DD HH24:MI') AS paid_at_text, latest_paid.latest_paid_at AS latest_paid_at,
        l.loan_type AS loan_type, l.principal_amount AS principal_amount,
        NULL::bigint AS reference_id, NULL::text AS note, l.notes AS notes, NULL::text AS movement_at_text
      FROM hr_employee_loans l
      JOIN hr_employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
      LEFT JOIN users actor ON actor.id = l.created_by AND actor.tenant_id = l.tenant_id
      LEFT JOIN (
        SELECT loan_id, MAX(paid_at) AS latest_paid_at
        FROM hr_employee_loan_installments
        WHERE paid_at IS NOT NULL AND tenant_id = ${tenantId}
        GROUP BY loan_id
      ) latest_paid ON latest_paid.loan_id = l.id
      WHERE l.employee_id = ${employeeId} AND l.tenant_id = ${tenantId}
        AND ${loanStatus} IN ('paid', 'disbursed', 'partially_repaid', 'repaid')
      UNION ALL
      SELECT
        'repayment' AS kind, le.id AS id, ('ledger-' || le.id) AS display_id,
        le.employee_id AS employee_id, e.display_name AS employee_name,
        COALESCE(NULLIF(actor.display_name, ''), actor.username, 'النظام') AS recorded_by_name,
        COALESCE(to_char(le.created_at, 'YYYY-MM-DD HH24:MI'), '') AS movement_at,
        'repayment' AS row_type,
        ABS(COALESCE(le.amount, 0)) AS amount,
        'recorded' AS status,
        COALESCE(NULLIF(btrim(le.repayment_method), ''), 'manual_cash') AS repayment_method,
        '' AS repayment_mode,
        NULL::numeric AS remaining_amount,
        COALESCE(le.balance_after, 0) AS balance_after,
        NULL::text AS issue_date_text, NULL::date AS issue_date,
        to_char(le.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text, le.created_at AS created_at,
        NULL::text AS disbursed_at_text, NULL::timestamptz AS disbursed_at,
        NULL::text AS paid_at_text, NULL::timestamptz AS latest_paid_at,
        NULL::text AS loan_type, NULL::numeric AS principal_amount,
        le.reference_id AS reference_id, le.note AS note, NULL::text AS notes,
        to_char(le.created_at, 'YYYY-MM-DD HH24:MI') AS movement_at_text
      FROM hr_employee_ledger le
      JOIN hr_employees e ON e.id = le.employee_id AND e.tenant_id = le.tenant_id
      LEFT JOIN users actor ON actor.id = le.created_by AND actor.tenant_id = le.tenant_id
      WHERE le.employee_id = ${employeeId} AND le.tenant_id = ${tenantId}
        AND le.entry_type = 'loan_repayment'
    `;
    const periodFilter = sql<boolean>`movement_at <> '' AND (${fromDate} = '' OR substr(movement_at, 1, 10) >= ${fromDate}) AND (${toDate} = '' OR substr(movement_at, 1, 10) <= ${toDate})`;
    const totals = await sql<{ total_items: string; total_withdrawals: string; total_repayments: string; total_manual_cash: string; total_salary_deduction: string }>`
      SELECT COUNT(*)::text AS total_items,
        COALESCE(SUM(amount) FILTER (WHERE row_type <> 'repayment'), 0)::text AS total_withdrawals,
        COALESCE(SUM(amount) FILTER (WHERE row_type = 'repayment'), 0)::text AS total_repayments,
        COALESCE(SUM(amount) FILTER (WHERE row_type = 'repayment' AND repayment_method = 'manual_cash'), 0)::text AS total_manual_cash,
        COALESCE(SUM(amount) FILTER (WHERE row_type = 'repayment' AND repayment_method = 'salary_deduction'), 0)::text AS total_salary_deduction
      FROM (${merged}) AS m
      WHERE ${periodFilter}
    `.execute(this.db);
    const totalItems = Number(totals.rows[0]?.total_items || 0);
    const loanTotals = await sql<{ total_remaining: string; total_due: string; open_count: string }>`
      SELECT
        COALESCE(SUM(COALESCE(remaining_amount, 0)) FILTER (WHERE ${loanStatus} IN ('paid', 'disbursed', 'partially_repaid')), 0)::text AS total_remaining,
        COALESCE(SUM(COALESCE(remaining_amount, 0)) FILTER (WHERE ${loanStatus} IN ('paid', 'disbursed', 'partially_repaid') AND COALESCE(NULLIF(btrim(repayment_mode), ''), 'manual_cash') <> 'manual_cash'), 0)::text AS total_due,
        COUNT(*) FILTER (WHERE ${loanStatus} IN ('paid', 'disbursed', 'partially_repaid') AND COALESCE(remaining_amount, 0) > 0)::text AS open_count
      FROM hr_employee_loans l
      WHERE l.employee_id = ${employeeId} AND l.tenant_id = ${tenantId}
    `.execute(this.db);
    // paginateRows semantics preserved: defaultSize 50, page clamped
    // to [1, totalPages], totalPages = max(1, ceil(total / pageSize)).
    // The cap is now 200 (boundedPage), not 100.
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 50);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const pageResult = await sql<Record<string, unknown>>`
      SELECT * FROM (${merged}) AS m
      WHERE ${periodFilter}
      ORDER BY movement_at DESC, display_id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);

    const movementDateForLoan = (row: Record<string, unknown>): string => {
      const status = clean(row.status);
      const issueDate = clean(row.issue_date_text) || (row.issue_date ? String(row.issue_date).slice(0, 10) : '');
      const issueDateTime = issueDate ? `${issueDate} 00:00` : '';
      const createdAt = clean(row.created_at_text) || (row.created_at ? String(row.created_at).replace('T', ' ').slice(0, 16) : '');
      const disbursedAt = clean(row.disbursed_at_text) || (row.disbursed_at ? String(row.disbursed_at).replace('T', ' ').slice(0, 16) : '');
      const paidAt = clean(row.paid_at_text) || (row.paid_at ? String(row.paid_at).replace('T', ' ').slice(0, 16) : '') || (row.latest_paid_at ? String(row.latest_paid_at).replace('T', ' ').slice(0, 16) : '');

      if (['paid', 'disbursed', 'partially_repaid', 'repaid'].includes(status)) {
        // Repayment dates must NOT replace the original disbursement date.
        // Otherwise old withdrawals jump between months when installments are paid.
        return disbursedAt || createdAt || issueDateTime;
      }

      return issueDateTime || createdAt;
    };

    const toLoanRow = (row: Record<string, unknown>) => {
      const movementAt = movementDateForLoan(row);
      return {
        id: `loan-${String(row.id)}`,
        loanId: String(row.id),
        referenceId: String(row.id),
        employeeId: String(row.employee_id),
        employeeName: clean(row.employee_name),
        movementAt,
        date: movementAt,
        type: clean(row.loan_type) === 'loan' ? 'loan' : 'advance',
        amount: Number(row.principal_amount || 0),
        repaymentMode: clean(row.repayment_mode) || 'manual_cash',
        repaymentMethod: '',
        status: clean(row.status) || 'draft',
        remainingAmount: Number(row.remaining_amount || 0),
        note: clean(row.notes),
        recordedByName: clean(row.recorded_by_name),
      };
    };

    const toRepaymentRow = (row: Record<string, unknown>) => {
      const movementAt = clean(row.movement_at_text) || (row.created_at ? String(row.created_at).replace('T', ' ').slice(0, 16) : '');
      const repaymentMethod = clean(row.repayment_method) || 'manual_cash';
      return {
        id: `ledger-${String(row.id)}`,
        loanId: row.reference_id ? String(row.reference_id) : '',
        referenceId: row.reference_id ? String(row.reference_id) : '',
        employeeId: String(row.employee_id),
        employeeName: clean(row.employee_name),
        movementAt,
        date: movementAt,
        type: 'repayment',
        amount: Math.abs(Number(row.amount || 0)),
        repaymentMode: repaymentMethod,
        repaymentMethod,
        status: 'recorded',
        remainingAmount: Number(row.balance_after || 0),
        note: clean(row.note),
        recordedByName: clean(row.recorded_by_name),
      };
    };

    const rows = pageResult.rows.map((row) => (row.kind === 'loan' ? toLoanRow(row) : toRepaymentRow(row)));

    const totalWithdrawals = Number(Number(totals.rows[0]?.total_withdrawals || 0).toFixed(2));
    const totalRepayments = Number(Number(totals.rows[0]?.total_repayments || 0).toFixed(2));
    const totalManualCashRepayments = Number(Number(totals.rows[0]?.total_manual_cash || 0).toFixed(2));
    const totalSalaryDeductionRepayments = Number(Number(totals.rows[0]?.total_salary_deduction || 0).toFixed(2));
    const totalRemaining = Number(Number(loanTotals.rows[0]?.total_remaining || 0).toFixed(2));
    const totalSalaryDeductionDue = Number(Number(loanTotals.rows[0]?.total_due || 0).toFixed(2));
    const openLoanCount = Number(loanTotals.rows[0]?.open_count || 0);

    return {
      rows,
      pagination: { page: safePage, pageSize, totalItems, totalPages },
      summary: {
        employeeId: String(employeeId),
        employeeName: clean(employee.display_name),
        from: fromDate || '',
        to: toDate || '',
        totalWithdrawals,
        withdrawalsAmount: totalWithdrawals,
        withdrawnAmount: totalWithdrawals,
        totalRepayments,
        repaymentsAmount: totalRepayments,
        repaidAmount: totalRepayments,
        totalManualCashRepayments,
        manualCashRepaymentsTotal: totalManualCashRepayments,
        totalSalaryDeductionRepayments,
        salaryDeductionRepaymentsTotal: totalSalaryDeductionRepayments,
        totalSalaryDeductionDue,
        totalRemaining,
        remainingAmount: totalRemaining,
        outstandingAmount: totalRemaining,
        openLoanCount,
        openLoans: openLoanCount,
      },
    };
  }

  async getEmployeeWithdrawalBalance(employeeId: number, auth: AuthContext): Promise<EmployeeWithdrawalBalanceResult> {
    const { tenantId } = requireTenantScope(auth);
    if (!employeeId || employeeId <= 0) throw new AppError('Employee ID is required', 'HR_EMPLOYEE_ID_REQUIRED', 400);

    const tenantTimezone = await getTenantTimezone(this.db, tenantId);
    const bookDigits = await tenantBookDigits(this.db, tenantId);
    const tenantCurrency = await tenantCurrencyCode(this.db, tenantId);
    const payrollPolicies = await this.getPayrollPolicies(this.db, tenantId);
    const today = todayTenantDate(tenantTimezone);
    const currentMonthPrefix = today.slice(0, 7);
    const monthStart = `${currentMonthPrefix}-01`;

    // Concurrently fetch employee profile, active contract, active payroll item, punches, loans, and past unpaid runs
    const [empRes, contractRes, activeRunItemRes, punchesRes, loansRes, unpaidItemsRes] = await Promise.all([
      // 1. Employee Basic Info
      sql<any>`
        SELECT id, employee_no, display_name, compensation_type, pay_frequency,
               hourly_rate, expected_daily_hours, to_char(hire_date, 'YYYY-MM-DD') AS hire_date, status
        FROM hr_employees
        WHERE id = ${employeeId} AND tenant_id = ${tenantId}
        LIMIT 1
      `.execute(this.db),

      // 2. Active or Latest Employment Contract
      sql<{ base_salary: string | number; currency: string }>`
        SELECT base_salary, currency
        FROM hr_employment_contracts
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
        ORDER BY CASE WHEN status = 'active' THEN 0 ELSE 1 END, start_date DESC NULLS LAST, id DESC
        LIMIT 1
      `.execute(this.db),

      // 3. Active Unpaid Payroll Item (draft, reviewed, approved but not yet marked 'paid')
      sql<any>`
        SELECT i.id, i.run_id, r.status AS run_status, r.period_month,
               to_char(r.start_date, 'YYYY-MM-DD') AS period_start_date,
               to_char(r.end_date, 'YYYY-MM-DD') AS period_end_date,
               COALESCE(i.base_salary, 0) AS base_salary,
               COALESCE(i.allowance_amount, 0) AS allowance_amount,
               COALESCE(i.gross_pay, 0) AS gross_pay,
               COALESCE(i.deduction_amount, 0) AS deduction_amount,
               COALESCE(i.loan_deduction_amount, 0) AS loan_deduction_amount,
               COALESCE(i.net_pay, 0) AS net_pay
        FROM hr_payroll_run_items i
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE i.employee_id = ${employeeId} AND i.tenant_id = ${tenantId}
          AND r.status IN ('draft', 'reviewed', 'approved', 'partially_paid')
          AND i.status <> 'excluded'
        ORDER BY r.id DESC LIMIT 1
      `.execute(this.db),

      // 4. Punches for current month
      sql<any>`
        SELECT status, check_in_at, check_out_at, to_char(work_date, 'YYYY-MM-DD') AS work_date_text
        FROM hr_attendance_records
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
          AND work_date >= ${monthStart}::date AND work_date <= ${today}::date
        ORDER BY work_date ASC, check_in_at ASC
      `.execute(this.db),

      // 5. Outstanding loans & advances
      sql<any>`
        SELECT id, loan_type, principal_amount, remaining_amount,
               to_char(issue_date, 'YYYY-MM-DD') AS issue_date, status
        FROM hr_employee_loans
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
          AND status IN ('paid', 'partially_repaid', 'disbursed')
          AND remaining_amount > 0
      `.execute(this.db),

      // 6. Unpaid past approved items from completed runs
      sql<any>`
        SELECT i.id, i.net_pay, i.gross_pay
        FROM hr_payroll_run_items i
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE i.employee_id = ${employeeId} AND i.tenant_id = ${tenantId}
          AND r.status IN ('approved', 'partially_paid') AND i.status NOT IN ('excluded', 'paid')
      `.execute(this.db),
    ]);

    const emp = empRes.rows[0];
    if (!emp) throw new AppError('الموظف غير موجود أو لا يتبع المنشأة الحالية', 'HR_EMPLOYEE_NOT_FOUND', 404);

    const contract = contractRes.rows[0];
    const activeItem = activeRunItemRes.rows[0];
    const payFreq = clean(emp.pay_frequency) || 'monthly';

    const [yStr, mStr] = currentMonthPrefix.split('-');
    const lastDayOfMonth = new Date(Date.UTC(Number(yStr), Number(mStr), 0)).getUTCDate();
    const monthEnd = `${currentMonthPrefix}-${String(lastDayOfMonth).padStart(2, '0')}`;

    const cycleStart = activeItem?.period_start_date || (payFreq === 'daily' ? today : monthStart);
    const cycleEnd = activeItem?.period_end_date || (payFreq === 'daily' ? today : monthEnd);
    const startMs = new Date(cycleStart + 'T00:00:00Z').getTime();
    const todayMs = new Date(today + 'T00:00:00Z').getTime();
    const daysElapsed = Math.max(1, Math.floor((todayMs - startMs) / 86400000) + 1);

    const result = calculateEmployeeWithdrawalBalance({
      employee: {
        id: Number(emp.id),
        employeeNo: emp.employee_no || undefined,
        displayName: emp.display_name,
        compensationType: emp.compensation_type || 'monthly',
        payFrequency: emp.pay_frequency || 'monthly',
        hourlyRate: Number(emp.hourly_rate || 0),
        expectedDailyHours: Number(emp.expected_daily_hours || 8),
        hireDate: emp.hire_date || undefined,
        status: emp.status || 'active',
      },
      contract: contract ? {
        baseSalary: Number(contract.base_salary || 0),
        currency: contract.currency,
      } : undefined,
      activePayrollItem: activeItem ? {
        id: Number(activeItem.id),
        runId: Number(activeItem.run_id),
        periodMonth: activeItem.period_month,
        runStatus: activeItem.run_status,
        itemStatus: activeItem.status,
        baseSalary: Number(activeItem.base_salary || 0),
        allowanceAmount: Number(activeItem.allowance_amount || 0),
        grossPay: Number(activeItem.gross_pay || 0),
        deductionAmount: Number(activeItem.deduction_amount || 0),
        loanDeductionAmount: Number(activeItem.loan_deduction_amount || 0),
        netPay: Number(activeItem.net_pay || 0),
      } : undefined,
      currentCycle: {
        cycleStart,
        cycleEnd,
        daysElapsed,
      },
      punches: punchesRes.rows || [],
      priorLoans: loansRes.rows || [],
      unpaidApprovedPayrollItems: unpaidItemsRes.rows || [],
      todayDate: today,
      minorUnits: bookDigits,
      directAdvanceCashCap: resolveDirectAdvanceCashCap(payrollPolicies, contract?.currency || tenantCurrency),
    });

    return result;
  }

  async createQuickCashAdvance(payload: any, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId, accountId } = requireTenantScope(auth);
    const employeeId = Number(payload.employeeId);
    const amount = Number(payload.amount);
    // INV-WAGE-PAYOUT-PAYROLL-JOURNAL: the amount gate runs at the
    // tenant's book precision, not a hard-coded 2 decimals — a KWD
    // wage payout of 5000.125 is a lawful amount on a 3-decimal
    // tenant and must not be rejected here.
    const bookDigits = await tenantBookDigits(this.db, tenantId);
    if (!employeeId || employeeId <= 0) throw new AppError('Employee ID is required', 'HR_EMPLOYEE_ID_REQUIRED', 400);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 100000000 || Math.abs(roundMoney(amount, bookDigits) - amount) > 0.000001) {
      throw new AppError('مبلغ السلفة يجب أن يكون موجبًا وبدقة عملة المنشأة', 'HR_AMOUNT_INVALID', 400);
    }

    const reason = clean(payload.notes);
    if (!reason) throw new AppError('تفاصيل المسحوب وسبب الصرف مطلوبة', 'HR_ADVANCE_REASON_REQUIRED', 400);

    const actionType = String(payload.actionType || 'advance').trim();
    const isWagePayout = actionType === 'wage_payout';

    // Verify employee withdrawal eligibility and balance
    const withdrawalBalance = await this.getEmployeeWithdrawalBalance(employeeId, auth);
    const isCallerAdmin = ['admin', 'super_admin'].includes(String(auth.role || '').trim());
    const isPayoutDue = withdrawalBalance.schedule?.isPayoutDue ?? true;
    const isEarlyWagePayout = isWagePayout && !isPayoutDue;
    const isAdvanceOverDirectCap = !isWagePayout && amount > withdrawalBalance.maxDirectAdvance;
    const isOverdraft = amount > withdrawalBalance.netAvailableBalance;

    // Direct disbursement without manager approval:
    // Tab 1 (Advance): allowed only if amount <= maxDirectAdvance (50% max of accrued net, capped at 2,000 EGP)
    // Tab 2 (Wage Payout): allowed only if period payout is due and amount <= netAvailableBalance
    const isDirectAllowed = isWagePayout
      ? (isPayoutDue && withdrawalBalance.netAvailableBalance > 0 && amount <= withdrawalBalance.netAvailableBalance)
      : (withdrawalBalance.maxDirectAdvance > 0 && amount <= withdrawalBalance.maxDirectAdvance);
    const isDirectDisbursement = isDirectAllowed;

    let managerApprovalTag = '';
    if (isDirectAllowed) {
      managerApprovalTag = isWagePayout
        ? `[صرف وتصفية مستحقات أجر الفترة (المصروف: ${amount})]`
        : `[مسحوب من الرصيد المباشر (المتاح: ${withdrawalBalance.netAvailableBalance} - سقف الكاشير: ${withdrawalBalance.maxDirectAdvance})]`;
    } else {
      // Overdraft advance, advance exceeding cashier cap, or early wage payout: requires manager password or admin caller
      if (isCallerAdmin) {
        managerApprovalTag = isEarlyWagePayout
          ? `[تسوية وصرف أجر مبكر معتمد من الإدارة: ${auth.username || 'المدير'}]`
          : isWagePayout
            ? `[صرف أجر استثنائي معتمد من الإدارة: ${auth.username || 'المدير'}]`
            : isAdvanceOverDirectCap && !isOverdraft
              ? `[سلفة استثنائية معتمدة من الإدارة: ${auth.username || 'المدير'}]`
              : `[سلفة على المكشوف معتمدة من الإدارة: ${auth.username || 'المدير'}]`;
      } else {
        const enteredPassword = String(payload.managerPassword || '').trim();
        if (!enteredPassword) {
          if (isEarlyWagePayout) {
            throw new AppError(
              `موعد استحقاق الراتب الدوري لم يحن بعد (القادم: ${withdrawalBalance.schedule?.nextPayoutDate})؛ يلزم إدخال رمز أو كلمة مرور المدير للاعتماد كـ تسوية مبكرة`,
              'HR_EARLY_PAYOUT_REQUIRES_MANAGER_APPROVAL',
              403,
            );
          }
          if (isAdvanceOverDirectCap && !isOverdraft) {
            throw new AppError(
              `قيمة السلفة (${amount} ${withdrawalBalance.currencyLabel}) تتجاوز الحد الأقصى للصرف المباشر للكاشير (${withdrawalBalance.maxDirectAdvance} ${withdrawalBalance.currencyLabel} - 50% من الرصيد)؛ يلزم إدخال رمز أو كلمة مرور المدير للاعتماد الاستثنائي`,
              'HR_ADVANCE_OVER_DIRECT_CAP_REQUIRES_MANAGER_APPROVAL',
              403,
            );
          }
          throw new AppError(
            `المبلغ المطلوب (${amount} ${withdrawalBalance.currencyLabel}) يتجاوز الرصيد المستحق للموظف (${withdrawalBalance.netAvailableBalance} ${withdrawalBalance.currencyLabel})؛ يلزم إدخال رمز أو كلمة مرور المدير لاعتماد سلفة على المكشوف`,
            'HR_ADVANCE_MANAGER_APPROVAL_REQUIRED',
            403,
          );
        }

        // Verify manager password
        let authorizedByName = '';
        const managerPinSetting = await sql<{ value: string }>`
          SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'pos_manager_pin' LIMIT 1
        `.execute(this.db);
        const pin = clean(managerPinSetting.rows[0]?.value).replace(/^"|"$/g, '');

        if (pin && enteredPassword === pin) {
          authorizedByName = 'رمز المدير (PIN)';
        } else {
          const adminUsers = await sql<{ id: number; username: string; display_name: string; password_hash: string; password_salt: string }>`
            SELECT id, username, display_name, password_hash, password_salt
            FROM users
            WHERE tenant_id = ${tenantId} AND is_active = true AND role IN ('admin', 'super_admin')
          `.execute(this.db);

          for (const admin of adminUsers.rows) {
            const check = await verifyPassword(enteredPassword, String(admin.password_hash || ''), String(admin.password_salt || ''));
            if (check.valid) {
              authorizedByName = clean(admin.display_name) || clean(admin.username) || 'المدير';
              break;
            }
          }
        }

        if (!authorizedByName) {
          throw new AppError('كلمة مرور المدير غير صحيحة', 'HR_ADVANCE_MANAGER_PASSWORD_INVALID', 400);
        }

        managerApprovalTag = isEarlyWagePayout
          ? `[تسوية وصرف أجر مبكر معتمد برمز المدير: ${authorizedByName}]`
          : isAdvanceOverDirectCap && !isOverdraft
            ? `[سلفة استثنائية معتمدة برمز المدير: ${authorizedByName}]`
            : `[سلفة على المكشوف معتمدة برمز المدير: ${authorizedByName}]`;
      }
    }

    const localLoanDate = todayTenantDate(await getTenantTimezone(this.db, tenantId));
    const baseNotes = payload.shiftId ? `${reason} [وردية كاشير #${Number(payload.shiftId)}]` : reason;
    const notes = `${baseNotes} ${managerApprovalTag}`.trim();
    let createdLoanId = 0;
    let paidRunItemId = 0;
    let wageJournalEntryId: number | null = null;
    
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      // 1. Validate employee is active in this tenant
      const employee = await trx.selectFrom('hr_employees')
        .select(['id', 'display_name', 'status', 'compensation_type', 'hourly_rate', 'expected_daily_hours'])
        .where('id', '=', employeeId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!employee) throw new AppError('الموظف غير موجود أو لا يتبع المنشأة الحالية', 'HR_EMPLOYEE_NOT_FOUND', 404);
      if (employee.status !== 'active') throw new AppError('لا يمكن صرف سلفة لموظف غير نشط', 'HR_EMPLOYEE_INACTIVE', 400);

      // Wage payout only (INV-WAGE-PAYOUT-PAYROLL-JOURNAL): resolve
      // the latest approved run item BEFORE any cash moves. A wage
      // payout settles that item in full — no loan row, no
      // installments — so the amount must equal the item's net pay
      // at book precision, and an approved item must exist at all.
      // Both failures are fail-closed here, inside the transaction,
      // before the drawer is touched.
      let wageItem: { id: number; run_id: number; net_pay: number } | null = null;
      if (isWagePayout) {
        const approvedItem = await sql<{ id: number; run_id: number; net_pay: number }>`
          SELECT i.id, i.run_id, i.net_pay
          FROM hr_payroll_run_items i
          JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
          WHERE i.employee_id = ${employeeId} AND i.tenant_id = ${tenantId}
            AND r.status IN ('approved', 'partially_paid') AND i.status = 'approved'
          ORDER BY r.id DESC LIMIT 1
        `.execute(trx);
        if (!approvedItem.rows.length) {
          throw new AppError('لا يوجد بند أجر معتمد لصرف مستحقاته', 'HR_WAGE_PAYOUT_NO_APPROVED_ITEM', 400);
        }
        wageItem = approvedItem.rows[0];
        paidRunItemId = wageItem.id;
        const itemNetPay = roundMoney(Number(wageItem.net_pay || 0), bookDigits);
        if (itemNetPay <= 0) {
          throw new AppError('صافي أجر الموظف صفر أو سالب', 'HR_PAYROLL_AMOUNT_ZERO', 400);
        }
        if (Math.abs(roundMoney(amount, bookDigits) - itemNetPay) > 0.000001) {
          throw new AppError('مبلغ صرف الأجر يجب أن يساوي صافي الأجر المعتمد بالكامل', 'HR_WAGE_PAYOUT_AMOUNT_MISMATCH', 400);
        }
      }

      // 2. Check cumulative active debt
      const activeRes = await sql<{ total_debt: string }>`
        SELECT COALESCE(SUM(remaining_amount), 0) AS total_debt
        FROM hr_employee_loans
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId}
          AND status IN ('approved', 'paid', 'partially_repaid', 'disbursed')
      `.execute(trx);
      const activeDebt = Number(activeRes.rows[0]?.total_debt || 0);

      // Ceiling check: Contract salary, or hourly estimation, or 5,000 min
      let baseSalary = 0;
      if (employee.compensation_type === 'hourly') {
        const estMonthly = Number(employee.hourly_rate || 0) * Number(employee.expected_daily_hours || 8) * 26;
        baseSalary = Math.max(5000, estMonthly);
      } else {
        const contract = await trx.selectFrom('hr_employment_contracts')
          .select('base_salary')
          .where('employee_id', '=', employeeId)
          .where('tenant_id', '=', tenantId)
          .where('status', '=', 'active')
          .where('start_date', '<=', localLoanDate)
          .where(eb => eb.or([eb('end_date', 'is', null), eb('end_date', '>=', localLoanDate)]))
          .orderBy('start_date', 'desc')
          .executeTakeFirst();
        baseSalary = Number(contract?.base_salary || 0);
      }
      const quickCap = baseSalary > 0 ? baseSalary : 5000;

      if (!isWagePayout && activeDebt + amount > quickCap) {
        throw new AppError(
          `قيمة السلفة السريعة تتجاوز سقف الراتب الشهري المسموح (${quickCap} - القائم: ${activeDebt})`,
          'HR_QUICK_ADVANCE_EXCEEDS_CAP',
          400
        );
      }

      let loanId = 0;
      if (!isWagePayout) {
        const tempNo = `LOAN-TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const loanRes = await sql<{ id: number }>`
          INSERT INTO hr_employee_loans (
            tenant_id, account_id, employee_id, loan_no, loan_type, principal_amount, remaining_amount, 
            installment_count, installment_amount, repayment_mode,
            issue_date, disbursed_at, status, notes, created_by, updated_by
          )
          VALUES (
            ${tenantId}, ${accountId}, ${employeeId}, ${tempNo}, 'advance', ${amount}, ${amount}, 
            1, ${amount}, 'deduct_next_salary',
            ${localLoanDate}::date, NOW(), 'paid', ${notes}, ${auth.userId}, ${auth.userId}
          )
          RETURNING id
        `.execute(trx);
        loanId = Number(loanRes.rows[0]?.id || 0);
        createdLoanId = loanId;

        const canonicalNo = formatDailyDocumentNumber('LOAN', loanId, new Date(), 4, await getTenantTimezone(trx, tenantId));
        await sql`UPDATE hr_employee_loans SET loan_no = ${canonicalNo} WHERE id = ${loanId} AND tenant_id = ${tenantId}`.execute(trx);
      
        const dueStr = localLoanDate;
      
        await sql`
          INSERT INTO hr_employee_loan_installments (
            tenant_id, account_id, loan_id, installment_no, due_date, 
            amount, status
          )
          VALUES (
            ${tenantId}, ${accountId}, ${loanId}, 1, ${dueStr}, 
            ${amount}, 'pending'
          )
        `.execute(trx);
      }

      if (!isWagePayout) {
        // 3. Record in employee ledger
        await sql`
          INSERT INTO hr_employee_ledger (
            employee_id, entry_type, amount, balance_after, note, reference_type, reference_id,
            created_by, tenant_id, account_id
          )
          VALUES (
            ${employeeId}, 'loan_disbursement', ${amount}, ${activeDebt + amount},
            ${notes}, 'hr_employee_loan', ${loanId}, ${auth.userId}, ${tenantId}, ${accountId}
          )
        `.execute(trx);
      }

      // 4. Handle shift cash deduction if shift ID is provided
      // (Captured for the wage-payout journal below: the cash source
      // is always a drawer — a missing shift throws in this block.)
      let payoutShiftId: number | null = null;
      let payoutBranchId: number | null = null;
      let payoutLocationId: number | null = null;
      if (payload.shiftId) {
        const shiftId = Number(payload.shiftId);
        const eligibleShift = await sql<{ id: number; branch_id: number | null; location_id: number | null; opened_by: number; expected_cash: string | number }>`
          SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash FROM cashier_shifts
          WHERE id = ${shiftId} AND tenant_id = ${tenantId} AND status = 'open'
            AND (opened_by = ${auth.userId} OR ${['admin', 'super_admin', 'owner', 'manager'].includes(auth.role)} OR ${Boolean(auth.permissions?.includes('hr') || auth.permissions?.includes('hrLoans') || auth.permissions?.includes('hrPayrollManage'))})
          FOR UPDATE
        `.execute(trx);
        if (!eligibleShift.rows.length) throw new AppError('وردية الكاشير غير مفتوحة أو لا تخص المستخدم الحالي', 'HR_CASHIER_SHIFT_INVALID', 400);
        const shift = eligibleShift.rows[0];
        payoutShiftId = shiftId;
        payoutBranchId = shift.branch_id;
        payoutLocationId = shift.location_id;
        const drawerCash = this.cashDrawer
          ? await this.cashDrawer.computeShiftExpectedCash(shiftId, auth, trx)
          : Number(shift.expected_cash || 0);

        if (amount > drawerCash && !isCallerAdmin && !managerApprovalTag.includes('المدير')) {
          throw new AppError(
            `النقدية المتاحة في درج الوردية (${drawerCash.toLocaleString('en-US')} ج.م) غير كافية لصرف هذا المبلغ (${amount.toLocaleString('en-US')} ج.م)؛ يلزم إيداع نقدية أو اعتماد المدير للصرف الاستثنائي`,
            'HR_DRAWER_INSUFFICIENT_CASH',
            400
          );
        }

        const cashierUser = await sql<{ name: string }>`
          SELECT COALESCE(NULLIF(display_name, ''), username) as name
          FROM users
          WHERE id = ${shift.opened_by} AND tenant_id = ${tenantId}
          LIMIT 1
        `.execute(trx);
        const cashierName = cashierUser.rows[0]?.name || 'الكاشير';

        const txnNote = isWagePayout
          ? `صرف راتب/أجر موظف #${employeeId} (${employee.display_name}) من درج (${cashierName} - وردية #${shiftId})، سند #${loanId}: ${notes}`
          : `سلفة موظف #${employeeId} (${employee.display_name}) من درج (${cashierName} - وردية #${shiftId})، حركة #${loanId}: ${notes}`;
        await sql`
          INSERT INTO treasury_transactions (
            tenant_id, account_id, txn_type, amount, payment_channel, note, reference_type,
            reference_id, branch_id, location_id, created_by
          ) VALUES (
            ${tenantId}, ${accountId}, 'cash_out', ${-amount}, 'cash',
            ${txnNote},
            'cashier_shift', ${shiftId}, ${shift.branch_id}, ${shift.location_id}, ${auth.userId}
          )
        `.execute(trx);
        await sql`
          UPDATE cashier_shifts
          SET expected_cash = ${drawerCash - amount}
          WHERE id = ${shiftId} AND tenant_id = ${tenantId} AND status = 'open'
        `.execute(trx);
      } else {
        throw new AppError('حدد وردية كاشير مفتوحة أو خزينة لصرف السلفة', 'HR_ADVANCE_CASH_SOURCE_REQUIRED', 400);
      }

      // Wage payout (INV-WAGE-PAYOUT-PAYROLL-JOURNAL): settle the
      // approved run item through the per-item payroll payment
      // journal (Dr 2140 / Cr 1110) — never a loan, never
      // installments. The item was resolved and the amount checked
      // against its net pay before any cash moved, above.
      if (isWagePayout && wageItem) {
        const { journalEntryId } = await this.accountingPosting.postPayrollItemPayment(
          trx,
          wageItem.id,
          'drawer',
          auth,
          { employeeName: employee.display_name, branchId: payoutBranchId, locationId: payoutLocationId },
        );
        wageJournalEntryId = journalEntryId;
        await sql`
          UPDATE hr_payroll_run_items
          SET status = 'paid', paid_at = NOW(), paid_by = ${auth.userId},
            payment_channel = 'drawer', payment_reference = NULL,
            shift_id = ${payoutShiftId}, journal_entry_id = ${journalEntryId || null},
            updated_at = NOW()
          WHERE id = ${wageItem.id} AND tenant_id = ${tenantId}
        `.execute(trx);
        await sql`
          INSERT INTO hr_employee_ledger (
            employee_id, entry_type, amount, balance_after, note, reference_type, reference_id,
            created_by, tenant_id, account_id
          )
          VALUES (
            ${employeeId}, 'wage_payout', ${amount}, 0,
            ${notes}, 'hr_payroll_run_item', ${wageItem.id}, ${auth.userId}, ${tenantId}, ${accountId}
          )
        `.execute(trx);
      }

      // 5. Record GL journal for an advance: Dr. 1160 (Advances) /
      // Cr. 1110 (Cash). Wage payouts post their own 2140 journal
      // above and never reach this call.
      if (!isWagePayout) {
        await this.accountingPosting.postEmployeeLoanDisbursement(trx, loanId, auth);
      }

      if (!isWagePayout) {
        // 6. Auto-rebuild active draft/reviewed payroll runs so the advance reflects in payroll immediately
        const activeRuns = await sql<{ id: number; status: string }>`
          SELECT id, status
          FROM hr_payroll_runs
          WHERE tenant_id = ${tenantId}
            AND status IN ('draft', 'reviewed')
            AND end_date >= ${localLoanDate}::date
            AND EXISTS (
              SELECT 1 FROM hr_payroll_run_items item
              WHERE item.run_id = hr_payroll_runs.id
                AND item.tenant_id = ${tenantId}
                AND item.employee_id = ${employeeId}
                AND item.status <> 'excluded'
            )
          ORDER BY id DESC
        `.execute(trx);
        for (const run of activeRuns.rows) {
          const runId = Number(run.id);
          await this.rebuildPayrollRunItems(trx, runId, 'draft', auth.tenantId || tenantId);
          if (run.status === 'reviewed') {
            await this.invalidatePayrollRunReview(trx, runId, tenantId);
          }
        }
      }
    });

    await this.audit.log(
      'Create Quick Cash Advance',
      isWagePayout
        ? `Wage payout for run item #${paidRunItemId} of ${amount} for employee #${employeeId} by ${auth.username}`
        : `Cash advance #${createdLoanId} of ${amount} for employee #${employeeId} by ${auth.username}`,
      auth,
    );
    return { success: true, loanId: createdLoanId || null, isDirectDisbursement, payrollRunItemId: paidRunItemId || null, journalEntryId: wageJournalEntryId };
  }
}
