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
import { forexOffsetCode } from '../accounting/engines/forex-difference.engine';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';
import { Inject, Injectable, Logger, NotFoundException, BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { KYSELY_DB } from '../../database/database.constants';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { boundedPage } from '../../common/utils/bounded-page';
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
  calculateTrucksRequired,
  calculateRoadFreightCost,
  STANDARD_TRUCK_SPECIFICATIONS,
} from './engines/road-freight.engine';
import * as crypto from 'crypto';
import { MaritimeMailService } from './maritime-mail.service';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { formatLocalCalendarDay, getTenantTimezone } from '../../common/utils/tenant-timezone.util';
import { calculateFreightAudit, validateMakerCheckerOverride } from './engines/freight-audit.engine';
import { checkInsuranceClaim } from './engines/cargo-insurance.engine';
import { QuotationChargeDto, JobChargeDto, UpdateJobChargesDto } from './dto/itemized-charges.dto';
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
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
    const existing = await trx
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .forUpdate()
      .executeTakeFirst();

    if (!existing) throw new NotFoundException('Shipment Job not found');
    const closingMode = dto.transportMode || existing.transport_mode;
    if (dto.status === 'completed' && existing.status !== 'completed') {
      await this.assertJobCanClose(tenantId, id);
      if (closingMode === 'air' && existing.milestone_status !== 'DLV') {
        throw new BadRequestException('إغلاق الشحنة الجوية يتطلب استكمال معالم Cargo iQ حتى التسليم');
      }
      if (closingMode === 'road') {
        await this.assertRoadProofOfDelivery(tenantId, id, dto.bookingNumber ?? existing.booking_number);
      }
    }
    if (dto.mblNumber !== undefined) {
      if (dto.mblNumber?.trim()) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${dto.mblNumber.trim().toUpperCase()}))`.execute(trx);
      }
      await this.assertUniqueMasterBl(tenantId, dto.mblNumber, id, existing.parent_job_id, trx);
    }

    const updatePayload: any = {
      updated_at: sql`NOW()`,
    };

    const transportMode = dto.transportMode || existing.transport_mode;
    if (dto.transportMode !== undefined) updatePayload.transport_mode = dto.transportMode;
    if (dto.airCargoType !== undefined) updatePayload.air_cargo_type = dto.airCargoType || null;
    if (dto.flightNumber !== undefined) updatePayload.flight_number = dto.flightNumber || null;
    if (dto.flightDate !== undefined) updatePayload.flight_date = dto.flightDate || null;

    if (transportMode === 'air' && dto.mawbNumber) {
      const mawbValidation = validateIataAwbNumber(dto.mawbNumber);
      if (!mawbValidation.valid) {
        throw new BadRequestException(mawbValidation.error);
      }
      updatePayload.mawb_number = mawbValidation.formattedAwb || dto.mawbNumber;
    } else if (dto.mawbNumber !== undefined) {
      updatePayload.mawb_number = dto.mawbNumber || null;
    }

    if (dto.hawbNumber !== undefined) updatePayload.hawb_number = dto.hawbNumber || null;

    let grossWeightKg = dto.grossWeightKg !== undefined ? Number(dto.grossWeightKg || 0) : Number(existing.gross_weight_kg || 0);
    let totalCbm = dto.totalCbm !== undefined ? Number(dto.totalCbm || 0) : Number(existing.total_cbm || 0);
    let volumetricWeightKg = dto.volumetricWeightKg !== undefined ? Number(dto.volumetricWeightKg || 0) : Number(existing.volumetric_weight_kg || 0);
    let chargeableWeightKg = dto.chargeableWeightKg !== undefined ? Number(dto.chargeableWeightKg || 0) : Number(existing.chargeable_weight_kg || 0);

    if (transportMode === 'air' && (grossWeightKg > 0 || totalCbm > 0)) {
      const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
      volumetricWeightKg = Math.max(volumetricWeightKg, airCalc.volumetricWeightKg);
      chargeableWeightKg = Math.max(chargeableWeightKg, airCalc.chargeableWeightKg);
    }

    if (dto.grossWeightKg !== undefined) updatePayload.gross_weight_kg = grossWeightKg;
    if (dto.volumetricWeightKg !== undefined || (transportMode === 'air' && volumetricWeightKg > 0)) updatePayload.volumetric_weight_kg = volumetricWeightKg;
    if (dto.chargeableWeightKg !== undefined || (transportMode === 'air' && chargeableWeightKg > 0)) updatePayload.chargeable_weight_kg = chargeableWeightKg;
    if (dto.totalCbm !== undefined) updatePayload.total_cbm = totalCbm;
    if (dto.packageCount !== undefined) updatePayload.package_count = Number(dto.packageCount || 0);
    if (dto.status !== undefined) updatePayload.status = dto.status;
    if (dto.vesselName !== undefined) updatePayload.vessel_name = dto.vesselName || null;
    if (dto.voyageNumber !== undefined) updatePayload.voyage_number = dto.voyageNumber || null;
    if (dto.bookingNumber !== undefined) updatePayload.booking_number = dto.bookingNumber || null;
    if (dto.polCode !== undefined) updatePayload.pol_code = dto.polCode;
    if (dto.polName !== undefined) updatePayload.pol_name = dto.polName;
    if (dto.podCode !== undefined) updatePayload.pod_code = dto.podCode;
    if (dto.podName !== undefined) updatePayload.pod_name = dto.podName;
    if (dto.etd !== undefined) updatePayload.etd = dto.etd || null;
    if (dto.eta !== undefined) updatePayload.eta = dto.eta || null;
    if (dto.portCutOff !== undefined) updatePayload.port_cut_off = dto.portCutOff || null;
    if (dto.blType !== undefined) updatePayload.bl_type = dto.blType;
    if (dto.mblNumber !== undefined) updatePayload.mbl_number = dto.mblNumber?.trim().toUpperCase() || null;
    if (dto.hblNumber !== undefined) updatePayload.hbl_number = dto.hblNumber || null;
    if (dto.shipperDetails !== undefined) updatePayload.shipper_details = dto.shipperDetails || null;
    if (dto.consigneeDetails !== undefined) updatePayload.consignee_details = dto.consigneeDetails || null;
    if (dto.notifyParty !== undefined) updatePayload.notify_party = dto.notifyParty || null;
    if (dto.shippingLineId !== undefined) updatePayload.shipping_line_id = dto.shippingLineId || null;
    if (dto.shippingLineName !== undefined) updatePayload.shipping_line_name = dto.shippingLineName;
    if (dto.notes !== undefined) updatePayload.notes = dto.notes || null;

    const [updatedJob] = await trx
      .updateTable('maritime_jobs')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    // INV-MARITIME-STORED-MONEY-POST-AT-CLOSE: closing the job
    // posts its stored money in the same transaction, so a failed
    // posting rolls the close back with it. A re-close of an
    // already-completed job re-runs the (idempotent) posting, so
    // a RETN-completed job can still post here as the recovery
    // path when the milestone path failed.
    if (dto.status === 'completed') {
      await this.postStoredMoneyAtClose(trx, tenantId, id, auth);
    }

    // INV-MARITIME-CONSOLIDATION-TOTALS-REAL: editing a child
    // re-derives its parent's totals in the same transaction, so
    // the parent can never drift from its line items. Editing a
    // parent directly (no parent_job_id) leaves its totals as
    // edited until the next child change re-derives them.
    if ((updatedJob as any)?.parent_job_id) {
      await this.syncConsolidationParentTotals(trx, tenantId, (updatedJob as any).parent_job_id);
    }

    return updatedJob;
    });
  }

  async addJobMilestone(auth: AuthContext, jobId: string, milestoneKey: ShipmentMilestoneKey, notes?: string, location?: string) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.db.selectFrom('maritime_jobs').select(['transport_mode', 'milestone_status'])
      .where('tenant_id', '=', tenantId).where('id', '=', jobId as any).executeTakeFirst();
    if (!job) throw new NotFoundException('Shipment Job not found');
    if (job.transport_mode === 'air') {
      const currentIndex = IATA_CARGO_IQ_MILESTONES.findIndex((m) => m.key === job.milestone_status);
      const nextIndex = IATA_CARGO_IQ_MILESTONES.findIndex((m) => m.key === milestoneKey);
      if (nextIndex < 0 || nextIndex !== currentIndex + 1) {
        throw new BadRequestException('لا يمكن تخطي المعالم الإلزامية لمسار الشحن الجوي Cargo iQ');
      }
    }
    if (milestoneKey === 'RETN') await this.assertJobCanClose(tenantId, jobId);
    if (milestoneKey === 'RETN') {
      const containers = await this.db.selectFrom('maritime_containers').select(['discharged_at'])
        .where('tenant_id', '=', tenantId).where('job_id', '=', jobId as any).execute();
      if (containers.some((container) => !container.discharged_at ||
        new Date(container.discharged_at).getTime() > Date.now())) {
        throw new BadRequestException('لا يمكن إرجاع الحاويات قبل تسجيل تفريغها');
      }
    }
    if (job.transport_mode === 'road' && milestoneKey === 'TRK_POD') {
      const roadJob = await this.db.selectFrom('maritime_jobs').select('booking_number')
        .where('tenant_id', '=', tenantId).where('id', '=', jobId as any).executeTakeFirst();
      await this.assertRoadProofOfDelivery(tenantId, jobId, roadJob?.booking_number);
    }
    const milestoneDef = DCSA_STANDARD_MILESTONES.find((m) => m.key === milestoneKey)
      || IATA_CARGO_IQ_MILESTONES.find((m) => m.key === milestoneKey)
      || ROAD_FREIGHT_MILESTONES.find((m) => m.key === milestoneKey);
    const milestoneTitle = milestoneDef ? `${milestoneDef.title_ar} (${milestoneDef.title_en})` : milestoneKey;

    await this.db
      .insertInto('maritime_job_milestones')
      .values({
        tenant_id: tenantId,
        job_id: jobId,
        milestone_key: milestoneKey,
        milestone_title: milestoneTitle,
        location: location || null,
        notes: notes || null,
        recorded_by: auth.userId ? Number(auth.userId) : null,
      })
      .execute();

    // Update job milestone status and automated triggers
    const updatePayload: any = {
      milestone_status: milestoneKey,
      updated_at: sql`NOW()`,
    };

    if (milestoneKey === 'DISC') {
      // 1. Container Discharged at destination port: Start free days clock & calculate deadline
      const containers = await this.db
        .selectFrom('maritime_containers')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId as any)
        .execute();

      const now = new Date();
      for (const c of containers) {
        if (!c.discharged_at) {
          const freeDays = Number(c.free_days ?? 14);
          const deadline = new Date(now);
          deadline.setDate(deadline.getDate() + freeDays);
          await this.db
            .updateTable('maritime_containers')
            .set({
              discharged_at: now,
              return_deadline: await resolveBusinessDateKey(this.db, tenantId, deadline),
              updated_at: sql`NOW()`,
            })
            .where('id', '=', c.id as any)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      }
    } else if (milestoneKey === 'GTO') {
      // 2. Gate-out: Release D/O and record container gate-out
      updatePayload.delivery_order_released = true;
      updatePayload.delivery_order_released_at = sql`NOW()`;
      await this.db
        .updateTable('maritime_containers')
        .set({ gated_out_at: sql`NOW()`, updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId as any)
        .where('gated_out_at', 'is', null)
        .execute();
    } else if (milestoneKey === 'DLVR') {
      // 3. Delivered to client premises
      updatePayload.delivered_to_client_at = sql`NOW()`;
    } else if (milestoneKey === 'RETN') {
      // 4. Empty Container Returned: close container & job
      const containers = await this.db.selectFrom('maritime_containers').selectAll()
        .where('tenant_id', '=', tenantId).where('job_id', '=', jobId as any).execute();
      updatePayload.status = 'completed';
      for (const container of containers.filter((row) => !row.empty_returned_at)) {
        const deadline = container.return_deadline ? Date.parse(container.return_deadline) : Date.now();
        const overdueDays = Math.max(0, Math.floor((Date.now() - deadline) / 86_400_000));
        await this.db.updateTable('maritime_containers').set({
          empty_returned_at: sql`NOW()`,
          deposit_status: ['refunded_to_treasury', 'forfeited'].includes(container.deposit_status)
            ? container.deposit_status : Number(container.deposit_amount || 0) > 0 ? 'pending_return_proof' : 'not_required',
          is_overdue: false, overdue_days: overdueDays,
          demurrage_amount: overdueDays * Number(container.demurrage_rate_per_day || 0),
          updated_at: sql`NOW()`,
        }).where('tenant_id', '=', tenantId).where('id', '=', container.id as any).execute();
      }
    }

    // INV-MARITIME-STORED-MONEY-POST-AT-CLOSE: the RETN milestone
    // closes the job, so its stored money posts here, BEFORE the
    // status update below -- a failed posting leaves the job open
    // and loud, and the idempotent posting can be recovered by a
    // re-close through updateJob.
    if (milestoneKey === 'RETN') {
      await this.postStoredMoneyAtClose(this.db, tenantId, jobId, auth);
    }

    const [updatedJob] = await this.db
      .updateTable('maritime_jobs')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', jobId as any)
      .returningAll()
      .execute();

    // Automated Proactive WhatsApp Notification on Milestone Change
    try {
      let customerPhone: string | null = null;
      if (updatedJob.customer_id) {
        const cust = await this.db
          .selectFrom('customers')
          .select(['phone'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', updatedJob.customer_id as any)
          .executeTakeFirst();
        customerPhone = cust?.phone || null;
      }
      if (!customerPhone && (updatedJob as any).customer_phone) {
        customerPhone = (updatedJob as any).customer_phone;
      }

      if (customerPhone) {
        const msgData = await this.getMilestoneWhatsAppMessage(auth, jobId, milestoneKey);
        await this.whatsAppGatewayService.sendRawMessage(tenantId, customerPhone, msgData.message);
        this.logger.log(`Auto-sent WhatsApp milestone update to ${customerPhone} for job ${updatedJob.job_number}`);
      }
    } catch (err: any) {
      this.logger.debug(`Could not auto-send milestone WhatsApp for job ${jobId}: ${err?.message}`);
    }

    return updatedJob;
  }

  /**
   * INV-MARITIME-DELIVERY-ORDER-RELEASE-GATES: releasing a delivery
   * order runs two tiers. PAYMENT is a strict precondition (money
   * tier): when the job has been invoiced, the client must have
   * paid within the same 0.01 full-payment band settle uses, or the
   * release is rejected before any milestone is written; an
   * uninvoiced job has nothing due and releases freely. DOCUMENTS
   * only warn (workflow tier, spirit of the law): a sea job with
   * no cleared customs declaration, or a caller-flagged incomplete
   * set on any mode, still releases -- but the warning and its
   * reason are recorded in the milestone notes and returned, so
   * the gap is visible instead of silently waived. A caller flag
   * can never mark documents complete: the customs check is
   * derived from the stored declarations, never trusted from the
   * request. Air/road keep their existing milestone checks.
   */
  async releaseDeliveryOrder(auth: AuthContext, jobId: string, dto?: ReleaseDeliveryOrderDto) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);
    const invoiced = Number(job?.client_invoiced_total || 0);
    const paid = Number(job?.client_paid_total || 0);
    if (invoiced > 0 && paid < invoiced - 0.01) {
      throw new BadRequestException(
        `لا يمكن إصدار إذن التسليم قبل اكتمال السداد: إجمالي الفواتير ${invoiced} والمسدد ${paid}.`,
      );
    }
    const isAir = job?.transport_mode === 'air';
    const isRoad = job?.transport_mode === 'road';
    const isSea = !isAir && !isRoad;
    let documentsWarning: string | null = null;
    if (isSea) {
      const cleared = await this.db
        .selectFrom('maritime_customs_declarations')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId as any)
        .where('status', '=', 'cleared')
        .executeTakeFirst();
      if (!cleared) {
        documentsWarning = 'لا يوجد بيان جمركي مُخَلَّص (cleared) لهذه الشحنة';
      }
    }
    if (dto?.documentsComplete === false) {
      documentsWarning = 'أبلغ الموظف أن المستندات غير مكتملة';
    }
    if (documentsWarning && dto?.documentReason?.trim()) {
      documentsWarning = dto.documentReason.trim();
    }
    const milestoneKey = isAir ? 'AWD' : isRoad ? 'TRK_POD' : 'GTO';
    const milestoneTitle = isAir
      ? 'تم اعتماد وإصدار إذن التسليم الجوي وبوليصة الشحن (Air Cargo Delivery Order) للعميل'
      : isRoad
      ? 'توقيع بوليصة الشحن البري وتأكيد استلام وتسليم البضاعة (Signed Waybill / POD)'
      : 'تم اعتماد وإصدار إذن التسليم الملاحي الرسمي (Delivery Order D/O) للعميل';
    const notes = documentsWarning ? `${milestoneTitle}\nتنبيه مستندات: ${documentsWarning}` : milestoneTitle;
    const released = await this.addJobMilestone(
      auth,
      jobId,
      milestoneKey,
      notes,
    );
    return { ...released, paymentVerified: true, documentsWarning };
  }

  async sendMilestoneWhatsApp(auth: AuthContext, jobId: string, milestoneKey: ShipmentMilestoneKey, targetPhone?: string) {
    const { tenantId } = requireTenantScope(auth);
    const msgData = await this.getMilestoneWhatsAppMessage(auth, jobId, milestoneKey);
    let phone = targetPhone || msgData.customerPhone;

    if (!phone) {
      const job = await this.getJobById(auth, jobId);
      if (job.customer_id) {
        const cust = await this.db
          .selectFrom('customers')
          .select(['phone'])
          .where('tenant_id', '=', tenantId)
          .where('id', '=', job.customer_id as any)
          .executeTakeFirst();
        phone = cust?.phone || null;
      }
    }

    if (!phone) {
      return { success: false, message: 'لا يوجد رقم هاتف مسجل للعميل' };
    }

    const res = await this.whatsAppGatewayService.sendRawMessage(tenantId, phone, msgData.message);
    return res;
  }

  async getMilestoneWhatsAppMessage(auth: AuthContext, jobId: string, milestoneKey: ShipmentMilestoneKey) {
    const job = await this.getJobById(auth, jobId);
    const trackingUrl = job.tracking_token
      ? `${process.env.APP_PUBLIC_URL || 'https://app.zsystemai.com'}/public/track/${job.tracking_token}`
      : '';

    const milestoneDef = DCSA_STANDARD_MILESTONES.find((m) => m.key === milestoneKey)
      || IATA_CARGO_IQ_MILESTONES.find((m) => m.key === milestoneKey)
      || ROAD_FREIGHT_MILESTONES.find((m) => m.key === milestoneKey);
    const title = milestoneDef ? milestoneDef.title_ar : milestoneKey;

    let actionContext = '';
    switch (milestoneKey) {
      case 'BOOK':
      case 'BKD':
      case 'TRK_ASSIGN':
        actionContext = job.transport_mode === 'road'
          ? `تم تأكيد حجز النقل البري وتعيين الشاحنة والسائق بنجاح برقم: ${job.booking_number || job.job_number}`
          : `تم تأكيد حجز الشحنة بنجاح برقم الحجز: ${job.booking_number || job.mawb_number || job.job_number}`;
        break;
      case 'GTI':
        actionContext = `وصلت الحاوية ودخلت ساحة ميناء الشحن (${job.pol_name}) بانتظار التحميل على السفينة.`;
        break;
      case 'TRK_GATE_IN':
        actionContext = `وصلت الشاحنة إلى موقع التحميل (${job.pol_name}) وبدأت إجراءات الدخول والوزن.`;
        break;
      case 'RCS':
        actionContext = `تم استلام الشحنة بمستودع قرية البضائع بمطار الشحن (${job.pol_name}) والتحقق من الأوزان والأبعاد.`;
        break;
      case 'LOAD':
        actionContext = `تم تحميل وشحن الحاوية على متن السفينة (${job.vessel_name || 'السفينة المحددة'}) وجاري التجهيز للإبحار.`;
        break;
      case 'TRK_LOADED':
        actionContext = `تم إتمام تحميل وتربيط البضاعة بالشاحنة ووزن الحمولة بنجاح وجاهزة للتحرك.`;
        break;
      case 'MAN':
        actionContext = `تم إدراج الشحنة على مانيفست رحلة الطيران المجدولة بنجاح.`;
        break;
      case 'DEPT':
      case 'DEP':
      case 'TRK_DISPATCH':
        actionContext = job.transport_mode === 'air'
          ? `أقلعت رحلة الشحن الجوي (${job.flight_number || 'الرحلة المجدولة'}) من مطار ${job.pol_name} متجهة إلى ${job.pod_name}. موعد الوصول المتوقع (ETA): ${job.eta || 'قيد المتابعة'}.`
          : job.transport_mode === 'road'
          ? `انطلقت الشاحنة رسمياً على مسار الرحلة متجهة إلى ${job.pod_name}. موعد الوصول المتوقع (ETA): ${job.eta || 'قيد المتابعة'}.`
          : `أبحرت السفينة رسمياً من ${job.pol_name} متجهة إلى ${job.pod_name}. موعد الوصول المتوقع (ETA): ${job.eta || 'قيد المتابعة'}.`;
        break;
      case 'ARRI':
      case 'ARR':
      case 'TRK_ARRIVED':
        actionContext = job.transport_mode === 'air'
          ? `هبطت طائرة الشحن الجوي بحمد الله في مطار المقصد (${job.pod_name}) وجاري تفريغ الشحنة إلى قرية البضائع.`
          : job.transport_mode === 'road'
          ? `وصلت الشاحنة بحمد الله إلى موقع المقصد (${job.pod_name}) بانتظار بدء إجراءات التفريغ.`
          : `وصلت السفينة بحمد الله إلى ميناء المقصد (${job.pod_name}) وجاري ربط السفينة وبدء عمليات التفريغ.`;
        break;
      case 'DISC':
        actionContext = `تم تفريغ الحاوية على رصيف ميناء ${job.pod_name} وبدأ سريان فترة السماح (Free Days). جاري بدء إجراءات التخليص الجمركي.`;
        break;
      case 'TRK_BORDER':
        actionContext = `وصلت الشاحنة إلى المنفذ البري / المعبر الجمركي وجاري فحص وتخليص البضاعة العابرة للحدود.`;
        break;
      case 'RCF':
        actionContext = `تم تفريغ ودخول الشحنة لمستودع قرية البضائع بمطار ${job.pod_name} وجاهزة لإجراءات المعاينة والتخليص.`;
        break;
      case 'CUST':
        actionContext = `تم إنهاء كافة إجراءات الإفراج والمطابقة الجمركية للشحنة بنجاح.`;
        break;
      case 'NFD':
        actionContext = `تم إشعار العميل المستلم بوصول الشحنة لمطار المقصد وجاري التنسيق للتسليم النهائي.`;
        break;
      case 'GTO':
      case 'AWD':
        actionContext = job.transport_mode === 'air'
          ? `تم إصدار إذن التسليم الجوي وبوليصة الشحن (Delivery Order D/O) وتجهيز الشحنة للاستلام.`
          : `تم إصدار إذن التسليم الملاحي (Delivery Order D/O) وخروج الحاوية من بوابة الميناء في طريقها للعنوان المحدد.`;
        break;
      case 'TRK_UNLOADED':
        actionContext = `تم تفريغ البضاعة ومطابقة الطرود والكميات بمستودع المستلم.`;
        break;
      case 'DLVR':
      case 'DLV':
      case 'TRK_POD':
        actionContext = `تم تسليم البضاعة كاملة وتوقيع إشعار / بوليصة الاستلام بنجاح (Proof of Delivery). نشكركم على ثقتكم في خدماتنا اللوجستية!`;
        break;
      case 'RETN':
        actionContext = `تم إرجاع الحاوية الفارغة لساحة التوكيل الملاحي بنجاح وجاري استرداد مبالغ التأمين للخزينة.`;
        break;
    }

    const modeName = job.transport_mode === 'air' ? 'الجوية' : job.transport_mode === 'road' ? 'البرية' : 'الملاحية';
    const message = `عزيزنا العميل ${job.customer_name}،\n` +
      `تحديث جديد بخصوص شحنتكم ${modeName} [${job.job_number}]:\n` +
      `المرحلة الحالية: ${title}\n` +
      `${actionContext}\n\n` +
      `يمكنكم متابعة معالم الشحنة المجدولة عبر رابط التتبع (الأحداث تقديرية وليست قراءة مباشرة من الناقل):\n` +
      `${trackingUrl}\n\n` +
      `فريق العمليات واللوجستيات — Z-Systems`;

    return {
      jobId: job.id,
      jobNumber: job.job_number,
      customerName: job.customer_name,
      customerPhone: (job as any).customer_phone || null,
      milestoneKey,
      milestoneTitle: title,
      message,
    };
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

  // --------------------------------------------------------------------------
  // 10. Financial Accounting & Cost Center Posting
  // --------------------------------------------------------------------------
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

  /**
   * INV-MARITIME-CUSTOMER-LEDGER-ON-INVOICE: a job sales invoice
   * maintains the customer subledger in the same transaction as its
   * journal, on the sales pattern (customers.balance plus one
   * customer_ledger row, entry_type 'sale_credit', the posted
   * base-currency amount at book digits). Without this the settle
   * guard's GL-vs-balance equality could never hold after a
   * maritime invoice, so settle-from-balance could never succeed.
   * Deliberately no credit-limit/block gating: the sales helper's
   * gating is a further behavioural choice that was not decided
   * here, so issuing an invoice never newly blocks on it. A job
   * with no linked customer writes nothing (settle requires a
   * customer anyway); a linked customer that does not exist fails
   * closed and rolls the journal back with it. Supplier-ledger
   * writes are NOT added here: they were not decided.
   */
  private async maintainCustomerLedgerForInvoice(
    trx: any,
    tenantId: string,
    accountId: string,
    job: { id: number | string; customer_id?: number | string | null; job_number?: string | null },
    baseInvoiceAmount: number,
    digits: MoneyDigits,
    auth: AuthContext,
  ): Promise<void> {
    if (!job.customer_id) return;
    const customerId = Number(job.customer_id);
    const [updated] = await trx
      .updateTable('customers')
      .set({ balance: sql`COALESCE(balance, 0) + ${baseInvoiceAmount}`, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', customerId)
      .returning(['balance'])
      .execute();
    if (!updated) {
      throw new BadRequestException('تعذر إصدار فاتورة المبيعات: العميل المرتبط بالشحنة غير موجود.');
    }
    const balanceAfter = roundMoney(Number(updated.balance), digits);
    await trx
      .insertInto('customer_ledger')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        customer_id: customerId,
        entry_type: 'sale_credit',
        amount: baseInvoiceAmount,
        balance_after: balanceAfter,
        note: `فاتورة مبيعات ملاحية - العملية #${job.job_number || job.id}`,
        reference_type: 'maritime_job',
        reference_id: Number(job.id),
        created_by: auth.userId ? Number(auth.userId) : null,
      } as any)
      .execute();
  }

  async issueJobSalesInvoice(
    auth: AuthContext,
    jobId: string,
    dto?: { amount?: number; notes?: string; exchangeRate?: number; currency?: string },
  ) {
    const { tenantId, accountId } = requireTenantScope(auth);
    let job = await this.getJobById(auth, jobId);

    // 1. Ensure cost center exists
    let costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;
    if (!costCenterId) {
      try {
        const [newCc] = await this.db
          .insertInto('cost_centers')
          .values({
            tenant_id: tenantId,
            code: job.job_number,
            name: `شحنة بحرية: ${job.job_number} - ${job.customer_name}`,
            dimension: 'project',
            is_active: true,
            description: `مركز تكلفة تلقائي للعملية الملاحية ${job.job_number}`,
          })
          .returning('id')
          .execute();
        if (newCc) {
          costCenterId = Number(newCc.id);
          await this.db
            .updateTable('maritime_jobs')
            .set({ cost_center_id: String(costCenterId) })
            .where('id', '=', job.id as any)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      } catch {
        // ignore
      }
    }

    const invoiceAmount = Number(dto?.amount ?? (Number(job.client_invoiced_total) || 0));
    if (invoiceAmount <= 0) {
      throw new BadRequestException('يجب تحديد مبلغ صالح للفاتورة أكبر من صفر');
    }

    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, dto?.currency, dto?.exchangeRate);
    // INV-MARITIME-JOB-JOURNAL-FX-CONVERSION: convert at the base
    // currency's book digits through the shared engine; the rate
    // already comes from the shared resolver above.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const baseInvoiceAmount = convertFxAmount(invoiceAmount, exchangeRate, digits);

    // Resolve accounts: Customer Receivable (1130), Service Revenue (4200 or 4100).
    // Previously "if (customerAccId && revenueAccId)" silently skipped the journal when either
    // account was missing, while client_invoiced_total was still updated unconditionally below --
    // recognising revenue on the job record with nothing behind it in the general ledger, and the
    // return message still claimed the invoice was issued AND posted. Now this throws, and the
    // whole operation is one transaction so a failure here touches nothing.
    const customerAccId = await this.resolveAccountId(tenantId, '1130');
    const revenueAccId = await this.resolveAccountId(tenantId, '4200', '4100');
    if (!customerAccId || !revenueAccId) {
      throw new BadRequestException(
        'تعذر إصدار فاتورة المبيعات: حساب ذمم العملاء (1130) أو حساب إيراد الخدمات (4200/4100) غير متاح في شجرة الحسابات.',
      );
    }

    const entryDate = new Date();
    const fxSuffix = exchangeRate !== 1 ? ` (${invoiceAmount} ${dto?.currency || 'USD'} @ ${exchangeRate})` : '';
    const desc = (dto?.notes || `فاتورة مبيعات خدمات ملاحية - العملية #${job.job_number} (${job.customer_name})`) + fxSuffix;

    const { updatedJob, entryId, entryNo } = await this.db.transaction().execute(async (trx: any) => {
      await this.assertMaritimeJournalPeriodOpen(trx, tenantId, entryDate);
      job = { ...job, ...await trx.selectFrom('maritime_jobs').selectAll().where('tenant_id', '=', tenantId).where('id', '=', job.id).forUpdate().executeTakeFirstOrThrow() };

      const newEntryId = await this.accountingPosting.postDomainJournal(trx, {
        tenantId, accountId: tenantId, entryDate, description: desc,
        sourceType: 'maritime_job', sourceId: Number(job.id), createdBy: auth.userId || null,
        lines: [
          { accountId: customerAccId, costCenterId, description: desc, debit: baseInvoiceAmount, credit: 0, partnerType: 'customer', partnerId: job.customer_id ? Number(job.customer_id) : null },
          { accountId: revenueAccId, costCenterId, description: desc, debit: 0, credit: baseInvoiceAmount, partnerType: 'none', partnerId: null },
        ],
      });
      const posted = await trx.selectFrom('journal_entries').select('entry_no').where('tenant_id', '=', tenantId).where('id', '=', newEntryId).executeTakeFirstOrThrow();
      const newEntryNo = posted.entry_no;

      const postedRevenue = await trx.selectFrom('journal_entries as je')
        .innerJoin('journal_entry_lines as jl', (join: any) => join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'))
        .select(sql<number>`COALESCE(SUM(jl.credit), 0)`.as('amount'))
        .where('je.tenant_id', '=', tenantId).where('je.source_type', '=', 'maritime_job')
        .where('je.source_id', '=', Number(job.id)).where('je.status', '=', 'posted')
        .executeTakeFirst();
      const billedTotal = Number(postedRevenue?.amount || 0);
      const carrierCost = Number(job.carrier_cost_total || 0);
      const otherCosts = Number(job.other_costs_total || 0);
      const netProfit = billedTotal - (carrierCost + otherCosts);

      const [updated] = await trx
        .updateTable('maritime_jobs')
        .set({
          client_invoiced_total: billedTotal,
          net_profit: netProfit,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', job.id as any)
        .returningAll()
        .execute();

      // INV-MARITIME-CUSTOMER-LEDGER-ON-INVOICE: the same
      // transaction maintains the customer subledger, so the
      // posted GL partner sum and customers.balance can never
      // diverge on an issued invoice.
      await this.maintainCustomerLedgerForInvoice(trx, tenantId, accountId, job, baseInvoiceAmount, digits, auth);

      return { updatedJob: updated, entryId: newEntryId, entryNo: newEntryNo };
    });

    return {
      success: true,
      job: updatedJob,
      journalEntryId: entryId,
      entryNo,
      amount: invoiceAmount,
      message: `تم إصدار وترحيل فاتورة المبيعات للعملية #${job.job_number} بقيمة ${invoiceAmount} بنجاح`,
    };
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
    const { tenantId } = requireTenantScope(auth);
    let job = await this.getJobById(auth, jobId);

    const amount = Number(dto.amount || 0);
    if (job.status === 'completed') {
      throw new BadRequestException('أعد فتح الشحنة قبل إضافة مصروفات جديدة حتى لا تتسرب من الفوترة');
    }
    if (amount <= 0) {
      throw new BadRequestException('يجب تحديد مبلغ صالح للمصروف أكبر من صفر');
    }

    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, dto.currency, dto.exchangeRate);
    // INV-MARITIME-JOB-JOURNAL-FX-CONVERSION: convert at the base
    // currency's book digits through the shared engine; the rate
    // already comes from the shared resolver above.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const baseExpenseAmount = convertFxAmount(amount, exchangeRate, digits);

    // 1. Ensure cost center exists
    let costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;
    if (!costCenterId) {
      try {
        const [newCc] = await this.db
          .insertInto('cost_centers')
          .values({
            tenant_id: tenantId,
            code: job.job_number,
            name: `شحنة بحرية: ${job.job_number} - ${job.customer_name}`,
            dimension: 'project',
            is_active: true,
            description: `مركز تكلفة تلقائي للعملية الملاحية ${job.job_number}`,
          })
          .returning('id')
          .execute();
        if (newCc) {
          costCenterId = Number(newCc.id);
          await this.db
            .updateTable('maritime_jobs')
            .set({ cost_center_id: String(costCenterId) })
            .where('id', '=', job.id as any)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      } catch {
        // ignore
      }
    }

    // 2. Resolve accounts.
    // Same fix as issueJobSalesInvoice: previously "if (expenseAccId && creditAccId)" silently
    // skipped the journal while carrier_cost_total / other_costs_total were still bumped
    // unconditionally below -- a cost recognised on the job with no journal entry behind it.
    const expenseAccId = await this.resolveAccountId(tenantId, '6400', '5100');

    let creditAccCode = '2110';
    let partnerType: 'supplier' | 'none' = 'supplier';
    if (dto.paymentMethod === 'cash') {
      creditAccCode = '1110';
      partnerType = 'none';
    } else if (dto.paymentMethod === 'bank') {
      creditAccCode = '1120';
      partnerType = 'none';
    }
    const creditAccId = await this.resolveAccountId(tenantId, creditAccCode);

    if (!expenseAccId || !creditAccId) {
      throw new BadRequestException(
        `تعذر تسجيل سند المصروفات: حساب المصروف (6400/5100) أو حساب السداد (${creditAccCode}) غير متاح في شجرة الحسابات.`,
      );
    }

    const entryDate = new Date();
    const fxSuffix = exchangeRate !== 1 ? ` (${amount} ${dto?.currency || 'USD'} @ ${exchangeRate})` : '';
    const desc = (dto.description || `سند مصروفات ملاحية (${dto.expenseType === 'carrier' ? 'نولون الخط الملاحي' : 'مصروفات موانئ وتخليص'}) - العملية #${job.job_number}`) + fxSuffix;

    const { updatedJob, entryId, entryNo } = await this.db.transaction().execute(async (trx: any) => {
      await this.assertMaritimeJournalPeriodOpen(trx, tenantId, entryDate);
      job = { ...job, ...await trx.selectFrom('maritime_jobs').selectAll().where('tenant_id', '=', tenantId).where('id', '=', job.id).forUpdate().executeTakeFirstOrThrow() };

      const newEntryId = await this.accountingPosting.postDomainJournal(trx, {
        tenantId, accountId: tenantId, entryDate, description: desc,
        sourceType: 'maritime_job_expense', sourceId: Number(job.id), createdBy: auth.userId || null,
        lines: [
          { accountId: expenseAccId, costCenterId, description: desc, debit: baseExpenseAmount, credit: 0, partnerType: 'none', partnerId: null },
          { accountId: creditAccId, costCenterId, description: desc, debit: 0, credit: baseExpenseAmount, partnerType, partnerId: dto.supplierId ? Number(dto.supplierId) : null },
        ],
      });
      const posted = await trx.selectFrom('journal_entries').select('entry_no').where('tenant_id', '=', tenantId).where('id', '=', newEntryId).executeTakeFirstOrThrow();
      const newEntryNo = posted.entry_no;

      let carrierCost = Number(job.carrier_cost_total || 0);
      let otherCosts = Number(job.other_costs_total || 0);

      if (dto.expenseType === 'carrier') {
        carrierCost += baseExpenseAmount;
      } else {
        otherCosts += baseExpenseAmount;
      }

      const revenue = Number(job.client_invoiced_total || 0);
      const netProfit = revenue - (carrierCost + otherCosts);

      const [updated] = await trx
        .updateTable('maritime_jobs')
        .set({
          carrier_cost_total: carrierCost,
          other_costs_total: otherCosts,
          net_profit: netProfit,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', job.id as any)
        .returningAll()
        .execute();

      return { updatedJob: updated, entryId: newEntryId, entryNo: newEntryNo };
    });

    return {
      success: true,
      job: updatedJob,
      journalEntryId: entryId,
      entryNo,
      amount,
      message: `تم تسجيل سند المصروفات الملاحية للعملية #${job.job_number} بقيمة ${amount} بنجاح`,
    };
  }

  async getJobFinancialLedger(auth: AuthContext, jobId: string, pagination?: { page?: number; pageSize?: number }) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);

    const costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;

    let query = this.db
      .selectFrom('journal_entries as je')
      .innerJoin('journal_entry_lines as jel', (join) => join.onRef('jel.journal_entry_id', '=', 'je.id').onRef('jel.tenant_id', '=', 'je.tenant_id'))
      .innerJoin('accounting_accounts as acc', (join) => join.onRef('acc.id', '=', 'jel.account_id').onRef('acc.tenant_id', '=', 'je.tenant_id'))
      .select([
        'je.id as entry_id',
        'je.entry_no',
        'je.entry_date',
        'je.description as entry_description',
        'je.source_type',
        'jel.id as line_id',
        'jel.description as line_description',
        'jel.debit',
        'jel.credit',
        'jel.partner_type',
        'jel.cost_center_id',
        'acc.code as account_code',
        'acc.name_ar as account_name',
      ])
      .where('je.tenant_id', '=', tenantId);

    if (costCenterId) {
      query = query.where((eb) =>
        eb.or([
          eb('jel.cost_center_id', '=', costCenterId),
          eb.and([
            eb('je.source_type', 'in', ['maritime_job', 'maritime_job_expense']),
            eb('je.source_id', '=', Number(jobId)),
          ]),
        ]),
      );
    } else {
      query = query.where('je.source_type', 'in', ['maritime_job', 'maritime_job_expense'])
        .where('je.source_id', '=', Number(jobId));
    }

    const { page, pageSize, offset } = boundedPage(pagination?.page, pagination?.pageSize);
    const pageRows = await query.orderBy('je.id', 'desc').orderBy('jel.id', 'desc')
      .limit(pageSize + 1).offset(offset).execute();

    return {
      jobId: job.id,
      jobNumber: job.job_number,
      costCenterId: job.cost_center_id,
      entries: pageRows.slice(0, pageSize),
      pagination: { page, pageSize, hasMore: pageRows.length > pageSize },
    };
  }

  async settleJobFromCustomerBalance(auth: AuthContext, jobId: string, dto?: { amount?: number; exchangeRate?: number }) {
    const { tenantId } = requireTenantScope(auth);
    return this.db.transaction().execute(async trx => {
      await lockAccountingPeriod(trx, tenantId);
      const job = await trx.selectFrom('maritime_jobs').selectAll().where('tenant_id', '=', tenantId).where('id', '=', jobId as any).forUpdate().executeTakeFirstOrThrow();
      if (!job.customer_id || Number(job.client_invoiced_total || 0) <= 0) throw new BadRequestException('يجب ربط العميل وإصدار فاتورة الشحنة أولاً.');
      if (dto?.exchangeRate != null && Number(dto.exchangeRate) !== 1) throw new BadRequestException('أرصدة الشحنة والعميل مثبتة بعملة الأساس؛ لا يعاد تحويلها عند المطابقة.');
      const customer = await trx.selectFrom('customers').select(['id', 'balance']).where('tenant_id', '=', tenantId).where('id', '=', job.customer_id).forUpdate().executeTakeFirstOrThrow();
      const ledger = await trx.selectFrom('journal_entry_lines as l')
        .innerJoin('journal_entries as j', join => join.onRef('j.id', '=', 'l.journal_entry_id').onRef('j.tenant_id', '=', 'l.tenant_id'))
        .innerJoin('accounting_accounts as a', join => join.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'))
        .select(sql<number>`coalesce(sum(l.debit - l.credit), 0)`.as('balance'))
        .where('l.tenant_id', '=', tenantId).where('l.partner_type', '=', 'customer').where('l.partner_id', '=', customer.id).where('j.status', '=', 'posted')
        .where(eb => eb.or([eb('a.is_receivable', '=', true), eb('a.code', '=', '1130')])).executeTakeFirstOrThrow();
      if (Math.abs(Number(ledger.balance) - Number(customer.balance)) > 0.01) throw new BadRequestException('الأستاذ العام ودفتر العميل غير متطابقين؛ يلزم تصحيح البيانات التاريخية قبل تسوية الشحنة.');
      if (Number(customer.balance) > 0.01) throw new BadRequestException('الرصيد الإجمالي للعميل مدين؛ يلزم تحصيل أو تخصيص سند سداد قبل المطابقة من الرصيد.');
      const invoiced = Number(job.client_invoiced_total);
      const paid = Number(job.client_paid_total || 0);
      // Settle math at the tenant's book digits, resolved on the
      // transaction handle with the pattern this file already uses: the
      // invoiced total is book-precision, so a hardcoded 2dp settle
      // stored 100.01 against an invoiced 100.005.
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const remaining = roundMoney(Math.max(0, invoiced - paid), digits);
      const amount = dto?.amount == null ? remaining : Number(dto.amount);
      if (!Number.isFinite(amount) || amount < 0 || amount > remaining + 0.001) throw new BadRequestException('مبلغ المطابقة يتجاوز المتبقي على الشحنة.');
      const newPaid = roundMoney(paid + amount, digits);
      const full = newPaid >= invoiced - 0.01;
      const updated = await trx.updateTable('maritime_jobs').set({ client_paid_total: newPaid, payment_status: full ? 'paid' : 'partially_paid', paid_at: full ? new Date() : job.paid_at, updated_at: new Date() })
        .where('tenant_id', '=', tenantId).where('id', '=', job.id).returningAll().executeTakeFirstOrThrow();
      if (amount > 0) await trx.insertInto('maritime_job_milestones').values({ tenant_id: tenantId, job_id: String(job.id), milestone_key: 'PAYMENT', milestone_title: 'مطابقة الفاتورة مع رصيد العميل المغطى', location: 'الحسابات', notes: `مطابقة ${amount} بعملة الأساس؛ لا توجد حركة نقدية جديدة`, recorded_by: auth.userId || null } as any).execute();
      // Invoice and receipt already changed AR and the shared ledger. Applying their
      // offset a second time here would consume the customer's credit twice.
      return { success: true, job: updated, settledAmount: amount, remainingUnpaid: Math.max(0, invoiced - newPaid), customerBalanceAfter: Number(customer.balance), customerAvailableCreditAfter: Math.max(0, -Number(customer.balance)), message: 'تمت مطابقة سداد الشحنة دون تكرار حركة رصيد العميل.' };
    });
  }

  async getCustomerActiveJobs(auth: AuthContext, customerId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    const jobs = await this.db
      .selectFrom('maritime_jobs')
      .select([
        'id',
        'job_number',
        'pol_name',
        'pod_name',
        'vessel_name',
        'milestone_status',
        'client_invoiced_total',
        'client_paid_total',
        'payment_status',
        'status',
        'created_at',
      ])
      .where('tenant_id', '=', tenantId)
      .where('customer_id', '=', Number(customerId))
      .where('status', '=', 'active')
      .orderBy('id', 'desc')
      .execute();

    return jobs.map((j) => {
      const invoiced = Number(j.client_invoiced_total || 0);
      const paid = Number(j.client_paid_total || 0);
      const unpaid = Math.max(0, invoiced - paid);
      return {
        ...j,
        invoiced,
        paid,
        unpaid,
      };
    });
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

  /**
   * Posts the carrier-invoice journal entry and updates the job's carrier cost roll-up.
   *
   * Extracted into one place because createCarrierInvoice and overrideCarrierInvoice previously
   * duplicated this ~50-line block, which had drifted into a genuine defect:
   *  - Missing 6400/5100/2110 accounts caused a SILENT skip (`if (expenseAccId && creditAccId)`)
   *    with no error, yet the caller still reported success and (in the override path) claimed
   *    the journal was posted even though it never was. Forbidden pattern F7
   *    (see ARCHITECTURE_INVARIANTS.md §2.2) — a missing account must fail loudly.
   *  - No fiscal period lock check, unlike every posting routed through insertPostedJournal.
   *  - No transaction: the journal header, journal lines, job cost update and invoice
   *    insert/update were independent statements. A failure partway left an orphaned journal
   *    entry or a job cost bump with no invoice record behind it.
   * All three are fixed here: this method MUST be called with a transaction handle, throws
   * instead of skipping, and enforces the period lock the same way insertPostedJournal does.
   */
  private async postCarrierInvoiceJournal(
    trx: any,
    tenantId: string,
    params: {
      job: { id: number | string; cost_center_id?: number | string | null; job_number?: string; shipping_line_name?: string | null; carrier_cost_total?: number | string | null; client_invoiced_total?: number | string | null; other_costs_total?: number | string | null };
      invoiceNumber: string;
      carrierName?: string | null;
      shippingLineId?: string | number | null;
      totalAmount: number;
      currency?: string;
      exchangeRate?: number;
      entryDate: Date;
      descriptionSuffix?: string;
      userId?: number | string | null;
    },
  ): Promise<number> {
    const { totalAmount } = params;
    let job = params.job;

    await this.assertMaritimeJournalPeriodOpen(trx, tenantId, params.entryDate);
    job = { ...job, ...await trx.selectFrom('maritime_jobs').selectAll().where('tenant_id', '=', tenantId).where('id', '=', job.id).forUpdate().executeTakeFirstOrThrow() };

    const expenseAccId = await this.resolveAccountId(tenantId, '6400', '5100');
    const creditAccId = await this.resolveAccountId(tenantId, '2110');
    if (!expenseAccId || !creditAccId) {
      throw new BadRequestException(
        'تعذر ترحيل فاتورة الناقل: حساب مصروف الشحن (6400/5100) أو حساب الذمم الدائنة (2110) غير متاح في شجرة الحسابات. يرجى تهيئتهما أولاً.',
      );
    }

    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, params.currency, params.exchangeRate);
    // INV-MARITIME-CARRIER-INVOICE-FX-CONVERSION: convert at the base
    // currency's book digits through the shared engine; the rate
    // already comes from the shared resolver above.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
    const baseTotalAmount = convertFxAmount(totalAmount, exchangeRate, digits);
    const fxSuffix = exchangeRate !== 1 ? ` (${totalAmount} ${params.currency || 'USD'} @ ${exchangeRate})` : '';

    const costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;
    const desc = `فاتورة الخط الملاحي #${params.invoiceNumber} (${params.carrierName || job.shipping_line_name || 'Carrier'})${params.descriptionSuffix ? ' ' + params.descriptionSuffix : ''}${fxSuffix} - الشحنة #${job.job_number}`;
    const tempNo = `JRN-TMP-CARRIER-${job.id}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;

    if (!params.shippingLineId) throw new BadRequestException('يجب ربط فاتورة الناقل بخط ملاحي محدد.');
    const supplierId = await ensureDomainSupplier(trx, tenantId, 'shipping_line', params.shippingLineId, params.carrierName || job.shipping_line_name || 'خط ملاحي');
    const entryId = await this.accountingPosting.postDomainJournal(trx, {
      tenantId, accountId: tenantId, entryDate: params.entryDate, description: desc,
      sourceType: 'maritime_carrier_invoice', sourceId: Number(job.id), createdBy: Number(params.userId) || null,
      lines: [
        { accountId: expenseAccId, costCenterId, description: desc, debit: baseTotalAmount, credit: 0, partnerType: 'none', partnerId: null },
        { accountId: creditAccId, costCenterId, description: desc, debit: 0, credit: baseTotalAmount, partnerType: 'supplier', partnerId: supplierId },
      ],
    });

    const newCarrierCost = Number(job.carrier_cost_total || 0) + baseTotalAmount;
    const revenue = Number(job.client_invoiced_total || 0);
    const otherCosts = Number(job.other_costs_total || 0);
    const newNetProfit = revenue - (newCarrierCost + otherCosts);

    await trx
      .updateTable('maritime_jobs')
      .set({
        carrier_cost_total: newCarrierCost,
        net_profit: newNetProfit,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', job.id)
      .execute();

    return entryId;
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
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);

    // 1. Find matching active rate card
    const shippingLineId = dto.shippingLineId || job.shipping_line_id;
    const polCode = (job.pol_code || '').toUpperCase();
    const podCode = (job.pod_code || '').toUpperCase();
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());

    let query = this.db
      .selectFrom('maritime_rate_cards')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('pol_code', '=', polCode)
      .where('pod_code', '=', podCode)
      .where('status', '=', 'active')
      .where('currency', '=', (dto.currency || 'USD').trim().toUpperCase())
      .where('valid_from', '<=', today)
      .where('valid_until', '>=', today);

    if (shippingLineId) {
      query = query.where('shipping_line_id', '=', String(shippingLineId) as any);
    }

    const containerType = dto.containerType || job.containers?.[0]?.container_type || '40HC';
    if (containerType) {
      query = query.where('container_type', '=', containerType);
    }

    const matchedCard = await query.orderBy('total_freight_cost', 'asc').executeTakeFirst();
    const containerCount = job.containers?.length || 1;

    const auditResult = calculateFreightAudit({
      invoicedTotal: Number(dto.invoicedTotal || 0),
      oceanFreight: Number(dto.oceanFreight || 0),
      thcCharges: Number(dto.thcCharges || 0),
      bafCharges: Number(dto.bafCharges || 0),
      otherCharges: Number(dto.otherCharges || 0),
      rateCard: matchedCard ? this.mapRateCardRow(matchedCard) : null,
      containerCount,
      // INV-FX-CONVERSION-SINGLE-ENGINE: the audit converts at the
      // tenant's book digits. The rate itself is not passed here:
      // the rate-card query above already filters to the invoice
      // currency, so the audit never converts across currencies.
      moneyDigits: currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId)),
    });

    return {
      jobId: job.id,
      jobNumber: job.job_number,
      shippingLineName: job.shipping_line_name,
      polCode: job.pol_code,
      podCode: job.pod_code,
      containerCount,
      containerType,
      rateCard: matchedCard ? this.mapRateCardRow(matchedCard) : null,
      audit: auditResult,
    };
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
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);
    if (job.status === 'completed') {
      throw new BadRequestException('أعد فتح الشحنة قبل إضافة فاتورة ناقل جديدة');
    }

    const totalAmount = Number(dto.totalInvoicedAmount || 0);
    if (totalAmount <= 0) {
      throw new BadRequestException('يجب تحديد مبلغ إجمالي للفاتورة أكبر من صفر');
    }
    if (!dto.invoiceNumber?.trim()) {
      throw new BadRequestException('يجب إدخال رقم فاتورة الخط الملاحي');
    }
    const currency = (dto.currency || 'USD').trim().toUpperCase();
    const exchangeRate = await this.resolveFreightExchangeRate(tenantId, currency, dto.exchangeRate);

    // 1. Audit against rate card
    const auditPreview = await this.previewCarrierInvoiceAudit(auth, jobId, {
      invoicedTotal: totalAmount,
      oceanFreight: dto.oceanFreight,
      thcCharges: dto.thcCharges,
      bafCharges: dto.bafCharges,
      otherCharges: dto.otherCharges,
      shippingLineId: dto.shippingLineId,
      currency,
    });

    const audit = auditPreview.audit;
    // Invariant L14 & Rule #14: Strict Maker-Checker Separation.
    // A user creating an invoice CANNOT self-approve financial variances at creation time.
    // An 'overcharge' invoice is saved WITHOUT posting a journal, and must be reviewed and
    // approved by a distinct authorized checker via /override, or sent to dispute.
    const auditStatus = audit.auditStatus;
    const overrideApprovedBy: number | null = null;
    const overrideApprovedAt: Date | null = null;
    const overrideReason: string | null = null;

    const entryDate = dto.invoiceDate ? new Date(dto.invoiceDate) : new Date();
    const shouldPostJournal = ['matched', 'undercharge', 'no_contract'].includes(auditStatus);

    // INV-MARITIME-CARRIER-INVOICE-NUMBER-UNIQUE: there is NO unique
    // constraint on maritime_carrier_invoices.invoice_number, so the
    // duplicate check inside the transaction below is the only thing
    // stopping the same carrier invoice number from posting a second
    // journal and doubling the carrier cost. The advisory lock
    // serialises concurrent creates of the same number; the existence
    // check runs before any journal is posted, on the effective
    // shipping line (the DTO line, else the job's line) with a
    // null-safe line comparison -- two different lines may legitimately
    // reuse a number, the same line may not.
    const normalizedInvoiceNumber = dto.invoiceNumber.trim().toUpperCase();
    const effectiveShippingLineId = dto.shippingLineId
      ? Number(dto.shippingLineId)
      : (job.shipping_line_id ? Number(job.shipping_line_id) : null);

    // Everything below is one atomic unit: the journal (header + lines), the job cost roll-up,
    // and the invoice record itself. Previously these were five independent statements on
    // `this.db` directly — a failure partway left an orphaned journal entry and an inflated
    // job cost with no invoice record to explain either.
    const insertedInvoice = await this.db.transaction().execute(async (trx: any) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${normalizedInvoiceNumber}))`.execute(trx);
      const duplicateQuery = trx
        .selectFrom('maritime_carrier_invoices')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where(sql<string>`UPPER(TRIM(invoice_number))`, '=', normalizedInvoiceNumber);
      const duplicateInvoice = await (effectiveShippingLineId == null
        ? duplicateQuery.where('shipping_line_id', 'is', null)
        : duplicateQuery.where('shipping_line_id', '=', effectiveShippingLineId))
        .executeTakeFirst();
      if (duplicateInvoice) {
        throw new BadRequestException('رقم فاتورة الخط الملاحي مستخدم من قبل ولا يمكن تسجيله مرتين لنفس الخط الملاحي');
      }

      let entryId: number | null = null;

      if (shouldPostJournal) {
        entryId = await this.postCarrierInvoiceJournal(trx, tenantId, {
          job,
          invoiceNumber: dto.invoiceNumber,
          carrierName: dto.carrierName,
          shippingLineId: dto.shippingLineId,
          totalAmount,
          currency,
          exchangeRate,
          entryDate,
          userId: auth.userId,
        });
      }

      // 3. Insert into maritime_carrier_invoices
      const [row] = await trx
        .insertInto('maritime_carrier_invoices')
        .values({
          tenant_id: tenantId,
          job_id: Number(job.id),
          shipping_line_id: dto.shippingLineId ? Number(dto.shippingLineId) : (job.shipping_line_id ? Number(job.shipping_line_id) : null),
          carrier_name: dto.carrierName || job.shipping_line_name || 'Carrier',
          invoice_number: dto.invoiceNumber.trim(),
          invoice_date: dto.invoiceDate ? (dto.invoiceDate as any) : (await resolveBusinessDateKey(trx, tenantId, new Date()) as any),
          currency,
          total_invoiced_amount: totalAmount,
          ocean_freight: Number(dto.oceanFreight || 0),
          thc_charges: Number(dto.thcCharges || 0),
          baf_charges: Number(dto.bafCharges || 0),
          detention_demurrage: Number(dto.detentionDemurrage || 0),
          other_charges: Number(dto.otherCharges || 0),
          rate_card_id: audit.rateCardId ? Number(audit.rateCardId) : null,
          contracted_amount: audit.contractedTotal,
          variance_amount: audit.varianceAmount,
          variance_pct: audit.variancePct,
          audit_status: auditStatus,
          override_approved_by: overrideApprovedBy,
          override_approved_at: overrideApprovedAt,
          override_reason: overrideReason,
          journal_entry_id: entryId,
          payment_status: 'unpaid',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returningAll()
        .execute();

      return row;
    });

    const statusMessage =
      auditStatus === 'matched'
        ? 'مطابقة للتعرفة المتعاقد عليها'
        : auditStatus === 'overcharge'
        ? `زيادة غير معتمدة بمقدار +${audit.varianceAmount} (+${audit.variancePct}%) تتطلب مراجعة واعتماد مسؤول مالي آخر أو فتح نزاع`
        : auditStatus === 'undercharge'
        ? `أقل من التعرفة بمقدار -${Math.abs(audit.varianceAmount)}`
        : 'سجلت بدون تعرفة مسبقة';

    return {
      success: true,
      invoice: insertedInvoice,
      audit,
      message: `تم تسجيل فاتورة الخط الملاحي #${dto.invoiceNumber} بنجاح (${statusMessage})`,
    };
  }


  async overrideCarrierInvoice(auth: AuthContext, invoiceId: string, dto: { reason: string }) {
    const { tenantId } = requireTenantScope(auth);

    const updatedInvoice = await this.db.transaction().execute(async (trx: any) => {
      // Row lock: without it, two concurrent /override calls by two different valid checkers
      // both read journal_entry_id = NULL, both pass the "not yet posted" check below, and both
      // post a journal entry for the same invoice — a duplicated expense in the general ledger.
      const invoice = await trx
        .selectFrom('maritime_carrier_invoices')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(invoiceId) as any)
        .forUpdate()
        .executeTakeFirst();

      if (!invoice) throw new NotFoundException('فاتورة الناقل غير موجودة');

      // The endpoint previously had no check on the invoice's current audit_status at all: it
      // could be called on an already-matched, already-approved, or disputed invoice and would
      // unconditionally flip it to 'approved_override'. Only an invoice actually flagged
      // 'overcharge' is awaiting this decision.
      if (invoice.audit_status !== 'overcharge') {
        throw new BadRequestException(
          `لا يمكن تطبيق التجاوز المالي: حالة الفاتورة الحالية (${invoice.audit_status}) ليست في انتظار مراجعة زيادة سعرية.`,
        );
      }

      const validation = validateMakerCheckerOverride({
        userId: auth.userId || 0,
        role: auth.role || '',
        invoiceCreatedBy: invoice.created_by ? Number(invoice.created_by) : null,
        reason: dto.reason,
      });

      if (!validation.valid) {
        throw new BadRequestException(validation.error);
      }

      const job = await this.getJobById(auth, String(invoice.job_id));

      // Post journal if not already posted. Uses the same shared helper as createCarrierInvoice:
      // throws instead of silently skipping when the required accounts are missing, and enforces
      // the fiscal period lock — neither of which the previous inline copy of this logic did.
      let entryId = invoice.journal_entry_id ? Number(invoice.journal_entry_id) : null;
      if (!entryId) {
        const invCurrency = String(invoice.currency || 'USD').trim().toUpperCase();
        const fxRate = await this.resolveFreightExchangeRate(tenantId, invCurrency);

        entryId = await this.postCarrierInvoiceJournal(trx, tenantId, {
          job,
          invoiceNumber: invoice.invoice_number,
          carrierName: invoice.carrier_name,
          shippingLineId: invoice.shipping_line_id,
          totalAmount: Number(invoice.total_invoiced_amount),
          currency: invCurrency,
          exchangeRate: fxRate,
          entryDate: invoice.invoice_date ? new Date(invoice.invoice_date) : new Date(),
          descriptionSuffix: '(معتمدة بتجاوز مالي)',
          userId: auth.userId,
        });
      }

      const [row] = await trx
        .updateTable('maritime_carrier_invoices')
        .set({
          audit_status: 'approved_override',
          override_approved_by: auth.userId ? Number(auth.userId) : null,
          override_approved_at: sql`NOW()`,
          override_reason: dto.reason.trim(),
          journal_entry_id: entryId,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', Number(invoiceId) as any)
        .returningAll()
        .execute();

      return row;
    });

    return {
      success: true,
      invoice: updatedInvoice,
      message: 'تم اعتماد التجاوز المالي لفاتورة الناقل وترحيل القيد المحاسبي بنجاح',
    };
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

  // ==========================================
  // 1. Itemized Charges Grid & Multi-Currency ROE
  // ==========================================

  async getQuotationCharges(auth: AuthContext, quotationId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_quotation_charges')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('quotation_id', '=', String(quotationId))
      .orderBy('id', 'asc')
      .execute();
  }

  async getJobCharges(auth: AuthContext, jobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_job_charges')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId))
      .orderBy('id', 'asc')
      .execute();
  }

  /**
   * INV-MARITIME-CHARGE-GRID-LINE-UPDATES: the charge grid updates
   * line by line, keyed by the stored row id -- never
   * delete-all + reinsert, which destroyed invoiced history on
   * every save. The stored is_invoiced flag is authoritative:
   * a caller-supplied isInvoiced is IGNORED on existing rows
   * (an invoiced row is left byte-untouched however the payload
   * revalues it, so a round-tripped float can never rewrite
   * invoiced history) and REJECTED on new rows (a new row
   * cannot invent invoiced history). Rows with an id that does
   * not belong to this job, and duplicate ids in one payload,
   * are rejected. Stored rows absent from the payload are
   * deleted EXCEPT invoiced rows, which survive omission. The
   * marked-total guard runs over the STORED invoiced rows after
   * the update (converted through the shared resolver on the
   * transaction handle -- never the pool handle inside the
   * transaction), against the posted maritime_job revenue.
   * A completed job still rejects the whole update first.
   */
  async updateJobCharges(auth: AuthContext, jobId: string | number, dto: UpdateJobChargesDto) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, String(jobId));
    if (job.status === 'completed') {
      throw new BadRequestException('أعد فتح الشحنة قبل تعديل مصروفاتها ورسومها');
    }
    return await this.db.transaction().execute(async (trx) => {
      const stored = await trx
        .selectFrom('maritime_job_charges')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .forUpdate()
        .execute();
      const storedById = new Map(stored.map((row) => [String(row.id), row]));

      const seenIds = new Set<string>();
      for (const charge of dto.charges) {
        if (charge.id == null) continue;
        const key = String(charge.id);
        if (seenIds.has(key)) {
          throw new BadRequestException('بند التكلفة مكرر في نفس الحفظ؛ كل بند يظهر مرة واحدة فقط');
        }
        seenIds.add(key);
        if (!storedById.has(key)) {
          throw new NotFoundException('بند التكلفة غير موجود في هذه الشحنة');
        }
      }

      // T2: same canonical gate as createQuotation / createJob, on
      // the sell basis -- re-saving a charge re-validates its rate
      // against the tenant's configured rate (or 0 = exempt).
      // Invoiced rows stay frozen above and never reach this.
      const configuredTaxRate = await this.resolveTenantConfiguredTaxRate(trx, tenantId);
      const computeValues = (chg: JobChargeDto) => {
        const cost = Number(chg.costAmount || 0);
        const sell = Number(chg.sellAmount || 0);
        const profit = Number(chg.profitAmount ?? (sell - cost));
        const taxPct = resolveSaleTaxRate(chg.taxRatePercent, configuredTaxRate);
        const taxAmt = Number(chg.taxAmount ?? (sell * taxPct / 100));
        return {
          charge_code: chg.chargeCode || 'CHG',
          charge_name_ar: chg.chargeNameAr || 'رسوم نولون / خدمات',
          charge_name_en: chg.chargeNameEn || 'Freight / Logistics Charge',
          currency: chg.currency || 'USD',
          cost_amount: cost,
          sell_amount: sell,
          profit_amount: profit,
          is_local_charge: Boolean(chg.isLocalCharge),
          tax_rate_percent: taxPct,
          tax_amount: taxAmt,
        };
      };

      const keptIds = new Set<string>();
      for (const chg of dto.charges) {
        if (chg.id != null) {
          const key = String(chg.id);
          keptIds.add(key);
          const row = storedById.get(key)!;
          // Invoiced rows are frozen: the stored flag stands and
          // the row is left byte-untouched whatever the payload
          // claims about its amounts or its invoiced flag.
          if (row.is_invoiced) continue;
          await trx
            .updateTable('maritime_job_charges')
            .set(computeValues(chg))
            .where('tenant_id', '=', tenantId)
            .where('job_id', '=', String(jobId))
            .where('id', '=', String(chg.id))
            .execute();
        } else {
          // A new row cannot arrive already invoiced: the flag
          // comes only from the invoicing flow itself.
          if (chg.isInvoiced) {
            throw new BadRequestException('لا يمكن إنشاء بند جديد موسوماً كمفوتر؛ الوسم يأتي من الفوترة فقط');
          }
          await trx
            .insertInto('maritime_job_charges')
            .values({
              tenant_id: tenantId,
              job_id: String(jobId),
              ...computeValues(chg),
              is_invoiced: false,
            })
            .execute();
        }
      }

      const omitted = stored.filter((row) => !keptIds.has(String(row.id)) && !row.is_invoiced);
      if (omitted.length > 0) {
        await trx
          .deleteFrom('maritime_job_charges')
          .where('tenant_id', '=', tenantId)
          .where('job_id', '=', String(jobId))
          .where('id', 'in', omitted.map((row) => String(row.id)))
          .execute();
      }

      const invoicedRows = await trx
        .selectFrom('maritime_job_charges')
        .select(['sell_amount', 'currency'])
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .where('is_invoiced', '=', true)
        .execute();
      if (invoicedRows.length > 0) {
        const posted = await trx.selectFrom('journal_entries as je')
          .innerJoin('journal_entry_lines as jl', (join: any) => join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'))
          .select(sql<number>`COALESCE(SUM(jl.credit), 0)`.as('amount'))
          .where('je.tenant_id', '=', tenantId).where('je.source_id', '=', Number(jobId))
          .where('je.source_type', '=', 'maritime_job').where('je.status', '=', 'posted')
          .executeTakeFirst();
        let markedTotal = 0;
        for (const row of invoicedRows) {
          if (Number(row.sell_amount || 0) <= 0) {
            throw new BadRequestException('لا يمكن وسم بند تكلفة مفوتر دون مبلغ بيع للعميل');
          }
          markedTotal += Number(row.sell_amount) *
            await resolveFxRate(trx, tenantId, row.currency || 'USD');
        }
        if (markedTotal > Number(posted?.amount || 0) + 0.01) {
          throw new BadRequestException('البنود الموسومة مفوترة تتجاوز فواتير العميل المرحلة فعلياً');
        }
      }

      return await trx
        .selectFrom('maritime_job_charges')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .orderBy('id', 'asc')
        .execute();
    });
  }

  async calculateJobForexGainLoss(auth: AuthContext, jobId: string | number, actualRoe: number) {
    const { tenantId } = requireTenantScope(auth);
    if (!Number.isFinite(actualRoe) || actualRoe <= 0) {
      throw new BadRequestException('سعر الصرف الفعلي يجب أن يكون موجباً وصالحاً');
    }
    const job = await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(jobId) as any)
      .executeTakeFirst();

    if (!job) throw new NotFoundException('Job not found');

    const quoteRoe = Number(job.quote_roe || 0);
    // INV-MARITIME-FOREX-GAIN-LOSS-BOOK-DIGITS: the base currency
    // comes strictly from tenantBaseCurrency (fail-closed on a
    // settings/rate mismatch, no silent EGP fallback), and the
    // stored spread rounds at the base currency's book digits
    // through the canonical engine. convertFxAmount is not used:
    // the spread can be negative or zero.
    const baseCurrency = await tenantBaseCurrency(this.db, tenantId);
    const invoices = await this.db.selectFrom('maritime_carrier_invoices')
      .select(['currency', 'total_invoiced_amount']).where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId)).where('journal_entry_id', 'is not', null).execute();
    const foreignInvoices = invoices.filter((invoice) => invoice.currency.toUpperCase() !== baseCurrency.toUpperCase());
    if (new Set(foreignInvoices.map((invoice) => invoice.currency.toUpperCase())).size > 1) {
      throw new BadRequestException('توجد أكثر من عملة ناقل؛ يلزم احتساب فروق الصرف لكل عملة على حدة');
    }
    if (foreignInvoices.length > 0 && (!Number.isFinite(quoteRoe) || quoteRoe <= 0)) {
      throw new BadRequestException('سعر الصرف التعاقدي غير متاح لحساب فرق العملة');
    }
    const foreignTotal = foreignInvoices.reduce((sum, invoice) => sum + Number(invoice.total_invoiced_amount || 0), 0);
    const forexGainLoss = roundMoney((quoteRoe - actualRoe) * foreignTotal, currencyMoneyDigits(baseCurrency));

    const [updated] = await this.db
      .updateTable('maritime_jobs')
      .set({
        actual_roe: actualRoe,
        forex_gain_loss: forexGainLoss,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(jobId) as any)
      .returningAll()
      .execute();

    return updated;
  }

  private async resolveMaritimeAccountIdOn(queryable: any, tenantId: string, code: string, fallbackCode?: string): Promise<number | null> {
    return this.customsService.resolveMaritimeAccountIdOn(queryable, tenantId, code, fallbackCode);
  }

  /**
   * The chart's shared FX offset account (7180 gain / 7280 loss,
   * forexOffsetCode), created on demand EXACTLY as the forex
   * revaluation service creates it (same parent 7100/7200, same
   * names, same flags) when the tenant chart does not have it yet.
   * The name is the chart's name for this code; forking a second
   * code for the same difference would split one difference across
   * two accounts and break the revaluation service's own name
   * check on the shared code. A missing parent fails closed.
   */
  private async resolveMaritimeFxOffsetAccountOn(queryable: any, tenantId: string, accountId: string, gain: boolean): Promise<number> {
    const code = forexOffsetCode(gain ? 1 : -1);
    const nameEn = gain ? 'Unrealized FX Gains' : 'Unrealized FX Losses';
    const existing = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active', 'account_type', 'name_en'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (existing) {
      const expectedType = gain ? 'revenue' : 'expense';
      if (!existing.is_active || existing.account_type !== expectedType || existing.name_en !== nameEn) {
        throw new BadRequestException('حساب فروق العملة غير نشط أو تصنيفه غير صحيح.');
      }
      return Number(existing.id);
    }
    const parentCode = gain ? '7100' : '7200';
    const parent = await queryable
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', parentCode)
      .executeTakeFirst();
    if (!parent) throw new BadRequestException('حساب الإيرادات أو المصروفات الأخرى غير موجود؛ لا يمكن إنشاء حساب فروق العملة.');
    await queryable
      .insertInto('accounting_accounts')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        code,
        name_ar: gain ? 'أرباح فروق عملة غير محققة' : 'خسائر فروق عملة غير محققة',
        name_en: nameEn,
        account_type: gain ? 'revenue' : 'expense',
        normal_balance: gain ? 'credit' : 'debit',
        account_group: gain ? 'income' : 'operating_expenses',
        parent_id: Number(parent.id),
        is_active: true,
        is_system: true,
        allow_manual_entries: false,
        is_control_account: false,
        is_cash_bank: false,
        is_receivable: false,
        is_payable: false,
        is_inventory: false,
        is_tax: false,
        description_ar: '',
        sort_order: Number(code),
      } as any)
      .onConflict((oc: any) => oc.columns(['tenant_id', 'code']).doNothing())
      .execute();
    const created = await queryable
      .selectFrom('accounting_accounts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (!created) throw new BadRequestException('حساب فروق العملة غير موجود؛ لا يمكن ترحيل فرق العملة عند الإغلاق.');
    return Number(created.id);
  }

  private async hasPostedCloseJournal(queryable: any, tenantId: string, sourceType: string, sourceId: number): Promise<boolean> {
    return this.customsService.hasPostedCloseJournal(queryable, tenantId, sourceType, sourceId);
  }

  /**
   * INV-MARITIME-STORED-MONEY-POST-AT-CLOSE: stored-only maritime
   * money posts automatically when a job closes, to explicit
   * accounts, with no extra staff work. Every slice reads and
   * writes through the caller-supplied queryable only (a
   * transaction handle from updateJob, the pool handle from the
   * RETN milestone path), converts through the shared resolver at
   * book digits, and is idempotent per source row: a posted close
   * journal for the same (sourceType, sourceId) is never posted
   * twice, so reopening and re-closing a job posts only genuinely
   * new rows. Slices:
   * - forex gain/loss: the stored spread adjusts the carrier
   *   payable (2110) against the shared offset account (7180 gain /
   *   7280 loss), only when a posted carrier invoice exists to
   *   adjust; a spread with no posted invoice is skipped, never
   *   invented into a payable movement.
   * - inland trucking: COMPLETED trips only (delivered /
   *   empty_returned) post their cost as expense (6400, fallback
   *   5100) against 2110. The sell side is NOT posted: billing
   *   the customer stays in the job-charges/invoice flow, and
   *   posting it here too would double the revenue.
   * - cargo insurance: active policies post their premium as
   *   expense (6400, fallback 5100) against 2110. Claims stay
   *   stored-only (contingent, separate decision).
   * - container demurrage_amount is DELIBERATELY NOT posted here:
   *   demurrage is billed as DEM charges through the normal
   *   invoice flow (the close guard already demands one), and
   *   posting the stored amount too would double-count it.
   * Trucking + insurance costs roll into the job's
   * other_costs_total / net_profit by the same formula the
   * carrier-invoice and expense paths use. Missing expense or
   * payable accounts fail closed; nothing is silently skipped.
   * The supplier subledger is not written (not decided): the
   * payable legs use partnerType 'none'.
   */
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
    const { accountId } = requireTenantScope(auth);
    const job = await queryable
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(jobId) as any)
      .executeTakeFirst();
    if (!job) throw new NotFoundException('Job not found');
    const baseCurrency = await tenantBaseCurrency(queryable, tenantId);
    const digits = currencyMoneyDigits(baseCurrency);
    const costCenterId = job.cost_center_id ? Number(job.cost_center_id) : null;
    const entryDate = new Date();
    const journalEntryIds: number[] = [];
    let postedCosts = 0;

    const postCloseJournal = async (
      sourceType: string,
      sourceId: number,
      description: string,
      lines: Array<{ accountId: number; debit: number; credit: number }>,
    ): Promise<number> => {
      return this.accountingPosting.postDomainJournal(queryable, {
        tenantId,
        accountId,
        entryDate,
        description,
        sourceType,
        sourceId,
        createdBy: auth.userId || null,
        lines: lines.map((line) => ({
          ...line,
          costCenterId,
          description,
          partnerType: 'none' as const,
          partnerId: null,
        })),
      });
    };

    // 1. Forex gain/loss against the carrier payable.
    let forex: { posted: boolean; amount: number; reason: string | null } = { posted: false, amount: 0, reason: null };
    const spread = roundMoney(Number(job.forex_gain_loss || 0), digits);
    if (spread !== 0) {
      const postedInvoice = await queryable
        .selectFrom('maritime_carrier_invoices')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .where('journal_entry_id', 'is not', null)
        .executeTakeFirst();
      if (!postedInvoice) {
        forex = { posted: false, amount: spread, reason: 'no posted carrier invoice to adjust' };
      } else if (await this.hasPostedCloseJournal(queryable, tenantId, 'maritime_job_forex_close', Number(job.id))) {
        forex = { posted: false, amount: spread, reason: 'already posted at an earlier close' };
      } else {
        const payableId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '2110');
        if (!payableId) throw new BadRequestException('تعذر ترحيل فرق العملة عند الإغلاق: حساب الذمم الدائنة (2110) غير متاح في شجرة الحسابات.');
        const gain = spread > 0;
        const offsetId = await this.resolveMaritimeFxOffsetAccountOn(queryable, tenantId, accountId, gain);
        const amount = Math.abs(spread);
        const entryId = await postCloseJournal(
          'maritime_job_forex_close',
          Number(job.id),
          `فرق عملة عند إغلاق الشحنة #${job.job_number}`,
          gain
            ? [
                { accountId: payableId, debit: amount, credit: 0 },
                { accountId: offsetId, debit: 0, credit: amount },
              ]
            : [
                { accountId: offsetId, debit: amount, credit: 0 },
                { accountId: payableId, debit: 0, credit: amount },
              ],
        );
        journalEntryIds.push(entryId);
        forex = { posted: true, amount: spread, reason: null };
      }
    }

    // 2. Completed trucking trips: cost only.
    let truckingCount = 0;
    let truckingAmount = 0;
    const trips = await queryable
      .selectFrom('maritime_inland_trucking_trips')
      .select(['id', 'trip_number', 'trip_status', 'cost_amount', 'currency'])
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId))
      .execute();
    for (const trip of trips) {
      if (!['delivered', 'empty_returned'].includes(String(trip.trip_status))) continue;
      const cost = Number(trip.cost_amount || 0);
      if (!(cost > 0)) continue;
      if (await this.hasPostedCloseJournal(queryable, tenantId, 'maritime_trucking_close', Number(trip.id))) continue;
      const rate = await resolveFxRate(queryable, tenantId, trip.currency || undefined);
      const baseCost = convertFxAmount(cost, rate, digits);
      if (!(baseCost > 0)) continue;
      const expenseId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '6400', '5100');
      const payableId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '2110');
      if (!expenseId || !payableId) {
        throw new BadRequestException('تعذر ترحيل تكلفة النقل البري عند الإغلاق: حساب المصروف (6400/5100) أو الذمم الدائنة (2110) غير متاح.');
      }
      const entryId = await postCloseJournal(
        'maritime_trucking_close',
        Number(trip.id),
        `تكلفة نقل بري عند إغلاق الشحنة #${job.job_number} - الرحلة ${trip.trip_number}`,
        [
          { accountId: expenseId, debit: baseCost, credit: 0 },
          { accountId: payableId, debit: 0, credit: baseCost },
        ],
      );
      journalEntryIds.push(entryId);
      truckingCount++;
      truckingAmount = roundMoney(truckingAmount + baseCost, digits);
    }

    // 3. Active cargo-insurance premiums.
    let insuranceCount = 0;
    let insuranceAmount = 0;
    const policies = await queryable
      .selectFrom('maritime_cargo_insurances')
      .select(['id', 'policy_number', 'premium_amount', 'currency', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId) as any)
      .execute();
    for (const policy of policies) {
      if (String(policy.status) !== 'active') continue;
      const premium = Number(policy.premium_amount || 0);
      if (!(premium > 0)) continue;
      if (await this.hasPostedCloseJournal(queryable, tenantId, 'maritime_insurance_close', Number(policy.id))) continue;
      const rate = await resolveFxRate(queryable, tenantId, policy.currency || undefined);
      const basePremium = convertFxAmount(premium, rate, digits);
      if (!(basePremium > 0)) continue;
      const expenseId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '6400', '5100');
      const payableId = await this.resolveMaritimeAccountIdOn(queryable, tenantId, '2110');
      if (!expenseId || !payableId) {
        throw new BadRequestException('تعذر ترحيل قسط التأمين عند الإغلاق: حساب المصروف (6400/5100) أو الذمم الدائنة (2110) غير متاح.');
      }
      const entryId = await postCloseJournal(
        'maritime_insurance_close',
        Number(policy.id),
        `قسط تأمين بضائع عند إغلاق الشحنة #${job.job_number} - الوثيقة ${policy.policy_number}`,
        [
          { accountId: expenseId, debit: basePremium, credit: 0 },
          { accountId: payableId, debit: 0, credit: basePremium },
        ],
      );
      journalEntryIds.push(entryId);
      insuranceCount++;
      insuranceAmount = roundMoney(insuranceAmount + basePremium, digits);
    }

    // 4. Roll the posted costs into the job P&L by the same formula
    // the carrier-invoice and expense paths use.
    postedCosts = roundMoney(truckingAmount + insuranceAmount, digits);
    if (postedCosts > 0) {
      const fresh = await queryable
        .selectFrom('maritime_jobs')
        .select(['client_invoiced_total', 'carrier_cost_total', 'other_costs_total'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(jobId) as any)
        .executeTakeFirstOrThrow();
      const newOther = roundMoney(Number(fresh.other_costs_total || 0) + postedCosts, digits);
      const newNet = roundMoney(Number(fresh.client_invoiced_total || 0) - (Number(fresh.carrier_cost_total || 0) + newOther), digits);
      await queryable
        .updateTable('maritime_jobs')
        .set({ other_costs_total: newOther, net_profit: newNet, updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(jobId) as any)
        .execute();
    }

    return {
      posted: journalEntryIds.length > 0,
      journalEntryIds,
      forex,
      trucking: { postedCount: truckingCount, amount: truckingAmount },
      insurance: { postedCount: insuranceCount, amount: insuranceAmount },
    };
  }

  // ==========================================
  // 2. Consolidation & Sub-Jobs (LCL Multi-HBL)
  // ==========================================

  async listConsolidationSubJobs(auth: AuthContext, parentJobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('parent_job_id', '=', String(parentJobId))
      .orderBy('id', 'desc')
      .execute();
  }

  async createConsolidationSubJob(auth: AuthContext, parentJobId: string | number, dto: Partial<CreateMaritimeJobDto>) {
    const { tenantId } = requireTenantScope(auth);
    const parentJob = await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(parentJobId) as any)
      .executeTakeFirst();

    if (!parentJob) throw new NotFoundException('Parent Master Job not found');

    const subJobDto: CreateMaritimeJobDto = {
      ...dto,
      parentJobId: String(parentJobId),
      isConsolidationMaster: false,
      customerName: dto.customerName || 'عميل تجزئة مشترك',
      shippingLineName: parentJob.shipping_line_name,
      shippingLineId: parentJob.shipping_line_id,
      polCode: parentJob.pol_code,
      polName: parentJob.pol_name,
      podCode: parentJob.pod_code,
      podName: parentJob.pod_name,
      vesselName: parentJob.vessel_name || undefined,
      voyageNumber: parentJob.voyage_number || undefined,
      bookingNumber: parentJob.booking_number || undefined,
      mblNumber: parentJob.mbl_number || undefined,
      direction: parentJob.direction,
      transportMode: parentJob.transport_mode,
      etd: parentJob.etd || undefined,
      eta: parentJob.eta || undefined,
    } as CreateMaritimeJobDto;

    return await this.createJob(auth, subJobDto);
  }

  // ==========================================
  // 3. Digital Shipment e-Folder / Document Binder
  // ==========================================

  async listJobDocuments(auth: AuthContext, jobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_job_documents')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId) as any)
      .orderBy('id', 'desc')
      .execute();
  }

  async createJobDocument(auth: AuthContext, jobId: string | number, dto: CreateJobDocumentDto, uploadedBy?: string) {
    const { tenantId } = requireTenantScope(auth);
    const [doc] = await this.db
      .insertInto('maritime_job_documents')
      .values({
        tenant_id: tenantId,
        job_id: String(jobId),
        doc_type: dto.docType,
        title: dto.title,
        file_name: dto.fileName,
        file_url: dto.fileUrl,
        file_size_bytes: dto.fileSizeBytes || 0,
        mime_type: dto.mimeType || 'application/pdf',
        notes: dto.notes || null,
        uploaded_by: uploadedBy || (auth.userId ? `User #${auth.userId}` : 'Admin'),
      })
      .returningAll()
      .execute();

    return doc;
  }

  async deleteJobDocument(auth: AuthContext, jobId: string | number, docId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    await this.db
      .deleteFrom('maritime_job_documents')
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(jobId) as any)
      .where('id', '=', String(docId) as any)
      .execute();

    return { success: true };
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

  // ==========================================
  // 5. Inland Trucking Trips & Container Dispatch
  // ==========================================

  async listInlandTruckingTrips(auth: AuthContext, jobId?: string | number) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_inland_trucking_trips')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (jobId) {
      query = query.where('job_id', '=', String(jobId));
    }

    return await query.orderBy('id', 'desc').execute();
  }

  async createInlandTruckingTrip(auth: AuthContext, dto: CreateInlandTruckingTripDto) {
    const { tenantId } = requireTenantScope(auth);
    const tempTripNumber = `TRIP-TMP-${crypto.randomUUID()}`;

    return await this.db.transaction().execute(async (trx) => {
      const [trip] = await trx
        .insertInto('maritime_inland_trucking_trips')
        .values({
          tenant_id: tenantId,
          job_id: String(dto.jobId),
          trip_number: tempTripNumber,
          container_number: dto.containerNumber || null,
          trucking_company: dto.truckingCompany,
          driver_name: dto.driverName,
          driver_phone: dto.driverPhone || null,
          truck_plate: dto.truckPlate,
          trailer_plate: dto.trailerPlate || null,
          origin_port_terminal: dto.originPortTerminal,
          delivery_destination: dto.deliveryDestination,
          dispatch_date: dto.dispatchDate ? new Date(dto.dispatchDate) : sql`NOW()`,
          delivery_date: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          trip_status: 'assigned',
          cost_amount: Number(dto.costAmount || 0),
          sell_amount: Number(dto.sellAmount || 0),
          currency: dto.currency || 'EGP',
          notes: dto.notes || null,
        })
        .returningAll()
        .execute();

      const finalTripNumber = formatDailyDocumentNumber('TRIP', Number(trip.id), new Date(), 4, await getTenantTimezone(trx, tenantId));

      const [updatedTrip] = await trx
        .updateTable('maritime_inland_trucking_trips')
        .set({ trip_number: finalTripNumber })
        .where('id', '=', trip.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      // If job exists, register milestone on the job
      const job = await trx
        .selectFrom('maritime_jobs')
        .select(['id', 'transport_mode', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(dto.jobId) as any)
        .executeTakeFirst();

      if (job) {
        if (job.status === 'completed') {
          throw new BadRequestException('أعد فتح الشحنة قبل إضافة رحلة نقل بري جديدة');
        }
        await trx
          .insertInto('maritime_job_milestones')
          .values({
            tenant_id: tenantId,
            job_id: String(job.id),
            milestone_key: 'TRK_ASSIGN',
            milestone_title: `تعيين الشاحنة والسائق للرحلة ${finalTripNumber} (${dto.truckPlate})`,
            location: dto.originPortTerminal,
            notes: `تم تكليف الشاحنة ${dto.truckPlate} والسائق ${dto.driverName} بالتحرك من ${dto.originPortTerminal} إلى ${dto.deliveryDestination}`,
            recorded_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();

        if (job.transport_mode === 'road') {
          await trx
            .updateTable('maritime_jobs')
            .set({ milestone_status: 'TRK_ASSIGN' })
            .where('id', '=', job.id)
            .where('tenant_id', '=', tenantId)
            .execute();
        }
      }

      return updatedTrip;
    });
  }

  async updateInlandTruckingTripStatus(auth: AuthContext, id: string | number, dto: UpdateInlandTruckingTripStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      const trip = await trx.selectFrom('maritime_inland_trucking_trips').selectAll()
        .where('tenant_id', '=', tenantId).where('id', '=', String(id) as any)
        .forUpdate().executeTakeFirst();
      if (!trip) throw new NotFoundException('Inland trucking trip not found');
      const job = await trx.selectFrom('maritime_jobs').select(['transport_mode', 'gross_weight_kg', 'total_cbm', 'booking_number'])
        .where('tenant_id', '=', tenantId).where('id', '=', trip.job_id as any).executeTakeFirst();
      if (job?.transport_mode === 'road' && dto.tripStatus === 'in_transit') {
        const assigned = await trx.selectFrom('maritime_inland_trucking_trips').select('truck_plate')
          .where('tenant_id', '=', tenantId).where('job_id', '=', trip.job_id)
          .where('trip_status', 'in', ['assigned', 'loading', 'in_transit']).execute();
        try {
          calculateTrucksRequired({ grossWeightKg: Number(job.gross_weight_kg || 0),
            totalCbm: Number(job.total_cbm || 0),
            assignedTrucks: new Set(assigned.map((row) => row.truck_plate)).size });
        } catch (error: any) {
          throw new BadRequestException(error.message);
        }
      }
      if (job?.transport_mode === 'road' && dto.tripStatus === 'delivered') {
        await this.assertRoadProofOfDelivery(tenantId, trip.job_id, job.booking_number);
      }
      const [updated] = await trx
        .updateTable('maritime_inland_trucking_trips')
        .set({
          trip_status: dto.tripStatus,
          delivery_date: dto.deliveryDate ? new Date(dto.deliveryDate) : undefined,
          notes: dto.notes !== undefined ? dto.notes : undefined,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(id) as any)
        .returningAll()
        .execute();

      if (!updated) {
        throw new NotFoundException('Inland trucking trip not found');
      }

      // Map trip status to job milestone progression
      const statusMilestoneMap: Record<string, { key: string; title: string }> = {
        loading: { key: 'TRK_LOADED', title: `إتمام تحميل وتربيط البضاعة بالشاحنة (Cargo Loaded - ${updated.trip_number})` },
        in_transit: { key: 'TRK_DISPATCH', title: `انطلاق الشاحنة على مسار النقل (Truck In Transit - ${updated.trip_number})` },
        delivered: { key: 'TRK_POD', title: `وصول الشاحنة وتفريغ وتسليم البضاعة وإثبات التسليم (Delivered & POD - ${updated.trip_number})` },
      };

      const mapping = statusMilestoneMap[dto.tripStatus];
      if (mapping) {
        await trx
          .insertInto('maritime_job_milestones')
          .values({
            tenant_id: tenantId,
            job_id: String(updated.job_id),
            milestone_key: mapping.key,
            milestone_title: mapping.title,
            location: dto.tripStatus === 'delivered' ? updated.delivery_destination : updated.origin_port_terminal,
            notes: dto.notes || `تم تحديث حالة رحلة النقل البري ${updated.trip_number} إلى ${dto.tripStatus}`,
            recorded_by: auth.userId ? Number(auth.userId) : null,
          })
          .execute();

        await trx
          .updateTable('maritime_jobs')
          .set({ milestone_status: mapping.key })
          .where('id', '=', String(updated.job_id) as any)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      return updated;
    });
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
