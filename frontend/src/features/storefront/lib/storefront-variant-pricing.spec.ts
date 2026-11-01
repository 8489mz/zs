import { describe, expect, it } from 'vitest';
import { buildCartProduct, getProductVariants, resolveVariantUnitPrice } from './storefront-variant-pricing';
import type { StorefrontProduct } from '../types/storefront.types';

function productWithVariants(): StorefrontProduct {
  return {
    id: 1,
    name: 'قميص',
    barcode: 'SHIRT-1',
    price: 500,
    categoryId: null,
    categoryName: 'ملابس',
    stockQty: 10,
    inStock: true,
    icon: '',
    imageUrl: '/api/storefront/media/1/aaa',
    description: '',
    variants: [
      { name: 'أحمر', price: 550, imageUrl: '/api/storefront/media/2/bbb' },
      { name: 'أزرق', extraPrice: 20 },
      { name: 'أخضر', price: 500, imageUrl: '  ' },
    ],
  };
}

describe('storefront variant photos (display-only)', () => {
  it('carries a variant photo through getProductVariants, trimmed', () => {
    const variants = getProductVariants(productWithVariants());
    expect(variants[0]?.imageUrl).toBe('/api/storefront/media/2/bbb');
    expect(variants[1]?.imageUrl).toBeUndefined();
    expect(variants[2]?.imageUrl).toBeUndefined();
  });

  it('drops a non-string photo instead of leaking junk to the UI', () => {
    const product = productWithVariants();
    (product.variants as unknown[])[0] = { name: 'أحمر', price: 550, imageUrl: 42 };
    expect(getProductVariants(product)[0]?.imageUrl).toBeUndefined();
  });

  it('builds the cart line with the picked variant photo, falling back to the product photo', () => {
    const product = productWithVariants();
    const red = buildCartProduct(product, 'أحمر');
    expect(red?.imageUrl).toBe('/api/storefront/media/2/bbb');
    expect(red?.variantName).toBe('أحمر');
    const blue = buildCartProduct(product, 'أزرق');
    expect(blue?.imageUrl).toBe('/api/storefront/media/1/aaa');
    const plain = buildCartProduct(product, null);
    expect(plain?.imageUrl).toBe('/api/storefront/media/1/aaa');
    expect(plain?.variantName).toBeNull();
  });

  it('never lets a photo affect the priced amount', () => {
    const variants = getProductVariants(productWithVariants());
    expect(resolveVariantUnitPrice(500, variants[0]!)).toBe(550);
    expect(resolveVariantUnitPrice(500, variants[1]!)).toBe(520);
  });
});
