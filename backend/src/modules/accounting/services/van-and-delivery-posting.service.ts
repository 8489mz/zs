/*
 * Van + delivery posting (split-6 out of AccountingPostingService).
 * Pure move: the 8 van/delivery posting methods + the field-return COGS
 * helper used only by postVanFieldReturn, unchanged, behind the
 * AccountingPostingService delegating facade. The facade owns the shared
 * journal helpers; this service receives them bound via
 * VanAndDeliveryPostingDeps, so the moved bodies are byte-identical
 * to the originals.
 */
import { Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../accounting-posting.service';

export type VanAndDeliveryPostingDeps = {
  foundation: AccountingTenantFoundationService;
  getTenantAccountingSettings: (queryable: DbOrTx, tenantId: string) => Promise<any>;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
  maxAllowedDifference: (bookDigits: MoneyDigits) => number;
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
  // params use the facade-private DomainJournalLineDraft type, so typed as any
  // (same shape the facade's own postDomainJournal accepts).
  postDomainJournal: (queryable: DbOrTx, params: any) => Promise<number>;
  resolveSystemAccountByCode: (queryable: DbOrTx, tenantId: string, code: string) => Promise<number>;
  resolveAccountWithFallback: (
    queryable: DbOrTx,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ) => Promise<number>;
  deliverySettlementBasis: (
    queryable: DbOrTx,
    saleId: number,
    auth: AuthContext,
  ) => Promise<{ totalDebt: number; remainingReceivable: number; remainingFee: number }>;
  hasDeliveryCustodyReclassification: (queryable: DbOrTx, saleId: number, auth: AuthContext) => Promise<boolean>;
  deliveryCustodyPartner: (
    queryable: DbOrTx,
    saleId: number,
  ) => Promise<{ partnerType: 'rep' | 'none'; partnerId: number | null }>;
  readSaleResidualLines: (
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
  ) => Promise<Array<{ id: number; product_id: number | null; qty: number | string; cost_price: number | string | null; unit_multiplier: number | string | null; modifiers: unknown }>>;
  salesReturnCogsResidual: (
    queryable: Transaction<Database>,
    tenantId: string,
    saleId: number,
    bookDigits: MoneyDigits,
    returnedQtyBySaleItemId: Map<number, number>,
  ) => Promise<number>;
};

export class VanAndDeliveryPostingService {
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
  private readonly toMoney: VanAndDeliveryPostingDeps['toMoney'];
  private readonly maxAllowedDifference: VanAndDeliveryPostingDeps['maxAllowedDifference'];
  private readonly addLine: VanAndDeliveryPostingDeps['addLine'];
  private readonly insertPostedJournal: VanAndDeliveryPostingDeps['insertPostedJournal'];
  private readonly postDomainJournal: VanAndDeliveryPostingDeps['postDomainJournal'];
  private readonly resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  private readonly resolveAccountWithFallback: VanAndDeliveryPostingDeps['resolveAccountWithFallback'];
  private readonly deliverySettlementBasis: VanAndDeliveryPostingDeps['deliverySettlementBasis'];
  private readonly hasDeliveryCustodyReclassification: VanAndDeliveryPostingDeps['hasDeliveryCustodyReclassification'];
  private readonly deliveryCustodyPartner: VanAndDeliveryPostingDeps['deliveryCustodyPartner'];
  private readonly readSaleResidualLines: VanAndDeliveryPostingDeps['readSaleResidualLines'];
  private readonly salesReturnCogsResidual: VanAndDeliveryPostingDeps['salesReturnCogsResidual'];

  constructor(deps: VanAndDeliveryPostingDeps) {
    this.accountingTenantFoundation = deps.foundation;
    this.getTenantAccountingSettings = deps.getTenantAccountingSettings;
    this.toMoney = deps.toMoney;
    this.maxAllowedDifference = deps.maxAllowedDifference;
    this.addLine = deps.addLine;
    this.insertPostedJournal = deps.insertPostedJournal;
    this.postDomainJournal = deps.postDomainJournal;
    this.resolveSystemAccountByCode = deps.resolveSystemAccountByCode;
    this.resolveAccountWithFallback = deps.resolveAccountWithFallback;
    this.deliverySettlementBasis = deps.deliverySettlementBasis;
    this.hasDeliveryCustodyReclassification = deps.hasDeliveryCustodyReclassification;
    this.deliveryCustodyPartner = deps.deliveryCustodyPartner;
    this.readSaleResidualLines = deps.readSaleResidualLines;
    this.salesReturnCogsResidual = deps.salesReturnCogsResidual;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.accountingTenantFoundation.ensureForAuth(queryable, auth);
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
    const replacementCost = this.toMoney(Number(params.replacementQty || 0) * Number(params.replacementUnitCost || 0), moneyDigits);
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
      this.addLine(lines, { accountId: damagedExpenseAccountId, description: `مصروف بضاعة تالفة - استبدال ميداني #${swapId}`, debit: damagedCost, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId: damagedLocationId }, moneyDigits);
      this.addLine(lines, { accountId: inventoryAccountId, description: `نقص مخزون بسبب تلف - استبدال ميداني #${swapId}`, debit: 0, credit: damagedCost, partnerType: 'none', partnerId: null, branchId, locationId: damagedLocationId }, moneyDigits);
    }
    if (replacementCost > 0) {
      this.addLine(lines, { accountId: cogsAccountId, description: `تكلفة البضاعة البديلة - استبدال ميداني #${swapId}`, debit: replacementCost, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId: vanLocationId }, moneyDigits);
      this.addLine(lines, { accountId: inventoryAccountId, description: `صرف بضاعة بديلة من السيارة - استبدال ميداني #${swapId}`, debit: 0, credit: replacementCost, partnerType: 'none', partnerId: null, branchId, locationId: vanLocationId }, moneyDigits);
    }
    if (priceDiff > 0 && customerId != null) {
      this.addLine(lines, { accountId: receivableAccountId, description: `فارق سعر استبدال تالف مستحق على العميل - استبدال ميداني #${swapId}`, debit: priceDiff, credit: 0, partnerType: 'customer', partnerId: customerId, branchId, locationId: vanLocationId }, moneyDigits);
      this.addLine(lines, { accountId: revenueAccountId, description: `إيراد فارق سعر استبدال تالف - استبدال ميداني #${swapId}`, debit: 0, credit: priceDiff, partnerType: 'none', partnerId: null, branchId, locationId: vanLocationId }, moneyDigits);
    }
    if (priceDiff < 0 && customerId != null) {
      const owed = Math.abs(priceDiff);
      this.addLine(lines, { accountId: revenueAccountId, description: `عكس إيراد فارق سعر استبدال تالف - استبدال ميداني #${swapId}`, debit: owed, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId: vanLocationId }, moneyDigits);
      this.addLine(lines, { accountId: receivableAccountId, description: `فارق سعر استبدال تالف مستحق للعميل - استبدال ميداني #${swapId}`, debit: 0, credit: owed, partnerType: 'customer', partnerId: customerId, branchId, locationId: vanLocationId }, moneyDigits);
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
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_van_sales_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
         const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'van_damaged_swap').where('source_id', '=', swapId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing2?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

async postDeliveryRepSettlement(queryable: DbOrTx, saleId: number, amount: number, branchId: number | null, locationId: number | null, auth: AuthContext, opts?: { countedCash?: number }): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    if (!Number.isFinite(amount) || amount < 0) throw new AppError('Invalid delivery settlement', 'DELIVERY_SETTLEMENT_INVALID', 400);
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
    const countedCash = opts?.countedCash !== undefined && opts?.countedCash !== null
      ? toBookMoney(opts.countedCash)
      : bookCash;
    if (!Number.isFinite(countedCash) || countedCash < 0) throw new AppError('Invalid delivery settlement', 'DELIVERY_SETTLEMENT_INVALID', 400);

    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'delivery_rep_settlement')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting delivery settlement for sale ${saleId}`);

    const sale = await queryable.selectFrom('sales').select(['customer_id', 'doc_no', 'total', 'delivery_fee'])
      .where('id', '=', saleId).where('tenant_id', '=', scope.tenantId).executeTakeFirstOrThrow();

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');

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
    if (fee < 0 || Math.abs(fee - remainingFee) > this.maxAllowedDifference(bookDigits)) throw new AppError('Delivery settlement does not reconcile with courier fee', 'DELIVERY_SETTLEMENT_INVALID', 409);
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
      addBookLine({ accountId: courierPayableId, description: 'رسوم مندوب حر مخصومة من التحصيل', debit: fee, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    }
    if (variance < -this.maxAllowedDifference(bookDigits)) {
      const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
      addBookLine({ accountId: shortageAccountId, description: `عجز تسوية مندوب لفاتورة #${sale.doc_no || saleId}`, debit: Math.abs(variance), credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    } else if (variance > this.maxAllowedDifference(bookDigits)) {
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({ accountId: overageAccountId, description: `زيادة تسوية مندوب لفاتورة #${sale.doc_no || saleId}`, debit: 0, credit: variance, partnerType: 'none', partnerId: null, branchId, locationId });
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
      partnerType: custodyPartner ? custodyPartner.partnerType : (sale.customer_id ? 'customer' : 'none'),
      partnerId: custodyPartner ? custodyPartner.partnerId : (sale.customer_id ? Number(sale.customer_id) : null),
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
        const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'delivery_rep_settlement').where('source_id', '=', saleId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: existing ? existing.id : null };
      }
      throw e;
    }
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
    if (!settings) throw new Error(`Accounting settings missing while posting rep shortage cash collection ${settlementItemId}`);
    let cashAccountId = Number(settings.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');
    const creditAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, creditCode);
    const existing = await queryable.selectFrom('journal_entries').select('id')
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
      description: params.entryType === 'cash_shortage'
        ? `تحصيل نقدي لعجز كاش مندوب - بند تسوية #${settlementItemId}`
        : `تحصيل نقدي لعجز مخزني محمل على المندوب - بند تسوية #${settlementItemId}`,
      branchId: params.branchId,
      locationId: params.locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines: [
        { accountId: cashAccountId, description: 'نقدية محصلة من مندوب لسداد عجز', debit: amount, credit: 0, partnerType: 'none', partnerId: null },
        { accountId: creditAccountId, description: params.entryType === 'cash_shortage' ? 'استرداد عجز كاش سبق إثباته كمصروف' : 'تصفية عهدة المندوب من عجز مخزني محمل عليه', debit: 0, credit: amount, partnerType: 'none', partnerId: null },
      ],
    });
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
    const existing = await queryable.selectFrom('journal_entries').select('id')
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
        { accountId: expenseAccountId, description: 'إعفاء عجز مخزني محمل على المندوب - تحويل العهدة إلى مصروف', debit: amount, credit: 0, partnerType: 'none', partnerId: null },
        { accountId: custodyAccountId, description: 'تصفية عهدة المندوب من عجز مخزني معفى', debit: 0, credit: amount, partnerType: 'none', partnerId: null },
      ],
    });
  }

  /**
     * A van/field sale posts (via postSale) as a receivable rather than straight to cash — the money,
     * if any was collected, is physically in the rep's pocket, not the till. This is the same "collect
     * now, settle later" shape as postDeliveryRepSettlement, generalized to a whole trip: it reduces
     * that pooled receivable by the amount the rep actually hands over, and reconciles the difference
     * against a shortage/overage account (mirroring the cashier-shift variance treatment) rather than
     * silently adjusting cash by whatever was collected.
     */
async postVanTripSettlement(
    queryable: DbOrTx,
    tripId: number,
    params: {
      expectedCash: number;
      countedCash: number;
      tripExpenses?: number;
      branchId: number | null;
      locationId: number | null;
      stockShortageAmount?: number;
      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: mirror of
      // stockShortageAmount. Overage units found in the van are
      // journaled Dr 1140 / Cr 7100 so the added stock value is
      // accounted, never silently added to stock or income.
      stockOverageAmount?: number;
      chargeStockVarianceToRep?: boolean;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_trip_settlement')
      .where('source_id', '=', tripId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const expected = toBookMoney(params.expectedCash);
    const counted = toBookMoney(params.countedCash);
    const tripExpenses = params.tripExpenses ? toBookMoney(params.tripExpenses) : 0;
    const stockShortage = params.stockShortageAmount ? toBookMoney(params.stockShortageAmount) : 0;
    const stockOverage = params.stockOverageAmount ? toBookMoney(params.stockOverageAmount) : 0;

    if (expected <= 0 && counted <= 0 && tripExpenses <= 0 && stockShortage <= 0 && stockOverage <= 0) return { posted: false, journalEntryId: null };
    const variance = toBookMoney(counted - expected);

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van trip settlement ${tripId}`);

    let cashAccountId = Number(settings.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');
    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0)) receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const lines: JournalLineDraft[] = [];
    const branchId = params.branchId;
    const locationId = params.locationId;

    const grossReceivableToClear = toBookMoney(expected + tripExpenses);
    if (grossReceivableToClear > 0) {
      addBookLine({ accountId: receivableAccountId, description: `تصفية عهدة نقدية مندوب - رحلة #${tripId}`, debit: 0, credit: grossReceivableToClear, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (tripExpenses > 0) {
      const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6400');
      addBookLine({ accountId: expenseAccountId, description: `مصروفات تشغيلية ووقود رحلة توزيع #${tripId}`, debit: tripExpenses, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (variance < -this.maxAllowedDifference(bookDigits)) {
      const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
      addBookLine({ accountId: shortageAccountId, description: `عجز تصفية رحلة توزيع #${tripId}`, debit: Math.abs(variance), credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    } else if (variance > this.maxAllowedDifference(bookDigits)) {
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({ accountId: overageAccountId, description: `زيادة تصفية رحلة توزيع #${tripId}`, debit: 0, credit: variance, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (counted > 0) {
      addBookLine({ accountId: cashAccountId, description: `نقدية مسلَّمة من مندوب - رحلة #${tripId}`, debit: counted, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (stockShortage > 0) {
      let inventoryAccountId = Number(settings.inventory_account_id || 0);
      if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

      let debitAccountId: number;
      let debitDesc: string;
      if (params.chargeStockVarianceToRep) {
        debitAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160');
        debitDesc = `عجز مخزني محمل على عهدة وسلف المندوب - رحلة #${tripId}`;
      } else {
        debitAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
        debitDesc = `خسائر عجز مخزني سيارة التوزيع - رحلة #${tripId}`;
      }

      addBookLine({ accountId: debitAccountId, description: debitDesc, debit: stockShortage, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
      addBookLine({ accountId: inventoryAccountId, description: `تسوية عجز مخزني سيارة التوزيع - رحلة #${tripId}`, debit: 0, credit: stockShortage, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: overage mirror of the
    // shortage block above. Found units raise the van's inventory
    // asset (Dr 1140) against an overage gain (Cr 7100, the same
    // account cash overage credits in this journal). Shortage legs
    // above are byte-identical; this block only adds legs.
    if (stockOverage > 0) {
      let inventoryAccountId = Number(settings.inventory_account_id || 0);
      if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({ accountId: inventoryAccountId, description: `تسوية زيادة مخزنية سيارة التوزيع - رحلة #${tripId}`, debit: stockOverage, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
      addBookLine({ accountId: overageAccountId, description: `إيراد زيادة جرد بضاعة سيارة التوزيع - رحلة #${tripId}`, debit: 0, credit: stockOverage, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    if (lines.length === 0) return { posted: false, journalEntryId: null };

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_trip_settlement',
        sourceId: tripId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد تصفية رحلة توزيع #${tripId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_van_sales_uniq')) {
        const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'van_trip_settlement').where('source_id', '=', tripId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
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
    if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const descAr = params.type === 'load'
      ? `تحميل بضاعة لسيارة التوزيع - رحلة #${tripId}`
      : `تفريغ وإعادة بضاعة سيارة التوزيع للمستودع - رحلة #${tripId}`;

    const lines: JournalLineDraft[] = [
      { accountId: inventoryAccountId, description: `${descAr} (دخول)`, debit: cost, credit: 0, partnerType: 'none', partnerId: null, branchId: params.branchId ?? null, locationId: params.targetLocationId },
      { accountId: inventoryAccountId, description: `${descAr} (خروج)`, debit: 0, credit: cost, partnerType: 'none', partnerId: null, branchId: params.branchId ?? null, locationId: params.sourceLocationId },
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
        const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', sourceType).where('source_id', '=', tripId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }

  /**
     * A field debt collection is also cash sitting with the rep until the trip is settled, so it
     * cannot go straight to the cash account either. It moves the amount out of the customer's own
     * receivable and into the same pooled "none"-partner receivable that postVanTripSettlement later
     * clears against cash — the mirror image of postSale crediting a customer's receivable into that
     * same pool at sale time.
     */
async postVanFieldCollection(
    queryable: DbOrTx,
    collectionId: number,
    params: { amount: number; customerId: number; branchId: number | null; locationId: number | null; paymentMethod?: string; transferReference?: string },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);


    const amount = toBookMoney(params.amount);
    if (!(amount > 0)) return { posted: false, journalEntryId: null };

    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_field_collection')
      .where('source_id', '=', collectionId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van field collection ${collectionId}`);

    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0)) receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const branchId = params.branchId;
    const locationId = params.locationId;
    const electronic = params.paymentMethod != null && params.paymentMethod !== 'cash';
    // INV-VAN-FIELD-NONCASH-EVIDENCE-GATE: an electronic collection
    // debits bank 1120 below, so it must carry a transfer
    // reference — the field service enforces supervisor PIN +
    // reference before this point, and this is the last line of
    // defence for any future caller that reaches the posting
    // without evidence. Cash collections are untouched.
    if (electronic) {
      const reference = String(params.transferReference || '').trim();
      if (reference.length < 3) {
        throw new Error(
          `Van field collection ${collectionId}: refusing to debit bank 1120 for an electronic collection without a transfer reference of at least 3 characters`,
        );
      }
    }
    const debitAccountId = electronic ? await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120') : receivableAccountId;
    const lines: JournalLineDraft[] = [
      { accountId: debitAccountId, description: electronic ? 'تحصيل ميداني إلكتروني إلى البنك' : 'تحصيل ميداني بواسطة مندوب - عهدة نقدية', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId },
      { accountId: receivableAccountId, description: `تحصيل ميداني بواسطة مندوب - سداد مديونية عميل`, debit: 0, credit: amount, partnerType: 'customer', partnerId: params.customerId, branchId, locationId },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_field_collection',
        sourceId: collectionId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد تحصيل ميداني #${collectionId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_van_sales_uniq')) {
        const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'van_field_collection').where('source_id', '=', collectionId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }

  /*
     * INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR: a LINKED field return
     * reverses COGS on the same residual basis the sale posted it — the
     * returned quantity per original sale line is fed through the shared
     * residual grouping (salesReturnCogsResidual) at the FROZEN sale-line
     * costs, with the post-sale remaining quantity reconstructed from the
     * post-restock stock read, so sequential field returns telescope to
     * the posted COGS and a full return nets COGS to zero. The caller
     * supplies the current product cost per item; the mirror ignores it
     * in favour of the frozen cost, because the current cost is what
     * stranded the divergence this mirror closes. Eligibility is
     * deliberately narrow: a linked sale whose every returned item
     * resolves to exactly one sale line (by saleItemId, or by a unique
     * product line), and a non-damaged restock. Anything else — no
     * linked sale, a damaged-location restock, an unresolvable or
     * ambiguous line (including several sale lines at differing frozen
     * costs with no saleItemId to disambiguate), or a missing sale —
     * keeps the legacy plain qty x caller cost computation. A resolved
     * line whose frozen cost is missing or invalid fails closed with
     * VAN_FIELD_RETURN_FROZEN_COST_INVALID instead of silently
     * falling back to the current product cost. A zero frozen cost
     * (prepared composite) contributes nothing, as in the sales-return
     * mirror, and its COGS stays expensed.
     */
private async vanFieldReturnCogsAmount(
    queryable: DbOrTx,
    tenantId: string,
    params: {
      items: { productId: number; qty: number; costPrice: number; saleItemId?: number | null }[];
      saleId?: number | null;
      isDamaged?: boolean;
    },
    bookDigits: MoneyDigits,
  ): Promise<number> {
    const legacy = params.items.reduce((sum, it) => sum + (Number(it.qty || 0) * Number(it.costPrice || 0)), 0);
    const saleId = params.saleId ? Number(params.saleId) : 0;
    if (!(saleId > 0) || params.isDamaged) return legacy;
    // The residual grouping reads stock on a transaction handle; the
    // only caller passes the approval transaction, which also carries
    // the restock, so the read and the journal commit or roll back
    // together.
    const trx = queryable as Transaction<Database>;
    const saleItems = await this.readSaleResidualLines(trx, tenantId, saleId);
    if (!saleItems.length) return legacy;
    const byId = new Map(saleItems.map((item) => [Number(item.id), item]));
    const byProduct = new Map<number, typeof saleItems>();
    for (const item of saleItems) {
      const pid = Number(item.product_id || 0);
      if (!byProduct.has(pid)) byProduct.set(pid, []);
      byProduct.get(pid)!.push(item);
    }
    const returnedQtyBySaleItemId = new Map<number, number>();
    for (const item of params.items) {
      const qty = Number(item.qty || 0);
      if (!(qty > 0)) continue;
      const productId = Number(item.productId || 0);
      let line: (typeof saleItems)[number] | undefined;
      if (item.saleItemId != null) {
        line = byId.get(Number(item.saleItemId));
        if (!line || Number(line.product_id || 0) !== productId) return legacy;
      } else {
        const candidates = byProduct.get(productId) || [];
        if (candidates.length !== 1) return legacy;
        line = candidates[0];
      }
      const rawCost = line.cost_price;
      if (rawCost == null) {
        throw new AppError(
          `Frozen sale cost is missing for field-return product ${productId}; refusing to reverse COGS at the current product cost`,
          'VAN_FIELD_RETURN_FROZEN_COST_INVALID',
          400,
        );
      }
      const frozen = Number(rawCost);
      if (!Number.isFinite(frozen) || frozen < 0) {
        throw new AppError(
          `Frozen sale cost is invalid for field-return product ${productId}; refusing to reverse COGS at the current product cost`,
          'VAN_FIELD_RETURN_FROZEN_COST_INVALID',
          400,
        );
      }
      if (frozen === 0) continue;
      returnedQtyBySaleItemId.set(Number(line.id), (returnedQtyBySaleItemId.get(Number(line.id)) || 0) + qty);
    }
    if (returnedQtyBySaleItemId.size === 0) return 0;
    return this.salesReturnCogsResidual(trx, tenantId, saleId, bookDigits, returnedQtyBySaleItemId);
  }

  /**
     * An approved field return reverses the two things the original sale posted: the revenue (net of
     * whatever discount the return price itself already reflects) and the COGS/inventory pair, using
     * the product's actual cost — not the return's unit price, which is a selling price, not a cost.
     * The receivable side always credits the named customer (submitFieldReturn requires one), whether
     * the original sale was cash-via-rep-custody or a real customer credit sale, matching what
     * approveFieldReturn already writes to customers.balance/customer_ledger for every return.
     */
async postVanFieldReturn(
    queryable: DbOrTx,
    returnId: number,
    params: {
      customerId: number;
      totalAmount: number;
      refundMethod?: 'credit' | 'cash';
      items: { productId: number; qty: number; costPrice: number; saleItemId?: number | null }[];
      branchId: number | null;
      locationId: number | null;
      saleId?: number | null;
      isDamaged?: boolean;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const amount = toBookMoney(params.totalAmount);
    if (!(amount > 0)) return { posted: false, journalEntryId: null };

    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_field_return')
      .where('source_id', '=', returnId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    // INV-VAN-RETURN-METHOD-MATCH: the posting must debit the leg
    // that actually holds the money. The returns service already
    // enforces the match; this re-derives the linked sale's payment
    // type at the money boundary so a mismatched refund can never
    // post even if a future caller passes refundMethod unchecked.
    // A split sale allows either method — its leg bounds are
    // enforced by the returns service, not here.
    if (params.saleId != null) {
      const linkedSale = await queryable
        .selectFrom('sales')
        .select(['payment_type'])
        .where('id', '=', params.saleId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      const salePayment = String((linkedSale as any)?.payment_type || '').trim();
      const wantsCash = params.refundMethod === 'cash';
      if (!linkedSale || !['cash', 'credit', 'card', 'split', 'instapay', 'vodafone_cash'].includes(salePayment)) {
        throw new AppError(
          `تعذّرت مطابقة طريقة رد المرتجع #${returnId} مع الفاتورة الأصلية — طريقة دفع الفاتورة غير معروفة`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
      if ((salePayment === 'credit' && wantsCash) || (salePayment === 'cash' && !wantsCash)) {
        throw new AppError(
          `طريقة رد المرتجع #${returnId} (${wantsCash ? 'نقدي' : 'كائتمان'}) لا تطابق طريقة دفع الفاتورة الأصلية (${salePayment})`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
      if (salePayment === 'card' || salePayment === 'instapay' || salePayment === 'vodafone_cash') {
        throw new AppError(
          `لا يمكن رد مرتجع #${returnId} على فاتورة مسددة (${salePayment}) نقداً أو كائتمان من عهدة المندوب — المبلغ مستقر في البنك ويتطلب عكساً بنكياً`,
          'REFUND_METHOD_MISMATCH',
          400,
        );
      }
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van field return ${returnId}`);

    let revenueAccountId = Number(settings.sales_revenue_account_id || 0);
    if (!(revenueAccountId > 0)) revenueAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '4100');
    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0)) receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    let cogsAccountId = Number(settings.cogs_account_id || 0);
    if (!(cogsAccountId > 0)) cogsAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5100');
    let inventoryAccountId = Number(settings.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const branchId = params.branchId;
    const locationId = params.locationId;
    const isCashRefund = params.refundMethod === 'cash';
    const lines: JournalLineDraft[] = [
      { accountId: revenueAccountId, description: `عكس إيراد مبيعات - مرتجع ميداني #${returnId}`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId },
      isCashRefund
        ? { accountId: receivableAccountId, description: `تخفيض عهدة نقدية مندوب - مرتجع ميداني مسدد نقداً #${returnId}`, debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }
        : { accountId: receivableAccountId, description: `تخفيض مديونية عميل - مرتجع ميداني #${returnId}`, debit: 0, credit: amount, partnerType: 'customer', partnerId: params.customerId, branchId, locationId },
    ];

    // INV-VAN-FIELD-RETURN-COGS-RESIDUAL-MIRROR: linked returns reverse
    // COGS on the shared residual basis at frozen sale-line costs; every
    // other shape keeps the legacy plain computation (see
    // vanFieldReturnCogsAmount).
    const cogsAmount = toBookMoney(await this.vanFieldReturnCogsAmount(queryable, scope.tenantId, params, bookDigits));
    if (cogsAmount > 0) {
      addBookLine({ accountId: inventoryAccountId, description: `إعادة بضاعة للمخزون - مرتجع ميداني #${returnId}`, debit: cogsAmount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
      addBookLine({ accountId: cogsAccountId, description: `عكس تكلفة البضاعة المباعة - مرتجع ميداني #${returnId}`, debit: 0, credit: cogsAmount, partnerType: 'none', partnerId: null, branchId, locationId });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_field_return',
        sourceId: returnId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد مرتجع ميداني معتمد #${returnId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing2 = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'van_field_return').where('source_id', '=', returnId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }
}
