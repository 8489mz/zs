import { describe, expect, it } from 'vitest';
import type { Product } from '@/types/domain';
import { classifyStockCountBarcodeScan } from './count-barcode-identity';
const make = (id: string, barcode: string, styleCode = '300', multiplier = 1): Product => ({
  id, name: 'قميص', barcode, styleCode, itemKind: 'fashion', stock: 5,
  minStock: 0, categoryId: '', supplierId: '', costPrice: 10, retailPrice: 20,
  wholesalePrice: 15, notes: '', units: [{ id: 'b', name: 'قطعة', multiplier: 1,
    barcode, isBaseUnit: true, isSaleUnit: true, isPurchaseUnit: true },
    { id: 'c', name: 'كرتون', multiplier, barcode: 'BOX-' + id, isBaseUnit: false,
      isSaleUnit: false, isPurchaseUnit: true }],
});
describe('clothing count scanner', () => {
  it('rejects shared model code instead of counting first size', () => {
    expect(classifyStockCountBarcodeScan('300', [make('1', 'B1'), make('2', 'B2')]).status).toBe('style_code');
  });
  it('resolves exact size and carton multiplier', () => {
    const items = [make('1', 'B1', '300', 12), make('2', 'B2', '300', 6)];
    const single = classifyStockCountBarcodeScan('B2', items);
    expect(single.status).toBe('matched');
    if (single.status === 'matched') expect(single.product.id).toBe('2');
    const carton = classifyStockCountBarcodeScan('BOX-1', items);
    if (carton.status === 'matched') expect(carton.baseQty).toBe(12);
    else throw new Error('Expected matched carton');
  });
  it('rejects the same barcode for a piece and a carton of the SAME variant', () => {
    const row = make('1', 'DUP', '300', 12);
    row.units[1].barcode = 'DUP';
    expect(classifyStockCountBarcodeScan('DUP', [row]).status).toBe('ambiguous');
  });
  it('allows two identical base-unit representations of the same code', () => {
    expect(classifyStockCountBarcodeScan('B1', [make('1', 'B1')]).status).toBe('matched');
  });
  it('rejects barcode shared between two active size variants', () => {
    expect(classifyStockCountBarcodeScan('B1', [make('1', 'B1'), make('2', 'B1')]).status).toBe('ambiguous');
  });
  it('resolves dashed barcode when scanner types Arabic ظ separator under Arabic OS layout', () => {
    const items = [make('1', '321321-007', '321321', 1)];
    const res = classifyStockCountBarcodeScan('321321ظ007', items);
    expect(res.status).toBe('matched');
    if (res.status === 'matched') expect(res.product.id).toBe('1');
  });
});
