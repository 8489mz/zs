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
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import type { DbOrTx } from '../accounting-posting.service';
import type { PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting/purchases-treasury-posting-types';
import { PostTradeInPurchaseService } from './purchases-treasury-posting/post-trade-in-purchase';
import { PostPurchaseReturnService } from './purchases-treasury-posting/post-purchase-return';
import { PostSupplierPaymentBillService } from './purchases-treasury-posting/post-supplier-payment-bill';
import { PostSupplierAdvanceService } from './purchases-treasury-posting/post-supplier-advance';
import { PostCustomerPaymentExpenseService } from './purchases-treasury-posting/post-customer-payment-expense';
import { PostExpenseReversalService } from './purchases-treasury-posting/post-expense-reversal';
import { PostWithholdingTaxRemittanceService } from './purchases-treasury-posting/post-withholding-tax-remittance';
import { PostOpeningBalancesService } from './purchases-treasury-posting/post-opening-balances';


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
  private readonly postOpeningBalancesService: PostOpeningBalancesService;
  private readonly postWithholdingTaxRemittanceService: PostWithholdingTaxRemittanceService;
  private readonly postExpenseReversalService: PostExpenseReversalService;
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
    this.postOpeningBalancesService = new PostOpeningBalancesService(
      this.toMoney,
      this.addLine,
      this.getTenantAccountingSettings,
      this.resolveSystemAccountByCode,
      this.insertPostedJournal,
      this.ensureTenantFoundation.bind(this),
    );
    this.postWithholdingTaxRemittanceService = new PostWithholdingTaxRemittanceService(
      this.toMoney,
      this.getTenantAccountingSettings,
      this.resolveSystemAccountByCode,
      this.addLine,
      this.insertPostedJournal,
      this.ensureTenantFoundation.bind(this),
    );
    this.postExpenseReversalService = new PostExpenseReversalService(
      this.toMoney,
      this.logger,
      this.maxAllowedDifference,
      this.insertPostedJournal,
      this.ensureTenantFoundation.bind(this),
    );
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

  // postSupplierBill derives the bill day via formatLocalCalendarDay (see post-supplier-payment-bill slice)
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


  async postCustomerPayment(queryable: DbOrTx, paymentId: number, auth: AuthContext, docNo?: string): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postCustomerPaymentExpenseService.postCustomerPayment(queryable, paymentId, auth, docNo);
  }

  async postExpense(queryable: DbOrTx, expenseId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postCustomerPaymentExpenseService.postExpense(queryable, expenseId, auth);
  }

  async postExpenseReversal(
    queryable: DbOrTx,
    expenseId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    return this.postExpenseReversalService.postExpenseReversal(queryable, expenseId, reason, auth);
  }


  async postWithholdingTaxRemittance(queryable: DbOrTx, transactionId: number, paymentMethod: 'bank' | 'cash', auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postWithholdingTaxRemittanceService.postWithholdingTaxRemittance(queryable, transactionId, paymentMethod, auth);
  }


  async postCustomerOpeningBalance(
    queryable: DbOrTx,
    customerId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postOpeningBalancesService.postCustomerOpeningBalance(queryable, customerId, amount, auth);
  }

  async postSupplierOpeningBalance(
    queryable: DbOrTx,
    supplierId: number,
    amount: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    return this.postOpeningBalancesService.postSupplierOpeningBalance(queryable, supplierId, amount, auth);
  }

}
