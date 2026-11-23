import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { reserveLocationStock, releaseLocationStock } from '../../../../common/utils/location-stock-ledger';

export class SalesOrdersConfirmation {
  constructor(private readonly db: Kysely<Database>, private readonly bound: { loadServiceProductIds: (trx: Kysely<Database>, scope: { tenantId: string; accountId: string }, productIds: number[]) => Promise<Set<number>> }) {}

  private loadServiceProductIds(trx: Kysely<Database>, scope: { tenantId: string; accountId: string }, productIds: number[]): Promise<Set<number>> {
    return this.bound.loadServiceProductIds(trx, scope, productIds);
  }

  async confirmAndReserve(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);

    // INV-CONVERSION-LIFECYCLE-RACES: the order row AND its items are
    // read inside one transaction under a FOR UPDATE row lock. The
    // old code read both outside any transaction, so two concurrent
    // confirms both saw 'draft' with reserved_quantity 0, both
    // reserved the full quantity, and both set 'confirmed' — a
    // double reservation. The second confirmer now blocks on the
    // lock, then reads 'confirmed' and returns the already-reserved
    // answer without touching stock. (cancelOrder already used
    // this lock-first shape; confirm is now the same.)
    return this.db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom('sales_orders')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .forUpdate()
        .executeTakeFirst();

      if (!order) {
        throw new NotFoundException('أمر البيع غير موجود');
      }

      if (order.status === 'confirmed') {
        return { ok: true, message: 'أمر البيع مؤكد والمخزون محجوز بالفعل' };
      }

      if (order.status !== 'draft') {
        throw new BadRequestException('التأكيد مسموح فقط لأوامر البيع المسودة غير الملغاة');
      }

      const items = await trx
        .selectFrom('sales_order_items')
        .selectAll()
        .where('sales_order_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .execute();

      if (items.length === 0) {
        throw new BadRequestException('أمر البيع لا يحتوي على بنود');
      }

      // Resolve branch and location.
      // INV-SALES-ORDER-WAREHOUSE-SELECTION: the warehouse stored on
      // the order (chosen on the form) wins — approval validates and
      // reserves in the SELECTED warehouse. The branch default
      // applies only when the order carries no warehouse.
      let branchId = order.branch_id;
      let locationId: number | null = null;
      if (order.warehouse_location_id) {
        locationId = Number(order.warehouse_location_id);
      } else if (!branchId) {
        const primaryBranch = await trx
          .selectFrom('branches')
          .select(['id', 'default_stock_location_id'])
          .where('tenant_id', '=', scope.tenantId)
          .orderBy('id', 'asc')
          .executeTakeFirst();
        branchId = primaryBranch ? Number(primaryBranch.id) : 1;
        locationId = primaryBranch?.default_stock_location_id ? Number(primaryBranch.default_stock_location_id) : null;
      } else {
        const branchRow = await trx
          .selectFrom('branches')
          .select(['id', 'default_stock_location_id'])
          .where('id', '=', branchId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        locationId = branchRow?.default_stock_location_id ? Number(branchRow.default_stock_location_id) : null;
      }

      // INV-SERVICE-STOCK-NO-STOCK-CHECK: service lines reserve nothing
      // (see createOrder) — skip both the ledger reservation and the
      // reserved_quantity stamp for them.
      const serviceProductIds = await this.loadServiceProductIds(trx, scope, items.map((item) => Number(item.product_id)));
      const reserveItems: Array<{ productId: number; qty: number }> = [];
      for (const item of items) {
        if (serviceProductIds.has(Number(item.product_id))) continue;
        const qtyToReserve = Number(item.quantity) - Number(item.reserved_quantity || 0);
        if (qtyToReserve > 0) {
          reserveItems.push({
            productId: Number(item.product_id),
            qty: qtyToReserve,
          });

          await trx
            .updateTable('sales_order_items')
            .set({ reserved_quantity: Number(item.quantity) })
            .where('id', '=', Number(item.id))
            .where('tenant_id', '=', scope.tenantId)
            .execute();
        }
      }

      if (reserveItems.length > 0) {
        await reserveLocationStock(trx, {
          branchId,
          locationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          items: reserveItems,
        });
      }

      await trx
        .updateTable('sales_orders')
        .set({
          status: 'confirmed',
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      return { ok: true, message: 'تم تأكيد أمر البيع وحجز المخزون بنجاح' };
    });
  }

  async cancelOrder(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);

    return this.db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom('sales_orders')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .forUpdate()
        .executeTakeFirst();

      if (!order) {
        throw new NotFoundException('أمر البيع غير موجود');
      }

      if (order.status === 'cancelled') {
        return { ok: true, message: 'أمر البيع ملغي بالفعل' };
      }

      if (order.status === 'converted') {
        throw new BadRequestException('لا يمكن إلغاء أمر بيع تم تحويله إلى فاتورة؛ يجب إلغاء الفاتورة من شاشة المبيعات أولاً');
      }

      const items = await trx
        .selectFrom('sales_order_items')
        .selectAll()
        .where('sales_order_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .execute();

      // Release any reserved quantities
      const releaseItems: Array<{ productId: number; qty: number }> = [];
      for (const item of items) {
        const reservedQty = Number(item.reserved_quantity || 0);
        if (reservedQty > 0) {
          releaseItems.push({
            productId: Number(item.product_id),
            qty: reservedQty,
          });

          await trx
            .updateTable('sales_order_items')
            .set({ reserved_quantity: 0 })
            .where('id', '=', Number(item.id))
            .where('tenant_id', '=', scope.tenantId)
            .execute();
        }
      }

      if (releaseItems.length > 0) {
        // INV-SALES-ORDER-WAREHOUSE-SELECTION: release from the
        // warehouse the reservation was made in — the order's stored
        // warehouse — never from the branch default, which may have
        // changed (or never held the stock) since the reservation.
        let locationId: number | null = null;
        if (order.warehouse_location_id) {
          locationId = Number(order.warehouse_location_id);
        } else if (order.branch_id) {
          const branchRow = await trx
            .selectFrom('branches')
            .select(['default_stock_location_id'])
            .where('id', '=', order.branch_id)
            .where('tenant_id', '=', scope.tenantId)
            .executeTakeFirst();
          locationId = branchRow?.default_stock_location_id ? Number(branchRow.default_stock_location_id) : null;
        }

        await releaseLocationStock(trx, {
          branchId: order.branch_id,
          locationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          items: releaseItems,
        });
      }

      await trx
        .updateTable('sales_orders')
        .set({
          status: 'cancelled',
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      return { ok: true, message: 'تم إلغاء أمر البيع وإلغاء حجز المخزون بنجاح' };
    });
  }
}
