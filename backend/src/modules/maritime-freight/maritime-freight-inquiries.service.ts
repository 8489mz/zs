import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { CreateMaritimeInquiryDto } from './dto/create-inquiry.dto';
import { CreateMaritimeRfqDto } from './dto/create-rfq.dto';
import { MaritimePipelineConfig } from './maritime-freight.types';
import { calculateAirChargeableWeight } from './engines/air-freight.engine';
import * as crypto from 'crypto';
import { formatDailyDocumentNumber } from '../../common/utils/document-number.util';
import { getTenantTimezone } from '../../common/utils/tenant-timezone.util';

/**
 * MaritimeFreightInquiriesService — slice S11 of the maritime-freight split.
 * Pure move of 7 methods from MaritimeFreightService (client inquiries
 * + RFQ creation: the request intake that feeds the RFQ/bid pipeline).
 * No behavior change: the bodies are byte-identical; the facade keeps
 * thin delegates with the same names and signatures for all 7 methods.
 * Deps are db + the BOUND getTenantPipelineConfig (S10 — the pipeline
 * slice owns it; createRfq calls it once, BEFORE its tx opens, so the
 * tx has no db-reading callee and no PGlite hang shape). No mail/
 * WhatsApp/posting, no Logger (S11 is not one of the 6 logger slices).
 * No visibility change — all 7 methods are public. The two section
 * banners travel byte-identical into the slice (file #8 S9 precedent):
 * "2.5 Maritime Client Inquiries Engine" before createInquiry and
 * "3. Maritime RFQs Engine" before createRfq (S2's correction: the
 * prep §2 "(S2)" label is a section-domain label, not a travel
 * instruction — the banner directly precedes createRfq, and S2 left
 * it in the facade). Date handling travels verbatim: new Date() x2
 * (createInquiry + createRfq), new Date( any x4, one toISOString()
 * timestamp value (cutOffDate, not a date slice), Date.now() x1,
 * getTenantTimezone x2 — pure moves, no UTC-slice normalizer, no
 * instant comparison. Guard: toFixed/inlineRound/roundMoney/
 * currencyMoneyDigits all x0; this.db.transaction() x2 (createInquiry
 * + createRfq — both SAFE tx: no db-reading callee inside). All 7
 * methods are UNPINNED (prep §7) — no spec repoint travels in this
 * patch, merge-owned. createRfq (105L) is the riskiest unpinned
 * method in the slice.
 */

export interface MaritimeFreightInquiriesDeps {
  db: Kysely<Database>;
  // Bound S10 method (same name as the facade member, so the moved
  // body is byte-identical). getTenantPipelineConfig stays in the S10
  // pipeline slice forever; the facade binds the S10 slice instance.
  getTenantPipelineConfig: (tenantId: string) => Promise<MaritimePipelineConfig>;
}

@Injectable()
export class MaritimeFreightInquiriesService {
  private readonly db: Kysely<Database>;
  private readonly getTenantPipelineConfig: (tenantId: string) => Promise<MaritimePipelineConfig>;

  constructor(deps: MaritimeFreightInquiriesDeps) {
    this.db = deps.db;
    this.getTenantPipelineConfig = deps.getTenantPipelineConfig;
  }

  // --------------------------------------------------------------------------
  // 2.5 Maritime Client Inquiries Engine (Customer Freight Requests)
  // --------------------------------------------------------------------------
  async createInquiry(auth: AuthContext, dto: CreateMaritimeInquiryDto) {
    const { tenantId } = requireTenantScope(auth);

    const transportMode = dto.transportMode || 'sea';
    const grossWeightKg = Number(dto.grossWeightKg || 0);
    const totalCbm = Number(dto.totalCbm || dto.cbm || 0);
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

      const finalNumber = formatDailyDocumentNumber(
        'INQ',
        Number(inquiry.id),
        new Date(),
        4,
        await getTenantTimezone(trx, tenantId),
      );
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
    let query = this.db.selectFrom('maritime_inquiries').selectAll().where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('inquiry_number', 'ilike', term),
          eb('customer_name', 'ilike', term),
          eb('customer_phone', 'ilike', term),
          eb('pol_name', 'ilike', term),
          eb('pod_name', 'ilike', term),
          eb('commodity_description', 'ilike', term),
        ]),
      );
    }

    return await query.orderBy('id', 'desc').execute();
  }

  async getInquiryById(auth: AuthContext, id: string) {
    const { tenantId } = requireTenantScope(auth);
    const inquiry = await this.db
      .selectFrom('maritime_inquiries')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
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
      direction: inquiry.direction,
      transportMode: inquiry.transport_mode || 'sea',
      airCargoType: inquiry.air_cargo_type || undefined,
      grossWeightKg: inquiry.gross_weight_kg ? Number(inquiry.gross_weight_kg) : undefined,
      volumetricWeightKg: inquiry.volumetric_weight_kg ? Number(inquiry.volumetric_weight_kg) : undefined,
      chargeableWeightKg: inquiry.chargeable_weight_kg ? Number(inquiry.chargeable_weight_kg) : undefined,
      totalCbm: inquiry.total_cbm ? Number(inquiry.total_cbm) : inquiry.cbm ? Number(inquiry.cbm) : undefined,
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
      paymentTerm: inquiry.payment_term,
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
      .where('id', '=', inquiryId)
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
      const hours =
        dto.cutOffHours && dto.cutOffHours > 0
          ? dto.cutOffHours
          : urgency === 'urgent'
            ? pipelineConfig.rfqCutOffHoursUrgent || 6
            : pipelineConfig.rfqCutOffHoursStandard || 24;
      cutOffDate = new Date(Date.now() + hours * 3600 * 1000);
    }

    const transportMode = dto.transportMode || 'sea';
    const grossWeightKg = Number(dto.grossWeightKg || 0);
    const totalCbm = Number(dto.totalCbm || 0);
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

      const finalNumber = formatDailyDocumentNumber(
        'RFQ',
        Number(rfq.id),
        new Date(),
        4,
        await getTenantTimezone(trx, tenantId),
      );
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
          .where('id', '=', dto.inquiryId)
          .execute();
      }

      return updatedRfq;
    });
  }

  async getRfqs(auth: AuthContext, filters?: { status?: string; search?: string }) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db.selectFrom('maritime_rfqs').selectAll().where('tenant_id', '=', tenantId);

    if (filters?.status && filters.status !== 'all') {
      query = query.where('status', '=', filters.status as any);
    }

    if (filters?.search) {
      const term = `%${filters.search}%`;
      query = query.where((eb) =>
        eb.or([
          eb('rfq_number', 'ilike', term),
          eb('pol_name', 'ilike', term),
          eb('pod_name', 'ilike', term),
          eb('commodity_description', 'ilike', term),
        ]),
      );
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
      const minBid =
        relatedBids.length > 0 && comparable
          ? relatedBids.reduce((prev, curr) =>
              Number(curr.total_freight_cost) < Number(prev.total_freight_cost) ? curr : prev,
            )
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
      .where('id', '=', id)
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
}
