import { Kysely, sql } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { releaseLocationStock } from '../../../../common/utils/location-stock-ledger';
import type { ApprovePreSalesOrderResult, RejectPreSalesOrderResult } from './van-pre-sales-types';

export class PreSalesOrderLifecycleSlice {
  private get anyDb(): any {
    return this.db;
  }

  constructor(private readonly db: Kysely<Database>) {}

  /**
   * Supervisor reviews and approves the pre-sales order for warehouse preparation.
   */
  async approvePreSalesOrder(
    orderId: number,
    supervisorUserId: number,
    tenantId: string,
    accountId: string,
  ): Promise<ApprovePreSalesOrderResult> {
    const order = await this.anyDb
      .selectFrom('sales_orders')
      .select(['id', 'status', 'customer_id', 'payment_terms', 'total_amount'])
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('طلب الحجز غير موجود', 'ORDER_NOT_FOUND', 404);
    }

    if (order.status !== 'pending_approval' && order.status !== 'pending_supervisor') {
      throw new AppError(`لا يمكن اعتماد طلب بحالة "${order.status}"`, 'INVALID_ORDER_STATUS', 400);
    }

    // If payment is credit, check customer credit limit
    if (order.payment_terms === 'credit' && order.customer_id) {
      const cust = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'credit_limit', 'balance', 'is_credit_blocked'])
        .where('id', '=', order.customer_id)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (cust?.is_credit_blocked) {
        throw new AppError(`العميل "${cust.name}" محظور من التعاملات الآجلة`, 'CUSTOMER_BLOCKED', 400);
      }

      if (cust?.credit_limit && Number(cust.credit_limit) > 0) {
        const currentBalance = Number(cust.balance || 0);
        const orderTotal = Number(order.total_amount || 0);
        if (currentBalance + orderTotal > Number(cust.credit_limit)) {
          throw new AppError(
            `قيمة الطلب تتجاوز سقف الائتمان المسموح للعميل. الرصيد الحالي: ${currentBalance}، الحد الأقصى: ${cust.credit_limit}`,
            'CREDIT_LIMIT_EXCEEDED',
            400,
          );
        }
      }
    }

    await this.anyDb
      .updateTable('sales_orders')
      .set({
        status: 'approved',
        supervisor_approved_at: sql`NOW()`,
        supervisor_approved_by: supervisorUserId,
        updated_at: sql`NOW()`,
      })
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, status: 'approved' };
  }

  /**
   * Supervisor rejects the pre-sales order and releases all reserved stock atomically.
   */
  async rejectPreSalesOrder(
    orderId: number,
    supervisorUserId: number,
    tenantId: string,
    accountId: string,
    reason?: string,
  ): Promise<RejectPreSalesOrderResult> {
    const order = await this.anyDb
      .selectFrom('sales_orders')
      .select(['id', 'status', 'warehouse_location_id'])
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!order) {
      throw new AppError('طلب الحجز غير موجود', 'ORDER_NOT_FOUND', 404);
    }

    if (order.status !== 'pending_approval' && order.status !== 'pending_supervisor' && order.status !== 'approved') {
      throw new AppError(`لا يمكن رفض طلب بحالة "${order.status}"`, 'INVALID_ORDER_STATUS', 400);
    }

    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx;
      const items = await trxAny
        .selectFrom('sales_order_items')
        .select(['product_id', 'reserved_quantity'])
        .where('sales_order_id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();

      const whLocId = order.warehouse_location_id ? Number(order.warehouse_location_id) : 0;

      const itemsToRelease = items
        .filter((item: any) => Number(item.reserved_quantity || 0) > 0)
        .map((item: any) => ({
          productId: Number(item.product_id),
          qty: Number(item.reserved_quantity),
        }));

      if (itemsToRelease.length > 0) {
        await releaseLocationStock(trx, {
          tenantId,
          accountId,
          locationId: whLocId > 0 ? whLocId : null,
          items: itemsToRelease,
        });
      }

      await trxAny
        .updateTable('sales_orders')
        .set({
          status: 'rejected',
          supervisor_rejection_reason: reason || 'تم الرفض بواسطة المشرف',
          updated_at: sql`NOW()`,
        })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();
    });

    return { ok: true, status: 'rejected' };
  }
}
