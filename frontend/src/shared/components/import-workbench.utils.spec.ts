/* INV-IMPORT-PRODUCTS-BILINGUAL-NAMES-PAYLOAD: the products import sends ONLY
 * the normalized English field keys — the raw Arabic-header row is never spread
 * into the payload — so a 10,000-row import stays under the 10mb JSON limit. */

import { describe, expect, it } from 'vitest';
import {
  normalizeImportRows,
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
