import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { loadAntiTheftSettings, type AntiTheftSettings } from '../../../common/utils/anti-theft-settings.util';
import {
  CashierFraudRadarService,
  type FraudRadarEventItem,
  type FraudRadarSummaryResponse,
} from './cashier-fraud-radar.service';
import {
  buildShrinkageHeatmap,
  evaluateTransferAging,
  type ShrinkageLossEvent,
} from '../../inventory/engines/shrinkage-reconciliation.engine';

export interface CommandCenterResponse {
  timeframe: 'today' | '7days' | '30days';
  antiTheftSettings: AntiTheftSettings;
  posRadar: {
    summary: FraudRadarSummaryResponse;
    events: FraudRadarEventItem[];
  };
  inTransitCustody: {
    alertThresholdHours: number;
    openCount: number;
    overdueCount: number;
    totalEstimatedCost: number;
    transfers: Array<{
      transferId: string;
      docNo: string;
      fromLocationName: string;
      toLocationName: string;
      carrierName: string;
      createdByName: string;
      createdAt: string;
      ageHours: number;
      isOverdue: boolean;
      overdueByHours: number;
      itemsCount: number;
      totalQty: number;
      estimatedCost: number;
    }>;
  };
  shrinkage: {
    hotSkusCount: number;
    totalLossQty: number;
    totalLossCost: number;
    totalIncidents: number;
    byCause: {
      damaged: { qty: number; cost: number; count: number };
      negative_adjustment: { qty: number; cost: number; count: number };
      count_shortage: { qty: number; cost: number; count: number };
      transfer_shortage: { qty: number; cost: number; count: number };
    };
    topProducts: Array<{
      productId: string;
      productName: string;
      totalQtyLost: number;
      totalCostLost: number;
      incidentsCount: number;
      topLocationName: string;
      causesBreakdown: {
        damaged: number;
        negative_adjustment: number;
        count_shortage: number;
        transfer_shortage: number;
      };
    }>;
  };
  shiftsAndDelivery: {
    totalShiftShortageAmount: number;
    shortageShiftsCount: number;
    shiftVariances: Array<{
      shiftId: string;
      docNo: string;
      cashierName: string;
      terminalCode: string;
      expectedCash: number;
      countedCash: number;
      variance: number;
      varianceResolution: string;
      closedAt: string;
    }>;
    totalUnsettledDeliveryCash: number;
    overdueDeliveryOrdersCount: number;
    overCapRepsCount: number;
    deliveryCustodies: Array<{
      repId: string;
      repName: string;
      phone: string;
      unsettledOrdersCount: number;
      overdueOrdersCount: number;
      unsettledCash: number;
      custodyCap: number;
      isOverCap: boolean;
      oldestUnsettledAt: string | null;
    }>;
  };
  headlineMetrics: {
    totalFinancialExposure: number;
    criticalAlertsCount: number;
    highRiskCashiersCount: number;
    overdueTransfersCount: number;
    overdueDeliveriesCount: number;
    hotSkusCount: number;
  };
}

@Injectable()
export class LossPreventionCommandCenterService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly fraudRadar: CashierFraudRadarService,
  ) {}

  async getCommandCenter(timeframe: 'today' | '7days' | '30days', auth: AuthContext): Promise<CommandCenterResponse> {
    const scope = requireTenantScope(auth);
    const now = new Date();
    const startDate = new Date(now);
    if (timeframe === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (timeframe === '7days') {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      startDate.setDate(startDate.getDate() - 30);
    }

    const [
      antiTheftSettings,
      posSummary,
      posEvents,
      openTransfers,
      damagedRows,
      negMovementRows,
      hotSkusCountRow,
      shiftRows,
      deliveryRepRows,
      unsettledSalesRows,
    ] = await Promise.all([
      loadAntiTheftSettings(this.db, scope.tenantId),
      this.fraudRadar.getSummary(timeframe, auth),
      this.fraudRadar.getEvents(50, auth, timeframe),
      this.db
        .selectFrom('stock_transfers as t')
        .leftJoin('stock_locations as fl', (j) =>
          j.onRef('fl.id', '=', 't.from_location_id').onRef('fl.tenant_id', '=', 't.tenant_id'),
        )
        .leftJoin('stock_locations as tl', (j) =>
          j.onRef('tl.id', '=', 't.to_location_id').onRef('tl.tenant_id', '=', 't.tenant_id'),
        )
        .leftJoin('users as cu', (j) => j.onRef('cu.id', '=', 't.created_by').onRef('cu.tenant_id', '=', 't.tenant_id'))
        .select([
          't.id',
          't.doc_no',
          't.carrier_name',
          't.created_at',
          'fl.name as from_location_name',
          'tl.name as to_location_name',
          'cu.username as created_by_name',
        ])
        .where('t.tenant_id', '=', scope.tenantId)
        .where('t.status', '=', 'sent')
        .orderBy('t.created_at', 'asc')
        .limit(50)
        .execute(),
      this.db
        .selectFrom('damaged_stock_records as d')
        .leftJoin('products as p', (j) => j.onRef('p.id', '=', 'd.product_id').onRef('p.tenant_id', '=', 'd.tenant_id'))
        .leftJoin('stock_locations as l', (j) =>
          j.onRef('l.id', '=', 'd.location_id').onRef('l.tenant_id', '=', 'd.tenant_id'),
        )
        .select([
          'd.product_id',
          'd.location_id',
          'd.qty',
          'd.total_cost',
          'd.unit_cost',
          'p.name as product_name',
          'p.cost_price as product_cost_price',
          'l.name as location_name',
        ])
        .where('d.tenant_id', '=', scope.tenantId)
        .where('d.created_at', '>=', startDate)
        .execute(),
      this.db
        .selectFrom('stock_movements as m')
        .leftJoin('products as p', (j) => j.onRef('p.id', '=', 'm.product_id').onRef('p.tenant_id', '=', 'm.tenant_id'))
        .leftJoin('stock_locations as l', (j) =>
          j.onRef('l.id', '=', 'm.location_id').onRef('l.tenant_id', '=', 'm.tenant_id'),
        )
        .select([
          'm.product_id',
          'm.location_id',
          'm.movement_type',
          'm.qty',
          'm.unit_cost',
          'm.total_cost',
          'p.name as product_name',
          'p.cost_price as product_cost_price',
          'l.name as location_name',
        ])
        .where('m.tenant_id', '=', scope.tenantId)
        .where('m.created_at', '>=', startDate)
        .where('m.qty', '<', 0)
        .where('m.movement_type', 'in', ['deduct', 'adjust', 'stock_count_loss', 'transfer_shortage'])
        .execute(),
      this.db
        .selectFrom('products')
        .select(sql<number>`COUNT(*)`.as('cnt'))
        .where('tenant_id', '=', scope.tenantId)
        .where('is_active', '=', true)
        .where('is_high_risk_shrinkage', '=', true)
        .executeTakeFirst(),
      this.db
        .selectFrom('cashier_shifts as cs')
        .leftJoin('users as u', (j) => j.onRef('u.id', '=', 'cs.opened_by').onRef('u.tenant_id', '=', 'cs.tenant_id'))
        .select([
          'cs.id',
          'cs.doc_no',
          'cs.terminal_code',
          'cs.expected_cash',
          'cs.counted_cash',
          'cs.variance',
          'cs.variance_resolution',
          'cs.closed_at',
          'u.username as cashier_name',
        ])
        .where('cs.tenant_id', '=', scope.tenantId)
        .where('cs.closed_at', '>=', startDate)
        .where(sql<boolean>`ABS(COALESCE(cs.variance, 0)) > 0.01`)
        .orderBy('cs.closed_at', 'desc')
        .limit(30)
        .execute(),
      this.db
        .selectFrom('delivery_representatives')
        .select(['id', 'name', 'phone', 'max_cash_custody_limit'])
        .where('tenant_id', '=', scope.tenantId)
        .where('is_active', '=', true)
        .execute(),
      this.db
        .selectFrom('sales')
        .select(['id', 'delivery_rep_id', 'total', 'paid_amount', 'created_at'])
        .where('tenant_id', '=', scope.tenantId)
        .where('delivery_rep_id', 'is not', null)
        .where('status', '!=', 'cancelled')
        .where((eb) =>
          eb.and([
            eb.or([eb('driver_cash_settled', 'is', null), eb('driver_cash_settled', '=', false)]),
            eb.or([eb('delivery_status', 'is', null), eb('delivery_status', '!=', 'settled')]),
            eb.or([eb('collection_status', 'is', null), eb('collection_status', '!=', 'prepaid_online')]),
          ]),
        )
        .execute(),
    ]);

    // 1. In-Transit Custody
    const transferIds = openTransfers.map((r) => Number(r.id));
    const transferStatsMap = new Map<number, { itemsCount: number; totalQty: number; estCost: number }>();
    if (transferIds.length) {
      const statsRows = await this.db
        .selectFrom('stock_transfer_items as i')
        .leftJoin('products as p', (j) => j.onRef('p.id', '=', 'i.product_id').onRef('p.tenant_id', '=', 'i.tenant_id'))
        .select([
          'i.transfer_id',
          sql<number>`COUNT(*)`.as('items_count'),
          sql<number>`COALESCE(SUM(i.qty), 0)`.as('total_qty'),
          sql<number>`COALESCE(SUM(i.qty * COALESCE(p.cost_price, 0)), 0)`.as('est_cost'),
        ])
        .where('i.tenant_id', '=', scope.tenantId)
        .where('i.transfer_id', 'in', transferIds)
        .groupBy('i.transfer_id')
        .execute();
      for (const s of statsRows) {
        transferStatsMap.set(Number(s.transfer_id), {
          itemsCount: Number(s.items_count || 0),
          totalQty: Number(Number(s.total_qty || 0).toFixed(3)),
          estCost: Number(Number(s.est_cost || 0).toFixed(2)),
        });
      }
    }

    const alertHours = Math.max(1, Number(antiTheftSettings.inTransitAlertHours || 4));
    let overdueTransfersCount = 0;
    let totalInTransitCost = 0;
    const transfers = openTransfers.map((row) => {
      const aging = evaluateTransferAging({
        transferId: String(row.id),
        docNo: String(row.doc_no || `TR-${row.id}`),
        createdAt: row.created_at as Date,
        alertHours,
        now,
      });
      if (aging.isOverdue) overdueTransfersCount += 1;
      const st = transferStatsMap.get(Number(row.id)) || { itemsCount: 0, totalQty: 0, estCost: 0 };
      totalInTransitCost += st.estCost;
      return {
        transferId: String(row.id),
        docNo: aging.docNo,
        fromLocationName: String(row.from_location_name || '—'),
        toLocationName: String(row.to_location_name || '—'),
        carrierName: String(row.carrier_name || ''),
        createdByName: String(row.created_by_name || ''),
        createdAt: row.created_at ? new Date(row.created_at as any).toISOString() : '',
        ageHours: aging.ageHours,
        isOverdue: aging.isOverdue,
        overdueByHours: aging.overdueByHours,
        itemsCount: st.itemsCount,
        totalQty: st.totalQty,
        estimatedCost: st.estCost,
      };
    });

    // 2. Shrinkage Heatmap
    const lossEvents: ShrinkageLossEvent[] = [];
    for (const row of damagedRows) {
      const qty = Math.abs(Number(row.qty || 0));
      const cost = Number(row.total_cost || 0) || qty * Number(row.unit_cost || row.product_cost_price || 0);
      lossEvents.push({
        productId: String(row.product_id),
        productName: String(row.product_name || `#${row.product_id}`),
        locationId: row.location_id ? String(row.location_id) : '',
        locationName: String(row.location_name || 'غير محدد'),
        cause: 'damaged',
        qty,
        cost,
      });
    }
    for (const row of negMovementRows) {
      const qty = Math.abs(Number(row.qty || 0));
      const cost = Math.abs(Number(row.total_cost || 0)) || qty * Number(row.unit_cost || row.product_cost_price || 0);
      const mt = String(row.movement_type || '');
      const cause: ShrinkageLossEvent['cause'] =
        mt === 'stock_count_loss'
          ? 'count_shortage'
          : mt === 'transfer_shortage'
            ? 'transfer_shortage'
            : 'negative_adjustment';
      lossEvents.push({
        productId: String(row.product_id),
        productName: String(row.product_name || `#${row.product_id}`),
        locationId: row.location_id ? String(row.location_id) : '',
        locationName: String(row.location_name || 'غير محدد'),
        cause,
        qty,
        cost,
      });
    }
    const heatmap = buildShrinkageHeatmap(lossEvents, 10);
    const hotSkusCount = Number(hotSkusCountRow?.cnt || 0);

    // 3. Shift Cash Variances
    const shiftVariances = shiftRows.map((s) => ({
      shiftId: String(s.id),
      docNo: String(s.doc_no || `SH-${s.id}`),
      cashierName: String(s.cashier_name || 'كاشير'),
      terminalCode: String(s.terminal_code || 'POS'),
      expectedCash: Number(s.expected_cash || 0),
      countedCash: Number(s.counted_cash || 0),
      variance: Number(s.variance || 0),
      varianceResolution: String(s.variance_resolution || ''),
      closedAt: s.closed_at ? new Date(s.closed_at).toISOString() : '',
    }));
    const shortageShifts = shiftVariances.filter((s) => s.variance < -0.01);
    const totalShiftShortageAmount = Number(
      shortageShifts.reduce((sum, s) => sum + Math.abs(s.variance), 0).toFixed(2),
    );

    // 4. Delivery Custodies
    const overdueCutoffMs =
      now.getTime() - Math.max(1, Number(antiTheftSettings.deliveryOverdueHours || 20)) * 3_600_000;
    const defaultCap = Number(antiTheftSettings.defaultDeliveryCustodyCap || 0);
    const salesByRep = new Map<number, { count: number; overdue: number; cash: number; oldestMs: number | null }>();
    for (const s of unsettledSalesRows) {
      const repId = Number(s.delivery_rep_id || 0);
      if (!repId) continue;
      const remaining = Math.max(0, Number(s.total || 0) - Number(s.paid_amount || 0));
      const createdMs = s.created_at ? new Date(s.created_at as any).getTime() : now.getTime();
      const bucket = salesByRep.get(repId) || { count: 0, overdue: 0, cash: 0, oldestMs: null };
      bucket.count += 1;
      bucket.cash += remaining;
      if (createdMs <= overdueCutoffMs) bucket.overdue += 1;
      if (bucket.oldestMs === null || createdMs < bucket.oldestMs) bucket.oldestMs = createdMs;
      salesByRep.set(repId, bucket);
    }

    let totalUnsettledDeliveryCash = 0;
    let overdueDeliveryOrdersCount = 0;
    let overCapRepsCount = 0;

    const deliveryCustodies = deliveryRepRows
      .map((rep) => {
        const stats = salesByRep.get(Number(rep.id)) || { count: 0, overdue: 0, cash: 0, oldestMs: null };
        const cap =
          rep.max_cash_custody_limit !== null && rep.max_cash_custody_limit !== undefined
            ? Number(rep.max_cash_custody_limit)
            : defaultCap;
        const unsettledCash = Number(stats.cash.toFixed(2));
        const isOverCap = cap > 0 && unsettledCash > cap;
        totalUnsettledDeliveryCash += unsettledCash;
        overdueDeliveryOrdersCount += stats.overdue;
        if (isOverCap) overCapRepsCount += 1;
        return {
          repId: String(rep.id),
          repName: String(rep.name || ''),
          phone: String(rep.phone || ''),
          unsettledOrdersCount: stats.count,
          overdueOrdersCount: stats.overdue,
          unsettledCash,
          custodyCap: cap,
          isOverCap,
          oldestUnsettledAt: stats.oldestMs ? new Date(stats.oldestMs).toISOString() : null,
        };
      })
      .filter((r) => r.unsettledOrdersCount > 0 || r.custodyCap > 0)
      .sort((a, b) => b.unsettledCash - a.unsettledCash);

    const totalFinancialExposure = Number(
      (Number(posSummary.estimatedProtectedLoss || 0) + heatmap.totalLossCost + totalShiftShortageAmount).toFixed(2),
    );
    const highRiskCashiersCount = (posSummary.cashiers || []).filter((c) => c.riskLevel === 'high').length;
    const criticalAlertsCount =
      highRiskCashiersCount +
      overdueTransfersCount +
      overCapRepsCount +
      (overdueDeliveryOrdersCount > 0 ? 1 : 0) +
      Number(posSummary.peerBenchmarks?.flaggedCashiersCount || 0);

    return {
      timeframe,
      antiTheftSettings,
      posRadar: {
        summary: posSummary,
        events: posEvents,
      },
      inTransitCustody: {
        alertThresholdHours: alertHours,
        openCount: transfers.length,
        overdueCount: overdueTransfersCount,
        totalEstimatedCost: Number(totalInTransitCost.toFixed(2)),
        transfers,
      },
      shrinkage: {
        hotSkusCount,
        ...heatmap,
      },
      shiftsAndDelivery: {
        totalShiftShortageAmount,
        shortageShiftsCount: shortageShifts.length,
        shiftVariances,
        totalUnsettledDeliveryCash: Number(totalUnsettledDeliveryCash.toFixed(2)),
        overdueDeliveryOrdersCount,
        overCapRepsCount,
        deliveryCustodies,
      },
      headlineMetrics: {
        totalFinancialExposure,
        criticalAlertsCount,
        highRiskCashiersCount,
        overdueTransfersCount,
        overdueDeliveriesCount: overdueDeliveryOrdersCount,
        hotSkusCount,
      },
    };
  }
}
