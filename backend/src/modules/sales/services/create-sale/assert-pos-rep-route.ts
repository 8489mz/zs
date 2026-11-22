import { AppError } from '../../../../common/errors/app-error';
import type { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';
import type { SalesAuthorizationService } from '../sales-authorization.service';
import { assertRepRouteForSale } from '../../../delivery-reps/services/van-collections-and-swaps/rep-route-gate';

/**
 * F3 (trial problem 3, 2026-11-21, test10k): the POS side of the
 * route gate. The F7 attribution (resolvePosTripAttribution) tells
 * the orchestrator the seller is a rep with an active trip; this
 * helper runs BEFORE the transaction opens, so a refusal writes
 * nothing.
 *
 * THE RULE: a rep sale to a customer served by a DIFFERENT rep is
 * refused with CUSTOMER_NOT_ON_REP_ROUTE (403). A customer with NO
 * history anywhere posts (the first sale creates the association)
 * and the rep's own served customer posts — the three-way
 * distinction lives in the shared assertRepRouteForSale, the same
 * predicate the field-sale slice calls. Ordinary retail counter
 * sales never reach here: the orchestrator calls this only when the
 * attribution resolved a rep + active trip.
 *
 * ADMIN EXEMPTION (same shape as F1a's rep-cap exemption,
 * INV-POS-ADMIN-DISCOUNT-AUTHORITY): an admin / super_admin seller,
 * or a caller holding '*', is not a rep sale in the gated sense and
 * passes. The override is the existing manager-PIN path the tier /
 * discount gates use (authorizeDiscountOverride): a rep who
 * genuinely must sell off-route gets a PIN, not a dead end. A wrong
 * or absent PIN rethrows the route refusal, never a PIN error: the
 * condition being refused is the route.
 */
export async function assertPosRepRouteForSale(
  db: Kysely<Database>,
  params: {
    tenantId: string;
    repId: number;
    customerId: number;
    managerPin?: string | null;
    auth: AuthContext;
    authz: SalesAuthorizationService;
  },
): Promise<void> {
  const { tenantId, repId, customerId, managerPin, auth, authz } = params;
  const isAdminSeller = auth.role === 'admin' || auth.role === 'super_admin';
  if (isAdminSeller || authz.hasPermission(auth, '*')) return;
  let routeErr: AppError | null = null;
  try {
    await assertRepRouteForSale(db as any, tenantId, repId, customerId);
    return;
  } catch (err) {
    if (!(err instanceof AppError) || (err as AppError).code !== 'CUSTOMER_NOT_ON_REP_ROUTE') throw err;
    routeErr = err as AppError;
  }
  const pin = String(managerPin || '').trim();
  if (pin) {
    try {
      await authz.authorizeDiscountOverride(pin, auth);
      return;
    } catch {
      // A failed override is not an approval: fall through to the
      // route refusal below.
    }
  }
  throw routeErr;
}
