import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  MobileTerminalBridge,
  MOBILE_TERMINAL_PRESETS,
  type MobilePaymentRequest,
} from './mobile-terminal-bridge';
import { HardwareBridgeClient } from './hardware-bridge-client';

describe('MobileTerminalBridge', () => {

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete (global as any).window.AndroidBridge;
    delete (global as any).window.SmartPos;
    delete (global as any).window.SunmiPay;
    delete (global as any).window.SunmiPrinter;
    delete (global as any).__onPosPaymentResult;
  });

  it('contains valid presets for Egypt, Kuwait, Saudi Arabia, Sunmi, and Pax', () => {
    expect(MOBILE_TERMINAL_PRESETS.geidea.packageName).toBe('net.geidea.pos');
    expect(MOBILE_TERMINAL_PRESETS.knet.packageName).toBe('kw.com.knet.pos');
    expect(MOBILE_TERMINAL_PRESETS.fawry.packageName).toBe('com.fawry.pos');
    expect(MOBILE_TERMINAL_PRESETS.paymob.packageName).toBe('com.paymob.smartpos');
    expect(MOBILE_TERMINAL_PRESETS.sunmi.packageName).toBe('com.sunmi.payment');
    expect(MOBILE_TERMINAL_PRESETS.pax.packageName).toBe('com.pax.ipp');
  });

  it('detects capabilities accurately when running in standard web browser', async () => {
    const caps = await MobileTerminalBridge.getCapabilities();
    expect(caps).toBeDefined();
    expect(typeof caps.isMobileDevice).toBe('boolean');
    expect(caps.detectedPlatform).toBe('browser_web');
  });

  it('detects Android WebView platform when AndroidBridge is injected', async () => {
    (global as any).window.AndroidBridge = {
      requestPayment: vi.fn(),
      printReceipt: vi.fn(),
    };

    const caps = await MobileTerminalBridge.getCapabilities();
    expect(caps.detectedPlatform).toBe('android_webview');
    expect(caps.hasNativeBridge).toBe(true);
    expect(caps.canDirectPay).toBe(true);
    expect(caps.canDirectPrint).toBe(true);
  });

  it('dispatches payment pulse through AndroidBridge and resolves on approved callback', async () => {
    let capturedPayload: string | null = null;
    (global as any).window.AndroidBridge = {
      requestPayment: vi.fn((payload: string) => {
        capturedPayload = payload;
        // Simulate native Android payment callback
        setTimeout(() => {
          (window as any).__onPosPaymentResult({
            status: 'approved',
            authCode: 'AUTH-9988',
            rrn: 'RRN-112233',
            cardScheme: 'knet',
            cardLastFour: '4321',
            amount: 25.5,
          });
        }, 10);
      }),
    };

    const req: MobilePaymentRequest = {
      amount: 25.5,
      currency: 'KWD',
      invoiceNo: 'INV-2026-001',
      config: { provider: 'knet' },
    };

    const result = await MobileTerminalBridge.requestPayment(req);

    expect(result.success).toBe(true);
    expect(result.status).toBe('approved');
    expect(result.authCode).toBe('AUTH-9988');
    expect(result.rrn).toBe('RRN-112233');
    expect(result.cardScheme).toBe('knet');
    expect(result.cardLastFour).toBe('4321');
    expect(capturedPayload).toContain('"amount":25.5');
    expect(capturedPayload).toContain('"currency":"KWD"');
  });

  it('handles declined payments from AndroidBridge correctly', async () => {
    (global as any).window.AndroidBridge = {
      requestPayment: vi.fn(() => {
        setTimeout(() => {
          (window as any).__onPosPaymentResult({
            status: 'declined',
            message: 'تم رفض البطاقة من البنك',
          });
        }, 10);
      }),
    };

    const result = await MobileTerminalBridge.requestPayment({
      amount: 100,
      currency: 'EGP',
    });

    expect(result.success).toBe(false);
    expect(result.status).toBe('declined');
    expect(result.message).toBe('تم رفض البطاقة من البنك');
  });

  it('dispatches payment through SunmiPay SDK callback', async () => {
    (global as any).window.SunmiPay = {
      sale: vi.fn((amountInCents: number, callback: (res: any) => void) => {
        expect(amountInCents).toBe(1000); // 10.00 * 100
        callback({
          code: '00',
          status: 'success',
          authCode: 'SUNMI-AUTH-1',
          rrn: 'SUNMI-RRN-99',
          cardScheme: 'mada',
          last4: '1234',
        });
      }),
    };

    const result = await MobileTerminalBridge.requestPayment({
      amount: 10.0,
      currency: 'SAR',
      config: { provider: 'sunmi' },
    });

    expect(result.success).toBe(true);
    expect(result.authCode).toBe('SUNMI-AUTH-1');
    expect(result.rrn).toBe('SUNMI-RRN-99');
    expect(result.cardScheme).toBe('mada');
    expect(result.cardLastFour).toBe('1234');
  });

  it('dispatches print receipt directly to native AndroidBridge printer', async () => {
    const printSpy = vi.fn();
    (global as any).window.AndroidBridge = {
      printReceipt: printSpy,
    };

    const success = await MobileTerminalBridge.printReceipt({
      receiptText: '=== Z-SYSTEMS INVOICE ===\nTOTAL: 10.00 SAR\n',
    });

    expect(success).toBe(true);
    expect(printSpy).toHaveBeenCalledWith('=== Z-SYSTEMS INVOICE ===\nTOTAL: 10.00 SAR\n');
  });

  it('dispatches print receipt directly to SunmiPrinter SDK', async () => {
    const printTextSpy = vi.fn();
    const cutPaperSpy = vi.fn();
    (global as any).window.SunmiPrinter = {
      printText: printTextSpy,
      cutPaper: cutPaperSpy,
    };

    const success = await MobileTerminalBridge.printReceipt({
      receiptText: 'RECEIPT CONTENT',
      cutPaper: true,
    });

    expect(success).toBe(true);
    expect(printTextSpy).toHaveBeenCalledWith('RECEIPT CONTENT');
    expect(cutPaperSpy).toHaveBeenCalled();
  });

  it('sends the Hardware Bridge print to the configured network printer IP, not localhost', async () => {
    const isAvailableSpy = vi.spyOn(HardwareBridgeClient, 'isAvailable').mockResolvedValue(true);
    const printSpy = vi.spyOn(HardwareBridgeClient, 'printReceipt').mockResolvedValue({ success: true } as any);

    const success = await MobileTerminalBridge.printReceipt({
      receiptText: 'RECEIPT CONTENT',
      cutPaper: true,
      networkPrinter: { ip: '192.168.1.50', port: 9100 },
    });

    expect(success).toBe(true);
    expect(printSpy).toHaveBeenCalledWith(expect.objectContaining({ ip: '192.168.1.50', port: 9100 }));
    expect(printSpy).not.toHaveBeenCalledWith(expect.objectContaining({ ip: '127.0.0.1' }));
    isAvailableSpy.mockRestore();
    printSpy.mockRestore();
  });

  it('skips the Hardware Bridge channel entirely when no network printer is configured', async () => {
    const isAvailableSpy = vi.spyOn(HardwareBridgeClient, 'isAvailable').mockResolvedValue(true);
    const printSpy = vi.spyOn(HardwareBridgeClient, 'printReceipt').mockResolvedValue({ success: true } as any);

    const success = await MobileTerminalBridge.printReceipt({ receiptText: 'RECEIPT CONTENT' });

    expect(success).toBe(false);
    expect(printSpy).not.toHaveBeenCalled();
    isAvailableSpy.mockRestore();
    printSpy.mockRestore();
  });
});
