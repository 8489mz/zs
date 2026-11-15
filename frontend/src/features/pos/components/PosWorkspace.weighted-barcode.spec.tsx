import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PosWorkspace } from '@/features/pos/components/PosWorkspace';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { posApi } from '@/features/pos/api/pos.api';
import { cashDrawerApi } from '@/lib/api/cash-drawer';

// Create a custom query client for testing
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  });
}

// Mock modules
vi.mock('@/features/pos/api/pos.api', () => {
  return {
    posApi: {
      lookupProducts: vi.fn().mockResolvedValue([{ id: '1', name: 'dummy catalog item', barcode: '123', retailPrice: 10, costPrice: 5, stock: 10, units: [] }]),
      customers: vi.fn().mockResolvedValue([]),
      settings: vi.fn().mockResolvedValue({
        weightedBarcodeEnabled: true,
        weightedBarcodePrefix: '20',
        weightedBarcodeProductCodeLength: 5,
        weightedBarcodeWeightDigits: 5,
        weightedBarcodeWeightDecimals: 3,
        allowNegativeStockSales: true,
        currentBranchId: 'b1',
      }),
      branches: vi.fn().mockResolvedValue([
        { id: 'b1', name: 'فرع 1', salesStockMode: 'single_location', allowExternalSalesStock: false, defaultStockLocationId: 'l1' },
        { id: 'b2', name: 'فرع 2', salesStockMode: 'all_operational_locations', allowExternalSalesStock: false, defaultStockLocationId: 'l2' },
      ]),
      locations: vi.fn().mockResolvedValue([
        { id: 'l1', name: 'مخزن 1', branchId: 'b1', locationType: 'internal_warehouse', isActive: true },
        { id: 'l2', name: 'مخزن 2', branchId: 'b2', locationType: 'internal_warehouse', isActive: true },
      ]),
      listHeldDrafts: vi.fn().mockResolvedValue([]),
    },
  };
});

vi.mock('@/features/catalog/api/catalog.api', () => ({
  catalogApi: {
    listPosProducts: vi.fn().mockResolvedValue([{ id: 1, name: 'dummy', barcode: '123' }]),
  },
}));

vi.mock('@/features/settings/api/settings.api', () => ({
  settingsApi: {
    settings: (...args: any[]) => (posApi.settings as any)(...args),
    branches: (...args: any[]) => (posApi.branches as any)(...args),
    locations: (...args: any[]) => (posApi.locations as any)(...args),
  },
}));

vi.mock('@/lib/api/cash-drawer', () => ({
  cashDrawerApi: {
    listPage: vi.fn().mockResolvedValue({
      rows: [{ id: 'shift1', openedById: 'u1', openedByName: 'Tester', docNo: 'SH-01' }],
      totalCount: 1,
    }),
  },
}));

// Mock Auth Store for shifting context
vi.mock('@/stores/auth-store', () => {
  // Real POS queries intentionally fail closed without a tenant identity.
  // A cashier test must supply a legitimate tenant context, not disable isolation.
  const state = { user: { id: 'u1', tenantId: 'tenant-test', name: 'Tester', permissions: ['*'], roles: ['admin'] } };
  const useAuthStore = Object.assign(
    (selector?: (value: typeof state) => unknown) => typeof selector === 'function' ? selector(state) : state,
    { getState: () => state },
  );
  return { useAuthStore, isAdminUser: () => true };
});

vi.mock('@/lib/http', () => ({
  http: vi.fn(),
  ApiError: class ApiError extends Error {},
  APP_NETWORK_STATE_EVENT: 'zsystems:network-state',
}));

// Mock scrollIntoView
window.HTMLElement.prototype.scrollIntoView = vi.fn();

// Mock Audio
global.Audio = vi.fn().mockImplementation(() => ({
  play: vi.fn().mockResolvedValue(undefined),
  pause: vi.fn(),
  currentTime: 0,
})) as any;

describe('PosWorkspace - Weighted Barcodes', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    localStorage.removeItem('zsystems.react.pos.draft');
    vi.clearAllMocks();
    queryClient = createTestQueryClient();
    vi.mocked(posApi.customers).mockResolvedValue([]);
    vi.mocked(posApi.listHeldDrafts).mockResolvedValue([]);
    vi.mocked(cashDrawerApi.listPage).mockResolvedValue({
      rows: [{ id: 'shift1', openedById: 'u1', openedByName: 'Tester', docNo: 'SH-01', status: 'open' }],
      totalCount: 1,
    } as any);
    vi.mocked(posApi.branches).mockResolvedValue([
      { id: 'b1', name: 'فرع 1', salesStockMode: 'single_location', allowExternalSalesStock: false, defaultStockLocationId: 'l1' },
      { id: 'b2', name: 'فرع 2', salesStockMode: 'all_operational_locations', allowExternalSalesStock: false, defaultStockLocationId: 'l2' },
    ] as any);
    vi.mocked(posApi.locations).mockResolvedValue([
      { id: 'l1', name: 'مخزن 1', branchId: 'b1', locationType: 'internal_warehouse', isActive: true },
      { id: 'l2', name: 'مخزن 2', branchId: 'b2', locationType: 'internal_warehouse', isActive: true },
    ] as any);
    vi.mocked(posApi.settings).mockResolvedValue({
      weightedBarcodeEnabled: true,
      weightedBarcodePrefix: '20',
      weightedBarcodeProductCodeLength: 5,
      weightedBarcodeWeightDigits: 5,
      weightedBarcodeWeightDecimals: 3,
      allowNegativeStockSales: true,
      currentBranchId: 'b1',
    } as any);
    vi.mocked(posApi.lookupProducts).mockResolvedValue([
      { id: '1', name: 'dummy catalog item', barcode: '123', retailPrice: 10, costPrice: 5, stock: 10, units: [] } as any,
    ]);
  });

  afterEach(() => {
    cleanup();
    // A POS draft saved by one test must not hydrate the next cashier test.
    localStorage.removeItem('zsystems.react.pos.draft');
  });

  const renderWorkspace = () => {
    return render(
      <MemoryRouter>
        <QueryClientProvider client={queryClient}>
          <PosWorkspace />
        </QueryClientProvider>
      </MemoryRouter>
    );
  };

  it('sells an exact numeric retail barcode that resembles an invoice date', async () => {
    vi.mocked(posApi.lookupProducts).mockResolvedValue([{
      id: '22',
      name: 'صنف بتاريخ في الباركود',
      barcode: '261022123456',
      retailPrice: 40,
      costPrice: 20,
      stock: 10,
      units: [],
    } as any]);
    renderWorkspace();
    await waitFor(() => expect(screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...')).toBeInTheDocument());
    const input = screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...');
    fireEvent.change(input, { target: { value: '261022123456' } });
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter' });
    await waitFor(() => {
      expect(screen.getAllByText('صنف بتاريخ في الباركود').some((node) =>
        node.classList.contains('pos-cart-product-name'),
      )).toBe(true);
    });
  });

  it('adds product 00009 with qty 1.575 upon scanning 2000009015751 from an empty cache in single_location', async () => {
    // Setup API mock to return product 00009 ONLY when looking up '00009'
    vi.mocked(posApi.lookupProducts).mockImplementation(async (params: any = {}) => {
      if (params.barcode === '2000009015751' || params.q === '2000009015751') return [];
      
      if (params.barcode === '00009' || params.q === '9' || params.barcode === '9' || params.q === '00009') {
        return [{
          id: '9',
          name: 'جبنه رومي 00009',
          barcode: '00009',
          styleCode: null,
          categoryName: 'Dairy',
          retailPrice: 100,
          wholesalePrice: 90,
          globalStock: 10,
          stock: 10,
          units: [],
        } as any];
      }
      return [{ id: '1', name: 'صنف تجريبي 1', barcode: '123', retailPrice: 10, costPrice: 5, stock: 10, units: [] } as any];
    });

    renderWorkspace();

    // Wait for initial load
    await waitFor(() => {
      expect(screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...')).toBeInTheDocument();
      expect(screen.queryByText('أضف صنفًا واحدًا على الأقل قبل بدء البيع.')).not.toBeInTheDocument();
    });
    
    // Give settingsQuery a tiny moment to resolve
    await new Promise(r => setTimeout(r, 50));

    const searchInput = screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...');
    
    // Simulate scanner
    fireEvent.change(searchInput, { target: { value: '2000009015751' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    // Wait for the item to be added to cart
    await waitFor(() => {
      const addedItemName = screen.getByText('جبنه رومي 00009');
      expect(addedItemName).toBeInTheDocument();
    });

    // Check quantity is 1.575
    // POS can render multiple quantity controls (cart + editor); assert the scanned line exists.
    const quantityInputs = screen.getAllByLabelText('الكمية');
    expect(quantityInputs.some((element) => (element as HTMLInputElement).value === '1.575')).toBe(true);

    expect(posApi.lookupProducts).toHaveBeenCalledWith(expect.objectContaining({
      barcode: '00009',
      branchId: 'b1',
      locationId: 'l1',
    }));
  });

  it('adds product 00002 with qty 0.135 upon scanning 2000002001355 in all_operational_locations', async () => {
    // Override settings to use branch b2 (all_operational_locations)
    vi.mocked(posApi.settings).mockResolvedValue({
      weightedBarcodeEnabled: true,
      weightedBarcodePrefix: '20',
      weightedBarcodeProductCodeLength: 5,
      weightedBarcodeWeightDigits: 5,
      weightedBarcodeWeightDecimals: 3,
      allowNegativeStockSales: true,
      currentBranchId: 'b2'
    } as any);

    vi.mocked(posApi.lookupProducts).mockImplementation(async (params: any = {}) => {
      if (params.barcode === '2000002001355' || params.q === '2000002001355') return [];
      if (params.barcode === '00002' || params.q === '2' || params.barcode === '2' || params.q === '00002') {
        return [{
          id: '2',
          name: 'جبنه شيدر 00002',
          barcode: '00002',
          styleCode: null,
          categoryName: 'Dairy',
          retailPrice: 200,
          wholesalePrice: 180,
          globalStock: 5,
          stock: 5,
          units: [],
        } as any];
      }
      return [{ id: '1', name: 'صنف تجريبي 1', barcode: '123', retailPrice: 10, costPrice: 5, stock: 10, units: [] } as any];
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...')).toBeInTheDocument();
      expect(screen.queryByText('أضف صنفًا واحدًا على الأقل قبل بدء البيع.')).not.toBeInTheDocument();
    });
    await new Promise(r => setTimeout(r, 50));

    const searchInput = screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...');
    
    // Simulate scanner
    fireEvent.change(searchInput, { target: { value: '2000002001355' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      const addedItemName = screen.getByText('جبنه شيدر 00002');
      expect(addedItemName).toBeInTheDocument();
    });

    const qtyInputs = screen.getAllByLabelText('الكمية');
    expect(qtyInputs.some((input) => (input as HTMLInputElement).value === '0.135')).toBe(true);

    expect(posApi.lookupProducts).toHaveBeenCalledWith(expect.objectContaining({
      barcode: '00002',
      branchId: 'b2',
    }));
  });

  it('displays the correct error message if the weighted barcode product does not exist in backend', async () => {
    vi.mocked(posApi.lookupProducts).mockImplementation(async (params: any = {}) => {
      if (params.barcode === '00009' || params.q === '00009' || params.q === '9' || params.barcode === '2000009015751') {
        return [];
      }
      return [{ id: '1', name: 'صنف تجريبي 1', barcode: '123', retailPrice: 10, costPrice: 5, stock: 10, units: [] } as any];
    });

    renderWorkspace();

    await waitFor(() => {
      expect(screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...')).toBeInTheDocument();
      expect(screen.queryByText('أضف صنفًا واحدًا على الأقل قبل بدء البيع.')).not.toBeInTheDocument();
    });
    await new Promise(r => setTimeout(r, 50));

    const searchInput = screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...');
    
    // Simulate scanner for a non-existent weighted product
    fireEvent.change(searchInput, { target: { value: '2000009015751' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('باركود ميزان: لم يتم العثور على كود الصنف 00009.')).toBeInTheDocument();
    });
  });

  it('resolves unpadded DB barcode 9 via exact barcode lookup without calling generic q search', async () => {
    vi.mocked(posApi.lookupProducts).mockImplementation(async (params: any = {}) => {
      if (params.q === '9') throw new Error('Should not fall back to generic q text search');
      if (params.barcode === '9') {
        return [{
          id: '9',
          name: 'رومي غير مبطن 9',
          barcode: '9',
          sku: 'R-9',
          retailPrice: 120,
          wholesalePrice: 100,
          stock: 8,
          units: [],
        } as any];
      }
      return [];
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...')).toBeInTheDocument());
    await new Promise(r => setTimeout(r, 50));

    const searchInput = screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...');
    fireEvent.change(searchInput, { target: { value: '2000009015751' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('رومي غير مبطن 9')).toBeInTheDocument();
    });
    expect(posApi.lookupProducts).not.toHaveBeenCalledWith(expect.objectContaining({ q: '9' }));
    expect(posApi.lookupProducts).toHaveBeenCalledWith(expect.objectContaining({ barcode: '9' }));
  });

  it('auto-submits a weighted barcode on rapid scanner bursts even when the scanner omits Enter', async () => {
    vi.mocked(posApi.lookupProducts).mockImplementation(async (params: any = {}) => {
      if (params.barcode === '00009') {
        return [{
          id: '9',
          name: 'جبنه ميزان أوتو',
          barcode: '00009',
          retailPrice: 100,
          stock: 10,
          units: [],
        } as any];
      }
      return [];
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...')).toBeInTheDocument());
    await new Promise(r => setTimeout(r, 80));

    const searchInput = screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...');
    fireEvent.change(searchInput, { target: { value: '20' } });
    await new Promise(r => setTimeout(r, 5));
    fireEvent.change(searchInput, { target: { value: '2000009' } });
    await new Promise(r => setTimeout(r, 5));
    fireEvent.change(searchInput, { target: { value: '20000090157' } });
    await new Promise(r => setTimeout(r, 5));
    fireEvent.change(searchInput, { target: { value: '2000009015751' } });

    await waitFor(() => {
      expect(screen.getByText('جبنه ميزان أوتو')).toBeInTheDocument();
    }, { timeout: 2000 });
  });

  it('preserves stock rejection message instead of overwriting with weighted not-found error', async () => {
    vi.mocked(posApi.settings).mockResolvedValue({
      weightedBarcodeEnabled: true,
      weightedBarcodePrefix: '20',
      weightedBarcodeProductCodeLength: 5,
      weightedBarcodeWeightDigits: 5,
      weightedBarcodeWeightDecimals: 3,
      allowNegativeStockSales: false,
      currentBranchId: 'b1',
    } as any);
    vi.mocked(posApi.lookupProducts).mockImplementation(async (params: any = {}) => {
      if (params.barcode === '00009') {
        return [{
          id: '9',
          name: 'صنف رصيد صفر',
          barcode: '00009',
          retailPrice: 100,
          stock: 0,
          globalStock: 0,
          units: [],
        } as any];
      }
      return [];
    });

    renderWorkspace();
    await waitFor(() => expect(screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...')).toBeInTheDocument());
    await new Promise(r => setTimeout(r, 50));

    const searchInput = screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...');
    fireEvent.change(searchInput, { target: { value: '2000009015751' } });
    fireEvent.keyDown(searchInput, { key: 'Enter', code: 'Enter' });

    await waitFor(() => {
      expect(screen.getByText('المخزون غير متاح لهذا الصنف.')).toBeInTheDocument();
    });
    expect(screen.queryByText('باركود ميزان: لم يتم العثور على كود الصنف 00009.')).not.toBeInTheDocument();
  });
});
