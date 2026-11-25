import type { Transaction } from 'kysely';
import { sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting-types';

export class PostPurchaseReturnService {
  constructor(
    private readonly assertTransaction: PurchasesAndTreasuryPostingDeps['assertTransaction'],
    private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'],
    private readonly getTenantAccountingSettings: PurchasesAndTreasuryPostingDeps['getTenantAccountingSettings'],
    private readonly addLine: PurchasesAndTreasuryPostingDeps['addLine'],
    private readonly resolveAccountWithFallback: PurchasesAndTreasuryPostingDeps['resolveAccountWithFallback'],
    private readonly resolveSystemAccountByCode: PurchasesAndTreasuryPostingDeps['resolveSystemAccountByCode'],
    private readonly getActiveAccountMap: PurchasesAndTreasuryPostingDeps['getActiveAccountMap'],
    private readonly maxAllowedDifference: PurchasesAndTreasuryPostingDeps['maxAllowedDifference'],
    private readonly logger: PurchasesAndTreasuryPostingDeps['logger'],
    private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'],
    private readonly getExistingPurchaseReversalJournal: PurchasesAndTreasuryPostingDeps['getExistingPurchaseReversalJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  async postPurchaseReturn(
    queryable: Transaction<Database>,
    returnId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    this.assertTransaction(queryable, 'postPurchaseReturn');
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'purchase_return')
      .where('source_id', '=', returnId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
    if (existing) {
      this.logger.warn(
        `Skipping duplicate purchase return journal for return ${returnId}; existing entry ${existing.id}`,
      );
      return { posted: false, journalEntryId: Number(existing.id) };
    }

    const returnDocument = await queryable
      .selectFrom('return_documents')
      .selectAll()
      .where('id', '=', returnId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!returnDocument || returnDocument.return_type !== 'purchase') {
      this.logger.warn(
        `Purchase return document ${returnId} not found or not a purchase return; skipping accounting post`,
      );
      return { posted: false, journalEntryId: null };
    }

    const purchase = returnDocument.invoice_id
      ? await queryable
          .selectFrom('purchases')
          .select(['id', 'doc_no', 'payment_type', 'supplier_id', 'tax_amount', 'total'])
          .where('id', '=', Number(returnDocument.invoice_id))
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst()
      : null;

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting purchase return ${returnId}`);

    const total = toBookMoney(returnDocument.total);
    const originalPurchaseTotal = Number(purchase?.total || 0);
    const originalPurchaseTax = Number(purchase?.tax_amount || 0);
    const taxRatio =
      originalPurchaseTotal > 0 && originalPurchaseTax > 0 ? originalPurchaseTax / originalPurchaseTotal : 0;
    const lineTax = await queryable
      .selectFrom('return_items')
      .select([
        sql<number>`coalesce(sum(allocated_tax), 0)`.as('allocated_tax'),
        sql<number>`count(*) filter (where allocated_tax is null)`.as('unallocated_lines'),
      ])
      .where('return_document_id', '=', returnId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const taxAmount =
      Number(lineTax?.unallocated_lines || 0) === 0
        ? toBookMoney(lineTax?.allocated_tax || 0)
        : toBookMoney(total * taxRatio); // Historical returns predating line-tax tracking.
    if (taxAmount < 0 || taxAmount > total + 0.001) throw new Error(`Invalid purchase return VAT for ${returnId}`);
    const netReturnAmount = toBookMoney(Math.max(0, total - taxAmount));
    const supplierPartnerId = purchase?.supplier_id ? Number(purchase?.supplier_id) : null;
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const branchId = returnDocument.branch_id ? Number(returnDocument.branch_id) : null;
    const locationId = returnDocument.location_id ? Number(returnDocument.location_id) : null;
    const invoiceNo = purchase?.doc_no || returnDocument.doc_no || `ZP-${returnDocument.invoice_id || ''}`;

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
    const bankAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.bank_account_id,
      '1120',
    );
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

    // Debit the payable only for its actual reversal. Partially paid credit bills
    // can generate a mix of supplier-liability relief and money refunded to treasury.
    const originalPaymentType = String(purchase?.payment_type || '')
      .trim()
      .toLowerCase();
    const refundMethod = String(returnDocument.refund_method || '')
      .trim()
      .toLowerCase();
    const rawAllocations: unknown =
      typeof returnDocument.refund_allocations === 'string'
        ? JSON.parse(returnDocument.refund_allocations)
        : returnDocument.refund_allocations;
    const storedAllocations = Array.isArray(rawAllocations)
      ? (rawAllocations as Array<{ tender: string; amount: number }>)
      : null;
    if (
      returnDocument.refund_allocations != null &&
      (!storedAllocations ||
        storedAllocations.some(
          (allocation) =>
            !allocation ||
            !['payable', 'cash', 'card'].includes(allocation.tender) ||
            !Number.isFinite(Number(allocation.amount)) ||
            Number(allocation.amount) <= 0,
        ))
    ) {
      throw new Error(`Invalid purchase return settlement allocation for ${returnId}`);
    }
    if (total > 0) {
      const allocations = storedAllocations ?? [
        {
          tender: originalPaymentType === 'credit' ? 'payable' : refundMethod === 'cash' ? 'cash' : 'card',
          amount: total,
        },
      ];
      const rawAllocated = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      if (Math.abs(rawAllocated - total) > this.maxAllowedDifference(bookDigits)) {
        throw new Error(
          `Purchase return settlement does not balance for ${returnId}: allocated=${rawAllocated} total=${total}`,
        );
      }
      let allocatedTotalSoFar = 0;
      for (let i = 0; i < allocations.length; i++) {
        const allocation = allocations[i];
        const isLast = i === allocations.length - 1;
        const lineAmount = isLast ? toBookMoney(total - allocatedTotalSoFar) : toBookMoney(allocation.amount);
        allocatedTotalSoFar = toBookMoney(allocatedTotalSoFar + lineAmount);
        const payable = allocation.tender === 'payable';
        const bank = allocation.tender === 'card';
        addBookLine({
          accountId: payable ? supplierPayableAccountId : bank ? bankAccountId : cashAccountId,
          description: payable
            ? `تخفيض مديونية مورد من مردودات مشتريات فاتورة رقم ${invoiceNo}`
            : `استرداد ${bank ? 'بنكي' : 'نقدي'} من مورد لمرتجع فاتورة رقم ${invoiceNo}`,
          debit: lineAmount,
          credit: 0,
          partnerType: payable && supplierPartnerId ? 'supplier' : 'none',
          partnerId: payable ? supplierPartnerId : null,
          branchId,
          locationId,
        });
      }
    }

    const returnCosts = await queryable
      .selectFrom('return_items')
      .select(['qty', 'cost_price'])
      .where('tenant_id', '=', scope.tenantId)
      .where('return_document_id', '=', returnId)
      .execute();
    if (returnCosts.some((item) => item.cost_price == null))
      throw new AppError('Purchase return requires an immutable WAC snapshot', 'PURCHASE_RETURN_COST_MISSING', 409);
    const inventoryReturnCost = toBookMoney(
      returnCosts.reduce((sum, item) => sum + Number(item.qty) * Number(item.cost_price), 0),
    );
    const priceVariance = toBookMoney(inventoryReturnCost - netReturnAmount);
    if (priceVariance !== 0) {
      const varianceAccount = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5190');
      addBookLine({
        accountId: varianceAccount,
        description: 'فرق تكلفة مرتجع الشراء عن المتوسط المرجح',
        debit: Math.max(0, priceVariance),
        credit: Math.max(0, -priceVariance),
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    // Cr. Inventory Asset (1140)
    if (inventoryReturnCost > 0) {
      addBookLine({
        accountId: inventoryAccountId,
        description: `تخفيض المخزون من مردودات مشتريات فاتورة رقم ${invoiceNo}`,
        debit: 0,
        credit: inventoryReturnCost,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    // Cr. Purchase Tax (1150) (Reversing Input VAT)
    if (taxAmount > 0) {
      addBookLine({
        accountId: purchaseTaxAccountId,
        description: `عكس ضريبة مشتريات من مردودات فاتورة رقم ${invoiceNo}`,
        debit: 0,
        credit: taxAmount,
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
        throw new Error(`Invalid accounting setting account id while posting purchase return ${returnId}`);
      if (!accountMap.has(line.accountId))
        throw new Error(`Configured account ${line.accountId} was not found while posting purchase return ${returnId}`);
      if (!accountMap.get(line.accountId))
        throw new Error(`Configured account ${line.accountId} is inactive while posting purchase return ${returnId}`);
    }

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(
        `Unbalanced purchase return journal for return ${returnId}: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'purchase_return',
      sourceId: returnId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: returnDocument.created_at ? new Date(returnDocument.created_at) : new Date(),
      description: `قيد مردودات مشتريات للفاتورة رقم ${invoiceNo}`,
      branchId,
      locationId,
      createdBy: returnDocument.created_by ? Number(returnDocument.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }

  async reversePurchaseJournal(
    queryable: DbOrTx,
    purchaseId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existingReversal = await this.getExistingPurchaseReversalJournal(queryable, purchaseId, scope.tenantId);
    if (existingReversal) {
      this.logger.warn(
        `Skipping duplicate purchase reversal journal for purchase ${purchaseId}; existing entry ${existingReversal.id}`,
      );
      return { reversed: false, journalEntryId: Number(existingReversal.id) };
    }

    const sourceJournal = await queryable
      .selectFrom('journal_entries')
      .select(['id', 'branch_id', 'location_id', 'created_by'])
      .where('source_type', '=', 'purchase')
      .where('source_id', '=', purchaseId)
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    if (!sourceJournal) {
      this.logger.warn(`No posted purchase journal found for purchase ${purchaseId}; skipping accounting reversal`);
      return { reversed: false, journalEntryId: null };
    }

    const purchase = await queryable
      .selectFrom('purchases')
      .select(['doc_no'])
      .where('id', '=', purchaseId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const docNo = purchase?.doc_no || `ZP-${purchaseId}`;

    const sourceLines = await queryable
      .selectFrom('journal_entry_lines')
      .select([
        'account_id',
        'cost_center_id',
        'description',
        'debit',
        'credit',
        'partner_type',
        'partner_id',
        'branch_id',
        'location_id',
      ])
      .where('journal_entry_id', '=', Number(sourceJournal.id))
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    const reversalLines: JournalLineDraft[] = sourceLines
      .map((line) => ({
        accountId: Number(line.account_id),
        costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
        description: `عكس: ${line.description || 'قيد شراء'}`,
        debit: toBookMoney(line.credit),
        credit: toBookMoney(line.debit),
        partnerType: (line.partner_type as 'none' | 'customer' | 'supplier') || 'none',
        partnerId: line.partner_id ? Number(line.partner_id) : null,
        branchId: line.branch_id ? Number(line.branch_id) : null,
        locationId: line.location_id ? Number(line.location_id) : null,
      }))
      .filter((line) => line.debit > 0 || line.credit > 0);

    const totalDebit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(
        `Unbalanced purchase reversal journal for purchase ${purchaseId}: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'purchase_reversal',
      sourceId: purchaseId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء فاتورة شراء رقم ${docNo}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: Number(sourceJournal.id),
    });

    this.logger.warn(`Posted purchase reversal journal for purchase ${purchaseId} as entry ${entryId}`);
    return { reversed: true, journalEntryId: entryId };
  }
}
