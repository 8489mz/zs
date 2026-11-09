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
