/**
 * Z-Systems Hardware Bridge Client
 * Communicates with local background service on 127.0.0.1:18181.
 * Enables Cloud SaaS Web POS to communicate directly with local ECR terminals,
 * ESC/POS thermal printers, and cash drawers.
 */

const BRIDGE_BASE_URL = 'http://127.0.0.1:18181';

export interface BridgeHealth {
  status: 'ONLINE' | 'OFFLINE';
  version?: string;
  name?: string;
  uptimeSec?: number;
}

export interface BridgeChargeRequest {
  ip: string;
  port?: number;
  provider?: string;
  amount: number;
  currency?: string;
  referenceId?: string;
  pairingKey?: string;
  terminalTid?: string;
}

export interface BridgeChargeResponse {
  success: boolean;
  status: 'approved' | 'declined' | 'cancelled' | 'error';
  authCode?: string;
  rrn?: string;
  cardScheme?: string;
  cardLastFour?: string;
  amount?: number;
  currency?: string;
  code?: string;
  message?: string;
  raw?: any;
}

export interface BridgeWindowsPrintRequest {
  html: string;
  deviceName?: string;
  pageSize?: 'A4' | 'receipt' | 'auto';
  receiptWidthMm?: number;
}

export interface BridgeWindowsPrintResponse {
  success: boolean;
  printer?: string;
  error?: string;
}

export interface BridgePrinterListResponse {
  success: boolean;
  printers?: string[];
  error?: string;
}

export class HardwareBridgeClient {
  private static cachedOnline: boolean | null = null;
  private static lastCheckTime = 0;
  private static readonly CHECK_INTERVAL_MS = 15_000;

  /**
   * Fast probe to verify if local bridge is running on 127.0.0.1:18181
   */
  static async isAvailable(): Promise<boolean> {
    const now = Date.now();
    if (this.cachedOnline !== null && now - this.lastCheckTime < this.CHECK_INTERVAL_MS) {
      return this.cachedOnline;
    }

    try {
      const res = await fetch(`${BRIDGE_BASE_URL}/health`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: AbortSignal.timeout(3500),
      });
      const data = await res.json();
      const online = res.ok && data?.status === 'ONLINE';
      this.cachedOnline = online;
      this.lastCheckTime = now;
      return online;
    } catch {
      this.cachedOnline = false;
      this.lastCheckTime = now;
      return false;
    }
  }

  /**
   * Sync current tenant & server URL to local bridge so cloud relay automatically connects
   */
  static async syncTenant(tenantId: string, serverUrl?: string): Promise<boolean> {
    if (!tenantId) return false;
    try {
      const res = await fetch(`${BRIDGE_BASE_URL}/api/tenant/sync`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId: String(tenantId).trim(),
          serverUrl: serverUrl || (typeof window !== 'undefined' ? window.location.origin : 'https://app.zsystemai.com'),
        }),
        signal: AbortSignal.timeout(2500),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get health status details
   */
  static async getHealth(): Promise<BridgeHealth> {
    try {
      const res = await fetch(`${BRIDGE_BASE_URL}/health`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const data = await res.json();
        return { status: 'ONLINE', ...data };
      }
      return { status: 'OFFLINE' };
    } catch {
      return { status: 'OFFLINE' };
    }
  }

  /**
   * Dispatch payment charge to local ECR terminal via bridge
   */
  static async chargeTerminal(request: BridgeChargeRequest): Promise<BridgeChargeResponse> {
    const res = await fetch(`${BRIDGE_BASE_URL}/api/ecr/charge`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!res.ok) {
      const errorJson = await res.json().catch(() => ({}));
      throw new Error(errorJson.message || `خطأ استجابة من جسر العتاد (كود ${res.status})`);
    }

    return res.json();
  }

  /**
   * Cancel active terminal charge via bridge
   */
  static async cancelTerminal(request: { ip: string; port?: number; provider?: string; referenceId?: string }): Promise<boolean> {
    try {
      const res = await fetch(`${BRIDGE_BASE_URL}/api/ecr/cancel`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(4000),
      });
      const data = await res.json();
      return Boolean(data.success);
    } catch {
      return false;
    }
  }

  /**
   * Test physical connection to terminal via bridge
   */
  static async testTerminal(request: { ip: string; port?: number; provider?: string }) {
    const res = await fetch(`${BRIDGE_BASE_URL}/api/ecr/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return res.json();
  }

  /**
   * Print raw receipt bytes via bridge to network thermal printer
   */
  static async printReceipt(request: { ip: string; port?: number; rawText?: string; rawBase64?: string; cut?: boolean; kickDrawer?: boolean }) {
    const res = await fetch(`${BRIDGE_BASE_URL}/api/printer/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return res.json();
  }

  /**
   * Kick cash drawer via printer port
   */
  static async kickDrawer(request: { ip: string; port?: number }) {
    const res = await fetch(`${BRIDGE_BASE_URL}/api/printer/kick-drawer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    return res.json();
  }

  /**
   * Silent HTML print on a Windows printer via the local bridge
   * (POST /api/printer/print-windows). Never throws: any failure returns
   * { success: false } so the caller can fall back to the browser dialog.
   * The 65s timeout is longer than the bridge's own print timeout, so the
   * bridge always answers first and a slow print never double-prints.
   */
  static async printWindows(request: BridgeWindowsPrintRequest): Promise<BridgeWindowsPrintResponse> {
    try {
      const res = await fetch(`${BRIDGE_BASE_URL}/api/printer/print-windows`, {
        method: 'POST',
        mode: 'cors',
        credentials: 'omit',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(65000),
      });
      const data = await res.json().catch(() => ({}));
      return { success: Boolean(res.ok && data?.success), printer: data?.printer, error: data?.error };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'تعذر الوصول إلى الجسر المحلي' };
    }
  }

  /**
   * List the Windows printers installed on the bridge PC
   * (GET /api/printer/list). Never throws: any failure returns
   * { success: false } so the caller can offer free-text input instead.
   */
  static async listPrinters(): Promise<BridgePrinterListResponse> {
    try {
      const res = await fetch(`${BRIDGE_BASE_URL}/api/printer/list`, {
        method: 'GET',
        mode: 'cors',
        credentials: 'omit',
        signal: AbortSignal.timeout(5000),
      });
      const data = await res.json().catch(() => ({}));
      return {
        success: Boolean(res.ok && data?.success),
        printers: Array.isArray(data?.printers) ? data.printers : undefined,
        error: data?.error,
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : 'تعذر الوصول إلى الجسر المحلي' };
    }
  }
}
