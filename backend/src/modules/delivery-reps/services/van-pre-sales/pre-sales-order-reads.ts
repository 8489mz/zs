import { Kysely } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import type { ListPreSalesOrdersFilters } from './van-pre-sales-types';

export class PreSalesOrderReadsSlice {
  constructor(private readonly db: Kysely<Database>) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Lists Pre-Sales orders booked by reps with comprehensive filters.
   */
  public async listPreSalesOrders(
    tenantId: string,
    filters?: ListPreSalesOrdersFilters,
  ) {
    let qb = this.anyDb
      .selectFrom('sales_orders as so')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'so.rep_id')
      .leftJoin('customers as c', 'c.id', 'so.customer_id')
      .select([
        'so.id',
        'so.order_number as orderNumber',
        'so.customer_id as customerId',
        'so.customer_name as customerName',
        'so.customer_phone as customerPhone',
        'so.customer_address as customerAddress',
        'so.rep_id as repId',
        'dr.full_name as repName',
        'so.warehouse_location_id as warehouseLocationId',
        'so.order_source as orderSource',
        'so.payment_terms as paymentTerms',
        'so.subtotal as subtotalAmount',
        'so.discount_amount as discountAmount',
        'so.total_amount as totalAmount',
        'so.status',
        'so.supervisor_approved_at as supervisorApprovedAt',
        'so.supervisor_approved_by as supervisorApprovedBy',
        'so.supervisor_rejection_reason as supervisorRejectionReason',
        'so.notes',
        'so.created_at as createdAt',
      ])
      .where('so.tenant_id', '=', tenantId)
      .where('so.order_source', '=', 'pre_sales_rep');

    if (filters?.repId) {
      qb = qb.where('so.rep_id', '=', Number(filters.repId));
    }

    if (filters?.customerId) {
      qb = qb.where('so.customer_id', '=', Number(filters.customerId));
    }

    if (filters?.status && filters.status !== 'all') {
      if (filters.status === 'pending_approval' || filters.status === 'pending_supervisor') {
        qb = qb.where('so.status', 'in', ['pending_approval', 'pending_supervisor']);
      } else {
        qb = qb.where('so.status', '=', filters.status);
      }
    }

    if (filters?.dateFrom) {
      qb = qb.where('so.created_at', '>=', new Date(filters.dateFrom));
    }

    if (filters?.dateTo) {
      const endOfDay = new Date(filters.dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      qb = qb.where('so.created_at', '<=', endOfDay);
    }

    if (filters?.search?.trim()) {
      const search = `%${filters.search.trim().toLowerCase()}%`;
      qb = qb.where((eb: any) =>
        eb.or([
          eb('so.order_number', 'ilike', search),
          eb('so.customer_name', 'ilike', search),
          eb('dr.full_name', 'ilike', search),
        ]),
      );
    }

    const limit = filters?.limit ? Math.min(Number(filters.limit), 100) : 50;
    const offset = filters?.offset ? Number(filters.offset) : 0;

    const orders = await qb.orderBy('so.id', 'desc').limit(limit).offset(offset).execute();

    return {
      orders: orders.map((o: any) => ({
        ...o,
        id: Number(o.id),
        subtotalAmount: Number(o.subtotalAmount || 0),
        discountAmount: Number(o.discountAmount || 0),
        totalAmount: Number(o.totalAmount || 0),
      })),
      total: orders.length,
    };
  }

  /**
   * Retrieves full details of a single Pre-Sales order including items and consumer pricing.
   */
  public async getPreSalesOrderDetails(orderId: number, tenantId: string, repId?: number) {
    const order = await this.anyDb
      .selectFrom('sales_orders as so')
      .leftJoin('delivery_representatives as dr', 'dr.id', 'so.rep_id')
      .leftJoin('stock_locations as sl', 'sl.id', 'so.warehouse_location_id')
      .select([
        'so.id',
        'so.order_number as orderNumber',
        'so.customer_id as customerId',
        'so.customer_name as customerName',
        'so.customer_phone as customerPhone',
        'so.customer_address as customerAddress',
        'so.rep_id as repId',
        'dr.full_name as repName',
        'dr.phone as repPhone',
        'so.warehouse_location_id as warehouseLocationId',
        'sl.name as warehouseName',
        'so.order_source as orderSource',
        'so.payment_terms as paymentTerms',
        'so.subtotal as subtotalAmount',
        'so.discount_amount as discountAmount',
        'so.total_amount as totalAmount',
        'so.status',
        'so.supervisor_approved_at as supervisorApprovedAt',
        'so.supervisor_approved_by as supervisorApprovedBy',
        'so.supervisor_rejection_reason as supervisorRejectionReason',
        'so.notes',
        'so.delivery_date as deliveryDate',
        'so.created_at as createdAt',
      ])
      .where('so.id', '=', orderId)
      .where('so.tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('أمر الحجز الميداني غير موجود', 'PRESALE_ORDER_NOT_FOUND', 404);
    }

    // INV-DRIVER-PORTAL-REP-SCOPED-READS: a driver-portal read supplies the
    // calling repId and may only see orders assigned to that rep. An order
    // with no rep (or another rep) is not the caller's. Staff callers pass
    // no repId and keep the unscoped supervisor view.
    if (repId != null && Number((order as any).repId) !== Number(repId)) {
      throw new AppError('غير مصرح لك بالاطلاع على أمر حجز ميداني لمندوب آخر', 'FORBIDDEN', 403);
    }

    const items = await this.anyDb
      .selectFrom('sales_order_items as soi')
      .select([
        'soi.id',
        'soi.product_id as productId',
        'soi.product_name as productName',
        'soi.unit_name as unitName',
        'soi.unit_multiplier as unitMultiplier',
        'soi.quantity',
        'soi.reserved_quantity as reservedQuantity',
        'soi.unit_price as unitPrice',
        'soi.consumer_price as consumerPrice',
        'soi.pricing_tier_type as pricingTierType',
        'soi.unit_offer_savings as unitOfferSavings',
        'soi.discount',
        'soi.total',
      ])
      .where('soi.sales_order_id', '=', orderId)
      .where('soi.tenant_id', '=', tenantId)
      .orderBy('soi.id', 'asc')
      .execute();

    // F18 (trial problem 31): the FE details dialog renders
    // `Number(it.lineTotal)` and the FE item type declares `lineTotal`,
    // so return it alongside `total` (additive, no FE type break);
    // and fall back to `مندوب #<repId>` when dr.full_name is NULL,
    // the same fallback the list row already renders.
    const repName =
      (order as any).repName ||
      ((order as any).repId ? `مندوب #${(order as any).repId}` : '');
    return {
      ...order,
      repName,
      id: Number(order.id),
      subtotalAmount: Number(order.subtotalAmount || 0),
      discountAmount: Number(order.discountAmount || 0),
      totalAmount: Number(order.totalAmount || 0),
      items: items.map((it: any) => ({
        ...it,
        id: Number(it.id),
        productId: Number(it.productId),
        quantity: Number(it.quantity || 0),
        unitMultiplier: Number(it.unitMultiplier || 1),
        unitPrice: Number(it.unitPrice || 0),
        consumerPrice: it.consumerPrice != null ? Number(it.consumerPrice) : null,
        unitOfferSavings: it.unitOfferSavings != null ? Number(it.unitOfferSavings) : 0,
        discount: Number(it.discount || 0),
        total: Number(it.total || 0),
        lineTotal: Number(it.total || 0),
      })),
    };
  }
}
