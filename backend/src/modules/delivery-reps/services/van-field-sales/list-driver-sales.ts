import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { discountedSaleSql } from '../../../../common/utils/sales-discount-filter.helper';
import { normalizeCustomerCode } from '../van-common.util';
import type { ListDriverSalesFilters } from './van-field-sales-types';

export class ListDriverSalesSlice {
  constructor(private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db;
  }

  /**
   * Lists field sales executed by or assigned to a delivery representative,
   * supporting filtering by date scope, customer, payment method, or search query.
   * Includes line items for seamless reprinting on thermal receipts or sharing.
   */
  async listDriverSales(tenantId: string, repId: number, filters?: ListDriverSalesFilters) {
    let query = this.anyDb
      .selectFrom('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .leftJoin('delivery_representatives as dr', 'dr.id', 's.delivery_rep_id')
      .leftJoin('van_sales_trips as vt', 'vt.id', 's.van_trip_id')
      .leftJoin('fleet_vehicles as fv', 'fv.id', 'vt.vehicle_id')
      .select([
        's.id',
        's.doc_no as docNo',
        sql<number>`cast(s.total as numeric)`.as('total'),
        sql<number>`cast(coalesce(s.subtotal, s.total) as numeric)`.as('subtotal'),
        sql<number>`cast(coalesce(s.discount, 0) as numeric)`.as('discount'),
        's.payment_type as paymentMethod',
        's.payment_channel as paymentChannel',
        's.created_at as createdAt',
        's.packaging_breakdown as packagingBreakdown',
        's.delivery_proof_photo as deliveryProofPhoto',
        's.customer_id as customerId',
        'c.name as customerName',
        'c.phone as customerPhone',
        sql<string | null>`null`.as('customerCode'),
        'c.address as customerAddress',
        sql<string>`coalesce(dr.name, '')`.as('repName'),
        sql<string>`coalesce(fv.plate_number, dr.vehicle_plate, '')`.as('vehiclePlate'),
        'vt.id as tripId',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where((eb: any) => eb.or([eb('s.delivery_rep_id', '=', repId), eb('vt.rep_id', '=', repId)]));

    if (filters?.customerId) {
      query = query.where('s.customer_id', '=', filters.customerId);
    }

    if (filters?.paymentMethod && filters.paymentMethod !== 'all') {
      query = query.where('s.payment_type', '=', filters.paymentMethod);
    }

    if (filters?.tripId) {
      query = query.where('s.van_trip_id', '=', filters.tripId);
    }

    // INV-VAN-PROFIT-REP-REPORTING: discounted-invoices-only — the
    // shared predicate (invoice discount OR any line discount).
    if (filters?.discountedOnly) {
      query = query.where(discountedSaleSql('s'));
    }

    if (filters?.search && filters.search.trim()) {
      const q = `%${filters.search.trim()}%`;
      query = query.where((eb: any) =>
        eb.or([eb('s.doc_no', 'ilike', q), eb('c.name', 'ilike', q), eb('c.phone', 'ilike', q)]),
      );
    }

    if (filters?.dateScope && filters.dateScope !== 'all') {
      const now = new Date();
      if (filters.dateScope === 'today') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfToday);
      } else if (filters.dateScope === 'yesterday') {
        const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0);
        const startOfYesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfYesterday).where('s.created_at', '<', startOfToday);
      } else if (filters.dateScope === 'week') {
        const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7, 0, 0, 0);
        query = query.where('s.created_at', '>=', startOfWeek);
      }
    }

    const maxLimit = Math.min(Number(filters?.limit || 100), 200);
    const rows = await query.orderBy('s.id', 'desc').limit(maxLimit).execute();

    if (!rows.length) {
      return [];
    }

    const saleIds = rows.map((r: any) => Number(r.id));
    const items = await this.anyDb
      .selectFrom('sale_items as si')
      .select([
        'si.sale_id as saleId',
        'si.product_id as productId',
        'si.product_name as name',
        sql<number>`cast(si.qty as numeric)`.as('qty'),
        sql<number>`cast(si.unit_price as numeric)`.as('unitPrice'),
        sql<number>`cast(si.line_total as numeric)`.as('lineTotal'),
        // INV-VAN-PIECE-COUNT-BASIS: the history fallback counts
        // pieces as qty x unitMultiplier, so the multiplier must be
        // carried with the item (sale_items.qty is in sale units).
        sql<number>`cast(coalesce(si.unit_multiplier, 1) as numeric)`.as('unitMultiplier'),
        sql<number>`cast(si.consumer_price as numeric)`.as('consumerPrice'),
        'si.pricing_tier_type as pricingTierType',
        sql<number>`cast(si.unit_offer_savings as numeric)`.as('unitOfferSavings'),
      ])
      .where('si.tenant_id', '=', tenantId)
      .where('si.sale_id', 'in', saleIds)
      .orderBy('si.id', 'asc')
      .execute();

    const itemsBySaleId = new Map<number, any[]>();
    for (const item of items) {
      const sId = Number(item.saleId);
      if (!itemsBySaleId.has(sId)) {
        itemsBySaleId.set(sId, []);
      }
      itemsBySaleId.get(sId)!.push({
        productId: Number(item.productId),
        name: item.name,
        qty: Number(item.qty),
        unitPrice: Number(item.unitPrice),
        lineTotal: Number(item.lineTotal),
        consumerPrice: item.consumerPrice != null ? Number(item.consumerPrice) : null,
        pricingTierType: item.pricingTierType || null,
        unitOfferSavings: item.unitOfferSavings != null ? Number(item.unitOfferSavings) : 0,
      });
    }

    return rows.map((r: any) => {
      let packagingBreakdown = null;
      if (r.packagingBreakdown) {
        try {
          packagingBreakdown =
            typeof r.packagingBreakdown === 'string' ? JSON.parse(r.packagingBreakdown) : r.packagingBreakdown;
        } catch {}
      }

      const saleItems = itemsBySaleId.get(Number(r.id)) || [];

      return {
        id: Number(r.id),
        docNo: r.docNo,
        total: Number(r.total),
        subtotal: Number(r.subtotal),
        discount: Number(r.discount),
        paymentMethod: r.paymentMethod || 'cash',
        createdAt: r.createdAt,
        packagingBreakdown,
        deliveryProofPhoto: r.deliveryProofPhoto || null,
        customerId: r.customerId ? Number(r.customerId) : null,
        customerName: r.customerName || 'عميل نقدي',
        customerPhone: r.customerPhone || null,
        customerCode: r.customerId ? normalizeCustomerCode(r.customerCode, r.customerId) : null,
        customerAddress: r.customerAddress || null,
        repName: r.repName || 'مندوب التوزيع',
        vehiclePlate: r.vehiclePlate || null,
        tripId: r.tripId ? Number(r.tripId) : null,
        itemsCount: saleItems.length,
        items: saleItems,
      };
    });
  }
}
