import { Inject, Injectable, BadRequestException } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { InventoryScopeService } from './inventory-scope.service';
import { InventoryTransferService } from './inventory-transfer.service';

export interface AlternativeLocationStock {
  locationId: number;
  locationName: string;
  qty: number;
}

export interface ReplenishmentSuggestionItem {
  productId: number;
  productName: string;
  barcode: string;
  currentShopStock: number;
  warehouseStock: number;
  totalEnterpriseStock: number;
  alternativeLocations: AlternativeLocationStock[];
  sold48h: number;
  dailySalesRate: number;
  daysOfSupplyRemaining: number;
  recommendedPurchaseDeadline?: string;
  suggestedQty: number;
  reorderPoint: number;
  costPrice: number;
  salePrice: number;
  cartonMultiplier?: number;
  cartonName?: string;
  cartonsCount?: number;
  urgency: 'out_of_stock' | 'low_stock' | 'sales_replenish' | 'unavailable_in_source';
}

@Injectable()
export class InventoryReplenishmentService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly scopeService: InventoryScopeService,
    private readonly transferService: InventoryTransferService,
  ) {}

  async getSuggestions(
    params: { fromLocationId: number; toLocationId: number; coverDays?: number },
    auth: AuthContext,
  ): Promise<{
    fromLocation: { id: number; name: string };
    toLocation: { id: number; name: string };
    items: ReplenishmentSuggestionItem[];
    totalItems: number;
    totalSuggestedQty: number;
    coverageHours: number;
  }> {
    const { tenantId } = requireTenantScope(auth);
    const coverDays = Math.max(1, Math.min(Number(params.coverDays) || 2, 7));
    const coverageHours = coverDays * 24;

    const fromLoc = await this.scopeService.assertLocationScope(params.fromLocationId, auth, false, 'read');
    const toLoc = await this.scopeService.assertLocationScope(params.toLocationId, auth, false, 'read');

    if (fromLoc.id === toLoc.id) {
      throw new BadRequestException('يجب أن يكون المخزن المصدر مختلفاً عن موقع المحل');
    }

    // 1. Fetch all locations for multi-warehouse awareness
    const allLocations = await this.db
      .selectFrom('stock_locations')
      .select(['id', 'name'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .execute();

    const locationNameMap = new Map<number, string>();
    for (const l of allLocations) {
      locationNameMap.set(Number(l.id), l.name || `مخزن #${l.id}`);
    }

    // 2. Fetch active products
    const products = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'barcode', 'min_stock_qty', 'cost_price', 'retail_price', 'stock_qty'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .execute();

    if (!products.length) {
      return {
        fromLocation: { id: fromLoc.id, name: fromLoc.name },
        toLocation: { id: toLoc.id, name: toLoc.name },
        items: [],
        totalItems: 0,
        totalSuggestedQty: 0,
        coverageHours,
      };
    }

    const productIds = products.map((p) => p.id);

    // 3. Fetch stock levels across ALL locations of the enterprise
    const allStocks = await this.db
      .selectFrom('product_location_stock')
      .select(['product_id', 'location_id', 'qty'])
      .where('tenant_id', '=', tenantId)
      .where('product_id', 'in', productIds)
      .execute();

    // Map: productId -> locationId -> qty
    const productLocationStockMap = new Map<number, Map<number, number>>();
    const productTotalEnterpriseStockMap = new Map<number, number>();

    for (const s of allStocks) {
      const pid = Number(s.product_id);
      const locId = Number(s.location_id);
      const qty = Number(s.qty || 0);

      if (!productLocationStockMap.has(pid)) {
        productLocationStockMap.set(pid, new Map());
      }
      productLocationStockMap.get(pid)!.set(locId, qty);

      const curTotal = productTotalEnterpriseStockMap.get(pid) || 0;
      productTotalEnterpriseStockMap.set(pid, curTotal + qty);
    }

    // 4. Fetch sales velocity in the destination location over the coverage period
    const intervalString = `${coverageHours} hours`;
    const salesVelocityRows = await this.db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select(['si.product_id', sql<number>`SUM(si.qty)`.as('sold_qty')])
      .where('s.tenant_id', '=', tenantId)
      .where((eb) =>
        eb.or([
          eb('s.location_id', '=', toLoc.id),
          toLoc.branchId ? eb('s.branch_id', '=', toLoc.branchId) : eb.val(false),
        ]),
      )
      .where('s.status', '!=', 'cancelled')
      .where(sql<boolean>`s.created_at >= NOW() - ${intervalString}::interval`)
      .groupBy('si.product_id')
      .execute();

    const salesMap = new Map<number, number>();
    for (const row of salesVelocityRows) {
      if (row.product_id) {
        salesMap.set(Number(row.product_id), Number(row.sold_qty || 0));
      }
    }

    // 5. Fetch packaging units (cartons / packs)
    const unitsRows = await this.db
      .selectFrom('product_units')
      .select(['product_id', 'name', 'multiplier'])
      .where('tenant_id', '=', tenantId)
      .where('multiplier', '>', 1)
      .where('product_id', 'in', productIds)
      .orderBy('multiplier', 'asc')
      .execute();

    const packagingUnitMap = new Map<number, { name: string; multiplier: number }>();
    for (const u of unitsRows) {
      const pid = Number(u.product_id);
      if (!packagingUnitMap.has(pid)) {
        packagingUnitMap.set(pid, { name: u.name || 'كرتونة', multiplier: Number(u.multiplier || 1) });
      }
    }

    // 6. Evaluate replenishment candidates with multi-warehouse awareness & purchase deadline
    const candidates: ReplenishmentSuggestionItem[] = [];

    for (const product of products) {
      const pid = product.id;
      const locStocks = productLocationStockMap.get(pid) || new Map();
      const shopStock = locStocks.get(toLoc.id) || 0;
      const warehouseStock = locStocks.get(fromLoc.id) || 0;
      const totalEnterpriseStock = productTotalEnterpriseStockMap.get(pid) || Number(product.stock_qty || 0);

      // Alternatives across the other 5+ warehouses
      const alternativeLocations: AlternativeLocationStock[] = [];
      locStocks.forEach((qty, locId) => {
        if (locId !== fromLoc.id && locId !== toLoc.id && qty > 0) {
          alternativeLocations.push({
            locationId: locId,
            locationName: locationNameMap.get(locId) || `مخزن #${locId}`,
            qty,
          });
        }
      });

      const soldQty = salesMap.get(pid) || 0;
      const reorderPoint = Number(product.min_stock_qty || 0);

      const isOutOfStock = shopStock <= 0;
      const isLowStock = reorderPoint > 0 && shopStock <= reorderPoint;
      const hasRecentSales = soldQty > 0;

      if (!isOutOfStock && !isLowStock && !hasRecentSales) {
        continue;
      }

      // Calculate Target Requirement for 48h (or coverDays)
      let targetRequirement = 0;
      if (soldQty > 0) {
        targetRequirement += soldQty;
      }
      if (reorderPoint > 0) {
        targetRequirement = Math.max(targetRequirement, reorderPoint * 2);
      } else {
        targetRequirement = Math.max(targetRequirement, 6);
      }

      const deficit = targetRequirement - shopStock;
      if (deficit <= 0 && soldQty === 0) {
        continue;
      }

      let rawNeeded = Math.max(1, deficit > 0 ? deficit : soldQty);

      // Package / Carton rounding
      const packUnit = packagingUnitMap.get(pid);
      let cartonName: string | undefined;
      let cartonMultiplier: number | undefined;
      let cartonsCount: number | undefined;

      if (packUnit && packUnit.multiplier > 1) {
        cartonMultiplier = packUnit.multiplier;
        cartonName = packUnit.name;
        cartonsCount = Math.ceil(rawNeeded / cartonMultiplier);
        rawNeeded = cartonsCount * cartonMultiplier;
      }

      // Propose quantity bounded by warehouse stock:
      // CRITICAL: If warehouseStock is 0, NEVER propose drawing from this warehouse! Set to 0!
      const isUnavailableInSource = warehouseStock <= 0;
      const suggestedQty = isUnavailableInSource ? 0 : Math.min(rawNeeded, warehouseStock);

      let urgency: 'out_of_stock' | 'low_stock' | 'sales_replenish' | 'unavailable_in_source' = 'sales_replenish';
      if (isUnavailableInSource) {
        urgency = 'unavailable_in_source';
      } else if (isOutOfStock) {
        urgency = 'out_of_stock';
      } else if (isLowStock) {
        urgency = 'low_stock';
      }

      // Predictive Purchase Deadline based on Enterprise-wide velocity
      const dailySalesRate = Number((soldQty / coverDays).toFixed(1));
      let daysOfSupplyRemaining = 999;
      let recommendedPurchaseDeadline: string | undefined;

      if (dailySalesRate > 0) {
        daysOfSupplyRemaining = Math.max(0, Math.floor(totalEnterpriseStock / dailySalesRate));
        if (daysOfSupplyRemaining <= 7) {
          const deadlineDate = new Date();
          deadlineDate.setDate(deadlineDate.getDate() + Math.max(1, daysOfSupplyRemaining - 1));
          recommendedPurchaseDeadline = deadlineDate.toLocaleDateString('ar-EG', {
            weekday: 'long',
            day: 'numeric',
            month: 'long',
          });
        }
      }

      candidates.push({
        productId: pid,
        productName: product.name || `صنف #${pid}`,
        barcode: product.barcode || '',
        currentShopStock: shopStock,
        warehouseStock,
        totalEnterpriseStock,
        alternativeLocations,
        sold48h: soldQty,
        dailySalesRate,
        daysOfSupplyRemaining,
        recommendedPurchaseDeadline,
        suggestedQty,
        reorderPoint,
        costPrice: Number(product.cost_price || 0),
        salePrice: Number(product.retail_price || 0),
        cartonMultiplier,
        cartonName,
        cartonsCount,
        urgency,
      });
    }

    // Sort: available items first (out_of_stock -> low_stock -> sales_replenish), unavailable at end
    candidates.sort((a, b) => {
      const order = { out_of_stock: 0, low_stock: 1, sales_replenish: 2, unavailable_in_source: 3 };
      if (order[a.urgency] !== order[b.urgency]) {
        return order[a.urgency] - order[b.urgency];
      }
      return b.sold48h - a.sold48h;
    });

    const totalSuggestedQty = candidates.reduce((sum, c) => sum + c.suggestedQty, 0);

    return {
      fromLocation: { id: fromLoc.id, name: fromLoc.name },
      toLocation: { id: toLoc.id, name: toLoc.name },
      items: candidates,
      totalItems: candidates.length,
      totalSuggestedQty,
      coverageHours,
    };
  }

  async executeReplenishment(
    payload: {
      fromLocationId: number;
      toLocationId: number;
      items: { productId: number; qty: number }[];
      note?: string;
    },
    auth: AuthContext,
  ): Promise<{
    ok: boolean;
    transferId: number;
    docNo: string;
    itemsCount: number;
    totalQty: number;
  }> {
    if (!payload.items || !payload.items.length) {
      throw new BadRequestException('يجب تحديد صنف واحد على الأقل لإتمام التحويل');
    }

    const cleanedItems = payload.items
      .map((it) => ({
        productId: Number(it.productId),
        qty: Number(it.qty || 0),
      }))
      .filter((it) => it.productId > 0 && it.qty > 0);

    if (!cleanedItems.length) {
      throw new BadRequestException('الكميات المحددة للأصناف يجب أن تكون أكبر من صفر');
    }

    const note = payload.note || 'إذن إمداد أرفف ذكي معتمد آلياً';

    const result = await this.transferService.internalTransferProducts(
      {
        fromLocationId: Number(payload.fromLocationId),
        toLocationId: Number(payload.toLocationId),
        items: cleanedItems,
        note,
      },
      auth,
    );

    const totalQty = cleanedItems.reduce((acc, it) => acc + it.qty, 0);

    return {
      ok: true,
      transferId: Number(result.transferId || 0),
      docNo: String(result.docNo || 'TR-AUTO'),
      itemsCount: cleanedItems.length,
      totalQty,
    };
  }
}
