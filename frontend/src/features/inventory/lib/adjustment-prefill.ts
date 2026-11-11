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
 * post a wrong delta. */
export function resolveAdjustmentPrefill(args: {
  availableQty?: number | null;
  locationQty?: number | null;
  globalStock?: number | null;
}): number {
  const available = Number(args.availableQty);
  if (Number.isFinite(available)) return available;
  const location = Number(args.locationQty);
  if (Number.isFinite(location)) return location;
  const global = Number(args.globalStock);
  if (Number.isFinite(global)) return global;
  return 0;
}
