import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { SalesWriteService } from '../sales-write.service';
import type { IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { idempotencyStorage } from '../../../../core/idempotency/idempotency.context';
import {
  conversionRecoverySaleId,
  decideConversionRecovery,
  resolveConversionDiscounts,
  resolveConversionPaymentTerms,
} from '../../helpers/sales-write.helper';
import { assertSalesOrderMoney, recomputeSalesOrderMoney } from '../../helpers/sales-order-money.helper';

export class SalesOrdersConversion {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly salesWrite: SalesWriteService,
    private readonly idempotency: IdempotencyService,
    private readonly bound: {
      conversionOperationParams: (
        scope: { tenantId: string; accountId: string },
        idemKey: string,
      ) => { tenantId: string; accountId: string; idempotencyKey: string; operationType: string };
      markOrderConverted: (id: number, scope: { tenantId: string; accountId: string }, saleId: number) => Promise<void>;
      revertConvertingClaim: (id: number, scope: { tenantId: string; accountId: string }) => Promise<void>;
    },
  ) {}

  private conversionOperationParams(
    scope: { tenantId: string; accountId: string },
    idemKey: string,
  ): { tenantId: string; accountId: string; idempotencyKey: string; operationType: string } {
    return this.bound.conversionOperationParams(scope, idemKey);
  }
  private async markOrderConverted(
    id: number,
    scope: { tenantId: string; accountId: string },
    saleId: number,
  ): Promise<void> {
    return this.bound.markOrderConverted(id, scope, saleId);
  }
  private async revertConvertingClaim(id: number, scope: { tenantId: string; accountId: string }): Promise<void> {
    return this.bound.revertConvertingClaim(id, scope);
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

    // INV-CONVERSION-STOCK-DEDUCTION (extended by
    // INV-SALES-ORDER-WAREHOUSE-SELECTION): resolve the conversion
    // location from the ORDER's stored warehouse first — the order
    // was reserved in that warehouse, so its release and the sale
    // deduction must come from the same warehouse, not only when
    // reserved items exist. Legacy orders created before
    // warehouse_location_id existed (null warehouse) fall back to
    // the branch default, exactly like a POS sale. A branch with no
    // default location keeps the prior null-location behaviour
    // (locationId null); createSale's explicit-location validation
    // still fails closed when a resolved location is deleted or
    // inactive.
    let locationId: number | null = null;
    if (order.warehouse_location_id) {
      locationId = Number(order.warehouse_location_id);
    } else {
      const branchRow = await this.db
        .selectFrom('branches')
        .select(['default_stock_location_id'])
        .where('id', '=', branchId)
        .where('tenant_id', '=', scope.tenantId)
        .executeTakeFirst();
      locationId = branchRow?.default_stock_location_id ? Number(branchRow.default_stock_location_id) : null;
    }
    const conversionRelease =
      releaseItems.length > 0
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

      // R4-A (INV-REST-SALE-MONEY-TRUTH): the stored total_amount is
      // client-supplied and was paid verbatim as the cash leg — a
      // stored total inflated with extras became overpayment/change,
      // a deflated one threw INVALID_PAID_AMOUNT or silently became
      // credit. Assert the stored total equals the recomputed total
      // (throws SALES_ORDER_TOTAL_MISMATCH before any sale is
      // created) and build the cash payment from the RECOMPUTED
      // total, never from the stored one. Per-line totals are
      // deliberately not asserted here: a stale per-line total is
      // inert display data at conversion.
      const recomputedOrderMoney = recomputeSalesOrderMoney(
        items.map((item) => ({
          quantity: item.quantity,
          unitPrice: item.unit_price,
          discount: item.discount,
        })),
        order.discount_amount,
        order.tax_amount,
      );
      assertSalesOrderMoney(recomputedOrderMoney, { total: order.total_amount });

      // Prepare sale items
      const saleItems = items.map((item, index) => ({
        productId: Number(item.product_id),
        qty: Number(item.quantity),
        price: Number(item.unit_price),
        lineDiscount: lineDiscounts[index],
        unitName: item.unit_name || undefined,
      }));

      const totalAmount = recomputedOrderMoney.total;

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
        payments:
          paymentTerms === 'credit'
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
}
