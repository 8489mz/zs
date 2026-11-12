import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosProductsPanel } from './PosProductsPanel';
import type { Product } from '@/types/domain';

// Render-count probe: every product card formats its price label with exactly
// one formatCurrencyWithCode call per render (single-product groups have
// minPrice === maxPrice), and no other code on this render path calls it
// while no variant picker is open. The call count therefore equals the
// number of card renders. The wrapper delegates to the real implementation,
// so prices on screen stay real.
const formatSpy = vi.hoisted(() => vi.fn());
vi.mock('@/lib/format', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/format')>();
  const wrapped = (...args: Parameters<typeof actual.formatCurrencyWithCode>) => {
    formatSpy(...args);
    return actual.formatCurrencyWithCode(...args);
  };
  return { ...actual, formatCurrencyWithCode: wrapped };
});

function renderWithClient(ui: React.ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // Pre-seed the queries the panel reads so no fetch fires after mount and
  // re-renders the panel behind the probe's back.
  client.setQueryData(['settings'], {});
  client.setQueryData(['pos-categories'], []);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function createProduct(index: number): Product {
  const suffix = String(index).padStart(3, '0');
  return {
    id: `product-${suffix}`,
    name: `Product ${suffix}`,
    barcode: `barcode-${suffix}`,
    categoryId: 'category-1',
    supplierId: 'supplier-1',
    costPrice: 10,
    retailPrice: 20,
    wholesalePrice: 18,
    stock: 10,
    minStock: 1,
    notes: '',
    units: [],
  };
}

function panelProps(products: Product[], onAddProduct: (product: Product) => void) {
  return {
    search: '',
    onSearchChange: vi.fn(),
    onSearchSubmitFirstResult: () => false,
    priceType: 'retail' as const,
    onPriceTypeChange: vi.fn(),
    products,
    recentProducts: [] as Product[],
    onAddProduct,
    productFilter: 'all' as const,
    onProductFilterChange: vi.fn(),
    searchInputRef: createRef<HTMLInputElement>(),
    // touch mode: the grid renders without a search query (scanner mode
    // hides results until >= 2 characters are typed).
    posMode: 'touch' as const,
  };
}

// The panel re-renders once after mount (usePosUiCustomization applies its
// resolved customization in an effect), so each test calibrates the probe on
// mount, then clears it and measures only the delta of the step under test.
function calibrateProbe() {
  expect(formatSpy.mock.calls.length).toBeGreaterThanOrEqual(3);
  formatSpy.mockClear();
}

describe('PosProductsPanel card memo', () => {
  it('does not re-render cards when the panel re-renders with equal product values', () => {
    const onAddProduct = vi.fn();
    const products = [createProduct(1), createProduct(2), createProduct(3)];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(['settings'], {});
    client.setQueryData(['pos-categories'], []);
    const renderPanel = (items: Product[]) => (
      <QueryClientProvider client={client}>
        <PosProductsPanel {...panelProps(items, onAddProduct)} />
      </QueryClientProvider>
    );

    const { rerender } = render(renderPanel(products));

    expect(screen.getByText('Product 001')).toBeInTheDocument();
    expect(screen.getByText('Product 002')).toBeInTheDocument();
    expect(screen.getByText('Product 003')).toBeInTheDocument();
    calibrateProbe();

    // New array identity, fresh product objects, identical values: this
    // defeats the panel-level memo (products !== products) so the panel
    // really re-renders, but no card's data changed.
    const equalProducts = products.map((product) => ({ ...product }));
    rerender(renderPanel(equalProducts));

    expect(screen.getByText('Product 001')).toBeInTheDocument();
    expect(formatSpy.mock.calls.length).toBe(0);
  });

  it('re-renders only the card whose props change', async () => {
    const user = userEvent.setup();
    const onAddProduct = vi.fn();
    const products = [createProduct(1), createProduct(2), createProduct(3)];

    renderWithClient(<PosProductsPanel {...panelProps(products, onAddProduct)} />);

    expect(screen.getByText('Product 001')).toBeInTheDocument();
    calibrateProbe();

    const favoriteButtons = screen.getAllByRole('button', { name: 'إضافة إلى المفضلة' });
    expect(favoriteButtons).toHaveLength(3);
    await user.click(favoriteButtons[0]);

    // Only the favorited card re-rendered (one extra price-format call);
    // the other two cards kept their render output.
    expect(formatSpy.mock.calls.length).toBe(1);
    expect(screen.getAllByRole('button', { name: 'إزالة من المفضلة' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'إضافة إلى المفضلة' })).toHaveLength(2);
  });
});
