/**
 * Formats official Cashier Handover Clearance text summary for SMS / WhatsApp dispatch.
 */
export function formatVanSettlementSummaryText(params: {
  receiptNo: string;
  tripId: number;
  repName: string;
  cashierName: string;
  salesAmount: number;
  cashSales: number;
  creditSales: number;
  collectionsTotal: number;
  tripExpenses: number;
  expectedCash: number;
  countedCash: number;
  variance: number;
  stockVarianceCost?: number;
  instapayTotal?: number;
  currency?: string;
}): string {
  const currency = params.currency || 'ج.م';
  const isShortage = params.variance < -0.05;
  const isSurplus = params.variance > 0.05;
  const isMatched = !isShortage && !isSurplus;

  const statusText = isMatched
    ? 'مطابق 100% بدون أي عجز'
    : isShortage
    ? `يوجد عجز نقدي بقيمة ${Math.abs(params.variance).toFixed(2)} ${currency}`
    : `يوجد فائض نقدي بقيمة +${Number(params.variance).toFixed(2)} ${currency}`;

  return [
    '*سند توريد نقدية الخزينة وإخلاء طرف عهدة*',
    `رقم السند: #${params.receiptNo}`,
    `رقم الرحلة: #${params.tripId}`,
    `المندوب: ${params.repName}`,
    `أمين الخزينة: ${params.cashierName}`,
    '-------------------------',
    `مبيعات اليوم: ${Number(params.salesAmount).toFixed(2)} ${currency}`,
    `(كاش: ${Number(params.cashSales).toFixed(2)} | آجل: ${Number(params.creditSales).toFixed(2)})`,
    params.instapayTotal && params.instapayTotal > 0
      ? `تحويلات إنستاباي / المحافظ: ${Number(params.instapayTotal).toFixed(2)} ${currency} (تتطلب مطابقة بنكية)`
      : '',
    `التحصيلات: ${Number(params.collectionsTotal).toFixed(2)} ${currency}`,
    `مصروفات الرحلة: ${Number(params.tripExpenses).toFixed(2)} ${currency}`,
    '-------------------------',
    `صافي المطلوب توريده نقداً: ${Number(params.expectedCash).toFixed(2)} ${currency}`,
    `المبلغ المورَّد فعلياً: ${Number(params.countedCash).toFixed(2)} ${currency}`,
    `حالة المطابقة: ${statusText}`,
    params.stockVarianceCost && params.stockVarianceCost > 0
      ? `عجز بضاعة بالجرد: ${params.stockVarianceCost.toFixed(2)} ${currency}`
      : '',
    'تم الاعتماد والإبراء بنجاح عبر Z-Systems ERP.',
  ]
    .filter(Boolean)
    .join('\n');
}
