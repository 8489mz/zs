import { AppError } from '../../../common/errors/app-error';
import { ensureNonNegativeStock } from '../../../common/utils/financial-integrity';

export type StockCountProductSnapshot = {
  id?: number | string;
  name?: string | null;
  stock_qty?: number | string | null;
};

export type StockCountInputItem = {
  productId: number;
  countedQty?: number | string | null;
  reason?: string | null;
  note?: string | null;
};

export type StockCountStoredItem = {
  product_id: number;
  expected_qty?: number | string | null;
  counted_qty?: number | string | null;
  variance_qty?: number | string | null;
  reason?: string | null;
  note?: string | null;
};

export type StockCountSessionScope = {
  branch_id?: number | string | null;
  location_id?: number | string | null;
};

export type DamagedStockPayloadLike = {
  productId: number;
  qty?: number | string | null;
  reason?: string | null;
  note?: string | null;
};

export type InventoryLocationScope = {
  id: number;
  branchId?: number | null;
};

export function assertInventoryLocationBranchMatch(selectedBranchId: number | string | null | undefined, locationBranchId: number | null | undefined): void {
  if (selectedBranchId && locationBranchId && Number(selectedBranchId) !== Number(locationBranchId)) {
    throw new AppError('Location does not belong to the selected branch', 'LOCATION_BRANCH_MISMATCH', 400);
  }
}

export function buildStockCountSessionDocNo(now = Date.now(), sessionId?: number): string {
  const d = new Date(now);
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const suffix = sessionId == null ? String(now).slice(-4) : String(sessionId).padStart(6, '0');
  return `ZSC-${yy}${mm}${dd}-${suffix}`;
}

export function buildStockCountItemValues(product: StockCountProductSnapshot, item: StockCountInputItem, sessionId: number) {
  const expectedQty = Number(product.stock_qty || 0);
  const countedQty = Number(item.countedQty || 0);
  if (!Number.isFinite(countedQty) || countedQty < 0 ||
    Math.abs(countedQty * 1000 - Math.round(countedQty * 1000)) > 0.000001) {
    throw new AppError('الكمية الفعلية للجرد يجب أن تكون موجبة أو صفر وبدقة ثلاث خانات عشرية', 'STOCK_COUNT_QUANTITY_INVALID', 400);
  }
  const varianceQty = Number((countedQty - expectedQty).toFixed(3));

  return {
    session_id: sessionId,
    product_id: item.productId,
    product_name: String(product.name || ''),
    expected_qty: expectedQty,
    counted_qty: countedQty,
    variance_qty: varianceQty,
    reason: String(item.reason || ''),
    note: String(item.note || ''),
  };
}

export function buildStockCountPostingMovement(item: StockCountStoredItem, sessionId: number, userId: number, actualDelta?: number) {
  const expectedQty = Number(item.expected_qty || 0);
  const countedQty = Number(item.counted_qty || 0);
  const varianceQty = Number(item.variance_qty || 0);
  // INV-STOCK-COUNT-ACTUAL-DELTA: the posted quantity is the actual
  // scoped delta (scopeAfter - scopeBefore), not the frozen
  // available-basis variance. Callers that do not pass it keep the
  // old variance behaviour (helper-level default only).
  const qty = actualDelta ?? varianceQty;

  return {
    product_id: item.product_id,
    movement_type: qty > 0 || (qty === 0 && varianceQty > 0) ? 'stock_count_gain' : 'stock_count_loss',
    qty,
    before_qty: expectedQty,
    after_qty: countedQty,
    reason: item.reason || 'inventory_count',
    note: item.note || '',
    reference_type: 'stock_count_session' as const,
    reference_id: sessionId,
    created_by: userId,
  };
}

export function shouldCreateDamageRecordFromCount(item: Pick<StockCountStoredItem, 'reason' | 'variance_qty'>): boolean {
  return String(item.reason || '').toLowerCase() === 'damage' && Number(item.variance_qty || 0) < -0.0001;
}

export function buildDamageRecordFromCount(item: StockCountStoredItem, session: StockCountSessionScope, userId: number, actualDelta?: number) {
  const varianceQty = actualDelta ?? Number(item.variance_qty || 0);
  return {
    product_id: item.product_id,
    branch_id: session.branch_id == null ? null : Number(session.branch_id),
    location_id: session.location_id == null ? null : Number(session.location_id),
    qty: Math.abs(Math.min(varianceQty, 0)) || Math.abs(varianceQty),
    reason: 'damage',
    note: item.note || 'جلسة جرد',
    created_by: userId,
  };
}

export function assertDamagedStockNote(note: string | null | undefined): void {
  if (!String(note || '').trim()) {
    throw new AppError('اكتب سبب التالف', 'DAMAGE_NOTE_REQUIRED', 400);
  }
}

export function buildDamagedStockWriteModels(product: StockCountProductSnapshot, payload: DamagedStockPayloadLike, location: InventoryLocationScope, userId: number) {
  const beforeQty = Number(product.stock_qty || 0);
  const damageQty = Number(payload.qty || 0);
  const afterQty = beforeQty - damageQty;
  ensureNonNegativeStock(afterQty, 'INSUFFICIENT_STOCK', 'Cannot mark more damaged stock than current stock');

  return {
    nextStockQty: afterQty,
    stockMovement: {
      product_id: payload.productId,
      movement_type: 'damaged' as const,
      qty: -damageQty,
      before_qty: beforeQty,
      after_qty: afterQty,
      reason: payload.reason || 'damage',
      note: payload.note || '',
      reference_type: 'damaged_stock' as const,
      reference_id: payload.productId,
      created_by: userId,
    },
    damagedRecord: {
      product_id: payload.productId,
      branch_id: location.branchId ?? null,
      location_id: location.id,
      qty: damageQty,
      reason: payload.reason || 'damage',
      note: payload.note || '',
      created_by: userId,
    },
  };
}
