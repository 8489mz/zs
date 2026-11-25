import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ForbiddenException } from '@nestjs/common';
import { AccountingAccessGuard } from '../../src/core/auth/guards/accounting-access.guard';

/**
 * ACC-ACCESS-1 … ACC-ACCESS-3 — دفاتر المنشأة المالية لا يفتحها كاشير.
 *
 * ## الثغرة (مثبتة على الإنتاج، 25 سبتمبر 2026)
 *
 * متحكّم المحاسبة كان يقبل `accounting` **أو** `accounts`. وقالب «كاشير» يمنح `accounts` لكل كاشير
 * (اسمها المعروض «الحسابات»، فتُفهم على أنها حسابات العملاء والموردين — وهي كذلك في المشتريات).
 *
 * ما منع الكارثة جزئياً أن `AccountingService.assertAccountingAccess` تطلب `accounting` تحديداً.
 * لكنه فحصٌ داخل الخدمة تنفّذه 31 دالة من 42، و**الميزانية العمومية وقائمة التدفقات النقدية في
 * خدمتين منفصلتين لا تفحصان شيئاً**. فثبت بطلب حقيقي بحساب `c1`:
 *
 *   GET /api/accounting/reports/balance-sheet → HTTP 200 وفيه الأصول والخزينة والمركز المالي
 *   GET /api/accounting/reports/cash-flow     → HTTP 200
 *
 * والدرس ليس «أضف الفحص في الخدمتين». حمايةٌ معلَّقة على أن يتذكّرها كاتبُ كل خدمة جديدة بين 82
 * مساراً ستُنسى مرة أخرى. البوابة عند الباب، والفحص داخل الخدمة طبقةٌ ثانية.
 */

const SRC = join(__dirname, '..', '..', 'src');
const read = (relative: string) => readFileSync(join(SRC, relative), 'utf8');

function contextFor(auth: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => ({ authContext: auth }) }),
  } as any;
}

/** ACC-ACCESS-1 — الحارس يطبّق قاعدة `assertAccountingAccess` حرفياً: لا أوسع ولا أضيق. */
function testGuardRule(): void {
  const guard = new AccountingAccessGuard();

  // مسموح: نفس من كانت الخدمة تسمح لهم — فلا يُمنع أحد كان يعمل.
  assert.equal(guard.canActivate(contextFor({ role: 'super_admin', permissions: [] })), true);
  assert.equal(guard.canActivate(contextFor({ role: 'admin', permissions: [] })), true,
    'an admin passed the service check by role, so the door must not be stricter than the room');
  assert.equal(guard.canActivate(contextFor({ role: 'cashier', permissions: ['accounting'] })), true);

  // ممنوع: الكاشير بقالب المنشأة — وهذه هي الثغرة نفسها.
  assert.throws(
    () => guard.canActivate(contextFor({
      role: 'cashier',
      permissions: ['sales', 'cashDrawer', 'customers', 'suppliers', 'accounts', 'purchases', 'products', 'returns'],
    })),
    ForbiddenException,
    '"accounts" must NOT open the books: every cashier created from the template has it',
  );
  assert.throws(() => guard.canActivate(contextFor({ role: 'cashier', permissions: [] })), ForbiddenException);
  assert.throws(() => guard.canActivate(contextFor(undefined)), ForbiddenException);
}

/** ACC-ACCESS-2 — الحارس مركَّب فعلاً على المتحكّم، فالقاعدة تسري على المسارات كلها. */
function testGuardIsMounted(): void {
  const controller = read('modules/accounting/accounting.controller.ts');
  assert.ok(
    /@UseGuards\([^)]*AccountingAccessGuard[^)]*\)/.test(controller),
    'the accounting controller must mount AccountingAccessGuard: 82 routes cannot each be remembered',
  );
  assert.ok(
    /import \{ AccountingAccessGuard \}/.test(controller),
    'the guard must be imported, not merely named',
  );

  // الفحص داخل الخدمة يبقى طبقة ثانية، فلا يُحذف بحجة وجود الحارس.
  const service = read('modules/accounting/accounting.service.ts');
  assert.ok(
    /private assertAccountingAccess/.test(service) && /permissions\.includes\('accounting'\)/.test(service),
    'the in-service check stays as the second layer',
  );
}

/**
 * ACC-ACCESS-3 — أي متحكّم مالي جديد يجب أن يحرس نفسه.
 *
 * الثغرة لم تكن في سطر، بل في أن تقريرين وُضعا في خدمتين جديدتين ولم يتذكّر أحدٌ الفحص. هذا
 * الفحص يجعل النسيان يسقط الحارس بدل أن يفتح الدفاتر.
 */
function testFinancialControllersAreGuarded(): void {
  const accountingDir = join(SRC, 'modules', 'accounting');
  const controllers = readdirSync(accountingDir).filter((name) => name.endsWith('.controller.ts'));
  assert.ok(controllers.length > 0, 'no accounting controller found — did the module move?');

  for (const name of controllers) {
    const source = readFileSync(join(accountingDir, name), 'utf8');
    const guarded = /AccountingAccessGuard/.test(source)
      || /@RequirePermissions\('accounting'\)/.test(source);
    assert.ok(
      guarded,
      `${name} serves financial data but neither mounts AccountingAccessGuard nor requires the `
      + '"accounting" permission outright. A cashier holds "accounts", and that is not the same thing.',
    );
  }
}

/**
 * ACC-ACCESS-4 — الاسمان المعروضان يجب أن يفرّقا بين الصلاحيتين.
 *
 * الثغرة لم تبدأ في الكود، بدأت في كلمة: `accounts` كانت معروضة «الحسابات» و`accounting`
 * «المحاسبة». فمنحها المالك للكاشير وهو يظن أنها حسابات العملاء والموردين — وهي كذلك فعلاً
 * (شاشة `accounts` كشوف حسابات وسندات قبض وصرف، ويحتاجها الكاشير). أما `accounting` فدفاتر
 * المنشأة. اسمان متشابهان لصلاحيتين متباعدتين هو ما جعل القرار الخاطئ يبدو صحيحاً.
 */
function testPermissionLabelsAreDistinguishable(): void {
  const labels = readFileSync(
    join(__dirname, '..', '..', '..', 'frontend', 'src', 'features', 'settings', 'components', 'user-management.shared.ts'),
    'utf8',
  ).replace(/\r\n/g, '\n');

  const labelFor = (key: string): string => {
    const match = new RegExp(`^  ${key}: '([^']+)'`, 'm').exec(labels);
    assert.ok(match, `PERMISSION_LABELS is missing ${key}`);
    return match![1];
  };

  const accounts = labelFor('accounts');
  const accounting = labelFor('accounting');

  assert.notEqual(accounts, accounting, 'two different permissions cannot share one label');
  assert.ok(
    accounts.includes('العملاء') && accounts.includes('الموردين'),
    `"accounts" must say whose accounts it means; it currently reads "${accounts}". `
    + 'An owner granting it to a cashier must not think it is the company books.',
  );
  assert.ok(
    /دفاتر|ميزانية|قيود/.test(accounting),
    `"accounting" must name the company books; it currently reads "${accounting}".`,
  );
}

/**
 * ACC-ACCESS-5 — ما يفتحه قالب «كاشير» لا يشمل مالاً.
 *
 * هذا هو الجرد الذي كشف البقية، مثبَّتاً. يبني ما تفتحه صلاحيات القالب من مسارات المنظومة كلها
 * (442 مساراً لها صلاحية صريحة، يفتح القالب منها نحو 210)، ويرفض أن يكون بينها مسارٌ ماليّ.
 *
 * وجد اثنين عند كتابته، كلاهما بنفس شكل ثغرة الميزانية — صلاحية دقيقة موجودة ومسارٌ في وحدة أخرى
 * يتخطّاها:
 *   - `GET /api/import-sales/profit-report` كان بـ`sales`، بينما `canViewProfit` موجودة ومُحترمة
 *     في `sales-query.service.ts`. فالكاشير يقرأ أرباح المحل.
 *   - `PUT /api/hr/settings/payroll-policies` كان بـ`hr`، بينما تشغيل الرواتب نفسه بـ
 *     `hrPayrollManage`. فالقواعد التي تُحسَب بها الرواتب أضعف حمايةً من الرواتب.
 */
function testCashierTemplateOpensNoMoney(): void {
  const sharedPath = join(
    __dirname, '..', '..', '..', 'frontend', 'src', 'features', 'settings', 'components', 'user-management.shared.ts',
  );
  const shared = readFileSync(sharedPath, 'utf8').replace(/\r\n/g, '\n');
  const listed = /DEFAULT_CASHIER_PERMS\s*=\s*\[([\s\S]*?)\]/.exec(shared);
  assert.ok(listed, 'DEFAULT_CASHIER_PERMS not found');
  const cashier = new Set(
    listed[1].split(',').map((entry) => entry.trim().replace(/['"]/g, '')).filter(Boolean),
  );

  const parse = (raw?: string): string[] | null => (
    raw ? raw.split(',').map((item) => item.trim().replace(/['"]/g, '')) : null
  );

  const opened: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!entry.name.endsWith('.controller.ts')) continue;

      const source = readFileSync(full, 'utf8').replace(/\r\n/g, '\n');
      const prefix = (/@Controller\('([^']*)'\)/.exec(source) || ['', ''])[1];
      const guardedByAccounting = source.includes('AccountingAccessGuard');
      const classAll = parse(/^@RequirePermissions\(([^)]*)\)/m.exec(source)?.[1]);
      const classAny = parse(/^@RequireAnyPermission\(([^)]*)\)/m.exec(source)?.[1]);

      // المزخرفات تُجمَع من **حول** سطر المسار في الاتجاهين.
      //
      // أول نسخة افترضت أن الصلاحية تسبق المسار دائماً، و`hr.controller.ts` يكتبها بعده:
      //     @Put('settings/payroll-policies')
      //     @RequirePermissions('hr')
      // فنسبت كل صلاحية إلى المسار التالي لها، وأسقطت مخالفةً حقيقية (تعديل سياسات الرواتب بـ`hr`).
      // فحصٌ يقرأ الملف خطأً يعطي براءةً كاذبة، وهي أسوأ من غياب الفحص.
      const lines = source.split('\n');
      const isDecorator = (line: string) => /^\s{2}@\w+/.test(line);
      for (let i = 0; i < lines.length; i += 1) {
        const matchRoute = /^\s{2}@(Get|Post|Put|Patch|Delete)\('?([^')]*)'?\)/.exec(lines[i]);
        if (!matchRoute) continue;

        let start = i;
        while (start > 0 && isDecorator(lines[start - 1])) start -= 1;
        let end = i;
        while (end + 1 < lines.length && isDecorator(lines[end + 1])) end += 1;

        let methodAll: string[] | null = null;
        let methodAny: string[] | null = null;
        for (let j = start; j <= end; j += 1) {
          const mAll = /^\s{2}@RequirePermissions\(([^)]*)\)/.exec(lines[j]);
          const mAny = /^\s{2}@RequireAnyPermission\(([^)]*)\)/.exec(lines[j]);
          if (mAll) methodAll = parse(mAll[1]);
          if (mAny) methodAny = parse(mAny[1]);
        }

        const all = methodAll ?? classAll;
        const any = methodAny ?? classAny;
        if (!all && !any) continue;
        if (guardedByAccounting && !cashier.has('accounting')) continue;
        if (all && !all.every((item) => cashier.has(item))) continue;
        if (any && !any.some((item) => cashier.has(item))) continue;
        opened.push(`${matchRoute[1]} /${[prefix, matchRoute[2]].filter(Boolean).join('/')}`);
      }
    }
  };
  walk(join(SRC, 'modules'));

  assert.ok(opened.length > 50, `the scan found only ${opened.length} routes — the parser broke, not the permissions`);

  // ما لا يجوز أن يفتحه الكاشير: أرقام المال، وأجور الناس، ومفاتيح المنصة.
  const forbidden = /balance-sheet|cash-flow|trial-balance|profit|equity|payroll|salar|billing|subscription|impersonat|backup|restore/i;
  const violations = opened.filter((route) => forbidden.test(route));
  assert.deepEqual(
    violations,
    [],
    `the cashier template opens routes it must not:\n  ${violations.join('\n  ')}\n`
    + 'A cashier sees the till, not the books, the payroll or the platform.',
  );
}

function run(): void {
  testGuardRule();
  testGuardIsMounted();
  testFinancialControllersAreGuarded();
  testPermissionLabelsAreDistinguishable();
  testCashierTemplateOpensNoMoney();
  console.log('accounting-access.spec: ACC-ACCESS-1..5 hold — "accounts" no longer opens the books');
}

try {
  run();
  process.exit(0);
} catch (error) {
  console.error(error);
  process.exit(1);
}
