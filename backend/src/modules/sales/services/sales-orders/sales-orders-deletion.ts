import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { IdempotencyService } from '../../../../core/idempotency/idempotency.service';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { decideConversionRecovery } from '../../helpers/sales-write.helper';
import { releaseLocationStock } from '../../../../common/utils/location-stock-ledger';

export class SalesOrdersDeletion {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly idempotency: IdempotencyService,
    private readonly bound: {
      conversionOperationParams: (
        scope: { tenantId: string; accountId: string },
        idemKey: string,
      ) => { tenantId: string; accountId: string; idempotencyKey: string; operationType: string };
      cancelOrder: (id: number, auth: AuthContext) => Promise<Record<string, unknown>>;
    },
  ) {}

  private conversionOperationParams(
    scope: { tenantId: string; accountId: string },
    idemKey: string,
  ): { tenantId: string; accountId: string; idempotencyKey: string; operationType: string } {
    return this.bound.conversionOperationParams(scope, idemKey);
  }
  private async cancelOrder(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    return this.bound.cancelOrder(id, auth);
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
          // INV-SALES-ORDER-WAREHOUSE-SELECTION: release from the
          // order's stored warehouse (see cancelOrder).
          let locationId: number | null = null;
          if (locked.warehouse_location_id) {
            locationId = Number(locked.warehouse_location_id);
          } else if (locked.branch_id) {
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
        await trx.deleteFrom('sales_orders').where('id', '=', id).where('tenant_id', '=', scope.tenantId).execute();
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

      await trx.deleteFrom('sales_orders').where('id', '=', id).where('tenant_id', '=', scope.tenantId).execute();
    });

    return { ok: true, message: 'تم حذف أمر البيع بنجاح' };
  }
}
