import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { LoanRepaymentDto, UpsertEmployeeLoanDto } from '../dto/hr.dto';
import { HrTreasuryAdapter } from '../hr-treasury.adapter';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { calculateLoanInstallmentSchedule, requireLoanMoney } from '../payroll-loan-allocation.engine';
import { MoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import {
  clean,
  toId,
  normalizeDateOnly,
  tenantBookDigits,
  normalizePayrollMonth,
  monthRange,
  addMonths,
  nextMonthDate,
} from '../hr-helpers';

/**
 * HrLoansService — slice H4 of the hr split.
 * Pure move of 7 methods from HrService (employee loans: list, create,
 * update, approve, disburse, repay + the normalizeRepaymentPlan helper).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures for the 6 public
 * methods. normalizeRepaymentPlan stays PRIVATE (its only callers are
 * createLoan + updateLoan, H4-internal) with NO facade delegate.
 * Deps: db + tx + audit + treasury + accountingPosting, passed through
 * as received (all REQUIRED, no fallback); scope is a bound kernel dep
 * (stays a real private method in the facade, prep §2.1). Postings route
 * through AccountingPostingService (postEmployeeLoanDisbursement /
 * postEmployeeLoanManualRepayment) paired with HrTreasuryAdapter
 * movements inside the same trx — there is NO postDomainJournal anywhere
 * in this file. Free helpers (clean, toId, normalizeDateOnly,
 * tenantBookDigits, normalizePayrollMonth, monthRange, addMonths,
 * nextMonthDate) are imported from ../hr-helpers — that file is created
 * by the H0 merge and does not exist on this generation tree yet; the
 * import is still correct. Date handling travels verbatim: the LOAN
 * document number resolves the tenant timezone (createLoan) and
 * approveLoan stamps todayKey via todayTenantDate with the tenant
 * timezone (clock-b5 §D3 pin site — its spec repoint is merge-owned).
 */

export interface HrLoansDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  treasury: HrTreasuryAdapter;
  accountingPosting: AccountingPostingService;
  scope: (auth: AuthContext) => ReturnType<typeof requireTenantScope>;
}

@Injectable()
export class HrLoansService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly treasury: HrTreasuryAdapter;
  private readonly accountingPosting: AccountingPostingService;
  private readonly scope: (auth: AuthContext) => ReturnType<typeof requireTenantScope>;

  constructor(deps: HrLoansDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.treasury = deps.treasury;
    this.accountingPosting = deps.accountingPosting;
    this.scope = deps.scope;
  }

  private normalizeRepaymentPlan(
    payload: UpsertEmployeeLoanDto,
    amount: number,
    minorUnits: MoneyDigits,
  ): {
    repaymentMode: string;
    installmentCount: number;
    installmentAmount: number;
    installmentValues: number[];
    monthlyInstallmentAmount: number | null;
    firstDueDate: string | null;
    salaryDueDate: string | null;
  } {
    const repaymentMode = ['deduct_next_salary', 'monthly_salary_installment', 'manual_cash'].includes(
      clean(payload.repaymentMode),
    )
      ? clean(payload.repaymentMode)
      : 'manual_cash';
    const issueDate = normalizeDateOnly(payload.issueDate);
    if (!issueDate) throw new AppError('تاريخ إصدار السلفة غير صحيح', 'HR_LOAN_ISSUE_DATE_REQUIRED', 400);
    const salaryDueDate = payload.salaryDueDate ? normalizeDateOnly(payload.salaryDueDate) : null;
    const selectedDueDate = payload.firstDueDate ? normalizeDateOnly(payload.firstDueDate) : null;
    if ((payload.salaryDueDate && !salaryDueDate) || (payload.firstDueDate && !selectedDueDate))
      throw new AppError('تاريخ استحقاق القسط غير صحيح', 'HR_LOAN_DUE_DATE_INVALID', 400);
    const firstDueDate =
      selectedDueDate || salaryDueDate || (repaymentMode === 'manual_cash' ? issueDate : nextMonthDate(issueDate));
    let plan: ReturnType<typeof calculateLoanInstallmentSchedule>;
    try {
      plan =
        repaymentMode === 'deduct_next_salary'
          ? calculateLoanInstallmentSchedule(amount, 1, minorUnits)
          : repaymentMode === 'monthly_salary_installment' && Number(payload.monthlyInstallmentAmount || 0) > 0
            ? calculateLoanInstallmentSchedule(amount, 1, minorUnits, Number(payload.monthlyInstallmentAmount))
            : calculateLoanInstallmentSchedule(amount, Number(payload.installmentCount || 1), minorUnits);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'خطة تقسيط غير صحيحة',
        'HR_LOAN_INSTALLMENT_PLAN_INVALID',
        400,
      );
    }
    return {
      repaymentMode,
      ...plan,
      monthlyInstallmentAmount: repaymentMode === 'monthly_salary_installment' ? plan.installmentAmount : null,
      firstDueDate,
      salaryDueDate,
    };
  }

  async listLoans(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const listBookDigits = await tenantBookDigits(this.db, tenantId);
    const employeeId = toId(query.employeeId);
    const periodMonth = normalizePayrollMonth(query.month || query.periodMonth);
    // INV-HR-LOANS-PAYROLL-SQL-PAGINATION: the summary stays exact over the
    // FULL filtered set — COUNT + SUM with the same predicates as the page
    // query. The JS rounding stays in JS on the SQL sum.
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 25);
    const totalsResult = await sql<Record<string, unknown>>`
      SELECT
        COUNT(*)::text AS total,
        COALESCE(SUM(l.remaining_amount), 0)::text AS outstanding
      FROM hr_employee_loans l
      WHERE l.tenant_id = ${tenantId}
        AND (${employeeId}::BIGINT IS NULL OR l.employee_id = ${employeeId})
    `.execute(this.db);
    const totalItems = Number(totalsResult.rows[0]?.total || 0);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT
        l.*,
        e.display_name AS employee_name,
        latest_paid.latest_paid_at,
        to_char(l.issue_date, 'YYYY-MM-DD') AS issue_date_text,
        to_char(l.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
        to_char(l.updated_at, 'YYYY-MM-DD HH24:MI') AS updated_at_text,
        to_char(l.approved_at, 'YYYY-MM-DD HH24:MI') AS approved_at_text,
        to_char(l.disbursed_at, 'YYYY-MM-DD HH24:MI') AS disbursed_at_text,
        to_char(latest_paid.latest_paid_at, 'YYYY-MM-DD HH24:MI') AS paid_at_text
      FROM hr_employee_loans l
      JOIN hr_employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id
      LEFT JOIN (
        SELECT loan_id, MAX(paid_at) AS latest_paid_at
        FROM hr_employee_loan_installments
        WHERE paid_at IS NOT NULL AND tenant_id = ${tenantId}
        GROUP BY loan_id
      ) latest_paid ON latest_paid.loan_id = l.id
      WHERE l.tenant_id = ${tenantId}
        AND (${employeeId}::BIGINT IS NULL OR l.employee_id = ${employeeId})
      ORDER BY l.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);
    const rows = result.rows.map((row) => ({
      id: String(row.id),
      employeeId: String(row.employee_id),
      employeeName: clean(row.employee_name),
      loanNo: clean(row.loan_no),
      loanType: clean(row.loan_type),
      principalAmount: Number(row.principal_amount || 0),
      paidAmount: Number(row.paid_amount || 0),
      remainingAmount: Number(row.remaining_amount || 0),
      installmentCount: Number(row.installment_count || 1),
      installmentAmount: Number(row.installment_amount || 0),
      repaymentMode: clean(row.repayment_mode) || 'manual_cash',
      monthlyInstallmentAmount: row.monthly_installment_amount ? Number(row.monthly_installment_amount) : null,
      status: clean(row.status),
      issueDate: clean(row.issue_date_text) || String(row.issue_date).slice(0, 10),
      firstDueDate: row.first_due_date ? String(row.first_due_date).slice(0, 10) : '',
      salaryDueDate: row.salary_due_date ? String(row.salary_due_date).slice(0, 10) : '',
      createdAt: clean(row.created_at_text),
      updatedAt: clean(row.updated_at_text),
      approvedAt: clean(row.approved_at_text),
      disbursedAt: clean(row.disbursed_at_text),
      paidAt: clean(row.paid_at_text),
      branchId: row.branch_id ? String(row.branch_id) : '',
      locationId: row.location_id ? String(row.location_id) : '',
      notes: clean(row.notes),
      dueInstallmentsAmount: 0,
      dueInstallmentsCount: 0,
      installments: [] as Array<Record<string, unknown>>,
    }));
    const pagedRows = rows;
    const loanIds = pagedRows
      .map((row) => Number(row.id || 0))
      .filter((value) => Number.isSafeInteger(value) && value > 0);

    let installmentsByLoanId = new Map<number, Array<Record<string, unknown>>>();
    if (loanIds.length > 0) {
      const installmentsResult = await sql<Record<string, unknown>>`
        SELECT
          i.*,
          to_char(i.due_date, 'YYYY-MM-DD') AS due_date_text,
          to_char(i.paid_at, 'YYYY-MM-DD HH24:MI') AS paid_at_text
        FROM hr_employee_loan_installments i
        WHERE i.loan_id IN (${sql.join(loanIds)})
          AND i.tenant_id = ${tenantId}
        ORDER BY i.loan_id ASC, i.installment_no ASC
      `.execute(this.db);

      installmentsByLoanId = installmentsResult.rows.reduce((acc, row) => {
        const key = Number(row.loan_id || 0);
        if (!(key > 0)) return acc;
        const bucket = acc.get(key) || [];
        const amount = Number(row.amount || 0);
        const paidAmount = Number(row.paid_amount || 0);
        const remainingAmount = Math.max(0, roundMoney(amount - paidAmount, listBookDigits));
        bucket.push({
          id: String(row.id),
          loanId: String(row.loan_id),
          installmentNumber: Number(row.installment_no || 0),
          dueDate: clean(row.due_date_text),
          amount,
          paidAmount,
          remainingAmount,
          status: clean(row.status) || 'pending',
          paidAt: clean(row.paid_at_text),
        });
        acc.set(key, bucket);
        return acc;
      }, new Map<number, Array<Record<string, unknown>>>());
    }

    let repaymentsByLoanId = new Map<number, Array<Record<string, unknown>>>();
    if (loanIds.length > 0) {
      const repaymentsResult = await sql<Record<string, unknown>>`
        SELECT
          l.id,
          COALESCE(alloc.loan_id, CASE WHEN l.reference_type = 'hr_employee_loan' THEN l.reference_id END) AS loan_id,
          l.entry_type,
          l.amount,
          l.balance_after,
          l.repayment_method,
          l.note,
          to_char(l.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text,
          u.id AS received_by_id,
          u.username AS received_by_username,
          COALESCE(NULLIF(u.display_name, ''), u.username, 'النظام') AS received_by_name
        FROM hr_employee_ledger l
        LEFT JOIN hr_payroll_loan_deduction_allocations alloc 
          ON l.reference_type = 'hr_payroll_loan_deduction' AND l.reference_id = alloc.id
        LEFT JOIN users u ON u.id = l.created_by AND u.tenant_id = l.tenant_id
        WHERE l.tenant_id = ${tenantId}
          AND l.entry_type IN ('loan_repayment', 'loan_disbursement')
          AND (
            (l.reference_type = 'hr_employee_loan' AND l.reference_id IN (${sql.join(loanIds)}))
            OR
            (l.reference_type = 'hr_payroll_loan_deduction' AND alloc.loan_id IN (${sql.join(loanIds)}))
          )
        ORDER BY l.id DESC
      `.execute(this.db);

      repaymentsByLoanId = repaymentsResult.rows.reduce((acc, row) => {
        const key = Number(row.loan_id || 0);
        if (!(key > 0)) return acc;
        const bucket = acc.get(key) || [];
        bucket.push({
          id: String(row.id),
          loanId: String(row.loan_id),
          entryType: clean(row.entry_type),
          amount: Math.abs(Number(row.amount || 0)),
          balanceAfter: Number(row.balance_after || 0),
          repaymentMethod:
            clean(row.repayment_method) ||
            (clean(row.entry_type) === 'loan_repayment' ? 'manual_cash' : 'disbursement'),
          note: clean(row.note),
          createdAt: clean(row.created_at_text),
          receivedById: row.received_by_id ? String(row.received_by_id) : '',
          receivedByUsername: clean(row.received_by_username),
          receivedByName: clean(row.received_by_name),
        });
        acc.set(key, bucket);
        return acc;
      }, new Map<number, Array<Record<string, unknown>>>());
    }

    let dueSummaryByLoanId = new Map<number, { dueInstallmentsCount: number; dueInstallmentsAmount: number }>();
    if (periodMonth && loanIds.length > 0) {
      const range = monthRange(periodMonth);
      const dueSummaryResult = await sql<Record<string, unknown>>`
        SELECT
          i.loan_id,
          COUNT(*) AS due_count,
          COALESCE(SUM(GREATEST(i.amount - COALESCE(i.paid_amount, 0), 0)), 0) AS due_amount
        FROM hr_employee_loan_installments i
        JOIN hr_employee_loans l ON l.id = i.loan_id AND l.tenant_id = i.tenant_id
        WHERE i.loan_id IN (${sql.join(loanIds)})
          AND i.tenant_id = ${tenantId}
          AND l.repayment_mode IN ('deduct_next_salary', 'monthly_salary_installment')
          AND l.status IN ('paid', 'partially_repaid', 'disbursed')
          AND COALESCE(i.status, 'pending') IN ('pending', 'partial')
          AND COALESCE(i.due_date, l.first_due_date, l.salary_due_date) BETWEEN ${range.from}::date AND ${range.to}::date
          AND (i.amount - COALESCE(i.paid_amount, 0)) > 0
        GROUP BY i.loan_id
      `.execute(this.db);
      dueSummaryByLoanId = dueSummaryResult.rows.reduce((acc, row) => {
        const loanId = Number(row.loan_id || 0);
        if (!(loanId > 0)) return acc;
        acc.set(loanId, {
          dueInstallmentsCount: Number(row.due_count || 0),
          dueInstallmentsAmount: Number(row.due_amount || 0),
        });
        return acc;
      }, new Map<number, { dueInstallmentsCount: number; dueInstallmentsAmount: number }>());
    }

    const mappedRows = pagedRows.map((row) => {
      const loanId = Number(row.id || 0);
      const dueSummary = dueSummaryByLoanId.get(loanId);
      return {
        ...row,
        installments: installmentsByLoanId.get(loanId) || [],
        repayments: repaymentsByLoanId.get(loanId) || [],
        dueInstallmentsCount: dueSummary?.dueInstallmentsCount || 0,
        dueInstallmentsAmount: dueSummary?.dueInstallmentsAmount || 0,
      };
    });

    return {
      loans: mappedRows,
      pagination: { page: safePage, pageSize, totalItems, totalPages },
      summary: {
        totalItems,
        outstandingAmount: roundMoney(Number(totalsResult.rows[0]?.outstanding || 0), listBookDigits),
      },
    };
  }

  async createLoan(payload: UpsertEmployeeLoanDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const employeeId = toId(payload.employeeId);
    const amount = Number(payload.principalAmount || 0);
    const issueDate = normalizeDateOnly(payload.issueDate);
    const repaymentMode = clean(payload.repaymentMode) || 'manual_cash';
    if (!employeeId) throw new AppError('Employee is required', 'HR_LOAN_EMPLOYEE_REQUIRED', 400);
    if (payload.autoDisburse && auth.role !== 'admin' && auth.role !== 'super_admin') {
      throw new AppError(
        'الصرف التلقائي للسلفة للإدارة فقط؛ استخدم الاعتماد والصرف المنفصل',
        'HR_LOAN_AUTO_DISBURSE_FORBIDDEN',
        403,
      );
    }
    if (!(amount > 0)) throw new AppError('Loan amount must be greater than zero', 'HR_LOAN_AMOUNT_INVALID', 400);
    if (!issueDate) throw new AppError('Loan issue date is required', 'HR_LOAN_ISSUE_DATE_REQUIRED', 400);
    if (!['deduct_next_salary', 'monthly_salary_installment', 'manual_cash'].includes(repaymentMode)) {
      throw new AppError('Loan repayment mode is invalid', 'HR_LOAN_REPAYMENT_MODE_INVALID', 400);
    }
    if (
      repaymentMode === 'monthly_salary_installment' &&
      !(Number(payload.monthlyInstallmentAmount || 0) > 0) &&
      !(Number(payload.installmentCount || 0) > 0)
    ) {
      throw new AppError(
        'Monthly installment amount or installment count is required',
        'HR_LOAN_INSTALLMENT_REQUIRED',
        400,
      );
    }

    await this.tx.runInTransaction(this.db, async (trx) => {
      // Never mutate loan balances/installments concurrently with payroll review
      // or accrual posting; all HR loan writers acquire the tenant payroll lock.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const employee = await trx
        .selectFrom('hr_employees')
        .select(['id', 'status', 'display_name', 'first_name'])
        .where('id', '=', employeeId)
        .where('tenant_id', '=', requireTenantScope(auth).tenantId)
        .forUpdate()
        .executeTakeFirst();
      if (!employee) throw new AppError('Employee not found', 'HR_EMPLOYEE_NOT_FOUND', 404);
      if (employee.status !== 'active')
        throw new AppError('Cannot grant loan to inactive employee', 'HR_EMPLOYEE_INACTIVE', 400);

      // Cumulative loan exposure check (Invariant G1-C / HR-7)
      const existingLoans = await sql<{ total_remaining: string }>`
        SELECT COALESCE(SUM(remaining_amount), 0) AS total_remaining
        FROM hr_employee_loans
        WHERE employee_id = ${employeeId} AND tenant_id = ${auth.tenantId}
          AND status IN ('approved', 'paid', 'partially_repaid', 'disbursed')
      `.execute(trx);
      const currentActiveDebt = Number(existingLoans.rows[0]?.total_remaining || 0);

      // Ceiling bounded by employee base salary (max 3x monthly salary or 50,000)
      const contract = await trx
        .selectFrom('hr_employment_contracts')
        .select('base_salary')
        .where('employee_id', '=', employeeId)
        .where('tenant_id', '=', requireTenantScope(auth).tenantId)
        .where('status', '=', 'active')
        .where('start_date', '<=', issueDate)
        .where((eb) => eb.or([eb('end_date', 'is', null), eb('end_date', '>=', issueDate)]))
        .orderBy('start_date', 'desc')
        .executeTakeFirst();
      const monthlyWage = Number(contract?.base_salary || 0);
      const maxLoanCeiling = monthlyWage > 0 ? monthlyWage * 3 : 50000;

      if (currentActiveDebt + amount > maxLoanCeiling) {
        throw new AppError(
          `قيمة السلفة تتجاوز الحد الأقصى المسموح به للموظف (${maxLoanCeiling} - القائم حالياً: ${currentActiveDebt})`,
          'HR_LOAN_CEILING_EXCEEDED',
          400,
        );
      }

      const loanBookDigits = await tenantBookDigits(trx, auth.tenantId || '');
      const plan = this.normalizeRepaymentPlan(
        { ...payload, employeeId, principalAmount: amount, issueDate, repaymentMode },
        amount,
        loanBookDigits,
      );
      const requestedLoanNo = clean(payload.loanNo);
      const tempLoanNo = requestedLoanNo || `LOAN-TMP-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const insert = await sql<{ id: number }>`
        INSERT INTO hr_employee_loans (tenant_id, account_id, employee_id, loan_no, loan_type, principal_amount, paid_amount, remaining_amount, installment_count, installment_amount, repayment_mode, monthly_installment_amount, status, issue_date, first_due_date, salary_due_date, branch_id, location_id, notes, created_by, updated_by)
        VALUES (${auth.tenantId}, ${auth.accountId}, ${employeeId}, ${tempLoanNo}, ${clean(payload.loanType) || 'advance'}, ${amount}, 0, ${amount}, ${plan.installmentCount}, ${plan.installmentAmount}, ${plan.repaymentMode}, ${plan.monthlyInstallmentAmount}, 'draft', ${issueDate}, ${plan.firstDueDate}, ${plan.salaryDueDate}, ${toId(payload.branchId)}, ${toId(payload.locationId)}, ${clean(payload.notes)}, ${auth.userId}, ${auth.userId})
        RETURNING id
      `.execute(trx);
      const loanId = Number(insert.rows[0]?.id || 0);
      const finalLoanNo =
        requestedLoanNo ||
        formatDailyDocumentNumber('LOAN', loanId, new Date(), 4, await getTenantTimezone(trx, auth.tenantId));
      await sql`UPDATE hr_employee_loans SET loan_no = ${finalLoanNo} WHERE id = ${loanId} AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );

      for (let i = 1; i <= plan.installmentCount; i += 1) {
        const dueDate = plan.firstDueDate ? addMonths(plan.firstDueDate, i - 1) : null;
        const installmentValue = plan.installmentValues[i - 1];
        await sql`INSERT INTO hr_employee_loan_installments (tenant_id, account_id, loan_id, installment_no, due_date, amount) VALUES (${auth.tenantId}, ${auth.accountId}, ${loanId}, ${i}, ${dueDate}, ${installmentValue})`.execute(
          trx,
        );
      }

      if (payload.autoDisburse) {
        await sql`
          UPDATE hr_employee_loans
          SET status = 'paid',
              approved_by = ${auth.userId},
              approved_at = NOW(),
              disbursed_by = ${auth.userId},
              disbursed_at = NOW(),
              updated_by = ${auth.userId},
              updated_at = NOW()
          WHERE id = ${loanId} AND tenant_id = ${auth.tenantId}
        `.execute(trx);

        await sql`
          INSERT INTO hr_employee_ledger (employee_id, entry_type, amount, balance_after, note, reference_type, reference_id, branch_id, location_id, created_by, tenant_id, account_id)
          VALUES (${employeeId}, 'loan_disbursement', ${amount}, ${amount}, 'Employee advance/loan disbursed immediately upon creation', 'hr_employee_loan', ${loanId}, ${toId(payload.branchId)}, ${toId(payload.locationId)}, ${auth.userId}, ${this.scope(auth).tenantId}, ${this.scope(auth).accountId})
        `.execute(trx);

        const empName = clean(employee.display_name || employee.first_name);
        await this.treasury.recordLoanDisbursement(
          trx,
          {
            id: loanId,
            amount,
            employeeName: empName,
            branchId: toId(payload.branchId),
            locationId: toId(payload.locationId),
          },
          auth,
        );
        await this.accountingPosting.postEmployeeLoanDisbursement(trx, loanId, auth);
      }
    });
    await this.audit.log('Create HR employee loan', `Employee loan created by ${auth.username}`, auth);
    return { ok: true, ...(await this.listLoans({}, auth)) };
  }

  async updateLoan(id: number, payload: UpsertEmployeeLoanDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const existing = await sql<{
      status: string;
    }>`SELECT status FROM hr_employee_loans WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(this.db);
    if (!existing.rows.length) throw new AppError('Loan not found', 'HR_LOAN_NOT_FOUND', 404);
    if (existing.rows[0].status !== 'draft')
      throw new AppError('Only draft loans can be edited', 'HR_LOAN_EDIT_LOCKED', 400);

    const amount = Number(payload.principalAmount || 0);
    const issueDate = normalizeDateOnly(payload.issueDate);
    if (!issueDate) throw new AppError('Loan issue date is required', 'HR_LOAN_ISSUE_DATE_REQUIRED', 400);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new AppError('مبلغ السلفة غير صحيح', 'HR_LOAN_AMOUNT_INVALID', 400);
    const loanBookDigits = await tenantBookDigits(this.db, auth.tenantId || '');
    const plan = this.normalizeRepaymentPlan({ ...payload, issueDate }, amount, loanBookDigits);

    await this.tx.runInTransaction(this.db, async (trx) => {
      // Never mutate loan balances/installments concurrently with payroll review
      // or accrual posting; all HR loan writers acquire the tenant payroll lock.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      // Serializes loan edit with approval/disbursement: never update the
      // installment schedule using a stale pre-transaction draft snapshot.
      const locked = await sql<{ status: string; employee_id: number; loan_no: string }>`
        SELECT status, employee_id, loan_no FROM hr_employee_loans
        WHERE id = ${id} AND tenant_id = ${auth.tenantId} FOR UPDATE
      `.execute(trx);
      const loan = locked.rows[0];
      if (!loan) throw new AppError('Loan not found', 'HR_LOAN_NOT_FOUND', 404);
      if (loan.status !== 'draft') throw new AppError('Only draft loans can be edited', 'HR_LOAN_EDIT_LOCKED', 409);
      const employeeId = toId(payload.employeeId);
      if (!employeeId || employeeId !== Number(loan.employee_id)) {
        throw new AppError('لا يمكن نقل سلفة موظف لموظف آخر؛ أنشئ طلب سلفة جديدًا', 'HR_LOAN_EMPLOYEE_IMMUTABLE', 409);
      }
      if (
        !(await trx
          .selectFrom('hr_employees')
          .select('id')
          .where('id', '=', employeeId)
          .where('tenant_id', '=', requireTenantScope(auth).tenantId)
          .executeTakeFirst())
      ) {
        throw new AppError('Employee not found', 'HR_EMPLOYEE_NOT_FOUND', 404);
      }
      await sql`
        UPDATE hr_employee_loans
        SET loan_no = ${clean(payload.loanNo) || clean(loan.loan_no)}, loan_type = ${clean(payload.loanType) || 'advance'}, principal_amount = ${amount},
            remaining_amount = ${amount}, installment_count = ${plan.installmentCount}, installment_amount = ${plan.installmentAmount},
            repayment_mode = ${plan.repaymentMode}, monthly_installment_amount = ${plan.monthlyInstallmentAmount},
            issue_date = ${issueDate}, first_due_date = ${plan.firstDueDate}, salary_due_date = ${plan.salaryDueDate}, branch_id = ${toId(payload.branchId)}, location_id = ${toId(payload.locationId)},
            notes = ${clean(payload.notes)}, updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${auth.tenantId}
      `.execute(trx);

      await sql`DELETE FROM hr_employee_loan_installments WHERE loan_id = ${id} AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
      for (let i = 1; i <= plan.installmentCount; i += 1) {
        const installmentValue = plan.installmentValues[i - 1];
        const dueDate = plan.firstDueDate ? addMonths(plan.firstDueDate, i - 1) : null;
        await sql`
          INSERT INTO hr_employee_loan_installments (tenant_id, account_id, loan_id, installment_no, due_date, amount)
          VALUES (${auth.tenantId}, ${auth.accountId}, ${id}, ${i}, ${dueDate}, ${installmentValue})
        `.execute(trx);
      }
    });

    await this.audit.log('Update HR employee loan', `Employee loan #${id} updated by ${auth.username}`, auth);
    return { ok: true, ...(await this.listLoans({}, auth)) };
  }

  async approveLoan(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Never mutate loan balances/installments concurrently with payroll review
      // or accrual posting; all HR loan writers acquire the tenant payroll lock.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const result = await sql<{
        id: number;
        employee_id: number;
        principal_amount: string;
        created_by: string;
        status: string;
      }>`
        SELECT id, employee_id, principal_amount, created_by, status
        FROM hr_employee_loans WHERE id = ${id} AND tenant_id = ${tenantId}
        FOR UPDATE
      `.execute(trx);
      const loan = result.rows[0];
      if (!loan) throw new AppError('Loan not found', 'HR_LOAN_NOT_FOUND', 404);
      if (loan.status !== 'draft')
        throw new AppError('Only draft loans can be approved', 'HR_LOAN_STATUS_INVALID', 409);
      // Permission and maker-checker decisions always operate on this locked row.
      if (String(loan.created_by) === String(auth.userId) && auth.role !== 'super_admin' && auth.role !== 'admin') {
        throw new AppError(
          'لا يجوز لمنشئ طلب السلفة اعتماده بنفسه (مبدأ فصل المهام الرقابي)',
          'HR_LOAN_MAKER_CHECKER_VIOLATION',
          403,
        );
      }
      // CREATE only tested debt exposure at draft creation; multiple drafts
      // can otherwise be approved later and exceed the same employee ceiling.
      // Serialize approvals of DIFFERENT loans via the SAME employee row.
      const employee = await sql<{ id: number; status: string }>`
        SELECT id, status FROM hr_employees
        WHERE id = ${loan.employee_id} AND tenant_id = ${tenantId}
        FOR UPDATE
      `.execute(trx);
      if (!employee.rows.length || employee.rows[0].status !== 'active') {
        throw new AppError('لا يمكن اعتماد سلفة لموظف غير نشط', 'HR_LOAN_EMPLOYEE_INACTIVE', 409);
      }
      const exposure = await sql<{ amount: string }>`
        SELECT COALESCE(SUM(remaining_amount), 0)::text AS amount
        FROM hr_employee_loans
        WHERE tenant_id = ${tenantId} AND employee_id = ${loan.employee_id}
          AND id <> ${id} AND status IN ('approved', 'paid', 'partially_repaid', 'disbursed')
      `.execute(trx);
      // The active contract is the one active on the TENANT's day, not
      // the DB host's day: CURRENT_DATE is the database server's day,
      // which differs from the tenant's around the tenant midnight — a
      // contract starting/ending today must count today.
      const todayKey = todayTenantDate(await getTenantTimezone(trx, tenantId), new Date());
      const contract = await sql<{ base_salary: string }>`
        SELECT base_salary FROM hr_employment_contracts
        WHERE tenant_id = ${tenantId} AND employee_id = ${loan.employee_id}
          AND status = 'active' AND start_date <= ${todayKey}
          AND (end_date IS NULL OR end_date >= ${todayKey})
        ORDER BY start_date DESC, id DESC LIMIT 1
      `.execute(trx);
      const wage = Number(contract.rows[0]?.base_salary || 0);
      const maximum = wage > 0 ? wage * 3 : 50000;
      const outstanding = Number(exposure.rows[0]?.amount || 0);
      const incoming = Number(loan.principal_amount);
      if (
        !Number.isFinite(outstanding) ||
        !Number.isFinite(incoming) ||
        incoming <= 0 ||
        outstanding + incoming > maximum
      ) {
        throw new AppError(
          `إجمالي السلف بعد اعتماد الطلب (${outstanding + incoming}) يتجاوز السقف الحالي للموظف (${maximum})`,
          'HR_LOAN_CEILING_EXCEEDED_AT_APPROVAL',
          409,
        );
      }
      const updated = await sql<{ id: number }>`
        UPDATE hr_employee_loans
        SET status = 'approved', approved_by = ${auth.userId}, approved_at = NOW(),
            updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND status = 'draft' AND tenant_id = ${tenantId}
        RETURNING id
      `.execute(trx);
      if (updated.rows.length !== 1) {
        throw new AppError('حالة السلفة تغيرت أثناء الاعتماد', 'HR_LOAN_APPROVAL_CONFLICT', 409);
      }
    });
    await this.audit.log('Approve HR employee loan', `Employee loan #${id} approved by ${auth.username}`, auth);
    return { ok: true, ...(await this.listLoans({}, auth)) };
  }

  async disburseLoan(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Never mutate loan balances/installments concurrently with payroll review
      // or accrual posting; all HR loan writers acquire the tenant payroll lock.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const result = await sql<Record<string, unknown>>`
        SELECT l.*, e.display_name AS employee_name FROM hr_employee_loans l JOIN hr_employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id WHERE l.id = ${id} AND l.tenant_id = ${this.scope(auth).tenantId} LIMIT 1 FOR UPDATE
      `.execute(trx);
      const loan = result.rows[0];
      if (!loan) throw new AppError('Loan not found', 'HR_LOAN_NOT_FOUND', 404);
      if (clean(loan.status) !== 'approved')
        throw new AppError('Loan must be approved before disbursement', 'HR_LOAN_APPROVAL_REQUIRED', 400);
      await sql`UPDATE hr_employee_loans SET status = 'paid', disbursed_by = ${auth.userId}, disbursed_at = NOW(), updated_by = ${auth.userId}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
      const ledger = await sql<{ id: number }>`
        INSERT INTO hr_employee_ledger (employee_id, entry_type, amount, balance_after, note, reference_type, reference_id, branch_id, location_id, created_by, tenant_id, account_id)
        VALUES (${loan.employee_id}, 'loan_disbursement', ${Number(loan.principal_amount || 0)}, ${Number(loan.remaining_amount || 0)}, 'صرف السلفة للموظف', 'hr_employee_loan', ${id}, ${toId(loan.branch_id)}, ${toId(loan.location_id)}, ${auth.userId}, ${this.scope(auth).tenantId}, ${this.scope(auth).accountId})
        RETURNING id
      `.execute(trx);
      void ledger;
      await this.treasury.recordLoanDisbursement(
        trx,
        {
          id,
          amount: Number(loan.principal_amount || 0),
          employeeName: clean(loan.employee_name),
          branchId: toId(loan.branch_id),
          locationId: toId(loan.location_id),
        },
        auth,
      );
      await this.accountingPosting.postEmployeeLoanDisbursement(trx, id, auth);
    });
    await this.audit.log('Pay HR employee loan', `Employee loan #${id} disbursed by ${auth.username}`, auth);
    return { ok: true, ...(await this.listLoans({}, auth)) };
  }

  async repayLoan(id: number, payload: LoanRepaymentDto, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Never mutate loan balances/installments concurrently with payroll review
      // or accrual posting; all HR loan writers acquire the tenant payroll lock.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const result = await sql<Record<string, unknown>>`
        SELECT l.*, e.display_name AS employee_name FROM hr_employee_loans l JOIN hr_employees e ON e.id = l.employee_id AND e.tenant_id = l.tenant_id WHERE l.id = ${id} AND l.tenant_id = ${this.scope(auth).tenantId} LIMIT 1 FOR UPDATE
      `.execute(trx);
      const loan = result.rows[0];
      if (!loan) throw new AppError('Loan not found', 'HR_LOAN_NOT_FOUND', 404);
      if (!['paid', 'partially_repaid'].includes(clean(loan.status)))
        throw new AppError('Loan must be disbursed before repayment', 'HR_LOAN_REPAYMENT_STATUS_INVALID', 400);
      const repayBookDigits = await tenantBookDigits(trx, auth.tenantId || '');
      let requestedAmount: number;
      try {
        requestedAmount = requireLoanMoney(Number(payload.amount), await tenantBookDigits(trx, auth.tenantId || ''));
      } catch {
        throw new AppError(
          'مبلغ سداد السلفة يجب أن يكون موجبًا وبدقة دفاتر المنشأة',
          'HR_LOAN_REPAYMENT_PRECISION_INVALID',
          400,
        );
      }
      const remainingBalance = Number(loan.remaining_amount || 0);
      if (requestedAmount > remainingBalance) {
        throw new AppError('Repayment amount exceeds remaining loan balance', 'HR_LOAN_REPAYMENT_EXCEEDS_BALANCE', 400);
      }
      const amount = requestedAmount;
      const repaymentMethod =
        clean(payload.repaymentMethod) === 'salary_deduction' ? 'salary_deduction' : 'manual_cash';
      if (repaymentMethod === 'salary_deduction') {
        throw new AppError(
          'Salary deduction is handled automatically during payroll processing',
          'HR_LOAN_SALARY_DEDUCTION_REQUIRES_PAYROLL',
          400,
        );
      }
      if (!(amount > 0)) throw new AppError('Loan has no remaining balance', 'HR_LOAN_NO_BALANCE', 400);
      const paid = Number(loan.paid_amount || 0) + amount;
      const remaining = Math.max(0, Number(loan.remaining_amount || 0) - amount);
      await sql`UPDATE hr_employee_loans SET paid_amount = ${paid}, remaining_amount = ${remaining}, status = ${remaining > 0 ? 'partially_repaid' : 'repaid'}, updated_by = ${auth.userId}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
      let remainingRepayment = amount;
      const installments = await sql<Record<string, unknown>>`
        SELECT id, amount, paid_amount
        FROM hr_employee_loan_installments
        WHERE loan_id = ${id} AND tenant_id = ${auth.tenantId} AND status <> 'paid'
        ORDER BY installment_no ASC
      `.execute(trx);
      for (const installment of installments.rows) {
        if (remainingRepayment <= 0) break;
        const installmentId = Number(installment.id || 0);
        const installmentAmount = Number(installment.amount || 0);
        const alreadyPaid = Number(installment.paid_amount || 0);
        const due = Math.max(0, installmentAmount - alreadyPaid);
        if (!(installmentId > 0) || !(due > 0)) continue;
        const applied = Math.min(due, remainingRepayment);
        const newPaid = roundMoney(alreadyPaid + applied, repayBookDigits);
        const status = newPaid + 1 / (2 * 10 ** repayBookDigits) >= installmentAmount ? 'paid' : 'partial';
        await sql`
          UPDATE hr_employee_loan_installments
          SET paid_amount = ${newPaid}, status = ${status}, paid_at = CASE WHEN ${status} = 'paid' THEN NOW() ELSE paid_at END, updated_at = NOW()
          WHERE id = ${installmentId} AND tenant_id = ${auth.tenantId}
        `.execute(trx);
        remainingRepayment = roundMoney(remainingRepayment - applied, repayBookDigits);
      }
      // A loan repayment must settle EXACTLY into its installment subledger.
      // Posting only the parent loan and treasury amount would leave the
      // pending installments inconsistent and permit repeat deductions.
      // The undistributed tolerance follows tenant book digits (half a
      // minor unit, the same form as the installment-status line above):
      // at 3dp a 0.001 remainder is ONE minor unit and must fail closed,
      // never strand silently while the loan is marked repaid.
      if (remainingRepayment > 1 / (2 * 10 ** repayBookDigits)) {
        throw new AppError(
          'تعذر توزيع مبلغ السداد كاملًا على أقساط السلفة؛ راجع الرصيد وجدول التقسيط',
          'HR_LOAN_REPAYMENT_INSTALLMENT_MISMATCH',
          409,
        );
      }
      const ledger = await sql<{ id: number }>`
        INSERT INTO hr_employee_ledger (employee_id, entry_type, amount, balance_after, note, repayment_method, reference_type, reference_id, branch_id, location_id, created_by, tenant_id, account_id)
        VALUES (${loan.employee_id}, 'loan_repayment', ${-amount}, ${remaining}, ${clean(payload.note) || 'سداد دفعة من السلفة'}, ${repaymentMethod}, 'hr_employee_loan', ${id}, ${toId(loan.branch_id)}, ${toId(loan.location_id)}, ${auth.userId}, ${this.scope(auth).tenantId}, ${this.scope(auth).accountId})
        RETURNING id
      `.execute(trx);
      const ledgerId = Number(ledger.rows[0]?.id || 0);
      if (repaymentMethod === 'manual_cash') {
        await this.treasury.recordLoanRepayment(
          trx,
          {
            ledgerId,
            loanId: id,
            amount,
            employeeName: clean(loan.employee_name),
            branchId: toId(loan.branch_id),
            locationId: toId(loan.location_id),
          },
          auth,
        );
        await this.accountingPosting.postEmployeeLoanManualRepayment(trx, ledgerId, auth);
      }
    });
    await this.audit.log('Repay HR employee loan', `Employee loan #${id} repayment recorded by ${auth.username}`, auth);
    return { ok: true, ...(await this.listLoans({}, auth)) };
  }
}
