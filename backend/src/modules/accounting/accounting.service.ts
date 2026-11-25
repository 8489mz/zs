import { roundMoney, type MoneyDigits } from './engines/money-minor-units.engine';

import { BadRequestException, ForbiddenException, Inject, Injectable, Optional } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import {
  CreateAccountDto,
  UpdateAccountDto,
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
  ReconcileMatchDto,
  CreateBankFeeAdjustmentDto,
} from './dto/accounting.dto';
import { AccountingTenantFoundationService } from './accounting-tenant-foundation.service';
import { AccountingPostingService } from './accounting-posting.service';
import { resolveBusinessDateKey } from './engines/accounting-date.engine';
import type {
  DraftJournalEntryInput,
  DraftJournalLineInput,
  OpeningBalanceAccount,
  OpeningBalanceLine,
  PartnerType,
} from './accounting-types';
export { bankStatementAmountsEqual } from './accounting-types';
import { AccountingJournalsReadService } from './services/accounting-journals-read.service';
import { AccountingJournalsWriteService } from './services/accounting-journals-write.service';
import { AccountingAccountsService } from './services/accounting-accounts.service';
import { AccountingOpeningBalancesService } from './services/accounting-opening-balances.service';
import { AccountingSettingsService } from './services/accounting-settings.service';
import { AccountingReportsService } from './services/accounting-reports.service';
import { AccountingFixedAssetsService } from './services/accounting-fixed-assets.service';
import { AccountingCurrenciesService } from './services/accounting-currencies.service';
import { AccountingCostCentersService } from './services/accounting-cost-centers.service';
import { AccountingBankStatementsService } from './services/accounting-bank-statements.service';

@Injectable()
export class AccountingService {
  private readonly journalsReadService: AccountingJournalsReadService;
  private readonly journalsWriteService: AccountingJournalsWriteService;
  private readonly accountsService: AccountingAccountsService;
  private readonly openingBalancesService: AccountingOpeningBalancesService;
  private readonly settingsService: AccountingSettingsService;
  private readonly reportsService: AccountingReportsService;
  private readonly fixedAssetsService: AccountingFixedAssetsService;
  private readonly currenciesService: AccountingCurrenciesService;
  private readonly costCentersService: AccountingCostCentersService;
  private readonly bankStatementsService: AccountingBankStatementsService;

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
    this.currenciesService = new AccountingCurrenciesService({
      db: this.db,
    });
    this.costCentersService = new AccountingCostCentersService({
      db: this.db,
      assertAccountingAccess: this.assertAccountingAccess.bind(this),
    });
    this.bankStatementsService = new AccountingBankStatementsService({
      db: this.db,
      assertAccountingAccess: this.assertAccountingAccess.bind(this),
      tenantPredicate: this.tenantPredicate.bind(this),
      toMoney: this.toMoney.bind(this),
      createManualJournalEntry: this.journalsWriteService.createManualJournalEntry.bind(this.journalsWriteService),
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
    queryable: Kysely<Database>,
    tenantId: string,
    lines: Array<{
      costCenterId?: number | null;
      branchId?: number | null;
      locationId?: number | null;
      partnerType?: string;
      partnerId?: number | null;
    }>,
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

  private async normalizeDateInput(
    value: string | null | undefined,
    db: Kysely<Database>,
    tenantId: string,
  ): Promise<string> {
    const dateText = String(value || '').slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return dateText;
    // No usable start date: default to the tenant-local business day, never the UTC day.
    return resolveBusinessDateKey(db, tenantId, new Date());
  }

  private openingAmount(value: unknown, digits: MoneyDigits): number {
    return this.toBookMoney(Math.max(0, Number(value || 0)), digits);
  }

  private async getExistingOpeningBalanceEntry(
    auth: AuthContext,
    db: Kysely<Database> = this.db,
  ): Promise<{ id: number } | null> {
    return this.openingBalancesService.getExistingOpeningBalanceEntry(auth, db);
  }

  private async resolveOpeningAccount(
    auth: AuthContext,
    code: string,
    expectedTypes: string[],
    db: Kysely<Database> = this.db,
  ): Promise<OpeningBalanceAccount> {
    return this.openingBalancesService.resolveOpeningAccount(auth, code, expectedTypes, db);
  }

  private addOpeningLine(
    lines: OpeningBalanceLine[],
    account: OpeningBalanceAccount,
    description: string,
    debit: number,
    credit: number,
    digits: MoneyDigits,
  ): void {
    return this.openingBalancesService.addOpeningLine(lines, account, description, debit, credit, digits);
  }

  private async calculateOpeningOperationalTotals(
    auth: AuthContext,
    digits: MoneyDigits,
    db: Kysely<Database> = this.db,
  ): Promise<{
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

  async createManualJournalEntry(
    dto: CreateManualJournalEntryDto,
    auth: AuthContext,
    externalTrx?: Kysely<Database>,
  ): Promise<Record<string, unknown>> {
    return this.journalsWriteService.createManualJournalEntry(dto, auth, externalTrx);
  }

  async reverseJournalEntry(
    entryId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ ok: boolean; message: string; reversalEntryId: number; reversalEntryNo: string }> {
    return this.journalsWriteService.reverseJournalEntry(entryId, reason, auth);
  }

  async getFinancialSummary(filters: FinancialSummaryQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.getFinancialSummary(filters, auth);
  }

  async getReceivablesPayables(
    filters: ReceivablesPayablesQueryDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.reportsService.getReceivablesPayables(filters, auth);
  }

  async getCashMovement(filters: CashMovementQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.getCashMovement(filters, auth);
  }

  async getInventoryValue(filters: InventoryValueQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.reportsService.getInventoryValue(filters, auth);
  }

  async previewOpeningBalances(
    query: OpeningBalancesPreviewQueryDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.openingBalancesService.previewOpeningBalances(query, auth);
  }

  async postOpeningBalances(body: PostOpeningBalancesDto, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.openingBalancesService.postOpeningBalances(body, auth);
  }

  async createDraftJournalEntry(input: DraftJournalEntryInput, auth: AuthContext): Promise<number> {
    return this.journalsWriteService.createDraftJournalEntry(input, auth);
  }

  async validateBalancedLines(
    lines: DraftJournalLineInput[],
    auth?: AuthContext,
  ): Promise<{ ok: true; lines: Array<Required<DraftJournalLineInput>> } | { ok: false; message: string }> {
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

  async createFixedAsset(
    body: {
      code: string;
      name: string;
      category?: string;
      purchaseCost: number;
      salvageValue?: number;
      usefulLifeMonths?: number;
      depreciationMethod?: 'straight_line' | 'declining_balance';
      purchaseDate?: string;
    },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.fixedAssetsService.createFixedAsset(body, actor);
  }

  async depreciateFixedAsset(
    id: number,
    body: { months?: number; note?: string },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.fixedAssetsService.depreciateFixedAsset(id, body, actor);
  }

  async depreciateAllFixedAssets(
    body: { months?: number; note?: string },
    actor: AuthContext,
  ): Promise<Record<string, unknown>> {
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
    return this.currenciesService.listCurrencies(auth);
  }

  async upsertCurrency(
    body: { currencyCode: string; currencyName: string; exchangeRate: number; isBase?: boolean; symbol?: string },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.currenciesService.upsertCurrency(body, auth);
  }

  async convertCurrency(
    body: { amount: number; fromCurrency: string; toCurrency: string; asOf?: string },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    return this.currenciesService.convertCurrency(body, auth);
  }

  async listCostCenters(auth: AuthContext): Promise<{ ok: boolean; costCenters: Record<string, unknown>[] }> {
    return this.costCentersService.listCostCenters(auth);
  }

  async createCostCenter(
    body: {
      code: string;
      name: string;
      dimension?: string;
      budgetAmount?: number;
      parentId?: number | null;
      description?: string;
      isActive?: boolean;
    },
    auth: AuthContext,
  ) {
    return this.costCentersService.createCostCenter(body, auth);
  }

  async updateCostCenter(
    id: number,
    body: {
      code?: string;
      name?: string;
      dimension?: string;
      budgetAmount?: number;
      parentId?: number | null;
      description?: string;
      isActive?: boolean;
    },
    auth: AuthContext,
  ) {
    return this.costCentersService.updateCostCenter(id, body, auth);
  }

  async deleteCostCenter(id: number, auth: AuthContext) {
    return this.costCentersService.deleteCostCenter(id, auth);
  }

  async getCostCenterReport(costCenterId: number, auth: AuthContext, filters?: { fromDate?: string; toDate?: string }) {
    return this.reportsService.getCostCenterReport(costCenterId, auth, filters);
  }

  // ==================== BANK RECONCILIATION ENGINE ====================
  async listBankStatements(auth: AuthContext, accountId?: number): Promise<any[]> {
    return this.bankStatementsService.listBankStatements(auth, accountId);
  }

  async getBankStatement(id: number, auth: AuthContext): Promise<any> {
    return this.bankStatementsService.getBankStatement(id, auth);
  }

  async createBankStatement(dto: CreateBankStatementDto, auth: AuthContext): Promise<any> {
    return this.bankStatementsService.createBankStatement(dto, auth);
  }

  async getBankReconciliationWorkspace(statementId: number, auth: AuthContext): Promise<any> {
    return this.bankStatementsService.getBankReconciliationWorkspace(statementId, auth);
  }

  async reconcileMatch(dto: ReconcileMatchDto, auth: AuthContext): Promise<any> {
    return this.bankStatementsService.reconcileMatch(dto, auth);
  }

  async unreconcileMatch(statementLineId: number, auth: AuthContext): Promise<any> {
    return this.bankStatementsService.unreconcileMatch(statementLineId, auth);
  }

  async createBankFeeAdjustment(dto: CreateBankFeeAdjustmentDto, auth: AuthContext): Promise<any> {
    return this.bankStatementsService.createBankFeeAdjustment(dto, auth);
  }
}
