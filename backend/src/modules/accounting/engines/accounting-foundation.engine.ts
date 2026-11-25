/**
 * متى تكون الأسس المحاسبية لمنشأة **مكتملة** — منطق صرف، مصدر واحد للحقيقة.
 *
 * ## الخلل الذي وُلد هذا المحرك
 *
 * `AccountingTenantFoundationService` كان يقرر «هل هذه المنشأة مهيّأة؟» بسؤالين عن **الوجود** لا
 * عن **الاكتمال**:
 *
 * ```ts
 * if (targetAccountsCount === 0)  { ...ازرع شجرة الحسابات... }
 * if (!targetSettingsRow)         { ...عبّئ خريطة الحسابات... }
 * ```
 *
 * ثم جاءت الهجرة 106 (`goods_receipt_notes_and_three_way_matching`) وزرعت حسابين — GRNI (2125)
 * وPPV (5190) — في **كل منشأة**. فصار `count === 0` **لا يتحقق لأحد أبداً**، وتوقّف زرع شجرة
 * الحسابات عن العمل للمنصة كلها من تلك اللحظة. وبالمثل: صفٌّ في `accounting_settings` كل أعمدته
 * `NULL` يجعل `!targetSettingsRow` كاذباً، فلا تُعبَّأ الخريطة أبداً.
 *
 * النتيجة على الإنتاج (24 سبتمبر 2026): منشأة `hesham` بـ**2,281 فاتورة وصفر قيد محاسبي**،
 * و`drsh` و`zs` و`default` في نفس الحالة تنتظر أول بيعة. الوحيدة السليمة `almhnds` (52 حساباً)
 * لأنها زُرعت **قبل** الهجرة 106.
 *
 * **الدرس المعمّم:** عدد صفوف جدول ليس علامةً على «تمّت التهيئة». أي كود آخر قد يكتب صفاً في ذلك
 * الجدول لسبب لا علاقة له بالتهيئة، فيُطفئ العلامة إلى الأبد. الاكتمال يُقاس بوجود **ما يلزم
 * بالاسم**، وهذا ما يفعله هذا الملف.
 */

/**
 * أكواد الحسابات التي تقرؤها خريطة `accounting_settings`. غياب واحد منها يعني أن كل ترحيل يفشل
 * بـ`Invalid accounting setting account id`، فهذه هي قائمة «ما يلزم» حرفياً.
 */
export const REQUIRED_ACCOUNT_CODES = [
  '1110', // الخزينة
  '1120', // البنك
  '1130', // العملاء
  '1140', // المخزون
  '1150', // ضريبة المشتريات
  '2110', // الموردون
  '2120', // ضريبة المبيعات
  '2150', // دفعات مقدمة من العملاء (رصيد دائن / Store Credit)
  '4100', // إيرادات المبيعات
  '4300', // خصم المبيعات
  '4400', // مردودات المبيعات
  '5100', // تكلفة البضاعة المباعة
  '5300', // هالك وتالف مخزون
  '6900', // مواد التشغيل المصروفة نهائيًا
  '6000', // المصروفات
  '7290', // فروق التقريب المحاسبي
  '7110', // زيادة الصندوق
  '7210', // عجز الصندوق
] as const;

/** خريطة `accounting_settings`: اسم العمود ⇄ كود الحساب (وبديله إن وُجد). */
export const SETTINGS_ACCOUNT_MAP: Array<{ column: string; codes: string[] }> = [
  { column: 'cash_account_id', codes: ['1110'] },
  { column: 'bank_account_id', codes: ['1120'] },
  { column: 'customer_receivable_account_id', codes: ['1130'] },
  { column: 'supplier_payable_account_id', codes: ['2110'] },
  { column: 'inventory_account_id', codes: ['1140'] },
  { column: 'sales_revenue_account_id', codes: ['4100'] },
  { column: 'sales_discount_account_id', codes: ['4300'] },
  { column: 'cogs_account_id', codes: ['5100'] },
  { column: 'purchase_account_id', codes: ['5100'] },
  { column: 'expenses_account_id', codes: ['6700', '6900', '6000'] },
  { column: 'sales_tax_account_id', codes: ['2120'] },
  { column: 'purchase_tax_account_id', codes: ['1150'] },
];

/**
 * الأعمدة التي **لا يجوز** أن تبقى فارغة: هي التي يقرؤها ترحيل فاتورة البيع. البقية (كالبنك أو
 * ضريبة المشتريات) قد لا تلزم كل نشاط، فلا نُفشل التهيئة بسببها — لكننا نملؤها حين نستطيع.
 */
export const CRITICAL_SETTINGS_COLUMNS = [
  'cash_account_id',
  'customer_receivable_account_id',
  'inventory_account_id',
  'sales_revenue_account_id',
  'cogs_account_id',
] as const;

/** أكواد الحسابات المطلوبة وغير الموجودة. قائمة فارغة = الشجرة تكفي للترحيل. */
export function findMissingAccountCodes(existingCodes: Iterable<string>): string[] {
  const present = new Set<string>();
  for (const code of existingCodes) present.add(String(code || '').trim());
  return REQUIRED_ACCOUNT_CODES.filter((code) => !present.has(code));
}

/** يبني قيم خريطة الإعدادات من أكواد الحسابات الموجودة فعلاً. */
export function buildSettingsMapping(idByCode: Map<string, number>): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  for (const entry of SETTINGS_ACCOUNT_MAP) {
    let resolved: number | null = null;
    for (const code of entry.codes) {
      const id = idByCode.get(code);
      if (id && id > 0) {
        resolved = id;
        break;
      }
    }
    mapping[entry.column] = resolved;
  }
  return mapping;
}

/**
 * الأعمدة الحرجة الفارغة في صف إعدادات قائم. صفٌّ موجود لكنه فارغ هو بالضبط الحالة التي خدعت
 * الفحص القديم: `!row` كاذب، والخريطة لا تُعبَّأ، وكل ترحيل يفشل.
 */
export function findMissingSettingsColumns(row: Record<string, unknown> | null | undefined): string[] {
  if (!row) return [...CRITICAL_SETTINGS_COLUMNS];
  return CRITICAL_SETTINGS_COLUMNS.filter((column) => {
    const value = row[column];
    return value === null || value === undefined || Number(value) <= 0;
  });
}

/** هل الأسس مكتملة بحيث يستطيع الترحيل أن يعمل؟ */
export function isFoundationComplete(
  existingCodes: Iterable<string>,
  settingsRow: Record<string, unknown> | null | undefined,
): boolean {
  return findMissingAccountCodes(existingCodes).length === 0 && findMissingSettingsColumns(settingsRow).length === 0;
}
