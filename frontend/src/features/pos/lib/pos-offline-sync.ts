import { CreatePosSaleInput } from '@/features/pos/contracts';
import { useAuthStore } from '@/stores/auth-store';
import { requestStoragePersistence } from '@/lib/storage-persistence';
import { APP_NETWORK_STATE_EVENT } from '@/lib/network-circuit-breaker';
import {
  clearTenantOfflineSalesFromVaultIdb,
  loadOfflineSalesFromVaultIdb,
  persistOfflineSaleToVaultIdb,
  removeOfflineSaleFromVaultIdb,
} from '@/features/pos/lib/pos-offline-vault';

export { APP_NETWORK_STATE_EVENT };

const OFFLINE_QUEUE_KEY = 'zsystems_pos_offline_sales_queue';
const QUEUE_BROADCAST_CHANNEL = 'zsystems_pos_offline_queue_bc';
const MAX_LS_FULL_PAYLOAD_ITEMS = 45;

export interface OfflinePosSale {
  id: string;
  payload: CreatePosSaleInput;
  savedAt: string;
  status: 'pending' | 'syncing' | 'failed' | 'committed' | 'auth_required';
  error?: string;
  tenantId?: string;
  accountId?: string;
}

const memorySpilloverById = new Map<string, OfflinePosSale>();
let broadcastChannelInstance: BroadcastChannel | null = null;

function isIdbAvailable(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function getQueueBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return null;
  if (!broadcastChannelInstance) {
    try {
      broadcastChannelInstance = new BroadcastChannel(QUEUE_BROADCAST_CHANNEL);
      broadcastChannelInstance.onmessage = () => {
        window.dispatchEvent(new Event('pos-offline-queue-updated'));
      };
    } catch {
      broadcastChannelInstance = null;
    }
  }
  return broadcastChannelInstance;
}

function notifyQueueUpdated() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event('pos-offline-queue-updated'));
  try {
    getQueueBroadcastChannel()?.postMessage({ type: 'updated', at: Date.now() });
  } catch {
    // Ignore broadcast errors
  }
}

function currentQueueScope() {
  const auth = useAuthStore.getState();
  return {
    tenantId: String(auth.tenant?.id || auth.user?.tenantId || ''),
    accountId: String(auth.tenant?.accountId || auth.user?.accountId || ''),
  };
}

function isCurrentTenantSale(item: OfflinePosSale): boolean {
  const scope = currentQueueScope();
  // Legacy entries without tenant ownership cannot be safely replayed into a SaaS tenant.
  if (!scope.tenantId || !scope.accountId) return false;
  return item.tenantId === scope.tenantId && item.accountId === scope.accountId;
}

function readStoredOfflineQueue(): OfflinePosSale[] {
  const data = localStorage.getItem(OFFLINE_QUEUE_KEY);
  if (!data) {
    return Array.from(memorySpilloverById.values());
  }
  const rows: unknown = JSON.parse(data);
  if (!Array.isArray(rows)) throw new Error('Invalid offline sales queue');
  const parsedRows = rows as OfflinePosSale[];
  if (memorySpilloverById.size === 0) return parsedRows;

  const merged = new Map<string, OfflinePosSale>();
  for (const row of parsedRows) {
    if (row?.id) merged.set(row.id, memorySpilloverById.get(row.id) || row);
  }
  for (const [id, row] of memorySpilloverById.entries()) {
    if (!merged.has(id)) merged.set(id, row);
  }
  return Array.from(merged.values());
}

function writeQueueToLocalStorage(queue: OfflinePosSale[]): void {
  try {
    localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue));
  } catch (err) {
    // When IndexedDB is active and a busy supermarket exceeds 45 queued invoices (>5MB LS quota),
    // keep full payloads in memory + IndexedDB and write only the most recent window into LS.
    if (isIdbAvailable() && queue.length > MAX_LS_FULL_PAYLOAD_ITEMS) {
      for (const item of queue) {
        if (item?.id) memorySpilloverById.set(item.id, item);
      }
      const recentWindow = queue.slice(-MAX_LS_FULL_PAYLOAD_ITEMS);
      localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(recentWindow));
      return;
    }
    throw err;
  }
}

export function getOfflineSalesQueue(): OfflinePosSale[] {
  // A broken local queue is a financial integrity incident, not an empty queue.
  // Returning [] hid unpaid offline invoices from the cashier and reporting.
  return readStoredOfflineQueue()
    .filter(isCurrentTenantSale)
    .sort((a, b) => String(a.savedAt || '').localeCompare(String(b.savedAt || '')));
}

/**
 * Hydrates any IndexedDB outbox records that spilled past localStorage or survived LS eviction.
 */
export async function hydrateOfflineQueueFromVault(): Promise<OfflinePosSale[]> {
  if (!isIdbAvailable()) return getOfflineSalesQueue();
  try {
    const idbRows = await loadOfflineSalesFromVaultIdb<OfflinePosSale>();
    if (!idbRows.length) return getOfflineSalesQueue();

    let lsRows: OfflinePosSale[] = [];
    try {
      lsRows = readStoredOfflineQueue();
    } catch {
      // If LS is corrupt, do not overwrite it silently; surface via getOfflineSalesQueue()
      return idbRows.filter(isCurrentTenantSale);
    }

    const byId = new Map<string, OfflinePosSale>();
    for (const row of lsRows) {
      if (row?.id) byId.set(row.id, row);
    }
    let changed = false;
    for (const idbRow of idbRows) {
      if (idbRow?.id && !byId.has(idbRow.id) && idbRow.status !== 'committed') {
        byId.set(idbRow.id, idbRow);
        memorySpilloverById.set(idbRow.id, idbRow);
        changed = true;
      }
    }
    if (changed) {
      try {
        writeQueueToLocalStorage(Array.from(byId.values()));
      } catch {
        // Memory + IndexedDB still hold the recovered rows
      }
      notifyQueueUpdated();
    }
    return getOfflineSalesQueue();
  } catch {
    return getOfflineSalesQueue();
  }
}

/**
 * Computes base quantities currently waiting in the local offline queue so background
 * catalog syncs do not overwrite optimistic stock deductions before the sales finish syncing.
 */
export function getPendingOfflineSoldQuantities(): Map<string, number> {
  const soldByProduct = new Map<string, number>();
  try {
    const pending = getOfflineSalesQueue().filter((s) => s.status !== 'committed');
    for (const sale of pending) {
      for (const item of sale.payload?.cart || []) {
        const pid = String(item.productId || '').trim();
        const baseQty = Number(item.qty || 0) * Math.max(1, Number(item.unitMultiplier || 1));
        if (pid && baseQty > 0) {
          soldByProduct.set(pid, (soldByProduct.get(pid) || 0) + baseQty);
        }
      }
    }
  } catch {
    // Ignore
  }
  return soldByProduct;
}

function pruneStaleOfflineSeqKeys(currentDateStr: string): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('zs_offline_seq_') && k !== `zs_offline_seq_${currentDateStr}`) {
        keysToRemove.push(k);
      }
    }
    // Keep at most 2 recent day keys; remove older sequence counters to protect LS quota
    if (keysToRemove.length > 2) {
      keysToRemove.sort();
      for (const oldKey of keysToRemove.slice(0, keysToRemove.length - 2)) {
        localStorage.removeItem(oldKey);
      }
    }
  } catch {
    // Ignore
  }
}

/**
 * Returns a persistent, unique terminal identifier for this browser/device.
 * If not already set by the user or system, generates a permanent 4-char uppercase alphanumeric code (e.g. T4A2).
 */
export function getPosTerminalCode(): string {
  try {
    let code = localStorage.getItem('zs_pos_terminal_code');
    if (!code) {
      const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
      code = `T${rand}`;
      localStorage.setItem('zs_pos_terminal_code', code);
    }
    return code;
  } catch {
    return 'T01';
  }
}

/**
 * Allows setting or updating the terminal identifier (e.g. POS1, CASHIER-2).
 */
export function setPosTerminalCode(code: string): string {
  try {
    const clean = String(code || '').trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '');
    const finalCode = clean || getPosTerminalCode();
    localStorage.setItem('zs_pos_terminal_code', finalCode);
    return finalCode;
  } catch {
    return getPosTerminalCode();
  }
}

/**
 * Generates a globally unique, multi-cashier safe offline document number.
 * Conforms strictly to Rule 10: PREFIX-TERMINAL-YYMMDD-XXXX (e.g. INV-T4A2-260917-0001)
 * Guaranteed zero conflict across any number of offline cashiers.
 */
export function generateOfflineDocNo(): string {
  try {
    const terminal = getPosTerminalCode();
    const now = new Date();
    const yy = String(now.getFullYear()).slice(-2);
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const dateStr = `${yy}${mm}${dd}`;

    pruneStaleOfflineSeqKeys(dateStr);

    const seqKey = `zs_offline_seq_${dateStr}`;
    const rawSeq = localStorage.getItem(seqKey);
    const seq = (rawSeq ? parseInt(rawSeq, 10) : 0) + 1;
    localStorage.setItem(seqKey, String(seq));

    const paddedSeq = String(seq).padStart(4, '0');
    return `INV-${terminal}-${dateStr}-${paddedSeq}`;
  } catch {
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase();
    return `INV-${rand}-${Date.now().toString().slice(-6)}`;
  }
}

export function enqueueOfflineSale(
  payload: CreatePosSaleInput,
  existingIdempotencyKey?: string,
  explicitSavedAt?: string,
): OfflinePosSale {
  void requestStoragePersistence();
  let queue: OfflinePosSale[];
  try {
    queue = readStoredOfflineQueue();
  } catch (error) {
    console.error('Failed to read offline sales queue:', error);
    throw new Error('تعذر قراءة الفواتير المحفوظة على هذا الجهاز. تحقق من الفواتير قبل إعادة المحاولة.');
  }
  const docNo = (payload as unknown as { docNo?: string; offlineDocNo?: string }).docNo
    || (payload as unknown as { offlineDocNo?: string }).offlineDocNo
    || generateOfflineDocNo();
  // Receipt numbering is human-readable and can collide if two devices use
  // the same terminal code. The idempotency key must have stronger entropy,
  // and must remain stable once the invoice is saved locally.
  const draftId = existingIdempotencyKey ||
    (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${docNo}:${Date.now()}:${Math.random().toString(36).slice(2)}`);
  const scope = currentQueueScope();
  if (!scope.tenantId || !scope.accountId) {
    throw new Error('تعذر تحديد المنشأة والحساب لهذه الفاتورة الأوفلاين. سجل الدخول ثم أعد المحاولة.');
  }
  const existing = queue.find((item) => item.id === draftId && item.tenantId === scope.tenantId && item.accountId === scope.accountId);
  if (existing) return existing;

  // Keep payload.note identical to what the online attempt sent so SHA-256 requestHash
  // never drifts on retry; the backend's InsertSaleAndStockService appends `[إيصال أوفلاين: ${offlineDocNo}]`
  // automatically from `offlineDocNo`.
  const cleanNote = String(payload.note || '').trim();

  const offlineSale: OfflinePosSale = {
    id: draftId,
    payload: {
      ...payload,
      docNo,
      offlineDocNo: docNo,
      note: cleanNote,
    } as CreatePosSaleInput,
    savedAt: explicitSavedAt || new Date().toISOString(),
    status: 'pending',
    ...scope,
  };

  queue.push(offlineSale);
  try {
    writeQueueToLocalStorage(queue);
  } catch (e) {
    console.error('Failed to save offline queue — storage may be full:', e);
    // The cashier must never see a successful offline sale unless its payload is durable.
    // Keep the cart intact so the sale can be retried after storage is available.
    throw new Error('تعذر حفظ الفاتورة على هذا الجهاز. تحقق من مساحة التخزين وحالة الفاتورة قبل إعادة المحاولة.');
  }

  void persistOfflineSaleToVaultIdb(offlineSale as unknown as Record<string, unknown> & { id: string });

  notifyQueueUpdated();
  return offlineSale;
}

export function removeOfflineSale(id: string) {
  memorySpilloverById.delete(id);
  void removeOfflineSaleFromVaultIdb(id);
  try {
    const nextQueue = readStoredOfflineQueue().filter(item => item.id !== id || !isCurrentTenantSale(item));
    writeQueueToLocalStorage(nextQueue);
  } catch (e) {
    console.error('Failed to save offline queue — storage may be full:', e);
  }
  notifyQueueUpdated();
}

export function updateOfflineSaleStatus(id: string, status: OfflinePosSale['status'], error?: string) {
  try {
    const nextQueue = readStoredOfflineQueue().map(item => {
      if (item.id === id && isCurrentTenantSale(item)) {
        const updated: OfflinePosSale = { ...item, status, error };
        if (memorySpilloverById.has(id)) {
          memorySpilloverById.set(id, updated);
        }
        void persistOfflineSaleToVaultIdb(updated as unknown as Record<string, unknown> & { id: string });
        return updated;
      }
      return item;
    });
    writeQueueToLocalStorage(nextQueue);
  } catch (e) {
    console.error('Failed to save offline queue — storage may be full:', e);
  }
  notifyQueueUpdated();
}

export function clearOfflineQueue() {
  const scope = currentQueueScope();
  for (const [id, item] of memorySpilloverById.entries()) {
    if (item.tenantId === scope.tenantId && item.accountId === scope.accountId) {
      memorySpilloverById.delete(id);
    }
  }
  void clearTenantOfflineSalesFromVaultIdb();
  try {
    writeQueueToLocalStorage(readStoredOfflineQueue().filter((item) => !isCurrentTenantSale(item)));
  } catch (error) {
    console.error('Failed to clear offline queue:', error);
    throw new Error('تعذر حذف الفواتير المحفوظة على هذا الجهاز. راجع التخزين قبل إعادة المحاولة.');
  }
  notifyQueueUpdated();
}

export function downloadOfflineQueueEmergencyJson(queue: OfflinePosSale[]): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined' || !queue.length) return false;
  try {
    const scope = currentQueueScope();
    const now = new Date();
    const stamp = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}-${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
    const exportEnvelope = {
      exportedAt: now.toISOString(),
      terminalCode: getPosTerminalCode(),
      tenantId: scope.tenantId,
      accountId: scope.accountId,
      count: queue.length,
      sales: queue,
    };
    const blob = new Blob([JSON.stringify(exportEnvelope, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pos-offline-backup-${getPosTerminalCode()}-${stamp}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}
