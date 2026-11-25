import { ArgumentsHost, Catch, ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { mapToHttpException } from '../mappers/error.mapper';
import { LoggerService } from '../../core/logging/logger.service';
import * as Sentry from '@sentry/node';

@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  private sanitizeError(exception: unknown): Record<string, unknown> {
    const candidate = (exception ?? {}) as Record<string, unknown>;
    const stack = typeof candidate.stack === 'string' ? candidate.stack : '';
    const stackFirstLine = stack ? stack.split('\n')[0]?.trim() : undefined;

    return {
      name: typeof candidate.name === 'string' ? candidate.name : 'Error',
      message: typeof candidate.message === 'string' ? candidate.message : 'Unknown error',
      code: typeof candidate.code === 'string' ? candidate.code : undefined,
      constraint: typeof candidate.constraint === 'string' ? candidate.constraint : undefined,
      table: typeof candidate.table === 'string' ? candidate.table : undefined,
      column: typeof candidate.column === 'string' ? candidate.column : undefined,
      stackFirstLine,
      stack: stack || undefined,
    };
  }

  private sanitizeUrl(rawUrl: string): string {
    if (!rawUrl) return '';
    return rawUrl.replace(/([?&](?:token|password|pin|managerPin|secret)=)[^&]+/gi, '$1[REDACTED]');
  }

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const mapped = mapToHttpException(exception);
    const status = mapped.getStatus();
    const body = mapped.getResponse();
    const requestId = request.headers['x-request-id'] ?? null;
    const sanitizedError = this.sanitizeError(exception);
    const safePath = this.sanitizeUrl(request.url);

    if (status >= 500) {
      console.error(
        '[global-exception]',
        JSON.stringify({
          method: request.method,
          path: safePath,
          status,
          requestId,
          error: sanitizedError,
        }),
      );

      this.logger.error(
        {
          method: request.method,
          path: safePath,
          status,
          requestId,
          error: sanitizedError,
        },
        `Unhandled server error ${status}`,
      );

      if (process.env.ERROR_TRACKING_ENABLED === 'true') {
        Sentry.withScope((scope) => {
          scope.setExtra('requestId', requestId);
          scope.setExtra('path', safePath);
          Sentry.captureException(exception);
        });
      }

      const alertWebhookUrl = process.env.CRITICAL_ALERT_WEBHOOK_URL || process.env.ALERT_WEBHOOK_URL;
      if (alertWebhookUrl) {
        try {
          const alertMsg = exception instanceof Error ? exception.message : String(exception);
          fetch(alertWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              content: `🚨 **Critical Server Error (500)**\n**Path:** \`${request.method} ${safePath}\`\n**Error:** \`${alertMsg}\`\n**RequestId:** \`${requestId}\`\n**Timestamp:** ${new Date().toISOString()}`,
              path: safePath,
              method: request.method,
              requestId,
              error: alertMsg,
            }),
          }).catch(() => undefined);
        } catch {
          // non-blocking
        }
      }
    } else {
      this.logger.warn(exception instanceof Error ? exception.message : 'Client error', {
        method: request.method,
        path: safePath,
        status,
        requestId,
        error: sanitizedError,
      });
    }

    response.status(status).json({
      statusCode: status,
      error: body,
      timestamp: new Date().toISOString(),
      path: request.url,
      requestId,
    });
  }
}
