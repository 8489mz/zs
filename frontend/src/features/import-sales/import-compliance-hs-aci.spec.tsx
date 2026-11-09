/*
 * I5-P12+D13: compliance page wires HS data, the ACI dialog links its
 * container, and date defaults use the tenant-local day
 * (INV-IMPORT-COMPLIANCE-HS-ACI-DATES).
 *
 * WHAT WAS WRONG (live trial phase 1 problem 12 + phase 2 problem 13):
 * - HS table empty (0 rows) on first visit, after "تحديث البنود", and
 *   after selecting sector "قطع غيار سيارات النقل والتريلات (5%)".
 *   Grounding: the backend reads exactly what the tenant stored — a
 *   tenant with no rows lists empty by design (read-time seeding was
 *   removed so a refresh can never overwrite tenant-edited rates) —
 *   and the bundled official snapshot only enters through the explicit
 *   POST customs-tariffs/sync-official. The frontend mutation for it
 *   existed but was never called anywhere: "تحديث البنود" only
 *   re-read the same empty table.
 * - The ACI dialog had no container/shipment linkage field, although
 *   the backend stores shipment_id + project_id and reads the record
 *   back by them.
 * - Date defaults used the UTC slice: a PI created at 00:03 EET on
 *   2026-11-09 defaulted its date field to 11/08/2026 while its
 *   server-issued number — keyed by the tenant-local business day —
 *   read 261109. The ACI issue date had the same default.
 *
 * WHAT THIS PINS (the real screens, queries mocked per case):
 * - HS empty: the empty state names the missing data and offers the
 *   official-tariff load; "تحديث البنود" calls the sync (not a bare
 *   refetch). BOTH fail on base (no sync call, no empty-state load).
 * - HS loaded: rows render, the sector pill filters client-side to
 *   that sector's rows (pins the end state the sync must reach).
 * - ACI dialog: a container/shipment select lists the trial container
 *   MSCU-TEST-001; choosing it and saving sends shipmentId AND the
 *   container's projectId. Fails on base (no such field; the save
 *   carries no linkage).
 * - Dates: at 00:03 EET on 2026-11-09 the ACI issue date and the PI
 *   date default to 2026-11-09, never the UTC 2026-11-08. Fails on
 *   base (toISOString slice). The clock is frozen in the first two
 *   hours after midnight in Africa/Cairo, the window where UTC and
 *   tenant-local days differ.
 */
process.env.TZ = 'Africa/Cairo';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CustomsTariffCalculator from '@/features/import-sales/CustomsTariffCalculator';
import { ChinaProformasTab } from '@/features/import-sales/components/ChinaProformasTab';
import { todayLocalDateKey } from '@/lib/format';

const queryResult = (overrides: Record<string, unknown> = {}) => ({
  data: [],
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
  useCustomsTariffsQueryMock,
  useCustomsTariffSectorsQueryMock,
  useCalculateCustomsMutationMock,
  useUpsertAciComplianceMutationMock,
  useSyncOfficialTariffsMutationMock,
  useShipmentsQueryMock,
  useProformaInvoicesQueryMock,
  useApproveProformaInvoiceMutationMock,
  useGenerateInternationalPoMutationMock,
  useCreateProformaInvoiceMutationMock,
  useChinaSuppliersQueryMock,
  useProductsQueryMock,
  toastMock,
} = vi.hoisted(() => ({
  useCustomsTariffsQueryMock: vi.fn(),
  useCustomsTariffSectorsQueryMock: vi.fn(),
  useCalculateCustomsMutationMock: vi.fn(),
  useUpsertAciComplianceMutationMock: vi.fn(),
  useSyncOfficialTariffsMutationMock: vi.fn(),
  useShipmentsQueryMock: vi.fn(),
  useProformaInvoicesQueryMock: vi.fn(),
  useApproveProformaInvoiceMutationMock: vi.fn(),
  useGenerateInternationalPoMutationMock: vi.fn(),
  useCreateProformaInvoiceMutationMock: vi.fn(),
  useChinaSuppliersQueryMock: vi.fn(),
  useProductsQueryMock: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('@/features/import-sales/api/shipments.api', () => ({
  useCustomsTariffsQuery: useCustomsTariffsQueryMock,
  useCustomsTariffSectorsQuery: useCustomsTariffSectorsQueryMock,
  useCalculateCustomsMutation: useCalculateCustomsMutationMock,
  useUpsertAciComplianceMutation: useUpsertAciComplianceMutationMock,
  useSyncOfficialTariffsMutation: useSyncOfficialTariffsMutationMock,
  useShipmentsQuery: useShipmentsQueryMock,
  useProformaInvoicesQuery: useProformaInvoicesQueryMock,
  useApproveProformaInvoiceMutation: useApproveProformaInvoiceMutationMock,
  useGenerateInternationalPoMutation: useGenerateInternationalPoMutationMock,
  useCreateProformaInvoiceMutation: useCreateProformaInvoiceMutationMock,
  useChinaSuppliersQuery: useChinaSuppliersQueryMock,
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useProductsQuery: useProductsQueryMock,
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: toastMock,
  systemConfirm: vi.fn().mockResolvedValue(true),
}));

const TRIAL_SHIPMENTS = {
  rows: [
    {
      id: '11111111-1111-4111-8111-111111111111',
      container_number: 'MSCU-TEST-001',
      status: 'Pending',
      project_id: '22222222-2222-4222-8222-222222222222',
      bill_of_lading: 'اختبار-BL-001',
    },
  ],
  stats: {},
};

const TRIAL_TARIFFS = [
  {
    id: 'tar-1',
    hs_code: '8708.30',
    description_ar: 'مكابح وأجزاؤها',
    description_en: 'Brakes and parts',
    duty_rate_percent: 5,
    vat_rate_percent: 14,
    inspection_fees_percent: 1,
    regulatory_body: 'GOEIC',
    sector: 'commercial_vehicles_spare_parts',
    category_ar: 'قطع غيار',
  },
  {
    id: 'tar-2',
    hs_code: '8471.30',
    description_ar: 'حواسيب محمولة',
    description_en: 'Portable computers',
    duty_rate_percent: 0,
    vat_rate_percent: 14,
    inspection_fees_percent: 1,
    regulatory_body: 'NTRA',
    sector: 'electronics_it',
    category_ar: 'إلكترونيات',
  },
];

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

function setComplianceDefaults() {
  useCustomsTariffsQueryMock.mockReturnValue(queryResult({ data: [] }));
  useCustomsTariffSectorsQueryMock.mockReturnValue(queryResult({ data: [] }));
  useCalculateCustomsMutationMock.mockReturnValue(mutationResult());
  useUpsertAciComplianceMutationMock.mockReturnValue(mutationResult());
  useSyncOfficialTariffsMutationMock.mockReturnValue(
    mutationResult({ mutateAsync: vi.fn().mockResolvedValue({ success: true, inserted: 51, total: 51 }) }),
  );
  useShipmentsQueryMock.mockReturnValue(queryResult({ data: TRIAL_SHIPMENTS }));
}

function setProformaDefaults() {
  useProformaInvoicesQueryMock.mockReturnValue(queryResult({ data: [] }));
  useChinaSuppliersQueryMock.mockReturnValue(queryResult({ data: [] }));
  useProductsQueryMock.mockReturnValue(queryResult({ data: [] }));
  useApproveProformaInvoiceMutationMock.mockReturnValue(mutationResult());
  useGenerateInternationalPoMutationMock.mockReturnValue(mutationResult());
  useCreateProformaInvoiceMutationMock.mockReturnValue(mutationResult());
}

describe('I5-P12+D13 compliance: HS sync, ACI linkage, tenant-local dates', () => {
  beforeEach(() => {
    setComplianceDefaults();
    setProformaDefaults();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('HS empty: names the missing data and "تحديث البنود" loads the official tariff (sync, not a bare refetch)', async () => {
    const syncMutate = vi.fn().mockResolvedValue({ success: true, inserted: 51, total: 51 });
    useSyncOfficialTariffsMutationMock.mockReturnValue(mutationResult({ mutateAsync: syncMutate }));
    const refetch = vi.fn();
    useCustomsTariffsQueryMock.mockReturnValue(queryResult({ data: [], refetch }));
    renderScreen(<CustomsTariffCalculator />);

    expect(screen.getByText('كافة القطاعات (0)')).toBeInTheDocument();
    expect(screen.getByText('لا توجد بنود تعريفة محفوظة لهذه المنشأة بعد')).toBeInTheDocument();
    expect(screen.getByText('تحميل التعريفة الرسمية')).toBeInTheDocument();

    fireEvent.click(screen.getByText('تحديث البنود'));
    expect(syncMutate).toHaveBeenCalledTimes(1);
  });

  it('HS loaded: rows render and the truck-parts pill shows only that sector', () => {
    useCustomsTariffsQueryMock.mockReturnValue(queryResult({ data: TRIAL_TARIFFS }));
    renderScreen(<CustomsTariffCalculator />);

    expect(screen.getByText('كافة القطاعات (2)')).toBeInTheDocument();
    expect(screen.getByText('8708.30')).toBeInTheDocument();
    expect(screen.getByText('8471.30')).toBeInTheDocument();

    fireEvent.click(screen.getByText('قطع غيار سيارات النقل والتريلات (5%)'));
    expect(screen.getByText('8708.30')).toBeInTheDocument();
    expect(screen.queryByText('8471.30')).toBeNull();
  });

  it('ACI dialog: choosing MSCU-TEST-001 sends its shipmentId and projectId', async () => {
    const upsertMutate = vi.fn().mockResolvedValue({});
    useUpsertAciComplianceMutationMock.mockReturnValue(mutationResult({ mutateAsync: upsertMutate }));
    renderScreen(<CustomsTariffCalculator />);

    fireEvent.click(screen.getByText('تسجيل شحنة بنظام ACI / نافذة'));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('الحاوية / الشحنة المرتبطة')).toBeInTheDocument();
    expect(within(dialog).getByText(/MSCU-TEST-001/)).toBeInTheDocument();

    const shipmentSelect = within(dialog).getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(shipmentSelect, { target: { value: '11111111-1111-4111-8111-111111111111' } });

    const acidInput = within(dialog).getByPlaceholderText('مثال: 2609140019284719283');
    fireEvent.change(acidInput, { target: { value: '2609140019284719283' } });
    fireEvent.click(within(dialog).getByText('حفظ بيانات ACI'));

    expect(upsertMutate).toHaveBeenCalledTimes(1);
    const dto = upsertMutate.mock.calls[0][0];
    expect(dto.acidNumber).toBe('2609140019284719283');
    expect(dto.shipmentId).toBe('11111111-1111-4111-8111-111111111111');
    expect(dto.projectId).toBe('22222222-2222-4222-8222-222222222222');
  });

  it('dates at 00:03 EET on 2026-11-09: the ACI issue date defaults to 2026-11-09, never the UTC 2026-11-08', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T00:03:00+02:00'));
    expect(todayLocalDateKey()).toBe('2026-11-09');
    expect(new Date().toISOString().slice(0, 10)).toBe('2026-11-08');
    renderScreen(<CustomsTariffCalculator />);

    fireEvent.click(screen.getByText('تسجيل شحنة بنظام ACI / نافذة'));
    const dialog = screen.getByRole('dialog');
    const dateInputs = within(dialog).getAllByDisplayValue('2026-11-09');
    expect(dateInputs.length).toBeGreaterThan(0);
  });

  it('dates at 00:03 EET on 2026-11-09: the PI date defaults to 2026-11-09, never the UTC 2026-11-08', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-09T00:03:00+02:00'));
    renderScreen(<ChinaProformasTab />);

    fireEvent.click(screen.getByText('إضافة فاتورة مبدئية (New PI)'));
    const dialog = screen.getByRole('dialog');
    const dateInputs = within(dialog).getAllByDisplayValue('2026-11-09');
    expect(dateInputs.length).toBeGreaterThan(0);
    expect(within(dialog).queryByDisplayValue('2026-11-08')).toBeNull();
  });
});
