import { calculateCarrierCreditBaseAmount } from './engines/carrier-credit.engine';
import { assertBusinessAccountingDate } from '../accounting/accounting-boundaries';
import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { ensureDomainSupplier } from '../accounting/partner-subledger';
import { lockAccountingPeriod } from '../accounting/accounting-period-lock';
import { resolveFxRate } from '../accounting/fx-rate-resolution';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
import { resolveSaleTaxRate } from '../sales/engines/sale-tax-rate.engine';
import { currencyMoneyDigits, roundMoney } from '../accounting/engines/money-minor-units.engine';
import { Inject, Injectable, Logger, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
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
import { DCSA_STANDARD_MILESTONES, DcsaMilestoneKey, ShipmentMilestoneKey, RoadMilestoneKey, ROAD_FREIGHT_MILESTONES, MaritimePipelineConfig } from './maritime-freight.types';
import {
  calculateAirChargeableWeight,
  calculateAirFreightCost,
  validateIataAwbNumber,
  IATA_CARGO_IQ_MILESTONES,
} from './engines/air-freight.engine';
import {
  calculateRoadFreightCost,
  STANDARD_TRUCK_SPECIFICATIONS,
} from './engines/road-freight.engine';
import * as crypto from 'crypto';
import { MaritimeMailService } from './maritime-mail.service';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { formatLocalCalendarDay, getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { checkInsuranceClaim } from './engines/cargo-insurance.engine';
import { QuotationChargeDto, UpdateJobChargesDto } from './dto/itemized-charges.dto';
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
      resolveTenantConfiguredTaxRate: this.quotationsService.resolveTenantConfiguredTaxRate.bind(this.quotationsService),
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
      resolveTenantConfiguredTaxRate: this.quotationsService.resolveTenantConfiguredTaxRate.bind(this.quotationsService),
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
  }

  private async resolveTenantConfiguredTaxRate(
    queryable: Kysely<Database>,
    tenantId: string,
  ): Promise<unknown> {
    return this.quotationsService.resolveTenantConfiguredTaxRate(queryable, tenantId);
  }

  private async assertJobCanClose(tenantId: string, jobId: string) {
    return this.jobsCoreService.assertJobCanClose(tenantId, jobId);
  }

  private async assertRoadProofOfDelivery(tenantId: string, jobId: string, bookingNumber: string | null | undefined) {
    return this.jobsCoreService.assertRoadProofOfDelivery(tenantId, jobId, bookingNumber);
  }

  private async assertUniqueMasterBl(tenantId: string, mbl: string | null | undefined, jobId?: string, parentJobId?: string | null, trx?: any) {
    return this.jobsCoreService.assertUniqueMasterBl(tenantId, mbl, jobId, parentJobId, trx);
  }

  private async postContainerDepositJournal(
    trx: any, tenantId: string, containerId: string, amount: number, currency: string,
    event: 'open' | 'refund' | 'forfeit', userId: number,
  ) {
    return this.jobsCoreService.postContainerDepositJournal(trx, tenantId, containerId, amount, currency, event, userId);
  }

  private async resolveFreightExchangeRate(tenantId: string, currency: string | undefined, suppliedRate?: number): Promise<number> {
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

  async ensureDefaultMasterData(tenantId: string): Promise<{ portsAdded: number; linesAdded: number; agentsAdded: number; airlinesAdded: number; airportsAdded: number; truckingAdded: number; dryPortsAdded: number }> {
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

  async createPort(auth: AuthContext, data: { code: string; nameAr: string; nameEn: string; countryCode: string; countryName: string }) {
    return this.masterDataService.createPort(auth, data);
  }

  async getShippingLines(auth: AuthContext, filters?: { carrierType?: string; tradeLane?: string; countryCode?: string; search?: string }) {
    return this.masterDataService.getShippingLines(auth, filters);
  }

  async createShippingLine(auth: AuthContext, data: {
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
  }) {
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

  async addJobMilestone(auth: AuthContext, jobId: string, milestoneKey: ShipmentMilestoneKey, notes?: string, location?: string) {
    return this.jobsMilestonesService.addJobMilestone(auth, jobId, milestoneKey, notes, location);
  }

  async releaseDeliveryOrder(auth: AuthContext, jobId: string, dto?: ReleaseDeliveryOrderDto) {
    return this.jobsMilestonesService.releaseDeliveryOrder(auth, jobId, dto);
  }

  async sendMilestoneWhatsApp(auth: AuthContext, jobId: string, milestoneKey: ShipmentMilestoneKey, targetPhone?: string) {
    return this.jobsMilestonesService.sendMilestoneWhatsApp(auth, jobId, milestoneKey, targetPhone);
  }

  async getMilestoneWhatsAppMessage(auth: AuthContext, jobId: string, milestoneKey: ShipmentMilestoneKey) {
    return this.jobsMilestonesService.getMilestoneWhatsAppMessage(auth, jobId, milestoneKey);
  }

  async getContainers(auth: AuthContext, filters?: { overdueOnly?: boolean; depositHeldOnly?: boolean; search?: string }) {
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

  async settleJobFromCustomerBalance(auth: AuthContext, jobId: string, dto?: { amount?: number; exchangeRate?: number }) {
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

  async listRateCards(auth: AuthContext, filters?: { polCode?: string; podCode?: string; containerType?: string; status?: string; transportMode?: string }) {
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


  async createCarrierDispute(
    auth: AuthContext,
    invoiceId: string,
    dto: { reason: string; disputedAmount?: number },
  ) {
    const { tenantId } = requireTenantScope(auth);

    const invoice = await this.db
      .selectFrom('maritime_carrier_invoices')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', Number(invoiceId) as any)
      .executeTakeFirst();

    if (!invoice) throw new NotFoundException('فاتورة الناقل غير موجودة');

    const job = await this.getJobById(auth, String(invoice.job_id));
    const disputedAmount = dto.disputedAmount ? Number(dto.disputedAmount) : Number(invoice.variance_amount);

    // معاملة واحدة: إنشاء النزاع **و**حجز الفاتورة عن الصرف لا ينفصلان. كانا
    // عبارتين مستقلتين، ففشل الثانية يترك نزاعاً قائماً وفاتورة قابلة للصرف —
    // خرق صامت للثابت DISP-1 ("تعليق الفاتورة لحين التسوية").
    const { dispute, disputeNumber } = await this.db.transaction().execute(async (trx) => {
      // ترقيم آمن: رقم مؤقت فريد ثم إعادة التسمية بالمعرّف (نفس نمط MWR في هذا
      // الملف و§2.2). كان `COUNT(*) + 1` بلا فلتر يومي وبلا قيد تفرد على
      // `dispute_number` — نزاعان متزامنان يأخذان نفس الرقم **بصمت** (F6).
      const tempNumber = `DISP-TMP-${crypto.randomUUID()}`;
      const [inserted] = await trx
        .insertInto('maritime_carrier_disputes')
        .values({
          tenant_id: tenantId,
          dispute_number: tempNumber,
          invoice_id: Number(invoice.id),
          job_id: Number(job.id),
          carrier_name: invoice.carrier_name,
          disputed_amount: disputedAmount > 0 ? disputedAmount : Number(invoice.total_invoiced_amount),
          currency: invoice.currency || 'USD',
          dispute_reason: dto.reason?.trim() || 'فروق تسعير عن التعرفة المتعاقد عليها',
          dispute_status: 'submitted',
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber('DISP', Number(inserted.id), new Date(), 4, await getTenantTimezone(trx, tenantId));
      const [renamed] = await trx
        .updateTable('maritime_carrier_disputes')
        .set({ dispute_number: finalNumber })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', inserted.id as any)
        .returningAll()
        .execute();

      await trx
        .updateTable('maritime_carrier_invoices')
        .set({
          audit_status: 'disputed',
          payment_status: 'held_for_dispute',
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(invoice.id) as any)
        .execute();

      return { dispute: renamed, disputeNumber: finalNumber };
    });

    return {
      success: true,
      dispute,
      message: `تم إنشاء مذكرة النزاع المالي #${disputeNumber} وحجز الفاتورة عن الصرف بنجاح`,
    };
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
    const { tenantId } = requireTenantScope(auth);
    if (!['accepted', 'rejected', 'partially_accepted'].includes(dto.status)) throw new BadRequestException('نتيجة النزاع غير صالحة.');
    const creditAmount = Number(dto.creditNoteAmount || 0);
    if (!Number.isFinite(creditAmount) || creditAmount < 0 || (dto.status === 'rejected' && creditAmount !== 0)) throw new BadRequestException('قيمة الإشعار الدائن غير صالحة.');
    return this.db.transaction().execute(async trx => {
      await lockAccountingPeriod(trx, tenantId);
      const dispute = await trx.selectFrom('maritime_carrier_disputes').selectAll().where('tenant_id', '=', tenantId).where('id', '=', String(disputeId)).forUpdate().executeTakeFirst();
      if (!dispute) throw new NotFoundException('مذكرة النزاع غير موجودة');
      if (['accepted', 'rejected', 'partially_accepted'].includes(dispute.dispute_status)) {
        if (dispute.dispute_status !== dto.status || Number(dispute.credit_note_amount || 0) !== creditAmount || String(dispute.credit_note_number || '') !== String(dto.creditNoteNumber || '')) throw new BadRequestException('النزاع مسوى بالفعل ببيانات مختلفة.');
        return { success: true, dispute, message: 'تمت تسوية النزاع مسبقاً.' };
      }
      if (creditAmount > Number(dispute.disputed_amount)) throw new BadRequestException('الإشعار يتجاوز المبلغ المتنازع عليه.');
      const invoice = await trx.selectFrom('maritime_carrier_invoices').selectAll().where('tenant_id', '=', tenantId).where('id', '=', String(dispute.invoice_id)).forUpdate().executeTakeFirstOrThrow();
      const job = await trx.selectFrom('maritime_jobs').selectAll().where('tenant_id', '=', tenantId).where('id', '=', String(dispute.job_id) as any).forUpdate().executeTakeFirstOrThrow();
      if (creditAmount > 0) {
        if (!invoice.journal_entry_id || !invoice.shipping_line_id) throw new BadRequestException('يجب ترحيل فاتورة الناقل وربط الخط الملاحي قبل إشعارها الدائن.');
        const originalExpense = await trx.selectFrom('journal_entry_lines').select(['account_id', 'debit', 'cost_center_id', 'branch_id', 'location_id'])
          .where('tenant_id', '=', tenantId).where('journal_entry_id', '=', invoice.journal_entry_id).where('debit', '>', 0).executeTakeFirstOrThrow();
        const previousCredits = await trx.selectFrom('maritime_carrier_disputes').select(sql<number>`coalesce(sum(credit_note_amount), 0)`.as('amount'))
          .where('tenant_id', '=', tenantId).where('invoice_id', '=', invoice.id).where('id', '!=', dispute.id)
          .where('dispute_status', 'in', ['accepted', 'partially_accepted']).executeTakeFirstOrThrow();
        if (creditAmount + Number(previousCredits.amount) > Number(invoice.total_invoiced_amount) + 0.001) throw new BadRequestException('الإشعارات الدائنة المتراكمة تتجاوز قيمة فاتورة الناقل.');
        const ratio = creditAmount / Number(invoice.total_invoiced_amount);
        if (!Number.isFinite(ratio) || ratio <= 0 || ratio > 1) throw new BadRequestException('قيمة الإشعار لا تطابق الفاتورة الأصلية.');
        const baseCredit = calculateCarrierCreditBaseAmount(Number(invoice.total_invoiced_amount), Number(originalExpense.debit), Number(previousCredits.amount), creditAmount);
        const supplierId = await ensureDomainSupplier(trx, tenantId, 'shipping_line', invoice.shipping_line_id, invoice.carrier_name || 'خط ملاحي');
        const payableId = await this.accountingPosting.resolveSystemAccountByCode(trx, tenantId, '2110');
        const originalPayable = await trx.selectFrom('journal_entry_lines')
          .select(['cost_center_id', 'branch_id', 'location_id'])
          .where('tenant_id', '=', tenantId).where('journal_entry_id', '=', invoice.journal_entry_id)
          .where('account_id', '=', payableId).where('partner_type', '=', 'supplier').where('partner_id', '=', supplierId)
          .where('credit', '>', 0).executeTakeFirst();
        if (!originalPayable) throw new BadRequestException('هوية مورد الفاتورة لا تطابق القيد الأصلي؛ يلزم مراجعة الربط قبل الإشعار الدائن.');
        const description = `إشعار دائن ناقل ${dto.creditNoteNumber || ''} - النزاع ${dispute.dispute_number}`;
        await this.accountingPosting.postDomainJournal(trx, {
          tenantId, accountId: tenantId, entryDate: new Date(), sourceType: 'maritime_carrier_credit_note', sourceId: Number(dispute.id), description, createdBy: auth.userId || null,
          lines: [
            { accountId: payableId, description, debit: baseCredit, credit: 0, partnerType: 'supplier', partnerId: supplierId, costCenterId: originalPayable.cost_center_id, branchId: originalPayable.branch_id, locationId: originalPayable.location_id },
            { accountId: Number(originalExpense.account_id), description, debit: 0, credit: baseCredit, partnerType: 'none', partnerId: null, costCenterId: originalExpense.cost_center_id, branchId: originalExpense.branch_id, locationId: originalExpense.location_id },
          ],
        });
        const carrierCost = Number(job.carrier_cost_total || 0) - baseCredit;
        if (carrierCost < -0.01) throw new BadRequestException('تكلفة الشحنة لا تكفي للإشعار؛ يلزم مطابقة القيود السابقة.');
        await trx.updateTable('maritime_jobs').set({ carrier_cost_total: Math.max(0, carrierCost), net_profit: Number(job.client_invoiced_total || 0) - Math.max(0, carrierCost) - Number(job.other_costs_total || 0), updated_at: new Date() })
          .where('tenant_id', '=', tenantId).where('id', '=', job.id).execute();
      }
      const updated = await trx.updateTable('maritime_carrier_disputes').set({ dispute_status: dto.status, resolution_notes: dto.resolutionNotes || null, credit_note_number: dto.creditNoteNumber || null, credit_note_amount: creditAmount, resolved_by: auth.userId || null, resolved_at: new Date(), updated_at: new Date() } as any)
        .where('tenant_id', '=', tenantId).where('id', '=', dispute.id).returningAll().executeTakeFirstOrThrow();
      await trx.updateTable('maritime_carrier_invoices').set({ payment_status: 'unpaid', audit_status: dto.status === 'rejected' ? 'approved_override' : 'matched', updated_at: new Date() })
        .where('tenant_id', '=', tenantId).where('id', '=', invoice.id).execute();
      return { success: true, dispute: updated, message: 'تمت تسوية النزاع وقيده المحاسبي.' };
    });
  }

  async listJobCarrierInvoices(auth: AuthContext, jobId: string) {
    const { tenantId } = requireTenantScope(auth);

    const invoices = await this.db
      .selectFrom('maritime_carrier_invoices as mci')
      .leftJoin('maritime_carrier_disputes as mcd', 'mcd.invoice_id', 'mci.id')
      .leftJoin('maritime_rate_cards as mrc', 'mrc.id', 'mci.rate_card_id')
      .select([
        'mci.id',
        'mci.tenant_id',
        'mci.job_id',
        'mci.shipping_line_id',
        'mci.carrier_name',
        'mci.invoice_number',
        'mci.invoice_date',
        'mci.currency',
        'mci.total_invoiced_amount',
        'mci.ocean_freight',
        'mci.thc_charges',
        'mci.baf_charges',
        'mci.detention_demurrage',
        'mci.other_charges',
        'mci.rate_card_id',
        'mci.contracted_amount',
        'mci.variance_amount',
        'mci.variance_pct',
        'mci.audit_status',
        'mci.override_approved_by',
        'mci.override_approved_at',
        'mci.override_reason',
        'mci.journal_entry_id',
        'mci.payment_status',
        'mci.notes',
        'mci.created_by',
        'mci.created_at',
        'mcd.id as dispute_id',
        'mcd.dispute_number',
        'mcd.dispute_status',
        'mcd.disputed_amount',
        'mcd.credit_note_number',
        'mcd.credit_note_amount',
        'mrc.carrier_name as rate_card_carrier',
        'mrc.total_freight_cost as rate_card_unit_cost',
      ])
      .where('mci.tenant_id', '=', tenantId)
      .where('mci.job_id', '=', Number(jobId) as any)
      .orderBy('mci.id', 'desc')
      .execute();

    return invoices.map((r: any) => ({
      id: String(r.id),
      jobId: String(r.job_id),
      shippingLineId: r.shipping_line_id ? String(r.shipping_line_id) : null,
      carrierName: r.carrier_name,
      invoiceNumber: r.invoice_number,
      invoiceDate: r.invoice_date,
      currency: r.currency,
      totalInvoicedAmount: Number(r.total_invoiced_amount),
      oceanFreight: Number(r.ocean_freight),
      thcCharges: Number(r.thc_charges),
      bafCharges: Number(r.baf_charges),
      detentionDemurrage: Number(r.detention_demurrage),
      otherCharges: Number(r.other_charges),
      rateCardId: r.rate_card_id ? String(r.rate_card_id) : null,
      contractedAmount: Number(r.contracted_amount),
      varianceAmount: Number(r.variance_amount),
      variancePct: Number(r.variance_pct),
      auditStatus: r.audit_status,
      overrideApprovedBy: r.override_approved_by ? String(r.override_approved_by) : null,
      overrideApprovedAt: r.override_approved_at,
      overrideReason: r.override_reason,
      journalEntryId: r.journal_entry_id ? String(r.journal_entry_id) : null,
      paymentStatus: r.payment_status,
      notes: r.notes,
      createdBy: r.created_by ? String(r.created_by) : null,
      createdAt: r.created_at,
      dispute: r.dispute_id
        ? {
            id: String(r.dispute_id),
            disputeNumber: r.dispute_number,
            disputeStatus: r.dispute_status,
            disputedAmount: Number(r.disputed_amount),
            creditNoteNumber: r.credit_note_number,
            creditNoteAmount: Number(r.credit_note_amount),
          }
        : null,
      rateCard: r.rate_card_id
        ? {
            carrierName: r.rate_card_carrier,
            unitCost: Number(r.rate_card_unit_cost),
          }
        : null,
    }));
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
    const { tenantId } = requireTenantScope(auth);
    const page = Math.max(1, filters?.page || 1);
    const pageSize = Math.min(100, Math.max(1, filters?.pageSize || 50));

    let query = this.db
      .selectFrom('maritime_carrier_invoices as mci')
      .leftJoin('maritime_carrier_disputes as mcd', 'mcd.invoice_id', 'mci.id')
      .leftJoin('maritime_rate_cards as mrc', 'mrc.id', 'mci.rate_card_id')
      .leftJoin('maritime_jobs as j', 'j.id', 'mci.job_id')
      .select([
        'mci.id',
        'mci.tenant_id',
        'mci.job_id',
        'mci.shipping_line_id',
        'mci.carrier_name',
        'mci.invoice_number',
        'mci.invoice_date',
        'mci.currency',
        'mci.total_invoiced_amount',
        'mci.ocean_freight',
        'mci.thc_charges',
        'mci.baf_charges',
        'mci.detention_demurrage',
        'mci.other_charges',
        'mci.rate_card_id',
        'mci.contracted_amount',
        'mci.variance_amount',
        'mci.variance_pct',
        'mci.audit_status',
        'mci.override_approved_by',
        'mci.override_approved_at',
        'mci.override_reason',
        'mci.journal_entry_id',
        'mci.payment_status',
        'mci.notes',
        'mci.created_by',
        'mci.created_at',
        'mcd.id as dispute_id',
        'mcd.dispute_number',
        'mcd.dispute_status',
        'mcd.disputed_amount',
        'mcd.credit_note_number',
        'mcd.credit_note_amount',
        'mrc.carrier_name as rate_card_carrier',
        'mrc.total_freight_cost as rate_card_unit_cost',
        'j.job_number',
        'j.customer_name',
        'j.pol_name',
        'j.pod_name',
      ])
      .where('mci.tenant_id', '=', tenantId);

    if (filters?.auditStatus && filters.auditStatus !== 'all') {
      query = query.where('mci.audit_status', '=', filters.auditStatus as any);
    }

    if (filters?.shippingLineId) {
      query = query.where('mci.shipping_line_id', '=', Number(filters.shippingLineId) as any);
    }

    if (filters?.search?.trim()) {
      const term = `%${filters.search.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb('mci.invoice_number', 'ilike', term),
          eb('mci.carrier_name', 'ilike', term),
          eb('j.job_number', 'ilike', term),
          eb('j.customer_name', 'ilike', term),
        ]),
      );
    }

    const rows = await query
      .orderBy('mci.id', 'desc')
      .limit(pageSize)
      .offset((page - 1) * pageSize)
      .execute();

    // Summary aggregates for company-wide audit KPIs
    const allForTenant = await this.db
      .selectFrom('maritime_carrier_invoices')
      .select([
        sql<number>`count(*)::int`.as('total_count'),
        sql<number>`coalesce(sum(total_invoiced_amount), 0)::float`.as('total_invoiced'),
        sql<number>`count(case when audit_status = 'matched' then 1 end)::int`.as('matched_count'),
        sql<number>`count(case when audit_status = 'overcharge' then 1 end)::int`.as('overcharge_count'),
        sql<number>`count(case when audit_status = 'disputed' then 1 end)::int`.as('disputed_count'),
        sql<number>`coalesce(sum(case when audit_status = 'overcharge' then variance_amount else 0 end), 0)::float`.as('overcharge_amount'),
      ])
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    return {
      invoices: rows.map((r: any) => ({
        id: String(r.id),
        jobId: String(r.job_id),
        jobNumber: r.job_number || `JOB-${r.job_id}`,
        customerName: r.customer_name || '—',
        polName: r.pol_name || '—',
        podName: r.pod_name || '—',
        shippingLineId: r.shipping_line_id ? String(r.shipping_line_id) : null,
        carrierName: r.carrier_name,
        invoiceNumber: r.invoice_number,
        invoiceDate: r.invoice_date,
        currency: r.currency,
        totalInvoicedAmount: Number(r.total_invoiced_amount),
        oceanFreight: Number(r.ocean_freight),
        thcCharges: Number(r.thc_charges),
        bafCharges: Number(r.baf_charges),
        detentionDemurrage: Number(r.detention_demurrage),
        otherCharges: Number(r.other_charges),
        rateCardId: r.rate_card_id ? String(r.rate_card_id) : null,
        contractedAmount: Number(r.contracted_amount || 0),
        varianceAmount: Number(r.variance_amount || 0),
        variancePct: Number(r.variance_pct || 0),
        auditStatus: r.audit_status,
        overrideApprovedBy: r.override_approved_by,
        overrideApprovedAt: r.override_approved_at,
        overrideReason: r.override_reason,
        journalEntryId: r.journal_entry_id,
        paymentStatus: r.payment_status,
        notes: r.notes,
        createdAt: r.created_at,
        dispute: r.dispute_id
          ? {
              id: String(r.dispute_id),
              disputeNumber: r.dispute_number,
              status: r.dispute_status,
              disputedAmount: Number(r.disputed_amount),
              creditNoteNumber: r.credit_note_number,
              creditNoteAmount: Number(r.credit_note_amount || 0),
            }
          : null,
        rateCard: r.rate_card_id
          ? {
              carrierName: r.rate_card_carrier,
              unitCost: Number(r.rate_card_unit_cost),
            }
          : null,
      })),
      summary: {
        totalInvoices: Number(allForTenant?.total_count || 0),
        totalInvoicedAmount: Number(allForTenant?.total_invoiced || 0),
        matchedCount: Number(allForTenant?.matched_count || 0),
        overchargeCount: Number(allForTenant?.overcharge_count || 0),
        disputedCount: Number(allForTenant?.disputed_count || 0),
        totalOverchargeAmount: Number(allForTenant?.overcharge_amount || 0),
      },
    };
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

  private async resolveMaritimeAccountIdOn(queryable: any, tenantId: string, code: string, fallbackCode?: string): Promise<number | null> {
    return this.customsService.resolveMaritimeAccountIdOn(queryable, tenantId, code, fallbackCode);
  }

  private async hasPostedCloseJournal(queryable: any, tenantId: string, sourceType: string, sourceId: number): Promise<boolean> {
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
