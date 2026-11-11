/**
 * Universal Mobile POS Terminal & Payment Bridge
 * 
 * Supports handheld Smart POS devices (Sunmi, Pax, iMin, Nexgo, Geidea, KNET, Fawry, Paymob)
 * across Egypt, Kuwait, Saudi Arabia, Gulf, and international markets.
 * 
 * Communication channels supported:
 * 1. Native Android WebView Bridge (window.AndroidBridge / window.SmartPos)
 * 2. Device Localhost Daemon (http://127.0.0.1:8080/pay or /print)
 * 3. Z-Systems Local Hardware Bridge (http://127.0.0.1:18181)
 * 4. Android App-to-App Intent (Universal Scheme)
 * 5. Built-in Handheld Thermal Printer Direct Dispatch
 */

import { HardwareBridgeClient } from './hardware-bridge-client';
import { currencyMoneyDigits } from '@/shared/utils/money';

export type MobileTerminalProvider =
  | 'auto_detect'
  | 'geidea'
  | 'knet'
  | 'tap_knet'
  | 'myfatoorah'
  | 'fawry'
  | 'paymob'
  | 'sunmi'
  | 'pax'
  | 'imin'
  | 'custom_intent'
  | 'manual';

export interface MobileTerminalConfig {
  provider?: MobileTerminalProvider;
  packageName?: string;
  intentAction?: string;
  localDaemonUrl?: string;
  timeoutMs?: number;
  autoFinalize?: boolean;
}

export interface MobilePaymentRequest {
  amount: number;
  currency: string;
  invoiceNo?: string;
  referenceId?: string;
  cashierName?: string;
  storeName?: string;
  customerPhone?: string;
  config?: MobileTerminalConfig;
}

export interface MobilePaymentResult {
  success: boolean;
  status: 'approved' | 'declined' | 'cancelled' | 'timeout' | 'error';
  authCode?: string;
  rrn?: string;
  cardScheme?: string;
  cardLastFour?: string;
  amount?: number;
  currency?: string;
  message?: string;
  provider?: string;
  raw?: any;
}

export interface MobilePrintRequest {
  receiptText: string;
  rawEscPos?: Uint8Array | string;
  cutPaper?: boolean;
  openDrawer?: boolean;
  // Network thermal printer the bridge dials (TCP ip:port). When absent,
  // the Hardware Bridge channel is skipped entirely.
  networkPrinter?: { ip: string; port?: number };
}

export interface MobileTerminalCapabilities {
  isMobileDevice: boolean;
  hasNativeBridge: boolean;
  hasLocalDaemon: boolean;
  hasHardwareBridge: boolean;
  canDirectPay: boolean;
  canDirectPrint: boolean;
  detectedPlatform: 'android_webview' | 'sunmi' | 'pax' | 'imin' | 'local_bridge' | 'browser_web' | 'unknown';
}

// Preset definitions for major payment providers across Egypt, Kuwait, and Saudi Arabia
export const MOBILE_TERMINAL_PRESETS: Record<
  string,
  {
    nameAr: string;
    packageName: string;
    intentAction: string;
    defaultPort: number;
    defaultScheme: string;
  }
> = {
  geidea: {
    nameAr: 'ماكينة جيديا الذكية (Geidea Smart POS)',
    packageName: 'net.geidea.pos',
    intentAction: 'com.geidea.netpos.action.SALE',
    defaultPort: 8080,
    defaultScheme: 'mada',
  },
  knet: {
    nameAr: 'ماكينة كي نت الذكية الكويت (K-NET Smart Terminal)',
    packageName: 'kw.com.knet.pos',
    intentAction: 'kw.com.knet.action.TRANSACTION',
    defaultPort: 8080,
    defaultScheme: 'knet',
  },
  tap_knet: {
    nameAr: 'ماكينة تاب الذكية الكويت والخليج (Tap Payments POS)',
    packageName: 'company.tap.go',
    intentAction: 'company.tap.action.SALE',
    defaultPort: 8080,
    defaultScheme: 'knet',
  },
  myfatoorah: {
    nameAr: 'ماكينة ماي فاتورة الذكية (MyFatoorah POS)',
    packageName: 'com.myfatoorah.pos',
    intentAction: 'com.myfatoorah.pos.SALE',
    defaultPort: 8080,
    defaultScheme: 'knet',
  },
  imin: {
    nameAr: 'أجهزة آي مين الذكية (iMin Smart POS / Swift)',
    packageName: 'kw.com.knet.pos',
    intentAction: 'kw.com.knet.action.TRANSACTION',
    defaultPort: 8080,
    defaultScheme: 'knet',
  },
  fawry: {
    nameAr: 'ماكينة فوري الذكية مصر (Fawry Smart POS)',
    packageName: 'com.fawry.pos',
    intentAction: 'com.fawry.pos.action.PAYMENT',
    defaultPort: 8080,
    defaultScheme: 'meeza',
  },
  paymob: {
    nameAr: 'ماكينة باي موب الذكية (Paymob SoftPOS)',
    packageName: 'com.paymob.smartpos',
    intentAction: 'com.paymob.smartpos.SALE',
    defaultPort: 8080,
    defaultScheme: 'visa',
  },
  sunmi: {
    nameAr: 'أجهزة صن مي الذكية (Sunmi Pay / P2 / P3)',
    packageName: 'com.sunmi.payment',
    intentAction: 'com.sunmi.payment.action.SALE',
    defaultPort: 8080,
    defaultScheme: 'card',
  },
  pax: {
    nameAr: 'أجهزة باكس الذكية (PAX Android Smart Terminal)',
    packageName: 'com.pax.ipp',
    intentAction: 'com.pax.ipp.intent.action.SALE',
    defaultPort: 8080,
    defaultScheme: 'card',
  },
};

export class MobileTerminalBridge {
  private static activeTransactionRef: string | null = null;
  private static pendingResolver: ((res: MobilePaymentResult) => void) | null = null;
  private static callbackRegistered = false;

  /**
   * Register global window callback for Android Native WebView IPC
   */
  public static ensureGlobalCallbackRegistered(): void {
    if (typeof window === 'undefined') return;
    if ((window as any).__onPosPaymentResult && this.callbackRegistered) return;

    (window as any).__onPosPaymentResult = (rawResult: any) => {
      let parsed: any = rawResult;
      if (typeof rawResult === 'string') {
        try {
          parsed = JSON.parse(rawResult);
        } catch {
          parsed = { status: rawResult };
        }
      }

      if (this.pendingResolver) {
        const isApproved =
          parsed.status === 'approved' ||
          parsed.success === true ||
          parsed.responseCode === '00' ||
          parsed.responseCode === '000';

        this.pendingResolver({
          success: isApproved,
          status: isApproved ? 'approved' : parsed.status === 'cancelled' ? 'cancelled' : 'declined',
          authCode: parsed.authCode || parsed.approvalCode || parsed.authorizationCode || undefined,
          rrn: parsed.rrn || parsed.referenceNumber || parsed.retrievalReferenceNumber || undefined,
          cardScheme: parsed.cardScheme || parsed.scheme || parsed.cardType || undefined,
          cardLastFour: parsed.cardLastFour || parsed.last4 || parsed.panLast4 || undefined,
          amount: parsed.amount ? Number(parsed.amount) : undefined,
          currency: parsed.currency || undefined,
          message: parsed.message || (isApproved ? 'تم الدفع بنجاح' : 'تم رفض العملية أو إلغاؤها'),
          raw: parsed,
        });

        this.pendingResolver = null;
        this.activeTransactionRef = null;
      }
    };

    this.callbackRegistered = true;
  }

  /**
   * Inspect current device environment and hardware capabilities
   */
  static async getCapabilities(): Promise<MobileTerminalCapabilities> {
    const isClient = typeof window !== 'undefined';
    const ua = isClient ? navigator.userAgent.toLowerCase() : '';
    const isMobileDevice = /android|iphone|ipad|ipod|mobile/i.test(ua);

    const win = isClient ? (window as any) : {};
    const hasAndroidBridge = Boolean(win.AndroidBridge || win.SmartPos || win.PosBridge);
    const hasSunmiPay = Boolean(win.SunmiPay || win.sunmi);
    const hasPaxBridge = Boolean(win.PaxPos || win.pax);
    const hasIminBridge = Boolean(win.iMinPrinter || win.imin || win.IminPrinter || (isClient && /imin/i.test(ua)));

    let detectedPlatform: MobileTerminalCapabilities['detectedPlatform'] = 'browser_web';
    if (hasSunmiPay) detectedPlatform = 'sunmi';
    else if (hasPaxBridge) detectedPlatform = 'pax';
    else if (hasIminBridge) detectedPlatform = 'imin';
    else if (hasAndroidBridge) detectedPlatform = 'android_webview';

    let hasLocalDaemon = false;
    let hasHardwareBridge = false;

    if (isClient) {
      try {
        hasHardwareBridge = await HardwareBridgeClient.isAvailable();
      } catch {
        hasHardwareBridge = false;
      }

      if (!hasHardwareBridge && isMobileDevice) {
        try {
          const res = await fetch('http://127.0.0.1:8080/health', {
            method: 'GET',
            mode: 'cors',
            signal: AbortSignal.timeout(600),
          });
          hasLocalDaemon = res.ok;
        } catch {
          hasLocalDaemon = false;
        }
      }
    }

    const hasNativeBridge = hasAndroidBridge || hasSunmiPay || hasPaxBridge || hasIminBridge;
    const canDirectPay = hasNativeBridge || hasLocalDaemon || hasHardwareBridge;
    const canDirectPrint = hasNativeBridge || hasLocalDaemon || hasHardwareBridge;

    return {
      isMobileDevice,
      hasNativeBridge,
      hasLocalDaemon,
      hasHardwareBridge,
      canDirectPay,
      canDirectPrint,
      detectedPlatform,
    };
  }

  /**
   * Dispatch payment pulse to handheld Smart POS terminal
   */
  static async requestPayment(request: MobilePaymentRequest): Promise<MobilePaymentResult> {
    this.ensureGlobalCallbackRegistered();

    const refId = request.referenceId || `POS-${Date.now()}`;
    this.activeTransactionRef = refId;

    const win = typeof window !== 'undefined' ? (window as any) : {};
    const timeoutMs = request.config?.timeoutMs || 90_000;

    // 1. Channel A: Native Android Bridge (window.AndroidBridge or window.SmartPos)
    if (win.AndroidBridge?.requestPayment || win.SmartPos?.requestPayment) {
      return new Promise<MobilePaymentResult>((resolve) => {
        this.pendingResolver = resolve;

        const timer = setTimeout(() => {
          if (this.pendingResolver === resolve) {
            this.pendingResolver = null;
            this.activeTransactionRef = null;
            resolve({
              success: false,
              status: 'timeout',
              message: 'انتهت مهلة انتظار تمرير البطاقة على الماكينة (Timeout)',
            });
          }
        }, timeoutMs);

        try {
          const payload = JSON.stringify({
            amount: request.amount,
            currency: request.currency || 'SAR',
            referenceId: refId,
            invoiceNo: request.invoiceNo || refId,
            packageName: request.config?.packageName || (request.config?.provider ? MOBILE_TERMINAL_PRESETS[request.config.provider]?.packageName : undefined),
            intentAction: request.config?.intentAction || (request.config?.provider ? MOBILE_TERMINAL_PRESETS[request.config.provider]?.intentAction : undefined),
          });

          if (win.AndroidBridge?.requestPayment) {
            win.AndroidBridge.requestPayment(payload);
          } else if (win.SmartPos?.requestPayment) {
            win.SmartPos.requestPayment(payload);
          }
        } catch (err: any) {
          clearTimeout(timer);
          this.pendingResolver = null;
          this.activeTransactionRef = null;
          resolve({
            success: false,
            status: 'error',
            message: `فشل استدعاء محرك الدفع الداخلي: ${err?.message || 'خطأ غير معروف'}`,
          });
        }
      });
    }

    // 2. Channel B: Sunmi Dedicated SDK Bridge
    if (win.SunmiPay?.sale) {
      return new Promise<MobilePaymentResult>((resolve) => {
        try {
          win.SunmiPay.sale(
            Math.round(request.amount * 10 ** currencyMoneyDigits(request.currency)), // in minor units (cents / halalas / piastres / fils)
            (res: any) => {
              const approved = res && (res.code === '00' || res.status === 'success');
              resolve({
                success: approved,
                status: approved ? 'approved' : 'declined',
                authCode: res?.authCode,
                rrn: res?.rrn || refId,
                cardScheme: res?.cardScheme || 'card',
                cardLastFour: res?.last4,
                message: approved ? 'تمت العملية بنجاح' : (res?.message || 'تم رفض العملية من البطاقة'),
              });
            }
          );
        } catch (err: any) {
          resolve({
            success: false,
            status: 'error',
            message: `فشل الاتصال بمكتبة Sunmi Pay: ${err?.message}`,
          });
        }
      });
    }

    // 3. Channel C: Device Localhost Daemon (http://127.0.0.1:8080/pay or custom daemon)
    const daemonUrl = request.config?.localDaemonUrl || 'http://127.0.0.1:8080/api/pay';
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(daemonUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: request.amount,
          currency: request.currency,
          referenceId: refId,
          invoiceNo: request.invoiceNo,
          provider: request.config?.provider || 'auto',
        }),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const isApproved = data.status === 'approved' || data.success === true || data.code === '00';
        return {
          success: isApproved,
          status: isApproved ? 'approved' : 'declined',
          authCode: data.authCode || data.approvalCode,
          rrn: data.rrn || refId,
          cardScheme: data.cardScheme || 'card',
          cardLastFour: data.cardLastFour || data.last4,
          message: data.message || (isApproved ? 'تمت الموافقة بنجاح' : 'تم رفض العملية'),
          raw: data,
        };
      }
    } catch {
      // Local daemon unavailable, continue to next fallback
    }

    // 4. Channel D: Z-Systems Local Hardware Bridge (127.0.0.1:18181)
    try {
      const isBridge = await HardwareBridgeClient.isAvailable();
      if (isBridge) {
        const bridgeRes = await HardwareBridgeClient.chargeTerminal({
          ip: '127.0.0.1',
          port: 8080,
          provider: request.config?.provider || 'geidea',
          amount: request.amount,
          currency: request.currency,
          referenceId: refId,
        });

        return {
          success: bridgeRes.status === 'approved',
          status: bridgeRes.status,
          authCode: bridgeRes.authCode,
          rrn: bridgeRes.rrn || refId,
          cardScheme: bridgeRes.cardScheme || 'card',
          cardLastFour: bridgeRes.cardLastFour,
          message: bridgeRes.message,
          raw: bridgeRes,
        };
      }
    } catch {
      // Hardware bridge not active
    }

    // 5. Channel E: Android Web-to-App Intent Trigger (for standalone browsers)
    if (typeof window !== 'undefined' && /android/i.test(navigator.userAgent)) {
      const providerKey = request.config?.provider || 'geidea';
      const preset = MOBILE_TERMINAL_PRESETS[providerKey];
      const pkg = request.config?.packageName || preset?.packageName;
      const action = request.config?.intentAction || preset?.intentAction;

      if (pkg && action) {
        const intentUrl = `intent:#Intent;action=${encodeURIComponent(action)};package=${encodeURIComponent(pkg)};S.amount=${request.amount};S.referenceId=${encodeURIComponent(refId)};end;`;
        
        try {
          window.location.href = intentUrl;
          return {
            success: true,
            status: 'approved',
            rrn: refId,
            message: 'تم فتح تطبيق الدفع على الماكينة. راجع شاشة الدفع.',
          };
        } catch {
          // Intent navigation blocked
        }
      }
    }

    // Fallback: If no direct hardware bridge is present, advise manual confirmation
    return {
      success: false,
      status: 'declined',
      message: 'لم يتم العثور على ماكينة دفع ذكية متصلة بهذا الجهاز. يمكنك إتمام البيع بالوضع اليدوي.',
    };
  }

  /**
   * Cancel active payment transaction
   */
  static async cancelPayment(referenceId?: string): Promise<boolean> {
    const targetRef = referenceId || this.activeTransactionRef;
    if (!targetRef) return true;

    const win = typeof window !== 'undefined' ? (window as any) : {};

    // 1. Native bridge cancel
    if (win.AndroidBridge?.cancelPayment) {
      try {
        win.AndroidBridge.cancelPayment(targetRef);
        return true;
      } catch {
        // ignore
      }
    }

    // 2. Hardware bridge cancel
    try {
      await HardwareBridgeClient.cancelTerminal({
        ip: '127.0.0.1',
        referenceId: targetRef,
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Print receipt directly to the handheld device's built-in thermal printer
   */
  static async printReceipt(request: MobilePrintRequest): Promise<boolean> {
    const win = typeof window !== 'undefined' ? (window as any) : {};

    // 1. Native Android Bridge printer
    if (win.AndroidBridge?.printReceipt) {
      try {
        win.AndroidBridge.printReceipt(request.receiptText);
        return true;
      } catch {
        // ignore
      }
    }

    // 2. Sunmi Printer SDK
    if (win.SunmiPrinter?.printText) {
      try {
        win.SunmiPrinter.printText(request.receiptText);
        if (request.cutPaper !== false && win.SunmiPrinter.cutPaper) {
          win.SunmiPrinter.cutPaper();
        }
        return true;
      } catch {
        // ignore
      }
    }

    // 2.b iMin Built-in Thermal Printer (Swift / M2 / Falcon / D1)
    if (win.iMinPrinter || win.IminPrinter || win.imin) {
      try {
        const imin = win.iMinPrinter || win.IminPrinter || win.imin;
        if (imin.printText) {
          imin.printText(request.receiptText);
        } else if (imin.printString) {
          imin.printString(request.receiptText);
        }
        if (imin.printAndFeedPaper) {
          imin.printAndFeedPaper(50);
        }
        if (request.cutPaper !== false && imin.partialCut) {
          imin.partialCut();
        }
        return true;
      } catch {
        // ignore
      }
    }

    // 3. Localhost Daemon (port 8080 or port 9100)
    try {
      const res = await fetch('http://127.0.0.1:8080/api/printer/print', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ printData: request.receiptText }),
        signal: AbortSignal.timeout(1500),
      });
      if (res.ok) return true;
    } catch {
      // ignore
    }

    // 4. Hardware Bridge print to the configured network thermal printer.
    //    Skipped entirely when no network printer is configured: the bridge
    //    dials a TCP printer at ip:port, and the old hardcoded 127.0.0.1
    //    sent every receipt at a localhost port where no printer exists.
    const networkPrinterIp = String(request.networkPrinter?.ip || '').trim();
    if (networkPrinterIp) {
      try {
        const isBridge = await HardwareBridgeClient.isAvailable();
        if (isBridge) {
          const res = await HardwareBridgeClient.printReceipt({
            ip: networkPrinterIp,
            port: request.networkPrinter?.port,
            rawText: request.receiptText,
            cut: request.cutPaper !== false,
            kickDrawer: request.openDrawer === true,
          });
          return Boolean(res?.success);
        }
      } catch {
        // ignore
      }
    }

    return false;
  }
}
