import { Logger, Injectable, NotFoundException, BadRequestException, UnauthorizedException } from '@nestjs/common';
import { type Transaction, Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { verifyPassword } from '../../../core/auth/utils/password-hasher';
import { KdsService } from '../../sales/services/kds.service';
import { MANUALLY_CONFIRMED_PAYMENT_METHODS } from '../engines/online-order-access.engine';
import { releaseLocationStock } from '../../../common/utils/location-stock-ledger';

/**
 * StorefrontMerchantOrdersService — slice T4 of the storefront split.
 * Pure move of 7 methods from the facade (retireKitchenDraft,
 * getOrderCounts, bulkCancelOrders, listOrders, getOrder,
 * updateOrderStatus, confirmManualPayment). No behavior change: the
 * bodies are byte-identical except retireKitchenDraft, which was
 * private in the facade and is PUBLIC in this slice only (its caller
 * outside this slice lives in the convert slice, which binds it at its
 * merge; the facade keeps NO delegate for it by design — post-merge
 * nothing in the facade calls it, and a dead private delegate would
 * fail CI typecheck). The facade keeps thin delegates with the same
 * names/signatures for the 6 public methods.
 * Deps: db + kdsService (ctor-injected in the facade) + logger (bound
 * dep, the facade passes its own logger) + releaseCouponUse (bound
 * method from the coupons slice — on this generation tree bound from
 * the facade's own method; at merge it repoints to the coupons slice
 * via the facade ctor, which merges BEFORE this slice). No kernel
 * deps: the moved text calls neither kernel method. No shared-helper
 * import: the moved text uses no free function from the shared helpers
 * module. updateOrderStatus calls retireKitchenDraft twice inside this
 * slice (intra-slice call). Date sites move byte-identical: 4 row
 * stamps plus 2 payment timestamps in confirmManualPayment. No
 * toFixed(2), no Math.round, no FX in this slice.
 * MERGE NOTE: at merge, repoint the releaseCouponUse bound dep in the
 * facade ctor to the coupons slice instance; the facade delegate for
 * releaseCouponUse stays until the coupons slice merges (it is the
 * source of the bound dep on this tree). The convert slice binds
 * getOrder + retireKitchenDraft from this slice at its own merge.
 */

export interface StorefrontMerchantOrdersDeps {
  db: Kysely<Database>;
  kdsService: KdsService;
  logger: Logger;
  // Bound T8 method (same name as the facade member on this generation
  // tree; at merge it repoints to the coupons slice via
  // this.couponsService.releaseCouponUse.bind(this)).
  releaseCouponUse: (trx: Transaction<Database>, tenantId: string, couponCode: string) => Promise<void>;
}

@Injectable()
export class StorefrontMerchantOrdersService {
  private readonly db: Kysely<Database>;
  private readonly kdsService: KdsService;
  private readonly logger: Logger;
  private readonly releaseCouponUse: (
    trx: Transaction<Database>,
    tenantId: string,
    couponCode: string,
  ) => Promise<void>;

  constructor(deps: StorefrontMerchantOrdersDeps) {
    this.db = deps.db;
    this.kdsService = deps.kdsService;
    this.logger = deps.logger;
    this.releaseCouponUse = deps.releaseCouponUse;
  }

  /**
   * O53: removes a dine-in order's kitchen DRAFT sale once the real invoice is posted (or the order
   * is cancelled), and hands the kitchen ticket's progress to the posted sale.
   *
   * Deleting is correct here and only here: the draft is not a financial document (status 'draft',
   * no stock movement, no journal, no payments), and the WHERE clause refuses to touch anything that
   * is not still a draft. `postedSaleId` must be a posted sale of the same tenant, otherwise the draft
   * is kept — the kitchen keeps the ticket rather than losing it to a bad link.
   */
  async retireKitchenDraft(tenantId: string, orderId: number, postedSaleId: number | null): Promise<void> {
    const order = await this.db
      .selectFrom('online_orders')
      .select(['id', 'kitchen_draft_sale_id'])
      .where('id', '=', orderId)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    const draftSaleId = order?.kitchen_draft_sale_id ? Number(order.kitchen_draft_sale_id) : 0;
    if (!draftSaleId) return;

    if (postedSaleId) {
      if (postedSaleId === draftSaleId) return;
      const posted = await this.db
        .selectFrom('sales')
        .select(['id'])
        .where('id', '=', postedSaleId)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'posted')
        .executeTakeFirst();
      if (!posted) return;
    }

    const removed = await this.db.transaction().execute(async (trx) => {
      const draft = await trx
        .selectFrom('sales')
        .select(['id'])
        .where('id', '=', draftSaleId)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '=', 'draft')
        .forUpdate()
        .executeTakeFirst();

      if (draft) {
        await trx
          .deleteFrom('sale_items')
          .where('sale_id', '=', draftSaleId)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .execute();
        await trx
          .deleteFrom('sales')
          .where('id', '=', draftSaleId)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .where('status', '=', 'draft')
          .execute();
      }

      await trx
        .updateTable('online_orders')
        .set({ kitchen_draft_sale_id: null, updated_at: new Date() })
        .where('id', '=', orderId)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      return Boolean(draft);
    });

    if (removed) {
      // R4-E I17: belt-and-braces only — createSale already transfers the
      // ticket state inside its release block, so this is normally
      // unreachable (the draft pointer is already null). A failure here
      // must never be swallowed: log it loudly and surface it.
      await this.kdsService.transferTicketState(tenantId, draftSaleId, postedSaleId).catch((err) => {
        this.logger.error(
          `Failed to transfer KDS ticket state from draft sale ${draftSaleId} to ${postedSaleId ?? 'null'}: ${err?.message || err}`,
        );
        throw err;
      });
    }
  }

  async getOrderCounts(actor: AuthContext) {
    const tenantId = actor.tenantId;
    const counts: Record<string, number> = {
      all: 0,
      active: 0,
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    };

    try {
      const countRows = await this.db
        .selectFrom('online_orders')
        .select(['status', sql<number>`COUNT(*)::int`.as('cnt')])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .groupBy('status')
        .execute();

      for (const cr of countRows) {
        const s = String(cr.status);
        const c = Number(cr.cnt || 0);
        counts[s] = (counts[s] || 0) + c;
        counts.all += c;
        if (['pending', 'confirmed', 'processing', 'shipped'].includes(s)) {
          counts.active += c;
        }
      }
    } catch {
      // Ignore count aggregation failure
    }

    return { counts };
  }

  async bulkCancelOrders(adminPassword: string, targetStatus = 'pending', actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);

    if (!adminPassword || typeof adminPassword !== 'string' || !adminPassword.trim()) {
      throw new BadRequestException('كلمة مرور الأدمن مطلوبة لتأكيد العملية.');
    }

    // Verify admin credentials strictly: only users with role 'admin' or 'super_admin' in this tenant
    const adminUsers = await this.db
      .selectFrom('users')
      .select(['id', 'username', 'role', 'password_hash', 'password_salt'])
      .where('is_active', '=', true)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where((eb) => eb.or([eb('role', '=', 'admin'), eb('role', '=', 'super_admin')]))
      .execute();

    let authorizedAdminName: string | null = null;
    for (const adminUser of adminUsers) {
      const check = await verifyPassword(
        adminPassword.trim(),
        String(adminUser.password_hash || ''),
        String(adminUser.password_salt || ''),
      );
      if (check.valid) {
        authorizedAdminName = String(adminUser.username || 'المدير');
        break;
      }
    }

    if (!authorizedAdminName) {
      throw new UnauthorizedException(
        'كلمة المرور غير صحيحة أو لا تنتمي لحساب أدمن. فقط مدير المنشأة مخول بإلغاء الطلبات جماعياً.',
      );
    }

    const validStatus = ['pending', 'confirmed', 'processing', 'all'].includes(targetStatus) ? targetStatus : 'pending';

    let cancelledCount = 0;

    await this.db.transaction().execute(async (trx) => {
      let ordersQb = trx
        .selectFrom('online_orders')
        .select([
          'id',
          'order_number',
          'status',
          'payment_status',
          'sale_id',
          'coupon_code',
          'stock_reserved',
          'reserved_branch_id',
          'reserved_location_id',
          'branch_id',
          'account_id',
          'items_json',
        ])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .where('status', '!=', 'cancelled')
        .where('status', '!=', 'delivered')
        .where('sale_id', 'is', null) // Never cancel orders already converted to sales invoices
        .where('payment_status', '!=', 'paid'); // Never bulk-cancel orders paid online without refund flow

      if (validStatus !== 'all') {
        ordersQb = ordersQb.where('status', '=', validStatus as any);
      }

      const ordersToCancel = await ordersQb.forUpdate().execute();
      if (ordersToCancel.length === 0) {
        return;
      }

      const orderIds = ordersToCancel.map((o) => o.id);
      cancelledCount = orderIds.length;

      // Update all orders in batch
      await trx
        .updateTable('online_orders')
        .set({
          status: 'cancelled',
          stock_reserved: false,
          updated_at: new Date(),
        })
        .where('id', 'in', orderIds)
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .execute();

      // A failed release must roll back the order cancellation as well.
      for (const row of ordersToCancel) {
        if (row.coupon_code) {
          try {
            await this.releaseCouponUse(trx, tenantId, String(row.coupon_code));
          } catch (err: any) {
            this.logger.error(
              `bulkCancelOrders: Failed to release coupon ${row.coupon_code} for order ${row.order_number || row.id}: ${err?.message}`,
            );
            throw err;
          }
        }

        if (row.stock_reserved) {
          let orderItems: Array<any> = [];
          try {
            const raw = row.items_json;
            orderItems = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
          } catch {}
          if (orderItems.length > 0) {
            try {
              await releaseLocationStock(trx, {
                branchId: row.reserved_branch_id ?? row.branch_id,
                locationId: row.reserved_location_id,
                tenantId,
                accountId: row.account_id,
                items: orderItems.map((it) => ({
                  productId: Number(it.productId),
                  qty: Number(it.quantity ?? it.qty ?? 1),
                })),
              });
            } catch (err: any) {
              this.logger.error(
                `bulkCancelOrders: Failed to release stock for order ${row.order_number || row.id}: ${err?.message}`,
              );
              throw err;
            }
          }
        }
      }
    });

    return {
      ok: true,
      cancelledCount,
      message: `تم إلغاء ${cancelledCount} طلب بنجاح بتفويض من: ${authorizedAdminName}`,
    };
  }

  async listOrders(query: Record<string, unknown>, actor: AuthContext) {
    const tenantId = actor.tenantId;
    const status = typeof query.status === 'string' ? query.status.trim() : '';

    let qb = this.db
      .selectFrom('online_orders')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`);

    if (status && status !== 'all') {
      if (status === 'active') {
        qb = qb.where('status', 'in', ['pending', 'confirmed', 'processing', 'shipped']);
      } else {
        qb = qb.where('status', '=', status as any);
      }
    }

    const page = Math.max(1, Number(query.page || 1));
    const hasExplicitLimit = query.limit !== undefined && query.limit !== '' && Number(query.limit) > 0;
    const limit = hasExplicitLimit ? Math.min(Number(query.limit), 200) : query.all === 'true' ? 10000 : 50;
    const offset = (page - 1) * limit;

    const rows = await qb.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();

    const counts: Record<string, number> = {
      all: 0,
      active: 0,
      pending: 0,
      confirmed: 0,
      processing: 0,
      shipped: 0,
      delivered: 0,
      cancelled: 0,
    };

    try {
      const countRows = await this.db
        .selectFrom('online_orders')
        .select(['status', sql<number>`COUNT(*)::int`.as('cnt')])
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .groupBy('status')
        .execute();

      for (const cr of countRows) {
        const s = String(cr.status);
        const c = Number(cr.cnt || 0);
        counts[s] = (counts[s] || 0) + c;
        counts.all += c;
        if (['pending', 'confirmed', 'processing', 'shipped'].includes(s)) {
          counts.active += c;
        }
      }
    } catch {
      // Ignore count aggregation failure
    }

    return {
      orders: rows.map((r) => {
        let items: any[] = [];
        try {
          items = typeof r.items_json === 'string' ? JSON.parse(r.items_json) : r.items_json;
        } catch {}

        return {
          id: r.id,
          orderNumber: r.order_number,
          customerName: r.customer_name,
          customerPhone: r.customer_phone,
          customerAddress: r.customer_address,
          customerNotes: r.customer_notes,
          subtotal: Number(r.subtotal),
          deliveryFee: Number(r.delivery_fee),
          deliveryZoneId: r.delivery_zone_id ? Number(r.delivery_zone_id) : null,
          deliveryZoneName: r.delivery_zone_name || null,
          discountAmount: Number(r.discount_amount || 0),
          couponCode: r.coupon_code || null,
          totalAmount: Number(r.total_amount),
          status: r.status,
          paymentMethod: r.payment_method,
          paymentStatus: r.payment_status,
          gatewayProvider: r.gateway_provider,
          saleId: r.sale_id,
          shippingCarrier: r.shipping_carrier,
          bostaDeliveryId: r.bosta_delivery_id,
          bostaTrackingNumber: r.bosta_tracking_number,
          bostaStatus: r.bosta_status,
          bostaAwbUrl: r.bosta_awb_url,
          gccShippingCarrier: r.gcc_shipping_carrier,
          gccShippingId: r.gcc_shipping_id,
          gccTrackingNumber: r.gcc_tracking_number,
          gccShippingStatus: r.gcc_shipping_status,
          gccAwbUrl: r.gcc_awb_url,
          gccShippingCreatedAt: r.gcc_shipping_created_at,
          gcc_shipping_carrier: r.gcc_shipping_carrier,
          gcc_shipping_id: r.gcc_shipping_id,
          gcc_tracking_number: r.gcc_tracking_number,
          gcc_shipping_status: r.gcc_shipping_status,
          gcc_awb_url: r.gcc_awb_url,
          gcc_shipping_created_at: r.gcc_shipping_created_at,
          countryCode: r.country_code || null,
          country_code: r.country_code || null,
          createdAt: r.created_at,
          items,
        };
      }),
      counts,
    };
  }

  async getOrder(id: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const order = await this.db
      .selectFrom('online_orders')
      .selectAll()
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    if (!order) throw new NotFoundException('الطلب غير موجود');

    let items: any[] = [];
    try {
      items = typeof order.items_json === 'string' ? JSON.parse(order.items_json) : order.items_json;
    } catch {}

    return {
      ...order,
      subtotal: Number(order.subtotal),
      deliveryFee: Number(order.delivery_fee),
      deliveryZoneId: order.delivery_zone_id ? Number(order.delivery_zone_id) : null,
      deliveryZoneName: order.delivery_zone_name || null,
      discountAmount: Number(order.discount_amount || 0),
      couponCode: order.coupon_code || null,
      totalAmount: Number(order.total_amount),
      items,
    };
  }

  async updateOrderStatus(id: number, status: string, actor: AuthContext, saleId?: number) {
    const { tenantId } = requireTenantScope(actor);
    const allowed = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
    if (!allowed.includes(status)) {
      throw new BadRequestException('حالة الطلب غير صالحة');
    }

    const updatePayload: any = {
      status: status,
      updated_at: new Date(),
    };
    let linkedStatus: string | undefined;
    await this.db.transaction().execute(async (trx) => {
      if (saleId !== undefined) {
        // POS sends the already-posted sale id as an acknowledgement. Only accept the
        // exact link established atomically by SalesWriteService; never create it here.
        const linkedOrder = await trx
          .selectFrom('online_orders')
          .select(['sale_id', 'status'])
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .forUpdate()
          .executeTakeFirst();
        if (!linkedOrder || Number(linkedOrder.sale_id) !== saleId) {
          throw new BadRequestException('الفاتورة غير مرتبطة بهذا الطلب');
        }
        linkedStatus = linkedOrder.status;
      }
      if (saleId !== undefined) {
        // SalesWriteService already linked and finalized the order in its transaction.
        // A delayed POS acknowledgement must not regress `shipped` to `processing`.
        return;
      }
      if (status === 'cancelled') {
        const row = await trx
          .selectFrom('online_orders')
          .select([
            'id',
            'status',
            'payment_status',
            'sale_id',
            'coupon_code',
            'stock_reserved',
            'reserved_branch_id',
            'reserved_location_id',
            'branch_id',
            'account_id',
            'items_json',
          ])
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .forUpdate()
          .executeTakeFirst();

        if (!row) throw new NotFoundException('الطلب غير موجود');
        if (row.payment_status === 'paid' || row.sale_id) {
          throw new BadRequestException('الطلب المدفوع أو المحول لفاتورة يحتاج إجراء استرداد/إلغاء مالي مستقل');
        }
        if (row && row.status !== 'cancelled') {
          await trx
            .updateTable('online_orders')
            .set({
              ...updatePayload,
              stock_reserved: false,
            })
            .where('id', '=', id)
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .execute();

          if (row.coupon_code) {
            await this.releaseCouponUse(trx, tenantId, String(row.coupon_code));
          }

          if (row.stock_reserved) {
            let orderItems: Array<any> = [];
            try {
              const raw = row.items_json;
              orderItems = (typeof raw === 'string' ? JSON.parse(raw) : raw) || [];
            } catch {}
            if (orderItems.length > 0) {
              await releaseLocationStock(trx, {
                branchId: row.reserved_branch_id ?? row.branch_id,
                locationId: row.reserved_location_id,
                tenantId,
                accountId: row.account_id,
                items: orderItems.map((it) => ({
                  productId: Number(it.productId),
                  qty: Number(it.quantity ?? it.qty ?? 1),
                })),
              });
            }
          }
        }
      } else {
        const current = await trx
          .selectFrom('online_orders')
          .select(['status', 'payment_status', 'sale_id'])
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .forUpdate()
          .executeTakeFirst();
        if (!current) throw new NotFoundException('الطلب غير موجود');
        if (
          current.status === 'review_required' ||
          current.status === 'payment_failed' ||
          current.status === 'cancelled'
        ) {
          throw new BadRequestException('لا يمكن تغيير حالة طلب قيد مراجعة الدفع أو ملغي يدوياً');
        }
        const progress = ['pending', 'confirmed', 'processing', 'shipped', 'delivered'];
        if (
          progress.indexOf(status) < progress.indexOf(current.status) ||
          (current.sale_id && progress.indexOf(status) < progress.indexOf('shipped'))
        ) {
          throw new BadRequestException('لا يمكن إرجاع الطلب إلى حالة سابقة بعد بدء تجهيزه أو إصدار فاتورته');
        }
        await trx
          .updateTable('online_orders')
          .set(updatePayload)
          .where('id', '=', id)
          .where(sql<boolean>`tenant_id = ${tenantId}`)
          .execute();

        if (status === 'delivered' && current.sale_id) {
          await trx
            .updateTable('sales')
            .set({ delivery_status: 'delivered', updated_at: sql`NOW()` })
            .where('id', '=', current.sale_id)
            .where('delivery_status', 'in', ['pending', 'out_for_delivery', null])
            .where(sql<boolean>`tenant_id = ${tenantId}`)
            .execute();
        }
      }
    });

    if (saleId !== undefined && saleId > 0) {
      await this.retireKitchenDraft(tenantId, id, saleId);
    } else if (status === 'cancelled') {
      await this.retireKitchenDraft(tenantId, id, null);
    }

    return { ok: true, status: linkedStatus || status, saleId };
  }

  /**
   * SF-3: a merchant user confirms that an out-of-gateway transfer (InstaPay / wallet) actually
   * arrived. Only after this does the delivery invoice skip cash collection.
   * The conditional UPDATE is the guard: a concurrent confirmation or conversion changes zero rows.
   */
  async confirmManualPayment(id: number, reference: string | undefined, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const order = await this.db
      .selectFrom('online_orders')
      .select(['id', 'payment_method', 'payment_status', 'status', 'sale_id'])
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    if (!order) throw new NotFoundException('الطلب غير موجود');
    if (!(MANUALLY_CONFIRMED_PAYMENT_METHODS as readonly string[]).includes(order.payment_method)) {
      throw new BadRequestException('تأكيد الدفع اليدوي متاح لطلبات التحويل (إنستاباي / محفظة) فقط');
    }
    if (order.payment_status === 'paid') {
      throw new BadRequestException('تم تأكيد سداد هذا الطلب مسبقاً');
    }
    if (order.status === 'cancelled') {
      throw new BadRequestException('لا يمكن تأكيد سداد طلب ملغي');
    }
    // SF-1 D-SF-09: the conditional UPDATE below also excludes these two
    // statuses, so rejecting them here with a specific message keeps the
    // generic "changed during confirmation" error from ever firing for a
    // status the pre-checks just approved.
    if (order.status === 'payment_failed') {
      throw new BadRequestException('تعذر تأكيد سداد طلب فشل دفعه الإلكتروني؛ راجع حالة الطلب أولاً');
    }
    if (order.status === 'review_required') {
      throw new BadRequestException('تعذر تأكيد سداد طلب بانتظار المراجعة؛ راجع حالة الطلب أولاً');
    }
    if (order.sale_id) {
      throw new BadRequestException('تم إصدار فاتورة لهذا الطلب بالفعل؛ يُسجَّل التحصيل من شاشة الفاتورة');
    }

    const cleanReference = String(reference || '')
      .trim()
      .slice(0, 120);
    const now = new Date();
    const result = await this.db
      .updateTable('online_orders')
      .set({
        payment_status: 'paid',
        gateway_provider: 'manual',
        gateway_transaction_id: cleanReference || null,
        paid_at: now,
        gateway_response_json: JSON.stringify({
          manual: true,
          confirmedByUserId: actor.userId ?? null,
          reference: cleanReference || null,
          confirmedAt: now.toISOString(),
        }),
        updated_at: now,
      })
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where(sql<boolean>`COALESCE(payment_status, 'pending') <> 'paid'`)
      .where('status', 'not in', ['cancelled', 'payment_failed', 'review_required'])
      .where('sale_id', 'is', null)
      .executeTakeFirst();

    if (Number(result?.numUpdatedRows || 0) === 0) {
      throw new BadRequestException('تغيرت حالة الطلب أثناء التأكيد، يرجى تحديث الصفحة');
    }

    // SF-1 D-SF-09: return the stored row, never an optimistic flip — the
    // caller must see the payment status the database actually holds.
    const confirmed = await this.db
      .selectFrom('online_orders')
      .select(['id', 'payment_status', 'gateway_provider', 'paid_at'])
      .where('id', '=', id)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();
    if (!confirmed || confirmed.payment_status !== 'paid') {
      throw new BadRequestException('لم يتم حفظ تأكيد السداد؛ يرجى تحديث الصفحة وإعادة المحاولة');
    }

    return {
      ok: true,
      paymentStatus: confirmed.payment_status,
      gatewayProvider: confirmed.gateway_provider,
      paidAt: confirmed.paid_at ? new Date(confirmed.paid_at).toISOString() : null,
    };
  }
}
