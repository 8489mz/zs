import { printHtmlDocument } from '@/lib/browser';
import type { PosItem } from '@/features/pos/types/pos.types';
import type { Sale, AppSettings } from '@/types/domain';
import { buildReceiptDocument, getInvoiceStyles } from '@/lib/pos-printing/template';
import {
  formatDateTime,
  formatSalePaymentText,
  paymentLabel,
  type PosPrintPageSize,
} from '@/lib/pos-printing/shared';
import { tryPrintViaHardware, formatSaleForHardwarePrinter } from '@/lib/pos-printing/hardware';

export interface PrintReceiptOptions {
  pageSize?: PosPrintPageSize;
  settings?: Partial<AppSettings> | null;
  cashierName?: string;
  isReturn?: boolean;
  isPurchase?: boolean;
  footerText?: string;
  copyType?: 'customer' | 'merchant' | 'dual';
}

export function openReceiptDocument(
  title: string,
  documentHtml: string,
  compact: boolean,
  options: PrintReceiptOptions,
  subtitle = '',
) {
  printHtmlDocument(title, documentHtml, {
    subtitle,
    footerHtml: '',
    pageSize: options.pageSize === 'receipt' ? 'receipt' : 'A4',
    extraStyles: getInvoiceStyles(compact),
    deviceName: options.settings?.posElectronCashierPrinter || undefined,
    windowsPrinterName: options.settings?.posWindowsPrinterName || undefined,
    receiptWidthMm: options.settings?.receiptWidthMm === 58 ? 58 : 80,
    hideHeader: true,
  });
}

export function printPosDraftPreview(options: {
  title?: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  paymentLabel?: string;
  branchName?: string;
  locationName?: string;
  items: PosItem[];
  subtotal: number;
  discount: number;
  deliveryFee?: number;
  taxAmount: number;
  total: number;
  note?: string;
  tableNumber?: string | null;
  orderType?: string | null;
  pagerNumber?: string | null;
  pageSize?: PosPrintPageSize;
  settings?: Partial<AppSettings> | null;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyPointsBalance?: number;
}) {
  const document = buildReceiptDocument({
    pageSize: options.pageSize,
    settings: options.settings,
    documentLabel: options.pageSize === 'receipt' ? 'إيصال بيع' : 'فاتورة بيع',
    documentNumber: 'مسودة',
    dateText: formatDateTime(),
    customerName: options.customerName || 'عميل نقدي',
    customerPhone: options.customerPhone,
    customerAddress: options.customerAddress,
    paymentText: paymentLabel(options.paymentLabel),
    branchName: options.branchName || 'المتجر الرئيسي',
    locationName: options.locationName || 'المخزن الأساسي',
    note: options.note,
    tableNumber: options.tableNumber,
    orderType: options.orderType,
    pagerNumber: options.pagerNumber,
    deliveryRepName: (options as any).deliveryRepName,
    items: (options.items || []).map((item) => ({
      name: item.name,
      unitName: item.unitName,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      originalPrice: item.originalPrice ? Number(item.originalPrice) : undefined,
      offerDiscount: item.offerDiscount ? Number(item.offerDiscount) : undefined,
      offerName: item.offerName,
      /* INV-POS-LINE-DISCOUNT: the draft total is the NET line total
       * (gross minus the line's own discount), matching the posted
       * sale — the gross figure would leave the item rows summing
       * above the shown total. */
      lineDiscount: item.lineDiscount ? Number(item.lineDiscount) : undefined,
      total: Number(item.qty || 0) * (Number(item.price || 0) + (item.modifiers || []).reduce((sum: number, mod: any) => sum + Number(mod.price || 0) * Number(mod.qty || 1), 0)) - Number(item.lineDiscount || 0),
      modifiers: item.modifiers,
    })),
    subtotal: Number(options.subtotal || 0),
    discount: Number(options.discount || 0),
    deliveryFee: Number(options.deliveryFee || 0),
    serviceCharge: Number((options as any).serviceCharge || 0),
    tipAmount: Number((options as any).tipAmount || 0),
    taxAmount: Number(options.taxAmount || 0),
    total: Number(options.total || 0),
    paidAmount: Number(options.total || 0),
    loyaltyPointsEarned: options.loyaltyPointsEarned,
    loyaltyPointsRedeemed: options.loyaltyPointsRedeemed,
    loyaltyPointsBalance: options.loyaltyPointsBalance,
  });

  openReceiptDocument(
    options.title || (options.pageSize === 'receipt' ? 'معاينة إيصال البيع' : 'معاينة فاتورة الكاشير'),
    document.html,
    document.compact,
    { pageSize: options.pageSize === 'receipt' ? 'receipt' : 'a4', settings: options.settings || null },
    options.pageSize === 'receipt' ? '' : 'معاينة جاهزة للطباعة',
  );
}

function buildPostedSaleDocument(sale: Sale, options: PrintReceiptOptions) {
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
      /* INV-POS-LINE-DISCOUNT: the stored per-line discount (the read
       * path returns it as lineDiscount; the snake-case fallback
       * covers raw sale rows). item.total is already the NET line
       * total from the backend; the fallback subtracts the discount
       * from the gross so a raw row reconciles too. */
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
  });
}

export async function printPostedSaleReceipt(sale: Sale, options: PrintReceiptOptions = {}): Promise<void> {
  const effectiveOptions: PrintReceiptOptions = { pageSize: 'receipt', ...options };

  // 1. Direct Sunmi Native Android App Bridge (Instant hardware print in APK)
  if (typeof window !== 'undefined' && (window as any).SunmiPrinter?.printReceipt) {
    try {
      const printData = formatSaleForHardwarePrinter(sale, effectiveOptions);
      (window as any).SunmiPrinter.printReceipt(printData);
      return;
    } catch (err) {
      console.warn('Sunmi direct printer bridge failed, falling back:', err);
    }
  }

  // 2. Hardware printer via local socket/service (Port 9100 or Port 8080)
  // Skip probing raw 9100/8080 sockets when a Windows printer (Z-Systems Bridge :18181)
  // or Electron printer is configured, unless an explicit raw hardware URL/IP is set.
  const hasWindowsOrElectronPrinter = Boolean(
    effectiveOptions.settings?.posWindowsPrinterName ||
    effectiveOptions.settings?.posElectronCashierPrinter ||
    (typeof window !== 'undefined' && (window as any).electronPrinter?.printHtmlSilent)
  );
  const hasExplicitRawHardware = Boolean(
    (effectiveOptions.settings as any)?.posHardwarePrinterUrl ||
    effectiveOptions.settings?.posNetworkThermalPrinterIp
  );
  if (effectiveOptions.pageSize === 'receipt' && (!hasWindowsOrElectronPrinter || hasExplicitRawHardware)) {
    try {
      const printedViaHardware = await tryPrintViaHardware(sale, effectiveOptions);
      if (printedViaHardware) {
        return;
      }
    } catch {
      // Fall through to browser print document
    }
  }

  const document = buildPostedSaleDocument(sale, effectiveOptions);
  openReceiptDocument(
    `${effectiveOptions.pageSize === 'receipt' ? 'إيصال بيع' : 'فاتورة'} ${sale.docNo || sale.id}`,
    document.html,
    document.compact,
    effectiveOptions,
    effectiveOptions.pageSize === 'receipt' ? '' : 'معاينة جاهزة للطباعة'
  );
}

export function printDualPostedSaleReceipt(sale: Sale, options: PrintReceiptOptions = {}) {
  return printPostedSaleReceipt(sale, { ...options, copyType: 'dual' });
}

export function printMerchantPostedSaleReceipt(sale: Sale, options: PrintReceiptOptions = {}) {
  return printPostedSaleReceipt(sale, { ...options, copyType: 'merchant' });
}

export function printGuestCheck(options: {
  tableNumber: string;
  items: PosItem[];
  subtotal: number;
  discount?: number;
  serviceCharge?: number;
  taxAmount?: number;
  total: number;
  guestCount?: number;
  customerName?: string;
  cashierName?: string;
  branchName?: string;
  locationName?: string;
  settings?: Partial<AppSettings> | null;
}) {
  const document = buildReceiptDocument({
    pageSize: 'receipt',
    settings: options.settings,
    documentLabel: 'شيك حساب طاولة (غير مسدد)',
    documentNumber: `طاولة #${options.tableNumber}`,
    dateText: formatDateTime(),
    customerName: options.customerName || `طاولة ${options.tableNumber}`,
    paymentText: 'غير مسدد — شيك للمعاينة ومراجعة الحساب',
    cashierName: options.cashierName || '—',
    branchName: options.branchName || 'المتجر الرئيسي',
    locationName: options.locationName || 'المخزن الأساسي',
    tableNumber: options.tableNumber,
    orderType: 'dine_in',
    items: (options.items || []).map((item) => ({
      name: item.name,
      unitName: item.unitName,
      qty: Number(item.qty || 0),
      price: Number(item.price || 0),
      /* INV-POS-LINE-DISCOUNT: the guest-check total is the NET line
       * total, matching the posted sale and the template's net
       * subtotal. */
      lineDiscount: item.lineDiscount ? Number(item.lineDiscount) : undefined,
      total: Number(item.qty || 0) * (Number(item.price || 0) + (item.modifiers || []).reduce((sum: number, mod: any) => sum + Number(mod.price || 0) * Number(mod.qty || 1), 0)) - Number(item.lineDiscount || 0),
      modifiers: item.modifiers,
    })),
    subtotal: Number(options.subtotal || 0),
    discount: Number(options.discount || 0),
    serviceCharge: Number(options.serviceCharge || 0),
    taxAmount: Number(options.taxAmount || 0),
    total: Number(options.total || 0),
    paidAmount: 0,
    guestCount: options.guestCount,
  });

  openReceiptDocument(
    `شيك طاولة ${options.tableNumber} (غير مسدد)`,
    document.html,
    document.compact,
    { pageSize: 'receipt', settings: options.settings || null },
    'شيك حساب طاولة (غير مسدد)'
  );
}

export { exportPostedSalePdf } from '@/lib/pos-printing/pdf';
export { printKitchenTicket } from '@/lib/pos-printing/kitchen';
export {
  tryPrintViaHardware,
  printViaHardwarePrinter,
  isHardwarePrinterAvailable,
  formatSaleForHardwarePrinter,
} from '@/lib/pos-printing/hardware';
