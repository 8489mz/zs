/* Product create payload (INV-PRODUCTS-WORKSPACE-SAVE): the English name must
 * travel with the create body. Drives the real buildProductPayload. */

import { describe, expect, it } from 'vitest';
import { buildProductPayload, type ProductFormValues } from '@/features/products/hooks/useCreateProductMutation';
import { productFormSchema } from '@/features/products/schemas/product.schema';

function makeValues(overrides: Partial<ProductFormValues> = {}): ProductFormValues {
  return {
    ...productFormSchema.parse({
      name: 'منتج اختبار',
      nameEn: 'Test Product',
      costPrice: 50,
      retailPrice: 70,
      wholesalePrice: 60,
      stock: 0,
      minStock: 0,
    }),
    units: [],
    ...overrides,
  };
}

describe('buildProductPayload', () => {
  it('carries the English name on create', () => {
    const payload = buildProductPayload(makeValues({ nameEn: 'Manual Test Product' }));
    expect(payload.nameEn).toBe('Manual Test Product');
    expect(payload.name).toBe('منتج اختبار');
  });

  it('trims the English name and omits it when empty', () => {
    expect(buildProductPayload(makeValues({ nameEn: '  Spaced Name  ' })).nameEn).toBe('Spaced Name');
    expect(buildProductPayload(makeValues({ nameEn: '' })).nameEn).toBeUndefined();
    expect(buildProductPayload(makeValues({ nameEn: '   ' })).nameEn).toBeUndefined();
  });
});
