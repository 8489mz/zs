import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/browser', () => ({
  escapeHtml: (str: string) => str,
}));

import { formatReceiptQuantity, buildReceiptDocument } from './template';

describe('Receipt Printing formatReceiptQuantity', () => {
  const englishSettings = { printNumberFormat: 'english' as const };

  it('should format zero correctly', () => {
    expect(formatReceiptQuantity(0, englishSettings)).toBe('0');
  });

  it('should format exact fractional quantities without rounding (up to 3 decimals)', () => {
    expect(formatReceiptQuantity(0.135, englishSettings)).toBe('0.135');
    expect(formatReceiptQuantity(1.575, englishSettings)).toBe('1.575');
    expect(formatReceiptQuantity(1.5, englishSettings)).toBe('1.5');
    expect(formatReceiptQuantity(0.5, englishSettings)).toBe('0.5');
  });

  it('should format whole numbers without decimal zeros', () => {
    expect(formatReceiptQuantity(3, englishSettings)).toBe('3');
    expect(formatReceiptQuantity(3.000, englishSettings)).toBe('3');
  });

  it('should handle invalid or missing values gracefully', () => {
    expect(formatReceiptQuantity(null as any, englishSettings)).toBe('0');
    expect(formatReceiptQuantity(undefined as any, englishSettings)).toBe('0');
    expect(formatReceiptQuantity(NaN, englishSettings)).toBe('0');
  });

  it('should format with Arabic locale when configured', () => {
    const settings = { printNumberFormat: 'arabic' as const };
    const res = formatReceiptQuantity(1.575, settings);
    expect(res).toBeDefined();
  });
});

describe('Receipt Printing Payment QR Section', () => {
  const baseOptions = {
    documentLabel: 'فاتورة ضريبية',
    documentNumber: 'INV-261017-0001',
    items: [{ name: 'زعفران أصلي', qty: 2, price: 150, total: 300 }],
    subtotal: 300,
    discount: 0,
    taxAmount: 0,
    total: 300,
  };

  it('should NOT render payment QR by default when printPaymentQrOnReceipt is false', () => {
    const doc = buildReceiptDocument({
      ...baseOptions,
      settings: {
        printPaymentQrOnReceipt: false,
        instapayAddress: '01018017523',
      },
    });
    expect(doc.html).not.toContain('invoice-payment-qr-card');
  });

  it('should render InstaPay QR on receipt when printPaymentQrOnReceipt is true', () => {
    const doc = buildReceiptDocument({
      ...baseOptions,
      payments: [{ paymentChannel: 'instapay', amount: 300 } as any],
      settings: {
        printPaymentQrOnReceipt: true,
        instapayAddress: '01018017523',
      },
    });
    expect(doc.html).toContain('invoice-payment-qr-card');
    expect(doc.html).toContain('انستاباي');
    expect(doc.html).toContain('01018017523');
    expect(doc.html).toContain('<svg');
  });

  it('should render Mobile Wallet QR on receipt when wallet payment is selected', () => {
    const doc = buildReceiptDocument({
      ...baseOptions,
      payments: [{ paymentChannel: 'wallet', amount: 300 } as any],
      settings: {
        printPaymentQrOnReceipt: true,
        walletNumber: '01018017523',
        walletProviderName: 'فودافون كاش',
      },
    });
    expect(doc.html).toContain('invoice-payment-qr-card');
    expect(doc.html).toContain('فودافون كاش');
    expect(doc.html).toContain('01018017523');
  });

  it('should render bilingual English item name when printBilingualItemNames is true', () => {
    const doc = buildReceiptDocument({
      ...baseOptions,
      items: [
        { name: 'برجر دجاج', nameEn: 'Chicken Burger', qty: 1, price: 100, total: 100 },
      ],
      settings: {
        printBilingualItemNames: true,
      },
    });
    expect(doc.html).toContain('برجر دجاج');
    expect(doc.html).toContain('Chicken Burger');
    expect(doc.html).toContain('item-name-en');
  });
  it('should render item modifiers as inline badges without repeating [إضافة]', () => {
    const doc = buildReceiptDocument({
      ...baseOptions,
      items: [
        {
          name: 'حواوشي سجق',
          qty: 1,
          price: 40,
          total: 50,
          modifiers: [
            { name: 'جبنه', price: 10, qty: 1 },
            { name: 'بطه', price: 0, qty: 3 },
          ],
        },
      ],
    });
    expect(doc.html).not.toContain('[إضافة]');
    expect(doc.html).toContain('+ جبنه');
    expect(doc.html).toContain('+ بطه (×3)');
    expect(doc.html).toContain('item-modifiers');
  });
});