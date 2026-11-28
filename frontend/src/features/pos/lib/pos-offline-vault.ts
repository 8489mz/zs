import type { AppSettings, Branch, Customer, Location, Sale } from '@/types/domain';
import type { HeldPosDraft } from '@/features/pos/hooks/usePosWorkspace';
import { requestStoragePersistence } from '@/lib/storage-persistence';
import { useAuthStore } from '@/stores/auth-store';

const VAULT_DB_NAME = 'zsystems_pos_offline_vault_db';
const VAULT_DB_VERSION = 1;

const STORE_BOOT_SNAPSHOTS = 'boot_snapshots';
const STORE_OUTBOX_SALES = 'outbox_sales';
const STORE_PROVISIONAL_SHIFTS = 'provisional_shifts';
const STORE_LOCAL_HELD = 'local_held_drafts';
const STORE_LOCAL_CUSTOMERS = 'local_customers';
const STORE_RECENT_SALES = 'recent_sales_archive';

const LS_BOOT_SNAPSHOT_KEY = 'zs_pos_boot_snapshot_v1';
const LS_PROVISIONAL_SHIFTS_KEY = 'zs_pos_provisional_shifts_v1';
const LS_LOCAL_HELD_KEY = 'zs_pos_local_held_drafts_v1';
const LS_LOCAL_CUSTOMERS_KEY = 'zs_pos_local_customers_v1';

const MAX_CACHED_CUSTOMERS = 1500;
const MAX_ARCHIVED_RECENT_SALES = 100;

export const POS_PROVISIONAL_SHIFTS_EVENT = 'pos-provisional-shifts-updated';
export const POS_LOCAL_HELD_EVENT = 'pos-local-held-updated';
export const POS_LOCAL_CUSTOMERS_EVENT = 'pos-local-customers-updated';

export interface PosBootSnapshotRecord {
  scopeKey: string;
  tenantId: string;
  accountId: string;
  settings: AppSettings | null;
  branches: Branch[];
  locations: Location[];
  openShifts: Array<Record<string, unknown>>;
  customers: Customer[];
  updatedAt: string;
}

export interface OfflineProvisionalShift {
  id: string;
  scopeKey: string;
  tenantId: string;
  accountId: string;
  docNo: string;
  openingCash: number;
  branchId: number | null;
  locationId: number | null;
  openedById: string;
  openedByName: string;
  terminalCode: string;
  openedAt: string;
  note: string;
  password?: string;
  status: 'pending_sync' | 'syncing' | 'synced' | 'failed';
  error?: string;
}

export interface OfflineQuickCustomer extends Customer {
  id: string;
  scopeKey: string;
  tenantId: string;
  accountId: string;
  isOfflineLocal: true;
  createdAt: string;
}

let vaultDbInstance: IDBDatabase | null = null;
let vaultDbPromise: Promise<IDBDatabase> | null = null;

const memoryBootSnapshots = new Map<string, PosBootSnapshotRecord>();
const memoryRecentSales = new Map<string, Sale[]>();

function isIndexedDbSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

export function getActivePosVaultScope(): { tenantId: string; accountId: string; scopeKey: string; userId: string; userName: string } | null {
  try {
    const auth = useAuthStore.getState();
    const tenantId = String(auth.tenant?.id || auth.user?.tenantId || '').trim();
    const accountId = String(auth.tenant?.accountId || auth.user?.accountId || '').trim();
    if (!tenantId || !accountId) return null;
    const userId = String(auth.user?.id || '').trim();
    const userName = String(auth.user?.displayName || auth.user?.username || '').trim();
    return {
      tenantId,
      accountId,
      scopeKey: `${tenantId}::${accountId}`,
      userId,
      userName,
    };
  } catch {
    return null;
  }
}

function openVaultDb(): Promise<IDBDatabase> {
  void requestStoragePersistence();
  if (vaultDbInstance) return Promise.resolve(vaultDbInstance);
  if (vaultDbPromise) return vaultDbPromise;
  if (!isIndexedDbSupported()) {
    return Promise.reject(new Error('IndexedDB is not supported'));
  }

  vaultDbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = window.indexedDB.open(VAULT_DB_NAME, VAULT_DB_VERSION);

    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_BOOT_SNAPSHOTS)) {
        db.createObjectStore(STORE_BOOT_SNAPSHOTS, { keyPath: 'scopeKey' });
      }
      if (!db.objectStoreNames.contains(STORE_OUTBOX_SALES)) {
        const outbox = db.createObjectStore(STORE_OUTBOX_SALES, { keyPath: 'id' });
        outbox.createIndex('scopeKey', 'scopeKey', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PROVISIONAL_SHIFTS)) {
        const shifts = db.createObjectStore(STORE_PROVISIONAL_SHIFTS, { keyPath: 'id' });
        shifts.createIndex('scopeKey', 'scopeKey', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_LOCAL_HELD)) {
        const held = db.createObjectStore(STORE_LOCAL_HELD, { keyPath: 'id' });
        held.createIndex('scopeKey', 'scopeKey', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_LOCAL_CUSTOMERS)) {
        const cust = db.createObjectStore(STORE_LOCAL_CUSTOMERS, { keyPath: 'id' });
        cust.createIndex('scopeKey', 'scopeKey', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RECENT_SALES)) {
        db.createObjectStore(STORE_RECENT_SALES, { keyPath: 'scopeKey' });
      }
    };

    req.onsuccess = (event) => {
      vaultDbInstance = (event.target as IDBOpenDBRequest).result;
      vaultDbInstance.onversionchange = () => {
        vaultDbInstance?.close();
        vaultDbInstance = null;
        vaultDbPromise = null;
      };
      resolve(vaultDbInstance);
    };

    req.onerror = (event) => {
      vaultDbPromise = null;
      reject((event.target as IDBOpenDBRequest).error);
    };
  });

  return vaultDbPromise;
}

function safeReadLsJson<T>(key: string, fallback: T): T {
  try {
    if (typeof localStorage === 'undefined') return fallback;
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function safeWriteLsJson(key: string, value: unknown): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Non-fatal mirror write; IndexedDB holds full durable copy
  }
}

function makeUuid(prefix = ''): string {
  const core = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return prefix ? `${prefix}${core}` : core;
}

function todayYYMMDD(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2);
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

// ============================================================================
// 1. POS Boot Snapshot (Settings, Branches, Locations, Open Shifts, Customers)
// ============================================================================

export function getPosBootSnapshotSync(): PosBootSnapshotRecord | null {
  const scope = getActivePosVaultScope();
  if (!scope) return null;

  const mem = memoryBootSnapshots.get(scope.scopeKey);
  if (mem && mem.tenantId === scope.tenantId && mem.accountId === scope.accountId) {
    return mem;
  }

  const stored = safeReadLsJson<PosBootSnapshotRecord | null>(LS_BOOT_SNAPSHOT_KEY, null);
  if (stored && stored.scopeKey === scope.scopeKey && stored.tenantId === scope.tenantId && stored.accountId === scope.accountId) {
    memoryBootSnapshots.set(scope.scopeKey, stored);
    return stored;
  }

  return null;
}

export async function getPosBootSnapshotAsync(): Promise<PosBootSnapshotRecord | null> {
  const scope = getActivePosVaultScope();
  if (!scope) return null;

  if (isIndexedDbSupported()) {
    try {
      const db = await openVaultDb();
      const idbRecord = await new Promise<PosBootSnapshotRecord | null>((resolve) => {
        const tx = db.transaction(STORE_BOOT_SNAPSHOTS, 'readonly');
        const req = tx.objectStore(STORE_BOOT_SNAPSHOTS).get(scope.scopeKey);
        req.onsuccess = () => resolve((req.result as PosBootSnapshotRecord | undefined) || null);
        req.onerror = () => resolve(null);
      });
      if (idbRecord && idbRecord.tenantId === scope.tenantId && idbRecord.accountId === scope.accountId) {
        memoryBootSnapshots.set(scope.scopeKey, idbRecord);
        return idbRecord;
      }
    } catch {
      // Fall through to sync mirror
    }
  }

  return getPosBootSnapshotSync();
}

export async function savePosBootSnapshot(patch: {
  settings?: AppSettings | null;
  branches?: Branch[];
  locations?: Location[];
  openShifts?: Array<Record<string, unknown>>;
  customers?: Customer[];
}): Promise<void> {
  const scope = getActivePosVaultScope();
  if (!scope) return;

  const existing = (await getPosBootSnapshotAsync()) || getPosBootSnapshotSync();
  const mergedCustomers = patch.customers !== undefined
    ? patch.customers.slice(0, MAX_CACHED_CUSTOMERS)
    : (existing?.customers || []);

  const nextRecord: PosBootSnapshotRecord = {
    scopeKey: scope.scopeKey,
    tenantId: scope.tenantId,
    accountId: scope.accountId,
    settings: patch.settings !== undefined ? patch.settings : (existing?.settings ?? null),
    branches: patch.branches !== undefined ? patch.branches : (existing?.branches ?? []),
    locations: patch.locations !== undefined ? patch.locations : (existing?.locations ?? []),
    openShifts: patch.openShifts !== undefined ? patch.openShifts : (existing?.openShifts ?? []),
    customers: mergedCustomers,
    updatedAt: new Date().toISOString(),
  };

  memoryBootSnapshots.set(scope.scopeKey, nextRecord);

  // Keep localStorage mirror compact (cap customers at 80 rows in LS; IDB keeps up to 1,500)
  safeWriteLsJson(LS_BOOT_SNAPSHOT_KEY, {
    ...nextRecord,
    customers: nextRecord.customers.slice(0, 80),
  });

  if (isIndexedDbSupported()) {
    try {
      const db = await openVaultDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_BOOT_SNAPSHOTS, 'readwrite');
        tx.objectStore(STORE_BOOT_SNAPSHOTS).put(nextRecord);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      // Non-fatal
    }
  }
}

// ============================================================================
// 2. Durable Outbox Sales in IndexedDB (Unlimited Capacity)
// ============================================================================

export async function persistOfflineSaleToVaultIdb(sale: Record<string, unknown> & { id: string; tenantId?: string; accountId?: string }): Promise<boolean> {
  if (!isIndexedDbSupported() || !sale?.id) return false;
  const scopeKey = `${String(sale.tenantId || '')}::${String(sale.accountId || '')}`;
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX_SALES, 'readwrite');
      tx.objectStore(STORE_OUTBOX_SALES).put({ ...sale, scopeKey });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return true;
  } catch {
    return false;
  }
}

export async function removeOfflineSaleFromVaultIdb(id: string): Promise<void> {
  if (!isIndexedDbSupported() || !id) return;
  try {
    const db = await openVaultDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX_SALES, 'readwrite');
      tx.objectStore(STORE_OUTBOX_SALES).delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

export async function loadOfflineSalesFromVaultIdb<T>(): Promise<T[]> {
  const scope = getActivePosVaultScope();
  if (!scope || !isIndexedDbSupported()) return [];
  try {
    const db = await openVaultDb();
    return await new Promise<T[]>((resolve) => {
      const tx = db.transaction(STORE_OUTBOX_SALES, 'readonly');
      const idx = tx.objectStore(STORE_OUTBOX_SALES).index('scopeKey');
      const req = idx.getAll(scope.scopeKey);
      req.onsuccess = () => resolve(Array.isArray(req.result) ? (req.result as T[]) : []);
      req.onerror = () => resolve([]);
    });
  } catch {
    return [];
  }
}

export async function clearTenantOfflineSalesFromVaultIdb(): Promise<void> {
  const scope = getActivePosVaultScope();
  if (!scope || !isIndexedDbSupported()) return;
  try {
    const db = await openVaultDb();
    const rows = await loadOfflineSalesFromVaultIdb<{ id: string }>();
    if (!rows.length) return;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_OUTBOX_SALES, 'readwrite');
      const store = tx.objectStore(STORE_OUTBOX_SALES);
      for (const row of rows) {
        if (row?.id) store.delete(row.id);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Ignore
  }
}

// ============================================================================
// 3. Offline Provisional Shift Open (Morning Shift Open Without Internet)
// ============================================================================

export function getActiveOfflineProvisionalShifts(): OfflineProvisionalShift[] {
  const scope = getActivePosVaultScope();
  if (!scope) return [];
  const list = safeReadLsJson<OfflineProvisionalShift[]>(LS_PROVISIONAL_SHIFTS_KEY, []);
  if (!Array.isArray(list)) return [];
  return list.filter(
    (item) =>
      item &&
      item.scopeKey === scope.scopeKey &&
      item.tenantId === scope.tenantId &&
      item.accountId === scope.accountId &&
      item.status !== 'synced',
  );
}

export function createOfflineProvisionalShift(params: {
  openingCash: number;
  branchId: number | null;
  locationId: number | null;
  note: string;
  terminalCode: string;
  password?: string;
}): OfflineProvisionalShift {
  const scope = getActivePosVaultScope();
  if (!scope || !scope.userId) {
    throw new Error('تعذر تحديد المستخدم الحالي لفتح الوردية الأوفلاين.');
  }

  const all = safeReadLsJson<OfflineProvisionalShift[]>(LS_PROVISIONAL_SHIFTS_KEY, []);
  const existingForUser = Array.isArray(all)
    ? all.find(
        (s) =>
          s.scopeKey === scope.scopeKey &&
          s.openedById === scope.userId &&
          s.status !== 'synced',
      )
    : undefined;
  if (existingForUser) return existingForUser;

  const seqSuffix = String(Math.floor(1000 + Math.random() * 9000));
  const shift: OfflineProvisionalShift = {
    id: makeUuid('off-shift-'),
    scopeKey: scope.scopeKey,
    tenantId: scope.tenantId,
    accountId: scope.accountId,
    docNo: `SHIFT-${todayYYMMDD()}-${seqSuffix}`,
    openingCash: Math.max(0, Number(params.openingCash || 0)),
    branchId: params.branchId,
    locationId: params.locationId,
    openedById: scope.userId,
    openedByName: scope.userName || 'كاشير',
    terminalCode: params.terminalCode,
    openedAt: new Date().toISOString(),
    note: String(params.note || '').trim(),
    ...(params.password ? { password: params.password } : {}),
    status: 'pending_sync',
  };

  const nextAll = [...(Array.isArray(all) ? all : []), shift];
  safeWriteLsJson(LS_PROVISIONAL_SHIFTS_KEY, nextAll);

  if (isIndexedDbSupported()) {
    openVaultDb()
      .then((db) => {
        const tx = db.transaction(STORE_PROVISIONAL_SHIFTS, 'readwrite');
        tx.objectStore(STORE_PROVISIONAL_SHIFTS).put(shift);
      })
      .catch(() => {});
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(POS_PROVISIONAL_SHIFTS_EVENT));
  }
  return shift;
}

export function updateOfflineProvisionalShiftStatus(
  id: string,
  status: OfflineProvisionalShift['status'],
  error?: string,
): void {
  const scope = getActivePosVaultScope();
  if (!scope) return;
  const all = safeReadLsJson<OfflineProvisionalShift[]>(LS_PROVISIONAL_SHIFTS_KEY, []);
  if (!Array.isArray(all)) return;

  const nextAll = status === 'synced'
    ? all.filter((item) => !(item.id === id && item.scopeKey === scope.scopeKey))
    : all.map((item) =>
        item.id === id && item.scopeKey === scope.scopeKey
          ? { ...item, status, error }
          : item,
      );
  safeWriteLsJson(LS_PROVISIONAL_SHIFTS_KEY, nextAll);

  if (isIndexedDbSupported()) {
    openVaultDb()
      .then((db) => {
        const tx = db.transaction(STORE_PROVISIONAL_SHIFTS, 'readwrite');
        const store = tx.objectStore(STORE_PROVISIONAL_SHIFTS);
        if (status === 'synced') {
          store.delete(id);
        } else {
          const found = nextAll.find((item) => item.id === id);
          if (found) store.put(found);
        }
      })
      .catch(() => {});
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(POS_PROVISIONAL_SHIFTS_EVENT));
  }
}

// ============================================================================
// 4. Offline Park / Hold & Recall Cart
// ============================================================================

export function getOfflineHeldDrafts(): HeldPosDraft[] {
  const scope = getActivePosVaultScope();
  if (!scope) return [];
  const all = safeReadLsJson<Array<HeldPosDraft & { scopeKey?: string; tenantId?: string; accountId?: string }>>(LS_LOCAL_HELD_KEY, []);
  if (!Array.isArray(all)) return [];
  return all.filter(
    (entry) =>
      entry &&
      entry.scopeKey === scope.scopeKey &&
      entry.tenantId === scope.tenantId &&
      entry.accountId === scope.accountId,
  );
}

export function saveOfflineHeldDraft(payload: Record<string, unknown>): HeldPosDraft {
  const scope = getActivePosVaultScope();
  if (!scope) {
    throw new Error('تعذر تحديد المنشأة لحفظ الفاتورة المعلقة محلياً.');
  }

  const all = safeReadLsJson<Array<HeldPosDraft & { scopeKey?: string; tenantId?: string; accountId?: string }>>(LS_LOCAL_HELD_KEY, []);
  const draft: HeldPosDraft & { scopeKey: string; tenantId: string; accountId: string; isOfflineLocal: true } = {
    ...(payload as unknown as HeldPosDraft),
    cart: Array.isArray((payload as { items?: unknown[] }).items)
      ? ((payload as { items: unknown[] }).items as HeldPosDraft['cart'])
      : (Array.isArray((payload as { cart?: unknown[] }).cart) ? ((payload as { cart: unknown[] }).cart as HeldPosDraft['cart']) : []),
    id: makeUuid('local-held-'),
    savedAt: new Date().toISOString(),
    scopeKey: scope.scopeKey,
    tenantId: scope.tenantId,
    accountId: scope.accountId,
    isOfflineLocal: true,
  };

  const nextAll = [draft, ...(Array.isArray(all) ? all : [])];
  safeWriteLsJson(LS_LOCAL_HELD_KEY, nextAll);

  if (isIndexedDbSupported()) {
    openVaultDb()
      .then((db) => {
        const tx = db.transaction(STORE_LOCAL_HELD, 'readwrite');
        tx.objectStore(STORE_LOCAL_HELD).put(draft);
      })
      .catch(() => {});
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(POS_LOCAL_HELD_EVENT));
  }
  return draft;
}

export function isOfflineLocalHeldDraftId(id: string | number | null | undefined): boolean {
  return String(id || '').startsWith('local-held-');
}

export function removeOfflineHeldDraft(id: string): void {
  const scope = getActivePosVaultScope();
  if (!scope) return;
  const all = safeReadLsJson<Array<HeldPosDraft & { scopeKey?: string }>>(LS_LOCAL_HELD_KEY, []);
  const nextAll = (Array.isArray(all) ? all : []).filter(
    (entry) => !(entry.id === id && entry.scopeKey === scope.scopeKey),
  );
  safeWriteLsJson(LS_LOCAL_HELD_KEY, nextAll);

  if (isIndexedDbSupported()) {
    openVaultDb()
      .then((db) => {
        const tx = db.transaction(STORE_LOCAL_HELD, 'readwrite');
        tx.objectStore(STORE_LOCAL_HELD).delete(id);
      })
      .catch(() => {});
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(POS_LOCAL_HELD_EVENT));
  }
}

export function clearOfflineHeldDrafts(): void {
  const scope = getActivePosVaultScope();
  if (!scope) return;
  const all = safeReadLsJson<Array<HeldPosDraft & { scopeKey?: string }>>(LS_LOCAL_HELD_KEY, []);
  const nextAll = (Array.isArray(all) ? all : []).filter((entry) => entry.scopeKey !== scope.scopeKey);
  safeWriteLsJson(LS_LOCAL_HELD_KEY, nextAll);

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(POS_LOCAL_HELD_EVENT));
  }
}

// ============================================================================
// 5. Offline Quick Customer Creation & Resolution
// ============================================================================

export function isOfflineQuickCustomerId(customerId: string | number | null | undefined): boolean {
  return String(customerId || '').startsWith('off-cust-');
}

export function getOfflineQuickCustomers(): OfflineQuickCustomer[] {
  const scope = getActivePosVaultScope();
  if (!scope) return [];
  const all = safeReadLsJson<OfflineQuickCustomer[]>(LS_LOCAL_CUSTOMERS_KEY, []);
  if (!Array.isArray(all)) return [];
  return all.filter(
    (c) => c && c.scopeKey === scope.scopeKey && c.tenantId === scope.tenantId && c.accountId === scope.accountId,
  );
}

export function resolveOfflineQuickCustomer(customerId: string): OfflineQuickCustomer | null {
  if (!isOfflineQuickCustomerId(customerId)) return null;
  return getOfflineQuickCustomers().find((c) => c.id === customerId) || null;
}

export function createOfflineQuickCustomer(params: {
  name: string;
  phone: string;
  address: string;
}): OfflineQuickCustomer {
  const scope = getActivePosVaultScope();
  if (!scope) {
    throw new Error('تعذر تحديد المنشأة لحفظ بيانات العميل محلياً.');
  }

  const all = safeReadLsJson<OfflineQuickCustomer[]>(LS_LOCAL_CUSTOMERS_KEY, []);
  const cleanPhone = String(params.phone || '').trim();
  const cleanName = String(params.name || '').trim();
  const existing = (Array.isArray(all) ? all : []).find(
    (c) =>
      c.scopeKey === scope.scopeKey &&
      ((cleanPhone && c.phone === cleanPhone) || (!cleanPhone && c.name === cleanName)),
  );
  if (existing) return existing;

  const customer: OfflineQuickCustomer = {
    id: makeUuid('off-cust-'),
    name: cleanName,
    phone: cleanPhone,
    address: String(params.address || '').trim(),
    balance: 0,
    type: 'cash',
    creditLimit: 0,
    storeCreditBalance: 0,
    scopeKey: scope.scopeKey,
    tenantId: scope.tenantId,
    accountId: scope.accountId,
    isOfflineLocal: true,
    createdAt: new Date().toISOString(),
  };

  const nextAll = [customer, ...(Array.isArray(all) ? all : [])];
  safeWriteLsJson(LS_LOCAL_CUSTOMERS_KEY, nextAll);

  if (isIndexedDbSupported()) {
    openVaultDb()
      .then((db) => {
        const tx = db.transaction(STORE_LOCAL_CUSTOMERS, 'readwrite');
        tx.objectStore(STORE_LOCAL_CUSTOMERS).put(customer);
      })
      .catch(() => {});
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(POS_LOCAL_CUSTOMERS_EVENT));
  }
  return customer;
}

export function removeOfflineQuickCustomer(id: string): void {
  const scope = getActivePosVaultScope();
  if (!scope) return;
  const all = safeReadLsJson<OfflineQuickCustomer[]>(LS_LOCAL_CUSTOMERS_KEY, []);
  const nextAll = (Array.isArray(all) ? all : []).filter((c) => !(c.id === id && c.scopeKey === scope.scopeKey));
  safeWriteLsJson(LS_LOCAL_CUSTOMERS_KEY, nextAll);

  if (isIndexedDbSupported()) {
    openVaultDb()
      .then((db) => {
        const tx = db.transaction(STORE_LOCAL_CUSTOMERS, 'readwrite');
        tx.objectStore(STORE_LOCAL_CUSTOMERS).delete(id);
      })
      .catch(() => {});
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(POS_LOCAL_CUSTOMERS_EVENT));
  }
}

// ============================================================================
// 6. Offline Recent Sales Archive (Last 100 Receipts for Instant F9 Reprint)
// ============================================================================

export async function archiveCompletedPosSale(sale: Sale): Promise<void> {
  const scope = getActivePosVaultScope();
  if (!scope || !sale) return;

  const saleKey = String(sale.docNo || sale.id || '').trim();
  if (!saleKey) return;

  const stampedSale: Sale = {
    ...sale,
    createdAt: sale.createdAt || new Date().toISOString(),
  };

  const current = await getArchivedRecentPosSales(MAX_ARCHIVED_RECENT_SALES);
  const deduped = [
    stampedSale,
    ...current.filter((item) => String(item.docNo || item.id || '').trim() !== saleKey),
  ].slice(0, MAX_ARCHIVED_RECENT_SALES);

  memoryRecentSales.set(scope.scopeKey, deduped);

  if (isIndexedDbSupported()) {
    try {
      const db = await openVaultDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_RECENT_SALES, 'readwrite');
        tx.objectStore(STORE_RECENT_SALES).put({
          scopeKey: scope.scopeKey,
          tenantId: scope.tenantId,
          accountId: scope.accountId,
          sales: deduped,
          updatedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch {
      // Non-fatal
    }
  }
}

export async function getArchivedRecentPosSales(limit = 20): Promise<Sale[]> {
  const scope = getActivePosVaultScope();
  if (!scope) return [];

  if (isIndexedDbSupported()) {
    try {
      const db = await openVaultDb();
      const record = await new Promise<{ tenantId?: string; accountId?: string; sales?: Sale[] } | null>((resolve) => {
        const tx = db.transaction(STORE_RECENT_SALES, 'readonly');
        const req = tx.objectStore(STORE_RECENT_SALES).get(scope.scopeKey);
        req.onsuccess = () => resolve((req.result as { tenantId?: string; accountId?: string; sales?: Sale[] } | undefined) || null);
        req.onerror = () => resolve(null);
      });
      if (record && record.tenantId === scope.tenantId && record.accountId === scope.accountId && Array.isArray(record.sales)) {
        memoryRecentSales.set(scope.scopeKey, record.sales);
        return record.sales.slice(0, limit);
      }
    } catch {
      // Fall back to memory
    }
  }

  return (memoryRecentSales.get(scope.scopeKey) || []).slice(0, limit);
}
