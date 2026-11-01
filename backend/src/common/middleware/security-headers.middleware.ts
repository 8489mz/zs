import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { isPublicApiPath } from '../utils/public-cors-origin.util';

@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  use(request: Request, response: Response, next: NextFunction): void {
    const forwardedProtoHeader = request.headers['x-forwarded-proto'];
    const forwardedProto = typeof forwardedProtoHeader === 'string'
      ? forwardedProtoHeader.split(',')[0]?.trim().toLowerCase()
      : '';
    const isSecureRequest = request.secure || forwardedProto === 'https';

    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    // Public API responses are read cross-origin by the marketing site
    // under the CORS policy in main.ts; CORP same-origin would block that
    // read even when CORS allows it, so these paths answer cross-origin
    // (the storefront media precedent). Every other route keeps
    // same-origin. request.path is the pathname without query string.
    response.setHeader(
      'Cross-Origin-Resource-Policy',
      isPublicApiPath(request.path) ? 'cross-origin' : 'same-origin',
    );
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    response.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    response.setHeader('Origin-Agent-Cluster', '?1');

    if (isSecureRequest) {
      response.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
    }

    response.removeHeader('X-Powered-By');
    next();
  }
}
