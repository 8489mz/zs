/* I2-P7: false empty states while data loads.
 *
 * Contract: while an import list/KPI query is still loading, the screen must
 * show a loading state — never a "(0)" count, never a "لا توجد …" empty state
 * and never a 0.00 KPI. The empty state renders only after loading completes
 * with an empty result; loaded data renders its rows/values.
 *
 * The api module is mocked so each query's loading/data state is controlled
 * per test; the components under test are the real screens.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PropsWithChildren } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ImportProjectsManager from '@/features/import-sales/ImportProjectsManager';
import ChinaSourcingPage from '@/features/import-sales/ChinaSourcingPage';
import ImportCommandCenter from '@/features/import-sales/ImportCommandCenter';
import { ChinaQuotationsTab } from '@/features/import-sales/components/ChinaQuotationsTab';
import { ChinaSamplesTab } from '@/features/import-sales/components/ChinaSamplesTab';
import { ChinaProformasTab } from '@/features/import-sales/components/ChinaProformasTab';

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
  useImportProjectsQueryMock,
  useCreateImportProjectMutationMock,
  useCalculateFeasibilityMutationMock,
  useConvertFeasibilityToProjectMutationMock,
  useUpdateImportProjectMutationMock,
  useCloseProjectMutationMock,
  useApprovalRequestsQueryMock,
  useCreateApprovalRequestMutationMock,
  useCustomsTariffsQueryMock,
  useCustomsTariffSectorsQueryMock,
  useSectorPresetsQueryMock,
  usePartnersQueryMock,
  useChinaSuppliersQueryMock,
  useCreateChinaSupplierMutationMock,
  useUpsertSupplierMetaMutationMock,
  useQcInspectionsQueryMock,
  useCreateQcInspectionMutationMock,
  useSourcingTripsQueryMock,
  useCreateSourcingTripMutationMock,
  useImportCommandCenterQueryMock,
  useShipmentsQueryMock,
  useQuotationsQueryMock,
  useCreateQuotationMutationMock,
  useSelectQuotationMutationMock,
  useSampleOrdersQueryMock,
  useCreateSampleOrderMutationMock,
  useUpdateSampleInspectionMutationMock,
  useProformaInvoicesQueryMock,
  useApproveProformaInvoiceMutationMock,
  useGenerateInternationalPoMutationMock,
  useCreateProformaInvoiceMutationMock,
} = vi.hoisted(() => ({
  useImportProjectsQueryMock: vi.fn(),
  useCreateImportProjectMutationMock: vi.fn(),
  useCalculateFeasibilityMutationMock: vi.fn(),
  useConvertFeasibilityToProjectMutationMock: vi.fn(),
  useUpdateImportProjectMutationMock: vi.fn(),
  useCloseProjectMutationMock: vi.fn(),
  useApprovalRequestsQueryMock: vi.fn(),
  useCreateApprovalRequestMutationMock: vi.fn(),
  useCustomsTariffsQueryMock: vi.fn(),
  useCustomsTariffSectorsQueryMock: vi.fn(),
  useSectorPresetsQueryMock: vi.fn(),
  usePartnersQueryMock: vi.fn(),
  useChinaSuppliersQueryMock: vi.fn(),
  useCreateChinaSupplierMutationMock: vi.fn(),
  useUpsertSupplierMetaMutationMock: vi.fn(),
  useQcInspectionsQueryMock: vi.fn(),
  useCreateQcInspectionMutationMock: vi.fn(),
  useSourcingTripsQueryMock: vi.fn(),
  useCreateSourcingTripMutationMock: vi.fn(),
  useImportCommandCenterQueryMock: vi.fn(),
  useShipmentsQueryMock: vi.fn(),
  useQuotationsQueryMock: vi.fn(),
  useCreateQuotationMutationMock: vi.fn(),
  useSelectQuotationMutationMock: vi.fn(),
  useSampleOrdersQueryMock: vi.fn(),
  useCreateSampleOrderMutationMock: vi.fn(),
  useUpdateSampleInspectionMutationMock: vi.fn(),
  useProformaInvoicesQueryMock: vi.fn(),
  useApproveProformaInvoiceMutationMock: vi.fn(),
  useGenerateInternationalPoMutationMock: vi.fn(),
  useCreateProformaInvoiceMutationMock: vi.fn(),
}));

vi.mock('@/features/import-sales/api/shipments.api', () => ({
  useImportProjectsQuery: useImportProjectsQueryMock,
  useCreateImportProjectMutation: useCreateImportProjectMutationMock,
  useCalculateFeasibilityMutation: useCalculateFeasibilityMutationMock,
  useConvertFeasibilityToProjectMutation: useConvertFeasibilityToProjectMutationMock,
  useUpdateImportProjectMutation: useUpdateImportProjectMutationMock,
  useCloseProjectMutation: useCloseProjectMutationMock,
  useApprovalRequestsQuery: useApprovalRequestsQueryMock,
  useCreateApprovalRequestMutation: useCreateApprovalRequestMutationMock,
  useCustomsTariffsQuery: useCustomsTariffsQueryMock,
  useCustomsTariffSectorsQuery: useCustomsTariffSectorsQueryMock,
  useSectorPresetsQuery: useSectorPresetsQueryMock,
  usePartnersQuery: usePartnersQueryMock,
  useChinaSuppliersQuery: useChinaSuppliersQueryMock,
  useCreateChinaSupplierMutation: useCreateChinaSupplierMutationMock,
  useUpsertSupplierMetaMutation: useUpsertSupplierMetaMutationMock,
  useQcInspectionsQuery: useQcInspectionsQueryMock,
  useCreateQcInspectionMutation: useCreateQcInspectionMutationMock,
  useSourcingTripsQuery: useSourcingTripsQueryMock,
  useCreateSourcingTripMutation: useCreateSourcingTripMutationMock,
  useImportCommandCenterQuery: useImportCommandCenterQueryMock,
  useShipmentsQuery: useShipmentsQueryMock,
  useQuotationsQuery: useQuotationsQueryMock,
  useCreateQuotationMutation: useCreateQuotationMutationMock,
  useSelectQuotationMutation: useSelectQuotationMutationMock,
  useSampleOrdersQuery: useSampleOrdersQueryMock,
  useCreateSampleOrderMutation: useCreateSampleOrderMutationMock,
  useUpdateSampleInspectionMutation: useUpdateSampleInspectionMutationMock,
  useProformaInvoicesQuery: useProformaInvoicesQueryMock,
  useApproveProformaInvoiceMutation: useApproveProformaInvoiceMutationMock,
  useGenerateInternationalPoMutation: useGenerateInternationalPoMutationMock,
  useCreateProformaInvoiceMutation: useCreateProformaInvoiceMutationMock,
}));

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useProductsQuery: () => ({ data: [], isLoading: false }),
}));

// The China sub-tabs fetch the project list with a raw useQuery over http;
// resolve it to an empty list so no network is attempted in jsdom.
vi.mock('@/lib/http', () => ({
  http: vi.fn().mockResolvedValue([]),
}));

const PROJECT = {
  id: 'p1',
  project_no: 'IMP-261108-0001',
  title: 'صفقة اختبار',
  target_market: 'السوق المحلي المصري',
  country_origin: 'الصين',
  country_destination: 'مصر',
  budget_currency: 'USD',
  allocated_capital: 100,
  target_roi_percentage: 10,
  status: 'feasibility',
  created_at: '2026-11-08',
  shipmentCount: 0,
};

const SUPPLIER = {
  id: 1,
  name: 'مصنع اختبار',
  chinese_name: '',
  city: 'Guangzhou',
  province: 'Guangdong',
  moq_description: '100 قطعة',
  production_lead_time_days: 30,
  verified_bank_details: {},
  balance: 0,
  import_notes: '',
};

const METRICS = {
  capital: { totalCapital: 100000, deployedCapital: 50000, availableCapital: 50000, totalWithdrawn: 0 },
  pipeline: {
    projects: { feasibility: 1, contracted: 0, manufacturing: 0, closed: 0 },
    shipments: { inTransit: 1, inCustoms: 0, arrived: 1 },
  },
  alerts: { demurrageAlerts: [], aciExpiring: [] },
  performance: { totalRevenue: 2508.8, grossProfit: 918.28, netProfitPool: 918.28 },
  liabilities: { unpaidProformaUsd: 0, totalDebtForeign: 0, totalDebtEgp: 0 },
};

const SHIPMENTS = {
  rows: [
    {
      id: 's1',
      container_number: 'MSCU-TEST-001',
      supplier_name: 'مورد اختبار',
      arrival_date: '2026-11-09',
      status: 'Arrived',
    },
  ],
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
  const queryMocks = [
    useImportProjectsQueryMock,
    useApprovalRequestsQueryMock,
    useCustomsTariffsQueryMock,
    useCustomsTariffSectorsQueryMock,
    useSectorPresetsQueryMock,
    usePartnersQueryMock,
    useChinaSuppliersQueryMock,
    useQcInspectionsQueryMock,
    useSourcingTripsQueryMock,
    useImportCommandCenterQueryMock,
    useShipmentsQueryMock,
    useQuotationsQueryMock,
    useSampleOrdersQueryMock,
    useProformaInvoicesQueryMock,
  ];
  const mutationMocks = [
    useCreateImportProjectMutationMock,
    useCalculateFeasibilityMutationMock,
    useConvertFeasibilityToProjectMutationMock,
    useUpdateImportProjectMutationMock,
    useCloseProjectMutationMock,
    useCreateApprovalRequestMutationMock,
    useCreateChinaSupplierMutationMock,
    useUpsertSupplierMetaMutationMock,
    useCreateQcInspectionMutationMock,
    useCreateSourcingTripMutationMock,
    useCreateQuotationMutationMock,
    useSelectQuotationMutationMock,
    useCreateSampleOrderMutationMock,
    useUpdateSampleInspectionMutationMock,
    useApproveProformaInvoiceMutationMock,
    useGenerateInternationalPoMutationMock,
    useCreateProformaInvoiceMutationMock,
  ];
  queryMocks.forEach((m) => m.mockReturnValue(queryResult()));
  mutationMocks.forEach((m) => m.mockReturnValue(mutationResult()));
  useShipmentsQueryMock.mockReturnValue(queryResult({ data: { rows: [] } }));
}

describe('I2-P7 import loading states', () => {
  beforeEach(() => {
    setQueryDefaults();
  });

  describe('ImportProjectsManager list', () => {
    it('loading: shows a loading state, never the (0) count or the empty state', () => {
      useImportProjectsQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      renderScreen(<ImportProjectsManager />);

      expect(screen.getByText('جاري تحميل مشاريع الاستيراد...')).toBeInTheDocument();
      expect(screen.queryByText('لا توجد مشاريع استيراد مسجلة')).toBeNull();
      expect(document.body.textContent).toContain('قائمة مشاريع وصفقات الاستيراد (…)');
      expect(document.body.textContent).not.toContain('(0)');
    });

    it('loaded empty: shows the empty state, no loading state', () => {
      useImportProjectsQueryMock.mockReturnValue(queryResult({ data: [], isLoading: false }));
      renderScreen(<ImportProjectsManager />);

      expect(screen.getByText('لا توجد مشاريع استيراد مسجلة')).toBeInTheDocument();
      expect(screen.queryByText('جاري تحميل مشاريع الاستيراد...')).toBeNull();
      expect(document.body.textContent).toContain('قائمة مشاريع وصفقات الاستيراد (0)');
    });

    it('loaded with data: shows the project row, no empty state', () => {
      useImportProjectsQueryMock.mockReturnValue(queryResult({ data: [PROJECT], isLoading: false }));
      renderScreen(<ImportProjectsManager />);

      expect(screen.getByText('IMP-261108-0001')).toBeInTheDocument();
      expect(screen.getByText('صفقة اختبار')).toBeInTheDocument();
      expect(screen.queryByText('لا توجد مشاريع استيراد مسجلة')).toBeNull();
    });
  });

  describe('ChinaSourcingPage factories', () => {
    it('loading: shows a loading state, never the (0) count or the empty state', () => {
      useChinaSuppliersQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      renderScreen(<ChinaSourcingPage />);

      expect(screen.getByText('جاري تحميل المصانع والموردين...')).toBeInTheDocument();
      expect(screen.queryByText('لا توجد مصانع أو موردين دوليين مسجلين')).toBeNull();
      expect(document.body.textContent).toContain('دليل المصانع والحسابات الموثقة (…)');
      // The factories tab itself must never show (0) while its query loads;
      // the QC/trips tabs show their own queries' (loaded-empty) counts.
      expect(document.body.textContent).not.toContain('دليل المصانع والحسابات الموثقة (0)');
    });

    it('loaded empty: shows the empty state, no loading state', () => {
      useChinaSuppliersQueryMock.mockReturnValue(queryResult({ data: [], isLoading: false }));
      renderScreen(<ChinaSourcingPage />);

      expect(screen.getByText('لا توجد مصانع أو موردين دوليين مسجلين')).toBeInTheDocument();
      expect(screen.queryByText('جاري تحميل المصانع والموردين...')).toBeNull();
    });

    it('loaded with data: shows the supplier row, no empty state', () => {
      useChinaSuppliersQueryMock.mockReturnValue(queryResult({ data: [SUPPLIER], isLoading: false }));
      renderScreen(<ChinaSourcingPage />);

      expect(screen.getByText('مصنع اختبار')).toBeInTheDocument();
      expect(screen.queryByText('لا توجد مصانع أو موردين دوليين مسجلين')).toBeNull();
    });
  });

  describe('ChinaSourcingPage trips and QC tabs', () => {
    it('trips loading: shows a loading state, never the trips empty state', async () => {
      const user = userEvent.setup();
      useSourcingTripsQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      renderScreen(<ChinaSourcingPage />);

      await user.click(screen.getByRole('button', { name: /رحلات الصين والمعارض/ }));

      expect(screen.getByText('جاري تحميل رحلات المصانع...')).toBeInTheDocument();
      expect(screen.queryByText(/لا توجد رحلات مصانع مسجلة حالياً/)).toBeNull();
    });

    it('trips loaded empty: shows the trips empty state', async () => {
      const user = userEvent.setup();
      useSourcingTripsQueryMock.mockReturnValue(queryResult({ data: [], isLoading: false }));
      renderScreen(<ChinaSourcingPage />);

      await user.click(screen.getByRole('button', { name: /رحلات الصين والمعارض/ }));

      expect(screen.getByText(/لا توجد رحلات مصانع مسجلة حالياً/)).toBeInTheDocument();
      expect(screen.queryByText('جاري تحميل رحلات المصانع...')).toBeNull();
    });

    it('QC loading: shows a loading state, never the QC empty state', async () => {
      const user = userEvent.setup();
      useQcInspectionsQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      renderScreen(<ChinaSourcingPage />);

      await user.click(screen.getByRole('button', { name: /تقارير فحص الجودة/ }));

      expect(screen.getByText('جاري تحميل تقارير الفحص...')).toBeInTheDocument();
      expect(screen.queryByText('لا توجد تقارير فحص مسجلة حتى الآن.')).toBeNull();
    });
  });

  describe('ImportCommandCenter KPIs', () => {
    it('loading: shows a loading state and dashes, never 0.00 KPIs or empty states', () => {
      useImportCommandCenterQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      useImportProjectsQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      useShipmentsQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      renderScreen(<ImportCommandCenter />);

      expect(screen.getByText('جاري تحميل مؤشرات الاستيراد...')).toBeInTheDocument();
      expect(document.body.textContent).not.toContain('0.00');
      expect(screen.queryAllByText('—').length).toBeGreaterThan(0);
      expect(screen.queryByText('لا توجد مشاريع استيراد مسجلة حتى الآن.')).toBeNull();
      expect(screen.queryByText('لا توجد شحنات بحرية مسجلة حاليًا.')).toBeNull();
    });

    it('loaded: shows the real KPI values, the project and the shipment', () => {
      useImportCommandCenterQueryMock.mockReturnValue(queryResult({ data: METRICS, isLoading: false }));
      useImportProjectsQueryMock.mockReturnValue(queryResult({ data: [PROJECT], isLoading: false }));
      useShipmentsQueryMock.mockReturnValue(queryResult({ data: SHIPMENTS, isLoading: false }));
      renderScreen(<ImportCommandCenter />);

      // Trial value: net profit 918.28 must render, not 0.00.
      expect(screen.getByText('918.28')).toBeInTheDocument();
      expect(screen.getByText('صفقة اختبار')).toBeInTheDocument();
      expect(screen.getByText(/MSCU-TEST-001/)).toBeInTheDocument();
      expect(screen.queryByText('جاري تحميل مؤشرات الاستيراد...')).toBeNull();
      expect(screen.queryByText('لا توجد مشاريع استيراد مسجلة حتى الآن.')).toBeNull();
    });
  });

  describe('China sub-tabs', () => {
    it('quotations loading: shows a loading row, never the empty row', () => {
      useQuotationsQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      renderScreen(<ChinaQuotationsTab />);

      expect(screen.getByText('جاري تحميل عروض الأسعار...')).toBeInTheDocument();
      expect(screen.queryByText('لا توجد عروض أسعار مسجلة للمقارنة حالياً')).toBeNull();
    });

    it('quotations loaded empty: shows the empty row', () => {
      useQuotationsQueryMock.mockReturnValue(queryResult({ data: [], isLoading: false }));
      renderScreen(<ChinaQuotationsTab />);

      expect(screen.getByText('لا توجد عروض أسعار مسجلة للمقارنة حالياً')).toBeInTheDocument();
      expect(screen.queryByText('جاري تحميل عروض الأسعار...')).toBeNull();
    });

    it('samples loading: shows a loading row, never the empty row', () => {
      useSampleOrdersQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      renderScreen(<ChinaSamplesTab />);

      expect(screen.getByText('جاري تحميل طلبات العينات...')).toBeInTheDocument();
      expect(screen.queryByText('لا توجد طلبات عينات مسجلة حالياً')).toBeNull();
    });

    it('proformas loading: shows a loading row, never the empty row', () => {
      useProformaInvoicesQueryMock.mockReturnValue(queryResult({ data: undefined, isLoading: true }));
      renderScreen(<ChinaProformasTab />);

      expect(screen.getByText('جاري تحميل الفواتير المبدئية...')).toBeInTheDocument();
      expect(screen.queryByText('لا توجد فواتير مبدئية مسجلة حالياً')).toBeNull();
    });
  });
});
