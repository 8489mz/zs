import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import { AuditService } from '../../../core/audit/audit.service';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { AppError } from '../../../common/errors/app-error';
import {
  buildShrinkageHeatmap,
  computeDailyFlowReconciliation,
  type ShrinkageLossEvent,
} from '../engines/shrinkage-reconciliation.engine';

@Injectable()
export class LossPreventionInventoryService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly audit: AuditService,
  ) {}

  async listHotSkus(
    query: { locationId?: number; search?: string },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const locId = query.locationId && Number.isFinite(Number(query.locationId)) ? Number(query.locationId) : null;

    const hotProducts = await this.db
      .selectFrom('products as p')
      .leftJoin('product_categories as c', (j) => j.onRef('c.id', '=', 'p.category_id').onRef('c.tenant_id', '=', 'p.tenant_id'))
      .select([
        'p.id',
        'p.name',
        'p.barcode',
        'p.cost_price',
        'p.retail_price',
        'p.stock_qty',
        'p.is_high_risk_shrinkage',
        'c.name as category_name',
      ])
      .where('p.tenant_id', '=', scope.tenantId)
      .where('p.is_active', '=', true)
      .where('p.is_high_risk_shrinkage', '=', true)
      .orderBy('p.cost_price', 'desc')
      .execute();

    const productIds = hotProducts.map((p) => Number(p.id));
    const locationStockMap = new Map<number, number>();
    if (locId && productIds.length) {
      const stocks = await this.db
        .selectFrom('product_location_stock')
        .select(['product_id', 'qty'])
        .where('tenant_id', '=', scope.tenantId)
        .where('location_id', '=', locId)
        .where('product_id', 'in', productIds)
        .execute();
      for (const s of stocks) {
        locationStockMap.set(Number(s.product_id), Number(s.qty || 0));
      }
    }

    // Suggest top high-value non-tagged products so owner can one-click tag them
    const suggestedCandidates = await this.db
      .selectFrom('products as p')
      .select(['p.id', 'p.name', 'p.barcode', 'p.cost_price', 'p.retail_price', 'p.stock_qty'])
      .where('p.tenant_id', '=', scope.tenantId)
      .where('p.is_active', '=', true)
      .where('p.is_high_risk_shrinkage', '=', false)
      .orderBy('p.cost_price', 'desc')
      .limit(15)
      .execute();

    return {
      hotSkus: hotProducts.map((p) => ({
        id: String(p.id),
        name: String(p.name || ''),
        barcode: String(p.barcode || ''),
        categoryName: String(p.category_name || ''),
        costPrice: Number(p.cost_price || 0),
        salePrice: Number(p.retail_price || 0),
        globalStockQty: Number(p.stock_qty || 0),
        locationStockQty: locId ? (locationStockMap.get(Number(p.id)) ?? 0) : null,
        isHighRiskShrinkage: true,
      })),
      suggestedCandidates: suggestedCandidates.map((p) => ({
        id: String(p.id),
        name: String(p.name || ''),
        barcode: String(p.barcode || ''),
        costPrice: Number(p.cost_price || 0),
        salePrice: Number(p.retail_price || 0),
        globalStockQty: Number(p.stock_qty || 0),
      })),
    };
  }

  async toggleHotSku(
    productId: number,
    isHighRiskShrinkage: boolean,
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const product = await this.db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true)
      .executeTakeFirst();
    if (!product) {
      throw new AppError('الصنف غير موجود', 'PRODUCT_NOT_FOUND', 404);
    }

    await this.db
      .updateTable('products')
      .set({ is_high_risk_shrinkage: Boolean(isHighRiskShrinkage), updated_at: sql`NOW()` })
      .where('id', '=', productId)
      .where('tenant_id', '=', scope.tenantId)
      .execute();

    await this.audit.log(
      isHighRiskShrinkage ? 'وسم صنف عالي الخطورة للفاقد' : 'إزالة وسم الصنف عالي الخطورة',
      `الصنف: ${product.name} (#${productId})`,
      auth,
    );

    return { ok: true, productId: String(productId), isHighRiskShrinkage: Boolean(isHighRiskShrinkage) };
  }

  async getShrinkageReport(
    query: { timeframe?: string; locationId?: number },
    auth: AuthContext,
  ): Promise<Record<string, unknown>> {
    const scope = requireTenantScope(auth);
    const timeframe = String(query.timeframe || '30days');
    const now = new Date();
    const startDate = new Date(now);
    if (timeframe === 'today') {
      startDate.setHours(0, 0, 0, 0);
    } else if (timeframe === '7days') {
      startDate.setDate(startDate.getDate() - 7);
    } else {
      startDate.setDate(startDate.getDate() - 30);
    }
    const locId = query.locationId && Number.isFinite(Number(query.locationId)) ? Number(query.locationId) : null;

    // 1. Damaged stock records
    let dmgQuery = this.db
      .selectFrom('damaged_stock_records as d')
      .leftJoin('products as p', (j) => j.onRef('p.id', '=', 'd.product_id').onRef('p.tenant_id', '=', 'd.tenant_id'))
      .leftJoin('stock_locations as l', (j) => j.onRef('l.id', '=', 'd.location_id').onRef('l.tenant_id', '=', 'd.tenant_id'))
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
      .where('d.created_at', '>=', startDate);
    if (locId) dmgQuery = dmgQuery.where('d.location_id', '=', locId);

    // 2. Negative stock movements (manual deduct/adjust, count losses, transfer shortages)
    let movQuery = this.db
      .selectFrom('stock_movements as m')
      .leftJoin('products as p', (j) => j.onRef('p.id', '=', 'm.product_id').onRef('p.tenant_id', '=', 'm.tenant_id'))
      .leftJoin('stock_locations as l', (j) => j.onRef('l.id', '=', 'm.location_id').onRef('l.tenant_id', '=', 'm.tenant_id'))
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
      .where('m.movement_type', 'in', ['deduct', 'adjust', 'stock_count_loss', 'transfer_shortage']);
    if (locId) movQuery = movQuery.where('m.location_id', '=', locId);

    const [damagedRows, movementRows] = await Promise.all([dmgQuery.execute(), movQuery.execute()]);

    const events: ShrinkageLossEvent[] = [];

    for (const row of damagedRows) {
      const qty = Math.abs(Number(row.qty || 0));
      const cost = Number(row.total_cost || 0) || qty * Number(row.unit_cost || row.product_cost_price || 0);
      events.push({
        productId: String(row.product_id),
        productName: String(row.product_name || `#${row.product_id}`),
        locationId: row.location_id ? String(row.location_id) : '',
        locationName: String(row.location_name || 'غير محدد'),
        cause: 'damaged',
        qty,
        cost,
      });
    }

    for (const row of movementRows) {
      const qty = Math.abs(Number(row.qty || 0));
      const cost =
        Math.abs(Number(row.total_cost || 0)) || qty * Number(row.unit_cost || row.product_cost_price || 0);
      const mType = String(row.movement_type || '');
      let cause: ShrinkageLossEvent['cause'] = 'negative_adjustment';
      if (mType === 'stock_count_loss') cause = 'count_shortage';
      else if (mType === 'transfer_shortage') cause = 'transfer_shortage';
      events.push({
        productId: String(row.product_id),
        productName: String(row.product_name || `#${row.product_id}`),
        locationId: row.location_id ? String(row.location_id) : '',
        locationName: String(row.location_name || 'غير محدد'),
        cause,
        qty,
        cost,
      });
    }

    const heatmap = buildShrinkageHeatmap(events, 10);

    // 3. Hot SKUs daily flow snapshot (today's inflows vs outflows at target location or all locations)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const hotProducts = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'cost_price', 'stock_qty'])
      .where('tenant_id', '=', scope.tenantId)
      .where('is_active', '=', true)
      .where('is_high_risk_shrinkage', '=', true)
      .limit(50)
      .execute();

    let dailyHotSkuFlows: ReturnType<typeof computeDailyFlowReconciliation> = [];
    if (hotProducts.length) {
      const hotIds = hotProducts.map((p) => Number(p.id));
      let flowQuery = this.db
        .selectFrom('stock_movements')
        .select([
          'product_id',
          'movement_type',
          sql<number>`COALESCE(SUM(qty), 0)`.as('net_qty'),
        ])
        .where('tenant_id', '=', scope.tenantId)
        .where('product_id', 'in', hotIds)
        .where('created_at', '>=', todayStart)
        .groupBy(['product_id', 'movement_type']);
      if (locId) flowQuery = flowQuery.where('location_id', '=', locId);

      const flowRows = await flowQuery.execute();
      const flowByProduct = new Map<
        number,
        { transferredIn: number; purchased: number; transferredOut: number; sold: number; damaged: number; netDelta: number }
      >();
      for (const fr of flowRows) {
        const pid = Number(fr.product_id);
        const bucket = flowByProduct.get(pid) || {
          transferredIn: 0,
          purchased: 0,
          transferredOut: 0,
          sold: 0,
          damaged: 0,
          netDelta: 0,
        };
        const q = Number(fr.net_qty || 0);
        const mt = String(fr.movement_type || '');
        bucket.netDelta += q;
        if (mt === 'transfer_receive' || mt === 'stock_assign') bucket.transferredIn += Math.max(0, q);
        else if (mt === 'purchase' || mt === 'purchase_receive') bucket.purchased += Math.max(0, q);
        else if (mt === 'transfer_send' || mt === 'transfer_final_issue') bucket.transferredOut += Math.abs(Math.min(0, q));
        else if (mt === 'sale' || mt === 'pos_sale') bucket.sold += Math.abs(Math.min(0, q));
        else if (mt === 'damaged') bucket.damaged += Math.abs(Math.min(0, q));
        flowByProduct.set(pid, bucket);
      }

      // Check if any posted or draft stock count exists today for these hot SKUs
      let countQuery = this.db
        .selectFrom('stock_count_items as ci')
        .innerJoin('stock_count_sessions as cs', (j) => j.onRef('cs.id', '=', 'ci.session_id').onRef('cs.tenant_id', '=', 'ci.tenant_id'))
        .select(['ci.product_id', 'ci.counted_qty', 'cs.created_at'])
        .where('ci.tenant_id', '=', scope.tenantId)
        .where('ci.product_id', 'in', hotIds)
        .where('cs.created_at', '>=', todayStart)
        .orderBy('cs.created_at', 'desc');
      if (locId) countQuery = countQuery.where('cs.location_id', '=', locId);
      const latestCounts = await countQuery.execute();
      const latestCountMap = new Map<number, number>();
      for (const c of latestCounts) {
        const pid = Number(c.product_id);
        if (!latestCountMap.has(pid)) {
          latestCountMap.set(pid, Number(c.counted_qty || 0));
        }
      }

      const locStockMap = new Map<number, number>();
      if (locId) {
        const ls = await this.db
          .selectFrom('product_location_stock')
          .select(['product_id', 'qty'])
          .where('tenant_id', '=', scope.tenantId)
          .where('location_id', '=', locId)
          .where('product_id', 'in', hotIds)
          .execute();
        for (const row of ls) locStockMap.set(Number(row.product_id), Number(row.qty || 0));
      }

      dailyHotSkuFlows = computeDailyFlowReconciliation(
        hotProducts.map((p) => {
          const pid = Number(p.id);
          const flow = flowByProduct.get(pid) || {
            transferredIn: 0,
            purchased: 0,
            transferredOut: 0,
            sold: 0,
            damaged: 0,
            netDelta: 0,
          };
          const currentBook = locId ? (locStockMap.get(pid) ?? 0) : Number(p.stock_qty || 0);
          const openingQty = Number((currentBook - flow.netDelta).toFixed(3));
          return {
            productId: String(pid),
            productName: String(p.name || ''),
            locationId: locId ? String(locId) : '',
            locationName: locId ? `مخزن #${locId}` : 'كافة المواقع',
            unitCost: Number(p.cost_price || 0),
            openingQty,
            transferredInQty: flow.transferredIn,
            purchasedQty: flow.purchased,
            transferredOutQty: flow.transferredOut,
            soldQty: flow.sold,
            recordedDamagedQty: flow.damaged,
            physicalCountedQty: latestCountMap.has(pid) ? latestCountMap.get(pid)! : null,
          };
        }),
      );
    }

    return {
      timeframe,
      heatmap,
      dailyHotSkuFlows,
    };
  }
}
