import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { getPagination, parseRange } from './reports-range.helper';
import { sql } from '../../../database/kysely';

export function applyReportScopeFilter<T extends object>(queryBuilder: T, query: ReportRangeQueryDto, tableAlias?: string): T {
  let qb: any = queryBuilder;
  const branchCol = tableAlias ? `${tableAlias}.branch_id` : 'branch_id';
  const locCol = tableAlias ? `${tableAlias}.location_id` : 'location_id';
  const userCol = tableAlias ? `${tableAlias}.created_by` : 'created_by';

  if (query.branchId != null) {
    const branchIdNum = Number(query.branchId);
    if (Number.isFinite(branchIdNum) && branchIdNum > 0) {
      qb = qb.where(sql.ref(branchCol), '=', branchIdNum);
    }
  }
  if (query.locationId != null) {
    const locIdNum = Number(query.locationId);
    if (Number.isFinite(locIdNum) && locIdNum > 0) {
      qb = qb.where(sql.ref(locCol), '=', locIdNum);
    }
  }
  const targetUserId = query.userId ?? (query as Record<string, unknown>).createdBy;
  if (targetUserId != null) {
    const userIdNum = Number(targetUserId);
    if (Number.isFinite(userIdNum) && userIdNum > 0) {
      qb = qb.where(sql.ref(userCol), '=', userIdNum);
    }
  }
  return qb;
}

// Single source of truth for the reports tenant predicate (extracted
// from ReportsService.tenantPredicate when the financial-summary
// aggregates moved to reports-summary.helper.ts, so the tenant
// scoping rule is defined once and shared by the service and the
// helper instead of being duplicated in two places).
export function buildTenantPredicate(tenantId: string, alias?: string) {
  return alias
    ? sql<boolean>`${sql.ref(`${alias}.tenant_id`)} = ${tenantId}`
    : sql<boolean>`tenant_id = ${tenantId}`;
}

export type ReportListState = {
  range?: { from: string; to: string };
  fromDate?: Date;
  toDate?: Date;
  search: string;
  searchPattern?: string;
  filter: string;
  page: number;
  pageSize: number;
  offset: number;
};

export function buildReportListState(
  query: ReportRangeQueryDto,
  defaultPageSize: number,
  options?: {
    includeRange?: boolean;
    defaultFilter?: string;
  },
): ReportListState {
  const includeRange = options?.includeRange !== false;
  const defaultFilter = String(options?.defaultFilter || 'all').toLowerCase();
  const { page, pageSize } = getPagination(query, defaultPageSize);
  const state: ReportListState = {
    search: String(query.search || '').trim().toLowerCase(),
    filter: String(query.filter || defaultFilter).toLowerCase(),
    page,
    pageSize,
    offset: Math.max(0, (page - 1) * pageSize),
  };

  if (state.search) {
    state.searchPattern = `%${state.search}%`;
  }

  if (includeRange) {
    const range = parseRange(query);
    state.range = range;
    state.fromDate = new Date(range.from);
    state.toDate = new Date(range.to);
  }

  return state;
}
