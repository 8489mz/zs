import { allocateInstallmentInterest } from '../../engines/installment-interest.engine';
import { sql } from '../../../../database/kysely';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { lockAccountingPeriod } from '../../accounting-period-lock';
import { tenantBaseCurrency } from '../../accounting-currency';
import { resolveBusinessDateKey } from '../../engines/accounting-date.engine';
import { formatLocalCalendarDay } from '../../../../common/utils/tenant-timezone.util';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting.types';

export type InstallmentInterestBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: InventoryManufacturingCashPostingDeps['toMoney'];
  addLine: InventoryManufacturingCashPostingDeps['addLine'];
  getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];
  insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
  postDomainJournal: InventoryManufacturingCashPostingDeps['postDomainJournal'];
};

export class InstallmentInterestSlice {
  private readonly bound: InstallmentInterestBoundDeps;

  constructor(bound: InstallmentInterestBoundDeps) {
    this.bound = bound;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    return this.bound.addLine(lines, next, digits);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private insertPostedJournal(
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
  ): Promise<number> {
    return this.bound.insertPostedJournal(queryable, params);
  }

  private postDomainJournal(queryable: DbOrTx, params: any): Promise<number> {
    return this.bound.postDomainJournal(queryable, params);
  }

  /**
   * Customer installment plan finance interest double-entry posting
   */
  async postCustomerInstallmentInterest(
    queryable: DbOrTx,
    planId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    const plan = await queryable
      .selectFrom('customer_installment_plans')
      .selectAll()
      .where('id', '=', planId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!plan) return { posted: false, journalEntryId: null };
    const interest = toBookMoney(plan.interest_amount);
    if (interest <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let arAccountId = Number(settings?.customer_receivable_account_id || 0);
    if (!(arAccountId > 0)) arAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    const financeIncomeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2155');

    const lines: JournalLineDraft[] = [];
    addBookLine({
      accountId: arAccountId,
      description: `فوائد تقسيط - خطة تقسيط #${plan.plan_number}`,
      debit: interest,
      credit: 0,
      partnerType: plan.customer_id ? 'customer' : 'none',
      partnerId: plan.customer_id ? Number(plan.customer_id) : null,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
    });
    addBookLine({
      accountId: financeIncomeId,
      description: `فوائد تمويل غير مكتسبة - خطة تقسيط #${plan.plan_number}`,
      debit: 0,
      credit: interest,
      partnerType: 'none',
      partnerId: null,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
    });

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'customer_installment_interest',
      sourceId: planId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: plan.created_at ? new Date(plan.created_at) : new Date(),
      description: `قيد فوائد تمويل خطة تقسيط #${plan.plan_number}`,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
      createdBy: plan.created_by ? Number(plan.created_by) : auth.userId,
      postedBy: auth.userId,
      lines,
    });
    const installments = await queryable
      .selectFrom('customer_installments')
      .select(['id', 'amount', 'due_date'])
      .where('tenant_id', '=', scope.tenantId)
      .where('plan_id', '=', planId)
      .orderBy('installment_number')
      .execute();
    const allocations = allocateInstallmentInterest(
      Number(plan.financed_amount),
      installments.map((item) => Number(item.amount)),
      interest,
      bookDigits,
    );
    // The plan-creation floor is the tenant-local business day of the creation
    // instant, not its UTC day.
    const createdDay = await resolveBusinessDateKey(queryable, scope.tenantId, new Date(plan.created_at));
    for (const [index, item] of installments.entries()) {
      const amount = allocations[index];
      if (!amount) continue;
      // due_date is a STORED pg DATE (node-postgres local-midnight
      // Date): it keys from the host-local calendar parts, never
      // from the UTC slice -- the old slice recognised the interest
      // one day early on any host east of UTC, and the floor below
      // compares against the tenant-resolved createdDay.
      const dueDay =
        item.due_date instanceof Date ? formatLocalCalendarDay(item.due_date) : String(item.due_date).slice(0, 10);
      const recognitionDay = dueDay < createdDay ? createdDay : dueDay;
      await sql`insert into accounting_installment_interest (tenant_id, plan_id, installment_id, recognition_date, amount, account_id)
        values (${scope.tenantId}, ${planId}, ${item.id}, ${recognitionDay}, ${amount}, ${scope.accountId})
        on conflict (tenant_id, installment_id) do nothing`.execute(queryable);
    }
    return { posted: true, journalEntryId: entryId };
  }

  /** Daily and closing callers share one locked accrual path; no historical plan is guessed. */
  async recognizeInstallmentInterest(
    queryable: DbOrTx,
    tenantId: string,
    throughDate: string,
    createdBy: number | null = null,
  ): Promise<void> {
    if (!queryable.isTransaction)
      return queryable
        .transaction()
        .execute((trx) => this.recognizeInstallmentInterest(trx, tenantId, throughDate, createdBy));
    await lockAccountingPeriod(queryable, tenantId);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const pending = await sql<{
      id: number;
      amount: number;
      recognition_date: string | Date;
      account_id: string;
      branch_id: number | null;
    }>`
      select i.id, i.amount, i.recognition_date, i.account_id, p.branch_id from accounting_installment_interest i
      join customer_installment_plans p on p.id = i.plan_id and p.tenant_id = i.tenant_id
      where i.tenant_id = ${tenantId} and i.journal_entry_id is null and i.recognition_date <= ${throughDate}::date
      order by i.recognition_date, i.id for update of i
    `.execute(queryable);
    if (!pending.rows.length) return;
    const deferred = await this.resolveSystemAccountByCode(queryable, tenantId, '2155');
    const revenue = await this.resolveSystemAccountByCode(queryable, tenantId, '7100');
    for (const item of pending.rows) {
      const amount = toBookMoney(item.amount);
      const entryId = await this.postDomainJournal(queryable, {
        tenantId,
        accountId: item.account_id || tenantId,
        sourceType: 'installment_interest_accrual',
        sourceId: Number(item.id),
        entryDate: new Date(item.recognition_date),
        branchId: item.branch_id,
        description: 'استحقاق إيراد فوائد التمويل وفق العائد الفعلي',
        createdBy,
        lines: [
          {
            accountId: deferred,
            description: 'تحرير فوائد التمويل المكتسبة',
            debit: amount,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: item.branch_id,
          },
          {
            accountId: revenue,
            description: 'إيراد تمويل مكتسب',
            debit: 0,
            credit: amount,
            partnerType: 'none',
            partnerId: null,
            branchId: item.branch_id,
          },
        ],
      });
      await sql`update accounting_installment_interest set journal_entry_id = ${entryId}
        where tenant_id = ${tenantId} and id = ${item.id}`.execute(queryable);
    }
  }
}
