import { Injectable } from '@nestjs/common';
import { Kysely, sql, type Transaction } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { boundedPage } from '../../../common/utils/bounded-page';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { Database } from '../../../database/database.types';
import { TransactionHelper } from '../../../database/helpers/transaction.helper';
import { CreateLeaveRequestDto, DecideLeaveRequestDto, UpsertLeaveTypeDto, UpsertHrMasterDataDto } from '../dto/hr.dto';
import {
  deductibleApprovedLeaveDays,
  shouldDeductLeaveFromBalance,
  type ApprovedLeaveDeductionRow,
} from '../engines/leave-balance.engine';
import { type RawBuilder } from 'kysely';
import { clean, toId, normalizeDateOnly, inclusiveDaysBetween, masterConfig, type MasterKind } from '../hr-helpers';

/**
 * HrLeaveService — slice H3 of the hr split.
 * Pure move of 16 methods from HrService (master data + holidays (6) and
 * leave types + leave requests (10)). No behavior change: the bodies are
 * byte-identical; the facade keeps thin delegates with the same names and
 * signatures for the 13 public methods. deductibleApprovedLeaveDaysByEmployee
 * and reconciledUsedAnnualLeaves are PUBLIC in this slice only (H1 bound
 * deps, prep §2.5) with NO facade delegate — the facade keeps no delegate
 * for them and H1 binds the slice methods at its merge. deductibleApproved-
 * LeaveDays stays PRIVATE (its only caller is reconciledUsedAnnualLeaves,
 * H3-internal). Deps: db + tx + audit, passed through as received (all
 * REQUIRED, no fallback); tenantPredicate is a bound kernel dep (stays a
 * real private method in the facade). Free helpers (clean, toId,
 * normalizeDateOnly, inclusiveDaysBetween, masterConfig, MasterKind) are
 * imported from ../hr-helpers — that file is created by the H0 merge and
 * does not exist on this generation tree yet; the import is still correct.
 * Date handling travels verbatim: listHolidays formats pg DATE reads as
 * ISO date strings (display only); no tenant-tz util is used by any moved
 * method and no clock pin travels with H3 (prep §7.3: the six source-text
 * specs repoint at H9/H7/H4/H11/H8, not H3).
 */

export interface HrLeaveDeps {
  db: Kysely<Database>;
  tx: TransactionHelper;
  audit: AuditService;
  tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;
}

@Injectable()
export class HrLeaveService {
  private readonly db: Kysely<Database>;
  private readonly tx: TransactionHelper;
  private readonly audit: AuditService;
  private readonly tenantPredicate: (auth: AuthContext, alias?: string) => RawBuilder<boolean>;

  constructor(deps: HrLeaveDeps) {
    this.db = deps.db;
    this.tx = deps.tx;
    this.audit = deps.audit;
    this.tenantPredicate = deps.tenantPredicate;
  }

  async listMasterData(
    kind: MasterKind,
    query: Record<string, unknown>,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const config = masterConfig[kind];
    const search = clean(query.search).toLowerCase();
    // INV-HR-ASSETS-LEAVE-SQL-PAGINATION: the search moves to SQL with
    // exact JS semantics (case-insensitive substring over name / code /
    // description / departmentName / jobTitleName — the last two are
    // always '' for non-positions rows, so only the positions branch
    // searches them). The page and the COUNT read the same base query;
    // internal callers (upsert/deactivate) still see page 1 of 50.
    const base =
      kind === 'positions'
        ? sql<Record<string, unknown>>`
          SELECT m.*, d.name AS department_name, j.name AS job_title_name, b.name AS branch_name, l.name AS location_name
          FROM hr_positions m
          LEFT JOIN hr_departments d ON d.id = m.department_id AND d.tenant_id = m.tenant_id
          LEFT JOIN hr_job_titles j ON j.id = m.job_title_id AND j.tenant_id = m.tenant_id
          LEFT JOIN branches b ON b.id = m.branch_id AND b.tenant_id = m.tenant_id
          LEFT JOIN stock_locations l ON l.id = m.location_id AND l.tenant_id = m.tenant_id
          WHERE ${this.tenantPredicate(auth, 'm')}
            AND (${search} = '' OR strpos(lower(btrim(COALESCE(m.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(m.code, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(m.description, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(d.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(j.name, ''))), ${search}) > 0)
        `
        : sql<Record<string, unknown>>`
          SELECT m.*
          FROM ${sql.table(config.table)} m
          WHERE ${this.tenantPredicate(auth, 'm')}
            AND (${search} = '' OR strpos(lower(btrim(COALESCE(m.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(m.code, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(m.description, ''))), ${search}) > 0)
        `;
    const totals = await sql<{ total: string }>`
      SELECT COUNT(*)::text AS total FROM (${base}) s
    `.execute(this.db);
    const totalItems = Number(totals.rows[0]?.total || 0);
    // Old in-memory pagination semantics preserved: defaultSize 50, page clamped
    // to [1, totalPages], totalPages = max(1, ceil(total / pageSize)).
    // The cap is now 200 (boundedPage), not 100.
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 50);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT * FROM (${base}) s
      ORDER BY s.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);
    const rows = result.rows.map((row) => ({
      id: String(row.id),
      loanId: row.reference_id ? String(row.reference_id) : '',
      referenceId: row.reference_id ? String(row.reference_id) : '',
      name: clean(row.name),
      code: clean(row.code),
      description: clean(row.description),
      departmentId: row.department_id ? String(row.department_id) : '',
      departmentName: clean(row.department_name),
      jobTitleId: row.job_title_id ? String(row.job_title_id) : '',
      jobTitleName: clean(row.job_title_name),
      branchId: row.branch_id ? String(row.branch_id) : '',
      branchName: clean(row.branch_name),
      locationId: row.location_id ? String(row.location_id) : '',
      locationName: clean(row.location_name),
      isActive: row.is_active !== false,
    }));
    return { rows, pagination: { page: safePage, pageSize, totalItems, totalPages }, summary: { totalItems } };
  }

  async upsertMasterData(
    kind: MasterKind,
    id: number | null,
    payload: UpsertHrMasterDataDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const config = masterConfig[kind];
    let insertedId: number | string | undefined;
    await this.tx.runInTransaction(this.db, async (trx) => {
      if (kind === 'positions') {
        if (id) {
          await sql`
            UPDATE hr_positions
            SET name = ${clean(payload.name)}, code = ${clean(payload.code)}, description = ${clean(payload.description)},
                department_id = ${toId(payload.departmentId)}, job_title_id = ${toId(payload.jobTitleId)},
                branch_id = ${toId(payload.branchId)}, location_id = ${toId(payload.locationId)},
                is_active = ${payload.isActive !== false}, updated_by = ${auth.userId}, updated_at = NOW()
            WHERE id = ${id} AND tenant_id = ${auth.tenantId}
          `.execute(trx);
        } else {
          const insertRes = await sql<{ id: number }>`
            INSERT INTO hr_positions (tenant_id, account_id, name, code, description, department_id, job_title_id, branch_id, location_id, is_active, created_by, updated_by)
            VALUES (${auth.tenantId}, ${auth.accountId}, ${clean(payload.name)}, ${clean(payload.code)}, ${clean(payload.description)}, ${toId(payload.departmentId)}, ${toId(payload.jobTitleId)}, ${toId(payload.branchId)}, ${toId(payload.locationId)}, ${payload.isActive !== false}, ${auth.userId}, ${auth.userId})
            RETURNING id
          `.execute(trx);
          insertedId = insertRes.rows[0]?.id;
        }
      } else {
        const table = sql.table(config.table);
        if (id) {
          await sql`
            UPDATE ${table}
            SET name = ${clean(payload.name)}, code = ${clean(payload.code)}, description = ${clean(payload.description)},
                is_active = ${payload.isActive !== false}, updated_by = ${auth.userId}, updated_at = NOW()
            WHERE id = ${id} AND tenant_id = ${auth.tenantId}
          `.execute(trx);
        } else {
          const insertRes = await sql<{ id: number }>`
            INSERT INTO ${table} (tenant_id, account_id, name, code, description, is_active, created_by, updated_by)
            VALUES (${auth.tenantId}, ${auth.accountId}, ${clean(payload.name)}, ${clean(payload.code)}, ${clean(payload.description)}, ${payload.isActive !== false}, ${auth.userId}, ${auth.userId})
            RETURNING id
          `.execute(trx);
          insertedId = insertRes.rows[0]?.id;
        }
      }
    });
    await this.audit.log(
      `${id ? 'Update' : 'Create'} ${config.auditName}`,
      `${config.auditName} saved by ${auth.username}`,
      auth,
    );
    const list = await this.listMasterData(kind, {}, auth);
    const finalId = String(insertedId || id || '');
    const rows = (list && Array.isArray((list as any).rows) ? (list as any).rows : []) as any[];
    const foundItem = rows.find((r) => String(r.id) === finalId) || rows[0];
    return { ok: true, id: finalId, item: foundItem, ...(list as any) };
  }

  async deactivateMasterData(kind: MasterKind, id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    const config = masterConfig[kind];
    await sql`UPDATE ${sql.table(config.table)} SET is_active = FALSE, updated_by = ${auth.userId}, updated_at = NOW() WHERE id = ${id} AND tenant_id = ${auth.tenantId}`.execute(
      this.db,
    );
    await this.audit.log(`Deactivate ${config.auditName}`, `${config.auditName} deactivated by ${auth.username}`, auth);
    return { ok: true, ...(await this.listMasterData(kind, {}, auth)) };
  }

  async listHolidays(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const search = clean(query.search).toLowerCase();
    // INV-HR-ASSETS-LEAVE-SQL-PAGINATION: the name search moves to SQL;
    // the ORDER BY gains an id DESC tiebreaker — the old single-query
    // order for same-start_date rows was unspecified, and paged queries
    // need the determinism.
    const totals = await sql<{ total: string }>`
      SELECT COUNT(*)::text AS total FROM hr_holidays
      WHERE ${this.tenantPredicate(auth)}
        AND (${search} = '' OR strpos(lower(btrim(name)), ${search}) > 0)
    `.execute(this.db);
    const totalItems = Number(totals.rows[0]?.total || 0);
    // Old in-memory pagination semantics preserved: defaultSize 50, page clamped
    // to [1, totalPages], totalPages = max(1, ceil(total / pageSize)).
    // The cap is now 200 (boundedPage), not 100.
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 50);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT * FROM hr_holidays
      WHERE ${this.tenantPredicate(auth)}
        AND (${search} = '' OR strpos(lower(btrim(name)), ${search}) > 0)
      ORDER BY start_date DESC, id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);

    const rows = result.rows.map((row) => ({
      id: String(row.id),
      name: clean(row.name),
      startDate: row.start_date ? new Date(row.start_date as string).toISOString().split('T')[0] : '',
      endDate: row.end_date ? new Date(row.end_date as string).toISOString().split('T')[0] : '',
    }));

    return { rows, pagination: { page: safePage, pageSize, totalItems, totalPages }, summary: { totalItems } };
  }

  async upsertHoliday(id: number | null, payload: any, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    if (id) {
      await sql`
        UPDATE hr_holidays
        SET name = ${clean(payload.name)}, start_date = ${payload.startDate}, end_date = ${payload.endDate},
            updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND ${this.tenantPredicate(auth)}
      `.execute(this.db);
    } else {
      await sql`
        INSERT INTO hr_holidays (tenant_id, account_id, name, start_date, end_date, created_by, updated_by)
        VALUES (${auth.tenantId}, ${auth.accountId}, ${clean(payload.name)}, ${payload.startDate}, ${payload.endDate}, ${auth.userId}, ${auth.userId})
      `.execute(this.db);
    }
    return { ok: true };
  }

  async deleteHoliday(id: number, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    await sql`DELETE FROM hr_holidays WHERE id = ${id} AND ${this.tenantPredicate(auth)}`.execute(this.db);
    return { ok: true };
  }

  async listLeaveTypes(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const search = clean(query.search).toLowerCase();
    // INV-HR-ASSETS-LEAVE-SQL-PAGINATION: the search moves to SQL and
    // the activeCount stays exact over the FULL filtered set — a NULL
    // is_active counts as active (IS DISTINCT FROM FALSE, the SQL form
    // of the JS `!== false`).
    const totals = await sql<{ total: string; active: string }>`
      SELECT COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE is_active IS DISTINCT FROM FALSE)::text AS active
      FROM hr_leave_types
      WHERE tenant_id = ${auth.tenantId}
        AND (${search} = '' OR strpos(lower(btrim(COALESCE(name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(code, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(description, ''))), ${search}) > 0)
    `.execute(this.db);
    const totalItems = Number(totals.rows[0]?.total || 0);
    // Old in-memory pagination semantics preserved: defaultSize 50, page clamped
    // to [1, totalPages], totalPages = max(1, ceil(total / pageSize)).
    // The cap is now 200 (boundedPage), not 100.
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 50);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT *
      FROM hr_leave_types
      WHERE tenant_id = ${auth.tenantId}
        AND (${search} = '' OR strpos(lower(btrim(COALESCE(name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(code, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(description, ''))), ${search}) > 0)
      ORDER BY is_active DESC, name ASC, id ASC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);
    const rows = result.rows.map((row) => ({
      id: String(row.id),
      name: clean(row.name),
      code: clean(row.code),
      description: clean(row.description),
      isPaid: row.is_paid !== false,
      // INV-LEAVE-BALANCE-DEDUCTION: the settings form shows this flag,
      // so an admin can see and change whether the type deducts.
      deductsFromBalance: row.deducts_from_balance === true,
      isActive: row.is_active !== false,
    }));
    return {
      rows,
      pagination: { page: safePage, pageSize, totalItems, totalPages },
      summary: {
        totalItems,
        activeCount: Number(totals.rows[0]?.active || 0),
      },
    };
  }

  async upsertLeaveType(
    id: number | null,
    payload: UpsertLeaveTypeDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const name = clean(payload.name);
    if (!name) throw new AppError('Leave type name is required', 'HR_LEAVE_TYPE_NAME_REQUIRED', 400);
    const code = clean(payload.code).toLowerCase();
    const description = clean(payload.description);
    const isPaid = payload.isPaid !== false;
    const isActive = payload.isActive !== false;
    const deductsFromBalance =
      (payload as any).deductsFromBalance === true || (payload as any).deducts_from_balance === true;
    if (id) {
      await sql`
        UPDATE hr_leave_types
        SET name = ${name}, code = ${code || null}, description = ${description || null}, is_paid = ${isPaid}, is_active = ${isActive}, deducts_from_balance = ${deductsFromBalance}, updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${auth.tenantId}
      `.execute(this.db);
    } else {
      await sql`
        INSERT INTO hr_leave_types (tenant_id, account_id, name, deducts_from_balance, code, description, is_paid, is_active, created_by, updated_by, created_at, updated_at)
        VALUES (${auth.tenantId}, ${auth.accountId}, ${name}, ${deductsFromBalance}, ${code || null}, ${description || null}, ${isPaid}, ${isActive}, ${auth.userId}, ${auth.userId}, NOW(), NOW())
      `.execute(this.db);
    }
    await this.audit.log(
      `${id ? 'Update' : 'Create'} HR leave type`,
      `Leave type ${name} saved by ${auth.username}`,
      auth,
    );
    return this.listLeaveTypes({}, auth);
  }

  async listLeaveRequests(query: Record<string, unknown>, auth: AuthContext): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    const search = clean(query.search).toLowerCase();
    const status = clean(query.status).toLowerCase();
    const employeeId = toId(query.employeeId);
    const from = normalizeDateOnly(query.from);
    const to = normalizeDateOnly(query.to);

    // INV-HR-ASSETS-LEAVE-SQL-PAGINATION: the filters (employee / status /
    // from / to / search) and the status-count summary move to SQL with
    // exact JS semantics — end_date >= from, start_date <= to (both
    // columns are NOT NULL in production), the status filter matches the
    // RAW trimmed stored value against the LOWERCASED query, and the
    // summary stays exact over the FULL filtered set, never page-scoped.
    const employeeFilter = employeeId ? sql<boolean>`r.employee_id = ${employeeId}` : sql<boolean>`1=1`;
    const statusFilter = status ? sql<boolean>`btrim(r.status) = ${status}` : sql<boolean>`1=1`;
    const fromFilter = from ? sql<boolean>`r.end_date >= ${from}::date` : sql<boolean>`1=1`;
    const toFilter = to ? sql<boolean>`r.start_date <= ${to}::date` : sql<boolean>`1=1`;
    const searchFilter = search
      ? sql<boolean>`strpos(lower(btrim(COALESCE(e.employee_no, ''))), ${search}) > 0 OR strpos(lower(btrim(e.display_name)), ${search}) > 0 OR strpos(lower(btrim(COALESCE(d.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(j.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(t.name, ''))), ${search}) > 0 OR strpos(lower(btrim(COALESCE(r.leave_type, ''))), ${search}) > 0`
      : sql<boolean>`1=1`;
    const totals = await sql<{ total: string; pending: string; approved: string; rejected: string; cancelled: string }>`
      SELECT COUNT(*)::text AS total,
        COUNT(*) FILTER (WHERE btrim(r.status) = 'pending')::text AS pending,
        COUNT(*) FILTER (WHERE btrim(r.status) = 'approved')::text AS approved,
        COUNT(*) FILTER (WHERE btrim(r.status) = 'rejected')::text AS rejected,
        COUNT(*) FILTER (WHERE btrim(r.status) = 'cancelled')::text AS cancelled
      FROM hr_leave_requests r
      JOIN hr_employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = r.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id AND j.tenant_id = r.tenant_id
      LEFT JOIN hr_leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${auth.tenantId}
        AND ${employeeFilter} AND ${statusFilter} AND ${fromFilter} AND ${toFilter} AND ${searchFilter}
    `.execute(this.db);
    const totalItems = Number(totals.rows[0]?.total || 0);
    // Old in-memory pagination semantics preserved: defaultSize 25, page clamped
    // to [1, totalPages], totalPages = max(1, ceil(total / pageSize)).
    // The cap is now 200 (boundedPage), not 100.
    const { page, pageSize } = boundedPage(query.page, query.pageSize, 200, 25);
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    const safePage = Math.min(page, totalPages);
    const offset = (safePage - 1) * pageSize;
    const result = await sql<Record<string, unknown>>`
      SELECT
        r.*,
        e.employee_no,
        e.display_name AS employee_name,
        d.name AS department_name,
        j.name AS job_title_name,
        t.name AS leave_type_name,
        to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
        to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text,
        to_char(r.decided_at, 'YYYY-MM-DD HH24:MI') AS decided_at_text,
        to_char(r.created_at, 'YYYY-MM-DD HH24:MI') AS created_at_text
      FROM hr_leave_requests r
      JOIN hr_employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
      LEFT JOIN hr_departments d ON d.id = e.department_id AND d.tenant_id = e.tenant_id AND d.tenant_id = r.tenant_id
      LEFT JOIN hr_job_titles j ON j.id = e.job_title_id AND j.tenant_id = e.tenant_id AND j.tenant_id = r.tenant_id
      LEFT JOIN hr_leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
      WHERE r.tenant_id = ${auth.tenantId}
        AND ${employeeFilter} AND ${statusFilter} AND ${fromFilter} AND ${toFilter} AND ${searchFilter}
      ORDER BY r.created_at DESC, r.id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `.execute(this.db);

    const rows = result.rows.map((row) => ({
      id: String(row.id),
      employeeId: String(row.employee_id),
      employeeNo: clean(row.employee_no),
      employeeName: clean(row.employee_name),
      departmentName: clean(row.department_name),
      jobTitleName: clean(row.job_title_name),
      leaveTypeId: row.leave_type_id ? String(row.leave_type_id) : '',
      leaveTypeName: clean(row.leave_type_name),
      leaveType: clean(row.leave_type),
      startDate: clean(row.start_date_text),
      endDate: clean(row.end_date_text),
      daysCount: Number(row.days_count || 0),
      status: clean(row.status),
      reason: clean(row.reason),
      notes: clean(row.notes),
      decisionNotes: clean(row.decision_notes),
      decidedBy: row.decided_by ? String(row.decided_by) : '',
      decidedAt: clean(row.decided_at_text),
      createdAt: clean(row.created_at_text),
    }));

    const summary = {
      totalItems,
      pendingCount: Number(totals.rows[0]?.pending || 0),
      approvedCount: Number(totals.rows[0]?.approved || 0),
      rejectedCount: Number(totals.rows[0]?.rejected || 0),
      cancelledCount: Number(totals.rows[0]?.cancelled || 0),
    };

    return { requests: rows, pagination: { page: safePage, pageSize, totalItems, totalPages }, summary };
  }

  /**
   * INV-LEAVE-BALANCE-NOT-DEDUCTING: the deductible days inside an
   * employee's APPROVED requests, under the one shared rule
   * (leave-balance.engine). The stored `used_annual_leaves` counter
   * alone cannot be trusted: approvals posted before the forward
   * deduction existed never moved it. Reads take the MAX of the
   * stored counter and this sum — never less, so a cancellation
   * (which releases through its own decrement, and drops the request
   * out of this sum at the same time) can never be resurrected.
   * Runs on the caller's executor (open transaction or pool handle)
   * so approval/cancellation read their own uncommitted state.
   */
  private async deductibleApprovedLeaveDays(
    executor: Kysely<Database> | Transaction<Database>,
    employeeId: number,
    tenantId: string,
  ): Promise<number> {
    const result = await sql<{
      days_count: number | null;
      leave_type_id: number | null;
      leave_type: string | null;
      leave_type_code: string | null;
      leave_type_name: string | null;
      deducts_from_balance: boolean | null;
    }>`
      SELECT
        lr.days_count,
        lr.leave_type_id,
        lr.leave_type,
        t.code AS leave_type_code,
        t.name AS leave_type_name,
        t.deducts_from_balance
      FROM hr_leave_requests lr
      LEFT JOIN hr_leave_types t ON t.id = lr.leave_type_id AND t.tenant_id = lr.tenant_id
      WHERE lr.employee_id = ${employeeId} AND lr.tenant_id = ${tenantId}
        AND lr.status = 'approved'
    `.execute(executor);
    const rows: ApprovedLeaveDeductionRow[] = result.rows.map((row) => ({
      daysCount: row.days_count,
      leaveTypeId: row.leave_type_id,
      leaveTypeCode: row.leave_type_code,
      leaveTypeName: row.leave_type_name,
      leaveTypeText: row.leave_type,
      deductsFromBalance: row.deducts_from_balance,
    }));
    return deductibleApprovedLeaveDays(rows);
  }

  async deductibleApprovedLeaveDaysByEmployee(employeeIds: number[], tenantId: string): Promise<Map<number, number>> {
    const totals = new Map<number, number>();
    if (!employeeIds.length) return totals;
    const result = await sql<{
      employee_id: number;
      days_count: number | null;
      leave_type_id: number | null;
      leave_type: string | null;
      leave_type_code: string | null;
      leave_type_name: string | null;
      deducts_from_balance: boolean | null;
    }>`
      SELECT
        lr.employee_id,
        lr.days_count,
        lr.leave_type_id,
        lr.leave_type,
        t.code AS leave_type_code,
        t.name AS leave_type_name,
        t.deducts_from_balance
      FROM hr_leave_requests lr
      LEFT JOIN hr_leave_types t ON t.id = lr.leave_type_id AND t.tenant_id = lr.tenant_id
      WHERE lr.tenant_id = ${tenantId} AND lr.status = 'approved'
    `.execute(this.db);
    const byEmployee = new Map<number, ApprovedLeaveDeductionRow[]>();
    for (const row of result.rows) {
      const id = Number(row.employee_id);
      if (!employeeIds.includes(id)) continue;
      const list = byEmployee.get(id) || [];
      list.push({
        daysCount: row.days_count,
        leaveTypeId: row.leave_type_id,
        leaveTypeCode: row.leave_type_code,
        leaveTypeName: row.leave_type_name,
        leaveTypeText: row.leave_type,
        deductsFromBalance: row.deducts_from_balance,
      });
      byEmployee.set(id, list);
    }
    for (const [id, rows] of byEmployee) totals.set(id, deductibleApprovedLeaveDays(rows));
    return totals;
  }

  /**
   * INV-LEAVE-BALANCE-NOT-DEDUCTING: the true used days for one
   * employee — the stored counter reconciled against the approved
   * requests. Every balance read and every approval/cancellation
   * must use this, never the stored counter raw.
   */
  async reconciledUsedAnnualLeaves(
    executor: Kysely<Database> | Transaction<Database>,
    employeeId: number,
    tenantId: string,
    storedUsed: number,
  ): Promise<number> {
    const approved = await this.deductibleApprovedLeaveDays(executor, employeeId, tenantId);
    return Number(Math.max(Number(storedUsed || 0), approved).toFixed(2));
  }

  async createLeaveRequest(payload: CreateLeaveRequestDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    const employeeId = toId(payload.employeeId);
    if (!employeeId) throw new AppError('Employee is required', 'HR_LEAVE_EMPLOYEE_REQUIRED', 400);
    const startDate = normalizeDateOnly(payload.startDate);
    const endDate = normalizeDateOnly(payload.endDate);
    if (!startDate || !endDate || endDate < startDate) {
      throw new AppError('Leave date range is invalid', 'HR_LEAVE_DATE_RANGE_INVALID', 400);
    }
    const computedDays = inclusiveDaysBetween(startDate, endDate);
    const daysCount = payload.daysCount == null ? computedDays : Number(payload.daysCount);
    if (!Number.isFinite(daysCount) || daysCount <= 0 || daysCount > computedDays) {
      throw new AppError(
        'عدد أيام الإجازة يجب أن يكون موجباً ولا يتجاوز الفترة المحددة',
        'HR_LEAVE_DAYS_COUNT_INVALID',
        400,
      );
    }
    const leaveTypeId = toId(payload.leaveTypeId);
    const leaveType = clean(payload.leaveType);
    await this.tx.runInTransaction(this.db, async (trx) => {
      // All requests for the same employee lock the same row. That prevents two
      // concurrent requests from both seeing an empty overlapping interval.
      const employee = await sql<{ id: number; hire_date: string | null; end_date: string | null }>`
        SELECT id, to_char(hire_date, 'YYYY-MM-DD') AS hire_date,
               to_char(end_of_service_date, 'YYYY-MM-DD') AS end_date
        FROM hr_employees
        WHERE id = ${employeeId} AND tenant_id = ${tenantId}
        FOR UPDATE
      `.execute(trx);
      const activeService = employee.rows[0];
      if (!activeService) throw new AppError('Employee not found', 'HR_LEAVE_EMPLOYEE_REQUIRED', 404);
      if (
        (activeService.hire_date && startDate < activeService.hire_date) ||
        (activeService.end_date && endDate > activeService.end_date)
      ) {
        throw new AppError('تواريخ الإجازة خارج مدة خدمة الموظف المعتمدة', 'HR_LEAVE_OUTSIDE_EMPLOYMENT', 409);
      }
      if (leaveTypeId) {
        const typeCheck = await sql<{ id: number }>`
          SELECT id FROM hr_leave_types WHERE id = ${leaveTypeId} AND tenant_id = ${tenantId}
        `.execute(trx);
        if (!typeCheck.rows.length) throw new AppError('Leave type is invalid', 'HR_LEAVE_TYPE_INVALID', 400);
      }
      const overlap = await sql<{ id: number }>`
        SELECT id FROM hr_leave_requests
        WHERE tenant_id = ${tenantId} AND employee_id = ${employeeId}
          AND status IN ('pending', 'approved')
          AND start_date <= ${endDate}::date AND end_date >= ${startDate}::date
        LIMIT 1
      `.execute(trx);
      if (overlap.rows.length) {
        throw new AppError(
          'يوجد طلب إجازة قائم يغطي يومًا أو أكثر من الفترة المحددة',
          'HR_LEAVE_OVERLAPPING_REQUEST',
          409,
        );
      }
      await sql`
        INSERT INTO hr_leave_requests (
          tenant_id, account_id, employee_id, leave_type_id, leave_type,
          start_date, end_date, days_count, status, reason, notes,
          created_by, updated_by, created_at, updated_at
        ) VALUES (
          ${tenantId}, ${auth.accountId}, ${employeeId}, ${leaveTypeId}, ${leaveType || null},
          ${startDate}::date, ${endDate}::date, ${Number(daysCount.toFixed(2))},
          'pending', ${clean(payload.reason) || null}, ${clean(payload.notes) || null},
          ${auth.userId}, ${auth.userId}, NOW(), NOW()
        )
      `.execute(trx);
    });
    await this.audit.log(
      'Create HR leave request',
      `Leave request created for employee #${employeeId} by ${auth.username}`,
      auth,
    );
    return this.listLeaveRequests({}, auth);
  }

  async approveLeaveRequest(
    id: number,
    payload: DecideLeaveRequestDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const current = await sql<{
        id: number;
        status: string;
        employee_id: number;
        days_count: number;
        start_date_text: string;
        end_date_text: string;
        leave_type_id: number | null;
        leave_type: string | null;
        leave_type_code: string | null;
        leave_type_name: string | null;
        deducts_from_balance: boolean | null;
        annual_leave_balance: number | null;
        used_annual_leaves: number | null;
      }>`
        SELECT
          r.id,
          r.status,
          r.employee_id,
          r.days_count,
          to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
          to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text,
          r.leave_type_id,
          r.leave_type,
          t.code AS leave_type_code,
          t.name AS leave_type_name,
          t.deducts_from_balance,
          e.annual_leave_balance,
          e.used_annual_leaves
        FROM hr_leave_requests r
        JOIN hr_employees e ON e.id = r.employee_id AND e.tenant_id = r.tenant_id
        LEFT JOIN hr_leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
        WHERE r.id = ${id} AND r.tenant_id = ${auth.tenantId}
        LIMIT 1
        FOR UPDATE OF r, e
      `.execute(trx);

      const row = current.rows[0];
      if (!row) throw new AppError('Leave request not found', 'HR_LEAVE_REQUEST_NOT_FOUND', 404);
      const status = clean(row.status);
      if (status === 'approved') return;
      if (['cancelled', 'rejected'].includes(status))
        throw new AppError('Cannot approve this leave request', 'HR_LEAVE_APPROVE_LOCKED', 400);

      const booked = await sql<{ id: number }>`
        SELECT r.id FROM hr_payroll_runs r
        JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
        WHERE r.tenant_id = ${auth.tenantId} AND i.employee_id = ${row.employee_id}
          AND r.status IN ('approved', 'paid') AND i.status = 'approved'
          AND r.start_date <= ${row.end_date_text}::date AND r.end_date >= ${row.start_date_text}::date
        LIMIT 1
      `.execute(trx);
      if (booked.rows.length) {
        throw new AppError(
          'إجازة تقع ضمن مسير مرتبات معتمد؛ يلزم تسوية مالية مستقلة',
          'HR_LEAVE_POSTED_PAYROLL_LOCKED',
          409,
        );
      }
      // INV-LEAVE-BALANCE-DEDUCTION: one shared rule (leave-balance.engine)
      // decides whether the approval moves the stored balance, so the
      // profile and end-of-service can never disagree again. An annual
      // leave deducts even when its type row still stores the false flag
      // the old settings form could never set.
      const deductsFromBalance = shouldDeductLeaveFromBalance({
        deductsFromBalance: row.deducts_from_balance,
        leaveTypeId: row.leave_type_id,
        leaveTypeCode: row.leave_type_code,
        leaveTypeName: row.leave_type_name,
        leaveTypeText: row.leave_type,
      });

      const requestedDays = Number(row.days_count || 0);
      if (deductsFromBalance && requestedDays > 0) {
        const totalEntitlement = Number(row.annual_leave_balance || 0);
        // INV-LEAVE-BALANCE-NOT-DEDUCTING: the guard and the
        // increment both run on the reconciled used days — a stale
        // stored counter must neither hide used days nor let an
        // approval exceed the entitlement.
        const currentUsed = await this.reconciledUsedAnnualLeaves(
          trx,
          row.employee_id,
          String(auth.tenantId || ''),
          Number(row.used_annual_leaves || 0),
        );
        const remainingBalance = Number((totalEntitlement - currentUsed).toFixed(2));

        if (requestedDays > remainingBalance) {
          throw new AppError(
            `رصيد الإجازات المتبقي (${remainingBalance} يوم) لا يكفي لتغطية الإجازة المطلوبة (${requestedDays} يوم)`,
            'HR_LEAVE_INSUFFICIENT_BALANCE',
            400,
          );
        }

        await sql`
          UPDATE hr_employees
          SET used_annual_leaves = ${Number((currentUsed + requestedDays).toFixed(2))},
              updated_at = NOW()
          WHERE id = ${row.employee_id} AND tenant_id = ${auth.tenantId}
        `.execute(trx);
      }

      await sql`
        UPDATE hr_leave_requests
        SET status = 'approved',
            decision_notes = ${clean(payload.decisionNotes) || null},
            notes = ${clean(payload.notes) || null},
            decided_by = ${auth.userId},
            decided_at = NOW(),
            updated_by = ${auth.userId},
            updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${auth.tenantId}
      `.execute(trx);
    });
    await this.audit.log('Approve HR leave request', `Leave request #${id} approved by ${auth.username}`, auth);
    return this.listLeaveRequests({}, auth);
  }

  async rejectLeaveRequest(
    id: number,
    payload: DecideLeaveRequestDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      // Approval/cancellation and rejection must serialize over the same leave
      // row AND payroll lock. The old unguarded UPDATE could reject an already
      // approved leave without releasing its annual-leave balance.
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + tenantId}))`.execute(trx);
      const current = await sql<{ status: string }>`
        SELECT status FROM hr_leave_requests
        WHERE id = ${id} AND tenant_id = ${tenantId} LIMIT 1 FOR UPDATE
      `.execute(trx);
      const status = clean(current.rows[0]?.status);
      if (!status) throw new AppError('Leave request not found', 'HR_LEAVE_REQUEST_NOT_FOUND', 404);
      if (['cancelled', 'approved'].includes(status)) {
        throw new AppError('Cannot reject this leave request', 'HR_LEAVE_REJECT_LOCKED', 409);
      }
      await sql`
        UPDATE hr_leave_requests
        SET status = 'rejected', decision_notes = ${clean(payload.decisionNotes) || null},
            notes = ${clean(payload.notes) || null}, decided_by = ${auth.userId},
            decided_at = NOW(), updated_by = ${auth.userId}, updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${tenantId} AND status = ${status}
      `.execute(trx);
    });
    await this.audit.log('Reject HR leave request', `Leave request #${id} rejected by ${auth.username}`, auth);
    return this.listLeaveRequests({}, auth);
  }

  async cancelLeaveRequest(
    id: number,
    payload: DecideLeaveRequestDto,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    requireTenantScope(auth);
    await this.tx.runInTransaction(this.db, async (trx) => {
      await sql`SELECT pg_advisory_xact_lock(hashtext(${'hr-payroll:' + auth.tenantId}))`.execute(trx);
      const current = await sql<{
        id: number;
        status: string;
        employee_id: number;
        days_count: number;
        start_date_text: string;
        end_date_text: string;
        leave_type_id: number | null;
        leave_type: string | null;
        leave_type_code: string | null;
        leave_type_name: string | null;
        deducts_from_balance: boolean | null;
      }>`
        SELECT
          r.id,
          r.status,
          r.employee_id,
          r.days_count,
          to_char(r.start_date, 'YYYY-MM-DD') AS start_date_text,
          to_char(r.end_date, 'YYYY-MM-DD') AS end_date_text,
          r.leave_type_id,
          r.leave_type,
          t.code AS leave_type_code,
          t.name AS leave_type_name,
          t.deducts_from_balance
        FROM hr_leave_requests r
        LEFT JOIN hr_leave_types t ON t.id = r.leave_type_id AND t.tenant_id = r.tenant_id
        WHERE r.id = ${id} AND r.tenant_id = ${auth.tenantId}
        LIMIT 1
        FOR UPDATE OF r
      `.execute(trx);

      const row = current.rows[0];
      if (!row) throw new AppError('Leave request not found', 'HR_LEAVE_REQUEST_NOT_FOUND', 404);
      const status = clean(row.status);
      if (status === 'cancelled') return;

      const wasApproved = status === 'approved';
      if (wasApproved) {
        const booked = await sql<{ id: number }>`
          SELECT r.id FROM hr_payroll_runs r
          JOIN hr_payroll_run_items i ON i.run_id = r.id AND i.tenant_id = r.tenant_id
          WHERE r.tenant_id = ${auth.tenantId} AND i.employee_id = ${row.employee_id}
            AND r.status IN ('approved', 'paid') AND i.status = 'approved'
            AND r.start_date <= ${row.end_date_text}::date AND r.end_date >= ${row.start_date_text}::date
          LIMIT 1
        `.execute(trx);
        if (booked.rows.length) {
          throw new AppError(
            'إجازة تقع ضمن مسير مرتبات معتمد؛ يلزم تسوية مالية مستقلة',
            'HR_LEAVE_POSTED_PAYROLL_LOCKED',
            409,
          );
        }
      }
      // INV-LEAVE-BALANCE-DEDUCTION: the same shared rule as approval,
      // so a cancellation releases exactly the days its approval deducted.
      const deductsFromBalance = shouldDeductLeaveFromBalance({
        deductsFromBalance: row.deducts_from_balance,
        leaveTypeId: row.leave_type_id,
        leaveTypeCode: row.leave_type_code,
        leaveTypeName: row.leave_type_name,
        leaveTypeText: row.leave_type,
      });

      const requestedDays = Number(row.days_count || 0);
      if (wasApproved && deductsFromBalance && requestedDays > 0) {
        // INV-LEAVE-BALANCE-NOT-DEDUCTING: release from the
        // reconciled used days. The request is still 'approved'
        // here, so the reconcile still counts it — subtracting its
        // days yields exactly the post-cancellation balance, and the
        // stored counter can never go below the true used days.
        const stored = await sql<{ used_annual_leaves: number | null }>`
          SELECT used_annual_leaves FROM hr_employees
          WHERE id = ${row.employee_id} AND tenant_id = ${auth.tenantId}
          FOR UPDATE
        `.execute(trx);
        const currentUsed = await this.reconciledUsedAnnualLeaves(
          trx,
          row.employee_id,
          String(auth.tenantId || ''),
          Number(stored.rows[0]?.used_annual_leaves || 0),
        );
        await sql`
          UPDATE hr_employees
          SET used_annual_leaves = ${Number(Math.max(0, currentUsed - requestedDays).toFixed(2))},
              updated_at = NOW()
          WHERE id = ${row.employee_id} AND tenant_id = ${auth.tenantId}
        `.execute(trx);
      }

      await sql`
        UPDATE hr_leave_requests
        SET status = 'cancelled',
            decision_notes = ${clean(payload.decisionNotes) || null},
            notes = ${clean(payload.notes) || null},
            decided_by = ${auth.userId},
            decided_at = NOW(),
            updated_by = ${auth.userId},
            updated_at = NOW()
        WHERE id = ${id} AND tenant_id = ${auth.tenantId}
      `.execute(trx);
    });
    await this.audit.log('Cancel HR leave request', `Leave request #${id} cancelled by ${auth.username}`, auth);
    return this.listLeaveRequests({}, auth);
  }
}
