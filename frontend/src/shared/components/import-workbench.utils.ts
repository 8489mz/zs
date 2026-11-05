// Pure row-normalization for ImportWorkbench (frontend/src/shared/components/
// ImportWorkbench.tsx). Kept free of React so the spec can drive it directly.

export type CsvRow = Record<string, string>;

export interface ImportFieldMapping {
  key: string;
  label: string;
  aliases?: string[];
}

/**
 * Build the rows sent to the backend: ONLY the normalized English field keys.
 *
 * The raw parsed row carries the file's original headers (Arabic template
 * headers), so spreading it into the payload — `{ ...row, [key]: value }` —
 * sent every row twice and a 2,500-row products file (2.71 MB) already exceeded
 * the 2 MB Express JSON limit. Unmapped headers are dropped, and a field whose
 * header was not found in the file is left out entirely.
 *
 * INV-IMPORT-PRODUCTS-BILINGUAL-NAMES-PAYLOAD (ARCHITECTURE_INVARIANTS.md).
 */
export function normalizeImportRows(
  rows: CsvRow[],
  fieldMappings: ImportFieldMapping[],
  resolvedHeaderByFieldKey: Record<string, string>,
): CsvRow[] {
  return rows.map((row) => {
    const nextRow: CsvRow = {};
    for (const field of fieldMappings) {
      const actualHeader = resolvedHeaderByFieldKey[field.key];
      if (!actualHeader) continue;
      nextRow[field.key] = String(row[actualHeader] || '').trim();
    }
    return nextRow;
  });
}
