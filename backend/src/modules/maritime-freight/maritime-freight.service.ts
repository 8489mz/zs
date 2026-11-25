import { assertBusinessAccountingDate } from '../accounting/accounting-boundaries';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { resolveFxRate } from '../accounting/fx-rate-resolution';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { CreateMaritimeInquiryDto } from './dto/create-inquiry.dto';
import { CreateMaritimeRfqDto } from './dto/create-rfq.dto';
import { SubmitMaritimeBidDto } from './dto/submit-bid.dto';
import { CreateMaritimeQuotationDto } from './dto/create-quotation.dto';
import { CreateMaritimeJobDto } from './dto/create-job.dto';
import { UpdateMaritimeContainerDto } from './dto/update-container.dto';
import { CreateRateCardDto, UpdateRateCardStatusDto } from './dto/rate-card.dto';
import {
  CreateCustomsDeclarationDto,
  CreateCustomsDeclarationItemDto,
  UpdateCustomsDeclarationStatusDto,
} from './dto/customs-declaration.dto';
import { CreateCargoInsuranceDto, UpdateCargoInsuranceDto, ClaimCargoInsuranceDto } from './dto/cargo-insurance.dto';
import { CreateWarehouseReceiptDto, ReleaseWarehouseReceiptDto } from './dto/warehouse-receipt.dto';
import { ShipmentMilestoneKey, MaritimePipelineConfig } from './maritime-freight.types';
import { MaritimeMailService } from './maritime-mail.service';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { UpdateJobChargesDto } from './dto/itemized-charges.dto';
import { CreateJobDocumentDto } from './dto/job-document.dto';
import { CreateAgentSettlementDto, UpdateAgentSettlementStatusDto } from './dto/agent-settlement.dto';
import { ReleaseDeliveryOrderDto } from './dto/release-delivery-order.dto';
import { CreateInlandTruckingTripDto, UpdateInlandTruckingTripStatusDto } from './dto/inland-trucking.dto';
import { CarrierTrackingEventDto } from './dto/carrier-tracking.dto';
import { MaritimeFreightMasterDataService } from './maritime-freight-master-data.service';
import { MaritimeFreightRfqBidsService } from './maritime-freight-rfq-bids.service';
import { MaritimeFreightQuotationsService } from './maritime-freight-quotations.service';
import { MaritimeFreightRateCardsService } from './maritime-freight-rate-cards.service';
import { MaritimeFreightCustomsService } from './maritime-freight-customs.service';
import { MaritimeFreightInsuranceWarehouseService } from './maritime-freight-insurance-warehouse.service';
import { MaritimeFreightAgentSettlementsService } from './maritime-freight-agent-settlements.service';
import { MaritimeFreightTrackingService } from './maritime-freight-tracking.service';
import { MaritimeFreightPublicPortalService } from './maritime-freight-public-portal.service';
import { MaritimeFreightPipelineService } from './maritime-freight-pipeline.service';
import { MaritimeFreightInquiriesService } from './maritime-freight-inquiries.service';
import { MaritimeFreightJobsCoreService } from './maritime-freight-jobs-core.service';
import { MaritimeFreightJobsContainersService } from './maritime-freight-jobs-containers.service';
import { MaritimeFreightInvoicingService } from './maritime-freight-invoicing.service';
import { MaritimeFreightConsolidationDocumentsService } from './maritime-freight-consolidation-documents.service';
import { MaritimeFreightTruckingService } from './maritime-freight-trucking.service';
import { MaritimeFreightJobCloseService } from './maritime-freight-job-close.service';
import { MaritimeFreightJobsMilestonesService } from './maritime-freight-jobs-milestones.service';
import { MaritimeFreightCarrierInvoicesService } from './maritime-freight-carrier-invoices.service';
import { MaritimeFreightCarrierDisputesService } from './maritime-freight-carrier-disputes.service';

@Injectable()
export class MaritimeFreightService {
  private readonly logger = new Logger(MaritimeFreightService.name);

  private readonly masterDataService: MaritimeFreightMasterDataService;
  private readonly rfqBidsService: MaritimeFreightRfqBidsService;
  private readonly quotationsService: MaritimeFreightQuotationsService;
  private readonly rateCardsService: MaritimeFreightRateCardsService;
  private readonly customsService: MaritimeFreightCustomsService;
  private readonly insuranceWarehouseService: MaritimeFreightInsuranceWarehouseService;
  private readonly agentSettlementsService: MaritimeFreightAgentSettlementsService;
  private readonly trackingService: MaritimeFreightTrackingService;
  private readonly publicPortalService: MaritimeFreightPublicPortalService;
  private readonly pipelineService: MaritimeFreightPipelineService;
  private readonly inquiriesService: MaritimeFreightInquiriesService;
  private readonly jobsCoreService: MaritimeFreightJobsCoreService;
  private readonly jobsContainersService: MaritimeFreightJobsContainersService;
  private readonly invoicingService: MaritimeFreightInvoicingService;
  private readonly consolidationDocumentsService: MaritimeFreightConsolidationDocumentsService;
  private readonly truckingService: MaritimeFreightTruckingService;
  private readonly jobCloseService: MaritimeFreightJobCloseService;
  private readonly jobsMilestonesService: MaritimeFreightJobsMilestonesService;
  private readonly carrierInvoicesService: MaritimeFreightCarrierInvoicesService;
  private readonly carrierDisputesService: MaritimeFreightCarrierDisputesService;

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly maritimeMailService: MaritimeMailService,
    private readonly whatsAppGatewayService: WhatsAppGatewayService,
    private readonly accountingPosting: AccountingPostingService,
  ) {
    this.masterDataService = new MaritimeFreightMasterDataService({
      db: this.db,
    });
    this.rfqBidsService = new MaritimeFreightRfqBidsService({
      db: this.db,
      maritimeMailService: this.maritimeMailService,
    });
    this.quotationsService = new MaritimeFreightQuotationsService({
      db: this.db,
      resolveFreightExchangeRate: this.resolveFreightExchangeRate.bind(this),
    });
    this.rateCardsService = new MaritimeFreightRateCardsService({
      db: this.db,
    });
    this.customsService = new MaritimeFreightCustomsService({
      db: this.db,
      accountingPosting: this.accountingPosting,
    });
    this.insuranceWarehouseService = new MaritimeFreightInsuranceWarehouseService({
      db: this.db,
    });
    this.agentSettlementsService = new MaritimeFreightAgentSettlementsService({
      db: this.db,
      resolveFreightExchangeRate: this.resolveFreightExchangeRate.bind(this),
    });
    this.trackingService = new MaritimeFreightTrackingService({
      db: this.db,
    });
    this.publicPortalService = new MaritimeFreightPublicPortalService({
      db: this.db,
    });
    this.pipelineService = new MaritimeFreightPipelineService({
      db: this.db,
      whatsAppGatewayService: this.whatsAppGatewayService,
      awardBid: this.rfqBidsService.awardBid.bind(this.rfqBidsService),
      createQuotation: this.quotationsService.createQuotation.bind(this.quotationsService),
      resolveAutoQuoteExchangeRate: this.quotationsService.resolveAutoQuoteExchangeRate.bind(this.quotationsService),
    });
    this.inquiriesService = new MaritimeFreightInquiriesService({
      db: this.db,
      getTenantPipelineConfig: this.pipelineService.getTenantPipelineConfig.bind(this.pipelineService),
    });
    this.jobsCoreService = new MaritimeFreightJobsCoreService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      resolveTenantConfiguredTaxRate: this.quotationsService.resolveTenantConfiguredTaxRate.bind(
        this.quotationsService,
      ),
      resolveFreightExchangeRate: this.resolveFreightExchangeRate.bind(this),
      resolveAccountId: this.resolveAccountId.bind(this),
      assertMaritimeJournalPeriodOpen: this.assertMaritimeJournalPeriodOpen.bind(this),
    });
    this.jobsContainersService = new MaritimeFreightJobsContainersService({
      db: this.db,
      postContainerDepositJournal: this.jobsCoreService.postContainerDepositJournal.bind(this.jobsCoreService),
    });
    this.invoicingService = new MaritimeFreightInvoicingService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      getJobById: this.jobsCoreService.getJobById.bind(this.jobsCoreService),
      resolveFreightExchangeRate: this.resolveFreightExchangeRate.bind(this),
      resolveAccountId: this.resolveAccountId.bind(this),
      assertMaritimeJournalPeriodOpen: this.assertMaritimeJournalPeriodOpen.bind(this),
    });
    this.consolidationDocumentsService = new MaritimeFreightConsolidationDocumentsService({
      db: this.db,
      createJob: this.jobsCoreService.createJob.bind(this.jobsCoreService),
    });
    this.truckingService = new MaritimeFreightTruckingService({
      db: this.db,
      assertRoadProofOfDelivery: this.jobsCoreService.assertRoadProofOfDelivery.bind(this.jobsCoreService),
    });
    this.jobCloseService = new MaritimeFreightJobCloseService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      assertJobCanClose: this.jobsCoreService.assertJobCanClose.bind(this.jobsCoreService),
      assertRoadProofOfDelivery: this.jobsCoreService.assertRoadProofOfDelivery.bind(this.jobsCoreService),
      assertUniqueMasterBl: this.jobsCoreService.assertUniqueMasterBl.bind(this.jobsCoreService),
      syncConsolidationParentTotals: this.jobsCoreService.syncConsolidationParentTotals.bind(this.jobsCoreService),
      getJobById: this.jobsCoreService.getJobById.bind(this.jobsCoreService),
      resolveTenantConfiguredTaxRate: this.quotationsService.resolveTenantConfiguredTaxRate.bind(
        this.quotationsService,
      ),
      hasPostedCloseJournal: this.customsService.hasPostedCloseJournal.bind(this.customsService),
      resolveMaritimeAccountIdOn: this.customsService.resolveMaritimeAccountIdOn.bind(this.customsService),
    });
    this.jobsMilestonesService = new MaritimeFreightJobsMilestonesService({
      db: this.db,
      whatsAppGatewayService: this.whatsAppGatewayService,
      assertJobCanClose: this.jobsCoreService.assertJobCanClose.bind(this.jobsCoreService),
      assertRoadProofOfDelivery: this.jobsCoreService.assertRoadProofOfDelivery.bind(this.jobsCoreService),
      getJobById: this.jobsCoreService.getJobById.bind(this.jobsCoreService),
      postStoredMoneyAtClose: this.jobCloseService.postStoredMoneyAtClose.bind(this.jobCloseService),
    });
    this.carrierInvoicesService = new MaritimeFreightCarrierInvoicesService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      getJobById: this.jobsCoreService.getJobById.bind(this.jobsCoreService),
      mapRateCardRow: this.rateCardsService.mapRateCardRow.bind(this.rateCardsService),
      resolveFreightExchangeRate: this.resolveFreightExchangeRate.bind(this),
      resolveAccountId: this.resolveAccountId.bind(this),
      assertMaritimeJournalPeriodOpen: this.assertMaritimeJournalPeriodOpen.bind(this),
    });
    this.carrierDisputesService = new MaritimeFreightCarrierDisputesService({
      db: this.db,
      accountingPosting: this.accountingPosting,
      getJobById: this.jobsCoreService.getJobById.bind(this.jobsCoreService),
    });
  }

  private async resolveTenantConfiguredTaxRate(queryable: Kysely<Database>, tenantId: string): Promise<unknown> {
    return this.quotationsService.resolveTenantConfiguredTaxRate(queryable, tenantId);
  }

  private async assertJobCanClose(tenantId: string, jobId: string) {
    return this.jobsCoreService.assertJobCanClose(tenantId, jobId);
  }

  private async assertRoadProofOfDelivery(tenantId: string, jobId: string, bookingNumber: string | null | undefined) {
    return this.jobsCoreService.assertRoadProofOfDelivery(tenantId, jobId, bookingNumber);
  }

  private async assertUniqueMasterBl(
    tenantId: string,
    mbl: string | null | undefined,
    jobId?: string,
    parentJobId?: string | null,
    trx?: any,
  ) {
    return this.jobsCoreService.assertUniqueMasterBl(tenantId, mbl, jobId, parentJobId, trx);
  }

  private async postContainerDepositJournal(
    trx: any,
    tenantId: string,
    containerId: string,
    amount: number,
    currency: string,
    event: 'open' | 'refund' | 'forfeit',
    userId: number,
  ) {
    return this.jobsCoreService.postContainerDepositJournal(
      trx,
      tenantId,
      containerId,
      amount,
      currency,
      event,
      userId,
    );
  }

  private async resolveFreightExchangeRate(
    tenantId: string,
    currency: string | undefined,
    suppliedRate?: number,
  ): Promise<number> {
    // INV-FX-RATE-RESOLUTION-SINGLE-RESOLVER: one shared resolver for
    // every maritime path. The base currency is now derived strictly
    // through tenantBaseCurrency: a settings/rate mismatch fails
    // closed instead of silently defaulting to EGP. The read still
    // uses this.db, exactly as before — callers inside a transaction
    // see committed rates only.
    return resolveFxRate(this.db, tenantId, currency, { suppliedRate });
  }

  async resolveAutoQuoteExchangeRate(tenantId: string, bidCurrency: string): Promise<number> {
    return this.quotationsService.resolveAutoQuoteExchangeRate(tenantId, bidCurrency);
  }

  async ensureDefaultMasterData(tenantId: string): Promise<{
    portsAdded: number;
    linesAdded: number;
    agentsAdded: number;
    airlinesAdded: number;
    airportsAdded: number;
    truckingAdded: number;
    dryPortsAdded: number;
  }> {
    return this.masterDataService.ensureDefaultMasterData(tenantId);
  }

  async seedDefaultMasterData(auth: AuthContext) {
    return this.masterDataService.seedDefaultMasterData(auth);
  }

  async getCounts(auth: AuthContext) {
    return this.masterDataService.getCounts(auth);
  }

  async getPorts(auth: AuthContext) {
    return this.masterDataService.getPorts(auth);
  }

  async createPort(
    auth: AuthContext,
    data: { code: string; nameAr: string; nameEn: string; countryCode: string; countryName: string },
  ) {
    return this.masterDataService.createPort(auth, data);
  }

  async getShippingLines(
    auth: AuthContext,
    filters?: { carrierType?: string; tradeLane?: string; countryCode?: string; search?: string },
  ) {
    return this.masterDataService.getShippingLines(auth, filters);
  }

  async createShippingLine(
    auth: AuthContext,
    data: {
      code: string;
      nameAr: string;
      nameEn?: string;
      carrierType?: 'shipping_line' | 'overseas_agent';
      tradeLanes?: string;
      countryName?: string;
      countryCode?: string;
      cityName?: string;
      contactPerson?: string;
      email?: string;
      rfqEmail?: string;
      bookingEmail?: string;
      phone?: string;
      whatsapp?: string;
      wechat?: string;
      servicesOffered?: string;
      supportedPorts?: string;
      notes?: string;
    },
  ) {
    return this.masterDataService.createShippingLine(auth, data);
  }

  getReferenceData() {
    return this.masterDataService.getReferenceData();
  }

  async importCarriersBulk(auth: AuthContext, items: any[]) {
    return this.masterDataService.importCarriersBulk(auth, items);
  }

  async updateShippingLine(auth: AuthContext, id: string, data: any) {
    return this.masterDataService.updateShippingLine(auth, id, data);
  }

  async deleteShippingLine(auth: AuthContext, id: string) {
    return this.masterDataService.deleteShippingLine(auth, id);
  }

  async createInquiry(auth: AuthContext, dto: CreateMaritimeInquiryDto) {
    return this.inquiriesService.createInquiry(auth, dto);
  }

  async getInquiries(auth: AuthContext, filters?: { status?: string; search?: string }) {
    return this.inquiriesService.getInquiries(auth, filters);
  }

  async getInquiryById(auth: AuthContext, id: string) {
    return this.inquiriesService.getInquiryById(auth, id);
  }

  async convertInquiryToRfq(auth: AuthContext, inquiryId: string, targetLineIds?: number[]) {
    return this.inquiriesService.convertInquiryToRfq(auth, inquiryId, targetLineIds);
  }

  async createRfq(auth: AuthContext, dto: CreateMaritimeRfqDto) {
    return this.inquiriesService.createRfq(auth, dto);
  }

  async getRfqs(auth: AuthContext, filters?: { status?: string; search?: string }) {
    return this.inquiriesService.getRfqs(auth, filters);
  }

  async getRfqById(auth: AuthContext, id: string) {
    return this.inquiriesService.getRfqById(auth, id);
  }

  async dispatchRfqEmails(auth: AuthContext, rfqId: string, customLineIds?: number[]) {
    return this.rfqBidsService.dispatchRfqEmails(auth, rfqId, customLineIds);
  }

  async submitBid(auth: AuthContext, dto: SubmitMaritimeBidDto) {
    return this.rfqBidsService.submitBid(auth, dto);
  }

  async awardBid(auth: AuthContext, bidId: string) {
    return this.rfqBidsService.awardBid(auth, bidId);
  }

  parseCarrierEmailText(rawText: string) {
    return this.rfqBidsService.parseCarrierEmailText(rawText);
  }

  parseCarrierBookingText(rawText: string) {
    return this.rfqBidsService.parseCarrierBookingText(rawText);
  }

  async createQuotation(auth: AuthContext, dto: CreateMaritimeQuotationDto) {
    return this.quotationsService.createQuotation(auth, dto);
  }

  async getQuotations(auth: AuthContext, filters?: { status?: string; search?: string }) {
    return this.quotationsService.getQuotations(auth, filters);
  }

  async updateQuotationStatus(auth: AuthContext, id: string, status: 'approved' | 'rejected' | 'sent') {
    return this.quotationsService.updateQuotationStatus(auth, id, status);
  }

  async syncConsolidationParentTotals(
    queryable: any,
    tenantId: string,
    parentJobId: string | number,
  ): Promise<{ synced: boolean; grossWeightKg: number; totalCbm: number; packageCount: number }> {
    return this.jobsCoreService.syncConsolidationParentTotals(queryable, tenantId, parentJobId);
  }

  async createJob(auth: AuthContext, dto: CreateMaritimeJobDto) {
    return this.jobsCoreService.createJob(auth, dto);
  }

  async autoConvertQuotationToJob(auth: AuthContext, quotationId: string) {
    return this.jobsCoreService.autoConvertQuotationToJob(auth, quotationId);
  }

  async getJobs(auth: AuthContext, filters?: { status?: string; search?: string; milestone?: string }) {
    return this.jobsCoreService.getJobs(auth, filters);
  }

  async getJobById(auth: AuthContext, id: string) {
    return this.jobsCoreService.getJobById(auth, id);
  }

  async updateJob(auth: AuthContext, id: string, dto: any) {
    return this.jobCloseService.updateJob(auth, id, dto);
  }

  async addJobMilestone(
    auth: AuthContext,
    jobId: string,
    milestoneKey: ShipmentMilestoneKey,
    notes?: string,
    location?: string,
  ) {
    return this.jobsMilestonesService.addJobMilestone(auth, jobId, milestoneKey, notes, location);
  }

  async releaseDeliveryOrder(auth: AuthContext, jobId: string, dto?: ReleaseDeliveryOrderDto) {
    return this.jobsMilestonesService.releaseDeliveryOrder(auth, jobId, dto);
  }

  async sendMilestoneWhatsApp(
    auth: AuthContext,
    jobId: string,
    milestoneKey: ShipmentMilestoneKey,
    targetPhone?: string,
  ) {
    return this.jobsMilestonesService.sendMilestoneWhatsApp(auth, jobId, milestoneKey, targetPhone);
  }

  async getMilestoneWhatsAppMessage(auth: AuthContext, jobId: string, milestoneKey: ShipmentMilestoneKey) {
    return this.jobsMilestonesService.getMilestoneWhatsAppMessage(auth, jobId, milestoneKey);
  }

  async getContainers(
    auth: AuthContext,
    filters?: { overdueOnly?: boolean; depositHeldOnly?: boolean; search?: string },
  ) {
    return this.jobsContainersService.getContainers(auth, filters);
  }

  async syncDemurrageChargeForContainer(
    tenantId: string,
    jobId: string | number,
    containerNumber: string,
    amountUsd: number,
  ): Promise<'created' | 'updated' | 'skipped'> {
    return this.jobsContainersService.syncDemurrageChargeForContainer(tenantId, jobId, containerNumber, amountUsd);
  }

  async updateContainer(auth: AuthContext, containerId: string, dto: UpdateMaritimeContainerDto) {
    return this.jobsContainersService.updateContainer(auth, containerId, dto);
  }

  async createContainer(auth: AuthContext, dto: any) {
    return this.jobsContainersService.createContainer(auth, dto);
  }

  async getPublicTrackingByToken(token: string) {
    return this.publicPortalService.getPublicTrackingByToken(token);
  }

  async getPublicRfqForQuote(rfqId: string, token: string, carrierCode?: string) {
    return this.publicPortalService.getPublicRfqForQuote(rfqId, token, carrierCode);
  }

  async submitPublicCarrierBid(rfqId: string, dto: any) {
    return this.publicPortalService.submitPublicCarrierBid(rfqId, dto);
  }

  private async resolveAccountId(tenantId: string, code: string, fallbackCode?: string): Promise<number | null> {
    const acc = await this.db
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (acc) return Number(acc.id);
    if (fallbackCode) {
      const fallback = await this.db
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('code', '=', fallbackCode)
        .where('is_active', '=', true)
        .executeTakeFirst();
      if (fallback) return Number(fallback.id);
    }
    return null;
  }

  /**
   * Fiscal period lock check shared by every ad-hoc journal posted in this file outside the
   * canonical accounting-posting service. Same string-date comparison as insertPostedJournal.
   */
  private async assertMaritimeJournalPeriodOpen(trx: any, tenantId: string, entryDate: Date): Promise<void> {
    await assertBusinessAccountingDate(trx, tenantId, entryDate);
  }

  async issueJobSalesInvoice(
    auth: AuthContext,
    jobId: string,
    dto?: { amount?: number; notes?: string; exchangeRate?: number; currency?: string },
  ) {
    return this.invoicingService.issueJobSalesInvoice(auth, jobId, dto);
  }

  async recordJobExpenseVoucher(
    auth: AuthContext,
    jobId: string,
    dto: {
      amount: number;
      expenseType?: 'carrier' | 'port' | 'other';
      paymentMethod?: 'payable' | 'cash' | 'bank';
      supplierId?: number;
      supplierName?: string;
      description?: string;
      currency?: string;
      exchangeRate?: number;
    },
  ) {
    return this.invoicingService.recordJobExpenseVoucher(auth, jobId, dto);
  }

  async getJobFinancialLedger(auth: AuthContext, jobId: string, pagination?: { page?: number; pageSize?: number }) {
    return this.invoicingService.getJobFinancialLedger(auth, jobId, pagination);
  }

  async settleJobFromCustomerBalance(
    auth: AuthContext,
    jobId: string,
    dto?: { amount?: number; exchangeRate?: number },
  ) {
    return this.invoicingService.settleJobFromCustomerBalance(auth, jobId, dto);
  }

  async getCustomerActiveJobs(auth: AuthContext, customerId: string | number) {
    return this.invoicingService.getCustomerActiveJobs(auth, customerId);
  }

  async getTenantPipelineConfig(tenantId: string): Promise<MaritimePipelineConfig> {
    return this.pipelineService.getTenantPipelineConfig(tenantId);
  }

  async getPipelineSettings(auth: AuthContext): Promise<MaritimePipelineConfig> {
    return this.pipelineService.getPipelineSettings(auth);
  }

  async savePipelineSettings(auth: AuthContext, dto: Partial<MaritimePipelineConfig>): Promise<MaritimePipelineConfig> {
    return this.pipelineService.savePipelineSettings(auth, dto);
  }

  async processAutomatedPipelineForTenant(auth: AuthContext): Promise<{
    processedRfqs: number;
    awardedCount: number;
    quotesGenerated: number;
    details: string[];
  }> {
    return this.pipelineService.processAutomatedPipelineForTenant(auth);
  }

  private mapRateCardRow(r: any) {
    return this.rateCardsService.mapRateCardRow(r);
  }

  async listRateCards(
    auth: AuthContext,
    filters?: { polCode?: string; podCode?: string; containerType?: string; status?: string; transportMode?: string },
  ) {
    return this.rateCardsService.listRateCards(auth, filters);
  }

  async findBestRate(auth: AuthContext, polCode: string, podCode: string, containerType?: string) {
    return this.rateCardsService.findBestRate(auth, polCode, podCode, containerType);
  }

  async createRateCard(auth: AuthContext, dto: CreateRateCardDto) {
    return this.rateCardsService.createRateCard(auth, dto);
  }

  async createRateCardFromBid(auth: AuthContext, bidId: string, validUntil: string) {
    return this.rateCardsService.createRateCardFromBid(auth, bidId, validUntil);
  }

  async updateRateCardStatus(auth: AuthContext, id: string, dto: UpdateRateCardStatusDto) {
    return this.rateCardsService.updateRateCardStatus(auth, id, dto);
  }

  async deleteRateCard(auth: AuthContext, id: string) {
    return this.rateCardsService.deleteRateCard(auth, id);
  }

  async listCustomsDeclarations(auth: AuthContext, jobId: string) {
    return this.customsService.listCustomsDeclarations(auth, jobId);
  }

  async getCustomsDeclarationDetail(auth: AuthContext, id: string) {
    return this.customsService.getCustomsDeclarationDetail(auth, id);
  }

  async createCustomsDeclaration(auth: AuthContext, jobId: string, dto: CreateCustomsDeclarationDto) {
    return this.customsService.createCustomsDeclaration(auth, jobId, dto);
  }

  async addCustomsDeclarationItem(auth: AuthContext, declarationId: string, dto: CreateCustomsDeclarationItemDto) {
    return this.customsService.addCustomsDeclarationItem(auth, declarationId, dto);
  }

  async updateCustomsDeclarationStatus(auth: AuthContext, id: string, dto: UpdateCustomsDeclarationStatusDto) {
    return this.customsService.updateCustomsDeclarationStatus(auth, id, dto);
  }

  async previewCarrierInvoiceAudit(
    auth: AuthContext,
    jobId: string,
    dto: {
      invoicedTotal: number;
      oceanFreight?: number;
      thcCharges?: number;
      bafCharges?: number;
      otherCharges?: number;
      shippingLineId?: string | number;
      containerType?: string;
      currency?: string;
    },
  ) {
    return this.carrierInvoicesService.previewCarrierInvoiceAudit(auth, jobId, dto);
  }

  async createCarrierInvoice(
    auth: AuthContext,
    jobId: string,
    dto: {
      invoiceNumber: string;
      invoiceDate?: string;
      totalInvoicedAmount: number;
      currency?: string;
      exchangeRate?: number;
      oceanFreight?: number;
      thcCharges?: number;
      bafCharges?: number;
      detentionDemurrage?: number;
      otherCharges?: number;
      shippingLineId?: string | number;
      carrierName?: string;
      notes?: string;
      allowOverride?: boolean;
      overrideReason?: string;
    },
  ) {
    return this.carrierInvoicesService.createCarrierInvoice(auth, jobId, dto);
  }

  async overrideCarrierInvoice(auth: AuthContext, invoiceId: string, dto: { reason: string }) {
    return this.carrierInvoicesService.overrideCarrierInvoice(auth, invoiceId, dto);
  }

  async createCarrierDispute(auth: AuthContext, invoiceId: string, dto: { reason: string; disputedAmount?: number }) {
    return this.carrierDisputesService.createCarrierDispute(auth, invoiceId, dto);
  }

  async resolveCarrierDispute(
    auth: AuthContext,
    disputeId: string,
    dto: {
      status: 'accepted' | 'rejected' | 'partially_accepted';
      resolutionNotes?: string;
      creditNoteNumber?: string;
      creditNoteAmount?: number;
    },
  ) {
    return this.carrierDisputesService.resolveCarrierDispute(auth, disputeId, dto);
  }

  async listJobCarrierInvoices(auth: AuthContext, jobId: string) {
    return this.carrierDisputesService.listJobCarrierInvoices(auth, jobId);
  }

  async listAllCarrierInvoices(
    auth: AuthContext,
    filters?: {
      auditStatus?: string;
      shippingLineId?: string;
      search?: string;
      page?: number;
      pageSize?: number;
    },
  ) {
    return this.carrierDisputesService.listAllCarrierInvoices(auth, filters);
  }

  async createCargoInsurance(auth: AuthContext, dto: CreateCargoInsuranceDto) {
    return this.insuranceWarehouseService.createCargoInsurance(auth, dto);
  }

  async updateCargoInsurance(auth: AuthContext, id: string | number, dto: UpdateCargoInsuranceDto) {
    return this.insuranceWarehouseService.updateCargoInsurance(auth, id, dto);
  }

  async claimCargoInsurance(auth: AuthContext, id: string | number, dto: ClaimCargoInsuranceDto) {
    return this.insuranceWarehouseService.claimCargoInsurance(auth, id, dto);
  }

  async getJobInsurances(auth: AuthContext, jobId: string | number) {
    return this.insuranceWarehouseService.getJobInsurances(auth, jobId);
  }

  async createWarehouseReceipt(auth: AuthContext, dto: CreateWarehouseReceiptDto) {
    return this.insuranceWarehouseService.createWarehouseReceipt(auth, dto);
  }

  async releaseWarehouseReceipt(auth: AuthContext, id: string | number, dto: ReleaseWarehouseReceiptDto) {
    return this.insuranceWarehouseService.releaseWarehouseReceipt(auth, id, dto);
  }

  async getJobWarehouseReceipts(auth: AuthContext, jobId: string | number) {
    return this.insuranceWarehouseService.getJobWarehouseReceipts(auth, jobId);
  }

  async getWarehouseReceipts(auth: AuthContext, filters?: { status?: string; search?: string }) {
    return this.insuranceWarehouseService.getWarehouseReceipts(auth, filters);
  }

  async getQuotationCharges(auth: AuthContext, quotationId: string | number) {
    return this.jobCloseService.getQuotationCharges(auth, quotationId);
  }

  async getJobCharges(auth: AuthContext, jobId: string | number) {
    return this.jobCloseService.getJobCharges(auth, jobId);
  }

  async updateJobCharges(auth: AuthContext, jobId: string | number, dto: UpdateJobChargesDto) {
    return this.jobCloseService.updateJobCharges(auth, jobId, dto);
  }

  async calculateJobForexGainLoss(auth: AuthContext, jobId: string | number, actualRoe: number) {
    return this.jobCloseService.calculateJobForexGainLoss(auth, jobId, actualRoe);
  }

  private async resolveMaritimeAccountIdOn(
    queryable: any,
    tenantId: string,
    code: string,
    fallbackCode?: string,
  ): Promise<number | null> {
    return this.customsService.resolveMaritimeAccountIdOn(queryable, tenantId, code, fallbackCode);
  }

  private async hasPostedCloseJournal(
    queryable: any,
    tenantId: string,
    sourceType: string,
    sourceId: number,
  ): Promise<boolean> {
    return this.customsService.hasPostedCloseJournal(queryable, tenantId, sourceType, sourceId);
  }

  async postStoredMoneyAtClose(
    queryable: any,
    tenantId: string,
    jobId: string | number,
    auth: AuthContext,
  ): Promise<{
    posted: boolean;
    journalEntryIds: number[];
    forex: { posted: boolean; amount: number; reason: string | null };
    trucking: { postedCount: number; amount: number };
    insurance: { postedCount: number; amount: number };
  }> {
    return this.jobCloseService.postStoredMoneyAtClose(queryable, tenantId, jobId, auth);
  }

  async listConsolidationSubJobs(auth: AuthContext, parentJobId: string | number) {
    return this.consolidationDocumentsService.listConsolidationSubJobs(auth, parentJobId);
  }

  async createConsolidationSubJob(auth: AuthContext, parentJobId: string | number, dto: Partial<CreateMaritimeJobDto>) {
    return this.consolidationDocumentsService.createConsolidationSubJob(auth, parentJobId, dto);
  }

  async listJobDocuments(auth: AuthContext, jobId: string | number) {
    return this.consolidationDocumentsService.listJobDocuments(auth, jobId);
  }

  async createJobDocument(auth: AuthContext, jobId: string | number, dto: CreateJobDocumentDto, uploadedBy?: string) {
    return this.consolidationDocumentsService.createJobDocument(auth, jobId, dto, uploadedBy);
  }

  async deleteJobDocument(auth: AuthContext, jobId: string | number, docId: string | number) {
    return this.consolidationDocumentsService.deleteJobDocument(auth, jobId, docId);
  }

  async listAgentSettlements(auth: AuthContext, filters?: { agentId?: string; status?: string; search?: string }) {
    return this.agentSettlementsService.listAgentSettlements(auth, filters);
  }

  async createAgentSettlement(auth: AuthContext, dto: CreateAgentSettlementDto) {
    return this.agentSettlementsService.createAgentSettlement(auth, dto);
  }

  async updateAgentSettlementStatus(auth: AuthContext, id: string | number, dto: UpdateAgentSettlementStatusDto) {
    return this.agentSettlementsService.updateAgentSettlementStatus(auth, id, dto);
  }

  async getAgentStatementOfAccount(auth: AuthContext, agentId: string | number) {
    return this.agentSettlementsService.getAgentStatementOfAccount(auth, agentId);
  }

  async listInlandTruckingTrips(auth: AuthContext, jobId?: string | number) {
    return this.truckingService.listInlandTruckingTrips(auth, jobId);
  }

  async createInlandTruckingTrip(auth: AuthContext, dto: CreateInlandTruckingTripDto) {
    return this.truckingService.createInlandTruckingTrip(auth, dto);
  }

  async updateInlandTruckingTripStatus(auth: AuthContext, id: string | number, dto: UpdateInlandTruckingTripStatusDto) {
    return this.truckingService.updateInlandTruckingTripStatus(auth, id, dto);
  }

  async syncCarrierTracking(auth: AuthContext, carrierCode: string, trackingNumber: string) {
    return this.trackingService.syncCarrierTracking(auth, carrierCode, trackingNumber);
  }

  async recordCarrierApiEvent(auth: AuthContext, dto: CarrierTrackingEventDto) {
    return this.trackingService.recordCarrierApiEvent(auth, dto);
  }

  async listCarrierApiEvents(auth: AuthContext, trackingNumber: string) {
    return this.trackingService.listCarrierApiEvents(auth, trackingNumber);
  }
}
