/*
 * I5-P12+D13: cost-component payee pickers are searchable with the
 * shipment supplier first (INV-IMPORT-COMPLIANCE-HS-ACI-DATES).
 *
 * WHAT WAS WRONG (live trial phase 1, problem 12): the four
 * cost-payee selects on the shipment details page were native
 * <select>s rendering ALL 503 suppliers in each — unusable. The
 * intended scoping is searchable + shipment supplier first, NOT
 * verified-only: the shipment's own supplier usually has no verified
 * bank details, and the trial itself assigned that unverified
 * supplier as payee for all four components — a verified-only scope
 * would block the normal flow. (The "يحتاج توثيق" badge on the China
 * sourcing rows is NOT a defect: it derives from verified bank
 * details, and the 503 synthetic test suppliers genuinely have none.)
 *
 * WHAT THIS PINS (the real ShipmentDetailsPage, queries mocked):
 * - All four payee fields are searchable pickers (placeholder
 *   "ابحث عن مورد..."), not native selects. Fails on base (native
 *   <select>s, no such placeholder).
 * - The shipment's supplier ("مورد اختبار 0001", id 7) is the first
 *   supplier option in the opened list even though the fetched list
 *   orders it second. Fails on base (fetched order, supplier buried).
 * - Typing a name narrows the list to the match (searchable). Fails
 *   on base (a native select cannot be narrowed by typing).
 * - Picking a different supplier for one component sends that
 *   supplier id in the costs payload while the other three keep the
 *   shipment-supplier default (I1-P3 hydration).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ShipmentDetailsPage from '@/features/import-sales/ShipmentDetailsPage';

// jsdom has no Element.scrollIntoView; the shared CustomSelect calls it
// when its dropdown opens with a highlighted option. Stub it so the
// pickers can open in this harness (a test-environment gap, not a
// product defect — real browsers implement it).
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const queryResult = (overrides: Record<string, unknown> = {}) => ({
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
  ...overrides,
});

const mutationResult = (overrides: Record<string, unknown> = {}) => ({
  mutateAsync: vi.fn().mockResolvedValue({}),
  mutate: vi.fn(),
  isPending: false,
  ...overrides,
});

const {
  useShipmentDetailsQueryMock,
  useUpdateShipmentCostsMutationMock,
  useUpdateShipmentItemMutationMock,
  useImportProjectItemsMutationMock,
  useApplyPricesMutationMock,
  useCreateReceivingInspectionMutationMock,
  useRecordLateShipmentExpenseMutationMock,
  useReversePostedReceiptMutationMock,
  useResolveLegacyReceiptMutationMock,
  suppliersListAllMock,
  httpMock,
  locationsMock,
  toastMock,
} = vi.hoisted(() => ({
  useShipmentDetailsQueryMock: vi.fn(),
  useUpdateShipmentCostsMutationMock: vi.fn(),
  useUpdateShipmentItemMutationMock: vi.fn(),
  useImportProjectItemsMutationMock: vi.fn(),
  useApplyPricesMutationMock: vi.fn(),
  useCreateReceivingInspectionMutationMock: vi.fn(),
  useRecordLateShipmentExpenseMutationMock: vi.fn(),
  useReversePostedReceiptMutationMock: vi.fn(),
  useResolveLegacyReceiptMutationMock: vi.fn(),
  suppliersListAllMock: vi.fn(),
  httpMock: vi.fn(),
  locationsMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/features/import-sales/api/shipments.api', () => ({
  useShipmentDetailsQuery: useShipmentDetailsQueryMock,
  useUpdateShipmentCostsMutation: useUpdateShipmentCostsMutationMock,
  useUpdateShipmentItemMutation: useUpdateShipmentItemMutationMock,
  useImportProjectItemsMutation: useImportProjectItemsMutationMock,
  useApplyPricesMutation: useApplyPricesMutationMock,
  useCreateReceivingInspectionMutation: useCreateReceivingInspectionMutationMock,
  useRecordLateShipmentExpenseMutation: useRecordLateShipmentExpenseMutationMock,
  useReversePostedReceiptMutation: useReversePostedReceiptMutationMock,
  useResolveLegacyReceiptMutation: useResolveLegacyReceiptMutationMock,
  receivingInspectionErrorMessage: (err: any) => err?.message || 'error',
  lateExpenseAllocationSummary: () => ({}),
}));

vi.mock('@/shared/api/suppliers.api', () => ({
  suppliersApi: { listAll: suppliersListAllMock },
}));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

vi.mock('@/services/reference-data.api', () => ({
  referenceDataApi: { locations: locationsMock },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: toastMock,
  systemConfirm: vi.fn().mockResolvedValue(true),
}));

// The trial shipment: supplier 7 ("مورد اختبار 0001") is the shipment
// supplier; the fetched supplier list orders it second.
const TRIAL_SHIPMENT: any = {
  id: '1',
  container_number: 'MSCU-TEST-001',
  status: 'Pending',
  supplier_id: 7,
  supplier_name: 'مورد اختبار 0001',
  bill_of_lading: 'اختبار-BL-001',
  shipping_cost_usd: 5,
  customs_cost_egp: 100,
  internal_transport_cost_egp: 50,
  exchange_rate_at_arrival: 50,
  freight_supplier_id: null,
  customs_supplier_id: null,
  transport_supplier_id: null,
  demurrage_supplier_id: null,
  actual_demurrage_fees: 0,
  items: [],
  inventory_receipt: null,
  demurrageRisk: { isOverdue: false, daysRemaining: 5, overdueDays: 0 },
};

const TRIAL_SUPPLIERS = [
  { id: 3, name: 'مورد آخر' },
  { id: 7, name: 'مورد اختبار 0001' },
  { id: 9, name: 'مورد ثالث' },
];

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter initialEntries={['/import-sales/shipments/1']}>
        <QueryClientProvider client={queryClient}>
          <Routes>
            <Route path="/import-sales/shipments/:id" element={children} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    );
  }
  return render(<ShipmentDetailsPage />, { wrapper: Wrapper });
}

describe('I5-P12+D13 shipment payee pickers are searchable, shipment supplier first', () => {
  beforeEach(() => {
    useShipmentDetailsQueryMock.mockReturnValue(queryResult({ data: TRIAL_SHIPMENT }));
    suppliersListAllMock.mockResolvedValue({ suppliers: TRIAL_SUPPLIERS });
    httpMock.mockResolvedValue({ accounts: [] });
    locationsMock.mockResolvedValue([]);
    useUpdateShipmentCostsMutationMock.mockReturnValue(mutationResult());
    useUpdateShipmentItemMutationMock.mockReturnValue(mutationResult());
    useImportProjectItemsMutationMock.mockReturnValue(mutationResult());
    useApplyPricesMutationMock.mockReturnValue(mutationResult());
    useCreateReceivingInspectionMutationMock.mockReturnValue(mutationResult());
    useRecordLateShipmentExpenseMutationMock.mockReturnValue(mutationResult());
    useReversePostedReceiptMutationMock.mockReturnValue(mutationResult());
    useResolveLegacyReceiptMutationMock.mockReturnValue(mutationResult());
  });

  it('all four payee fields are searchable pickers, not 503-row native selects', () => {
    renderPage();
    expect(screen.getAllByPlaceholderText('ابحث عن مورد...')).toHaveLength(4);
    expect(document.querySelectorAll('.custom-combobox-option')).toHaveLength(0);
  });

  it('the shipment supplier is the first supplier option in the opened list', async () => {
    const { container } = renderPage();
    // Wait for the suppliers list to load: all four pickers then show
    // the hydrated shipment-supplier default.
    const loaded = await screen.findAllByDisplayValue('مورد اختبار 0001');
    expect(loaded).toHaveLength(4);
    const pickers = screen.getAllByPlaceholderText('ابحث عن مورد...');
    fireEvent.click(pickers[0]);
    const options = Array.from(container.querySelectorAll('.custom-combobox-option')).map((el) => el.textContent || '');
    expect(options.length).toBeGreaterThan(0);
    // First is the "no change" option; first SUPPLIER after it is the
    // shipment supplier, although the fetched list orders it second.
    expect(options[0]).toContain('بلا تغيير');
    expect(options[1]).toBe('مورد اختبار 0001');
    expect(options).toContain('مورد آخر');
    expect(options).toContain('مورد ثالث');
  });

  it('typing narrows the list to the match', async () => {
    const { container } = renderPage();
    await screen.findAllByDisplayValue('مورد اختبار 0001');
    const pickers = screen.getAllByPlaceholderText('ابحث عن مورد...');
    fireEvent.change(pickers[1], { target: { value: 'ثالث' } });
    const options = Array.from(container.querySelectorAll('.custom-combobox-option')).map((el) => el.textContent || '');
    expect(options).toEqual(['مورد ثالث']);
  });

  it('picking a supplier for freight sends its id while the other payees keep the shipment-supplier default', async () => {
    const updateCosts = vi.fn().mockResolvedValue({});
    useUpdateShipmentCostsMutationMock.mockReturnValue(mutationResult({ mutateAsync: updateCosts }));
    const { container } = renderPage();
    await screen.findAllByDisplayValue('مورد اختبار 0001');
    const pickers = screen.getAllByPlaceholderText('ابحث عن مورد...');
    fireEvent.click(pickers[0]);
    const freightOptions = Array.from(container.querySelectorAll('.custom-combobox-option'));
    const third = freightOptions.find((el) => (el.textContent || '') === 'مورد ثالث');
    expect(third).toBeDefined();
    fireEvent.click(third!);

    fireEvent.click(screen.getByText('تحديث البيانات والتكاليف وإعادة الحساب'));
    expect(updateCosts).toHaveBeenCalledTimes(1);
    const payload = updateCosts.mock.calls[0][0];
    expect(payload.freightSupplierId).toBe(9);
    // The other three keep the I1-P3 hydration default: the shipment
    // supplier (7) when no payee was stored yet.
    expect(payload.customsSupplierId).toBe(7);
    expect(payload.transportSupplierId).toBe(7);
    expect(payload.demurrageSupplierId).toBe(7);
  });
});
