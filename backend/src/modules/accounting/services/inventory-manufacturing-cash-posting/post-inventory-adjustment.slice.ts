import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';

export type PostInventoryAdjustmentBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any>;
  toMoney(value: unknown, digits: MoneyDigits): number;
  addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void;
  insertPostedJournal(
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
  ): Promise<number>;
  resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number>;
};

export class PostInventoryAdjustmentSlice {
  private readonly bound: PostInventoryAdjustmentBoundDeps;

  constructor(bound: PostInventoryAdjustmentBoundDeps) {
    this.bound = bound;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    return this.bound.addLine(lines, next, digits);
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

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  async postInventoryAdjustment(
    queryable: DbOrTx,
    movementId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    // Check for idempotency via database unique constraint on insert
    const movement = await queryable
      .selectFrom('stock_movements')
      .selectAll()
      .where('id', '=', movementId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!movement) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const delta = Number(movement.after_qty || 0) - Number(movement.before_qty || 0);
    const isFinalIssue = movement.movement_type === 'transfer_final_issue' && movement.reason === 'final_issue';
    const isTransitLoss = movement.movement_type === 'transfer_transit_loss' && movement.reason === 'transit_shrinkage';
    if (Math.abs(delta) < 0.001) return { posted: false, journalEntryId: null, hasFinancialImpact: false }; // No variance

    const rawCost = Number(movement.unit_cost || 0);
    const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
    // Use the immutable amount recorded at the time of the physical movement.
    // Re-multiplying a rounded per-unit cost can drift by cents for fractional quantities.
    const rawTotal = movement.total_cost == null ? null : Number(movement.total_cost);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount =
      rawTotal != null && Number.isFinite(rawTotal) && rawTotal >= 0
        ? this.toMoney(rawTotal, moneyDigits)
        : this.toMoney(Math.abs(delta) * unitCost, moneyDigits);

    if (amount <= 0) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing`);
    const inventoryAccountId = Number(settings.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      // Fallback code 1140
      const fallbackId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      if (!fallbackId) throw new Error('Inventory account not configured and fallback 1140 not found');
    }

    const accountIdToUse =
      inventoryAccountId > 0
        ? inventoryAccountId
        : await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

    const lines: JournalLineDraft[] = [];
    const branchId = movement.branch_id ? Number(movement.branch_id) : null;
    const locationId = movement.location_id ? Number(movement.location_id) : null;

    if (delta > 0) {
      // Gain
      const gainAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      this.addLine(
        lines,
        {
          accountId: accountIdToUse,
          description: 'تسوية زيادة مخزون',
          debit: amount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        moneyDigits,
      );
      this.addLine(
        lines,
        {
          accountId: gainAccountId,
          description: 'أرباح تسوية مخزون',
          debit: 0,
          credit: amount,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        moneyDigits,
      );
    } else {
      // Loss
      const lossAccountCode = isFinalIssue ? '6900' : isTransitLoss ? '5300' : '5200';
      const lossAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, lossAccountCode);
      this.addLine(
        lines,
        {
          accountId: lossAccountId,
          description: isFinalIssue
            ? 'مواد تشغيل مصروفة نهائياً'
            : isTransitLoss
              ? 'هالك وفاقد بضاعة أثناء النقل'
              : 'خسائر تسوية مخزون',
          debit: amount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        moneyDigits,
      );
      this.addLine(
        lines,
        {
          accountId: accountIdToUse,
          description: isFinalIssue
            ? 'تخفيض المخزون بموجب إذن صرف نهائي'
            : isTransitLoss
              ? 'تخفيض مخزون البضاعة بالطريق بسبب الفاقد'
              : 'نقص تسوية مخزون',
          debit: 0,
          credit: amount,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        },
        moneyDigits,
      );
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'inventory_adjustment',
        sourceId: movementId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: movement.created_at ? new Date(movement.created_at) : new Date(),
        description: isFinalIssue
          ? `قيد صرف مخزون نهائي - حركة #${movementId}`
          : `قيد تسوية مخزون - حركة #${movementId}`,
        branchId,
        locationId,
        createdBy: movement.created_by ? Number(movement.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'inventory_adjustment')
          .where('source_id', '=', movementId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }
}
