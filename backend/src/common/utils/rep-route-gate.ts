import { AppError } from '../errors/app-error';

/**
 * F3 (trial problem 3, 2026-11-21, test10k): a rep sold to a customer
 * NOT on his route ("عميل اختبار 00001", Z-261121-16631, 10.00) with
 * no warning and no block. The portal picker only OFFERS route
 * customers, but no server-side gate stood on the sale itself.
 *
 * THE PREDICATE: the SAME canonical served definition as
 * RepScopedReadsSlice.listRepServedCustomerIds (a field visit on one
 * of the rep's trips, a pre-sale order assigned to him, or a delivered
 * sale carrying his delivery_rep_id — there is no static
 * customer-to-rep assignment in the schema, so history is the
 * association), transposed from rep -> customers to customer -> reps.
 *
 * THE THREE-WAY DISTINCTION (the subtlety the raw predicate cannot
 * express — assertRepServedCustomer refuses ANY unserved customer,
 * including a brand-new one): the serving-rep set for the customer
 * decides. Empty set = NO history anywhere = the first sale, which
 * CREATES the association, so it is allowed. Non-empty set containing
 * this rep = his own served customer, allowed. Non-empty set NOT
 * containing this rep = served by a DIFFERENT rep / on a different
 * route, refused with CUSTOMER_NOT_ON_REP_ROUTE (403) unless a
 * supervisor PIN approves it (the override lives in the callers —
 * the field-sale slice and the POS gate — because each path verifies
 * its PIN through its own existing override channel).
 *
 * FAULT TOLERANCE: each evidence source is queried independently and
 * a failed source reads as empty. The gate runs on the hot sale path
 * (both sale writers), and older PGlite harnesses declare only the
 * tables their path touches — the field-sale book-digits harness, for
 * example, has no sales_orders table, and a missing evidence table
 * must never fail a sale: it only narrows the evidence, it never
 * invents a serving rep. In production all three tables exist, so
 * the gate enforces on the full evidence there. This mirrors the F1a
 * precedent (a missing phone column simply matches nothing).
 */
export async function listCustomerServingRepIds(
  queryable: any,
  tenantId: string,
  customerId: number,
): Promise<Set<number>> {
  const ids = new Set<number>();
  const collect = (rows: any[]): void => {
    for (const row of rows || []) {
      const id = Number((row as any).rep_id ?? (row as any).repId ?? (row as any).delivery_rep_id);
      if (Number.isInteger(id) && id > 0) ids.add(id);
    }
  };
  const sources: Array<() => Promise<any[]>> = [
    () =>
      queryable
        .selectFrom('van_field_visits')
        .select('rep_id')
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', Number(customerId))
        .execute(),
    () =>
      queryable
        .selectFrom('sales_orders')
        .select('rep_id')
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', Number(customerId))
        .execute(),
    () =>
      queryable
        .selectFrom('sales')
        .select('delivery_rep_id')
        .where('tenant_id', '=', tenantId)
        .where('customer_id', '=', Number(customerId))
        .execute(),
  ];
  for (const run of sources) {
    try {
      collect(await run());
    } catch {
      // Missing evidence table in an older harness: no evidence from
      // this source (see the header note). Never invents a rep.
    }
  }
  return ids;
}

export async function assertRepRouteForSale(
  queryable: any,
  tenantId: string,
  repId: number,
  customerId: number,
): Promise<void> {
  const serving = await listCustomerServingRepIds(queryable, tenantId, customerId);
  if (serving.size === 0) return;
  if (serving.has(Number(repId))) return;
  throw new AppError(
    `العميل رقم #${Number(customerId)} غير مسجل على خط سير المندوب — البيع لعميل يتبع مندوباً آخر يتطلب اعتماد المشرف برمز PIN`,
    'CUSTOMER_NOT_ON_REP_ROUTE',
    403,
  );
}

/**
 * F3 (trial problem 3): the field-sale route gate. Runs BEFORE the
 * transaction opens (both call sites sit in the pre-transaction
 * customer resolution), so a refusal writes nothing — not even the
 * assigned_rep_ids metadata link the customer branch maintains. The
 * gate itself refuses only a customer served by a DIFFERENT rep;
 * no-history (first sale) and own-served customers pass straight
 * through. A refused sale is allowed through only when the supervisor
 * PIN in the payload verifies — the same PIN the discount/bonus gates
 * verify inside the transaction, checked here on the pool handle so
 * the gate can stay pre-transaction (the in-transaction verification
 * still runs for those gates and re-verifies the same PIN). A wrong or
 * absent PIN rethrows the route refusal, never a PIN error: the
 * condition being refused is the route. Moved here from
 * execute-field-sale-internal.ts at the Batch 3 merge so that file
 * stays at its size baseline (1468) — the gate belongs with the
 * predicate it calls, and the move is behaviour-identical.
 */
export async function assertRouteGate(
  queryable: any,
  repId: number,
  tenantId: string,
  accountId: string,
  customerId: number,
  verifySupervisorPin: (...args: any[]) => any,
  supervisorOverridePin?: string,
): Promise<void> {
  let routeErr: AppError | null = null;
  try {
    await assertRepRouteForSale(queryable, tenantId, repId, customerId);
    return;
  } catch (err) {
    if (!(err instanceof AppError) || (err as AppError).code !== 'CUSTOMER_NOT_ON_REP_ROUTE') throw err;
    routeErr = err as AppError;
  }
  const pin = String(supervisorOverridePin || '').trim();
  if (pin) {
    try {
      const verification = await verifySupervisorPin(tenantId, pin, repId, queryable, accountId);
      if (verification && verification.approved) return;
    } catch {
      // A verifier failure is not an approval: fall through to the route refusal below.
    }
  }
  throw routeErr;
}
