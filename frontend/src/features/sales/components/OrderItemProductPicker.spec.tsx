/*
New file: frontend/src/features/sales/components/OrderItemProductPicker.spec.tsx
Pins INV-SALES-ORDER-RESERVED-STOCK-DISPLAY (Import Batch I9, R7) on
the sales-order modal's product picker, driving the REAL
OrderItemProductPicker.

THE DEFECT: the picker's dropdown badge read the catalog stock
(`prod.stock` = products.stock_qty, on-hand before reservations) and
showed "متوفر: 10" for a product whose 10 units were already reserved
by SO-261108-0008 — while approval would refuse the same product with
0 available. The badge must show ONLY the reserved-aware availability
in the selected warehouse, fetched for the options the dropdown shows.

WHAT THIS PINS (fixture: catalog stock 10, all 10 reserved —
availability 0): opening the picker fetches the reserved-aware
availability for the shown option and the badge shows "غير متوفر",
never "متوفر: 10".
*/

import { useCallback, useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { OrderItemProductPicker } from '@/features/sales/components/OrderItemProductPicker';

const PRODUCTS: any[] = [
  {
    id: 1,
    name: 'اختبار صنف استيراد 001',
    barcode: 'TEST-001',
    sku: 'TEST-001',
    retailPrice: 120,
    wholesalePrice: 120,
    stock: 10,
    units: [{ name: 'قطعة' }],
  },
];

function PickerHarness({ onRefresh }: { onRefresh: (ids: number[]) => void }) {
  const [availabilityByProduct, setAvailabilityByProduct] = useState<Record<number, number>>({});
  const refreshAvailability = useCallback(
    (ids: number[]) => {
      onRefresh(ids);
      // The reserved-aware read answers 0: all 10 units reserved.
      setAvailabilityByProduct((prev) => {
        const next = { ...prev };
        ids.forEach((id) => {
          next[id] = 0;
        });
        return next;
      });
    },
    [onRefresh],
  );
  return (
    <OrderItemProductPicker
      value=""
      selectedProductId={0}
      quantity={1}
      products={PRODUCTS}
      onChangeText={() => {}}
      onSelectProduct={() => {}}
      availabilityByProduct={availabilityByProduct}
      refreshAvailability={refreshAvailability}
    />
  );
}

describe('order item product picker reserved stock display', () => {
  it('shows the reserved-aware availability for the shown option, never the catalog stock', async () => {
    const onRefresh = vi.fn();
    render(<PickerHarness onRefresh={onRefresh} />);

    const input = screen.getByPlaceholderText('ابحث باسم الصنف أو الباركود أو الكود...');
    // The picker opens on focus (it has no onClick opener).
    fireEvent.focus(input);
    await screen.findByText('اختبار صنف استيراد 001', {}, { timeout: 10000 });

    // Opening the picker fetches the reserved-aware availability for
    // the shown option (the same read the approval check enforces).
    await waitFor(
      () => {
        expect(onRefresh).toHaveBeenCalled();
      },
      { timeout: 10000 },
    );
    expect(onRefresh).toHaveBeenCalledWith([1]);

    // All 10 units are reserved: the badge must say unavailable,
    // never "متوفر: 10" from the catalog stock.
    await waitFor(
      () => {
        expect(screen.getByText('غير متوفر')).toBeTruthy();
      },
      { timeout: 10000 },
    );
    expect(screen.queryByText('متوفر: 10')).toBeNull();
  }, 60000);
});
