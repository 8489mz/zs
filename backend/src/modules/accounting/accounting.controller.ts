import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { RequireAnyPermission, RequirePermissions } from '../../core/auth/decorators/permissions.decorator';
import { RequireFeature } from '../../core/auth/decorators/feature.decorator';
import { AccountingAccessGuard } from '../../core/auth/guards/accounting-access.guard';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { AccountingService } from './accounting.service';
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
  GenerateCodeQueryDto,
  UpdateAccountingSettingsDto,
  CreateManualJournalEntryDto,
  CreateBankStatementDto,
  ReconcileMatchDto,
  CreateBankFeeAdjustmentDto,
  ApplySaleEditRemediationDto,
} from './dto/accounting.dto';

import { BalanceSheetService } from './services/balance-sheet.service';
import { TrialBalanceService } from './services/trial-balance.service';
import { CashFlowService } from './services/cash-flow.service';
import { AgedDebtsService } from './services/aged-debts.service';
import { PdcChequesService, CreatePdcChequeDto, UpdateChequeStatusDto } from './services/pdc-cheques.service';
import { WithholdingTaxService, CreateWhtTransactionDto, ExtractFromPurchasesDto } from './services/withholding-tax.service';
import { PaymentAllocationService, AllocatePaymentDto } from './services/payment-allocation.service';
import {
  FiscalYearService,
  CreateFiscalYearDto,
  CloseFiscalYearDto,
  ReopenFiscalYearDto,
} from './services/fiscal-year.service';
import { CloseFiscalPeriodDto, ReopenFiscalPeriodDto } from './dto/fiscal-period.dto';
import { FixedAssetsSchedulerService } from './services/fixed-assets-scheduler.service';
import { CostCenterAllocationsService } from './services/cost-center-allocations.service';
import { ForexRevaluationService, ExecuteForexRevaluationDto } from './services/forex-revaluation.service';
import { SaleEditRemediationService } from './services/sale-edit-remediation.service';

@Controller('api/accounting')
// `AccountingAccessGuard` هو البوابة الحقيقية: `accounts` وحدها كانت تكفي، وهي في قالب كل
// كاشير، فقرأ حسابُ كاشير الميزانية العمومية والتدفقات النقدية على الإنتاج (25 سبتمبر 2026)
// لأن خدمتيهما لا تفحصان شيئاً. الحارس يطبّق نفس قاعدة `assertAccountingAccess` على المسارات
// الاثنين والثمانين دفعة واحدة، بدل تعليق الحماية على تذكّر كاتب كل خدمة جديدة.
@UseGuards(SessionAuthGuard, PermissionsGuard, AccountingAccessGuard)
@RequireFeature('accounting')
@RequireAnyPermission('accounting', 'accounts')
export class AccountingController {
  constructor(
    private readonly accountingService: AccountingService,
    private readonly balanceSheetService: BalanceSheetService,
    private readonly trialBalanceService: TrialBalanceService,
    private readonly cashFlowService: CashFlowService,
    private readonly agedDebtsService: AgedDebtsService,
    private readonly pdcChequesService: PdcChequesService,
    private readonly withholdingTaxService: WithholdingTaxService,
    private readonly paymentAllocationService: PaymentAllocationService,
    private readonly fiscalYearService: FiscalYearService,
    private readonly fixedAssetsScheduler: FixedAssetsSchedulerService,
    private readonly costCenterAllocations: CostCenterAllocationsService,
    private readonly forexRevaluation: ForexRevaluationService,
    private readonly saleEditRemediation: SaleEditRemediationService,
  ) {}

  // Sale-edit remediation (Rank 7d): discovery is a read-only dry run;
  // apply posts reversal journals and requires a reviewed sale list
  // plus an explicit confirmation. No scheduled or automatic apply.
  @Get('sale-edit-remediation/discovery')
  discoverSaleEditRemediation(@Req() req: RequestWithAuth) {
    return this.saleEditRemediation.discover(req.authContext!);
  }

  @Post('sale-edit-remediation/apply')
  applySaleEditRemediation(@Body() dto: ApplySaleEditRemediationDto, @Req() req: RequestWithAuth) {
    return this.saleEditRemediation.apply(req.authContext!, dto);
  }

  @Get('accounts')
  listAccounts(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.listAccounts(req.authContext!);
  }

  @Post('accounts')
  createAccount(@Body() dto: CreateAccountDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.createAccount(dto, req.authContext!);
  }

  @Put('accounts/:id')
  updateAccount(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateAccountDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.updateAccount(id, dto, req.authContext!);
  }

  @Delete('accounts/:id')
  deleteAccount(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.deleteAccount(id, req.authContext!);
  }

  @Get('accounts/generate-code')
  generateNextAccountCode(@Query() query: GenerateCodeQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.generateNextAccountCode(query.parentId, req.authContext!);
  }

  @Get('settings')
  getSettings(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.getAccountingSettings(req.authContext!);
  }

  @Put('settings')
  updateSettings(@Body() dto: UpdateAccountingSettingsDto, @Req() req: RequestWithAuth): Promise<{ success: boolean }> {
    return this.accountingService.updateAccountingSettings(dto, req.authContext!);
  }

  @Get('journal-entries')
  listJournalEntries(@Query() query: JournalEntriesQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.listJournalEntries(query, req.authContext!);
  }

  @Post('journal-entries')
  createJournalEntry(@Body() dto: CreateManualJournalEntryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.createManualJournalEntry(dto, req.authContext!);
  }

  @Get('journal-entries/:id')
  getJournalEntry(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.getJournalEntry(id, req.authContext!);
  }

  @Post('journal-entries/:id/reverse')
  reverseJournalEntry(
    @Param('id', ParseIntPipe) id: number,
    @Body('reason') reason: string,
    @Req() req: RequestWithAuth
  ): Promise<Record<string, unknown>> {
    return this.accountingService.reverseJournalEntry(id, reason, req.authContext!);
  }

  @Get('reports/financial-summary')
  getFinancialSummary(@Query() query: FinancialSummaryQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.getFinancialSummary(query, req.authContext!);
  }

  @Get('reports/receivables-payables')
  getReceivablesPayables(@Query() query: ReceivablesPayablesQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.getReceivablesPayables(query, req.authContext!);
  }

  @Get('reports/cash-movement')
  getCashMovement(@Query() query: CashMovementQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.getCashMovement(query, req.authContext!);
  }

  @Get('reports/inventory-value')
  getInventoryValue(@Query() query: InventoryValueQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.getInventoryValue(query, req.authContext!);
  }

  // --- Big Financial Statements (IFRS / Odoo 17 Standards) ---
  @Get('reports/balance-sheet')
  getBalanceSheet(
    @Query('asOfDate') asOfDate: string,
    @Query('compareDate') compareDate: string,
    @Query('branchId') branchId: string,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.balanceSheetService.getBalanceSheet(req.authContext!, {
      asOfDate: asOfDate || undefined,
      compareDate: compareDate || undefined,
      branchId: branchId ? Number(branchId) : undefined,
    });
  }

  // Trial balance (INV-TRIAL-BALANCE-PAGE): the dedicated debit/credit
  // balance page. Same AccountingAccessGuard as the balance sheet above.
  @Get('reports/trial-balance')
  getTrialBalance(
    @Query('asOfDate') asOfDate: string,
    @Query('branchId') branchId: string,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.trialBalanceService.getTrialBalance(req.authContext!, {
      asOfDate: asOfDate || undefined,
      branchId: branchId ? Number(branchId) : undefined,
    });
  }

  @Get('reports/cash-flow')
  getCashFlow(
    @Query('dateFrom') dateFrom: string,
    @Query('dateTo') dateTo: string,
    @Query('branchId') branchId: string,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.cashFlowService.getCashFlowStatement(req.authContext!, {
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      branchId: branchId ? Number(branchId) : undefined,
    });
  }

  @Get('reports/aged-receivables')
  getAgedReceivables(
    @Query('asOfDate') asOfDate: string,
    @Query('branchId') branchId: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('search') search: string,
    @Query('risk') risk: string,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.agedDebtsService.getAgedReceivables(req.authContext!, {
      asOfDate: asOfDate || undefined,
      branchId: branchId ? Number(branchId) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search: search || undefined,
      risk: risk || undefined,
    });
  }

  @Get('reports/aged-payables')
  getAgedPayables(
    @Query('asOfDate') asOfDate: string,
    @Query('branchId') branchId: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Query('search') search: string,
    @Query('risk') risk: string,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.agedDebtsService.getAgedPayables(req.authContext!, {
      asOfDate: asOfDate || undefined,
      branchId: branchId ? Number(branchId) : undefined,
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      search: search || undefined,
      risk: risk || undefined,
    });
  }

  @Get('opening-balances/preview')
  previewOpeningBalances(@Query() query: OpeningBalancesPreviewQueryDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.previewOpeningBalances(query, req.authContext!);
  }

  @Post('opening-balances/post')
  postOpeningBalances(@Body() body: PostOpeningBalancesDto, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.postOpeningBalances(body, req.authContext!);
  }

  @Get('cost-centers')
  listCostCenters(@Req() req: RequestWithAuth): Promise<{ ok: boolean; costCenters: Record<string, unknown>[] }> {
    return this.accountingService.listCostCenters(req.authContext!);
  }

  @Post('cost-centers')
  createCostCenter(
    @Body() body: { code: string; name: string; dimension?: string; budgetAmount?: number; parentId?: number | null; description?: string; isActive?: boolean },
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.accountingService.createCostCenter(body, req.authContext!);
  }

  @Put('cost-centers/:id')
  updateCostCenter(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { code?: string; name?: string; dimension?: string; budgetAmount?: number; parentId?: number | null; description?: string; isActive?: boolean },
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.accountingService.updateCostCenter(id, body, req.authContext!);
  }

  @Delete('cost-centers/:id')
  deleteCostCenter(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.deleteCostCenter(id, req.authContext!);
  }

  @Get('cost-centers/:id/report')
  getCostCenterReport(
    @Param('id', ParseIntPipe) id: number,
    @Query('fromDate') fromDate: string,
    @Query('toDate') toDate: string,
    @Req() req: RequestWithAuth,
  ): Promise<Record<string, unknown>> {
    return this.accountingService.getCostCenterReport(id, req.authContext!, { fromDate, toDate });
  }

  // --- Cost Center Allocation Matrices (مصفوفة توزيع مراكز التكلفة بالنسب المئوية) ---
  @Get('cost-centers/allocations')
  listCostCenterAllocations(@Req() req: RequestWithAuth): Promise<any[]> {
    return this.costCenterAllocations.listAllocations(req.authContext!);
  }

  @Post('cost-centers/allocations')
  createCostCenterAllocation(@Body() body: any, @Req() req: RequestWithAuth): Promise<any> {
    return this.costCenterAllocations.createAllocation(body, req.authContext!);
  }

  @Put('cost-centers/allocations/:id')
  updateCostCenterAllocation(@Param('id') id: string, @Body() body: any, @Req() req: RequestWithAuth): Promise<any> {
    return this.costCenterAllocations.updateAllocation(id, body, req.authContext!);
  }

  @Delete('cost-centers/allocations/:id')
  deleteCostCenterAllocation(@Param('id') id: string, @Req() req: RequestWithAuth): Promise<any> {
    return this.costCenterAllocations.deleteAllocation(id, req.authContext!);
  }

  @Post('cost-centers/allocations/:id/calculate')
  calculateCostCenterSplit(@Param('id') id: string, @Body() body: { amount: number }, @Req() req: RequestWithAuth): Promise<any> {
    return this.costCenterAllocations.calculateSplitAmounts(id, Number(body.amount || 0), req.authContext!);
  }

  @Get('projects')
  listProjects(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.listProjects(req.authContext!);
  }

  // --- Fixed Assets & Depreciation (الأصول الثابتة والإهلاك) ---
  @Get('fixed-assets')
  listFixedAssets(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.listFixedAssets(req.authContext!);
  }

  @Post('fixed-assets')
  createFixedAsset(@Body() body: any, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.createFixedAsset(body, req.authContext!);
  }

  @Delete('fixed-assets/:id')
  deleteFixedAsset(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.deleteFixedAsset(id, req.authContext!);
  }

  @Post('fixed-assets/depreciate-all')
  depreciateAllFixedAssets(@Body() body: { months?: number; note?: string }, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.depreciateAllFixedAssets(body, req.authContext!);
  }

  @Post('fixed-assets/:id/depreciate')
  depreciateFixedAsset(@Param('id', ParseIntPipe) id: number, @Body() body: { months?: number; note?: string }, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.depreciateFixedAsset(id, body, req.authContext!);
  }

  @Get('fixed-assets/logs')
  listAllAssetDepreciationLogs(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.listAssetDepreciationLogs(undefined, req.authContext!);
  }

  @Get('fixed-assets/:id/logs')
  listAssetDepreciationLogs(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.listAssetDepreciationLogs(id, req.authContext!);
  }

  @Get('fixed-assets/auto-depreciate/status')
  getAutoDepreciationStatus(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.fixedAssetsScheduler.getSchedulerStatus(requireTenantScope(req.authContext).tenantId);
  }

  @Post('fixed-assets/auto-depreciate/toggle')
  toggleAutoDepreciation(@Body() body: { enabled: boolean }, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.fixedAssetsScheduler.setAutoDepreciationEnabled(requireTenantScope(req.authContext).tenantId, Boolean(body.enabled));
  }

  @Post('fixed-assets/auto-depreciate/trigger')
  triggerAutoDepreciation(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.fixedAssetsScheduler.triggerImmediateRun(requireTenantScope(req.authContext).tenantId, req.authContext!);
  }

  // --- Multi-Currency (العملات المتعددة وأسعار الصرف) ---
  @Get('currencies')
  listCurrencies(@Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.listCurrencies(req.authContext!);
  }

  @Post('currencies')
  upsertCurrency(@Body() body: { currencyCode: string; currencyName: string; exchangeRate: number; isBase?: boolean; symbol?: string }, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.upsertCurrency(body, req.authContext!);
  }

  @Post('currencies/convert')
  convertCurrency(@Body() body: { amount: number; fromCurrency: string; toCurrency: string }, @Req() req: RequestWithAuth): Promise<Record<string, unknown>> {
    return this.accountingService.convertCurrency(body, req.authContext!);
  }

  // --- Forex Revaluation Engine (إعادة تقييم فروق أسعار الصرف - IAS 21) ---
  @Get('currencies/revaluations')
  listForexRevaluations(@Req() req: RequestWithAuth): Promise<any[]> {
    return this.forexRevaluation.listRuns(req.authContext!);
  }

  @Get('currencies/revaluations/:id')
  getForexRevaluationDetails(@Param('id') id: string, @Req() req: RequestWithAuth): Promise<any> {
    return this.forexRevaluation.getRunDetails(id, req.authContext!);
  }

  @Post('currencies/revaluations/preview')
  previewForexRevaluation(@Body() body: { periodDate: string; currencyCode: string; closingRate: number }, @Req() req: RequestWithAuth): Promise<any> {
    return this.forexRevaluation.previewRevaluation(body, req.authContext!);
  }

  @Post('currencies/revaluations/execute')
  executeForexRevaluation(@Body() body: ExecuteForexRevaluationDto, @Req() req: RequestWithAuth): Promise<any> {
    return this.forexRevaluation.executeRevaluation(body, req.authContext!);
  }

  // --- Bank Reconciliation Engine (التسويات البنكية ومطابقة كشوف الحساب) ---
  @Get('bank-statements')
  listBankStatements(@Query('accountId') accountId: string, @Req() req: RequestWithAuth): Promise<any[]> {
    return this.accountingService.listBankStatements(req.authContext!, accountId ? Number(accountId) : undefined);
  }

  @Get('bank-statements/:id')
  getBankStatement(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<any> {
    return this.accountingService.getBankStatement(id, req.authContext!);
  }

  @Post('bank-statements')
  createBankStatement(@Body() dto: CreateBankStatementDto, @Req() req: RequestWithAuth): Promise<any> {
    return this.accountingService.createBankStatement(dto, req.authContext!);
  }

  @Get('bank-statements/:id/workspace')
  getBankReconciliationWorkspace(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<any> {
    return this.accountingService.getBankReconciliationWorkspace(id, req.authContext!);
  }

  @Post('bank-statements/reconcile')
  reconcileMatch(@Body() dto: ReconcileMatchDto, @Req() req: RequestWithAuth): Promise<any> {
    return this.accountingService.reconcileMatch(dto, req.authContext!);
  }

  @Post('bank-statements/unreconcile')
  unreconcileMatch(@Body('statementLineId', ParseIntPipe) statementLineId: number, @Req() req: RequestWithAuth): Promise<any> {
    return this.accountingService.unreconcileMatch(statementLineId, req.authContext!);
  }

  @Post('bank-statements/fee-adjustment')
  createBankFeeAdjustment(@Body() dto: CreateBankFeeAdjustmentDto, @Req() req: RequestWithAuth): Promise<any> {
    return this.accountingService.createBankFeeAdjustment(dto, req.authContext!);
  }

  // --- PDC Cheques Management (حافظة الشيكات وأوراق القبض والدفع) ---
  @Get('cheques')
  listCheques(
    @Query('type') type: 'receivable' | 'payable',
    @Query('status') status: string,
    @Query('search') search: string,
    @Query('dueFrom') dueFrom: string,
    @Query('dueTo') dueTo: string,
    @Query('partnerId') partnerId: string,
    @Query('bankName') bankName: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.pdcChequesService.listCheques(req.authContext!, {
      type: type || undefined,
      status: status || undefined,
      search: search || undefined,
      dueFrom: dueFrom || undefined,
      dueTo: dueTo || undefined,
      partnerId: partnerId ? Number(partnerId) : undefined,
      bankName: bankName || undefined,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('cheques/stats')
  getChequesStats(@Req() req: RequestWithAuth): Promise<any> {
    return this.pdcChequesService.getStats(req.authContext!);
  }

  @Post('cheques')
  createCheque(@Body() dto: CreatePdcChequeDto, @Req() req: RequestWithAuth): Promise<any> {
    return this.pdcChequesService.createCheque(req.authContext!, dto);
  }

  @Patch('cheques/:id/status')
  updateChequeStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateChequeStatusDto,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.pdcChequesService.updateChequeStatus(req.authContext!, id, dto);
  }

  @Delete('cheques/:id')
  deleteCheque(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth): Promise<any> {
    return this.pdcChequesService.deleteCheque(req.authContext!, id);
  }

  // --- Withholding Tax (WHT) & Egyptian Form 41 (ضريبة الخصم والإضافة ونموذج 41 ضرائب) ---
  @Get('withholding-tax/form-41')
  getForm41Report(
    @Query('year') year: string,
    @Query('quarter') quarter: string,
    @Query('direction') direction: 'payable' | 'receivable',
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.withholdingTaxService.getForm41Report(req.authContext!, {
      year: year ? Number(year) : undefined,
      quarter: quarter || undefined,
      direction: direction || undefined,
    });
  }

  @Post('withholding-tax')
  createWhtTransaction(
    @Body() dto: CreateWhtTransactionDto,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.withholdingTaxService.createTransaction(req.authContext!, dto);
  }

  @Post('withholding-tax/extract-from-purchases')
  extractWhtFromPurchases(
    @Body() dto: ExtractFromPurchasesDto,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.withholdingTaxService.extractFromPurchases(req.authContext!, dto);
  }

  @Patch('withholding-tax/:id/status')
  updateWhtStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: { status: 'draft' | 'declared' | 'paid'; payment_reference?: string },
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.withholdingTaxService.updateStatus(req.authContext!, id, dto);
  }

  @Delete('withholding-tax/:id')
  deleteWhtTransaction(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ): Promise<any> {
    return this.withholdingTaxService.deleteTransaction(req.authContext!, id);
  }

  // --- Payment Allocations & Invoice Reconciliation (تخصيص وتسوية المدفوعات على الفواتير) ---
  @Get('payment-allocations/open-invoices')
  getOpenInvoices(
    @Query('partnerType') partnerType: 'customer' | 'supplier',
    @Query('partnerId', ParseIntPipe) partnerId: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentAllocationService.getOpenInvoices(partnerType, partnerId, req.authContext!);
  }

  @Get('payment-allocations/unallocated-payments')
  getUnallocatedPayments(
    @Query('partnerType') partnerType: 'customer' | 'supplier',
    @Query('partnerId', ParseIntPipe) partnerId: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentAllocationService.getUnallocatedPayments(partnerType, partnerId, req.authContext!);
  }

  @Post('payment-allocations/allocate')
  allocatePayment(
    @Body() dto: AllocatePaymentDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentAllocationService.allocatePayment(dto, req.authContext!);
  }

  @Post('payment-allocations/auto-fifo')
  autoAllocateFIFO(
    @Body() body: { partnerType: 'customer' | 'supplier'; partnerId: number; paymentId: number },
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentAllocationService.autoAllocateFIFO(body.partnerType, body.partnerId, body.paymentId, req.authContext!);
  }

  @Get('payment-allocations/invoice')
  getInvoiceAllocations(
    @Query('invoiceType') invoiceType: 'sale' | 'purchase',
    @Query('invoiceId', ParseIntPipe) invoiceId: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.paymentAllocationService.getInvoiceAllocations(invoiceType, invoiceId, req.authContext!);
  }

  // --- Fiscal Year-End Closing Engine (معالج إقفال السنوات المالية وترحيل الأرباح) ---
  @Get('fiscal-years')
  listFiscalYears(@Req() req: RequestWithAuth) {
    return this.fiscalYearService.listFiscalYears(req.authContext!);
  }

  @Get('fiscal-years/:id')
  getFiscalYear(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.fiscalYearService.getFiscalYear(req.authContext!, id);
  }

  @Post('fiscal-years')
  createFiscalYear(@Body() dto: CreateFiscalYearDto, @Req() req: RequestWithAuth) {
    return this.fiscalYearService.createFiscalYear(req.authContext!, dto);
  }

  @Get('fiscal-years/:id/preview-close')
  previewFiscalYearClose(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.fiscalYearService.previewFiscalYearClose(req.authContext!, id);
  }

  @Post('fiscal-years/:id/close')
  executeFiscalYearClose(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseFiscalYearDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.fiscalYearService.executeFiscalYearClose(req.authContext!, id, dto);
  }

  @Post('fiscal-years/:id/reopen')
  reopenFiscalYear(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ReopenFiscalYearDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.fiscalYearService.reopenFiscalYear(req.authContext!, id, dto);
  }

  @Delete('fiscal-years/:id')
  deleteFiscalYear(@Param('id', ParseIntPipe) id: number, @Req() req: RequestWithAuth) {
    return this.fiscalYearService.deleteFiscalYear(req.authContext!, id);
  }
  // --- Monthly Fiscal Periods Engine (الفترات المحاسبية الشهرية وإقفال الشهور — البند O6) ---
  @Get('fiscal-years/:id/periods')
  listFiscalPeriods(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.fiscalYearService.listFiscalPeriods(req.authContext!, id);
  }

  @Post('fiscal-years/:id/periods/generate')
  generateFiscalPeriods(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.fiscalYearService.generateFiscalPeriods(req.authContext!, id);
  }

  @Post('fiscal-periods/:periodId/close')
  closeFiscalPeriod(
    @Param('periodId', ParseIntPipe) periodId: number,
    @Body() dto: CloseFiscalPeriodDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.fiscalYearService.closeFiscalPeriod(req.authContext!, periodId, dto);
  }

  @Post('fiscal-periods/:periodId/reopen')
  reopenFiscalPeriod(
    @Param('periodId', ParseIntPipe) periodId: number,
    @Body() dto: ReopenFiscalPeriodDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.fiscalYearService.reopenFiscalPeriod(req.authContext!, periodId, dto);
  }
}
