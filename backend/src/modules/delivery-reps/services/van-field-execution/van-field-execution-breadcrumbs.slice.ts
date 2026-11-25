import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { BreadcrumbPayload } from './van-field-execution.types';

export interface VanFieldExecutionBreadcrumbsSliceBoundDeps {
  assertTripOwnedByRep: (...args: any[]) => any;
}

export class VanFieldExecutionBreadcrumbsSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: VanFieldExecutionBreadcrumbsSliceBoundDeps,
  ) {}

  private async assertTripOwnedByRep(tenantId: string, tripId: number, repId: number) {
    return this.bound.assertTripOwnedByRep(tenantId, tripId, repId);
  }

  /**
   * 6. Live Breadcrumb Recording: Saves rep GPS points for breadcrumb trail
   */
  async recordLiveBreadcrumb(tenantId: string, accountId: number, repId: number, payload: BreadcrumbPayload) {
    if (!payload.tripId || payload.latitude == null || payload.longitude == null) {
      throw new AppError('بيانات التتبع ناقصة', 'INVALID_BREADCRUMB_DATA', 400);
    }

    // INV-REP-DRIVER-WRITES-OWNERSHIP (M16/D7): GPS points land only
    // on the caller's own trip — another rep's trail cannot be
    // injected or polluted.
    await this.assertTripOwnedByRep(tenantId, payload.tripId, repId);

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
}
