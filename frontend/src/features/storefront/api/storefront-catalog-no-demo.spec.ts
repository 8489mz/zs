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
