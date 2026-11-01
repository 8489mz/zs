import { describe, expect, it } from 'vitest';
import {
  buildGroupSaveRows,
  buildPayload,
  deriveFashionStockPatch,
  pickFashionStockConsolidationTarget,
  type CommonDraft,
  type VariantDraft,
} from './FashionGroupEditorCard.helpers';
import type { Product } from '@/types/domain';

const variant = (id: string | undefined, color: string, costPrice = 10): VariantDraft => ({
  id, color, size: 'M', barcode: '', useCustomPricing: true, pricingEditorOpen: false,
  costPrice, retailPrice: 20, wholesalePrice: 15, stock: 4, originalStock: 4,
});

describe('fashion group inventory safety', () => {
  it('omits untouched stock when editing only model details', () => {
    expect(deriveFashionStockPatch(variant('7', 'أسود'))).toEqual({ stock: undefined, expectedStock: 4 });
  });
  it('sends original stock snapshot on an intentional adjustment', () => {
    expect(deriveFashionStockPatch({ ...variant('7', 'أسود'), stock: 3 })).toEqual({ stock: 3, expectedStock: 4 });
    expect(deriveFashionStockPatch(variant(undefined, 'أبيض'))).toEqual({ stock: 4, expectedStock: undefined });
  });
  it('never chooses an unsaved variant as consolidation target and strictly enforces color matching', () => {
    const rows = [variant(undefined, 'أسود'), variant('11', 'كحلي'), variant('12', 'أسود')];
    expect(pickFashionStockConsolidationTarget(rows, variant('21', 'أسود'))?.id).toBe('12');
    // Removing green must NEVER dump stock into navy or black - must return undefined!
    expect(pickFashionStockConsolidationTarget(rows, variant('22', 'أخضر'))).toBeUndefined();
    expect(pickFashionStockConsolidationTarget([rows[0]], variant('22', 'أخضر'))).toBeUndefined();
  });
});

describe('fashion group photo save (SF-12)', () => {
  const common: CommonDraft = {
    name: 'تيشيرت بولو', styleCode: '901', itemKind: 'fashion', itemType: 'product',
    costPrice: 50, retailPrice: 100, wholesalePrice: 0, minStock: 1,
    categoryId: '', supplierId: '', notes: '', defaultLocationId: '',
  };
  const source = { id: 7, offers: [], stock: 4 } as unknown as Product;
  // Simulates an uncapped instant-cut output: webp data URL far larger than
  // the 100KB compressed upload (the exact value shape that vanished).
  const cutPhoto = `data:image/webp;base64,${'A'.repeat(150_000)}`;

  it('carries a cut photo from the draft row through the save payload', () => {
    const clean = buildGroupSaveRows([{ ...variant('7', 'أبيض'), imageUrl: cutPhoto }], 1);
    expect(clean).toHaveLength(1);
    expect(clean[0].imageUrl).toBe(cutPhoto);
    const payload = buildPayload(common, clean[0], source);
    expect(payload.imageUrl).toBe(cutPhoto);
  });

  it('sends an explicit empty photo for an existing row so the stored photo is cleared', () => {
    const clean = buildGroupSaveRows([{ ...variant('7', 'أبيض'), imageUrl: '' }], 1);
    const payload = buildPayload(common, clean[0], source);
    expect(payload.imageUrl).toBe('');
  });

  it('sends no photo key for a new row without a photo', () => {
    const clean = buildGroupSaveRows([{ ...variant(undefined, 'أبيض') }], 1);
    const payload = buildPayload(common, clean[0], undefined);
    expect('imageUrl' in payload).toBe(false);
  });

  it('keeps the other save fields intact through the projection', () => {
    const clean = buildGroupSaveRows([{ ...variant('7', 'أبيض', 50), barcode: '901-002', sku: 'SKU-1', imageUrl: cutPhoto }], 1);
    expect(clean[0]).toMatchObject({ barcode: '901-002', sku: 'SKU-1', costPrice: 50, stock: 4 });
    const payload = buildPayload(common, clean[0], source);
    expect(payload.barcode).toBe('901-002');
    expect(payload.sku).toBe('SKU-1');
  });
});
