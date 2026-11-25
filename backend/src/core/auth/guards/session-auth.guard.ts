import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { SessionService } from '../../../core/auth/services/session.service';
import { RequestWithAuth } from '../../../core/auth/interfaces/request-with-auth.interface';
import { CSRF_HEADER_NAME, verifyCsrfToken } from '../utils/csrf-token';
import { clearKnownAuthCookies, isLocalAuthCookieHost } from '../utils/auth-cookie-cleanup';
import { isDesktopRuntimeMode } from '../../../config/app-mode';

function parseCookie(request: RequestWithAuth, name: string): string {
  const cookieHeader = request.headers.cookie;
  if (typeof cookieHeader !== 'string') {
    return '';
  }

  const parts = cookieHeader.split(';').map((part) => part.trim());
  const pair = parts.find((part) => part.startsWith(`${name}=`));
  if (!pair) return '';
  try {
    return decodeURIComponent(pair.slice(`${name}=`.length));
  } catch {
    return ''; // Malformed user-supplied cookie must never turn a 401 into a 500.
  }
}

function readSessionId(request: RequestWithAuth, allowHeaderAuth: boolean, cookieName: string): string {
  // 1. Authorization: Bearer <sessionId>
  const authHeader = request.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.toLowerCase().startsWith('bearer ')) {
    const candidate = authHeader.slice(7).trim();
    if (candidate) return candidate;
  }

  // 2. x-session-id header
  if (allowHeaderAuth) {
    const headerValue = request.headers['x-session-id'];
    if (typeof headerValue === 'string' && headerValue.trim()) {
      return headerValue.trim();
    }
  }

  // Query-string session ids are NEVER accepted: a session id in a URL leaks
  // into server/proxy logs, browser history, and Referer headers. Cookie
  // (and Bearer / x-session-id header where allowed) only.
  return parseCookie(request, cookieName);
}

function readHeaderValue(value: string | string[] | undefined): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0].trim() : '';
  return '';
}

function isUnsafeHttpMethod(method: string | undefined): boolean {
  return ['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase());
}

function assertTenantScopeHeadersMatchAuth(
  request: RequestWithAuth,
  auth: { tenantId?: string; accountId?: string },
): void {
  const headerTenantId = readHeaderValue(request.headers['x-tenant-id']);
  const headerAccountId = readHeaderValue(request.headers['x-account-id']);

  if (headerTenantId && headerTenantId !== String(auth.tenantId || '').trim()) {
    throw new ForbiddenException('Tenant scope mismatch');
  }

  if (headerAccountId && headerAccountId !== String(auth.accountId || '').trim()) {
    throw new ForbiddenException('Account scope mismatch');
  }
}

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  private allowSessionIdHeaderFallback(): boolean {
    // A single unsafe development flag must never re-enable CSRF-free header
    // sessions on Cloud, including a Cloud deployment running NODE_ENV=development.
    const appMode =
      this.configService.get<string>('app.mode') ||
      this.configService.get<string>('APP_MODE') ||
      process.env.APP_MODE ||
      'CLOUD_SAAS';
    if (!isDesktopRuntimeMode(appMode)) return false;
    const configured = this.configService.get('ALLOW_SESSION_ID_HEADER');
    if (String(configured).toLowerCase() === 'false') return false;
    if (String(configured).toLowerCase() === 'true') return true;
    return true; // Explicitly supported local runtimes retain legacy hardware clients.
  }

  private clearAuthCookies(response: Response, request?: RequestWithAuth): void {
    const isLoopback = isLocalAuthCookieHost(
      this.configService.get('APP_MODE') || process.env.APP_MODE,
      request?.headers['x-forwarded-host'] || request?.headers.host,
    );
    clearKnownAuthCookies(response, {
      sessionCookieName: this.configService.get<string>('SESSION_COOKIE_NAME')?.trim() || 'session_id',
      csrfCookieName: this.configService.get<string>('SESSION_CSRF_COOKIE_NAME')?.trim() || 'csrf_token',
      sameSite: this.configService.get<'lax' | 'strict' | 'none'>('SESSION_COOKIE_SAME_SITE') ?? 'lax',
      secure: isLoopback ? false : this.configService.get<boolean>('SESSION_COOKIE_SECURE') === true,
      domain: isLoopback ? undefined : this.configService.get<string>('SESSION_COOKIE_DOMAIN')?.trim() || undefined,
    });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithAuth>();
    const response = context.switchToHttp().getResponse<Response>();
    const allowHeaderAuth = this.allowSessionIdHeaderFallback();
    const sessionCookieName = this.configService.get<string>('SESSION_COOKIE_NAME')?.trim() || 'session_id';
    const csrfCookieName = this.configService.get<string>('SESSION_CSRF_COOKIE_NAME')?.trim() || 'csrf_token';
    const sessionId = readSessionId(request, allowHeaderAuth, sessionCookieName);

    if (!sessionId) {
      this.clearAuthCookies(response, request);
      throw new UnauthorizedException('Unauthorized');
    }

    const auth = await this.sessionService.resolveAuthContext(sessionId);
    if (!auth) {
      this.clearAuthCookies(response, request);
      throw new UnauthorizedException('Unauthorized');
    }

    assertTenantScopeHeadersMatchAuth(request, auth);

    if (isUnsafeHttpMethod(request.method)) {
      const csrfSecret = this.configService.get<string>('SESSION_CSRF_SECRET') || '';
      const csrfCookie = parseCookie(request, csrfCookieName);
      const csrfHeader = readHeaderValue(request.headers[CSRF_HEADER_NAME]);
      const usingHeaderFallback =
        (allowHeaderAuth && readHeaderValue(request.headers['x-session-id']) === sessionId) ||
        readHeaderValue(request.headers['authorization']).toLowerCase().startsWith('bearer ');

      if (
        !usingHeaderFallback &&
        (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader || !verifyCsrfToken(sessionId, csrfSecret, csrfHeader))
      ) {
        this.clearAuthCookies(response, request);
        throw new ForbiddenException('CSRF validation failed');
      }
    }

    request.authContext = auth;
    return true;
  }
}
