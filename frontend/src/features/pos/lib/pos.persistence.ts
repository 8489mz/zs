import type { Sale } from '@/types/domain';
import type { HeldPosDraft, PosDraftSnapshot } from '@/features/pos/hooks/usePosWorkspace';
import { useAuthStore } from '@/stores/auth-store';

const POS_STORAGE_PREFIX = 'zsystems.react.pos';
const POS_DRAFT_STORAGE_KEY = `${POS_STORAGE_PREFIX}.draft`;
const POS_HELD_STORAGE_KEY = `${POS_STORAGE_PREFIX}.held`;
const POS_RECENT_STORAGE_KEY = `${POS_STORAGE_PREFIX}.recent`;
const POS_LAST_SALE_STORAGE_KEY = `${POS_STORAGE_PREFIX}.last-sale`;

const DRAFT_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 2;
const HELD_MAX_ITEMS = 15;
const HELD_MAX_AGE_MS = 1000 * 60 * 60 * 24 * 14;
const RECENT_MAX_ITEMS = 8;

interface StoredEnvelope<T> {
  savedAt: string;
  tenantId?: string;
  value: T;
}

function getActiveTenantId(): string {
  try {
    return String(useAuthStore.getState().user?.tenantId || useAuthStore.getState().tenant?.id || '').trim();
  } catch {
    return '';
  }
}

function safeParse<T>(value: string | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function getStorage() {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function readEnvelope<T>(key: string): StoredEnvelope<T> | null {
  const storage = getStorage();
  if (!storage) return null;
  const parsed = safeParse<StoredEnvelope<T> | null>(storage.getItem(key), null);
  if (!parsed || typeof parsed !== 'object' || !('savedAt' in parsed) || !('value' in parsed)) return null;
  const activeTenantId = getActiveTenantId();
  if (activeTenantId && parsed.tenantId && parsed.tenantId !== activeTenantId) {
    return null;
  }
  return parsed;
}

function writeEnvelope<T>(key: string, value: T) {
  const storage = getStorage();
  if (!storage) return;
  const activeTenantId = getActiveTenantId();
  const payload: StoredEnvelope<T> = {
    savedAt: new Date().toISOString(),
    ...(activeTenantId ? { tenantId: activeTenantId } : {}),
    value,
  };
  storage.setItem(key, JSON.stringify(payload));
}

function isFresh(savedAt: string, maxAgeMs: number) {
  const time = new Date(savedAt).getTime();
  return Number.isFinite(time) && Date.now() - time <= maxAgeMs;
}

export function buildDraftState(initial?: Partial<PosDraftSnapshot>): PosDraftSnapshot {
  const cName = (initial as any)?.customerName || (initial as any)?.quickCustomerName || '';
  const cPhone = (initial as any)?.customerPhone || (initial as any)?.quickCustomerPhone || '';
  const cAddress = (initial as any)?.customerAddress || (initial as any)?.quickCustomerAddress || '';

  return {
    cart: initial?.cart || [],
    customerId: initial?.customerId || '',
    customerName: cName,
    customerPhone: cPhone,
    customerAddress: cAddress,
    quickCustomerName: cName,
    quickCustomerPhone: cPhone,
    quickCustomerAddress: cAddress,
    discount: Number(initial?.discount || 0),
    deliveryFee: Number(initial?.deliveryFee || 0),
    paidAmount: Number(initial?.paidAmount || 0),
    cashAmount: Number(initial?.cashAmount || 0),
    cardAmount: Number(initial?.cardAmount || 0),
    transferAmount: Number(initial?.transferAmount || 0),
    paymentType: initial?.paymentType || 'cash',
    paymentChannel: initial?.paymentChannel || 'cash',
    note: initial?.note || '',
    search: initial?.search || '',
    priceType: initial?.priceType || 'retail',
    branchId: initial?.branchId || '',
    locationId: initial?.locationId || '',
    tableNumber: initial?.tableNumber || '',
    diningCourse: (initial as any)?.diningCourse || 'main',
    guestCount: Number((initial as any)?.guestCount || 1),
    guestCheckPrintedAt: (initial as any)?.guestCheckPrintedAt || null,
    orderType: (initial?.cart?.length || cPhone || (initial as any)?.onlineOrderId) ? (initial?.orderType || 'takeaway') : 'takeaway',
    onlineOrderId: (initial as any)?.onlineOrderId ? Number((initial as any).onlineOrderId) : undefined,
    /* INV-REST-HOLD-RECALL-TRUTH (R5-B): the fields the old autosave
     * never persisted — the localStorage path dropped them even though
     * the state held them, so a refresh reset tip/loyalty/pager/mode
     * and flipped a prepaid delivery back to COD. */
    deliveryRepId: (initial as any)?.deliveryRepId ? String((initial as any).deliveryRepId) : '',
    collectionStatus: (initial as any)?.collectionStatus || 'cod',
    tipAmount: Number((initial as any)?.tipAmount || 0),
    loyaltyPointsRedeemed: Number((initial as any)?.loyaltyPointsRedeemed || 0),
    pagerNumber: (initial as any)?.pagerNumber || '',
    deliveryFeeMode: (initial as any)?.deliveryFeeMode === 'store_fleet' || (initial as any)?.deliveryFeeMode === 'freelance_courier'
      ? (initial as any).deliveryFeeMode
      : 'freelance_courier',
    snapshotVersion: 1,
  };
}

export function loadPosWorkspaceStorage() {
  const draftEnvelope = readEnvelope<PosDraftSnapshot>(POS_DRAFT_STORAGE_KEY);
  const heldEnvelope = readEnvelope<HeldPosDraft[]>(POS_HELD_STORAGE_KEY);
  const recentEnvelope = readEnvelope<string[]>(POS_RECENT_STORAGE_KEY);
  const lastSaleEnvelope = readEnvelope<Sale>(POS_LAST_SALE_STORAGE_KEY);

  const draft = draftEnvelope && isFresh(draftEnvelope.savedAt, DRAFT_MAX_AGE_MS)
    ? buildDraftState(draftEnvelope.value)
    : null;

  const heldDrafts = (heldEnvelope?.value || [])
    .filter((entry) => entry && typeof entry === 'object' && typeof entry.savedAt === 'string')
    .filter((entry) => isFresh(entry.savedAt, HELD_MAX_AGE_MS))
    .slice(0, HELD_MAX_ITEMS)
    .map((entry) => ({ ...buildDraftState(entry), id: String(entry.id || Date.now()), savedAt: entry.savedAt }));

  const recentProductIds = Array.from(new Set((recentEnvelope?.value || []).map((item) => String(item || '')).filter(Boolean))).slice(0, RECENT_MAX_ITEMS);
  const lastSale = lastSaleEnvelope?.value || null;

  return { draft, heldDrafts, recentProductIds, lastSale };
}

export function persistDraftSnapshot(snapshot: PosDraftSnapshot) {
  writeEnvelope(POS_DRAFT_STORAGE_KEY, buildDraftState(snapshot));
}

export function clearDraftSnapshot() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(POS_DRAFT_STORAGE_KEY);
  storage.removeItem('zs_pos_online_order_id');
  storage.removeItem('zs_pos_online_order_number');
}

export function persistHeldDrafts(heldDrafts: HeldPosDraft[]) {
  writeEnvelope(POS_HELD_STORAGE_KEY, heldDrafts.slice(0, HELD_MAX_ITEMS));
}

export function persistRecentProductIds(recentProductIds: string[]) {
  writeEnvelope(POS_RECENT_STORAGE_KEY, Array.from(new Set(recentProductIds)).slice(0, RECENT_MAX_ITEMS));
}

export function persistLastSale(lastSale: Sale | null) {
  const storage = getStorage();
  if (!storage) return;
  if (!lastSale) {
    storage.removeItem(POS_LAST_SALE_STORAGE_KEY);
    return;
  }
  writeEnvelope(POS_LAST_SALE_STORAGE_KEY, lastSale);
}

export function clearPosWorkspaceStorage() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(POS_DRAFT_STORAGE_KEY);
  storage.removeItem(POS_HELD_STORAGE_KEY);
  storage.removeItem(POS_RECENT_STORAGE_KEY);
  storage.removeItem(POS_LAST_SALE_STORAGE_KEY);
  storage.removeItem('zs_pos_online_order_id');
  storage.removeItem('zs_pos_online_order_number');
  storage.removeItem('zsystems_pos_catalog_cache');
}
