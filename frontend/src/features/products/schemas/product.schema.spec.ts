import { describe, it, expect } from 'vitest';
import { productFormSchema } from './product.schema';

describe('productFormSchema', () => {
  const baseValidData = {
    barcode: '12345678',
    itemType: 'product' as const,
    itemKind: 'standard' as const,
    costPrice: 10,
    retailPrice: 15,
    wholesalePrice: 12,
    stock: 100,
    minStock: 5,
  };

  it('passes when Arabic name is provided', () => {
    const res = productFormSchema.safeParse({
      ...baseValidData,
      name: 'حليب المراعي',
    });
    expect(res.success).toBe(true);
  });

  it('passes when only English name is provided (e.g. MILK)', () => {
    const res = productFormSchema.safeParse({
      ...baseValidData,
      name: '',
      nameEn: 'MILK',
    });
    expect(res.success).toBe(true);
  });

  it('fails when both Arabic and English names are empty', () => {
    const res = productFormSchema.safeParse({
      ...baseValidData,
      name: '',
      nameEn: '',
    });
    expect(res.success).toBe(false);
    if (!res.success) {
      const errorMsg = res.error.issues.map((i) => i.message).join(' ');
      expect(errorMsg).toContain('اسم الصنف مطلوب');
    }
  });

  it('passes when calories is empty (NaN from an empty valueAsNumber input) and normalizes to null', () => {
    const res = productFormSchema.safeParse({
      ...baseValidData,
      name: 'برجر لحم',
      calories: Number.NaN,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.calories).toBeNull();
    }
  });

  it('preserves a numeric calories value (e.g. 450)', () => {
    const res = productFormSchema.safeParse({
      ...baseValidData,
      name: 'برجر لحم',
      calories: 450,
    });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.calories).toBe(450);
    }
  });
});
