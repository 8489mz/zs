import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { AuditLogRow, buildAuditPayload, buildTreasuryPayload, TreasurySummaryRow, TreasuryTransactionRow } from '../helpers/reports-ops.helper';
import { applyAuditSearch, applySignedAmountFilter, applyTreasurySearch } from '../helpers/reports-query-pipeline.helper';
import { buildReportListState } from '../helpers/reports-query.helper';
import { buildPagination, getBusinessDayBounds } from '../helpers/reports-range.helper';
import { getTenantTimezone } from '../../../common/utils/tenant-timezone.util';

@Injectable()
export class ReportsAdminService {
  constructor(@Inject(KYSELY_DB) private readonly db: Kysely<Database>) {}

  private tenantId(auth: AuthContext): string {
    return requireTenantScope(auth).tenantId;
  }

  private tenantPredicate(auth: AuthContext, alias?: string) {
    const tenantId = this.tenantId(auth);
    return alias
      ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}`
      : sql<boolean>`tenant_id = ${tenantId}`;
  }

  async treasuryTransactions(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const timezone = await getTenantTimezone(this.db, scope.tenantId);
    const { fromDate, toDate, searchPattern, filter, page, pageSize, offset } = buildReportListState(query, 25, { timezone });

    let countQuery = this.db
      .selectFrom('treasury_transactions as t')
      .leftJoin('branches as b', 'b.id', 't.branch_id')
      .leftJoin('stock_locations as l', 'l.id', 't.location_id')
      .leftJoin('users as u', 'u.id', 't.created_by')
      .where('t.created_at', '>=', fromDate!)
      .where('t.created_at', '<=', toDate!)
      .where(this.tenantPredicate(auth, 't'));

    let rowsQuery = this.db
      .selectFrom('treasury_transactions as t')
      .leftJoin('branches as b', 'b.id', 't.branch_id')
      .leftJoin('stock_locations as l', 'l.id', 't.location_id')
      .leftJoin('users as u', 'u.id', 't.created_by')
      .select(['t.id', 't.txn_type', 't.amount', 't.note', 't.reference_type', 't.reference_id', 't.branch_id', 't.location_id', 't.created_at', 'b.name as branch_name', 'l.name as location_name', 'u.username as created_by_name'])
      .where('t.created_at', '>=', fromDate!)
      .where('t.created_at', '<=', toDate!)
      .where(this.tenantPredicate(auth, 't'));

    let summaryQuery = this.db
      .selectFrom('treasury_transactions as t')
      .leftJoin('branches as b', 'b.id', 't.branch_id')
      .leftJoin('stock_locations as l', 'l.id', 't.location_id')
      .leftJoin('users as u', 'u.id', 't.created_by')
      .where('t.created_at', '>=', fromDate!)
      .where('t.created_at', '<=', toDate!)
      .where(this.tenantPredicate(auth, 't'));

    if (query.branchId) {
      const branchId = Number(query.branchId);
      countQuery = countQuery.where('t.branch_id', '=', branchId);
      rowsQuery = rowsQuery.where('t.branch_id', '=', branchId);
      summaryQuery = summaryQuery.where('t.branch_id', '=', branchId);
    }
    if (query.locationId) {
      const locationId = Number(query.locationId);
      countQuery = countQuery.where('t.location_id', '=', locationId);
      rowsQuery = rowsQuery.where('t.location_id', '=', locationId);
      summaryQuery = summaryQuery.where('t.location_id', '=', locationId);
    }

    countQuery = applyTreasurySearch(applySignedAmountFilter(countQuery, 't.amount', filter), searchPattern);
    rowsQuery = applyTreasurySearch(applySignedAmountFilter(rowsQuery, 't.amount', filter), searchPattern);
    summaryQuery = applyTreasurySearch(applySignedAmountFilter(summaryQuery, 't.amount', filter), searchPattern);

    const lastSeenId = Math.max(0, Number((query as Record<string, unknown>).lastSeenId || (query as Record<string, unknown>).lastId || (query as Record<string, unknown>).cursor || 0));
    if (lastSeenId > 0) {
      rowsQuery = rowsQuery.where('t.id', '<', lastSeenId);
    }

    const totalRow = await countQuery.select(sql<number>`count(*)`.as('count')).executeTakeFirst();
    const totalItems = Number((totalRow as { count?: number | string | null } | undefined)?.count || 0);
    const rows = await rowsQuery
      .orderBy('t.id', 'desc')
      .limit(pageSize)
      .offset(lastSeenId > 0 ? 0 : offset)
      .execute();
    const nextCursor = rows.length === pageSize ? String(rows[rows.length - 1].id) : null;

    const summaryRow = await summaryQuery
      .select([
        sql<number>`coalesce(sum(case when t.amount > 0 then t.amount else 0 end), 0)`.as('cash_in'),
        sql<number>`coalesce(sum(case when t.amount < 0 then t.amount else 0 end), 0)`.as('cash_out'),
        sql<number>`coalesce(sum(t.amount), 0)`.as('net_total'),
      ])
      .executeTakeFirst();

    return {
      ...buildTreasuryPayload({ rows: rows as TreasuryTransactionRow[], page, pageSize, totalItems, summaryRow: summaryRow as TreasurySummaryRow | null, nextCursor }),
      scope,
    };
  }

  async auditLogs(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    if (!auth.permissions.includes('audit') && auth.role !== 'super_admin') {
      throw new AppError('Missing required permissions', 'FORBIDDEN', 403);
    }
    const timezone = await getTenantTimezone(this.db, scope.tenantId);

    const { fromDate, toDate, searchPattern, page, pageSize, offset } = buildReportListState(query, 50, { defaultFilter: '', timezone });
    const selectedUserId = Number(query.userId || 0);
    const todayBounds = getBusinessDayBounds(new Date(), timezone);

    let countQuery = this.db.selectFrom('audit_logs as a').leftJoin('users as u', 'u.id', 'a.created_by').where('a.created_at', '>=', fromDate!).where('a.created_at', '<=', toDate!).where(this.tenantPredicate(auth, 'a'));
    let rowsQuery = this.db.selectFrom('audit_logs as a').leftJoin('users as u', 'u.id', 'a.created_by').select(['a.id', 'a.action', 'a.details', 'a.created_at', 'u.username']).where('a.created_at', '>=', fromDate!).where('a.created_at', '<=', toDate!).where(this.tenantPredicate(auth, 'a'));
    let distinctUsersQuery = this.db.selectFrom('audit_logs as a').leftJoin('users as u', 'u.id', 'a.created_by').where('a.created_at', '>=', fromDate!).where('a.created_at', '<=', toDate!).where(this.tenantPredicate(auth, 'a'));
    let todayCountQuery = this.db.selectFrom('audit_logs as a').leftJoin('users as u', 'u.id', 'a.created_by').where('a.created_at', '>=', todayBounds.start).where('a.created_at', '<=', todayBounds.end).where(this.tenantPredicate(auth, 'a'));

    countQuery = applyAuditSearch(countQuery, searchPattern);
    rowsQuery = applyAuditSearch(rowsQuery, searchPattern);
    distinctUsersQuery = applyAuditSearch(distinctUsersQuery, searchPattern);
    todayCountQuery = applyAuditSearch(todayCountQuery, searchPattern);

    if (selectedUserId > 0) {
      countQuery = countQuery.where('a.created_by', '=', selectedUserId);
      rowsQuery = rowsQuery.where('a.created_by', '=', selectedUserId);
      distinctUsersQuery = distinctUsersQuery.where('a.created_by', '=', selectedUserId);
      todayCountQuery = todayCountQuery.where('a.created_by', '=', selectedUserId);
    }

    const totalRow = await countQuery.select(sql<number>`count(*)`.as('count')).executeTakeFirst();
    const totalItems = Number((totalRow as { count?: number | string | null } | undefined)?.count || 0);
    const rows = await rowsQuery.orderBy('a.id', 'desc').limit(pageSize).offset(offset).execute();
    const distinctUsersRow = await distinctUsersQuery.select(sql<number>`count(distinct coalesce(u.username, 'guest'))`.as('count')).executeTakeFirst();
    const todayCountRow = await todayCountQuery.select(sql<number>`count(*)`.as('count')).executeTakeFirst();

    return {
      ...buildAuditPayload({
        rows: rows as AuditLogRow[],
        page,
        pageSize,
        totalItems,
        distinctUsers: Number((distinctUsersRow as { count?: number | string | null } | undefined)?.count || 0),
        todayCount: Number((todayCountRow as { count?: number | string | null } | undefined)?.count || 0),
      }),
      scope,
    };
  }

  async employeeSummary(query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    if (!auth.permissions.includes('reports') && auth.role !== 'super_admin') {
      throw new AppError('Missing required permissions', 'FORBIDDEN', 403);
    }
    const timezone = await getTenantTimezone(this.db, tenantId);

    const { fromDate, toDate, searchPattern, page, pageSize, offset } = buildReportListState(query, 20, { defaultFilter: '', timezone });
    const selectedUserId = Number(query.userId || 0);
    const roleFilter = String(query.role || '').trim().toLowerCase();
    const activityType = String(query.activityType || 'all').trim().toLowerCase();

    const searchClause = searchPattern ? sql` and (lower(coalesce(u.display_name, '')) like ${searchPattern} or lower(coalesce(u.username, '')) like ${searchPattern} or lower(coalesce(u.role, '')) like ${searchPattern})` : sql``;
    const selectedUserClause = selectedUserId > 0 ? sql` and u.id = ${selectedUserId}` : sql``;
    const roleClause = roleFilter ? sql` and lower(u.role) = ${roleFilter}` : sql``;
    const activityClause = activityType && activityType !== 'all' ? sql` and ${sql.ref(`${activityType === 'returns' ? 'returns' : activityType}_count`)} > 0` : sql``;

    const baseMetricsCte = sql`
      with sales_agg as (select created_by as user_id, count(*)::int as sales_count, coalesce(sum(total), 0)::numeric as sales_total, max(created_at) as last_sales_at from sales where tenant_id = ${tenantId} and created_at >= ${fromDate!} and created_at <= ${toDate!} and created_by is not null and status = 'posted' group by created_by),
      purchases_agg as (select created_by as user_id, count(*)::int as purchases_count, coalesce(sum(total), 0)::numeric as purchases_total, max(created_at) as last_purchases_at from purchases where tenant_id = ${tenantId} and created_at >= ${fromDate!} and created_at <= ${toDate!} and created_by is not null and status = 'posted' group by created_by),
      returns_agg as (select created_by as user_id, count(*)::int as returns_count, coalesce(sum(total), 0)::numeric as returns_total, max(created_at) as last_returns_at from return_documents where tenant_id = ${tenantId} and created_at >= ${fromDate!} and created_at <= ${toDate!} and created_by is not null group by created_by),
      expenses_agg as (select created_by as user_id, count(*)::int as expenses_count, coalesce(sum(amount), 0)::numeric as expenses_total, max(expense_date) as last_expenses_at from expenses where tenant_id = ${tenantId} and expense_date >= ${fromDate!} and expense_date <= ${toDate!} and created_by is not null group by created_by),
      audit_agg as (select created_by as user_id, count(*)::int as audit_count, max(created_at) as last_audit_at from audit_logs where tenant_id = ${tenantId} and created_at >= ${fromDate!} and created_at <= ${toDate!} and created_by is not null group by created_by),
      shifts_agg as (select opened_by as user_id, count(*)::int as shifts_count, sum(case when status = 'open' then 1 else 0 end)::int as open_shifts, max(created_at) as last_shift_at from cashier_shifts where tenant_id = ${tenantId} and created_at >= ${fromDate!} and created_at <= ${toDate!} group by opened_by),
      -- F13 (trial problem 18): per-user sales COGS, same shape as the
      -- summary helper (sale_items.qty x cost_price on posted sales,
      -- net of returned-items COGS via the same coalesce chain).
      sales_cogs_agg as (select s.created_by as user_id, coalesce(sum(si.qty * si.cost_price), 0)::numeric as sales_cogs from sale_items si inner join sales s on s.id = si.sale_id and s.tenant_id = si.tenant_id where s.tenant_id = ${tenantId} and s.created_at >= ${fromDate!} and s.created_at <= ${toDate!} and s.created_by is not null and s.status = 'posted' group by s.created_by),
      returned_cogs_agg as (select rd.created_by as user_id, coalesce(sum(ri.qty * coalesce(ri.cost_price, si.cost_price, p.cost_price, 0)), 0)::numeric as returned_cogs from return_items ri inner join return_documents rd on rd.id = ri.return_document_id and rd.tenant_id = ri.tenant_id left join sale_items si on si.id = ri.sale_item_id and si.tenant_id = ri.tenant_id left join products p on p.id = ri.product_id and p.tenant_id = ri.tenant_id where rd.tenant_id = ${tenantId} and rd.return_type = 'sale' and rd.created_at >= ${fromDate!} and rd.created_at <= ${toDate!} and rd.created_by is not null group by rd.created_by),
      employee_metrics as (
        select u.id, u.username, u.display_name, u.role, u.is_active,
        coalesce(sa.sales_count, 0) as sales_count, coalesce(sa.sales_total, 0) as sales_total,
        coalesce(pa.purchases_count, 0) as purchases_count, coalesce(pa.purchases_total, 0) as purchases_total,
        coalesce(ra.returns_count, 0) as returns_count, coalesce(ra.returns_total, 0) as returns_total,
        coalesce(ea.expenses_count, 0) as expenses_count, coalesce(ea.expenses_total, 0) as expenses_total,
        coalesce(aa.audit_count, 0) as audit_count, coalesce(sha.shifts_count, 0) as shifts_count, coalesce(sha.open_shifts, 0) as open_shifts,
        coalesce(sca.sales_cogs, 0) - coalesce(rca.returned_cogs, 0) as sales_cogs,
        coalesce(sa.sales_total, 0) - coalesce(ra.returns_total, 0) - (coalesce(sca.sales_cogs, 0) - coalesce(rca.returned_cogs, 0)) as sales_profit,
        greatest(coalesce(sa.last_sales_at, to_timestamp(0)), coalesce(pa.last_purchases_at, to_timestamp(0)), coalesce(ra.last_returns_at, to_timestamp(0)), coalesce(ea.last_expenses_at, to_timestamp(0)), coalesce(aa.last_audit_at, to_timestamp(0)), coalesce(sha.last_shift_at, to_timestamp(0)), coalesce(u.last_login_at, to_timestamp(0)), coalesce(u.created_at, to_timestamp(0))) as last_activity_at
        from users u
        left join sales_agg sa on sa.user_id = u.id
        left join purchases_agg pa on pa.user_id = u.id
        left join returns_agg ra on ra.user_id = u.id
        left join expenses_agg ea on ea.user_id = u.id
        left join audit_agg aa on aa.user_id = u.id
        left join shifts_agg sha on sha.user_id = u.id
        left join sales_cogs_agg sca on sca.user_id = u.id
        left join returned_cogs_agg rca on rca.user_id = u.id
        where u.tenant_id = ${tenantId} ${searchClause} ${selectedUserClause} ${roleClause}
      )`;

    const rowsResult = await sql<any>`${baseMetricsCte} select * from employee_metrics where 1 = 1 ${activityClause} order by last_activity_at desc, display_name asc, username asc limit ${pageSize} offset ${offset}`.execute(this.db);
    const summaryResult = await sql<any>`${baseMetricsCte} select count(*)::int as total_users, sum(case when is_active then 1 else 0 end)::int as active_users, sum(case when (sales_count + purchases_count + returns_count + expenses_count + audit_count + shifts_count) > 0 then 1 else 0 end)::int as users_with_activity, coalesce(sum(sales_total), 0)::numeric as total_sales, coalesce(sum(purchases_total), 0)::numeric as total_purchases, coalesce(sum(returns_total), 0)::numeric as total_returns, coalesce(sum(expenses_total), 0)::numeric as total_expenses, coalesce(sum(audit_count), 0)::int as total_audit_events, coalesce(sum(shifts_count), 0)::int as total_shifts, coalesce(sum(sales_cogs), 0)::numeric as total_sales_cogs, coalesce(sum(sales_profit), 0)::numeric as total_sales_profit from employee_metrics where 1 = 1 ${activityClause}`.execute(this.db);

    const countRow = summaryResult.rows?.[0] || {};
    const totalItems = Number(countRow.total_users || 0);
    const rows = (rowsResult.rows || []).map((row: any) => ({ id: String(row.id || ''), name: row.display_name || row.username || 'مستخدم', username: row.username || '', role: row.role || 'cashier', isActive: row.is_active !== false, salesCount: Number(row.sales_count || 0), salesTotal: Number(row.sales_total || 0), purchasesCount: Number(row.purchases_count || 0), purchasesTotal: Number(row.purchases_total || 0), returnsCount: Number(row.returns_count || 0), returnsTotal: Number(row.returns_total || 0), expensesCount: Number(row.expenses_count || 0), expensesTotal: Number(row.expenses_total || 0), auditCount: Number(row.audit_count || 0), shiftsCount: Number(row.shifts_count || 0), openShifts: Number(row.open_shifts || 0), salesCogs: Number(row.sales_cogs || 0), salesProfit: Number(row.sales_profit || 0), lastActivityAt: row.last_activity_at || null }));

    return {
      rows,
      summary: { totalUsers: Number(countRow.total_users || 0), activeUsers: Number(countRow.active_users || 0), usersWithActivity: Number(countRow.users_with_activity || 0), totalSales: Number(countRow.total_sales || 0), totalPurchases: Number(countRow.total_purchases || 0), totalReturns: Number(countRow.total_returns || 0), totalExpenses: Number(countRow.total_expenses || 0), totalAuditEvents: Number(countRow.total_audit_events || 0), totalShifts: Number(countRow.total_shifts || 0), totalSalesCogs: Number(countRow.total_sales_cogs || 0), totalSalesProfit: Number(countRow.total_sales_profit || 0) },
      pagination: buildPagination(page, pageSize, totalItems),
    };
  }

  async employeeDetails(userId: number, query: ReportRangeQueryDto, auth: AuthContext): Promise<Record<string, unknown>> {
    const { tenantId } = requireTenantScope(auth);
    if (!auth.permissions.includes('reports') && auth.role !== 'super_admin') throw new AppError('Missing required permissions', 'FORBIDDEN', 403);
    if (!(userId > 0)) throw new AppError('Invalid user', 'INVALID_USER_ID', 400);

    const summaryPayload = await this.employeeSummary({ ...query, userId, page: 1, pageSize: 1 }, auth) as { rows?: Array<Record<string, unknown>>; summary?: Record<string, unknown> };
    const employee = Array.isArray(summaryPayload.rows) ? summaryPayload.rows[0] : null;
    if (!employee) throw new AppError('User not found', 'USER_NOT_FOUND', 404);

    const { fromDate, toDate } = buildReportListState(query, 20, { defaultFilter: '', timezone: await getTenantTimezone(this.db, tenantId) });
    const limit = Math.min(100, Math.max(1, Number(query.limit || 25)));
    const activityType = String(query.activityType || 'all').trim().toLowerCase();
    const activityClause = activityType && activityType !== 'all' ? sql` and activity_type = ${activityType}` : sql``;

    const activitiesResult = await sql<any>`
      with activities as (
        select 'sale'::text as activity_type, concat('فاتورة بيع ', coalesce(s.doc_no, concat('#', s.id::text))) as title, nullif(s.note, '') as details, s.total::numeric as amount, s.created_at, coalesce(s.doc_no, concat('#', s.id::text)) as reference_label from sales s where s.tenant_id = ${tenantId} and s.created_by = ${userId} and s.status = 'posted' and s.created_at >= ${fromDate!} and s.created_at <= ${toDate!}
        union all
        select 'purchase'::text as activity_type, concat('فاتورة شراء ', coalesce(p.doc_no, concat('#', p.id::text))) as title, nullif(p.note, '') as details, p.total::numeric as amount, p.created_at, coalesce(p.doc_no, concat('#', p.id::text)) as reference_label from purchases p where p.tenant_id = ${tenantId} and p.created_by = ${userId} and p.status = 'posted' and p.created_at >= ${fromDate!} and p.created_at <= ${toDate!}
        union all
        select 'returns'::text as activity_type, concat('مرتجع ', coalesce(r.doc_no, concat('#', r.id::text))) as title, nullif(r.note, '') as details, r.total::numeric as amount, r.created_at, coalesce(r.doc_no, concat('#', r.id::text)) as reference_label from return_documents r where r.tenant_id = ${tenantId} and r.created_by = ${userId} and r.created_at >= ${fromDate!} and r.created_at <= ${toDate!}
        union all
        select 'expenses'::text as activity_type, concat('مصروف ', e.title) as title, nullif(e.note, '') as details, e.amount::numeric as amount, e.expense_date as created_at, concat('#', e.id::text) as reference_label from expenses e where e.tenant_id = ${tenantId} and e.created_by = ${userId} and e.expense_date >= ${fromDate!} and e.expense_date <= ${toDate!}
        union all
        select 'shifts'::text as activity_type, concat('فتح وردية ', coalesce(cs.doc_no, concat('#', cs.id::text))) as title, nullif(cs.opening_note, '') as details, cs.opening_cash::numeric as amount, cs.created_at, coalesce(cs.doc_no, concat('#', cs.id::text)) as reference_label from cashier_shifts cs where cs.tenant_id = ${tenantId} and cs.opened_by = ${userId} and cs.created_at >= ${fromDate!} and cs.created_at <= ${toDate!}
        union all
        select 'audit'::text as activity_type, a.action as title, nullif(a.details, '') as details, null::numeric as amount, a.created_at, concat('#', a.id::text) as reference_label from audit_logs a where a.tenant_id = ${tenantId} and a.created_by = ${userId} and a.created_at >= ${fromDate!} and a.created_at <= ${toDate!}
      ) select * from activities where 1 = 1 ${activityClause} order by created_at desc, reference_label desc limit ${limit}`.execute(this.db);

    return {
      employee,
      summary: summaryPayload.summary || {},
      activities: (activitiesResult.rows || []).map((row: any, index: number) => ({ id: `${row.activity_type || 'activity'}-${index}`, activityType: row.activity_type || 'audit', title: row.title || '', details: row.details || '', amount: row.amount == null ? null : Number(row.amount || 0), createdAt: row.created_at || '', referenceLabel: row.reference_label || '' })),
    };
  }
}
