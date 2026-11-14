import { describe, expect, it } from 'vitest';
import { remainingInvoiceLineQuantity, isSelectedReturnQuantityValid, isReturnLineSelected, toggleReturnLineSelection } from './return-remaining-quantity';
describe('invoice return line limits', () => {
  it('keeps quantities separate for duplicate product on different invoice lines', () => {
    expect(remainingInvoiceLineQuantity(5, 3, true, false)).toBe(2);
    expect(remainingInvoiceLineQuantity(7, 1, true, false)).toBe(6);
  });
  it('blocks missing history, old unlinked returns and negative remainder', () => {
    expect(remainingInvoiceLineQuantity(5, 1, false, false)).toBe(0);
    expect(remainingInvoiceLineQuantity(5, 1, true, true)).toBe(0);
    expect(remainingInvoiceLineQuantity(5, 6, true, false)).toBe(0);
  });
});

describe('selected return preflight after history refresh', () => {
  it('blocks a stale selected quantity even when the invoice register shows older data', () => {
    expect(isSelectedReturnQuantityValid('11','9',5,4,{'11':2},[],true)).toBe(false);
    expect(isSelectedReturnQuantityValid('11','9',5,3,{'11':2},[],true)).toBe(true);
  });
  it('does not borrow a repeated product quantity from a separate invoice line', () => {
    expect(isSelectedReturnQuantityValid('10','9',3,3,{'10':1,'11':0},[],true)).toBe(false);
    expect(isSelectedReturnQuantityValid('11','9',3,3,{'10':1,'11':0},[],true)).toBe(true);
  });
  it('rejects untracked invoice lines and unreconciled legacy returns', () => {
    expect(isSelectedReturnQuantityValid('', '9', 3, 1, {}, [], true)).toBe(false);
    expect(isSelectedReturnQuantityValid('10', '9', 3, 1, {}, ['9'], true)).toBe(false);
    expect(isSelectedReturnQuantityValid('10', '9', 3, 1, {}, [], false)).toBe(false);
    expect(isSelectedReturnQuantityValid('10', '9', 3, NaN, {}, [], true)).toBe(false);
  });
});

/* SPICE-PKG3 (a) — weighed returns: checking a line stamps its
 * REMAINING quantity, never a hardcoded '1' (1 > 0.750 kg remaining
 * is an invalid selection — see the validity case below — so the
 * W07 return of 0.250 kg could never be executed). Selection is
 * key presence: typing '' / 0 while correcting a weighed qty must
 * not deselect the line. On the base these helpers do not exist
 * and the workspace stamps '1', so the cases fail there. */
describe('weighed return selection (SPICE-PKG3)', () => {
  it('stamps the remaining quantity when a weighed line is checked, never 1', () => {
    expect(toggleReturnLineSelection({}, '10', true, 0.75)).toEqual({ '10': '0.75' });
    expect(toggleReturnLineSelection({}, '10', true, 2)).toEqual({ '10': '2' });
    expect(toggleReturnLineSelection({}, '10', true, 0.25)).toEqual({ '10': '0.25' });
  });

  it('selects nothing when nothing remains (fully returned / history not ready / blocked)', () => {
    expect(toggleReturnLineSelection({}, '10', true, 0)).toEqual({});
    expect(toggleReturnLineSelection({}, '10', true, -1)).toEqual({});
  });

  it('unchecking removes the line, and re-checking re-stamps the remaining qty', () => {
    expect(toggleReturnLineSelection({ '10': '0.75' }, '10', false, 0.75)).toEqual({});
    expect(toggleReturnLineSelection({ '10': '0.75' }, '10', false, 0.75)).not.toHaveProperty('10');
    expect(toggleReturnLineSelection({}, '10', true, 0.75)).toEqual({ '10': '0.75' });
  });

  it('re-checking an already selected line keeps the merchant-edited qty', () => {
    expect(toggleReturnLineSelection({ '10': '0.25' }, '10', true, 0.75)).toEqual({ '10': '0.25' });
  });

  it('selection is key presence: an empty or zero qty is still selected', () => {
    expect(isReturnLineSelected({ '10': '' }, '10')).toBe(true);
    expect(isReturnLineSelected({ '10': '0' }, '10')).toBe(true);
    expect(isReturnLineSelected({ '10': '0.25' }, '10')).toBe(true);
    expect(isReturnLineSelected({}, '10')).toBe(false);
    expect(isReturnLineSelected({ '11': '1' }, '10')).toBe(false);
  });

  it('the hardcoded 1 is an invalid selection for a 0.750 kg remaining line, 0.250 is valid (W07)', () => {
    expect(isSelectedReturnQuantityValid('10', '10', 0.75, 1, {}, [], true)).toBe(false);
    expect(isSelectedReturnQuantityValid('10', '10', 0.75, 0.25, {}, [], true)).toBe(true);
    expect(isSelectedReturnQuantityValid('10', '10', 0.75, 0.75, {}, [], true)).toBe(true);
  });
});
