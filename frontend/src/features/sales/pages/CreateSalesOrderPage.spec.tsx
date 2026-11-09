/*
New file: frontend/src/features/sales/pages/CreateSalesOrderPage.spec.tsx
Pins INV-SALES-ORDER-WAREHOUSE-SELECTION (Import Batch I3, D2) on the
order form, driving the REAL CreateSalesOrderPage.

THE DEFECT (live trial phase 2, SO-261108-0008): the form had NO
warehouse selector and the line badge read the GLOBAL product stock,
while approval validated only the branch's default selling warehouse —
the line showed "10 متاح" and approval failed with 0 in that
warehouse.

THE FIX: the form offers a warehouse selector defaulting to the
branch's default selling warehouse; the line badge reads the
availability IN THE SELECTED WAREHOUSE (same backend read the
approval check enforces); the submitted order carries that warehouse.

WHAT THIS PINS (fixture: global 15 = 5 in the default warehouse +
10 in the transfer warehouse):
1. The warehouse selector defaults to the branch's default selling
   warehouse ("مخزن البيع الأساسي").
2. Picking the product shows the SELECTED warehouse's availability
   on the line — 5 in the default warehouse, NOT the global 15.
3. Switching the warehouse to "مخزن اختبار تحويل" refreshes the
   same line to 10.
4. Submitting sends warehouseLocationId of the selected warehouse.

The catalog/branch/location/availability layers are mocked at the
module boundary; the page, the warehouse hook and the availability
wiring are all real.
*/

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CreateSalesOrderPage } from '@/features/sales/pages/CreateSalesOrderPage';

// jsdom does not implement scrollIntoView; CustomSelect calls it when
// its dropdown opens. Stub it so the selector can be driven here.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const mocks = vi.hoisted(() => ({
  createSalesOrder: vi.fn(),
  availability: vi.fn(async (productId: number, locationId: number | null) => ({
    productId,
    locationId,
    branchId: 1,
    locationQty: locationId === 20 ? 10 : 5,
    locationReservedQty: 0,
    unassignedQty: 0,
    unassignedReservedQty: 0,
    availableAtLocation: locationId === 20 ? 10 : locationId === 10 ? 5 : 15,
    globalAvailable: 15,
  })),
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useProductsQuery: () => ({
    data: [
      {
        id: 1,
        name: 'اختبار صنف استيراد 001',
        barcode: 'TEST-001',
        sku: 'TEST-001',
        retailPrice: 120,
        wholesalePrice: 120,
        stock: 15,
        units: [{ name: 'قطعة' }],
      },
    ],
  }),
  useBranchesQuery: () => ({
    data: [{ id: '1', name: 'الفرع الرئيسي', defaultStockLocationId: '10' }],
  }),
  useLocationsQuery: () => ({
    data: [
      { id: '10', branchId: '1', name: 'مخزن البيع الأساسي', isActive: true },
      { id: '20', branchId: '1', name: 'مخزن اختبار تحويل', isActive: true },
    ],
  }),
}));

vi.mock('../hooks/useCreateSalesOrderForm', () => ({
  useCreateSalesOrderForm: () => ({
    customers: [],
    createSalesOrder: mocks.createSalesOrder,
    isSubmitting: false,
  }),
}));

vi.mock('../api/sales-orders.api', () => ({
  salesOrdersApi: { availability: mocks.availability },
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.localStorage.clear();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CreateSalesOrderPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function badgeWith(text: string) {
  // The badge text lives in a <span class="nav-pill">; its parent <td>
  // shares the same textContent, so pick the span explicitly.
  const matches = screen.getAllByText((_content, element) => element?.textContent === text);
  const span = matches.find((el) => el.tagName === 'SPAN');
  if (!span) throw new Error(`no badge span with text "${text}"`);
  return span;
}

describe('sales order warehouse selection', () => {
  it('defaults to the branch default warehouse, shows its availability, refreshes on switch, and submits it', async () => {
    renderPage();

    // 1. The selector defaults to the branch's default selling warehouse.
    await waitFor(
      () => {
        expect(screen.getByDisplayValue('مخزن البيع الأساسي')).toBeTruthy();
      },
      { timeout: 10000 },
    );

    // 2. Pick the product: the line shows the SELECTED warehouse's
    // availability (5), never the global stock (15).
    const lineInput = screen.getByPlaceholderText('ابحث عن صنف بالاسم أو الباركود...');
    fireEvent.click(lineInput);
    const option = await screen.findByText('اختبار صنف استيراد 001', {}, { timeout: 10000 });
    fireEvent.click(option);
    await waitFor(
      () => {
        expect(badgeWith('5 متاح')).toBeTruthy();
      },
      { timeout: 10000 },
    );

    // 3. Switch the warehouse: the SAME line refreshes to 10.
    fireEvent.click(screen.getByDisplayValue('مخزن البيع الأساسي'));
    const transferOption = await screen.findByText('مخزن اختبار تحويل', {}, { timeout: 10000 });
    fireEvent.click(transferOption);
    await waitFor(
      () => {
        expect(screen.getByDisplayValue('مخزن اختبار تحويل')).toBeTruthy();
      },
      { timeout: 10000 },
    );
    await waitFor(
      () => {
        expect(badgeWith('10 متاح')).toBeTruthy();
      },
      { timeout: 10000 },
    );

    // 4. Submit: the order carries the selected warehouse.
    const customerInput = screen.getByPlaceholderText('ابحث عن عميل بالاسم أو الهاتف...');
    fireEvent.change(customerInput, { target: { value: 'عميل اختبار 00001' } });
    fireEvent.click(screen.getByText('اعتماد أمر البيع'));
    await waitFor(
      () => {
        expect(mocks.createSalesOrder).toHaveBeenCalled();
      },
      { timeout: 10000 },
    );
    const payload = mocks.createSalesOrder.mock.calls[0][0];
    expect(payload.warehouseLocationId).toBe(20);
    expect(payload.items[0].productId).toBe(1);
    expect(payload.items[0].quantity).toBe(1);
  }, 60000);
});
