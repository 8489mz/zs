import { tenantBaseCurrency } from './accounting-currency';
import { resolveFxRate } from './fx-rate-resolution';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from './engines/money-minor-units.engine';

import { assertHierarchyParent } from './accounting-boundaries';
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
import type { PartnerType } from './accounting-types';
import { AccountingJournalsReadService } from './services/accounting-journals-read.service';
import { AccountingJournalsWriteService } from './services/accounting-journals-write.service';
import { AccountingAccountsService } from './services/accounting-accounts.service';
import { AccountingOpeningBalancesService } from './services/accounting-opening-balances.service';
import { AccountingSettingsService } from './services/accounting-settings.service';
import { AccountingReportsService } from './services/accounting-reports.service';
import { AccountingFixedAssetsService } from './services/accounting-fixed-assets.service';

@Injectable()
export class AccountingService {
  private readonly journalsReadService: AccountingJournalsReadService;
  private readonly journalsWriteService: AccountingJournalsWriteService;
  private readonly accountsService: AccountingAccountsService;
  private readonly openingBalancesService: AccountingOpeningBalancesService;
  private readonly settingsService: AccountingSettingsService;
  private readonly reportsService: AccountingReportsService;
  private readonly fixedAssetsService: AccountingFixedAssetsService;

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
    this.settingsService = new AccountingSettingsService({
      db: this.db,
      accountingTenantFoundation: this.accountingTenantFoundation,
      assertAccountingAccess: this.assertAccountingAccess.bind(this),
    });
    this.reportsService = new AccountingReportsService({
      db: this.db,
      assertAccountingAccess: this.assertAccountingAccess.bind(this),
      inCodes: this.inCodes.bind(this),
      mapPeriod: this.mapPeriod.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
      toMoney: this.toMoney.bind(this),
    });
    this.fixedAssetsService = new AccountingFixedAssetsService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      toMoney: this.toMoney.bind(this),
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
    return this.settingsService.getAccountingSettings(auth);
  }

  async updateAccountingSettings(dto: UpdateAccountingSettingsDto, auth: AuthContext): Promise<{ success: boolean }> {
    return this.settingsService.updateAccountingSettings(dto, auth);
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
    return this.reportsService.getFinancialSummary(filters, auth);
  }

  async getReceivablesPayables(filters: ReceivablesPayablesQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.getReceivablesPayables(filters, auth);
  }

  async getCashMovement(filters: CashMovementQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.getCashMovement(filters, auth);
  }

  async getInventoryValue(filters: InventoryValueQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.getInventoryValue(filters, auth);
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
    return this.fixedAssetsService.listProjects(actor);
  }

  async listFixedAssets(actor: AuthContext): Promise<Record<string, unknown>> {
    return this.fixedAssetsService.listFixedAssets(actor);
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
    return this.fixedAssetsService.createFixedAsset(body, actor);
  }

  async depreciateFixedAsset(id: number, body: { months?: number; note?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.fixedAssetsService.depreciateFixedAsset(id, body, actor);
  }

  async depreciateAllFixedAssets(body: { months?: number; note?: string }, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.fixedAssetsService.depreciateAllFixedAssets(body, actor);
  }

  async listAssetDepreciationLogs(assetId?: number, actor?: AuthContext): Promise<Record<string, unknown>> {
    return this.fixedAssetsService.listAssetDepreciationLogs(assetId, actor);
  }

  async deleteFixedAsset(id: number, actor: AuthContext): Promise<Record<string, unknown>> {
    return this.fixedAssetsService.deleteFixedAsset(id, actor);
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
    return this.reportsService.getCostCenterReport(costCenterId, auth, filters);
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
