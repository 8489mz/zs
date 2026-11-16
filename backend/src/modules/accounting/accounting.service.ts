import { tenantBaseCurrency } from './accounting-currency';
import { resolveFxRate } from './fx-rate-resolution';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from './engines/money-minor-units.engine';

import { assertHierarchyParent } from './accounting-boundaries';
import { assertAccountingCloseReady } from './accounting-close-readiness';
import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import {
  CashMovementQueryDto,
  FinancialSummaryQueryDto,
  InventoryValueQueryDto,
  JournalEntriesQueryDto,
  OpeningBalancesPreviewQueryDto,
  PostOpeningBalancesDto,
  ReceivablesPayablesQueryDto,
  UpdateAccountingSettingsDto,
  CreateManualJournalEntryDto,
  CreateBankStatementDto,
  CreateBankStatementLineDto,
  ReconcileMatchDto,
  CreateBankFeeAdjustmentDto,
} from './dto/accounting.dto';
import { AccountingTenantFoundationService } from './accounting-tenant-foundation.service';
import { AccountingPostingService } from './accounting-posting.service';
import { lockAccountingPeriod } from './accounting-period-lock';
import { resolveBusinessDateKey } from './engines/accounting-date.engine';
import { nextAccountingDay } from './engines/accounting-date.engine';
import { calculateAssetDepreciation, validateFixedAssetTerms } from './engines/fixed-asset-depreciation.engine';
import { readJournalEntryNo } from './engines/journal-number.engine';
import type { PartnerType } from './accounting-types';
import { AccountingJournalsReadService } from './services/accounting-journals-read.service';
import { AccountingJournalsWriteService } from './services/accounting-journals-write.service';
import { AccountingAccountsService } from './services/accounting-accounts.service';
import { AccountingOpeningBalancesService } from './services/accounting-opening-balances.service';

@Injectable()
export class AccountingService {
  private readonly journalsReadService: AccountingJournalsReadService;
  private readonly journalsWriteService: AccountingJournalsWriteService;
  private readonly accountsService: AccountingAccountsService;
  private readonly openingBalancesService: AccountingOpeningBalancesService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingTenantFoundation: AccountingTenantFoundationService,
    @Optional() private readonly accountingPosting?: AccountingPostingService,
  ) {
    this.journalsReadService = new AccountingJournalsReadService({
      db: this.db,
      assertAccountingAccess: this.assertAccountingAccess.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
      toMoney: this.toMoney.bind(this),
    });
    this.journalsWriteService = new AccountingJournalsWriteService({
      db: this.db,
      accountingTenantFoundation: this.accountingTenantFoundation,
      accountingPosting: this.accountingPosting,
      assertAccountingAccess: this.assertAccountingAccess.bind(this),
      assertJournalReferences: this.journalsReadService.assertJournalReferences.bind(this.journalsReadService),
      assertNotInLockedPeriod: this.journalsReadService.assertNotInLockedPeriod.bind(this.journalsReadService),
      toBookMoney: this.toBookMoney.bind(this),
      toMoney: this.toMoney.bind(this),
      normalizePartnerType: this.normalizePartnerType.bind(this),
    });
    this.accountsService = new AccountingAccountsService({
      db: this.db,
      accountingTenantFoundation: this.accountingTenantFoundation,
      assertAccountingAccess: this.assertAccountingAccess.bind(this),
      orientAccountBalance: this.orientAccountBalance.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
    });
    this.openingBalancesService = new AccountingOpeningBalancesService({
      db: this.db,
      accountingTenantFoundation: this.accountingTenantFoundation,
      accountingPosting: this.accountingPosting,
      assertAccountingAccess: this.assertAccountingAccess.bind(this),
      toBookMoney: this.toBookMoney.bind(this),
      normalizeDateInput: this.normalizeDateInput.bind(this),
      openingAmount: this.openingAmount.bind(this),
      assertNotInLockedPeriod: this.journalsReadService.assertNotInLockedPeriod.bind(this.journalsReadService),
    });
  }

  private assertAccountingAccess(auth: AuthContext): void {
    if (auth.role === 'super_admin' || auth.role === 'admin' || auth.permissions.includes('accounting')) {
      return;
    }
    throw new ForbiddenException('Missing required permissions');
  }

  /* Digits-aware rounding at the tenant's book digits (was hardcoded
   * 2dp). Non-finite input still throws, as before. */
  private toMoney(value: unknown, digits: MoneyDigits): number {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) throw new BadRequestException('قيمة القيد يجب أن تكون رقمًا صالحًا.');
    return roundMoney(amount, digits);
  }

  /**
   * Opening-balance rounding: round once with the canonical engine at
   * the tenant's book digits. Same helper as toMoney; kept as a
   * separate name so the opening-balance computation reads as the
   * book-digits path.
   */
  private toBookMoney(value: unknown, digits: MoneyDigits): number {
    return this.toMoney(value, digits);
  }

  private async assertJournalReferences(
    queryable: Kysely<Database>, tenantId: string,
    lines: Array<{ costCenterId?: number | null; branchId?: number | null; locationId?: number | null; partnerType?: string; partnerId?: number | null }>,
  ): Promise<void> {
    return this.journalsReadService.assertJournalReferences(queryable, tenantId, lines);
  }

  private normalizePartnerType(value: unknown): PartnerType | null {
    if (value === undefined || value === null || String(value).trim() === '') return 'none';
    if (value === 'none' || value === 'customer' || value === 'supplier') return value;
    return null;
  }

  /** Balance oriented by the account's normal balance: a debit-normal
   * account shows debit minus credit, a credit-normal one the reverse;
   * an account with no posted lines is zero. */
  private orientAccountBalance(normalBalance: string, totals?: { debit: number; credit: number }): number {
    const debit = Number(totals?.debit || 0);
    const credit = Number(totals?.credit || 0);
    return normalBalance === 'credit' ? credit - debit : debit - credit;
  }

  async listAccounts(auth: AuthContext): Promise<Record<string, unknown>> {
    return this.accountsService.listAccounts(auth);
  }

  private inCodes(code: string, codes: string[]): boolean {
    return codes.includes(String(code || '').trim());
  }

  private mapPeriod(dateFrom?: string, dateTo?: string): { from: string | null; to: string | null } {
    return {
      from: dateFrom ? String(dateFrom).slice(0, 10) : null,
      to: dateTo ? String(dateTo).slice(0, 10) : null,
    };
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const scope = requireTenantScope(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${scope.tenantId}`
      : sql<boolean>`tenant_id = ${scope.tenantId}`;
  }

  private async normalizeDateInput(value: string | null | undefined, db: Kysely<Database>, tenantId: string): Promise<string> {
    const dateText = String(value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText;
    // No usable start date: default to the tenant-local business day, never the UTC day.
    return resolveBusinessDateKey(db, tenantId, new Date());
  }

  private openingAmount(value: unknown, digits: MoneyDigits): number {
    return this.toBookMoney(Math.max(0, Number(value || 0)), digits);
  }

  private async getExistingOpeningBalanceEntry(auth: AuthContext, db: Kysely<Database> = this.db): Promise<{ id: number } | null> {
    return this.openingBalancesService.getExistingOpeningBalanceEntry(auth, db);
  }

  private async resolveOpeningAccount(auth: AuthContext, code: string, expectedTypes: string[], db: Kysely<Database> = this.db): Promise<OpeningBalanceAccount> {
    return this.openingBalancesService.resolveOpeningAccount(auth, code, expectedTypes, db);
  }

  private addOpeningLine(lines: OpeningBalanceLine[], account: OpeningBalanceAccount, description: string, debit: number, credit: number, digits: MoneyDigits): void {
    return this.openingBalancesService.addOpeningLine(lines, account, description, debit, credit, digits);
  }

  private async calculateOpeningOperationalTotals(auth: AuthContext, digits: MoneyDigits, db: Kysely<Database> = this.db): Promise<{
    customerReceivables: number;
    supplierPayables: number;
    inventoryValue: number;
  }> {
    return this.openingBalancesService.calculateOpeningOperationalTotals(auth, digits, db);
  }

  private async buildOpeningBalancesPreview(
    input: OpeningBalancesPreviewQueryDto | PostOpeningBalancesDto,
    auth: AuthContext,
    digits: MoneyDigits,
    db: Kysely<Database> = this.db,
  ): Promise<{
    alreadyPosted: boolean;
    existingOpeningEntryId: number | null;
    systemStartDate: string;
    totals: {
      cashOpening: number;
      bankOpening: number;
      customerReceivables: number;
      supplierPayables: number;
      inventoryValue: number;
      balancingCapital: number;
    };
    linesPreview: OpeningBalanceLine[];
    warnings: string[];
  }> {
    return this.openingBalancesService.buildOpeningBalancesPreview(input, auth, digits, db);
  }

  async getAccountingSettings(auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    const scope = requireTenantScope(auth);
    const settings = await this.db
      .selectFrom('accounting_settings')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('id', '=', 1)
      .executeTakeFirst();
    if (!settings) {
      return { settings: null };
    }

    const accountIds = [
      settings.cash_account_id,
      settings.bank_account_id,
      settings.customer_receivable_account_id,
      settings.supplier_payable_account_id,
      settings.inventory_account_id,
      settings.sales_revenue_account_id,
      settings.sales_discount_account_id,
      settings.cogs_account_id,
      settings.purchase_account_id,
      settings.expenses_account_id,
      settings.sales_tax_account_id,
      settings.purchase_tax_account_id,
    ].filter((value): value is number => Number(value || 0) > 0);

    const accounts = accountIds.length
      ? await this.db
        .selectFrom('accounting_accounts')
        .select(['id', 'code', 'name_ar', 'name_en'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', accountIds)
        .execute()
      : [];

    const accountById = new Map(accounts.map((row) => [Number(row.id), row]));
    const mapRef = (id: number | null) => {
      if (!id) return null;
      const account = accountById.get(Number(id));
      if (!account) return { id: String(id) };
      return {
        id: String(account.id),
        code: account.code,
        nameAr: account.name_ar,
        nameEn: account.name_en || '',
      };
    };

    return {
      settings: {
        id: settings.id,
        cashAccount: mapRef(settings.cash_account_id),
        bankAccount: mapRef(settings.bank_account_id),
        customerReceivableAccount: mapRef(settings.customer_receivable_account_id),
        supplierPayableAccount: mapRef(settings.supplier_payable_account_id),
        inventoryAccount: mapRef(settings.inventory_account_id),
        salesRevenueAccount: mapRef(settings.sales_revenue_account_id),
        salesDiscountAccount: mapRef(settings.sales_discount_account_id),
        cogsAccount: mapRef(settings.cogs_account_id),
        purchaseAccount: mapRef(settings.purchase_account_id),
        expensesAccount: mapRef(settings.expenses_account_id),
        salesTaxAccount: mapRef(settings.sales_tax_account_id),
        purchaseTaxAccount: mapRef(settings.purchase_tax_account_id),
        lockDateAll: settings.lock_date_all ? String(settings.lock_date_all).slice(0, 10) : null,
        lockDateNonAdviser: settings.lock_date_non_adviser ? String(settings.lock_date_non_adviser).slice(0, 10) : null,
        lockDateTax: settings.lock_date_tax ? String(settings.lock_date_tax).slice(0, 10) : null,
        updatedAt: settings.updated_at,
      },
    };
  }

  async updateAccountingSettings(dto: UpdateAccountingSettingsDto, auth: AuthContext): Promise<{ success: boolean }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);

    const updateData: Record<string, any> = {};
    if (dto.cashAccountId !== undefined) updateData.cash_account_id = dto.cashAccountId || null;
    if (dto.bankAccountId !== undefined) updateData.bank_account_id = dto.bankAccountId || null;
    if (dto.customerReceivableAccountId !== undefined) updateData.customer_receivable_account_id = dto.customerReceivableAccountId || null;
    if (dto.supplierPayableAccountId !== undefined) updateData.supplier_payable_account_id = dto.supplierPayableAccountId || null;
    if (dto.inventoryAccountId !== undefined) updateData.inventory_account_id = dto.inventoryAccountId || null;
    if (dto.salesRevenueAccountId !== undefined) updateData.sales_revenue_account_id = dto.salesRevenueAccountId || null;
    if (dto.salesDiscountAccountId !== undefined) updateData.sales_discount_account_id = dto.salesDiscountAccountId || null;
    if (dto.cogsAccountId !== undefined) updateData.cogs_account_id = dto.cogsAccountId || null;
    if (dto.purchaseAccountId !== undefined) updateData.purchase_account_id = dto.purchaseAccountId || null;
    if (dto.expensesAccountId !== undefined) updateData.expenses_account_id = dto.expensesAccountId || null;
    if (dto.salesTaxAccountId !== undefined) updateData.sales_tax_account_id = dto.salesTaxAccountId || null;
    if (dto.purchaseTaxAccountId !== undefined) updateData.purchase_tax_account_id = dto.purchaseTaxAccountId || null;
    if (dto.lockDateAll !== undefined) updateData.lock_date_all = dto.lockDateAll || null;
    if (dto.lockDateNonAdviser !== undefined) updateData.lock_date_non_adviser = dto.lockDateNonAdviser || null;
    if (dto.lockDateTax !== undefined) updateData.lock_date_tax = dto.lockDateTax || null;
    const referenceColumns = [
      'cash_account_id', 'bank_account_id', 'customer_receivable_account_id',
      'supplier_payable_account_id', 'inventory_account_id', 'sales_revenue_account_id',
      'sales_discount_account_id', 'cogs_account_id', 'purchase_account_id',
      'expenses_account_id', 'sales_tax_account_id', 'purchase_tax_account_id',
    ];
    const accountIds = Array.from(new Set(referenceColumns
      .map((column) => Number(updateData[column] || 0)).filter((id) => id > 0)));
    if (accountIds.length) {
      const owned = await this.db.selectFrom('accounting_accounts').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', 'in', accountIds).execute();
      if (owned.length !== accountIds.length) throw new BadRequestException('حساب الإعدادات لا ينتمي لهذه المنشأة.');
    }
    
    updateData.updated_at = new Date();

    if (Object.keys(updateData).length > 1) { // more than just updated_at
      await this.db.transaction().execute(async (trx) => {
        await lockAccountingPeriod(trx, scope.tenantId);
        const closingDates = [dto.lockDateAll, dto.lockDateNonAdviser, dto.lockDateTax].filter((day): day is string => Boolean(day)).sort();
        if (closingDates.length) await assertAccountingCloseReady(trx, scope.tenantId, '1900-01-01', closingDates[closingDates.length - 1]);
        await trx.updateTable('accounting_settings').set(updateData)
          .where('tenant_id', '=', scope.tenantId).where('id', '=', 1).execute();
      });
    }

    return { success: true };
  }

  async listJournalEntries(filters: JournalEntriesQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.journalsReadService.listJournalEntries(filters, auth);
  }

  async getJournalEntry(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.journalsReadService.getJournalEntry(id, auth);
  }

  async assertNotInLockedPeriod(
    tenantId: string,
    entryDate: Date | string,
    options?: {
      auth?: AuthContext;
      isTaxOperation?: boolean;
      queryable?: Kysely<Database>;
    },
  ): Promise<void> {
    return this.journalsReadService.assertNotInLockedPeriod(tenantId, entryDate, options);
  }

  async createManualJournalEntry(dto: CreateManualJournalEntryDto, auth: AuthContext, externalTrx?: Kysely<Database>): Promise<Record<string, unknown>> {
    return this.journalsWriteService.createManualJournalEntry(dto, auth, externalTrx);
  }

  async reverseJournalEntry(entryId: number, reason: string, auth: AuthContext): Promise<{ ok: boolean; message: string; reversalEntryId: number; reversalEntryNo: string }> {
    return this.journalsWriteService.reverseJournalEntry(entryId, reason, auth);
  }

  async getFinancialSummary(filters: FinancialSummaryQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));

    const dateFrom = filters.date_from ? new Date(filters.date_from) : null;
    const dateTo = filters.date_to ? new Date(filters.date_to) : null;
    const branchId = Number(filters.branch_id || 0) > 0 ? Number(filters.branch_id) : null;
    const locationId = Number(filters.location_id || 0) > 0 ? Number(filters.location_id) : null;

    let query = this.db
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as je', (join: any) => join.onRef('je.id', '=', 'l.journal_entry_id').onRef('je.tenant_id', '=', 'l.tenant_id'))
      .innerJoin('accounting_accounts as a', (join: any) => join.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'))
      .select([
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'a.account_type as account_type',
        'a.account_group as account_group',
        'je.source_type as source_type',
        sql<number>`COALESCE(SUM(l.debit), 0)`.as('debit'),
        sql<number>`COALESCE(SUM(l.credit), 0)`.as('credit'),
      ])
      .where('je.status', '=', 'posted')
      .where('je.source_type', 'not in', ['fiscal_year_closing', 'fiscal_year_reopen'])
      .where(this.tenantPredicate(auth, 'je'))
      .where(this.tenantPredicate(auth, 'l'));

    if (dateFrom) {
      query = query.where('je.entry_date', '>=', dateFrom);
    }
    if (dateTo) {
      query = query.where('je.entry_date', '<', nextAccountingDay(dateTo));
    }
    if (branchId) {
      query = query.where('je.branch_id', '=', branchId);
    }
    if (locationId) {
      query = query.where('je.location_id', '=', locationId);
    }

    const rows = await query
      .groupBy(['a.code', 'a.name_ar', 'a.account_type', 'a.account_group', 'je.source_type'])
      .execute();

    const REVENUE_CODES = ['4100', '4200'];
    const CONTRA_REVENUE_CODES = ['4300', '4400'];
    const COGS_CODES = ['5100', '5200', '5300'];
    const CASH_BANK_CODES = ['1110', '1120'];

    let grossSales = 0;
    let salesReturns = 0;
    let salesDiscounts = 0;
    let cogs = 0;
    let operatingExpenses = 0;
    let customerCollections = 0;
    let supplierPayments = 0;
    let treasuryExpenses = 0;
    let cashDebits = 0;
    let cashCredits = 0;

    const revenueBreakdown = new Map<string, { accountCode: string; accountNameAr: string; amount: number }>();
    const expenseBreakdown = new Map<string, { accountCode: string; accountNameAr: string; amount: number }>();
    const cashBreakdown = new Map<string, { accountCode: string; accountNameAr: string; amount: number }>();

    for (const row of rows) {
      const code = String(row.account_code || '');
      const accountNameAr = String(row.account_name_ar || '');
      const accountType = String(row.account_type || '');
      const accountGroup = String(row.account_group || '');
      const debit = this.toMoney(row.debit, digits);
      const credit = this.toMoney(row.credit, digits);
      const sourceType = String(row.source_type || '');
      const revenueMovement = this.toMoney(credit - debit, digits);
      const expenseMovement = this.toMoney(debit - credit, digits);

      if (this.inCodes(code, REVENUE_CODES) || accountType === 'revenue') {
        if (!this.inCodes(code, CONTRA_REVENUE_CODES) && accountType !== 'contra_revenue') {
          grossSales = this.toMoney(grossSales + revenueMovement, digits);
          const current = revenueBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
          current.amount = this.toMoney(current.amount + revenueMovement, digits);
          revenueBreakdown.set(code, current);
        }
      }

      if (code === '4400') {
        salesReturns = this.toMoney(salesReturns + expenseMovement, digits);
      }
      if (code === '4300') {
        salesDiscounts = this.toMoney(salesDiscounts + expenseMovement, digits);
      }
      if (accountType === 'contra_revenue' && !this.inCodes(code, ['4300', '4400'])) {
        salesReturns = this.toMoney(salesReturns + expenseMovement, digits);
      }

      if (this.inCodes(code, COGS_CODES) || accountGroup === 'cogs') {
        cogs = this.toMoney(cogs + expenseMovement, digits);
      }

      const isOperatingExpense = (accountType === 'expense' || accountType === 'contra_expense' || accountGroup === 'operating_expenses')
        && !this.inCodes(code, COGS_CODES)
        && accountGroup !== 'cogs';
      if (isOperatingExpense) {
        operatingExpenses = this.toMoney(operatingExpenses + expenseMovement, digits);
        const current = expenseBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
        current.amount = this.toMoney(current.amount + expenseMovement, digits);
        expenseBreakdown.set(code, current);
      }

      if (this.inCodes(code, CASH_BANK_CODES) || accountGroup === 'cash_bank') {
        cashDebits = this.toMoney(cashDebits + Math.max(0, debit), digits);
        cashCredits = this.toMoney(cashCredits + Math.max(0, credit), digits);
        const movement = this.toMoney(debit - credit, digits);
        const current = cashBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
        current.amount = this.toMoney(current.amount + movement, digits);
        cashBreakdown.set(code, current);

        if (sourceType === 'customer_payment' && debit > 0) {
          customerCollections = this.toMoney(customerCollections + debit, digits);
        }
        if ((sourceType === 'supplier_payment' || sourceType === 'supplier_payment_schedule_settlement') && credit > 0) {
          supplierPayments = this.toMoney(supplierPayments + credit, digits);
        }
        if ((sourceType === 'expense' || sourceType === 'treasury_expense') && credit > 0) {
          treasuryExpenses = this.toMoney(treasuryExpenses + credit, digits);
        }
      }
    }

    const netSales = this.toMoney(grossSales - salesReturns - salesDiscounts, digits);
    const grossProfit = this.toMoney(netSales - cogs, digits);
    const netProfit = this.toMoney(grossProfit - operatingExpenses, digits);
    // This is period movement only (not an opening/closing balance).
    const netCashMovement = this.toMoney(cashDebits - cashCredits, digits);

    const asArray = (map: Map<string, { accountCode: string; accountNameAr: string; amount: number }>) =>
      Array.from(map.values()).sort((a, b) => Number(a.accountCode || 0) - Number(b.accountCode || 0));

    return {
      period: this.mapPeriod(filters.date_from, filters.date_to),
      cards: {
        grossSales,
        salesReturns,
        salesDiscounts,
        netSales,
        cogs,
        grossProfit,
        operatingExpenses,
        netProfit,
        customerCollections,
        supplierPayments,
        treasuryExpenses,
        netCashMovement,
      },
      breakdowns: {
        revenueAccounts: asArray(revenueBreakdown),
        expenseAccounts: asArray(expenseBreakdown),
        cashMovements: asArray(cashBreakdown),
      },
    };
  }

  async getReceivablesPayables(filters: ReceivablesPayablesQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));
    const dateTo = filters.date_to ? new Date(filters.date_to) : null;
    const branchId = Number(filters.branch_id || 0) > 0 ? Number(filters.branch_id) : null;
    const locationId = Number(filters.location_id || 0) > 0 ? Number(filters.location_id) : null;
    const showZero = String(filters.show_zero || '').trim().toLowerCase() === 'true';

    if (!dateTo && !branchId && !locationId) {
      const [customers, suppliers, customerLastRows, supplierLastRows] = await Promise.all([
        this.db
          .selectFrom('customers')
          .select(['id', 'name', 'phone', 'balance'])
          .where('is_active', '=', true)
          .where(this.tenantPredicate(auth))
          .orderBy('name', 'asc')
          .execute(),
        this.db
          .selectFrom('suppliers')
          .select(['id', 'name', 'phone', 'balance'])
          .where('is_active', '=', true)
          .where(this.tenantPredicate(auth))
          .orderBy('name', 'asc')
          .execute(),
        this.db
          .selectFrom('customer_ledger')
          .select(['customer_id', (eb) => eb.fn.max('created_at').as('last_movement_at')])
          .where(this.tenantPredicate(auth))
          .groupBy('customer_id')
          .execute(),
        this.db
          .selectFrom('supplier_ledger')
          .select(['supplier_id', (eb) => eb.fn.max('created_at').as('last_movement_at')])
          .where(this.tenantPredicate(auth))
          .groupBy('supplier_id')
          .execute(),
      ]);

      const customerLastMap = new Map(customerLastRows.map((row) => [String(row.customer_id || ''), row.last_movement_at ? String(row.last_movement_at) : '']));
      const supplierLastMap = new Map(supplierLastRows.map((row) => [String(row.supplier_id || ''), row.last_movement_at ? String(row.last_movement_at) : '']));

      const customerRows = customers
        .map((row) => ({
          customerId: String(row.id),
          customerName: row.name || '',
          phone: row.phone || '',
          balance: this.toMoney(row.balance, digits),
          lastMovementDate: customerLastMap.get(String(row.id)) || '',
        }))
        .filter((row) => showZero || Math.abs(row.balance) > 0.0001);

      const supplierRows = suppliers
        .map((row) => ({
          supplierId: String(row.id),
          supplierName: row.name || '',
          phone: row.phone || '',
          balance: this.toMoney(row.balance, digits),
          lastMovementDate: supplierLastMap.get(String(row.id)) || '',
        }))
        .filter((row) => showZero || Math.abs(row.balance) > 0.0001);

      const customerReceivables = this.toMoney(customerRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0), digits);
      const supplierPayables = this.toMoney(supplierRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0), digits);

      return {
        totals: {
          customerReceivables,
          supplierPayables,
          netPosition: this.toMoney(customerReceivables - supplierPayables, digits),
        },
        customers: customerRows.sort((a, b) => b.balance - a.balance),
        suppliers: supplierRows.sort((a, b) => b.balance - a.balance),
      };
    }

    let customerLedgerQuery = this.db
      .selectFrom('customer_ledger')
      .select([
        'customer_id',
        (eb) => eb.fn.sum<number>('amount').as('balance_total'),
        (eb) => eb.fn.max('created_at').as('last_movement_at'),
      ])
      .where(this.tenantPredicate(auth));

    let supplierLedgerQuery = this.db
      .selectFrom('supplier_ledger')
      .select([
        'supplier_id',
        (eb) => eb.fn.sum<number>('amount').as('balance_total'),
        (eb) => eb.fn.max('created_at').as('last_movement_at'),
      ])
      .where(this.tenantPredicate(auth));

    if (dateTo) {
      customerLedgerQuery = customerLedgerQuery.where('created_at', '<', nextAccountingDay(dateTo));
      supplierLedgerQuery = supplierLedgerQuery.where('created_at', '<', nextAccountingDay(dateTo));
    }
    if (branchId) {
      customerLedgerQuery = customerLedgerQuery.where('branch_id', '=', branchId);
      supplierLedgerQuery = supplierLedgerQuery.where('branch_id', '=', branchId);
    }
    if (locationId) {
      customerLedgerQuery = customerLedgerQuery.where('location_id', '=', locationId);
      supplierLedgerQuery = supplierLedgerQuery.where('location_id', '=', locationId);
    }

    const [customerLedgers, supplierLedgers, customers, suppliers] = await Promise.all([
      customerLedgerQuery.groupBy('customer_id').execute(),
      supplierLedgerQuery.groupBy('supplier_id').execute(),
      this.db.selectFrom('customers').select(['id', 'name', 'phone']).where('is_active', '=', true).where(this.tenantPredicate(auth)).execute(),
      this.db.selectFrom('suppliers').select(['id', 'name', 'phone']).where('is_active', '=', true).where(this.tenantPredicate(auth)).execute(),
    ]);

    const customerInfo = new Map(customers.map((row) => [String(row.id), row]));
    const supplierInfo = new Map(suppliers.map((row) => [String(row.id), row]));

    const customerRows = customerLedgers
      .map((row) => {
        const customer = customerInfo.get(String(row.customer_id || ''));
        return {
          customerId: String(row.customer_id || ''),
          customerName: customer?.name || '',
          phone: customer?.phone || '',
          balance: this.toMoney(row.balance_total || 0, digits),
          lastMovementDate: row.last_movement_at ? String(row.last_movement_at) : '',
        };
      })
      .filter((row) => row.customerId)
      .filter((row) => showZero || Math.abs(row.balance) > 0.0001)
      .sort((a, b) => b.balance - a.balance);

    const supplierRows = supplierLedgers
      .map((row) => {
        const supplier = supplierInfo.get(String(row.supplier_id || ''));
        return {
          supplierId: String(row.supplier_id || ''),
          supplierName: supplier?.name || '',
          phone: supplier?.phone || '',
          balance: this.toMoney(row.balance_total || 0, digits),
          lastMovementDate: row.last_movement_at ? String(row.last_movement_at) : '',
        };
      })
      .filter((row) => row.supplierId)
      .filter((row) => showZero || Math.abs(row.balance) > 0.0001)
      .sort((a, b) => b.balance - a.balance);

    const customerReceivables = this.toMoney(customerRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0), digits);
    const supplierPayables = this.toMoney(supplierRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0), digits);

    return {
      totals: {
        customerReceivables,
        supplierPayables,
        netPosition: this.toMoney(customerReceivables - supplierPayables, digits),
      },
      customers: customerRows,
      suppliers: supplierRows,
    };
  }

  async getCashMovement(filters: CashMovementQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));
    const dateFrom = filters.date_from ? new Date(filters.date_from) : null;
    const dateTo = filters.date_to ? new Date(filters.date_to) : null;
    const branchId = Number(filters.branch_id || 0) > 0 ? Number(filters.branch_id) : null;
    const locationId = Number(filters.location_id || 0) > 0 ? Number(filters.location_id) : null;

    let query = this.db
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as je', (join: any) => join.onRef('je.id', '=', 'l.journal_entry_id').onRef('je.tenant_id', '=', 'l.tenant_id'))
      .innerJoin('accounting_accounts as a', (join: any) => join.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'))
      .select([
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'je.source_type as source_type',
        sql<number>`COALESCE(SUM(l.debit), 0)`.as('debit'),
        sql<number>`COALESCE(SUM(l.credit), 0)`.as('credit'),
      ])
      .where('je.status', '=', 'posted')
      .where(this.tenantPredicate(auth, 'je'))
      .where(this.tenantPredicate(auth, 'l'))
      .where('a.code', 'in', ['1110', '1120']);

    if (dateFrom) query = query.where('je.entry_date', '>=', dateFrom);
    if (dateTo) query = query.where('je.entry_date', '<', nextAccountingDay(dateTo));
    if (branchId) query = query.where('je.branch_id', '=', branchId);
    if (locationId) query = query.where('je.location_id', '=', locationId);

    const rows = await query
      .groupBy(['a.code', 'a.name_ar', 'je.source_type'])
      .execute();

    let totalDebit = 0;
    let totalCredit = 0;
    const byAccount = new Map<string, { accountCode: string; accountNameAr: string; debit: number; credit: number; net: number }>();
    const bySource = new Map<string, { sourceType: string; debit: number; credit: number; net: number }>();

    for (const row of rows) {
      const debit = this.toMoney(row.debit, digits);
      const credit = this.toMoney(row.credit, digits);
      const sourceType = String(row.source_type || 'other');
      const accountCode = String(row.account_code || '');
      const accountNameAr = String(row.account_name_ar || '');

      totalDebit = this.toMoney(totalDebit + debit, digits);
      totalCredit = this.toMoney(totalCredit + credit, digits);

      const accountItem = byAccount.get(accountCode) || { accountCode, accountNameAr, debit: 0, credit: 0, net: 0 };
      accountItem.debit = this.toMoney(accountItem.debit + debit, digits);
      accountItem.credit = this.toMoney(accountItem.credit + credit, digits);
      accountItem.net = this.toMoney(accountItem.debit - accountItem.credit, digits);
      byAccount.set(accountCode, accountItem);

      const sourceItem = bySource.get(sourceType) || { sourceType, debit: 0, credit: 0, net: 0 };
      sourceItem.debit = this.toMoney(sourceItem.debit + debit, digits);
      sourceItem.credit = this.toMoney(sourceItem.credit + credit, digits);
      sourceItem.net = this.toMoney(sourceItem.debit - sourceItem.credit, digits);
      bySource.set(sourceType, sourceItem);
    }

    return {
      period: this.mapPeriod(filters.date_from, filters.date_to),
      totals: {
        totalIn: totalDebit,
        totalOut: totalCredit,
        netMovement: this.toMoney(totalDebit - totalCredit, digits),
      },
      accounts: Array.from(byAccount.values()).sort((a, b) => Number(a.accountCode || 0) - Number(b.accountCode || 0)),
      sources: Array.from(bySource.values()).sort((a, b) => b.net - a.net),
    };
  }

  async getInventoryValue(filters: InventoryValueQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));

    const categoryId = Number(filters.category_id || 0) > 0 ? Number(filters.category_id) : null;
    const supplierId = Number(filters.supplier_id || 0) > 0 ? Number(filters.supplier_id) : null;
    const search = String(filters.search || '').trim();
    const lowStockOnly = String(filters.low_stock_only || '').trim().toLowerCase() === 'true';
    const zeroStockOnly = String(filters.zero_stock_only || '').trim().toLowerCase() === 'true';
    const locationId = Number(filters.location_id || 0) > 0 ? Number(filters.location_id) : null;
    const stockQty = locationId ? sql<number>`COALESCE(pls.qty, 0)` : sql<number>`p.stock_qty`;

    let query = this.db
      .selectFrom('products as p')
      .leftJoin('product_categories as c', (j) => j.onRef('c.id', '=', 'p.category_id').onRef('c.tenant_id', '=', 'p.tenant_id'))
      .leftJoin('suppliers as s', (j) => j.onRef('s.id', '=', 'p.supplier_id').onRef('s.tenant_id', '=', 'p.tenant_id'))
      .leftJoin('product_location_stock as pls', (join) => {
        const j = join.onRef('pls.product_id', '=', 'p.id').onRef('pls.tenant_id', '=', 'p.tenant_id');
        return locationId ? j.on('pls.location_id', '=', locationId) : j.on(sql<boolean>`false`);
      })
      .select([
        'p.id',
        'p.name',
        'p.barcode',
        stockQty.as('stock_qty'),
        'p.min_stock_qty',
        'p.cost_price',
        'p.retail_price',
        'p.category_id',
        'p.supplier_id',
        'c.name as category_name',
        's.name as supplier_name',
      ])
      .where('p.is_active', '=', true)
      .where(this.tenantPredicate(auth, 'p'));

    if (categoryId) {
      query = query.where('p.category_id', '=', categoryId);
    }
    if (supplierId) {
      query = query.where('p.supplier_id', '=', supplierId);
    }
    if (search) {
      query = query.where((eb) =>
        eb.or([
          eb('p.name', 'ilike', `%${search}%`),
          eb('p.barcode', 'ilike', `%${search}%`),
        ]),
      );
    }

    if (zeroStockOnly) query = query.where(sql<boolean>`ROUND(${stockQty}, 2) = 0`);
    if (lowStockOnly) query = query.where(sql<boolean>`ROUND(${stockQty}, 2) > 0 AND ROUND(${stockQty}, 2) <= ROUND(p.min_stock_qty, 2)`);

    const totalsRow = await query.clearSelect().select([
      sql<number>`COALESCE(SUM(ROUND(${stockQty} * COALESCE(p.cost_price, 0), ${digits})), 0)`.as('total_inventory_value'),
      sql<number>`COALESCE(SUM(ROUND(ROUND(${stockQty}, 2) * ROUND(COALESCE(p.retail_price, 0), ${digits}), ${digits})), 0)`.as('total_retail_value'),
      sql<number>`COUNT(*)::int`.as('item_count'),
      sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) > 0 AND ROUND(${stockQty}, 2) <= ROUND(p.min_stock_qty, 2))::int`.as('low_stock_count'),
      sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) = 0)::int`.as('zero_stock_count'),
      sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) < 0)::int`.as('negative_stock_count'),
    ]).executeTakeFirst();

    const rows = await query.orderBy('p.name', 'asc').execute();
    const items = rows
      .map((row) => {
        const quantityOnHand = Number(row.stock_qty);
        const minStockQty = this.toMoney(row.min_stock_qty, digits);
        const unitCost = Number(row.cost_price);
        const unitRetailPrice = this.toMoney(row.retail_price, digits);
        const inventoryValue = this.toMoney(quantityOnHand * unitCost, digits);
        const retailPotentialValue = this.toMoney(quantityOnHand * unitRetailPrice, digits);
        const potentialGrossMargin = this.toMoney(retailPotentialValue - inventoryValue, digits);

        let status: 'available' | 'low_stock' | 'out_of_stock' | 'negative_stock' = 'available';
        if (quantityOnHand < 0) status = 'negative_stock';
        else if (quantityOnHand === 0) status = 'out_of_stock';
        else if (quantityOnHand <= minStockQty) status = 'low_stock';

        return {
          productId: String(row.id),
          productName: String(row.name || ''),
          barcode: String(row.barcode || ''),
          categoryId: row.category_id ? String(row.category_id) : '',
          categoryName: String(row.category_name || ''),
          supplierId: row.supplier_id ? String(row.supplier_id) : '',
          supplierName: String(row.supplier_name || ''),
          quantityOnHand,
          minStockQty,
          unitCost,
          unitRetailPrice,
          inventoryValue,
          retailPotentialValue,
          potentialGrossMargin,
          status,
        };
      });

    const totals = {
      totalInventoryValue: this.toMoney(totalsRow?.total_inventory_value, digits),
      totalRetailPotentialValue: this.toMoney(totalsRow?.total_retail_value, digits),
      totalPotentialGrossMargin: this.toMoney(Number(totalsRow?.total_retail_value || 0) - Number(totalsRow?.total_inventory_value || 0), digits),
      itemCount: Number(totalsRow?.item_count || 0),
      lowStockCount: Number(totalsRow?.low_stock_count || 0),
      zeroStockCount: Number(totalsRow?.zero_stock_count || 0),
      negativeStockCount: Number(totalsRow?.negative_stock_count || 0),
    };

    return { totals, items };
  }

  async previewOpeningBalances(query: OpeningBalancesPreviewQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.openingBalancesService.previewOpeningBalances(query, auth);
  }

  async postOpeningBalances(body: PostOpeningBalancesDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.openingBalancesService.postOpeningBalances(body, auth);
  }

  async createDraftJournalEntry(input: DraftJournalEntryInput, auth: AuthContext): Promise<number> {
    return this.journalsWriteService.createDraftJournalEntry(input, auth);
  }

  async validateBalancedLines(lines: DraftJournalLineInput[], auth?: AuthContext): Promise<{ ok: true; lines: Array<Required<DraftJournalLineInput>> } | { ok: false; message: string }> {
    return this.journalsWriteService.validateBalancedLines(lines, auth);
  }

  async generateNextAccountCode(parentId: number, auth: AuthContext): Promise<{ code: string }> {
    return this.accountsService.generateNextAccountCode(parentId, auth);
  }

  async createAccount(dto: CreateAccountDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.accountsService.createAccount(dto, auth);
  }

  async updateAccount(id: number, dto: UpdateAccountDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.accountsService.updateAccount(id, dto, auth);
  }

  async deleteAccount(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.accountsService.deleteAccount(id, auth);
  }

  async listProjects(actor: AuthContext): Promise<Record<string, unknown>> {
    const records = await this.db
      .selectFrom('projects')
      .selectAll()
      .where('tenant_id', '=', requireTenantScope(actor).tenantId)
      .execute();
    return { ok: true, projects: records };
  }

  // --- Fixed Assets & Depreciation (الأصول الثابتة والإهلاك المحاسبي) ---
  private async ensureDepreciationAccounts(trx: any, tenantId: string, accountId: string): Promise<{ deprExpenseAccountId: number; accumDeprAccountId: number }> {
    let accumRow = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'code'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', '1290')
      .executeTakeFirst();

    let accumDeprAccountId: number;
    if (accumRow) {
      accumDeprAccountId = Number(accumRow.id);
    } else {
      const parentRow = await trx
        .selectFrom('accounting_accounts')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('code', 'in', ['1200', '1000'])
        .orderBy('code', 'desc')
        .executeTakeFirst();

      const created = await trx
        .insertInto('accounting_accounts')
        .values({
          code: '1290',
          name_ar: 'مجمع الإهلاك',
          name_en: 'Accumulated Depreciation',
          account_type: 'contra_asset',
          normal_balance: 'credit',
          sort_order: 1290,
          parent_id: parentRow ? Number(parentRow.id) : null,
          account_group: 'fixed_assets',
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: false,
          is_receivable: false,
          is_payable: false,
          is_inventory: false,
          is_tax: false,
          is_active: true,
          is_system: false,
          tenant_id: tenantId,
          description_ar: 'مجمع إهلاك الأصول الثابتة',
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      accumDeprAccountId = Number(created.id);
    }

    let expenseRow = await trx
      .selectFrom('accounting_accounts')
      .select(['id', 'code'])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) => eb.or([
        eb('code', '=', '6960'),
        eb('name_ar', 'like', '%إهلاك%').and('account_type', '=', 'expense'),
      ]))
      .executeTakeFirst();

    let deprExpenseAccountId: number;
    if (expenseRow) {
      deprExpenseAccountId = Number(expenseRow.id);
    } else {
      const parentRow = await trx
        .selectFrom('accounting_accounts')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('code', 'in', ['6000', '6900'])
        .orderBy('code', 'asc')
        .executeTakeFirst();

      const created = await trx
        .insertInto('accounting_accounts')
        .values({
          code: '6960',
          name_ar: 'مصروف إهلاك الأصول الثابتة',
          name_en: 'Depreciation Expense',
          account_type: 'expense',
          normal_balance: 'debit',
          sort_order: 6960,
          parent_id: parentRow ? Number(parentRow.id) : null,
          account_group: 'operating_expenses',
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: false,
          is_receivable: false,
          is_payable: false,
          is_inventory: false,
          is_tax: false,
          is_active: true,
          is_system: false,
          tenant_id: tenantId,
          description_ar: 'مصروف إهلاك الأصول الثابتة الدوري',
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();
      deprExpenseAccountId = Number(created.id);
    }

    return { deprExpenseAccountId, accumDeprAccountId };
  }

  async listFixedAssets(actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const rows = await this.db
      .selectFrom('fixed_assets')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('created_at', 'desc')
      .execute();

    const assets = rows.map((a) => {
      const cost = Number(a.purchase_cost || 0);
      const accum = Number(a.accumulated_depreciation || 0);
      const salvage = Number(a.salvage_value || 0);
      const bookValue = Math.max(0, cost - accum);
      return {
        ...a,
        purchase_cost: cost,
        accumulated_depreciation: accum,
        salvage_value: salvage,
        book_value: bookValue,
      };
    });

    return { ok: true, assets };
  }

  async createFixedAsset(body: {
    code: string;
    name: string;
    category?: string;
    purchaseCost: number;
    salvageValue?: number;
    usefulLifeMonths?: number;
    depreciationMethod?: 'straight_line' | 'declining_balance';
    purchaseDate?: string;
  }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const code = String(body.code || '').trim();
    const name = String(body.name || '').trim();
    const purchaseCost = Number(body.purchaseCost);
    const salvageValue = Number(body.salvageValue ?? 0);
    const usefulLifeMonths = Number(body.usefulLifeMonths ?? 60);
    const purchaseDate = body.purchaseDate ? new Date(body.purchaseDate) : new Date();
    const depreciationMethod = body.depreciationMethod === 'declining_balance' ? 'declining_balance' : 'straight_line';

    if (!code || !name || purchaseCost <= 0) {
      throw new BadRequestException('بيانات الأصل غير مكتملة (الكود، الاسم، وتكلفة الشراء مطلوبة).');
    }
    try { validateFixedAssetTerms(purchaseCost, salvageValue, usefulLifeMonths); }
    catch { throw new BadRequestException('تكلفة الأصل أو قيمة الخردة أو العمر الإنتاجي غير صالح.'); }
    if (Number.isNaN(purchaseDate.getTime()) || purchaseDate > new Date()) {
      throw new BadRequestException('تاريخ شراء الأصل غير صالح أو يقع في المستقبل.');
    }

    const inserted = await this.db
      .insertInto('fixed_assets')
      .values({
        code,
        name,
        category: body.category || 'general',
        purchase_cost: purchaseCost,
        salvage_value: salvageValue,
        useful_life_months: usefulLifeMonths,
        depreciation_method: depreciationMethod,
        accumulated_depreciation: 0,
        status: 'active',
        purchase_date: purchaseDate,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    return { ok: true, asset: inserted };
  }

  async depreciateFixedAsset(id: number, body: { months?: number; note?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const posting = this.accountingPosting;
    if (!posting) throw new Error('Accounting posting service is required for depreciation');

    return await this.db.transaction().execute(async (trx) => {
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const asset = await trx
        .selectFrom('fixed_assets')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!asset) {
        throw new BadRequestException('الأصل الثابت غير موجود.');
      }

      if (asset.status === 'retired') {
        throw new BadRequestException('هذا الأصل متقاعد أو مستبعد ولا يمكن إهلاكه.');
      }

      const cost = Number(asset.purchase_cost || 0);
      const salvage = Number(asset.salvage_value || 0);
      const usefulLife = Number(asset.useful_life_months);
      const currentAccumulated = Number(asset.accumulated_depreciation || 0);
      const method = asset.depreciation_method || 'straight_line';
      const months = Number(body.months ?? 1);
      const entryDate = new Date();
      let depreciationAmount: number;
      try {
        depreciationAmount = calculateAssetDepreciation({
          cost, salvage, usefulLifeMonths: usefulLife, accumulated: currentAccumulated,
          purchaseDate: new Date(asset.purchase_date), postingDate: entryDate, months, method,
        });
      } catch {
        throw new BadRequestException('بيانات الأصل أو عدد أشهر الإهلاك أو تاريخ الشراء غير صالح.');
      }

      const depreciableBase = cost - salvage;

      if (depreciationAmount <= 0) {
        throw new BadRequestException('لا يوجد إهلاك مستحق لهذا الأصل حتى تاريخ الترحيل أو وصل إلى قيمة الخردة.');
      }

      const newAccumulated = this.toMoney(currentAccumulated + depreciationAmount, digits);
      const newBookValue = this.toMoney(Math.max(0, cost - newAccumulated), digits);
      const isFullyDepreciated = newAccumulated >= depreciableBase;

      // 1. Resolve Accounts
      const accounts = await this.ensureDepreciationAccounts(trx, scope.tenantId, scope.accountId);

      // Check if already depreciated in the same month to prevent duplicate posting (ZS-056)
      const startOfMonth = new Date(Date.UTC(entryDate.getUTCFullYear(), entryDate.getUTCMonth(), 1));
      const existingInMonth = await trx
        .selectFrom('asset_depreciation_logs')
        .select(['id', 'period_date', 'depreciation_amount'])
        .where('tenant_id', '=', scope.tenantId)
        .where('asset_id', '=', id)
        .where('period_date', '>=', startOfMonth)
        .executeTakeFirst();

      if (existingInMonth) {
        throw new BadRequestException(`تم بالفعل إهلاك هذا الأصل خلال هذا الشهر (${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}).`);
      }

      // 2. Insert Balanced Journal Entry (ZS-055)
      const entryDesc = body.note
        ? `إهلاك الأصل ${asset.name} (${asset.code}): ${body.note}`
        : `إهلاك الأصل ${asset.name} (${asset.code}) - ${method === 'declining_balance' ? 'قسط متناقص' : 'قسط ثابت'}`;

      let journalEntryId: number;
      let finalEntryNo: string;

      journalEntryId = await posting.postDomainJournal(trx, {
        sourceType: 'depreciation',
        sourceId: id,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate,
        description: entryDesc,
        createdBy: actor.userId,
        lines: [
          {
            accountId: accounts.deprExpenseAccountId,
            description: `مصروف إهلاك الأصل - ${asset.name}`,
            debit: depreciationAmount,
            credit: 0,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
          {
            accountId: accounts.accumDeprAccountId,
            description: `مجمع إهلاك الأصل - ${asset.name}`,
            debit: 0,
            credit: depreciationAmount,
            partnerType: 'none',
            partnerId: null,
            branchId: null,
            locationId: null,
          },
        ],
      });
      // Gapless numbering (INV-JE-NUMBERING-GAP): the number no longer
      // equals the identity id -- read the stored number back instead of
      // deriving it. A missing row here is an internal inconsistency:
      // fail closed rather than reporting a fabricated number.
      const postedEntryNo = await readJournalEntryNo(trx, scope.tenantId, journalEntryId);
      if (!postedEntryNo) throw new Error('Depreciation journal entry number is missing after posting');
      finalEntryNo = postedEntryNo;

      // 4. Update Fixed Asset Record
      await trx
        .updateTable('fixed_assets')
        .set({
          accumulated_depreciation: newAccumulated,
          status: isFullyDepreciated ? 'fully_depreciated' : 'active',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      // 5. Insert Log with Journal Entry ID
      const log = await trx
        .insertInto('asset_depreciation_logs')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          asset_id: id,
          period_date: entryDate,
          depreciation_amount: depreciationAmount,
          accumulated_amount: newAccumulated,
          book_value: newBookValue,
          journal_entry_id: journalEntryId,
          note: body.note || (method === 'declining_balance' ? `إهلاك دوري لعدد ${months} شهر بطريقة القسط المتناقص` : `إهلاك دوري لعدد ${months} شهر بطريقة القسط الثابت`),
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        ok: true,
        depreciationAmount,
        accumulatedDepreciation: newAccumulated,
        bookValue: newBookValue,
        isFullyDepreciated,
        journalEntryId,
        entryNo: finalEntryNo,
        log,
      };
    });
  }

  async depreciateAllFixedAssets(body: { months?: number; note?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const activeAssets = await this.db
      .selectFrom('fixed_assets')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('status', '=', 'active')
      .execute();

    let processedCount = 0;
    let totalDepreciation = 0;
    const results: any[] = [];

    for (const asset of activeAssets) {
      const cost = Number(asset.purchase_cost || 0);
      const salvage = Number(asset.salvage_value || 0);
      const currentAccum = Number(asset.accumulated_depreciation || 0);
      if (currentAccum >= (cost - salvage)) {
        continue;
      }
      try {
        const res = await this.depreciateFixedAsset(Number(asset.id), body, actor);
        processedCount++;
        totalDepreciation = this.toMoney(totalDepreciation + Number(res.depreciationAmount || 0), digits);
        results.push({ id: asset.id, name: asset.name, code: asset.code, amount: res.depreciationAmount, entryNo: res.entryNo });
      } catch (e: any) {
        results.push({ id: asset.id, name: asset.name, code: asset.code, error: e?.message || 'Failed' });
      }
    }

    return {
      ok: true,
      processedCount,
      totalDepreciation,
      results,
    };
  }

  async listAssetDepreciationLogs(assetId?: number, actor?: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor!);
    let query = this.db
      .selectFrom('asset_depreciation_logs as l')
      .leftJoin('journal_entries as j', (join) => join.onRef('j.id', '=', 'l.journal_entry_id').onRef('j.tenant_id', '=', 'l.tenant_id'))
      .leftJoin('fixed_assets as a', (join) => join.onRef('a.id', '=', 'l.asset_id').onRef('a.tenant_id', '=', 'l.tenant_id'))
      .select([
        'l.id',
        'l.asset_id',
        'l.period_date',
        'l.depreciation_amount',
        'l.accumulated_amount',
        'l.book_value',
        'l.journal_entry_id',
        'l.note',
        'l.created_at',
        'j.entry_no as journal_entry_no',
        'a.name as asset_name',
        'a.code as asset_code',
      ])
      .where('l.tenant_id', '=', scope.tenantId);

    if (assetId && assetId > 0) {
      query = query.where('l.asset_id', '=', assetId);
    }

    const logs = await query.orderBy('l.created_at', 'desc').execute();
    return { ok: true, logs };
  }

  async deleteFixedAsset(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(actor);
    const logsCountRow = await this.db
      .selectFrom('asset_depreciation_logs')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('asset_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    const count = Number(logsCountRow?.count || 0);
    if (count > 0) {
      // Mark as retired instead of deleting historical financial audit logs
      await this.db
        .updateTable('fixed_assets')
        .set({ status: 'retired', updated_at: sql`NOW()` })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      return { ok: true, retired: true, message: 'تم إحالة الأصل إلى التقاعد (الاستبعاد) للاحتفاظ بسجل القيود التاريخية.' };
    }

    await this.db
      .deleteFrom('fixed_assets')
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { ok: true, deleted: true };
  }

  // --- Multi-Currency & Exchange Rates (العملات المتعددة وأسعار الصرف) ---
  async listCurrencies(auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async trx => {
      await lockAccountingPeriod(trx, scope.tenantId);
      let rows = await trx
        .selectFrom('currency_exchange_rates')
        .selectAll()
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('is_base', 'desc')
        .orderBy('currency_code', 'asc')
        .execute();

      const baseCurrency = await tenantBaseCurrency(trx, scope.tenantId);
      if (rows.length === 0) {
        // Never seed sample market rates into live financial conversion tables.
        const defaultCurrencies = [{ code: baseCurrency, name: baseCurrency, rate: 1, isBase: true, symbol: baseCurrency }];

        for (const c of defaultCurrencies) {
          await trx
            .insertInto('currency_exchange_rates')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              currency_code: c.code,
              currency_name: c.name,
              exchange_rate: c.rate,
              is_base: c.isBase,
              symbol: c.symbol,
            } as any)
            .onConflict((oc) => oc.columns(['tenant_id', 'currency_code']).doNothing())
            .execute();
        }

        rows = await trx
          .selectFrom('currency_exchange_rates')
          .selectAll()
          .where('tenant_id', '=', scope.tenantId)
          .orderBy('is_base', 'desc')
          .orderBy('currency_code', 'asc')
          .execute();
      }

      return {
        currencies: rows.map((r) => ({
          id: String(r.id),
          code: r.currency_code,
          name: r.currency_name,
          exchangeRate: Number(r.exchange_rate),
          isBase: Boolean(r.is_base),
          symbol: r.symbol,
          updatedAt: r.updated_at,
        })),
      };
    });
  }

  async upsertCurrency(
    body: { currencyCode: string; currencyName: string; exchangeRate: number; isBase?: boolean; symbol?: string },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const code = String(body.currencyCode || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) throw new BadRequestException('رمز العملة مطلوب.');

    const name = String(body.currencyName || code).trim();
    const rate = Number(body.exchangeRate);
    if (!Number.isFinite(rate) || rate <= 0) throw new BadRequestException('سعر الصرف يجب أن يكون موجباً ومحدوداً.');
    const isBase = Boolean(body.isBase);
    const symbol = String(body.symbol || '').trim();

    if (isBase && rate !== 1) throw new BadRequestException('سعر عملة الأساس يجب أن يساوي واحداً.');
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      const baseCurrency = await tenantBaseCurrency(trx, scope.tenantId);
      if (isBase !== (code === baseCurrency)) throw new BadRequestException('عملة الأساس تحدد من الإعدادات العامة قبل تسجيل أي عملة أو حركة مالية.');

      const row = await trx
        .insertInto('currency_exchange_rates')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          currency_code: code,
          currency_name: name,
          exchange_rate: rate,
          is_base: isBase,
          symbol,
        } as any)
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'currency_code']).doUpdateSet({
            currency_name: name,
            exchange_rate: rate,
            is_base: isBase,
            symbol,
            updated_at: sql`NOW()`,
          })
        )
        .returningAll()
        .executeTakeFirstOrThrow();

      return { ok: true, currency: row };
    });
  }

  async convertCurrency(
    body: { amount: number; fromCurrency: string; toCurrency: string; asOf?: string },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const baseCurrency = await tenantBaseCurrency(this.db, scope.tenantId);
    const fromCode = String(body.fromCurrency || '').trim().toUpperCase();
    const toCode = String(body.toCurrency || '').trim().toUpperCase();
    const amount = Number(body.amount || 0);

    if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) throw new BadRequestException('مبلغ أو رمز عملة غير صالح.');

    // INV-FX-RATE-HISTORY-CONSUMER: the first production consumer of
    // the append-only rate history. With an asOf moment both legs
    // resolve through the single resolver, which reads the rate
    // registered at that moment and fails closed when none was
    // recorded yet — a historical amount is never silently converted
    // at a later (live) rate. Without asOf the live rows are used,
    // exactly as before.
    const asOfRaw = typeof body.asOf === 'string' ? body.asOf.trim() : '';
    let asOf: Date | null = null;
    if (asOfRaw) {
      asOf = new Date(asOfRaw);
      if (!Number.isFinite(asOf.getTime())) throw new BadRequestException('تاريخ سعر الصرف غير صالح.');
    }

    let fromRate: number;
    let toRate: number;
    let fromIsBase: boolean;
    let toIsBase: boolean;
    if (asOf) {
      fromRate = await resolveFxRate(this.db, scope.tenantId, fromCode, { asOf });
      toRate = await resolveFxRate(this.db, scope.tenantId, toCode, { asOf });
      fromIsBase = fromCode === baseCurrency;
      toIsBase = toCode === baseCurrency;
    } else {
      const rates = await this.db
        .selectFrom('currency_exchange_rates')
        .select(['currency_code', 'exchange_rate', 'is_base'])
        .where('tenant_id', '=', scope.tenantId)
        .where('currency_code', 'in', [fromCode, toCode])
        .execute();

      const fromRow = rates.find((r) => r.currency_code === fromCode);
      const toRow = rates.find((r) => r.currency_code === toCode);

      if (!fromRow || !toRow) throw new BadRequestException('العملة غير مسجلة؛ لا يجوز افتراض سعر صرف.');
      fromRate = Number(fromRow.exchange_rate);
      toRate = Number(toRow.exchange_rate);
      if (![fromRate, toRate].every(rate => Number.isFinite(rate) && rate > 0)) throw new BadRequestException('سعر صرف مسجل غير صالح.');
      fromIsBase = Boolean(fromRow.is_base);
      toIsBase = Boolean(toRow.is_base);
    }

    const amountInBase = fromIsBase ? amount : amount * fromRate;
    const convertedAmount = toIsBase ? amountInBase : amountInBase / toRate;

    return {
      amount,
      fromCurrency: fromCode,
      toCurrency: toCode,
      // INV-CONVERT-CURRENCY-TARGET-DIGITS: round the displayed
      // amount once, from the unrounded conversion, at the target
      // currency's book digits. The rate read, the fail-closed
      // checks, the base-leg math, and the 6-decimal effective
      // rate are unchanged.
      convertedAmount: roundMoney(convertedAmount, currencyMoneyDigits(toCode)),
      effectiveRate: toRate > 0 ? Number((fromRate / toRate).toFixed(6)) : 1,
      rateAsOf: asOf ? asOf.toISOString() : null,
    };
  }

  // ---------------------------------------------------------------------------
  // COST CENTERS ENGINE
  // ---------------------------------------------------------------------------

  async listCostCenters(auth: AuthContext): Promise<{ ok: boolean; costCenters: Record<string, unknown>[] }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    const rows = await (this.db as any)
      .selectFrom('cost_centers as cc')
      .leftJoin('cost_centers as p', (join: any) => join.onRef('cc.parent_id', '=', 'p.id').onRef('cc.tenant_id', '=', 'p.tenant_id'))
      .select([
        'cc.id',
        'cc.code',
        'cc.name',
        'cc.dimension',
        'cc.budget_amount as budgetAmount',
        'cc.parent_id as parentId',
        'p.name as parentName',
        'cc.is_active as isActive',
        'cc.description',
        'cc.created_at as createdAt',
        'cc.updated_at as updatedAt',
      ])
      .where('cc.tenant_id', '=', scope.tenantId)
      .orderBy('cc.code', 'asc')
      .execute();

    return {
      ok: true,
      costCenters: rows.map((r: any) => ({
        ...r,
        id: Number(r.id),
        dimension: r.dimension || 'operational',
        budgetAmount: Number(r.budgetAmount || 0),
        parentId: r.parentId ? Number(r.parentId) : null,
        isActive: Boolean(r.isActive),
      })),
    };
  }

  async createCostCenter(
    body: { code: string; name: string; dimension?: string; budgetAmount?: number; parentId?: number | null; description?: string; isActive?: boolean },
    auth: AuthContext,
  ) {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await assertHierarchyParent(trx, 'cost_centers', scope.tenantId, null, body.parentId == null ? null : Number(body.parentId));
      const code = String(body.code || '').trim().toUpperCase();
      const name = String(body.name || '').trim();
      if (!code || !name) {
        throw new BadRequestException('كود واسم مركز التكلفة مطلوبان.');
      }
      const dimension = body.dimension ? String(body.dimension).trim() : 'operational';
      const budgetAmount = body.budgetAmount !== undefined ? Number(body.budgetAmount) : 0;
      const parentId = body.parentId ? Number(body.parentId) : null;
      const description = body.description ? String(body.description).trim() : null;
      const isActive = body.isActive !== false;

      const inserted = await trx
        .insertInto('cost_centers')
        .values({
          tenant_id: scope.tenantId,
          code,
          name,
          dimension,
          budget_amount: budgetAmount,
          parent_id: parentId,
          description,
          is_active: isActive,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();

      return {
        ok: true,
        costCenter: {
          ...inserted,
          id: Number(inserted.id),
          dimension: (inserted as any).dimension || 'operational',
          budgetAmount: Number((inserted as any).budget_amount || 0),
          parentId: inserted.parent_id ? Number(inserted.parent_id) : null,
          isActive: Boolean(inserted.is_active),
        },
      };
    });
  }

  async updateCostCenter(
    id: number,
    body: { code?: string; name?: string; dimension?: string; budgetAmount?: number; parentId?: number | null; description?: string; isActive?: boolean },
    auth: AuthContext,
  ) {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await assertHierarchyParent(trx, 'cost_centers', scope.tenantId, id, body.parentId == null ? null : Number(body.parentId));
      const updates: Record<string, unknown> = {
        updated_at: sql`NOW()`,
      };
      if (body.code !== undefined) updates.code = String(body.code).trim().toUpperCase();
      if (body.name !== undefined) updates.name = String(body.name).trim();
      if (body.dimension !== undefined) updates.dimension = String(body.dimension).trim();
      if (body.budgetAmount !== undefined) updates.budget_amount = Number(body.budgetAmount);
      if (body.parentId !== undefined) updates.parent_id = body.parentId ? Number(body.parentId) : null;
      if (body.description !== undefined) updates.description = body.description ? String(body.description).trim() : null;
      if (body.isActive !== undefined) updates.is_active = Boolean(body.isActive);

      const updated = await trx
        .updateTable('cost_centers')
        .set(updates as any)
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .returningAll()
        .executeTakeFirst();

      if (!updated) {
        throw new NotFoundException('مركز التكلفة غير موجود.');
      }

      return {
        ok: true,
        costCenter: {
          ...updated,
          id: Number(updated.id),
          dimension: (updated as any).dimension || 'operational',
          budgetAmount: Number((updated as any).budget_amount || 0),
          parentId: updated.parent_id ? Number(updated.parent_id) : null,
          isActive: Boolean(updated.is_active),
        },
      };
    });
  }

  async deleteCostCenter(id: number, auth: AuthContext) {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    const linkedLines = await this.db
      .selectFrom('journal_entry_lines')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('tenant_id', '=', scope.tenantId)
      .where('cost_center_id', '=', id)
      .executeTakeFirst();

    if (Number(linkedLines?.count || 0) > 0) {
      await this.db
        .updateTable('cost_centers')
        .set({ is_active: false, updated_at: sql`NOW()` } as any)
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      return { ok: true, message: 'تم تعطيل مركز التكلفة لارتباطه بحركات محاسبية سابقة.' };
    }

    await this.db
      .deleteFrom('cost_centers')
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    return { ok: true, message: 'تم حذف مركز التكلفة بنجاح.' };
  }

  async getCostCenterReport(
    costCenterId: number,
    auth: AuthContext,
    filters?: { fromDate?: string; toDate?: string },
  ) {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    const costCenter = await this.db
      .selectFrom('cost_centers')
      .selectAll()
      .where('id', '=', costCenterId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!costCenter) {
      throw new NotFoundException('مركز التكلفة غير موجود.');
    }

    let query = (this.db as any)
      .selectFrom('journal_entry_lines as l')
      .innerJoin('journal_entries as e', (join: any) => join.onRef('l.journal_entry_id', '=', 'e.id').onRef('l.tenant_id', '=', 'e.tenant_id'))
      .innerJoin('accounting_accounts as a', (join: any) => join.onRef('l.account_id', '=', 'a.id').onRef('l.tenant_id', '=', 'a.tenant_id'))
      .select([
        'l.id as lineId',
        'e.id as entryId',
        'e.entry_no as entryNo',
        'e.entry_date as entryDate',
        'e.description as entryDescription',
        'l.description as lineDescription',
        'a.id as accountId',
        'a.code as accountCode',
        'a.name_ar as accountName',
        'a.account_type as accountType',
        'l.debit',
        'l.credit',
      ])
      .where('l.tenant_id', '=', scope.tenantId)
      .where('e.tenant_id', '=', scope.tenantId)
      .where('e.status', '=', 'posted')
      .where('l.cost_center_id', '=', costCenterId);

    if (filters?.fromDate) {
      query = query.where('e.entry_date', '>=', new Date(filters.fromDate));
    }
    if (filters?.toDate) {
      query = query.where('e.entry_date', '<', nextAccountingDay(filters.toDate));
    }

    const lines = await query.orderBy('e.entry_date', 'desc').execute();

    let totalDebit = 0;
    let totalCredit = 0;
    let totalExpenses = 0;
    let totalRevenues = 0;

    for (const line of lines) {
      const debit = Number(line.debit || 0);
      const credit = Number(line.credit || 0);
      totalDebit += debit;
      totalCredit += credit;
      if (line.accountType === 'expense' || line.accountType === 'contra_expense') {
        totalExpenses += (debit - credit);
      } else if (line.accountType === 'revenue' || line.accountType === 'contra_revenue') {
        totalRevenues += (credit - debit);
      }
    }

    const budgetAmount = Number((costCenter as any).budget_amount || 0);
    const variance = budgetAmount > 0 ? (budgetAmount - totalExpenses) : 0;
    const utilizationRate = budgetAmount > 0 ? Math.round((totalExpenses / budgetAmount) * 100) : 0;

    return {
      costCenter: {
        id: Number(costCenter.id),
        code: costCenter.code,
        name: costCenter.name,
        dimension: (costCenter as any).dimension || 'operational',
        budgetAmount,
      },
      summary: {
        totalDebit,
        totalCredit,
        totalExpenses,
        totalRevenues,
        netProfit: totalRevenues - totalExpenses,
        budgetAmount,
        variance,
        utilizationRate,
        linesCount: lines.length,
      },
      lines,
    };
  }

  // ==================== BANK RECONCILIATION ENGINE ====================
  async listBankStatements(auth: AuthContext, accountId?: number): Promise<any[]> {
    this.assertAccountingAccess(auth);

    let query = (this.db as any)
      .selectFrom('bank_statements as bs')
      .innerJoin('accounting_accounts as a', (join: any) => join.onRef('a.id', '=', 'bs.account_id').onRef('a.tenant_id', '=', 'bs.tenant_id'))
      .where(this.tenantPredicate(auth, 'bs'))
      .select([
        'bs.id',
        'bs.account_id',
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'bs.statement_no',
        'bs.statement_date',
        'bs.starting_balance',
        'bs.ending_balance',
        'bs.status',
        'bs.notes',
        'bs.created_at',
      ])
      .orderBy('bs.statement_date', 'desc');

    if (accountId && Number(accountId) > 0) {
      query = query.where('bs.account_id', '=', Number(accountId));
    }

    const rows = await query.execute();
    return rows.map((r: any) => ({
      id: Number(r.id),
      accountId: Number(r.account_id),
      accountCode: r.account_code,
      accountNameAr: r.account_name_ar,
      statementNo: r.statement_no,
      statementDate: String(r.statement_date).slice(0, 10),
      startingBalance: Number(r.starting_balance || 0),
      endingBalance: Number(r.ending_balance || 0),
      status: r.status,
      notes: r.notes || '',
      createdAt: r.created_at,
    }));
  }

  async getBankStatement(id: number, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);

    const statement = await (this.db as any)
      .selectFrom('bank_statements as bs')
      .innerJoin('accounting_accounts as a', (join: any) => join.onRef('a.id', '=', 'bs.account_id').onRef('a.tenant_id', '=', 'bs.tenant_id'))
      .where('bs.id', '=', id)
      .where(this.tenantPredicate(auth, 'bs'))
      .select([
        'bs.id',
        'bs.account_id',
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'bs.statement_no',
        'bs.statement_date',
        'bs.starting_balance',
        'bs.ending_balance',
        'bs.status',
        'bs.notes',
        'bs.created_at',
      ])
      .executeTakeFirst();

    if (!statement) {
      throw new NotFoundException('كشف الحساب البنكي غير موجود.');
    }

    const lines = await (this.db as any)
      .selectFrom('bank_statement_lines')
      .selectAll()
      .where('statement_id', '=', id)
      .where(this.tenantPredicate(auth))
      .orderBy('line_date', 'asc')
      .execute();

    return {
      statement: {
        id: Number(statement.id),
        accountId: Number(statement.account_id),
        accountCode: statement.account_code,
        accountNameAr: statement.account_name_ar,
        statementNo: statement.statement_no,
        statementDate: String(statement.statement_date).slice(0, 10),
        startingBalance: Number(statement.starting_balance || 0),
        endingBalance: Number(statement.ending_balance || 0),
        status: statement.status,
        notes: statement.notes || '',
      },
      lines: lines.map((l: any) => ({
        id: Number(l.id),
        statementId: Number(l.statement_id),
        lineDate: String(l.line_date).slice(0, 10),
        description: l.description,
        reference: l.reference || '',
        amount: Number(l.amount || 0),
        isReconciled: Boolean(l.is_reconciled),
        matchedJournalLineId: l.matched_journal_line_id ? Number(l.matched_journal_line_id) : null,
        reconciledAt: l.reconciled_at,
      })),
    };
  }

  async createBankStatement(dto: CreateBankStatementDto, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);

    // Header, lines and account eligibility must be validated and committed together.
    // Otherwise a failed line insert leaves a draft bank statement without its lines.
    const statementId = await this.db.transaction().execute(async (trx) => {
      const account = await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'is_cash_bank'])
        .where('id', '=', dto.accountId)
        .where(this.tenantPredicate(auth))
        .executeTakeFirst();

      if (!account) throw new BadRequestException('الحساب المالي المحدد غير موجود.');
      if (!account.is_cash_bank) {
        throw new BadRequestException('كشف الحساب البنكي يتطلب حساب خزينة أو بنك.');
      }

      const statement = await (trx as any)
        .insertInto('bank_statements')
        .values({
          tenant_id: scope.tenantId,
          account_id: dto.accountId,
          statement_no: dto.statementNo,
          statement_date: dto.statementDate,
          starting_balance: dto.startingBalance || 0,
          ending_balance: dto.endingBalance || 0,
          status: 'draft',
          notes: dto.notes || null,
        })
        .returning('id')
        .executeTakeFirstOrThrow();

      if (dto.lines && dto.lines.length > 0) {
        const lineRows = dto.lines.map((line) => ({
          tenant_id: scope.tenantId,
          statement_id: statement.id,
          line_date: line.lineDate,
          description: line.description,
          reference: line.reference || null,
          amount: line.amount,
          is_reconciled: false,
        }));
        await (trx as any).insertInto('bank_statement_lines').values(lineRows).execute();
      }
      return Number(statement.id);
    });

    return this.getBankStatement(statementId, auth);
  }

  async getBankReconciliationWorkspace(statementId: number, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);
    const statementData = await this.getBankStatement(statementId, auth);
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const statement = statementData.statement;
    const statementLines = statementData.lines;

    // Fetch GL unreconciled journal lines for this bank account
    const glLines = await (this.db as any)
      .selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', (join: any) =>
        join.onRef('je.id', '=', 'jel.journal_entry_id').onRef('je.tenant_id', '=', 'jel.tenant_id'),
      )
      .where('jel.account_id', '=', statement.accountId)
      .where('je.status', '=', 'posted')
      .where(sql`(jel.is_reconciled = false OR jel.is_reconciled IS NULL)`)
      .where(this.tenantPredicate(auth, 'jel'))
      .select([
        'jel.id',
        'jel.journal_entry_id',
        'je.entry_no',
        'je.entry_date',
        'jel.description',
        'jel.debit',
        'jel.credit',
        'jel.is_reconciled',
      ])
      .orderBy('je.entry_date', 'asc')
      .execute();

    const formattedGlLines = glLines.map((gl: any) => ({
      id: Number(gl.id),
      journalEntryId: Number(gl.journal_entry_id),
      entryNo: gl.entry_no,
      entryDate: String(gl.entry_date).slice(0, 10),
      description: gl.description,
      debit: Number(gl.debit || 0),
      credit: Number(gl.credit || 0),
      netAmount: Number(gl.debit || 0) - Number(gl.credit || 0),
      isReconciled: Boolean(gl.is_reconciled),
    }));

    // Auto-match suggestions:
    // Match statement line (+deposit) with GL debit (+amount)
    // Match statement line (-withdrawal) with GL credit (+amount)
    const suggestions: any[] = [];
    const usedGlIds = new Set<number>();

    for (const sLine of statementLines) {
      if (sLine.isReconciled) continue;
      const targetAmount = sLine.amount;

      for (const glLine of formattedGlLines) {
        if (usedGlIds.has(glLine.id)) continue;
        const matchesDeposit = targetAmount > 0 && bankStatementAmountsEqual(glLine.debit, targetAmount, digits);
        const matchesWithdrawal = targetAmount < 0 && bankStatementAmountsEqual(glLine.credit, Math.abs(targetAmount), digits);

        if (matchesDeposit || matchesWithdrawal) {
          const sDate = new Date(sLine.lineDate).getTime();
          const gDate = new Date(glLine.entryDate).getTime();
          const daysDiff = Math.abs(sDate - gDate) / (1000 * 60 * 60 * 24);

          suggestions.push({
            statementLineId: sLine.id,
            journalLineId: glLine.id,
            confidence: daysDiff <= 7 ? 'high' : 'medium',
            reason: `تطابق تام في المبلغ (${Math.abs(targetAmount).toFixed(digits)}) وفارق زمني ${Math.round(daysDiff)} يوم`,
          });
          usedGlIds.add(glLine.id);
          break;
        }
      }
    }

    // Calculate balances
    const totalReconciledLinesAmount = statementLines
      .filter((l: any) => l.isReconciled)
      .reduce((sum: number, l: any) => sum + l.amount, 0);

    const calculatedEndingBalance = statement.startingBalance + totalReconciledLinesAmount;
    const difference = statement.endingBalance - calculatedEndingBalance;
    // Rounded to book precision, then balanced ONLY at exactly zero: a
    // 0.001 KWD difference is a real unexplained amount, not noise.
    const roundedDifference = roundMoney(difference, digits);

    return {
      statement,
      statementLines,
      glLines: formattedGlLines,
      suggestions,
      summary: {
        startingBalance: statement.startingBalance,
        endingBalance: statement.endingBalance,
        reconciledAmount: totalReconciledLinesAmount,
        calculatedEndingBalance,
        difference: roundedDifference,
        isBalanced: roundedDifference === 0,
        totalLines: statementLines.length,
        reconciledLinesCount: statementLines.filter((l: any) => l.isReconciled).length,
      },
    };
  }

  async reconcileMatch(dto: ReconcileMatchDto, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);
    return this.db.transaction().execute((trx) => this.reconcileMatchInTransaction(trx, dto, auth));
  }

  private async reconcileMatchInTransaction(trx: any, dto: ReconcileMatchDto, auth: AuthContext): Promise<any> {
      // 1. Lock and fetch statement line
      const scope = requireTenantScope(auth);
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const sLine = await trx
        .selectFrom('bank_statement_lines as bsl')
        .innerJoin('bank_statements as bs', (join: any) => join.onRef('bs.id', '=', 'bsl.statement_id').onRef('bs.tenant_id', '=', 'bsl.tenant_id'))
        .where('bsl.id', '=', dto.statementLineId)
        .where(this.tenantPredicate(auth, 'bsl'))
        .select([
          'bsl.id',
          'bsl.amount',
          'bsl.is_reconciled',
          'bsl.statement_id',
          'bs.account_id as statement_account_id',
        ])
        .forUpdate()
        .executeTakeFirst();

      if (!sLine) {
        throw new NotFoundException('سطر كشف الحساب غير موجود.');
      }
      if (sLine.is_reconciled) {
        throw new BadRequestException('سطر كشف الحساب البنكي مطابق بالفعل.');
      }

      // 2. Lock and fetch journal entry line
      const glLine = await trx
        .selectFrom('journal_entry_lines as jel')
        .innerJoin('journal_entries as je', (join: any) => join.onRef('je.id', '=', 'jel.journal_entry_id').onRef('je.tenant_id', '=', 'jel.tenant_id'))
        .where('jel.id', '=', dto.journalLineId)
        .where(this.tenantPredicate(auth, 'jel'))
        .select([
          'jel.id',
          'jel.account_id',
          'jel.debit',
          'jel.credit',
          'jel.is_reconciled',
          'je.status as journal_status',
        ])
        .forUpdate()
        .executeTakeFirst();

      if (!glLine) {
        throw new NotFoundException('سطر القيد المحاسبي غير موجود.');
      }
      if (glLine.journal_status !== 'posted') {
        throw new BadRequestException('لا يمكن مطابقة قيد محاسبي غير مرحل.');
      }
      if (glLine.is_reconciled) {
        throw new BadRequestException('سطر القيد المحاسبي مطابق بالفعل مع حركة بنكية أخرى.');
      }

      // 3. Ensure GL line belongs to the bank account of this statement
      if (Number(glLine.account_id) !== Number(sLine.statement_account_id)) {
        throw new BadRequestException('لا يمكن مطابقة سطر كشف الحساب مع قيد لحساب مالي مختلف.');
      }

      // 4. Mathematical validation: net journal amount must match statement line amount at book precision
      const netJournalAmount = Number(glLine.debit || 0) - Number(glLine.credit || 0);
      const statementAmount = Number(sLine.amount || 0);
      if (!bankStatementAmountsEqual(statementAmount, netJournalAmount, digits)) {
        throw new BadRequestException(
          `عدم تطابق في المبلغ: سطر كشف الحساب (${statementAmount.toFixed(digits)}) لا يتطابق مع القيد المحاسبي (${netJournalAmount.toFixed(digits)}).`
        );
      }

      const now = new Date();

      // 5. Update statement line
      await trx
        .updateTable('bank_statement_lines')
        .set({
          is_reconciled: true,
          matched_journal_line_id: dto.journalLineId,
          reconciled_at: now,
        })
        .where('id', '=', dto.statementLineId)
        .where(this.tenantPredicate(auth))
        .execute();

      // 6. Update journal line
      await trx
        .updateTable('journal_entry_lines')
        .set({
          is_reconciled: true,
          reconciled_at: now,
        })
        .where('id', '=', dto.journalLineId)
        .where(this.tenantPredicate(auth))
        .execute();

      return { success: true, message: 'تمت مطابقة السطر البنكي مع القيد المحاسبي بنجاح.' };
  }

  async unreconcileMatch(statementLineId: number, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);

    return this.db.transaction().execute(async (trx: any) => {
      const line = await trx
        .selectFrom('bank_statement_lines')
        .select(['id', 'matched_journal_line_id', 'is_reconciled'])
        .where('id', '=', statementLineId)
        .where(this.tenantPredicate(auth))
        .forUpdate()
        .executeTakeFirst();

      if (!line) throw new NotFoundException('سطر كشف الحساب غير موجود.');
      if (!line.is_reconciled && !line.matched_journal_line_id) {
        return { success: true, message: 'السطر غير مطابق بالفعل.' };
      }

      if (line.matched_journal_line_id) {
        const glLine = await trx
          .selectFrom('journal_entry_lines')
          .select(['id'])
          .where('id', '=', line.matched_journal_line_id)
          .where(this.tenantPredicate(auth))
          .forUpdate()
          .executeTakeFirst();

        if (glLine) {
          await trx
            .updateTable('journal_entry_lines')
            .set({ is_reconciled: false, reconciled_at: null })
            .where('id', '=', line.matched_journal_line_id)
            .where(this.tenantPredicate(auth))
            .execute();
        }
      }

      await trx
        .updateTable('bank_statement_lines')
        .set({ is_reconciled: false, matched_journal_line_id: null, reconciled_at: null })
        .where('id', '=', statementLineId)
        .where(this.tenantPredicate(auth))
        .execute();

      return { success: true, message: 'تم إلغاء المطابقة وإعادة السطر للحركات المعلقة.' };
    });
  }


  async createBankFeeAdjustment(dto: CreateBankFeeAdjustmentDto, auth: AuthContext): Promise<any> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const sLine = await (trx as any)
        .selectFrom('bank_statement_lines as bsl')
        .innerJoin('bank_statements as bs', (join: any) => join.onRef('bs.id', '=', 'bsl.statement_id').onRef('bs.tenant_id', '=', 'bsl.tenant_id'))
        .where('bsl.id', '=', dto.statementLineId)
        .where(this.tenantPredicate(auth, 'bsl'))
        .where(this.tenantPredicate(auth, 'bs'))
        .select(['bsl.id', 'bsl.amount', 'bsl.line_date', 'bsl.description', 'bsl.is_reconciled', 'bs.account_id'])
        .forUpdate().executeTakeFirst();

      if (!sLine) throw new NotFoundException('سطر كشف الحساب غير موجود.');
      if (sLine.is_reconciled) throw new BadRequestException('سطر كشف الحساب مطابق بالفعل.');
      const signedAmount = Number(sLine.amount);
      if (!Number.isFinite(signedAmount) || signedAmount >= 0) {
        throw new BadRequestException('عمولة البنك يجب أن تكون حركة خصم سالبة.');
      }
      const feeAmount = this.toMoney(Math.abs(signedAmount), digits);
      if (feeAmount <= 0) throw new BadRequestException('مبلغ العمولة غير صالح.');

      const entryResult = await this.createManualJournalEntry({
        entryDate: String(sLine.line_date).slice(0, 10),
        description: dto.description || `مصاريف وعمولات بنكية - كشف حساب (${sLine.description})`,
        lines: [
          { accountId: dto.expenseAccountId, description: dto.description || 'مصاريف وعمولات بنكية', debit: feeAmount, credit: 0 },
          { accountId: Number(sLine.account_id), description: dto.description || 'مصاريف وعمولات بنكية خصماً من الحساب', debit: 0, credit: feeAmount },
        ],
      }, auth, trx);
      const entryId = Number((entryResult as any)?.entry?.id);
      const bankCreditLine = await trx.selectFrom('journal_entry_lines')
        .select(['id'])
        .where('journal_entry_id', '=', entryId)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', Number(sLine.account_id))
        .where('credit', '=', feeAmount)
        .executeTakeFirst();
      if (!bankCreditLine) throw new BadRequestException('لم يتم إنشاء سطر بنك صالح لقيد العمولة.');
      // Both writes rollback together on any reconciliation error; no orphan journal.
      await this.reconcileMatchInTransaction(trx, {
        statementLineId: dto.statementLineId,
        journalLineId: Number(bankCreditLine.id),
      }, auth);
      return {
        success: true,
        message: 'تم إنشاء قيد المصاريف البنكية ومطابقته فورياً.',
        journalEntryId: entryId,
      };
    });
  }
}
