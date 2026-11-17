import { escapeHtml } from '@/lib/browser/escape';
import { getGlobalCurrencySymbol } from '@/lib/currencies';
import { buildCode128Svg } from '@/lib/barcode';
import { printSmallReceiptDocument } from '@/lib/small-receipt-printer';

export interface VanSettlementStockVarianceItem {
  productId: number;
  productName: string;
  systemQty: number;
  countedQty?: number;
  varianceQty: number;
  costPrice: number;
  varianceCost: number;
  status: string;
}

export interface VanSettlementReceiptData {
  tripId: number;
  receiptNo: string;
  repName: string;
  repPhone?: string;
  cashierName: string;
  vehiclePlate?: string;
  warehouseName?: string;
  settledAt?: string;
  salesAmount: number;
  cashSales: number;
  creditSales: number;
  collectionsTotal: number;
  returnsAmount: number;
  cashRefunds: number;
  creditReturns: number;
  tripExpenses: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  stockVarianceAmount: number;
  unloadedItemsCount: number;
  distanceKm?: number;
  notes?: string;
  stockVariances?: VanSettlementStockVarianceItem[];
  isOffline?: boolean;
}

export function buildVanSettlementThermalReceiptHtml(
  receipt: VanSettlementReceiptData,
  options: { storeName?: string; currency?: string } = {},
): string {
  const storeName = options.storeName?.trim() || 'إدارة مبيعات وتوزيع الفان';
  const currency = options.currency || getGlobalCurrencySymbol();

  const now = receipt.settledAt ? new Date(receipt.settledAt) : new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { year: 'numeric', month: '2-digit', day: '2-digit' });
  const timeStr = now.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });

  let barcodeSvg = '';
  if (receipt.receiptNo) {
    try {
      barcodeSvg = buildCode128Svg(receipt.receiptNo);
    } catch {}
  }

  const isShortage = receipt.variance < -0.05;
  const isSurplus = receipt.variance > 0.05;
  const isMatched = !isShortage && !isSurplus;

  const shortagesOnly = (receipt.stockVariances || []).filter((v) => v.status === 'shortage');

  return `
    <!-- HEADER -->
    <div style="text-align: center; border-bottom: 1.5px dashed #000; padding-bottom: 5px; margin-bottom: 6px;">
      <div style="font-size: 13.5px; font-weight: 800; margin-bottom: 2px; line-height: 1.2;">
        ${escapeHtml(storeName)}
      </div>
      <div style="font-size: 11.5px; font-weight: 800; color: #170e5e; padding: 2px 0;">
        سند توريد واستلام نقدية الخزينة وإخلاء طرف
      </div>
      <div style="font-size: 12.5px; font-weight: 800; font-family: monospace; letter-spacing: 0.5px; margin-top: 2px;">
        #${escapeHtml(receipt.receiptNo)}
      </div>
      <div style="font-size: 10px; color: #555; margin-top: 2px;">
        تصفية رحلة توزيع #${receipt.tripId}
      </div>
    </div>

    <!-- METADATA -->
    <div style="font-size: 10px; line-height: 1.45; border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 6px;">
      <div style="display: flex; justify-content: space-between;">
        <span><b>التاريخ:</b> ${dateStr}</span>
        <span><b>الوقت:</b> ${timeStr}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 2px;">
        <span><b>المندوب المسلِّم:</b> ${escapeHtml(receipt.repName || 'مندوب التوزيع')}</span>
        ${receipt.vehiclePlate ? `<span><b>السيارة:</b> ${escapeHtml(receipt.vehiclePlate)}</span>` : ''}
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 2px;">
        <span><b>أمين الخزينة المستلم:</b> ${escapeHtml(receipt.cashierName || 'أمين الخزينة')}</span>
        ${receipt.warehouseName ? `<span><b>المستودع:</b> ${escapeHtml(receipt.warehouseName)}</span>` : ''}
      </div>
      ${receipt.distanceKm != null ? `<div style="margin-top: 2px;"><b>مسافة خط السير:</b> ${Number(receipt.distanceKm).toFixed(1)} كم</div>` : ''}
    </div>

    <!-- FINANCIAL BREAKDOWN -->
    <div style="font-size: 10px; line-height: 1.5; border-bottom: 1px dashed #000; padding-bottom: 5px; margin-bottom: 6px;">
      <div style="display: flex; justify-content: space-between;">
        <span>إجمالي مبيعات اليوم:</span>
        <span style="font-weight: 700;">${Number(receipt.salesAmount).toFixed(2)} ${escapeHtml(currency)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding-right: 8px; color: #15803d;">
        <span>• مبيعات نقدية (كاش مباشر):</span>
        <span style="font-weight: 700;">+${Number(receipt.cashSales).toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; padding-right: 8px; color: #b45309;">
        <span>• مبيعات آجلة (ذمم مدينة):</span>
        <span style="font-weight: 700;">${Number(receipt.creditSales).toFixed(2)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; margin-top: 2px; color: #0284c7;">
        <span>تحصيلات نقدية (سندات قبض):</span>
        <span style="font-weight: 700;">+${Number(receipt.collectionsTotal).toFixed(2)} ${escapeHtml(currency)}</span>
      </div>
      ${receipt.cashRefunds > 0 ? `
        <div style="display: flex; justify-content: space-between; color: #dc2626;">
          <span>مرتجعات نقدية صُرفت كاش:</span>
          <span style="font-weight: 700;">-${Number(receipt.cashRefunds).toFixed(2)} ${escapeHtml(currency)}</span>
        </div>
      ` : ''}
      ${receipt.tripExpenses > 0 ? `
        <div style="display: flex; justify-content: space-between; color: #dc2626;">
          <span>مصروفات الرحلة المعتمدة:</span>
          <span style="font-weight: 700;">-${Number(receipt.tripExpenses).toFixed(2)} ${escapeHtml(currency)}</span>
        </div>
      ` : ''}
    </div>

    <!-- CASH HANDOVER CERTIFICATE BOX -->
    <div style="border: 1.5px solid #000; border-radius: 4px; padding: 6px; margin-bottom: 6px; background-color: #fafafa;">
      <div style="display: flex; justify-content: space-between; font-size: 10.5px; margin-bottom: 4px; color: #333;">
        <span>صافي النقدية المطلوب توريدها:</span>
        <span style="font-weight: 800;">${Number(receipt.expectedCash).toFixed(2)} ${escapeHtml(currency)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: 12px; border-top: 1px solid #ccc; padding-top: 4px; font-weight: 900; color: #000;">
        <span>المبلغ المستلم فعلياً بالخزينة:</span>
        <span style="font-size: 14px;">${Number(receipt.countedCash).toFixed(2)} ${escapeHtml(currency)}</span>
      </div>

      <!-- MATCH / VARIANCE BADGE -->
      <div style="margin-top: 5px; padding: 4px; border-radius: 3px; text-align: center; font-size: 10px; font-weight: 800; ${
        isMatched
          ? 'background: #dcfce7; color: #15803d; border: 1px solid #86efac;'
          : isShortage
          ? 'background: #fee2e2; color: #b91c1c; border: 1px solid #fca5a5;'
          : 'background: #e0f2fe; color: #0369a1; border: 1px solid #7dd3fc;'
      }">
        ${
          isMatched
            ? 'الكاش مطابق تماماً بنسبة 100% (إبراء ذمة المندوب كاملاً)'
            : isShortage
            ? `عجز نقدي مثبت: ${Math.abs(receipt.variance).toFixed(2)} ${escapeHtml(currency)} (مقيد على عهدة المندوب)`
            : `فائض نقدي مثبت: +${Number(receipt.variance).toFixed(2)} ${escapeHtml(currency)} (مورد لحساب المنشأة)`
        }
      </div>
    </div>

    <!-- STOCK VARIANCE SECTION IF DETECTED -->
    ${shortagesOnly.length > 0 ? `
      <div style="border: 1px dashed #dc2626; border-radius: 4px; padding: 5px; margin-bottom: 6px; font-size: 9.5px; background: #fff5f5;">
        <div style="font-weight: 800; color: #b91c1c; margin-bottom: 3px;">
          عجز بضاعة السيارة بالجرد الفعلي (${shortagesOnly.length} صنف):
        </div>
        ${shortagesOnly.map((s) => `
          <div style="display: flex; justify-content: space-between; color: #7f1d1d; margin-bottom: 2px;">
            <span>${escapeHtml(s.productName)} (عجز ${Math.abs(s.varianceQty)} ق):</span>
            <span style="font-weight: 700;">${Number(s.varianceCost).toFixed(2)} ${escapeHtml(currency)}</span>
          </div>
        `).join('')}
        <div style="border-top: 1px dashed #f87171; padding-top: 2px; margin-top: 3px; font-weight: 800; display: flex; justify-content: space-between; color: #991b1b;">
          <span>إجمالي تكلفة عجز المخزون:</span>
          <span>${Number(receipt.stockVarianceAmount).toFixed(2)} ${escapeHtml(currency)}</span>
        </div>
      </div>
    ` : ''}

    ${receipt.unloadedItemsCount > 0 ? `
      <div style="font-size: 9.5px; color: #1e3a8a; text-align: center; margin-bottom: 6px;">
        تم تفريغ البضاعة المتبقية (${receipt.unloadedItemsCount} صنف) للمستودع نظامياً.
      </div>
    ` : ''}

    <!-- SIGNATURES & DUAL CUSTODY -->
    <div style="border-top: 1px solid #000; padding-top: 8px; margin-top: 8px; font-size: 9.5px;">
      <div style="display: flex; justify-content: space-between; margin-bottom: 24px;">
        <div style="text-align: center; width: 45%;">
          <div><b>توقيع المندوب المسلِّم:</b></div>
          <div style="margin-top: 18px; border-bottom: 1px dotted #000;"></div>
          <div style="font-size: 8.5px; color: #555; margin-top: 2px;">${escapeHtml(receipt.repName)}</div>
        </div>
        <div style="text-align: center; width: 45%;">
          <div><b>توقيع أمين الخزينة المستلم:</b></div>
          <div style="margin-top: 18px; border-bottom: 1px dotted #000;"></div>
          <div style="font-size: 8.5px; color: #555; margin-top: 2px;">${escapeHtml(receipt.cashierName)}</div>
        </div>
      </div>
    </div>

    <!-- BARCODE & FOOTER -->
    ${barcodeSvg ? `
      <div style="text-align: center; margin-top: 6px;">
        <div style="display: flex; justify-content: center; height: 36px; max-width: 240px; margin: 0 auto; overflow: hidden;">
          ${barcodeSvg}
        </div>
        <div style="font-size: 8.5px; font-family: monospace; letter-spacing: 1px; margin-top: 2px;">
          ${escapeHtml(receipt.receiptNo)}
        </div>
      </div>
    ` : ''}

    <div style="text-align: center; font-size: 8px; color: #666; margin-top: 6px; border-top: 1px dashed #ccc; padding-top: 4px;">
      وثيقة إخلاء طرف رسمية صادرة آلياً من منظومة زد سيستمز للتوزيع الميداني
    </div>
  `;
}

export function printVanSettlementThermalReceipt(
  receipt: VanSettlementReceiptData,
  options: { storeName?: string; currency?: string; widthMm?: number } = {},
): void {
  const html = buildVanSettlementThermalReceiptHtml(receipt, options);
  printSmallReceiptDocument(html, {
    title: `سند توريد عهدة #${receipt.receiptNo}`,
    widthMm: options.widthMm || 80,
  });
}

export function formatVanSettlementShareMessage(receipt: VanSettlementReceiptData): string {
  const currency = getGlobalCurrencySymbol();
  const isShortage = receipt.variance < -0.05;
  const isSurplus = receipt.variance > 0.05;
  const isMatched = !isShortage && !isSurplus;

  const statusText = isMatched
    ? 'مطابق 100% بدون أي عجز'
    : isShortage
    ? `يوجد عجز نقدي بقيمة ${Math.abs(receipt.variance).toFixed(2)} ${currency}`
    : `يوجد فائض نقدي بقيمة +${Number(receipt.variance).toFixed(2)} ${currency}`;

  return `*سند توريد نقدية الخزينة وإخلاء طرف عهدة*
رقم السند: #${receipt.receiptNo}
رقم الرحلة: #${receipt.tripId}
المندوب: ${receipt.repName}
أمين الخزينة: ${receipt.cashierName}
-------------------------
مبيعات اليوم: ${Number(receipt.salesAmount).toFixed(2)} ${currency}
(كاش: ${Number(receipt.cashSales).toFixed(2)} | آجل: ${Number(receipt.creditSales).toFixed(2)})
التحصيلات: ${Number(receipt.collectionsTotal).toFixed(2)} ${currency}
مصروفات الرحلة: ${Number(receipt.tripExpenses).toFixed(2)} ${currency}
-------------------------
صافي المطلوب توريده: ${Number(receipt.expectedCash).toFixed(2)} ${currency}
المبلغ المورَّد فعلياً: ${Number(receipt.countedCash).toFixed(2)} ${currency}
حالة المطابقة: ${statusText}
${receipt.stockVarianceAmount > 0 ? `عجز بضاعة بالجرد: ${receipt.stockVarianceAmount.toFixed(2)} ${currency}` : ''}
تاريخ التوريد: ${receipt.settledAt ? new Date(receipt.settledAt).toLocaleString('ar-EG') : 'الآن'}
تم الاعتماد والإبراء بنجاح عبر Z-Systems ERP.`;
}
