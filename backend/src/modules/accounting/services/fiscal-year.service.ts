import { Inject, Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { CloseFiscalPeriodDto, ReopenFiscalPeriodDto, FiscalPeriodResponse } from '../dto/fiscal-period.dto';
import { buildMonthlyFiscalPeriods } from '../engines/fiscal-period-generation.engine';
import { AccountingPostingService } from '../accounting-posting.service';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { nextAccountingDay, resolveBusinessDateKey } from '../engines/accounting-date.engine';
import { assertAccountingCloseReady } from '../accounting-close-readiness';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, roundMoney, type MoneyDigits } from '../engines/money-minor-units.engine';

export interface CreateFiscalYearDto {
  name: string;
  code?: string;
  startDate: string;
  endDate: string;
}

export interface CloseFiscalYearDto {
  retainedEarningsAccountId?: number;
  notes?: string;
}

export interface ReopenFiscalYearDto {
  reason: string;
}

export interface FiscalYearAccountBalance {
  id: number;
  code: string;
  name_ar: string;
  name_en: string | null;
  account_type: string;
  balance: number;
  closingDebit: number;
  closingCredit: number;
}

export interface ProposedClosingLine {
  accountId: number;
  accountCode: string;
  accountName: string;
  debit: number;
  credit: number;
  description: string;
}

/** Shared classification for preview and the locked, live closing check. */
export function fiscalProfitAndLossCategory(account: { code: string; account_type: string }): 'revenue' | 'expense' | null {
  const code = String(account.code || '');
  const type = String(account.account_type || '').toLowerCase();
  if (type === 'revenue' || type === 'contra_revenue' || code.startsWith('4') || code.startsWith('71')) return 'revenue';
  if (type === 'expense' || type === 'operating_expenses' || type === 'cogs' || type === 'contra_expense' ||
      code.startsWith('5') || code.startsWith('6') || code.startsWith('72')) return 'expense';
  return null;
}

/** Retain the P&L accounts and redirect only the retained-earnings line. */
export function resolveClosingJournalAccounts(
  proposed: ProposedClosingLine[],
  defaultRetainedId: number | null,
  selectedRetainedId: number,
): ProposedClosingLine[] {
  if (!Number.isSafeInteger(selectedRetainedId) || selectedRetainedId <= 0) {
    throw new BadRequestException('حساب الأرباح المحتجزة غير صالح.');
  }
  return proposed.map((line) => (
    defaultRetainedId != null &&
    line.accountId === defaultRetainedId &&
    line.description.includes('الأرباح المحتجزة')
      ? { ...line, accountId: selectedRetainedId }
      : line
  ));
}

export interface FiscalYearPreviewResult {
  fiscalYear: any;
  unpostedEntriesCount: number;
  canClose: boolean;
  blockReason: string | null;
  totalRevenue: number;
  totalExpense: number;
  netProfitLoss: number;
  isProfit: boolean;
  retainedEarningsAccount: {
    id: number;
    code: string;
    name_ar: string;
  } | null;
  revenueAccounts: FiscalYearAccountBalance[];
  expenseAccounts: FiscalYearAccountBalance[];
  proposedClosingLines: ProposedClosingLine[];
}

@Injectable()
export class FiscalYearService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  /* List/get shaping at the tenant's book digits (was hardcoded 2dp).
   * Non-finite input still shapes to 0, as before. */
  private toMoney(value: unknown, digits: MoneyDigits): number {
    const n = Number(value || 0);
    return Number.isFinite(n) ? roundMoney(n, digits) : 0;
  }

  /**
   * Close-path rounding: round once with the canonical engine at the
   * tenant's book digits. Kept separate from toMoney so the close
   * computation can never silently fall back to display shaping.
   */
  private toBookMoney(value: unknown, digits: MoneyDigits): number {
    return this.toMoney(value, digits);
  }

  private formatDate(date: any): string {
    if (!date) return '';
    if (typeof date === 'string') return date.substring(0, 10);
    if (date instanceof Date) return date.toISOString().substring(0, 10);
    return String(date).substring(0, 10);
  }

  private assertAdmin(auth: AuthContext): void {
    if (auth.role !== 'admin' && auth.role !== 'super_admin') {
      throw new ForbiddenException('هذه العملية تتطلب صلاحية مدير النظام أو المشرف المالي.');
    }
  }

  /**
   * List all fiscal years for the tenant with overall stats
   */
  async listFiscalYears(auth: AuthContext): Promise<{
    data: any[];
    stats: {
      totalYears: number;
      openYears: number;
      closedYears: number;
      currentYearId: number | null;
    };
  }> {
    const tenantId = String(auth.tenantId || '');
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));

    const years = await this.db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('start_date', 'desc')
      .execute();

    let openYears = 0;
    let closedYears = 0;
    let currentYearId: number | null = null;

    const formatted = years.map((y) => {
      const start = this.formatDate(y.start_date);
      const end = this.formatDate(y.end_date);
      if (y.status === 'closed') {
        closedYears++;
      } else {
        openYears++;
      }
      if (today >= start && today <= end) {
        currentYearId = y.id;
      }
      return {
        ...y,
        start_date: start,
        end_date: end,
        net_profit_loss: this.toMoney(y.net_profit_loss, digits),
        total_revenue: this.toMoney(y.total_revenue, digits),
        total_expense: this.toMoney(y.total_expense, digits),
      };
    });

    return {
      data: formatted,
      stats: {
        totalYears: years.length,
        openYears,
        closedYears,
        currentYearId,
      },
    };
  }

  /**
   * Get single fiscal year details
   */
  async getFiscalYear(auth: AuthContext, id: number): Promise<any> {
    const tenantId = String(auth.tenantId || '');
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    let closingEntry: any = null;
    if (fy.closing_entry_id) {
      closingEntry = await this.db
        .selectFrom('journal_entries')
        .selectAll()
        .where('tenant_id', '=', tenantId)
        .where('id', '=', fy.closing_entry_id)
        .executeTakeFirst();
    }

    return {
      ...fy,
      start_date: this.formatDate(fy.start_date),
      end_date: this.formatDate(fy.end_date),
      net_profit_loss: this.toMoney(fy.net_profit_loss, digits),
      total_revenue: this.toMoney(fy.total_revenue, digits),
      total_expense: this.toMoney(fy.total_expense, digits),
      closingEntry,
    };
  }

  /**
   * Create a new fiscal year period
   */
  async createFiscalYear(auth: AuthContext, dto: CreateFiscalYearDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');

    const name = String(dto.name || '').trim();
    if (!name) {
      throw new BadRequestException('يجب إدخال اسم السنة المالية (مثال: السنة المالية 2025).');
    }

    const startDate = this.formatDate(dto.startDate);
    const endDate = this.formatDate(dto.endDate);

    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ بداية وتاريخ نهاية صالحين للسنة المالية.');
    }

    if (startDate >= endDate) {
      throw new BadRequestException('تاريخ بداية السنة المالية يجب أن يكون قبل تاريخ النهاية.');
    }

    // Check overlapping periods in same tenant
    const overlapping = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'name', 'start_date', 'end_date'])
      .where('tenant_id', '=', tenantId)
      .where('start_date', '<=', endDate as any)
      .where('end_date', '>=', startDate as any)
      .executeTakeFirst();

    if (overlapping) {
      throw new BadRequestException(
        `توجد سنة مالية أخرى [${overlapping.name}] تتداخل مع هذه الفترة (${this.formatDate(overlapping.start_date)} إلى ${this.formatDate(overlapping.end_date)}).`,
      );
    }

    // The overlap SELECT above is only for a friendly message; it races with concurrent creates.
    // accounting_fiscal_years_no_overlap (EXCLUDE ... USING gist) is the actual guarantee.
    let inserted;
    try {
      inserted = await this.db
        .insertInto('accounting_fiscal_years')
        .values({
          tenant_id: tenantId,
          name,
          code: dto.code ? String(dto.code).trim() : null,
          start_date: startDate as any,
          end_date: endDate as any,
          status: 'open',
          net_profit_loss: 0,
          total_revenue: 0,
          total_expense: 0,
          created_at: sql`NOW()` as any,
          updated_at: sql`NOW()` as any,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
    } catch (error: any) {
      if (error?.code === '23P01' || String(error?.constraint || '') === 'accounting_fiscal_years_no_overlap') {
        throw new BadRequestException('توجد سنة مالية أخرى تتداخل مع هذه الفترة. يرجى مراجعة التواريخ.');
      }
      throw error;
    }

    // Auto-generate 12 monthly fiscal periods for this fiscal year (البند O6)
    await this.ensurePeriodsForFiscalYear(
      tenantId,
      inserted.id,
      startDate,
      endDate,
    );

    return {
      ...inserted,
      start_date: this.formatDate(inserted.start_date),
      end_date: this.formatDate(inserted.end_date),
    };
  }

  /**
   * Preview closing of fiscal year with pre-closing audit and simulated zeroing entries.
   *
   * Digits are the tenant's book digits, resolved on the caller's handle
   * with the P2 pattern (tenantBaseCurrency + currencyMoneyDigits) and
   * fail closed on a currency mismatch, exactly like the posting
   * boundary. The standalone preview and the execute path share one
   * computation (buildFiscalYearClosePreview); execute re-runs it
   * inside its transaction on the transaction handle and posts the
   * recomputed lines, so preview and post can never disagree.
   */
  async previewFiscalYearClose(auth: AuthContext, id: number): Promise<FiscalYearPreviewResult> {
    const tenantId = String(auth.tenantId || '');
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    return this.buildFiscalYearClosePreview(auth, id, this.db, digits);
  }

  private async buildFiscalYearClosePreview(
    auth: AuthContext,
    id: number,
    db: Kysely<Database>,
    digits: MoneyDigits,
  ): Promise<FiscalYearPreviewResult> {
    const tenantId = String(auth.tenantId || '');

    const fy = await db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    if (fy.status === 'closed') {
      throw new BadRequestException('هذه السنة المالية مقفلة بالفعل.');
    }

    const startDate = this.formatDate(fy.start_date);
    const endDate = this.formatDate(fy.end_date);

    // 1. Audit: Check unposted / draft journal entries in the period
    const unpostedResult = await db
      .selectFrom('journal_entries')
      .select(sql<number>`COUNT(*)`.as('count'))
      .where('tenant_id', '=', tenantId)
      .where('entry_date', '>=', startDate as any)
      .where('entry_date', '<', nextAccountingDay(endDate))
      .where('status', '=', 'draft')
      .executeTakeFirst();

    const unpostedCount = Number(unpostedResult?.count || 0);

    // 2. Fetch all accounts for tenant
    const accounts = await db
      .selectFrom('accounting_accounts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .orderBy('code', 'asc')
      .execute();

    // 3. Query debit and credit sums per account in this fiscal year period
    const balances = await (db as any)
      .selectFrom('journal_entry_lines as jel')
      .innerJoin('journal_entries as je', 'je.id', 'jel.journal_entry_id')
      .select([
        'jel.account_id',
        sql<number>`COALESCE(SUM(jel.debit), 0)`.as('total_debit'),
        sql<number>`COALESCE(SUM(jel.credit), 0)`.as('total_credit'),
      ])
      .where('je.tenant_id', '=', tenantId)
      .where('jel.tenant_id', '=', tenantId)
      .where('je.status', '=', 'posted')
      .where('je.source_type', 'not in', ['fiscal_year_closing', 'fiscal_year_reopen'])
      .where('je.entry_date', '>=', startDate as any)
      .where('je.entry_date', '<', nextAccountingDay(endDate))
      .groupBy('jel.account_id')
      .execute();

    const balanceMap = new Map<number, { debit: number; credit: number }>();
    for (const b of balances) {
      balanceMap.set(Number(b.account_id), {
        debit: this.toBookMoney(b.total_debit, digits),
        credit: this.toBookMoney(b.total_credit, digits),
      });
    }

    const revenueAccounts: FiscalYearAccountBalance[] = [];
    const expenseAccounts: FiscalYearAccountBalance[] = [];

    let totalRevenue = 0;
    let totalExpense = 0;

    for (const acc of accounts) {
      const category = fiscalProfitAndLossCategory(acc);
      const b = balanceMap.get(Number(acc.id)) || { debit: 0, credit: 0 };

      if (category === 'revenue') {
        // Normal balance for Revenue is Credit: net = credit - debit
        const net = this.toBookMoney(b.credit - b.debit, digits);
        if (net !== 0) {
          totalRevenue += net;
          revenueAccounts.push({
            id: Number(acc.id),
            code: acc.code,
            name_ar: acc.name_ar,
            name_en: acc.name_en,
            account_type: acc.account_type,
            balance: net,
            // To zero out: if net credit > 0, we debit it. If net debit (contra), we credit it.
            closingDebit: net > 0 ? net : 0,
            closingCredit: net < 0 ? Math.abs(net) : 0,
          });
        }
      } else if (category === 'expense') {
        // Normal balance for Expense is Debit: net = debit - credit
        const net = this.toBookMoney(b.debit - b.credit, digits);
        if (net !== 0) {
          totalExpense += net;
          expenseAccounts.push({
            id: Number(acc.id),
            code: acc.code,
            name_ar: acc.name_ar,
            name_en: acc.name_en,
            account_type: acc.account_type,
            balance: net,
            // To zero out: if net debit > 0, we credit it. If net credit, we debit it.
            closingDebit: net < 0 ? Math.abs(net) : 0,
            closingCredit: net > 0 ? net : 0,
          });
        }
      }
    }

    totalRevenue = this.toBookMoney(totalRevenue, digits);
    totalExpense = this.toBookMoney(totalExpense, digits);
    const netProfitLoss = this.toBookMoney(totalRevenue - totalExpense, digits);
    const isProfit = netProfitLoss >= 0;

    // 4. Default Retained Earnings Account (code 3200 or equity)
    let retainedAccount = accounts.find((a) => a.code === '3200');
    if (!retainedAccount) {
      retainedAccount = accounts.find(
        (a) => a.account_type === 'equity' && (a.name_ar.includes('محتجزة') || a.name_ar.includes('مبقاة')),
      );
    }
    if (!retainedAccount) {
      retainedAccount = accounts.find((a) => a.account_type === 'equity');
    }

    // 5. Generate proposed closing journal entry lines
    const proposedClosingLines: ProposedClosingLine[] = [];

    // Revenue lines
    for (const r of revenueAccounts) {
      proposedClosingLines.push({
        accountId: r.id,
        accountCode: r.code,
        accountName: r.name_ar,
        debit: r.closingDebit,
        credit: r.closingCredit,
        description: `إقفال حساب الإيراد [${r.code} - ${r.name_ar}] للسنة المالية ${fy.name}`,
      });
    }

    // Expense lines
    for (const e of expenseAccounts) {
      proposedClosingLines.push({
        accountId: e.id,
        accountCode: e.code,
        accountName: e.name_ar,
        debit: e.closingDebit,
        credit: e.closingCredit,
        description: `إقفال حساب المصروف [${e.code} - ${e.name_ar}] للسنة المالية ${fy.name}`,
      });
    }

    // Retained Earnings Line
    if (netProfitLoss !== 0 && retainedAccount) {
      if (isProfit) {
        // Net profit: Credit Retained Earnings
        proposedClosingLines.push({
          accountId: Number(retainedAccount.id),
          accountCode: retainedAccount.code,
          accountName: retainedAccount.name_ar,
          debit: 0,
          credit: netProfitLoss,
          description: `ترحيل صافي أرباح السنة المالية ${fy.name} إلى الأرباح المحتجزة`,
        });
      } else {
        // Net loss: Debit Retained Earnings
        proposedClosingLines.push({
          accountId: Number(retainedAccount.id),
          accountCode: retainedAccount.code,
          accountName: retainedAccount.name_ar,
          debit: Math.abs(netProfitLoss),
          credit: 0,
          description: `ترحيل صافي خسائر السنة المالية ${fy.name} إلى الأرباح المحتجزة`,
        });
      }
    }

    let blockReason: string | null = null;
    if (unpostedCount > 0) {
      blockReason = `يوجد ${unpostedCount} قيد محاسبي غير مرحل (مسودة) في هذه الفترة. يجب ترحيل جميع القيود أو حذفها قبل الإقفال.`;
    } else if (!retainedAccount) {
      blockReason = 'لم يتم العثور على حساب أرباح محتجزة (كود 3200) لترحيل الأرباح/الخسائر إليه.';
    }

    return {
      fiscalYear: {
        ...fy,
        start_date: startDate,
        end_date: endDate,
      },
      unpostedEntriesCount: unpostedCount,
      canClose: !blockReason,
      blockReason,
      totalRevenue,
      totalExpense,
      netProfitLoss,
      isProfit,
      retainedEarningsAccount: retainedAccount
        ? {
            id: Number(retainedAccount.id),
            code: retainedAccount.code,
            name_ar: retainedAccount.name_ar,
          }
        : null,
      revenueAccounts,
      expenseAccounts,
      proposedClosingLines,
    };
  }

  /**
   * Execute year-end closing: generates balancing closing journal entry,
   * sets status to closed, and locks accounting period up to end_date.
   */
  async executeFiscalYearClose(auth: AuthContext, id: number, dto: CloseFiscalYearDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');
    const userId = Number(auth.userId) || null;

    const year = await this.db.selectFrom('accounting_fiscal_years').select('end_date').where('tenant_id', '=', tenantId).where('id', '=', id).executeTakeFirstOrThrow();
    const recognitionEnd = this.formatDate(year.end_date);
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
    await this.accountingPosting.recognizeInstallmentInterest(this.db, tenantId, recognitionEnd < today ? recognitionEnd : today, userId);

    // 1. Get preview and validation
    const preview = await this.previewFiscalYearClose(auth, id);
    if (!preview.canClose) {
      throw new BadRequestException(preview.blockReason || 'لا يمكن إقفال السنة المالية.');
    }

    const fy = preview.fiscalYear;
    const endDate = this.formatDate(fy.end_date);

    // Retained Earnings Account
    let retainedEarningsAccountId = dto.retainedEarningsAccountId
      ? Number(dto.retainedEarningsAccountId)
      : preview.retainedEarningsAccount?.id;

    if (!retainedEarningsAccountId) {
      throw new BadRequestException('يجب تحديد حساب الأرباح المحتجزة للترحيل.');
    }

    const retainedAccount = await this.db
      .selectFrom('accounting_accounts')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', retainedEarningsAccountId)
      .executeTakeFirst();

    if (!retainedAccount || !retainedAccount.is_active || retainedAccount.account_type !== 'equity') {
      throw new BadRequestException('حساب الأرباح المحتجزة يجب أن يكون حساب حقوق ملكية نشطاً.');
    }

    // 2. Execute within transaction
    const closingEntryResult = await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      // The preview above (balances, proposed lines, canClose) was computed OUTSIDE this transaction.
      // Two things can have changed since: another admin may have closed the year, and new entries
      // may have been posted inside the period. The close is therefore recomputed below on this
      // transaction handle and compared exactly with the preview; stale lines are never posted.
      const lockedFy = await trx
        .selectFrom('accounting_fiscal_years')
        .select(['id', 'status'])
        .where('id', '=', fy.id)
        .where('tenant_id', '=', tenantId)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedFy) throw new NotFoundException('السنة المالية غير موجودة.');
      if (lockedFy.status === 'closed') throw new BadRequestException('هذه السنة المالية مقفلة بالفعل.');

      await assertAccountingCloseReady(trx, tenantId, this.formatDate(fy.start_date), endDate);
      const liveDrafts = await trx.selectFrom('journal_entries')
        .select(sql<number>`COUNT(*)`.as('count'))
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'draft')
        .where('entry_date', '>=', this.formatDate(fy.start_date) as any)
        .where('entry_date', '<', nextAccountingDay(endDate))
        .executeTakeFirst();
      if (Number(liveDrafts?.count || 0) > 0) {
        throw new BadRequestException('ظهرت مسودات قيود داخل السنة المالية؛ يرجى تسويتها قبل الإقفال.');
      }

      // Recompute the close on THIS transaction handle at the book
      // digits resolved on this handle. The preview above was computed
      // outside the transaction (different handle, possibly different
      // digits if settings changed); posting it verbatim would bake
      // in stale precision. The recomputation is the single source of
      // truth for the posted lines and the stored totals.
      const postDigits = currencyMoneyDigits(await tenantBaseCurrency(trx, tenantId));
      const recomputed = await this.buildFiscalYearClosePreview(auth, id, trx, postDigits);
      if (recomputed.blockReason) {
        throw new BadRequestException(recomputed.blockReason);
      }

      // Fail closed on ANY difference between the preview and the
      // live recomputation: exact equality at book digits, per
      // account and for the totals. A changed balance, a new P&L
      // account, or a digits change since the preview all fail here
      // instead of posting stale lines. (The old 0.009 band was
      // invisible to precision loss: a 0.005 drift passed silently.)
      const expectedBalances = new Map<number, number>();
      for (const account of preview.revenueAccounts) expectedBalances.set(account.id, account.balance);
      for (const account of preview.expenseAccounts) expectedBalances.set(account.id, account.balance);
      const actualBalances = new Map<number, number>();
      for (const account of recomputed.revenueAccounts) actualBalances.set(account.id, account.balance);
      for (const account of recomputed.expenseAccounts) actualBalances.set(account.id, account.balance);
      if (expectedBalances.size !== actualBalances.size ||
          [...expectedBalances].some(([accountId, balance]) =>
            !actualBalances.has(accountId) || actualBalances.get(accountId) !== balance) ||
          preview.totalRevenue !== recomputed.totalRevenue ||
          preview.totalExpense !== recomputed.totalExpense ||
          preview.netProfitLoss !== recomputed.netProfitLoss) {
        throw new BadRequestException(
          'تغير رصيد واحد أو أكثر من حسابات الأرباح والخسائر بعد المعاينة؛ يجب تحديث المعاينة قبل الإقفال.',
        );
      }

      let createdJournalEntryId: number | null = null;

      if (recomputed.proposedClosingLines.length > 0) {
        // Validate balance of the recomputed lines. The close is
        // balanced by construction, so equality at book digits is
        // exact: the old 0.05 band tolerated a real imbalance.
        let totalDebit = 0;
        let totalCredit = 0;
        for (const line of recomputed.proposedClosingLines) {
          totalDebit += line.debit;
          totalCredit += line.credit;
        }
        totalDebit = this.toBookMoney(totalDebit, postDigits);
        totalCredit = this.toBookMoney(totalCredit, postDigits);

        if (totalDebit !== totalCredit) {
          throw new BadRequestException(
            `قيد الإقفال غير متزن: إجمالي المدين (${totalDebit}) لا يساوي إجمالي الدائن (${totalCredit}). الفارق: ${Math.abs(totalDebit - totalCredit).toFixed(postDigits)}`,
          );
        }

        const description = `إقفال السنة المالية: ${fy.name} وترحيل صافي ${recomputed.isProfit ? 'الأرباح' : 'الخسائر'} (${Math.abs(recomputed.netProfitLoss).toFixed(postDigits)}) إلى حساب [${retainedAccount.code} - ${retainedAccount.name_ar}]`;
        const entryId = await this.accountingPosting.postDomainJournal(trx, {
          sourceType: 'fiscal_year_closing', sourceId: fy.id, tenantId,
          accountId: auth.accountId || tenantId, entryDate: new Date(endDate),
          description, createdBy: userId,
          lines: resolveClosingJournalAccounts(
            recomputed.proposedClosingLines, recomputed.retainedEarningsAccount?.id ?? null, retainedEarningsAccountId,
          ).map((line) => ({
            accountId: line.accountId, description: line.description,
            debit: line.debit, credit: line.credit,
            partnerType: 'none' as const, partnerId: null, branchId: null, locationId: null,
          })),
        });
        createdJournalEntryId = entryId;

        const officialEntryNo = `CLOSE-${fy.code || new Date(endDate).getFullYear()}-${String(entryId).padStart(6, '0')}`;

        await trx
          .updateTable('journal_entries')
          .set({
            entry_no: officialEntryNo,
            updated_at: sql`NOW()` as any,
          } as any)
          .where('id', '=', entryId)
          .where('tenant_id', '=', tenantId)
          .execute();

      }

      // Update fiscal year
      await trx
        .updateTable('accounting_fiscal_years')
        .set({
          status: 'closed',
          closing_entry_id: createdJournalEntryId,
          net_profit_loss: recomputed.netProfitLoss,
          total_revenue: recomputed.totalRevenue,
          total_expense: recomputed.totalExpense,
          retained_earnings_account_id: retainedEarningsAccountId,
          closed_at: sql`NOW()` as any,
          closed_by: userId,
          closing_notes: dto.notes ? String(dto.notes).trim() : null,
          updated_at: sql`NOW()` as any,
        })
        .where('id', '=', fy.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      // إقفال كافة الفترات الشهرية التابعة لهذه السنة المالية تلقائياً
      await trx
        .updateTable('accounting_fiscal_periods')
        .set({
          status: 'closed',
          closed_at: sql`NOW()`,
          closed_by: userId,
          closing_notes: 'تم الإقفال تلقائياً ضمن إقفال السنة المالية بالكامل',
          updated_at: sql`NOW()`,
        })
        .where('fiscal_year_id', '=', fy.id)
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'open')
        .execute();

      // Automatically update accounting period lock date (lock_date_all) in accounting_settings
      const currentSettings = await trx
        .selectFrom('accounting_settings')
        .select(['id', 'lock_date_all'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', 1)
        .executeTakeFirst();

      // Locking the period is not optional: a year closed but still writable is the whole failure
      // this step exists to prevent. If the tenant has no settings row yet, create it rather than
      // silently skipping the lock.
      if (currentSettings) {
        const curLock = currentSettings.lock_date_all
          ? this.formatDate(currentSettings.lock_date_all)
          : '';
        // If current lock is empty or earlier than this fiscal year end date, advance the lock date
        if (!curLock || curLock < endDate) {
          await trx
            .updateTable('accounting_settings')
            .set({
              lock_date_all: endDate as any,
              updated_at: sql`NOW()` as any,
            })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', 1)
            .execute();
        }
      } else {
        await trx
          .insertInto('accounting_settings')
          .values({
            id: 1,
            tenant_id: tenantId,
            lock_date_all: endDate as any,
            updated_at: sql`NOW()` as any,
          } as any)
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'id']).doUpdateSet({
              lock_date_all: endDate as any,
              updated_at: sql`NOW()` as any,
            } as any),
          )
          .execute();
      }

      return {
        closingEntryId: createdJournalEntryId,
      };
    });

    return {
      success: true,
      message: `تم إقفال السنة المالية [${fy.name}] بنجاح، وترحيل الأرباح وتأمين الفترة المحاسبية.`,
      closingEntryId: closingEntryResult.closingEntryId,
      netProfitLoss: preview.netProfitLoss,
      isProfit: preview.isProfit,
    };
  }

  /**
   * Reopen a closed fiscal year: reverses/removes closing entry and unlocks period
   */
  async reopenFiscalYear(auth: AuthContext, id: number, dto: ReopenFiscalYearDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');

    const reason = String(dto.reason || '').trim();
    if (!reason) {
      throw new BadRequestException('يجب ذكر سبب إعادة فتح السنة المالية للتوثيق والرقابة.');
    }

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    if (fy.status !== 'closed') {
      throw new BadRequestException('هذه السنة المالية مفتوحة بالفعل ولا تحتاج إلى إعادة فتح.');
    }

    // Check if there is any subsequent closed fiscal year (must reopen in reverse order)
    const subsequentClosed = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'name', 'start_date'])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'closed')
      .where('start_date', '>', fy.start_date)
      .executeTakeFirst();

    if (subsequentClosed) {
      throw new BadRequestException(
        `لا يمكن إعادة فتح السنة المالية [${fy.name}] لأن السنة المالية اللاحقة [${subsequentClosed.name}] مقفلة. يجب إعادة فتح السنوات بترتيب زمني عكسي.`,
      );
    }

    await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const lockedFy = await trx.selectFrom('accounting_fiscal_years')
        .select(['id', 'status', 'closing_entry_id', 'start_date'])
        .where('id', '=', id).where('tenant_id', '=', tenantId)
        .forUpdate().executeTakeFirst();
      if (!lockedFy || lockedFy.status !== 'closed') {
        throw new BadRequestException('السنة المالية تغيرت حالتها؛ يرجى إعادة التحميل.');
      }

      // 1. Post immutable reversal of closing journal entry if exists (ZS-042)
      if (lockedFy.closing_entry_id != null) {
        const closingEntry = await trx
          .selectFrom('journal_entries')
          .select(['id', 'entry_no', 'entry_date', 'description'])
          .where('id', '=', lockedFy.closing_entry_id)
          .where('tenant_id', '=', tenantId)
          .executeTakeFirst();

        if (closingEntry) {
          const originalLines = await trx
            .selectFrom('journal_entry_lines')
            .selectAll()
            .where('journal_entry_id', '=', closingEntry.id)
            .where('tenant_id', '=', tenantId)
            .execute();

          if (originalLines.length > 0) {
            const reversalLines = originalLines.map((l) => ({
              accountId: Number(l.account_id),
              description: `عكس قيد إقفال السنة المالية: ${fy.name} - [${l.description || ''}]`,
              debit: Number(l.credit) || 0,
              credit: Number(l.debit) || 0,
              partnerType: 'none' as const,
              partnerId: null,
              branchId: null,
              locationId: null,
            }));

            const reversalEntryId = await this.accountingPosting.postDomainJournal(trx, {
              sourceType: 'fiscal_year_reopen',
              sourceId: fy.id,
              tenantId,
              accountId: auth.accountId || tenantId,
              entryDate: new Date(closingEntry.entry_date),
              description: `عكس قيد إقفال السنة المالية [${fy.name}] بسبب إعادة الفتح: ${reason}`,
              createdBy: auth.userId,
              lines: reversalLines,
            });

            const reversalEntryNo = `REV-CLOSE-${fy.code || new Date().getFullYear()}-${String(reversalEntryId).padStart(6, '0')}`;
            await trx
              .updateTable('journal_entries')
              .set({
                entry_no: reversalEntryNo,
                updated_at: sql`NOW()` as any,
              } as any)
              .where('id', '=', reversalEntryId)
              .where('tenant_id', '=', tenantId)
              .execute();
            await trx.updateTable('journal_entries')
              .set({ reversed_by_entry_id: reversalEntryId, updated_at: sql`NOW()` } as any)
              .where('tenant_id', '=', tenantId).where('id', '=', closingEntry.id).execute();
            await trx.updateTable('journal_entries')
              .set({ reversal_of_entry_id: closingEntry.id, updated_at: sql`NOW()` } as any)
              .where('tenant_id', '=', tenantId).where('id', '=', reversalEntryId).execute();
          }

          // Both closing and reversing entries remain posted and cancel numerically.
        }
      }

      const later = await trx.selectFrom('accounting_fiscal_years')
        .select('id').where('tenant_id', '=', tenantId)
        .where('status', '=', 'closed')
        .where('start_date', '>', lockedFy.start_date)
        .executeTakeFirst();
      if (later) throw new BadRequestException('يجب إعادة فتح السنوات المالية بالترتيب الزمني العكسي.');

      const reopenDay = await resolveBusinessDateKey(trx, tenantId, new Date());
      const reopenLog = `\n[أعيد فتحها بتاريخ ${reopenDay} بواسطة مستخدم #${auth.userId} - السبب: ${reason}]`;
      await trx.updateTable('accounting_fiscal_years')
        .set({
          status: 'open', closing_entry_id: null, closed_at: null, closed_by: null,
          closing_notes: sql`CONCAT(COALESCE(closing_notes, ''), ${reopenLog}::text)` as any,
          updated_at: sql`NOW()` as any,
        })
        .where('id', '=', id).where('tenant_id', '=', tenantId).execute();
      // Do not alter accounting_settings.lock_date_all. It may contain a manual
      // administrative lock stricter than fiscal close; release requires a separate
      // explicit authorized workflow.
    });

    return {
      success: true,
      message: `تم إعادة فتح السنة المالية [${fy.name}] دون حذف قيود أو تغيير الأقفال الإدارية؛ يمكن تعديل القفل عبر الإعدادات المخولة.`,
    };
  }

  /**
   * Delete an open fiscal year period
   */
  async deleteFiscalYear(auth: AuthContext, id: number): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    if (fy.status === 'closed') {
      throw new BadRequestException('لا يمكن حذف سنة مالية مقفلة. يجب إعادة فتحها أولاً إذا كنت ترغب في حذفها.');
    }

    await this.db
      .deleteFrom('accounting_fiscal_years')
      .where('id', '=', id)
      .where('tenant_id', '=', tenantId)
      .execute();

    return {
      success: true,
      message: 'تم حذف السنة المالية بنجاح.',
    };
  }

  /**
   * توليد وتقسيم الفترات المحاسبية الشهرية تلقائياً للسنة المالية (البند O6).
   */
  async ensurePeriodsForFiscalYear(
    tenantId: string,
    fiscalYearId: number,
    startDateStr: string,
    endDateStr: string,
  ): Promise<void> {
    const existing = await this.db
      .selectFrom('accounting_fiscal_periods')
      .select(['id'])
      .where('tenant_id', '=', tenantId)
      .where('fiscal_year_id', '=', fiscalYearId)
      .executeTakeFirst();

    if (existing) return;

    const generated = buildMonthlyFiscalPeriods(startDateStr, endDateStr);

    const periodsToInsert = generated.map((period) => ({
      tenant_id: tenantId,
      fiscal_year_id: fiscalYearId,
      period_number: period.periodNumber,
      name: period.name,
      code: period.code,
      start_date: period.startDate as any,
      end_date: period.endDate as any,
      status: 'open' as const,
      created_at: sql`NOW()` as any,
      updated_at: sql`NOW()` as any,
    }));

    if (periodsToInsert.length > 0) {
      await this.db
        .insertInto('accounting_fiscal_periods')
        .values(periodsToInsert)
        .onConflict((oc) =>
          oc.columns(['tenant_id', 'fiscal_year_id', 'period_number']).doNothing(),
        )
        .execute();
    }
  }

  /**
   * عرض الفترات الشهرية لسنة مالية — **قراءة بحتة**.
   *
   * كانت هذه الدالة تولّد الفترات وتكتبها في القاعدة إن لم تجدها، أي أن نداء `GET` كان يكتب.
   * نفس نمط O33 (`GET subscription/me` كان يُنشئ صف اشتراك) الذي أُغلق قبل يوم واحد: مسار
   * القراءة لا يكتب، والتوليد له مسار `POST` صريح يملكه مدير النظام.
   */
  async listFiscalPeriods(auth: AuthContext, fiscalYearId: number): Promise<FiscalPeriodResponse[]> {
    const tenantId = String(auth.tenantId || '');

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'start_date', 'end_date', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fiscalYearId)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    const rows = await this.db
      .selectFrom('accounting_fiscal_periods')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('fiscal_year_id', '=', fiscalYearId)
      .orderBy('period_number', 'asc')
      .execute();

    return rows.map((p) => ({
      ...p,
      start_date: this.formatDate(p.start_date),
      end_date: this.formatDate(p.end_date),
      closed_at: p.closed_at ? new Date(p.closed_at as any).toISOString() : null,
      created_at: p.created_at ? new Date(p.created_at as any).toISOString() : '',
      updated_at: p.updated_at ? new Date(p.updated_at as any).toISOString() : '',
    })) as FiscalPeriodResponse[];
  }

  /**
   * توليد الفترات الشهرية لسنة مالية قائمة (للسنوات التي أُنشئت قبل وجود الفترات الشهرية).
   *
   * مسار كتابة صريح ومحصور بمدير النظام، ولا يفعل شيئاً إن كانت الفترات موجودة بالفعل
   * (`ensurePeriodsForFiscalYear` تفحص أولاً، والإدراج بـ`onConflict ... doNothing`).
   */
  async generateFiscalPeriods(auth: AuthContext, fiscalYearId: number): Promise<FiscalPeriodResponse[]> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'start_date', 'end_date'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', fiscalYearId)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية غير موجودة.');
    }

    await this.ensurePeriodsForFiscalYear(
      tenantId,
      fiscalYearId,
      this.formatDate(fy.start_date),
      this.formatDate(fy.end_date),
    );

    return this.listFiscalPeriods(auth, fiscalYearId);
  }

  /**
   * إقفال فترة محاسبية شهرية وتجميد قيودها (البند O6).
   */
  async closeFiscalPeriod(auth: AuthContext, periodId: number, dto: CloseFiscalPeriodDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');
    const userId = auth.userId ? Number(auth.userId) : null;

    const period = await this.db
      .selectFrom('accounting_fiscal_periods')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', periodId)
      .executeTakeFirst();

    if (!period) {
      throw new NotFoundException('الفترة المحاسبية غير موجودة.');
    }

    if (period.status === 'closed') {
      throw new BadRequestException('هذه الفترة المحاسبية مقفلة بالفعل.');
    }

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'name', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', period.fiscal_year_id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية التابعة لها الفترة غير موجودة.');
    }

    if (fy.status === 'closed') {
      throw new BadRequestException('السنة المالية التابعة لها هذه الفترة مقفلة بالكامل.');
    }

    const startDateStr = this.formatDate(period.start_date);
    const endDateStr = this.formatDate(period.end_date);

    /**
     * FP-7: FP-2 (الترتيب الزمني) و FP-3 (المسودات) يُفحصان **داخل** المعاملة وتحت قفل الصف، لا قبلها.
     *
     * كانا يُقرآن على `this.db` قبل فتح المعاملة، فبين الفحص والكتابة توجد نافذة: مسودة تُحفظ
     * في تلك اللحظة تقع داخل شهر يُقفل بعدها مباشرةً، فلا تصلح للترحيل أبداً (يمنعها FP-3)
     * ولا يظهر سببها؛ وإقفالان متزامنان لشهرين يمكن أن يتجاوزا الترتيب الزمني معاً.
     * نفس درس F6 وحجز الكوبون واستهلاك رمز الاستعادة: الفحص والكتابة في معاملة واحدة.
     */
    await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const locked = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['id', 'status', 'period_number'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', period.id)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) {
        throw new NotFoundException('الفترة المحاسبية غير موجودة.');
      }
      if (locked.status === 'closed') {
        throw new BadRequestException('هذه الفترة المحاسبية مقفلة بالفعل.');
      }

      // 1. الترتيب الزمني الصارم: لا يجوز إقفال شهر قبل إقفال الشهر السابق له
      const prevOpen = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['id', 'name', 'period_number'])
        .where('tenant_id', '=', tenantId)
        .where('fiscal_year_id', '=', period.fiscal_year_id)
        .where('period_number', '<', period.period_number)
        .where('status', '=', 'open')
        .orderBy('period_number', 'asc')
        .forUpdate()
        .executeTakeFirst();

      if (prevOpen) {
        throw new BadRequestException(
          `لا يمكن إقفال الفترة [${period.name}] قبل إقفال الفترة السابقة [${prevOpen.name}]. يجب إقفال الفترات المحاسبية بترتيب زمني متسلسل.`,
        );
      }

      const today = await resolveBusinessDateKey(trx, tenantId, new Date());
      await this.accountingPosting.recognizeInstallmentInterest(trx, tenantId, endDateStr < today ? endDateStr : today, auth.userId || null);
      await assertAccountingCloseReady(trx, tenantId, startDateStr, endDateStr);

      // 2. التحقق من القيود المعلقة (Draft entries)
      const draftEntries = await trx
        .selectFrom('journal_entries')
        .select(trx.fn.count('id').as('cnt'))
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'draft')
        .where('entry_date', '>=', startDateStr as any)
        .where('entry_date', '<', nextAccountingDay(endDateStr))
        .executeTakeFirst();

      const draftCount = Number(draftEntries?.cnt || 0);
      if (draftCount > 0) {
        throw new BadRequestException(
          `توجد ${draftCount} مسودات قيود محاسبية غير مرحّلة في هذه الفترة (${startDateStr} إلى ${endDateStr}). يجب ترحيلها أو حذفها قبل إقفال الفترة.`,
        );
      }

      // تحديث lock_date_all في accounting_settings
      const currentSettings = await trx
        .selectFrom('accounting_settings')
        .select(['id', 'lock_date_all'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', 1)
        .executeTakeFirst();

      const previousLock = currentSettings?.lock_date_all ? this.formatDate(currentSettings.lock_date_all) : null;

      await trx
        .updateTable('accounting_fiscal_periods')
        .set({
          status: 'closed',
          closed_at: sql`NOW()` as any,
          closed_by: userId,
          closing_notes: dto?.notes ? String(dto.notes).trim() : null,
          // FP-8: اللقطة تُلتقط هنا، قبل رفع القفل — وهي ما يُستعاد عند إعادة الفتح.
          previous_lock_date_all: previousLock as any,
          updated_at: sql`NOW()` as any,
        })
        .where('id', '=', period.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      if (currentSettings) {
        if (!previousLock || previousLock < endDateStr) {
          await trx
            .updateTable('accounting_settings')
            .set({ lock_date_all: endDateStr as any, updated_at: sql`NOW()` as any })
            .where('tenant_id', '=', tenantId)
            .where('id', '=', 1)
            .execute();
        }
      } else {
        await trx
          .insertInto('accounting_settings')
          .values({ id: 1, tenant_id: tenantId, lock_date_all: endDateStr as any, updated_at: sql`NOW()` as any } as any)
          .onConflict((oc) =>
            oc.columns(['tenant_id', 'id']).doUpdateSet({ lock_date_all: endDateStr as any, updated_at: sql`NOW()` as any } as any),
          )
          .execute();
      }
    });

    return {
      success: true,
      message: `تم إقفال الفترة المحاسبية [${period.name}] بنجاح وتأمين الحسابات حتى ${endDateStr}.`,
    };
  }

  /**
   * إعادة فتح فترة محاسبية شهرية بترتيب زمني عكسي صارم (البند O6).
   */
  async reopenFiscalPeriod(auth: AuthContext, periodId: number, dto: ReopenFiscalPeriodDto): Promise<any> {
    this.assertAdmin(auth);
    const tenantId = String(auth.tenantId || '');
    const reason = String(dto?.reason || '').trim();

    if (!reason) {
      throw new BadRequestException('يجب ذكر سبب إعادة فتح الفترة المحاسبية للرقابة والتدقيق.');
    }

    const period = await this.db
      .selectFrom('accounting_fiscal_periods')
      .selectAll()
      .where('tenant_id', '=', tenantId)
      .where('id', '=', periodId)
      .executeTakeFirst();

    if (!period) {
      throw new NotFoundException('الفترة المحاسبية غير موجودة.');
    }

    if (period.status !== 'closed') {
      throw new BadRequestException('هذه الفترة المحاسبية مفتوحة بالفعل.');
    }

    const fy = await this.db
      .selectFrom('accounting_fiscal_years')
      .select(['id', 'name', 'status'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', period.fiscal_year_id)
      .executeTakeFirst();

    if (!fy) {
      throw new NotFoundException('السنة المالية التابعة لها الفترة غير موجودة.');
    }

    if (fy.status === 'closed') {
      throw new BadRequestException(
        `لا يمكن إعادة فتح فترة في السنة المالية [${fy.name}] لأن السنة المالية نفسها مقفلة. يجب إعادة فتح السنة المالية أولاً.`,
      );
    }

    // FP-7: FP-4 يُفحص داخل المعاملة وتحت قفل الصف، لنفس سبب الإقفال.
    await this.db.transaction().execute(async (trx) => {
      await lockAccountingPeriod(trx, tenantId);
      const locked = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['id', 'status'])
        .where('tenant_id', '=', tenantId)
        .where('id', '=', period.id)
        .forUpdate()
        .executeTakeFirst();

      if (!locked) {
        throw new NotFoundException('الفترة المحاسبية غير موجودة.');
      }
      if (locked.status !== 'closed') {
        throw new BadRequestException('هذه الفترة المحاسبية مفتوحة بالفعل.');
      }

      // الترتيب العكسي: لا يمكن إعادة فتح شهر طالما هناك شهر بعده مقفل
      const nextClosed = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['id', 'name', 'period_number'])
        .where('tenant_id', '=', tenantId)
        .where('fiscal_year_id', '=', period.fiscal_year_id)
        .where('period_number', '>', period.period_number)
        .where('status', '=', 'closed')
        .orderBy('period_number', 'desc')
        .forUpdate()
        .executeTakeFirst();

      if (nextClosed) {
        throw new BadRequestException(
          `لا يمكن إعادة فتح الفترة [${period.name}] لأن الفترة اللاحقة [${nextClosed.name}] مقفلة. يجب إعادة فتح الفترات بترتيب زمني عكسي.`,
        );
      }

      const reopenDay = await resolveBusinessDateKey(trx, tenantId, new Date());
      const reopenNote = `\n[أعيد فتحها بتاريخ ${reopenDay} بواسطة مستخدم #${auth.userId} - السبب: ${reason}]`;
      await trx
        .updateTable('accounting_fiscal_periods')
        .set({
          status: 'open',
          closed_at: null,
          closed_by: null,
          closing_notes: sql`CONCAT(COALESCE(closing_notes, ''), ${reopenNote}::text)` as any,
          // اللقطة استُهلكت؛ إقفال لاحق يلتقط قيمة القفل السارية وقتها لا قيمة قديمة.
          previous_lock_date_all: null,
          updated_at: sql`NOW()` as any,
        })
        .where('id', '=', period.id)
        .where('tenant_id', '=', tenantId)
        .execute();

      /**
       * FP-8: إعادة الفتح **تستعيد** القفل ولا تعيد حسابه من الصفر.
       *
       * كان هذا السطر يكتب `lock_date_all` بتاريخ آخر فترة شهرية مقفلة، و`NULL` إن لم توجد —
       * فمنشأة قفلت دفاترها يدوياً حتى 2025-12-31 (الطريقة الوحيدة قبل الفترات الشهرية)، ثم
       * أقفلت شهراً وأعادت فتحه، كان قفلها اليدوي **يُمحى وتُفتح دفاتر سنوات سابقة** بلا أن
       * يطلب أحد ذلك. الآن: نأخذ **الأبعد** بين اللقطة المحفوظة وقت الإقفال وبين نهاية آخر
       * فترة لا تزال مقفلة. القفل لا يتراجع أبداً عن حدٍّ لم يضعه إقفال هذه الفترة.
       */
      const latestClosedPeriod = await trx
        .selectFrom('accounting_fiscal_periods')
        .select(['end_date'])
        .where('tenant_id', '=', tenantId)
        .where('status', '=', 'closed')
        .orderBy('end_date', 'desc')
        .executeTakeFirst();

      const fromClosedPeriods = latestClosedPeriod ? this.formatDate(latestClosedPeriod.end_date) : null;
      const snapshot = period.previous_lock_date_all ? this.formatDate(period.previous_lock_date_all) : null;
      const candidates = [fromClosedPeriods, snapshot].filter((value): value is string => Boolean(value));
      const newLock = candidates.length > 0 ? candidates.sort().at(-1)! : null;

      await trx
        .updateTable('accounting_settings')
        .set({ lock_date_all: newLock as any, updated_at: sql`NOW()` as any })
        .where('tenant_id', '=', tenantId)
        .where('id', '=', 1)
        .execute();
    });

    return {
      success: true,
      message: `تم إعادة فتح الفترة المحاسبية [${period.name}] بنجاح وتحديث تاريخ قفل الفترة.`,
    };
  }
}
