/*
New file: frontend/src/features/sales/pages/CreateSalesOrderPageReservedStock.spec.tsx
Pins INV-SALES-ORDER-RESERVED-STOCK-DISPLAY (Import Batch I9, R7) on
the order form, driving the REAL CreateSalesOrderPage.

THE DEFECT (live re-test on deployed 4d811676, §5b): a new order for
اختبار صنف استيراد 001 ×10 @ 120 in رصيد الفرع الرئيسي was correctly
REFUSED at approval ("الرصيد المتاح … في هذا المخزن هو 0 فقط" —
SO-261108-0008 already reserves all 10 units), but the form displayed
"10 متاح" before approval and "0 متاح" after. The line badge already
reads the reserved-aware availability endpoint (I3-D2); the remaining
reservation-blind displays were:

1. The product-picker suggestion meta fell back to the catalog stock
   (`p.stock` = products.stock_qty, on-hand before reservations, in
   no warehouse in particular) whenever the reserved-aware read had
   not run for that product — which is every product in the dropdown,
   since availability was only fetched for line products. The picker
   showed "رصيد: 10" for a product whose 10 units were all reserved.
2. A draft-restored line kept its SAVED stockOnHand (10, from before
   the reservation) until the availability read returned, so a form
   reopened as a copy of SO-261108-0008 showed "10 متاح" at open.

THE FIX: the picker suggestion shows ONLY the reserved-aware
availability in the selected warehouse (fetched for the visible
options when the dropdown opens / while typing, never the catalog
stock); a restored draft line starts at 0 until the live read
returns, exactly like a fresh line.

WHAT THIS PINS (fixture: catalog stock 10, all 10 reserved in the
selected warehouse — availability 0, global available 0):
1. Opening the product picker shows "رصيد: 0" in the suggestion —
   never "رصيد: 10".
2. Picking the product shows "0 متاح" on the line.
3. A draft restored with stockOnHand 10 shows "0 متاح" from the
   first paint, before the availability read resolves — never
   "10 متاح".

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
    // SO-261108-0008 reserves all 10 units in this warehouse.
    locationQty: 10,
    locationReservedQty: 10,
    unassignedQty: 0,
    unassignedReservedQty: 0,
    availableAtLocation: 0,
    globalAvailable: 0,
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
        stock: 10,
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

function renderPageWithDraft(draft: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.localStorage.clear();
  window.localStorage.setItem('z_draft_sales_order_fullpage', JSON.stringify(draft));
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

function metaSpansWith(text: string) {
  // The picker suggestion meta lives in a <span> inside the option
  // <button>; the button itself shares the same textContent, so pick
  // spans explicitly. queryAll (not getAll): zero matches is a valid
  // answer here, not an error.
  return screen
    .queryAllByText((_content, element) => element?.textContent?.includes(text) ?? false)
    .filter((el) => el.tagName === 'SPAN');
}

async function openProductPicker() {
  await waitFor(
    () => {
      expect(screen.getByDisplayValue('مخزن البيع الأساسي')).toBeTruthy();
    },
    { timeout: 10000 },
  );
  const lineInput = screen.getByPlaceholderText('ابحث عن صنف بالاسم أو الباركود...');
  fireEvent.click(lineInput);
  await screen.findByText('اختبار صنف استيراد 001', {}, { timeout: 10000 });
}

describe('sales order reserved stock display', () => {
  it('picker suggestion shows the reserved-aware 0, never the catalog stock 10', async () => {
    renderPage();
    await openProductPicker();

    // The suggestion meta must show the availability in the selected
    // warehouse (0 — all 10 reserved), never the catalog on-hand 10.
    await waitFor(
      () => {
        expect(metaSpansWith('رصيد: 0').length).toBeGreaterThan(0);
      },
      { timeout: 10000 },
    );
    expect(metaSpansWith('رصيد: 10')).toHaveLength(0);
  }, 60000);

  it('picking the fully reserved product shows 0 available on the line', async () => {
    renderPage();
    await openProductPicker();

    await waitFor(
      () => {
        expect(metaSpansWith('رصيد: 0').length).toBeGreaterThan(0);
      },
      { timeout: 10000 },
    );
    const option = await screen.findByText('اختبار صنف استيراد 001', {}, { timeout: 10000 });
    fireEvent.click(option);
    await waitFor(
      () => {
        expect(badgeWith('0 متاح')).toBeTruthy();
      },
      { timeout: 10000 },
    );
    expect(screen.queryAllByText((_content, element) => element?.textContent === '10 متاح')).toHaveLength(0);
  }, 60000);

  it('a draft restored with a stale stockOnHand 10 shows 0 from the first paint', async () => {
    renderPageWithDraft({
      selectedCustomerId: null,
      customerName: '',
      customerPhone: '',
      customerAddress: '',
      paymentType: 'credit',
      orderDate: '2026-11-09',
      deliveryDate: '2026-11-12',
      reservationExpiresAt: '2026-11-16',
      autoReserve: true,
      currency: 'EGP',
      taxRate: 0,
      discountMode: 'value',
      discountValue: 0,
      notes: '',
      termsConditions: '',
      items: [
        {
          id: 1,
          productId: 1,
          productName: 'اختبار صنف استيراد 001',
          unitName: 'قطعة',
          quantity: 10,
          unitPrice: 120,
          discount: 0,
          total: 1200,
          // Saved when the 10 units were still free; SO-261108-0008
          // has since reserved all of them.
          stockOnHand: 10,
          barcode: 'TEST-001',
          warehouse: 'المستودع الرئيسي',
        },
      ],
      warehouseLocationId: 10,
    });

    // The restore runs in a mount effect; the availability read is
    // still in flight here (its promise has not resolved), so the
    // badge must already show the fail-closed 0 — never the stale
    // persisted 10. This assertion is synchronous on purpose: no
    // microtask may run between render and the check.
    expect(screen.getByDisplayValue('اختبار صنف استيراد 001')).toBeTruthy();
    expect(badgeWith('0 متاح')).toBeTruthy();
    expect(screen.queryAllByText((_content, element) => element?.textContent === '10 متاح')).toHaveLength(0);

    // Once the read lands, the badge stays 0.
    await waitFor(
      () => {
        expect(badgeWith('0 متاح')).toBeTruthy();
      },
      { timeout: 10000 },
    );
  }, 60000);
});
