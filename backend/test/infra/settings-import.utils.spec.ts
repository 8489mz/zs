/* INV-IMPORT-PRODUCTS-BILINGUAL-NAMES-PAYLOAD: the products import stores name =
 * Arabic name else English name, and name_en = English name else null — so a row
 * is valid when EITHER name is present. Run: npx ts-node
 * test/infra/settings-import.utils.spec.ts */

import assert from 'node:assert/strict';
import { resolveImportProductNames } from '../../src/modules/settings/services/settings-import.utils';

function run(): void {
  assert.deepEqual(
    resolveImportProductNames('منتج جديد', 'New product'),
    { name: 'منتج جديد', nameEn: 'New product' },
  );

  assert.deepEqual(
    resolveImportProductNames('', 'New product'),
    { name: 'New product', nameEn: 'New product' },
  );

  assert.deepEqual(
    resolveImportProductNames('منتج جديد', ''),
    { name: 'منتج جديد', nameEn: null },
  );

  assert.equal(resolveImportProductNames('', ''), null);
  assert.equal(resolveImportProductNames('   ', null), null);
  assert.equal(resolveImportProductNames(undefined, undefined), null);

  assert.deepEqual(
    resolveImportProductNames('  منتج جديد  ', '  New product  '),
    { name: 'منتج جديد', nameEn: 'New product' },
  );
}

run();
process.stdout.write('settings-import.utils.spec.ts passed\n');
