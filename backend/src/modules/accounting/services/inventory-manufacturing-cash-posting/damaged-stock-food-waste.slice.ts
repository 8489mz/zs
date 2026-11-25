import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting.types';

export type DamagedStockFoodWasteBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: InventoryManufacturingCashPostingDeps['toMoney'];
  getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];
  addLine: InventoryManufacturingCashPostingDeps['addLine'];
  insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
};

export class DamagedStockFoodWasteSlice {
  private readonly bound: DamagedStockFoodWasteBoundDeps;

  constructor(bound: DamagedStockFoodWasteBoundDeps) {
    this.bound = bound;
  }

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
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

  async postDamagedStock(
    queryable: DbOrTx,
    damageRecordId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; hasFinancialImpact?: boolean }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const record = await queryable
      .selectFrom('damaged_stock_records')
      .selectAll()
      .where('id', '=', damageRecordId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!record) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const qty = Number(record.qty || 0);
    if (qty <= 0) return { posted: false, journalEntryId: null, hasFinancialImpact: false };

    const rawCost = Number(record.unit_cost || 0);
    const unitCost = Number.isFinite(rawCost) && rawCost > 0 ? rawCost : 0;
    // Post the immutable stored cost of the physical write, never independently
    // round quantity * WAC to cents for a 3-decimal tenant.
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const storedTotal = record.total_cost == null ? null : Number(record.total_cost);
    const amount = this.toMoney(
      storedTotal != null && Number.isFinite(storedTotal) && storedTotal >= 0 ? storedTotal : qty * unitCost,
      moneyDigits,
    );

    if (amount <= 0) {
      return { posted: false, journalEntryId: null, hasFinancialImpact: false };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
    }
    const damagedExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    const branchId = record.branch_id ? Number(record.branch_id) : null;
    const locationId = record.location_id ? Number(record.location_id) : null;

    const lines: JournalLineDraft[] = [];
    this.addLine(
      lines,
      {
        accountId: damagedExpenseAccountId,
        description: 'مصروف مخزون تالف',
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
        accountId: inventoryAccountId,
        description: 'نقص مخزون بسبب التلف',
        debit: 0,
        credit: amount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      },
      moneyDigits,
    );

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'damaged_stock',
        sourceId: damageRecordId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: record.created_at ? new Date(record.created_at) : new Date(),
        description: `قيد بضاعة تالفة - سجل #${damageRecordId}`,
        branchId,
        locationId,
        createdBy: record.created_by ? Number(record.created_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId, hasFinancialImpact: true };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'damaged_stock')
          .where('source_id', '=', damageRecordId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0), hasFinancialImpact: true };
      }
      throw e;
    }
  }

  async postFoodWaste(
    queryable: DbOrTx,
    wasteLogId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const log = await queryable
      .selectFrom('restaurant_food_waste_logs')
      .selectAll()
      .where('id', '=', wasteLogId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();

    if (!log) return { posted: false, journalEntryId: null };

    const totalCost = Number(log.total_cost || 0);
    if (totalCost <= 0) return { posted: false, journalEntryId: null };

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const amount = this.toMoney(totalCost, moneyDigits);
    if (amount <= 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let inventoryAccountId = Number(settings?.inventory_account_id || 0);
    if (!(inventoryAccountId > 0)) {
      inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
    }
    const wasteExpenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '5300');

    const branchId = log.branch_id ? Number(log.branch_id) : null;
    const locationId: number | null = null;

    const lines: JournalLineDraft[] = [];
    this.addLine(
      lines,
      {
        accountId: wasteExpenseAccountId,
        description: `مصروف هدر وتالف مطبخ - ${log.reason}`,
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
        accountId: inventoryAccountId,
        description: 'نقص مخزون بسبب هدر المطبخ',
        debit: 0,
        credit: amount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      },
      moneyDigits,
    );

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'food_waste',
        sourceId: wasteLogId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: log.created_at ? new Date(log.created_at) : new Date(),
        description: `قيد هدر وتالف مطبخ - سجل #${wasteLogId}`,
        branchId,
        locationId,
        createdBy: log.logged_by ? Number(log.logged_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_race_window_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'food_waste')
          .where('source_id', '=', wasteLogId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }
}
