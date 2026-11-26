import { getCachedAppSettings } from '@/lib/browser';
import type { PosItem } from '@/features/pos/types/pos.types';
import type { Sale, AppSettings } from '@/types/domain';
import { buildReceiptDocument } from '@/lib/pos-printing/template';
import { prestagePostedSaleReceipt, resolvePostedSaleReceiptDocument } from '@/lib/pos-printing/prestage';
import { openReceiptDocument, type PrintReceiptOptions } from '@/lib/pos-printing/open-receipt';
import {
  formatDateTime,
  paymentLabel,
  type PosPrintPageSize,
} from '@/lib/pos-printing/shared';
import { tryPrintViaHardware, formatSaleForHardwarePrinter } from '@/lib/pos-printing/hardware';

export { openReceiptDocument, type PrintReceiptOptions } from '@/lib/pos-printing/open-receipt';
export { prestagePostedSaleReceipt };

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

export async function printPostedSaleReceipt(sale: Sale, options: PrintReceiptOptions = {}): Promise<void> {
  const effectiveSettings = options.settings ?? getCachedAppSettings();
  const effectiveOptions: PrintReceiptOptions = { pageSize: 'receipt', ...options, settings: effectiveSettings };

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

  // 2. Raw hardware printer via explicit socket/service URL or network IP only.
  // Never probe localhost:9100 blindly when unconfigured (avoids 650ms TCP timeout
  // before Bridge silent printing or standard browser printing).
  const hasExplicitRawHardware = Boolean(
    (effectiveOptions.settings as any)?.posHardwarePrinterUrl ||
    effectiveOptions.settings?.posNetworkThermalPrinterIp
  );
  if (effectiveOptions.pageSize === 'receipt' && hasExplicitRawHardware) {
    try {
      const printedViaHardware = await tryPrintViaHardware(sale, effectiveOptions);
      if (printedViaHardware) {
        return;
      }
    } catch {
      // Fall through to browser print document
    }
  }

  const document = resolvePostedSaleReceiptDocument(sale, effectiveOptions);

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
