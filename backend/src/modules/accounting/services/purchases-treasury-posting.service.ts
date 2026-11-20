/*
 * Purchases + treasury posting (split-4 out of AccountingPostingService).
 * Pure move: the 11 purchases/treasury posting methods + the expense-account
 * helper cluster used only by postExpense, unchanged, behind the
 * AccountingPostingService delegating facade. The facade owns the shared
 * journal helpers; this service receives them bound via
 * PurchasesAndTreasuryPostingDeps, so the moved bodies are byte-identical
 * to the originals.
 */
import type { Logger } from '@nestjs/common';
import { Transaction } from 'kysely';
import { sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { AppError } from '../../../common/errors/app-error';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits } from '../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../accounting-posting.service';
import type { ExpenseAccountCandidate, PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting/purchases-treasury-posting-types';
import { PostTradeInPurchaseService } from './purchases-treasury-posting/post-trade-in-purchase';
import { PostPurchaseReturnService } from './purchases-treasury-posting/post-purchase-return';
import { PostSupplierPaymentBillService } from './purchases-treasury-posting/post-supplier-payment-bill';
import { PostSupplierAdvanceService } from './purchases-treasury-posting/post-supplier-advance';
import { PostCustomerPaymentExpenseService } from './purchases-treasury-posting/post-customer-payment-expense';


export class PurchasesAndTreasuryPostingService {
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly logger: Logger;
  private readonly getTenantAccountingSettings: PurchasesAndTreasuryPostingDeps['getTenantAccountingSettings'];
  private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'];
  private readonly maxAllowedDifference: PurchasesAndTreasuryPostingDeps['maxAllowedDifference'];
  private readonly addLine: PurchasesAndTreasuryPostingDeps['addLine'];
  private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'];
  private readonly postDomainJournal: PurchasesAndTreasuryPostingDeps['postDomainJournal'];
  private readonly resolveSystemAccountByCode: PurchasesAndTreasuryPostingDeps['resolveSystemAccountByCode'];
  private readonly resolveAccountWithFallback: PurchasesAndTreasuryPostingDeps['resolveAccountWithFallback'];
  private readonly getActiveAccountMap: PurchasesAndTreasuryPostingDeps['getActiveAccountMap'];
  private readonly assertTransaction: PurchasesAndTreasuryPostingDeps['assertTransaction'];
  private readonly getExistingPurchaseJournal: PurchasesAndTreasuryPostingDeps['getExistingPurchaseJournal'];
  private readonly getExistingPurchaseReversalJournal: PurchasesAndTreasuryPostingDeps['getExistingPurchaseReversalJournal'];
  private readonly getExistingSupplierPaymentJournal: PurchasesAndTreasuryPostingDeps['getExistingSupplierPaymentJournal'];
  private readonly getExistingSupplierBillJournal: PurchasesAndTreasuryPostingDeps['getExistingSupplierBillJournal'];
  private readonly getExistingSupplierPaymentScheduleSettlementJournal: PurchasesAndTreasuryPostingDeps['getExistingSupplierPaymentScheduleSettlementJournal'];
  private readonly getExistingCustomerPaymentJournal: PurchasesAndTreasuryPostingDeps['getExistingCustomerPaymentJournal'];
  private readonly getExistingExpenseJournal: PurchasesAndTreasuryPostingDeps['getExistingExpenseJournal'];
  private readonly postCustomerPaymentExpenseService: PostCustomerPaymentExpenseService;
  private readonly postSupplierAdvanceService: PostSupplierAdvanceService;
  private readonly postSupplierPaymentBillService: PostSupplierPaymentBillService;
  private readonly postPurchaseReturnService: PostPurchaseReturnService;
  private readonly postTradeInPurchaseService: PostTradeInPurchaseService;

  constructor(deps: PurchasesAndTreasuryPostingDeps) {
    this.accountingTenantFoundation = deps.foundation;
    this.logger = deps.logger;
    this.getTenantAccountingSettings = deps.getTenantAccountingSettings;
    this.toMoney = deps.toMoney;
    this.maxAllowedDifference = deps.maxAllowedDifference;
    this.addLine = deps.addLine;
    this.insertPostedJournal = deps.insertPostedJournal;
    this.postDomainJournal = deps.postDomainJournal;
    this.resolveSystemAccountByCode = deps.resolveSystemAccountByCode;
    this.resolveAccountWithFallback = deps.resolveAccountWithFallback;
    this.getActiveAccountMap = deps.getActiveAccountMap;
    this.assertTransaction = deps.assertTransaction;
    this.getExistingPurchaseJournal = deps.getExistingPurchaseJournal;
    this.getExistingPurchaseReversalJournal = deps.getExistingPurchaseReversalJournal;
    this.getExistingSupplierPaymentJournal = deps.getExistingSupplierPaymentJournal;
    this.getExistingSupplierBillJournal = deps.getExistingSupplierBillJournal;
    this.getExistingSupplierPaymentScheduleSettlementJournal = deps.getExistingSupplierPaymentScheduleSettlementJournal;
    this.getExistingCustomerPaymentJournal = deps.getExistingCustomerPaymentJournal;
    this.getExistingExpenseJournal = deps.getExistingExpenseJournal;
    this.postCustomerPaymentExpenseService = new PostCustomerPaymentExpenseService(
      this.toMoney,
      this.getExistingCustomerPaymentJournal,
      this.getExistingExpenseJournal,
      this.logger,
      this.getTenantAccountingSettings,
      this.resolveAccountWithFallback,
      this.addLine,
      this.getActiveAccountMap,
      this.maxAllowedDifference,
      this.insertPostedJournal,
      this.ensureTenantFoundation.bind(this),
    );
    this.postSupplierAdvanceService = new PostSupplierAdvanceService(
      this.toMoney,
      this.maxAllowedDifference,
      this.getTenantAccountingSettings,
      this.resolveAccountWithFallback,
      this.resolveSystemAccountByCode,
      this.addLine,
      this.getActiveAccountMap,
      this.insertPostedJournal,
      this.logger,
      this.getExistingSupplierPaymentScheduleSettlementJournal,
      this.ensureTenantFoundation.bind(this),
    );
    this.postSupplierPaymentBillService = new PostSupplierPaymentBillService(
      this.toMoney,
      this.getExistingSupplierPaymentJournal,
      this.getExistingSupplierBillJournal,
      this.logger,
      this.getTenantAccountingSettings,
      this.resolveAccountWithFallback,
      this.resolveSystemAccountByCode,
      this.addLine,
      this.getActiveAccountMap,
      this.maxAllowedDifference,
      this.insertPostedJournal,
      this.ensureTenantFoundation.bind(this),
    );
    this.postPurchaseReturnService = new PostPurchaseReturnService(
      this.assertTransaction,
      this.toMoney,
      this.getTenantAccountingSettings,
      this.addLine,
      this.resolveAccountWithFallback,
      this.resolveSystemAccountByCode,
      this.getActiveAccountMap,
      this.maxAllowedDifference,
      this.logger,
      this.insertPostedJournal,
      this.getExistingPurchaseReversalJournal,
      this.ensureTenantFoundation.bind(this),
    );
    this.postTradeInPurchaseService = new PostTradeInPurchaseService(
      this.assertTransaction,
      this.toMoney,
      this.getTenantAccountingSettings,
      this.addLine,
      this.insertPostedJournal,
      this.postDomainJournal,
      this.resolveSystemAccountByCode,
      this.resolveAccountWithFallback,
      this.getActiveAccountMap,
      this.maxAllowedDifference,
      this.logger,
      this.getExistingPurchaseJournal,
      this.ensureTenantFoundation.bind(this),
    );
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.accountingTenantFoundation.ensureForAuth(queryable, auth);
  }



  async postTradeInCashPurchase(queryable: DbOrTx, tradeInId: number, auth: AuthContext): Promise<number | null> {
    return this.postTradeInPurchaseService.postTradeInCashPurchase(queryable, tradeInId, auth);
  }

  async postPurchase(queryable: Transaction<Database>, purchaseId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number }> {
    return this.postTradeInPurchaseService.postPurchase(queryable, purchaseId, auth);
  }


  async postPurchaseReturn(queryable: Transaction<Database>, returnId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postPurchaseReturnService.postPurchaseReturn(queryable, returnId, auth);
  }

  async reversePurchaseJournal(queryable: DbOrTx, purchaseId: number, reason: string, auth: AuthContext): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    return this.postPurchaseReturnService.reversePurchaseJournal(queryable, purchaseId, reason, auth);
  }


  async postSupplierPayment(queryable: DbOrTx, paymentId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postSupplierPaymentBillService.postSupplierPayment(queryable, paymentId, auth);
  }

  async postSupplierBill(queryable: DbOrTx, billId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postSupplierPaymentBillService.postSupplierBill(queryable, billId, auth);
  }

  async postSupplierAdvanceApplication(
    queryable: DbOrTx,
    advancePaymentId: number,
    applyAmount: number,
    purchaseId: number | null,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; appliedAmount: number; remainingAdvance: number }> {
    return this.postSupplierAdvanceService.postSupplierAdvanceApplication(queryable, advancePaymentId, applyAmount, purchaseId, auth);
  }

  async postSupplierPaymentScheduleSettlement(queryable: DbOrTx, settlementId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postSupplierAdvanceService.postSupplierPaymentScheduleSettlement(queryable, settlementId, auth);
  }


  async postCustomerPayment(queryable: DbOrTx, paymentId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postCustomerPaymentExpenseService.postCustomerPayment(queryable, paymentId, auth);
  }

  async postExpense(queryable: DbOrTx, expenseId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postCustomerPaymentExpenseService.postExpense(queryable, expenseId, auth);
  }

  /**
   * INV-EXPENSE-CANCEL-REVERSAL: reverse a posted expense journal by
   * posting a NEW reversing journal, never by deleting or rewriting
   * the original. Mirrors reverseSaleJournalById: the original lines
   * are mirrored debit<->credit, so the reversal is exactly Dr cash /
   * Cr the expense account the original used, whatever account the
   * expense-category resolver picked. Returns { reversed: false,
   * journalEntryId } with the existing reversal id when the journal
   * was already reversed, and { reversed: false, journalEntryId: null }
   * when no posted expense journal exists at all. insertPostedJournal
   * is the concurrency backstop: it throws JOURNAL_REVERSAL_INVALID
   * if the original is already reversed by the time the insert runs.
   */
  async postExpenseReversal(
    queryable: DbOrTx,
    expenseId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // FOR UPDATE is essential, not optional: a concurrent cancel that
    // is already reversing this journal blocks here until it commits,
    // and this load then sees reversed_by_entry_id set and returns
    // already-reversed instead of attempting a second reversal.
    const sourceJournal = await queryable
      .selectFrom('journal_entries')
      .select(['id', 'source_id', 'source_type', 'status', 'reversed_by_entry_id', 'branch_id', 'location_id', 'created_by'])
      .where('source_type', 'in', ['expense', 'treasury_expense'])
      .where('source_id', '=', expenseId)
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'desc')
      .forUpdate()
      .executeTakeFirst();
    if (!sourceJournal) {
      const existingReversal = await this.getExistingExpenseReversalJournal(queryable, expenseId, scope.tenantId);
      if (existingReversal) {
        this.logger.warn(`Skipping duplicate expense reversal journal for expense ${expenseId}; existing entry ${existingReversal.id}`);
        return { reversed: false, journalEntryId: Number(existingReversal.id) };
      }
      this.logger.warn(`No posted expense journal found for expense ${expenseId}; skipping accounting reversal`);
      return { reversed: false, journalEntryId: null };
    }
    if (Number(sourceJournal.source_id) !== expenseId) {
      throw new AppError('Reversal journal does not belong to the requested expense', 'JOURNAL_REVERSAL_INVALID', 409);
    }
    if (sourceJournal.reversed_by_entry_id) {
      const existingReversal = await this.getExistingExpenseReversalJournal(queryable, expenseId, scope.tenantId);
      return { reversed: false, journalEntryId: existingReversal ? Number(existingReversal.id) : null };
    }

    const expense = await queryable
      .selectFrom('expenses')
      .select(['title'])
      .where('id', '=', expenseId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const expenseLabel = String(expense?.title || '').trim() || `EXP-${expenseId}`;

    const sourceLines = await queryable
      .selectFrom('journal_entry_lines')
      .select(['account_id', 'cost_center_id', 'description', 'debit', 'credit', 'partner_type', 'partner_id', 'branch_id', 'location_id'])
      .where('journal_entry_id', '=', Number(sourceJournal.id))
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    const reversalLines: JournalLineDraft[] = sourceLines.map((line) => ({
      accountId: Number(line.account_id),
      costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
      description: `عكس: ${line.description || 'قيد مصروف'}`,
      debit: toBookMoney(line.credit),
      credit: toBookMoney(line.debit),
      partnerType: (line.partner_type as 'none' | 'customer' | 'supplier') || 'none',
      partnerId: line.partner_id ? Number(line.partner_id) : null,
      branchId: line.branch_id ? Number(line.branch_id) : null,
      locationId: line.location_id ? Number(line.location_id) : null,
    })).filter((line) => line.debit > 0 || line.credit > 0);

    const totalDebit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced expense reversal journal for expense ${expenseId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'expense_reversal',
      sourceId: expenseId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء مصروف ${expenseLabel}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: Number(sourceJournal.id),
    });

    this.logger.warn(`Posted expense reversal journal for expense ${expenseId} as entry ${entryId}`);
    return { reversed: true, journalEntryId: entryId };
  }

  private async getExistingExpenseReversalJournal(queryable: DbOrTx, expenseId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'expense_reversal')
      .where('source_id', '=', expenseId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }


  async postWithholdingTaxRemittance(queryable: DbOrTx, transactionId: number, paymentMethod: 'bank' | 'cash', auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const tx = await queryable
      .selectFrom('withholding_tax_transactions')
      .selectAll()
      .where('id', '=', transactionId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!tx) return { posted: false, journalEntryId: null };
    const taxAmount = toBookMoney(tx.tax_amount);
    if (taxAmount <= 0) return { posted: false, journalEntryId: null };

    const lines: JournalLineDraft[] = [];
    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    const partnerId = tx.partner_id ? Number(tx.partner_id) : null;
    if (tx.direction === 'payable') {
      // The withheld part of the supplier liability is reclassified to WHT payable, then remitted.
      let supplierApId = Number(settings?.supplier_payable_account_id || 0);
      if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');
      const whtPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2126');
      const paymentAccountId = paymentMethod === 'cash'
        ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110')
        : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');

      this.addLine(lines, {
        accountId: supplierApId,
        description: `استقطاع ضريبة خصم وإضافة من مستحقات المورد ${tx.partner_name} - فاتورة #${tx.invoice_number}`,
        debit: taxAmount, credit: 0,
        partnerType: partnerId ? 'supplier' : 'none', partnerId,
        branchId: null, locationId: null,
      }, bookDigits);
      this.addLine(lines, {
        accountId: whtPayableId,
        description: `أمانات ضريبة خصم وإضافة نموذج 41 - فاتورة #${tx.invoice_number}`,
        debit: 0, credit: taxAmount, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      }, bookDigits);
      this.addLine(lines, {
        accountId: whtPayableId,
        description: `سداد ضريبة خصم وإضافة نموذج 41 - فاتورة #${tx.invoice_number}`,
        debit: taxAmount, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      }, bookDigits);
      this.addLine(lines, {
        accountId: paymentAccountId,
        description: `سداد وتوريد ضريبة الخصم والإضافة لمصلحة الضرائب (${paymentMethod === 'cash' ? 'نقداً' : 'بنكياً'})`,
        debit: 0, credit: taxAmount, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      }, bookDigits);
    } else {
      // Tax withheld by the customer is a credit against our income tax; it settles part of the customer's debt.
      let customerArId = Number(settings?.customer_receivable_account_id || 0);
      if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
      const whtReceivableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1155');

      this.addLine(lines, {
        accountId: whtReceivableId,
        description: `ضريبة خصم وإضافة مخصومة لدى العميل - فاتورة #${tx.invoice_number}`,
        debit: taxAmount, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      }, bookDigits);
      this.addLine(lines, {
        accountId: customerArId,
        description: `تسوية مديونية العميل ${tx.partner_name} بقيمة الضريبة المخصومة - فاتورة #${tx.invoice_number}`,
        debit: 0, credit: taxAmount,
        partnerType: partnerId ? 'customer' : 'none', partnerId,
        branchId: null, locationId: null,
      }, bookDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'withholding_tax_remittance',
        sourceId: transactionId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد سداد وتوريد ضريبة الخصم والإضافة - معاملة #${transactionId} (${tx.partner_name})`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'withholding_tax_remittance')
          .where('source_id', '=', transactionId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }


  /**
   * Customer opening balance double-entry posting
   */
  async postCustomerOpeningBalance(
    queryable: DbOrTx,
    customerId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    const absAmount = toBookMoney(Math.abs(amount));
    if (absAmount <= 0) return { posted: false, journalEntryId: null };

    // One opening-balance journal per customer: the race-window index is
    // the floor, this SELECT is the fast path (same shape as the other
    // one-journal post methods).
    const existingCustomerOpening = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'customer_opening_balance').where('source_id', '=', customerId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (existingCustomerOpening) return { posted: false, journalEntryId: Number(existingCustomerOpening.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let arAccountId = Number(settings?.customer_receivable_account_id || 0);
    if (!(arAccountId > 0)) arAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    const openingEquityId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '3200');

    const customer = await queryable
      .selectFrom('customers')
      .select(['id', 'name'])
      .where('id', '=', customerId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const custName = customer?.name || `عميل #${customerId}`;

    const lines: JournalLineDraft[] = [];
    if (amount > 0) {
      addBookLine({
        accountId: arAccountId,
        description: `رصيد افتتاحي - مديونية على العميل ${custName}`,
        debit: absAmount,
        credit: 0,
        partnerType: 'customer',
        partnerId: customerId,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: openingEquityId,
        description: `رصيد افتتاحي حقوق ملكية - عميل ${custName}`,
        debit: 0,
        credit: absAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    } else {
      addBookLine({
        accountId: openingEquityId,
        description: `رصيد افتتاحي حقوق ملكية - دائنية للعميل ${custName}`,
        debit: absAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: arAccountId,
        description: `رصيد افتتاحي - دائنية للعميل ${custName}`,
        debit: 0,
        credit: absAmount,
        partnerType: 'customer',
        partnerId: customerId,
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'customer_opening_balance',
        sourceId: customerId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد رصيد افتتاحي للعميل ${custName}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'customer_opening_balance').where('source_id', '=', customerId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }


  /**
   * Supplier opening balance double-entry posting
   */
  async postSupplierOpeningBalance(
    queryable: DbOrTx,
    supplierId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    const absAmount = toBookMoney(Math.abs(amount));
    if (absAmount <= 0) return { posted: false, journalEntryId: null };

    // One opening-balance journal per supplier: same shape as the
    // customer opening balance above.
    const existingSupplierOpening = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'supplier_opening_balance').where('source_id', '=', supplierId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (existingSupplierOpening) return { posted: false, journalEntryId: Number(existingSupplierOpening.id) };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let apAccountId = Number(settings?.supplier_payable_account_id || 0);
    if (!(apAccountId > 0)) apAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');
    const openingEquityId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '3200');

    const supplier = await queryable
      .selectFrom('suppliers')
      .select(['id', 'name'])
      .where('id', '=', supplierId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const supName = supplier?.name || `مورد #${supplierId}`;

    const lines: JournalLineDraft[] = [];
    if (amount > 0) {
      addBookLine({
        accountId: openingEquityId,
        description: `رصيد افتتاحي حقوق ملكية - التزام للمورد ${supName}`,
        debit: absAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: apAccountId,
        description: `رصيد افتتاحي - التزام للمورد ${supName}`,
        debit: 0,
        credit: absAmount,
        partnerType: 'supplier',
        partnerId: supplierId,
        branchId: null,
        locationId: null,
      });
    } else {
      addBookLine({
        accountId: apAccountId,
        description: `رصيد افتتاحي - دفعة مقدمة / مديونية على المورد ${supName}`,
        debit: absAmount,
        credit: 0,
        partnerType: 'supplier',
        partnerId: supplierId,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: openingEquityId,
        description: `رصيد افتتاحي حقوق ملكية - مورد ${supName}`,
        debit: 0,
        credit: absAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'supplier_opening_balance',
        sourceId: supplierId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد رصيد افتتاحي للمورد ${supName}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'supplier_opening_balance').where('source_id', '=', supplierId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

}
