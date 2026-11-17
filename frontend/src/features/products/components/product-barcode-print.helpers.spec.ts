import { describe, expect, it } from 'vitest';
import type { Product } from '@/types/domain';
import { collectFashionBarcodeItems, getSavedUnitBarcode } from './product-barcode-print.helpers';
import { buildGroupBarcodePrintItems } from './workspace-sections/FashionGroupBarcodePrintAction';

const product = (id: string, styleCode: string, itemKind: 'fashion' | 'standard' = 'fashion', isActive = true): Product => ({
  id, name: 'Shirt', barcode: id, styleCode, itemKind, isActive, color: 'black', size: id,
  stock: 4, minStock: 0, costPrice: 12, retailPrice: 20, wholesalePrice: 15,
  categoryId: '', supplierId: '', notes: '', units: [],
});

describe('clothing barcode print integrity', () => {
  it('does not silently print a different base barcode for a non-base unit', () => {
    const row = product('A', '');
    expect(getSavedUnitBarcode(row, { id: 'u2', name: 'box', multiplier: 10,
      barcode: '', isBaseUnit: false, isSaleUnit: false, isPurchaseUnit: true })).toBe('');
    expect(getSavedUnitBarcode(row, null)).toBe('A');
  });
  it('prints only active variants in the exact fashion model, with no duplicate selected row', () => {
    const selected = product('2', '123');
    const rows = [product('1', '123'), product('2', '123'), product('3', '123', 'standard'),
      product('4', '124'), product('5', '123', 'fashion', false)];
    expect(collectFashionBarcodeItems(selected, rows).map((v) => v.product.id)).toEqual(['1', '2']);
  });
  it('returns only the requested standard product outside fashion mode', () => {
    expect(collectFashionBarcodeItems(product('7', '', 'standard'), [product('9', '123')])).toHaveLength(1);
  });
  it('filters inactive and unbarcoded variants when building fashion group print batch items', () => {
    const rows: Product[] = [
      { ...product('1', '123'), color: 'بني', size: 'L', barcode: 'BC-1', stock: 5 },
      { ...product('2', '123'), color: 'أسود', size: 'M', barcode: '', units: [], stock: 3 },
      { ...product('3', '123', 'fashion', false), color: 'أبيض', size: 'S', barcode: 'BC-3', stock: 2 },
    ];
    const result = buildGroupBarcodePrintItems(rows);
    expect(result.skippedMissingBarcode).toBe(1);
    expect(result.items.map((i) => i.product.id)).toEqual(['1']);
    expect(result.items[0].copies).toBe(5);
  });
});
