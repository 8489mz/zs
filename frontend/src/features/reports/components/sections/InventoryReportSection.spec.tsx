import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { InventoryReportSection } from '@/features/reports/components/sections/InventoryReportSection';

function cardValue(label: string): string {
  const card = screen.getByText(label).closest('.report-metric-card');
  if (!card) throw new Error(`${label} card not found`);
  const value = card.querySelector('.report-metric-value');
  if (!value) throw new Error(`${label} value not found`);
  return value.textContent ?? '';
}

describe('InventoryReportSection', () => {
  it('renders location hotspots and row-level location breakdowns', () => {
    render(
      <InventoryReportSection
        inventoryQuery={{
          isLoading: false,
          isError: false,
          error: null,
          data: {
            rows: [
              {
                id: 'p-1',
                name: 'أرز',
                category: 'بقالة',
                supplier: 'المورد ب',
                stock: 8,
                minStock: 10,
                status: 'low',
                topLocationName: 'المخزن الرئيسي',
                topLocationQty: 5,
                locationsLabel: 'المخزن الرئيسي (الفرع الأول): 5 • المخزن الخلفي (الفرع الأول): 3',
              },
            ],
            summary: {
              totalItems: 1,
              outOfStock: 0,
              lowStock: 1,
              healthy: 0,
              trackedLocations: 2,
              locationHighlights: [
                {
                  locationId: '10',
                  locationName: 'المخزن الرئيسي',
                  branchId: '1',
                  branchName: 'الفرع الأول',
                  totalQty: 5,
                  trackedProducts: 2,
                  attentionItems: 1,
                  lowStockItems: 1,
                  outOfStockItems: 0,
                },
              ],
            },
            pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1, rangeStart: 1, rangeEnd: 1 },
          },
        }}
        exportLowStock={vi.fn()}
        printInventoryValueReport={vi.fn()}
        printInventoryMovementsReport={vi.fn()}
        locationId="all"
        inventorySearch=""
        onInventorySearchChange={vi.fn()}
        inventoryFilter="attention"
        onInventoryFilterChange={vi.fn()}
        onInventoryPageChange={vi.fn()}
        onInventoryPageSizeChange={vi.fn()}
        onInventoryFiltersReset={vi.fn()}
      />,
    );

    expect(screen.getByText('أكثر المخازن احتياجًا للمتابعة')).toBeInTheDocument();
    expect(screen.getAllByText('المخزن الرئيسي')[0]).toBeInTheDocument();
    expect(screen.getByText(/المخزن الخلفي/)).toBeInTheDocument();
  });

  /*
  Pins the inventory-value 0.20 (INV-REPORT-MONEY-DECIMALS).
  The "قيمة المخزون" card renders money through ReportMetricCard ->
  AnimatedValue, which rounds to `decimals` (default 0) before the currency
  formatter runs. A true 162,080,152.80 displayed as "162,080,153.00" while
  the pricing-center base showed the true value. Same display-rounding
  mechanism as the sales-report 0.20, never a data error. Money cards render
  at the tenant currency's decimals; count cards keep 0.
  */
  it('shows the true inventory value 162,080,152.80, not the whole-unit rounding', async () => {
    render(
      <InventoryReportSection
        inventoryQuery={{
          isLoading: false,
          isError: false,
          error: undefined,
          data: {
            rows: [],
            summary: { totalItems: 1, outOfStock: 0, lowStock: 0, healthy: 1 },
            pagination: { page: 1, pageSize: 10, totalItems: 1, totalPages: 1, rangeStart: 1, rangeEnd: 1 },
          },
        }}
        accountingInventoryValue={{
          totals: {
            totalInventoryValue: 162080152.8,
            totalRetailPotentialValue: 200000000.1,
            totalPotentialGrossMargin: 37919847.3,
            itemCount: 1,
            lowStockCount: 0,
            zeroStockCount: 0,
            negativeStockCount: 0,
          },
          items: [],
        }}
        exportLowStock={vi.fn()}
        printInventoryValueReport={vi.fn()}
        printInventoryMovementsReport={vi.fn()}
        locationId=""
        inventorySearch=""
        onInventorySearchChange={vi.fn()}
        inventoryFilter="attention"
        onInventoryFilterChange={vi.fn()}
        onInventoryPageChange={vi.fn()}
        onInventoryPageSizeChange={vi.fn()}
        onInventoryFiltersReset={vi.fn()}
      />,
    );

    await waitFor(() => expect(cardValue('قيمة المخزون')).toBe('162,080,152.80'), { timeout: 5000 });
    await waitFor(() => expect(cardValue('قيمة البيع التقديرية')).toBe('200,000,000.10'), { timeout: 5000 });
  });
});
