import { sql } from '../../../../database/kysely';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../accounting-currency';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { PurchasesAndTreasuryPostingDeps } from './purchases-treasury-posting-types';

export class PostExpenseReversalService {
  constructor(
    private readonly toMoney: PurchasesAndTreasuryPostingDeps['toMoney'],
    private readonly logger: PurchasesAndTreasuryPostingDeps['logger'],
    private readonly maxAllowedDifference: PurchasesAndTreasuryPostingDeps['maxAllowedDifference'],
    private readonly insertPostedJournal: PurchasesAndTreasuryPostingDeps['insertPostedJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  /**
   * INV-EXPENSE-CANCEL-REVERSAL: reverse a posted expense journal by
   * posting a NEW reversing journal, never by deleting or rewriting
   * the original. Mirrors reverseSaleJournalById: the original lines
   * are mirrored debit<->credit, so the reversal is exactly Dr cash /
   * Cr the expense account the original used, whatever account the
   * expense-category resolver picked. Returns { reversed: false,
   * journalEntryId } with the existing reversal id when the journal
   * was already reversed, and { reversed: false, journalEntryId: null }
   * when no posted expense journal exists at all. insertPostedJournal
   * is the concurrency backstop: it throws JOURNAL_REVERSAL_INVALID
   * if the original is already reversed by the time the insert runs.
   */
  async postExpenseReversal(
    queryable: DbOrTx,
    expenseId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // FOR UPDATE is essential, not optional: a concurrent cancel that
    // is already reversing this journal blocks here until it commits,
    // and this load then sees reversed_by_entry_id set and returns
    // already-reversed instead of attempting a second reversal.
    const sourceJournal = await queryable
      .selectFrom('journal_entries')
      .select([
        'id',
        'source_id',
        'source_type',
        'status',
        'reversed_by_entry_id',
        'branch_id',
        'location_id',
        'created_by',
      ])
      .where('source_type', 'in', ['expense', 'treasury_expense'])
      .where('source_id', '=', expenseId)
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'desc')
      .forUpdate()
      .executeTakeFirst();
    if (!sourceJournal) {
      const existingReversal = await this.getExistingExpenseReversalJournal(queryable, expenseId, scope.tenantId);
      if (existingReversal) {
        this.logger.warn(
          `Skipping duplicate expense reversal journal for expense ${expenseId}; existing entry ${existingReversal.id}`,
        );
        return { reversed: false, journalEntryId: Number(existingReversal.id) };
      }
      this.logger.warn(`No posted expense journal found for expense ${expenseId}; skipping accounting reversal`);
      return { reversed: false, journalEntryId: null };
    }
    if (Number(sourceJournal.source_id) !== expenseId) {
      throw new AppError('Reversal journal does not belong to the requested expense', 'JOURNAL_REVERSAL_INVALID', 409);
    }
    if (sourceJournal.reversed_by_entry_id) {
      const existingReversal = await this.getExistingExpenseReversalJournal(queryable, expenseId, scope.tenantId);
      return { reversed: false, journalEntryId: existingReversal ? Number(existingReversal.id) : null };
    }

    const expense = await queryable
      .selectFrom('expenses')
      .select(['title'])
      .where('id', '=', expenseId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const expenseLabel = String(expense?.title || '').trim() || `EXP-${expenseId}`;

    const sourceLines = await queryable
      .selectFrom('journal_entry_lines')
      .select([
        'account_id',
        'cost_center_id',
        'description',
        'debit',
        'credit',
        'partner_type',
        'partner_id',
        'branch_id',
        'location_id',
      ])
      .where('journal_entry_id', '=', Number(sourceJournal.id))
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    const reversalLines: JournalLineDraft[] = sourceLines
      .map((line) => ({
        accountId: Number(line.account_id),
        costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
        description: `عكس: ${line.description || 'قيد مصروف'}`,
        debit: toBookMoney(line.credit),
        credit: toBookMoney(line.debit),
        partnerType: (line.partner_type as 'none' | 'customer' | 'supplier') || 'none',
        partnerId: line.partner_id ? Number(line.partner_id) : null,
        branchId: line.branch_id ? Number(line.branch_id) : null,
        locationId: line.location_id ? Number(line.location_id) : null,
      }))
      .filter((line) => line.debit > 0 || line.credit > 0);

    const totalDebit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(
        `Unbalanced expense reversal journal for expense ${expenseId}: debit=${totalDebit} credit=${totalCredit}`,
      );
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'expense_reversal',
      sourceId: expenseId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء مصروف ${expenseLabel}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: Number(sourceJournal.id),
    });

    this.logger.warn(`Posted expense reversal journal for expense ${expenseId} as entry ${entryId}`);
    return { reversed: true, journalEntryId: entryId };
  }

  private async getExistingExpenseReversalJournal(queryable: DbOrTx, expenseId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'expense_reversal')
      .where('source_id', '=', expenseId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }
}
