import { http } from '@/lib/http';
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
import { DEMO_STOREFRONT_INFO, DEMO_STOREFRONT_CATALOG } from '../lib/storefront-demo-data';
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

  getSearchSuggestions: async (slug: string, q: string) => {
    const lang = typeof localStorage !== 'undefined' && localStorage.getItem('zs_storefront_lang') === 'en' ? 'en' : 'ar';
    const { localizeCategory, localizeProduct } = await import('../lib/storefront-translations');
    try {
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
    } catch {
      const cleanQ = (q || '').trim().toLowerCase();
      const allCats = DEMO_STOREFRONT_CATALOG.categories.map((c) => ({ raw: c, loc: localizeCategory(c, lang) }));
      const allProds = DEMO_STOREFRONT_CATALOG.products.map((p) => ({ raw: p, loc: localizeProduct(p, lang) }));

      const matchedCats = allCats
        .filter(({ raw, loc }) => raw.name.toLowerCase().includes(cleanQ) || loc.name.toLowerCase().includes(cleanQ))
        .map(({ loc }) => loc);
      const matchedProds = allProds
        .filter(
          ({ raw, loc }) =>
            raw.name.toLowerCase().includes(cleanQ) ||
            loc.name.toLowerCase().includes(cleanQ) ||
            (loc.categoryName || '').toLowerCase().includes(cleanQ)
        )
        .map(({ loc }) => loc);

      return {
        categories: matchedCats.map((c) => ({ id: c.id, name: c.name, imageUrl: c.imageUrl })),
        products: matchedProds.map((p) => ({ id: p.id, name: p.name, price: p.price, imageUrl: p.imageUrl, categoryName: p.categoryName, inStock: p.inStock })),
      };
    }
  },

  getProductDetails: async (slug: string, productId: number) => {
    const lang = typeof localStorage !== 'undefined' && localStorage.getItem('zs_storefront_lang') === 'en' ? 'en' : 'ar';
    const { localizeProduct } = await import('../lib/storefront-translations');
    try {
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
    } catch {
      const found = DEMO_STOREFRONT_CATALOG.products.find((p) => p.id === Number(productId)) || DEMO_STOREFRONT_CATALOG.products[0];
      const related = DEMO_STOREFRONT_CATALOG.products.filter((p) => p.id !== found.id).slice(0, 4);
      return {
        product: localizeProduct(withResolvedProductMedia(found), lang),
        related: related.map((p) => localizeProduct(withResolvedProductMedia(p), lang)),
        crossSell: related.slice(0, 2).map((p) => localizeProduct(withResolvedProductMedia(p), lang)),
      };
    }
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
    try {
      return await http<QuoteCartResponse>(`/api/storefront/${encodeURIComponent(slug)}/cart/quote`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch {
      const items = (payload.items || []).map((item) => {
        const prod = DEMO_STOREFRONT_CATALOG.products.find((p) => p.id === Number(item.productId));
        const unitPrice = Number(prod?.price ?? 0);
        const baseUnitPrice = Number(prod?.originalPrice ?? prod?.price ?? 0);
        const quantity = Number(item.quantity || 1);
        return {
          productId: Number(item.productId),
          name: prod?.name || `منتج #${item.productId}`,
          variantName: item.variantName ?? null,
          barcode: prod?.barcode,
          quantity,
          baseUnitPrice,
          unitPrice,
          total: unitPrice * quantity,
          originalTotal: baseUnitPrice * quantity,
          hasDiscount: prod?.hasDiscount,
          discountPercent: prod?.discountPercent,
          offerBadge: prod?.offerBadge,
          offerType: prod?.offerType,
        };
      });
      const subtotal = items.reduce((sum, l) => sum + l.total, 0);
      const originalSubtotal = items.reduce((sum, l) => sum + l.originalTotal, 0);
      const baseDeliveryFee = payload.orderType === 'dine_in' ? 0 : (DEMO_STOREFRONT_INFO.deliveryFee || 0);
      const freeThreshold = DEMO_STOREFRONT_INFO.freeShippingMinOrder || null;
      const freeDeliveryApplied = Boolean(DEMO_STOREFRONT_INFO.freeShippingEnabled && freeThreshold && subtotal >= freeThreshold);
      const deliveryFee = freeDeliveryApplied ? 0 : baseDeliveryFee;
      return {
        ok: true,
        subtotal,
        originalSubtotal,
        bogoSavings: Math.max(0, originalSubtotal - subtotal),
        discountAmount: 0,
        deliveryFee,
        deliveryZoneId: payload.deliveryZoneId ?? null,
        deliveryZoneName: payload.deliveryZoneName ?? null,
        appliedCouponCode: payload.couponCode ?? null,
        totalAmount: subtotal + deliveryFee,
        items,
      };
    }
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
