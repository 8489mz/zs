import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryClient } from '@/app/providers';
import { queryKeys } from '@/app/query-keys';
import { printBatchBarcodeLabels } from '@/lib/barcode-labels';
import { printBarcodeSheet, printSaleReceipt } from '@/lib/barcode';
import { openReceiptDocument, printPostedSaleReceipt } from '@/lib/pos-printing';
import { printSmallReceiptDocument } from '@/lib/small-receipt-printer';
import type { Product, Sale } from '@/types/domain';

const sampleProduct: Product = {
  id: 'prod-1',
  name: 'تيشيرت قطن',
  barcode: '6221234567890',
  costPrice: 100,
  retailPrice: 150,
  wholesalePrice: 130,
  stock: 20,
  minStock: 2,
  categoryId: 'cat-1',
  supplierId: 'sup-1',
  itemKind: 'standard',
  notes: '',
  units: [
    {
      id: 'u-1',
      name: 'قطعة',
      multiplier: 1,
      isBaseUnit: true,
      isSaleUnit: true,
      isPurchaseUnit: true,
      barcode: '6221234567890',
    },
  ],
};

const sampleSale: Sale = {
  id: 'sale-1',
  docNo: 'INV-261117-0001',
  date: '2026-11-17T10:00:00Z',
  customerName: 'عميل نقدي',
  paymentType: 'cash',
  paymentChannel: 'cash',
  subTotal: 150,
  discount: 0,
  taxAmount: 0,
  total: 150,
  paidAmount: 150,
  items: [{ id: '1', name: 'تيشيرت قطن', qty: 1, price: 150, total: 150 }],
} as any;

function makeFakePrintFrame() {
  const frame = document.createElement('iframe');
  const printSpy = vi.fn();
  const focusSpy = vi.fn();
  const doc = { open: vi.fn(), write: vi.fn(), close: vi.fn(), readyState: 'complete' as const };
  Object.defineProperty(frame, 'contentWindow', { value: { focus: focusSpy, print: printSpy }, configurable: true });
  Object.defineProperty(frame, 'contentDocument', { value: doc, configurable: true });
  return { frame, printSpy, doc };
}

describe('Electron silent printing (barcode, receipt, test print)', () => {
  let printHtmlSilentSpy: ReturnType<typeof vi.fn>;
  let fakeFrame: ReturnType<typeof makeFakePrintFrame>;

  beforeEach(() => {
    vi.clearAllMocks();
    queryClient.removeQueries({ queryKey: queryKeys.settings });
    queryClient.removeQueries({ queryKey: queryKeys.posSettings });
    printHtmlSilentSpy = vi.fn().mockResolvedValue({ ok: true });
    (window as any).electronPrinter = {
      getPrinters: vi.fn().mockResolvedValue([]),
      printHtmlSilent: printHtmlSilentSpy,
    };
    fakeFrame = makeFakePrintFrame();
    const origCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...args: any[]) => {
      if (tag === 'iframe') return fakeFrame.frame as any;
      return (origCreateElement as any)(tag, ...args);
    }) as any);
  });

  afterEach(() => {
    delete (window as any).electronPrinter;
    vi.restoreAllMocks();
    queryClient.removeQueries({ queryKey: queryKeys.settings });
    queryClient.removeQueries({ queryKey: queryKeys.posSettings });
    document.body.querySelectorAll('iframe').forEach((el) => el.remove());
  });

  it('prints thermal barcode labels silently to posElectronBarcodePrinter with exact label dimensions', () => {
    printBatchBarcodeLabels(
      [{ product: sampleProduct, unit: sampleProduct.units![0], copies: 2 }],
      { presetId: 'thermal-40x30', copies: 2, labelsPerPage: 1 },
      { showPrice: true },
      { settings: { posElectronBarcodePrinter: 'Xprinter XP-365B' } },
    );

    expect(printHtmlSilentSpy).toHaveBeenCalledTimes(1);
    expect(printHtmlSilentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'Xprinter XP-365B',
        pageSize: 'auto',
        pageSizeMm: { widthMm: 40, heightMm: 30 },
        html: expect.stringContaining('6221234567890'),
      }),
    );
  });

  it('prints A4 barcode sheet silently with landscape orientation when posElectronBarcodePrinter is configured in cache', () => {
    queryClient.setQueryData(queryKeys.settings, { posElectronBarcodePrinter: 'HP LaserJet Pro' });

    printBarcodeSheet({ product: sampleProduct, unit: sampleProduct.units![0], copies: 3 });

    expect(printHtmlSilentSpy).toHaveBeenCalledTimes(1);
    expect(printHtmlSilentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'HP LaserJet Pro',
        pageSize: 'A4',
        orientation: 'landscape',
      }),
    );
  });

  it('falls back to the normal print dialog when optional posElectronBarcodePrinter is left empty', async () => {
    queryClient.setQueryData(queryKeys.settings, { posElectronBarcodePrinter: '' });

    printBatchBarcodeLabels(
      [{ product: sampleProduct, unit: sampleProduct.units![0], copies: 1 }],
      { presetId: 'thermal-40x30', copies: 1, labelsPerPage: 1 },
    );

    expect(printHtmlSilentSpy).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(fakeFrame.printSpy).toHaveBeenCalled();
    });
  });

  it('prints test receipt silently via printSmallReceiptDocument when deviceName is provided', () => {
    printSmallReceiptDocument('<div>Test Receipt</div>', {
      title: 'إيصال تجريبي',
      widthMm: 80,
      deviceName: 'EPSON TM-T20',
    });

    expect(printHtmlSilentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'EPSON TM-T20',
        pageSize: 'receipt',
        receiptWidthMm: 80,
        html: expect.stringContaining('Test Receipt'),
      }),
    );
  });

  it('does not send explicit A4 receipt print (F10) to posElectronCashierPrinter when store paperSize is receipt', async () => {
    openReceiptDocument('فاتورة A4', '<div>Invoice</div>', false, {
      pageSize: 'a4',
      settings: { paperSize: 'receipt', posElectronCashierPrinter: 'EPSON TM-T20' },
    });

    expect(printHtmlSilentSpy).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(fakeFrame.printSpy).toHaveBeenCalled();
    });
  });

  it('sends A4 print silently to posElectronCashierPrinter when store paperSize is a4', () => {
    openReceiptDocument('فاتورة A4', '<div>Invoice</div>', false, {
      pageSize: 'a4',
      settings: { paperSize: 'a4', posElectronCashierPrinter: 'HP OfficeJet A4' },
    });

    expect(printHtmlSilentSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceName: 'HP OfficeJet A4',
        pageSize: 'A4',
      }),
    );
  });

  it('resolves cached posElectronCashierPrinter when callers omit settings (e.g. delivery rep settlements / printSaleReceipt)', async () => {
    queryClient.setQueryData(queryKeys.settings, {
      paperSize: 'receipt',
      posElectronCashierPrinter: 'EPSON TM-T88V',
    });

    await printPostedSaleReceipt(sampleSale);
    printSaleReceipt(sampleSale);

    expect(printHtmlSilentSpy).toHaveBeenCalledTimes(2);
    expect(printHtmlSilentSpy).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ deviceName: 'EPSON TM-T88V', pageSize: 'receipt' }),
    );
    expect(printHtmlSilentSpy).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ deviceName: 'EPSON TM-T88V', pageSize: 'receipt' }),
    );
  });
});
