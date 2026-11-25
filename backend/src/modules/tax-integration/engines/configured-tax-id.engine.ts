/**
 * Configured tax-id selection (INV-CONFIGURED-TAX-ID-SINGLE-SOURCE):
 * every tax consumer that needs "the tenant's configured tax number
 * for provider P" selects it through this one pure rule — the VAT
 * declaration, the ZATCA signer, and the ETA serializer. Selection
 * is deliberately separate from validation: this helper only picks
 * the row; each consumer still fails closed with its own error
 * when the picked number is missing, inactive, or malformed
 * (the ZATCA identity engine, the declaration's 409, the ETA
 * settings error).
 *
 * Rules:
 * - Exact provider match wins. With allowFallback disabled
 *   (ZATCA, ETA) a missing provider means no row — another
 *   jurisdiction's registration must never sign or report in
 *   its place, and a blank or inactive matched row is returned
 *   as-is so the consumer's own fail-closed message survives.
 * - With allowFallback enabled (the VAT declaration only) a
 *   matched row with a blank number does not win: the first
 *   row with a non-blank number is the fallback, so a
 *   declaration never fails while any registration exists.
 * - Rows arrive unfiltered; is_active is reported, never used
 *   to hide a row — hiding an inactive row would turn the
 *   ZATCA "inactive" failure into a misleading "not configured".
 */
export interface ConfiguredTaxRow {
  provider?: unknown;
  tax_id?: unknown;
  is_active?: unknown;
}

export function selectConfiguredTaxRow(
  rows: readonly ConfiguredTaxRow[] | null | undefined,
  options: { provider: string; allowFallback: boolean },
): { taxId: string; isActive: boolean } | null {
  const list = Array.isArray(rows) ? rows : [];
  const trimmed = (row: ConfiguredTaxRow): string => (typeof row.tax_id === 'string' ? row.tax_id.trim() : '');
  const picked = (row: ConfiguredTaxRow): { taxId: string; isActive: boolean } => ({
    taxId: trimmed(row),
    isActive: row.is_active !== false,
  });
  if (options.allowFallback) {
    const preferred = list.find((row) => row.provider === options.provider && trimmed(row) !== '');
    if (preferred) return picked(preferred);
    const fallback = list.find((row) => trimmed(row) !== '');
    return fallback ? picked(fallback) : null;
  }
  const matched = list.find((row) => row.provider === options.provider);
  return matched ? picked(matched) : null;
}
