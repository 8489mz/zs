import { NotFoundException, BadRequestException, Injectable } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { DCSA_STANDARD_MILESTONES } from './maritime-freight.types';

/**
 * MaritimeFreightPublicPortalService — slice S9 of the maritime-freight split.
 * Pure move of 4 methods from MaritimeFreightService (Public Tracking
 * for Clients + Public Carrier Quote Portal). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the
 * same names and signatures for the 3 PUBLIC methods.
 * assertValidPublicQuoteToken is PRIVATE with only in-slice callers
 * (getPublicRfqForQuote + submitPublicCarrierBid, ground-proven: 3
 * occurrences in the file, 0 outside) — it stays private in the slice
 * and gets NO facade delegate (S6 precedent). Deps are db ONLY (no
 * kernel, no mail/WhatsApp/posting); the slice declares NO Logger (S9
 * is not one of the 6 logger slices). No cross-slice deps. Clock and
 * guard: ALL 0 in the moved text — no tx, no date sites, no money
 * helpers (the cleanest slice so far). The tenant-scoped-reads pin #9
 * (MT-05 + MT-10) lives entirely in this slice — no spec repoint
 * travels in this patch, merge-owned. All 4 methods are UNPINNED
 * (none in the prep §7 pinned 28; getPublicTrackingByToken is in the
 * riskiest-unpinned list) — pure moves, not blockers. Both section
 * banners travel byte-identical into the slice (file #8 S9 precedent);
 * banner 10 stays in the facade (it precedes the kernel
 * resolveAccountId, S14 takes the section).
 */

export interface MaritimeFreightPublicPortalDeps {
  db: Kysely<Database>;
}

@Injectable()
export class MaritimeFreightPublicPortalService {
  private readonly db: Kysely<Database>;

  constructor(deps: MaritimeFreightPublicPortalDeps) {
    this.db = deps.db;
  }

  // --------------------------------------------------------------------------
  // 8. Public Tracking for Clients (estimated/scheduled milestones, no live carrier feed)
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
      try {
        acc[r.key] = JSON.parse(r.value);
      } catch {
        acc[r.key] = r.value;
      }
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
      try {
        acc[r.key] = JSON.parse(r.value);
      } catch {
        acc[r.key] = r.value;
      }
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
      carrier: carrier
        ? {
            id: carrier.id,
            code: carrier.code,
            name_ar: carrier.name_ar,
            name_en: carrier.name_en,
            carrier_type: carrier.carrier_type,
          }
        : null,
      company: {
        name: companySettings.companyName || companySettings.storeName || 'منصة Z-Systems اللوجستية',
        email: companySettings.email || '',
        phone: companySettings.phone || '',
      },
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
}
