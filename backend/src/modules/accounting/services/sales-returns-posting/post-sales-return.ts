// Sales return posting (file #46 S7).
// Pure move from sales-returns-posting.service.ts: postSalesReturn.
// Bound deps: salesReturnCogsAmount (S1), computeSalesReturnRelief (S5),
// hasDeliveryCustodyReclassification + deliveryCustodyPartner (S6),
// ensureTenantFoundation (facade-kept private, passed bound).
// The in-slice this.* calls stay inside this class.

import type { Transaction } from 'kysely';
import { sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { SalesAndReturnsPostingDeps } from './sales-returns-posting-types';
import type { SaleCogsResidualService } from './sale-cogs-residual';
import type { SalesReturnReliefService } from './sales-return-relief';
import type { DeliveryCustodyService } from './delivery-custody';

export class PostSalesReturnService {
  constructor(
    private readonly assertTransaction: SalesAndReturnsPostingDeps['assertTransaction'],
    private readonly toMoney: SalesAndReturnsPostingDeps['toMoney'],
    private readonly getExistingSalesReturnJournal: SalesAndReturnsPostingDeps['getExistingSalesReturnJournal'],
    private readonly logger: SalesAndReturnsPostingDeps['logger'],
    private readonly getTenantAccountingSettings: SalesAndReturnsPostingDeps['getTenantAccountingSettings'],
    private readonly resolveAccountWithFallback: SalesAndReturnsPostingDeps['resolveAccountWithFallback'],
    private readonly addLine: SalesAndReturnsPostingDeps['addLine'],
    private readonly resolveSystemAccountByCode: SalesAndReturnsPostingDeps['resolveSystemAccountByCode'],
    private readonly maxAllowedDifference: SalesAndReturnsPostingDeps['maxAllowedDifference'],
    private readonly getActiveAccountMap: SalesAndReturnsPostingDeps['getActiveAccountMap'],
    private readonly insertPostedJournal: SalesAndReturnsPostingDeps['insertPostedJournal'],
    private readonly salesReturnCogsAmount: SaleCogsResidualService['salesReturnCogsAmount'],
    private readonly computeSalesReturnRelief: SalesReturnReliefService['computeSalesReturnRelief'],
    private readonly hasDeliveryCustodyReclassification: DeliveryCustodyService['hasDeliveryCustodyReclassification'],
    private readonly deliveryCustodyPartner: DeliveryCustodyService['deliveryCustodyPartner'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  async postSalesReturn(
    queryable: Transaction<Database>,
    returnId: number,
    auth: AuthContext,
    collectExchangeLines?: (lines: JournalLineDraft[]) => void,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    this.assertTransaction(queryable, 'postSalesReturn');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSalesReturnJournal(queryable, returnId, scope.tenantId);
    if (existing) {
      this.logger.warn(`Skipping duplicate sales return journal for return ${returnId}; existing entry ${existing.id}`);
      return { posted: false, journalEntryId: Number(existing.id) };
    }

    const returnDocument = await queryable
      .selectFrom('return_documents')
      .select([
        'id',
        'doc_no',
        'return_type',
        'invoice_id',
        'settlement_mode',
        'refund_method',
        'refund_allocations',
        'total',
        'branch_id',
        'location_id',
        'created_by',
        'created_at',
      ])
      .where('id', '=', returnId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!returnDocument || returnDocument.return_type !== 'sale') {
      this.logger.warn(`Sales return document ${returnId} not found or not a sale return; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const sale = returnDocument.invoice_id
      ? await queryable
          .selectFrom('sales')
          // R6-E (INV-REST-SALE-MONEY-TRUTH-2): the relief below needs
          // the sale's money columns — the return document carries
          // none of them (no tip/delivery columns exist on it).
          .select([
            'id',
            'doc_no',
            'payment_type',
            'customer_id',
            'tax_amount',
            'total',
            'subtotal',
            'discount',
            'tip_amount',
            'delivery_fee',
            'delivery_fee_mode',
            'service_charge',
            'prices_include_tax',
          ])
          .where('id', '=', Number(returnDocument.invoice_id))
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst()
      : null;

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting sales return ${returnId}`);

    const salesReturnsAccount = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active'])
      .where('tenant_id', '=', scope.tenantId)
      .where('code', '=', '4400')
      .executeTakeFirst();
    const fallbackRevenueAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.sales_revenue_account_id,
      '4100',
    );
    const salesReturnsAccountId =
      Number(salesReturnsAccount?.id || 0) > 0 ? Number(salesReturnsAccount?.id || 0) : fallbackRevenueAccountId;
    if (!(Number(salesReturnsAccount?.id || 0) > 0) && fallbackRevenueAccountId > 0) {
      this.logger.warn(
        `Sales returns account code 4400 not found for return ${returnId}; falling back to sales revenue account ${fallbackRevenueAccountId}`,
      );
    }

    const rawRefundAllocations: unknown =
      typeof returnDocument.refund_allocations === 'string'
        ? JSON.parse(returnDocument.refund_allocations)
        : returnDocument.refund_allocations;
    const refundAllocations = Array.isArray(rawRefundAllocations)
      ? (rawRefundAllocations as Array<{ tender: string; amount: number }>)
      : null;
    if (
      returnDocument.refund_allocations != null &&
      (!refundAllocations ||
        refundAllocations.some(
          (entry) =>
            !entry ||
            !['cash', 'card', 'store_credit', 'receivable'].includes(entry.tender) ||
            !Number.isFinite(Number(entry.amount)) ||
            Number(entry.amount) <= 0,
        ))
    ) {
      throw new Error(`Invalid refund tender allocation for return ${returnId}`);
    }
    const cashAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.cash_account_id,
      '1110',
    );
    const bankAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.bank_account_id,
      '1120',
    );
    const customerAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.customer_receivable_account_id,
      '1130',
    );
    const storeCreditAccountId =
      returnDocument.settlement_mode === 'store_credit' ||
      refundAllocations?.some((entry) => entry.tender === 'store_credit')
        ? await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '2150')
        : 0;
    const salesTaxAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.sales_tax_account_id,
      '2120',
    );
    const cogsAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.cogs_account_id,
      '5100',
    );
    const inventoryAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.inventory_account_id,
      '1140',
    );

    const total = toBookMoney(returnDocument.total);
    const originalSaleTotal = Number(sale?.total || 0);
    const originalSaleTax = Number(sale?.tax_amount || 0);
    const taxRatio = originalSaleTotal > 0 && originalSaleTax > 0 ? originalSaleTax / originalSaleTotal : 0;
    const returnTax = await queryable
      .selectFrom('return_items')
      .select([
        sql<number>`coalesce(sum(allocated_tax), 0)`.as('allocated_tax'),
        sql<number>`count(*) filter (where allocated_tax is null)`.as('unallocated_lines'),
      ])
      .where('return_document_id', '=', returnId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const taxAmount =
      Number(returnTax?.unallocated_lines || 0) === 0
        ? toBookMoney(returnTax?.allocated_tax || 0)
        : toBookMoney(total * taxRatio);
    const netReturnAmount = toBookMoney(Math.max(0, total - taxAmount));

    // R6-E (INV-REST-SALE-MONEY-TRUTH-2): relieve the tip /
    // courier-fee payables the original sale credited (Cr 2147 /
    // Cr 2115 in addSaleRevenueCreditLegs), pro-rata by the
    // returned net goods value over the sale's net goods base.
    // - Exclusive-tax base: subtotal - discount (the net goods
    //   value the customer paid; the discount rides Dr 4300).
    // - Tax-inclusive base: the SAME ex-tax goods leg postSale
    //   stripped — (subtotal + serviceCharge - tax) with the
    //   service share removed — net of the discount the return
    //   lines carry. Reusing the exclusive formula here would
    //   over-relieve (its subtotal still holds the embedded tax).
    //   A corrupt tax larger than the base keeps postSale's old
    //   single-line shape (no 2147/2115 legs exist), so no relief
    //   is owed either.
    // - Tip only when the sale credited one; courier only for a
    //   freelance delivery (NULL mode counts as freelance, as in
    //   addSaleRevenueCreditLegs). A store-fleet fee went to
    //   Cr 4200 revenue, which a return does not relieve either.
    // - FUNDING (decision, recorded): the relief is part of the
    //   REFUND — the customer is refunded the relieved shares on
    //   top of the return total, so the refund credit side below
    //   grows by tipRelief + courierRelief. The rejected shape
    //   (fund it by shrinking Dr 4400) misstates sales returns
    //   and under-refunds the customer; it is only correct if the
    //   business keeps the extras, in which case no relief is
    //   owed at all.
    // - CUMULATIVE CAP: this return's relief is capped at
    //   originalCredited - priorRelief (prior returns of the same
    //   sale, via priorSalesReturnRelief); without it two 60%
    //   returns relieve 120%.
    // R7-A (INV-REST-RETURN-PAYOUT-TRUTH) F1: the relief math lives
    // in computeSalesReturnRelief, shared with ReturnsService (which
    // needs the same numbers BEFORE its payout loop). The base /
    // funding / cumulative-cap rules are documented on that method.
    const { tipRelief, courierRelief, totalRelief } = await this.computeSalesReturnRelief(
      queryable,
      scope.tenantId,
      sale,
      total,
      netReturnAmount,
      returnId,
    );

    const customerPartnerId = sale?.customer_id ? Number(sale.customer_id) : null;
    // D-SF-02 (INV-SF-COD-CUSTODY-GL): a return of a dispatched COD
    // sale nets the courier custody leg, not the customer leg — the
    // receivable left the customer's books at dispatch, so a
    // customer-leg credit here would drive it negative while the
    // custody debit stands. The 'store_credit' tender is untouched.
    const saleInCourierCustody = sale?.id
      ? await this.hasDeliveryCustodyReclassification(queryable, Number(sale.id), auth)
      : false;
    // M12 (INV-REP-CUSTODY-LEDGER): a receivable-tender return of a
    // dispatched sale credits the SAME custody partner the dispatch
    // posted (deliveryCustodyPartner), so the per-rep balance nets.
    const custodyPartner =
      saleInCourierCustody && sale?.id ? await this.deliveryCustodyPartner(queryable, Number(sale.id)) : null;
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const branchId = returnDocument.branch_id ? Number(returnDocument.branch_id) : null;
    const locationId = returnDocument.location_id ? Number(returnDocument.location_id) : null;
    const invoiceNo = sale?.doc_no || returnDocument.doc_no || `Z-${returnDocument.invoice_id || ''}`;

    if (netReturnAmount > 0) {
      addBookLine({
        accountId: salesReturnsAccountId,
        description: `مردودات مبيعات للفاتورة رقم ${invoiceNo}`,
        debit: netReturnAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    if (taxAmount > 0) {
      addBookLine({
        accountId: salesTaxAccountId,
        description: `تخفيض ضريبة مبيعات من مرتجع فاتورة رقم ${invoiceNo}`,
        debit: taxAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    // R6-E (INV-REST-SALE-MONEY-TRUTH-2): the relief debits. The
    // accounts resolve lazily, only when their leg is non-zero, so
    // an ordinary return with no tip/fee creates no new accounts.
    // A return followed by a freelance settlement must not
    // double-relieve 2115: postDeliveryRepSettlement validates its
    // fee against the REMAINING courier fee (original minus prior
    // return relief), so the reduced amount settles and a stale
    // full-fee amount fails closed instead of over-relieving.
    if (tipRelief > 0) {
      const tipsAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2147');
      addBookLine({
        accountId: tipsAccountId,
        description: `تخفيض إكراميات مستحقة للموظفين من مرتجع فاتورة رقم ${invoiceNo}`,
        debit: tipRelief,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }
    if (courierRelief > 0) {
      const courierAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2115');
      addBookLine({
        accountId: courierAccountId,
        description: `تخفيض رسوم توصيل مستحقة لمندوب حر من مرتجع فاتورة رقم ${invoiceNo}`,
        debit: courierRelief,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    const settlementMode = String(returnDocument.settlement_mode || '')
      .trim()
      .toLowerCase();
    const refundMethod = String(returnDocument.refund_method || '')
      .trim()
      .toLowerCase();
    const originalSalePaymentType = String(sale?.payment_type || '')
      .trim()
      .toLowerCase();

    if (total > 0) {
      // R6-E (INV-REST-SALE-MONEY-TRUTH-2): the refund covers the
      // return total PLUS the relieved tip/courier shares (see the
      // funding decision above), so the refund target is
      // total + totalRelief and the allocations must sum to it.
      // Stored allocations are built by returns.service from the
      // return total PLUS the reliefs (R7-A F1), so a stored set
      // summing to the refund target is the normal case and is used
      // as-is. The in-memory top-up below survives only as the
      // fallback for documents stored before that fix (whose
      // allocations sum to the return total alone) and for
      // exchange-collected lines (whose stored set is the prepared
      // total); anything else fails closed below. The stored
      // document itself is not rewritten here.
      const refundTarget = toBookMoney(total + totalRelief);
      const allocations = refundAllocations ?? [
        {
          tender:
            settlementMode === 'store_credit'
              ? 'store_credit'
              : originalSalePaymentType === 'credit'
                ? 'receivable'
                : refundMethod === 'cash'
                  ? 'cash'
                  : 'card',
          amount: refundTarget,
        },
      ];
      let effectiveAllocations = allocations;
      if (refundAllocations && totalRelief > 0) {
        const storedSum = toBookMoney(allocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0));
        if (Math.abs(storedSum - refundTarget) <= this.maxAllowedDifference(bookDigits)) {
          effectiveAllocations = allocations;
        } else if (Math.abs(storedSum - total) <= this.maxAllowedDifference(bookDigits)) {
          effectiveAllocations = allocations.map((entry, index) =>
            index === allocations.length - 1
              ? { ...entry, amount: toBookMoney(Number(entry.amount || 0) + totalRelief) }
              : entry,
          );
        }
      }
      const rawAllocated = effectiveAllocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      if (Math.abs(rawAllocated - refundTarget) > this.maxAllowedDifference(bookDigits)) {
        throw new Error(
          `Refund tenders do not balance for return ${returnId}: allocated=${rawAllocated} total=${refundTarget}`,
        );
      }
      let allocatedTotalSoFar = 0;
      for (let i = 0; i < effectiveAllocations.length; i++) {
        const allocation = effectiveAllocations[i];
        const isLast = i === effectiveAllocations.length - 1;
        const lineAmount = isLast ? toBookMoney(refundTarget - allocatedTotalSoFar) : toBookMoney(allocation.amount);
        allocatedTotalSoFar = toBookMoney(allocatedTotalSoFar + lineAmount);
        const accountId =
          allocation.tender === 'store_credit'
            ? storeCreditAccountId
            : allocation.tender === 'receivable'
              ? customerAccountId
              : allocation.tender === 'cash'
                ? cashAccountId
                : bankAccountId;
        const partner = allocation.tender === 'store_credit' || allocation.tender === 'receivable';
        const custodyReceivable = allocation.tender === 'receivable' && saleInCourierCustody;
        addBookLine({
          accountId,
          description: `تسوية مرتجع فاتورة رقم ${invoiceNo} - ${allocation.tender}`,
          debit: 0,
          credit: lineAmount,
          partnerType:
            custodyReceivable && custodyPartner
              ? custodyPartner.partnerType
              : partner && customerPartnerId
                ? 'customer'
                : 'none',
          partnerId:
            custodyReceivable && custodyPartner ? custodyPartner.partnerId : partner ? customerPartnerId : null,
          branchId,
          locationId,
        });
      }
    }

    // Reliable cost source for return COGS reversal: original sale_items.cost_price at sale time.
    const returnItems = await queryable
      .selectFrom('return_items')
      .select(['product_id', 'sale_item_id', 'qty', 'cost_price'])
      .where('return_document_id', '=', returnId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const saleItems = sale?.id
      ? await queryable
          .selectFrom('sale_items')
          .select(['id', 'product_id', 'cost_price', 'unit_multiplier', 'modifiers'])
          .where('sale_id', '=', Number(sale.id))
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .execute()
      : [];

    // INV-SALES-RETURN-COGS-RESIDUAL-MIRROR: reverse COGS on the same
    // residual basis the sale posted it; the legacy plain product is
    // kept for every shape the mirror does not cover (see
    // salesReturnCogsAmount).
    const inventoryReversalAmount = toBookMoney(
      await this.salesReturnCogsAmount(
        queryable,
        scope.tenantId,
        sale ? { id: Number(sale.id) } : null,
        returnItems,
        saleItems,
        bookDigits,
      ),
    );

    if (inventoryReversalAmount > 0) {
      addBookLine({
        accountId: inventoryAccountId,
        description: `إرجاع المخزون من مرتجع فاتورة رقم ${invoiceNo}`,
        debit: inventoryReversalAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: cogsAccountId,
        description: `عكس تكلفة البضاعة المباعة لمرتجع فاتورة رقم ${invoiceNo}`,
        debit: 0,
        credit: inventoryReversalAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    const accountMap = await this.getActiveAccountMap(
      queryable,
      scope.tenantId,
      lines.map((line) => line.accountId),
    );
    for (const line of lines) {
      if (!(line.accountId > 0))
        throw new Error(`Invalid accounting setting account id while posting sales return ${returnId}`);
      if (!accountMap.has(line.accountId))
        throw new Error(`Configured account ${line.accountId} was not found while posting sales return ${returnId}`);
      if (!accountMap.get(line.accountId))
        throw new Error(`Configured account ${line.accountId} is inactive while posting sales return ${returnId}`);
    }

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(
        `Unbalanced sales return journal for return ${returnId}: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    if (collectExchangeLines) {
      // R7-A F3: record the relief this exchange collected on the
      // return row (migration 0311), so a later return's cumulative
      // cap counts it via priorSalesReturnRelief. The return has no
      // journal of its own — these columns are its only record.
      await queryable
        .updateTable('return_documents')
        .set({
          exchange_tip_relief: tipRelief,
          exchange_courier_relief: courierRelief,
        })
        .where('id', '=', returnId)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      collectExchangeLines(normalizedLines);
      return { posted: false, journalEntryId: null };
    }
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sales_return',
      sourceId: returnId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: returnDocument.created_at ? new Date(returnDocument.created_at) : new Date(),
      description: `قيد مرتجع بيع للفاتورة رقم ${invoiceNo}`,
      branchId,
      locationId,
      createdBy: returnDocument.created_by ? Number(returnDocument.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }
}
