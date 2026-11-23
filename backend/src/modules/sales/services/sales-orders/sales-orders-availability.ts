import { BadRequestException } from '@nestjs/common';
import type { Kysely } from 'kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { getLocationAvailability } from '../../../../common/utils/location-stock-ledger';

export class SalesOrdersAvailability {
  constructor(private readonly db: Kysely<Database>) {}

  /**
   * INV-SALES-ORDER-WAREHOUSE-SELECTION: resolve the warehouse an
   * order reserves from. An explicitly selected location wins — it is
   * validated tenant-scoped and active, and the error names the
   * warehouse when it is not. Otherwise the branch's default selling
   * warehouse applies (the previous behaviour). Branch scoping is
   * deliberately NOT enforced here: a location may serve a branch
   * other than its own record (e.g. the trial's transfer warehouse),
   * and over-restricting would re-break exactly the case this fix
   * exists for.
   */
  async resolveOrderWarehouse(
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    branchId: number | null,
    requestedLocationId: number | null,
  ): Promise<number | null> {
    if (requestedLocationId != null) {
      const loc = await trx
        .selectFrom('stock_locations')
        .select(['id', 'name', 'is_active'])
        .where('id', '=', requestedLocationId)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .executeTakeFirst();
      if (!loc) {
        throw new BadRequestException('المخزن المحدد لأمر البيع غير موجود');
      }
      if (!loc.is_active) {
        throw new BadRequestException(`المخزن المحدد لأمر البيع غير نشط (${loc.name})`);
      }
      return Number(loc.id);
    }
    if (branchId == null) return null;
    const branchRow = await trx
      .selectFrom('branches')
      .select(['default_stock_location_id'])
      .where('id', '=', branchId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    return branchRow?.default_stock_location_id ? Number(branchRow.default_stock_location_id) : null;
  }

  /**
   * INV-SERVICE-STOCK-NO-STOCK-CHECK: services (products.item_type =
   * 'service') sell without stock, so they must never be reserved —
   * reserveLocationStock throws INSUFFICIENT_STOCK on a 0-stock line
   * and a stamped reserved_quantity would be phantom stock. Returns
   * the ids of the given products that are services.
   */
  async loadServiceProductIds(
    trx: Kysely<Database>,
    scope: { tenantId: string; accountId: string },
    productIds: number[],
  ): Promise<Set<number>> {
    const uniqueIds = Array.from(new Set(productIds.filter((id) => Number.isFinite(id) && id > 0)));
    if (uniqueIds.length === 0) return new Set();
    const rows = await trx
      .selectFrom('products')
      .select(['id', 'item_type'])
      .where('tenant_id', '=', scope.tenantId)
      .where('account_id', '=', scope.accountId)
      .where('id', 'in', uniqueIds)
      .execute();
    return new Set(rows.filter((row) => row.item_type === 'service').map((row) => Number(row.id)));
  }

  /** The warehouse already stored on an order, else its branch default. */
  async resolveStoredOrderLocation(
    order: { warehouse_location_id?: number | null; branch_id?: number | null },
    scope: { tenantId: string; accountId: string },
  ): Promise<number | null> {
    if (order.warehouse_location_id) return Number(order.warehouse_location_id);
    if (!order.branch_id) return null;
    const branchRow = await this.db
      .selectFrom('branches')
      .select(['default_stock_location_id'])
      .where('id', '=', Number(order.branch_id))
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    return branchRow?.default_stock_location_id ? Number(branchRow.default_stock_location_id) : null;
  }

  /**
   * INV-SALES-ORDER-WAREHOUSE-SELECTION: the display read. Returns
   * the available quantity of one product in one warehouse, computed
   * by the SAME arithmetic reserveLocationStock enforces — so the
   * order line's "available" badge and the approval check can never
   * disagree about the warehouse again. A null location reads the
   * global availability (the pre-selector fallback).
   */
  async getLocationAvailability(
    productId: number,
    locationId: number | null,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    if (!Number.isFinite(productId) || productId <= 0) {
      throw new BadRequestException('الصنف غير محدد');
    }
    let branchId: number | null = null;
    if (locationId != null) {
      const loc = await this.db
        .selectFrom('stock_locations')
        .select(['id', 'branch_id'])
        .where('id', '=', locationId)
        .where('tenant_id', '=', scope.tenantId)
        .where('account_id', '=', scope.accountId)
        .executeTakeFirst();
      if (!loc) {
        throw new BadRequestException('المخزن المحدد غير موجود');
      }
      branchId = loc.branch_id ? Number(loc.branch_id) : null;
    }
    const availability = await getLocationAvailability(this.db, {
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      productId,
      locationId,
      branchId,
    });
    // No warehouse chosen yet: there is no location balance to read,
    // and reserveLocationStock enforces only the global check in that
    // case — so the display shows the global availability, exactly
    // like the approval check does.
    if (locationId == null) {
      return { ...availability, availableAtLocation: availability.globalAvailable };
    }
    return { ...availability };
  }
}
