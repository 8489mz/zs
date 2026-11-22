import { sql } from '../../../../database/kysely';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { ExpenseAccountCandidate, PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting-types';

export class PostCustomerPaymentExpenseService {
  constructor(
    private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'],
    private readonly getExistingCustomerPaymentJournal: PurchasesAndTreasuryPostingDeps['getExistingCustomerPaymentJournal'],
    private readonly getExistingExpenseJournal: PurchasesAndTreasuryPostingDeps['getExistingExpenseJournal'],
    private readonly logger: PurchasesAndTreasuryPostingDeps['logger'],
    private readonly getTenantAccountingSettings: PurchasesAndTreasuryPostingDeps['getTenantAccountingSettings'],
    private readonly resolveAccountWithFallback: PurchasesAndTreasuryPostingDeps['resolveAccountWithFallback'],
    private readonly addLine: PurchasesAndTreasuryPostingDeps['addLine'],
    private readonly getActiveAccountMap: PurchasesAndTreasuryPostingDeps['getActiveAccountMap'],
    private readonly maxAllowedDifference: PurchasesAndTreasuryPostingDeps['maxAllowedDifference'],
    private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  private normalizeExpenseText(input: string): string {
    return String(input || '').trim().toLowerCase();
  }

  private mapExpenseTitleToAccountCode(expenseTitle: string): string {
    const title = this.normalizeExpenseText(expenseTitle);
    if (!title) return '6900';

    if (title.includes('ايجار') || title.includes('إيجار') || title.includes('rent')) return '6100';
    if (
      title.includes('مرتب') || title.includes('مرتبات') || title.includes('اجور')
      || title.includes('أجور') || title.includes('salary') || title.includes('wage') || title.includes('payroll')
    ) return '6200';
    if (
      title.includes('انترنت') || title.includes('إنترنت') || title.includes('internet')
      // Colloquial / brand spellings a merchant actually types for an internet
      // bill: "النت" (not bare "نت" -- it sits inside منتج/منتجات/كانت), the
      // "انترنيت" spelling, ISP brands, wifi, and DSL. All are internet, so
      // all post to 6700 Administrative per the user's decision.
      || title.includes('النت') || title.includes(' نت')
      || title.includes('انترنيت') || title.includes('إنترنيت')
      || title.includes('انتر نت') || title.includes('إنتر نت')
      || title.includes('فودافون') || title.includes('vodafone')
      || title.includes('اتصالات') || title.includes('etisalat')
      || title.includes('اورنج') || title.includes('أورنج') || title.includes('orange')
      || title.includes('تي داتا') || title.includes('tedata') || title.includes('te data')
      || title.includes('واي فاي') || title.includes('وايفاي') || title.includes('wifi') || title.includes('wi-fi')
      || title.includes('dsl')
    ) return '6700';
    if (
      title.includes('كهرباء') || title.includes('مرافق') || title.includes('مياه')
      || title.includes('utilities') || title.includes('utility')
    ) return '6300';
    if (
      title.includes('نقل') || title.includes('شحن') || title.includes('delivery')
      || title.includes('shipping') || title.includes('transport') || title.includes('freight')
    ) return '6400';
    if (
      title.includes('تسويق') || title.includes('اعلان') || title.includes('إعلان')
      || title.includes('ads') || title.includes('marketing')
    ) return '6500';
    if (
      title.includes('صيانة') || title.includes('اصلاح') || title.includes('إصلاح')
      || title.includes('maintenance') || title.includes('repair')
    ) return '6600';
    if (
      title.includes('اداري') || title.includes('إداري') || title.includes('مكتبي')
      || title.includes('office') || title.includes('admin') || title.includes('administrative')
    ) return '6700';
    if (
      title.includes('بنكي') || title.includes('بنك') || title.includes('bank')
      || title.includes('fee') || title.includes('fees') || title.includes('عمولة بنكية')
      || title.includes('فيزا') || title.includes('visa')
      || title.includes('كارت') || title.includes('card')
      || title.includes('عمولة فيزا') || title.includes('عمولة بنك')
      || title.includes('رسوم بنكية')
      || title.includes('bank fee') || title.includes('bank fees')
      || title.includes('commission')
      || title.includes('payment fee') || title.includes('merchant fee')
    ) return '6800';
    return '6900';
  }

  private isValidExpensePostingAccount(account: ExpenseAccountCandidate | undefined): boolean {
    if (!account) return false;
    if (!account.is_active) return false;
    if (account.account_type !== 'expense') return false;
    if (!account.allow_manual_entries) return false;
    return true;
  }

  private expenseAccountInvalidReason(account: ExpenseAccountCandidate | undefined): string {
    if (!account) return 'account_missing';
    if (!account.is_active) return 'account_inactive';
    if (account.account_type !== 'expense') return `invalid_account_type:${account.account_type}`;
    if (!account.allow_manual_entries) return 'manual_entries_disabled';
    return 'ok';
  }

  private async findAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<ExpenseAccountCandidate | undefined> {
    const row = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'account_type', 'is_active', 'allow_manual_entries'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      id: Number(row.id),
      code: String(row.code || ''),
      name_ar: String(row.name_ar || ''),
      account_type: String(row.account_type || ''),
      is_active: Boolean(row.is_active),
      allow_manual_entries: Boolean(row.allow_manual_entries),
    };
  }

  private async findAccountById(queryable: DbOrTx, tenantId: string, accountId: number): Promise<ExpenseAccountCandidate | undefined> {
    if (!(accountId > 0)) return undefined;
    const row = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'code', 'name_ar', 'account_type', 'is_active', 'allow_manual_entries'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (!row) return undefined;
    return {
      id: Number(row.id),
      code: String(row.code || ''),
      name_ar: String(row.name_ar || ''),
      account_type: String(row.account_type || ''),
      is_active: Boolean(row.is_active),
      allow_manual_entries: Boolean(row.allow_manual_entries),
    };
  }

  private async resolveExpenseDebitAccountId(
    queryable: DbOrTx,
    tenantId: string,
    settings: { expenses_account_id: number | null },
    expenseTitle: string,
    expenseId: number,
  ): Promise<number> {
    const mappedCode = this.mapExpenseTitleToAccountCode(expenseTitle);
    const normalizedTitle = this.normalizeExpenseText(expenseTitle);
    const isUnknownCategory = mappedCode === '6900' && normalizedTitle.length > 0;
    const mappedAccount = await this.findAccountByCode(queryable, tenantId, mappedCode);
    if (this.isValidExpensePostingAccount(mappedAccount)) {
      if (isUnknownCategory) {
        this.logger.warn(`Expense ${expenseId} category "${expenseTitle}" is unknown; mapped to 6900 by default`);
      }
      return Number(mappedAccount!.id);
    }
    const mappedReason = this.expenseAccountInvalidReason(mappedAccount);
    this.logger.warn(
      `Expense ${expenseId} fallback: mapped category account ${mappedCode} failed (${mappedReason})`,
    );

    const settingsAccount = await this.findAccountById(queryable, tenantId, Number(settings.expenses_account_id || 0));
    if (this.isValidExpensePostingAccount(settingsAccount)) {
      this.logger.warn(`Expense ${expenseId} fallback: using accounting_settings.expenses_account_id (${settingsAccount!.code})`);
      return Number(settingsAccount!.id);
    }
    const settingsReason = this.expenseAccountInvalidReason(settingsAccount);
    this.logger.warn(`Expense ${expenseId} fallback: accounting_settings.expenses_account_id failed (${settingsReason})`);

    const fallback6900 = await this.findAccountByCode(queryable, tenantId, '6900');
    if (this.isValidExpensePostingAccount(fallback6900)) {
      this.logger.warn(`Expense ${expenseId} fallback: using code 6900 (مصروفات أخرى)`);
      return Number(fallback6900!.id);
    }
    const fallbackReason = this.expenseAccountInvalidReason(fallback6900);
    this.logger.warn(`Expense ${expenseId} fallback: code 6900 is not usable (${fallbackReason})`);

    throw new Error(`No valid expense posting account found for expense ${expenseId}`);
  }

  // Problem 28 (F2): the receipt number is REC-YYMMDD-###### where
  // ###### is the payment id (see generateCustomerPaymentDocNo in
  // purchases-write-customer-payments.service.ts). The live path passes
  // it explicitly; a recovery re-post has no caller-held number, so it
  // is derived from the stored row instead — same number, same day,
  // except for a payment inserted in the last second before midnight.
  private deriveCustomerPaymentDocNo(createdAt: unknown, paymentId: number): string {
    const at = createdAt ? new Date(createdAt as string) : new Date();
    const yy = String(at.getFullYear()).slice(-2);
    const mm = String(at.getMonth() + 1).padStart(2, '0');
    const dd = String(at.getDate()).padStart(2, '0');
    return `REC-${yy}${mm}${dd}-${String(paymentId).padStart(6, '0')}`;
  }

  async postCustomerPayment(queryable: DbOrTx, paymentId: number, auth: AuthContext, docNo?: string): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingCustomerPaymentJournal(queryable, paymentId, scope.tenantId);
    if (existing) return { posted: false, journalEntryId: Number(existing.id) };

    const payment = await queryable
      .selectFrom('customer_payments as cp')
      .leftJoin('customers as c', 'c.id', 'cp.customer_id')
      .select([
        'cp.id',
        'cp.customer_id',
        'cp.amount',
        'cp.payment_channel',
        'cp.transfer_reference',
        'cp.note',
        'cp.branch_id',
        'cp.location_id',
        'cp.created_by',
        'cp.created_at',
        'c.name as customer_name',
      ])
      .where('cp.id', '=', paymentId)
      .where(sql<boolean>`cp.tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!payment) {
      this.logger.warn(`Customer payment ${paymentId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting customer payment ${paymentId}`);

    const amount = toBookMoney(payment.amount);
    if (!(amount > 0)) {
      this.logger.warn(`Customer payment ${paymentId} has non-positive amount; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    // INV-REP-NONCASH-EVIDENCE-GATE (PD1): last line of defence for
    // any caller that reaches this posting without evidence — a
    // non-cash receipt debits bank 1120 below, so it must carry a
    // transfer reference of at least 3 characters (same bar as the
    // van field-collection gate). The service gate refuses first, so
    // this normally never fires; rows with no channel are cash.
    // A free-text note alone is not evidence.
    if ((payment.payment_channel || 'cash') !== 'cash') {
      const reference = String(payment.transfer_reference || '').trim();
      if (reference.length < 3) {
        throw new Error(
          `Customer payment ${paymentId}: refusing to debit bank 1120 for a non-cash receipt without a transfer reference of at least 3 characters`,
        );
      }
    }

    const branchId = payment.branch_id ? Number(payment.branch_id) : null;
    const locationId = payment.location_id ? Number(payment.location_id) : null;
    const customerName = String(payment.customer_name || '').trim();
    const receiptNo = docNo || this.deriveCustomerPaymentDocNo(payment.created_at, paymentId);
    const receiptLabel = receiptNo ? ` - سند قبض ${receiptNo}` : '';

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');
    const customerAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.customer_receivable_account_id, '1130');
    const paymentAccountId = (payment.payment_channel || 'cash') === 'cash' ? cashAccountId :
      await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.bank_account_id, '1120');
    const lines: JournalLineDraft[] = [];
    const addBookLine = (line: JournalLineDraft) => this.addLine(lines, line, bookDigits);
    addBookLine({
      accountId: paymentAccountId,
      description: (payment.payment_channel || 'cash') === 'cash' ? 'دخول نقدية من تحصيل عميل' : 'تحصيل عميل عبر البنك أو المدفوعات الإلكترونية',
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    });
    addBookLine({
      accountId: customerAccountId,
      description: 'تحصيل مستحقات عميل',
      debit: 0,
      credit: amount,
      partnerType: payment.customer_id ? 'customer' : 'none',
      partnerId: payment.customer_id ? Number(payment.customer_id) : null,
      branchId,
      locationId,
    });

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting customer payment ${paymentId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting customer payment ${paymentId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting customer payment ${paymentId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced customer payment journal for payment ${paymentId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'customer_payment',
      sourceId: paymentId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: payment.created_at ? new Date(payment.created_at) : new Date(),
      description: `قيد تحصيل عميل${customerName ? ` - ${customerName}` : ''}${receiptLabel}`,
      branchId,
      locationId,
      createdBy: payment.created_by ? Number(payment.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }


  async postExpense(queryable: DbOrTx, expenseId: number, auth: AuthContext): Promise<{ posted: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);
    const existing = await this.getExistingExpenseJournal(queryable, expenseId, scope.tenantId);
    if (existing) {
      this.logger.warn(`Skipping duplicate expense journal for expense ${expenseId}; existing entry ${existing.id}`);
      return { posted: false, journalEntryId: Number(existing.id) };
    }

    const expense = await queryable
      .selectFrom('expenses')
      .select([
        'id',
        'title',
        'amount',
        'note',
        'expense_date',
        'branch_id',
        'location_id',
        'cost_center_id',
        'created_by',
        'created_at',
      ])
      .where('id', '=', expenseId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();

    if (!expense) {
      this.logger.warn(`Expense ${expenseId} not found; skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const settings = await this.getTenantAccountingSettings(queryable, scope.tenantId);
    if (!settings) throw new Error(`Accounting settings missing while posting expense ${expenseId}`);

    const amount = toBookMoney(expense.amount);
    if (!(amount > 0)) {
      this.logger.warn(`Expense ${expenseId} has invalid amount (${amount}); skipping accounting post`);
      return { posted: false, journalEntryId: null };
    }

    const branchId = expense.branch_id ? Number(expense.branch_id) : null;
    const locationId = expense.location_id ? Number(expense.location_id) : null;
    const costCenterId = expense.cost_center_id ? Number(expense.cost_center_id) : null;
    const expenseTitle = String(expense.title || '').trim();
    const expenseDebitAccountId = await this.resolveExpenseDebitAccountId(queryable, scope.tenantId, settings, expenseTitle, expenseId);
    const expenseLabel = expenseTitle || 'مصروف عام';

    const cashAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, settings.cash_account_id, '1110');

    // Current expense flow is cash-based and does not persist payment method.
    // Use cash account credit to match existing treasury transaction behavior (txn_type: expense, negative amount).
    const lines: JournalLineDraft[] = [];
    this.addLine(lines, {
      accountId: expenseDebitAccountId,
      description: `إثبات مصروف ${expenseLabel}`,
      debit: amount,
      credit: 0,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
      costCenterId,
    }, bookDigits);
    this.addLine(lines, {
      accountId: cashAccountId,
      description: 'خروج نقدية لمصروف',
      debit: 0,
      credit: amount,
      partnerType: 'none',
      partnerId: null,
      branchId,
      locationId,
    }, bookDigits);

    const accountMap = await this.getActiveAccountMap(queryable, scope.tenantId, lines.map((line) => line.accountId));
    for (const line of lines) {
      if (!(line.accountId > 0)) throw new Error(`Invalid accounting setting account id while posting expense ${expenseId}`);
      if (!accountMap.has(line.accountId)) throw new Error(`Configured account ${line.accountId} was not found while posting expense ${expenseId}`);
      if (!accountMap.get(line.accountId)) throw new Error(`Configured account ${line.accountId} is inactive while posting expense ${expenseId}`);
    }

    const normalizedLines = lines.map((line) => ({ ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) })).filter((line) => line.debit > 0 || line.credit > 0);
    const totalDebit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(normalizedLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced expense journal for expense ${expenseId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'expense',
      sourceId: expenseId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: expense.expense_date ? new Date(expense.expense_date) : (expense.created_at ? new Date(expense.created_at) : new Date()),
      description: `قيد مصروف: ${expenseTitle || `EXP-${expenseId}`}`,
      branchId,
      locationId,
      createdBy: expense.created_by ? Number(expense.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: normalizedLines,
    });

    return { posted: true, journalEntryId: entryId };
  }
}
