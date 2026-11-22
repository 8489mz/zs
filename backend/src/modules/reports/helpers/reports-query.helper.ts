import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { getPagination, parseRange, resolveTenantDayRange } from './reports-range.helper';
import { discountedReturnInvoiceSql, discountedSaleSql } from '../../sales/helpers/sales-discount-filter.helper';
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

// INV-VAN-PROFIT-REP-REPORTING: scopes the SALES side of a report to
// one delivery rep. Only call on queries whose table (or join) carries
// delivery_rep_id — never inside applyReportScopeFilter, which also
// wraps purchases / expenses / services tables that have no such column.
export function applyDeliveryRepSalesFilter<T extends object>(queryBuilder: T, query: ReportRangeQueryDto, tableAlias?: string): T {
  const repId = query.deliveryRepId;
  if (repId == null) return queryBuilder;
  const repIdNum = Number(repId);
  if (!Number.isFinite(repIdNum) || repIdNum <= 0) return queryBuilder;
  const col = tableAlias ? `${tableAlias}.delivery_rep_id` : 'delivery_rep_id';
  return (queryBuilder as any).where(sql.ref(col), '=', repIdNum);
}

// INV-VAN-PROFIT-REP-REPORTING: sale returns carry no rep column — a
// return belongs to a rep through its invoice. When a rep filter is
// on, the returns side counts ONLY sale returns whose invoice belongs
// to the rep (purchase returns drop out: they are not rep sales).
// Only call on return_documents(-aliased) queries.
export function applyDeliveryRepReturnsFilter<T extends object>(queryBuilder: T, query: ReportRangeQueryDto, tableAlias?: string): T {
  const repId = query.deliveryRepId;
  if (repId == null) return queryBuilder;
  const repIdNum = Number(repId);
  if (!Number.isFinite(repIdNum) || repIdNum <= 0) return queryBuilder;
  const alias = tableAlias ?? 'return_documents';
  return (queryBuilder as any)
    .where(sql.ref(`${alias}.return_type`), '=', 'sale')
    .where(sql<boolean>`exists (select 1 from sales s2 where s2.id = ${sql.ref(`${alias}.invoice_id`)} and s2.tenant_id = ${sql.ref(`${alias}.tenant_id`)} and s2.delivery_rep_id = ${repIdNum})`);
}

// F13 (trial problem 18): discounted-invoices-only on the sales side.
// Only call on queries whose table (or join) carries the sales columns
// the shared predicate reads — the same call discipline as the rep filter.
export function applyDiscountedOnlySalesFilter<T extends object>(queryBuilder: T, query: ReportRangeQueryDto, tableAlias?: string): T {
  if (!query.discountedOnly) return queryBuilder;
  return (queryBuilder as any).where(discountedSaleSql(tableAlias ?? 'sales'));
}

// F13 (trial problem 18): sale returns of discounted invoices only.
// Only call on return_documents(-aliased) queries.
export function applyDiscountedOnlyReturnsFilter<T extends object>(queryBuilder: T, query: ReportRangeQueryDto, tableAlias?: string): T {
  if (!query.discountedOnly) return queryBuilder;
  return (queryBuilder as any).where(discountedReturnInvoiceSql(tableAlias ?? 'return_documents'));
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
    // Tenant business timezone for the default range. Callers with a
    // tenant pass the resolved tenant zone; without it parseRange falls
    // back to the canonical env-or-Cairo default, never UTC.
    timezone?: string;
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
    const range = parseRange(query, options?.timezone);
    state.range = range;
    state.fromDate = new Date(range.from);
    state.toDate = new Date(range.to);
    // INV-VAN-SALES-LIST-DATE-FILTER: a bare from/to date means the
    // whole tenant day — parseRange passes a bare `to` through as
    // midnight UTC and silently drops the last day from every list
    // built on this state (partner ledgers = the payments lists).
    // Only explicit bare dates are expanded; defaults and full
    // datetimes pass through unchanged. Garbage bounds are a 400.
    const explicit = resolveTenantDayRange(query.from, query.to, options?.timezone);
    if (explicit.from) {
      state.fromDate = explicit.from;
      state.range = { ...state.range, from: explicit.from.toISOString() };
    }
    if (explicit.to) {
      state.toDate = explicit.to;
      state.range = { ...state.range, to: explicit.to.toISOString() };
    }
  }

  return state;
}
