/* INV-ADJUST-SINGLE-QTY-BASIS: the adjustment dialog prefills its
 * `adjust` target from the location's AVAILABLE quantity -- the same
 * basis the backend targets -- never from the global raw stock.
 * The live available figure comes from the inventory availability
 * read; when that read has not resolved (or failed), the dialog
 * falls back to the selected location's raw qty (still the right
 * warehouse, even if reservations are not netted off yet), and
 * only then to the global stock. The backend remains the authority:
 * it derives the delta from live data at submit time, so a stale
 * fallback prefill can at most show a wrong starting number, never
 * post a wrong delta. A null/undefined input means "not resolved
 * yet", never zero: Number(null) === 0 must not fake a resolved
 * zero and swallow the fallback chain. */
export function resolveAdjustmentPrefill(args: {
  availableQty?: number | null;
  locationQty?: number | null;
  globalStock?: number | null;
}): number {
  // A null/undefined input means "not resolved yet" and falls
  // through -- never coerce it with Number(): Number(null) === 0
  // would fake a resolved zero and swallow the fallback chain.
  // A resolved zero is a real value and still prefills zero.
  for (const value of [args.availableQty, args.locationQty, args.globalStock]) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return 0;
}
