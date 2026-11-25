import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { normalizeCustomerCode, getCustomerRepBalancesMap, getMonthlyOfficialHolidayDates } from '../van-common.util';
import {
  calculateRepTargetMetrics,
  evaluateBatchExpiryStatus,
  extractAssignedRepIds,
  resolveIsolatedRepCustomerBalance,
  getVanRepDiscountCapPercent,
  type RepTargetCalculationResult,
} from '../../rep-target.engine';
import { getTenantTimezone, todayTenantDate } from '../../../../common/utils/tenant-timezone.util';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../../accounting/engines/money-minor-units.engine';
import { type VanTripLifecycleDeps, type VanStockItem, type VanTripSummary } from './van-trip-types';

@Injectable()
export class GetActiveTripService {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly getOrCreateVanLocation: VanTripLifecycleDeps['getOrCreateVanLocation'],
    private readonly listRepServedCustomerIds: VanTripLifecycleDeps['listRepServedCustomerIds'],
    private readonly isSupervisorPinRequiredForSettlement: (tenantId: string) => Promise<boolean>,
    private readonly isBlindSettlementEnabled: (tenantId: string) => Promise<boolean>,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Retrieves active open trip and current car inventory for a delivery representative.
   */
  async getActiveTrip(
    repId: number,
    tenantId: string,
    accountId: string,
  ): Promise<{
    hasActiveTrip: boolean;
    trip?: VanTripSummary;
    assignedVehicle?: {
      id: number;
      plateNumber: string;
      modelName?: string;
      vehicleType: string;
      currentOdometer: number;
      fuelType: string;
      licenseExpiresAt?: string;
      status: string;
    } | null;
    vanLocation?: { id: number; name: string };
    inventory: VanStockItem[];
    customers: {
      id: number;
      name: string;
      phone?: string;
      address?: string;
      balance: number;
      otherRepsBalance?: number;
      totalCompanyBalance?: number;
      creditLimit?: number;
      customerCode?: string;
      route?: string;
      assignedRepIds?: number[];
      locationUrl?: string;
    }[];
    recentSales: any[];
    sales?: any[];
    collections?: any[];
    returns?: any[];
    swaps?: any[];
    targetMetrics?: RepTargetCalculationResult;
    requireSupervisorPinForSettlement?: boolean;
    isBlindSettlement?: boolean;
    // INV-VAN-OFFLINE-TIMESTAMPS: the server clock anchor for the
    // van page (useServerClock) — the receipt date and every
    // displayed date derive from this, never the device clock.
    serverTime: string;
    serverTimezone: string;
    // INV-VAN-REP-DISCOUNT-CAP-TENANT-SETTING: the tenant rep
    // discount cap %, resolved once per active-trip load so the
    // checkout gates on the same value the server enforces.
    discountCapPercent: number;
  }> {
    const requireSupervisorPinForSettlement = await this.isSupervisorPinRequiredForSettlement(tenantId);
    const isBlindSettlement = await this.isBlindSettlementEnabled(tenantId);
    const serverTimezone = await getTenantTimezone(this.anyDb, tenantId);
    const serverTime = new Date().toISOString();
    const discountCapPercent = await getVanRepDiscountCapPercent(this.anyDb, tenantId);
    const vanLoc = await this.getOrCreateVanLocation(repId, tenantId, accountId);

    const assignedVehicleRow = await this.anyDb
      .selectFrom('fleet_vehicles')
      .select([
        'id',
        'plate_number as plateNumber',
        'model_name as modelName',
        'vehicle_type as vehicleType',
        sql<number>`cast(coalesce(current_odometer, 0) as numeric)`.as('currentOdometer'),
        'fuel_type as fuelType',
        'license_expires_at as licenseExpiresAt',
        'status',
      ])
      .where('tenant_id', '=', tenantId)
      .where((eb: any) => eb.or([eb('assigned_rep_id', '=', repId), eb('van_location_id', '=', vanLoc.id)]))
      .orderBy('id', 'desc')
      .executeTakeFirst();

    const assignedVehicle = assignedVehicleRow
      ? {
          id: Number(assignedVehicleRow.id),
          plateNumber: String(assignedVehicleRow.plateNumber || ''),
          modelName: assignedVehicleRow.modelName || '',
          vehicleType: assignedVehicleRow.vehicleType || 'van',
          currentOdometer: Number(assignedVehicleRow.currentOdometer || 0),
          fuelType: assignedVehicleRow.fuelType || 'petrol_92',
          licenseExpiresAt: assignedVehicleRow.licenseExpiresAt
            ? String(assignedVehicleRow.licenseExpiresAt)
            : undefined,
          status: String(assignedVehicleRow.status || 'assigned'),
        }
      : null;

    const tripRow = await this.anyDb
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
        sql<number>`cast(coalesce(vt.start_odometer, fv.current_odometer, 0) as numeric)`.as('startOdometer'),
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
        sql<number>`cast(coalesce(vt.total_instapay_sales, 0) as numeric)`.as('totalInstapaySales'),
        sql<number>`cast(coalesce(vt.total_instapay_collections, 0) as numeric)`.as('totalInstapayCollections'),
        'vt.night_stock_approved as nightStockApproved',
        'vt.notes',
      ])
      .where('vt.rep_id', '=', repId)
      .where('vt.tenant_id', '=', tenantId)
      .where('vt.status', '=', 'open')
      .orderBy('vt.id', 'desc')
      .executeTakeFirst();

    // Fetch current inventory in the Van
    const invRows = await this.anyDb
      .selectFrom('product_location_stock as pls')
      .innerJoin('products as p', 'p.id', 'pls.product_id')
      .leftJoin('product_units as pu', (join: any) =>
        join.onRef('pu.product_id', '=', 'p.id').on('pu.multiplier', '>', 1),
      )
      .select([
        'p.id as productId',
        'p.name as productName',
        'p.barcode',
        'p.metadata as productMetadata',
        sql<number>`cast(coalesce(pls.qty, 0) as numeric)`.as('qty'),
        sql<number>`cast(coalesce(p.cost_price, 0) as numeric)`.as('costPrice'),
        sql<number>`cast(coalesce(p.retail_price, 0) as numeric)`.as('retailPrice'),
        sql<number>`cast(coalesce(p.wholesale_price, 0) as numeric)`.as('wholesalePrice'),
        'pu.name as unitName',
      ])
      .where('pls.location_id', '=', vanLoc.id)
      .where('pls.tenant_id', '=', tenantId)
      .where(sql<boolean>`cast(pls.qty as numeric) > 0`)
      .orderBy('p.name', 'asc')
      .execute();

    // Determine source warehouse to query main stock
    let sourceWarehouseId = tripRow?.sourceWarehouseId ? Number(tripRow.sourceWarehouseId) : null;
    if (!sourceWarehouseId) {
      const defaultWh = await this.anyDb
        .selectFrom('stock_locations')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .where(sql<boolean>`location_type in ('branch_stock', 'internal_warehouse')`)
        .where('is_active', '=', true)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      if (defaultWh) sourceWarehouseId = Number(defaultWh.id);
    }

    const mainStockMap = new Map<number, number>();
    if (sourceWarehouseId) {
      const sourceStocks = await this.anyDb
        .selectFrom('product_location_stock')
        .select(['product_id', sql<number>`cast(coalesce(qty, 0) as numeric)`.as('qty')])
        .where('location_id', '=', sourceWarehouseId)
        .where('tenant_id', '=', tenantId)
        .execute();
      for (const s of sourceStocks) {
        mainStockMap.set(Number(s.product_id), Number(s.qty || 0));
      }
    }

    // Query active promotional offers for van inventory items
    const prodIds = invRows.map((r: any) => Number(r.productId)).filter((id: number) => id > 0);
    // Offer windows use the TENANT day (P7, single-server-clock
    // rule): the same clock the sale writers use, so the inventory
    // fetch agrees with the writer instead of sampling host-local.
    const todayIso = todayTenantDate(await getTenantTimezone(this.anyDb, tenantId));
    const activeOffers =
      prodIds.length > 0
        ? await this.anyDb
            .selectFrom('product_offers')
            .select([
              'id',
              'product_id',
              'offer_type',
              'value',
              'start_date',
              'end_date',
              'min_qty',
              'bogo_buy_qty',
              'bogo_get_qty',
              'bogo_discount_percent',
            ])
            .where('product_id', 'in', prodIds)
            .where('tenant_id', '=', tenantId)
            .where('is_active', '=', true)
            .where((eb: any) =>
              eb.and([
                eb.or([eb('start_date', 'is', null), eb('start_date', '<=', todayIso)]),
                eb.or([eb('end_date', 'is', null), eb('end_date', '>=', todayIso)]),
              ]),
            )
            .orderBy('id', 'desc')
            .execute()
        : [];

    const offersByProdId = new Map<number, any>();
    for (const off of activeOffers) {
      const pid = Number(off.product_id);
      if (!offersByProdId.has(pid)) {
        offersByProdId.set(pid, off);
      }
    }

    // Query product units and FEFO batches for van inventory items
    const [rawUnits, batchRows] =
      prodIds.length > 0
        ? await Promise.all([
            this.anyDb
              .selectFrom('product_units')
              .select(['id', 'product_id', 'name', 'multiplier', 'is_base_unit'])
              .where('product_id', 'in', prodIds)
              .orderBy('multiplier', 'asc')
              .execute(),
            this.anyDb
              .selectFrom('pharmacy_batches')
              .select(['product_id', 'batch_number', 'expiry_date', 'quantity'])
              .where('tenant_id', '=', tenantId)
              .where('product_id', 'in', prodIds)
              .where(sql<boolean>`cast(coalesce(quantity, 0) as numeric) > 0`)
              .orderBy('expiry_date', 'asc')
              .execute()
              .catch(() => []),
          ])
        : [[], []];

    const fefoBatchByProdId = new Map<number, { batchNumber: string | null; expiryDate: string }>();
    for (const b of batchRows || []) {
      const pid = Number(b.product_id);
      if (!pid || !b.expiry_date) continue;
      if (!fefoBatchByProdId.has(pid)) {
        fefoBatchByProdId.set(pid, {
          batchNumber: b.batch_number ? String(b.batch_number) : null,
          expiryDate: String(b.expiry_date),
        });
      }
    }

    const unitsByProdId = new Map<number, any[]>();
    for (const u of rawUnits) {
      const pid = Number(u.product_id);
      if (!unitsByProdId.has(pid)) unitsByProdId.set(pid, []);
      unitsByProdId.get(pid)!.push({
        id: Number(u.id),
        name: u.name,
        multiplier: Number(u.multiplier || 1),
        isBase: Boolean(u.is_base_unit) || Number(u.multiplier) === 1,
      });
    }

    // Book digits resolved once (D4): the offer prices below round
    // at book digits, never a hardcoded 2dp.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const nowRef = new Date();
    const inventory: VanStockItem[] = invRows.map((r: any) => {
      const pid = Number(r.productId);
      const baseRetail = Number(r.retailPrice || 0);
      const offer = offersByProdId.get(pid);
      const availUnits = unitsByProdId.get(pid) || [];
      const packUnitObj = availUnits.find((u) => u.multiplier > 1);
      let effectiveRetail = baseRetail;
      let discountPerUnit = 0;
      let offerBadge: string | undefined;

      if (offer) {
        const offVal = Number(offer.value || 0);
        if (offer.offer_type === 'percent' && offVal > 0) {
          discountPerUnit = roundMoney((baseRetail * offVal) / 100, moneyDigits);
          effectiveRetail = Math.max(0, roundMoney(baseRetail - discountPerUnit, moneyDigits));
          offerBadge = `خصم ${offVal}%`;
        } else if (offer.offer_type === 'fixed' && offVal > 0) {
          discountPerUnit = Math.min(baseRetail, offVal);
          effectiveRetail = Math.max(0, roundMoney(baseRetail - discountPerUnit, moneyDigits));
          offerBadge = `خصم ${offVal} ج.م`;
        } else if (offer.offer_type === 'price' && offVal > 0) {
          effectiveRetail = offVal;
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge = `سعر عرض خاص`;
        } else if (offer.offer_type === 'bundle' && offVal > 0) {
          const minQ = Math.max(1, Number(offer.min_qty || 1));
          effectiveRetail = roundMoney(offVal / minQ, moneyDigits);
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge = `باقة ${minQ} قطع بسعر ${offVal}`;
        } else if (offer.offer_type === 'bogo') {
          const buyQ = Number(offer.bogo_buy_qty || 1);
          const getQ = Number(offer.bogo_get_qty || 1);
          const discPct = Number(offer.bogo_discount_percent ?? 100);
          const cycle = buyQ + getQ;
          const fullDisc = getQ * baseRetail * (discPct / 100);
          effectiveRetail = roundMoney(Math.max(0, cycle * baseRetail - fullDisc) / cycle, moneyDigits);
          discountPerUnit = Math.max(0, roundMoney(baseRetail - effectiveRetail, moneyDigits));
          offerBadge =
            discPct === 100 ? `اشتري ${buyQ} واحصل على ${getQ} مجاناً` : `اشتري ${buyQ} و${getQ} بخصم ${discPct}%`;
        }
      }

      let metaObj: any = null;
      if (r.productMetadata) {
        if (typeof r.productMetadata === 'string') {
          try {
            metaObj = JSON.parse(r.productMetadata);
          } catch {
            metaObj = null;
          }
        } else if (typeof r.productMetadata === 'object') {
          metaObj = r.productMetadata;
        }
      }
      const fefoBatch = fefoBatchByProdId.get(pid);
      const rawExpiry = fefoBatch?.expiryDate || metaObj?.expiry_date || metaObj?.expiryDate || null;
      const rawBatchNo = fefoBatch?.batchNumber || metaObj?.batch_number || metaObj?.batchNumber || null;
      const expiryInfo = evaluateBatchExpiryStatus(rawExpiry, nowRef, 60);

      return {
        productId: pid,
        productName: r.productName || `صنف #${pid}`,
        barcode: r.barcode || '',
        qty: Number(r.qty || 0),
        mainWarehouseQty: mainStockMap.get(pid) || 0,
        costPrice: Number(r.costPrice || 0),
        retailPrice: effectiveRetail,
        // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: raw wholesale price for
        // the rep cart (same exposure as the already-exposed costPrice);
        // the writer re-derives the authoritative price server-side.
        wholesalePrice: Number(r.wholesalePrice || 0),
        originalPrice: offer && discountPerUnit > 0 ? baseRetail : undefined,
        discountPerUnit: discountPerUnit > 0 ? discountPerUnit : undefined,
        hasActiveOffer: Boolean(offer && discountPerUnit > 0),
        offerBadge,
        unitName: r.unitName || 'قطعة',
        // INV-VAN-PIECE-COUNT-BASIS: qty is in BASE units
        // (product_location_stock.qty is pieces), so the stock balance
        // is labeled with the base unit name — not the packaging name.
        // unitName stays the packaging name for the cart/picker, which
        // legitimately sells in cartons.
        stockUnitName: availUnits.find((u) => u.isBase)?.name || 'قطعة',
        packagingUnit: packUnitObj ? { name: packUnitObj.name, multiplier: packUnitObj.multiplier } : undefined,
        availableUnits: availUnits.length > 0 ? availUnits : undefined,
        earliestExpiryDate: expiryInfo.earliestExpiryDate,
        batchNumber: rawBatchNo ? String(rawBatchNo) : null,
        expiryStatus: expiryInfo.status,
        daysToExpiry: expiryInfo.daysRemaining,
      };
    });

    // Fetch route customers with per-rep isolated debt balances.
    // INV-REP-SCOPED-CUSTOMER-READS (H7/D1): the trip row is rep-scoped
    // but this list was not — it returned every active tenant customer.
    // A rep now sees only his own customers: explicitly assigned
    // (assigned_rep_ids in the customer metadata) plus served (a field
    // visit, a pre-sale order, or a delivered sale — the same served
    // definition as assertRepServedCustomer). Another rep's customers
    // and unassigned customers are excluded, with the same per-customer
    // field shape as before.
    const customerRows = await this.anyDb
      .selectFrom('customers as c')
      .select([
        'c.id',
        'c.name',
        'c.phone',
        'c.address',
        'c.metadata',
        'c.customer_type',
        sql<number>`cast(coalesce(c.credit_limit, 0) as numeric)`.as('creditLimit'),
        sql<number>`coalesce(c.balance, 0)`.as('balance'),
      ])
      .where('c.tenant_id', '=', tenantId)
      .where('c.is_active', '=', true)
      .orderBy('c.name', 'asc')
      .limit(2500)
      .execute();

    const servedCustomerIds = await this.listRepServedCustomerIds(tenantId, Number(repId));
    const scopedCustomerRows = customerRows.filter((c: any) => {
      const cid = Number(c.id);
      return extractAssignedRepIds(c.metadata).includes(Number(repId)) || servedCustomerIds.has(cid);
    });

    const customerIds: number[] = [];
    const customerTotalBalances: Record<number, number> = {};
    for (const c of scopedCustomerRows) {
      const cid = Number(c.id);
      customerIds.push(cid);
      customerTotalBalances[cid] = Number(c.balance || 0);
    }

    const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
      customerIds,
      customerTotalBalances,
      moneyDigits,
    });

    const customers = scopedCustomerRows.map((c: any) => {
      const cid = Number(c.id);
      let meta: any = {};
      if (typeof c.metadata === 'string') {
        try {
          meta = JSON.parse(c.metadata);
        } catch {
          meta = {};
        }
      } else if (c.metadata && typeof c.metadata === 'object') {
        meta = c.metadata;
      }
      const assignedRepIds = extractAssignedRepIds(meta);
      const isolated = resolveIsolatedRepCustomerBalance({
        repId: Number(repId),
        breakdown: repBalancesMap.get(cid),
        assignedRepIds,
        fallbackTotalBalance: Number(c.balance || 0),
        moneyDigits,
      });
      return {
        id: cid,
        name: c.name || `عميل #${cid}`,
        phone: c.phone || '',
        address: c.address || '',
        balance: isolated.repBalance,
        otherRepsBalance: isolated.otherRepsBalance,
        totalCompanyBalance: isolated.totalCustomerBalance,
        creditLimit: Number(c.creditLimit || 0),
        customerCode: normalizeCustomerCode(meta.customer_code || meta.code, cid),
        route: meta.route || '',
        // INV-VAN-FIELD-SALE-WHOLESALE-PRICE: the rep cart prices by
        // customer type, so the type rides the trip customers payload.
        customer_type: (c as any).customer_type || 'cash',
        assignedRepIds,
        locationUrl:
          meta.location_url ||
          (meta.gps_lat && meta.gps_lng ? `https://maps.google.com/?q=${meta.gps_lat},${meta.gps_lng}` : ''),
      };
    });

    // Fetch sales, collections and returns on this trip
    let recentSales: any[] = [];
    let tripCollections: any[] = [];
    let tripReturns: any[] = [];
    let tripSwaps: any[] = [];
    if (tripRow?.id) {
      const rawSales = await this.anyDb
        .selectFrom('sales as s')
        .leftJoin('customers as c', 'c.id', 's.customer_id')
        .select([
          's.id',
          's.doc_no as docNo',
          sql<number>`cast(s.total as double precision)`.as('total'),
          sql<number>`cast(coalesce(s.subtotal, s.total) as double precision)`.as('subtotal'),
          sql<number>`cast(coalesce(s.discount, 0) as double precision)`.as('discount'),
          's.payment_type as paymentMethod',
          's.created_at as createdAt',
          'c.name as customerName',
        ])
        .where('s.tenant_id', '=', tenantId)
        .where(sql<boolean>`s.van_trip_id = ${Number(tripRow.id)}`)
        .orderBy('s.id', 'desc')
        .limit(100)
        .execute();

      recentSales = rawSales.map((s: any) => ({
        ...s,
        id: Number(s.id),
        total: Number(s.total || 0),
        subtotal: Number(s.subtotal || s.total || 0),
        discount: Number(s.discount || 0),
      }));

      tripCollections = await this.anyDb
        .selectFrom('customer_ledger as cl')
        .leftJoin('customers as c', 'c.id', 'cl.customer_id')
        .select([
          'cl.id',
          sql<number>`cast(abs(coalesce(cl.amount, 0)) as numeric)`.as('amount'),
          'cl.created_at as createdAt',
          sql<string>`coalesce(c.name, 'عميل')`.as('customerName'),
          'cl.note',
          sql<number>`cast(cl.gps_lat as double precision)`.as('gpsLat'),
          sql<number>`cast(cl.gps_lng as double precision)`.as('gpsLng'),
        ])
        .where('cl.tenant_id', '=', tenantId)
        .where(sql<boolean>`cl.van_trip_id = ${Number(tripRow.id)}`)
        .where('cl.entry_type', '=', 'payment')
        .orderBy('cl.id', 'desc')
        .execute();

      tripReturns = await this.anyDb
        .selectFrom('van_field_returns as vfr')
        .leftJoin('customers as c', 'c.id', 'vfr.customer_id')
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
        .where(sql<boolean>`vfr.trip_id = ${Number(tripRow.id)}`)
        .orderBy('vfr.id', 'desc')
        .execute();

      tripSwaps = await this.anyDb
        .selectFrom('van_damaged_swaps as vds')
        .leftJoin('products as dp', 'dp.id', 'vds.damaged_product_id')
        .leftJoin('products as rp', 'rp.id', 'vds.replacement_product_id')
        .leftJoin('customers as c', 'c.id', 'vds.customer_id')
        .select([
          'vds.id',
          'vds.damaged_product_id as damagedProductId',
          sql<string>`coalesce(dp.name, 'صنف تالف')`.as('damagedProductName'),
          sql<number>`cast(vds.damaged_qty as numeric)`.as('damagedQty'),
          'vds.damage_reason as damageReason',
          'vds.replacement_product_id as replacementProductId',
          sql<string>`coalesce(rp.name, 'صنف بديل')`.as('replacementProductName'),
          sql<number>`cast(vds.replacement_qty as numeric)`.as('replacementQty'),
          sql<number>`cast(vds.price_difference as numeric)`.as('priceDifference'),
          'vds.notes',
          'vds.created_at as createdAt',
          sql<string>`coalesce(c.name, '')`.as('customerName'),
        ])
        .where('vds.tenant_id', '=', tenantId)
        .where(sql<boolean>`vds.trip_id = ${Number(tripRow.id)}`)
        .orderBy('vds.id', 'desc')
        .execute();
    }

    // Calculate Monthly Sales Target for this representative
    const now = new Date();
    const currentPeriodMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);

    const targetRow = await this.anyDb
      .selectFrom('delivery_rep_targets')
      .select(['target_amount', 'collection_target', 'visits_target'])
      .where('rep_id', '=', repId)
      .where('period_month', '=', currentPeriodMonth)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    const targetAmount = Number(targetRow?.target_amount || 0);
    const collectionTarget =
      targetRow?.collection_target !== null && targetRow?.collection_target !== undefined
        ? Number(targetRow.collection_target)
        : null;
    const visitsTarget =
      targetRow?.visits_target !== null && targetRow?.visits_target !== undefined
        ? Number(targetRow.visits_target)
        : null;

    const salesMtdRow = await this.anyDb
      .selectFrom('sales')
      .select([sql<number>`coalesce(sum(cast(total as numeric)), 0)`.as('total_mtd')])
      .where('delivery_rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'posted')
      .where('created_at', '>=', startOfMonth)
      .where('created_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualSalesMtd = Number(salesMtdRow?.total_mtd || 0);

    const collectionsMtdRow = await this.anyDb
      .selectFrom('van_sales_trips')
      .select([sql<number>`coalesce(sum(cast(cash_collected as numeric)), 0)`.as('total_collected')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('opened_at', '>=', startOfMonth)
      .where('opened_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualCollectionsMtd = Number(collectionsMtdRow?.total_collected || 0);

    const visitsMtdRow = await this.anyDb
      .selectFrom('van_field_visits')
      .select([sql<number>`count(*)`.as('total_visits')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('visited_at', '>=', startOfMonth)
      .where('visited_at', '<=', endOfMonth)
      .executeTakeFirst();
    const actualVisitsMtd = Number(visitsMtdRow?.total_visits || 0);

    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);

    const todayVisitsRow = await this.anyDb
      .selectFrom('van_field_visits')
      .select([sql<number>`count(*)`.as('today_visits')])
      .where('rep_id', '=', repId)
      .where('tenant_id', '=', tenantId)
      .where('visited_at', '>=', startOfToday)
      .where('visited_at', '<=', endOfToday)
      .executeTakeFirst();
    const todayVisits = Number(todayVisitsRow?.today_visits || 0);

    const officialHolidays = await getMonthlyOfficialHolidayDates(this.anyDb, tenantId, startOfMonth, endOfMonth);

    const metricsMoneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const baseMetrics = calculateRepTargetMetrics({
      targetAmount,
      actualSalesMTD: actualSalesMtd,
      collectionTarget,
      actualCollectionsMTD: actualCollectionsMtd,
      visitsTarget,
      actualVisitsMTD: actualVisitsMtd,
      currentDate: now,
      weekendDays: [5], // Friday
      officialHolidays,
      moneyDigits: metricsMoneyDigits,
    });

    const todaySales = Number(tripRow?.salesAmount || 0);
    const todayCollections = Number(tripRow?.cashCollected || 0);

    const targetMetrics = {
      ...baseMetrics,
      todaySales,
      todayCollections,
      todayVisits,
    };

    if (!tripRow) {
      return {
        hasActiveTrip: false,
        assignedVehicle,
        vanLocation: vanLoc,
        inventory,
        customers,
        recentSales: [],
        targetMetrics,
        requireSupervisorPinForSettlement,
        isBlindSettlement,
        serverTime,
        serverTimezone,
        discountCapPercent,
      };
    }

    const trip: VanTripSummary = {
      id: Number(tripRow.id),
      repId: Number(tripRow.repId),
      repName: tripRow.repName,
      vehicleId: tripRow.vehicleId ? Number(tripRow.vehicleId) : assignedVehicle ? assignedVehicle.id : undefined,
      vehiclePlate: tripRow.vehiclePlate || assignedVehicle?.plateNumber,
      vehicleModel: tripRow.vehicleModel || assignedVehicle?.modelName,
      startOdometer: Number(tripRow.startOdometer || assignedVehicle?.currentOdometer || 0),
      endOdometer: Number(tripRow.endOdometer || 0),
      vanLocationId: Number(tripRow.vanLocationId),
      vanLocationName: tripRow.vanLocationName,
      sourceWarehouseId: Number(tripRow.sourceWarehouseId),
      sourceWarehouseName: tripRow.sourceWarehouseName,
      status: tripRow.status as any,
      openedAt: String(tripRow.openedAt),
      closedAt: tripRow.closedAt ? String(tripRow.closedAt) : undefined,
      loadedAmount: Number(tripRow.loadedAmount || 0),
      salesAmount: Number(tripRow.salesAmount || 0),
      cashCollected: Number(tripRow.cashCollected || 0),
      creditSales: Number(tripRow.creditSales || 0),
      returnsAmount: Number(tripRow.returnsAmount || 0),
      cashRefunds: Number((tripRow as any).cashRefunds || 0),
      totalInstapaySales: Number((tripRow as any).totalInstapaySales || 0),
      totalInstapayCollections: Number((tripRow as any).totalInstapayCollections || 0),
      variance: Number(tripRow.variance || 0),
      notes: tripRow.notes || '',
    };

    return {
      hasActiveTrip: true,
      trip,
      assignedVehicle,
      vanLocation: vanLoc,
      inventory,
      customers,
      recentSales,
      sales: recentSales,
      collections: tripCollections,
      returns: tripReturns,
      swaps: tripSwaps,
      targetMetrics,
      requireSupervisorPinForSettlement,
      isBlindSettlement,
      serverTime,
      serverTimezone,
      discountCapPercent,
    };
  }
}
