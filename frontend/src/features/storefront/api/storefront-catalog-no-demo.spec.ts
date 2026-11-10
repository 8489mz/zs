/* R3-C (INV-REST-STOREFRONT-NO-DEMO): the storefront catalog never serves
 * the demo menu. At base (3f3212ac) getCatalog swallowed ANY http error
 * (404, unknown slug, network failure) and returned a deep clone of the
 * demo catalog, so a dead link still served a full demo menu through the
 * API layer — below R2-A's fix, which only removed the fallback in the
 * kiosk hook. The response also carried no store identity, so no caller
 * could tell whose menu it was showing.
 *
 * The fix: getCatalog no longer catches http errors (an ApiError
 * propagates to the caller, which fails closed), and the response is
 * stamped with the store it belongs to — storeSlug is the requested slug,
 * normalized the same way the server normalizes it; storeName is the name
 * the server sent, or null, never invented.
 *
 * Driven here with a mocked transport, following the
 * storefront-order-create.spec.ts precedent: the real getCatalog and the
 * real resolveStorefrontCatalogResponse run against a mocked http layer.
 *
 * RED PROOF: the getCatalog error case below fails at base — the call
 * resolves with the demo catalog instead of rejecting. Verified with a
 * temporary probe spec run against the base module (probe deleted after;
 * the real spec's error case covers the same assertion permanently).
 * The pure helper itself is new, so there is no helper-level base run.
 *
 * R6-A (INV-REST-QUOTECART-NO-DEMO): the same demo-fallback disease
 * survived in three more functions of the same file — quoteCart priced
 * the cart from DEMO_STOREFRONT_CATALOG on ANY http error and returned
 * { ok: true, totalAmount } the caller could not distinguish from the
 * server's quote; getSearchSuggestions filtered the demo catalog by the
 * query; getProductDetails returned the demo product with the requested
 * id, or DEMO_STOREFRONT_CATALOG.products[0] for an unknown id. All
 * three now let the ApiError propagate (same fail-closed shape as
 * getCatalog). RED PROOF for the quote case: at base the error case
 * below resolves a demo-priced quote; after the fix it rejects.
 * The checkout-modal caller case (a rejected quote clears the stale
 * serverQuote) is NOT pinned here: the modal spec has no rendering
 * harness (it only tests exported validation helpers), and no harness
 * was invented — the one-line .catch change is pinned by code review.
 *
 * D-SF-07 (INV-SF-DEMO-FEE-35-REMOVED): the last demo fallback in this
 * file was getInfo — on ANY http error it returned DEMO_STOREFRONT_INFO
 * (deliveryFee 35) stamped with the requested slug, so a dead info fetch
 * rendered a demo store and the checkout modal showed the stale 35 as
 * the delivery fee when the server quote also failed. getInfo now lets
 * the ApiError propagate; the public page fails closed on
 * infoQuery.isError with an explicit error screen, and the hook's
 * empty-info default carries deliveryFee 0. The modal itself needs no
 * change: it has no 35 literal and its fee comes only from the props
 * (server quote, delivery zone, info.deliveryFee) — with the getInfo
 * fallback gone, no 35 can reach it. RED PROOF: at base the error case
 * below resolves demo info (deliveryFee 35); after the fix it rejects.
 * Verified by temporarily restoring the old catch in place and
 * re-running this spec (red: the 2 error cases fail, exit 1), then
 * re-applying the fix with the same targeted edit (green: 21 passed,
 * exit 0).
 */

import { describe, expect, it, vi } from 'vitest';
import { storefrontApi, resolveStorefrontCatalogResponse } from './storefront.api';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

const serverCatalog = {
  categories: [
    { id: 7, name: 'مشويات', imageUrl: '' },
    { id: 9, name: 'مشروبات', imageUrl: '' },
  ],
  products: [
    {
      id: 16812,
      name: 'وجبة مشويات',
      barcode: 'BC16812',
      price: 131.6,
      categoryId: 7,
      categoryName: 'مشويات',
      stockQty: 40,
      inStock: true,
      icon: '',
      imageUrl: '',
      description: '',
    },
    {
      id: 16813,
      name: 'عصير مانجو',
      barcode: 'BC16813',
      price: 25,
      categoryId: 9,
      categoryName: 'مشروبات',
      stockQty: 12,
      inStock: true,
      icon: '',
      imageUrl: '',
      description: '',
    },
  ],
  totalCount: 2,
};

describe('storefront getCatalog never serves the demo menu (INV-REST-STOREFRONT-NO-DEMO)', () => {
  it('rejects on HTTP error instead of resolving with a menu', async () => {
    httpMock.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    await expect(storefrontApi.getCatalog('no-such-store')).rejects.toThrow('404');
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith('/api/storefront/no-such-store/catalog');
  });

  it('returns exactly the server catalog, stamped with the requested store', async () => {
    httpMock.mockResolvedValueOnce(serverCatalog);
    const res = await storefrontApi.getCatalog('Almhnds');
    // The server's products, verbatim — not the demo menu.
    expect(res.products.map((p) => p.id)).toEqual([16812, 16813]);
    expect(res.products.map((p) => p.name)).toEqual(['وجبة مشويات', 'عصير مانجو']);
    expect(res.products[0].price).toBe(131.6);
    expect(res.categories.map((c) => c.id)).toEqual([7, 9]);
    // Store identity: the requested slug, normalized — never 'demo'.
    expect(res.storeSlug).toBe('almhnds');
    expect(res.storeSlug).not.toBe('demo');
    // No name invented: the server sent none.
    expect(res.storeName).toBeNull();
    // The server's totalCount survives the normalization.
    expect((res as unknown as { totalCount?: number }).totalCount).toBe(2);
  });

  it('passes a server-sent store name through', async () => {
    httpMock.mockResolvedValueOnce({ ...serverCatalog, storeName: 'مطعم المهندس' });
    const res = await storefrontApi.getCatalog('almhnds');
    expect(res.storeSlug).toBe('almhnds');
    expect(res.storeName).toBe('مطعم المهندس');
  });

  it('stamps the requested slug even when the payload looks like a demo menu', () => {
    // A payload shaped exactly like the demo catalog must still be
    // stamped with the store that was asked for — the stamp, not the
    // payload, says whose menu this is.
    const demoShaped = {
      categories: [{ id: 1, name: 'Demo Category', imageUrl: '' }],
      products: [
        {
          id: 1,
          name: 'Demo Product',
          barcode: 'DEMO1',
          price: 100,
          categoryId: 1,
          categoryName: 'Demo Category',
          stockQty: 99,
          inStock: true,
          icon: '',
          imageUrl: '',
          description: '',
        },
      ],
    };
    const res = resolveStorefrontCatalogResponse(demoShaped as never, 'almhnds');
    expect(res.storeSlug).toBe('almhnds');
    expect(res.storeSlug).not.toBe('demo');
    expect(res.products[0].name).toBe('Demo Product');
  });

  it('normalizes string ids to numbers', () => {
    const res = resolveStorefrontCatalogResponse(
      {
        categories: [{ id: '7', name: 'مشويات', imageUrl: '' }],
        products: [{ ...serverCatalog.products[0], id: '16812', categoryId: '7' }],
      } as never,
      'almhnds',
    );
    expect(res.categories[0].id).toBe(7);
    expect(res.products[0].id).toBe(16812);
    expect(res.products[0].categoryId).toBe(7);
  });

  it('throws on a missing or malformed server response instead of inventing a menu', () => {
    expect(() => resolveStorefrontCatalogResponse(null, 'almhnds')).toThrow();
    expect(() => resolveStorefrontCatalogResponse(undefined, 'almhnds')).toThrow();
    expect(() =>
      resolveStorefrontCatalogResponse({ categories: [] } as never, 'almhnds'),
    ).toThrow();
  });
});

describe('storefront getCatalogPage serves one server page (T10-B INV-REST-KIOSK-MENU-SCALE)', () => {
  const serverPage = {
    ...serverCatalog,
    page: 2,
    pageSize: 50,
    totalCount: 10_000,
    hasMore: true,
  };

  it('requests page + pageSize on the catalog URL — never the whole catalog', async () => {
    httpMock.mockResolvedValueOnce(serverPage);
    const res = await storefrontApi.getCatalogPage('test10k', { page: 2, pageSize: 50 });
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith('/api/storefront/test10k/catalog?page=2&pageSize=50');
    expect(res.products.map((p) => p.id)).toEqual([16812, 16813]);
    expect(res.page).toBe(2);
    expect(res.pageSize).toBe(50);
    expect(res.totalCount).toBe(10_000);
    expect(res.hasMore).toBe(true);
    expect(res.storeSlug).toBe('test10k');
  });

  it('passes categoryId and q through so search/category filter server-side', async () => {
    httpMock.mockResolvedValueOnce({ ...serverPage, page: 1, totalCount: 1, hasMore: false });
    const res = await storefrontApi.getCatalogPage('test10k', {
      page: 1,
      pageSize: 50,
      categoryId: 7,
      q: 'مشويات',
    });
    const url = String(httpMock.mock.calls[0][0]);
    expect(url).toContain('page=1');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('categoryId=7');
    expect(url).toContain(`q=${encodeURIComponent('مشويات')}`);
    expect(res.totalCount).toBe(1);
    expect(res.hasMore).toBe(false);
  });

  it('defaults to page 1 and clamps pageSize to the server max of 200', async () => {
    httpMock.mockResolvedValueOnce({ ...serverPage, page: 1, pageSize: 200 });
    await storefrontApi.getCatalogPage('test10k', { pageSize: 500 });
    expect(httpMock).toHaveBeenCalledWith('/api/storefront/test10k/catalog?page=1&pageSize=200');
  });

  it('rejects on HTTP error instead of resolving a menu', async () => {
    httpMock.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    await expect(storefrontApi.getCatalogPage('no-such-store', { page: 1 })).rejects.toThrow('404');
  });
});

describe('storefront quote/search/details never serve demo data (INV-REST-QUOTECART-NO-DEMO)', () => {
  const quotePayload = {
    items: [{ productId: 16812, quantity: 2 }],
    orderType: 'delivery' as const,
  };

  const serverQuote = {
    ok: true,
    subtotal: 263.2,
    originalSubtotal: 263.2,
    bogoSavings: 0,
    discountAmount: 0,
    deliveryFee: 15,
    deliveryZoneId: null,
    deliveryZoneName: null,
    appliedCouponCode: null,
    totalAmount: 278.2,
    items: [
      {
        productId: 16812,
        name: 'وجبة مشويات',
        variantName: null,
        barcode: 'BC16812',
        quantity: 2,
        baseUnitPrice: 131.6,
        unitPrice: 131.6,
        total: 263.2,
        originalTotal: 263.2,
      },
    ],
  };

  it('quoteCart rejects on HTTP error instead of resolving a demo-priced quote', async () => {
    httpMock.mockRejectedValueOnce(new Error('Request failed with status code 500'));
    await expect(storefrontApi.quoteCart('almhnds', quotePayload)).rejects.toThrow('500');
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith(
      '/api/storefront/almhnds/cart/quote',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('quoteCart success path passes the server quote through byte-identical', async () => {
    httpMock.mockResolvedValueOnce(serverQuote);
    const res = await storefrontApi.quoteCart('almhnds', quotePayload);
    expect(res).toEqual(serverQuote);
    expect(res.subtotal).toBe(263.2);
    expect(res.deliveryFee).toBe(15);
    expect(res.totalAmount).toBe(278.2);
    expect(res.items[0].name).toBe('وجبة مشويات');
  });

  it('getSearchSuggestions rejects on HTTP error instead of returning demo matches', async () => {
    httpMock.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    await expect(storefrontApi.getSearchSuggestions('almhnds', 'مشويات')).rejects.toThrow('404');
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith('/api/storefront/almhnds/search/suggest?q=%D9%85%D8%B4%D9%88%D9%8A%D8%A7%D8%AA');
  });

  it('getSearchSuggestions success path returns the server suggestions', async () => {
    httpMock.mockResolvedValueOnce({
      categories: [{ id: 7, name: 'مشويات', imageUrl: '' }],
      products: [
        { id: 16812, name: 'وجبة مشويات', price: 131.6, imageUrl: '', categoryName: 'مشويات', inStock: true },
      ],
    });
    const res = await storefrontApi.getSearchSuggestions('almhnds', 'مشويات');
    expect(res.categories.map((c) => c.id)).toEqual([7]);
    expect(res.products.map((p) => p.id)).toEqual([16812]);
    expect(res.products[0].price).toBe(131.6);
  });

  it('getProductDetails rejects on HTTP error instead of returning a demo product', async () => {
    httpMock.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    await expect(storefrontApi.getProductDetails('almhnds', 16812)).rejects.toThrow('404');
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith('/api/storefront/almhnds/products/16812');
  });

  it('getProductDetails rejects for an unknown id on error — never demo product #1', async () => {
    httpMock.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    await expect(storefrontApi.getProductDetails('almhnds', 999999)).rejects.toThrow('404');
  });

  it('getProductDetails success path returns the server product, related and cross-sell', async () => {
    const serverProduct = {
      id: 16812,
      name: 'وجبة مشويات',
      barcode: 'BC16812',
      price: 131.6,
      categoryId: 7,
      categoryName: 'مشويات',
      stockQty: 40,
      inStock: true,
      icon: '',
      imageUrl: '',
      description: '',
    };
    httpMock.mockResolvedValueOnce({
      product: serverProduct,
      related: [{ ...serverProduct, id: 16813, name: 'عصير مانجو', price: 25 }],
      crossSell: [],
    });
    const res = await storefrontApi.getProductDetails('almhnds', 16812);
    expect(res.product.id).toBe(16812);
    expect(res.product.name).toBe('وجبة مشويات');
    expect(res.product.price).toBe(131.6);
    expect(res.related.map((p) => p.id)).toEqual([16813]);
    expect(res.crossSell).toEqual([]);
  });
});

describe('storefront getInfo never serves demo info (INV-SF-DEMO-FEE-35-REMOVED)', () => {
  const serverInfo = {
    tenantId: 't-1',
    slug: 'almhnds',
    businessName: 'مطعم المهندس',
    enabled: true,
    title: 'مطعم المهندس',
    bio: '',
    announcement: '',
    bannerUrl: '',
    deliveryFee: 15,
    freeShippingEnabled: true,
    freeShippingMinOrder: 300,
    minOrder: 0,
    whatsappPhone: '',
    currency: 'EGP',
    smartDealsEnabled: false,
  };

  it('rejects on HTTP error instead of resolving demo info with deliveryFee 35', async () => {
    httpMock.mockRejectedValueOnce(new Error('Request failed with status code 404'));
    await expect(storefrontApi.getInfo('no-such-store')).rejects.toThrow('404');
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith('/api/storefront/no-such-store/info');
  });

  it('rejects on a network failure too — never a demo store', async () => {
    httpMock.mockRejectedValueOnce(new Error('Network Error'));
    await expect(storefrontApi.getInfo('almhnds')).rejects.toThrow('Network Error');
    expect(httpMock).toHaveBeenCalledTimes(1);
    expect(httpMock).toHaveBeenCalledWith('/api/storefront/almhnds/info');
  });

  it('returns exactly the server info — the server fee, never 35', async () => {
    httpMock.mockResolvedValueOnce(serverInfo);
    const res = await storefrontApi.getInfo('almhnds');
    expect(res.deliveryFee).toBe(15);
    expect(res.deliveryFee).not.toBe(35);
    expect(res.slug).toBe('almhnds');
    expect(res.freeShippingMinOrder).toBe(300);
    expect(res.currency).toBe('EGP');
  });

  it('passes a zero server fee through instead of substituting 35', async () => {
    httpMock.mockResolvedValueOnce({ ...serverInfo, deliveryFee: 0 });
    const res = await storefrontApi.getInfo('almhnds');
    expect(res.deliveryFee).toBe(0);
  });
});
