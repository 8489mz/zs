import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import type { Product, ProductOffer, ProductUnit } from '@/types/domain';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import { todayLocalDateKey } from '@/lib/format';

export { todayLocalIsoDate } from '@/features/pos/lib/pos-domain/pos-domain-helpers';

export { isOfferHappyHourActive, getOfferAppliedPrice } from '@/features/pos/lib/pos-domain/pos-domain-offers';

export { getSaleUnit, getStockLimit, isNegativeStockSalesAllowed, getProductItemCode, getProductPrice, getOfferDisplayName, repriceCartLine, getAvailableSaleProducts } from '@/features/pos/lib/pos-domain/pos-domain-pricing';

export { PosLineModifierLike, modifiersSignature, BuildPosLineKeyInput, buildPosLineKey, posLineNotesMatch, isServiceProduct } from '@/features/pos/lib/pos-domain/pos-domain-line-keys';

export { addPosItem, updatePosItemNotes, updatePosItemLineDiscount } from '@/features/pos/lib/pos-domain/pos-domain-cart-add';

export { ComboSelection, ApplyComboToCartOptions, buildComboLineKey, applyComboToCart, updatePosItemModifiers, updatePosItemSeat } from '@/features/pos/lib/pos-domain/pos-domain-combo';

export { PosLineTransferItem, applyPosLineTransfer } from '@/features/pos/lib/pos-domain/pos-domain-transfer';

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
function trimSerialsToRequiredCount(serials: string[] | undefined, item: PosItem, qty: number): string[] | undefined {
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

export function syncPosCartStock(cart: PosItem[], products: Product[], options: { allowNegativeStockSales?: boolean; digits: MoneyDigits }) {
  let changed = false;
  let removedCount = 0;
  let clampedCount = 0;
  let heldUnavailableCount = 0;

  const nextCart = cart.flatMap((item) => {
    const product = products.find((entry) => String(entry.id) === String(item.productId));
    if (!product) return [item];
    const unit = safeUnits(product).find((entry) => String(entry.id || '') === String(item.unitId || '') || String(entry.name || '') === String(item.unitName || '')) || getSaleUnit(product);
    const isWeighted = item.isWeighted === true;
    const minQty = getMinimumSaleQuantity(isWeighted);
    // INV-SERVICE-STOCK-NO-STOCK-CHECK: services sell without stock —
    // the same exemption addPosItem already applies at the add. Without
    // it a 0-stock service line was removed here (limit 0 < minQty 1).
    const isService = isServiceProduct(product);
    const stockLimit = (options.allowNegativeStockSales || !!product.hasBom || isService) ? UNBOUNDED_STOCK_LIMIT : getResolvedStockLimit(product, unit, isWeighted);
    /* INV-REST-HOLD-RECALL-TRUTH (R5-B): a held price is the agreed
     * price. A line restored from a hold (priceHeldAt) is never
     * repriced and never silently deleted: a stock-out held line is
     * KEPT and flagged so the cashier decides (remove or replace);
     * submit still enforces stock. Only the stock figures refresh. */
    if (item.priceHeldAt != null) {
      const heldUnavailable = stockLimit < minQty;
      if (heldUnavailable) heldUnavailableCount += 1;
      if (
        heldUnavailable !== Boolean(item.heldUnavailable)
        || Number(stockLimit) !== Number(item.stockLimit)
        || Number(product.stock || 0) !== Number(item.currentStock)
      ) {
        changed = true;
        return [{ ...item, stockLimit, currentStock: Number(product.stock || 0), heldUnavailable }];
      }
      return [item];
    }
    if (stockLimit < minQty) {
      changed = true;
      removedCount += 1;
      return [];
    }

    const normalizedQty = normalizeSaleQuantity(Number(item.qty || minQty), isWeighted);
    const nextQty = Math.min(normalizedQty, stockLimit);
    const nextItem = {
      ...item,
      name: product.name || item.name,
      unitId: String(unit.id || item.unitId || ''),
      unitName: unit.name || item.unitName,
      itemCode: getProductItemCode(product, unit) || item.itemCode,
      unitMultiplier: Number.isFinite(Number(unit.multiplier)) && Number(unit.multiplier) > 0 ? Number(unit.multiplier) : 1,
      stockLimit,
      currentStock: Number(product.stock || 0),
      minStock: Number(product.minStock || 0),
      price: getProductPrice(product, item.priceType, nextQty, Number(unit.multiplier) > 0 ? Number(unit.multiplier) : 1, options.digits),
      qty: nextQty,
      quantityChunks: nextQty === Number(item.qty || 0) ? item.quantityChunks : undefined,
      serials: trimSerialsToRequiredCount(item.serials, item, nextQty),
    };

    if (nextQty !== item.qty) {
      changed = true;
      clampedCount += 1;
    }

    if (
      String(nextItem.name || '') !== String(item.name || '')
      || Number(nextItem.stockLimit) !== Number(item.stockLimit)
      || Number(nextItem.currentStock) !== Number(item.currentStock)
      || Number(nextItem.minStock) !== Number(item.minStock)
      || Number(nextItem.unitMultiplier) !== Number(item.unitMultiplier)
      || Number(nextItem.price) !== Number(item.price)
      || String(nextItem.unitId || '') !== String(item.unitId || '')
      || String(nextItem.unitName || '') !== String(item.unitName || '')
    ) {
      changed = true;
    }

    return [nextItem];
  });

  return {
    cart: changed ? nextCart : cart,
    removedCount,
    clampedCount,
    heldUnavailableCount,
  };
}

export function normalizeUnitName(rawUnit?: string): string {
  const trimmed = String(rawUnit || '').trim();
  if (!trimmed) return 'قطعة';

  const lower = trimmed.toLowerCase().replace(/\s+/g, ' ');

  // Keep kg and g in English as short abbreviations.
  // SPICE-PKG3 (b): cover every weighed spelling the catalog
  // actually uses — 'كيلو جرام' (spaced) and 'كيلوغرام' /
  // 'kilo' / 'kilogram' (manufacturing unit aliases) and 'جم'
  // (van-services weight regex) were all returned raw before,
  // so a tile/search add of those products never counted as weighed.
  if (lower === 'kg' || lower === 'كجم' || lower === 'كيلو' || lower === 'كيلوجرام' || lower === 'كيلوغرام' || lower === 'كيلو جرام' || lower === 'kilo' || lower === 'kilogram' || lower === 'kilograms') return 'kg';
  if (lower === 'g' || lower === 'gm' || lower === 'gram' || lower === 'grams' || lower === 'جرام' || lower === 'جم') return 'g';

  // English words to Arabic & normalizations
  if (['piece', 'pieces', 'pcs', 'pc', 'item', 'items', 'unit', 'units', 'قطعه', 'حبة', 'حبه'].includes(lower)) return 'قطعة';
  if (['box', 'boxes', 'carton', 'cartons', 'كرتونه'].includes(lower)) return 'كرتونة';
  if (['packet', 'pack', 'packs'].includes(lower)) return 'باكت';
  if (['bottle', 'bottles'].includes(lower)) return 'زجاجة';
  if (['can', 'cans'].includes(lower)) return 'علبة';
  if (['liter', 'liters', 'ltr', 'l'].includes(lower)) return 'لتر';
  if (['meter', 'meters', 'm'].includes(lower)) return 'متر';
  if (['service', 'services', 'خدمه'].includes(lower)) return 'خدمة';

  return trimmed;
}

/* SPICE-PKG3 (b): a sale unit sold by weight (kg / g, in any
 * spelling the catalog uses) is a weighed line — fractional
 * quantities survive the add, the stepper and the submit
 * normalizer, which all already branch on item.isWeighted. Exact
 * match on the normalized unit name only: 'نصف كيلو' (a
 * 0.5-multiplier pack sold by the piece) must NOT match. */
export function isWeightedSaleUnit(unitName?: string): boolean {
  const normalized = normalizeUnitName(unitName);
  return normalized === 'kg' || normalized === 'g';
}

export function summarizeCartQuantities(cart: Array<{ unitName?: string; qty: number }>): string[] {
  const map = new Map<string, number>();
  for (const item of cart) {
    const unit = normalizeUnitName(item.unitName);
    map.set(unit, (map.get(unit) || 0) + Number(item.qty || 0));
  }
  return Array.from(map.entries()).map(([unit, qty]) => `${qty.toLocaleString('ar-EG', { maximumFractionDigits: 3 })} ${unit}`);
}
