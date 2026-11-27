import type { Transaction } from 'kysely';
import { sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { currencyMoneyDigits, type MoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { SalesAndReturnsPostingDeps } from './sales-returns-posting-types';
import type { SaleCogsResidualService } from './sale-cogs-residual';
import type { PostSalesReturnService } from './post-sales-return';

export class PostSaleService {
  constructor(
    private readonly toMoney: SalesAndReturnsPostingDeps['toMoney'],
    private readonly resolveSystemAccountByCode: SalesAndReturnsPostingDeps['resolveSystemAccountByCode'],
    private readonly assertTransaction: SalesAndReturnsPostingDeps['assertTransaction'],
    private readonly getExistingSaleJournal: SalesAndReturnsPostingDeps['getExistingSaleJournal'],
    private readonly getTenantAccountingSettings: SalesAndReturnsPostingDeps['getTenantAccountingSettings'],
    private readonly addLine: SalesAndReturnsPostingDeps['addLine'],
    private readonly resolveAccountWithFallback: SalesAndReturnsPostingDeps['resolveAccountWithFallback'],
    private readonly getActiveAccountMap: SalesAndReturnsPostingDeps['getActiveAccountMap'],
    private readonly maxAllowedDifference: SalesAndReturnsPostingDeps['maxAllowedDifference'],
    private readonly insertPostedJournal: SalesAndReturnsPostingDeps['insertPostedJournal'],
    private readonly saleCogsResidual: SaleCogsResidualService['saleCogsResidual'],
    private readonly postSalesReturn: PostSalesReturnService['postSalesReturn'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  /**
   * R4-A (INV-REST-SALE-MONEY-TRUTH): split the old single sale-revenue
   * credit into its true legs. Used by BOTH postSale and postSaleEdit
   * — the duplicated formula across the two functions was itself a
   * root cause, so the split lives here exactly once.
   *
   * Exclusive-tax case: Cr 4100 = subtotal; Cr 4200 = service charge
   * (+ the delivery fee when the store's own fleet delivered it);
   * Cr 2115 = delivery fee when a freelance courier delivered it
   * (a NULL stored mode defaults to freelance, matching the
   * sales writer's default); Cr 2147 = tip. The legs sum exactly
   * to the old single revenueCredit, so the journal balance is
   * preserved by construction.
   *
   * Tax-inclusive case: the same legs, but the tax embedded in the
   * goods + service-charge base is stripped pro-rata (residual to
   * 4100). The ex-tax base is (subtotal + serviceCharge) - taxAmount
   * — the discount is deliberately NOT netted here: it is carried
   * by the separate Dr 4300 leg, so netting it would double-count
   * it and unbalance the journal by the discount. (A corrupt tax
   * larger than the base keeps the old single-line shape so the
   * journal still balances instead of throwing on a negative leg.)
   *
   * The 4200/2115/2147 accounts resolve lazily, only when their leg
   * is non-zero, so an ordinary sale with no extras creates no new
   * accounts. 4200 is NOT auto-created: it is seeded by the COA
   * migration (as postService already assumes); 2115/2147
   * auto-create from the knownAccounts map above.
   */
  async addSaleRevenueCreditLegs(
    queryable: DbOrTx,
    tenantId: string,
    add: (line: JournalLineDraft) => void,
    input: {
      subtotal: number;
      taxAmount: number;
      deliveryFee: number;
      deliveryFeeMode: string | null | undefined;
      serviceCharge: number;
      tipAmount: number;
      pricesIncludeTax: boolean;
      revenueCredit: number;
      goodsAccountId: number;
      branchId: number | null;
      locationId: number | null;
      contextLabel: string;
    },
    bookDigits: MoneyDigits,
  ): Promise<void> {
    const { subtotal, taxAmount, deliveryFee, serviceCharge, tipAmount } = input;
    const isStoreFleet = String(input.deliveryFeeMode || '').trim() === 'store_fleet';
    const deliveryPayable = isStoreFleet ? 0 : deliveryFee;
    const deliveryRevenue = isStoreFleet ? deliveryFee : 0;

    let legs: { goods: number; service: number; deliveryPayable: number; deliveryRevenue: number; tip: number };
    if (input.pricesIncludeTax) {
      const base = this.toMoney(subtotal + serviceCharge - taxAmount, bookDigits);
      const denom = subtotal + serviceCharge;
      if (base < 0) {
        legs = { goods: input.revenueCredit, service: 0, deliveryPayable: 0, deliveryRevenue: 0, tip: 0 };
      } else {
        const serviceLeg = denom > 0 ? this.toMoney((base * serviceCharge) / denom, bookDigits) : 0;
        legs = {
          goods: this.toMoney(base - serviceLeg, bookDigits),
          service: serviceLeg,
          deliveryPayable,
          deliveryRevenue,
          tip: tipAmount,
        };
      }
    } else {
      legs = { goods: subtotal, service: serviceCharge, deliveryPayable, deliveryRevenue, tip: tipAmount };
    }

    const scope = {
      partnerType: 'none' as const,
      partnerId: null,
      branchId: input.branchId,
      locationId: input.locationId,
    };
    if (legs.goods > 0) {
      add({
        accountId: input.goodsAccountId,
        description: `إيراد مبيعات ${input.contextLabel}`,
        debit: 0,
        credit: legs.goods,
        ...scope,
      });
    }
    if (legs.service > 0 || legs.deliveryRevenue > 0) {
      const serviceAccountId = await this.resolveSystemAccountByCode(queryable, tenantId, '4200');
      if (legs.service > 0) {
        add({
          accountId: serviceAccountId,
          description: `رسم خدمة ${input.contextLabel}`,
          debit: 0,
          credit: legs.service,
          ...scope,
        });
      }
      if (legs.deliveryRevenue > 0) {
        add({
          accountId: serviceAccountId,
          description: `إيراد رسوم توصيل ${input.contextLabel}`,
          debit: 0,
          credit: legs.deliveryRevenue,
          ...scope,
        });
      }
    }
    if (legs.deliveryPayable > 0) {
      const courierAccountId = await this.resolveSystemAccountByCode(queryable, tenantId, '2115');
      add({
        accountId: courierAccountId,
        description: `رسوم توصيل مستحقة لمندوب حر ${input.contextLabel}`,
        debit: 0,
        credit: legs.deliveryPayable,
        ...scope,
      });
    }
    if (legs.tip > 0) {
      const tipsAccountId = await this.resolveSystemAccountByCode(queryable, tenantId, '2147');
      add({
        accountId: tipsAccountId,
        description: `إكراميات مستحقة للموظفين ${input.contextLabel}`,
        debit: 0,
        credit: legs.tip,
        ...scope,
      });
    }
  }

  async postSale(
    queryable: Transaction<Database>,
    saleId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number }> {
    this.assertTransaction(queryable, 'postSale');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSaleJournal(queryable, saleId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

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
        'collection_status',
      ])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirstOrThrow();

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting sale ${saleId}`);

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
    const deliveryFee = toBookMoney(sale.delivery_fee ?? 0);
    const serviceCharge = toBookMoney(sale.service_charge ?? 0);
    const tipAmount = toBookMoney(sale.tip_amount ?? 0);
    const paidAmount = toBookMoney(sale.paid_amount);
    const storeCreditUsed = toBookMoney(sale.store_credit_used);
    const saleTotal = toBookMoney(sale.total);
    const receivableAmount = toBookMoney(Math.max(0, saleTotal - paidAmount - storeCreditUsed));
    const revenueCredit = sale.prices_include_tax
      ? toBookMoney(subtotal + serviceCharge - taxAmount + deliveryFee + tipAmount)
      : toBookMoney(subtotal + serviceCharge + deliveryFee + tipAmount);

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const customerPartnerId = sale.customer_id ? Number(sale.customer_id) : null;

    // Batch-resolve all sale posting accounts + fallback codes in one SQL query
    // instead of 9 sequential resolveAccountWithFallback round-trips.
    const configuredAccountIds = Array.from(
      new Set(
        [
          settings.cash_account_id,
          settings.bank_account_id,
          settings.customer_receivable_account_id,
          settings.sales_discount_account_id,
          settings.sales_revenue_account_id,
          settings.sales_tax_account_id,
          settings.cogs_account_id,
          settings.inventory_account_id,
        ]
          .map((id) => Number(id || 0))
          .filter((id) => id > 0),
      ),
    );
    const fallbackAccountCodes = [
      '1110',
      '1120',
      '1130',
      ...(storeCreditUsed > 0 ? ['2150'] : []),
      '4300',
      '4100',
      '2120',
      '5100',
      '1140',
    ];
    const prefetchedAccounts = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'is_active'])
      .where('tenant_id', '=', scope.tenantId)
      .where((eb) =>
        configuredAccountIds.length > 0
          ? eb.or([eb('id', 'in', configuredAccountIds), eb('code', 'in', fallbackAccountCodes)])
          : eb('code', 'in', fallbackAccountCodes),
      )
      .execute();

    const activeById = new Map<number, boolean>();
    const activeIdByCode = new Map<string, number>();
    for (const row of prefetchedAccounts) {
      const id = Number(row.id);
      const isActive = Boolean(row.is_active);
      activeById.set(id, isActive);
      if (isActive && row.code && !activeIdByCode.has(String(row.code))) {
        activeIdByCode.set(String(row.code), id);
      }
    }
    const resolvePrefetchedAccount = (configuredId: number | null | undefined, fallbackCode: string): number => {
      const numericId = Number(configuredId || 0);
      if (numericId > 0 && activeById.get(numericId) === true) {
        return numericId;
      }
      const fallbackId = activeIdByCode.get(fallbackCode);
      if (fallbackId) return fallbackId;
      return numericId;
    };

    const cashAccountId = resolvePrefetchedAccount(settings.cash_account_id, '1110');
    const bankAccountId = resolvePrefetchedAccount(settings.bank_account_id, '1120');
    const customerAccountId = resolvePrefetchedAccount(settings.customer_receivable_account_id, '1130');
    const storeCreditAccountId = storeCreditUsed > 0 ? resolvePrefetchedAccount(null, '2150') : 0;
    const salesDiscountAccountId = resolvePrefetchedAccount(settings.sales_discount_account_id, '4300');
    const salesRevenueAccountId = resolvePrefetchedAccount(settings.sales_revenue_account_id, '4100');
    const salesTaxAccountId = resolvePrefetchedAccount(settings.sales_tax_account_id, '2120');
    const cogsAccountId = resolvePrefetchedAccount(settings.cogs_account_id, '5100');
    const inventoryAccountId = resolvePrefetchedAccount(settings.inventory_account_id, '1140');

    if (cashAmount > 0) {
      addBookLine({
        accountId: cashAccountId,
        description: 'تحصيل نقدي من فاتورة بيع',
        debit: cashAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    if (nonCashAmount > 0) {
      addBookLine({
        accountId: bankAccountId,
        description: 'تحصيل غير نقدي من فاتورة بيع',
        debit: nonCashAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    if (receivableAmount > 0) {
      const isVanSale = String(sale.sale_origin || '') === 'van_sale';
      const paymentType = String(sale.payment_type || '');
      const branchIdVal = sale.branch_id ? Number(sale.branch_id) : null;
      const locationIdVal = sale.location_id ? Number(sale.location_id) : null;

      if (isVanSale && paymentType === 'cash') {
        // Cash collected in the field sits in rep custody (partnerType: 'none') until settleTrip clears it.
        // Even if customer_id is set on the invoice, the customer does not owe a receivable.
        addBookLine({
          accountId: customerAccountId,
          description: 'عهدة نقدية لدى مندوب التوزيع من فاتورة بيع نقدي',
          debit: receivableAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: branchIdVal,
          locationId: locationIdVal,
        });
      } else if (isVanSale && paymentType === 'split') {
        const creditLedgerRow = await queryable
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
          addBookLine({
            accountId: customerAccountId,
            description: 'عهدة نقدية لدى مندوب التوزيع (الجزء النقدي من فاتورة مجزأة)',
            debit: repCashPortion,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: branchIdVal,
            locationId: locationIdVal,
          });
        }
        if (creditPortion > 0) {
          addBookLine({
            accountId: customerAccountId,
            description: 'مديونية عميل من فاتورة بيع مجزأة',
            debit: creditPortion,
            credit: 0,
            partnerType: customerPartnerId ? 'customer' : 'none',
            partnerId: customerPartnerId,
            branchId: branchIdVal,
            locationId: locationIdVal,
          });
        }
      } else {
        addBookLine({
          accountId: customerAccountId,
          description: 'مديونية عميل من فاتورة بيع',
          debit: receivableAmount,
          credit: 0,
          partnerType: customerPartnerId ? 'customer' : 'none',
          partnerId: customerPartnerId,
          branchId: branchIdVal,
          locationId: locationIdVal,
        });
      }
    }

    if (storeCreditUsed > 0) {
      addBookLine({
        accountId: storeCreditAccountId,
        description: 'استخدام رصيد دائن للعميل (Store Credit)',
        debit: storeCreditUsed,
        credit: 0,
        partnerType: customerPartnerId ? 'customer' : 'none',
        partnerId: customerPartnerId,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    if (discount > 0) {
      addBookLine({
        accountId: salesDiscountAccountId,
        description: 'خصم مبيعات على الفاتورة',
        debit: discount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    if (revenueCredit > 0) {
      await this.addSaleRevenueCreditLegs(
        queryable,
        scope.tenantId,
        addBookLine,
        {
          subtotal,
          taxAmount,
          deliveryFee,
          deliveryFeeMode: sale.delivery_fee_mode,
          serviceCharge,
          tipAmount,
          pricesIncludeTax: Boolean(sale.prices_include_tax),
          revenueCredit,
          goodsAccountId: salesRevenueAccountId,
          branchId: sale.branch_id ? Number(sale.branch_id) : null,
          locationId: sale.location_id ? Number(sale.location_id) : null,
          contextLabel: 'الفاتورة',
        },
        bookDigits,
      );
    }

    if (taxAmount > 0) {
      addBookLine({
        accountId: salesTaxAccountId,
        description: 'ضريبة مبيعات مستحقة',
        debit: 0,
        credit: taxAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    // Reliable COGS source: sale_items.cost_price captured at sale time.
    // In this codebase, sale_items.cost_price is stored per sold unit (already adjusted by unit_multiplier),
    // so do not multiply by unit_multiplier again here. The amount is
    // the remainder-absorbed residual (INV-COGS-REMAINDER-ABSORPTION):
    // pre-sale stock value minus remaining stock value at book digits.
    const cogsAmount = toBookMoney(await this.saleCogsResidual(queryable, scope.tenantId, saleId, bookDigits));

    if (cogsAmount > 0) {
      addBookLine({
        accountId: cogsAccountId,
        description: 'تكلفة البضاعة المباعة',
        debit: cogsAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
      addBookLine({
        accountId: inventoryAccountId,
        description: 'إخراج مخزون مقابل المبيعات',
        debit: 0,
        credit: cogsAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
    }

    const uncheckedAccountIds = lines.map((line) => line.accountId).filter((id) => id > 0 && !activeById.has(id));
    if (uncheckedAccountIds.length > 0) {
      const extraMap = await this.getActiveAccountMap(queryable, scope.tenantId, uncheckedAccountIds);
      for (const [id, active] of extraMap.entries()) {
        activeById.set(id, active);
      }
    }
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting sale ${saleId}`);
      if (!activeById.has(line.accountId))
        throw new Error(`Configured account ${line.accountId} was not found while posting sale ${saleId}`);
      if (!activeById.get(line.accountId))
        throw new Error(`Configured account ${line.accountId} is inactive while posting sale ${saleId}`);
    }

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced sale journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
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
      sourceType: 'sale',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: sale.created_at ? new Date(sale.created_at) : new Date(),
      description: `قيد بيع تلقائي للفاتورة رقم ${sale.doc_no || `Z-${saleId}`}`,
      branchId: sale.branch_id ? Number(sale.branch_id) : null,
      locationId: sale.location_id ? Number(sale.location_id) : null,
      createdBy: sale.created_by ? Number(sale.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }
}
