/* Product name fallback (INV-PRODUCT-NAME-FALLBACK, decision (أ)): no
 * write-time copy — an empty Arabic name stays empty and the English name
 * stays in its own field; the English name is a DISPLAY fallback only.
 * Drives the real submit/display helpers used by both product forms and
 * the products table. */
import { describe, expect, it } from 'vitest';
import { displayProductName, resolveProductSubmitNames } from './product-submit.utils';

describe('product name fallback', () => {
  it('submit keeps an empty Arabic name empty for an English-only product', () => {
    expect(resolveProductSubmitNames({ name: '', nameEn: 'Bluetooth Headphones' })).toEqual({
      name: '',
      nameEn: 'Bluetooth Headphones',
    });
  });

  it('submit keeps both names when both are given, trimmed', () => {
    expect(resolveProductSubmitNames({ name: '  سماعات  ', nameEn: '  Headphones ' })).toEqual({
      name: 'سماعات',
      nameEn: 'Headphones',
    });
  });

  it('submit keeps an Arabic-only product without inventing an English name', () => {
    expect(resolveProductSubmitNames({ name: 'سماعات', nameEn: '' })).toEqual({
      name: 'سماعات',
      nameEn: '',
    });
  });

  it('display falls back to English only when Arabic is empty', () => {
    expect(displayProductName({ name: '', nameEn: 'Bluetooth Headphones' })).toBe('Bluetooth Headphones');
  });

  it('display prefers Arabic when it exists', () => {
    expect(displayProductName({ name: 'سماعات', nameEn: 'Headphones' })).toBe('سماعات');
  });

  it('display is empty when both names are empty', () => {
    expect(displayProductName({ name: '', nameEn: '' })).toBe('');
    expect(displayProductName({})).toBe('');
  });
});
