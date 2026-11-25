import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { InMemoryRateLimitService } from '../../common/security/in-memory-rate-limit.service';
import { resolveClientIp } from '../../common/middleware/storefront-public-rate-limit.middleware';

/** Uploads per client IP per hour. A desktop client sends at most a few bundles a day. */
export const DIAGNOSTICS_UPLOADS_PER_HOUR = 6;

/**
 * O36: the diagnostics upload is public by design (offline desktop clients have no cloud session).
 * A guard runs before FileInterceptor, so a rate-limited caller is refused before up to 30 MB of body
 * is buffered into memory.
 */
@Injectable()
export class DiagnosticsUploadRateLimitGuard implements CanActivate {
  constructor(private readonly rateLimit: InMemoryRateLimitService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const ip = resolveClientIp(req.ip || req.socket?.remoteAddress, req.headers?.['x-real-ip']);
    const result = await this.rateLimit.hit(`diagnostics-upload:${ip}`, DIAGNOSTICS_UPLOADS_PER_HOUR, 3600);
    if (!result.allowed) {
      context.switchToHttp().getResponse().setHeader?.('Retry-After', String(result.retryAfterSeconds));
      throw new HttpException(
        'تم تجاوز عدد مرات رفع ملفات التشخيص، يرجى المحاولة لاحقاً.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }
}
