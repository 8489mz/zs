import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx } from '../../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting.types';

export type PostRepShortageWaiverBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: VanAndDeliveryPostingDeps['toMoney'];
  resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  postDomainJournal: VanAndDeliveryPostingDeps['postDomainJournal'];
};

export class PostRepShortageWaiverSlice {
  constructor(private readonly bound: PostRepShortageWaiverBoundDeps) {}

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private async postDomainJournal(queryable: DbOrTx, params: any): Promise<number> {
    return this.bound.postDomainJournal(queryable, params);
  }

  /**
   * INV-VAN-REP-SHORTAGE-WAIVER-REVERSAL: waiving a pending stock
   * shortage charged to the rep must reverse what trip settlement
   * booked — Dr 7200 / Cr 1160 — or the rep custody debit 1160
   * stands stranded forever. A cash shortage needs no reversal
   * (Dr 7200 already stands at trip settlement), so this method is
   * called only for stock_shortage waivers. The caller serializes
   * on the settlement row (FOR UPDATE) and flips the status in the
   * same transaction; this method additionally pre-checks for an
   * existing posted journal for the item as a defensive dedup (no
   * unique index covers this source type).
   */
  async postRepShortageWaiver(
    queryable: DbOrTx,
    settlementItemId: number,
    params: {
      amount: number;
      branchId: number | null;
      locationId: number | null;
    },
    auth: AuthContext,
  ): Promise<number> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = this.toMoney(params.amount, bookDigits);
    if (!(amount > 0)) {
      throw new AppError('مبلغ إعفاء العجز يجب أن يكون أكبر من صفر', 'SETTLEMENT_AMOUNT_INVALID', 400);
    }
    const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
    const custodyAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160');
    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'rep_shortage_waiver')
      .where('source_id', '=', settlementItemId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (existing) return Number(existing.id);
    return this.postDomainJournal(queryable, {
      sourceType: 'rep_shortage_waiver',
      sourceId: settlementItemId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `إعفاء إداري لعجز مخزني محمل على المندوب - بند تسوية #${settlementItemId}`,
      branchId: params.branchId,
      locationId: params.locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines: [
        {
          accountId: expenseAccountId,
          description: 'إعفاء عجز مخزني محمل على المندوب - تحويل العهدة إلى مصروف',
          debit: amount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
        },
        {
          accountId: custodyAccountId,
          description: 'تصفية عهدة المندوب من عجز مخزني معفى',
          debit: 0,
          credit: amount,
          partnerType: 'none',
          partnerId: null,
        },
      ],
    });
  }
}
