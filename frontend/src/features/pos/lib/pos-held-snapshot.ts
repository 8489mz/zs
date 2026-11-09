/* INV-REST-HOLD-RECALL-TRUTH (R5-B, I29/I30/I31): one versioned snapshot.
 *
 * There are three snapshots of a POS draft (server held draft, localStorage
 * live draft, in-memory workspace state) and the bug was three
 * hand-maintained field lists drifting apart. PosDraftSnapshot is the
 * single shape for all three paths: buildHeldSnapshot (hold -> server),
 * buildDraftState (autosave -> localStorage) and mapHeldSalesRows
 * (server -> recall) all map the same field list, and the spec asserts
 * the lists stay in sync. A field added to one path and missing from
 * another fails the spec.
 *
 * Session markers (priceHeldAt / heldUnavailable) are deliberately NOT
 * snapshot fields: they mark a line restored from a hold in this session
 * so syncPosCartStock freezes its price. buildHeldSnapshot strips them;
 * restoreHeldSnapshot sets priceHeldAt.
 */

import type { PosDraftSnapshot } from '@/features/pos/hooks/usePosWorkspace';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import type { PaymentChannel, PaymentType } from '@/features/pos/hooks/usePosWorkspace';

export const HELD_SNAPSHOT_VERSION = 1;

/* Header fields (everything except cart / id / savedAt) that must survive
 * every snapshot path. The spec asserts buildHeldSnapshot and
 * buildDraftState both carry every one of these. */
export const HELD_SNAPSHOT_HEADER_FIELDS = [
  'customerId',
  'customerName',
  'customerPhone',
  'customerAddress',
  'quickCustomerName',
  'quickCustomerPhone',
  'quickCustomerAddress',
  'discount',
  'deliveryFee',
  'paidAmount',
  'cashAmount',
  'cardAmount',
  'transferAmount',
  'paymentType',
  'paymentChannel',
  'note',
  'search',
  'priceType',
  'branchId',
  'locationId',
  'tableNumber',
  'diningCourse',
  'guestCount',
  'guestCheckPrintedAt',
  'orderType',
  'deliveryRepId',
  'collectionStatus',
  'onlineOrderId',
  'tipAmount',
  'loyaltyPointsRedeemed',
  'pagerNumber',
  'deliveryFeeMode',
] as const;

export interface HeldSnapshotState {
  cart: PosItem[];
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  quickCustomerName?: string;
  quickCustomerPhone?: string;
  quickCustomerAddress?: string;
  discount?: number;
  deliveryFee?: number;
  paidAmount?: number;
  cashAmount?: number;
  cardAmount?: number;
  transferAmount?: number;
  paymentType?: PaymentType;
  paymentChannel?: PaymentChannel;
  note?: string;
  search?: string;
  priceType?: PosPriceType;
  branchId?: string;
  locationId?: string;
  tableNumber?: string;
  diningCourse?: string;
  guestCount?: number;
  guestCheckPrintedAt?: string | null;
  orderType?: string;
  deliveryRepId?: string;
  collectionStatus?: string;
  onlineOrderId?: number;
  tipAmount?: number;
  loyaltyPointsRedeemed?: number;
  pagerNumber?: string;
  deliveryFeeMode?: 'freelance_courier' | 'store_fleet' | string;
}

export interface RestoredHeldHeader {
  customerId: string;
  customerName: string;
  customerPhone: string;
  customerAddress: string;
  quickCustomerName: string;
  quickCustomerPhone: string;
  quickCustomerAddress: string;
  discount: number;
  deliveryFee: number;
  paidAmount: number;
  cashAmount: number;
  cardAmount: number;
  transferAmount: number;
  paymentType: PaymentType;
  paymentChannel: PaymentChannel;
  note: string;
  search: string;
  priceType: PosPriceType;
  branchId: string;
  locationId: string;
  tableNumber: string;
  diningCourse: string;
  guestCount: number;
  guestCheckPrintedAt: string | null;
  orderType: string;
  deliveryRepId: string;
  collectionStatus: string;
  onlineOrderId?: number;
  tipAmount: number;
  loyaltyPointsRedeemed: number;
  pagerNumber: string;
  deliveryFeeMode?: 'freelance_courier' | 'store_fleet';
}

function toDeliveryFeeMode(raw: unknown): 'freelance_courier' | 'store_fleet' | undefined {
  return raw === 'store_fleet' || raw === 'freelance_courier' ? raw : undefined;
}

/* Build the single versioned snapshot from workspace state (hold path).
 * Session markers are stripped: a re-held recalled cart must not send
 * priceHeldAt / heldUnavailable to the server (the DTO rejects
 * non-whitelisted fields). */
export function buildHeldSnapshot(state: HeldSnapshotState): PosDraftSnapshot {
  return {
    snapshotVersion: HELD_SNAPSHOT_VERSION,
    cart: state.cart.map((item) => {
      const { priceHeldAt, heldUnavailable, ...snapshotLine } = item;
      void priceHeldAt;
      void heldUnavailable;
      return snapshotLine;
    }),
    customerId: state.customerId || '',
    customerName: state.customerName || '',
    customerPhone: state.customerPhone || '',
    customerAddress: state.customerAddress || '',
    quickCustomerName: state.quickCustomerName || state.customerName || '',
    quickCustomerPhone: state.quickCustomerPhone || state.customerPhone || '',
    quickCustomerAddress: state.quickCustomerAddress || state.customerAddress || '',
    discount: Number(state.discount || 0),
    deliveryFee: Number(state.deliveryFee || 0),
    paidAmount: Number(state.paidAmount || 0),
    cashAmount: Number(state.cashAmount || 0),
    cardAmount: Number(state.cardAmount || 0),
    transferAmount: Number(state.transferAmount || 0),
    paymentType: state.paymentType || 'cash',
    paymentChannel: state.paymentChannel || 'cash',
    note: state.note || '',
    search: state.search || '',
    priceType: state.priceType || 'retail',
    branchId: state.branchId || '',
    locationId: state.locationId || '',
    tableNumber: state.tableNumber || '',
    diningCourse: state.diningCourse || 'main',
    guestCount: Number(state.guestCount || 1),
    guestCheckPrintedAt: state.guestCheckPrintedAt || null,
    orderType: state.orderType || 'takeaway',
    deliveryRepId: state.deliveryRepId || '',
    collectionStatus: state.collectionStatus || 'cod',
    onlineOrderId: state.onlineOrderId ? Number(state.onlineOrderId) : undefined,
    tipAmount: Number(state.tipAmount || 0),
    loyaltyPointsRedeemed: Number(state.loyaltyPointsRedeemed || 0),
    pagerNumber: state.pagerNumber || '',
    deliveryFeeMode: toDeliveryFeeMode(state.deliveryFeeMode) || 'freelance_courier',
  };
}

/* Restore a held snapshot into cart lines + a header patch (recall path).
 * Every stored line field survives verbatim, including the stored lineKey
 * (two identical product/unit/price lines keep distinct keys) and the
 * serials / offer / weighted fields the old hold dropped. Each restored
 * line carries priceHeldAt so syncPosCartStock freezes its price instead
 * of repricing it from the current catalog. A missing lineKey is left
 * empty here on purpose: recallDraft's synthesis line (owned by R5-C)
 * fills it. */
export function restoreHeldSnapshot(draft: PosDraftSnapshot): { cart: PosItem[]; header: RestoredHeldHeader } {
  const now = Date.now();
  const cart = (draft.cart || []).map((item) => {
    const line = item as Partial<PosItem>;
    return {
      ...line,
      lineKey: String(line.lineKey || ''),
      productId: String(line.productId || ''),
      name: String(line.name || ''),
      unitId: String(line.unitId || ''),
      unitName: String(line.unitName || 'قطعة'),
      unitMultiplier: Number(line.unitMultiplier || 1) || 1,
      price: Number(line.price || 0),
      costPrice: Number(line.costPrice || 0),
      qty: Number(line.qty || 0),
      stockLimit: Number(line.stockLimit || 0),
      currentStock: Number(line.currentStock || 0),
      minStock: Number(line.minStock || 0),
      priceType: line.priceType === 'wholesale' ? 'wholesale' : 'retail',
      priceHeldAt: now,
    } as PosItem;
  });
  const header: RestoredHeldHeader = {
    customerId: String((draft as any).customerId || ''),
    customerName: String((draft as any).customerName || ''),
    customerPhone: String((draft as any).customerPhone || ''),
    customerAddress: String((draft as any).customerAddress || ''),
    quickCustomerName: String((draft as any).quickCustomerName || (draft as any).customerName || ''),
    quickCustomerPhone: String((draft as any).quickCustomerPhone || (draft as any).customerPhone || ''),
    quickCustomerAddress: String((draft as any).quickCustomerAddress || (draft as any).customerAddress || ''),
    discount: Number(draft.discount || 0),
    deliveryFee: Number((draft as any).deliveryFee || 0),
    paidAmount: Number((draft as any).paidAmount || 0),
    cashAmount: Number((draft as any).cashAmount || 0),
    cardAmount: Number((draft as any).cardAmount || 0),
    transferAmount: Number((draft as any).transferAmount || 0),
    paymentType: (draft as any).paymentType === 'credit' ? 'credit' : 'cash',
    paymentChannel: (draft as any).paymentChannel || 'cash',
    note: String((draft as any).note || ''),
    search: String((draft as any).search || ''),
    priceType: (draft as any).priceType === 'wholesale' ? 'wholesale' : 'retail',
    branchId: String((draft as any).branchId || ''),
    locationId: String((draft as any).locationId || ''),
    tableNumber: String((draft as any).tableNumber || ''),
    diningCourse: String((draft as any).diningCourse || 'main'),
    guestCount: Number((draft as any).guestCount || 1),
    guestCheckPrintedAt: (draft as any).guestCheckPrintedAt || null,
    orderType: String((draft as any).orderType || 'takeaway'),
    deliveryRepId: String((draft as any).deliveryRepId || ''),
    collectionStatus: String((draft as any).collectionStatus || 'cod'),
    onlineOrderId: (draft as any).onlineOrderId ? Number((draft as any).onlineOrderId) : undefined,
    tipAmount: Number((draft as any).tipAmount || 0),
    loyaltyPointsRedeemed: Number((draft as any).loyaltyPointsRedeemed || 0),
    pagerNumber: String((draft as any).pagerNumber || ''),
    deliveryFeeMode: toDeliveryFeeMode((draft as any).deliveryFeeMode),
  };
  return { cart, header };
}

/* M32: branch / location are derived from settings (usePosOperationalContext)
 * and have no setter, so a recalled draft's branch/location is carried as a
 * workspace override: recallDraft writes it, usePosWorkspace reads it (and
 * clears it when the cart empties, i.e. after a hold / submit / manual
 * clear). Kept in localStorage so a refresh mid-recall keeps the branch. */
export const RECALLED_BRANCH_STORAGE_KEY = 'zs_pos_recalled_branch_id';
export const RECALLED_LOCATION_STORAGE_KEY = 'zs_pos_recalled_location_id';
export const RECALLED_BRANCH_EVENT = 'zs_pos_recalled_branch';

export function readRecalledBranchLocation(): { branchId: string; locationId: string } {
  try {
    return {
      branchId: String(localStorage.getItem(RECALLED_BRANCH_STORAGE_KEY) || ''),
      locationId: String(localStorage.getItem(RECALLED_LOCATION_STORAGE_KEY) || ''),
    };
  } catch {
    return { branchId: '', locationId: '' };
  }
}

export function writeRecalledBranchLocation(branchId: string, locationId: string): void {
  try {
    if (branchId) localStorage.setItem(RECALLED_BRANCH_STORAGE_KEY, branchId);
    else localStorage.removeItem(RECALLED_BRANCH_STORAGE_KEY);
    if (locationId) localStorage.setItem(RECALLED_LOCATION_STORAGE_KEY, locationId);
    else localStorage.removeItem(RECALLED_LOCATION_STORAGE_KEY);
  } catch {
    /* storage unavailable: the workspace keeps the settings branch. */
  }
  try {
    window.dispatchEvent(new CustomEvent(RECALLED_BRANCH_EVENT, { detail: { branchId, locationId } }));
  } catch {
    /* non-DOM environment (specs): the stored values are the source. */
  }
}

export function clearRecalledBranchLocation(): void {
  writeRecalledBranchLocation('', '');
}
