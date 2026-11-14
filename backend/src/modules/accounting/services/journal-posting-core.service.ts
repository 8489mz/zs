/*
 * Journal posting core (split-2 out of AccountingPostingService).
 * Pure move: the core journal writer + account-resolution + posting-failure
 * helpers, unchanged, behind the AccountingPostingService delegating facade.
 * The facade owns the domain posting methods; this service receives the few
 * shared helpers it needs bound via JournalPostingCoreDeps, so the moved
 * bodies are byte-identical to the originals.
 */
import { Logger } from '@nestjs/common';
import { sql } from '../../../database/kysely';
import { Transaction } from 'kysely';
import { Database } from '../../../database/database.types';
import { AppError } from '../../../common/errors/app-error';
import { AccountingTenantFoundationService } from '../accounting-tenant-foundation.service';
import { allocateJournalNumber, formatJournalEntryNo } from '../engines/journal-number.engine';
import { syncPostedPartnerLedger } from '../partner-subledger';
import { assertAutomatedJournalPeriodOpen, lockAccountingPeriod } from '../accounting-period-lock';
import { assertTaxPeriodOpen } from '../accounting-tax-lock';
import { randomUUID } from 'node:crypto';
import { tenantBaseCurrency } from '../accounting-currency';
import { resolveBusinessDateKey } from '../engines/accounting-date.engine';
import { currencyMoneyDigits, roundMoney, MoneyDigits } from '../engines/money-minor-units.engine';
import type { DbOrTx, JournalLineDraft, DomainJournalLineDraft } from '../accounting-posting.service';

export type JournalPostingCoreDeps = {
  accountingTenantFoundation: AccountingTenantFoundationService;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
  maxAllowedDifference: (bookDigits: MoneyDigits) => number;
  logger: Logger;
};

export class JournalPostingCoreService {
  private readonly accountingTenantFoundation: AccountingTenantFoundationService;
  private readonly toMoney: JournalPostingCoreDeps['toMoney'];
  private readonly maxAllowedDifference: JournalPostingCoreDeps['maxAllowedDifference'];
  private readonly logger: Logger;

  constructor(deps: JournalPostingCoreDeps) {
    this.accountingTenantFoundation = deps.accountingTenantFoundation;
    this.toMoney = deps.toMoney;
    this.maxAllowedDifference = deps.maxAllowedDifference;
    this.logger = deps.logger;
  }

  async resolveAccountWithFallback(
    queryable: DbOrTx,
    tenantId: string,
    configuredId: number | null | undefined,
    fallbackCode: string,
  ): Promise<number> {
    if (configuredId && Number(configuredId) > 0) {
      const exists = await queryable
        .selectFrom('accounting_accounts')
        .select(['id', 'is_active'])
        .where('id', '=', Number(configuredId))
        .where(sql<boolean>`tenant_id = ${tenantId}`)
        .executeTakeFirst();
      if (exists && exists.is_active) return Number(exists.id);
    }

    const fallback = await queryable
      .selectFrom('accounting_accounts')
      .select(['id'])
      .where('code', '=', fallbackCode)
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (fallback?.id) return Number(fallback.id);
    return Number(configuredId || 0);
  }

  async getExistingSaleJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'sale')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingSaleEditJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'sale_edit')
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .where('reversed_by_entry_id', 'is', null)
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingPurchaseJournal(queryable: DbOrTx, purchaseId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'purchase')
      .where('source_id', '=', purchaseId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingSupplierPaymentJournal(queryable: DbOrTx, paymentId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'supplier_payment')
      .where('source_id', '=', paymentId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingSupplierPaymentScheduleSettlementJournal(queryable: DbOrTx, settlementId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'supplier_payment_schedule_settlement')
      .where('source_id', '=', settlementId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingCustomerPaymentJournal(queryable: DbOrTx, paymentId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', '=', 'customer_payment')
      .where('source_id', '=', paymentId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingExpenseJournal(queryable: DbOrTx, expenseId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', 'in', ['expense', 'treasury_expense'])
      .where('source_id', '=', expenseId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingSaleReversalJournal(queryable: DbOrTx, saleId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', 'in', ['sale_reversal', 'sale_cancel'])
      .where('source_id', '=', saleId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingPurchaseReversalJournal(queryable: DbOrTx, purchaseId: number, tenantId: string) {
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', 'in', ['purchase_reversal', 'purchase_cancel'])
      .where('source_id', '=', purchaseId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getExistingSalesReturnJournal(queryable: DbOrTx, returnId: number, tenantId: string) {
    const linkedSale = await queryable.selectFrom('sales').select('id')
      .where('tenant_id', '=', tenantId).where('exchange_return_id', '=', returnId)
      .executeTakeFirst();
    if (linkedSale) {
      const exchangeJournal = await this.getExistingSaleJournal(queryable, Number(linkedSale.id), tenantId);
      if (exchangeJournal) return exchangeJournal;
    }
    return queryable
      .selectFrom('journal_entries')
      .select(['id', 'status'])
      .where('source_type', 'in', ['sales_return', 'return'])
      .where('source_id', '=', returnId)
      .where('tenant_id', '=', tenantId)
      .where('status', 'in', ['draft', 'posted'])
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async getActiveAccountMap(queryable: DbOrTx, tenantId: string, accountIds: number[]): Promise<Map<number, boolean>> {
    const uniqueIds = Array.from(new Set(accountIds.filter((id) => id > 0)));
    if (!uniqueIds.length) return new Map();
    const rows = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active'])
      .where('tenant_id', '=', tenantId)
      .where('id', 'in', uniqueIds)
      .execute();
    return new Map(rows.map((row) => [Number(row.id), Boolean(row.is_active)]));
  }

  addLine(lines: JournalLineDraft[], next: JournalLineDraft, digits: 2 | 3): void {
    const debit = this.toMoney(next.debit, digits);
    const credit = this.toMoney(next.credit, digits);
    if (Number(next.debit) < 0 || Number(next.credit) < 0) throw new AppError('Journal amounts cannot be negative', 'INVALID_JOURNAL_LINE', 400);
    if (debit <= 0 && credit <= 0) return;
    if (debit > 0 && credit > 0) throw new AppError('Journal line cannot be both debit and credit', 'INVALID_JOURNAL_LINE', 400);

    const existing = lines.find(
      (line) => line.accountId === next.accountId
        && line.partnerType === next.partnerType
        && line.partnerId === next.partnerId
        && line.branchId === next.branchId
        && line.locationId === next.locationId
        && (line.costCenterId ?? null) === (next.costCenterId ?? null)
        && (line.debit > 0) === (debit > 0)
        && line.description === next.description,
    );
    if (existing) {
      existing.debit = this.toMoney(existing.debit + debit, digits);
      existing.credit = this.toMoney(existing.credit + credit, digits);
      return;
    }

    lines.push({ ...next, debit, credit });
  }

  /**
   * Posting entry point for modules whose journal lines are domain-specific enough to be
   * built where that domain lives, but which must still go through this engine.
   *
   * It exists so "my lines are special" is never a reason to hand-roll an insert into
   * `journal_entries` — that is what section 2.2 forbids, and what it costs is concrete:
   * the central balance guard, the three-layer period-lock check, and collision-free
   * numbering. Contracting's IPC posting had all three missing.
   *
   * Callers still own WHICH accounts and amounts make up the entry. They do not own
   * whether it balances, whether the period accepts it, or what it is numbered.
   */
  async postDomainJournal(
    queryable: DbOrTx,
    params: {
      sourceType: string;
      sourceId: number;
      tenantId: string;
      accountId: string | null;
      entryDate: Date;
      description: string;
      branchId?: number | null;
      locationId?: number | null;
      createdBy: number | null;
      postedBy?: number | null;
      cashFlowCategory?: 'operating' | 'investing' | 'financing' | null;
      /** Links the new entry as the reversal of a posted original; insertPostedJournal validates and stamps the original. */
      reversalOfEntryId?: number | null;
      lines: DomainJournalLineDraft[];
    },
  ): Promise<number> {
    return this.insertPostedJournal(queryable, {
      ...params,
      branchId: params.branchId ?? null,
      locationId: params.locationId ?? null,
      postedBy: params.postedBy ?? params.createdBy,
      cashFlowCategory: params.cashFlowCategory ?? null,
      reversalOfEntryId: params.reversalOfEntryId ?? null,
      lines: params.lines.map(line => ({
        ...line,
        branchId: line.branchId === undefined ? params.branchId ?? null : line.branchId,
        locationId: line.locationId === undefined ? params.locationId ?? null : line.locationId,
      })),
    });
  }

  async insertPostedJournal(
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
    if (queryable && !queryable.isTransaction && typeof queryable.transaction === 'function') {
      return queryable.transaction().execute((trx: any) => this.insertPostedJournal(trx, params));
    }
    await lockAccountingPeriod(queryable, params.tenantId);
    // Book journal lines in the tenant's base-currency precision. The DB migration widens
    // journal_entry_lines so KWD/OMR fils survive both posting and reporting.
    const bookDigits = currencyMoneyDigits(await tenantBaseCurrency(queryable, params.tenantId));
    const toBookMoney = (value: unknown) => roundMoney(Number(value ?? 0), bookDigits);
    const unit = 10 ** -bookDigits;
    // The early source lookups can race when recovery workers use different
    // connections. Recheck under the same transaction lock as the insert.
    const oncePerSource = ['sale', 'purchase', 'sales_return', 'purchase_return', 'customer_payment', 'supplier_payment', 'supplier_payment_schedule_settlement', 'expense', 'trade_in', 'maintenance_advance', 'maintenance_advance_refund', 'maintenance_delivery', 'maintenance_part_issue', 'maintenance_part_return', 'pharmacy_clinical_service', 'pharmacy_prescription_cash'].includes(params.sourceType);
    const deduplicate = oncePerSource || ['contracting_ipc', 'contracting_subcontract_ipc', 'contracting_subcontractor_payment', 'marketplace_settlement', 'maritime_carrier_credit_note', 'customer_installment_interest', 'installment_interest_accrual'].includes(params.sourceType);
    let dedupKey = deduplicate ? `${params.sourceType}:${params.sourceId}` : null;
    if (params.sourceType.startsWith('pdc_cheque_')) {
      const cheque = await queryable.selectFrom('accounting_cheques').select('posting_sequence')
        .where('tenant_id', '=', params.tenantId).where('id', '=', params.sourceId).forUpdate().executeTakeFirstOrThrow();
      dedupKey = `${params.sourceType}:${params.sourceId}:${cheque.posting_sequence}`;
      const prior = await queryable.selectFrom('journal_entries').select('id')
        .where('tenant_id', '=', params.tenantId).where('dedup_key', '=', dedupKey).executeTakeFirst();
      if (prior) return Number(prior.id);
    }
    if (deduplicate) {
      let priorQuery = queryable.selectFrom('journal_entries').select('id')
        .where('tenant_id', '=', params.tenantId).where('source_type', '=', params.sourceType).where('source_id', '=', params.sourceId)
        .where('status', '=', 'posted');
      if (!oncePerSource) priorQuery = priorQuery.where('reversed_by_entry_id', 'is', null);
      const prior = await priorQuery.executeTakeFirst();
      if (prior) return Number(prior.id);
    }

    if (params.reversalOfEntryId) {
      const original = await queryable.selectFrom('journal_entries')
        .select(['id', 'status', 'reversed_by_entry_id'])
        .where('tenant_id', '=', params.tenantId).where('id', '=', params.reversalOfEntryId)
        .forUpdate().executeTakeFirst();
      if (!original || original.status !== 'posted' || original.reversed_by_entry_id) {
        throw new AppError('Original journal is missing, unposted or already reversed', 'JOURNAL_REVERSAL_INVALID', 409);
      }
    }
    if (!params.lines?.length) throw new AppError(`No journal lines for ${params.sourceType} #${params.sourceId}`, 'EMPTY_JOURNAL', 400);

    const lines = params.lines.map((line) => {
      if (Number(line.debit) < 0 || Number(line.credit) < 0) {
        throw new AppError('Journal amounts cannot be negative', 'INVALID_JOURNAL_LINE', 400);
      }
      return { ...line, debit: toBookMoney(line.debit), credit: toBookMoney(line.credit) };
    });
    for (const line of lines) {
      if (!(Number(line.accountId) > 0)) throw new AppError(`Missing account for ${params.sourceType} #${params.sourceId}`, 'ACCOUNT_NOT_FOUND', 400);
      if (line.debit < 0 || line.credit < 0 || (line.debit > 0 && line.credit > 0) || (line.debit === 0 && line.credit === 0)) {
        throw new AppError(`Invalid journal line for ${params.sourceType} #${params.sourceId}`, 'INVALID_JOURNAL_LINE', 400);
      }
    }
    const fiscalTransitionSource = ['fiscal_year_closing', 'fiscal_year_reopen'].includes(params.sourceType);
    const accounts = await this.getActiveAccountMap(queryable, params.tenantId, lines.map((line) => Number(line.accountId)));
    for (const line of lines) {
      if (!accounts.has(Number(line.accountId)) || (!fiscalTransitionSource && !accounts.get(Number(line.accountId)))) throw new AppError(`Account ${line.accountId} is missing or inactive for ${params.sourceType} #${params.sourceId}`, 'ACCOUNT_NOT_FOUND', 400);
    }
    const totalDebit = toBookMoney(lines.reduce((sum, line) => sum + line.debit, 0));
    const totalCredit = toBookMoney(lines.reduce((sum, line) => sum + line.credit, 0));
    const difference = toBookMoney(totalDebit - totalCredit);
    const maxTolerance = this.maxAllowedDifference(bookDigits);
    if (Math.abs(difference) >= unit / 2) {
      if (Math.abs(difference) > maxTolerance) {
        throw new AppError(`Unbalanced journal for ${params.sourceType} #${params.sourceId}: debit=${totalDebit.toFixed(bookDigits)} credit=${totalCredit.toFixed(bookDigits)}`, 'UNBALANCED_JOURNAL', 400);
      }
      if (!params.accountId) throw new AppError(`Tenant account scope is required to post ${params.sourceType} #${params.sourceId}`, 'TENANT_SCOPE_REQUIRED', 403);
      await this.accountingTenantFoundation.ensureForScope(queryable, { tenantId: params.tenantId, accountId: params.accountId });
      const roundingAccount = await queryable.selectFrom('accounting_accounts').select(['id', 'is_active'])
        .where('tenant_id', '=', params.tenantId).where('code', '=', '7290').executeTakeFirst();
      if (!roundingAccount?.is_active) throw new AppError(`Rounding difference account 7290 is missing for tenant ${params.tenantId}`, 'ROUNDING_ACCOUNT_NOT_FOUND', 400);
      this.logger.warn(`Journal rounding difference of ${difference.toFixed(bookDigits)} plugged into account 7290 for ${params.sourceType} #${params.sourceId} (tenant ${params.tenantId})`);
      lines.push({
        accountId: Number(roundingAccount.id), description: `Rounding difference: ${params.sourceType} #${params.sourceId}`,
        debit: difference < 0 ? Math.abs(difference) : 0,
        credit: difference > 0 ? difference : 0,
        partnerType: 'none', partnerId: null, branchId: params.branchId, locationId: params.locationId,
      });
    }
    const balancedDebit = toBookMoney(lines.reduce((sum, line) => sum + line.debit, 0));
    const balancedCredit = toBookMoney(lines.reduce((sum, line) => sum + line.credit, 0));
    if (Math.abs(balancedDebit - balancedCredit) >= unit / 2) throw new AppError(`Unbalanced journal for ${params.sourceType} #${params.sourceId}`, 'UNBALANCED_JOURNAL', 400);

    // Serialize all postings touching the same ledger accounts. Every caller uses
    // the same ascending order, so concurrent cash transfers cannot deadlock and
    // a balance read made by a transfer cannot race a journal insert.
    const accountIds = Array.from(new Set(lines.map((line) => Number(line.accountId)))).sort((a, b) => a - b);
    let lockedAccountQuery = queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_tax', 'account_group', 'code'])
      .where('tenant_id', '=', params.tenantId)
      .where('id', 'in', accountIds);
    if (!fiscalTransitionSource) lockedAccountQuery = lockedAccountQuery.where('is_active', '=', true);
    const lockedAccounts = await lockedAccountQuery.forUpdate().orderBy('id', 'asc').execute();
    if (lockedAccounts.length !== accountIds.length) {
      throw new AppError(`One or more accounts became inactive while posting ${params.sourceType} #${params.sourceId}`, 'ACCOUNT_NOT_FOUND', 400);
    }

    // Year-end entries are authorised fiscal transitions even when monthly books
    // have already been locked. Verify their year and exact year-end date first.
    let isFiscalTransition = false;
    if (params.sourceType === 'fiscal_year_closing' || params.sourceType === 'fiscal_year_reopen') {
      const fiscalYear = await queryable.selectFrom('accounting_fiscal_years')
        .select(['closing_entry_id', 'status', 'end_date'])
        .where('tenant_id', '=', params.tenantId)
        .where('id', '=', params.sourceId)
        .forUpdate()
        .executeTakeFirst();
      // The entry instant keys by the tenant-local business day, never the UTC
      // day: a 00:30 Cairo closing entry is the year-end day, not the previous UTC day.
      const postingDate = await resolveBusinessDateKey(queryable, params.tenantId, params.entryDate);
      const endDate = fiscalYear?.end_date instanceof Date
        ? fiscalYear.end_date.toISOString().slice(0, 10)
        : String(fiscalYear?.end_date || '').slice(0, 10);
      if (postingDate !== endDate || fiscalYear?.status !==
          (params.sourceType === 'fiscal_year_closing' ? 'open' : 'closed')) {
        throw new AppError('Fiscal transition requires the correct year-end date and year status', 'INVALID_FISCAL_TRANSITION', 422);
      }
      if (params.sourceType === 'fiscal_year_reopen') {
        const closingEntry = fiscalYear.closing_entry_id ? await queryable.selectFrom('journal_entries')
          .select(['status', 'reversed_by_entry_id'])
          .where('tenant_id', '=', params.tenantId)
          .where('id', '=', fiscalYear.closing_entry_id)
          .executeTakeFirst() : null;
        if (closingEntry?.status !== 'posted' || closingEntry.reversed_by_entry_id) {
          throw new AppError('Fiscal reopening requires a posted closing entry', 'INVALID_FISCAL_REOPEN', 422);
        }
      }
      isFiscalTransition = true;
    }

    if (isFiscalTransition) {
      await assertTaxPeriodOpen(queryable, params.tenantId, params.entryDate, lines.map((line) => line.accountId));
    } else {
      await assertAutomatedJournalPeriodOpen(queryable, params.tenantId, params.entryDate, lines.map((line) => line.accountId));
    }

    for (const [table, field, values] of [
      ['customers', 'partnerId', lines.filter(line => line.partnerType === 'customer')],
      ['suppliers', 'partnerId', lines.filter(line => line.partnerType === 'supplier')],
      // Cashier custody uses users.id; HR settlements use hr_employees.id.
      [params.sourceType === 'cashier_shift_variance' ? 'users' : 'hr_employees', 'partnerId', lines.filter(line => line.partnerType === 'employee')],
      // M12 (INV-REP-CUSTODY-LEDGER): a rep custody leg names a delivery_representatives.id.
      ['delivery_representatives', 'partnerId', lines.filter(line => line.partnerType === 'rep')],
      ['branches', 'branchId', lines], ['stock_locations', 'locationId', lines], ['cost_centers', 'costCenterId', lines],
    ] as const) {
      const ids = Array.from(new Set(values.map((line: any) => line[field]).filter((id: any) => id != null).map(Number)));
      if (ids.some(id => !Number.isSafeInteger(Number(id)) || Number(id) <= 0)) throw new AppError('Invalid journal reference', 'INVALID_JOURNAL_REFERENCE', 400);
      if (ids.length) {
        const owned = await queryable.selectFrom(table).select('id').where('tenant_id', '=', params.tenantId).where('id', 'in', ids).execute();
        if (owned.length !== ids.length) throw new AppError('Journal reference does not belong to this tenant', 'INVALID_JOURNAL_REFERENCE', 400);
      }
    }

    // Gapless numbering (INV-JE-NUMBERING-GAP): the visible number comes
    // from the highest visible number under the advisory lock, not the
    // identity column -- a failed insert or a rolled-back posting must
    // not burn a number. Allocation happens after every validation above
    // and BEFORE the insert, so a validation failure consumes nothing
    // and nothing is ever "used up": a duplicate-posting race that fails
    // on the unique index leaves no gap behind.
    const journalNo = await allocateJournalNumber(queryable);
    const tempEntryNo = `JE-TMP-${randomUUID()}`;
    const insertPayload: Record<string, any> = {
      entry_no: tempEntryNo,
      dedup_key: dedupKey,
      tenant_id: params.tenantId,
      account_id: params.accountId,
      entry_date: params.entryDate,
      description: params.description,
      source_type: params.sourceType,
      source_id: params.sourceId,
      status: 'posted',
      // Only callers that carry a cash-flow category (manual journals)
      // set the column; every other caller leaves it absent, exactly
      // as before this change.
      ...(params.cashFlowCategory ? { cash_flow_category: params.cashFlowCategory } : {}),
      branch_id: params.branchId,
      location_id: params.locationId,
      created_by: params.createdBy && Number(params.createdBy) > 0 ? Number(params.createdBy) : null,
      posted_by: params.postedBy && Number(params.postedBy) > 0 ? Number(params.postedBy) : null,
      posted_at: sql`NOW()`,
    };
    if (params.reversalOfEntryId && Number(params.reversalOfEntryId) > 0) {
      insertPayload.reversal_of_entry_id = Number(params.reversalOfEntryId);
    }
    const inserted = await queryable
      .insertInto('journal_entries')
      .values(insertPayload)
      .returning('id')
      .executeTakeFirstOrThrow();

    const entryId = Number(inserted.id);
    await queryable
      .updateTable('journal_entries')
      .set({ entry_no: formatJournalEntryNo(journalNo), updated_at: sql`NOW()` } as any)
      .where('id', '=', entryId)
      .where('tenant_id', '=', params.tenantId)
      .execute();

    if (params.reversalOfEntryId && Number(params.reversalOfEntryId) > 0) {
      await queryable
        .updateTable('journal_entries')
        .set({ reversed_by_entry_id: entryId, updated_at: sql`NOW()` } as any)
        .where('id', '=', Number(params.reversalOfEntryId))
        .where('tenant_id', '=', params.tenantId)
        .execute();
    }

    await queryable
        .insertInto('journal_entry_lines')
        .values(
          lines.map((line) => ({
            journal_entry_id: entryId,
            tenant_id: params.tenantId,
            account_id: line.accountId,
            cost_center_id: line.costCenterId ?? null,
            description: line.description,
            debit: toBookMoney(line.debit),
            credit: toBookMoney(line.credit),
            partner_type: line.partnerType,
            partner_id: line.partnerId,
            branch_id: line.branchId,
            location_id: line.locationId,
          } as any))
        )
        .execute();

    if (['purchase_landed_cost', 'import_inventory_receipt', 'import_inventory_receipt_reversal', 'import_late_expense', 'import_sourcing_trip_expense', 'contracting_ipc', 'contracting_subcontract_ipc', 'contracting_subcontractor_payment', 'maritime_job', 'maritime_job_expense', 'maritime_carrier_invoice', 'maritime_carrier_credit_note'].includes(params.sourceType)) {
      await syncPostedPartnerLedger(queryable, params.tenantId, entryId);
    }
    return entryId;
  }

  assertTransaction(queryable: unknown, method: string): asserts queryable is Transaction<Database> {
    if (!(queryable as any)?.isTransaction) {
      throw new AppError(
        `Document posting requires a transaction: call ${method} inside the document transaction so the document, stock and journal commit or roll back together`,
        'POSTING_REQUIRES_TRANSACTION',
        500,
      );
    }
  }

  async resolveSystemAccountByCode(queryable: DbOrTx, tenantId: string, code: string): Promise<number> {
    const account = await queryable
      .selectFrom('accounting_accounts')
      .select(['id', 'is_active', 'account_type'])
      .where('tenant_id', '=', tenantId)
      .where('code', '=', code)
      .executeTakeFirst();

    const dedicatedTypes: Record<string, string> = {
      '1165': 'asset', '1185': 'asset', '2160': 'liability', '2155': 'liability', '7170': 'revenue', '7270': 'expense',
      '5190': 'expense', '5300': 'expense', '6900': 'expense', '6950': 'expense', '3200': 'equity',
      '1150': 'asset', '2150': 'liability', '4300': 'contra_revenue', '4400': 'contra_revenue',
      '7110': 'revenue', '7210': 'expense', '7290': 'expense',
      // R4-A (INV-REST-SALE-MONEY-TRUTH): tips collected are a
      // liability and freelance-courier fees are a payable, never
      // revenue — so both codes are dedicated liabilities.
      '2147': 'liability', '2115': 'liability',
    };
    if (account && dedicatedTypes[code] && account.account_type !== dedicatedTypes[code]) throw new AppError('Dedicated system account has an incompatible type', 'SYSTEM_ACCOUNT_TYPE_MISMATCH', 409);
    if (!account) {
      const knownAccounts: Record<string, { name_ar: string; name_en: string; type: string; group: string; balance: string }> = {
        '1165': { name_ar: 'دفعات مقدمة لمقاولي الباطن', name_en: 'Subcontractor Advances', type: 'asset', group: 'current_assets', balance: 'debit' },
        /* INV-SUPPLIER-ADVANCE-ASSET-ACCOUNT: dedicated supplier-
         * advance asset (migration 0323). resolveSystemAccountByCode
         * auto-creates it on first advance post for any tenant the
         * migration missed; a tenant-created 1185 of another type
         * fails closed via dedicatedTypes above. */
        '1185': { name_ar: 'دفعات مقدمة للموردين', name_en: 'Supplier Advances', type: 'asset', group: 'current_assets', balance: 'debit' },
        '2160': { name_ar: 'تأمينات محتجزة لمقاولي الباطن', name_en: 'Subcontractor Retentions Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2155': { name_ar: 'فوائد تمويل غير مكتسبة', name_en: 'Unearned Financing Income', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '7170': { name_ar: 'أرباح فروق عملة محققة', name_en: 'Realized FX Gains', type: 'revenue', group: 'income', balance: 'credit' },
        '7270': { name_ar: 'خسائر فروق عملة محققة', name_en: 'Realized FX Losses', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '5400': { name_ar: 'مصاريف صناعية غير مباشرة محملة', name_en: 'Manufacturing Overhead', type: 'expense', group: 'expenses', balance: 'debit' },
        '1140': { name_ar: 'مخزون بضاعة ومواد خام', name_en: 'Inventory', type: 'asset', group: 'current_assets', balance: 'debit' },
        '1135': { name_ar: 'ذمم مدينة - أمناء الصناديق', name_en: 'Cashier Receivable', type: 'asset', group: 'current_assets', balance: 'debit' },
        '1122': { name_ar: 'أوراق قبض في الخزينة', name_en: 'Notes Receivable in Safe', type: 'asset', group: 'current_assets', balance: 'debit' },
        '1121': { name_ar: 'أوراق قبض برسم التحصيل', name_en: 'Notes Receivable Under Collection', type: 'asset', group: 'current_assets', balance: 'debit' },
        '2135': { name_ar: 'أوراق دفع', name_en: 'Notes Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2125': { name_ar: 'بضاعة مستلمة غير مفوترة (GRNI)', name_en: 'Goods Received Not Invoiced', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2126': { name_ar: 'أمانات ضريبة الخصم والإضافة', name_en: 'Withholding Tax Payable', type: 'liability', group: 'tax', balance: 'credit' },
        '1155': { name_ar: 'ضرائب مخصومة لدى الغير', name_en: 'Withholding Tax Receivable', type: 'asset', group: 'current_assets', balance: 'debit' },
        '6800': { name_ar: 'مصاريف بنكية', name_en: 'Bank Fees', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '1110': { name_ar: 'الخزينة', name_en: 'Cash', type: 'asset', group: 'cash_bank', balance: 'debit' },
        '1120': { name_ar: 'البنك', name_en: 'Bank', type: 'asset', group: 'cash_bank', balance: 'debit' },
        '1130': { name_ar: 'العملاء', name_en: 'Accounts Receivable', type: 'asset', group: 'receivable', balance: 'debit' },
        '2110': { name_ar: 'الموردون', name_en: 'Accounts Payable', type: 'liability', group: 'payable', balance: 'credit' },
        '2120': { name_ar: 'ضريبة مبيعات مستحقة', name_en: 'Sales VAT Payable', type: 'liability', group: 'tax', balance: 'credit' },
        '7100': { name_ar: 'إيرادات أخرى', name_en: 'Other Income', type: 'revenue', group: 'income', balance: 'credit' },
        '7200': { name_ar: 'خسائر أو فروق تسوية', name_en: 'Adjustment Losses', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '6200': { name_ar: 'الرواتب والأجور ومكافأة نهاية الخدمة', name_en: 'Salaries, Wages & EOS', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '6210': { name_ar: 'تأمينات اجتماعية - حصة صاحب العمل', name_en: 'Employer Social Insurance Expense', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '2140': { name_ar: 'رواتب ومستحقات مستحقة الدفع', name_en: 'Payroll & Settlements Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        // R4-A (INV-REST-SALE-MONEY-TRUTH): tips collected are held
        // for the staff (relieved by the tip-pool payout
        // Dr 2147 / Cr 1110/1120); freelance-courier fees are owed
        // to the courier (relieved by the delivery settlement
        // Dr 2115). Both auto-create on first post via this map —
        // no settings migration, no accounting_settings column.
        '2147': { name_ar: 'إكراميات مستحقة للموظفين', name_en: 'Tips Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2115': { name_ar: 'مستحقات مناديب توصيل', name_en: 'Courier Fees Payable', type: 'liability', group: 'payable', balance: 'credit' },
        '2145': { name_ar: 'تأمينات اجتماعية مستحقة السداد', name_en: 'Social Insurance Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '2146': { name_ar: 'ضريبة كسب عمل مستحقة', name_en: 'Income Tax Withholding Payable', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '1160': { name_ar: 'سلف وقروض العاملين', name_en: 'Employee Advances & Loans', type: 'asset', group: 'current_assets', balance: 'debit' },
        '6400': { name_ar: 'مصاريف نقل وشحن ووقود رحلات', name_en: 'Delivery, Fuel & Freight Expense', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '5190': { name_ar: 'فروق سعر الشراء والمرتجعات', name_en: 'Purchase Price Variance', type: 'expense', group: 'cogs', balance: 'debit' },
        '5200': { name_ar: 'فروق تكلفة المخزون', name_en: 'Inventory Cost Variance', type: 'expense', group: 'cogs', balance: 'debit' },
        '5300': { name_ar: 'هالك وفاقد بضاعة أثناء النقل', name_en: 'In-Transit Inventory Shrinkage', type: 'expense', group: 'cogs', balance: 'debit' },
        '6900': { name_ar: 'مواد ومستلزمات تشغيل مصروفة', name_en: 'Issued Operating Materials Expense', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '6950': { name_ar: 'مصروفات أخرى', name_en: 'Other Expenses', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '3200': { name_ar: 'أرباح محتجزة', name_en: 'Retained Earnings', type: 'equity', group: 'equity', balance: 'credit' },
        '1150': { name_ar: 'ضريبة مشتريات قابلة للخصم', name_en: 'Purchase VAT Receivable', type: 'asset', group: 'tax', balance: 'debit' },
        '2150': { name_ar: 'دفعات مقدمة من العملاء', name_en: 'Customer Advances', type: 'liability', group: 'current_liabilities', balance: 'credit' },
        '4100': { name_ar: 'مبيعات المنتجات', name_en: 'Product Sales', type: 'revenue', group: 'income', balance: 'credit' },
        '4300': { name_ar: 'خصومات المبيعات', name_en: 'Sales Discounts', type: 'contra_revenue', group: 'income', balance: 'debit' },
        '4400': { name_ar: 'مردودات المبيعات', name_en: 'Sales Returns', type: 'contra_revenue', group: 'income', balance: 'debit' },
        '5100': { name_ar: 'تكلفة بضاعة مباعة', name_en: 'COGS', type: 'expense', group: 'cogs', balance: 'debit' },
        '7110': { name_ar: 'زيادة نقدية الصندوق', name_en: 'Cash Over', type: 'revenue', group: 'income', balance: 'credit' },
        '7210': { name_ar: 'عجز نقدية الصندوق', name_en: 'Cash Short', type: 'expense', group: 'operating_expenses', balance: 'debit' },
        '7290': { name_ar: 'فروق التقريب المحاسبي', name_en: 'Rounding Differences', type: 'expense', group: 'operating_expenses', balance: 'debit' },
      };
      const known = knownAccounts[code];
      if (known) {
        const settings = await queryable.selectFrom('accounting_settings').select('account_id')
          .where('tenant_id', '=', tenantId).where('id', '=', 1).executeTakeFirst();
        const ownerAccountId = settings?.account_id || (await queryable.selectFrom('accounting_accounts')
          .select('account_id').where('tenant_id', '=', tenantId).executeTakeFirst())?.account_id;
        if (!ownerAccountId) throw new AppError('Accounting foundation must exist before creating system accounts', 'ACCOUNTING_FOUNDATION_REQUIRED', 409);
        const created = await queryable
          .insertInto('accounting_accounts')
          .values({
            tenant_id: tenantId,
            account_id: ownerAccountId,
            code,
            name_ar: known.name_ar,
            name_en: known.name_en,
            account_type: known.type,
            account_group: known.group,
            normal_balance: known.balance,
            is_active: true,
            is_system: true,
            created_at: sql`NOW()`,
            updated_at: sql`NOW()`,
          } as any)
          .onConflict((oc) => oc.columns(['tenant_id', 'code']).doUpdateSet({ is_active: true, updated_at: sql`NOW()` }))
          .returning('id')
          .executeTakeFirst();
        if (created?.id) return Number(created.id);
      }
      throw new Error(`Required system account ${code} not found for tenant ${tenantId}. Accounting integration failed.`);
    }
    if (!account.is_active) {
      await queryable
        .updateTable('accounting_accounts')
        .set({ is_active: true, updated_at: sql`NOW()` })
        .where('id', '=', Number(account.id))
        .where('tenant_id', '=', tenantId)
        .execute();
    }
    return Number(account.id);
  }

  /**
   * يسجّل أن قيد هذا المستند لم يُرحَّل — **بدل أن يُبتلع الخطأ في سطر سجلّ**.
   *
   * الكتابة تجري داخل نفس معاملة المستند، فإما أن تُحفظ الفاتورة ومعها أثر فشلها، أو لا تُحفظ
   * أصلاً. لا توجد حالة ثالثة تكون فيها فاتورةٌ بلا قيد وبلا أثر — وهي الحالة التي مرّت بها
   * 2,281 فاتورة على الإنتاج قبل هذا.
   */
  async recordPostingFailure(
    queryable: DbOrTx,
    scope: { tenantId: string; accountId: string },
    sourceType: string,
    sourceId: number,
    errorMessage: string,
  ): Promise<void> {
    try {
      await sql`
        INSERT INTO accounting_posting_failures
          (tenant_id, account_id, source_type, source_id, error_message, attempts, first_failed_at, last_attempt_at, resolved_at)
        VALUES
          (${scope.tenantId}, ${scope.accountId}, ${sourceType}, ${sourceId}, ${String(errorMessage).slice(0, 2000)}, 1, NOW(), NOW(), NULL)
        ON CONFLICT (tenant_id, source_type, source_id) DO UPDATE
        SET attempts = accounting_posting_failures.attempts + 1,
            error_message = EXCLUDED.error_message,
            last_attempt_at = NOW(),
            resolved_at = NULL
      `.execute(queryable);
    } catch (error) {
      // آخر خط: لو تعذّر حتى تسجيل الفشل فلا نُسقط البيعة بسببه، لكن لا نتركه صامتاً.
      this.logger.error(
        `Could not record the posting failure for ${sourceType} ${sourceId}: `
        + (error instanceof Error ? error.message : String(error)),
      );
    }
  }

  /** يُغلق سجل فشل سابق بعد نجاح الترحيل. */
  async clearPostingFailure(
    queryable: DbOrTx,
    scope: { tenantId: string; accountId: string },
    sourceType: string,
    sourceId: number,
  ): Promise<void> {
    try {
      await sql`
        UPDATE accounting_posting_failures
        SET resolved_at = NOW(), last_attempt_at = NOW()
        WHERE tenant_id = ${scope.tenantId}
          AND source_type = ${sourceType}
          AND source_id = ${sourceId}
          AND resolved_at IS NULL
      `.execute(queryable);
    } catch {
      // لا شيء: عدم إغلاق سجل قديم أهون من إسقاط عملية ناجحة.
    }
  }
}
