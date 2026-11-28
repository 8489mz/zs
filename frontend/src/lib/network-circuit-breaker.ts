export const APP_NETWORK_STATE_EVENT = 'zsystems:network-state';

const HEALTH_PROBE_PATH = '/api/health/live';
const HEALTH_PROBE_INTERVAL_MS = 15_000;
const HEALTH_PROBE_TIMEOUT_MS = 2_500;

let circuitOpen = false;
let lastFailureAt = 0;
let probeTimer: ReturnType<typeof setInterval> | null = null;
let probeInFlight: Promise<boolean> | null = null;
let listenersAttached = false;

function resolveHealthUrl(): string {
  if (typeof window === 'undefined') return HEALTH_PROBE_PATH;
  const electronBase = (window as unknown as { electronRuntime?: { config?: { apiBaseUrl?: string } } })
    .electronRuntime?.config?.apiBaseUrl;
  if (electronBase) {
    return `${electronBase.replace(/\/$/, '')}${HEALTH_PROBE_PATH}`;
  }
  const rawBase = (import.meta as unknown as { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL?.trim();
  if (rawBase) {
    return `${rawBase.replace(/\/$/, '')}${HEALTH_PROBE_PATH}`;
  }
  if (window.location.protocol === 'file:') {
    return `http://127.0.0.1:3001${HEALTH_PROBE_PATH}`;
  }
  if (window.location.port === '5173') {
    return `${window.location.protocol}//${window.location.hostname}:3101${HEALTH_PROBE_PATH}`;
  }
  return HEALTH_PROBE_PATH;
}

function emitNetworkState(online: boolean, source: string) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(APP_NETWORK_STATE_EVENT, { detail: { online, source } }));
}

function stopHealthProbeLoop() {
  if (probeTimer !== null) {
    clearInterval(probeTimer);
    probeTimer = null;
  }
}

function ensureHealthProbeLoop() {
  if (typeof window === 'undefined' || probeTimer !== null) return;
  probeTimer = setInterval(() => {
    if (typeof document !== 'undefined' && document.hidden) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    void probeServerReachability();
  }, HEALTH_PROBE_INTERVAL_MS);
}

function ensureGlobalListeners() {
  if (typeof window === 'undefined' || listenersAttached) return;
  listenersAttached = true;

  window.addEventListener('offline', () => {
    markNetworkFailure('navigator_offline');
  });

  window.addEventListener('online', () => {
    void probeServerReachability();
  });

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && circuitOpen) {
        void probeServerReachability();
      }
    });
  }
}

/**
 * Returns true when the browser is strictly offline OR when a recent network/ISP
 * failure tripped the circuit breaker (e.g. Wi-Fi connected to router while WAN/DSL is down).
 */
export function isFastOfflineMode(): boolean {
  ensureGlobalListeners();
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return true;
  }
  return circuitOpen;
}

export function getNetworkCircuitState() {
  return {
    offline: isFastOfflineMode(),
    circuitOpen,
    lastFailureAt,
  };
}

export function markNetworkFailure(source = 'http_error'): void {
  ensureGlobalListeners();
  const wasOpen = circuitOpen;
  circuitOpen = true;
  lastFailureAt = Date.now();
  ensureHealthProbeLoop();
  if (!wasOpen) {
    emitNetworkState(false, source);
  }
}

export function markNetworkSuccess(source = 'http_ok'): void {
  ensureGlobalListeners();
  const wasOpen = circuitOpen;
  circuitOpen = false;
  stopHealthProbeLoop();
  if (wasOpen) {
    emitNetworkState(true, source);
  }
}

export function resetNetworkCircuitBreakerForTests(): void {
  circuitOpen = false;
  lastFailureAt = 0;
  probeInFlight = null;
  stopHealthProbeLoop();
}

export async function probeServerReachability(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return true;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    markNetworkFailure('navigator_offline');
    return false;
  }
  if (probeInFlight) return probeInFlight;

  probeInFlight = (async () => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), HEALTH_PROBE_TIMEOUT_MS);
    try {
      const response = await fetch(resolveHealthUrl(), {
        method: 'GET',
        cache: 'no-store',
        credentials: 'include',
        signal: controller.signal,
      });
      if (response.ok || response.status === 401 || response.status === 403) {
        markNetworkSuccess('health_probe');
        return true;
      }
      if (response.status === 502 || response.status === 503 || response.status === 504) {
        markNetworkFailure('health_probe_5xx');
        return false;
      }
      return !circuitOpen;
    } catch {
      markNetworkFailure('health_probe_failed');
      return false;
    } finally {
      window.clearTimeout(timer);
      probeInFlight = null;
    }
  })();

  return probeInFlight;
}
