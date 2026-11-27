import { Injectable, NotFoundException } from '@nestjs/common';
import { Kysely, sql, type Selectable } from 'kysely';
import { Database } from '../../../database/database.types';
import { AuthContext } from '../../../core/auth/interfaces/auth-context.interface';
import { requireTenantScope } from '../../../core/auth/utils/tenant-boundary';
import { getTenantTimezone, todayTenantDate } from '../../../common/utils/tenant-timezone.util';
import { CreateProductReviewDto } from '../dto/create-product-review.dto';
import { RecordAbandonedCartDto } from '../dto/abandoned-cart.dto';

/**
 * StorefrontEngagementService — slice T9 of the storefront split.
 * Pure move of 6 methods from StorefrontService (submitProductReview,
 * getProductReviews, recordAbandonedCart, listAbandonedCarts,
 * deleteAbandonedCart, getStorefrontAnalytics). No behavior change: the
 * bodies are byte-identical; the facade keeps thin delegates with the same
 * names and signatures for all 6 public methods.
 * Deps: db + the facade kernel fn getTenantBySlug (bound dep) + the T6a
 * catalog method invalidateCatalogCache (bound method dep — the moved text
 * calls it as this.invalidateCatalogCache byte-identically, once, in
 * submitProductReview).
 * GENERATION-TREE NOTE: the ctor binds invalidateCatalogCache from
 * this.invalidateCatalogCache (still a facade method on this tree). At merge,
 * T6a has already merged, so the coordinator repoints that bind to
 * this.catalogService.invalidateCatalogCache.bind(this.catalogService).
 * Clock pins travel verbatim: todayTenantDate + getTenantTimezone in
 * getStorefrontAnalytics (tenant-tz argument byte-identical), one new Date()
 * stamp in recordAbandonedCart. The CURRENT_DATE mention in
 * getStorefrontAnalytics is a COMMENT only (it travels with the method and
 * does not affect the clock-b6-today-buckets pin, which reads the T9 slice
 * file at merge — merge-owned repoint). No toFixed2, no inlineRound, no FX
 * in this slice. Driving spec: getStorefrontAnalytics (clock-b6-today-buckets
 * reads its source text; merge-owned repoint). No spec repoint travels in
 * this patch — prep section 7.3 rules all eight source-text repoints
 * MERGE-OWNED.
 */

export interface StorefrontEngagementDeps {
  db: Kysely<Database>;
  getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  invalidateCatalogCache: (slug?: string) => void;
}

@Injectable()
export class StorefrontEngagementService {
  private readonly db: Kysely<Database>;
  private readonly getTenantBySlug: (slug: string) => Promise<Selectable<Database['tenants']>>;
  private readonly invalidateCatalogCache: (slug?: string) => void;

  constructor(deps: StorefrontEngagementDeps) {
    this.db = deps.db;
    this.getTenantBySlug = deps.getTenantBySlug;
    this.invalidateCatalogCache = deps.invalidateCatalogCache;
  }

  async submitProductReview(slug: string, productId: number, dto: CreateProductReviewDto) {
    const tenant = await this.getTenantBySlug(slug);

    // Verify product exists for this tenant
    const product = await this.db
      .selectFrom('products')
      .select(['id', 'name'])
      .where('id', '=', productId)
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('is_active', '=', true)
      .executeTakeFirst();

    if (!product) {
      throw new NotFoundException('المنتج غير موجود');
    }

    const rating = Math.max(1, Math.min(5, Math.round(Number(dto.rating) || 5)));
    const customerName = (dto.customerName || '').trim() || 'عميل المتجر';
    const customerPhone = (dto.customerPhone || '').trim();
    const comment = (dto.comment || '').trim();

    await this.db
      .insertInto('product_reviews')
      .values({
        tenant_id: tenant.id,
        account_id: tenant.id,
        product_id: productId,
        rating,
        customer_name: customerName,
        customer_phone: customerPhone || null,
        comment: comment || null,
        is_approved: true,
      })
      .execute();

    // Invalidate cache immediately so new rating is live!
    this.invalidateCatalogCache(slug);

    // Calculate new summary for this product
    const stats = await this.db
      .selectFrom('product_reviews')
      .select([
        sql<number>`ROUND(AVG(rating)::numeric, 1)`.as('avg_rating'),
        sql<number>`COUNT(*)::int`.as('review_count'),
      ])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('product_id', '=', productId)
      .where('is_approved', '=', true)
      .executeTakeFirst();

    return {
      ok: true,
      productId,
      avgRating: Number(stats?.avg_rating) || rating,
      reviewCount: Number(stats?.review_count) || 1,
      message: 'شكراً لك! تم تسجيل تقييمك بنجاح.',
    };
  }

  async getProductReviews(slug: string, productId: number) {
    const tenant = await this.getTenantBySlug(slug);

    const reviews = await this.db
      .selectFrom('product_reviews')
      .select(['id', 'rating', 'customer_name', 'comment', 'created_at'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('product_id', '=', productId)
      .where('is_approved', '=', true)
      .orderBy('created_at', 'desc')
      .limit(30)
      .execute();

    return {
      ok: true,
      productId,
      reviews: reviews.map((r) => ({
        id: r.id,
        rating: Number(r.rating),
        customerName: r.customer_name || 'عميل المتجر',
        comment: r.comment || '',
        createdAt: r.created_at,
      })),
    };
  }

  async recordAbandonedCart(slug: string, dto: RecordAbandonedCartDto) {
    const tenant = await this.getTenantBySlug(slug);
    const cleanPhone = (dto.customerPhone || '').trim();
    if (!cleanPhone || cleanPhone.length < 6) return { ok: false };

    const recent = await this.db
      .selectFrom('storefront_abandoned_carts')
      .select(['id'])
      .where(sql<boolean>`tenant_id = ${tenant.id}`)
      .where('customer_phone', '=', cleanPhone)
      .where('recovered', '=', false)
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    if (recent) {
      await this.db
        .updateTable('storefront_abandoned_carts')
        .set({
          customer_name: dto.customerName || null,
          country_code: dto.countryCode || 'EG',
          items_json: JSON.stringify(dto.items || []),
          subtotal: Number(dto.subtotal || 0),
          updated_at: new Date(),
        })
        .where('id', '=', recent.id)
        .where('tenant_id', '=', tenant.id)
        .execute();
      return { ok: true, cartId: recent.id };
    }

    const inserted = await this.db
      .insertInto('storefront_abandoned_carts')
      .values({
        tenant_id: tenant.id,
        customer_name: dto.customerName || null,
        customer_phone: cleanPhone,
        country_code: dto.countryCode || 'EG',
        items_json: JSON.stringify(dto.items || []),
        subtotal: Number(dto.subtotal || 0),
        recovered: false,
      })
      .returning(['id'])
      .executeTakeFirst();

    return { ok: true, cartId: inserted?.id };
  }

  async listAbandonedCarts(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    const carts = await this.db
      .selectFrom('storefront_abandoned_carts')
      .selectAll()
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    return carts.map((c: any) => {
      let items: any[] = [];
      try {
        items = JSON.parse(c.items_json);
      } catch {}
      return {
        id: c.id,
        customerName: c.customer_name || 'عميل محتمل',
        customerPhone: c.customer_phone,
        countryCode: c.country_code || 'EG',
        items,
        subtotal: Number(c.subtotal || 0),
        recovered: Boolean(c.recovered),
        createdAt: c.created_at,
      };
    });
  }

  async deleteAbandonedCart(id: number, actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);
    await this.db
      .deleteFrom('storefront_abandoned_carts')
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('id', '=', id)
      .execute();
    return { ok: true };
  }

  async getStorefrontAnalytics(actor: AuthContext) {
    const { tenantId } = requireTenantScope(actor);

    // NEW-G (clock B6-P2): "today" orders/revenue key on the tenant day,
    // not the DB host's UTC day — CURRENT_DATE starts the bucket at 02:00
    // Cairo and misses the tenant day's first hours.
    const tenantTz = await getTenantTimezone(this.db, tenantId);
    const todayKey = todayTenantDate(tenantTz);

    const stats = await this.db
      .selectFrom('online_orders')
      .select([
        sql<number>`COUNT(*)::int`.as('total_orders'),
        sql<number>`COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END), 0)::float`.as(
          'total_revenue',
        ),
        sql<number>`COUNT(CASE WHEN status = 'pending' THEN 1 END)::int`.as('pending_orders'),
        sql<number>`COUNT(CASE WHEN status = 'confirmed' THEN 1 END)::int`.as('confirmed_orders'),
        sql<number>`COUNT(CASE WHEN status = 'processing' THEN 1 END)::int`.as('processing_orders'),
        sql<number>`COUNT(CASE WHEN status = 'shipped' THEN 1 END)::int`.as('shipped_orders'),
        sql<number>`COUNT(CASE WHEN status = 'delivered' THEN 1 END)::int`.as('delivered_orders'),
        sql<number>`COUNT(CASE WHEN status = 'cancelled' THEN 1 END)::int`.as('cancelled_orders'),
      ])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    const todayStats = await this.db
      .selectFrom('online_orders')
      .select([
        sql<number>`COUNT(*)::int`.as('today_orders'),
        sql<number>`COALESCE(SUM(CASE WHEN status != 'cancelled' THEN total_amount ELSE 0 END), 0)::float`.as(
          'today_revenue',
        ),
      ])
      .where(sql<boolean>`tenant_id = ${tenantId} AND DATE(created_at AT TIME ZONE ${tenantTz}) = ${todayKey}`)
      .executeTakeFirst();

    const cartStats = await this.db
      .selectFrom('storefront_abandoned_carts')
      .select([
        sql<number>`COUNT(*)::int`.as('total_abandoned'),
        sql<number>`COUNT(CASE WHEN recovered = false THEN 1 END)::int`.as('unrecovered_abandoned'),
        sql<number>`COUNT(CASE WHEN recovered = true THEN 1 END)::int`.as('recovered_abandoned'),
      ])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .executeTakeFirst();

    const totalOrders = Number(stats?.total_orders || 0);
    const totalRevenue = Number(stats?.total_revenue || 0);
    const deliveredOrders = Number(stats?.delivered_orders || 0);
    const cancelledOrders = Number(stats?.cancelled_orders || 0);
    const pendingOrders = Number(stats?.pending_orders || 0);
    const confirmedOrders = Number(stats?.confirmed_orders || 0);
    const processingOrders = Number(stats?.processing_orders || 0);
    const shippedOrders = Number(stats?.shipped_orders || 0);

    const validOrders = Math.max(0, totalOrders - cancelledOrders);
    const averageOrderValue = validOrders > 0 ? Math.round(totalRevenue / validOrders) : 0;

    const unrecoveredAbandoned = Number(cartStats?.unrecovered_abandoned || 0);
    const recoveredAbandoned = Number(cartStats?.recovered_abandoned || 0);
    const totalSessions = totalOrders + unrecoveredAbandoned;
    const conversionRate = totalSessions > 0 ? Math.round((totalOrders / totalSessions) * 100) : 0;

    // Aggregate Top-Selling Products from recent orders
    const recentOrders = await this.db
      .selectFrom('online_orders')
      .select(['items_json', 'status', 'created_at'])
      .where(sql<boolean>`tenant_id = ${tenantId} AND status != 'cancelled'`)
      .orderBy('created_at', 'desc')
      .limit(100)
      .execute();

    const productSalesMap = new Map<
      number,
      { productId: number; productName: string; quantity: number; revenue: number }
    >();
    for (const o of recentOrders) {
      try {
        const items = typeof o.items_json === 'string' ? JSON.parse(o.items_json) : o.items_json || [];
        for (const it of items) {
          const pId = Number(it.productId || it.id);
          if (!pId) continue;
          const existing = productSalesMap.get(pId) || {
            productId: pId,
            productName: String(it.productName || it.name || 'صنف'),
            quantity: 0,
            revenue: 0,
          };
          existing.quantity += Number(it.quantity || 1);
          existing.revenue += Number(it.total || Number(it.unitPrice || 0) * Number(it.quantity || 1));
          productSalesMap.set(pId, existing);
        }
      } catch {}
    }
    const topSellingProducts = Array.from(productSalesMap.values())
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Low stock warnings for products visible in store
    const lowStockRows = await this.db
      .selectFrom('products')
      .select(['id', 'name', 'stock_qty', 'retail_price'])
      .where(sql<boolean>`tenant_id = ${tenantId}`)
      .where('is_active', '=', true)
      .where(sql<boolean>`(item_type = 'product' OR item_type IS NULL)`)
      .where(sql<boolean>`stock_qty <= 5`)
      .orderBy('stock_qty', 'asc')
      .limit(6)
      .execute();

    const lowStockStorefrontProducts = lowStockRows.map((r: any) => ({
      id: Number(r.id),
      name: String(r.name),
      stock: Number(r.stock_qty || 0),
      price: Number(r.retail_price || 0),
    }));

    return {
      totalOrders,
      totalRevenue,
      deliveredOrders,
      cancelledOrders,
      pendingOrders,
      confirmedOrders,
      processingOrders,
      shippedOrders,
      averageOrderValue,
      unrecoveredAbandoned,
      recoveredAbandoned,
      abandonedCartsCount: unrecoveredAbandoned,
      conversionRate,
      todayOrders: Number(todayStats?.today_orders || 0),
      todayRevenue: Number(todayStats?.today_revenue || 0),
      topSellingProducts,
      lowStockStorefrontProducts,
      statusBreakdown: {
        pending: pendingOrders,
        confirmed: confirmedOrders,
        processing: processingOrders,
        shipped: shippedOrders,
        delivered: deliveredOrders,
        cancelled: cancelledOrders,
      },
    };
  }
}
