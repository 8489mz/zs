import { BadRequestException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { CreateSalesOrderDto } from '../../dto/sales-order.dto';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { formatDailyDocumentNumber } from '../../../../common/utils/document-number.util';
import { getTenantTimezone } from '../../../../common/utils/tenant-timezone.util';
import { checkClientBusinessDay, CLIENT_BUSINESS_DATE_FUTURE_DAYS } from '../../../../common/utils/client-date-bounds.util';
import { reserveLocationStock } from '../../../../common/utils/location-stock-ledger';
import { assertSalesOrderMoney, recomputeSalesOrderMoney } from '../../helpers/sales-order-money.helper';
import { randomUUID } from 'node:crypto';

export class SalesOrdersCreation {
  constructor(private readonly db: Kysely<Database>, private readonly bound: { resolveOrderWarehouse: (trx: Kysely<Database>, scope: { tenantId: string; accountId: string }, branchId: number | null, requestedLocationId: number | null) => Promise<number | null>; loadServiceProductIds: (trx: Kysely<Database>, scope: { tenantId: string; accountId: string }, productIds: number[]) => Promise<Set<number>> }) {}

  private resolveOrderWarehouse(trx: Kysely<Database>, scope: { tenantId: string; accountId: string }, branchId: number | null, requestedLocationId: number | null): Promise<number | null> {
    return this.bound.resolveOrderWarehouse(trx, scope, branchId, requestedLocationId);
  }
  private loadServiceProductIds(trx: Kysely<Database>, scope: { tenantId: string; accountId: string }, productIds: number[]): Promise<Set<number>> {
    return this.bound.loadServiceProductIds(trx, scope, productIds);
  }

  async createOrder(dto: CreateSalesOrderDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const now = new Date();
    const shouldReserve = dto.autoReserve !== false;
    if (!Array.isArray(dto.items) || dto.items.length === 0 || dto.items.some(item =>
      !Number.isFinite(item.quantity) || item.quantity <= 0 || !Number.isFinite(item.unitPrice) || item.unitPrice < 0)) {
      throw new BadRequestException('أمر البيع يحتاج بنوداً بكميات وأسعار صالحة');
    }
    // R4-A (INV-REST-SALE-MONEY-TRUTH): a missing name used to throw
    // a bare TypeError (500) from dto.customerName.trim() inside the
    // transaction — fail closed with a 400 instead.
    if (typeof dto.customerName !== 'string' || !dto.customerName.trim()) {
      throw new BadRequestException('اسم العميل مطلوب لأمر البيع');
    }
    // R4-A (INV-REST-SALE-MONEY-TRUTH): the header totals are
    // client-supplied and were stored verbatim — per-line totals,
    // the gross subtotal, and subtotal - discount + tax must all
    // reconcile with the lines before anything is stored or
    // reserved. Throws SALES_ORDER_LINE_MISMATCH /
    // SALES_ORDER_TOTAL_MISMATCH (400).
    assertSalesOrderMoney(
      recomputeSalesOrderMoney(dto.items, dto.discountAmount ?? 0, dto.taxAmount ?? 0),
      {
        lineTotals: dto.items.map((item) => item.total),
        subtotal: dto.subtotal,
        total: dto.totalAmount,
      },
    );
    // Single-server-clock rule (P6, RC-5): the order DTO is a plain
    // interface with no validators, so these dates arrived unguarded
    // (new Date(garbage) stored verbatim). Both are future by nature —
    // a delivery date and a reservation expiry — so they must parse and
    // fall inside [today, today+365d] in the tenant zone. The DTO stays
    // a plain interface: converting it to a decorated class would need
    // EVERY field decorated (the global pipe is whitelist +
    // forbidNonWhitelisted), which is a separate package.
    const orderTz = await getTenantTimezone(this.db, scope.tenantId);
    if (dto.deliveryDate) {
      const deliveryDay = checkClientBusinessDay(dto.deliveryDate, orderTz, {
        minDayOffset: 0,
        maxDayOffset: CLIENT_BUSINESS_DATE_FUTURE_DAYS,
      });
      if (!deliveryDay.ok) {
        throw new BadRequestException('تاريخ التسليم غير صالح أو خارج النطاق المسموح (اليوم حتى سنة من الآن).');
      }
    }
    if (dto.reservationExpiresAt) {
      const expiryDay = checkClientBusinessDay(dto.reservationExpiresAt, orderTz, {
        minDayOffset: 0,
        maxDayOffset: CLIENT_BUSINESS_DATE_FUTURE_DAYS,
      });
      if (!expiryDay.ok) {
        throw new BadRequestException('تاريخ انتهاء الحجز غير صالح أو خارج النطاق المسموح (اليوم حتى سنة من الآن).');
      }
    }
    const initialStatus = shouldReserve ? 'confirmed' : 'draft';

    const result = await this.db.transaction().execute(async (trx) => {
      const businessTz = await getTenantTimezone(trx, scope.tenantId);
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
        // INV-SALES-ORDER-WAREHOUSE-SELECTION: the selected warehouse
        // wins; the branch default applies only when none was chosen.
        resolvedLocationId = await this.resolveOrderWarehouse(trx, scope, resolvedBranchId, dto.warehouseLocationId ?? null);
      } else if (dto.warehouseLocationId != null) {
        // Draft with an explicit warehouse: validate and store it now
        // so confirmAndReserve later reserves in the same warehouse.
        resolvedLocationId = await this.resolveOrderWarehouse(trx, scope, resolvedBranchId, dto.warehouseLocationId);
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
          warehouse_location_id: resolvedLocationId,
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
        .set({ order_number: formatDailyDocumentNumber('SO', Number(order.id), new Date(), 4, businessTz) })
        .where('id', '=', order.id).where('tenant_id', '=', scope.tenantId).execute();

      // INV-SERVICE-STOCK-NO-STOCK-CHECK: services sell without stock —
      // they reserve nothing (reserveLocationStock would throw
      // INSUFFICIENT_STOCK on a 0-stock service line) and stamp no
      // phantom reserved_quantity. Conversion releases only reserved
      // lines, so a 0 here also means no release is handed to createSale.
      const serviceProductIds = await this.loadServiceProductIds(trx, scope, (dto.items || []).map((item) => Number(item.productId)));

      if (dto.items && dto.items.length > 0) {
        for (const item of dto.items) {
          const qty = Number(item.quantity);
          const reservedQty = shouldReserve && !serviceProductIds.has(Number(item.productId)) ? qty : 0;

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
          items: dto.items
            .filter((item) => !serviceProductIds.has(Number(item.productId)))
            .map(item => ({ productId: item.productId, qty: Number(item.quantity) })),
        });
      }

      return { ...order, order_number: formatDailyDocumentNumber('SO', Number(order.id), new Date(), 4, businessTz) };
    });

    return {
      ok: true,
      message: shouldReserve
        ? 'تم إنشاء أمر البيع وحجز الكميات في المخزون بنجاح'
        : 'تم حفظ مسودة أمر البيع بنجاح',
      order: result,
    };
  }
}
