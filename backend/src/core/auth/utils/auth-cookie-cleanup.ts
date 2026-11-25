import type { Response } from 'express';
import { isDesktopRuntimeMode } from '../../../config/app-mode';

/**
 * Never let a client-supplied Host/X-Forwarded-Host disable the Secure attribute
 * for Cloud SaaS cookies. Plain HTTP loopback is a desktop-only exception.
 */
export function isLocalAuthCookieHost(appMode: unknown, hostHeader: unknown): boolean {
  if (!isDesktopRuntimeMode(appMode)) return false;
  const host = String(hostHeader || '')
    .split(',')[0]
    .trim()
    .toLowerCase()
    .split(':')[0];
  return (
    ['localhost', '127.0.0.1', '0.0.0.0'].includes(host) ||
    String(hostHeader || '')
      .trim()
      .toLowerCase()
      .startsWith('[::1]')
  );
}

type CookieSameSite = 'lax' | 'strict' | 'none';

export const LEGACY_AUTH_COOKIE_NAMES = [
  'session_id',
  'csrf_token',
  'zs_session',
  'zs_csrf_token',
  'zs_dev_session',
  'zs_dev_csrf_token',
] as const;

export type AuthCookieCleanupConfig = {
  sessionCookieName?: string;
  csrfCookieName?: string;
  sameSite?: CookieSameSite;
  secure?: boolean;
  domain?: string;
};

function uniqueCookieNames(config: AuthCookieCleanupConfig): string[] {
  const names = new Set<string>(LEGACY_AUTH_COOKIE_NAMES);
  const sessionCookieName = String(config.sessionCookieName || '').trim();
  const csrfCookieName = String(config.csrfCookieName || '').trim();
  if (sessionCookieName) names.add(sessionCookieName);
  if (csrfCookieName) names.add(csrfCookieName);
  return [...names];
}

export function clearKnownAuthCookies(res: Response, config: AuthCookieCleanupConfig): void {
  const sameSite = config.sameSite ?? 'lax';
  const secure = config.secure === true;
  const domain = String(config.domain || '').trim() || undefined;
  const cookieOptions = {
    httpOnly: true,
    sameSite,
    secure,
    path: '/',
    ...(domain ? { domain } : {}),
  };
  const csrfCookieOptions = {
    ...cookieOptions,
    httpOnly: false,
  };

  for (const name of uniqueCookieNames(config)) {
    const normalized = name.toLowerCase();
    const isCsrfCookie = normalized.includes('csrf');
    res.clearCookie(name, isCsrfCookie ? csrfCookieOptions : cookieOptions);
  }
}
