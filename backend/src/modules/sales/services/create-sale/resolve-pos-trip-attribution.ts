import { Kysely } from '../../../../database/kysely';
import type { Database } from '../../../../database/database.types';
import type { AuthContext } from '../../../../core/auth/interfaces/auth-context.interface';

export interface PosTripAttribution {
  repId: number;
  tripId: number;
}

/**
 * F7 (trial problems 8 and 9): which rep + active trip a generic
 * createSale belongs to, resolved BEFORE the transaction opens.
 *
 * The rep is the acting user's linked delivery_representatives row,
 * by the same phone/username link the F1a rep-discount cap uses in
 * compute-totals-and-gates (rep.phone matches the user's phone or
 * username) — or, for a delivery, the explicit payload.deliveryRepId
 * the caller passed. The trip is that rep's ACTIVE trip
 * (van_sales_trips status 'open', latest id — the same definition
 * getActiveTrip uses). NULL when there is no rep link or no open
 * trip: ordinary retail counter sales stay unattributed, never
 * fabricated.
 *
 * Both reads use selectAll + a JS filter on purpose, exactly as
 * F1a does: naming the phone column in SQL would abort an open
 * transaction (25P02) on any harness whose users /
 * delivery_representatives table has no phone column, and a caught
 * 42703 cannot un-abort it. selectAll returns whatever columns
 * exist, so a missing phone simply matches nothing. The caller
 * (createSale) runs this BEFORE runInTransaction and treats ANY
 * throw as "no attribution" — a missing van_sales_trips table, a
 * dead connection, anything — so attribution can never fail a
 * sale. The insert phase re-checks the trip row under lock before
 * stamping, so a trip settled between here and the insert receives
 * neither the sale nor its counters.
 */
export async function resolvePosTripAttribution(
  dbConn: Kysely<Database>,
  params: { tenantId: string; auth: AuthContext; explicitRepId: number | null },
): Promise<PosTripAttribution | null> {
  const { tenantId, auth, explicitRepId } = params;
  let repId: number | null = null;
  if (explicitRepId && Number.isFinite(explicitRepId) && explicitRepId > 0) {
    repId = explicitRepId;
  } else {
    const linkValues = [String(auth.username || '').trim()].filter((value) => value.length > 0);
    const [actingUser, repRows] = await Promise.all([
      dbConn.selectFrom('users').selectAll().where('id', '=', Number(auth.userId)).executeTakeFirst(),
      dbConn.selectFrom('delivery_representatives').selectAll().where('tenant_id', '=', tenantId).execute(),
    ]);
    for (const value of [actingUser?.phone, actingUser?.username]) {
      const trimmed = String(value || '').trim();
      if (trimmed.length > 0 && !linkValues.includes(trimmed)) linkValues.push(trimmed);
    }
    const repLink = repRows.find((row) => linkValues.includes(String(row.phone || '').trim()));
    if (!repLink) return null;
    repId = Number(repLink.id);
  }
  if (!repId || repId <= 0) return null;
  const tripRows = await dbConn
    .selectFrom('van_sales_trips')
    .selectAll()
    .where('tenant_id', '=', tenantId)
    .where('rep_id', '=', repId)
    .where('status', '=', 'open')
    .execute();
  const openTrips = tripRows.filter((row) => Number(row.rep_id) === repId && String(row.status || '') === 'open');
  if (openTrips.length === 0) return null;
  const latest = openTrips.reduce((best, row) => (Number(row.id) > Number(best.id) ? row : best));
  return { repId, tripId: Number(latest.id) };
}
