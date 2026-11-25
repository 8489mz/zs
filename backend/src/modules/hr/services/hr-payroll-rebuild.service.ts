/**
 * HrPayrollRebuildService — slice H8 of the hr split.
 * Pure move of 3 methods from HrService (payroll rebuild: rebuildPayrollRunItems
 * + its 2 private helpers adjustmentTotals, calculateLoanDeduction).
 * No behavior change: the bodies are byte-identical; the ONLY change is
 * rebuildPayrollRunItems becoming PUBLIC in the slice (prep §2.5
 * public-in-slice rule — it is a bound dep of H7 createPayrollRun /
 * recalculatePayrollRun / reviewPayrollRun, H5 createQuickCashAdvance and
 * H10 applyAttendanceDeductions / approvePayrollRun, so the facade keeps NO
 * delegate for it). adjustmentTotals + calculateLoanDeduction stay PRIVATE
 * in the slice (prep §2.4: private helpers traveling with their sole caller
 * rebuildPayrollRunItems — H4/H12 precedent). The facade still constructs
 * this slice eagerly in its ctor.
 * Deps: bound getPayrollPolicies (H0) + bound calculatePayrollOperationalReview
 * (H9) ONLY. The slice takes NO db / tx / audit ctor field — prep §6
 * "db, tx, audit" overcounts (H9-class correction): the moved text's only
 * this.* refs are the 2 bound calls + the 2 H8-internal calls; db arrives as
 * each method's first parameter, exactly as today. The facade passes
 * getPayrollPolicies as its bound delegate (works before + after H0 merges)
 * and calculatePayrollOperationalReview via the H9 slice field
 * (this.payrollReviewService.calculatePayrollOperationalReview.bind(this) —
 * H9 merges before H8, so the field exists at merge; H11 precedent for a
 * provider-slice-field forward reference on the generation tree).
 * Guard pin: the rep-payroll-target-month-m2 markers travel verbatim inside
 * rebuildPayrollRunItems (vanSettlementIds + SET payroll_run_id + the
 * INV-REP-PAYROLL-TARGET-MONTH comment); their repoint to this file is
 * merge-owned (§7.3). Date handling: none — the moved methods construct no
 * dates (no new Date / Date.UTC / toISOString / getTenantTimezone /
 * todayTenantDate anywhere in the moved text). Guard: 0 toFixed2 / 0
 * inlineRound moved; the facade stays 11 on this generation tree.
 */
import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { Database } from '../../../database/database.types';
import { calculatePayrollLoanDueTotal } from '../payroll-loan-allocation.engine';
import { MoneyDigits, currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';
import { calculateHourlyOvertimePremium } from '../engines/payroll-calculation.engine';
import {
  calculateHrPayrollRunLine,
  requirePayrollMonetaryCurrency,
  canReincludeAutoExcludedPayrollItem,
  AUTO_PAYROLL_EXCLUSION_NOTE,
} from '../engines/hr-payroll-run.engine';
import { type HrStatutoryPolicy } from '../engines/hr-statutory-policy.engine';
import {
  summarizeHourlyAttendance,
  calculateEffectiveContractPay,
  calculateEffectiveCompensationPay,
  calculateDatedPayrollAdjustment,
  payrollCalendarMonthFraction,
  type EffectiveSalaryContract,
  type EffectiveCompensationPackage,
} from '../engines/hourly-attendance-pay.engine';
import { toId, clean, normalizeDateOnly, normalizePayrollMonth, monthRange, money, combineNotes } from '../hr-helpers';

export interface HrPayrollRebuildDeps {
  getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
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
export class HrPayrollRebuildService {
  private readonly getPayrollPolicies: (db: any, tenantId: string) => Promise<any>;
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

  constructor(deps: HrPayrollRebuildDeps) {
    this.getPayrollPolicies = deps.getPayrollPolicies;
    this.calculatePayrollOperationalReview = deps.calculatePayrollOperationalReview;
  }

  private async calculateLoanDeduction(
    db: Kysely<Database>,
    employeeId: number,
    periodEndDate: string,
    tenantId: string,
    minorUnits: MoneyDigits,
  ): Promise<{ amount: number; notes: string[] }> {
    const dueCutoff = normalizeDateOnly(periodEndDate);
    if (!dueCutoff) throw new AppError('تاريخ نهاية فترة المسير غير صحيح', 'HR_PAYROLL_PERIOD_END_INVALID', 400);
    const result = await sql<Record<string, unknown>>`
      SELECT
        i.loan_id,
        i.id AS installment_id,
        i.amount,
        i.paid_amount,
        i.status,
        l.remaining_amount AS loan_remaining,
        to_char(COALESCE(i.due_date, l.first_due_date, l.salary_due_date), 'YYYY-MM-DD') AS due_date_text
      FROM hr_employee_loan_installments i
      JOIN hr_employee_loans l ON l.id = i.loan_id AND l.tenant_id = i.tenant_id
      WHERE l.employee_id = ${employeeId} AND l.tenant_id = ${tenantId}
        AND l.repayment_mode IN ('deduct_next_salary', 'monthly_salary_installment')
        AND l.status IN ('paid', 'partially_repaid', 'disbursed')
        AND GREATEST(l.issue_date, COALESCE(l.disbursed_at::date, l.issue_date)) <= ${dueCutoff}::date
        AND COALESCE(i.status, 'pending') IN ('pending', 'partial')
        AND (
          l.repayment_mode = 'deduct_next_salary'
          OR COALESCE(i.due_date, l.first_due_date, l.salary_due_date) <= ${dueCutoff}::date
        )
      ORDER BY COALESCE(i.due_date, l.first_due_date, l.salary_due_date) ASC, i.installment_no ASC
    `.execute(db);
    const notes: string[] = [];
    const eligible = result.rows.map((installment) => ({
      loanId: Number(installment.loan_id),
      installmentAmount: Number(installment.amount),
      installmentPaid: Number(installment.paid_amount || 0),
      loanRemaining: Number(installment.loan_remaining),
    }));
    let total: number;
    try {
      total = calculatePayrollLoanDueTotal(eligible, minorUnits);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'أرصدة السلف والأقساط غير متطابقة',
        'HR_PAYROLL_LOAN_BALANCE_INVALID',
        409,
      );
    }
    return { amount: total, notes };
  }

  private async adjustmentTotals(
    db: Kysely<Database>,
    itemId: number,
    tenantId: string,
    minorUnits: MoneyDigits,
  ): Promise<{ allowance: number; deduction: number }> {
    const result = await sql<{ allowance: string; deduction: string }>`
      SELECT
        COALESCE(SUM(CASE WHEN adjustment_type = 'allowance' THEN amount ELSE 0 END), 0) AS allowance,
        COALESCE(SUM(CASE WHEN adjustment_type = 'deduction' THEN amount ELSE 0 END), 0) AS deduction
      FROM hr_payroll_item_adjustments
      WHERE payroll_item_id = ${itemId} AND tenant_id = ${tenantId}
    `.execute(db);
    return {
      allowance: money(result.rows[0]?.allowance, minorUnits),
      deduction: money(result.rows[0]?.deduction, minorUnits),
    };
  }

  /**
   * O28: `runId` comes from the request path, and the whole rebuild derives its tenant from the row
   * it reads. Reading that row by id alone meant a payroll id from another tenant would have set the
   * scope for every write below. The caller's tenant is now required, and a run outside it is not found.
   */
  async rebuildPayrollRunItems(
    db: Kysely<Database>,
    runId: number,
    itemStatus: 'draft' | 'reviewed' | 'approved',
    scopeTenantId: string,
  ): Promise<void> {
    const callerTenantId = clean(scopeTenantId);
    if (!callerTenantId) throw new AppError('نطاق المنشأة مطلوب', 'HR_PAYROLL_TENANT_REQUIRED', 400);
    const runResult =
      await sql<any>`SELECT period_month, tenant_id, account_id, to_char(start_date, 'YYYY-MM-DD') as start_date_text, to_char(end_date, 'YYYY-MM-DD') as end_date_text, pay_frequency FROM hr_payroll_runs WHERE id = ${runId} AND tenant_id = ${callerTenantId} LIMIT 1`.execute(
        db,
      );
    const run = runResult.rows[0];
    if (!run) return;
    const periodMonth = normalizePayrollMonth(run.period_month || run.periodMonth);
    if (!periodMonth) throw new AppError('Payroll month is invalid', 'HR_PAYROLL_MONTH_INVALID', 400);
    const tenantId = run.tenant_id || run.tenantId || '';
    const accountId = run.account_id || run.accountId || '';
    const range = {
      from: run.start_date_text || monthRange(periodMonth).from,
      to: run.end_date_text || monthRange(periodMonth).to,
    };
    const payFreq = clean(run.pay_frequency) || 'monthly';
    await sql`UPDATE hr_employee_adjustments SET status = 'pending', applied_in_run_id = NULL WHERE applied_in_run_id = ${runId} AND tenant_id = ${tenantId}`.execute(
      db,
    );
    const employees = await sql<Record<string, unknown>>`
      SELECT
        e.id AS employee_id,
        e.display_name,
        c.id AS contract_id,
        c.base_salary,
        e.compensation_type,
        e.hourly_rate,
        e.expected_daily_hours,
        to_char(e.hire_date, 'YYYY-MM-DD') AS hire_date,
        to_char(e.end_of_service_date, 'YYYY-MM-DD') AS end_of_service_date,
        e.has_social_insurance,
        e.insurance_salary,
        e.has_income_tax,
        to_char(c.start_date, 'YYYY-MM-DD') AS contract_start_date,
        to_char(c.end_date, 'YYYY-MM-DD') AS contract_end_date
      FROM hr_employees e
      LEFT JOIN LATERAL (
        SELECT *
        FROM hr_employment_contracts c
        WHERE c.employee_id = e.id AND c.tenant_id = e.tenant_id
          AND c.status IN ('active', 'ended')
          AND c.start_date <= ${range.to}::date
          AND (c.end_date IS NULL OR c.end_date >= ${range.from}::date)
        ORDER BY c.start_date DESC NULLS LAST,
                 c.id DESC
        LIMIT 1
      ) c ON TRUE
      WHERE e.tenant_id = ${tenantId}
        AND (
          e.status = 'active'
          OR (
            e.status = 'terminated'
            AND e.end_of_service_date >= ${range.from}::date
            -- A posted EOS settlement reconciles the final wage separately;
            -- do not include it again in payroll.
            AND NOT EXISTS (
              SELECT 1 FROM hr_end_of_service_settlements s
              WHERE s.employee_id = e.id AND s.tenant_id = e.tenant_id
                AND s.status = 'posted'
            )
          )
        )
        AND (e.hire_date IS NULL OR e.hire_date <= ${range.to}::date)
        AND (e.end_of_service_date IS NULL OR e.end_of_service_date >= ${range.from}::date)
        ${payFreq === 'all' ? sql`` : sql`AND COALESCE(e.pay_frequency, 'monthly') = ${payFreq}`}
      ORDER BY e.id ASC
    `.execute(db);

    const empIds = employees.rows.map((e) => Number(e.employee_id)).filter((id) => id > 0);
    const currencySetting = await sql<{ value: string }>`
      SELECT value FROM settings WHERE tenant_id = ${tenantId} AND key = 'currency' LIMIT 1
    `.execute(db);
    const payrollCurrency = clean(currencySetting.rows[0]?.value).replace(/^"|"$/g, '').toUpperCase();
    try {
      requirePayrollMonetaryCurrency(payrollCurrency, payrollCurrency);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'عملة مسير الرواتب غير مدعومة',
        'HR_PAYROLL_CURRENCY_UNSUPPORTED',
        409,
      );
    }
    const bookDigits = currencyMoneyDigits(payrollCurrency);
    const contractRows = empIds.length
      ? await sql<Record<string, unknown>>`
          SELECT employee_id, id, base_salary, currency,
            to_char(start_date, 'YYYY-MM-DD') AS start_date_text,
            to_char(end_date, 'YYYY-MM-DD') AS end_date_text
          FROM hr_employment_contracts
          WHERE tenant_id = ${tenantId}
            AND employee_id IN (${sql.join(empIds)})
            AND status IN ('active', 'ended')
            AND start_date <= ${range.to}::date
            AND (end_date IS NULL OR end_date >= ${range.from}::date)
          ORDER BY employee_id, start_date, id
        `.execute(db)
      : { rows: [] as Record<string, unknown>[] };
    const contractHistory = new Map<number, EffectiveSalaryContract[]>();
    for (const row of contractRows.rows) {
      const employeeId = Number(row.employee_id);
      try {
        requirePayrollMonetaryCurrency(payrollCurrency, clean(row.currency));
      } catch (error) {
        throw new AppError(
          `عملة عقد الموظف #${employeeId}: ${error instanceof Error ? error.message : 'عملة غير صحيحة'}`,
          'HR_PAYROLL_CONTRACT_CURRENCY_MISMATCH',
          409,
        );
      }
      const item: EffectiveSalaryContract = {
        id: Number(row.id),
        startDate: String(row.start_date_text),
        endDate: row.end_date_text ? String(row.end_date_text) : null,
        baseSalary: Number(row.base_salary),
      };
      if (!contractHistory.has(employeeId)) contractHistory.set(employeeId, []);
      contractHistory.get(employeeId)!.push(item);
    }
    const packageRows = empIds.length
      ? await sql<Record<string, unknown>>`
          SELECT employee_id, id, allowance_amount, deduction_amount,
            to_char(effective_from, 'YYYY-MM-DD') AS start_date_text,
            to_char(effective_to, 'YYYY-MM-DD') AS end_date_text
          FROM hr_compensation_packages
          WHERE tenant_id = ${tenantId}
            AND employee_id IN (${sql.join(empIds)})
            AND (effective_from IS NULL OR effective_from <= ${range.to}::date)
            AND (effective_to IS NULL OR effective_to >= ${range.from}::date)
          ORDER BY employee_id, effective_from NULLS FIRST, id
        `.execute(db)
      : { rows: [] as Record<string, unknown>[] };
    const packageHistory = new Map<number, EffectiveCompensationPackage[]>();
    for (const row of packageRows.rows) {
      const employeeId = Number(row.employee_id);
      const item: EffectiveCompensationPackage = {
        id: Number(row.id),
        startDate: row.start_date_text ? String(row.start_date_text) : null,
        endDate: row.end_date_text ? String(row.end_date_text) : null,
        allowanceAmount: Number(row.allowance_amount),
        deductionAmount: Number(row.deduction_amount),
      };
      if (!packageHistory.has(employeeId)) packageHistory.set(employeeId, []);
      packageHistory.get(employeeId)!.push(item);
    }
    // A rebuilt draft/reviewed run must not retain a payable item for someone
    // who no longer qualifies (terminated and settled, deactivated, or excluded
    // by pay frequency). Preserve history/adjustments by excluding, not deleting.
    await sql`
      UPDATE hr_payroll_run_items i
      SET status = 'excluded',
          notes = CASE
            WHEN i.notes LIKE '%' || ${AUTO_PAYROLL_EXCLUSION_NOTE}::text || '%' THEN i.notes
            ELSE CONCAT_WS(' | ', NULLIF(i.notes, ''), ${AUTO_PAYROLL_EXCLUSION_NOTE}::text)
          END,
          updated_at = NOW()
      WHERE i.run_id = ${runId} AND i.tenant_id = ${tenantId}
        AND i.status IN ('draft', 'reviewed')
        AND ${empIds.length ? sql`i.employee_id NOT IN (${sql.join(empIds)})` : sql`TRUE`}
    `.execute(db);
    // The previous hourly formula credited 30 theoretical days, regardless of actual punches.
    // Read all punches for the run once, then share the exact same totals with payroll review.
    const hourlyWorkByEmployee = new Map<number, ReturnType<typeof summarizeHourlyAttendance>>();
    const punches = empIds.length
      ? await sql<Record<string, unknown>>`
      SELECT employee_id, status, check_in_at, check_out_at, prior_sessions_minutes,
        to_char(work_date, 'YYYY-MM-DD') AS work_date_text
      FROM hr_attendance_records
      WHERE tenant_id = ${tenantId}
        AND employee_id IN (${sql.join(empIds)})
        AND work_date >= ${range.from}::date
        AND work_date <= ${range.to}::date
    `.execute(db)
      : { rows: [] as Record<string, unknown>[] };
    const punchesByEmployee = new Map<number, Record<string, unknown>[]>();
    for (const punch of punches.rows) {
      const employeeId = Number(punch.employee_id);
      if (!punchesByEmployee.has(employeeId)) punchesByEmployee.set(employeeId, []);
      punchesByEmployee.get(employeeId)!.push(punch);
    }
    const baseSalMap = new Map<number, number>();
    const contractualMonthlySalary = new Map<number, number>();
    const compensationByEmployee = new Map<number, { allowance: number; deduction: number }>();
    const payRangeByEmployee = new Map<number, { from: string; to: string }>();
    for (const e of employees.rows) {
      const id = Number(e.employee_id);
      const hire = normalizeDateOnly(e.hire_date) || range.from;
      const employmentEnd = normalizeDateOnly(e.end_of_service_date) || range.to;
      const from = [range.from, hire].sort().at(-1)!;
      const to = [range.to, employmentEnd].sort()[0];
      payRangeByEmployee.set(id, { from, to });
      try {
        compensationByEmployee.set(
          id,
          calculateEffectiveCompensationPay(packageHistory.get(id) || [], from, to, bookDigits),
        );
      } catch (error) {
        throw new AppError(
          `البدلات والاستقطاعات الثابتة للموظف #${id} متداخلة أو غير صحيحة: ${error instanceof Error ? error.message : 'راجع الباقات'}`,
          'HR_PAYROLL_COMPENSATION_PERIOD_INVALID',
          409,
        );
      }
    }
    for (const e of employees.rows) {
      const employeeId = Number(e.employee_id);
      if (e.compensation_type === 'hourly') {
        const earned = payRangeByEmployee.get(employeeId)!;
        const eligiblePunches = (punchesByEmployee.get(employeeId) || []).filter(
          (punch) => String(punch.work_date_text) >= earned.from && String(punch.work_date_text) <= earned.to,
        );
        const work = summarizeHourlyAttendance(eligiblePunches, Number(e.hourly_rate || 0), bookDigits);
        hourlyWorkByEmployee.set(employeeId, work);
        baseSalMap.set(employeeId, work.baseWage);
      } else {
        const payRange = payRangeByEmployee.get(employeeId)!;
        try {
          const result = calculateEffectiveContractPay(
            contractHistory.get(employeeId) || [],
            payRange.from,
            payRange.to,
            bookDigits,
          );
          contractualMonthlySalary.set(employeeId, result.referenceMonthlySalary);
          baseSalMap.set(employeeId, result.baseWage);
        } catch (error) {
          throw new AppError(
            `عقود راتب الموظف #${employeeId} خلال الفترة غير مكتملة أو متداخلة: ${error instanceof Error ? error.message : 'راجع العقود'}`,
            'HR_PAYROLL_CONTRACT_PERIOD_INVALID',
            409,
          );
        }
      }
    }
    const autoReviews = await this.calculatePayrollOperationalReview(
      db,
      range,
      empIds,
      baseSalMap,
      tenantId,
      contractualMonthlySalary,
      contractHistory,
      bookDigits,
    );
    const policies = await this.getPayrollPolicies(db, tenantId);
    const maxDeductionPct = policies.maxDeductionPct !== undefined ? Number(policies.maxDeductionPct) : 1.0;

    for (const employee of employees.rows) {
      const employeeId = Number(employee.employee_id || 0);
      if (!(employeeId > 0)) continue;
      const existing = await sql<Record<string, unknown>>`
        SELECT id, status, notes
        FROM hr_payroll_run_items
        WHERE run_id = ${runId} AND employee_id = ${employeeId} AND tenant_id = ${tenantId}
        LIMIT 1
      `.execute(db);
      const existingItem = existing.rows[0];
      // INV-PAID-PAYROLL-ITEMS-NEVER-REBUILT: a paid item is final.
      // Rebuilding must never recompute its amounts or reset its
      // status — the paid state is guarded here, on the item
      // itself, not only by the run-status gates on rebuild's
      // callers. (Approved items were already skipped; paid items
      // were recomputed and reset to the rebuild target status,
      // which would resurrect them as payable.)
      if (clean(existingItem?.status) === 'approved' || clean(existingItem?.status) === 'paid') continue;
      const excluded = clean(existingItem?.status) === 'excluded';
      if (excluded && !canReincludeAutoExcludedPayrollItem(clean(existingItem?.status), clean(existingItem?.notes)))
        continue;
      const itemId = Number(existingItem?.id || 0);
      const adjustments =
        itemId > 0 ? await this.adjustmentTotals(db, itemId, tenantId, bookDigits) : { allowance: 0, deduction: 0 };
      const isHourly = clean(employee.compensation_type) === 'hourly';
      // The base wage was computed across ALL valid historical contract segments.
      // Never re-prorate using just the latest contract, which drops earned days
      // before a mid-month promotion/salary change.
      const baseSalary = isHourly
        ? hourlyWorkByEmployee.get(employeeId)?.baseWage || 0
        : Number(baseSalMap.get(employeeId) || 0);
      const payRange = payRangeByEmployee.get(employeeId)!;
      const fixedCompensation = compensationByEmployee.get(employeeId) || { allowance: 0, deduction: 0 };
      const compensationAllowance = fixedCompensation.allowance;
      const compensationDeduction = fixedCompensation.deduction;
      const loanDeduction = await this.calculateLoanDeduction(db, employeeId, range.to, tenantId, bookDigits);

      const empAdjustmentsResult = await sql<Record<string, unknown>>`
        SELECT id, adjustment_type, amount_type, amount, accounting_category, source_type, source_id,
          to_char(date, 'YYYY-MM-DD') AS adjustment_date
        FROM hr_employee_adjustments
        WHERE employee_id = ${employeeId} AND tenant_id = ${tenantId} AND status = 'pending' AND date <= ${range.to}
      `.execute(db);

      let empAdjAllowance = 0;
      let empAdjDeduction = 0;
      let empAdjAssetRecoveryDeduction = 0;
      const appliedAdjIds: number[] = [];
      const vanSettlementIds: number[] = [];

      for (const adj of empAdjustmentsResult.rows) {
        let val: number;
        try {
          val = calculateDatedPayrollAdjustment({
            minorUnits: bookDigits,
            amount: Number(adj.amount),
            amountType: clean(adj.amount_type) as 'money' | 'days' | 'hours',
            date: clean(adj.adjustment_date),
            period: payRange,
            contracts: contractHistory.get(employeeId) || [],
            isHourly,
            hourlyRate: Number(employee.hourly_rate || 0),
            expectedDailyHours: Number(employee.expected_daily_hours || 8),
          });
        } catch (error) {
          throw new AppError(
            `تسوية الموظف #${employeeId} بتاريخ ${clean(adj.adjustment_date)}: ${error instanceof Error ? error.message : 'راجع نوع التسوية'}`,
            'HR_PAYROLL_DATED_ADJUSTMENT_INVALID',
            409,
          );
        }

        if (clean(adj.adjustment_type) === 'allowance') {
          empAdjAllowance += val;
        } else if (clean(adj.adjustment_type) === 'deduction') {
          if (clean(adj.accounting_category) === 'asset_recovery') {
            empAdjAssetRecoveryDeduction += val;
          } else {
            empAdjDeduction += val;
          }
        }

        appliedAdjIds.push(Number(adj.id));
        if (clean(adj.source_type) === 'van_sales_settlement' && /^\d+$/.test(clean(adj.source_id))) {
          vanSettlementIds.push(Number(adj.source_id));
        }
      }

      if (appliedAdjIds.length > 0) {
        await sql`
          UPDATE hr_employee_adjustments
          SET status = 'applied', applied_in_run_id = ${runId}
          WHERE id IN (${sql.join(appliedAdjIds)})
            AND tenant_id = ${tenantId} AND employee_id = ${employeeId}
        `.execute(db);
        if (vanSettlementIds.length > 0) {
          // INV-REP-PAYROLL-TARGET-MONTH (M2, A10): the run that
          // actually applied a van-settlement deduction is written
          // back onto the settlement row, so a paid item traces to
          // its run. The push writes the targeted run; the rebuild
          // writes the run that applied it (they differ when the
          // targeted run never rebuilt the item and a later run
          // picked it up). Migration 0225 declares the column;
          // harnesses modelling the table without it skip the
          // write instead of failing the rebuild.
          const linkColumn = await sql<{ exists: boolean }>`
            SELECT EXISTS (
              SELECT 1 FROM information_schema.columns
              WHERE table_name = 'van_rep_financial_settlements'
                AND column_name = 'payroll_run_id'
            ) AS exists
          `.execute(db);
          if (linkColumn.rows[0]?.exists === true) {
            await sql`
              UPDATE van_rep_financial_settlements
              SET payroll_run_id = ${runId}, updated_at = NOW()
              WHERE id IN (${sql.join(vanSettlementIds)}) AND tenant_id = ${tenantId}
            `.execute(db);
          }
        }
      }

      const review = autoReviews.get(employeeId);
      // Hourly base already includes only minutes actually worked. Deducting missing
      // hours again would double-charge employees; 1.5x overtime becomes a 0.5x
      // premium because the normal 1.0x is already included in the hourly base.
      const attendanceDeduction = isHourly ? 0 : Number(review?.suggestedAttendanceDeductionAmount || 0);
      const leaveDeduction = isHourly ? 0 : Number(review?.suggestedLeaveDeductionAmount || 0);
      const overtimeAllowance = isHourly
        ? calculateHourlyOvertimePremium({
            minorUnits: bookDigits,
            calculatedHourlyRate: Number(employee.hourly_rate || 0),
            overtimeMinutes: Number(review?.approvedOvertimeMinutes || 0),
            overtimeMultiplier: Number(policies.overtimeMultiplier ?? 1.5),
          })
        : Number(review?.suggestedOvertimeAllowanceAmount || 0);
      const commissionAllowance = Number(review?.suggestedCommissionAllowanceAmount || 0);
      // The source of truth for statutory amounts is the COMPLETE payroll line:
      // contractual salary + prorated compensation + manual earnings + approved
      // overtime/commission, not the attendance review's incomplete preview.
      let lineOutput: ReturnType<typeof calculateHrPayrollRunLine>;
      try {
        lineOutput = calculateHrPayrollRunLine({
          minorUnits: bookDigits,
          policy: policies as unknown as HrStatutoryPolicy,
          period: range,
          eligibility: {
            insured: employee.has_social_insurance === true,
            taxable: employee.has_income_tax === true,
          },
          employmentMonthFraction: Math.min(1, payrollCalendarMonthFraction(payRange.from, payRange.to)),
          configuredInsuranceSalary:
            Number(employee.insurance_salary || 0) *
            (policies.insuranceProratePartialEmployment === true
              ? Math.min(1, payrollCalendarMonthFraction(payRange.from, payRange.to))
              : 1),
          line: {
            employeeId,
            baseSalary,
            allowanceAmount: roundMoney(compensationAllowance + adjustments.allowance + empAdjAllowance, bookDigits),
            overtimeAmount: overtimeAllowance,
            commissionAmount: commissionAllowance,
            attendanceDeduction,
            leaveDeduction,
            assetRecoveryDeduction: roundMoney(empAdjAssetRecoveryDeduction, bookDigits),
            otherDeductions: roundMoney(compensationDeduction + adjustments.deduction + empAdjDeduction, bookDigits),
            scheduledLoanDeduction: Number(loanDeduction.amount || 0),
            maxDeductionPct,
          },
        });
      } catch (error) {
        throw new AppError(
          `تعذر حساب مرتب الموظف #${employeeId}: ${error instanceof Error ? error.message : 'راجع سياسات المرتبات'}`,
          'HR_PAYROLL_LINE_CALCULATION_INVALID',
          409,
        );
      }

      const totalAllowance = roundMoney(
        lineOutput.allowanceAmount + lineOutput.overtimeAmount + lineOutput.commissionAmount,
        bookDigits,
      );
      const penaltyDeduction = roundMoney(lineOutput.attendanceDeduction + lineOutput.leaveDeduction, bookDigits);
      const operationalDeduction = roundMoney(
        lineOutput.totalDeductions - lineOutput.appliedLoanDeduction - lineOutput.assetRecoveryDeduction,
        bookDigits,
      );

      const generatedNotes = [
        baseSalary > 0
          ? ''
          : isHourly
            ? 'لم تُسجل ساعات حضور مكتملة في الفترة أو أجر الساعة غير محدد'
            : 'Missing salary data',
        isHourly && (hourlyWorkByEmployee.get(employeeId)?.incompleteCount || 0) > 0
          ? `هناك ${hourlyWorkByEmployee.get(employeeId)!.incompleteCount} يوم حضور بدون انصراف/حضور مكتمل، لم تُحسب أجرته`
          : '',
        isHourly && (hourlyWorkByEmployee.get(employeeId)?.invalidCount || 0) > 0
          ? `هناك ${hourlyWorkByEmployee.get(employeeId)!.invalidCount} حركة حضور غير صحيحة تحتاج تصحيحًا`
          : '',
        ...loanDeduction.notes,
        lineOutput.employeeSocialInsurance > 0 ? `حصة تأمين الموظف: ${lineOutput.employeeSocialInsurance}` : '',
        lineOutput.incomeTax > 0 ? `ضريبة الدخل: ${lineOutput.incomeTax}` : '',
        ...lineOutput.notes,
      ].filter(Boolean);
      const existingCleanNotes = clean(existingItem?.notes)
        .split('|')
        .map((s) => s.trim())
        .filter((s) => {
          if (!s) return false;
          if (lineOutput.deferredLoanDeduction === 0 && s.includes('تم تأجيل') && s.includes('قسط السلفة'))
            return false;
          if (excluded && s === AUTO_PAYROLL_EXCLUSION_NOTE) return false;
          return true;
        })
        .join(' | ');
      const notes = combineNotes(existingCleanNotes, ...generatedNotes);

      if (itemId > 0) {
        await sql`
          UPDATE hr_payroll_run_items
          SET contract_id = ${toId(employee.contract_id)},
              base_salary = ${lineOutput.baseSalary},
              allowance_amount = ${totalAllowance},
              deduction_amount = ${operationalDeduction},
              loan_deduction_amount = ${lineOutput.appliedLoanDeduction},
              asset_recovery_deduction_amount = ${lineOutput.assetRecoveryDeduction},
              employee_social_insurance = ${lineOutput.employeeSocialInsurance},
              employer_social_insurance = ${lineOutput.employerSocialInsurance},
              income_tax = ${lineOutput.incomeTax},
              penalty_deduction = ${penaltyDeduction},
              carried_forward_deduction = ${lineOutput.carriedForwardDeduction},
              gross_pay = ${lineOutput.grossPay},
              net_pay = ${lineOutput.netPay},
              status = ${itemStatus},
              notes = ${notes},
              updated_at = NOW()
          WHERE id = ${itemId} AND tenant_id = ${tenantId} AND run_id = ${runId}
        `.execute(db);
      } else {
        await sql`
          INSERT INTO hr_payroll_run_items (
            run_id, employee_id, contract_id, base_salary, allowance_amount, deduction_amount,
            loan_deduction_amount, asset_recovery_deduction_amount,
            employee_social_insurance, employer_social_insurance, income_tax,
            penalty_deduction, carried_forward_deduction,
            gross_pay, net_pay, status, notes, tenant_id, account_id
          )
          VALUES (
            ${runId}, ${employeeId}, ${toId(employee.contract_id)}, ${lineOutput.baseSalary},
            ${totalAllowance}, ${operationalDeduction},
            ${lineOutput.appliedLoanDeduction}, ${lineOutput.assetRecoveryDeduction},
            ${lineOutput.employeeSocialInsurance}, ${lineOutput.employerSocialInsurance},
            ${lineOutput.incomeTax}, ${penaltyDeduction}, ${lineOutput.carriedForwardDeduction},
            ${lineOutput.grossPay}, ${lineOutput.netPay}, ${itemStatus}, ${notes}, ${tenantId}, ${accountId}
          )
        `.execute(db);
      }
    }
    await sql`UPDATE hr_payroll_runs SET updated_at = NOW() WHERE id = ${runId} AND tenant_id = ${tenantId}`.execute(
      db,
    );
  }
}
