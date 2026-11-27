import { sql } from '../../../../database/kysely';
import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting.types';

export type CashierShiftVarianceBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  maxAllowedDifference: InventoryManufacturingCashPostingDeps['maxAllowedDifference'];
  toMoney: InventoryManufacturingCashPostingDeps['toMoney'];
  getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];
  addLine: InventoryManufacturingCashPostingDeps['addLine'];
  insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
};

export class CashierShiftVarianceSlice {
  private readonly bound: CashierShiftVarianceBoundDeps;

  constructor(bound: CashierShiftVarianceBoundDeps) {
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

  /**
   * Cash shortage tolerance per shift. Shortages at or below it are absorbed as an operating
   * expense; anything above becomes a receivable on the custodian. When the tenant has never
   * configured cashierShortageTolerance, the default is one minor unit
   * (INV-CASHIER-SHORTAGE-TOLERANCE-DEFAULT): a dust shortage of a fils is an operating cost of
   * running a till, not a receivable that accumulates per cashier. An explicitly configured
   * value — including 0 — is honoured exactly; only the unset case (no row, null, or empty
   * value) defaults. Unparseable or negative values fail closed to 0, as before, and a read
   * error fails closed to 0 as well. There is no settings UI for this key; it is set directly
   * in settings.
   */
  private async getCashierShortageTolerance(queryable: DbOrTx, tenantId: string, digits: MoneyDigits): Promise<number> {
    try {
      const row = await queryable
        .selectFrom('settings')
        .select('value')
        .where('tenant_id', '=', tenantId)
        .where('key', '=', 'cashierShortageTolerance')
        .executeTakeFirst();
      if (row == null || row.value == null || String(row.value).trim() === '') return this.maxAllowedDifference(digits);
      let raw: unknown = row.value;
      try {
        raw = JSON.parse(String(row.value));
      } catch {
        /* plain scalar */
      }
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
    } catch {
      return 0;
    }
  }

  async postCashierShiftVariance(
    queryable: DbOrTx,
    shiftId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);

    const shift = await queryable
      .selectFrom('cashier_shifts')
      .selectAll()
      .where('id', '=', shiftId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (!shift || shift.status !== 'closed') return { posted: false, journalEntryId: null };

    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const expected = Number(shift.expected_cash || 0);
    const counted = Number(shift.counted_cash || 0);
    // Any non-zero book variance posts. The old < 0.01 gate dropped every
    // sub-cent variance from the GL while the shift stored it, so GL cash
    // and physical cash diverged by one shift's worth of fils, invisibly.
    const variance = toBookMoney(counted - expected);
    if (variance === 0) return { posted: false, journalEntryId: null };

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    const branchId = shift.branch_id ? Number(shift.branch_id) : null;
    const locationId = shift.location_id ? Number(shift.location_id) : null;

    // Shortages up to the configured tolerance are an operating cost of running a till.
    // Beyond it, the shortage is a debt of the custodian and must sit on a receivable in their name,
    // not be silently written off to expense.
    const shortageTolerance = await this.getCashierShortageTolerance(queryable, scope.tenantId, bookDigits);
    let resolution: 'within_tolerance' | 'charged_to_cashier' | 'surplus_recognized';
    let chargedToUserId: number | null = null;

    if (variance < 0) {
      const amount = Math.abs(variance);
      const custodianId = shift.opened_by ? Number(shift.opened_by) : null;
      const chargeToCashier = amount > shortageTolerance && custodianId !== null && custodianId > 0;

      if (chargeToCashier) {
        const receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1135');
        addBookLine({
          accountId: receivableAccountId,
          description: `عجز وردية رقم #${shiftId} محمّل على أمين الصندوق`,
          debit: amount,
          credit: 0,
          partnerType: 'employee',
          partnerId: custodianId,
          branchId,
          locationId,
        });
        resolution = 'charged_to_cashier';
        chargedToUserId = custodianId;
      } else {
        const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7210');
        addBookLine({
          accountId: shortageAccountId,
          description: `عجز وردية رقم #${shiftId} ضمن حد التسامح`,
          debit: amount,
          credit: 0,
          partnerType: 'none',
          partnerId: null,
          branchId,
          locationId,
        });
        resolution = 'within_tolerance';
      }
      addBookLine({
        accountId: cashAccountId,
        description: `عجز وردية نقدية`,
        debit: 0,
        credit: amount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else {
      // Overage. Never netted against another shift's shortage: it lands on its own income account.
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7110');
      const amount = variance;
      addBookLine({
        accountId: cashAccountId,
        description: `زيادة وردية رقم #${shiftId}`,
        debit: amount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: overageAccountId,
        description: `زيادة وردية نقدية`,
        debit: 0,
        credit: amount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      resolution = 'surplus_recognized';
    }

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'cashier_shift_variance',
        sourceId: shiftId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: shift.closed_at ? new Date(shift.closed_at) : new Date(),
        description: `قيد فروقات وردية - #${shiftId}`,
        branchId,
        locationId,
        createdBy: shift.closed_by ? Number(shift.closed_by) : auth.userId,
        postedBy: auth.userId,
        lines,
      });

      await queryable
        .updateTable('cashier_shifts')
        .set({
          variance_resolution: resolution,
          variance_journal_entry_id: entryId,
          variance_charged_to_user_id: chargedToUserId,
          variance_approved_by: auth.userId ?? null,
          variance_approved_at: sql`NOW()`,
        })
        .where('id', '=', shiftId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();

      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_round1_uniq')) {
        const existing = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'cashier_shift_variance')
          .where('source_id', '=', shiftId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing?.id || 0) };
      }
      throw e;
    }
  }
}
