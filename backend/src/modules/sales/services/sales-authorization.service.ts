import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { Kysely, sql, Transaction } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { authorizeManagerSecret } from '../../../common/utils/manager-approval';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';

type DbOrTx = Kysely<Database> | Transaction<Database>;

@Injectable()
export class SalesAuthorizationService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  hasPermission(auth: AuthContext, permission: string): boolean {
    return auth.role === 'super_admin' || auth.permissions.includes(permission);
  }

  canManageHeldSales(auth: AuthContext): boolean {
    return this.hasPermission(auth, 'canEditInvoices') || this.hasPermission(auth, 'canDelete');
  }

  heldSaleOwnerUserId(auth: AuthContext): number | null {
    const userId = Number(auth.userId);
    return Number.isInteger(userId) && userId > 0 ? userId : null;
  }

  canAccessHeldSale(auth: AuthContext, heldSale: { created_by?: number | string | null }): boolean {
    if (this.canManageHeldSales(auth)) return true;
    const userId = this.heldSaleOwnerUserId(auth);
    const createdBy = Number(heldSale.created_by);
    return userId !== null && Number.isInteger(createdBy) && createdBy > 0 && createdBy === userId;
  }

  assertCanViewSales(auth: AuthContext): void {
    if (auth.role === 'super_admin') return;
    if (auth.permissions.includes('sales') || auth.permissions.includes('reports')) return;
    throw new ForbiddenException('Missing required permissions');
  }

  async hasOpenCashierShift(queryable: DbOrTx, auth: AuthContext, branchId?: number | null): Promise<boolean> {
    const { tenantId } = requireTenantScope(auth);
    let query = queryable
      .selectFrom('cashier_shifts')
      .select('id')
      .where('opened_by', '=', auth.userId)
      .where('status', '=', 'open')
      .where(sql<boolean>`tenant_id = ${tenantId}`);
    query = branchId == null ? query.where('branch_id', 'is', null) : query.where('branch_id', '=', branchId);
    const row = await query.orderBy('id', 'desc').forUpdate().executeTakeFirst();
    return Boolean(row?.id);
  }

  async authorizeDiscountOverride(
    secret: string,
    auth: AuthContext,
    queryable: DbOrTx = this.db,
  ): Promise<{ mode: 'pin' | 'account' | 'bypass'; authorizedByName: string; authorizedById?: number }> {
    // INV-SPIRIT-MANAGER-APPROVAL-SHARED: the one shared check. The
    // 'bypass' mode is kept in the return type for callers that
    // short-circuit super_admin before calling; this method itself
    // never bypasses — an empty or wrong secret always throws.
    return authorizeManagerSecret(queryable, auth, secret);
  }
}
