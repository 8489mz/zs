import type { SettingsFormInput } from '@/features/settings/schemas/settings.schema';
import { escapeHtml } from '@/lib/browser/escape';
import { formatDateTime, type PosPrintPageSize } from '@/lib/pos-printing/shared';
import { buildReceiptDocument, getInvoiceStyles } from '@/lib/pos-printing/template';
import type { AppSettings } from '@/types/domain';

export interface PrintingTestReceiptContext {
  settings?: Partial<AppSettings> | null;
  formValues?: Partial<SettingsFormInput>;
  branchName?: string;
  locationName?: string;
  cashierName?: string;
}

export function buildLiveTestSettings(
  baseSettings?: Partial<AppSettings> | null,
  formValues?: Partial<SettingsFormInput>,
): Partial<AppSettings> {
  const merged = {
    ...(baseSettings || {}),
    ...(formValues || {}),
  } as Partial<AppSettings>;

  const storeName = String(merged.storeName || 'متجر Z-Systems').trim() || 'متجر Z-Systems';
  const brandName = String(merged.brandName || storeName).trim() || storeName;

  return {
    ...merged,
    storeName,
    brandName,
    paperSize: merged.paperSize === 'a4' ? 'a4' : 'receipt',
    receiptWidthMm: Number(merged.receiptWidthMm) === 58 ? 58 : 80,
    posReceiptTheme: merged.posReceiptTheme || 'classic',
    printNumberFormat: merged.printNumberFormat === 'english' ? 'english' : 'arabic',
  };
}

export function buildPrintingTestReceiptDocument(ctx: PrintingTestReceiptContext) {
  const liveSettings = buildLiveTestSettings(ctx.settings, ctx.formValues);
  const pageSize: PosPrintPageSize = liveSettings.paperSize === 'a4' ? 'a4' : 'receipt';
  const taxRate = liveSettings.taxRate !== undefined && liveSettings.taxRate !== null
    ? Math.max(0, Number(liveSettings.taxRate))
    : 14;
  const taxMode = liveSettings.taxMode === 'inclusive' ? 'inclusive' : 'exclusive';
  const subtotal = 250;
  const discount = 20;
  const netAfterDiscount = subtotal - discount;
  const taxAmount = taxRate > 0
    ? taxMode === 'inclusive'
      ? Number((netAfterDiscount - netAfterDiscount / (1 + taxRate / 100)).toFixed(2))
      : Number(((netAfterDiscount * taxRate) / 100).toFixed(2))
    : 0;
  const total = taxMode === 'inclusive'
    ? netAfterDiscount
    : Number((netAfterDiscount + taxAmount).toFixed(2));
  const cashPart = Number((total * 0.6).toFixed(2));
  const cardPart = Number((total - cashPart).toFixed(2));

  const document = buildReceiptDocument({
    pageSize,
    settings: liveSettings,
    documentLabel: pageSize === 'receipt' ? 'إيصال بيع (تجريبي)' : 'فاتورة بيع (تجريبي)',
    documentNumber: 'Z-260818-0001',
    dateText: formatDateTime(new Date(), liveSettings),
    customerName: 'عميل نقدي',
    paymentText: 'نقدي + فيزا',
    cashierName: String(ctx.cashierName || '').trim() || 'أحمد علي',
    branchName: String(ctx.branchName || '').trim() || 'الفرع الرئيسي',
    locationName: String(ctx.locationName || '').trim() || 'المخزن الأساسي',
    orderType: 'takeout',
    deliveryRepName: 'محمود المندوب',
    items: [
      {
        name: 'صنف تجريبي 1',
        nameEn: 'Sample Item 1',
        unitName: 'قطعة',
        qty: 2,
        price: 50,
        total: 100,
      },
      {
        name: 'صنف تجريبي 2',
        nameEn: 'Sample Item 2',
        unitName: 'قطعة',
        qty: 1,
        price: 150,
        total: 150,
      },
    ],
    subtotal,
    discount,
    taxAmount,
    total,
    paidAmount: total,
    payments: [
      { paymentChannel: 'cash', amount: cashPart },
      { paymentChannel: 'card', amount: cardPart },
    ],
    copyType: 'customer',
  });

  return {
    ...document,
    pageSize,
    liveSettings,
  };
}

export function buildPrintingPreviewIframeHtml(ctx: PrintingTestReceiptContext) {
  const { html, compact, pageSize, liveSettings } = buildPrintingTestReceiptDocument(ctx);
  const receiptWidthMm = liveSettings.receiptWidthMm === 58 ? 58 : 80;
  const isReceipt = pageSize === 'receipt';

  return `<!doctype html>
  <html lang="ar" dir="rtl">
    <head>
      <meta charset="utf-8" />
      <title>${escapeHtml(liveSettings.storeName || 'معاينة الفاتورة')}</title>
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; color: #000; }
        body { font-family: 'Cairo', 'Segoe UI', Tahoma, Arial, sans-serif; font-size: 11px; line-height: 1.3; }
        body.receipt-mode { width: 100%; max-width: ${receiptWidthMm}mm; margin: 0 auto; }
        body.report-mode .print-shell { padding: 10px; max-width: 100%; }
        ${getInvoiceStyles(compact)}
      </style>
    </head>
    <body class="${isReceipt ? 'receipt-mode' : 'report-mode'}">
      <div class="print-shell">
        <div class="print-content">${html}</div>
      </div>
    </body>
  </html>`;
}
