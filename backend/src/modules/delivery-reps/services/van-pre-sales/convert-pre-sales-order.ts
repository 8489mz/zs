import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { sortItemsByProductId } from '../van-common.util';
import { SalesService } from '../../../sales/sales.service';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { ConvertPreSalesOrderPayload, ConvertPreSalesOrderResult } from './van-pre-sales-types';

export class ConvertPreSalesOrderSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly salesService?: SalesService,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  /**
   * Directly converts an approved Pre-Sales order into an official Wholesale Sale Invoice,
   * releasing the Pre-Sales stock reservation and posting the sale from the order's warehouse.
   */
  public async convertPreSalesOrderToInvoice(
    orderId: number,
    auth: AuthContext,
    payload?: ConvertPreSalesOrderPayload,
  ): Promise<ConvertPreSalesOrderResult> {
    const tenantId = auth.tenantId || 'default';
    const accountId = auth.accountId || 'default';

    if (!this.salesService) {
      throw new AppError('خدمة الفواتير غير متاحة حالياً', 'SALES_SERVICE_UNAVAILABLE', 500);
    }

    const order = await this.anyDb
      .selectFrom('sales_orders')
      .selectAll()
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .where('order_source', '=', 'van_presales')
      .executeTakeFirst();

    if (!order) {
      throw new AppError('طلب الحجز غير موجود', 'ORDER_NOT_FOUND', 404);
    }

    if (order.status === 'converted' && order.sale_id) {
      throw new AppError('تم تحويل طلب الحجز إلى فاتورة مبيعات مسبقاً', 'ORDER_ALREADY_CONVERTED', 400);
    }

    // 'converting' is let through to the claim below on purpose — the
    // claim fails, and the re-read there decides whether the
    // conversion is in flight (ORDER_CONVERSION_IN_PROGRESS) or
    // already done. Rejecting it here would make that decision
    // unreachable (the same reason sales-orders convertToSale lets
    // 'converting' through).
    if (order.status !== 'approved' && order.status !== 'converting') {
      throw new AppError('يجب اعتماد طلب الحجز أولاً قبل تحويله إلى فاتورة مبيعات', 'ORDER_NOT_APPROVED', 400);
    }

    const items = await this.anyDb
      .selectFrom('sales_order_items')
      .selectAll()
      .where('sales_order_id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .execute();

    if (!items || items.length === 0) {
      throw new AppError('لا يمكن تحويل طلب حجز فارغ إلى فاتورة', 'EMPTY_ORDER_ITEMS', 400);
    }

    const whLocId = order.warehouse_location_id ? Number(order.warehouse_location_id) : null;
    let branchId = order.branch_id ? Number(order.branch_id) : null;

    if (!branchId && whLocId) {
      const locRow = await this.anyDb
        .selectFrom('stock_locations')
        .select(['branch_id'])
        .where('id', '=', whLocId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (locRow?.branch_id) branchId = Number(locRow.branch_id);
    }

    if (!branchId) {
      const primaryBranch = await this.anyDb
        .selectFrom('branches')
        .select(['id'])
        .where('tenant_id', '=', tenantId)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      branchId = primaryBranch ? Number(primaryBranch.id) : 1;
    }

    const releaseItems = sortItemsByProductId<{ productId: number; qty: number }>(
      items
        .filter((item: any) => Number(item.reserved_quantity || 0) > 0)
        .map((item: any) => ({
          productId: Number(item.product_id),
          qty: Number(item.reserved_quantity),
        })),
    );

    // INV-VAN-TRIP-LOCKED-STATE-RECHECK: the old shape ran three
    // separate transactions — release the reservation, create the sale,
    // then flip the order — with only snapshot status checks between
    // them. Two concurrent converts both released the same reservation
    // (double-freeing stock), both created a sale, and both flipped
    // the order. The new shape follows the canonical sales-order
    // conversion (INV-SALES-ORDER-CONVERSION-STOCK-LEGS /
    // INV-CONVERSION-LIFECYCLE-RACES, sales-orders.service
    // convertToSale): claim the order approved -> 'converting' with a
    // conditional update (the atomic guard — the loser affects zero
    // rows), hand the reservation to createSale as a
    // SalesOrderConversionRelease so it is released INSIDE the sale
    // transaction under the product locks (createSale verifies the
    // 'converting' state first), and flip 'converting' -> 'converted'
    // with a status predicate. A failed sale reverts the claim to
    // 'approved'; no re-reserve is ever needed, because the
    // reservation was only ever released inside the sale transaction
    // and a failed sale rolls it back with itself. createSale owns
    // its own transaction, so the claim + in-sale release +
    // conditional flip is the atomic unit — the same unit the
    // canonical conversion uses.
    const claimed = await this.anyDb
      .updateTable('sales_orders')
      .set({ status: 'converting', updated_at: sql`NOW()` })
      .where('id', '=', orderId)
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'approved')
      .returning('id')
      .executeTakeFirst();
    if (!claimed) {
      const current = await this.anyDb
        .selectFrom('sales_orders')
        .select(['status', 'sale_id'])
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();
      if (current?.status === 'converted' && current.sale_id) {
        throw new AppError('تم تحويل طلب الحجز إلى فاتورة مبيعات مسبقاً', 'ORDER_ALREADY_CONVERTED', 400);
      }
      if (current?.status === 'converting') {
        throw new AppError('طلب الحجز قيد التحويل حالياً', 'ORDER_CONVERSION_IN_PROGRESS', 409);
      }
      throw new AppError('يجب اعتماد طلب الحجز أولاً قبل تحويله إلى فاتورة مبيعات', 'ORDER_NOT_APPROVED', 400);
    }
    const conversionRelease =
      releaseItems.length > 0
        ? { salesOrderId: orderId, branchId, locationId: whLocId, items: releaseItems }
        : undefined;

    const paymentType: 'cash' | 'credit' =
      payload?.paymentType || (order.payment_terms === 'credit' ? 'credit' : 'cash');
    const totalAmount = Number(order.total_amount || 0);
    const paidAmount =
      payload?.paidAmount !== undefined && payload?.paidAmount !== null
        ? Math.max(0, Number(payload.paidAmount))
        : paymentType === 'cash'
          ? totalAmount
          : 0;

    const approvedUnitPrices: Record<number, number> = {};
    const saleItems = items.map((item: any) => {
      const pid = Number(item.product_id);
      const unitPrice = Number(item.unit_price || 0);
      approvedUnitPrices[pid] = unitPrice;
      return {
        productId: pid,
        qty: Number(item.quantity),
        unitPrice,
        price: unitPrice,
        discount: Number(item.discount || 0),
        unitName: item.unit_name || undefined,
        priceType: 'wholesale' as const,
      };
    });

    const salePayload: any = {
      branchId,
      locationId: whLocId || undefined,
      customerId: order.customer_id ? Number(order.customer_id) : undefined,
      customerName: order.customer_name || undefined,
      customerPhone: order.customer_phone || undefined,
      deliveryRepId: order.rep_id ? Number(order.rep_id) : undefined,
      note: [
        `فاتورة جملة محولة من طلب حجز مسبق #${order.order_number}`,
        order.notes ? String(order.notes).trim() : '',
        payload?.notes ? String(payload.notes).trim() : '',
      ]
        .filter(Boolean)
        .join(' — '),
      items: saleItems,
      discount: Number(order.discount_amount || 0),
      paymentType,
      paymentChannel: paymentType === 'credit' && paidAmount <= 0 ? 'credit' : 'cash',
      paidAmount,
      source: 'dashboard',
      payments:
        paidAmount > 0
          ? [
              {
                paymentChannel: 'cash',
                amount: paidAmount,
              },
            ]
          : [],
    };

    let saleResult: any;
    try {
      saleResult = await this.salesService.createSale(
        salePayload,
        auth,
        {
          approvedDiscount: Number(order.discount_amount || 0),
          approvedUnitPrices,
        },
        conversionRelease,
      );
    } catch (err) {
      // Revert the 'converting' claim to 'approved'. No re-reserve:
      // the reservation was only ever released inside the sale
      // transaction, so a failed sale rolled it back with the sale.
      await this.anyDb
        .updateTable('sales_orders')
        .set({ status: 'approved', updated_at: sql`NOW()` })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'converting')
        .execute();
      throw err;
    }

    const saleId = Number(saleResult?.sale?.id || saleResult?.id || 0);
    const docNo = String(saleResult?.sale?.docNo || saleResult?.sale?.doc_no || saleResult?.docNo || '') || null;

    // Conditional flip: only the converter that still holds the
    // 'converting' claim may mark the order converted. Zero affected
    // rows means the claim moved under us — fail closed loudly (the
    // sale already committed, so this needs manual reconciliation,
    // never a silent second flip).
    await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;
      const updated = await trxAny
        .updateTable('sales_orders')
        .set({
          status: 'converted',
          sale_id: saleId > 0 ? saleId : null,
          updated_at: sql`NOW()`,
        })
        .where('id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'converting')
        .returning('id')
        .execute();
      if (updated.length !== 1) {
        throw new AppError(
          'تعذر تأكيد تحويل طلب الحجز بعد إنشاء الفاتورة؛ يلزم تدخل يدوي',
          'ORDER_CONVERSION_MARK_FAILED',
          500,
        );
      }

      await trxAny
        .updateTable('sales_order_items')
        .set((eb: any) => ({
          reserved_quantity: 0,
          delivered_quantity: eb.ref('quantity'),
        }))
        .where('sales_order_id', '=', orderId)
        .where('tenant_id', '=', tenantId)
        .execute();
    });

    return {
      ok: true,
      orderId,
      saleId,
      docNo,
    };
  }
}
