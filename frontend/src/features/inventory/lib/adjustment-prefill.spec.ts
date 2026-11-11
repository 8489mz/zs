/* INV-ADJUST-SINGLE-QTY-BASIS: the adjustment dialog prefills from
 * the location's available qty, never from the global raw stock. */
import { describe, expect, it } from 'vitest';
import { resolveAdjustmentPrefill } from './adjustment-prefill';

describe('adjustment prefill basis', () => {
  it('prefills the available qty when the live read resolved (10 raw / 2 reserved -> 8)', () => {
    expect(resolveAdjustmentPrefill({ availableQty: 8, locationQty: 10, globalStock: 12 })).toBe(8);
  });
  it('prefills zero available when reservations cover the whole location stock', () => {
    expect(resolveAdjustmentPrefill({ availableQty: 0, locationQty: 2, globalStock: 2 })).toBe(0);
  });
  it('falls back to the selected location raw qty while the live read is pending', () => {
    expect(resolveAdjustmentPrefill({ availableQty: null, locationQty: 10, globalStock: 12 })).toBe(10);
  });
  it('falls back to the global stock only when no location qty is known', () => {
    expect(resolveAdjustmentPrefill({ availableQty: undefined, locationQty: undefined, globalStock: 12 })).toBe(12);
  });
  it('prefills zero when nothing is known', () => {
    expect(resolveAdjustmentPrefill({})).toBe(0);
  });
});
