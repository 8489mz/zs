/* INV-IMPORT-PRODUCTS-BILINGUAL-NAMES-PAYLOAD: the products import sends ONLY
 * the normalized English field keys — the raw Arabic-header row is never spread
 * into the payload — so a 10,000-row import stays under the 10mb JSON limit. */

import { describe, expect, it } from 'vitest';
import {
  aggregateImportResults,
  ChunkImportError,
  chunkImportRows,
  IMPORT_CHUNK_SIZE,
  importRowsInChunks,
  normalizeImportRows,
  summarizeImportResult,
  type CsvRow,
  type ImportFieldMapping,
} from './import-workbench.utils';

// The products field mappings, as wired in SettingsBackupImportSection.
const PRODUCTS_MAPPINGS: ImportFieldMapping[] = [
  { key: 'name', label: 'اسم الصنف' },
  { key: 'nameEn', label: 'اسم الصنف (إنجليزي)' },
  { key: 'categoryName', label: 'القسم' },
  { key: 'supplierName', label: 'المورد' },
  { key: 'itemType', label: 'النوع' },
  { key: 'barcode', label: 'الباركود' },
  { key: 'costPrice', label: 'سعر التكلفة' },
  { key: 'retailPrice', label: 'سعر البيع' },
  { key: 'wholesalePrice', label: 'سعر الجملة' },
  { key: 'minStockQty', label: 'الحد الأدنى' },
  { key: 'stockQty', label: 'الكمية' },
  { key: 'warehouseName', label: 'المخزن' },
  { key: 'unitName', label: 'وحدة القياس الأساسية' },
  { key: 'saleUnit', label: 'وحدة البيع' },
  { key: 'purchaseUnit', label: 'وحدة الشراء' },
  { key: 'extraUnitName', label: 'اسم وحدة إضافية' },
  { key: 'extraUnitMultiplier', label: 'معامل الوحدة الإضافية' },
  { key: 'extraUnitBarcode', label: 'باركود الوحدة الإضافية' },
  { key: 'notes', label: 'ملاحظات' },
];

const PRODUCTS_RESOLVED: Record<string, string> = {
  name: 'اسم الصنف (إجباري)',
  nameEn: 'اسم الصنف (إنجليزي)',
  categoryName: 'القسم',
  supplierName: 'المورد',
  itemType: 'النوع',
  barcode: 'الباركود',
  costPrice: 'سعر التكلفة',
  retailPrice: 'سعر البيع',
  wholesalePrice: 'سعر الجملة',
  minStockQty: 'الحد الأدنى',
  stockQty: 'الكمية',
  warehouseName: 'المخزن',
  unitName: 'وحدة القياس الأساسية',
  saleUnit: 'وحدة البيع',
  purchaseUnit: 'وحدة الشراء',
  extraUnitName: 'اسم وحدة إضافية',
  extraUnitMultiplier: 'معامل الوحدة الإضافية',
  extraUnitBarcode: 'باركود الوحدة الإضافية',
  notes: 'ملاحظات',
};

function buildRawProductRow(i: number): CsvRow {
  const n = String(i + 1).padStart(6, '0');
  return {
    'اسم الصنف (إجباري)': `منتج اختبار ${i + 1}`,
    'اسم الصنف (إنجليزي)': `Test product ${i + 1}`,
    'الباركود': `T10K-${n}`,
    'القسم': 'عام',
    'المورد': 'مورد تجريبي',
    'النوع': 'product',
    'سعر التكلفة': '50',
    'سعر البيع': '70',
    'سعر الجملة': '60',
    'الحد الأدنى': '5',
    'الكمية': '24',
    'المخزن': '',
    'وحدة القياس الأساسية': 'قطعة',
    'وحدة البيع': 'قطعة',
    'وحدة الشراء': 'كرتونة',
    'اسم وحدة إضافية': 'كرتونة',
    'معامل الوحدة الإضافية': '12',
    'باركود الوحدة الإضافية': '123456789013',
    'ملاحظات': 'ملاحظات',
  };
}

describe('normalizeImportRows', () => {
  it('sends only the normalized English keys — no Arabic-header key survives', () => {
    const raw: CsvRow = { ...buildRawProductRow(0), 'عمود غريب': 'يجب أن يسقط' };
    const [normalized] = normalizeImportRows([raw], PRODUCTS_MAPPINGS, PRODUCTS_RESOLVED);
    expect(Object.keys(normalized).sort()).toEqual(PRODUCTS_MAPPINGS.map((f) => f.key).sort());
    for (const key of Object.keys(raw)) {
      expect(normalized).not.toHaveProperty(key);
    }
    expect(normalized).toEqual({
      name: 'منتج اختبار 1',
      nameEn: 'Test product 1',
      barcode: 'T10K-000001',
      categoryName: 'عام',
      supplierName: 'مورد تجريبي',
      itemType: 'product',
      costPrice: '50',
      retailPrice: '70',
      wholesalePrice: '60',
      minStockQty: '5',
      stockQty: '24',
      warehouseName: '',
      unitName: 'قطعة',
      saleUnit: 'قطعة',
      purchaseUnit: 'كرتونة',
      extraUnitName: 'كرتونة',
      extraUnitMultiplier: '12',
      extraUnitBarcode: '123456789013',
      notes: 'ملاحظات',
    });
  });

  it('leaves out a field whose header was not found and trims values', () => {
    const raw: CsvRow = { 'اسم الصنف (إجباري)': '  منتج جديد  ', 'الباركود': '123' };
    const resolved = { name: 'اسم الصنف (إجباري)', barcode: 'الباركود' };
    const [normalized] = normalizeImportRows([raw], PRODUCTS_MAPPINGS, resolved);
    expect(normalized).toEqual({ name: 'منتج جديد', barcode: '123' });
  });

  it('keeps a 10,000-row products payload under the 10mb JSON limit', () => {
    const rawRows = Array.from({ length: 10000 }, (_, i) => buildRawProductRow(i));
    const normalizedRows = normalizeImportRows(rawRows, PRODUCTS_MAPPINGS, PRODUCTS_RESOLVED);
    const bodyBytes = new TextEncoder().encode(JSON.stringify({ rows: normalizedRows })).byteLength;
    expect(bodyBytes).toBeLessThan(10 * 1024 * 1024);
    expect(bodyBytes).toBeGreaterThan(2 * 1024 * 1024);
  });
});

/*
 * Chunked import (INV-IMPORT-CHUNKED-1000): one request carries at most 1,000
 * rows, so a 10,000-row file never runs as one minutes-long transaction that
 * the edge answers with a 504.
 */
describe('import workbench chunking', () => {
  const makeRows = (count: number): CsvRow[] =>
    Array.from({ length: count }, (_, i) => ({ name: `product-${i}`, barcode: `${i}` }));

  it('splits 10,000 rows into ten 1,000-row chunks in order', () => {
    const rows = makeRows(10000);
    const chunks = chunkImportRows(rows);
    expect(chunks).toHaveLength(10);
    for (const chunk of chunks) expect(chunk).toHaveLength(1000);
    expect(chunks[0][0]).toEqual({ name: 'product-0', barcode: '0' });
    expect(chunks[9][999]).toEqual({ name: 'product-9999', barcode: '9999' });
    expect(IMPORT_CHUNK_SIZE).toBe(1000);
  });

  it('keeps a remainder chunk and handles small inputs', () => {
    expect(chunkImportRows(makeRows(2500)).map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(chunkImportRows(makeRows(1000))).toHaveLength(1);
    expect(chunkImportRows(makeRows(1))).toHaveLength(1);
    expect(chunkImportRows([])).toEqual([]);
    expect(chunkImportRows(makeRows(1001)).map((c) => c.length)).toEqual([1000, 1]);
  });

  it('aggregates per-chunk counts and dedups repeated warnings', () => {
    const aggregate = aggregateImportResults([
      { ok: true, inserted: 1000, updated: 0, warnings: ['same warning'] },
      { ok: true, inserted: 800, updated: 200, skipped: 3, warnings: ['same warning', 'other warning'] },
      { ok: true, inserted: 0, updated: 0 },
    ]);
    expect(aggregate).toEqual({
      inserted: 1800,
      updated: 200,
      skipped: 3,
      warnings: ['same warning', 'other warning'],
    });
    expect(aggregateImportResults([])).toEqual({ inserted: 0, updated: 0, skipped: 0, warnings: [] });
  });

  it('sends each chunk in order and reports progress per chunk', async () => {
    const rows = makeRows(2500);
    const sent: CsvRow[][] = [];
    const progress: Array<{ doneRows: number; chunkIndex: number; chunkCount: number }> = [];
    const aggregate = await importRowsInChunks(
      rows,
      async (chunk) => {
        sent.push(chunk);
        return { inserted: chunk.length, updated: 0 };
      },
      (p) => progress.push({ doneRows: p.doneRows, chunkIndex: p.chunkIndex, chunkCount: p.chunkCount }),
    );
    expect(sent.map((c) => c.length)).toEqual([1000, 1000, 500]);
    expect(sent[0][0]).toEqual({ name: 'product-0', barcode: '0' });
    expect(sent[2][0]).toEqual({ name: 'product-2000', barcode: '2000' });
    expect(progress).toEqual([
      { doneRows: 1000, chunkIndex: 1, chunkCount: 3 },
      { doneRows: 2000, chunkIndex: 2, chunkCount: 3 },
      { doneRows: 2500, chunkIndex: 3, chunkCount: 3 },
    ]);
    expect(aggregate.inserted).toBe(2500);
  });

  it('stops at the first failed chunk and keeps the completed part', async () => {
    const rows = makeRows(2500);
    const sent: CsvRow[][] = [];
    let caught: unknown;
    try {
      await importRowsInChunks(rows, async (chunk) => {
        sent.push(chunk);
        if (sent.length === 2) throw new Error('network down');
        return { inserted: chunk.length, updated: 0 };
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ChunkImportError);
    const failure = caught as ChunkImportError;
    expect(failure.partial).toEqual({ inserted: 1000, updated: 0, skipped: 0, warnings: [] });
    expect(failure.doneRows).toBe(1000);
    expect(failure.totalRows).toBe(2500);
    expect(failure.chunkIndex).toBe(2);
    expect(failure.chunkCount).toBe(3);
    expect(sent).toHaveLength(2);
  });

  it('sends nothing for an empty file', async () => {
    const sendChunk = () => {
      throw new Error('must not be called');
    };
    await expect(importRowsInChunks([], sendChunk)).resolves.toEqual({
      inserted: 0,
      updated: 0,
      skipped: 0,
      warnings: [],
    });
  });

  it('summarizes the aggregated result including skipped rows', () => {
    expect(summarizeImportResult({ inserted: 9000, updated: 800, skipped: 200 }, 10000, 'products.xlsx'))
      .toEqual({ kind: 'success', text: 'تمت العملية بنجاح (إضافة 9000، تحديث 800، تخطي 200) من products.xlsx.' });
    expect(summarizeImportResult({ inserted: 5, updated: 0, warnings: ['w1'] }, 5, 'f.csv').kind).toBe('warning');
    expect(summarizeImportResult({}, 10, 'f.csv').text).toContain('معالجة 10');
  });
});
