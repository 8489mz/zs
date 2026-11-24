import { getGlobalCurrencySymbol, getGlobalSystemCurrency, getCurrencySymbol } from '../currencies';
import { escapeHtml } from '@/lib/browser';
import type { AppSettings, Sale } from '@/types/domain';
import { getPrintOption } from '@/lib/pos-printing/shared';
import { formatReceiptNumber, formatReceiptMoney, formatReceiptQuantity, formatReceiptText } from './template-helpers';

export function renderFooter(settings?: Partial<AppSettings> | null, compact = false) {
  if (!getPrintOption(settings, 'printShowFooter', true)) return '';
  const footerText = String(settings?.invoiceFooter || '').trim() || 'يرجى الاحتفاظ بالفاتورة، الاستبدال والاسترجاع حسب سياسة المتجر.';
  return `
    <footer class="print-footer${compact ? ' compact' : ''}">
      ${escapeHtml(footerText)}
    </footer>
  `;
}

export function renderTotals(options: {
  subtotal: number;
  discount: number;
  deliveryFee?: number;
  serviceCharge?: number;
  tipAmount?: number;
  taxAmount: number;
  total: number;
  paidAmount?: number;
  tenderedAmount?: number;
  changeAmount?: number;
  items: Array<{ qty?: number; price?: number; originalPrice?: number; offerDiscount?: number; lineDiscount?: number }>;
  settings?: Partial<AppSettings> | null;
  compact?: boolean;
  isReturn?: boolean;
  paymentText?: string;
  paymentType?: string;
  orderType?: string | null;
  payments?: Sale['payments'];
  isMerchantCopy?: boolean;
}) {
  /* INV-POS-LINE-DISCOUNT: options.subtotal is the NET subtotal
   * (gross minus per-line discounts) — the backend's stored subtotal
   * for posted sales, and the draft preview passes the derived
   * netSubTotal. The gross figure shown as "الإجمالي قبل الخصومات"
   * is rebuilt here by adding the line discounts back. */
  const totalLineDiscount = (options.items || []).reduce((sum, item) => sum + Number(item.lineDiscount || 0), 0);
  const hasLineDiscount = totalLineDiscount > 0.0001;
  const totalPieces = (options.items || []).reduce((sum, item) => sum + Number(item.qty || 0), 0);
  const paidAmount = Number(options.paidAmount || 0);
  const tenderedAmount = Number(options.tenderedAmount || 0);
  const changeAmount = Number(options.changeAmount || 0);
  const remaining = Math.max(0, Number(options.total || 0) - paidAmount);
  const showTax = getPrintOption(options.settings, 'printShowTax', true);
  const showPaymentMethod = getPrintOption(options.settings, 'printShowPaymentMethod', true);
  const showItemSummary = getPrintOption(options.settings, 'printShowItemSummary', true);
  const showItemCount = getPrintOption(options.settings, 'printShowItemCount', showItemSummary);
  const showPiecesCount = getPrintOption(options.settings, 'printShowPiecesCount', showItemSummary);
  const showPaymentDetails = getPrintOption(options.settings, 'printShowPaymentBreakdown', true);
  const showDiscountBreakdown = getPrintOption(options.settings, 'printShowDiscountBreakdown', true);
  const showSavingsBanner = getPrintOption(options.settings, 'printShowSavingsBanner', true);
  const hasDiscount = Math.abs(Number(options.discount || 0)) > 0.0001;
  const hasTax = Number(options.taxAmount || 0) > 0.0001;
  const hasDeliveryFee = Math.abs(Number(options.deliveryFee || 0)) > 0.0001;
  const currencySymbol = getCurrencySymbol(options.settings?.currency || getGlobalSystemCurrency());

  const totalOffersSavings = (options.items || []).reduce((sum, item) => {
    const unitDiscount = Number(item.offerDiscount || (item.originalPrice ? Math.max(0, item.originalPrice - Number(item.price || 0)) : 0));
    return sum + (unitDiscount * Number(item.qty || 0));
  }, 0);
  const hasOffersSavings = totalOffersSavings > 0.0001;
  const totalAllSavings = totalOffersSavings + totalLineDiscount + Number(options.discount || 0);

  let discountLabel = hasOffersSavings ? 'خصم إضافي' : 'الخصم';
  if (hasDiscount && Number(options.subtotal || 0) > 0) {
    const rawPercent = (options.discount / options.subtotal) * 100;
    const cleanPercent = Math.round(rawPercent);
    const expectedDiscount = (cleanPercent / 100) * options.subtotal;
    if (cleanPercent > 0 && Math.abs(expectedDiscount - options.discount) <= 0.02) {
      discountLabel = `${discountLabel} (${formatReceiptText(cleanPercent, options.settings)}%)`;
    }
  }

  const grossSubtotal = Number(options.subtotal || 0) + totalLineDiscount + totalOffersSavings;

  const rows = options.isReturn ? [
    ...(showTax && hasTax ? [
      { label: 'الإجمالي قبل الضريبة', value: `${formatReceiptMoney(Number(options.subtotal || 0), options.settings)} ${currencySymbol}` },
      { label: 'الضريبة', value: `${formatReceiptMoney(Number(options.taxAmount || 0), options.settings)} ${currencySymbol}` },
    ] : []),
    ...(showPaymentMethod && options.paymentText ? [{
      label: `طريقة الرد: ${options.paymentText}`,
      value: `<span style="font-size:0.88em; font-weight:700; margin-left: 3px; margin-inline-end:3px;">المسترد:</span><strong style="font-weight:800; font-size:1.05em;">${formatReceiptMoney(Number(options.total || paidAmount || 0), options.settings)} <span style="font-size:0.82em; font-weight:700;">${escapeHtml(currencySymbol)}</span></strong>`,
      strong: true,
      isHtml: true,
      noColon: true,
    }] : [{
      label: 'إجمالي المبلغ المسترد للعميل',
      value: `${formatReceiptMoney(Number(options.total || paidAmount || 0), options.settings)} ${currencySymbol}`,
      strong: true,
    }]),
    ...(showItemCount && showPiecesCount ? [
      { label: 'الأصناف والقطع', value: `${formatReceiptNumber(Number(options.items?.length || 0), options.settings)} صنف  -  ${formatReceiptQuantity(totalPieces, options.settings)} قطعة` },
    ] : showItemCount ? [
      { label: 'عدد الأصناف', value: formatReceiptNumber(Number(options.items?.length || 0), options.settings) },
    ] : showPiecesCount ? [
      { label: 'إجمالي القطع', value: formatReceiptQuantity(totalPieces, options.settings) },
    ] : []),
  ] : [
    ...(hasOffersSavings ? (showDiscountBreakdown ? [
      { label: 'الإجمالي قبل الخصومات', value: formatReceiptMoney(grossSubtotal, options.settings) },
      {
        label: 'إجمالي خصومات العروض',
        value: `<span style="display:inline-flex; align-items:center; direction:ltr;"><span>${formatReceiptMoney(totalOffersSavings, options.settings)}</span><span style="margin-left:2px;">-</span></span>`,
        isHtml: true,
      },
    ] : (showTax && hasTax ? [{ label: 'الإجمالي قبل الضريبة', value: formatReceiptMoney(Number(options.subtotal || 0), options.settings) }] : [])) : (showTax && hasTax ? [{ label: 'الإجمالي قبل الضريبة', value: formatReceiptMoney(Number(options.subtotal || 0), options.settings) }] : [])),
    /* INV-POS-LINE-DISCOUNT: the per-line discounts as their own row,
     * between the offers and the header discount — the item totals
     * are already net of them, so this row is what reconciles the
     * "before discounts" gross to the net subtotal. */
    ...(hasLineDiscount && showDiscountBreakdown ? [
      {
        label: 'خصم الأصناف',
        value: `<span style="display:inline-flex; align-items:center; direction:ltr;"><span>${formatReceiptMoney(totalLineDiscount, options.settings)}</span><span style="margin-left:2px;">-</span></span>`,
        isHtml: true,
      },
    ] : []),
    ...(hasDiscount && showDiscountBreakdown ? [
      {
        label: discountLabel,
        value: `<span style="display:inline-flex; align-items:center; direction:ltr;"><span>${formatReceiptMoney(Number(options.discount || 0), options.settings)}</span><span style="margin-left:2px;">-</span></span>`,
        isHtml: true,
      },
    ] : []),
    ...(hasDeliveryFee ? [
      { label: 'التوصيل', value: formatReceiptMoney(Number(options.deliveryFee || 0), options.settings) },
      ...(options.isMerchantCopy && options.orderType === 'delivery' && (options.payments?.some(p => p.paymentChannel !== 'cash') || (options.paymentText && !options.paymentText.includes('نقدي'))) ? [{
        label: 'تسوية المندوب',
        value: `<span style="font-size:0.86em; font-weight:700; color:#000;">تم صرف ${formatReceiptMoney(Number(options.deliveryFee || 0), options.settings)} ${getGlobalCurrencySymbol()} نقداً من الدرج</span>`,
        isHtml: true,
      }] : []),
    ] : []),
    ...(Number(options.serviceCharge || 0) > 0 ? [
      { label: 'خدمة الصالة', value: formatReceiptMoney(Number(options.serviceCharge || 0), options.settings) },
    ] : []),
    ...(Number(options.tipAmount || 0) > 0 ? [
      { label: 'إكرامية / بقشيش', value: `${formatReceiptMoney(Number(options.tipAmount || 0), options.settings)} ${currencySymbol}` },
    ] : []),
    ...(showTax && hasTax && (!hasOffersSavings || !showDiscountBreakdown) ? [{ label: 'الضريبة', value: `${formatReceiptMoney(Number(options.taxAmount || 0), options.settings)} ${currencySymbol}` }] : []),
    ...(showPaymentMethod && options.paymentText ? [{
      label: `طريقة الدفع: ${options.paymentText}`,
      value: `<span style="font-size:0.88em; font-weight:700; margin-left: 3px; margin-inline-end:3px;">الإجمالي:</span><strong style="font-weight:800; font-size:1.05em;">${formatReceiptMoney(Number(options.total || 0), options.settings)} <span style="font-size:0.82em; font-weight:700;">${escapeHtml(currencySymbol)}</span></strong>`,
      strong: true,
      isHtml: true,
      noColon: true,
    }] : [{
      label: 'الإجمالي النهائي',
      value: `${formatReceiptMoney(Number(options.total || 0), options.settings)} ${currencySymbol}`,
      strong: true,
    }]),
    ...(remaining > 0.009 && paidAmount > 0.009 ? [{
      label: `المتبقي تحصيله: ${formatReceiptMoney(remaining, options.settings)} ${currencySymbol}`,
      value: `<span style="font-size:0.88em; font-weight:700;">المدفوع: ${formatReceiptMoney(paidAmount, options.settings)} ${currencySymbol}</span>`,
      strong: true,
      isHtml: true,
      noColon: true,
    }] : (remaining > 0.009 && options.paymentType === 'credit' && paidAmount <= 0.009 ? [{
      label: `المتبقي على العميل: ${formatReceiptMoney(remaining, options.settings)} ${currencySymbol}`,
      value: `<span style="font-size:0.88em; font-weight:700;">(آجل)</span>`,
      strong: true,
      isHtml: true,
      noColon: true,
    }] : (showPaymentDetails && options.orderType !== 'delivery' && tenderedAmount > 0 && changeAmount > 0.009 ? [
      { label: 'المستلم نقديًا', value: `${formatReceiptMoney(tenderedAmount, options.settings)} ${currencySymbol}` },
      { label: 'الباقي', value: `${formatReceiptMoney(changeAmount, options.settings)} ${currencySymbol}` },
    ] : []))),
    ...(showItemCount && showPiecesCount ? [
      { label: 'الأصناف والقطع', value: `${formatReceiptNumber(Number(options.items?.length || 0), options.settings)} صنف  -  ${formatReceiptQuantity(totalPieces, options.settings)} قطعة` },
    ] : showItemCount ? [
      { label: 'عدد الأصناف', value: formatReceiptNumber(Number(options.items?.length || 0), options.settings) },
    ] : showPiecesCount ? [
      { label: 'إجمالي القطع', value: formatReceiptQuantity(totalPieces, options.settings) },
    ] : []),
  ];

  const savingsBannerHtml = (!options.isReturn && totalAllSavings > 0.0001 && showSavingsBanner)
    ? `
      <div class="receipt-savings-banner" style="margin-top: 6px; padding: 4px 6px; border: 1px dashed #000; border-radius: 4px; text-align: center; font-weight: 700; font-size: ${options.compact ? '9.5px' : '11px'}; color: #000; display: flex; align-items: center; justify-content: center; gap: 6px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; display: inline-block;">
          <circle cx="12" cy="12" r="9.5"/>
          <line x1="16" y1="8" x2="8" y2="16"/>
          <circle cx="9" cy="8.5" r="1.3" fill="#000"/>
          <circle cx="15" cy="15.5" r="1.3" fill="#000"/>
        </svg>
        <span>إجمالي ما وفّرته في هذه الفاتورة: ${formatReceiptMoney(totalAllSavings, options.settings)} ${getGlobalCurrencySymbol()}</span>
      </div>
    `
    : '';

  return `
    <section class="invoice-card invoice-totals-card${options.compact ? ' compact' : ''}">
      ${rows.map((row) => `
        <div class="meta-line${row.strong ? ' strong total-line' : ''}">
          <span class="meta-label">${escapeHtml(row.label)}${(row as any).noColon ? '' : ':'}</span>
          <span class="meta-value">${(row as any).isHtml ? row.value : escapeHtml(row.value)}</span>
        </div>
      `).join('')}
      ${savingsBannerHtml}
    </section>
  `;
}
