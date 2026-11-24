import { getGlobalSystemCurrency, getCurrencySymbol } from '../currencies';
import { escapeHtml } from '@/lib/browser';
import type { AppSettings, Sale } from '@/types/domain';
import { getPrintOption } from '@/lib/pos-printing/shared';
import { buildCode128Svg } from '@/lib/barcode';
import { buildInstaPayQrPayload, buildWalletQrPayload, buildPaymentLinkQrPayload } from '@/lib/payment-qr';
import { formatReceiptMoney } from './template-helpers';

export function renderPaymentBreakdown(payments?: Sale['payments'], settings?: Partial<AppSettings> | null, compact = false) {
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

export function renderEdcTerminalSlip(options: {
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

export function renderInvoiceBarcode(documentNumber?: string | number | null, compact = false, settings?: Partial<AppSettings> | null) {
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

export function renderPaymentQrSection(options: {
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
