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
import { partitionPurchaseLineTotals } from '../../purchases/helpers/purchases-write.helper';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, toMinorUnits, fromMinorUnits, MoneyDigits } from '../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../accounting-posting.service';

export type PurchasesAndTreasuryPostingDeps = {
  foundation: AccountingTenantFoundationService;
  logger: Logger;
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
  getActiveAccountMap: (queryable: DbOrTx, tenantId: string, accountIds: number[]) => Promise<Map<number, boolean>>;
  assertTransaction: (queryable: unknown, method: string) => asserts queryable is Transaction<Database>;
  getExistingPurchaseJournal: (queryable: DbOrTx, purchaseId: number, tenantId: string) => Promise<any>;
  getExistingPurchaseReversalJournal: (queryable: DbOrTx, purchaseId: number, tenantId: string) => Promise<any>;
  getExistingSupplierPaymentJournal: (queryable: DbOrTx, paymentId: number, tenantId: string) => Promise<any>;
  getExistingSupplierPaymentScheduleSettlementJournal: (queryable: DbOrTx, settlementId: number, tenantId: string) => Promise<any>;
  getExistingCustomerPaymentJournal: (queryable: DbOrTx, paymentId: number, tenantId: string) => Promise<any>;
  getExistingExpenseJournal: (queryable: DbOrTx, expenseId: number, tenantId: string) => Promise<any>;
};

type ExpenseAccountCandidate = {
  id: number;
  code: string;
  name_ar: string;
  account_type: string;
  is_active: boolean;
  allow_manual_entries: boolean;
};

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
  private readonly getExistingSupplierPaymentScheduleSettlementJournal: PurchasesAndTreasuryPostingDeps['getExistingSupplierPaymentScheduleSettlementJournal'];
  private readonly getExistingCustomerPaymentJournal: PurchasesAndTreasuryPostingDeps['getExistingCustomerPaymentJournal'];
  private readonly getExistingExpenseJournal: PurchasesAndTreasuryPostingDeps['getExistingExpenseJournal'];

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
    this.getExistingSupplierPaymentScheduleSettlementJournal = deps.getExistingSupplierPaymentScheduleSettlementJournal;
    this.getExistingCustomerPaymentJournal = deps.getExistingCustomerPaymentJournal;
    this.getExistingExpenseJournal = deps.getExistingExpenseJournal;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.accountingTenantFoundation.ensureForAuth(queryable, auth);
  }

  private normalizeExpenseText(input: string): string {
    return String(input || '').trim().toLowerCase();
  }

  private mapExpenseTitleToAccountCode(expenseTitle: string): string {
    const title = this.normalizeExpenseText(expenseTitle);
    if (!title) return '6900';

    if (title.includes('ايجار') || title.includes('إيجار') || title.includes('rent')) return '6100';
    if (
      title.includes('مرتب') || title.includes('مرتبات') || title.includes('اجور')
      || title.includes('أجور') || title.includes('salary') || title.includes('wage') || title.includes('payroll')
    ) return '6200';
    if (
      title.includes('انترنت') || title.includes('إنترنت') || title.includes('internet')
      // Colloquial / brand spellings a merchant actually types for an internet
      // bill: "النت" (not bare "نت" -- it sits inside منتج/منتجات/كانت), the
      // "انترنيت" spelling, ISP brands, wifi, and DSL. All are internet, so
      // all post to 6700 Administrative per the user's decision.
      || title.includes('النت') || title.includes(' نت')
      || title.includes('انترنيت') || title.includes('إنترنيت')
      || title.includes('انتر نت') || title.includes('إنتر نت')
      || title.includes('فودافون') || title.includes('vodafone')
      || title.includes('اتصالات') || title.includes('etisalat')
      || title.includes('اورنج') || title.includes('أورنج') || title.includes('orange')
      || title.includes('تي داتا') || title.includes('tedata') || title.includes('te data')
      || title.includes('واي فاي') || title.includes('وايفاي') || title.includes('wifi') || title.includes('wi-fi')
      || title.includes('dsl')
    ) return '6700';
    if (
      title.includes('كهرباء') || title.includes('مرافق') || title.includes('مياه')
      || title.includes('utilities') || title.includes('utility')
    ) return '6300';
    if (
      title.includes('نقل') || title.includes('شحن') || title.includes('delivery')
      || title.includes('shipping') || title.includes('transport') || title.includes('freight')
    ) return '6400';
    if (
      title.includes('تسويق') || title.includes('اعلان') || title.includes('إعلان')
      || title.includes('ads') || title.includes('marketing')
    ) return '6500';
    if (
      title.includes('صيانة') || title.includes('اصلاح') || title.includes('إصلاح')
      || title.includes('maintenance') || title.includes('repair')
    ) return '6600';
    if (
      title.includes('اداري') || title.includes('إداري') || title.includes('مكتبي')
      || title.includes('office') || title.includes('admin') || title.includes('administrative')
    ) return '6700';
    if (
      title.includes('بنكي') || title.includes('بنك') || title.includes('bank')
      || title.includes('fee') || title.includes('fees') || title.includes('عمولة بنكية')
      || title.includes('فيزا') || title.includes('visa')
      || title.includes('كارت') || title.includes('card')
      || title.includes('عمولة فيزا') || title.includes('عمولة بنك')
      || title.includes('رسوم بنكية')
      || title.includes('bank fee') || title.includes('bank fees')
      || title.includes('commission')
      || title.includes('payment fee') || title.includes('merchant fee')
    ) return '6800';
    return '6900';
  }

  private isValidExpensePostingAccount(account: ExpenseAccountCandidate | undefined): boolean {
    if (!account) return false;
    if (!account.is_active) return false;
    if (account.account_type !== 'expense') return false;
    if (!account.allow_manual_entries) return false;
    return true;
  }

  private expenseAccountInvalidReason(account: ExpenseAccountCandidate | undefined): string {
    if (!account) return 'account_missing';
    if (!account.is_active) return 'account_inactive';
    if (account.account_type !== 'expense') return `invalid_account_type:${account.account_type}`;
    if (!account.allow_manual_entries) return 'manual_entries_disabled';
    return 'ok';
  }

  private async findAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<ExpenseAccountCandidate | undefined> {
    const row = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'account_type', 'is_active', 'allow_manual_entries'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      id: Number(row.id),
      code: String(row.code || ''),
      name_ar: String(row.name_ar || ''),
      account_type: String(row.account_type || ''),
      is_active: Boolean(row.is_active),
      allow_manual_entries: Boolean(row.allow_manual_entries),
    };
  }

  private async findAccountById(queryable: DbOrTx, tenantId: string, accountId: number): Promise<ExpenseAccountCandidate | undefined> {
    if (!(accountId > 0)) return undefined;
    const row = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'account_type', 'is_active', 'allow_manual_entries'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      id: Number(row.id),
      code: String(row.code || ''),
      name_ar: String(row.name_ar || ''),
      account_type: String(row.account_type || ''),
      is_active: Boolean(row.is_active),
      allow_manual_entries: Boolean(row.allow_manual_entries),
    };
  }

  private async resolveExpenseDebitAccountId(
    queryable: DbOrTx,
    tenantId: string,
    settings: { expenses_account_id: number | null },
    expenseTitle: string,
    expenseId: number,
  ): Promise<number> {
    const mappedCode = this.mapExpenseTitleToAccountCode(expenseTitle);
    const normalizedTitle = this.normalizeExpenseText(expenseTitle);
    const isUnknownCategory = mappedCode === '6900' && normalizedTitle.length > 0;
    const mappedAccount = await this.findAccountByCode(queryable, tenantId, mappedCode);
    if (this.isValidExpensePostingAccount(mappedAccount)) {
      if (isUnknownCategory) {
        this.logger.warn(`Expense ${expenseId} category "${expenseTitle}" is unknown; mapped to 6900 by default`);
      }
      return Number(mappedAccount!.id);
    }
    const mappedReason = this.expenseAccountInvalidReason(mappedAccount);
    this.logger.warn(
      `Expense ${expenseId} fallback: mapped category account ${mappedCode} failed (${mappedReason})`,
    );

    const settingsAccount = await this.findAccountById(queryable, tenantId, Number(settings.expenses_account_id || 0));
    if (this.isValidExpensePostingAccount(settingsAccount)) {
      this.logger.warn(`Expense ${expenseId} fallback: using accounting_settings.expenses_account_id (${settingsAccount!.code})`);
      return Number(settingsAccount!.id);
    }
    const settingsReason = this.expenseAccountInvalidReason(settingsAccount);
    this.logger.warn(`Expense ${expenseId} fallback: accounting_settings.expenses_account_id failed (${settingsReason})`);

    const fallback6900 = await this.findAccountByCode(queryable, tenantId, '6900');
    if (this.isValidExpensePostingAccount(fallback6900)) {
      this.logger.warn(`Expense ${expenseId} fallback: using code 6900 (مصروفات أخرى)`);
      return Number(fallback6900!.id);
    }
    const fallbackReason = this.expenseAccountInvalidReason(fallback6900);
    this.logger.warn(`Expense ${expenseId} fallback: code 6900 is not usable (${fallbackReason})`);

    throw new Error(`No valid expense posting account found for expense ${expenseId}`);
  }


  /**
   * A trade-in is an inventory acquisition, not an operating expense.
   * Require the physical unit and the matching cash movement in the SAME
   * transaction before releasing a balanced immutable acquisition journal.
   */
  async postTradeInCashPurchase(queryable: DbOrTx, tradeInId: number, auth: AuthContext): Promise<number | null> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const source = await queryable.selectFrom('trade_in_transactions')
      .select(['id', 'agreed_purchase_price', 'transaction_type', 'payment_method',
        'created_product_id', 'branch_id', 'location_id', 'created_at'])
      .where('tenant_id', '=', scope.tenantId).where('id', '=', tradeInId)
      .executeTakeFirst();
    if (!source) throw new AppError('Trade-in document not found for posting', 'TRADEIN_SOURCE_NOT_FOUND', 404);
    const sourceDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = fromMinorUnits(toMinorUnits(Number(source.agreed_purchase_price), sourceDigits), sourceDigits);
    if (amount < 0) throw new AppError('Invalid trade-in cost', 'TRADEIN_COST_INVALID', 400);
    if (amount === 0) return null;
    const paymentMethod = source.payment_method || 'cash';
    if (source.transaction_type !== 'cash_purchase' ||
        !['cash', 'bank'].includes(paymentMethod) || !source.created_product_id) {
      throw new AppError('Trade-in requires a stocked immediate cash/bank purchase before posting',
        'TRADEIN_POSTING_UNSUPPORTED', 422);
    }
    const movements = await queryable.selectFrom('stock_movements')
      .select(['id', 'product_id', 'qty', 'total_cost'])
      .where('tenant_id', '=', scope.tenantId)
      .where('reference_type', '=', 'trade_in').where('reference_id', '=', tradeInId)
      .where('movement_type', '=', 'tradein_in').execute();
    if (movements.length !== 1 || Number(movements[0].product_id) !== Number(source.created_product_id) ||
        Number(movements[0].qty) !== 1 || Math.abs(Number(movements[0].total_cost) - amount) > 0.000001) {
      throw new AppError('Trade-in stock receipt and acquisition value do not reconcile', 'TRADEIN_STOCK_LEDGER_MISMATCH', 409);
    }
    const payouts = await queryable.selectFrom('treasury_transactions')
      .select(['amount', 'payment_channel', 'txn_type']).where('tenant_id', '=', scope.tenantId)
      .where('reference_type', '=', 'trade_in').where('reference_id', '=', tradeInId).execute();
    if (payouts.length !== 1 || payouts[0].txn_type !== 'expense' ||
        payouts[0].payment_channel !== paymentMethod ||
        toMinorUnits(Number(payouts[0].amount), sourceDigits) !== -toMinorUnits(amount, sourceDigits)) {
      throw new AppError('Trade-in payout amount/channel and inventory acquisition do not reconcile',
        'TRADEIN_PAYOUT_LEDGER_MISMATCH', 409);
    }
    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    const inventoryAccount = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings?.inventory_account_id, '1140');
    const payoutAccount = paymentMethod === 'bank'
      ? await this.resolveAccountWithFallback(queryable, scope.tenantId, settings?.bank_account_id, '1120')
      : await this.resolveAccountWithFallback(queryable, scope.tenantId, settings?.cash_account_id, '1110');
    return this.postDomainJournal(queryable, {
      sourceType: 'trade_in', sourceId: tradeInId, tenantId: scope.tenantId, accountId: scope.accountId,
      entryDate: source.created_at ? new Date(source.created_at) : new Date(),
      description: `Acquisition of used inventory - trade-in #${tradeInId}`,
      branchId: source.branch_id ? Number(source.branch_id) : null,
      locationId: source.location_id ? Number(source.location_id) : null,
      createdBy: auth.userId, postedBy: auth.userId,
      lines: [
        {accountId:inventoryAccount, description:'Trade-in inventory acquisition', debit:amount, credit:0, partnerType:'none', partnerId:null},
        {accountId:payoutAccount, description:paymentMethod === 'bank' ? 'Bank payout for used stock purchase' : 'Cash payout for used stock purchase', debit:0, credit:amount, partnerType:'none', partnerId:null},
      ],
    });
  }


  async postPurchase(queryable: Transaction<Database>, purchaseId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number }> {
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
        'id', 'doc_no', 'payment_type', 'subtotal', 'discount', 'tax_rate', 'tax_amount', 'total',
        'branch_id', 'location_id', 'created_by', 'created_at', 'supplier_id',
        'grn_id', 'po_id', 'lifecycle_status', 'three_way_match_status', 'prices_include_tax',
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

    const inventoryAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.inventory_account_id, '1140');
    const purchaseTaxAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.purchase_tax_account_id, '1150');
    const supplierPayableAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.supplier_payable_account_id, '2110');
    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');

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
        throw new AppError(`Posted goods receipt ${purchase.grn_id} is missing for purchase ${purchaseId}`, 'PURCHASE_GRN_NOT_POSTED', 422);
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
    if ((linkedGrn || isGrnBill) && !grniAccount) throw new AppError(`GRNI account 2125 is missing for purchase ${purchaseId}`, 'ACCOUNT_NOT_FOUND', 400);
    if ((linkedGrn || isGrnBill) && grniAccount) {
      // Goods already received via GRN! Clear GRNI (2125) and route price variance to PPV (5190)
      if (isGrnBill && (!purchase.po_id || purchaseItems.length === 0 ||
        purchaseItems.some((item) => !item.grn_line_id || item.grni_amount == null))) {
        throw new AppError('GRN bill has incomplete receipt allocations', 'GRNI_BILL_INCOMPLETE', 422);
      }
      const grnLines = isGrnBill ? [] : await queryable
        .selectFrom('goods_receipt_lines')
        .select(['accepted_qty', 'unit_cost'])
        .where('grn_id', '=', linkedGrn!.id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      const grniBookedAmount = isGrnBill
        ? toBookMoney(purchaseItems.reduce((sum, item) => sum + Number(item.grni_amount), 0))
        : toBookMoney(grnLines.reduce((sum, line) => sum + Number(line.accepted_qty || 0) * Number(line.unit_cost || 0), 0));

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

      if (Math.abs(priceVariance) > 0.0001 && !ppvAccount) throw new AppError(`PPV account 5190 is missing for purchase ${purchaseId}`, 'ACCOUNT_NOT_FOUND', 400);
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

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting purchase ${purchaseId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting purchase ${purchaseId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting purchase ${purchaseId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);

    if (normalizedLines.length === 0) {
      this.logger.warn(`Purchase ${purchaseId} resulted in empty journal lines (possibly 100% discount with no tax), skipping journal posting.`);
      return { posted: false, journalEntryId: 0 };
    }

    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced purchase journal for purchase ${purchaseId}: debit=${totalDebit} credit=${totalCredit}`);
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


  async postPurchaseReturn(queryable: Transaction<Database>, returnId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
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
      this.logger.warn(`Skipping duplicate purchase return journal for return ${returnId}; existing entry ${existing.id}`);
      return { posted: false, journalEntryId: Number(existing.id) };
    }

    const returnDocument = await queryable
      .selectFrom('return_documents')
      .selectAll()
      .where('id', '=', returnId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!returnDocument || returnDocument.return_type !== 'purchase') {
      this.logger.warn(`Purchase return document ${returnId} not found or not a purchase return; skipping accounting post`);
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
    const taxRatio = originalPurchaseTotal > 0 && originalPurchaseTax > 0 ? (originalPurchaseTax / originalPurchaseTotal) : 0;
    const lineTax = await queryable.selectFrom('return_items')
      .select([
        sql<number>`coalesce(sum(allocated_tax), 0)`.as('allocated_tax'),
        sql<number>`count(*) filter (where allocated_tax is null)`.as('unallocated_lines'),
      ])
      .where('return_document_id', '=', returnId).where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const taxAmount = Number(lineTax?.unallocated_lines || 0) === 0
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

    const supplierPayableAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.supplier_payable_account_id, '2110');
    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const bankAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const inventoryAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.inventory_account_id, '1140');
    const purchaseTaxAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.purchase_tax_account_id, '1150');

    // Debit the payable only for its actual reversal. Partially paid credit bills
    // can generate a mix of supplier-liability relief and money refunded to treasury.
    const originalPaymentType = String(purchase?.payment_type || '').trim().toLowerCase();
    const refundMethod = String(returnDocument.refund_method || '').trim().toLowerCase();
    const rawAllocations: unknown = typeof returnDocument.refund_allocations === 'string'
      ? JSON.parse(returnDocument.refund_allocations) : returnDocument.refund_allocations;
    const storedAllocations = Array.isArray(rawAllocations)
      ? rawAllocations as Array<{ tender: string; amount: number }>
      : null;
    if (returnDocument.refund_allocations != null && (!storedAllocations || storedAllocations.some((allocation) =>
      !allocation || !['payable', 'cash', 'card'].includes(allocation.tender) ||
      !Number.isFinite(Number(allocation.amount)) || Number(allocation.amount) <= 0))) {
      throw new Error(`Invalid purchase return settlement allocation for ${returnId}`);
    }
    if (total > 0) {
      const allocations = storedAllocations ?? [{
        tender: originalPaymentType === 'credit' ? 'payable' : refundMethod === 'cash' ? 'cash' : 'card',
        amount: total,
      }];
      const rawAllocated = allocations.reduce((sum, allocation) => sum + Number(allocation.amount || 0), 0);
      if (Math.abs(rawAllocated - total) > this.maxAllowedDifference(bookDigits)) {
        throw new Error(`Purchase return settlement does not balance for ${returnId}: allocated=${rawAllocated} total=${total}`);
      }
      let allocatedTotalSoFar = 0;
      for (let i = 0; i < allocations.length; i++) {
        const allocation = allocations[i];
        const isLast = i === allocations.length - 1;
        const lineAmount = isLast
          ? toBookMoney(total - allocatedTotalSoFar)
          : toBookMoney(allocation.amount);
        allocatedTotalSoFar = toBookMoney(allocatedTotalSoFar + lineAmount);
        const payable = allocation.tender === 'payable';
        const bank = allocation.tender === 'card';
        addBookLine({
          accountId: payable ? supplierPayableAccountId : bank ? bankAccountId : cashAccountId,
          description: payable ? `تخفيض مديونية مورد من مردودات مشتريات فاتورة رقم ${invoiceNo}`
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

    const returnCosts = await queryable.selectFrom('return_items').select(['qty', 'cost_price'])
      .where('tenant_id', '=', scope.tenantId).where('return_document_id', '=', returnId).execute();
    if (returnCosts.some(item => item.cost_price == null)) throw new AppError('Purchase return requires an immutable WAC snapshot', 'PURCHASE_RETURN_COST_MISSING', 409);
    const inventoryReturnCost = toBookMoney(returnCosts.reduce((sum, item) => sum + Number(item.qty) * Number(item.cost_price), 0));
    const priceVariance = toBookMoney(inventoryReturnCost - netReturnAmount);
    if (priceVariance !== 0) {
      const varianceAccount = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5190');
      addBookLine({ accountId: varianceAccount, description: 'فرق تكلفة مرتجع الشراء عن المتوسط المرجح', debit: Math.max(0, priceVariance), credit: Math.max(0, -priceVariance), partnerType: 'none', partnerId: null, branchId, locationId });
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

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting purchase return ${returnId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting purchase return ${returnId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting purchase return ${returnId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced purchase return journal for return ${returnId}: debit=${totalDebit} credit=${totalCredit}`);
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


  async reversePurchaseJournal(queryable: DbOrTx, purchaseId: number, reason: string, auth: AuthContext): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existingReversal = await this.getExistingPurchaseReversalJournal(queryable, purchaseId, scope.tenantId);
    if (existingReversal) {
      this.logger.warn(`Skipping duplicate purchase reversal journal for purchase ${purchaseId}; existing entry ${existingReversal.id}`);
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
      .select(['account_id', 'cost_center_id', 'description', 'debit', 'credit', 'partner_type', 'partner_id', 'branch_id', 'location_id'])
      .where('journal_entry_id', '=', Number(sourceJournal.id))
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    const reversalLines: JournalLineDraft[] = sourceLines.map((line) => ({
      accountId: Number(line.account_id),
      costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
      description: `عكس: ${line.description || 'قيد شراء'}`,
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
      throw new Error(`Unbalanced purchase reversal journal for purchase ${purchaseId}: debit=${totalDebit} credit=${totalCredit}`);
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


  async postSupplierPayment(queryable: DbOrTx, paymentId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSupplierPaymentJournal(queryable, paymentId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const payment = await queryable
      .selectFrom('supplier_payments as sp')
      .leftJoin('suppliers as s', 's.id', 'sp.supplier_id')
      .select([
        'sp.id',
        'sp.doc_no',
        'sp.supplier_id',
        'sp.amount',
        'sp.payment_channel',
        'sp.note',
        'sp.payment_date',
        'sp.branch_id',
        'sp.location_id',
        'sp.created_by',
        'sp.created_at',
        's.name as supplier_name',
      ])
      .where('sp.id', '=', paymentId)
      .where(sql<boolean>`sp.tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!payment) {
      this.logger.warn(`Supplier payment ${paymentId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting supplier payment ${paymentId}`);

    const amount = toBookMoney(payment.amount);
    if (!(amount > 0)) {
      this.logger.warn(`Supplier payment ${paymentId} has non-positive amount; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const branchId = payment.branch_id ? Number(payment.branch_id) : null;
    const locationId = payment.location_id ? Number(payment.location_id) : null;
    const supplierName = String(payment.supplier_name || '').trim();
    const docNo = String(payment.doc_no || `ZPV-${paymentId}`).trim();

    const supplierPayableAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.supplier_payable_account_id, '2110');
    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const paymentAccountId = (payment.payment_channel || 'cash') === 'cash' ? cashAccountId :
      await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: supplierPayableAccountId,
      description: 'سداد مستحقات مورد',
      debit: amount,
      credit: 0,
      partnerType: payment.supplier_id ? 'supplier' : 'none',
      partnerId: payment.supplier_id ? Number(payment.supplier_id) : null,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: paymentAccountId,
      description: (payment.payment_channel || 'cash') === 'cash' ? 'خروج نقدية لسداد مورد' : 'سداد مورد عبر البنك أو المدفوعات الإلكترونية',
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    });

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting supplier payment ${paymentId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting supplier payment ${paymentId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting supplier payment ${paymentId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced supplier payment journal for payment ${paymentId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'supplier_payment',
      sourceId: paymentId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: payment.payment_date ? new Date(payment.payment_date) : (payment.created_at ? new Date(payment.created_at) : new Date()),
      description: `قيد سداد مورد رقم ${docNo}${supplierName ? ` - ${supplierName}` : ''}`,
      branchId,
      locationId,
      createdBy: payment.created_by ? Number(payment.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }


  async postSupplierPaymentScheduleSettlement(queryable: DbOrTx, settlementId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSupplierPaymentScheduleSettlementJournal(queryable, settlementId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const settlement = await queryable
      .selectFrom('supplier_payment_schedule_logs as l')
      .leftJoin('supplier_payment_schedules as sch', 'sch.id', 'l.schedule_id')
      .leftJoin('suppliers as s', 's.id', 'l.supplier_id')
      .select([
        'l.id',
        'l.schedule_id',
        'l.supplier_id',
        'l.amount',
        'l.payment_channel',
        'l.note',
        'l.created_by',
        'l.created_at',
        'sch.purchase_id',
        's.name as supplier_name',
      ])
      .where('l.id', '=', settlementId)
      .where(sql<boolean>`l.tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!settlement) {
      this.logger.warn(`Supplier payment schedule settlement ${settlementId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting supplier payment schedule settlement ${settlementId}`);

    const amount = toBookMoney(settlement.amount);
    if (!(amount > 0)) {
      this.logger.warn(`Supplier payment schedule settlement ${settlementId} has non-positive amount; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const purchase = settlement.purchase_id
      ? await queryable
        .selectFrom('purchases')
        .select(['branch_id', 'location_id'])
        .where('id', '=', Number(settlement.purchase_id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .executeTakeFirst()
      : null;

    const branchId = purchase?.branch_id ? Number(purchase.branch_id) : null;
    const locationId = purchase?.location_id ? Number(purchase.location_id) : null;
    const supplierName = String(settlement.supplier_name || '').trim();

    const supplierPayableAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.supplier_payable_account_id, '2110');
    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const paymentAccountId = (settlement.payment_channel || 'cash') === 'cash' ? cashAccountId :
      await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: supplierPayableAccountId,
      description: 'سداد مستحقات مورد',
      debit: amount,
      credit: 0,
      partnerType: settlement.supplier_id ? 'supplier' : 'none',
      partnerId: settlement.supplier_id ? Number(settlement.supplier_id) : null,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: paymentAccountId,
      description: (settlement.payment_channel || 'cash') === 'cash' ? 'خروج نقدية لسداد مورد' : 'سداد قسط مورد عبر البنك أو المدفوعات الإلكترونية',
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    });

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting supplier payment schedule settlement ${settlementId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting supplier payment schedule settlement ${settlementId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting supplier payment schedule settlement ${settlementId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced supplier payment schedule settlement journal for settlement ${settlementId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'supplier_payment_schedule_settlement',
      sourceId: settlementId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: settlement.created_at ? new Date(settlement.created_at) : new Date(),
      description: `قيد سداد مورد${supplierName ? ` - ${supplierName}` : ''}`,
      branchId,
      locationId,
      createdBy: settlement.created_by ? Number(settlement.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }


  async postCustomerPayment(queryable: DbOrTx, paymentId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingCustomerPaymentJournal(queryable, paymentId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const payment = await queryable
      .selectFrom('customer_payments as cp')
      .leftJoin('customers as c', 'c.id', 'cp.customer_id')
      .select([
        'cp.id',
        'cp.customer_id',
        'cp.amount',
        'cp.payment_channel',
        'cp.transfer_reference',
        'cp.note',
        'cp.branch_id',
        'cp.location_id',
        'cp.created_by',
        'cp.created_at',
        'c.name as customer_name',
      ])
      .where('cp.id', '=', paymentId)
      .where(sql<boolean>`cp.tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!payment) {
      this.logger.warn(`Customer payment ${paymentId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting customer payment ${paymentId}`);

    const amount = toBookMoney(payment.amount);
    if (!(amount > 0)) {
      this.logger.warn(`Customer payment ${paymentId} has non-positive amount; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    // INV-REP-NONCASH-EVIDENCE-GATE (PD1): last line of defence for
    // any caller that reaches this posting without evidence — a
    // non-cash receipt debits bank 1120 below, so it must carry a
    // transfer reference of at least 3 characters (same bar as the
    // van field-collection gate). The service gate refuses first, so
    // this normally never fires; rows with no channel are cash.
    // A free-text note alone is not evidence.
    if ((payment.payment_channel || 'cash') !== 'cash') {
      const reference = String(payment.transfer_reference || '').trim();
      if (reference.length < 3) {
        throw new Error(
          `Customer payment ${paymentId}: refusing to debit bank 1120 for a non-cash receipt without a transfer reference of at least 3 characters`,
        );
      }
    }

    const branchId = payment.branch_id ? Number(payment.branch_id) : null;
    const locationId = payment.location_id ? Number(payment.location_id) : null;
    const customerName = String(payment.customer_name || '').trim();

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');
    const paymentAccountId = (payment.payment_channel || 'cash') === 'cash' ? cashAccountId :
      await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: paymentAccountId,
      description: (payment.payment_channel || 'cash') === 'cash' ? 'دخول نقدية من تحصيل عميل' : 'تحصيل عميل عبر البنك أو المدفوعات الإلكترونية',
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: customerAccountId,
      description: 'تحصيل مستحقات عميل',
      debit: 0,
      credit: amount,
      partnerType: payment.customer_id ? 'customer' : 'none',
      partnerId: payment.customer_id ? Number(payment.customer_id) : null,
      branchId,
      locationId,
    });

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting customer payment ${paymentId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting customer payment ${paymentId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting customer payment ${paymentId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced customer payment journal for payment ${paymentId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'customer_payment',
      sourceId: paymentId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: payment.created_at ? new Date(payment.created_at) : new Date(),
      description: `قيد تحصيل عميل${customerName ? ` - ${customerName}` : ''}`,
      branchId,
      locationId,
      createdBy: payment.created_by ? Number(payment.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }


  async postExpense(queryable: DbOrTx, expenseId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingExpenseJournal(queryable, expenseId, scope.tenantId);
    if (existing) {
      this.logger.warn(`Skipping duplicate expense journal for expense ${expenseId}; existing entry ${existing.id}`);
      return { posted: false, journalEntryId: Number(existing.id) };
    }

    const expense = await queryable
      .selectFrom('expenses')
      .select([
        'id',
        'title',
        'amount',
        'note',
        'expense_date',
        'branch_id',
        'location_id',
        'cost_center_id',
        'created_by',
        'created_at',
      ])
      .where('id', '=', expenseId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!expense) {
      this.logger.warn(`Expense ${expenseId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting expense ${expenseId}`);

    const amount = toBookMoney(expense.amount);
    if (!(amount > 0)) {
      this.logger.warn(`Expense ${expenseId} has invalid amount (${amount}); skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const branchId = expense.branch_id ? Number(expense.branch_id) : null;
    const locationId = expense.location_id ? Number(expense.location_id) : null;
    const costCenterId = expense.cost_center_id ? Number(expense.cost_center_id) : null;
    const expenseTitle = String(expense.title || '').trim();
    const expenseDebitAccountId = await this.resolveExpenseDebitAccountId(queryable, scope.tenantId, settings, expenseTitle, expenseId);
    const expenseLabel = expenseTitle || 'مصروف عام';

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');

    // Current expense flow is cash-based and does not persist payment method.
    // Use cash account credit to match existing treasury transaction behavior (txn_type: expense, negative amount).
    const lines: JournalLineDraft[] = [];
    this.addLine(lines, {
      accountId: expenseDebitAccountId,
      description: `إثبات مصروف ${expenseLabel}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
      costCenterId,
    }, bookDigits);
    this.addLine(lines, {
      accountId: cashAccountId,
      description: 'خروج نقدية لمصروف',
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    }, bookDigits);

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting expense ${expenseId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting expense ${expenseId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting expense ${expenseId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced expense journal for expense ${expenseId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'expense',
      sourceId: expenseId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: expense.expense_date ? new Date(expense.expense_date) : (expense.created_at ? new Date(expense.created_at) : new Date()),
      description: `قيد مصروف: ${expenseTitle || `EXP-${expenseId}`}`,
      branchId,
      locationId,
      createdBy: expense.created_by ? Number(expense.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
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
