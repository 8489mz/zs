import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ALL_OPERATIONAL_LOCATIONS,
  availableAcrossLocations,
  normalizeStorefrontStockMode,
  pickLocationCoveringOrder,
  resolveBranchSellableLocations,
  resolveStorefrontSalesStockMode,
} from '../../src/common/engines/branch-sellable-locations.engine';

/**
 * STK-1 … STK-3 — الكاشير والموقع يبيعان من نفس المخازن.
 *
 * ## التناقض المحروس هنا (اكتُشف 24 سبتمبر 2026 في جولة حِمل تبيع فعلاً)
 *
 * كانت إجابة «من أي مخازن يبيع هذا الفرع؟» مكتوبة في `SalesWriteService` وحدها، فنتج:
 *
 *   - الكتالوج العام يعرض الرصيد **العام** ⇒ «متاح»،
 *   - `createOnlineOrder` يفحص مخزن الفرع الافتراضي ⇒ «الرصيد في هذا المخزن 0» ويرفض،
 *   - والكاشير على **نفس الفرع ونفس الصنف** يبيعه، لأنه وحده يقرأ `sales_stock_mode`.
 *
 * أي أن الزبون يرى الصنف متاحاً ويُرفض عند الطلب، والبضاعة موجودة (50,000 قطعة) في مخزن يملك
 * الفرع حق البيع منه. الرسالة الحرفية من الإنتاج:
 *
 *   «عفواً، الرصيد المتاح من الصنف "أبل آيفون 15 برو ماكس" في هذا المخزن هو 0 فقط (المطلوب 1).»
 */

const SRC = join(__dirname, '..', '..', 'src');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');
const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

const LOCATIONS = [
  { id: 1, location_type: 'internal_warehouse', branch_id: null },   // المخزن الرئيسي، بلا فرع
  { id: 2, location_type: 'internal_warehouse', branch_id: 14 },     // مخزن فرع الاماراتي (الافتراضي)
  { id: 3, location_type: 'internal_warehouse', branch_id: 99 },     // مخزن فرع آخر
  { id: 4, location_type: 'external_warehouse', branch_id: null },   // مخزن خارجي
  { id: 5, location_type: 'damaged', branch_id: 14 },                // تالف
  { id: 6, location_type: 'in_transit', branch_id: 14 },             // في الطريق
];

/** STK-1 — الوضع الافتراضي لا يتغيّر: مخزن الفرع وحده. */
function testDefaultModeIsUnchanged(): void {
  const branch = { default_stock_location_id: 2, sales_stock_mode: 'branch_only', allow_external_sales_stock: false };
  assert.deepEqual(
    resolveBranchSellableLocations(branch, 14, LOCATIONS),
    [{ id: 2, branchId: 14 }],
    'a branch that is not in all-locations mode must keep selling from its own warehouse only — '
    + 'this fix must not widen anyone’s reach',
  );
  assert.deepEqual(resolveBranchSellableLocations(null, 14, LOCATIONS), []);
  assert.deepEqual(
    resolveBranchSellableLocations({ default_stock_location_id: null, sales_stock_mode: 'branch_only' }, 14, LOCATIONS),
    [],
  );
}

/** STK-2 — وضع «كل المخازن التشغيلية»: الترتيب والاستثناءات. */
function testAllOperationalLocations(): void {
  const branch = {
    default_stock_location_id: 2,
    sales_stock_mode: ALL_OPERATIONAL_LOCATIONS,
    allow_external_sales_stock: false,
  };
  const resolved = resolveBranchSellableLocations(branch, 14, LOCATIONS);
  const ids = resolved.map((location) => location.id);

  assert.equal(ids[0], 2, 'the branch default warehouse is drained first');
  assert.ok(ids.includes(1), 'an internal warehouse with no branch is shared stock and must be reachable');
  assert.ok(!ids.includes(3), "another branch's own warehouse is not this branch's to sell");
  assert.ok(!ids.includes(4), 'external warehouses need allow_external_sales_stock');
  assert.ok(!ids.includes(5) && !ids.includes(6), 'damaged and in-transit stock is never sellable');

  const withExternal = resolveBranchSellableLocations({ ...branch, allow_external_sales_stock: true }, 14, LOCATIONS);
  assert.ok(withExternal.map((l) => l.id).includes(4), 'external warehouses join once the branch allows them');
  assert.equal(withExternal[0].id, 2, 'the default warehouse stays first whatever else joins');
}

/** STK-3 — طلب المتجر يحجز في مخزن واحد، فالاختيار يجب أن يغطي كل الأسطر. */
function testSingleLocationPick(): void {
  const locations = [{ id: 2, branchId: 14 }, { id: 1, branchId: null }];
  const required = new Map<number, number>([[100, 1], [200, 3]]);

  // مخزن الفرع فارغ (الحالة الحقيقية)، والرئيسي فيه كل شيء.
  const availability = new Map<string, number>([
    ['2:100', 0], ['2:200', 0],
    ['1:100', 50000], ['1:200', 50000],
  ]);
  const chosen = pickLocationCoveringOrder(locations, required, (l, p) => availability.get(`${l}:${p}`) || 0);
  assert.deepEqual(chosen, { id: 1, branchId: null }, 'the order must land where the stock actually is');

  // تغطية جزئية لا تكفي: نصف الطلب في مخزن ونصفه في آخر ⇒ لا اختيار، فتظهر رسالة النقص الحقيقية.
  const partial = new Map<string, number>([
    ['2:100', 50], ['2:200', 0],
    ['1:100', 0], ['1:200', 50],
  ]);
  assert.equal(
    pickLocationCoveringOrder(locations, required, (l, p) => partial.get(`${l}:${p}`) || 0),
    null,
    'a location that covers only part of the order must not be chosen: a half reservation is worse than a clear refusal',
  );

  assert.equal(pickLocationCoveringOrder([], required, () => 99), null);
}

/** كلا المسارين يمرّان بالمحرك — وهذا هو جوهر الإصلاح. */
function testBothPathsUseTheEngine(): void {
  const pos = codeOf(read('modules/sales/services/create-sale.service.ts'));
  const storefront = codeOf(read('modules/storefront/storefront.service.ts'));

  for (const [name, source] of [['create-sale.service.ts', pos], ['storefront.service.ts', storefront]] as const) {
    assert.ok(
      /resolveBranchSellableLocations\(/.test(source),
      `${name} must resolve sellable warehouses through the shared engine, not its own copy of the rule`,
    );
  }

  // النمط الذي أنتج العطل: المتجر يأخذ المخزن الافتراضي وينتهي، بلا سؤال عن وضع البيع.
  assert.ok(
    /ALL_OPERATIONAL_LOCATIONS/.test(storefront),
    'createOnlineOrder must consider the branch sales_stock_mode, or the website refuses what the cashier sells',
  );
  assert.ok(
    /pickLocationCoveringOrder\(/.test(storefront),
    'an online order reserves at ONE location, so it must pick one that covers every line',
  );
}


/** STK-4 — الكتالوج يعرض ما يستطيع الطلب حجزه، لا الرصيد العام. */
function testCatalogueShowsWhatCanBeReserved(): void {
  // نفس حساب `reserveLocationStock`: مجموع المتاح في المخازن المؤهّلة + الرصيد غير المخصص.
  assert.equal(availableAcrossLocations([{ qty: 10, reserved: 3 }, { qty: 5, reserved: 0 }]), 12);
  assert.equal(
    availableAcrossLocations([{ qty: 10, reserved: 3 }], { qty: 4, reserved: 1 }),
    10,
    'stock not assigned to any location counts, because the reservation counts it',
  );
  assert.equal(availableAcrossLocations([{ qty: 2, reserved: 9 }]), 0, 'over-reserved never goes negative');
  assert.equal(availableAcrossLocations([]), 0);

  const storefront = codeOf(read('modules/storefront/storefront.service.ts'));
  assert.ok(
    !/const rawStock = Math\.max\(0, Number\(p\.stock_qty/.test(storefront),
    'the catalogue must not advertise the GLOBAL figure: that is what let a customer see stock the order path refused',
  );
  assert.ok(
    /storefrontAvailability\.get\(Number\(p\.id\)\)/.test(storefront),
    'the catalogue must read the availability computed from the same warehouses the order will reserve from',
  );
  assert.ok(
    /resolveStorefrontStockScope\(/.test(storefront),
    'catalogue and order must resolve their warehouses through one method',
  );
}

/** STK-5 — المتجر يستطيع مخالفة الكاشير، والافتراضي أن يتبعه. */
function testStorefrontModeOverride(): void {
  assert.equal(normalizeStorefrontStockMode(undefined), 'follow_branch', 'an unset tenant must behave exactly as before');
  assert.equal(normalizeStorefrontStockMode(''), 'follow_branch');
  assert.equal(normalizeStorefrontStockMode('nonsense'), 'follow_branch', 'an unknown value must not silently widen the scope');
  assert.equal(normalizeStorefrontStockMode('branch_only'), 'branch_only');

  // يتبع الفرع افتراضياً، في الاتجاهين.
  assert.equal(resolveStorefrontSalesStockMode(ALL_OPERATIONAL_LOCATIONS, 'follow_branch'), ALL_OPERATIONAL_LOCATIONS);
  assert.equal(resolveStorefrontSalesStockMode('branch_only', 'follow_branch'), 'branch_only');

  // الحالة التي طُلب من أجلها: المحل يبيع من كل المخازن والموقع من مخزن الفرع وحده.
  assert.equal(
    resolveStorefrontSalesStockMode(ALL_OPERATIONAL_LOCATIONS, 'branch_only'),
    'branch_only',
    'a merchant whose till draws on ten warehouses may still want the website to sell only what is in the shop',
  );
  assert.equal(resolveStorefrontSalesStockMode('branch_only', 'all_operational'), ALL_OPERATIONAL_LOCATIONS);
}

function run(): void {
  testDefaultModeIsUnchanged();
  testAllOperationalLocations();
  testSingleLocationPick();
  testBothPathsUseTheEngine();
  testCatalogueShowsWhatCanBeReserved();
  testStorefrontModeOverride();
  // eslint-disable-next-line no-console
  console.log('branch-sellable-locations.spec: STK-1..STK-5 hold — the website and the till sell from the same warehouses, and the catalogue shows only what can be reserved');
}

try {
  run();
  process.exit(0);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
}
