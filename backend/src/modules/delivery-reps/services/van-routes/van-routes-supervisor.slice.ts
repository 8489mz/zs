import { Kysely, sql } from '../../../../database/kysely';
import { Database } from '../../../../database/database.types';
import { AppError } from '../../../../common/errors/app-error';
import { tenantBaseCurrency } from '../../../accounting/accounting-currency';
import { currencyMoneyDigits } from '../../../accounting/engines/money-minor-units.engine';
import { normalizeCustomerCode, getCustomerRepBalancesMap } from '../van-common.util';
import { extractCoordinatesFromCustomerLocation, evaluateGeofenceCompliance, extractAssignedRepIds } from '../../rep-target.engine';
import { extractCustomerVisitDays, normalizeDayKey, DAY_KEY_TO_ARABIC } from '../../van-routes-schedule.util';
import { VanFleetService } from '../van-fleet.service';

export class VanRoutesSupervisorSlice {
  constructor(
    private readonly db: Kysely<Database>,
    private readonly vanFleetService: VanFleetService,
  ) {}

  private get anyDb(): any {
    return this.db as any;
  }

  async getSupervisorRouteKpis(tenantId: string, dateFrom?: string, dateTo?: string) {
    let visitQuery = this.anyDb
      .selectFrom('van_field_visits as vfv')
      .leftJoin('customers as c', 'c.id', 'vfv.customer_id')
      .select([
        'vfv.id',
        'vfv.visit_type as visitType',
        'vfv.negative_reason as negativeReason',
        'vfv.customer_id as customerId',
        'vfv.rep_id as repId',
        'vfv.gps_lat as gpsLat',
        'vfv.gps_lng as gpsLng',
        'c.metadata as customerMetadata',
      ])
      .where('vfv.tenant_id', '=', tenantId);

    if (dateFrom) visitQuery = visitQuery.where('vfv.visited_at', '>=', dateFrom);
    if (dateTo) visitQuery = visitQuery.where('vfv.visited_at', '<=', `${dateTo} 23:59:59`);

    const visits = await visitQuery.execute();

    // Fetch unlinked direct van sales to include in KPI strike rate & total visits
    const linkedSaleIds = (await this.anyDb
      .selectFrom('van_field_visits')
      .select(['sale_id'])
      .where('tenant_id', '=', tenantId)
      .where('sale_id', 'is not', null)
      .execute()).map((r: any) => r.sale_id).filter(Boolean);

    let sq = this.anyDb
      .selectFrom('sales as s')
      .leftJoin('customers as c', 'c.id', 's.customer_id')
      .select([
        's.id',
        sql<string>`'positive'`.as('visitType'),
        sql<string | null>`null`.as('negativeReason'),
        's.customer_id as customerId',
        's.delivery_rep_id as repId',
        sql<number | null>`cast(s.delivery_gps_lat as double precision)`.as('gpsLat'),
        sql<number | null>`cast(s.delivery_gps_lng as double precision)`.as('gpsLng'),
        'c.metadata as customerMetadata',
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.van_trip_id', 'is not', null);

    if (dateFrom) sq = sq.where('s.created_at', '>=', new Date(dateFrom));
    if (dateTo) sq = sq.where('s.created_at', '<=', new Date(`${dateTo} 23:59:59`));
    if (linkedSaleIds.length > 0) {
      sq = sq.where('s.id', 'not in', linkedSaleIds);
    }
    const directSalesKpi = await sq.execute();

    const allVisitsKpi = [...visits, ...directSalesKpi];

    const totalVisits = allVisitsKpi.length;
    const positiveVisits = allVisitsKpi.filter((v: any) => v.visitType === 'positive').length;
    const negativeVisits = allVisitsKpi.filter((v: any) => v.visitType === 'negative').length;
    const strikeRate = totalVisits > 0 ? Number(((positiveVisits / totalVisits) * 100).toFixed(1)) : 0;

    let geofenceCompliantCount = 0;
    let geofenceViolationsCount = 0;
    for (const v of allVisitsKpi) {
      const custCoords = extractCoordinatesFromCustomerLocation({ metadata: v.customerMetadata });
      const geo = evaluateGeofenceCompliance({
        repLat: v.gpsLat != null ? Number(v.gpsLat) : null,
        repLng: v.gpsLng != null ? Number(v.gpsLng) : null,
        customerLat: custCoords?.lat ?? null,
        customerLng: custCoords?.lng ?? null,
        maxAllowedMeters: 300,
      });
      if (geo.status === 'within_geofence') geofenceCompliantCount++;
      else if (geo.status === 'outside_geofence') geofenceViolationsCount++;
    }

    const reasonsMap: Record<string, number> = {
      no_cash: 0,
      shop_closed: 0,
      sufficient_stock: 0,
      item_unavailable: 0,
      postponed: 0,
      other: 0,
    };
    for (const v of visits) {
      if (v.visitType === 'negative' && v.negativeReason) {
        reasonsMap[v.negativeReason] = (reasonsMap[v.negativeReason] || 0) + 1;
      }
    }

    const custNegatives: Record<number, number> = {};
    for (const v of visits) {
      if (v.visitType === 'negative') {
        custNegatives[Number(v.customerId)] = (custNegatives[Number(v.customerId)] || 0) + 1;
      }
    }
    const repeatedNegativeCustomersCount = Object.values(custNegatives).filter((cnt) => cnt >= 3).length;

    const fuelLogs = await this.vanFleetService.listFuelLogs(tenantId, { dateFrom, dateTo });
    const totalFuelLiters = fuelLogs.reduce((sum: number, f: any) => sum + Number(f.liters || 0), 0);
    const totalFuelCost = fuelLogs.reduce((sum: number, f: any) => sum + Number(f.totalCost || 0), 0);
    const totalKmDriven = fuelLogs.reduce((sum: number, f: any) => sum + Number(f.kmSinceLastFuel || 0), 0);
    const avgConsumptionRate = totalFuelLiters > 0 && totalKmDriven > 0
      ? Number((totalKmDriven / totalFuelLiters).toFixed(2))
      : 0;

    const alertsRes = await this.vanFleetService.getFleetMaintenanceAlerts(tenantId);
    const alerts = alertsRes.alerts || [];

    return {
      totalVisits,
      positiveVisits,
      negativeVisits,
      strikeRate,
      geofenceCompliantCount,
      geofenceViolationsCount,
      negativeReasonsBreakdown: reasonsMap,
      repeatedNegativeCustomersCount,
      totalFuelLiters,
      totalFuelCost,
      totalKmDriven,
      avgConsumptionRate,
      alertsCount: alerts.length,
      alerts,
    };
  }

  async setCustomerRouteSchedule(
    tenantId: string,
    customerId: number,
    payload: {
      route?: string;
      routeSequence?: number;
      visitDays?: string[];
      customerCode?: string;
      locationUrl?: string;
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      assignedRepName?: string | null;
      repSchedules?: Array<{ repId: number; repName?: string; days: string[] }>;
    },
  ) {
    const cust = await this.anyDb
      .selectFrom('customers')
      .select(['id', 'metadata'])
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();

    if (!cust) throw new AppError('العميل غير موجود', 'CUSTOMER_NOT_FOUND', 404);

    let existingMeta: any = {};
    if (typeof cust.metadata === 'string') {
      try { existingMeta = JSON.parse(cust.metadata); } catch { existingMeta = {}; }
    } else if (cust.metadata && typeof cust.metadata === 'object') {
      existingMeta = { ...cust.metadata };
    }

    let targetRepIds: number[] | undefined;
    if (Array.isArray(payload.assignedRepIds)) {
      targetRepIds = Array.from(
        new Set(
          payload.assignedRepIds
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0),
        ),
      );
    } else if (payload.assignedRepId !== undefined) {
      if (payload.assignedRepId === null) {
        targetRepIds = [];
      } else {
        const singleId = Number(payload.assignedRepId);
        targetRepIds = Number.isInteger(singleId) && singleId > 0 ? [singleId] : [];
      }
    }

    let resolvedRepName = payload.assignedRepName ?? existingMeta.assigned_rep_name ?? null;
    let resolvedRepNames: string[] = Array.isArray(existingMeta.assigned_rep_names)
      ? existingMeta.assigned_rep_names
      : [];

    if (targetRepIds !== undefined) {
      if (targetRepIds.length > 0) {
        const reps = await this.anyDb
          .selectFrom('delivery_representatives')
          .select(['id', 'name'])
          .where('id', 'in', targetRepIds)
          .where('tenant_id', '=', tenantId)
          .execute();
        const nameById = new Map<number, string>();
        for (const r of reps || []) {
          nameById.set(Number(r.id), String(r.name || `مندوب #${r.id}`));
        }
        resolvedRepNames = targetRepIds.map((id) => nameById.get(id) || `مندوب #${id}`);
        resolvedRepName = resolvedRepNames.join(' ، ');
      } else {
        resolvedRepNames = [];
        resolvedRepName = null;
      }
    }

    const parsedCoords = payload.locationUrl !== undefined
      ? extractCoordinatesFromCustomerLocation({ locationUrl: payload.locationUrl })
      : null;

    let scheduleDaysUpdate: any = {};
    if (payload.visitDays !== undefined) {
      const normalizedDays = payload.visitDays
        .map((d) => DAY_KEY_TO_ARABIC[normalizeDayKey(d)] || d)
        .filter(Boolean);
      scheduleDaysUpdate = {
        visit_days: normalizedDays,
        visit_day: normalizedDays[0] || '',
      };
    }

    const updatedMeta: any = {
      ...existingMeta,
      ...(payload.route !== undefined ? { route: payload.route } : {}),
      ...(payload.routeSequence !== undefined ? { route_sequence: payload.routeSequence } : {}),
      ...scheduleDaysUpdate,
      ...(payload.customerCode !== undefined ? { customer_code: payload.customerCode } : {}),
      ...(payload.locationUrl !== undefined ? { location_url: payload.locationUrl } : {}),
      ...(parsedCoords ? { gps_lat: parsedCoords.lat, gps_lng: parsedCoords.lng } : {}),
    };

    if (targetRepIds !== undefined) {
      updatedMeta.assigned_rep_ids = targetRepIds;
      updatedMeta.assigned_rep_names = resolvedRepNames;
      updatedMeta.assigned_rep_id = targetRepIds.length > 0 ? targetRepIds[0] : null;
      updatedMeta.assigned_rep_name = resolvedRepName;
    }

    if (payload.repSchedules !== undefined) {
      updatedMeta.rep_schedules = payload.repSchedules.map((item) => ({
        repId: Number(item.repId),
        repName: item.repName || '',
        days: (item.days || []).map((d) => DAY_KEY_TO_ARABIC[normalizeDayKey(d)] || d).filter(Boolean),
      }));
    }

    await this.anyDb
      .updateTable('customers')
      .set({
        metadata: JSON.stringify(updatedMeta),
        updated_at: sql`NOW()`,
      })
      .where('id', '=', customerId)
      .where('tenant_id', '=', tenantId)
      .execute();

    return { ok: true, customerId, metadata: updatedMeta };
  }

  async bulkAssignCustomerRoutes(
    tenantId: string,
    payload: {
      customerIds: number[];
      assignedRepId?: number | null;
      assignedRepIds?: number[];
      appendReps?: boolean;
      assignedRepName?: string | null;
      route?: string;
      visitDays?: string[];
    },
  ) {
    if (!Array.isArray(payload.customerIds) || payload.customerIds.length === 0) {
      throw new AppError('يرجى تحديد عميل واحد على الأقل', 'INVALID_CUSTOMER_IDS', 400);
    }

    const allReps = await this.anyDb
      .selectFrom('delivery_representatives')
      .select(['id', 'name'])
      .where('tenant_id', '=', tenantId)
      .execute();
    const repNameById = new Map<number, string>();
    for (const r of allReps || []) {
      repNameById.set(Number(r.id), String(r.name || `مندوب #${r.id}`));
    }

    let resolvedRepName = payload.assignedRepName;
    if (payload.assignedRepId) {
      resolvedRepName = repNameById.get(Number(payload.assignedRepId)) || resolvedRepName;
    } else if (payload.assignedRepId === null) {
      resolvedRepName = null;
    }

    const customers = await this.anyDb
      .selectFrom('customers')
      .select(['id', 'metadata'])
      .where('id', 'in', payload.customerIds)
      .where('tenant_id', '=', tenantId)
      .execute();

    for (const c of customers) {
      let meta: any = {};
      if (typeof c.metadata === 'string') {
        try { meta = JSON.parse(c.metadata); } catch { meta = {}; }
      } else if (c.metadata && typeof c.metadata === 'object') {
        meta = { ...c.metadata };
      }

      if (Array.isArray(payload.assignedRepIds)) {
        const existingIds = payload.appendReps ? extractAssignedRepIds(meta) : [];
        const mergedIds = Array.from(
          new Set(
            [...existingIds, ...payload.assignedRepIds.map((id) => Number(id))].filter(
              (id) => Number.isInteger(id) && id > 0,
            ),
          ),
        );
        const names = mergedIds.map((id) => repNameById.get(id) || `مندوب #${id}`);
        meta.assigned_rep_ids = mergedIds;
        meta.assigned_rep_names = names;
        meta.assigned_rep_id = mergedIds.length > 0 ? mergedIds[0] : null;
        meta.assigned_rep_name = names.length > 0 ? names.join(' ، ') : null;
      } else if (payload.assignedRepId !== undefined) {
        if (payload.assignedRepId === null) {
          meta.assigned_rep_id = null;
          meta.assigned_rep_ids = [];
          meta.assigned_rep_name = null;
          meta.assigned_rep_names = [];
        } else {
          const rId = Number(payload.assignedRepId);
          const existingIds = payload.appendReps ? extractAssignedRepIds(meta) : [];
          const mergedIds = Array.from(new Set([...existingIds, rId]));
          const names = mergedIds.map((id) => repNameById.get(id) || resolvedRepName || `مندوب #${id}`);
          meta.assigned_rep_id = mergedIds[0] ?? rId;
          meta.assigned_rep_ids = mergedIds;
          meta.assigned_rep_name = names.join(' ، ');
          meta.assigned_rep_names = names;
        }
      }
      if (payload.route !== undefined && payload.route.trim()) {
        meta.route = payload.route.trim();
      }
      if (payload.visitDays !== undefined) {
        const normalizedDays = payload.visitDays
          .map((d) => DAY_KEY_TO_ARABIC[normalizeDayKey(d)] || d)
          .filter(Boolean);
        meta.visit_days = normalizedDays;
        meta.visit_day = normalizedDays[0] || '';
      }

      await this.anyDb
        .updateTable('customers')
        .set({
          metadata: JSON.stringify(meta),
          updated_at: sql`NOW()`,
        })
        .where('id', '=', c.id)
        .where('tenant_id', '=', tenantId)
        .execute();
    }

    return {
      ok: true,
      updatedCount: customers.length,
      assignedRepId: payload.assignedRepId,
      assignedRepName: resolvedRepName,
    };
  }

  async getSupervisorCustomerRoutes(
    tenantId: string,
    filters?: {
      search?: string;
      repId?: number | string;
      route?: string;
      unassignedOnly?: boolean;
    },
  ) {
    let query = this.anyDb
      .selectFrom('customers as c')
      .select([
        'c.id',
        'c.name',
        'c.phone',
        'c.address',
        'c.metadata',
        sql<number>`cast(coalesce(c.credit_limit, 0) as numeric)`.as('creditLimit'),
        sql<number>`coalesce(c.balance, 0)`.as('balance'),
        'c.created_at as createdAt',
      ])
      .where('c.tenant_id', '=', tenantId)
      .where('c.is_active', '=', true);

    if (filters?.search && filters.search.trim()) {
      const rawTrim = filters.search.trim();
      const q = `%${rawTrim.toLowerCase()}%`;
      const codeDigitsMatch = rawTrim.match(/^(?:c-|#)?0*(\d+)$/i);
      const numericId = codeDigitsMatch ? Number(codeDigitsMatch[1]) : null;
      query = query.where((eb: any) => {
        const conds: any[] = [
          sql<boolean>`TRANSLATE(LOWER(COALESCE(c.name, '')), 'أإآٱٲٳؤئىة', 'ااااااويهه') LIKE TRANSLATE(${q}, 'أإآٱٲٳؤئىة', 'ااااااويهه')`,
          sql<boolean>`c.phone like ${q}`,
          sql<boolean>`LPAD(CAST(c.id AS TEXT), 4, '0') LIKE ${q}`,
          sql<boolean>`cast(c.metadata as text) ilike ${q}`,
        ];
        if (numericId && Number.isInteger(numericId) && numericId > 0) {
          conds.push(eb('c.id', '=', numericId));
        }
        return eb.or(conds);
      });
    }

    const [rows, allReps] = await Promise.all([
      query.orderBy('c.name', 'asc').limit(3000).execute(),
      this.anyDb
        .selectFrom('delivery_representatives')
        .select(['id', 'name'])
        .where('tenant_id', '=', tenantId)
        .execute(),
    ]);

    const repNameById = new Map<number, string>();
    for (const rep of allReps || []) {
      repNameById.set(Number(rep.id), String(rep.name || `مندوب #${rep.id}`));
    }

    const customerIds: number[] = [];
    const customerTotalBalances: Record<number, number> = {};
    for (const r of rows) {
      const cid = Number(r.id);
      customerIds.push(cid);
      customerTotalBalances[cid] = Number(r.balance || 0);
    }

    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.anyDb, tenantId));
    const repBalancesMap = await getCustomerRepBalancesMap(this.anyDb, tenantId, {
      customerIds,
      customerTotalBalances,
      moneyDigits,
    });

    let results = rows.map((r: any) => {
      const cid = Number(r.id);
      let meta: any = {};
      if (typeof r.metadata === 'string') {
        try { meta = JSON.parse(r.metadata); } catch { meta = {}; }
      } else if (r.metadata && typeof r.metadata === 'object') {
        meta = r.metadata;
      }

      const breakdown = repBalancesMap.get(cid);
      const repBalances = breakdown?.repBalances || [];
      const metaRepIds = extractAssignedRepIds(meta);
      const ledgerRepIds = repBalances.filter((rb) => rb.balance !== 0).map((rb) => rb.repId);
      const assignedRepIds = Array.from(new Set([...metaRepIds, ...ledgerRepIds]));
      const assignedRepNames = assignedRepIds.map(
        (id) => repNameById.get(id) || breakdown?.byRepId[id]?.repName || `مندوب #${id}`,
      );
      const primaryRepId = meta.assigned_rep_id
        ? Number(meta.assigned_rep_id)
        : (assignedRepIds.length > 0 ? assignedRepIds[0] : null);
      const displayRepName =
        assignedRepNames.length > 0
          ? assignedRepNames.join(' ، ')
          : (meta.assigned_rep_name || null);

      const { visitDays, visitDay } = extractCustomerVisitDays(meta);

      return {
        customerId: cid,
        customerName: r.name,
        customerPhone: r.phone || '',
        customerAddress: r.address || '',
        customerCode: normalizeCustomerCode(meta.customer_code || meta.code, cid),
        route: meta.route || 'غير محدد',
        routeSequence: Number(meta.route_sequence || 1),
        visitDays,
        visitDay,
        repSchedules: meta.rep_schedules || [],
        assignedRepId: primaryRepId,
        assignedRepIds,
        assignedRepNames,
        assignedRepName: displayRepName,
        locationUrl: meta.location_url || (meta.gps_lat && meta.gps_lng ? `https://maps.google.com/?q=${meta.gps_lat},${meta.gps_lng}` : ''),
        balance: Number(r.balance || 0),
        repBalances,
        unassignedBalance: breakdown?.unassignedBalance || 0,
        creditLimit: Number(r.creditLimit || 0),
      };
    });

    if (filters?.unassignedOnly || filters?.repId === 'unassigned') {
      results = results.filter((c: any) => (!c.assignedRepIds || c.assignedRepIds.length === 0) && !c.assignedRepId);
    } else if (filters?.repId && filters.repId !== 'all') {
      const targetRepId = Number(filters.repId);
      results = results.filter(
        (c: any) =>
          c.assignedRepId === targetRepId ||
          (Array.isArray(c.assignedRepIds) && c.assignedRepIds.includes(targetRepId)) ||
          (Array.isArray(c.repBalances) && c.repBalances.some((rb: any) => Number(rb.repId) === targetRepId && rb.balance !== 0)),
      );
    }

    if (filters?.route && filters.route !== 'all') {
      results = results.filter((c: any) => c.route === filters.route);
    }

    return results;
  }
}
