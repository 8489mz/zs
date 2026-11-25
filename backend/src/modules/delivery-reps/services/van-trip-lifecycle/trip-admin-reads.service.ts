import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { getTenantTimezone, normalizePgDateOnly } from '../../../../common/utils/tenant-timezone.util';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { boundedPage } from '../../../../common/utils/bounded-page';
import { extractCoordinatesFromCustomerLocation, evaluateGeofenceCompliance } from '../../rep-target.engine';
import { type DayBucket } from '../../van-settlement-split.engine';
import { type VanTripSummary } from './van-trip-types';
import { type SettlementHelpersService } from './settlement-helpers.service';

@Injectable()
export class TripAdminReadsService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly computeTripDayBuckets: SettlementHelpersService['computeTripDayBuckets'],
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * INV-VAN-DAILY-SPLIT-SETTLEMENT: per-day cash due for one trip —
   * the same buckets the settle step settles from, so the UI's
   * per-day inputs and the server's per-day guard can never disagree.
   */
  async getTripDueByDay(
    repId: number,
    tenantId: string,
    tripId: number,
  ): Promise<{
    ok: boolean;
    tripId: number;
    businessDay: string | null;
    timezone: string;
    days: DayBucket[];
    totalDue: number;
  }> {
    const trip = await this.anyDb
      .selectFrom('van_sales_trips')
      .select(['id', 'business_day', 'cash_collected'])
      .where('id', '=', tripId)
      .where('tenant_id', '=', tenantId)
      .where('rep_id', '=', repId)
      .executeTakeFirst();
    if (!trip) {
      throw new AppError('الرحلة غير موجودة', 'TRIP_NOT_FOUND', 404);
    }
    const timezone = await getTenantTimezone(this.anyDb, tenantId);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const days = await this.computeTripDayBuckets(this.anyDb, tenantId, tripId, timezone, bookDigits);
    return {
      ok: true,
      tripId,
      businessDay: (trip as any).business_day ? normalizePgDateOnly((trip as any).business_day) : null,
      timezone,
      days,
      totalDue: roundMoney(
        days.reduce((s, d) => s + d.due, 0),
        bookDigits,
      ),
    };
  }

  /**
   * Admin audit list of all van trips.
   */
  async listTripsForAdmin(
    tenantId: string,
    filters?: { repId?: number; status?: string; dateFrom?: string; dateTo?: string },
  ): Promise<VanTripSummary[]> {
    let query = this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as src', 'src.id', 'vt.source_warehouse_id')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vt.rep_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        'vt.id',
        'vt.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        'vt.vehicle_id as vehicleId',
        sql<string>`coalesce(fv.plate_number, '')`.as('vehiclePlate'),
        sql<string>`coalesce(fv.model_name, '')`.as('vehicleModel'),
        'vt.shift_name as shiftName',
        sql<number>`cast(coalesce(vt.start_odometer, 0) as numeric)`.as('startOdometer'),
        sql<number>`cast(coalesce(vt.end_odometer, 0) as numeric)`.as('endOdometer'),
        'vt.van_location_id as vanLocationId',
        sql<string>`coalesce(van.name, '')`.as('vanLocationName'),
        'vt.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vt.status',
        'vt.settlement_status as settlementStatus',
        'vt.opened_at as openedAt',
        'vt.closed_at as closedAt',
        'vt.submitted_at as submittedAt',
        sql<number>`cast(coalesce(vt.loaded_amount, 0) as numeric)`.as('loadedAmount'),
        sql<number>`cast(coalesce(vt.sales_amount, 0) as numeric)`.as('salesAmount'),
        sql<number>`cast(coalesce(vt.cash_collected, 0) as numeric)`.as('cashCollected'),
        sql<number>`cast(coalesce(vt.credit_sales, 0) as numeric)`.as('creditSales'),
        sql<number>`cast(coalesce(vt.returns_amount, 0) as numeric)`.as('returnsAmount'),
        sql<number>`cast(coalesce(vt.cash_refunds, 0) as numeric)`.as('cashRefunds'),
        sql<number>`cast(coalesce(vt.variance, 0) as numeric)`.as('variance'),
        sql<number>`cast(coalesce(vt.distance_km, 0) as numeric)`.as('distanceKm'),
        sql<number>`cast(coalesce(vt.stock_variance_amount, 0) as numeric)`.as('stockVarianceAmount'),
        'vt.night_stock_approved as nightStockApproved',
        'vt.notes',
      ])
      .where('vt.tenant_id', '=', tenantId);

    if (filters?.repId) {
      query = query.where('vt.rep_id', '=', Number(filters.repId));
    }
    if (filters?.status) {
      query = query.where('vt.status', '=', filters.status);
    }
    if (filters?.dateFrom) {
      query = query.where('vt.opened_at', '>=', new Date(filters.dateFrom));
    }
    if (filters?.dateTo) {
      query = query.where('vt.opened_at', '<=', new Date(filters.dateTo));
    }

    const rows = await query.orderBy('vt.id', 'desc').limit(50).execute();

    return rows.map((r: any) => ({
      id: Number(r.id),
      repId: Number(r.repId),
      repName: r.repName,
      vehicleId: r.vehicleId ? Number(r.vehicleId) : undefined,
      vehiclePlate: r.vehiclePlate || undefined,
      vehicleModel: r.vehicleModel || undefined,
      shiftName: r.shiftName || 'صباحي',
      startOdometer: Number(r.startOdometer || 0),
      endOdometer: r.endOdometer ? Number(r.endOdometer) : undefined,
      vanLocationId: Number(r.vanLocationId),
      vanLocationName: r.vanLocationName,
      sourceWarehouseId: Number(r.sourceWarehouseId),
      sourceWarehouseName: r.sourceWarehouseName,
      status: r.status as any,
      openedAt: String(r.openedAt),
      closedAt: r.closedAt ? String(r.closedAt) : undefined,
      loadedAmount: Number(r.loadedAmount || 0),
      salesAmount: Number(r.salesAmount || 0),
      cashCollected: Number(r.cashCollected || 0),
      creditSales: Number(r.creditSales || 0),
      returnsAmount: Number(r.returnsAmount || 0),
      cashRefunds: Number(r.cashRefunds || 0),
      variance: Number(r.variance || 0),
      notes: r.notes || '',
    }));
  }

  /**
   * Admin detailed audit of a single van trip, including all sales (with GPS), collections (with GPS), and returns.
   */
  async getTripDetailsForAdmin(tenantId: string, tripId: number, pagination?: { page?: number; pageSize?: number }) {
    const { page, pageSize, offset } = boundedPage(pagination?.page, pagination?.pageSize);
    const trip = await this.anyDb
      .selectFrom('van_sales_trips as vt')
      .leftJoin('stock_locations as src', 'src.id', 'vt.source_warehouse_id')
      .leftJoin('stock_locations as van', 'van.id', 'vt.van_location_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'vt.rep_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        'vt.id',
        'vt.rep_id as repId',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<string>`coalesce(dr.phone, '')`.as('repPhone'),
        'vt.vehicle_id as vehicleId',
        sql<string>`coalesce(fv.plate_number, '')`.as('vehiclePlate'),
        sql<string>`coalesce(fv.model_name, '')`.as('vehicleModel'),
        'vt.shift_name as shiftName',
        sql<number>`cast(coalesce(vt.start_odometer, 0) as numeric)`.as('startOdometer'),
        sql<number>`cast(coalesce(vt.end_odometer, 0) as numeric)`.as('endOdometer'),
        'vt.van_location_id as vanLocationId',
        sql<string>`coalesce(van.name, '')`.as('vanLocationName'),
        'vt.source_warehouse_id as sourceWarehouseId',
        sql<string>`coalesce(src.name, '')`.as('sourceWarehouseName'),
        'vt.status',
        'vt.opened_at as openedAt',
        'vt.closed_at as closedAt',
        sql<number>`cast(coalesce(vt.loaded_amount, 0) as numeric)`.as('loadedAmount'),
        sql<number>`cast(coalesce(vt.sales_amount, 0) as numeric)`.as('salesAmount'),
        sql<number>`cast(coalesce(vt.cash_collected, 0) as numeric)`.as('cashCollected'),
        sql<number>`cast(coalesce(vt.credit_sales, 0) as numeric)`.as('creditSales'),
        sql<number>`cast(coalesce(vt.returns_amount, 0) as numeric)`.as('returnsAmount'),
        sql<number>`cast(coalesce(vt.cash_refunds, 0) as numeric)`.as('cashRefunds'),
        sql<number>`cast(coalesce(vt.variance, 0) as numeric)`.as('variance'),
        'vt.notes',
      ])
      .where('vt.id', '=', tripId)
      .where('vt.tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!trip) {
      throw new AppError('رحلة التوزيع الميداني غير موجودة', 'TRIP_NOT_FOUND', 404);
    }

    // Sales executed in this trip
    const sales = await this.anyDb
      .selectFrom('sales as s')
      .leftJoin('customers as c', (join: any) =>
        join.onRef('c.id', '=', 's.customer_id').onRef('c.tenant_id', '=', 's.tenant_id'),
      )
      .select([
        's.id',
        's.doc_no as docNo',
        sql<number>`cast(coalesce(s.total, 0) as numeric)`.as('total'),
        sql<string>`coalesce(s.payment_type, 'cash')`.as('paymentMethod'),
        's.created_at as createdAt',
        sql<string>`coalesce(c.name, 'عميل نقدي')`.as('customerName'),
        sql<string>`coalesce(c.phone, '')`.as('customerPhone'),
        'c.metadata as customerMetadata',
        sql<number>`cast(s.delivery_gps_lat as double precision)`.as('deliveryGpsLat'),
        sql<number>`cast(s.delivery_gps_lng as double precision)`.as('deliveryGpsLng'),
      ])
      .where('s.tenant_id', '=', tenantId)
      .where(sql<boolean>`s.van_trip_id = ${tripId}`)
      .orderBy('s.id', 'desc')
      .limit(pageSize + 1)
      .offset(offset)
      .execute();

    // Collections recorded in this trip
    const collections = await this.anyDb
      .selectFrom('customer_ledger as cl')
      .leftJoin('customers as c', (join: any) =>
        join.onRef('c.id', '=', 'cl.customer_id').onRef('c.tenant_id', '=', 'cl.tenant_id'),
      )
      .select([
        'cl.id',
        sql<number>`cast(abs(coalesce(cl.amount, 0)) as numeric)`.as('amount'),
        'cl.created_at as createdAt',
        sql<string>`coalesce(c.name, 'عميل')`.as('customerName'),
        'c.metadata as customerMetadata',
        'cl.note',
        sql<number>`cast(cl.gps_lat as double precision)`.as('gpsLat'),
        sql<number>`cast(cl.gps_lng as double precision)`.as('gpsLng'),
      ])
      .where('cl.tenant_id', '=', tenantId)
      .where(sql<boolean>`cl.van_trip_id = ${tripId}`)
      .where('cl.entry_type', '=', 'payment')
      .orderBy('cl.id', 'desc')
      .limit(pageSize + 1)
      .offset(offset)
      .execute();

    // Field returns recorded in this trip
    const returns = await this.anyDb
      .selectFrom('van_field_returns as vfr')
      .leftJoin('customers as c', (join: any) =>
        join.onRef('c.id', '=', 'vfr.customer_id').onRef('c.tenant_id', '=', 'vfr.tenant_id'),
      )
      .select([
        'vfr.id',
        'vfr.doc_no as docNo',
        sql<number>`cast(coalesce(vfr.total_amount, 0) as numeric)`.as('totalAmount'),
        'vfr.return_reason as returnReason',
        'vfr.refund_method as refundMethod',
        'vfr.status',
        'vfr.created_at as createdAt',
        sql<string>`coalesce(c.name, '')`.as('customerName'),
      ])
      .where('vfr.tenant_id', '=', tenantId)
      .where('vfr.trip_id', '=', tripId)
      .orderBy('vfr.id', 'desc')
      .limit(pageSize + 1)
      .offset(offset)
      .execute();

    // Inventory currently on van location
    const vanStock = await this.anyDb
      .selectFrom('product_location_stock as pls')
      .innerJoin('products as p', 'p.id', 'pls.product_id')
      .select([
        'p.id as productId',
        'p.name as productName',
        'p.barcode as barcode',
        sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
        sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
      ])
      .where('pls.location_id', '=', Number(trip.vanLocationId))
      .where('pls.tenant_id', '=', tenantId)
      .where(sql<boolean>`pls.qty > 0`)
      .orderBy('p.name', 'asc')
      .execute();

    return {
      trip: {
        ...trip,
        id: Number(trip.id),
        repId: Number(trip.repId),
        startOdometer: Number(trip.startOdometer || 0),
        endOdometer: trip.endOdometer ? Number(trip.endOdometer) : undefined,
        loadedAmount: Number(trip.loadedAmount || 0),
        salesAmount: Number(trip.salesAmount || 0),
        cashCollected: Number(trip.cashCollected || 0),
        creditSales: Number(trip.creditSales || 0),
        returnsAmount: Number(trip.returnsAmount || 0),
        cashRefunds: Number((trip as any).cashRefunds || 0),
        variance: Number(trip.variance || 0),
      },
      pagination: {
        page,
        pageSize,
        salesHasMore: sales.length > pageSize,
        collectionsHasMore: collections.length > pageSize,
        returnsHasMore: returns.length > pageSize,
      },
      sales: sales.slice(0, pageSize).map((s: any) => {
        const custCoords = extractCoordinatesFromCustomerLocation({ metadata: s.customerMetadata });
        const geo = evaluateGeofenceCompliance({
          repLat: s.deliveryGpsLat != null ? Number(s.deliveryGpsLat) : null,
          repLng: s.deliveryGpsLng != null ? Number(s.deliveryGpsLng) : null,
          customerLat: custCoords?.lat ?? null,
          customerLng: custCoords?.lng ?? null,
          maxAllowedMeters: 300,
        });
        const { customerMetadata: _cm, ...rest } = s;
        return {
          ...rest,
          id: Number(s.id),
          total: Number(s.total || 0),
          deliveryGpsLat: s.deliveryGpsLat != null ? Number(s.deliveryGpsLat) : undefined,
          deliveryGpsLng: s.deliveryGpsLng != null ? Number(s.deliveryGpsLng) : undefined,
          distanceMeters: geo.distanceMeters,
          isWithinGeofence: geo.isCompliant,
          geofenceStatus: geo.status,
        };
      }),
      collections: collections.slice(0, pageSize).map((c: any) => {
        const custCoords = extractCoordinatesFromCustomerLocation({ metadata: c.customerMetadata });
        const geo = evaluateGeofenceCompliance({
          repLat: c.gpsLat != null ? Number(c.gpsLat) : null,
          repLng: c.gpsLng != null ? Number(c.gpsLng) : null,
          customerLat: custCoords?.lat ?? null,
          customerLng: custCoords?.lng ?? null,
          maxAllowedMeters: 300,
        });
        const { customerMetadata: _cm, ...rest } = c;
        return {
          ...rest,
          id: Number(c.id),
          amount: Number(c.amount || 0),
          gpsLat: c.gpsLat != null ? Number(c.gpsLat) : undefined,
          gpsLng: c.gpsLng != null ? Number(c.gpsLng) : undefined,
          distanceMeters: geo.distanceMeters,
          isWithinGeofence: geo.isCompliant,
          geofenceStatus: geo.status,
        };
      }),
      returns: returns.slice(0, pageSize).map((r: any) => ({
        ...r,
        id: Number(r.id),
        totalAmount: Number(r.totalAmount || 0),
        refundMethod: r.refundMethod || 'credit',
      })),
      vanStock: vanStock.map((v: any) => ({
        ...v,
        productId: Number(v.productId),
        retailPrice: Number(v.retailPrice || 0),
        qty: Number(v.qty || 0),
      })),
    };
  }
}
