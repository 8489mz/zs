import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { QueryFeedback } from '@/shared/components/query-feedback';
import { SharedSaleDetailCard, SharedPurchaseDetailCard } from '@/shared/components/invoice-detail-cards';
import { Card } from '@/shared/ui/card';
import { formatCurrency, formatDate } from '@/lib/format';
import type { Purchase, Sale } from '@/types/domain';
import type { SupplierPaymentDetail } from '@/shared/api/document-details';

interface AccountsInvoiceDetailCardProps {
  selectedLabel: string;
  documentType: 'sale' | 'purchase' | 'supplier_payment' | null;
  isLoading: boolean;
  error?: unknown;
  sale?: Sale | null;
  purchase?: Purchase | null;
  supplierPayment?: SupplierPaymentDetail | null;
}

type AnyRecord = Record<string, unknown>;

function asRecord(value: unknown): AnyRecord | null {
  return value && typeof value === 'object' ? value as AnyRecord : null;
}

function unwrapDocumentPayload(value: unknown, preferredKey: string): AnyRecord | null {
  const record = asRecord(value);
  if (!record) return null;

  const direct = asRecord(record[preferredKey]);
  if (direct) return unwrapDocumentPayload(direct, preferredKey) || direct;

  const nestedData = asRecord(record.data);
  if (nestedData) return unwrapDocumentPayload(nestedData, preferredKey) || nestedData;

  const nestedResult = asRecord(record.result);
  if (nestedResult) return unwrapDocumentPayload(nestedResult, preferredKey) || nestedResult;

  return record;
}

function firstText(record: AnyRecord, keys: string[], fallback = '') {
  for (const key of keys) {
    const value = record[key];
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return fallback;
}

function firstNumber(record: AnyRecord, keys: string[], fallback = 0) {
  for (const key of keys) {
    const value = record[key];
    const numeric = Number(value ?? NaN);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallback;
}

function firstBoolean(record: AnyRecord, keys: string[], fallback = false) {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string' && value.trim()) {
      const normalized = value.trim().toLowerCase();
      if (['true', '1', 'yes'].includes(normalized)) return true;
      if (['false', '0', 'no'].includes(normalized)) return false;
    }
  }
  return fallback;
}

function normalizeSaleItem(item: unknown) {
  const record = asRecord(item) || {};
  const productId = firstText(record, ['productId', 'product_id'], '');
  const unitName = firstText(record, ['unitName', 'unit_name'], 'قطعة');
  return {
    ...record,
    id: firstText(record, ['id'], `${productId}-${unitName}`),
    productId,
    name: firstText(record, ['name', 'productName', 'product_name'], '—'),
    qty: firstNumber(record, ['qty', 'quantity'], 0),
    price: firstNumber(record, ['price', 'unitPrice', 'unit_price'], 0),
    total: firstNumber(record, ['total', 'lineTotal', 'line_total'], 0),
    unitName,
    unitMultiplier: firstNumber(record, ['unitMultiplier', 'unit_multiplier'], 1),
    cost: firstNumber(record, ['cost', 'costPrice', 'cost_price'], 0),
    priceType: firstText(record, ['priceType', 'price_type'], 'retail'),
  };
}

function normalizePurchaseItem(item: unknown) {
  const record = asRecord(item) || {};
  const productId = firstText(record, ['productId', 'product_id'], '');
  const unitName = firstText(record, ['unitName', 'unit_name'], 'قطعة');
  return {
    ...record,
    id: firstText(record, ['id'], `${productId}-${unitName}`),
    productId,
    name: firstText(record, ['name', 'productName', 'product_name'], '—'),
    qty: firstNumber(record, ['qty', 'quantity'], 0),
    cost: firstNumber(record, ['cost', 'unitCost', 'unit_cost', 'price'], 0),
    total: firstNumber(record, ['total', 'lineTotal', 'line_total'], 0),
    unitName,
    unitMultiplier: firstNumber(record, ['unitMultiplier', 'unit_multiplier'], 1),
  };
}

function normalizeSale(value: unknown): Sale | null {
  const record = unwrapDocumentPayload(value, 'sale');
  if (!record) return null;
  const id = firstText(record, ['id'], '');
  const items = Array.isArray(record.items) ? record.items.map(normalizeSaleItem) : [];

  const normalized = {
    ...record,
    id,
    docNo: firstText(record, ['docNo', 'doc_no'], id ? `Z-${id}` : ''),
    customerId: firstText(record, ['customerId', 'customer_id'], ''),
    customerName: firstText(record, ['customerName', 'customer_name_ref', 'customer_name'], 'عميل نقدي'),
    paymentType: firstText(record, ['paymentType', 'payment_type'], 'cash'),
    paymentChannel: firstText(record, ['paymentChannel', 'payment_channel'], 'cash'),
    subTotal: firstNumber(record, ['subTotal', 'subtotal'], 0),
    discount: firstNumber(record, ['discount'], 0),
    taxRate: firstNumber(record, ['taxRate', 'tax_rate'], 0),
    taxAmount: firstNumber(record, ['taxAmount', 'tax_amount'], 0),
    pricesIncludeTax: firstBoolean(record, ['pricesIncludeTax', 'prices_include_tax'], false),
    total: firstNumber(record, ['total'], 0),
    paidAmount: firstNumber(record, ['paidAmount', 'paid_amount'], 0),
    status: firstText(record, ['status'], 'posted'),
    note: firstText(record, ['note'], ''),
    date: firstText(record, ['date', 'createdAt', 'created_at'], ''),
    branchId: firstText(record, ['branchId', 'branch_id'], ''),
    locationId: firstText(record, ['locationId', 'location_id'], ''),
    branchName: firstText(record, ['branchName', 'branch_name'], ''),
    locationName: firstText(record, ['locationName', 'location_name'], ''),
    items,
    payments: Array.isArray(record.payments) ? record.payments : [],
  };

  return normalized as unknown as Sale;
}

function normalizePurchase(value: unknown): Purchase | null {
  const record = unwrapDocumentPayload(value, 'purchase');
  if (!record) return null;
  const id = firstText(record, ['id'], '');
  const items = Array.isArray(record.items) ? record.items.map(normalizePurchaseItem) : [];

  const normalized = {
    ...record,
    id,
    docNo: firstText(record, ['docNo', 'doc_no'], id ? `P-${id}` : ''),
    supplierId: firstText(record, ['supplierId', 'supplier_id'], ''),
    supplierName: firstText(record, ['supplierName', 'supplier_name'], '—'),
    paymentType: firstText(record, ['paymentType', 'payment_type'], 'cash'),
    subTotal: firstNumber(record, ['subTotal', 'subtotal'], 0),
    discount: firstNumber(record, ['discount'], 0),
    taxRate: firstNumber(record, ['taxRate', 'tax_rate'], 0),
    taxAmount: firstNumber(record, ['taxAmount', 'tax_amount'], 0),
    pricesIncludeTax: firstBoolean(record, ['pricesIncludeTax', 'prices_include_tax'], false),
    total: firstNumber(record, ['total'], 0),
    status: firstText(record, ['status'], 'posted'),
    note: firstText(record, ['note'], ''),
    date: firstText(record, ['date', 'createdAt', 'created_at'], ''),
    branchId: firstText(record, ['branchId', 'branch_id'], ''),
    locationId: firstText(record, ['locationId', 'location_id'], ''),
    branchName: firstText(record, ['branchName', 'branch_name'], ''),
    locationName: firstText(record, ['locationName', 'location_name'], ''),
    items,
  };

  return normalized as unknown as Purchase;
}

/* INV-STATEMENT-PAYMENT-DETAILS: the payment's own data -- ZPV voucher,
 * JE journal number (read from entry_no, never derived from the id),
 * amount, supplier, date, note, channel and the IPA address when the
 * channel is InstaPay. Rendered only for documentType 'supplier_payment',
 * so a payment row can never be shown through the purchase card. */
function normalizeSupplierPayment(value: unknown): SupplierPaymentDetail | null {
  const record = unwrapDocumentPayload(value, 'supplierPayment');
  if (!record) return null;
  const id = firstText(record, ['id'], '');
  if (!id && !firstText(record, ['docNo', 'doc_no'], '')) return null;
  return {
    id,
    docNo: firstText(record, ['docNo', 'doc_no'], id ? `ZPV-${id}` : ''),
    supplierId: firstText(record, ['supplierId', 'supplier_id'], ''),
    supplierName: firstText(record, ['supplierName', 'supplier_name'], '—'),
    amount: firstNumber(record, ['amount'], 0),
    note: firstText(record, ['note'], ''),
    date: firstText(record, ['date', 'paymentDate', 'payment_date', 'createdAt', 'created_at'], ''),
    paymentChannel: firstText(record, ['paymentChannel', 'payment_channel'], 'cash'),
    instapayAddress: firstText(record, ['instapayAddress', 'instapay_address'], ''),
    branchId: firstText(record, ['branchId', 'branch_id'], ''),
    locationId: firstText(record, ['locationId', 'location_id'], ''),
    branchName: firstText(record, ['branchName', 'branch_name'], ''),
    locationName: firstText(record, ['locationName', 'location_name'], ''),
    createdBy: firstText(record, ['createdBy', 'created_by'], ''),
    journalEntryId: firstText(record, ['journalEntryId', 'journal_entry_id'], ''),
    journalNo: firstText(record, ['journalNo', 'journal_no', 'entryNo', 'entry_no'], ''),
  };
}

function paymentChannelLabel(channel: string, t: TFunction): string {
  switch (channel.toLowerCase()) {
    case 'bank': return t('accounts.accounts_invoice_detail_card.s5', "تحويل بنكي");
    case 'card': return t('accounts.accounts_invoice_detail_card.s6', "بطاقة");
    case 'wallet': return t('accounts.accounts_invoice_detail_card.s7', "محفظة");
    case 'instapay': return t('accounts.accounts_invoice_detail_card.s8', "إنستاباي");
    default: return t('accounts.accounts_invoice_detail_card.s9', "نقدي");
  }
}

export function AccountsInvoiceDetailCard({
  selectedLabel,
  documentType,
  isLoading,
  error,
  sale,
  purchase,
  supplierPayment,
}: AccountsInvoiceDetailCardProps) {
  const { t } = useTranslation();
  const normalizedSale = documentType === 'sale' ? normalizeSale(sale) : null;
  const normalizedPurchase = documentType === 'purchase' ? normalizePurchase(purchase) : null;
  const normalizedSupplierPayment = documentType === 'supplier_payment' ? normalizeSupplierPayment(supplierPayment) : null;
  const hasSelectedDocument = Boolean(documentType);
  const isPayment = documentType === 'supplier_payment';

  return (
    <QueryFeedback
      isLoading={isLoading}
      isError={Boolean(error)}
      error={error}
      loadingText={isPayment
        ? t('accounts.accounts_invoice_detail_card.s10', "جارٍ تحميل تفاصيل الدفع...")
        : t('accounts.accounts_invoice_detail_card.s0', "جارٍ تحميل تفاصيل الفاتورة...")}
      errorTitle={isPayment
        ? t('accounts.accounts_invoice_detail_card.s11', "تعذر تحميل تفاصيل الدفع")
        : t('accounts.accounts_invoice_detail_card.s1', "تعذر تحميل تفاصيل الفاتورة")}
      isEmpty={!hasSelectedDocument || (!normalizedSale && !normalizedPurchase && !normalizedSupplierPayment)}
      emptyTitle={isPayment
        ? t('accounts.accounts_invoice_detail_card.s12', "اختر دفعة من القيود لعرض تفاصيلها")
        : t('accounts.accounts_invoice_detail_card.s2', "اختر فاتورة من القيود لعرض تفاصيلها")}
      emptyHint={isPayment
        ? t('accounts.accounts_invoice_detail_card.s13', "سيظهر هنا رقم السند ورقم القيد والمبلغ ووسيلة الدفع.")
        : t('accounts.accounts_invoice_detail_card.s3', "سيظهر هنا محتوى الفاتورة بالأصناف والأسعار.")}
    >
      {documentType === 'sale' ? (
        <SharedSaleDetailCard sale={normalizedSale || undefined} />
      ) : documentType === 'purchase' ? (
        <SharedPurchaseDetailCard purchase={normalizedPurchase || undefined} />
      ) : documentType === 'supplier_payment' && normalizedSupplierPayment ? (
        <Card title={`${t('accounts.accounts_invoice_detail_card.s14', "تفاصيل الدفع")} ${normalizedSupplierPayment.docNo}`}>
          <div className="stats-grid compact-grid">
            <div className="stat-card"><span>{t('accounts.accounts_invoice_detail_card.s15', "المورد")}</span><strong>{normalizedSupplierPayment.supplierName}</strong></div>
            <div className="stat-card"><span>{t('accounts.accounts_invoice_detail_card.s16', "رقم السند")}</span><strong>{normalizedSupplierPayment.docNo}</strong></div>
            <div className="stat-card"><span>{t('accounts.accounts_invoice_detail_card.s17', "رقم القيد")}</span><strong>{normalizedSupplierPayment.journalNo || '—'}</strong></div>
            <div className="stat-card"><span>{t('accounts.accounts_invoice_detail_card.s18', "المبلغ")}</span><strong>{formatCurrency(normalizedSupplierPayment.amount)}</strong></div>
            <div className="stat-card"><span>{t('accounts.accounts_invoice_detail_card.s19', "التاريخ")}</span><strong>{formatDate(normalizedSupplierPayment.date)}</strong></div>
            <div className="stat-card"><span>{t('accounts.accounts_invoice_detail_card.s20', "وسيلة الدفع")}</span><strong>{paymentChannelLabel(normalizedSupplierPayment.paymentChannel, t)}</strong></div>
            {normalizedSupplierPayment.paymentChannel.toLowerCase() === 'instapay' && normalizedSupplierPayment.instapayAddress ? (
              <div className="stat-card"><span>{t('accounts.accounts_invoice_detail_card.s21', "عنوان إنستاباي (IPA)")}</span><strong>{normalizedSupplierPayment.instapayAddress}</strong></div>
            ) : null}
            <div className="stat-card"><span>{t('accounts.accounts_invoice_detail_card.s22', "الفرع/المخزن")}</span><strong>{`${normalizedSupplierPayment.branchName || '—'} / ${normalizedSupplierPayment.locationName || '—'}`}</strong></div>
          </div>
          {normalizedSupplierPayment.note ? (
            <div className="muted small" style={{ marginTop: 12 }}>{t('accounts.accounts_invoice_detail_card.s23', "الملاحظة:")} {normalizedSupplierPayment.note}</div>
          ) : null}
        </Card>
      ) : null}
      {selectedLabel ? <div className="muted small">{t('accounts.accounts_invoice_detail_card.s4', "المرجع المحدد:")} {selectedLabel}</div> : null}
    </QueryFeedback>
  );
}
