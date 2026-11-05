/* INV-IMPORT-PRODUCTS-BILINGUAL-NAMES-PAYLOAD: the Express JSON body limit is
 * 10mb (matching nginx client_max_body_size 10m), so a 10,000-row normalized
 * products import (~4.5 MB) fits inside it while the old 2mb limit rejected
 * anything above 2,500 rows. Run: npx ts-node test/infra/http-limits.spec.ts */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { JSON_BODY_LIMIT, JSON_BODY_LIMIT_BYTES } from '../../src/config/http-limits';

/** One normalized products row, exactly as ImportWorkbench emits it: the 18
 * English field keys only, every value a trimmed string. Mirrors the frontend
 * normalized shape (see frontend/src/shared/components/import-workbench.utils.spec.ts),
 * which proves the frontend actually emits this shape. */
function buildNormalizedProductRow(i: number): Record<string, string> {
  const n = String(i + 1).padStart(6, '0');
  return {
    name: `منتج اختبار ${i + 1}`,
    nameEn: `Test product ${i + 1}`,
    barcode: `T10K-${n}`,
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
  };
}

function run(): void {
  assert.equal(JSON_BODY_LIMIT, '10mb');
  assert.equal(JSON_BODY_LIMIT_BYTES, 10 * 1024 * 1024);

  const rows = Array.from({ length: 10000 }, (_, i) => buildNormalizedProductRow(i));
  const bodyBytes = Buffer.byteLength(JSON.stringify({ rows }), 'utf8');
  assert.ok(
    bodyBytes < JSON_BODY_LIMIT_BYTES,
    `10,000-row import body is ${bodyBytes} bytes, must stay under the 10mb limit`,
  );
  assert.ok(
    bodyBytes > 2 * 1024 * 1024,
    `10,000-row import body is only ${bodyBytes} bytes — the old 2mb limit would not have rejected it, so this no longer proves the fix`,
  );

  const main = readFileSync(join(__dirname, '..', '..', 'src', 'main.ts'), 'utf8');
  assert.ok(main.includes('JSON_BODY_LIMIT'), 'main.ts must use the shared JSON_BODY_LIMIT constant');
  assert.ok(!main.includes("limit: '2mb'"), 'main.ts must no longer carry the old 2mb JSON limit');
}

run();
process.stdout.write('http-limits.spec.ts passed\n');
