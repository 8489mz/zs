import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InMemoryRateLimitService } from '../../../common/security/in-memory-rate-limit.service';
import { resolveClientIp } from '../../../common/middleware/storefront-public-rate-limit.middleware';

/**
 * INV-TABLE-CALL-SLUG-TENANT: abuse bound for the unauthenticated
 * table-call write. Restaurant guests often share one Wi-Fi IP, so the
 * bound mirrors the public storefront order-create rule: 30 calls per
 * 10 minutes per client IP per storefront slug. The guard runs before
 * the handler resolves the slug, so abusive callers are refused
 * without a database lookup. Staff-session calls share the same bound;
 * a waiter bell is a low-frequency action for staff too.
 */
export const TABLE_CALLS_PER_WINDOW = 30;
export const TABLE_CALL_WINDOW_SECONDS = 600;

@Injectable()
export class TableCallRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: InMemoryRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = resolveClientIp(req.ip || req.socket?.remoteAddress, req.headers?.['x-real-ip']);
    const slug = String(req.query?.slug || req.body?.slug || 'unknown').trim().toLowerCase() || 'unknown';
    const result = await this.rateLimit.hit(`table-call:${ip}:${slug}`, TABLE_CALLS_PER_WINDOW, TABLE_CALL_WINDOW_SECONDS);
    if (!result.allowed) {
      context.switchToHttp().getResponse().setHeader?.('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException('تم تجاوز عدد مرات نداء الطاولة المسموح، يرجى المحاولة لاحقاً.', HttpStatus.TOO_MANY_REQUESTS);
    }
    return true;
  }
}
