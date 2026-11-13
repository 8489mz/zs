/* INV-VAN-GPS-FLAG-OFF-VISIT — the customer-pick GPS gate never consulted
 * the rep's per-rep GPS flag: picking a customer always ran the visit-start
 * GPS capture, and with no coordinates the mandatory dialog opened, so a rep
 * whose admin had switched GPS off could never select a customer at all
 * (live 2026-11-13: flag unticked and confirmed unchecked, dialog still
 * opened 3x in both pickers across two fresh sessions).
 *
 * Cases: (1) flag explicitly OFF -> picking a customer starts the visit
 * without coordinates: no GPS dialog, the customer is selected, and the
 * visit check-in goes out with no latitude/longitude. (2) flag ON +
 * geolocation unavailable -> the dialog still opens (safety property kept).
 * (3) flag missing entirely -> mandatory, same as ON (default stays
 * mandatory; only an explicit OFF opts out).
 *
 * The page is rendered for real with its data layer stubbed at the module
 * boundary, and the customer is picked through the sale tab combobox,
 * exactly as a rep does. The geolocation API is absent in this environment,
 * which is the failure the ON/missing cases pin.
 */
import { QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import VanSalesMobilePage from './VanSalesMobilePage';
import { createTestQueryClient } from '@/test/test-query-client';

// jsdom has no Element.scrollIntoView; the shared CustomSelect calls it
// when its dropdown opens.
window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

const GPS_DIALOG_TITLE = 'تفعيل خدمة تحديد المواقع (GPS) إلزامي';
const CUSTOMER_NAME = 'محل اختبار تجريبي';
const CUSTOMER_PICKER_PLACEHOLDER = 'اختر المحل / العميل من القائمة';

const { currentRep, mockCheckInVisit, mockGetActiveTrip } = vi.hoisted(() => ({
  currentRep: { value: null as any },
  mockCheckInVisit: vi.fn(),
  mockGetActiveTrip: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
  // The page's import graph loads the app i18n setup, which registers
  // this plugin at module load; the stub carries the plugin shape the
  // registry validates, and its init is a no-op.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/shared/api/delivery-reps.api', () => ({
  driverPortalApi: {
    getStoredSession: () => ({ token: 'driver-token', rep: currentRep.value }),
    getStoredMustChangePin: () => false,
    logout: vi.fn(),
  },
}));

vi.mock('../api/van-sales.api', () => ({
  vanSalesApi: {
    getActiveTrip: mockGetActiveTrip,
    listMyRequisitions: vi.fn().mockResolvedValue([]),
    getMyItinerary: vi.fn().mockResolvedValue([]),
    getDriverFuelLogs: vi.fn().mockResolvedValue([]),
    getDriverMaintenanceAlerts: vi.fn().mockResolvedValue([]),
    getWarehouses: vi.fn().mockResolvedValue([]),
    getAvailableProducts: vi.fn().mockResolvedValue([]),
    getTripExpenses: vi.fn().mockResolvedValue({ expenses: [], totalExpenses: 0 }),
    getTripPackagingMovements: vi.fn().mockResolvedValue([]),
    getPeerReps: vi.fn().mockResolvedValue([]),
    getDriverTransfers: vi.fn().mockResolvedValue([]),
    getCustomerLastSoldPrices: vi.fn().mockResolvedValue({ lastPrices: {} }),
    getCustomerSuggestedOrder: vi.fn().mockResolvedValue({ items: [] }),
    checkInVisit: mockCheckInVisit,
    openTrip: vi.fn(),
    settleTrip: vi.fn(),
    recordCollection: vi.fn(),
    executeSale: vi.fn(),
    cancelMyRequisition: vi.fn(),
  },
}));

vi.mock('../offline/van-sales-offline.db', () => ({
  vanOfflineDb: {
    getPendingCount: vi.fn().mockResolvedValue(0),
    getOfflineActiveTrip: vi.fn().mockResolvedValue(null),
    getPendingOutbox: vi.fn().mockResolvedValue([]),
    getItinerary: vi.fn().mockResolvedValue([]),
    saveSnapshot: vi.fn().mockResolvedValue(undefined),
    saveItinerary: vi.fn().mockResolvedValue(undefined),
    saveRequisitionCatalog: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../offline/van-sync.engine', () => ({
  vanSyncEngine: {
    startAutoSyncListener: vi.fn().mockReturnValue(() => {}),
    syncAll: vi.fn().mockResolvedValue({ syncedCount: 0, failedCount: 0, errors: [] }),
  },
}));

vi.mock('@/shared/components/system-alert', () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
  systemConfirm: vi.fn().mockResolvedValue(false),
}));

function activeTripResponse() {
  return {
    hasActiveTrip: true,
    trip: {
      id: 5,
      repId: 37,
      repName: 'مندوب اختبار فان',
      vanLocationId: 1,
      vanLocationName: 'سيارة مندوب: مندوب اختبار فان',
      sourceWarehouseId: 1,
      sourceWarehouseName: 'الفرع الرئيسي',
      status: 'open',
      openedAt: '2026-11-13T07:00:00.000Z',
      loadedAmount: 0,
      salesAmount: 0,
      cashCollected: 0,
      creditSales: 0,
      returnsAmount: 0,
    },
    inventory: [],
    customers: [{ id: 1, name: CUSTOMER_NAME, phone: '01099990002', balance: 0 }],
    recentSales: [],
  };
}

function renderPage() {
  const queryClient = createTestQueryClient();
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <VanSalesMobilePage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

async function pickCustomer() {
  const picker = await screen.findByPlaceholderText(CUSTOMER_PICKER_PLACEHOLDER);
  fireEvent.click(picker);
  const option = await screen.findByText(CUSTOMER_NAME);
  fireEvent.click(option);
}

function repWithFlag(flag: boolean | undefined) {
  const rep: any = {
    id: 37,
    name: 'مندوب اختبار فان',
    phone: '01099990001',
    tenantId: 'test10k',
    isVanRep: true,
    vanLocationId: 1,
  };
  if (flag !== undefined) rep.permissions = { require_gps_on_visit: flag };
  return rep;
}

describe('VanSalesMobilePage GPS flag', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockCheckInVisit.mockResolvedValue({ ok: true, visitId: 1, customerName: CUSTOMER_NAME, geofence: null, checkInAt: '2026-11-13T07:00:00.000Z' });
    mockGetActiveTrip.mockResolvedValue(activeTripResponse());
  });

  it('(1) flag explicitly OFF: picking a customer starts the visit without GPS — no dialog, customer selected, check-in without coordinates', async () => {
    currentRep.value = repWithFlag(false);
    renderPage();
    await pickCustomer();

    // The selected-customer card renders only once the pick succeeds.
    await screen.findByText('تغيير العميل');
    expect(screen.queryByText(GPS_DIALOG_TITLE)).toBeNull();
    expect(mockCheckInVisit).toHaveBeenCalledTimes(1);
    const payload = mockCheckInVisit.mock.calls[0][0];
    expect(payload.customerId).toBe(1);
    expect(payload.customerName).toBe(CUSTOMER_NAME);
    expect(payload.latitude).toBeUndefined();
    expect(payload.longitude).toBeUndefined();
  });

  it('(2) flag ON + geolocation unavailable: the mandatory GPS dialog still opens and the customer is not selected', async () => {
    currentRep.value = repWithFlag(true);
    renderPage();
    await pickCustomer();

    await screen.findByText(GPS_DIALOG_TITLE);
    expect(screen.queryByText('تغيير العميل')).toBeNull();
    expect(mockCheckInVisit).not.toHaveBeenCalled();
  });

  it('(3) flag missing: GPS stays mandatory — the dialog opens', async () => {
    currentRep.value = repWithFlag(undefined);
    renderPage();
    await pickCustomer();

    await screen.findByText(GPS_DIALOG_TITLE);
    expect(screen.queryByText('تغيير العميل')).toBeNull();
  });
});
