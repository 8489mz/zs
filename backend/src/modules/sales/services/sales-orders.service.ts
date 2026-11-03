import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { CreateSalesOrderDto, UpdateSalesOrderDto } from '../dto/sales-order.dto';
import { SalesWriteService } from './sales-write.service';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { randomUUID } from 'node:crypto';
import { reserveLocationStock, releaseLocationStock } from '../../../common/utils/location-stock-ledger';
import { idempotencyStorage } from '../../../core/idempotency/idempotency.context';
import { IdempotencyService } from '../../../core/idempotency/idempotency.service';
import { conversionRecoverySaleId, decideConversionRecovery, resolveConversionDiscounts, resolveConversionPaymentTerms } from '../helpers/sales-write.helper';

@Injectable()
export class SalesOrdersService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly salesWrite: SalesWriteService,
    // Optional: Nest DI provides the global IdempotencyService, but
    // specs and harnesses construct this service by hand with two
    // arguments — fall back to a real instance over the same db so
    // conversion recovery never runs against an undefined service.
    idempotency?: IdempotencyService,
  ) {
    this.idempotency = idempotency ?? new IdempotencyService(db as any);
  }

  private readonly idempotency: IdempotencyService;

  /** Durable conversion-operation row for one sales order's claim. */
  private conversionOperationParams(scope: { tenantId: string; accountId: string }, idemKey: string) {
    return {
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      idempotencyKey: idemKey,
      operationType: 'sale',
    };
  }

  /** Guarded claim revert: converting -> confirmed, only while converting. */
  private async revertConvertingClaim(id: number, scope: { tenantId: string; accountId: string }): Promise<void> {
    await this.db
      .updateTable('sales_orders')
      .set({ status: 'confirmed', updated_at: new Date() })
      .where('id', '=', id)
      .where('status', '=', 'converting')
      .where('tenant_id', '=', scope.tenantId)
      .execute();
  }

  /** Mark the order converted and its items delivered, once a sale id is known. */
  private async markOrderConverted(id: number, scope: { tenantId: string; accountId: string }, saleId: number): Promise<void> {
    await this.db
      .updateTable('sales_orders')
      .set({
        status: 'converted',
        sale_id: saleId,
        updated_at: new Date(),
      })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    await this.db
      .updateTable('sales_order_items')
      .set((eb) => ({
        delivered_quantity: eb.ref('quantity'),
        reserved_quantity: 0,
      }))
      .where('sales_order_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .execute();
  }

  async listOrders(
    auth: AuthContext,
    query?: { status?: string; search?: string; limit?: number; offset?: number }
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

    return { ...order, items };
  }

  async createOrder(dto: CreateSalesOrderDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const now = new Date();
    const shouldReserve = dto.autoReserve !== false;
    if (!Array.isArray(dto.items) || dto.items.length === 0 || dto.items.some(item =>
      !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) {
      throw new BadRequestException('أمر البيع يحتاج بنوداً بكميات وأسعار صالحة');
    }
    const initialStatus = shouldReserve ? 'confirmed' : 'draft';

    const result = await this.db.transaction().execute(async (trx) => {
      let resolvedBranchId = dto.branchId || null;
      let resolvedLocationId: number | null = null;
      if (shouldReserve) {
        const branch = await trx.selectFrom('branches').select(['id', 'default_stock_location_id'])
          .where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId)
          .$if(resolvedBranchId !== null, qb => qb.where('id', '=', resolvedBranchId!))
          .orderBy('id', 'asc').executeTakeFirst();
        if (!branch) throw new BadRequestException('لا يوجد فرع مسموح لحجز البضاعة');
        resolvedBranchId = Number(branch.id);
        resolvedLocationId = branch.default_stock_location_id ? Number(branch.default_stock_location_id) : null;
      }
      const order = await trx
        .insertInto('sales_orders')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          order_number: `SO-TMP-${randomUUID()}`,
          customer_id: dto.customerId || null,
          customer_name: dto.customerName.trim(),
          customer_phone: dto.customerPhone?.trim() || null,
          customer_address: dto.customerAddress?.trim() || null,
          branch_id: resolvedBranchId,
          subtotal: dto.subtotal,
          discount_amount: dto.discountAmount || 0,
          tax_amount: dto.taxAmount || 0,
          total_amount: dto.totalAmount,
          status: initialStatus,
          reservation_expires_at: dto.reservationExpiresAt ? new Date(dto.reservationExpiresAt) : null,
          delivery_date: dto.deliveryDate ? new Date(dto.deliveryDate) : null,
          quotation_id: dto.quotationId || null,
          notes: dto.notes?.trim() || null,
          terms_conditions: dto.termsConditions?.trim() || null,
          created_by: auth.userId ? Number(auth.userId) : null,
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await trx.updateTable('sales_orders')
        .set({ order_number: formatDailyDocumentNumber('SO', Number(order.id)) })
        .where('id', '=', order.id).where('tenant_id', '=', scope.tenantId).execute();

      if (dto.items && dto.items.length > 0) {
        for (const item of dto.items) {
          const qty = Number(item.quantity);
          const reservedQty = shouldReserve ? qty : 0;

          await trx
            .insertInto('sales_order_items')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              sales_order_id: order.id,
              product_id: item.productId,
              product_name: item.productName.trim(),
              unit_name: item.unitName?.trim() || null,
              quantity: qty,
              reserved_quantity: reservedQty,
              delivered_quantity: 0,
              unit_price: item.unitPrice,
              discount: item.discount || 0,
              total: item.total,
              notes: item.notes?.trim() || null,
              created_at: now,
            })
            .execute();


        }
      }

      if (shouldReserve) {
        await reserveLocationStock(trx, {
          branchId: resolvedBranchId,
          locationId: resolvedLocationId,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          items: dto.items.map(item => ({ productId: item.productId, qty: Number(item.quantity) })),
        });
      }

      return { ...order, order_number: formatDailyDocumentNumber('SO', Number(order.id)) };
    });

    return {
      ok: true,
      message: shouldReserve
        ? 'تم إنشاء أمر البيع وحجز الكميات في المخزون بنجاح'
        : 'تم حفظ مسودة أمر البيع بنجاح',
      order: result,
    };
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

      // Resolve branch and location
      let branchId = order.branch_id;
      let locationId: number | null = null;
      if (!branchId) {
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

      const reserveItems: Array<{ productId: number; qty: number }> = [];
      for (const item of items) {
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
        let locationId: number | null = null;
        if (order.branch_id) {
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

  async convertToSale(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
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

    if (order.status === 'converted' && order.sale_id) {
      return { ok: true, message: 'تم تحويل أمر البيع مسبقاً إلى فاتورة', saleId: order.sale_id };
    }
    // INV-CONVERSION-LIFECYCLE-RACES: 'converting' is let through
    // to the claim below on purpose — the claim fails, and the
    // recovery branch decides from the operation row whether the
    // conversion is live, stranded, or already done. Rejecting it
    // here (as the old gate did) made recovery unreachable.
    if (order.status !== 'confirmed' && order.status !== 'converting') {
      throw new BadRequestException('لا يمكن تحويل أمر بيع مسودة أو ملغي إلى فاتورة');
    }

    // INV-CONVERSION-LIFECYCLE-RACES: the conversion's durable
    // idempotency key. Until this package the key was inert: nothing
    // ever reserved an operation_executions row for it (no
    // interceptor on this route, no reserve call), so the
    // AsyncLocalStorage context only mattered if a row already
    // existed — and the stuck-'converting' recovery the grounding
    // proposed (re-attach via the key) had nothing to attach to.
    // The reservation below makes the key durable: the row is
    // inserted before createSale runs and committed atomically
    // inside the sale transaction by createSale itself, so its
    // state is the proof of whether the sale exists.
    const idemKey = `so_convert_${scope.tenantId}_${id}`;
    const idemHash = this.idempotency.generateRequestHash({ conversion: 'sales_order', id });
    const idemParams = this.conversionOperationParams(scope, idemKey);

    // Atomic state transition: confirmed -> converting to prevent concurrent duplicate conversion (ZS-075)
    const locked = await this.db
      .updateTable('sales_orders')
      .set({ status: 'converting', updated_at: new Date() } as any)
      .where('id', '=', id)
      .where('status', '=', 'confirmed')
      .where('tenant_id', '=', scope.tenantId)
      .returningAll()
      .executeTakeFirst();

    if (!locked) {
      const current = await this.db
        .selectFrom('sales_orders')
        .select(['status', 'sale_id', 'updated_at'])
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      if (current?.status === 'converted' && current.sale_id) {
        return { ok: true, message: 'تم تحويل أمر البيع مسبقاً إلى فاتورة', saleId: current.sale_id };
      }
      if (current?.status === 'converting') {
        // INV-CONVERSION-LIFECYCLE-RACES: a 'converting' order is
        // either mid-conversion or stranded by a dead process.
        // Decide from the durable operation row, never from the
        // status alone (see decideConversionRecovery): a committed
        // row re-attaches the existing sale; a live claim fails
        // closed; a stale claim reverts and re-claims atomically,
        // so a concurrent converter that wins the re-claim still
        // cannot produce a second sale.
        const row = await this.idempotency.getOperationState(idemParams);
        const verdict = decideConversionRecovery(row, current.updated_at);
        if (verdict === 'attach') {
          const saleId = conversionRecoverySaleId(row);
          if (!saleId) {
            throw new BadRequestException('تعذر تحديد فاتورة تحويل أمر البيع العالق؛ يلزم تدخل يدوي');
          }
          await this.markOrderConverted(id, scope, saleId);
          return { ok: true, message: 'تم تحويل أمر البيع مسبقاً إلى فاتورة', saleId };
        }
        if (verdict === 'in-flight') {
          throw new BadRequestException('أمر البيع قيد التحويل حالياً أو تم تغيير حالته');
        }
        await this.revertConvertingClaim(id, scope);
        const relocked = await this.db
          .updateTable('sales_orders')
          .set({ status: 'converting', updated_at: new Date() } as any)
          .where('id', '=', id)
          .where('status', '=', 'confirmed')
          .where('tenant_id', '=', scope.tenantId)
          .returningAll()
          .executeTakeFirst();
        if (!relocked) {
          throw new BadRequestException('أمر البيع قيد التحويل حالياً أو تم تغيير حالته');
        }
      } else {
        throw new BadRequestException('أمر البيع قيد التحويل حالياً أو تم تغيير حالته');
      }
    }

    const items = await this.db
      .selectFrom('sales_order_items')
      .selectAll()
      .where('sales_order_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .execute();

    if (items.length === 0) {
      await this.db
        .updateTable('sales_orders')
        .set({ status: 'confirmed', updated_at: new Date() })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
      throw new BadRequestException('لا يمكن تحويل أمر بيع فارغ إلى فاتورة');
    }

    // Resolve branch
    let branchId = order.branch_id;
    if (!branchId) {
      const primaryBranch = await this.db
        .selectFrom('branches')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('id', 'asc')
        .executeTakeFirst();
      branchId = primaryBranch ? Number(primaryBranch.id) : 1;
    }

    // INV-SALES-ORDER-CONVERSION-STOCK-LEGS: the reservation is NOT
    // released here. It travels with the sale payload into createSale,
    // which releases it inside the sale transaction (under the product
    // locks, before the stock deduction) — so a failed sale rolls the
    // release back with it and no re-reserve is ever needed. Releasing
    // on the pool handle first exposed the freed stock to concurrent
    // sales and left the swallowed re-reserve as the only recovery.
    const releaseItems: Array<{ productId: number; qty: number }> = [];
    for (const item of items) {
      const reservedQty = Number(item.reserved_quantity || 0);
      if (reservedQty > 0) {
        releaseItems.push({
          productId: Number(item.product_id),
          qty: reservedQty,
        });
      }
    }

    // INV-CONVERSION-STOCK-DEDUCTION: resolve the branch default
    // stock location for EVERY conversion, not only when reserved
    // items exist. The payload below carries it into createSale, so
    // a goods conversion deducts from the branch's default location
    // exactly like a POS sale. A branch with no default location
    // keeps the prior null-location behaviour (locationId null);
    // createSale's explicit-location validation still fails closed
    // when a resolved default is deleted or inactive.
    let locationId: number | null = null;
    {
      const branchRow = await this.db
        .selectFrom('branches')
        .select(['default_stock_location_id'])
        .where('id', '=', branchId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      locationId = branchRow?.default_stock_location_id ? Number(branchRow.default_stock_location_id) : null;
    }
    const conversionRelease = releaseItems.length > 0
      ? { salesOrderId: id, branchId: order.branch_id, locationId, items: releaseItems }
      : undefined;

    // INV-CONVERSION-LINE-DISCOUNTS-PRESERVED: reconcile the stored
    // discount rows against each other BEFORE any sale is created
    // (the stored total_amount is client-supplied and never trusted
    // as the target). Throws CONVERSION_DISCOUNT_MISMATCH on any
    // inconsistency; the catch below reverts the 'converting' claim.
    // This block sits INSIDE the try so a reconciliation failure
    // reverts the claim instead of stranding the order 'converting'.
    // INV-CONVERSION-LIFECYCLE-RACES: set just before createSale
    // runs, so the catch records a failure only for an attempt that
    // actually reached the sale writer (a reservation that never
    // reached createSale leaves its row for the recovery decision,
    // never marked failed by a code path that did not run it).
    let saleAttempted = false;
    try {
      // INV-CONVERSION-LIFECYCLE-RACES: reserve the conversion
      // operation BEFORE createSale runs, so a crash at any later
      // point leaves durable evidence. Outcomes: 'committed' means
      // a previous attempt's sale already exists (its marking step
      // never ran) — attach it, never create another; 'processing'
      // here is fresh (reserveOperation reports stale processing as
      // 'recovery_required'), so a conversion may still be live —
      // revert the claim and fail closed; null / 'failed' /
      // 'recovery_required' all mean no sale committed, so proceed
      // (createSale commits the row atomically with the sale).
      const reservation = await this.idempotency.reserveOperation({
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        idempotencyKey: idemKey,
        operationType: 'sale',
        requestHash: idemHash,
      });
      if (reservation?.status === 'committed') {
        const saleId = Number(reservation.documentId) || Number((reservation.responsePayload as any)?.saleId);
        if (!saleId) {
          throw new BadRequestException('تعذر تحديد فاتورة تحويل أمر البيع العالق؛ يلزم تدخل يدوي');
        }
        await this.markOrderConverted(id, scope, saleId);
        return { ok: true, message: 'تم تحويل أمر البيع مسبقاً إلى فاتورة', saleId };
      }
      if (reservation?.status === 'processing') {
        await this.revertConvertingClaim(id, scope);
        throw new BadRequestException('أمر البيع قيد التحويل حالياً أو تم تغيير حالته');
      }

      const { lineDiscounts, globalDiscount } = resolveConversionDiscounts(
        items.map((item) => ({
          quantity: item.quantity,
          unitPrice: item.unit_price,
          discount: item.discount,
        })),
        order.discount_amount,
      );

      // Prepare sale items
      const saleItems = items.map((item, index) => ({
        productId: Number(item.product_id),
        qty: Number(item.quantity),
        price: Number(item.unit_price),
        lineDiscount: lineDiscounts[index],
        unitName: item.unit_name || undefined,
      }));

      const totalAmount = Number(order.total_amount);

      // INV-CONVERSION-PAYMENT-TERMS-CARRIED: carry the stored
      // payment_terms ('cash' | 'credit', van pre-sales only) into the
      // sale payload instead of forcing cash. A credit payload is the
      // sale writer's own full-credit shape (paymentType/paymentChannel
      // 'credit', no payment lines) so createSale's existing
      // customer-required / credit-blocked / credit-limit checks
      // consume it unchanged; an unrecognised stored value throws
      // CONVERSION_PAYMENT_TERMS_UNKNOWN inside this try, so the
      // 'converting' claim reverts exactly like a discount mismatch.
      const paymentTerms = resolveConversionPaymentTerms(order.payment_terms);

      const salePayload: any = {
        branchId,
        locationId,
        customerId: order.customer_id ? Number(order.customer_id) : undefined,
        customerName: order.customer_name,
        customerPhone: order.customer_phone || undefined,
        note: `تم إنشاؤها تحويلاً من أمر البيع #${order.order_number}${order.notes ? ` - ${order.notes}` : ''}`,
        items: saleItems,
        discount: globalDiscount,
        paymentType: paymentTerms,
        paymentChannel: paymentTerms,
        source: 'dashboard',
        payments: paymentTerms === 'credit'
          ? []
          : [
              {
                paymentChannel: 'cash',
                amount: totalAmount,
              },
            ],
      };

      saleAttempted = true;
      const saleResult: any = await idempotencyStorage.run(
        { idempotencyKey: idemKey, operationType: 'sale', accountId: scope.accountId },
        () => this.salesWrite.createSale(salePayload, auth, undefined, conversionRelease),
      );
      const saleId = Number(saleResult?.sale?.id || saleResult?.id);

      // Mark sales order as converted
      await this.markOrderConverted(id, scope, saleId);

      return {
        ok: true,
        message: 'تم تحويل أمر البيع إلى فاتورة بيع بنجاح وتحديث المخزون الفعلي',
        orderId: id,
        saleId,
        sale: saleResult?.sale || saleResult,
      };
    } catch (error) {
      // Revert status to confirmed. No re-reserve: the reservation was
      // only ever released inside the sale transaction, so a failed
      // sale rolled it back with the sale itself. The old swallowed
      // re-reserve (`.catch(() => undefined)`) could silently leave the
      // order confirmed with no reservation at all.
      await this.revertConvertingClaim(id, scope);

      // INV-CONVERSION-LIFECYCLE-RACES: a sale attempt that failed
      // records its failure on the reserved row (guarded: only from
      // 'processing' with no document linked, so a committed sale is
      // never overwritten). The next retry then reserves past a
      // 'failed' row and converts immediately instead of spinning
      // on 'processing' for the 60s stuck threshold.
      if (saleAttempted) {
        const err = error as any;
        const errorCode = err && (err.code || err.name) ? String(err.code || err.name) : 'UNKNOWN_ERROR';
        await this.idempotency.recordFailure(idemParams, errorCode);
      }

      throw error;
    }
  }

  async deleteOrder(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const existing = await this.db
      .selectFrom('sales_orders')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!existing) {
      throw new NotFoundException('أمر البيع غير موجود');
    }

    if (existing.status === 'converted') {
      throw new BadRequestException('لا يمكن حذف أمر بيع تم تحويله إلى فاتورة');
    }

    // INV-CONVERSION-LIFECYCLE-RACES: a 'converting' order holds a
    // reservation the old code stranded — deleteOrder only released
    // for 'confirmed', so deleting a stuck conversion deleted the
    // rows and left the reservation counters held forever. Deleting
    // a LIVE conversion would be worse (its sale transaction
    // releases the same reservation), so the decision is evidence,
    // re-checked under the row lock inside one transaction: a
    // committed operation row means the sale exists (refuse, like
    // 'converted'); a fresh claim/row means a conversion may be
    // running (refuse); only a stale claim with no committed sale
    // releases the reservation and deletes, with the operation row
    // re-read after the product locks in case a sale committed
    // while this transaction waited (the re-read throw rolls the
    // release back with the delete).
    if (existing.status === 'converting') {
      const idemKey = `so_convert_${scope.tenantId}_${id}`;
      const idemParams = this.conversionOperationParams(scope, idemKey);
      await this.db.transaction().execute(async (trx) => {
        const locked = await trx
          .selectFrom('sales_orders')
          .selectAll()
          .where('id', '=', id)
          .where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId)
          .forUpdate()
          .executeTakeFirst();
        if (!locked) {
          throw new NotFoundException('أمر البيع غير موجود');
        }
        if (locked.status === 'converted') {
          throw new BadRequestException('لا يمكن حذف أمر بيع تم تحويله إلى فاتورة');
        }
        if (locked.status !== 'converting') {
          throw new BadRequestException('تغيرت حالة أمر البيع أثناء الحذف؛ أعد المحاولة');
        }
        const row = await this.idempotency.getOperationState(idemParams, trx);
        const verdict = decideConversionRecovery(row, locked.updated_at);
        if (verdict === 'attach') {
          throw new BadRequestException('أمر البيع مرتبط بفاتورة موجودة؛ حوّله أولاً بدل حذفه');
        }
        if (verdict === 'in-flight') {
          throw new BadRequestException('أمر البيع قيد التحويل حالياً أو تم تغيير حالته');
        }

        const items = await trx
          .selectFrom('sales_order_items')
          .selectAll()
          .where('sales_order_id', '=', id)
          .where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId)
          .execute();
        const releaseItems: Array<{ productId: number; qty: number }> = [];
        for (const item of items) {
          const reservedQty = Number(item.reserved_quantity || 0);
          if (reservedQty > 0) {
            releaseItems.push({ productId: Number(item.product_id), qty: reservedQty });
            await trx
              .updateTable('sales_order_items')
              .set({ reserved_quantity: 0 })
              .where('id', '=', Number(item.id))
              .where('tenant_id', '=', scope.tenantId)
              .execute();
          }
        }
        if (releaseItems.length > 0) {
          let locationId: number | null = null;
          if (locked.branch_id) {
            const branchRow = await trx
              .selectFrom('branches')
              .select(['default_stock_location_id'])
              .where('id', '=', locked.branch_id)
              .where('tenant_id', '=', scope.tenantId)
              .executeTakeFirst();
            locationId = branchRow?.default_stock_location_id ? Number(branchRow.default_stock_location_id) : null;
          }
          await releaseLocationStock(trx, {
            branchId: locked.branch_id,
            locationId,
            tenantId: scope.tenantId,
            accountId: scope.accountId,
            items: releaseItems,
          });
        }

        const rechecked = await this.idempotency.getOperationState(idemParams, trx);
        if (rechecked?.status === 'committed') {
          throw new BadRequestException('أمر البيع مرتبط بفاتورة موجودة؛ حوّله أولاً بدل حذفه');
        }

        await trx
          .deleteFrom('sales_order_items')
          .where('sales_order_id', '=', id)
          .where('tenant_id', '=', scope.tenantId)
          .execute();
        await trx
          .deleteFrom('sales_orders')
          .where('id', '=', id)
          .where('tenant_id', '=', scope.tenantId)
          .execute();
      });

      return { ok: true, message: 'تم حذف أمر البيع بنجاح' };
    }

    // Cancel / release stock first
    if (existing.status === 'confirmed') {
      await this.cancelOrder(id, auth);
    }

    await this.db.transaction().execute(async (trx) => {
      await trx
        .deleteFrom('sales_order_items')
        .where('sales_order_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      await trx
        .deleteFrom('sales_orders')
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
    });

    return { ok: true, message: 'تم حذف أمر البيع بنجاح' };
  }
}
