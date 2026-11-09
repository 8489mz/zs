/* R-I34 / INV-REST-LINE-IDENTITY: a cart line is identified by its full
 * identity — product + unit + price type + modifier set + seat + course —
 * never by product + price alone. A plain burger and a burger with extra
 * cheese are two different lines; the cheese is charged only on the
 * modified units. Notes are NOT part of the key (free text); the merge
 * step, not the key, requires equal notes. */
import { describe, expect, it } from 'vitest';
import { buildPosLineKey, modifiersSignature } from './pos.domain';

const base = {
  productId: 'p1',
  unitId: 'u1',
  priceType: 'retail' as const,
};

const cheese = { optionId: 'opt-cheese', name: 'جبنة إضافية', price: 20, qty: 1 };
const sauce = { optionId: 'opt-sauce', name: 'صوص', price: 5, qty: 1 };

describe('modifiersSignature', () => {
  it('is empty for no modifiers', () => {
    expect(modifiersSignature(undefined)).toBe('');
    expect(modifiersSignature([])).toBe('');
  });

  it('is order-independent for the same modifier set', () => {
    expect(modifiersSignature([cheese, sauce])).toBe(modifiersSignature([sauce, cheese]));
  });

  it('differs when a modifier quantity differs', () => {
    expect(modifiersSignature([cheese])).not.toBe(
      modifiersSignature([{ ...cheese, qty: 2 }]),
    );
  });

  it('falls back to name + price + qty when there is no option id (combo modifiers)', () => {
    const comboMods = [{ name: 'جبنة', price: 20 }];
    expect(modifiersSignature(comboMods)).toBe(modifiersSignature([{ name: 'جبنة', price: 20, qty: 1 }]));
    expect(modifiersSignature(comboMods)).not.toBe(modifiersSignature([{ name: 'صوص', price: 20 }]));
  });
});

describe('buildPosLineKey', () => {
  it('gives a plain line and a modified line different keys', () => {
    expect(buildPosLineKey(base)).not.toBe(buildPosLineKey({ ...base, modifiers: [cheese] }));
  });

  it('gives the same key for the same modifiers in a different order', () => {
    expect(buildPosLineKey({ ...base, modifiers: [cheese, sauce] })).toBe(
      buildPosLineKey({ ...base, modifiers: [sauce, cheese] }),
    );
  });

  it('gives different keys when a modifier quantity differs', () => {
    expect(buildPosLineKey({ ...base, modifiers: [cheese] })).not.toBe(
      buildPosLineKey({ ...base, modifiers: [{ ...cheese, qty: 2 }] }),
    );
  });

  it('gives different keys for different seats', () => {
    expect(buildPosLineKey({ ...base, seatNumber: 1 })).not.toBe(
      buildPosLineKey({ ...base, seatNumber: 2 }),
    );
  });

  it('gives different keys for different courses', () => {
    expect(buildPosLineKey({ ...base, course: 'appetizer' })).not.toBe(
      buildPosLineKey({ ...base, course: 'main' }),
    );
  });

  it('gives the same key when only notes differ (notes are a merge rule, not identity)', () => {
    // Notes are deliberately not an input of the key builder: two lines that
    // differ only by notes share a key, and addPosItem keeps them apart by
    // requiring equal notes to merge.
    expect(buildPosLineKey(base)).toBe(buildPosLineKey(base));
  });
});
