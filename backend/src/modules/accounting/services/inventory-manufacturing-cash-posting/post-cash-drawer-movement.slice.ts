import { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits, MoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { InventoryManufacturingCashPostingDeps } from './inventory-manufacturing-cash-posting.types';

export type PostCashDrawerMovementBoundDeps = {
  ensureTenantFoundation(queryable: DbOrTx, auth: AuthContext): Promise<void>;
  toMoney: InventoryManufacturingCashPostingDeps['toMoney'];
  getTenantAccountingSettings: InventoryManufacturingCashPostingDeps['getTenantAccountingSettings'];
  resolveSystemAccountByCode: InventoryManufacturingCashPostingDeps['resolveSystemAccountByCode'];
  addLine: InventoryManufacturingCashPostingDeps['addLine'];
  insertPostedJournal: InventoryManufacturingCashPostingDeps['insertPostedJournal'];
};

export class PostCashDrawerMovementSlice {
  private readonly bound: PostCashDrawerMovementBoundDeps;

  constructor(bound: PostCashDrawerMovementBoundDeps) {
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

  /**
   * Cash drawer manual cash_in and cash_out double-entry posting
   */
  async postCashDrawerMovement(
    queryable: DbOrTx,
    txnId: number,
    movementType: 'cash_in' | 'cash_out' | string,
    amount: number,
    note: string,
    branchId: number | null,
    locationId: number | null,
    auth: AuthContext,
    counterpartAccountId?: number | null,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    await this.ensureTenantFoundation(queryable, auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const moneyAmount = this.toMoney(amount, bookDigits);

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    let cashAccountId = Number(settings?.cash_account_id || 0);
    if (!(cashAccountId > 0)) cashAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1110');

    // INV-CASH-DRAWER-MOVEMENT-TYPES: safe transfers are
    // asset-to-asset journals, never profit legs. The counterpart
    // is caller-named — the dedicated safe/cash-box account is
    // 1111 (INV-DRAWER-DISBURSE-CASHIER-PASSWORD, migration 0324)
    // — and is validated here — the journal writer fails closed —
    // exactly like a treasury transfer, under lock, before any
    // line is built. An unknown movement type throws instead of
    // returning unposted: a silent skip would leave the treasury
    // row posted with no journal and no trace.
    const isTransferType = movementType === 'safe_drop' || movementType === 'safe_replenishment';
    let counterpartId = 0;
    if (isTransferType) {
      counterpartId = Number(counterpartAccountId || 0);
      if (!(counterpartId > 0))
        throw new AppError(
          'A counterpart cash or bank account is required for a safe transfer',
          'DRAWER_COUNTERPART_REQUIRED',
          400,
        );
      const counterpart = await queryable
        .selectFrom('accounting_accounts')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('id', '=', counterpartId)
        .where('account_type', '=', 'asset')
        .where('normal_balance', '=', 'debit')
        .where('is_cash_bank', '=', true)
        .where('is_active', '=', true)
        .forUpdate()
        .executeTakeFirst();
      if (!counterpart)
        throw new AppError(
          'The counterpart must be an active cash or bank account in this tenant',
          'TREASURY_ACCOUNT_NOT_FOUND',
          400,
        );
      if (counterpartId === cashAccountId)
        throw new AppError(
          'The counterpart must differ from the drawer cash account',
          'DRAWER_COUNTERPART_SAME_AS_CASH',
          400,
        );
    } else if (movementType !== 'cash_in' && movementType !== 'cash_out') {
      throw new AppError('Unknown cash drawer movement type', 'DRAWER_MOVEMENT_TYPE_UNKNOWN', 400);
    }
    if (moneyAmount <= 0) return { posted: false, journalEntryId: null };

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    if (movementType === 'cash_in') {
      const incomeAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '7100');
      addBookLine({
        accountId: cashAccountId,
        description: `توريد نقدية للدرج: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: incomeAccountId,
        description: `إيرادات / توريدات نقدية متفرقة: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (movementType === 'cash_out') {
      let expenseAccountId = Number(settings?.expenses_account_id || 0);
      if (!(expenseAccountId > 0))
        expenseAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '6950');
      addBookLine({
        accountId: expenseAccountId,
        description: `صرف نقدية من الدرج: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: cashAccountId,
        description: `سحب نقدية من الدرج: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (movementType === 'safe_drop') {
      addBookLine({
        accountId: counterpartId,
        description: `تحويل نقدية من الدرج إلى الخزنة: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: cashAccountId,
        description: `سحب نقدية من الدرج إلى الخزنة: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else if (movementType === 'safe_replenishment') {
      addBookLine({
        accountId: cashAccountId,
        description: `تغذية الدرج من الخزنة: ${note}`,
        debit: moneyAmount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
      addBookLine({
        accountId: counterpartId,
        description: `تحويل نقدية من الخزنة إلى الدرج: ${note}`,
        debit: 0,
        credit: moneyAmount,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    } else {
      throw new AppError('Unknown cash drawer movement type', 'DRAWER_MOVEMENT_TYPE_UNKNOWN', 400);
    }

    const movementLabel =
      movementType === 'cash_in'
        ? 'توريد'
        : movementType === 'cash_out'
          ? 'صرف'
          : movementType === 'safe_drop'
            ? 'تحويل للخزنة'
            : 'تغذية من الخزنة';
    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: `cash_drawer_${movementType}`,
      sourceId: txnId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد حركة درج نقدية #${txnId} (${movementLabel})`,
      branchId,
      locationId,
      createdBy: auth.userId,
      postedBy: auth.userId,
      lines,
    });
    return { posted: true, journalEntryId: entryId };
  }
}
