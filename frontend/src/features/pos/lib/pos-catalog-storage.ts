import type { Product } from '@/types/domain';
import { normalizeArabicSearchKey, scoreArabicSearchRelevance } from '@/lib/arabic-normalization';
import { isLikelyBarcodeQuery } from './pos-product-lookup';
import { requestStoragePersistence } from '@/lib/storage-persistence';

const DB_NAME = 'zsystems_pos_catalog_db';
const DB_VERSION = 1;
const STORE_PRODUCTS = 'catalog_products';
const STORE_META = 'catalog_meta';

let dbInstance: IDBDatabase | null = null;
let dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDbSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  void requestStoragePersistence();
  if (dbInstance) return Promise.resolve(dbInstance);
  if (dbPromise) return dbPromise;

  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error('IndexedDB is not supported in this environment'));
  }

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      if (!db.objectStoreNames.contains(STORE_PRODUCTS)) {
        const productStore = db.createObjectStore(STORE_PRODUCTS, { keyPath: 'id' });
        productStore.createIndex('barcode', 'barcode', { unique: false });
        productStore.createIndex('name', 'name', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = (event.target as IDBOpenDBRequest).result;
      dbInstance.onversionchange = () => {
        dbInstance?.close();
        dbInstance = null;
        dbPromise = null;
      };
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      dbPromise = null;
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return dbPromise;
}

export async function saveCatalogToStorage(
  products: Product[],
  version: string,
  tenantId?: string,
  pendingSoldByProduct?: Map<string, number>,
): Promise<void> {
  if (!isIndexedDbSupported() || !products) return;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTS, STORE_META], 'readwrite');
      const productStore = tx.objectStore(STORE_PRODUCTS);
      const metaStore = tx.objectStore(STORE_META);

      productStore.clear();

      for (const product of products) {
        if (!product || !product.id) continue;
        const pid = String(product.id);
        const pendingDelta = pendingSoldByProduct?.get(pid) || 0;
        const adjustedStock =
          pendingDelta > 0 && typeof product.stock === 'number'
            ? Number((product.stock - pendingDelta).toFixed(4))
            : product.stock;
        productStore.put({
          ...product,
          id: pid,
          barcode: String(product.barcode || '').trim(),
          ...(typeof adjustedStock === 'number' ? { stock: adjustedStock } : {}),
        });
      }

      metaStore.put({ key: 'catalog_version', value: version, updatedAt: new Date().toISOString() });
      if (tenantId) {
        metaStore.put({ key: 'tenant_id', value: tenantId, updatedAt: new Date().toISOString() });
      }
      metaStore.put({ key: 'total_count', value: products.length, updatedAt: new Date().toISOString() });
      metaStore.put({ key: 'last_synced_at', value: new Date().toISOString(), updatedAt: new Date().toISOString() });

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[POS Storage] Failed to save catalog into IndexedDB:', err);
  }
}

export async function getStoredTenantIdFromStorage(): Promise<string | null> {
  if (!isIndexedDbSupported()) return null;
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const request = store.get('tenant_id');

      request.onsuccess = () => {
        resolve(request.result?.value ? String(request.result.value) : null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getCatalogVersionFromStorage(): Promise<string | null> {
  if (!isIndexedDbSupported()) return null;
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const request = store.get('catalog_version');

      request.onsuccess = () => {
        resolve(request.result?.value ? String(request.result.value) : null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function getCatalogCountFromStorage(): Promise<number> {
  if (!isIndexedDbSupported()) return 0;
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const request = store.get('total_count');

      request.onsuccess = () => {
        resolve(Number(request.result?.value || 0));
      };
      request.onerror = () => resolve(0);
    });
  } catch {
    return 0;
  }
}

export async function getLastSyncedAtFromStorage(): Promise<string | null> {
  if (!isIndexedDbSupported()) return null;
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const store = tx.objectStore(STORE_META);
      const request = store.get('last_synced_at');

      request.onsuccess = () => {
        resolve(request.result?.value ? String(request.result.value) : null);
      };
      request.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export function isPosCachedTenantCompatible(activeTenantId: string, storedTenantId: string | null): boolean {
  return Boolean(activeTenantId && storedTenantId && activeTenantId === storedTenantId);
}

export async function lookupProductByBarcodeFromStorage(rawCode: string, expectedTenantId?: string): Promise<Product | null> {
  if (expectedTenantId !== undefined) {
    const storedTenant = await getStoredTenantIdFromStorage();
    if (!isPosCachedTenantCompatible(expectedTenantId, storedTenant)) return null;
  }
  if (!isIndexedDbSupported() || !rawCode) return null;
  const cleanCode = rawCode.trim().toLowerCase();
  if (!cleanCode) return null;

  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const store = tx.objectStore(STORE_PRODUCTS);
      const barcodeIndex = store.index('barcode');

      const indexReq = barcodeIndex.get(cleanCode);
      indexReq.onsuccess = () => {
        if (indexReq.result) {
          resolve(indexReq.result as Product);
          return;
        }

        // Deep check for units barcode, serial numbers, styleCode
        const cursorReq = store.openCursor();
        cursorReq.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor) {
            resolve(null);
            return;
          }

          const product = cursor.value as Product;
          if (product.barcode && product.barcode.trim().toLowerCase() === cleanCode) {
            resolve(product);
            return;
          }

          if (product.sku && product.sku.trim().toLowerCase() === cleanCode) {
            resolve(product);
            return;
          }

          if ((product as any).matchedSerialNumber && String((product as any).matchedSerialNumber).trim().toLowerCase() === cleanCode) {
            resolve(product);
            return;
          }

          if (product.units && Array.isArray(product.units)) {
            const matchedUnit = product.units.find(
              (u) => u.barcode && u.barcode.trim().toLowerCase() === cleanCode,
            );
            if (matchedUnit) {
              resolve({
                ...product,
                matchedUnitId: String(matchedUnit.id),
                matchedUnit: {
                  id: String(matchedUnit.id),
                  name: matchedUnit.name,
                  multiplier: Number(matchedUnit.multiplier || 1),
                  barcode: matchedUnit.barcode,
                  isBaseUnit: Boolean(matchedUnit.isBaseUnit),
                  isSaleUnit: Boolean(matchedUnit.isSaleUnit),
                  isPurchaseUnit: Boolean(matchedUnit.isPurchaseUnit),
                },
              } as unknown as Product);
              return;
            }
          }

          cursor.continue();
        };

        cursorReq.onerror = () => resolve(null);
      };

      indexReq.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function searchCatalogFromStorage(rawTerm: string, limit: number = 50): Promise<Product[]> {
  if (!isIndexedDbSupported()) return [];
  const term = String(rawTerm || '').trim();

  try {
    const db = await openDb();

    // Fast-path for empty term: return first `limit` records
    if (!term) {
      return new Promise((resolve) => {
        const tx = db.transaction(STORE_PRODUCTS, 'readonly');
        const store = tx.objectStore(STORE_PRODUCTS);
        const results: Product[] = [];
        const cursorReq = store.openCursor();

        cursorReq.onsuccess = (event) => {
          const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
          if (!cursor || results.length >= limit) {
            resolve(results);
            return;
          }
          results.push(cursor.value as Product);
          cursor.continue();
        };

        cursorReq.onerror = () => resolve([]);
      });
    }

    // Fast-path for likely barcode
    if (isLikelyBarcodeQuery(term)) {
      const directMatch = await lookupProductByBarcodeFromStorage(term);
      if (directMatch) return [directMatch];
    }

    // Text query with normalized tokens
    const normalizedQuery = normalizeArabicSearchKey(term);
    if (!normalizedQuery) return [];

    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const store = tx.objectStore(STORE_PRODUCTS);
      const scoredResults: Array<{ product: Product; score: number }> = [];
      const cursorReq = store.openCursor();

      cursorReq.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor) {
          scoredResults.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return String(a.product.name || '').localeCompare(String(b.product.name || ''), 'ar');
          });
          resolve(scoredResults.slice(0, limit).map((entry) => entry.product));
          return;
        }

        const product = cursor.value as Product;
        const unitCodes: string[] = [];
        const unitNames: string[] = [];
        if (product.units && Array.isArray(product.units)) {
          for (const u of product.units) {
            if (u.barcode) unitCodes.push(String(u.barcode));
            if (u.name) unitNames.push(String(u.name));
          }
        }

        const score = scoreArabicSearchRelevance(
          product.name,
          term,
          [product.barcode, product.sku, product.styleCode, ...unitCodes],
          [(product as any).nameEn, product.color, product.size, ...unitNames],
        );

        if (score > 0) {
          scoredResults.push({ product, score });
        }

        cursor.continue();
      };

      cursorReq.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function getAllCatalogFromStorage(limit: number = 1200): Promise<Product[]> {
  if (!isIndexedDbSupported()) return [];
  try {
    const db = await openDb();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readonly');
      const store = tx.objectStore(STORE_PRODUCTS);
      const results: Product[] = [];
      const cursorReq = store.openCursor();

      cursorReq.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
        if (!cursor || results.length >= limit) {
          resolve(results);
          return;
        }
        results.push(cursor.value as Product);
        cursor.continue();
      };

      cursorReq.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function deductCatalogStockInStorage(
  deductions: Array<{ productId: string | number; baseQty: number }>,
  expectedTenantId?: string,
): Promise<void> {
  if (!isIndexedDbSupported() || !Array.isArray(deductions) || deductions.length === 0) return;
  if (expectedTenantId !== undefined) {
    const storedTenant = await getStoredTenantIdFromStorage();
    if (!isPosCachedTenantCompatible(expectedTenantId, storedTenant)) return;
  }

  const aggregated = new Map<string, number>();
  for (const entry of deductions) {
    const pid = String(entry.productId || '').trim();
    const qty = Number(entry.baseQty || 0);
    if (pid && qty > 0) {
      aggregated.set(pid, (aggregated.get(pid) || 0) + qty);
    }
  }
  if (aggregated.size === 0) return;

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_PRODUCTS, 'readwrite');
      const store = tx.objectStore(STORE_PRODUCTS);

      for (const [pid, delta] of aggregated.entries()) {
        const req = store.get(pid);
        req.onsuccess = () => {
          const existing = req.result as Product | undefined;
          if (existing && typeof existing.stock === 'number') {
            store.put({
              ...existing,
              stock: Number((existing.stock - delta).toFixed(4)),
            });
          }
        };
      }

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Non-fatal local stock adjustment
  }
}

export async function clearCatalogStorage(): Promise<void> {
  if (!isIndexedDbSupported()) return;
  try {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_PRODUCTS, STORE_META], 'readwrite');
      tx.objectStore(STORE_PRODUCTS).clear();
      tx.objectStore(STORE_META).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}
