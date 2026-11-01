import { tenantBaseCurrency } from './accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from './engines/money-minor-units.engine';

/**
 * Statement-vs-GL amount equality at book precision. Both sides are
 * rounded to the tenant minor unit first (absorbing float noise such as
 * 0.1 + 0.2 vs 0.3); any remaining difference is real money and must NOT
 * auto-match. The old < 0.01 tolerance silently matched KWD differences
 * of up to 9 fils as an "exact" match and then marked the line reconciled,
 * hiding the gap from every later check.
 */
export function bankStatementAmountsEqual(a: number, b: number, digits: MoneyDigits): boolean {
  return roundMoney(a, digits) === roundMoney(b, digits);
}
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
  CreateAccountDto,
  UpdateAccountDto,
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
import { accountingDateKey, assertTaxPeriodOpen } from './accounting-tax-lock';
import { nextAccountingDay } from './engines/accounting-date.engine';
import { calculateAssetDepreciation, validateFixedAssetTerms } from './engines/fixed-asset-depreciation.engine';
import { randomUUID } from 'node:crypto';

type PartnerType = 'none' | 'customer' | 'supplier';

type DraftJournalLineInput = {
  accountId: number;
  costCenterId?: number | null;
  description?: string;
  debit?: number;
  credit?: number;
  partnerType?: PartnerType;
  partnerId?: number | null;
  branchId?: number | null;
  locationId?: number | null;
};

type DraftJournalEntryInput = {
  entryDate?: Date;
  description?: string;
  sourceType?: string;
  sourceId?: number | null;
  branchId?: number | null;
  locationId?: number | null;
  lines: DraftJournalLineInput[];
};

type OpeningBalanceAccount = {
  id: number;
  code: string;
  nameAr: string;
  accountType: string;
  isActive: boolean;
  allowManualEntries: boolean;
};

type OpeningBalanceLine = {
  accountId: number;
  accountCode: string;
  accountNameAr: string;
  description: string;
  debit: number;
  credit: number;
};

@Injectable()
export class AccountingService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingTenantFoundation: AccountingTenantFoundationService,
    @Optional() private readonly accountingPosting?: AccountingPostingService,
  ) {}

  private assertAccountingAccess(auth: AuthContext): void {
    if (auth.role === 'super_admin' || auth.role === 'admin' || auth.permissions.includes('accounting')) {
      return;
    }
    throw new ForbiddenException('Missing required permissions');
  }

  private toMoney(value: unknown): number {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) throw new BadRequestException('قيمة القيد يجب أن تكون رقمًا صالحًا.');
    return Number(amount.toFixed(2));
  }

  /**
   * Opening-balance rounding: round once with the canonical engine at
   * the tenant's book digits. Kept separate from toMoney (2dp display
   * shaping) so the opening-balance computation can never silently
   * fall back to two decimals. Mirrors toMoney's non-finite guard.
   */
  private toBookMoney(value: unknown, digits: MoneyDigits): number {
    const amount = Number(value ?? 0);
    if (!Number.isFinite(amount)) throw new BadRequestException('قيمة القيد يجب أن تكون رقمًا صالحًا.');
    return roundMoney(amount, digits);
  }

  private async assertJournalReferences(
    queryable: Kysely<Database>, tenantId: string,
    lines: Array<{ costCenterId?: number | null; branchId?: number | null; locationId?: number | null; partnerType?: string; partnerId?: number | null }>,
  ): Promise<void> {
    const ids = (values: Array<number | null | undefined>) => Array.from(new Set(values.filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)));
    const branches = ids(lines.map((line) => line.branchId));
    const locations = ids(lines.map((line) => line.locationId));
    const centers = ids(lines.map((line) => line.costCenterId));
    const customers = ids(lines.filter((line) => line.partnerType === 'customer').map((line) => line.partnerId));
    const suppliers = ids(lines.filter((line) => line.partnerType === 'supplier').map((line) => line.partnerId));
    if (branches.length && (await queryable.selectFrom('branches').select('id')
      .where('tenant_id', '=', tenantId).where('id', 'in', branches).execute()).length !== branches.length) {
      throw new BadRequestException('فرع القيد لا ينتمي لهذه المنشأة.');
    }
    if (locations.length && (await queryable.selectFrom('stock_locations').select('id')
      .where('tenant_id', '=', tenantId).where('id', 'in', locations).execute()).length !== locations.length) {
      throw new BadRequestException('موقع القيد لا ينتمي لهذه المنشأة.');
    }
    if (centers.length && (await queryable.selectFrom('cost_centers').select('id')
      .where('tenant_id', '=', tenantId).where('id', 'in', centers).execute()).length !== centers.length) {
      throw new BadRequestException('مركز تكلفة القيد لا ينتمي لهذه المنشأة.');
    }
    if (customers.length && (await queryable.selectFrom('customers').select('id')
      .where('tenant_id', '=', tenantId).where('id', 'in', customers).execute()).length !== customers.length) {
      throw new BadRequestException('عميل القيد لا ينتمي لهذه المنشأة.');
    }
    if (suppliers.length && (await queryable.selectFrom('suppliers').select('id')
      .where('tenant_id', '=', tenantId).where('id', 'in', suppliers).execute()).length !== suppliers.length) {
      throw new BadRequestException('مورد القيد لا ينتمي لهذه المنشأة.');
    }
  }

  private normalizePartnerType(value: unknown): PartnerType | null {
    if (value === undefined || value === null || String(value).trim() === '') return 'none';
    if (value === 'none' || value === 'customer' || value === 'supplier') return value;
    return null;
  }

  async listAccounts(auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    const rows = await this.db
      .selectFrom('accounting_accounts')
      .select([
        'id',
        'code',
        'name_ar',
        'name_en',
        'account_type',
        'account_group',
        'parent_id',
        'normal_balance',
        'is_active',
        'is_system',
        'allow_manual_entries',
        'is_control_account',
        'is_cash_bank',
        'is_receivable',
        'is_payable',
        'is_inventory',
        'is_tax',
        'is_monetary',
        'revaluation_currency',
        'sort_order',
      ])
      .where(this.tenantPredicate(auth))
      .orderBy('code', 'asc')
      .execute();

    const rowsById = new Map(rows.map((row) => [String(row.id), row]));
    const depthById = new Map<string, number>();
    const visiting = new Set<string>();
    const computeDepth = (id: string): number => {
      const cached = depthById.get(id);
      if (typeof cached === 'number') return cached;
      if (visiting.has(id)) throw new BadRequestException('توجد دورة في دليل الحسابات؛ يلزم تصحيح الروابط.');
      visiting.add(id);
      const row = rowsById.get(id);
      if (!row || !row.parent_id) {
        depthById.set(id, 0);
        return 0;
      }
      const parentDepth = computeDepth(String(row.parent_id));
      const depth = parentDepth + 1;
      visiting.delete(id);
      depthById.set(id, depth);
      return depth;
    };
    for (const row of rows) {
      computeDepth(String(row.id));
    }

    return {
      accounts: rows.map((row) => ({
        id: String(row.id),
        code: row.code,
        nameAr: row.name_ar,
        nameEn: row.name_en || '',
        accountType: row.account_type,
        accountGroup: row.account_group || '',
        parentId: row.parent_id ? String(row.parent_id) : '',
        depth: depthById.get(String(row.id)) || 0,
        normalBalance: row.normal_balance,
        isActive: Boolean(row.is_active),
        isSystem: Boolean(row.is_system),
        allowManualEntries: Boolean(row.allow_manual_entries),
        isControlAccount: Boolean(row.is_control_account),
        isMonetary: Boolean(row.is_monetary),
        revaluationCurrency: row.revaluation_currency || null,
        flags: {
          isCashBank: Boolean(row.is_cash_bank),
          isReceivable: Boolean(row.is_receivable),
          isPayable: Boolean(row.is_payable),
          isInventory: Boolean(row.is_inventory),
          isTax: Boolean(row.is_tax),
        },
        sortOrder: Number(row.sort_order || 0),
      })),
    };
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

  private normalizeDateInput(value?: string | null): string {
    const dateText = String(value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText;
    return new Date().toISOString().slice(0, 10);
  }

  private openingAmount(value: unknown, digits: MoneyDigits): number {
    return this.toBookMoney(Math.max(0, Number(value || 0)), digits);
  }

  private async getExistingOpeningBalanceEntry(auth: AuthContext, db: Kysely<Database> = this.db): Promise<{ id: number } | null> {
    const scope = requireTenantScope(auth);
    const row = await db
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'opening_balance')
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'desc')
      .executeTakeFirst();
    return row ? { id: Number(row.id) } : null;
  }

  private async resolveOpeningAccount(auth: AuthContext, code: string, expectedTypes: string[], db: Kysely<Database> = this.db): Promise<OpeningBalanceAccount> {
    const scope = requireTenantScope(auth);
    const row = await db
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'account_type', 'is_active', 'allow_manual_entries', 'is_control_account', 'is_tax', 'is_receivable', 'is_payable', 'is_inventory'])
      .where('tenant_id', '=', scope.tenantId)
      .where('code', '=', code)
      .executeTakeFirst();

    if (!row) {
      throw new BadRequestException(`حساب الأرصدة الافتتاحية ${code} غير موجود في شجرة الحسابات.`);
    }
    if (!row.is_active) {
      throw new BadRequestException(`حساب الأرصدة الافتتاحية ${code} غير نشط.`);
    }
    if (!row.allow_manual_entries) {
      throw new BadRequestException(`حساب الأرصدة الافتتاحية ${code} لا يسمح بالترحيل عليه.`);
    }
    const accountType = String(row.account_type || '');
    if (!expectedTypes.includes(accountType)) {
      throw new BadRequestException(`نوع الحساب ${code} غير مناسب للأرصدة الافتتاحية.`);
    }

    return {
      id: Number(row.id),
      code: String(row.code || ''),
      nameAr: String(row.name_ar || ''),
      accountType,
      isActive: Boolean(row.is_active),
      allowManualEntries: Boolean(row.allow_manual_entries),
    };
  }

  private addOpeningLine(lines: OpeningBalanceLine[], account: OpeningBalanceAccount, description: string, debit: number, credit: number, digits: MoneyDigits): void {
    const normalizedDebit = this.toBookMoney(debit, digits);
    const normalizedCredit = this.toBookMoney(credit, digits);
    if (normalizedDebit <= 0 && normalizedCredit <= 0) return;
    if (normalizedDebit > 0 && normalizedCredit > 0) {
      throw new BadRequestException('لا يمكن أن يحتوي سطر الأرصدة الافتتاحية على مدين ودائن معًا.');
    }
    lines.push({
      accountId: account.id,
      accountCode: account.code,
      accountNameAr: account.nameAr,
      description,
      debit: normalizedDebit,
      credit: normalizedCredit,
    });
  }

  private async calculateOpeningOperationalTotals(auth: AuthContext, digits: MoneyDigits, db: Kysely<Database> = this.db): Promise<{
    customerReceivables: number;
    supplierPayables: number;
    inventoryValue: number;
  }> {
    const scope = requireTenantScope(auth);
    const [customerResult, supplierResult, inventoryResult] = await Promise.all([
      sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(balance), 0) AS total
        FROM customers
        WHERE tenant_id = ${scope.tenantId}
          AND is_active = TRUE
          AND balance > 0
      `.execute(db),
      sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(balance), 0) AS total
        FROM suppliers
        WHERE tenant_id = ${scope.tenantId}
          AND is_active = TRUE
          AND balance > 0
      `.execute(db),
      sql<{ total: string | number | null }>`
        SELECT COALESCE(SUM(stock_qty * cost_price), 0) AS total
        FROM products
        WHERE tenant_id = ${scope.tenantId}
          AND is_active = TRUE
          AND stock_qty > 0
          AND cost_price > 0
      `.execute(db),
    ]);

    return {
      customerReceivables: this.toBookMoney(customerResult.rows[0]?.total, digits),
      supplierPayables: this.toBookMoney(supplierResult.rows[0]?.total, digits),
      inventoryValue: this.toBookMoney(inventoryResult.rows[0]?.total, digits),
    };
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
    const existing = await this.getExistingOpeningBalanceEntry(auth, db);
    const systemStartDate = this.normalizeDateInput(input.system_start_date);
    const cashOpening = this.openingAmount(input.cash_opening, digits);
    const bankOpening = this.openingAmount(input.bank_opening, digits);
    const operational = await this.calculateOpeningOperationalTotals(auth, digits, db);

    const [cash, bank, receivable, inventory, payable, capital] = await Promise.all([
      this.resolveOpeningAccount(auth, '1110', ['asset'], db),
      this.resolveOpeningAccount(auth, '1120', ['asset'], db),
      this.resolveOpeningAccount(auth, '1130', ['asset'], db),
      this.resolveOpeningAccount(auth, '1140', ['asset'], db),
      this.resolveOpeningAccount(auth, '2110', ['liability'], db),
      this.resolveOpeningAccount(auth, '3100', ['equity'], db),
    ]);

    const lines: OpeningBalanceLine[] = [];
    this.addOpeningLine(lines, cash, 'رصيد افتتاحي - الخزينة', cashOpening, 0, digits);
    this.addOpeningLine(lines, bank, 'رصيد افتتاحي - البنك', bankOpening, 0, digits);
    // Customer, supplier and inventory openings are posted by their source documents.
    // Current operational balances must never be posted a second time here.

    const debitBeforeCapital = this.toBookMoney(lines.reduce((sum, line) => sum + line.debit, 0), digits);
    const creditBeforeCapital = this.toBookMoney(lines.reduce((sum, line) => sum + line.credit, 0), digits);
    const balancingCapital = this.toBookMoney(debitBeforeCapital - creditBeforeCapital, digits);
    if (balancingCapital > 0) {
      this.addOpeningLine(lines, capital, 'موازنة الأرصدة الافتتاحية - رأس المال', 0, balancingCapital, digits);
    } else if (balancingCapital < 0) {
      this.addOpeningLine(lines, capital, 'موازنة الأرصدة الافتتاحية - رأس المال', Math.abs(balancingCapital), 0, digits);
    }

    const warnings: string[] = ['هذا القيد يثبت افتتاحية الخزينة والبنك فقط؛ افتتاحيات الشركاء والمخزون تثبت من مستنداتها.'];
    if (!lines.length) {
      warnings.push('لا توجد أرصدة افتتاحية ذات قيمة للترحيل.');
    }
    if (operational.inventoryValue <= 0) {
      warnings.push('قيمة المخزون الافتتاحية تساوي صفرًا حسب كميات وتكلفة الأصناف الحالية.');
    }

    return {
      alreadyPosted: Boolean(existing),
      existingOpeningEntryId: existing?.id ?? null,
      systemStartDate,
      totals: {
        cashOpening,
        bankOpening,
        customerReceivables: operational.customerReceivables,
        supplierPayables: operational.supplierPayables,
        inventoryValue: operational.inventoryValue,
        balancingCapital,
      },
      linesPreview: lines.map((line) => ({
        accountId: line.accountId,
        accountCode: line.accountCode,
        accountNameAr: line.accountNameAr,
        description: line.description,
        debit: this.toBookMoney(line.debit, digits),
        credit: this.toBookMoney(line.credit, digits),
      })),
      warnings,
    };
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
    this.assertAccountingAccess(auth);
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize || 20)));
    const offset = (page - 1) * pageSize;

    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : null;

    let countQuery = this.db.selectFrom('journal_entries').where(this.tenantPredicate(auth));
    let rowsQuery = this.db
      .selectFrom('journal_entries as je')
      .leftJoin('users as creator', (join) => join.onRef('creator.id', '=', 'je.created_by').onRef('creator.tenant_id', '=', 'je.tenant_id'))
      .leftJoin('users as poster', (join) => join.onRef('poster.id', '=', 'je.posted_by').onRef('poster.tenant_id', '=', 'je.tenant_id'))
      .select([
        'je.id',
        'je.entry_no',
        'je.entry_date',
        'je.description',
        'je.source_type',
        'je.source_id',
        'je.status',
        'je.branch_id',
        'je.location_id',
        'je.created_by',
        'je.posted_by',
        'je.posted_at',
        'je.cancelled_at',
        'je.created_at',
        'creator.username as created_by_name',
        'poster.username as posted_by_name',
      ])
      .where(this.tenantPredicate(auth, 'je'));

    if (dateFrom) {
      countQuery = countQuery.where('entry_date', '>=', dateFrom);
      rowsQuery = rowsQuery.where('je.entry_date', '>=', dateFrom);
    }
    if (dateTo) {
      countQuery = countQuery.where('entry_date', '<', nextAccountingDay(dateTo));
      rowsQuery = rowsQuery.where('je.entry_date', '<', nextAccountingDay(dateTo));
    }
    if (filters.status) {
      countQuery = countQuery.where('status', '=', filters.status);
      rowsQuery = rowsQuery.where('je.status', '=', filters.status);
    }
    if (filters.sourceType) {
      countQuery = countQuery.where('source_type', '=', filters.sourceType.trim());
      rowsQuery = rowsQuery.where('je.source_type', '=', filters.sourceType.trim());
    }

    const lastSeenId = Math.max(0, Number(filters.lastSeenId || filters.cursor || 0));
    if (lastSeenId > 0) {
      rowsQuery = rowsQuery.where('je.id', '<', lastSeenId);
    }

    const totalRow = await countQuery.select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirst();
    const totalItems = Number(totalRow?.count || 0);
    const rows = await rowsQuery
      .orderBy('je.id', 'desc')
      .limit(pageSize)
      .offset(lastSeenId > 0 ? 0 : offset)
      .execute();

    const nextCursor = rows.length === pageSize ? String(rows[rows.length - 1].id) : null;

    return {
      entries: rows.map((row) => ({
        id: String(row.id),
        entryNo: row.entry_no,
        entryDate: row.entry_date,
        description: row.description || '',
        sourceType: row.source_type || 'manual',
        sourceId: row.source_id ? String(row.source_id) : '',
        status: row.status,
        branchId: row.branch_id ? String(row.branch_id) : '',
        locationId: row.location_id ? String(row.location_id) : '',
        createdBy: row.created_by ? String(row.created_by) : '',
        createdByName: row.created_by_name || '',
        postedBy: row.posted_by ? String(row.posted_by) : '',
        postedByName: row.posted_by_name || '',
        postedAt: row.posted_at,
        cancelledAt: row.cancelled_at,
      })),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        nextCursor,
      },
    };
  }

  async getJournalEntry(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const { tenantId } = requireTenantScope(auth);
    const entry = await this.db
      .selectFrom('journal_entries')
      .selectAll()
      .where('id', '=', id)
      .where(this.tenantPredicate(auth))
      .executeTakeFirst();
    if (!entry) throw new NotFoundException('Journal entry not found');

    const lines = await (this.db as any)
      .selectFrom('journal_entry_lines as l')
      .innerJoin('accounting_accounts as a', (j: any) => j.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'))
      .leftJoin('cost_centers as cc', (j: any) => j.onRef('cc.id', '=', 'l.cost_center_id').onRef('cc.tenant_id', '=', 'l.tenant_id'))
      .select([
        'l.id',
        'l.journal_entry_id',
        'l.account_id',
        'l.cost_center_id',
        'cc.code as cost_center_code',
        'cc.name as cost_center_name',
        'l.description',
        'l.debit',
        'l.credit',
        'l.partner_type',
        'l.partner_id',
        'l.branch_id',
        'l.location_id',
        'l.is_reconciled',
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'a.name_en as account_name_en',
      ])
      .where('l.journal_entry_id', '=', id)
      .where('l.tenant_id', '=', tenantId)
      .orderBy('l.id', 'asc')
      .execute();

    const totalDebit = this.toMoney(lines.reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0));
    const totalCredit = this.toMoney(lines.reduce((sum: number, line: any) => sum + Number(line.credit || 0), 0));

    return {
      entry: {
        id: String(entry.id),
        entryNo: entry.entry_no,
        entryDate: entry.entry_date,
        description: entry.description || '',
        sourceType: entry.source_type || 'manual',
        sourceId: entry.source_id ? String(entry.source_id) : '',
        status: entry.status,
        canReverse: entry.status === 'posted' && entry.source_type === 'manual' &&
          !entry.reversal_of_entry_id && !entry.reversed_by_entry_id &&
          !lines.some((line: { is_reconciled: boolean }) => line.is_reconciled),
        reversedByEntryId: entry.reversed_by_entry_id ? String(entry.reversed_by_entry_id) : null,
        reversalOfEntryId: entry.reversal_of_entry_id ? String(entry.reversal_of_entry_id) : null,
        branchId: entry.branch_id ? String(entry.branch_id) : '',
        locationId: entry.location_id ? String(entry.location_id) : '',
        createdBy: entry.created_by ? String(entry.created_by) : '',
        postedBy: entry.posted_by ? String(entry.posted_by) : '',
        postedAt: entry.posted_at,
        cancelledBy: entry.cancelled_by ? String(entry.cancelled_by) : '',
        cancelledAt: entry.cancelled_at,
        cancelReason: entry.cancel_reason || '',
        lines: lines.map((line: any) => ({
          id: String(line.id),
          accountId: String(line.account_id),
          accountCode: line.account_code,
          accountNameAr: line.account_name_ar,
          accountNameEn: line.account_name_en || '',
          costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
          costCenterCode: line.cost_center_code || null,
          costCenterName: line.cost_center_name || null,
          description: line.description || '',
          debit: this.toMoney(line.debit),
          credit: this.toMoney(line.credit),
          partnerType: line.partner_type,
          partnerId: line.partner_id ? String(line.partner_id) : '',
          branchId: line.branch_id ? String(line.branch_id) : '',
          locationId: line.location_id ? String(line.location_id) : '',
        })),
        totals: {
          debit: totalDebit,
          credit: totalCredit,
          balanced: Math.abs(totalDebit - totalCredit) <= 0.0001,
        },
      },
    };
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
    const queryable = options?.queryable || this.db;
    const settings = await queryable
      .selectFrom('accounting_settings')
      .select(['lock_date_all', 'lock_date_non_adviser', 'lock_date_tax'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', 1)
      .executeTakeFirst();

    const dateStr = await resolveBusinessDateKey(queryable, tenantId, entryDate);

    if (settings) {
      // 1. Hard lock (All users)
      if (settings.lock_date_all) {
        const lockAllStr = accountingDateKey(settings.lock_date_all);
        if (dateStr <= lockAllStr) {
          throw new BadRequestException(
            `الفترة المحاسبية مقفلة نهائياً حتى تاريخ ${lockAllStr}. لا يمكن إضافة أو تعديل قيود في فترة مغلقة.`
          );
        }
      }

      // 2. Operational lock (Non-advisers)
      if (settings.lock_date_non_adviser) {
        const lockNonAdvStr = accountingDateKey(settings.lock_date_non_adviser);
        const isAdviser = options?.auth?.role === 'admin' || options?.auth?.role === 'super_admin';
        if (!isAdviser && dateStr <= lockNonAdvStr) {
          throw new BadRequestException(
            `الفترة المحاسبية مقفلة للعمليات التشغيلية حتى تاريخ ${lockNonAdvStr}. يرجى مراجعة الإدارة المالية.`
          );
        }
      }

      // 3. Tax lock
      if (options?.isTaxOperation && settings.lock_date_tax) {
        const lockTaxStr = accountingDateKey(settings.lock_date_tax);
        if (dateStr <= lockTaxStr) {
          throw new BadRequestException(
            `الفترة الضريبية مقفلة حتى تاريخ ${lockTaxStr}. لا يمكن إجراء عمليات تؤثر على ضريبة هذه الفترة المغلقة.`
          );
        }
      }
    }

    // 4. Monthly fiscal period lock (البند O6)
    const closedPeriod = await queryable
      .selectFrom('accounting_fiscal_periods')
      .select(['name', 'period_number'])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'closed')
      .where('start_date', '<=', dateStr as any)
      .where('end_date', '>=', dateStr as any)
      .executeTakeFirst();

    if (closedPeriod) {
      throw new BadRequestException(
        `الفترة المحاسبية الشهرية [${closedPeriod.name}] مقفلة. لا يمكن إضافة أو تعديل قيود في فترة مغلقة.`
      );
    }
  }

  async createManualJournalEntry(dto: CreateManualJournalEntryDto, auth: AuthContext, externalTrx?: Kysely<Database>): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);

    if (!dto.lines || dto.lines.length < 2) {
      throw new BadRequestException('يجب أن يحتوي القيد اليومي على سطرين على الأقل (مدين ودائن).');
    }

    const entryDate = dto.entryDate ? new Date(dto.entryDate) : new Date();
    if (Number.isNaN(entryDate.getTime())) {
      throw new BadRequestException('تاريخ القيد غير صالح.');
    }

    // Check period lock dates
    await this.assertNotInLockedPeriod(scope.tenantId, entryDate, { auth });

    // Raw DTO lines are collected here unrounded. Rounding happens
    // inside writeJournal, on the transaction handle, at the tenant's
    // book digits (see below): resolving digits on the pool handle
    // outside the transaction could post stale precision.
    const pendingLines: Array<{
      accountId: number;
      costCenterId: number | null;
      description: string;
      debit: number;
      credit: number;
      partnerType: 'none' | 'customer' | 'supplier';
      partnerId: number | null;
    }> = [];

    const accountIds = new Set<number>();
    for (const line of dto.lines) {
      const accId = Number(line.accountId);
      if (!accId || accId <= 0) {
        throw new BadRequestException('يجب تحديد حساب صالح لكل سطر في القيد.');
      }
      accountIds.add(accId);

      const rawDebit = Number(line.debit ?? 0);
      const rawCredit = Number(line.credit ?? 0);
      if (!Number.isFinite(rawDebit) || !Number.isFinite(rawCredit)) {
        throw new BadRequestException('قيمة القيد يجب أن تكون رقمًا صالحًا.');
      }

      if (rawDebit < 0 || rawCredit < 0) {
        throw new BadRequestException('مبالغ المدين والدائن يجب ألا تكون سالبة.');
      }

      pendingLines.push({
        accountId: accId,
        costCenterId: line.costCenterId ? Number(line.costCenterId) : null,
        description: String(line.description || dto.description || '').trim(),
        debit: rawDebit,
        credit: rawCredit,
        partnerType: line.partnerType || 'none',
        partnerId: line.partnerId ? Number(line.partnerId) : null,
      });
    }

    // Verify all accounts belong to tenant and allow manual entries
    const existingAccounts = await this.db
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'is_active', 'allow_manual_entries', 'is_control_account', 'is_tax', 'is_receivable', 'is_payable', 'is_inventory'])
      .where('tenant_id', '=', scope.tenantId)
      .where('id', 'in', Array.from(accountIds))
      .execute();

    if (existingAccounts.length !== accountIds.size) {
      throw new BadRequestException('واحد أو أكثر من الحسابات المحددة غير موجود في شجرة الحسابات.');
    }

    for (const acc of existingAccounts) {
      if (!acc.is_active) {
        throw new BadRequestException(`الحساب [${acc.code} - ${acc.name_ar}] غير نشط.`);
      }
      if (acc.is_control_account || acc.is_receivable || acc.is_payable || acc.is_inventory || ['1130', '1140', '2110'].includes(acc.code)) throw new BadRequestException('الحساب الرقابي يُعدّل من مستند الشريك أو المخزون لضمان تطابق الأستاذ المساعد.');
      if (!acc.allow_manual_entries) {
        throw new BadRequestException(`الحساب [${acc.code} - ${acc.name_ar}] لا يسمح بإدخال قيود يدوية.`);
      }
    }

    const userId = Number(auth.userId) || null;
    const branchId = dto.branchId ? Number(dto.branchId) : null;

    const writeJournal = async (trx: Kysely<Database>) => {
      const posting = this.accountingPosting;
      if (!posting) throw new Error('Accounting posting service is required for manual journal posting');

      // Book digits resolved on THIS transaction handle, fail closed
      // on a base-currency/rate mismatch (P0-1/P0-2 pattern). The
      // lines below are rounded once here, at book digits; the
      // posting boundary re-rounds idempotently and re-validates.
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const unit = 10 ** -digits;
      const maxDifference = unit;

      const validatedLines: Array<{
        accountId: number;
        costCenterId: number | null;
        description: string;
        debit: number;
        credit: number;
        partnerType: 'none' | 'customer' | 'supplier';
        partnerId: number | null;
      }> = [];

      let totalDebit = 0;
      let totalCredit = 0;
      for (const line of pendingLines) {
        const debit = this.toBookMoney(line.debit, digits);
        const credit = this.toBookMoney(line.credit, digits);

        if (debit <= 0 && credit <= 0) {
          throw new BadRequestException('يجب تحديد مبلغ مدين أو دائن أكبر من الصفر لكل سطر.');
        }
        if (debit > 0 && credit > 0) {
          throw new BadRequestException('لا يمكن أن يكون السطر مدين ودائن في نفس الوقت.');
        }

        totalDebit += debit;
        totalCredit += credit;
        validatedLines.push({ ...line, debit, credit });
      }

      totalDebit = this.toBookMoney(totalDebit, digits);
      totalCredit = this.toBookMoney(totalCredit, digits);

      // The difference itself is rounded at book digits before any
      // comparison (the boundary does the same): the raw float
      // subtraction of two rounded totals can exceed one minor
      // unit by float dust alone.
      const difference = this.toBookMoney(totalDebit - totalCredit, digits);
      if (Math.abs(difference) > maxDifference) {
        throw new BadRequestException(`القيد غير متزن: إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit}). الفارق: ${Math.abs(difference).toFixed(digits)}`);
      }

      // Rounding plug, book-digit-relative: the boundary plugs a
      // difference of at least half a minor unit and at most one
      // minor unit into 7290. After book-digit rounding a nonzero
      // difference is exactly one minor unit, so the plug fires
      // exactly when the rounded lines differ by one minor unit.
      if (Math.abs(difference) >= unit / 2) {
        const roundingAccount = await trx.selectFrom('accounting_accounts')
          .select(['id', 'is_active']).where('tenant_id', '=', scope.tenantId)
          .where('code', '=', '7290').executeTakeFirst();
        if (!roundingAccount?.is_active) throw new BadRequestException('حساب فروق التقريب المحاسبي 7290 غير موجود أو غير نشط.');
        const debit = difference < 0 ? Math.abs(difference) : 0;
        const credit = difference > 0 ? difference : 0;
        validatedLines.push({ accountId: Number(roundingAccount.id), costCenterId: null, description: 'فروق تقريب القيد', debit, credit, partnerType: 'none', partnerId: null });
        totalDebit = this.toBookMoney(totalDebit + debit, digits);
        totalCredit = this.toBookMoney(totalCredit + credit, digits);
      }
      if (Math.abs(this.toBookMoney(totalDebit - totalCredit, digits)) >= unit / 2) throw new BadRequestException('القيد غير متزن بعد التسوية.');

      await lockAccountingPeriod(trx, scope.tenantId);
      await this.assertNotInLockedPeriod(scope.tenantId, entryDate, { auth, queryable: trx });
      await assertTaxPeriodOpen(trx, scope.tenantId, entryDate, validatedLines.map((line) => line.accountId));
      await this.assertJournalReferences(trx, scope.tenantId, validatedLines.map((line) => ({ ...line, branchId })));
      const lockedAccounts = await trx.selectFrom('accounting_accounts')
        .select(['id', 'code', 'name_ar', 'is_active', 'allow_manual_entries', 'is_control_account', 'is_tax', 'is_receivable', 'is_payable', 'is_inventory'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', Array.from(accountIds).sort((a, b) => a - b))
        .orderBy('id', 'asc').forUpdate().execute();
      if (lockedAccounts.length !== accountIds.size) {
        throw new BadRequestException('واحد أو أكثر من الحسابات المحددة غير موجود في شجرة الحسابات.');
      }
      const mapping = await trx.selectFrom('accounting_settings').select(['customer_receivable_account_id', 'supplier_payable_account_id', 'inventory_account_id']).where('tenant_id', '=', scope.tenantId).where('id', '=', 1).executeTakeFirst();
      const mappedControls = new Set(Object.values(mapping || {}).map(Number));
      for (const account of lockedAccounts) {
        if (!account.is_active || !account.allow_manual_entries || account.is_control_account || account.is_receivable || account.is_payable || account.is_inventory || mappedControls.has(Number(account.id))) {
          throw new BadRequestException(`الحساب [${account.code} - ${account.name_ar}] غير نشط أو لا يسمح بقيود يدوية.`);
        }
      }
      await this.assertNotInLockedPeriod(scope.tenantId, entryDate, { auth, queryable: trx, isTaxOperation: lockedAccounts.some(account => account.is_tax || ['1150', '1155', '2120', '2126', '2146'].includes(account.code)) });
      // Post through the canonical posting boundary (P0-2 precedent):
      // it owns numbering, re-rounding, the balance/plug backstop and
      // the automated period lock. The manual validations above stay:
      // the boundary checks active accounts only, not manual-entry
      // eligibility, control accounts or mapped control accounts.
      // sourceId 0 follows the forex-revaluation precedent for a
      // sourceless journal; 'manual' has no dedup lookup. The cash
      // flow category is carried by the boundary so the cash-flow
      // report keeps reading it from the posted entry.
      const entryId = await posting.postDomainJournal(trx, {
        sourceType: 'manual',
        sourceId: 0,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate,
        description: String(dto.description || '').trim(),
        branchId,
        createdBy: userId,
        postedBy: userId,
        cashFlowCategory: dto.cashFlowCategory ?? null,
        lines: validatedLines.map((line) => ({
          accountId: line.accountId,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          partnerType: line.partnerType,
          partnerId: line.partnerId,
          branchId,
          locationId: null,
          costCenterId: line.costCenterId,
        })),
      });
      const stored = await trx
        .selectFrom('journal_entries')
        .select('entry_no')
        .where('id', '=', entryId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirstOrThrow();

      return {
        id: entryId,
        entryNo: String(stored.entry_no),
        totalDebit,
        totalCredit,
      };
    };
    const result = externalTrx ? await writeJournal(externalTrx) : await this.db.transaction().execute(writeJournal);

    return {
      ok: true,
      entry: result,
      message: `تم إنشاء وترحيل القيد اليومي بنجاح برقم ${result.entryNo}`,
    };
  }

  async reverseJournalEntry(entryId: number, reason: string, auth: AuthContext): Promise<{ ok: boolean; message: string; reversalEntryId: number; reversalEntryNo: string }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    const userId = Number(auth.userId || 0) || null;

    const trimmedReason = String(reason || '').trim();
    if (!trimmedReason) {
      throw new BadRequestException('سبب عكس القيد مطلوب');
    }

    const entry = await this.db
      .selectFrom('journal_entries')
      .selectAll()
      .where('id', '=', entryId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!entry) {
      throw new NotFoundException('القيد اليومي غير موجود');
    }

    if (entry.source_type !== 'manual') throw new BadRequestException('يجب عكس القيد الآلي من المستند الأصلي لضمان تزامن المخزون والأستاذ المساعد.');

    if (entry.status !== 'posted') {
      throw new BadRequestException('لا يمكن عكس قيد غير مرحل أو تم إلغاؤه مسبقاً');
    }

    if (entry.reversed_by_entry_id) {
      throw new BadRequestException('تم عكس هذا القيد بالفعل مسبقاً');
    }

    if (entry.source_type !== 'manual' || entry.reversal_of_entry_id) {
      throw new BadRequestException('يجب إلغاء أو تسوية القيد الآلي من المستند الأصلي للحفاظ على المخزون وأرصدة الأطراف. العكس المباشر متاح للقيود اليدوية فقط.');
    }

    const lines = await this.db
      .selectFrom('journal_entry_lines')
      .selectAll()
      .where('journal_entry_id', '=', entryId)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    if (!lines.length) {
      throw new BadRequestException('لا توجد سطور في هذا القيد لعكسها');
    }

    if (lines.some((line: any) => Boolean(line.is_reconciled))) {
      throw new BadRequestException('لا يمكن عكس قيد يومي تمت تسوية أحد سطوره في التسوية البنكية.');
    }

    const result = await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      // Re-read the original under a row lock. The guards above ran on an unlocked read, so two
      // concurrent reversal requests would both see reversed_by_entry_id = NULL, both pass, and the
      // entry would be reversed twice — doubling the reversal's effect on the ledger.
      const lockedEntry = await trx
        .selectFrom('journal_entries')
        .selectAll()
        .where('id', '=', entryId)
        .where('tenant_id', '=', scope.tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedEntry) throw new NotFoundException('القيد اليومي غير موجود');
      if (lockedEntry.status !== 'posted') throw new BadRequestException('لا يمكن عكس قيد غير مرحل أو تم إلغاؤه مسبقاً');
      if (lockedEntry.reversed_by_entry_id) throw new BadRequestException('تم عكس هذا القيد بالفعل مسبقاً');
      if (lockedEntry.source_type !== 'manual' || lockedEntry.reversal_of_entry_id) {
        throw new BadRequestException('يجب تسوية القيد الآلي من المستند الأصلي.');
      }

      const lockedLines = await trx
        .selectFrom('journal_entry_lines')
        .selectAll()
        .where('journal_entry_id', '=', entryId)
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('id', 'asc').forUpdate()
        .execute();
      if (!lockedLines.length) throw new BadRequestException('لا توجد سطور في هذا القيد لعكسها');
      if (lockedLines.some((line: any) => Boolean(line.is_reconciled))) {
        throw new BadRequestException('لا يمكن عكس قيد يومي تمت تسوية أحد سطوره في التسوية البنكية.');
      }

      // A reversal is a new posting and must respect the period lock like any other. Without this,
      // reversing into a closed fiscal year silently rewrites that year's balances after sign-off.
      const taxAccounts = await trx.selectFrom('accounting_accounts').select('id').where('tenant_id', '=', scope.tenantId).where('id', 'in', lines.map(line => Number(line.account_id))).where(eb => eb.or([eb('is_tax', '=', true), eb('code', 'in', ['1150', '1155', '2120', '2126', '2146'])])).execute();
      const isTaxOperation = taxAccounts.length > 0;
      const reversalDate = new Date();
      await this.assertNotInLockedPeriod(scope.tenantId, lockedEntry.entry_date, { auth, queryable: trx, isTaxOperation });
      await this.assertNotInLockedPeriod(scope.tenantId, reversalDate, { auth, queryable: trx, isTaxOperation });
      await assertTaxPeriodOpen(trx, scope.tenantId, reversalDate, lockedLines.map((line) => Number(line.account_id)));
      await trx.selectFrom('accounting_accounts').select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', Array.from(new Set(lockedLines.map((line) => Number(line.account_id)))).sort((a, b) => a - b))
        .orderBy('id', 'asc').forUpdate().execute();

      const tempEntryNo = `JE-TMP-${randomUUID()}`;
      const inserted = await trx
        .insertInto('journal_entries')
        .values({
          entry_no: tempEntryNo,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          entry_date: reversalDate,
          description: `قيد عكسي للقيد رقم ${entry.entry_no}: ${trimmedReason}`,
          source_type: `${entry.source_type}_reversal`,
          cash_flow_category: lockedEntry.cash_flow_category || null,
          source_id: entry.id,
          status: 'posted',
          branch_id: entry.branch_id,
          location_id: entry.location_id,
          created_by: userId,
          posted_by: userId,
          posted_at: sql`NOW()`,
          reversal_of_entry_id: entry.id,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      const revId = Number(inserted.id);
      const officialEntryNo = `JE-${String(revId).padStart(8, '0')}`;

      await trx
        .updateTable('journal_entries')
        .set({ entry_no: officialEntryNo, updated_at: sql`NOW()` } as any)
        .where('id', '=', revId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      // Mirror lines: swap debit and credit
      const reversalLines = lockedLines.map((l) => ({
        journal_entry_id: revId,
        tenant_id: scope.tenantId,
        account_id: l.account_id,
        cost_center_id: l.cost_center_id || null,
        description: `عكس: ${l.description || ''}`.trim(),
        debit: Number(l.credit || 0),
        credit: Number(l.debit || 0),
        partner_type: l.partner_type,
        partner_id: l.partner_id,
        branch_id: l.branch_id,
        location_id: l.location_id,
      }));

      await trx
        .insertInto('journal_entry_lines')
        .values(reversalLines as any)
        .execute();

      // Keep both posted entries in the ledger so their financial effects offset.
      await trx
        .updateTable('journal_entries')
        .set({
          reversed_by_entry_id: revId,
          updated_at: sql`NOW()`,
        } as any)
        .where('id', '=', entry.id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      return {
        reversalEntryId: revId,
        reversalEntryNo: officialEntryNo,
      };
    });

    return {
      ok: true,
      message: `تم إنشاء القيد العكسي برقم ${result.reversalEntryNo} مع بقاء القيد الأصلي في سجل الأستاذ.`,
      reversalEntryId: result.reversalEntryId,
      reversalEntryNo: result.reversalEntryNo,
    };
  }

  async getFinancialSummary(filters: FinancialSummaryQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);

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
      const debit = this.toMoney(row.debit);
      const credit = this.toMoney(row.credit);
      const sourceType = String(row.source_type || '');
      const revenueMovement = this.toMoney(credit - debit);
      const expenseMovement = this.toMoney(debit - credit);

      if (this.inCodes(code, REVENUE_CODES) || accountType === 'revenue') {
        if (!this.inCodes(code, CONTRA_REVENUE_CODES) && accountType !== 'contra_revenue') {
          grossSales = this.toMoney(grossSales + revenueMovement);
          const current = revenueBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
          current.amount = this.toMoney(current.amount + revenueMovement);
          revenueBreakdown.set(code, current);
        }
      }

      if (code === '4400') {
        salesReturns = this.toMoney(salesReturns + expenseMovement);
      }
      if (code === '4300') {
        salesDiscounts = this.toMoney(salesDiscounts + expenseMovement);
      }
      if (accountType === 'contra_revenue' && !this.inCodes(code, ['4300', '4400'])) {
        salesReturns = this.toMoney(salesReturns + expenseMovement);
      }

      if (this.inCodes(code, COGS_CODES) || accountGroup === 'cogs') {
        cogs = this.toMoney(cogs + expenseMovement);
      }

      const isOperatingExpense = (accountType === 'expense' || accountType === 'contra_expense' || accountGroup === 'operating_expenses')
        && !this.inCodes(code, COGS_CODES)
        && accountGroup !== 'cogs';
      if (isOperatingExpense) {
        operatingExpenses = this.toMoney(operatingExpenses + expenseMovement);
        const current = expenseBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
        current.amount = this.toMoney(current.amount + expenseMovement);
        expenseBreakdown.set(code, current);
      }

      if (this.inCodes(code, CASH_BANK_CODES) || accountGroup === 'cash_bank') {
        cashDebits = this.toMoney(cashDebits + Math.max(0, debit));
        cashCredits = this.toMoney(cashCredits + Math.max(0, credit));
        const movement = this.toMoney(debit - credit);
        const current = cashBreakdown.get(code) || { accountCode: code, accountNameAr, amount: 0 };
        current.amount = this.toMoney(current.amount + movement);
        cashBreakdown.set(code, current);

        if (sourceType === 'customer_payment' && debit > 0) {
          customerCollections = this.toMoney(customerCollections + debit);
        }
        if ((sourceType === 'supplier_payment' || sourceType === 'supplier_payment_schedule_settlement') && credit > 0) {
          supplierPayments = this.toMoney(supplierPayments + credit);
        }
        if ((sourceType === 'expense' || sourceType === 'treasury_expense') && credit > 0) {
          treasuryExpenses = this.toMoney(treasuryExpenses + credit);
        }
      }
    }

    const netSales = this.toMoney(grossSales - salesReturns - salesDiscounts);
    const grossProfit = this.toMoney(netSales - cogs);
    const netProfit = this.toMoney(grossProfit - operatingExpenses);
    // This is period movement only (not an opening/closing balance).
    const netCashMovement = this.toMoney(cashDebits - cashCredits);

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
          balance: this.toMoney(row.balance),
          lastMovementDate: customerLastMap.get(String(row.id)) || '',
        }))
        .filter((row) => showZero || Math.abs(row.balance) > 0.0001);

      const supplierRows = suppliers
        .map((row) => ({
          supplierId: String(row.id),
          supplierName: row.name || '',
          phone: row.phone || '',
          balance: this.toMoney(row.balance),
          lastMovementDate: supplierLastMap.get(String(row.id)) || '',
        }))
        .filter((row) => showZero || Math.abs(row.balance) > 0.0001);

      const customerReceivables = this.toMoney(
        customerRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
      );
      const supplierPayables = this.toMoney(
        supplierRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
      );

      return {
        totals: {
          customerReceivables,
          supplierPayables,
          netPosition: this.toMoney(customerReceivables - supplierPayables),
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
          balance: this.toMoney(row.balance_total || 0),
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
          balance: this.toMoney(row.balance_total || 0),
          lastMovementDate: row.last_movement_at ? String(row.last_movement_at) : '',
        };
      })
      .filter((row) => row.supplierId)
      .filter((row) => showZero || Math.abs(row.balance) > 0.0001)
      .sort((a, b) => b.balance - a.balance);

    const customerReceivables = this.toMoney(
      customerRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
    );
    const supplierPayables = this.toMoney(
      supplierRows.reduce((sum, row) => sum + (row.balance > 0 ? row.balance : 0), 0),
    );

    return {
      totals: {
        customerReceivables,
        supplierPayables,
        netPosition: this.toMoney(customerReceivables - supplierPayables),
      },
      customers: customerRows,
      suppliers: supplierRows,
    };
  }

  async getCashMovement(filters: CashMovementQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
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
      const debit = this.toMoney(row.debit);
      const credit = this.toMoney(row.credit);
      const sourceType = String(row.source_type || 'other');
      const accountCode = String(row.account_code || '');
      const accountNameAr = String(row.account_name_ar || '');

      totalDebit = this.toMoney(totalDebit + debit);
      totalCredit = this.toMoney(totalCredit + credit);

      const accountItem = byAccount.get(accountCode) || { accountCode, accountNameAr, debit: 0, credit: 0, net: 0 };
      accountItem.debit = this.toMoney(accountItem.debit + debit);
      accountItem.credit = this.toMoney(accountItem.credit + credit);
      accountItem.net = this.toMoney(accountItem.debit - accountItem.credit);
      byAccount.set(accountCode, accountItem);

      const sourceItem = bySource.get(sourceType) || { sourceType, debit: 0, credit: 0, net: 0 };
      sourceItem.debit = this.toMoney(sourceItem.debit + debit);
      sourceItem.credit = this.toMoney(sourceItem.credit + credit);
      sourceItem.net = this.toMoney(sourceItem.debit - sourceItem.credit);
      bySource.set(sourceType, sourceItem);
    }

    return {
      period: this.mapPeriod(filters.date_from, filters.date_to),
      totals: {
        totalIn: totalDebit,
        totalOut: totalCredit,
        netMovement: this.toMoney(totalDebit - totalCredit),
      },
      accounts: Array.from(byAccount.values()).sort((a, b) => Number(a.accountCode || 0) - Number(b.accountCode || 0)),
      sources: Array.from(bySource.values()).sort((a, b) => b.net - a.net),
    };
  }

  async getInventoryValue(filters: InventoryValueQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);

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
      sql<number>`COALESCE(SUM(ROUND(${stockQty} * COALESCE(p.cost_price, 0), 2)), 0)`.as('total_inventory_value'),
      sql<number>`COALESCE(SUM(ROUND(ROUND(${stockQty}, 2) * ROUND(COALESCE(p.retail_price, 0), 2), 2)), 0)`.as('total_retail_value'),
      sql<number>`COUNT(*)::int`.as('item_count'),
      sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) > 0 AND ROUND(${stockQty}, 2) <= ROUND(p.min_stock_qty, 2))::int`.as('low_stock_count'),
      sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) = 0)::int`.as('zero_stock_count'),
      sql<number>`COUNT(*) FILTER (WHERE ROUND(${stockQty}, 2) < 0)::int`.as('negative_stock_count'),
    ]).executeTakeFirst();

    const rows = await query.orderBy('p.name', 'asc').execute();
    const items = rows
      .map((row) => {
        const quantityOnHand = Number(row.stock_qty);
        const minStockQty = this.toMoney(row.min_stock_qty);
        const unitCost = Number(row.cost_price);
        const unitRetailPrice = this.toMoney(row.retail_price);
        const inventoryValue = this.toMoney(quantityOnHand * unitCost);
        const retailPotentialValue = this.toMoney(quantityOnHand * unitRetailPrice);
        const potentialGrossMargin = this.toMoney(retailPotentialValue - inventoryValue);

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
      totalInventoryValue: this.toMoney(totalsRow?.total_inventory_value),
      totalRetailPotentialValue: this.toMoney(totalsRow?.total_retail_value),
      totalPotentialGrossMargin: this.toMoney(Number(totalsRow?.total_retail_value || 0) - Number(totalsRow?.total_inventory_value || 0)),
      itemCount: Number(totalsRow?.item_count || 0),
      lowStockCount: Number(totalsRow?.low_stock_count || 0),
      zeroStockCount: Number(totalsRow?.zero_stock_count || 0),
      negativeStockCount: Number(totalsRow?.negative_stock_count || 0),
    };

    return { totals, items };
  }

  async previewOpeningBalances(query: OpeningBalancesPreviewQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    // Digits are the tenant's book digits, resolved on the caller's
    // handle with the P2 pattern (tenantBaseCurrency +
    // currencyMoneyDigits) and fail closed on a currency mismatch,
    // exactly like the posting boundary. The standalone preview and
    // the post path share one computation
    // (buildOpeningBalancesPreview); post re-runs it inside its
    // transaction on the transaction handle and posts the
    // recomputed lines through the boundary, so preview and post
    // can never disagree.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, String(auth.tenantId || '')));
    return this.buildOpeningBalancesPreview(query, auth, digits);
  }

  async postOpeningBalances(body: PostOpeningBalancesDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    const posting = this.accountingPosting;
    if (!posting) throw new Error('Accounting posting service is required for opening balances');
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const preview = await this.buildOpeningBalancesPreview(body, auth, digits);

    if (preview.alreadyPosted && preview.existingOpeningEntryId) {
      return {
        posted: false,
        alreadyPosted: true,
        journalEntryId: String(preview.existingOpeningEntryId),
        message: 'تم ترحيل الأرصدة الافتتاحية مسبقًا.',
        preview,
      };
    }

    if (preview.linesPreview.length < 2) {
      throw new BadRequestException('لا توجد أرصدة افتتاحية كافية لإنشاء قيد متوازن.');
    }

    const totalDebit = this.toBookMoney(preview.linesPreview.reduce((sum, line) => sum + line.debit, 0), digits);
    const totalCredit = this.toBookMoney(preview.linesPreview.reduce((sum, line) => sum + line.credit, 0), digits);
    if (totalDebit !== totalCredit) {
      throw new BadRequestException('قيد الأرصدة الافتتاحية غير متوازن.');
    }

    const note = String(body.note || '').trim();
    const postResult = await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      const entryDate = new Date(`${preview.systemStartDate}T00:00:00.000Z`);
      await this.assertNotInLockedPeriod(scope.tenantId, entryDate, { auth, queryable: trx });
      const existing = await trx
        .selectFrom('journal_entries')
        .select('id')
        .where('source_type', '=', 'opening_balance')
        .where('status', '=', 'posted')
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('id', 'desc')
        .executeTakeFirst();
      if (existing) return { id: Number(existing.id), posted: false, preview };

      // Recompute the opening balance on THIS transaction handle at
      // the book digits resolved on this handle. The preview above
      // was computed outside the transaction (different handle,
      // possibly different digits if settings changed); posting it
      // verbatim would bake in stale precision. The recomputation
      // is the single source of truth for the posted lines.
      const postDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const recomputed = await this.buildOpeningBalancesPreview(body, auth, postDigits, trx);
      if (recomputed.alreadyPosted && recomputed.existingOpeningEntryId) {
        return { id: Number(recomputed.existingOpeningEntryId), posted: false, preview: recomputed };
      }

      // Fail closed on ANY difference between the preview and the
      // live recomputation: exact equality at book digits, per line
      // and for the totals. A changed balance, a changed account,
      // or a digits change since the preview all fail here instead
      // of posting stale lines.
      const previewLinesMatch =
        preview.systemStartDate === recomputed.systemStartDate &&
        preview.totals.cashOpening === recomputed.totals.cashOpening &&
        preview.totals.bankOpening === recomputed.totals.bankOpening &&
        preview.totals.balancingCapital === recomputed.totals.balancingCapital &&
        preview.linesPreview.length === recomputed.linesPreview.length &&
        preview.linesPreview.every((line, index) => {
          const actual = recomputed.linesPreview[index];
          return actual && actual.accountId === line.accountId && actual.debit === line.debit && actual.credit === line.credit;
        });
      if (!previewLinesMatch) {
        throw new BadRequestException('تغيرت الأرصدة الافتتاحية بعد المعاينة؛ يجب تحديث المعاينة قبل الترحيل.');
      }

      const recomputedDebit = this.toBookMoney(recomputed.linesPreview.reduce((sum, line) => sum + line.debit, 0), postDigits);
      const recomputedCredit = this.toBookMoney(recomputed.linesPreview.reduce((sum, line) => sum + line.credit, 0), postDigits);
      if (recomputedDebit !== recomputedCredit) {
        throw new BadRequestException('قيد الأرصدة الافتتاحية غير متوازن.');
      }

      // Post through the canonical posting boundary: it re-rounds
      // every line at book digits, validates accounts and balance,
      // and assigns the entry number. The direct journal_entry_lines
      // insert this replaces bypassed all of it. sourceId 0 follows
      // the forex-revaluation precedent for a sourceless journal;
      // the stored source_id was already null and no lookup keys
      // on it (the once-per-tenant guard is on source_type +
      // status, enforced above and by unique index).
      const id = await posting.postDomainJournal(trx, {
        sourceType: 'opening_balance',
        sourceId: 0,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate,
        description: note ? `قيد الأرصدة الافتتاحية - ${note}` : 'قيد الأرصدة الافتتاحية',
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines: recomputed.linesPreview.map((line) => ({
          accountId: line.accountId,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          partnerType: 'none' as const,
          partnerId: null,
          branchId: null,
          locationId: null,
        })),
      });

      return { id, posted: true, preview: recomputed };
    });

    if (!postResult.posted) {
      return {
        posted: false,
        alreadyPosted: true,
        journalEntryId: String(postResult.id),
        message: 'تم ترحيل الأرصدة الافتتاحية مسبقًا.',
        preview: postResult.preview,
      };
    }

    return {
      posted: true,
      alreadyPosted: false,
      journalEntryId: String(postResult.id),
      message: 'تم ترحيل قيد الأرصدة الافتتاحية بنجاح.',
      preview: postResult.preview,
    };
  }

  async createDraftJournalEntry(input: DraftJournalEntryInput, auth: AuthContext): Promise<number> {
    this.assertAccountingAccess(auth);
    await this.accountingTenantFoundation.ensureForAuth(this.db, auth);
    const validation = await this.validateBalancedLines(input.lines, auth);
    if (!validation.ok) throw new ForbiddenException(validation.message);

    const scope = requireTenantScope(auth);
    const inserted = await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await this.assertNotInLockedPeriod(scope.tenantId, input.entryDate ?? new Date(), { auth, queryable: trx });
      await assertTaxPeriodOpen(trx, scope.tenantId, input.entryDate ?? new Date(), validation.lines.map((line) => line.accountId));
      await this.assertJournalReferences(trx, scope.tenantId, validation.lines.map((line) => ({
        ...line, branchId: line.branchId ?? input.branchId ?? null,
        locationId: line.locationId ?? input.locationId ?? null,
      })));
      const entry = await trx
        .insertInto('journal_entries')
        .values({
          entry_no: `JE-DRAFT-TMP-${scope.tenantId}-${Date.now()}-${Math.random()}`,
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          entry_date: input.entryDate ?? new Date(),
          description: String(input.description || '').trim(),
          source_type: String(input.sourceType || 'manual').trim() || 'manual',
          source_id: input.sourceId ?? null,
          status: 'draft',
          branch_id: input.branchId ?? null,
          location_id: input.locationId ?? null,
          created_by: auth.userId,
        } as any)
        .returning('id')
        .executeTakeFirstOrThrow();

      await trx.updateTable('journal_entries')
        .set({ entry_no: `JE-${String(entry.id).padStart(8, '0')}`, updated_at: sql`NOW()` } as any)
        .where('id', '=', Number(entry.id)).where('tenant_id', '=', scope.tenantId).execute();

      for (const line of validation.lines) {
        await trx.insertInto('journal_entry_lines').values({
          journal_entry_id: Number(entry.id),
          tenant_id: scope.tenantId,
          account_id: line.accountId,
          cost_center_id: line.costCenterId ?? null,
          description: line.description,
          debit: line.debit,
          credit: line.credit,
          partner_type: line.partnerType,
          partner_id: line.partnerId,
          branch_id: line.branchId,
          location_id: line.locationId,
        } as any).execute();
      }

      return Number(entry.id);
    });

    return inserted;
  }

  async validateBalancedLines(lines: DraftJournalLineInput[], auth?: AuthContext): Promise<{ ok: true; lines: Array<Required<DraftJournalLineInput>> } | { ok: false; message: string }> {
    if (!Array.isArray(lines) || lines.length < 2) {
      return { ok: false, message: 'Journal entry must include at least two lines.' };
    }

    const normalized: Array<Required<DraftJournalLineInput>> = lines.map((line) => {
      const debit = this.toMoney(line.debit);
      const credit = this.toMoney(line.credit);
      const partnerType = this.normalizePartnerType(line.partnerType);
      if (!partnerType) {
        throw new ForbiddenException('Partner type must be one of: none, customer, supplier.');
      }
      return {
        accountId: Number(line.accountId || 0),
        costCenterId: line.costCenterId ? Number(line.costCenterId) : null as any,
        description: String(line.description || '').trim(),
        debit,
        credit,
        partnerType,
        partnerId: line.partnerId ?? null,
        branchId: line.branchId ?? null,
        locationId: line.locationId ?? null,
      };
    });

    for (const line of normalized) {
      if (!(line.accountId > 0)) return { ok: false, message: 'Every line must reference an account.' };
      if (line.debit < 0 || line.credit < 0) return { ok: false, message: 'Debit and credit must be non-negative.' };
      if (line.debit > 0 && line.credit > 0) return { ok: false, message: 'A line cannot have both debit and credit.' };
      if (!(line.debit > 0 || line.credit > 0)) return { ok: false, message: 'Each line must have debit or credit amount.' };
    }

    let accountsQuery = this.db.selectFrom('accounting_accounts').select(['id', 'is_active']).where('id', 'in', normalized.map((line) => line.accountId));
    if (auth) {
      const scope = requireTenantScope(auth);
      accountsQuery = accountsQuery.where('tenant_id', '=', scope.tenantId);
    }
    const accounts = await accountsQuery.execute();

    const activeMap = new Map(accounts.map((row) => [Number(row.id), Boolean(row.is_active)]));
    for (const line of normalized) {
      if (!activeMap.has(line.accountId)) return { ok: false, message: 'One or more accounts do not exist.' };
      if (!activeMap.get(line.accountId)) return { ok: false, message: 'Inactive accounts are not allowed in journal lines.' };
    }

    const totalDebit = this.toMoney(normalized.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = this.toMoney(normalized.reduce((sum, line) => sum + line.credit, 0));
    const difference = this.toMoney(totalDebit - totalCredit);
    if (Math.abs(difference) > 0.05) {
      return { ok: false, message: 'Total debit must equal total credit.' };
    }

    if (Math.abs(difference) >= 0.001) {
      if (!auth) return { ok: false, message: 'Tenant scope is required to resolve the rounding account.' };
      const scope = requireTenantScope(auth);
      const roundingAccount = await this.db.selectFrom('accounting_accounts').select(['id', 'is_active'])
        .where('tenant_id', '=', scope.tenantId).where('code', '=', '7290').executeTakeFirst();
      if (!roundingAccount?.is_active) return { ok: false, message: 'Rounding difference account 7290 is missing or inactive.' };
      normalized.push({
        accountId: Number(roundingAccount.id), costCenterId: null as any,
        description: 'Rounding difference', debit: difference < 0 ? Math.abs(difference) : 0,
        credit: difference > 0 ? difference : 0, partnerType: 'none', partnerId: null,
        branchId: null, locationId: null,
      });
    }

    return { ok: true, lines: normalized };
  }

  async generateNextAccountCode(parentId: number, auth: AuthContext): Promise<{ code: string }> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    
    const parent = await this.db.selectFrom('accounting_accounts')
      .select(['code'])
      .where('id', '=', parentId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
      
    if (!parent) throw new NotFoundException('Parent account not found');
    
    const children = await this.db.selectFrom('accounting_accounts')
      .select(['code'])
      .where('parent_id', '=', parentId)
      .where('tenant_id', '=', scope.tenantId)
      .execute();
      
    if (children.length === 0) {
      const num = parseInt(parent.code, 10);
      if (!isNaN(num)) {
        return { code: String(num + 1) };
      }
      return { code: parent.code + '01' };
    }
    
    let maxNum = -1;
    let maxCode = '';
    for (const child of children) {
      const num = parseInt(child.code, 10);
      if (!isNaN(num) && num > maxNum) {
        maxNum = num;
        maxCode = child.code;
      }
    }
    
    if (maxNum !== -1) {
      return { code: String(maxNum + 1) };
    }
    
    return { code: parent.code + '01' };
  }

  async createAccount(dto: CreateAccountDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await assertHierarchyParent(trx, 'accounting_accounts', scope.tenantId, null, dto.parentId == null ? null : Number(dto.parentId));

      const existing = await trx.selectFrom('accounting_accounts')
        .select('id')
        .where('code', '=', dto.code)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (existing) throw new BadRequestException('Account code already exists');

      let parentId = dto.parentId || null;
      let normalBalance = dto.normalBalance;

      if (parentId) {
        const parent = await trx.selectFrom('accounting_accounts')
          .select(['id', 'normal_balance'])
          .where('id', '=', parentId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        if (!parent) throw new BadRequestException('Parent account not found');
        normalBalance = parent.normal_balance;
      }

      const result = await trx.insertInto('accounting_accounts')
        .values({
          tenant_id: scope.tenantId,
          code: dto.code,
          name_ar: dto.nameAr,
          name_en: dto.nameEn || '',
          account_type: dto.accountType as any,
          account_group: '',
          parent_id: parentId,
          normal_balance: normalBalance as any,
          is_active: dto.isActive ?? true,
          is_system: false,
          allow_manual_entries: true,
          is_control_account: false,
          is_cash_bank: false,
          is_receivable: false,
          is_payable: false,
          is_inventory: false,
          is_tax: false,
          description_ar: '',
          sort_order: 0,
        })
        .returningAll()
        .executeTakeFirstOrThrow();

      return { ok: true, accountId: String(result.id) };
    });
  }

  async updateAccount(id: number, dto: UpdateAccountDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    return this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      await assertHierarchyParent(trx, 'accounting_accounts', scope.tenantId, id, dto.parentId == null ? null : Number(dto.parentId));

      const existing = await trx.selectFrom('accounting_accounts')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();

      if (!existing) throw new NotFoundException('Account not found');

      if (dto.code && dto.code !== existing.code) {
        const codeCheck = await trx.selectFrom('accounting_accounts')
          .select('id')
          .where('code', '=', dto.code)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        if (codeCheck) throw new BadRequestException('Account code already exists');
      }

      const hasTransactions = await trx.selectFrom('journal_entry_lines')
        .select('id')
        .where('account_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .limit(1)
        .executeTakeFirst();

      let updateData: any = {};

      if (existing.is_system) {
        if (dto.nameAr) updateData.name_ar = dto.nameAr;
        if (dto.nameEn !== undefined) updateData.name_en = dto.nameEn;
      } else {
        if (dto.nameAr) updateData.name_ar = dto.nameAr;
        if (dto.nameEn !== undefined) updateData.name_en = dto.nameEn;
        if (dto.isActive !== undefined) updateData.is_active = dto.isActive;

        if (hasTransactions) {
          if (dto.code) updateData.code = dto.code;
        } else {
          if (dto.code) updateData.code = dto.code;
          if (dto.accountType) updateData.account_type = dto.accountType;
          if (dto.normalBalance) updateData.normal_balance = dto.normalBalance;
          if (dto.parentId !== undefined) {
            updateData.parent_id = dto.parentId;
            if (dto.parentId) {
               const parent = await trx.selectFrom('accounting_accounts').select('normal_balance').where('id', '=', dto.parentId).where('tenant_id', '=', scope.tenantId).executeTakeFirst();
               if (parent) updateData.normal_balance = parent.normal_balance;
            }
          }
        }
      }

      // IAS 21 monetary/revaluation-currency metadata (O1): safe to change regardless of
      // is_system or transaction history — it never touches identity or posted balances,
      // only which accounts forex-revaluation.previewRevaluation() picks up.
      if (dto.isMonetary !== undefined) {
        if (dto.isMonetary && !['asset', 'liability'].includes(existing.account_type)) {
          throw new BadRequestException('إعادة تقييم العملة متاحة للحسابات النقدية من نوع أصل أو التزام فقط.');
        }
        updateData.is_monetary = dto.isMonetary;
        if (!dto.isMonetary) {
          // A non-monetary account can never legitimately carry a revaluation currency.
          updateData.revaluation_currency = null;
        }
      }
      if (dto.revaluationCurrency !== undefined) {
        const cleanCurrency = String(dto.revaluationCurrency || '').trim().toUpperCase() || null;
        const willBeMonetary = dto.isMonetary !== undefined ? dto.isMonetary : Boolean(existing.is_monetary);
        if (cleanCurrency && !willBeMonetary) {
          throw new BadRequestException('لا يمكن تحديد عملة إعادة التقييم لحساب غير نقدي (is_monetary = false)');
        }
        if (cleanCurrency && !/^[A-Z]{3}$/.test(cleanCurrency)) {
          throw new BadRequestException('رمز عملة إعادة التقييم يجب أن يتكون من ثلاثة أحرف.');
        }
        updateData.revaluation_currency = cleanCurrency;
      }

      if (Object.keys(updateData).length > 0) {
        await trx.updateTable('accounting_accounts')
          .set({ ...updateData, updated_at: sql`NOW()` })
          .where('id', '=', id)
          .where('tenant_id', '=', scope.tenantId)
          .execute();
      }

      return { ok: true };
    });
  }

  async deleteAccount(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const scope = requireTenantScope(auth);
    
    const existing = await this.db.selectFrom('accounting_accounts')
      .select(['is_system'])
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
      
    if (!existing) throw new NotFoundException('Account not found');
    
    if (existing.is_system) {
      throw new BadRequestException('لا يمكن حذف الحسابات النظامية الأساسية.');
    }
    
    const hasTransactions = await this.db.selectFrom('journal_entry_lines')
      .select('id')
      .where('account_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .limit(1)
      .executeTakeFirst();
      
    if (hasTransactions) {
      throw new BadRequestException('لا يمكن حذف حساب تمت عليه قيود محاسبية، يمكنك إيقافه بدلاً من ذلك.');
    }
    
    const hasChildren = await this.db.selectFrom('accounting_accounts')
      .select('id')
      .where('parent_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .limit(1)
      .executeTakeFirst();
      
    if (hasChildren) {
      throw new BadRequestException('لا يمكن حذف حساب يحتوي على حسابات فرعية.');
    }
    
    await this.db.deleteFrom('accounting_accounts')
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();
      
    return { ok: true };
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

      const newAccumulated = this.toMoney(currentAccumulated + depreciationAmount);
      const newBookValue = this.toMoney(Math.max(0, cost - newAccumulated));
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
      finalEntryNo = `JE-${String(journalEntryId).padStart(8, '0')}`;

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
        totalDepreciation = this.toMoney(totalDepreciation + Number(res.depreciationAmount || 0));
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
    body: { amount: number; fromCurrency: string; toCurrency: string },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    await tenantBaseCurrency(this.db, scope.tenantId);
    const fromCode = String(body.fromCurrency || '').trim().toUpperCase();
    const toCode = String(body.toCurrency || '').trim().toUpperCase();
    const amount = Number(body.amount || 0);

    if (!Number.isFinite(amount) || !/^[A-Z]{3}$/.test(fromCode) || !/^[A-Z]{3}$/.test(toCode)) throw new BadRequestException('مبلغ أو رمز عملة غير صالح.');

    const rates = await this.db
      .selectFrom('currency_exchange_rates')
      .select(['currency_code', 'exchange_rate', 'is_base'])
      .where('tenant_id', '=', scope.tenantId)
      .where('currency_code', 'in', [fromCode, toCode])
      .execute();

    const fromRow = rates.find((r) => r.currency_code === fromCode);
    const toRow = rates.find((r) => r.currency_code === toCode);

    if (!fromRow || !toRow) throw new BadRequestException('العملة غير مسجلة؛ لا يجوز افتراض سعر صرف.');
    const fromRate = Number(fromRow.exchange_rate);
    const toRate = Number(toRow.exchange_rate);
    if (![fromRate, toRate].every(rate => Number.isFinite(rate) && rate > 0)) throw new BadRequestException('سعر صرف مسجل غير صالح.');

    const amountInBase = fromRow?.is_base ? amount : amount * fromRate;
    const convertedAmount = toRow?.is_base ? amountInBase : amountInBase / toRate;

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
      const feeAmount = this.toMoney(Math.abs(signedAmount));
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
