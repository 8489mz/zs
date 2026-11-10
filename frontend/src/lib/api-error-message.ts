import {
  API_DB_CODE_FALLBACK_MESSAGES,
  API_FIELD_REQUIRED_MESSAGES,
  API_TECHNICAL_MESSAGE_PREFIXES,
  API_UNIQUE_CONSTRAINT_MESSAGES,
} from '@/lib/api-error-mapping';

type AnyRecord = Record<string, unknown>;

const MSG_REQUIRED_FIELD = '\u064a\u0648\u062c\u062f \u062d\u0642\u0644 \u0645\u0637\u0644\u0648\u0628 \u0644\u0645 \u064a\u062a\u0645 \u0625\u062f\u062e\u0627\u0644\u0647.';
const MSG_DUP_GENERIC = '\u0647\u0630\u0647 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0633\u062a\u062e\u062f\u0645\u0629 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_FOREIGN_KEY = '\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0644\u0623\u0646 \u0647\u0646\u0627\u0643 \u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0647\u0627.';
const MSG_INVALID_FIELD = '\u0642\u064a\u0645\u0629 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629 \u0641\u064a \u0623\u062d\u062f \u0627\u0644\u062d\u0642\u0648\u0644.';
const MSG_UNDEFINED_TABLE = '\u062c\u062f\u0648\u0644 \u0645\u0637\u0644\u0648\u0628 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f. \u0631\u0627\u062c\u0639 \u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.';
const MSG_UNDEFINED_COLUMN = '\u064a\u0648\u062c\u062f \u0639\u062f\u0645 \u062a\u0648\u0627\u0641\u0642 \u0641\u064a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u0631\u0627\u062c\u0639 \u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0627\u0644\u0646\u0638\u0627\u0645.';
const MSG_TEXT_TOO_LONG = '\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u062f\u062e\u0644 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0633\u0645\u0648\u062d.';
const MSG_OPERATION_FAILED = '\u062a\u0639\u0630\u0631 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629.';

function isObject(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object';
}

function firstMessageInArray(values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const nested = firstMessageInArray(value);
      if (nested) return nested;
    }
    if (isObject(value)) {
      const nested = firstNonEmpty(
        value.message,
        (value.error as AnyRecord | undefined)?.message,
        (value.details as AnyRecord | undefined)?.message,
      );
      if (nested) return nested;
    }
  }
  return '';
}

function firstNonEmpty(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const nested = firstMessageInArray(value);
      if (nested) return nested;
    }
  }
  return '';
}

function extractResponseData(error: unknown): AnyRecord | null {
  if (!isObject(error)) return null;
  const response = error.response;
  if (!isObject(response)) return null;
  const data = response.data;
  return isObject(data) ? data : null;
}

function extractPreferredMessage(error: unknown): string {
  const responseData = extractResponseData(error);
  if (responseData) {
    const fromResponse = firstNonEmpty(
      responseData.message,
      (responseData.error as AnyRecord | undefined)?.message,
      (responseData.details as AnyRecord | undefined)?.message,
    );
    if (fromResponse) return fromResponse;
  }

  if (isObject(error)) {
    const directMessage = firstNonEmpty(error.message);
    if (directMessage) return directMessage;

    const nested = firstNonEmpty(
      (error.error as AnyRecord | undefined)?.message,
      (error.details as AnyRecord | undefined)?.message,
      error.errors,
    );
    if (nested) return nested;
  }

  if (typeof error === 'string' && error.trim()) return error.trim();
  if (Array.isArray(error)) return firstMessageInArray(error);
  return '';
}

function extractErrorCode(error: unknown): string {
  const responseData = extractResponseData(error);
  if (responseData) {
    const fromResponse = firstNonEmpty(
      responseData.code,
      (responseData.error as AnyRecord | undefined)?.code,
      (responseData.details as AnyRecord | undefined)?.code,
    );
    if (fromResponse) return fromResponse;
  }

  if (isObject(error)) {
    return firstNonEmpty(
      error.code,
      (error.error as AnyRecord | undefined)?.code,
      (error.details as AnyRecord | undefined)?.code,
    );
  }

  return '';
}

function extractColumnFromText(message: string): string {
  return (message.match(/column\s+"?([a-zA-Z0-9_]+)"?/i)?.[1] || '').toLowerCase();
}

function extractConstraintHint(error: unknown, message: string): string {
  const responseData = extractResponseData(error);
  const details = responseData?.details;
  const detailsObject = isObject(details) ? details : null;

  const fromPayload = firstNonEmpty(
    detailsObject?.constraint,
    (responseData?.error as AnyRecord | undefined)?.constraint,
    (responseData?.details as AnyRecord | undefined)?.source,
  );
  if (fromPayload) return fromPayload.toLowerCase();

  const fromMessage = message.match(/\(([^)]+)\)=\(([^)]*)\)/)?.[1];
  if (fromMessage) return fromMessage.toLowerCase();

  return message.toLowerCase();
}

function mapNotNullMessage(error: unknown, message: string): string {
  const responseData = extractResponseData(error);
  const detailsObject = isObject(responseData?.details) ? (responseData?.details as AnyRecord) : null;
  const field = firstNonEmpty(detailsObject?.column, extractColumnFromText(message)).toLowerCase();
  if (field && API_FIELD_REQUIRED_MESSAGES[field]) return API_FIELD_REQUIRED_MESSAGES[field];
  return MSG_REQUIRED_FIELD;
}

function mapUniqueMessage(error: unknown, message: string): string {
  const hint = extractConstraintHint(error, message);
  const match = API_UNIQUE_CONSTRAINT_MESSAGES.find((entry) => entry.matcher.test(hint));
  return match?.message || MSG_DUP_GENERIC;
}

function isTechnicalMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return (
    API_TECHNICAL_MESSAGE_PREFIXES.some((prefix) => normalized.startsWith(prefix))
    || normalized.includes('violates unique constraint')
    || normalized.includes('violates check constraint')
    || normalized.includes('invalid input syntax')
  );
}

const ARABIC_CODE_MESSAGES: Record<string, string> = {
  PRODUCT_NOT_FOUND: 'الصنف المطلوب غير موجود أو تم حذفه.',
  CUSTOMER_NOT_FOUND: 'العميل المحدد غير موجود أو غير مسجل.',
  SUPPLIER_NOT_FOUND: 'المورد المحدد غير موجود أو غير مسجل.',
  CATEGORY_NOT_FOUND: 'القسم المحدد غير موجود أو تم حذفه.',
  TARGET_CATEGORY_NOT_FOUND: 'القسم المراد النقل إليه غير موجود.',
  LOCATION_NOT_FOUND: 'المخزن المحدد غير موجود.',
  LOCATION_REQUIRED: 'يجب تحديد مخزن الاستلام عند إضافة رصيد افتتاحي.',
  LOCATION_BRANCH_MISMATCH: 'المخزن المحدد لا يتبع الفرع المختار.',
  PRODUCT_NAME_REQUIRED: 'اسم الصنف الأساسي مطلوب.',
  BARCODE_EXISTS: 'الباركود مستخدم بالفعل لصنف آخر.',
  SKU_EXISTS: 'رمز SKU مستخدم بالفعل لصنف آخر.',
  PRODUCT_EXISTS: 'اسم أو كود الصنف مستخدم بالفعل.',
  FASHION_GROUP_NOT_FOUND: 'مجموعة الموديل المحددة غير موجودة.',
  USER_NOT_FOUND: 'المستخدم غير موجود.',
  SHIFT_NOT_FOUND: 'الوردية غير موجودة.',
  CASHIER_SHIFT_NOT_FOUND: 'وردية الكاشير غير موجودة.',
  OPEN_SHIFT_REQUIRED: 'يجب فتح وردية كاشير أولاً للمتابعة.',
  SALE_ITEMS_REQUIRED: 'لا يمكن حفظ فاتورة بدون أصناف.',
  HELD_DRAFT_ITEMS_REQUIRED: 'لا يمكن تعليق مسودة بدون أصناف.',
  CUSTOMER_REQUIRED_FOR_CREDIT: 'البيع الآجل يتطلب تحديد عميل.',
  AMOUNT_INVALID: 'المبلغ يجب أن يكون أكبر من صفر.',
  INTERNAL_ERROR: 'حدث خطأ غير متوقع في الخادم.',
  VALIDATION_ERROR: 'البيانات المدخلة غير صحيحة.',
  FORBIDDEN: 'ليس لديك صلاحية لتنفيذ هذا الإجراء.',
  UNAUTHORIZED: 'غير مصرح لك بالوصول. يرجى تسجيل الدخول مجدداً.',
  SESSION_NOT_FOUND: 'انتهت الجلسة. يرجى إعادة تسجيل الدخول.',
  MANAGER_PIN_INVALID: 'رمز المدير (PIN) غير صحيح.',
  MANAGER_PASSWORD_INVALID: 'كلمة مرور المدير غير صحيحة.',
  SHIFT_ALREADY_OPEN: 'توجد وردية مفتوحة بالفعل لهذا المستخدم.',
  SHIFT_ALREADY_CLOSED: 'تم إغلاق هذه الوردية بالفعل.',
  SHIFT_CLOSED: 'لا يمكن تنفيذ العملية على وردية مغلقة.',
  DAMAGE_NOTE_REQUIRED: 'يجب كتابة سبب الإتلاف في خانة الملاحظات.',
  CUSTOMER_EXISTS: 'يوجد عميل مسجل بالفعل بنفس هذا الاسم.',
  SUPPLIER_EXISTS: 'يوجد مورد مسجل بالفعل بنفس هذا الاسم.',
  CATEGORY_EXISTS: 'يوجد قسم مسجل بالفعل بنفس هذا الاسم.',
  PRODUCT_HAS_STOCK: 'لا يمكن حذف الصنف لوجود رصيد مخزني حالي له.',
  PRODUCT_HAS_HISTORY: 'لا يمكن حذف الصنف لارتباطه بحركات وفواتير سابقة.',
  PRICE_CHANGE_FORBIDDEN: 'ليس لديك صلاحية لتعديل الأسعار.',
  DISCOUNT_CHANGE_FORBIDDEN: 'ليس لديك صلاحية لتطبيق الخصم.',
  OPENING_STOCK_ACCOUNT_MISSING: 'حسابات المخزون ورأس المال الافتتاحي غير مهيأة في شجرة الحسابات.',
  OPENING_STOCK_LEDGER_UNAVAILABLE: 'خدمة القيود المحاسبية غير متاحة لإثبات الرصيد الافتتاحي.',
};

function mapByCode(errorCode: string, error: unknown, message: string): string {
  if (!errorCode) return '';

  const normalized = errorCode.trim().toUpperCase();
  if (normalized === '23502' || normalized === 'DB_NOT_NULL_VIOLATION') return mapNotNullMessage(error, message);
  if (normalized === '23505' || normalized.startsWith('DUPLICATE_') || normalized === 'DB_UNIQUE_VIOLATION') {
    const mapped = mapUniqueMessage(error, message);
    if (mapped === MSG_DUP_GENERIC && message && !isTechnicalMessage(message)) return message;
    return mapped;
  }
  if (normalized in API_DB_CODE_FALLBACK_MESSAGES) return API_DB_CODE_FALLBACK_MESSAGES[normalized];
  if (normalized in ARABIC_CODE_MESSAGES) return ARABIC_CODE_MESSAGES[normalized];
  return '';
}

function mapByTechnicalMessage(error: unknown, message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.startsWith('null value in column') || normalized.includes('violates not-null constraint')) {
    return mapNotNullMessage(error, message);
  }
  if (normalized.startsWith('duplicate key value') || normalized.includes('violates unique constraint')) {
    return mapUniqueMessage(error, message);
  }
  if (normalized.includes('violates foreign key constraint')) {
    return MSG_FOREIGN_KEY;
  }
  if (normalized.includes('violates check constraint')) {
    return MSG_INVALID_FIELD;
  }
  if (normalized.includes('relation') && normalized.includes('does not exist')) {
    return MSG_UNDEFINED_TABLE;
  }
  if (normalized.includes('column') && normalized.includes('does not exist')) {
    return MSG_UNDEFINED_COLUMN;
  }
  if (normalized.includes('value too long') || normalized.includes('too long for type')) {
    return MSG_TEXT_TOO_LONG;
  }
  if (normalized.includes('invalid input syntax')) {
    return MSG_INVALID_FIELD;
  }
  return MSG_OPERATION_FAILED;
}

function isEnglishMode(): boolean {
  if (typeof document !== 'undefined') {
    if (document.documentElement.lang?.startsWith('en')) return true;
    if (document.documentElement.dir === 'ltr') return true;
  }
  if (typeof window !== 'undefined') {
    const lng = window.localStorage.getItem('i18nextLng') || '';
    if (lng.startsWith('en')) return true;
  }
  return false;
}

const ENGLISH_CODE_MESSAGES: Record<string, string> = {
  PRODUCT_NOT_FOUND: 'Product not found.',
  CUSTOMER_NOT_FOUND: 'Customer not found.',
  SUPPLIER_NOT_FOUND: 'Supplier not found.',
  CATEGORY_NOT_FOUND: 'Category not found.',
  USER_NOT_FOUND: 'User not found.',
  SHIFT_NOT_FOUND: 'Shift not found.',
  CASHIER_SHIFT_NOT_FOUND: 'Cashier shift not found.',
  OPEN_SHIFT_REQUIRED: 'A cashier shift must be opened first.',
  SALE_ITEMS_REQUIRED: 'Cannot save an invoice with no items.',
  HELD_DRAFT_ITEMS_REQUIRED: 'Draft must include at least one item.',
  CUSTOMER_REQUIRED_FOR_CREDIT: 'Credit sale requires selecting a customer.',
  AMOUNT_INVALID: 'Amount must be greater than zero.',
  INTERNAL_ERROR: 'Internal server error occurred.',
  VALIDATION_ERROR: 'The submitted data is invalid.',
  FORBIDDEN: 'You are not allowed to perform this operation.',
  UNAUTHORIZED: 'You are unauthorized to access this resource.',
  SESSION_NOT_FOUND: 'Session not found.',
  MANAGER_PIN_INVALID: 'Invalid manager PIN.',
  MANAGER_PASSWORD_INVALID: 'Invalid manager password.',
  SHIFT_ALREADY_OPEN: 'A shift is already open for this user.',
  SHIFT_ALREADY_CLOSED: 'Shift is already closed.',
  SHIFT_CLOSED: 'Cannot perform operation on a closed shift.',
  DAMAGE_NOTE_REQUIRED: 'A reason must be entered in the notes field.',
  LOCATION_BRANCH_MISMATCH: 'Selected location does not belong to the specified branch.',
  CUSTOMER_EXISTS: 'A customer with this name already exists.',
  SUPPLIER_EXISTS: 'A supplier with this name already exists.',
  CATEGORY_EXISTS: 'A category with this name already exists.',
  PRODUCT_EXISTS: 'A product with this name or barcode already exists.',
  PRODUCT_HAS_STOCK: 'Cannot delete product because it has active stock.',
  PRODUCT_HAS_HISTORY: 'Cannot delete product because it has historical transactions.',
  PRICE_CHANGE_FORBIDDEN: 'Price modification requires price edit permissions.',
  DISCOUNT_CHANGE_FORBIDDEN: 'Discount modification requires discount permissions.',
  LOCATION_REQUIRED: 'A receiving warehouse must be selected when entering opening stock.',
  LOCATION_NOT_FOUND: 'Selected location not found.',
  PRODUCT_NAME_REQUIRED: 'Product name is required.',
  BARCODE_EXISTS: 'Barcode is already in use by another product.',
  SKU_EXISTS: 'SKU is already in use by another product.',
  TARGET_CATEGORY_NOT_FOUND: 'Target category not found.',
  FASHION_GROUP_NOT_FOUND: 'Fashion group no longer exists.',
  OPENING_STOCK_ACCOUNT_MISSING: 'Opening stock capital account is missing.',
  OPENING_STOCK_LEDGER_UNAVAILABLE: 'Opening stock ledger service is unavailable.',
};

const ARABIC_TO_ENGLISH_ERRORS: Record<string, string> = {
  'الصنف غير موجود': 'Product not found.',
  'العميل غير موجود': 'Customer not found.',
  'المورد غير موجود': 'Supplier not found.',
  'القسم غير موجود': 'Category not found.',
  'المستخدم غير موجود': 'User not found.',
  'الوردية غير موجودة': 'Shift not found.',
  'يجب فتح وردية كاشير أولاً': 'A cashier shift must be opened first.',
  'لا يمكن حفظ فاتورة بدون أصناف': 'Invoice must include at least one item.',
  'لا يمكن تعليق فاتورة بدون أصناف': 'Draft must include at least one item.',
  'البيع الآجل يتطلب تحديد عميل': 'Credit sale requires selecting a customer.',
  'المبلغ يجب أن يكون أكبر من صفر': 'Amount must be greater than zero.',
  'حدث خطأ داخلي في الخادم': 'Internal server error.',
  'البيانات المرسلة غير صحيحة': 'The submitted data is invalid.',
  'غير مصرح لك بالوصول': 'Unauthorized access.',
  'غير مسموح بتنفيذ هذه العملية': 'Operation not permitted.',
  'تعذر تنفيذ العملية المطلوبة': 'Unable to complete the requested operation.',
  'المخزون غير متاح لهذا الصنف': 'Stock is unavailable for this item.',
  'لا يمكن تعليق فاتورة فارغة': 'Cannot hold an empty invoice.',
  'تعذر حفظ الفاتورة المعلقة': 'Failed to save held invoice.',
  'تم تعليق الفاتورة الحالية ويمكن استرجاعها لاحقًا': 'Current invoice held successfully.',
  'يوجد حقل مطلوب لم يتم إدخاله': 'A required field is missing.',
  'الإضافات مطلوبة': 'Modifiers are required.',
  'هذه البيانات مستخدمة بالفعل': 'This record already exists.',
  'لا يمكن تنفيذ العملية لأن هناك بيانات مرتبطة بها': 'Cannot execute operation because related records exist.',
  'قيمة غير صحيحة في أحد الحقول': 'Invalid value in one of the fields.',
  'جدول مطلوب غير موجود. راجع تحديثات قاعدة البيانات': 'Required table not found.',
  'يوجد عدم توافق في قاعدة البيانات. راجع تحديثات النظام': 'Database schema mismatch.',
  'النص المدخل أطول من المسموح': 'Entered text exceeds allowed length.',
};

export function getFriendlyApiErrorMessage(error: unknown, fallback?: string): string {
  const isEn = isEnglishMode();
  const defaultFallback = isEn ? 'Unable to complete the requested operation.' : MSG_OPERATION_FAILED;
  const effectiveFallback = fallback || defaultFallback;

  if (!error) return effectiveFallback;

  const message = extractPreferredMessage(error);
  const code = extractErrorCode(error);

  if (isEn) {
    if (code && ENGLISH_CODE_MESSAGES[code.toUpperCase()]) {
      return ENGLISH_CODE_MESSAGES[code.toUpperCase()];
    }
    const trimmed = (message || '').trim().replace(/[.،]+$/, '');
    if (trimmed && ARABIC_TO_ENGLISH_ERRORS[trimmed]) {
      return ARABIC_TO_ENGLISH_ERRORS[trimmed];
    }
  }

  // INV-IMPORT-CONTAINER-DEPOSIT (I3-D8): a VALIDATION_ERROR carries a
  // field-specific backend message ("الحقل X غير مسموح إرساله."). The
  // code map below would replace it with the generic "البيانات المدخلة
  // غير صحيحة.", hiding which field failed. Prefer the specific
  // message for this code only; every other code keeps its mapped
  // text, and the generic backend fallback still maps to generic.
  if (code && code.trim().toUpperCase() === 'VALIDATION_ERROR') {
    const trimmed = (message || '').trim().replace(/[.،]+$/, '');
    if (trimmed && trimmed !== 'البيانات المدخلة غير صحيحة' && trimmed !== 'البيانات المرسلة غير صحيحة') {
      return message;
    }
  }

  const fromCode = mapByCode(code, error, message);
  if (fromCode) return fromCode;

  if (message) {
    if (isTechnicalMessage(message)) {
      return mapByTechnicalMessage(error, message);
    }
    return message;
  }

  return effectiveFallback;
}