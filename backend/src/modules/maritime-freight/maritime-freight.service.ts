import { calculateCarrierCreditBaseAmount } from './engines/carrier-credit.engine';
import { assertBusinessAccountingDate } from '../accounting/accounting-boundaries';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { ensureDomainSupplier } from '../accounting/partner-subledger';
import { lockAccountingPeriod } from '../accounting/accounting-period-lock';
import { resolveFxRate } from '../accounting/fx-rate-resolution';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { convertFxAmount } from '../accounting/engines/fx-conversion.engine';
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
import { DCSA_STANDARD_MILESTONES, DcsaMilestoneKey, ShipmentMilestoneKey, RoadMilestoneKey, ROAD_FREIGHT_MILESTONES, MaritimePipelineConfig, DEFAULT_PIPELINE_CONFIG } from './maritime-freight.types';
import {
  calculateAirChargeableWeight,
  calculateAirFreightCost,
  validateIataAwbNumber,
  IATA_CARGO_IQ_MILESTONES,
} from './engines/air-freight.engine';
import {
  calculateTrucksRequired,
  calculateRoadFreightCost,
  validateCmrWaybillNumber,
  STANDARD_TRUCK_SPECIFICATIONS,
} from './engines/road-freight.engine';
import * as crypto from 'crypto';
import {
  DEFAULT_SHIPPING_LINES,
  DEFAULT_OVERSEAS_AGENTS,
  DEFAULT_SHIPPING_PORTS,
  DEFAULT_AIRLINES,
  DEFAULT_CARGO_AIRPORTS,
  DEFAULT_TRUCKING_COMPANIES,
  DEFAULT_DRY_PORTS_DEPOTS,
  DEFAULT_CONTAINER_TYPES,
  DEFAULT_INCOTERMS,
  DEFAULT_PORT_TERMINALS,
} from './maritime-defaults.data';
import { MaritimeMailService } from './maritime-mail.service';
import { WhatsAppGatewayService } from '../settings/services/whatsapp-gateway.service';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { calculateFreightAudit, validateMakerCheckerOverride } from './engines/freight-audit.engine';
import { checkInsuranceClaim } from './engines/cargo-insurance.engine';
import { QuotationChargeDto, JobChargeDto, UpdateJobChargesDto } from './dto/itemized-charges.dto';
import { CreateJobDocumentDto } from './dto/job-document.dto';
import { CreateAgentSettlementDto, UpdateAgentSettlementStatusDto } from './dto/agent-settlement.dto';
import { CreateInlandTruckingTripDto, UpdateInlandTruckingTripStatusDto } from './dto/inland-trucking.dto';
import { CarrierTrackingEventDto } from './dto/carrier-tracking.dto';

@Injectable()
export class MaritimeFreightService {
  private readonly logger = new Logger(MaritimeFreightService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly maritimeMailService: MaritimeMailService,
    private readonly whatsAppGatewayService: WhatsAppGatewayService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  private async assertJobCanClose(tenantId: string, jobId: string) {
    const [unbilledCharge, unpostedCarrierInvoice, journals, containers, invoicedCharges] = await Promise.all([
      this.db.selectFrom('maritime_job_charges').select('id').where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId).where('is_invoiced', '=', false)
        .where((eb) => eb.or([eb('cost_amount', '>', 0), eb('sell_amount', '>', 0)]))
        .executeTakeFirst(),
      this.db.selectFrom('maritime_carrier_invoices').select('id').where('tenant_id', '=', tenantId)
        .where('job_id', '=', jobId).where('journal_entry_id', 'is', null).executeTakeFirst(),
      this.db.selectFrom('journal_entries as je')
        .innerJoin('journal_entry_lines as jl', (join: any) => join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'))
        .select(['je.source_type', 'jl.debit', 'jl.credit'])
        .where('je.tenant_id', '=', tenantId).where('je.source_id', '=', Number(jobId))
        .where('je.status', '=', 'posted')
        .where('je.source_type', 'in', ['maritime_job', 'maritime_job_expense', 'maritime_carrier_invoice'])
        .execute(),
      this.db.selectFrom('maritime_containers').select(['return_deadline', 'empty_returned_at', 'demurrage_rate_per_day'])
        .where('tenant_id', '=', tenantId).where('job_id', '=', jobId).execute(),
      this.db.selectFrom('maritime_job_charges').select(['charge_code', 'charge_name_en', 'sell_amount', 'cost_amount', 'currency'])
        .where('tenant_id', '=', tenantId).where('job_id', '=', jobId).where('is_invoiced', '=', true).execute(),
    ]);
    if (unbilledCharge || unpostedCarrierInvoice) {
      throw new BadRequestException('لا يمكن إغلاق الشحنة: توجد تكاليف غير مفوترة أو فاتورة ناقل غير مرحلة');
    }
    const expenses = journals.filter((row) => row.source_type !== 'maritime_job')
      .reduce((sum, row) => sum + Number(row.debit || 0), 0);
    const billed = journals.filter((row) => row.source_type === 'maritime_job')
      .reduce((sum, row) => sum + Number(row.credit || 0), 0);
    if (expenses > billed + 0.01) {
      throw new BadRequestException('لا يمكن إغلاق الشحنة: المصروفات المرحلة تتجاوز فواتير العميل المرحلة');
    }
    let chargeCostsBase = 0;
    for (const charge of invoicedCharges) {
      chargeCostsBase += Number(charge.cost_amount || 0) *
        await this.resolveFreightExchangeRate(tenantId, charge.currency);
    }
    if (chargeCostsBase > billed + 0.01) {
      throw new BadRequestException('لا يمكن إغلاق الشحنة: تكاليف بنود التشغيل تتجاوز الفواتير المرحلة للعميل');
    }
    const hasDueDemurrage = containers.some((container) => container.return_deadline &&
      new Date(container.empty_returned_at || Date.now()).toISOString().slice(0, 10) > container.return_deadline &&
      Number(container.demurrage_rate_per_day || 0) > 0);
    if (hasDueDemurrage && (billed <= 0 || !invoicedCharges.some((charge) =>
      /DEM|DETENTION/i.test(`${charge.charge_code} ${charge.charge_name_en}`) && Number(charge.sell_amount) > 0))) {
      throw new BadRequestException('لا يمكن إغلاق الشحنة: غرامات الحاويات المستحقة لم تُفوتر للعميل');
    }
  }

  private async assertRoadProofOfDelivery(tenantId: string, jobId: string, bookingNumber: string | null | undefined) {
    const cmr = validateCmrWaybillNumber(bookingNumber || '');
    if (!cmr.valid || !cmr.isInternationalCmr) {
      throw new BadRequestException('لا يمكن تأكيد تسليم الشحنة البرية دون رقم بوليصة CMR مكتمل');
    }
    const documents = await this.db.selectFrom('maritime_job_documents')
      .select(['doc_type', 'title', 'file_url']).where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobId).execute();
    if (!documents.some((doc) => /POD|SIGNED.?CMR|إثبات التسليم/i.test(`${doc.doc_type} ${doc.title}`) &&
      /^(https?:\/\/|s3:\/\/)/i.test(doc.file_url))) {
      throw new BadRequestException('يرجى إرفاق مستند إثبات التسليم POD أو بوليصة CMR موقعة قبل التسليم');
    }
  }

  private async assertUniqueMasterBl(tenantId: string, mbl: string | null | undefined, jobId?: string, parentJobId?: string | null, trx?: any) {
    const normalized = mbl?.trim().toUpperCase();
    if (!normalized) return;
    const existing: Array<{ id: string; parent_job_id: string | null }> = await (trx || this.db).selectFrom('maritime_jobs').select(['id', 'parent_job_id'])
      .where('tenant_id', '=', tenantId).where(sql<string>`UPPER(TRIM(mbl_number))`, '=', normalized)
      .execute();
    const familyId = parentJobId || jobId;
    if (existing.some((row) => String(row.id) !== jobId &&
      !(familyId && (String(row.id) === String(familyId) || row.parent_job_id === familyId)))) {
      throw new BadRequestException('رقم بوليصة الشحن الرئيسية Master B/L مستخدم في أمر شحن آخر');
    }
  }

  private async postContainerDepositJournal(
    trx: any, tenantId: string, containerId: string, amount: number, currency: string,
    event: 'open' | 'refund' | 'forfeit', userId: number,
  ) {
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('مبلغ تأمين الحاوية غير صالح');
    const assetId = await this.resolveAccountId(tenantId, '1170');
    const otherId = await this.resolveAccountId(tenantId, event === 'forfeit' ? '6400' : '1110');
    if (!assetId || !otherId) throw new BadRequestException('حساب أمانات الحاويات أو الخزينة/المصروف غير متاح');
    let baseAmount: number;
    if (event === 'open') {
      // INV-MARITIME-DEPOSIT-FX-CONVERSION: resolve through the shared
      // resolver on the same transaction and convert at the base
      // currency's book digits. A settings/rate mismatch now fails
      // closed through tenantBaseCurrency instead of silently using
      // the row's is_base flag, and the missing-rate message is the
      // resolver's. The refund/forfeit branches below are unchanged:
      // they reuse the opening journal's stored debit.
      const rate = await resolveFxRate(trx, tenantId, currency);
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      baseAmount = convertFxAmount(amount, rate, digits);
    } else {
      const opening = await trx.selectFrom('journal_entries as je')
        .innerJoin('journal_entry_lines as jl', (join: any) => join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'))
        .select('jl.debit').where('je.tenant_id', '=', tenantId)
        .where('je.source_type', '=', 'maritime_container_deposit_open')
        .where('je.source_id', '=', Number(containerId)).where('je.status', '=', 'posted')
        .where('jl.account_id', '=', assetId).executeTakeFirst();
      if (!opening || Number(opening.debit) <= 0) {
        throw new BadRequestException('يلزم إثبات قيد دفع تأمين الحاوية قبل تسجيل الاسترداد أو المصادرة');
      }
      baseAmount = Number(opening.debit);
    }
    const entryDate = new Date();
    await this.assertMaritimeJournalPeriodOpen(trx, tenantId, entryDate);
    const description = `تأمين حاوية ${containerId}: ${event} (${amount} ${currency})`;
    await this.accountingPosting.postDomainJournal(trx, {
      tenantId, accountId: tenantId, entryDate, description,
      sourceType: `maritime_container_deposit_${event}`, sourceId: Number(containerId), createdBy: userId,
      lines: [
        { accountId: event === 'open' ? assetId : otherId, description, debit: baseAmount, credit: 0, partnerType: 'none', partnerId: null },
        { accountId: event === 'open' ? otherId : assetId, description, debit: 0, credit: baseAmount, partnerType: 'none', partnerId: null },
      ],
    });
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

  /**
   * Ensures hardcoded master catalog (14 shipping lines, 27 overseas agents, 18 ports)
   * is seeded for the specified tenant. If records are missing, it safely seeds them
   * without overwriting existing client modifications.
   */
  async ensureDefaultMasterData(tenantId: string): Promise<{ portsAdded: number; linesAdded: number; agentsAdded: number; airlinesAdded: number; airportsAdded: number; truckingAdded: number; dryPortsAdded: number }> {
    if (!tenantId) return { portsAdded: 0, linesAdded: 0, agentsAdded: 0, airlinesAdded: 0, airportsAdded: 0, truckingAdded: 0, dryPortsAdded: 0 };

    let portsAdded = 0;
    let linesAdded = 0;
    let agentsAdded = 0;
    let airlinesAdded = 0;
    let airportsAdded = 0;
    let truckingAdded = 0;
    let dryPortsAdded = 0;

    try {
      // 1. Check & Seed Ports for this tenant
      const existingPorts = await this.db
        .selectFrom('shipping_ports')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .execute();

      const existingPortCodes = new Set(existingPorts.map((p) => p.code));
      const missingPorts = DEFAULT_SHIPPING_PORTS.filter((p) => !existingPortCodes.has(p.code));

      for (const port of missingPorts) {
        await sql`
          INSERT INTO shipping_ports (tenant_id, code, name_ar, name_en, country_code, country_name, port_type, is_active)
          VALUES (${tenantId}, ${port.code}, ${port.name_ar}, ${port.name_en}, ${port.country_code}, ${port.country_name}, 'sea', true)
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        portsAdded++;
      }

      // 2. Check & Seed Shipping Lines for this tenant
      const existingLines = await this.db
        .selectFrom('shipping_lines')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('carrier_type', '=', 'shipping_line')
        .execute();

      const existingLineCodes = new Set(existingLines.map((l) => l.code));
      const missingLines = DEFAULT_SHIPPING_LINES.filter((l) => !existingLineCodes.has(l.code));

      for (const line of missingLines) {
        await sql`
          INSERT INTO shipping_lines (
            tenant_id, code, name_ar, name_en, carrier_type, country_name, country_code,
            city_name, contact_person, email, rfq_email, booking_email, phone, whatsapp,
            wechat, trade_lanes, services_offered, supported_ports, notes, is_active
          )
          VALUES (
            ${tenantId}, ${line.code}, ${line.name_ar}, ${line.name_en}, 'shipping_line',
            ${line.country_name || null}, ${line.country_code || null}, ${line.city_name || null},
            ${line.contact_person || null}, ${line.email || null}, ${line.rfq_email || null},
            ${line.booking_email || null}, ${line.phone || null}, ${line.whatsapp || null},
            ${line.wechat || null}, ${line.trade_lanes || null}, ${line.services_offered || null},
            ${line.supported_ports || null}, ${line.notes || null}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        linesAdded++;
      }

      // 3. Check & Seed Overseas Agents for this tenant
      const existingAgents = await this.db
        .selectFrom('shipping_lines')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('carrier_type', '=', 'overseas_agent')
        .execute();

      const existingAgentCodes = new Set(existingAgents.map((a) => a.code));
      const missingAgents = DEFAULT_OVERSEAS_AGENTS.filter((a) => !existingAgentCodes.has(a.code));

      for (const agent of missingAgents) {
        await sql`
          INSERT INTO shipping_lines (
            tenant_id, code, name_ar, name_en, carrier_type, country_name, country_code,
            city_name, contact_person, email, rfq_email, booking_email, phone, whatsapp,
            wechat, trade_lanes, services_offered, supported_ports, notes, is_active
          )
          VALUES (
            ${tenantId}, ${agent.code}, ${agent.name_ar}, ${agent.name_en}, 'overseas_agent',
            ${agent.country_name || null}, ${agent.country_code || null}, ${agent.city_name || null},
            ${agent.contact_person || null}, ${agent.email || null}, ${agent.rfq_email || null},
            ${agent.booking_email || null}, ${agent.phone || null}, ${agent.whatsapp || null},
            ${agent.wechat || null}, ${agent.trade_lanes || null}, ${agent.services_offered || null},
            ${agent.supported_ports || null}, ${agent.notes || null}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        agentsAdded++;
      }

      // 4. Check & Seed Airlines for this tenant
      const existingAirlines = await this.db
        .selectFrom('shipping_lines')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('carrier_type', '=', 'airline')
        .execute();

      const existingAirlineCodes = new Set(existingAirlines.map((l) => l.code));
      const missingAirlines = DEFAULT_AIRLINES.filter((l) => !existingAirlineCodes.has(l.code));

      for (const airline of missingAirlines) {
        await sql`
          INSERT INTO shipping_lines (
            tenant_id, code, name_ar, name_en, carrier_type, airline_prefix, country_name, country_code,
            city_name, contact_person, email, rfq_email, booking_email, phone,
            trade_lanes, services_offered, notes, is_active
          )
          VALUES (
            ${tenantId}, ${airline.code}, ${airline.name_ar}, ${airline.name_en}, 'airline',
            ${airline.airline_prefix || null}, ${airline.country_name || null}, ${airline.country_code || null},
            ${airline.city_name || null}, ${airline.contact_person || null}, ${airline.email || null},
            ${airline.rfq_email || null}, ${airline.booking_email || null}, ${airline.phone || null},
            ${airline.trade_lanes || null}, ${airline.services_offered || null},
            ${airline.notes || null}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        airlinesAdded++;
      }

      // 5. Check & Seed Cargo Airports for this tenant
      const existingAirports = await this.db
        .selectFrom('shipping_ports')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where((eb) => eb.or([
          eb('port_type', '=', 'air'),
          eb('iata_code', 'is not', null)
        ]))
        .execute();

      const existingAirportCodes = new Set(existingAirports.map((p) => p.code));
      const missingAirports = DEFAULT_CARGO_AIRPORTS.filter((p) => !existingAirportCodes.has(p.code));

      for (const airport of missingAirports) {
        await sql`
          INSERT INTO shipping_ports (
            tenant_id, code, name_ar, name_en, country_code, country_name, port_type, iata_code, is_active
          )
          VALUES (
            ${tenantId}, ${airport.code}, ${airport.name_ar}, ${airport.name_en}, ${airport.country_code},
            ${airport.country_name}, 'air', ${airport.iata_code || airport.code}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        airportsAdded++;
      }

      // 6. Check & Seed Trucking Companies for this tenant
      const existingTrucking = await this.db
        .selectFrom('shipping_lines')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('carrier_type', '=', 'trucking')
        .execute();

      const existingTruckingCodes = new Set(existingTrucking.map((t) => t.code));
      const missingTrucking = DEFAULT_TRUCKING_COMPANIES.filter((t) => !existingTruckingCodes.has(t.code));

      for (const trucking of missingTrucking) {
        await sql`
          INSERT INTO shipping_lines (
            tenant_id, code, name_ar, name_en, carrier_type, country_name, country_code,
            city_name, contact_person, email, rfq_email, booking_email, phone, whatsapp,
            trade_lanes, services_offered, notes, is_active
          )
          VALUES (
            ${tenantId}, ${trucking.code}, ${trucking.name_ar}, ${trucking.name_en}, 'trucking',
            ${trucking.country_name || null}, ${trucking.country_code || null},
            ${trucking.city_name || null}, ${trucking.contact_person || null}, ${trucking.email || null},
            ${trucking.rfq_email || null}, ${trucking.booking_email || null}, ${trucking.phone || null}, ${trucking.whatsapp || null},
            ${trucking.trade_lanes || null}, ${trucking.services_offered || null},
            ${trucking.notes || null}, true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        truckingAdded++;
      }

      // 7. Check & Seed Dry Ports & Inland Depots for this tenant
      const existingDryPorts = await this.db
        .selectFrom('shipping_ports')
        .select('code')
        .where('tenant_id', '=', tenantId)
        .where('port_type', '=', 'land')
        .execute();

      const existingDryPortCodes = new Set(existingDryPorts.map((p) => p.code));
      const missingDryPorts = DEFAULT_DRY_PORTS_DEPOTS.filter((p) => !existingDryPortCodes.has(p.code));

      for (const dryPort of missingDryPorts) {
        await sql`
          INSERT INTO shipping_ports (
            tenant_id, code, name_ar, name_en, country_code, country_name, port_type, is_active
          )
          VALUES (
            ${tenantId}, ${dryPort.code}, ${dryPort.name_ar}, ${dryPort.name_en}, ${dryPort.country_code},
            ${dryPort.country_name}, 'land', true
          )
          ON CONFLICT (tenant_id, code) DO NOTHING
        `.execute(this.db);
        dryPortsAdded++;
      }

      if (portsAdded > 0 || linesAdded > 0 || agentsAdded > 0 || airlinesAdded > 0 || airportsAdded > 0 || truckingAdded > 0 || dryPortsAdded > 0) {
        this.logger.log(`Seeded maritime defaults for tenant ${tenantId}: ports=${portsAdded}, lines=${linesAdded}, agents=${agentsAdded}, airlines=${airlinesAdded}, airports=${airportsAdded}, trucking=${truckingAdded}, dryPorts=${dryPortsAdded}`);
      }
    } catch (err) {
      this.logger.error(`Error ensuring maritime defaults for tenant ${tenantId}:`, err);
    }

    return { portsAdded, linesAdded, agentsAdded, airlinesAdded, airportsAdded, truckingAdded, dryPortsAdded };
  }

  async seedDefaultMasterData(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    return await this.ensureDefaultMasterData(tenantId);
  }

  async getCounts(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);

    const [inquiries, rfqs, bids, quotes, jobs, containers, ports, lines] = await Promise.all([
      this.db
        .selectFrom('maritime_inquiries')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_rfqs')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_rfq_bids')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_quotations')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_jobs')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('maritime_containers')
        .where('tenant_id', '=', tenantId)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('shipping_ports')
        .where((eb) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', '=', 'default')]))
        .where('is_active', '=', true)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
      this.db
        .selectFrom('shipping_lines')
        .where((eb) => eb.or([eb('tenant_id', '=', tenantId), eb('tenant_id', '=', 'default')]))
        .where('is_active', '=', true)
        .select(this.db.fn.countAll().as('count'))
        .executeTakeFirst(),
    ]);

    return {
      inquiries: Number(inquiries?.count || 0),
      rfqs: Number(rfqs?.count || 0),
      matrixBids: Number(bids?.count || 0),
      quotations: Number(quotes?.count || 0),
      jobs: Number(jobs?.count || 0),
      containers: Number(containers?.count || 0),
      master: Number(ports?.count || 0) + Number(lines?.count || 0),
      settings: 0,
    };
  }

  // --------------------------------------------------------------------------
  // 1. Ports Master Data
  // --------------------------------------------------------------------------
  async getPorts(auth: AuthContext) {
    const { tenantId } = requireTenantScope(auth);
    await this.ensureDefaultMasterData(tenantId);
    const tenantPorts = await this.db
      .selectFrom('shipping_ports')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .orderBy('name_ar', 'asc')
      .execute();

    if (tenantPorts.length > 0) {
      return tenantPorts;
    }

    return await this.db
      .selectFrom('shipping_ports')
      .selectAll()
      .where('tenant_id', '=', 'default')
      .where('is_active', '=', true)
      .orderBy('name_ar', 'asc')
      .execute();
  }

  async createPort(auth: AuthContext, data: { code: string; nameAr: string; nameEn: string; countryCode: string; countryName: string }) {
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('shipping_ports')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', data.code.toUpperCase())
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(`Port with UN/LOCODE ${data.code} already exists`);
    }

    const [inserted] = await this.db
      .insertInto('shipping_ports')
      .values({
        tenant_id: tenantId,
        code: data.code.toUpperCase(),
        name_ar: data.nameAr,
        name_en: data.nameEn,
        country_code: data.countryCode.toUpperCase(),
        country_name: data.countryName,
        is_active: true,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  // --------------------------------------------------------------------------
  // 2. Shipping Lines Master Data
  // --------------------------------------------------------------------------
  async getShippingLines(auth: AuthContext, filters?: { carrierType?: string; tradeLane?: string; countryCode?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    await this.ensureDefaultMasterData(tenantId);

    const buildQuery = (scopedTenantId: string) => {
      let q = this.db
        .selectFrom('shipping_lines')
        .selectAll()
        .where('tenant_id', '=', scopedTenantId)
        .where('is_active', '=', true);

      if (filters?.carrierType && filters.carrierType !== 'all') {
        q = q.where('carrier_type', '=', filters.carrierType as any);
      }

      if (filters?.tradeLane && filters.tradeLane !== 'all') {
        q = q.where('trade_lanes', 'like', `%${filters.tradeLane}%`);
      }

      if (filters?.countryCode && filters.countryCode !== 'all') {
        q = q.where('country_code', '=', filters.countryCode.toUpperCase());
      }

      if (filters?.search) {
        const term = `%${filters.search}%`;
        q = q.where((eb) => eb.or([
          eb('code', 'ilike', term),
          eb('name_ar', 'ilike', term),
          eb('name_en', 'ilike', term),
          eb('contact_person', 'ilike', term),
          eb('country_name', 'ilike', term),
          eb('city_name', 'ilike', term),
          eb('rfq_email', 'ilike', term)
        ]));
      }

      return q.orderBy('carrier_type', 'asc').orderBy('name_ar', 'asc');
    };

    const tenantLines = await buildQuery(tenantId).execute();
    if (tenantLines.length > 0) {
      return tenantLines;
    }

    // Fallback to default tenant catalog if tenant has not yet seeded
    return await buildQuery('default').execute();
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
    const { tenantId } = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('shipping_lines')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('code', '=', data.code.toUpperCase())
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException(`Carrier/Agent with code ${data.code} already exists`);
    }

    const [inserted] = await this.db
      .insertInto('shipping_lines')
      .values({
        tenant_id: tenantId,
        code: data.code.toUpperCase(),
        name_ar: data.nameAr,
        name_en: data.nameEn || data.nameAr,
        carrier_type: data.carrierType || 'shipping_line',
        trade_lanes: data.tradeLanes || null,
        country_name: data.countryName || null,
        country_code: data.countryCode ? data.countryCode.toUpperCase() : null,
        city_name: data.cityName || null,
        contact_person: data.contactPerson || null,
        email: data.email || null,
        rfq_email: data.rfqEmail || null,
        booking_email: data.bookingEmail || null,
        phone: data.phone || null,
        whatsapp: data.whatsapp || null,
        wechat: data.wechat || null,
        services_offered: data.servicesOffered || null,
        supported_ports: data.supportedPorts || null,
        notes: data.notes || null,
        is_active: true,
      })
      .returningAll()
      .execute();

    return inserted;
  }

  getReferenceData() {
    return {
      containerTypes: DEFAULT_CONTAINER_TYPES,
      incoterms: DEFAULT_INCOTERMS,
      portTerminals: DEFAULT_PORT_TERMINALS,
    };
  }

  async importCarriersBulk(auth: AuthContext, items: any[]) {
    const { tenantId } = requireTenantScope(auth);
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('قائمة البيانات المستوردة فارغة');
    }

    let insertedCount = 0;
    let updatedCount = 0;

    for (const item of items) {
      const code = String(item.code || '').trim().toUpperCase();
      const nameAr = String(item.nameAr || item.name_ar || '').trim();
      if (!code || !nameAr) continue;

      const carrierType = item.carrierType === 'overseas_agent' || item.carrier_type === 'overseas_agent'
        ? 'overseas_agent'
        : 'shipping_line';

      const existing = await this.db
        .selectFrom('shipping_lines')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('code', '=', code)
        .executeTakeFirst();

      if (existing) {
        await this.db
          .updateTable('shipping_lines')
          .set({
            name_ar: nameAr,
            name_en: item.nameEn || item.name_en || nameAr,
            carrier_type: carrierType,
            country_name: item.countryName || item.country_name || null,
            country_code: item.countryCode || item.country_code ? String(item.countryCode || item.country_code).toUpperCase() : null,
            city_name: item.cityName || item.city_name || null,
            contact_person: item.contactPerson || item.contact_person || null,
            email: item.email || null,
            rfq_email: item.rfqEmail || item.rfq_email || item.email || null,
            booking_email: item.bookingEmail || item.booking_email || null,
            phone: item.phone || null,
            whatsapp: item.whatsapp || null,
            wechat: item.wechat || null,
            trade_lanes: item.tradeLanes || item.trade_lanes || null,
            services_offered: item.servicesOffered || item.services_offered || null,
            supported_ports: item.supportedPorts || item.supported_ports || null,
            notes: item.notes || null,
            is_active: true,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', existing.id)
          .where('tenant_id', '=', tenantId)
          .execute();
        updatedCount++;
      } else {
        await this.db
          .insertInto('shipping_lines')
          .values({
            tenant_id: tenantId,
            code,
            name_ar: nameAr,
            name_en: item.nameEn || item.name_en || nameAr,
            carrier_type: carrierType,
            country_name: item.countryName || item.country_name || null,
            country_code: item.countryCode || item.country_code ? String(item.countryCode || item.country_code).toUpperCase() : null,
            city_name: item.cityName || item.city_name || null,
            contact_person: item.contactPerson || item.contact_person || null,
            email: item.email || null,
            rfq_email: item.rfqEmail || item.rfq_email || item.email || null,
            booking_email: item.bookingEmail || item.booking_email || null,
            phone: item.phone || null,
            whatsapp: item.whatsapp || null,
            wechat: item.wechat || null,
            trade_lanes: item.tradeLanes || item.trade_lanes || null,
            services_offered: item.servicesOffered || item.services_offered || null,
            supported_ports: item.supportedPorts || item.supported_ports || null,
            notes: item.notes || null,
            is_active: true,
          })
          .execute();
        insertedCount++;
      }
    }

    return { insertedCount, updatedCount, totalProcessed: insertedCount + updatedCount };
  }

  async updateShippingLine(auth: AuthContext, id: string, data: any) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await this.db
      .updateTable('shipping_lines')
      .set({
        name_ar: data.nameAr,
        name_en: data.nameEn,
        carrier_type: data.carrierType,
        trade_lanes: data.tradeLanes,
        country_name: data.countryName,
        country_code: data.countryCode ? data.countryCode.toUpperCase() : undefined,
        city_name: data.cityName,
        contact_person: data.contactPerson,
        email: data.email,
        rfq_email: data.rfqEmail,
        booking_email: data.bookingEmail,
        phone: data.phone,
        whatsapp: data.whatsapp,
        wechat: data.wechat,
        services_offered: data.servicesOffered,
        supported_ports: data.supportedPorts,
        notes: data.notes,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    return updated;
  }

  async deleteShippingLine(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await this.db
      .updateTable('shipping_lines')
      .set({ is_active: false, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .execute();

    return { success: true };
  }

  // --------------------------------------------------------------------------
  // 2.5 Maritime Client Inquiries Engine (Customer Freight Requests)
  // --------------------------------------------------------------------------
  async createInquiry(auth: AuthContext, dto: CreateMaritimeInquiryDto) {
    const { tenantId } = requireTenantScope(auth);

    const transportMode = dto.transportMode || 'sea';
    let grossWeightKg = Number(dto.grossWeightKg || 0);
    let totalCbm = Number(dto.totalCbm || dto.cbm || 0);
    let volumetricWeightKg = Number(dto.volumetricWeightKg || 0);
    let chargeableWeightKg = Number(dto.chargeableWeightKg || 0);

    if (transportMode === 'air' && (grossWeightKg > 0 || totalCbm > 0)) {
      const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
      volumetricWeightKg = Math.max(volumetricWeightKg, airCalc.volumetricWeightKg);
      chargeableWeightKg = Math.max(chargeableWeightKg, airCalc.chargeableWeightKg);
    }

    return await this.db.transaction().execute(async (trx) => {
      const tempNumber = `INQ-TMP-${crypto.randomUUID()}`;
      const [inquiry] = await trx
        .insertInto('maritime_inquiries')
        .values({
          tenant_id: tenantId,
          inquiry_number: tempNumber,
          customer_id: dto.customerId ? Number(dto.customerId) : null,
          customer_name: dto.customerName,
          customer_phone: dto.customerPhone || null,
          customer_email: dto.customerEmail || null,
          direction: dto.direction || 'import',
          transport_mode: transportMode,
          air_cargo_type: dto.airCargoType || null,
          pol_code: dto.polCode.toUpperCase(),
          pol_name: dto.polName,
          pod_code: dto.podCode.toUpperCase(),
          pod_name: dto.podName,
          incoterm: dto.incoterm || 'FOB',
          cargo_mode: dto.cargoMode || 'FCL',
          container_type: dto.containerType || '40HC',
          container_count: dto.containerCount || 1,
          commodity_description: dto.commodityDescription || '',
          cargo_nature: dto.cargoNature || 'general',
          gross_weight_kg: grossWeightKg,
          volumetric_weight_kg: volumetricWeightKg,
          chargeable_weight_kg: chargeableWeightKg,
          total_cbm: totalCbm,
          package_count: dto.packageCount ? Number(dto.packageCount) : 0,
          flight_number: dto.flightNumber || null,
          flight_date: dto.flightDate || null,
          mawb_number: dto.mawbNumber || null,
          hawb_number: dto.hawbNumber || null,
          cbm: totalCbm,
          cargo_ready_date: dto.cargoReadyDate || null,
          target_delivery_date: dto.targetDeliveryDate || null,
          target_free_days: dto.targetFreeDays || 14,
          payment_term: dto.paymentTerm || 'prepaid',
          status: 'received',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber('INQ', Number(inquiry.id));
      const [updated] = await trx
        .updateTable('maritime_inquiries')
        .set({ inquiry_number: finalNumber })
        .where('id', '=', inquiry.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      return updated;
    });
  }

  async getInquiries(auth: AuthContext, filters?: { status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_inquiries')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([
        eb('inquiry_number', 'ilike', term),
        eb('customer_name', 'ilike', term),
        eb('customer_phone', 'ilike', term),
        eb('pol_name', 'ilike', term),
        eb('pod_name', 'ilike', term),
        eb('commodity_description', 'ilike', term)
      ]));
    }

    return await query.orderBy('id', 'desc').execute();
  }

  async getInquiryById(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const inquiry = await this.db
      .selectFrom('maritime_inquiries')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!inquiry) throw new NotFoundException('Inquiry not found');
    return inquiry;
  }

  async convertInquiryToRfq(auth: AuthContext, inquiryId: string, targetLineIds?: number[]) {
    const { tenantId } = requireTenantScope(auth);
    const inquiry = await this.getInquiryById(auth, inquiryId);

    if (inquiry.rfq_id || (inquiry.status as string) === 'rfq_created' || inquiry.status === 'converted_to_job') {
      throw new BadRequestException('تم تحويل هذا الاستفسار إلى طلب تسعير (RFQ) مسبقاً');
    }

    const rfq = await this.createRfq(auth, {
      polCode: inquiry.pol_code,
      polName: inquiry.pol_name,
      podCode: inquiry.pod_code,
      podName: inquiry.pod_name,
      direction: inquiry.direction as any,
      transportMode: (inquiry.transport_mode as any) || 'sea',
      airCargoType: inquiry.air_cargo_type || undefined,
      grossWeightKg: inquiry.gross_weight_kg ? Number(inquiry.gross_weight_kg) : undefined,
      volumetricWeightKg: inquiry.volumetric_weight_kg ? Number(inquiry.volumetric_weight_kg) : undefined,
      chargeableWeightKg: inquiry.chargeable_weight_kg ? Number(inquiry.chargeable_weight_kg) : undefined,
      totalCbm: inquiry.total_cbm ? Number(inquiry.total_cbm) : (inquiry.cbm ? Number(inquiry.cbm) : undefined),
      packageCount: inquiry.package_count ? Number(inquiry.package_count) : undefined,
      flightNumber: inquiry.flight_number || undefined,
      flightDate: inquiry.flight_date || undefined,
      incoterm: inquiry.incoterm,
      cargoMode: inquiry.cargo_mode,
      containerType: inquiry.container_type,
      containerCount: inquiry.container_count,
      commodityDescription: inquiry.commodity_description,
      cargoNature: inquiry.cargo_nature,
      cargoReadyDate: inquiry.cargo_ready_date || undefined,
      targetFreeDays: inquiry.target_free_days,
      paymentTerm: inquiry.payment_term as any,
      targetLineIds: targetLineIds || [],
      inquiryId: String(inquiry.id),
      customerId: inquiry.customer_id ? Number(inquiry.customer_id) : undefined,
      customerName: inquiry.customer_name,
      customerPhone: inquiry.customer_phone || undefined,
      customerEmail: inquiry.customer_email || undefined,
      notes: `طلب تسعير مولد آلياً من استفسار العميل ${inquiry.inquiry_number}: ${inquiry.customer_name}`,
    });

    await this.db
      .updateTable('maritime_inquiries')
      .set({
        status: 'rfq_created',
        rfq_id: String(rfq.id),
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', inquiryId as any)
      .execute();

    return rfq;
  }

  // --------------------------------------------------------------------------
  // 3. Maritime RFQs Engine
  // --------------------------------------------------------------------------
  async createRfq(auth: AuthContext, dto: CreateMaritimeRfqDto) {
    const { tenantId } = requireTenantScope(auth);
    const pipelineConfig = await this.getTenantPipelineConfig(tenantId);

    const urgency = dto.urgencyLevel || 'standard';
    let cutOffDate: Date | null = null;
    if (dto.cutOffDeadline) {
      cutOffDate = new Date(dto.cutOffDeadline);
    } else {
      const hours = dto.cutOffHours && dto.cutOffHours > 0
        ? dto.cutOffHours
        : urgency === 'urgent'
          ? (pipelineConfig.rfqCutOffHoursUrgent || 6)
          : (pipelineConfig.rfqCutOffHoursStandard || 24);
      cutOffDate = new Date(Date.now() + hours * 3600 * 1000);
    }

    const transportMode = dto.transportMode || 'sea';
    let grossWeightKg = Number(dto.grossWeightKg || 0);
    let totalCbm = Number(dto.totalCbm || 0);
    let volumetricWeightKg = Number(dto.volumetricWeightKg || 0);
    let chargeableWeightKg = Number(dto.chargeableWeightKg || 0);

    if (transportMode === 'air' && (grossWeightKg > 0 || totalCbm > 0)) {
      const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
      volumetricWeightKg = Math.max(volumetricWeightKg, airCalc.volumetricWeightKg);
      chargeableWeightKg = Math.max(chargeableWeightKg, airCalc.chargeableWeightKg);
    }

    return await this.db.transaction().execute(async (trx) => {
      const tempNumber = `RFQ-TMP-${crypto.randomUUID()}`;
      const publicQuoteToken = crypto.randomBytes(16).toString('hex');
      const [rfq] = await trx
        .insertInto('maritime_rfqs')
        .values({
          tenant_id: tenantId,
          public_quote_token: publicQuoteToken,
          rfq_number: tempNumber,
          inquiry_id: dto.inquiryId ? String(dto.inquiryId) : null,
          customer_id: dto.customerId ? Number(dto.customerId) : null,
          customer_name: dto.customerName || null,
          customer_phone: dto.customerPhone || null,
          customer_email: dto.customerEmail || null,
          direction: dto.direction || 'import',
          transport_mode: transportMode,
          air_cargo_type: dto.airCargoType || null,
          gross_weight_kg: grossWeightKg,
          volumetric_weight_kg: volumetricWeightKg,
          chargeable_weight_kg: chargeableWeightKg,
          total_cbm: totalCbm,
          package_count: dto.packageCount ? Number(dto.packageCount) : 0,
          flight_number: dto.flightNumber || null,
          flight_date: dto.flightDate || null,
          mawb_number: dto.mawbNumber || null,
          hawb_number: dto.hawbNumber || null,
          pol_code: dto.polCode.toUpperCase(),
          pol_name: dto.polName,
          pod_code: dto.podCode.toUpperCase(),
          pod_name: dto.podName,
          incoterm: dto.incoterm || 'FOB',
          cargo_mode: dto.cargoMode || 'FCL',
          container_type: dto.containerType || '40HC',
          container_count: dto.containerCount || 1,
          commodity_description: dto.commodityDescription || '',
          cargo_nature: dto.cargoNature || 'general',
          cargo_ready_date: dto.cargoReadyDate || null,
          target_free_days: dto.targetFreeDays || 14,
          payment_term: dto.paymentTerm || 'prepaid',
          target_line_ids: JSON.stringify(dto.targetLineIds || []),
          status: 'draft',
          notes: dto.notes || null,
          urgency_level: urgency,
          cut_off_deadline: cutOffDate ? cutOffDate.toISOString() : null,
          auto_awarded: false,
          target_rate_max: dto.targetRateMax ? Number(dto.targetRateMax) : null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber('RFQ', Number(rfq.id));
      const [updatedRfq] = await trx
        .updateTable('maritime_rfqs')
        .set({ rfq_number: finalNumber })
        .where('id', '=', rfq.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      if (dto.inquiryId) {
        await trx
          .updateTable('maritime_inquiries')
          .set({
            status: 'rfq_created',
            rfq_id: String(rfq.id),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.inquiryId as any)
          .execute();
      }

      return updatedRfq;
    });
  }

  async getRfqs(auth: AuthContext, filters?: { status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([
        eb('rfq_number', 'ilike', term),
        eb('pol_name', 'ilike', term),
        eb('pod_name', 'ilike', term),
        eb('commodity_description', 'ilike', term)
      ]));
    }

    const rfqs = await query.orderBy('id', 'desc').execute();

    // Attach bids count and best bid to each RFQ
    const rfqIds = rfqs.map((r) => String(r.id));
    if (rfqIds.length === 0) return [];

    const bids = await this.db
      .selectFrom('maritime_rfq_bids')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('rfq_id', 'in', rfqIds)
      .execute();

    return rfqs.map((rfq) => {
      const relatedBids = bids.filter((b) => b.rfq_id === String(rfq.id));
      const comparable = new Set(relatedBids.map((b) => String(b.currency).toUpperCase())).size <= 1;
      const minBid = relatedBids.length > 0 && comparable
        ? relatedBids.reduce((prev, curr) => Number(curr.total_freight_cost) < Number(prev.total_freight_cost) ? curr : prev)
        : null;

      return {
        ...rfq,
        bidsCount: relatedBids.length,
        bestBid: minBid,
      };
    });
  }

  async getRfqById(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const rfq = await this.db
      .selectFrom('maritime_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!rfq) {
      throw new NotFoundException('Maritime RFQ not found');
    }

    const bids = await this.db
      .selectFrom('maritime_rfq_bids')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('rfq_id', '=', id)
      .orderBy('total_freight_cost', 'asc')
      .execute();

    // Highlight "Best Value": balanced by lowest cost and highest free days
    let bestValueBidId: string | null = null;
    if (bids.length > 0 && new Set(bids.map((b) => String(b.currency).toUpperCase())).size === 1) {
      // Score: lower cost is better, higher free days is better
      const scoredBids = bids.map((b) => {
        const cost = Number(b.total_freight_cost) || 1;
        const freeDays = Number(b.free_days) || 7;
        // Cost per free day ratio or normalized score
        const score = cost / Math.max(freeDays, 1);
        return { id: String(b.id), score };
      });
      scoredBids.sort((a, b) => a.score - b.score);
      bestValueBidId = scoredBids[0]?.id || null;
    }

    const bidsWithBestValue = bids.map((b) => ({
      ...b,
      isBestValue: String(b.id) === bestValueBidId,
    }));

    return {
      ...rfq,
      bids: bidsWithBestValue,
    };
  }

  async dispatchRfqEmails(auth: AuthContext, rfqId: string, customLineIds?: number[]) {
    const { tenantId } = requireTenantScope(auth);
    const rfq = await this.db
      .selectFrom('maritime_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', rfqId as any)
      .executeTakeFirst();

    if (!rfq) throw new NotFoundException('RFQ not found');

    const lineIds: number[] = Array.isArray(customLineIds) && customLineIds.length > 0
      ? customLineIds
      : (Array.isArray(rfq.target_line_ids) ? rfq.target_line_ids : []);

    if (lineIds.length === 0) {
      return { sentCount: 0, message: 'No target shipping lines selected' };
    }

    const carriers = await this.db
      .selectFrom('shipping_lines')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', lineIds.map(String) as any)
      .execute();
    if (new Set(carriers.map((carrier) => String(carrier.id))).size !== new Set(lineIds.map(String)).size) {
      throw new BadRequestException('One or more shipping lines do not belong to this tenant');
    }
    if (Array.isArray(customLineIds) && customLineIds.length > 0) {
      await this.db.updateTable('maritime_rfqs')
        .set({ target_line_ids: JSON.stringify(customLineIds) })
        .where('tenant_id', '=', tenantId).where('id', '=', rfqId as any).execute();
    }

    let sentCount = 0;
    // Fetch custom mail configuration configured by user in maritime settings
    const mailConfigRow = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'maritime_mail_config')
      .executeTakeFirst();

    let customMailConfig: any = null;
    if (mailConfigRow?.value) {
      try {
        customMailConfig = typeof mailConfigRow.value === 'string' ? JSON.parse(mailConfigRow.value) : mailConfigRow.value;
      } catch {}
    }

    // Query tenant and core settings for dynamic tenant branding fallbacks
    const tenantRow = await this.db
      .selectFrom('tenants')
      .select(['business_name', 'owner_email', 'owner_phone'])
      .where('id', '=', tenantId)
      .executeTakeFirst();

    const companySettingsRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'in', ['companyName', 'storeName', 'email', 'phone'])
      .execute();

    const companySettings = companySettingsRows.reduce<Record<string, string>>((acc, r) => {
      try { acc[r.key] = JSON.parse(r.value); } catch { acc[r.key] = r.value; }
      return acc;
    }, {});

    const defaultCompanyName = companySettings.companyName || companySettings.storeName || tenantRow?.business_name || 'إدارة العمليات واللوجستيات';
    const defaultCompanyEmail = companySettings.email || tenantRow?.owner_email || '';
    const defaultCompanyPhone = companySettings.phone || tenantRow?.owner_phone || '';

    const host = String(customMailConfig?.smtpHost || process.env.SMTP_HOST || '').trim();
    const port = Number(customMailConfig?.smtpPort || process.env.SMTP_PORT || 587);
    const user = String(customMailConfig?.smtpUser || process.env.SMTP_USER || '').trim();
    const pass = String(customMailConfig?.smtpPassword || process.env.SMTP_PASSWORD || '').trim();
    const rawFromEmail = String(customMailConfig?.fromEmail || '').trim();
    const fromEmail = (rawFromEmail && rawFromEmail.includes('@'))
      ? rawFromEmail
      : (user && user.includes('@') ? user : (defaultCompanyEmail || String(process.env.SMTP_FROM || '').trim()));
    const fromName = String(customMailConfig?.fromName?.trim() || defaultCompanyName).trim();

    let transporter: any = null;
    if (host && user && pass) {
      try {
        const nodemailer = require('nodemailer');
        transporter = nodemailer.createTransport({
          host,
          port,
          secure: port === 465,
          auth: { user, pass },
          tls: { rejectUnauthorized: false },
          connectionTimeout: 5000,
          greetingTimeout: 5000,
          socketTimeout: 5000,
        });
      } catch (err: any) {
        this.logger.warn(`Mailer config exists but failed to initialize: ${err?.message}`);
      }
    }

    const replacePlaceholders = (templateStr: string, carrierName: string) => {
      return templateStr
        .replace(/{{rfq_number}}/g, rfq.rfq_number || '')
        .replace(/{{carrier_name}}/g, carrierName || '')
        .replace(/{{pol_code}}/g, rfq.pol_code || '')
        .replace(/{{pod_code}}/g, rfq.pod_code || '')
        .replace(/{{pol_name}}/g, rfq.pol_name || '')
        .replace(/{{pod_name}}/g, rfq.pod_name || '')
        .replace(/{{container_count}}/g, String(rfq.container_count || 1))
        .replace(/{{container_type}}/g, rfq.container_type || '40HC')
        .replace(/{{cargo_mode}}/g, rfq.cargo_mode || 'FCL')
        .replace(/{{commodity}}/g, rfq.commodity_description || 'General Cargo')
        .replace(/{{target_free_days}}/g, String(rfq.target_free_days || 14))
        .replace(/{{incoterm}}/g, rfq.incoterm || 'FOB')
        .replace(/{{company_name}}/g, fromName)
        .replace(/{{company_email}}/g, fromEmail)
        .replace(/{{company_phone}}/g, defaultCompanyPhone);
    };

    const sendPromises = carriers.map(async (carrier) => {
      const targetEmail = carrier.rfq_email || carrier.email;
      if (!targetEmail) return;

      let subject = `[${rfq.rfq_number}] Freight Rate Inquiry: ${rfq.pol_code} to ${rfq.pod_code} (${rfq.container_count}x ${rfq.container_type})`;
      if (customMailConfig?.emailSubjectTemplate?.trim()) {
        subject = replacePlaceholders(customMailConfig.emailSubjectTemplate, carrier.name_en || carrier.name_ar || 'Carrier');
        if (!subject.includes(rfq.rfq_number)) {
          subject = `[${rfq.rfq_number}] ` + subject;
        }
      }

      const magicLinkUrl = `${process.env.APP_PUBLIC_URL || 'https://app.zsystemai.com'}/portal/carrier-quote/${rfq.id}?carrier=${encodeURIComponent(carrier.code)}&token=${encodeURIComponent(rfq.public_quote_token || '')}`;

      const introHtml = customMailConfig?.emailIntroTemplate?.trim()
        ? `<p>${replacePlaceholders(customMailConfig.emailIntroTemplate, carrier.name_en || carrier.name_ar || 'Carrier').replace(/\n/g, '<br>')}</p>`
        : `<p>Dear <strong>${carrier.name_en || carrier.name_ar || 'Carrier'}</strong> Pricing Desk,</p>
           <p>Please provide your most competitive ocean freight spot rate for the following inquiry:</p>`;

      const signatureHtml = customMailConfig?.emailSignatureTemplate?.trim()
        ? `<div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #e2e8f0; color: #475569; font-size: 13px;">${replacePlaceholders(customMailConfig.emailSignatureTemplate, '').replace(/\n/g, '<br>')}</div>`
        : `<div style="margin-top: 24px; padding-top: 14px; border-top: 1px solid #e2e8f0; color: #475569; font-size: 13px;">Best regards,<br><strong>${fromName}</strong> Operations Desk<br>${fromEmail}</div>`;

      const html = `
        <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #1e293b; max-width: 650px; margin: 0 auto; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px;">
          <h2 style="color: #170e5e; margin-top: 0;">Ocean Freight Rate Inquiry</h2>
          ${introHtml}
          <table style="border-collapse: collapse; width: 100%; margin: 16px 0; border: 1px solid #e2e8f0; font-size: 13px;">
            <tr style="background: #f8fafc;"><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Reference</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.rfq_number}</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Port of Loading (POL)</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.pol_name} (${rfq.pol_code})</td></tr>
            <tr style="background: #f8fafc;"><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Port of Discharge (POD)</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.pod_name} (${rfq.pod_code})</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Equipment</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.container_count} x ${rfq.container_type} (${rfq.cargo_mode})</td></tr>
            <tr style="background: #f8fafc;"><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Commodity</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.commodity_description || 'General Cargo'}</td></tr>
            <tr><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Target Free Days</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.target_free_days} Days at Destination</td></tr>
            <tr style="background: #f8fafc;"><td style="padding: 8px 12px; font-weight: bold; border-bottom: 1px solid #e2e8f0;">Incoterm / Payment</td><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0;">${rfq.incoterm} (${rfq.payment_term})</td></tr>
          </table>
          <p style="margin-top: 16px;">
            <a href="${magicLinkUrl}" style="background-color: #170e5e; color: #ffffff; padding: 10px 20px; text-decoration: none; border-radius: 6px; font-weight: bold; display: inline-block;">
              Submit Your Quote Online Here
            </a>
          </p>
          <p style="color: #64748b; font-size: 12px; margin-top: 12px;">Or simply reply directly to this email keeping [${rfq.rfq_number}] in the subject line.</p>
          ${signatureHtml}
        </div>
      `;

      if (transporter) {
        try {
          await transporter.sendMail({
            from: `"${fromName}" <${fromEmail}>`,
            to: targetEmail,
            subject,
            html,
          });
          sentCount++;

          // Automatically archive sent RFQ email into IMAP Sent folder
          this.maritimeMailService
            .appendSentEmailToImap(tenantId, {
              fromName,
              fromEmail,
              to: targetEmail,
              subject,
              html,
            })
            .catch((err) => {
              this.logger.warn(`Failed to archive sent RFQ to IMAP Sent: ${err?.message}`);
            });
        } catch (err: any) {
          this.logger.error(`Failed to send RFQ email to ${targetEmail}: ${err?.message}`);
          if (process.env.APP_MODE !== 'CLOUD_SAAS') {
            this.logger.log(`[SIMULATION FALLBACK] RFQ Email recorded for ${carrier.name_en} <${targetEmail}>: ${subject}`);
            sentCount++;
          }
        }
      } else {
        this.logger.log(`[SIMULATION] RFQ Email dispatched to ${carrier.name_en} <${targetEmail}>: ${subject}`);
        sentCount++;
      }
    });

    await Promise.allSettled(sendPromises);

    await this.db
      .updateTable('maritime_rfqs')
      .set({ status: 'sent', updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', rfqId as any)
      .execute();

    return { sentCount, message: `Dispatched RFQ inquiries to ${sentCount} carriers` };
  }

  // --------------------------------------------------------------------------
  // 4. Bids Management
  // --------------------------------------------------------------------------
  async submitBid(auth: AuthContext, dto: SubmitMaritimeBidDto) {
    const { tenantId } = requireTenantScope(auth);
    const rfq = await this.db
      .selectFrom('maritime_rfqs')
      .select(['id', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', dto.rfqId as any)
      .executeTakeFirst();

    if (!rfq) throw new NotFoundException('RFQ not found');

    // INV-MARITIME-RFQ-TERMINAL-STATE: the staff bid path carries the
    // same terminal-state guard as the public magic-link path
    // (submitPublicCarrierBid) -- no new bids on an awarded, closed or
    // cancelled RFQ. Message kept identical to the public path.
    if (['awarded', 'closed', 'cancelled'].includes(rfq.status)) {
      throw new BadRequestException('طلب عروض الأسعار مغلق أو تم ترسيته بالفعل ولا يمكن تقديم عروض إضافية');
    }

    // A public magic-link bid may name a carrier but cannot attach a
    // shipping_line record from another tenant, even if its global ID leaks.
    if (dto?.shippingLineId != null && String(dto.shippingLineId).trim()) {
      const tenantLine = await this.db.selectFrom('shipping_lines')
        .select('id')
        .where('id', '=', String(dto.shippingLineId) as any)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!tenantLine) throw new BadRequestException('Shipping line does not belong to this company');
    }

    const oceanFreight = Number(dto.oceanFreight || 0);
    const thcOrigin = Number(dto.thcOrigin || 0);
    const thcDestination = Number(dto.thcDestination || 0);
    const bafCharges = Number(dto.bafCharges || 0);
    const otherCharges = Number(dto.otherCharges || 0);

    if (oceanFreight < 0 || thcOrigin < 0 || thcDestination < 0 || bafCharges < 0 || otherCharges < 0) {
      throw new BadRequestException('مبالغ عروض أسعار الناقل لا يمكن أن تكون سالبة');
    }

    const totalFreightCost = oceanFreight + thcOrigin + thcDestination + bafCharges + otherCharges;

    const [bid] = await this.db
      .insertInto('maritime_rfq_bids')
      .values({
        tenant_id: tenantId,
        rfq_id: dto.rfqId,
        shipping_line_id: dto.shippingLineId ? String(dto.shippingLineId) : null,
        shipping_line_name: dto.shippingLineName,
        ocean_freight: oceanFreight,
        currency: dto.currency || 'USD',
        thc_origin: thcOrigin,
        thc_destination: thcDestination,
        baf_charges: bafCharges,
        other_charges: otherCharges,
        total_freight_cost: totalFreightCost,
        transit_time_days: dto.transitTimeDays || 0,
        free_days: dto.freeDays || 14,
        validity_date: dto.validityDate || null,
        submission_channel: dto.submissionChannel || 'manual',
        raw_bid_data: dto.rawBidData ? JSON.stringify(dto.rawBidData) : null,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    // Update RFQ status to bids_received if it was sent or draft
    if (rfq.status === 'sent' || rfq.status === 'draft') {
      await this.db
        .updateTable('maritime_rfqs')
        .set({ status: 'bids_received', updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', dto.rfqId as any)
        .execute();
    }

    return bid;
  }

  async awardBid(auth: AuthContext, bidId: string) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx: any) => {
      const bid = await trx
        .selectFrom('maritime_rfq_bids')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bidId as any)
        .executeTakeFirst();

      if (!bid) throw new NotFoundException('Bid not found');

      // Lock RFQ row to prevent concurrent race conditions
      await sql`SELECT id FROM maritime_rfqs WHERE tenant_id = ${tenantId} AND id = ${bid.rfq_id} FOR UPDATE`.execute(trx);

      // INV-MARITIME-RFQ-TERMINAL-STATE: a closed or cancelled RFQ
      // never gains or changes a winner. The row is already locked
      // above, so the status read here is the decision-time status.
      // Re-award within an open or already-awarded RFQ stays allowed:
      // no un-award endpoint exists, and a carrier backing out must
      // not strand the RFQ -- that choice is flagged in the invariant
      // for reversal. A bid whose RFQ row is gone fails closed.
      const rfqRow = await trx
        .selectFrom('maritime_rfqs')
        .select('status')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bid.rfq_id as any)
        .executeTakeFirst();
      if (!rfqRow) throw new NotFoundException('RFQ not found');
      if (rfqRow.status === 'closed' || rfqRow.status === 'cancelled') {
        throw new BadRequestException('طلب عروض الأسعار مغلق أو ملغى ولا يمكن ترسية عروض عليه');
      }

      // Un-award any previous bids on the same RFQ
      await trx
        .updateTable('maritime_rfq_bids')
        .set({ is_awarded: false, awarded_at: null })
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', bid.rfq_id)
        .execute();

      // Award this bid
      const [awardedBid] = await trx
        .updateTable('maritime_rfq_bids')
        .set({ is_awarded: true, awarded_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bidId as any)
        .returningAll()
        .execute();

      // Update RFQ status to awarded
      await trx
        .updateTable('maritime_rfqs')
        .set({ status: 'awarded', updated_at: sql`NOW()` })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', bid.rfq_id as any)
        .execute();

      return awardedBid;
    });
  }

  // AI & Regex text parser for carrier email bids
  parseCarrierEmailText(rawText: string) {
    let text = String(rawText || '');
    // Strip document numbers (e.g. RFQ-261007-0010, INQ-261007-0005, MSK-...) so digits are not mistaken for prices or free days
    text = text.replace(/\[?(?:RFQ|INQ|QUO|JOB|MSK|BKG)-[A-Z0-9-]+\]?/gi, ' ');

    let oceanFreight = 0;
    let currency = 'USD';
    let freeDays = 14;
    let transitTimeDays = 0;
    let thcOrigin = 0;
    let thcDestination = 0;

    // Currency match with word boundaries
    if (/\b(?:EUR|€)\b/i.test(text)) currency = 'EUR';
    else if (/\b(?:SAR|ريال)\b/i.test(text)) currency = 'SAR';
    else if (/\b(?:EGP|جنيه|جنية)\b/i.test(text)) currency = 'EGP';

    // Ocean Freight Match
    const ofMatch =
      text.match(/(?:ocean\s*freight|freight\s*rate|base\s*rate|spot\s*rate|sea\s*freight|\bBAS\b|\bO\/?F\b)\s*[:=-]?\s*(?:\$|USD|EUR|€|EGP|SAR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      text.match(/(?:freight|rate)\s*[:=-]\s*(?:\$|USD|EUR|€|EGP|SAR)?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      text.match(/(?:usd|\$)\s*([0-9,]+(?:\.[0-9]{1,2})?)/i) ||
      text.match(/([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:usd|\$)/i);
    if (ofMatch && ofMatch[1]) {
      oceanFreight = parseFloat(ofMatch[1].replace(/,/g, ''));
    }

    // Free Days Match
    const fdMatch = text.match(/(?:free\s*(?:days|time)|detention|demurrage)(?:[^\d\n\r]*?)[:=]?\s*([0-9]{1,2})/i) ||
                    text.match(/([0-9]{1,2})\s*(?:days?\s*free|free\s*days?|f\/?d)/i);
    if (fdMatch && fdMatch[1]) {
      freeDays = parseInt(fdMatch[1], 10);
    }

    // Transit Time Match
    const ttMatch = text.match(/(?:transit\s*time|tt|transit)(?:[^\d\n\r]*?)[:=]?\s*([0-9]{1,2})/i);
    if (ttMatch && ttMatch[1]) {
      transitTimeDays = parseInt(ttMatch[1], 10);
    }

    // Origin THC
    const oThcMatch = text.match(/(?:origin\s*thc|thc\s*origin|o\.?thc)(?:[^\d\n\r$]*?)[:=]?\s*\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (oThcMatch && oThcMatch[1]) {
      thcOrigin = parseFloat(oThcMatch[1].replace(/,/g, ''));
    }

    // Destination THC
    const dThcMatch = text.match(/(?:dest(?:ination)?\s*thc|thc\s*dest(?:ination)?|d\.?thc)(?:[^\d\n\r$]*?)[:=]?\s*\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
    if (dThcMatch && dThcMatch[1]) {
      thcDestination = parseFloat(dThcMatch[1].replace(/,/g, ''));
    }

    // Generic THC fallback
    if (!thcOrigin && !thcDestination) {
      const thcMatch = text.match(/thc\s*[:=]?\s*\$?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i);
      if (thcMatch && thcMatch[1]) {
        thcOrigin = parseFloat(thcMatch[1].replace(/,/g, ''));
      }
    }

    const totalEstimated = oceanFreight + thcOrigin + thcDestination;

    return {
      oceanFreight,
      currency,
      freeDays,
      transitTimeDays,
      thcOrigin,
      thcDestination,
      totalEstimated,
    };
  }

  // AI & Regex text parser for Carrier Booking Confirmations
  parseCarrierBookingText(rawText: string) {
    const text = String(rawText || '');
    let bookingNumber: string | null = null;
    let shippingLineName: string | null = null;
    let vesselName: string | null = null;
    let voyageNumber: string | null = null;
    let polName: string | null = null;
    let podName: string | null = null;
    let etd: string | null = null;
    let eta: string | null = null;
    let portCutOff: string | null = null;
    let mblNumber: string | null = null;
    const containers: Array<{ containerNumber: string; containerType: string }> = [];

    // 1. Detect Shipping Line
    const lines = [
      { name: 'Maersk Line', match: /\b(?:maersk|safmarine|sealand)\b/i },
      { name: 'MSC Mediterranean Shipping', match: /\bmsc\b/i },
      { name: 'CMA CGM', match: /\b(?:cma\s*cgm|cma)\b/i },
      { name: 'Hapag-Lloyd', match: /\bhapag(?:-lloyd)?\b/i },
      { name: 'Cosco Shipping Lines', match: /\bcosco\b/i },
      { name: 'Evergreen Line', match: /\bevergreen\b/i },
      { name: 'Ocean Network Express (ONE)', match: /\b(?:one|ocean\s*network\s*express)\b/i },
      { name: 'Yang Ming', match: /\byang\s*ming\b/i },
      { name: 'ZIM Integrated', match: /\bzim\b/i },
      { name: 'Wan Hai Lines', match: /\bwan\s*hai\b/i },
    ];
    for (const l of lines) {
      if (l.match.test(text)) {
        shippingLineName = l.name;
        break;
      }
    }

    // 2. Booking Number
    const bkgMatch = text.match(/(?:booking\s*(?:reference|ref|number|no|confirmation|#)|bkg\s*(?:no|#)?)\s*[:=]?\s*([A-Z0-9-]{5,30})/i) ||
                     text.match(/booking\s*[:=]\s*([A-Z0-9-]{5,30})/i) ||
                     text.match(/\b([0-9]{9})\b/);
    if (bkgMatch && bkgMatch[1]) {
      bookingNumber = bkgMatch[1].trim();
    }

    // 3. Vessel Name & Voyage
    const vesselMatch = text.match(/(?:vessel\s*(?:name)?|mother\s*vessel|ship\s*name)\s*[:=]?\s*([A-Za-z0-9\s.-]+?)(?=\s*(?:voyage|voy|etd|pol|pod|\n|$))/i);
    if (vesselMatch && vesselMatch[1]) {
      vesselName = vesselMatch[1].replace(/[\r\n]+/g, ' ').trim();
    }

    const voyMatch = text.match(/(?:voyage\s*(?:no|number|#)?|voy\s*(?:no|#)?)\s*[:=]?\s*([A-Z0-9-]{2,14})/i);
    if (voyMatch && voyMatch[1]) {
      voyageNumber = voyMatch[1].trim();
    }

    // Helper for date extraction
    const extractDate = (labelRegex: RegExp): string | null => {
      const match = text.match(labelRegex);
      if (!match || !match[1]) return null;
      const rawDate = match[1].trim();
      const parsed = new Date(rawDate);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString().split('T')[0];
      }
      return rawDate;
    };

    // 4. ETD / ETA / Cut-off
    etd = extractDate(/(?:etd|departure\s*date|sailing\s*date|est\.?\s*dep\.?)\s*[:=]?\s*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i);
    eta = extractDate(/(?:eta|arrival\s*date|est\.?\s*arr\.?)\s*[:=]?\s*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i);
    portCutOff = extractDate(/(?:port\s*cut[- ]?off|cy\s*cut[- ]?off|closing\s*date|cargo\s*cut[- ]?off|cut[- ]?off)\s*[:=]?\s*([0-9]{4}[-/][0-9]{1,2}[-/][0-9]{1,2}|[0-9]{1,2}[-/][0-9]{1,2}[-/][0-9]{2,4}|[0-9]{1,2}\s+[A-Za-z]{3,9}\s+[0-9]{4})/i);

    // 5. POL / POD
    const polMatch = text.match(/(?:pol|port\s*of\s*loading|origin\s*port|from)\s*[:=]?\s*([A-Za-z0-9\s,.-]+?)(?=\s*(?:pod|port\s*of\s*discharge|to|etd|\n|$))/i);
    if (polMatch && polMatch[1]) {
      polName = polMatch[1].replace(/[\r\n]+/g, ' ').trim();
    }

    const podMatch = text.match(/(?:pod|port\s*of\s*discharge|destination\s*port|to)\s*[:=]?\s*([A-Za-z0-9\s,.-]+?)(?=\s*(?:eta|vessel|\n|$))/i);
    if (podMatch && podMatch[1]) {
      podName = podMatch[1].replace(/[\r\n]+/g, ' ').trim();
    }

    // 6. Master B/L Number
    const mblMatch = text.match(/(?:master\s*b\/?l|mbl|ocean\s*b\/?l|b\/?l\s*no)\s*[:=]?\s*([A-Z0-9-]{6,25})/i);
    if (mblMatch && mblMatch[1]) {
      mblNumber = mblMatch[1].trim();
    } else if (bookingNumber) {
      mblNumber = bookingNumber;
    }

    // 7. Containers Match (e.g. MSKU9482710)
    const containerRegex = /\b([A-Z]{4}\s?[0-9]{7})\b/g;
    let matchC: RegExpExecArray | null;
    const foundContainers = new Set<string>();
    while ((matchC = containerRegex.exec(text)) !== null) {
      const cleanNum = matchC[1].replace(/\s+/g, '').toUpperCase();
      if (!foundContainers.has(cleanNum)) {
        foundContainers.add(cleanNum);
        containers.push({
          containerNumber: cleanNum,
          containerType: /20/i.test(text) ? '20GP' : '40HC',
        });
      }
    }

    return {
      bookingNumber,
      shippingLineName,
      vesselName,
      voyageNumber,
      polName,
      podName,
      etd,
      eta,
      portCutOff,
      mblNumber,
      containers,
    };
  }

  // --------------------------------------------------------------------------
  // 5. Client Quotations Engine
  // --------------------------------------------------------------------------
  async createQuotation(auth: AuthContext, dto: CreateMaritimeQuotationDto) {
    const { tenantId } = requireTenantScope(auth);

    const baseCost = Number(dto.baseCost || 0);
    const marginType = dto.marginType || 'fixed';
    const marginValue = Number(dto.marginValue || 0);
    const currencySetting = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'currency')
      .executeTakeFirst();
    let systemCurrency = 'EGP';
    if (currencySetting) {
      try { systemCurrency = String(JSON.parse(currencySetting.value)); }
      catch { systemCurrency = String(currencySetting.value); }
    }
    const exchangeRate = (dto.currency || 'USD').trim().toUpperCase() === systemCurrency.trim().toUpperCase()
      ? 1
      : Number(dto.exchangeRate);
    if (!Number.isFinite(exchangeRate) || exchangeRate <= 0) {
      throw new BadRequestException('سعر الصرف يجب أن يكون أكبر من صفر');
    }

    let finalTotal = baseCost;
    if (marginType === 'percentage') {
      finalTotal = baseCost * (1 + marginValue / 100);
    } else {
      finalTotal = baseCost + marginValue;
    }
    finalTotal = Math.round(finalTotal * 10_000) / 10_000;
    const finalTotalLocal = Math.round(finalTotal * exchangeRate * 10_000) / 10_000;

    const transportMode = dto.transportMode || 'sea';
    let grossWeightKg = Number(dto.grossWeightKg || 0);
    let totalCbm = Number(dto.totalCbm || 0);
    let volumetricWeightKg = Number(dto.volumetricWeightKg || 0);
    let chargeableWeightKg = Number(dto.chargeableWeightKg || 0);

    if (transportMode === 'air' && (grossWeightKg > 0 || totalCbm > 0)) {
      const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
      volumetricWeightKg = Math.max(volumetricWeightKg, airCalc.volumetricWeightKg);
      chargeableWeightKg = Math.max(chargeableWeightKg, airCalc.chargeableWeightKg);
    }

    return await this.db.transaction().execute(async (trx) => {
      const tempNumber = `QUO-TMP-${crypto.randomUUID()}`;
      const [quote] = await trx
        .insertInto('maritime_quotations')
        .values({
          tenant_id: tenantId,
          quotation_number: tempNumber,
          inquiry_id: dto.inquiryId ? String(dto.inquiryId) : null,
          rfq_id: dto.rfqId || null,
          bid_id: dto.bidId || null,
          customer_id: dto.customerId || null,
          customer_name: dto.customerName,
          customer_phone: dto.customerPhone || null,
          customer_email: dto.customerEmail || null,
          transport_mode: transportMode,
          air_cargo_type: dto.airCargoType || null,
          gross_weight_kg: grossWeightKg,
          volumetric_weight_kg: volumetricWeightKg,
          chargeable_weight_kg: chargeableWeightKg,
          total_cbm: totalCbm,
          package_count: dto.packageCount ? Number(dto.packageCount) : 0,
          flight_number: dto.flightNumber || null,
          flight_date: dto.flightDate || null,
          mawb_number: dto.mawbNumber || null,
          hawb_number: dto.hawbNumber || null,
          payment_term: dto.paymentTerm || 'prepaid',
          base_cost: baseCost,
          currency: dto.currency || 'USD',
          margin_type: marginType,
          margin_value: marginValue,
          final_total: finalTotal,
          exchange_rate: exchangeRate,
          final_total_local: finalTotalLocal,
          valid_until: dto.validUntil || null,
          quote_roe: dto.quoteRoe ? Number(dto.quoteRoe) : exchangeRate,
          roe_clause_text: dto.roeClauseText || null,
          is_split_currency: Boolean(dto.isSplitCurrency),
          foreign_currency: dto.foreignCurrency || dto.currency || 'USD',
          foreign_currency_amount: dto.foreignCurrencyAmount ? Number(dto.foreignCurrencyAmount) : 0,
          local_currency_amount: dto.localCurrencyAmount ? Number(dto.localCurrencyAmount) : 0,
          acid_number: dto.acidNumber || null,
          status: 'draft',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber('QUO', Number(quote.id));
      const [updatedQuote] = await trx
        .updateTable('maritime_quotations')
        .set({ quotation_number: finalNumber })
        .where('id', '=', quote.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      if (dto.charges && Array.isArray(dto.charges) && dto.charges.length > 0) {
        for (const chg of dto.charges) {
          const qty = Number(chg.quantity || 1);
          const rate = Number(chg.unitRate || 0);
          const tot = Number(chg.totalAmount || (qty * rate));
          const taxPct = Number(chg.taxRatePercent || 0);
          const taxAmt = Number(chg.taxAmount ?? (tot * taxPct / 100));
          await trx
            .insertInto('maritime_quotation_charges')
            .values({
              tenant_id: tenantId,
              quotation_id: String(quote.id),
              charge_code: chg.chargeCode || 'CHG',
              charge_name_ar: chg.chargeNameAr || 'رسوم نولون / خدمات',
              charge_name_en: chg.chargeNameEn || 'Freight / Logistics Charge',
              currency: chg.currency || dto.currency || 'USD',
              unit_rate: rate,
              quantity: qty,
              total_amount: tot,
              is_local_charge: Boolean(chg.isLocalCharge),
              tax_rate_percent: taxPct,
              tax_amount: taxAmt,
            })
            .execute();
        }
      }

      if (dto.inquiryId) {
        await trx
          .updateTable('maritime_inquiries')
          .set({
            status: 'quoted',
            quotation_id: String(quote.id),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.inquiryId as any)
          .execute();
      }

      return updatedQuote;
    });
  }

  async getQuotations(auth: AuthContext, filters?: { status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_quotations')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([
        eb('quotation_number', 'ilike', term),
        eb('customer_name', 'ilike', term),
        eb('customer_phone', 'ilike', term)
      ]));
    }

    return await query.orderBy('id', 'desc').execute();
  }

  async updateQuotationStatus(auth: AuthContext, id: string, status: 'approved' | 'rejected' | 'sent') {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await this.db
      .updateTable('maritime_quotations')
      .set({ status, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    return updated;
  }

  // --------------------------------------------------------------------------
  // 6. Shipment Jobs Engine (Operations & Cost Centers)
  // --------------------------------------------------------------------------
  async createJob(auth: AuthContext, dto: CreateMaritimeJobDto) {
    const { tenantId } = requireTenantScope(auth);
    const trackingToken = crypto.randomBytes(16).toString('hex');

    const transportMode = dto.transportMode || 'sea';
    let formattedMawb: string | null = dto.mawbNumber || null;
    if (transportMode === 'air' && dto.mawbNumber) {
      const mawbValidation = validateIataAwbNumber(dto.mawbNumber);
      if (!mawbValidation.valid) {
        throw new BadRequestException(mawbValidation.error);
      }
      formattedMawb = mawbValidation.formattedAwb || dto.mawbNumber;
    }

    let grossWeightKg = Number(dto.grossWeightKg || 0);
    let totalCbm = Number(dto.totalCbm || 0);
    let volumetricWeightKg = Number(dto.volumetricWeightKg || 0);
    let chargeableWeightKg = Number(dto.chargeableWeightKg || 0);

    if (transportMode === 'air' && (grossWeightKg > 0 || totalCbm > 0)) {
      const airCalc = calculateAirChargeableWeight({ grossWeightKg, cbm: totalCbm });
      volumetricWeightKg = Math.max(volumetricWeightKg, airCalc.volumetricWeightKg);
      chargeableWeightKg = Math.max(chargeableWeightKg, airCalc.chargeableWeightKg);
    }

    const containerNumbers = (dto.containers || []).map((c) => c.containerNumber.trim().toUpperCase());
    if (containerNumbers.some((number) => !number) || new Set(containerNumbers).size !== containerNumbers.length) {
      throw new BadRequestException('لا يمكن إضافة رقم الحاوية أكثر من مرة في أمر الشحن');
    }

    return await this.db.transaction().execute(async (trx) => {
      if (dto.mblNumber?.trim()) {
        await sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${dto.mblNumber.trim().toUpperCase()}))`.execute(trx);
        await this.assertUniqueMasterBl(tenantId, dto.mblNumber, undefined, dto.parentJobId, trx);
      }
      const tempNumber = `JOB-TMP-${crypto.randomUUID()}`;

      // 1. Insert Job record first with tempNumber
      const [job] = await trx
        .insertInto('maritime_jobs')
        .values({
          tenant_id: tenantId,
          job_number: tempNumber,
          inquiry_id: dto.inquiryId ? String(dto.inquiryId) : null,
          quotation_id: dto.quotationId ? String(dto.quotationId) : null,
          rfq_id: dto.rfqId ? String(dto.rfqId) : null,
          customer_id: dto.customerId ? Number(dto.customerId) : null,
          customer_name: dto.customerName,
          direction: dto.direction || 'import',
          transport_mode: transportMode,
          air_cargo_type: dto.airCargoType || null,
          gross_weight_kg: grossWeightKg,
          volumetric_weight_kg: volumetricWeightKg,
          chargeable_weight_kg: chargeableWeightKg,
          total_cbm: totalCbm,
          package_count: dto.packageCount ? Number(dto.packageCount) : 0,
          flight_number: dto.flightNumber || null,
          flight_date: dto.flightDate || null,
          mawb_number: formattedMawb,
          hawb_number: dto.hawbNumber || null,
          payment_term: dto.paymentTerm || 'prepaid',
          shipping_line_id: dto.shippingLineId ? String(dto.shippingLineId) : null,
          shipping_line_name: dto.shippingLineName,
          booking_number: dto.bookingNumber || null,
          vessel_name: dto.vesselName || null,
          voyage_number: dto.voyageNumber || null,
          pol_code: dto.polCode.toUpperCase(),
          pol_name: dto.polName,
          pod_code: dto.podCode.toUpperCase(),
          pod_name: dto.podName,
          etd: dto.etd || null,
          eta: dto.eta || null,
          port_cut_off: dto.portCutOff ? new Date(dto.portCutOff) : null,
          bl_type: dto.blType || 'original',
          mbl_number: dto.mblNumber?.trim().toUpperCase() || null,
          hbl_number: dto.hblNumber || null,
          shipper_details: dto.shipperDetails || null,
          consignee_details: dto.consigneeDetails || null,
          notify_party: dto.notifyParty || null,
          milestone_status: dto.transportMode === 'air' ? 'BKD' : dto.transportMode === 'road' ? 'TRK_ASSIGN' : 'BOOK',
          cost_center_id: null,
          tracking_token: trackingToken,
          parent_job_id: dto.parentJobId ? String(dto.parentJobId) : null,
          is_consolidation_master: Boolean(dto.isConsolidationMaster),
          acid_number: dto.acidNumber || null,
          acid_issue_date: dto.acidIssueDate ? dto.acidIssueDate : null,
          acid_expiry_date: dto.acidExpiryDate ? dto.acidExpiryDate : null,
          foreign_exporter_id: dto.foreignExporterId || null,
          importer_tax_id: dto.importerTaxId || null,
          quote_roe: dto.quoteRoe != null ? Number(dto.quoteRoe) : null,
          actual_roe: dto.actualRoe != null ? Number(dto.actualRoe) : null,
          forex_gain_loss: dto.forexGainLoss ? Number(dto.forexGainLoss) : 0,
          roe_clause_agreed: dto.roeClauseAgreed !== undefined ? Boolean(dto.roeClauseAgreed) : true,
          si_cutoff_date: dto.siCutoffDate ? new Date(dto.siCutoffDate) : null,
          vgm_cutoff_date: dto.vgmCutoffDate ? new Date(dto.vgmCutoffDate) : null,
          port_cutoff_date: dto.portCutoffDate ? new Date(dto.portCutoffDate) : (dto.portCutOff ? new Date(dto.portCutOff) : null),
          delivery_address: dto.deliveryAddress || null,
          status: 'active',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      const finalJobNumber = formatDailyDocumentNumber('JOB', Number(job.id));

      if (dto.parentJobId) {
        await trx
          .updateTable('maritime_jobs')
          .set({
            sub_job_count: sql`sub_job_count + 1`,
            is_consolidation_master: true,
          })
          .where('id', '=', dto.parentJobId as any)
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      if (dto.charges && Array.isArray(dto.charges) && dto.charges.length > 0) {
        for (const chg of dto.charges) {
          const cost = Number(chg.costAmount || 0);
          const sell = Number(chg.sellAmount || 0);
          const profit = Number(chg.profitAmount ?? (sell - cost));
          const taxPct = Number(chg.taxRatePercent || 0);
          const taxAmt = Number(chg.taxAmount ?? (sell * taxPct / 100));
          await trx
            .insertInto('maritime_job_charges')
            .values({
              tenant_id: tenantId,
              job_id: String(job.id),
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
              is_invoiced: false,
            })
            .execute();
        }
      }

      // 2. Automatically create an Accounting Cost Center under dimension = 'project'
      let costCenterId: string | null = null;
      const modeLabel = dto.transportMode === 'air' ? 'شحنة جوية' : dto.transportMode === 'road' ? 'شحنة برية' : 'شحنة بحرية';
      const existingCc = await trx
        .selectFrom('cost_centers')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where('code', '=', finalJobNumber)
        .executeTakeFirst();

      if (existingCc) {
        costCenterId = String(existingCc.id);
      } else {
        const [costCenter] = await trx
          .insertInto('cost_centers')
          .values({
            tenant_id: tenantId,
            code: finalJobNumber,
            name: `${modeLabel}: ${finalJobNumber} - ${dto.customerName}`,
            dimension: 'project',
            is_active: true,
            description: `مركز تكلفة تلقائي للعملية ${finalJobNumber} (${dto.polName} إلى ${dto.podName})`,
          })
          .returning('id')
          .execute();
        if (costCenter) {
          costCenterId = String(costCenter.id);
        }
      }

      // 3. Update job with final job number and cost center
      const [updatedJob] = await trx
        .updateTable('maritime_jobs')
        .set({
          job_number: finalJobNumber,
          cost_center_id: costCenterId,
        })
        .where('id', '=', job.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      // 4. Add initial milestone (DCSA BOOK for sea, Cargo iQ BKD for air, TRK_ASSIGN for road)
      const isAir = dto.transportMode === 'air';
      const isRoad = dto.transportMode === 'road';
      const initialKey = isAir ? 'BKD' : isRoad ? 'TRK_ASSIGN' : 'BOOK';
      const initialTitle = isAir
        ? 'تأكيد حجز الشحنة الجوية (Air Cargo Booked)'
        : isRoad
        ? 'تعيين وسيلة النقل البري والسائق (Truck & Driver Assigned)'
        : 'تأكيد الحجز الملاحي (Booking Confirmed)';
      const initialNotes = isAir
        ? `تم فتح أمر التشغيل وتأكيد الحجز الجوي برقم ${dto.mawbNumber || finalJobNumber}`
        : isRoad
        ? `تم فتح أمر التشغيل وتعيين وسيلة النقل البري برقم ${dto.bookingNumber || finalJobNumber}`
        : `تم فتح أمر التشغيل وتأكيد الحجز بنجاح برقم ${dto.bookingNumber || finalJobNumber}`;

      await trx
        .insertInto('maritime_job_milestones')
        .values({
          tenant_id: tenantId,
          job_id: String(job.id),
          milestone_key: initialKey,
          milestone_title: initialTitle,
          location: dto.polName,
          notes: initialNotes,
          recorded_by: auth.userId ? Number(auth.userId) : null,
        })
        .execute();

      // 5. If containers provided, insert them
      if (dto.containers && dto.containers.length > 0) {
        for (const c of dto.containers) {
          const [container] = await trx
            .insertInto('maritime_containers')
            .values({
              tenant_id: tenantId,
              job_id: String(job.id),
              container_number: c.containerNumber.trim().toUpperCase(),
              container_type: c.containerType || '40HC',
              seal_number: c.sealNumber || null,
              gross_weight_kg: Number(c.grossWeightKg || 0),
              cbm: Number(c.cbm || 0),
              free_days: Number(c.freeDays ?? 14),
              deposit_amount: Number(c.depositAmount || 0),
              deposit_currency: c.depositCurrency || 'EGP',
              deposit_status: Number(c.depositAmount || 0) > 0 ? 'held_by_line' : 'not_required',
            })
            .returning('id').execute();
          if (Number(c.depositAmount || 0) > 0) {
            await this.postContainerDepositJournal(trx, tenantId, String(container.id), Number(c.depositAmount),
              c.depositCurrency || 'EGP', 'open', auth.userId);
          }
        }
      }

      // 6. If linked to quotation, update quotation
      if (dto.quotationId) {
        await trx
          .updateTable('maritime_quotations')
          .set({
            status: 'converted_to_job',
            converted_job_id: String(job.id),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.quotationId as any)
          .execute();
      }

      // 7. If linked to inquiry, update inquiry
      if (dto.inquiryId) {
        await trx
          .updateTable('maritime_inquiries')
          .set({
            status: 'converted_to_job',
            job_id: String(job.id),
            updated_at: sql`NOW()`,
          })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', dto.inquiryId as any)
          .execute();
      }

      return updatedJob;
    });
  }

  async autoConvertQuotationToJob(auth: AuthContext, quotationId: string) {
    const { tenantId } = requireTenantScope(auth);
    // INV-MARITIME-AUTOCONVERT-ROLLBACK-STATUS: capture the status the
    // quote had BEFORE the flip, so a failed conversion restores
    // exactly that status. Restoring a hardcoded 'approved' rewrote
    // history: a failed conversion of a 'sent', 'draft' or 'rejected'
    // quote left it 'approved'. The flip below stays the single
    // atomic predicate UPDATE it always was, so a concurrent
    // conversion still loses the race and reports already-converted
    // without restoring anything it did not flip.
    const priorQuote = await this.db
      .selectFrom('maritime_quotations')
      .select('status')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', quotationId as any)
      .executeTakeFirst();
    const priorStatus = priorQuote?.status ?? null;
    const quote = await this.db
      .updateTable('maritime_quotations')
      .set({ status: 'converted_to_job', updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', quotationId as any)
      .where('status', '!=', 'converted_to_job')
      .returningAll()
      .executeTakeFirst();

    if (!quote) {
      const existing = await this.db
        .selectFrom('maritime_quotations')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', quotationId as any)
        .executeTakeFirst();
      if (!existing) throw new NotFoundException('Quotation not found');
      throw new BadRequestException('تم تحويل عرض السعر هذا إلى أمر تشغيل بالفعل');
    }

    try {
      let rfq: any = null;
      let bid: any = null;
      if (quote.rfq_id) {
        rfq = await this.db
          .selectFrom('maritime_rfqs')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id', '=', quote.rfq_id as any)
          .executeTakeFirst();
      }
      if (quote.bid_id) {
        bid = await this.db
          .selectFrom('maritime_rfq_bids')
          .selectAll()
          .where('tenant_id', '=', tenantId)
          .where('id', '=', quote.bid_id as any)
          .executeTakeFirst();
      }

      const transportMode = quote.transport_mode || rfq?.transport_mode || 'sea';
      const containerCount = rfq?.container_count || 1;
      const containerType = rfq?.container_type || '40HC';
      const freeDays = bid?.free_days ?? rfq?.target_free_days ?? 14;

      const containersPayload: any[] = [];
      if (transportMode === 'sea') {
        for (let i = 1; i <= containerCount; i++) {
          containersPayload.push({
            containerNumber: `MSKU${Math.floor(1000000 + Math.random() * 9000000)}`,
            containerType,
            freeDays,
            depositAmount: 0,
            depositCurrency: 'EGP',
          });
        }
      }

      return await this.createJob(auth, {
        quotationId: String(quote.id),
        rfqId: quote.rfq_id ? String(quote.rfq_id) : undefined,
        inquiryId: quote.inquiry_id ? String(quote.inquiry_id) : undefined,
        customerId: quote.customer_id,
        customerName: quote.customer_name,
        direction: (rfq?.direction as any) || 'import',
        transportMode: quote.transport_mode || rfq?.transport_mode || 'sea',
        airCargoType: quote.air_cargo_type || rfq?.air_cargo_type || null,
        grossWeightKg: Number(quote.gross_weight_kg || rfq?.gross_weight_kg || 0),
        volumetricWeightKg: Number(quote.volumetric_weight_kg || rfq?.volumetric_weight_kg || 0),
        chargeableWeightKg: Number(quote.chargeable_weight_kg || rfq?.chargeable_weight_kg || 0),
        totalCbm: Number(quote.total_cbm || rfq?.total_cbm || 0),
        packageCount: quote.package_count || rfq?.package_count || 0,
        flightNumber: quote.flight_number || rfq?.flight_number || null,
        flightDate: quote.flight_date || rfq?.flight_date || null,
        mawbNumber: quote.mawb_number || rfq?.mawb_number || null,
        hawbNumber: quote.hawb_number || rfq?.hawb_number || null,
        paymentTerm: quote.payment_term,
        shippingLineId: bid?.shipping_line_id || null,
        shippingLineName: bid?.shipping_line_name || (quote.transport_mode === 'air' ? 'شركة طيران معتمدة' : quote.transport_mode === 'road' ? 'شركة نقل بري معتمدة' : 'خط ملاحي معتمد'),
        polCode: rfq?.pol_code || (quote.transport_mode === 'road' ? 'EGSOC' : quote.transport_mode === 'air' ? 'CAI' : 'CNSHA'),
        polName: rfq?.pol_name || (quote.transport_mode === 'air' ? 'مطار الشحن' : quote.transport_mode === 'road' ? 'الميناء الجاف / موقع الشحن' : 'ميناء الشحن'),
        podCode: rfq?.pod_code || (quote.transport_mode === 'road' ? 'EGTRD' : quote.transport_mode === 'air' ? 'DXB' : 'EGALY'),
        podName: rfq?.pod_name || (quote.transport_mode === 'air' ? 'مطار الوصول' : quote.transport_mode === 'road' ? 'الميناء الجاف / موقع الوصول' : 'ميناء الوصول'),
        bookingNumber: `BKG-${Math.floor(100000 + Math.random() * 900000)}`,
        containers: containersPayload,
        notes: `أمر تشغيل تم تحويله وتفعيله آلياً من عرض السعر ${quote.quotation_number}`,
      });
    } catch (err) {
      // Restore the status captured before the flip -- never a
      // hardcoded value (see INV-MARITIME-AUTOCONVERT-ROLLBACK-STATUS).
      // The flip only happened when priorStatus was read, so a missing
      // row (priorStatus null) restores nothing: the flip already
      // reported not-found / already-converted before the try block.
      if (priorStatus !== null) {
        await this.db
          .updateTable('maritime_quotations')
          .set({ status: priorStatus, updated_at: sql`NOW()` })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', quote.id as any)
          .execute();
      }
      throw err;
    }
  }

  async getJobs(auth: AuthContext, filters?: { status?: string; search?: string; milestone?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }

    if (filters?.milestone && filters.milestone !== 'all') {
      query = query.where('milestone_status', '=', filters.milestone);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([
        eb('job_number', 'ilike', term),
        eb('customer_name', 'ilike', term),
        eb('booking_number', 'ilike', term),
        eb('mbl_number', 'ilike', term),
        eb('hbl_number', 'ilike', term),
        eb('vessel_name', 'ilike', term)
      ]));
    }

    const jobs = await query.orderBy('id', 'desc').execute();

    // Attach containers count
    const jobIds = jobs.map((j) => String(j.id));
    if (jobIds.length === 0) return [];

    const containers = await this.db
      .selectFrom('maritime_containers')
      .select(['job_id', 'container_number', 'is_overdue'])
      .where('tenant_id', '=', tenantId)
      .where('job_id', 'in', jobIds)
      .execute();

    return jobs.map((job) => {
      const related = containers.filter((c) => c.job_id === String(job.id));
      const hasOverdue = related.some((c) => c.is_overdue);
      return {
        ...job,
        containersCount: related.length,
        hasOverdueContainers: hasOverdue,
      };
    });
  }

  async getJobById(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();

    if (!job) throw new NotFoundException('Shipment Job not found');

    const containers = await this.db
      .selectFrom('maritime_containers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id)
      .execute();

    const milestones = await this.db
      .selectFrom('maritime_job_milestones')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id)
      .orderBy('occurred_at', 'asc')
      .execute();

    const insurances = await this.db
      .selectFrom('maritime_cargo_insurances')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id as any)
      .orderBy('id', 'desc')
      .execute();

    const warehouseReceipts = await this.db
      .selectFrom('maritime_warehouse_receipts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id as any)
      .orderBy('id', 'desc')
      .execute();

    const truckingTrips = await this.db
      .selectFrom('maritime_inland_trucking_trips')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', id)
      .orderBy('id', 'asc')
      .execute();

    let customerBalance = 0;
    let customerAvailableCredit = 0;
    if (job.customer_id) {
      const cust = await this.db
        .selectFrom('customers')
        .select(['balance'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', job.customer_id as any)
        .executeTakeFirst();
      if (cust) {
        customerBalance = Number(cust.balance || 0);
        customerAvailableCredit = Math.max(0, -customerBalance);
      }
    }

    return {
      ...job,
      customerBalance,
      customerAvailableCredit,
      containers,
      milestones,
      insurances: insurances || [],
      warehouseReceipts: warehouseReceipts || [],
      truckingTrips: truckingTrips || [],
      dcsaDefinitions: DCSA_STANDARD_MILESTONES,
      cargoIqDefinitions: IATA_CARGO_IQ_MILESTONES,
      roadFreightDefinitions: ROAD_FREIGHT_MILESTONES,
    };
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
              return_deadline: deadline.toISOString().split('T')[0],
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

  async releaseDeliveryOrder(auth: AuthContext, jobId: string) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, jobId);
    const isAir = job?.transport_mode === 'air';
    const isRoad = job?.transport_mode === 'road';
    const milestoneKey = isAir ? 'AWD' : isRoad ? 'TRK_POD' : 'GTO';
    const milestoneTitle = isAir
      ? 'تم اعتماد وإصدار إذن التسليم الجوي وبوليصة الشحن (Air Cargo Delivery Order) للعميل'
      : isRoad
      ? 'توقيع بوليصة الشحن البري وتأكيد استلام وتسليم البضاعة (Signed Waybill / POD)'
      : 'تم اعتماد وإصدار إذن التسليم الملاحي الرسمي (Delivery Order D/O) للعميل';
    return await this.addJobMilestone(
      auth,
      jobId,
      milestoneKey,
      milestoneTitle
    );
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
      `يمكنكم متابعة خط سير الشحنة لحظة بلحظة عبر رابط التتبع المباشر:\n` +
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

  // --------------------------------------------------------------------------
  // 7. Containers & Demurrage Radar
  // --------------------------------------------------------------------------
  async getContainers(auth: AuthContext, filters?: { overdueOnly?: boolean; depositHeldOnly?: boolean; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_containers as c')
      .innerJoin('maritime_jobs as j', 'j.id', 'c.job_id')
      .select([
        'c.id',
        'c.job_id',
        'c.container_number',
        'c.container_type',
        'c.seal_number',
        'c.free_days',
        'c.return_deadline',
        'c.is_overdue',
        'c.overdue_days',
        'c.demurrage_amount',
        'c.deposit_amount',
        'c.deposit_currency',
        'c.deposit_status',
        'c.empty_returned_at',
        'c.discharged_at',
        'c.gated_out_at',
        'j.job_number',
        'j.customer_name',
        'j.shipping_line_name',
        'j.vessel_name',
        'j.delivery_order_released'
      ])
      .where('c.tenant_id', '=', tenantId);

    if (filters?.overdueOnly) {
      query = query.where('c.is_overdue', '=', true);
    }

    if (filters?.depositHeldOnly) {
      query = query.where('c.deposit_status', '=', 'held_by_line');
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([
        eb('c.container_number', 'ilike', term),
        eb('j.job_number', 'ilike', term),
        eb('j.customer_name', 'ilike', term)
      ]));
    }

    const rows = await query.orderBy('c.id', 'desc').execute();

    // Recalculate dynamic days remaining / countdown
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return rows.map((row) => {
      let daysRemaining: number | null = null;
      let statusColor: 'green' | 'yellow' | 'red' | 'gray' = 'green';

      if (row.empty_returned_at) {
        statusColor = 'gray'; // Completed
      } else if (row.return_deadline) {
        const deadline = new Date(row.return_deadline);
        deadline.setHours(0, 0, 0, 0);
        const diffTime = deadline.getTime() - today.getTime();
        daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        if (daysRemaining < 0) {
          statusColor = 'red'; // Overdue
        } else if (daysRemaining <= 3) {
          statusColor = 'yellow'; // Critical warning
        } else {
          statusColor = 'green'; // Safe
        }
      }

      return {
        ...row,
        daysRemaining,
        statusColor,
      };
    });
  }

  async updateContainer(auth: AuthContext, containerId: string, dto: UpdateMaritimeContainerDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
    const container = await trx
      .selectFrom('maritime_containers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', containerId as any)
      .forUpdate()
      .executeTakeFirst();

    if (!container) throw new NotFoundException('Container not found');
    const dischargedAtValue = dto.dischargedAt !== undefined ? dto.dischargedAt : container.discharged_at;
    const returnedAtValue = dto.emptyReturnedAt !== undefined ? dto.emptyReturnedAt : container.empty_returned_at;
    if ([dischargedAtValue, returnedAtValue].some((value) => value && !Number.isFinite(new Date(String(value)).getTime()))) {
      throw new BadRequestException('تاريخ تفريغ أو إرجاع الحاوية غير صالح');
    }
    if (dischargedAtValue && returnedAtValue && new Date(String(returnedAtValue)).getTime() < new Date(String(dischargedAtValue)).getTime()) {
      throw new BadRequestException('تاريخ إرجاع الحاوية لا يمكن أن يسبق تاريخ التفريغ');
    }
    if (dto.depositAmount !== undefined && Number(dto.depositAmount) !== Number(container.deposit_amount)) {
      throw new BadRequestException('لا يمكن تغيير مبلغ تأمين سبق قيده محاسبياً');
    }
    if (dto.depositCurrency !== undefined && dto.depositCurrency !== container.deposit_currency) {
      throw new BadRequestException('لا يمكن تغيير عملة تأمين سبق قيده محاسبياً');
    }
    if (dto.depositStatus === 'not_required' && Number(container.deposit_amount) > 0) {
      throw new BadRequestException('لا يمكن إلغاء تأمين حاوية له مبلغ وقيد محاسبي');
    }
    const terminalDepositStatus = String(dto.depositStatus || '');
    if (['refunded_to_treasury', 'forfeited'].includes(terminalDepositStatus)) {
      if (['refunded_to_treasury', 'forfeited'].includes(container.deposit_status)) {
        if (container.deposit_status !== terminalDepositStatus) throw new BadRequestException('تمت تسوية تأمين الحاوية مسبقاً');
      } else {
        await this.postContainerDepositJournal(trx, tenantId, containerId, Number(container.deposit_amount),
          container.deposit_currency, terminalDepositStatus === 'forfeited' ? 'forfeit' : 'refund', auth.userId);
      }
    } else if (['refunded_to_treasury', 'forfeited'].includes(container.deposit_status) &&
      dto.depositStatus !== undefined && dto.depositStatus !== container.deposit_status) {
      throw new BadRequestException('لا يمكن إعادة فتح تأمين تمت تسويته محاسبياً');
    }

    if (dto.freeDays !== undefined && (!Number.isInteger(dto.freeDays) || dto.freeDays < 0)) {
      throw new BadRequestException('فترة السماح يجب أن تكون عدداً صحيحاً غير سالب');
    }
    if (dto.demurrageRatePerDay !== undefined && (!Number.isFinite(dto.demurrageRatePerDay) || dto.demurrageRatePerDay < 0)) {
      throw new BadRequestException('الغرامة اليومية يجب أن تكون غير سالبة');
    }

    const updatePayload: any = {
      updated_at: sql`NOW()`,
    };

    if (dto.sealNumber !== undefined) updatePayload.seal_number = dto.sealNumber;
    if (dto.gatedInAt !== undefined) updatePayload.gated_in_at = dto.gatedInAt ? new Date(dto.gatedInAt) : null;
    if (dto.vesselLoadedAt !== undefined) updatePayload.vessel_loaded_at = dto.vesselLoadedAt ? new Date(dto.vesselLoadedAt) : null;
    if (dto.dischargedAt !== undefined) updatePayload.discharged_at = dto.dischargedAt ? new Date(dto.dischargedAt) : null;
    if (dto.gatedOutAt !== undefined) updatePayload.gated_out_at = dto.gatedOutAt ? new Date(dto.gatedOutAt) : null;
    if (dto.emptyReturnedAt !== undefined) updatePayload.empty_returned_at = dto.emptyReturnedAt ? new Date(dto.emptyReturnedAt) : null;
    if (dto.freeDays !== undefined) updatePayload.free_days = dto.freeDays;
    if (dto.demurrageRatePerDay !== undefined) updatePayload.demurrage_rate_per_day = dto.demurrageRatePerDay;
    if (dto.depositAmount !== undefined) updatePayload.deposit_amount = dto.depositAmount;
    if (dto.depositCurrency !== undefined) updatePayload.deposit_currency = dto.depositCurrency;
    if (dto.depositStatus !== undefined) updatePayload.deposit_status = dto.depositStatus;
    if (dto.emptyReturnProofUrl !== undefined) updatePayload.empty_return_proof_url = dto.emptyReturnProofUrl;
    if (dto.notes !== undefined) updatePayload.notes = dto.notes;

    // An explicit return date takes precedence; otherwise free time starts at discharge.
    const dischargedAt = dto.dischargedAt !== undefined ? dto.dischargedAt : container.discharged_at;
    let deadlineDate = dto.returnDeadline !== undefined ? dto.returnDeadline : container.return_deadline;
    if (dto.returnDeadline === undefined && dischargedAt && (dto.dischargedAt !== undefined || dto.freeDays !== undefined || !deadlineDate)) {
      const baseDate = new Date(dischargedAt);
      baseDate.setUTCDate(baseDate.getUTCDate() + Number(dto.freeDays ?? container.free_days ?? 14));
      deadlineDate = baseDate.toISOString().slice(0, 10);
    }
    if (dto.returnDeadline !== undefined || deadlineDate !== container.return_deadline) {
      updatePayload.return_deadline = deadlineDate || null;
    }
    if (deadlineDate) {
      const returnedAt = dto.emptyReturnedAt !== undefined ? dto.emptyReturnedAt : container.empty_returned_at;
      const endDay = new Date(returnedAt || Date.now()).toISOString().slice(0, 10);
      const deadlineDay = new Date(deadlineDate).toISOString().slice(0, 10);
      const overdueDays = Math.max(0, Math.round((Date.parse(endDay) - Date.parse(deadlineDay)) / 86_400_000));
      updatePayload.is_overdue = !returnedAt && overdueDays > 0;
      updatePayload.overdue_days = overdueDays;
      updatePayload.demurrage_amount = overdueDays * Number(dto.demurrageRatePerDay ?? container.demurrage_rate_per_day ?? 0);
    } else {
      updatePayload.is_overdue = false;
      updatePayload.overdue_days = 0;
      updatePayload.demurrage_amount = 0;
    }

    const originalDemurrage = Math.max(Number(container.demurrage_amount || 0),
      Number(updatePayload.overdue_days || 0) * Number(container.demurrage_rate_per_day || 0));
    if (Number(updatePayload.demurrage_amount || 0) > Number(container.demurrage_amount || 0) + 0.01) {
      const job = await trx.selectFrom('maritime_jobs').select('status')
        .where('tenant_id', '=', tenantId).where('id', '=', container.job_id as any).executeTakeFirst();
      if (job?.status === 'completed') {
        throw new BadRequestException('أعد فتح الشحنة وفوتر غرامة التأخير الجديدة قبل تعديل الحاوية');
      }
    }
    if (originalDemurrage > Number(updatePayload.demurrage_amount || 0) + 0.01) {
      const reason = (dto.notes || '').trim();
      if (!['admin', 'super_admin', 'finance_manager'].includes(auth.role.toLowerCase()) ||
        reason.length < 10 || reason === (container.notes || '').trim()) {
        throw new BadRequestException('خفض غرامة التأخير يتطلب اعتماد مدير مالي وسبباً موثقاً لا يقل عن 10 أحرف');
      }
      updatePayload.notes = `${container.notes || ''}\nاعتماد خفض الغرامة من ${originalDemurrage} إلى ${updatePayload.demurrage_amount}: ${reason} (مستخدم ${auth.userId})`;
    }

    const [updated] = await trx
      .updateTable('maritime_containers')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', containerId as any)
      .returningAll()
      .execute();

    return updated;
    });
  }

  async createContainer(auth: AuthContext, dto: any) {
    const { tenantId } = requireTenantScope(auth);
    const containerNumber = String(dto.containerNumber || '').trim().toUpperCase();
    if (!containerNumber) throw new BadRequestException('رقم الحاوية مطلوب');

    const freeDays = Number(dto.freeDays ?? 14);
    const demurrageRate = Number(dto.demurrageRatePerDay ?? 0);
    if (!Number.isInteger(freeDays) || freeDays < 0 || !Number.isFinite(demurrageRate) || demurrageRate < 0) {
      throw new BadRequestException('فترة السماح أو الغرامة اليومية غير صالحة');
    }
    const deadlineDate = dto.returnDeadline ? new Date(dto.returnDeadline).toISOString().slice(0, 10) : null;
    const overdueDays = deadlineDate
      ? Math.max(0, Math.round((Date.parse(new Date().toISOString().slice(0, 10)) - Date.parse(deadlineDate)) / 86_400_000))
      : 0;

    let depositStatus: 'not_required' | 'held_by_line' = 'not_required';
    if (dto.depositAmount && Number(dto.depositAmount) > 0) {
      depositStatus = 'held_by_line';
    }

    const inserted = await this.db.transaction().execute(async (trx) => {
    const job = await trx.selectFrom('maritime_jobs').select('id')
      .where('tenant_id', '=', tenantId).where('id', '=', String(dto.jobId) as any)
      .forUpdate().executeTakeFirst();
    if (!job) throw new NotFoundException('Shipment Job not found');
    const duplicate = await trx.selectFrom('maritime_containers').select('id')
      .where('tenant_id', '=', tenantId).where('job_id', '=', String(dto.jobId))
      .where(sql<string>`UPPER(TRIM(container_number))`, '=', containerNumber).executeTakeFirst();
    if (duplicate) throw new BadRequestException('رقم الحاوية موجود مسبقاً في أمر الشحن');
    const [container] = await trx
      .insertInto('maritime_containers')
      .values({
        tenant_id: tenantId,
        job_id: dto.jobId,
        container_number: containerNumber,
        container_type: dto.containerType || "40' HC",
        seal_number: dto.sealNumber || null,
        gross_weight_kg: Number(dto.grossWeightKg) || 0,
        cbm: Number(dto.cbm) || 0,
        free_days: freeDays,
        return_deadline: deadlineDate,
        is_overdue: overdueDays > 0,
        overdue_days: overdueDays,
        demurrage_rate_per_day: demurrageRate,
        demurrage_amount: overdueDays * demurrageRate,
        deposit_amount: Number(dto.depositAmount) || 0,
        deposit_currency: dto.depositCurrency || 'USD',
        deposit_status: depositStatus,
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();
    if (Number(dto.depositAmount || 0) > 0) {
      await this.postContainerDepositJournal(trx, tenantId, String(container.id), Number(dto.depositAmount),
        dto.depositCurrency || 'USD', 'open', auth.userId);
    }
    return container;
    });

    return inserted;
  }

  // --------------------------------------------------------------------------
  // 8. Public Live Tracking for Clients (Flexport Standard)
  // --------------------------------------------------------------------------
  async getPublicTrackingByToken(token: string) {
    if (!token || token.trim().length === 0) {
      throw new BadRequestException('رمز التتبع غير صحيح');
    }

    const cleanToken = token.trim();

    // The random tracking token is the capability credential. Business references
    // are guessable and must never be accepted on this public route.
    const job = await this.db
      .selectFrom('maritime_jobs')
      .selectAll()
      .where('tracking_token', '=', cleanToken)
      .executeTakeFirst();

    if (!job) {
      throw new NotFoundException('الشحنة المطلوبة غير موجودة أو انتهت صلاحية الرابط');
    }

    const tenantId = job.tenant_id;

    const milestones = await this.db
      .selectFrom('maritime_job_milestones')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(job.id))
      .orderBy('occurred_at', 'asc')
      .execute();

    const containers = await this.db
      .selectFrom('maritime_containers')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', String(job.id))
      .execute();

    // Fetch company branding settings
    const companySettingsRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', tenantId)
      .where('key', 'in', ['companyName', 'storeName', 'email', 'phone', 'logo'])
      .execute();

    const companySettings = companySettingsRows.reduce<Record<string, string>>((acc, r) => {
      try { acc[r.key] = JSON.parse(r.value); } catch { acc[r.key] = r.value; }
      return acc;
    }, {});

    const publicJob = {
        id: job.id,
        jobNumber: job.job_number,
        bookingNumber: job.booking_number,
        mblNumber: job.mbl_number,
        hblNumber: job.hbl_number,
        vesselName: job.vessel_name,
        voyageNumber: job.voyage_number,
        direction: job.direction,
        paymentTerm: job.payment_term,
        shippingLineName: job.shipping_line_name,
        polCode: job.pol_code,
        polName: job.pol_name,
        podCode: job.pod_code,
        podName: job.pod_name,
        etd: job.etd,
        eta: job.eta,
        portCutOff: job.port_cut_off,
        milestoneStatus: job.milestone_status,
        deliveryOrderReleased: job.delivery_order_released,
        deliveryOrderReleasedAt: job.delivery_order_released_at,
        customerName: job.customer_name,
        status: job.status,
    };
    return {
      shipment: publicJob,
      job: publicJob,
      milestones: milestones.map((m) => ({
        id: m.id,
        key: m.milestone_key,
        title: m.milestone_title,
        occurredAt: m.occurred_at,
        location: m.location,
        notes: m.notes,
      })),
      containers: containers.map((c) => ({
        id: c.id,
        containerNumber: c.container_number,
        containerType: c.container_type,
        sealNumber: c.seal_number,
        grossWeightKg: c.gross_weight_kg,
        cbm: c.cbm,
        freeDays: c.free_days,
        returnDeadline: c.return_deadline,
        isOverdue: c.is_overdue,
        overdueDays: c.overdue_days,
        dischargedAt: c.discharged_at,
        gatedOutAt: c.gated_out_at,
        emptyReturnedAt: c.empty_returned_at,
      })),
      dcsaMilestones: DCSA_STANDARD_MILESTONES,
      dcsaDefinitions: DCSA_STANDARD_MILESTONES,
      company: {
        name: companySettings.companyName || companySettings.storeName || 'منظومة Z-Systems للشحن الملاحي',
        phone: companySettings.phone || '',
        email: companySettings.email || '',
        logo: companySettings.logo || null,
      },
    };
  }

  // --------------------------------------------------------------------------
  // 9. Public Carrier Quote Portal (Magic Links)
  // --------------------------------------------------------------------------
  // `id` is a sequential, tenant-shared BIGINT — never trust it alone on a public
  // route. Every public quote/bid link must also carry the per-RFQ secret token.
  private assertValidPublicQuoteToken<T extends { public_quote_token: string | null }>(
    rfq: T | undefined,
    token?: string,
  ): asserts rfq is T {
    const cleanToken = String(token || '').trim();
    if (!rfq || !rfq.public_quote_token || !cleanToken || rfq.public_quote_token !== cleanToken) {
      throw new NotFoundException('RFQ not found or invalid link');
    }
  }

  async getPublicRfqForQuote(rfqId: string, token: string, carrierCode?: string) {
    const rfq = await this.db
      .selectFrom('maritime_rfqs')
      .selectAll()
      .where('id', '=', rfqId as any)
      .executeTakeFirst();

    this.assertValidPublicQuoteToken(rfq, token);

    let carrier: any = null;
    if (carrierCode) {
      carrier = await this.db
        .selectFrom('shipping_lines')
        .selectAll()
        .where('tenant_id', '=', rfq.tenant_id)
        .where('code', '=', carrierCode)
        .executeTakeFirst();
    }

    // Get company/tenant branding
    const companySettingsRows = await this.db
      .selectFrom('settings')
      .select(['key', 'value'])
      .where('tenant_id', '=', rfq.tenant_id)
      .where('key', 'in', ['companyName', 'storeName', 'email', 'phone'])
      .execute();

    const companySettings = companySettingsRows.reduce<Record<string, string>>((acc, r) => {
      try { acc[r.key] = JSON.parse(r.value); } catch { acc[r.key] = r.value; }
      return acc;
    }, {});

    return {
      rfq: {
        id: rfq.id,
        rfq_number: rfq.rfq_number,
        direction: rfq.direction,
        pol_code: rfq.pol_code,
        pol_name: rfq.pol_name,
        pod_code: rfq.pod_code,
        pod_name: rfq.pod_name,
        cargo_mode: rfq.cargo_mode,
        container_type: rfq.container_type,
        container_count: rfq.container_count,
        commodity_description: rfq.commodity_description,
        cargo_nature: rfq.cargo_nature,
        cargo_ready_date: rfq.cargo_ready_date,
        target_free_days: rfq.target_free_days,
        incoterm: rfq.incoterm,
        payment_term: rfq.payment_term,
        status: rfq.status,
      },
      carrier: carrier ? {
        id: carrier.id,
        code: carrier.code,
        name_ar: carrier.name_ar,
        name_en: carrier.name_en,
        carrier_type: carrier.carrier_type,
      } : null,
      company: {
        name: companySettings.companyName || companySettings.storeName || 'منصة Z-Systems اللوجستية',
        email: companySettings.email || '',
        phone: companySettings.phone || '',
      }
    };
  }

  async submitPublicCarrierBid(rfqId: string, dto: any) {
    const rfq = await this.db
      .selectFrom('maritime_rfqs')
      .selectAll()
      .where('id', '=', rfqId as any)
      .executeTakeFirst();

    this.assertValidPublicQuoteToken(rfq, dto?.token);

    if (['awarded', 'closed', 'cancelled'].includes(rfq.status)) {
      throw new BadRequestException('طلب عروض الأسعار مغلق أو تم ترسيته بالفعل ولا يمكن تقديم عروض إضافية');
    }

    const oceanFreight = Number(dto.oceanFreight || 0);
    const thcOrigin = Number(dto.thcOrigin || 0);
    const thcDestination = Number(dto.thcDestination || 0);
    const bafCharges = Number(dto.bafCharges || 0);
    const otherCharges = Number(dto.otherCharges || 0);
    const totalFreightCost = oceanFreight + thcOrigin + thcDestination + bafCharges + otherCharges;

    const [bid] = await this.db
      .insertInto('maritime_rfq_bids')
      .values({
        tenant_id: rfq.tenant_id,
        rfq_id: String(rfq.id),
        shipping_line_id: dto.shippingLineId ? String(dto.shippingLineId) : null,
        shipping_line_name: dto.shippingLineName || dto.lineName || 'Online Carrier Bid',
        ocean_freight: oceanFreight,
        currency: dto.currency || 'USD',
        thc_origin: thcOrigin,
        thc_destination: thcDestination,
        baf_charges: bafCharges,
        other_charges: otherCharges,
        total_freight_cost: totalFreightCost,
        transit_time_days: dto.transitTimeDays || 0,
        free_days: dto.freeDays || rfq.target_free_days || 14,
        validity_date: dto.validityDate || null,
        submission_channel: 'carrier_portal',
        raw_bid_data: JSON.stringify(dto),
        notes: dto.notes || null,
      })
      .returningAll()
      .execute();

    // Update RFQ status to bids_received only if open or sent
    if (['draft', 'open', 'sent_to_carriers'].includes(rfq.status)) {
      await this.db
        .updateTable('maritime_rfqs')
        .set({ status: 'bids_received', updated_at: sql`NOW()` })
        .where('id', '=', rfqId as any)
        .where('tenant_id', '=', rfq.tenant_id)
        .execute();
    }

    return bid;
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

  // --------------------------------------------------------------------------
  // 11. Maritime Automation Pipeline & Checkpoints Engine
  // --------------------------------------------------------------------------
  async getTenantPipelineConfig(tenantId: string): Promise<MaritimePipelineConfig> {
    const row = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'maritime_pipeline_config')
      .executeTakeFirst();

    if (!row?.value) {
      return { ...DEFAULT_PIPELINE_CONFIG };
    }

    try {
      const parsed = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
      return { ...DEFAULT_PIPELINE_CONFIG, ...parsed };
    } catch {
      return { ...DEFAULT_PIPELINE_CONFIG };
    }
  }

  async getPipelineSettings(auth: AuthContext): Promise<MaritimePipelineConfig> {
    const { tenantId } = requireTenantScope(auth);
    return this.getTenantPipelineConfig(tenantId);
  }

  async savePipelineSettings(auth: AuthContext, dto: Partial<MaritimePipelineConfig>): Promise<MaritimePipelineConfig> {
    const { tenantId } = requireTenantScope(auth);
    const current = await this.getTenantPipelineConfig(tenantId);
    const updated: MaritimePipelineConfig = { ...current, ...dto };

    const existing = await this.db
      .selectFrom('settings')
      .select('key')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'maritime_pipeline_config')
      .executeTakeFirst();

    if (existing) {
      await this.db
        .updateTable('settings')
        .set({ value: JSON.stringify(updated) })
        .where('tenant_id', '=', tenantId)
        .where('key', '=', 'maritime_pipeline_config')
        .execute();
    } else {
      await this.db
        .insertInto('settings')
        .values({
          tenant_id: tenantId,
          key: 'maritime_pipeline_config',
          value: JSON.stringify(updated),
        })
        .execute();
    }

    return updated;
  }

  async processAutomatedPipelineForTenant(auth: AuthContext): Promise<{
    processedRfqs: number;
    awardedCount: number;
    quotesGenerated: number;
    details: string[];
  }> {
    const { tenantId } = requireTenantScope(auth);
    const config = await this.getTenantPipelineConfig(tenantId);

    if (config.automationMode === 'manual') {
      return { processedRfqs: 0, awardedCount: 0, quotesGenerated: 0, details: ['الوضع التشغيلي مضبوط على يدوي بالكامل'] };
    }

    const openRfqs = await this.db
      .selectFrom('maritime_rfqs')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['sent', 'bids_received'])
      .where('auto_awarded', '=', false)
      .execute();

    if (openRfqs.length === 0) {
      return { processedRfqs: 0, awardedCount: 0, quotesGenerated: 0, details: [] };
    }

    const currencySetting = await this.db
      .selectFrom('settings')
      .select('value')
      .where('tenant_id', '=', tenantId)
      .where('key', '=', 'currency')
      .executeTakeFirst();
    let systemCurrency = 'EGP';
    if (currencySetting) {
      try { systemCurrency = String(JSON.parse(currencySetting.value)); }
      catch { systemCurrency = String(currencySetting.value); }
    }
    systemCurrency = systemCurrency.trim().toUpperCase();

    let awardedCount = 0;
    let quotesGenerated = 0;
    const details: string[] = [];
    const now = new Date();

    for (const rfq of openRfqs) {
      const bids = await this.db
        .selectFrom('maritime_rfq_bids')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('rfq_id', '=', String(rfq.id))
        .execute();

      if (bids.length === 0) continue;

      const bidCurrencies = new Set(bids.map((b) => String(b.currency).toUpperCase()));
      const bidCurrency = String(bids[0].currency).toUpperCase();
      if (bidCurrencies.size !== 1 || (bidCurrency !== systemCurrency && bidCurrency !== 'USD')) {
        details.push(`طلب ${rfq.rfq_number}: يلزم مراجعة عملات العروض وسعر الصرف قبل الترسية`);
        continue;
      }

      const isDeadlineReached = rfq.cut_off_deadline ? now >= new Date(rfq.cut_off_deadline) : false;
      const minFreeDays = config.earlyAwardingMinFreeDays || 14;
      const targetRate = rfq.target_rate_max ? Number(rfq.target_rate_max) : null;

      const earlyBid = config.earlyAwardingEnabled
        ? bids.find((b) => Number(b.free_days) >= minFreeDays && (targetRate ? Number(b.total_freight_cost) <= targetRate : false))
        : null;

      if (!isDeadlineReached && !earlyBid) {
        // Still within bidding window and no early trigger satisfied
        continue;
      }

      // If checkpoint 2 (requireManualAwardAndMargin) is enabled, do NOT auto-award; just notify/update status
      if (config.requireManualAwardAndMargin) {
        if (rfq.status !== 'bids_received') {
          await this.db
            .updateTable('maritime_rfqs')
            .set({ status: 'bids_received', updated_at: sql`NOW()` })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', rfq.id)
            .execute();
        }
        details.push(`طلب ${rfq.rfq_number}: العروض مكتملة، بانتظار الاعتماد والمراجعة البشرية للهامش (محطة توقف مفعلة)`);
        continue;
      }

      // Pick best bid: Early bid if triggered, or lowest total freight cost
      const sortedBids = [...bids].sort((a, b) => {
        const costDiff = Number(a.total_freight_cost || 0) - Number(b.total_freight_cost || 0);
        if (costDiff !== 0) return costDiff;
        return Number(b.free_days || 0) - Number(a.free_days || 0);
      });
      const bestBid = earlyBid || sortedBids[0];
      if (!bestBid) continue;

      try {
        // 1. Award bid
        await this.awardBid(auth, String(bestBid.id));
        await this.db
          .updateTable('maritime_rfqs')
          .set({ auto_awarded: true, updated_at: sql`NOW()` })
          .where('tenant_id', '=', tenantId)
          .where('id', '=', rfq.id)
          .execute();
        awardedCount++;

        // 2. Compute margin
        const baseCost = Number(bestBid.total_freight_cost || 0);
        let profit = 0;
        if (config.defaultMarginType === 'percentage') {
          profit = baseCost * (config.defaultMarginValue / 100);
        } else {
          profit = Number(config.defaultMarginValue ?? 200);
        }
        const marginFloor = Number(config.marginFloor ?? 150);
        if (profit < marginFloor) {
          profit = marginFloor;
        }
        const marginType = config.defaultMarginType === 'percentage' && baseCost > 0 && profit === baseCost * (config.defaultMarginValue / 100)
          ? 'percentage'
          : 'fixed';

        // 3. Issue quotation
        const quote = await this.createQuotation(auth, {
          rfqId: String(rfq.id),
          bidId: String(bestBid.id),
          customerId: rfq.customer_id ? Number(rfq.customer_id) : undefined,
          customerName: rfq.customer_name || 'عميل الشحنة',
          customerPhone: rfq.customer_phone || undefined,
          customerEmail: rfq.customer_email || undefined,
          paymentTerm: rfq.payment_term || 'prepaid',
          baseCost,
          currency: bestBid.currency || 'USD',
          marginType,
          marginValue: marginType === 'percentage' ? config.defaultMarginValue : profit,
          exchangeRate: bidCurrency === systemCurrency ? 1 : Number(config.defaultExchangeRate || 48.5),
          notes: `عرض صادر آلياً وفقاً لمسار الأتمتة (${config.automationMode === 'full_autonomous' ? 'أتمتة كاملة' : 'هجين ذكي'}). العرض الفائز من ${bestBid.shipping_line_name}`,
        });
        quotesGenerated++;

        // 4. Quote dispatch checkpoint
        if (!config.requireManualQuoteDispatch) {
          await this.db
            .updateTable('maritime_quotations')
            .set({ status: 'sent' })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', quote.id as any)
            .execute();

          if (config.autoSendWhatsAppQuote && rfq.customer_phone) {
            try {
              const cleanPhone = rfq.customer_phone.replace(/[^0-9]/g, '');
              const totalClient = baseCost + profit;
              const msg = `مرحباً ${rfq.customer_name || 'عميلنا العزيز'}، يسعدنا تقديم عرض سعر الشحن البحري:\n` +
                `• مسار: من ${rfq.pol_name} إلى ${rfq.pod_name}\n` +
                `• الحاويات: ${rfq.container_count}x ${rfq.container_type}\n` +
                `• الخط الملاحي: ${bestBid.shipping_line_name}\n` +
                `• فترة السماح بالميناء: ${bestBid.free_days} يوم\n` +
                `• السعر الإجمالي: $${totalClient.toLocaleString()} USD\n` +
                `• رقم العرض المرجعي: ${quote.quotation_number}`;
              await this.whatsAppGatewayService.sendRawMessage(tenantId, cleanPhone, msg);
            } catch (err: any) {
              this.logger.warn(`Failed auto WhatsApp quote dispatch for RFQ [${rfq.rfq_number}]: ${err?.message}`);
            }
          }
        }

        details.push(`طلب ${rfq.rfq_number}: تمت الترسية آلياً على خط ${bestBid.shipping_line_name} بسعر ${baseCost}$ مع هامش ربح ${profit}$ وإصدار عرض ${quote.quotation_number}`);
      } catch (err: any) {
        this.logger.error(`Error in automated RFQ pipeline for RFQ [${rfq.rfq_number}]: ${err?.message}`);
      }
    }

    return {
      processedRfqs: openRfqs.length,
      awardedCount,
      quotesGenerated,
      details,
    };
  }

  // --------------------------------------------------------------------------
  // Rate Management (Contract/Tariff Rate Cards — CargoWise Benchmark)
  // --------------------------------------------------------------------------
  // Closes the "Rate Management" gap: previously the only pricing mechanism was
  // a live RFQ (ask now, wait for carrier replies). Rate cards let ops instantly
  // quote a customer from a persisted, reusable negotiated rate instead of
  // waiting on a fresh round of carrier bids every time.

  private mapRateCardRow(r: any) {
    return {
      id: String(r.id),
      shippingLineId: r.shipping_line_id ? String(r.shipping_line_id) : null,
      carrierName: r.carrier_name,
      transportMode: r.transport_mode || 'sea',
      rateBasis: r.rate_basis || 'per_container',
      minCharge: Number(r.min_charge || 0),
      polCode: r.pol_code,
      polName: r.pol_name,
      podCode: r.pod_code,
      podName: r.pod_name,
      cargoMode: r.cargo_mode,
      containerType: r.container_type,
      oceanFreight: Number(r.ocean_freight),
      currency: r.currency,
      thcOrigin: Number(r.thc_origin),
      thcDestination: Number(r.thc_destination),
      bafCharges: Number(r.baf_charges),
      otherCharges: Number(r.other_charges),
      totalFreightCost: Number(r.total_freight_cost),
      transitTimeDays: Number(r.transit_time_days),
      freeDays: Number(r.free_days),
      validFrom: r.valid_from,
      validUntil: r.valid_until,
      source: r.source,
      sourceBidId: r.source_bid_id ? String(r.source_bid_id) : null,
      status: r.status,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  async listRateCards(auth: AuthContext, filters?: { polCode?: string; podCode?: string; containerType?: string; status?: string; transportMode?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db.selectFrom('maritime_rate_cards').selectAll().where('tenant_id', '=', tenantId);

    if (filters?.polCode) query = query.where('pol_code', '=', filters.polCode.toUpperCase());
    if (filters?.podCode) query = query.where('pod_code', '=', filters.podCode.toUpperCase());
    if (filters?.containerType) query = query.where('container_type', '=', filters.containerType);
    if (filters?.transportMode) query = query.where('transport_mode', '=', filters.transportMode as any);
    if (filters?.status) query = query.where('status', '=', filters.status as any);

    const rows = await query.orderBy('total_freight_cost', 'asc').execute();

    // Surface expired-but-still-flagged-active cards as expired without requiring a cron job.
    const today = new Date().toISOString().slice(0, 10);
    return rows.map((r) => this.mapRateCardRow({ ...r, status: r.status === 'active' && r.valid_until < today ? 'expired' : r.status }));
  }

  /**
   * Instant quote lookup: the cheapest still-valid rate card matching the lane
   * and container. This is the "80% of forwarders don't need a live RFQ for
   * every shipment" path — a real contract rate beats waiting on carrier replies.
   */
  async findBestRate(auth: AuthContext, polCode: string, podCode: string, containerType?: string) {
    const { tenantId } = requireTenantScope(auth);
    const today = new Date().toISOString().slice(0, 10);

    let query = this.db
      .selectFrom('maritime_rate_cards')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('pol_code', '=', polCode.toUpperCase())
      .where('pod_code', '=', podCode.toUpperCase())
      .where('status', '=', 'active')
      .where('valid_from', '<=', today)
      .where('valid_until', '>=', today);

    if (containerType) query = query.where('container_type', '=', containerType);

    const rows = await query.orderBy('total_freight_cost', 'asc').execute();
    return rows.map((r) => this.mapRateCardRow(r));
  }

  async createRateCard(auth: AuthContext, dto: CreateRateCardDto) {
    const { tenantId } = requireTenantScope(auth);

    const oceanFreight = Number(dto.oceanFreight || 0);
    const thcOrigin = Number(dto.thcOrigin || 0);
    const thcDestination = Number(dto.thcDestination || 0);
    const bafCharges = Number(dto.bafCharges || 0);
    const otherCharges = Number(dto.otherCharges || 0);
    const totalFreightCost = oceanFreight + thcOrigin + thcDestination + bafCharges + otherCharges;

    let carrierName = dto.carrierName?.trim() || '';
    if (dto.shippingLineId && !carrierName) {
      const line = await this.db
        .selectFrom('shipping_lines')
        .select(['name_en', 'name_ar'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', String(dto.shippingLineId) as any)
        .executeTakeFirst();
      carrierName = line?.name_en || line?.name_ar || '';
    }

    const row = await this.db
      .insertInto('maritime_rate_cards')
      .values({
        tenant_id: tenantId,
        shipping_line_id: dto.shippingLineId ? (String(dto.shippingLineId) as any) : null,
        carrier_name: carrierName || 'Unnamed Carrier',
        transport_mode: dto.transportMode || 'sea',
        rate_basis: dto.rateBasis || 'per_container',
        min_charge: Number(dto.minCharge || 0),
        pol_code: dto.polCode.toUpperCase(),
        pol_name: dto.polName || dto.polCode.toUpperCase(),
        pod_code: dto.podCode.toUpperCase(),
        pod_name: dto.podName || dto.podCode.toUpperCase(),
        cargo_mode: dto.cargoMode || 'FCL',
        container_type: dto.containerType || '40HC',
        ocean_freight: oceanFreight,
        currency: dto.currency || 'USD',
        thc_origin: thcOrigin,
        thc_destination: thcDestination,
        baf_charges: bafCharges,
        other_charges: otherCharges,
        total_freight_cost: totalFreightCost,
        transit_time_days: dto.transitTimeDays || 0,
        free_days: dto.freeDays || 14,
        valid_from: dto.validFrom || new Date().toISOString().slice(0, 10),
        valid_until: dto.validUntil,
        source: 'manual',
        status: 'active',
        notes: dto.notes || null,
        created_by: auth.userId ? Number(auth.userId) : null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapRateCardRow(row);
  }

  /** Converts an awarded RFQ bid into a reusable rate card, so a one-off win builds the rate database over time. */
  async createRateCardFromBid(auth: AuthContext, bidId: string, validUntil: string) {
    const { tenantId } = requireTenantScope(auth);
    const bid = await this.db
      .selectFrom('maritime_rfq_bids as b')
      .innerJoin('maritime_rfqs as r', 'r.id', 'b.rfq_id')
      .select([
        'b.id', 'b.shipping_line_id', 'b.shipping_line_name', 'b.ocean_freight', 'b.currency',
        'b.thc_origin', 'b.thc_destination', 'b.baf_charges', 'b.other_charges', 'b.total_freight_cost',
        'b.transit_time_days', 'b.free_days',
        'r.pol_code', 'r.pol_name', 'r.pod_code', 'r.pod_name', 'r.cargo_mode', 'r.container_type',
      ])
      .where('b.tenant_id', '=', tenantId)
      .where('b.id', '=', bidId as any)
      .executeTakeFirst();

    if (!bid) throw new NotFoundException('عرض السعر غير موجود');

    const row = await this.db
      .insertInto('maritime_rate_cards')
      .values({
        tenant_id: tenantId,
        shipping_line_id: bid.shipping_line_id,
        carrier_name: bid.shipping_line_name,
        pol_code: bid.pol_code,
        pol_name: bid.pol_name,
        pod_code: bid.pod_code,
        pod_name: bid.pod_name,
        cargo_mode: bid.cargo_mode,
        container_type: bid.container_type,
        ocean_freight: bid.ocean_freight,
        currency: bid.currency,
        thc_origin: bid.thc_origin,
        thc_destination: bid.thc_destination,
        baf_charges: bid.baf_charges,
        other_charges: bid.other_charges,
        total_freight_cost: bid.total_freight_cost,
        transit_time_days: bid.transit_time_days,
        free_days: bid.free_days,
        valid_from: new Date().toISOString().slice(0, 10),
        valid_until: validUntil,
        source: 'carrier_bid',
        source_bid_id: bid.id,
        status: 'active',
        created_by: auth.userId ? Number(auth.userId) : null,
      } as any)
      .returningAll()
      .executeTakeFirstOrThrow();

    return this.mapRateCardRow(row);
  }

  async updateRateCardStatus(auth: AuthContext, id: string, dto: UpdateRateCardStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await this.db
      .updateTable('maritime_rate_cards')
      .set({ status: dto.status, updated_at: sql`NOW()` })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) throw new NotFoundException('التعرفة غير موجودة');
    return this.mapRateCardRow(updated);
  }

  async deleteRateCard(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    await this.db
      .deleteFrom('maritime_rate_cards')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .execute();
    return { success: true };
  }

  // --------------------------------------------------------------------------
  // Customs Declarations (HS Codes & Duty Tracking — internal record-keeping)
  // --------------------------------------------------------------------------
  // NOT live filing with a customs authority: this closes the "customs is only
  // descriptive text in the carrier directory" gap by giving HS codes, declared
  // value, and duty amounts a real place to live and be totalled, so a shipment's
  // landed cost is complete. Government EDI filing needs a broker/authority
  // integration and credentials this session does not have (O18).

  private mapCustomsDeclarationRow(r: any) {
    return {
      id: String(r.id),
      jobId: String(r.job_id),
      declarationNumber: r.declaration_number,
      declarationType: r.declaration_type,
      customsAuthority: r.customs_authority,
      brokerName: r.broker_name,
      submittedDate: r.submitted_date,
      clearedDate: r.cleared_date,
      status: r.status,
      totalCustomsValue: Number(r.total_customs_value),
      totalDutyAmount: Number(r.total_duty_amount),
      currency: r.currency,
      notes: r.notes,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapCustomsItemRow(r: any) {
    return {
      id: String(r.id),
      declarationId: String(r.declaration_id),
      hsCode: r.hs_code,
      commodityDescription: r.commodity_description,
      quantity: Number(r.quantity),
      unit: r.unit,
      customsValue: Number(r.customs_value),
      dutyRatePercent: Number(r.duty_rate_percent),
      dutyAmount: Number(r.duty_amount),
      notes: r.notes,
    };
  }

  async listCustomsDeclarations(auth: AuthContext, jobId: string) {
    const { tenantId } = requireTenantScope(auth);
    const rows = await this.db
      .selectFrom('maritime_customs_declarations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobId as any)
      .orderBy('created_at', 'desc')
      .execute();
    return rows.map((r) => this.mapCustomsDeclarationRow(r));
  }

  async getCustomsDeclarationDetail(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const declaration = await this.db
      .selectFrom('maritime_customs_declarations')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .executeTakeFirst();
    if (!declaration) throw new NotFoundException('البيان الجمركي غير موجود');

    const items = await this.db
      .selectFrom('maritime_customs_declaration_items')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('declaration_id', '=', id as any)
      .execute();

    return {
      declaration: this.mapCustomsDeclarationRow(declaration),
      items: items.map((i) => this.mapCustomsItemRow(i)),
    };
  }

  async createCustomsDeclaration(auth: AuthContext, jobId: string, dto: CreateCustomsDeclarationDto) {
    const { tenantId } = requireTenantScope(auth);

    return this.db.transaction().execute(async (trx) => {
      const job = await trx
        .selectFrom('maritime_jobs')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('id', '=', jobId as any)
        .executeTakeFirst();
      if (!job) throw new NotFoundException('عملية الشحن غير موجودة');

      const items = dto.items || [];
      let totalCustomsValue = 0;
      let totalDutyAmount = 0;
      const computedItems = items.map((item) => {
        const customsValue = Number(item.customsValue || 0);
        const dutyRatePercent = Number(item.dutyRatePercent || 0);
        const dutyAmount = Math.round(customsValue * (dutyRatePercent / 100) * 100) / 100;
        totalCustomsValue += customsValue;
        totalDutyAmount += dutyAmount;
        return { ...item, dutyAmount };
      });

      const declarationRow = await trx
        .insertInto('maritime_customs_declarations')
        .values({
          tenant_id: tenantId,
          job_id: jobId,
          declaration_number: dto.declarationNumber || null,
          declaration_type: dto.declarationType || 'import',
          customs_authority: dto.customsAuthority || null,
          broker_name: dto.brokerName || null,
          status: 'pending',
          total_customs_value: totalCustomsValue,
          total_duty_amount: totalDutyAmount,
          currency: dto.currency || 'USD',
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();

      const insertedItems: any[] = [];
      for (const item of computedItems) {
        const itemRow = await trx
          .insertInto('maritime_customs_declaration_items')
          .values({
            tenant_id: tenantId,
            declaration_id: String(declarationRow.id),
            hs_code: item.hsCode,
            commodity_description: item.commodityDescription || '',
            quantity: item.quantity || 0,
            unit: item.unit || 'PCS',
            customs_value: item.customsValue,
            duty_rate_percent: item.dutyRatePercent,
            duty_amount: item.dutyAmount,
            notes: item.notes || null,
          } as any)
          .returningAll()
          .executeTakeFirstOrThrow();
        insertedItems.push(itemRow);
      }

      return {
        declaration: this.mapCustomsDeclarationRow(declarationRow),
        items: insertedItems.map((i) => this.mapCustomsItemRow(i)),
      };
    });
  }

  async addCustomsDeclarationItem(auth: AuthContext, declarationId: string, dto: CreateCustomsDeclarationItemDto) {
    const { tenantId } = requireTenantScope(auth);

    return this.db.transaction().execute(async (trx) => {
      const declaration = await trx
        .selectFrom('maritime_customs_declarations')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', declarationId as any)
        .forUpdate()
        .executeTakeFirst();
      if (!declaration) throw new NotFoundException('البيان الجمركي غير موجود');

      const customsValue = Number(dto.customsValue || 0);
      const dutyRatePercent = Number(dto.dutyRatePercent || 0);
      const dutyAmount = Math.round(customsValue * (dutyRatePercent / 100) * 100) / 100;

      const itemRow = await trx
        .insertInto('maritime_customs_declaration_items')
        .values({
          tenant_id: tenantId,
          declaration_id: declarationId,
          hs_code: dto.hsCode,
          commodity_description: dto.commodityDescription || '',
          quantity: dto.quantity || 0,
          unit: dto.unit || 'PCS',
          customs_value: customsValue,
          duty_rate_percent: dutyRatePercent,
          duty_amount: dutyAmount,
          notes: dto.notes || null,
        } as any)
        .returningAll()
        .executeTakeFirstOrThrow();

      await trx
        .updateTable('maritime_customs_declarations')
        .set({
          total_customs_value: Number(declaration.total_customs_value) + customsValue,
          total_duty_amount: Number(declaration.total_duty_amount) + dutyAmount,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', declarationId as any)
        .execute();

      return this.mapCustomsItemRow(itemRow);
    });
  }

  async updateCustomsDeclarationStatus(auth: AuthContext, id: string, dto: UpdateCustomsDeclarationStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const updatePayload: any = { status: dto.status, updated_at: sql`NOW()` };
    if (dto.declarationNumber) updatePayload.declaration_number = dto.declarationNumber;
    if (dto.status === 'submitted') updatePayload.submitted_date = new Date().toISOString().slice(0, 10);
    if (dto.status === 'cleared') updatePayload.cleared_date = new Date().toISOString().slice(0, 10);

    const [updated] = await this.db
      .updateTable('maritime_customs_declarations')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) throw new NotFoundException('البيان الجمركي غير موجود');
    return this.mapCustomsDeclarationRow(updated);
  }

  // --------------------------------------------------------------------------
  // Freight Audit & Rate Reconciliation (CargoWise Benchmark)
  // --------------------------------------------------------------------------

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
    const today = new Date().toISOString().slice(0, 10);

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
          invoice_date: dto.invoiceDate ? (dto.invoiceDate as any) : (new Date().toISOString().slice(0, 10) as any),
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

      const finalNumber = formatDailyDocumentNumber('DISP', Number(inserted.id), new Date());
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

  // ==========================================
  // CARGO INSURANCE METHODS
  // ==========================================
  /**
   * يتحقق أن الشحنة المرجعية تخص نفس المستأجر قبل تعليق سجل ابن عليها.
   *
   * المفتاح الأجنبي في الهجرة 126 أحادي العمود (`job_id REFERENCES maritime_jobs(id)`)
   * لا مركّب `(tenant_id, id)` كما في هجرة 101 للمقاولات — فهو يضمن أن الشحنة
   * **موجودة** لا أنها **تخصّك**. بدون هذا الفحص يعلّق مستأجر وثيقة تأمين أو إيصال
   * مستودع على شحنة مستأجر آخر (السجل نفسه يبقى معزولاً بـ`tenant_id`، لكن المرجع
   * يصبح معلّقاً عبر المستأجرين). نفس الفحص موجود أصلاً في `createCustomsDeclaration`.
   */
  private async assertJobBelongsToTenant(trx: any, tenantId: string, jobId: string | number): Promise<void> {
    const job = await trx
      .selectFrom('maritime_jobs')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', jobId as any)
      .executeTakeFirst();
    if (!job) throw new NotFoundException('عملية الشحن غير موجودة');
  }

  async createCargoInsurance(auth: AuthContext, dto: CreateCargoInsuranceDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      await this.assertJobBelongsToTenant(trx, tenantId, dto.jobId);

      const [record] = await trx
        .insertInto('maritime_cargo_insurances')
        .values({
          tenant_id: tenantId,
          job_id: dto.jobId as any,
          policy_number: dto.policyNumber,
          insurance_company: dto.insuranceCompany,
          insured_value: Number(dto.insuredValue || 0),
          premium_amount: Number(dto.premiumAmount || 0),
          currency: dto.currency || 'USD',
          coverage_type: dto.coverageType || 'all_risks',
          issue_date: dto.issueDate || new Date().toISOString().split('T')[0],
          expiry_date: dto.expiryDate || null,
          status: 'active',
          claim_amount: 0,
          claim_status: null,
          claim_notes: null,
          certificate_url: null,
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      return record;
    });
  }

  async updateCargoInsurance(auth: AuthContext, id: string | number, dto: UpdateCargoInsuranceDto) {
    const { tenantId } = requireTenantScope(auth);
    const updatePayload: any = {
      updated_at: sql`NOW()`,
    };
    if (dto.policyNumber !== undefined) updatePayload.policy_number = dto.policyNumber;
    if (dto.insuranceCompany !== undefined) updatePayload.insurance_company = dto.insuranceCompany;
    if (dto.insuredValue !== undefined) updatePayload.insured_value = Number(dto.insuredValue);
    if (dto.premiumAmount !== undefined) updatePayload.premium_amount = Number(dto.premiumAmount);
    if (dto.currency !== undefined) updatePayload.currency = dto.currency;
    if (dto.coverageType !== undefined) updatePayload.coverage_type = dto.coverageType;
    if (dto.expiryDate !== undefined) updatePayload.expiry_date = dto.expiryDate;
    if (dto.notes !== undefined) updatePayload.notes = dto.notes;

    const [updated] = await this.db
      .updateTable('maritime_cargo_insurances')
      .set(updatePayload)
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id as any)
      .returningAll()
      .execute();

    if (!updated) throw new NotFoundException('Cargo Insurance policy not found');
    return updated;
  }

  async claimCargoInsurance(auth: AuthContext, id: string | number, dto: ClaimCargoInsuranceDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('maritime_cargo_insurances')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) throw new NotFoundException('Cargo Insurance policy not found');

      const claimAmount = Number(dto.claimAmount);

      // البوابة في محرك نقي يستورده الاختبار من الإنتاج (AGENTS.md Rule 13):
      // تمنع تجاوز القيمة المؤمَّن عليها (كانت تُخزَّن ولا تُقرأ — F10) وتمنع
      // استبدال مطالبة مسجَّلة بصمت.
      const claimCheck = checkInsuranceClaim(
        { insuredValue: existing.insured_value, status: existing.status, claimAmount: existing.claim_amount },
        claimAmount,
      );
      if (!claimCheck.ok) {
        throw new BadRequestException(claimCheck.message);
      }

      const [updated] = await trx
        .updateTable('maritime_cargo_insurances')
        .set({
          status: 'claimed',
          claim_amount: claimAmount,
          claim_status: dto.claimStatus,
          claim_notes: dto.claimNotes || null,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .returningAll()
        .execute();

      return updated;
    });
  }

  async getJobInsurances(auth: AuthContext, jobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_cargo_insurances')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobId as any)
      .orderBy('id', 'desc')
      .execute();
  }

  // ==========================================
  // WAREHOUSE INTAKE / RECEIPTS METHODS
  // ==========================================
  async createWarehouseReceipt(auth: AuthContext, dto: CreateWarehouseReceiptDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      await this.assertJobBelongsToTenant(trx, tenantId, dto.jobId);

      const tempNumber = `MWR-TMP-${crypto.randomUUID()}`;
      const [receipt] = await trx
        .insertInto('maritime_warehouse_receipts')
        .values({
          tenant_id: tenantId,
          receipt_number: tempNumber,
          job_id: dto.jobId as any,
          location_id: dto.locationId ? (dto.locationId as any) : null,
          received_date: dto.receivedDate ? new Date(dto.receivedDate) : sql`NOW()`,
          package_count: Number(dto.packageCount || 1),
          gross_weight_kg: Number(dto.grossWeightKg || 0),
          cbm: Number(dto.cbm || 0),
          bay_rack_bin: dto.bayRackBin || null,
          warehouse_status: 'in_storage',
          released_at: null,
          released_by: null,
          notes: dto.notes || null,
          created_by: auth.userId ? Number(auth.userId) : null,
        })
        .returningAll()
        .execute();

      const finalNumber = formatDailyDocumentNumber('MWR', Number(receipt.id));
      const [updated] = await trx
        .updateTable('maritime_warehouse_receipts')
        .set({ receipt_number: finalNumber })
        .where('id', '=', receipt.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();

      return updated;
    });
  }

  async releaseWarehouseReceipt(auth: AuthContext, id: string | number, dto: ReleaseWarehouseReceiptDto) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db.transaction().execute(async (trx) => {
      const existing = await trx
        .selectFrom('maritime_warehouse_receipts')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .forUpdate()
        .executeTakeFirst();

      if (!existing) throw new NotFoundException('Warehouse Receipt not found');

      // الإفراج حدث يقع مرة واحدة ويحمل أثراً رقابياً (مَن أفرج ومتى). بلا هذا
      // الحارس، استدعاء ثانٍ يستبدل `released_at`/`released_by` فيمحو أثر
      // الإفراج الأصلي بصمت.
      if (existing.warehouse_status === 'released') {
        throw new BadRequestException('سبق الإفراج عن إيصال المستودع هذا؛ لا يمكن الإفراج عنه مرتين');
      }

      const [updated] = await trx
        .updateTable('maritime_warehouse_receipts')
        .set({
          warehouse_status: 'released',
          released_at: sql`NOW()`,
          released_by: auth.userId ? Number(auth.userId) : null,
          notes: dto.notes ? `${existing.notes ? existing.notes + ' | ' : ''}${dto.notes}` : existing.notes,
          updated_at: sql`NOW()`,
        })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', id as any)
        .returningAll()
        .execute();

      return updated;
    });
  }

  async getJobWarehouseReceipts(auth: AuthContext, jobId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_warehouse_receipts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('job_id', '=', jobId as any)
      .orderBy('id', 'desc')
      .execute();
  }

  async getWarehouseReceipts(auth: AuthContext, filters?: { status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_warehouse_receipts')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('warehouse_status', '=', filters.status as any);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([
        eb('receipt_number', 'ilike', term),
        eb('bay_rack_bin', 'ilike', term),
      ]));
    }

    return await query.orderBy('id', 'desc').execute();
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

  async updateJobCharges(auth: AuthContext, jobId: string | number, dto: UpdateJobChargesDto) {
    const { tenantId } = requireTenantScope(auth);
    const job = await this.getJobById(auth, String(jobId));
    if (job.status === 'completed') {
      throw new BadRequestException('أعد فتح الشحنة قبل تعديل مصروفاتها ورسومها');
    }
    return await this.db.transaction().execute(async (trx) => {
      const invoicedCharges = dto.charges.filter((charge) => charge.isInvoiced);
      if (invoicedCharges.length > 0) {
        const posted = await trx.selectFrom('journal_entries as je')
          .innerJoin('journal_entry_lines as jl', (join: any) => join.onRef('jl.journal_entry_id', '=', 'je.id').onRef('jl.tenant_id', '=', 'je.tenant_id'))
          .select(sql<number>`COALESCE(SUM(jl.credit), 0)`.as('amount'))
          .where('je.tenant_id', '=', tenantId).where('je.source_id', '=', Number(jobId))
          .where('je.source_type', '=', 'maritime_job').where('je.status', '=', 'posted')
          .executeTakeFirst();
        let markedTotal = 0;
        for (const charge of invoicedCharges) {
          if (Number(charge.sellAmount || 0) <= 0) {
            throw new BadRequestException('لا يمكن وسم بند تكلفة مفوتر دون مبلغ بيع للعميل');
          }
          markedTotal += Number(charge.sellAmount) *
            await this.resolveFreightExchangeRate(tenantId, charge.currency || 'USD');
        }
        if (markedTotal > Number(posted?.amount || 0) + 0.01) {
          throw new BadRequestException('البنود الموسومة مفوترة تتجاوز فواتير العميل المرحلة فعلياً');
        }
      }
      await trx
        .deleteFrom('maritime_job_charges')
        .where('tenant_id', '=', tenantId)
        .where('job_id', '=', String(jobId))
        .execute();

      for (const chg of dto.charges) {
        const cost = Number(chg.costAmount || 0);
        const sell = Number(chg.sellAmount || 0);
        const profit = Number(chg.profitAmount ?? (sell - cost));
        const taxPct = Number(chg.taxRatePercent || 0);
        const taxAmt = Number(chg.taxAmount ?? (sell * taxPct / 100));

        await trx
          .insertInto('maritime_job_charges')
          .values({
            tenant_id: tenantId,
            job_id: String(jobId),
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
            is_invoiced: Boolean(chg.isInvoiced),
          })
          .execute();
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

  // ==========================================
  // 4. Overseas Agent Settlements & Profit Sharing (SOA)
  // ==========================================

  async listAgentSettlements(auth: AuthContext, filters?: { agentId?: string; status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db
      .selectFrom('maritime_agent_settlements')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.agentId) {
      query = query.where('agent_id', '=', String(filters.agentId));
    }
    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }
    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) => eb.or([
        eb('agent_name', 'ilike', term),
        eb('job_number', 'ilike', term),
        eb('reference_number', 'ilike', term),
      ]));
    }

    return await query.orderBy('id', 'desc').execute();
  }

  async createAgentSettlement(auth: AuthContext, dto: CreateAgentSettlementDto) {
    const { tenantId } = requireTenantScope(auth);
    const amount = Number(dto.amount || 0);
    // INV-MARITIME-SETTLEMENT-RATE-RESOLVED: never assume parity. The
    // settlement currency defaults to USD (freight's domain
    // currency), so an omitted rate resolves through the same
    // registered-rate resolver every other maritime path uses: 1
    // only for the tenant base currency, a supplied positive rate,
    // or the registered rate — fail closed when none exists.
    const currency = dto.currency || 'USD';
    const rate = await this.resolveFreightExchangeRate(tenantId, currency, dto.exchangeRate);
    // INV-MARITIME-AGENT-SETTLEMENT-RECORD-INTEGRITY: the local
    // equivalent converts at the tenant's book digits through the
    // shared engine -- the raw float product stored 4856.0625 for a
    // KWD tenant, a fourth decimal the books cannot hold.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const localEq = convertFxAmount(amount, rate, digits);

    const settlementPrefix = dto.settlementType === 'debit_note' ? 'ADN' : dto.settlementType === 'credit_note' ? 'ACN' : 'APS';
    const suppliedRef = dto.referenceNumber?.trim() || null;

    // The generated reference number follows the module-wide
    // collision-proof pattern (insert with a temp value, rename by
    // the returned identity in the same transaction): the previous
    // random 4-digit sequence could repeat on the same day. A
    // caller-supplied number is kept verbatim.
    const settlement = await this.db.transaction().execute(async (trx: any) => {
      const [row] = await trx
        .insertInto('maritime_agent_settlements')
        .values({
          tenant_id: tenantId,
          agent_id: dto.agentId ? String(dto.agentId) : null,
          agent_name: dto.agentName,
          job_id: dto.jobId ? String(dto.jobId) : null,
          job_number: dto.jobNumber || null,
          settlement_type: dto.settlementType,
          currency: currency,
          amount: amount,
          profit_share_percent: dto.profitSharePercent !== undefined ? Number(dto.profitSharePercent) : 50,
          local_equivalent_amount: localEq,
          exchange_rate: rate,
          reference_number: suppliedRef || `AST-TMP-${crypto.randomUUID()}`,
          status: 'pending',
          notes: dto.notes || null,
        })
        .returningAll()
        .execute();

      if (suppliedRef) return row;
      const [renamed] = await trx
        .updateTable('maritime_agent_settlements')
        .set({ reference_number: formatDailyDocumentNumber(settlementPrefix, Number(row.id)) })
        .where('id', '=', row.id)
        .where('tenant_id', '=', tenantId)
        .returningAll()
        .execute();
      return renamed;
    });

    return settlement;
  }

  async updateAgentSettlementStatus(auth: AuthContext, id: string | number, dto: UpdateAgentSettlementStatusDto) {
    const { tenantId } = requireTenantScope(auth);
    const [updated] = await this.db
      .updateTable('maritime_agent_settlements')
      .set({
        status: dto.status,
        notes: dto.notes !== undefined ? dto.notes : undefined,
        updated_at: sql`NOW()`,
      })
      .where('tenant_id', '=', tenantId)
      .where('id', '=', String(id) as any)
      .returningAll()
      .execute();

    return updated;
  }

  async getAgentStatementOfAccount(auth: AuthContext, agentId: string | number) {
    const { tenantId } = requireTenantScope(auth);
    const settlements = await this.db
      .selectFrom('maritime_agent_settlements')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('agent_id', '=', String(agentId))
      .orderBy('id', 'asc')
      .execute();

    let totalDebit = 0;
    let totalCredit = 0;

    for (const item of settlements) {
      const amt = Number(item.amount || 0);
      if (item.settlement_type === 'debit_note' || item.settlement_type === 'profit_share') {
        totalDebit += amt;
      } else if (item.settlement_type === 'credit_note') {
        totalCredit += amt;
      }
    }

    const netBalance = totalDebit - totalCredit;

    return {
      agentId: String(agentId),
      settlements,
      summary: {
        totalDebitUsd: totalDebit,
        totalCreditUsd: totalCredit,
        netBalanceUsd: netBalance,
        position: netBalance >= 0 ? 'receivable' : 'payable',
      },
    };
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

      const finalTripNumber = formatDailyDocumentNumber('TRIP', Number(trip.id));

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

  // ==========================================
  // 6. Carrier Live Tracking Hub & API Events
  // ==========================================

  async syncCarrierTracking(auth: AuthContext, carrierCode: string, trackingNumber: string) {
    const { tenantId } = requireTenantScope(auth);

    const simulatedEvents = [
      { eventType: 'BOOK', eventLocation: 'Port Origin', hoursAgo: 72, label: 'Booking Confirmed with Carrier' },
      { eventType: 'GTI', eventLocation: 'Terminal Gate-in', hoursAgo: 48, label: 'Container Gate-in at POL' },
      { eventType: 'LOAD', eventLocation: 'Vessel Berth', hoursAgo: 24, label: 'Loaded on Vessel' },
      { eventType: 'DEPT', eventLocation: 'En Route Sea', hoursAgo: 12, label: 'Vessel Departed Origin Port' },
    ];

    for (const evt of simulatedEvents) {
      const eventTime = new Date(Date.now() - evt.hoursAgo * 3600 * 1000);
      await this.db
        .insertInto('maritime_carrier_api_events')
        .values({
          tenant_id: tenantId,
          carrier_code: carrierCode.toUpperCase(),
          tracking_number: trackingNumber,
          event_type: evt.eventType,
          event_location: evt.eventLocation,
          event_time: eventTime,
          raw_payload: JSON.stringify({ source: 'CARRIER_API_HUB', note: evt.label }),
        })
        .execute();
    }

    return {
      carrierCode: carrierCode.toUpperCase(),
      trackingNumber,
      status: 'synced',
      eventsCount: simulatedEvents.length,
      lastEvent: simulatedEvents[simulatedEvents.length - 1],
    };
  }

  async recordCarrierApiEvent(auth: AuthContext, dto: CarrierTrackingEventDto) {
    const { tenantId } = requireTenantScope(auth);
    const [event] = await this.db
      .insertInto('maritime_carrier_api_events')
      .values({
        tenant_id: tenantId,
        carrier_code: dto.carrierCode.toUpperCase(),
        tracking_number: dto.trackingNumber,
        event_type: dto.eventType,
        event_location: dto.eventLocation || null,
        event_time: dto.eventTime ? new Date(dto.eventTime) : sql`NOW()`,
        raw_payload: dto.rawPayload ? JSON.stringify(dto.rawPayload) : null,
      })
      .returningAll()
      .execute();

    return event;
  }

  async listCarrierApiEvents(auth: AuthContext, trackingNumber: string) {
    const { tenantId } = requireTenantScope(auth);
    return await this.db
      .selectFrom('maritime_carrier_api_events')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('tracking_number', '=', trackingNumber)
      .orderBy('event_time', 'desc')
      .execute();
  }
}
