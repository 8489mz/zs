import { sql } from '../../../../database/kysely';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { currencyMoneyDigits, roundMoney, MoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting.types';

export type PostManufacturingUnbuildOrderBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  maxAllowedDifference: InventoryManufacturingCashPostingDeps['maxAllowedDifference'];
  toMoney: InventoryManufacturingCashPostingDeps['toMoney'];
  getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];
  addLine: InventoryManufacturingCashPostingDeps['addLine'];
  insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
};

export class PostManufacturingUnbuildOrderSlice {
  private readonly bound: PostManufacturingUnbuildOrderBoundDeps;

  constructor(bound: PostManufacturingUnbuildOrderBoundDeps) {
    this.bound = bound;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private maxAllowedDifference(bookDigits: MoneyDigits): number {
    return this.bound.maxAllowedDifference(bookDigits);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    return this.bound.addLine(lines, next, digits);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private insertPostedJournal(
    queryable: any,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date;
      description: string;
      branchId: number | null;
      locationId: number | null;
      createdBy: number | null;
      postedBy: number | null;
      cashFlowCategory?: 'operating' | 'investing' | 'financing' | null;
      lines: JournalLineDraft[];
      reversalOfEntryId?: number | null;
    },
  ): Promise<number> {
    return this.bound.insertPostedJournal(queryable, params);
  }

  async postManufacturingUnbuildOrder(
    queryable: DbOrTx,
    unbuildId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'manufacturing_unbuild_order')
      .where('source_id', '=', unbuildId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const order = await queryable
      .selectFrom('manufacturing_unbuild_orders')
      .select(['created_at', 'created_by', 'warehouse_id'])
      .where('id', '=', unbuildId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!order) return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const fgMovement = await queryable
      .selectFrom('stock_movements')
      .select('total_cost')
      .where('reference_type', '=', 'manufacturing_unbuild_order')
      .where('reference_id', '=', unbuildId)
      .where('movement_type', '=', 'manufacturing_unbuild')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const recovered = await queryable
      .selectFrom('stock_movements')
      .select(sql<number>`coalesce(sum(total_cost), 0)`.as('amount'))
      .where('reference_type', '=', 'manufacturing_unbuild_order')
      .where('reference_id', '=', unbuildId)
      .where('movement_type', '=', 'manufacturing_unbuild_recovery')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const fgCost = toBookMoney(fgMovement?.total_cost || 0);
    const recoveredCost = toBookMoney(recovered?.amount || 0);
    if (fgCost <= 0 && recoveredCost <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!inventoryAccountId)
        throw new AppError('Inventory account not configured and fallback 1140 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    const difference = roundMoney(fgCost - recoveredCost, bookDigits);
    // INV-MANUFACTURING-UNBUILD-5190-CAP-ALERT: the variance to 5190
    // is capped at one minor unit -- the same rounding tolerance the
    // work-order poster fails closed on. A larger difference means
    // real WAC drift, not rounding, and must never be buried in the
    // variance account: fail closed BEFORE any posting or 5190
    // resolution, so the whole unbuild (stock, order, journal)
    // rolls back. The caller records the review alert and the
    // operator investigates the drift and retries; nothing posts
    // until the variance is within the cap.
    const varianceCap = this.maxAllowedDifference(bookDigits);
    if (Math.abs(difference) > varianceCap) {
      throw new AppError(
        `Unbuild variance ${difference.toFixed(bookDigits)} exceeds the one-minor-unit review cap ${varianceCap.toFixed(bookDigits)} for unbuild order #${unbuildId} (finished-goods cost ${fgCost.toFixed(bookDigits)}, recovered cost ${recoveredCost.toFixed(bookDigits)}); review the WAC drift before retrying -- nothing was posted.`,
        'MANUFACTURING_UNBUILD_VARIANCE_REVIEW_REQUIRED',
        409,
      );
    }
    // The system resolver auto-creates 5190 as a known system account
    // when it is absent (the same treatment GRN price variance gets);
    // it throws only when the accounting foundation itself is missing.
    const varianceAccountId =
      difference !== 0 ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5190') : 0;

    const lines: JournalLineDraft[] = [];
    const branchId = null;
    const locationId = order.warehouse_id ? Number(order.warehouse_id) : null;

    if (recoveredCost > 0) {
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: `مواد مسترجعة من تفكيك - أمر #${unbuildId}`,
          debit: recoveredCost,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    }
    if (fgCost > 0) {
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: `منتج تام مفكك - أمر #${unbuildId}`,
          debit: 0,
          credit: fgCost,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    }
    if (difference > 0) {
      this.addLine(
        lines,
        {
          accountId: varianceAccountId,
          description: `فرق تفكيك - أمر #${unbuildId}`,
          debit: difference,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    } else if (difference < 0) {
      this.addLine(
        lines,
        {
          accountId: varianceAccountId,
          description: `فرق تفكيك - أمر #${unbuildId}`,
          debit: 0,
          credit: -difference,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'manufacturing_unbuild_order',
        sourceId: unbuildId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: order.created_at ? new Date(order.created_at) : new Date(),
        description: `قيد أمر تفكيك #${unbuildId}`,
        branchId,
        locationId,
        createdBy: order.created_by ? Number(order.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existingEntry = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'manufacturing_unbuild_order')
          .where('source_id', '=', unbuildId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: existingEntry ? existingEntry.id : null };
      }
      throw e;
    }
  }
}
