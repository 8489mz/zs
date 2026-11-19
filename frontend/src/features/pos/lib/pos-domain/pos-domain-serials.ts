import type { MoneyDigits } from '@/shared/utils/money';
import type { Product } from '@/types/domain';
import type { PosItem } from '@/features/pos/types/pos.types';
import { normalizeSaleQuantity } from '@/features/pos/lib/pos-domain/pos-domain-helpers';
import { repriceCartLine, UNBOUNDED_STOCK_LIMIT } from '@/features/pos/lib/pos-domain/pos-domain-pricing';

/* Serial entry on a cart line (LF-P3): before this fix a serial-tracked line
 * added by tile/tap/search carried no serials and the cart offered no way to
 * enter one, so the cashier hit a dead end at confirm (validatePosSaleInput
 * demands one unique serial per piece). These pure helpers are the cart-side
 * half of the entry path: the live stock/ownership check against
 * productSerialsApi.lookup happens in the entry UI, these helpers only
 * enforce the cart-side rules (dedup, capacity, count == qty). */
export function normalizeSerialNumber(serial: string): string {
  return String(serial || '').trim().toLowerCase();
}

/** How many serials a line needs: one per piece (qty x unit multiplier). */
export function getRequiredSerialCount(item: PosItem): number {
  const count = Number(item.qty || 0) * Number(item.unitMultiplier || 1);
  return Number.isInteger(count) && count > 0 ? count : 0;
}

export function getSerialEntryState(item: PosItem) {
  const required = getRequiredSerialCount(item);
  const entered = (item.serials || []).length;
  return {
    required,
    entered,
    missing: Math.max(0, required - entered),
    complete: required > 0 && entered === required,
  };
}

/* When the quantity drops below the serials already entered, keep the first
 * serials up to the new required count (the last-entered one goes). A
 * non-integer required count leaves serials untouched — that line can never
 * pass validation anyway, and silently dropping its serials would hide data. */
export function trimSerialsToRequiredCount(serials: string[] | undefined, item: PosItem, qty: number): string[] | undefined {
  const count = Number(qty || 0) * Number(item.unitMultiplier || 1);
  if (!Number.isInteger(count) || count <= 0) return serials;
  if (!serials || serials.length <= count) return serials;
  const kept = serials.slice(0, count);
  return kept.length > 0 ? kept : undefined;
}

export function addSerialToPosLine(cart: PosItem[], lineKey: string, serial: string): PosItem[] {
  const clean = normalizeSerialNumber(serial);
  const line = cart.find((item) => item.lineKey === lineKey);
  if (!line) throw new Error('تعذّر العثور على سطر السلة لإضافة السيريال.');
  if (!line.trackSerials) throw new Error(`الصنف ${line.name} لا يتطلب سيريالاً.`);
  if (!clean) throw new Error('أدخل رقم السيريال أولاً.');
  const existing = line.serials || [];
  if (existing.some((entry) => normalizeSerialNumber(entry) === clean)) {
    throw new Error(`السيريال ${serial.trim()} مضاف بالفعل إلى ${line.name}.`);
  }
  if (cart.some((item) => item.lineKey !== lineKey && (item.serials || []).some((entry) => normalizeSerialNumber(entry) === clean))) {
    throw new Error(`السيريال ${serial.trim()} مضاف بالفعل إلى سطر آخر في السلة.`);
  }
  const required = getRequiredSerialCount(line);
  if (required > 0 && existing.length >= required) {
    throw new Error(`اكتملت سيريالات ${line.name} (${existing.length} من ${required}) — احذف سيريالاً قبل إضافة آخر.`);
  }
  return cart.map((item) => (item.lineKey === lineKey
    ? { ...item, serials: [...existing, serial.trim()] }
    : item));
}

export function removeSerialFromPosLine(cart: PosItem[], lineKey: string, serial: string): PosItem[] {
  const clean = normalizeSerialNumber(serial);
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    const kept = (item.serials || []).filter((entry) => normalizeSerialNumber(entry) !== clean);
    return { ...item, serials: kept.length > 0 ? kept : undefined };
  });
}

/** Live-lookup verdict for a typed/scanned serial: a specific error naming
 * the serial and the reason, or null when the serial may be added. */
export interface SerialLookupEntry {
  productId: string;
  status: string;
  productName?: string | null;
}

const SERIAL_STATUS_LABELS: Record<string, string> = {
  sold: 'مباع',
  returned: 'مرتجع',
  transferred: 'منقول',
  damaged: 'تالف',
};

export function getSerialLookupError(serial: string, entry: SerialLookupEntry | null, productId: string, productName: string): string | null {
  const display = String(serial || '').trim();
  if (!entry) return `السيريال ${display} غير مسجّل في النظام.`;
  if (String(entry.productId) !== String(productId)) {
    return `السيريال ${display} مسجّل لصنف آخر${entry.productName ? ` (${entry.productName})` : ''} وليس ${productName}.`;
  }
  if (entry.status !== 'in_stock') {
    const label = SERIAL_STATUS_LABELS[entry.status] || entry.status;
    return `السيريال ${display} غير متاح للبيع — حالته: ${label}.`;
  }
  return null;
}

export function updatePosItemQtyWithOptions(
  cart: PosItem[],
  lineKey: string,
  qty: number,
  products: Product[],
  options: { allowNegativeStockSales?: boolean; quantityChunks?: number[] | null; digits: MoneyDigits },
) {
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    const isWeighted = item.isWeighted === true;
    const normalizedQty = normalizeSaleQuantity(qty, isWeighted);
    const product = products.find((entry) => String(entry.id) === String(item.productId));
    const resolvedChunks = options.quantityChunks === null ? undefined : (options.quantityChunks || item.quantityChunks);
    if (!product) {
      const nextQty = options.allowNegativeStockSales ? normalizedQty : Math.min(normalizedQty, item.stockLimit);
      return { ...item, qty: nextQty, quantityChunks: resolvedChunks, serials: trimSerialsToRequiredCount(item.serials, item, nextQty) };
    }
    const stockLimit = options.allowNegativeStockSales || !!product.hasBom ? UNBOUNDED_STOCK_LIMIT : item.stockLimit;
    const finalQty = options.allowNegativeStockSales || !!product.hasBom ? normalizedQty : Math.min(normalizedQty, stockLimit);
    return repriceCartLine({ ...item, quantityChunks: resolvedChunks }, product, finalQty, options.digits);
  });
}

export function removePosItem(cart: PosItem[], lineKey: string) {
  return cart.filter((row) => row.lineKey !== lineKey);
}
