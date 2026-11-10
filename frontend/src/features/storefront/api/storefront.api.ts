import { http } from '@/lib/http';
import type { ModifierGroup, ModifierOption } from '@/shared/api/addons.api';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import {
  StorefrontInfo,
  StorefrontCatalogResponse,
  CreateOnlineOrderPayload,
  CreateOnlineOrderResponse,
  OnlineOrderRecord,
  StorefrontSettingsPayload,
  StorefrontReview,
  StorefrontCoupon,
  CreateCouponPayload,
  UpdateCouponPayload,
  ValidateCouponResponse,
  QuoteCartPayload,
  QuoteCartResponse,
  StorefrontDeliveryZone,
  CreateDeliveryZonePayload,
  UpdateDeliveryZonePayload,
  StorefrontPaymentSessionResponse,
  StorefrontPaymentStatusResponse,
  AbandonedCartRecord,
  StorefrontAnalytics,
} from '../types/storefront.types';
import type { CustomerOrderRef } from '../lib/customer-order-refs';
import { resolveStorefrontMediaList, resolveStorefrontMediaUrl, withResolvedProductMedia } from '../lib/storefront-media-url';
import { DEMO_STOREFRONT_INFO } from '../lib/storefront-demo-data';
import { generatePremiumProductSvg } from '../lib/storefront-photo-matcher';

/** Banner / logo fields of /info and /admin/settings → loadable URLs (SF-9). */
function withResolvedInfoMedia<T extends StorefrontInfo>(info: T): T {
  if (!info) return info;
  return {
    ...info,
    bannerUrl: resolveStorefrontMediaUrl(info.bannerUrl),
    bannerUrls: info.bannerUrls ? resolveStorefrontMediaList(info.bannerUrls) : info.bannerUrls,
    logoUrl: resolveStorefrontMediaUrl(info.logoUrl),
    logo_url: resolveStorefrontMediaUrl(info.logo_url),
    midBanners: Array.isArray(info.midBanners)
      ? info.midBanners.map((b) => ({
          ...b,
          imageUrl: resolveStorefrontMediaUrl(b.imageUrl) || b.imageUrl,
        }))
      : info.midBanners,
  };
}

function orderTokenHeaders(token: string): Record<string, string> {
  return { 'x-order-token': token };
}

/*
 * INV-REST-STOREFRONT-NO-DEMO (R3-C): the catalog a caller shows must be
 * the catalog the server returned for the store it asked for — never the
 * demo menu. The old getCatalog swallowed ANY http error (404, unknown
 * slug, network failure) and returned a deep clone of
 * DEMO_STOREFRONT_CATALOG, so a dead link still served a full demo menu
 * through the API layer, below R2-A's fix (which only removed the fallback
 * in the kiosk hook). The response also carried no store identity, so no
 * caller could tell whose menu it was showing.
 *
 * resolveStorefrontCatalogResponse is the single decision: it normalizes
 * the server's categories/products exactly as before, stamps the response
 * with the store it belongs to (storeSlug = the requested slug, normalized
 * the same way the server normalizes it; storeName = the name the server
 * sent, or null — never invented), and throws on a missing or malformed
 * response instead of inventing a menu. getCatalog itself no longer
 * catches http errors: an ApiError propagates to the caller, which fails
 * closed (the public page has an isError screen; the kiosk hook catches
 * and returns an empty catalog).
 */
export function resolveStorefrontCatalogResponse(
  res: StorefrontCatalogResponse | null | undefined,
  slug: string,
): StorefrontCatalogResponse & { storeSlug: string; storeName: string | null } {
  const cleanSlug = String(slug || '').trim().toLowerCase();
  if (!res || typeof res !== 'object' || !Array.isArray((res as { products?: unknown }).products)) {
    throw new Error('تعذّر تحميل كتالوج المتجر: لم تصل بيانات صالحة من الخادم.');
  }
  const serverIdentity = res as unknown as Record<string, unknown>;
  const serverName =
    typeof serverIdentity.storeName === 'string' && serverIdentity.storeName.trim()
      ? serverIdentity.storeName.trim()
      : typeof serverIdentity.businessName === 'string' && serverIdentity.businessName.trim()
        ? serverIdentity.businessName.trim()
        : null;
  return {
    ...res,
    categories: (res.categories || []).map((c) => ({
      ...c,
      id: Number(c.id),
      imageUrl: resolveStorefrontMediaUrl(c.imageUrl) || generatePremiumProductSvg(c.name, c.name),
    })),
    products: (res.products || []).map((p) =>
      withResolvedProductMedia({
        ...p,
        id: Number(p.id),
        categoryId: p.categoryId ? Number(p.categoryId) : null,
      }),
    ),
    storeSlug: cleanSlug,
    storeName: serverName,
  };
}

export const storefrontApi = {
  // Public APIs (No auth needed)
  getInfo: async (slug: string) => {
    try {
      const res = await http<StorefrontInfo>(`/api/storefront/${encodeURIComponent(slug)}/info`);
      return withResolvedInfoMedia(res);
    } catch {
      return withResolvedInfoMedia({ ...DEMO_STOREFRONT_INFO, slug: slug || DEMO_STOREFRONT_INFO.slug });
    }
  },

  getTablesQr: (slug: string, from = 1, to = 20) =>
    http<{
      ok: boolean;
      slug: string;
      tenantName: string;
      totalTables: number;
      tables: Array<{
        tableNumber: number;
        tableName: string;
        url: string;
        slug: string;
        tenantName: string;
      }>;
    }>(`/api/storefront/${encodeURIComponent(slug)}/tables-qr?from=${from}&to=${to}`),

  getTableBill: async (slug: string, tableNumber: string) => {
    try {
      return await http<{
        hasActiveBill: boolean;
        source?: 'held_draft' | 'sale';
        billId?: number;
        invoiceNo?: string;
        tableNumber: string;
        isPaidOnline?: boolean;
        paidOnlineAmount?: number;
        paidOnlineRef?: string | null;
        items?: Array<{ name: string; qty: number; unitPrice: number; total: number; modifiers?: any[]; notes?: string }>;
        subtotal?: number;
        discount?: number;
        serviceCharge?: number;
        tax?: number;
        total?: number;
        currency?: string;
        message?: string;
      }>(`/api/storefront/${encodeURIComponent(slug)}/table/${encodeURIComponent(tableNumber)}/bill`);
    } catch {
      return {
        hasActiveBill: false,
        tableNumber,
        currency: DEMO_STOREFRONT_INFO.currency || 'EGP',
        message: 'لا توجد فاتورة نشطة حالياً لهذه الطاولة',
      };
    }
  },

  payTableBill: async (
    slug: string,
    tableNumber: string,
    payload: { tipAmount?: number; paymentMethod?: string; guestName?: string; guestPhone?: string }
  ) => {
    // INV-TABLE-BILL-PAY-CLOSED: never fabricate a paid result. The old
    // catch returned success + a generated reference for ANY error, so
    // the guest modal showed "paid" even when the backend refused or
    // the network failed. Errors now propagate to the caller's onError
    // handler, which shows the failure instead of a paid screen.
    return await http<{
      success: boolean;
      paidOnline: boolean;
      tableNumber: string;
      billAmount: number;
      tipAmount: number;
      totalPaid: number;
      paymentReference: string;
      guestName?: string;
      currency: string;
      paidAt: string;
      message: string;
    }>(`/api/storefront/${encodeURIComponent(slug)}/table/${encodeURIComponent(tableNumber)}/pay-bill`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Order-scoped public routes carry the order's access token (invariant SF-1).
  createPaymentSession: async (slug: string, orderNumber: string, token: string): Promise<StorefrontPaymentSessionResponse> => {
    try {
      return await http<StorefrontPaymentSessionResponse>(
        `/api/storefront/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderNumber)}/payment-session`,
        { method: 'POST', headers: orderTokenHeaders(token) }
      );
    } catch {
      return {
        ok: true,
        mode: 'mock',
        provider: 'mock',
        orderNumber,
        amount: 0,
        currency: DEMO_STOREFRONT_INFO.currency || 'EGP',
        testMode: true,
        paymentToken: `tok_${Date.now()}`,
      };
    }
  },

  getPaymentStatus: async (slug: string, orderNumber: string, token: string): Promise<StorefrontPaymentStatusResponse> => {
    try {
      return await http<StorefrontPaymentStatusResponse>(
        `/api/storefront/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderNumber)}/payment-status`,
        { headers: orderTokenHeaders(token) }
      );
    } catch {
      return {
        ok: true,
        orderNumber,
        paymentStatus: 'pending',
        orderStatus: 'pending',
        totalAmount: 0,
        gatewayProvider: 'mock',
        gatewayTransactionId: null,
        paidAt: null,
      };
    }
  },

  mockPayOrder: async (
    slug: string,
    orderNumber: string,
    token: string,
    payload?: { cardNumber?: string; cardHolder?: string }
  ) => {
    try {
      return await http<{ ok: boolean; orderNumber: string; paymentStatus: string; transactionId: string; message: string }>(
        `/api/storefront/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderNumber)}/mock-pay`,
        {
          method: 'POST',
          headers: orderTokenHeaders(token),
          body: JSON.stringify(payload || {}),
        }
      );
    } catch {
      return {
        ok: true,
        orderNumber,
        paymentStatus: 'paid',
        transactionId: `TXN-${Date.now().toString().slice(-6)}`,
        message: 'تمت عملية الدفع بنجاح',
      };
    }
  },

  getCatalog: async (slug: string) => {
    // INV-REST-STOREFRONT-NO-DEMO: no try/catch here on purpose — an http
    // error (unknown store, 404, network failure) must reach the caller,
    // never come back as the demo catalog. See
    // resolveStorefrontCatalogResponse above.
    const res = await http<StorefrontCatalogResponse>(`/api/storefront/${encodeURIComponent(slug)}/catalog`);
    return resolveStorefrontCatalogResponse(res, slug);
  },

  /*
   * INV-REST-KIOSK-MENU-SCALE (T10-B): ONE server page of the catalog —
   * the call the kiosk menu uses instead of getCatalog. The server
   * clamps pageSize to 200 and answers with page/pageSize/totalCount/
   * hasMore; categoryId and q filter on the server, so the browser
   * never holds (or filters) the whole catalog. Like getCatalog, no
   * try/catch here on purpose — an http error must reach the caller,
   * never come back as a menu. The response is normalized exactly like
   * getCatalog (store stamp, numeric ids, resolved media), and the
   * paging fields ride through from the server payload.
   */
  getCatalogPage: async (
    slug: string,
    opts: { page?: number; pageSize?: number; categoryId?: number; q?: string } = {},
  ): Promise<
    StorefrontCatalogResponse & {
      storeSlug: string;
      storeName: string | null;
      page: number;
      pageSize: number;
      totalCount: number;
      hasMore: boolean;
    }
  > => {
    const page = Math.min(10_000, Math.max(1, Math.trunc(Number(opts.page) || 1)));
    const pageSize = Math.min(200, Math.max(1, Math.trunc(Number(opts.pageSize) || 50)));
    const params = new URLSearchParams();
    params.set('page', String(page));
    params.set('pageSize', String(pageSize));
    if (opts.categoryId && Number(opts.categoryId) > 0) {
      params.set('categoryId', String(Number(opts.categoryId)));
    }
    const q = String(opts.q || '').trim();
    if (q) params.set('q', q);
    const res = await http<
      StorefrontCatalogResponse & {
        page?: number;
        pageSize?: number;
        totalCount?: number;
        hasMore?: boolean;
      }
    >(`/api/storefront/${encodeURIComponent(slug)}/catalog?${params.toString()}`);
    const normalized = resolveStorefrontCatalogResponse(res, slug);
    return {
      ...normalized,
      page: Number(res.page ?? page),
      pageSize: Number(res.pageSize ?? pageSize),
      totalCount: Number(res.totalCount ?? 0),
      hasMore: Boolean(res.hasMore),
    };
  },

  getSearchSuggestions: async (slug: string, q: string) => {
    const lang = typeof localStorage !== 'undefined' && localStorage.getItem('zs_storefront_lang') === 'en' ? 'en' : 'ar';
    const { localizeCategory, localizeProduct } = await import('../lib/storefront-translations');
    // INV-REST-QUOTECART-NO-DEMO (R6-A): no try/catch here on purpose — an
    // http error must reach the caller, never come back as demo-catalog
    // matches. The old catch filtered DEMO_STOREFRONT_CATALOG by the query
    // and returned the matches as if they were the store's own
    // suggestions. The caller (StorefrontPredictiveSearch) already fails
    // safe: its own catch shows an empty suggestion list.
    const res = await http<{
      categories: Array<{ id: number; name: string; imageUrl?: string }>;
      products: Array<{ id: number; name: string; price: number; imageUrl?: string; categoryName?: string; inStock: boolean }>;
    }>(`/api/storefront/${encodeURIComponent(slug)}/search/suggest?q=${encodeURIComponent(q)}`);
    return {
      categories: (res?.categories || []).map((c) => {
        const loc = localizeCategory(c as any, lang);
        return { ...loc, imageUrl: resolveStorefrontMediaUrl(c.imageUrl) };
      }),
      products: (res?.products || []).map((p) => localizeProduct(withResolvedProductMedia(p as any), lang)),
    };
  },

  getProductDetails: async (slug: string, productId: number) => {
    const lang = typeof localStorage !== 'undefined' && localStorage.getItem('zs_storefront_lang') === 'en' ? 'en' : 'ar';
    const { localizeProduct } = await import('../lib/storefront-translations');
    // INV-REST-QUOTECART-NO-DEMO (R6-A): no try/catch here on purpose — an
    // http error must reach the caller, never come back as a demo product.
    // The backend throws NotFoundException for an unknown product; the frontend must
    // not invent one. No frontend caller exists at this base — this is
    // defence in depth, pinned by the API-level spec.
    const res = await http<{
      product: any;
      related: any[];
      crossSell: any[];
    }>(`/api/storefront/${encodeURIComponent(slug)}/products/${productId}`);
    return {
      product: localizeProduct(withResolvedProductMedia(res?.product), lang),
      related: (res?.related || []).map((p) => localizeProduct(withResolvedProductMedia(p), lang)),
      crossSell: (res?.crossSell || []).map((p) => localizeProduct(withResolvedProductMedia(p), lang)),
    };
  },

  /*
   * INV-REST-KIOSK-MODIFIER-UI (R7-B2): the PUBLIC modifier data for one
   * catalog product — what the kiosk picker shows before the customer
   * picks. Slug-scoped exactly like getProductDetails (the tenant comes
   * from the slug, so another tenant's groups can never leak through a
   * guessed product id). Shaped like the authenticated
   * addons.getProductModifiers MINUS costPrice: a public response must
   * never leak what an option costs the merchant, so every option is
   * normalized with costPrice 0. No try/catch here on purpose — an http
   * error must reach the caller (the kiosk hook catches it and falls
   * back to a plain add), never come back as invented groups.
   */
  getProductModifiers: async (slug: string, productId: number): Promise<{ groups: ModifierGroup[] }> => {
    const res = await http<{
      groups: Array<{
        id: number;
        name: string;
        nameEn?: string;
        selectionType?: string;
        isMandatory?: boolean;
        minSelections?: number;
        maxSelections?: number;
        displayOrder?: number;
        isSplittableInHalf?: boolean;
        options?: Array<{
          id: number;
          groupId: number;
          name: string;
          nameEn?: string;
          price?: number;
          isDefault?: boolean;
          displayOrder?: number;
          componentProductId?: number | null;
          componentProductName?: string | null;
          consumptionQty?: number | null;
          unitName?: string | null;
        }>;
      }>;
    }>(`/api/storefront/${encodeURIComponent(slug)}/products/${productId}/modifiers`);
    return {
      groups: (res?.groups || []).map((g) => ({
        id: Number(g.id),
        name: g.name,
        nameEn: g.nameEn,
        selectionType: g.selectionType === 'single' ? 'single' : 'multiple',
        isMandatory: Boolean(g.isMandatory),
        minSelections: Number(g.minSelections || 0),
        maxSelections: Number(g.maxSelections || 0),
        displayOrder: Number(g.displayOrder || 0),
        isActive: true,
        isSplittableInHalf: Boolean(g.isSplittableInHalf),
        options: (g.options || []).map((opt): ModifierOption => ({
          id: Number(opt.id),
          groupId: Number(opt.groupId),
          name: opt.name,
          nameEn: opt.nameEn,
          price: Number(opt.price || 0),
          costPrice: 0,
          isDefault: Boolean(opt.isDefault),
          isActive: true,
          displayOrder: Number(opt.displayOrder || 0),
          componentProductId: opt.componentProductId ? Number(opt.componentProductId) : null,
          componentProductName: opt.componentProductName || null,
          consumptionQty: opt.consumptionQty !== null && opt.consumptionQty !== undefined ? Number(opt.consumptionQty) : null,
          unitName: opt.unitName || null,
        })),
      })),
    };
  },

  /*
   * INV-STOREFRONT-ORDER-PRICE: placing an order is a money action, so a
   * failed POST must surface the real error — never a fabricated demo order.
   * The old catch fallback invented a successful order (ORD-<timestamp>,
   * demo-token-123) priced from the demo catalog: the live case ORD-180027
   * showed the real product (id 16812, 131.60) as "منتج #16812 — 0 ج.م" with
   * the demo delivery fee 35.00 despite free delivery, and the order never
   * reached admin because nothing was ever persisted. The checkout modal
   * already shows the thrown error message (setErrorMsg), so the shopper
   * sees the real named reason instead of a fake success. Demo fallbacks
   * stay for read-only browsing (getInfo/getCatalog/quote); only the order
   * write loses its fabrication.
   */
  createOrder: async (slug: string, payload: CreateOnlineOrderPayload): Promise<CreateOnlineOrderResponse> => {
    return await http<CreateOnlineOrderResponse>(`/api/storefront/${encodeURIComponent(slug)}/orders`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  validateCoupon: async (slug: string, code: string, subtotal: number, digits: MoneyDigits): Promise<ValidateCouponResponse> => {
    try {
      return await http<ValidateCouponResponse>(`/api/storefront/${encodeURIComponent(slug)}/coupons/validate`, {
        method: 'POST',
        body: JSON.stringify({ code, subtotal }),
      });
    } catch {
      const normalized = (code || '').trim().toUpperCase();
      if (normalized === 'WELCOME10' || normalized === 'DISCOUNT10' || normalized === 'ZSTORE10') {
        // INV-FE2-FRONTEND-BOOK-DIGITS: the offline fallback discount is
        // applied to the checkout total — it rounds at the store's book
        // digits (required param; the caller resolves it from the store
        // currency), never at a hardcoded 2dp.
        const discountAmount = roundMoneyValue(subtotal * 0.1, digits);
        return {
          ok: true,
          code: normalized,
          discountType: 'percentage',
          discountValue: 10,
          discountAmount,
          message: 'تم تطبيق كود الخصم بنجاح',
        };
      }
      throw new Error('كود الخصم غير صالح أو منتهي الصلاحية');
    }
  },

  quoteCart: async (slug: string, payload: QuoteCartPayload): Promise<QuoteCartResponse> => {
    // INV-REST-QUOTECART-NO-DEMO (R6-A): no try/catch here on purpose — a
    // failed quote POST must reach the caller, never come back as a
    // demo-priced quote. The old catch priced every line from
    // DEMO_STOREFRONT_CATALOG (unitPrice = prod?.price ?? 0), took the
    // delivery fee and free-shipping threshold from DEMO_STOREFRONT_INFO,
    // and returned { ok: true, totalAmount: subtotal + deliveryFee } — a
    // fully-formed, money-shaped quote the caller could not distinguish
    // from the server's. The checkout modal clears its stale serverQuote
    // on rejection and falls back to real local totals.
    return await http<QuoteCartResponse>(`/api/storefront/${encodeURIComponent(slug)}/cart/quote`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  lookupCustomerOrders: async (slug: string, orders: CustomerOrderRef[]) => {
    try {
      return await http<{ ok: boolean; orders: OnlineOrderRecord[] }>(`/api/storefront/${encodeURIComponent(slug)}/orders/lookup`, {
        method: 'POST',
        body: JSON.stringify({ orders }),
      });
    } catch {
      return { ok: true, orders: [] };
    }
  },

  cancelCustomerOrder: async (slug: string, orderNumber: string, token: string) => {
    try {
      return await http<{ ok: boolean; message: string }>(
        `/api/storefront/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderNumber)}/cancel`,
        { method: 'POST', headers: orderTokenHeaders(token) }
      );
    } catch {
      return { ok: true, message: 'تم إلغاء الطلب بنجاح' };
    }
  },

  updateCustomerOrder: async (slug: string, orderNumber: string, token: string, payload: CreateOnlineOrderPayload) => {
    try {
      return await http<{ ok: boolean; orderNumber: string; totalAmount: number; message: string }>(
        `/api/storefront/${encodeURIComponent(slug)}/orders/${encodeURIComponent(orderNumber)}`,
        {
          method: 'PUT',
          headers: orderTokenHeaders(token),
          body: JSON.stringify(payload),
        }
      );
    } catch {
      return {
        ok: true,
        orderNumber,
        totalAmount: 0,
        message: 'تم تحديث الطلب بنجاح',
      };
    }
  },

  recordAbandonedCart: async (
    slug: string,
    payload: { customerPhone: string; customerName?: string; countryCode?: string; items: any[]; subtotal: number }
  ) => {
    try {
      return await http<{ ok: boolean; cartId?: number }>(`/api/storefront/${encodeURIComponent(slug)}/abandoned-cart`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch {
      return { ok: true, cartId: Date.now() };
    }
  },

  submitReview: async (
    slug: string,
    productId: number,
    payload: { rating: number; customerName?: string; customerPhone?: string; comment?: string }
  ) => {
    try {
      return await http<{ ok: boolean; avgRating: number; reviewCount: number; message: string }>(
        `/api/storefront/${encodeURIComponent(slug)}/products/${productId}/reviews`,
        {
          method: 'POST',
          body: JSON.stringify(payload),
        }
      );
    } catch {
      return {
        ok: true,
        avgRating: payload.rating || 5,
        reviewCount: 1,
        message: 'شكراً لتقييمك!',
      };
    }
  },

  getProductReviews: async (slug: string, productId: number) => {
    try {
      return await http<{ ok: boolean; productId: number; reviews: StorefrontReview[] }>(
        `/api/storefront/${encodeURIComponent(slug)}/products/${productId}/reviews`
      );
    } catch {
      return {
        ok: true,
        productId,
        reviews: [],
      };
    }
  },

  // Merchant Admin APIs (Requires Session Auth)
  listOrders: (status?: string, limit?: number, page?: number) => {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.append('status', status);
    if (limit) params.append('limit', String(limit));
    if (page) params.append('page', String(page));
    const qs = params.toString();
    return http<{ orders: OnlineOrderRecord[]; counts?: Record<string, number> }>(`/api/storefront/admin/orders${qs ? `?${qs}` : ''}`);
  },

  getOrderCounts: () =>
    http<{ counts: Record<string, number> }>('/api/storefront/admin/orders/counts'),

  bulkCancelOrders: (adminPassword: string, status = 'pending') =>
    http<{ ok: boolean; cancelledCount: number; message: string }>('/api/storefront/admin/orders/bulk-cancel', {
      method: 'POST',
      body: JSON.stringify({ adminPassword, status }),
    }),

  getOrder: (id: number) => http<OnlineOrderRecord>(`/api/storefront/admin/orders/${id}`),

  updateOrderStatus: (id: number, status: string, saleId?: number) =>
    http<{ ok: boolean; status: string; saleId?: number }>(`/api/storefront/admin/orders/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status, saleId }),
    }),

  /** Merchant confirms an InstaPay / wallet transfer actually arrived (SF-3). */
  confirmOrderPayment: (id: number, reference?: string) =>
    http<{ ok: boolean; paymentStatus: string }>(`/api/storefront/admin/orders/${id}/confirm-payment`, {
      method: 'POST',
      body: JSON.stringify({ reference }),
    }),

  convertToSale: (id: number, deliveryRepId?: number) =>
    http<{ ok: boolean; saleId: number; sale: any; message?: string; customerName?: string; isNewCustomer?: boolean; deliveryRepName?: string }>(
      `/api/storefront/admin/orders/${id}/convert-to-sale`,
      {
        method: 'POST',
        body: JSON.stringify({ deliveryRepId }),
      }
    ),

  preparePos: (id: number) =>
    http<{
      ok: boolean;
      orderId: number;
      orderNumber: string;
      customerId: number | null;
      customerName: string;
      customerPhone: string;
      customerAddress: string;
      deliveryFee: number;
      totalAmount: number;
      discountAmount?: number;
      couponCode?: string | null;
      orderType?: 'dine_in' | 'delivery';
      tableNumber?: string;
      items: Array<{
        productId: number;
        name: string;
        price: number;
        costPrice: number;
        qty: number;
        stockQty: number;
        unitName: string;
      }>;
      customerNotes?: string;
      paymentMethod?: string;
      isNewCustomer: boolean;
    }>(`/api/storefront/admin/orders/${id}/prepare-pos`, {
      method: 'POST',
    }),

  getSettings: async () => withResolvedInfoMedia(await http<StorefrontInfo>(`/api/storefront/admin/settings`)),

  updateSettings: async (payload: StorefrontSettingsPayload) =>
    withResolvedInfoMedia(await http<StorefrontInfo>(`/api/storefront/admin/settings`, {
      method: 'POST',
      body: JSON.stringify(payload),
    })),

  updateProductImage: (productId: number, imageUrl: string) =>
    http<{ success: boolean; productId: number; imageUrl: string }>(
      `/api/storefront/admin/products/${productId}/image`,
      {
        method: 'PATCH',
        body: JSON.stringify({ imageUrl }),
      }
    ),

  updateCategoryImage: (categoryId: number, imageUrl: string) =>
    http<{ success: boolean; categoryId: number; imageUrl: string }>(
      `/api/storefront/admin/categories/${categoryId}/image`,
      {
        method: 'PATCH',
        body: JSON.stringify({ imageUrl }),
      }
    ),

  listCoupons: () => http<{ ok: boolean; coupons: StorefrontCoupon[] }>('/api/storefront/admin/coupons'),

  createCoupon: (payload: CreateCouponPayload) =>
    http<{ ok: boolean; coupon: StorefrontCoupon }>('/api/storefront/admin/coupons', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateCoupon: (id: number, payload: UpdateCouponPayload) =>
    http<{ ok: boolean; coupon: StorefrontCoupon }>(`/api/storefront/admin/coupons/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteCoupon: (id: number) =>
    http<{ ok: boolean; message: string }>(`/api/storefront/admin/coupons/${id}`, {
      method: 'DELETE',
    }),

  listDeliveryZones: () => http<{ ok: boolean; zones: StorefrontDeliveryZone[] }>('/api/storefront/admin/delivery-zones'),

  createDeliveryZone: (payload: CreateDeliveryZonePayload) =>
    http<{ ok: boolean; zone: StorefrontDeliveryZone }>('/api/storefront/admin/delivery-zones', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  updateDeliveryZone: (id: number, payload: UpdateDeliveryZonePayload) =>
    http<{ ok: boolean; id: number }>(`/api/storefront/admin/delivery-zones/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  deleteDeliveryZone: (id: number) =>
    http<{ ok: boolean; id: number }>(`/api/storefront/admin/delivery-zones/${id}`, {
      method: 'DELETE',
    }),

  listAbandonedCarts: () =>
    http<{ ok: boolean; carts: AbandonedCartRecord[] }>('/api/storefront/admin/abandoned-carts'),

  deleteAbandonedCart: (id: number) =>
    http<{ ok: boolean }>(`/api/storefront/admin/abandoned-carts/${id}`, {
      method: 'DELETE',
    }),

  getAnalytics: () =>
    http<{ ok: boolean } & StorefrontAnalytics>('/api/storefront/admin/analytics'),
};
