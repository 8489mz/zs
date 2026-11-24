import { describe, expect, it, beforeEach } from 'vitest';
import {
  saveCatalogToStorage,
  getCatalogVersionFromStorage,
  getCatalogCountFromStorage,
  lookupProductByBarcodeFromStorage,
  searchCatalogFromStorage,
  getAllCatalogFromStorage,
  isPosCachedTenantCompatible,
} from './pos-catalog-storage';
import type { Product } from '@/types/domain';

// A lightweight in-memory mock for IndexedDB
function createMockIndexedDB() {
  const stores: Record<string, Map<string, any>> = {
    catalog_products: new Map(),
    catalog_meta: new Map(),
  };

  const mockDb = {
    objectStoreNames: {
      contains: (name: string) => name in stores,
    },
    createObjectStore: (name: string) => {
      stores[name] = new Map();
      return {
        createIndex: () => {},
      };
    },
    transaction: (_storeNames: string | string[], _mode: string) => {
      const tx = {
        objectStore: (name: string) => {
          const map = stores[name];
          return {
            clear: () => {
              map.clear();
            },
            put: (value: any) => {
              const key = value.key || value.id;
              map.set(String(key), value);
            },
            get: (key: string) => {
              const req: any = {
                result: map.get(String(key)),
                onsuccess: null,
                onerror: null,
              };
              setTimeout(() => {
                if (req.onsuccess) req.onsuccess({ target: req });
              }, 0);
              return req;
            },
            index: (_indexName: string) => ({
              get: (val: string) => {
                const found = Array.from(map.values()).find((v) => v.barcode === val);
                const req: any = {
                  result: found || null,
                  onsuccess: null,
                  onerror: null,
                };
                setTimeout(() => {
                  if (req.onsuccess) req.onsuccess({ target: req });
                }, 0);
                return req;
              },
            }),
            openCursor: () => {
              const entries = Array.from(map.values());
              let idx = 0;
              const req: any = {
                onsuccess: null,
                onerror: null,
              };

              function emitNext() {
                if (idx < entries.length) {
                  const currentVal = entries[idx];
                  const cursor = {
                    value: currentVal,
                    continue: () => {
                      idx++;
                      setTimeout(emitNext, 0);
                    },
                  };
                  if (req.onsuccess) req.onsuccess({ target: { result: cursor } });
                } else {
                  if (req.onsuccess) req.onsuccess({ target: { result: null } });
                }
              }

              setTimeout(emitNext, 0);
              return req;
            },
          };
        },
        set oncomplete(fn: any) {
          setTimeout(() => fn && fn(), 10);
        },
        set onerror(_fn: any) {},
        set onabort(_fn: any) {},
      };

      return tx;
    },
  };

  return {
    open: (_name: string, _version: number) => {
      const openReq: any = {
        result: mockDb,
        onsuccess: null,
        onerror: null,
        onupgradeneeded: null,
      };
      setTimeout(() => {
        if (openReq.onupgradeneeded) {
          openReq.onupgradeneeded({ target: openReq });
        }
        if (openReq.onsuccess) {
          openReq.onsuccess({ target: openReq });
        }
      }, 0);
      return openReq;
    },
  };
}

describe('POS cached catalog tenant isolation', () => {
  it('rejects unknown, legacy unscoped, and other-tenant caches', () => {
    expect(isPosCachedTenantCompatible('tenant-b', 'tenant-a')).toBe(false);
    expect(isPosCachedTenantCompatible('tenant-b', null)).toBe(false);
    expect(isPosCachedTenantCompatible('', 'tenant-b')).toBe(false);
    expect(isPosCachedTenantCompatible('tenant-b', 'tenant-b')).toBe(true);
  });
});

describe('pos-catalog-storage with mocked IndexedDB', () => {
  const sampleProducts: Product[] = [
    {
      id: '101',
      name: 'بيبسي كانز 330 مل',
      barcode: '62210001',
      retailPrice: 15,
      wholesalePrice: 13,
      costPrice: 10,
      stock: 50,
      minStock: 5,
      categoryId: '1',
      supplierId: '1',
      notes: '',
      units: [
        {
          id: 'u-1',
          name: 'كرتونة',
          multiplier: 24,
          barcode: '62210001-BOX',
          isBaseUnit: false,
          isSaleUnit: false,
          isPurchaseUnit: true,
        },
      ],
    },
    {
      id: '102',
      name: 'شيبسي عائلي بالجبنة',
      barcode: '62220002',
      retailPrice: 20,
      wholesalePrice: 18,
      costPrice: 14,
      stock: 30,
      minStock: 3,
      categoryId: '2',
      supplierId: '1',
      notes: '',
      units: [],
    },
  ];

  beforeEach(() => {
    (window as any).indexedDB = createMockIndexedDB();
  });

  it('saves catalog and reads version and total count', async () => {
    await saveCatalogToStorage(sampleProducts, 'v1500-1789650000');

    const version = await getCatalogVersionFromStorage();
    expect(version).toBe('v1500-1789650000');

    const count = await getCatalogCountFromStorage();
    expect(count).toBe(2);
  });

  it('looks up product by barcode and by unit barcode', async () => {
    await saveCatalogToStorage(sampleProducts, 'v1500-1789650000');

    const direct = await lookupProductByBarcodeFromStorage('62210001');
    expect(direct).not.toBeNull();
    expect(direct?.name).toBe('بيبسي كانز 330 مل');

    const unitMatch = await lookupProductByBarcodeFromStorage('62210001-box');
    expect(unitMatch).not.toBeNull();
    expect((unitMatch as any)?.matchedUnitId).toBe('u-1');
  });

  it('searches products with Arabic normalization', async () => {
    await saveCatalogToStorage(sampleProducts, 'v1500-1789650000');

    const matches = await searchCatalogFromStorage('بيبسى'); // 'ى' vs 'ي'
    expect(matches.length).toBe(1);
    expect(matches[0].id).toBe('101');

    const chipsMatches = await searchCatalogFromStorage('شيبسي بالجبنه'); // 'ه' vs 'ة'
    expect(chipsMatches.length).toBe(1);
    expect(chipsMatches[0].id).toBe('102');
  });

  it('ranks whole-word and decimal product matches ahead of substring matches without early cursor truncation', async () => {
    const richCatalog: Product[] = [
      { id: '1', name: 'شيبسي عائلي بالجبنة', barcode: '1001', retailPrice: 20, wholesalePrice: 18, costPrice: 14, stock: 30, minStock: 3, categoryId: '1', supplierId: '1', notes: '', units: [] },
      { id: '2', name: 'لبن جهينة كامل الدسم', barcode: '1002', retailPrice: 40, wholesalePrice: 36, costPrice: 30, stock: 25, minStock: 3, categoryId: '1', supplierId: '1', notes: '', units: [] },
      { id: '3', name: 'بن العميد فاتح', barcode: '1003', retailPrice: 120, wholesalePrice: 110, costPrice: 95, stock: 15, minStock: 2, categoryId: '1', supplierId: '1', notes: '', units: [] },
      { id: '4', name: 'كرتونه باهي 1.5 ك', barcode: '1004', retailPrice: 90, wholesalePrice: 80, costPrice: 70, stock: 12, minStock: 2, categoryId: '2', supplierId: '1', notes: '', units: [] },
    ];
    await saveCatalogToStorage(richCatalog, 'v1501-1789650001');

    // Even with limit = 1, whole-word "بن العميد فاتح" (id 3) must beat earlier cursor rows "بالجبنة" (id 1) and "لبن" (id 2)
    const topCoffee = await searchCatalogFromStorage('بن', 1);
    expect(topCoffee.length).toBe(1);
    expect(topCoffee[0].id).toBe('3');

    const decimalMatch = await searchCatalogFromStorage('باهي 1.5', 5);
    expect(decimalMatch.map((p) => p.id)).toEqual(['4']);
  });

  it('retrieves all catalog products', async () => {
    await saveCatalogToStorage(sampleProducts, 'v1500-1789650000');

    const all = await getAllCatalogFromStorage(10);
    expect(all.length).toBe(2);
  });
});
