/*
 * I4-D14: supplier-credit screen shows the posted receipt (INV-IMPORT-SUPPLIER-CREDIT-READ).
 *
 * WHAT WAS WRONG (live trial phase 2, problem 14): /import-sales/supplier-credit
 * showed "إجمالي مديونية المصانع (الدفتري) 0.00" and "المصانع والشركات المسجلة 0 مصنع"
 * with an empty factory combobox, although receipt JE-00015025 had posted +900 EGP
 * to the supplier book (the regular suppliers ledger showed 900.00).
 *
 * WHAT THE GROUNDING PROVED (backend probe, real posting through
 * postShipmentToInventory on PGlite): the backend read was NOT the broken link —
 * after a posted 900 EGP receipt, suppliers.balance is 900, the supplier_ledger
 * total is 900, and listChinaSuppliers returns that supplier with balance 900.
 * The broken link is the SCREEN: SupplierCredit renders its KPI cards and the
 * factory combobox from the two supplier queries with NO loading gate, so while
 * either query is still pending factories is [] and the screen shows the false
 * 0.00 total, the false 0-factory count and an empty combobox. This is the same
 * false-empty family I2-P7 fixed on ImportProjectsManager / ChinaSourcingPage /
 * ImportCommandCenter — P7's region explicitly did not cover SupplierCredit.
 *
 * WHAT THIS PINS (the real SupplierCredit screen, queries mocked per case):
 * - Loading: a loading state renders and the debt KPI / factory count show "—",
 *   never a false 0.00 / 0; the factory combobox offers a loading placeholder,
 *   never an empty list. THIS case fails on base (no loading state exists there).
 * - Loaded, trial shape: one supplier whose posted receipt left a 900.00 book
 *   debt renders total 900.00, 1 registered factory, and the supplier in the
 *   factory combobox (the china + general lists dedupe to one row). This case
 *   already passes on base — the loaded render was never broken; it pins the
 *   end state the loading fix must preserve.
 * - Loaded empty: a genuinely empty result still renders 0.00 / 0 مصنع with no
 *   loading state (the fix must not hide real zeros).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SupplierCredit from '@/features/import-sales/SupplierCredit';

const queryResult = (overrides: Record<string, unknown> = {}) => ({
  data: [],
  isLoading: false,
  isFetching: false,
  isError: false,
  refetch: vi.fn(),
  ...overrides,
});

const mutationResult = () => ({
  mutateAsync: vi.fn().mockResolvedValue({}),
  mutate: vi.fn(),
  isPending: false,
});

const {
  useChinaSuppliersQueryMock,
  useForeignTransfersQueryMock,
  useProformaInvoicesQueryMock,
  useRecordForeignTransferMutationMock,
  useSuppliersQueryMock,
  useTreasuryMock,
} = vi.hoisted(() => ({
  useChinaSuppliersQueryMock: vi.fn(),
  useForeignTransfersQueryMock: vi.fn(),
  useProformaInvoicesQueryMock: vi.fn(),
  useRecordForeignTransferMutationMock: vi.fn(),
  useSuppliersQueryMock: vi.fn(),
  useTreasuryMock: vi.fn(),
}));

vi.mock('@/features/import-sales/api/shipments.api', () => ({
  useRecordForeignTransferMutation: useRecordForeignTransferMutationMock,
  useForeignTransfersQuery: useForeignTransfersQueryMock,
  useProformaInvoicesQuery: useProformaInvoicesQueryMock,
  useChinaSuppliersQuery: useChinaSuppliersQueryMock,
  buildForeignTransferPayload: vi.fn().mockReturnValue({}),
  paymentMethodEvidenceFields: (method: string) => (method === 'bank_transfer' ? ['paymentReference'] : []),
  IMPORT_PAYMENT_METHODS: ['bank_transfer', 'cash_carried', 'letter_of_credit', 'cash_against_documents', 'open_account'],
  IMPORT_PAYMENT_METHOD_LABELS: {
    bank_transfer: 'تحويل بنكي',
    cash_carried: 'نقد محمول مع مسافر',
    letter_of_credit: 'اعتماد مستندي (LC)',
    cash_against_documents: 'دفع مقابل مستندات (CAD)',
    open_account: 'حساب مفتوح / آجل',
  },
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSuppliersQuery: useSuppliersQueryMock,
}));

vi.mock('@/shared/hooks/use-treasury', () => ({
  useTreasury: useTreasuryMock,
}));

vi.mock('@/lib/http', () => ({
  http: vi.fn().mockResolvedValue({ accounts: [] }),
}));

// The trial supplier: receipt JE-00015025 posted +900 EGP to its book
// (goods 500 + freight 250 + customs 100 + transport 50), so the
// china-suppliers read carries balance 900 for it.
const TRIAL_SUPPLIER = {
  id: 1,
  name: 'مورد اختبار 0001',
  phone: '',
  balance: 900,
  chinese_name: '',
  city: 'Guangzhou',
  province: 'Guangdong',
  moq_description: '',
  production_lead_time_days: 30,
  verified_bank_details: {},
  incoterms_accepted: ['FOB'],
  qc_rating: 5,
  quality_certifications: [],
  audit_status: 'unverified',
  import_notes: '',
};

function renderScreen(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  function Wrapper({ children }: PropsWithChildren) {
    return (
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </MemoryRouter>
    );
  }
  return render(ui, { wrapper: Wrapper });
}

function setQueryDefaults() {
  useChinaSuppliersQueryMock.mockReturnValue(queryResult());
  useSuppliersQueryMock.mockReturnValue(queryResult());
  useForeignTransfersQueryMock.mockReturnValue(queryResult());
  useProformaInvoicesQueryMock.mockReturnValue(queryResult());
  useTreasuryMock.mockReturnValue(queryResult({ data: { summary: { net: 5000 } } }));
  useRecordForeignTransferMutationMock.mockReturnValue(mutationResult());
}

function kpiCardText(label: string): string {
  // The KPI cards render label + value in one card div; scope the value
  // assertion to that card because other parts of the page (e.g. the
  // exchange-rate box) legitimately show 0.00 too.
  const labelEl = screen.getByText(label);
  return labelEl.parentElement?.parentElement?.textContent || '';
}

describe('I4-D14 supplier-credit screen reflects the posted receipt', () => {
  beforeEach(() => {
    setQueryDefaults();
  });

  it('loading: shows a loading state and dashes, never a false 0.00 total or 0 factories', () => {
    useChinaSuppliersQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
    useSuppliersQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
    renderScreen(<SupplierCredit />);

    expect(screen.getByText('جاري تحميل مديونية المصانع...')).toBeInTheDocument();
    // The debt KPI and the factory count are dashes while their queries load.
    expect(kpiCardText('إجمالي مديونية المصانع (الدفتري)')).toContain('—');
    expect(kpiCardText('إجمالي مديونية المصانع (الدفتري)')).not.toContain('0.00');
    expect(kpiCardText('المصانع والشركات المسجلة')).toContain('—');
    // The factory combobox offers a loading placeholder, never an empty list.
    expect(screen.getByText('جاري تحميل المصانع...')).toBeInTheDocument();
    expect(screen.queryByText('900.00')).toBeNull();
  });

  it('loaded, trial shape: one supplier with a 900.00 posted book debt lists 900.00 and 1 factory', () => {
    useChinaSuppliersQueryMock.mockReturnValue(queryResult({ data: [TRIAL_SUPPLIER], isLoading: false }));
    useSuppliersQueryMock.mockReturnValue(
      queryResult({ data: [{ id: '1', name: 'مورد اختبار 0001', balance: 900 }], isLoading: false }),
    );
    renderScreen(<SupplierCredit />);

    expect(screen.queryByText('جاري تحميل مديونية المصانع...')).toBeNull();
    // The posted +900 receipt is visible as the book total.
    expect(kpiCardText('إجمالي مديونية المصانع (الدفتري)')).toContain('900.00');
    // The china + general lists dedupe to exactly one registered factory.
    expect(kpiCardText('المصانع والشركات المسجلة')).toContain('1 مصنع');
    expect(screen.getAllByText(/مورد اختبار 0001/).length).toBe(1);
    expect(screen.getByText('مصنع')).toBeInTheDocument();
  });

  it('loaded empty: a genuinely empty result still renders 0.00 / 0 factories with no loading state', () => {
    useChinaSuppliersQueryMock.mockReturnValue(queryResult({ data: [], isLoading: false }));
    useSuppliersQueryMock.mockReturnValue(queryResult({ data: [], isLoading: false }));
    renderScreen(<SupplierCredit />);

    expect(screen.queryByText('جاري تحميل مديونية المصانع...')).toBeNull();
    expect(kpiCardText('إجمالي مديونية المصانع (الدفتري)')).toContain('0.00');
    expect(kpiCardText('المصانع والشركات المسجلة')).toContain('0 مصنع');
  });
});
