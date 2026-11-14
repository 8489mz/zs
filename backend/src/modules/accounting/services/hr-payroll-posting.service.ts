/*
 * HR payroll + end-of-service posting (split-5 out of AccountingPostingService).
 * Pure move: the 6 payroll/loan/EOS posting methods, unchanged, behind the
 * AccountingPostingService delegating facade. The facade owns the shared
 * journal helpers; this service receives them bound via
 * HrPayrollPostingDeps, so the moved bodies are byte-identical to the
 * originals.
 */
import { sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { AppError } from '../../../common/errors/app-error';
import { allocatePayrollAccrual } from '../../hr/engines/payroll-accrual-allocation.engine';
import { calculateSettlementAbsorption } from '../../hr/engines/eos-calculation.engine';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../accounting-posting.service';

export type HrPayrollPostingDeps = {
  foundation: AccountingTenantFoundationService;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
  addLine: (lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3) => void;
  insertPostedJournal: (
    queryable: any,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date;
      description: string;
      branchId: number | null;
      locationId: number | null;
      createdBy: number | null;
      postedBy: number | null;
      cashFlowCategory?: 'operating' | 'investing' | 'financing' | null;
      lines: JournalLineDraft[];
      reversalOfEntryId?: number | null;
    },
  ) => Promise<number>;
  resolveSystemAccountByCode: (queryable: DbOrTx, tenantId: string, code: string) => Promise<number>;
};

export class HrPayrollPostingService {
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly toMoney: HrPayrollPostingDeps['toMoney'];
  private readonly addLine: HrPayrollPostingDeps['addLine'];
  private readonly insertPostedJournal: HrPayrollPostingDeps['insertPostedJournal'];
  private readonly resolveSystemAccountByCode: HrPayrollPostingDeps['resolveSystemAccountByCode'];

  constructor(deps: HrPayrollPostingDeps) {
    this.accountingTenantFoundation = deps.foundation;
    this.toMoney = deps.toMoney;
    this.addLine = deps.addLine;
    this.insertPostedJournal = deps.insertPostedJournal;
    this.resolveSystemAccountByCode = deps.resolveSystemAccountByCode;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.accountingTenantFoundation.ensureForAuth(queryable, auth);
  }

  async postPayrollAccrual(queryable: DbOrTx, runId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'hr_payroll_accrual')
      .where('source_id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    // INV-PAYROLL-ACCRUAL-PERIOD-END-DATE: the accrual belongs to
    // the wage period the work was performed in, so the journal is
    // dated at the run's period end — never at the approval date.
    // A missing or unreadable period end fails closed instead of
    // inventing a date (the manufacturing-date precedent). The
    // period-lock check in insertPostedJournal then rejects an
    // approval whose period is already closed, as it must.
    const runRow = await queryable
      .selectFrom('hr_payroll_runs')
      .select('end_date')
      .where('id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const accrualDate = runRow?.end_date ? new Date(runRow.end_date as unknown as string) : null;
    if (!accrualDate || Number.isNaN(accrualDate.getTime())) {
      throw new AppError('تاريخ نهاية فترة المسير غير موجود، لا يمكن ترحيل قيد الاستحقاق', 'HR_PAYROLL_ACCRUAL_PERIOD_END_MISSING', 409);
    }

    // Aggregate totals alone can hide offsetting corrupt payslips. Reject any
    // individual employee whose persisted wages/deductions do not reconcile.
    const invalidLine = await sql<{ employee_id: number }>`
      SELECT employee_id FROM hr_payroll_run_items
      WHERE run_id = ${runId} AND tenant_id = ${scope.tenantId}
        AND status = 'reviewed'
        AND (
          gross_pay <> net_pay + COALESCE(deduction_amount, 0)
            + COALESCE(loan_deduction_amount, 0)
            + COALESCE(asset_recovery_deduction_amount, 0)
          OR deduction_amount < COALESCE(employee_social_insurance, 0) + COALESCE(income_tax, 0)
          OR net_pay < 0 OR gross_pay < 0 OR deduction_amount < 0
          OR loan_deduction_amount < 0 OR asset_recovery_deduction_amount < 0
        )
      LIMIT 1
    `.execute(queryable);
    if (invalidLine.rows.length) {
      throw new AppError(
        `Payroll employee #${invalidLine.rows[0].employee_id} has an unreconciled payslip`,
        'HR_PAYROLL_LINE_ACCOUNTING_MISMATCH', 409,
      );
    }

    const totals = await queryable
      .selectFrom('hr_payroll_run_items')
      .select([
        sql<number>`COALESCE(SUM(gross_pay), 0)`.as('gross_pay'),
        sql<number>`COALESCE(SUM(net_pay), 0)`.as('net_pay'),
        sql<number>`COALESCE(SUM(loan_deduction_amount), 0)`.as('loan_deductions'),
        sql<number>`COALESCE(SUM(asset_recovery_deduction_amount), 0)`.as('asset_recovery_deductions'),
        sql<number>`COALESCE(SUM(deduction_amount), 0)`.as('operational_deductions'),
        sql<number>`COALESCE(SUM(employee_social_insurance), 0)`.as('employee_social_insurance'),
        sql<number>`COALESCE(SUM(employer_social_insurance), 0)`.as('employer_social_insurance'),
        sql<number>`COALESCE(SUM(income_tax), 0)`.as('income_tax'),
      ])
      .where('run_id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '!=', 'excluded')
      .executeTakeFirst();

    const grossPay = toBookMoney(totals?.gross_pay || 0);
    const netPay = toBookMoney(totals?.net_pay || 0);
    const loanDeductions = toBookMoney(totals?.loan_deductions || 0);
    const assetRecoveryDeductions = toBookMoney(totals?.asset_recovery_deductions || 0);
    const operationalDeductions = toBookMoney(totals?.operational_deductions || 0);
    const employeeInsurance = toBookMoney(totals?.employee_social_insurance || 0);
    const employerInsurance = toBookMoney(totals?.employer_social_insurance || 0);
    const incomeTax = toBookMoney(totals?.income_tax || 0);

    if (grossPay <= 0 && netPay <= 0 && loanDeductions <= 0 && assetRecoveryDeductions <= 0) {
      throw new AppError('Cannot accrue payroll with zero financial value', 'HR_PAYROLL_ZERO_VALUE', 400);
    }
    let allocation: ReturnType<typeof allocatePayrollAccrual>;
    try {
      allocation = allocatePayrollAccrual({
        grossPay, netPay, loanDeductions, assetRecoveryDeductions, operationalDeductions,
        employeeInsurance, employerInsurance, incomeTax,
      }, bookDigits);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Payroll totals cannot be reconciled',
        'HR_PAYROLL_ACCOUNTING_MISMATCH', 400,
      );
    }

    const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6200'); // Salaries and Wages
    const payableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2140'); // Payroll Payable
    const advancesAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160'); // Employee Advances
    const recoveryAccountId = assetRecoveryDeductions > 0
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100')
      : null; // Recovery of lost/damaged custody assets, NOT absenteeism income.

    const totalGosiPayable = toBookMoney(employeeInsurance + employerInsurance);

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    // 1. Debit: actual salary expense after attendance/leave/other wage reductions.
    // Attendance deductions are NOT unrelated operating revenue.
    addBookLine({
      accountId: expenseAccountId,
      description: `استحقاق رواتب مسير #${runId} (خصومات الأجور ${allocation.wageReduction})`,
      debit: allocation.salaryExpense,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    // 2. Debit: Employer Social Insurance Contribution (if any)
    if (employerInsurance > 0) {
      const employerGosiAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6210');
      addBookLine({
        accountId: employerGosiAccountId,
        description: `حصة المنشأة في التأمينات الاجتماعية لمسير #${runId}`,
        debit: employerInsurance,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 3. Credit: Net Payroll Payable
    if (netPay > 0) {
      addBookLine({
        accountId: payableAccountId,
        description: `رواتب مستحقة الدفع لمسير #${runId}`,
        debit: 0,
        credit: netPay,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 4. Credit: Social Insurance Authority Payable (Employee + Employer shares)
    if (totalGosiPayable > 0) {
      const gosiPayableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2145');
      addBookLine({
        accountId: gosiPayableAccountId,
        description: `تأمينات اجتماعية مستحقة السداد (حصة الموظف + المنشأة) لمسير #${runId}`,
        debit: 0,
        credit: totalGosiPayable,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 5. Credit: Income Tax Withholding Payable
    if (incomeTax > 0) {
      const taxPayableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2146');
      addBookLine({
        accountId: taxPayableAccountId,
        description: `ضريبة كسب عمل مستحقة لمسير #${runId}`,
        debit: 0,
        credit: incomeTax,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 6. Credit: Employee Advances (Loan installments)
    if (loanDeductions > 0) {
      addBookLine({
        accountId: advancesAccountId,
        description: `استقطاع سلف موظفين لمسير #${runId}`,
        debit: 0,
        credit: loanDeductions,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 7. Credit: asset loss/custody recovery only; the wage reductions are
    // already reflected in the debit to the salary expense account above.
    if (assetRecoveryDeductions > 0 && recoveryAccountId) {
      addBookLine({
        accountId: recoveryAccountId,
        description: `تحصيل تعويضات عهد مفقودة / تالفة من الرواتب - مسير #${runId}`,
        debit: 0,
        credit: allocation.assetRecoveryCredit,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_payroll_accrual',
        sourceId: runId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: accrualDate,
        description: `قيد استحقاق رواتب - مسير #${runId}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_payroll_round2a_uniq')) {
         const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_payroll_accrual').where('source_id', '=', runId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postPayrollPayment(queryable: DbOrTx, runId: number, paymentChannel: string, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'hr_payroll_payment')
      .where('source_id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const totals = await queryable
      .selectFrom('hr_payroll_run_items')
      .select([
        sql<number>`COALESCE(SUM(net_pay), 0)`.as('net_pay'),
      ])
      .where('run_id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'approved')
      .executeTakeFirst();

    const netPay = toBookMoney(totals?.net_pay || 0);

    if (netPay <= 0) {
       throw new AppError('Cannot pay payroll with zero net pay', 'HR_PAYROLL_PAYMENT_ZERO', 400);
    }

    const payableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2140'); // Payroll Payable
    // INV-PAYROLL-PAYMENT-CHANNEL-ACCOUNTS: the channel-to-account
    // map must match postPayrollItemPayment exactly — 'bank' pays
    // from 1120, every other channel ('cash', 'drawer') from cash
    // 1110. The old map sent 'drawer' to the bank although
    // payPayrollRun takes the money out of the cashier drawer, so
    // the journal credited a bank account that never paid.
    const paymentAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, paymentChannel === 'bank' ? '1120' : '1110');

    const lines: JournalLineDraft[] = [];

    addBookLine({ accountId: payableAccountId, description: `سداد رواتب مستحقة لمسير #${runId}`, debit: netPay, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null });
    addBookLine({ accountId: paymentAccountId, description: `دفع رواتب مسير #${runId}`, debit: 0, credit: netPay, partnerType: 'none', partnerId: null, branchId: null, locationId: null });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_payroll_payment',
        sourceId: runId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        // Payment journals stay dated at the payment date: cash
        // leaves on the day of payment, never at the period end.
        entryDate: new Date(),
        description: `قيد سداد رواتب - مسير #${runId}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_payroll_round2a_uniq')) {
         const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_payroll_payment').where('source_id', '=', runId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postPayrollItemPayment(
    queryable: DbOrTx,
    itemId: number,
    paymentChannel: string,
    auth: AuthContext,
    options?: { branchId?: number | null; locationId?: number | null; employeeName?: string }
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'hr_payroll_item_payment')
      .where('source_id', '=', itemId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const item = await queryable
      .selectFrom('hr_payroll_run_items')
      .select(['id', 'run_id', 'employee_id', 'net_pay', 'status'])
      .where('id', '=', itemId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!item) throw new AppError('بند الراتب غير موجود', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
    const netPay = toBookMoney(item.net_pay || 0);
    if (netPay <= 0) throw new AppError('صافي الأجر صفر أو سالب', 'HR_PAYROLL_PAYMENT_ZERO', 400);

    const payableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2140'); // Payroll Payable
    // INV-PAYROLL-PAYMENT-CHANNEL-ACCOUNTS: keep in sync with
    // postPayrollPayment — 'bank' pays from 1120, all other
    // channels ('cash', 'drawer') from cash 1110.
    const paymentAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, paymentChannel === 'bank' ? '1120' : '1110');

    const empLabel = options?.employeeName ? ` - ${options.employeeName}` : '';
    const lines: JournalLineDraft[] = [];
    addBookLine({
      accountId: payableAccountId,
      description: `سداد مستحقات أجر الموظف #${item.employee_id}${empLabel} (مسير #${item.run_id})`,
      debit: netPay,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: options?.branchId ?? null,
      locationId: options?.locationId ?? null,
    });
    addBookLine({
      accountId: paymentAccountId,
      description: `صرف أجر الموظف #${item.employee_id}${empLabel} عبر ${paymentChannel === 'drawer' ? 'درج الكاشير' : paymentChannel === 'bank' ? 'البنك' : 'الخزينة'}`,
      debit: 0,
      credit: netPay,
      partnerType: 'none',
      partnerId: null,
      branchId: options?.branchId ?? null,
      locationId: options?.locationId ?? null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_payroll_item_payment',
        sourceId: itemId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        // Same as the run payment: dated at the payment date.
        entryDate: new Date(),
        description: `قيد صرف أجر موظف #${item.employee_id}${empLabel} - مسير #${item.run_id}`,
        branchId: options?.branchId ?? null,
        locationId: options?.locationId ?? null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505') {
        const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_payroll_item_payment').where('source_id', '=', itemId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postEmployeeLoanDisbursement(queryable: DbOrTx, loanId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const tenantId = scope.tenantId;

    const existing = await queryable
        .selectFrom('journal_entries')
        .select(['id', 'status'])
        .where('source_type', '=', 'hr_employee_loan_disbursement')
        .where('source_id', '=', loanId)
        .where('tenant_id', '=', tenantId)
        .where('status', 'in', ['draft', 'posted'])
        .orderBy('id', 'desc')
        .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const loanResult = await queryable
      .selectFrom('hr_employee_loans')
      .selectAll()
      .where('id', '=', loanId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!loanResult) throw new AppError('Loan not found', 'NOT_FOUND', 404);
    if (loanResult.status !== 'paid') {
      throw new AppError('Loan must be disbursed to post accounting entry', 'HR_LOAN_NOT_DISBURSED', 400);
    }

    const amount = toBookMoney(loanResult.principal_amount);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const cashAcct = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', '1110')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!cashAcct) throw new AppError('Cash account 1110 not found', 'ACCOUNT_NOT_FOUND', 400);

    const advanceAcct = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', '1160')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!advanceAcct) throw new AppError('Employee Advances account 1160 not found', 'ACCOUNT_NOT_FOUND', 400);

    const lines: JournalLineDraft[] = [
      {
        accountId: advanceAcct.id,
        debit: amount,
        credit: 0,
        description: 'Employee Loan Disbursement #' + loanResult.id,
        partnerType: 'none',
        partnerId: null,
        branchId: loanResult.branch_id || null,
        locationId: loanResult.location_id || null,
      },
      {
        accountId: cashAcct.id,
        debit: 0,
        credit: amount,
        description: 'Cash Out - Loan Disbursement #' + loanResult.id,
        partnerType: 'none',
        partnerId: null,
        branchId: loanResult.branch_id || null,
        locationId: loanResult.location_id || null,
      },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_employee_loan_disbursement',
        sourceId: loanResult.id,
        tenantId,
        accountId: scope.accountId,
        entryDate: loanResult.disbursed_at || new Date(),
        description: 'Employee Loan Disbursement #' + loanResult.id,
        branchId: loanResult.branch_id || null,
        locationId: loanResult.location_id || null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_employee_loan_disb_uniq')) {
          const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_employee_loan_disbursement').where('source_id', '=', loanId).where('tenant_id', '=', tenantId).executeTakeFirst();
          return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postEmployeeLoanManualRepayment(queryable: DbOrTx, ledgerId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const tenantId = scope.tenantId;

    const existing = await queryable
        .selectFrom('journal_entries')
        .select(['id', 'status'])
        .where('source_type', '=', 'hr_employee_loan_repayment')
        .where('source_id', '=', ledgerId)
        .where('tenant_id', '=', tenantId)
        .where('status', 'in', ['draft', 'posted'])
        .orderBy('id', 'desc')
        .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const ledger = await queryable
      .selectFrom('hr_employee_ledger')
      .selectAll()
      .where('id', '=', ledgerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!ledger) throw new AppError('Ledger entry not found', 'NOT_FOUND', 404);
    if (ledger.entry_type !== 'loan_repayment' || ledger.repayment_method !== 'manual_cash') {
      throw new AppError('Invalid ledger entry for manual repayment posting', 'HR_LOAN_INVALID_REPAYMENT_LEDGER', 400);
    }

    const amount = Math.abs(toBookMoney(ledger.amount));
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const cashAcct = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', '1110')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!cashAcct) throw new AppError('Cash account 1110 not found', 'ACCOUNT_NOT_FOUND', 400);

    const advanceAcct = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', '1160')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!advanceAcct) throw new AppError('Employee Advances account 1160 not found', 'ACCOUNT_NOT_FOUND', 400);

    const lines: JournalLineDraft[] = [
      {
        accountId: cashAcct.id,
        debit: amount,
        credit: 0,
        description: 'Cash In - Loan Repayment #' + ledger.reference_id,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      },
      {
        accountId: advanceAcct.id,
        debit: 0,
        credit: amount,
        description: 'Employee Loan Repayment #' + ledger.reference_id,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_employee_loan_repayment',
        sourceId: ledger.id,
        tenantId,
        accountId: scope.accountId,
        entryDate: ledger.created_at || new Date(),
        description: 'Employee Loan Manual Repayment #' + ledger.reference_id,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_employee_loan_repay_uniq')) {
          const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_employee_loan_repayment').where('source_id', '=', ledgerId).where('tenant_id', '=', tenantId).executeTakeFirst();
          return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postEndOfServiceSettlement(queryable: DbOrTx, settlementId: number, treasuryAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const settlement = await queryable
      .selectFrom('hr_end_of_service_settlements')
      .selectAll()
      .where('id', '=', settlementId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!settlement) {
      throw new AppError('End of service settlement not found', 'HR_EOS_NOT_FOUND', 404);
    }

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'hr_end_of_service_settlement')
      .where('source_id', '=', settlementId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const gratuity = toBookMoney(settlement.gratuity_amount || 0);
    const leavePay = toBookMoney(settlement.leave_encashment_amount || 0);
    const pendingSalary = toBookMoney(settlement.pending_salary_amount || 0);
    const noticePeriod = toBookMoney(settlement.notice_period_amount || 0);
    const otherEntitlements = toBookMoney(settlement.other_entitlements_amount || 0);
    const unpaidLoans = toBookMoney(settlement.unpaid_loans_deduction || 0);
    const assetsDeduction = toBookMoney(settlement.assets_deduction || 0);
    const otherDeductions = toBookMoney(settlement.other_deductions || 0);

    // Absorption invariant: deductions cannot exceed total entitlements
    // in the settlement payout. The order (assets, other, loans) and
    // the pool math live in ONE place — the EOS engine that priced
    // the settlement — so the posting can never drift from it. Any
    // excess remains an uncollected employee debt.
    let absorption: ReturnType<typeof calculateSettlementAbsorption>;
    try {
      absorption = calculateSettlementAbsorption({
        gratuityAmount: gratuity,
        leaveEncashmentAmount: leavePay,
        pendingSalaryAmount: pendingSalary,
        noticePeriodAmount: noticePeriod,
        otherEntitlementsAmount: otherEntitlements,
        unpaidLoansDeduction: unpaidLoans,
        assetsDeduction,
        otherDeductions,
        minorUnits: bookDigits,
      });
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'End of service settlement amounts are invalid',
        'HR_EOS_SETTLEMENT_AMOUNTS_INVALID',
        400,
      );
    }
    const totalEntitlements = absorption.totalEntitlements;
    const appliedAssets = absorption.appliedAssets;
    const appliedOther = absorption.appliedOther;
    const appliedLoans = absorption.appliedLoans;
    const netPayable = absorption.netPayable;

    if (totalEntitlements <= 0) {
      throw new AppError('Cannot post end of service settlement with zero entitlements', 'HR_EOS_ZERO_VALUE', 400);
    }

    const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6200'); // Salaries & EOS Expense
    const advancesAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160'); // Employee Advances
    const otherIncomeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100'); // Other Income / Custody Recovery
    // D1 (INV-EOS-SETTLEMENT-PAYABLE-FIRST): the settlement journal credits
    // the payroll payable (2140) for the net payable. It never credits cash
    // or a treasury account: cash moves only on a separate, evidenced payout
    // step. The treasuryAccountId argument is accepted for that future payout
    // step and is deliberately not used by this journal.
    const payableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2140'); // Payroll Payable

    const lines: JournalLineDraft[] = [];

    // 1. Debit: Total Entitlements
    addBookLine({
      accountId: expenseAccountId,
      description: `استحقاق مخالصة ومكافأة نهاية خدمة #${settlement.settlement_no}`,
      debit: totalEntitlements,
      credit: 0,
      partnerType: 'employee',
      partnerId: Number(settlement.employee_id),
      branchId: null,
      locationId: null,
    });

    // 2. Credit: Loan deduction (if any)
    if (appliedLoans > 0) {
      addBookLine({
        accountId: advancesAccountId,
        description: `تسوية سلف مستحقة للموظف بمخالصة #${settlement.settlement_no}`,
        debit: 0,
        credit: appliedLoans,
        partnerType: 'employee',
        partnerId: Number(settlement.employee_id),
        branchId: null,
        locationId: null,
      });
    }

    // 3. Credit: Asset / Custody deduction (if any)
    if (appliedAssets > 0) {
      addBookLine({
        accountId: otherIncomeAccountId,
        description: `استرداد وتسوية عهدة بمخالصة #${settlement.settlement_no}`,
        debit: 0,
        credit: appliedAssets,
        partnerType: 'employee',
        partnerId: Number(settlement.employee_id),
        branchId: null,
        locationId: null,
      });
    }

    // 4. Credit: Other deductions (if any)
    if (appliedOther > 0) {
      addBookLine({
        accountId: otherIncomeAccountId,
        description: `استقطاعات أخرى بمخالصة #${settlement.settlement_no}`,
        debit: 0,
        credit: appliedOther,
        partnerType: 'employee',
        partnerId: Number(settlement.employee_id),
        branchId: null,
        locationId: null,
      });
    }

    // 5. Credit: Net settlement payable (2140) — payable first, never cash
    if (netPayable > 0) {
      addBookLine({
        accountId: payableAccountId,
        description: `مستحقات مخالصة نهاية خدمة مستحقة الدفع #${settlement.settlement_no}`,
        debit: 0,
        credit: netPayable,
        partnerType: 'employee',
        partnerId: Number(settlement.employee_id),
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_end_of_service_settlement',
        sourceId: settlementId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: settlement.settlement_date ? new Date(settlement.settlement_date) : new Date(),
        description: `قيد تصفية ومخالصة نهاية خدمة #${settlement.settlement_no}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_hr_eos_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existingId = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'hr_end_of_service_settlement')
          .where('source_id', '=', settlementId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }
}
