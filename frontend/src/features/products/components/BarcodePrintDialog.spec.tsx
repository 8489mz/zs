import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BarcodePrintDialog } from './BarcodePrintDialog';
import type { Product } from '@/types/domain';
import type { BarcodePrintItem } from '@/lib/barcode-labels';

window.HTMLElement.prototype.scrollIntoView = vi.fn() as unknown as typeof window.HTMLElement.prototype.scrollIntoView;

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string) => fallback ?? _key,
      i18n: { language: 'ar' },
    }),
  };
});

vi.mock('@/shared/hooks/use-catalog-queries', () => ({
  useSettingsQuery: () => ({
    data: {
      storeName: 'متجر الملابس',
      clothingModuleEnabled: true,
    },
  }),
}));

vi.mock('@/stores/auth-store', () => ({
  useAuthStore: (selector: (state: any) => any) =>
    selector({
      storeName: 'متجر الملابس',
      tenant: { id: 'tenant-1', slug: 'fashion', businessName: 'متجر الملابس' },
    }),
}));

vi.mock('@/features/pos/lib/hardware-bridge-client', () => ({
  HardwareBridgeClient: {
    listPrinters: vi.fn().mockResolvedValue({ success: false, printers: [] }),
  },
}));

function makeProduct(overrides: Partial<Product>): Product {
  return {
    id: 1,
    name: 'تيشيرت قطن',
    nameEn: 'Cotton Tee',
    barcode: '100001',
    salePrice: 250,
    stock: 3,
    isActive: true,
    ...overrides,
  } as Product;
}

describe('BarcodePrintDialog', () => {
  it('renders cleanly across closed -> open -> closed -> batch transitions without violating hook order', () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    const singleProduct = makeProduct({ id: 10, name: 'تيشيرت أبيض M', color: 'ابيض', size: 'M', barcode: '100010' });

    const batchItems: BarcodePrintItem[] = [
      { product: makeProduct({ id: 1, name: 'تيشيرت أسود XL', color: 'اسود', size: 'XL', barcode: '100001', stock: 2 }), copies: 2 },
      { product: makeProduct({ id: 2, name: 'تيشيرت أبيض M', color: 'ابيض', size: 'M', barcode: '100002', stock: 3 }), copies: 3 },
      { product: makeProduct({ id: 3, name: 'تيشيرت أزرق L', color: 'ازرق', size: 'L', barcode: '100003', stock: 0 }), copies: 1 },
    ];

    const wrap = (ui: React.ReactElement) => (
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    );

    const { rerender } = render(
      wrap(<BarcodePrintDialog open={false} product={null} onClose={vi.fn()} />),
    );

    // Reproduce ProductsPage opening modal after initial closed mount (pinned hook-order regression)
    rerender(
      wrap(<BarcodePrintDialog open={true} product={singleProduct} onClose={vi.fn()} />),
    );
    expect(screen.getByText('توليد وطباعة ملصقات الباركود والرف (Barcode & Shelf Labeling)')).toBeTruthy();

    // Close back to null product
    rerender(
      wrap(<BarcodePrintDialog open={false} product={null} onClose={vi.fn()} />),
    );

    // Open in batch mode with 3 fashion variants
    rerender(
      wrap(<BarcodePrintDialog open={true} items={batchItems} onClose={vi.fn()} />),
    );

    expect(screen.getByText('طباعة مجمعة: 3 من 3 صنف · إجمالي 6 ملصق')).toBeTruthy();

    // Isolate only the second variant via "هذا فقط"
    const onlyButtons = screen.getAllByRole('button', { name: 'هذا فقط' });
    expect(onlyButtons).toHaveLength(3);
    fireEvent.click(onlyButtons[1]);

    expect(screen.getByText('طباعة مجمعة: 1 من 3 صنف · إجمالي 3 ملصق')).toBeTruthy();
    expect(screen.getByText('الأصناف والكميات (1/3)')).toBeTruthy();

    // Zero all copies cleanly
    fireEvent.click(screen.getByRole('button', { name: 'تصفير الكل' }));
    expect(screen.getByText('طباعة مجمعة: 0 من 3 صنف · إجمالي 0 ملصق')).toBeTruthy();
  });
});
