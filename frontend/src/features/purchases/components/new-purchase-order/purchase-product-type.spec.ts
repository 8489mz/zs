/* INV-SERVICE-ITEM-QUICK-CREATE: the purchase invoice maps catalog
 * products to line kinds through the service axis (itemType), not the
 * fashion axis (itemKind). The catalog API returns itemType
 * ('product' | 'raw_material' | 'service') and itemKind ('standard' |
 * 'fashion'); reading itemKind made every service item load as a
 * stocked product, so a service line always demanded a warehouse and
 * a quick-created service came back as stock. These checks fail if
 * the mapping reads the wrong axis again.
 */
import { describe, it, expect } from 'vitest';
import { mapPurchaseProductType } from './newPurchaseOrder.helpers';

describe('mapPurchaseProductType (INV-SERVICE-ITEM-QUICK-CREATE)', () => {
  it('reads the service axis: a service itemType is a service line', () => {
    expect(mapPurchaseProductType({ itemType: 'service', itemKind: 'standard' })).toBe('service');
    expect(mapPurchaseProductType({ itemType: 'service', itemKind: 'fashion' })).toBe('service');
  });

  it('keeps stocked products stocked whatever the fashion axis says', () => {
    expect(mapPurchaseProductType({ itemType: 'product', itemKind: 'standard' })).toBe('stock');
    expect(mapPurchaseProductType({ itemType: 'product', itemKind: 'fashion' })).toBe('stock');
    expect(mapPurchaseProductType({ itemType: 'raw_material' })).toBe('stock');
  });

  it('treats a missing type as stocked, the previous behaviour', () => {
    expect(mapPurchaseProductType({})).toBe('stock');
    expect(mapPurchaseProductType({ itemKind: 'fashion' })).toBe('stock');
  });

  it('accepts the legacy productType alias for a service', () => {
    expect(mapPurchaseProductType({ productType: 'service' })).toBe('service');
  });
});
