import { Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../common/utils/document-number.util';
import { CreatePurchaseOrderDto, UpdatePurchaseOrderDto } from '../dto/purchase-order.dto';
import { PurchasesWriteService } from './purchases-write.service';
import { ApprovalWorkflowService } from '../../approvals/approval-workflow.service';
import { computeInvoiceTotals } from '../../../common/utils/invoice-totals';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../accounting/engines/money-minor-units.engine';
import { calculatePurchaseOrderTotals } from '../engines/purchase-order-totals.engine';

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly purchasesWrite: PurchasesWriteService,
    private readonly approvals: ApprovalWorkflowService,
  ) {}

  private async assertOrderReferences(trx: Kysely<Database>, tenantId: string,
    supplierId: number | null | undefined, warehouseId: number | null | undefined,
    productIds: number[]): Promise<void> {
    if (supplierId != null && !await trx.selectFrom('suppliers').select('id')
      .where('tenant_id', '=', tenantId).where('id', '=', supplierId).executeTakeFirst()) {
      throw new BadRequestException('المورد لا يتبع المنشأة.');
    }
    if (warehouseId != null && !await trx.selectFrom('stock_locations').select('id')
      .where('tenant_id', '=', tenantId).where('id', '=', warehouseId).executeTakeFirst()) {
      throw new BadRequestException('المخزن لا يتبع المنشأة.');
    }
    const ids = [...new Set(productIds.map(Number))];
    if (ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new BadRequestException('أحد أصناف أمر الشراء غير صالح.');
    if (ids.length && (await trx.selectFrom('products').select('id')
      .where('tenant_id', '=', tenantId).where('id', 'in', ids).execute()).length !== ids.length) {
      throw new BadRequestException('أحد أصناف أمر الشراء لا يتبع المنشأة.');
    }
  }

  async listOrders(
    auth: AuthContext,
    query?: { status?: string; search?: string; limit?: number; offset?: number }
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    let qb = this.db
      .selectFrom('purchase_orders')
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
          eb('supplier_name', 'ilike', term),
          eb('supplier_phone', 'ilike', term),
        ]),
      );
    }

    const limit = query?.limit ? Math.min(query.limit, 100) : 50;
    const offset = query?.offset || 0;

    const items = await qb.orderBy('created_at', 'desc').limit(limit).offset(offset).execute();

    // Summary counts by status
    const counts = await this.db
      .selectFrom('purchase_orders')
      .select(['status', sql<number>`count(*)::int`.as('count')])
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .groupBy('status')
      .execute();

    const statusCounts: Record<string, number> = {
      all: 0,
      draft: 0,
      confirmed: 0,
      partially_received: 0,
      received: 0,
      converted_to_bill: 0,
      cancelled: 0,
      pending_approval: 0,
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
      .selectFrom('purchase_orders')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!order) {
      throw new NotFoundException('أمر الشراء غير موجود');
    }

    const items = await this.db
      .selectFrom('purchase_order_items as poi')
      .leftJoin('products as p', (j) => j.onRef('p.id', '=', 'poi.product_id').onRef('p.tenant_id', '=', 'poi.tenant_id'))
      .select([
        'poi.id',
        'poi.purchase_order_id',
        'poi.product_id',
        'poi.product_name',
        'poi.unit_name',
        'poi.quantity',
        'poi.received_quantity',
        'poi.unit_cost',
        'poi.tax_rate',
        'poi.discount',
        'poi.total',
        'poi.notes',
        'p.stock_qty as current_stock',
      ])
      .where('poi.purchase_order_id', '=', id)
      .where('poi.tenant_id', '=', scope.tenantId)
      .execute();

    return {
      order,
      items,
    };
  }

  async createOrder(payload: CreatePurchaseOrderDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);

    if (!payload.items || payload.items.length === 0) {
      throw new BadRequestException('يجب إضافة صنف واحد على الأقل في أمر الشراء');
    }
    // Book digits from the tenant's base currency (P2 pattern, pool handle:
    // no transaction is open yet). Stored totals keep book precision.
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const totals = calculatePurchaseOrderTotals(payload.items, payload.discountAmount, digits);

    // The approval outcome is decided inside the same transaction so a
    // create-with-approve can never land as a draft (and a draft create
    // never claims approval). The check is the same gate confirmOrder
    // runs; the pending-approval notification is sent after commit,
    // exactly as confirmOrder does. The outcome travels out via the
    // transaction's return value (never via outer lets: assignments
    // inside the callback are invisible to the caller's narrowing).
    const created = await this.db.transaction().execute(async (trx) => {
    let approval: { requiresApproval: boolean } | null = null;
    let finalStatus: 'draft' | 'confirmed' | 'pending_approval' = 'draft';
    await this.assertOrderReferences(trx, scope.tenantId, payload.supplierId, payload.warehouseId,
      payload.items.map((item) => item.productId));
    const insertedOrder = await trx
      .insertInto('purchase_orders')
      .values({
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
        order_number: `PO-TMP-${randomUUID()}`,
        supplier_id: payload.supplierId || null,
        supplier_name: payload.supplierName,
        supplier_phone: payload.supplierPhone || null,
        warehouse_id: payload.warehouseId || null,
        warehouse_name: payload.warehouseName || null,
        subtotal: totals.subtotal,
        tax_amount: totals.taxAmount,
        discount_amount: totals.discountAmount,
        total_amount: totals.totalAmount,
        status: 'draft',
        expected_delivery_date: payload.expectedDeliveryDate || null,
        notes: payload.notes || null,
        terms_conditions: payload.termsConditions || null,
        created_by: auth.userId ? Number(auth.userId) : null,
      })
      .returning(['id', 'order_number'])
      .executeTakeFirstOrThrow();

    const orderId = Number(insertedOrder.id);
    const orderNumber = formatDailyDocumentNumber('PO', orderId);
    await trx.updateTable('purchase_orders').set({ order_number: orderNumber })
      .where('id', '=', orderId).where('tenant_id', '=', scope.tenantId).execute();

    for (const [index, item] of payload.items.entries()) {
      await trx
        .insertInto('purchase_order_items')
        .values({
          tenant_id: scope.tenantId,
          account_id: scope.accountId,
          purchase_order_id: orderId,
          product_id: item.productId,
          product_name: item.productName,
          unit_name: item.unitName || null,
          quantity: item.quantity,
          received_quantity: 0,
          unit_cost: item.unitCost,
          tax_rate: item.taxRate || 0,
          discount: item.discount || 0,
          total: totals.lineTotals[index],
          notes: item.notes || null,
        })
        .execute();
    }

    if (payload.submitForApproval) {
      approval = await this.approvals.checkAndInitiateApproval({
        module: 'purchase_orders', recordId: orderId, recordRef: orderNumber,
        amount: totals.totalAmount,
      }, auth, trx);
      finalStatus = approval.requiresApproval ? 'pending_approval' : 'confirmed';
      await trx.updateTable('purchase_orders').set({ status: finalStatus, updated_at: new Date() })
        .where('id', '=', orderId).where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId).execute();
    }

    return { orderId, orderNumber, approval, finalStatus };
    });
    if (created.approval?.requiresApproval) {
      this.approvals.notifyPendingApproval(scope.tenantId, created.orderNumber, totals.totalAmount);
    }

    return {
      success: true,
      id: created.orderId,
      orderNumber: created.orderNumber,
      status: created.finalStatus,
      message: created.finalStatus === 'confirmed'
        ? 'تم اعتماد أمر الشراء بنجاح'
        : created.finalStatus === 'pending_approval'
          ? 'أمر الشراء بانتظار موافقة مدير آخر'
          : 'تم إنشاء أمر الشراء بنجاح',
    };
  }

  async updateOrder(id: number, payload: UpdatePurchaseOrderDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    await this.db.transaction().execute(async (trx) => {
      const order = await trx
        .selectFrom('purchase_orders')
        .selectAll()
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .forUpdate()
        .executeTakeFirst();

      if (!order) {
        throw new NotFoundException('أمر الشراء غير موجود');
      }

      if (order.status !== 'draft') {
        throw new BadRequestException('يمكن تعديل أمر الشراء في حالة المسودة فقط');
      }
      if (payload.status && payload.status !== 'draft') throw new BadRequestException('تغيير حالة أمر الشراء يتم عبر مسار الاعتماد فقط');
      if (payload.items && !payload.items.length) throw new BadRequestException('أمر الشراء يحتاج بنداً واحداً على الأقل.');
      await this.assertOrderReferences(trx, scope.tenantId,
        payload.supplierId !== undefined ? payload.supplierId : order.supplier_id,
        payload.warehouseId !== undefined ? payload.warehouseId : order.warehouse_id,
        (payload.items || []).map((item) => item.productId));
      const itemsForTotals = payload.items || await trx.selectFrom('purchase_order_items')
        .select(['quantity', 'unit_cost', 'tax_rate'])
        .where('purchase_order_id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .execute().then(rows => rows.map(item => ({
          quantity: Number(item.quantity), unitCost: Number(item.unit_cost),
          taxRate: Number(item.tax_rate || 0),
        })));
      if (!itemsForTotals) throw new BadRequestException('أمر الشراء يحتاج بنداً واحداً على الأقل.');
      // Book digits on the transaction handle (never the pool inside an
      // open transaction). Stored totals keep book precision.
      const digits = currencyMoneyDigits(await tenantBaseCurrency(trx, scope.tenantId));
      const totals = calculatePurchaseOrderTotals(itemsForTotals, payload.discountAmount ?? Number(order.discount_amount || 0), digits);

      const updated = await trx
        .updateTable('purchase_orders')
        .set({
          supplier_id: payload.supplierId !== undefined ? payload.supplierId : order.supplier_id,
          supplier_name: payload.supplierName || order.supplier_name,
          supplier_phone: payload.supplierPhone !== undefined ? payload.supplierPhone : order.supplier_phone,
          warehouse_id: payload.warehouseId !== undefined ? payload.warehouseId : order.warehouse_id,
          warehouse_name: payload.warehouseName !== undefined ? payload.warehouseName : order.warehouse_name,
          subtotal: totals.subtotal,
          tax_amount: totals.taxAmount,
          discount_amount: totals.discountAmount,
          total_amount: totals.totalAmount,
          expected_delivery_date: payload.expectedDeliveryDate ? (payload.expectedDeliveryDate as any) : order.expected_delivery_date,
          notes: payload.notes !== undefined ? payload.notes : order.notes,
          terms_conditions: payload.termsConditions !== undefined ? payload.termsConditions : order.terms_conditions,
          status: 'draft',
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .where('status', '=', 'draft')
        .executeTakeFirst();
      if (Number(updated.numUpdatedRows) !== 1) throw new BadRequestException('أمر الشراء لم يعد مسودة');

      if (payload.items && payload.items.length > 0) {
        await trx.deleteFrom('purchase_order_items').where('purchase_order_id', '=', id).where('tenant_id', '=', scope.tenantId).execute();
        for (const [index, item] of payload.items.entries()) {
          await trx
            .insertInto('purchase_order_items')
            .values({
              tenant_id: scope.tenantId,
              account_id: scope.accountId,
              purchase_order_id: id,
              product_id: item.productId,
              product_name: item.productName,
              unit_name: item.unitName || null,
              quantity: item.quantity,
              received_quantity: 0,
              unit_cost: item.unitCost,
              tax_rate: item.taxRate || 0,
              discount: item.discount || 0,
              total: totals.lineTotals[index],
              notes: item.notes || null,
            })
            .execute();
        }
      }
    });

    return { success: true, message: 'تم تحديث أمر الشراء بنجاح' };
  }

  async confirmOrder(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const outcome = await this.db.transaction().execute(async (trx) => {
      const order = await trx.selectFrom('purchase_orders').selectAll()
        .where('id', '=', id).where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId).forUpdate().executeTakeFirst();
      if (!order) throw new NotFoundException('أمر الشراء غير موجود');
      if (order.status !== 'draft') throw new BadRequestException('أمر الشراء ليس في حالة مسودة');
      const approval = await this.approvals.checkAndInitiateApproval({
        module: 'purchase_orders', recordId: id, recordRef: order.order_number,
        amount: Number(order.total_amount),
      }, auth, trx);
      await trx.updateTable('purchase_orders').set({
        status: approval.requiresApproval ? 'pending_approval' : 'confirmed', updated_at: new Date(),
      }).where('id', '=', id).where('tenant_id', '=', scope.tenantId).where('account_id', '=', scope.accountId).execute();
      return { approval, orderNumber: order.order_number, amount: Number(order.total_amount) };
    });
    if (outcome.approval.requiresApproval) {
      this.approvals.notifyPendingApproval(scope.tenantId, outcome.orderNumber, outcome.amount);
      return { success: true, status: 'pending_approval', requestId: outcome.approval.requestId,
        message: 'أمر الشراء بانتظار موافقة مدير آخر' };
    }
    return { success: true, status: 'confirmed', message: 'تم اعتماد أمر الشراء بنجاح' };
  }

  // Conversion creates a draft bill without posting inventory at conversion time.

  async convertToBill(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const order = await this.db
      .selectFrom('purchase_orders')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!order) {
      throw new NotFoundException('أمر الشراء غير موجود');
    }

    if (!['confirmed', 'partially_received', 'received'].includes(order.status)) {
      throw new BadRequestException('لا يمكن تحويل أمر شراء غير معتمد إلى فاتورة');
    }

    const items = await this.db
      .selectFrom('purchase_order_items')
      .selectAll()
      .where('purchase_order_id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .orderBy('id', 'asc')
      .execute();

    if (!items.length) {
      throw new BadRequestException('أمر الشراء لا يحتوي على أصناف صالحة للتحويل');
    }
    if (!order.supplier_id) throw new BadRequestException('يجب تحديد مورد صالح قبل تحويل أمر الشراء');
    if (items.some((item) => !Number.isFinite(Number(item.quantity)) || Number(item.quantity) <= 0
      || !Number.isFinite(Number(item.unit_cost)) || Number(item.unit_cost) <= 0)) {
      throw new BadRequestException('بنود أمر الشراء تحتوي كمية أو تكلفة غير صالحة');
    }
    // Gate recomputation at book digits, matching the stored totals; the
    // 0.01 reconciliation tolerance is unchanged (policy band).
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const subtotal = Number(items.reduce((sum, item) => sum + Number(item.quantity) * Number(item.unit_cost), 0).toFixed(digits));
    const discount = Number(order.discount_amount || 0);
    const taxAmount = Number(order.tax_amount || 0);
    if (!Number.isFinite(subtotal) || !Number.isFinite(discount) || !Number.isFinite(taxAmount)
      || !Number.isFinite(Number(order.total_amount)) || discount < 0 || discount > subtotal || taxAmount < 0) {
      throw new BadRequestException('إجماليات أمر الشراء غير صالحة');
    }
    const taxableBase = subtotal - discount;
    if (taxAmount > 0 && taxableBase <= 0) throw new BadRequestException('ضريبة أمر الشراء غير صالحة');
    const taxRate = taxableBase > 0 ? (taxAmount / taxableBase) * 100 : 0;
    const calculated = computeInvoiceTotals(subtotal, discount, taxRate, false);
    if (Math.abs(calculated.total - Number(order.total_amount)) > 0.01) {
      throw new BadRequestException('إجمالي أمر الشراء لا يطابق بنوده؛ راجع القيم قبل التحويل');
    }

    // Call purchasesWrite service to create formal purchase bill
    const purchasePayload = {
      supplierId: order.supplier_id,
      supplierInvoiceNo: `INV-${order.order_number}`,
      paymentType: 'credit' as const,
      lifecycleStatus: 'purchase_order',
      discount,
      taxRate,
      items: items.map((item) => ({
        productId: item.product_id,
        qty: Number(item.quantity),
        cost: Number(item.unit_cost),
        unitName: item.unit_name || 'قطعة',
      })),
      note: `فاتورة محولة تلقائياً من أمر الشراء #${order.order_number}`,
    };

    const res = await this.purchasesWrite.createPurchase(purchasePayload, auth, `purchase-order-conversion-${id}`);
    const createdPurchaseId = Number((res as any)?.purchaseId || (res as any)?.purchase?.id || 0);
    if (!createdPurchaseId) throw new BadRequestException('لم يتم إنشاء فاتورة مشتريات صالحة');

    try {
      await this.db.transaction().execute(async (trx) => {
        const lockedOrder = await trx.selectFrom('purchase_orders').select(['id', 'status'])
          .where('id', '=', id).where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId).forUpdate().executeTakeFirst();
        if (!lockedOrder || !['confirmed', 'partially_received', 'received'].includes(lockedOrder.status)) {
          throw new BadRequestException('تغيرت حالة أمر الشراء أثناء تحويل الفاتورة.');
        }
        const existingReceiptBill = await trx.selectFrom('purchases').select('id')
          .where('tenant_id', '=', scope.tenantId).where('po_id', '=', id)
          .where('lifecycle_status', '=', 'grn_bill').where('status', '!=', 'cancelled')
          .executeTakeFirst();
        if (existingReceiptBill) throw new BadRequestException('أمر الشراء مرتبط بالفعل بفاتورة محاضر استلام.');
        const linked = await trx.updateTable('purchases').set({ po_id: id })
          .where('id', '=', createdPurchaseId).where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId).execute();
        if (Number(linked[0]?.numUpdatedRows || 0) !== 1) throw new BadRequestException('فاتورة المشتريات غير موجودة للربط');
        const billItems = await trx.selectFrom('purchase_items').select(['id', 'product_id'])
          .where('purchase_id', '=', createdPurchaseId).where('tenant_id', '=', scope.tenantId)
          .orderBy('id', 'asc').execute();
        if (billItems.length !== items.length) throw new BadRequestException('تعذر ربط بنود الفاتورة بأمر الشراء');
        for (const [index, billItem] of billItems.entries()) {
          const source = items[index];
          if (!source || Number(source.product_id) !== Number(billItem.product_id)) {
            throw new BadRequestException('تعذر ربط بنود الفاتورة بأمر الشراء');
          }
          await trx.updateTable('purchase_items').set({ po_item_id: source.id })
            .where('id', '=', billItem.id).where('tenant_id', '=', scope.tenantId).execute();
        }
        const converted = await trx.updateTable('purchase_orders').set({
          status: 'converted_to_bill', converted_purchase_id: createdPurchaseId, updated_at: new Date(),
        }).where('id', '=', id).where('tenant_id', '=', scope.tenantId)
          .where('account_id', '=', scope.accountId).where('status', '=', order.status).execute();
        if (Number(converted[0]?.numUpdatedRows || 0) !== 1) throw new BadRequestException('تغيرت حالة أمر الشراء أثناء التحويل');
      });
    } catch (error) {
      // Clean up orphaned draft purchase if linking failed (ZS-062)
      await this.db.transaction().execute(async (trx) => {
        await trx.deleteFrom('purchase_items').where('purchase_id', '=', createdPurchaseId).where('tenant_id', '=', scope.tenantId).execute();
        await trx.deleteFrom('purchases').where('id', '=', createdPurchaseId).where('tenant_id', '=', scope.tenantId).execute();
      }).catch(() => undefined);
      throw error;
    }

    return {
      success: true,
      convertedPurchaseId: createdPurchaseId,
      message: 'تم تحويل أمر الشراء إلى فاتورة مشتريات رسمية بنجاح',
    };
  }

  async cancelOrder(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const order = await this.db
      .selectFrom('purchase_orders')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!order) {
      throw new NotFoundException('أمر الشراء غير موجود');
    }

    if (!['draft', 'confirmed'].includes(order.status)) {
      throw new BadRequestException('لا يمكن إلغاء أمر شراء في حالته الحالية');
    }

    const updated = await this.db
      .updateTable('purchase_orders')
      .set({ status: 'cancelled', updated_at: new Date() })
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .where('status', 'in', ['draft', 'confirmed'])
      .executeTakeFirst();
    if (Number(updated.numUpdatedRows) !== 1) throw new BadRequestException('حالة أمر الشراء تغيرت؛ لا يمكن إلغاؤه');

    return { success: true, message: 'تم إلغاء أمر الشراء بنجاح' };
  }

  async deleteOrder(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const order = await this.db
      .selectFrom('purchase_orders')
      .selectAll()
      .where('id', '=', id)
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .executeTakeFirst();

    if (!order) {
      throw new NotFoundException('أمر الشراء غير موجود');
    }

    if (order.status !== 'draft' && order.status !== 'cancelled') {
      throw new BadRequestException('يمكن حذف أوامر الشراء المسودة أو الملغاة فقط');
    }

    await this.db.transaction().execute(async (trx) => {
      const locked = await trx.selectFrom('purchase_orders').select('status')
        .where('id', '=', id).where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId).forUpdate().executeTakeFirst();
      if (!locked || !['draft', 'cancelled'].includes(locked.status)) {
        throw new BadRequestException('حالة أمر الشراء تغيرت؛ لا يمكن حذفه');
      }
      await trx.deleteFrom('purchase_order_items').where('purchase_order_id', '=', id).where('tenant_id', '=', scope.tenantId).execute();
      await trx.deleteFrom('purchase_orders').where('id', '=', id).where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId).execute();
    });

    return { success: true, message: 'تم حذف أمر الشراء بنجاح' };
  }
}
