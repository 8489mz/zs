import { describe, expect, it } from 'vitest';
import { buildFashionVariantDrafts, splitFashionTokens } from './fashion-variants.utils';

describe('fashion variants', () => {
  it('preserves fractional shoe sizes and hyphenated labels', () => {
    expect(splitFashionTokens('42.5، 43، 2-3 سنوات')).toEqual(['42.5', '43', '2-3 سنوات']);
  });

  it('splits variants using dash (-) with or without spaces like commas', () => {
    expect(splitFashionTokens('أحمر - أسود - أبيض')).toEqual(['احمر', 'اسود', 'ابيض']);
    expect(splitFashionTokens('أحمر-أسود-أبيض')).toEqual(['احمر', 'اسود', 'ابيض']);
    expect(splitFashionTokens('S - M - L - XL')).toEqual(['S', 'M', 'L', 'XL']);
    expect(splitFashionTokens('36-38-40')).toEqual(['36', '38', '40']);
    expect(splitFashionTokens('2-3 سنوات - 4-5 سنوات')).toEqual(['2-3 سنوات', '4-5 سنوات']);
  });

  it('deduplicates equivalent Arabic spellings while retaining the first label', () => {
    expect(splitFashionTokens('أحمر، احمر، أسود')).toHaveLength(2);
  });

  it('retains manually entered variants and quantities during generation', () => {
    const old = [{ id: 'old', color: 'أسود', size: '42.5', barcode: 'OLD-1', stock: 8, isManual: true }];
    const rows = buildFashionVariantDrafts(['أسود'], ['42.5', '43'], old, 2);
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.size === '42.5')?.stock).toBe(8);
    expect(rows.find((row) => row.size === '43')?.stock).toBe(2);
  });

  it('preserves a per-variant photo across regeneration', () => {
    const old = [{ id: 'old', color: 'أسود', size: '42.5', barcode: 'OLD-1', stock: 8, imageUrl: 'data:image/png;base64,AAA', isManual: true }];
    const rows = buildFashionVariantDrafts(['أسود'], ['42.5', '43'], old, 2);
    expect(rows.find((row) => row.size === '42.5')?.imageUrl).toBe('data:image/png;base64,AAA');
    expect(rows.find((row) => row.size === '43')?.imageUrl).toBeUndefined();
  });
});
