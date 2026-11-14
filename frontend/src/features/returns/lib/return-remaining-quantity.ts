/** Unavailable invoice history is not equivalent to zero prior returns. */
export function remainingInvoiceLineQuantity(original: number, returned: number, ready: boolean, legacyBlocked: boolean): number {
  if (!ready || legacyBlocked || !Number.isFinite(original) || !Number.isFinite(returned)) return 0;
  return Math.max(0, Number((original - returned).toFixed(3)));
}

/** Prevent a stale selection from bypassing an updated invoice return balance. */
export function isSelectedReturnQuantityValid(
  lineId: string, productId: string, originalQty: number, requestedQty: number,
  returnedByLine: Record<string, number>, blockedProductIds: string[], ready: boolean,
): boolean {
  if (!lineId || !Number.isSafeInteger(Number(lineId)) || Number(lineId) <= 0 ||
      !Number.isFinite(requestedQty) || requestedQty <= 0 ||
      Math.abs(requestedQty * 1000 - Math.round(requestedQty * 1000)) > 0.000001) return false;
  const returned = Number(returnedByLine[lineId] || 0);
  const available = remainingInvoiceLineQuantity(originalQty, returned, ready, blockedProductIds.includes(productId));
  return requestedQty <= available + 0.000001;
}

/* SPICE-PKG3 (a) — selection is KEY PRESENCE in selectedItems,
 * never the quantity: a weighed line being corrected through ''
 * or '0' stays selected (and its qty input stays enabled) until
 * the merchant unchecks it. A quantity of 0 contributes nothing
 * to the payload — selectedReturnItems still filters qty > 0 —
 * so an in-progress correction can never confirm an empty return. */
export function isReturnLineSelected(selectedItems: Record<string, string>, itemId: string): boolean {
  return Object.prototype.hasOwnProperty.call(selectedItems, itemId);
}

/* SPICE-PKG3 (a) — checking a line stamps its REMAINING quantity,
 * never a hardcoded '1': 1 is an invalid selection for every
 * weighed line with remaining < 1 (isSelectedReturnQuantityValid
 * rejects 1 > 0.750, so the W07 return of 0.250 kg could never be
 * executed). A remaining of 0 — fully returned, history not ready,
 * or blocked — selects nothing: the table disables that checkbox
 * anyway. Re-checking a line already selected keeps the
 * merchant's edited qty instead of overwriting it. */
export function toggleReturnLineSelection(
  current: Record<string, string>,
  itemId: string,
  checked: boolean,
  remainingQty: number,
): Record<string, string> {
  const next = { ...current };
  if (!checked) {
    delete next[itemId];
    return next;
  }
  if (Object.prototype.hasOwnProperty.call(next, itemId)) return next;
  if (!Number.isFinite(remainingQty) || remainingQty <= 0) return next;
  next[itemId] = String(remainingQty);
  return next;
}
