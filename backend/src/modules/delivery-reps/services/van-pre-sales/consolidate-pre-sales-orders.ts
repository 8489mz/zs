import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { releaseLocationStock } from '../../../../common/utils/location-stock-ledger';
import { generateDailySequenceNumber, sortItemsByProductId } from '../van-common.util';
import type { ConsolidatePreSalesOrdersPayload, ConsolidatePreSalesOrdersResult } from './van-pre-sales-types';

export class ConsolidatePreSalesOrdersSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly resolveDefaultWarehouseLocationId: (
      tenantId: string,
      preferredLocationId?: number,
      productIds?: number[],
    ) => Promise<number | null>,
  ) {}

  /**
   * Consolidates multiple approved Pre-Sales orders into a single Morning Van Load Requisition (VL-YYMMDD-XXXX)
   * for a target delivery representative. Atomically releases the order-level warehouse reservation
   * so that approving/dispatching the load requisition can cleanly move physical stock into the van,
   * and marks the source Pre-Sales orders as 'converted'.
   */
  public async consolidatePreSalesOrdersToRequisition(
    tenantId: string,
    accountId: string,
    supervisorUserId: number,
    payload: ConsolidatePreSalesOrdersPayload,
  ): Promise<ConsolidatePreSalesOrdersResult> {
    const rawOrderIds = Array.isArray(payload?.orderIds) ? payload.orderIds : [];
    const uniqueOrderIds = Array.from(
      new Set(rawOrderIds.map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0)),
    );

    if (uniqueOrderIds.length === 0) {
      throw new AppError('يرجى تحديد طلب حجز واحد على الأقل للتجميع في إذن التحميل', 'NO_ORDERS_SELECTED', 400);
    }

    // F18 (trial problem 30): the admin dialog sends `deliveryRepId`,
    // older callers send `targetRepId` — accept either, target first.
    const targetRepId = Number(payload?.targetRepId || payload?.deliveryRepId || 0);
    if (!targetRepId || targetRepId <= 0) {
      throw new AppError('يرجى تحديد المندوب / السيارة المستهدفة لتحميل البضاعة', 'TARGET_REP_REQUIRED', 400);
    }

    return await this.db.transaction().execute(async (trx) => {
      const trxAny = trx as any;

      const rep = await trxAny
        .selectFrom('delivery_representatives')
        .select(['id', 'name', 'is_active'])
        .where('id', '=', targetRepId)
        .where('tenant_id', '=', tenantId)
        .executeTakeFirst();

      if (!rep) {
        throw new AppError('مندوب التوزيع المحدد غير موجود', 'REP_NOT_FOUND', 404);
      }

      const orders = await trxAny
        .selectFrom('sales_orders')
        .select(['id', 'order_number', 'status', 'warehouse_location_id', 'customer_name', 'notes'])
        .where('id', 'in', uniqueOrderIds)
        .where('tenant_id', '=', tenantId)
        .where('order_source', '=', 'van_presales')
        .forUpdate()
        .execute();

      if (orders.length !== uniqueOrderIds.length) {
        throw new AppError('بعض طلبات الحجز المحددة غير موجودة أو لا تنتمي لهذه المنشأة', 'ORDERS_NOT_FOUND', 404);
      }

      const nonApproved = orders.filter((o: any) => o.status !== 'approved');
      if (nonApproved.length > 0) {
        const nums = nonApproved.map((o: any) => o.order_number).join('، ');
        throw new AppError(
          `يجب أن تكون كافة الطلبات المحددة في حالة (معتمد) قبل التجميع. الطلبات غير المعتمدة: ${nums}`,
          'ORDERS_NOT_APPROVED',
          400,
        );
      }

      const orderItems = await trxAny
        .selectFrom('sales_order_items')
        .select([
          'id',
          'sales_order_id',
          'product_id',
          'product_name',
          'unit_name',
          'quantity',
          'reserved_quantity',
          'unit_multiplier',
        ])
        .where('sales_order_id', 'in', uniqueOrderIds)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (!orderItems || orderItems.length === 0) {
        throw new AppError('طلبات الحجز المحددة لا تحتوي على أصناف لتحميلها', 'EMPTY_ORDER_ITEMS', 400);
      }

      const orderById = new Map<number, any>();
      for (const ord of orders) {
        orderById.set(Number(ord.id), ord);
      }

      // 1. Group reserved stock releases by warehouse_location_id and release in canonical lock order
      const releasesByLocation = new Map<number, Map<number, number>>();
      const consolidatedMap = new Map<
        number,
        {
          productId: number;
          productName: string;
          requestedQty: number;
          approvedQty: number;
          sourceOrders: Set<string>;
        }
      >();

      for (const item of orderItems) {
        const pid = Number(item.product_id);
        const ord = orderById.get(Number(item.sales_order_id));
        const whLocId = Number(ord?.warehouse_location_id || 0);
        const reservedQty = Number(item.reserved_quantity || 0);

        if (reservedQty > 0) {
          if (!releasesByLocation.has(whLocId)) {
            releasesByLocation.set(whLocId, new Map<number, number>());
          }
          const locMap = releasesByLocation.get(whLocId)!;
          locMap.set(pid, Number(((locMap.get(pid) || 0) + reservedQty).toFixed(4)));
        }

        const multiplier = Math.max(0.0001, Number(item.unit_multiplier || 1));
        const baseQty = reservedQty > 0 ? reservedQty : Number((Number(item.quantity || 0) * multiplier).toFixed(4));

        if (baseQty > 0) {
          const existing = consolidatedMap.get(pid);
          if (existing) {
            existing.requestedQty = Number((existing.requestedQty + baseQty).toFixed(4));
            existing.approvedQty = existing.requestedQty;
            if (ord?.order_number) existing.sourceOrders.add(String(ord.order_number));
          } else {
            const sourceSet = new Set<string>();
            if (ord?.order_number) sourceSet.add(String(ord.order_number));
            consolidatedMap.set(pid, {
              productId: pid,
              productName: String(item.product_name || `صنف #${pid}`),
              requestedQty: baseQty,
              approvedQty: baseQty,
              sourceOrders: sourceSet,
            });
          }
        }
      }

      for (const [locId, prodMap] of releasesByLocation.entries()) {
        const itemsToRelease = sortItemsByProductId(
          Array.from(prodMap.entries()).map(([productId, qty]) => ({ productId, qty })),
        );
        if (itemsToRelease.length > 0) {
          await releaseLocationStock(trx as any, {
            tenantId,
            accountId,
            locationId: locId > 0 ? locId : null,
            items: itemsToRelease,
          });
        }
      }

      // 2. Resolve source warehouse for the consolidated Van Load Requisition
      const firstOrderWarehouseId = Number(
        orders.find((o: any) => Number(o.warehouse_location_id || 0) > 0)?.warehouse_location_id || 0,
      );
      const resolvedWarehouseId =
        Number(payload.sourceWarehouseId || 0) ||
        firstOrderWarehouseId ||
        (await this.resolveDefaultWarehouseLocationId(tenantId, undefined, Array.from(consolidatedMap.keys()))) ||
        1;

      const consolidatedItems = sortItemsByProductId(
        Array.from(consolidatedMap.values()).map((entry) => ({
          productId: entry.productId,
          productName: entry.productName,
          requestedQty: entry.requestedQty,
          approvedQty: entry.approvedQty,
          sourceOrders: Array.from(entry.sourceOrders),
        })),
      );

      const docNo = await generateDailySequenceNumber(
        trxAny,
        this.db,
        'van_load_requisitions',
        'doc_no',
        'VL',
        tenantId,
      );

      const orderNumbersList = orders.map((o: any) => o.order_number).join('، ');
      const autoNotes = [
        `تجميع آلي لطلبات الحجز المسبق (${orders.length}): ${orderNumbersList}`,
        payload.notes ? String(payload.notes).trim() : '',
      ]
        .filter(Boolean)
        .join(' — ');

      const insertedReq = await trxAny
        .insertInto('van_load_requisitions')
        .values({
          tenant_id: tenantId,
          account_id: accountId,
          doc_no: docNo,
          rep_id: targetRepId,
          source_warehouse_id: resolvedWarehouseId,
          status: 'pending',
          requested_items: JSON.stringify(consolidatedItems),
          notes: autoNotes,
        })
        .returning(['id'])
        .executeTakeFirstOrThrow();

      // 3. Mark source Pre-Sales orders as converted and clear reserved_quantity
      await trxAny
        .updateTable('sales_order_items')
        .set((eb: any) => ({
          reserved_quantity: 0,
          delivered_quantity: eb.ref('quantity'),
        }))
        .where('sales_order_id', 'in', uniqueOrderIds)
        .where('tenant_id', '=', tenantId)
        .execute();

      for (const ord of orders) {
        const updatedNote = [
          ord.notes ? String(ord.notes).trim() : '',
          `[تم التجميع في إذن تحميل رقم ${docNo} للمندوب ${rep.name}]`,
        ]
          .filter(Boolean)
          .join(' | ');

        await trxAny
          .updateTable('sales_orders')
          .set({
            status: 'converted',
            notes: updatedNote,
            updated_at: sql`NOW()`,
          })
          .where('id', '=', Number(ord.id))
          .where('tenant_id', '=', tenantId)
          .execute();
      }

      return {
        ok: true,
        requisitionId: Number(insertedReq.id),
        docNo,
        consolidatedOrdersCount: orders.length,
        itemsCount: consolidatedItems.length,
        targetRepId,
        targetRepName: String(rep.name || ''),
      };
    });
  }
}
