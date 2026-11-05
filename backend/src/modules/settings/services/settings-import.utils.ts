// Bilingual product-name resolution for the products import
// (SettingsImportService.importProducts). Pure: no DB, no tenant scope, so the
// spec can drive it directly without a transaction.

export interface ResolvedImportProductNames {
  /** Stored `products.name`: the Arabic name when present, else the English name. */
  name: string;
  /** Stored `products.name_en`: the English name when present, else null. */
  nameEn: string | null;
}

/**
 * Resolve the stored name pair for one imported product row.
 *
 * - Both names present: name is Arabic, name_en is English.
 * - English only: the English name becomes `name` too (and stays in `name_en`).
 * - Arabic only: name is Arabic, name_en is null.
 * - Neither name: null — the row is not a product and the caller skips it.
 *
 * INV-IMPORT-PRODUCTS-BILINGUAL-NAMES-PAYLOAD (ARCHITECTURE_INVARIANTS.md).
 */
export function resolveImportProductNames(
  arabicName: unknown,
  englishName: unknown,
): ResolvedImportProductNames | null {
  const arabic = String(arabicName ?? '').trim();
  const english = String(englishName ?? '').trim();
  if (!arabic && !english) return null;
  return { name: arabic || english, nameEn: english || null };
}
