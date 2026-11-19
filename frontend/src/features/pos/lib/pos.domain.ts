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

/* Combo meals (R-B9 / INV-REST-COMBO-LINE): the old onAddComboToCart in
 * PosWorkspaceHeader ignored handleAddProduct's boolean return and stamped the
 * combo name/notes/modifiers onto prevCart[prevCart.length - 1] — the wrong
 * line whenever the add failed (out of stock) or merged into a plain line of
 * the same product already in the cart — and it never used combo.price, so an
 * offer-repriced main posted a different total than the modal displayed
 * (totalComboPrice). applyComboToCart is the single pure decision for a combo
 * add: the combo always lands on its own new line (a suffixed lineKey that can
 * never merge), the posted price is the modal's base price, and the stock
 * check counts every unit of the product already in the cart — the suffix
 * breaks addPosItem's merge-based stock check, so without this the combo
 * could oversell the last unit already held as a plain line. */
export interface ComboSelection {
  productId: number | string;
  productName: string;
  /** Modal base price of the main (totalComboPrice minus the modifier deltas). */
  price: number;
  modifiers: Array<{
    name: string;
    price: number;
    /** T11-A (INV-REST-COMBO-SUBMIT-TRUTH): the catalog price the
     * modal read this component from. A 0 price against a non-zero
     * catalog price is refused below — the server re-prices such a
     * component to DB retail_price and the cross-check 422s. Absent
     * for callers that carry no catalog price (no refusal then). */
    catalogPrice?: number;
  }>;
  notes?: string;
}

export interface ApplyComboToCartOptions {
  priceType: PosPriceType;
  digits: MoneyDigits;
  allowNegativeStockSales?: boolean;
  /** Unique id for this combo instance. Defaults to a generated id; pass an
   * explicit id in tests so the resulting lineKey is deterministic. */
  comboLineId?: string;
}

export function buildComboLineKey(product: Product, priceType: PosPriceType, comboLineId: string): string {
  const unit = getSaleUnit(product);
  return `${product.id}::${unit.id || unit.name}::${priceType}::${comboLineId}`;
}

export function applyComboToCart(
  cart: PosItem[],
  product: Product,
  combo: ComboSelection,
  options: ApplyComboToCartOptions,
): { cart: PosItem[]; lineKey: string } {
  /* T11-A (INV-REST-COMBO-SUBMIT-TRUTH): refuse a 0 component price
   * when the catalog price is non-zero — fail loud, before any cart
   * write, so a refused combo leaves the cart untouched. The server
   * re-prices a stamped 0 to DB retail_price and the R5-A cross-check
   * 422s SALE_TOTAL_MISMATCH; the server is right, so the stamp must
   * never emit the 0. A genuinely free component (catalog price 0)
   * still stamps at 0. The catalog price is read exactly as the line
   * pricer reads it (getProductPrice: wholesale falls back to retail). */
  const catalogMainPrice = Number(options.priceType === 'wholesale'
    ? product.wholesalePrice || product.retailPrice || 0
    : product.retailPrice || 0);
  if (!(Number(combo.price) > 0) && catalogMainPrice > 0) {
    throw new Error('لا يمكن إضافة الوجبة بسعر صفر: سعر الصنف الرئيسي في الكتالوج أكبر من صفر.');
  }
  for (const modifier of combo.modifiers || []) {
    if (!(Number(modifier.price) > 0) && Number(modifier.catalogPrice || 0) > 0) {
      throw new Error(`لا يمكن إضافة الوجبة: سعر «${modifier.name}» صفر رغم أن سعره في الكتالوج أكبر من صفر.`);
    }
  }
  const comboLineId = options.comboLineId || `combo-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const lineKey = buildComboLineKey(product, options.priceType, comboLineId);
  const isService = isServiceProduct(product);
  if (!options.allowNegativeStockSales && !isService) {
    const saleUnit = getSaleUnit(product);
    const comboBaseQty = Number.isFinite(Number(saleUnit.multiplier)) && Number(saleUnit.multiplier) > 0
      ? Number(saleUnit.multiplier)
      : 1;
    const reservedBaseQty = cart
      .filter((item) => String(item.productId) === String(product.id))
      .reduce((sum, item) => sum + Number(item.qty || 0) * (Number(item.unitMultiplier) || 1), 0);
    // Only the already-reserved units need this check: with nothing reserved,
    // addPosItem's own stock error surfaces (same message as a plain add).
    if (reservedBaseQty > 0 && reservedBaseQty + comboBaseQty > Number(product.stock || 0)) {
      throw new Error('الكمية المطلوبة أكبر من المخزون المتاح');
    }
  }
  const withMain = addPosItem(cart, product, {
    priceType: options.priceType,
    digits: options.digits,
    allowNegativeStockSales: options.allowNegativeStockSales,
    lineKeySuffix: comboLineId,
  });
  const comboLine = withMain.find((item) => item.lineKey === lineKey);
  if (!comboLine) throw new Error('تعذّر إضافة الوجبة إلى السلة.');
  const comboPrice = roundMoneyValue(Number(combo.price || 0), options.digits);
  return {
    cart: withMain.map((item) => (item.lineKey === lineKey
      ? {
          ...item,
          name: combo.productName,
          notes: combo.notes,
          modifiers: combo.modifiers,
          // The modal's displayed total is the contract with the customer:
          // post the modal's base price, not the repriced catalog price, so
          // qty * (price + modifier deltas) equals totalComboPrice even when
          // an offer would otherwise reprice the main.
          price: comboPrice,
          originalPrice: comboPrice,
          offerDiscount: 0,
          offerName: undefined,
        }
      : item)),
    lineKey,
  };
}

/* Modifiers are set on a line AFTER the add in the live flow (the cashier
 * adds the product, then picks modifiers in the modifier modal), so the key
 * must follow them here: without the re-key, the line keeps its plain key
 * and the next plain add merges into it, charging the modifier on all
 * units. If the new identity already exists as another line with equal
 * notes, the two fold into one line; with differing notes the edited line
 * keeps its own key. */
export function updatePosItemModifiers(cart: PosItem[], lineKey: string, modifiers: any[]) {
  const target = cart.find((item) => item.lineKey === lineKey);
  if (!target) return cart;
  const nextKey = rekeyPosLine(target, { modifiers });
  if (nextKey === lineKey) {
    return cart.map((item) => (item.lineKey === lineKey ? { ...item, modifiers } : item));
  }
  const collision = cart.find((item) => item.lineKey !== lineKey && item.lineKey === nextKey);
  if (collision && posLineNotesMatch(collision.notes, target.notes)) {
    return cart
      .filter((item) => item.lineKey !== lineKey)
      .map((item) => (item.lineKey === nextKey
        ? { ...item, qty: roundQuantity(Number(item.qty || 0) + Number(target.qty || 0)) }
        : item));
  }
  const finalKey = collision
    ? uniquePosLineKey(cart.filter((item) => item.lineKey !== lineKey), nextKey)
    : nextKey;
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    return { ...item, modifiers, lineKey: finalKey };
  });
}

export function updatePosItemSeat(cart: PosItem[], lineKey: string, seatNumber?: number) {
  const target = cart.find((item) => item.lineKey === lineKey);
  if (!target) return cart;
  // Seat is in the key: a line moved to another seat is a different line.
  const nextKey = rekeyPosLine(target, { seatNumber: seatNumber == null ? null : seatNumber });
  const nextSeat = seatNumber ? Number(seatNumber) : undefined;
  if (nextKey === lineKey) {
    return cart.map((item) => {
      if (item.lineKey !== lineKey) return item;
      return { ...item, seatNumber: nextSeat };
    });
  }
  const collision = cart.find((item) => item.lineKey !== lineKey && item.lineKey === nextKey);
  if (collision && posLineNotesMatch(collision.notes, target.notes)) {
    return cart
      .filter((item) => item.lineKey !== lineKey)
      .map((item) => (item.lineKey === nextKey
        ? { ...item, qty: roundQuantity(Number(item.qty || 0) + Number(target.qty || 0)) }
        : item));
  }
  const finalKey = collision
    ? uniquePosLineKey(cart.filter((item) => item.lineKey !== lineKey), nextKey)
    : nextKey;
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    return { ...item, seatNumber: nextSeat, lineKey: finalKey };
  });
}

/* Line transfer (R-I34): deduct-from-source and add-to-target match on the
 * lineKey, never on product + price. Legacy lines without a key fall back
 * to a full-identity match (product + unit + price type + modifiers +
 * seat + course + price + notes) — product + price alone never matches. */
export interface PosLineTransferItem {
  lineKey?: string;
  productId: string | number;
  unitId?: string | number;
  unitName?: string;
  priceType?: PosPriceType;
  price: number;
  qty: number;
  modifiers?: any[];
  notes?: string;
  seatNumber?: number;
  course?: string;
}

function posLineMatchesTransfer(
  line: PosItem | PosLineTransferItem,
  other: PosItem | PosLineTransferItem,
): boolean {
  if (line.lineKey && other.lineKey) return line.lineKey === other.lineKey;
  if (String(line.productId) !== String(other.productId)) return false;
  if (Number(line.price || 0) !== Number(other.price || 0)) return false;
  const keyOf = (entry: PosItem | PosLineTransferItem) => buildPosLineKey({
    productId: entry.productId,
    unitId: (entry as PosItem).unitId || entry.unitName,
    priceType: (entry as PosItem).priceType || 'retail',
    modifiers: entry.modifiers,
    seatNumber: entry.seatNumber,
    course: entry.course,
  });
  return keyOf(line) === keyOf(other) && posLineNotesMatch(line.notes, other.notes);
}

/** Move `items` (with the quantities to move) from `source` to `target`.
 * Never merges two different keys; a line whose notes differ from the
 * matching target line is added as its own line. */
export function applyPosLineTransfer(
  source: PosItem[],
  target: PosItem[],
  items: PosLineTransferItem[],
): { source: PosItem[]; target: PosItem[] } {
  let nextSource = [...source];
  let nextTarget = [...target];
  for (const item of items) {
    const moveQty = Number(item.qty || 0);
    if (moveQty <= 0) continue;
    const srcIdx = nextSource.findIndex((line) => posLineMatchesTransfer(line, item));
    if (srcIdx === -1) continue;
    if (Number(nextSource[srcIdx].qty || 0) > moveQty) {
      nextSource[srcIdx] = { ...nextSource[srcIdx], qty: Number(nextSource[srcIdx].qty || 0) - moveQty };
    } else {
      nextSource.splice(srcIdx, 1);
    }
    const tgtIdx = nextTarget.findIndex(
      (line) => posLineMatchesTransfer(line, item) && posLineNotesMatch(line.notes, item.notes),
    );
    if (tgtIdx !== -1) {
      nextTarget[tgtIdx] = { ...nextTarget[tgtIdx], qty: Number(nextTarget[tgtIdx].qty || 0) + moveQty };
    } else {
      const baseKey = item.lineKey || buildPosLineKey({
        productId: item.productId,
        unitId: item.unitId || item.unitName,
        priceType: item.priceType || 'retail',
        modifiers: item.modifiers,
        seatNumber: item.seatNumber,
        course: item.course,
      });
      nextTarget.push({
        ...(item as unknown as PosItem),
        lineKey: uniquePosLineKey(nextTarget, baseKey),
        qty: moveQty,
      });
    }
  }
  return { source: nextSource, target: nextTarget };
}

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
