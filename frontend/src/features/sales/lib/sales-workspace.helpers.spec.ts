/* P3-partial: register + details reprints must carry the duplicate-copy
 * banner. printSaleDocument is the single choke point both call sites
 * (register row onPrintSale, details dialog print button) go through, so
 * pinning isReprint here pins both paths. Original prints stay unmarked:
 * printReceiptNow / printA4Now / printDual / printMerchant never pass
 * through this helper. */
import { describe, expect, it, vi } from 'vitest';
import * as posPrinting from '@/lib/pos-printing';
import { printSaleDocument } from './sales-workspace.helpers';
import type { Sale } from '@/types/domain';

const fakeSale = {
  id: 'sale-1',
  docNo: 'Z-100',
  total: 250,
  paidAmount: 250,
  paymentType: 'cash',
  paymentChannel: 'cash',
  customerName: 'محمود حسن',
  items: [],
  payments: [],
} as unknown as Sale;

describe('printSaleDocument', () => {
  it('marks receipt-size reprints as duplicate copies', () => {
    const printSpy = vi.spyOn(posPrinting, 'printPostedSaleReceipt').mockImplementation(vi.fn());
    printSaleDocument(fakeSale, null, 'receipt');
    expect(printSpy).toHaveBeenCalledWith(
      fakeSale,
      expect.objectContaining({ pageSize: 'receipt', isReprint: true }),
    );
    printSpy.mockRestore();
  });

  it('marks A4 reprints as duplicate copies', () => {
    const printSpy = vi.spyOn(posPrinting, 'printPostedSaleReceipt').mockImplementation(vi.fn());
    printSaleDocument(fakeSale, null, 'a4');
    expect(printSpy).toHaveBeenCalledWith(
      fakeSale,
      expect.objectContaining({ pageSize: 'a4', isReprint: true }),
    );
    printSpy.mockRestore();
  });
});
