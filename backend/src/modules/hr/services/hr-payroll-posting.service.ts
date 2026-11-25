import { Injectable } from '@nestjs/common';
import { CashDrawerService } from '../../cash-drawer/cash-drawer.service';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { PayPayrollRunDto, PayPayrollItemDto } from '../dto/hr.dto';
import { HrTreasuryAdapter } from '../hr-treasury.adapter';
import { AccountingPostingService } from '../../accounting/accounting-posting.service';
import { allocateLoanDeduction } from '../payroll-loan-allocation.engine';
import { requireBankPayrollPaymentReference } from '../engines/hr-payroll-run.engine';
import {
  validateHrStatutoryPolicy,
  requireHrPayrollJurisdictionCurrency,
  type HrStatutoryPolicy,
} from '../engines/hr-statutory-policy.engine';
import { clean, tenantBookDigits } from '../hr-helpers';

/**
 * HrPayrollPostingService — slice H10 of the hr split (LAST slice).
 * Pure move of 5 methods from HrService (payroll posting: attendance
 * deduction application, loan-deduction settlement, run approval with the
 * accrual posting, run payment + single-item payment with the payroll
 * payment postings). No behavior change: the bodies are byte-identical;
 * the facade keeps thin delegates with the same names and signatures for
 * the 4 public methods.
 * settlePayrollLoanDeductions stays PRIVATE in the slice (no facade
 * delegate) — it is called only by approvePayrollRun (prep §2.4) and is
 * not any other slice's bound dep (tenant-scoped-reads MT-12 reads it as
 * a source pin only — merge-owned repoint, prep §7.3).
 * Spans are DISJOINT: reviewPayrollRun (H7, L3804-3820) sits between
 * applyAttendanceDeductions and settlePayrollLoanDeductions and stays in
 * the facade (same class as H8's H7 gap).
 * Deps: db + tx + audit + treasury + accountingPosting + cashDrawer?
 * (optional — @Optional() in the facade ctor, passed through as received,
 * NO fallback) + 5 bound deps — getPayrollPolicies (H0, via the facade
 * delegate) + getPayrollRun + getPayrollRunStatusForUpdate +
 * invalidatePayrollRunReview (H7, public-in-slice, via
 * this.payrollRunsService.<method>.bind(this)) + rebuildPayrollRunItems
 * (H8, public-in-slice, via
 * this.payrollRebuildService.rebuildPayrollRunItems.bind(this)). H0/H7/H8
 * all merge BEFORE H10, so their facade fields exist at merge; on this
 * generation tree the ctor wiring references fields that do not exist
 * yet — EXPECTED transient, merge-owned.
 * MERGE NOTE: this patch RESOLVES H7's transient dangles —
 * getPayrollRunStatusForUpdate ×3 + invalidatePayrollRunReview ×1 of ×2
 * (applyAttendanceDeductions; the other is H5's createQuickCashAdvance) +
 * rebuildPayrollRunItems ×2 of ×3 (applyAttendanceDeductions,
 * approvePayrollRun; the third is H5's createQuickCashAdvance). The call
 * sites move INTO the slice and resolve through the bound deps.
 * Postings (prep §3.1/§3.4, standing decisions): approvePayrollRun posts
 * the accrual via accountingPosting.postPayrollAccrual, dated at the run
 * period end; payPayrollRun / payPayrollRunItem post wage payouts as
 * payroll payments on 2140 via accountingPosting.postPayrollPayment /
 * postPayrollItemPayment + treasury.recordPayrollPayment, payments dated
 * today; drawer cash via the optional cashDrawer (ternary-guarded).
 * Free helpers (clean, tenantBookDigits) are imported from
 * '../hr-helpers' (created with the H0 merge); they are NOT copied into
 * this slice. requireTenantScope is called DIRECTLY as a free function by
 * the moved methods, so the slice imports it (prep §7.7).
 * No date sites of any kind in this slice (no getTenantTimezone /
 * todayTenantDate / new Date / toISOString / Date.UTC) — nothing to carry.
 * No toFixed2, no inlineRound, no FX in this slice. No spec repoint
 * travels in this patch — prep §7.3 rules all six source-text repoints
 * MERGE-OWNED. H10's driving spec (prep §4.2/§6.5):
 * core-accounting.postgres (payPayrollRun) — the only H10 method with
 * any real spec call.
 */

export interface HrPayrollPostingDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  treasury: HrTreasuryAdapter;
  accountingPosting: AccountingPostingService;
  cashDrawer?: CashDrawerService;
  getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
  getPayrollRun: (id: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  getPayrollRunStatusForUpdate: (db: Kysely<Database>, runId: number, tenantId: string) => Promise<string>;
  invalidatePayrollRunReview: (db: Kysely<Database>, runId: number, tenantId: string) => Promise<void>;
  rebuildPayrollRunItems: (
    db: Kysely<Database>,
    runId: number,
    itemStatus: 'draft' | 'reviewed' | 'approved',
    scopeTenantId: string,
  ) => Promise<void>;
}

@Injectable()
export class HrPayrollPostingService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly treasury: HrTreasuryAdapter;
  private readonly accountingPosting: AccountingPostingService;
  private readonly cashDrawer?: CashDrawerService;
  private readonly getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
  private readonly getPayrollRun: (id: number, auth: AuthContext) => Promise<Record<string, unknown>>;
  private readonly getPayrollRunStatusForUpdate: (
    db: Kysely<Database>,
    runId: number,
    tenantId: string,
  ) => Promise<string>;
  private readonly invalidatePayrollRunReview: (db: Kysely<Database>, runId: number, tenantId: string) => Promise<void>;
  private readonly rebuildPayrollRunItems: (
    db: Kysely<Database>,
    runId: number,
    itemStatus: 'draft' | 'reviewed' | 'approved',
    scopeTenantId: string,
  ) => Promise<void>;

  constructor(deps: HrPayrollPostingDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.treasury = deps.treasury;
    this.accountingPosting = deps.accountingPosting;
    this.cashDrawer = deps.cashDrawer;
    this.getPayrollPolicies = deps.getPayrollPolicies;
    this.getPayrollRun = deps.getPayrollRun;
    this.getPayrollRunStatusForUpdate = deps.getPayrollRunStatusForUpdate;
    this.invalidatePayrollRunReview = deps.invalidatePayrollRunReview;
    this.rebuildPayrollRunItems = deps.rebuildPayrollRunItems;
  }

  async applyAttendanceDeductions(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, tenantId);
      if (status !== 'draft' && status !== 'reviewed') {
        throw new AppError(
          'Only draft or reviewed payroll runs can be recalculated',
          'HR_PAYROLL_APPLY_DEDUCTIONS_LOCKED',
          400,
        );
      }
      // Legacy versions inserted the same attendance/insurance/tax deductions twice.
      // Remove ONLY these auto-generated adjustments; keep human-entered adjustments.
      await sql`
        DELETE FROM hr_employee_adjustments
        WHERE tenant_id = ${tenantId} AND applied_in_run_id = ${id}
          AND (reason LIKE 'تسوية تلقائية من مراجعة المرتبات:%'
            OR reason IN ('حصة الموظف في التأمينات الاجتماعية', 'ضريبة كسب العمل'))
      `.execute(trx);
      // The canonical payroll engine already includes all approved operational deductions.
      await this.rebuildPayrollRunItems(trx, id, 'draft', auth.tenantId || tenantId);
      if (status === 'reviewed') {
        await this.invalidatePayrollRunReview(trx, id, tenantId);
      }
    });
    await this.audit.log(
      'Recalculate HR payroll deductions',
      `Payroll run #${id} recalculated by ${auth.username}`,
      auth,
    );
    return this.getPayrollRun(id, auth);
  }

  private async settlePayrollLoanDeductions(trx: Kysely<Database>, runId: number, auth: AuthContext): Promise<void> {
    const { tenantId } = requireTenantScope(auth);
    const payrollPeriod = await sql<{ end_date: string }>`
      SELECT to_char(end_date, 'YYYY-MM-DD') AS end_date
      FROM hr_payroll_runs WHERE id = ${runId} AND tenant_id = ${tenantId} LIMIT 1
    `.execute(trx);
    const dueCutoff = payrollPeriod.rows[0]?.end_date;
    if (!dueCutoff) throw new AppError('مسير المرتبات غير موجود', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
    const items = await trx
      .selectFrom('hr_payroll_run_items')
      .select(['id', 'employee_id', 'loan_deduction_amount'])
      .where('run_id', '=', runId)
      .where('tenant_id', '=', auth.tenantId || '')
      .where('status', '=', 'reviewed')
      .where('loan_deduction_amount', '>', 0)
      .execute();

    const settleBookDigits = await tenantBookDigits(trx, tenantId);
    for (const item of items) {
      let remainingToDeduct = Number(item.loan_deduction_amount);
      if (remainingToDeduct <= 0) continue;

      const installments = await sql<Record<string, unknown>>`
        SELECT
          i.id AS installment_id,
          i.loan_id,
          i.amount,
          i.paid_amount,
          l.remaining_amount AS loan_remaining
        FROM hr_employee_loan_installments i
        JOIN hr_employee_loans l ON l.id = i.loan_id AND l.tenant_id = i.tenant_id
        WHERE l.employee_id = ${item.employee_id}
          AND l.tenant_id = ${tenantId}
          AND l.repayment_mode IN ('deduct_next_salary', 'monthly_salary_installment')
          AND l.status IN ('paid', 'partially_repaid', 'disbursed')
          AND GREATEST(l.issue_date, COALESCE(l.disbursed_at::date, l.issue_date)) <= ${dueCutoff}::date
          AND COALESCE(i.status, 'pending') IN ('pending', 'partial')
          AND (
            l.repayment_mode = 'deduct_next_salary'
            OR COALESCE(i.due_date, l.first_due_date, l.salary_due_date) <= ${dueCutoff}::date
          )
        ORDER BY COALESCE(i.due_date, l.first_due_date, l.salary_due_date) ASC, i.installment_no ASC, l.id ASC
        FOR UPDATE
      `.execute(trx);

      for (const row of installments.rows) {
        if (remainingToDeduct <= 0) break;

        // رصيد القرض يُقرأ **حديثاً** في كل دورة، لا من لقطة الاستعلام: خصم شهر
        // واحد قد يغطي قسطين من نفس القرض، وكان `remaining_amount` يُحسب في
        // الدورة الثانية من القيمة القديمة (بينما `paid_amount` يُقرأ حديثاً)،
        // فيختل تصالح المسدَّد مع المتبقي ويظل القرض مديناً بعد سداده كاملاً،
        // ويفقد سقف `min(..., loanRemaining)` معناه فيسمح بخصم زائد.
        const loanStateRaw = await sql<Record<string, unknown>>`
          SELECT paid_amount, remaining_amount FROM hr_employee_loans WHERE id = ${row.loan_id} AND tenant_id = ${tenantId}
        `.execute(trx);
        const loanState = loanStateRaw.rows[0];

        const allocation = allocateLoanDeduction({
          remainingToDeduct,
          installmentAmount: Number(row.amount),
          installmentPaid: Number(row.paid_amount),
          loanRemaining: Number(loanState?.remaining_amount ?? 0),
          loanPaid: Number(loanState?.paid_amount ?? 0),
          minorUnits: settleBookDigits,
        });
        if (!allocation) continue;

        const { deductAmount, newInstallmentPaid, newInstallmentStatus, newLoanRemaining, newLoanPaid, newLoanStatus } =
          allocation;
        remainingToDeduct = allocation.remainingToDeductAfter;

        await sql`
          UPDATE hr_employee_loans
          SET paid_amount = ${newLoanPaid}, remaining_amount = ${newLoanRemaining}, status = ${newLoanStatus}, updated_at = NOW()
          WHERE id = ${row.loan_id} AND tenant_id = ${tenantId}
        `.execute(trx);

        await sql`
          UPDATE hr_employee_loan_installments
          SET paid_amount = ${newInstallmentPaid}, status = ${newInstallmentStatus}, updated_at = NOW()
          WHERE id = ${row.installment_id} AND tenant_id = ${tenantId}
        `.execute(trx);

        const allocRes = await sql<Record<string, unknown>>`
          INSERT INTO hr_payroll_loan_deduction_allocations (
            tenant_id, account_id, payroll_run_id, payroll_run_item_id, employee_id, loan_id, installment_id, amount, created_by, created_at
          ) VALUES (
            ${auth.tenantId}, ${auth.accountId}, ${runId}, ${item.id}, ${item.employee_id}, ${row.loan_id}, ${row.installment_id}, ${deductAmount}, ${auth.userId}, NOW()
          ) RETURNING id
        `.execute(trx);
        const allocId = allocRes.rows[0]?.id;

        const ledgerRes = await sql<Record<string, unknown>>`
          INSERT INTO hr_employee_ledger (
            tenant_id, account_id, employee_id, entry_type, amount, balance_after, note, repayment_method, reference_type, reference_id, created_by, created_at
          ) VALUES (
            ${auth.tenantId}, ${auth.accountId}, ${item.employee_id}, 'loan_repayment', ${-deductAmount}, ${newLoanRemaining}, 'Payroll Salary Deduction', 'salary_deduction', 'hr_payroll_loan_deduction', ${allocId}, ${auth.userId}, NOW()
          ) RETURNING id
        `.execute(trx);
        const ledgerId = ledgerRes.rows[0]?.id;

        await sql`
          UPDATE hr_payroll_loan_deduction_allocations SET ledger_id = ${ledgerId}
          WHERE id = ${allocId} AND tenant_id = ${tenantId}
        `.execute(trx);
      }

      if (remainingToDeduct > 0.01) {
        throw new AppError(
          'Unable to allocate the full loan deduction amount for employee. Balances do not match.',
          'HR_PAYROLL_LOAN_ALLOCATION_MISMATCH',
          400,
        );
      }
    }
  }

  async approvePayrollRun(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Lock order matches run creation: tenant-wide payroll lock BEFORE row lock.
      // Weekly, monthly and all-employees runs cannot approve the same person twice.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const status = await this.getPayrollRunStatusForUpdate(trx, id, auth.tenantId || '');
      if (status !== 'reviewed')
        throw new AppError('Only reviewed payroll runs can be approved', 'HR_PAYROLL_APPROVE_LOCKED', 400);

      // Serialize statutory policy edits with approval/posting. The same lock
      // is held by updatePayrollPolicies; no update can slip between the policy
      // verification below and the committed ledger journal.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-policy:' + auth.tenantId}))`.execute(trx);
      // HR must maintain legal sources and residency/employee exemptions.
      const policies = await this.getPayrollPolicies(trx, auth.tenantId || '');
      const unconfiguredEmployee = await sql<{ display_name: string }>`
        SELECT e.display_name
        FROM hr_payroll_run_items i
        JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
        WHERE i.run_id = ${id} AND i.tenant_id = ${auth.tenantId} AND i.status = 'reviewed'
          AND (
            (e.has_income_tax = TRUE AND ${policies.hrIncomeTaxEnabled !== true})
            OR (e.has_social_insurance = TRUE AND ${policies.hrSocialInsuranceEnabled !== true})
          )
        LIMIT 1
      `.execute(trx);
      if (unconfiguredEmployee.rows.length) {
        throw new AppError(
          `الموظف ${unconfiguredEmployee.rows[0].display_name} عليه استقطاعات نظامية ولكن تم تعطيل سياسة احتسابها`,
          'HR_PAYROLL_EMPLOYEE_STATUTORY_DISABLED',
          409,
        );
      }
      const payrollPeriod = await sql<{ start_date: string; end_date: string }>`
        SELECT to_char(start_date, 'YYYY-MM-DD') AS start_date,
               to_char(end_date, 'YYYY-MM-DD') AS end_date
        FROM hr_payroll_runs WHERE id = ${id} AND tenant_id = ${auth.tenantId} LIMIT 1
      `.execute(trx);
      const period = payrollPeriod.rows[0];
      if (!period) throw new AppError('مسير الرواتب غير موجود', 'HR_PAYROLL_RUN_NOT_FOUND', 404);
      try {
        const hasStatutoryDeductions = Boolean(policies.hrSocialInsuranceEnabled || policies.hrIncomeTaxEnabled);
        validateHrStatutoryPolicy(
          policies as unknown as HrStatutoryPolicy,
          {
            from: period.start_date,
            to: period.end_date,
          },
          hasStatutoryDeductions,
        );
        if (hasStatutoryDeductions) {
          const currencyRows = await sql<{ value: string }>`
            SELECT value FROM settings WHERE tenant_id = ${auth.tenantId} AND key = 'currency' LIMIT 1
          `.execute(trx);
          const tenantCurrency = clean(currencyRows.rows[0]?.value).replace(/^"|"$/g, '');
          requireHrPayrollJurisdictionCurrency(policies.statutoryCountry, tenantCurrency);
        }
      } catch (error) {
        throw new AppError(
          error instanceof Error ? error.message : 'قواعد الضرائب والتأمينات غير معتمدة',
          'HR_PAYROLL_STATUTORY_RULES_UNVERIFIED',
          409,
        );
      }
      // A reviewer must re-review changed statutory settings rather than approve
      // totals calculated against an earlier rule version.
      const policyChangedAfterReview = await sql<{ stale: boolean }>`
        SELECT EXISTS (
          SELECT 1 FROM hr_hr_settings s
          JOIN hr_payroll_runs r ON r.tenant_id = s.tenant_id
          WHERE r.id = ${id} AND r.tenant_id = ${auth.tenantId}
            AND s.key = 'payroll_policies'
            AND s.updated_at > r.reviewed_at
        ) AS stale
      `.execute(trx);
      if (policyChangedAfterReview.rows[0]?.stale) {
        throw new AppError(
          'تم تغيير سياسات الاستقطاعات بعد مراجعة الكشف؛ أعد مراجعة المرتبات قبل الاعتماد',
          'HR_PAYROLL_POLICY_CHANGED_AFTER_REVIEW',
          409,
        );
      }
      const duplicatePay = await sql<{ display_name: string }>`
        SELECT e.display_name
        FROM hr_payroll_run_items current_item
        JOIN hr_payroll_runs current_run ON current_run.id = current_item.run_id
          AND current_run.tenant_id = current_item.tenant_id
        JOIN hr_payroll_run_items prior_item ON prior_item.employee_id = current_item.employee_id
          AND prior_item.tenant_id = current_item.tenant_id
          AND prior_item.run_id <> current_item.run_id AND prior_item.status <> 'excluded'
        JOIN hr_payroll_runs prior_run ON prior_run.id = prior_item.run_id
          AND prior_run.tenant_id = prior_item.tenant_id
        JOIN hr_employees e ON e.id = current_item.employee_id
          AND e.tenant_id = current_item.tenant_id
        WHERE current_item.run_id = ${id} AND current_item.tenant_id = ${auth.tenantId}
          AND current_item.status = 'reviewed'
          AND prior_run.status <> 'cancelled'
          AND prior_run.start_date <= current_run.end_date
          AND prior_run.end_date >= current_run.start_date
        LIMIT 5
      `.execute(trx);
      if (duplicatePay.rows.length) {
        throw new AppError(
          `الموظف/الموظفون ${duplicatePay.rows.map((r) => r.display_name).join('، ')} مدرجون في مسير متداخل؛ امنع صرف نفس الأيام مرتين`,
          'HR_PAYROLL_EMPLOYEE_PERIOD_COLLISION',
          409,
        );
      }
      // Never post/settle a payroll that silently contains only zero wages.
      // A zero-wage employee with no punches can be legitimate; a completely
      // empty payable run must be corrected or deliberately excluded first.
      const wageSummary = await sql<{ count: string; total: string }>`
        SELECT COUNT(*)::text AS count,
          COALESCE(SUM(gross_pay), 0)::text AS total
        FROM hr_payroll_run_items
        WHERE run_id = ${id} AND tenant_id = ${auth.tenantId} AND status = 'reviewed'
      `.execute(trx);
      if (Number(wageSummary.rows[0]?.count || 0) === 0 || Number(wageSummary.rows[0]?.total || 0) <= 0) {
        throw new AppError(
          'لا يمكن اعتماد كشف مرتبات فارغ أو جميع أجوره صفر. راجع الأجر والعقود والحضور أولًا.',
          'HR_PAYROLL_ZERO_WAGES',
          400,
        );
      }
      // A single employee must never be silently included with an undefined
      // rate/contract while another employee makes the overall run non-zero.
      const missingRates = await sql<{ display_name: string }>`
        SELECT e.display_name
        FROM hr_payroll_run_items i
        JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        WHERE i.run_id = ${id} AND i.tenant_id = ${auth.tenantId}
          AND i.status = 'reviewed'
          AND (
            (e.compensation_type = 'hourly' AND COALESCE(e.hourly_rate, 0) <= 0)
            OR (e.compensation_type <> 'hourly' AND NOT EXISTS (
              SELECT 1 FROM hr_employment_contracts c
              WHERE c.employee_id = e.id AND c.tenant_id = e.tenant_id
                AND c.status IN ('active', 'ended') AND c.base_salary > 0
                AND c.start_date <= r.end_date
                AND (c.end_date IS NULL OR c.end_date >= r.start_date)
            ))
          )
        LIMIT 5
      `.execute(trx);
      if (missingRates.rows.length) {
        const names = missingRates.rows.map((row) => String(row.display_name)).join('، ');
        throw new AppError(
          `يوجد موظفون بدون أجر ساعة أو عقد براتب نشط وصحيح: ${names}`,
          'HR_PAYROLL_MISSING_EMPLOYEE_RATES',
          400,
        );
      }
      // Hourly base salary counts only completed punches. An unclosed or
      // malformed paid work session must never be silently omitted at approval.
      const invalidHourlyPunch = await sql<{ display_name: string }>`
        SELECT DISTINCT e.display_name
        FROM hr_payroll_run_items i
        JOIN hr_payroll_runs r ON r.id = i.run_id AND r.tenant_id = i.tenant_id
        JOIN hr_employees e ON e.id = i.employee_id AND e.tenant_id = i.tenant_id
        JOIN hr_attendance_records a ON a.employee_id = e.id AND a.tenant_id = e.tenant_id
        WHERE i.run_id = ${id} AND i.tenant_id = ${auth.tenantId}
          AND i.status = 'reviewed' AND e.compensation_type = 'hourly'
          AND a.work_date BETWEEN GREATEST(r.start_date, COALESCE(e.hire_date, r.start_date))
              AND LEAST(r.end_date, COALESCE(e.end_of_service_date, r.end_date))
          AND a.status NOT IN ('absent', 'leave')
          AND (
            (a.check_in_at IS NULL AND a.check_out_at IS NOT NULL)
            OR (a.check_in_at IS NOT NULL AND a.check_out_at IS NULL)
            OR (a.check_in_at IS NOT NULL AND a.check_out_at IS NOT NULL
              AND (a.check_out_at <= a.check_in_at OR a.check_out_at > a.check_in_at + INTERVAL '24 hours'))
          )
        LIMIT 5
      `.execute(trx);
      if (invalidHourlyPunch.rows.length) {
        throw new AppError(
          `يوجد دوام ساعات غير مكتمل أو غير صالح للموظفين: ${invalidHourlyPunch.rows.map((r) => r.display_name).join('، ')}؛ صحح الحضور قبل اعتماد المرتبات`,
          'HR_PAYROLL_HOURLY_PUNCH_UNRESOLVED',
          409,
        );
      }
      // A reviewed payroll still cannot be approved with disputed attendance.
      const pendingAttendance = await sql<{ pending: string }>`
        SELECT COUNT(*)::text AS pending
        FROM hr_attendance_exceptions ex
        JOIN hr_payroll_run_items item
          ON item.employee_id = ex.employee_id AND item.tenant_id = ex.tenant_id
          AND item.run_id = ${id} AND item.status = 'reviewed'
        JOIN hr_payroll_runs run ON run.id = item.run_id AND run.tenant_id = item.tenant_id
        WHERE ex.tenant_id = ${auth.tenantId}
          AND ex.status IN ('pending', 'needs_review')
          AND ex.work_date BETWEEN run.start_date AND run.end_date
      `.execute(trx);
      if (Number(pendingAttendance.rows[0]?.pending || 0) > 0) {
        throw new AppError(
          `يوجد ${pendingAttendance.rows[0].pending} استثناء حضور أو تأخير يحتاج مراجعة قبل اعتماد المرتبات`,
          'HR_PAYROLL_ATTENDANCE_PENDING',
          400,
        );
      }
      // A reviewer approves a concrete financial snapshot, not an arbitrary
      // historic cached amount. Rebuild the SAME payroll engine under the run
      // row lock, and reject if a salary, contract, attendance, loan or
      // adjustment has changed since the review. A thrown error rolls back
      // all temporary recalculation changes including adjustment status.
      const reviewSnapshot = async () => {
        const snapshot = await sql<Record<string, unknown>>`
          SELECT employee_id, status, contract_id, base_salary, allowance_amount,
                 deduction_amount, loan_deduction_amount,
                 asset_recovery_deduction_amount, employee_social_insurance,
                 employer_social_insurance, income_tax, penalty_deduction,
                 carried_forward_deduction, gross_pay, net_pay
          FROM hr_payroll_run_items
          WHERE run_id = ${id} AND tenant_id = ${auth.tenantId}
          ORDER BY employee_id ASC
        `.execute(trx);
        return JSON.stringify(snapshot.rows);
      };
      const reviewedAmounts = await reviewSnapshot();
      await this.rebuildPayrollRunItems(trx, id, 'reviewed', auth.tenantId || '');
      const recalculatedAmounts = await reviewSnapshot();
      if (reviewedAmounts !== recalculatedAmounts) {
        throw new AppError(
          'تغيرت بيانات المرتبات أو الحضور أو السلف بعد المراجعة؛ يجب إعادة مراجعة الكشف قبل الاعتماد النهائي',
          'HR_PAYROLL_REVIEW_STALE',
          409,
        );
      }

      // A loan's unpaid part remains in installments and will be due in a
      // future payroll. By contrast, carried_forward_deduction contains
      // attendance/leave/asset/other reductions with NO durable receivable
      // or next-run replay. Approval must fail instead of silently writing off
      // that remainder under an apparently "carried forward" label.
      const untrackedDeferred = await sql<{ employee_id: number; amount: string }>`
        SELECT employee_id, carried_forward_deduction::text AS amount
        FROM hr_payroll_run_items
        WHERE run_id = ${id} AND tenant_id = ${auth.tenantId}
          AND status = 'reviewed' AND carried_forward_deduction > 0
        LIMIT 1
      `.execute(trx);
      if (untrackedDeferred.rows.length) {
        const row = untrackedDeferred.rows[0];
        throw new AppError(
          `الموظف #${row.employee_id} عليه استقطاعات مؤجلة بقيمة ${row.amount} لا توجد آلية آمنة لترحيلها تلقائيًا؛ يلزم تسوية معتمدة قبل اعتماد المسير`,
          'HR_PAYROLL_UNTRACKED_CARRIED_FORWARD',
          409,
        );
      }
      await this.settlePayrollLoanDeductions(trx, id, auth);

      const { posted } = await this.accountingPosting.postPayrollAccrual(trx, id, auth);
      if (!posted)
        throw new AppError(
          'Payroll accrual journal entry could not be created or already exists',
          'HR_PAYROLL_ACCRUAL_FAILED',
          400,
        );

      await sql`UPDATE hr_payroll_run_items SET status = 'approved', updated_at = NOW() WHERE run_id = ${id} AND status = 'reviewed' AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
      await sql`UPDATE hr_payroll_runs SET status = 'approved', approved_by = ${auth.userId}, approved_at = NOW(), updated_at = NOW() WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(
        trx,
      );
    });
    await this.audit.log('Approve HR payroll run', `Payroll run #${id} approved by ${auth.username}`, auth);
    return this.getPayrollRun(id, auth);
  }

  async payPayrollRun(id: number, payload: PayPayrollRunDto, auth: AuthContext): Promise<Record<string, unknown>> {
    let paymentReference: string = '';
    if (payload.paymentChannel === 'bank') {
      try {
        paymentReference = requireBankPayrollPaymentReference(payload.paymentChannel, payload.paymentReference);
      } catch (error) {
        throw new AppError(
          error instanceof Error ? error.message : 'المرجع البنكي غير صحيح',
          'HR_PAYROLL_PAYMENT_REFERENCE_REQUIRED',
          400,
        );
      }
    }
    await this.tx.runInTransaction(this.db, async (trx) => {
      const status = await this.getPayrollRunStatusForUpdate(trx, id, auth.tenantId || '');
      if (!['approved', 'partially_paid'].includes(status)) {
        throw new AppError('Only approved or partially paid payroll runs can be paid', 'HR_PAYROLL_PAY_LOCKED', 400);
      }

      const remainingItems = await trx
        .selectFrom('hr_payroll_run_items as i')
        .innerJoin('hr_employees as e', (join) =>
          join.onRef('e.id', '=', 'i.employee_id').onRef('e.tenant_id', '=', 'i.tenant_id'),
        )
        .select(['i.id', 'i.employee_id', 'i.net_pay', 'e.display_name'])
        .where('i.run_id', '=', id)
        .where('i.tenant_id', '=', auth.tenantId || '')
        .where('i.status', '=', 'approved')
        .execute();

      const totalNetPay = remainingItems.reduce((acc, row) => acc + Number(row.net_pay || 0), 0);
      if (totalNetPay <= 0) {
        throw new AppError('لا توجد مستحقات معتمدة متبقية للصرف في هذا الكشف', 'HR_PAYROLL_PAYMENT_ZERO', 400);
      }

      let shiftId: number | null = null;
      if (payload.paymentChannel === 'drawer') {
        shiftId = Number(payload.shiftId) || null;
        let eligibleShift: any;
        if (shiftId) {
          eligibleShift = await sql`
            SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash
            FROM cashier_shifts
            WHERE id = ${shiftId} AND tenant_id = ${auth.tenantId} AND status = 'open'
            FOR UPDATE
          `.execute(trx);
        } else {
          eligibleShift = await sql`
            SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash
            FROM cashier_shifts
            WHERE tenant_id = ${auth.tenantId} AND status = 'open'
              AND (opened_by = ${auth.userId} OR ${['admin', 'super_admin', 'owner', 'manager'].includes(auth.role)} OR ${Boolean(auth.permissions?.includes('hr') || auth.permissions?.includes('hrPayrollManage'))})
            ORDER BY (opened_by = ${auth.userId}) DESC, id DESC LIMIT 1
            FOR UPDATE
          `.execute(trx);
        }
        if (!eligibleShift.rows.length) {
          throw new AppError(
            'لا توجد وردية كاشير مفتوحة للصرف منها؛ افتح وردية نقدية أولاً أو اختر الخزينة العامة',
            'HR_CASHIER_SHIFT_REQUIRED',
            400,
          );
        }
        const shift = eligibleShift.rows[0];
        shiftId = Number(shift.id);
        const drawerCash = this.cashDrawer
          ? await this.cashDrawer.computeShiftExpectedCash(shiftId, auth, trx)
          : Number(shift.expected_cash || 0);
        if (totalNetPay > drawerCash && !payload.allowOverdraft) {
          throw new AppError(
            `نقدية درج الكاشير (${drawerCash.toLocaleString('en-US')} ج.م) غير كافية لصرف إجمالي المسير (${totalNetPay.toLocaleString('en-US')} ج.م)`,
            'HR_DRAWER_INSUFFICIENT_CASH',
            400,
          );
        }

        const cashierUser = await sql<{ name: string }>`
          SELECT COALESCE(NULLIF(display_name, ''), username) as name
          FROM users
          WHERE id = ${shift.opened_by} AND tenant_id = ${auth.tenantId}
          LIMIT 1
        `.execute(trx);
        const cashierName = cashierUser.rows[0]?.name || 'الكاشير';

        await sql`
          UPDATE cashier_shifts
          SET expected_cash = ${drawerCash - totalNetPay}
          WHERE id = ${shiftId} AND tenant_id = ${auth.tenantId} AND status = 'open'
        `.execute(trx);

        await sql`
          INSERT INTO treasury_transactions (
            tenant_id, account_id, txn_type, amount, payment_channel, note, reference_type,
            reference_id, branch_id, location_id, created_by
          ) VALUES (
            ${auth.tenantId}, ${auth.accountId}, 'cash_out', ${-totalNetPay}, 'cash',
            ${`صرف رواتب مسير #${id} من درج الكاشير (${cashierName} - وردية #${shiftId})`},
            'cashier_shift', ${shiftId}, ${shift.branch_id}, ${shift.location_id}, ${auth.userId}
          )
        `.execute(trx);
      } else if (payload.paymentChannel === 'cash') {
        await this.treasury.recordPayrollPayment(
          trx,
          {
            runId: id,
            amount: totalNetPay,
            branchId: null,
            locationId: null,
          },
          auth,
        );
      }

      const { posted, journalEntryId } = await this.accountingPosting.postPayrollPayment(
        trx,
        id,
        payload.paymentChannel,
        auth,
      );
      if (!posted && !journalEntryId) {
        throw new AppError('Payroll payment journal entry could not be created', 'HR_PAYROLL_PAYMENT_FAILED', 400);
      }

      // Update remaining approved items to paid
      await sql`
        UPDATE hr_payroll_run_items
        SET status = 'paid',
            paid_by = ${auth.userId},
            paid_at = NOW(),
            payment_channel = ${payload.paymentChannel},
            payment_reference = ${paymentReference || null},
            shift_id = ${shiftId},
            journal_entry_id = ${journalEntryId || null},
            notes = CASE WHEN ${Boolean(payload.notes)} THEN COALESCE(NULLIF(notes, ''), '') || ' | ' || ${clean(payload.notes)} ELSE notes END,
            updated_at = NOW()
        WHERE run_id = ${id} AND tenant_id = ${auth.tenantId} AND status = 'approved'
      `.execute(trx);

      // Record in employee ledger for each employee
      for (const item of remainingItems) {
        await sql`
          INSERT INTO hr_employee_ledger (
            employee_id, entry_type, amount, balance_after, note, reference_type, reference_id,
            created_by, tenant_id, account_id
          ) VALUES (
            ${item.employee_id}, 'wage_payout', ${Number(item.net_pay || 0)}, 0,
            ${`صرف وتصفية مستحقات الراتب - مسير #${id} عبر ${payload.paymentChannel === 'drawer' ? 'درج الكاشير' : payload.paymentChannel === 'bank' ? 'البنك' : 'الخزينة'}`},
            'hr_payroll_run', ${id}, ${auth.userId}, ${auth.tenantId}, ${auth.accountId}
          )
        `.execute(trx);
      }

      await sql`
        UPDATE hr_payroll_runs
        SET status = 'paid',
            paid_by = ${auth.userId},
            paid_at = NOW(),
            payment_channel = ${payload.paymentChannel},
            payment_reference = ${paymentReference || null},
            payment_notes = ${payload.notes || ''},
            updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${auth.tenantId}
      `.execute(trx);
    });
    await this.audit.log(
      'Pay HR payroll run',
      `Payroll run #${id} paid by ${auth.username} via ${payload.paymentChannel}`,
      auth,
    );
    return this.getPayrollRun(id, auth);
  }

  async payPayrollRunItem(
    itemId: number,
    payload: PayPayrollItemDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    let paymentReference: string = '';
    if (payload.paymentChannel === 'bank') {
      try {
        paymentReference = requireBankPayrollPaymentReference(payload.paymentChannel, payload.paymentReference);
      } catch (error) {
        throw new AppError(
          error instanceof Error ? error.message : 'المرجع البنكي غير صحيح',
          'HR_PAYROLL_PAYMENT_REFERENCE_REQUIRED',
          400,
        );
      }
    }

    let runId = 0;
    await this.tx.runInTransaction(this.db, async (trx) => {
      const item = await trx
        .selectFrom('hr_payroll_run_items as i')
        .innerJoin('hr_employees as e', (join) =>
          join.onRef('e.id', '=', 'i.employee_id').onRef('e.tenant_id', '=', 'i.tenant_id'),
        )
        .innerJoin('hr_payroll_runs as r', (join) =>
          join.onRef('r.id', '=', 'i.run_id').onRef('r.tenant_id', '=', 'i.tenant_id'),
        )
        .select([
          'i.id',
          'i.run_id',
          'i.employee_id',
          'i.net_pay',
          'i.status',
          'e.display_name',
          'r.status as run_status',
          'r.period_month',
        ])
        .where('i.id', '=', itemId)
        .where('i.tenant_id', '=', auth.tenantId || '')
        .forUpdate()
        .executeTakeFirst();

      if (!item) throw new AppError('بند الراتب غير موجود', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
      runId = Number(item.run_id);
      if ((item.status as string) === 'paid') {
        throw new AppError('تم صرف مستحقات هذا الموظف بالفعل مسبقاً', 'HR_PAYROLL_ITEM_ALREADY_PAID', 400);
      }
      if (item.status !== 'approved') {
        throw new AppError('يمكن صرف المستحقات للبنود المعتمدة فقط', 'HR_PAYROLL_ITEM_NOT_APPROVED', 400);
      }
      if (!['approved', 'partially_paid'].includes(String(item.run_status))) {
        throw new AppError('مسير الرواتب يجب أن يكون معتمداً للصرف', 'HR_PAYROLL_RUN_NOT_APPROVED', 400);
      }

      const netPay = Number(item.net_pay || 0);
      if (netPay <= 0) throw new AppError('صافي أجر الموظف صفر أو سالب', 'HR_PAYROLL_AMOUNT_ZERO', 400);

      let shiftId: number | null = null;
      let branchId: number | null = null;
      let locationId: number | null = null;

      if (payload.paymentChannel === 'drawer') {
        shiftId = Number(payload.shiftId) || null;
        let eligibleShift: any;
        if (shiftId) {
          eligibleShift = await sql`
            SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash
            FROM cashier_shifts
            WHERE id = ${shiftId} AND tenant_id = ${auth.tenantId} AND status = 'open'
            FOR UPDATE
          `.execute(trx);
        } else {
          eligibleShift = await sql`
            SELECT id, branch_id, location_id, opened_by, COALESCE(expected_cash, 0) AS expected_cash
            FROM cashier_shifts
            WHERE tenant_id = ${auth.tenantId} AND status = 'open'
              AND (opened_by = ${auth.userId} OR ${['admin', 'super_admin', 'owner', 'manager'].includes(auth.role)} OR ${Boolean(auth.permissions?.includes('hr') || auth.permissions?.includes('hrPayrollManage'))})
            ORDER BY (opened_by = ${auth.userId}) DESC, id DESC LIMIT 1
            FOR UPDATE
          `.execute(trx);
        }
        if (!eligibleShift.rows.length) {
          throw new AppError(
            'لا توجد وردية كاشير مفتوحة للصرف منها؛ افتح وردية نقدية أولاً أو اختر الخزينة العامة',
            'HR_CASHIER_SHIFT_REQUIRED',
            400,
          );
        }
        const shift = eligibleShift.rows[0];
        shiftId = Number(shift.id);
        branchId = shift.branch_id ? Number(shift.branch_id) : null;
        locationId = shift.location_id ? Number(shift.location_id) : null;
        const drawerCash = this.cashDrawer
          ? await this.cashDrawer.computeShiftExpectedCash(shiftId, auth, trx)
          : Number(shift.expected_cash || 0);
        if (netPay > drawerCash && !payload.allowOverdraft) {
          throw new AppError(
            `نقدية درج الكاشير (${drawerCash.toLocaleString('en-US')} ج.م) غير كافية لصرف صافي راتب الموظف (${netPay.toLocaleString('en-US')} ج.م)؛ يلزم إيداع نقدية بالدرج أو اختيار الخزينة العامة`,
            'HR_DRAWER_INSUFFICIENT_CASH',
            400,
          );
        }

        const cashierUser = await sql<{ name: string }>`
          SELECT COALESCE(NULLIF(display_name, ''), username) as name
          FROM users
          WHERE id = ${shift.opened_by} AND tenant_id = ${auth.tenantId}
          LIMIT 1
        `.execute(trx);
        const cashierName = cashierUser.rows[0]?.name || 'الكاشير';

        await sql`
          UPDATE cashier_shifts
          SET expected_cash = ${drawerCash - netPay}
          WHERE id = ${shiftId} AND tenant_id = ${auth.tenantId} AND status = 'open'
        `.execute(trx);

        await sql`
          INSERT INTO treasury_transactions (
            tenant_id, account_id, txn_type, amount, payment_channel, note, reference_type,
            reference_id, branch_id, location_id, created_by
          ) VALUES (
            ${auth.tenantId}, ${auth.accountId}, 'cash_out', ${-netPay}, 'cash',
            ${`صرف راتب الموظف ${item.display_name} (#${item.employee_id}) من درج الكاشير (${cashierName} - وردية #${shiftId}) - مسير #${item.run_id}`},
            'cashier_shift', ${shiftId}, ${branchId}, ${locationId}, ${auth.userId}
          )
        `.execute(trx);
      } else if (payload.paymentChannel === 'cash') {
        await this.treasury.recordPayrollPayment(
          trx,
          {
            runId: runId,
            amount: netPay,
            branchId: null,
            locationId: null,
          },
          auth,
        );
      }

      // Post GL journal for this employee
      const { posted, journalEntryId } = await this.accountingPosting.postPayrollItemPayment(
        trx,
        itemId,
        payload.paymentChannel,
        auth,
        { employeeName: item.display_name, branchId, locationId },
      );

      // Update item to paid
      await sql`
        UPDATE hr_payroll_run_items
        SET status = 'paid',
            paid_at = NOW(),
            paid_by = ${auth.userId},
            payment_channel = ${payload.paymentChannel},
            payment_reference = ${paymentReference || null},
            shift_id = ${shiftId},
            journal_entry_id = ${journalEntryId || null},
            notes = CASE WHEN ${Boolean(payload.notes)} THEN COALESCE(NULLIF(notes, ''), '') || ' | ' || ${clean(payload.notes)} ELSE notes END,
            updated_at = NOW()
        WHERE id = ${itemId} AND tenant_id = ${auth.tenantId}
      `.execute(trx);

      // Record in employee ledger
      await sql`
        INSERT INTO hr_employee_ledger (
          employee_id, entry_type, amount, balance_after, note, reference_type, reference_id,
          created_by, tenant_id, account_id
        ) VALUES (
          ${item.employee_id}, 'wage_payout', ${netPay}, 0,
          ${`صرف وتصفية مستحقات راتب شهر ${item.period_month} عبر ${payload.paymentChannel === 'drawer' ? 'درج الكاشير' : payload.paymentChannel === 'bank' ? 'البنك' : 'الخزينة'}`},
          'hr_payroll_run_item', ${itemId}, ${auth.userId}, ${auth.tenantId}, ${auth.accountId}
        )
      `.execute(trx);

      // Reconcile run status
      const remainingApproved = await sql<{ count: string }>`
        SELECT COUNT(*) as count
        FROM hr_payroll_run_items
        WHERE run_id = ${runId} AND tenant_id = ${auth.tenantId} AND status = 'approved'
      `.execute(trx);
      const remainingCount = Number(remainingApproved.rows[0]?.count || 0);

      if (remainingCount === 0) {
        await sql`
          UPDATE hr_payroll_runs
          SET status = 'paid',
              paid_at = NOW(),
              paid_by = ${auth.userId},
              payment_channel = ${payload.paymentChannel},
              payment_reference = ${paymentReference || null},
              updated_at = NOW()
          WHERE id = ${runId} AND tenant_id = ${auth.tenantId}
        `.execute(trx);
      } else {
        await sql`
          UPDATE hr_payroll_runs
          SET status = 'partially_paid',
              updated_at = NOW()
          WHERE id = ${runId} AND tenant_id = ${auth.tenantId}
        `.execute(trx);
      }
    });

    await this.audit.log(
      'Pay HR payroll item',
      `Payroll item #${itemId} paid by ${auth.username} via ${payload.paymentChannel}`,
      auth,
    );
    return this.getPayrollRun(runId, auth);
  }
}
