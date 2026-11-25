import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import { normalizeCustomerCode, getCustomerRepBalancesMap } from '../van-common.util';
import {
  extractAssignedRepIds,
  extractCoordinatesFromCustomerLocation,
  loadRepPermissions,
} from '../../rep-target.engine';
import { optimizeRouteTsp, RouteStopInput, RouteOptimizationResult } from '../../route-optimization.engine';

export interface VanRoutesOptimizeSliceBoundDeps {
  listRepServedCustomerIds: (tenantId: string, repId: number) => Promise<Set<number>>;
}

export class VanRoutesOptimizeSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly bound: VanRoutesOptimizeSliceBoundDeps,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  private async listRepServedCustomerIds(tenantId: string, repId: number): Promise<Set<number>> {
    return this.bound.listRepServedCustomerIds(tenantId, repId);
  }

  async optimizeCustomerRoute(
    tenantId: string,
    payload: {
      customerIds?: number[];
      route?: string;
      repId?: number;
      startLat?: number | null;
      startLng?: number | null;
      persistSequence?: boolean;
      // H9 (D4): the rep acting on his own behalf. Only the driver
      // endpoint passes this; the supervisor endpoint does not, so a
      // supervisor editing routes is never gated by a rep's flag.
      actingRepId?: number;
    },
  ): Promise<RouteOptimizationResult & { persistedCount?: number }> {
    let customerRows: any[] = [];

    if (Array.isArray(payload.customerIds) && payload.customerIds.length > 0) {
      customerRows = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'phone', 'address', 'metadata', 'balance'])
        .where('id', 'in', payload.customerIds)
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .execute();
    } else if (payload.route && payload.route.trim()) {
      const allActive = await this.anyDb
        .selectFrom('customers')
        .select(['id', 'name', 'phone', 'address', 'metadata', 'balance'])
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .execute();

      const rName = payload.route.trim();
      customerRows = allActive.filter((c: any) => {
        let meta: any = {};
        if (typeof c.metadata === 'string') {
          try {
            meta = JSON.parse(c.metadata);
          } catch {
            meta = {};
          }
        } else if (c.metadata && typeof c.metadata === 'object') {
          meta = c.metadata;
        }
        return meta.route === rName;
      });
    } else {
      throw new AppError('يرجى تحديد العملاء أو اسم خط السير للتحسين', 'INVALID_OPTIMIZE_PAYLOAD', 400);
    }

    // INV-REP-SCOPED-DRIVER-READS (M19/D8): when repId is present the
    // caller is a driver (or a supervisor optimizing for one rep) and
    // the route may only cover that rep's own customers — assigned in
    // customer metadata, served (field visit / pre-sale order /
    // delivered sale), or ledger-active under his rep id; the same
    // three legs H7 established for getActiveTrip /
    // getDriverTodayItinerary. An explicitly requested customer
    // outside that scope is refused with a specific 403 naming the
    // problem (existing 403 style); a shared route name is silently
    // restricted to his own customers, since route names are shared
    // across reps and no specific customer was requested. With no
    // repId (admin path) the breadth is unchanged. Because the rows
    // below are the only ones ever persisted, persistSequence can
    // never rewrite another rep's route_sequence.
    if (payload.repId != null) {
      const repId = Number(payload.repId);
      const servedIds = await this.listRepServedCustomerIds(tenantId, repId);
      const candidateIds = customerRows.map((c: any) => Number(c.id));
      const totals: Record<number, number> = {};
      for (const c of customerRows) totals[Number(c.id)] = Number((c as any).balance || 0);
      const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
      const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
        customerIds: candidateIds,
        customerTotalBalances: totals,
        moneyDigits,
      });
      const inScope = (c: any): boolean => {
        const cid = Number(c.id);
        let meta: any = {};
        if (typeof c.metadata === 'string') {
          try {
            meta = JSON.parse(c.metadata);
          } catch {
            meta = {};
          }
        } else if (c.metadata && typeof c.metadata === 'object') {
          meta = c.metadata;
        }
        if (extractAssignedRepIds(meta).includes(repId)) return true;
        if (servedIds.has(cid)) return true;
        return Boolean(repBalancesMap.get(cid)?.byRepId[repId]);
      };
      if (Array.isArray(payload.customerIds) && payload.customerIds.length > 0) {
        const outside = customerRows.find((c: any) => !inScope(c));
        if (outside) {
          throw new AppError(
            'هذا العميل غير مسند إليك ولم تخدمه من قبل، لا يمكنك إدراجه في خط سيرك',
            'REP_CUSTOMER_NOT_IN_SCOPE',
            403,
          );
        }
      } else {
        customerRows = customerRows.filter(inScope);
      }
    }

    if (customerRows.length === 0) {
      throw new AppError('لم يتم العثور على أي عملاء نشطين للتحسين', 'NO_CUSTOMERS_FOUND', 404);
    }

    const stops: RouteStopInput[] = customerRows.map((c) => {
      const cId = Number(c.id);
      let meta: any = {};
      if (typeof c.metadata === 'string') {
        try {
          meta = JSON.parse(c.metadata);
        } catch {
          meta = {};
        }
      } else if (c.metadata && typeof c.metadata === 'object') {
        meta = c.metadata;
      }

      const coords = extractCoordinatesFromCustomerLocation({
        locationUrl: meta.location_url,
        metadata: meta,
      });

      return {
        id: cId,
        name: c.name,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        address: c.address || '',
        district: meta.district || meta.area || '',
        customerCode: normalizeCustomerCode(meta.customer_code || meta.code, cId),
        originalSequence: Number(meta.route_sequence || 0),
        route: meta.route || 'الخط العام',
      };
    });

    const result = optimizeRouteTsp(stops, {
      startLat: payload.startLat,
      startLng: payload.startLng,
    });

    let persistedCount = 0;
    if (payload.persistSequence) {
      // H9 (D4): persisting a new route sequence IS the route edit —
      // a read-only optimization (no persistSequence) writes nothing
      // and is never gated. When the caller is the rep himself
      // (actingRepId), his can_edit_routes flag must allow it; a
      // supervisor call carries no actingRepId and is ungated.
      // The gate runs before the first write, so a refusal leaves
      // every customer's route_sequence untouched.
      if (payload.actingRepId != null) {
        const repFlags = await loadRepPermissions(this.anyDb, tenantId, Number(payload.actingRepId));
        if (!repFlags.can_edit_routes) {
          throw new AppError(
            'صلاحية تعديل خطوط السير (can_edit_routes) مغلقة لهذا المندوب، فلا يمكنه حفظ ترتيب مسار جديد',
            'REP_CANNOT_EDIT_ROUTES',
            403,
          );
        }
      }
      for (const stop of result.orderedStops) {
        const cRow = customerRows.find((c) => Number(c.id) === stop.id);
        if (!cRow) continue;

        let meta: any = {};
        if (typeof cRow.metadata === 'string') {
          try {
            meta = JSON.parse(cRow.metadata);
          } catch {
            meta = {};
          }
        } else if (cRow.metadata && typeof cRow.metadata === 'object') {
          meta = { ...cRow.metadata };
        }

        meta.route_sequence = stop.sequenceIndex;

        await this.anyDb
          .updateTable('customers')
          .set({
            metadata: JSON.stringify(meta),
            updated_at: sql`NOW()`,
          })
          .where('id', '=', stop.id)
          .where('tenant_id', '=', tenantId)
          .execute();

        persistedCount++;
      }
    }

    return {
      ...result,
      persistedCount,
    };
  }
}
