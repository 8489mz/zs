import { Inject, Injectable } from '@nestjs/common';
import { Kysely, sql } from '../../../database/kysely';
import { AppError } from '../../../common/errors/app-error';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { KYSELY_DB } from '../../../database/database.constants';
import { Database } from '../../../database/database.types';
import {
  buildReorderAnalysis,
  ReorderProductInput,
  ReorderSupplierInput,
  ReorderAnalysisResult,
  BuildReorderOptions,
} from '../helpers/purchases-reorder.helper';
import { PurchasesWriteService } from './purchases-write.service';
import { tenantBaseCurrency } from '../../accounting/accounting-currency';
import { currencyMoneyDigits, roundMoney } from '../../accounting/engines/money-minor-units.engine';

export interface GenerateDraftOrdersItemDto {
  productId: number;
  qty: number;
  cost?: number;
  name?: string;
}

export interface GenerateDraftOrdersGroupDto {
  supplierId: number;
  locationId?: number;
  notes?: string;
  items: GenerateDraftOrdersItemDto[];
}

export interface GenerateDraftOrdersPayload {
  orders: GenerateDraftOrdersGroupDto[];
  notes?: string;
}

@Injectable()
export class PurchasesReorderService {
  constructor(
    @Inject(KYSELY_DB) private readonly db: Kysely<Database>,
    private readonly writeService: PurchasesWriteService,
  ) {}

  async getReorderSuggestions(auth: AuthContext, query: Record<string, unknown>): Promise<ReorderAnalysisResult> {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;
    const moneyDigits = currencyMoneyDigits(await tenantBaseCurrency(this.db, tenantId));

    const daysAnalysis = Math.max(1, Number(query.daysAnalysis || 30));
    const targetCoverageDays = Math.max(1, Number(query.targetCoverageDays || 30));
    const defaultLeadTimeDays = Math.max(1, Number(query.defaultLeadTimeDays || 3));
    const supplierId = query.supplierId ? Number(query.supplierId) : undefined;
    const urgencyFilter = (query.urgencyFilter as BuildReorderOptions['urgencyFilter']) || 'needs_reorder';
    const search = typeof query.search === 'string' ? query.search.trim().toLowerCase() : '';

    // 1. Query active products for this tenant
    let productsQuery = this.db
      .selectFrom('products as p')
      .leftJoin('product_categories as pc', 'pc.id', 'p.category_id')
      .select([
        'p.id',
        'p.name',
        'p.barcode',
        'p.stock_qty',
        'p.min_stock_qty',
        'p.cost_price',
        'p.retail_price',
        'p.supplier_id',
        'p.category_id',
        'p.default_location_id',
        'pc.name as category_name',
      ])
      .where('p.tenant_id', '=', tenantId)
      .where('p.is_active', '=', true);

    if (supplierId) {
      productsQuery = productsQuery.where('p.supplier_id', '=', supplierId);
    }

    const rawProducts = await productsQuery.execute();

    // 2. Query sales in the analysis window (last N days)
    const now = new Date();
    const startDate = new Date(now.getTime() - daysAnalysis * 24 * 60 * 60 * 1000);

    const recentSales = await this.db
      .selectFrom('sale_items as si')
      .innerJoin('sales as s', 's.id', 'si.sale_id')
      .select([
        'si.product_id',
        sql<number>`COALESCE(SUM(si.qty), 0)`.as('qty_sold'),
      ])
      .where('s.tenant_id', '=', tenantId)
      .where('s.status', '=', 'posted')
      .where('s.created_at', '>=', startDate)
      .groupBy('si.product_id')
      .execute();

    const salesMap = new Map<number, number>();
    for (const row of recentSales) {
      salesMap.set(Number(row.product_id), Number(row.qty_sold || 0));
    }

    // 3. For products without an assigned supplier_id, look up the most recent purchase supplier
    const unassignedProductIds = rawProducts.filter((p) => !p.supplier_id).map((p) => Number(p.id));
    const resolvedSupplierMap = new Map<number, number>();

    if (unassignedProductIds.length > 0) {
      const recentPurchases = await this.db
        .selectFrom('purchase_items as pi')
        .innerJoin('purchases as p', 'p.id', 'pi.purchase_id')
        .select(['pi.product_id', 'p.supplier_id', 'p.created_at'])
        .where('p.tenant_id', '=', tenantId)
        .where('p.status', '!=', 'cancelled')
        .where('pi.product_id', 'in', unassignedProductIds)
        .orderBy('p.created_at', 'desc')
        .execute();

      for (const rp of recentPurchases) {
        const pid = Number(rp.product_id);
        if (!resolvedSupplierMap.has(pid) && rp.supplier_id) {
          resolvedSupplierMap.set(pid, Number(rp.supplier_id));
        }
      }
    }

    // 4. Query suppliers
    const suppliers = await this.db
      .selectFrom('suppliers')
      .select(['id', 'name', 'phone', 'metadata'])
      .where('tenant_id', '=', tenantId)
      .where('is_active', '=', true)
      .execute();

    const suppliersMap = new Map<number, ReorderSupplierInput>();
    for (const s of suppliers) {
      let leadTime: number | null = null;
      if (s.metadata && typeof s.metadata === 'object') {
        const md = s.metadata as Record<string, unknown>;
        leadTime = Number(md.leadTimeDays || md.lead_time_days || null);
      }
      suppliersMap.set(Number(s.id), {
        id: Number(s.id),
        name: s.name,
        phone: s.phone,
        leadTimeDays: leadTime && leadTime > 0 ? leadTime : null,
      });
    }

    // 5. Map products into helper format
    const products: ReorderProductInput[] = rawProducts.map((p) => {
      const resolvedSupplierId = p.supplier_id ? Number(p.supplier_id) : (resolvedSupplierMap.get(Number(p.id)) || null);
      return {
        id: Number(p.id),
        name: p.name,
        barcode: p.barcode,
        stock_qty: p.stock_qty,
        min_stock_qty: p.min_stock_qty,
        cost_price: p.cost_price,
        retail_price: p.retail_price,
        supplier_id: resolvedSupplierId,
        category_id: p.category_id ? Number(p.category_id) : null,
        category_name: p.category_name,
        default_location_id: p.default_location_id ? Number(p.default_location_id) : null,
      };
    });

    const result = buildReorderAnalysis(products, salesMap, suppliersMap, {
      daysAnalysis,
      targetCoverageDays,
      defaultLeadTimeDays,
      urgencyFilter,
      moneyDigits,
    });

    // 6. Optional search filter
    if (search) {
      const filteredSuggestions = result.allSuggestions.filter(
        (s) => s.name.toLowerCase().includes(search) || (s.barcode && s.barcode.toLowerCase().includes(search))
      );

      // Re-group filtered suggestions by supplier
      const groupsMap = new Map<number | null, any>();
      for (const item of filteredSuggestions) {
        let group = groupsMap.get(item.supplierId);
        if (!group) {
          group = {
            supplierId: item.supplierId,
            supplierName: item.supplierName,
            supplierPhone: item.supplierPhone,
            leadTimeDays: item.leadTimeDays,
            itemsCount: 0,
            criticalCount: 0,
            totalSuggestedQty: 0,
            totalEstimatedCost: 0,
            items: [],
          };
          groupsMap.set(item.supplierId, group);
        }
        group.items.push(item);
        group.itemsCount += 1;
        if (item.urgency === 'out_of_stock' || item.urgency === 'critical') {
          group.criticalCount += 1;
        }
        group.totalSuggestedQty += item.suggestedQty;
        group.totalEstimatedCost = roundMoney(group.totalEstimatedCost + item.estimatedTotalCost, moneyDigits);
      }

      const filteredGroups = Array.from(groupsMap.values());
      return {
        summary: {
          ...result.summary,
          suppliersCount: filteredGroups.length,
        },
        supplierGroups: filteredGroups,
        allSuggestions: filteredSuggestions,
      };
    }

    return result;
  }

  async generateDraftPurchaseOrders(
    auth: AuthContext,
    payload: GenerateDraftOrdersPayload,
  ): Promise<{ ok: boolean; count: number; createdOrders: Array<Record<string, unknown>> }> {
    const scope = requireTenantScope(auth);
    const tenantId = scope.tenantId;

    if (!payload?.orders || !Array.isArray(payload.orders) || payload.orders.length === 0) {
      throw new AppError('يجب تحديد مورد واحد على الأقل لإنشاء أمر الشراء', 'ORDERS_REQUIRED', 400);
    }

    // Resolve default receiving location if needed
    const defaultLocationRow = await this.db
      .selectFrom('settings')
      .select('value')
      .where('key', '=', 'default_receiving_location_id')
      .where('tenant_id', '=', tenantId)
      .executeTakeFirst();
    let defaultLocationId = defaultLocationRow?.value ? Number(defaultLocationRow.value) : null;

    if (!defaultLocationId) {
      const activeLocations = await this.db
        .selectFrom('stock_locations')
        .select('id')
        .where('tenant_id', '=', tenantId)
        .where('is_active', '=', true)
        .where((eb) => eb.or([eb('location_type', 'is', null), eb('location_type', '!=', 'in_transit')]))
        .execute();
      if (activeLocations.length > 0) {
        defaultLocationId = Number(activeLocations[0].id);
      }
    }

    const createdOrders: Array<Record<string, unknown>> = [];

    for (const group of payload.orders) {
      if (!group.supplierId || !group.items || !Array.isArray(group.items)) continue;

      const validItems = group.items.filter((i) => Number(i.qty) > 0);
      if (validItems.length === 0) continue;

      const purchaseItems = validItems.map((item) => ({
        productId: Number(item.productId),
        qty: Number(item.qty),
        cost: Number(item.cost || 0),
        name: item.name,
        locationId: group.locationId || defaultLocationId || undefined,
      }));

      const purchaseDto = {
        supplierId: Number(group.supplierId),
        paymentType: 'credit' as const,
        lifecycleStatus: 'purchase_order',
        locationId: group.locationId || defaultLocationId || undefined,
        note: group.notes || payload.notes || 'مسودة أمر شراء ذكية - مقترح إعادة الطلب التلقائي',
        items: purchaseItems,
      };

      try {
        const res = await this.writeService.createPurchase(purchaseDto as any, auth);
        const purchase = (res as any)?.purchase;
        if (purchase) {
          createdOrders.push({
            id: purchase.id,
            docNo: purchase.docNo,
            supplierId: purchase.supplierId,
            supplierName: purchase.supplierName,
            total: purchase.total,
            itemsCount: validItems.length,
            status: purchase.status,
            lifecycleStatus: purchase.lifecycleStatus,
          });
        }
      } catch (err: any) {
        console.error(`Failed to generate purchase order for supplier ${group.supplierId}:`, err);
        throw new AppError(
          `فشل إنشاء أمر الشراء للمورد #${group.supplierId}: ${err?.message || 'خطأ غير متوقع'}`,
          'GENERATE_PURCHASE_ORDER_FAILED',
          400,
        );
      }
    }

    return {
      ok: true,
      count: createdOrders.length,
      createdOrders,
    };
  }
}
