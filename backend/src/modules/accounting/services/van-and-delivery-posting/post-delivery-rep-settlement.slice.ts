import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting.types';

export type PostDeliveryRepSettlementBoundDeps = {
  resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  maxAllowedDifference: VanAndDeliveryPostingDeps['maxAllowedDifference'];
  resolveAccountWithFallback: VanAndDeliveryPostingDeps['resolveAccountWithFallback'];
  toMoney: VanAndDeliveryPostingDeps['toMoney'];
  insertPostedJournal: VanAndDeliveryPostingDeps['insertPostedJournal'];
  hasDeliveryCustodyReclassification: VanAndDeliveryPostingDeps['hasDeliveryCustodyReclassification'];
  getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
  deliverySettlementBasis: VanAndDeliveryPostingDeps['deliverySettlementBasis'];
  deliveryCustodyPartner: VanAndDeliveryPostingDeps['deliveryCustodyPartner'];
  addLine: VanAndDeliveryPostingDeps['addLine'];
};

export class PostDeliveryRepSettlementSlice {
  constructor(private readonly bound: PostDeliveryRepSettlementBoundDeps) {}

  private resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private maxAllowedDifference(bookDigits: MoneyDigits): number {
    return this.bound.maxAllowedDifference(bookDigits);
  }

  private resolveAccountWithFallback(
    queryable: DbOrTx,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ): Promise<number> {
    return this.bound.resolveAccountWithFallback(queryable, tenantId, configuredId, fallbackCode);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
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

  private hasDeliveryCustodyReclassification(queryable: DbOrTx, saleId: number, auth: AuthContext): Promise<boolean> {
    return this.bound.hasDeliveryCustodyReclassification(queryable, saleId, auth);
  }

  private getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private deliverySettlementBasis(
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ): Promise<{ totalDebt: number; remainingReceivable: number; remainingFee: number }> {
    return this.bound.deliverySettlementBasis(queryable, saleId, auth);
  }

  private deliveryCustodyPartner(
    queryable: DbOrTx,
    saleId: number,
  ): Promise<{ partnerType: 'rep' | 'none'; partnerId: number | null }> {
    return this.bound.deliveryCustodyPartner(queryable, saleId);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    this.bound.addLine(lines, next, digits);
  }

  async postDeliveryRepSettlement(
    queryable: DbOrTx,
    saleId: number,
    amount: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    opts?: { countedCash?: number },
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    if (!Number.isFinite(amount) || amount < 0)
      throw new AppError('Invalid delivery settlement', 'DELIVERY_SETTLEMENT_INVALID', 400);
    // INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): `amount` is the
    // BOOK cash due, as before. `opts.countedCash` is the cash the
    // rep actually handed over, counted by the cashier — supplied
    // only by settleOrder. When it is absent the counted cash is
    // the book amount and the posting is exactly the old one. A
    // counted amount that differs from the book amount is a
    // shortage (Dr 7200) or an overage (Cr 7100), mirroring
    // postVanTripSettlement — unreceived cash is never booked as
    // received. A computed book amount that does not reconcile
    // with the remaining fee still fails closed below (the R7-A
    // gate): a human-counted difference is a variance to book,
    // a computed difference is a caller bug to reject.
    const bookCash = toBookMoney(amount);
    const countedCash =
      opts?.countedCash !== undefined && opts?.countedCash !== null ? toBookMoney(opts.countedCash) : bookCash;
    if (!Number.isFinite(countedCash) || countedCash < 0)
      throw new AppError('Invalid delivery settlement', 'DELIVERY_SETTLEMENT_INVALID', 400);

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'delivery_rep_settlement')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting delivery settlement for sale ${saleId}`);

    const sale = await queryable
      .selectFrom('sales')
      .select(['customer_id', 'doc_no', 'total', 'delivery_fee'])
      .where('id', '=', saleId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirstOrThrow();

    const cashAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.cash_account_id,
      '1110',
    );
    const customerAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.customer_receivable_account_id,
      '1130',
    );

    // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F2: the fee and the
    // credit leg are derived from the REMAINING amounts
    // (deliverySettlementBasis), not the original total. A prior
    // return already credited 1130 for its receivable leg and
    // relieved part of 2115, so settling total - originalFee
    // over-credits 1130 and double-relieves 2115. The fee must
    // equal the remaining fee EXACTLY — including zero: a zero
    // collection against a still-owed fee (e.g. the rest was
    // covered by store credit) fails closed for manual
    // reconciliation instead of silently dropping the fee.
    // A stale book amount (total - original fee, total -
    // remaining fee) throws DELIVERY_SETTLEMENT_INVALID here —
    // pinned by sale-money-truth F9 and returns-payout-truth.
    const basis = await this.deliverySettlementBasis(queryable, saleId, auth);
    const remainingReceivable = basis.remainingReceivable;
    const remainingFee = basis.remainingFee;
    const fee = toBookMoney(remainingReceivable - bookCash);
    if (fee < 0 || Math.abs(fee - remainingFee) > this.maxAllowedDifference(bookDigits))
      throw new AppError('Delivery settlement does not reconcile with courier fee', 'DELIVERY_SETTLEMENT_INVALID', 409);
    // INV-SF-SINGLE-SETTLE-COUNTED-CASH (D-SF-01): the difference
    // between the counted cash and the reconciled book cash is
    // the variance — a shortage (Dr 7200) or an overage
    // (Cr 7100), mirroring postVanTripSettlement. When counted
    // == book the variance is zero and the legs are exactly the
    // old ones (Dr 2115 fee + Dr 1110 cash / Cr 1130 receivable).
    const variance = toBookMoney(countedCash - bookCash);
    // A fully-returned order has nothing left to collect and no
    // fee left to relieve: post no (empty) journal — the
    // receivable is already zero via the return journal — and let
    // the caller mark the order settled. insertPostedJournal
    // throws EMPTY_JOURNAL on zero lines, so this returns before
    // the lines are built. (A counted amount on a fully-returned
    // order is not "nothing": it is a pure overage, booked below
    // as Dr 1110 / Cr 7100.)
    if (remainingReceivable === 0 && countedCash === 0) return { posted: false, journalEntryId: null };
    const lines: JournalLineDraft[] = [];
    if (fee > 0) {
      // R4-A (INV-REST-SALE-MONEY-TRUTH): the sale now posts the
      // freelance fee as Cr 2115 (Courier Fees Payable), so the
      // settlement relieves that payable — it must NOT book Dr 6400
      // expense, or the fee would hit P&L twice and 2115 would never
      // be relieved. The fee leg only fires for a freelance courier:
      // both settlement callers pass the full total (fee 0) for a
      // store-fleet sale, whose fee is 4200 revenue at sale time.
      const courierPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2115');
      addBookLine({
        accountId: courierPayableId,
        description: 'رسوم مندوب حر مخصومة من التحصيل',
        debit: fee,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }
    if (variance < -this.maxAllowedDifference(bookDigits)) {
      const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
      addBookLine({
        accountId: shortageAccountId,
        description: `عجز تسوية مندوب لفاتورة #${sale.doc_no || saleId}`,
        debit: Math.abs(variance),
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (variance > this.maxAllowedDifference(bookDigits)) {
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({
        accountId: overageAccountId,
        description: `زيادة تسوية مندوب لفاتورة #${sale.doc_no || saleId}`,
        debit: 0,
        credit: variance,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }
    addBookLine({
      accountId: cashAccountId,
      description: `تحصيل من مندوب عن فاتورة #${sale.doc_no || saleId}`,
      debit: countedCash,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    });
    // D-SF-02 (INV-SF-COD-CUSTODY-GL) + M12 (INV-REP-CUSTODY-LEDGER):
    // the receivable was moved to courier custody at dispatch, so the
    // settlement credits the custody leg — the SAME partner the
    // dispatch posted (deliveryCustodyPartner: 'rep' + repId post-M12,
    // the old 'none' for a pre-M12 dispatch) — never the customer leg:
    // crediting the customer would drive it negative while the
    // custody debit stands, and crediting a different partner would
    // strand the rep balance. A sale settled without dispatch keeps
    // the old customer-leg credit.
    const inCourierCustody = await this.hasDeliveryCustodyReclassification(queryable, saleId, auth);
    const custodyPartner = inCourierCustody ? await this.deliveryCustodyPartner(queryable, saleId) : null;
    addBookLine({
      accountId: customerAccountId,
      description: `تسديد مديونية فاتورة #${sale.doc_no || saleId}`,
      debit: 0,
      // R7-A F2: credit the REMAINING receivable, not the original
      // total — a prior return already credited 1130 for its
      // receivable leg, so crediting the full total would
      // over-credit 1130 by the returned share.
      credit: remainingReceivable,
      partnerType: custodyPartner ? custodyPartner.partnerType : sale.customer_id ? 'customer' : 'none',
      partnerId: custodyPartner ? custodyPartner.partnerId : sale.customer_id ? Number(sale.customer_id) : null,
      branchId,
      locationId,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'delivery_rep_settlement',
        sourceId: saleId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد تسوية مندوب لفاتورة #${sale.doc_no || saleId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'delivery_rep_settlement')
          .where('source_id', '=', saleId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: existing ? existing.id : null };
      }
      throw e;
    }
  }
}
