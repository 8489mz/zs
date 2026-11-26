import { sql } from '../../../../database/kysely';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, roundMoney, MoneyDigits } from '../../engines/money-minor-units.engine';
import { scaledBomOverhead } from '../../../../common/utils/manufacturing-overhead.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting.types';

export type PostManufacturingWorkOrderBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: InventoryManufacturingCashPostingDeps['toMoney'];
  maxAllowedDifference: InventoryManufacturingCashPostingDeps['maxAllowedDifference'];
  getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];
  addLine: InventoryManufacturingCashPostingDeps['addLine'];
  insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
};

export class PostManufacturingWorkOrderSlice {
  private readonly bound: PostManufacturingWorkOrderBoundDeps;

  constructor(bound: PostManufacturingWorkOrderBoundDeps) {
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

  async postManufacturingWorkOrder(
    queryable: DbOrTx,
    workOrderId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    // Idempotency check using 'manufacturing_work_order' source
    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'manufacturing_work_order')
      .where('source_id', '=', workOrderId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: existing.id };

    const wo = await queryable
      .selectFrom('manufacturing_work_orders as wo')
      .innerJoin('manufacturing_boms as bom', 'bom.id', 'wo.bom_id')
      .select([
        'wo.total_cost',
        'wo.quantity_to_produce',
        'bom.overhead_cost',
        'bom.quantity as bom_quantity',
        'wo.created_at',
        'wo.completed_at',
        'wo.created_by',
        'wo.destination_location_id',
      ])
      .where('wo.id', '=', workOrderId)
      .where('wo.tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!wo) return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const fgCost = toBookMoney(Number(wo.total_cost || 0));
    const consumed = await queryable
      .selectFrom('manufacturing_wo_consumptions as c')
      .innerJoin('manufacturing_work_orders as w', 'w.id', 'c.work_order_id')
      .select(sql<number>`coalesce(sum(c.line_total), 0)`.as('amount'))
      .where('w.tenant_id', '=', scope.tenantId)
      .where('w.id', '=', workOrderId)
      .executeTakeFirst();
    const rmCost = toBookMoney(consumed?.amount || 0);

    // INV-MANUFACTURING-COST-DERIVATION: overhead is NEVER a residual.
    // The old derivation (stored total minus raw materials) debited
    // the full stored total to finished goods -- overstating the Dr
    // 1140 leg above the finished-goods stock movement by exactly
    // the by-product value -- left the by-product stock increase
    // with no journal leg at all, and laundered any drift in
    // wo.total_cost into "overhead". Every component is now re-derived
    // from its stored
    // rows: operations from manufacturing_wo_operations, scaled BOM
    // overhead via the single scaledBomOverhead function that
    // completeWorkOrder also calls, the
    // finished-goods value from its stamped stock movement, and the
    // by-product value from its stamped movements. The stored total
    // is only a cross-check: any difference beyond one minor unit
    // (the codebase's own maxAllowedDifference) is data drift and
    // fails closed instead of posting.
    const operations = await queryable
      .selectFrom('manufacturing_wo_operations')
      .select(sql<number>`coalesce(sum(total_cost), 0)`.as('amount'))
      .where('work_order_id', '=', workOrderId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const opsCost = toBookMoney(operations?.amount || 0);
    const bomQuantity = Number(wo.bom_quantity || 1);
    const scaledOverheadCost = scaledBomOverhead(
      Number(wo.overhead_cost || 0),
      Number(wo.quantity_to_produce || 0),
      bomQuantity,
      bookDigits,
    );
    const overheadCost = toBookMoney(opsCost + scaledOverheadCost);
    const fgMovement = await queryable
      .selectFrom('stock_movements')
      .select('total_cost')
      .where('reference_type', '=', 'manufacturing_work_order')
      .where('reference_id', '=', workOrderId)
      .where('movement_type', '=', 'manufacturing_production')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const finishedValue = toBookMoney(fgMovement?.total_cost || 0);
    const byProducts = await queryable
      .selectFrom('stock_movements')
      .select(sql<number>`coalesce(sum(total_cost), 0)`.as('amount'))
      .where('reference_type', '=', 'manufacturing_work_order')
      .where('reference_id', '=', workOrderId)
      .where('movement_type', '=', 'manufacturing_byproduct')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const byProductValue = toBookMoney(byProducts?.amount || 0);
    const expectedTotal = toBookMoney(rmCost + opsCost + scaledOverheadCost);
    const difference = roundMoney(expectedTotal - finishedValue - byProductValue, bookDigits);
    if (rmCost < 0 || opsCost < 0 || scaledOverheadCost < 0 || byProductValue < 0 || finishedValue < 0) {
      throw new AppError('Manufacturing cost components are inconsistent', 'MANUFACTURING_COST_MISMATCH', 409);
    }
    if (Math.abs(difference) > this.maxAllowedDifference(bookDigits)) {
      throw new AppError(
        'Manufacturing stored total does not reconcile with its cost components',
        'MANUFACTURING_COST_MISMATCH',
        409,
      );
    }

    // INV-MANUFACTURING-ZERO-COST: a genuinely zero-cost work order posts
    // nothing and does not throw (same precedent as
    // postManufacturingUnbuildOrder). The mismatch guard above runs
    // first, so this is reachable only when every component is zero, in
    // practice fgCost == rmCost == 0. Returning before the account
    // resolution also means a zero-cost order needs no 5400 account and
    // never hits the empty-journal guard.
    if (fgCost <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!inventoryAccountId)
        throw new AppError('Inventory account not configured and fallback 1140 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    let overheadAccountId = Number(settings?.manufacturing_overhead_account_id || 0);
    if (!(overheadAccountId > 0)) {
      overheadAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5400');
      if (!overheadAccountId)
        throw new AppError('Manufacturing Overhead account 5400 not found', 'ACCOUNT_NOT_FOUND', 400);
    }

    // The variance account is resolved only when a rounding-scale
    // difference actually exists (the unbuild poster's convention);
    // it auto-creates as a known system account when absent.
    const varianceAccountId =
      difference !== 0 ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5190') : 0;

    const lines: JournalLineDraft[] = [];
    const branchId = null;
    const locationId = wo.destination_location_id ? Number(wo.destination_location_id) : null;

    // 1. Debit FG (Inventory) at finishedValue -- exactly the value
    // stamped on the finished-goods stock movement.
    this.addLine(
      lines,
      {
        accountId: inventoryAccountId,
        description: `منتج تام إضافي - أمر #${workOrderId}`,
        debit: finishedValue,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      },
      bookDigits,
    );

    // 2. Debit by-products (Inventory) as their OWN leg. Both legs
    // debit 1140 (both are inventory increases) but stay separate
    // lines: the by-product value is no longer buried in the 5400
    // residual, and the 5400 credit below is only operations +
    // scaled overhead.
    if (byProductValue > 0) {
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: `منتج ثانوي ناتج عن التصنيع - أمر #${workOrderId}`,
          debit: byProductValue,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    }

    // 3. Credit RM (Inventory)
    if (rmCost > 0) {
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: `خامات مستهلكة - أمر #${workOrderId}`,
          debit: 0,
          credit: rmCost,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    }

    // 4. Credit operations + scaled overhead (5400 only -- never the
    // by-product value, never a residual).
    if (overheadCost > 0) {
      this.addLine(
        lines,
        {
          accountId: overheadAccountId,
          description: `مصاريف صناعية محملة - أمر #${workOrderId}`,
          debit: 0,
          credit: overheadCost,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        bookDigits,
      );
    }

    // 5. Rounding-scale variance to 5190 (unbuild convention: debit
    // when the components exceed the recorded output, credit when
    // the recorded output exceeds the components). Anything larger
    // already threw above.
    if (difference > 0) {
      this.addLine(
        lines,
        {
          accountId: varianceAccountId,
          description: `فرق تصنيع - أمر #${workOrderId}`,
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
          description: `فرق تصنيع - أمر #${workOrderId}`,
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
        sourceType: 'manufacturing_work_order',
        sourceId: workOrderId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: wo.completed_at
          ? new Date(wo.completed_at)
          : (() => {
              throw new AppError('Manufacturing completion date missing', 'MANUFACTURING_DATE_MISSING', 409);
            })(),
        description: `قيد أمر تصنيع #${workOrderId}`,
        branchId,
        locationId,
        createdBy: wo.created_by ? Number(wo.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'manufacturing_work_order')
          .where('source_id', '=', workOrderId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: existing ? existing.id : null };
      }
      throw e;
    }
  }
}
