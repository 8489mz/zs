import { Inject, Injectable, Logger } from '@nestjs/common';
import { Kysely, sql } from '../../database/kysely';
import { AuditService } from '../../core/audit/audit.service';
import { AuthContext } from '../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../database/database.constants';
import { Database } from '../../database/database.types';
import { TransactionHelper } from '../../database/helpers/transaction.helper';
import { AccountingPostingService } from '../accounting/accounting-posting.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { CreateTreasuryTransferDto } from './dto/create-treasury-transfer.dto';
import { AppError } from '../../common/errors/app-error';
import { paginateRows } from '../../common/utils/pagination';
import { canonicalLockIds } from '../../common/utils/canonical-lock-order';
import { lockAccountingPeriod } from '../accounting/accounting-period-lock';
import { tenantBaseCurrency } from '../accounting/accounting-currency';
import { currencyMoneyDigits, fromMinorUnits, roundMoney, toMinorUnits } from '../accounting/engines/money-minor-units.engine';

@Injectable()
export class TreasuryService {
  private readonly logger = new Logger(TreasuryService.name);

  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly tx: TransactionHelper,
    private readonly audit: AuditService,
    private readonly accountingPosting: AccountingPostingService,
  ) {}

  async listExpenses(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const search = String(query.search || '').trim();
    const searchPattern = search ? `%${search}%` : null;
    
    const page = Math.max(1, Number(query.page || 1));
    const pageSize = Math.min(100, Math.max(1, Number(query.pageSize || 20)));
    const offset = (page - 1) * pageSize;

    const lastSeenId = Math.max(0, Number(query.lastSeenId || query.lastId || query.cursor || 0));
    const safeOffset = lastSeenId > 0 ? 0 : offset;

    const querySql = search 
      ? sql`
          WITH filtered_expenses AS (
            SELECT
              e.id, e.title, e.amount, e.expense_date, e.note, e.branch_id, e.location_id,
              b.name AS branch_name, l.name AS location_name, u.username AS created_by_name
            FROM expenses e
            LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = ${scope.tenantId}
            LEFT JOIN stock_locations l ON l.id = e.location_id AND l.tenant_id = ${scope.tenantId}
            LEFT JOIN users u ON u.id = e.created_by AND u.tenant_id = ${scope.tenantId}
            WHERE e.tenant_id = ${scope.tenantId}
            ${lastSeenId > 0 ? sql`AND e.id < ${lastSeenId}` : sql``}
            AND (
              e.title ILIKE ${searchPattern} OR
              e.note ILIKE ${searchPattern} OR
              u.username ILIKE ${searchPattern} OR
              b.name ILIKE ${searchPattern} OR
              l.name ILIKE ${searchPattern}
            )
          )
          SELECT *, COUNT(*) OVER() as total_count, SUM(amount) OVER() as total_amount
          FROM filtered_expenses
          ORDER BY id DESC
          LIMIT ${pageSize} OFFSET ${safeOffset}
        `
      : sql`
          WITH filtered_expenses AS (
            SELECT
              e.id, e.title, e.amount, e.expense_date, e.note, e.branch_id, e.location_id,
              b.name AS branch_name, l.name AS location_name, u.username AS created_by_name
            FROM expenses e
            LEFT JOIN branches b ON b.id = e.branch_id AND b.tenant_id = ${scope.tenantId}
            LEFT JOIN stock_locations l ON l.id = e.location_id AND l.tenant_id = ${scope.tenantId}
            LEFT JOIN users u ON u.id = e.created_by AND u.tenant_id = ${scope.tenantId}
            WHERE e.tenant_id = ${scope.tenantId}
            ${lastSeenId > 0 ? sql`AND e.id < ${lastSeenId}` : sql``}
          )
          SELECT *, COUNT(*) OVER() as total_count, SUM(amount) OVER() as total_amount
          FROM filtered_expenses
          ORDER BY id DESC
          LIMIT ${pageSize} OFFSET ${safeOffset}
        `;

    const result = await querySql.execute(this.db) as any;

    let rows = result.rows.map((row: any) => ({
      id: String(row.id),
      title: row.title || '',
      amount: Number(row.amount || 0),
      date: row.expense_date,
      note: row.note || '',
      createdBy: row.created_by_name || '',
      branchId: row.branch_id ? String(row.branch_id) : '',
      branchName: row.branch_name || '',
      locationId: row.location_id ? String(row.location_id) : '',
      locationName: row.location_name || '',
    }));

    const totalItems = result.rows.length > 0 ? Number(result.rows[0].total_count) : 0;
    const totalAmount = result.rows.length > 0 ? Number(result.rows[0].total_amount) : 0;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const nextCursor = result.rows.length === pageSize ? String(result.rows[result.rows.length - 1].id) : null;

    return {
      expenses: rows,
      pagination: { page, pageSize, totalItems, totalPages, nextCursor },
      summary: {
        totalItems,
        totalAmount: roundMoney(totalAmount, moneyDigits),
      },
      scope,
    };
  }

  async createExpense(payload: CreateExpenseDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    const requestedAmount = Number(payload.amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new AppError('Expense amount must be positive', 'INVALID_EXPENSE_AMOUNT', 400);
    }
    let amount: number;
    let minorAmount: number;
    try {
      minorAmount = toMinorUnits(requestedAmount, digits);
      amount = fromMinorUnits(minorAmount, digits);
    } catch {
      throw new AppError('Expense amount must match the tenant currency minor units', 'INVALID_EXPENSE_PRECISION', 400);
    }
    // Idempotency key: mandatory, client-supplied, no server default --
    // mirroring createTransfer. A missing or short key is a client error,
    // never a silently generated one: a generated key cannot deduplicate
    // the retry it was generated for.
    const requestKey = String(payload.requestKey || '').trim();
    if (requestKey.length < 8 || requestKey.length > 160) {
      throw new AppError('A stable expense request key is required', 'EXPENSE_REQUEST_KEY_REQUIRED', 400);
    }
    const expenseDate = new Date(payload.date);
    if (!Number.isFinite(expenseDate.getTime())) {
      throw new AppError('Expense date is invalid', 'INVALID_EXPENSE_DATE', 400);
    }
    const title = String(payload.title || '').trim();
    const note = String(payload.note || '').trim();
    const branchId = payload.branchId ? Number(payload.branchId) : null;
    const locationId = payload.locationId ? Number(payload.locationId) : null;
    const costCenterId = payload.costCenterId ? Number(payload.costCenterId) : null;
    const samePayload = (row: {
      title: string; amount: number; expense_date: Date | string; note: string;
      branch_id: number | null; location_id: number | null; cost_center_id: number | null;
    }): boolean => {
      if (String(row.title || '').trim() !== title) return false;
      if (toMinorUnits(Number(row.amount), digits) !== minorAmount) return false;
      if (new Date(row.expense_date).getTime() !== expenseDate.getTime()) return false;
      if (String(row.note || '').trim() !== note) return false;
      if ((row.branch_id == null ? null : Number(row.branch_id)) !== branchId) return false;
      if ((row.location_id == null ? null : Number(row.location_id)) !== locationId) return false;
      if ((row.cost_center_id == null ? null : Number(row.cost_center_id)) !== costCenterId) return false;
      return true;
    };
    const findPrior = async (trx: Kysely<Database>) => sql<{
      id: number; title: string; amount: number; expense_date: Date; note: string;
      branch_id: number | null; location_id: number | null; cost_center_id: number | null;
    }>`
      SELECT id, title, amount, expense_date, note, branch_id, location_id, cost_center_id
      FROM expenses
      WHERE tenant_id = ${scope.tenantId} AND request_key = ${requestKey}
      FOR UPDATE
    `.execute(trx);

    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      // Idempotency is checked under a row lock. A retry after a committed
      // request returns the original expense instead of creating a second
      // expense and a second journal.
      const existing = await findPrior(trx);
      const prior = existing.rows[0];
      if (prior) {
        if (!samePayload(prior)) {
          throw new AppError('Expense request key was already used with different data', 'EXPENSE_IDEMPOTENCY_CONFLICT', 409);
        }
        return { expenseId: Number(prior.id), idempotent: true };
      }
      if (branchId && !await trx.selectFrom('branches').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', '=', branchId).executeTakeFirst()) {
        throw new AppError('Branch does not belong to this tenant', 'INVALID_EXPENSE_BRANCH', 400);
      }
      if (locationId && !await trx.selectFrom('stock_locations').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', '=', locationId).executeTakeFirst()) {
        throw new AppError('Location does not belong to this tenant', 'INVALID_EXPENSE_LOCATION', 400);
      }
      if (costCenterId && !await trx.selectFrom('cost_centers').select('id')
        .where('tenant_id', '=', scope.tenantId).where('id', '=', costCenterId).executeTakeFirst()) {
        throw new AppError('Cost center does not belong to this tenant', 'INVALID_EXPENSE_COST_CENTER', 400);
      }
      // The initial idempotency lookup may miss another request whose row
      // was still uncommitted. Re-check AFTER the period lock and the
      // scope validations, right before the insert: this makes same-key
      // simultaneous retries return the committed receipt, without ever
      // attempting a second insert/GL write.
      const visibleAfterChecks = await findPrior(trx);
      const completed = visibleAfterChecks.rows[0];
      if (completed) {
        if (!samePayload(completed)) {
          throw new AppError('Expense request key was already used with different data', 'EXPENSE_IDEMPOTENCY_CONFLICT', 409);
        }
        return { expenseId: Number(completed.id), idempotent: true };
      }
      const insert = await sql<{ id: number }>`
        INSERT INTO expenses (title, amount, expense_date, note, branch_id, location_id, cost_center_id, created_by, tenant_id, account_id, request_key)
        VALUES (
          ${title},
          ${amount},
          ${expenseDate},
          ${note},
          ${branchId},
          ${locationId},
          ${costCenterId},
          ${auth.userId},
          ${scope.tenantId},
          ${scope.accountId},
          ${requestKey}
        )
        RETURNING id
      `.execute(trx);

      const expenseId = Number(insert.rows[0]?.id || 0);

      await trx.insertInto('treasury_transactions').values({
        txn_type: 'expense',
        amount: -amount,
        note: 'مصروف: ' + title,
        reference_type: 'expense',
        reference_id: expenseId,
        branch_id: branchId,
        location_id: locationId,
        created_by: auth.userId,
        tenant_id: scope.tenantId,
        account_id: scope.accountId,
      }).execute();

      // Source-of-truth accounting post is the expense document itself.
      // Treasury transaction is an operational cash movement side-effect for the same expense.
      const accountingResult = await this.accountingPosting.postExpense(trx, expenseId, auth);
      if (!accountingResult.journalEntryId) throw new Error(`Expense ${expenseId} has no journal entry`);
      if (accountingResult.posted) {
        this.logger.log(`Posted expense journal for expense ${expenseId} with entry ${accountingResult.journalEntryId}`);
      } else {
        this.logger.warn(`Skipped expense journal posting for expense ${expenseId}; existing entry ${accountingResult.journalEntryId ?? 'none'}`);
      }
      return { expenseId, idempotent: false };
    });

    if (!result.idempotent) {
      // The expense and its journal are already committed. An audit-log
      // failure must NOT turn this into an error response: the client
      // would retry, and the retry is exactly the double posting this
      // idempotency key exists to prevent. Log the failure and succeed.
      try {
        await this.audit.log('تسجيل مصروف', 'تم تسجيل مصروف بواسطة ' + auth.username, auth);
      } catch (auditError) {
        this.logger.error(`Expense ${result.expenseId} committed but audit log failed: ${(auditError as Error)?.message || auditError}`);
      }
    }
    return { ok: true, ...(await this.listExpenses({}, auth)) };
  }

  async createTransfer(payload: CreateTreasuryTransferDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const fromAccountId = Number(payload.fromAccountId);
    const toAccountId = Number(payload.toAccountId);
    const requestedAmount = Number(payload.amount);
    if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
      throw new AppError('Transfer amount must be greater than zero', 'INVALID_TRANSFER_AMOUNT', 400);
    }
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, scope.tenantId));
    let minorAmount: number;
    try {
      minorAmount = toMinorUnits(requestedAmount, moneyDigits);
    } catch {
      throw new AppError('Transfer amount must match the tenant currency minor units', 'INVALID_TRANSFER_PRECISION', 400);
    }
    const amount = fromMinorUnits(minorAmount, moneyDigits);
    const requestKey = String(payload.requestKey || '').trim();
    if (!Number.isInteger(fromAccountId) || !Number.isInteger(toAccountId) || fromAccountId === toAccountId) {
      throw new AppError('Source and destination accounts must be different valid accounts', 'INVALID_TRANSFER_ACCOUNTS', 400);
    }
    if (requestKey.length < 8 || requestKey.length > 160) {
      throw new AppError('A stable transfer request key is required', 'TRANSFER_REQUEST_KEY_REQUIRED', 400);
    }

    const result = await this.tx.runInTransaction(this.db, async (trx) => {
      await lockAccountingPeriod(trx, scope.tenantId);
      // Idempotency is checked under a row lock. A retry after a committed request
      // returns the original transfer instead of creating a second ledger movement.
      const existing = await sql<{
        id: number;
        from_account_id: number;
        to_account_id: number;
        amount: number;
        journal_entry_id: number | null;
      }>`
        SELECT id, from_account_id, to_account_id, amount, journal_entry_id
        FROM treasury_transfers
        WHERE tenant_id = ${scope.tenantId} AND request_key = ${requestKey}
        FOR UPDATE
      `.execute(trx);
      const prior = existing.rows[0];
      if (prior) {
        if (Number(prior.from_account_id) !== fromAccountId
          || Number(prior.to_account_id) !== toAccountId
          || toMinorUnits(Number(prior.amount), moneyDigits) !== minorAmount) {
          throw new AppError('Transfer request key was already used with different data', 'TRANSFER_IDEMPOTENCY_CONFLICT', 409);
        }
        return { transferId: Number(prior.id), journalEntryId: Number(prior.journal_entry_id || 0), idempotent: true };
      }

      // Lock both accounts in one canonical order. This is the only lock order
      // used for treasury transfers, so A->B and B->A cannot deadlock.
      const orderedAccountIds = canonicalLockIds([fromAccountId, toAccountId]);
      const accounts = await trx
        .selectFrom('accounting_accounts')
        .select(['id', 'name_ar'])
        .where('tenant_id', '=', scope.tenantId)
        .where('id', 'in', orderedAccountIds)
        .where('account_type', '=', 'asset')
        .where('normal_balance', '=', 'debit')
        .where('is_cash_bank', '=', true)
        .where('is_active', '=', true)
        .forUpdate()
        .orderBy('id', 'asc')
        .execute();
      if (accounts.length !== 2) {
        throw new AppError('Both accounts must be active cash or bank accounts in this tenant', 'TREASURY_ACCOUNT_NOT_FOUND', 400);
      }

      // The initial idempotency lookup may miss another request whose row
      // was still uncommitted. Re-check AFTER serializing treasury accounts.
      // This makes same-key simultaneous retries return the committed receipt,
      // without ever attempting a second insert/GL write.
      const visibleAfterLock = await sql<{
        id: number; from_account_id: number; to_account_id: number;
        amount: number; journal_entry_id: number | null;
      }>`
        SELECT id, from_account_id, to_account_id, amount, journal_entry_id
        FROM treasury_transfers
        WHERE tenant_id = ${scope.tenantId} AND request_key = ${requestKey}
        FOR UPDATE
      `.execute(trx);
      const completed = visibleAfterLock.rows[0];
      if (completed) {
        if (Number(completed.from_account_id) !== fromAccountId
          || Number(completed.to_account_id) !== toAccountId
          || toMinorUnits(Number(completed.amount), moneyDigits) !== minorAmount) {
          throw new AppError('Transfer request key was already used with different data', 'TRANSFER_IDEMPOTENCY_CONFLICT', 409);
        }
        return { transferId: Number(completed.id), journalEntryId: Number(completed.journal_entry_id || 0), idempotent: true };
      }

      const balanceResult = await sql<{ balance: string }>`
        SELECT COALESCE(SUM(jel.debit - jel.credit), 0)::numeric AS balance
        FROM journal_entry_lines jel
        INNER JOIN journal_entries je
          ON je.id = jel.journal_entry_id AND je.tenant_id = ${scope.tenantId}
        WHERE jel.tenant_id = ${scope.tenantId}
          AND jel.account_id = ${fromAccountId}
          AND je.status = 'posted'
      `.execute(trx);
      const available = Number(balanceResult.rows[0]?.balance || 0);
      const availableMinor = toMinorUnits(available, moneyDigits);
      if (availableMinor < minorAmount) {
        throw new AppError(`Insufficient balance in source treasury (available ${available.toFixed(moneyDigits)})`, 'INSUFFICIENT_TREASURY_BALANCE', 400);
      }

      const inserted = await sql<{ id: number }>`
        INSERT INTO treasury_transfers
          (tenant_id, account_id, from_account_id, to_account_id, amount, note, request_key, created_by)
        VALUES
          (${scope.tenantId}, ${scope.accountId}, ${fromAccountId}, ${toAccountId}, ${amount},
           ${String(payload.note || '').trim()}, ${requestKey}, ${auth.userId})
        RETURNING id
      `.execute(trx);
      const transferId = Number(inserted.rows[0]?.id || 0);
      if (!transferId) throw new AppError('Treasury transfer could not be created', 'TRANSFER_CREATE_FAILED', 500);

      const journalEntryId = await this.accountingPosting.postDomainJournal(trx, {
        sourceType: 'treasury_transfer',
        sourceId: transferId,
        tenantId: scope.tenantId,
        accountId: scope.accountId,
        entryDate: new Date(),
        description: String(payload.note || `تحويل خزينة إلى الحساب ${toAccountId}`).trim(),
        branchId: null,
        locationId: null,
        createdBy: auth.userId,
        postedBy: auth.userId,
        lines: [
          { accountId: toAccountId, description: 'استلام تحويل خزينة', debit: amount, credit: 0, partnerType: 'none', partnerId: null, branchId: null, locationId: null },
          { accountId: fromAccountId, description: 'إرسال تحويل خزينة', debit: 0, credit: amount, partnerType: 'none', partnerId: null, branchId: null, locationId: null },
        ],
      });

      await sql`
        UPDATE treasury_transfers
        SET journal_entry_id = ${journalEntryId}
        WHERE id = ${transferId} AND tenant_id = ${scope.tenantId}
      `.execute(trx);

      await trx.insertInto('treasury_transactions').values([
        {
          txn_type: 'transfer_out', amount: -amount, note: String(payload.note || '').trim(),
          reference_type: 'treasury_transfer', reference_id: transferId, return_document_id: null,
          branch_id: null, location_id: null, created_by: auth.userId,
          tenant_id: scope.tenantId, account_id: scope.accountId,
        },
        {
          txn_type: 'transfer_in', amount, note: String(payload.note || '').trim(),
          reference_type: 'treasury_transfer', reference_id: transferId, return_document_id: null,
          branch_id: null, location_id: null, created_by: auth.userId,
          tenant_id: scope.tenantId, account_id: scope.accountId,
        },
      ]).execute();

      return { transferId, journalEntryId, idempotent: false };
    });

    if (!result.idempotent) {
      await this.audit.log('تحويل خزينة', `تم تحويل مبلغ ${amount.toFixed(moneyDigits)} بين حسابين`, auth);
    }
    return { ok: true, ...result };
  }
}
