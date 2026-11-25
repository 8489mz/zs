// Sale reversal journals (file #46 S4).
// Pure move from sales-returns-posting.service.ts: reverseSaleJournal,
// reverseSaleJournalById. Bound dep: ensureTenantFoundation (facade-kept
// private, passed bound). The in-slice this.* calls stay inside this class.

import { sql } from '../../../../database/kysely';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../../common/errors/app-error';
import { currencyMoneyDigits } from '../../engines/money-minor-units.engine';
import { tenantBaseCurrency } from '../../accounting-currency';
import type { DbOrTx, JournalLineDraft } from '../../accounting-posting.service';
import type { SalesAndReturnsPostingDeps } from './sales-returns-posting-types';

export class ReverseSaleJournalService {
  constructor(
    private readonly toMoney: SalesAndReturnsPostingDeps['toMoney'],
    private readonly getExistingSaleReversalJournal: SalesAndReturnsPostingDeps['getExistingSaleReversalJournal'],
    private readonly logger: SalesAndReturnsPostingDeps['logger'],
    private readonly resolveAccountWithFallback: SalesAndReturnsPostingDeps['resolveAccountWithFallback'],
    private readonly maxAllowedDifference: SalesAndReturnsPostingDeps['maxAllowedDifference'],
    private readonly insertPostedJournal: SalesAndReturnsPostingDeps['insertPostedJournal'],
    private readonly ensureTenantFoundation: (queryable: DbOrTx, auth: AuthContext) => Promise<void>,
  ) {}

  async reverseSaleJournal(
    queryable: DbOrTx,
    saleId: number,
    reason: string,
    auth: AuthContext,
    options?: { isPreparedWaste?: boolean; preparedWasteCogsExclusion?: number },
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // Historical reversals (before reversed_by_entry_id linking) are not linked to their source.
    // Count postings vs reversals so a retried cancel can never reverse an already-offset entry.
    const counts = await queryable
      .selectFrom('journal_entries')
      .select([
        sql<number>`COUNT(*) FILTER (WHERE source_type IN ('sale', 'sale_edit'))`.as('postings'),
        sql<number>`COUNT(*) FILTER (WHERE source_type = 'sale_reversal')`.as('reversals'),
      ])
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    const activePostings = Number(counts?.postings || 0) - Number(counts?.reversals || 0);

    const sourceJournal =
      activePostings > 0
        ? await queryable
            .selectFrom('journal_entries')
            .select(['id', 'branch_id', 'location_id', 'created_by'])
            .where('source_type', 'in', ['sale', 'sale_edit'])
            .where('source_id', '=', saleId)
            .where('status', '=', 'posted')
            .where('reversed_by_entry_id', 'is', null)
            .where('tenant_id', '=', scope.tenantId)
            .orderBy('id', 'desc')
            .executeTakeFirst()
        : undefined;
    if (!sourceJournal) {
      const existingReversal = await this.getExistingSaleReversalJournal(queryable, saleId, scope.tenantId);
      if (existingReversal) {
        this.logger.warn(
          `Skipping duplicate sale reversal journal for sale ${saleId}; existing entry ${existingReversal.id}`,
        );
        return { reversed: false, journalEntryId: Number(existingReversal.id) };
      }
      this.logger.warn(`No posted sale journal found for sale ${saleId}; skipping accounting reversal`);
      return { reversed: false, journalEntryId: null };
    }

    const sale = await queryable
      .selectFrom('sales')
      .select(['doc_no'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const docNo = sale?.doc_no || `Z-${saleId}`;

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

    let linesToReverse = sourceLines;
    if (options?.isPreparedWaste) {
      const invAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1140');
      const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '5100');
      const excludedIds = new Set<number>();
      if (invAccountId > 0) excludedIds.add(invAccountId);
      if (cogsAccountId > 0) excludedIds.add(cogsAccountId);
      linesToReverse = sourceLines.filter((line) => !excludedIds.has(Number(line.account_id)));
    }

    const reversalLines: JournalLineDraft[] = linesToReverse
      .map((line) => ({
        accountId: Number(line.account_id),
        costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
        description: `عكس: ${line.description || 'قيد بيع'}`,
        debit: toBookMoney(line.credit),
        credit: toBookMoney(line.debit),
        partnerType: (line.partner_type as 'none' | 'customer' | 'supplier') || 'none',
        partnerId: line.partner_id ? Number(line.partner_id) : null,
        branchId: line.branch_id ? Number(line.branch_id) : null,
        locationId: line.location_id ? Number(line.location_id) : null,
      }))
      .filter((line) => line.debit > 0 || line.credit > 0);

    // INV-SALE-EDIT-PREPARED-WASTE: a partial exclusion reduces only
    // the COGS/inventory reversal lines, by the residual value of the
    // consumed portion, so the waste cost stays posted. The inventory
    // (debit) side and the COGS (credit) side are reduced by the same
    // amount, so the reversal stays balanced; an exclusion larger than
    // either side fails closed instead of posting a lopsided reversal.
    if (options?.preparedWasteCogsExclusion && options.preparedWasteCogsExclusion > 0) {
      const exclusion = toBookMoney(options.preparedWasteCogsExclusion);
      const invAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '1140');
      const cogsAccountId = await this.resolveAccountWithFallback(queryable, scope.tenantId, null, '5100');
      const totals = new Map<number, number>();
      for (const line of reversalLines) {
        totals.set(
          line.accountId,
          toBookMoney(Number(totals.get(line.accountId) || 0) + Number(line.debit || 0) + Number(line.credit || 0)),
        );
      }
      if (
        exclusion > Number(totals.get(invAccountId) || 0) + 0.0001 ||
        exclusion > Number(totals.get(cogsAccountId) || 0) + 0.0001
      ) {
        throw new Error(
          `Prepared-waste COGS exclusion ${exclusion} exceeds the reversal COGS/inventory totals for sale ${saleId}`,
        );
      }
      let remainingInventoryExclusion = exclusion;
      for (const line of reversalLines) {
        if (remainingInventoryExclusion <= 0) break;
        if (line.accountId !== invAccountId) continue;
        const reducible = Math.min(Number(line.debit || 0), remainingInventoryExclusion);
        line.debit = toBookMoney(Number(line.debit || 0) - reducible);
        remainingInventoryExclusion = Number((remainingInventoryExclusion - reducible).toFixed(3));
      }
      if (remainingInventoryExclusion > 0.001) {
        throw new Error(
          `Prepared-waste COGS exclusion ${exclusion} could not be applied to the inventory reversal lines for sale ${saleId}`,
        );
      }
      let remainingCogsExclusion = exclusion;
      for (const line of reversalLines) {
        if (remainingCogsExclusion <= 0) break;
        if (line.accountId !== cogsAccountId) continue;
        const reducible = Math.min(Number(line.credit || 0), remainingCogsExclusion);
        line.credit = toBookMoney(Number(line.credit || 0) - reducible);
        remainingCogsExclusion = Number((remainingCogsExclusion - reducible).toFixed(3));
      }
      if (remainingCogsExclusion > 0.001) {
        throw new Error(
          `Prepared-waste COGS exclusion ${exclusion} could not be applied to the COGS reversal lines for sale ${saleId}`,
        );
      }
      for (let i = reversalLines.length - 1; i >= 0; i--) {
        if (!(Number(reversalLines[i].debit) > 0 || Number(reversalLines[i].credit) > 0)) reversalLines.splice(i, 1);
      }
    }

    // D-SF-02 (INV-SF-COD-CUSTODY-GL): a dispatched COD sale carries
    // a custody-reclassification journal (Dr 1130 custody / Cr 1130
    // customer). Reversing only the sale journal would strand the
    // custody debit and drive the customer leg negative, so the
    // reversal also negates the reclassification journal's lines.
    // The pair is balanced, so the balance check below still holds.
    let reclassEntryId: number | null = null;
    const reclassEntry = await queryable
      .selectFrom('journal_entries')
      .select(['id'])
      .where('source_type', '=', 'delivery_custody_reclassification')
      .where('source_id', '=', saleId)
      .where('status', '=', 'posted')
      .where('reversed_by_entry_id', 'is', null)
      .where('tenant_id', '=', scope.tenantId)
      .executeTakeFirst();
    if (reclassEntry) {
      reclassEntryId = Number(reclassEntry.id);
      const reclassLines = await queryable
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
        .where('journal_entry_id', '=', reclassEntryId)
        .where('tenant_id', '=', scope.tenantId)
        .orderBy('id', 'asc')
        .execute();
      for (const line of reclassLines) {
        reversalLines.push({
          accountId: Number(line.account_id),
          costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
          description: `عكس: ${line.description || 'قيد عهدة مندوب'}`,
          debit: toBookMoney(line.credit),
          credit: toBookMoney(line.debit),
          partnerType: (line.partner_type as 'none' | 'customer' | 'supplier') || 'none',
          partnerId: line.partner_id ? Number(line.partner_id) : null,
          branchId: line.branch_id ? Number(line.branch_id) : null,
          locationId: line.location_id ? Number(line.location_id) : null,
        });
      }
    }

    const totalDebit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(reversalLines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(totalDebit - totalCredit) > this.maxAllowedDifference(bookDigits)) {
      throw new Error(`Unbalanced sale reversal journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale_reversal',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء فاتورة بيع رقم ${docNo}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: Number(sourceJournal.id),
    });

    if (reclassEntryId) {
      await queryable
        .updateTable('journal_entries')
        .set({ reversed_by_entry_id: entryId, updated_at: sql`NOW()` })
        .where('id', '=', reclassEntryId)
        .where('tenant_id', '=', scope.tenantId)
        .execute();
    }

    this.logger.warn(`Posted sale reversal journal for sale ${saleId} as entry ${entryId}`);
    return { reversed: true, journalEntryId: entryId };
  }

  /**
   * Targeted sale reversal for P2 remediation.
   * Unlike reverseSaleJournal(), which reverses the *latest* unreversed
   * journal for a sale, this reverses the journal identified by
   * journalId, even when it is not the latest. It reverses the full
   * journal, including COGS / inventory, and returns
   * { reversed: false, journalEntryId: <existing reversal id> } when
   * the journal was already reversed, so the repair engine can record
   * the sale as already_repaired instead of failing it.
   */
  async reverseSaleJournalById(
    queryable: DbOrTx,
    saleId: number,
    journalId: number,
    reason: string,
    auth: AuthContext,
  ): Promise<{ reversed: boolean; journalEntryId: number | null }> {
    const scope = requireTenantScope(auth);
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, scope.tenantId));
    const toBookMoney = (value: unknown) => this.toMoney(value, bookDigits);
    await this.ensureTenantFoundation(queryable, auth);

    // FOR UPDATE is essential, not optional: a concurrent repair that
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
      .where('id', '=', journalId)
      .where('tenant_id', '=', scope.tenantId)
      .forUpdate()
      .executeTakeFirst();
    if (!sourceJournal) {
      return { reversed: false, journalEntryId: null };
    }
    if (
      Number(sourceJournal.source_id) !== saleId ||
      !['sale', 'sale_edit'].includes(String(sourceJournal.source_type))
    ) {
      throw new AppError('Reversal journal does not belong to the requested sale', 'JOURNAL_REVERSAL_INVALID', 409);
    }
    if (sourceJournal.status !== 'posted') {
      throw new AppError('Original journal is not posted', 'JOURNAL_REVERSAL_INVALID', 409);
    }
    if (sourceJournal.reversed_by_entry_id) {
      const existingReversal = await queryable
        .selectFrom('journal_entries')
        .select(['id'])
        .where('tenant_id', '=', scope.tenantId)
        .where('reversal_of_entry_id', '=', journalId)
        .where('source_type', '=', 'sale_reversal')
        .where('status', '=', 'posted')
        .executeTakeFirst();
      return { reversed: false, journalEntryId: existingReversal ? Number(existingReversal.id) : null };
    }

    const sale = await queryable
      .selectFrom('sales')
      .select(['doc_no'])
      .where('id', '=', saleId)
      .where(sql<boolean>`tenant_id = ${scope.tenantId}`)
      .executeTakeFirst();
    const docNo = sale?.doc_no || `Z-${saleId}`;

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
      .where('journal_entry_id', '=', journalId)
      .where('tenant_id', '=', scope.tenantId)
      .orderBy('id', 'asc')
      .execute();

    // Full mirror, exactly as reverseSaleJournal(): no isPreparedWaste
    // exclusion here. A remediation reversal must reverse COGS and
    // inventory as well, otherwise those accounts stay double-counted.
    const reversalLines: JournalLineDraft[] = sourceLines
      .map((line) => ({
        accountId: Number(line.account_id),
        costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
        description: `عكس: ${line.description || 'قيد بيع'}`,
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
      throw new Error(`Unbalanced sale reversal journal for sale ${saleId}: debit=${totalDebit} credit=${totalCredit}`);
    }

    const entryId = await this.insertPostedJournal(queryable, {
      sourceType: 'sale_reversal',
      sourceId: saleId,
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      entryDate: new Date(),
      description: `قيد عكسي لإلغاء فاتورة بيع رقم ${docNo}${reason ? ` - ${reason}` : ''}`,
      branchId: sourceJournal.branch_id ? Number(sourceJournal.branch_id) : null,
      locationId: sourceJournal.location_id ? Number(sourceJournal.location_id) : null,
      createdBy: sourceJournal.created_by ? Number(sourceJournal.created_by) : auth.userId,
      postedBy: auth.userId,
      lines: reversalLines,
      reversalOfEntryId: journalId,
    });

    this.logger.warn(
      `Posted targeted sale reversal journal for sale ${saleId} (stale journal ${journalId}) as entry ${entryId}`,
    );
    return { reversed: true, journalEntryId: entryId };
  }
}
