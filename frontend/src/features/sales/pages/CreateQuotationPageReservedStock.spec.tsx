/*
 * I10-B: quotation reserved-stock display.
 *
 * WHAT WAS WRONG (live re-test 2026-11-09, R12 follow-up; I9-B left
 * this page open): the quotation form's product picker showed the raw
 * catalog stock (`رصيد: ${p.stock}` = products.stock_qty, on-hand
 * before reservations, in no warehouse in particular) — the exact
 * defect I9-B fixed on the sales-order page
 * (INV-SALES-ORDER-RESERVED-STOCK-DISPLAY). A product whose 10 units
 * SO-261108-0008 had already reserved still showed "رصيد: 10" in the
 * quotation picker, and picking it stored stockOnHand 10 on the line.
 *
 * THE FIX (frontend only; same pattern as I9-B): the picker
 * suggestion shows ONLY the reservation-aware availability — read
 * from GET /api/sales-orders/availability with no location (the
 * backend returns availableAtLocation = globalAvailable =
 * stock_qty - reserved_qty when no warehouse is chosen, exactly the
 * arithmetic the approval check enforces in that case) — fetched for
 * the visible options when the dropdown opens and debounced while
 * typing, never the catalog stock. Picking a product stores the known
 * availability (0 until the read returns) and re-reads it live; a
 * restored draft line starts at 0 (fail-closed) until the live read
 * returns.
 *
 * WHAT THIS PINS (fixture: catalog stock 10, all 10 reserved —
 * availability 0):
 * 1. Opening the product picker shows "رصيد: 0" in the suggestion —
 *    never "رصيد: 10".
 * 2. Picking the product stores stockOnHand 0 on the line (read back
 *    from the auto-saved draft) — never the catalog stock 10.
 * 3. A draft restored with a stale stockOnHand 10 is re-saved with
 *    stockOnHand 0 — never the stale 10.
 *
 * The catalog/availability layers are mocked at the module boundary;
 * the page and the availability wiring are all real.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CreateQuotationPage } from '@/features/sales/pages/CreateQuotationPage';

// jsdom does not implement scrollIntoView; CustomSelect calls it when
// its dropdown opens. Stub it so the picker can be driven here.
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const mocks = vi.hoisted(() => ({
  createQuotation: vi.fn(),
  // SO-261108-0008 reserves all 10 units: nothing is reservable.
  availability: vi.fn(async (productId: number, locationId: number | null) => ({
    productId,
    locationId,
    branchId: 1,
    locationQty: 10,
    locationReservedQty: 10,
    unassignedQty: 0,
    unassignedReservedQty: 0,
    availableAtLocation: 0,
    globalAvailable: 0,
  })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
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
}));

vi.mock('../hooks/useCreateQuotationForm', () => ({
  useCreateQuotationForm: () => ({
    customers: [],
    createQuotation: mocks.createQuotation,
    isSubmitting: false,
  }),
}));

vi.mock('../api/sales-orders.api', () => ({
  salesOrdersApi: { availability: mocks.availability },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
  },
  systemConfirm: vi.fn().mockResolvedValue(true),
  systemAlert: vi.fn(),
  useToast: () => ({ toast: vi.fn() }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.localStorage.clear();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CreateQuotationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function renderPageWithDraft(draft: Record<string, unknown>) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  window.localStorage.clear();
  window.localStorage.setItem('draft_create_quotation_form', JSON.stringify(draft));
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CreateQuotationPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
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
  const lineInput = screen.getByPlaceholderText('ابحث عن صنف بالاسم أو الباركود...');
  fireEvent.click(lineInput);
  await screen.findByText('اختبار صنف استيراد 001', {}, { timeout: 10000 });
}

function savedDraftItems(): Array<Record<string, unknown>> {
  const raw = window.localStorage.getItem('draft_create_quotation_form');
  if (!raw) return [];
  const parsed = JSON.parse(raw) as { items?: Array<Record<string, unknown>> };
  return parsed.items ?? [];
}

describe('quotation reserved stock display', () => {
  it('picker suggestion shows the reserved-aware 0, never the catalog stock 10', async () => {
    renderPage();
    await openProductPicker();

    // The suggestion meta must show the reservation-aware availability
    // (0 — all 10 reserved), never the catalog on-hand 10.
    await waitFor(
      () => {
        expect(metaSpansWith('رصيد: 0').length).toBeGreaterThan(0);
      },
      { timeout: 10000 },
    );
    expect(metaSpansWith('رصيد: 10')).toHaveLength(0);
    // The read is the global (warehouse-less) availability: no
    // location is sent for a quotation, which has no warehouse.
    expect(mocks.availability).toHaveBeenCalledWith(1, null);
  }, 60000);

  it('picking the fully reserved product stores stockOnHand 0 on the line, never 10', async () => {
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

    // stockOnHand is stored on the line (not rendered on this page),
    // so it is read back from the auto-saved draft: 0, never the
    // catalog stock 10.
    await waitFor(
      () => {
        const items = savedDraftItems();
        expect(items.length).toBeGreaterThan(0);
        expect(items[0].stockOnHand).toBe(0);
      },
      { timeout: 10000 },
    );
  }, 60000);

  it('a draft restored with a stale stockOnHand 10 is re-saved with 0', async () => {
    renderPageWithDraft({
      selectedCustomerId: null,
      customerName: 'عميل اختبار 00001',
      customerPhone: '',
      customerAddress: '',
      quotationDate: '2026-11-08',
      validUntil: '2026-11-23',
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
          product_name: 'اختبار صنف استيراد 001',
          unitName: 'قطعة',
          quantity: 10,
          unitPrice: 120,
          unit_price: 120,
          discount: 0,
          tax_rate: 0,
          tax_amount: 0,
          total: 1200,
          // Saved when the 10 units were still free; SO-261108-0008
          // has since reserved all of them.
          stockOnHand: 10,
          barcode: 'TEST-001',
        },
      ],
    });

    // The restore runs in a mount effect; the stale 10 must be
    // sanitised to the fail-closed 0 and re-saved, never kept.
    await waitFor(
      () => {
        const items = savedDraftItems();
        expect(items.length).toBeGreaterThan(0);
        expect(items[0].stockOnHand).toBe(0);
      },
      { timeout: 10000 },
    );
  }, 60000);
});
