import type { Transaction } from 'kysely';
import { sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { cogsResidualAmount } from '../../engines/cogs-residual.engine';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { SalesAndReturnsPostingDeps } from './sales-returns-posting-types';
import type { SaleCogsResidualService } from './sale-cogs-residual';
import type { PostSaleService } from './post-sale';
import type { ReverseSaleJournalService } from './reverse-sale-journal';
import type { PostSalesReturnService } from './post-sales-return';

export class PostSaleEditService {
  constructor(
    private readonly toMoney: SalesAndReturnsPostingDeps['toMoney'],
    private readonly assertTransaction: SalesAndReturnsPostingDeps['assertTransaction'],
    private readonly getTenantAccountingSettings: SalesAndReturnsPostingDeps['getTenantAccountingSettings'],
    private readonly resolveAccountWithFallback: SalesAndReturnsPostingDeps['resolveAccountWithFallback'],
    private readonly addLine: SalesAndReturnsPostingDeps['addLine'],
    private readonly getActiveAccountMap: SalesAndReturnsPostingDeps['getActiveAccountMap'],
    private readonly maxAllowedDifference: SalesAndReturnsPostingDeps['maxAllowedDifference'],
    private readonly insertPostedJournal: SalesAndReturnsPostingDeps['insertPostedJournal'],
    private readonly residualCogsGroups: SaleCogsResidualService['residualCogsGroups'],
    private readonly saleCogsResidual: SaleCogsResidualService['saleCogsResidual'],
    private readonly addSaleRevenueCreditLegs: PostSaleService['addSaleRevenueCreditLegs'],
    private readonly reverseSaleJournal: ReverseSaleJournalService['reverseSaleJournal'],
    private readonly postSalesReturn: PostSalesReturnService['postSalesReturn'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  async postSaleEdit(
    queryable: Transaction<Database>,
    saleId: number,
    auth: AuthContext,
    reason?: string,
    options?: {
      preparedWaste?: {
        oldItems: Array<{
          id: number;
          product_id: number | null;
          qty: number | string;
          cost_price: number | string | null;
          unit_multiplier: number | string | null;
          modifiers: unknown;
        }>;
        restoredQtyBySaleItemId: Map<number, number>;
      };
    },
  ): Promise<{ posted: boolean; journalEntryId: number }> {
    this.assertTransaction(queryable, 'postSaleEdit');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // Count postings vs reversals for this sale so we handle already-reversed states
    const counts = await queryable
      .selectFrom('journal_entries')
      .select([
        sql<number>`count(*) filter (where source_type in ('sale', 'sale_edit'))`.as('postings'),
        sql<number>`count(*) filter (where source_type = 'sale_reversal')`.as('reversals'),
      ])
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const totalPostings = Number(counts?.postings || 0);
    const totalReversals = Number(counts?.reversals || 0);
    const activePostings = totalPostings - totalReversals;

    if (totalPostings > 0 && activePostings <= 0) {
      throw new AppError('لا يمكن ترحيل تعديل لفاتورة ملغاة ومعكوسة بالكامل', 'SALE_ALREADY_REVERSED', 400);
    }

    if (activePostings > 0) {
      const reversalReason = reason ? `تعديل فاتورة: ${reason}` : 'تعديل فاتورة مبيعات';
      // INV-SALE-EDIT-PREPARED-WASTE: exclude the consumed portion's
      // residual COGS from the reversal, so the waste cost stays posted
      // exactly as cancelSale's full exclusion keeps it. Both residual
      // evaluations read the same post-movement remaining stock, so a
      // kept line excludes zero and a removed line excludes its full
      // old residual.
      let preparedWasteCogsExclusion = 0;
      if (options?.preparedWaste) {
        const { oldItems, restoredQtyBySaleItemId } = options.preparedWaste;
        const oldGroups = await this.residualCogsGroups(queryable, scope.tenantId, oldItems, null);
        const restoredItems = oldItems.map((oldItem) => ({
          ...oldItem,
          qty: Number(restoredQtyBySaleItemId.get(Number(oldItem.id)) || 0),
        }));
        const restoredGroups = await this.residualCogsGroups(queryable, scope.tenantId, restoredItems, null);
        preparedWasteCogsExclusion = Math.max(
          0,
          toBookMoney(cogsResidualAmount(oldGroups, bookDigits) - cogsResidualAmount(restoredGroups, bookDigits)),
        );
      }
      const reversal = await this.reverseSaleJournal(
        queryable,
        saleId,
        reversalReason,
        auth,
        preparedWasteCogsExclusion > 0 ? { preparedWasteCogsExclusion } : undefined,
      );
      if (!reversal.reversed && reversal.journalEntryId == null) {
        throw new AppError('تعذر عكس قيد المبيعات السابق للفاتورة المعدلة', 'SALE_EDIT_REVERSAL_FAILED', 409);
      }
    }

    const sale = await queryable
      .selectFrom('sales')
      .select([
        'id',
        'doc_no',
        'customer_id',
        'subtotal',
        'discount',
        'tax_amount',
        'total',
        'paid_amount',
        'store_credit_used',
        'exchange_return_id',
        'branch_id',
        'location_id',
        'created_by',
        'created_at',
        'delivery_fee',
        'delivery_fee_mode',
        'service_charge',
        'tip_amount',
        'prices_include_tax',
        'sale_origin',
        'payment_type',
      ])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirstOrThrow();

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting edited sale ${saleId}`);

    const payments = await queryable
      .selectFrom('sale_payments')
      .select(['payment_channel', 'amount'])
      .where('sale_id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const cashAmount = toBookMoney(
      payments
        .filter((row) => String(row.payment_channel || '') === 'cash')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    );
    const nonCashAmount = toBookMoney(
      payments
        .filter((row) => String(row.payment_channel || '') !== 'cash')
        .reduce((sum, row) => sum + Number(row.amount || 0), 0),
    );

    const subtotal = toBookMoney(sale.subtotal);
    const discount = toBookMoney(sale.discount);
    const taxAmount = toBookMoney(sale.tax_amount);
    const deliveryFee = toBookMoney((sale as any).delivery_fee ?? 0);
    const serviceCharge = toBookMoney((sale as any).service_charge ?? 0);
    const tipAmount = toBookMoney((sale as any).tip_amount ?? 0);
    const paidAmount = toBookMoney(sale.paid_amount);
    const storeCreditUsed = toBookMoney(sale.store_credit_used);
    const saleTotal = toBookMoney(sale.total);
    const receivableAmount = toBookMoney(Math.max(0, saleTotal - paidAmount - storeCreditUsed));
    const revenueCredit = sale.prices_include_tax
      ? toBookMoney(subtotal + serviceCharge - taxAmount + deliveryFee + tipAmount)
      : toBookMoney(subtotal + serviceCharge + deliveryFee + tipAmount);

    const lines: JournalLineDraft[] = [];
    const customerPartnerId = sale.customer_id ? Number(sale.customer_id) : null;

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
      storeCreditUsed > 0 ? await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '2150') : 0;
    const salesDiscountAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.sales_discount_account_id,
      '4300',
    );
    const salesRevenueAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.sales_revenue_account_id,
      '4100',
    );
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

    if (cashAmount > 0) {
      this.addLine(
        lines,
        {
          accountId: cashAccountId,
          description: 'تحصيل نقدي من تعديل فاتورة بيع',
          debit: cashAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
        },
        bookDigits,
      );
    }

    if (nonCashAmount > 0) {
      this.addLine(
        lines,
        {
          accountId: bankAccountId,
          description: 'تحصيل غير نقدي من تعديل فاتورة بيع',
          debit: nonCashAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
        },
        bookDigits,
      );
    }

    if (receivableAmount > 0) {
      const isVanSale = String((sale as any).sale_origin || '') === 'van_sale';
      const paymentType = String((sale as any).payment_type || '');
      const branchIdVal = sale.branch_id ? Number(sale.branch_id) : null;
      const locationIdVal = sale.location_id ? Number(sale.location_id) : null;

      if (isVanSale && paymentType === 'cash') {
        this.addLine(
          lines,
          {
            accountId: customerAccountId,
            description: 'عهدة نقدية لدى مندوب التوزيع من تعديل فاتورة بيع نقدي',
            debit: receivableAmount,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: branchIdVal,
            locationId: locationIdVal,
          },
          bookDigits,
        );
      } else if (isVanSale && paymentType === 'split') {
        const creditLedgerRow = await (queryable as any)
          .selectFrom('customer_ledger')
          .select(['amount'])
          .where('reference_type', '=', 'sale')
          .where('reference_id', '=', saleId)
          .where('entry_type', '=', 'sale_credit')
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        const creditPortion = toBookMoney(
          Math.min(receivableAmount, Math.max(0, Number(creditLedgerRow?.amount || 0))),
        );
        const repCashPortion = toBookMoney(Math.max(0, receivableAmount - creditPortion));

        if (repCashPortion > 0) {
          this.addLine(
            lines,
            {
              accountId: customerAccountId,
              description: 'عهدة نقدية لدى مندوب التوزيع (الجزء النقدي من تعديل بيع مجزأ)',
              debit: repCashPortion,
              credit: 0,
              partnerType: 'none',
              partnerId: null,
              branchId: branchIdVal,
              locationId: locationIdVal,
            },
            bookDigits,
          );
        }
        if (creditPortion > 0) {
          this.addLine(
            lines,
            {
              accountId: customerAccountId,
              description: 'مديونية عميل من تعديل فاتورة بيع مجزأة',
              debit: creditPortion,
              credit: 0,
              partnerType: customerPartnerId ? 'customer' : 'none',
              partnerId: customerPartnerId,
              branchId: branchIdVal,
              locationId: locationIdVal,
            },
            bookDigits,
          );
        }
      } else {
        this.addLine(
          lines,
          {
            accountId: customerAccountId,
            description: 'مديونية عميل من تعديل فاتورة بيع',
            debit: receivableAmount,
            credit: 0,
            partnerType: customerPartnerId ? 'customer' : 'none',
            partnerId: customerPartnerId,
            branchId: branchIdVal,
            locationId: locationIdVal,
          },
          bookDigits,
        );
      }
    }

    if (storeCreditUsed > 0) {
      this.addLine(
        lines,
        {
          accountId: storeCreditAccountId,
          description: 'استخدام رصيد دائن للعميل في تعديل الفاتورة',
          debit: storeCreditUsed,
          credit: 0,
          partnerType: customerPartnerId ? 'customer' : 'none',
          partnerId: customerPartnerId,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
        },
        bookDigits,
      );
    }

    if (discount > 0) {
      this.addLine(
        lines,
        {
          accountId: salesDiscountAccountId,
          description: 'خصم مبيعات على تعديل الفاتورة',
          debit: discount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
        },
        bookDigits,
      );
    }

    if (revenueCredit > 0) {
      await this.addSaleRevenueCreditLegs(
        queryable,
        scope.tenantId,
        (line) => this.addLine(lines, line, bookDigits),
        {
          subtotal,
          taxAmount,
          deliveryFee,
          deliveryFeeMode: (sale as any).delivery_fee_mode,
          serviceCharge,
          tipAmount,
          pricesIncludeTax: Boolean(sale.prices_include_tax),
          revenueCredit,
          goodsAccountId: salesRevenueAccountId,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
          contextLabel: 'تعديل فاتورة بيع',
        },
        bookDigits,
      );
    }

    if (taxAmount > 0) {
      this.addLine(
        lines,
        {
          accountId: salesTaxAccountId,
          description: 'ضريبة مبيعات مستحقة من تعديل الفاتورة',
          debit: 0,
          credit: taxAmount,
          partnerType: 'none',
          partnerId: null,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
        },
        bookDigits,
      );
    }

    // Same remainder-absorbed residual as postSale
    // (INV-COGS-REMAINDER-ABSORPTION): the edited sale re-posts
    // against the stock remaining after the edit's movement.
    const cogsAmount = toBookMoney(await this.saleCogsResidual(queryable, scope.tenantId, saleId, bookDigits));

    if (cogsAmount > 0) {
      this.addLine(
        lines,
        {
          accountId: cogsAccountId,
          description: 'تكلفة البضاعة المباعة بعد تعديل البيع',
          debit: cogsAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
        },
        bookDigits,
      );
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: 'إخراج مخزون بعد تعديل البيع',
          debit: 0,
          credit: cogsAmount,
          partnerType: 'none',
          partnerId: null,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
        },
        bookDigits,
      );
    }

    const accountMap = await this.getActiveAccountMap(
      queryable,
      scope.tenantId,
      lines.map((line) => line.accountId),
    );
    for (const line of lines) {
      if (!(line.accountId > 0))
        throw new Error(`Invalid accounting setting account id while posting edited sale ${saleId}`);
      if (!accountMap.has(line.accountId))
        throw new Error(`Configured account ${line.accountId} was not found while posting edited sale ${saleId}`);
      if (!accountMap.get(line.accountId))
        throw new Error(`Configured account ${line.accountId} is inactive while posting edited sale ${saleId}`);
    }

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced edited sale journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    if (sale.exchange_return_id) {
      let returnLinesCollected = false;
      const returnPosting = await this.postSalesReturn(
        queryable,
        Number(sale.exchange_return_id),
        auth,
        (returnLines) => {
          returnLinesCollected = returnLines.length > 0;
          normalizedLines.push(...returnLines);
        },
      );
      if (!returnLinesCollected || returnPosting.posted || returnPosting.journalEntryId != null) {
        throw new AppError('مرتجع الاستبدال مرتبط بقيد مستقل؛ يلزم تسوية يدوية', 'EXCHANGE_LEDGER_CONFLICT', 422);
      }
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale_edit',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد تعديل بيع تلقائي للفاتورة رقم ${sale.doc_no || `Z-${saleId}`}`,
      branchId: sale.branch_id ? Number(sale.branch_id) : null,
      locationId: sale.location_id ? Number(sale.location_id) : null,
      createdBy: sale.created_by ? Number(sale.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }
}
