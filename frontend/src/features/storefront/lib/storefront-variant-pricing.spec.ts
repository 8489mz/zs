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
    const red = buildCartProduct(product, 2, 'أحمر');
    expect(red?.imageUrl).toBe('/api/storefront/media/2/bbb');
    expect(red?.variantName).toBe('أحمر');
    const blue = buildCartProduct(product, 2, 'أزرق');
    expect(blue?.imageUrl).toBe('/api/storefront/media/1/aaa');
    const plain = buildCartProduct(product, 2, null);
    expect(plain?.imageUrl).toBe('/api/storefront/media/1/aaa');
    expect(plain?.variantName).toBeNull();
  });

  it('never lets a photo affect the priced amount', () => {
    const variants = getProductVariants(productWithVariants());
    expect(resolveVariantUnitPrice(500, variants[0]!, 2)).toBe(550);
    expect(resolveVariantUnitPrice(500, variants[1]!, 2)).toBe(520);
  });

  // INV-FE2-FRONTEND-BOOK-DIGITS: a variant price with a third decimal
  // keeps it at 3 book digits and rounds to 2dp at 2 digits. The old
  // code hardcoded Math.round(price*100)/100, so a 3-decimal store's
  // variant price (550.125) was silently cut to 550.13 in the cart.
  it('rounds variant prices at the passed book digits (3dp keeps the third decimal)', () => {
    const product = productWithVariants();
    (product.variants as unknown[])[0] = { name: 'أحمر', price: 550.125 };
    const kwd = buildCartProduct(product, 3, 'أحمر');
    expect(kwd?.price).toBe(550.125);
    const egp = buildCartProduct(product, 2, 'أحمر');
    expect(egp?.price).toBe(550.13);
    expect(resolveVariantUnitPrice(550.125, getProductVariants(product)[0]!, 3)).toBe(550.125);
    expect(resolveVariantUnitPrice(550.125, getProductVariants(product)[0]!, 2)).toBe(550.13);
  });
});
