import type { Sale, AppSettings } from '@/types/domain';
import { formatDateTime, paymentLabel, defaultInvoiceFooter, type PosPrintPageSize } from './shared';

export interface HardwarePrintOptions {
  pageSize?: PosPrintPageSize;
  settings?: Partial<AppSettings> | null;
  cashierName?: string;
  isReturn?: boolean;
  isPurchase?: boolean;
  footerText?: string;
  copyType?: 'customer' | 'merchant' | 'dual';
}

export interface HardwarePrinterResponse {
  success: boolean;
  message?: string;
}

let cachedHardwareAvailable: { available: boolean; timestamp: number } | null = null;
const CACHE_TTL_MS = 15000;

export function getHardwarePrinterUrl(options?: HardwarePrintOptions): string {
  const custom = (options?.settings as any)?.posHardwarePrinterUrl;
  if (custom && typeof custom === 'string' && custom.trim()) {
    return custom.trim();
  }
  return 'http://127.0.0.1:9100/';
}

export async function isHardwarePrinterAvailable(targetUrl = 'http://127.0.0.1:9100/'): Promise<boolean> {
  const now = Date.now();
  if (cachedHardwareAvailable && now - cachedHardwareAvailable.timestamp < CACHE_TTL_MS) {
    return cachedHardwareAvailable.available;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 650);

    const response = await fetch(targetUrl, {
      method: 'OPTIONS',
      signal: controller.signal,
      mode: 'cors',
    });
    clearTimeout(timeoutId);

    const available = response.ok || response.status === 200 || response.status === 204;
    cachedHardwareAvailable = { available, timestamp: now };
    return available;
  } catch {
    cachedHardwareAvailable = { available: false, timestamp: now };
    return false;
  }
}

export function resetHardwarePrinterAvailabilityCache(): void {
  cachedHardwareAvailable = null;
}

function padLine(left: string, right: string, width = 32): string {
  const spaceNeeded = width - (left.length + right.length);
  if (spaceNeeded <= 0) {
    return `${left} ${right}\n`;
  }
  return `${left}${' '.repeat(spaceNeeded)}${right}\n`;
}

export function formatSaleForHardwarePrinter(sale: Sale, options?: HardwarePrintOptions): string {
  const settings = options?.settings;
  const storeName = String(settings?.brandName || settings?.storeName || 'Z-SYSTEMS').trim();
  const branchName = String(sale.branchName || settings?.currentBranchId || '').trim();
  const phone = String(settings?.phone || '').trim();
  const taxNumber = String(settings?.taxNumber || '').trim();
  const width = settings?.receiptWidthMm === 80 ? 42 : 30;
  const divider = '-'.repeat(width);
  const doubleDivider = '='.repeat(width);

  let out = '';
  out += `${doubleDivider}\n`;
  out += `${storeName.padStart(Math.floor((width + storeName.length) / 2))}\n`;
  if (branchName) {
    out += `${branchName.padStart(Math.floor((width + branchName.length) / 2))}\n`;
  }
  if (phone) {
    out += `هاتف: ${phone}\n`;
  }
  if (taxNumber) {
    out += `الرقم الضريبي: ${taxNumber}\n`;
  }
  out += `${doubleDivider}\n`;

  const docNo = String(sale.docNo || sale.id || '—');
  out += `إيصال بيع: ${docNo}\n`;
  out += `التاريخ: ${formatDateTime(sale.date || (sale as any).createdAt, settings)}\n`;

  const cashier = String(sale.createdBy || options?.cashierName || '').trim();
  if (cashier && cashier !== '—') {
    out += `الكاشير: ${cashier}\n`;
  }

  const customer = String(sale.customerName || '').trim();
  if (customer && customer !== 'عميل نقدي') {
    out += `العميل: ${customer}\n`;
  }

  out += `${divider}\n`;
  if (width >= 40) {
    out += padLine('الصنف', 'الكمية    السعر', width);
  } else {
    out += padLine('الصنف', 'المجموع', width);
  }
  out += `${divider}\n`;

  const items: any[] = (sale as any).cart || sale.items || [];
  /* INV-POS-LINE-DISCOUNT: the per-line discounts, summed for the
   * totals section — sale.subTotal is already net of them. */
  const totalLineDiscount = items.reduce((sum, entry) => sum + Number(entry.lineDiscount ?? entry.line_discount ?? 0), 0);
  for (const item of items) {
    const itemName = String(item.name || 'صنف');
    const qty = Number(item.qty || 1);
    const price = Number(item.price || 0);
    const lineDiscount = Number(item.lineDiscount ?? item.line_discount ?? 0);
    /* item.total is the backend's NET line total; the fallback nets
     * the gross (price + modifiers) by the line discount, so a
     * fully-discounted line (total 0) does not print at full price. */
    const modifiersTotal = Array.isArray(item.modifiers)
      ? item.modifiers.reduce((sum: number, mod: any) => sum + Number(mod.price || 0) * Number(mod.qty || 1), 0)
      : 0;
    const total = Number(item.total || (qty * (price + modifiersTotal) - lineDiscount));

    out += `${itemName}\n`;
    const qtyPrice = `${qty} x ${price.toFixed(2)}`;
    const totalStr = total.toFixed(2);
    out += padLine(`  ${qtyPrice}`, totalStr, width);

    if (lineDiscount > 0) {
      out += padLine('  خصم الصنف:', `-${lineDiscount.toFixed(2)}`, width);
    }
    if (Array.isArray(item.modifiers) && item.modifiers.length > 0) {
      for (const mod of item.modifiers) {
        const modName = `+ ${mod.name || mod.modifierName}`;
        const modPrice = Number(mod.price || 0);
        out += padLine(`    ${modName}`, modPrice > 0 ? modPrice.toFixed(2) : '', width);
      }
    }
  }

  out += `${divider}\n`;
  const subtotal = Number(sale.subTotal || 0);
  const discount = Number(sale.discount || 0);
  const tax = Number(sale.taxAmount || 0);
  const deliveryFee = Number((sale as any).deliveryFee || (sale as any).delivery_fee || 0);
  const grandTotal = Number(sale.total || 0);
  const paid = Number(sale.paidAmount || 0);
  const change = Number((sale as any).changeAmount || 0);

  if (discount > 0 || tax > 0 || deliveryFee > 0 || totalLineDiscount > 0) {
    /* INV-POS-LINE-DISCOUNT: sale.subTotal is net of the line
     * discounts, so the subtotal row shows the gross (net + line
     * discounts) — the "خصم الأصناف" row below reconciles it back
     * to the net, exactly like the receipt template. */
    out += padLine('المجموع الفرعي:', (subtotal + totalLineDiscount).toFixed(2), width);
  }
  if (totalLineDiscount > 0) {
    out += padLine('خصم الأصناف:', `-${totalLineDiscount.toFixed(2)}`, width);
  }
  if (discount > 0) {
    out += padLine('الخصم:', `-${discount.toFixed(2)}`, width);
  }
  if (deliveryFee > 0) {
    out += padLine('خدمة التوصيل:', deliveryFee.toFixed(2), width);
  }
  if (tax > 0) {
    out += padLine('ضريبة القيمة المضافة:', tax.toFixed(2), width);
  }

  out += padLine('الإجمالي النهائي:', `${grandTotal.toFixed(2)} EGP`, width);
  out += `${divider}\n`;

  const methodLabel = paymentLabel(sale.paymentChannel || sale.paymentType);
  out += padLine('طريقة الدفع:', methodLabel, width);
  if (paid > 0) {
    out += padLine('المدفوع:', `${paid.toFixed(2)} EGP`, width);
  }
  if (change > 0) {
    out += padLine('المتبقي:', `${change.toFixed(2)} EGP`, width);
  }

  out += `${doubleDivider}\n`;
  const footer = defaultInvoiceFooter(settings);
  if (footer) {
    if (width < 40 && footer.includes('الاستبدال والاسترجاع')) {
      out += 'يرجى الاحتفاظ بالفاتورة\n';
      out += 'الاستبدال والاسترجاع حسب سياسة المتجر\n';
    } else {
      out += `${footer}\n`;
    }
  }
  out += 'شكراً لتعاملكم معنا\n';
  out += `${doubleDivider}\n\n\n\n`;

  return out;
}

export async function printViaHardwarePrinter(
  sale: Sale,
  options?: HardwarePrintOptions
): Promise<HardwarePrinterResponse> {
  const targetUrl = getHardwarePrinterUrl(options);
  const printData = formatSaleForHardwarePrinter(sale, options);

  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ printData }),
    });

    if (response.ok || response.status === 200) {
      return { success: true, message: 'تمت الطباعة الحرارية بنجاح عبر المنفذ العتادي 9100' };
    }
    return { success: false, message: `فشلت الطباعة: كود الاستجابة ${response.status}` };
  } catch (error: any) {
    return { success: false, message: error?.message || 'تعذر الاتصال بخدمة الطابعة العتادية' };
  }
}

export async function tryPrintViaHardware(
  sale: Sale,
  options?: HardwarePrintOptions
): Promise<boolean> {
  // 1. Check Mobile Handheld Smart POS built-in printer (Sunmi / Pax / Android WebView Bridge)
  try {
    const { MobileTerminalBridge } = await import('@/features/pos/lib/mobile-terminal-bridge');
    const printText = formatSaleForHardwarePrinter(sale, options);
    const networkIp = String(options?.settings?.posNetworkThermalPrinterIp || '').trim();
    const networkPort = Number(options?.settings?.posNetworkThermalPrinterPort || 9100);
    const printedOnMobile = await MobileTerminalBridge.printReceipt({
      receiptText: printText,
      cutPaper: true,
      networkPrinter: networkIp
        ? { ip: networkIp, port: Number.isFinite(networkPort) && networkPort > 0 ? networkPort : 9100 }
        : undefined,
    });
    if (printedOnMobile) return true;
  } catch {
    // ignore and continue to standard network printer
  }

  const targetUrl = getHardwarePrinterUrl(options);
  const available = await isHardwarePrinterAvailable(targetUrl);
  if (available) {
    const result = await printViaHardwarePrinter(sale, options);
    if (result.success) return true;
  }

  // Fallback to local Sunmi / Android ECR service on port 8080
  if (targetUrl.includes('9100')) {
    try {
      const ecrUrl = 'http://127.0.0.1:8080/print';
      const available8080 = await isHardwarePrinterAvailable(ecrUrl);
      if (available8080) {
        const printData = formatSaleForHardwarePrinter(sale, options);
        const res = await fetch(ecrUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json; charset=utf-8' },
          body: JSON.stringify({ printData }),
        });
        if (res.ok) return true;
      }
    } catch {
      // ignore
    }
  }

  return false;
}
