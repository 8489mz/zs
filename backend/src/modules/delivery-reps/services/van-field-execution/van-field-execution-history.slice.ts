import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { FmcgVisitExecutionEngine } from '../../fmcg-visit-execution.engine';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { getTenantTimezone } from '../../../../common/utils/tenant-timezone.util';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';

export class VanFieldExecutionHistorySlice {
  constructor(private readonly db: Kysely<Database>) {}

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
    let q = this.db.selectFrom('van_store_visits').selectAll().where('tenant_id', '=', tenantId);

    // P7 (single-server-clock rule): a visit's business day is its
    // check-in instant in the TENANT zone — resolve the zone once
    // when a date filter is given; plain DATE() is the DB session
    // timezone, which is not the tenant day.
    const businessTimezone = filters?.date ? await getTenantTimezone(this.db, tenantId) : null;

    if (filters?.tripId) q = q.where('trip_id', '=', filters.tripId);
    if (filters?.repId) q = q.where('rep_id', '=', filters.repId);
    if (filters?.customerId) q = q.where('customer_id', '=', filters.customerId);
    if (filters?.noSaleOnly) q = q.where('has_sale', '=', false);
    if (filters?.date) {
      q = q.where(sql`DATE(check_in_at AT TIME ZONE ${businessTimezone})`, '=', filters.date);
    }

    const rows = await q.orderBy('check_in_at', 'desc').limit(200).execute();

    // 2. Fetch direct van field sales (cash / walk-in sales) not already linked in van_store_visits
    let directVisits: any[] = [];
    if (!filters?.noSaleOnly) {
      const linkedSaleIds = rows.map((r) => r.sale_id).filter(Boolean);
      let sq = this.db
        .selectFrom('sales as s')
        .leftJoin('customers as c', (join: any) =>
          join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'),
        )
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
        sq = sq.where(sql`DATE(s.created_at AT TIME ZONE ${businessTimezone})`, '=', filters.date);
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
        // INV-VAN-VISITS-TRACKING-COLLECTIONS: a cash sale is cash in
        // hand, not a collection — it must not inflate "تحصيلات".
        has_collection: false,
        collection_amount: 0,
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
    // INV-VAN-VISITS-TRACKING-COLLECTIONS: the engine can only sum
    // what the visit rows carry, and a field collection is recorded
    // from the collection tab with no visit row (the visit auto-ends
    // after a sale), so real collections never reached the total.
    // Source "تحصيلات" from the same customer_payments vouchers the
    // trip cash_collected counter accumulates — the same table
    // checkOutVisit verifies a collection amount against — scoped
    // exactly like the visits above. Only rows with a van_trip_id
    // count: a plain customer payment has none and is not a field
    // collection.
    let collectionsQuery = this.db
      .selectFrom('customer_payments')
      .select(sql<number>`coalesce(sum(amount), 0)`.as('total'))
      .where('tenant_id', '=', tenantId)
      .where('van_trip_id', 'is not', null);
    if (filters?.tripId) collectionsQuery = collectionsQuery.where('van_trip_id', '=', filters.tripId);
    if (filters?.repId) collectionsQuery = collectionsQuery.where('rep_id', '=', filters.repId);
    if (filters?.customerId) collectionsQuery = collectionsQuery.where('customer_id', '=', filters.customerId);
    if (filters?.date) {
      collectionsQuery = collectionsQuery.where(
        sql`DATE(created_at AT TIME ZONE ${businessTimezone})`,
        '=',
        filters.date,
      );
    }
    const collectionsRow = await collectionsQuery.executeTakeFirst();
    const metrics = {
      ...FmcgVisitExecutionEngine.calculateStrikeRateMetrics(allVisits, moneyDigits),
      totalCollectionsAmount: roundMoney(Number(collectionsRow?.total || 0), moneyDigits),
    };

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
        storeInventory: typeof r.store_inventory === 'string' ? JSON.parse(r.store_inventory) : r.store_inventory || [],
      })),
    };
  }
}
