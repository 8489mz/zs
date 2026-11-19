import { roundMoneyValue, type MoneyDigits } from '@/shared/utils/money';
import type { Product } from '@/types/domain';
import type { PosItem, PosPriceType } from '@/features/pos/types/pos.types';
import { getSaleUnit } from '@/features/pos/lib/pos-domain/pos-domain-pricing';
import { addPosItem } from '@/features/pos/lib/pos-domain/pos-domain-cart-add';
import { isServiceProduct, posLineNotesMatch, rekeyPosLine, uniquePosLineKey } from '@/features/pos/lib/pos-domain/pos-domain-line-keys';
import { roundQuantity } from '@/features/pos/lib/pos-domain/pos-domain-helpers';

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
