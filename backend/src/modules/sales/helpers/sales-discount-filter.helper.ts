import { sql } from 'kysely';

/**
 * INV-VAN-PROFIT-REP-REPORTING: ONE definition of "discounted invoice",
 * shared by listOrders, listDriverSales and the rep lifetime report.
 * An invoice is discounted when its invoice-level discount is > 0 OR
 * any of its lines carries a line discount > 0 — a line discount IS a
 * discount. One SQL fragment, not three copies: the three call sites
 * cannot drift apart. The EXISTS keeps it a single predicate (no
 * per-row second query).
 *
 * @param alias the sales table alias in the calling query ('sales' or 's').
 */
export function discountedSaleSql(alias: string) {
  return sql<boolean>`(${sql.ref(`${alias}.discount`)} > 0 OR EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = ${sql.ref(`${alias}.id`)} AND si.tenant_id = ${sql.ref(`${alias}.tenant_id`)} AND si.line_discount > 0))`;
}
