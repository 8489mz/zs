import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef, useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PosProductsPanel } from './PosProductsPanel';
import type { Product } from '@/types/domain';

function renderWithClient(ui: React.ReactElement, settings?: Record<string, any>, categories?: Array<{ id: string; name: string }>) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (settings) {
    client.setQueryData(['settings'], settings);
  }
  if (categories) {
    client.setQueryData(['pos-categories'], categories);
  }
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

describe('PosProductsPanel', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });

  it('caps touch mode results by default and reveals more products on demand', async () => {
    const user = userEvent.setup();
    const products = Array.from({ length: 85 }, (_, index) => createProduct(index + 1));

    renderWithClient(
      <PosProductsPanel
        search=""
        onSearchChange={vi.fn()}
        onSearchSubmitFirstResult={() => false}
        priceType="retail"
        onPriceTypeChange={vi.fn()}
        products={products}
        recentProducts={[]}
        onAddProduct={vi.fn()}
        productFilter="all"
        onProductFilterChange={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        posMode="touch"
      />,
    );

    expect(screen.getByText('Product 060')).toBeInTheDocument();
    expect(screen.queryByText('Product 061')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'عرض المزيد' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'عرض المزيد' }));

    expect(screen.getByText('Product 061')).toBeInTheDocument();
    expect(screen.getByText('Product 085')).toBeInTheDocument();
  });

  it('uses the current input value on Enter and does not fall back to the previously selected product', async () => {
    const user = userEvent.setup();
    const onSearchSubmitFirstResult = vi.fn(() => false);
    const onAddProduct = vi.fn();
    const products = Array.from({ length: 3 }, (_, index) => createProduct(index + 1));

    renderWithClient(
      <PosProductsPanel
        search="barcode-002"
        onSearchChange={vi.fn()}
        onSearchSubmitFirstResult={onSearchSubmitFirstResult}
        priceType="retail"
        onPriceTypeChange={vi.fn()}
        products={products}
        recentProducts={[]}
        onAddProduct={onAddProduct}
        productFilter="all"
        onProductFilterChange={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        posMode="scanner"
      />,
    );

    await user.click(screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...'));
    await user.keyboard('{Enter}');

    expect(onSearchSubmitFirstResult).toHaveBeenCalledWith('barcode-002');
    expect(onAddProduct).not.toHaveBeenCalled();
  });

  it('dims out-of-stock items and prevents adding them to cart when negative sales are disabled', async () => {
    const user = userEvent.setup();
    const onAddProduct = vi.fn();
    const inStock = { ...createProduct(1), stock: 10 };
    const outOfStock = { ...createProduct(2), stock: 0 };

    renderWithClient(
      <PosProductsPanel
        search=""
        onSearchChange={vi.fn()}
        onSearchSubmitFirstResult={() => false}
        priceType="retail"
        onPriceTypeChange={vi.fn()}
        products={[inStock, outOfStock]}
        recentProducts={[]}
        onAddProduct={onAddProduct}
        productFilter="all"
        onProductFilterChange={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        posMode="touch"
      />,
      { allowNegativeStockSales: false, posHideOutOfStockItems: false }
    );

    expect(screen.getByText('Product 001')).toBeInTheDocument();
    expect(screen.getByText('Product 002')).toBeInTheDocument();
    expect(screen.getAllByText('نفد').length).toBeGreaterThan(0);

    const outOfStockButton = screen.getByText('Product 002').closest('button');
    expect(outOfStockButton).toBeTruthy();
    if (outOfStockButton) {
      await user.click(outOfStockButton);
      expect(onAddProduct).not.toHaveBeenCalled();
    }
  });

  it('hides out-of-stock items when posHideOutOfStockItems is enabled in settings', () => {
    const inStock = { ...createProduct(1), stock: 10 };
    const outOfStock = { ...createProduct(2), stock: 0 };

    renderWithClient(
      <PosProductsPanel
        search=""
        onSearchChange={vi.fn()}
        onSearchSubmitFirstResult={() => false}
        priceType="retail"
        onPriceTypeChange={vi.fn()}
        products={[inStock, outOfStock]}
        recentProducts={[]}
        onAddProduct={vi.fn()}
        productFilter="all"
        onProductFilterChange={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        posMode="touch"
      />,
      { allowNegativeStockSales: false, posHideOutOfStockItems: true }
    );

    expect(screen.getByText('Product 001')).toBeInTheDocument();
    expect(screen.queryByText('Product 002')).not.toBeInTheDocument();
  });

  // INV-SERVICE-STOCK-NO-STOCK-CHECK (spice trial D02): a grinding
  // service is unsellable with "الصنف نافذ من المخزون" at stock 0.
  // isOutOfStockGroup tested group.itemKind === 'service', but
  // itemKind is only standard|fashion — the service kind lives on
  // itemType — so service groups fell through to totalStock <= 0.
  it('sells a zero-stock service: clicking it adds it to the cart instead of warning out of stock', async () => {
    const user = userEvent.setup();
    const onAddProduct = vi.fn();
    const service = { ...createProduct(1), name: 'Grinding 001', stock: 0, itemType: 'service' as const };

    renderWithClient(
      <PosProductsPanel
        search=""
        onSearchChange={vi.fn()}
        onSearchSubmitFirstResult={() => false}
        priceType="retail"
        onPriceTypeChange={vi.fn()}
        products={[service]}
        recentProducts={[]}
        onAddProduct={onAddProduct}
        productFilter="all"
        onProductFilterChange={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        posMode="touch"
      />,
      { allowNegativeStockSales: false, posHideOutOfStockItems: false }
    );

    expect(screen.getByText('Grinding 001')).toBeInTheDocument();
    expect(screen.queryAllByText('نفد')).toHaveLength(0);

    const serviceButton = screen.getByText('Grinding 001').closest('button');
    expect(serviceButton).toBeTruthy();
    if (serviceButton) {
      await user.click(serviceButton);
      expect(onAddProduct).toHaveBeenCalledTimes(1);
      expect(onAddProduct).toHaveBeenCalledWith(expect.objectContaining({ id: service.id }));
    }
  });

  it('keeps a zero-stock service listed when out-of-stock items are hidden', () => {
    const service = { ...createProduct(1), name: 'Grinding 001', stock: 0, itemType: 'service' as const };
    const outOfStock = { ...createProduct(2), stock: 0 };

    renderWithClient(
      <PosProductsPanel
        search=""
        onSearchChange={vi.fn()}
        onSearchSubmitFirstResult={() => false}
        priceType="retail"
        onPriceTypeChange={vi.fn()}
        products={[service, outOfStock]}
        recentProducts={[]}
        onAddProduct={vi.fn()}
        productFilter="all"
        onProductFilterChange={vi.fn()}
        searchInputRef={createRef<HTMLInputElement>()}
        posMode="touch"
      />,
      { allowNegativeStockSales: false, posHideOutOfStockItems: true }
    );

    expect(screen.getByText('Grinding 001')).toBeInTheDocument();
    expect(screen.queryByText('Product 002')).not.toBeInTheDocument();
  });

  it('suppresses on-screen keyboard by default on mobile screens and allows toggling it', async () => {
    const originalInnerWidth = window.innerWidth;
    const originalMatchMedia = window.matchMedia;
    window.innerWidth = 400;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: true,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    const user = userEvent.setup();

    try {
      renderWithClient(
        <PosProductsPanel
          search=""
          onSearchChange={vi.fn()}
          onSearchSubmitFirstResult={() => false}
          priceType="retail"
          onPriceTypeChange={vi.fn()}
          products={[]}
          recentProducts={[]}
          onAddProduct={vi.fn()}
          productFilter="all"
          onProductFilterChange={vi.fn()}
          searchInputRef={createRef<HTMLInputElement>()}
          posMode="touch"
        />,
      );

      const searchInput = screen.getByPlaceholderText('امسح باركود أو اكتب الاسم...');
      // By default on mobile, inputMode is none so soft keyboard does not pop up
      expect(searchInput).toHaveAttribute('inputmode', 'none');

      // Find mobile keyboard toggle button
      const keyboardBtn = document.querySelector('.pos-keyboard-toggle-btn') as HTMLElement;
      expect(keyboardBtn).toBeTruthy();

      // Click to enable keyboard
      await user.click(keyboardBtn);
      expect(searchInput).toHaveAttribute('inputmode', 'text');

      // Click again to suppress
      await user.click(keyboardBtn);
      expect(searchInput).toHaveAttribute('inputmode', 'none');
    } finally {
      window.innerWidth = originalInnerWidth;
      window.matchMedia = originalMatchMedia;
    }
  });

  it('INV-POS-CATEGORY-TILE-FILTER: clicking a category tile selects it and filters the grid to that category', async () => {
    const user = userEvent.setup();
    const inCategory = createProduct(1);
    const otherCategory = { ...createProduct(2), name: 'Other 002', categoryId: 'category-2' };
    function ControlledPanel() {
      const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
      return (
        <PosProductsPanel
          search=""
          onSearchChange={vi.fn()}
          onSearchSubmitFirstResult={() => false}
          priceType="retail"
          onPriceTypeChange={vi.fn()}
          products={[inCategory, otherCategory]}
          recentProducts={[]}
          onAddProduct={vi.fn()}
          productFilter="all"
          onProductFilterChange={vi.fn()}
          selectedCategoryId={selectedCategoryId}
          onSelectedCategoryIdChange={setSelectedCategoryId}
          searchInputRef={createRef<HTMLInputElement>()}
          posMode="touch"
        />
      );
    }

    renderWithClient(<ControlledPanel />, undefined, [
      { id: 'category-1', name: 'إلكترونيات' },
      { id: 'category-2', name: 'أدوات منزلية' },
    ]);

    expect(screen.getByText('Product 001')).toBeInTheDocument();
    expect(screen.getByText('Other 002')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'إلكترونيات' }));

    expect(screen.getByText('Product 001')).toBeInTheDocument();
    expect(screen.queryByText('Other 002')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'كل الأقسام' }));

    expect(screen.getByText('Product 001')).toBeInTheDocument();
    expect(screen.getByText('Other 002')).toBeInTheDocument();
  });
});
