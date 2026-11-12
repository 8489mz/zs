import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode, RefObject } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosWorkspace } from './PosWorkspace';
import { PosWorkspaceMainContent } from './pos-workspace/PosWorkspaceMainContent';

/*
 * POS render-cost memo proof.
 *
 * (a) Re-rendering PosWorkspace with unchanged values must NOT re-render
 *     PosWorkspaceHeader (its memo + areEqual must see identical props).
 *     The REAL usePosWorkspace hook runs here (APIs mocked), so this also
 *     proves the hook no longer hands the header fresh identities
 *     (eightySixedProductIds, heldDraftSummaries) on every pass.
 * (b) Re-rendering PosWorkspaceMainContent with identical props must NOT
 *     re-render it (memo with default shallow compare).
 *
 * Render counts are observed through the mocked PageHeader (rendered once
 * per header render) and the mocked QueryFeedback (rendered once per
 * MainContent render). Both are plain function components, so they render
 * exactly when their parent renders.
 */

const counts = vi.hoisted(() => ({ header: 0, mainContent: 0 }));

vi.mock('@/shared/components/page-header', () => ({
  PageHeader: () => {
    counts.header += 1;
    return <div data-testid="pos-header" />;
  },
}));

vi.mock('@/shared/components/query-feedback', () => ({
  QueryFeedback: ({ children }: { children: ReactNode }) => {
    counts.mainContent += 1;
    return <>{children}</>;
  },
}));

vi.mock('@/shared/ui/currency-symbol', () => ({
  CurrencySymbol: () => <span>ج.م</span>,
}));

vi.mock('@/features/pos/components/PosProductsPanel', () => ({
  PosProductsPanel: ({ searchInputRef }: { searchInputRef?: RefObject<HTMLInputElement | null> }) => (
    <input ref={searchInputRef} aria-label="barcode" />
  ),
}));

vi.mock('@/features/pos/components/PosCartPanel', () => ({
  PosCartPanel: () => <div data-testid="pos-cart-panel" />,
}));

vi.mock('@/features/pos/components/pos-workspace/PosWorkspaceDock', () => ({
  PosWorkspaceDock: () => <div data-testid="pos-dock" />,
}));

vi.mock('@/features/pos/components/pos-workspace/PosWorkspaceStatusCards', () => ({
  PosWorkspaceStartupIssues: () => null,
}));

vi.mock('@/features/pos/hooks/usePosUiCustomization', () => ({
  usePosUiCustomization: () => ({ customization: { autoHideBottomNav: false } }),
}));

vi.mock('@/shared/hooks/useSplitter', () => ({
  useSplitter: () => ({ leftRatio: 38, rightRatio: 62, handlePositionPct: 38, startDrag: vi.fn() }),
}));

vi.mock('@/shared/hooks/use-is-mobile', () => ({
  useIsMobile: () => false,
}));

/* Real hook, mocked APIs: the workspace hook runs for real so the header
 * receives exactly the identities the production hook produces. */
vi.mock('@/features/pos/api/pos.api', () => ({
  posApi: {
    customers: async () => [],
    settings: async () => ({ restaurantModuleEnabled: true, currency: 'EGP' }),
    branches: async () => [],
    locations: async () => [],
    lookupProducts: async () => [],
    listHeldDrafts: async () => [],
    getCatalogVersion: async () => ({ version: 'v1' }),
    saveHeldDraft: async () => ({}),
    deleteHeldDraft: async () => ({}),
    clearHeldDrafts: async () => ({}),
    authorizeDiscountOverride: async () => ({}),
    logSecurityEvent: async () => ({}),
  },
}));

vi.mock('@/features/pos/api/restaurant-advanced-fnb.api', () => ({
  restaurantAdvancedFnbApi: {
    getZones: async () => [],
    get86Items: async () => [{ product_id: 7 }],
  },
}));

vi.mock('@/lib/api/cash-drawer', () => ({
  cashDrawerApi: {
    listPage: async () => ({ rows: [] }),
  },
}));

function createPosMock() {
  const product = {
    id: 'p1',
    name: 'Tea',
    retailPrice: 10,
    wholesalePrice: 8,
    stock: 10,
    units: [],
  };
  const line = {
    lineKey: 'p1::piece::retail',
    productId: 'p1',
    name: 'Tea',
    qty: 1,
    price: 10,
    unitName: 'piece',
    priceType: 'retail',
  };

  return {
    search: '',
    setSearch: vi.fn(),
    customerId: '',
    setCustomerId: vi.fn(),
    discount: 0,
    setDiscount: vi.fn(),
    discountApprovalGranted: false,
    setDiscountApprovalGranted: vi.fn(),
    discountApprovalSecret: '',
    setDiscountApprovalSecret: vi.fn(),
    paidAmount: 10,
    cashAmount: 10,
    setCashAmount: vi.fn(),
    cardAmount: 0,
    setCardAmount: vi.fn(),
    transferAmount: 0,
    setTransferAmount: vi.fn(),
    paymentType: 'cash',
    setPaymentType: vi.fn(),
    paymentChannel: 'cash',
    setPaymentChannel: vi.fn(),
    note: '',
    setNote: vi.fn(),
    cart: [line],
    setCart: vi.fn(),
    selectedLineKey: line.lineKey,
    setSelectedLineKey: vi.fn(),
    priceType: 'retail',
    setPriceType: vi.fn(),
    branchId: '',
    locationId: '',
    productFilter: 'all',
    setProductFilter: vi.fn(),
    selectedCategoryId: null,
    setSelectedCategoryId: vi.fn(),
    submitMessage: '',
    setSubmitMessage: vi.fn(),
    heldDrafts: [],
    heldDraftSummaries: [{ id: 'held-1', label: 'Held #1', total: 10, itemsCount: 1 }],
    recentProductIds: [],
    recentProducts: [],
    quickCustomerName: '',
    setQuickCustomerName: vi.fn(),
    quickCustomerPhone: '',
    setQuickCustomerPhone: vi.fn(),
    quickCustomerAddress: '',
    setQuickCustomerAddress: vi.fn(),
    lastSale: null,
    quickAddCode: '',
    setQuickAddCode: vi.fn(),
    scannerMessage: '',
    setScannerMessage: vi.fn(),
    lastAddedLineKey: '',
    setLastAddedLineKey: vi.fn(),
    barcodeFocusTick: 0,
    registerBarcodeFocusListener: vi.fn(() => () => {}),
    customersQuery: { isLoading: false, error: null, data: [], refetch: vi.fn() },
    settingsQuery: { isLoading: false, error: null, data: { paperSize: 'receipt' }, refetch: vi.fn() },
    branchesQuery: { isLoading: false, error: null, data: [], refetch: vi.fn() },
    locationsQuery: { isLoading: false, error: null, data: [], refetch: vi.fn() },
    productsQuery: { isLoading: false, error: null, data: [product], refetch: vi.fn() },
    saleProducts: [product],
    catalogProducts: [product],
    filteredSaleProducts: [product],
    createSale: { isError: false, isPending: false },
    quickCustomerMutation: { isPending: false },
    discountAuthorizationMutation: { isPending: false, mutateAsync: vi.fn() },
    refetchCatalogs: vi.fn(),
    totals: { subTotal: 10, netSubTotal: 10, discountValue: 0, deliveryFee: 0, taxAmount: 0, total: 10 },
    changeAmount: 0,
    amountDue: 0,
    ownOpenShift: { id: 'shift-1' },
    currentBranch: null,
    currentLocation: null,
    canApplyDiscount: true,
    hasDiscountPermissionViolation: false,
    hasPricePermissionViolation: false,
    canSubmitSale: true,
    canSubmitHint: '',
    canOpenCheckout: true,
    checkoutDisabledReason: '',
    canShowLastSaleActions: false,
    handleQuickAddCodeSubmit: vi.fn(),
    handleAddProduct: vi.fn(),
    selectAdjacentCartLine: vi.fn(),
    removeSelectedItem: vi.fn(),
    removeItem: vi.fn(),
    changeSelectedQty: vi.fn(),
    changeLineQtyByDelta: vi.fn(),
    setQty: vi.fn(),
    setItemNote: vi.fn(),
    setLineDiscount: vi.fn(),
    addLineSerial: vi.fn(),
    removeLineSerial: vi.fn(),
    setItemModifiers: vi.fn(),
    setItemSeat: vi.fn(),
    selectCartLine: vi.fn(),
    editSelectedQty: vi.fn(),
    holdDraft: vi.fn(),
    recallDraft: vi.fn(),
    deleteDraft: vi.fn().mockResolvedValue(undefined),
    clearHeldDrafts: vi.fn().mockResolvedValue(undefined),
    resetPosDraft: vi.fn(),
    fillPaidAmount: vi.fn(),
    setPaymentPreset: vi.fn(),
    handleQuickCustomerSubmit: vi.fn(),
    handleSubmit: vi.fn(),
    printReceiptNow: vi.fn(),
    printA4Now: vi.fn(),
    reprintLastSale: vi.fn(),
    completePostSaleCycle: vi.fn(),
    exportPdfNow: vi.fn(),
    exportHeldDrafts: vi.fn(),
    printKitchenNow: vi.fn(),
    printBothNow: vi.fn(),
    printDualReceiptNow: vi.fn(),
    printGuestCheckNow: vi.fn(),
    saveHeldDraftMutation: { mutateAsync: vi.fn() },
  };
}

describe('POS workspace memo', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    counts.header = 0;
    counts.mainContent = 0;
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('(a) re-rendering PosWorkspace with unchanged values does not re-render PosWorkspaceHeader', async () => {
    const renderWorkspace = () => render(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PosWorkspace />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    const { rerender } = renderWorkspace();

    expect(await screen.findByTestId('pos-header')).toBeInTheDocument();
    // Let every mocked query settle so later renders are not query-driven.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    const baseline = counts.header;
    expect(baseline).toBeGreaterThan(0);

    rerender(
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <PosWorkspace />
        </MemoryRouter>
      </QueryClientProvider>,
    );

    expect(counts.header).toBe(baseline);
  }, 30000);

  it('(b) re-rendering PosWorkspaceMainContent with identical props does not re-render it', () => {
    const pos = createPosMock() as unknown as Parameters<typeof PosWorkspaceMainContent>[0]['pos'];
    const props = {
      pos,
      posMode: 'scanner' as const,
      catalogsLoading: false,
      catalogsError: null as unknown,
      allowNegativeStockSales: false,
      searchInputRef: { current: null } as RefObject<HTMLInputElement | null>,
      cartQtySummaries: ['1 × Tea'],
      cartItemsCount: 1,
      onSubmitFirstSearchResult: vi.fn(() => true),
      onRequestDiscountAuthorization: vi.fn(),
      onRequestLineDelete: vi.fn(),
      onItemModifiersClick: vi.fn(),
      onEditProduct: vi.fn(),
      onRequestSelectedLineDelete: vi.fn(),
      onRequestHeldDelete: vi.fn(),
      onRequestClearHeldDrafts: vi.fn(),
      onRequestClearCart: vi.fn(),
      onRequestCheckout: vi.fn(),
      heldDraftsCount: 1,
      onOpenHeldDrafts: vi.fn(),
      onPrintCurrentDraft: vi.fn(),
      onFocusBarcodeEntry: vi.fn(),
      onRequestOpenShift: vi.fn(),
      onOpenNewProduct: vi.fn(),
      onPriceTypeChange: vi.fn(),
    };

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PosWorkspaceMainContent {...props} />
      </QueryClientProvider>,
    );

    expect(counts.mainContent).toBe(1);

    rerender(
      <QueryClientProvider client={queryClient}>
        <PosWorkspaceMainContent {...props} />
      </QueryClientProvider>,
    );

    expect(counts.mainContent).toBe(1);
  });
});
