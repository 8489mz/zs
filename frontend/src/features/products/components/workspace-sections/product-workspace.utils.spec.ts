/* Product workspace utils (INV-PRODUCTS-WORKSPACE-SAVE): the update payload
 * must not wipe the stored English name, and re-selecting the edited product
 * must fetch one row by id — never the whole catalog. Drives the real
 * buildUpdatePayload and refetchAndSelectProduct. */

import { describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import {
  buildUpdatePayload,
  refetchAndSelectProduct,
} from '@/features/products/components/workspace-sections/product-workspace.utils';
import { productsApi } from '@/features/products/api/products.api';
import { productFormSchema } from '@/features/products/schemas/product.schema';
import type { Product } from '@/types/domain';

const existingProduct = { id: 7, metadata: {}, offers: [] } as unknown as Product;

function makeValues(nameEn: string) {
  return productFormSchema.parse({
    name: 'منتج اختبار',
    nameEn,
    costPrice: 50,
    retailPrice: 70,
    wholesalePrice: 60,
    stock: 0,
    minStock: 0,
  });
}

describe('buildUpdatePayload', () => {
  it('omits nameEn when the field is empty, so the stored name is preserved', () => {
    const payload = buildUpdatePayload(makeValues(''), existingProduct, [], []);
    expect(payload.nameEn).toBeUndefined();
    // The key must not survive serialization: JSON.stringify drops undefined,
    // so the backend receives no nameEn key and its preserve branch keeps the
    // stored English name.
    expect(JSON.stringify(payload)).not.toContain('nameEn');
  });

  it('carries nameEn when the field has a value', () => {
    const payload = buildUpdatePayload(makeValues('Edited Manual Product'), existingProduct, [], []);
    expect(payload.nameEn).toBe('Edited Manual Product');
  });
});

describe('refetchAndSelectProduct', () => {
  it('fetches the one product by id and never lists the catalog', async () => {
    const queryClient = new QueryClient();
    const product = { id: 7, name: 'منتج اختبار', nameEn: 'Test Product' } as unknown as Product;
    const getSpy = vi.spyOn(productsApi, 'get').mockResolvedValue(product);
    const listSpy = vi.spyOn(productsApi, 'list').mockResolvedValue([]);
    try {
      const result = await refetchAndSelectProduct(queryClient, '7');
      expect(result).toEqual(product);
      expect(getSpy).toHaveBeenCalledWith('7');
      expect(listSpy).not.toHaveBeenCalled();
    } finally {
      getSpy.mockRestore();
      listSpy.mockRestore();
      queryClient.clear();
    }
  });

  it('returns null when the single-product fetch fails', async () => {
    const queryClient = new QueryClient();
    const getSpy = vi.spyOn(productsApi, 'get').mockRejectedValue(new Error('gone'));
    try {
      await expect(refetchAndSelectProduct(queryClient, '7')).resolves.toBeNull();
    } finally {
      getSpy.mockRestore();
      queryClient.clear();
    }
  });
});
