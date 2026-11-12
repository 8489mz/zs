import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { VanFraudRadarService } from './van-fraud-radar.service';
import { FmcgVisitExecutionEngine, GeofenceEvaluationResult } from '../fmcg-visit-execution.engine';
import { extractAssignedRepIds } from '../rep-target.engine';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';

export interface CheckInVisitPayload {
  tripId?: number | null;
  customerId: number;
  customerName?: string;
  latitude?: number | null;
  longitude?: number | null;
}

export interface RecordNoSalePayload {
  noSaleReason: string;
  noSaleNotes?: string;
}

export interface RecordStoreInventoryPayload {
  items: Array<{
    productId: number;
    productName: string;
    qtyOnShelf: number;
    expiryDate?: string | null;
  }>;
}

export interface CheckOutVisitPayload {
  hasSale?: boolean;
  saleId?: number | null;
  saleAmount?: number;
  hasCollection?: boolean;
  collectionAmount?: number;
}

export interface TradeSurveyPayload {
  tripId?: number | null;
  customerId: number;
  visitId?: number | null;
  surveyType: 'cooler_inspection' | 'asset_tracking' | 'competitor_survey';
  assetId?: string | null;
  assetName?: string | null;
  assetCondition?: string | null;
  isPureCompanyProducts?: boolean;
  temperatureCelsius?: number | null;
  cleanlinessRating?: number;
  photoUrl?: string | null;
  competitorName?: string | null;
  competitorProduct?: string | null;
  competitorPrice?: number | null;
  competitorOfferDetails?: string | null;
  notes?: string | null;
  metadata?: Record<string, any>;
}

export interface BreadcrumbPayload {
  tripId: number;
  latitude: number;
  longitude: number;
  speedKmh?: number;
  batteryLevel?: number;
}

@Injectable()
export class VanFieldExecutionService {
  private readonly logger = new Logger(VanFieldExecutionService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly fraudRadar: VanFraudRadarService,
  ) {}

  /**
   * 1. Check-In: Initiates a structured store visit with GPS geofencing verification
   */
  async checkInVisit(
    tenantId: string,
    accountId: number,
    repId: number,
    payload: CheckInVisitPayload,
  ) {
    if (!payload.customerId) {
      throw new AppError('معرف العميل مطلوب لتسجيل الزيارة', 'CUSTOMER_ID_REQUIRED', 400);
    }

    // Fetch customer GPS and details
    const customer = await this.db
      .selectFrom('customers')
      .select(['id', 'name', 'metadata'])
      .where('id', '=', payload.customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!customer) {
      throw new AppError('العميل غير مسجل في النظام', 'CUSTOMER_NOT_FOUND', 404);
    }

    const meta = typeof customer.metadata === 'string'
      ? JSON.parse(customer.metadata || '{}')
      : (customer.metadata || {});

    // INV-REP-SCOPED-CUSTOMER-READS (H7/D5): a check-in is not a free
    // pass to a customer. The rep must be assigned to this customer, or
    // the trip he names must be his own — otherwise one check-in
    // manufactures the visit row that opens another rep's customer
    // reads (field statement, last sold prices). Served history alone
    // does NOT authorize a new check-in, for the same reason. A missing
    // trip fails closed (404); another rep's trip fails with a specific
    // 403 naming the trip. Same codes/messages as the recordFieldVisit
    // gate in VanRoutesService.
    let tripOwned = false;
    if (payload.tripId != null) {
      const trip = await this.db
        .selectFrom('van_sales_trips')
        .select(['id', 'rep_id'])
        .where('id', '=', payload.tripId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!trip) {
        throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
      }
      if (Number((trip as any).rep_id) !== Number(repId)) {
        throw new AppError('هذه الرحلة تخص مندوباً آخر، لا يمكنك تسجيل زيارة عليها', 'REP_TRIP_NOT_OWNED', 403);
      }
      tripOwned = true;
    }
    if (!tripOwned && !extractAssignedRepIds(meta).includes(Number(repId))) {
      throw new AppError(
        'العميل غير مسند إليك ولا توجد رحلة مملوكة لك تبرر تسجيل الزيارة',
        'REP_CUSTOMER_NOT_ASSIGNED',
        403,
      );
    }

    const customerLat = meta.latitude ?? meta.gps_lat ?? meta.lat ?? null;
    const customerLng = meta.longitude ?? meta.gps_lng ?? meta.lng ?? null;

    const geofenceResult: GeofenceEvaluationResult = FmcgVisitExecutionEngine.evaluateGeofence(
      customerLat,
      customerLng,
      payload.latitude,
      payload.longitude,
      300,
    );

    // If geofence is violated (more than 300m away), trigger fraud radar suspicion event
    if (!geofenceResult.isValid && !geofenceResult.isUnmappedCustomer) {
      await this.fraudRadar.recordSuspicionEvent({
        tenantId,
        accountId: String(accountId),
        repId,
        tripId: payload.tripId ?? null,
        customerId: payload.customerId,
        customerName: customer.name,
        eventCode: 'VAN_SUSPICION_GEOFENCE_VIOLATION',
        severity: 'high',
        titleAr: 'تسجيل زيارة وهمية خارج النطاق الجغرافي للمحل (Geofence Breach)',
        detailsAr: `قام المندوب بتسجيل وصول للعميل "${customer.name}" على بعد (${geofenceResult.distanceMeters} متر) متجاوزاً النطاق المسموح (300 متر).`,
        attemptedAmount: 0,
        metadata: {
          customerLat,
          customerLng,
          repLat: payload.latitude,
          repLng: payload.longitude,
          distanceMeters: geofenceResult.distanceMeters,
        },
      });
    }

    // Insert visit record
    const [visit] = await this.db
      .insertInto('van_store_visits')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        trip_id: payload.tripId ?? null,
        rep_id: repId,
        customer_id: payload.customerId,
        customer_name: customer.name,
        check_in_at: new Date().toISOString(),
        check_in_lat: payload.latitude != null ? payload.latitude : null,
        check_in_lng: payload.longitude != null ? payload.longitude : null,
        is_geofence_valid: geofenceResult.isValid,
        geofence_distance_meters: geofenceResult.distanceMeters,
        store_inventory: JSON.stringify([]),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .returningAll()
      .execute();

    return {
      ok: true,
      visitId: visit.id,
      customerName: customer.name,
      geofence: geofenceResult,
      checkInAt: visit.check_in_at,
    };
  }

  /**
   * 2. Store Shelf Inventory: Records optional shelf stock counts and expiries
   */
  async recordVisitInventory(
    tenantId: string,
    visitId: number,
    payload: RecordStoreInventoryPayload,
  ) {
    const visit = await this.db
      .selectFrom('van_store_visits')
      .select(['id'])
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!visit) {
      throw new AppError('سجل الزيارة غير موجود', 'VISIT_NOT_FOUND', 404);
    }

    await this.db
      .updateTable('van_store_visits')
      .set({
        store_inventory: JSON.stringify(payload.items || []),
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, visitId, itemsCount: (payload.items || []).length };
  }

  /**
   * 3. Reason for No-Sale: Records mandatory reason when visit yielded no transaction
   */
  async recordVisitNoSale(
    tenantId: string,
    visitId: number,
    payload: RecordNoSalePayload,
  ) {
    if (!payload.noSaleReason) {
      throw new AppError('سبب عدم البيع إلزامي', 'NO_SALE_REASON_REQUIRED', 400);
    }

    await this.db
      .updateTable('van_store_visits')
      .set({
        no_sale_reason: payload.noSaleReason,
        no_sale_notes: payload.noSaleNotes || null,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, visitId, reason: payload.noSaleReason };
  }

  /**
   * 4. Check-Out: Completes visit and computes dwell time
   */
  async checkOutVisit(
    tenantId: string,
    visitId: number,
    payload?: CheckOutVisitPayload,
  ) {
    const visit = await this.db
      .selectFrom('van_store_visits')
      .selectAll()
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!visit) {
      throw new AppError('سجل الزيارة غير موجود', 'VISIT_NOT_FOUND', 404);
    }

    const checkOutAt = new Date();
    const dwellSeconds = FmcgVisitExecutionEngine.calculateDwellTimeSeconds(
      visit.check_in_at,
      checkOutAt,
    );

    const hasSale = payload?.hasSale ?? (payload?.saleAmount != null && payload.saleAmount > 0);
    const hasCollection = payload?.hasCollection ?? (payload?.collectionAmount != null && payload.collectionAmount > 0);

    const [updated] = await this.db
      .updateTable('van_store_visits')
      .set({
        check_out_at: checkOutAt.toISOString(),
        dwell_time_seconds: dwellSeconds,
        has_sale: hasSale,
        sale_id: payload?.saleId ?? visit.sale_id,
        sale_amount: payload?.saleAmount != null ? payload.saleAmount : visit.sale_amount,
        has_collection: hasCollection,
        collection_amount: payload?.collectionAmount != null ? payload.collectionAmount : visit.collection_amount,
        updated_at: new Date().toISOString(),
      })
      .where('id', '=', visitId)
      .where('tenant_id', '=', tenantId)
      .returningAll()
      .execute();

    return {
      ok: true,
      visitId,
      dwellTimeSeconds: dwellSeconds,
      dwellTimeMinutes: Number((dwellSeconds / 60).toFixed(1)),
      hasSale,
      hasCollection,
    };
  }

  /**
   * 5. Trade Marketing Survey: Records cooler inspection or competitor survey
   */
  async recordTradeSurvey(
    tenantId: string,
    accountId: number,
    repId: number,
    payload: TradeSurveyPayload,
  ) {
    const [survey] = await this.db
      .insertInto('van_trade_marketing_surveys')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        visit_id: payload.visitId ?? null,
        trip_id: payload.tripId ?? null,
        rep_id: repId,
        customer_id: payload.customerId,
        survey_type: payload.surveyType,
        asset_id: payload.assetId || null,
        asset_name: payload.assetName || null,
        asset_condition: payload.assetCondition || null,
        is_pure_company_products: payload.isPureCompanyProducts !== false,
        temperature_celsius: payload.temperatureCelsius != null ? payload.temperatureCelsius : null,
        cleanliness_rating: payload.cleanlinessRating != null ? payload.cleanlinessRating : 5,
        photo_url: payload.photoUrl || null,
        competitor_name: payload.competitorName || null,
        competitor_product: payload.competitorProduct || null,
        competitor_price: payload.competitorPrice != null ? payload.competitorPrice : null,
        competitor_offer_details: payload.competitorOfferDetails || null,
        notes: payload.notes || null,
        metadata: JSON.stringify(payload.metadata || {}),
        created_at: new Date().toISOString(),
      })
      .returningAll()
      .execute();

    return { ok: true, surveyId: survey.id };
  }

  /**
   * 6. Live Breadcrumb Recording: Saves rep GPS points for breadcrumb trail
   */
  async recordLiveBreadcrumb(
    tenantId: string,
    accountId: number,
    repId: number,
    payload: BreadcrumbPayload,
  ) {
    if (!payload.tripId || payload.latitude == null || payload.longitude == null) {
      throw new AppError('بيانات التتبع ناقصة', 'INVALID_BREADCRUMB_DATA', 400);
    }

    const [breadcrumb] = await this.db
      .insertInto('van_rep_live_breadcrumbs')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        trip_id: payload.tripId,
        rep_id: repId,
        latitude: payload.latitude,
        longitude: payload.longitude,
        speed_kmh: payload.speedKmh || 0,
        battery_level: payload.batteryLevel || 100,
        recorded_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
      })
      .returningAll()
      .execute();

    return { ok: true, breadcrumbId: breadcrumb.id };
  }

  /**
   * 7. Get Live Trip Breadcrumbs for Supervisor Map
   */
  async getLiveTripBreadcrumbs(tenantId: string, tripId: number) {
    const points = await this.db
      .selectFrom('van_rep_live_breadcrumbs')
      .selectAll()
      .where('trip_id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .orderBy('recorded_at', 'asc')
      .execute();

    // Fetch trip sales with recorded GPS to attach operational details to waypoints
    const salesWaypoints = await (this.db as any)
      .selectFrom('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .select([
        's.id',
        's.doc_no',
        sql<number>`cast(s.delivery_gps_lat as double precision)`.as('latitude'),
        sql<number>`cast(s.delivery_gps_lng as double precision)`.as('longitude'),
        's.created_at as recorded_at',
        sql<string>`coalesce(c.name, s.customer_name, 'عميل نقدي عام')`.as('customer_name'),
        's.customer_phone',
        's.total as sale_amount',
        's.payment_type',
        's.note',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.van_trip_id', '=', tripId)
      .where('s.delivery_gps_lat', 'is not', null)
      .where('s.delivery_gps_lng', 'is not', null)
      .orderBy('s.created_at', 'asc')
      .execute();

    if (points.length > 0) {
      // Enrich high-density breadcrumbs with nearby sale operational events
      const enrichedBreadcrumbs = points.map((p) => {
        const matchingSale = salesWaypoints.find((s: any) => {
          const latDiff = Math.abs(Number(s.latitude) - Number(p.latitude));
          const lngDiff = Math.abs(Number(s.longitude) - Number(p.longitude));
          return latDiff < 0.003 && lngDiff < 0.003;
        });
        return {
          id: p.id,
          latitude: Number(p.latitude),
          longitude: Number(p.longitude),
          speedKmh: Number(p.speed_kmh || 0),
          batteryLevel: Number(p.battery_level || 100),
          recordedAt: p.recorded_at,
          customerName: matchingSale?.customer_name || null,
          customerPhone: matchingSale?.customer_phone || null,
          docNo: matchingSale?.doc_no || null,
          saleAmount: matchingSale ? Number(matchingSale.sale_amount || 0) : null,
          paymentType: matchingSale?.payment_type || null,
          notes: matchingSale?.note || null,
          eventType: matchingSale ? 'sale' : 'waypoint',
        };
      });

      return {
        ok: true,
        tripId,
        pointsCount: enrichedBreadcrumbs.length,
        breadcrumbs: enrichedBreadcrumbs,
      };
    }

    // Fallback: Waypoints from trip sales with recorded GPS
    return {
      ok: true,
      tripId,
      pointsCount: salesWaypoints.length,
      breadcrumbs: salesWaypoints.map((p: any) => ({
        id: -Number(p.id),
        latitude: Number(p.latitude),
        longitude: Number(p.longitude),
        speedKmh: 0,
        batteryLevel: 100,
        recordedAt: p.recorded_at,
        customerName: p.customer_name || 'عميل نقدي عام',
        customerPhone: p.customer_phone || null,
        docNo: p.doc_no || `SALE-${p.id}`,
        saleAmount: Number(p.sale_amount || 0),
        paymentType: p.payment_type || 'cash',
        notes: p.note || null,
        eventType: 'sale',
      })),
    };
  }

  /**
   * 8. Get Store Visits History & Strike-Rate KPIs for Supervisor
   */
  async getVisitsHistory(
    tenantId: string,
    filters?: {
      tripId?: number;
      repId?: number;
      customerId?: number;
      date?: string;
      noSaleOnly?: boolean;
    },
  ) {
    // 1. Fetch visits recorded via itinerary check-in
    let q = this.db
      .selectFrom('van_store_visits')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.tripId) q = q.where('trip_id', '=', filters.tripId);
    if (filters?.repId) q = q.where('rep_id', '=', filters.repId);
    if (filters?.customerId) q = q.where('customer_id', '=', filters.customerId);
    if (filters?.noSaleOnly) q = q.where('has_sale', '=', false);
    if (filters?.date) {
      q = q.where(sql`DATE(check_in_at)`, '=', filters.date);
    }

    const rows = await q.orderBy('check_in_at', 'desc').limit(200).execute();

    // 2. Fetch direct van field sales (cash / walk-in sales) not already linked in van_store_visits
    let directVisits: any[] = [];
    if (!filters?.noSaleOnly) {
      const linkedSaleIds = rows.map((r) => r.sale_id).filter(Boolean);
      let sq = (this.db as any)
        .selectFrom('sales as s')
        .leftJoin('customers as c', (join: any) => join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'))
        .select([
          's.id',
          's.van_trip_id as trip_id',
          's.delivery_rep_id as rep_id',
          's.customer_id',
          sql<string>`coalesce(c.name, s.customer_name, 'عميل نقدي عام')`.as('customer_name'),
          's.created_at as check_in_at',
          's.created_at as check_out_at',
          sql<number>`cast(s.delivery_gps_lat as double precision)`.as('check_in_lat'),
          sql<number>`cast(s.delivery_gps_lng as double precision)`.as('check_in_lng'),
          's.total as sale_amount',
          's.payment_type',
          's.doc_no',
        ])
        .where('s.tenant_id', '=', tenantId)
        .where('s.van_trip_id', 'is not', null);

      if (filters?.tripId) sq = sq.where('s.van_trip_id', '=', filters.tripId);
      if (filters?.repId) sq = sq.where('s.delivery_rep_id', '=', filters.repId);
      if (filters?.customerId) sq = sq.where('s.customer_id', '=', filters.customerId);
      if (filters?.date) {
        sq = sq.where(sql`DATE(s.created_at)`, '=', filters.date);
      }
      if (linkedSaleIds.length > 0) {
        sq = sq.where('s.id', 'not in', linkedSaleIds);
      }

      const directSales = await sq.orderBy('s.created_at', 'desc').limit(100).execute();

      directVisits = directSales.map((s: any) => ({
        id: -Number(s.id),
        trip_id: s.trip_id ? Number(s.trip_id) : null,
        rep_id: s.rep_id ? Number(s.rep_id) : 0,
        customer_id: s.customer_id ? Number(s.customer_id) : null,
        customer_name: s.customer_name || 'عميل نقدي عام',
        check_in_at: s.check_in_at,
        check_out_at: s.check_out_at,
        dwell_time_seconds: 60,
        check_in_lat: s.check_in_lat != null ? Number(s.check_in_lat) : null,
        check_in_lng: s.check_in_lng != null ? Number(s.check_in_lng) : null,
        is_geofence_valid: true,
        geofence_distance_meters: 0,
        has_sale: true,
        sale_id: Number(s.id),
        sale_amount: Number(s.sale_amount || 0),
        has_collection: s.payment_type === 'cash',
        collection_amount: s.payment_type === 'cash' ? Number(s.sale_amount || 0) : 0,
        no_sale_reason: null,
        no_sale_notes: s.doc_no ? `فاتورة بيع مباشر #${s.doc_no}` : 'فاتورة بيع ميداني',
        store_inventory: '[]',
      }));
    }

    const allVisits = [...rows, ...directVisits].sort((a: any, b: any) => {
      const ta = new Date(a.check_in_at).getTime();
      const tb = new Date(b.check_in_at).getTime();
      return tb - ta;
    });

    // Pass the tenant's book digits into the pure engine: without this
    // the engine would default to 2 and cut a 3-decimal tenant's fils
    // off the visit sales/collections totals.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const metrics = FmcgVisitExecutionEngine.calculateStrikeRateMetrics(allVisits, moneyDigits);

    return {
      ok: true,
      metrics,
      visits: allVisits.map((r: any) => ({
        id: r.id,
        tripId: r.trip_id,
        repId: r.rep_id,
        customerId: r.customer_id,
        customerName: r.customer_name,
        checkInAt: r.check_in_at,
        checkOutAt: r.check_out_at,
        dwellTimeSeconds: r.dwell_time_seconds,
        isGeofenceValid: r.is_geofence_valid,
        geofenceDistanceMeters: Number(r.geofence_distance_meters || 0),
        hasSale: r.has_sale,
        saleId: r.sale_id,
        saleAmount: Number(r.sale_amount || 0),
        hasCollection: r.has_collection,
        collectionAmount: Number(r.collection_amount || 0),
        noSaleReason: r.no_sale_reason,
        noSaleNotes: r.no_sale_notes,
        storeInventory: typeof r.store_inventory === 'string' ? JSON.parse(r.store_inventory) : (r.store_inventory || []),
      })),
    };
  }

  /**
   * 9. Get Trade Marketing Surveys for Supervisor
   */
  async getTradeSurveys(
    tenantId: string,
    filters?: {
      tripId?: number;
      customerId?: number;
      surveyType?: string;
    },
  ) {
    let q = this.db
      .selectFrom('van_trade_marketing_surveys')
      .selectAll()
      .where('tenant_id', '=', tenantId);

    if (filters?.tripId) q = q.where('trip_id', '=', filters.tripId);
    if (filters?.customerId) q = q.where('customer_id', '=', filters.customerId);
    if (filters?.surveyType) q = q.where('survey_type', '=', filters.surveyType);

    const rows = await q.orderBy('created_at', 'desc').limit(150).execute();

    return {
      ok: true,
      surveys: rows.map((s) => ({
        id: s.id,
        tripId: s.trip_id,
        repId: s.rep_id,
        customerId: s.customer_id,
        surveyType: s.survey_type,
        assetId: s.asset_id,
        assetName: s.asset_name,
        assetCondition: s.asset_condition,
        isPureCompanyProducts: s.is_pure_company_products,
        temperatureCelsius: s.temperature_celsius != null ? Number(s.temperature_celsius) : null,
        cleanlinessRating: s.cleanliness_rating,
        photoUrl: s.photo_url,
        competitorName: s.competitor_name,
        competitorProduct: s.competitor_product,
        competitorPrice: s.competitor_price != null ? Number(s.competitor_price) : null,
        competitorOfferDetails: s.competitor_offer_details,
        notes: s.notes,
        createdAt: s.created_at,
      })),
    };
  }
}
