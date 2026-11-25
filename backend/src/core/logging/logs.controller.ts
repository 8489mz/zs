import { Controller, Post, Body, Req, HttpException, HttpStatus, BadRequestException } from '@nestjs/common';
import { LoggerService } from './logger.service';
import { InMemoryRateLimitService } from '../../common/security/in-memory-rate-limit.service';

const MAX_FRONTEND_ERROR_BYTES = 10 * 1024;

@Controller(['api/logs', 'api/v1/logs'])
export class LogsController {
  constructor(
    private readonly logger: LoggerService,
    private readonly rateLimit: InMemoryRateLimitService,
  ) {}

  @Post('frontend-error')
  async logFrontendError(@Body() payload: unknown, @Req() req: { ip?: string }): Promise<{ ok: true }> {
    const clientIp = String(req?.ip || 'unknown');
    const rate = await this.rateLimit.hit(`frontend-error:${clientIp}`, 10, 60);
    if (!rate.allowed) {
      throw new HttpException('Too many frontend error reports', HttpStatus.TOO_MANY_REQUESTS);
    }
    const serialized = JSON.stringify(payload);
    if (typeof serialized !== 'string' || Buffer.byteLength(serialized, 'utf8') > MAX_FRONTEND_ERROR_BYTES) {
      throw new BadRequestException('Frontend error payload is too large or invalid');
    }
    this.logger.error({ source: 'frontend', ip: clientIp, payload }, 'Frontend Error Logged');
    return { ok: true };
  }
}
