/* R-B8 (INV-REST-MODIFIER-QTY-TOTALS): single canonical frontend formula for cart
 * line totals with modifiers. The backend (sales-write.helper.ts buildPreparedSaleItem)
 * charges modifiersTotal = sum(price * qty) and grossLineTotal = qty * (price +
 * modifiersTotal). Five frontend sites previously summed price only (no qty), so a
 * modifier with qty 2 was under-displayed on screen and on the receipt while the
 * posted sale charged the full amount. Every POS totals site must use these helpers
 * so display, receipt and posting can never drift apart again. */

export interface PosModifierLike {
  price?: unknown;
  qty?: unknown;
}

export interface PosCartLineLike {
  qty?: unknown;
  price?: unknown;
  modifiers?: PosModifierLike[] | null;
  /* INV-POS-LINE-DISCOUNT: the per-line TOTAL discount (amount) on
   * this line, if any. */
  lineDiscount?: unknown;
}

/** Per-line modifier surcharge: sum of price * qty, matching the backend exactly
 * (a modifier with no qty counts once, same as `Number(mod.qty || 1)` server-side). */
export function calcModifiersTotal(modifiers: PosModifierLike[] | null | undefined): number {
  return (modifiers || []).reduce(
    (sum, mod) => sum + Number(mod.price || 0) * Number(mod.qty || 1),
    0,
  );
}

/** Full line total: qty * (price + modifiersTotal), matching the backend exactly. */
export function calcCartLineTotal(item: PosCartLineLike): number {
  return Number(item.qty || 0) * (Number(item.price || 0) + calcModifiersTotal(item.modifiers));
}

/* INV-POS-LINE-DISCOUNT: the per-line discount actually in force for
 * one cart line — the entered amount, clamped to [0, line gross].
 * The backend fails closed above the gross (INVALID_DISCOUNT); every
 * frontend site that subtracts a line discount clamps through here so
 * display, receipt and posting can never drift apart. Unrounded: the
 * caller rounds at book digits, like every other money helper here. */
export function calcCartLineDiscount(item: PosCartLineLike): number {
  const gross = calcCartLineTotal(item);
  const entered = Number(item.lineDiscount || 0);
  if (!Number.isFinite(entered) || entered <= 0) return 0;
  return Math.min(entered, Math.max(0, gross));
}

/** Net line total: gross minus the line's own discount, matching the
 * backend's buildPreparedSaleItem lineTotal exactly. */
export function calcCartLineNetTotal(item: PosCartLineLike): number {
  return calcCartLineTotal(item) - calcCartLineDiscount(item);
}

/** One cart line as the customer display sees it. R5-A (INV-REST-TOTALS-
 * TRUTH-2, R-I14): the broadcaster used to send `qty * price` with no
 * modifiers, so the visible lines did not sum to the shown total. The
 * display unit price is the charged per-unit price (base + modifiers),
 * and modifier names/quantities/prices plus the line note travel with
 * the item so the display can render them under it. */
export interface CustomerDisplayModifierLike {
  name?: unknown;
  qty?: unknown;
  price?: unknown;
}

export interface CustomerDisplayCartLineLike extends PosCartLineLike {
  productId?: unknown;
  lineKey?: unknown;
  name?: unknown;
  notes?: unknown;
  modifiers?: CustomerDisplayModifierLike[] | null;
  sourceBarcode?: unknown;
  itemCode?: unknown;
  categoryName?: unknown;
}

export interface CustomerDisplayItemLike {
  id: string | number;
  name: string;
  qty: number;
  price: number;
  lineTotal: number;
  /* INV-POS-LINE-DISCOUNT: the line's own discount (0 when none), so
   * the customer display can show why the line total is below
   * qty x price. */
  lineDiscount?: number;
  barcode?: string;
  categoryName?: string;
  modifiers: Array<{ name: string; qty: number; price: number }>;
  notes?: string;
}

export function buildCustomerDisplayItems(cart: CustomerDisplayCartLineLike[]): CustomerDisplayItemLike[] {
  return (cart || []).map((item) => {
    const modifiers = (item.modifiers || []).map((mod: any) => ({
      name: String((mod as any)?.name ?? (mod as any) ?? ''),
      qty: Number((mod as any)?.qty || 1),
      price: Number((mod as any)?.price || 0),
    }));
    const effectiveUnitPrice = Number(item.price || 0) + calcModifiersTotal(item.modifiers);
    return {
      id: (item.productId as string | number) || (item.lineKey as string | number),
      name: String(item.name || ''),
      qty: Number(item.qty || 0),
      price: effectiveUnitPrice,
      /* INV-POS-LINE-DISCOUNT: the display line total is the NET total
       * (gross minus the line's own discount) — the gross figure would
       * leave the visible lines summing above the shown total. */
      lineTotal: calcCartLineNetTotal(item),
      lineDiscount: calcCartLineDiscount(item),
      barcode: String(item.sourceBarcode || item.itemCode || '') || undefined,
      categoryName: item.categoryName ? String(item.categoryName) : undefined,
      modifiers,
      notes: item.notes ? String(item.notes) : undefined,
    };
  });
}
