import { getCachedAppSettings, printHtmlDocument } from '@/lib/browser';
import { resolveBridgePrinter, resolveElectronPrinter } from '@/lib/printer-preferences';
import { getInvoiceStyles } from '@/lib/pos-printing/template';
import type { AppSettings } from '@/types/domain';
import type { PosPrintPageSize } from '@/lib/pos-printing/shared';

export interface PrintReceiptOptions {
  pageSize?: PosPrintPageSize;
  settings?: Partial<AppSettings> | null;
  cashierName?: string;
  isReturn?: boolean;
  isPurchase?: boolean;
  footerText?: string;
  copyType?: 'customer' | 'merchant' | 'dual';
  /* A reprint of an already-posted sale: the printed receipt is
   * marked as a duplicate copy (see the template banner), so a
   * reprint can never pass as the original. */
  isReprint?: boolean;
  reprintCount?: number;
}

export function openReceiptDocument(
  title: string,
  documentHtml: string,
  compact: boolean,
  options: PrintReceiptOptions,
  subtitle = '',
) {
  const effectiveSettings = options.settings ?? getCachedAppSettings();
  const targetPageSize = options.pageSize === 'receipt' ? 'receipt' : 'A4';
  const configuredPaperSize = effectiveSettings?.paperSize === 'a4' ? 'a4' : 'receipt';
  const cashierPrinter = resolveElectronPrinter('cashier', effectiveSettings);
  const documentPrinter = resolveElectronPrinter('document', effectiveSettings);
  // Never dump an explicit A4 print (e.g. F10) onto a thermal receipt printer
  // when the store's configured paperSize is 'receipt'.
  const deviceName = targetPageSize === 'receipt'
    ? (cashierPrinter || undefined)
    : (documentPrinter || (configuredPaperSize === 'a4' ? cashierPrinter : '') || undefined);

  const windowsPrinterName = targetPageSize === 'receipt'
    ? (resolveBridgePrinter('cashier', effectiveSettings) || undefined)
    : (resolveBridgePrinter('document', effectiveSettings) || undefined);

  printHtmlDocument(title, documentHtml, {
    subtitle,
    footerHtml: '',
    pageSize: targetPageSize,
    extraStyles: getInvoiceStyles(compact),
    deviceName,
    windowsPrinterName,
    receiptWidthMm: effectiveSettings?.receiptWidthMm === 58 ? 58 : 80,
    hideHeader: true,
  });
}
