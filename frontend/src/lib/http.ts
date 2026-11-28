import { getFriendlyApiErrorMessage } from '@/lib/api-error-message';
import {
  APP_NETWORK_STATE_EVENT,
  markNetworkFailure,
  markNetworkSuccess,
} from '@/lib/network-circuit-breaker';

export { APP_NETWORK_STATE_EVENT };
export class ApiError extends Error {
  status: number;
  code?: string;
  details?: unknown;

  constructor(message: string, status: number, options?: { code?: string; details?: unknown }) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = options?.code;
    this.details = options?.details;
  }
}

export const APP_UNAUTHORIZED_EVENT = 'zsystems:unauthorized';
const REQUEST_TIMEOUT_MS = 30_000;
const LOCAL_SESSION_STORAGE_KEY = 'zs.localSessionId';
export const AUTH_STATE_VERSION_KEY = 'zs.authStateVersion';
export const AUTH_STATE_VERSION = '2';
let unauthorizedRecoveryDispatched = false;

export interface HttpRequestInit extends RequestInit {
  timeoutMs?: number;
  skipUnauthorizedInterceptor?: boolean;
  treatTimeoutAsOffline?: boolean;
}
const RAW_API_BASE = import.meta.env?.VITE_API_BASE_URL?.trim();
const CSRF_COOKIE_NAME = import.meta.env?.VITE_CSRF_COOKIE_NAME?.trim() || 'csrf_token';
const CSRF_HEADER_NAME = 'x-csrf-token';

export function setLocalSessionFallback(sessionId: string | null | undefined): void {
  if (typeof window === 'undefined') return;
  const value = typeof sessionId === 'string' ? sessionId.trim() : '';
  if (value) {
    window.localStorage.setItem(LOCAL_SESSION_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(LOCAL_SESSION_STORAGE_KEY);
  }
}

export function clearLocalSessionFallback(): void {
  setLocalSessionFallback(null);
}

function getLocalSessionFallback(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(LOCAL_SESSION_STORAGE_KEY)?.trim() || '';
}

export function normalizeApiBaseUrl(
  value?: string,
  locationInfo?: { port: string; protocol: string; hostname: string },
) {
  if (typeof window !== 'undefined' && (window as any).electronRuntime?.config?.apiBaseUrl) {
    return (window as any).electronRuntime.config.apiBaseUrl;
  }

  const normalized = value?.replace(/\/$/, '') || '';
  const runtimeLocation = locationInfo
    ?? (typeof window !== 'undefined'
      ? {
        port: window.location.port,
        protocol: window.location.protocol,
        hostname: window.location.hostname,
      }
      : null);

  if (!runtimeLocation) return normalized;

  const isDevServer = runtimeLocation.port === '5173';
  const isPortableStaticServer = runtimeLocation.port === '8080';
  const isLoopbackRuntime = ['127.0.0.1', 'localhost'].includes(runtimeLocation.hostname);
  let configuredUrl: URL | null = null;
  if (normalized) {
    try {
      const baseOrigin = runtimeLocation.protocol && runtimeLocation.hostname
        ? `${runtimeLocation.protocol}//${runtimeLocation.hostname}`
        : 'http://localhost';
      configuredUrl = new URL(normalized, baseOrigin);
    } catch {
      configuredUrl = null;
    }
  }
  const configuredIsLoopbackApi = Boolean(
    configuredUrl
    && ['127.0.0.1', 'localhost'].includes(configuredUrl.hostname)
    && configuredUrl.port === '3001',
  );

  if (isPortableStaticServer && isLoopbackRuntime && configuredIsLoopbackApi) return '';
  if (normalized) return normalized;

  // If running via Electron's file:// protocol, the backend should be running locally on 3001
  if (runtimeLocation.protocol === 'file:') {
    return 'http://127.0.0.1:3001';
  }

  if (isDevServer) {
    return `${runtimeLocation.protocol}//${runtimeLocation.hostname}:3101`;
  }

  return '';
}


const API_BASE_URL = normalizeApiBaseUrl(RAW_API_BASE);

function emitWindowEvent<T>(name: string, detail: T) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function clearClientAuthStorage(): void {
  if (typeof window === 'undefined') return;
  clearLocalSessionFallback();
}

export function ensureAuthStateVersion(): void {
  if (typeof window === 'undefined') return;
  const current = window.localStorage.getItem(AUTH_STATE_VERSION_KEY);
  if (current !== AUTH_STATE_VERSION) {
    clearClientAuthStorage();
    window.localStorage.setItem(AUTH_STATE_VERSION_KEY, AUTH_STATE_VERSION);
  }
}

export function resetUnauthorizedRecoverySignal(): void {
  unauthorizedRecoveryDispatched = false;
}

function extractCode(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const candidate = payload as {
    code?: unknown;
    error?: unknown;
    details?: unknown;
  };

  if (typeof candidate.code === 'string' && candidate.code.trim()) {
    return candidate.code.trim();
  }

  if (candidate.error && typeof candidate.error === 'object') {
    const nested = extractCode(candidate.error);
    if (nested) return nested;
  }

  if (candidate.details && typeof candidate.details === 'object') {
    const nested = extractCode(candidate.details);
    if (nested) return nested;
  }

  return undefined;
}

function buildErrorMessage(payload: unknown, fallback: string) {
  return getFriendlyApiErrorMessage(payload, fallback);
}

function withTimeout(init?: HttpRequestInit) {
  const controller = new AbortController();
  const timeoutMs = init?.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);

  if (init?.signal) {
    if (init.signal.aborted) {
      controller.abort();
    } else {
      init.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  return {
    signal: controller.signal,
    clear: () => window.clearTimeout(timeoutId)
  };
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;

  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(prefix)) {
      return decodeURIComponent(trimmed.slice(prefix.length));
    }
  }

  return null;
}

function isUnsafeMethod(method: string | undefined): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || 'GET').toUpperCase());
}

function buildHeaders(init?: HttpRequestInit): Headers {
  const headers = new Headers(init?.headers || {});

  if (!headers.has('Content-Type') && init?.body != null && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }

  const localSessionId = getLocalSessionFallback();
  if (localSessionId && !headers.has('x-session-id')) {
    headers.set('x-session-id', localSessionId);
  }

  if (isUnsafeMethod(init?.method)) {
    const csrfToken = readCookie(CSRF_COOKIE_NAME);
    if (csrfToken && !headers.has(CSRF_HEADER_NAME)) {
      headers.set(CSRF_HEADER_NAME, csrfToken);
    }
  }

  return headers;
}

export function resolveRequestUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  if (!API_BASE_URL) return path;
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export async function http<T>(path: string, init?: HttpRequestInit): Promise<T> {
  const { signal, clear } = withTimeout(init);

  try {
    const { headers: _overrideHeaders, ...restInit } = init || {};
    const response = await fetch(resolveRequestUrl(path), {
      credentials: 'include',
      ...restInit,
      headers: buildHeaders(init),
      signal
    });

    if (response.status === 502 || response.status === 503 || response.status === 504) {
      markNetworkFailure(`http_${response.status}`);
    } else {
      markNetworkSuccess('http_response');
    }

    if (response.status === 204) {
      return null as T;
    }

    const contentType = response.headers.get('content-type') || '';
    const rawPayload = await response.text();

    let payload: unknown = rawPayload;
    if (contentType.includes('application/json')) {
      try {
        payload = rawPayload ? JSON.parse(rawPayload) : null;
      } catch {
        payload = rawPayload;
      }
    }

    if (!response.ok) {
      if (response.status === 401) {
        clearClientAuthStorage();
        if (!unauthorizedRecoveryDispatched && !init?.skipUnauthorizedInterceptor) {
          unauthorizedRecoveryDispatched = true;
          emitWindowEvent(APP_UNAUTHORIZED_EVENT, {
            path,
            status: response.status,
            message: 'تم تحديث الجلسة. من فضلك سجّل الدخول مرة أخرى.',
          });
        }
      }

      throw new ApiError(
        buildErrorMessage(payload, 'تعذر تنفيذ العملية المطلوبة.'),
        response.status,
        { code: extractCode(payload), details: payload }
      );
    }

    return payload as T;
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }

    if (error instanceof DOMException && error.name === 'AbortError') {
      if (init?.treatTimeoutAsOffline) {
        markNetworkFailure('http_timeout');
      }
      throw new ApiError('انتهت مهلة الطلب. حاول مرة أخرى.', 408, { code: 'timeout' });
    }

    markNetworkFailure('http_network_error', { silent: true });
    emitWindowEvent(APP_NETWORK_STATE_EVENT, { online: false, path, source: 'http_network_error' });
    throw new ApiError('تعذر الاتصال بالخادم. تحقق من الشبكة ثم أعد المحاولة.', 0, { code: 'network_error', details: error });
  } finally {
    clear();
  }
}
