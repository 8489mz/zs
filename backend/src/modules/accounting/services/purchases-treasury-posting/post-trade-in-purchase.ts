import type { Transaction } from 'kysely';
import { sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { partitionPurchaseLineTotals } from '../../../../common/utils/purchase-line-totals.helper';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, toMinorUnits, fromMinorUnits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting-types';

export class PostTradeInPurchaseService {
  constructor(
    private readonly assertTransaction: PurchasesAndTreasuryPostingDeps['assertTransaction'],
    private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'],
    private readonly getTenantAccountingSettings: PurchasesAndTreasuryPostingDeps['getTenantAccountingSettings'],
    private readonly addLine: PurchasesAndTreasuryPostingDeps['addLine'],
    private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'],
    private readonly postDomainJournal: PurchasesAndTreasuryPostingDeps['postDomainJournal'],
    private readonly resolveSystemAccountByCode: PurchasesAndTreasuryPostingDeps['resolveSystemAccountByCode'],
    private readonly resolveAccountWithFallback: PurchasesAndTreasuryPostingDeps['resolveAccountWithFallback'],
    private readonly getActiveAccountMap: PurchasesAndTreasuryPostingDeps['getActiveAccountMap'],
    private readonly maxAllowedDifference: PurchasesAndTreasuryPostingDeps['maxAllowedDifference'],
    private readonly logger: PurchasesAndTreasuryPostingDeps['logger'],
    private readonly getExistingPurchaseJournal: PurchasesAndTreasuryPostingDeps['getExistingPurchaseJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  /**
   * A trade-in is an inventory acquisition, not an operating expense.
   * Require the physical unit and the matching cash movement in the SAME
   * transaction before releasing a balanced immutable acquisition journal.
   */
  async postTradeInCashPurchase(queryable: DbOrTx, tradeInId: number, auth: AuthContext): Promise<number | null> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const source = await queryable
      .selectFrom('trade_in_transactions')
      .select([
        'id',
        'agreed_purchase_price',
        'transaction_type',
        'payment_method',
        'created_product_id',
        'branch_id',
        'location_id',
        'created_at',
      ])
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', tradeInId)
      .executeTakeFirst();
    if (!source) throw new AppError('Trade-in document not found for posting', 'TRADEIN_SOURCE_NOT_FOUND', 404);
    const sourceDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = fromMinorUnits(toMinorUnits(Number(source.agreed_purchase_price), sourceDigits), sourceDigits);
    if (amount < 0) throw new AppError('Invalid trade-in cost', 'TRADEIN_COST_INVALID', 400);
    if (amount === 0) return null;
    const paymentMethod = source.payment_method || 'cash';
    if (
      source.transaction_type !== 'cash_purchase' ||
      !['cash', 'bank'].includes(paymentMethod) ||
      !source.created_product_id
    ) {
      throw new AppError(
        'Trade-in requires a stocked immediate cash/bank purchase before posting',
        'TRADEIN_POSTING_UNSUPPORTED',
        422,
      );
    }
    const movements = await queryable
      .selectFrom('stock_movements')
      .select(['id', 'product_id', 'qty', 'total_cost'])
      .where('tenant_id', '=', scope.tenantId)
      .where('reference_type', '=', 'trade_in')
      .where('reference_id', '=', tradeInId)
      .where('movement_type', '=', 'tradein_in')
      .execute();
    if (
      movements.length !== 1 ||
      Number(movements[0].product_id) !== Number(source.created_product_id) ||
      Number(movements[0].qty) !== 1 ||
      Math.abs(Number(movements[0].total_cost) - amount) > 0.000001
    ) {
      throw new AppError(
        'Trade-in stock receipt and acquisition value do not reconcile',
        'TRADEIN_STOCK_LEDGER_MISMATCH',
        409,
      );
    }
    const payouts = await queryable
      .selectFrom('treasury_transactions')
      .select(['amount', 'payment_channel', 'txn_type'])
      .where('tenant_id', '=', scope.tenantId)
      .where('reference_type', '=', 'trade_in')
      .where('reference_id', '=', tradeInId)
      .execute();
    if (
      payouts.length !== 1 ||
      payouts[0].txn_type !== 'expense' ||
      payouts[0].payment_channel !== paymentMethod ||
      toMinorUnits(Number(payouts[0].amount), sourceDigits) !== -toMinorUnits(amount, sourceDigits)
    ) {
      throw new AppError(
        'Trade-in payout amount/channel and inventory acquisition do not reconcile',
        'TRADEIN_PAYOUT_LEDGER_MISMATCH',
        409,
      );
    }
    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    const inventoryAccount = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings?.inventory_account_id,
      '1140',
    );
    const payoutAccount =
      paymentMethod === 'bank'
        ? await this.resolveAccountWithFallback(queryable, scope.tenantId, settings?.bank_account_id, '1120')
        : await this.resolveAccountWithFallback(queryable, scope.tenantId, settings?.cash_account_id, '1110');
    return this.postDomainJournal(queryable, {
      sourceType: 'trade_in',
      sourceId: tradeInId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: source.created_at ? new Date(source.created_at) : new Date(),
      description: `Acquisition of used inventory - trade-in #${tradeInId}`,
      branchId: source.branch_id ? Number(source.branch_id) : null,
      locationId: source.location_id ? Number(source.location_id) : null,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines: [
        {
          accountId: inventoryAccount,
          description: 'Trade-in inventory acquisition',
          debit: amount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
        },
        {
          accountId: payoutAccount,
          description:
            paymentMethod === 'bank' ? 'Bank payout for used stock purchase' : 'Cash payout for used stock purchase',
          debit: 0,
          credit: amount,
          partnerType: 'none',
          partnerId: null,
        },
      ],
    });
  }

  async postPurchase(
    queryable: Transaction<Database>,
    purchaseId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number }> {
    this.assertTransaction(queryable, 'postPurchase');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingPurchaseJournal(queryable, purchaseId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const purchase = await queryable
      .selectFrom('purchases')
      .select([
        'id',
        'doc_no',
        'payment_type',
        'subtotal',
        'discount',
        'tax_rate',
        'tax_amount',
        'total',
        'branch_id',
        'location_id',
        'created_by',
        'created_at',
        'supplier_id',
        'grn_id',
        'po_id',
        'lifecycle_status',
        'three_way_match_status',
        'prices_include_tax',
      ])
      .where('id', '=', purchaseId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirstOrThrow();

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting purchase ${purchaseId}`);

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const branchId = purchase.branch_id ? Number(purchase.branch_id) : null;
    const locationId = purchase.location_id ? Number(purchase.location_id) : null;

    const inventoryAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.inventory_account_id,
      '1140',
    );
    const purchaseTaxAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.purchase_tax_account_id,
      '1150',
    );
    const supplierPayableAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.supplier_payable_account_id,
      '2110',
    );
    const cashAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.cash_account_id,
      '1110',
    );

    // Reliable inventory value source: purchase_items qty * unit_cost from the purchase document.
    const purchaseItems = await queryable
      .selectFrom('purchase_items')
      .select(['product_id', 'qty', 'unit_cost', 'line_total', 'grn_line_id', 'grni_amount'])
      .where('purchase_id', '=', purchaseId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    // INV-SERVICE-ITEM-QUICK-CREATE: split the net purchase amount into
    // the stocked share (inventory 1140) and the service share (other
    // expenses 6950). A purchased service must never be capitalised as
    // inventory. Line totals are the discount-allocated effective totals.
    const serviceProductIds = new Set<number>();
    // A purchase_items row without a product_id carries no service flag;
    // skip the lookup entirely when no positive id exists, because an
    // empty `in (...)` list is invalid SQL.
    const serviceLookupIds = purchaseItems.map((item) => Number(item.product_id)).filter((id) => id > 0);
    if (serviceLookupIds.length) {
      const itemProducts = await queryable
        .selectFrom('products')
        .select(['id', 'item_type'])
        .where('id', 'in', serviceLookupIds)
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute();
      for (const row of itemProducts) if (row.item_type === 'service') serviceProductIds.add(Number(row.id));
    }
    const { serviceNet, stockedNet } = partitionPurchaseLineTotals(
      purchaseItems.map((item) => ({
        lineTotal: Number(item.line_total ?? Number(item.qty || 0) * Number(item.unit_cost || 0)),
        isService: serviceProductIds.has(Number(item.product_id)),
      })),
      Number(purchase.tax_rate || 0),
      Boolean(purchase.prices_include_tax),
      bookDigits,
    );

    const taxAmount = toBookMoney(purchase.tax_amount);
    const total = toBookMoney(purchase.total);
    // Prefer header-consistent net purchase amount (total - tax) to keep discounts/tax aligned.
    // Fallback to summed item cost when header fields are not reliable.
    const headerNet = toBookMoney(Math.max(0, total - taxAmount));
    // Clamp the service share to the header net so the split journal stays
    // balanced to the fil when per-line rounding differs from the header.
    const serviceDebit = headerNet > 0 ? toBookMoney(Math.min(serviceNet, headerNet)) : serviceNet;
    const inventoryDebit = headerNet > 0 ? toBookMoney(Math.max(0, headerNet - serviceNet)) : stockedNet;
    const payableCredit = purchase.payment_type === 'credit' ? total : 0;
    const cashOrBankCredit = purchase.payment_type === 'credit' ? 0 : total;

    // Check if this purchase is linked to a posted GRN (3-Way Matching)
    let linkedGrn: { id: number; doc_no: string; grni_journal_entry_id: number | null } | undefined;
    if (purchase.grn_id) {
      linkedGrn = await queryable
        .selectFrom('goods_receipt_notes')
        .select(['id', 'doc_no', 'grni_journal_entry_id'])
        .where('id', '=', Number(purchase.grn_id))
        .where('tenant_id', '=', scope.tenantId)
        .where('status', '=', 'posted')
        .executeTakeFirst();
      if (!linkedGrn) {
        throw new AppError(
          `Posted goods receipt ${purchase.grn_id} is missing for purchase ${purchaseId}`,
          'PURCHASE_GRN_NOT_POSTED',
          422,
        );
      }
    }

    const grniAccount = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('code', '=', '2125')
      .where('is_active', '=', true)
      .executeTakeFirst();

    const ppvAccount = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('code', '=', '5190')
      .where('is_active', '=', true)
      .executeTakeFirst();

    const isGrnBill = purchase.lifecycle_status === 'grn_bill';
    if ((linkedGrn || isGrnBill) && !grniAccount)
      throw new AppError(`GRNI account 2125 is missing for purchase ${purchaseId}`, 'ACCOUNT_NOT_FOUND', 400);
    if ((linkedGrn || isGrnBill) && grniAccount) {
      // Goods already received via GRN! Clear GRNI (2125) and route price variance to PPV (5190)
      if (
        isGrnBill &&
        (!purchase.po_id ||
          purchaseItems.length === 0 ||
          purchaseItems.some((item) => !item.grn_line_id || item.grni_amount == null))
      ) {
        throw new AppError('GRN bill has incomplete receipt allocations', 'GRNI_BILL_INCOMPLETE', 422);
      }
      const grnLines = isGrnBill
        ? []
        : await queryable
            .selectFrom('goods_receipt_lines')
            .select(['accepted_qty', 'unit_cost'])
            .where('grn_id', '=', linkedGrn!.id)
            .where('tenant_id', '=', scope.tenantId)
            .execute();
      const grniBookedAmount = isGrnBill
        ? toBookMoney(purchaseItems.reduce((sum, item) => sum + Number(item.grni_amount), 0))
        : toBookMoney(
            grnLines.reduce((sum, line) => sum + Number(line.accepted_qty || 0) * Number(line.unit_cost || 0), 0),
          );

      const netInvoiceAmount = toBookMoney(Math.max(0, total - taxAmount));
      const priceVariance = toBookMoney(netInvoiceAmount - grniBookedAmount);

      addBookLine({
        accountId: Number(grniAccount.id),
        description: `تصفية استحقاق بضاعة مستلمة GRNI - ${isGrnBill ? `فاتورة ${purchase.doc_no}` : `إذن رقم ${linkedGrn!.doc_no}`}`,
        debit: grniBookedAmount,
        credit: 0,
        partnerType: purchase.supplier_id ? 'supplier' : 'none',
        partnerId: purchase.supplier_id ? Number(purchase.supplier_id) : null,
        branchId,
        locationId,
      });

      if (Math.abs(priceVariance) > 0.0001 && !ppvAccount)
        throw new AppError(`PPV account 5190 is missing for purchase ${purchaseId}`, 'ACCOUNT_NOT_FOUND', 400);
      if (Math.abs(priceVariance) > 0.0001 && ppvAccount) {
        if (priceVariance > 0) {
          // Unfavorable variance (invoice cost > GRN cost) -> Debit PPV (Expense)
          addBookLine({
            accountId: Number(ppvAccount.id),
            description: `فروق أسعار شراء غير مواتية PPV - فاتورة ${purchase.doc_no}`,
            debit: priceVariance,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId,
            locationId,
          });
        } else {
          // Favorable variance (invoice cost < GRN cost) -> Credit PPV (Gain)
          addBookLine({
            accountId: Number(ppvAccount.id),
            description: `فروق أسعار شراء مواتية PPV - فاتورة ${purchase.doc_no}`,
            debit: 0,
            credit: Math.abs(priceVariance),
            partnerType: 'none',
            partnerId: null,
            branchId,
            locationId,
          });
        }
      }
    } else {
      // Direct purchase without prior GRN -> Dr. Inventory Asset (1140)
      if (inventoryDebit > 0) {
        addBookLine({
          accountId: inventoryAccountId,
          description: 'إثبات تكلفة شراء للمخزون',
          debit: inventoryDebit,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        });
      }
      // INV-SERVICE-ITEM-QUICK-CREATE: purchased services are an operating
      // expense (6950, resolved by code like postService resolves 4200),
      // never inventory. The line names the service so it can be
      // reclassified to a more specific expense account later.
      if (serviceDebit > 0) {
        const serviceExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6950');
        addBookLine({
          accountId: serviceExpenseAccountId,
          description: 'إثبات تكلفة خدمة مشتراة',
          debit: serviceDebit,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        });
      }
    }

    if (taxAmount > 0) {
      addBookLine({
        accountId: purchaseTaxAccountId,
        description: 'ضريبة مشتريات قابلة للخصم',
        debit: taxAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    if (payableCredit > 0) {
      addBookLine({
        accountId: supplierPayableAccountId,
        description: 'استحقاق مورد من فاتورة شراء',
        debit: 0,
        credit: payableCredit,
        partnerType: purchase.supplier_id ? 'supplier' : 'none',
        partnerId: purchase.supplier_id ? Number(purchase.supplier_id) : null,
        branchId,
        locationId,
      });
    }

    if (cashOrBankCredit > 0) {
      addBookLine({
        accountId: cashAccountId,
        description: 'سداد نقدي لفاتورة شراء',
        debit: 0,
        credit: cashOrBankCredit,
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
        throw new Error(`Invalid accounting setting account id while posting purchase ${purchaseId}`);
      if (!accountMap.has(line.accountId))
        throw new Error(`Configured account ${line.accountId} was not found while posting purchase ${purchaseId}`);
      if (!accountMap.get(line.accountId))
        throw new Error(`Configured account ${line.accountId} is inactive while posting purchase ${purchaseId}`);
    }

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);

    if (normalizedLines.length === 0) {
      this.logger.warn(
        `Purchase ${purchaseId} resulted in empty journal lines (possibly 100% discount with no tax), skipping journal posting.`,
      );
      return { posted: false, journalEntryId: 0 };
    }

    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(
        `Unbalanced purchase journal for purchase ${purchaseId}: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'purchase',
      sourceId: purchaseId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: purchase.created_at ? new Date(purchase.created_at) : new Date(),
      description: `قيد شراء تلقائي للفاتورة رقم ${purchase.doc_no || `ZP-${purchaseId}`}`,
      branchId,
      locationId,
      createdBy: purchase.created_by ? Number(purchase.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }
}
