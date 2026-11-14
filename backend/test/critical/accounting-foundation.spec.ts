import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  CRITICAL_SETTINGS_COLUMNS,
  REQUIRED_ACCOUNT_CODES,
  buildSettingsMapping,
  findMissingAccountCodes,
  findMissingSettingsColumns,
  isFoundationComplete,
} from '../../src/modules/accounting/engines/accounting-foundation.engine';

/**
 * ACC-1 … ACC-4 — لا فاتورة بلا دفتر.
 *
 * ## الحادثة التي وُلدت منها هذه الحُرّاس (24 سبتمبر 2026)
 *
 * جولة حِمل على الإنتاج أصدرت فواتير حقيقية لأول مرة، فكشفت منشأةً عليها **2,281 فاتورة وصفر قيد
 * محاسبي**. ولم تكن حالةً شاذة لمنشأة واحدة: `drsh` و`zs` و`default` كانت في نفس الحالة تنتظر أول
 * بيعة. السليمة الوحيدة `almhnds` لأنها هُيّئت **قبل** الهجرة 106.
 *
 * السلسلة، وكل حلقة فيها تبدو بريئة وحدها:
 *
 *  1. `AccountingTenantFoundationService` كان يسأل `accounts.count === 0` ليقرر «هل أزرع شجرة
 *     الحسابات؟». ثم زرعت الهجرة 106 حسابَي GRNI وPPV في **كل** منشأة، فلم يعد الشرط يتحقق لأحد،
 *     وتوقّف زرع الشجرة للمنصة كلها من تلك اللحظة.
 *  2. وكان يسأل `!settingsRow` ليقرر «هل أعبّئ خريطة الحسابات؟». وصفٌّ موجود بكل أعمدته `NULL`
 *     يجعل الشرط كاذباً، فلا تُعبَّأ الخريطة أبداً.
 *  3. فكل ترحيل يفشل بـ`Invalid accounting setting account id` — و`SalesWriteService` كان يبتلعه
 *     في `catch { logger.error }`، فتُحفظ الفاتورة ويرد السيرفر 201 ولا يعلم أحد.
 *
 * **الدرس المعمّم المحروس هنا:** عددُ صفوف جدول ليس علامة «تمّت التهيئة». أي كود آخر قد يكتب صفاً
 * فيه لسبب لا علاقة له بالتهيئة فيُطفئ العلامة إلى الأبد. الاكتمال يُقاس بوجود ما يلزم **بالاسم**.
 */

const SRC = join(__dirname, '..', '..', 'src');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

/** ACC-1 — كل كود تقرؤه خريطة الإعدادات موجود في الشجرة القياسية المزروعة. */
function testSeedCoversEveryRequiredCode(): void {
  const seedSource = read('modules/accounting/accounting-tenant-foundation.service.ts');
  const seededCodes = new Set(Array.from(seedSource.matchAll(/code: '(\d+)'/g)).map((m) => m[1]));

  assert.ok(seededCodes.size >= 20, `the standard chart looks truncated: only ${seededCodes.size} codes`);
  for (const code of REQUIRED_ACCOUNT_CODES) {
    assert.ok(
      seededCodes.has(code),
      `account ${code} is read by accounting_settings but DEFAULT_SEED_ACCOUNTS never creates it — `
      + 'every journal for a freshly seeded tenant would fail with "Invalid accounting setting account id"',
    );
  }

  // الخريطة والبذور يجب أن تبقيا متطابقتين: كود في الخريطة غير مزروع يعيد نفس العطل.
  const engineSource = read('modules/accounting/engines/accounting-foundation.engine.ts');
  const mappedCodes = Array.from(engineSource.matchAll(/codes: \[([^\]]+)\]/g))
    .flatMap((m) => m[1].split(',').map((part) => part.trim().replace(/'/g, '')));
  for (const code of mappedCodes) {
    assert.ok(seededCodes.has(code), `settings map points at account ${code}, which the seed never creates`);
  }
}

/** ACC-2 — الاكتمال يُقاس بالأسماء، لا بعدد الصفوف. */
function testCompletenessNotExistence(): void {
  // الحالة التي عطّلت المنصة: منشأة فيها حسابان (GRNI + PPV) من الهجرة 106 ولا شيء غيرهما.
  const migration106State = ['2125', '5190'];
  assert.notEqual(
    findMissingAccountCodes(migration106State).length,
    0,
    'two accounts seeded by an unrelated migration must NOT count as a prepared tenant',
  );
  assert.equal(
    isFoundationComplete(migration106State, null),
    false,
    'the exact production state that sold 2,281 invoices with no journal must read as incomplete',
  );

  const complete = [...REQUIRED_ACCOUNT_CODES, '2125', '5190'];
  assert.deepEqual(findMissingAccountCodes(complete), [], 'a full chart must read as complete');

  // الحالة الثانية: صفُّ إعدادات موجود لكن أعمدته الحرجة فارغة. `!row` كان يمرّ عليها.
  const emptySettings: Record<string, unknown> = {};
  for (const column of CRITICAL_SETTINGS_COLUMNS) emptySettings[column] = null;
  assert.deepEqual(
    findMissingSettingsColumns(emptySettings).sort(),
    [...CRITICAL_SETTINGS_COLUMNS].sort(),
    'a settings row whose columns are all NULL must read as missing, not as present',
  );
  assert.equal(findMissingSettingsColumns(null).length, CRITICAL_SETTINGS_COLUMNS.length);

  const filled: Record<string, unknown> = {};
  for (const column of CRITICAL_SETTINGS_COLUMNS) filled[column] = 7;
  assert.deepEqual(findMissingSettingsColumns(filled), []);

  // صفر ليس معرّف حساب صالح: `!(accountId > 0)` هو نصّ الرفض في accounting-posting.service.ts.
  assert.deepEqual(findMissingSettingsColumns({ ...filled, cash_account_id: 0 }), ['cash_account_id']);
}

/** ACC-3 — الخريطة تُبنى من الموجود فعلاً، وتحترم البديل. */
function testSettingsMappingResolution(): void {
  const ids = new Map<string, number>([
    ['1110', 11], ['1120', 12], ['1130', 13], ['1140', 14], ['1150', 15],
    ['2110', 21], ['2120', 22], ['4100', 41], ['4300', 43], ['5100', 51], ['6000', 60],
  ]);
  const mapping = buildSettingsMapping(ids);
  assert.equal(mapping.cash_account_id, 11);
  assert.equal(mapping.sales_revenue_account_id, 41);
  assert.equal(mapping.cogs_account_id, 51);
  assert.equal(mapping.purchase_account_id, 51, 'purchases share the COGS account by design');
  assert.equal(mapping.expenses_account_id, 60);

  // 6000 غائب ⇒ يسقط على 6700، وهو البديل المكتوب في الخريطة.
  const withFallback = new Map(ids);
  withFallback.delete('6000');
  withFallback.set('6700', 67);
  assert.equal(buildSettingsMapping(withFallback).expenses_account_id, 67);

  // لا اختراع: كود غير موجود يعطي null، لا صفراً ولا معرّفاً عشوائياً.
  assert.equal(buildSettingsMapping(new Map()).cash_account_id, null);
}

/**
 * ACC-4 — الأنماط التي أنتجت الحادثة ممنوعة في الكود نفسه، لا في النية.
 */
function testForbiddenPatternsAreGone(): void {
  const foundation = read('modules/accounting/accounting-tenant-foundation.service.ts');

  assert.ok(
    !/targetAccountsCount === 0/.test(foundation),
    'the chart must not be seeded on a row-count-is-zero test: migration 106 disabled exactly that check platform-wide',
  );
  assert.ok(
    !/if \(!targetSettingsRow\)/.test(foundation),
    'the settings map must not be written on an existence test: a row of NULLs made that check lie',
  );
  assert.ok(
    /findMissingAccountCodes/.test(foundation) && /findMissingSettingsColumns/.test(foundation),
    'the foundation must decide completeness through the shared engine',
  );

  // نسخ شجرة حسابات منشأة إلى أخرى تسريب بين المستأجرين، وكان مصدره «أي منشأة عندها حسابات».
  // التعليقات تُجرَّد أولاً: الملف يشرح النمط الممنوع في نثره، والنثر ليس ما يعمل.
  const codeOf = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(
    !/resolveSourceTenantId/.test(codeOf(foundation)),
    "a tenant's chart of accounts must never be cloned from another tenant",
  );

  // ابتلاع فشل التهيئة هو ما جعل الترحيل يفشل بصمت بعده.
  assert.ok(
    !/catch \(err: any\) \{[\s\S]{0,200}this\.logger\.error[\s\S]{0,120}\n    \}\n  \}\n\}/.test(foundation),
    'ensureForScope must not swallow its own failure',
  );
  assert.ok(
    /throw new Error\([\s\S]{0,200}still missing after seeding/.test(foundation),
    'an incomplete foundation must raise, not return quietly',
  );

  // New sales must fail atomically; durable recovery remains for historical failures.
  for (const path of ['modules/sales/services/sales-write.service.ts', 'modules/delivery-reps/van-sales.service.ts']) {
    const salesWrite = read(path);
    assert.ok(!/recordPostingFailure\(/.test(salesWrite),
      'new sale transactions must propagate journal errors, not commit an unposted invoice into the recovery queue');
  }
  for (const path of ['modules/sales/services/create-sale.service.ts', 'modules/delivery-reps/van-sales.service.ts']) {
    const salesWrite = read(path);
    assert.ok(/await this\.accountingPosting\.postSale\(trx,/.test(salesWrite));
    assert.ok(/clearPostingFailure\(trx,/.test(salesWrite),
      'a successful posting must still resolve a historical failure');
  }

  const salesWriteSrc = read('modules/sales/services/sales-edit-and-cancel.service.ts');
  const updateSaleBody = salesWriteSrc.slice(
    salesWriteSrc.indexOf('async updateSale('),
    salesWriteSrc.indexOf('async cancelSale('));
  assert.ok(/postSaleEdit\(trx,/.test(updateSaleBody),
    'updateSale must post the edit via postSaleEdit in the same transaction');
  assert.ok(!/reverseSaleJournal\(trx,/.test(updateSaleBody),
    'updateSale must not reverse explicitly before postSaleEdit, or postSaleEdit throws SALE_ALREADY_REVERSED');

  const posting = read('modules/accounting/services/journal-posting-core.service.ts');
  assert.ok(
    /INSERT INTO accounting_posting_failures/.test(posting) && /ON CONFLICT \(tenant_id, source_type, source_id\) DO UPDATE/.test(posting),
    'the failure record must be upserted per source, counting attempts rather than piling up rows',
  );

  const recovery = read('modules/accounting/services/accounting-recovery.service.ts');
  assert.ok(
    /repairAllTenantFoundations/.test(recovery) && /retryFailedPostings/.test(recovery),
    'a recorded failure nobody retries is a log line in nicer clothes',
  );
  assert.ok(
    /resolved_at.*is not null|resolved_at', 'is', null/.test(recovery),
    'the retry worker must only pick up unresolved failures',
  );
}

/** الهجرة 147 موجودة وقابلة للرجوع. */
function testMigrationContract(): void {
  const file = join(SRC, 'database', 'migrations', '2040000000147_accounting_posting_failures.ts');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { migration } = require(file);
  assert.equal(typeof migration.up, 'function');
  assert.equal(typeof migration.down, 'function');
  const text = readFileSync(file, 'utf8');
  assert.ok(/UNIQUE \(tenant_id, source_type, source_id\)/.test(text), 'one open failure per document, not a pile');
  assert.ok(/tenant_id TEXT NOT NULL/.test(text), 'every row must carry its tenant');
}

function run(): void {
  testSeedCoversEveryRequiredCode();
  testCompletenessNotExistence();
  testSettingsMappingResolution();
  testForbiddenPatternsAreGone();
  testMigrationContract();
  // eslint-disable-next-line no-console
  console.log('accounting-foundation.spec: ACC-1..ACC-4 hold — no tenant can sell without books, and no failed journal is silent');
}

try {
  run();
  process.exit(0);
} catch (error) {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
}
