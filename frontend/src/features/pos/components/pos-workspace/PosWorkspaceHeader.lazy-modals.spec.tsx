/* POS header lazy modals: every modal the header owns must mount ONLY
 * when its open flag is true. At base the header mounts ~19 modal trees
 * unconditionally with open={false} (PosWorkspaceHeader.tsx:933-1195), so
 * each one runs its hooks — useState initialisers, useQuery
 * subscriptions, usePosUiCustomization, drive-thru polling setup — on
 * every header render, even though DialogShell / the modals' own early
 * returns keep their content out of the DOM.
 *
 * The modals are mocked with marker components: a marker in the document
 * proves the modal is MOUNTED (its component function ran), which is
 * exactly the defect — the real modals' content is already absent while
 * closed, so asserting on real content could never fail at base. The
 * no-sale DialogShell is mocked the same way (marker + children) because
 * the real shell also returns null while closed.
 *
 * RED PROOF: on the unfixed header the closed test fails — all markers
 * are present while every modal is closed — and the open test fails
 * because the other markers are present too. After the fix (conditional
 * render per modal) all three tests pass.
 *
 * Behaviour preserved by construction: each modal still receives the
 * same props and opens the same way; the only change is that a closed
 * modal is not mounted. No modal in this list relies on being mounted
 * while closed: none exposes a ref/imperative handle, no effect must
 * run before open (every data effect is gated on the open flag), and no
 * close/reopen state persistence is contracted anywhere — PosComboMealModal
 * and PosCustomizationDialog explicitly reset/re-sync their drafts on
 * open, and closing any other modal here is a dismiss that starts a
 * fresh task on reopen.
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { createTestQueryClient } from '@/test/test-query-client';
import { PosWorkspaceHeader } from './PosWorkspaceHeader';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
    i18n: { language: 'ar' },
  }),
  // src/lib/i18n.ts calls i18n.use(initReactI18next) at import time;
  // i18next validates the module shape (type '3rdParty' + init).
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('@/shared/hooks/use-catalog-queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/hooks/use-catalog-queries')>();
  return {
    ...actual,
    useSettingsQuery: () => ({
      data: {
        restaurantModuleEnabled: false,
        storefrontModuleEnabled: false,
        phoneOrdersModuleEnabled: false,
        servicesModuleEnabled: false,
        enableMobileStoreFeatures: false,
      },
    }),
  };
});

// Marker probes: each mocked modal renders only its test id, so presence
// in the document proves the header mounted that modal tree.
vi.mock('./PosOnlineOrdersModal', () => ({
  PosOnlineOrdersModal: () => <div data-testid="lazy-modal-online-orders" />,
}));
vi.mock('./PosOfflineQueueModal', () => ({
  PosOfflineQueueModal: () => <div data-testid="lazy-modal-offline-queue" />,
}));
vi.mock('./PosInstantExchangeDialog', () => ({
  PosInstantExchangeDialog: () => <div data-testid="lazy-modal-instant-exchange" />,
}));
vi.mock('./PosDeliveryAggregatorsModal', () => ({
  PosDeliveryAggregatorsModal: () => <div data-testid="lazy-modal-aggregators" />,
}));
vi.mock('./RestaurantDeliveryDispatcherModal', () => ({
  RestaurantDeliveryDispatcherModal: () => <div data-testid="lazy-modal-driver-dispatch" />,
}));
vi.mock('./PosFoodWasteModal', () => ({
  PosFoodWasteModal: () => <div data-testid="lazy-modal-food-waste" />,
}));
vi.mock('./Pos86ItemsModal', () => ({
  Pos86ItemsModal: () => <div data-testid="lazy-modal-86-items" />,
}));
vi.mock('./PosTipPoolModal', () => ({
  PosTipPoolModal: () => <div data-testid="lazy-modal-tip-pool" />,
}));
vi.mock('./KitchenDailyPrepSheetModal', () => ({
  KitchenDailyPrepSheetModal: () => <div data-testid="lazy-modal-prep-sheet" />,
}));
vi.mock('./PosPlateCostRadarModal', () => ({
  PosPlateCostRadarModal: () => <div data-testid="lazy-modal-plate-radar" />,
}));
vi.mock('./PosCustomerPunchCardModal', () => ({
  PosCustomerPunchCardModal: () => <div data-testid="lazy-modal-punch-card" />,
}));
vi.mock('./PosDriveThruModal', () => ({
  PosDriveThruModal: () => <div data-testid="lazy-modal-drive-thru" />,
}));
vi.mock('./PosSmartUpsellModal', () => ({
  PosSmartUpsellModal: () => <div data-testid="lazy-modal-upsell" />,
}));
vi.mock('./PosRestaurantOperationsModal', () => ({
  PosRestaurantOperationsModal: () => <div data-testid="lazy-modal-ops" />,
}));
vi.mock('./PosDisplaysModal', () => ({
  PosDisplaysModal: () => <div data-testid="lazy-modal-displays" />,
}));
vi.mock('./PosManagerCompModal', () => ({
  PosManagerCompModal: () => <div data-testid="lazy-modal-manager-comp" />,
}));
vi.mock('./PosComboMealModal', () => ({
  PosComboMealModal: () => <div data-testid="lazy-modal-combo-meal" />,
}));
vi.mock('./PosCustomizationDialog', () => ({
  PosCustomizationDialog: () => <div data-testid="lazy-modal-customization" />,
}));
vi.mock('@/shared/components/dialog-shell', () => ({
  DialogShell: ({ children }: { children?: React.ReactNode }) => (
    <div data-testid="lazy-dialog-shell-no-sale">{children}</div>
  ),
}));

const MODAL_TEST_IDS = [
  'lazy-modal-online-orders',
  'lazy-modal-offline-queue',
  'lazy-modal-instant-exchange',
  'lazy-modal-aggregators',
  'lazy-modal-driver-dispatch',
  'lazy-modal-food-waste',
  'lazy-modal-86-items',
  'lazy-modal-tip-pool',
  'lazy-modal-prep-sheet',
  'lazy-modal-plate-radar',
  'lazy-modal-punch-card',
  'lazy-modal-drive-thru',
  'lazy-modal-upsell',
  'lazy-modal-ops',
  'lazy-modal-displays',
  'lazy-modal-manager-comp',
  'lazy-modal-combo-meal',
  'lazy-modal-customization',
] as const;

function buildPos(overrides: Record<string, unknown> = {}) {
  return {
    isLoading: false,
    paymentType: 'cash',
    paymentChannel: 'cash',
    ownOpenShift: null,
    branchId: 1,
    hasOperationalSetup: true,
    hasCatalogReady: true,
    requiresCashierShift: false,
    cart: [],
    lastSale: null,
    canSubmitSale: false,
    canSubmitHint: '',
    heldDraftSummaries: [],
    heldDrafts: [],
    settingsQuery: { data: undefined },
    tableNumber: '',
    totals: { total: 0, subTotal: 0, netSubTotal: 0, discountValue: 0, deliveryFee: 0, taxAmount: 0 },
    currentBranch: undefined,
    currentLocation: undefined,
    orderType: 'takeaway',
    customerId: '',
    search: '',
    priceType: 'retail',
    locationId: 1,
    cashAmount: 0,
    cardAmount: 0,
    transferAmount: 0,
    discount: 0,
    deliveryFee: 0,
    note: '',
    diningCourse: undefined,
    reprintLastSale: vi.fn(),
    holdDraft: vi.fn(),
    setOrderType: vi.fn(),
    setTableNumber: vi.fn(),
    setCustomerId: vi.fn(),
    setQuickCustomerName: vi.fn(),
    setQuickCustomerPhone: vi.fn(),
    setQuickCustomerAddress: vi.fn(),
    recallDraft: vi.fn(),
    saveHeldDraftMutation: { mutateAsync: vi.fn() },
    setCart: vi.fn(),
    productsQuery: { data: [] },
    currency: 'ج.م',
    addProduct: vi.fn(),
    setDiscount: vi.fn(),
    setNote: vi.fn(),
    setSelectedLineKey: vi.fn(),
    setLastAddedLineKey: vi.fn(),
    ...overrides,
  };
}

function renderHeader(posOverrides: Record<string, unknown> = {}) {
  const queryClient = createTestQueryClient();
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <PosWorkspaceHeader
          pos={buildPos(posOverrides) as never}
          posMode="scanner"
          onModeChange={vi.fn()}
          onFocusSearch={vi.fn()}
          onPrintDraft={vi.fn()}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('PosWorkspaceHeader — lazy modals (closed modals are not mounted)', () => {
  it('mounts no modal tree while every modal is closed', () => {
    renderHeader();

    // The header itself still renders (title + actions).
    expect(screen.getByText('نقطة البيع')).toBeInTheDocument();
    for (const testId of MODAL_TEST_IDS) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
    // Inline no-sale dialog: its heading must not be mounted either.
    expect(screen.queryByText('فتح الدرج بدون بيع')).not.toBeInTheDocument();
  });

  it('opening the displays modal mounts exactly that modal', () => {
    renderHeader();

    fireEvent.click(screen.getByText('شاشات العرض'));

    expect(screen.getByTestId('lazy-modal-displays')).toBeInTheDocument();
    for (const testId of MODAL_TEST_IDS) {
      if (testId === 'lazy-modal-displays') continue;
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  });

  it('opening the no-sale drawer dialog mounts only its inline dialog', () => {
    renderHeader({ ownOpenShift: { id: 7 } });

    expect(screen.queryByText('فتح الدرج بدون بيع')).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('خيارات الوردية'));
    fireEvent.click(screen.getByText('فتح الدرج يدوياً (No-Sale)'));

    expect(screen.getByText('فتح الدرج بدون بيع')).toBeInTheDocument();
    for (const testId of MODAL_TEST_IDS) {
      expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
    }
  });
});
