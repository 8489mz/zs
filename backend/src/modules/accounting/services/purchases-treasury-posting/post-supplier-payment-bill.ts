import { sql } from '../../../../database/kysely';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { formatLocalCalendarDay } from '../../../../common/utils/tenant-timezone.util';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting-types';

export class PostSupplierPaymentBillService {
  constructor(
    private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'],
    private readonly getExistingSupplierPaymentJournal: PurchasesAndTreasuryPostingDeps['getExistingSupplierPaymentJournal'],
    private readonly getExistingSupplierBillJournal: PurchasesAndTreasuryPostingDeps['getExistingSupplierBillJournal'],
    private readonly logger: PurchasesAndTreasuryPostingDeps['logger'],
    private readonly getTenantAccountingSettings: PurchasesAndTreasuryPostingDeps['getTenantAccountingSettings'],
    private readonly resolveAccountWithFallback: PurchasesAndTreasuryPostingDeps['resolveAccountWithFallback'],
    private readonly resolveSystemAccountByCode: PurchasesAndTreasuryPostingDeps['resolveSystemAccountByCode'],
    private readonly addLine: PurchasesAndTreasuryPostingDeps['addLine'],
    private readonly getActiveAccountMap: PurchasesAndTreasuryPostingDeps['getActiveAccountMap'],
    private readonly maxAllowedDifference: PurchasesAndTreasuryPostingDeps['maxAllowedDifference'],
    private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  async postSupplierPayment(
    queryable: DbOrTx,
    paymentId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSupplierPaymentJournal(queryable, paymentId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const payment = await queryable
      .selectFrom('supplier_payments as sp')
      .leftJoin('suppliers as s', 's.id', 'sp.supplier_id')
      .select([
        'sp.id',
        'sp.doc_no',
        'sp.supplier_id',
        'sp.amount',
        'sp.is_advance',
        'sp.payment_channel',
        'sp.note',
        'sp.payment_date',
        'sp.branch_id',
        'sp.location_id',
        'sp.created_by',
        'sp.created_at',
        's.name as supplier_name',
      ])
      .where('sp.id', '=', paymentId)
      .where(sql<boolean>`sp.tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!payment) {
      this.logger.warn(`Supplier payment ${paymentId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting supplier payment ${paymentId}`);

    const amount = toBookMoney(payment.amount);
    if (!(amount > 0)) {
      this.logger.warn(`Supplier payment ${paymentId} has non-positive amount; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const branchId = payment.branch_id ? Number(payment.branch_id) : null;
    const locationId = payment.location_id ? Number(payment.location_id) : null;
    const supplierName = String(payment.supplier_name || '').trim();
    const docNo = String(payment.doc_no || `ZPV-${paymentId}`).trim();

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
      (payment.payment_channel || 'cash') === 'cash'
        ? cashAccountId
        : await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    /* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT (trial D08): an advance is
     * NOT a settlement — it debits the dedicated advance asset 1185
     * and never touches the 2110 payable. resolveSystemAccountByCode
     * fails closed (a tenant-created 1185 of another type throws)
     * and auto-creates the account from the fallback map when the
     * chart lacks it. An ordinary payment keeps Dr 2110. */
    const isAdvance = payment.is_advance === true;
    const debitAccountId = isAdvance
      ? await this.resolveSystemAccountByCode(queryable, scope.tenantId, '1185')
      : supplierPayableAccountId;
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: debitAccountId,
      description: isAdvance ? 'دفعة مقدمة لمورد' : 'سداد مستحقات مورد',
      debit: amount,
      credit: 0,
      partnerType: payment.supplier_id ? 'supplier' : 'none',
      partnerId: payment.supplier_id ? Number(payment.supplier_id) : null,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: paymentAccountId,
      description:
        (payment.payment_channel || 'cash') === 'cash'
          ? isAdvance
            ? 'خروج نقدية كدفعة مقدمة لمورد'
            : 'خروج نقدية لسداد مورد'
          : isAdvance
            ? 'دفعة مقدمة لمورد عبر البنك أو المدفوعات الإلكترونية'
            : 'سداد مورد عبر البنك أو المدفوعات الإلكترونية',
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
        throw new Error(`Invalid accounting setting account id while posting supplier payment ${paymentId}`);
      if (!accountMap.has(line.accountId))
        throw new Error(
          `Configured account ${line.accountId} was not found while posting supplier payment ${paymentId}`,
        );
      if (!accountMap.get(line.accountId))
        throw new Error(`Configured account ${line.accountId} is inactive while posting supplier payment ${paymentId}`);
    }

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(
        `Unbalanced supplier payment journal for payment ${paymentId}: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'supplier_payment',
      sourceId: paymentId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: payment.payment_date
        ? new Date(payment.payment_date)
        : payment.created_at
          ? new Date(payment.created_at)
          : new Date(),
      description: isAdvance
        ? `قيد دفعة مقدمة لمورد رقم ${docNo}${supplierName ? ` - ${supplierName}` : ''}`
        : `قيد سداد مورد رقم ${docNo}${supplierName ? ` - ${supplierName}` : ''}`,
      branchId,
      locationId,
      createdBy: payment.created_by ? Number(payment.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }

  /* INV-SUPPLIER-NONSTOCK-BILL: post a non-stock supplier bill — Dr each
   * bill line's chart account / Cr 2110 Accounts Payable. The debit lines
   * carry partnerType 'none' (the expense/asset belongs to the tenant,
   * not to the supplier subledger); the 2110 credit carries partnerType
   * 'supplier' so the subledger sync attributes the payable to this
   * supplier, exactly like the supplier opening-balance posting. No
   * stock, no cash, no GRN: the payable balance itself moves in the
   * caller (SupplierBillsService, via a supplier-ledger entry), so the
   * statement shows the debt; this method owns the journal only. */
  async postSupplierBill(
    queryable: DbOrTx,
    billId: number,
    auth: AuthContext,
  ): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingSupplierBillJournal(queryable, billId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const bill = await queryable
      .selectFrom('supplier_bills as sb')
      .leftJoin('suppliers as s', 's.id', 'sb.supplier_id')
      .select([
        'sb.id',
        'sb.doc_no',
        'sb.supplier_id',
        'sb.bill_date',
        'sb.total',
        'sb.note',
        'sb.created_by',
        'sb.created_at',
        's.name as supplier_name',
      ])
      .where('sb.id', '=', billId)
      .where(sql<boolean>`sb.tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    if (!bill) {
      this.logger.warn(`Supplier bill ${billId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }
    const billLines = await queryable
      .selectFrom('supplier_bill_lines')
      .select(['chart_account_id', 'description', 'amount'])
      .where('bill_id', '=', billId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .orderBy('sort_order', 'asc')
      .execute();
    if (billLines.length === 0) {
      throw new Error(`Supplier bill ${billId} has no lines; refusing to post an empty journal`);
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting supplier bill ${billId}`);

    const total = toBookMoney(bill.total);
    if (!(total > 0)) {
      this.logger.warn(`Supplier bill ${billId} has non-positive total; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const branchId = null;
    const locationId = null;
    const supplierName = String(bill.supplier_name || '').trim();
    const docNo = String(bill.doc_no || `SPB-${billId}`).trim();

    const supplierPayableAccountId = await this.resolveAccountWithFallback(
      queryable,
      scope.tenantId,
      settings.supplier_payable_account_id,
      '2110',
    );
    const lineAccountIds = billLines.map((row: any) => Number(row.chart_account_id));
    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, [
      ...lineAccountIds,
      supplierPayableAccountId,
    ]);
    for (const accountId of [...lineAccountIds, supplierPayableAccountId]) {
      if (!(accountId > 0))
        throw new Error(`Invalid accounting setting account id while posting supplier bill ${billId}`);
      if (!accountMap.has(accountId))
        throw new Error(`Configured account ${accountId} was not found while posting supplier bill ${billId}`);
      if (!accountMap.get(accountId))
        throw new Error(`Configured account ${accountId} is inactive while posting supplier bill ${billId}`);
    }

    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    for (const row of billLines as Array<{ chart_account_id: number; description: string; amount: number }>) {
      const amount = toBookMoney(row.amount);
      if (!(amount > 0)) throw new Error(`Supplier bill ${billId} has a non-positive line amount; refusing to post`);
      addBookLine({
        accountId: Number(row.chart_account_id),
        description: String(row.description || '').trim() || 'بند فاتورة مورد بدون مخزون',
        debit: amount,
        credit: 0,
        partnerType: 'none',
        partnerId: null,
        branchId,
        locationId,
      });
    }
    addBookLine({
      accountId: supplierPayableAccountId,
      description: `مستحق مورد — فاتورة بدون مخزون ${docNo}`,
      debit: 0,
      credit: total,
      partnerType: bill.supplier_id ? 'supplier' : 'none',
      partnerId: bill.supplier_id ? Number(bill.supplier_id) : null,
      branchId,
      locationId,
    });

    const normalizedLines = lines
      .map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) }))
      .filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced supplier bill journal for bill ${billId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'supplier_bill',
      sourceId: billId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      // bill_date is a stored pg DATE: pass its day string, not a
      // new Date() of it. A Date copy is a host-local-midnight
      // instant, and insertPostedJournal re-derives it in the TENANT
      // zone — one day early whenever the tenant zone is west of the
      // host zone. The day string passes through untouched.
      entryDate: bill.bill_date
        ? bill.bill_date instanceof Date
          ? formatLocalCalendarDay(bill.bill_date)
          : String(bill.bill_date).slice(0, 10)
        : bill.created_at
          ? new Date(bill.created_at)
          : new Date(),
      description: `قيد فاتورة مورد بدون مخزون رقم ${docNo}${supplierName ? ` - ${supplierName}` : ''}`,
      branchId,
      locationId,
      createdBy: bill.created_by ? Number(bill.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }
}
