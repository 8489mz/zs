import { Kysely } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { ReportRangeQueryDto } from '../dto/report-query.dto';
import { parseRange } from './reports-range.helper';

export interface MenuEngineeringItem {
  productId: number;
  productName: string;
  categoryName: string;
  qtySold: number;
  unitPrice: number;
  unitCost: number;
  unitMargin: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  foodCostPercentage: number;
  popularityShare: number;
  quadrant: 'star' | 'plowhorse' | 'puzzle' | 'dog';
  quadrantLabelAr: string;
  recommendation: string;
}

export interface MenuEngineeringSummary {
  totalItems: number;
  totalUnitsSold: number;
  totalRevenue: number;
  totalCost: number;
  totalMargin: number;
  overallFoodCostPercentage: number;
  averageUnitMargin: number;
  popularityHurdleRate: number;
  starCount: number;
  plowhorseCount: number;
  puzzleCount: number;
  dogCount: number;
  potentialProfitUplift: number;
}

export interface QuadrantClassification {
  quadrant: 'star' | 'plowhorse' | 'puzzle' | 'dog';
  quadrantLabelAr: string;
  recommendation: string;
}

export function classifyMenuEngineeringQuadrant(
  popularityShare: number,
  hurdlePopularity: number,
  unitMargin: number,
  avgMarginPerUnit: number,
): QuadrantClassification {
  const isHighPopularity = popularityShare >= hurdlePopularity;
  const isHighMargin = unitMargin >= avgMarginPerUnit;

  if (isHighMargin && isHighPopularity) {
    return {
      quadrant: 'star',
      quadrantLabelAr: 'نجم (Star)',
      recommendation: 'صنف بطل في المنيو: حافظ على ثبات جودته وموقعه المميز في القائمة.',
    };
  } else if (!isHighMargin && isHighPopularity) {
    return {
      quadrant: 'plowhorse',
      quadrantLabelAr: 'حصان جر (Plowhorse)',
      recommendation: 'صنف مرتفع المبيعات بربحية منخفضة: ارفع السعر بنسبة 5-8% أو قلل تكلفة مكوناته لتحسين الهامش.',
    };
  } else if (isHighMargin && !isHighPopularity) {
    return {
      quadrant: 'puzzle',
      quadrantLabelAr: 'لغز (Puzzle)',
      recommendation:
        'صنف عالي الربحية لكنه قليل الطلب: أعد إبرازه في المنيو ودرّب فريق الصالة على اقتراحه (Upselling).',
    };
  } else {
    return {
      quadrant: 'dog',
      quadrantLabelAr: 'صنف خاسر (Dog)',
      recommendation: 'صنف ضعيف المبيعات والربح: ادرسه بعناية وفكر في حذفه من القائمة لتوفير الهدر ومساحة التخزين.',
    };
  }
}

export async function buildMenuEngineeringReport(
  db: Kysely<Database>,
  query: ReportRangeQueryDto,
  auth: AuthContext,
  // Tenant business timezone for the default range. Callers with a
  // tenant pass the resolved zone; without it parseRange falls back
  // to the canonical env-or-Cairo default, never UTC.
  timezone?: string,
): Promise<{ summary: MenuEngineeringSummary; items: MenuEngineeringItem[] }> {
  const scope = requireTenantScope(auth);
  const range = parseRange(query, timezone);
  const fromDate = new Date(range.from);
  const toDate = new Date(range.to);

  // 1. Fetch sales items during the range with product & category info
  let salesQuery = db
    .selectFrom('sale_items as si')
    .innerJoin('sales as s', (j) => j.onRef('s.id', '=', 'si.sale_id').onRef('s.tenant_id', '=', 'si.tenant_id'))
    .innerJoin('products as p', (j) => j.onRef('p.id', '=', 'si.product_id').onRef('p.tenant_id', '=', 'si.tenant_id'))
    .leftJoin('product_categories as c', (join) =>
      join.onRef('c.id', '=', 'p.category_id').onRef('c.tenant_id', '=', 'p.tenant_id'),
    )
    .select([
      'si.product_id',
      'si.qty',
      'si.unit_price',
      'si.line_total',
      'p.name as product_name',
      'p.cost_price',
      'p.retail_price as catalog_price',
      'c.name as category_name',
    ] as const)
    .where('si.tenant_id', '=', scope.tenantId)
    .where('s.status', '=', 'posted')
    .where('s.created_at', '>=', fromDate)
    .where('s.created_at', '<=', toDate);

  if (query.branchId) {
    salesQuery = salesQuery.where('s.branch_id', '=', Number(query.branchId));
  }

  const rawRows = await salesQuery.execute();

  // 2. Aggregate per product
  const productAggMap = new Map<
    number,
    {
      productId: number;
      productName: string;
      categoryName: string;
      qtySold: number;
      totalRevenue: number;
      costPrice: number;
      unitPrice: number;
    }
  >();

  for (const row of rawRows) {
    const pId = Number(row.product_id);
    const qty = Number(row.qty || 0);
    const total = Number(row.line_total || 0);
    const costPrice = Number(row.cost_price || 0);
    const unitPrice = Number(row.unit_price || row.catalog_price || 0);

    if (!productAggMap.has(pId)) {
      productAggMap.set(pId, {
        productId: pId,
        productName: row.product_name || `صنف #${pId}`,
        categoryName: row.category_name || 'أطباق رئيسية',
        qtySold: 0,
        totalRevenue: 0,
        costPrice: costPrice > 0 ? costPrice : unitPrice * 0.35, // standard 35% food cost estimate if cost not set
        unitPrice,
      });
    }

    const current = productAggMap.get(pId)!;
    current.qtySold += qty;
    current.totalRevenue += total;
  }

  const distinctCount = productAggMap.size;
  if (distinctCount === 0) {
    return {
      summary: {
        totalItems: 0,
        totalUnitsSold: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalMargin: 0,
        overallFoodCostPercentage: 0,
        averageUnitMargin: 0,
        popularityHurdleRate: 0,
        starCount: 0,
        plowhorseCount: 0,
        puzzleCount: 0,
        dogCount: 0,
        potentialProfitUplift: 0,
      },
      items: [],
    };
  }

  // 3. Totals and benchmark hurdles
  let totalUnitsSold = 0;
  let totalRevenueAll = 0;
  let totalCostAll = 0;

  for (const item of productAggMap.values()) {
    totalUnitsSold += item.qtySold;
    totalRevenueAll += item.totalRevenue;
    totalCostAll += item.qtySold * item.costPrice;
  }

  const totalMarginAll = totalRevenueAll - totalCostAll;
  const overallFoodCostPct = totalRevenueAll > 0 ? (totalCostAll / totalRevenueAll) * 100 : 0;
  const avgMarginPerUnit = totalUnitsSold > 0 ? totalMarginAll / totalUnitsSold : 0;
  // Kasavana & Smith Hurdle Rate: 70% of equal popularity share
  const hurdlePopularity = (100 / distinctCount) * 0.7;

  // 4. Classify each item into the 4 BCG quadrants
  let starCount = 0;
  let plowhorseCount = 0;
  let puzzleCount = 0;
  let dogCount = 0;
  let potentialProfitUplift = 0;

  const items: MenuEngineeringItem[] = [];

  for (const item of productAggMap.values()) {
    const totalCost = item.qtySold * item.costPrice;
    const totalMargin = item.totalRevenue - totalCost;
    const unitMargin = item.qtySold > 0 ? totalMargin / item.qtySold : 0;
    const effectiveUnitPrice = item.qtySold > 0 ? item.totalRevenue / item.qtySold : item.unitPrice;
    const foodCostPercentage = item.totalRevenue > 0 ? (totalCost / item.totalRevenue) * 100 : 0;
    const popularityShare = totalUnitsSold > 0 ? (item.qtySold / totalUnitsSold) * 100 : 0;

    const classification = classifyMenuEngineeringQuadrant(
      popularityShare,
      hurdlePopularity,
      unitMargin,
      avgMarginPerUnit,
    );
    const { quadrant, quadrantLabelAr, recommendation } = classification;

    if (quadrant === 'star') {
      starCount++;
    } else if (quadrant === 'plowhorse') {
      plowhorseCount++;
      potentialProfitUplift += totalMargin * 0.15;
    } else if (quadrant === 'puzzle') {
      puzzleCount++;
      potentialProfitUplift += totalMargin * 0.2;
    } else {
      dogCount++;
    }

    items.push({
      productId: item.productId,
      productName: item.productName,
      categoryName: item.categoryName,
      qtySold: Math.round(item.qtySold * 100) / 100,
      unitPrice: Math.round(effectiveUnitPrice * 100) / 100,
      unitCost: Math.round(item.costPrice * 100) / 100,
      unitMargin: Math.round(unitMargin * 100) / 100,
      totalRevenue: Math.round(item.totalRevenue * 100) / 100,
      totalCost: Math.round(totalCost * 100) / 100,
      totalMargin: Math.round(totalMargin * 100) / 100,
      foodCostPercentage: Math.round(foodCostPercentage * 10) / 10,
      popularityShare: Math.round(popularityShare * 10) / 10,
      quadrant,
      quadrantLabelAr,
      recommendation,
    });
  }

  // Sort by totalMargin descending
  items.sort((a, b) => b.totalMargin - a.totalMargin);

  const summary: MenuEngineeringSummary = {
    totalItems: distinctCount,
    totalUnitsSold: Math.round(totalUnitsSold * 100) / 100,
    totalRevenue: Math.round(totalRevenueAll * 100) / 100,
    totalCost: Math.round(totalCostAll * 100) / 100,
    totalMargin: Math.round(totalMarginAll * 100) / 100,
    overallFoodCostPercentage: Math.round(overallFoodCostPct * 10) / 10,
    averageUnitMargin: Math.round(avgMarginPerUnit * 100) / 100,
    popularityHurdleRate: Math.round(hurdlePopularity * 10) / 10,
    starCount,
    plowhorseCount,
    puzzleCount,
    dogCount,
    potentialProfitUplift: Math.round(potentialProfitUplift * 100) / 100,
  };

  return { summary, items };
}
