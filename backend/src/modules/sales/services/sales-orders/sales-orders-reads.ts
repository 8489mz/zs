import { NotFoundException } from '@nestjs/common';
import { type Kysely, sql } from 'kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { getLocationAvailability } from '../../../../common/utils/location-stock-ledger';

export class SalesOrdersReads {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: {
      resolveStoredOrderLocation: (
        order: { warehouse_location_id?: number | null; branch_id?: number | null },
        scope: { tenantId: string; accountId: string },
      ) => Promise<number | null>;
    },
  ) {}

  private resolveStoredOrderLocation(
    order: { warehouse_location_id?: number | null; branch_id?: number | null },
    scope: { tenantId: string; accountId: string },
  ): Promise<number | null> {
    return this.bound.resolveStoredOrderLocation(order, scope);
  }

  async listOrders(
    auth: AuthContext,
    query?: { status?: string; search?: string; limit?: number; offset?: number },
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    let qb = this.db
      .selectFrom('sales_orders')
      .selectAll()
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId);

    if (query?.status && query.status !== 'all') {
      qb = qb.where('status', '=', query.status as any);
    }

    if (query?.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb = qb.where((eb) =>
        eb.or([
          eb('order_number', 'ilike', term),
          eb('customer_name', 'ilike', term),
          eb('customer_phone', 'ilike', term),
        ]),
      );
    }

    const limit = query?.limit ? Math.min(query.limit, 100) : 50;
    const offset = query?.offset || 0;

    const items = await qb.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();

    // Summary counts by status
    const counts = await this.db
      .selectFrom('sales_orders')
      .select(['status', sql<number>`count(*)::int`.as('count')])
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .groupBy('status')
      .execute();

    const statusCounts: Record<string, number> = {
      all: 0,
      draft: 0,
      confirmed: 0,
      converted: 0,
      cancelled: 0,
    };

    counts.forEach((c) => {
      const s = String(c.status);
      statusCounts[s] = Number(c.count);
      statusCounts.all += Number(c.count);
    });

    return {
      orders: items,
      summary: statusCounts,
    };
  }

  async getOrderById(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const order = await this.db
      .selectFrom('sales_orders')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!order) {
      throw new NotFoundException('أمر البيع غير موجود');
    }

    const items = await this.db
      .selectFrom('sales_order_items as soi')
      .leftJoin('products as p', 'p.id', 'soi.product_id')
      .select([
        'soi.id',
        'soi.sales_order_id',
        'soi.product_id',
        'soi.product_name',
        'soi.unit_name',
        'soi.quantity',
        'soi.reserved_quantity',
        'soi.delivered_quantity',
        'soi.unit_price',
        'soi.discount',
        'soi.total',
        'soi.notes',
        sql<number>`COALESCE(p.stock_qty, 0)`.as('current_stock_qty'),
        sql<number>`COALESCE(p.reserved_qty, 0)`.as('current_reserved_qty'),
        sql<number>`COALESCE(p.stock_qty, 0) - COALESCE(p.reserved_qty, 0)`.as('available_qty'),
      ])
      .where('soi.sales_order_id', '=', id)
      .where('soi.tenant_id', '=', scope.tenantId)
      .where('soi.account_id', '=', scope.accountId)
      .orderBy('soi.id', 'asc')
      .execute();

    // INV-SALES-ORDER-WAREHOUSE-SELECTION: available_qty is the
    // availability in THIS order's warehouse (the same number the
    // approval check enforces), not the tenant-global stock. A
    // per-item read failure falls back to the global figure so a
    // missing product can never break the details view.
    const orderLocationId = await this.resolveStoredOrderLocation(order, scope);
    const itemsWithAvailability = [];
    for (const item of items) {
      let availableQty = Number(item.available_qty);
      try {
        const availability = await getLocationAvailability(this.db, {
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          productId: Number(item.product_id),
          locationId: orderLocationId,
          branchId: order.branch_id ? Number(order.branch_id) : null,
        });
        availableQty = availability.availableAtLocation;
      } catch {
        // keep the global figure
      }
      itemsWithAvailability.push({ ...item, available_qty: availableQty });
    }

    return { ...order, items: itemsWithAvailability };
  }
}
