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

/**
 * Chunked import (INV-IMPORT-CHUNKED-1000): one request carries at most
 * 1,000 rows. A 10,000-row file sent as a single request runs one
 * minutes-long transaction on the server while the edge (Cloudflare, ~100 s)
 * answers 504 — so the workbench sends 1,000-row chunks sequentially with
 * progress. The backend enforces the same 1,000 cap per request
 * (SettingsImportService.MAX_IMPORT_ROWS_PER_REQUEST), so a chunk can never
 * silently grow back into a single-shot 504.
 */
export const IMPORT_CHUNK_SIZE = 1000;

export interface ImportChunkProgress {
  doneRows: number;
  totalRows: number;
  chunkIndex: number;
  chunkCount: number;
}

export interface AggregatedImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  warnings: string[];
}

/** A chunked import that stopped early: `partial` is what completed before the failure. */
export class ChunkImportError extends Error {
  readonly partial: AggregatedImportResult;
  readonly doneRows: number;
  readonly totalRows: number;
  readonly chunkIndex: number;
  readonly chunkCount: number;

  constructor(message: string, partial: AggregatedImportResult, progress: ImportChunkProgress) {
    super(message);
    this.name = 'ChunkImportError';
    this.partial = partial;
    this.doneRows = progress.doneRows;
    this.totalRows = progress.totalRows;
    this.chunkIndex = progress.chunkIndex;
    this.chunkCount = progress.chunkCount;
  }
}

export function chunkImportRows(rows: CsvRow[], chunkSize: number = IMPORT_CHUNK_SIZE): CsvRow[][] {
  const size = Math.max(1, Math.floor(chunkSize) || IMPORT_CHUNK_SIZE);
  const chunks: CsvRow[][] = [];
  for (let start = 0; start < rows.length; start += size) {
    chunks.push(rows.slice(start, start + size));
  }
  return chunks;
}

export function aggregateImportResults(results: unknown[]): AggregatedImportResult {
  const aggregate: AggregatedImportResult = { inserted: 0, updated: 0, skipped: 0, warnings: [] };
  const seenWarnings = new Set<string>();
  for (const result of results) {
    const payload = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
    aggregate.inserted += Number(payload.inserted || 0);
    aggregate.updated += Number(payload.updated || 0);
    aggregate.skipped += Number(payload.skipped || 0);
    if (Array.isArray(payload.warnings)) {
      for (const entry of payload.warnings) {
        const text = String(entry || '').trim();
        if (text && !seenWarnings.has(text)) {
          seenWarnings.add(text);
          aggregate.warnings.push(text);
        }
      }
    }
  }
  return aggregate;
}

export async function importRowsInChunks(
  rows: CsvRow[],
  sendChunk: (chunk: CsvRow[]) => Promise<unknown>,
  onProgress?: (progress: ImportChunkProgress) => void,
): Promise<AggregatedImportResult> {
  const chunks = chunkImportRows(rows);
  const results: unknown[] = [];
  let doneRows = 0;
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    let result: unknown;
    try {
      result = await sendChunk(chunk);
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'تعذر استيراد الشريحة.';
      throw new ChunkImportError(reason, aggregateImportResults(results), {
        doneRows,
        totalRows: rows.length,
        chunkIndex: index + 1,
        chunkCount: chunks.length,
      });
    }
    results.push(result);
    doneRows += chunk.length;
    onProgress?.({ doneRows, totalRows: rows.length, chunkIndex: index + 1, chunkCount: chunks.length });
  }
  return aggregateImportResults(results);
}

export function summarizeImportResult(result: unknown, rowCount: number, fileName: string): { kind: 'success' | 'warning'; text: string } {
  const payload = (result && typeof result === 'object' ? result : {}) as Record<string, unknown>;
  const inserted = Number(payload.inserted || 0);
  const updated = Number(payload.updated || 0);
  const skipped = Number(payload.skipped || 0);
  const warnings = Array.isArray(payload.warnings)
    ? payload.warnings.map((entry) => String(entry || '').trim()).filter(Boolean)
    : [];

  const summaryParts: string[] = [];
  if (inserted > 0) summaryParts.push(`إضافة ${inserted}`);
  if (updated > 0) summaryParts.push(`تحديث ${updated}`);
  if (skipped > 0) summaryParts.push(`تخطي ${skipped}`);
  if (!summaryParts.length) summaryParts.push(`معالجة ${rowCount}`);

  const baseText = `تمت العملية بنجاح (${summaryParts.join('، ')}) من ${fileName || 'الملف المحدد'}.`;
  if (!warnings.length) {
    return { kind: 'success', text: baseText };
  }

  return {
    kind: 'warning',
    text: `${baseText} تحذيرات: ${warnings.join(' ')}`,
  };
}
