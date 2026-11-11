import { getGlobalCurrencySymbol, getCurrencyDecimals, getGlobalSystemCurrency, getCurrencySymbol } from '../currencies';
import { escapeHtml } from '@/lib/browser';
import type { AppSettings, Sale } from '@/types/domain';
import { getPrintOption, getReceiptNumberLocale, isCompactReceipt, getReceiptTheme, formatDateTime, type PosPrintPageSize } from '@/lib/pos-printing/shared';
import { currencyMoneyDigits, roundMoneyValue } from '@/shared/utils/money';
import { buildCode128Svg } from '@/lib/barcode';
import { formatHijriDate } from '@/lib/hijri';
import { buildInstaPayQrPayload, buildWalletQrPayload, buildPaymentLinkQrPayload } from '@/lib/payment-qr';
import { resolveItemEnglishName } from '@/features/pos/utils/kitchen-notes.util';

function resolveStoreIdentity(settings?: Partial<AppSettings> | null) {
  const brandName = String(settings?.storeName || 'متجر').trim() || 'متجر';
  const storeName = brandName;
  return { brandName, storeName };
}

function getAdaptiveBrandFontSize(brandName: string, compact = false) {
  const length = Array.from(String(brandName || '').trim()).length;
  if (compact) {
    if (length > 30) return '13px';
    if (length > 22) return '15.5px';
    if (length > 15) return '18.5px';
    if (length > 10) return '21.5px';
    return '24px';
  }
  if (length > 30) return '16px';
  if (length > 22) return '20px';
  if (length > 15) return '24px';
  if (length > 10) return '28px';
  return '32px';
}

function getNumberLocale(settings?: Partial<AppSettings> | null) {
  return getReceiptNumberLocale(settings);
}

function formatReceiptNumber(value: number, settings?: Partial<AppSettings> | null, fractionDigits = 0) {
  return new Intl.NumberFormat(getNumberLocale(settings), {
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(value || 0));
}

function formatReceiptMoney(value: number, settings?: Partial<AppSettings> | null) {
  const decimals = getCurrencyDecimals(settings?.currency);
  return formatReceiptNumber(Number(value || 0), settings, decimals);
}

export function formatReceiptQuantity(value: number, settings?: Partial<AppSettings> | null) {
  return new Intl.NumberFormat(getNumberLocale(settings), {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  }).format(Number(value || 0));
}

function formatReceiptText(value: string | number | null | undefined, settings?: Partial<AppSettings> | null) {
  const text = String(value ?? '—');
  const isEnglishFormat = settings?.printNumberFormat === 'english' ||
    (settings?.printNumberFormat !== 'arabic' && (settings?.currency === 'KWD' || settings?.country === 'KW' || getGlobalSystemCurrency() === 'KWD'));
  if (!isEnglishFormat) return text;
  return text
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[۰-۹]/g, (digit) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(digit)));
}

function renderStoreHeader(settings?: Partial<AppSettings> | null, compact = false) {
  const { brandName } = resolveStoreIdentity(settings);
  const showLogo = getPrintOption(settings, 'printShowLogo', true);
  const showPhone = getPrintOption(settings, 'printShowPhone', true);
  const showAddress = getPrintOption(settings, 'printShowAddress', true);
  const showTaxNumber = settings?.currency === 'KWD' ? false : getPrintOption(settings, 'printShowTaxNumber', false);
  const phone = showPhone ? formatReceiptText(String(settings?.phone || '').trim(), settings) : '';
  const address = showAddress ? String(settings?.address || '').trim() : '';
  const taxNumber = showTaxNumber ? formatReceiptText(String(settings?.taxNumber || '').trim(), settings) : '';
  const logoData = showLogo ? String(settings?.logoData || '').trim() : '';
  const details = [
    phone ? `<div class="store-detail-line store-phone-line">${escapeHtml(phone)}</div>` : '',
    address ? `<div class="store-detail-line store-address-line">${escapeHtml(address)}</div>` : '',
    taxNumber ? `<div class="store-detail-line store-tax-line">الرقم الضريبي: ${escapeHtml(taxNumber)}</div>` : '',
  ].filter(Boolean).join('');

  return `
    <section class="invoice-card invoice-store-card${compact ? ' compact' : ''}">
      <div class="invoice-brand-row"${!logoData ? ' style="justify-content:center;"' : ''}>
        ${logoData ? `<div class="invoice-logo-wrapper"><img class="invoice-logo" src="${escapeHtml(logoData)}" alt="شعار المتجر" /></div>` : ''}
        <div class="invoice-brand-copy">
          <h2 title="${escapeHtml(brandName)}" style="font-size:${getAdaptiveBrandFontSize(brandName, compact)}">${escapeHtml(brandName)}</h2>
          ${details ? `<div class="store-inline-details">${details}</div>` : ''}
        </div>
      </div>
    </section>
  `;
}

function renderMetaPanel(rows: Array<{ label: string; value?: string | number | null; isBadge?: boolean; isHtml?: boolean; noColon?: boolean; customClass?: string }>, compact = false, settings?: Partial<AppSettings> | null) {
  const visibleRows = rows.filter((row) => String(row.value ?? '').trim());
  if (!visibleRows.length) return '';
  return `
    <section class="invoice-card invoice-meta-panel${compact ? ' compact' : ''}">
      ${visibleRows.map((row) => `
        <div class="meta-line${row.isBadge ? ' meta-document-badge' : ''}${row.customClass ? ` ${row.customClass}` : ''}">
          <span class="meta-label">${escapeHtml(row.label)}${row.noColon ? '' : ':'}</span>
          <span class="meta-value">${row.isHtml ? row.value : escapeHtml(formatReceiptText(row.value ?? '—', settings))}</span>
        </div>
      `).join('')}
    </section>
  `;
}

function renderItemsTable(items: Array<{ name?: string; unitName?: string; qty?: number; price?: number; originalPrice?: number; offerDiscount?: number; offerName?: string; total?: number; modifiers?: any[]; serials?: string[] }>, compact = false, settings?: Partial<AppSettings> | null) {
  const body = (items || []).map((item, index) => {
    const modifiersHtml = item.modifiers?.length 
      ? `<div class="item-modifiers" style="font-size: 0.85em; color: #000; margin-top: 2px;">
          ${item.modifiers.map((mod: any) => {
            const modPrice = Number(mod.price || 0);
            const modQty = Number(mod.qty || 1);
            const modTotal = modPrice * modQty;
            return `<div style="padding: 2px 0; color: #000; font-size: 0.9em; margin-right: 8px;">
              <strong style="color: #000;">[إضافة]</strong> ${escapeHtml(mod.name)}
              ${modQty > 1 ? ` <span style="color:#000; font-size: 0.9em;">(×${modQty})</span>` : ''}
              ${modTotal > 0 ? ` <span style="font-weight:600; color:#000;">(+${formatReceiptMoney(modTotal, settings)})</span>` : ''}
            </div>`;
          }).join('')}
         </div>`
      : '';
    const serialsHtml = item.serials?.length
      ? `<div class="item-serials" style="font-size: 0.8em; color: #000; margin-top: 2px; font-family: monospace;">
          <strong>IMEI:</strong> ${item.serials.map(escapeHtml).join(', ')}
         </div>`
      : '';
    const showItemOffers = getPrintOption(settings, 'printShowItemOffers', true);
    const origPrice = Number(item.originalPrice || (Number(item.price || 0) + Number(item.offerDiscount || 0)));
    const savedAmount = Number(item.offerDiscount || (Number(item.originalPrice || 0) - Number(item.price || 0)));
    const hasOffer = origPrice > Number(item.price || 0) && savedAmount > 0;
    const isComboOffer = Boolean(item.offerName && item.offerName.startsWith('عرض مجمع'));
    const comboComponentsText = isComboOffer && item.offerName?.includes('(') ? item.offerName.replace(/^عرض مجمع\s*/, '').trim() : '';
    const inlineOfferBadge = (hasOffer && showItemOffers && !isComboOffer)
      ? `<div class="item-offer-line" style="font-size: 0.82em; line-height: 1.2; color: #000; margin-top: 1px;"><strong style="font-weight: 700;">عرض: ${formatReceiptMoney(Number(item.price || 0), settings)}</strong> <span style="font-weight: 500; color: #333; font-size: 0.95em;">بدلاً من ${formatReceiptMoney(origPrice, settings)}</span></div>`
      : '';
    const componentsHtml = (hasOffer && showItemOffers && comboComponentsText)
      ? `<div class="item-offer-line" style="font-size: 0.74em; color: #444; margin-top: 1px; font-weight: 500; line-height: 1.15; letter-spacing: -0.25px;">${escapeHtml(comboComponentsText)}</div>`
      : '';
    const priceCellContent = (hasOffer && showItemOffers)
      ? `<div style="line-height: 1.15; text-align: center;">
          <del style="display: block; text-decoration: line-through; text-decoration-thickness: 1px; color: #444; font-size: 0.82em; font-weight: 400; opacity: 0.85;">${formatReceiptMoney(origPrice, settings)}</del>
          <div style="font-weight: 600; color: #000;">${formatReceiptMoney(Number(item.price || 0), settings)}</div>
         </div>`
      : formatReceiptMoney(Number(item.price || 0), settings);
    const englishName = resolveItemEnglishName(item);
    const showBilingualName = getPrintOption(settings, 'printBilingualItemNames', false) || Boolean(settings?.currency === 'KWD' && englishName);
    const englishNameHtml = (englishName && showBilingualName && englishName !== item.name)
      ? `<div class="item-name-en" style="font-size: 0.85em; font-weight: 500; color: #444; direction: ltr; text-align: left; font-family: system-ui, sans-serif;">${escapeHtml(englishName)}</div>`
      : '';
    return `
    <tr>
      ${compact ? '' : `<td class="index-cell">${formatReceiptNumber(index + 1, settings)}</td>`}
      <td class="name-cell">${escapeHtml(item.name || '—')}${englishNameHtml}${inlineOfferBadge}${componentsHtml}${modifiersHtml}${serialsHtml}</td>
      ${compact ? '' : `<td class="unit-cell">${escapeHtml(item.unitName || 'قطعة')}</td>`}
      <td class="qty-cell">${formatReceiptQuantity(Number(item.qty || 0), settings)}</td>
      <td class="price-cell">${priceCellContent}</td>
      <td class="total-cell">${formatReceiptMoney(Number(item.total || 0), settings)}</td>
    </tr>
    `;
  }).join('');

  return `
    <section class="invoice-card invoice-items-card${compact ? ' compact' : ''}">
      <table class="invoice-items-table${compact ? ' compact' : ''}">
        <thead>
          <tr>
            ${compact ? '' : '<th class="index-th">#</th>'}
            <th class="name-th">الصنف / Item</th>
            ${compact ? '' : '<th class="unit-th">الوحدة / Unit</th>'}
            <th class="qty-th">الكمية / Qty</th>
            <th class="price-th">السعر / Price</th>
            <th class="total-th">الإجمالي / Total</th>
          </tr>
        </thead>
        <tbody>${body || `<tr><td colspan="${compact ? 4 : 6}">لا توجد أصناف</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function renderPaymentBreakdown(payments?: Sale['payments'], settings?: Partial<AppSettings> | null, compact = false) {
  if (!payments || payments.length <= 1 || !getPrintOption(settings, 'printShowPaymentBreakdown', true)) return '';
  const isKwd = settings?.currency === 'KWD' || getGlobalSystemCurrency() === 'KWD';
  const currencySymbol = getCurrencySymbol(settings?.currency || getGlobalSystemCurrency());
  return `
    <section class="invoice-card invoice-payment-card${compact ? ' compact' : ''}">
      <div class="section-title">تفصيل المدفوعات</div>
      <div class="payment-grid">
        ${payments.map((payment) => `
          <div class="payment-chip">
            <span>${escapeHtml(payment.paymentChannel === 'cash' ? 'نقدي' : payment.paymentChannel === 'card' ? (isKwd ? 'بطاقة / كي نت K-NET' : 'بطاقة / فيزا') : payment.paymentChannel === 'wallet' ? (isKwd ? 'محفظة / رابط دفع' : 'محفظة إلكترونية') : payment.paymentChannel === 'instapay' ? (isKwd ? 'كي نت / دفع إلكتروني' : 'InstaPay') : payment.paymentChannel === 'credit' ? 'آجل' : 'مختلط')}</span>
            <strong>${formatReceiptMoney(Number(payment.amount || 0), settings)} ${escapeHtml(currencySymbol)}</strong>
          </div>
        `).join('')}
      </div>
    </section>
  `;
}

function renderEdcTerminalSlip(options: {
  terminalId?: string | null;
  terminalAuthCode?: string | null;
  terminalRrn?: string | null;
  cardScheme?: string | null;
  cardLastFour?: string | null;
  compact?: boolean;
}) {
  if (!options.terminalAuthCode) return '';
  const schemeName = options.cardScheme === 'knet'
    ? 'شبكة كي نت (KNET)'
    : options.cardScheme === 'mada'
    ? 'شبكة مدى (Mada Debit)'
    : options.cardScheme === 'Meeza' || options.cardScheme === 'meeza'
    ? 'شبكة ميزة (Meeza)'
    : options.cardScheme === 'Visa' || options.cardScheme === 'visa'
    ? 'فيزا (Visa)'
    : options.cardScheme === 'Mastercard' || options.cardScheme === 'mastercard'
    ? 'ماستركارد (Mastercard)'
    : 'بطاقة مصرفية إلكترونية (POS)';

  return `
    <section class="invoice-card edc-terminal-card${options.compact ? ' compact' : ''}" style="margin: 4px 0; padding: 5px 6px; border: 1px dashed #000; border-radius: 4px; font-size: ${options.compact ? '8.5px' : '9.5px'};">
      <div style="font-weight: 800; text-align: center; border-bottom: 1px dashed #000; padding-bottom: 2px; margin-bottom: 3px; font-size: ${options.compact ? '9px' : '10px'};">
        *** إيصال الدفع الإلكتروني (EDC POS Slip) ***
      </div>
      <div style="display: flex; justify-content: space-between; padding: 1px 0;">
        <span style="font-weight: 600;">الشبكة / البطاقة:</span>
        <strong style="font-weight: 800;">${escapeHtml(schemeName)}</strong>
      </div>
      <div style="display: flex; justify-content: space-between; padding: 1px 0;">
        <span style="font-weight: 600;">رقم التفويض (AUTH):</span>
        <strong style="font-family: monospace; font-weight: 800;">${escapeHtml(options.terminalAuthCode)}</strong>
      </div>
      ${options.terminalRrn ? `
        <div style="display: flex; justify-content: space-between; padding: 1px 0;">
          <span style="font-weight: 600;">رقم المرجع (RRN):</span>
          <span style="font-family: monospace;">${escapeHtml(options.terminalRrn)}</span>
        </div>
      ` : ''}
      ${options.cardLastFour ? `
        <div style="display: flex; justify-content: space-between; padding: 1px 0;">
          <span style="font-weight: 600;">رقم البطاقة (PAN):</span>
          <span style="font-family: monospace;">**** **** **** ${escapeHtml(options.cardLastFour)}</span>
        </div>
      ` : ''}
      ${options.terminalId ? `
        <div style="display: flex; justify-content: space-between; padding: 1px 0;">
          <span style="font-weight: 600;">الطرفية (TID):</span>
          <span style="font-family: monospace;">${escapeHtml(options.terminalId)}</span>
        </div>
      ` : ''}
      <div style="display: flex; justify-content: space-between; padding: 1px 0; border-top: 1px dotted #000; margin-top: 2px; padding-top: 2px;">
        <span style="font-weight: 600;">حالة المعاملة:</span>
        <strong style="font-weight: 800;">مقبولة بنجاح / APPROVED (00)</strong>
      </div>
    </section>
  `;
}

function renderInvoiceBarcode(documentNumber?: string | number | null, compact = false, settings?: Partial<AppSettings> | null) {
  if (!getPrintOption(settings, 'printShowInvoiceBarcode', true)) return '';

  const docNo = String(documentNumber || '').trim();
  if (!docNo || docNo === '—' || docNo === 'مسودة') return '';

  // Extract the numeric sequence (e.g. Z-260827-0002 -> 2608270002) for Code 128C double-width bars and wide spacing
  const numbersMatch = docNo.match(/(\d{6})[^\d]*(\d{3,})/);
  const barcodePayload = numbersMatch ? `${numbersMatch[1]}${numbersMatch[2]}` : docNo;

  const barcodeSvg = buildCode128Svg(barcodePayload);
  if (!barcodeSvg) return '';

  return `
    <section class="invoice-card invoice-barcode-card${compact ? ' compact' : ''}">
      <div class="invoice-barcode-svg-wrap">
        ${barcodeSvg}
      </div>
    </section>
  `;
}

function renderPaymentQrSection(options: {
  settings?: Partial<AppSettings> | null;
  total: number;
  documentNumber?: string | number;
  paymentText?: string;
  payments?: Sale['payments'];
  compact?: boolean;
  isReturn?: boolean;
  isPurchase?: boolean;
}) {
  if (options.isReturn || options.isPurchase) return '';
  if (!getPrintOption(options.settings, 'printPaymentQrOnReceipt', false)) return '';

  const total = Number(options.total || 0);
  if (total <= 0) return '';

  const docNo = String(options.documentNumber || '').trim();
  const payments = options.payments || [];
  const isInstapay = payments.some((p) => p.paymentChannel === 'instapay') || options.paymentText?.includes('انستا') || options.paymentText?.includes('InstaPay');
  const isWallet = payments.some((p) => p.paymentChannel === 'wallet') || options.paymentText?.includes('محفظة') || options.paymentText?.includes('فودافون');

  const qrSize = options.compact ? 100 : 120;
  let qrSvg = '';
  let title = '';
  let detailLabel = '';
  let detailValue = '';

  if (isInstapay || (!isWallet && options.settings?.instapayAddress)) {
    const address = String(options.settings?.instapayAddress || '01018017523').trim();
    const result = buildInstaPayQrPayload({
      address,
      amount: total,
      invoiceRef: docNo || undefined,
      size: qrSize,
      color: '#000000',
      bgColor: '#ffffff',
    });
    qrSvg = result.qrSvg;
    title = 'امسح للدفع عبر انستاباي (InstaPay)';
    detailLabel = 'حساب / هاتف التحويل';
    detailValue = address;
  } else if (isWallet || options.settings?.walletNumber) {
    const walletNo = String(options.settings?.walletNumber || '01018017523').trim();
    const provider = String(options.settings?.walletProviderName || 'فودافون كاش').trim();
    const result = buildWalletQrPayload({
      walletNumber: walletNo,
      providerName: provider,
      amount: total,
      invoiceRef: docNo || undefined,
      size: qrSize,
      color: '#000000',
      bgColor: '#ffffff',
    });
    qrSvg = result.qrSvg;
    title = `امسح للتحويل عبر محفظة (${provider})`;
    detailLabel = 'رقم المحفظة';
    detailValue = walletNo;
  } else if (options.settings?.paymentLinkBaseUrl) {
    const result = buildPaymentLinkQrPayload({
      baseUrl: options.settings.paymentLinkBaseUrl,
      amount: total,
      invoiceRef: docNo || undefined,
      size: qrSize,
      color: '#000000',
      bgColor: '#ffffff',
    });
    qrSvg = result.qrSvg;
    title = 'امسح للدفع بالبطاقة / Apple Pay';
    detailLabel = 'رابط الدفع المباشر';
    detailValue = docNo ? `فاتورة #${docNo}` : 'دفع إلكتروني';
  }

  if (!qrSvg) return '';

  const currencySymbol = getCurrencySymbol(options.settings?.currency || getGlobalSystemCurrency());

  return `
    <section class="invoice-card invoice-payment-qr-card${options.compact ? ' compact' : ''}" style="margin: 4px 0; padding: 5px 6px; border: 1px dashed #000; border-radius: 4px; text-align: center;">
      <div style="font-weight: 800; font-size: ${options.compact ? '9px' : '10.5px'}; color: #000; margin-bottom: 3px; text-align: center;">
        *** ${escapeHtml(title)} ***
      </div>
      <div class="payment-qr-svg-wrap" style="display: flex; justify-content: center; align-items: center; margin: 3px auto; width: ${qrSize}px; height: ${qrSize}px;">
        ${qrSvg}
      </div>
      <div style="display: flex; justify-content: space-between; font-size: ${options.compact ? '8.5px' : '9.5px'}; color: #000; font-weight: 700; margin-top: 2px; border-top: 1px dotted #000; padding-top: 2px;">
        <span>${escapeHtml(detailLabel)}:</span>
        <span style="font-family: monospace; direction: ltr; unicode-bidi: isolate;">${escapeHtml(detailValue)}</span>
      </div>
      <div style="display: flex; justify-content: space-between; font-size: ${options.compact ? '8.5px' : '9.5px'}; color: #000; font-weight: 800; margin-top: 1px;">
        <span>المبلغ المطلوب:</span>
        <span>${formatReceiptMoney(total, options.settings)} ${escapeHtml(currencySymbol)}</span>
      </div>
    </section>
  `;
}

function renderFooter(settings?: Partial<AppSettings> | null, compact = false) {
  if (!getPrintOption(settings, 'printShowFooter', true)) return '';
  const footerText = String(settings?.invoiceFooter || '').trim() || 'يرجى الاحتفاظ بالفاتورة، الاستبدال والاسترجاع حسب سياسة المتجر.';
  return `
    <footer class="print-footer${compact ? ' compact' : ''}">
      ${escapeHtml(footerText)}
    </footer>
  `;
}

function renderTotals(options: {
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
  items: Array<{ qty?: number; price?: number; originalPrice?: number; offerDiscount?: number }>;
  settings?: Partial<AppSettings> | null;
  compact?: boolean;
  isReturn?: boolean;
  paymentText?: string;
  paymentType?: string;
  orderType?: string | null;
  payments?: Sale['payments'];
  isMerchantCopy?: boolean;
}) {
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
  const totalAllSavings = totalOffersSavings + Number(options.discount || 0);
  
  let discountLabel = hasOffersSavings ? 'خصم إضافي' : 'الخصم';
  if (hasDiscount && Number(options.subtotal || 0) > 0) {
    const rawPercent = (options.discount / options.subtotal) * 100;
    const cleanPercent = Math.round(rawPercent);
    const expectedDiscount = (cleanPercent / 100) * options.subtotal;
    if (cleanPercent > 0 && Math.abs(expectedDiscount - options.discount) <= 0.02) {
      discountLabel = `${discountLabel} (${formatReceiptText(cleanPercent, options.settings)}%)`;
    }
  }

  const grossSubtotal = Number(options.subtotal || 0) + totalOffersSavings;

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

export function getInvoiceStyles(compact = false) {
  return `
    .print-shell { padding: ${compact ? '1mm 1.2mm 2.5mm' : '2mm 1.8mm 3mm'}; font-family: 'Cairo', 'Segoe UI', Tahoma, -apple-system, sans-serif; }
    .print-header { display: none !important; }
    .print-title { font-size: ${compact ? '14px' : '19px'}; }
    .print-subtitle { margin-top: 1px; font-size: ${compact ? '9px' : '11px'}; min-height: 0; }
    .print-meta-chip { padding: ${compact ? '4px 8px' : '6px 10px'}; font-size: ${compact ? '9.5px' : '11px'}; }
    .print-content { gap: ${compact ? '0px' : '2px'}; }
    .invoice-card {
      background: #fff;
      padding: ${compact ? '2px 2px' : '3px 3px'};
      break-inside: avoid;
      overflow: hidden;
    }
    .invoice-card.compact { padding: 2px 2px; }
    .invoice-brand-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: ${compact ? '8px' : '12px'};
      min-height: ${compact ? '44px' : '56px'};
      width: 100%;
    }
    .invoice-logo-wrapper {
      position: relative;
      width: ${compact ? '68px' : '96px'};
      height: ${compact ? '44px' : '56px'};
      min-height: ${compact ? '44px' : '56px'};
      max-width: ${compact ? '68px' : '96px'};
      max-height: ${compact ? '44px' : '56px'};
      flex-shrink: 0;
    }
    .invoice-logo,
    .invoice-logo-fallback {
      position: absolute;
      top: 0; right: 0; bottom: 0; left: 0;
      inset: 0;
      width: 100%;
      height: 100%;
      max-width: 100%;
      max-height: 100%;
      border-radius: 0;
      object-fit: contain;
      object-position: center;
      background: transparent;
      display: block; display: grid;
      place-items: center;
      font-weight: 800;
      color: #000;
      overflow: hidden;
    }
    img.invoice-logo {
      /* IE11 has no object-fit: the shared .invoice-logo rule sizes the img
         100%x100%, which stretches it. Auto sizing keeps the aspect ratio
         (capped by the max sizes below); margin:auto centers it inside the
         absolutely-positioned box (top/right/bottom/left: 0). */
      width: auto;
      height: auto;
      max-width: ${compact ? '68px' : '96px'} !important;
      max-height: ${compact ? '44px' : '56px'} !important;
      margin: auto;
    }
    .invoice-brand-copy {
      min-width: 0;
      flex: 1 1 auto;
      display: flex;
      flex-direction: column;
      justify-content: center;
      text-align: center;
      width: 100%;
    }
    .invoice-brand-copy h2 {
      margin: 0;
      line-height: 1.12;
      color: #000;
      font-weight: 900;
      letter-spacing: -0.3px;
      overflow-wrap: normal;
      word-break: keep-all;
      text-align: center;
      width: 100%;
      font-family: 'Cairo', 'Segoe UI', Tahoma, sans-serif;
    }
    .store-inline-details {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 1.5px;
      font-size: ${compact ? '8.5px' : '9.5px'};
      color: #000;
      margin-top: 2px;
      font-weight: 600;
      line-height: 1.25;
      text-align: center;
      width: 100%;
    }
    .store-detail-line {
      display: block;
      width: 100%;
      text-align: center;
    }
    .store-phone-line {
      white-space: nowrap;
      font-weight: 700;
    }
    .store-address-line {
      word-break: normal;
      overflow-wrap: break-word;
    }
    .invoice-meta-grid {
      display: flex;
      flex-direction: column;
      gap: ${compact ? '1px' : '2px'};
      width: 100%;
    }
    .meta-line {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      width: 100%;
      padding: ${compact ? '1px 0' : '2px 0'};
      font-size: ${compact ? '9.5px' : '11px'};
      border-bottom: 1px dotted #e2e8f0;
      gap: 6px;
    }
    .meta-line:last-child {
      border-bottom: none;
    }
    .meta-line.meta-document-badge {
      font-weight: 800;
      font-size: ${compact ? '10px' : '11.5px'};
    }
    .meta-line.meta-online-order-badge {
      font-weight: 800;
      font-size: ${compact ? '10.5px' : '12px'};
      background: #f1f5f9;
      padding: ${compact ? '2px 4px' : '3px 6px'};
      border-radius: 4px;
      border: 1px dashed #94a3b8;
      margin: 2px 0;
    }
    .meta-line.meta-online-order-badge .meta-label {
      font-weight: 800;
      color: #000;
    }
    .meta-line.meta-online-order-badge .meta-value {
      font-weight: 900;
      color: #000;
      font-family: monospace, monospace;
      direction: ltr;
    }
    .meta-line.strong {
      font-weight: 800;
      font-size: ${compact ? '10.5px' : '12px'};
      border-bottom: 1px solid #cbd5e1;
      padding: ${compact ? '2px 0' : '4px 0'};
    }
    .meta-label {
      color: #000;
      font-weight: 600;
      flex-shrink: 0;
    }
    .meta-value {
      color: #000;
      text-align: left;
      unicode-bidi: plaintext;
      word-break: break-word;
    }
    .invoice-items-table {
      width: 100%;
      border-collapse: collapse;
      margin: ${compact ? '2px 0' : '4px 0'};
    }
    .invoice-items-table th,
    .invoice-items-table td {
      padding: ${compact ? '2.5px 2px' : '4px 3px'};
      font-size: ${compact ? '9px' : '10.5px'};
      text-align: center;
      color: #000;
      vertical-align: middle;
      border-bottom: 1px dotted #000;
    }
    .invoice-items-table th {
      background: #000;
      color: #fff;
      font-weight: 800;
      border: 1px solid #000;
      text-align: center;
      vertical-align: middle;
      padding: ${compact ? '2.5px 2px' : '4px 3px'};
    }
    .invoice-items-table th.name-th,
    .invoice-items-table td.name-cell {
      text-align: right;
      vertical-align: middle;
      padding-right: ${compact ? '4px' : '6px'};
      padding-inline-start: ${compact ? '4px' : '6px'};
    }
    .invoice-items-table .index-cell,
    .invoice-items-table .index-th { width: 5%; text-align: center; vertical-align: middle; color: #000; }
    .invoice-items-table .name-cell,
    .invoice-items-table .name-th { width: ${compact ? '46%' : '42%'}; font-weight: 700; color: #000; }
    .invoice-items-table .unit-cell,
    .invoice-items-table .unit-th { width: 12%; text-align: center; vertical-align: middle; color: #000; }
    .invoice-items-table .qty-cell,
    .invoice-items-table .qty-th { width: ${compact ? '12%' : '10%'}; text-align: center; vertical-align: middle; font-weight: 700; color: #000; }
    .invoice-items-table .price-cell,
    .invoice-items-table .price-th { width: ${compact ? '18%' : '14%'}; text-align: center; vertical-align: middle; color: #000; }
    .invoice-items-table .total-cell,
    .invoice-items-table .total-th { width: ${compact ? '24%' : '17%'}; text-align: center; vertical-align: middle; font-weight: 800; color: #000; }
    .invoice-totals-card {
      border-top: 1px dashed #000;
      margin-top: ${compact ? '2px' : '4px'};
      padding-top: ${compact ? '2px' : '4px'};
    }
    .invoice-payment-card {
      border-top: 1px dashed #cbd5e1;
      margin-top: ${compact ? '2px' : '4px'};
      padding-top: ${compact ? '2px' : '4px'};
    }
    .section-title {
      font-size: ${compact ? '9px' : '10.5px'};
      font-weight: 800;
      color: #000;
      margin-bottom: 2px;
    }
    .payment-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
    }
    .payment-chip {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #fff;
      border: 1px solid #000;
      padding: 1px 4px;
      border-radius: 2px;
      font-size: ${compact ? '8.5px' : '10px'};
      width: 100%;
      font-weight: 700;
      color: #000;
    }
    .invoice-barcode-card {
      text-align: center;
      margin-top: ${compact ? '4px' : '6px'};
      padding-top: ${compact ? '2px' : '4px'};
      border-top: 1px dashed #000;
    }
    .invoice-barcode-svg-wrap {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      margin: 0 auto;
    }
    .invoice-barcode-svg-wrap svg {
      width: 100% !important;
      max-width: 220px !important;
      height: ${compact ? '26px' : '34px'} !important;
      display: block;
    }
    .print-footer {
      text-align: center;
      margin-top: ${compact ? '4px' : '6px'};
      padding-top: ${compact ? '2px' : '4px'};
      font-size: ${compact ? '8.5px' : '9.5px'};
      color: #000;
      border-top: 1px dashed #cbd5e1;
    }

    /* Boxed Theme */
    .receipt-theme-boxed .invoice-card { border: 1px solid #000; margin-bottom: 3px; border-radius: 3px; padding: 4px 6px; }
    .receipt-theme-boxed .invoice-items-table th { background: #000; color: #fff; }
    .receipt-theme-boxed .meta-line { border-bottom: 1px dashed #000; }
    .receipt-theme-boxed .meta-line:last-child { border-bottom: none; }
    .receipt-theme-boxed .total-line { border-top: 1px solid #000; border-bottom: 1px solid #000; margin-top: 2px; }

    /* Ultra Compact Theme */
    .receipt-theme-ultra-compact .invoice-card { padding: 1px 0; border: none; border-radius: 0; }
    .receipt-theme-ultra-compact .invoice-brand-row { min-height: 0; gap: 4px; }
    .receipt-theme-ultra-compact .invoice-logo-wrapper { width: 44px; height: 28px; min-height: 28px; }
    .receipt-theme-ultra-compact .invoice-brand-copy h2 { font-size: 14px; }
    .receipt-theme-ultra-compact .store-meta-line { display: none; }
    .receipt-theme-ultra-compact .store-inline-details { display: flex; flex-direction: column; align-items: center; gap: 1px; font-size: 8.5px; color: #000; margin-top: 1px; font-weight: 600; text-align: center; }
    .receipt-theme-ultra-compact .store-detail-line { display: block; width: 100%; text-align: center; }
    .receipt-theme-ultra-compact .meta-line { display: inline-flex; align-items: baseline; gap: 3px; white-space: nowrap; border: none; padding: 0; font-size: 10px; break-inside: avoid; }
    .receipt-theme-ultra-compact .meta-line::after { content: " | "; margin: 0 3px; font-weight: normal; font-size: 9px; }
    .receipt-theme-ultra-compact .meta-line:last-child::after { content: ""; margin: 0; }

    body.receipt-mode .print-shell { width: 100%; max-width: 100%; padding-top: 0; margin: 0; box-sizing: border-box; }
    body.receipt-mode .print-header, body.receipt-mode .receipt-header { display: none !important; }
    body.receipt-mode .print-title-wrap { min-width: 0; }
  `;
}

function renderLoyaltySummary(options: {
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyPointsBalance?: number;
  settings?: Partial<AppSettings> | null;
  compact?: boolean;
}) {
  const showLoyalty = getPrintOption(options.settings, 'printShowLoyaltyPoints', false);
  if (!showLoyalty) return '';

  const earned = Number(options.loyaltyPointsEarned || 0);
  const redeemed = Number(options.loyaltyPointsRedeemed || 0);
  const balance = options.loyaltyPointsBalance !== undefined && options.loyaltyPointsBalance !== null ? Number(options.loyaltyPointsBalance) : undefined;

  if (earned <= 0 && redeemed <= 0 && (balance === undefined || balance <= 0)) {
    return '';
  }

  const pointValue = Number(options.settings?.loyaltyPointRedeemValue ?? 0.1);
  // INV-FE1-FRONTEND-BOOK-DIGITS: loyalty balance value rounds at
  // the tenant's book digits (receipt settings currency, global
  // fallback) — the old 2dp truncated 3dp tenants' balances.
  const balanceCurrency = balance !== undefined ? roundMoneyValue(balance * pointValue, currencyMoneyDigits(options.settings?.currency || getGlobalSystemCurrency())) : null;

  return `
    <section class="invoice-card invoice-loyalty-card${options.compact ? ' compact' : ''}" style="margin: 4px 0; padding: 5px 7px; border: 1px dashed #000; border-radius: 4px; font-size: ${options.compact ? '9.5px' : '11px'}; color: #000; line-height: 1.4;">
      <div style="font-weight: 800; border-bottom: 1px dotted #cbd5e1; padding-bottom: 2px; margin-bottom: 2px; display: flex; justify-content: space-between;">
        <span>برنامج نقاط ومكافآت الولاء</span>
      </div>
      ${earned > 0 ? `
        <div style="display: flex; justify-content: space-between;">
          <span>النقاط المكتسبة:</span>
          <strong>+${earned.toLocaleString()} نقطة</strong>
        </div>
      ` : ''}
      ${redeemed > 0 ? `
        <div style="display: flex; justify-content: space-between;">
          <span>النقاط المستبدلة:</span>
          <strong>-${redeemed.toLocaleString()} نقطة</strong>
        </div>
      ` : ''}
      ${balance !== undefined ? `
        <div style="display: flex; justify-content: space-between; font-weight: 800; margin-top: 1px; border-top: 1px dashed #e2e8f0; padding-top: 1px;">
          <span>رصيد نقاطك الكلي:</span>
          <strong>${balance.toLocaleString()} نقطة${balanceCurrency !== null ? ` (${balanceCurrency.toLocaleString()} ${getGlobalCurrencySymbol()})` : ''}</strong>
        </div>
      ` : ''}
    </section>
  `;
}

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

    return `
      <div class="receipt-theme-${theme} receipt-copy-${copy}">
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
