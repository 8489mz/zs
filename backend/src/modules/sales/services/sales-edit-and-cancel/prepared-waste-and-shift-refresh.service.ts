import { AppError } from '../../../../common/errors/app-error';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { Kysely, type Transaction } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import type { SalesEditAndCancelDeps } from './sales-edit-and-cancel-types';

export class PreparedWasteAndShiftRefreshService {
  constructor(private readonly cashDrawerService: SalesEditAndCancelDeps['cashDrawerService']) {}

  /**
   * Shared prepared-waste detection for cancelSale and updateSale:
   * a dine-in/takeaway/delivery sale is prepared waste when it has a
   * consumed-ingredient allocation or a recipe meal AND the kitchen
   * state shows the food was consumed (KDS cooking/ready/served, or a
   * non-pending stage on a sale older than 14h / with an unreadable
   * date). The predicate is cancelSale's original logic, unchanged;
   * both paths call it so the two treatments can never drift apart.
   */
  async detectPreparedWasteSale(
    trx: Kysely<Database>,
    sale: { id: number; order_type?: string | null; created_at?: Date | string | null },
    tenantId: string,
  ): Promise<boolean> {
    let isPreparedWaste = false;
    const saleId = Number(sale.id);
    if (['dine_in', 'takeaway', 'delivery'].includes(String(sale.order_type || ''))) {
      const consumedIngredient = await trx
        .selectFrom('sale_line_stock_allocations as a')
        .innerJoin('sale_items as i', (join) =>
          join.onRef('i.id', '=', 'a.sale_line_id').onRef('i.tenant_id', '=', 'a.tenant_id'),
        )
        .select('a.id')
        .where('a.tenant_id', '=', tenantId)
        .where('i.sale_id', '=', saleId)
        .whereRef('a.product_id', '!=', 'i.product_id')
        .limit(1)
        .executeTakeFirst();
      const recipeMeal = await trx
        .selectFrom('sale_items as i')
        .innerJoin('manufacturing_boms as b', (join) =>
          join.onRef('b.product_id', '=', 'i.product_id').onRef('b.tenant_id', '=', 'i.tenant_id'),
        )
        .select('i.id')
        .where('i.tenant_id', '=', tenantId)
        .where('i.sale_id', '=', saleId)
        .where('b.is_active', '=', true)
        .limit(1)
        .executeTakeFirst();
      if (consumedIngredient || recipeMeal) {
        const kitchenRecord = await trx
          .selectFrom('settings')
          .select('value')
          .where('tenant_id', '=', tenantId)
          .where('key', '=', 'kds_tickets_runtime_state')
          .executeTakeFirst();
        let stage: string | undefined;
        try {
          const parsed = kitchenRecord?.value ? JSON.parse(String(kitchenRecord.value)) : null;
          stage = parsed?.tickets?.[String(saleId)]?.status;
        } catch {
          stage = 'pending';
        }
        const createdMs = sale.created_at ? new Date(sale.created_at).getTime() : NaN;
        if (
          stage === 'cooking' ||
          stage === 'ready' ||
          stage === 'served' ||
          (stage !== 'pending' && (!Number.isFinite(createdMs) || Date.now() - createdMs > 14 * 60 * 60 * 1000))
        ) {
          isPreparedWaste = true;
        }
      }
    }
    return isPreparedWaste;
  }

  /**
   * INV-CLOSED-SHIFT-POST-CLOSE-REFRESH: after a post-close edit or
   * cancel has written the sale's final state in this transaction,
   * refresh the original closed shift's stored figures through the
   * drawer service (recompute + stamp; a no-op when the figures are
   * unchanged). Must run inside the caller's transaction so a failed
   * refresh rolls the sale change back. Refuses loudly when the drawer
   * service was not wired: a post-close change must never silently
   * leave the closed shift stale.
   */
  /**
   * INV-REST-SHIFT-CLOSE-CONTROL (I26): after a sale has been written
   * in this transaction, refresh every closed / pending_review shift
   * whose [created_at, closed_at] window contains the sale's
   * business timestamp. The sale was already counted by the open
   * shift on read; only already-closed shifts need their stored
   * figures corrected, with a stamp. The timestamp passed in is
   * the server sync instant for an offline sale
   * (INV-OFFLINE-SYNC-SERVER-TIMESTAMP) — a backdated offline
   * sale no longer exists, so this matches only a shift that
   * closed mid-sync.
   */
  async refreshClosedShiftsForBackdatedOfflineSale(
    trx: Kysely<Database> | Transaction<Database>,
    saleBusinessTimestamp: Date,
    saleId: number,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    tenantId: string,
  ): Promise<void> {
    if (!this.cashDrawerService) {
      throw new AppError(
        'تعذر تحديث أرقام الوردية المغلقة: خدمة الورديات غير موصولة.',
        'SHIFT_REFRESH_UNAVAILABLE',
        500,
      );
    }
    // A null sale branch/location matches any shift scope (the
    // same null-means-any rule as the attribution predicate); a
    // set one matches only its own scope or an unscoped shift.
    let shiftsQuery = trx
      .selectFrom('cashier_shifts')
      .select('id')
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['closed', 'pending_review'])
      .where('created_at', '<=', saleBusinessTimestamp)
      .where((eb) => eb.or([eb('closed_at', '>=', saleBusinessTimestamp), eb('closed_at', 'is', null)]));
    if (branchId != null) {
      shiftsQuery = shiftsQuery.where((eb) => eb.or([eb('branch_id', 'is', null), eb('branch_id', '=', branchId)]));
    }
    if (locationId != null) {
      shiftsQuery = shiftsQuery.where((eb) =>
        eb.or([eb('location_id', 'is', null), eb('location_id', '=', locationId)]),
      );
    }
    const shifts = await shiftsQuery.execute();
    for (const shift of shifts) {
      await this.refreshClosedShiftForPostCloseChange(
        trx,
        Number(shift.id),
        saleId,
        'offline_sync',
        'مزامنة فاتورة أوفلاين بتاريخها الأصلي',
        auth,
      );
    }
  }

  async refreshClosedShiftForPostCloseChange(
    trx: Kysely<Database> | Transaction<Database>,
    shiftId: number,
    saleId: number,
    kind: 'edit' | 'cancel' | 'offline_sync',
    reason: string,
    auth: AuthContext,
  ): Promise<void> {
    if (!this.cashDrawerService) {
      throw new AppError(
        'تعذر تحديث أرقام الوردية المغلقة: خدمة الورديات غير موصولة.',
        'SHIFT_REFRESH_UNAVAILABLE',
        500,
      );
    }
    await this.cashDrawerService.refreshClosedShiftSummary(trx as Kysely<Database>, shiftId, {
      saleId,
      kind,
      reason,
      auth,
    });
  }
}
