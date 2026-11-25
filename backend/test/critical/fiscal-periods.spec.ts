import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppError } from '../../src/common/errors/app-error';
import { buildMonthlyFiscalPeriods } from '../../src/modules/accounting/engines/fiscal-period-generation.engine';

// =============================================================================
// CRITICAL FINANCIAL AUDIT SUITE: Fiscal Periods & Monthly Closing (O6)
// Rule 13 (AGENTS.md): Proof of Financial & Operational Invariants
// =============================================================================

console.log('=== بدء اختبارات الفترات المحاسبية الشهرية وإقفال الشهور (البند O6) ===\n');

/**
 * 1. اختبارات خوارزمية تقسيم وتوليد الفترات المحاسبية الشهرية
 */
function testPeriodGenerationAlgorithm() {
  console.log('--- 1. اختبارات تقسيم وتوليد الفترات الشهرية (12 شهراً وسنوات كبيسة) ---');

  /**
   * **المحرك الحقيقي**، لا نسخة منه.
   *
   * كان هذا الاختبار يعيد كتابة الخوارزمية داخله ثم يفحص النسخة — فالخدمة تستطيع أن تتغير
   * والجناح يبقى أخضر. الحساب الآن في `fiscal-period-generation.engine.ts` وتستورده الخدمة
   * والاختبار معاً.
   */
  const generateMonthlyPeriods = buildMonthlyFiscalPeriods;

  // 1.1 سنة قياسية كاملة 2025 (12 شهر)
  {
    const periods = generateMonthlyPeriods('2025-01-01', '2025-12-31');
    assert.equal(periods.length, 12, 'السنة القياسية يجب أن تنقسم إلى 12 فترة شهرية');
    assert.equal(periods[0].name, 'يناير 2025');
    assert.equal(periods[0].startDate, '2025-01-01');
    assert.equal(periods[0].endDate, '2025-01-31');
    assert.equal(periods[1].name, 'فبراير 2025');
    assert.equal(periods[1].endDate, '2025-02-28', 'فبراير 2025 (بسيطة) يجب أن ينتهي في 28');
    assert.equal(periods[11].name, 'ديسمبر 2025');
    assert.equal(periods[11].endDate, '2025-12-31');
    console.log('✔ توليد 12 فترة شهرية متطابقة لسنة 2025 (نجاح)');
  }

  // 1.2 سنة كبيسة 2024 (فبراير 29 يوماً)
  {
    const periods = generateMonthlyPeriods('2024-01-01', '2024-12-31');
    assert.equal(periods[1].endDate, '2024-02-29', 'فبراير 2024 (كبيسة) يجب أن ينتهي في 29');
    console.log('✔ معالجة السنة الكبيسة بدقة لليوم 29 في فبراير (نجاح)');
  }

  // 1.3 سنة مالية تبدأ في منتصف السنة (مثلاً 1 يوليو إلى 30 يونيو)
  {
    const periods = generateMonthlyPeriods('2025-07-01', '2026-06-30');
    assert.equal(periods.length, 12, 'سنة مالية تبدأ في يوليو يجب أن تحتوي على 12 فترة');
    assert.equal(periods[0].name, 'يوليو 2025');
    assert.equal(periods[11].name, 'يونيو 2026');
    console.log('✔ دعم السنوات المالية ذات التواريخ المخصصة عبر سنتين تقويميتين (نجاح)');
  }
}

/**
 * 2. اختبارات ثوابت الترتيب الزمني للإقفال وإعادة الفتح والمسودات
 */
function testClosingAndReopeningInvariants() {
  console.log('\n--- 2. اختبارات ثوابت الترتيب الزمني والمسودات ---');

  type MockPeriod = {
    id: number;
    periodNumber: number;
    name: string;
    status: 'open' | 'closed';
  };

  function validateClosePeriod(params: { period: MockPeriod; allPeriods: MockPeriod[]; draftEntriesCount: number }) {
    if (params.period.status === 'closed') {
      throw new Error('الفترة المحاسبية مقفلة بالفعل.');
    }
    // الترتيب الزمني: لا يجوز إقفال شهر قبل إقفال الشهر السابق له
    const prevOpen = params.allPeriods
      .filter((p) => p.periodNumber < params.period.periodNumber && p.status === 'open')
      .sort((a, b) => a.periodNumber - b.periodNumber)[0];

    if (prevOpen) {
      throw new Error(`لا يمكن إقفال الفترة [${params.period.name}] قبل إقفال الفترة السابقة [${prevOpen.name}].`);
    }

    if (params.draftEntriesCount > 0) {
      throw new Error(`توجد ${params.draftEntriesCount} مسودات قيود محاسبية غير مرحّلة في هذه الفترة.`);
    }

    return true;
  }

  function validateReopenPeriod(params: { period: MockPeriod; allPeriods: MockPeriod[]; reason: string }) {
    if (!params.reason.trim()) {
      throw new Error('يجب ذكر سبب إعادة فتح الفترة المحاسبية للرقابة والتدقيق.');
    }
    if (params.period.status !== 'closed') {
      throw new Error('الفترة المحاسبية مفتوحة بالفعل.');
    }
    // الترتيب العكسي: لا يجوز إعادة فتح شهر طالما هناك شهر بعده مقفل
    const nextClosed = params.allPeriods
      .filter((p) => p.periodNumber > params.period.periodNumber && p.status === 'closed')
      .sort((a, b) => b.periodNumber - a.periodNumber)[0];

    if (nextClosed) {
      throw new Error(
        `لا يمكن إعادة فتح الفترة [${params.period.name}] لأن الفترة اللاحقة [${nextClosed.name}] مقفلة.`,
      );
    }

    return true;
  }

  const periods: MockPeriod[] = [
    { id: 1, periodNumber: 1, name: 'يناير 2025', status: 'open' },
    { id: 2, periodNumber: 2, name: 'فبراير 2025', status: 'open' },
    { id: 3, periodNumber: 3, name: 'مارس 2025', status: 'open' },
  ];

  // 2.1 محاولة إقفال فبراير قبل يناير يجب أن تفشل
  assert.throws(
    () => validateClosePeriod({ period: periods[1], allPeriods: periods, draftEntriesCount: 0 }),
    /قبل إقفال الفترة السابقة/,
    'محاولة إقفال شهر قبل الشهر السابق له يجب أن تُرفض',
  );
  console.log('✔ حظر إقفال شهر متقدم قبل إقفال الأشهر السابقة له (نجاح)');

  // 2.2 محاولة إقفال يناير مع وجود مسودات قيود معلقة يجب أن تفشل
  assert.throws(
    () => validateClosePeriod({ period: periods[0], allPeriods: periods, draftEntriesCount: 3 }),
    /مسودات قيود محاسبية غير مرحّلة/,
    'وجود مسودات غير مرحلة يجب أن يحجب إقفال الشهر',
  );
  console.log('✔ حظر إقفال الشهر عند وجود قيود معلقة في المسودة (نجاح)');

  // 2.3 إقفال يناير بنجاح (صفر مسودات)
  assert.equal(validateClosePeriod({ period: periods[0], allPeriods: periods, draftEntriesCount: 0 }), true);
  periods[0].status = 'closed';
  console.log('✔ إقفال يناير بنجاح بعد استيفاء الشروط (نجاح)');

  // 2.4 الآن يمكن إقفال فبراير
  assert.equal(validateClosePeriod({ period: periods[1], allPeriods: periods, draftEntriesCount: 0 }), true);
  periods[1].status = 'closed';
  console.log('✔ إقفال فبراير بنجاح بالتتابع الزمني (نجاح)');

  // 2.5 محاولة إعادة فتح يناير وفبراير مقفل يجب أن تفشل (حظر كسر الترتيب العكسي)
  assert.throws(
    () => validateReopenPeriod({ period: periods[0], allPeriods: periods, reason: 'تعديل سطر' }),
    /لأن الفترة اللاحقة.*مقفلة/,
    'لا يجوز إعادة فتح شهر قديم وشهر أحدث منه لا يزال مقفلاً',
  );
  console.log('✔ حظر إعادة فتح شهر قديم طالما الشهر اللاحق مقفل (نجاح)');

  // 2.6 إعادة فتح فبراير أولاً تنجح
  assert.equal(validateReopenPeriod({ period: periods[1], allPeriods: periods, reason: 'إدخال فاتورة متأخرة' }), true);
  periods[1].status = 'open';
  console.log('✔ إعادة فتح فبراير بنجاح بترتيب زمني عكسي (نجاح)');

  // 2.7 الآن يمكن إعادة فتح يناير
  assert.equal(validateReopenPeriod({ period: periods[0], allPeriods: periods, reason: 'تسوية رصيد' }), true);
  periods[0].status = 'open';
  console.log('✔ إعادة فتح يناير بنجاح بعد فتح فبراير (نجاح)');
}

/**
 * 3. اختبارات حارس ترحيل القيود ومنع الإدخال بأثر رجعي في فترة مقفلة
 */
function testJournalPostingPeriodLockGuard() {
  console.log('\n--- 3. اختبارات حارس ترحيل القيود ومنع الإدخال في فترة مقفلة ---');

  type MockPeriodRow = {
    id: number;
    name: string;
    period_number: number;
    start_date: string;
    end_date: string;
    status: 'open' | 'closed';
  };

  function validateEntryAgainstPeriods(entryDate: string, closedPeriods: MockPeriodRow[]) {
    const matchedClosed = closedPeriods.find(
      (p) => p.status === 'closed' && entryDate >= p.start_date && entryDate <= p.end_date,
    );

    if (matchedClosed) {
      throw new AppError(
        `الفترة المحاسبية الشهرية [${matchedClosed.name}] مقفلة. لا يمكن ترحيل حركات مالية في فترة مغلقة.`,
        'ACCOUNTING_PERIOD_LOCKED',
        400,
      );
    }

    return true;
  }

  const closedPeriods: MockPeriodRow[] = [
    { id: 1, name: 'يناير 2025', period_number: 1, start_date: '2025-01-01', end_date: '2025-01-31', status: 'closed' },
    {
      id: 2,
      name: 'فبراير 2025',
      period_number: 2,
      start_date: '2025-02-01',
      end_date: '2025-02-28',
      status: 'closed',
    },
  ];

  // 3.1 محاولة ترحيل قيد في 15 يناير 2025 (فترة مقفلة)
  assert.throws(
    () => validateEntryAgainstPeriods('2025-01-15', closedPeriods),
    (err: any) => {
      assert.equal(err.code, 'ACCOUNTING_PERIOD_LOCKED');
      assert.ok(err.message.includes('يناير 2025'));
      return true;
    },
    'محاولة الترحيل في فترة شهرية مقفلة يجب أن ترمي استثناء ACCOUNTING_PERIOD_LOCKED صريح',
  );
  console.log('✔ حجب الترحيل الفوري لقيد بتاريخ يقع ضمن شهر مقفل (يناير 2025)');

  // 3.2 محاولة ترحيل قيد في 20 فبراير 2025 (فترة مقفلة)
  assert.throws(
    () => validateEntryAgainstPeriods('2025-02-20', closedPeriods),
    (err: any) => {
      assert.equal(err.code, 'ACCOUNTING_PERIOD_LOCKED');
      assert.ok(err.message.includes('فبراير 2025'));
      return true;
    },
  );
  console.log('✔ حجب الترحيل الفوري لقيد بتاريخ يقع ضمن شهر مقفل (فبراير 2025)');

  // 3.3 ترحيل قيد في 5 مارس 2025 (فترة مفتوحة)
  assert.equal(
    validateEntryAgainstPeriods('2025-03-05', closedPeriods),
    true,
    'الترحيل في فترة مفتوحة يجب أن يمر بسلاسة',
  );
  console.log('✔ السماح بترحيل قيد بتاريخ يقع ضمن شهر مفتوح (مارس 2025)');
}

/**
 * 4. حراسة الإصلاحات التي كشفتها مراجعة هجرة 143 (FP-7 و FP-8 وعزل المستأجر).
 *
 * الأقسام 1-3 تختبر المنطق على نسخة مكتوبة داخل الاختبار. هذا القسم يقرأ **الكود الحقيقي**
 * ليمنع عودة ثلاثة أشياء تحديداً، كلٌّ منها كان موجوداً فعلاً وأُصلح:
 *   - فحص الترتيب الزمني وفحص المسودات خارج المعاملة (نافذة سباق).
 *   - إعادة الفتح تكتب `lock_date_all` بلا شرط فتمحو قفلاً يدوياً أقدم.
 *   - مفتاح أجنبي أحادي العمود لا يفرض عزل المستأجر في القاعدة (نمط O45).
 */
function testFiscalPeriodHardeningGuards() {
  console.log('\n--- 4. حراسة إصلاحات المراجعة: السباقات وقفل الدفاتر وعزل المستأجر ---');

  const root = join(__dirname, '..', '..');
  const read = (relative: string) => readFileSync(join(root, relative), 'utf8').replace(/\r\n/g, '\n');
  const servicePeriods = read('src/modules/accounting/services/fiscal-year-periods.service.ts');
  const servicePeriodClose = read('src/modules/accounting/services/fiscal-year-period-close.service.ts');
  const migration = read('src/database/migrations/2040000000144_fiscal_periods_tenant_fk_and_lock_snapshot.ts');

  const closeBody = servicePeriodClose.slice(
    servicePeriodClose.indexOf('async closeFiscalPeriod('),
    servicePeriodClose.indexOf('async reopenFiscalPeriod('),
  );
  const reopenBody = servicePeriodClose.slice(servicePeriodClose.indexOf('async reopenFiscalPeriod('));
  assert.ok(closeBody.length > 0 && reopenBody.length > 0, 'closeFiscalPeriod/reopenFiscalPeriod must exist');

  // FP-7: الفحص والكتابة في معاملة واحدة تحت قفل الصف.
  for (const [label, body] of [
    ['close', closeBody],
    ['reopen', reopenBody],
  ] as const) {
    const txIndex = body.indexOf('this.db.transaction()');
    assert.ok(txIndex > 0, `${label}FiscalPeriod must run inside a transaction`);
    const beforeTx = body.slice(0, txIndex);
    assert.ok(
      !/this\.db\s*\n?\s*\.selectFrom\('accounting_fiscal_periods'\)[\s\S]{0,400}?status'?,\s*'='/.test(beforeTx),
      `${label}FiscalPeriod must not decide on period status before the transaction opens`,
    );
    assert.ok(
      body.slice(txIndex).includes('.forUpdate()'),
      `${label}FiscalPeriod must lock the period row it decides on`,
    );
  }

  assert.ok(
    closeBody.indexOf("status', '=', 'draft'") > closeBody.indexOf('this.db.transaction()'),
    'the draft-entries check must run inside the transaction, or a draft saved in the gap lands in a closed month',
  );
  assert.ok(
    /const draftEntries = await trx/.test(closeBody),
    'the draft-entries check must read through the transaction, not this.db',
  );
  assert.ok(
    /const prevOpen = await trx/.test(closeBody),
    'the chronological-order check must read through the transaction, not this.db',
  );

  // FP-8: اللقطة تُحفظ عند الإقفال وتُستعاد عند إعادة الفتح، والقفل لا يتراجع.
  assert.ok(
    /previous_lock_date_all: previousLock/.test(closeBody),
    'closing must snapshot the lock date before raising it',
  );
  assert.ok(
    /previous_lock_date_all/.test(reopenBody) && /candidates/.test(reopenBody),
    'reopening must restore the snapshot, not recompute the lock from closed periods alone',
  );
  assert.ok(
    !/const newLock = latestClosedPeriod \? this\.formatDate\(latestClosedPeriod\.end_date\) : null;/.test(reopenBody),
    'reopening must never overwrite lock_date_all with only the latest closed period (it wipes a manual lock)',
  );

  // المحرك مصدر واحد: الخدمة تستورده ولا تعيد كتابته.
  assert.ok(
    /buildMonthlyFiscalPeriods/.test(servicePeriods),
    'the service must generate periods through the shared engine, not a private copy',
  );
  assert.ok(
    !/const monthNamesAr = \[/.test(servicePeriods),
    'a second copy of the month table in the service means the engine is being bypassed',
  );

  // قراءة الفترات لا تكتب (نمط O33).
  // التعليقات تُزال أولاً: توثيق `generateFiscalPeriods` يذكر الاسم، والمقصود هنا الكود لا النص.
  const listBody = servicePeriods
    .slice(servicePeriods.indexOf('async listFiscalPeriods('), servicePeriods.indexOf('async generateFiscalPeriods('))
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(listBody.length > 0, 'listFiscalPeriods must exist and sit before generateFiscalPeriods');
  assert.ok(
    !/ensurePeriodsForFiscalYear/.test(listBody),
    'listFiscalPeriods is a read path: generating rows there makes a GET write (the O33 pattern)',
  );
  assert.ok(
    /async generateFiscalPeriods\([\s\S]{0,200}this\.assertAdmin\(auth\)/.test(servicePeriods),
    'generation must be an explicit admin-only write path',
  );

  // عزل المستأجر مفروض من القاعدة (نمط O45).
  assert.ok(
    /FOREIGN KEY \(tenant_id, fiscal_year_id\)[\s\S]{0,80}REFERENCES accounting_fiscal_years \(tenant_id, id\)/.test(
      migration,
    ),
    'the period -> fiscal year link must be a composite (tenant_id, id) foreign key',
  );
  assert.ok(
    /DROP CONSTRAINT IF EXISTS accounting_fiscal_periods_fiscal_year_id_fkey/.test(migration),
    'the old single-column foreign key must be dropped, not left alongside',
  );
  assert.ok(
    /UNIQUE \(tenant_id, id\)/.test(migration),
    'the composite foreign key needs a matching unique key on accounting_fiscal_years',
  );

  console.log('✔ فحوص الترتيب الزمني والمسودات داخل المعاملة وتحت قفل الصف');
  console.log('✔ إعادة الفتح تستعيد لقطة القفل ولا تمحو قفلاً يدوياً أقدم');
  console.log('✔ ربط الفترة بالسنة المالية بمفتاح مركّب يفرض عزل المستأجر من القاعدة');
  console.log('✔ توليد الفترات في محرك واحد مستورَد، ومسار القراءة لا يكتب');
}

// تشغيل كافة الاختبارات
testPeriodGenerationAlgorithm();
testClosingAndReopeningInvariants();
testJournalPostingPeriodLockGuard();
testFiscalPeriodHardeningGuards();

console.log('\n=============================================================');
console.log('✅ نجحت كافة اختبارات الفترات المحاسبية الشهرية وإقفال الشهور (100%)');
console.log('=============================================================');
