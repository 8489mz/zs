import { render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { formatCurrency } from '@/lib/format';
import { InventoryReportSection } from '@/features/reports/components/sections/InventoryReportSection';

function cardValue(label: string): string {
  const card = screen.getByText(label).closest('.report-metric-card');
  if (!card) throw new Error(`${label} card not found`);
  const value = card.querySelector('.report-metric-value');
  if (!value) throw new Error(`${label} value not found`);
  return value.textContent ?? '';
}

/* Dead-stock summary cards render as plain label/value div pairs (no
metric-card classes): the value div is the label div's next sibling. */
function deadStockCardValue(label: string): string {
  const labelEl = screen.getByText(label);
  const valueEl = labelEl.parentElement?.children[1];
  if (!valueEl) throw new Error(`${label} value not found`);
  return valueEl.textContent ?? '';
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

  /*
  Pins the full-set dead-stock totals (INV-DEAD-STOCK-FULL-TOTALS).
  Live on test10k, 10,499 dead items each holding 2 units showed "20 units /
  5,340.00 tied capital" — the reduce() over the visible 10-row page only.
  The cards must show the full-set summary from the dedicated dead-stock
  endpoint (20,998 units / 5,340,000.00) on every page, regardless of the
  page size or the visible rows. Restoring the rows.reduce() code fails
  this test (it would render 20 / 5,340.00 again).
  */
  it('shows full-set dead-stock totals from the dead-stock summary, not the visible-page sums', () => {
    const pageRows = Array.from({ length: 10 }, (_, i) => ({
      id: `p-${i + 1}`,
      name: `صنف ${i + 1}`,
      category: 'بقالة',
      supplier: 'المورد أ',
      stock: 2,
      minStock: 0,
      costPrice: 267,
      retailPrice: 400,
      status: 'dead',
      topLocationName: 'المخزن الرئيسي',
      topLocationQty: 2,
    }));
    render(
      <InventoryReportSection
        inventoryQuery={{
          isLoading: false,
          isError: false,
          error: null,
          data: {
            rows: pageRows,
            summary: { totalItems: 10499, outOfStock: 0, lowStock: 0, healthy: 0 },
            pagination: { page: 1, pageSize: 10, totalItems: 10499, totalPages: 1050, rangeStart: 1, rangeEnd: 10 },
          },
        }}
        deadStockQuery={{
          isLoading: false,
          isError: false,
          error: null,
          data: {
            items: [],
            pagination: { page: 1, pageSize: 20, totalItems: 10499, totalPages: 525, rangeStart: 1, rangeEnd: 20 },
            summary: {
              totalDeadProducts: 10499,
              totalDeadStockUnits: 20998,
              totalTiedCapital: 5340000,
              cutoffDays: 60,
            },
          },
        }}
        exportLowStock={vi.fn()}
        printInventoryValueReport={vi.fn()}
        printInventoryMovementsReport={vi.fn()}
        locationId="all"
        inventorySearch=""
        onInventorySearchChange={vi.fn()}
        inventoryFilter="dead"
        onInventoryFilterChange={vi.fn()}
        deadStockDays={60}
        onDeadStockDaysChange={vi.fn()}
        onInventoryPageChange={vi.fn()}
        onInventoryPageSizeChange={vi.fn()}
        onInventoryFiltersReset={vi.fn()}
      />,
    );

    expect(screen.getByText('أصناف راكدة')).toBeInTheDocument();
    expect(deadStockCardValue('أصناف راكدة')).toBe('10499 صنف');
    expect(deadStockCardValue('إجمالي الوحدات المعطلة')).toBe('20998 وحدة');
    expect(deadStockCardValue('رأس المال المجمد التقديري')).toBe(formatCurrency(5340000));
    // The visible-page sums (10 rows x 2 units, 5,340.00 capital) must not
    // appear as the summary totals.
    expect(deadStockCardValue('إجمالي الوحدات المعطلة')).not.toBe('20 وحدة');
    expect(deadStockCardValue('رأس المال المجمد التقديري')).not.toBe(formatCurrency(5340));
  });

  /*
  Pins the status labels (INV-INVENTORY-REPORT-OUT-CODE). The status column
  rendered the backend's raw code as-is, so an out-of-stock item showed the
  literal word "out" in the الحالة column. Known codes now show their
  understandable label ('out' -> نافد, 'low' -> منخفض, 'ok' -> سليم) and
  an unknown code passes through unchanged instead of rendering blank.
  Restoring the raw `row.status || 'ok'` cell fails this test (the table
  would contain "out" again). Assertions are scoped to the table because
  the same labels also appear on the metric cards and the filter select.
  */
  it('shows status labels in the status column, never the raw out/low/ok codes', () => {
    const rows = [
      { id: 'p-out', name: 'صنف نافد', category: 'بقالة', supplier: 'المورد أ', stock: 0, minStock: 5, status: 'out', topLocationName: 'المخزن الرئيسي', topLocationQty: 0, locationsLabel: '—' },
      { id: 'p-low', name: 'صنف منخفض', category: 'بقالة', supplier: 'المورد أ', stock: 2, minStock: 5, status: 'low', topLocationName: 'المخزن الرئيسي', topLocationQty: 2, locationsLabel: 'المخزن الرئيسي (الفرع الأول): 2' },
      { id: 'p-ok', name: 'صنف سليم', category: 'بقالة', supplier: 'المورد أ', stock: 20, minStock: 5, status: 'ok', topLocationName: 'المخزن الرئيسي', topLocationQty: 20, locationsLabel: 'المخزن الرئيسي (الفرع الأول): 20' },
      { id: 'p-unknown', name: 'صنف بحالة جديدة', category: 'بقالة', supplier: 'المورد أ', stock: 3, minStock: 5, status: 'archived', topLocationName: 'المخزن الرئيسي', topLocationQty: 3, locationsLabel: 'المخزن الرئيسي (الفرع الأول): 3' },
    ];
    render(
      <InventoryReportSection
        inventoryQuery={{
          isLoading: false,
          isError: false,
          error: null,
          data: {
            rows,
            summary: { totalItems: 4, outOfStock: 1, lowStock: 1, healthy: 1, trackedLocations: 1, locationHighlights: [] },
            pagination: { page: 1, pageSize: 20, totalItems: 4, totalPages: 1, rangeStart: 1, rangeEnd: 4 },
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

    const table = within(screen.getByRole('table'));
    expect(table.getByText('نافد')).toBeInTheDocument();
    expect(table.getByText('منخفض')).toBeInTheDocument();
    expect(table.getByText('سليم')).toBeInTheDocument();
    expect(table.getByText('archived')).toBeInTheDocument();
    expect(table.queryByText('out')).not.toBeInTheDocument();
    expect(table.queryByText('low')).not.toBeInTheDocument();
    expect(table.queryByText('ok')).not.toBeInTheDocument();
  });
});
