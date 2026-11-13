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
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import VanSalesMobilePage from './VanSalesMobilePage';
import { vanSalesApi } from '../api/van-sales.api';
import { systemConfirm } from '@/shared/components/system-alert';
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

function activeTripResponse(balance = 0, inventory: any[] = []) {
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
    inventory,
    customers: [{ id: 1, name: CUSTOMER_NAME, phone: '01099990002', balance }],
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

/* INV-VAN-COLLECTION-GUARD-CONTINUATION — the collection and invoice
 * submit guards read React state `activeVisit` only and, when no visit
 * was live, warned + called handleStartVisit WITHOUT passing the submit
 * as its onSuccess continuation — so the first attempt was always
 * discarded. Every sale auto-ENDS the visit, and the Collection tab's
 * picker never starts one, so after every sale the rep's first
 * collection attempt could never succeed (live 2026-11-13: the 288.00
 * collection after the credit sale needed a second tap).
 *
 * Cases: (1) flag OFF + a real sale completed (visit auto-ended) ->
 * the first collection attempt for the same customer succeeds.
 * (2) flag OFF + no visit at all -> the first attempt succeeds and
 * no GPS warning is shown. (3) flag ON + geolocation absent -> still
 * refused, the GPS dialog opens, nothing recorded (safety pin).
 * (4) flag ON + stubbed geolocation -> succeeds with the captured
 * coordinates sent. (5) invoice-guard parity: flag OFF + visit ended
 * after picking -> the checkout opens on the first submit attempt.
 *
 * The page is rendered for real with its data layer stubbed at the
 * module boundary; the rep drives the sale tab, the collection tab
 * and the checkout modal exactly as on the phone.
 */
const SALE_ITEM = {
  productId: 5,
  productName: 'صنف اختبار',
  barcode: '000005',
  qty: 10,
  costPrice: 50,
  retailPrice: 75,
};
const COLLECTION_AMOUNT = 240;
const STUB_LAT = 30.0444;
const STUB_LNG = 31.2357;

const mockRecordCollection = vi.mocked(vanSalesApi.recordCollection);
const mockExecuteSale = vi.mocked(vanSalesApi.executeSale);
const mockSystemConfirm = vi.mocked(systemConfirm);

describe('VanSalesMobilePage collection/invoice submit guards', () => {
  beforeEach(() => {
    // NOTE: this describe does NOT inherit the GPS describe's
    // beforeEach — it must reset the same state itself. In
    // particular localStorage.clear() is load-bearing: the page
    // restores an active visit from 'zs_van_active_visit' on mount,
    // so a visit saved by one test would make the next test's guard
    // see a live visit and pass spuriously.
    localStorage.clear();
    vi.clearAllMocks();
    mockCheckInVisit.mockResolvedValue({ ok: true, visitId: 1, customerName: CUSTOMER_NAME, geofence: null, checkInAt: '2026-11-13T07:00:00.000Z' });
    mockRecordCollection.mockResolvedValue({
      ok: true,
      receiptNo: 'COL-261113-0001',
      amount: COLLECTION_AMOUNT,
      customerName: CUSTOMER_NAME,
      newBalance: 0,
    });
    mockExecuteSale.mockResolvedValue({
      ok: true,
      saleId: 1,
      docNo: 'VAN-261113-0001',
      total: 75,
      paymentMethod: 'cash',
      cashPaid: 75,
      creditOwed: 0,
      customerName: CUSTOMER_NAME,
      itemsCount: 1,
    });
    mockSystemConfirm.mockResolvedValue(false);
    mockGetActiveTrip.mockResolvedValue(activeTripResponse(COLLECTION_AMOUNT, [SALE_ITEM]));
  });

  afterEach(() => {
    // Case (4) stubs geolocation on the navigator; restore the
    // absent-by-default state so later tests see the real environment.
    if ((navigator as any).geolocation) {
      delete (navigator as any).geolocation;
    }
  });

  async function goToCollectionTab() {
    fireEvent.click(screen.getByText('تحصيل / مرتجع'));
    await screen.findByText('تحصيل نقدية');
  }

  async function submitCollectionFirstAttempt() {
    fireEvent.click(screen.getByText('تحصيل نقدية'));
    await screen.findByText('إثبات تحصيل النقدية');
    fireEvent.click(screen.getByText('إثبات تحصيل النقدية'));
  }

  async function completeCashSale() {
    // The van-stock picker opens only on demand from the empty cart.
    fireEvent.click(await screen.findByText('فتح قائمة بضاعة السيارة للاختيار'));
    fireEvent.click(await screen.findByText('إضافة'));
    fireEvent.click(await screen.findByText('إتمام البيع والسداد (75.00 ج.م)'));
    fireEvent.click(await screen.findByText('تأكيد وإصدار الفاتورة'));
    await waitFor(() => expect(mockExecuteSale).toHaveBeenCalledTimes(1));
    // The sale auto-ends the visit: the visit bar disappears.
    await waitFor(() => expect(screen.queryByText('إنهاء الزيارة')).toBeNull());
  }

  it('(1) flag OFF + sale completed (visit auto-ended): the first collection attempt succeeds', async () => {
    currentRep.value = repWithFlag(false);
    renderPage();
    await pickCustomer();
    await completeCashSale();

    await goToCollectionTab();
    await submitCollectionFirstAttempt();

    await waitFor(() => expect(mockRecordCollection).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(GPS_DIALOG_TITLE)).toBeNull();
    const payload = mockRecordCollection.mock.calls[0][0];
    expect(payload.customerId).toBe(1);
    expect(payload.amount).toBe(COLLECTION_AMOUNT);
  });

  it('(2) flag OFF + no visit at all: the first collection attempt succeeds, no GPS warning', async () => {
    currentRep.value = repWithFlag(false);
    renderPage();
    await screen.findByPlaceholderText(CUSTOMER_PICKER_PLACEHOLDER);

    await goToCollectionTab();
    await submitCollectionFirstAttempt();

    await waitFor(() => expect(mockRecordCollection).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(GPS_DIALOG_TITLE)).toBeNull();
    expect(screen.queryByText(/يلزم تفعيل الـ GPS/)).toBeNull();
  });

  it('(3) flag ON + geolocation absent: still refused, the GPS dialog opens, nothing recorded', async () => {
    currentRep.value = repWithFlag(true);
    renderPage();
    await screen.findByPlaceholderText(CUSTOMER_PICKER_PLACEHOLDER);

    await goToCollectionTab();
    await submitCollectionFirstAttempt();

    await screen.findByText(GPS_DIALOG_TITLE);
    expect(mockRecordCollection).not.toHaveBeenCalled();
  });

  it('(4) flag ON + stubbed geolocation: succeeds with the captured coordinates sent', async () => {
    currentRep.value = repWithFlag(true);
    Object.defineProperty(window.navigator, 'geolocation', {
      value: {
        getCurrentPosition: vi.fn((onSuccess: PositionCallback) => {
          onSuccess({ coords: { latitude: STUB_LAT, longitude: STUB_LNG } } as GeolocationPosition);
        }),
      },
      configurable: true,
    });
    renderPage();
    await screen.findByPlaceholderText(CUSTOMER_PICKER_PLACEHOLDER);

    await goToCollectionTab();
    await submitCollectionFirstAttempt();

    await waitFor(() => expect(mockRecordCollection).toHaveBeenCalledTimes(1));
    const payload = mockRecordCollection.mock.calls[0][0];
    expect(payload.gpsLat).toBeCloseTo(STUB_LAT);
    expect(payload.gpsLng).toBeCloseTo(STUB_LNG);
    expect(screen.queryByText(GPS_DIALOG_TITLE)).toBeNull();
  });

  it('(5) invoice-guard parity: flag OFF + visit ended after picking — the checkout opens on the first submit', async () => {
    currentRep.value = repWithFlag(false);
    renderPage();
    await pickCustomer();
    fireEvent.click(await screen.findByText('فتح قائمة بضاعة السيارة للاختيار'));
    fireEvent.click(await screen.findByText('إضافة'));
    mockSystemConfirm.mockResolvedValue(true);
    fireEvent.click(screen.getByText('إنهاء الزيارة'));
    await waitFor(() => expect(screen.queryByText('إنهاء الزيارة')).toBeNull());

    fireEvent.click(await screen.findByText('إتمام البيع والسداد (75.00 ج.م)'));
    await screen.findByText('تأكيد وإصدار الفاتورة');
  });
});
