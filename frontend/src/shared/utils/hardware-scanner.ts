/**
 * Hardware Barcode Scanner & POS Terminal Utilities
 * 
 * Provides unified detection and bridge listeners for dedicated hardware POS terminals
 * (e.g., Sunmi V2 Pro, Sunmi T2, iMin, Telpo, Android POS terminals with laser/imager heads).
 * 
 * Invariant: Regular smartphones (iOS / Android in browser) use the camera engine (ZXing/WebRTC).
 * POS terminals equipped with hardware scanner heads use instant hardware capture (0ms)
 * without triggering camera permission dialogs.
 */

export function isSunmiDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Android POS Lite / Sunmi bridge injected objects
  if ((window as any).__sunmi_hooked || (window as any).SunmiPrinter || (window as any).SunmiScanner) {
    return true;
  }

  // 2. User Agent signature checks
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/SUNMI|V2_PRO|V2-PRO|T2_MINI|T2-MINI|K2|D2|V2s|V2_s/i.test(ua)) {
      return true;
    }
  }

  return false;
}

export function isHardwareScannerDevice(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Sunmi family check
  if (isSunmiDevice()) return true;

  // 2. Generic Android POS or custom native bridge
  if ((window as any).AndroidPOS || (window as any).AndroidBridge || (window as any).HardwareScannerBridge) {
    return true;
  }

  // 3. User-Agent signatures for other POS hardware terminals
  if (typeof navigator !== 'undefined') {
    const ua = navigator.userAgent || '';
    if (/POS-?58|POS-?80|iMin|Telpo|PAX|Clover|Verifone|Handheld|Urovo/i.test(ua)) {
      return true;
    }
  }

  // 4. Local storage explicit preference (e.g. cashier toggle)
  try {
    if (window.localStorage?.getItem('pos_hardware_scanner_mode') === 'true') {
      return true;
    }
  } catch {}

  return false;
}

/**
 * Triggers hardware scanning if an explicit JS bridge is available.
 * Returns true if an active bridge handled the trigger, false otherwise.
 */
export function triggerHardwareScan(): boolean {
  if (typeof window === 'undefined') return false;

  // 1. Sunmi scanner bridge
  const win = window as any;
  if (typeof win.SunmiScanner?.scan === 'function') {
    try {
      win.SunmiScanner.scan();
      return true;
    } catch {
      // ignore bridge failure
    }
  }

  // 2. Generic Android bridge
  if (typeof win.AndroidPOS?.triggerScan === 'function') {
    try {
      win.AndroidPOS.triggerScan();
      return true;
    } catch {
      // ignore bridge failure
    }
  }

  return false;
}

/**
 * Subscribes to hardware barcode scan events dispatched by native wrappers,
 * Sunmi Intent broadcasts, or custom WebViews.
 */
export function listenToHardwareBarcode(callback: (barcode: string) => void): () => void {
  if (typeof window === 'undefined') return () => {};

  const handler = (scannedCode: unknown) => {
    const code = String(scannedCode ?? '').trim();
    if (code) {
      callback(code);
    }
  };

  const win = window as any;
  win.onHardwareBarcodeScanned = handler;
  win.onBarcodeScanned = handler;

  const eventListener = (event: Event) => {
    const custom = event as CustomEvent<{ barcode?: string }>;
    if (custom.detail?.barcode) {
      handler(custom.detail.barcode);
    }
  };

  window.addEventListener('hardware-barcode-scan', eventListener);

  return () => {
    if (win.onHardwareBarcodeScanned === handler) {
      delete win.onHardwareBarcodeScanned;
    }
    if (win.onBarcodeScanned === handler) {
      delete win.onBarcodeScanned;
    }
    window.removeEventListener('hardware-barcode-scan', eventListener);
  };
}
