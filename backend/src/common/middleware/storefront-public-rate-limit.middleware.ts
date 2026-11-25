import { HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Response } from 'express';
import type { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { InMemoryRateLimitService } from '../security/in-memory-rate-limit.service';

// O60: the public storefront write routes had no rate limit at all. One script could create
// thousands of fake orders (each one a WhatsApp notification to the owner and, for dine-in, a kitchen
// ticket), flood product reviews, or brute-force coupon codes through /coupons/validate.
//
// Limits are per client IP and per store. Reads (catalog, product pages) are not limited here.

export interface StorefrontRateRule {
  bucket: string;
  limit: number;
  windowSeconds: number;
}

const RULES: Array<{ method: string; pattern: RegExp; rule: StorefrontRateRule }> = [
  {
    method: 'POST',
    pattern: /^\/api\/storefront\/([^/]+)\/orders$/,
    rule: { bucket: 'order-create', limit: 30, windowSeconds: 600 },
  }, // restaurant guests often share one Wi-Fi IP
  {
    method: 'POST',
    pattern: /^\/api\/storefront\/([^/]+)\/coupons\/validate$/,
    rule: { bucket: 'coupon-validate', limit: 20, windowSeconds: 600 },
  },
  {
    method: 'POST',
    pattern: /^\/api\/storefront\/([^/]+)\/products\/[^/]+\/reviews$/,
    rule: { bucket: 'review', limit: 5, windowSeconds: 3600 },
  },
  {
    method: 'POST',
    pattern: /^\/api\/storefront\/([^/]+)\/abandoned-cart$/,
    rule: { bucket: 'abandoned-cart', limit: 30, windowSeconds: 600 },
  },
  {
    method: 'POST',
    pattern: /^\/api\/storefront\/([^/]+)\/orders\/lookup$/,
    rule: { bucket: 'order-access', limit: 120, windowSeconds: 600 },
  },
  {
    method: 'POST',
    pattern: /^\/api\/storefront\/([^/]+)\/orders\/[^/]+\/(cancel|payment-session|mock-pay)$/,
    rule: { bucket: 'order-access', limit: 120, windowSeconds: 600 },
  },
  {
    method: 'PUT',
    pattern: /^\/api\/storefront\/([^/]+)\/orders\/[^/]+$/,
    rule: { bucket: 'order-access', limit: 120, windowSeconds: 600 },
  },
];

/** Which limit (if any) applies to a public storefront request. Webhooks and admin routes never match. */
export function classifyStorefrontPublicRequest(
  method: string,
  path: string,
): { slug: string; rule: StorefrontRateRule } | null {
  const cleanPath = String(path || '')
    .split('?')[0]
    .replace(/\/+$/, '');
  const upper = String(method || '').toUpperCase();
  if (/^\/api\/storefront\/(admin|webhooks|marketplaces)(\/|$)/.test(cleanPath)) return null;
  for (const entry of RULES) {
    if (entry.method !== upper) continue;
    const m = cleanPath.match(entry.pattern);
    if (m) return { slug: String(m[1] || '').toLowerCase(), rule: entry.rule };
  }
  return null;
}

function isProxyAddress(ip: string): boolean {
  const v = ip.replace(/^::ffff:/, '');
  return (
    v === '127.0.0.1' ||
    v === '::1' ||
    /^10\./.test(v) ||
    /^192\.168\./.test(v) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(v) ||
    /^f[cd][0-9a-f]{2}:/i.test(v)
  );
}

/**
 * The app runs behind nginx (deploy/nginx/gateway.conf sets `X-Real-IP $remote_addr`), and Express is
 * not configured with `trust proxy`, so `req.ip` is nginx's own address for every customer — one bucket
 * for a whole store. X-Real-IP is trusted ONLY when the direct peer is a loopback/private address
 * (i.e. the proxy); a client talking to the app directly cannot forge its way past its own IP.
 */
export function resolveClientIp(directIp: string | undefined, realIpHeader: string | string[] | undefined): string {
  const peer = String(directIp || '').trim() || 'unknown';
  const header = Array.isArray(realIpHeader) ? realIpHeader[0] : realIpHeader;
  const real = String(header || '').trim();
  if (real && isProxyAddress(peer) && /^[0-9a-fA-F.:]{3,45}$/.test(real)) return real;
  return peer;
}

@Injectable()
export class StorefrontPublicRateLimitMiddleware implements NestMiddleware {
  constructor(private readonly rateLimitService: InMemoryRateLimitService) {}

  async use(req: RequestWithAuth, res: Response, next: NextFunction): Promise<void> {
    const match = classifyStorefrontPublicRequest(req.method, String(req.originalUrl || req.url || ''));
    if (!match) {
      next();
      return;
    }

    const ip = resolveClientIp(req.ip || req.socket?.remoteAddress, req.headers['x-real-ip']);
    const { rule, slug } = match;
    const result = await this.rateLimitService.hit(
      `storefront:${rule.bucket}:${slug}:${ip}`,
      rule.limit,
      rule.windowSeconds,
    );

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        'عدد كبير من المحاولات خلال وقت قصير، يرجى المحاولة بعد قليل.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    next();
  }
}
