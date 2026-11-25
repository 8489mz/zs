import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting.types';

export type PostVanDamagedSwapBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: VanAndDeliveryPostingDeps['toMoney'];
  getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  addLine: VanAndDeliveryPostingDeps['addLine'];
  insertPostedJournal: VanAndDeliveryPostingDeps['insertPostedJournal'];
};

export class PostVanDamagedSwapSlice {
  constructor(private readonly bound: PostVanDamagedSwapBoundDeps) {}

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    return this.bound.addLine(lines, next, digits);
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

  /**
   * INV-VAN-DAMAGED-SWAP-JOURNAL-QUARANTINE: the ONE balanced journal
   * for a field damaged-goods swap, posted in the same transaction as
   * the stock moves by executeDamagedSwap. A swap is not a plain
   * damage write-off (postDamagedStock covers only Dr 5300 / Cr 1140
   * for the damaged item) — the replacement also leaves the van and
   * the price difference moves the customer's balance — so the legs
   * are, all at tenant book digits:
   *   Dr 5300 damagedCost — the damaged item is written off at cost
   *     (it sits quarantined in the damaged location at zero GL value).
   *   Dr 5100 replacementCost — cost of the replacement given out.
   *   Cr 1140 damagedCost + replacementCost — inventory out of the van
   *     (replacement) and out of the damaged location (write-off).
   *   priceDiff > 0 with a customer: Dr 1130 / Cr 4100 — the customer
   *     owes the extra value; priceDiff < 0: Dr 4100 / Cr 1130 — the
   *     customer is owed it. The 1130 leg is the GL mirror of the
   *     customer_ledger 'swap_price_adjustment' row, so subledger and
   *     GL agree. With no customer there is no receivable and no
   *     revenue leg: the cost legs already carry the economics and the
   *     retail-value difference has no money movement to record.
   * Idempotent: source ('van_damaged_swap', swapId) is unique per
   * swap — the pre-insert SELECT plus the extended
   * idx_journal_entries_van_sales_uniq (migration 0315) mean a
   * retried swap can never double-post, even if the caller retries
   * the whole swap. Zero-amount legs are skipped individually so a
   * free replacement or a zero-cost damaged item still posts the
   * remaining legs; all-zero posts nothing.
   */
  async postVanDamagedSwap(
    queryable: DbOrTx,
    swapId: number,
    params: {
      damagedQty: number;
      damagedUnitCost: number;
      replacementQty: number;
      replacementUnitCost: number;
      priceDifference: number;
      customerId?: number | null;
      branchId: number | null;
      locationId: number | null;
      damagedLocationId: number | null;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_damaged_swap')
      .where('source_id', '=', swapId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id), hasFinancialImpact: true };

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const damagedCost = this.toMoney(Number(params.damagedQty || 0) * Number(params.damagedUnitCost || 0), moneyDigits);
    const replacementCost = this.toMoney(
      Number(params.replacementQty || 0) * Number(params.replacementUnitCost || 0),
      moneyDigits,
    );
    const priceDiff = this.toMoney(params.priceDifference, moneyDigits);
    const customerId = params.customerId != null ? Number(params.customerId) : null;
    if (damagedCost <= 0 && replacementCost <= 0 && !(priceDiff !== 0 && customerId != null)) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
    }
    let cogsAccountId = Number(settings?.cogs_account_id || 0);
    if (!(cogsAccountId > 0)) {
      cogsAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5100');
    }
    let revenueAccountId = Number(settings?.sales_revenue_account_id || 0);
    if (!(revenueAccountId > 0)) {
      revenueAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '4100');
    }
    let receivableAccountId = Number(settings?.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0)) {
      receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    }
    const damagedExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    const branchId = params.branchId;
    const vanLocationId = params.locationId;
    const damagedLocationId = params.damagedLocationId;
    const lines: JournalLineDraft[] = [];
    if (damagedCost > 0) {
      this.addLine(
        lines,
        {
          accountId: damagedExpenseAccountId,
          description: `مصروف بضاعة تالفة - استبدال ميداني #${swapId}`,
          debit: damagedCost,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: damagedLocationId,
        },
        moneyDigits,
      );
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: `نقص مخزون بسبب تلف - استبدال ميداني #${swapId}`,
          debit: 0,
          credit: damagedCost,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: damagedLocationId,
        },
        moneyDigits,
      );
    }
    if (replacementCost > 0) {
      this.addLine(
        lines,
        {
          accountId: cogsAccountId,
          description: `تكلفة البضاعة البديلة - استبدال ميداني #${swapId}`,
          debit: replacementCost,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: vanLocationId,
        },
        moneyDigits,
      );
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: `صرف بضاعة بديلة من السيارة - استبدال ميداني #${swapId}`,
          debit: 0,
          credit: replacementCost,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: vanLocationId,
        },
        moneyDigits,
      );
    }
    if (priceDiff > 0 && customerId != null) {
      this.addLine(
        lines,
        {
          accountId: receivableAccountId,
          description: `فارق سعر استبدال تالف مستحق على العميل - استبدال ميداني #${swapId}`,
          debit: priceDiff,
          credit: 0,
          partnerType: 'customer',
          partnerId: customerId,
          branchId,
          locationId: vanLocationId,
        },
        moneyDigits,
      );
      this.addLine(
        lines,
        {
          accountId: revenueAccountId,
          description: `إيراد فارق سعر استبدال تالف - استبدال ميداني #${swapId}`,
          debit: 0,
          credit: priceDiff,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: vanLocationId,
        },
        moneyDigits,
      );
    }
    if (priceDiff < 0 && customerId != null) {
      const owed = Math.abs(priceDiff);
      this.addLine(
        lines,
        {
          accountId: revenueAccountId,
          description: `عكس إيراد فارق سعر استبدال تالف - استبدال ميداني #${swapId}`,
          debit: owed,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId: vanLocationId,
        },
        moneyDigits,
      );
      this.addLine(
        lines,
        {
          accountId: receivableAccountId,
          description: `فارق سعر استبدال تالف مستحق للعميل - استبدال ميداني #${swapId}`,
          debit: 0,
          credit: owed,
          partnerType: 'customer',
          partnerId: customerId,
          branchId,
          locationId: vanLocationId,
        },
        moneyDigits,
      );
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_damaged_swap',
        sourceId: swapId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد استبدال تالف ميداني #${swapId}`,
        branchId,
        locationId: vanLocationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (
        e.code === '23505' &&
        (e.constraint?.includes('idx_journal_entries_van_sales_uniq') ||
          e.constraint?.includes('idx_journal_entries_round1_uniq'))
      ) {
        const existing2 = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'van_damaged_swap')
          .where('source_id', '=', swapId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }
}
