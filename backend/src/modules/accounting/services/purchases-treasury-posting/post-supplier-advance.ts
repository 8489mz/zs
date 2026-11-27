import { sql } from '../../../../database/kysely';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting-types';

export class PostSupplierAdvanceService {
  constructor(
    private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'],
    private readonly maxAllowedDifference: PurchasesAndTreasuryPostingDeps['maxAllowedDifference'],
    private readonly getTenantAccountingSettings: PurchasesAndTreasuryPostingDeps['getTenantAccountingSettings'],
    private readonly resolveAccountWithFallback: PurchasesAndTreasuryPostingDeps['resolveAccountWithFallback'],
    private readonly resolveSystemAccountByCode: PurchasesAndTreasuryPostingDeps['resolveSystemAccountByCode'],
    private readonly addLine: PurchasesAndTreasuryPostingDeps['addLine'],
    private readonly getActiveAccountMap: PurchasesAndTreasuryPostingDeps['getActiveAccountMap'],
    private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'],
    private readonly logger: PurchasesAndTreasuryPostingDeps['logger'],
    private readonly getExistingSupplierPaymentScheduleSettlementJournal: PurchasesAndTreasuryPostingDeps['getExistingSupplierPaymentScheduleSettlementJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  /* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT: apply part or all of a
   * supplier advance against a later bill — Dr 2110 Accounts Payable
   * / Cr 1185 Supplier Advances. The payable balance itself moves in
   * the caller (PurchasesWriteService.applySupplierAdvance, via a
   * supplier-ledger entry) so the statement shows the relief; this
   * method owns the journal and the applied_amount counter, in the
   * same transaction, so the two can never drift apart.
   *
   * Guards (all fail-closed, in tenant minor units):
   * - the payment must exist and be an advance (is_advance);
   * - amount must be positive and within minor-unit precision;
   * - amount is capped at the outstanding advance (amount -
   *   applied_amount) — over-applying is SUPPLIER_ADVANCE_OVERAPPLY;
   * - amount is capped at the supplier payable balance — applying
   *   more than is owed is SUPPLIER_ADVANCE_EXCEEDS_PAYABLE.
   * Partial applies are legitimate, so there is no once-per-source
   * dedup here: the applied_amount cap is the idempotency guard
   * (insertPostedJournal also skips dedup for this source type).
   * The partner-subledger sync never runs for this source type, so
   * the balance moves exactly once, in the caller's ledger entry. */
  async postSupplierAdvanceApplication(
    queryable: DbOrTx,
    advancePaymentId: number,
    applyAmount: number,
    purchaseId: number | null,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null; appliedAmount: number; remainingAdvance: number }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    const payment = await queryable
      .selectFrom('supplier_payments as sp')
      .leftJoin('suppliers as s', 's.id', 'sp.supplier_id')
      .select([
        'sp.id',
        'sp.doc_no',
        'sp.supplier_id',
        'sp.amount',
        'sp.is_advance',
        'sp.applied_amount',
        'sp.branch_id',
        'sp.location_id',
        'sp.created_by',
        'sp.created_at',
        's.name as supplier_name',
        's.balance as supplier_balance',
      ])
      .where('sp.id', '=', advancePaymentId)
      .where(sql<boolean>`sp.tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!payment) throw new AppError('Supplier advance payment not found', 'SUPPLIER_ADVANCE_NOT_FOUND', 404);
    if (payment.is_advance !== true)
      throw new AppError('Payment is not a supplier advance', 'SUPPLIER_ADVANCE_NOT_ADVANCE', 400);

    const amount = toBookMoney(applyAmount);
    if (!(amount > 0)) throw new AppError('Advance application must be positive', 'INVALID_AMOUNT', 400);
    const outstanding = toBookMoney(Number(payment.amount || 0) - Number(payment.applied_amount || 0));
    if (amount > outstanding + this.maxAllowedDifference(bookDigits)) {
      throw new AppError(
        `Advance application ${amount} exceeds the outstanding advance ${outstanding}`,
        'SUPPLIER_ADVANCE_OVERAPPLY',
        400,
      );
    }
    const payableBalance = toBookMoney(payment.supplier_balance || 0);
    if (amount > payableBalance + this.maxAllowedDifference(bookDigits)) {
      throw new AppError(
        `Advance application ${amount} exceeds the supplier payable balance ${payableBalance}`,
        'SUPPLIER_ADVANCE_EXCEEDS_PAYABLE',
        400,
      );
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while applying supplier advance ${advancePaymentId}`);

    const branchId = payment.branch_id ? Number(payment.branch_id) : null;
    const locationId = payment.location_id ? Number(payment.location_id) : null;
    const supplierName = String(payment.supplier_name || '').trim();
    const docNo = String(payment.doc_no || `ZPV-${advancePaymentId}`).trim();

    const supplierPayableAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.supplier_payable_account_id,
      '2110',
    );
    const advanceAccountId = await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1185');
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: supplierPayableAccountId,
      description: 'تطبيق دفعة مقدمة على مستحقات مورد',
      debit: amount,
      credit: 0,
      partnerType: payment.supplier_id ? 'supplier' : 'none',
      partnerId: payment.supplier_id ? Number(payment.supplier_id) : null,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: advanceAccountId,
      description: 'تخفيض دفعة مقدمة لمورد',
      debit: 0,
      credit: amount,
      partnerType: payment.supplier_id ? 'supplier' : 'none',
      partnerId: payment.supplier_id ? Number(payment.supplier_id) : null,
      branchId,
      locationId,
    });

    const accountMap = await this.getActiveAccountMap(
      queryable,
      scope.tenantId,
      lines.map((line) => line.accountId),
    );
    for (const line of lines) {
      if (!(line.accountId > 0))
        throw new Error(`Invalid accounting setting account id while applying supplier advance ${advancePaymentId}`);
      if (!accountMap.has(line.accountId))
        throw new Error(
          `Configured account ${line.accountId} was not found while applying supplier advance ${advancePaymentId}`,
        );
      if (!accountMap.get(line.accountId))
        throw new Error(
          `Configured account ${line.accountId} is inactive while applying supplier advance ${advancePaymentId}`,
        );
    }

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(
        `Unbalanced supplier advance application journal for payment ${advancePaymentId}: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'supplier_advance_application',
      sourceId: advancePaymentId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: payment.created_at ? new Date(payment.created_at) : new Date(),
      description: `قيد تطبيق دفعة مقدمة لمورد رقم ${docNo}${supplierName ? ` - ${supplierName}` : ''}${purchaseId ? ` على فاتورة شراء #${purchaseId}` : ''}`,
      branchId,
      locationId,
      createdBy: payment.created_by ? Number(payment.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    const appliedAmount = toBookMoney(Number(payment.applied_amount || 0) + amount);
    await queryable
      .updateTable('supplier_payments')
      .set({ applied_amount: appliedAmount })
      .where('id', '=', advancePaymentId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .execute();

    return {
      posted: true,
      journalEntryId: entryId,
      appliedAmount: amount,
      remainingAdvance: toBookMoney(outstanding - amount),
    };
  }

  async postSupplierPaymentScheduleSettlement(
    queryable: DbOrTx,
    settlementId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSupplierPaymentScheduleSettlementJournal(
      queryable,
      settlementId,
      scope.tenantId,
    );
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const settlement = await queryable
      .selectFrom('supplier_payment_schedule_logs as l')
      .leftJoin('supplier_payment_schedules as sch', 'sch.id', 'l.schedule_id')
      .leftJoin('suppliers as s', 's.id', 'l.supplier_id')
      .select([
        'l.id',
        'l.schedule_id',
        'l.supplier_id',
        'l.amount',
        'l.payment_channel',
        'l.note',
        'l.created_by',
        'l.created_at',
        'sch.purchase_id',
        's.name as supplier_name',
      ])
      .where('l.id', '=', settlementId)
      .where(sql<boolean>`l.tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!settlement) {
      this.logger.warn(`Supplier payment schedule settlement ${settlementId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings)
      throw new Error(`Accounting settings missing while posting supplier payment schedule settlement ${settlementId}`);

    const amount = toBookMoney(settlement.amount);
    if (!(amount > 0)) {
      this.logger.warn(
        `Supplier payment schedule settlement ${settlementId} has non-positive amount; skipping accounting post`,
      );
      return { posted: false, journalEntryId: null };
    }

    const purchase = settlement.purchase_id
      ? await queryable
          .selectFrom('purchases')
          .select(['branch_id', 'location_id'])
          .where('id', '=', Number(settlement.purchase_id))
          .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
          .executeTakeFirst()
      : null;

    const branchId = purchase?.branch_id ? Number(purchase.branch_id) : null;
    const locationId = purchase?.location_id ? Number(purchase.location_id) : null;
    const supplierName = String(settlement.supplier_name || '').trim();

    const supplierPayableAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.supplier_payable_account_id,
      '2110',
    );
    const cashAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.cash_account_id,
      '1110',
    );
    const paymentAccountId =
      (settlement.payment_channel || 'cash') === 'cash'
        ? cashAccountId
        : await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: supplierPayableAccountId,
      description: 'سداد مستحقات مورد',
      debit: amount,
      credit: 0,
      partnerType: settlement.supplier_id ? 'supplier' : 'none',
      partnerId: settlement.supplier_id ? Number(settlement.supplier_id) : null,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: paymentAccountId,
      description:
        (settlement.payment_channel || 'cash') === 'cash'
          ? 'خروج نقدية لسداد مورد'
          : 'سداد قسط مورد عبر البنك أو المدفوعات الإلكترونية',
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    });

    const accountMap = await this.getActiveAccountMap(
      queryable,
      scope.tenantId,
      lines.map((line) => line.accountId),
    );
    for (const line of lines) {
      if (!(line.accountId > 0))
        throw new Error(
          `Invalid accounting setting account id while posting supplier payment schedule settlement ${settlementId}`,
        );
      if (!accountMap.has(line.accountId))
        throw new Error(
          `Configured account ${line.accountId} was not found while posting supplier payment schedule settlement ${settlementId}`,
        );
      if (!accountMap.get(line.accountId))
        throw new Error(
          `Configured account ${line.accountId} is inactive while posting supplier payment schedule settlement ${settlementId}`,
        );
    }

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(
        `Unbalanced supplier payment schedule settlement journal for settlement ${settlementId}: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'supplier_payment_schedule_settlement',
      sourceId: settlementId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: settlement.created_at ? new Date(settlement.created_at) : new Date(),
      description: `قيد سداد مورد${supplierName ? ` - ${supplierName}` : ''}`,
      branchId,
      locationId,
      createdBy: settlement.created_by ? Number(settlement.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }
}
