import { tenantBaseCurrency } from '../accounting-currency';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';
import { type MoneyDigits, currencyMoneyDigits } from '../engines/money-minor-units.engine';
import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { Kysely } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { Database } from '../../../database/database.types';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { JournalEntriesQueryDto } from '../dto/accounting.dto';
import { resolveBusinessDateKey, nextAccountingDay } from '../engines/accounting-date.engine';
import { accountingDateKey } from '../accounting-tax-lock';

/**
 * AccountingJournalsReadService — slice S1 of the accounting split.
 * Pure move of 4 methods from AccountingService (journals read: the
 * two reference asserts + the two journal reads). No behavior change:
 * the bodies are byte-identical; the facade keeps thin delegates with
 * the same names and signatures. Deps are kernel only (db + the three
 * bound kernel helpers); no cross-slice deps. The posting fallback
 * does not apply here (no posting in S1). Date handling travels
 * verbatim: listJournalEntries carries serverTime: new Date()
 * .toISOString() (list-response server time, no instant comparison,
 * no UTC-slice normalizer) + nextAccountingDay for the dateTo bound
 * + getTenantTimezone for the server timezone; assertNotInLockedPeriod
 * resolves the entry date through resolveBusinessDateKey (tenant day)
 * and compares lock dates through accountingDateKey.
 * assertJournalReferences is public here (private in the facade
 * delegate) — the facade, a different class, cannot call a private
 * slice method (tsc TS2341); the facade delegate stays private, so
 * the facade public surface is unchanged. Its only callers (the S2
 * writers) reach it through the facade delegate.
 * Driving specs: je-list-numeric-sort (listJournalEntries +
 * getJournalEntry). No spec repoint travels in this patch —
 * merge-owned (je-sort pin + p0a multi-file read).
 */

export interface AccountingJournalsReadDeps {
  db: Kysely<Database>;
  // Bound kernel helpers (same names as the facade members, so the
  // moved bodies are byte-identical). assertAccountingAccess +
  // tenantPredicate + toMoney stay in the facade forever.
  assertAccountingAccess: (auth: AuthContext) => void;
  tenantPredicate: (auth: AuthContext, alias?: string) => any;
  toMoney: (value: unknown, digits: MoneyDigits) => number;
}

@Injectable()
export class AccountingJournalsReadService {
  private readonly db: Kysely<Database>;
  private readonly assertAccountingAccess: (auth: AuthContext) => void;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => any;
  private readonly toMoney: (value: unknown, digits: MoneyDigits) => number;

  constructor(deps: AccountingJournalsReadDeps) {
    this.db = deps.db;
    this.assertAccountingAccess = deps.assertAccountingAccess;
    this.tenantPredicate = deps.tenantPredicate;
    this.toMoney = deps.toMoney;
  }

  async assertJournalReferences(
    queryable: Kysely<Database>,
    tenantId: string,
    lines: Array<{
      costCenterId?: number | null;
      branchId?: number | null;
      locationId?: number | null;
      partnerType?: string;
      partnerId?: number | null;
    }>,
  ): Promise<void> {
    const ids = (values: Array<number | null | undefined>) =>
      Array.from(new Set(values.filter((value): value is number => Number.isSafeInteger(value) && Number(value) > 0)));
    const branches = ids(lines.map((line) => line.branchId));
    const locations = ids(lines.map((line) => line.locationId));
    const centers = ids(lines.map((line) => line.costCenterId));
    const customers = ids(lines.filter((line) => line.partnerType === 'customer').map((line) => line.partnerId));
    const suppliers = ids(lines.filter((line) => line.partnerType === 'supplier').map((line) => line.partnerId));
    if (
      branches.length &&
      (
        await queryable
          .selectFrom('branches')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', branches)
          .execute()
      ).length !== branches.length
    ) {
      throw new BadRequestException('فرع القيد لا ينتمي لهذه المنشأة.');
    }
    if (
      locations.length &&
      (
        await queryable
          .selectFrom('stock_locations')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', locations)
          .execute()
      ).length !== locations.length
    ) {
      throw new BadRequestException('موقع القيد لا ينتمي لهذه المنشأة.');
    }
    if (
      centers.length &&
      (
        await queryable
          .selectFrom('cost_centers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', centers)
          .execute()
      ).length !== centers.length
    ) {
      throw new BadRequestException('مركز تكلفة القيد لا ينتمي لهذه المنشأة.');
    }
    if (
      customers.length &&
      (
        await queryable
          .selectFrom('customers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', customers)
          .execute()
      ).length !== customers.length
    ) {
      throw new BadRequestException('عميل القيد لا ينتمي لهذه المنشأة.');
    }
    if (
      suppliers.length &&
      (
        await queryable
          .selectFrom('suppliers')
          .select('id')
          .where('tenant_id', '=', tenantId)
          .where('id', 'in', suppliers)
          .execute()
      ).length !== suppliers.length
    ) {
      throw new BadRequestException('مورد القيد لا ينتمي لهذه المنشأة.');
    }
  }

  async listJournalEntries(filters: JournalEntriesQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    // P8 (RC-7): the JE page's date default comes from the server clock —
    // the list response carries it, the HR attendance list precedent.
    const tenantTimezone = await getTenantTimezone(this.db, auth.tenantId);
    const page = Math.max(1, Number(filters.page || 1));
    const pageSize = Math.min(200, Math.max(1, Number(filters.pageSize || 20)));
    const offset = (page - 1) * pageSize;

    const dateFrom = filters.dateFrom ? new Date(filters.dateFrom) : null;
    const dateTo = filters.dateTo ? new Date(filters.dateTo) : null;

    let countQuery = this.db.selectFrom('journal_entries').where(this.tenantPredicate(auth));
    let rowsQuery = this.db
      .selectFrom('journal_entries as je')
      .leftJoin('users as creator', (join) =>
        join.onRef('creator.id', '=', 'je.created_by').onRef('creator.tenant_id', '=', 'je.tenant_id'),
      )
      .leftJoin('users as poster', (join) =>
        join.onRef('poster.id', '=', 'je.posted_by').onRef('poster.tenant_id', '=', 'je.tenant_id'),
      )
      .select([
        'je.id',
        'je.entry_no',
        'je.entry_date',
        'je.description',
        'je.source_type',
        'je.source_id',
        'je.status',
        'je.branch_id',
        'je.location_id',
        'je.created_by',
        'je.posted_by',
        'je.posted_at',
        'je.cancelled_at',
        'je.created_at',
        'creator.username as created_by_name',
        'poster.username as posted_by_name',
      ])
      .where(this.tenantPredicate(auth, 'je'));

    if (dateFrom) {
      countQuery = countQuery.where('entry_date', '>=', dateFrom);
      rowsQuery = rowsQuery.where('je.entry_date', '>=', dateFrom);
    }
    if (dateTo) {
      countQuery = countQuery.where('entry_date', '<', nextAccountingDay(dateTo));
      rowsQuery = rowsQuery.where('je.entry_date', '<', nextAccountingDay(dateTo));
    }
    if (filters.status) {
      countQuery = countQuery.where('status', '=', filters.status);
      rowsQuery = rowsQuery.where('je.status', '=', filters.status);
    }
    if (filters.sourceType) {
      countQuery = countQuery.where('source_type', '=', filters.sourceType.trim());
      rowsQuery = rowsQuery.where('je.source_type', '=', filters.sourceType.trim());
    }

    // List order is document order (entry_no), never the row identity or
    // the entry date. JE-00015026 is dated 2026-11-08 while JE-00015009
    // is dated 2026-11-09, so a date order puts the newer document after
    // the older one; and the identity is burned by failed inserts while
    // the visible number comes from the gapless allocator (MAX(entry_no)
    // + 1) — id order is not document order either. entry_no is
    // fixed-width (JE- + 8 zero-padded digits), so its lexicographic
    // order is its numeric order; je.id desc is only the tiebreak.
    const cursor = typeof filters.cursor === 'string' ? filters.cursor.trim() : '';
    const lastSeenId = Math.max(0, Number(filters.lastSeenId || 0));
    if (cursor) {
      rowsQuery = rowsQuery.where('je.entry_no', '<', cursor);
    } else if (lastSeenId > 0) {
      // Legacy id cursor (no caller sends it; the page uses page/pageSize).
      // Kept so an old caller still pages the same rows, now in document order.
      rowsQuery = rowsQuery.where('je.id', '<', lastSeenId);
    }

    const totalRow = await countQuery.select((eb) => eb.fn.countAll<number>().as('count')).executeTakeFirst();
    const totalItems = Number(totalRow?.count || 0);
    const rows = await rowsQuery
      .orderBy('je.entry_no', 'desc')
      .orderBy('je.id', 'desc')
      .limit(pageSize)
      .offset(cursor || lastSeenId > 0 ? 0 : offset)
      .execute();

    const nextCursor = rows.length === pageSize ? rows[rows.length - 1].entry_no : null;

    return {
      entries: rows.map((row) => ({
        id: String(row.id),
        entryNo: row.entry_no,
        entryDate: row.entry_date,
        description: row.description || '',
        sourceType: row.source_type || 'manual',
        sourceId: row.source_id ? String(row.source_id) : '',
        status: row.status,
        branchId: row.branch_id ? String(row.branch_id) : '',
        locationId: row.location_id ? String(row.location_id) : '',
        createdBy: row.created_by ? String(row.created_by) : '',
        createdByName: row.created_by_name || '',
        postedBy: row.posted_by ? String(row.posted_by) : '',
        postedByName: row.posted_by_name || '',
        postedAt: row.posted_at,
        cancelledAt: row.cancelled_at,
      })),
      pagination: {
        page,
        pageSize,
        totalItems,
        totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
        nextCursor,
      },
      // P8 (RC-7): the JE page's date default comes from the server clock.
      serverTime: new Date().toISOString(),
      serverTimezone: tenantTimezone,
    };
  }

  async getJournalEntry(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    this.assertAccountingAccess(auth);
    const { tenantId } = requireTenantScope(auth);
    const digits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));
    const entry = await this.db
      .selectFrom('journal_entries')
      .selectAll()
      .where('id', '=', id)
      .where(this.tenantPredicate(auth))
      .executeTakeFirst();
    if (!entry) throw new NotFoundException('Journal entry not found');

    const lines = await (this.db as any)
      .selectFrom('journal_entry_lines as l')
      .innerJoin('accounting_accounts as a', (j: any) =>
        j.onRef('a.id', '=', 'l.account_id').onRef('a.tenant_id', '=', 'l.tenant_id'),
      )
      .leftJoin('cost_centers as cc', (j: any) =>
        j.onRef('cc.id', '=', 'l.cost_center_id').onRef('cc.tenant_id', '=', 'l.tenant_id'),
      )
      .select([
        'l.id',
        'l.journal_entry_id',
        'l.account_id',
        'l.cost_center_id',
        'cc.code as cost_center_code',
        'cc.name as cost_center_name',
        'l.description',
        'l.debit',
        'l.credit',
        'l.partner_type',
        'l.partner_id',
        'l.branch_id',
        'l.location_id',
        'l.is_reconciled',
        'a.code as account_code',
        'a.name_ar as account_name_ar',
        'a.name_en as account_name_en',
      ])
      .where('l.journal_entry_id', '=', id)
      .where('l.tenant_id', '=', tenantId)
      .orderBy('l.id', 'asc')
      .execute();

    const totalDebit = this.toMoney(
      lines.reduce((sum: number, line: any) => sum + Number(line.debit || 0), 0),
      digits,
    );
    const totalCredit = this.toMoney(
      lines.reduce((sum: number, line: any) => sum + Number(line.credit || 0), 0),
      digits,
    );

    return {
      entry: {
        id: String(entry.id),
        entryNo: entry.entry_no,
        entryDate: entry.entry_date,
        description: entry.description || '',
        sourceType: entry.source_type || 'manual',
        sourceId: entry.source_id ? String(entry.source_id) : '',
        status: entry.status,
        canReverse:
          entry.status === 'posted' &&
          entry.source_type === 'manual' &&
          !entry.reversal_of_entry_id &&
          !entry.reversed_by_entry_id &&
          !lines.some((line: { is_reconciled: boolean }) => line.is_reconciled),
        reversedByEntryId: entry.reversed_by_entry_id ? String(entry.reversed_by_entry_id) : null,
        reversalOfEntryId: entry.reversal_of_entry_id ? String(entry.reversal_of_entry_id) : null,
        branchId: entry.branch_id ? String(entry.branch_id) : '',
        locationId: entry.location_id ? String(entry.location_id) : '',
        createdBy: entry.created_by ? String(entry.created_by) : '',
        postedBy: entry.posted_by ? String(entry.posted_by) : '',
        postedAt: entry.posted_at,
        cancelledBy: entry.cancelled_by ? String(entry.cancelled_by) : '',
        cancelledAt: entry.cancelled_at,
        cancelReason: entry.cancel_reason || '',
        lines: lines.map((line: any) => ({
          id: String(line.id),
          accountId: String(line.account_id),
          accountCode: line.account_code,
          accountNameAr: line.account_name_ar,
          accountNameEn: line.account_name_en || '',
          costCenterId: line.cost_center_id ? Number(line.cost_center_id) : null,
          costCenterCode: line.cost_center_code || null,
          costCenterName: line.cost_center_name || null,
          description: line.description || '',
          debit: this.toMoney(line.debit, digits),
          credit: this.toMoney(line.credit, digits),
          partnerType: line.partner_type,
          partnerId: line.partner_id ? String(line.partner_id) : '',
          branchId: line.branch_id ? String(line.branch_id) : '',
          locationId: line.location_id ? String(line.location_id) : '',
        })),
        totals: {
          debit: totalDebit,
          credit: totalCredit,
          balanced: Math.abs(totalDebit - totalCredit) <= 0.0001,
        },
      },
    };
  }

  async assertNotInLockedPeriod(
    tenantId: string,
    entryDate: Date | string,
    options?: {
      auth?: AuthContext;
      isTaxOperation?: boolean;
      queryable?: Kysely<Database>;
    },
  ): Promise<void> {
    const queryable = options?.queryable || this.db;
    const settings = await queryable
      .selectFrom('accounting_settings')
      .select(['lock_date_all', 'lock_date_non_adviser', 'lock_date_tax'])
      .where('tenant_id', '=', tenantId)
      .where('id', '=', 1)
      .executeTakeFirst();

    const dateStr = await resolveBusinessDateKey(queryable, tenantId, entryDate);

    if (settings) {
      // 1. Hard lock (All users)
      if (settings.lock_date_all) {
        const lockAllStr = accountingDateKey(settings.lock_date_all);
        if (dateStr <= lockAllStr) {
          throw new BadRequestException(
            `الفترة المحاسبية مقفلة نهائياً حتى تاريخ ${lockAllStr}. لا يمكن إضافة أو تعديل قيود في فترة مغلقة.`,
          );
        }
      }

      // 2. Operational lock (Non-advisers)
      if (settings.lock_date_non_adviser) {
        const lockNonAdvStr = accountingDateKey(settings.lock_date_non_adviser);
        const isAdviser = options?.auth?.role === 'admin' || options?.auth?.role === 'super_admin';
        if (!isAdviser && dateStr <= lockNonAdvStr) {
          throw new BadRequestException(
            `الفترة المحاسبية مقفلة للعمليات التشغيلية حتى تاريخ ${lockNonAdvStr}. يرجى مراجعة الإدارة المالية.`,
          );
        }
      }

      // 3. Tax lock
      if (options?.isTaxOperation && settings.lock_date_tax) {
        const lockTaxStr = accountingDateKey(settings.lock_date_tax);
        if (dateStr <= lockTaxStr) {
          throw new BadRequestException(
            `الفترة الضريبية مقفلة حتى تاريخ ${lockTaxStr}. لا يمكن إجراء عمليات تؤثر على ضريبة هذه الفترة المغلقة.`,
          );
        }
      }
    }

    // 4. Monthly fiscal period lock (البند O6)
    const closedPeriod = await queryable
      .selectFrom('accounting_fiscal_periods')
      .select(['name', 'period_number'])
      .where('tenant_id', '=', tenantId)
      .where('status', '=', 'closed')
      .where('start_date', '<=', dateStr as any)
      .where('end_date', '>=', dateStr as any)
      .executeTakeFirst();

    if (closedPeriod) {
      throw new BadRequestException(
        `الفترة المحاسبية الشهرية [${closedPeriod.name}] مقفلة. لا يمكن إضافة أو تعديل قيود في فترة مغلقة.`,
      );
    }
  }
}
