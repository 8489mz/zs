import { HttpException, HttpStatus, Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Response } from 'express';
import type { RequestWithAuth } from '../../core/auth/interfaces/request-with-auth.interface';
import { InMemoryRateLimitService } from '../security/in-memory-rate-limit.service';
import { resolveClientIp } from './storefront-public-rate-limit.middleware';
import { isDesktopRuntimeMode } from '../../config/app-mode';

/**
 * S4 (INV-SESSION-GLOBAL-RATE-LIMIT): the outer request budget every route was
 * missing. Before S4 only four scoped mechanisms existed (login 10/600s, auth
 * burst 60/60s, storefront buckets, table-call guard), so an unbounded flood on
 * any unscoped route was never refused. This is an additional layer, never a
 * replacement: the scoped limits keep their own thresholds.
 *
 * Budget (parent decision D4): 600 requests / 60 s per client IP, env-configurable
 * (GLOBAL_RATE_LIMIT_MAX / GLOBAL_RATE_LIMIT_WINDOW_SECONDS), disabled in desktop
 * mode like the login limiter. The budget was validated against the busiest
 * legitimate flows at the S4 base (see lint-prettier-log.md S4): no polling in
 * the frontend, sequential 1,000-row import chunks, one POS lookup per scan —
 * the realistic worst case (10 cashiers behind one NAT) is ~300 req/min, 2x
 * headroom under the budget.
 *
 * The IP is resolved exactly like the login limiter (O72): `req.ip` alone is
 * nginx's own address behind the proxy, so X-Real-IP is trusted only when the
 * direct peer is a loopback/private address.
 */
@Injectable()
export class GlobalRateLimitMiddleware implements NestMiddleware {
  constructor(
    private readonly configService: ConfigService,
    private readonly rateLimitService: InMemoryRateLimitService,
  ) {}

  async use(req: RequestWithAuth, res: Response, next: NextFunction): Promise<void> {
    // Untrusted or conflicting flags can never disable Cloud protection.
    const appMode = this.configService.get<string>('APP_MODE') || process.env.APP_MODE;
    if (isDesktopRuntimeMode(appMode)) {
      return next();
    }

    const ip = resolveClientIp(req.ip || req.socket?.remoteAddress, req.headers?.['x-real-ip']);
    const limit = this.configService.get<number>('GLOBAL_RATE_LIMIT_MAX') ?? 600;
    const windowSeconds = this.configService.get<number>('GLOBAL_RATE_LIMIT_WINDOW_SECONDS') ?? 60;

    const result = await this.rateLimitService.hit(`global:ip:${ip}`, limit, windowSeconds);

    res.setHeader('X-RateLimit-Limit', String(result.limit));
    res.setHeader('X-RateLimit-Remaining', String(result.remaining));
    if (result.resetAt) {
      res.setHeader('X-RateLimit-Reset', String(Math.ceil(result.resetAt / 1000)));
    }

    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException('Too many requests. Please try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    next();
  }
}
