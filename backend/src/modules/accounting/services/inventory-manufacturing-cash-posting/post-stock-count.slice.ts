import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting.types';

export type PostStockCountBoundDeps = {
  ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>;
  getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];
  addLine: InventoryManufacturingCashPostingDeps['addLine'];
  insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
};

export class PostStockCountSlice {
  private readonly bound: PostStockCountBoundDeps;

  constructor(bound: PostStockCountBoundDeps) {
    this.bound = bound;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    this.bound.addLine(lines, next, digits);
  }

  private async insertPostedJournal(
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

  async postStockCount(
    queryable: DbOrTx,
    sessionId: number,
    auth: AuthContext,
    itemIds?: number[],
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const stockCountDigits = currencyMoneyDigits(
      await tenantBaseCurrency(queryable, requireTenantScope(auth).tenantId),
    );
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const session = await queryable
      .selectFrom('stock_count_sessions')
      .selectAll()
      .where('id', '=', sessionId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!session) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    let itemQuery = queryable
      .selectFrom('stock_count_items')
      .selectAll()
      .where('session_id', '=', sessionId)
      .where('tenant_id', '=', scope.tenantId);
    if (itemIds) {
      if (!itemIds.length) return { posted: false, journalEntryId: null, hasFinancialImpact: false };
      itemQuery = itemQuery.where('id', 'in', itemIds);
    }
    const items = await itemQuery.execute();
    const productIds = items.map((item) => Number(item.product_id));
    const movements = productIds.length
      ? await queryable
          .selectFrom('stock_movements')
          .selectAll()
          .where('reference_type', '=', 'stock_count_session')
          .where('reference_id', '=', sessionId)
          .where('tenant_id', '=', scope.tenantId)
          .where('product_id', 'in', productIds)
          .execute()
      : [];
    const movementByProduct = new Map(movements.map((movement) => [Number(movement.product_id), movement]));

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0))
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const gainAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
    const lossAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5200');
    const damagedExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    let totalGain = 0;
    let totalLoss = 0;
    let totalDamageLoss = 0;

    for (const item of items) {
      const variance = Number(item.variance_qty || 0);

      const mov = movementByProduct.get(Number(item.product_id));
      // INV-STOCK-COUNT-ACTUAL-DELTA: the movement row carries the
      // actual scoped delta the stock write really moved. Value the
      // journal on it, not on the frozen available-basis variance.
      // Fall back to the stored variance only when no movement row
      // exists (chunks posted before this fix, whose movements carry
      // the frozen variance) -- prospective only, no history rewritten.
      const delta = mov ? Number(mov.qty ?? 0) : variance;
      if (delta === 0) continue;

      const rawCost = Number(mov?.unit_cost || 0);
      const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
      const lineCost = roundMoney(Math.abs(delta) * unitCost, stockCountDigits);
      if (lineCost <= 0) continue;

      if (delta > 0) {
        totalGain += lineCost;
      } else if (delta < 0) {
        if (String(item.reason || '').toLowerCase() === 'damage') {
          totalDamageLoss += lineCost;
        } else {
          totalLoss += lineCost;
        }
      }
    }

    if (totalGain === 0 && totalLoss === 0 && totalDamageLoss === 0) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const branchId = session.branch_id ? Number(session.branch_id) : null;
    const locationId = session.location_id ? Number(session.location_id) : null;

    const lines: JournalLineDraft[] = [];
    if (totalGain > 0) {
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: 'فائض جرد مخزون',
          debit: totalGain,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        stockCountDigits,
      );
      this.addLine(
        lines,
        {
          accountId: gainAccountId,
          description: 'أرباح جرد مخزون',
          debit: 0,
          credit: totalGain,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        stockCountDigits,
      );
    }
    if (totalLoss > 0) {
      this.addLine(
        lines,
        {
          accountId: lossAccountId,
          description: 'عجز جرد مخزون',
          debit: totalLoss,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        stockCountDigits,
      );
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: 'نقص مخزون بسبب العجز',
          debit: 0,
          credit: totalLoss,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        stockCountDigits,
      );
    }
    if (totalDamageLoss > 0) {
      this.addLine(
        lines,
        {
          accountId: damagedExpenseAccountId,
          description: 'عجز جرد (تالف)',
          debit: totalDamageLoss,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        stockCountDigits,
      );
      this.addLine(
        lines,
        {
          accountId: inventoryAccountId,
          description: 'نقص مخزون (تالف بالجرد)',
          debit: 0,
          credit: totalDamageLoss,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        stockCountDigits,
      );
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: itemIds ? 'stock_count_chunk' : 'stock_count',
        sourceId: itemIds ? itemIds[0] : sessionId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: session.posted_at ? new Date(session.posted_at) : new Date(),
        description: `قيد تسوية جرد - جلسة #${sessionId}`,
        branchId,
        locationId,
        createdBy: session.approved_by ? Number(session.approved_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (
        e.code === '23505' &&
        (e.constraint?.includes('idx_journal_entries_round1_uniq') ||
          e.constraint?.includes('idx_journal_entries_stock_count_chunk_uniq'))
      ) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', itemIds ? 'stock_count_chunk' : 'stock_count')
          .where('source_id', '=', itemIds ? itemIds[0] : sessionId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }
}
