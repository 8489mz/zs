import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { VanAndDeliveryPostingDeps } from './van-and-delivery-posting.types';

export type PostVanTripSettlementBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: VanAndDeliveryPostingDeps['toMoney'];
  addLine: VanAndDeliveryPostingDeps['addLine'];
  getTenantAccountingSettings: VanAndDeliveryPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: VanAndDeliveryPostingDeps['resolveSystemAccountByCode'];
  maxAllowedDifference: VanAndDeliveryPostingDeps['maxAllowedDifference'];
  insertPostedJournal: VanAndDeliveryPostingDeps['insertPostedJournal'];
};

export class PostVanTripSettlementSlice {
  constructor(private readonly bound: PostVanTripSettlementBoundDeps) {}

  private async ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void> {
    return this.bound.ensureTenantFoundation(queryable, auth);
  }

  private toMoney(value: unknown, digits: MoneyDigits): number {
    return this.bound.toMoney(value, digits);
  }

  private addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    return this.bound.addLine(lines, next, digits);
  }

  private async getTenantAccountingSettings(queryable: DbOrTx, tenantId: string): Promise<any> {
    return this.bound.getTenantAccountingSettings(queryable, tenantId);
  }

  private async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    return this.bound.resolveSystemAccountByCode(queryable, tenantId, code);
  }

  private maxAllowedDifference(bookDigits: MoneyDigits): number {
    return this.bound.maxAllowedDifference(bookDigits);
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
   * A van/field sale posts (via postSale) as a receivable rather than straight to cash — the money,
   * if any was collected, is physically in the rep's pocket, not the till. This is the same "collect
   * now, settle later" shape as postDeliveryRepSettlement, generalized to a whole trip: it reduces
   * that pooled receivable by the amount the rep actually hands over, and reconciles the difference
   * against a shortage/overage account (mirroring the cashier-shift variance treatment) rather than
   * silently adjusting cash by whatever was collected.
   */
  async postVanTripSettlement(
    queryable: DbOrTx,
    tripId: number,
    params: {
      expectedCash: number;
      countedCash: number;
      tripExpenses?: number;
      branchId: number | null;
      locationId: number | null;
      stockShortageAmount?: number;
      // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: mirror of
      // stockShortageAmount. Overage units found in the van are
      // journaled Dr 1140 / Cr 7100 so the added stock value is
      // accounted, never silently added to stock or income.
      stockOverageAmount?: number;
      chargeStockVarianceToRep?: boolean;
    },
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);

    const existing = await queryable
      .selectFrom('journal_entries')
      .select('id')
      .where('source_type', '=', 'van_trip_settlement')
      .where('source_id', '=', tripId)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const expected = toBookMoney(params.expectedCash);
    const counted = toBookMoney(params.countedCash);
    const tripExpenses = params.tripExpenses ? toBookMoney(params.tripExpenses) : 0;
    const stockShortage = params.stockShortageAmount ? toBookMoney(params.stockShortageAmount) : 0;
    const stockOverage = params.stockOverageAmount ? toBookMoney(params.stockOverageAmount) : 0;

    if (expected <= 0 && counted <= 0 && tripExpenses <= 0 && stockShortage <= 0 && stockOverage <= 0)
      return { posted: false, journalEntryId: null };
    const variance = toBookMoney(counted - expected);

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting van trip settlement ${tripId}`);

    let cashAccountId = Number(settings.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');
    let receivableAccountId = Number(settings.customer_receivable_account_id || 0);
    if (!(receivableAccountId > 0))
      receivableAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1130');

    const lines: JournalLineDraft[] = [];
    const branchId = params.branchId;
    const locationId = params.locationId;

    const grossReceivableToClear = toBookMoney(expected + tripExpenses);
    if (grossReceivableToClear > 0) {
      addBookLine({
        accountId: receivableAccountId,
        description: `تصفية عهدة نقدية مندوب - رحلة #${tripId}`,
        debit: 0,
        credit: grossReceivableToClear,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    if (tripExpenses > 0) {
      const expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6400');
      addBookLine({
        accountId: expenseAccountId,
        description: `مصروفات تشغيلية ووقود رحلة توزيع #${tripId}`,
        debit: tripExpenses,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    if (variance < -this.maxAllowedDifference(bookDigits)) {
      const shortageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
      addBookLine({
        accountId: shortageAccountId,
        description: `عجز تصفية رحلة توزيع #${tripId}`,
        debit: Math.abs(variance),
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (variance > this.maxAllowedDifference(bookDigits)) {
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({
        accountId: overageAccountId,
        description: `زيادة تصفية رحلة توزيع #${tripId}`,
        debit: 0,
        credit: variance,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    if (counted > 0) {
      addBookLine({
        accountId: cashAccountId,
        description: `نقدية مسلَّمة من مندوب - رحلة #${tripId}`,
        debit: counted,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    if (stockShortage > 0) {
      let inventoryAccountId = Number(settings.inventory_account_id || 0);
      if (!(inventoryAccountId > 0))
        inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');

      let debitAccountId: number;
      let debitDesc: string;
      if (params.chargeStockVarianceToRep) {
        debitAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1160');
        debitDesc = `عجز مخزني محمل على عهدة وسلف المندوب - رحلة #${tripId}`;
      } else {
        debitAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7200');
        debitDesc = `خسائر عجز مخزني سيارة التوزيع - رحلة #${tripId}`;
      }

      addBookLine({
        accountId: debitAccountId,
        description: debitDesc,
        debit: stockShortage,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: inventoryAccountId,
        description: `تسوية عجز مخزني سيارة التوزيع - رحلة #${tripId}`,
        debit: 0,
        credit: stockShortage,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    // INV-VAN-SETTLE-COUNT-OVERAGE-VISIBLE: overage mirror of the
    // shortage block above. Found units raise the van's inventory
    // asset (Dr 1140) against an overage gain (Cr 7100, the same
    // account cash overage credits in this journal). Shortage legs
    // above are byte-identical; this block only adds legs.
    if (stockOverage > 0) {
      let inventoryAccountId = Number(settings.inventory_account_id || 0);
      if (!(inventoryAccountId > 0))
        inventoryAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1140');
      const overageAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({
        accountId: inventoryAccountId,
        description: `تسوية زيادة مخزنية سيارة التوزيع - رحلة #${tripId}`,
        debit: stockOverage,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: overageAccountId,
        description: `إيراد زيادة جرد بضاعة سيارة التوزيع - رحلة #${tripId}`,
        debit: 0,
        credit: stockOverage,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }

    if (lines.length === 0) return { posted: false, journalEntryId: null };

    try {
      const entryId = await this.insertPostedJournal(queryable, {
        sourceType: 'van_trip_settlement',
        sourceId: tripId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: `قيد تصفية رحلة توزيع #${tripId}`,
        branchId,
        locationId,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines,
      });
      return { posted: true, journalEntryId: entryId };
    } catch (e: any) {
      if (e.code === '23505' && e.constraint?.includes('idx_journal_entries_van_sales_uniq')) {
        const existing2 = await queryable
          .selectFrom('journal_entries')
          .select('id')
          .where('source_type', '=', 'van_trip_settlement')
          .where('source_id', '=', tripId)
          .where('tenant_id', '=', scope.tenantId)
          .executeTakeFirst();
        return { posted: false, journalEntryId: Number(existing2?.id || 0) };
      }
      throw e;
    }
  }
}
