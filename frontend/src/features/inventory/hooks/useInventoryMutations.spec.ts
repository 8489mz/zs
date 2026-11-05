/* Stock-adjustment cache patch (INV-PRODUCTS-WORKSPACE-SAVE): after an
 * adjustment the list must show the new stock at once. Drives the real
 * patchInventoryAdjustmentInCache against a real QueryClient, with the
 * product id arriving as a string (as the backend echoes it) while cached
 * ids are numbers — the comparison the old code got wrong. */

import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { patchInventoryAdjustmentInCache } from '@/features/inventory/hooks/useInventoryMutations';

describe('patchInventoryAdjustmentInCache', () => {
  it('patches the full-list and the paged list with a string product id', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['products'], {
      products: [
        { id: 7, stock: 5 },
        { id: 8, stock: 9 },
      ],
    });
    queryClient.setQueryData(['products', 'page', 'q='], {
      products: [{ id: 7, stock: 5 }],
      pagination: { page: 1, pageSize: 20, totalItems: 2, totalPages: 1 },
      summary: {},
    });
    queryClient.setQueryData(['location-stocks'], [
      { productId: 7, locationId: 3, qty: 2 },
      { productId: 7, locationId: 4, qty: 9 },
    ]);

    patchInventoryAdjustmentInCache(queryClient, {
      productId: '7',
      locationId: '3',
      scopeAfter: 4,
      globalAfter: 7,
    });

    const full = queryClient.getQueryData<{ products: Array<{ id: number; stock: number }> }>(['products']);
    expect(full?.products).toEqual([
      { id: 7, stock: 7 },
      { id: 8, stock: 9 },
    ]);
    const paged = queryClient.getQueryData<{ products: Array<{ id: number; stock: number }> }>(['products', 'page', 'q=']);
    expect(paged?.products).toEqual([{ id: 7, stock: 7 }]);
    const stocks = queryClient.getQueryData<Array<{ productId: number; locationId: number; qty: number }>>(['location-stocks']);
    expect(stocks).toEqual([
      { productId: 7, locationId: 3, qty: 4 },
      { productId: 7, locationId: 4, qty: 9 },
    ]);
  });

  it('leaves caches without the product untouched', () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(['products'], { products: [{ id: 8, stock: 9 }] });
    queryClient.setQueryData(['products', 'page', 'q='], { products: [{ id: 8, stock: 9 }] });

    patchInventoryAdjustmentInCache(queryClient, { productId: '7', globalAfter: 7 });

    expect(queryClient.getQueryData(['products'])).toEqual({ products: [{ id: 8, stock: 9 }] });
    expect(queryClient.getQueryData(['products', 'page', 'q='])).toEqual({ products: [{ id: 8, stock: 9 }] });
  });
});
