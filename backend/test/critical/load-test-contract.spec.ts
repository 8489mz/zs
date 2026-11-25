import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * LTC-1 … LTC-3 — ما يرسله جناح الحِمل يجب أن يقبله السيرفر.
 *
 * ## لماذا يوجد هذا الملف
 *
 * عشر جولات على الإنتاج فشلت، كل واحدة تكلّف نشراً ودورة كاملة، وأغلب أسبابها من صنف واحد:
 * **حقل لا وجود له في الـDTO، أو مسار لا وجود له في المتحكم.** وكلاهما كان يمكن كشفه بقراءة
 * المصدر قبل الدفع، لا بتشغيل 150 مستخدماً على سيرفر حقيقي واكتشافه بعد ثلاث دقائق.
 *
 * الأنبوب العام `request-validation.pipe.ts` يعمل بـ**`forbidNonWhitelisted: true`**، فأي حقل
 * زائد واحد يعني **400 على كل طلب**، لا تحذيراً. هكذا رُفضت 959 فاتورة آجلة من 959 بسبب حقل
 * `total` وحده. وكذلك `/api/reports/...` بدل `/api/accounting/reports/...` ردّ 404 في ثلاث مللي
 * ثانية فبدا كأن التقارير «تفشل» وهي لم تُستدعَ.
 *
 * هذا الفحص يقرأ الأجسام التي يرسلها الجناح فعلاً، ويقارنها بالـDTO والمتحكم في المصدر. رخيص،
 * ويعمل قبل الدفع.
 */

const ROOT = join(__dirname, '..', '..', '..');
const SRC = join(__dirname, '..', '..', 'src');
const readSrc = (relative: string) => readFileSync(join(SRC, relative), 'utf8');
const readLoad = (relative: string) => readFileSync(join(ROOT, 'load-tests', relative), 'utf8').replace(/\r\n/g, '\n');

/** أسماء الحقول المعلَنة في صنف DTO — `name!: T` و`name?: T`. */
function dtoProperties(source: string, className: string): Set<string> {
  const start = source.indexOf(`class ${className}`);
  assert.ok(start >= 0, `DTO class ${className} not found`);
  // إلى بداية الصنف التالي أو نهاية الملف.
  const nextClass = source.indexOf('class ', start + className.length + 6);
  const body = source
    .slice(start, nextClass > 0 ? nextClass : undefined)
    // بعض الـDTO تكتب المزخرفات على نفس سطر الحقل (`@IsOptional() @IsNumber() openingCash?: number;`)
    // فتُجرَّد أولاً، وإلا بدت الحقول كأنها غير معلَنة.
    .replace(/@[A-Za-z]+\s*\([^()]*(?:\([^()]*\)[^()]*)*\)/g, ' ')
    .replace(/@[A-Za-z]+/g, ' ');
  const names = new Set<string>();
  for (const match of body.matchAll(/(?:^|\s)([a-zA-Z_][a-zA-Z0-9_]*)[!?]?:\s*[A-Za-z'{[(]/gm)) names.add(match[1]);
  return names;
}

/** مفاتيح كائن حرفي في جافاسكربت، من المستوى الأول فقط. */
function literalKeys(objectSource: string): Set<string> {
  const keys = new Set<string>();
  let depth = 0;
  for (let i = 0; i < objectSource.length; i += 1) {
    const ch = objectSource[i];
    if (ch === '{' || ch === '[' || ch === '(') depth += 1;
    else if (ch === '}' || ch === ']' || ch === ')') depth -= 1;
    else if (depth === 1) {
      const rest = objectSource.slice(i);
      const match = /^([a-zA-Z_][a-zA-Z0-9_]*)\s*:/.exec(rest);
      if (match && /[{,]\s*$/.test(objectSource.slice(0, i).replace(/\/\/.*$/gm, ''))) keys.add(match[1]);
    }
  }
  return keys;
}

/** يقتطع كائناً حرفياً يبدأ عند `{` الأولى بعد `from`. */
function sliceObject(source: string, from: number): string {
  const open = source.indexOf('{', from);
  assert.ok(open >= 0, 'no object literal found');
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error('unbalanced object literal');
}

/** LTC-1 — كل حقل يُرسل موجود في الـDTO. */
function testBodiesMatchDtos(): void {
  const full = readLoad(join('scenarios', 'full-system.js'));
  const posSell = readLoad(join('scenarios', 'pos-sell.js'));

  const saleDto = dtoProperties(readSrc('modules/sales/dto/upsert-sale.dto.ts'), 'UpsertSaleDto');
  const saleItemDto = dtoProperties(readSrc('modules/sales/dto/upsert-sale.dto.ts'), 'SaleItemDto');
  const returnDto = dtoProperties(readSrc('modules/returns/dto/create-return.dto.ts'), 'CreateReturnDto');
  const purchaseDto = dtoProperties(readSrc('modules/purchases/dto/upsert-purchase.dto.ts'), 'UpsertPurchaseDto');
  const purchaseItemDto = dtoProperties(readSrc('modules/purchases/dto/upsert-purchase.dto.ts'), 'PurchaseItemDto');
  const shiftOpenDto = dtoProperties(
    readSrc('modules/cash-drawer/dto/open-cashier-shift.dto.ts'),
    'OpenCashierShiftDto',
  );

  const cases: Array<{ what: string; source: string; anchor: string; allowed: Set<string> }> = [
    { what: 'the sale body in full-system.js', source: full, anchor: 'const base = {', allowed: saleDto },
    {
      what: 'the sale line in full-system.js',
      source: full,
      anchor: 'const lines = items.map((p) => ({',
      allowed: saleItemDto,
    },
    {
      what: 'the credit-sale extras in full-system.js',
      source: full,
      anchor: "{ paymentType: 'credit'",
      allowed: saleDto,
    },
    {
      what: 'the return body in full-system.js',
      source: full,
      anchor: "JSON.stringify({\n    type: 'sale'",
      allowed: returnDto,
    },
    {
      what: 'the purchase body in full-system.js',
      source: full,
      anchor: 'JSON.stringify({\n    supplierId',
      allowed: purchaseDto,
    },
    {
      what: 'the shift-open body in full-system.js',
      source: full,
      anchor: 'JSON.stringify({ openingCash',
      allowed: shiftOpenDto,
    },
    {
      what: 'the sale body in pos-sell.js',
      source: posSell,
      anchor: 'JSON.stringify({\n      paymentType',
      allowed: saleDto,
    },
    {
      what: 'the sale line in pos-sell.js',
      source: posSell,
      anchor: 'const lines = items.map((p) => ({',
      allowed: saleItemDto,
    },
  ];

  for (const testCase of cases) {
    const at = testCase.source.indexOf(testCase.anchor);
    assert.ok(at >= 0, `could not locate ${testCase.what} — the anchor "${testCase.anchor}" moved`);
    for (const key of literalKeys(sliceObject(testCase.source, at))) {
      assert.ok(
        testCase.allowed.has(key),
        `${testCase.what} sends "${key}", which is not a property of the DTO. ` +
          'The global pipe runs forbidNonWhitelisted, so one unknown field is a 400 on EVERY request ' +
          '(this is exactly how 959 credit sales out of 959 were refused over a stray "total").',
      );
    }
  }

  // بنود الشراء تُبنى على حدة، فتُفحص على حدة — **من داخل دالة الشراء**. البحث عن النمط في الملف
  // كله كان يصيب باني أسطر المرتجع أولاً فيفحصه بـDTO الشراء وينجح بلا معنى: فحصٌ يمرّ وهو ينظر
  // إلى الشيء الخطأ أسوأ من غيابه.
  const purchaseFnAt = full.indexOf('export function purchaseScenario');
  assert.ok(purchaseFnAt >= 0, 'purchaseScenario moved');
  const purchaseItems = full.indexOf('pickItems(data.sellable, 2).map((item) => ({', purchaseFnAt);
  assert.ok(purchaseItems > purchaseFnAt, 'the purchase line builder moved');
  for (const key of literalKeys(sliceObject(full, purchaseItems))) {
    assert.ok(purchaseItemDto.has(key), `a purchase line sends "${key}", which PurchaseItemDto does not declare`);
  }
}

/** LTC-2 — كل مسار يُنادى موجود في متحكّم. */
function testRoutesExist(): void {
  const controllers: Array<{ prefix: string; source: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.controller.ts')) {
        const source = readFileSync(full, 'utf8');
        const prefix = /@Controller\('([^']*)'\)/.exec(source)?.[1] ?? '';
        controllers.push({ prefix, source });
      }
    }
  };
  walk(join(SRC, 'modules'));

  const declared = new Set<string>();
  for (const controller of controllers) {
    for (const match of controller.source.matchAll(/@(?:Get|Post|Put|Patch|Delete)\('([^']*)'\)/g)) {
      const path = [controller.prefix, match[1]].filter(Boolean).join('/');
      declared.add(path.replace(/:[^/]+/g, ':p'));
    }
    for (const _ of controller.source.matchAll(/@(?:Get|Post|Put|Patch|Delete)\(\)/g)) {
      declared.add(controller.prefix);
    }
  }

  // المسارات التي ينادِيها الجناح، بصيغتها بعد استبدال المتغيّرات.
  const called = [
    'api/sales',
    'api/returns',
    'api/purchases',
    'api/branches',
    'api/customers',
    'api/suppliers',
    'api/cashier-shifts/open',
    'api/cashier-shifts/:p/close',
    'api/catalog/pos-products',
    'api/catalog/pos-products/version',
    'api/accounting/reports/financial-summary',
    'api/accounting/reports/receivables-payables',
    'api/accounting/reports/inventory-value',
    'api/accounting/reports/cash-movement',
    'api/storefront/:p/orders',
    'api/storefront/:p/catalog',
    'api/storefront/:p/info',
    'api/storefront/:p/orders/:p/cancel',
    'api/auth/login',
  ];
  for (const route of called) {
    assert.ok(
      declared.has(route),
      `the load suite calls "${route}", which no controller declares. ` +
        'A wrong path returns 404 in about three milliseconds and looks exactly like a failing endpoint ' +
        '(this is how 244 report checks failed while the endpoint was never reached).',
    );
  }
}

/** LTC-3 — الأنبوب ما زال يرفض الحقول الزائدة، وإلا فقد هذا الفحص معناه. */
function testPipeStillForbidsExtraFields(): void {
  const pipe = readSrc('common/pipes/request-validation.pipe.ts');
  assert.ok(
    /forbidNonWhitelisted:\s*true/.test(pipe),
    'LTC-1 assumes an unknown field is rejected; if the pipe stops forbidding them, say so deliberately',
  );
}

function run(): void {
  testBodiesMatchDtos();
  testRoutesExist();
  testPipeStillForbidsExtraFields();
  console.log('load-test-contract.spec: LTC-1..LTC-3 hold — every field and every route the load suite uses exists');
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
