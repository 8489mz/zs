import { Controller, Post, Body, Param, Get, Patch, Req, UseGuards, Query, Delete, Headers } from '@nestjs/common';
import { ImportSalesService } from './import-sales.service';
import {
  CreateShipmentDto,
  UpdateShipmentCostsDto,
  AddShipmentItemDto,
  RecordForeignTransferDto,
  UpdateShipmentItemDto,
  CreateImportProjectDto,
  UpdateImportProjectDto,
  CalculateFeasibilityDto,
  CreateChinaSupplierDto,
  UpsertSupplierMetaDto,
  CreateQcInspectionDto,
  UpsertAciComplianceDto,
  CreateSourcingTripDto,
  ProcessLateExpenseDto,
  CalculateCustomsTaxDto,
  VerifyBankDetailsDto,
  CreateQuotationDto,
  SelectQuotationDto,
  CreateSampleOrderDto,
  UpdateSampleOrderInspectionDto,
  ConvertFeasibilityToProjectDto,
  CreateProformaInvoiceDto,
  CreateCustomsBrokerDto,
  DisburseBrokerAdvanceDto,
  LiquidateBrokerExpenseDto,
  RecordContainerDepositDto,
  RecordContainerReturnRefundDto,
  CreateContainerPreorderDto,
  ConvertPreorderToSaleDto,
  RefundImportPreorderDto,
  RecordFxAcquisitionDto,
  CreateImportDocumentDto,
  CreateApprovalRequestDto,
  DecideApprovalRequestDto,
  ResolveExceptionDto,
  RecordPartnerPayoutDto,
  CloseImportProjectDto,
  ReverseImportReceiptDto,
  ResolveLegacyReceiptDto,
  VerifyBrokerExpenseDto,
} from './dto/import-sales.dto';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { RequireAnyPermission } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';

@Controller('api/import-sales')
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireAnyPermission('purchases', 'inventory', 'accounting')
export class ImportSalesController {
  constructor(private readonly importSalesService: ImportSalesService) {}

  // ==========================================
  // COMMAND CENTER DASHBOARD
  // ==========================================

  @RequireAnyPermission('purchases', 'inventory', 'accounting', 'reports')
  @Get('command-center')
  async getCommandCenterMetrics(@Req() req: RequestWithAuth) {
    return this.importSalesService.getImportCommandCenterMetrics(req.authContext!.tenantId!);
  }

  // ==========================================
  // IMPORT PROJECTS & FEASIBILITY
  // ==========================================

  @Get('projects')
  async listProjects(@Req() req: RequestWithAuth, @Query('status') status?: string) {
    return this.importSalesService.listProjects(req.authContext!.tenantId!, status);
  }

  @Get('projects/:id')
  async getProjectById(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.importSalesService.getProjectById(req.authContext!.tenantId!, id);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('projects')
  async createProject(@Req() req: RequestWithAuth, @Body() dto: CreateImportProjectDto) {
    return this.importSalesService.createProject(req.authContext!.tenantId!, dto);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Patch('projects/:id')
  async updateProject(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() dto: UpdateImportProjectDto
  ) {
    return this.importSalesService.updateProject(req.authContext!.tenantId!, id, dto);
  }

  @Post('calculate-feasibility')
  async calculateFeasibility(@Body() dto: CalculateFeasibilityDto) {
    return this.importSalesService.calculateFeasibility(dto);
  }

  @RequireAnyPermission('accounting')
  @Get('projects/:id/partners')
  async getProjectPartners(@Req() req: RequestWithAuth, @Param('id') projectId: string) {
    return this.importSalesService.getProjectPartners(req.authContext!.tenantId!, projectId);
  }

  @RequireAnyPermission('accounting')
  @Post('projects/:id/partners')
  async setProjectPartners(
    @Req() req: RequestWithAuth,
    @Param('id') projectId: string,
    @Body() body: { partners: Array<{ partnerId: string; capitalShare: number; profitPercentage: number }> }
  ) {
    return this.importSalesService.setProjectPartners(req.authContext!.tenantId!, projectId, body.partners);
  }

  @RequireAnyPermission('accounting')
  @Post('projects/:id/close')
  async closeProject(@Req() req: RequestWithAuth, @Param('id') projectId: string, @Body() dto: CloseImportProjectDto) {
    return this.importSalesService.closeProject(req.authContext!.tenantId!, req.authContext!.userId!, projectId, dto?.approvalRequestId);
  }

  // ==========================================
  // CHINA SOURCING & QC
  // ==========================================

  @Get('china-suppliers')
  async listChinaSuppliers(@Req() req: RequestWithAuth) {
    return this.importSalesService.listChinaSuppliers(req.authContext!.tenantId!);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('china-suppliers')
  async createChinaSupplier(@Req() req: RequestWithAuth, @Body() dto: CreateChinaSupplierDto) {
    return this.importSalesService.createChinaSupplier(req.authContext!.tenantId!, req.authContext!.userId!, dto);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('suppliers/:supplierId/meta')
  async upsertSupplierImportMeta(
    @Req() req: RequestWithAuth,
    @Param('supplierId') supplierId: string,
    @Body() dto: UpsertSupplierMetaDto
  ) {
    return this.importSalesService.upsertSupplierImportMeta(req.authContext!.tenantId!, supplierId, dto);
  }

  @RequireAnyPermission('accounting')
  @Post('suppliers/:supplierId/verify-bank')
  async verifySupplierBankDetails(
    @Req() req: RequestWithAuth,
    @Param('supplierId') supplierId: string,
    @Body() dto: VerifyBankDetailsDto
  ) {
    return this.importSalesService.verifySupplierBankDetails(
      req.authContext!.tenantId!,
      Number(req.authContext!.userId!),
      supplierId,
      dto.verificationNotes
    );
  }

  @Get('sourcing-trips')
  async listSourcingTrips(@Req() req: RequestWithAuth, @Query('projectId') projectId?: string) {
    return this.importSalesService.listSourcingTrips(req.authContext!.tenantId!, projectId);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('sourcing-trips')
  async createSourcingTrip(@Req() req: RequestWithAuth, @Body() dto: CreateSourcingTripDto) {
    return this.importSalesService.createSourcingTrip(req.authContext!.tenantId!, dto);
  }

  @Get('qc-inspections')
  async listQcInspections(
    @Req() req: RequestWithAuth,
    @Query('projectId') projectId?: string,
    @Query('shipmentId') shipmentId?: string
  ) {
    return this.importSalesService.listQcInspections(req.authContext!.tenantId!, projectId, shipmentId);
  }

  @RequireAnyPermission('purchases', 'inventory', 'accounting')
  @Post('qc-inspections')
  async createQcInspection(@Req() req: RequestWithAuth, @Body() dto: CreateQcInspectionDto) {
    return this.importSalesService.createQcInspection(req.authContext!.tenantId!, dto);
  }

  @RequireAnyPermission('purchases', 'inventory', 'accounting')
  @Patch('qc-inspections/:id')
  async updateQcInspection(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() dto: Partial<CreateQcInspectionDto>
  ) {
    return this.importSalesService.updateQcInspection(req.authContext!.tenantId!, id, dto);
  }

  // ==========================================
  // EGYPT ACI & CUSTOMS COMPLIANCE
  // ==========================================

  @Get('aci-compliance/:id')
  async getAciCompliance(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.importSalesService.getAciCompliance(req.authContext!.tenantId!, id);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('aci-compliance')
  async upsertAciCompliance(@Req() req: RequestWithAuth, @Body() dto: UpsertAciComplianceDto) {
    return this.importSalesService.upsertAciCompliance(req.authContext!.tenantId!, dto);
  }

  @Get('customs-tariffs/sectors')
  async listCustomsTariffSectors() {
    return this.importSalesService.listTariffSectors();
  }

  @Post('customs-tariffs/sync-official')
  async syncOfficialTariffs(@Req() req: RequestWithAuth) {
    return this.importSalesService.syncOfficialTariffs(req.authContext!.tenantId!);
  }

  @Get('customs-tariffs')
  async listCustomsTariffs(
    @Req() req: RequestWithAuth,
    @Query('search') search?: string,
    @Query('sector') sector?: string
  ) {
    return this.importSalesService.listCustomsTariffs(req.authContext!.tenantId!, search, sector);
  }

  @Post('calculate-customs')
  async calculateCustomsTax(
    @Req() req: RequestWithAuth,
    @Body() body: CalculateCustomsTaxDto
  ) {
    return this.importSalesService.calculateCustomsTax(
      req.authContext!.tenantId!,
      body.hsCode,
      body.cifValueEgp,
      {
        overrideDutyRatePercent: body.overrideDutyRatePercent,
        overrideVatRatePercent: body.overrideVatRatePercent,
      }
    );
  }

  // ==========================================
  // PARTNERS & CAPITAL
  // ==========================================

  @RequireAnyPermission('accounting')
  @Get('partners')
  async getPartners(@Req() req: RequestWithAuth) {
    return this.importSalesService.getPartners(req.authContext!.tenantId!);
  }

  @RequireAnyPermission('accounting')
  @Post('partners')
  async createPartner(
    @Req() req: RequestWithAuth,
    @Body() dto: { name: string; percentage: number; capitalAmount?: number; accountId?: string }
  ) {
    return this.importSalesService.createPartner(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      dto.name,
      dto.percentage,
      dto.capitalAmount,
      dto.accountId
    );
  }

  @RequireAnyPermission('accounting')
  @Patch('partners/:id')
  async updatePartner(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() dto: { name?: string; percentage?: number; capitalAmount?: number }
  ) {
    return this.importSalesService.updatePartner(
      req.authContext!.tenantId!,
      id,
      dto.name,
      dto.percentage,
      dto.capitalAmount
    );
  }

  @RequireAnyPermission('accounting')
  @Delete('partners/:id')
  async deletePartner(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.importSalesService.deletePartner(req.authContext!.tenantId!, id);
  }

  @RequireAnyPermission('accounting')
  @Get('partners/:id/ledger')
  async getPartnerLedger(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.importSalesService.getPartnerLedger(req.authContext!.tenantId!, id);
  }

  @RequireAnyPermission('accounting')
  @Post('partners/:id/capital-transaction')
  async recordCapitalTransaction(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() dto: { type: 'DEPOSIT' | 'WITHDRAWAL'; amount: number; date: string; note?: string; accountId?: string; idempotencyKey?: string }
  ) {
    return this.importSalesService.recordCapitalTransaction(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      id,
      dto
    );
  }

  @RequireAnyPermission('accounting')
  @Post('partners/:id/payout')
  async recordPartnerPayout(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() dto: RecordPartnerPayoutDto
  ) {
    return this.importSalesService.recordPartnerPayout(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      id,
      dto.amount,
      dto.approvalRequestId,
      dto.projectId,
      dto.treasuryAccountId
    );
  }

  // ==========================================
  // SHIPMENTS & ITEMS
  // ==========================================

  @Get('shipments')
  async listShipments(@Req() req: RequestWithAuth) {
    return this.importSalesService.listShipments(req.authContext!.tenantId!);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('shipments')
  async createShipment(@Req() req: RequestWithAuth, @Body() dto: CreateShipmentDto) {
    return this.importSalesService.createShipment(req.authContext!.tenantId!, dto);
  }

  @Get('shipments/:id')
  async getShipmentById(@Req() req: RequestWithAuth, @Param('id') shipmentId: string) {
    return this.importSalesService.getShipmentById(req.authContext!.tenantId!, shipmentId);
  }

  @RequireAnyPermission('purchases', 'accounting', 'inventory')
  @Patch('shipments/:id/costs')
  async updateShipmentCosts(
    @Req() req: RequestWithAuth,
    @Param('id') shipmentId: string,
    @Body() dto: UpdateShipmentCostsDto
  ) {
    return this.importSalesService.updateShipmentCosts(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      shipmentId,
      dto
    );
  }

  @RequireAnyPermission('purchases', 'accounting', 'inventory')
  @Post('shipments/:id/items')
  async addShipmentItem(
    @Req() req: RequestWithAuth,
    @Param('id') shipmentId: string,
    @Body() dto: AddShipmentItemDto
  ) {
    return this.importSalesService.addShipmentItem(req.authContext!.tenantId!, shipmentId, dto);
  }

  @RequireAnyPermission('purchases', 'accounting', 'inventory')
  @Post('shipments/:id/import-project-items')
  async importProjectItems(
    @Req() req: RequestWithAuth,
    @Param('id') shipmentId: string
  ) {
    return this.importSalesService.importProjectItemsToShipment(
      req.authContext!.tenantId!,
      Number(req.authContext!.userId!),
      shipmentId
    );
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('calculate-landed-cost/:shipmentId')
  async calculateLandedCost(@Req() req: RequestWithAuth, @Param('shipmentId') shipmentId: string) {
    return this.importSalesService.calculateLandedCost(req.authContext!.tenantId!, shipmentId);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('shipments/:shipmentId/late-expense')
  async processLateShipmentExpense(
    @Req() req: RequestWithAuth,
    @Param('shipmentId') shipmentId: string,
    @Body() dto: ProcessLateExpenseDto
  ) {
    return this.importSalesService.processLateShipmentExpense(
      req.authContext!.tenantId!,
      Number(req.authContext!.userId!),
      shipmentId,
      dto
    );
  }

  @RequireAnyPermission('accounting', 'inventory')
  @Post('shipments/:id/reverse-receipt')
  async reversePostedReceipt(
    @Req() req: RequestWithAuth,
    @Param('id') shipmentId: string,
    @Body() dto: ReverseImportReceiptDto
  ) {
    return this.importSalesService.reversePostedReceipt(
      req.authContext!.tenantId!,
      Number(req.authContext!.userId!),
      shipmentId,
      dto
    );
  }

  @RequireAnyPermission('accounting', 'inventory')
  @Post('shipments/:id/resolve-legacy-review')
  async resolveLegacyReceipt(
    @Req() req: RequestWithAuth,
    @Param('id') shipmentId: string,
    @Body() dto: ResolveLegacyReceiptDto
  ) {
    return this.importSalesService.resolveLegacyReceipt(
      req.authContext!.tenantId!,
      Number(req.authContext!.userId!),
      shipmentId,
      dto
    );
  }

  @RequireAnyPermission('canViewProfit', 'reports', 'accounting')
  @Get('profit-report')
  async generateProfitReport(
    @Req() req: RequestWithAuth,
    @Query('startDate') startDate: string,
    @Query('endDate') endDate: string,
    @Query('projectId') projectId?: string
  ) {
    if (!startDate || !endDate) {
      const end = new Date();
      const start = new Date();
      start.setDate(1);
      return this.importSalesService.generatePeriodProfitReport(req.authContext!.tenantId!, start, end, projectId);
    }
    return this.importSalesService.generatePeriodProfitReport(req.authContext!.tenantId!, startDate, endDate, projectId);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Get('foreign-transfers')
  async listForeignTransfers(@Req() req: RequestWithAuth) {
    return this.importSalesService.listForeignTransfers(req.authContext!.tenantId!);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('foreign-transfer')
  async recordForeignTransfer(
    @Req() req: RequestWithAuth,
    @Body() dto: RecordForeignTransferDto,
    @Headers('x-idempotency-key') headerIdempotencyKey?: string,
  ) {
    if (!dto.idempotencyKey && headerIdempotencyKey) {
      dto.idempotencyKey = headerIdempotencyKey;
    }
    return this.importSalesService.recordForeignTransfer(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      dto
    );
  }

  @RequireAnyPermission('purchases', 'accounting', 'inventory')
  @Patch('shipment-items/:itemId')
  async updateShipmentItem(
    @Req() req: RequestWithAuth,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateShipmentItemDto
  ) {
    return this.importSalesService.updateShipmentItem(req.authContext!.tenantId!, itemId, dto);
  }

  @RequireAnyPermission('purchases', 'pricing', 'canManageSettings')
  @Post('shipments/:id/apply-prices')
  async applySuggestedPrices(@Req() req: RequestWithAuth, @Param('id') shipmentId: string) {
    return this.importSalesService.applySuggestedPrices(req.authContext!.tenantId!, shipmentId);
  }

  // ==========================================
  // FEASIBILITY CONVERSION & LIQUIDITY
  // ==========================================

  @RequireAnyPermission('purchases', 'accounting')
  @Post('projects/:id/convert-feasibility')
  async convertFeasibilityToProject(
    @Req() req: RequestWithAuth,
    @Param('id') projectId: string,
    @Body() dto: ConvertFeasibilityToProjectDto
  ) {
    return this.importSalesService.convertFeasibilityToProject(req.authContext!.tenantId!, projectId, dto);
  }

  // ==========================================
  // RFQS & FACTORY QUOTATIONS
  // ==========================================

  @RequireAnyPermission('purchases', 'accounting')
  @Post('quotations')
  async createQuotation(@Req() req: RequestWithAuth, @Body() dto: CreateQuotationDto) {
    return this.importSalesService.createQuotation(req.authContext!.tenantId!, dto);
  }

  @Get('quotations')
  async listQuotations(
    @Req() req: RequestWithAuth,
    @Query('projectId') projectId?: string,
    @Query('supplierId') supplierId?: string
  ) {
    return this.importSalesService.listQuotations(req.authContext!.tenantId!, projectId, supplierId);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('quotations/:id/select')
  async selectQuotation(
    @Req() req: RequestWithAuth,
    @Param('id') quotationId: string,
    @Body() dto: SelectQuotationDto
  ) {
    return this.importSalesService.selectQuotation(req.authContext!.tenantId!, quotationId, dto);
  }

  // ==========================================
  // PRODUCT SAMPLES & REFERENCE APPROVAL
  // ==========================================

  @RequireAnyPermission('purchases', 'inventory')
  @Post('samples')
  async createSampleOrder(@Req() req: RequestWithAuth, @Body() dto: CreateSampleOrderDto) {
    return this.importSalesService.createSampleOrder(req.authContext!.tenantId!, dto);
  }

  @Get('samples')
  async listSampleOrders(@Req() req: RequestWithAuth, @Query('projectId') projectId?: string) {
    return this.importSalesService.listSampleOrders(req.authContext!.tenantId!, projectId);
  }

  @RequireAnyPermission('purchases', 'inventory')
  @Patch('samples/:id/inspection')
  async updateSampleOrderInspection(
    @Req() req: RequestWithAuth,
    @Param('id') sampleId: string,
    @Body() dto: UpdateSampleOrderInspectionDto
  ) {
    return this.importSalesService.updateSampleOrderInspection(req.authContext!.tenantId!, sampleId, dto);
  }

  // ==========================================
  // PROFORMA INVOICES & PURCHASE ORDERS
  // ==========================================

  @Get('proforma-invoices')
  async getProformaInvoices(
    @Req() req: RequestWithAuth,
    @Query('projectId') projectId?: string,
    @Query('supplierId') supplierId?: string
  ) {
    return this.importSalesService.getProformaInvoices(req.authContext!.tenantId!, projectId, supplierId);
  }

  @Get('proforma-invoices/:id')
  async getProformaById(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.importSalesService.getProformaById(req.authContext!.tenantId!, id);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('proforma-invoices')
  async createProformaInvoice(@Req() req: RequestWithAuth, @Body() dto: CreateProformaInvoiceDto) {
    return this.importSalesService.createProformaInvoice(req.authContext!.tenantId!, dto);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Patch('proforma-invoices/:id')
  async updateProformaInvoice(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() dto: Partial<CreateProformaInvoiceDto>
  ) {
    return this.importSalesService.updateProformaInvoice(req.authContext!.tenantId!, id, dto);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('proforma-invoices/:id/approve')
  async approveProformaInvoice(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.importSalesService.approveProformaInvoice(req.authContext!.tenantId!, req.authContext!.userId!, id);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('proforma-invoices/:id/generate-po')
  async generatePoFromProforma(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.importSalesService.generatePoFromProforma(req.authContext!.tenantId!, req.authContext!.userId!, id);
  }

  // ==========================================
  // CUSTOMS BROKER REGISTRY & ADVANCE LIQUIDATION
  // ==========================================

  @Get('customs-brokers')
  async listCustomsBrokers(@Req() req: RequestWithAuth) {
    return this.importSalesService.listCustomsBrokers(req.authContext!.tenantId!);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Post('customs-brokers')
  async createCustomsBroker(@Req() req: RequestWithAuth, @Body() dto: CreateCustomsBrokerDto) {
    return this.importSalesService.createCustomsBroker(req.authContext!.tenantId!, dto);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Patch('customs-brokers/:id')
  async updateCustomsBroker(
    @Req() req: RequestWithAuth,
    @Param('id') id: string,
    @Body() dto: Partial<CreateCustomsBrokerDto>
  ) {
    return this.importSalesService.updateCustomsBroker(req.authContext!.tenantId!, id, dto);
  }

  @Get('customs-brokers/:id/statement')
  async getCustomsBrokerStatement(@Req() req: RequestWithAuth, @Param('id') id: string) {
    return this.importSalesService.getCustomsBrokerStatement(req.authContext!.tenantId!, id);
  }

  @RequireAnyPermission('accounting', 'treasury')
  @Post('customs-brokers/advances')
  async disburseBrokerAdvance(@Req() req: RequestWithAuth, @Body() dto: DisburseBrokerAdvanceDto) {
    return this.importSalesService.disburseBrokerAdvance(req.authContext!.tenantId!, req.authContext!.userId!, dto);
  }

  @RequireAnyPermission('accounting', 'purchases')
  @Post('customs-brokers/liquidate')
  async liquidateBrokerExpenses(@Req() req: RequestWithAuth, @Body() dto: LiquidateBrokerExpenseDto) {
    return this.importSalesService.liquidateBrokerExpenses(req.authContext!.tenantId!, req.authContext!.userId!, dto);
  }

  @RequireAnyPermission('accounting', 'purchases')
  @Post('customs-brokers/expenses/:id/verify')
  async verifyBrokerExpense(@Req() req: RequestWithAuth, @Param('id') expenseId: string, @Body() dto: VerifyBrokerExpenseDto) {
    return this.importSalesService.verifyBrokerExpense(req.authContext!.tenantId!, req.authContext!.userId!, expenseId, dto);
  }

  // ==========================================
  // CONTAINER SECURITY DEPOSITS
  // ==========================================

  @RequireAnyPermission('accounting', 'purchases')
  @Post('container-deposits')
  async recordContainerDeposit(@Req() req: RequestWithAuth, @Body() dto: RecordContainerDepositDto) {
    return this.importSalesService.recordContainerDeposit(req.authContext!.tenantId!, req.authContext!.userId!, dto);
  }

  @RequireAnyPermission('accounting', 'purchases')
  @Post('container-deposits/:id/return-refund')
  async recordContainerReturnAndRefund(
    @Req() req: RequestWithAuth,
    @Param('id') depositId: string,
    @Body() dto: RecordContainerReturnRefundDto
  ) {
    return this.importSalesService.recordContainerReturnAndRefund(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      depositId,
      dto
    );
  }

  @Get('container-deposits')
  async listContainerDeposits(@Req() req: RequestWithAuth, @Query('shipmentId') shipmentId?: string) {
    return this.importSalesService.listContainerDeposits(req.authContext!.tenantId!, shipmentId);
  }

  // ==========================================
  // IN-TRANSIT CONTAINER PRE-ORDERS
  // ==========================================

  @RequireAnyPermission('sales', 'purchases')
  @Post('preorders')
  async createContainerPreorder(@Req() req: RequestWithAuth, @Body() dto: CreateContainerPreorderDto) {
    return this.importSalesService.createContainerPreorder(req.authContext!.tenantId!, req.authContext!.userId!, dto);
  }

  @Get('preorders')
  async listContainerPreorders(
    @Req() req: RequestWithAuth,
    @Query('shipmentId') shipmentId?: string,
    @Query('customerId') customerId?: string
  ) {
    return this.importSalesService.listContainerPreorders(req.authContext!.tenantId!, shipmentId, customerId);
  }

  @RequireAnyPermission('accounting')
  @Post('preorders/:id/refund')
  async refundContainerPreorder(
    @Req() req: RequestWithAuth,
    @Param('id') preorderId: string,
    @Body() dto: RefundImportPreorderDto,
  ) {
    return this.importSalesService.refundContainerPreorder(req.authContext!.tenantId!, req.authContext!.userId!, preorderId, dto);
  }

  @RequireAnyPermission('sales', 'purchases')
  @Post('preorders/:id/cancel')
  async cancelContainerPreorder(
    @Req() req: RequestWithAuth,
    @Param('id') preorderId: string,
    @Body('reason') reason?: string
  ) {
    return this.importSalesService.cancelContainerPreorder(req.authContext!.tenantId!, preorderId, reason);
  }

  // ==========================================
  // SINGLE-CONTAINER EXECUTIVE AUTOPSY SHEET
  // ==========================================

  @RequireAnyPermission('reports', 'accounting', 'purchases')
  
  @RequireAnyPermission('sales', 'inventory', 'purchases')
  @Post('preorders/:id/convert-to-sale')
  async convertPreorderToSale(
    @Req() req: RequestWithAuth,
    @Param('id') preorderId: string,
    @Body() dto: ConvertPreorderToSaleDto
  ) {
    return this.importSalesService.convertPreorderToSale(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      preorderId,
      dto
    );
  }

  @Get('shipments/:id/autopsy')
  async getContainerAutopsySheet(@Req() req: RequestWithAuth, @Param('id') shipmentId: string) {
    return this.importSalesService.getContainerAutopsySheet(req.authContext!.tenantId!, shipmentId);
  }

  // ==========================================
  // FX TREASURY DESK
  // ==========================================

  @RequireAnyPermission('accounting', 'treasury')
  @Post('fx-acquisitions')
  async recordFxAcquisition(@Req() req: RequestWithAuth, @Body() dto: RecordFxAcquisitionDto) {
    return this.importSalesService.recordFxAcquisition(req.authContext!.tenantId!, req.authContext!.userId!, dto);
  }

  @RequireAnyPermission('accounting', 'treasury')
  @Get('fx-portfolio')
  async getFxPortfolio(@Req() req: RequestWithAuth) {
    return this.importSalesService.getFxPortfolio(req.authContext!.tenantId!);
  }

  // ==========================================
  // UNIFIED DOCUMENT CENTER
  // ==========================================

  @RequireAnyPermission('purchases', 'inventory', 'accounting')
  @Post('documents')
  async createImportDocument(@Req() req: RequestWithAuth, @Body() dto: CreateImportDocumentDto) {
    return this.importSalesService.createImportDocument(req.authContext!.tenantId!, req.authContext!.userId!, dto);
  }

  @Get('documents')
  async listImportDocuments(
    @Req() req: RequestWithAuth,
    @Query('projectId') projectId?: string,
    @Query('shipmentId') shipmentId?: string
  ) {
    return this.importSalesService.listImportDocuments(req.authContext!.tenantId!, projectId, shipmentId);
  }

  // ==========================================
  // MAKER-CHECKER GOVERNANCE WORKFLOW
  // ==========================================

  @RequireAnyPermission('purchases', 'accounting')
  @Post('approvals')
  async createApprovalRequest(@Req() req: RequestWithAuth, @Body() dto: CreateApprovalRequestDto) {
    return this.importSalesService.createApprovalRequest(req.authContext!.tenantId!, req.authContext!.userId!, dto);
  }

  @RequireAnyPermission('purchases', 'accounting')
  @Get('approvals')
  async listApprovalRequests(@Req() req: RequestWithAuth, @Query('status') status?: string) {
    return this.importSalesService.listApprovalRequests(req.authContext!.tenantId!, status);
  }

  @RequireAnyPermission('accounting')
  @Post('approvals/:id/decide')
  async decideApprovalRequest(
    @Req() req: RequestWithAuth,
    @Param('id') requestId: string,
    @Body() dto: DecideApprovalRequestDto
  ) {
    return this.importSalesService.decideApprovalRequest(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      requestId,
      dto
    );
  }

  // ==========================================
  // RECONCILIATION ENGINE & EXCEPTIONS CENTER
  // ==========================================

  @RequireAnyPermission('accounting', 'reports')
  @Post('reconciliation/scan')
  async runImportReconciliationScan(@Req() req: RequestWithAuth) {
    return this.importSalesService.runImportReconciliationScan(req.authContext!.tenantId!);
  }

  @RequireAnyPermission('accounting', 'reports')
  @Get('reconciliation/exceptions')
  async listReconciliationExceptions(@Req() req: RequestWithAuth, @Query('status') status?: string) {
    return this.importSalesService.listReconciliationExceptions(req.authContext!.tenantId!, status);
  }

  @RequireAnyPermission('accounting')
  @Post('reconciliation/exceptions/:id/resolve')
  async resolveReconciliationException(
    @Req() req: RequestWithAuth,
    @Param('id') exceptionId: string,
    @Body() dto: ResolveExceptionDto
  ) {
    return this.importSalesService.resolveReconciliationException(
      req.authContext!.tenantId!,
      req.authContext!.userId!,
      exceptionId,
      dto
    );
  }
}
