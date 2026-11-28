import { escapeHtml } from '@/lib/browser';
import type { AppSettings, Sale } from '@/types/domain';
import { getPrintOption, isCompactReceipt, getReceiptTheme, formatDateTime, type PosPrintPageSize } from '@/lib/pos-printing/shared';
import { formatHijriDate } from '@/lib/hijri';
import { formatReceiptText } from './template-helpers';
import { renderStoreHeader, renderMetaPanel } from './template-header';
import { renderItemsTable } from './template-items';
import { renderPaymentBreakdown, renderEdcTerminalSlip, renderInvoiceBarcode, renderPaymentQrSection } from './template-payments';
import { renderFooter, renderTotals } from './template-totals';
import { renderLoyaltySummary } from './template-loyalty';

export function buildReceiptDocument(options: {
  pageSize?: PosPrintPageSize;
  settings?: Partial<AppSettings> | null;
  documentLabel: string;
  documentNumber?: string | number;
  onlineOrderNumber?: string;
  dateText?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  supplierName?: string;
  paymentText?: string;
  cashierName?: string;
  branchName?: string;
  locationName?: string;
  tableNumber?: string | null;
  pagerNumber?: string | null;
  orderType?: string | null;
  deliveryRepName?: string;
  referenceInvoice?: string;
  isReturn?: boolean;
  isPurchase?: boolean;
  note?: string;
  items: Array<{ name?: string; nameEn?: string; notes?: string; unitName?: string; qty?: number; price?: number; total?: number; modifiers?: any[] }>;
  subtotal: number;
  discount: number;
  deliveryFee?: number;
  serviceCharge?: number;
  tipAmount?: number;
  guestCount?: number;
  taxAmount: number;
  total: number;
  paidAmount?: number;
  tenderedAmount?: number;
  changeAmount?: number;
  payments?: Sale['payments'];
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyPointsBalance?: number;
  terminalId?: string | null;
  terminalAuthCode?: string | null;
  terminalRrn?: string | null;
  cardScheme?: string | null;
  cardLastFour?: string | null;
  copyType?: 'customer' | 'merchant' | 'dual';
  /* A reprint of an already-posted sale: every copy rendered
   * carries the duplicate banner, so a reprint can never pass
   * as the original. */
  isReprint?: boolean;
  reprintCount?: number;
}) {
  const compact = isCompactReceipt(options.pageSize, options.settings);
  const showCustomer = getPrintOption(options.settings, 'printShowCustomer', true);
  const showDeliveryCustomerDetails = getPrintOption(options.settings, 'printShowDeliveryCustomerDetails', true);
  const showCashier = getPrintOption(options.settings, 'printShowCashier', true);
  const showBranch = getPrintOption(options.settings, 'printShowBranch', true);
  const showLocation = getPrintOption(options.settings, 'printShowLocation', true);
  const showDocumentType = getPrintOption(options.settings, 'printShowDocumentType', true);
  const showDocumentNumber = getPrintOption(options.settings, 'printShowDocumentNumber', true);
  const showOrderType = getPrintOption(options.settings, 'printShowOrderType', true);

  const showDate = getPrintOption(options.settings, 'printShowDate', true);
  const showDeliveryRep = getPrintOption(options.settings, 'printDeliveryRepOnReceipt', true) || getPrintOption(options.settings, 'printShowDeliveryRep' as any, true);

  const rawOnlineOrder = options.onlineOrderNumber
    || (options as any).online_order_number
    || options.note?.match(/\b(ON-\d{6}-\d{4}|ORD-[A-Za-z0-9]+)\b/i)?.[1];
  const detectedOnlineOrderNumber = rawOnlineOrder ? String(rawOnlineOrder).trim() : null;

  const rawNote = String(options.note || '').trim();
  const cleanedNote = detectedOnlineOrderNumber
    ? rawNote
        .replace(new RegExp(`(?:طلب\\s*(?:متجر\\s*)?(?:إلكتروني|أونلاين)?\\s*#?\\s*)?${detectedOnlineOrderNumber}`, 'gi'), '')
        .replace(/^[-\s#,،]+|[-\s#,،]+$/g, '')
        .trim()
    : rawNote;

  const partyLabel = options.isPurchase ? 'المورد' : (options.isReturn ? 'العميل' : 'العميل');
  const rawPartyValue = String(options.isPurchase ? (options.supplierName || options.customerName || '') : (options.customerName || '')).trim();
  const isDefaultCashCustomer = !options.isPurchase && (!rawPartyValue || rawPartyValue === 'عميل نقدي' || rawPartyValue === 'نقدي' || rawPartyValue === '—');
  const shouldShowParty = showCustomer && !isDefaultCashCustomer;
  const partyValue = rawPartyValue || (options.isPurchase ? '—' : 'عميل نقدي');

  const cashierDisplayName = options.isPurchase
    ? (options.cashierName && options.cashierName !== '—' ? options.cashierName : '')
    : (showCashier && options.cashierName && options.cashierName !== '—' ? options.cashierName : '');

  const dateValue = showDate ? (options.dateText || formatDateTime(new Date())) : '';
  const showHijriDate = getPrintOption(options.settings, 'printShowHijriDate', false);
  const hijriDateValue = showHijriDate ? formatHijriDate(options.dateText || new Date()) : '';

  const metaRows = [
    ...(showDocumentType ? [{ label: 'نوع المستند', value: options.documentLabel || (options.isPurchase ? 'فاتورة شراء' : (options.isReturn ? 'إيصال مرتجع مبيعات' : 'فاتورة')) }] : []),
    ...(showDocumentNumber ? [{
      label: 'رقم الفاتورة',
      value: options.documentNumber ? String(options.documentNumber) : '—',
      isBadge: true,
    }] : []),
    ...(detectedOnlineOrderNumber ? [{
      label: 'طلب أونلاين',
      value: detectedOnlineOrderNumber,
      isBadge: true,
      customClass: 'meta-online-order-badge',
    }] : []),
    ...(options.referenceInvoice ? [{ label: 'مرجع الفاتورة الأصلية', value: options.referenceInvoice }] : []),
    ...(compact && dateValue && cashierDisplayName ? [{
      label: `التاريخ: ${formatReceiptText(dateValue, options.settings)}`,
      value: `<span dir="rtl" style="font-weight:600; color:#000; direction:rtl; unicode-bidi:isolate; text-align:left; display:inline-flex; align-items:baseline; gap:3px;"><span>${options.isPurchase ? 'المسؤول' : 'الكاشير'}:</span><bdi>${escapeHtml(formatReceiptText(cashierDisplayName, options.settings))}</bdi></span>`,
      isHtml: true,
      noColon: true,
    }] : [
      ...(dateValue ? [{ label: 'التاريخ', value: formatReceiptText(dateValue, options.settings) }] : []),
      ...(cashierDisplayName ? [{ label: options.isPurchase ? 'المسؤول' : 'الكاشير', value: formatReceiptText(cashierDisplayName, options.settings) }] : []),
    ]),
    ...(showHijriDate && hijriDateValue ? [{ label: 'التاريخ الهجري', value: hijriDateValue }] : []),
    ...(shouldShowParty ? [{ label: partyLabel, value: partyValue }] : []),
    ...(showDeliveryCustomerDetails && (options.orderType === 'delivery' || options.customerPhone) ? [
      ...(options.customerPhone ? [{ label: 'هاتف العميل', value: options.customerPhone }] : []),
      ...(options.customerAddress ? [{ label: 'عنوان العميل', value: options.customerAddress }] : []),
    ] : []),
    ...(showBranch ? [{ label: 'الفرع', value: options.branchName || 'المتجر الرئيسي' }] : []),
    ...(showLocation ? [{ label: 'المخزن', value: options.locationName || 'المخزن الأساسي' }] : []),
    ...(options.settings?.restaurantModuleEnabled && options.orderType === 'dine_in' && options.tableNumber ? [{ label: 'الطاولة', value: String(options.tableNumber) }] : []),
    ...(Number(options.guestCount || 0) > 0 ? [{ label: 'عدد الضيوف', value: `${formatReceiptText(options.guestCount, options.settings)} فرد` }] : []),
    ...(options.pagerNumber ? [{ label: 'رقم البيجر', value: String(options.pagerNumber), isBadge: true, customClass: 'meta-pager-badge' }] : []),
    ...(!options.isReturn && !options.isPurchase && showOrderType ? [{ label: 'نوع الطلب', value: options.orderType === 'dine_in' ? 'صالة' : options.orderType === 'delivery' ? 'دليفري' : (options.orderType === 'takeout' || options.orderType === 'takeaway' ? 'تيك أواي' : (options.orderType || 'تيك أواي')) }] : []),
    ...(!detectedOnlineOrderNumber && (options.note?.includes('متجر إلكتروني') || options.note?.includes('أونلاين')) ? [{ label: 'المصدر', value: 'طلب متجر أونلاين', isBadge: true }] : []),
    ...(showDeliveryRep && options.deliveryRepName ? [{ label: 'مندوب التوصيل', value: options.deliveryRepName }] : []),
    ...(cleanedNote ? [{ label: 'ملاحظة', value: cleanedNote }] : []),
  ];

  const theme = getReceiptTheme(options.pageSize, options.settings);
  const copyType = options.copyType || 'customer';

  function renderSingleReceipt(copy: 'customer' | 'merchant') {
    const isMerchant = copy === 'merchant';
    const copyHeaderBanner = isMerchant
      ? `<div class="receipt-copy-banner" style="text-align:center; font-weight:800; font-size:11px; padding:3px 6px; border:1px dashed #000; margin-bottom:5px; background:#fff; color:#000;">*** نسخة المحل والدرج ***</div>`
      : '';
    const reprintNum = Number(options.reprintCount || 0);
    const reprintSubline = reprintNum > 0
      ? `<div style="font-size:10px; font-weight:700; margin-top:2px;">نسخة رقم #${reprintNum} / COPY #${reprintNum}</div>`
      : '';
    const reprintBanner = options.isReprint
      ? `<div class="receipt-reprint-banner" style="text-align:center; font-weight:800; font-size:11.5px; padding:4px 6px; border:1.5px dashed #000; margin-bottom:5px; background:#fff; color:#000; letter-spacing:0.3px;">*** نسخة مكررة - REPRINT ***${reprintSubline}</div>`
      : '';

    return `
      <div class="receipt-theme-${theme} receipt-copy-${copy}">
        ${reprintBanner}
        ${copyHeaderBanner}
        ${renderStoreHeader(options.settings, compact)}
        ${renderMetaPanel(metaRows, compact, options.settings)}
        ${renderItemsTable(options.items, compact, options.settings)}
        ${renderTotals({
          subtotal: options.subtotal,
          discount: options.discount,
          deliveryFee: options.deliveryFee,
          serviceCharge: options.serviceCharge,
          tipAmount: options.tipAmount,
          taxAmount: options.taxAmount,
          total: options.total,
          paidAmount: options.paidAmount,
          tenderedAmount: options.tenderedAmount,
          changeAmount: options.changeAmount,
          items: options.items,
          settings: options.settings,
          compact,
          isReturn: options.isReturn,
          paymentText: options.paymentText || 'نقدي',
          orderType: options.orderType,
          payments: options.payments,
          isMerchantCopy: isMerchant,
        })}
        ${renderPaymentBreakdown(options.payments, options.settings, compact)}
        ${renderEdcTerminalSlip({
          terminalId: options.terminalId,
          terminalAuthCode: options.terminalAuthCode,
          terminalRrn: options.terminalRrn,
          cardScheme: options.cardScheme,
          cardLastFour: options.cardLastFour,
          compact,
        })}
        ${renderLoyaltySummary({
          loyaltyPointsEarned: options.loyaltyPointsEarned,
          loyaltyPointsRedeemed: options.loyaltyPointsRedeemed,
          loyaltyPointsBalance: options.loyaltyPointsBalance,
          settings: options.settings,
          compact,
        })}
        ${renderPaymentQrSection({
          settings: options.settings,
          total: options.total,
          documentNumber: options.documentNumber,
          paymentText: options.paymentText,
          payments: options.payments,
          compact,
          isReturn: options.isReturn,
          isPurchase: options.isPurchase,
        })}
        ${renderInvoiceBarcode(options.documentNumber, compact, options.settings)}
        ${renderFooter(options.settings, compact)}
      </div>
    `;
  }

  const cutSeparator = `<div class="receipt-cut-separator" style="page-break-after: always; break-after: page; padding-bottom: 6mm; margin-bottom: 6mm; border-bottom: 2px dashed #000; text-align: center; font-size: 9px; color: #444;">------------------------------------</div>`;

  const finalHtml = copyType === 'dual'
    ? `${renderSingleReceipt('customer')}${cutSeparator}${renderSingleReceipt('merchant')}`
    : renderSingleReceipt(copyType === 'merchant' ? 'merchant' : 'customer');

  return {
    html: finalHtml,
    compact,
  };
}
