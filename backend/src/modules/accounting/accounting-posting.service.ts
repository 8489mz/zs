import { allocateInstallmentInterest } from './engines/installment-interest.engine';
import { areOppositeJournalLines } from './engines/journal-reversal.engine';
import { syncPostedPartnerLedger } from './partner-subledger';
import { pdcBookAmount } from './engines/pdc-transition.engine';
import { Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Transaction } from 'kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AccountingTenantFoundationService } from './accounting-tenant-foundation.service';
import { AppError } from '../../common/errors/app-error';
import { calculateSalesReturnCost } from './engines/sales-return-cost.engine';
import { allocatePayrollAccrual } from '../hr/engines/payroll-accrual-allocation.engine';
import { assertAutomatedJournalPeriodOpen, lockAccountingPeriod } from './accounting-period-lock';
import { assertTaxPeriodOpen } from './accounting-tax-lock';
import { randomUUID } from 'node:crypto';
import { tenantBaseCurrency } from './accounting-currency';
import { currencyMoneyDigits, roundMoney, toMinorUnits, fromMinorUnits, MoneyDigits } from './engines/money-minor-units.engine';

type DbOrTx = Kysely<Database> | Transaction<Database>;

type JournalLineDraft = {
  accountId: number;
  description: string;
  debit: number;
  credit: number;
  partnerType: 'none' | 'customer' | 'supplier' | 'employee';
  partnerId: number | null;
  branchId: number | null;
  locationId: number | null;
  costCenterId?: number | null;
};

type DomainJournalLineDraft = Omit<JournalLineDraft, 'branchId' | 'locationId'> & {
  branchId?: number | null;
  locationId?: number | null;
};

type ExpenseAccountCandidate = {
  id: number;
  code: string;
  name_ar: string;
  account_type: string;
  is_active: boolean;
  allow_manual_entries: boolean;
};

@Injectable()
export class AccountingPostingService {
  private readonly logger = new Logger(AccountingPostingService.name);

  constructor(
    private readonly accountingTenantFoundation: AccountingTenantFoundationService,
  ) {}

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    await this.accountingTenantFoundation.ensureForAuth(queryable, auth);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string) {
    return queryable
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', 1)
      .executeTakeFirst();
  }

  private async getDeliveryFeeMode(queryable: DbOrTx, tenantId: string): Promise<'freelance_courier' | 'store_fleet'> {
    const row = await queryable
      .selectFrom('settings')
      .select(['value'])
      .where('key', '=', 'deliveryFeeMode')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    if (!row?.value) return 'freelance_courier';
    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return parsed === 'store_fleet' ? 'store_fleet' : 'freelance_courier';
    } catch {
      return String(row.value).includes('store_fleet') ? 'store_fleet' : 'freelance_courier';
    }
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) throw new AppError('Journal amount must be finite', 'INVALID_JOURNAL_AMOUNT', 400);
    return roundMoney(amount, digits);
  }

  private maxAllowedDifference(bookDigits: MoneyDigits): number {
    return 10 ** -bookDigits;
  }

  private async resolveAccountWithFallback(
    queryable: DbOrTx,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ): Promise<number> {
    if (configuredId && Number(configuredId) > 0) {
      const exists = await queryable
        .selectFrom('accounting_accounts')
        .select(['id', 'is_active'])
        .where('id', '=', Number(configuredId))
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .executeTakeFirst();
      if (exists && exists.is_active) return Number(exists.id);
    }

    const fallback = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', fallbackCode)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (fallback?.id) return Number(fallback.id);
    return Number(configuredId || 0);
  }

  private async getExistingSaleJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'sale')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingSaleEditJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'sale_edit')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .where('reversed_by_entry_id', 'is', null)
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingPurchaseJournal(queryable: DbOrTx, purchaseId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'purchase')
      .where('source_id', '=', purchaseId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingSupplierPaymentJournal(queryable: DbOrTx, paymentId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'supplier_payment')
      .where('source_id', '=', paymentId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingSupplierPaymentScheduleSettlementJournal(queryable: DbOrTx, settlementId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'supplier_payment_schedule_settlement')
      .where('source_id', '=', settlementId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingCustomerPaymentJournal(queryable: DbOrTx, paymentId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'customer_payment')
      .where('source_id', '=', paymentId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingExpenseJournal(queryable: DbOrTx, expenseId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', 'in', ['expense', 'treasury_expense'])
      .where('source_id', '=', expenseId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingSaleReversalJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', 'in', ['sale_reversal', 'sale_cancel'])
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingPurchaseReversalJournal(queryable: DbOrTx, purchaseId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', 'in', ['purchase_reversal', 'purchase_cancel'])
      .where('source_id', '=', purchaseId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getExistingSalesReturnJournal(queryable: DbOrTx, returnId: number, tenantId: string) {
    const linkedSale = await queryable.selectFrom('sales').select('id')
      .where('tenant_id', '=', tenantId).where('exchange_return_id', '=', returnId)
      .executeTakeFirst();
    if (linkedSale) {
      const exchangeJournal = await this.getExistingSaleJournal(queryable, Number(linkedSale.id), tenantId);
      if (exchangeJournal) return exchangeJournal;
    }
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', 'in', ['sales_return', 'return'])
      .where('source_id', '=', returnId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  private async getActiveAccountMap(queryable: DbOrTx, tenantId: string, accountIds: number[]): Promise<Map<number, boolean>> {
    const uniqueIds = Array.from(new Set(accountIds.filter((id) => id > 0)));
    if (!uniqueIds.length) return new Map();
    const rows = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active'])
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', uniqueIds)
      .execute();
    return new Map(rows.map((row) => [Number(row.id), Boolean(row.is_active)]));
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    const debit = this.toMoney(next.debit, digits);
    const credit = this.toMoney(next.credit, digits);
    if (Number(next.debit) < 0 || Number(next.credit) < 0) throw new AppError('Journal amounts cannot be negative', 'INVALID_JOURNAL_LINE', 400);
    if (debit <= 0 && credit <= 0) return;
    if (debit > 0 && credit > 0) throw new AppError('Journal line cannot be both debit and credit', 'INVALID_JOURNAL_LINE', 400);

    const existing = lines.find(
      (line) => line.accountId === next.accountId
        && line.partnerType === next.partnerType
        && line.partnerId === next.partnerId
        && line.branchId === next.branchId
        && line.locationId === next.locationId
        && (line.costCenterId ?? null) === (next.costCenterId ?? null)
        && (line.debit > 0) === (debit > 0)
        && line.description === next.description,
    );
    if (existing) {
      existing.debit = this.toMoney(existing.debit + debit, digits);
      existing.credit = this.toMoney(existing.credit + credit, digits);
      return;
    }

    lines.push({ ...next, debit, credit });
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
      title.includes('كهرباء') || title.includes('مرافق') || title.includes('مياه')
      || title.includes('انترنت') || title.includes('إنترنت') || title.includes('utilities')
      || title.includes('utility')
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
   * Posting entry point for modules whose journal lines are domain-specific enough to be
   * built where that domain lives, but which must still go through this engine.
   *
   * It exists so "my lines are special" is never a reason to hand-roll an insert into
   * `journal_entries` — that is what section 2.2 forbids, and what it costs is concrete:
   * the central balance guard, the three-layer period-lock check, and collision-free
   * numbering. Contracting's IPC posting had all three missing.
   *
   * Callers still own WHICH accounts and amounts make up the entry. They do not own
   * whether it balances, whether the period accepts it, or what it is numbered.
   */
  async postDomainJournal(
    queryable: DbOrTx,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date;
      description: string;
      branchId?: number | null;
      locationId?: number | null;
      createdBy: number | null;
      postedBy?: number | null;
      lines: DomainJournalLineDraft[];
    },
  ): Promise<number> {
    return this.insertPostedJournal(queryable, {
      ...params,
      branchId: params.branchId ?? null,
      locationId: params.locationId ?? null,
      postedBy: params.postedBy ?? params.createdBy,
      lines: params.lines.map(line => ({
        ...line,
        branchId: line.branchId === undefined ? params.branchId ?? null : line.branchId,
        locationId: line.locationId === undefined ? params.locationId ?? null : line.locationId,
      })),
    });
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

  private async insertPostedJournal(
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
      lines: JournalLineDraft[];
      reversalOfEntryId?: number | null;
    },
  ): Promise<number> {
    if (queryable && !queryable.isTransaction && typeof queryable.transaction === 'function') {
      return queryable.transaction().execute((trx: any) => this.insertPostedJournal(trx, params));
    }
    await lockAccountingPeriod(queryable, params.tenantId);
    // Book journal lines in the tenant's base-currency precision. The DB migration widens
    // journal_entry_lines so KWD/OMR fils survive both posting and reporting.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, params.tenantId));
    const toBookMoney = (value: unknown) => roundMoney(Number(value ?? 0), bookDigits);
    const unit = 10 ** -bookDigits;
    // The early source lookups can race when recovery workers use different
    // connections. Recheck under the same transaction lock as the insert.
    const oncePerSource = ['sale', 'purchase', 'sales_return', 'purchase_return', 'customer_payment', 'supplier_payment', 'supplier_payment_schedule_settlement', 'expense', 'trade_in', 'maintenance_advance', 'maintenance_advance_refund', 'maintenance_delivery', 'maintenance_part_issue', 'maintenance_part_return', 'pharmacy_clinical_service', 'pharmacy_prescription_cash'].includes(params.sourceType);
    const deduplicate = oncePerSource || ['contracting_ipc', 'contracting_subcontract_ipc', 'contracting_subcontractor_payment', 'marketplace_settlement', 'maritime_carrier_credit_note', 'customer_installment_interest', 'installment_interest_accrual'].includes(params.sourceType);
    let dedupKey = deduplicate ? `${params.sourceType}:${params.sourceId}` : null;
    if (params.sourceType.startsWith('pdc_cheque_')) {
      const cheque = await queryable.selectFrom('accounting_cheques').select('posting_sequence')
        .where('tenant_id', '=', params.tenantId).where('id', '=', params.sourceId).forUpdate().executeTakeFirstOrThrow();
      dedupKey = `${params.sourceType}:${params.sourceId}:${cheque.posting_sequence}`;
      const prior = await queryable.selectFrom('journal_entries').select('id')
        .where('tenant_id', '=', params.tenantId).where('dedup_key', '=', dedupKey).executeTakeFirst();
      if (prior) return Number(prior.id);
    }
    if (deduplicate) {
      let priorQuery = queryable.selectFrom('journal_entries').select('id')
        .where('tenant_id', '=', params.tenantId).where('source_type', '=', params.sourceType).where('source_id', '=', params.sourceId)
        .where('status', '=', 'posted');
      if (!oncePerSource) priorQuery = priorQuery.where('reversed_by_entry_id', 'is', null);
      const prior = await priorQuery.executeTakeFirst();
      if (prior) return Number(prior.id);
    }

    if (params.reversalOfEntryId) {
      const original = await queryable.selectFrom('journal_entries')
        .select(['id', 'status', 'reversed_by_entry_id'])
        .where('tenant_id', '=', params.tenantId).where('id', '=', params.reversalOfEntryId)
        .forUpdate().executeTakeFirst();
      if (!original || original.status !== 'posted' || original.reversed_by_entry_id) {
        throw new AppError('Original journal is missing, unposted or already reversed', 'JOURNAL_REVERSAL_INVALID', 409);
      }
    }
    if (!params.lines?.length) throw new AppError(`No journal lines for ${params.sourceType} #${params.sourceId}`, 'EMPTY_JOURNAL', 400);

    const lines = params.lines.map((line) => {
      if (Number(line.debit) < 0 || Number(line.credit) < 0) {
        throw new AppError('Journal amounts cannot be negative', 'INVALID_JOURNAL_LINE', 400);
      }
      return { ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) };
    });
    for (const line of lines) {
      if (!(Number(line.accountId) > 0)) throw new AppError(`Missing account for ${params.sourceType} #${params.sourceId}`, 'ACCOUNT_NOT_FOUND', 400);
      if (line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0) || (line.debit === 0 && line.credit === 0)) {
        throw new AppError(`Invalid journal line for ${params.sourceType} #${params.sourceId}`, 'INVALID_JOURNAL_LINE', 400);
      }
    }
    const fiscalTransitionSource = ['fiscal_year_closing', 'fiscal_year_reopen'].includes(params.sourceType);
    const accounts = await this.getActiveAccountMap(queryable, params.tenantId, lines.map((line) => Number(line.accountId)));
    for (const line of lines) {
      if (!accounts.has(Number(line.accountId)) || (!fiscalTransitionSource && !accounts.get(Number(line.accountId)))) throw new AppError(`Account ${line.accountId} is missing or inactive for ${params.sourceType} #${params.sourceId}`, 'ACCOUNT_NOT_FOUND', 400);
    }
    const totalDebit = toBookMoney(lines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(lines.reduce((sum, line) => sum + line.credit, 0));
    const difference = toBookMoney(totalDebit - totalCredit);
    const maxTolerance = this.maxAllowedDifference(bookDigits);
    if (Math.abs(difference) >= unit / 2) {
      if (Math.abs(difference) > maxTolerance) {
        throw new AppError(`Unbalanced journal for ${params.sourceType} #${params.sourceId}: debit=${totalDebit.toFixed(bookDigits)} credit=${totalCredit.toFixed(bookDigits)}`, 'UNBALANCED_JOURNAL', 400);
      }
      if (!params.accountId) throw new AppError(`Tenant account scope is required to post ${params.sourceType} #${params.sourceId}`, 'TENANT_SCOPE_REQUIRED', 403);
      await this.accountingTenantFoundation.ensureForScope(queryable, { tenantId: params.tenantId, accountId: params.accountId });
      const roundingAccount = await queryable.selectFrom('accounting_accounts').select(['id', 'is_active'])
        .where('tenant_id', '=', params.tenantId).where('code', '=', '7290').executeTakeFirst();
      if (!roundingAccount?.is_active) throw new AppError(`Rounding difference account 7290 is missing for tenant ${params.tenantId}`, 'ROUNDING_ACCOUNT_NOT_FOUND', 400);
      this.logger.warn(`Journal rounding difference of ${difference.toFixed(bookDigits)} plugged into account 7290 for ${params.sourceType} #${params.sourceId} (tenant ${params.tenantId})`);
      lines.push({
        accountId: Number(roundingAccount.id), description: `Rounding difference: ${params.sourceType} #${params.sourceId}`,
        debit: difference < 0 ? Math.abs(difference) : 0,
        credit: difference > 0 ? difference : 0,
        partnerType: 'none', partnerId: null, branchId: params.branchId, locationId: params.locationId,
      });
    }
    const balancedDebit = toBookMoney(lines.reduce((sum, line) => sum + line.debit, 0));
    const balancedCredit = toBookMoney(lines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(balancedDebit - balancedCredit) >= unit / 2) throw new AppError(`Unbalanced journal for ${params.sourceType} #${params.sourceId}`, 'UNBALANCED_JOURNAL', 400);

    // Serialize all postings touching the same ledger accounts. Every caller uses
    // the same ascending order, so concurrent cash transfers cannot deadlock and
    // a balance read made by a transfer cannot race a journal insert.
    const accountIds = Array.from(new Set(lines.map((line) => Number(line.accountId)))).sort((a, b) => a - b);
    let lockedAccountQuery = queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_tax', 'account_group', 'code'])
      .where('tenant_id', '=', params.tenantId)
      .where('id', 'in', accountIds);
    if (!fiscalTransitionSource) lockedAccountQuery = lockedAccountQuery.where('is_active', '=', true);
    const lockedAccounts = await lockedAccountQuery.forUpdate().orderBy('id', 'asc').execute();
    if (lockedAccounts.length !== accountIds.length) {
      throw new AppError(`One or more accounts became inactive while posting ${params.sourceType} #${params.sourceId}`, 'ACCOUNT_NOT_FOUND', 400);
    }

    // Year-end entries are authorised fiscal transitions even when monthly books
    // have already been locked. Verify their year and exact year-end date first.
    let isFiscalTransition = false;
    if (params.sourceType === 'fiscal_year_closing' || params.sourceType === 'fiscal_year_reopen') {
      const fiscalYear = await queryable.selectFrom('accounting_fiscal_years')
        .select(['closing_entry_id', 'status', 'end_date'])
        .where('tenant_id', '=', params.tenantId)
        .where('id', '=', params.sourceId)
        .forUpdate()
        .executeTakeFirst();
      const postingDate = params.entryDate.toISOString().slice(0, 10);
      const endDate = fiscalYear?.end_date instanceof Date
        ? fiscalYear.end_date.toISOString().slice(0, 10)
        : String(fiscalYear?.end_date || '').slice(0, 10);
      if (postingDate !== endDate || fiscalYear?.status !==
          (params.sourceType === 'fiscal_year_closing' ? 'open' : 'closed')) {
        throw new AppError('Fiscal transition requires the correct year-end date and year status', 'INVALID_FISCAL_TRANSITION', 422);
      }
      if (params.sourceType === 'fiscal_year_reopen') {
        const closingEntry = fiscalYear.closing_entry_id ? await queryable.selectFrom('journal_entries')
          .select(['status', 'reversed_by_entry_id'])
          .where('tenant_id', '=', params.tenantId)
          .where('id', '=', fiscalYear.closing_entry_id)
          .executeTakeFirst() : null;
        if (closingEntry?.status !== 'posted' || closingEntry.reversed_by_entry_id) {
          throw new AppError('Fiscal reopening requires a posted closing entry', 'INVALID_FISCAL_REOPEN', 422);
        }
      }
      isFiscalTransition = true;
    }

    if (isFiscalTransition) {
      await assertTaxPeriodOpen(queryable, params.tenantId, params.entryDate, lines.map((line) => line.accountId));
    } else {
      await assertAutomatedJournalPeriodOpen(queryable, params.tenantId, params.entryDate, lines.map((line) => line.accountId));
    }

    for (const [table, field, values] of [
      ['customers', 'partnerId', lines.filter(line => line.partnerType === 'customer')],
      ['suppliers', 'partnerId', lines.filter(line => line.partnerType === 'supplier')],
      // Cashier custody uses users.id; HR settlements use hr_employees.id.
      [params.sourceType === 'cashier_shift_variance' ? 'users' : 'hr_employees', 'partnerId', lines.filter(line => line.partnerType === 'employee')],
      ['branches', 'branchId', lines], ['stock_locations', 'locationId', lines], ['cost_centers', 'costCenterId', lines],
    ] as const) {
      const ids = Array.from(new Set(values.map((line: any) => line[field]).filter((id: any) => id != null).map(Number)));
      if (ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) throw new AppError('Invalid journal reference', 'INVALID_JOURNAL_REFERENCE', 400);
      if (ids.length) {
        const owned = await queryable.selectFrom(table).select('id').where('tenant_id', '=', params.tenantId).where('id', 'in', ids).execute();
        if (owned.length !== ids.length) throw new AppError('Journal reference does not belong to this tenant', 'INVALID_JOURNAL_REFERENCE', 400);
      }
    }

    const tempEntryNo = `JE-TMP-${randomUUID()}`;
    const insertPayload: Record<string, any> = {
      entry_no: tempEntryNo,
      dedup_key: dedupKey,
      tenant_id: params.tenantId,
      account_id: params.accountId,
      entry_date: params.entryDate,
      description: params.description,
      source_type: params.sourceType,
      source_id: params.sourceId,
      status: 'posted',
      branch_id: params.branchId,
      location_id: params.locationId,
      created_by: params.createdBy && Number(params.createdBy) > 0 ? Number(params.createdBy) : null,
      posted_by: params.postedBy && Number(params.postedBy) > 0 ? Number(params.postedBy) : null,
      posted_at: sql`NOW()`,
    };
    if (params.reversalOfEntryId && Number(params.reversalOfEntryId) > 0) {
      insertPayload.reversal_of_entry_id = Number(params.reversalOfEntryId);
    }
    const inserted = await queryable
      .insertInto('journal_entries')
      .values(insertPayload)
      .returning('id')
      .executeTakeFirstOrThrow();

    const entryId = Number(inserted.id);
    await queryable
      .updateTable('journal_entries')
      .set({ entry_no: `JE-${String(entryId).padStart(8, '0')}`, updated_at: sql`NOW()` } as any)
      .where('id', '=', entryId)
      .where('tenant_id', '=', params.tenantId)
      .execute();

    if (params.reversalOfEntryId && Number(params.reversalOfEntryId) > 0) {
      await queryable
        .updateTable('journal_entries')
        .set({ reversed_by_entry_id: entryId, updated_at: sql`NOW()` } as any)
        .where('id', '=', Number(params.reversalOfEntryId))
        .where('tenant_id', '=', params.tenantId)
        .execute();
    }

    await queryable
        .insertInto('journal_entry_lines')
        .values(
          lines.map((line) => ({
            journal_entry_id: entryId,
            tenant_id: params.tenantId,
            account_id: line.accountId,
            cost_center_id: line.costCenterId ?? null,
            description: line.description,
            debit: toBookMoney(line.debit),
            credit: toBookMoney(line.credit),
            partner_type: line.partnerType,
            partner_id: line.partnerId,
            branch_id: line.branchId,
            location_id: line.locationId,
          } as any))
        )
        .execute();

    if (['purchase_landed_cost', 'import_inventory_receipt', 'import_late_expense', 'contracting_ipc', 'contracting_subcontract_ipc', 'contracting_subcontractor_payment', 'maritime_job', 'maritime_job_expense', 'maritime_carrier_invoice', 'maritime_carrier_credit_note'].includes(params.sourceType)) {
      await syncPostedPartnerLedger(queryable, params.tenantId, entryId);
    }
    return entryId;
  }

  private assertTransaction(queryable: unknown, method: string): asserts queryable is Transaction<Database> {
    if (!(queryable as any)?.isTransaction) {
      throw new AppError(
        `Document posting requires a transaction: call ${method} inside the document transaction so the document, stock and journal commit or roll back together`,
        'POSTING_REQUIRES_TRANSACTION',
        500,
      );
    }
  }

  async postSale(queryable: Transaction<Database>, saleId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number }> {
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
        'id', 'doc_no', 'customer_id', 'subtotal', 'discount', 'tax_amount',
        'total', 'paid_amount', 'store_credit_used', 'exchange_return_id', 'branch_id', 'location_id', 'created_by', 'created_at',
        'delivery_fee', 'delivery_fee_mode', 'service_charge', 'tip_amount', 'prices_include_tax',
        'sale_origin', 'payment_type', 'collection_status',
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

    const cashAmount = toBookMoney(payments.filter((row) => String(row.payment_channel || '') === 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const nonCashAmount = toBookMoney(payments.filter((row) => String(row.payment_channel || '') !== 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0));

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
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const customerPartnerId = sale.customer_id ? Number(sale.customer_id) : null;

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const bankAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');
    const storeCreditAccountId = storeCreditUsed > 0
      ? await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '2150') : 0;
    const salesDiscountAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_discount_account_id, '4300');
    const salesRevenueAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_revenue_account_id, '4100');
    const salesTaxAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_tax_account_id, '2120');
    const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cogs_account_id, '5100');
    const inventoryAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.inventory_account_id, '1140');

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
      const isVanSale = String((sale as any).sale_origin || '') === 'van_sale';
      const paymentType = String((sale as any).payment_type || '');
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
        const creditLedgerRow = await (queryable as any)
          .selectFrom('customer_ledger')
          .select(['amount'])
          .where('reference_type', '=', 'sale')
          .where('reference_id', '=', saleId)
          .where('entry_type', '=', 'sale_credit')
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        const creditPortion = toBookMoney(Math.min(receivableAmount, Math.max(0, Number(creditLedgerRow?.amount || 0))));
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
      addBookLine({
        accountId: salesRevenueAccountId,
        description: 'إيراد مبيعات الفاتورة',
        debit: 0,
        credit: revenueCredit,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      });
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
    // so do not multiply by unit_multiplier again here.
    const saleItems = await queryable
      .selectFrom('sale_items')
      .select(['qty', 'cost_price'])
      .where('sale_id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();
    const cogsAmount = toBookMoney(saleItems.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.cost_price || 0)), 0));

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

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting sale ${saleId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting sale ${saleId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting sale ${saleId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced sale journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    if (sale.exchange_return_id) {
      let returnLinesCollected = false;
      const returnPosting = await this.postSalesReturn(queryable, Number(sale.exchange_return_id), auth, (returnLines) => {
        returnLinesCollected = returnLines.length > 0;
        normalizedLines.push(...returnLines);
      });
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

  async postSaleEdit(queryable: Transaction<Database>, saleId: number, auth: AuthContext, reason?: string): Promise<{ posted: boolean; journalEntryId: number }> {
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
      const reversal = await this.reverseSaleJournal(queryable, saleId, reversalReason, auth);
      if (!reversal.reversed && reversal.journalEntryId == null) {
        throw new AppError('تعذر عكس قيد المبيعات السابق للفاتورة المعدلة', 'SALE_EDIT_REVERSAL_FAILED', 409);
      }
    }

    const sale = await queryable
      .selectFrom('sales')
      .select([
        'id', 'doc_no', 'customer_id', 'subtotal', 'discount', 'tax_amount',
        'total', 'paid_amount', 'store_credit_used', 'exchange_return_id', 'branch_id', 'location_id', 'created_by', 'created_at',
        'delivery_fee', 'delivery_fee_mode', 'service_charge', 'tip_amount', 'prices_include_tax',
        'sale_origin', 'payment_type',
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

    const cashAmount = toBookMoney(payments.filter((row) => String(row.payment_channel || '') === 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0));
    const nonCashAmount = toBookMoney(payments.filter((row) => String(row.payment_channel || '') !== 'cash').reduce((sum, row) => sum + Number(row.amount || 0), 0));

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

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const bankAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');
    const storeCreditAccountId = storeCreditUsed > 0
      ? await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '2150') : 0;
    const salesDiscountAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_discount_account_id, '4300');
    const salesRevenueAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_revenue_account_id, '4100');
    const salesTaxAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_tax_account_id, '2120');
    const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cogs_account_id, '5100');
    const inventoryAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.inventory_account_id, '1140');

    if (cashAmount > 0) {
      this.addLine(lines, {
        accountId: cashAccountId,
        description: 'تحصيل نقدي من تعديل فاتورة بيع',
        debit: cashAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (nonCashAmount > 0) {
      this.addLine(lines, {
        accountId: bankAccountId,
        description: 'تحصيل غير نقدي من تعديل فاتورة بيع',
        debit: nonCashAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (receivableAmount > 0) {
      const isVanSale = String((sale as any).sale_origin || '') === 'van_sale';
      const paymentType = String((sale as any).payment_type || '');
      const branchIdVal = sale.branch_id ? Number(sale.branch_id) : null;
      const locationIdVal = sale.location_id ? Number(sale.location_id) : null;

      if (isVanSale && paymentType === 'cash') {
        this.addLine(lines, {
          accountId: customerAccountId,
          description: 'عهدة نقدية لدى مندوب التوزيع من تعديل فاتورة بيع نقدي',
          debit: receivableAmount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId: branchIdVal,
          locationId: locationIdVal,
        }, bookDigits);
      } else if (isVanSale && paymentType === 'split') {
        const creditLedgerRow = await (queryable as any)
          .selectFrom('customer_ledger')
          .select(['amount'])
          .where('reference_type', '=', 'sale')
          .where('reference_id', '=', saleId)
          .where('entry_type', '=', 'sale_credit')
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        const creditPortion = toBookMoney(Math.min(receivableAmount, Math.max(0, Number(creditLedgerRow?.amount || 0))));
        const repCashPortion = toBookMoney(Math.max(0, receivableAmount - creditPortion));

        if (repCashPortion > 0) {
          this.addLine(lines, {
            accountId: customerAccountId,
            description: 'عهدة نقدية لدى مندوب التوزيع (الجزء النقدي من تعديل بيع مجزأ)',
            debit: repCashPortion,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: branchIdVal,
            locationId: locationIdVal,
          }, bookDigits);
        }
        if (creditPortion > 0) {
          this.addLine(lines, {
            accountId: customerAccountId,
            description: 'مديونية عميل من تعديل فاتورة بيع مجزأة',
            debit: creditPortion,
            credit: 0,
            partnerType: customerPartnerId ? 'customer' : 'none',
            partnerId: customerPartnerId,
            branchId: branchIdVal,
            locationId: locationIdVal,
          }, bookDigits);
        }
      } else {
        this.addLine(lines, {
          accountId: customerAccountId,
          description: 'مديونية عميل من تعديل فاتورة بيع',
          debit: receivableAmount,
          credit: 0,
          partnerType: customerPartnerId ? 'customer' : 'none',
          partnerId: customerPartnerId,
          branchId: branchIdVal,
          locationId: locationIdVal,
        }, bookDigits);
      }
    }

    if (storeCreditUsed > 0) {
      this.addLine(lines, {
        accountId: storeCreditAccountId,
        description: 'استخدام رصيد دائن للعميل في تعديل الفاتورة',
        debit: storeCreditUsed,
        credit: 0,
        partnerType: customerPartnerId ? 'customer' : 'none',
        partnerId: customerPartnerId,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (discount > 0) {
      this.addLine(lines, {
        accountId: salesDiscountAccountId,
        description: 'خصم مبيعات على تعديل الفاتورة',
        debit: discount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (revenueCredit > 0) {
      this.addLine(lines, {
        accountId: salesRevenueAccountId,
        description: 'إيراد تعديل فاتورة بيع',
        debit: 0,
        credit: revenueCredit,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    if (taxAmount > 0) {
      this.addLine(lines, {
        accountId: salesTaxAccountId,
        description: 'ضريبة مبيعات مستحقة من تعديل الفاتورة',
        debit: 0,
        credit: taxAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    const saleItems = await queryable
      .selectFrom('sale_items')
      .select(['qty', 'cost_price'])
      .where('sale_id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();
    const cogsAmount = toBookMoney(saleItems.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.cost_price || 0)), 0));

    if (cogsAmount > 0) {
      this.addLine(lines, {
        accountId: cogsAccountId,
        description: 'تكلفة البضاعة المباعة بعد تعديل البيع',
        debit: cogsAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
      this.addLine(lines, {
        accountId: inventoryAccountId,
        description: 'إخراج مخزون بعد تعديل البيع',
        debit: 0,
        credit: cogsAmount,
        partnerType: 'none',
        partnerId: null,
        branchId: sale.branch_id ? Number(sale.branch_id) : null,
        locationId: sale.location_id ? Number(sale.location_id) : null,
      }, bookDigits);
    }

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting edited sale ${saleId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting edited sale ${saleId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting edited sale ${saleId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced edited sale journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    if (sale.exchange_return_id) {
      let returnLinesCollected = false;
      const returnPosting = await this.postSalesReturn(queryable, Number(sale.exchange_return_id), auth, (returnLines) => {
        returnLinesCollected = returnLines.length > 0;
        normalizedLines.push(...returnLines);
      });
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

  async reverseSaleJournal(queryable: DbOrTx, saleId: number, reason: string, auth: AuthContext, options?: { isPreparedWaste?: boolean }): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // Historical reversals (before reversed_by_entry_id linking) are not linked to their source.
    // Count postings vs reversals so a retried cancel can never reverse an already-offset entry.
    const counts = await queryable
      .selectFrom('journal_entries')
      .select([
        sql<number>`COUNT(*) FILTER (WHERE source_type IN ('sale', 'sale_edit'))`.as('postings'),
        sql<number>`COUNT(*) FILTER (WHERE source_type = 'sale_reversal')`.as('reversals'),
      ])
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const activePostings = Number(counts?.postings || 0) - Number(counts?.reversals || 0);

    const sourceJournal = activePostings > 0 ? await queryable
      .selectFrom('journal_entries')
      .select(['id', 'branch_id', 'location_id', 'created_by'])
      .where('source_type', 'in', ['sale', 'sale_edit'])
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('reversed_by_entry_id', 'is', null)
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst() : undefined;
    if (!sourceJournal) {
      const existingReversal = await this.getExistingSaleReversalJournal(queryable, saleId, scope.tenantId);
      if (existingReversal) {
        this.logger.warn(`Skipping duplicate sale reversal journal for sale ${saleId}; existing entry ${existingReversal.id}`);
        return { reversed: false, journalEntryId: Number(existingReversal.id) };
      }
      this.logger.warn(`No posted sale journal found for sale ${saleId}; skipping accounting reversal`);
      return { reversed: false, journalEntryId: null };
    }

    const sale = await queryable
      .selectFrom('sales')
      .select(['doc_no'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const docNo = sale?.doc_no || `Z-${saleId}`;

    const sourceLines = await queryable
      .selectFrom('journal_entry_lines')
      .select(['account_id', 'cost_center_id', 'description', 'debit', 'credit', 'partner_type', 'partner_id', 'branch_id', 'location_id'])
      .where('journal_entry_id', '=', Number(sourceJournal.id))
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    let linesToReverse = sourceLines;
    if (options?.isPreparedWaste) {
      const invAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1140');
      const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '5100');
      const excludedIds = new Set<number>();
      if (invAccountId > 0) excludedIds.add(invAccountId);
      if (cogsAccountId > 0) excludedIds.add(cogsAccountId);
      linesToReverse = sourceLines.filter(line => !excludedIds.has(Number(line.account_id)));
    }

    const reversalLines: JournalLineDraft[] = linesToReverse.map((line) => ({
      accountId: Number(line.account_id),
      costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
      description: `عكس: ${line.description || 'قيد بيع'}`,
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
      throw new Error(`Unbalanced sale reversal journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale_reversal',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء فاتورة بيع رقم ${docNo}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: Number(sourceJournal.id),
    });

    this.logger.warn(`Posted sale reversal journal for sale ${saleId} as entry ${entryId}`);
    return { reversed: true, journalEntryId: entryId };
  }

  /**
   * Targeted sale reversal for P2 remediation.
   * Unlike reverseSaleJournal(), which reverses the *latest* unreversed
   * journal for a sale, this reverses the journal identified by
   * journalId, even when it is not the latest. It reverses the full
   * journal, including COGS / inventory, and returns
   * { reversed: false, journalEntryId: <existing reversal id> } when
   * the journal was already reversed, so the repair engine can record
   * the sale as already_repaired instead of failing it.
   */
  async reverseSaleJournalById(
    queryable: DbOrTx,
    saleId: number,
    journalId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // FOR UPDATE is essential, not optional: a concurrent repair that
    // is already reversing this journal blocks here until it commits,
    // and this load then sees reversed_by_entry_id set and returns
    // already-reversed instead of attempting a second reversal.
    const sourceJournal = await queryable
      .selectFrom('journal_entries')
      .select(['id', 'source_id', 'source_type', 'status', 'reversed_by_entry_id', 'branch_id', 'location_id', 'created_by'])
      .where('id', '=', journalId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();
    if (!sourceJournal) {
      return { reversed: false, journalEntryId: null };
    }
    if (Number(sourceJournal.source_id) !== saleId || !['sale', 'sale_edit'].includes(String(sourceJournal.source_type))) {
      throw new AppError('Reversal journal does not belong to the requested sale', 'JOURNAL_REVERSAL_INVALID', 409);
    }
    if (sourceJournal.status !== 'posted') {
      throw new AppError('Original journal is not posted', 'JOURNAL_REVERSAL_INVALID', 409);
    }
    if (sourceJournal.reversed_by_entry_id) {
      const existingReversal = await queryable
        .selectFrom('journal_entries')
        .select(['id'])
        .where('tenant_id', '=', scope.tenantId)
        .where('reversal_of_entry_id', '=', journalId)
        .where('source_type', '=', 'sale_reversal')
        .where('status', '=', 'posted')
        .executeTakeFirst();
      return { reversed: false, journalEntryId: existingReversal ? Number(existingReversal.id) : null };
    }

    const sale = await queryable
      .selectFrom('sales')
      .select(['doc_no'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const docNo = sale?.doc_no || `Z-${saleId}`;

    const sourceLines = await queryable
      .selectFrom('journal_entry_lines')
      .select(['account_id', 'cost_center_id', 'description', 'debit', 'credit', 'partner_type', 'partner_id', 'branch_id', 'location_id'])
      .where('journal_entry_id', '=', journalId)
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    // Full mirror, exactly as reverseSaleJournal(): no isPreparedWaste
    // exclusion here. A remediation reversal must reverse COGS and
    // inventory as well, otherwise those accounts stay double-counted.
    const reversalLines: JournalLineDraft[] = sourceLines.map((line) => ({
      accountId: Number(line.account_id),
      costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
      description: `عكس: ${line.description || 'قيد بيع'}`,
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
      throw new Error(`Unbalanced sale reversal journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale_reversal',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء فاتورة بيع رقم ${docNo}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: journalId,
    });

    this.logger.warn(`Posted targeted sale reversal journal for sale ${saleId} (stale journal ${journalId}) as entry ${entryId}`);
    return { reversed: true, journalEntryId: entryId };
  }

  async postSalesReturn(queryable: Transaction<Database>, returnId: number, auth: AuthContext,
    collectExchangeLines?: (lines: JournalLineDraft[]) => void): Promise<{ posted: boolean; journalEntryId: number | null }> {
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
        .select(['id', 'doc_no', 'payment_type', 'customer_id', 'tax_amount', 'total'])
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
    const fallbackRevenueAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_revenue_account_id, '4100');
    const salesReturnsAccountId = Number(salesReturnsAccount?.id || 0) > 0 ? Number(salesReturnsAccount?.id || 0) : fallbackRevenueAccountId;
    if (!(Number(salesReturnsAccount?.id || 0) > 0) && fallbackRevenueAccountId > 0) {
      this.logger.warn(`Sales returns account code 4400 not found for return ${returnId}; falling back to sales revenue account ${fallbackRevenueAccountId}`);
    }

    const rawRefundAllocations: unknown = typeof returnDocument.refund_allocations === 'string'
      ? JSON.parse(returnDocument.refund_allocations) : returnDocument.refund_allocations;
    const refundAllocations = Array.isArray(rawRefundAllocations) ? rawRefundAllocations as Array<{ tender: string; amount: number }> : null;
    if (returnDocument.refund_allocations != null && (!refundAllocations || refundAllocations.some((entry) =>
      !entry || !['cash', 'card', 'store_credit', 'receivable'].includes(entry.tender) ||
      !Number.isFinite(Number(entry.amount)) || Number(entry.amount) <= 0))) {
      throw new Error(`Invalid refund tender allocation for return ${returnId}`);
    }
    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const bankAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');
    const storeCreditAccountId = returnDocument.settlement_mode === 'store_credit' || refundAllocations?.some((entry) => entry.tender === 'store_credit')
      ? await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '2150') : 0;
    const salesTaxAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.sales_tax_account_id, '2120');
    const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cogs_account_id, '5100');
    const inventoryAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.inventory_account_id, '1140');

    const total = toBookMoney(returnDocument.total);
    const originalSaleTotal = Number(sale?.total || 0);
    const originalSaleTax = Number(sale?.tax_amount || 0);
    const taxRatio = originalSaleTotal > 0 && originalSaleTax > 0 ? (originalSaleTax / originalSaleTotal) : 0;
    const returnTax = await queryable.selectFrom('return_items')
      .select([
        sql<number>`coalesce(sum(allocated_tax), 0)`.as('allocated_tax'),
        sql<number>`count(*) filter (where allocated_tax is null)`.as('unallocated_lines'),
      ])
      .where('return_document_id', '=', returnId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const taxAmount = Number(returnTax?.unallocated_lines || 0) === 0
      ? toBookMoney(returnTax?.allocated_tax || 0) : toBookMoney(total * taxRatio);
    const netReturnAmount = toBookMoney(Math.max(0, total - taxAmount));
    const customerPartnerId = sale?.customer_id ? Number(sale.customer_id) : null;
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

    const settlementMode = String(returnDocument.settlement_mode || '').trim().toLowerCase();
    const refundMethod = String(returnDocument.refund_method || '').trim().toLowerCase();
    const originalSalePaymentType = String(sale?.payment_type || '').trim().toLowerCase();

    if (total > 0) {
      const allocations = refundAllocations ?? [{
        tender: settlementMode === 'store_credit' ? 'store_credit'
          : originalSalePaymentType === 'credit' ? 'receivable'
            : refundMethod === 'cash' ? 'cash' : 'card',
        amount: total,
      }];
      const rawAllocated = allocations.reduce((sum, entry) => sum + Number(entry.amount || 0), 0);
      if (Math.abs(rawAllocated - total) > this.maxAllowedDifference(bookDigits)) {
        throw new Error(`Refund tenders do not balance for return ${returnId}: allocated=${rawAllocated} total=${total}`);
      }
      let allocatedTotalSoFar = 0;
      for (let i = 0; i < allocations.length; i++) {
        const allocation = allocations[i];
        const isLast = i === allocations.length - 1;
        const lineAmount = isLast
          ? toBookMoney(total - allocatedTotalSoFar)
          : toBookMoney(allocation.amount);
        allocatedTotalSoFar = toBookMoney(allocatedTotalSoFar + lineAmount);
        const accountId = allocation.tender === 'store_credit' ? storeCreditAccountId
          : allocation.tender === 'receivable' ? customerAccountId
            : allocation.tender === 'cash' ? cashAccountId : bankAccountId;
        const partner = allocation.tender === 'store_credit' || allocation.tender === 'receivable';
        addBookLine({
          accountId,
          description: `تسوية مرتجع فاتورة رقم ${invoiceNo} - ${allocation.tender}`,
          debit: 0,
          credit: lineAmount,
          partnerType: partner && customerPartnerId ? 'customer' : 'none',
          partnerId: partner ? customerPartnerId : null,
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
        .select(['id', 'product_id', 'cost_price'])
        .where('sale_id', '=', Number(sale.id))
        .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
        .execute()
      : [];

    const inventoryReversalAmount = toBookMoney(calculateSalesReturnCost(returnItems, saleItems));

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

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting sales return ${returnId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting sales return ${returnId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting sales return ${returnId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced sales return journal for return ${returnId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    if (collectExchangeLines) {
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
        'id', 'doc_no', 'payment_type', 'subtotal', 'discount', 'tax_amount', 'total',
        'branch_id', 'location_id', 'created_by', 'created_at', 'supplier_id',
        'grn_id', 'po_id', 'lifecycle_status', 'three_way_match_status',
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
      .select(['qty', 'unit_cost', 'grn_line_id', 'grni_amount'])
      .where('purchase_id', '=', purchaseId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    const lineCostTotal = toBookMoney(
      purchaseItems.reduce((sum, item) => sum + (Number(item.qty || 0) * Number(item.unit_cost || 0)), 0),
    );

    const taxAmount = toBookMoney(purchase.tax_amount);
    const total = toBookMoney(purchase.total);
    // Prefer header-consistent net purchase amount (total - tax) to keep discounts/tax aligned.
    // Fallback to summed item cost when header fields are not reliable.
    const inventoryDebit = toBookMoney(Math.max(0, total - taxAmount)) > 0
      ? toBookMoney(Math.max(0, total - taxAmount))
      : lineCostTotal;
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

  async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    const account = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active', 'account_type'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();

    const dedicatedTypes: Record<string, string> = {
      '1165': 'asset', '2160': 'liability', '2155': 'liability', '7170': 'revenue', '7270': 'expense',
      '5190': 'expense', '5300': 'expense', '6900': 'expense', '6950': 'expense', '3200': 'equity',
      '1150': 'asset', '2150': 'liability', '4300': 'contra_revenue', '4400': 'contra_revenue',
      '7110': 'revenue', '7210': 'expense', '7290': 'expense',
    };
    if (account && dedicatedTypes[code] && account.account_type !== dedicatedTypes[code]) throw new AppError('Dedicated system account has an incompatible type', 'SYSTEM_ACCOUNT_TYPE_MISMATCH', 409);
    if (!account) {
      const knownAccounts: Record<string, { name_ar: string; name_en: string; type: string; group: string; balance: string }> = {
        '1165': { name_ar: 'دفعات مقدمة لمقاولي الباطن', name_en: 'Subcontractor Advances', type: 'asset', group: 'current_assets', balance: 'debit' },
        '2160': { name_ar: 'تأمينات محتجزة لمقاولي الباطن', name_en: 'Subcontractor Retentions Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2155': { name_ar: 'فوائد تمويل غير مكتسبة', name_en: 'Unearned Financing Income', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '7170': { name_ar: 'أرباح فروق عملة محققة', name_en: 'Realized FX Gains', type: 'revenue', group: 'income', balance: 'credit' },
        '7270': { name_ar: 'خسائر فروق عملة محققة', name_en: 'Realized FX Losses', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '5400': { name_ar: 'مصاريف صناعية غير مباشرة محملة', name_en: 'Manufacturing Overhead', type: 'expense', group: 'expenses', balance: 'debit' },
        '1140': { name_ar: 'مخزون بضاعة ومواد خام', name_en: 'Inventory', type: 'asset', group: 'current_assets', balance: 'debit' },
        '1135': { name_ar: 'ذمم مدينة - أمناء الصناديق', name_en: 'Cashier Receivable', type: 'asset', group: 'current_assets', balance: 'debit' },
        '1122': { name_ar: 'أوراق قبض في الخزينة', name_en: 'Notes Receivable in Safe', type: 'asset', group: 'current_assets', balance: 'debit' },
        '1121': { name_ar: 'أوراق قبض برسم التحصيل', name_en: 'Notes Receivable Under Collection', type: 'asset', group: 'current_assets', balance: 'debit' },
        '2135': { name_ar: 'أوراق دفع', name_en: 'Notes Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2125': { name_ar: 'بضاعة مستلمة غير مفوترة (GRNI)', name_en: 'Goods Received Not Invoiced', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2126': { name_ar: 'أمانات ضريبة الخصم والإضافة', name_en: 'Withholding Tax Payable', type: 'liability', group: 'tax', balance: 'credit' },
        '1155': { name_ar: 'ضرائب مخصومة لدى الغير', name_en: 'Withholding Tax Receivable', type: 'asset', group: 'current_assets', balance: 'debit' },
        '6800': { name_ar: 'مصاريف بنكية', name_en: 'Bank Fees', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '1110': { name_ar: 'الخزينة', name_en: 'Cash', type: 'asset', group: 'cash_bank', balance: 'debit' },
        '1120': { name_ar: 'البنك', name_en: 'Bank', type: 'asset', group: 'cash_bank', balance: 'debit' },
        '1130': { name_ar: 'العملاء', name_en: 'Accounts Receivable', type: 'asset', group: 'receivable', balance: 'debit' },
        '2110': { name_ar: 'الموردون', name_en: 'Accounts Payable', type: 'liability', group: 'payable', balance: 'credit' },
        '2120': { name_ar: 'ضريبة مبيعات مستحقة', name_en: 'Sales VAT Payable', type: 'liability', group: 'tax', balance: 'credit' },
        '7100': { name_ar: 'إيرادات أخرى', name_en: 'Other Income', type: 'revenue', group: 'income', balance: 'credit' },
        '7200': { name_ar: 'خسائر أو فروق تسوية', name_en: 'Adjustment Losses', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '6200': { name_ar: 'الرواتب والأجور ومكافأة نهاية الخدمة', name_en: 'Salaries, Wages & EOS', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '6210': { name_ar: 'تأمينات اجتماعية - حصة صاحب العمل', name_en: 'Employer Social Insurance Expense', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '2140': { name_ar: 'رواتب ومستحقات مستحقة الدفع', name_en: 'Payroll & Settlements Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2145': { name_ar: 'تأمينات اجتماعية مستحقة السداد', name_en: 'Social Insurance Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2146': { name_ar: 'ضريبة كسب عمل مستحقة', name_en: 'Income Tax Withholding Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '1160': { name_ar: 'سلف وقروض العاملين', name_en: 'Employee Advances & Loans', type: 'asset', group: 'current_assets', balance: 'debit' },
        '6400': { name_ar: 'مصاريف نقل وشحن ووقود رحلات', name_en: 'Delivery, Fuel & Freight Expense', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '5190': { name_ar: 'فروق سعر الشراء والمرتجعات', name_en: 'Purchase Price Variance', type: 'expense', group: 'cogs', balance: 'debit' },
        '5200': { name_ar: 'فروق تكلفة المخزون', name_en: 'Inventory Cost Variance', type: 'expense', group: 'cost_of_sales', balance: 'debit' },
        '5300': { name_ar: 'هالك وفاقد بضاعة أثناء النقل', name_en: 'In-Transit Inventory Shrinkage', type: 'expense', group: 'cost_of_sales', balance: 'debit' },
        '6900': { name_ar: 'مواد ومستلزمات تشغيل مصروفة', name_en: 'Issued Operating Materials Expense', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '6950': { name_ar: 'مصروفات أخرى', name_en: 'Other Expenses', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '3200': { name_ar: 'أرباح محتجزة', name_en: 'Retained Earnings', type: 'equity', group: 'equity', balance: 'credit' },
        '1150': { name_ar: 'ضريبة مشتريات قابلة للخصم', name_en: 'Purchase VAT Receivable', type: 'asset', group: 'tax', balance: 'debit' },
        '2150': { name_ar: 'دفعات مقدمة من العملاء', name_en: 'Customer Advances', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '4100': { name_ar: 'مبيعات المنتجات', name_en: 'Product Sales', type: 'revenue', group: 'income', balance: 'credit' },
        '4300': { name_ar: 'خصومات المبيعات', name_en: 'Sales Discounts', type: 'contra_revenue', group: 'income', balance: 'debit' },
        '4400': { name_ar: 'مردودات المبيعات', name_en: 'Sales Returns', type: 'contra_revenue', group: 'income', balance: 'debit' },
        '5100': { name_ar: 'تكلفة بضاعة مباعة', name_en: 'COGS', type: 'expense', group: 'cost_of_sales', balance: 'debit' },
        '7110': { name_ar: 'زيادة نقدية الصندوق', name_en: 'Cash Over', type: 'revenue', group: 'income', balance: 'credit' },
        '7210': { name_ar: 'عجز نقدية الصندوق', name_en: 'Cash Short', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '7290': { name_ar: 'فروق التقريب المحاسبي', name_en: 'Rounding Differences', type: 'expense', group: 'operating_expenses', balance: 'debit' },
      };
      const known = knownAccounts[code];
      if (known) {
        const settings = await queryable.selectFrom('accounting_settings').select('account_id')
          .where('tenant_id', '=', tenantId).where('id', '=', 1).executeTakeFirst();
        const ownerAccountId = settings?.account_id || (await queryable.selectFrom('accounting_accounts')
          .select('account_id').where('tenant_id', '=', tenantId).executeTakeFirst())?.account_id;
        if (!ownerAccountId) throw new AppError('Accounting foundation must exist before creating system accounts', 'ACCOUNTING_FOUNDATION_REQUIRED', 409);
        const created = await queryable
          .insertInto('accounting_accounts')
          .values({
            tenant_id: tenantId,
            account_id: ownerAccountId,
            code,
            name_ar: known.name_ar,
            name_en: known.name_en,
            account_type: known.type,
            account_group: known.group,
            normal_balance: known.balance,
            is_active: true,
            is_system: true,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          } as any)
          .onConflict((oc) => oc.columns(['tenant_id', 'code']).doUpdateSet({ is_active: true, updated_at: sql`NOW()` }))
          .returning('id')
          .executeTakeFirst();
        if (created?.id) return Number(created.id);
      }
      throw new Error(`Required system account ${code} not found for tenant ${tenantId}. Accounting integration failed.`);
    }
    if (!account.is_active) {
      await queryable
        .updateTable('accounting_accounts')
        .set({ is_active: true, updated_at: sql`NOW()` })
        .where('id', '=', Number(account.id))
        .where('tenant_id', '=', tenantId)
        .execute();
    }
    return Number(account.id);
  }

  async postInventoryAdjustment(queryable: DbOrTx, movementId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    // Check for idempotency via database unique constraint on insert
    const movement = await queryable
      .selectFrom('stock_movements')
      .selectAll()
      .where('id', '=', movementId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!movement) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const delta = Number(movement.after_qty || 0) - Number(movement.before_qty || 0);
    const isFinalIssue = movement.movement_type === 'transfer_final_issue' && movement.reason === 'final_issue';
    const isTransitLoss = movement.movement_type === 'transfer_transit_loss' && movement.reason === 'transit_shrinkage';
    if (Math.abs(delta) < 0.001) return { posted: false, journalEntryId: null, hasFinancialImpact: false }; // No variance

    const rawCost = Number(movement.unit_cost || 0);
    const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
    // Use the immutable amount recorded at the time of the physical movement.
    // Re-multiplying a rounded per-unit cost can drift by cents for fractional quantities.
    const rawTotal = movement.total_cost == null ? null : Number(movement.total_cost);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = rawTotal != null && Number.isFinite(rawTotal) && rawTotal >= 0
      ? this.toMoney(rawTotal, moneyDigits) : this.toMoney(Math.abs(delta) * unitCost, moneyDigits);

    if (amount <= 0) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing`);
    const inventoryAccountId = Number(settings.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      // Fallback code 1140
      const fallbackId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!fallbackId) throw new Error('Inventory account not configured and fallback 1140 not found');
    }

    const accountIdToUse = inventoryAccountId > 0 ? inventoryAccountId : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const lines: JournalLineDraft[] = [];
    const branchId = movement.branch_id ? Number(movement.branch_id) : null;
    const locationId = movement.location_id ? Number(movement.location_id) : null;

    if (delta > 0) {
      // Gain
      const gainAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      this.addLine(lines, { accountId: accountIdToUse, description: 'تسوية زيادة مخزون', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
      this.addLine(lines, { accountId: gainAccountId, description: 'أرباح تسوية مخزون', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
    } else {
      // Loss
      const lossAccountCode = isFinalIssue ? '6900' : isTransitLoss ? '5300' : '5200';
      const lossAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, lossAccountCode);
      this.addLine(lines, { accountId: lossAccountId, description: isFinalIssue ? 'مواد تشغيل مصروفة نهائياً' : isTransitLoss ? 'هالك وفاقد بضاعة أثناء النقل' : 'خسائر تسوية مخزون', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
      this.addLine(lines, { accountId: accountIdToUse, description: isFinalIssue ? 'تخفيض المخزون بموجب إذن صرف نهائي' : isTransitLoss ? 'تخفيض مخزون البضاعة بالطريق بسبب الفاقد' : 'نقص تسوية مخزون', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'inventory_adjustment',
        sourceId: movementId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: movement.created_at ? new Date(movement.created_at) : new Date(),
        description: isFinalIssue ? `قيد صرف مخزون نهائي - حركة #${movementId}` : `قيد تسوية مخزون - حركة #${movementId}`,
        branchId,
        locationId,
        createdBy: movement.created_by ? Number(movement.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'inventory_adjustment').where('source_id', '=', movementId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

  async postDamagedStock(queryable: DbOrTx, damageRecordId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const record = await queryable
      .selectFrom('damaged_stock_records')
      .selectAll()
      .where('id', '=', damageRecordId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!record) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const qty = Number(record.qty || 0);
    if (qty <= 0) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const rawCost = Number(record.unit_cost || 0);
    const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
    // Post the immutable stored cost of the physical write, never independently
    // round quantity * WAC to cents for a 3-decimal tenant.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const storedTotal = record.total_cost == null ? null : Number(record.total_cost);
    const amount = this.toMoney(
      storedTotal != null && Number.isFinite(storedTotal) && storedTotal >= 0
        ? storedTotal : qty * unitCost,
      moneyDigits,
    );

    if (amount <= 0) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
    }
    const damagedExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    const branchId = record.branch_id ? Number(record.branch_id) : null;
    const locationId = record.location_id ? Number(record.location_id) : null;

    const lines: JournalLineDraft[] = [];
    this.addLine(lines, { accountId: damagedExpenseAccountId, description: 'مصروف مخزون تالف', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);
    this.addLine(lines, { accountId: inventoryAccountId, description: 'نقص مخزون بسبب التلف', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }, moneyDigits);

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'damaged_stock',
        sourceId: damageRecordId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: record.created_at ? new Date(record.created_at) : new Date(),
        description: `قيد بضاعة تالفة - سجل #${damageRecordId}`,
        branchId,
        locationId,
        createdBy: record.created_by ? Number(record.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'damaged_stock').where('source_id', '=', damageRecordId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

  async postFoodWaste(queryable: DbOrTx, wasteLogId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const log = await queryable
      .selectFrom('restaurant_food_waste_logs')
      .selectAll()
      .where('id', '=', wasteLogId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!log) return { posted: false, journalEntryId: null };

    const totalCost = Number(log.total_cost || 0);
    if (totalCost <= 0) return { posted: false, journalEntryId: null };

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = this.toMoney(totalCost, moneyDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
    }
    const wasteExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    const branchId = log.branch_id ? Number(log.branch_id) : null;
    const locationId: number | null = null;

    const lines: JournalLineDraft[] = [];
    this.addLine(lines, {
      accountId: wasteExpenseAccountId,
      description: `مصروف هدر وتالف مطبخ - ${log.reason}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    }, moneyDigits);
    this.addLine(lines, {
      accountId: inventoryAccountId,
      description: 'نقص مخزون بسبب هدر المطبخ',
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    }, moneyDigits);

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'food_waste',
        sourceId: wasteLogId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: log.created_at ? new Date(log.created_at) : new Date(),
        description: `قيد هدر وتالف مطبخ - سجل #${wasteLogId}`,
        branchId,
        locationId,
        createdBy: log.logged_by ? Number(log.logged_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'food_waste')
          .where('source_id', '=', wasteLogId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postStockCount(queryable: DbOrTx, sessionId: number, auth: AuthContext, itemIds?: number[]): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const stockCountDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, requireTenantScope(auth).tenantId));
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const session = await queryable.selectFrom('stock_count_sessions').selectAll().where('id', '=', sessionId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (!session) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    let itemQuery = queryable.selectFrom('stock_count_items').selectAll()
      .where('session_id', '=', sessionId).where('tenant_id', '=', scope.tenantId);
    if (itemIds) {
      if (!itemIds.length) return { posted: false, journalEntryId: null, hasFinancialImpact: false };
      itemQuery = itemQuery.where('id', 'in', itemIds);
    }
    const items = await itemQuery.execute();
    const productIds = items.map((item) => Number(item.product_id));
    const movements = productIds.length ? await queryable.selectFrom('stock_movements').selectAll()
      .where('reference_type', '=', 'stock_count_session').where('reference_id', '=', sessionId)
      .where('tenant_id', '=', scope.tenantId).where('product_id', 'in', productIds).execute() : [];
    const movementByProduct = new Map(movements.map((movement) => [Number(movement.product_id), movement]));

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const gainAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
    const lossAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5200');
    const damagedExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    let totalGain = 0;
    let totalLoss = 0;
    let totalDamageLoss = 0;

    for (const item of items) {
       const variance = Number(item.variance_qty || 0);

       const mov = movementByProduct.get(Number(item.product_id));
       // INV-STOCK-COUNT-ACTUAL-DELTA: the movement row carries the
       // actual scoped delta the stock write really moved. Value the
       // journal on it, not on the frozen available-basis variance.
       // Fall back to the stored variance only when no movement row
       // exists (chunks posted before this fix, whose movements carry
       // the frozen variance) -- prospective only, no history rewritten.
       const delta = mov ? Number((mov as any).qty ?? 0) : variance;
       if (delta === 0) continue;

       const rawCost = Number(mov?.unit_cost || 0);
       const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
       const lineCost = roundMoney(Math.abs(delta) * unitCost, stockCountDigits);
       if (lineCost <= 0) continue;

       if (delta > 0) {
          totalGain += lineCost;
       } else if (delta < 0) {
          if (String(item.reason || '').toLowerCase() === 'damage') {
             totalDamageLoss += lineCost;
          } else {
             totalLoss += lineCost;
          }
       }
    }

    if (totalGain === 0 && totalLoss === 0 && totalDamageLoss === 0) {
       return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const branchId = session.branch_id ? Number(session.branch_id) : null;
    const locationId = session.location_id ? Number(session.location_id) : null;

    const lines: JournalLineDraft[] = [];
    if (totalGain > 0) {
       this.addLine(lines, { accountId: inventoryAccountId, description: 'فائض جرد مخزون', debit: totalGain, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
       this.addLine(lines, { accountId: gainAccountId, description: 'أرباح جرد مخزون', debit: 0, credit: totalGain, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
    }
    if (totalLoss > 0) {
       this.addLine(lines, { accountId: lossAccountId, description: 'عجز جرد مخزون', debit: totalLoss, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
       this.addLine(lines, { accountId: inventoryAccountId, description: 'نقص مخزون بسبب العجز', debit: 0, credit: totalLoss, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
    }
    if (totalDamageLoss > 0) {
       this.addLine(lines, { accountId: damagedExpenseAccountId, description: 'عجز جرد (تالف)', debit: totalDamageLoss, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
       this.addLine(lines, { accountId: inventoryAccountId, description: 'نقص مخزون (تالف بالجرد)', debit: 0, credit: totalDamageLoss, partnerType: 'none', partnerId: null, branchId, locationId }, stockCountDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: itemIds ? 'stock_count_chunk' : 'stock_count',
        sourceId: itemIds ? itemIds[0] : sessionId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: session.posted_at ? new Date(session.posted_at) : new Date(),
        description: `قيد تسوية جرد - جلسة #${sessionId}`,
        branchId,
        locationId,
        createdBy: session.approved_by ? Number(session.approved_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && (
        e.constraint?.includes('idx_journal_entries_round1_uniq')
        || e.constraint?.includes('idx_journal_entries_stock_count_chunk_uniq')
      )) {
         const existing = await queryable.selectFrom('journal_entries').select('id')
           .where('source_type', '=', itemIds ? 'stock_count_chunk' : 'stock_count')
           .where('source_id', '=', itemIds ? itemIds[0] : sessionId)
           .where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

  async postService(queryable: DbOrTx, serviceId: number, revision: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const service = await queryable.selectFrom('services').selectAll().where('id', '=', serviceId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (!service) return { posted: false, journalEntryId: null };

    const amount = toBookMoney(service.amount);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    let bankAccountId = Number(settings?.bank_account_id || 0);
    if (!(bankAccountId > 0)) bankAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');

    const revenueAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '4200');

    const branchId = service.branch_id ? Number(service.branch_id) : null;
    const locationId = service.location_id ? Number(service.location_id) : null;
    const isCard = service.payment_channel === 'card';

    const lines: JournalLineDraft[] = [];
    if (isCard) {
      this.addLine(lines, { accountId: bankAccountId, description: `إيراد خدمة بنكي: ${service.name}`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    } else {
      this.addLine(lines, { accountId: cashAccountId, description: `إيراد خدمة نقدي: ${service.name}`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }
    this.addLine(lines, { accountId: revenueAccountId, description: `إيراد خدمة: ${service.name}`, debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);

    // Use composite source_id for idempotency on revisions
    const sourceIdComposite = Number(`${serviceId}000${revision}`);

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'service',
        sourceId: sourceIdComposite,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: service.service_date ? new Date(service.service_date) : new Date(),
        description: `قيد إيراد خدمة - #${serviceId} Rev ${revision}`,
        branchId,
        locationId,
        createdBy: service.created_by ? Number(service.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'service').where('source_id', '=', sourceIdComposite).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async reverseService(queryable: DbOrTx, serviceId: number, revision: number, auth: AuthContext): Promise<void> {
    const scope = requireTenantScope(auth);
    // Find the original journal entry for this specific revision
    const sourceIdComposite = Number(`${serviceId}000${revision}`);
    const original = await queryable.selectFrom('journal_entries').selectAll().where('source_type', '=', 'service').where('source_id', '=', sourceIdComposite).where('tenant_id', '=', scope.tenantId).where('status', '=', 'posted').executeTakeFirst();
    if (!original) return; // Nothing to reverse

    const originalLines = await queryable.selectFrom('journal_entry_lines').selectAll()
      .where('journal_entry_id', '=', original.id).where('tenant_id', '=', scope.tenantId).execute();

    const lines: JournalLineDraft[] = originalLines.map(l => ({
      accountId: Number(l.account_id),
      description: `عكس ${l.description}`,
      debit: Number(l.credit), // Flip
      credit: Number(l.debit), // Flip
      partnerType: l.partner_type as any,
      partnerId: l.partner_id ? Number(l.partner_id) : null,
      branchId: l.branch_id ? Number(l.branch_id) : null,
      locationId: l.location_id ? Number(l.location_id) : null,
    }));

    try {
      await this.insertPostedJournal(queryable, {
        sourceType: 'service_reversal',
        sourceId: sourceIdComposite,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `عكس قيد خدمة - #${serviceId} Rev ${revision}`,
        branchId: original.branch_id ? Number(original.branch_id) : null,
        locationId: original.location_id ? Number(original.location_id) : null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
    } catch (e: any) {
       if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
          // Already reversed
          return;
       }
       throw e;
    }
  }

  /**
   * Cash shortage tolerance per shift. Shortages at or below it are absorbed as an operating
   * expense; anything above becomes a receivable on the custodian. Defaults to 0 (no tolerance),
   * so the stricter treatment applies unless a tenant explicitly configures otherwise.
   */
  private async getCashierShortageTolerance(queryable: DbOrTx, tenantId: string): Promise<number> {
    try {
      const row = await queryable
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', tenantId)
        .where('key', '=', 'cashierShortageTolerance')
        .executeTakeFirst();
      if (!row?.value) return 0;
      let raw: unknown = row.value;
      try { raw = JSON.parse(String(row.value)); } catch { /* plain scalar */ }
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  async postCashierShiftVariance(queryable: DbOrTx, shiftId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const shift = await queryable.selectFrom('cashier_shifts').selectAll().where('id', '=', shiftId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
    if (!shift || shift.status !== 'closed') return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const expected = Number(shift.expected_cash || 0);
    const counted = Number(shift.counted_cash || 0);
    // Any non-zero book variance posts. The old < 0.01 gate dropped every
    // sub-cent variance from the GL while the shift stored it, so GL cash
    // and physical cash diverged by one shift's worth of fils, invisibly.
    const variance = toBookMoney(counted - expected);
    if (variance === 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const branchId = shift.branch_id ? Number(shift.branch_id) : null;
    const locationId = shift.location_id ? Number(shift.location_id) : null;

    // Shortages up to the configured tolerance are an operating cost of running a till.
    // Beyond it, the shortage is a debt of the custodian and must sit on a receivable in their name,
    // not be silently written off to expense.
    const shortageTolerance = await this.getCashierShortageTolerance(queryable, scope.tenantId);
    let resolution: 'within_tolerance' | 'charged_to_cashier' | 'surplus_recognized';
    let chargedToUserId: number | null = null;

    if (variance < 0) {
       const amount = Math.abs(variance);
       const custodianId = shift.opened_by ? Number(shift.opened_by) : null;
       const chargeToCashier = amount > shortageTolerance && custodianId !== null && custodianId > 0;

       if (chargeToCashier) {
         const receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1135');
         addBookLine({ accountId: receivableAccountId, description: `عجز وردية رقم #${shiftId} محمّل على أمين الصندوق`, debit: amount, credit: 0, partnerType: 'employee', partnerId: custodianId, branchId, locationId });
         resolution = 'charged_to_cashier';
         chargedToUserId = custodianId;
       } else {
         const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7210');
         addBookLine({ accountId: shortageAccountId, description: `عجز وردية رقم #${shiftId} ضمن حد التسامح`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
         resolution = 'within_tolerance';
       }
       addBookLine({ accountId: cashAccountId, description: `عجز وردية نقدية`, debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId });
    } else {
       // Overage. Never netted against another shift's shortage: it lands on its own income account.
       const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7110');
       const amount = variance;
       addBookLine({ accountId: cashAccountId, description: `زيادة وردية رقم #${shiftId}`, debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
       addBookLine({ accountId: overageAccountId, description: `زيادة وردية نقدية`, debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId, locationId });
       resolution = 'surplus_recognized';
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'cashier_shift_variance',
        sourceId: shiftId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: shift.closed_at ? new Date(shift.closed_at) : new Date(),
        description: `قيد فروقات وردية - #${shiftId}`,
        branchId,
        locationId,
        createdBy: shift.closed_by ? Number(shift.closed_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });

      await queryable
        .updateTable('cashier_shifts')
        .set({
          variance_resolution: resolution,
          variance_journal_entry_id: entryId,
          variance_charged_to_user_id: chargedToUserId,
          variance_approved_by: auth.userId ?? null,
          variance_approved_at: sql`NOW()`,
        } as any)
        .where('id', '=', shiftId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'cashier_shift_variance').where('source_id', '=', shiftId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPayrollAccrual(queryable: DbOrTx, runId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'hr_payroll_accrual')
      .where('source_id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    // INV-PAYROLL-ACCRUAL-PERIOD-END-DATE: the accrual belongs to
    // the wage period the work was performed in, so the journal is
    // dated at the run's period end — never at the approval date.
    // A missing or unreadable period end fails closed instead of
    // inventing a date (the manufacturing-date precedent). The
    // period-lock check in insertPostedJournal then rejects an
    // approval whose period is already closed, as it must.
    const runRow = await queryable
      .selectFrom('hr_payroll_runs')
      .select('end_date')
      .where('id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const accrualDate = runRow?.end_date ? new Date(runRow.end_date as unknown as string) : null;
    if (!accrualDate || Number.isNaN(accrualDate.getTime())) {
      throw new AppError('تاريخ نهاية فترة المسير غير موجود، لا يمكن ترحيل قيد الاستحقاق', 'HR_PAYROLL_ACCRUAL_PERIOD_END_MISSING', 409);
    }

    // Aggregate totals alone can hide offsetting corrupt payslips. Reject any
    // individual employee whose persisted wages/deductions do not reconcile.
    const invalidLine = await sql<{ employee_id: number }>`
      SELECT employee_id FROM hr_payroll_run_items
      WHERE run_id = ${runId} AND tenant_id = ${scope.tenantId}
        AND status = 'reviewed'
        AND (
          gross_pay <> net_pay + COALESCE(deduction_amount, 0)
            + COALESCE(loan_deduction_amount, 0)
            + COALESCE(asset_recovery_deduction_amount, 0)
          OR deduction_amount < COALESCE(employee_social_insurance, 0) + COALESCE(income_tax, 0)
          OR net_pay < 0 OR gross_pay < 0 OR deduction_amount < 0
          OR loan_deduction_amount < 0 OR asset_recovery_deduction_amount < 0
        )
      LIMIT 1
    `.execute(queryable);
    if (invalidLine.rows.length) {
      throw new AppError(
        `Payroll employee #${invalidLine.rows[0].employee_id} has an unreconciled payslip`,
        'HR_PAYROLL_LINE_ACCOUNTING_MISMATCH', 409,
      );
    }

    const totals = await queryable
      .selectFrom('hr_payroll_run_items')
      .select([
        sql<number>`COALESCE(SUM(gross_pay), 0)`.as('gross_pay'),
        sql<number>`COALESCE(SUM(net_pay), 0)`.as('net_pay'),
        sql<number>`COALESCE(SUM(loan_deduction_amount), 0)`.as('loan_deductions'),
        sql<number>`COALESCE(SUM(asset_recovery_deduction_amount), 0)`.as('asset_recovery_deductions'),
        sql<number>`COALESCE(SUM(deduction_amount), 0)`.as('operational_deductions'),
        sql<number>`COALESCE(SUM(employee_social_insurance), 0)`.as('employee_social_insurance'),
        sql<number>`COALESCE(SUM(employer_social_insurance), 0)`.as('employer_social_insurance'),
        sql<number>`COALESCE(SUM(income_tax), 0)`.as('income_tax'),
      ])
      .where('run_id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '!=', 'excluded')
      .executeTakeFirst();

    const grossPay = toBookMoney(totals?.gross_pay || 0);
    const netPay = toBookMoney(totals?.net_pay || 0);
    const loanDeductions = toBookMoney(totals?.loan_deductions || 0);
    const assetRecoveryDeductions = toBookMoney(totals?.asset_recovery_deductions || 0);
    const operationalDeductions = toBookMoney(totals?.operational_deductions || 0);
    const employeeInsurance = toBookMoney(totals?.employee_social_insurance || 0);
    const employerInsurance = toBookMoney(totals?.employer_social_insurance || 0);
    const incomeTax = toBookMoney(totals?.income_tax || 0);

    if (grossPay <= 0 && netPay <= 0 && loanDeductions <= 0 && assetRecoveryDeductions <= 0) {
      throw new AppError('Cannot accrue payroll with zero financial value', 'HR_PAYROLL_ZERO_VALUE', 400);
    }
    let allocation: ReturnType<typeof allocatePayrollAccrual>;
    try {
      allocation = allocatePayrollAccrual({
        grossPay, netPay, loanDeductions, assetRecoveryDeductions, operationalDeductions,
        employeeInsurance, employerInsurance, incomeTax,
      }, bookDigits);
    } catch (error) {
      throw new AppError(
        error instanceof Error ? error.message : 'Payroll totals cannot be reconciled',
        'HR_PAYROLL_ACCOUNTING_MISMATCH', 400,
      );
    }

    const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6200'); // Salaries and Wages
    const payableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2140'); // Payroll Payable
    const advancesAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160'); // Employee Advances
    const recoveryAccountId = assetRecoveryDeductions > 0
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100')
      : null; // Recovery of lost/damaged custody assets, NOT absenteeism income.

    const totalGosiPayable = toBookMoney(employeeInsurance + employerInsurance);

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    // 1. Debit: actual salary expense after attendance/leave/other wage reductions.
    // Attendance deductions are NOT unrelated operating revenue.
    addBookLine({
      accountId: expenseAccountId,
      description: `استحقاق رواتب مسير #${runId} (خصومات الأجور ${allocation.wageReduction})`,
      debit: allocation.salaryExpense,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    // 2. Debit: Employer Social Insurance Contribution (if any)
    if (employerInsurance > 0) {
      const employerGosiAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6210');
      addBookLine({
        accountId: employerGosiAccountId,
        description: `حصة المنشأة في التأمينات الاجتماعية لمسير #${runId}`,
        debit: employerInsurance,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 3. Credit: Net Payroll Payable
    if (netPay > 0) {
      addBookLine({
        accountId: payableAccountId,
        description: `رواتب مستحقة الدفع لمسير #${runId}`,
        debit: 0,
        credit: netPay,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 4. Credit: Social Insurance Authority Payable (Employee + Employer shares)
    if (totalGosiPayable > 0) {
      const gosiPayableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2145');
      addBookLine({
        accountId: gosiPayableAccountId,
        description: `تأمينات اجتماعية مستحقة السداد (حصة الموظف + المنشأة) لمسير #${runId}`,
        debit: 0,
        credit: totalGosiPayable,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 5. Credit: Income Tax Withholding Payable
    if (incomeTax > 0) {
      const taxPayableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2146');
      addBookLine({
        accountId: taxPayableAccountId,
        description: `ضريبة كسب عمل مستحقة لمسير #${runId}`,
        debit: 0,
        credit: incomeTax,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 6. Credit: Employee Advances (Loan installments)
    if (loanDeductions > 0) {
      addBookLine({
        accountId: advancesAccountId,
        description: `استقطاع سلف موظفين لمسير #${runId}`,
        debit: 0,
        credit: loanDeductions,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    // 7. Credit: asset loss/custody recovery only; the wage reductions are
    // already reflected in the debit to the salary expense account above.
    if (assetRecoveryDeductions > 0 && recoveryAccountId) {
      addBookLine({
        accountId: recoveryAccountId,
        description: `تحصيل تعويضات عهد مفقودة / تالفة من الرواتب - مسير #${runId}`,
        debit: 0,
        credit: allocation.assetRecoveryCredit,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_payroll_accrual',
        sourceId: runId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: accrualDate,
        description: `قيد استحقاق رواتب - مسير #${runId}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_payroll_round2a_uniq')) {
         const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_payroll_accrual').where('source_id', '=', runId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postPayrollPayment(queryable: DbOrTx, runId: number, paymentChannel: string, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'hr_payroll_payment')
      .where('source_id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const totals = await queryable
      .selectFrom('hr_payroll_run_items')
      .select([
        sql<number>`COALESCE(SUM(net_pay), 0)`.as('net_pay'),
      ])
      .where('run_id', '=', runId)
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'approved')
      .executeTakeFirst();

    const netPay = toBookMoney(totals?.net_pay || 0);

    if (netPay <= 0) {
       throw new AppError('Cannot pay payroll with zero net pay', 'HR_PAYROLL_PAYMENT_ZERO', 400);
    }

    const payableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2140'); // Payroll Payable
    // INV-PAYROLL-PAYMENT-CHANNEL-ACCOUNTS: the channel-to-account
    // map must match postPayrollItemPayment exactly — 'bank' pays
    // from 1120, every other channel ('cash', 'drawer') from cash
    // 1110. The old map sent 'drawer' to the bank although
    // payPayrollRun takes the money out of the cashier drawer, so
    // the journal credited a bank account that never paid.
    const paymentAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, paymentChannel === 'bank' ? '1120' : '1110');

    const lines: JournalLineDraft[] = [];

    addBookLine({ accountId: payableAccountId, description: `سداد رواتب مستحقة لمسير #${runId}`, debit: netPay, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null });
    addBookLine({ accountId: paymentAccountId, description: `دفع رواتب مسير #${runId}`, debit: 0, credit: netPay, partnerType: 'none', partnerId: null, branchId: null, locationId: null });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_payroll_payment',
        sourceId: runId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        // Payment journals stay dated at the payment date: cash
        // leaves on the day of payment, never at the period end.
        entryDate: new Date(),
        description: `قيد سداد رواتب - مسير #${runId}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_payroll_round2a_uniq')) {
         const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_payroll_payment').where('source_id', '=', runId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postPayrollItemPayment(
    queryable: DbOrTx,
    itemId: number,
    paymentChannel: string,
    auth: AuthContext,
    options?: { branchId?: number | null; locationId?: number | null; employeeName?: string }
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'hr_payroll_item_payment')
      .where('source_id', '=', itemId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const item = await queryable
      .selectFrom('hr_payroll_run_items')
      .select(['id', 'run_id', 'employee_id', 'net_pay', 'status'])
      .where('id', '=', itemId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!item) throw new AppError('بند الراتب غير موجود', 'HR_PAYROLL_ITEM_NOT_FOUND', 404);
    const netPay = toBookMoney(item.net_pay || 0);
    if (netPay <= 0) throw new AppError('صافي الأجر صفر أو سالب', 'HR_PAYROLL_PAYMENT_ZERO', 400);

    const payableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2140'); // Payroll Payable
    // INV-PAYROLL-PAYMENT-CHANNEL-ACCOUNTS: keep in sync with
    // postPayrollPayment — 'bank' pays from 1120, all other
    // channels ('cash', 'drawer') from cash 1110.
    const paymentAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, paymentChannel === 'bank' ? '1120' : '1110');

    const empLabel = options?.employeeName ? ` - ${options.employeeName}` : '';
    const lines: JournalLineDraft[] = [];
    addBookLine({
      accountId: payableAccountId,
      description: `سداد مستحقات أجر الموظف #${item.employee_id}${empLabel} (مسير #${item.run_id})`,
      debit: netPay,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: options?.branchId ?? null,
      locationId: options?.locationId ?? null,
    });
    addBookLine({
      accountId: paymentAccountId,
      description: `صرف أجر الموظف #${item.employee_id}${empLabel} عبر ${paymentChannel === 'drawer' ? 'درج الكاشير' : paymentChannel === 'bank' ? 'البنك' : 'الخزينة'}`,
      debit: 0,
      credit: netPay,
      partnerType: 'none',
      partnerId: null,
      branchId: options?.branchId ?? null,
      locationId: options?.locationId ?? null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_payroll_item_payment',
        sourceId: itemId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        // Same as the run payment: dated at the payment date.
        entryDate: new Date(),
        description: `قيد صرف أجر موظف #${item.employee_id}${empLabel} - مسير #${item.run_id}`,
        branchId: options?.branchId ?? null,
        locationId: options?.locationId ?? null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505') {
        const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_payroll_item_payment').where('source_id', '=', itemId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
        return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postEmployeeLoanDisbursement(queryable: DbOrTx, loanId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const tenantId = scope.tenantId;

    const existing = await queryable
        .selectFrom('journal_entries')
        .select(['id', 'status'])
        .where('source_type', '=', 'hr_employee_loan_disbursement')
        .where('source_id', '=', loanId)
        .where('tenant_id', '=', tenantId)
        .where('status', 'in', ['draft', 'posted'])
        .orderBy('id', 'desc')
        .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const loanResult = await queryable
      .selectFrom('hr_employee_loans')
      .selectAll()
      .where('id', '=', loanId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!loanResult) throw new AppError('Loan not found', 'NOT_FOUND', 404);
    if (loanResult.status !== 'paid') {
      throw new AppError('Loan must be disbursed to post accounting entry', 'HR_LOAN_NOT_DISBURSED', 400);
    }

    const amount = toBookMoney(loanResult.principal_amount);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const cashAcct = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', '1110')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!cashAcct) throw new AppError('Cash account 1110 not found', 'ACCOUNT_NOT_FOUND', 400);

    const advanceAcct = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', '1160')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!advanceAcct) throw new AppError('Employee Advances account 1160 not found', 'ACCOUNT_NOT_FOUND', 400);

    const lines: JournalLineDraft[] = [
      {
        accountId: advanceAcct.id,
        debit: amount,
        credit: 0,
        description: 'Employee Loan Disbursement #' + loanResult.id,
        partnerType: 'none',
        partnerId: null,
        branchId: loanResult.branch_id || null,
        locationId: loanResult.location_id || null,
      },
      {
        accountId: cashAcct.id,
        debit: 0,
        credit: amount,
        description: 'Cash Out - Loan Disbursement #' + loanResult.id,
        partnerType: 'none',
        partnerId: null,
        branchId: loanResult.branch_id || null,
        locationId: loanResult.location_id || null,
      },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_employee_loan_disbursement',
        sourceId: loanResult.id,
        tenantId,
        accountId: scope.accountId,
        entryDate: loanResult.disbursed_at || new Date(),
        description: 'Employee Loan Disbursement #' + loanResult.id,
        branchId: loanResult.branch_id || null,
        locationId: loanResult.location_id || null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_employee_loan_disb_uniq')) {
          const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_employee_loan_disbursement').where('source_id', '=', loanId).where('tenant_id', '=', tenantId).executeTakeFirst();
          return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postEmployeeLoanManualRepayment(queryable: DbOrTx, ledgerId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const tenantId = scope.tenantId;

    const existing = await queryable
        .selectFrom('journal_entries')
        .select(['id', 'status'])
        .where('source_type', '=', 'hr_employee_loan_repayment')
        .where('source_id', '=', ledgerId)
        .where('tenant_id', '=', tenantId)
        .where('status', 'in', ['draft', 'posted'])
        .orderBy('id', 'desc')
        .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const ledger = await queryable
      .selectFrom('hr_employee_ledger')
      .selectAll()
      .where('id', '=', ledgerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!ledger) throw new AppError('Ledger entry not found', 'NOT_FOUND', 404);
    if (ledger.entry_type !== 'loan_repayment' || ledger.repayment_method !== 'manual_cash') {
      throw new AppError('Invalid ledger entry for manual repayment posting', 'HR_LOAN_INVALID_REPAYMENT_LEDGER', 400);
    }

    const amount = Math.abs(toBookMoney(ledger.amount));
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const cashAcct = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', '1110')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!cashAcct) throw new AppError('Cash account 1110 not found', 'ACCOUNT_NOT_FOUND', 400);

    const advanceAcct = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', '1160')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!advanceAcct) throw new AppError('Employee Advances account 1160 not found', 'ACCOUNT_NOT_FOUND', 400);

    const lines: JournalLineDraft[] = [
      {
        accountId: cashAcct.id,
        debit: amount,
        credit: 0,
        description: 'Cash In - Loan Repayment #' + ledger.reference_id,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      },
      {
        accountId: advanceAcct.id,
        debit: 0,
        credit: amount,
        description: 'Employee Loan Repayment #' + ledger.reference_id,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      },
    ];

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_employee_loan_repayment',
        sourceId: ledger.id,
        tenantId,
        accountId: scope.accountId,
        entryDate: ledger.created_at || new Date(),
        description: 'Employee Loan Manual Repayment #' + ledger.reference_id,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_employee_loan_repay_uniq')) {
          const existingId = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'hr_employee_loan_repayment').where('source_id', '=', ledgerId).where('tenant_id', '=', tenantId).executeTakeFirst();
          return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }

  async postManufacturingWorkOrder(queryable: DbOrTx, workOrderId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    // Idempotency check using 'manufacturing_work_order' source
    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'manufacturing_work_order')
      .where('source_id', '=', workOrderId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const wo = await queryable.selectFrom('manufacturing_work_orders as wo')
      .innerJoin('manufacturing_boms as bom', 'bom.id', 'wo.bom_id')
      .select([
        'wo.total_cost',
        'wo.quantity_to_produce',
        'bom.overhead_cost',
        'wo.created_at',
        'wo.completed_at',
        'wo.created_by',
        'wo.destination_location_id'
      ])
      .where('wo.id', '=', workOrderId)
      .where('wo.tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!wo) return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const fgCost = toBookMoney(Number(wo.total_cost || 0));
    const consumed = await queryable.selectFrom('manufacturing_wo_consumptions as c')
      .innerJoin('manufacturing_work_orders as w', 'w.id', 'c.work_order_id')
      .select(sql<number>`coalesce(sum(c.line_total), 0)`.as('amount'))
      .where('w.tenant_id', '=', scope.tenantId).where('w.id', '=', workOrderId).executeTakeFirst();
    const rmCost = toBookMoney(consumed?.amount || 0);
    const overheadCost = toBookMoney(fgCost - rmCost);
    if (overheadCost < 0) throw new AppError('Manufacturing material costs exceed production value', 'MANUFACTURING_COST_MISMATCH', 409);

    if (fgCost <= 0) throw new AppError(`Manufacturing work order ${workOrderId} has no cost for ledger posting`, 'MANUFACTURING_COST_MISSING', 400);

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!inventoryAccountId) throw new AppError('Inventory account not configured and fallback 1140 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    let overheadAccountId = Number(settings?.manufacturing_overhead_account_id || 0);
    if (!(overheadAccountId > 0)) {
      overheadAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5400');
      if (!overheadAccountId) throw new AppError('Manufacturing Overhead account 5400 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    const lines: JournalLineDraft[] = [];
    const branchId = null;
    const locationId = wo.destination_location_id ? Number(wo.destination_location_id) : null;

    // 1. Debit FG (Inventory)
    this.addLine(lines, { accountId: inventoryAccountId, description: `منتج تام إضافي - أمر #${workOrderId}`, debit: fgCost, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);

    // 2. Credit RM (Inventory)
    if (rmCost > 0) {
      this.addLine(lines, { accountId: inventoryAccountId, description: `خامات مستهلكة - أمر #${workOrderId}`, debit: 0, credit: rmCost, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }

    // 3. Credit Overhead
    if (overheadCost > 0) {
      this.addLine(lines, { accountId: overheadAccountId, description: `مصاريف صناعية محملة - أمر #${workOrderId}`, debit: 0, credit: overheadCost, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'manufacturing_work_order',
        sourceId: workOrderId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: wo.completed_at ? new Date(wo.completed_at) : (() => { throw new AppError('Manufacturing completion date missing', 'MANUFACTURING_DATE_MISSING', 409); })(),
        description: `قيد أمر تصنيع #${workOrderId}`,
        branchId,
        locationId,
        createdBy: wo.created_by ? Number(wo.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
         const existing = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'manufacturing_work_order').where('source_id', '=', workOrderId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: existing ? existing.id : null };
      }
      throw e;
    }
  }
  // INV-MANUFACTURING-UNBUILD-JOURNAL: an unbuild used to move stock
  // with no journal at all. The balanced entry reads both legs from
  // the stamped stock movements -- the finished goods consumed at
  // their live WAC and the components recovered at theirs -- and
  // routes the difference to the price-variance account 5190
  // (decided 2026-10-31), debit when the finished goods were worth
  // more than the recovery, credit when the recovery is worth more.
  // A zero-cost unbuild posts nothing; 5190 is resolved through the
  // system-account resolver, which auto-creates it as a known system
  // account when absent.
  async postManufacturingUnbuildOrder(queryable: DbOrTx, unbuildId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const existing = await queryable.selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'manufacturing_unbuild_order')
      .where('source_id', '=', unbuildId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const order = await queryable.selectFrom('manufacturing_unbuild_orders')
      .select(['created_at', 'created_by', 'warehouse_id'])
      .where('id', '=', unbuildId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!order) return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const fgMovement = await queryable.selectFrom('stock_movements')
      .select('total_cost')
      .where('reference_type', '=', 'manufacturing_unbuild_order').where('reference_id', '=', unbuildId)
      .where('movement_type', '=', 'manufacturing_unbuild')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const recovered = await queryable.selectFrom('stock_movements')
      .select(sql<number>`coalesce(sum(total_cost), 0)`.as('amount'))
      .where('reference_type', '=', 'manufacturing_unbuild_order').where('reference_id', '=', unbuildId)
      .where('movement_type', '=', 'manufacturing_unbuild_recovery')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const fgCost = toBookMoney(fgMovement?.total_cost || 0);
    const recoveredCost = toBookMoney(recovered?.amount || 0);
    if (fgCost <= 0 && recoveredCost <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!inventoryAccountId) throw new AppError('Inventory account not configured and fallback 1140 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    const difference = roundMoney(fgCost - recoveredCost, bookDigits);
    // The system resolver auto-creates 5190 as a known system account
    // when it is absent (the same treatment GRN price variance gets);
    // it throws only when the accounting foundation itself is missing.
    const varianceAccountId = difference !== 0
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5190')
      : 0;

    const lines: JournalLineDraft[] = [];
    const branchId = null;
    const locationId = order.warehouse_id ? Number(order.warehouse_id) : null;

    if (recoveredCost > 0) {
      this.addLine(lines, { accountId: inventoryAccountId, description: `مواد مسترجعة من تفكيك - أمر #${unbuildId}`, debit: recoveredCost, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }
    if (fgCost > 0) {
      this.addLine(lines, { accountId: inventoryAccountId, description: `منتج تام مفكك - أمر #${unbuildId}`, debit: 0, credit: fgCost, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }
    if (difference > 0) {
      this.addLine(lines, { accountId: varianceAccountId, description: `فرق تفكيك - أمر #${unbuildId}`, debit: difference, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    } else if (difference < 0) {
      this.addLine(lines, { accountId: varianceAccountId, description: `فرق تفكيك - أمر #${unbuildId}`, debit: 0, credit: -difference, partnerType: 'none', partnerId: null, branchId, locationId }, bookDigits);
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'manufacturing_unbuild_order',
        sourceId: unbuildId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: order.created_at ? new Date(order.created_at) : new Date(),
        description: `قيد أمر تفكيك #${unbuildId}`,
        branchId,
        locationId,
        createdBy: order.created_by ? Number(order.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
         const existingEntry = await queryable.selectFrom('journal_entries').select('id').where('source_type', '=', 'manufacturing_unbuild_order').where('source_id', '=', unbuildId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
         return { posted: false, journalEntryId: existingEntry ? existingEntry.id : null };
      }
      throw e;
    }
  }
  async postDeliveryRepSettlement(queryable: DbOrTx, saleId: number, amount: number, branchId: number | null, locationId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    if (!Number.isFinite(amount) || amount < 0) throw new AppError('Invalid delivery settlement', 'DELIVERY_SETTLEMENT_INVALID', 400);

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

    const totalDebt = toBookMoney(sale.total);
    const fee = toBookMoney(totalDebt - amount);
    if (fee < 0 || (fee > 0 && Math.abs(fee - Number(sale.delivery_fee || 0)) > this.maxAllowedDifference(bookDigits))) throw new AppError('Delivery settlement does not reconcile with courier fee', 'DELIVERY_SETTLEMENT_INVALID', 409);
    const lines: JournalLineDraft[] = [];
    if (fee > 0) {
      const expenseId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6400');
      addBookLine({ accountId: expenseId, description: 'رسوم مندوب حر مخصومة من التحصيل', debit: fee, credit: 0, partnerType: 'none', partnerId: null, branchId, locationId });
    }
    addBookLine({
      accountId: cashAccountId,
      description: `تحصيل من مندوب عن فاتورة #${sale.doc_no || saleId}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: customerAccountId,
      description: `تسديد مديونية فاتورة #${sale.doc_no || saleId}`,
      debit: 0,
      credit: totalDebt,
      partnerType: sale.customer_id ? 'customer' : 'none',
      partnerId: sale.customer_id ? Number(sale.customer_id) : null,
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

    if (expected <= 0 && counted <= 0 && tripExpenses <= 0 && stockShortage <= 0) return { posted: false, journalEntryId: null };
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
    params: { amount: number; customerId: number; branchId: number | null; locationId: number | null; paymentMethod?: string },
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
      items: { productId: number; qty: number; costPrice: number }[];
      branchId: number | null;
      locationId: number | null;
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

    const cogsAmount = toBookMoney(params.items.reduce((sum, it) => sum + (Number(it.qty || 0) * Number(it.costPrice || 0)), 0));
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

  async postPdcChequeReceive(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const notesInSafeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');
    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let customerArId = Number(settings?.customer_receivable_account_id || 0);
    if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: notesInSafeId,
      description: `ورقة قبض في الخزينة - شيك #${cheque.cheque_number} (${cheque.bank_name})`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: customerArId,
      description: `استلام شيك قبض #${cheque.cheque_number} من ${cheque.partner_name}`,
      debit: 0,
      credit: amount,
      partnerType: cheque.partner_id ? 'customer' : 'none',
      partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_receive',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.issue_date ? new Date(cheque.issue_date) : new Date(),
        description: `قيد استلام ورقة قبض #${cheque.cheque_number} من ${cheque.partner_name}`,
        branchId: null,
        locationId: null,
        createdBy: cheque.created_by ? Number(cheque.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_receive')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeDeposit(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const notesUnderCollId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121');
    const notesInSafeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: notesUnderCollId,
      description: `ورقة قبض برسم التحصيل - شيك #${cheque.cheque_number}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: notesInSafeId,
      description: `إيداع شيك قبض #${cheque.cheque_number} للتحصيل`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_deposit',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.deposit_date ? new Date(cheque.deposit_date) : new Date(),
        description: `قيد إيداع ورقة قبض برسم التحصيل #${cheque.cheque_number}`,
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
          .where('source_type', '=', 'pdc_cheque_deposit')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeCollect(queryable: DbOrTx, chequeId: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    // Debit Bank account
    let debitBankId = bankAccountId && Number(bankAccountId) > 0 ? Number(bankAccountId) : Number(cheque.deposit_bank_id || 0);
    if (!(debitBankId > 0)) {
      const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
      debitBankId = Number(settings?.bank_account_id || 0);
      if (!(debitBankId > 0)) debitBankId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');
    }

    // Credit account: was it under collection or in safe?
    const wasUnderCollection = cheque.status === 'under_collection';
    const creditAccountId = wasUnderCollection
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121')
      : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');

    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const settlementAmount = toBookMoney((cheque as any).settlement_base_amount ?? amount);
    const bank = await queryable.selectFrom('accounting_accounts').select('id').where('tenant_id', '=', scope.tenantId).where('id', '=', debitBankId).where('is_active', '=', true).where('is_cash_bank', '=', true).executeTakeFirst();
    if (!bank) throw new AppError('Invalid cheque settlement bank', 'INVALID_CHEQUE_BANK', 400);
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: debitBankId,
      description: `تحصيل ورقة قبض #${cheque.cheque_number} في البنك`,
      debit: settlementAmount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: creditAccountId,
      description: `إقفال ورقة قبض #${cheque.cheque_number} بعد التحصيل`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    const cashDifference = toBookMoney(settlementAmount - amount);
    const gain = cashDifference > 0;
    if (cashDifference !== 0) {
      const fxAccount = await this.resolveSystemAccountByCode(queryable, scope.tenantId, gain ? '7170' : '7270');
      addBookLine({ accountId: fxAccount, description: 'فرق صرف محقق عند تسوية الشيك', debit: gain ? 0 : Math.abs(cashDifference), credit: gain ? Math.abs(cashDifference) : 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_collect',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.cleared_date ? new Date(cheque.cleared_date) : new Date(),
        description: `قيد تحصيل ورقة قبض #${cheque.cheque_number} بحساب البنك`,
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
          .where('source_type', '=', 'pdc_cheque_collect')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeBounce(queryable: DbOrTx, chequeId: number, bouncedFee: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let customerArId = Number(settings?.customer_receivable_account_id || 0);
    if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const wasUnderCollection = cheque.status === 'under_collection';
    const creditAccountId = wasUnderCollection
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121')
      : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    // Restore Customer balance
    addBookLine({
      accountId: customerArId,
      description: `ارتداد شيك #${cheque.cheque_number} - إعادة المديونية للعميل ${cheque.partner_name}`,
      debit: amount,
      credit: 0,
      partnerType: cheque.partner_id ? 'customer' : 'none',
      partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: creditAccountId,
      description: `إلغاء ورقة قبض مرتدة #${cheque.cheque_number}`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    // Bank fee for bounced cheque if any
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const fee = toBookMoney(bouncedFee);
    if (fee > 0) {
      const bankFeeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6800');
      let bankId = bankAccountId && Number(bankAccountId) > 0 ? Number(bankAccountId) : Number(cheque.deposit_bank_id || 0);
      if (!(bankId > 0)) {
        bankId = Number(settings?.bank_account_id || 0);
        if (!(bankId > 0)) bankId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');
      }
      addBookLine({
        accountId: bankFeeId,
        description: `عمولة ومصاريف ارتداد شيك #${cheque.cheque_number}`,
        debit: fee,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: bankId,
        description: `خصم مصاريف بنكية لشيك مرتد #${cheque.cheque_number}`,
        debit: 0,
        credit: fee,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_bounce',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.bounced_date ? new Date(cheque.bounced_date) : new Date(),
        description: `قيد ارتداد ورقة قبض #${cheque.cheque_number} للعميل ${cheque.partner_name}`,
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
          .where('source_type', '=', 'pdc_cheque_bounce')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeEndorse(queryable: DbOrTx, chequeId: number, supplierId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let supplierApId = Number(settings?.supplier_payable_account_id || 0);
    if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');

    const notesInSafeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');
    const targetSupplierId = supplierId || cheque.endorsed_to_supplier_id;

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: supplierApId,
      description: `تظهير ورقة قبض #${cheque.cheque_number} سداداً لمستحقات المورد`,
      debit: amount,
      credit: 0,
      partnerType: targetSupplierId ? 'supplier' : 'none',
      partnerId: targetSupplierId ? Number(targetSupplierId) : null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: notesInSafeId,
      description: `خروج ورقة قبض #${cheque.cheque_number} من الخزينة بالتظهير`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_endorse',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : new Date(),
        description: `قيد تظهير ورقة قبض #${cheque.cheque_number} للمورد`,
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
          .where('source_type', '=', 'pdc_cheque_endorse')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeIssue(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let supplierApId = Number(settings?.supplier_payable_account_id || 0);
    if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');

    const notesPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: supplierApId,
      description: `إصدار ورقة دفع #${cheque.cheque_number} للمورد ${cheque.partner_name}`,
      debit: amount,
      credit: 0,
      partnerType: cheque.partner_id ? 'supplier' : 'none',
      partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: notesPayableId,
      description: `ورقة دفع مصدرة #${cheque.cheque_number} للمورد ${cheque.partner_name}`,
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_issue',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.issue_date ? new Date(cheque.issue_date) : new Date(),
        description: `قيد إصدار ورقة دفع #${cheque.cheque_number} للمورد ${cheque.partner_name}`,
        branchId: null,
        locationId: null,
        createdBy: cheque.created_by ? Number(cheque.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_pdc_and_wht_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'pdc_cheque_issue')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequeClear(queryable: DbOrTx, chequeId: number, bankAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const notesPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');

    let bankId = bankAccountId && Number(bankAccountId) > 0 ? Number(bankAccountId) : Number(cheque.deposit_bank_id || 0);
    if (!(bankId > 0)) {
      const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
      bankId = Number(settings?.bank_account_id || 0);
      if (!(bankId > 0)) bankId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1120');
    }

    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const settlementAmount = toBookMoney((cheque as any).settlement_base_amount ?? amount);
    const bank = await queryable.selectFrom('accounting_accounts').select('id').where('tenant_id', '=', scope.tenantId).where('id', '=', bankId).where('is_active', '=', true).where('is_cash_bank', '=', true).executeTakeFirst();
    if (!bank) throw new AppError('Invalid cheque settlement bank', 'INVALID_CHEQUE_BANK', 400);
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: notesPayableId,
      description: `صرف وإقفال ورقة دفع #${cheque.cheque_number}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: bankId,
      description: `خصم ورقة دفع منصرفة #${cheque.cheque_number} من حساب البنك`,
      debit: 0,
      credit: settlementAmount,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });

    const cashDifference = toBookMoney(settlementAmount - amount);
    const gain = cashDifference < 0;
    if (cashDifference !== 0) {
      const fxAccount = await this.resolveSystemAccountByCode(queryable, scope.tenantId, gain ? '7170' : '7270');
      addBookLine({ accountId: fxAccount, description: 'فرق صرف محقق عند تسوية الشيك', debit: gain ? 0 : Math.abs(cashDifference), credit: gain ? Math.abs(cashDifference) : 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_clear',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.cleared_date ? new Date(cheque.cleared_date) : new Date(),
        description: `قيد صرف ورقة دفع #${cheque.cheque_number} من البنك`,
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
          .where('source_type', '=', 'pdc_cheque_clear')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  async postPdcChequePayableBounce(queryable: DbOrTx, chequeId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const notesPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let supplierApId = Number(settings?.supplier_payable_account_id || 0);
    if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: notesPayableId,
      description: `إلغاء ورقة دفع مرتدة #${cheque.cheque_number}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId: null,
      locationId: null,
    });
    addBookLine({
      accountId: supplierApId,
      description: `إعادة مديونية المورد ${cheque.partner_name} بسبب ارتداد شيك #${cheque.cheque_number}`,
      debit: 0,
      credit: amount,
      partnerType: cheque.partner_id ? 'supplier' : 'none',
      partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
      branchId: null,
      locationId: null,
    });

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'pdc_cheque_payable_bounce',
        sourceId: chequeId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : cheque.bounced_date ? new Date(cheque.bounced_date) : new Date(),
        description: `قيد ارتداد ورقة دفع #${cheque.cheque_number} وإعادة المديونية للمورد ${cheque.partner_name}`,
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
          .where('source_type', '=', 'pdc_cheque_payable_bounce')
          .where('source_id', '=', chequeId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }

  private async exactPdcReversalSource(queryable: DbOrTx, tenantId: string, candidateId: number | null, lines: JournalLineDraft[]): Promise<number | null> {
    if (!candidateId) return null;
    const header = await queryable.selectFrom('journal_entries').select('id').where('tenant_id', '=', tenantId)
      .where('id', '=', candidateId).where('status', '=', 'posted').where('reversed_by_entry_id', 'is', null).forUpdate().executeTakeFirst();
    if (!header) return null;
    const prior = await queryable.selectFrom('journal_entry_lines').selectAll().where('tenant_id', '=', tenantId).where('journal_entry_id', '=', candidateId).execute();
    const original = prior.map(line => ({ accountId: Number(line.account_id), debit: Number(line.debit), credit: Number(line.credit),
      partnerType: line.partner_type, partnerId: line.partner_id, branchId: line.branch_id, locationId: line.location_id, costCenterId: line.cost_center_id }));
    return areOppositeJournalLines(original, lines) ? candidateId : null;
  }

  async postPdcChequeCancelOrReturn(
    queryable: DbOrTx,
    chequeId: number,
    action: 'cancel' | 'return',
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque || !cheque.journal_entry_id) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    if (cheque.type === 'receivable') {
      let customerArId = Number(settings?.customer_receivable_account_id || 0);
      if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
      // The cheque row is read before the status update, so status is the pre-cancel state.
      const notesAccountId = cheque.status === 'under_collection'
        ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121')
        : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');

      addBookLine({
        accountId: customerArId,
        description: `إلغاء/رد ورقة قبض #${cheque.cheque_number} - إعادة المديونية للعميل ${cheque.partner_name}`,
        debit: amount,
        credit: 0,
        partnerType: cheque.partner_id ? 'customer' : 'none',
        partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: notesAccountId,
        description: `إلغاء/رد ورقة قبض #${cheque.cheque_number}`,
        debit: 0,
        credit: amount,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
    } else {
      let supplierApId = Number(settings?.supplier_payable_account_id || 0);
      if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');
      const payablePdcId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');

      addBookLine({
        accountId: payablePdcId,
        description: `إلغاء/رد ورقة دفع #${cheque.cheque_number}`,
        debit: amount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId: null,
        locationId: null,
      });
      addBookLine({
        accountId: supplierApId,
        description: `إلغاء/رد ورقة دفع #${cheque.cheque_number} - إعادة التزام المورد ${cheque.partner_name}`,
        debit: 0,
        credit: amount,
        partnerType: cheque.partner_id ? 'supplier' : 'none',
        partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
        branchId: null,
        locationId: null,
      });
    }

    const actionText = action === 'cancel' ? 'إلغاء' : 'رد';
    const reversalOfEntryId = await this.exactPdcReversalSource(queryable, scope.tenantId, Number(cheque.journal_entry_id) || null, lines);
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: `pdc_cheque_${action}`,
      sourceId: chequeId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : new Date(),
      description: `قيد ${actionText} شيك #${cheque.cheque_number} (${cheque.type === 'receivable' ? 'قبض' : 'دفع'}) لـ ${cheque.partner_name}`,
      reversalOfEntryId,
      branchId: null,
      locationId: null,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
    });
    return { posted: true, journalEntryId: entryId };
  }

  async postPdcChequeRestore(
    queryable: DbOrTx,
    chequeId: number,
    previousStatus: string,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const cheque = await queryable
      .selectFrom('accounting_cheques')
      .selectAll()
      .where('id', '=', chequeId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!cheque) return { posted: false, journalEntryId: null };
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = pdcBookAmount(cheque as any, bookDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    let description = '';

    if (cheque.type === 'receivable' && previousStatus === 'bounced') {
      let customerArId = Number(settings?.customer_receivable_account_id || 0);
      if (!(customerArId > 0)) customerArId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
      const safeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');
      addBookLine({
        accountId: safeAccountId,
        description: `إعادة إيداع شيك مرتد في الخزينة #${cheque.cheque_number}`,
        debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      });
      addBookLine({
        accountId: customerArId,
        description: `تسوية مديونية العميل ${cheque.partner_name} بعد استعادة الشيك للخزينة #${cheque.cheque_number}`,
        debit: 0, credit: amount,
        partnerType: cheque.partner_id ? 'customer' : 'none',
        partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
        branchId: null, locationId: null,
      });
      description = `قيد استعادة شيك مرتد #${cheque.cheque_number} إلى الخزينة`;
    } else if (cheque.type === 'receivable' && previousStatus === 'under_collection') {
      const safeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1122');
      const underCollectionId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1121');
      addBookLine({
        accountId: safeAccountId,
        description: `سحب شيك #${cheque.cheque_number} من التحصيل وإعادته للخزينة`,
        debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      });
      addBookLine({
        accountId: underCollectionId,
        description: `إقفال ورقة قبض برسم التحصيل #${cheque.cheque_number}`,
        debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      });
      description = `قيد سحب شيك #${cheque.cheque_number} من التحصيل إلى الخزينة`;
    } else if (cheque.type === 'payable' && previousStatus === 'bounced') {
      let supplierApId = Number(settings?.supplier_payable_account_id || 0);
      if (!(supplierApId > 0)) supplierApId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2110');
      const notesPayableId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2135');
      addBookLine({
        accountId: supplierApId,
        description: `إعادة إصدار ورقة دفع مرتدة #${cheque.cheque_number} للمورد ${cheque.partner_name}`,
        debit: amount, credit: 0,
        partnerType: cheque.partner_id ? 'supplier' : 'none',
        partnerId: cheque.partner_id ? Number(cheque.partner_id) : null,
        branchId: null, locationId: null,
      });
      addBookLine({
        accountId: notesPayableId,
        description: `ورقة دفع قائمة #${cheque.cheque_number}`,
        debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId: null, locationId: null,
      });
      description = `قيد إعادة إصدار ورقة دفع مرتدة #${cheque.cheque_number}`;
    } else {
      return { posted: false, journalEntryId: null };
    }

    const priorSourceType = previousStatus === 'under_collection'
      ? 'pdc_cheque_deposit'
      : (cheque.type === 'receivable' ? 'pdc_cheque_bounce' : 'pdc_cheque_payable_bounce');
    const priorEntry = await queryable
      .selectFrom('journal_entries')
      .select(['id'])
      .where('tenant_id', '=', scope.tenantId)
      .where('source_type', '=', priorSourceType)
      .where('source_id', '=', chequeId)
      .where('reversed_by_entry_id', 'is', null)
      .orderBy('id', 'desc')
      .executeTakeFirst();

    const reversalOfEntryId = await this.exactPdcReversalSource(queryable, scope.tenantId, Number(priorEntry?.id) || null, lines);
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'pdc_cheque_restore',
      sourceId: chequeId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: (cheque as any).last_action_date ? new Date((cheque as any).last_action_date) : new Date(),
      description,
      branchId: null,
      locationId: null,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
      // Fees remain incurred; a changed custody account also prevents an exact
      // reversal link. Such restorations remain independently traceable events.
      reversalOfEntryId,
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

  async postEndOfServiceSettlement(queryable: DbOrTx, settlementId: number, treasuryAccountId: number | null, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const settlement = await queryable
      .selectFrom('hr_end_of_service_settlements')
      .selectAll()
      .where('id', '=', settlementId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();

    if (!settlement) {
      throw new AppError('End of service settlement not found', 'HR_EOS_NOT_FOUND', 404);
    }

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'hr_end_of_service_settlement')
      .where('source_id', '=', settlementId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const gratuity = toBookMoney(settlement.gratuity_amount || 0);
    const leavePay = toBookMoney(settlement.leave_encashment_amount || 0);
    const pendingSalary = toBookMoney(settlement.pending_salary_amount || 0);
    const noticePeriod = toBookMoney(settlement.notice_period_amount || 0);
    const otherEntitlements = toBookMoney(settlement.other_entitlements_amount || 0);
    const totalEntitlements = toBookMoney(gratuity + leavePay + pendingSalary + noticePeriod + otherEntitlements);

    const unpaidLoans = toBookMoney(settlement.unpaid_loans_deduction || 0);
    const assetsDeduction = toBookMoney(settlement.assets_deduction || 0);
    const otherDeductions = toBookMoney(settlement.other_deductions || 0);

    if (totalEntitlements <= 0) {
      throw new AppError('Cannot post end of service settlement with zero entitlements', 'HR_EOS_ZERO_VALUE', 400);
    }

    // Absorption invariant: Deductions cannot exceed total entitlements in the settlement payout.
    // Any excess deductions remain as uncollected employee debts.
    let remainingPool = totalEntitlements;

    const appliedAssets = Math.min(assetsDeduction, remainingPool);
    remainingPool = toBookMoney(remainingPool - appliedAssets);

    const appliedOther = Math.min(otherDeductions, remainingPool);
    remainingPool = toBookMoney(remainingPool - appliedOther);

    const appliedLoans = Math.min(unpaidLoans, remainingPool);
    remainingPool = toBookMoney(remainingPool - appliedLoans);

    const netPayable = remainingPool;

    const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6200'); // Salaries & EOS Expense
    const advancesAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160'); // Employee Advances
    const otherIncomeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100'); // Other Income / Custody Recovery

    let paymentAccountId: number;
    if (treasuryAccountId && Number(treasuryAccountId) > 0) {
      paymentAccountId = Number(treasuryAccountId);
    } else {
      const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
      paymentAccountId = Number(settings?.cash_account_id || 0);
      if (!(paymentAccountId > 0)) {
        paymentAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');
      }
    }

    const lines: JournalLineDraft[] = [];

    // 1. Debit: Total Entitlements
    addBookLine({
      accountId: expenseAccountId,
      description: `استحقاق مخالصة ومكافأة نهاية خدمة #${settlement.settlement_no}`,
      debit: totalEntitlements,
      credit: 0,
      partnerType: 'employee',
      partnerId: Number(settlement.employee_id),
      branchId: null,
      locationId: null,
    });

    // 2. Credit: Loan deduction (if any)
    if (appliedLoans > 0) {
      addBookLine({
        accountId: advancesAccountId,
        description: `تسوية سلف مستحقة للموظف بمخالصة #${settlement.settlement_no}`,
        debit: 0,
        credit: appliedLoans,
        partnerType: 'employee',
        partnerId: Number(settlement.employee_id),
        branchId: null,
        locationId: null,
      });
    }

    // 3. Credit: Asset / Custody deduction (if any)
    if (appliedAssets > 0) {
      addBookLine({
        accountId: otherIncomeAccountId,
        description: `استرداد وتسوية عهدة بمخالصة #${settlement.settlement_no}`,
        debit: 0,
        credit: appliedAssets,
        partnerType: 'employee',
        partnerId: Number(settlement.employee_id),
        branchId: null,
        locationId: null,
      });
    }

    // 4. Credit: Other deductions (if any)
    if (appliedOther > 0) {
      addBookLine({
        accountId: otherIncomeAccountId,
        description: `استقطاعات أخرى بمخالصة #${settlement.settlement_no}`,
        debit: 0,
        credit: appliedOther,
        partnerType: 'employee',
        partnerId: Number(settlement.employee_id),
        branchId: null,
        locationId: null,
      });
    }

    // 5. Credit: Net settlement payable / payout
    if (netPayable > 0) {
      addBookLine({
        accountId: paymentAccountId,
        description: `صرف مستحقات مخالصة نهاية الخدمة #${settlement.settlement_no}`,
        debit: 0,
        credit: netPayable,
        partnerType: 'employee',
        partnerId: Number(settlement.employee_id),
        branchId: null,
        locationId: null,
      });
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'hr_end_of_service_settlement',
        sourceId: settlementId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: settlement.settlement_date ? new Date(settlement.settlement_date) : new Date(),
        description: `قيد تصفية ومخالصة نهاية خدمة #${settlement.settlement_no}`,
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && (e.constraint?.includes('idx_journal_entries_hr_eos_uniq') || e.constraint?.includes('idx_journal_entries_round1_uniq'))) {
        const existingId = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'hr_end_of_service_settlement')
          .where('source_id', '=', settlementId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existingId?.id || 0) };
      }
      throw e;
    }
  }


  /**
   * يسجّل أن قيد هذا المستند لم يُرحَّل — **بدل أن يُبتلع الخطأ في سطر سجلّ**.
   *
   * الكتابة تجري داخل نفس معاملة المستند، فإما أن تُحفظ الفاتورة ومعها أثر فشلها، أو لا تُحفظ
   * أصلاً. لا توجد حالة ثالثة تكون فيها فاتورةٌ بلا قيد وبلا أثر — وهي الحالة التي مرّت بها
   * 2,281 فاتورة على الإنتاج قبل هذا.
   */
  async recordPostingFailure(
    queryable: DbOrTx,
    scope: { tenantId: string; accountId: string },
    sourceType: string,
    sourceId: number,
    errorMessage: string,
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO accounting_posting_failures
          (tenant_id, account_id, source_type, source_id, error_message, attempts, first_failed_at, last_attempt_at, resolved_at)
        VALUES
          (${scope.tenantId}, ${scope.accountId}, ${sourceType}, ${sourceId}, ${String(errorMessage).slice(0, 2000)}, 1, NOW(), NOW(), NULL)
        ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE
        SET attempts = accounting_posting_failures.attempts + 1,
            error_message = EXCLUDED.error_message,
            last_attempt_at = NOW(),
            resolved_at = NULL
      `.execute(queryable);
    } catch (error) {
      // آخر خط: لو تعذّر حتى تسجيل الفشل فلا نُسقط البيعة بسببه، لكن لا نتركه صامتاً.
      this.logger.error(
        `Could not record the posting failure for ${sourceType} ${sourceId}: `
        + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** يُغلق سجل فشل سابق بعد نجاح الترحيل. */
  async clearPostingFailure(
    queryable: DbOrTx,
    scope: { tenantId: string; accountId: string },
    sourceType: string,
    sourceId: number,
  ): Promise<void> {
    try {
      await sql`
        UPDATE accounting_posting_failures
        SET resolved_at = NOW(), last_attempt_at = NOW()
        WHERE tenant_id = ${scope.tenantId}
          AND source_type = ${sourceType}
          AND source_id = ${sourceId}
          AND resolved_at IS NULL
      `.execute(queryable);
    } catch {
      // لا شيء: عدم إغلاق سجل قديم أهون من إسقاط عملية ناجحة.
    }
  }

  /**
   * Cash drawer manual cash_in and cash_out double-entry posting
   */
  async postCashDrawerMovement(
    queryable: DbOrTx,
    txnId: number,
    movementType: 'cash_in' | 'cash_out' | string,
    amount: number,
    note: string,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const moneyAmount = this.toMoney(amount, bookDigits);
    if (moneyAmount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    if (movementType === 'cash_in') {
      const incomeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({
        accountId: cashAccountId,
        description: `توريد نقدية للدرج: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: incomeAccountId,
        description: `إيرادات / توريدات نقدية متفرقة: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (movementType === 'cash_out') {
      let expenseAccountId = Number(settings?.expenses_account_id || 0);
      if (!(expenseAccountId > 0)) expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6950');
      addBookLine({
        accountId: expenseAccountId,
        description: `صرف نقدية من الدرج: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: cashAccountId,
        description: `سحب نقدية من الدرج: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else {
      return { posted: false, journalEntryId: null };
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: `cash_drawer_${movementType}`,
      sourceId: txnId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد حركة درج نقدية #${txnId} (${movementType === 'cash_in' ? 'توريد' : 'صرف'})`,
      branchId,
      locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
    });
    return { posted: true, journalEntryId: entryId };
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

  /**
   * Customer installment plan finance interest double-entry posting
   */
  async postCustomerInstallmentInterest(
    queryable: DbOrTx,
    planId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);


    const plan = await queryable
      .selectFrom('customer_installment_plans')
      .selectAll()
      .where('id', '=', planId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!plan) return { posted: false, journalEntryId: null };
    const interest = toBookMoney(plan.interest_amount);
    if (interest <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let arAccountId = Number(settings?.customer_receivable_account_id || 0);
    if (!(arAccountId > 0)) arAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');
    const financeIncomeId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '2155');

    const lines: JournalLineDraft[] = [];
    addBookLine({
      accountId: arAccountId,
      description: `فوائد تقسيط - خطة تقسيط #${plan.plan_number}`,
      debit: interest,
      credit: 0,
      partnerType: plan.customer_id ? 'customer' : 'none',
      partnerId: plan.customer_id ? Number(plan.customer_id) : null,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
    });
    addBookLine({
      accountId: financeIncomeId,
      description: `فوائد تمويل غير مكتسبة - خطة تقسيط #${plan.plan_number}`,
      debit: 0,
      credit: interest,
      partnerType: 'none',
      partnerId: null,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
    });

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'customer_installment_interest',
      sourceId: planId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: plan.created_at ? new Date(plan.created_at) : new Date(),
      description: `قيد فوائد تمويل خطة تقسيط #${plan.plan_number}`,
      branchId: plan.branch_id ? Number(plan.branch_id) : null,
      locationId: null,
      createdBy: plan.created_by ? Number(plan.created_by) : auth.userId,
      postedBy: auth.userId,
      lines,
    });
    const installments = await queryable.selectFrom('customer_installments').select(['id', 'amount', 'due_date'])
      .where('tenant_id', '=', scope.tenantId).where('plan_id', '=', planId).orderBy('installment_number').execute();
    const allocations = allocateInstallmentInterest(Number(plan.financed_amount), installments.map(item => Number(item.amount)), interest, bookDigits);
    const createdDay = new Date(plan.created_at).toISOString().slice(0, 10);
    for (const [index, item] of installments.entries()) {
      const amount = allocations[index];
      if (!amount) continue;
      const dueDay = new Date(item.due_date).toISOString().slice(0, 10);
      const recognitionDay = dueDay < createdDay ? createdDay : dueDay;
      await sql`insert into accounting_installment_interest (tenant_id, plan_id, installment_id, recognition_date, amount, account_id)
        values (${scope.tenantId}, ${planId}, ${item.id}, ${recognitionDay}, ${amount}, ${scope.accountId})
        on conflict (tenant_id, installment_id) do nothing`.execute(queryable);
    }
    return { posted: true, journalEntryId: entryId };
  }
  /** Daily and closing callers share one locked accrual path; no historical plan is guessed. */
  async recognizeInstallmentInterest(queryable: DbOrTx, tenantId: string, throughDate: string, createdBy: number | null = null): Promise<void> {
    if (!queryable.isTransaction) return queryable.transaction().execute(trx => this.recognizeInstallmentInterest(trx, tenantId, throughDate, createdBy));
    await lockAccountingPeriod(queryable, tenantId);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);

    const pending = await sql<{ id: number; amount: number; recognition_date: string | Date; account_id: string; branch_id: number | null }>`
      select i.id, i.amount, i.recognition_date, i.account_id, p.branch_id from accounting_installment_interest i
      join customer_installment_plans p on p.id = i.plan_id and p.tenant_id = i.tenant_id
      where i.tenant_id = ${tenantId} and i.journal_entry_id is null and i.recognition_date <= ${throughDate}::date
      order by i.recognition_date, i.id for update of i
    `.execute(queryable);
    if (!pending.rows.length) return;
    const deferred = await this.resolveSystemAccountByCode(queryable, tenantId, '2155');
    const revenue = await this.resolveSystemAccountByCode(queryable, tenantId, '7100');
    for (const item of pending.rows) {
      const amount = toBookMoney(item.amount);
      const entryId = await this.postDomainJournal(queryable, { tenantId, accountId: item.account_id || tenantId, sourceType: 'installment_interest_accrual', sourceId: Number(item.id),
        entryDate: new Date(item.recognition_date), branchId: item.branch_id, description: 'استحقاق إيراد فوائد التمويل وفق العائد الفعلي', createdBy,
        lines: [
          { accountId: deferred, description: 'تحرير فوائد التمويل المكتسبة', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId: item.branch_id },
          { accountId: revenue, description: 'إيراد تمويل مكتسب', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId: item.branch_id },
        ],
      });
      await sql`update accounting_installment_interest set journal_entry_id = ${entryId}
        where tenant_id = ${tenantId} and id = ${item.id}`.execute(queryable);
    }
  }

}
