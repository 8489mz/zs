const MSG_REQUIRED_NATIONAL_ID = '\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0642\u0648\u0645\u064a \u0645\u0637\u0644\u0648\u0628.';
const MSG_REQUIRED_NAME = '\u0627\u0644\u0627\u0633\u0645 \u0645\u0637\u0644\u0648\u0628.';
const MSG_REQUIRED_PRODUCT = '\u0627\u0644\u0635\u0646\u0641 \u0645\u0637\u0644\u0648\u0628.';
const MSG_REQUIRED_QTY = '\u0627\u0644\u0643\u0645\u064a\u0629 \u0645\u0637\u0644\u0648\u0628\u0629.';
const MSG_REQUIRED_PRICE = '\u0627\u0644\u0633\u0639\u0631 \u0645\u0637\u0644\u0648\u0628.';
const MSG_REQUIRED_MODIFIERS = '\u0627\u0644\u0625\u0636\u0627\u0641\u0627\u062a \u0645\u0637\u0644\u0648\u0628\u0629.';
const MSG_DUP_EMPLOYEE_NO = '\u0631\u0642\u0645 \u0627\u0644\u0645\u0648\u0638\u0641 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_DUP_PRODUCT = '\u0627\u0633\u0645 \u0623\u0648 \u0643\u0648\u062f \u0627\u0644\u0635\u0646\u0641 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_DUP_INVOICE = '\u0631\u0642\u0645 \u0627\u0644\u0641\u0627\u062a\u0648\u0631\u0629 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_DUP_PHONE = '\u0631\u0642\u0645 \u0627\u0644\u0647\u0627\u062a\u0641 \u0645\u0633\u062a\u062e\u062f\u0645 \u0628\u0627\u0644\u0641\u0639\u0644.';
const MSG_FOREIGN_KEY = '\u0644\u0627 \u064a\u0645\u0643\u0646 \u062a\u0646\u0641\u064a\u0630 \u0627\u0644\u0639\u0645\u0644\u064a\u0629 \u0644\u0623\u0646 \u0647\u0646\u0627\u0643 \u0628\u064a\u0627\u0646\u0627\u062a \u0645\u0631\u062a\u0628\u0637\u0629 \u0628\u0647\u0627.';
const MSG_INVALID_FIELD = '\u0642\u064a\u0645\u0629 \u063a\u064a\u0631 \u0635\u062d\u064a\u062d\u0629 \u0641\u064a \u0623\u062d\u062f \u0627\u0644\u062d\u0642\u0648\u0644.';
const MSG_UNDEFINED_COLUMN = '\u064a\u0648\u062c\u062f \u0639\u062f\u0645 \u062a\u0648\u0627\u0641\u0642 \u0641\u064a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a. \u0631\u0627\u062c\u0639 \u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0627\u0644\u0646\u0638\u0627\u0645.';
const MSG_UNDEFINED_TABLE = '\u062c\u062f\u0648\u0644 \u0645\u0637\u0644\u0648\u0628 \u063a\u064a\u0631 \u0645\u0648\u062c\u0648\u062f. \u0631\u0627\u062c\u0639 \u062a\u062d\u062f\u064a\u062b\u0627\u062a \u0642\u0627\u0639\u062f\u0629 \u0627\u0644\u0628\u064a\u0627\u0646\u0627\u062a.';
const MSG_TEXT_TOO_LONG = '\u0627\u0644\u0646\u0635 \u0627\u0644\u0645\u062f\u062e\u0644 \u0623\u0637\u0648\u0644 \u0645\u0646 \u0627\u0644\u0645\u0633\u0645\u0648\u062d.';

export const API_FIELD_REQUIRED_MESSAGES: Record<string, string> = {
  national_id: MSG_REQUIRED_NATIONAL_ID,
  name: MSG_REQUIRED_NAME,
  display_name: MSG_REQUIRED_NAME,
  first_name: MSG_REQUIRED_NAME,
  product_id: MSG_REQUIRED_PRODUCT,
  quantity: MSG_REQUIRED_QTY,
  qty: MSG_REQUIRED_QTY,
  price: MSG_REQUIRED_PRICE,
  unit_price: MSG_REQUIRED_PRICE,
  modifiers: MSG_REQUIRED_MODIFIERS,
};

export const API_TECHNICAL_MESSAGE_PREFIXES = [
  'kysely query error',
  'internal server error',
  'null value in column',
  'duplicate key value',
  'violates not-null constraint',
  'violates foreign key constraint',
];

export const API_DB_CODE_FALLBACK_MESSAGES: Record<string, string> = {
  '23503': MSG_FOREIGN_KEY,
  '23514': MSG_INVALID_FIELD,
  '42703': MSG_UNDEFINED_COLUMN,
  '42P01': MSG_UNDEFINED_TABLE,
  '22001': MSG_TEXT_TOO_LONG,
  '22P02': MSG_INVALID_FIELD,
};

export const API_UNIQUE_CONSTRAINT_MESSAGES: Array<{ matcher: RegExp; message: string }> = [
  { matcher: /(employee[_-]?no|hr_employees.*employee_no)/i, message: MSG_DUP_EMPLOYEE_NO },
  { matcher: /(product.*(name|code)|catalog_products.*(name|code)|sku|style[_-]?code)/i, message: MSG_DUP_PRODUCT },
  { matcher: /(invoice[_-]?no|sale[_-]?no|purchase[_-]?no|receipt[_-]?no|returns?[_-]?no)/i, message: MSG_DUP_INVOICE },
  { matcher: /(phone|mobile|tel|whatsapp)/i, message: MSG_DUP_PHONE },
];