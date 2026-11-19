import { calcCartLineTotal } from '@/features/pos/lib/pos-modifier-totals';
import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import type { Product } from '@/types/domain';
import type { PosItem } from '@/features/pos/types/pos.types';
import { safeUnits, getMinimumSaleQuantity, getResolvedStockLimit, normalizeSaleQuantity, roundQuantity } from '@/features/pos/lib/pos-domain/pos-domain-helpers';
import { getProductItemCode, getSaleUnit, repriceCartLine, UNBOUNDED_STOCK_LIMIT } from '@/features/pos/lib/pos-domain/pos-domain-pricing';
import { buildPosLineKey, isServiceProduct, posLineNotesMatch, uniquePosLineKey, type AddPosItemOptions } from '@/features/pos/lib/pos-domain/pos-domain-line-keys';
import { isWeightedSaleUnit } from '@/features/pos/lib/pos-domain/pos-domain-sync-units';

export function addPosItem(cart: PosItem[], product: Product, options: AddPosItemOptions) {
  // INV-REST-FNB-TRUTH-2 (R-I11): 86 is enforced at the add, not at
  // checkout — the server rejects the line at submit anyway, but the
  // cashier must be stopped here, with the item named.
  if (options.eightySixedProductIds?.some((id) => String(id) === String(product.id))) {
    throw new Error(`الصنف ${product.name} غير متاح حالياً (86) — تم استبعاده من البيع.`);
  }
  const unit = safeUnits(product).find((entry) => entry.id === options.unitId) || getSaleUnit(product);
  // SPICE-PKG3 (b): derive weighed from the SELECTED SALE UNIT, not
  // from the entry path — tile taps, text search and quick-add never
  // pass isWeighted, so a kg line was treated as a piece line and
  // 0.500 rounded to 1 at every layer. An explicit caller flag
  // (weighted barcode) still wins; the unit derivation covers the rest.
  const isWeighted = options.isWeighted === true || isWeightedSaleUnit(unit.name);
  const minQty = getMinimumSaleQuantity(isWeighted);
  const requestedQty = normalizeSaleQuantity(options.quantity ?? 1, isWeighted);
  const isService = isServiceProduct(product);
  const stockLimit = (options.allowNegativeStockSales || isService) ? UNBOUNDED_STOCK_LIMIT : getResolvedStockLimit(product, unit, isWeighted);
  if (stockLimit < minQty) {
    const globalStock = Number((product as any).globalStock || 0);
    if (globalStock >= minQty && stockLimit <= 0) {
      throw new Error('الصنف موجود، لكنه غير متاح في مخزون هذا الفرع.');
    }
    throw new Error('الصنف غير متاح للبيع حاليًا.');
  }
  if (requestedQty > stockLimit) {
    throw new Error('الكمية المطلوبة أكبر من المخزون المتاح');
  }
  const priceType = options.priceType;
  const incomingModifiers = options.modifiers;
  const incomingNotes = options.notes;
  const baseLineKey = buildPosLineKey({
    productId: product.id,
    unitId: unit.id || unit.name,
    priceType,
    modifiers: incomingModifiers,
    seatNumber: options.seatNumber,
    course: options.course,
  });
  // The combo suffix is an explicit override: a combo instance keeps its
  // unique-per-instance key even when two identical combos are ordered.
  const lineKey = options.lineKeySuffix
    ? `${product.id}::${unit.id || unit.name}::${priceType}::${options.lineKeySuffix}`
    : baseLineKey;
  const existing = cart.find((item) => item.lineKey === lineKey && posLineNotesMatch(item.notes, incomingNotes));
  const incomingSerial = options.serialNumber || product.matchedSerialNumber || undefined;
  const isSerialized = Boolean(product.trackSerials || incomingSerial);

  if (existing) {
    const nextQty = roundQuantity(Number(existing.qty || 0) + requestedQty);
    if (nextQty > stockLimit) throw new Error('الكمية المطلوبة أكبر من المخزون المتاح');
    const existingSerials = existing.serials || [];
    if (incomingSerial && existingSerials.some((serial) => serial.trim().toLowerCase() === incomingSerial.trim().toLowerCase())) {
      throw new Error('تمت إضافة هذا السيريال إلى السلة بالفعل');
    }
    const nextSerials = incomingSerial && !existingSerials.includes(incomingSerial)
      ? [...existingSerials, incomingSerial]
      : existingSerials;

    return cart.map((item) => item.lineKey === lineKey
      ? repriceCartLine({
          ...item,
          isWeighted: item.isWeighted === true || isWeighted ? true : undefined,
          sourceBarcode: options.sourceBarcode || item.sourceBarcode,
          stockLimit,
          trackSerials: isSerialized || item.trackSerials,
          serials: nextSerials.length > 0 ? nextSerials : undefined,
          quantityChunks: (item.isWeighted === true || isWeighted) && options.sourceBarcode
            ? [...(item.quantityChunks || [Number(item.qty || 0)]), requestedQty]
            : item.quantityChunks,
        }, product, nextQty, options.digits)
      : item);
  }
  const newItem: PosItem = {
    lineKey: uniquePosLineKey(cart, lineKey),
    productId: product.id,
    name: product.name,
    nameEn: (product as any).nameEn || (product as any).name_en || undefined,
    name_en: (product as any).name_en || (product as any).nameEn || undefined,
    itemCode: getProductItemCode(product, unit),
    imageUrl: product.imageUrl || (product as any)?.metadata?.imageUrl || undefined,
    icon: product.icon || (product as any)?.metadata?.icon || undefined,
    unitId: unit.id,
    unitName: unit.name,
    unitMultiplier: Number.isFinite(Number(unit.multiplier)) && Number(unit.multiplier) > 0 ? Number(unit.multiplier) : 1,
    price: 0,
    costPrice: Number((product as any).costPrice || 0),
    qty: requestedQty,
    stockLimit,
    currentStock: Number(product.stock || 0),
    minStock: Number(product.minStock || 0),
    priceType,
    modifiers: incomingModifiers && incomingModifiers.length > 0 ? [...incomingModifiers] : undefined,
    notes: incomingNotes ? String(incomingNotes) : undefined,
    seatNumber: options.seatNumber != null ? Number(options.seatNumber) : undefined,
    course: options.course ? String(options.course) : undefined,
    isWeighted: isWeighted ? true : undefined,
    sourceBarcode: options.sourceBarcode || undefined,
    quantityChunks: isWeighted && options.sourceBarcode ? [requestedQty] : undefined,
    trackSerials: isSerialized ? true : undefined,
    serials: incomingSerial ? [incomingSerial] : undefined,
  };

  return [...cart, repriceCartLine(newItem, product, requestedQty, options.digits)];
}

export function updatePosItemNotes(cart: PosItem[], lineKey: string, notes: string) {
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    return { ...item, notes };
  });
}

/* INV-POS-LINE-DISCOUNT: set (or clear, with 0) the per-line TOTAL
 * discount on one cart line. The amount is rounded at book digits and
 * clamped to the line gross, so the cart can never hold a discount
 * the backend would refuse (INVALID_DISCOUNT): a discount above the
 * gross is cut to the gross, never kept. A zero discount clears the
 * field (undefined) so the payload carries no line discount at all. */
export function updatePosItemLineDiscount(cart: PosItem[], lineKey: string, discount: number, digits: MoneyDigits) {
  return cart.map((item) => {
    if (item.lineKey !== lineKey) return item;
    const gross = calcCartLineTotal(item);
    const rounded = roundMoneyValue(Math.max(0, Number(discount || 0)), digits);
    const clamped = Math.min(rounded, Math.max(0, gross));
    return { ...item, lineDiscount: clamped > 0 ? clamped : undefined };
  });
}
