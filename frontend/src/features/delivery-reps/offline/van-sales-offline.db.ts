import type { VanActiveTripResponse, VanStockItem, DriverWarehouse, DriverAvailableProduct } from '../api/van-sales.api';
import type { DriverPortalUser } from '@/shared/api/delivery-reps.api';
import { requestStoragePersistence } from '@/lib/storage-persistence';

const DB_NAME = 'zsystems_van_sales_offline_db';
const DB_VERSION = 1;

const STORE_META = 'van_meta';
const STORE_INVENTORY = 'van_inventory';
const STORE_CUSTOMERS = 'van_customers';
const STORE_OUTBOX = 'van_outbox';

export interface OfflineOutboxItem {
  clientTxId: string;
  type: 'sale' | 'collection' | 'return' | 'load_requisition';
  docNo: string;
  payload: any;
  createdAt: string;
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  errorMessage?: string;
}

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

      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }

      if (!db.objectStoreNames.contains(STORE_INVENTORY)) {
        const invStore = db.createObjectStore(STORE_INVENTORY, { keyPath: 'productId' });
        invStore.createIndex('barcode', 'barcode', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_CUSTOMERS)) {
        db.createObjectStore(STORE_CUSTOMERS, { keyPath: 'id' });
      }

      if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
        const outboxStore = db.createObjectStore(STORE_OUTBOX, { keyPath: 'clientTxId' });
        outboxStore.createIndex('status', 'status', { unique: false });
        outboxStore.createIndex('createdAt', 'createdAt', { unique: false });
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

function generateClientTxId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return 'tx_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
}

function getTodayYYMMDD(): string {
  const d = new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

export const vanOfflineDb = {
  /**
   * Save morning/online snapshot of active trip, inventory, and customers.
   */
  saveSnapshot: async (data: VanActiveTripResponse, session?: { token: string; rep: DriverPortalUser } | null): Promise<void> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_META, STORE_INVENTORY, STORE_CUSTOMERS], 'readwrite');
      const metaStore = tx.objectStore(STORE_META);
      const invStore = tx.objectStore(STORE_INVENTORY);
      const custStore = tx.objectStore(STORE_CUSTOMERS);

      metaStore.put({ key: 'active_trip_snapshot', value: data, updatedAt: new Date().toISOString() });
      if (session) {
        metaStore.put({ key: 'offline_session', value: session, updatedAt: new Date().toISOString() });
      }

      // Populate inventory
      if (Array.isArray(data.inventory)) {
        for (const item of data.inventory) {
          invStore.put(item);
        }
      }

      // Populate customers
      if (Array.isArray(data.customers)) {
        for (const cust of data.customers) {
          custStore.put(cust);
        }
      }

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[VanOfflineDB] Failed to save snapshot:', err);
    }
  },

  /**
   * Retrieve active trip when offline, hydrating latest local inventory & customers.
   */
  getOfflineActiveTrip: async (): Promise<VanActiveTripResponse | null> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_META, STORE_INVENTORY, STORE_CUSTOMERS], 'readonly');
      const metaStore = tx.objectStore(STORE_META);
      const invStore = tx.objectStore(STORE_INVENTORY);
      const custStore = tx.objectStore(STORE_CUSTOMERS);

      const snapReq = metaStore.get('active_trip_snapshot');
      const invReq = invStore.getAll();
      const custReq = custStore.getAll();

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });

      const snapshot = snapReq.result?.value as VanActiveTripResponse | undefined;
      if (!snapshot) return null;

      const localInventory = (invReq.result || []) as VanStockItem[];
      const localCustomers = custReq.result || [];

      return {
        ...snapshot,
        inventory: localInventory.length > 0 ? localInventory : snapshot.inventory,
        customers: localCustomers.length > 0 ? localCustomers : snapshot.customers,
      };
    } catch (err) {
      console.warn('[VanOfflineDB] Failed to get offline active trip:', err);
      return null;
    }
  },

  /**
   * Save session credentials for offline auto-login or PIN unlock.
   */
  saveOfflineSession: async (session: { token: string; rep: DriverPortalUser }, phone?: string, pin?: string): Promise<void> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_META], 'readwrite');
      const metaStore = tx.objectStore(STORE_META);
      metaStore.put({
        key: 'offline_session',
        value: session,
        phone: phone || session.rep?.phone,
        pin: pin || '',
        updatedAt: new Date().toISOString(),
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[VanOfflineDB] Failed to save offline session:', err);
    }
  },

  /**
   * Check if offline session exists for fast offline startup.
   */
  getOfflineSession: async (): Promise<{ token: string; rep: DriverPortalUser } | null> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_META], 'readonly');
      const metaStore = tx.objectStore(STORE_META);
      const req = metaStore.get('offline_session');
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return req.result?.value || null;
    } catch {
      return null;
    }
  },

  /**
   * Save itinerary list for offline browsing in VanItineraryTab.
   */
  saveItinerary: async (itinerary: any[]): Promise<void> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_META], 'readwrite');
      const metaStore = tx.objectStore(STORE_META);
      metaStore.put({
        key: 'itinerary_cache',
        value: itinerary,
        updatedAt: new Date().toISOString(),
      });
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[VanOfflineDB] Failed to save itinerary:', err);
    }
  },

  /**
   * Retrieve cached itinerary list when offline.
   */
  getItinerary: async (): Promise<any[]> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_META], 'readonly');
      const metaStore = tx.objectStore(STORE_META);
      const req = metaStore.get('itinerary_cache');
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      return req.result?.value || [];
    } catch {
      return [];
    }
  },

  /**
   * Record a sale made offline:
   * 1. Decrements local van inventory in IndexedDB.
   * 2. Updates customer balance if credit sale.
   * 3. Queues transaction in Outbox.
   * 4. Updates cached trip totals.
   */
  recordOfflineSale: async (params: {
    tripId: number;
    customerId?: number | null;
    customerName?: string;
    items: Array<{ productId: number; qty: number; unitPrice: number; productName?: string }>;
    paymentMethod: 'cash' | 'credit' | 'card' | 'split';
    paidAmount?: number;
    notes?: string;
    gpsLat?: number;
    gpsLng?: number;
    // INV-VAN-OFFLINE-TIMESTAMPS: why no GPS fix was captured at
    // submit time ('timeout' | 'denied' | 'unavailable'). Travels
    // with the offline record so the synced sale carries it.
    gpsMissingReason?: string;
    deliveryProofPhoto?: string;
    cartonsCount?: number;
  }): Promise<{ docNo: string; clientTxId: string; total: number }> => {
    const db = await openDb();
    const tx = db.transaction([STORE_META], 'readonly');
    const metaStore = tx.objectStore(STORE_META);

    const clientTxId = generateClientTxId();
    const dateStr = getTodayYYMMDD();
    // INV-VAN-OFFLINE-TIMESTAMPS: ONE instant for the whole record —
    // the outbox createdAt AND the payload's offlineCreatedAt are
    // the same value, so the synced sale is booked at the instant
    // the rep actually made it.
    const createdAt = new Date().toISOString();

    // Get & increment local invoice counter
    const seqReq = metaStore.get('offline_sale_seq');
    const snapReq = metaStore.get('active_trip_snapshot');

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const currentSeq = Number(seqReq.result?.value || 0) + 1;
    const docNo = `VAN-${dateStr}-OFF-${String(currentSeq).padStart(4, '0')}`;

    // Calculate total
    const total = params.items.reduce((sum, item) => sum + Number(item.qty || 0) * Number(item.unitPrice || 0), 0);
    const paidAmount = params.paymentMethod === 'cash' ? total : Number(params.paidAmount || 0);
    const creditAmount = Math.max(0, total - paidAmount);

    // Reopen transaction for mutations
    const tx2 = db.transaction([STORE_META, STORE_INVENTORY, STORE_CUSTOMERS, STORE_OUTBOX], 'readwrite');
    const metaStore2 = tx2.objectStore(STORE_META);
    const invStore2 = tx2.objectStore(STORE_INVENTORY);
    const custStore2 = tx2.objectStore(STORE_CUSTOMERS);
    const outboxStore2 = tx2.objectStore(STORE_OUTBOX);

    metaStore2.put({ key: 'offline_sale_seq', value: currentSeq });

    // Decrement local inventory
    for (const item of params.items) {
      const getReq = invStore2.get(item.productId);
      getReq.onsuccess = () => {
        const existing = getReq.result as VanStockItem | undefined;
        if (existing) {
          const newQty = Math.max(0, Number(existing.qty || 0) - Number(item.qty || 0));
          invStore2.put({ ...existing, qty: newQty });
        }
      };
    }

    // Update customer debt if credit sale
    if (params.customerId && creditAmount > 0) {
      const custGetReq = custStore2.get(params.customerId);
      custGetReq.onsuccess = () => {
        const cust = custGetReq.result;
        if (cust) {
          const newBal = Number(cust.balance || 0) + creditAmount;
          custStore2.put({ ...cust, balance: newBal });
        }
      };
    }

    // Update trip totals in snapshot
    const snapshot = snapReq.result?.value as VanActiveTripResponse | undefined;
    if (snapshot?.trip) {
      const updatedTrip = {
        ...snapshot.trip,
        salesAmount: Number(snapshot.trip.salesAmount || 0) + total,
        cashCollected: Number(snapshot.trip.cashCollected || 0) + paidAmount,
        creditSales: Number(snapshot.trip.creditSales || 0) + creditAmount,
      };

      const newSaleEntry = {
        id: -Date.now(), // temporary negative id
        docNo,
        total,
        paymentMethod: params.paymentMethod,
        createdAt: new Date().toISOString(),
        customerName: params.customerName || 'عميل نقدي سريع',
      };

      const updatedSales = [newSaleEntry, ...(snapshot.sales || [])];
      metaStore2.put({
        key: 'active_trip_snapshot',
        value: {
          ...snapshot,
          trip: updatedTrip,
          sales: updatedSales,
          recentSales: updatedSales,
        },
      });
    }

    // Queue in Outbox
    const outboxItem: OfflineOutboxItem = {
      clientTxId,
      type: 'sale',
      docNo,
      payload: { ...params, docNo, clientTxId, total, paidAmount, offlineCreatedAt: createdAt },
      createdAt,
      status: 'pending',
    };
    outboxStore2.put(outboxItem);

    await new Promise<void>((resolve, reject) => {
      tx2.oncomplete = () => resolve();
      tx2.onerror = () => reject(tx2.error);
    });

    return { docNo, clientTxId, total };
  },

  /**
   * Record a collection receipt offline.
   */
  recordOfflineCollection: async (params: {
    tripId: number;
    customerId: number;
    customerName: string;
    amount: number;
    note?: string;
    gpsLat?: number;
    gpsLng?: number;
  }): Promise<{ docNo: string; clientTxId: string }> => {
    const db = await openDb();
    const tx = db.transaction([STORE_META], 'readonly');
    const metaStore = tx.objectStore(STORE_META);

    const clientTxId = generateClientTxId();
    const dateStr = getTodayYYMMDD();
    // INV-VAN-OFFLINE-TIMESTAMPS: one instant for the record — the
    // outbox createdAt AND the payload's offlineCreatedAt.
    const createdAt = new Date().toISOString();

    const seqReq = metaStore.get('offline_col_seq');
    const snapReq = metaStore.get('active_trip_snapshot');

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const currentSeq = Number(seqReq.result?.value || 0) + 1;
    const docNo = `COL-${dateStr}-OFF-${String(currentSeq).padStart(4, '0')}`;

    const tx2 = db.transaction([STORE_META, STORE_CUSTOMERS, STORE_OUTBOX], 'readwrite');
    const metaStore2 = tx2.objectStore(STORE_META);
    const custStore2 = tx2.objectStore(STORE_CUSTOMERS);
    const outboxStore2 = tx2.objectStore(STORE_OUTBOX);

    metaStore2.put({ key: 'offline_col_seq', value: currentSeq });

    // Decrement customer debt
    const custGetReq = custStore2.get(params.customerId);
    custGetReq.onsuccess = () => {
      const cust = custGetReq.result;
      if (cust) {
        const newBal = Math.max(0, Number(cust.balance || 0) - Number(params.amount || 0));
        custStore2.put({ ...cust, balance: newBal });
      }
    };

    // Update trip totals
    const snapshot = snapReq.result?.value as VanActiveTripResponse | undefined;
    if (snapshot?.trip) {
      const updatedTrip = {
        ...snapshot.trip,
        cashCollected: Number(snapshot.trip.cashCollected || 0) + Number(params.amount || 0),
      };
      const newColEntry = {
        id: -Date.now(),
        amount: Number(params.amount || 0),
        createdAt: new Date().toISOString(),
        customerName: params.customerName,
        note: params.note,
        gpsLat: params.gpsLat,
        gpsLng: params.gpsLng,
      };
      const updatedCols = [newColEntry, ...(snapshot.collections || [])];
      metaStore2.put({
        key: 'active_trip_snapshot',
        value: {
          ...snapshot,
          trip: updatedTrip,
          collections: updatedCols,
        },
      });
    }

    outboxStore2.put({
      clientTxId,
      type: 'collection',
      docNo,
      payload: { ...params, docNo, clientTxId, offlineCreatedAt: createdAt },
      createdAt,
      status: 'pending',
    });

    await new Promise<void>((resolve, reject) => {
      tx2.oncomplete = () => resolve();
      tx2.onerror = () => reject(tx2.error);
    });

    return { docNo, clientTxId };
  },

  /**
   * Record a field return offline:
   * 1. Queues transaction in Outbox.
   * 2. Increments local van inventory in IndexedDB.
   * 3. Updates cached trip returns list.
   */
  recordOfflineReturn: async (params: {
    tripId: number;
    customerId: number;
    saleId?: number | null;
    returnReason: string;
    refundMethod?: 'credit' | 'cash';
    items: Array<{ productId: number; qty: number; unitPrice: number; saleItemId?: number }>;
    notes?: string;
  }): Promise<{ docNo: string; clientTxId: string; totalAmount: number }> => {
    const db = await openDb();
    const tx = db.transaction([STORE_META], 'readonly');
    const metaStore = tx.objectStore(STORE_META);

    const clientTxId = generateClientTxId();
    const dateStr = getTodayYYMMDD();
    // INV-VAN-OFFLINE-TIMESTAMPS: one instant for the record — the
    // outbox createdAt AND the payload's offlineCreatedAt.
    const createdAt = new Date().toISOString();

    const seqReq = metaStore.get('offline_ret_seq');
    const snapReq = metaStore.get('active_trip_snapshot');

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    const currentSeq = Number(seqReq.result?.value || 0) + 1;
    const docNo = `VR-${dateStr}-OFF-${String(currentSeq).padStart(4, '0')}`;
    const totalAmount = params.items.reduce((s, it) => s + Number(it.qty || 0) * Number(it.unitPrice || 0), 0);

    const tx2 = db.transaction([STORE_META, STORE_INVENTORY, STORE_OUTBOX], 'readwrite');
    const metaStore2 = tx2.objectStore(STORE_META);
    const invStore2 = tx2.objectStore(STORE_INVENTORY);
    const outboxStore2 = tx2.objectStore(STORE_OUTBOX);

    metaStore2.put({ key: 'offline_ret_seq', value: currentSeq });

    for (const item of params.items) {
      const getReq = invStore2.get(item.productId);
      getReq.onsuccess = () => {
        const existing = getReq.result as VanStockItem | undefined;
        if (existing) {
          invStore2.put({ ...existing, qty: Number(existing.qty || 0) + Number(item.qty || 0) });
        }
      };
    }

    const snapshot = snapReq.result?.value as VanActiveTripResponse | undefined;
    if (snapshot?.trip) {
      const newRetEntry = {
        id: -Date.now(),
        docNo,
        totalAmount,
        returnReason: params.returnReason,
        status: 'pending_approval' as const,
        createdAt: new Date().toISOString(),
        customerName: 'عميل مرتجع',
      };
      const updatedReturns = [newRetEntry, ...(snapshot.returns || [])];
      metaStore2.put({
        key: 'active_trip_snapshot',
        value: {
          ...snapshot,
          returns: updatedReturns,
        },
      });
    }

    outboxStore2.put({
      clientTxId,
      type: 'return',
      docNo,
      payload: { ...params, returnDocNo: docNo, clientTxId, totalAmount, offlineCreatedAt: createdAt },
      createdAt,
      status: 'pending',
    });

    await new Promise<void>((resolve, reject) => {
      tx2.oncomplete = () => resolve();
      tx2.onerror = () => reject(tx2.error);
    });

    return { docNo, clientTxId, totalAmount };
  },

  /**
   * Get all pending items in outbox waiting for sync.
   */
  getPendingOutbox: async (): Promise<OfflineOutboxItem[]> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_OUTBOX], 'readonly');
      const outboxStore = tx.objectStore(STORE_OUTBOX);
      const req = outboxStore.getAll();
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
      const items = (req.result || []) as OfflineOutboxItem[];
      return items.filter((item) => item.status === 'pending' || item.status === 'failed');
    } catch {
      return [];
    }
  },

  /**
   * Mark an outbox item as successfully synced to server.
   */
  markSynced: async (clientTxId: string, serverDocNo?: string): Promise<void> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_OUTBOX], 'readwrite');
      const outboxStore = tx.objectStore(STORE_OUTBOX);
      const getReq = outboxStore.get(clientTxId);
      getReq.onsuccess = () => {
        const item = getReq.result as OfflineOutboxItem | undefined;
        if (item) {
          outboxStore.put({
            ...item,
            status: 'synced',
            docNo: serverDocNo || item.docNo,
          });
        }
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[VanOfflineDB] Failed to mark synced:', err);
    }
  },

  /**
   * Mark an outbox item as failed during sync attempt.
   */
  markSyncFailed: async (clientTxId: string, errorMessage: string): Promise<void> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_OUTBOX], 'readwrite');
      const outboxStore = tx.objectStore(STORE_OUTBOX);
      const getReq = outboxStore.get(clientTxId);
      getReq.onsuccess = () => {
        const item = getReq.result as OfflineOutboxItem | undefined;
        if (item) {
          outboxStore.put({
            ...item,
            status: 'failed',
            errorMessage,
          });
        }
      };
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {}
  },

  /**
   * Count how many items are waiting to sync.
   */
  getPendingCount: async (): Promise<number> => {
    const pending = await vanOfflineDb.getPendingOutbox();
    return pending.length;
  },

  /**
   * Save warehouses and available products for load requisitions offline.
   */
  saveRequisitionCatalog: async (warehouses: DriverWarehouse[], products: DriverAvailableProduct[]): Promise<void> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_META], 'readwrite');
      const metaStore = tx.objectStore(STORE_META);
      if (Array.isArray(warehouses) && warehouses.length > 0) {
        metaStore.put({ key: 'requisition_warehouses', value: warehouses, updatedAt: new Date().toISOString() });
      }
      if (Array.isArray(products) && products.length > 0) {
        metaStore.put({ key: 'requisition_products', value: products, updatedAt: new Date().toISOString() });
      }
      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (err) {
      console.warn('[VanOfflineDB] Failed to save requisition catalog:', err);
    }
  },

  /**
   * Retrieve warehouses and available products for load requisitions when offline.
   */
  getRequisitionCatalog: async (): Promise<{ warehouses: DriverWarehouse[]; products: DriverAvailableProduct[] }> => {
    try {
      const db = await openDb();
      const tx = db.transaction([STORE_META, STORE_INVENTORY], 'readonly');
      const metaStore = tx.objectStore(STORE_META);
      const invStore = tx.objectStore(STORE_INVENTORY);

      const getReq = (key: string) =>
        new Promise<any>((resolve) => {
          const r = metaStore.get(key);
          r.onsuccess = () => resolve(r.result?.value);
          r.onerror = () => resolve(null);
        });

      let warehouses: DriverWarehouse[] = (await getReq('requisition_warehouses')) || [];
      let products: DriverAvailableProduct[] = (await getReq('requisition_products')) || [];

      // Default fallback warehouses if none saved yet
      if (!warehouses.length) {
        warehouses = [
          { id: 1, name: 'الفرع الرئيسي', code: 'WH-MAIN', locationType: 'main' }
        ];
      }

      // Fallback: If requisition products not yet fetched, synthesize from van inventory
      if (!products.length) {
        const allInv: VanStockItem[] = await new Promise((resolve) => {
          const r = invStore.getAll();
          r.onsuccess = () => resolve(r.result || []);
          r.onerror = () => resolve([]);
        });
        if (allInv.length) {
          products = allInv.map((item) => ({
            id: item.productId,
            name: item.productName,
            barcode: item.barcode || '',
            sku: item.barcode || String(item.productId),
            retailPrice: item.retailPrice || 0,
            unit: item.unitName || 'قطعة',
            totalStock: item.qty || 0,
            warehouseStocks: [
              { warehouseId: warehouses[0]?.id || 1, warehouseName: warehouses[0]?.name || 'الفرع الرئيسي', qty: item.qty || 0 }
            ]
          }));
        }
      }

      return { warehouses, products };
    } catch (err) {
      console.warn('[VanOfflineDB] Failed to get requisition catalog:', err);
      return { warehouses: [], products: [] };
    }
  },

  /**
   * Save an offline load requisition to the outbox for subsequent auto-sync.
   */
  recordOfflineRequisition: async (payload: {
    repId?: number;
    repName?: string;
    vehiclePlate?: string;
    sourceWarehouseId?: number;
    items: { productId: number; qty: number; sourceWarehouseId?: number; sourceWarehouseName?: string }[];
    notes?: string;
  }): Promise<{ ok: boolean; docNo: string; requisitionId: number; isOffline: boolean }> => {
    const db = await openDb();
    const tx = db.transaction([STORE_OUTBOX], 'readwrite');
    const outboxStore = tx.objectStore(STORE_OUTBOX);

    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const randSeq = Math.floor(1000 + Math.random() * 9000);
    const docNo = `REQ-OFF-${yy}${mm}${dd}-${randSeq}`;
    const clientTxId = crypto.randomUUID();

    const outboxItem: OfflineOutboxItem = {
      clientTxId,
      type: 'load_requisition',
      docNo,
      payload,
      createdAt: now.toISOString(),
      status: 'pending',
    };

    outboxStore.put(outboxItem);

    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });

    return {
      ok: true,
      docNo,
      requisitionId: -Date.now(),
      isOffline: true,
    };
  },
};
