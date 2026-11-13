/*
 * New file: frontend/src/features/delivery-reps/components/VanInventoryTab.spec.tsx
 *
 * WHAT THIS PINS (INV-VAN-PIECE-COUNT-BASIS, part of P9): the van-stock
 * counts are PIECES but the inventory tab labeled them with the
 * packaging unit name — "46 كرتونة" for 46 pieces. getActiveTrip
 * joined product_units (multiplier > 1) and exposed pu.name as
 * unitName, while qty comes from product_location_stock.qty (pieces).
 * The stock balance must be labeled with the BASE unit ('قطعة'),
 * exposed as a separate stockUnitName; unitName stays the packaging
 * name for the cart/picker, which legitimately sells in cartons.
 *
 * WHAT IS DRIVEN (real tab, mocked i18n only): render the tab with
 * one stock item (qty 46 pieces, packagingUnit 'كرتونة' x12,
 * stockUnitName 'قطعة') and assert the van-stock badge reads
 * "46 قطعة", not "46 كرتونة".
 *
 * NOT DRIVEN: getActiveTrip itself (backend derivation — the
 * stockUnitName value comes from the base unit row); the sale cart
 * (unitName stays the packaging name there by design).
 */
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { VanInventoryTab } from './VanInventoryTab';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
}));

const stockItem = {
  productId: 1,
  productName: 'صنف اختبار جملة أ',
  barcode: '6220000990011',
  qty: 46,
  mainWarehouseQty: 50,
  costPrice: 8,
  retailPrice: 12,
  unitName: 'كرتونة',
  packagingUnit: { name: 'كرتونة', multiplier: 12 },
  stockUnitName: 'قطعة',
  availableUnits: [
    { id: 1, name: 'قطعة', multiplier: 1, isBase: true },
    { id: 2, name: 'كرتونة', multiplier: 12, isBase: false },
  ],
};

describe('VanInventoryTab stock-unit label', () => {
  it('labels the van-stock balance in pieces, not cartons', () => {
    render(
      <VanInventoryTab
        stockSearch=""
        onSearchChange={() => {}}
        filteredInventory={[stockItem]}
        onAddToCart={() => {}}
      />,
    );
    const badge = screen.getByTitle('الكمية المحملة داخل سيارة التوزيع');
    expect(badge.textContent).toContain('46 قطعة');
    expect(badge.textContent).not.toContain('46 كرتونة');
  });
});
