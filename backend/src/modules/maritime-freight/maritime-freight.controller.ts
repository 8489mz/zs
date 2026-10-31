import { Controller, Get, Post, Put, Patch, Delete, Body, Param, Query, Req, UseGuards } from '@nestjs/common';
import { MaritimeFreightService } from './maritime-freight.service';
import { MaritimeCustomerPortalService } from './maritime-customer-portal.service';
import { MaritimeMailService, MaritimeMailConfig } from './maritime-mail.service';
import { SessionAuthGuard } from '../../core/auth/guards/session-auth.guard';
import { PermissionsGuard } from '../../core/auth/guards/permissions.guard';
import { RequireFeature } from '../../core/auth/decorators/feature.decorator';
import { AllowAuthenticated } from '../../core/auth/decorators/permissions.decorator';
import { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { CreateMaritimeInquiryDto } from './dto/create-inquiry.dto';
import { CreateMaritimeRfqDto } from './dto/create-rfq.dto';
import { SubmitMaritimeBidDto } from './dto/submit-bid.dto';
import { CreateMaritimeQuotationDto } from './dto/create-quotation.dto';
import { CreateMaritimeJobDto } from './dto/create-job.dto';
import { UpdateMaritimeContainerDto } from './dto/update-container.dto';
import { CreateRateCardDto, UpdateRateCardStatusDto } from './dto/rate-card.dto';
import { CreateCustomsDeclarationDto, CreateCustomsDeclarationItemDto, UpdateCustomsDeclarationStatusDto } from './dto/customs-declaration.dto';
import { CreateCargoInsuranceDto, UpdateCargoInsuranceDto, ClaimCargoInsuranceDto } from './dto/cargo-insurance.dto';
import { CreateWarehouseReceiptDto, ReleaseWarehouseReceiptDto } from './dto/warehouse-receipt.dto';
import { UpdateJobChargesDto } from './dto/itemized-charges.dto';
import { CreateJobDocumentDto } from './dto/job-document.dto';
import { CreateAgentSettlementDto, UpdateAgentSettlementStatusDto } from './dto/agent-settlement.dto';
import { CreateInlandTruckingTripDto, UpdateInlandTruckingTripStatusDto } from './dto/inland-trucking.dto';
import { CarrierTrackingEventDto, CarrierTrackingSyncDto } from './dto/carrier-tracking.dto';
import { DcsaMilestoneKey, ShipmentMilestoneKey } from './maritime-freight.types';

@Controller(['maritime-freight', 'api/maritime-freight'])
@UseGuards(SessionAuthGuard, PermissionsGuard)
@RequireFeature('maritime_freight')
@AllowAuthenticated()
export class MaritimeFreightController {
  constructor(
    private readonly freightService: MaritimeFreightService,
    private readonly mailService: MaritimeMailService,
    private readonly portalService: MaritimeCustomerPortalService,
  ) {}

  // Staff-only: set/rotate a freight customer's portal PIN (stored hashed).
  // Guarded by the same staff session auth as every other action in this
  // controller (SessionAuthGuard + PermissionsGuard + maritime_freight
  // feature); the public portal controller stays unauthenticated.
  // INV-FREIGHT-PORTAL-PIN-HASHED.
  @Put('customers/:id/portal-pin')
  async setCustomerPortalPin(
    @Param('id') id: string,
    @Body() body: { pinCode: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.portalService.setCustomerPortalPin(req.authContext!, Number(id), String(body?.pinCode || ''));
  }

  // 0. Aggregated Metrics & Tab Badges
  @Get('counts')
  async getCounts(@Req() req: RequestWithAuth) {
    return this.freightService.getCounts(req.authContext!);
  }

  // 1. Ports Master Data
  @Get('ports')
  async getPorts(@Req() req: RequestWithAuth) {
    return this.freightService.getPorts(req.authContext!);
  }

  @Post('ports')
  async createPort(
    @Body() body: { code: string; nameAr: string; nameEn: string; countryCode: string; countryName: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createPort(req.authContext!, body);
  }

  // 2. Shipping Lines & Freight Partners Master Data
  @Get('shipping-lines')
  async getShippingLines(
    @Query('carrierType') carrierType: string,
    @Query('tradeLane') tradeLane: string,
    @Query('countryCode') countryCode: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getShippingLines(req.authContext!, { carrierType, tradeLane, countryCode, search });
  }

  @Post('shipping-lines')
  async createShippingLine(
    @Body() body: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createShippingLine(req.authContext!, body);
  }

  @Patch('shipping-lines/:id')
  async updateShippingLine(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateShippingLine(req.authContext!, id, body);
  }

  @Delete('shipping-lines/:id')
  async deleteShippingLine(
    @Param('id') id: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.deleteShippingLine(req.authContext!, id);
  }

  @Post('master-data/seed-defaults')
  async seedDefaultMasterData(@Req() req: RequestWithAuth) {
    return this.freightService.seedDefaultMasterData(req.authContext!);
  }

  @Get('reference-data')
  async getReferenceData() {
    return this.freightService.getReferenceData();
  }

  @Post('shipping-lines/import-bulk')
  async importCarriersBulk(
    @Body() body: { items: any[] },
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.importCarriersBulk(req.authContext!, body.items);
  }

  // 3. Maritime RFQs
  @Post('rfqs')
  async createRfq(@Body() dto: CreateMaritimeRfqDto, @Req() req: RequestWithAuth) {
    return this.freightService.createRfq(req.authContext!, dto);
  }

  @Get('rfqs')
  async getRfqs(
    @Query('status') status: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getRfqs(req.authContext!, { status, search });
  }

  @Get('rfqs/:id')
  async getRfqById(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.getRfqById(req.authContext!, id);
  }

  @Post('rfqs/:id/dispatch-emails')
  async dispatchEmails(
    @Param('id') id: string,
    @Body() body: { targetLineIds?: number[] },
    @Req() req: RequestWithAuth
  ) {
    return this.freightService.dispatchRfqEmails(req.authContext!, id, body?.targetLineIds);
  }

  // 4. Bids Management
  @Post('bids')
  async submitBid(@Body() dto: SubmitMaritimeBidDto, @Req() req: RequestWithAuth) {
    return this.freightService.submitBid(req.authContext!, dto);
  }

  @Post('bids/:id/award')
  async awardBid(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.awardBid(req.authContext!, id);
  }

  @Post('parse-email-text')
  parseEmailText(@Body() body: any) {
    const raw = typeof body === 'string' ? body : (body?.text || body?.rawText || '');
    return this.freightService.parseCarrierEmailText(raw);
  }

  @Post('jobs/parse-booking-text')
  parseBookingText(@Body() body: any) {
    const raw = typeof body === 'string' ? body : (body?.text || body?.rawText || '');
    return this.freightService.parseCarrierBookingText(raw);
  }

  // 5. Client Quotations
  @Post('quotations')
  async createQuotation(@Body() dto: CreateMaritimeQuotationDto, @Req() req: RequestWithAuth) {
    return this.freightService.createQuotation(req.authContext!, dto);
  }

  @Get('quotations')
  async getQuotations(
    @Query('status') status: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getQuotations(req.authContext!, { status, search });
  }

  @Put('quotations/:id/status')
  async updateQuotationStatus(
    @Param('id') id: string,
    @Body('status') status: 'approved' | 'rejected' | 'sent',
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateQuotationStatus(req.authContext!, id, status);
  }

  // 6. Shipment Jobs
  @Post('jobs')
  async createJob(@Body() dto: CreateMaritimeJobDto, @Req() req: RequestWithAuth) {
    return this.freightService.createJob(req.authContext!, dto);
  }

  @Get('jobs')
  async getJobs(
    @Query('status') status: string,
    @Query('search') search: string,
    @Query('milestone') milestone: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getJobs(req.authContext!, { status, search, milestone });
  }

  @Get('jobs/:id')
  async getJobById(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.getJobById(req.authContext!, id);
  }

  @Put('jobs/:id')
  async updateJob(
    @Param('id') id: string,
    @Body() body: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateJob(req.authContext!, id, body);
  }

  @Post('jobs/:id/milestones')
  async addMilestone(
    @Param('id') id: string,
    @Body('milestoneKey') milestoneKey: ShipmentMilestoneKey,
    @Body('notes') notes: string,
    @Body('location') location: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.addJobMilestone(req.authContext!, id, milestoneKey, notes, location);
  }

  @Post('jobs/:id/release-do')
  async releaseDeliveryOrder(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.releaseDeliveryOrder(req.authContext!, id);
  }

  @Get('jobs/:id/whatsapp-alert')
  async getJobMilestoneWhatsApp(
    @Param('id') id: string,
    @Query('milestone') milestoneKey: ShipmentMilestoneKey,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getMilestoneWhatsAppMessage(req.authContext!, id, milestoneKey);
  }

  @Post('jobs/:id/send-whatsapp')
  async sendJobMilestoneWhatsApp(
    @Param('id') id: string,
    @Body('milestone') milestoneKey: ShipmentMilestoneKey,
    @Body('phone') phone: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.sendMilestoneWhatsApp(req.authContext!, id, milestoneKey, phone);
  }

  @Post('jobs/:id/issue-invoice')
  async issueJobSalesInvoice(
    @Param('id') id: string,
    @Body() body: { amount?: number; notes?: string; exchangeRate?: number; currency?: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.issueJobSalesInvoice(req.authContext!, id, body);
  }

  @Post('jobs/:id/record-expense')
  async recordJobExpenseVoucher(
    @Param('id') id: string,
    @Body() body: { amount: number; expenseType?: 'carrier' | 'port' | 'other'; paymentMethod?: 'payable' | 'cash' | 'bank'; supplierId?: number; supplierName?: string; description?: string; currency?: string; exchangeRate?: number },
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.recordJobExpenseVoucher(req.authContext!, id, body);
  }

  @Get('jobs/:id/financial-ledger')
  async getJobFinancialLedger(
    @Param('id') id: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getJobFinancialLedger(req.authContext!, id, { page: Number(page), pageSize: Number(pageSize) });
  }

  @Post('jobs/:id/settle-from-balance')
  async settleJobFromBalance(
    @Param('id') id: string,
    @Body() body: { amount?: number; exchangeRate?: number },
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.settleJobFromCustomerBalance(req.authContext!, id, body);
  }

  @Get('customers/:customerId/active-jobs')
  async getCustomerActiveJobs(
    @Param('customerId') customerId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getCustomerActiveJobs(req.authContext!, customerId);
  }

  // 7. Containers & Demurrage Radar
  @Get('containers')
  async getContainers(
    @Query('overdueOnly') overdueOnly: string,
    @Query('depositHeldOnly') depositHeldOnly: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getContainers(req.authContext!, {
      overdueOnly: overdueOnly === 'true',
      depositHeldOnly: depositHeldOnly === 'true',
      search,
    });
  }

  @Post('containers')
  async createContainer(
    @Body() body: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createContainer(req.authContext!, body);
  }

  @Put('containers/:id')
  async updateContainer(
    @Param('id') id: string,
    @Body() dto: UpdateMaritimeContainerDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateContainer(req.authContext!, id, dto);
  }

  // 8. Client Freight Inquiries Engine
  @Post('inquiries')
  async createInquiry(@Body() dto: CreateMaritimeInquiryDto, @Req() req: RequestWithAuth) {
    return this.freightService.createInquiry(req.authContext!, dto);
  }

  @Get('inquiries')
  async getInquiries(
    @Query('status') status: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getInquiries(req.authContext!, { status, search });
  }

  @Get('inquiries/:id')
  async getInquiryById(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.getInquiryById(req.authContext!, id);
  }

  @Post('inquiries/:id/convert-to-rfq')
  async convertInquiryToRfq(
    @Param('id') id: string,
    @Body('targetLineIds') targetLineIds: number[],
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.convertInquiryToRfq(req.authContext!, id, targetLineIds);
  }

  @Post('quotations/:id/convert-to-job')
  async autoConvertQuotationToJob(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.autoConvertQuotationToJob(req.authContext!, id);
  }

  // 9. Tenant Mail & Automation Settings (Outlook / IMAP / SMTP)
  @Get('mail-settings')
  async getMailSettings(@Req() req: RequestWithAuth) {
    return this.mailService.getMailSettings(req.authContext!);
  }

  @Post('mail-settings')
  async saveMailSettings(@Body() dto: Partial<MaritimeMailConfig>, @Req() req: RequestWithAuth) {
    return this.mailService.saveMailSettings(req.authContext!, dto);
  }

  @Post('mail-settings/test')
  async testMailConnection(@Body() dto: Partial<MaritimeMailConfig>, @Req() req: RequestWithAuth) {
    return this.mailService.testConnection(req.authContext!, dto);
  }

  @Post('mail-settings/send-test')
  async sendTestEmail(@Body('email') email: string, @Req() req: RequestWithAuth) {
    return this.mailService.sendTestEmail(req.authContext!, email);
  }

  @Post('mail-settings/sync-bids')
  async syncInboundBids(@Req() req: RequestWithAuth) {
    return this.mailService.syncInboundBids(req.authContext!, (text) =>
      this.freightService.parseCarrierEmailText(text),
    );
  }

  // 10. Automation Pipeline & Margin Rules Settings
  @Get('pipeline-settings')
  async getPipelineSettings(@Req() req: RequestWithAuth) {
    return this.freightService.getPipelineSettings(req.authContext!);
  }

  @Post('pipeline-settings')
  async savePipelineSettings(@Body() dto: any, @Req() req: RequestWithAuth) {
    return this.freightService.savePipelineSettings(req.authContext!, dto);
  }

  @Post('pipeline/trigger')
  async triggerPipeline(@Req() req: RequestWithAuth) {
    return this.freightService.processAutomatedPipelineForTenant(req.authContext!);
  }

  // --------------------------------------------------------------------------
  // Rate Management (Contract/Tariff Rate Cards)
  // --------------------------------------------------------------------------

  @Get('rate-cards')
  async listRateCards(
    @Query('polCode') polCode: string | undefined,
    @Query('podCode') podCode: string | undefined,
    @Query('containerType') containerType: string | undefined,
    @Query('status') status: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.listRateCards(req.authContext!, { polCode, podCode, containerType, status });
  }

  @Get('rate-cards/best')
  async findBestRate(
    @Query('polCode') polCode: string,
    @Query('podCode') podCode: string,
    @Query('containerType') containerType: string | undefined,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.findBestRate(req.authContext!, polCode, podCode, containerType);
  }

  @Post('rate-cards')
  async createRateCard(@Body() dto: CreateRateCardDto, @Req() req: RequestWithAuth) {
    return this.freightService.createRateCard(req.authContext!, dto);
  }

  @Post('bids/:id/save-as-rate-card')
  async createRateCardFromBid(
    @Param('id') id: string,
    @Body('validUntil') validUntil: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createRateCardFromBid(req.authContext!, id, validUntil);
  }

  @Put('rate-cards/:id/status')
  async updateRateCardStatus(
    @Param('id') id: string,
    @Body() dto: UpdateRateCardStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateRateCardStatus(req.authContext!, id, dto);
  }

  @Delete('rate-cards/:id')
  async deleteRateCard(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.deleteRateCard(req.authContext!, id);
  }

  // --------------------------------------------------------------------------
  // Customs Declarations (HS Codes & Duty Tracking)
  // --------------------------------------------------------------------------

  @Get('jobs/:jobId/customs-declarations')
  async listCustomsDeclarations(@Param('jobId') jobId: string, @Req() req: RequestWithAuth) {
    return this.freightService.listCustomsDeclarations(req.authContext!, jobId);
  }

  @Get('customs-declarations/:id')
  async getCustomsDeclarationDetail(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.getCustomsDeclarationDetail(req.authContext!, id);
  }

  @Post('jobs/:jobId/customs-declarations')
  async createCustomsDeclaration(
    @Param('jobId') jobId: string,
    @Body() dto: CreateCustomsDeclarationDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createCustomsDeclaration(req.authContext!, jobId, dto);
  }

  @Post('customs-declarations/:id/items')
  async addCustomsDeclarationItem(
    @Param('id') id: string,
    @Body() dto: CreateCustomsDeclarationItemDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.addCustomsDeclarationItem(req.authContext!, id, dto);
  }

  @Put('customs-declarations/:id/status')
  async updateCustomsDeclarationStatus(
    @Param('id') id: string,
    @Body() dto: UpdateCustomsDeclarationStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateCustomsDeclarationStatus(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // Freight Audit & Carrier Invoices (Reconciliation against Rate Cards)
  // --------------------------------------------------------------------------

  @Post('jobs/:jobId/carrier-invoices/preview')
  async previewCarrierInvoiceAudit(
    @Param('jobId') jobId: string,
    @Body() dto: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.previewCarrierInvoiceAudit(req.authContext!, jobId, dto);
  }

  @Get('carrier-invoices')
  async listAllCarrierInvoices(
    @Query('auditStatus') auditStatus: string,
    @Query('shippingLineId') shippingLineId: string,
    @Query('search') search: string,
    @Query('page') page: string,
    @Query('pageSize') pageSize: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.listAllCarrierInvoices(req.authContext!, {
      auditStatus,
      shippingLineId,
      search,
      page: page ? Number(page) : 1,
      pageSize: pageSize ? Number(pageSize) : 50,
    });
  }

  @Get('jobs/:jobId/carrier-invoices')
  async listJobCarrierInvoices(
    @Param('jobId') jobId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.listJobCarrierInvoices(req.authContext!, jobId);
  }

  @Post('jobs/:jobId/carrier-invoices')
  async createCarrierInvoice(
    @Param('jobId') jobId: string,
    @Body() dto: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createCarrierInvoice(req.authContext!, jobId, dto);
  }

  @Post('carrier-invoices/:id/override')
  async overrideCarrierInvoice(
    @Param('id') id: string,
    @Body() dto: { reason: string },
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.overrideCarrierInvoice(req.authContext!, id, dto);
  }

  @Post('carrier-invoices/:id/dispute')
  async createCarrierDispute(
    @Param('id') id: string,
    @Body() dto: { reason: string; disputedAmount?: number },
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createCarrierDispute(req.authContext!, id, dto);
  }

  @Post('carrier-disputes/:id/resolve')
  async resolveCarrierDispute(
    @Param('id') id: string,
    @Body() dto: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.resolveCarrierDispute(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // Cargo Insurance Policies & Claims
  // --------------------------------------------------------------------------
  @Post('jobs/:jobId/insurances')
  async createCargoInsurance(
    @Param('jobId') jobId: string,
    @Body() dto: CreateCargoInsuranceDto,
    @Req() req: RequestWithAuth,
  ) {
    dto.jobId = jobId;
    return this.freightService.createCargoInsurance(req.authContext!, dto);
  }

  @Patch('insurances/:id')
  async updateCargoInsurance(
    @Param('id') id: string,
    @Body() dto: UpdateCargoInsuranceDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateCargoInsurance(req.authContext!, id, dto);
  }

  @Post('insurances/:id/claim')
  async claimCargoInsurance(
    @Param('id') id: string,
    @Body() dto: ClaimCargoInsuranceDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.claimCargoInsurance(req.authContext!, id, dto);
  }

  @Get('jobs/:jobId/insurances')
  async getJobInsurances(
    @Param('jobId') jobId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getJobInsurances(req.authContext!, jobId);
  }

  // --------------------------------------------------------------------------
  // Transit & Bonded Warehouse Intake / Receipts
  // --------------------------------------------------------------------------
  @Post('jobs/:jobId/warehouse-receipts')
  async createWarehouseReceipt(
    @Param('jobId') jobId: string,
    @Body() dto: CreateWarehouseReceiptDto,
    @Req() req: RequestWithAuth,
  ) {
    dto.jobId = jobId;
    return this.freightService.createWarehouseReceipt(req.authContext!, dto);
  }

  @Post('warehouse-receipts/:id/release')
  async releaseWarehouseReceipt(
    @Param('id') id: string,
    @Body() dto: ReleaseWarehouseReceiptDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.releaseWarehouseReceipt(req.authContext!, id, dto);
  }

  @Get('jobs/:jobId/warehouse-receipts')
  async getJobWarehouseReceipts(
    @Param('jobId') jobId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getJobWarehouseReceipts(req.authContext!, jobId);
  }

  @Get('warehouse-receipts')
  async getWarehouseReceipts(
    @Query('status') status: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getWarehouseReceipts(req.authContext!, { status, search });
  }

  // --------------------------------------------------------------------------
  // Itemized Charges & Multi-Currency ROE
  // --------------------------------------------------------------------------
  @Get('quotations/:id/charges')
  async getQuotationCharges(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.getQuotationCharges(req.authContext!, id);
  }

  @Get('jobs/:id/charges')
  async getJobCharges(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.getJobCharges(req.authContext!, id);
  }

  @Put('jobs/:id/charges')
  async updateJobCharges(
    @Param('id') id: string,
    @Body() dto: UpdateJobChargesDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateJobCharges(req.authContext!, id, dto);
  }

  @Post('jobs/:id/calculate-forex')
  async calculateJobForex(
    @Param('id') id: string,
    @Body('actualRoe') actualRoe: number,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.calculateJobForexGainLoss(req.authContext!, id, Number(actualRoe));
  }

  // --------------------------------------------------------------------------
  // Consolidation & LCL Sub-Jobs
  // --------------------------------------------------------------------------
  @Get('jobs/:id/sub-jobs')
  async listConsolidationSubJobs(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.listConsolidationSubJobs(req.authContext!, id);
  }

  @Post('jobs/:id/sub-jobs')
  async createConsolidationSubJob(
    @Param('id') id: string,
    @Body() dto: any,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createConsolidationSubJob(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // Digital Shipment e-Folder / Document Binder
  // --------------------------------------------------------------------------
  @Get('jobs/:id/documents')
  async listJobDocuments(@Param('id') id: string, @Req() req: RequestWithAuth) {
    return this.freightService.listJobDocuments(req.authContext!, id);
  }

  @Post('jobs/:id/documents')
  async createJobDocument(
    @Param('id') id: string,
    @Body() dto: CreateJobDocumentDto,
    @Req() req: RequestWithAuth,
  ) {
    const uploadedBy = req.authContext?.username || `User #${req.authContext?.userId}`;
    return this.freightService.createJobDocument(req.authContext!, id, dto, uploadedBy);
  }

  @Delete('jobs/:id/documents/:docId')
  async deleteJobDocument(
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.deleteJobDocument(req.authContext!, id, docId);
  }

  // --------------------------------------------------------------------------
  // Overseas Agent Settlements & Profit Sharing (SOA)
  // --------------------------------------------------------------------------
  @Get('agent-settlements')
  async listAgentSettlements(
    @Query('agentId') agentId: string,
    @Query('status') status: string,
    @Query('search') search: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.listAgentSettlements(req.authContext!, { agentId, status, search });
  }

  @Post('agent-settlements')
  async createAgentSettlement(
    @Body() dto: CreateAgentSettlementDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createAgentSettlement(req.authContext!, dto);
  }

  @Patch('agent-settlements/:id/status')
  async updateAgentSettlementStatus(
    @Param('id') id: string,
    @Body() dto: UpdateAgentSettlementStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateAgentSettlementStatus(req.authContext!, id, dto);
  }

  @Get('agent-settlements/agents/:agentId/soa')
  async getAgentStatementOfAccount(
    @Param('agentId') agentId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.getAgentStatementOfAccount(req.authContext!, agentId);
  }

  // --------------------------------------------------------------------------
  // Inland Trucking Trips & Container Dispatch
  // --------------------------------------------------------------------------
  @Get('inland-trucking-trips')
  async listInlandTruckingTrips(
    @Query('jobId') jobId: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.listInlandTruckingTrips(req.authContext!, jobId);
  }

  @Post('inland-trucking-trips')
  async createInlandTruckingTrip(
    @Body() dto: CreateInlandTruckingTripDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.createInlandTruckingTrip(req.authContext!, dto);
  }

  @Patch('inland-trucking-trips/:id/status')
  async updateInlandTruckingTripStatus(
    @Param('id') id: string,
    @Body() dto: UpdateInlandTruckingTripStatusDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.updateInlandTruckingTripStatus(req.authContext!, id, dto);
  }

  // --------------------------------------------------------------------------
  // Carrier Live Tracking Hub & API Events
  // --------------------------------------------------------------------------
  @Post('carrier-tracking/sync')
  async syncCarrierTracking(
    @Body() dto: CarrierTrackingSyncDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.syncCarrierTracking(req.authContext!, dto.carrierCode, dto.trackingNumber);
  }

  @Post('carrier-tracking/events')
  async recordCarrierApiEvent(
    @Body() dto: CarrierTrackingEventDto,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.recordCarrierApiEvent(req.authContext!, dto);
  }

  @Get('carrier-tracking/:trackingNumber/events')
  async listCarrierApiEvents(
    @Param('trackingNumber') trackingNumber: string,
    @Req() req: RequestWithAuth,
  ) {
    return this.freightService.listCarrierApiEvents(req.authContext!, trackingNumber);
  }
}
