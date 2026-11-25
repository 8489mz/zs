import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting.types';

export type PostVanStockTransferBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: VanAndDeliveryPostingDeps['toMoney'];
  getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  insertPostedJournal: VanAndDeliveryPostingDeps['insertPostedJournal'];
};

export class PostVanStockTransferSlice {
  constructor(private readonly bound: PostVanStockTransferBoundDeps) {}

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
   * Posts inventory movement journal entry between warehouse and mobile van location.
   */
  async postVanStockTransfer(
    queryable: DbOrTx,
    tripId: number,
    params: {
      sourceLocationId: number;
      targetLocationId: number;
      totalCost: number;
      branchId?: number | null;
      type: 'load' | 'unload';
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const cost = toBookMoney(params.totalCost);
    if (!(cost > 0)) return { posted: false, journalEntryId: null };

    const sourceType = params.type === 'load' ? 'van_load_transfer' : 'van_unload_transfer';
    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', sourceType)
      .where('source_id', '=', tripId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0))
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const descAr =
      params.type === 'load'
        ? `تحميل بضاعة لسيارة التوزيع - رحلة #${tripId}`
        : `تفريغ وإعادة بضاعة سيارة التوزيع للمستودع - رحلة #${tripId}`;

    const lines: JournalLineDraft[] = [
      {
        accountId: inventoryAccountId,
        description: `${descAr} (دخول)`,
        debit: cost,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: params.branchId ?? null,
        locationId: params.targetLocationId,
      },
      {
        accountId: inventoryAccountId,
        description: `${descAr} (خروج)`,
        debit: 0,
        credit: cost,
        partnerType: 'none',
        partnerId: null,
        branchId: params.branchId ?? null,
        locationId: params.sourceLocationId,
      },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType,
        sourceId: tripId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد ${descAr}`,
        branchId: params.branchId ?? null,
        locationId: params.targetLocationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_van_sales_uniq')) {
        const existing2 = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', sourceType)
          .where('source_id', '=', tripId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }
}
