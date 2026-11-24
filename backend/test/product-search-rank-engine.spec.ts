import assert from 'node:assert/strict';
import {
  compileProductSearchQuery,
  scoreProductSearchMatch,
  compareRankedProductMatches,
} from '../src/modules/catalog/engines/product-search-rank.engine';

function testIdentityOnlyExcludesSupplierAndCategoryNoise(): void {
  const query = compileProductSearchQuery('باهي');

  const bahy1k = scoreProductSearchMatch(
    query,
    {
      name: 'كرتونه باهي 1 ك',
      barcode: '6221001',
      secondaryValues: ['منظفات', 'شركة باهي للمنظفات'],
    },
    { identityOnly: true },
  );

  const bahy15k = scoreProductSearchMatch(
    query,
    {
      name: 'كرتونه باهي 1.5 ك',
      barcode: '6221002',
      secondaryValues: ['منظفات', 'شركة باهي للمنظفات'],
    },
    { identityOnly: true },
  );

  const oxi = scoreProductSearchMatch(
    query,
    {
      name: 'كرتونه اوكسي 1 ك',
      barcode: '6222001',
      secondaryValues: ['منظفات', 'شركة باهي للمنظفات'],
    },
    { identityOnly: true },
  );

  const wafeer = scoreProductSearchMatch(
    query,
    {
      name: 'كرتونه وفير سايل مواعين 4 لتر',
      barcode: '6222002',
      secondaryValues: ['منظفات', 'شركة باهي للمنظفات'],
    },
    { identityOnly: true },
  );

  assert.ok(bahy1k >= 800, `expected strong whole-word score for باهي 1 ك, got ${bahy1k}`);
  assert.ok(bahy15k >= 800, `expected strong whole-word score for باهي 1.5 ك, got ${bahy15k}`);
  assert.equal(oxi, 0, 'identityOnly must strictly exclude products matching only via supplier/category');
  assert.equal(wafeer, 0, 'identityOnly must strictly exclude products matching only via supplier/category');

  // General catalog search (identityOnly: false) still finds supplier matches at low priority
  const oxiGeneral = scoreProductSearchMatch(
    query,
    {
      name: 'كرتونه اوكسي 1 ك',
      barcode: '6222001',
      secondaryValues: ['منظفات', 'شركة باهي للمنظفات'],
    },
    { identityOnly: false },
  );
  assert.equal(oxiGeneral, 100);
  assert.ok(bahy15k > oxiGeneral, 'product name match must rank far above supplier metadata match');
}

function testDecimalAndMultiTokenArabicMatching(): void {
  const qDecimal = compileProductSearchQuery('باهي 1.5');
  assert.ok(
    scoreProductSearchMatch(qDecimal, { name: 'كرتونه باهي 1.5 ك' }, { identityOnly: true }) >= 650,
    'must match decimal weight with space before unit',
  );
  assert.ok(
    scoreProductSearchMatch(qDecimal, { name: 'كرتونه باهي 1.5ك' }, { identityOnly: true }) >= 650,
    'must match decimal weight attached to unit',
  );
  assert.ok(
    scoreProductSearchMatch(qDecimal, { name: 'باهي صابون سائل 1.5 لتر' }, { identityOnly: true }) >= 550,
    'must match non-adjacent tokens in product name',
  );
  assert.equal(
    scoreProductSearchMatch(qDecimal, { name: 'كرتونه باهي 1 ك' }, { identityOnly: true }),
    0,
    'must not match 1 ك when searching 1.5',
  );
}

function testShortArabicWordAndInStockPriority(): void {
  const qCoffee = compileProductSearchQuery('بن');
  const candidates = [
    { id: 10, name: 'جبنة بيضاء 1 ك', stock: 50 },
    { id: 11, name: 'لبن جهينة 1 لتر', stock: 40 },
    { id: 12, name: 'بن العميد قديم', stock: 0 },
    { id: 13, name: 'ربع بن محوج فاخر', stock: 12 },
    { id: 14, name: 'بن برازيلي فاتح', stock: 8 },
  ].map((item) => ({
    ...item,
    score: scoreProductSearchMatch(qCoffee, { name: item.name }, { identityOnly: true }),
  }));

  candidates.sort((a, b) => compareRankedProductMatches(a, b, { preferInStock: true }));

  // In-stock whole-word coffee matches must rank #1 and #2
  assert.deepEqual(
    candidates.slice(0, 2).map((c) => c.id),
    [14, 13],
    'in-stock whole-word coffee items must lead the results',
  );
  // Out-of-stock whole-word coffee match comes before weak inner-word substring matches (لبن / جبنة)
  assert.equal(candidates[2].id, 12);
}

function main(): void {
  testIdentityOnlyExcludesSupplierAndCategoryNoise();
  testDecimalAndMultiTokenArabicMatching();
  testShortArabicWordAndInStockPriority();
  console.log('product-search-rank-engine: all assertions passed');
}

main();
