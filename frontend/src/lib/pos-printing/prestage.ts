import { escapeHtml, getCachedAppSettings } from '@/lib/browser';
import type { Sale } from '@/types/domain';
import { buildReceiptDocument } from '@/lib/pos-printing/template';
import { formatReceiptText } from '@/lib/pos-printing/template-helpers';
import { renderInvoiceBarcode } from '@/lib/pos-printing/template-payments';
import type { PrintReceiptOptions } from '@/lib/pos-printing/open-receipt';
import { formatDateTime, formatSalePaymentText } from '@/lib/pos-printing/shared';

interface PrestagedReceiptEntry {
  signature: string;
  html: string;
  compact: boolean;
  createdAt: number;
}

let prestagedReceipt: PrestagedReceiptEntry | null = null;

export function buildPostedSaleDocument(sale: Sale, options: PrintReceiptOptions) {
  const pointsPer100 = Number(options.settings?.loyaltyPointsPer100Egp ?? 10);
  const loyaltyPointsEarned = (sale as any).loyaltyPointsEarned !== undefined
    ? Number((sale as any).loyaltyPointsEarned)
    : (Number(sale.paidAmount || 0) > 0 && pointsPer100 > 0 && options.settings?.loyaltyEnabled === true
        ? Math.floor((Number(sale.paidAmount || 0) / 100) * pointsPer100)
        : undefined);

  return buildReceiptDocument({
    pageSize: options.pageSize,
    settings: options.settings,
    documentLabel: options.pageSize === 'receipt' ? 'إيصال بيع' : 'فاتورة بيع',
    documentNumber: sale.docNo || sale.id || 'فاتورة بيع',
    onlineOrderNumber: (sale as any).onlineOrderNumber || (sale as any).online_order_number || (sale as any).orderNumber || (sale as any).order_number,
    dateText: formatDateTime(sale.date || (sale as any).createdAt || new Date()),
    customerName: sale.customerName || 'عميل نقدي',
    customerPhone: sale.customerPhone,
    customerAddress: sale.customerAddress,
    paymentText: formatSalePaymentText(
      sale.paymentType,
      sale.paymentChannel,
      sale.paidAmount,
      sale.total,
      (sale as any).orderType || (sale as any).order_type,
      (sale as any).collectionStatus || (sale as any).collection_status,
      (sale as any).cardScheme || (sale as any).card_scheme
    ),
    cashierName: sale.createdBy || options.cashierName || '—',
    branchName: sale.branchName || 'المتجر الرئيسي',
    locationName: sale.locationName || 'المخزن الأساسي',
    note: sale.note || '',
    tableNumber: (sale as any).tableNumber || (sale as any).table_number || null,
    orderType: (sale as any).orderType || (sale as any).order_type || null,
    pagerNumber: (sale as any).pagerNumber || (sale as any).pager_number || null,
    deliveryRepName: (sale as any).deliveryRepName || (sale as any).delivery_rep_name || null,
    items: ((sale as any).cart || sale.items || []).map((item: any) => ({
      name: item.name,
      unitName: item.unitName,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      originalPrice: item.originalPrice ? Number(item.originalPrice) : (item.original_price ? Number(item.original_price) : undefined),
      offerDiscount: item.offerDiscount ? Number(item.offerDiscount) : (item.offer_discount ? Number(item.offer_discount) : undefined),
      offerName: item.offerName || item.offer_name || undefined,
      lineDiscount: item.lineDiscount != null ? Number(item.lineDiscount) : (item.line_discount != null ? Number(item.line_discount) : undefined),
      total: Number(item.total || (Number(item.qty || 0) * (Number(item.price || 0) + (item.modifiers || []).reduce((sum: number, mod: any) => sum + Number(mod.price || 0) * Number(mod.qty || 1), 0)) - Number(item.lineDiscount ?? item.line_discount ?? 0))),
      modifiers: item.modifiers,
    })),
    subtotal: Number(sale.subTotal || (sale as any).expectedTotal || 0),
    discount: Number(sale.discount || 0),
    deliveryFee: Number((sale as any).deliveryFee || (sale as any).delivery_fee || 0),
    taxAmount: Number(sale.taxAmount || 0),
    total: Number(sale.total || 0),
    paidAmount: Number(sale.paidAmount || 0),
    tenderedAmount: Number((sale as any).tenderedAmount || 0),
    changeAmount: Number((sale as any).changeAmount || 0),
    payments: sale.payments,
    loyaltyPointsEarned,
    loyaltyPointsRedeemed: Number((sale as any).loyaltyPointsRedeemed || (sale as any).loyalty_points_redeemed || 0),
    loyaltyPointsBalance: (sale as any).customerLoyaltyPoints ?? (sale as any).customer?.loyaltyPoints ?? (sale as any).loyaltyPointsBalance,
    terminalId: (sale as any).terminalId || (sale as any).terminal_id,
    terminalAuthCode: (sale as any).terminalAuthCode || (sale as any).terminal_auth_code,
    terminalRrn: (sale as any).terminalRrn || (sale as any).terminal_rrn,
    cardScheme: (sale as any).cardScheme || (sale as any).card_scheme,
    cardLastFour: (sale as any).cardLastFour || (sale as any).card_last_four,
    serviceCharge: Number((sale as any).serviceCharge || (sale as any).service_charge || 0),
    tipAmount: Number((sale as any).tipAmount || (sale as any).tip_amount || 0),
    guestCount: Number((sale as any).guestCount || (sale as any).guest_count || 0),
    copyType: options.copyType || (options.settings?.printDualReceiptForOnlineDelivery && (sale.orderType === 'delivery' || sale.paymentChannel === 'instapay' || sale.paymentChannel === 'wallet' || sale.paymentChannel === 'card') ? 'dual' : 'customer'),
    isReprint: options.isReprint,
  });
}

function computePrestageSignature(sale: Sale, options: PrintReceiptOptions): string {
  const items = ((sale as any).cart || sale.items || []) as any[];
  const itemsKey = items
    .map((it) => `${it.name || ''}:${Number(it.qty || 0)}:${Number(it.price || 0)}:${Number(it.lineDiscount ?? it.line_discount ?? 0)}`)
    .join('|');
  const paymentsKey = (sale.payments || [])
    .map((p) => `${p.paymentChannel}:${Number(p.amount || 0)}`)
    .join(',');
  return [
    options.pageSize || 'receipt',
    options.copyType || '',
    options.cashierName || '',
    sale.customerName || '',
    sale.customerPhone || '',
    sale.customerAddress || '',
    sale.branchName || '',
    sale.locationName || '',
    sale.paymentType || '',
    sale.paymentChannel || '',
    (sale as any).orderType || (sale as any).order_type || '',
    (sale as any).collectionStatus || (sale as any).collection_status || '',
    (sale as any).tableNumber || (sale as any).table_number || '',
    (sale as any).pagerNumber || (sale as any).pager_number || '',
    (sale as any).deliveryRepName || (sale as any).delivery_rep_name || '',
    sale.note || '',
    Number(sale.subTotal || (sale as any).expectedTotal || 0),
    Number(sale.discount || 0),
    Number((sale as any).deliveryFee || (sale as any).delivery_fee || 0),
    Number((sale as any).serviceCharge || (sale as any).service_charge || 0),
    Number((sale as any).tipAmount || (sale as any).tip_amount || 0),
    Number(sale.taxAmount || 0),
    Number(sale.total || 0),
    Number(sale.paidAmount || 0),
    Number((sale as any).tenderedAmount || 0),
    Number((sale as any).changeAmount || 0),
    String((sale as any).customerLoyaltyPoints ?? (sale as any).customer?.loyaltyPoints ?? (sale as any).loyaltyPointsBalance ?? ''),
    String((sale as any).onlineOrderNumber || ''),
    paymentsKey,
    itemsKey,
  ].join('~');
}

export function prestagePostedSaleReceipt(draftSale: Sale, options: PrintReceiptOptions = {}): void {
  try {
    const effectiveSettings = options.settings ?? getCachedAppSettings();
    if (effectiveSettings?.printPaymentQrOnReceipt || options.isReprint) {
      prestagedReceipt = null;
      return;
    }
    const effectiveOptions: PrintReceiptOptions = { pageSize: 'receipt', ...options, settings: effectiveSettings };
    const placeholderSale: Sale = {
      ...draftSale,
      docNo: '__ZS_PREBUILD_DOC_NO__',
      id: '__ZS_PREBUILD_DOC_NO__',
    };
    const doc = buildPostedSaleDocument(placeholderSale, effectiveOptions);
    prestagedReceipt = {
      signature: computePrestageSignature(draftSale, effectiveOptions),
      html: doc.html,
      compact: doc.compact,
      createdAt: Date.now(),
    };
  } catch {
    prestagedReceipt = null;
  }
}

export function resolvePostedSaleReceiptDocument(
  sale: Sale,
  effectiveOptions: PrintReceiptOptions,
): { html: string; compact: boolean } {
  const cachedPrestage = prestagedReceipt;
  prestagedReceipt = null;

  if (
    cachedPrestage &&
    Date.now() - cachedPrestage.createdAt < 15_000 &&
    !effectiveOptions.settings?.printPaymentQrOnReceipt &&
    !effectiveOptions.isReprint &&
    cachedPrestage.signature === computePrestageSignature(sale, effectiveOptions)
  ) {
    const finalDocNo = String(sale.docNo || sale.id || 'فاتورة بيع');
    const formattedDocNo = escapeHtml(formatReceiptText(finalDocNo, effectiveOptions.settings));
    const barcodeHtml = renderInvoiceBarcode(finalDocNo, cachedPrestage.compact, effectiveOptions.settings);
    return {
      html: cachedPrestage.html
        .split('__ZS_PREBUILD_DOC_NO__')
        .join(formattedDocNo)
        .split('<!--__ZS_PREBUILD_INVOICE_BARCODE__-->')
        .join(barcodeHtml),
      compact: cachedPrestage.compact,
    };
  }

  return buildPostedSaleDocument(sale, effectiveOptions);
}
