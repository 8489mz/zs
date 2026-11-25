/**
 * DeliveryRepsDriverOrdersService — slice S5 of the delivery-reps split.
 * Pure move of the driver-portal order methods from DeliveryRepsService:
 * driverListOrders, driverSettleOrder and dispatchOrders. No behavior
 * change: bodies are byte-identical apart from trailing whitespace
 * stripped on moved lines.
 * Deps: database + audit + posting + finance + the kernel tenant
 * predicate, bound from the facade and stored under its original
 * name, plus the two shared helpers bound from the facade the same
 * way. The facade keeps thin public delegates with the original
 * signatures.
 */

import { Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { type RawBuilder } from 'kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { SalesFinanceService } from '../sales/services/sales-finance.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { AppError } from '../../common/errors/app-error';
import { Database } from '../../database/database.types';
import { boundedPage } from '../../common/utils/bounded-page';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../accounting/engines/money-minor-units.engine';

export interface DeliveryRepsDriverOrdersDeps {
  db: Kysely<Database>;
  audit: AuditService;
  accountingPosting: AccountingPostingService;
  salesFinance: SalesFinanceService;
  tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
  getDeliveryFeeMode: (trx: Kysely<Database>, actor: AuthContext) => Promise<'freelance_courier' | 'store_fleet'>;
  repOrderCashDue: (
    order: {
      id: number;
      delivery_fee_mode: string | null;
      collection_status?: string | null;
      paid_amount?: number | string | null;
    },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ) => Promise<number>;
}

@Injectable()
export class DeliveryRepsDriverOrdersService {
  private readonly db: Kysely<Database>;
  private readonly audit: AuditService;
  private readonly accountingPosting: AccountingPostingService;
  private readonly salesFinance: SalesFinanceService;
  private readonly tenantPredicate: (actor: AuthContext) => RawBuilder<boolean>;
  private readonly getDeliveryFeeMode: (
    trx: Kysely<Database>,
    actor: AuthContext,
  ) => Promise<'freelance_courier' | 'store_fleet'>;
  private readonly repOrderCashDue: (
    order: {
      id: number;
      delivery_fee_mode: string | null;
      collection_status?: string | null;
      paid_amount?: number | string | null;
    },
    defaultMode: 'freelance_courier' | 'store_fleet',
    moneyDigits: MoneyDigits,
    actor: AuthContext,
  ) => Promise<number>;

  constructor(deps: DeliveryRepsDriverOrdersDeps) {
    this.db = deps.db;
    this.audit = deps.audit;
    this.accountingPosting = deps.accountingPosting;
    this.salesFinance = deps.salesFinance;
    this.tenantPredicate = deps.tenantPredicate;
    this.getDeliveryFeeMode = deps.getDeliveryFeeMode;
    this.repOrderCashDue = deps.repOrderCashDue;
  }

  async driverListOrders(
    repId: number,
    tenantId: string,
    accountId: string,
    filters?: { dateFrom?: string; dateTo?: string; status?: string; page?: number; pageSize?: number },
  ): Promise<Record<string, unknown>> {
    const { page, pageSize, offset } = boundedPage(filters?.page, filters?.pageSize);
    let query = this.db
      .selectFrom('sales')
      .leftJoin('customers', (join) =>
        join.onRef('customers.id', '=', 'sales.customer_id').onRef('customers.tenant_id', '=', 'sales.tenant_id'),
      )
      .select([
        'sales.id',
        'sales.doc_no as docNo',
        'sales.total',
        'sales.delivery_fee as deliveryFee',
        'sales.delivery_fee_mode as deliveryFeeMode',
        'customers.name as customerName',
        'customers.phone as customerPhone',
        'customers.address as customerAddress',
        'sales.order_type as orderType',
        'sales.delivery_rep_id as deliveryRepId',
        'sales.delivery_status as deliveryStatus',
        'sales.collection_status as collectionStatus',
        sql<string | null>`sales.delivery_signature`.as('deliverySignature'),
        sql<string | null>`sales.delivery_photo_url`.as('deliveryPhotoUrl'),
        sql<number | null>`sales.delivery_gps_lat`.as('deliveryGpsLat'),
        sql<number | null>`sales.delivery_gps_lng`.as('deliveryGpsLng'),
        sql<string | null>`sales.delivery_notes`.as('deliveryNotes'),
        'sales.settled_at as settledAt',
        'sales.created_at as createdAt',
      ])
      .where('sales.delivery_rep_id', '=', repId)
      .where('sales.tenant_id', '=', tenantId);

    if (filters?.status) {
      if (filters.status === 'pending') {
        query = query.where((eb) =>
          eb.or([eb('sales.delivery_status', '!=', 'settled'), eb('sales.delivery_status', 'is', null)]),
        );
      } else if (filters.status === 'settled') {
        query = query.where('sales.delivery_status', '=', 'settled');
      }
    }

    const orders = await query
      .orderBy('sales.created_at', 'desc')
      .orderBy('sales.id', 'desc')
      .limit(pageSize + 1)
      .offset(offset)
      .execute();
    // INV-DRIVER-PORTAL-REMAINING-AMOUNT (M15): the driver portal
    // showed the raw invoice total per row (and summed it into the
    // pending badge) although the rep owes only the remaining cash
    // due — a prior return already reversed part of the receivable.
    // Mirror the listOrders pattern: each page row carries its
    // remaining cash due from deliverySettlementBasis (store-fleet:
    // remaining receivable; freelance: remaining receivable minus
    // remaining fee, floored at zero) as `remainingAmount`, while
    // `total` stays the invoice total. The driver token carries no
    // full session, so the basis runs on a minimal { tenantId,
    // accountId } scope — the only fields requireTenantScope reads.
    // Only the page rows are priced (pageSize <= 200), never the
    // lookahead row.
    const pageRows = orders.slice(0, pageSize);
    const driverActor = { tenantId, accountId } as AuthContext;
    const defaultMode = await this.getDeliveryFeeMode(this.db, driverActor);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const ordersWithRemaining = [];
    for (const row of pageRows) {
      const remainingAmount = await this.repOrderCashDue(
        { id: Number(row.id), delivery_fee_mode: (row as any).deliveryFeeMode ?? null },
        defaultMode,
        moneyDigits,
        driverActor,
      );
      ordersWithRemaining.push({ ...row, remainingAmount });
    }
    return { ok: true, orders: ordersWithRemaining, pagination: { page, pageSize, hasMore: orders.length > pageSize } };
  }

  async driverSettleOrder(
    saleId: number,
    repId: number,
    tenantId: string,
    payload?: { signatureDataUrl?: string; proofPhotoUrl?: string; gpsLat?: number; gpsLng?: number; notes?: string },
  ): Promise<Record<string, unknown>> {
    await this.db.transaction().execute(async (trx) => {
      const sale = await trx
        .selectFrom('sales')
        .select(['id', 'delivery_rep_id', 'delivery_status', 'tenant_id'])
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!sale) throw new AppError('الطلب غير موجود', 'ORDER_NOT_FOUND', 404);
      if (Number(sale.delivery_rep_id) !== Number(repId)) {
        throw new AppError('هذا الطلب غير مسند إلى هذا المندوب', 'NOT_ASSIGNED', 403);
      }
      if (sale.delivery_status === 'settled') {
        throw new AppError('تمت تسوية هذا الطلب مسبقاً', 'ALREADY_SETTLED', 400);
      }

      // Proof of delivery is not a cash settlement. The authorized cashier must
      // still post the courier's COD custody/treasury/GL atomically via settleOrder.
      if (sale.delivery_status === 'delivered') return;

      // C5 (INV-DISPATCH-STATE-GUARDS-AUDIT): proof of delivery is only
      // meaningful after dispatch — a pending order was never handed to
      // any rep, so marking it delivered would skip dispatch/custody
      // entirely (pending -> delivered directly).
      if (sale.delivery_status !== 'out_for_delivery') {
        throw new AppError(
          'لا يمكن إثبات توصيل طلب لم يُصرف بعد؛ اصرف الطلب إلى المندوب أولاً',
          'DELIVERY_NOT_DISPATCHED',
          409,
        );
      }

      const updateData: Record<string, any> = {
        delivery_status: 'delivered',
        updated_at: sql`NOW()`,
      };
      if (payload?.signatureDataUrl) updateData.delivery_signature = payload.signatureDataUrl;
      if (payload?.proofPhotoUrl) updateData.delivery_photo_url = payload.proofPhotoUrl;
      if (payload?.gpsLat !== undefined && payload?.gpsLat !== null) updateData.delivery_gps_lat = payload.gpsLat;
      if (payload?.gpsLng !== undefined && payload?.gpsLng !== null) updateData.delivery_gps_lng = payload.gpsLng;
      if (payload?.notes) updateData.delivery_notes = payload.notes;

      await trx
        .updateTable('sales')
        .set(updateData)
        .where('id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .execute();

      await trx
        .updateTable('online_orders')
        .set({
          status: 'delivered',
          updated_at: sql`NOW()`,
        })
        .where('sale_id', '=', saleId)
        .where('tenant_id', '=', tenantId)
        .where('status', '!=', 'cancelled')
        .execute();
    });

    return { ok: true, message: 'تم إثبات تسليم الشحنة؛ عهدة التحصيل قيد التسوية' };
  }

  /**
   * Restaurant & F&B Dispatch Console: 1-click batch order dispatch to driver
   */
  async dispatchOrders(
    actor: AuthContext,
    payload: { repId: number; saleIds?: number[]; onlineOrderIds?: number[]; notes?: string },
  ) {
    const validateIds = (ids: number[] | undefined): number[] => {
      const values = ids || [];
      if (
        !Array.isArray(values) ||
        values.length > 200 ||
        values.some((id) => !Number.isSafeInteger(id) || id <= 0) ||
        new Set(values).size !== values.length
      ) {
        throw new AppError('معرفات الطلبات غير صالحة أو مكررة', 'DELIVERY_DISPATCH_INVALID_IDS', 400);
      }
      return values;
    };
    const saleIds = validateIds(payload.saleIds);
    const onlineOrderIds = validateIds(payload.onlineOrderIds);
    if (!saleIds.length && !onlineOrderIds.length) {
      throw new AppError('اختر طلباً واحداً على الأقل', 'DELIVERY_DISPATCH_EMPTY', 400);
    }

    const result = await this.db.transaction().execute(async (trx) => {
      const rep = await trx
        .selectFrom('delivery_representatives')
        .select(['id', 'name', 'phone', 'is_active'])
        .where('id', '=', payload.repId)
        .where(this.tenantPredicate(actor))
        .executeTakeFirst();
      if (!rep || !rep.is_active) {
        throw new AppError('مندوب التوصيل غير موجود أو غير نشط', 'DELIVERY_REP_NOT_FOUND', 404);
      }
      const now = new Date();
      const notifications: Array<{ recipientPhone: string; orderNumber: string; text: string }> = [];
      // D-SF-02 (INV-SF-COD-CUSTODY-GL): the sales dispatched in this
      // transaction (direct ids + online-order links) are the ones
      // whose receivable moves to courier custody below.
      const dispatchedSaleIds: number[] = [...saleIds];

      // C12 (INV-DISPATCH-STATE-GUARDS-AUDIT): one audit row per
      // dispatched item (sale or online order), written in this same
      // transaction so a rolled-back dispatch leaves no audit trace.
      // A re-assignment (oldRepId set) records old rep -> new rep.
      const auditEntries: Array<{ orderLabel: string; oldRepId: number | null }> = [];

      if (saleIds.length) {
        const sales = await trx
          .selectFrom('sales')
          .select(['id', 'doc_no', 'customer_phone', 'order_type', 'status', 'delivery_status', 'delivery_rep_id'])
          .where('id', 'in', saleIds)
          .where(this.tenantPredicate(actor))
          .orderBy('id', 'asc')
          .forUpdate()
          .execute();
        if (
          sales.length !== saleIds.length ||
          sales.some(
            (s) =>
              s.status === 'cancelled' ||
              ['delivered', 'settled'].includes(String(s.delivery_status)) ||
              (s.delivery_rep_id &&
                Number(s.delivery_rep_id) !== Number(rep.id) &&
                !['pending', null].includes(s.delivery_status)),
          )
        ) {
          throw new AppError(
            'لا يمكن إسناد طلب ملغي أو مسلّم بالفعل أو في عهدة مندوب آخر',
            'DELIVERY_DISPATCH_FORBIDDEN',
            409,
          );
        }
        // C4: a pending order re-assigned to another rep is allowed,
        // but the old -> new rep move must be recorded, not silent.
        for (const s of sales) {
          auditEntries.push({
            orderLabel: `#${s.id}`,
            oldRepId:
              s.delivery_rep_id && Number(s.delivery_rep_id) !== Number(rep.id) ? Number(s.delivery_rep_id) : null,
          });
        }
        await trx
          .updateTable('sales')
          .set({
            order_type: 'delivery',
            delivery_rep_id: rep.id,
            delivery_status: 'out_for_delivery',
            dispatched_at: now,
            ...(payload.notes ? { note: sql`COALESCE(note, '') || ${' [' + payload.notes + ']'}` as any } : {}),
          })
          .where('id', 'in', saleIds)
          .where(this.tenantPredicate(actor))
          .execute();

        for (const s of sales)
          if (s.customer_phone) {
            notifications.push({
              recipientPhone: s.customer_phone,
              orderNumber: s.doc_no || `SALE-${s.id}`,
              text: `عزيزي العميل، طلبك رقم #${s.doc_no || s.id} في الطريق إليك مع كابتن التوصيل ${rep.name} (${rep.phone || ''}). نتمنى لك وجبة شهية!`,
            });
          }
      }

      if (onlineOrderIds.length) {
        const orders = await trx
          .selectFrom('online_orders')
          .select(['id', 'order_number', 'customer_phone', 'status', 'sale_id'])
          .where('id', 'in', onlineOrderIds)
          .where(this.tenantPredicate(actor))
          .orderBy('id', 'asc')
          .forUpdate()
          .execute();
        if (
          orders.length !== onlineOrderIds.length ||
          orders.some((order) => ['cancelled', 'delivered', 'returned'].includes(String(order.status)))
        ) {
          throw new AppError('طلب أونلاين غير موجود أو أُلغي أو سُلّم بالفعل', 'DELIVERY_DISPATCH_FORBIDDEN', 409);
        }
        await trx
          .updateTable('online_orders')
          .set({
            status: 'shipped',
            dispatched_at: now,
          })
          .where('id', 'in', onlineOrderIds)
          .where(this.tenantPredicate(actor))
          .execute();

        const linkedSaleIds = orders.map((o) => o.sale_id).filter((id): id is number => Boolean(id) && Number(id) > 0);
        dispatchedSaleIds.push(...linkedSaleIds);
        if (linkedSaleIds.length > 0) {
          // C2 (INV-DISPATCH-STATE-GUARDS-AUDIT): mirror the saleIds
          // guard on the linked sale — a settled sale, or one already
          // out for delivery in another rep's custody, must be
          // refused here too, not silently overwritten.
          const linkedSales = await trx
            .selectFrom('sales')
            .select(['id', 'status', 'delivery_status', 'delivery_rep_id'])
            .where('id', 'in', [...new Set(linkedSaleIds)])
            .where(this.tenantPredicate(actor))
            .orderBy('id', 'asc')
            .forUpdate()
            .execute();
          if (
            linkedSales.length !== new Set(linkedSaleIds).size ||
            linkedSales.some(
              (s) =>
                s.status === 'cancelled' ||
                ['delivered', 'settled'].includes(String(s.delivery_status)) ||
                (s.delivery_rep_id &&
                  Number(s.delivery_rep_id) !== Number(rep.id) &&
                  !['pending', null].includes(s.delivery_status)),
            )
          ) {
            throw new AppError(
              'لا يمكن إسناد طلب أونلاين مسلّم بالفعل أو مُسوَّى أو في عهدة مندوب آخر',
              'DELIVERY_DISPATCH_FORBIDDEN',
              409,
            );
          }
          const linkedById = new Map(linkedSales.map((s) => [Number(s.id), s]));
          for (const order of orders) {
            if (!order.sale_id) {
              auditEntries.push({ orderLabel: `أونلاين #${order.order_number || order.id}`, oldRepId: null });
              continue;
            }
            const linked = linkedById.get(Number(order.sale_id));
            auditEntries.push({
              orderLabel: `#${order.sale_id}`,
              oldRepId:
                linked && linked.delivery_rep_id && Number(linked.delivery_rep_id) !== Number(rep.id)
                  ? Number(linked.delivery_rep_id)
                  : null,
            });
          }
          await trx
            .updateTable('sales')
            .set({
              order_type: 'delivery',
              delivery_rep_id: rep.id,
              delivery_status: 'out_for_delivery',
              dispatched_at: now,
              ...(payload.notes ? { note: sql`COALESCE(note, '') || ${' [' + payload.notes + ']'}` as any } : {}),
            })
            .where('id', 'in', linkedSaleIds)
            .where(this.tenantPredicate(actor))
            .execute();
        } else {
          // Online orders with no linked sale still get an audit row.
          for (const order of orders) {
            auditEntries.push({ orderLabel: `أونلاين #${order.order_number || order.id}`, oldRepId: null });
          }
        }

        for (const order of orders)
          if (order.customer_phone) {
            notifications.push({
              recipientPhone: order.customer_phone,
              orderNumber: order.order_number,
              text: `عزيزي العميل، طلبك رقم #${order.order_number} في الطريق إليك مع كابتن التوصيل ${rep.name} (${rep.phone || ''}). نتمنى لك وجبة شهية!`,
            });
          }
      }
      // D-SF-02 (INV-SF-COD-CUSTODY-GL): dispatch moves the COD
      // receivable off the customer to courier custody — GL
      // reclassification plus the customer-ledger leg that takes
      // the customer balance to zero for the order, in this same
      // transaction. Prepaid / fully-returned sales are a no-op
      // inside the reclassification (remaining 0). A re-dispatch
      // to the same rep is idempotent there and writes no second
      // ledger leg.
      for (const dispatchedSaleId of dispatchedSaleIds) {
        const reclass = await this.accountingPosting.postDeliveryCustodyReclassification(
          trx,
          dispatchedSaleId,
          rep.id,
          actor,
        );
        if (reclass.posted && reclass.amount > 0 && reclass.customerId) {
          await this.salesFinance.addCustomerLedgerLeg(
            trx,
            reclass.customerId,
            -reclass.amount,
            'delivery_custody_transfer',
            `نقل عهدة فاتورة #${reclass.docNo} إلى مندوب التوصيل ${rep.name}`,
            'sale',
            dispatchedSaleId,
            actor,
          );
        }
      }
      // C12: one audit row per dispatched item, in this same
      // transaction. A re-assignment row names the old rep too.
      for (const entry of auditEntries) {
        const reassigned = entry.oldRepId !== null;
        await this.audit.logWithExecutor(
          trx,
          reassigned ? 'إعادة إسناد طلب توصيل' : 'إسناد طلب توصيل',
          reassigned
            ? `تمت إعادة إسناد الطلب ${entry.orderLabel} من المندوب #${entry.oldRepId} إلى المندوب ${rep.name} (#${rep.id}) بواسطة ${actor.username}`
            : `تم إسناد الطلب ${entry.orderLabel} إلى المندوب ${rep.name} (#${rep.id}) بواسطة ${actor.username}`,
          actor,
          { eventCode: 'DELIVERY_ORDER_DISPATCHED' },
        );
      }
      return { rep, notifications };
    });

    return {
      success: true,
      repId: result.rep.id,
      repName: result.rep.name,
      dispatchedCount: saleIds.length + onlineOrderIds.length,
      notifications: result.notifications,
      message: `تم إسناد وانطلاق ${saleIds.length + onlineOrderIds.length} طلب بنجاح مع الكابتن ${result.rep.name}`,
    };
  }
}
