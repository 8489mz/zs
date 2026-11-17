import { escapeHtml } from '@/lib/browser/escape';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { buildCode128Svg } from '@/lib/barcode';
import { printSmallReceiptDocument } from '@/lib/small-receipt-printer';

export interface VanCollectionReceiptData {
  receiptNo: string;
  amount: number;
  previousBalance: number;
  newBalance: number;
  customerName: string;
  customerPhone?: string;
  customerCode?: string;
  customerAddress?: string;
  repName?: string;
  vehiclePlate?: string;
  warehouseName?: string;
  date?: string;
  notes?: string;
  isOffline?: boolean;
}

export function buildVanCollectionThermalReceiptHtml(
  receipt: VanCollectionReceiptData,
  options: { storeName?: string; currency?: string } = {}
): string {
  const storeName = options.storeName?.trim() || 'إدارة التوزيع والتحصيل الميداني';
  const currency = options.currency || getGlobalCurrencySymbol();

  const now = receipt.date ? new Date(receipt.date) : new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

  let barcodeSvg = '';
  if (receipt.receiptNo) {
    try {
      barcodeSvg = buildCode128Svg(receipt.receiptNo);
    } catch {}
  }

  return `
    <!-- HEADER -->
    <div style="text-align: center; border-bottom: 1.5px dashed #000; padding-bottom: 5px; margin-bottom: 6px;">
      <div style="font-size: 13.5px; font-weight: 800; margin-bottom: 2px; line-height: 1.2;">
        ${escapeHtml(storeName)}
      </div>
      <div style="font-size: 11.5px; font-weight: 800; color: #170e5e; padding: 2px 0;">
        سند قبض نقدي رسمي معتمد
      </div>
      <div style="font-size: 12.5px; font-weight: 800; font-family: monospace; letter-spacing: 0.5px; margin-top: 2px;">
        #${escapeHtml(receipt.receiptNo)}
      </div>
      ${receipt.isOffline ? `
        <div style="display: inline-block; font-size: 8.5px; font-weight: 800; color: #b45309; background: #fef3c7; border: 1px dashed #f59e0b; padding: 1px 6px; border-radius: 3px; margin-top: 3px;">
          إثبات محلي معتمد (أوفلاين)
        </div>
      ` : ''}
    </div>

    <!-- METADATA -->
    <div style="font-size: 10px; line-height: 1.45; border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 6px;">
      <div style="display: flex; justify-content: space-between;">
        <span><b>التاريخ:</b> ${dateStr}</span>
        <span><b>الوقت:</b> ${timeStr}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 2px;">
        <span><b>العميل:</b> ${escapeHtml(receipt.customerName)}</span>
        ${receipt.customerCode ? `<span><b>الكود:</b> ${escapeHtml(receipt.customerCode)}</span>` : ''}
      </div>
      ${receipt.customerPhone ? `<div style="margin-top: 2px;"><b>الهاتف:</b> ${escapeHtml(receipt.customerPhone)}</div>` : ''}
      ${receipt.customerAddress ? `<div style="margin-top: 2px;"><b>العنوان/الخط:</b> ${escapeHtml(receipt.customerAddress)}</div>` : ''}
      <div style="display: flex; justify-content: space-between; margin-top: 2px;">
        <span><b>المندوب المستلم:</b> ${escapeHtml(receipt.repName || 'مندوب التوزيع')}</span>
        ${receipt.vehiclePlate ? `<span><b>السيارة:</b> ${escapeHtml(receipt.vehiclePlate)}</span>` : ''}
      </div>
    </div>

    <!-- FINANCIAL SUMMARY CARD -->
    <div style="border: 1.5px solid #000; border-radius: 4px; padding: 6px; margin-bottom: 6px; background-color: #fafafa;">
      <div style="text-align: center; margin-bottom: 5px; border-bottom: 1px solid #ccc; padding-bottom: 4px;">
        <div style="font-size: 9.5px; font-weight: 700; color: #444;">المبلغ المقبوض نقداً</div>
        <div style="font-size: 16px; font-weight: 900; color: #000; line-height: 1.2;">
          ${Number(receipt.amount).toFixed(2)} ${escapeHtml(currency)}
        </div>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px; color: #333;">
        <span>الرصيد السابق للمحل:</span>
        <span style="font-weight: 700;">${Number(receipt.previousBalance).toFixed(2)} ${escapeHtml(currency)}</span>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 10px; margin-bottom: 3px; color: #15803d; font-weight: 700;">
        <span>المبلغ المسدد الآن:</span>
        <span>- ${Number(receipt.amount).toFixed(2)} ${escapeHtml(currency)}</span>
      </div>

      <div style="display: flex; justify-content: space-between; font-size: 11px; border-top: 1px dashed #666; padding-top: 3px; font-weight: 800; color: #000;">
        <span>الرصيد المتبقي بذمة العميل:</span>
        <span>${Number(receipt.newBalance).toFixed(2)} ${escapeHtml(currency)}</span>
      </div>
    </div>

    ${receipt.notes ? `
      <div style="font-size: 9.5px; color: #333; margin-bottom: 5px; padding: 3px 5px; background: #f3f4f6; border-radius: 3px;">
        <b>ملاحظات:</b> ${escapeHtml(receipt.notes)}
      </div>
    ` : ''}

    <!-- BARCODE -->
    ${barcodeSvg ? `
      <div style="text-align: center; margin: 4px 0 3px;">
        <div style="display: flex; justify-content: center; height: 36px; max-width: 240px; margin: 0 auto; overflow: hidden;">
          ${barcodeSvg}
        </div>
        <div style="font-size: 8.5px; font-family: monospace; letter-spacing: 1px; margin-top: 1px;">
          ${escapeHtml(receipt.receiptNo)}
        </div>
      </div>
    ` : ''}

    <!-- LEGAL ATTESTATION & FOOTER -->
    <div style="text-align: center; font-size: 8.5px; color: #444; border-top: 1px dashed #000; padding-top: 4px; margin-top: 4px; line-height: 1.35;">
      <div>هذا السند إلكتروني معتمد ومثبت بالحسابات المركزية، ويعتبر إبراءً لذمة العميل بالمبلغ الموضح أعلاه فقط.</div>
      <div style="font-size: 8px; color: #777; margin-top: 2px;">نظام التوزيع الميداني المحكم - Z-Systems ERP</div>
    </div>
  `;
}

export function formatVanCollectionShareMessage(
  receipt: VanCollectionReceiptData,
  currency = getGlobalCurrencySymbol()
): string {
  const now = receipt.date ? new Date(receipt.date) : new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

  const lines: string[] = [
    `*سند قبض نقدي رسمي معتمد*`,
    `رقم السند: #${receipt.receiptNo}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    `العميل: ${receipt.customerName}`,
    `المندوب المستلم: ${receipt.repName || 'مندوب التوزيع'}${receipt.vehiclePlate ? ` (${receipt.vehiclePlate})` : ''}`,
    `التاريخ والوقت: ${dateStr} - ${timeStr}`,
    ``,
    `*التفاصيل المالية للتحصيل:*`,
    `• الرصيد السابق للمحل: ${Number(receipt.previousBalance).toFixed(2)} ${currency}`,
    `• *المبلغ المقبوض نقداً:* ${Number(receipt.amount).toFixed(2)} ${currency}`,
    `• *الرصيد المتبقي بعد السداد:* ${Number(receipt.newBalance).toFixed(2)} ${currency}`,
  ];

  if (receipt.notes) {
    lines.push(`• ملاحظات: ${receipt.notes}`);
  }

  if (receipt.isOffline) {
    lines.push(``, `*(تم التوثيق محلياً بالسجل الميداني وسيتم ترحيله آلياً)*`);
  }

  lines.push(
    ``,
    `هذا السند إلكتروني معتمد ومثبت بالدفاتر المحاسبية الرسمية.`,
    `شكراً لتعاملكم معنا!`
  );

  return lines.join('\n');
}

export function printVanCollectionThermalReceipt(
  receipt: VanCollectionReceiptData,
  options: { storeName?: string; widthMm?: number; currency?: string } = {}
): void {
  const { widthMm = 80, storeName, currency } = options;
  const html = buildVanCollectionThermalReceiptHtml(receipt, { storeName, currency });

  printSmallReceiptDocument(html, {
    title: `سند قبض #${receipt.receiptNo}`,
    widthMm,
    fontSizePx: 10.5,
    autoClose: true,
  });
}
