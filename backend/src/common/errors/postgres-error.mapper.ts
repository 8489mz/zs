import { AppError } from './app-error';

type PgErrorLike = {
  code?: unknown;
  message?: unknown;
  detail?: unknown;
  column?: unknown;
  constraint?: unknown;
  table?: unknown;
  cause?: unknown;
  originalError?: unknown;
  error?: unknown;
};

type KnownPgCode =
  | '23502'
  | '23505'
  | '23503'
  | '23514'
  | '42703'
  | '42P01'
  | '22001'
  | '22P02'
  | '40P01'
  | '40001';

const MSG_REQUIRED_NATIONAL_ID = '\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0642\u0648\u0645\u064a \u0645\u0637\u0644\u0648\u0628.';
const MSG_REQUIRED_NAME = '\u0627\u0644\u0627\u0633\u0645 \u0645\u0637\u0644\u0648\u0628.';
const MSG_REQUIRED_PRODUCT = '\u0627\u0644\u0635\u0646\u0641 \u0645\u0637\u0644\u0648\u0628.';
const MSG_REQUIRED_QTY = '\u0627\u0644\u0643\u0645\u064a\u0629 \u0645\u0637\u0644\u0648\u0628\u0629.';
const MSG_REQUIRED_PRICE = '\u0627\u0644\u0633\u0639\u0631 \u0645\u0637\u0644\u0648\u0628.';
const MSG_REQUIRED_FIELD = '\u064a\u0648\u062c\u062f \u062d\u0642\u0644 \u0645\u0637\u0644\u0648\u0628 \u0644\u0645 \u064a\u062a\u0645 \u0625\u062f\u062e\u0627\u0644\u0647.';
const MSG_DUP_EMPLOYEE_NO = '\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0638\u0641 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_DUP_PRODUCT = '\u0627\u0633\u0645 \u0623\u0648 \u0643\u0648\u062f \u0627\u0644\u0635\u0646\u0641 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_DUP_INVOICE = '\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_DUP_PHONE = '\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_DUP_GENERIC = '\u0647\u0630\u0647 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0633\u062a\u062e\u062f\u0645\u0629 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_FOREIGN_KEY = '\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0644\u0623\u0646 \u0647\u0646\u0627\u0643 \u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0647\u0627.';
const MSG_INVALID_FIELD = '\u0642\u064a\u0645\u0629 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629 \u0641\u064a \u0623\u062d\u062f \u0627\u0644\u062d\u0642\u0648\u0644.';
const MSG_UNDEFINED_COLUMN = '\u064a\u0648\u062c\u062f \u0639\u062f\u0645 \u062a\u0648\u0627\u0641\u0642 \u0641\u064a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u0631\u0627\u062c\u0639 \u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0627\u0644\u0646\u0638\u0627\u0645.';
const MSG_UNDEFINED_TABLE = '\u062c\u062f\u0648\u0644 \u0645\u0637\u0644\u0648\u0628 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f. \u0631\u0627\u062c\u0639 \u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.';
const MSG_TEXT_TOO_LONG = '\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u062f\u062e\u0644 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0633\u0645\u0648\u062d.';
const MSG_OPERATION_FAILED = '\u062a\u0639\u0630\u0631 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0627\u0644\u0645\u0637\u0644\u0648\u0628\u0629.';

const REQUIRED_FIELD_MESSAGES: Record<string, string> = {
  national_id: MSG_REQUIRED_NATIONAL_ID,
  name: MSG_REQUIRED_NAME,
  display_name: MSG_REQUIRED_NAME,
  first_name: MSG_REQUIRED_NAME,
  product_id: MSG_REQUIRED_PRODUCT,
  quantity: MSG_REQUIRED_QTY,
  qty: MSG_REQUIRED_QTY,
  price: MSG_REQUIRED_PRICE,
  unit_price: MSG_REQUIRED_PRICE,
};

const UNIQUE_CONSTRAINT_MESSAGES: Array<{ matcher: RegExp; message: string; appCode: string }> = [
  { matcher: /(employee[_-]?no|hr_employees.*employee_no)/i, message: MSG_DUP_EMPLOYEE_NO, appCode: 'DUPLICATE_EMPLOYEE_NO' },
  { matcher: /(product.*(name|code)|catalog_products.*(name|code)|sku|style[_-]?code)/i, message: MSG_DUP_PRODUCT, appCode: 'DUPLICATE_PRODUCT' },
  { matcher: /(invoice[_-]?no|sale[_-]?no|purchase[_-]?no|receipt[_-]?no|returns?[_-]?no)/i, message: MSG_DUP_INVOICE, appCode: 'DUPLICATE_INVOICE_NO' },
  { matcher: /(phone|mobile|tel|whatsapp)/i, message: MSG_DUP_PHONE, appCode: 'DUPLICATE_PHONE' },
];

const TECHNICAL_PREFIXES = [
  'kysely query error',
  'internal server error',
  'null value in column',
  'duplicate key value',
  'violates not-null constraint',
  'violates foreign key constraint',
];

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeKey(value: string): string {
  return value.trim().toLowerCase();
}

function pickFirstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function extractNestedDatabaseError(error: unknown, depth = 0): PgErrorLike | null {
  if (!error || depth > 5 || typeof error !== 'object') return null;
  const candidate = error as PgErrorLike;
  if (typeof candidate.code === 'string' || typeof candidate.message === 'string') return candidate;
  return (
    extractNestedDatabaseError(candidate.cause, depth + 1)
    || extractNestedDatabaseError(candidate.originalError, depth + 1)
    || extractNestedDatabaseError(candidate.error, depth + 1)
  );
}

function inferColumnFromMessageAndDetail(message: string, detail: string): string {
  const columnFromMessage = message.match(/column\s+"?([a-zA-Z0-9_]+)"?/i)?.[1];
  if (columnFromMessage) return normalizeKey(columnFromMessage);
  const keyFromDetail = detail.match(/\(([^)]+)\)=\(([^)]*)\)/)?.[1];
  if (keyFromDetail) return normalizeKey(keyFromDetail);
  return '';
}

function inferConstraintHint(error: PgErrorLike, message: string, detail: string): string {
  return normalizeKey(pickFirstString(error.constraint, detail, message));
}

function hasTechnicalPrefix(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  return TECHNICAL_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

function mapNotNullViolation(error: PgErrorLike, message: string, detail: string): AppError {
  console.error('[DB_NOT_NULL_VIOLATION]', { message, detail, column: error.column });
  const column = normalizeKey(pickFirstString(error.column, inferColumnFromMessageAndDetail(message, detail)));
  const mapped = column ? REQUIRED_FIELD_MESSAGES[column] : '';
  const isProd = process.env.NODE_ENV === 'production';
  return new AppError(mapped || MSG_REQUIRED_FIELD, 'DB_NOT_NULL_VIOLATION', 400, isProd ? undefined : { column: column || null });
}

function mapUniqueViolation(error: PgErrorLike, message: string, detail: string): AppError {
  const source = inferConstraintHint(error, message, detail);
  const match = UNIQUE_CONSTRAINT_MESSAGES.find((entry) => entry.matcher.test(source));
  const isProd = process.env.NODE_ENV === 'production';
  if (match) {
    return new AppError(match.message, match.appCode, 409, isProd ? undefined : {
      constraint: asText(error.constraint) || null,
      source,
    });
  }
  return new AppError(MSG_DUP_GENERIC, 'DB_UNIQUE_VIOLATION', 409, isProd ? undefined : {
    constraint: asText(error.constraint) || null,
    source: source || null,
  });
}

const FOREIGN_KEY_TARGET_NAMES: Record<string, string> = {
  location_id: 'المخزن أو موقع التخزين',
  default_stock_location_id: 'المخزن الافتراضي للفرع',
  branch_id: 'الفرع',
  customer_id: 'العميل',
  supplier_id: 'المورد',
  product_id: 'الصنف أو المنتج',
  component_product_id: 'المكون التصنيعي للصنف',
  user_id: 'المستخدم',
  created_by: 'المستخدم صاحب العملية',
  updated_by: 'المستخدم المسؤول عن التعديل',
  category_id: 'قسم الأصناف',
  brand_id: 'الماركة التجارية',
  unit_id: 'وحدة القياس',
  treasury_id: 'الخزينة النقدية',
  bank_account_id: 'الحساب البنكي',
  account_id: 'الحساب المالي في شجرة الحسابات',
  delivery_rep_id: 'مندوب التوصيل',
  shift_id: 'وردية الكاشير',
  bom_id: 'شجرة تصنيع الصنف (BOM)',
  sale_id: 'فاتورة المبيعات',
  purchase_id: 'فاتورة المشتريات',
  parent_id: 'العنصر الرئيسي / الحساب الأب',
};

const TABLE_ARABIC_NAMES: Record<string, string> = {
  stock_locations: 'المخازن ومواقع التخزين',
  branches: 'الفروع ومنافذ البيع',
  customers: 'العملاء',
  suppliers: 'الموردين',
  products: 'الأصناف',
  catalog_products: 'دليل الأصناف',
  users: 'المستخدمين',
  treasuries: 'الخزائن النقدية',
  bank_accounts: 'الحسابات البنكية',
  chart_of_accounts: 'شجرة الحسابات',
  delivery_representatives: 'مناديب التوصيل',
  cashier_shifts: 'ورديات الكاشير',
  sales: 'فواتير المبيعات',
  sale_items: 'بنود فواتير المبيعات',
  purchases: 'فواتير المشتريات',
  purchase_items: 'بنود فواتير المشتريات',
  journal_entries: 'قيود اليومية',
  journal_entry_lines: 'أسطر قيود اليومية',
};

function mapForeignKeyViolation(error: PgErrorLike, message: string, detail: string): AppError {
  const isProd = process.env.NODE_ENV === 'production';
  const detailText = detail || '';

  // 1. Case: Insert / Update referencing a missing parent entity
  // Detail format: Key (field)=(val) is not present in table "table_name".
  const notPresentMatch = detailText.match(/Key\s*\(([^)]+)\)=\(([^)]*)\)\s*is not present in table\s*"([^"]+)"/i);
  if (notPresentMatch) {
    const fieldName = notPresentMatch[1]?.trim().toLowerCase();
    const value = notPresentMatch[2]?.trim();
    const targetTable = notPresentMatch[3]?.trim().toLowerCase();

    const fieldLabel = FOREIGN_KEY_TARGET_NAMES[fieldName] || fieldName;
    const tableLabel = TABLE_ARABIC_NAMES[targetTable] || targetTable;

    if (fieldName === 'location_id' || targetTable === 'stock_locations') {
      return new AppError(
        `المخزن المحدد (#${value}) غير موجود في قائمة المخازن. يرجى مراجعة إعدادات الفرع والمخازن من (الإعدادات > الفروع).`,
        'DB_FOREIGN_KEY_NOT_FOUND',
        409,
        isProd ? undefined : { field: fieldName, value, targetTable }
      );
    }

    if (fieldName === 'created_by' && targetTable === 'users') {
      return new AppError(
        'انتهت صلاحية جلسة المستخدم الحالية بعد تحديث قاعدة البيانات، يرجى إعادة تسجيل الدخول.',
        'DB_USER_SESSION_EXPIRED',
        401,
        isProd ? undefined : { field: fieldName, value, targetTable }
      );
    }

    if (fieldName === 'customer_id' || targetTable === 'customers') {
      return new AppError(
        `العميل المحدد لهذه العملية (رقم #${value}) غير موجود في قاعدة البيانات. يرجى اختيار عميل مسجل.`,
        'DB_FOREIGN_KEY_NOT_FOUND',
        409,
        isProd ? undefined : { field: fieldName, value, targetTable }
      );
    }

    if (fieldName === 'branch_id' || targetTable === 'branches') {
      return new AppError(
        `الفرع المحدد (رقم #${value}) غير موجود في قائمة الفروع. يرجى التأكد من اختيار فرع نشط.`,
        'DB_FOREIGN_KEY_NOT_FOUND',
        409,
        isProd ? undefined : { field: fieldName, value, targetTable }
      );
    }

    if (fieldName === 'supplier_id' || targetTable === 'suppliers') {
      return new AppError(
        `المورد المحدد (رقم #${value}) غير موجود في قاعدة البيانات. يرجى اختيار مورد مسجل.`,
        'DB_FOREIGN_KEY_NOT_FOUND',
        409,
        isProd ? undefined : { field: fieldName, value, targetTable }
      );
    }

    if (fieldName === 'product_id' || targetTable === 'products') {
      return new AppError(
        `الصنف المحدد (رقم #${value}) غير موجود في دليل الأصناف أو تم حذفه.`,
        'DB_FOREIGN_KEY_NOT_FOUND',
        409,
        isProd ? undefined : { field: fieldName, value, targetTable }
      );
    }

    return new AppError(
      `تعذّر الحفظ: ${fieldLabel} المحدد (رقم ${value}) غير مسجل في قائمة ${tableLabel}.`,
      'DB_FOREIGN_KEY_NOT_FOUND',
      409,
      isProd ? undefined : { field: fieldName, value, targetTable }
    );
  }

  // 2. Case: Delete / Update where child records still reference this parent entity
  // Detail format: Key (field)=(val) is still referenced from table "table_name".
  const stillReferencedMatch = detailText.match(/Key\s*\(([^)]+)\)=\(([^)]*)\)\s*is still referenced from table\s*"([^"]+)"/i);
  if (stillReferencedMatch) {
    const fieldName = stillReferencedMatch[1]?.trim().toLowerCase();
    const value = stillReferencedMatch[2]?.trim();
    const referencingTable = stillReferencedMatch[3]?.trim().toLowerCase();

    const referencingTableLabel = TABLE_ARABIC_NAMES[referencingTable] || referencingTable;

    return new AppError(
      `لا يمكن حذف هذا العنصر لوجود سجلات وحركات مرتبطة به في قائمة (${referencingTableLabel}). يجب حذف أو تسوية تلك السجلات أولاً.`,
      'DB_FOREIGN_KEY_CONFLICT',
      409,
      isProd ? undefined : { field: fieldName, value, referencingTable }
    );
  }

  // 3. Fallback by Constraint Name
  const constraint = asText(error.constraint).toLowerCase();
  if (constraint.includes('location_id')) {
    return new AppError('المخزن المحدد غير مسجل في النظام. يرجى مراجعة وتعيين المخزن من (الإعدادات > الفروع).', 'DB_FOREIGN_KEY_NOT_FOUND', 409);
  }
  if (constraint.includes('customer_id')) {
    return new AppError('العميل المحدد غير موجود في قاعدة البيانات.', 'DB_FOREIGN_KEY_NOT_FOUND', 409);
  }
  if (constraint.includes('branch_id')) {
    return new AppError('الفرع المحدد غير موجود في قاعدة البيانات.', 'DB_FOREIGN_KEY_NOT_FOUND', 409);
  }
  if (constraint.includes('supplier_id')) {
    return new AppError('المورد المحدد غير موجود في قاعدة البيانات.', 'DB_FOREIGN_KEY_NOT_FOUND', 409);
  }
  if (constraint.includes('product_id')) {
    return new AppError('الصنف المحدد غير موجود في قاعدة البيانات.', 'DB_FOREIGN_KEY_NOT_FOUND', 409);
  }

  return new AppError(MSG_FOREIGN_KEY, 'DB_FOREIGN_KEY_VIOLATION', 409);
}

function mapKnownCode(code: KnownPgCode, error: PgErrorLike, message: string, detail: string): AppError {
  if (code === '23502') return mapNotNullViolation(error, message, detail);
  if (code === '23505') return mapUniqueViolation(error, message, detail);
  if (code === '23503') return mapForeignKeyViolation(error, message, detail);
  if (code === '23514') return new AppError(MSG_INVALID_FIELD, 'DB_CHECK_VIOLATION', 400, { constraint: asText(error.constraint) || null });
  if (code === '42703') return new AppError(MSG_UNDEFINED_COLUMN, 'DB_UNDEFINED_COLUMN', 500);
  if (code === '42P01') return new AppError(MSG_UNDEFINED_TABLE, 'DB_UNDEFINED_TABLE', 500);
  if (code === '22001') return new AppError(MSG_TEXT_TOO_LONG, 'DB_STRING_TOO_LONG', 400);
  if (code === '40P01') return new AppError('تعذّر إتمام العملية بسبب تعارض مع عملية متزامنة، يرجى إعادة المحاولة.', 'STOCK_CONFLICT', 409);
  if (code === '40001') return new AppError('تعذّر إتمام العملية بسبب تعارض في البيانات، يرجى إعادة المحاولة.', 'STOCK_CONFLICT', 409);
  return new AppError(MSG_INVALID_FIELD, 'DB_INVALID_TEXT_REPRESENTATION', 400, { message: message || null });
}

function mapByRawMessage(error: PgErrorLike, message: string, detail: string): AppError | null {
  const normalized = message.toLowerCase();
  if (normalized.startsWith('null value in column') || normalized.includes('violates not-null constraint')) {
    return mapNotNullViolation(error, message, detail);
  }
  if (normalized.startsWith('duplicate key value')) {
    return mapUniqueViolation(error, message, detail);
  }
  if (normalized.includes('violates foreign key constraint')) {
    return mapForeignKeyViolation(error, message, detail);
  }
  if (normalized.startsWith('kysely query error')) {
    const nested = extractNestedDatabaseError(error.cause ?? error.error);
    if (nested) {
      return mapPostgresErrorToAppError(nested);
    }
    return new AppError(MSG_OPERATION_FAILED, 'DB_QUERY_ERROR', 400);
  }
  return null;
}

export function mapPostgresErrorToAppError(error: unknown): AppError | null {
  const extracted = extractNestedDatabaseError(error);
  if (!extracted) return null;

  const code = asText(extracted.code).toUpperCase() as KnownPgCode | '';
  const message = asText(extracted.message);
  const detail = asText(extracted.detail);

  if (code && ['23502', '23505', '23503', '23514', '42703', '42P01', '22001', '22P02', '40P01', '40001'].includes(code)) {
    return mapKnownCode(code as KnownPgCode, extracted, message, detail);
  }

  if (message) {
    const messageBased = mapByRawMessage(extracted, message, detail);
    if (messageBased) return messageBased;

    if (hasTechnicalPrefix(message)) {
      return new AppError(MSG_OPERATION_FAILED, 'DB_QUERY_ERROR', 400);
    }
  }

  return null;
}