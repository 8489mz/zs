import { resolveBusinessDateKey } from '../accounting/engines/accounting-date.engine';
import { NotFoundException, Injectable } from '@nestjs/common';
import { sql, type Kysely } from '../../database/kysely';
import { type Database } from '../../database/database.types';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { CreateRateCardDto, UpdateRateCardStatusDto } from './dto/rate-card.dto';
import { formatLocalCalendarDay } from '../../common/utils/tenant-timezone.util';

/**
 * MaritimeFreightRateCardsService — slice S4 of the maritime-freight split.
 * Pure move of 7 methods from MaritimeFreightService (Rate Management:
 * contract/tariff rate cards — CargoWise benchmark). No behavior
 * change: the bodies are byte-identical; the facade keeps thin
 * delegates with the same names and signatures. Deps are db only
 * (grep-verified: no mail/WhatsApp/posting/logger in the moved text);
 * no cross-slice deps. mapRateCardRow was PRIVATE in the facade and
 * is PUBLIC in the slice only (TS2341 precedent — S19 calls it
 * cross-slice; the facade keeps a thin PRIVATE delegate for it, file
 * #8 S1 precedent). The slice declares NO Logger (S4 is not one of
 * the 6 logger slices). listRateCards is PINNED (business-date-sales-
 * ops drives it) and carries the clock-b5 §B pin content
 * (formatLocalCalendarDay(value), L4520) into the slice — merge-owned
 * repoint. Clock travels verbatim: 4 bare new Date() + 4
 * resolveBusinessDateKey( (listRateCards, findBestRate, createRateCard,
 * createRateCardFromBid) — pure moves, no UTC-slice normalizer, no
 * instant comparison. No this.db.transaction() in S4 — no PGlite hang
 * shape here. The Rate Management banner + 4-line explainer travel
 * byte-identical into the slice (file #8 S9 precedent); the Customs
 * banner stays in the facade (it precedes mapCustomsDeclarationRow,
 * S5). No spec repoint travels in this patch — merge-owned.
 */

export interface MaritimeFreightRateCardsDeps {
  db: Kysely<Database>;
}

@Injectable()
export class MaritimeFreightRateCardsService {
  private readonly db: Kysely<Database>;

  constructor(deps: MaritimeFreightRateCardsDeps) {
    this.db = deps.db;
  }

  // --------------------------------------------------------------------------
  // Rate Management (Contract/Tariff Rate Cards — CargoWise Benchmark)
  // --------------------------------------------------------------------------
  // Closes the "Rate Management" gap: previously the only pricing mechanism was
  // a live RFQ (ask now, wait for carrier replies). Rate cards let ops instantly
  // quote a customer from a persisted, reusable negotiated rate instead of
  // waiting on a fresh round of carrier bids every time.

  mapRateCardRow(r: any) {
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

  async listRateCards(
    auth: AuthContext,
    filters?: { polCode?: string; podCode?: string; containerType?: string; status?: string; transportMode?: string },
  ) {
    const { tenantId } = requireTenantScope(auth);
    let query = this.db.selectFrom('maritime_rate_cards').selectAll().where('tenant_id', '=', tenantId);

    if (filters?.polCode) query = query.where('pol_code', '=', filters.polCode.toUpperCase());
    if (filters?.podCode) query = query.where('pod_code', '=', filters.podCode.toUpperCase());
    if (filters?.containerType) query = query.where('container_type', '=', filters.containerType);
    if (filters?.transportMode) query = query.where('transport_mode', '=', filters.transportMode as any);
    if (filters?.status) query = query.where('status', '=', filters.status as any);

    const rows = await query.orderBy('total_freight_cost', 'asc').execute();

    // Surface expired-but-still-flagged-active cards as expired without requiring a cron job.
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
    // valid_until is a stored DATE (a Date object from pg): comparing it
    // raw against a string is always false, so the expired flag below
    // could never fire. Normalize to the stored calendar day first.
    const validUntilDayKey = (value: unknown): string =>
      // Same stored-DATE rule as deadlineDayKey: the UTC slice renders
      // the previous day on any host east of UTC.
      value instanceof Date ? formatLocalCalendarDay(value) : String(value || '').slice(0, 10);
    return rows.map((r) =>
      this.mapRateCardRow({
        ...r,
        status: r.status === 'active' && validUntilDayKey(r.valid_until) < today ? 'expired' : r.status,
      }),
    );
  }

  /**
   * Instant quote lookup: the cheapest still-valid rate card matching the lane
   * and container. This is the "80% of forwarders don't need a live RFQ for
   * every shipment" path — a real contract rate beats waiting on carrier replies.
   */
  async findBestRate(auth: AuthContext, polCode: string, podCode: string, containerType?: string) {
    const { tenantId } = requireTenantScope(auth);
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());

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
        valid_from: dto.validFrom || (await resolveBusinessDateKey(this.db, tenantId, new Date())),
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
        'b.id',
        'b.shipping_line_id',
        'b.shipping_line_name',
        'b.ocean_freight',
        'b.currency',
        'b.thc_origin',
        'b.thc_destination',
        'b.baf_charges',
        'b.other_charges',
        'b.total_freight_cost',
        'b.transit_time_days',
        'b.free_days',
        'r.pol_code',
        'r.pol_name',
        'r.pod_code',
        'r.pod_name',
        'r.cargo_mode',
        'r.container_type',
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
        valid_from: await resolveBusinessDateKey(this.db, tenantId, new Date()),
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
}
