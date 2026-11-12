import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { VanFleetService } from './van-fleet.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { normalizeCustomerCode, getCustomerRepBalancesMap } from './van-common.util';
import {
  extractCoordinatesFromCustomerLocation,
  evaluateGeofenceCompliance,
  extractAssignedRepIds,
  hasGpsCoordinates,
  loadRepPermissions,
  resolveIsolatedRepCustomerBalance,
} from '../rep-target.engine';
import { VanFraudRadarService } from './van-fraud-radar.service';
import {
  optimizeRouteTsp,
  RouteStopInput,
  RouteOptimizationResult,
} from '../route-optimization.engine';
import {
  getCurrentBusinessDay,
  extractCustomerVisitDays,
  isCustomerScheduledForDay,
  normalizeDayKey,
  DAY_KEY_TO_ARABIC,
} from '../van-routes-schedule.util';

@Injectable()
export class VanRoutesService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly vanFleetService: VanFleetService,
    private readonly fraudRadar?: VanFraudRadarService,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * INV-REP-SCOPED-CUSTOMER-READS (H7/D1+D14): the customer ids this rep
   * has served — a field visit on one of his trips, a pre-sale order
   * assigned to him, or a delivered sale carrying his delivery_rep_id.
   * Same served definition as VanSalesService.assertRepServedCustomer
   * (that service owns the read gate; this service cannot import it
   * without a cycle, so the three evidence queries are mirrored here
   * verbatim and must stay in step with it).
   */
  private async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    const ids = new Set<number>();
    const collect = (rows: any[]): void => {
      for (const row of rows || []) {
        const id = Number((row as any).customer_id ?? (row as any).customerId);
        if (Number.isInteger(id) && id > 0) ids.add(id);
      }
    };
    const [visits, orders, sales] = await Promise.all([
      this.anyDb
        .selectFrom('van_field_visits')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .execute(),
      this.anyDb
        .selectFrom('sales_orders')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('rep_id', '=', repId)
        .execute(),
      this.anyDb
        .selectFrom('sales')
        .select('customer_id')
        .where('tenant_id', '=', tenantId)
        .where('delivery_rep_id', '=', repId)
        .execute(),
    ]);
    collect(visits);
    collect(orders);
    collect(sales);
    return ids;
  }

  /**
   * INV-REP-SCOPED-CUSTOMER-READS (H7/D5): a rep may record a visit /
   * check-in only for a customer assigned to him, or on a trip he owns.
   * Served history alone does NOT authorize a new visit — a visit row
   * is itself the evidence that opens the customer reads, so letting
   * one visit bootstrap the next would rebuild the self-built scope
   * gate this fix closes. A missing trip fails closed (404); a trip
   * belonging to another rep fails with a specific 403 naming the trip.
   */
  private async assertRepVisitScope(
    tenantId: string,
    repId: number,
    customerId: number,
    tripId?: number | null,
  ): Promise<void> {
    const customer = await this.anyDb
      .selectFrom('customers')
      .select(['id', 'metadata'])
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    if (!customer) {
      throw new AppError('العميل غير مسجل في النظام', 'CUSTOMER_NOT_FOUND', 404);
    }
    if (tripId != null) {
      const trip = await this.anyDb
        .selectFrom('van_sales_trips')
        .select(['id', 'rep_id'])
        .where('id', '=', tripId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!trip) {
        throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
      }
      if (Number((trip as any).rep_id) !== Number(repId)) {
        throw new AppError('هذه الرحلة تخص مندوباً آخر، لا يمكنك تسجيل زيارة عليها', 'REP_TRIP_NOT_OWNED', 403);
      }
      return;
    }
    if (extractAssignedRepIds((customer as any).metadata).includes(Number(repId))) return;
    throw new AppError(
      'العميل غير مسند إليك ولا توجد رحلة مملوكة لك تبرر تسجيل الزيارة',
      'REP_CUSTOMER_NOT_ASSIGNED',
      403,
    );
  }

  async getDriverTodayItinerary(tenantId: string, repId: number, tripId?: number) {
    void tripId;
    const customers = await this.anyDb
      .selectFrom('customers')
      .select([
        'id',
        'name',
        'phone',
        'address',
        sql<number>`cast(coalesce(balance, 0) as numeric)`.as('balance'),
        sql<number>`cast(coalesce(credit_limit, 0) as numeric)`.as('creditLimit'),
        'metadata',
      ])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .orderBy('id', 'asc')
      .execute();

    const customerIds: number[] = [];
    const customerTotalBalances: Record<number, number> = {};
    for (const c of customers) {
      const cid = Number(c.id);
      customerIds.push(cid);
      customerTotalBalances[cid] = Number(c.balance || 0);
    }
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
      customerIds,
      customerTotalBalances,
      moneyDigits,
    });

    // 1. Calculate today's Arabic & English day names based on business timezone (Africa/Cairo)
    const { dayKey: todayDayKey, dayArabicName: currentDayName } = getCurrentBusinessDay();
    const currentEnglishDayName = todayDayKey;

    // 2. Filter customers based on rep assignment (supporting multi-rep shared customers & ledger ownership)
    const parseCustMeta = (raw: any): any => {
      if (typeof raw === 'string') {
        try { return JSON.parse(raw); } catch { return {}; }
      }
      return raw && typeof raw === 'object' ? raw : {};
    };

    const numRepId = Number(repId);
    // INV-REP-SCOPED-CUSTOMER-READS (H7/D14): the open-region fallback is
    // CLOSED, not documented as open. A rep sees only assigned customers,
    // customers he served (same served definition as
    // assertRepServedCustomer), and customers with ledger activity under
    // his own rep id (a field collection writes a customer_ledger row but
    // no visit row, so without this leg a collected-from customer would
    // vanish from the itinerary). The ledger leg is rep-scoped
    // (byRepId[this rep]) — it is not a leak. A rep with no assignments
    // sees only the customers he served or transacted with, never the
    // unassigned pool. The old fallback handed every rep the full
    // unassigned book with balances, credit limits and GPS links
    // whenever he had no explicit assignment.
    const servedCustomerIds = await this.listRepServedCustomerIds(tenantId, numRepId);
    const repCustomers = customers.filter((c: any) => {
      const cid = Number(c.id);
      const assignedIds = extractAssignedRepIds(c.metadata);
      const hasRepLedgerActivity = Boolean(repBalancesMap.get(cid)?.byRepId[numRepId]);
      return assignedIds.includes(numRepId) || servedCustomerIds.has(cid) || hasRepLedgerActivity;
    });

    const todayVisits = await this.anyDb
      .selectFrom('van_field_visits as vfv')
      .leftJoin('sales as s', 's.id', 'vfv.sale_id')
      .select([
        'vfv.id',
        'vfv.customer_id as customerId',
        'vfv.visit_type as visitType',
        'vfv.sale_id as saleId',
        sql<string>`coalesce(s.doc_no, '')`.as('saleDocNo'),
        sql<number>`cast(coalesce(s.total, 0) as numeric)`.as('saleTotal'),
        'vfv.negative_reason as negativeReason',
        'vfv.postponed_to_date as postponedToDate',
        'vfv.visited_at as visitedAt',
        'vfv.notes',
      ])
      .where('vfv.tenant_id', '=', tenantId)
      .where('vfv.rep_id', '=', repId)
      .where(sql`vfv.visited_at >= CURRENT_DATE`)
      .execute();

    const visitMap = new Map<number, any>();
    for (const v of todayVisits) {
      visitMap.set(Number(v.customerId), v);
    }

    const recentNegativeCounts = await this.anyDb
      .selectFrom('van_field_visits')
      .select([
        'customer_id as customerId',
        sql<number>`count(*) filter (where visit_type = 'negative')`.as('negativeCount'),
      ])
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .groupBy('customer_id')
      .execute();

    const negativeMap = new Map<number, number>();
    for (const r of recentNegativeCounts) {
      negativeMap.set(Number(r.customerId), Number(r.negativeCount || 0));
    }

    return repCustomers.map((c: any) => {
      const cId = Number(c.id);
      const meta = parseCustMeta(c.metadata);
      const assignedRepIds = extractAssignedRepIds(meta);
      const isolated = resolveIsolatedRepCustomerBalance({
        repId: numRepId,
        breakdown: repBalancesMap.get(cId),
        assignedRepIds,
        fallbackTotalBalance: Number(c.balance || 0),
        moneyDigits,
      });
      const todayVisit = visitMap.get(cId);
      const totalNegatives = negativeMap.get(cId) || 0;

      let status: 'pending' | 'positive' | 'negative' = 'pending';
      if (todayVisit) {
        status = todayVisit.visitType;
      }

      const { visitDays, visitDay } = extractCustomerVisitDays(meta);

      // Support rep-specific daily schedules (e.g. Rep A visits on Sunday, Rep B visits on Thursday)
      let effectiveVisitDays = visitDays;
      let effectiveVisitDay = visitDay;
      if (Array.isArray(meta.rep_schedules) && meta.rep_schedules.length > 0) {
        const specificSchedule = meta.rep_schedules.find(
          (s: any) => Number(s?.repId ?? s?.rep_id) === numRepId,
        );
        if (specificSchedule && Array.isArray(specificSchedule.days) && specificSchedule.days.length > 0) {
          const extractedSpecific = extractCustomerVisitDays({ visit_days: specificSchedule.days });
          effectiveVisitDays = extractedSpecific.visitDays;
          effectiveVisitDay = extractedSpecific.visitDay;
        }
      }

      const isScheduledToday = isCustomerScheduledForDay(effectiveVisitDays, todayDayKey);
      const assignedRepId = assignedRepIds.includes(numRepId)
        ? numRepId
        : (meta.assigned_rep_id ? Number(meta.assigned_rep_id) : null);

      const coords = extractCoordinatesFromCustomerLocation({
        locationUrl: meta.location_url,
        metadata: meta,
      });

      return {
        customerId: cId,
        customerName: c.name,
        customerPhone: c.phone || '',
        customerAddress: c.address || '',
        customerCode: normalizeCustomerCode(meta.customer_code || meta.code, cId),
        route: meta.route || 'الخط العام',
        district: meta.district || meta.area || meta.neighborhood || '',
        routeSequence: Number(meta.route_sequence || 0),
        visitDay: effectiveVisitDay || meta.visit_day || '',
        visitDays: effectiveVisitDays,
        repSchedules: meta.rep_schedules || [],
        isScheduledToday,
        currentDayName,
        assignedRepId,
        assignedRepIds,
        assignedRepName: meta.assigned_rep_name || '',
        locationUrl: meta.location_url || (coords ? `https://maps.google.com/?q=${coords.lat},${coords.lng}` : ''),
        gpsLat: coords?.lat ?? null,
        gpsLng: coords?.lng ?? null,
        balance: isolated.repBalance,
        totalCompanyBalance: isolated.totalCustomerBalance,
        creditLimit: Number(c.creditLimit || 0),
        visitStatus: status,
        todayVisit: todayVisit || null,
        repeatedNegativesCount: totalNegatives,
        hasRepeatedNegativeAlert: totalNegatives >= 3,
      };
    }).sort((a: any, b: any) => {
      const seqA = a.routeSequence > 0 ? a.routeSequence : 999999;
      const seqB = b.routeSequence > 0 ? b.routeSequence : 999999;
      return seqA - seqB;
    });
  }

  async recordFieldVisit(
    arg1: string | number,
    arg2: string,
    arg3: string | number,
    payload: {
      tripId: number;
      customerId: number;
      visitType: 'positive' | 'negative';
      saleId?: number | null;
      negativeReason?: 'no_cash' | 'shop_closed' | 'sufficient_stock' | 'item_unavailable' | 'postponed' | 'other';
      postponedToDate?: string | null;
      gpsLat?: number | null;
      gpsLng?: number | null;
      notes?: string;
    },
  ) {
    let tenantId: string;
    let accountId: string;
    let repId: number;
    if (typeof arg1 === 'number') {
      repId = arg1;
      tenantId = arg2;
      accountId = String(arg3);
    } else {
      tenantId = arg1;
      accountId = arg2;
      repId = Number(arg3);
    }

    if (!payload.customerId || !payload.tripId) {
      throw new AppError('يرجى تحديد الرحلة والعميل', 'INVALID_PARAMS', 400);
    }
    if (payload.visitType === 'negative' && !payload.negativeReason) {
      throw new AppError('يرجى تحديد سبب الزيارة السلبية', 'MISSING_NEGATIVE_REASON', 400);
    }

    // H9 (D4): when the acting rep's require_gps_on_visit flag is on,
    // a field visit without usable GPS coordinates is refused — a
    // visit with no location is exactly the unverifiable visit the
    // flag exists to prevent. The gate runs before the scope checks,
    // so a GPS-less attempt is refused without learning anything
    // about the trip or customer. Reps whose stored flags do not set
    // the flag (legacy rows) keep the pre-flag behaviour; see
    // parseRepPermissions.
    if (!hasGpsCoordinates(payload.gpsLat, payload.gpsLng)) {
      const repFlags = await loadRepPermissions(this.anyDb, tenantId, repId);
      if (repFlags.require_gps_on_visit) {
        throw new AppError(
          'إحداثيات GPS مطلوبة لتسجيل الزيارة الميدانية (require_gps_on_visit مفعّل لهذا المندوب) ولم يتم إرسالها',
          'REP_VISIT_GPS_REQUIRED',
          403,
        );
      }
    }

    // INV-REP-SCOPED-CUSTOMER-READS (H7/D5): no visit on another rep's
    // trip and no visit to a customer the rep is not assigned to
    // without an owned trip — otherwise any rep could manufacture the
    // very visit row that opens another rep's customer reads.
    await this.assertRepVisitScope(tenantId, repId, payload.customerId, payload.tripId);

    // A linked sale, when given, must be the rep's own sale to this
    // customer: another rep's sale must not be attachable to my visit.
    // No live caller passes saleId today (the only driver caller sends
    // negative visits without one), so this narrows nothing in use.
    if (payload.saleId != null) {
      const sale = await this.anyDb
        .selectFrom('sales')
        .select(['id', 'customer_id', 'delivery_rep_id'])
        .where('id', '=', payload.saleId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (!sale) {
        throw new AppError('الفاتورة غير موجودة', 'SALE_NOT_FOUND', 404);
      }
      if (Number((sale as any).customer_id) !== Number(payload.customerId)) {
        throw new AppError('الفاتورة لا تخص هذا العميل', 'VISIT_SALE_CUSTOMER_MISMATCH', 400);
      }
      if ((sale as any).delivery_rep_id != null && Number((sale as any).delivery_rep_id) !== Number(repId)) {
        throw new AppError('الفاتورة تخص مندوباً آخر، لا يمكنك ربطها بزيارتك', 'REP_SALE_NOT_OWNED', 403);
      }
    }

    const inserted = await this.anyDb
      .insertInto('van_field_visits')
      .values({
        tenant_id: tenantId,
        account_id: accountId,
        trip_id: payload.tripId,
        rep_id: repId,
        customer_id: payload.customerId,
        visit_type: payload.visitType,
        sale_id: payload.saleId || null,
        negative_reason: payload.negativeReason || null,
        postponed_to_date: payload.postponedToDate || null,
        gps_lat: payload.gpsLat != null ? Number(payload.gpsLat) : null,
        gps_lng: payload.gpsLng != null ? Number(payload.gpsLng) : null,
        notes: payload.notes || null,
        visited_at: sql`NOW()`,
        created_at: sql`NOW()`,
      })
      .returning(['id'])
      .executeTakeFirstOrThrow();

    // Check Geofence Compliance if GPS coordinates were supplied
    const custRow = await this.anyDb
      .selectFrom('customers')
      .select(['id', 'name', 'metadata'])
      .where('id', '=', payload.customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    let isWithinGeofence = true;
    let distanceMeters: number | null = null;
    if (custRow && payload.gpsLat != null && payload.gpsLng != null) {
      const custCoords = extractCoordinatesFromCustomerLocation({ metadata: custRow.metadata });
      const geo = evaluateGeofenceCompliance({
        repLat: Number(payload.gpsLat),
        repLng: Number(payload.gpsLng),
        customerLat: custCoords?.lat ?? null,
        customerLng: custCoords?.lng ?? null,
        maxAllowedMeters: 300,
      });
      isWithinGeofence = geo.isCompliant !== false;
      distanceMeters = geo.distanceMeters;
      if (geo.status === 'outside_geofence') {
        await this.fraudRadar?.recordSuspicionEvent({
          tenantId,
          accountId,
          repId,
          tripId: payload.tripId,
          customerId: payload.customerId,
          customerName: custRow.name,
          eventCode: 'VAN_SUSPICION_GEOFENCE_VIOLATION',
          severity: 'medium',
          titleAr: 'تسجيل زيارة ميدانية خارج النطاق الجغرافي للعميل (Ghost Visit)',
          detailsAr: `سجل المندوب زيارة (${payload.visitType === 'negative' ? 'سلبية' : 'إيجابية'}) للعميل "${custRow.name}" من على بعد ${Math.round(geo.distanceMeters || 0)} متر (الحد المسموح 300 متر).`,
          referenceType: 'van_field_visits',
          referenceId: Number(inserted.id),
          extraMetadata: { distanceMeters: geo.distanceMeters, visitType: payload.visitType, negativeReason: payload.negativeReason },
        });
      }
    }

    const lastThreeVisits = await this.anyDb
      .selectFrom('van_field_visits')
      .select(['visit_type'])
      .where('customer_id', '=', payload.customerId)
      .where('tenant_id', '=', tenantId)
      .orderBy('visited_at', 'desc')
      .limit(3)
      .execute();

    const isConsecutiveThreeNegatives =
      lastThreeVisits.length >= 3 && lastThreeVisits.every((v: any) => v.visit_type === 'negative');

    return {
      ok: true,
      visitId: Number(inserted.id),
      consecutiveNegativeAlert: isConsecutiveThreeNegatives,
      isWithinGeofence,
      distanceMeters,
    };
  }

  async listFieldVisits(
    tenantId: string,
    filters?: { repId?: number; customerId?: number; visitType?: string; dateFrom?: string; dateTo?: string },
  ) {
    let query = this.anyDb
      .selectFrom('van_field_visits as vfv')
      .leftJoin('customers as c', 'c.id', 'vfv.customer_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vfv.rep_id')
      .leftJoin('sales as s', 's.id', 'vfv.sale_id')
      .select([
        'vfv.id',
        'vfv.trip_id as tripId',
        'vfv.rep_id as repId',
        sql<string>`coalesce(dr.name, 'مندوب توزيع')`.as('repName'),
        'vfv.customer_id as customerId',
        sql<string>`coalesce(c.name, 'عميل ميداني')`.as('customerName'),
        'c.phone as customerPhone',
        'c.metadata as customerMetadata',
        'vfv.visit_type as visitType',
        'vfv.sale_id as saleId',
        sql<string>`coalesce(s.doc_no, '')`.as('saleDocNo'),
        sql<number>`cast(coalesce(s.total, 0) as numeric)`.as('saleTotal'),
        'vfv.negative_reason as negativeReason',
        'vfv.postponed_to_date as postponedToDate',
        'vfv.gps_lat as gpsLat',
        'vfv.gps_lng as gpsLng',
        'vfv.notes',
        'vfv.visited_at as visitedAt',
      ])
      .where('vfv.tenant_id', '=', tenantId);

    if (filters?.repId) query = query.where('vfv.rep_id', '=', filters.repId);
    if (filters?.customerId) query = query.where('vfv.customer_id', '=', filters.customerId);
    if (filters?.visitType) query = query.where('vfv.visit_type', '=', filters.visitType);
    if (filters?.dateFrom) query = query.where('vfv.visited_at', '>=', filters.dateFrom);
    if (filters?.dateTo) query = query.where('vfv.visited_at', '<=', `${filters.dateTo} 23:59:59`);

    const rows = await query.orderBy('vfv.visited_at', 'desc').limit(300).execute();

    let directSaleVisits: any[] = [];
    if (!filters?.visitType || filters.visitType === 'positive') {
      const linkedSaleIds = rows.map((r: any) => r.saleId).filter(Boolean);
      let sq = this.anyDb
        .selectFrom('sales as s')
        .leftJoin('customers as c', 'c.id', 's.customer_id')
        .leftJoin('delivery_representatives as dr', 'dr.id', 's.delivery_rep_id')
        .select([
          's.id as saleId',
          's.van_trip_id as tripId',
          's.delivery_rep_id as repId',
          sql<string>`coalesce(dr.name, 'مندوب توزيع')`.as('repName'),
          's.customer_id as customerId',
          sql<string>`coalesce(c.name, s.customer_name, 'عميل نقدي عام')`.as('customerName'),
          's.customer_phone as customerPhone',
          'c.metadata as customerMetadata',
          sql<string>`'positive'`.as('visitType'),
          's.doc_no as saleDocNo',
          sql<number>`cast(coalesce(s.total, 0) as numeric)`.as('saleTotal'),
          sql<string | null>`null`.as('negativeReason'),
          sql<string | null>`null`.as('postponedToDate'),
          sql<number | null>`cast(s.delivery_gps_lat as double precision)`.as('gpsLat'),
          sql<number | null>`cast(s.delivery_gps_lng as double precision)`.as('gpsLng'),
          sql<string>`coalesce(s.note, 'فاتورة بيع ميداني مباشر')`.as('notes'),
          's.created_at as visitedAt',
        ])
        .where('s.tenant_id', '=', tenantId)
        .where('s.van_trip_id', 'is not', null);

      if (filters?.repId) sq = sq.where('s.delivery_rep_id', '=', filters.repId);
      if (filters?.customerId) sq = sq.where('s.customer_id', '=', filters.customerId);
      if (filters?.dateFrom) sq = sq.where('s.created_at', '>=', new Date(filters.dateFrom));
      if (filters?.dateTo) sq = sq.where('s.created_at', '<=', new Date(`${filters.dateTo} 23:59:59`));
      if (linkedSaleIds.length > 0) {
        sq = sq.where('s.id', 'not in', linkedSaleIds);
      }

      const directRows = await sq.orderBy('s.created_at', 'desc').limit(100).execute();
      directSaleVisits = directRows.map((r: any) => ({
        ...r,
        id: -Number(r.saleId),
      }));
    }

    const allVisits = [...rows, ...directSaleVisits].sort((a: any, b: any) => {
      const ta = new Date(a.visitedAt).getTime();
      const tb = new Date(b.visitedAt).getTime();
      return tb - ta;
    });

    return allVisits.map((r: any) => {
      const custCoords = extractCoordinatesFromCustomerLocation({ metadata: r.customerMetadata });
      const geo = evaluateGeofenceCompliance({
        repLat: r.gpsLat != null ? Number(r.gpsLat) : null,
        repLng: r.gpsLng != null ? Number(r.gpsLng) : null,
        customerLat: custCoords?.lat ?? null,
        customerLng: custCoords?.lng ?? null,
        maxAllowedMeters: 300,
      });
      const { customerMetadata: _cm, ...rest } = r;
      return {
        ...rest,
        customerLat: custCoords?.lat ?? null,
        customerLng: custCoords?.lng ?? null,
        distanceMeters: geo.distanceMeters,
        isWithinGeofence: geo.isCompliant,
        geofenceStatus: geo.status,
      };
    });
  }

  async getSupervisorRouteKpis(tenantId: string, dateFrom?: string, dateTo?: string) {
    let visitQuery = this.anyDb
      .selectFrom('van_field_visits as vfv')
      .leftJoin('customers as c', 'c.id', 'vfv.customer_id')
      .select([
        'vfv.id',
        'vfv.visit_type as visitType',
        'vfv.negative_reason as negativeReason',
        'vfv.customer_id as customerId',
        'vfv.rep_id as repId',
        'vfv.gps_lat as gpsLat',
        'vfv.gps_lng as gpsLng',
        'c.metadata as customerMetadata',
      ])
      .where('vfv.tenant_id', '=', tenantId);

    if (dateFrom) visitQuery = visitQuery.where('vfv.visited_at', '>=', dateFrom);
    if (dateTo) visitQuery = visitQuery.where('vfv.visited_at', '<=', `${dateTo} 23:59:59`);

    const visits = await visitQuery.execute();

    // Fetch unlinked direct van sales to include in KPI strike rate & total visits
    const linkedSaleIds = (await this.anyDb
      .selectFrom('van_field_visits')
      .select(['sale_id'])
      .where('tenant_id', '=', tenantId)
      .where('sale_id', 'is not', null)
      .execute()).map((r: any) => r.sale_id).filter(Boolean);

    let sq = this.anyDb
      .selectFrom('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .select([
        's.id',
        sql<string>`'positive'`.as('visitType'),
        sql<string | null>`null`.as('negativeReason'),
        's.customer_id as customerId',
        's.delivery_rep_id as repId',
        sql<number | null>`cast(s.delivery_gps_lat as double precision)`.as('gpsLat'),
        sql<number | null>`cast(s.delivery_gps_lng as double precision)`.as('gpsLng'),
        'c.metadata as customerMetadata',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.van_trip_id', 'is not', null);

    if (dateFrom) sq = sq.where('s.created_at', '>=', new Date(dateFrom));
    if (dateTo) sq = sq.where('s.created_at', '<=', new Date(`${dateTo} 23:59:59`));
    if (linkedSaleIds.length > 0) {
      sq = sq.where('s.id', 'not in', linkedSaleIds);
    }
    const directSalesKpi = await sq.execute();

    const allVisitsKpi = [...visits, ...directSalesKpi];

    const totalVisits = allVisitsKpi.length;
    const positiveVisits = allVisitsKpi.filter((v: any) => v.visitType === 'positive').length;
    const negativeVisits = allVisitsKpi.filter((v: any) => v.visitType === 'negative').length;
    const strikeRate = totalVisits > 0 ? Number(((positiveVisits / totalVisits) * 100).toFixed(1)) : 0;

    let geofenceCompliantCount = 0;
    let geofenceViolationsCount = 0;
    for (const v of allVisitsKpi) {
      const custCoords = extractCoordinatesFromCustomerLocation({ metadata: v.customerMetadata });
      const geo = evaluateGeofenceCompliance({
        repLat: v.gpsLat != null ? Number(v.gpsLat) : null,
        repLng: v.gpsLng != null ? Number(v.gpsLng) : null,
        customerLat: custCoords?.lat ?? null,
        customerLng: custCoords?.lng ?? null,
        maxAllowedMeters: 300,
      });
      if (geo.status === 'within_geofence') geofenceCompliantCount++;
      else if (geo.status === 'outside_geofence') geofenceViolationsCount++;
    }

    const reasonsMap: Record<string, number> = {
      no_cash: 0,
      shop_closed: 0,
      sufficient_stock: 0,
      item_unavailable: 0,
      postponed: 0,
      other: 0,
    };
    for (const v of visits) {
      if (v.visitType === 'negative' && v.negativeReason) {
        reasonsMap[v.negativeReason] = (reasonsMap[v.negativeReason] || 0) + 1;
      }
    }

    const custNegatives: Record<number, number> = {};
    for (const v of visits) {
      if (v.visitType === 'negative') {
        custNegatives[Number(v.customerId)] = (custNegatives[Number(v.customerId)] || 0) + 1;
      }
    }
    const repeatedNegativeCustomersCount = Object.values(custNegatives).filter((cnt) => cnt >= 3).length;

    const fuelLogs = await this.vanFleetService.listFuelLogs(tenantId, { dateFrom, dateTo });
    const totalFuelLiters = fuelLogs.reduce((sum: number, f: any) => sum + Number(f.liters || 0), 0);
    const totalFuelCost = fuelLogs.reduce((sum: number, f: any) => sum + Number(f.totalCost || 0), 0);
    const totalKmDriven = fuelLogs.reduce((sum: number, f: any) => sum + Number(f.kmSinceLastFuel || 0), 0);
    const avgConsumptionRate = totalFuelLiters > 0 && totalKmDriven > 0
      ? Number((totalKmDriven / totalFuelLiters).toFixed(2))
      : 0;

    const alertsRes = await this.vanFleetService.getFleetMaintenanceAlerts(tenantId);
    const alerts = alertsRes.alerts || [];

    return {
      totalVisits,
      positiveVisits,
      negativeVisits,
      strikeRate,
      geofenceCompliantCount,
      geofenceViolationsCount,
      negativeReasonsBreakdown: reasonsMap,
      repeatedNegativeCustomersCount,
      totalFuelLiters,
      totalFuelCost,
      totalKmDriven,
      avgConsumptionRate,
      alertsCount: alerts.length,
      alerts,
    };
  }

  async setCustomerRouteSchedule(
    tenantId: string,
    customerId: number,
    payload: {
      route?: string;
      routeSequence?: number;
      visitDays?: string[];
      customerCode?: string;
      locationUrl?: string;
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string | null;
      repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
    },
  ) {
    const cust = await this.anyDb
      .selectFrom('customers')
      .select(['id', 'metadata'])
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!cust) throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);

    let existingMeta: any = {};
    if (typeof cust.metadata === 'string') {
      try { existingMeta = JSON.parse(cust.metadata); } catch { existingMeta = {}; }
    } else if (cust.metadata && typeof cust.metadata === 'object') {
      existingMeta = { ...cust.metadata };
    }

    let targetRepIds: number[] | undefined;
    if (Array.isArray(payload.assignedRepIds)) {
      targetRepIds = Array.from(
        new Set(
          payload.assignedRepIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      );
    } else if (payload.assignedRepId !== undefined) {
      if (payload.assignedRepId === null) {
        targetRepIds = [];
      } else {
        const singleId = Number(payload.assignedRepId);
        targetRepIds = Number.isInteger(singleId) && singleId > 0 ? [singleId] : [];
      }
    }

    let resolvedRepName = payload.assignedRepName ?? existingMeta.assigned_rep_name ?? null;
    let resolvedRepNames: string[] = Array.isArray(existingMeta.assigned_rep_names)
      ? existingMeta.assigned_rep_names
      : [];

    if (targetRepIds !== undefined) {
      if (targetRepIds.length > 0) {
        const reps = await this.anyDb
          .selectFrom('delivery_representatives')
          .select(['id', 'name'])
          .where('id', 'in', targetRepIds)
          .where('tenant_id', '=', tenantId)
          .execute();
        const nameById = new Map<number, string>();
        for (const r of reps || []) {
          nameById.set(Number(r.id), String(r.name || `مندوب #${r.id}`));
        }
        resolvedRepNames = targetRepIds.map((id) => nameById.get(id) || `مندوب #${id}`);
        resolvedRepName = resolvedRepNames.join(' ، ');
      } else {
        resolvedRepNames = [];
        resolvedRepName = null;
      }
    }

    const parsedCoords = payload.locationUrl !== undefined
      ? extractCoordinatesFromCustomerLocation({ locationUrl: payload.locationUrl })
      : null;

    let scheduleDaysUpdate: any = {};
    if (payload.visitDays !== undefined) {
      const normalizedDays = payload.visitDays
        .map((d) => DAY_KEY_TO_ARABIC[normalizeDayKey(d)] || d)
        .filter(Boolean);
      scheduleDaysUpdate = {
        visit_days: normalizedDays,
        visit_day: normalizedDays[0] || '',
      };
    }

    const updatedMeta: any = {
      ...existingMeta,
      ...(payload.route !== undefined ? { route: payload.route } : {}),
      ...(payload.routeSequence !== undefined ? { route_sequence: payload.routeSequence } : {}),
      ...scheduleDaysUpdate,
      ...(payload.customerCode !== undefined ? { customer_code: payload.customerCode } : {}),
      ...(payload.locationUrl !== undefined ? { location_url: payload.locationUrl } : {}),
      ...(parsedCoords ? { gps_lat: parsedCoords.lat, gps_lng: parsedCoords.lng } : {}),
    };

    if (targetRepIds !== undefined) {
      updatedMeta.assigned_rep_ids = targetRepIds;
      updatedMeta.assigned_rep_names = resolvedRepNames;
      updatedMeta.assigned_rep_id = targetRepIds.length > 0 ? targetRepIds[0] : null;
      updatedMeta.assigned_rep_name = resolvedRepName;
    }

    if (payload.repSchedules !== undefined) {
      updatedMeta.rep_schedules = payload.repSchedules.map((item) => ({
        repId: Number(item.repId),
        repName: item.repName || '',
        days: (item.days || []).map((d) => DAY_KEY_TO_ARABIC[normalizeDayKey(d)] || d).filter(Boolean),
      }));
    }

    await this.anyDb
      .updateTable('customers')
      .set({
        metadata: JSON.stringify(updatedMeta),
        updated_at: sql`NOW()`,
      })
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, customerId, metadata: updatedMeta };
  }

  async bulkAssignCustomerRoutes(
    tenantId: string,
    payload: {
      customerIds: number[];
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      appendReps?: boolean;
      assignedRepName?: string | null;
      route?: string;
      visitDays?: string[];
    },
  ) {
    if (!Array.isArray(payload.customerIds) || payload.customerIds.length === 0) {
      throw new AppError('يرجى تحديد عميل واحد على الأقل', 'INVALID_CUSTOMER_IDS', 400);
    }

    const allReps = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('tenant_id', '=', tenantId)
      .execute();
    const repNameById = new Map<number, string>();
    for (const r of allReps || []) {
      repNameById.set(Number(r.id), String(r.name || `مندوب #${r.id}`));
    }

    let resolvedRepName = payload.assignedRepName;
    if (payload.assignedRepId) {
      resolvedRepName = repNameById.get(Number(payload.assignedRepId)) || resolvedRepName;
    } else if (payload.assignedRepId === null) {
      resolvedRepName = null;
    }

    const customers = await this.anyDb
      .selectFrom('customers')
      .select(['id', 'metadata'])
      .where('id', 'in', payload.customerIds)
      .where('tenant_id', '=', tenantId)
      .execute();

    for (const c of customers) {
      let meta: any = {};
      if (typeof c.metadata === 'string') {
        try { meta = JSON.parse(c.metadata); } catch { meta = {}; }
      } else if (c.metadata && typeof c.metadata === 'object') {
        meta = { ...c.metadata };
      }

      if (Array.isArray(payload.assignedRepIds)) {
        const existingIds = payload.appendReps ? extractAssignedRepIds(meta) : [];
        const mergedIds = Array.from(
          new Set(
            [...existingIds, ...payload.assignedRepIds.map((id) => Number(id))].filter(
              (id) => Number.isInteger(id) && id > 0,
            ),
          ),
        );
        const names = mergedIds.map((id) => repNameById.get(id) || `مندوب #${id}`);
        meta.assigned_rep_ids = mergedIds;
        meta.assigned_rep_names = names;
        meta.assigned_rep_id = mergedIds.length > 0 ? mergedIds[0] : null;
        meta.assigned_rep_name = names.length > 0 ? names.join(' ، ') : null;
      } else if (payload.assignedRepId !== undefined) {
        if (payload.assignedRepId === null) {
          meta.assigned_rep_id = null;
          meta.assigned_rep_ids = [];
          meta.assigned_rep_name = null;
          meta.assigned_rep_names = [];
        } else {
          const rId = Number(payload.assignedRepId);
          const existingIds = payload.appendReps ? extractAssignedRepIds(meta) : [];
          const mergedIds = Array.from(new Set([...existingIds, rId]));
          const names = mergedIds.map((id) => repNameById.get(id) || resolvedRepName || `مندوب #${id}`);
          meta.assigned_rep_id = mergedIds[0] ?? rId;
          meta.assigned_rep_ids = mergedIds;
          meta.assigned_rep_name = names.join(' ، ');
          meta.assigned_rep_names = names;
        }
      }
      if (payload.route !== undefined && payload.route.trim()) {
        meta.route = payload.route.trim();
      }
      if (payload.visitDays !== undefined) {
        const normalizedDays = payload.visitDays
          .map((d) => DAY_KEY_TO_ARABIC[normalizeDayKey(d)] || d)
          .filter(Boolean);
        meta.visit_days = normalizedDays;
        meta.visit_day = normalizedDays[0] || '';
      }

      await this.anyDb
        .updateTable('customers')
        .set({
          metadata: JSON.stringify(meta),
          updated_at: sql`NOW()`,
        })
        .where('id', '=', c.id)
        .where('tenant_id', '=', tenantId)
        .execute();
    }

    return {
      ok: true,
      updatedCount: customers.length,
      assignedRepId: payload.assignedRepId,
      assignedRepName: resolvedRepName,
    };
  }

  async getSupervisorCustomerRoutes(
    tenantId: string,
    filters?: {
      search?: string;
      repId?: number | string;
      route?: string;
      unassignedOnly?: boolean;
    },
  ) {
    let query = this.anyDb
      .selectFrom('customers as c')
      .select([
        'c.id',
        'c.name',
        'c.phone',
        'c.address',
        'c.metadata',
        sql<number>`cast(coalesce(c.credit_limit, 0) as numeric)`.as('creditLimit'),
        sql<number>`coalesce(c.balance, 0)`.as('balance'),
        'c.created_at as createdAt',
      ])
      .where('c.tenant_id', '=', tenantId)
      .where('c.is_active', '=', true);

    if (filters?.search && filters.search.trim()) {
      const rawTrim = filters.search.trim();
      const q = `%${rawTrim.toLowerCase()}%`;
      const codeDigitsMatch = rawTrim.match(/^(?:c-|#)?0*(\d+)$/i);
      const numericId = codeDigitsMatch ? Number(codeDigitsMatch[1]) : null;
      query = query.where((eb: any) => {
        const conds: any[] = [
          sql<boolean>`TRANSLATE(LOWER(COALESCE(c.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE TRANSLATE(${q}, 'أإآٱٲٳؤئىة', 'ااااااويهه')`,
          sql<boolean>`c.phone like ${q}`,
          sql<boolean>`LPAD(CAST(c.id AS TEXT), 4, '0') LIKE ${q}`,
          sql<boolean>`cast(c.metadata as text) ilike ${q}`,
        ];
        if (numericId && Number.isInteger(numericId) && numericId > 0) {
          conds.push(eb('c.id', '=', numericId));
        }
        return eb.or(conds);
      });
    }

    const [rows, allReps] = await Promise.all([
      query.orderBy('c.name', 'asc').limit(3000).execute(),
      this.anyDb
        .selectFrom('delivery_representatives')
        .select(['id', 'name'])
        .where('tenant_id', '=', tenantId)
        .execute(),
    ]);

    const repNameById = new Map<number, string>();
    for (const rep of allReps || []) {
      repNameById.set(Number(rep.id), String(rep.name || `مندوب #${rep.id}`));
    }

    const customerIds: number[] = [];
    const customerTotalBalances: Record<number, number> = {};
    for (const r of rows) {
      const cid = Number(r.id);
      customerIds.push(cid);
      customerTotalBalances[cid] = Number(r.balance || 0);
    }

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
      customerIds,
      customerTotalBalances,
      moneyDigits,
    });

    let results = rows.map((r: any) => {
      const cid = Number(r.id);
      let meta: any = {};
      if (typeof r.metadata === 'string') {
        try { meta = JSON.parse(r.metadata); } catch { meta = {}; }
      } else if (r.metadata && typeof r.metadata === 'object') {
        meta = r.metadata;
      }

      const breakdown = repBalancesMap.get(cid);
      const repBalances = breakdown?.repBalances || [];
      const metaRepIds = extractAssignedRepIds(meta);
      const ledgerRepIds = repBalances.filter((rb) => rb.balance !== 0).map((rb) => rb.repId);
      const assignedRepIds = Array.from(new Set([...metaRepIds, ...ledgerRepIds]));
      const assignedRepNames = assignedRepIds.map(
        (id) => repNameById.get(id) || breakdown?.byRepId[id]?.repName || `مندوب #${id}`,
      );
      const primaryRepId = meta.assigned_rep_id
        ? Number(meta.assigned_rep_id)
        : (assignedRepIds.length > 0 ? assignedRepIds[0] : null);
      const displayRepName =
        assignedRepNames.length > 0
          ? assignedRepNames.join(' ، ')
          : (meta.assigned_rep_name || null);

      const { visitDays, visitDay } = extractCustomerVisitDays(meta);

      return {
        customerId: cid,
        customerName: r.name,
        customerPhone: r.phone || '',
        customerAddress: r.address || '',
        customerCode: normalizeCustomerCode(meta.customer_code || meta.code, cid),
        route: meta.route || 'غير محدد',
        routeSequence: Number(meta.route_sequence || 1),
        visitDays,
        visitDay,
        repSchedules: meta.rep_schedules || [],
        assignedRepId: primaryRepId,
        assignedRepIds,
        assignedRepNames,
        assignedRepName: displayRepName,
        locationUrl: meta.location_url || (meta.gps_lat && meta.gps_lng ? `https://maps.google.com/?q=${meta.gps_lat},${meta.gps_lng}` : ''),
        balance: Number(r.balance || 0),
        repBalances,
        unassignedBalance: breakdown?.unassignedBalance || 0,
        creditLimit: Number(r.creditLimit || 0),
      };
    });

    if (filters?.unassignedOnly || filters?.repId === 'unassigned') {
      results = results.filter((c: any) => (!c.assignedRepIds || c.assignedRepIds.length === 0) && !c.assignedRepId);
    } else if (filters?.repId && filters.repId !== 'all') {
      const targetRepId = Number(filters.repId);
      results = results.filter(
        (c: any) =>
          c.assignedRepId === targetRepId ||
          (Array.isArray(c.assignedRepIds) && c.assignedRepIds.includes(targetRepId)) ||
          (Array.isArray(c.repBalances) && c.repBalances.some((rb: any) => Number(rb.repId) === targetRepId && rb.balance !== 0)),
      );
    }

    if (filters?.route && filters.route !== 'all') {
      results = results.filter((c: any) => c.route === filters.route);
    }

    return results;
  }

  async optimizeCustomerRoute(
    tenantId: string,
    payload: {
      customerIds?: number[];
      route?: string;
      repId?: number;
      startLat?: number | null;
      startLng?: number | null;
      persistSequence?: boolean;
      // H9 (D4): the rep acting on his own behalf. Only the driver
      // endpoint passes this; the supervisor endpoint does not, so a
      // supervisor editing routes is never gated by a rep's flag.
      actingRepId?: number;
    },
  ): Promise<RouteOptimizationResult & { persistedCount?: number }> {
    let customerRows: any[] = [];

    if (Array.isArray(payload.customerIds) && payload.customerIds.length > 0) {
      customerRows = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'phone', 'address', 'metadata', 'balance'])
        .where('id', 'in', payload.customerIds)
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .execute();
    } else if (payload.route && payload.route.trim()) {
      const allActive = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'phone', 'address', 'metadata', 'balance'])
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .execute();

      const rName = payload.route.trim();
      customerRows = allActive.filter((c: any) => {
        let meta: any = {};
        if (typeof c.metadata === 'string') {
          try { meta = JSON.parse(c.metadata); } catch { meta = {}; }
        } else if (c.metadata && typeof c.metadata === 'object') {
          meta = c.metadata;
        }
        return meta.route === rName;
      });
    } else {
      throw new AppError('يرجى تحديد العملاء أو اسم خط السير للتحسين', 'INVALID_OPTIMIZE_PAYLOAD', 400);
    }

    // INV-REP-SCOPED-DRIVER-READS (M19/D8): when repId is present the
    // caller is a driver (or a supervisor optimizing for one rep) and
    // the route may only cover that rep's own customers — assigned in
    // customer metadata, served (field visit / pre-sale order /
    // delivered sale), or ledger-active under his rep id; the same
    // three legs H7 established for getActiveTrip /
    // getDriverTodayItinerary. An explicitly requested customer
    // outside that scope is refused with a specific 403 naming the
    // problem (existing 403 style); a shared route name is silently
    // restricted to his own customers, since route names are shared
    // across reps and no specific customer was requested. With no
    // repId (admin path) the breadth is unchanged. Because the rows
    // below are the only ones ever persisted, persistSequence can
    // never rewrite another rep's route_sequence.
    if (payload.repId != null) {
      const repId = Number(payload.repId);
      const servedIds = await this.listRepServedCustomerIds(tenantId, repId);
      const candidateIds = customerRows.map((c: any) => Number(c.id));
      const totals: Record<number, number> = {};
      for (const c of customerRows) totals[Number(c.id)] = Number((c as any).balance || 0);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
      const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
        customerIds: candidateIds,
        customerTotalBalances: totals,
        moneyDigits,
      });
      const inScope = (c: any): boolean => {
        const cid = Number(c.id);
        let meta: any = {};
        if (typeof c.metadata === 'string') {
          try { meta = JSON.parse(c.metadata); } catch { meta = {}; }
        } else if (c.metadata && typeof c.metadata === 'object') {
          meta = c.metadata;
        }
        if (extractAssignedRepIds(meta).includes(repId)) return true;
        if (servedIds.has(cid)) return true;
        return Boolean(repBalancesMap.get(cid)?.byRepId[repId]);
      };
      if (Array.isArray(payload.customerIds) && payload.customerIds.length > 0) {
        const outside = customerRows.find((c: any) => !inScope(c));
        if (outside) {
          throw new AppError(
            'هذا العميل غير مسند إليك ولم تخدمه من قبل، لا يمكنك إدراجه في خط سيرك',
            'REP_CUSTOMER_NOT_IN_SCOPE',
            403,
          );
        }
      } else {
        customerRows = customerRows.filter(inScope);
      }
    }

    if (customerRows.length === 0) {
      throw new AppError('لم يتم العثور على أي عملاء نشطين للتحسين', 'NO_CUSTOMERS_FOUND', 404);
    }

    const stops: RouteStopInput[] = customerRows.map((c) => {
      const cId = Number(c.id);
      let meta: any = {};
      if (typeof c.metadata === 'string') {
        try { meta = JSON.parse(c.metadata); } catch { meta = {}; }
      } else if (c.metadata && typeof c.metadata === 'object') {
        meta = c.metadata;
      }

      const coords = extractCoordinatesFromCustomerLocation({
        locationUrl: meta.location_url,
        metadata: meta,
      });

      return {
        id: cId,
        name: c.name,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        address: c.address || '',
        district: meta.district || meta.area || '',
        customerCode: normalizeCustomerCode(meta.customer_code || meta.code, cId),
        originalSequence: Number(meta.route_sequence || 0),
        route: meta.route || 'الخط العام',
      };
    });

    const result = optimizeRouteTsp(stops, {
      startLat: payload.startLat,
      startLng: payload.startLng,
    });

    let persistedCount = 0;
    if (payload.persistSequence) {
      // H9 (D4): persisting a new route sequence IS the route edit —
      // a read-only optimization (no persistSequence) writes nothing
      // and is never gated. When the caller is the rep himself
      // (actingRepId), his can_edit_routes flag must allow it; a
      // supervisor call carries no actingRepId and is ungated.
      // The gate runs before the first write, so a refusal leaves
      // every customer's route_sequence untouched.
      if (payload.actingRepId != null) {
        const repFlags = await loadRepPermissions(this.anyDb, tenantId, Number(payload.actingRepId));
        if (!repFlags.can_edit_routes) {
          throw new AppError(
            'صلاحية تعديل خطوط السير (can_edit_routes) مغلقة لهذا المندوب، فلا يمكنه حفظ ترتيب مسار جديد',
            'REP_CANNOT_EDIT_ROUTES',
            403,
          );
        }
      }
      for (const stop of result.orderedStops) {
        const cRow = customerRows.find((c) => Number(c.id) === stop.id);
        if (!cRow) continue;

        let meta: any = {};
        if (typeof cRow.metadata === 'string') {
          try { meta = JSON.parse(cRow.metadata); } catch { meta = {}; }
        } else if (cRow.metadata && typeof cRow.metadata === 'object') {
          meta = { ...cRow.metadata };
        }

        meta.route_sequence = stop.sequenceIndex;

        await this.anyDb
          .updateTable('customers')
          .set({
            metadata: JSON.stringify(meta),
            updated_at: sql`NOW()`,
          })
          .where('id', '=', stop.id)
          .where('tenant_id', '=', tenantId)
          .execute();

        persistedCount++;
      }
    }

    return {
      ...result,
      persistedCount,
    };
  }
}
