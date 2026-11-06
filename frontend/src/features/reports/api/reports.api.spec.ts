import { describe, expect, it, vi } from 'vitest';
import { reportsApi } from '@/features/reports/api/reports.api';

const { httpMock } = vi.hoisted(() => ({ httpMock: vi.fn() }));

vi.mock('@/lib/http', () => ({
  http: httpMock,
}));

describe('reportsApi.inventoryPage', () => {
  it('maps stockQty and location metadata into stable report rows', async () => {
    httpMock.mockResolvedValueOnce({
      items: [
        {
          id: 'p-1',
          name: 'أرز',
          stockQty: 8,
          minStock: 10,
          category: 'بقالة',
          supplier: 'المورد ب',
          status: 'low',
          topLocationName: 'المخزن الرئيسي',
          topLocationQty: 5,
          locationsLabel: 'المخزن الرئيسي (الفرع الأول): 5 • المخزن الخلفي (الفرع الأول): 3',
          assignedQty: 8,
          unassignedQty: 0,
          locations: [
            { locationId: '10', locationName: 'المخزن الرئيسي', branchId: '1', branchName: 'الفرع الأول', qty: 5 },
          ],
        },
      ],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1, rangeStart: 1, rangeEnd: 1 },
      summary: { totalItems: 1, outOfStock: 0, lowStock: 1, healthy: 0, trackedLocations: 2 },
      locationHighlights: [
        { locationId: '10', locationName: 'المخزن الرئيسي', branchId: '1', branchName: 'الفرع الأول', totalQty: 5, trackedProducts: 2, attentionItems: 1, lowStockItems: 1, outOfStockItems: 0 },
      ],
    });

    const result = await reportsApi.inventoryPage({ filter: 'attention' });

    expect(result.rows[0].stock).toBe(8);
    expect(result.rows[0].topLocationName).toBe('المخزن الرئيسي');
    expect(result.rows[0].locations?.[0]?.qty).toBe(5);
    expect(result.summary.locationHighlights?.[0]?.locationName).toBe('المخزن الرئيسي');
    expect(result.summary.trackedLocations).toBe(2);
  });
});

describe('reportsApi.deadStock', () => {
  /*
  Pins the backend/frontend summary field-name reconciliation
  (INV-DEAD-STOCK-FULL-TOTALS). The backend returns
  { totalDeadItems, totalDeadStockQty, totalTiedCapital, totalRetailValue,
  daysThreshold } while the frontend DeadStockResponse expects
  { totalDeadProducts, totalDeadStockUnits, totalTiedCapital, cutoffDays };
  only totalTiedCapital matches. Wiring the endpoint without this mapping
  would render the units/products counts as undefined.
  */
  it('maps backend dead-stock summary and item fields onto DeadStockResponse names', async () => {
    httpMock.mockResolvedValueOnce({
      items: [
        {
          id: 7,
          name: 'سماعات بلوتوث',
          barcode: '622000000007',
          categoryName: 'إلكترونيات',
          supplierName: 'المورد أ',
          stock: 2,
          costPrice: 267,
          retailPrice: 400,
          tiedCapital: 534,
          daysWithoutSale: 61,
          lastSaleDate: '2026-09-05T10:00:00.000Z',
        },
      ],
      pagination: { page: 1, pageSize: 20, totalItems: 10499, totalPages: 525, rangeStart: 1, rangeEnd: 20 },
      summary: {
        totalDeadItems: 10499,
        totalDeadStockQty: 20998,
        totalTiedCapital: 5340000,
        totalRetailValue: 8000000,
        daysThreshold: 60,
      },
    });

    const result = await reportsApi.deadStock({ days: 60 });

    expect(result.summary.totalDeadProducts).toBe(10499);
    expect(result.summary.totalDeadStockUnits).toBe(20998);
    expect(result.summary.totalTiedCapital).toBe(5340000);
    expect(result.summary.cutoffDays).toBe(60);
    expect(result.items[0].category).toBe('إلكترونيات');
    expect(result.items[0].supplier).toBe('المورد أ');
    expect(result.items[0].stockQty).toBe(2);
    expect(result.items[0].daysSinceLastSale).toBe(61);
    expect(result.items[0].lastSaleAt).toBe('2026-09-05T10:00:00.000Z');
  });
});
