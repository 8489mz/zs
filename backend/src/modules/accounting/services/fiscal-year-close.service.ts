import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely, sql } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { type AccountingPostingService } from '../accounting-posting.service';
import { lockAccountingPeriod } from '../accounting-period-lock';
import { nextAccountingDay, resolveBusinessDateKey } from '../engines/accounting-date.engine';
import { assertAccountingCloseReady } from '../accounting-close-readiness';
import { tenantBaseCurrency } from '../accounting-currency';
import { currencyMoneyDigits, type MoneyDigits } from '../engines/money-minor-units.engine';
import {
  type CloseFiscalYearDto,
  type FiscalYearAccountBalance,
  type ProposedClosingLine,
  fiscalProfitAndLossCategory,
  resolveClosingJournalAccounts,
  type FiscalYearPreviewResult,
} from './fiscal-year.types';

/**
 * FiscalYearCloseService — slice S2 of the fiscal-year split.
 * Pure move of the year-end close preview and execution from the
 * fiscal-year service. No behavior change: the bodies are
 * byte-identical; the facade keeps thin public delegates with the
 * same names and signatures. This slice reaches the kernel helpers
 * only through bound deps — it never imports another slice service.
 * The preview helper stays private here: it is called only from
 * inside this slice, so it needs no delegate.
 */

export interface FiscalYearCloseDeps {
  db: Kysely<Database>;
  accountingPosting: AccountingPostingService;
  // Bound kernel helpers (stay in the facade; passed bound so the moved
  // bodies stay byte-identical).
  formatDate: (date: any) => string;
  toBookMoney: (value: unknown, digits: MoneyDigits) => number;
  assertAdmin: (auth: AuthContext) => void;
}

@Injectable()
export class FiscalYearCloseService {
  private readonly db: Kysely<Database>;
  private readonly accountingPosting: AccountingPostingService;
  private readonly formatDate: (date: any) => string;
  private readonly toBookMoney: (value: unknown, digits: MoneyDigits) => number;
  private readonly assertAdmin: (auth: AuthContext) => void;

  constructor(deps: FiscalYearCloseDeps) {
    this.db = deps.db;
    this.accountingPosting = deps.accountingPosting;
    this.formatDate = deps.formatDate;
    this.toBookMoney = deps.toBookMoney;
    this.assertAdmin = deps.assertAdmin;
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

    const year = await this.db
      .selectFrom('accounting_fiscal_years')
      .select('end_date')
      .where('tenant_id', '=', tenantId)
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    const recognitionEnd = this.formatDate(year.end_date);
    const today = await resolveBusinessDateKey(this.db, tenantId, new Date());
    await this.accountingPosting.recognizeInstallmentInterest(
      this.db,
      tenantId,
      recognitionEnd < today ? recognitionEnd : today,
      userId,
    );

    // 1. Get preview and validation
    const preview = await this.previewFiscalYearClose(auth, id);
    if (!preview.canClose) {
      throw new BadRequestException(preview.blockReason || 'لا يمكن إقفال السنة المالية.');
    }

    const fy = preview.fiscalYear;
    const endDate = this.formatDate(fy.end_date);

    // Retained Earnings Account
    const retainedEarningsAccountId = dto.retainedEarningsAccountId
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
      const liveDrafts = await trx
        .selectFrom('journal_entries')
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
      if (
        expectedBalances.size !== actualBalances.size ||
        [...expectedBalances].some(
          ([accountId, balance]) => !actualBalances.has(accountId) || actualBalances.get(accountId) !== balance,
        ) ||
        preview.totalRevenue !== recomputed.totalRevenue ||
        preview.totalExpense !== recomputed.totalExpense ||
        preview.netProfitLoss !== recomputed.netProfitLoss
      ) {
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
          sourceType: 'fiscal_year_closing',
          sourceId: fy.id,
          tenantId,
          accountId: auth.accountId || tenantId,
          entryDate: new Date(endDate),
          description,
          createdBy: userId,
          lines: resolveClosingJournalAccounts(
            recomputed.proposedClosingLines,
            recomputed.retainedEarningsAccount?.id ?? null,
            retainedEarningsAccountId,
          ).map((line) => ({
            accountId: line.accountId,
            description: line.description,
            debit: line.debit,
            credit: line.credit,
            partnerType: 'none' as const,
            partnerId: null,
            branchId: null,
            locationId: null,
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
        const curLock = currentSettings.lock_date_all ? this.formatDate(currentSettings.lock_date_all) : '';
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
}
