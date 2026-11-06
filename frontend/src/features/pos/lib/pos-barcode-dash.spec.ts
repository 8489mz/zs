/* POS dashed barcode (INV-POS-BARCODE-DASH): frontend pin for the dashed
 * barcode contract. The cashier may type or scan a dashed barcode in any
 * letter case; the lookup chain must treat it as a barcode (not a text
 * search, not an invoice) and match it case-insensitively, exactly like
 * the backend does after this package. Drives the REAL lookup helpers.
 */
import { describe, expect, it } from 'vitest';
import { matchProductByCode } from '@/features/pos/lib/pos-workspace.helpers';
import {
  createProductBarcodeMap,
  isLikelyBarcodeQuery,
} from '@/features/pos/lib/pos-product-lookup';
import { parseQuantityPrefixQuery } from '@/features/pos/lib/pos-quantity-prefix';
import {
  isInvoiceBarcodeQuery,
  sanitizeSearchInputLive,
} from '@/features/pos/lib/pos-barcode-normalizer';

function product(barcode: string, sku = '') {
  return { id: '1', name: 'Dashed Product', barcode, sku, units: [] } as any;
}

describe('pos-barcode-dash frontend contract', () => {
  it('treats a dashed barcode as a barcode query, not text search', () => {
    expect(isLikelyBarcodeQuery('ABC-123-456')).toBe(true);
    expect(isLikelyBarcodeQuery('abc-123-456')).toBe(true);
    expect(isLikelyBarcodeQuery('622123-456789')).toBe(true);
  });

  it('matches a dashed barcode case-insensitively (quick-add submit path)', () => {
    const products = [product('ABC-123-456')];
    expect(matchProductByCode(products, 'abc-123-456').status).toBe('matched');
    expect(matchProductByCode(products, 'ABC-123-456').status).toBe('matched');
    expect(matchProductByCode([product('def-789-012')], 'DEF-789-012').status).toBe('matched');
    expect(matchProductByCode(products, 'ABC-123-457').status).toBe('not-found');
  });

  it('indexes a dashed barcode under its lowercase key', () => {
    const map = createProductBarcodeMap([product('ABC-123-456')]);
    expect(map.get('abc-123-456')?.barcode).toBe('ABC-123-456');
  });

  it('passes a dashed barcode through the quantity-prefix and live sanitizer untouched', () => {
    expect(parseQuantityPrefixQuery('ABC-123-456').cleanQuery).toBe('ABC-123-456');
    expect(parseQuantityPrefixQuery('ABC-123-456').hasPrefix).toBe(false);
    expect(sanitizeSearchInputLive('ABC-123-456')).toBe('ABC-123-456');
    expect(sanitizeSearchInputLive('abc-123-456')).toBe('abc-123-456');
  });

  it('does not treat a dashed alphanumeric product code as an invoice barcode', () => {
    expect(isInvoiceBarcodeQuery('ABC-123-456')).toBe(false);
    expect(isInvoiceBarcodeQuery('abc-123-456')).toBe(false);
  });
});
