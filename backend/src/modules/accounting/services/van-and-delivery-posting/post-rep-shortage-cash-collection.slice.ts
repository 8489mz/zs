import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx } from '../../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting.types';

export type PostRepShortageCashCollectionBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  toMoney: VanAndDeliveryPostingDeps['toMoney'];
  postDomainJournal: VanAndDeliveryPostingDeps['postDomainJournal'];
  getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
};

export class PostRepShortageCashCollectionSlice {
  constructor(private readonly bound: PostRepShortageCashCollectionBoundDeps) {}

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private postDomainJournal(queryable: DbOrTx, params: any): Promise<number> {
    return this.bound.postDomainJournal(queryable, params);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  /**
   * INV-REP-SHORTAGE-CASH-SETTLE: cash a rep hands over later for a pending
   * shortage is NEW cash. Trip settlement already debited 1110 only for the
   * counted cash and booked the shortage itself — Dr 7200 for a cash
   * shortage, Dr 1160 rep custody for a stock shortage charged to the rep —
   * so collecting it posts Dr 1110 / Cr 7200 (cash-shortage recovery) or
   * Cr 1160 (stock-shortage custody cleared), reversing exactly what trip
   * settlement booked. The caller serializes on the settlement row
   * (FOR UPDATE) and writes the treasury row and the status flip in the
   * same transaction; this method additionally pre-checks for an existing
   * posted journal for the item as a defensive dedup (no unique index
   * covers this source type). The credit accounts are the same codes
   * postVanTripSettlement used at trip settlement — flagged for reversal
   * if the owner prefers a different recovery account.
   */
  async postRepShortageCashCollection(
    queryable: DbOrTx,
    settlementItemId: number,
    params: {
      amount: number;
      entryType: 'cash_shortage' | 'stock_shortage';
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
      throw new AppError('مبلغ تحصيل العجز يجب أن يكون أكبر من صفر', 'SETTLEMENT_AMOUNT_INVALID', 400);
    }
    const creditCode = params.entryType === 'cash_shortage' ? '7200' : '1160';
    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings)
      throw new Error(`Accounting settings missing while posting rep shortage cash collection ${settlementItemId}`);
    let cashAccountId = Number(settings.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');
    const creditAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, creditCode);
    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'rep_shortage_cash_collection')
      .where('source_id', '=', settlementItemId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'posted')
      .executeTakeFirst();
    if (existing) return Number(existing.id);
    return this.postDomainJournal(queryable, {
      sourceType: 'rep_shortage_cash_collection',
      sourceId: settlementItemId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description:
        params.entryType === 'cash_shortage'
          ? `تحصيل نقدي لعجز كاش مندوب - بند تسوية #${settlementItemId}`
          : `تحصيل نقدي لعجز مخزني محمل على المندوب - بند تسوية #${settlementItemId}`,
      branchId: params.branchId,
      locationId: params.locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines: [
        {
          accountId: cashAccountId,
          description: 'نقدية محصلة من مندوب لسداد عجز',
          debit: amount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
        },
        {
          accountId: creditAccountId,
          description:
            params.entryType === 'cash_shortage'
              ? 'استرداد عجز كاش سبق إثباته كمصروف'
              : 'تصفية عهدة المندوب من عجز مخزني محمل عليه',
          debit: 0,
          credit: amount,
          partnerType: 'none',
          partnerId: null,
        },
      ],
    });
  }
}
